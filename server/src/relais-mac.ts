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
  RELAIS_HORS_LIGNE_APRES_MS,
  codeDeLiaisonValide,
  etatDuRelais,
  identifiantDAppareil,
  lireIdentifiantDAppareil,
  messageASigner,
  signatureFraiche,
  VERSION_EXTENSION_CHROME,
  versionAuMoins,
  systemeValable,
  type AutorisationsDuMac,
  type SystemeDOrdinateur,
  type EtatDuRelais,
  type PreparationDeChrome,
  type PreparationDeSafari,
  etapesDeSafari,
  type TravailDeConnect,
  preparationVue,
  codeDeSecoursAMontrer,
  etapesDeLaPreparation,
} from '@beluga/shared';
import { getDb, getMeta, setMeta } from './db.js';
import { bus } from './bus.js';
import { creerUnOrdinateur, ligneDOrdinateur, proposerLeVraiNom } from './ordinateurs.js';
import { echecDeLiaisonSignale, secretDeLAppareil, signer } from './extension-chrome.js';
import { log } from './logger.js';
import { ecransOuvertsDuCompte } from './ecrans-ouverts.js';

const CLE_APPAREILS = 'relais-mac.appareils';

interface RelaisRelie {
  id: string;
  compteId: string;
  nonce: string;
  nom: string;
  creeLe: number;
  /** L'ordinateur qui porte ce programme (absent pour un relais relié avant la carte des ordinateurs). */
  ordinateurId?: string;
  /** Le système de l'ordinateur (Beluga Connect Windows / Linux, 21/11/2026) ; absent : un Mac. */
  systeme?: SystemeDOrdinateur;
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

/*
 * LE CODE DU TÉLÉCHARGEMENT NE MEURT PLUS EN ROUTE (carte « Beluga Connect : liaison et suivi », 22/11/2026). Il vivait
 * en mémoire (perdu à chaque redémarrage du démon, donc à chaque mise en ligne), dix minutes, et le moindre nouveau
 * clic « Lier » effaçait celui que l'image disque emportait : Beluga Connect retombait alors sur l'ouverture d'une page,
 * ce que l'utilisateur interdit. Désormais : rangé HACHÉ dans `meta` (clé `relais-mac.codes`), valable vingt-quatre
 * heures jusqu'à son premier usage, six vivants au plus par compte (le plus ancien s'efface), usage unique. Un code
 * servi ou expiré reste connu (`RETENU_APRES_MS`) le temps de dire À QUEL COMPTE il appartenait : la demande de repli de
 * l'application (`demanderUneLiaison` avec le code) est alors poussée aux onglets ouverts de CE compte, jamais ouverte.
 */
export const DUREE_CODE_DU_TELECHARGEMENT_MS = 24 * 60 * 60_000;
const RETENU_APRES_MS = 48 * 60 * 60_000;
const CODES_VIVANTS_PAR_COMPTE = 6;
const CLE_CODES = 'relais-mac.codes';

interface CodeDuRelais {
  /** SHA-256 du code : le code lui-même n'est jamais écrit. */
  empreinte: string;
  compteId: string;
  ordinateurId: string | null;
  emisLe: number;
  expireLe: number;
  utiliseLe?: number;
  /** L'adresse réseau (IP publique) de l'onglet qui a cliqué « Lier » : l'appariement par le même réseau s'en sert. */
  adresse?: string;
}

function lesCodes(): CodeDuRelais[] {
  try {
    const brut = JSON.parse(getMeta(CLE_CODES) ?? '[]');
    return Array.isArray(brut) ? brut.filter((c) => c && typeof c.empreinte === 'string' && typeof c.compteId === 'string') : [];
  } catch {
    return [];
  }
}
function rangerLesCodes(liste: CodeDuRelais[], maintenant: number): void {
  setMeta(CLE_CODES, JSON.stringify(liste.filter((c) => c.emisLe + RETENU_APRES_MS > maintenant)));
}
const empreinte = (texte: string) => crypto.createHash('sha256').update(texte).digest('hex');
const codeVivant = (c: CodeDuRelais, maintenant: number) => !c.utiliseLe && c.expireLe >= maintenant;

/** Un code neuf, à six chiffres, valable vingt-quatre heures jusqu'à son premier usage ; les autres codes du compte vivent. */
export function emettreUnCodeDuRelais(
  compteId: string,
  maintenant = Date.now(),
  ordinateurId: string | null = null,
  adresse: string | null = null,
): { code: string; expireLe: number } {
  const liste = lesCodes();
  const vivants = liste.filter((c) => c.compteId === compteId && codeVivant(c, maintenant)).sort((a, b) => a.emisLe - b.emisLe);
  /* Six vivants au plus : le plus ancien est marqué servi (il reste connu pour le repli, mais ne relie plus). */
  for (const vieux of vivants.slice(0, Math.max(0, vivants.length - CODES_VIVANTS_PAR_COMPTE + 1))) vieux.utiliseLe = maintenant;
  let code = '';
  do code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  while (liste.some((c) => c.empreinte === empreinte(code) && codeVivant(c, maintenant)));
  const expireLe = maintenant + DUREE_CODE_DU_TELECHARGEMENT_MS;
  liste.push({
    empreinte: empreinte(code),
    compteId,
    ordinateurId: ligneDOrdinateur(compteId, ordinateurId)?.id ?? null,
    emisLe: maintenant,
    expireLe,
    ...(adresse ? { adresse: adresseDuReseau(adresse) } : {}),
  });
  rangerLesCodes(liste, maintenant);
  return { code, expireLe };
}

const CLE_DELIES = 'relais-mac.delies';
function lesDelies(): { id: string; nonce: string; compteId: string; le: number }[] {
  try {
    const brut = JSON.parse(getMeta(CLE_DELIES) ?? '[]');
    return Array.isArray(brut) ? brut : [];
  } catch {
    return [];
  }
}
/** Le compte d'une ancienne clé d'appareil, vérifiée (identifiant ET nonce) contre les relais vivants ou déliés. */
function compteDeLAncienneCle(ancien: unknown): string | null {
  const cle = lireIdentifiantDAppareil(ancien);
  if (!cle) return null;
  const vivant = relais().find((r) => r.id === cle.id && r.nonce === cle.nonce && r.compteId === cle.compteId);
  if (vivant) return vivant.compteId;
  const delie = lesDelies().find((d) => d.id === cle.id && d.nonce === empreinte(cle.nonce) && d.compteId === cle.compteId);
  return delie?.compteId ?? null;
}

/** À quel compte (et quel ordinateur) appartenait ce code, même servi ou expiré : le clic « Lier » qui l'a émis vaut l'accord. */
function codeConnu(code: unknown, maintenant: number): { compteId: string; ordinateurId: string | null } | null {
  const net = String(code ?? '').replace(/\s+/g, '');
  if (!codeDeLiaisonValide(net)) return null;
  const trouve = lesCodes()
    .filter((c) => c.empreinte === empreinte(net) && c.emisLe + RETENU_APRES_MS > maintenant)
    .sort((a, b) => b.emisLe - a.emisLe)[0];
  return trouve ? { compteId: trouve.compteId, ordinateurId: trouve.ordinateurId } : null;
}

/**
 * LE MÊME RÉSEAU (carte « Beluga Connect : liaison sans fenêtre », 22/11/2026) : sans code lisible, Beluga Connect est
 * relié au compte qui vient de cliquer « Lier » DEPUIS LA MÊME ADRESSE PUBLIQUE — à une condition, décidée avec
 * l'utilisateur : qu'UN SEUL compte ait un « Lier » vivant de moins de dix minutes sur ce réseau. Zéro ou plusieurs
 * (bureau partagé, 4G derrière une même sortie) : on ne devine jamais, c'est le code de secours.
 */
export const APPARIEMENT_PAR_RESEAU_MS = 10 * 60_000;
/** Une adresse IPv4 vue en IPv6 (« ::ffff:1.2.3.4 ») est la même que l'IPv4 seule. */
export function adresseDuReseau(adresse: string): string {
  return adresse.trim().replace(/^::ffff:/i, '').toLowerCase();
}
function codeDuMemeReseau(adresse: string, maintenant: number): CodeDuRelais | null {
  const ici = adresseDuReseau(adresse);
  if (!ici || ici === 'inconnu') return null;
  const recents = lesCodes().filter((c) => c.adresse === ici && !c.utiliseLe && c.emisLe + APPARIEMENT_PAR_RESEAU_MS > maintenant);
  const comptes = new Set(recents.map((c) => c.compteId));
  if (comptes.size !== 1) return null;
  return recents.sort((a, b) => b.emisLe - a.emisLe)[0] ?? null;
}
/** Les comptes qui ont cliqué « Lier » il y a peu (n'importe quel réseau) : leur onglet ouvert attend peut-être le code de secours. */
function comptesQuiAttendentUnOrdinateur(maintenant: number): string[] {
  return [...new Set(lesCodes().filter((c) => c.emisLe + 30 * 60_000 > maintenant).map((c) => c.compteId))];
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
export function relierUnMac(demande: { code?: unknown; nom?: unknown; systeme?: unknown; ancien?: unknown }, adresse: string, maintenant = Date.now()): ResultatDeLiaisonDuRelais {
  if (tropDEssais(adresse, maintenant)) return { ok: false, raison: 'Trop d’essais : patientez une minute.' };
  const code = String(demande.code ?? '').replace(/\s+/g, '');
  if (!codeDeLiaisonValide(code)) return { ok: false, raison: 'Le code a six chiffres.' };
  const liste = lesCodes();
  const trouve = liste.find((c) => c.empreinte === empreinte(code) && codeVivant(c, maintenant));
  if (!trouve) return { ok: false, raison: 'Code inconnu, déjà servi ou expiré : Beluga vous demandera de relier cet ordinateur.' };
  trouve.utiliseLe = maintenant;
  rangerLesCodes(liste, maintenant);
  return lierPourLeCompte(trouve.compteId, trouve.ordinateurId, demande, maintenant);
}

/**
 * LE CŒUR DE LA LIAISON, commun au code (`relierUnMac`) et à la demande acceptée dans Beluga (`accepterUneLiaison`) :
 * le programme se rattache à l'ordinateur visé, sinon au sien d'avant (`ancien`), sinon à un ordinateur neuf.
 */
function lierPourLeCompte(
  compteId: string,
  ordinateurVise: string | null,
  demande: { nom?: unknown; systeme?: unknown; ancien?: unknown },
  maintenant: number,
): { ok: true; identifiant: string; secret: string; nom: string } {
  const id = crypto.randomBytes(9).toString('base64url');
  const nonce = crypto.randomBytes(12).toString('base64url');
  const systeme = systemeValable(demande.systeme) ?? 'mac';
  const nom = String(demande.nom ?? '').trim().slice(0, 60) || (systeme === 'mac' ? 'Mac' : systeme === 'windows' ? 'PC' : 'Linux');
  /* RELIÉ DE NOUVEAU (Beluga Connect Windows / Linux, 21/11/2026) : le programme donne son ancienne clé ; sans
     ordinateur visé par le code, il reprend SON ordinateur au lieu d'en créer un second. */
  const ancienne = lireIdentifiantDAppareil(demande.ancien);
  const precedent = ancienne ? relais().find((x) => x.id === ancienne.id && x.nonce === ancienne.nonce && x.compteId === compteId) : undefined;
  const ordinateurId =
    ligneDOrdinateur(compteId, ordinateurVise)?.id ??
    (precedent?.ordinateurId ? ligneDOrdinateur(compteId, precedent.ordinateurId)?.id : undefined) ??
    creerUnOrdinateur(compteId, nom, maintenant).id;
  proposerLeVraiNom(compteId, ordinateurId, nom);
  rattacherLesOrphelins();
  enregistrer([
    ...relais().filter((r) => !(r.compteId === compteId && r.ordinateurId === ordinateurId)),
    { id, compteId, nonce, nom, creeLe: maintenant, ordinateurId, ...(systeme === 'mac' ? {} : { systeme }) },
  ]);
  const cle = { compteId, id, nonce };
  log.info(`Beluga Connect relié (${nom}, ${systeme})`);
  bus.emit({ type: 'extension.change' });
  return { ok: true, identifiant: identifiantDAppareil(cle), secret: secretDeLAppareil(cle), nom };
}

/* ------------------------------------------------------------------ */
/* La liaison DEMANDÉE PAR L'APPLICATION (21/11/2026)                   */
/* ------------------------------------------------------------------ */

/*
 * « RELIER CE MAC ? » — LA LIAISON PART DE BELUGA CONNECT, PLUS DE LA PAGE (décision de l'utilisateur, 21/11/2026,
 * carte « Dépannage de publication discret ») : le lien `beluga-connect://relier` ouvert par la page était bloqué par
 * Chrome sans un mot, et « Relier maintenant » ne faisait rien. Désormais :
 *   1. l'application demande une liaison (`demanderUneLiaison`, sans session) et reçoit DEUX secrets : un JETON public,
 *      qu'elle met dans l'adresse de Beluga qu'elle ouvre (`/?liaison=<jeton>`), et une clé de
 *      RETRAIT qu'elle garde pour elle ;
 *   2. la page, AVEC la session de la personne, montre « Relier « <nom> » à Beluga ? » ; un clic sur « Relier »
 *      (`accepterUneLiaison`) relie l'ordinateur à CE compte ;
 *   3. l'application attend (`attendreLaLiaison`, clé de retrait) et reçoit sa clé d'appareil — qui ne passe donc
 *      JAMAIS par l'adresse ni par le navigateur.
 * Jeton à usage unique, dix minutes, demandes plafonnées par adresse ; tout vit en mémoire (un redémarrage du démon
 * les efface : l'application en redemande une sur « inconnue »).
 */
export const DUREE_DEMANDE_DE_LIAISON_MS = 10 * 60_000;
const ATTENTE_DE_LA_LIAISON_MS = 25_000;
const PLAFOND_DE_DEMANDES_PAR_ADRESSE = 5;

interface DemandeDeLiaison {
  jeton: string;
  retrait: string;
  adresse: string;
  nom: string;
  systeme: SystemeDOrdinateur;
  ancien?: string;
  expireLe: number;
  /** Le compte du code du téléchargement, quand l'application l'a fourni : la demande est poussée à SES onglets. */
  compteId?: string;
  /** Le jeton en clair, gardé EN MÉMOIRE seulement pour une demande rattachée à un compte (un onglet ouvert après coup la reprend). */
  jetonClair?: string;
  /** L'empreinte du CODE DE SECOURS affiché par Beluga Connect, à taper dans l'onglet quand rien n'a reconnu le compte. */
  secours?: string;
  /** Les comptes dont l'onglet a été prévenu qu'un code de secours attend. */
  prevenus?: string[];
  issue?: { ok: true; identifiant: string; secret: string; nom: string } | { ok: false };
}
/* Rangées par EMPREINTE de leur jeton ; l'empreinte du retrait sert à les retrouver côté application. */
const demandesDeLiaison = new Map<string, DemandeDeLiaison>();
const attentesDeLiaison = new Map<string, Set<() => void>>();

function oublierLesDemandesExpirees(maintenant: number): void {
  for (const [cle, d] of demandesDeLiaison) if (d.expireLe < maintenant) demandesDeLiaison.delete(cle);
}
function demandeParRetrait(retrait: string): [string, DemandeDeLiaison] | undefined {
  const cible = empreinte(retrait);
  for (const entree of demandesDeLiaison) if (entree[1].retrait === cible) return entree;
  return undefined;
}
function reveiller(cle: string): void {
  for (const f of attentesDeLiaison.get(cle) ?? []) f();
  attentesDeLiaison.delete(cle);
}

/**
 * L'APPLICATION DEMANDE UNE LIAISON, ET ELLE EST RELIÉE TOUTE SEULE (carte « Beluga Connect : liaison sans fenêtre »,
 * 22/11/2026 — plus aucun « Relier ce Mac ? » à cliquer, plus aucune page ouverte par Beluga Connect) :
 *   1. le code du téléchargement est connu (même servi ou expiré, quarante-huit heures) → relié AU COMPTE qui a cliqué
 *      « Lier », tout de suite : ce clic vaut l'accord ;
 *   2. sinon, UN SEUL compte a cliqué « Lier » depuis la même adresse publique depuis moins de dix minutes → relié à
 *      celui-là ;
 *   3. sinon (aucun, ou plusieurs) → on ne devine pas : un CODE DE SECOURS à six chiffres est rendu à Beluga Connect,
 *      qui l'affiche en grand, et les onglets des comptes qui viennent de cliquer « Lier » sont prévenus
 *      (`relaisMac.codeAttendu`) : on le tape dans l'onglet (`accepterParCodeDeSecours`).
 * Relié tout de suite, la réponse porte la clé (`etat: 'reliee'`) ; elle garde AUSSI le jeton et la clé de retrait :
 * un Beluga Connect d'avant (≤ 1.4) les attend, et sa première attente rend « acceptee » aussitôt.
 */
export function demanderUneLiaison(
  demande: { nom?: unknown; systeme?: unknown; ancien?: unknown; code?: unknown },
  adresse: string,
  maintenant = Date.now(),
):
  | {
      ok: true;
      jeton: string;
      retrait: string;
      expireLe: number;
      prevenus: number;
      etat: 'reliee' | 'code';
      identifiant?: string;
      secret?: string;
      nom?: string;
      codeDeSecours?: string;
    }
  | { ok: false; raison: string } {
  oublierLesDemandesExpirees(maintenant);
  if (tropDEssais(adresse, maintenant)) return { ok: false, raison: 'Trop d’essais : patientez une minute.' };
  const vivantes = [...demandesDeLiaison.values()].filter((d) => d.adresse === adresse && !d.issue);
  /* Une adresse ne garde que ses dernières demandes : la plus ancienne s'efface. */
  if (vivantes.length >= PLAFOND_DE_DEMANDES_PAR_ADRESSE) {
    const plusVieille = vivantes.sort((a, b) => a.expireLe - b.expireLe)[0];
    demandesDeLiaison.delete(plusVieille.jeton);
  }
  const jeton = crypto.randomBytes(24).toString('base64url');
  const retrait = crypto.randomBytes(32).toString('base64url');
  const systeme = systemeValable(demande.systeme) ?? 'mac';
  const nom = String(demande.nom ?? '').trim().slice(0, 60) || (systeme === 'mac' ? 'Mac' : systeme === 'windows' ? 'PC' : 'Linux');
  const ancien = typeof demande.ancien === 'string' && demande.ancien.length < 200 ? demande.ancien : undefined;
  const expireLe = maintenant + DUREE_DEMANDE_DE_LIAISON_MS;
  const d: DemandeDeLiaison = { jeton: empreinte(jeton), retrait: empreinte(retrait), adresse, nom, systeme, ancien, expireLe };
  demandesDeLiaison.set(d.jeton, d);

  /* 1 et 2 : le compte est CERTAIN — relié sans rien demander. */
  const parCode = codeConnu(demande.code, maintenant);
  const parReseau = parCode ? null : codeDuMemeReseau(adresse, maintenant);
  const certain = parCode ?? (parReseau ? { compteId: parReseau.compteId, ordinateurId: parReseau.ordinateurId } : null);
  if (certain) {
    if (parReseau) {
      const liste = lesCodes();
      const vu = liste.find((c) => c.empreinte === parReseau.empreinte);
      if (vu) vu.utiliseLe = maintenant;
      rangerLesCodes(liste, maintenant);
    }
    const issue = lierPourLeCompte(certain.compteId, certain.ordinateurId, { nom, systeme, ancien }, maintenant);
    d.compteId = certain.compteId;
    d.issue = issue;
    d.expireLe = Math.min(d.expireLe, maintenant + 2 * 60_000);
    log.info(`Beluga Connect relié tout seul (${nom}) ${parCode ? 'par le code du téléchargement' : 'par le même réseau'}`);
    return { ok: true, jeton, retrait, expireLe, prevenus: 0, etat: 'reliee', identifiant: issue.identifiant, secret: issue.secret, nom: issue.nom };
  }

  /* 3 : on ne devine pas — le code de secours. */
  let codeDeSecours = '';
  do codeDeSecours = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  while ([...demandesDeLiaison.values()].some((x) => x.secours === empreinte(codeDeSecours) && !x.issue));
  d.secours = empreinte(codeDeSecours);
  const ancienCompte = compteDeLAncienneCle(demande.ancien);
  const prevenir = [...new Set([...comptesQuiAttendentUnOrdinateur(maintenant), ...(ancienCompte ? [ancienCompte] : [])])];
  d.prevenus = prevenir;
  let prevenus = 0;
  for (const compte of prevenir) {
    bus.emit({ type: 'relaisMac.codeAttendu', pour: compte, nom, systeme, expireLe });
    prevenus += ecransOuvertsDuCompte(compte);
  }
  log.info(`Beluga Connect demande à se relier (${nom}) : compte incertain, code de secours affiché (${prevenir.length} compte(s) prévenu(s))`);
  return { ok: true, jeton, retrait, expireLe, prevenus, etat: 'code', codeDeSecours };
}

/** LE CODE DE SECOURS TAPÉ DANS L'ONGLET : la demande qui l'affiche est reliée au compte de la personne connectée. */
export function accepterParCodeDeSecours(
  compteId: string,
  code: unknown,
  ordinateurVise: string | null = null,
  maintenant = Date.now(),
): { ok: true; nom: string } | { ok: false; raison: string } {
  oublierLesDemandesExpirees(maintenant);
  if (tropDEssais(`secours:${compteId}`, maintenant)) return { ok: false, raison: 'Trop d’essais : patientez une minute.' };
  const net = String(code ?? '').replace(/\s+/g, '');
  if (!codeDeLiaisonValide(net)) return { ok: false, raison: 'Le code a six chiffres.' };
  const entree = [...demandesDeLiaison.entries()].find(([, x]) => x.secours === empreinte(net) && !x.issue);
  if (!entree) return { ok: false, raison: 'Ce code ne correspond à aucun ordinateur en attente : vérifiez-le dans la fenêtre de Beluga Connect.' };
  const [cle, d] = entree;
  const issue = lierPourLeCompte(compteId, ordinateurVise, { nom: d.nom, systeme: d.systeme, ancien: d.ancien }, maintenant);
  d.compteId = compteId;
  d.issue = issue;
  d.expireLe = Math.min(d.expireLe, maintenant + 2 * 60_000);
  reveiller(cle);
  return { ok: true, nom: issue.nom };
}

/** Un code de secours attend-il ce compte ? (un onglet ouvert après coup montre le champ à son tour) */
export function codeAttenduParLeCompte(compteId: string, maintenant = Date.now()): { nom: string; systeme: SystemeDOrdinateur; expireLe: number } | null {
  oublierLesDemandesExpirees(maintenant);
  const d = [...demandesDeLiaison.values()].filter((x) => x.secours && !x.issue && x.prevenus?.includes(compteId)).sort((a, b) => b.expireLe - a.expireLe)[0];
  return d ? { nom: d.nom, systeme: d.systeme, expireLe: d.expireLe } : null;
}

/** Les demandes « Relier ce Mac ? » à cliquer n'existent plus (liaison toute seule) : rien n'attend un clic. */
export function demandesEnAttenteDuCompte(compteId: string, maintenant = Date.now()): { jeton: string; nom: string; systeme: SystemeDOrdinateur }[] {
  oublierLesDemandesExpirees(maintenant);
  return [...demandesDeLiaison.values()]
    .filter((d) => d.compteId === compteId && !d.issue && d.jetonClair)
    .map((d) => ({ jeton: d.jetonClair!, nom: d.nom, systeme: d.systeme }));
}

/** Ce que la page montre d'une demande (avec session) : le nom et le système de l'ordinateur, ou rien si elle est morte. */
export function lireUneDemandeDeLiaison(jeton: string, maintenant = Date.now()): { nom: string; systeme: SystemeDOrdinateur; expireLe: number } | null {
  oublierLesDemandesExpirees(maintenant);
  const d = demandesDeLiaison.get(empreinte(String(jeton)));
  if (!d || d.issue) return null;
  return { nom: d.nom, systeme: d.systeme, expireLe: d.expireLe };
}

/** « Relier » : l'ordinateur est relié au compte de la personne connectée. Usage unique. */
export function accepterUneLiaison(
  compteId: string,
  jeton: string,
  ordinateurVise: string | null = null,
  maintenant = Date.now(),
): { ok: true; nom: string } | { ok: false; raison: string } {
  oublierLesDemandesExpirees(maintenant);
  const cle = empreinte(String(jeton));
  const d = demandesDeLiaison.get(cle);
  if (!d || d.issue) return { ok: false, raison: 'Cette demande a expiré : rouvrez Beluga Connect sur l’ordinateur.' };
  /* Une demande rattachée à un compte (par le code du téléchargement) ne se relie qu'à CE compte. */
  if (d.compteId && d.compteId !== compteId) return { ok: false, raison: 'Cette demande vient d’un autre compte.' };
  const issue = lierPourLeCompte(compteId, ordinateurVise, { nom: d.nom, systeme: d.systeme, ancien: d.ancien }, maintenant);
  d.issue = issue;
  /* Le temps que l'application vienne la chercher, pas plus. */
  d.expireLe = Math.min(d.expireLe, maintenant + 2 * 60_000);
  reveiller(cle);
  return { ok: true, nom: issue.nom };
}

/** « Pas maintenant » : l'application l'apprend à sa prochaine attente. */
export function refuserUneLiaison(jeton: string, maintenant = Date.now()): boolean {
  oublierLesDemandesExpirees(maintenant);
  const cle = empreinte(String(jeton));
  const d = demandesDeLiaison.get(cle);
  if (!d || d.issue) return false;
  d.issue = { ok: false };
  d.expireLe = Math.min(d.expireLe, maintenant + 2 * 60_000);
  reveiller(cle);
  return true;
}

export type IssueDeLaLiaison =
  | { etat: 'attente' }
  | { etat: 'acceptee'; identifiant: string; secret: string; nom: string }
  | { etat: 'refusee' }
  | { etat: 'inconnue' };

/** L'application attend la réponse de la personne (longue attente) ; la clé ne lui est remise qu'UNE fois. */
export async function attendreLaLiaison(retrait: string, attente = ATTENTE_DE_LA_LIAISON_MS): Promise<IssueDeLaLiaison> {
  oublierLesDemandesExpirees(Date.now());
  const trouvee = demandeParRetrait(String(retrait));
  if (!trouvee) return { etat: 'inconnue' };
  const [cle] = trouvee;
  if (!trouvee[1].issue && attente > 0) {
    await new Promise<void>((fini) => {
      const minuteur = setTimeout(() => {
        attentesDeLiaison.get(cle)?.delete(reveil);
        fini();
      }, attente);
      const reveil = () => {
        clearTimeout(minuteur);
        fini();
      };
      if (!attentesDeLiaison.has(cle)) attentesDeLiaison.set(cle, new Set());
      attentesDeLiaison.get(cle)!.add(reveil);
    });
  }
  const d = demandesDeLiaison.get(cle);
  if (!d) return { etat: 'inconnue' };
  if (!d.issue) return { etat: 'attente' };
  demandesDeLiaison.delete(cle);
  if (!d.issue.ok) return { etat: 'refusee' };
  return { etat: 'acceptee', identifiant: d.issue.identifiant, secret: d.issue.secret, nom: d.issue.nom };
}

/** Délier le programme du Mac d'un ordinateur (ou tous ceux du compte, sans ordinateur donné). */
export function delierLeMac(compteId: string, ordinateurId?: string | null): boolean {
  rattacherLesOrphelins();
  const avant = relais();
  const apres = avant.filter((r) => r.compteId !== compteId || (ordinateurId ? r.ordinateurId !== ordinateurId : false));
  if (apres.length === avant.length) return false;
  /* L'application déliée redemande sa liaison avec son ancienne clé : on garde trente jours À QUEL COMPTE elle était,
     pour pousser « Relier ce Mac ? » à ses onglets ouverts au lieu d'ouvrir une page. */
  const partis = avant.filter((r) => !apres.includes(r)).map((r) => ({ id: r.id, nonce: empreinte(r.nonce), compteId: r.compteId, le: Date.now() }));
  setMeta(CLE_DELIES, JSON.stringify([...lesDelies(), ...partis].filter((d) => Date.now() - d.le < 30 * 86_400_000).slice(-100)));
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
  systeme?: SystemeDOrdinateur;
  arch?: string;
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
  /** Le système rapporté par Beluga Connect Windows / Linux ; absent : un Mac. */
  systeme?: SystemeDOrdinateur;
  /** L'architecture rapportée (amd64, arm64) : le bon paquet pour la mise à jour. */
  arch?: string;
}

/** Dernière demande de remplacement envoyée à chaque relais : une seule toutes les dix minutes. */
const remplacementsDemandes = new Map<string, number>();

/**
 * UN RELAIS EN RETARD SE REMPLACE SEUL (20/11/2026) : s'il tourne sous le lanceur fixe et que sa version est plus
 * ancienne que celle servie, le démon lui confie `se_mettre_a_jour` avec l'empreinte du fichier servi. Sans lanceur
 * (installation d'avant), rien : il faut rejouer la commande d'installation une fois.
 */
function remplacerSiEnRetard(appareilId: string, etat: EtatRapporteParLeRelais, maintenant = Date.now()): void {
  if (!etat.lanceur || (etat.systeme && etat.systeme !== 'mac')) return;
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
  systeme: SystemeDOrdinateur;
  relieLe: number | null;
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
    systeme: systemeDuRelais(r, n),
    relieLe: r?.creeLe ?? null,
    etat: etatDuRelais({ relie: !!r, vuLe: n?.vuLe, maintenant, recopie: n?.recopie, verrouille: n?.verrouille }),
  };
}

/** Le système d'un relais : celui noté à la liaison, sinon celui qu'il rapporte, sinon un Mac. */
function systemeDuRelais(r: RelaisRelie | undefined, n: Nouvelles | undefined): SystemeDOrdinateur {
  return r?.systeme ?? n?.systeme ?? 'mac';
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
  /* L'iPhone ne se pilote que depuis un Mac : les Mac passent devant les PC. */
  const rangDuSysteme = (e: EtatDUnRelais) => (e.systeme === 'mac' ? 0 : 1);
  return etats.sort((a, b) => rangDuSysteme(a) - rangDuSysteme(b) || RANG_DE_L_ETAT[a.etat] - RANG_DE_L_ETAT[b.etat])[0] ?? etatDe(undefined, maintenant);
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
  safari: PreparationDeSafari | null;
  systeme: SystemeDOrdinateur;
  relieLe: number | null;
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
        preparation: preparationDe(r.ordinateurId!, maintenant),
        safari: lesSafaris().get(r.ordinateurId!) ?? null,
        systeme: e.systeme,
        relieLe: e.relieLe,
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
export async function ouvrirUnReglageDuMac(compteId: string, ordinateurId: string, reglage: 'accessibilite' | 'ecran' | 'aide'): Promise<void> {
  const r = relaisDuCompte(compteId, Date.now(), ordinateurId);
  if (!r.appareilId || r.ordinateurId !== ordinateurId) throw new Error('Le programme du Mac n’est pas installé sur cet ordinateur.');
  if (r.etat === 'hors-ligne' || r.etat === 'absent') throw new Error('Le programme du Mac ne répond pas : le Mac est-il allumé ?');
  if (r.systeme !== 'mac') throw new Error('Cet ordinateur n’est pas un Mac : il n’a aucune autorisation à donner.');
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

/*
 * LES PAQUETS DE BELUGA CONNECT PAR SYSTÈME (carte « Beluga Connect : installation simplifiée », 21/11/2026) : le Mac
 * reçoit l'archive signée et notarisée (Swift, fabriquée sur le Mac mini) ; Windows et Linux reçoivent l'application Go
 * (`connect/go/`, fabriquée depuis Linux par `connect/go/fabriquer.sh`), un seul fichier par système et architecture.
 * Tous vivent dans `connect/paquet/` (versionné et publié) ; la version Go est dans `version-go.txt`.
 */
export type CleDePaquet = 'mac' | 'mac-dmg' | 'windows' | 'linux-amd64' | 'linux-arm64';
const FICHIERS_DES_PAQUETS: Record<CleDePaquet, { fichier: string; version: string; route: string; type: string }> = {
  mac: { fichier: 'Beluga-Connect.zip', version: 'version.txt', route: '/api/connect/Beluga-Connect.zip', type: 'application/zip' },
  /* L'IMAGE DISQUE « glisser dans Applications » (carte « Liaison d'ordinateur simplifiée », 22/11/2026) : ce qu'on
     télécharge à la main. Le zip reste celui de la mise à jour d'elle-même de Beluga Connect (`/api/connect/version`). */
  'mac-dmg': { fichier: 'Beluga-Connect.dmg', version: 'version.txt', route: '/api/connect/Beluga-Connect.dmg', type: 'application/x-apple-diskimage' },
  windows: { fichier: 'Beluga-Connect-Windows.exe', version: 'version-go.txt', route: '/api/connect/Beluga-Connect-Windows.exe', type: 'application/vnd.microsoft.portable-executable' },
  'linux-amd64': { fichier: 'beluga-connect-linux-amd64', version: 'version-go.txt', route: '/api/connect/beluga-connect-linux-amd64', type: 'application/octet-stream' },
  'linux-arm64': { fichier: 'beluga-connect-linux-arm64', version: 'version-go.txt', route: '/api/connect/beluga-connect-linux-arm64', type: 'application/octet-stream' },
};

/** La route publique de chaque paquet, et la clé qu'elle sert. */
export function paquetDeLaRoute(route: string): CleDePaquet | null {
  return (Object.keys(FICHIERS_DES_PAQUETS) as CleDePaquet[]).find((c) => FICHIERS_DES_PAQUETS[c].route === route) ?? null;
}

const paquets = new Map<CleDePaquet, { octets: Buffer; version: string; empreinte: string; mtime: number }>();

function dossierDesPaquets(): string | null {
  for (const candidat of [
    path.resolve(process.cwd(), 'connect/paquet'),
    path.resolve(process.cwd(), '../connect/paquet'),
    path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../connect/paquet'),
  ]) {
    if (fs.existsSync(candidat)) return candidat;
  }
  return null;
}

/** Un paquet de Beluga Connect servi par ce Beluga, sa version et son empreinte (relu si le fichier change). */
export function paquetDeConnect(cle: CleDePaquet): { octets: Buffer; version: string; empreinte: string; route: string; fichier: string; type: string } | null {
  const dossier = dossierDesPaquets();
  const f = FICHIERS_DES_PAQUETS[cle];
  if (!dossier || !f) return null;
  const chemin = path.join(dossier, f.fichier);
  if (!fs.existsSync(chemin)) return null;
  const mtime = fs.statSync(chemin).mtimeMs;
  let p = paquets.get(cle);
  if (!p || p.mtime !== mtime) {
    const octets = fs.readFileSync(chemin);
    let version = '0';
    try {
      version = fs.readFileSync(path.join(dossier, f.version), 'utf8').trim();
    } catch {
      /* sans version : 0, jamais proposée comme mise à jour */
    }
    p = { octets, version, empreinte: crypto.createHash('sha256').update(octets).digest('hex'), mtime };
    paquets.set(cle, p);
  }
  return { octets: p.octets, version: p.version, empreinte: p.empreinte, route: f.route, fichier: f.fichier, type: f.type };
}

/** L'archive de Beluga Connect pour Mac (forme d'avant, gardée pour ses appelants). */
export function archiveDeConnect(): { zip: Buffer; version: string; empreinte: string } | null {
  const p = paquetDeConnect('mac');
  return p ? { zip: p.octets, version: p.version, empreinte: p.empreinte } : null;
}

/** Le paquet qu'un programme relié doit recevoir pour se mettre à jour (son système, son architecture). */
function paquetDuProgramme(systeme: SystemeDOrdinateur, arch: string | undefined): CleDePaquet {
  if (systeme === 'windows') return 'windows';
  if (systeme === 'linux') return arch === 'arm64' ? 'linux-arm64' : 'linux-amd64';
  return 'mac';
}

/*
 * LES PRÉPARATIONS DE CHROME (carte « Liaison Chrome automatique et suivie », 22/11/2026) : gardées dans `meta` pour
 * survivre à un rechargement comme à un redémarrage du démon. Une préparation « en cours » laissée par le démon d'avant
 * n'a plus personne pour la finir : elle devient un échec dit au chargement. `enCoursIci` est la seule garde contre
 * deux préparations simultanées du même ordinateur.
 */
const CLE_DES_PREPARATIONS = 'relais-mac.preparations';
let preparations: Map<string, PreparationDeChrome> | null = null;
const enCoursIci = new Set<string>();
const derniersEssais = new Map<string, number>();

function lesPreparations(): Map<string, PreparationDeChrome> {
  if (preparations) return preparations;
  preparations = new Map();
  try {
    const brut = JSON.parse(getMeta(CLE_DES_PREPARATIONS) ?? '{}') as Record<string, PreparationDeChrome>;
    for (const [id, p] of Object.entries(brut)) {
      if (!p || typeof p !== 'object') continue;
      preparations.set(id, p.etat === 'en-cours' ? { ...p, etat: 'echec', message: p.message || 'La préparation de Chrome s’est interrompue (Beluga a redémarré).' } : p);
    }
  } catch {
    /* base pas encore prête : on repart à vide */
  }
  return preparations;
}

/** La préparation à montrer : figée = échec, et un refus du code signalé par l'extension remonte aussitôt. */
function preparationDe(ordinateurId: string, maintenant = Date.now()): PreparationDeChrome | null {
  const p = preparationVue(lesPreparations().get(ordinateurId), maintenant);
  if (!p || p.etat !== 'en-cours' || !p.debutLiaison) return p;
  const refus = echecDeLiaisonSignale(ordinateurId, p.debutLiaison);
  return refus ? { ...p, etat: 'echec', message: `Chrome n’a pas pu se relier seul : ${refus.raison}` } : p;
}

/** Vrai (et noté) si ce geste n'a pas été tenté sur ce relais depuis `ms`. */
function auPlusToutesLes(cle: string, ms: number, maintenant = Date.now()): boolean {
  if (maintenant - (derniersEssais.get(cle) ?? 0) < ms) return false;
  derniersEssais.set(cle, maintenant);
  return true;
}

function poserLaPreparation(ordinateurId: string, p: PreparationDeChrome): void {
  const toutes = lesPreparations();
  const neuve = { ...p, majLe: Date.now() };
  toutes.set(ordinateurId, neuve);
  log.info(
    `Beluga Connect : préparation de Chrome (${ordinateurId}) ${neuve.travail ?? 'installation'} → ${neuve.etat}` +
      `${neuve.ajoutee === true ? ', extension ajoutée' : ''}${neuve.debutLiaison ? ', code posé' : ''}${neuve.message ? ` — ${neuve.message}` : ''}`,
  );
  try {
    /* Les préparations de plus d'une semaine sont oubliées : l'état se relit alors sur les navigateurs eux-mêmes. */
    const garde = Object.fromEntries([...toutes].filter(([, x]) => Date.now() - (x.majLe ?? x.depuis) < 7 * 86_400_000));
    setMeta(CLE_DES_PREPARATIONS, JSON.stringify(garde));
  } catch {
    /* base fermée à l'arrêt */
  }
  bus.emit({ type: 'extension.change' });
}

/** Après chaque attente du relais : migration vers Beluga Connect, ou préparation de Chrome. Jamais bloquant. */
function apresLAttente(appareilId: string, etat: EtatRapporteParLeRelais): void {
  const r = relais().find((x) => x.id === appareilId);
  if (!r?.ordinateurId || (etat.version ?? 1) < 3) return;
  const mac = systemeDuRelais(r, nouvelles.get(appareilId)) === 'mac';
  if (!etat.connect && mac) {
    const a = archiveDeConnect();
    if (!etat.lanceur || !a || !auPlusToutesLes(`connect:${appareilId}`, 6 * 3600_000)) return;
    log.info(`relais du Mac « ${r.nom} » : passage à Beluga Connect ${a.version}`);
    void demanderAuRelais(appareilId, 'installer_connect', { chemin: '/api/connect/Beluga-Connect.zip', empreinte: a.empreinte, version: a.version }, 180_000).catch((e) =>
      log.warn('relais du Mac : passage à Beluga Connect refusé', String((e as Error)?.message ?? e)),
    );
    return;
  }
  /* Sur un Mac, poser l'extension demande « Contrôler le Mac » ; Windows et Linux n'ont rien à autoriser. */
  if (mac && etat.accessibilite !== true) return;
  if (!etat.connect) return;
  void preparerChrome(r.compteId, r, false)
    /* SAFARI D'OFFICE, APRÈS CHROME : seulement une fois Chrome prêt (relié, navigation privée vérifiée). */
    .then(() => (mac && (etat.version ?? 1) >= 7 ? preparerSafari(r.compteId, r, false) : undefined))
    .catch((e) => log.warn('Beluga Connect : préparation de Chrome', String((e as Error)?.message ?? e)));
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

/** Cet ordinateur a-t-il déjà eu un Chrome relié (même délié depuis) ? Sinon, c'est son installation. */
function dejaEuUnChrome(compteId: string, ordinateurId: string): boolean {
  try {
    return !!getDb().prepare("SELECT 1 FROM chrome_appareils WHERE compte_id = ? AND ordinateur_id = ? AND navigateur = 'chrome' LIMIT 1").get(compteId, ordinateurId);
  } catch {
    return false;
  }
}

/**
 * PRÉPARER CHROME sur le Mac de ce relais : poser et relier l'extension si ce Mac n'a aucun Chrome relié, puis cocher
 * la navigation privée si l'extension dit ne pas l'avoir. `force` (« Réparer », « Réessayer », Chrome délié) passe outre
 * les délais entre essais. Chaque issue est POSÉE : la préparation ne reste jamais « en cours » une fois sortie d'ici.
 */
export async function preparerChrome(compteId: string, r: RelaisRelie, force: boolean): Promise<void> {
  const ordinateurId = r.ordinateurId;
  if (!ordinateurId || enCoursIci.has(ordinateurId)) return;
  enCoursIci.add(ordinateurId);
  try {
    await preparerChromeSansGarde(compteId, r, ordinateurId, force);
  } finally {
    enCoursIci.delete(ordinateurId);
    const p = lesPreparations().get(ordinateurId);
    if (p?.etat === 'en-cours') {
      /* Filet : une issue oubliée se lit sur le navigateur lui-même. */
      const relie = (await chromesDeLOrdinateur(compteId, ordinateurId).catch(() => [])).find((c) => c.enLigne);
      poserLaPreparation(ordinateurId, relie ? { ...p, etat: 'fait', ajoutee: true } : { ...p, etat: 'echec', message: p.message || 'Chrome ne s’est pas relié à Beluga.' });
    }
  }
}

async function preparerChromeSansGarde(compteId: string, r: RelaisRelie, ordinateurId: string, force: boolean): Promise<void> {
  let chromes = await chromesDeLOrdinateur(compteId, ordinateurId);
  const depuis = Date.now();
  const travail: TravailDeConnect = !force && !dejaEuUnChrome(compteId, ordinateurId) ? 'installation' : 'reparation';
  /* « RÉPARER » (22/11/2026) : une extension retirée à la main laisse sa fiche, hors ligne ; un clic sur « Réparer »
     refait donc l'installation dès qu'aucun Chrome de l'ordinateur ne répond (Chrome fermé : il est rouvert). */
  if (!chromes.length || (force && !chromes.some((c) => c.enLigne))) {
    /* Dix minutes entre deux essais : la durée de vie d'un code, pour que `liaison.json` en porte toujours un valable. */
    if (!force && !auPlusToutesLes(`installer:${r.id}`, 10 * 60_000)) return;
    poserLaPreparation(ordinateurId, { etat: 'en-cours', ajoutee: null, message: null, depuis, travail, debutLiaison: null });
    try {
      const { emettreUnCodeDeLiaison } = await import('./extension-chrome.js');
      const { preparerLePaquet } = await import('./mise-a-jour-extension.js');
      const { code } = emettreUnCodeDeLiaison(compteId, Date.now(), { ordinateurId, usage: 'fichier' });
      const { jeton, empreinte } = await preparerLePaquet(r.id);
      /* Trois essais d'ajout, Chrome quitté puis rouvert entre deux : jusqu'à sept minutes (le relais « qui ne
         répondait pas à temps » chez l'utilisateur travaillait encore). */
      const fait = await demanderAuRelais<{ ajoutee?: boolean; detail?: string; dossier?: string; dossiers?: string[]; developpeur?: boolean; rouvert?: boolean; essais?: number }>(
        r.id,
        'installer_extension',
        { chemin: `/api/relais-mac/extension.zip?jeton=${jeton}`, empreinte, version: VERSION_EXTENSION_CHROME, code },
        420_000,
      );
      const ajoutee = fait.ajoutee === true;
      log.info(`Beluga Connect : extension posée (${ajoutee ? 'ajoutée à Chrome' : 'pas ajoutée'}) dans ${(fait.dossiers ?? [fait.dossier]).filter(Boolean).join(', ') || '?'}`);
      const suivi = { developpeur: fait.developpeur ?? ajoutee, rouvert: fait.rouvert ?? null, essais: fait.essais ?? 0 };
      poserLaPreparation(ordinateurId, {
        etat: 'en-cours',
        ajoutee,
        message: fait.detail || null,
        depuis,
        travail,
        dossier: fait.dossier ?? null,
        debutLiaison: ajoutee ? Date.now() : null,
        ...suivi,
      });
      const relie = await attendreQue(async () => {
        if (echecDeLiaisonSignale(ordinateurId, depuis)) return { refuse: true } as const;
        return (await chromesDeLOrdinateur(compteId, ordinateurId)).find((c) => c.enLigne);
      }, ajoutee ? 90_000 : 20_000);
      if (!relie || 'refuse' in relie) {
        const refus = echecDeLiaisonSignale(ordinateurId, depuis);
        poserLaPreparation(ordinateurId, {
          etat: 'echec',
          ajoutee,
          message: refus
            ? `Chrome n’a pas pu se relier seul : ${refus.raison}`
            : ajoutee
              ? 'Chrome ne s’est pas relié à Beluga tout seul.'
              : (fait.detail ?? 'L’extension n’a pas pu être ajoutée à Chrome.'),
          depuis,
          travail,
          dossier: fait.dossier ?? null,
          debutLiaison: lesPreparations().get(ordinateurId)?.debutLiaison ?? null,
          ...suivi,
        });
        return;
      }
      chromes = [relie];
    } catch (e) {
      poserLaPreparation(ordinateurId, { etat: 'echec', ajoutee: false, message: String((e as Error)?.message ?? e), depuis, travail, debutLiaison: null });
      return;
    }
  }
  const chrome = chromes[0]!;
  const enCours = () => lesPreparations().get(ordinateurId)?.etat === 'en-cours';
  const fini = () => {
    if (enCours()) poserLaPreparation(ordinateurId, { ...lesPreparations().get(ordinateurId)!, etat: 'fait', ajoutee: true, message: null });
  };
  /* La case « navigation privée » ne se coche seule que sur un Mac (pilotage de chrome://extensions par macOS). */
  if (systemeDuRelais(r, nouvelles.get(r.id)) !== 'mac') return fini();
  if (!chrome.enLigne || !versionAuMoins(chrome.version, '1.0.11')) return fini();
  /* LA PREUVE, PAS LA CASE (carte « Beluga Connect : liaison sans fenêtre », 22/11/2026) : extension ≥ 1.0.16, une vraie
     fenêtre privée réduite s'ouvre puis se referme ; avant, la case seule. */
  const { prouverLaNavigationPrivee } = await import('./extension-chrome.js');
  const dejaProuve = await prouverLaNavigationPrivee(chrome.id);
  if (dejaProuve === true || (dejaProuve === null && chrome.incognito === true)) return fini();
  const ligne = getDb().prepare('SELECT extension_id FROM chrome_appareils WHERE id = ? AND extension_id IS NOT NULL').get(chrome.id) as { extension_id: string } | undefined;
  /* Pas encore d'identifiant (le bonjour arrive) ou essai trop récent : la liaison est faite, la case reste à cocher.
     Avant, la préparation restait « en cours » à vie dans ces deux cas. */
  if (!ligne || (!force && !auPlusToutesLes(`prive:${r.id}`, 30 * 60_000))) {
    if (enCours()) {
      poserLaPreparation(ordinateurId, { ...lesPreparations().get(ordinateurId)!, etat: 'echec', ajoutee: true, message: 'La navigation privée reste à autoriser.' });
    }
    return;
  }
  const avant = lesPreparations().get(ordinateurId);
  const base: PreparationDeChrome = enCours() && avant ? avant : { etat: 'en-cours', ajoutee: true, message: null, depuis, travail: 'prive', debutLiaison: null };
  poserLaPreparation(ordinateurId, { ...base, etat: 'en-cours', ajoutee: true, message: null });
  try {
    await demanderAuRelais(r.id, 'autoriser_navigation_privee', { extensionId: ligne.extension_id }, 90_000);
    /* Cocher la case recharge l'extension : on attend qu'elle revienne, puis la preuve (≥ 1.0.16) ou sa parole (avant). */
    const prive = await attendreQue(async () => {
      const revenu = (await chromesDeLOrdinateur(compteId, ordinateurId)).find((c) => c.id === chrome.id && c.enLigne);
      if (!revenu) return null;
      const preuve = await prouverLaNavigationPrivee(chrome.id);
      return preuve === true || (preuve === null && revenu.incognito === true) ? revenu : null;
    }, 45_000);
    poserLaPreparation(
      ordinateurId,
      prive
        ? { ...base, etat: 'fait', ajoutee: true, message: null }
        : { ...base, etat: 'echec', ajoutee: true, message: 'La navigation privée n’a pas pu être vérifiée : aucune fenêtre privée n’a pu s’ouvrir.' },
    );
  } catch (e) {
    poserLaPreparation(ordinateurId, { ...base, etat: 'echec', ajoutee: true, message: String((e as Error)?.message ?? e) });
  }
}

/* ------------------------------------------------------------------ */
/* SAFARI D'OFFICE, APRÈS CHROME (carte « Beluga Connect : liaison sans fenêtre », 22/11/2026) */
/* ------------------------------------------------------------------ */

const CLE_SAFARIS = 'relais-mac.safaris';
let safaris: Map<string, PreparationDeSafari> | null = null;
const safariEnCours = new Set<string>();

function lesSafaris(): Map<string, PreparationDeSafari> {
  if (safaris) return safaris;
  safaris = new Map();
  try {
    const brut = JSON.parse(getMeta(CLE_SAFARIS) ?? '{}') as Record<string, PreparationDeSafari>;
    for (const [id, p] of Object.entries(brut)) {
      if (!p || typeof p !== 'object') continue;
      safaris.set(id, p.etat === 'en-cours' ? { ...p, etat: 'echec', message: p.message || 'L’installation de Safari s’est interrompue (Beluga a redémarré).' } : p);
    }
  } catch {
    /* base pas encore prête */
  }
  return safaris;
}

function poserSafari(ordinateurId: string, p: PreparationDeSafari): void {
  const toutes = lesSafaris();
  toutes.set(ordinateurId, { ...p, majLe: Date.now() });
  log.info(`Beluga Connect : Safari (${ordinateurId}) → ${p.etat}${p.message ? ` — ${p.message}` : ''}`);
  try {
    setMeta(CLE_SAFARIS, JSON.stringify(Object.fromEntries([...toutes].filter(([, x]) => Date.now() - (x.majLe ?? x.depuis) < 7 * 86_400_000))));
  } catch {
    /* base fermée */
  }
  bus.emit({ type: 'extension.change' });
}

async function safarisDeLOrdinateur(compteId: string, ordinateurId: string) {
  const { chromesDuCompte } = await import('./extension-chrome.js');
  return chromesDuCompte(compteId).filter((c) => c.ordinateurId === ordinateurId && c.genre === 'safari');
}

/** L'état de Safari pour la fenêtre de Beluga Connect et la page : préparation + Safari relié, en trois lignes. */
async function etatDeSafariPourConnect(compteId: string, ordinateurId: string, chromePret: boolean) {
  const p = lesSafaris().get(ordinateurId) ?? null;
  const relie = (await safarisDeLOrdinateur(compteId, ordinateurId)).some((c) => c.enLigne);
  return {
    etat: relie ? 'fait' : p?.etat ?? (chromePret ? 'a-venir' : 'apres-chrome'),
    etapes: etapesDeSafari(p, relie, !chromePret && !p),
    raison: p?.etat === 'echec' ? p.message : null,
  };
}

/**
 * INSTALLER SAFARI SUR CE MAC, APRÈS CHROME : l'application signée « Beluga » est posée par Beluga Connect, l'extension
 * cochée dans les réglages de Safari, et le code de liaison passé par le conteneur partagé — rien à télécharger ni à
 * taper pour la personne. Une seule fois (ou sur « Réparer » / « Installer dans Safari », `force`) ; jamais avant que
 * Chrome soit prêt. Chaque issue est POSÉE.
 */
export async function preparerSafari(compteId: string, r: RelaisRelie, force: boolean): Promise<{ ok: boolean; texte: string }> {
  const ordinateurId = r.ordinateurId;
  if (!ordinateurId) return { ok: false, texte: 'Ce Mac n’est rattaché à aucun ordinateur dans Beluga.' };
  if (systemeDuRelais(r, nouvelles.get(r.id)) !== 'mac') return { ok: false, texte: 'Safari n’existe que sur Mac.' };
  if (safariEnCours.has(ordinateurId)) return { ok: true, texte: 'Safari est déjà en cours d’installation.' };
  if ((nouvelles.get(r.id)?.version ?? 1) < 7) return { ok: false, texte: 'Beluga Connect doit d’abord se mettre à jour sur ce Mac.' };
  /* Chrome d'abord : relié, et vérifié en navigation privée. */
  const chromes = await chromesDeLOrdinateur(compteId, ordinateurId);
  const chromePret = chromes.some((c) => c.enLigne && c.incognito === true) && lesPreparations().get(ordinateurId)?.etat !== 'en-cours';
  if (!chromePret && !force) return { ok: false, texte: 'Safari s’installera dès que Chrome sera prêt.' };
  const deja = await safarisDeLOrdinateur(compteId, ordinateurId);
  if (deja.length && !force) return { ok: true, texte: 'Safari est déjà relié sur ce Mac.' };
  const avant = lesSafaris().get(ordinateurId);
  if (!force && avant && (avant.etat === 'echec' || avant.etat === 'fait') && !auPlusToutesLes(`safari:${r.id}`, 6 * 3600_000)) {
    return { ok: false, texte: avant.message ?? 'Safari a déjà été essayé.' };
  }
  const { paquetSafari } = await import('./extension-safari.js');
  const paquet = paquetSafari();
  const depuis = Date.now();
  if (!paquet) {
    poserSafari(ordinateurId, { etat: 'echec', installee: false, activee: null, message: 'L’extension Safari n’est pas encore fabriquée sur ce serveur.', depuis });
    return { ok: false, texte: 'L’extension Safari n’est pas encore fabriquée sur ce serveur.' };
  }
  safariEnCours.add(ordinateurId);
  poserSafari(ordinateurId, { etat: 'en-cours', installee: null, activee: null, message: null, depuis });
  try {
    const empreinte = crypto.createHash('sha256').update(fs.readFileSync(paquet.chemin)).digest('hex');
    const { emettreUnCodeDeLiaison } = await import('./extension-chrome.js');
    const { code } = emettreUnCodeDeLiaison(compteId, Date.now(), { ordinateurId, usage: 'safari' });
    const fait = await demanderAuRelais<{ installee?: boolean; activee?: boolean; sites?: boolean; detail?: string }>(
      r.id,
      'installer_safari',
      { chemin: '/api/relais-mac/extension-safari.zip', empreinte, code },
      240_000,
    );
    const installee = fait.installee === true;
    const activee = fait.activee === true;
    poserSafari(ordinateurId, { etat: 'en-cours', installee, activee, message: fait.detail || null, depuis });
    if (!activee) {
      poserSafari(ordinateurId, { etat: 'echec', installee, activee, message: fait.detail || 'L’extension n’a pas pu être cochée dans les réglages de Safari.', depuis });
      return { ok: false, texte: 'L’extension Safari n’a pas pu être activée.' };
    }
    const relie = await attendreQue(async () => (await safarisDeLOrdinateur(compteId, ordinateurId)).find((c) => c.enLigne), 90_000);
    poserSafari(
      ordinateurId,
      relie
        ? { etat: 'fait', installee, activee, message: null, depuis }
        : { etat: 'echec', installee, activee, message: 'Safari ne s’est pas relié à Beluga tout seul.', depuis },
    );
    return relie ? { ok: true, texte: 'Safari est relié à Beluga.' } : { ok: false, texte: 'Safari ne s’est pas relié à Beluga tout seul.' };
  } catch (e) {
    poserSafari(ordinateurId, { etat: 'echec', installee: lesSafaris().get(ordinateurId)?.installee ?? false, activee: null, message: String((e as Error)?.message ?? e), depuis });
    return { ok: false, texte: String((e as Error)?.message ?? e) };
  } finally {
    safariEnCours.delete(ordinateurId);
  }
}

/** « Installer dans Safari » de Beluga web : Beluga Connect de cet ordinateur installe Safari (sans délai). */
export function preparerSafariDeLOrdinateur(compteId: string, ordinateurId: string): boolean {
  const r = relais().find((x) => x.compteId === compteId && x.ordinateurId === ordinateurId);
  if (!r || !nouvelles.get(r.id)?.connect) return false;
  void preparerSafari(compteId, r, true).catch(() => {});
  return true;
}

/** Le paquet Safari signé servi au relais par la voie signée (`/api/relais-mac/extension-safari.zip`). */
export async function paquetSafariPourLeRelais(): Promise<Buffer | null> {
  const { paquetSafari } = await import('./extension-safari.js');
  const p = paquetSafari();
  return p ? fs.readFileSync(p.chemin) : null;
}

/**
 * UN CHROME DÉLIÉ SUR UN ORDINATEUR QUI GARDE SON BELUGA CONNECT (même carte) : la préparation repart aussitôt, sans le
 * délai entre essais, une seule fois par révocation. L'ordinateur délié en entier (ou sans Connect en ligne) : rien.
 */
export function reprendreApresUneRevocation(compteId: string, ordinateurId: string): boolean {
  if (!ligneDOrdinateur(compteId, ordinateurId)) return false;
  const r = relais().find((x) => x.compteId === compteId && x.ordinateurId === ordinateurId);
  if (!r || !nouvelles.get(r.id)?.connect) return false;
  const etat = etatDe(r, Date.now());
  if (etat.etat === 'hors-ligne' || etat.etat === 'absent') return false;
  if (etat.systeme === 'mac' && etat.autorisations?.accessibilite !== true) return false;
  log.info(`Beluga Connect : Chrome délié sur l’ordinateur ${ordinateurId}, nouvelle liaison`);
  void preparerChrome(compteId, r, true).catch((e) => log.warn('Beluga Connect : reprise après révocation', String((e as Error)?.message ?? e)));
  return true;
}

/** Ce que Beluga Connect affiche dans son menu : l'ordinateur, ses Chrome, la version servie de lui-même. */
export async function statutPourConnect(appareilId: string, compteId: string): Promise<Record<string, unknown>> {
  const r = relais().find((x) => x.id === appareilId);
  const ordinateur = r?.ordinateurId ? ligneDOrdinateur(compteId, r.ordinateurId) : null;
  const chromes = r?.ordinateurId ? await chromesDeLOrdinateur(compteId, r.ordinateurId) : [];
  const { retardsDuCompte, phaseDeLaMiseAJour } = await import('./mise-a-jour-extension.js');
  const retards = await retardsDuCompte(compteId);
  const n = nouvelles.get(appareilId);
  const a = paquetDeConnect(paquetDuProgramme(systemeDuRelais(r, n), n?.arch));
  const prep = r?.ordinateurId ? preparationDe(r.ordinateurId) : null;
  const miseAJour = chromes.some((c) => retards.find((x) => x.chromeId === c.id)?.enCours);
  const travailEnCours: TravailDeConnect | null = prep?.etat === 'en-cours' ? (prep.travail ?? 'installation') : miseAJour ? 'mise-a-jour' : null;
  /* Le code de secours n'est montré par Connect que s'il est temps (30 s sans liaison) ; émis au besoin. */
  let secours: { code: string; expireLe: number } | null = null;
  if (r?.ordinateurId && codeDeSecoursAMontrer(prep, chromes.some((c) => c.enLigne))) {
    const { codeDeSecours } = await import('./extension-chrome.js');
    secours = codeDeSecours(compteId, r.ordinateurId);
  }
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
      /* L'état par service du volet et de la fenêtre de Beluga Connect 1.4.0 : reliée, autorisée en navigation privée. */
      relie: !!c.enLigne,
      prive: c.incognito === true,
    })),
    versionExtension: VERSION_EXTENSION_CHROME,
    connect: a ? { version: a.version, empreinte: a.empreinte, chemin: a.route } : null,
    preparation: prep?.etat ?? null,
    /*
     * LE SUIVI POUR LE MENU DE BELUGA CONNECT (carte « Liaison Chrome automatique et suivie », 22/11/2026) : le travail
     * en cours (l'icône tourne), les étapes cochées d'après l'état réel, la raison d'un échec et le code de secours
     * (le même que celui affiché dans Beluga). Les versions d'avant de Beluga Connect ignorent ces champs.
     */
    travail: travailEnCours,
    etapes: r?.ordinateurId ? etapesDeLaPreparation(prep, chromes[0] ?? null, systemeDuRelais(r, n) === 'mac').map((e) => ({ cle: e.cle, etat: e.etat })) : [],
    raison: prep?.etat === 'echec' ? prep.message : null,
    essais: prep?.essais ?? 0,
    codeDeSecours: secours ? { code: secours.code, expireLe: secours.expireLe } : null,
    /* SAFARI (Beluga Connect ≥ 1.5.0) : ses trois lignes, après Chrome. */
    safari:
      r?.ordinateurId && systemeDuRelais(r, n) === 'mac'
        ? await etatDeSafariPourConnect(compteId, r.ordinateurId, chromes.some((c) => c.enLigne && c.incognito === true))
        : null,
  };
}

