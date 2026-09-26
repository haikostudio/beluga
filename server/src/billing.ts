import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT } from './config.js';
import * as store from './store.js';
import { bus } from './bus.js';
import { adapterFor } from './engines/index.js';
import { log } from './logger.js';
import { consigneDeLangue, CONSIGNE_DE_VULGARISATION } from '@beluga/shared';
import { langueDesAgents } from './langue-configuree.js';

const execFileAsync = promisify(execFile);

/**
 * Facturation (PLAN §7). RÈGLE ABSOLUE : les montants sont calculés CÔTÉ
 * SERVEUR par l'outil de facturation certifié (numérotation, totaux, TVA).
 * Beluga Build n'additionne jamais d'argent lui-même : il affiche.
 */

/**
 * L'outil de facturation vit DANS le dépôt (`outils/compta/`) : posé dans le
 * dossier personnel d'un utilisateur, il disparaissait avec lui et ne se
 * versionnait nulle part. Le dossier personnel reste un repli — une machine
 * peut encore l'y avoir — mais jamais un chemin d'utilisateur écrit en dur.
 */
const SCRIPT_CANDIDATES = [
  /* Un chemin donné par l'environnement passe devant : c'est ce qui permet aux
     contrôles de faire tourner un faux outil de facturation, qui note ce qu'on
     lui demande au lieu d'écrire dans la vraie comptabilité. */
  process.env.BELUGA_COMPTA_BIN ?? '',
  path.join(ROOT, 'outils', 'compta', 'scripts', 'compta.mjs'),
  path.join(os.homedir(), '.claude', 'skills', 'compta', 'scripts', 'compta.mjs'),
].filter(Boolean);

function scriptPath(): string | null {
  return SCRIPT_CANDIDATES.find((candidate) => fs.existsSync(candidate)) ?? null;
}

export function billingAvailable(): boolean {
  return scriptPath() !== null;
}

