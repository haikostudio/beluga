/**
 * LE PILOTAGE DE CHROME PAR BELUGA — côté démon (carte « Pilotage de Chrome par Beluga », 09/11/2026).
 *
 * Les règles pures vivent dans `shared/src/extension-chrome.ts`. Ici :
 *
 *  1. LA LIAISON (compétence `cle-appareil-signee-raccourci-sans-session`) : un code à six chiffres, émis AVEC
 *     session depuis Réglages → Extension, échangé une seule fois contre une clé d'appareil. AUCUN secret en base :
 *     il se recalcule (HMAC du secret du serveur). « Délier » révoque.
 *  2. LA VOIE `/ws/chrome` : ouverte par l'extension, signée (horodatage + signature), non rejouable (un seul
 *     UPDATE fait la révocation ET l'anti-rejeu), JAMAIS par témoin de session. Le Chrome est rattaché au compte qui
 *     l'a relié : un agent n'utilise que les Chrome de la personne qui lui parle (`interlocuteurDeLAgent`).
 *  3. LE RELAIS : un geste de l'outil « chrome » part au Chrome choisi et sa réponse revient, corrélée par numéro.
 *  4. LE PANNEAU LATÉRAL : la conversation des agents de CE Chrome lui est poussée ; ses commandes (répondre,
 *     écrire, arrêter) passent par les MÊMES portes que l'application (`commandeDUnAppareil`, `ws.ts`).
 *  5. LE FILM DE LA SESSION : une image après chaque geste qui agit, assemblée en vidéo à la fin du tour.
 *  6. LES GESTES RÉPÉTÉS : un passage par minute ; une routine échue part si son Chrome est en ligne, sinon attend.
 *  7. LES COMPARAISONS AVANT / APRÈS : la référence d'une page de projet, gardée sur le disque de stockage.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { WebSocketServer, WebSocket } from 'ws';
import {
  BATTEMENT_EXTENSION_MS,
  CHROME_RELIES_MAX,
  DUREE_CODE_LIAISON_MS,
  HORS_LIGNE_APRES_MS,
  VERSION_EXTENSION_CHROME,
  adresseDeComparaison,
  codeDeLiaisonValide,
  demandeDeLaRoutine,
  demandeInitialeDeLaCarte,
  echeanceApresDepart,
  fluxDuTour,
  imagesDeLAgentPourLePanneau,
  heureDeLaReponse,
  piecesDuPanneau,
  pointClicDuNom,
  identifiantDAppareil,
  lireIdentifiantDAppareil,
  messageASigner,
  phraseDuReglage,
  phraseDuSecretDAppareil,
  prochaineEcheanceDeRoutine,
  projetDeLAdresse,
  reglageDepuisLInstant,
  retardEnJours,
  routineAPartir,
  sansBlocDeChiffrage,
  signatureFraiche,
  type ChromeRelie,
  type CompteUtilisateur,
  type EtatDeLExtension,
  type FrequenceDeRoutine,
  type Message,
  type ModeDeSite,
  type ReglageDeRoutine,
  type RoutineChrome,
  type ServerEvent,
  type SiteDuChrome,
  LIBELLE_DU_NAVIGATEUR,
  genreDeNavigateur,
  nomProposeDepuisLaPlateforme,
  type GenreDeNavigateur,
} from '@beluga/shared';
import { creerUnOrdinateur, ligneDOrdinateur } from './ordinateurs.js';
import { getDb, getMeta, setMeta } from './db.js';
import { bus } from './bus.js';
import { log } from './logger.js';
import { PATHS } from './config.js';
import * as store from './store.js';
import { entreesDuTour } from './journal-carte.js';

/* ------------------------------------------------------------------ */
/* 1. Le secret du serveur et la liaison                                */
/* ------------------------------------------------------------------ */

const CLE_SECRET = 'extension-chrome.secret';
let secretEnMemoire: string | null = null;

function secretDuServeur(): string {
  if (secretEnMemoire) return secretEnMemoire;
  let s = getMeta(CLE_SECRET);
  if (!s) {
    s = crypto.randomBytes(48).toString('base64url');
    setMeta(CLE_SECRET, s);
  }
  return (secretEnMemoire = s);
}

/** Le secret d'un Chrome : recalculé à chaque fois, jamais écrit. */
export function secretDeLAppareil(cle: { compteId: string; id: string; nonce: string }): string {
  return crypto.createHmac('sha256', secretDuServeur()).update(phraseDuSecretDAppareil(cle)).digest('base64url');
}

export function signer(secret: string, message: string): string {
  return crypto.createHmac('sha256', secret).update(message).digest('base64url');
}

function empreinte(texte: string): string {
  return crypto.createHash('sha256').update(texte).digest('hex');
}

/** Un code de liaison neuf : l'ancien de ce compte meurt, seul son condensé est gardé. */
export function emettreUnCodeDeLiaison(
  compteId: string,
  maintenant = Date.now(),
  cible: { ordinateurId?: string | null; nom?: string | null } = {},
): { code: string; expireLe: number } {
  const db = getDb();
  db.prepare('DELETE FROM chrome_codes WHERE compte_id = ? OR expire_le < ?').run(compteId, maintenant);
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const expireLe = maintenant + DUREE_CODE_LIAISON_MS;
  /* Le code peut viser un ordinateur DÉJÀ nommé (« Relier un navigateur » sur sa ligne) : le navigateur s'y rattache. */
  db.prepare('INSERT OR REPLACE INTO chrome_codes (empreinte, compte_id, expire_le, ordinateur_id, nom) VALUES (?, ?, ?, ?, ?)').run(
    empreinte(code),
    compteId,
    expireLe,
    cible.ordinateurId ?? null,
    cible.nom ?? null,
  );
  return { code, expireLe };
}

/* Six chiffres se devinent : dix essais par minute et par adresse, pas un de plus. */
const essais = new Map<string, number[]>();
function tropDEssais(adresse: string, maintenant: number): boolean {
  const recents = (essais.get(adresse) ?? []).filter((t) => maintenant - t < 60_000);
  recents.push(maintenant);
  essais.set(adresse, recents);
  return recents.length > 10;
}

export type ResultatDeLiaison = { ok: true; identifiant: string; secret: string; nom: string } | { ok: false; raison: string };

