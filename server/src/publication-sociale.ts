import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  APPLICATIONS_SOCIALES,
  FICHES_RESEAUX,
  type ApplicationDeveloppeur,
  type ApplicationSociale,
  type CibleSociale,
  type CompteSocial,
  type EtatApplication,
  type EtatCible,
  type EtatCompte,
  type GenreMessage,
  type MessageSocial,
  type ReseauSocial,
  ETATS_APPLICATION,
  aRenouveler,
  bilanDePublication,
  ciblesAEnvoyer,
  cibleInterrompue,
  contenuAPublier,
  estReseauSocial,
  etatDuCompte,
  raisonDuBilan,
  raisonMediaManquant,
  raisonReliureImpossible,
  raisonReponseRefusee,
  texteDuReseau,
  trierMessages,
  REPONSE_SOCIALE_MAX,
} from '@beluga/shared';
import { getDb, getMeta, setMeta } from './db.js';
import { log } from './logger.js';
import * as store from './store.js';
import { enregistrerAcces, enregistrerDossier, listerAcces, listerDossiers, supprimerAcces } from './coffre-fort.js';
import { cheminDePieceJointe } from './pieces-jointes.js';
import { visuelsDuContenu } from './visuels-marketing.js';
import { adresseDeBeluga, changerEtape, diffuser, lireContenu } from './marketing.js';
import { type CompteTrouve, type ContexteCompte, type IdentifiantsApplication, type MediaAEnvoyer, ErreurReseau, adaptateurDe } from './reseaux/index.js';

/**
 * LA PUBLICATION OFFICIELLE SUR LES RÉSEAUX — comptes, jetons, envois, messages.
 *
 * Les règles vivent dans `shared/src/reseaux-sociaux.ts`, la façon de parler à
 * chaque réseau dans `server/src/reseaux/`. Ici :
 *  - les APPLICATIONS DÉVELOPPEUR, au niveau de l'installation : leur état, leur
 *    identifiant public ; leur secret est une fiche du coffre ;
 *  - les COMPTES RELIÉS par projet, dont les jetons sont des fiches du coffre
 *    (une par secret, dans le dossier « Réseaux sociaux — <projet> ») : la
 *    table n'en garde que la référence ;
 *  - la CONNEXION (aller vers le réseau, retour sur `/m/oauth/retour`) ;
 *  - l'ENVOI d'un contenu sur chacun de ses comptes, sans jamais republier un
 *    compte déjà servi ;
 *  - le MINUTEUR : contenus programmés dont l'heure est venue, jetons à
 *    renouveler, commentaires et messages à relever ;
 *  - les RÉPONSES, qui ne partent que sur un geste de l'utilisateur.
 */

/** L'adresse de retour de TOUTES les connexions : celle à déclarer dans chaque application développeur. */
export function adresseDeRetour(): string {
  return `${adresseDeBeluga()}/m/oauth/retour`;
}

/* ------------------------------------------------------------------ */
/* Le coffre                                                            */
/* ------------------------------------------------------------------ */

const DOSSIER_APPLICATIONS = 'Applications des réseaux sociaux';
const dossierDuProjet = (nomProjet: string) => `Réseaux sociaux — ${nomProjet}`.slice(0, 80);

/** Le dossier du coffre de ce nom, créé au besoin ; null s'il ne peut pas l'être (le secret reste alors à la racine). */
function dossierDuCoffre(nom: string, projectId: string | null): string | null {
  const existant = listerDossiers().find((d) => !d.parentId && d.nom === nom);
  if (existant) return existant.id;
  const r = enregistrerDossier({ nom, projectId });
  return r.ok ? r.dossier.id : null;
}

/** Range (ou remplace) UN secret dans sa fiche ; rend l'identifiant de la fiche. */
function rangerSecret(entree: { id?: string | null; nom: string; type: 'jeton' | 'cle-api'; service: string; valeur: string; projectId: string | null; dossier: string; note: string }): string {
  const existe = entree.id ? listerAcces().find((a) => a.id === entree.id) : undefined;
  const dossierId = dossierDuCoffre(entree.dossier, entree.projectId);
  const champs = entree.type === 'jeton' ? { service: entree.service, jeton: entree.valeur } : { service: entree.service, cle: entree.valeur };
  const r = enregistrerAcces({
    ...(existe ? { id: existe.id } : {}),
    nom: entree.nom.slice(0, 120),
    type: entree.type,
    projectId: entree.projectId,
    champs,
    note: entree.note,
    ...(dossierId ? { dossierId } : {}),
  });
  if (!r.ok) throw new Error(`coffre-fort : ${r.raison}`);
  return r.acces.id;
}

function lireSecret(id: string | null | undefined): string | null {
  if (!id) return null;
  const a = listerAcces().find((x) => x.id === id);
  return a ? (a.champs.jeton ?? a.champs.cle ?? null) : null;
}

/* ------------------------------------------------------------------ */
/* Les applications développeur                                         */
/* ------------------------------------------------------------------ */

interface LigneApplication {
  application: string;
  etat: string;
  client_id: string | null;
  secret_ref: string | null;
  note: string | null;
  card_id: string | null;
  maj_le: number;
}

function depuisLigneApplication(l: LigneApplication | undefined, app: ApplicationSociale): ApplicationDeveloppeur {
  if (!l) return { application: app, etat: 'absente', aUnSecret: false, majLe: 0 };
  return {
    application: app,
    etat: (ETATS_APPLICATION as readonly string[]).includes(l.etat) ? (l.etat as EtatApplication) : 'absente',
    clientId: l.client_id ?? undefined,
    aUnSecret: !!lireSecret(l.secret_ref),
    note: l.note ?? undefined,
    cardId: l.card_id ?? undefined,
    majLe: l.maj_le,
  };
}

export function lireApplication(app: ApplicationSociale): ApplicationDeveloppeur {
  return depuisLigneApplication(getDb().prepare('SELECT * FROM marketing_applications WHERE application = ?').get(app) as LigneApplication | undefined, app);
}

export function listerApplications(): ApplicationDeveloppeur[] {
  return APPLICATIONS_SOCIALES.map(lireApplication);
}

function identifiants(app: ApplicationSociale): IdentifiantsApplication {
  const l = getDb().prepare('SELECT * FROM marketing_applications WHERE application = ?').get(app) as LigneApplication | undefined;
  const secret = lireSecret(l?.secret_ref);
  if (!l?.client_id || !secret) throw new ErreurReseau('l’application de ce réseau n’a pas encore ses identifiants');
  return { clientId: l.client_id, secret };
}

