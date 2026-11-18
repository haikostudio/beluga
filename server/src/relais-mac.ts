/*
 * LE RELAIS DU MAC, CÔTÉ DÉMON (13/11/2026) — voir `shared/src/relais-mac.ts` pour les règles.
 *
 * Même modèle que l'extension Chrome (MEM-7235) : un code à usage unique émis AVEC session dans Réglages → Extension,
 * échangé par le relais contre une clé d'appareil ; ensuite, chaque demande du relais est SIGNÉE (HMAC du secret
 * d'appareil, horodatage frais, jamais rejouée). Le relais n'a ni WebSocket ni dépendance : il interroge le démon en
 * longue attente (`/api/relais-mac/attendre`), reçoit UN geste, le joue, renvoie le résultat (`/api/relais-mac/reponse`).
 *
 * Le secret d'un relais n'est jamais écrit : il se recalcule du secret du serveur (`secretDeLAppareil`). Les relais
 * reliés vivent dans la table `meta` (clé `relais-mac.appareils`), UN PAR ORDINATEUR (carte « Choisir l'ordinateur visé
 * depuis le téléphone », 15/11/2026) : un compte peut avoir plusieurs Mac, chacun avec son programme. Un relais d'avant
 * (sans ordinateur) est rattaché au premier ordinateur du compte qui n'a pas encore de programme, ou en reçoit un.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  ATTENTE_DU_RELAIS_MS,
  DELAI_D_UN_GESTE_MS,
  DUREE_CODE_LIAISON_MS,
  RELAIS_HORS_LIGNE_APRES_MS,
  codeDeLiaisonValide,
  etatDuRelais,
  identifiantDAppareil,
  lireIdentifiantDAppareil,
  messageASigner,
  signatureFraiche,
  type AutorisationsDuMac,
  type EtatDuRelais,
} from '@beluga/shared';
import { getDb, getMeta, setMeta } from './db.js';
import { bus } from './bus.js';
import { creerUnOrdinateur, ligneDOrdinateur, proposerLeVraiNom } from './ordinateurs.js';
import { secretDeLAppareil, signer } from './extension-chrome.js';
import { log } from './logger.js';

const CLE_APPAREILS = 'relais-mac.appareils';

interface RelaisRelie {
  id: string;
  compteId: string;
  nonce: string;
  nom: string;
  creeLe: number;
  /** L'ordinateur qui porte ce programme (absent pour un relais relié avant la carte des ordinateurs). */
  ordinateurId?: string;
}

function relais(): RelaisRelie[] {
  try {
    const brut = JSON.parse(getMeta(CLE_APPAREILS) ?? '[]');
    return Array.isArray(brut) ? brut : [];
  } catch {
    return [];
  }
}
function enregistrer(liste: RelaisRelie[]): void {
  setMeta(CLE_APPAREILS, JSON.stringify(liste));
}

/* ------------------------------------------------------------------ */
/* La liaison                                                           */
/* ------------------------------------------------------------------ */

const codes = new Map<string, { compteId: string; expireLe: number; ordinateurId: string | null }>();
const empreinte = (texte: string) => crypto.createHash('sha256').update(texte).digest('hex');

/** Un code neuf, à six chiffres, valable dix minutes, pour un ordinateur donné ; l'ancien du compte meurt. */
export function emettreUnCodeDuRelais(compteId: string, maintenant = Date.now(), ordinateurId: string | null = null): { code: string; expireLe: number } {
  for (const [cle, v] of codes) if (v.compteId === compteId || v.expireLe < maintenant) codes.delete(cle);
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const expireLe = maintenant + DUREE_CODE_LIAISON_MS;
  codes.set(empreinte(code), { compteId, expireLe, ordinateurId: ligneDOrdinateur(compteId, ordinateurId)?.id ?? null });
  return { code, expireLe };
}

const essais = new Map<string, number[]>();
function tropDEssais(adresse: string, maintenant: number): boolean {
  const recents = (essais.get(adresse) ?? []).filter((t) => maintenant - t < 60_000);
  recents.push(maintenant);
  essais.set(adresse, recents);
  return recents.length > 10;
}

export type ResultatDeLiaisonDuRelais = { ok: true; identifiant: string; secret: string; nom: string } | { ok: false; raison: string };

/**
 * Le relais échange le code contre sa clé. Il se rattache à l'ordinateur visé par le code (le programme d'avant sur cet
 * ordinateur est remplacé), sinon à un ordinateur neuf au vrai nom du Mac. Le vrai nom remplace un nom par défaut.
 */
