import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT } from './config.js';
import * as store from './store.js';
import { bus } from './bus.js';
import { log } from './logger.js';

const execFileAsync = promisify(execFile);

/**
 * Facturation (PLAN §7). RÈGLE ABSOLUE : les montants sont calculés CÔTÉ
 * SERVEUR par l'outil de facturation certifié (numérotation, totaux, TVA).
 * HaikoDev n'additionne jamais d'argent lui-même : il affiche.
 */

/**
 * L'outil de facturation vit DANS le dépôt (`outils/compta/`) : posé dans le
 * dossier personnel d'un utilisateur, il disparaissait avec lui et ne se
 * versionnait nulle part. Le dossier personnel reste un repli — une machine
 * peut encore l'y avoir — mais jamais un chemin d'utilisateur écrit en dur.
 */
const SCRIPT_CANDIDATES = [
  path.join(ROOT, 'outils', 'compta', 'scripts', 'compta.mjs'),
  path.join(os.homedir(), '.claude', 'skills', 'compta', 'scripts', 'compta.mjs'),
];

function scriptPath(): string | null {
  return SCRIPT_CANDIDATES.find((candidate) => fs.existsSync(candidate)) ?? null;
}

export function billingAvailable(): boolean {
  return scriptPath() !== null;
}

async function compta(args: string[]): Promise<any> {
  const script = scriptPath();
  if (!script) throw new Error("l'outil de facturation n'est pas installé sur ce serveur");
  const { stdout } = await execFileAsync(process.execPath, [script, ...args], {
    timeout: 60000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const text = stdout.trim();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function listClients(): Promise<any[]> {
  try {
    const companies = await compta(['companies']);
    const list = Array.isArray(companies) ? companies : (companies?.items ?? []);
    const out: any[] = [];
    for (const company of list) {
      const slug = company.slug ?? company.name ?? company.id;
      const clients = await compta(['clients', String(slug)]);
      const items = Array.isArray(clients) ? clients : (clients?.items ?? []);
      for (const client of items) {
        out.push({
          id: client.id,
          name: client.company_name || client.name || `${client.first_name ?? ''} ${client.last_name ?? ''}`.trim(),
          companyId: company.id,
          companyName: company.name ?? slug,
          companySlug: slug,
        });
      }
    }
    return out;
  } catch (err) {
    log.warn('liste des clients indisponible', err);
    return [];
  }
}

export async function listDocuments(clientId?: string): Promise<any[]> {
  try {
    const [quotes, invoices] = await Promise.all([
      compta(['list', 'quote', '--status', 'draft', '--limit', '30']),
      compta(['list', 'invoice', '--status', 'draft', '--limit', '30']),
    ]);
    const normalise = (items: any, type: 'offer' | 'invoice') =>
      (Array.isArray(items) ? items : (items?.items ?? [])).map((doc: any) => ({
        id: doc.id,
        type,
        number: doc.number ?? doc.reference,
        title: doc.title,
        clientId: doc.client ?? doc.client_id,
        total: doc.total,
        currency: doc.currency ?? 'CHF',
        status: doc.status,
      }));
    const all = [...normalise(quotes, 'offer'), ...normalise(invoices, 'invoice')];
    return clientId ? all.filter((doc) => doc.clientId === clientId) : all;
  } catch (err) {
    log.warn('liste des documents indisponible', err);
    return [];
  }
}

/** Ajoute la ligne de la carte au devis ou à la facture choisie. */
export async function pushLine(input: {
  cardId: string;
  documentType: 'offer' | 'invoice';
  documentId?: string;
  title: string;
  description?: string;
  hours: number;
}): Promise<{ ok: boolean; error?: string; documentNumber?: string }> {
  const card = store.getCard(input.cardId);
  if (!card) return { ok: false, error: 'carte introuvable' };
  const project = store.getProject(card.projectId);
  if (!project) return { ok: false, error: 'projet introuvable' };

  const link = project.billing;
  if (!link?.clientId) return { ok: false, error: "ce projet n'est relié à aucun client" };

  const rate = link.hourlyRate ?? 130;
  const kind = input.documentType === 'offer' ? 'quote' : 'invoice';

  try {
    let documentId = input.documentId ?? link.defaultDocumentId;
    let documentNumber: string | undefined;

    if (documentId) {
      // Document existant : on récupère ses lignes et on ajoute la nôtre.
      const current = await compta(['get', kind, documentId]);
      const existing = (current?.items ?? current?.expand?.items ?? []).map((item: any) => ({
        title: item.title,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        unit_price: item.unit_price,
        type: item.type,
        text_content: item.text_content,
      }));
      const items = [
        ...existing,
        { title: input.title, description: input.description ?? '', quantity: input.hours, unit: 'heure', unit_price: rate },
      ];
      await compta(['set-items', kind, documentId, JSON.stringify({ items })]);
      documentNumber = current?.number ?? current?.reference;
    } else {
      const spec = {
        company: link.companyName ?? 'haiko',
        client: link.clientId,
        title: `Travaux — ${project.name}`,
        currency: link.currency ?? 'CHF',
        items: [
          {
            title: input.title,
            description: input.description ?? '',
            quantity: input.hours,
            unit: 'heure',
            unit_price: rate,
          },
        ],
      };
      const created = await compta(['create', kind, JSON.stringify(spec)]);
      documentId = created?.id;
      documentNumber = created?.number ?? created?.reference;
    }

    const updated = store.saveCard({
      ...card,
      billing: {
        documentType: input.documentType,
        documentId: documentId ?? '',
        documentNumber,
        title: input.title,
        hours: input.hours,
        amount: input.hours * rate,
        addedAt: Date.now(),
      },
    });
    bus.emit({ type: 'card.upsert', card: updated });
    return { ok: true, documentNumber };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

/** Vue de synthèse par société, en lecture seule. */
export async function summary(): Promise<any> {
  try {
    const report = await compta(['report']);
    return report;
  } catch (err: any) {
    return { error: err?.message ?? 'synthèse indisponible' };
  }
}