/** Le champ `description` du document compta est du HTML : on y échappe le texte du client. */
function versHtml(texte: string): string {
  const echappe = texte
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<p>${echappe}</p>`;
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

/**
 * Les documents où l'on peut encore déposer une ligne (les brouillons).
 *
 * Le NOM DU CLIENT voyage avec chaque document : c'est par lui que le tiroir de
 * sélection se cherche, autant que par le numéro. L'outil de facturation le rend
 * déjà déplié dans son champ `client` quand il a pu le résoudre — sinon il n'y
 * laisse que l'identifiant, qu'on ne montre pas comme s'il s'agissait d'un nom.
 */
export async function listDocuments(clientId?: string): Promise<any[]> {
  try {
    const [quotes, invoices] = await Promise.all([
      compta(['list', 'quote', '--status', 'draft', '--limit', '50']),
      compta(['list', 'invoice', '--status', 'draft', '--limit', '50']),
    ]);
    const ressembleAUnIdentifiant = (valeur: string) => /^[a-z0-9]{15}$/i.test(valeur);
    const normalise = (items: any, type: 'offer' | 'invoice') =>
      (Array.isArray(items) ? items : (items?.items ?? [])).map((doc: any) => {
        const client = String(doc.client ?? doc.client_id ?? '');
        return {
          id: doc.id,
          type,
          number: doc.number ?? doc.reference,
          title: doc.title,
          date: doc.date,
          clientId: client,
          clientName: client && !ressembleAUnIdentifiant(client) ? client : '',
          total: doc.total,
          currency: doc.currency ?? 'CHF',
          status: doc.status,
        };
      });
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
  /** Le texte simple destiné au CLIENT : c'est lui qui apparaît sur le devis ou la facture. */
  clientExplanation?: string;
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
  // Le client lit le devis/la facture : c'est son explication, simple et sans jargon,
  // qui y figure — la description technique reste interne à la carte.
  const clientExplanation = input.clientExplanation?.trim();
  const documentDescription = clientExplanation ? versHtml(clientExplanation) : (input.description ?? '');

  try {
    let documentId = input.documentId ?? link.defaultDocumentId;
    let documentNumber: string | undefined;

    if (documentId) {
      /*
       * AJOUTER UNE LIGNE N'AJOUTE QUE CETTE LIGNE. Auparavant on relisait le
       * document, on en recopiait les lignes dans une projection à SEPT champs,
       * et `set-items` EFFAÇAIT toutes les lignes existantes pour les recréer à
       * partir de cette copie appauvrie : les lignes de texte perdaient leur
       * style, les lignes optionnelles redevenaient facturables, les positions
       * et les identifiants de ligne étaient renumérotés — bref, la mise en page
       * du document sautait et ses lignes étaient réécrites, alors qu'on n'avait
       * demandé qu'un ajout. `add-items` empile la nouvelle ligne à la suite,
       * sans toucher une seule des lignes déjà là, puis recalcule les totaux.
       */
      const result = await compta([
        'add-items',
        kind,
        documentId,
        JSON.stringify({
          items: [
            { title: input.title, description: documentDescription, quantity: input.hours, unit: 'heure', unit_price: rate },
          ],
        }),
      ]);
      documentNumber = result?.number ?? result?.reference;
    } else {
      const spec = {
        company: link.companyName ?? 'haiko',
        client: link.clientId,
        title: `Travaux — ${project.name}`,
        currency: link.currency ?? 'CHF',
        items: [
          {
            title: input.title,
            description: documentDescription,
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
        clientExplanation,
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

/* ------------------------------------------------------------------ */
/* Régénérer un texte de la ligne facturée                             */
/* ------------------------------------------------------------------ */

/** Les trois textes de la ligne, chacun avec sa consigne propre. */
export type ChampFacturable = 'title' | 'description' | 'clientExplanation';

const CONSIGNES: Record<ChampFacturable, string> = {
  title:
    "Écris le TITRE de cette ligne de facture : une seule ligne, 80 signes au plus, "
    + "en phrases simples, qui dit ce qui a été fait. Pas de point final, pas de guillemets.",
  description:
    "Écris la DESCRIPTION INTERNE de cette ligne de facture : deux ou trois phrases "
    + "factuelles qui disent ce qui a été fait. Elle reste dans notre outil, elle peut "
    + "donc être précise. Pas de liste à puces, pas de titre.",
  clientExplanation:
    "Écris l'EXPLICATION CLIENT de cette ligne de facture : deux ou trois phrases simples "
    + "et un peu ludiques, que lira quelqu'un qui n'y connaît rien en informatique. "
    + "Aucun jargon, aucun nom de fichier, aucun nom d'outil technique. Pas de liste à puces.",
};

/**
 * LE BOUTON « IA » D'UN CHAMP NE RÉÉCRIT QUE SON CHAMP. Il repart de ce que la
 * carte sait déjà — son titre, sa description, son cadrage, son chiffrage — et
 * rend un texte nu. Le petit modèle (Haiku) suffit largement et ne coûte
 * presque rien ; il est lancé par le moteur déjà authentifié, sans clé facturée.
 */
export async function regenerateText(input: {
  cardId: string;
  field: ChampFacturable;
  hint?: string;
}): Promise<{ ok: boolean; text?: string; error?: string }> {
  const card = store.getCard(input.cardId);
  if (!card) return { ok: false, error: 'carte introuvable' };
  const project = store.getProject(card.projectId);

  const morceaux = [
    project?.name ? `PROJET : ${project.name}` : '',
    `TITRE DE LA TÂCHE : ${card.title}`,
    card.description ? `DESCRIPTION DE LA TÂCHE :\n${card.description}` : '',
    card.briefing ? `CE QUI A ÉTÉ DEMANDÉ :\n${card.briefing.slice(0, 4000)}` : '',
    card.estimate?.summary ? `RÉSUMÉ DU CHIFFRAGE : ${card.estimate.summary}` : '',
    input.hint?.trim() ? `TEXTE ACTUEL, À REPRENDRE OU À AMÉLIORER :\n${input.hint.trim().slice(0, 2000)}` : '',
  ].filter(Boolean);

  const prompt =
    `${consigneDeLangue(langueDesAgents())}\n${CONSIGNE_DE_VULGARISATION}\n\n${CONSIGNES[input.field]}\n\nRéponds UNIQUEMENT par le texte demandé : aucun titre, `
    + `aucun commentaire, aucune explication autour.\n\n${morceaux.join('\n\n')}`;

  try {
    const { stdout } = await execFileAsync(
      adapterFor('claude').binary,
      ['-p', prompt, '--model', 'haiku', '--output-format', 'text'],
      { cwd: ROOT, timeout: 120000, maxBuffer: 2 * 1024 * 1024 },
    );
    /* Un modèle rend parfois son texte entre guillemets ou précédé d'un tiret de
       liste : on le débarrasse de ces habits avant de le poser dans le champ. */
    const texte = stdout
      .trim()
      .replace(/^```[a-z]*\n?|```$/g, '')
      .split('\n')
      .map((ligne) => ligne.replace(/^[-*]\s+/, '').trim())
      .filter(Boolean)
      .join('\n')
      .replace(/^["«»\s]+|["«»\s]+$/g, '')
      .trim();
    if (!texte) return { ok: false, error: 'le modèle n’a rien rendu' };
    return { ok: true, text: input.field === 'title' ? texte.split('\n')[0].slice(0, 80) : texte };
  } catch (err: any) {
    log.warn('régénération de texte impossible', err);
    return { ok: false, error: err?.message ?? 'régénération impossible' };
  }
}