/** L'extension échange le code contre sa clé. Le code meurt dans le même geste (usage unique). */
export function relierUnChrome(
  demande: { code?: unknown; nom?: unknown; version?: unknown; navigateur?: unknown },
  adresse: string,
  maintenant = Date.now(),
): ResultatDeLiaison {
  if (tropDEssais(adresse, maintenant)) return { ok: false, raison: 'Trop d’essais : patientez une minute.' };
  const code = String(demande.code ?? '').replace(/\s+/g, '');
  if (!codeDeLiaisonValide(code)) return { ok: false, raison: 'Le code a six chiffres.' };
  const db = getDb();
  const ligne = db
    .prepare('DELETE FROM chrome_codes WHERE empreinte = ? AND expire_le >= ? RETURNING compte_id, ordinateur_id, nom')
    .get(empreinte(code), maintenant) as { compte_id: string; ordinateur_id: string | null; nom: string | null } | undefined;
  if (!ligne) return { ok: false, raison: 'Code inconnu ou expiré : affichez-en un nouveau dans Réglages → Extension.' };
  const vivants = db.prepare('SELECT COUNT(*) AS n FROM chrome_appareils WHERE compte_id = ? AND revoque_le IS NULL').get(ligne.compte_id) as { n: number };
  if (vivants.n >= CHROME_RELIES_MAX) return { ok: false, raison: `Déjà ${CHROME_RELIES_MAX} Chrome reliés : déliez-en un dans Réglages → Extension.` };
  const id = crypto.randomBytes(9).toString('base64url');
  const nonce = crypto.randomBytes(12).toString('base64url');
  const genre = genreDeNavigateur(demande.navigateur);
  const nom = String(demande.nom ?? '').trim().slice(0, 60) || LIBELLE_DU_NAVIGATEUR[genre];
  const version = String(demande.version ?? '').slice(0, 20) || null;
  /* L'ORDINATEUR : celui visé par le code s'il est encore au compte, sinon un neuf — au nom choisi en émettant le
     code, ou à celui de la plateforme (« Mac »). La personne le renomme à tout moment. */
  const ordinateur =
    ligneDOrdinateur(ligne.compte_id, ligne.ordinateur_id)?.id ??
    creerUnOrdinateur(ligne.compte_id, ligne.nom || nomProposeDepuisLaPlateforme(nom), maintenant).id;
  db.prepare(
    'INSERT INTO chrome_appareils (id, compte_id, nonce, nom, version, cree_le, vu_le, ordinateur_id, navigateur) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, ligne.compte_id, nonce, nom, version, maintenant, maintenant, ordinateur, genre);
  const cle = { compteId: ligne.compte_id, id, nonce };
  bus.emit({ type: 'extension.change' });
  return { ok: true, identifiant: identifiantDAppareil(cle), secret: secretDeLAppareil(cle), nom };
}

/**
 * LA VOIE S'OUVRE-T-ELLE ? Tout ce qui se juge sans base d'abord (forme, fraîcheur, signature), puis UNE
 * instruction qui fait la révocation ET l'anti-rejeu (horodatage strictement croissant).
 */
export function verifierLaVoie(
  params: { id?: string | null; ts?: string | null; sig?: string | null },
  maintenant = Date.now(),
): { appareilId: string; compteId: string } | null {
  const cle = lireIdentifiantDAppareil(params.id);
  const ts = Number(params.ts);
  if (!cle || !Number.isInteger(ts) || !signatureFraiche(ts, maintenant) || typeof params.sig !== 'string') return null;
  const attendue = signer(secretDeLAppareil(cle), messageASigner(ts, params.id!, ''));
  const a = Buffer.from(attendue);
  const b = Buffer.from(params.sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const ligne = getDb()
    .prepare(
      'UPDATE chrome_appareils SET dernier_ts = ?, vu_le = ? WHERE id = ? AND compte_id = ? AND nonce = ? AND revoque_le IS NULL AND dernier_ts < ? RETURNING id',
    )
    .get(ts, maintenant, cle.id, cle.compteId, cle.nonce, ts) as { id: string } | undefined;
  if (!ligne) return null;
  return { appareilId: cle.id, compteId: cle.compteId };
}

interface LigneAppareil {
  id: string;
  compte_id: string;
  nom: string;
  ordinateur_id: string | null;
  navigateur: string | null;
  version: string | null;
  cree_le: number;
  vu_le: number | null;
  revoque_le: number | null;
  incognito?: number | null;
  extension_id?: string | null;
}

function appareilsDuCompte(compteId: string): LigneAppareil[] {
  return getDb()
    .prepare('SELECT * FROM chrome_appareils WHERE compte_id = ? AND revoque_le IS NULL ORDER BY cree_le')
    .all(compteId) as LigneAppareil[];
}

/** Y a-t-il un Chrome relié quelque part ? L'outil n'est servi aux agents qu'à cette condition (jetons). */
export function unChromeEstRelie(): boolean {
  try {
    return !!getDb().prepare('SELECT 1 FROM chrome_appareils WHERE revoque_le IS NULL LIMIT 1').get();
  } catch {
    return false;
  }
}

export function chromesDuCompte(compteId: string): ChromeRelie[] {
  return appareilsDuCompte(compteId).map((a) => ({
    id: a.id,
    nom: a.nom,
    version: connexions.get(a.id)?.version ?? a.version,
    incognito: connexions.get(a.id)?.incognito ?? (a.incognito === 1 ? true : a.incognito === 0 ? false : null),
    creeLe: a.cree_le,
    vuLe: connexions.has(a.id) ? Date.now() : a.vu_le,
    enLigne: chromeEnLigne(a.id),
    agentsAuTravail: [...sessions.values()].filter((s) => s.appareilId === a.id && agentAuTravail(s.agentId)).length,
    ordinateurId: a.ordinateur_id ?? null,
    genre: genreDeNavigateur(a.navigateur),
  }));
}

/** Chrome ou Safari, pour un navigateur relié (le démon refuse proprement ce que Safari ne sait pas faire). */
export function genreDuNavigateur(appareilId: string): GenreDeNavigateur {
  const ligne = getDb().prepare('SELECT navigateur FROM chrome_appareils WHERE id = ?').get(appareilId) as { navigateur: string | null } | undefined;
  return genreDeNavigateur(ligne?.navigateur);
}

export function delierUnChrome(compteId: string, id: string): boolean {
  const fait = getDb().prepare('UPDATE chrome_appareils SET revoque_le = ? WHERE id = ? AND compte_id = ? AND revoque_le IS NULL').run(Date.now(), id, compteId);
  const connexion = connexions.get(id);
  if (connexion && connexion.compteId === compteId) connexion.ws.close(4001, 'délié');
  bus.emit({ type: 'extension.change' });
  return fait.changes > 0;
}

/* ------------------------------------------------------------------ */
/* Les sites                                                            */
/* ------------------------------------------------------------------ */

export function modeDuSite(compteId: string, origine: string): ModeDeSite | null {
  const ligne = getDb().prepare('SELECT mode FROM chrome_sites WHERE compte_id = ? AND origine = ?').get(compteId, origine) as { mode: ModeDeSite } | undefined;
  return ligne?.mode ?? null;
}

export function reglerLeSite(compteId: string, origine: string, mode: ModeDeSite | null, appareilId?: string | null): void {
  const db = getDb();
  if (!mode) db.prepare('DELETE FROM chrome_sites WHERE compte_id = ? AND origine = ?').run(compteId, origine);
  else
    db.prepare(
      'INSERT INTO chrome_sites (compte_id, origine, mode, appareil_id, decide_le) VALUES (?, ?, ?, ?, ?) ON CONFLICT(compte_id, origine) DO UPDATE SET mode = excluded.mode, decide_le = excluded.decide_le',
    ).run(compteId, origine, mode, appareilId ?? null, Date.now());
  bus.emit({ type: 'extension.change' });
}

function sitesDuCompte(compteId: string): SiteDuChrome[] {
  const noms = new Map(appareilsDuCompte(compteId).map((a) => [a.id, a.nom]));
  return (
    getDb().prepare('SELECT * FROM chrome_sites WHERE compte_id = ? ORDER BY decide_le DESC').all(compteId) as {
      origine: string;
      mode: ModeDeSite;
      appareil_id: string | null;
      decide_le: number;
    }[]
  ).map((s) => ({ origine: s.origine, mode: s.mode, chromeId: s.appareil_id, chromeNom: s.appareil_id ? (noms.get(s.appareil_id) ?? null) : null, decideLe: s.decide_le }));
}

export async function etatDeLExtension(compte: Pick<CompteUtilisateur, 'id'>): Promise<EtatDeLExtension> {
  const { ordinateursDuCompte } = await import('./ordinateurs.js');
  const { paquetSafari } = await import('./extension-safari.js');
  const safari = paquetSafari();
  return {
    version: VERSION_EXTENSION_CHROME,
    chromes: chromesDuCompte(compte.id),
    ordinateurs: await ordinateursDuCompte(compte.id),
    safari: { disponible: !!safari, version: safari?.version ?? null },
    sites: sitesDuCompte(compte.id),
    routines: routinesDuCompte(compte.id),
  };
}

/* ------------------------------------------------------------------ */
/* Le Chrome retenu par carte (ou par agent sans carte)                 */
/* ------------------------------------------------------------------ */

function cleDeTravail(agentId: string, cardId?: string | null): string {
  return cardId ? `carte:${cardId}` : `agent:${agentId}`;
}

export function chromeRetenu(agentId: string, cardId?: string | null): string | null {
  const ligne = getDb().prepare('SELECT appareil_id FROM chrome_cartes WHERE cle = ?').get(cleDeTravail(agentId, cardId)) as { appareil_id: string | null } | undefined;
  return ligne?.appareil_id ?? null;
}

export function retenirLeChrome(agentId: string, cardId: string | null | undefined, appareilId: string, onglet?: { id: number; url: string } | null): void {
  getDb()
    .prepare(
      `INSERT INTO chrome_cartes (cle, appareil_id, onglet_confie, onglet_url, maj_le) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(cle) DO UPDATE SET appareil_id = excluded.appareil_id, maj_le = excluded.maj_le,
         onglet_confie = COALESCE(excluded.onglet_confie, chrome_cartes.onglet_confie), onglet_url = COALESCE(excluded.onglet_url, chrome_cartes.onglet_url)`,
    )
    .run(cleDeTravail(agentId, cardId), appareilId, onglet?.id ?? null, onglet?.url ?? null, Date.now());
  if (cardId) cartesDuChrome.set(cardId, appareilId);
}

/** L'onglet confié à la carte à sa naissance (demande lancée depuis le panneau) : rendu une fois, puis oublié. */
export function ongletConfie(agentId: string, cardId?: string | null): number | null {
  const cle = cleDeTravail(agentId, cardId);
  const ligne = getDb().prepare('SELECT onglet_confie FROM chrome_cartes WHERE cle = ?').get(cle) as { onglet_confie: number | null } | undefined;
  return ligne?.onglet_confie ?? null;
}

/** Les cartes nées ou travaillées dans un Chrome, pour le panneau (cache relu au démarrage). */
const cartesDuChrome = new Map<string, string>();
function chargerLesCartes(): void {
  try {
    const lignes = getDb().prepare("SELECT cle, appareil_id FROM chrome_cartes WHERE cle LIKE 'carte:%' AND maj_le > ?").all(Date.now() - 7 * 86_400_000) as {
      cle: string;
      appareil_id: string | null;
    }[];
    for (const l of lignes) if (l.appareil_id) cartesDuChrome.set(l.cle.slice(6), l.appareil_id);
  } catch {
    /* base pas encore migrée : rien à relire */
  }
}

/* ------------------------------------------------------------------ */
/* 2. La voie et les connexions                                         */
/* ------------------------------------------------------------------ */

interface Attente {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  minuterie: NodeJS.Timeout;
}

interface Connexion {
  ws: WebSocket;
  appareilId: string;
  compteId: string;
  version: string | null;
  /** Autorisée en navigation privée, telle que l'extension le dit (1.0.11 et plus) ; `null` sinon. */
  incognito: boolean | null;
  vu: number;
  attentes: Map<string, Attente>;
}

const connexions = new Map<string, Connexion>();

export function chromeEnLigne(appareilId: string): boolean {
  const c = connexions.get(appareilId);
  return !!c && c.ws.readyState === WebSocket.OPEN && Date.now() - c.vu < HORS_LIGNE_APRES_MS;
}

/** Un Chrome relié est-il EN LIGNE en ce moment (ordinateur allumé, extension connectée) ? */
export function unChromeEstEnLigne(): boolean {
  return [...connexions.keys()].some((id) => chromeEnLigne(id));
}

/**
 * LES CHROME ALLUMÉS DONT L'EXTENSION EST TROP ANCIENNE pour une fenêtre privée (audit GEO, 19/11/2026) : leur nom et
 * leur version, pour dire quoi mettre à jour. Vide quand au moins un Chrome allumé est à jour (`aJour`).
 */
export function chromesAllumesTropAnciens(aJour: (version: string | null) => boolean): { aJour: boolean; tropAnciens: string[]; sansAutorisation: boolean } {
  const allumes = [...connexions.values()].filter((c) => chromeEnLigne(c.appareilId));
  const capables = allumes.filter((c) => aJour(c.version));
  /* À jour, mais l'extension DIT ne pas être autorisée en navigation privée (1.0.11 et plus) : la séance attend la case. */
  if (capables.length && capables.every((c) => c.incognito === false)) return { aJour: true, tropAnciens: [], sansAutorisation: true };
  if (capables.length) return { aJour: true, tropAnciens: [], sansAutorisation: false };
  const noms = new Map<string, string>();
  try {
    for (const l of getDb().prepare('SELECT id, nom FROM chrome_appareils WHERE revoque_le IS NULL').all() as { id: string; nom: string }[]) noms.set(l.id, l.nom);
  } catch {
    /* sans base lisible, on dit seulement la version */
  }
  return { aJour: false, tropAnciens: allumes.map((c) => `« ${noms.get(c.appareilId) ?? 'Chrome'} » (version ${c.version ?? 'inconnue'})`), sansAutorisation: false };
}

function envoyer(c: Connexion, message: unknown): void {
  if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(message));
}

/**
 * UN GESTE PART AU CHROME ET SA RÉPONSE REVIENT. Le message n'est écrit nulle part : il porte parfois les valeurs
 * d'une fiche du coffre (connexion), qui ne doivent exister qu'en mémoire, le temps du geste.
 */
export function demanderAuChrome<T = any>(appareilId: string, geste: string, args: Record<string, unknown>, delaiMs = 60_000): Promise<T> {
  const c = connexions.get(appareilId);
  if (!c || c.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Ce Chrome est fermé en ce moment : demande à la personne de l’ouvrir.'));
  const id = crypto.randomBytes(6).toString('hex');
  return new Promise<T>((resolve, reject) => {
    const minuterie = setTimeout(() => {
      c.attentes.delete(id);
      reject(new Error(`Chrome n’a pas répondu au geste « ${geste} » à temps.`));
    }, delaiMs);
    c.attentes.set(id, { resolve, reject, minuterie });
    envoyer(c, { type: 'geste', id, geste, args });
  });
}

/** Un message au panneau d'un Chrome (événement, pas de réponse attendue). */
export function pousserAuChrome(appareilId: string, message: unknown): void {
  const c = connexions.get(appareilId);
  if (c) envoyer(c, message);
}

export function attacherLaVoieChrome(): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 24 * 1024 * 1024 });
  wss.on('connection', (ws: WebSocket, _req: http.IncomingMessage, porte: { appareilId: string; compteId: string }) => {
    const ancienne = connexions.get(porte.appareilId);
    if (ancienne) ancienne.ws.close(4000, 'remplacée');
    const c: Connexion = { ws, appareilId: porte.appareilId, compteId: porte.compteId, version: null, incognito: null, vu: Date.now(), attentes: new Map() };
    connexions.set(porte.appareilId, c);
    bus.emit({ type: 'extension.change' });
    envoyer(c, { type: 'bienvenue', version: VERSION_EXTENSION_CHROME, battementMs: BATTEMENT_EXTENSION_MS, langue: String(store.readPreference('langue') ?? 'fr') });
    /* Une routine qui attendait ce Chrome part maintenant (décision du 09/11/2026). */
    setTimeout(() => void tourneeDesRoutines().catch(() => {}), 2_000).unref();

    ws.on('message', (brut) => {
      c.vu = Date.now();
      let m: any;
      try {
        m = JSON.parse(brut.toString());
      } catch {
        return;
      }
      void recevoir(c, m).catch((err) => log.warn('extension Chrome : message refusé', String((err as Error)?.message ?? err)));
    });
    ws.on('close', () => {
      if (connexions.get(c.appareilId) === c) connexions.delete(c.appareilId);
      for (const attente of c.attentes.values()) {
        clearTimeout(attente.minuterie);
        attente.reject(new Error('Chrome s’est fermé pendant le geste.'));
      }
      c.attentes.clear();
      try {
        getDb().prepare('UPDATE chrome_appareils SET vu_le = ? WHERE id = ?').run(Date.now(), c.appareilId);
      } catch {
        /* base fermée à l'arrêt */
      }
      bus.emit({ type: 'extension.change' });
    });
  });
  chargerLesCartes();
  bus.subscribe(relayerAuxPanneaux);
  return wss;
}