export type ResultatApplication = { ok: true; application: ApplicationDeveloppeur } | { ok: false; raison: string };

/**
 * ÉCRIT L'APPLICATION D'UN RÉSEAU — à la main (onglet Comptes) ou par l'agent
 * de création (outil « marketing », action « application »). Le secret part au
 * coffre, jamais dans la table ; ce qui n'est pas redit est gardé.
 */
export function ecrireApplication(entree: { application?: unknown; reseau?: unknown; clientId?: unknown; secret?: unknown; etat?: unknown; note?: unknown; cardId?: string | null }): ResultatApplication {
  const app = (APPLICATIONS_SOCIALES as readonly string[]).includes(String(entree.application))
    ? (String(entree.application) as ApplicationSociale)
    : estReseauSocial(entree.reseau)
      ? FICHES_RESEAUX[entree.reseau].application
      : null;
  if (!app) return { ok: false, raison: 'Réseau ou application inconnus.' };
  const avant = getDb().prepare('SELECT * FROM marketing_applications WHERE application = ?').get(app) as LigneApplication | undefined;
  const clientId = typeof entree.clientId === 'string' && entree.clientId.trim() ? entree.clientId.trim().slice(0, 300) : (avant?.client_id ?? null);
  let secretRef = avant?.secret_ref ?? null;
  if (typeof entree.secret === 'string' && entree.secret.trim()) {
    try {
      secretRef = rangerSecret({
        id: secretRef,
        nom: `Application ${app} des réseaux sociaux — secret`,
        type: 'cle-api',
        service: app,
        valeur: entree.secret.trim(),
        projectId: null,
        dossier: DOSSIER_APPLICATIONS,
        note: `Secret de l’application développeur ${app}, utilisé par l’atelier Réseaux sociaux pour relier les comptes de tous les projets.`,
      });
    } catch (err: any) {
      return { ok: false, raison: err?.message ?? 'Secret refusé par le coffre.' };
    }
  }
  let etat = (ETATS_APPLICATION as readonly string[]).includes(String(entree.etat)) ? (String(entree.etat) as EtatApplication) : ((avant?.etat as EtatApplication) ?? 'absente');
  // Des identifiants sans état dit valent « en validation » : on peut déjà relier ses propres comptes.
  if ((etat === 'absente' || (etat === 'en_creation' && entree.etat === undefined)) && clientId && lireSecret(secretRef)) etat = 'en_validation';
  const note = typeof entree.note === 'string' ? entree.note.trim().slice(0, 1000) || null : (avant?.note ?? null);
  const cardId = entree.cardId !== undefined ? entree.cardId : (avant?.card_id ?? null);
  getDb()
    .prepare(
      `INSERT INTO marketing_applications (application, etat, client_id, secret_ref, note, card_id, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(application) DO UPDATE SET etat = excluded.etat, client_id = excluded.client_id, secret_ref = excluded.secret_ref, note = excluded.note, card_id = excluded.card_id, maj_le = excluded.maj_le`,
    )
    .run(app, etat, clientId, secretRef, note, cardId, Date.now());
  for (const p of projetsAvecComptes()) diffuser(p);
  return { ok: true, application: lireApplication(app) };
}

function projetsAvecComptes(): string[] {
  return (getDb().prepare('SELECT DISTINCT project_id FROM marketing_espaces').all() as { project_id: string }[]).map((l) => l.project_id);
}

/* ------------------------------------------------------------------ */
/* Les comptes reliés                                                   */
/* ------------------------------------------------------------------ */

interface LigneCompte {
  id: string;
  project_id: string;
  reseau: string;
  distant_id: string;
  nom: string;
  avatar: string | null;
  etat: string;
  jeton_ref: string | null;
  rafraichissement_ref: string | null;
  expire_le: number | null;
  details: string;
  erreur: string | null;
  cree_le: number;
  maj_le: number;
}

function details(l: LigneCompte): Record<string, any> {
  try {
    const d = JSON.parse(l.details || '{}');
    return d && typeof d === 'object' ? d : {};
  } catch {
    return {};
  }
}

function depuisLigneCompte(l: LigneCompte): CompteSocial {
  const brut = {
    etat: l.etat as EtatCompte,
    expireLe: l.expire_le ?? undefined,
    renouvelable: !!l.rafraichissement_ref || l.reseau === 'threads',
  };
  return {
    id: l.id,
    projectId: l.project_id,
    reseau: l.reseau as ReseauSocial,
    distantId: l.distant_id,
    nom: l.nom,
    avatar: l.avatar ?? undefined,
    etat: etatDuCompte(brut),
    expireLe: brut.expireLe,
    renouvelable: brut.renouvelable,
    erreur: l.erreur ?? undefined,
    creeLe: l.cree_le,
    majLe: l.maj_le,
  };
}

function ligneCompte(id: string): LigneCompte | undefined {
  return getDb().prepare('SELECT * FROM marketing_comptes WHERE id = ?').get(id) as LigneCompte | undefined;
}

export function listerComptes(projectId: string): CompteSocial[] {
  return (getDb().prepare('SELECT * FROM marketing_comptes WHERE project_id = ? ORDER BY reseau, nom').all(projectId) as LigneCompte[]).map(depuisLigneCompte);
}

export function lireCompte(id: string): CompteSocial | null {
  const l = ligneCompte(id);
  return l ? depuisLigneCompte(l) : null;
}

function contexte(l: LigneCompte): ContexteCompte {
  const jeton = lireSecret(l.jeton_ref);
  if (!jeton) throw new ErreurReseau('l’accès de ce compte n’est plus au coffre : reliez-le à nouveau', 401, true);
  return { distantId: l.distant_id, nom: l.nom, jeton, details: details(l) };
}

function marquerCompte(id: string, etat: EtatCompte, erreur: string | null): void {
  getDb().prepare('UPDATE marketing_comptes SET etat = ?, erreur = ?, maj_le = ? WHERE id = ?').run(etat, erreur, Date.now(), id);
}

/**
 * RANGE LES COMPTES RENDUS PAR UNE CONNEXION. Un compte déjà relié (même
 * réseau, même identifiant distant) est remis à jour, jetons compris ; un
 * même jeton partagé par plusieurs comptes (profil et pages LinkedIn,
 * établissements Google) n'occupe qu'une fiche du coffre.
 */