/** Un geste demandé depuis le menu de Beluga Connect : « Mettre à jour maintenant » ou « Réparer ». */
export async function demandeDeConnect(appareilId: string, compteId: string, quoi: unknown): Promise<{ ok: boolean; texte: string }> {
  const r = relais().find((x) => x.id === appareilId);
  if (!r?.ordinateurId) return { ok: false, texte: 'Ce Mac n’est rattaché à aucun ordinateur dans Beluga.' };
  if (quoi === 'reparer') {
    void preparerChrome(compteId, r, true)
      .then(async () => {
        /* Puis Safari, s'il manque ou a échoué. */
        if (systemeDuRelais(r, nouvelles.get(r.id)) !== 'mac') return;
        const relie = (await safarisDeLOrdinateur(compteId, r.ordinateurId!)).some((c) => c.enLigne);
        if (!relie) await preparerSafari(compteId, r, true);
      })
      .catch(() => {});
    return { ok: true, texte: 'Beluga vérifie Chrome et Safari sur ce Mac et les répare au besoin.' };
  }
  if (quoi === 'safari') {
    void preparerSafari(compteId, r, true).catch(() => {});
    return { ok: true, texte: 'Beluga Connect installe Safari sur ce Mac.' };
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
  void preparerChrome(compteId, r, true).catch(() => {});
  return true;
}
