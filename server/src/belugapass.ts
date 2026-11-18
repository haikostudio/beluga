/**
 * LA LIAISON AVEC BELUGA PASS, côté Beluga Build (carte « Audits passés et synchro Beluga Pass », 15/11/2026).
 * Contrat : `/root/belugapass/docs/contrat-beluga-build.md` ; en face : `crates/server/src/routes/agent.rs`.
 *
 * CE QUI EST GARDÉ, ET OÙ.
 *  - La CLÉ DE LIAISON : sa valeur au COFFRE-FORT (fiche « Beluga Build — Beluga Pass — clé de liaison », il faut la
 *    redonner à chaque appel vers Beluga Pass), son EMPREINTE SHA-256 en base pour reconnaître les appels entrants.
 *  - La PAIRE X25519 DES AGENTS : la privée au COFFRE-FORT (sa propre fiche), la publique en base (rendue par
 *    `GET /link`). Elle survit à une nouvelle liaison : les coffres scellés pour elle restent lisibles.
 *  - Le MIROIR : la dernière sauvegarde chiffrée reçue, telle quelle. Beluga ne peut pas la lire (les clés des coffres
 *    y sont scellées pour la clé de l'UTILISATEUR) et ne cherche pas à le faire.
 *  - Le JOURNAL DES LECTURES : qui, quand, combien de coffres et de fiches. JAMAIS ce qui a été lu.
 *
 * CE QUI N'EST JAMAIS GARDÉ : une fiche déchiffrée. La lecture par un agent ouvre les coffres EN MÉMOIRE et dépose le
 * résultat dans un fichier temporaire réservé au compte du démon (0600), effacé au bout de dix minutes ; la réponse
 * de l'outil ne porte que son chemin — rien n'entre dans la base, dans un message ou dans un journal de tour.
 *
 * Les routes `/api/belugapass/*` sont ouvertes sur Internet, AVANT le mur de session (`http.ts`) : leur seule clé est
 * la clé de liaison (comparée à temps constant), un corps trop gros est refusé, et une adresse qui se trompe trop
 * souvent est mise en attente.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  adresseBelugaPassParDefaut,
  DOSSIER_DES_FICHES_BELUGAPASS,
  FICHE_CLE_DE_LIAISON,
  FICHE_CLE_DES_AGENTS,
  PLAFOND_DU_MIROIR_OCTETS,
  PREFIXE_DE_LA_CLE,
  adresseBelugaPass,
  formeDeCleDeLiaison,
  identiteDInstallation,
  intentionParRegles,
  lienDeLiaison,
  validerIntention,
  jetonDeLEntete,
  jugerLeMiroir,
  type EtatBelugaPass,
  type QuestionDeLAssistant,
} from '@beluga/shared';
import { getDb } from './db.js';
import { bus } from './bus.js';
import { log } from './logger.js';
import { assurerCheminDeDossiers, enregistrerAcces, listerAcces, supprimerAcces } from './coffre-fort.js';
import { b64, nouvellePaire, ouvrirBoite, ouvrirJson, publiqueDeLaPrivee } from './belugapass-crypto.js';

interface LigneLiaison {
  id: number;
  endpoint: string;
  token_hash: string | null;
  cree_le: number;
  relie_le: number | null;
  agent_public_key: string | null;
  agent_cle_fiche: string | null;
  /** 0 = fermé, 1 = ouvert (Beluga Pass l'a confirmé), 2 = demandé, en attente qu'un appareil scelle les clés. */
  agent_access: number;
  derniere_sauvegarde_le: number | null;
  volume: number | null;
  coffres: number | null;
  fiches: number | null;
  derniere_erreur: string | null;
}

function ligne(): LigneLiaison | null {
  return (getDb().prepare('SELECT * FROM belugapass_liaison WHERE id = 1').get() as LigneLiaison | undefined) ?? null;
}

function diffuser(): void {
  bus.emit({ type: 'belugapass' } as never);
}

function noterErreur(erreur: string | null): void {
  getDb().prepare('UPDATE belugapass_liaison SET derniere_erreur = ? WHERE id = 1').run(erreur);
  diffuser();
}

/* ------------------------------------------------------------------ */
/* Les fiches du coffre-fort                                           */
/* ------------------------------------------------------------------ */

function ficheNommee(nom: string) {
  return listerAcces().find((a) => a.nom === nom) ?? null;
}

