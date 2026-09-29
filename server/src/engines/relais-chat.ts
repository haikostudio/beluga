import http from 'node:http';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { FicheMoteur } from '@beluga/shared';

/**
 * LE RELAIS « RESPONSES → CHAT » des moteurs ajoutés de la famille OpenAI.
 *
 * L'outil de Codex ne parle plus que l'API « responses » d'OpenAI (0.146 :
 * `wire_api = "chat"` est refusé à la lecture du `config.toml`). Or bien des
 * fournisseurs compatibles — Gemini le premier — ne servent que
 * `/chat/completions` et rendent 404 sur `/responses`. Pour ces fiches
 * (`api: 'chat'`), le `config.toml` du compte pointe Codex sur CE relais, qui
 * écoute sur la boucle locale seulement, traduit chaque demande en
 * `/chat/completions` chez le fournisseur, puis retraduit le flux en
 * événements « responses ».
 *
 * AUCUN SECRET ICI : la clé arrive dans l'en-tête `authorization` posé par
 * Codex et repart telle quelle chez le fournisseur ; le relais ne la garde ni
 * ne l'écrit. Il ne vise que les adresses INSCRITES par `inscrireAmont` (celle
 * de la fiche, au moment où l'environnement du tour est construit) : ce n'est
 * pas un relais ouvert.
 *
 * Gemini 3 exige qu'un appel d'outil renvoyé dans l'historique porte sa
 * « signature de pensée » (`extra_content.google.thought_signature`). Codex ne
 * la connaît pas et ne la renverrait pas : le relais la garde par `call_id`
 * et la remet en place au tour suivant.
 */

/* ------------------------------------------------------------------ */
/* La traduction de la demande                                         */
/* ------------------------------------------------------------------ */

type MessageChat = Record<string, unknown> & { role: string };

/** Les signatures des appels d'outils, par `call_id` — bornées. */
export class MemoireDesSignatures {
  private readonly parAppel = new Map<string, unknown>();
  constructor(private readonly plafond = 4000) {}
  retenir(callId: string, extra: unknown): void {
    if (!callId || extra === undefined || extra === null) return;
    this.parAppel.delete(callId);
    this.parAppel.set(callId, extra);
    while (this.parAppel.size > this.plafond) this.parAppel.delete(this.parAppel.keys().next().value as string);
  }
  lire(callId: string): unknown {
    return this.parAppel.get(callId);
  }
}

function texteDuContenu(contenu: unknown): string {
  if (typeof contenu === 'string') return contenu;
  if (!Array.isArray(contenu)) return '';
  return contenu
    .map((part: any) => (typeof part?.text === 'string' ? part.text : typeof part === 'string' ? part : ''))
    .filter(Boolean)
    .join('\n');
}

/** Le contenu d'un message utilisateur : texte, ou parties avec images. */
function contenuUtilisateur(contenu: unknown): unknown {
  if (!Array.isArray(contenu)) return texteDuContenu(contenu);
  const images = contenu.filter((p: any) => p?.type === 'input_image' && typeof p.image_url === 'string');
  if (!images.length) return texteDuContenu(contenu);
  return contenu.flatMap((p: any): Record<string, unknown>[] => {
    if (p?.type === 'input_image' && typeof p.image_url === 'string') return [{ type: 'image_url', image_url: { url: p.image_url } }];
    if (typeof p?.text === 'string') return [{ type: 'text', text: p.text }];
    return [];
  });
}

/**
 * UNE DEMANDE « RESPONSES » DEVIENT UNE DEMANDE « CHAT ». Les consignes
 * (`instructions`, messages `developer`/`system`) forment un seul message
 * système en tête ; les appels d'outils rejoignent le message assistant qui
 * les précède ; seuls les outils de type `function` passent — les autres
 * (espaces de noms, outils libres, recherche d'OpenAI) n'existent pas ailleurs.
 */