export function enregistrerComptes(projectId: string, trouves: CompteTrouve[], maintenant = Date.now()): CompteSocial[] {
  const projet = store.getProject(projectId);
  if (!projet) throw new Error('projet introuvable');
  const dossier = dossierDuProjet(projet.name);
  const refs = new Map<string, string>();
  const sortie: CompteSocial[] = [];
  for (const t of trouves) {
    const fiche = FICHES_RESEAUX[t.reseau];
    const avant = getDb().prepare('SELECT * FROM marketing_comptes WHERE project_id = ? AND reseau = ? AND distant_id = ?').get(projectId, t.reseau, t.distantId) as LigneCompte | undefined;
    let jetonRef = refs.get(t.jetons.acces);
    if (!jetonRef) {
      jetonRef = rangerSecret({
        id: avant?.jeton_ref,
        nom: `${fiche.libelle} ${t.nom} — jeton d’accès`,
        type: 'jeton',
        service: fiche.libelle,
        valeur: t.jetons.acces,
        projectId,
        dossier,
        note: `Accès de l’atelier Réseaux sociaux au compte ${fiche.libelle} « ${t.nom} » du projet ${projet.name}. Renouvelé tout seul quand le réseau le permet.`,
      });
      refs.set(t.jetons.acces, jetonRef);
    }
    let rafraichissementRef: string | null = avant?.rafraichissement_ref ?? null;
    if (t.jetons.rafraichissement) {
      const cle = `r:${t.jetons.rafraichissement}`;
      rafraichissementRef =
        refs.get(cle) ??
        rangerSecret({
          id: rafraichissementRef,
          nom: `${fiche.libelle} ${t.nom} — jeton de renouvellement`,
          type: 'jeton',
          service: fiche.libelle,
          valeur: t.jetons.rafraichissement,
          projectId,
          dossier,
          note: `Sert à renouveler l’accès au compte ${fiche.libelle} « ${t.nom} » sans refaire la connexion.`,
        });
      refs.set(cle, rafraichissementRef);
    }
    const id = avant?.id ?? `sc_${crypto.randomBytes(6).toString('base64url')}`;
    getDb()
      .prepare(
        `INSERT INTO marketing_comptes (id, project_id, reseau, distant_id, nom, avatar, etat, jeton_ref, rafraichissement_ref, expire_le, details, erreur, cree_le, maj_le)
         VALUES (?, ?, ?, ?, ?, ?, 'relie', ?, ?, ?, ?, NULL, ?, ?)
         ON CONFLICT(project_id, reseau, distant_id) DO UPDATE SET nom = excluded.nom, avatar = excluded.avatar, etat = 'relie', jeton_ref = excluded.jeton_ref,
           rafraichissement_ref = excluded.rafraichissement_ref, expire_le = excluded.expire_le, details = excluded.details, erreur = NULL, maj_le = excluded.maj_le`,
      )
      .run(id, projectId, t.reseau, t.distantId, t.nom.slice(0, 160), t.avatar ?? null, jetonRef, rafraichissementRef, t.jetons.expireLe ?? null, JSON.stringify(t.details ?? {}), avant?.cree_le ?? maintenant, maintenant);
    sortie.push(lireCompte(id)!);
  }
  diffuser(projectId);
  return sortie;
}

/** RETIRE UN COMPTE : ses jetons partent aux archives du coffre, ses envois en attente et ses messages avec lui. */
export function retirerCompte(id: string, projectId?: string): { ok: boolean; raison?: string } {
  const l = ligneCompte(id);
  if (!l || (projectId && l.project_id !== projectId)) return { ok: false, raison: 'Compte introuvable.' };
  const base = getDb();
  base.transaction(() => {
    base.prepare("DELETE FROM marketing_publications WHERE compte_id = ? AND etat != 'publie'").run(id);
    base.prepare('DELETE FROM marketing_messages WHERE compte_id = ?').run(id);
    base.prepare('DELETE FROM marketing_comptes WHERE id = ?').run(id);
  })();
  // Une fiche partagée avec un autre compte (même connexion) reste au coffre.
  for (const ref of [l.jeton_ref, l.rafraichissement_ref]) {
    if (!ref) continue;
    const encore = base.prepare('SELECT 1 FROM marketing_comptes WHERE jeton_ref = ? OR rafraichissement_ref = ?').get(ref, ref);
    if (!encore) supprimerAcces(ref);
  }
  diffuser(l.project_id);
  return { ok: true };
}

/** RENOUVELLE L'ACCÈS d'un compte (et des comptes qui partagent son jeton). */
export async function renouvelerCompte(id: string): Promise<void> {
  const l = ligneCompte(id);
  if (!l) return;
  const reseau = l.reseau as ReseauSocial;
  const adaptateur = adaptateurDe(reseau);
  if (!adaptateur.rafraichir) return;
  try {
    const ctx = contexte(l);
    const rafraichissement = lireSecret(l.rafraichissement_ref) ?? ctx.jeton;
    const j = await adaptateur.rafraichir({ app: identifiants(FICHES_RESEAUX[reseau].application), rafraichissement, ctx });
    const projet = store.getProject(l.project_id);
    const fiche = FICHES_RESEAUX[reseau];
    const dossier = dossierDuProjet(projet?.name ?? l.project_id);
    rangerSecret({ id: l.jeton_ref, nom: `${fiche.libelle} ${l.nom} — jeton d’accès`, type: 'jeton', service: fiche.libelle, valeur: j.acces, projectId: l.project_id, dossier, note: `Accès de l’atelier Réseaux sociaux au compte ${fiche.libelle} « ${l.nom} ». Renouvelé tout seul.` });
    if (j.rafraichissement && l.rafraichissement_ref) {
      rangerSecret({ id: l.rafraichissement_ref, nom: `${fiche.libelle} ${l.nom} — jeton de renouvellement`, type: 'jeton', service: fiche.libelle, valeur: j.rafraichissement, projectId: l.project_id, dossier, note: `Sert à renouveler l’accès au compte ${fiche.libelle} « ${l.nom} ».` });
    }
    getDb().prepare("UPDATE marketing_comptes SET expire_le = ?, etat = 'relie', erreur = NULL, maj_le = ? WHERE jeton_ref = ?").run(j.expireLe ?? null, Date.now(), l.jeton_ref);
  } catch (err: any) {
    const aRelier = err instanceof ErreurReseau ? err.aRelier || err.statut === 400 : false;
    marquerCompte(id, aRelier ? 'a_relier' : 'erreur', `Renouvellement de l’accès impossible : ${err?.message ?? err}`.slice(0, 500));
    log.warn(`réseaux : renouvellement impossible pour ${reseau} « ${l.nom} »`, err?.message ?? err);
  }
  diffuser(l.project_id);
}

