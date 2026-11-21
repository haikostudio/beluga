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
  VERSION_EXTENSION_CHROME,
  versionAuMoins,
  type AutorisationsDuMac,
  type EtatDuRelais,
  type PreparationDeChrome,
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
type Nouvelles = {
  vuLe: number;
  recopie?: boolean;
  verrouille?: boolean;
  accessibilite?: boolean | null;
  ecran?: boolean | null;
  version?: number;
  lanceur?: boolean;
  connect?: string;
};
const nouvelles = new Map<string, Nouvelles>();

/** Ce que le relais rapporte à chaque attente. `accessibilite`/`ecran` absents : relais d'avant « Beluga Relais ». */
export interface EtatRapporteParLeRelais {
  recopie?: boolean;
  verrouille?: boolean;
  accessibilite?: boolean | null;
  ecran?: boolean | null;
  /** La version du relais (`VERSION_DU_RELAIS` de relais.js) ; absente avant le 20/11/2026 (version 1). */
  version?: number;
  /** Joué par le lanceur fixe : il sait se remplacer seul sans que macOS oublie ses autorisations. */
  lanceur?: boolean;
  /** La version de Beluga Connect qui joue ce relais (absente : ancien « Beluga Relais »). */
  connect?: string;
}

/** Dernière demande de remplacement envoyée à chaque relais : une seule toutes les dix minutes. */
const remplacementsDemandes = new Map<string, number>();

/**
 * UN RELAIS EN RETARD SE REMPLACE SEUL (20/11/2026) : s'il tourne sous le lanceur fixe et que sa version est plus
 * ancienne que celle servie, le démon lui confie `se_mettre_a_jour` avec l'empreinte du fichier servi. Sans lanceur
 * (installation d'avant), rien : il faut rejouer la commande d'installation une fois.
 */
function remplacerSiEnRetard(appareilId: string, etat: EtatRapporteParLeRelais, maintenant = Date.now()): void {
  if (!etat.lanceur) return;
  const servi = versionDuRelaisServi();
  if (!servi || (etat.version ?? 1) >= servi) return;
  if (maintenant - (remplacementsDemandes.get(appareilId) ?? 0) < 10 * 60_000) return;
  const script = scriptDuRelais();
  if (!script) return;
  remplacementsDemandes.set(appareilId, maintenant);
  log.info(`relais du Mac en version ${etat.version ?? 1} : remplacement par la version ${servi}`);
  void demanderAuRelais(appareilId, 'se_mettre_a_jour', { empreinte: crypto.createHash('sha256').update(script).digest('hex') }, 120_000).catch((e) =>
    log.warn('relais du Mac : remplacement refusé', String((e as Error)?.message ?? e)),
  );
}

/** La version du relais servi, lue dans `relais.js` (`const VERSION_DU_RELAIS = n;`). */
export function versionDuRelaisServi(): number | null {
  const m = /const VERSION_DU_RELAIS = (\d+);/.exec(scriptDuRelais() ?? '');
  return m ? Number(m[1]) : null;
}

/** Ce que le relais d'un ordinateur sait faire : sa version et s'il tourne sous le lanceur. */
export function capacitesDuRelais(appareilId: string): { version: number; lanceur: boolean } | null {
  const n = nouvelles.get(appareilId);
  return n ? { version: n.version ?? 1, lanceur: !!n.lanceur } : null;
}