export function demandeChatDepuisResponses(corps: any, signatures?: MemoireDesSignatures): Record<string, unknown> {
  const consignes: string[] = [];
  if (typeof corps?.instructions === 'string' && corps.instructions.trim()) consignes.push(corps.instructions);
  const messages: MessageChat[] = [];
  const dernierAssistant = (): MessageChat => {
    const dernier = messages[messages.length - 1];
    if (dernier?.role === 'assistant') return dernier;
    const neuf: MessageChat = { role: 'assistant', content: null };
    messages.push(neuf);
    return neuf;
  };
  const appel = (callId: string, nom: string, argumentsJson: string) => {
    const assistant = dernierAssistant();
    const extra = signatures?.lire(callId);
    const outils = (assistant.tool_calls as unknown[] | undefined) ?? [];
    outils.push({
      id: callId,
      type: 'function',
      function: { name: nom, arguments: argumentsJson || '{}' },
      ...(extra ? { extra_content: extra } : {}),
    });
    assistant.tool_calls = outils;
  };

  const entrees: any[] = typeof corps?.input === 'string' ? [{ type: 'message', role: 'user', content: corps.input }] : Array.isArray(corps?.input) ? corps.input : [];
  for (const item of entrees) {
    const genre = item?.type ?? (item?.role ? 'message' : '');
    if (genre === 'message') {
      if (item.role === 'developer' || item.role === 'system') {
        const texte = texteDuContenu(item.content);
        if (texte) consignes.push(texte);
      } else if (item.role === 'assistant') {
        const texte = texteDuContenu(item.content);
        if (texte) messages.push({ role: 'assistant', content: texte });
      } else {
        messages.push({ role: 'user', content: contenuUtilisateur(item.content) });
      }
    } else if (genre === 'function_call') {
      appel(String(item.call_id ?? item.id ?? ''), String(item.name ?? ''), String(item.arguments ?? '{}'));
    } else if (genre === 'custom_tool_call') {
      appel(String(item.call_id ?? item.id ?? ''), String(item.name ?? ''), JSON.stringify({ input: String(item.input ?? '') }));
    } else if (genre === 'function_call_output' || genre === 'custom_tool_call_output') {
      const sortie = typeof item.output === 'string' ? item.output : texteDuContenu(item.output?.content ?? item.output);
      messages.push({ role: 'tool', tool_call_id: String(item.call_id ?? ''), content: sortie });
    }
    // `reasoning` et le reste : propres à OpenAI, ils ne se traduisent pas.
  }

  const outils = (Array.isArray(corps?.tools) ? corps.tools : [])
    .filter((o: any) => o?.type === 'function' && typeof o.name === 'string')
    .map((o: any) => ({
      type: 'function',
      function: {
        name: o.name,
        ...(o.description ? { description: o.description } : {}),
        parameters: o.parameters ?? { type: 'object', properties: {} },
      },
    }));

  return {
    model: corps?.model,
    messages: [...(consignes.length ? [{ role: 'system', content: consignes.join('\n\n') }] : []), ...messages],
    ...(outils.length ? { tools: outils, tool_choice: corps?.tool_choice === 'none' ? 'none' : 'auto' } : {}),
    ...(typeof corps?.max_output_tokens === 'number' ? { max_tokens: corps.max_output_tokens } : {}),
    ...(typeof corps?.temperature === 'number' ? { temperature: corps.temperature } : {}),
    stream: true,
    stream_options: { include_usage: true },
  };
}

/* ------------------------------------------------------------------ */
/* La traduction du flux                                               */
/* ------------------------------------------------------------------ */

interface AppelEnCours {
  id: string;
  nom: string;
  arguments: string;
  extra?: unknown;
}

/**
 * LE FLUX « CHAT » DEVIENT UN FLUX « RESPONSES ». On lui donne les morceaux
 * reçus (`recevoir`), il rend les événements à écrire. Le texte part au fil
 * de l'eau ; les appels d'outils, une fois leurs arguments complets.
 */
export class TraducteurDeFlux {
  readonly id = `resp_${crypto.randomBytes(8).toString('hex')}`;
  private readonly idMessage = `msg_${crypto.randomBytes(8).toString('hex')}`;
  private texte = '';
  private messageOuvert = false;
  private readonly appels: AppelEnCours[] = [];
  private usage: any = null;
  private sortie: unknown[] = [];

  constructor(
    private readonly modele: string,
    private readonly signatures?: MemoireDesSignatures,
  ) {}

  debut(): unknown[] {
    return [{ type: 'response.created', response: { id: this.id, object: 'response', status: 'in_progress', model: this.modele, output: [] } }];
  }