/* ------------------------------------------------------------------ */
/* La connexion                                                         */
/* ------------------------------------------------------------------ */

interface ConnexionEnCours {
  projectId: string;
  reseau: ReseauSocial;
  verificateur: string;
  creeLe: number;
}

const DUREE_CONNEXION_MS = 30 * 60_000;
const connexions = new Map<string, ConnexionEnCours>();

/** L'ADRESSE OÙ L'UTILISATEUR DONNE SON ACCORD au réseau. Le retour se fait sur `adresseDeRetour()`. */
export function commencerConnexion(projectId: string, reseau: unknown, maintenant = Date.now()): { url: string } {
  if (!store.getProject(projectId)) throw new Error('projet introuvable');
  if (!estReseauSocial(reseau)) throw new Error('réseau inconnu');
  const app = lireApplication(FICHES_RESEAUX[reseau].application);
  const refus = raisonReliureImpossible(app);
  if (refus) throw new Error(refus);
  if (!adresseDeBeluga()) throw new Error('L’adresse publique de Beluga n’est pas réglée : le réseau ne saurait pas où revenir.');
  for (const [cle, c] of connexions) if (maintenant - c.creeLe > DUREE_CONNEXION_MS) connexions.delete(cle);
  const etat = crypto.randomBytes(18).toString('base64url');
  const verificateur = crypto.randomBytes(48).toString('base64url');
  connexions.set(etat, { projectId, reseau, verificateur, creeLe: maintenant });
  const url = adaptateurDe(reseau).urlDeConnexion({ app: identifiants(FICHES_RESEAUX[reseau].application), retour: adresseDeRetour(), etat, verificateur });
  return { url };
}

export type RetourDeConnexion = { ok: true; projectId: string; reseau: ReseauSocial; comptes: CompteSocial[] } | { ok: false; raison: string; projectId?: string; reseau?: ReseauSocial };

/** LE RETOUR DU RÉSEAU : l'état doit être connu et frais, le code s'échange contre les comptes. */
export async function terminerConnexion(params: URLSearchParams, maintenant = Date.now()): Promise<RetourDeConnexion> {
  const etat = params.get('state') ?? '';
  const c = connexions.get(etat);
  if (!c || maintenant - c.creeLe > DUREE_CONNEXION_MS) return { ok: false, raison: 'Cette connexion a expiré ou ne vient pas de Beluga : relancez « Relier » depuis l’atelier.' };
  connexions.delete(etat);
  const refus = params.get('error_description') ?? params.get('error');
  if (refus) return { ok: false, raison: `Le réseau a refusé la connexion : ${refus}`.slice(0, 300), projectId: c.projectId, reseau: c.reseau };
  const code = params.get('code') ?? params.get('auth_code');
  if (!code) return { ok: false, raison: 'Le réseau n’a rendu aucun code.', projectId: c.projectId, reseau: c.reseau };
  try {
    const trouves = await adaptateurDe(c.reseau).echangerCode({ app: identifiants(FICHES_RESEAUX[c.reseau].application), retour: adresseDeRetour(), code, verificateur: c.verificateur });
    if (!trouves.length) {
      const quoi = c.reseau === 'instagram' ? 'aucun compte Instagram professionnel relié à une de vos pages Facebook' : c.reseau === 'facebook' ? 'aucune page Facebook' : 'aucun compte';
      return { ok: false, raison: `La connexion a marché, mais ce compte n’ouvre ${quoi}.`, projectId: c.projectId, reseau: c.reseau };
    }
    const comptes = enregistrerComptes(c.projectId, trouves);
    log.info(`réseaux : ${comptes.length} compte(s) ${c.reseau} relié(s) au projet ${c.projectId}`);
    return { ok: true, projectId: c.projectId, reseau: c.reseau, comptes };
  } catch (err: any) {
    log.warn(`réseaux : connexion ${c.reseau} impossible`, err?.message ?? err);
    return { ok: false, raison: `La connexion n’a pas abouti : ${err?.message ?? err}`.slice(0, 400), projectId: c.projectId, reseau: c.reseau };
  }
}

/* ------------------------------------------------------------------ */
/* Les comptes visés par un contenu                                     */
/* ------------------------------------------------------------------ */

interface LignePublication {
  contenu_id: string;
  compte_id: string;
  reseau: string;
  etat: string;
  distant_id: string | null;
  url: string | null;
  raison: string | null;
  tente_le: number | null;
  publie_le: number | null;
}

function depuisLignePublication(l: LignePublication): CibleSociale {
  return {
    compteId: l.compte_id,
    reseau: l.reseau as ReseauSocial,
    etat: l.etat as EtatCible,
    url: l.url ?? undefined,
    raison: l.raison ?? undefined,
    tenteLe: l.tente_le ?? undefined,
    publieLe: l.publie_le ?? undefined,
  };
}

export function ciblesDuContenu(contenuId: string): CibleSociale[] {
  return (getDb().prepare('SELECT * FROM marketing_publications WHERE contenu_id = ? ORDER BY reseau, compte_id').all(contenuId) as LignePublication[]).map(depuisLignePublication);
}

/** Les cibles de tous les contenus d'un projet, d'une seule lecture. */
export function ciblesDuProjet(projectId: string): Map<string, CibleSociale[]> {
  const lignes = getDb()
    .prepare('SELECT p.* FROM marketing_publications p JOIN marketing_contenus c ON c.id = p.contenu_id WHERE c.project_id = ? ORDER BY p.reseau, p.compte_id')
    .all(projectId) as LignePublication[];
  const sortie = new Map<string, CibleSociale[]>();
  for (const l of lignes) {
    const liste = sortie.get(l.contenu_id) ?? [];
    liste.push(depuisLignePublication(l));
    sortie.set(l.contenu_id, liste);
  }
  return sortie;
}