async function recevoir(c: Connexion, m: any): Promise<void> {
  if (!m || typeof m.type !== 'string') return;
  if (m.type === 'ping') return envoyer(c, { type: 'pong', at: Date.now() });
  if (m.type === 'bonjour') {
    c.version = typeof m.version === 'string' ? m.version.slice(0, 20) : null;
    const nom = typeof m.nom === 'string' && m.nom.trim() ? m.nom.trim().slice(0, 60) : null;
    /* 1.0.11 : l'autorisation de navigation privée et l'identifiant de l'extension (absents avant : NULL gardé). */
    c.incognito = typeof m.incognito === 'boolean' ? m.incognito : null;
    const extensionId = typeof m.extensionId === 'string' && /^[a-p]{32}$/.test(m.extensionId) ? m.extensionId : null;
    getDb()
      .prepare('UPDATE chrome_appareils SET version = COALESCE(?, version), nom = COALESCE(?, nom), incognito = ?, extension_id = COALESCE(?, extension_id) WHERE id = ?')
      .run(c.version, nom, c.incognito === null ? null : c.incognito ? 1 : 0, extensionId, c.appareilId);
    bus.emit({ type: 'extension.change' });
    void import('./mise-a-jour-extension.js').then((m2) => m2.chromeRevenu(c.appareilId, c.version)).catch(() => {});
    return;
  }
  if (m.type === 'resultat' && typeof m.id === 'string') {
    const attente = c.attentes.get(m.id);
    if (!attente) return;
    c.attentes.delete(m.id);
    clearTimeout(attente.minuterie);
    if (m.ok) attente.resolve(m.data ?? {});
    else attente.reject(new Error(String(m.erreur ?? 'geste impossible')));
    return;
  }
  if (m.type === 'cmd' && typeof m.id === 'string') {
    try {
      const data = await commandeDuPanneau(c, m.cmd ?? {});
      envoyer(c, { type: 'ack', id: m.id, ok: true, data });
    } catch (err: any) {
      envoyer(c, { type: 'ack', id: m.id, ok: false, error: String(err?.message ?? err) });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Les sessions des agents dans Chrome                                  */
/* ------------------------------------------------------------------ */

export interface SessionChrome {
  agentId: string;
  cardId: string | null;
  projectId: string;
  appareilId: string;
  titre: string;
  /** La personne a pris la main : le prochain geste de l'agent attend « Rendre la main ». */
  main: boolean;
  /** Les origines accordées « cette fois seulement », pour ce tour. */
  cetteFois: Set<string>;
  couleur: string;
  vu: number;
  /** Un tour a agi dans Chrome depuis la dernière fin de tour : son film reste à assembler. */
  tourOuvert: boolean;
}

const COULEURS_DE_GROUPE = ['purple', 'cyan', 'green', 'orange', 'pink', 'blue', 'yellow', 'red'] as const;
const sessions = new Map<string, SessionChrome>();

export function sessionDeLAgent(agentId: string): SessionChrome | undefined {
  return sessions.get(agentId);
}

export function ouvrirLaSession(agent: { id: string; cardId?: string | null; projectId: string; title?: string }, appareilId: string): SessionChrome {
  const existante = sessions.get(agent.id);
  if (existante && existante.appareilId === appareilId) {
    existante.vu = Date.now();
    existante.tourOuvert = true;
    return existante;
  }
  const carte = agent.cardId ? store.getCard(agent.cardId) : null;
  const dejaPrises = new Set([...sessions.values()].filter((s) => s.appareilId === appareilId).map((s) => s.couleur));
  const couleur = COULEURS_DE_GROUPE.find((c) => !dejaPrises.has(c)) ?? COULEURS_DE_GROUPE[sessions.size % COULEURS_DE_GROUPE.length]!;
  const session: SessionChrome = {
    agentId: agent.id,
    cardId: agent.cardId ?? null,
    projectId: agent.projectId,
    appareilId,
    titre: (carte?.title ?? agent.title ?? 'Agent').slice(0, 40),
    main: false,
    cetteFois: new Set(),
    couleur,
    vu: Date.now(),
    tourOuvert: true,
  };
  sessions.set(agent.id, session);
  pousserAuChrome(appareilId, { type: 'evenement', genre: 'agents' });
  return session;
}

function agentAuTravail(agentId: string): boolean {
  const statut = store.getAgent(agentId)?.status;
  return statut === 'running' || statut === 'starting';
}

/** « Je prends la main » / « Rendre la main » : depuis le panneau, une option d'une question, ou l'agent. */
export function prendreLaMain(agentId: string, prise: boolean): boolean {
  const s = sessions.get(agentId);
  if (!s) return false;
  s.main = prise;
  pousserAuChrome(s.appareilId, { type: 'evenement', genre: 'agents' });
  if (prise) void demanderAuChrome(s.appareilId, 'detacher', { agentId }).catch(() => {});
  return true;
}

/* ------------------------------------------------------------------ */
/* 4. Le panneau latéral                                                */
/* ------------------------------------------------------------------ */

/** Les étapes d'un tour que le panneau peut déplier : les dernières, le nombre total voyage à part. */
const ETAPES_DU_PANNEAU = 40;

/**
 * Ce que le panneau montre d'un message : le texte, les questions, les pièces, les étapes du tour et les suites
 * proposées par l'agent. Le bloc de CHIFFRAGE (```json … "machineSeconds" …) est retiré ici, à l'affichage seulement :
 * le panneau est en JavaScript pur, sans accès aux règles partagées, et le texte en base reste intact.
 */
export function messagePourLePanneau(m: Message): Record<string, unknown> {
  const etapes = m.steps ?? [];
  const lirePiece = (id: string) => {
    const p = store.getAttachment(id);
    return p ? { id: p.id, nom: p.name, mime: p.mime, createdAt: p.createdAt } : { id, nom: 'pièce', mime: '' };
  };
  return {
    flux: m.role === 'assistant' ? fluxPourLePanneau(m, lirePiece) : undefined,
    id: m.id,
    agentId: m.agentId,
    role: m.role,
    contenu: sansBlocDeChiffrage(m.content ?? '').slice(0, 6000),
    streaming: m.streaming,
    creeLe: (m as { createdAt?: number }).createdAt ?? null,
    rendueLe: m.role === 'assistant' ? heureDeLaReponse({ createdAt: (m as { createdAt?: number }).createdAt, etapes: etapes }) : null,
    nbEtapes: etapes.length,
    etapes: etapes.slice(-ETAPES_DU_PANNEAU).map((e) => ({ label: e.label, etat: e.state, outil: e.outil ?? null })),
    suites: (m.suites ?? []).slice(0, 3).map((x) => ({ titre: x.titre, description: x.description ?? '' })),
    pieces: (m.attachments ?? []).slice(0, 8).map((id) => {
      const p = store.getAttachment(id);
      return p ? { id: p.id, nom: p.name, mime: p.mime, creeLe: p.createdAt } : { id, nom: 'pièce', mime: '' };
    }),
    questions: (m.questions ?? []).map((q) => ({
      id: q.id,
      question: q.question,
      description: q.description ?? '',
      kind: q.kind,
      options: q.options.map((o) => ({ id: o.id, label: o.label, description: o.description ?? '' })),
      allowFreeText: q.allowFreeText,
      answer: q.answer ?? null,
    })),
  };
}

/**
 * LE FIL D'UN TOUR DANS L'ORDRE RÉEL (`fluxDuTour`, règle partagée) : notes, groupes d'actions, captures à leur
 * place, questions à leur rang, réponse en dernier. Chaque élément porte ce que le panneau rend, sans autre appel.
 */
function fluxPourLePanneau(m: Message, lirePiece: (id: string) => { id: string; nom: string; mime: string; createdAt?: number }): unknown[] {
  const cardId = store.getAgent(m.agentId)?.cardId ?? '';
  const pieces = (m.attachments ?? []).slice(-24).map(lirePiece);
  const flux = fluxDuTour({
    contenu: sansBlocDeChiffrage(m.content ?? ''),
    journal: cardId ? entreesDuTour(cardId, m.id) : [],
    etapes: (m.steps ?? []).map((e) => ({ id: e.id, label: e.label, state: e.state, outil: e.outil, entree: e.entree, startedAt: e.startedAt, capturePiece: e.capturePiece })),
    questions: (m.questions ?? []).map((q) => ({ id: q.id, question: q.question, poseeLe: q.poseeLe })),
    pieces,
  });
  const parId = new Map(pieces.map((p) => [p.id, p]));
  return flux.map((e) => {
    if (e.sorte === 'texte') return { sorte: 'texte', texte: e.texte.slice(0, 6000) };
    if (e.sorte === 'capture') {
      const p = parId.get(e.piece) ?? lirePiece(e.piece);
      const pointClic = pointClicDuNom(p.nom);
      return { sorte: 'capture', piece: { id: p.id, nom: p.nom, mime: p.mime, creeLe: p.createdAt ?? null }, ...(pointClic ? { pointClic } : {}) };
    }
    return e;
  });
}

/** Les agents dont la conversation regarde CE Chrome : ceux qui y travaillent, et les cartes qui y sont nées. */
function agentsDuChrome(appareilId: string): string[] {
  const ids = new Set<string>();
  for (const s of sessions.values()) if (s.appareilId === appareilId && Date.now() - s.vu < 12 * 3_600_000) ids.add(s.agentId);
  for (const [cardId, a] of cartesDuChrome) {
    if (a !== appareilId) continue;
    const carte = store.getCard(cardId);
    if (carte?.agentId && !['archived'].includes(String(carte.column))) ids.add(carte.agentId);
  }
  return [...ids];
}

function agentRegardeLeChrome(agentId: string, appareilId: string): boolean {
  if (sessions.get(agentId)?.appareilId === appareilId) return true;
  const cardId = store.getAgent(agentId)?.cardId;
  return !!cardId && cartesDuChrome.get(cardId) === appareilId;
}

function relayerAuxPanneaux(event: ServerEvent): void {
  if (!connexions.size) return;
  const e = event as { type: string; message?: Message; agent?: { id: string } };
  if (e.type === 'message.upsert' && e.message) {
    for (const c of connexions.values()) {
      if (agentRegardeLeChrome(e.message.agentId, c.appareilId)) envoyer(c, { type: 'evenement', genre: 'message', message: messagePourLePanneau(e.message) });
    }
  } else if (e.type === 'agent.upsert' && e.agent) {
    for (const c of connexions.values()) if (agentRegardeLeChrome(e.agent.id, c.appareilId)) envoyer(c, { type: 'evenement', genre: 'agents' });
    if (sessions.get(e.agent.id)?.tourOuvert && !agentAuTravail(e.agent.id)) void finirLaSession(e.agent.id);
  } else if (e.type === 'journal.entree') {
    /* UNE NOTE DE L'AGENT S'ÉCRIT AU JOURNAL SANS TOUCHER AU MESSAGE : on renvoie le message de son tour, pour que
       la phrase paraisse à son rang tout de suite, et non au prochain mouvement du tour. */
    const entree = (event as { entree?: { tourId?: string; agentId?: string; nature?: string } }).entree;
    if (!entree?.tourId || !entree.agentId || entree.nature !== 'jalon') return;
    const regardent = [...connexions.values()].filter((c) => agentRegardeLeChrome(entree.agentId!, c.appareilId));
    if (!regardent.length) return;
    const message = store.getMessage(entree.tourId);
    if (!message) return;
    for (const c of regardent) envoyer(c, { type: 'evenement', genre: 'message', message: messagePourLePanneau(message) });
  } else if (e.type === 'queue.etat') {
    const agentId = (event as { agentId?: string }).agentId;
    if (!agentId) return;
    for (const c of connexions.values()) if (agentRegardeLeChrome(agentId, c.appareilId)) envoyer(c, { type: 'evenement', genre: 'file', agentId, file: fileDuPanneau(agentId) });
  } else if (e.type === 'extension.change') {
    for (const c of connexions.values()) envoyer(c, { type: 'evenement', genre: 'reglages' });
  }
}

/** Les messages écrits pendant le travail, dans l'ordre où ils partiront ; les demandes internes (silencieuses) n'y sont pas. */
function fileDuPanneau(agentId: string): { id: string; texte: string; enEdition: boolean }[] {
  return store
    .listQueue(agentId)
    .filter((q) => !q.silencieuse)
    .map((q) => ({ id: q.id, texte: q.text.slice(0, 4000), enEdition: !!q.enEditionDepuis }));
}

function questionsEnAttente(agentId: string): number {
  return store
    .listMessages(agentId, 6)
    .flatMap((m) => m.questions)
    .filter((q) => !q.answer).length;
}

function etatDuPanneau(c: Connexion): Record<string, unknown> {
  const agents = agentsDuChrome(c.appareilId)
    .map((id) => {
      const agent = store.getAgent(id);
      if (!agent) return null;
      const s = sessions.get(id);
      const carte = agent.cardId ? store.getCard(agent.cardId) : null;
      return {
        agentId: id,
        cardId: agent.cardId ?? null,
        titre: carte?.title ?? agent.title,
        projet: store.getProject(agent.projectId)?.name ?? '',
        projectId: agent.projectId,
        statut: agent.status,
        attend: !!agent.attendReponse,
        accords: questionsEnAttente(id),
        main: !!s?.main,
        couleur: s?.couleur ?? null,
      };
    })
    .filter(Boolean);
  return { agents, version: VERSION_EXTENSION_CHROME };
}

/**
 * LES COMMANDES DU PANNEAU. Celles de l'application (répondre, écrire, arrêter) passent par ses MÊMES portes
 * (`commandeDUnAppareil`) avec le compte qui a relié ce Chrome ; les autres ne touchent que ce Chrome.
 */
async function commandeDuPanneau(c: Connexion, cmd: Record<string, any>): Promise<unknown> {
  const { compteParId } = await import('./comptes.js');
  const compte = compteParId(c.compteId);
  if (!compte || !compte.actif) throw new Error('Ce compte n’est plus actif.');
  switch (cmd.type) {
    case 'panneau.etat':
      return etatDuPanneau(c);
    case 'panneau.fil': {
      const agentId = String(cmd.agentId ?? '');
      if (!agentRegardeLeChrome(agentId, c.appareilId)) throw new Error('Cet agent ne travaille pas dans ce Chrome.');
      const agent = store.getAgent(agentId);
      const messages = agent?.cardId ? store.listCardMessages(agent.cardId, 60) : store.listMessages(agentId, 60);
      const fil = messages.slice(-60).map(messagePourLePanneau);
      /* LA PREMIÈRE DEMANDE OUVRE LE FIL : une carte lancée la garde dans sa description, sans message « utilisateur ».
         Elle devient une bulle à droite, en tête — seulement quand le fil part bien du début. */
      const carte = agent?.cardId ? store.getCard(agent.cardId) : null;
      const demande = carte ? demandeInitialeDeLaCarte(carte.description) : '';
      if (demande && messages.length < 60 && messages[0]?.role !== 'user') {
        fil.unshift({ id: `demande-${carte!.id}`, agentId, role: 'user', contenu: demande.slice(0, 6000), creeLe: carte!.createdAt, etapes: [], nbEtapes: 0, pieces: piecesDeLaPersonne(carte!.attachments ?? []), questions: [], suites: [] });
      }
      return { messages: fil, file: fileDuPanneau(agentId), images: imagesDuPanneau(agentId) };
    }
    case 'question.answer':
    case 'agent.prompt':
    case 'agent.stop': {
      const agentId = cmd.type === 'question.answer' ? (store.getMessage(String(cmd.messageId ?? ''))?.agentId ?? '') : String(cmd.agentId ?? '');
      if (!agentRegardeLeChrome(agentId, c.appareilId)) throw new Error('Cet agent ne travaille pas dans ce Chrome.');
      /* « Je prends la main » est une réponse comme une autre, mais elle pose d'abord le drapeau. */
      if (cmd.type === 'question.answer' && String(cmd.answer ?? '').startsWith('Je prends la main')) prendreLaMain(agentId, true);
      /* LES FICHIERS COLLÉS DANS LE CHAMP deviennent des pièces jointes ordinaires de la conversation, puis partent
         avec le message comme depuis Beluga (`attachments`) — file d'attente comprise. */
      if (cmd.type === 'agent.prompt' && cmd.pieces !== undefined) {
        const agent = store.getAgent(agentId)!;
        const ids = await rangerLesPiecesDuPanneau(cmd.pieces, { projectId: agent.projectId, agentId, cardId: agent.cardId ?? undefined });
        const { pieces: _pieces, ...reste } = cmd;
        cmd = { ...reste, attachments: [...(Array.isArray(cmd.attachments) ? cmd.attachments : []), ...ids] };
      }
      const { commandeDUnAppareil } = await import('./ws.js');
      return commandeDUnAppareil(cmd, compte);
    }
    /* LES MESSAGES EN ATTENTE, avec les mêmes gestes que dans Beluga — sur un agent qui regarde CE Chrome. */
    case 'queue.update':
    case 'queue.remove':
    case 'queue.send-now':
    case 'queue.edition': {
      const agentId = store.agentDeLaDemandeEnFile(String(cmd.id ?? ''));
      if (!agentId || !agentRegardeLeChrome(agentId, c.appareilId)) throw new Error('Ce message n’est plus en attente.');
      const { commandeDUnAppareil } = await import('./ws.js');
      return commandeDUnAppareil(cmd, compte);
    }
    case 'main.prendre':
    case 'main.rendre': {
      const agentId = String(cmd.agentId ?? '');
      if (!agentRegardeLeChrome(agentId, c.appareilId)) throw new Error('Cet agent ne travaille pas dans ce Chrome.');
      const fait = prendreLaMain(agentId, cmd.type === 'main.prendre');
      /* Une question « Rendre la main » ouverte se tranche du même clic. */
      if (cmd.type === 'main.rendre') {
        const { repondreALAttente } = await import('./attente-question.js');
        for (const m of store.listMessages(agentId, 4)) {
          for (const q of m.questions) if (!q.answer && q.options.some((o) => o.label === 'Rendre la main')) {
            const { commandeDUnAppareil } = await import('./ws.js');
            await commandeDUnAppareil({ type: 'question.answer', messageId: m.id, questionId: q.id, answer: 'Rendre la main' }, compte).catch(() =>
              repondreALAttente(q.id, 'Rendre la main'),
            );
          }
        }
      }
      return { ok: fait };
    }
    case 'projets.lister': {
      const projets = store
        .listProjects(false)
        .filter((p) => compte.role === 'admin' || compte.projets.includes(p.id))
        .map((p) => ({ id: p.id, nom: p.name }));
      const url = typeof cmd.url === 'string' ? cmd.url : '';
      const reconnu = url ? projetDeLAdresse(store.listProjects(false), url) : null;
      return { projets, reconnu: reconnu && projets.some((p) => p.id === reconnu.id) ? reconnu.id : null, dernier: getMeta(`extension-chrome.dernier-projet.${compte.id}`) };
    }
    case 'demande.creer':
      return creerUneDemande(c, compte, cmd);
    case 'transcrire': {
      const audio = Buffer.from(String(cmd.audio ?? ''), 'base64');
      if (!audio.length || audio.length > 20 * 1024 * 1024) throw new Error('Enregistrement vide ou trop long.');
      const { transcribe } = await import('./voice.js');
      const r = await transcribe(audio, String(cmd.ext ?? 'webm').replace(/[^a-z0-9]/gi, '') || 'webm');
      if (!r.ok) throw new Error((r as { error?: string }).error ?? 'Dictée indisponible.');
      return { texte: (r as { text?: string }).text ?? '' };
    }
    case 'piece.lire': {
      const piece = store.getAttachment(String(cmd.id ?? ''));
      if (!piece || !piece.mime.startsWith('image/') || !pieceVueParLeChrome(piece, c.appareilId)) throw new Error('Pièce introuvable.');
      const { cheminDePieceJointe } = await import('./pieces-jointes.js');
      const fichier = cheminDePieceJointe(piece);
      if (fs.statSync(fichier).size > 4 * 1024 * 1024) throw new Error('Image trop lourde pour le panneau.');
      return { dataUrl: `data:${piece.mime};base64,${fs.readFileSync(fichier).toString('base64')}` };
    }
    case 'comparer':
      return comparerLaPage(compte, cmd);
    case 'routine.creer':
      return creerUneRoutine(compte, { cardId: String(cmd.cardId ?? ''), frequence: cmd.frequence === 'semaine' ? 'semaine' : 'mois', appareilId: c.appareilId });
    default:
      throw new Error('Commande inconnue du panneau.');
  }
}

/* ------------------------------------------------------------------ */
/* Nouvelle demande depuis la page                                      */
/* ------------------------------------------------------------------ */

async function creerUneDemande(c: Connexion, compte: CompteUtilisateur, cmd: Record<string, any>): Promise<{ cardId: string }> {
  const projet = store.getProject(String(cmd.projectId ?? ''));
  if (!projet || (compte.role !== 'admin' && !compte.projets.includes(projet.id))) throw new Error('Projet introuvable.');
  const texte = String(cmd.texte ?? '').trim().slice(0, 8000);
  if (!texte) throw new Error('Écrivez ce que Beluga doit faire.');
  const onglet = cmd.onglet && typeof cmd.onglet === 'object' ? cmd.onglet : null;
  const url = typeof onglet?.url === 'string' ? onglet.url.slice(0, 2000) : '';
  const titreOnglet = typeof onglet?.titre === 'string' ? onglet.titre.slice(0, 200) : '';
  const selection = typeof cmd.selection === 'string' ? cmd.selection.slice(0, 4000) : '';
  const lignes = [texte];
  if (url) lignes.push('', `Onglet confié dans Chrome : « ${titreOnglet || url} » — ${url}. Travaille-le avec l’outil « chrome » (il est déjà dans ton groupe d’onglets).`);
  if (selection) lignes.push('', `Sélection faite par la personne sur la page :\n> ${selection.replace(/\n/g, '\n> ')}`);
  /* Les fichiers collés dans le champ d'abord (refus en clair s'ils sont trop lourds), puis la capture de la page. */
  const pieces: string[] = await rangerLesPiecesDuPanneau(cmd.pieces, { projectId: projet.id });
  if (typeof cmd.capture === 'string' && cmd.capture.startsWith('data:image/')) {
    const piece = await rangerUneImage(projet.id, undefined, undefined, cmd.capture, `page-${Date.now()}.png`).catch(() => null);
    if (piece) pieces.push(piece);
  }
  const { createCard } = await import('./tools.js');
  const carte = createCard(projet.id, {
    title: texte.split('\n')[0]!.slice(0, 70),
    description: lignes.join('\n'),
    origin: 'user',
    attachments: pieces,
    auteur: undefined,
  });
  bus.emit({ type: 'card.upsert', card: carte });
  getDb()
    .prepare('INSERT OR REPLACE INTO chrome_cartes (cle, appareil_id, onglet_confie, onglet_url, maj_le) VALUES (?, ?, ?, ?, ?)')
    .run(`carte:${carte.id}`, c.appareilId, Number.isInteger(onglet?.id) ? onglet.id : null, url || null, Date.now());
  cartesDuChrome.set(carte.id, c.appareilId);
  setMeta(`extension-chrome.dernier-projet.${compte.id}`, projet.id);
  const { noterLInterlocuteur } = await import('./interlocuteur.js');
  noterLInterlocuteur({ cardId: carte.id }, compte);
  /* LA FRAPPE DANS LE PANNEAU VAUT LE GESTE « LANCER » (décision du 08/11/2026) — distinct de la porte API externe
     (MEM-0379), qui ne lance jamais d'office. */
  const { startCard } = await import('./scheduler.js');
  const parti = await startCard(carte.id);
  if (!parti.ok) log.warn(`demande depuis Chrome : carte créée mais pas lancée (${parti.error ?? '?'})`);
  const lancee = store.getCard(carte.id);
  if (lancee?.agentId) noterLInterlocuteur({ agentId: lancee.agentId, cardId: carte.id }, compte);
  pousserAuChrome(c.appareilId, { type: 'evenement', genre: 'agents' });
  return { cardId: carte.id, ...(lancee?.agentId ? { agentId: lancee.agentId } : {}) };
}

/**
 * LES FICHIERS COLLÉS DANS LE CHAMP DU PANNEAU, de tout type : vérifiés (`piecesDuPanneau`, nombre et poids cumulé),
 * puis rangés par le circuit ordinaire des pièces jointes (`joindreUnFichier` : empreinte, plafond, disque de
 * stockage) — aucun second stockage. Rend leurs identifiants, dans l'ordre ; un refus part en erreur, en clair.
 */
async function rangerLesPiecesDuPanneau(brutes: unknown, ou: { projectId: string; agentId?: string; cardId?: string }): Promise<string[]> {
  const lues = piecesDuPanneau(brutes);
  if (!lues.ok) throw new Error(lues.refus);
  if (!lues.pieces.length) return [];
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'beluga-panneau-'));
  const ids: string[] = [];
  try {
    const { joindreUnFichier } = await import('./joindre-fichier.js');
    for (const [i, p] of lues.pieces.entries()) {
      const fichier = path.join(dossier, `${i}-${p.nom}`);
      fs.writeFileSync(fichier, Buffer.from(p.base64, 'base64'));
      const r = await joindreUnFichier({ ...ou, fichier, nom: p.nom });
      if (!r.ok) throw new Error(r.refus);
      ids.push(r.attachment.id);
    }
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
  return ids;
}

/** Les pièces de la personne (bulle de la première demande), comme le panneau les rend. */
function piecesDeLaPersonne(ids: readonly string[]): { id: string; nom: string; mime: string; creeLe: number }[] {
  return ids.slice(0, 8).flatMap((id) => {
    const p = store.getAttachment(id);
    return p ? [{ id: p.id, nom: p.name, mime: p.mime, creeLe: p.createdAt }] : [];
  });
}

/** « Ce que l'agent a vu » : les images rangées par l'agent dans sa conversation (`imagesDeLAgentPourLePanneau`). */
function imagesDuPanneau(agentId: string): { id: string; nom: string; mime: string; creeLe: number }[] {
  const agent = store.getAgent(agentId);
  if (!agent) return [];
  return imagesDeLAgentPourLePanneau(store.listAttachments(agent.projectId), { agentId, cardId: agent.cardId }).map((p) => ({ id: p.id, nom: p.name, mime: p.mime, creeLe: p.createdAt }));
}

/**
 * UNE PIÈCE SE LIT DANS LE PANNEAU quand elle appartient à une conversation qui regarde ce Chrome : celle d'un agent
 * (captures, fichiers collés dans un message), celle de sa carte, ou la carte elle-même (fichiers d'une nouvelle
 * demande, rangés avant que la carte existe).
 */
function pieceVueParLeChrome(piece: { id: string; agentId?: string; cardId?: string }, appareilId: string): boolean {
  if (piece.agentId && agentRegardeLeChrome(piece.agentId, appareilId)) return true;
  const agentDeLaCarte = piece.cardId ? store.getCard(piece.cardId)?.agentId : null;
  if (agentDeLaCarte && agentRegardeLeChrome(agentDeLaCarte, appareilId)) return true;
  for (const agentId of agentsDuChrome(appareilId)) {
    const cardId = store.getAgent(agentId)?.cardId;
    if (cardId && (store.getCard(cardId)?.attachments ?? []).includes(piece.id)) return true;
    if (store.listMessages(agentId, 60).some((m) => (m.attachments ?? []).includes(piece.id))) return true;
  }
  return false;
}

/** Une image venue du Chrome (data URL) devient une pièce jointe, rangée comme les autres (disque de stockage). */
export async function rangerUneImage(projectId: string, agentId: string | undefined, cardId: string | undefined, dataUrl: string, nom: string): Promise<string | null> {
  const m = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'beluga-chrome-'));
  const fichier = path.join(dossier, nom.replace(/[^\w.-]+/g, '-'));
  try {
    fs.writeFileSync(fichier, Buffer.from(m[2]!, 'base64'));
    const { joindreUnFichier } = await import('./joindre-fichier.js');
    const r = await joindreUnFichier({ projectId, agentId, cardId, fichier, deLAgent: !!agentId });
    return r.ok ? r.attachment.id : null;
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ */
/* 5. Le film de la session                                             */
/* ------------------------------------------------------------------ */

const FILM_IMAGES_MAX = 240;

function dossierDesFilms(): string {
  return path.join(PATHS.medias, '_chrome', 'films');
}

/** Une image (JPEG) prise après un geste qui agit : elle rejoint le film du tour de cet agent. */
export function ajouterAuFilm(agentId: string, jpegBase64: string): void {
  try {
    const dossier = path.join(dossierDesFilms(), agentId);
    fs.mkdirSync(dossier, { recursive: true });
    const deja = fs.readdirSync(dossier).filter((f) => f.endsWith('.jpg')).length;
    if (deja >= FILM_IMAGES_MAX) return;
    fs.writeFileSync(path.join(dossier, `${String(deja).padStart(4, '0')}.jpg`), Buffer.from(jpegBase64, 'base64'));
  } catch (err) {
    log.warn('film Chrome : image perdue', String((err as Error)?.message ?? err));
  }
}

/** Fin du tour : les images deviennent une courte vidéo jointe au compte rendu, puis le dossier part. */
async function finirLaSession(agentId: string): Promise<void> {
  const s = sessions.get(agentId);
  if (!s?.tourOuvert) return;
  /* La session reste (le panneau garde l'agent et son compte rendu) ; le tour, lui, est fini. */
  s.tourOuvert = false;
  s.main = false;
  s.cetteFois.clear();
  pousserAuChrome(s.appareilId, { type: 'evenement', genre: 'agents' });
  void demanderAuChrome(s.appareilId, 'detacher', { agentId }).catch(() => {});
  const dossier = path.join(dossierDesFilms(), agentId);
  if (!fs.existsSync(dossier)) return;
  try {
    const images = fs.readdirSync(dossier).filter((f) => f.endsWith('.jpg'));
    if (images.length >= 2) {
      const sortie = path.join(dossier, `film-chrome-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.mp4`);
      await new Promise<void>((resolve, reject) =>
        execFile(
          'ffmpeg',
          ['-v', 'error', '-y', '-framerate', '2', '-i', path.join(dossier, '%04d.jpg'), '-vf', 'scale=trunc(min(iw\\,1280)/2)*2:-2,format=yuv420p', '-c:v', 'libx264', '-crf', '28', '-movflags', '+faststart', sortie],
          { timeout: 120_000 },
          (err) => (err ? reject(err) : resolve()),
        ),
      );
      const { joindreUnFichier } = await import('./joindre-fichier.js');
      const r = await joindreUnFichier({ projectId: s.projectId, agentId, cardId: s.cardId ?? undefined, fichier: sortie, nom: 'Film de la session Chrome.mp4', deLAgent: true });
      if (r.ok) {
        const { attachToCurrentMessage } = await import('./runtime.js');
        attachToCurrentMessage(agentId, { attachment: r.attachment.id });
      }
    }
  } catch (err) {
    log.warn('film Chrome : assemblage impossible', String((err as Error)?.message ?? err));
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ */
/* 6. Les gestes répétés                                                */
/* ------------------------------------------------------------------ */

interface LigneRoutine {
  id: string;
  compte_id: string;
  project_id: string;
  appareil_id: string | null;
  titre: string;
  consigne: string;
  frequence: FrequenceDeRoutine;
  jour: number;
  heure: number;
  minute: number;
  prochaine_echeance: number;
  actif: number;
  dernier_depart: number | null;
  carte_origine: string | null;
}

function reglageDe(l: LigneRoutine): ReglageDeRoutine {
  return { frequence: l.frequence, jour: l.jour, heure: l.heure, minute: l.minute };
}

function enRoutine(l: LigneRoutine): RoutineChrome {
  const reglage = reglageDe(l);
  return {
    id: l.id,
    titre: l.titre,
    projectId: l.project_id,
    projet: store.getProject(l.project_id)?.name ?? '',
    reglage,
    phrase: phraseDuReglage(reglage),
    actif: !!l.actif,
    prochaineEcheance: l.prochaine_echeance,
    dernierDepart: l.dernier_depart,
    carteOrigine: l.carte_origine,
    chromeId: l.appareil_id,
  };
}

function routinesDuCompte(compteId: string): RoutineChrome[] {
  return (getDb().prepare('SELECT * FROM chrome_routines WHERE compte_id = ? ORDER BY cree_le').all(compteId) as LigneRoutine[]).map(enRoutine);
}

/**
 * « REFAIRE CHAQUE SEMAINE / MOIS » sous le compte rendu d'une carte qui a travaillé dans Chrome. On garde
 * l'intention (la demande d'origine et le compte rendu), jamais des clics. Le clic vaut accord de lancement.
 */
export async function creerUneRoutine(
  compte: Pick<CompteUtilisateur, 'id'>,
  demande: { cardId: string; frequence: FrequenceDeRoutine; appareilId?: string | null },
  maintenant = Date.now(),
): Promise<{ routine: RoutineChrome }> {
  const carte = store.getCard(demande.cardId);
  if (!carte) throw new Error('Carte introuvable.');
  const messages = store.listCardMessages(carte.id, 200);
  const demandeUtilisateur = messages.find((m) => m.role === 'user')?.content ?? carte.description ?? '';
  const compteRendu = [...messages].reverse().find((m) => m.role === 'assistant' && m.content.trim())?.content ?? '';
  const consigne = [
    `Demande d'origine :\n${(carte.description || demandeUtilisateur).slice(0, 3000)}`,
    compteRendu ? `Ce que l'agent avait fait la première fois :\n${compteRendu.slice(0, 3000)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const reglage = reglageDepuisLInstant(demande.frequence, new Date(maintenant));
  const id = crypto.randomBytes(8).toString('hex');
  const appareil = demande.appareilId ?? chromeRetenu(carte.agentId ?? '', carte.id);
  getDb()
    .prepare(
      `INSERT INTO chrome_routines (id, compte_id, project_id, appareil_id, titre, consigne, frequence, jour, heure, minute, prochaine_echeance, actif, carte_origine, cree_le)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(
      id,
      compte.id,
      carte.projectId,
      appareil,
      carte.title.slice(0, 80),
      consigne,
      reglage.frequence,
      reglage.jour,
      reglage.heure,
      reglage.minute ?? 0,
      prochaineEcheanceDeRoutine(reglage, new Date(maintenant)).getTime(),
      carte.id,
      maintenant,
    );
  bus.emit({ type: 'extension.change' });
  const ligne = getDb().prepare('SELECT * FROM chrome_routines WHERE id = ?').get(id) as LigneRoutine;
  return { routine: enRoutine(ligne) };
}

export function reglerUneRoutine(compteId: string, id: string, patch: { actif?: boolean; frequence?: FrequenceDeRoutine; jour?: number; heure?: number; minute?: number; supprimer?: boolean }): boolean {
  const db = getDb();
  const l = db.prepare('SELECT * FROM chrome_routines WHERE id = ? AND compte_id = ?').get(id, compteId) as LigneRoutine | undefined;
  if (!l) return false;
  if (patch.supprimer) {
    db.prepare('DELETE FROM chrome_routines WHERE id = ?').run(id);
  } else {
    const reglage: ReglageDeRoutine = {
      frequence: patch.frequence ?? l.frequence,
      jour: Number.isInteger(patch.jour) ? patch.jour! : l.jour,
      heure: Number.isInteger(patch.heure) ? Math.max(0, Math.min(23, patch.heure!)) : l.heure,
      minute: Number.isInteger(patch.minute) ? Math.max(0, Math.min(59, patch.minute!)) : l.minute,
    };
    if (reglage.frequence === 'semaine') reglage.jour = Math.max(0, Math.min(6, reglage.jour));
    else reglage.jour = Math.max(1, Math.min(28, reglage.jour));
    const actif = patch.actif ?? !!l.actif;
    const change = patch.frequence !== undefined || patch.jour !== undefined || patch.heure !== undefined || patch.minute !== undefined || (actif && !l.actif);
    db.prepare('UPDATE chrome_routines SET frequence = ?, jour = ?, heure = ?, minute = ?, actif = ?, prochaine_echeance = ? WHERE id = ?').run(
      reglage.frequence,
      reglage.jour,
      reglage.heure,
      reglage.minute ?? 0,
      actif ? 1 : 0,
      change ? prochaineEcheanceDeRoutine(reglage, new Date()).getTime() : l.prochaine_echeance,
      id,
    );
  }
  bus.emit({ type: 'extension.change' });
  return true;
}

let tourneeEnCours = false;

/**
 * LE PASSAGE DES ROUTINES. Une routine échue part si un Chrome de son compte est en ligne (le sien d'abord) ; sinon
 * elle attend — et ne partira qu'UNE fois au retour, l'échéance suivante sautant toutes celles manquées.
 */
export async function tourneeDesRoutines(maintenant = Date.now()): Promise<number> {
  if (tourneeEnCours) return 0;
  tourneeEnCours = true;
  let parties = 0;
  try {
    const echues = getDb().prepare('SELECT * FROM chrome_routines WHERE actif = 1 AND prochaine_echeance <= ?').all(maintenant) as LigneRoutine[];
    for (const l of echues) {
      const chromes = chromesDuCompte(l.compte_id).filter((x) => x.enLigne);
      const chrome = chromes.find((x) => x.id === l.appareil_id) ?? chromes[0];
      if (!routineAPartir({ actif: !!l.actif, prochaineEcheance: l.prochaine_echeance }, maintenant, !!chrome)) continue;
      /* L'échéance avance AVANT le lancement : un lancement qui traîne ne fait jamais partir la routine deux fois. */
      getDb().prepare('UPDATE chrome_routines SET prochaine_echeance = ?, dernier_depart = ? WHERE id = ?').run(echeanceApresDepart(reglageDe(l), maintenant), maintenant, l.id);
      const retard = retardEnJours(l.prochaine_echeance, maintenant);
      try {
        await lancerLaRoutine(l, chrome!.id, retard);
        parties++;
      } catch (err) {
        log.warn(`geste répété « ${l.titre} » non lancé`, String((err as Error)?.message ?? err));
      }
    }
  } finally {
    tourneeEnCours = false;
  }
  return parties;
}

async function lancerLaRoutine(l: LigneRoutine, appareilId: string, retardJours: number): Promise<void> {
  const { compteParId } = await import('./comptes.js');
  const compte = compteParId(l.compte_id);
  if (!compte || !compte.actif || !store.getProject(l.project_id)) return;
  const { createCard } = await import('./tools.js');
  const carte = createCard(l.project_id, {
    title: `${l.titre} — ${new Date().toLocaleDateString('fr-CH')}`.slice(0, 80),
    description: demandeDeLaRoutine({ titre: l.titre, consigne: l.consigne, retardJours }),
    origin: 'user',
  });
  bus.emit({ type: 'card.upsert', card: carte });
  getDb()
    .prepare('INSERT OR REPLACE INTO chrome_cartes (cle, appareil_id, onglet_confie, onglet_url, maj_le) VALUES (?, ?, NULL, NULL, ?)')
    .run(`carte:${carte.id}`, appareilId, Date.now());
  cartesDuChrome.set(carte.id, appareilId);
  const { noterLInterlocuteur } = await import('./interlocuteur.js');
  noterLInterlocuteur({ cardId: carte.id }, compte);
  const { startCard } = await import('./scheduler.js');
  await startCard(carte.id);
  pousserAuChrome(appareilId, {
    type: 'evenement',
    genre: 'routine',
    texte: retardJours > 0 ? `« ${l.titre} » : fait avec ${retardJours} jour${retardJours > 1 ? 's' : ''} de retard.` : `« ${l.titre} » est reparti.`,
  });
}

let minuterieDesRoutines: NodeJS.Timeout | null = null;
export function planifierLesRoutines(): void {
  if (minuterieDesRoutines) return;
  minuterieDesRoutines = setInterval(() => void tourneeDesRoutines().catch((err) => log.warn('routines Chrome', String(err))), 60_000);
  minuterieDesRoutines.unref();
}

/* ------------------------------------------------------------------ */
/* 7. Comparaison avant / après                                         */
/* ------------------------------------------------------------------ */

/**
 * « COMPARER AVEC LA DERNIÈRE FOIS » : la capture de la page devient la nouvelle référence, et l'ancienne est
 * rendue au panneau, qui calcule lui-même les écarts (sur sa toile). Seulement sur le site d'un projet, et
 * seulement sur demande (décision du 09/11/2026).
 */
async function comparerLaPage(compte: CompteUtilisateur, cmd: Record<string, any>): Promise<{ premiere: boolean; avant?: string; avantLe?: number; projet: string }> {
  const url = String(cmd.url ?? '');
  const projets = store.listProjects(false).filter((p) => compte.role === 'admin' || compte.projets.includes(p.id));
  const projet = projetDeLAdresse(projets, url);
  if (!projet) throw new Error('Cette page n’est le site d’aucun de vos projets.');
  const adresse = adresseDeComparaison(url);
  const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(String(cmd.image ?? ''));
  if (!adresse || !m) throw new Error('Capture illisible.');
  const db = getDb();
  const ancienne = db.prepare('SELECT fichier, pris_le FROM chrome_comparaisons WHERE project_id = ? AND adresse = ?').get(projet.id, adresse) as
    | { fichier: string; pris_le: number }
    | undefined;
  const dossier = path.join(PATHS.medias, '_chrome', 'comparaisons', projet.id);
  fs.mkdirSync(dossier, { recursive: true });
  const fichier = path.join(dossier, `${empreinte(adresse).slice(0, 16)}-${Date.now()}.${m[1] === 'jpeg' ? 'jpg' : 'png'}`);
  fs.writeFileSync(fichier, Buffer.from(m[2]!, 'base64'));
  db.prepare('INSERT OR REPLACE INTO chrome_comparaisons (project_id, adresse, fichier, pris_le) VALUES (?, ?, ?, ?)').run(projet.id, adresse, fichier, Date.now());
  if (!ancienne || !fs.existsSync(ancienne.fichier)) return { premiere: true, projet: projet.name };
  const avant = `data:image/${ancienne.fichier.endsWith('.jpg') ? 'jpeg' : 'png'};base64,${fs.readFileSync(ancienne.fichier).toString('base64')}`;
  fs.rmSync(ancienne.fichier, { force: true });
  return { premiere: false, avant, avantLe: ancienne.pris_le, projet: projet.name };
}

/* ------------------------------------------------------------------ */
/* Le paquet téléchargé                                                 */
/* ------------------------------------------------------------------ */

/** Le dossier de l'extension, versionné dans le dépôt (`extension-chrome/`). */
export function dossierDeLExtension(): string {
  const candidats = [path.resolve(process.cwd(), 'extension-chrome'), path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'extension-chrome')];
  return candidats.find((d) => fs.existsSync(path.join(d, 'manifest.json'))) ?? candidats[1]!;
}

/** Le zip de l'extension, RÉGLÉ pour cette installation : son adresse est écrite dans `config.json`. */
export async function paquetDeLExtension(adresse: string): Promise<Buffer> {
  const { zipBuffer } = await import('./files.js');
  const racine = dossierDeLExtension();
  const entrees: { name: string; data: Buffer }[] = [];
  const parcourir = (rel: string) => {
    for (const nom of fs.readdirSync(path.join(racine, rel))) {
      if (nom.startsWith('.') || nom === 'config.json' || nom === 'README.md') continue;
      const relatif = rel ? `${rel}/${nom}` : nom;
      const plein = path.join(racine, relatif);
      if (fs.statSync(plein).isDirectory()) parcourir(relatif);
      else entrees.push({ name: `beluga-chrome/${relatif}`, data: fs.readFileSync(plein) });
    }
  };
  parcourir('');
  entrees.push({ name: 'beluga-chrome/config.json', data: Buffer.from(JSON.stringify({ adresse: adresse.replace(/\/+$/, ''), version: VERSION_EXTENSION_CHROME }, null, 2)) });
  return zipBuffer(entrees);
}