function dossierDesFiches(): string | undefined {
  const r = assurerCheminDeDossiers(DOSSIER_DES_FICHES_BELUGAPASS, null);
  return r.ok ? r.dossier.id : undefined;
}

/** La paire des agents : lue au coffre, créée une fois. Rend la clé publique. */
function assurerLaPaireDesAgents(): { publique: string; ficheId: string } {
  const existante = ficheNommee(FICHE_CLE_DES_AGENTS);
  const privee = existante?.champs?.valeur;
  if (existante && privee) {
    try {
      return { publique: publiqueDeLaPrivee(privee), ficheId: existante.id };
    } catch {
      // Une valeur abîmée : on en refait une, la fiche est corrigée en place.
    }
  }
  const paire = nouvellePaire();
  const r = enregistrerAcces({
    ...(existante ? { id: existante.id } : {}),
    nom: FICHE_CLE_DES_AGENTS,
    type: 'autre',
    projectId: null,
    champs: { valeur: paire.privee },
    note: 'Clé privée X25519 des agents de Beluga Build : elle ouvre les coffres de Beluga Pass quand l’accès des agents est ouvert. Créée par Beluga, à ne pas modifier.',
    dossierId: dossierDesFiches(),
  });
  if (!r.ok) throw new Error(`clé des agents non rangée : ${r.raison}`);
  return { publique: paire.publique, ficheId: r.acces.id };
}

function cleDeLiaisonEnClair(): string | null {
  return ficheNommee(FICHE_CLE_DE_LIAISON)?.champs?.jeton || null;
}

function empreinte(cle: string): string {
  return crypto.createHash('sha256').update(cle, 'utf8').digest('hex');
}

/* ------------------------------------------------------------------ */
/* L'état                                                              */
/* ------------------------------------------------------------------ */

export function etatBelugaPass(): EtatBelugaPass {
  const l = ligne();
  const lectures = (
    getDb().prepare('SELECT quand, agent, coffres, fiches, erreur FROM belugapass_lectures ORDER BY quand DESC LIMIT 10').all() as {
      quand: number;
      agent: string;
      coffres: number;
      fiches: number;
      erreur: string | null;
    }[]
  ).map((x) => ({ ...x, erreur: x.erreur ?? null }));
  return {
    existe: !!l?.token_hash,
    endpoint: l?.endpoint ?? adresseBelugaPassParDefaut(),
    adresseDeBelugaBuild: adresseBelugaPass(identiteDInstallation().adressePublique),
    relie: !!l?.relie_le,
    creeLe: l?.cree_le ?? null,
    relieLe: l?.relie_le ?? null,
    agentAccess: l?.agent_access === 1,
    derniereSauvegardeLe: l?.derniere_sauvegarde_le ?? null,
    volume: l?.volume ?? null,
    coffres: l?.coffres ?? null,
    fiches: l?.fiches ?? null,
    derniereErreur: l?.derniere_erreur ?? (l?.agent_access === 2 ? 'Ouverture demandée : elle se fera à la prochaine ouverture de Beluga Pass sur un appareil.' : null),
    lectures,
  };
}

/* ------------------------------------------------------------------ */
/* Les appels vers Beluga Pass                                         */
/* ------------------------------------------------------------------ */

type Appel = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; json: () => Promise<unknown> }>;
let appeler: Appel = async (url, init) => {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000), redirect: 'error' });
  return { status: r.status, json: () => r.json() };
};
/** Pour les contrôles seulement : un Beluga Pass factice. */
export function remplacerLesAppels(autre: Appel | null): void {
  appeler = autre ?? (async (url, init) => {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000), redirect: 'error' });
    return { status: r.status, json: () => r.json() };
  });
}

async function versBelugaPass(endpoint: string, cle: string, methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}): Promise<unknown> {
  const r = await appeler(`${endpoint}${chemin}`, {
    method: methode,
    headers: { authorization: `Bearer ${cle}`, ...(corps !== undefined ? { 'content-type': 'application/json' } : {}), ...entetes },
    ...(corps !== undefined ? { body: JSON.stringify(corps) } : {}),
  });
  if (r.status === 403) throw new Error('Beluga Pass refuse : l’accès des agents est fermé.');
  if (r.status === 401) throw new Error('Beluga Pass ne reconnaît pas la clé de liaison : collez la nouvelle clé dans Beluga Pass.');
  if (r.status < 200 || r.status >= 300) throw new Error(`Beluga Pass a répondu ${r.status}.`);
  return r.json().catch(() => ({}));
}