export type ResultatCibles = { ok: true; cibles: CibleSociale[] } | { ok: false; raison: string };

/**
 * LES COMPTES OÙ UN CONTENU PART. La liste reçue remplace l'ancienne : un
 * compte retiré perd son envoi en attente, jamais un envoi déjà publié. Les
 * canaux du contenu suivent les réseaux cochés.
 */
export function ecrireCibles(contenuId: string, compteIds: unknown, projectId?: string): ResultatCibles {
  const c = lireContenu(contenuId);
  if (!c || (projectId && c.projectId !== projectId)) return { ok: false, raison: `Aucun contenu « ${contenuId} » dans ce projet.` };
  if (c.etape === 'publie') return { ok: false, raison: 'Un contenu publié ne change plus de comptes.' };
  if (!Array.isArray(compteIds)) return { ok: false, raison: 'Liste de comptes attendue.' };
  const comptes = new Map(listerComptes(c.projectId).map((x) => [x.id, x]));
  const voulus = [...new Set(compteIds.map(String))];
  const inconnu = voulus.find((id) => !comptes.has(id));
  if (inconnu) return { ok: false, raison: 'Ce compte n’est pas relié à ce projet.' };
  const base = getDb();
  base.transaction(() => {
    const actuels = ciblesDuContenu(contenuId);
    for (const a of actuels) {
      if (!voulus.includes(a.compteId) && a.etat !== 'publie') base.prepare('DELETE FROM marketing_publications WHERE contenu_id = ? AND compte_id = ?').run(contenuId, a.compteId);
    }
    for (const id of voulus) {
      base.prepare("INSERT OR IGNORE INTO marketing_publications (contenu_id, compte_id, reseau, etat) VALUES (?, ?, ?, 'en_attente')").run(contenuId, id, comptes.get(id)!.reseau);
    }
    const reseaux = [...new Set(ciblesDuContenu(contenuId).map((x) => x.reseau as string))];
    if (reseaux.length) {
      const autres = c.canaux.filter((k) => !estReseauSocial(k));
      const canaux = [...reseaux, ...autres];
      base.prepare('UPDATE marketing_contenus SET canal = ?, canaux = ?, maj_le = ? WHERE id = ?').run(canaux[0], JSON.stringify(canaux), Date.now(), contenuId);
    }
  })();
  diffuser(c.projectId);
  return { ok: true, cibles: ciblesDuContenu(contenuId) };
}

/** Un contenu supprimé emporte ses envois (jamais un contenu publié : il ne se supprime pas). */
export function oublierCiblesDuContenu(contenuId: string): void {
  getDb().prepare('DELETE FROM marketing_publications WHERE contenu_id = ?').run(contenuId);
}

/* ------------------------------------------------------------------ */
/* Les visuels servis aux réseaux                                       */
/* ------------------------------------------------------------------ */

const CLE_SECRET_MEDIAS = 'marketing:secret-des-medias';
const DUREE_MEDIA_PUBLIC_MS = 6 * 3600_000;

function secretDesMedias(): string {
  let s = getMeta(CLE_SECRET_MEDIAS);
  if (!s) {
    s = crypto.randomBytes(32).toString('base64url');
    setMeta(CLE_SECRET_MEDIAS, s);
  }
  return s;
}

function signature(attachmentId: string, expire: number): string {
  return crypto.createHmac('sha256', secretDesMedias()).update(`${attachmentId}.${expire}`).digest('base64url').slice(0, 32);
}

/**
 * UNE ADRESSE PUBLIQUE, SIGNÉE ET TEMPORAIRE, pour un visuel qu'un réseau vient
 * chercher lui-même (Instagram, Threads, fiche Google). Elle ne dure que
 * quelques heures et ne s'ouvre que pour CE fichier.
 */
export function urlMediaPublique(attachmentId: string, maintenant = Date.now()): string {
  const expire = Math.floor((maintenant + DUREE_MEDIA_PUBLIC_MS) / 1000);
  return `${adresseDeBeluga()}/m/media/${encodeURIComponent(attachmentId)}/${expire}/${signature(attachmentId, expire)}`;
}

/** Le fichier qu'une adresse publique désigne, si elle est valide et pas échue. */
export function mediaDeLAdressePublique(route: string, maintenant = Date.now()): { chemin: string; mime: string; taille: number } | null {
  const m = /^\/m\/media\/([^/]+)\/(\d+)\/([A-Za-z0-9_-]+)$/.exec(route);
  if (!m) return null;
  const id = decodeURIComponent(m[1]!);
  const expire = Number(m[2]);
  if (!Number.isFinite(expire) || expire * 1000 < maintenant) return null;
  const attendue = signature(id, expire);
  if (attendue.length !== m[3]!.length || !crypto.timingSafeEqual(Buffer.from(attendue), Buffer.from(m[3]!))) return null;
  const piece = store.getAttachment(id);
  if (!piece) return null;
  const chemin = cheminDePieceJointe(piece);
  if (!fs.existsSync(chemin)) return null;
  return { chemin, mime: piece.mime, taille: fs.statSync(chemin).size };
}

/** Les visuels prêts de ce contenu (directeur artistique, ancien Studio), du plus récent au plus ancien. */
function mediasDuContenu(contenuId: string): MediaAEnvoyer[] {
  const sortie: MediaAEnvoyer[] = [];
  const contenu = lireContenu(contenuId);
  for (const e of contenu ? visuelsDuContenu(contenu.projectId, contenuId) : []) {
    if (!e.attachmentId) continue;
    const piece = store.getAttachment(e.attachmentId);
    if (!piece) continue;
    const chemin = cheminDePieceJointe(piece);
    if (!fs.existsSync(chemin)) continue;
    const genre = piece.mime.startsWith('video/') ? 'video' : piece.mime.startsWith('image/') ? 'image' : null;
    if (!genre) continue;
    sortie.push({ genre, mime: piece.mime, chemin, taille: fs.statSync(chemin).size, urlPublique: urlMediaPublique(piece.id) });
  }
  return sortie;
}

/* ------------------------------------------------------------------ */
/* L'envoi d'un contenu                                                 */
/* ------------------------------------------------------------------ */

const enVol = new Set<string>();

export type ResultatEnvoi = { ok: true; bilan: ReturnType<typeof bilanDePublication>; cibles: CibleSociale[] } | { ok: false; raison: string };