export function relierUnMac(demande: { code?: unknown; nom?: unknown }, adresse: string, maintenant = Date.now()): ResultatDeLiaisonDuRelais {
  if (tropDEssais(adresse, maintenant)) return { ok: false, raison: 'Trop d’essais : patientez une minute.' };
  const code = String(demande.code ?? '').replace(/\s+/g, '');
  if (!codeDeLiaisonValide(code)) return { ok: false, raison: 'Le code a six chiffres.' };
  const trouve = codes.get(empreinte(code));
  codes.delete(empreinte(code));
  if (!trouve || trouve.expireLe < maintenant) return { ok: false, raison: 'Code inconnu ou expiré : affichez-en un nouveau dans Réglages → Extension.' };
  const id = crypto.randomBytes(9).toString('base64url');
  const nonce = crypto.randomBytes(12).toString('base64url');
  const nom = String(demande.nom ?? '').trim().slice(0, 60) || 'Mac';
  const ordinateurId = ligneDOrdinateur(trouve.compteId, trouve.ordinateurId)?.id ?? creerUnOrdinateur(trouve.compteId, nom, maintenant).id;
  proposerLeVraiNom(trouve.compteId, ordinateurId, nom);
  rattacherLesOrphelins();
  enregistrer([
    ...relais().filter((r) => !(r.compteId === trouve.compteId && r.ordinateurId === ordinateurId)),
    { id, compteId: trouve.compteId, nonce, nom, creeLe: maintenant, ordinateurId },
  ]);
  const cle = { compteId: trouve.compteId, id, nonce };
  log.info(`relais du Mac relié (${nom})`);
  bus.emit({ type: 'extension.change' });
  return { ok: true, identifiant: identifiantDAppareil(cle), secret: secretDeLAppareil(cle), nom };
}

/** Délier le programme du Mac d'un ordinateur (ou tous ceux du compte, sans ordinateur donné). */
export function delierLeMac(compteId: string, ordinateurId?: string | null): boolean {
  rattacherLesOrphelins();
  const avant = relais();
  const apres = avant.filter((r) => r.compteId !== compteId || (ordinateurId ? r.ordinateurId !== ordinateurId : false));
  if (apres.length === avant.length) return false;
  enregistrer(apres);
  bus.emit({ type: 'extension.change' });
  return true;
}

/* Les signatures déjà vues, gardées le temps de leur fraîcheur : une demande captée ne se rejoue pas. */
const vues = new Map<string, number>();

/**
 * LA DEMANDE DU RELAIS EST-ELLE SIGNÉE PAR UN MAC RELIÉ ? En-têtes `x-relais-id`, `x-relais-ts` (secondes),
 * `x-relais-sig` = HMAC(secret, « ts.id.sha256(corps) »).
 */