  recevoir(morceau: any): unknown[] {
    const evenements: unknown[] = [];
    if (morceau?.usage) this.usage = morceau.usage;
    for (const choix of Array.isArray(morceau?.choices) ? morceau.choices : []) {
      const delta = choix?.delta ?? choix?.message ?? {};
      if (typeof delta.content === 'string' && delta.content) {
        if (!this.messageOuvert) {
          this.messageOuvert = true;
          evenements.push({
            type: 'response.output_item.added',
            output_index: 0,
            item: { type: 'message', id: this.idMessage, role: 'assistant', status: 'in_progress', content: [] },
          });
        }
        this.texte += delta.content;
        evenements.push({ type: 'response.output_text.delta', item_id: this.idMessage, output_index: 0, content_index: 0, delta: delta.content });
      }
      for (const [rang, outil] of (Array.isArray(delta.tool_calls) ? delta.tool_calls : []).entries()) {
        const index = typeof outil?.index === 'number' ? outil.index : rang;
        const appel = (this.appels[index] ??= { id: '', nom: '', arguments: '' });
        if (outil?.id) appel.id = String(outil.id);
        if (outil?.function?.name) appel.nom += String(outil.function.name);
        if (typeof outil?.function?.arguments === 'string') appel.arguments += outil.function.arguments;
        else if (outil?.function?.arguments && typeof outil.function.arguments === 'object') appel.arguments = JSON.stringify(outil.function.arguments);
        if (outil?.extra_content) appel.extra = outil.extra_content;
      }
    }
    return evenements;
  }

  fin(): unknown[] {
    const evenements: unknown[] = [];
    const sortie: unknown[] = [];
    if (this.messageOuvert) {
      const item = {
        type: 'message',
        id: this.idMessage,
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: this.texte, annotations: [] }],
      };
      evenements.push({ type: 'response.output_item.done', output_index: 0, item });
      sortie.push(item);
    }
    for (const appel of this.appels.filter(Boolean)) {
      const callId = appel.id || `call_${crypto.randomBytes(8).toString('hex')}`;
      this.signatures?.retenir(callId, appel.extra);
      const item = {
        type: 'function_call',
        id: `fc_${crypto.randomBytes(8).toString('hex')}`,
        call_id: callId,
        name: appel.nom,
        arguments: appel.arguments || '{}',
        status: 'completed',
      };
      evenements.push({ type: 'response.output_item.added', output_index: sortie.length, item: { ...item, status: 'in_progress' } });
      evenements.push({ type: 'response.output_item.done', output_index: sortie.length, item });
      sortie.push(item);
    }
    this.sortie = sortie;
    const u = this.usage ?? {};
    const entree = Number(u.prompt_tokens ?? 0);
    const produit = Number(u.completion_tokens ?? 0);
    evenements.push({
      type: 'response.completed',
      response: {
        id: this.id,
        object: 'response',
        status: 'completed',
        model: this.modele,
        output: this.sortie,
        usage: {
          input_tokens: entree,
          input_tokens_details: { cached_tokens: Number(u.prompt_tokens_details?.cached_tokens ?? 0) },
          output_tokens: produit,
          output_tokens_details: { reasoning_tokens: Number(u.completion_tokens_details?.reasoning_tokens ?? 0) },
          total_tokens: Number(u.total_tokens ?? entree + produit),
        },
      },
    });
    return evenements;
  }

  echec(message: string): unknown[] {
    return [{ type: 'response.failed', response: { id: this.id, object: 'response', status: 'failed', error: { code: 'server_error', message } } }];
  }
}

/* ------------------------------------------------------------------ */
/* Le serveur                                                          */
/* ------------------------------------------------------------------ */

/** Les adresses de fournisseurs que le relais a le droit de viser, par fiche. */
const amonts = new Map<string, string>();
const signatures = new MemoireDesSignatures();
let serveur: http.Server | null = null;
let adresse: string | null = null;
let demarrage: Promise<string> | null = null;

export function inscrireAmont(ficheId: string, urlDeBase: string): void {
  amonts.set(ficheId, urlDeBase.replace(/\/+$/, ''));
}

/** L'adresse du relais, ou `null` s'il n'écoute pas encore. */
export function adresseDuRelaisChat(): string | null {
  return adresse;
}

/**
 * L'ADRESSE QUE CODEX DOIT VISER POUR CETTE FICHE : celle du fournisseur en
 * « responses », celle du relais en « chat » (inscrite au passage). `null` si
 * le relais n'écoute pas — le tour ne part alors pas.
 */
export function adresseCodexDeLaFiche(fiche: Pick<FicheMoteur, 'id' | 'urlDeBase' | 'api'>): string | null {
  if (fiche.api !== 'chat') return fiche.urlDeBase;
  if (!adresse) return null;
  inscrireAmont(fiche.id, fiche.urlDeBase);
  return `${adresse}/f/${encodeURIComponent(fiche.id)}`;
}