/* ------------------------------------------------------------------ */
/* Les gestes de l'écran                                               */
/* ------------------------------------------------------------------ */

/**
 * UNE NOUVELLE CLÉ DE LIAISON : montrée UNE fois (seule la réponse la porte), rangée au coffre et retenue par son
 * empreinte. Une liaison précédente déjà reconnue par Beluga Pass est prévenue (« unlinked ») avec l'ANCIENNE clé.
 */
/**
 * RELIER EN UN CLIC (page « Beluga Pass » des Réglages) : une nouvelle clé, puis le LIEN qui ouvre Beluga Pass déjà
 * rempli (`lienDeLiaison`). L'adresse de Beluga Build est l'adresse PUBLIQUE de l'installation ; l'origine de la page
 * (`origine`) ne sert qu'en repli, quand aucune n'est réglée. Une adresse de Beluga Build égale à celle de Beluga Pass
 * est refusée AVANT de toucher à la clé en place.
 */
export function relierEnUnClic(endpointBrut?: unknown, origine?: unknown): { cle: string; lien: string; adresseDeBelugaBuild: string; etat: EtatBelugaPass } {
  const pass = endpointBrut === undefined || endpointBrut === null || endpointBrut === '' ? adresseBelugaPassParDefaut() : adresseBelugaPass(endpointBrut);
  if (!pass) throw new Error('Adresse de Beluga Pass invalide : elle commence par https://');
  const build = adresseBelugaPass(identiteDInstallation().adressePublique) ?? adresseBelugaPass(origine);
  if (!build) throw new Error('Adresse publique de Beluga Build inconnue : réglez-la dans Réglages → Installation.');
  if (build === pass) throw new Error('L’adresse de Beluga Pass est celle de Beluga Build : indiquez l’adresse de Beluga Pass.');
  const { cle, etat } = nouvelleCle(pass);
  const lien = lienDeLiaison(pass, build, cle);
  if (!lien) throw new Error('Lien de liaison impossible à former.');
  return { cle, lien, adresseDeBelugaBuild: build, etat };
}

export function nouvelleCle(endpointBrut?: unknown): { cle: string; etat: EtatBelugaPass } {
  const endpoint = endpointBrut === undefined || endpointBrut === null || endpointBrut === '' ? adresseBelugaPassParDefaut() : adresseBelugaPass(endpointBrut);
  if (!endpoint) throw new Error('Adresse de Beluga Pass invalide : elle commence par https://');
  const avant = ligne();
  const ancienneCle = avant?.relie_le ? cleDeLiaisonEnClair() : null;
  const agents = assurerLaPaireDesAgents();
  const cle = `${PREFIXE_DE_LA_CLE}${b64(crypto.randomBytes(32))}`;
  const fiche = ficheNommee(FICHE_CLE_DE_LIAISON);
  const r = enregistrerAcces({
    ...(fiche ? { id: fiche.id } : {}),
    nom: FICHE_CLE_DE_LIAISON,
    type: 'jeton',
    projectId: null,
    champs: { service: 'Beluga Pass', adresse: endpoint, portee: 'liaison avec Beluga Build (sauvegarde chiffrée, accès des agents, assistant)', jeton: cle },
    note: 'Clé de liaison entre Beluga Build et Beluga Pass : elle se colle dans Beluga Pass (Réglages → Beluga Build) avec l’adresse de Beluga Build.',
    dossierId: dossierDesFiches(),
  });
  if (!r.ok) throw new Error(`clé de liaison non rangée : ${r.raison}`);
  const maintenant = Date.now();
  getDb()
    .prepare(
      `INSERT INTO belugapass_liaison (id, endpoint, token_hash, cree_le, relie_le, agent_public_key, agent_cle_fiche, agent_access, derniere_erreur)
       VALUES (1, ?, ?, ?, NULL, ?, ?, 0, NULL)
       ON CONFLICT(id) DO UPDATE SET endpoint = excluded.endpoint, token_hash = excluded.token_hash, cree_le = excluded.cree_le,
         relie_le = NULL, agent_public_key = excluded.agent_public_key, agent_cle_fiche = excluded.agent_cle_fiche, agent_access = 0, derniere_erreur = NULL`,
    )
    .run(endpoint, empreinte(cle), maintenant, agents.publique, agents.ficheId);
  if (avant?.relie_le && ancienneCle) {
    void versBelugaPass(avant.endpoint, ancienneCle, 'POST', '/api/beluga/webhook', { event: 'unlinked' }).catch((err) =>
      log.info(`beluga pass : l’ancienne liaison n’a pas pu être prévenue (${(err as Error).message})`),
    );
  }
  log.info('beluga pass : nouvelle clé de liaison générée');
  diffuser();
  return { cle, etat: etatBelugaPass() };
}