/** Prend une cible pour l'envoyer : une seule prise réussit, même à deux appels simultanés. */
function prendre(contenuId: string, compteId: string, depuis: readonly EtatCible[], maintenant: number): boolean {
  const marques = depuis.map(() => '?').join(', ');
  return (
    getDb()
      .prepare(`UPDATE marketing_publications SET etat = 'en_cours', tente_le = ?, raison = NULL WHERE contenu_id = ? AND compte_id = ? AND etat IN (${marques})`)
      .run(maintenant, contenuId, compteId, ...depuis).changes === 1
  );
}

function finir(contenuId: string, compteId: string, r: { etat: 'publie'; distantId: string; url?: string } | { etat: 'echec'; raison: string }): void {
  if (r.etat === 'publie') {
    getDb()
      .prepare("UPDATE marketing_publications SET etat = 'publie', distant_id = ?, url = ?, raison = NULL, publie_le = ? WHERE contenu_id = ? AND compte_id = ?")
      .run(r.distantId, r.url ?? null, Date.now(), contenuId, compteId);
  } else {
    getDb().prepare("UPDATE marketing_publications SET etat = 'echec', raison = ? WHERE contenu_id = ? AND compte_id = ?").run(r.raison.slice(0, 500), contenuId, compteId);
  }
}

/**
 * ENVOIE UN CONTENU SUR SES COMPTES. `programme` : le départ automatique, qui
 * n'envoie que ce qui attend ; `maintenant` : le bouton « Publier maintenant »,
 * qui relance aussi les échecs. Un compte déjà publié n'est JAMAIS rejoué.
 */
export async function publierContenu(contenuId: string, declencheur: 'programme' | 'maintenant', projectId?: string): Promise<ResultatEnvoi> {
  const c = lireContenu(contenuId);
  if (!c || (projectId && c.projectId !== projectId)) return { ok: false, raison: `Aucun contenu « ${contenuId} » dans ce projet.` };
  if (declencheur === 'maintenant' && !['pret', 'programme', 'echec'].includes(c.etape)) {
    return { ok: false, raison: c.etape === 'publie' ? 'Ce contenu est déjà publié.' : 'Validez d’abord ce contenu.' };
  }
  if (declencheur === 'programme' && c.etape !== 'programme') return { ok: false, raison: 'Ce contenu n’est plus programmé.' };
  const toutes = ciblesDuContenu(contenuId);
  if (!toutes.length) return { ok: false, raison: 'Cochez au moins un compte où publier.' };
  const aEnvoyer = declencheur === 'programme' ? toutes.filter((x) => x.etat === 'en_attente') : ciblesAEnvoyer(toutes);
  if (enVol.has(contenuId)) return { ok: false, raison: 'Ce contenu part déjà.' };
  enVol.add(contenuId);
  try {
    const medias = mediasDuContenu(contenuId);
    const disponible = { image: medias.some((m) => m.genre === 'image'), video: medias.some((m) => m.genre === 'video') };
    const lien = c.lienCode && adresseDeBeluga() ? `${adresseDeBeluga()}/m/l/${c.lienCode}` : null;
    const langue = getDb().prepare('SELECT langue FROM marketing_espaces WHERE project_id = ?').get(c.projectId) as { langue: string } | undefined;
    for (const cible of aEnvoyer) {
      if (!prendre(contenuId, cible.compteId, declencheur === 'programme' ? ['en_attente'] : ['en_attente', 'echec'], Date.now())) continue;
      const l = ligneCompte(cible.compteId);
      if (!l) {
        finir(contenuId, cible.compteId, { etat: 'echec', raison: 'Ce compte a été retiré.' });
        continue;
      }
      const compte = depuisLigneCompte(l);
      if (compte.etat !== 'relie') {
        finir(contenuId, cible.compteId, { etat: 'echec', raison: 'Ce compte est à relier à nouveau.' });
        continue;
      }
      const manque = raisonMediaManquant(compte.reseau, disponible);
      if (manque) {
        finir(contenuId, cible.compteId, { etat: 'echec', raison: manque });
        continue;
      }
      try {
        const r = await adaptateurDe(compte.reseau).publier({
          app: identifiants(FICHES_RESEAUX[compte.reseau].application),
          ctx: contexte(l),
          article: { titre: c.titre, texte: texteDuReseau(compte.reseau, c.texte, lien), lien: lien ?? c.lienCible ?? null, medias, langue: langue?.langue },
        });
        finir(contenuId, cible.compteId, { etat: 'publie', distantId: r.distantId, url: r.url });
        log.info(`réseaux : contenu ${contenuId} publié sur ${compte.reseau} « ${compte.nom} »`);
      } catch (err: any) {
        const raison = String(err?.message ?? err);
        finir(contenuId, cible.compteId, { etat: 'echec', raison });
        if (err instanceof ErreurReseau && err.aRelier) marquerCompte(l.id, 'a_relier', raison);
        log.warn(`réseaux : envoi de ${contenuId} sur ${compte.reseau} refusé`, raison);
      }
    }
    return { ok: true, ...conclure(contenuId) };
  } finally {
    enVol.delete(contenuId);
    diffuser(c.projectId);
  }
}

/** L'ÉTAPE DU CONTENU d'après ses envois : « Publié » quand tous sont partis, « En échec » (dit en clair) sinon. */
function conclure(contenuId: string): { bilan: ReturnType<typeof bilanDePublication>; cibles: CibleSociale[] } {
  const cibles = ciblesDuContenu(contenuId);
  const bilan = bilanDePublication(cibles);
  const c = lireContenu(contenuId);
  if (!c) return { bilan, cibles };
  if (bilan === 'publie' && c.etape !== 'publie') {
    changerEtape(contenuId, 'publie', 'systeme');
    const url = cibles.find((x) => x.url)?.url ?? null;
    getDb().prepare('UPDATE marketing_contenus SET url_publiee = COALESCE(url_publiee, ?) WHERE id = ?').run(url, contenuId);
  } else if (bilan === 'echec' || bilan === 'partiel') {
    if (c.etape !== 'echec') changerEtape(contenuId, 'echec', 'systeme');
    getDb().prepare('UPDATE marketing_contenus SET raison_echec = ?, url_publiee = COALESCE(url_publiee, ?) WHERE id = ?').run(raisonDuBilan(cibles), cibles.find((x) => x.url)?.url ?? null, contenuId);
  }
  return { bilan, cibles };
}