function ecrireEvenement(res: http.ServerResponse, evenement: any): void {
  res.write(`event: ${evenement.type}\ndata: ${JSON.stringify(evenement)}\n\n`);
}

async function lireCorps(req: http.IncomingMessage): Promise<string> {
  const morceaux: Buffer[] = [];
  for await (const m of req) morceaux.push(m as Buffer);
  return Buffer.concat(morceaux).toString('utf8');
}

async function traiter(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const trouve = /^\/f\/([^/]+)(\/.*)$/.exec((req.url ?? '').split('?')[0]);
  const amont = trouve ? amonts.get(decodeURIComponent(trouve[1])) : undefined;
  if (!trouve || !amont) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'moteur inconnu du relais' } }));
    return;
  }
  const route = trouve[2];
  const autorisation = String(req.headers.authorization ?? '');

  if (req.method === 'GET' && route === '/models') {
    const r = await fetch(`${amont}/models`, { headers: { authorization: autorisation }, signal: AbortSignal.timeout(15000) });
    res.writeHead(r.status, { 'content-type': 'application/json' });
    res.end(await r.text());
    return;
  }
  if (req.method !== 'POST' || route !== '/responses') {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `route ${route} non traduite` } }));
    return;
  }

  const corps = JSON.parse((await lireCorps(req)) || '{}');
  const controle = new AbortController();
  res.on('close', () => controle.abort());
  const reponse = await fetch(`${amont}/chat/completions`, {
    method: 'POST',
    headers: { authorization: autorisation, 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(demandeChatDepuisResponses(corps, signatures)),
    signal: controle.signal,
  });
  if (!reponse.ok || !reponse.body) {
    // Le statut du fournisseur est rendu tel quel : Codex retente un 429 ou
    // un 5xx, et montre la cause d'un 4xx.
    const texte = await reponse.text().catch(() => '');
    res.writeHead(reponse.status || 502, { 'content-type': 'application/json' });
    let message = texte.slice(0, 2000);
    try {
      const lu = JSON.parse(texte);
      message = (Array.isArray(lu) ? lu[0] : lu)?.error?.message ?? message;
    } catch {
      /* texte brut */
    }
    res.end(JSON.stringify({ error: { message: message || `réponse ${reponse.status}` } }));
    return;
  }

  const flux = new TraducteurDeFlux(String(corps?.model ?? ''), signatures);
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  for (const e of flux.debut()) ecrireEvenement(res, e);
  const lecteur = reponse.body.getReader();
  const decodeur = new TextDecoder();
  let reste = '';
  try {
    for (;;) {
      const { value, done } = await lecteur.read();
      if (done) break;
      reste += decodeur.decode(value, { stream: true });
      let fin: number;
      while ((fin = reste.indexOf('\n')) >= 0) {
        const ligne = reste.slice(0, fin).trim();
        reste = reste.slice(fin + 1);
        if (!ligne.startsWith('data:')) continue;
        const donnee = ligne.slice(5).trim();
        if (!donnee || donnee === '[DONE]') continue;
        let morceau: any;
        try {
          morceau = JSON.parse(donnee);
        } catch {
          continue;
        }
        if (morceau?.error) {
          for (const e of flux.echec(String(morceau.error.message ?? 'erreur du fournisseur'))) ecrireEvenement(res, e);
          res.end();
          return;
        }
        for (const e of flux.recevoir(morceau)) ecrireEvenement(res, e);
      }
    }
    for (const e of flux.fin()) ecrireEvenement(res, e);
  } catch (err: any) {
    for (const e of flux.echec(err?.message ?? String(err))) ecrireEvenement(res, e);
  }
  res.end();
}

/** Démarre le relais (une fois par processus) sur la boucle locale ; rend son adresse. */
export function demarrerRelaisChat(): Promise<string> {
  if (adresse) return Promise.resolve(adresse);
  demarrage ??= new Promise<string>((resolve, reject) => {
    const s = http.createServer((req, res) => {
      traiter(req, res).catch((err: any) => {
        if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: err?.message ?? String(err) } }));
      });
    });
    s.on('error', (err) => {
      demarrage = null;
      reject(err);
    });
    s.listen(0, '127.0.0.1', () => {
      serveur = s;
      // Le relais ne doit jamais retenir le processus (tests, arrêt du démon).
      s.unref();
      adresse = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
      resolve(adresse);
    });
  });
  return demarrage;
}

/** Pour les tests. */
export function arreterRelaisChat(): void {
  serveur?.close();
  serveur = null;
  adresse = null;
  demarrage = null;
}