/** DÉLIER : Beluga Pass est prévenu, la liaison et la sauvegarde s'en vont, la fiche de la clé est archivée. */
export async function delier(): Promise<EtatBelugaPass> {
  const l = ligne();
  const cle = cleDeLiaisonEnClair();
  if (l?.relie_le && cle) {
    await versBelugaPass(l.endpoint, cle, 'POST', '/api/beluga/webhook', { event: 'unlinked' }).catch((err) =>
      log.info(`beluga pass : déliaison non transmise (${(err as Error).message})`),
    );
  }
  oublierLaLiaison();
  return etatBelugaPass();
}

function oublierLaLiaison(): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM belugapass_liaison WHERE id = 1').run();
    db.prepare('DELETE FROM belugapass_miroir WHERE id = 1').run();
  })();
  const fiche = ficheNommee(FICHE_CLE_DE_LIAISON);
  if (fiche) supprimerAcces(fiche.id);
  log.info('beluga pass : liaison retirée');
  diffuser();
}

/**
 * L'INTERRUPTEUR « ACCÈS DES AGENTS ». Ouvrir = DEMANDER : Beluga Pass scelle les clés des coffres pour nos agents à la
 * prochaine ouverture d'un appareil, puis confirme par `POST /agent-access`. Fermer est immédiat des deux côtés.
 */
export async function reglerLAcces(ouvrir: boolean): Promise<EtatBelugaPass> {
  const l = ligne();
  const cle = cleDeLiaisonEnClair();
  if (!l?.token_hash || !cle) throw new Error('Générez d’abord une clé de liaison.');
  if (!l.relie_le) throw new Error('Beluga Pass n’a pas encore utilisé la clé de liaison : collez-la dans Beluga Pass d’abord.');
  try {
    await versBelugaPass(l.endpoint, cle, 'POST', '/api/beluga/webhook', { event: 'agent_access', enabled: ouvrir });
    getDb().prepare('UPDATE belugapass_liaison SET agent_access = ?, derniere_erreur = NULL WHERE id = 1').run(ouvrir ? 2 : 0);
  } catch (err) {
    // Fermer reste fermé chez nous même si Beluga Pass ne répond pas : plus aucune lecture ne partira d'ici.
    if (!ouvrir) getDb().prepare('UPDATE belugapass_liaison SET agent_access = 0 WHERE id = 1').run();
    noterErreur((err as Error).message);
    throw err;
  }
  diffuser();
  return etatBelugaPass();
}

/* ------------------------------------------------------------------ */
/* Les appels entrants /api/belugapass/*                               */
/* ------------------------------------------------------------------ */

/** Les échecs d'authentification par adresse : au-delà de 20 en dix minutes, l'adresse attend. */
const echecs = new Map<string, { n: number; depuis: number }>();
const FENETRE_MS = 10 * 60 * 1000;

function tropDEchecs(ip: string, maintenant: number): boolean {
  const e = echecs.get(ip);
  if (!e || maintenant - e.depuis > FENETRE_MS) return false;
  return e.n >= 20;
}

function noterEchec(ip: string, maintenant: number): void {
  const e = echecs.get(ip);
  if (!e || maintenant - e.depuis > FENETRE_MS) echecs.set(ip, { n: 1, depuis: maintenant });
  else e.n++;
  if (echecs.size > 5000) echecs.clear();
}