export function verifierLeRelais(
  entetes: { id?: string | null; ts?: string | null; sig?: string | null },
  corps: string,
  maintenant = Date.now(),
): { appareilId: string; compteId: string } | null {
  const cle = lireIdentifiantDAppareil(entetes.id);
  const ts = Number(entetes.ts);
  if (!cle || !Number.isInteger(ts) || !signatureFraiche(ts, maintenant) || typeof entetes.sig !== 'string') return null;
  const connu = relais().find((r) => r.id === cle.id && r.compteId === cle.compteId && r.nonce === cle.nonce);
  if (!connu) return null;
  const attendue = signer(secretDeLAppareil(cle), messageASigner(ts, entetes.id!, empreinte(corps)));
  const a = Buffer.from(attendue);
  const b = Buffer.from(entetes.sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  for (const [sig, at] of vues) if (maintenant - at > 10 * 60_000) vues.delete(sig);
  if (vues.has(entetes.sig)) return null;
  vues.set(entetes.sig, maintenant);
  return { appareilId: cle.id, compteId: cle.compteId };
}

/* ------------------------------------------------------------------ */
/* Les gestes confiés au relais                                         */
/* ------------------------------------------------------------------ */

interface Commande {
  id: string;
  geste: string;
  args: Record<string, unknown>;
}
interface Attente {
  resoudre: (resultat: any) => void;
  rejeter: (err: Error) => void;
  minuteur: NodeJS.Timeout;
}

const files = new Map<string, Commande[]>();
const preneurs = new Map<string, (c: Commande | null) => void>();
const enAttente = new Map<string, Attente>();
type Nouvelles = { vuLe: number; recopie?: boolean; verrouille?: boolean; accessibilite?: boolean | null; ecran?: boolean | null };
const nouvelles = new Map<string, Nouvelles>();

/** Ce que le relais rapporte à chaque attente. `accessibilite`/`ecran` absents : relais d'avant « Beluga Relais ». */
export interface EtatRapporteParLeRelais {
  recopie?: boolean;
  verrouille?: boolean;
  accessibilite?: boolean | null;
  ecran?: boolean | null;
}

/** Le relais demande du travail (longue attente) : un geste en file, ou rien au bout de `ATTENTE_DU_RELAIS_MS`. */
export function attendreUnGeste(appareilId: string, etat: EtatRapporteParLeRelais): Promise<Commande | null> {
  const avant = nouvelles.get(appareilId);
  nouvelles.set(appareilId, { vuLe: Date.now(), ...etat });
  /* Le programme revient (ou son état change) : la liste des ordinateurs se relit. */
  if (!avant || Date.now() - avant.vuLe > RELAIS_HORS_LIGNE_APRES_MS || avant.recopie !== etat.recopie || avant.verrouille !== etat.verrouille || avant.accessibilite !== etat.accessibilite || avant.ecran !== etat.ecran) {
    bus.emit({ type: 'extension.change' });
  }
  const file = files.get(appareilId) ?? [];
  const suivante = file.shift();
  if (suivante) return Promise.resolve(suivante);
  preneurs.get(appareilId)?.(null);
  return new Promise((resoudre) => {
    const minuteur = setTimeout(() => {
      if (preneurs.get(appareilId) === prendre) preneurs.delete(appareilId);
      resoudre(null);
    }, ATTENTE_DU_RELAIS_MS);
    const prendre = (c: Commande | null) => {
      clearTimeout(minuteur);
      if (preneurs.get(appareilId) === prendre) preneurs.delete(appareilId);
      resoudre(c);
    };
    preneurs.set(appareilId, prendre);
  });
}

/** Le relais rend le résultat d'un geste. */
export function recevoirLaReponse(appareilId: string, reponse: { id?: unknown; ok?: unknown; resultat?: unknown; erreur?: unknown }): boolean {
  nouvelles.set(appareilId, { ...(nouvelles.get(appareilId) ?? {}), vuLe: Date.now() });
  const id = String(reponse.id ?? '');
  const attente = enAttente.get(`${appareilId}:${id}`);
  if (!attente) return false;
  enAttente.delete(`${appareilId}:${id}`);
  clearTimeout(attente.minuteur);
  if (reponse.ok === true) attente.resoudre(reponse.resultat ?? {});
  else attente.rejeter(new Error(String(reponse.erreur ?? 'geste refusé par le relais')));
  return true;
}

/** Confier un geste au relais d'un compte, et attendre son résultat. */
export function demanderAuRelais<T = any>(appareilId: string, geste: string, args: Record<string, unknown>, delaiMs = DELAI_D_UN_GESTE_MS): Promise<T> {
  const commande: Commande = { id: crypto.randomBytes(6).toString('base64url'), geste, args };
  return new Promise<T>((resoudre, rejeter) => {
    const minuteur = setTimeout(() => {
      enAttente.delete(`${appareilId}:${commande.id}`);
      const file = files.get(appareilId);
      if (file) files.set(appareilId, file.filter((c) => c.id !== commande.id));
      rejeter(new Error('le relais du Mac n’a pas répondu à temps'));
    }, delaiMs);
    enAttente.set(`${appareilId}:${commande.id}`, { resoudre, rejeter, minuteur });
    const preneur = preneurs.get(appareilId);
    if (preneur) preneur(commande);
    else files.set(appareilId, [...(files.get(appareilId) ?? []), commande]);
  });
}

type EtatDUnRelais = {
  appareilId: string | null;
  nom: string | null;
  etat: EtatDuRelais;
  vuLe: number | null;
  ordinateurId: string | null;
  autorisations: AutorisationsDuMac | null;
};

/** Les autorisations rapportées : `null` tant que le relais n'en a rien dit (programme d'avant « Beluga Relais »). */
function autorisationsDe(n: Nouvelles | undefined): AutorisationsDuMac | null {
  if (!n || (n.accessibilite === undefined && n.ecran === undefined)) return null;
  return { accessibilite: n.accessibilite ?? null, ecran: n.ecran ?? null };
}

function etatDe(r: RelaisRelie | undefined, maintenant: number): EtatDUnRelais {
  const n = r ? nouvelles.get(r.id) : undefined;
  return {
    appareilId: r?.id ?? null,
    nom: r?.nom ?? null,
    vuLe: n?.vuLe ?? null,
    ordinateurId: r?.ordinateurId ?? null,
    autorisations: autorisationsDe(n),
    etat: etatDuRelais({ relie: !!r, vuLe: n?.vuLe, maintenant, recopie: n?.recopie, verrouille: n?.verrouille }),
  };
}

const RANG_DE_L_ETAT: Record<EtatDuRelais, number> = { pret: 0, 'recopie-fermee': 1, 'mac-verrouille': 2, 'hors-ligne': 3, absent: 4 };

/**
 * LE RELAIS D'UN COMPTE pour l'iPhone : celui de l'ordinateur donné s'il en a un, sinon le MIEUX DISPOSÉ des Mac du
 * compte (prêt d'abord, puis recopie fermée…).
 */
export function relaisDuCompte(compteId: string, maintenant = Date.now(), ordinateurId?: string | null): EtatDUnRelais {
  rattacherLesOrphelins();
  const etats = relais()
    .filter((x) => x.compteId === compteId)
    .map((r) => etatDe(r, maintenant));
  const duBon = ordinateurId ? etats.find((e) => e.ordinateurId === ordinateurId) : undefined;
  if (duBon) return duBon;
  return etats.sort((a, b) => RANG_DE_L_ETAT[a.etat] - RANG_DE_L_ETAT[b.etat])[0] ?? etatDe(undefined, maintenant);
}

/** Le programme du Mac de chaque ordinateur du compte (pour la liste des ordinateurs). */
export function programmesDuCompte(
  compteId: string,
  maintenant = Date.now(),
): { id: string; ordinateurId: string; etat: EtatDuRelais; vuLe: number | null; autorisations: AutorisationsDuMac | null }[] {
  rattacherLesOrphelins();
  return relais()
    .filter((r) => r.compteId === compteId && r.ordinateurId)
    .map((r) => {
      const e = etatDe(r, maintenant);
      return { id: r.id, ordinateurId: r.ordinateurId!, etat: e.etat, vuLe: e.vuLe, autorisations: e.autorisations };
    });
}

/**
 * UN RELAIS RELIÉ AVANT LA CARTE DES ORDINATEURS (sans `ordinateurId`) se rattache, une fois pour toutes : au premier
 * ordinateur du compte qui n'a pas encore de programme, sinon à un ordinateur neuf à son nom. Idempotent.
 */
function rattacherLesOrphelins(): void {
  const liste = relais();
  if (!liste.some((r) => !r.ordinateurId)) return;
  let change = false;
  for (const r of liste) {
    if (r.ordinateurId && ligneDOrdinateur(r.compteId, r.ordinateurId)) continue;
    const pris = new Set(liste.filter((x) => x.compteId === r.compteId && x.ordinateurId).map((x) => x.ordinateurId));
    let libre: string | undefined;
    try {
      libre = (
        getDb().prepare('SELECT id FROM ordinateurs WHERE compte_id = ? AND revoque_le IS NULL ORDER BY cree_le').all(r.compteId) as { id: string }[]
      ).find((o) => !pris.has(o.id))?.id;
    } catch {
      return; /* base pas encore migrée */
    }
    r.ordinateurId = libre ?? creerUnOrdinateur(r.compteId, r.nom).id;
    if (libre) proposerLeVraiNom(r.compteId, libre, r.nom);
    change = true;
  }
  if (change) enregistrer(liste);
}

/**
 * ROUVRIR SUR LE MAC l'écran des réglages d'une autorisation (assistant d'installation) : le relais la redemande à
 * macOS puis ouvre le bon écran. Seuls deux réglages existent ; rien d'autre ne s'ouvre.
 */
export async function ouvrirUnReglageDuMac(compteId: string, ordinateurId: string, reglage: 'accessibilite' | 'ecran'): Promise<void> {
  const r = relaisDuCompte(compteId, Date.now(), ordinateurId);
  if (!r.appareilId || r.ordinateurId !== ordinateurId) throw new Error('Le programme du Mac n’est pas installé sur cet ordinateur.');
  if (r.etat === 'hors-ligne' || r.etat === 'absent') throw new Error('Le programme du Mac ne répond pas : le Mac est-il allumé ?');
  await demanderAuRelais(r.appareilId, 'ouvrir_reglage', { reglage });
}

/** Le premier relais relié, pour un agent qui n'a pas de compte (routine) : celui de l'administrateur. */
export function unRelaisEstRelie(): boolean {
  return relais().length > 0;
}

/* ------------------------------------------------------------------ */
/* Le programme du relais, servi à l'installation                       */
/* ------------------------------------------------------------------ */

/** Le script du relais (JavaScript pour Automation, joué par `osascript`), versionné dans `scripts/relais-mac/`. */
export function scriptDuRelais(): string | null {
  return lireLeFichier('relais.js');
}

/** L'installateur, avec l'adresse de CE Beluga écrite dedans : une seule commande à coller dans le Terminal du Mac. */
export function installateurDuRelais(base: string): string | null {
  if (!/^https?:\/\/[A-Za-z0-9.:-]+$/.test(base)) return null;
  return lireLeFichier('installer.sh')?.replaceAll('__BASE__', base) ?? null;
}

function lireLeFichier(nom: string): string | null {
  for (const candidat of [
    path.resolve(process.cwd(), 'scripts/relais-mac', nom),
    path.resolve(process.cwd(), '../scripts/relais-mac', nom),
    path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../scripts/relais-mac', nom),
  ]) {
    if (fs.existsSync(candidat)) return fs.readFileSync(candidat, 'utf8');
  }
  return null;
}