/* ------------------------------------------------------------------ */
/* Commentaires et messages                                             */
/* ------------------------------------------------------------------ */

interface LigneMessage {
  id: string;
  project_id: string;
  compte_id: string;
  reseau: string;
  genre: string;
  distant_id: string;
  fil: string;
  auteur: string;
  auteur_id: string | null;
  texte: string;
  instant: number;
  sortant: number;
  lu: number;
  contenu_id: string | null;
  brouillon: string | null;
  url: string | null;
}

function depuisLigneMessage(l: LigneMessage): MessageSocial {
  return {
    id: l.id,
    projectId: l.project_id,
    compteId: l.compte_id,
    reseau: l.reseau as ReseauSocial,
    genre: l.genre as GenreMessage,
    fil: l.fil,
    auteur: l.auteur,
    texte: l.texte,
    instant: l.instant,
    sortant: !!l.sortant,
    lu: !!l.lu,
    contenuId: l.contenu_id ?? undefined,
    brouillon: l.brouillon ?? undefined,
    url: l.url ?? undefined,
  };
}

const MESSAGES_LUS_MAX = 300;

export function listerMessages(projectId: string): MessageSocial[] {
  return trierMessages((getDb().prepare('SELECT * FROM marketing_messages WHERE project_id = ? ORDER BY instant DESC LIMIT ?').all(projectId, MESSAGES_LUS_MAX) as LigneMessage[]).map(depuisLigneMessage));
}

export function compterMessagesNonLus(projectId: string): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM marketing_messages WHERE project_id = ? AND lu = 0 AND sortant = 0').get(projectId) as { n: number }).n;
}

export function marquerMessagesLus(projectId: string, ids: unknown): number {
  if (!Array.isArray(ids) || !ids.length) return 0;
  const marques = ids.map(() => '?').join(', ');
  const n = getDb().prepare(`UPDATE marketing_messages SET lu = 1 WHERE project_id = ? AND id IN (${marques})`).run(projectId, ...ids.map(String)).changes;
  if (n) diffuser(projectId);
  return n;
}

const PUBLICATIONS_SUIVIES_JOURS = 30;

/** RELÈVE les commentaires et messages d'un compte. Rend le nombre de nouveaux messages reçus. */
export async function releverCompte(id: string, maintenant = Date.now()): Promise<number> {
  const l = ligneCompte(id);
  if (!l) return 0;
  const compte = depuisLigneCompte(l);
  if (compte.etat !== 'relie') return 0;
  const fiche = FICHES_RESEAUX[compte.reseau];
  const adaptateur = adaptateurDe(compte.reseau);
  let nouveaux = 0;
  try {
    const app = identifiants(fiche.application);
    const ctx = contexte(l);
    const publications = (
      getDb()
        .prepare("SELECT distant_id AS distantId, contenu_id AS contenuId FROM marketing_publications WHERE compte_id = ? AND etat = 'publie' AND distant_id IS NOT NULL AND publie_le > ?")
        .all(id, maintenant - PUBLICATIONS_SUIVIES_JOURS * 86_400_000) as { distantId: string; contenuId: string }[]
    );
    const parFil = new Map(publications.map((p) => [p.distantId, p.contenuId]));
    const relus = [
      ...(fiche.commentaires && adaptateur.lireCommentaires && (publications.length || compte.reseau === 'google-business') ? await adaptateur.lireCommentaires({ app, ctx, publications }) : []),
      ...(fiche.messages && adaptateur.lireMessages ? await adaptateur.lireMessages({ app, ctx }) : []),
    ];
    const inserer = getDb().prepare(
      `INSERT OR IGNORE INTO marketing_messages (id, project_id, compte_id, reseau, genre, distant_id, fil, auteur, auteur_id, texte, instant, sortant, lu, contenu_id, url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const m of relus) {
      if (!m.distantId) continue;
      const r = inserer.run(
        `sm_${crypto.randomBytes(6).toString('base64url')}`,
        l.project_id,
        id,
        compte.reseau,
        m.genre,
        m.distantId,
        m.fil,
        m.auteur.slice(0, 160),
        m.auteurId ?? null,
        m.texte.slice(0, 4000),
        m.instant,
        m.sortant ? 1 : 0,
        m.sortant ? 1 : 0,
        parFil.get(m.fil) ?? null,
        m.url ?? null,
      );
      if (r.changes && !m.sortant) nouveaux += 1;
    }
    if (l.erreur) getDb().prepare('UPDATE marketing_comptes SET erreur = NULL WHERE id = ?').run(id);
  } catch (err: any) {
    // Un réseau qui refuse la LECTURE (accès gratuit de X, droit pas encore validé) n'empêche pas de publier.
    const raison = `Relève des messages impossible : ${err?.message ?? err}`.slice(0, 500);
    if (err instanceof ErreurReseau && err.aRelier) marquerCompte(id, 'a_relier', raison);
    else getDb().prepare('UPDATE marketing_comptes SET erreur = ?, maj_le = ? WHERE id = ?').run(raison, Date.now(), id);
  }
  if (nouveaux) diffuser(l.project_id);
  return nouveaux;
}

export async function releverProjet(projectId: string): Promise<number> {
  let n = 0;
  for (const c of listerComptes(projectId)) n += await releverCompte(c.id);
  diffuser(projectId);
  return n;
}

export type ResultatReponse = { ok: true; message: MessageSocial } | { ok: false; raison: string };

/** ENVOIE UNE RÉPONSE — geste de l'utilisateur seulement (bouton « Envoyer »). */
export async function repondre(messageId: string, texte: unknown, projectId?: string): Promise<ResultatReponse> {
  const m = getDb().prepare('SELECT * FROM marketing_messages WHERE id = ?').get(messageId) as LigneMessage | undefined;
  if (!m || (projectId && m.project_id !== projectId)) return { ok: false, raison: 'Message introuvable.' };
  const l = ligneCompte(m.compte_id);
  if (!l) return { ok: false, raison: 'Ce compte a été retiré.' };
  const reseau = l.reseau as ReseauSocial;
  const dernier = getDb().prepare('SELECT MAX(instant) AS t FROM marketing_messages WHERE compte_id = ? AND fil = ? AND sortant = 0').get(l.id, m.fil) as { t: number | null };
  const corps = String(texte ?? '').trim();
  const refus = raisonReponseRefusee({ reseau, genre: m.genre as GenreMessage, texte: corps, dernierRecuLe: dernier.t });
  if (refus) return { ok: false, raison: refus };
  const adaptateur = adaptateurDe(reseau);
  try {
    const app = identifiants(FICHES_RESEAUX[reseau].application);
    const ctx = contexte(l);
    const r =
      m.genre === 'commentaire'
        ? await adaptateur.repondreCommentaire!({ app, ctx, message: { distantId: m.distant_id, fil: m.fil }, texte: corps })
        : await adaptateur.repondreMessage!({ app, ctx, message: { fil: m.fil, auteurId: m.auteur_id ?? undefined }, texte: corps });
    const id = `sm_${crypto.randomBytes(6).toString('base64url')}`;
    const base = getDb();
    base.transaction(() => {
      base
        .prepare(
          `INSERT OR IGNORE INTO marketing_messages (id, project_id, compte_id, reseau, genre, distant_id, fil, auteur, texte, instant, sortant, lu, contenu_id, url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
        )
        .run(id, m.project_id, l.id, reseau, m.genre, r.distantId, m.fil, l.nom, corps, Date.now(), m.contenu_id, (r as { url?: string }).url ?? null);
      base.prepare('UPDATE marketing_messages SET lu = 1, brouillon = NULL WHERE id = ?').run(messageId);
    })();
    diffuser(m.project_id);
    const ecrit = base.prepare('SELECT * FROM marketing_messages WHERE compte_id = ? AND distant_id = ?').get(l.id, r.distantId) as LigneMessage;
    return { ok: true, message: depuisLigneMessage(ecrit) };
  } catch (err: any) {
    if (err instanceof ErreurReseau && err.aRelier) marquerCompte(l.id, 'a_relier', String(err.message));
    return { ok: false, raison: `${FICHES_RESEAUX[reseau].libelle} a refusé la réponse : ${err?.message ?? err}`.slice(0, 400) };
  }
}