/** Le relais demande du travail (longue attente) : un geste en file, ou rien au bout de `ATTENTE_DU_RELAIS_MS`. */
export function attendreUnGeste(appareilId: string, etat: EtatRapporteParLeRelais): Promise<Commande | null> {
  const avant = nouvelles.get(appareilId);
  nouvelles.set(appareilId, { vuLe: Date.now(), ...etat });
  /* Le programme revient (ou son état change) : la liste des ordinateurs se relit. */
  if (!avant || Date.now() - avant.vuLe > RELAIS_HORS_LIGNE_APRES_MS || avant.recopie !== etat.recopie || avant.verrouille !== etat.verrouille || avant.accessibilite !== etat.accessibilite || avant.ecran !== etat.ecran) {
    bus.emit({ type: 'extension.change' });
  }
  remplacerSiEnRetard(appareilId, etat);
  apresLAttente(appareilId, etat);
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
  connect: string | null;
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
    connect: n?.connect ?? null,
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
): {
  id: string;
  ordinateurId: string;
  etat: EtatDuRelais;
  vuLe: number | null;
  autorisations: AutorisationsDuMac | null;
  connect: string | null;
  preparation: PreparationDeChrome | null;
}[] {
  rattacherLesOrphelins();
  return relais()
    .filter((r) => r.compteId === compteId && r.ordinateurId)
    .map((r) => {
      const e = etatDe(r, maintenant);
      return {
        id: r.id,
        ordinateurId: r.ordinateurId!,
        etat: e.etat,
        vuLe: e.vuLe,
        autorisations: e.autorisations,
        connect: e.connect,
        preparation: preparations.get(r.ordinateurId!) ?? null,
      };
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

/** Le lanceur fixe compilé en « Beluga Relais.app » : il lit `relais.js` sur le disque et le joue. */
export function lanceurDuRelais(): string | null {
  return lireLeFichier('lanceur.js');
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

/* ------------------------------------------------------------------ */
/* Beluga Connect (carte « Liaison de l'extension Chrome simplifiée »)  */
/* ------------------------------------------------------------------ */

/*
 * BELUGA CONNECT (20/11/2026) — l'application Mac signée (connect/) qui REMPLACE « Beluga Relais ». Elle joue le même
 * relais en processus enfant et rapporte sa version (`connect=`). Le démon :
 *  - sert son archive notarisée (`/api/connect/Beluga-Connect.zip`, fichier versionné connect/paquet/) ;
 *  - fait passer seuls à Beluga Connect les Mac équipés de « Beluga Relais » (relais v3 sous le lanceur : geste
 *    `installer_connect`, au plus toutes les six heures) ;
 *  - PRÉPARE CHROME seul dès que l'autorisation « Contrôler le Mac » est donnée : extension posée dans son dossier fixe
 *    avec un code de liaison à usage unique (`installer_extension`), puis case « navigation privée » cochée
 *    (`autoriser_navigation_privee`). Chaque sous-état est suivi pour l'écran 5 de l'assistant (`preparation`).
 */

let archive: { zip: Buffer; version: string; empreinte: string; mtime: number } | null = null;

function cheminDeLArchive(): string | null {
  for (const candidat of [
    path.resolve(process.cwd(), 'connect/paquet/Beluga-Connect.zip'),
    path.resolve(process.cwd(), '../connect/paquet/Beluga-Connect.zip'),
    path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../connect/paquet/Beluga-Connect.zip'),
  ]) {
    if (fs.existsSync(candidat)) return candidat;
  }
  return null;
}

/** L'archive de Beluga Connect servie par ce Beluga, sa version et son empreinte (relue si le fichier change). */
export function archiveDeConnect(): { zip: Buffer; version: string; empreinte: string } | null {
  const chemin = cheminDeLArchive();
  if (!chemin) return null;
  const mtime = fs.statSync(chemin).mtimeMs;
  if (!archive || archive.mtime !== mtime) {
    const zip = fs.readFileSync(chemin);
    let version = '0';
    try {
      version = fs.readFileSync(path.join(path.dirname(chemin), 'version.txt'), 'utf8').trim();
    } catch {
      /* sans version : 0, jamais proposée comme mise à jour */
    }
    archive = { zip, version, empreinte: crypto.createHash('sha256').update(zip).digest('hex'), mtime };
  }
  return { zip: archive.zip, version: archive.version, empreinte: archive.empreinte };
}

const preparations = new Map<string, PreparationDeChrome>();
const derniersEssais = new Map<string, number>();

/** Vrai (et noté) si ce geste n'a pas été tenté sur ce relais depuis `ms`. */
function auPlusToutesLes(cle: string, ms: number, maintenant = Date.now()): boolean {
  if (maintenant - (derniersEssais.get(cle) ?? 0) < ms) return false;
  derniersEssais.set(cle, maintenant);
  return true;
}

function poserLaPreparation(ordinateurId: string, p: PreparationDeChrome): void {
  preparations.set(ordinateurId, p);
  bus.emit({ type: 'extension.change' });
}

/** Après chaque attente du relais : migration vers Beluga Connect, ou préparation de Chrome. Jamais bloquant. */
function apresLAttente(appareilId: string, etat: EtatRapporteParLeRelais): void {
  const r = relais().find((x) => x.id === appareilId);
  if (!r?.ordinateurId || (etat.version ?? 1) < 3) return;
  if (!etat.connect) {
    const a = archiveDeConnect();
    if (!etat.lanceur || !a || !auPlusToutesLes(`connect:${appareilId}`, 6 * 3600_000)) return;
    log.info(`relais du Mac « ${r.nom} » : passage à Beluga Connect ${a.version}`);
    void demanderAuRelais(appareilId, 'installer_connect', { chemin: '/api/connect/Beluga-Connect.zip', empreinte: a.empreinte, version: a.version }, 180_000).catch((e) =>
      log.warn('relais du Mac : passage à Beluga Connect refusé', String((e as Error)?.message ?? e)),
    );
    return;
  }
  if (etat.accessibilite !== true) return;
  void preparerChrome(r.compteId, r, false).catch((e) => log.warn('Beluga Connect : préparation de Chrome', String((e as Error)?.message ?? e)));
}

async function chromesDeLOrdinateur(compteId: string, ordinateurId: string) {
  const { chromesDuCompte } = await import('./extension-chrome.js');
  return chromesDuCompte(compteId)
    .filter((c) => c.ordinateurId === ordinateurId && c.genre === 'chrome')
    .sort((a, b) => (b.vuLe ?? 0) - (a.vuLe ?? 0));
}

async function attendreQue<T>(lire: () => Promise<T | null | undefined>, delaiMs: number): Promise<T | null> {
  const fin = Date.now() + delaiMs;
  while (Date.now() < fin) {
    const v = await lire();
    if (v) return v;
    await new Promise((ok) => setTimeout(ok, 2_000));
  }
  return null;
}

/**
 * PRÉPARER CHROME sur le Mac de ce relais : poser et relier l'extension si ce Mac n'a aucun Chrome relié, puis cocher
 * la navigation privée si l'extension dit ne pas l'avoir. `force` (« Réparer ») passe outre les délais entre essais.
 */
export async function preparerChrome(compteId: string, r: RelaisRelie, force: boolean): Promise<void> {
  const ordinateurId = r.ordinateurId;
  if (!ordinateurId || preparations.get(ordinateurId)?.etat === 'en-cours') return;
  let chromes = await chromesDeLOrdinateur(compteId, ordinateurId);
  const depuis = Date.now();
  if (!chromes.length) {
    if (!force && !auPlusToutesLes(`installer:${r.id}`, 15 * 60_000)) return;
    poserLaPreparation(ordinateurId, { etat: 'en-cours', ajoutee: null, message: null, depuis });
    try {
      const { emettreUnCodeDeLiaison } = await import('./extension-chrome.js');
      const { preparerLePaquet } = await import('./mise-a-jour-extension.js');
      const { code } = emettreUnCodeDeLiaison(compteId, Date.now(), { ordinateurId });
      const { jeton, empreinte } = await preparerLePaquet(r.id);
      const fait = await demanderAuRelais<{ ajoutee?: boolean; detail?: string }>(
        r.id,
        'installer_extension',
        { chemin: `/api/relais-mac/extension.zip?jeton=${jeton}`, empreinte, version: VERSION_EXTENSION_CHROME, code },
        180_000,
      );
      poserLaPreparation(ordinateurId, { etat: 'en-cours', ajoutee: fait.ajoutee === true, message: fait.detail || null, depuis });
      const relie = await attendreQue(async () => (await chromesDeLOrdinateur(compteId, ordinateurId)).find((c) => c.enLigne), fait.ajoutee ? 90_000 : 20_000);
      if (!relie) {
        poserLaPreparation(ordinateurId, {
          etat: 'echec',
          ajoutee: fait.ajoutee === true,
          message: fait.ajoutee ? 'Chrome ne s’est pas relié à Beluga.' : (fait.detail ?? 'L’extension n’a pas pu être ajoutée à Chrome.'),
          depuis,
        });
        return;
      }
      chromes = [relie];
    } catch (e) {
      poserLaPreparation(ordinateurId, { etat: 'echec', ajoutee: false, message: String((e as Error)?.message ?? e), depuis });
      return;
    }
  }
  const chrome = chromes[0]!;
  if (chrome.incognito === true || !chrome.enLigne || !versionAuMoins(chrome.version, '1.0.11')) {
    if (preparations.get(ordinateurId)?.etat === 'en-cours') poserLaPreparation(ordinateurId, { etat: 'fait', ajoutee: true, message: null, depuis });
    return;
  }
  if (!force && !auPlusToutesLes(`prive:${r.id}`, 30 * 60_000)) return;
  const ligne = getDb().prepare('SELECT extension_id FROM chrome_appareils WHERE id = ?').get(chrome.id) as { extension_id: string | null } | undefined;
  if (!ligne?.extension_id) return;
  poserLaPreparation(ordinateurId, { etat: 'en-cours', ajoutee: true, message: null, depuis });
  try {
    await demanderAuRelais(r.id, 'autoriser_navigation_privee', { extensionId: ligne.extension_id }, 90_000);
    const prive = await attendreQue(async () => (await chromesDeLOrdinateur(compteId, ordinateurId)).find((c) => c.incognito === true), 30_000);
    poserLaPreparation(
      ordinateurId,
      prive ? { etat: 'fait', ajoutee: true, message: null, depuis } : { etat: 'echec', ajoutee: true, message: 'La navigation privée n’a pas pu être autorisée.', depuis },
    );
  } catch (e) {
    poserLaPreparation(ordinateurId, { etat: 'echec', ajoutee: true, message: String((e as Error)?.message ?? e), depuis });
  }
}

/** Ce que Beluga Connect affiche dans son menu : l'ordinateur, ses Chrome, la version servie de lui-même. */
export async function statutPourConnect(appareilId: string, compteId: string): Promise<Record<string, unknown>> {
  const r = relais().find((x) => x.id === appareilId);
  const ordinateur = r?.ordinateurId ? ligneDOrdinateur(compteId, r.ordinateurId) : null;
  const chromes = r?.ordinateurId ? await chromesDeLOrdinateur(compteId, r.ordinateurId) : [];
  const { retardsDuCompte, phaseDeLaMiseAJour } = await import('./mise-a-jour-extension.js');
  const retards = await retardsDuCompte(compteId);
  const a = archiveDeConnect();
  return {
    ordinateur: ordinateur?.nom ?? null,
    chromes: chromes.map((c) => ({
      nom: c.nom,
      version: c.version,
      aJour: versionAuMoins(c.version, VERSION_EXTENSION_CHROME),
      enCours: retards.find((x) => x.chromeId === c.id)?.enCours ?? false,
      /* L'étape de la mise à jour en cours, pour les trois étapes cochées de la fenêtre de Beluga Connect. */
      phase: phaseDeLaMiseAJour(c.id),
      attente: c.agentsAuTravail > 0 ? 'agent' : null,
    })),
    versionExtension: VERSION_EXTENSION_CHROME,
    connect: a ? { version: a.version, empreinte: a.empreinte, chemin: '/api/connect/Beluga-Connect.zip' } : null,
    preparation: (r?.ordinateurId && preparations.get(r.ordinateurId)?.etat) || null,
  };
}

/** Un geste demandé depuis le menu de Beluga Connect : « Mettre à jour maintenant » ou « Réparer ». */
export async function demandeDeConnect(appareilId: string, compteId: string, quoi: unknown): Promise<{ ok: boolean; texte: string }> {
  const r = relais().find((x) => x.id === appareilId);
  if (!r?.ordinateurId) return { ok: false, texte: 'Ce Mac n’est rattaché à aucun ordinateur dans Beluga.' };
  if (quoi === 'reparer') {
    void preparerChrome(compteId, r, true).catch(() => {});
    return { ok: true, texte: 'Beluga vérifie Chrome sur ce Mac et le répare au besoin.' };
  }
  if (quoi !== 'mettre-a-jour') return { ok: false, texte: 'Demande inconnue.' };
  const { mettreAJourLExtension } = await import('./mise-a-jour-extension.js');
  const enRetard = (await chromesDeLOrdinateur(compteId, r.ordinateurId)).filter((c) => !versionAuMoins(c.version, VERSION_EXTENSION_CHROME));
  if (!enRetard.length) return { ok: true, texte: `L’extension Chrome est à jour (version ${VERSION_EXTENSION_CHROME}).` };
  const issues = [];
  for (const c of enRetard) issues.push(await mettreAJourLExtension(compteId, c.id, 'clic'));
  return { ok: issues.every((i) => i.ok), texte: issues.map((i) => i.texte).join(' ') };
}

/** « Réessayer » de l'assistant : Beluga Connect de cet ordinateur reprend la préparation de Chrome (sans délai). */
export function preparerChromeDeLOrdinateur(compteId: string, ordinateurId: string): boolean {
  const r = relais().find((x) => x.compteId === compteId && x.ordinateurId === ordinateurId);
  if (!r || !nouvelles.get(r.id)?.connect) return false;
  if (preparations.get(ordinateurId)?.etat !== 'en-cours') preparations.delete(ordinateurId);
  void preparerChrome(compteId, r, true).catch(() => {});
  return true;
}