/** La clé présentée est-elle la nôtre ? Comparaison des empreintes à temps constant. */
function cleReconnue(cle: string | null, l: LigneLiaison | null): boolean {
  if (!cle || !l?.token_hash) return false;
  const a = Buffer.from(empreinte(cle), 'hex');
  const b = Buffer.from(l.token_hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export interface ReponseEntrante {
  status: number;
  corps: unknown;
}

/** Le corps se lit seulement après la clé : un inconnu ne fait pas lire 25 Mo au démon. */
export type LireLeCorps = (plafond: number) => Promise<Buffer>;

export async function traiterAppelEntrant(appel: {
  methode: string;
  route: string;
  autorisation: string | string[] | undefined;
  /** `X-Forwarded-Proto` : posé par le relais public. « http » = appel en clair depuis Internet, refusé. */
  proto: string | string[] | undefined;
  ip: string;
  lireLeCorps: LireLeCorps;
}): Promise<ReponseEntrante> {
  const maintenant = Date.now();
  const proto = Array.isArray(appel.proto) ? appel.proto[0] : appel.proto;
  if (proto === 'http') return { status: 403, corps: { ok: false, error: 'HTTPS seulement.' } };
  if (tropDEchecs(appel.ip, maintenant)) return { status: 429, corps: { ok: false, error: 'Trop d’essais : réessayez plus tard.' } };
  const l = ligne();
  const presentee = jetonDeLEntete(appel.autorisation);
  // Une clé qui n'a même pas la forme d'une clé de liaison ne se hache pas : refus d'emblée.
  if (!presentee || !formeDeCleDeLiaison(presentee) || !cleReconnue(presentee, l)) {
    noterEchec(appel.ip, maintenant);
    return { status: 401, corps: { ok: false, error: 'Clé de liaison inconnue.' } };
  }
  const liaison = l!;
  const lireJson = async (plafond: number): Promise<Record<string, unknown> | null> => {
    try {
      const brut = (await appel.lireLeCorps(plafond)).toString('utf8');
      return brut ? (JSON.parse(brut) as Record<string, unknown>) : {};
    } catch {
      return null;
    }
  };
  const route = appel.route.replace(/\/+$/, '');

  if (route === '/api/belugapass/link' && appel.methode === 'GET') {
    // Le premier appel reconnu VAUT liaison : Beluga Pass vient de recevoir la clé.
    getDb().prepare('UPDATE belugapass_liaison SET relie_le = COALESCE(relie_le, ?), derniere_erreur = NULL WHERE id = 1').run(maintenant);
    diffuser();
    return { status: 200, corps: { ok: true, agent_public_key: liaison.agent_public_key ?? assurerLaPaireDesAgents().publique, agent_access: liaison.agent_access === 1 } };
  }

  if (route === '/api/belugapass/link' && appel.methode === 'DELETE') {
    oublierLaLiaison();
    return { status: 200, corps: { ok: true } };
  }

  if (route === '/api/belugapass/mirror' && appel.methode === 'POST') {
    let brut: Buffer;
    try {
      brut = await appel.lireLeCorps(PLAFOND_DU_MIROIR_OCTETS);
    } catch {
      return { status: 413, corps: { ok: false, error: 'Sauvegarde trop volumineuse.' } };
    }
    let miroir: unknown;
    try {
      miroir = JSON.parse(brut.toString('utf8'));
    } catch {
      return { status: 400, corps: { ok: false, error: 'Corps illisible.' } };
    }
    const juge = jugerLeMiroir(miroir);
    if (!juge.ok) return { status: 400, corps: { ok: false, error: juge.raison } };
    const db = getDb();
    db.transaction(() => {
      db.prepare('INSERT INTO belugapass_miroir (id, recu_le, contenu) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET recu_le = excluded.recu_le, contenu = excluded.contenu').run(
        maintenant,
        brut.toString('utf8'),
      );
      db.prepare(
        'UPDATE belugapass_liaison SET derniere_sauvegarde_le = ?, volume = ?, coffres = ?, fiches = ?, relie_le = COALESCE(relie_le, ?), derniere_erreur = NULL WHERE id = 1',
      ).run(maintenant, brut.length, juge.coffres, juge.fiches, maintenant);
    })();
    diffuser();
    return { status: 200, corps: { ok: true } };
  }

  if (route === '/api/belugapass/agent-access' && appel.methode === 'POST') {
    const corps = await lireJson(4096);
    if (!corps || typeof corps.enabled !== 'boolean') return { status: 400, corps: { ok: false, error: '« enabled » attendu.' } };
    getDb().prepare('UPDATE belugapass_liaison SET agent_access = ?, derniere_erreur = NULL WHERE id = 1').run(corps.enabled ? 1 : 0);
    log.info(`beluga pass : accès des agents ${corps.enabled ? 'ouvert' : 'fermé'} depuis Beluga Pass`);
    diffuser();
    return { status: 200, corps: { ok: true } };
  }

  if (route === '/api/belugapass/assistant' && appel.methode === 'POST') {
    const corps = await lireJson(16 * 1024);
    if (!corps || typeof corps.question !== 'string' || !corps.question.trim()) return { status: 400, corps: { ok: false, error: '« question » attendue.' } };
    const question: QuestionDeLAssistant = {
      question: corps.question.slice(0, 500),
      locale: typeof corps.locale === 'string' ? corps.locale.slice(0, 10) : 'fr',
      signals: corps.signals && typeof corps.signals === 'object' ? (corps.signals as QuestionDeLAssistant['signals']) : {},
    };
    // L'intention repasse par la règle du contrat avant de partir : jamais un filtre ou un type que Beluga Pass ignore.
    const intention = validerIntention(intentionParRegles(question));
    return intention ? { status: 200, corps: intention } : { status: 500, corps: { ok: false, error: 'intention invalide' } };
  }

  return { status: 404, corps: { ok: false, error: 'Route inconnue.' } };
}

/* ------------------------------------------------------------------ */
/* La lecture par un agent                                             */
/* ------------------------------------------------------------------ */

export interface FicheBelugaPass {
  coffre: string;
  titre: string;
  type: string;
  champs: Record<string, string>;
  urls: string[];
  notes: string;
  autres: { libelle: string; valeur: string }[];
}

/**
 * LE NOM DE L'AGENT DANS L'EN-TÊTE `X-Beluga-Agent` : un en-tête HTTP ne porte que de l'ASCII (Node refuse d'envoyer
 * « Sécurité de Kipou » ou une apostrophe typographique, et Beluga Pass lit l'en-tête par `to_str()`, ASCII visible
 * seulement). Accents retirés, apostrophes droites, le reste effacé.
 */
export function nomPourLEntete(nom: string): string {
  return (
    nom
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[’‘]/g, "'")
      .replace(/[^\x20-\x7e]/g, '')
      .trim()
      .slice(0, 80) || 'agent'
  );
}

/** L'accès des agents est-il ouvert ? (Sans liaison : non.) */
export function accesDesAgentsOuvert(): boolean {
  return ligne()?.agent_access === 1;
}

/**
 * LIRE LES COFFRES OUVERTS AUX AGENTS : `GET /api/beluga/agent/vaults`, ouverture des clés scellées pour nos agents,
 * déchiffrement en mémoire. La lecture est inscrite (qui, combien) ici et chez Beluga Pass, qui la signale en direct.
 */
export async function lireLesCoffres(agent: string): Promise<FicheBelugaPass[]> {
  const l = ligne();
  const cle = cleDeLiaisonEnClair();
  if (!l || l.agent_access !== 1 || !cle) throw new Error('L’accès des agents à Beluga Pass est fermé.');
  const privee = ficheNommee(FICHE_CLE_DES_AGENTS)?.champs?.valeur;
  if (!privee) throw new Error('La clé privée des agents est absente du coffre-fort : fermez puis rouvrez l’accès des agents.');
  const nom = agent.replace(/[^\p{L}\p{N} ._'’-]/gu, '').slice(0, 80) || 'agent';
  const enregistrer = (coffres: number, fiches: number, erreur: string | null) => {
    getDb().prepare('INSERT INTO belugapass_lectures (quand, agent, coffres, fiches, erreur) VALUES (?, ?, ?, ?, ?)').run(Date.now(), nom, coffres, fiches, erreur);
    getDb().prepare('DELETE FROM belugapass_lectures WHERE id NOT IN (SELECT id FROM belugapass_lectures ORDER BY quand DESC LIMIT 200)').run();
    diffuser();
  };
  let reponse: { vaults?: { id: string; meta_enc: string; key_sealed: string }[]; items?: { id: string; vault_id: string; data_enc: string }[] };
  try {
    reponse = (await versBelugaPass(l.endpoint, cle, 'GET', '/api/beluga/agent/vaults', undefined, { 'x-beluga-agent': nomPourLEntete(nom) })) as typeof reponse;
  } catch (err) {
    enregistrer(0, 0, (err as Error).message);
    if (/fermé/.test((err as Error).message)) getDb().prepare('UPDATE belugapass_liaison SET agent_access = 0 WHERE id = 1').run();
    throw err;
  }
  const cles = new Map<string, { cle: Buffer; nom: string }>();
  for (const v of reponse.vaults ?? []) {
    try {
      const cleDuCoffre = ouvrirBoite(privee, v.key_sealed);
      const meta = ouvrirJson<{ name?: string }>(cleDuCoffre, v.id, v.meta_enc);
      cles.set(v.id, { cle: cleDuCoffre, nom: meta.name || 'Coffre' });
    } catch {
      // Un coffre scellé pour une autre clé (clé des agents refaite) : ignoré, la fermeture/réouverture le règle.
    }
  }
  const fiches: FicheBelugaPass[] = [];
  for (const i of reponse.items ?? []) {
    const coffre = cles.get(i.vault_id);
    if (!coffre) continue;
    try {
      const d = ouvrirJson<{ type?: string; title?: string; fields?: Record<string, string>; urls?: string[]; notes?: string; custom?: { label: string; value: string }[] }>(
        coffre.cle,
        i.id,
        i.data_enc,
      );
      fiches.push({
        coffre: coffre.nom,
        titre: d.title || '—',
        type: d.type || 'note',
        champs: Object.fromEntries(Object.entries(d.fields ?? {}).filter(([, v]) => typeof v === 'string' && v)),
        urls: (d.urls ?? []).filter(Boolean),
        notes: d.notes ?? '',
        autres: (d.custom ?? []).filter((c) => c?.value).map((c) => ({ libelle: c.label, valeur: c.value })),
      });
    } catch {
      // Une fiche illisible est passée, jamais devinée.
    }
  }
  enregistrer(cles.size, fiches.length, null);
  return fiches;
}

/** Les fichiers de lecture se posent ici, réservés au compte du démon. */
const DOSSIER_DES_LECTURES = path.join(os.tmpdir(), 'beluga-belugapass');
const DUREE_D_UN_FICHIER_MS = 10 * 60 * 1000;

/**
 * POUR L'OUTIL « coffre_fort » : lit les coffres ouverts, garde celles qui répondent à la recherche, et les dépose dans
 * un fichier temporaire (0600) effacé au bout de dix minutes. Rend la phrase à ajouter à la réponse de l'outil —
 * un chemin et un compte, jamais une valeur.
 */
export async function lectureDesAgentsPourLOutil(agent: string, recherche: string): Promise<string | null> {
  if (!accesDesAgentsOuvert()) return null;
  let fiches: FicheBelugaPass[];
  try {
    fiches = await lireLesCoffres(agent);
  } catch (err) {
    return `\nBELUGA PASS : lecture impossible — ${(err as Error).message}`;
  }
  const mots = recherche.toLowerCase().split(/\s+/).filter(Boolean);
  const retenues = mots.length
    ? fiches.filter((f) => {
        const texte = [f.coffre, f.titre, f.type, ...f.urls, f.champs.username ?? '', f.champs.service ?? '', f.champs.host ?? ''].join(' ').toLowerCase();
        return mots.every((m) => texte.includes(m));
      })
    : fiches;
  if (!retenues.length) return `\nBELUGA PASS (lecture seule) : aucune fiche${mots.length ? ` ne correspond à « ${recherche} »` : ''} dans les coffres ouverts aux agents.`;
  fs.mkdirSync(DOSSIER_DES_LECTURES, { recursive: true, mode: 0o700 });
  const fichier = path.join(DOSSIER_DES_LECTURES, `lecture-${crypto.randomBytes(8).toString('hex')}.json`);
  fs.writeFileSync(fichier, JSON.stringify(retenues, null, 1), { mode: 0o600 });
  setTimeout(() => fs.rm(fichier, { force: true }, () => {}), DUREE_D_UN_FICHIER_MS).unref?.();
  return `\nBELUGA PASS (lecture seule, ${retenues.length} fiche(s) des coffres ouverts aux agents) : lis-les dans le fichier ${fichier} (effacé dans dix minutes). Ne recopie jamais ces valeurs dans une réponse, un fichier du dépôt ou la mémoire.`;
}

/** Au démarrage : les fichiers de lecture d'avant l'arrêt s'effacent. */
export function nettoyerLesLectures(): void {
  fs.rm(DOSSIER_DES_LECTURES, { recursive: true, force: true }, () => {});
}