/** L'AGENT PROPOSE une réponse : elle attend sous le message, jamais envoyée sans le bouton. */
export function proposerReponse(messageId: string, texte: unknown, projectId: string): ResultatReponse {
  const m = getDb().prepare('SELECT * FROM marketing_messages WHERE id = ?').get(messageId) as LigneMessage | undefined;
  if (!m || m.project_id !== projectId) return { ok: false, raison: `Aucun message « ${messageId} » dans ce projet.` };
  if (m.sortant) return { ok: false, raison: 'C’est déjà une réponse envoyée.' };
  const corps = String(texte ?? '').trim().slice(0, REPONSE_SOCIALE_MAX);
  getDb().prepare('UPDATE marketing_messages SET brouillon = ? WHERE id = ?').run(corps || null, messageId);
  diffuser(projectId);
  return { ok: true, message: depuisLigneMessage({ ...m, brouillon: corps || null }) };
}

/* ------------------------------------------------------------------ */
/* Le minuteur                                                          */
/* ------------------------------------------------------------------ */

const RELEVE_MS = 10 * 60_000;

/**
 * UN TOUR DU MINUTEUR : les envois coupés en plein vol deviennent des échecs à
 * vérifier, les contenus programmés dont l'heure est venue partent, les accès
 * proches de l'échéance se renouvellent, et toutes les dix minutes les
 * commentaires et messages se relèvent. Rend le nombre de contenus envoyés.
 */
export async function tourDePublication(maintenant = Date.now(), releve = false): Promise<number> {
  const base = getDb();
  const coupes = (base.prepare("SELECT * FROM marketing_publications WHERE etat = 'en_cours'").all() as LignePublication[]).filter((l) =>
    cibleInterrompue({ etat: 'en_cours', tenteLe: l.tente_le ?? undefined }, maintenant),
  );
  for (const l of coupes) {
    finir(l.contenu_id, l.compte_id, { etat: 'echec', raison: 'Envoi interrompu (redémarrage) : vérifiez sur le réseau s’il est paru avant de relancer.' });
    conclure(l.contenu_id);
    const c = lireContenu(l.contenu_id);
    if (c) diffuser(c.projectId);
  }

  let envoyes = 0;
  const programmes = base
    .prepare("SELECT DISTINCT c.id, c.etape, c.date_prevue AS datePrevue, c.heure_prevue AS heurePrevue FROM marketing_contenus c JOIN marketing_publications p ON p.contenu_id = c.id WHERE c.etape = 'programme' AND p.etat = 'en_attente'")
    .all() as { id: string; etape: string; datePrevue: string | null; heurePrevue: string | null }[];
  for (const c of programmes) {
    if (!contenuAPublier(c, ciblesDuContenu(c.id), maintenant)) continue;
    const r = await publierContenu(c.id, 'programme');
    if (r.ok) envoyes += 1;
  }

  const comptes = base.prepare("SELECT * FROM marketing_comptes WHERE etat = 'relie'").all() as LigneCompte[];
  for (const l of comptes) {
    if (aRenouveler(depuisLigneCompte({ ...l }), maintenant)) await renouvelerCompte(l.id);
  }
  if (releve) for (const l of comptes) await releverCompte(l.id, maintenant);
  return envoyes;
}

/** Démarre le minuteur (chaque minute ; la relève toutes les dix). `BELUGA_PUBLICATION_SOCIALE=0` le coupe. */
export function demarrerPublicationSociale(): NodeJS.Timeout | null {
  if (process.env.BELUGA_PUBLICATION_SOCIALE === '0') return null;
  let derniereReleve = 0;
  let enCours = false;
  const minuteur = setInterval(() => {
    if (enCours) return;
    enCours = true;
    const maintenant = Date.now();
    const releve = maintenant - derniereReleve >= RELEVE_MS;
    if (releve) derniereReleve = maintenant;
    tourDePublication(maintenant, releve)
      .catch((err) => log.warn('réseaux : tour du minuteur impossible', err))
      .finally(() => {
        enCours = false;
      });
  }, 60_000);
  minuteur.unref?.();
  return minuteur;
}

/** Pour l'écran et l'outil de l'agent : tout ce que l'onglet « Comptes » montre. */
export function vueDesComptes(projectId: string) {
  return {
    comptes: listerComptes(projectId),
    applications: listerApplications(),
    adresseRetour: adresseDeRetour(),
    messagesNonLus: compterMessagesNonLus(projectId),
  };
}
