/**
 * LES PLAQUETTES CLIENT, CÔTÉ DÉMON (carte « Captures d'écran et plaquette client », 05/11/2026).
 *
 * Quatre tables (migration 161) : `captures` (le genre de chaque pièce produite par l'outil, pour la ranger sous
 * « Captures » dans les Fichiers), `plaquettes`, `plaquette_remarques` et `plaquette_ouvertures`. Les règles pures —
 * blocs, marque, rendu HTML, remarques — vivent dans `shared/src/plaquette.ts`.
 *
 * LE LIEN PRIVÉ : `/plaquette/<jeton>`, public, hors protocole et hors `/api/`. Le jeton (256 bits) est DÉRIVÉ d'une
 * clé du serveur (`PATHS.secret`, hors base) et de l'identifiant de la plaquette avec sa « génération » ; la base ne
 * garde que son EMPREINTE. Une copie de la base seule ne rouvre donc aucun lien ; le propriétaire, lui, retrouve son lien
 * à tout moment (il est recalculé). « Nouveau lien » incrémente la génération : l'ancien meurt. « Couper le lien » le
 * ferme (410), « Rouvrir » le rend. Le lien ne sert QUE la plaquette visée et les images qu'elle cite.
 *
 * UNE SEULE SOURCE (carte « Refonte du service Charte graphique ») : l'éditeur, la page du client (`htmlDuLecteur`,
 * un lecteur sombre façon PDF) et le PDF sortent de `documentDeLaPlaquette`, rangé en feuilles par la même mise en
 * pages (`paginerLeDocument`). Le PDF est imprimé par Chrome à partir de la version COURANTE — et refait seul si le
 * client le demande alors que la plaquette a changé depuis.
 *
 * LES COMMENTAIRES sont des FILS posés à un endroit du document (`plaquette_fils`, `plaquette_messages`, migration
 * 163) ; les remarques d'avant y ont été reprises.
 *
 * LE COMPTEUR (compétence « compteur d'ouvertures sans cookie ») : un compteur PAR JOUR, alimenté par le signal que la
 * page envoie depuis le navigateur. Ni cookie, ni adresse, ni identifiant de visiteur. L'auteur (session Beluga
 * présente) ne compte pas. La PREMIÈRE ouverture et chaque remarque sonnent la cloche.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type http from 'node:http';
import {
  LANGUES_DE_PLAQUETTE,
  PAGES_DE_PLAQUETTE,
  REMARQUES_PAR_HEURE,
  adresseDuRecapitulatif,
  attendreLesImages,
  courrielDuRecapDesCommentaires,
  documentDeLaPlaquette,
  filPourLeClient,
  formatDeLaPlaquette,
  htmlDeLaPlaquette,
  htmlDuLecteur,
  identiteDInstallation,
  lireLAdresseDePlaquette,
  lireLeFormatDePlaquette,
  jourDOuverture,
  lireLaMarque,
  lireLesBlocs,
  avecLesSupportsDeCharte,
  lireUnCommentaire,
  lireUneAncre,
  nomCourtDeLInstallation,
  ordonnerLesBlocs,
  paginerLeDocument,
  piecesDeLaPlaquette,
  recapDesCommentairesAEnvoyer,
  type AdresseDePlaquette,
  type Attachment,
  type BlocDePlaquette,
  type FilDeCommentaires,
  type FormatDePlaquette,
  type MarqueDePlaquette,
  type MessageDeFil,
  type Project,
  type RoleDansUnFil,
  minusculesSansAccents,
} from '@beluga/shared';
import { getDb } from './db.js';
import { PATHS } from './config.js';
import * as store from './store.js';
import { bus } from './bus.js';
import { log } from './logger.js';
import { notify } from './notify.js';
import { joindreUnFichier } from './joindre-fichier.js';
import { cheminDePieceJointe } from './pieces-jointes.js';
import { adresseDeBeluga } from './marketing.js';
import { fichierFavicon } from './favicon.js';

/* ------------------------------------------------------------------ */
/* Les pièces produites par l'outil                                     */
/* ------------------------------------------------------------------ */

export type GenreDeCapture = 'capture' | 'video' | 'maquette' | 'plaquette';

/** Note le genre d'une pièce produite par l'outil : les Fichiers la rangent alors sous « Captures/<genre> ». */
export function noterUneCapture(opts: { attachmentId: string; projectId: string; genre: GenreDeCapture }): void {
  try {
    getDb()
      .prepare('INSERT INTO captures (attachment_id, project_id, genre, cree_le) VALUES (?, ?, ?, ?) ON CONFLICT(attachment_id) DO UPDATE SET genre = excluded.genre')
      .run(opts.attachmentId, opts.projectId, opts.genre, Date.now());
  } catch (err) {
    log.warn(`captures : genre de la pièce ${opts.attachmentId} non noté (${(err as Error).message})`);
  }
}

/** Le genre noté de chaque pièce de l'outil (lu par le rangement des Fichiers). */
export function genresDesCaptures(): Map<string, GenreDeCapture> {
  try {
    const lignes = getDb().prepare('SELECT attachment_id, genre FROM captures').all() as { attachment_id: string; genre: GenreDeCapture }[];
    return new Map(lignes.map((l) => [l.attachment_id, l.genre]));
  } catch {
    return new Map();
  }
}

/* ------------------------------------------------------------------ */
/* Le jeton du lien                                                     */
/* ------------------------------------------------------------------ */

let cle: Buffer | null = null;

function cleDesLiens(): Buffer {
  if (cle) return cle;
  try {
    const lue = fs.readFileSync(PATHS.secret);
    if (lue.length >= 32) return (cle = lue);
  } catch {
    /* absente : créée ci-dessous */
  }
  const neuve = crypto.randomBytes(48);
  fs.mkdirSync(path.dirname(PATHS.secret), { recursive: true });
  fs.writeFileSync(PATHS.secret, neuve, { mode: 0o600, flag: 'wx' });
  return (cle = neuve);
}

export function jetonDeLaPlaquette(id: string, generation: number): string {
  return crypto.createHmac('sha256', cleDesLiens()).update(`plaquette:${id}:${generation}`).digest('base64url');
}

export function empreinteDuJeton(jeton: string): string {
  return crypto.createHash('sha256').update(jeton).digest('hex');
}

/** Le chemin public du lien (sans l'adresse du serveur). */
export function cheminDuLien(id: string, generation: number): string {
  return `/plaquette/${jetonDeLaPlaquette(id, generation)}`;
}

/* ------------------------------------------------------------------ */
/* La base                                                              */
/* ------------------------------------------------------------------ */

interface Ligne {
  id: string;
  project_id: string;
  card_id: string | null;
  agent_id: string | null;
  projet_marque_id: string | null;
  titre: string;
  langue: string;
  blocs: string;
  marque: string;
  version: number;
  generation: number;
  jeton_hash: string;
  lien_actif: number;
  cree_le: number;
  modifie_le: number;
  premiere_ouverture_le: number | null;
  derniere_ouverture_le: number | null;
  pdf_piece: string | null;
  pdf_version: number | null;
  format: string | null;
  vignette_piece: string | null;
  adresse: string | null;
  brouillon?: string | null;
  brouillon_modifie_le?: number | null;
  brouillon_base?: number | null;
}

export interface Plaquette {
  id: string;
  projectId: string;
  cardId?: string;
  agentId?: string;
  projetMarqueId?: string;
  titre: string;
  langue: string;
  blocs: BlocDePlaquette[];
  marque: MarqueDePlaquette;
  version: number;
  generation: number;
  lienActif: boolean;
  creeLe: number;
  modifieLe: number;
  premiereOuvertureLe?: number;
  derniereOuvertureLe?: number;
  pdfPiece?: string;
  pdfVersion?: number;
  format: FormatDePlaquette;
  /** La couverture photographiée avec le PDF de la version `pdfVersion`. */
  vignettePiece?: string;
  /** Tutoiement ou vouvoiement du document (demandé par l'agent à la rédaction). */
  adresse: AdresseDePlaquette;
}

function depuisLigne(l: Ligne): Plaquette {
  return {
    id: l.id,
    projectId: l.project_id,
    ...(l.card_id ? { cardId: l.card_id } : {}),
    ...(l.agent_id ? { agentId: l.agent_id } : {}),
    ...(l.projet_marque_id ? { projetMarqueId: l.projet_marque_id } : {}),
    titre: l.titre,
    langue: l.langue,
    /* Les fichiers à télécharger toujours en dernier, même pour un document d'avant la règle. */
    blocs: ordonnerLesBlocs(JSON.parse(l.blocs) as BlocDePlaquette[]),
    marque: JSON.parse(l.marque) as MarqueDePlaquette,
    version: l.version,
    generation: l.generation,
    lienActif: l.lien_actif === 1,
    creeLe: l.cree_le,
    modifieLe: l.modifie_le,
    ...(l.premiere_ouverture_le ? { premiereOuvertureLe: l.premiere_ouverture_le } : {}),
    ...(l.derniere_ouverture_le ? { derniereOuvertureLe: l.derniere_ouverture_le } : {}),
    ...(l.pdf_piece ? { pdfPiece: l.pdf_piece } : {}),
    ...(l.pdf_version ? { pdfVersion: l.pdf_version } : {}),
    format: formatDeLaPlaquette(l.format),
    ...(l.vignette_piece ? { vignettePiece: l.vignette_piece } : {}),
    adresse: lireLAdresseDePlaquette(l.adresse) ?? 'vous',
  };
}

export function lirePlaquette(id: string): Plaquette | null {
  const l = getDb().prepare('SELECT * FROM plaquettes WHERE id = ?').get(id) as Ligne | undefined;
  return l ? depuisLigne(l) : null;
}

function plaquetteDuJeton(jeton: string): Plaquette | null {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(jeton)) return null;
  const l = getDb().prepare('SELECT * FROM plaquettes WHERE jeton_hash = ?').get(empreinteDuJeton(jeton)) as Ligne | undefined;
  return l ? depuisLigne(l) : null;
}

export function listerPlaquettes(projectId: string): Plaquette[] {
  return (getDb().prepare('SELECT * FROM plaquettes WHERE project_id = ? ORDER BY modifie_le DESC').all(projectId) as Ligne[]).map(depuisLigne);
}

/** Une ligne de la page « Plaquettes » : de quoi remplir le tableau et la grille, sans la plaquette entière. */
export interface PlaquetteListee {
  id: string;
  projectId: string;
  titre: string;
  format: FormatDePlaquette;
  version: number;
  modifieLe: number;
  creeLe: number;
  lienActif: boolean;
  marque: string;
  couleur: string;
  ouvertures: number;
  derniereOuvertureLe: number | null;
  remarques: number;
  nonLues: number;
  /** Les fils de commentaires encore ouverts (le compteur de la carte du document). */
  filsOuverts: number;
  vignette: string | null;
  pdf: string | null;
  pdfAJour: boolean;
  /** La première phrase du document (l'accroche de la couverture), pour la carte de la colonne. */
  description: string;
}

/**
 * TOUTES LES PLAQUETTES des projets ouverts (la page « Plaquettes » n'a plus de colonne des projets : un filtre), la
 * plus récemment modifiée d'abord. Trois requêtes en tout, quel que soit leur nombre. `id` : la seule ligne de celle-là
 * (la page la relit seule quand elle change, au lieu de tout recharger).
 */
export function listerToutesLesPlaquettes(id?: string): PlaquetteListee[] {
  const db = getDb();
  const ouverts = new Set(store.listProjects().map((p) => p.id));
  const lignes = (id ? db.prepare('SELECT * FROM plaquettes WHERE id = ?').all(id) : db.prepare('SELECT * FROM plaquettes ORDER BY modifie_le DESC').all()) as Ligne[];
  const visibles = lignes.filter((l) => ouverts.has(l.project_id));
  if (!visibles.length) return [];
  const marques = visibles.map(() => '?').join(', ');
  const ids = visibles.map((l) => l.id);
  const ouvertures = new Map(
    (db.prepare(`SELECT plaquette_id AS id, SUM(ouvertures) AS n FROM plaquette_ouvertures WHERE plaquette_id IN (${marques}) GROUP BY plaquette_id`).all(...ids) as { id: string; n: number }[]).map((r) => [r.id, r.n]),
  );
  const remarques = new Map(
    (
      db
        .prepare(
          `SELECT plaquette_id AS id, COUNT(*) AS n, SUM(CASE WHEN lu = 0 THEN 1 ELSE 0 END) AS nonLues FROM plaquette_messages WHERE role = 'client' AND plaquette_id IN (${marques}) GROUP BY plaquette_id`,
        )
        .all(...ids) as { id: string; n: number; nonLues: number }[]
    ).map((r) => [r.id, r]),
  );
  const filsOuverts = new Map(
    (db.prepare(`SELECT plaquette_id AS id, COUNT(*) AS n FROM plaquette_fils WHERE resolu = 0 AND plaquette_id IN (${marques}) GROUP BY plaquette_id`).all(...ids) as { id: string; n: number }[]).map((r) => [
      r.id,
      r.n,
    ]),
  );
  return visibles.map((l) => {
    const p = depuisLigne(l);
    const r = remarques.get(p.id);
    const aJour = !!p.pdfPiece && p.pdfVersion === p.version;
    return {
      id: p.id,
      projectId: p.projectId,
      titre: p.titre,
      format: p.format,
      version: p.version,
      modifieLe: p.modifieLe,
      creeLe: p.creeLe,
      lienActif: p.lienActif,
      marque: p.marque.nom,
      couleur: p.marque.couleur,
      ouvertures: ouvertures.get(p.id) ?? 0,
      derniereOuvertureLe: p.derniereOuvertureLe ?? null,
      remarques: r?.n ?? 0,
      nonLues: r?.nonLues ?? 0,
      filsOuverts: filsOuverts.get(p.id) ?? 0,
      vignette: p.vignettePiece ?? null,
      pdf: p.pdfPiece ?? null,
      pdfAJour: aJour,
      description: descriptionDuDocument(p.blocs),
    };
  });
}

/* ------------------------------------------------------------------ */
/* La marque par défaut et la charte retenue                            */
/* ------------------------------------------------------------------ */

/** L'accroche du document : le texte de la couverture, sinon celui de la première section, coupé court. */
function descriptionDuDocument(blocs: readonly BlocDePlaquette[]): string {
  const visibles = blocs.filter((b) => !b.masque);
  const texte = (visibles.find((b) => b.genre === 'couverture')?.texte || visibles.find((b) => b.texte)?.texte || '').replace(/\s+/g, ' ').trim();
  return texte.length > 140 ? `${texte.slice(0, 139)}…` : texte;
}

const sansAccents = (s: string) => minusculesSansAccents(s).trim();

/**
 * L'AUTEUR QUI SIGNE les documents (« Réalisé par … », en petit). Décision de l'utilisateur (carte « Charte : logo du
 * bon projet ») : un document est ENTIÈREMENT à l'identité du projet qu'il décrit — logo, couleurs, police, pieds — et
 * le studio n'y paraît qu'en signature. Le réglage `marqueDesPlaquettes` d'abord ; sinon le projet qui porte le nom de
 * l'entreprise de l'installation. Rien de Haiko n'est écrit ici. Ce projet ne donne PLUS la marque d'un document.
 */
export function projetDeLaSignature(): Project | null {
  const ouverts = store.listProjects().filter((p) => !p.archived);
  const regle = store.getSettings().marqueDesPlaquettes;
  if (regle) {
    const p = ouverts.find((x) => x.id === regle);
    if (p) return p;
  }
  const identite = identiteDInstallation();
  for (const nom of [identite.nomCourt, identite.nomDeLEntreprise].map((n) => sansAccents(n ?? '')).filter(Boolean)) {
    const p = ouverts.find((x) => sansAccents(x.name) === nom);
    if (p) return p;
  }
  return null;
}

/**
 * L'ICÔNE DU PROJET SIGNATAIRE (carte « Finitions du lecteur de charte ») : celle de la colonne de gauche
 * (`fichierFavicon`), embarquée en `data:` — la page du client et le PDF n'ont pas de session pour lire `/api/favicon`.
 * Le projet est celui dont le NOM est la signature du document (le réglage d'abord). Jamais gardée en base.
 */
const iconesLues = new Map<string, { cle: string; donnee: string | null }>();
export function iconeDeLaSignature(signature: string | undefined): string | null {
  const nom = sansAccents(signature ?? '');
  if (!nom) return null;
  const reglee = projetDeLaSignature();
  const projet = reglee && sansAccents(reglee.name) === nom ? reglee : store.listProjects().find((p) => !p.archived && sansAccents(p.name) === nom);
  if (!projet) return null;
  const f = fichierFavicon(projet.id);
  if (!f) return null;
  try {
    const st = fs.statSync(f.file);
    const cleDuFichier = `${f.file}:${st.size}:${st.mtimeMs}`;
    const deja = iconesLues.get(projet.id);
    if (deja && deja.cle === cleDuFichier) return deja.donnee;
    const mime = f.mime === 'image/vnd.microsoft.icon' ? 'image/x-icon' : f.mime;
    const donnee = st.size <= 280_000 && /^image\/(png|jpeg|webp|gif|svg\+xml|x-icon)$/.test(mime) ? `data:${mime};base64,${fs.readFileSync(f.file).toString('base64')}` : null;
    iconesLues.set(projet.id, { cle: cleDuFichier, donnee });
    return donnee;
  } catch {
    return null;
  }
}

/** La marque telle qu'elle se rend : l'icône du signataire posée à côté de son nom. */
export function marqueARendre(marque: MarqueDePlaquette): MarqueDePlaquette {
  const icone = marque.signature ? iconeDeLaSignature(marque.signature) : null;
  return icone ? { ...marque, signatureIcone: icone } : marque;
}

const CLE_CHARTE = (projetMarqueId: string) => `plaquettes.charte.${projetMarqueId}`;

/** La charte retenue pour une marque (la dernière utilisée) : l'agent n'a plus à la relire dans le dépôt à chaque fois. */
export function charteRetenue(projetMarqueId: string): (MarqueDePlaquette & { logoProjet?: string }) | null {
  const brut = store.getMetaValue(CLE_CHARTE(projetMarqueId));
  if (!brut) {
    /* Pas encore retenue : la dernière plaquette faite à ses couleurs. */
    const l = getDb().prepare('SELECT marque, project_id FROM plaquettes WHERE projet_marque_id = ? ORDER BY modifie_le DESC LIMIT 1').get(projetMarqueId) as
      | { marque: string; project_id: string }
      | undefined;
    if (!l) return null;
    try {
      return { ...(JSON.parse(l.marque) as MarqueDePlaquette), logoProjet: l.project_id };
    } catch {
      return null;
    }
  }
  try {
    return JSON.parse(brut) as MarqueDePlaquette & { logoProjet?: string };
  } catch {
    return null;
  }
}

export function retenirLaCharte(projetMarqueId: string, marque: MarqueDePlaquette, projetDuLogo: string): void {
  /* La signature est celle de l'auteur, pas une part de la charte du projet. */
  const { signature: _signature, ...charte } = marque;
  store.setMetaValue(CLE_CHARTE(projetMarqueId), JSON.stringify({ ...charte, logoProjet: projetDuLogo }));
}

/**
 * UN LOGO VENU D'UN AUTRE PROJET est recopié dans celui de la plaquette (même fichier, empreinte dédoublonnée) : une
 * plaquette ne cite que des pièces de son projet, et le lien public n'en sert pas d'autres.
 */
export async function logoDansLeProjet(logo: string | undefined, projectId: string): Promise<string | undefined> {
  if (!logo) return undefined;
  const a = store.getAttachment(logo);
  if (!a || !a.mime?.startsWith('image/')) return undefined;
  if (a.projectId === projectId) return a.id;
  const f = fichierDeLaPiece(a);
  if (!f) return undefined;
  const j = await joindreUnFichier({ projectId, fichier: f, nom: a.name, deLAgent: true });
  return j.ok ? j.attachment.id : undefined;
}

/** L'empreinte du fichier d'une pièce image (deux copies du même logo dans deux projets ont la même). */
function empreinteDeLaPiece(id: string): string | null {
  const a = store.getAttachment(id);
  const f = a ? fichierDeLaPiece(a) : null;
  if (!f) return null;
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  } catch {
    return null;
  }
}

/**
 * LE LOGO D'UN AUTRE PROJET N'ENTRE PAS DANS UN DOCUMENT (décision de l'utilisateur) : rend les pièces, parmi `ids`, qui
 * sont le logo retenu pour la SIGNATURE (même fichier, recopié ou non). Rien quand la marque est la signature elle-même.
 */
export function logosDeLaSignatureParmi(ids: readonly string[], projetMarqueId: string): string[] {
  const auteur = projetDeLaSignature();
  if (!auteur || auteur.id === projetMarqueId) return [];
  const logo = charteRetenue(auteur.id)?.logo;
  const empreinte = logo ? empreinteDeLaPiece(logo) : null;
  if (!logo || !empreinte) return [];
  return ids.filter((id) => id === logo || empreinteDeLaPiece(id) === empreinte);
}

/* ------------------------------------------------------------------ */
/* Les fils de commentaires                                             */
/* ------------------------------------------------------------------ */

interface LigneDeFil {
  id: string;
  plaquette_id: string;
  bloc: string | null;
  page: number;
  y: number;
  resolu: number;
  cree_le: number;
  modifie_le: number;
}
interface LigneDeMessage {
  id: string;
  fil_id: string;
  auteur: string;
  role: string;
  texte: string;
  cree_le: number;
  lu: number;
  supprime_le: number | null;
  visiteur: string | null;
  compte: string | null;
}

/** L'empreinte du repère de navigateur d'un client (jamais gardé en clair). */
export function empreinteDuVisiteur(repere: unknown): string | null {
  if (typeof repere !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(repere)) return null;
  return crypto.createHash('sha256').update(`plaquette-visiteur:${repere}`).digest('hex').slice(0, 32);
}

/** Les fils d'un document, chacun avec ses messages, du plus ancien au plus récent. Deux requêtes en tout. */
export function filsDe(plaquetteId: string): FilDeCommentaires[] {
  const db = getDb();
  const fils = db.prepare('SELECT * FROM plaquette_fils WHERE plaquette_id = ? ORDER BY cree_le').all(plaquetteId) as LigneDeFil[];
  const messages = db.prepare('SELECT * FROM plaquette_messages WHERE plaquette_id = ? ORDER BY cree_le').all(plaquetteId) as LigneDeMessage[];
  const parFil = new Map<string, MessageDeFil[]>();
  for (const m of messages) {
    const liste = parFil.get(m.fil_id) ?? [];
    liste.push({
      id: m.id,
      auteur: m.auteur,
      role: m.role === 'equipe' ? 'equipe' : 'client',
      texte: m.supprime_le ? '' : m.texte,
      creeLe: m.cree_le,
      lu: m.lu === 1 || !!m.supprime_le,
      ...(m.supprime_le ? { supprime: true } : {}),
      ...(m.visiteur ? { visiteur: m.visiteur } : {}),
      ...(m.compte ? { compte: m.compte } : {}),
    });
    parFil.set(m.fil_id, liste);
  }
  return fils.map((f) => ({
    id: f.id,
    page: f.page,
    y: f.y,
    ...(f.bloc ? { bloc: f.bloc } : {}),
    resolu: f.resolu === 1,
    creeLe: f.cree_le,
    modifieLe: f.modifie_le,
    messages: parFil.get(f.id) ?? [],
  }));
}

function lireUnFil(plaquetteId: string, filId: string): FilDeCommentaires | null {
  return filsDe(plaquetteId).find((f) => f.id === filId) ?? null;
}

/** Le compte Beluga qui commente, tel que les fils le retiennent (identifiant, nom affiché, administrateur ou non). */
export function compteQuiCommente(c: { id: string; identifiant: string; nomAffiche: string; role: string }): { id: string; nomAffiche: string; admin: boolean } {
  return { id: c.id, nomAffiche: c.nomAffiche || c.identifiant, admin: c.role === 'admin' };
}

/** Le nom que portent les messages de l'équipe sans compte connu : celui de l'installation (« Haiko »). */
export function nomDeLEquipe(): string {
  return nomCourtDeLInstallation();
}

/**
 * UN MESSAGE DU CLIENT SONNE LA CLOCHE (genre « attente » : un client attend une réponse — décision de l'utilisateur,
 * et l'un des trois genres qui alertent). La carte du document compte ses fils ouverts ; le récapitulatif du jour
 * les reprend.
 */
function sonnerPourLeClient(p: Plaquette, auteur: string, texte: string, nouveauFil: boolean): void {
  const court = texte.length > 140 ? `${texte.slice(0, 137)}…` : texte;
  notify({
    motif: 'plaquette-remarque',
    title: nouveauFil ? `Nouveau commentaire sur « ${p.titre} »` : `Réponse de votre client sur « ${p.titre} »`,
    body: `${auteur ? `${auteur} : ` : ''}« ${court} »`,
    reference: `plaquette-commentaire:${p.id}:${Date.now()}`,
    element: p.titre,
    projectId: p.projectId,
    ...(p.cardId ? { cardId: p.cardId } : {}),
  });
}

/**
 * QUI ÉCRIT : un client (son nom tapé, l'empreinte de son navigateur) ou un compte de l'équipe (son identifiant et son
 * nom affiché). Sans compte, l'équipe écrit au nom de l'installation (anciens appels, scripts).
 */
export interface AuteurDUnMessage {
  role: RoleDansUnFil;
  auteur?: string;
  visiteur?: string | null;
  compte?: { id: string; nomAffiche: string } | null;
}

function nomDeLAuteur(qui: AuteurDUnMessage, nomTape: string | undefined): string {
  if (qui.role !== 'equipe') return nomTape ?? '';
  return qui.auteur ?? (qui.compte?.nomAffiche || nomDeLEquipe());
}

export type ResultatDeFil = { ok: true; fil: FilDeCommentaires } | { ok: false; raison: string };

/** Un fil neuf, posé à un endroit du document, avec son premier message. */
export function creerUnFil(p: Plaquette, brut: unknown, qui: AuteurDUnMessage): ResultatDeFil {
  const lu = lireUnCommentaire(brut);
  if (!lu.ok) return lu;
  const ancre = lireUneAncre(brut, p.blocs);
  const maintenant = Date.now();
  const id = crypto.randomUUID();
  const auteur = nomDeLAuteur(qui, lu.nom);
  const db = getDb();
  db.prepare('INSERT INTO plaquette_fils (id, plaquette_id, bloc, page, y, resolu, cree_le, modifie_le) VALUES (?, ?, ?, ?, ?, 0, ?, ?)').run(
    id,
    p.id,
    ancre.bloc ?? null,
    ancre.page,
    ancre.y,
    maintenant,
    maintenant,
  );
  db.prepare('INSERT INTO plaquette_messages (id, fil_id, plaquette_id, auteur, role, texte, cree_le, lu, visiteur, compte) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    crypto.randomUUID(),
    id,
    p.id,
    auteur,
    qui.role,
    lu.texte,
    maintenant,
    qui.role === 'equipe' ? 1 : 0,
    qui.role === 'client' ? (qui.visiteur ?? null) : null,
    qui.role === 'equipe' ? (qui.compte?.id ?? null) : null,
  );
  diffuser(p.projectId, p.id);
  if (qui.role === 'client') sonnerPourLeClient(p, auteur, lu.texte, true);
  return { ok: true, fil: lireUnFil(p.id, id)! };
}

/** Une réponse dans un fil ; un fil résolu qui reçoit un message se rouvre. */
export function repondreAuFil(p: Plaquette, filId: string, brut: unknown, qui: AuteurDUnMessage): ResultatDeFil {
  const fil = lireUnFil(p.id, filId);
  if (!fil) return { ok: false, raison: 'introuvable' };
  const lu = lireUnCommentaire(brut);
  if (!lu.ok) return lu;
  const maintenant = Date.now();
  const auteur = nomDeLAuteur(qui, lu.nom);
  const db = getDb();
  db.prepare('INSERT INTO plaquette_messages (id, fil_id, plaquette_id, auteur, role, texte, cree_le, lu, visiteur, compte) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    crypto.randomUUID(),
    filId,
    p.id,
    auteur,
    qui.role,
    lu.texte,
    maintenant,
    qui.role === 'equipe' ? 1 : 0,
    qui.role === 'client' ? (qui.visiteur ?? null) : null,
    qui.role === 'equipe' ? (qui.compte?.id ?? null) : null,
  );
  /* L'équipe qui répond a lu le fil. */
  if (qui.role === 'equipe') db.prepare("UPDATE plaquette_messages SET lu = 1 WHERE fil_id = ? AND role = 'client'").run(filId);
  db.prepare('UPDATE plaquette_fils SET resolu = 0, modifie_le = ? WHERE id = ?').run(maintenant, filId);
  diffuser(p.projectId, p.id);
  if (qui.role === 'client') sonnerPourLeClient(p, auteur, lu.texte, false);
  return { ok: true, fil: lireUnFil(p.id, filId)! };
}

export function resoudreLeFil(p: Plaquette, filId: string, resolu: boolean): ResultatDeFil {
  const r = getDb().prepare('UPDATE plaquette_fils SET resolu = ?, modifie_le = ? WHERE id = ? AND plaquette_id = ?').run(resolu ? 1 : 0, Date.now(), filId, p.id);
  if (!r.changes) return { ok: false, raison: 'introuvable' };
  diffuser(p.projectId, p.id);
  return { ok: true, fil: lireUnFil(p.id, filId)! };
}

/**
 * SUPPRIMER SON PROPRE MESSAGE (décision de l'utilisateur : « chacun ses propres messages, avec une mention message
 * supprimé ») : l'équipe supprime les messages de l'équipe ; un client, seulement ceux écrits depuis SON navigateur
 * (même empreinte). Suppression douce : le texte est effacé, la bulle garde sa mention ; la notification déjà partie
 * reste. Rend le fil à jour, ou la raison du refus.
 */
export function supprimerUnMessage(
  p: Plaquette,
  filId: string,
  messageId: string,
  qui: { role: RoleDansUnFil; visiteur?: string | null; compte?: { id: string; nomAffiche: string; admin?: boolean } | null },
): ResultatDeFil {
  const m = getDb().prepare('SELECT * FROM plaquette_messages WHERE id = ? AND fil_id = ? AND plaquette_id = ?').get(messageId, filId, p.id) as LigneDeMessage | undefined;
  if (!m) return { ok: false, raison: 'introuvable' };
  /*
   * Un message de l'équipe : SON compte seul le supprime. Un message d'avant (sans compte) : celui qui porte son nom,
   * ou l'administrateur. Sans compte connu (anciens appels), tout l'équipe garde le droit d'avant.
   */
  const sienPourLEquipe = (): boolean => {
    if (m.role !== 'equipe') return false;
    if (!qui.compte) return true;
    if (m.compte) return m.compte === qui.compte.id;
    return !!qui.compte.admin || m.auteur === qui.compte.nomAffiche;
  };
  const sien = qui.role === 'equipe' ? sienPourLEquipe() : m.role === 'client' && !!qui.visiteur && m.visiteur === qui.visiteur;
  if (!sien) return { ok: false, raison: 'interdit' };
  if (!m.supprime_le) getDb().prepare("UPDATE plaquette_messages SET supprime_le = ?, texte = '', lu = 1 WHERE id = ?").run(Date.now(), messageId);
  diffuser(p.projectId, p.id);
  return { ok: true, fil: lireUnFil(p.id, filId)! };
}

/** L'équipe a ouvert le fil (ou tout le document, sans `filId`) : ses messages du client sont lus. */
export function marquerLesFilsLus(plaquetteId: string, filId?: string): void {
  const p = lirePlaquette(plaquetteId);
  if (!p) return;
  if (filId) getDb().prepare("UPDATE plaquette_messages SET lu = 1 WHERE plaquette_id = ? AND fil_id = ? AND role = 'client'").run(plaquetteId, filId);
  else getDb().prepare("UPDATE plaquette_messages SET lu = 1 WHERE plaquette_id = ? AND role = 'client'").run(plaquetteId);
  diffuser(p.projectId, p.id);
}

/* ------------------------------------------------------------------ */
/* Le récapitulatif quotidien                                           */
/* ------------------------------------------------------------------ */

const CLE_DU_RECAP = 'plaquettes.recap.dernier';

/**
 * LE COURRIEL DU JOUR (décision de l'utilisateur : « un mail récap tous les jours si y a quelque chose de nouveau ») :
 * joué par la tournée horaire du démon. Part à l'adresse du point quotidien, une fois par jour au plus, à partir de 8 h,
 * et SEULEMENT s'il y a des messages du client depuis le dernier envoi. La date est posée AVANT l'envoi : un refus ne se
 * rejoue pas toutes les heures (un courriel perdu plutôt qu'un doublon).
 */
export async function envoyerLeRecapDesCommentaires(
  maintenant = Date.now(),
  envoyer: (a: string, sujet: string, texte: string, html: string) => Promise<string | null> = async (a, sujet, texte, html) => {
    const { envoiPossible, envoyerUnCourriel } = await import('./envoi-des-courriels.js');
    if (!envoiPossible()) return 'envoi des courriels éteint';
    return envoyerUnCourriel(a, sujet, texte, html);
  },
): Promise<{ envoye: boolean; raison?: string; messages?: number }> {
  const brut = store.getMetaValue(CLE_DU_RECAP);
  /* Premier passage : on part de maintenant (les remarques reprises d'avant ne font pas un courriel). */
  if (!brut) {
    store.setMetaValue(CLE_DU_RECAP, String(maintenant));
    return { envoye: false, raison: 'premier-passage' };
  }
  const dernier = Number(brut) || 0;
  const lignes = getDb()
    .prepare("SELECT m.plaquette_id AS plaquette, m.auteur, m.texte, m.cree_le FROM plaquette_messages m WHERE m.role = 'client' AND m.supprime_le IS NULL AND m.cree_le > ? ORDER BY m.cree_le")
    .all(dernier) as { plaquette: string; auteur: string; texte: string; cree_le: number }[];
  const ouverts = new Set(store.listProjects().map((x) => x.id));
  const parDocument = new Map<string, { p: Plaquette; messages: { auteur: string; texte: string; creeLe: number }[] }>();
  for (const l of lignes) {
    const p = lirePlaquette(l.plaquette);
    if (!p || !ouverts.has(p.projectId)) continue;
    const d = parDocument.get(p.id) ?? { p, messages: [] };
    d.messages.push({ auteur: l.auteur, texte: l.texte, creeLe: l.cree_le });
    parDocument.set(p.id, d);
  }
  const nouveaux = [...parDocument.values()].reduce((n, d) => n + d.messages.length, 0);
  if (!recapDesCommentairesAEnvoyer({ maintenant, dernierEnvoi: dernier, nouveaux })) return { envoye: false, raison: nouveaux ? 'pas-maintenant' : 'rien-de-neuf' };
  const destinataire = adresseDuRecapitulatif();
  if (!destinataire) return { envoye: false, raison: 'sans-destinataire' };
  const base = adresseDuLien();
  const courriel = courrielDuRecapDesCommentaires({
    documents: [...parDocument.values()].map((d) => ({ titre: d.p.titre, lien: `${base}/#charte/tous/${encodeURIComponent(d.p.id)}`, messages: d.messages })),
    lienDuService: `${base}/#charte`,
  });
  store.setMetaValue(CLE_DU_RECAP, String(maintenant));
  const echec = await envoyer(destinataire, courriel.sujet, courriel.texte, courriel.html);
  if (echec) {
    log.warn(`charte graphique : le récapitulatif des commentaires n'est pas parti — ${echec}`);
    return { envoye: false, raison: echec };
  }
  log.info(`charte graphique : récapitulatif de ${nouveaux} commentaire(s) envoyé à ${destinataire}`);
  return { envoye: true, messages: nouveaux };
}

export function ouverturesDe(id: string): { total: number; parJour: { jour: string; ouvertures: number }[] } {
  const parJour = getDb().prepare('SELECT jour, ouvertures FROM plaquette_ouvertures WHERE plaquette_id = ? ORDER BY jour DESC LIMIT 60').all(id) as {
    jour: string;
    ouvertures: number;
  }[];
  const total = (getDb().prepare('SELECT COALESCE(SUM(ouvertures), 0) AS n FROM plaquette_ouvertures WHERE plaquette_id = ?').get(id) as { n: number }).n;
  return { total, parJour };
}

/** La fiche complète vue par l'éditeur : la plaquette, son lien, son compteur et ses remarques. */
export function ficheDeLaPlaquette(id: string) {
  const p = lirePlaquette(id);
  if (!p) return null;
  const fils = filsDe(id);
  return {
    plaquette: { ...p, marque: marqueARendre(p.marque) },
    /* Le brouillon de l'équipe (retouches pas encore enregistrées), avec la version d'où il est parti. */
    brouillon: brouillonDe(id),
    projetMarqueNom: p.projetMarqueId ? (store.getProject(p.projetMarqueId)?.name ?? null) : null,
    lien: `${adresseDuLien()}${cheminDuLien(p.id, p.generation)}`,
    ouvertures: ouverturesDe(id),
    fils,
    nonLues: fils.reduce((n, f) => n + f.messages.filter((m) => m.role === 'client' && !m.lu).length, 0),
    /* Le nom et le type des pièces citées (la liste des ressources de l'éditeur). */
    pieces: Object.fromEntries(piecesDeLaPlaquette(p.blocs, p.marque).map((x) => [x, infoDePiece(x)]).filter(([, v]) => v)),
    pdfAJour: !!p.pdfPiece && p.pdfVersion === p.version,
  };
}

/** L'adresse publique où le client ouvre le lien : celle de l'installation (MEM-1175). */
export function adresseDuLien(): string {
  return adresseDeBeluga();
}

function diffuser(projectId: string, id: string): void {
  bus.emit({ type: 'plaquettes.change', projectId, plaquetteId: id });
}

/**
 * LE CADRE D'UNE CAPTURE SE DÉDUIT quand l'agent ne l'a pas dit : une pièce notée « capture » par l'outil reçoit le
 * cadre de son appareil (téléphone si son nom le dit, navigateur sinon) ; une autre image (photo, logo) reste nue.
 */
function deduireLesCadres(blocs: BlocDePlaquette[]): BlocDePlaquette[] {
  const genres = genresDesCaptures();
  for (const b of blocs) {
    if (b.appareil || !b.pieces?.length || b.genre === 'chiffres' || b.genre === 'texte' || b.genre === 'appel') continue;
    const premiere = b.pieces[0]!;
    if (genres.get(premiere) !== 'capture') continue;
    const nom = store.getAttachment(premiere)?.name ?? '';
    b.appareil = /telephone|mobile|phone|iphone|pwa/i.test(nom) ? 'telephone' : 'navigateur';
  }
  return blocs;
}

export type Creation = { ok: true; plaquette: Plaquette } | { ok: false; raison: string };

export function creerPlaquette(opts: {
  projectId: string;
  cardId?: string;
  agentId?: string;
  projetMarqueId?: string;
  titre: string;
  langue?: string;
  blocs: unknown;
  marque: unknown;
  format?: unknown;
  adresse?: unknown;
}): Creation {
  const titre = opts.titre.trim().slice(0, 160);
  if (!titre) return { ok: false, raison: 'La plaquette a un titre.' };
  const blocs = lireLesBlocs(opts.blocs, () => crypto.randomBytes(5).toString('hex'));
  if (!blocs.ok) return blocs;
  /* Une charte porte toujours ses cartes de visite et son papier à lettres (masqués tant qu'ils ne sont pas faits). */
  blocs.blocs = avecLesSupportsDeCharte(blocs.blocs, () => crypto.randomBytes(5).toString('hex'));
  deduireLesCadres(blocs.blocs);
  const marque = lireLaMarque(opts.marque);
  if (!marque.ok) return marque;
  const inconnues = piecesDeLaPlaquette(blocs.blocs, marque.marque).filter((p) => store.getAttachment(p)?.projectId !== opts.projectId);
  if (inconnues.length) return { ok: false, raison: `Images inconnues dans ce projet : ${inconnues.join(', ')}. Une plaquette ne cite que des pièces jointes du projet.` };
  const id = crypto.randomUUID();
  const maintenant = Date.now();
  const langue = (LANGUES_DE_PLAQUETTE as readonly string[]).includes(String(opts.langue)) ? String(opts.langue) : 'fr';
  const format = formatDeLaPlaquette(opts.format);
  getDb()
    .prepare(
      `INSERT INTO plaquettes (id, project_id, card_id, agent_id, projet_marque_id, titre, langue, blocs, marque, version, generation, jeton_hash, lien_actif, cree_le, modifie_le, format, adresse)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, 1, ?, ?, ?, ?)`,
    )
    .run(
      id,
      opts.projectId,
      opts.cardId ?? null,
      opts.agentId ?? null,
      opts.projetMarqueId ?? null,
      titre,
      langue,
      JSON.stringify(blocs.blocs),
      JSON.stringify(marque.marque),
      empreinteDuJeton(jetonDeLaPlaquette(id, 1)),
      maintenant,
      maintenant,
      format,
      lireLAdresseDePlaquette(opts.adresse) ?? 'vous',
    );
  garderLaVersion(id);
  diffuser(opts.projectId, id);
  return { ok: true, plaquette: lirePlaquette(id)! };
}

/** L'INSTANTANÉ D'UNE VERSION PUBLIÉE (aucun écran ne les liste encore : ils gardent l'histoire du document). */
function garderLaVersion(id: string): void {
  try {
    getDb()
      .prepare(
        `INSERT OR IGNORE INTO plaquette_versions (plaquette_id, version, titre, langue, blocs, marque, format, adresse, cree_le)
         SELECT id, version, titre, langue, blocs, marque, format, adresse, modifie_le FROM plaquettes WHERE id = ?`,
      )
      .run(id);
  } catch (err) {
    log.warn(`plaquette ${id} : instantané de version non gardé (${(err as Error).message})`);
  }
}

/** Les versions gardées d'un document, de la plus récente à la plus ancienne. */
export function versionsDe(id: string): { version: number; titre: string; creeLe: number }[] {
  return (getDb().prepare('SELECT version, titre, cree_le FROM plaquette_versions WHERE plaquette_id = ? ORDER BY version DESC').all(id) as { version: number; titre: string; cree_le: number }[]).map((v) => ({
    version: v.version,
    titre: v.titre,
    creeLe: v.cree_le,
  }));
}

/* ------------------------------------------------------------------ */
/* Le brouillon de l'équipe                                             */
/* ------------------------------------------------------------------ */

export interface BrouillonDePlaquette {
  titre: string;
  blocs: BlocDePlaquette[];
  marque: MarqueDePlaquette;
  format: FormatDePlaquette;
  adresse: AdresseDePlaquette;
  langue: string;
  modifieLe: number;
  /** La version publiée sur laquelle le brouillon est parti : plus basse que la courante, l'agent a publié depuis. */
  base: number;
}

/** Le brouillon en cours d'un document, ou rien. Jamais lu par le lien du client ni par le PDF. */
export function brouillonDe(id: string): BrouillonDePlaquette | null {
  const l = getDb().prepare('SELECT brouillon, brouillon_modifie_le, brouillon_base, version FROM plaquettes WHERE id = ?').get(id) as
    | { brouillon: string | null; brouillon_modifie_le: number | null; brouillon_base: number | null; version: number }
    | undefined;
  if (!l?.brouillon) return null;
  try {
    const b = JSON.parse(l.brouillon) as Omit<BrouillonDePlaquette, 'modifieLe' | 'base'>;
    return { ...b, blocs: ordonnerLesBlocs(b.blocs), marque: marqueARendre(b.marque), modifieLe: l.brouillon_modifie_le ?? 0, base: l.brouillon_base ?? l.version };
  } catch {
    return null;
  }
}

type Changement = { titre?: unknown; blocs?: unknown; marque?: unknown; langue?: unknown; format?: unknown; adresse?: unknown };

/** Le contenu complet qu'un changement donne, lu et vérifié comme une publication (souple : une section vidée reste). */
function contenuDuChangement(p: Plaquette, depart: Omit<BrouillonDePlaquette, 'modifieLe' | 'base'>, changement: Changement): { ok: true; contenu: Omit<BrouillonDePlaquette, 'modifieLe' | 'base'> } | { ok: false; raison: string } {
  const titre = typeof changement.titre === 'string' && changement.titre.trim() ? changement.titre.trim().slice(0, 160) : depart.titre;
  let blocs = depart.blocs;
  if (changement.blocs !== undefined) {
    const lus = lireLesBlocs(changement.blocs, () => crypto.randomBytes(5).toString('hex'), { souple: true });
    if (!lus.ok) return lus;
    blocs = deduireLesCadres(lus.blocs);
  }
  let marque = depart.marque;
  if (changement.marque !== undefined) {
    const lue = lireLaMarque(changement.marque);
    if (!lue.ok) return lue;
    marque = !lue.marque.signature && p.marque.signature ? { ...lue.marque, signature: p.marque.signature } : lue.marque;
  }
  const inconnues = piecesDeLaPlaquette(blocs, marque).filter((x) => store.getAttachment(x)?.projectId !== p.projectId);
  if (inconnues.length) return { ok: false, raison: `Images inconnues dans ce projet : ${inconnues.join(', ')}.` };
  return {
    ok: true,
    contenu: {
      titre,
      blocs,
      marque,
      langue: (LANGUES_DE_PLAQUETTE as readonly string[]).includes(String(changement.langue)) ? String(changement.langue) : depart.langue,
      format: lireLeFormatDePlaquette(changement.format) ?? depart.format,
      adresse: lireLAdresseDePlaquette(changement.adresse) ?? depart.adresse,
    },
  };
}

/**
 * LES RETOUCHES DE L'ÉQUIPE VONT DANS LE BROUILLON (décision de l'utilisateur : « Enregistrer crée une nouvelle
 * version, le client ne voit que la version finale »). Rien ne change pour le client ni pour le PDF.
 */
export function enregistrerLeBrouillon(id: string, changement: Changement): { ok: true; brouillon: BrouillonDePlaquette } | { ok: false; raison: string } {
  const p = lirePlaquette(id);
  if (!p) return { ok: false, raison: 'Plaquette introuvable.' };
  const avant = brouillonDe(id);
  const depart = avant ?? { titre: p.titre, blocs: p.blocs, marque: p.marque, format: p.format, adresse: p.adresse, langue: p.langue };
  const lu = contenuDuChangement(p, depart, changement);
  if (!lu.ok) return lu;
  const { signatureIcone: _icone, ...marque } = lu.contenu.marque;
  getDb()
    .prepare('UPDATE plaquettes SET brouillon = ?, brouillon_modifie_le = ?, brouillon_base = ? WHERE id = ?')
    .run(JSON.stringify({ ...lu.contenu, marque }), Date.now(), avant?.base ?? p.version, id);
  return { ok: true, brouillon: brouillonDe(id)! };
}

/** « ENREGISTRER » : le brouillon (et le dernier changement, s'il y en a un) devient la NOUVELLE VERSION publiée. */
export function publierLeBrouillon(id: string, changement: Changement = {}): Creation {
  const p = lirePlaquette(id);
  if (!p) return { ok: false, raison: 'Plaquette introuvable.' };
  const avant = brouillonDe(id);
  /* Rien à publier : aucun brouillon, aucun changement — la version reste la même. */
  if (!avant && !Object.values(changement).some((v) => v !== undefined)) return { ok: true, plaquette: p };
  const depart = avant ?? { titre: p.titre, blocs: p.blocs, marque: p.marque, format: p.format, adresse: p.adresse, langue: p.langue };
  const lu = contenuDuChangement(p, depart, changement);
  if (!lu.ok) return lu;
  const { signatureIcone: _icone, ...marque } = lu.contenu.marque;
  /* Le même contenu que la version publiée : aucune version de plus, le brouillon s'efface. */
  const pareil = (x: object) => JSON.stringify(x);
  if (
    pareil({ ...lu.contenu, marque }) ===
    pareil({ titre: p.titre, blocs: p.blocs, marque: p.marque, langue: p.langue, format: p.format, adresse: p.adresse })
  ) {
    abandonnerLeBrouillon(id);
    return { ok: true, plaquette: p };
  }
  const r = modifierPlaquette(id, { ...lu.contenu, marque }, { souple: true });
  if (r.ok) abandonnerLeBrouillon(id);
  return r.ok ? { ok: true, plaquette: lirePlaquette(id)! } : r;
}

/** « ABANDONNER » : le brouillon disparaît, le document reste à sa dernière version publiée. */
export function abandonnerLeBrouillon(id: string): boolean {
  return getDb().prepare('UPDATE plaquettes SET brouillon = NULL, brouillon_modifie_le = NULL, brouillon_base = NULL WHERE id = ?').run(id).changes === 1;
}

/**
 * Une nouvelle VERSION : titre, blocs, marque, langue et/ou format remplacés en entier (ce qui est absent reste tel
 * quel). La version qui monte rend le PDF et la vignette d'avant périmés : le prochain PDF est refait, au bon format.
 * La marque changée ici ne vaut QUE pour cette plaquette (décision de l'utilisateur).
 */
export function modifierPlaquette(
  id: string,
  changement: { titre?: unknown; blocs?: unknown; marque?: unknown; langue?: unknown; format?: unknown; adresse?: unknown; projetMarqueId?: string },
  options: { souple?: boolean } = {},
): Creation {
  const p = lirePlaquette(id);
  if (!p) return { ok: false, raison: 'Plaquette introuvable.' };
  const titre = typeof changement.titre === 'string' && changement.titre.trim() ? changement.titre.trim().slice(0, 160) : p.titre;
  let blocs = p.blocs;
  if (changement.blocs !== undefined) {
    const lus = lireLesBlocs(changement.blocs, () => crypto.randomBytes(5).toString('hex'), options);
    if (!lus.ok) return lus;
    blocs = deduireLesCadres(lus.blocs);
  }
  let marque = p.marque;
  if (changement.marque !== undefined) {
    const lue = lireLaMarque(changement.marque);
    if (!lue.ok) return lue;
    /* La signature de l'auteur reste celle du document quand la nouvelle marque n'en dit rien. */
    marque = !lue.marque.signature && p.marque.signature ? { ...lue.marque, signature: p.marque.signature } : lue.marque;
  }
  const inconnues = piecesDeLaPlaquette(blocs, marque).filter((x) => store.getAttachment(x)?.projectId !== p.projectId);
  if (inconnues.length) return { ok: false, raison: `Images inconnues dans ce projet : ${inconnues.join(', ')}.` };
  const langue = (LANGUES_DE_PLAQUETTE as readonly string[]).includes(String(changement.langue)) ? String(changement.langue) : p.langue;
  const format = lireLeFormatDePlaquette(changement.format) ?? p.format;
  const adresse = lireLAdresseDePlaquette(changement.adresse) ?? p.adresse;
  getDb()
    .prepare('UPDATE plaquettes SET titre = ?, blocs = ?, marque = ?, langue = ?, format = ?, adresse = ?, projet_marque_id = ?, version = version + 1, modifie_le = ? WHERE id = ?')
    .run(titre, JSON.stringify(blocs), JSON.stringify(marque), langue, format, adresse, changement.projetMarqueId ?? p.projetMarqueId ?? null, Date.now(), id);
  garderLaVersion(id);
  diffuser(p.projectId, id);
  return { ok: true, plaquette: lirePlaquette(id)! };
}

/** Couper, rouvrir, ou remplacer le lien (l'ancien meurt). */
export function regleLeLien(id: string, geste: 'couper' | 'rouvrir' | 'nouveau'): Plaquette | null {
  const p = lirePlaquette(id);
  if (!p) return null;
  if (geste === 'nouveau') {
    const g = p.generation + 1;
    getDb().prepare('UPDATE plaquettes SET generation = ?, jeton_hash = ?, lien_actif = 1 WHERE id = ?').run(g, empreinteDuJeton(jetonDeLaPlaquette(id, g)), id);
  } else {
    getDb().prepare('UPDATE plaquettes SET lien_actif = ? WHERE id = ?').run(geste === 'rouvrir' ? 1 : 0, id);
  }
  diffuser(p.projectId, id);
  return lirePlaquette(id);
}

export function supprimerPlaquette(id: string): boolean {
  const p = lirePlaquette(id);
  if (!p) return false;
  const db = getDb();
  db.prepare('DELETE FROM plaquette_remarques WHERE plaquette_id = ?').run(id);
  db.prepare('DELETE FROM plaquette_messages WHERE plaquette_id = ?').run(id);
  db.prepare('DELETE FROM plaquette_fils WHERE plaquette_id = ?').run(id);
  db.prepare('DELETE FROM plaquette_ouvertures WHERE plaquette_id = ?').run(id);
  db.prepare('DELETE FROM plaquette_versions WHERE plaquette_id = ?').run(id);
  db.prepare('DELETE FROM plaquettes WHERE id = ?').run(id);
  diffuser(p.projectId, id);
  return true;
}

/* ------------------------------------------------------------------ */
/* Le rendu et le PDF                                                   */
/* ------------------------------------------------------------------ */

function fichierDeLaPiece(a: Attachment): string | null {
  const chemin = cheminDePieceJointe(a);
  return fs.existsSync(chemin) ? chemin : null;
}

/** Le nom et le type d'une pièce jointe (liste des ressources). */
export function infoDePiece(id: string): { nom: string; mime?: string } | null {
  const a = store.getAttachment(id);
  return a ? { nom: a.name, ...(a.mime ? { mime: a.mime } : {}) } : null;
}

function imageEmbarquee(id: string): string | null {
  const a = store.getAttachment(id);
  if (!a || !a.mime?.startsWith('image/')) return null;
  const f = fichierDeLaPiece(a);
  if (!f) return null;
  return `data:${a.mime};base64,${fs.readFileSync(f).toString('base64')}`;
}

/**
 * LE PDF SE REFAIT SEUL APRÈS UNE RETOUCHE DE LA PAGE (décision du cadrage) : vingt secondes après la DERNIÈRE
 * modification, pour qu'une série d'enregistrements ne fabrique pas un PDF par clic.
 */
const pdfsAttendus = new Map<string, NodeJS.Timeout>();
export const ATTENTE_AVANT_LE_PDF_MS = 20_000;
export function refaireLePdfPlusTard(id: string, attente = ATTENTE_AVANT_LE_PDF_MS): void {
  clearTimeout(pdfsAttendus.get(id));
  const minuterie = setTimeout(() => {
    pdfsAttendus.delete(id);
    void fabriquerLePdf(id).then((r) => {
      if (!r.ok) log.warn(`plaquette ${id} : PDF après retouche impossible (${r.raison})`);
    });
  }, attente);
  minuterie.unref?.();
  pdfsAttendus.set(id, minuterie);
}

/** Le délai au-delà duquel la fabrication est une panne (Chrome qui ne rend pas la main), pas un travail lent. */
export const DELAI_DU_PDF_MS = 120_000;

/**
 * FABRIQUE le PDF de la version courante, AU FORMAT DE LA PLAQUETTE, avec la VIGNETTE de sa couverture (une image
 * PNG photographiée dans le même navigateur), les joint au projet (Fichiers : Captures/Plaquettes) et les note. Le PDF
 * porte le repère `plaquette` : le fil le montre en carte d'aperçu. Une version déjà fabriquée est resservie telle
 * quelle. Borné à `DELAI_DU_PDF_MS` : au-delà, l'échec se dit, la plaquette reste.
 */
export async function fabriquerLePdf(id: string): Promise<{ ok: true; piece: Attachment; vignette?: Attachment } | { ok: false; raison: string }> {
  const p = lirePlaquette(id);
  if (!p) return { ok: false, raison: 'Plaquette introuvable.' };
  if (p.pdfPiece && p.pdfVersion === p.version) {
    const deja = store.getAttachment(p.pdfPiece);
    if (deja) {
      const vignette = p.vignettePiece ? store.getAttachment(p.vignettePiece) : null;
      return { ok: true, piece: deja, ...(vignette ? { vignette } : {}) };
    }
  }
  let minuterie: NodeJS.Timeout | undefined;
  const delai = new Promise<{ ok: false; raison: string }>((resolve) => {
    minuterie = setTimeout(() => resolve({ ok: false, raison: `Le PDF n'a pas été prêt en ${Math.round(DELAI_DU_PDF_MS / 1000)} s : réessayez dans un instant.` }), DELAI_DU_PDF_MS);
  });
  try {
    return await Promise.race([fabriquer(p), delai]);
  } finally {
    clearTimeout(minuterie);
  }
}

async function fabriquer(p: Plaquette): Promise<{ ok: true; piece: Attachment; vignette?: Attachment } | { ok: false; raison: string }> {
  const id = p.id;
  /* LE PDF montre ses propres sections (sortie « pdf ») ; ses ressources mènent au lien du client, qui les télécharge. */
  const lienPublic = p.lienActif ? `${adresseDuLien()}${cheminDuLien(p.id, p.generation)}` : null;
  const html = htmlDeLaPlaquette({ ...p, marque: marqueARendre(p.marque) }, {
    mode: 'pdf',
    sortie: 'pdf',
    langue: p.langue,
    image: imageEmbarquee,
    infoDePiece,
    telechargement: (id) => (lienPublic ? `${lienPublic}/image/${encodeURIComponent(id)}?telecharger=1` : null),
  });
  const { prendreLeNavigateur, rendreLeNavigateur } = await import('./navigateur-du-serveur.js');
  const qui = `plaquette-pdf:${id}`;
  let pris = false;
  for (let i = 0; i < 90 && !(pris = prendreLeNavigateur(qui)); i++) await new Promise((r) => setTimeout(r, 1000));
  if (!pris) return { ok: false, raison: 'Le navigateur du serveur est occupé : réessayez dans un instant.' };
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'plaquette-'));
  try {
    const { chromium } = await import('playwright');
    const navigateur = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const taille = PAGES_DE_PLAQUETTE[p.format];
      const page = await navigateur.newPage({ viewport: { width: taille.largeurPx, height: taille.hauteurPx } });
      await page.setContent(html, { waitUntil: 'load', timeout: 60_000 });
      /*
       * LES MÊMES FEUILLES QUE L'ÉDITEUR ET LA PAGE DU CLIENT : la mise en pages commune est jouée ici, puis Chrome
       * imprime une feuille par page (marges nulles). Un commentaire « page 3 » est page 3 du PDF.
       */
      const pages = await page.evaluate(
        `(${String(attendreLesImages)})(document.querySelector('.pages')).then(function(){return (${String(paginerLeDocument)})(document.querySelector('.pages'))})`,
      );
      if (!pages) return { ok: false, raison: 'La mise en pages du document a échoué.' };
      const base = `${p.titre.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'Plaquette'} — v${p.version}`;
      const fichier = path.join(dossier, `${base}.pdf`);
      await page.pdf({ path: fichier, width: `${taille.largeurMm}mm`, height: `${taille.hauteurMm}mm`, printBackground: true, preferCSSPageSize: true });
      /* LA VIGNETTE : la première feuille, photographiée telle qu'imprimée. Son échec ne coûte jamais le PDF. */
      let vignette: Attachment | undefined;
      try {
        await page.emulateMedia({ media: 'print' });
        const image = path.join(dossier, `${base} — couverture.png`);
        await page.screenshot({ path: image, clip: { x: 0, y: 0, width: taille.largeurPx, height: taille.hauteurPx } });
        const v = await joindreUnFichier({ projectId: p.projectId, cardId: p.cardId, agentId: p.agentId, fichier: image, nom: path.basename(image) });
        if (v.ok) {
          vignette = v.attachment;
          noterUneCapture({ attachmentId: v.attachment.id, projectId: p.projectId, genre: 'plaquette' });
        }
      } catch (err) {
        log.warn(`plaquette ${id} : vignette impossible (${(err as Error).message.split('\n')[0]})`);
      }
      const j = await joindreUnFichier({ projectId: p.projectId, cardId: p.cardId, agentId: p.agentId, fichier, nom: path.basename(fichier) });
      if (!j.ok) return { ok: false, raison: j.refus };
      noterUneCapture({ attachmentId: j.attachment.id, projectId: p.projectId, genre: 'plaquette' });
      const piece =
        store.ecrireLaPlaquetteDeLaPiece(j.attachment.id, {
          id: p.id,
          projectId: p.projectId,
          titre: p.titre,
          format: p.format,
          version: p.version,
          ...(vignette ? { vignette: vignette.id } : {}),
        }) ?? j.attachment;
      bus.emit({ type: 'attachments', projectId: p.projectId, items: store.listAttachments(p.projectId) });
      getDb().prepare('UPDATE plaquettes SET pdf_piece = ?, pdf_version = ?, vignette_piece = ? WHERE id = ?').run(piece.id, p.version, vignette?.id ?? null, id);
      diffuser(p.projectId, id);
      return { ok: true, piece, ...(vignette ? { vignette } : {}) };
    } finally {
      await navigateur.close().catch(() => {});
    }
  } catch (err) {
    log.warn(`plaquette ${id} : PDF impossible (${(err as Error).message})`);
    return { ok: false, raison: `Le PDF n'a pas pu être fabriqué (${(err as Error).message.split('\n')[0]}).` };
  } finally {
    rendreLeNavigateur(qui);
    fs.rmSync(dossier, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ */
/* Le lien public                                                       */
/* ------------------------------------------------------------------ */

/** Le plafond des remarques : par lien et par visiteur, sur une heure. L'adresse n'entre que dans une empreinte du jour, en mémoire. */
const selDuJour = { jour: '', sel: crypto.randomBytes(16) };
const envois = new Map<string, number[]>();

function visiteurAnonyme(ip: string): string {
  const jour = jourDOuverture(Date.now());
  if (selDuJour.jour !== jour) {
    selDuJour.jour = jour;
    selDuJour.sel = crypto.randomBytes(16);
    envois.clear();
  }
  return crypto.createHmac('sha256', selDuJour.sel).update(ip).digest('hex').slice(0, 24);
}

function remarqueAdmise(plaquetteId: string, ip: string, maintenant = Date.now()): boolean {
  const cle = `${plaquetteId}:${visiteurAnonyme(ip)}`;
  const recents = (envois.get(cle) ?? []).filter((t) => maintenant - t < 3600_000);
  if (recents.length >= REMARQUES_PAR_HEURE) return false;
  recents.push(maintenant);
  envois.set(cle, recents);
  return true;
}

/** Compte une ouverture (signal du navigateur). Rend vrai si c'était la toute première. */
export function compterUneOuverture(p: Plaquette, maintenant = Date.now()): boolean {
  const db = getDb();
  db.prepare(
    'INSERT INTO plaquette_ouvertures (plaquette_id, jour, ouvertures) VALUES (?, ?, 1) ON CONFLICT(plaquette_id, jour) DO UPDATE SET ouvertures = ouvertures + 1',
  ).run(p.id, jourDOuverture(maintenant));
  const premiere = db.prepare('UPDATE plaquettes SET premiere_ouverture_le = ? WHERE id = ? AND premiere_ouverture_le IS NULL').run(maintenant, p.id).changes === 1;
  db.prepare('UPDATE plaquettes SET derniere_ouverture_le = ? WHERE id = ?').run(maintenant, p.id);
  diffuser(p.projectId, p.id);
  if (premiere) {
    notify({
      motif: 'plaquette-ouverte',
      title: 'Document ouvert par votre client',
      body: `Votre client vient d'ouvrir « ${p.titre} » pour la première fois.`,
      reference: `plaquette:${p.id}`,
      element: p.titre,
      projectId: p.projectId,
      ...(p.cardId ? { cardId: p.cardId } : {}),
    });
  }
  return premiere;
}

function envoyer(res: http.ServerResponse, statut: number, corps: string | Buffer, type: string, extra: Record<string, string> = {}): void {
  res.writeHead(statut, {
    'content-type': type,
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex, nofollow',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    ...extra,
  });
  res.end(corps);
}

/** La page d'un lien mort : sur le même fond anthracite que le lecteur. */
const PAGE_FERMEE = (titre: string) =>
  `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${titre}</title><style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#26272b;color:#ececef}</style></head><body><p>${titre}</p></body></html>`;

/**
 * LA PORTE PUBLIQUE `/plaquette/<jeton>[/pdf|/image/<id>|/ouverte|/remarques]`. Rend `false` si la route n'est pas
 * la sienne. `auteur` : la requête porte une session Beluga (l'ouverture ne se compte pas).
 */
export async function servirLaPlaquette(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  route: string,
  opts: { auteur: boolean; compte?: { id: string; nomAffiche: string; admin?: boolean } | null; ip: string; lireCorps: (max: number) => Promise<Buffer> },
): Promise<boolean> {
  const m = /^\/plaquette\/([A-Za-z0-9_-]+)(\/pdf|\/document|\/ouverte|\/fils(?:\/([A-Za-z0-9_-]{8,64})(\/resolu|\/messages\/([A-Za-z0-9_-]{8,64}))?)?|\/image\/([A-Za-z0-9_-]+))?\/?$/.exec(route);
  if (!m) return false;
  const p = plaquetteDuJeton(m[1]!);
  if (!p) {
    envoyer(res, 404, PAGE_FERMEE('Ce lien n’existe pas.'), 'text/html; charset=utf-8');
    return true;
  }
  if (!p.lienActif) {
    envoyer(res, 410, PAGE_FERMEE('Ce lien a été fermé par son auteur.'), 'text/html; charset=utf-8');
    return true;
  }
  const base = `/plaquette/${m[1]}`;
  const suite = m[2] ?? '';
  /* Le repère du navigateur du client (tiré au hasard, gardé par lui) : il désigne SES messages. */
  const visiteur = opts.auteur ? null : empreinteDuVisiteur(req.headers['x-visiteur']);
  const compte = opts.auteur ? (opts.compte ?? null) : null;
  const qui = opts.auteur ? { equipe: true, ...(compte ? { compte: compte.id, nomAffiche: compte.nomAffiche } : {}) } : { visiteur };
  if (suite === '' && (req.method === 'GET' || req.method === 'HEAD')) {
    const html = htmlDuLecteur(
      { ...p, marque: marqueARendre(p.marque) },
      {
        langue: p.langue,
        base,
        auteur: opts.auteur,
        version: p.version,
        image: (id) => `${base}/image/${encodeURIComponent(id)}`,
        infoDePiece,
        telechargement: (id) => `${base}/image/${encodeURIComponent(id)}?telecharger=1`,
      },
    );
    envoyer(res, 200, req.method === 'HEAD' ? '' : html, 'text/html; charset=utf-8', {
      'content-security-policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
    });
    return true;
  }
  if (suite === '/document' && req.method === 'GET') {
    /* LA VERSION PUBLIÉE, RENDUE POUR LA PAGE OUVERTE : elle se remet à jour sans se recharger (jamais le brouillon). */
    const d = documentDeLaPlaquette(
      { ...p, marque: marqueARendre(p.marque) },
      {
        mode: 'document',
        sortie: 'client',
        langue: p.langue,
        image: (id) => `${base}/image/${encodeURIComponent(id)}`,
        infoDePiece,
        telechargement: (id) => `${base}/image/${encodeURIComponent(id)}?telecharger=1`,
      },
    );
    envoyer(res, 200, JSON.stringify({ version: p.version, css: d.css, corps: d.corps }), 'application/json; charset=utf-8');
    return true;
  }
  if (suite.startsWith('/image/') && req.method === 'GET') {
    const id = m[6]!;
    const telecharger = /[?&]telecharger=1\b/.test(req.url ?? '');
    /* Seules les pièces que le client VOIT : une section masquée ou retirée de sa page ne sert pas les siennes. */
    const permis = piecesDeLaPlaquette(p.blocs, p.marque, { visibles: true }).includes(id);
    const a = permis ? store.getAttachment(id) : null;
    /* Une image se montre ; une RESSOURCE d'un autre type (police, PDF, archive) ne se sert qu'en téléchargement. */
    const f = a && (a.mime?.startsWith('image/') || telecharger) ? fichierDeLaPiece(a) : null;
    if (!a || !f) {
      envoyer(res, 404, 'introuvable', 'text/plain; charset=utf-8');
      return true;
    }
    const actif = /svg|html|xml|javascript/.test(a.mime ?? '');
    /* UN LOGO SVG SE MONTRE (carte « Plaquette client : images, icône et titre ») : servi en text/plain, le <img> du
     * client restait cassé. Il part en image/svg+xml — un <img> n'exécute jamais de script, et ouvert seul, la CSP
     * `sandbox` + `default-src 'none'` l'en empêche aussi. HTML, XML et JS restent en texte brut. */
    const svg = (a.mime ?? '') === 'image/svg+xml';
    res.writeHead(200, {
      'content-type': actif && !telecharger && !svg ? 'text/plain; charset=utf-8' : (a.mime ?? 'application/octet-stream'),
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
      ...(actif ? { 'content-security-policy': svg ? "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox" : 'sandbox' } : {}),
      ...(telecharger ? { 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(a.name)}` } : {}),
    });
    fs.createReadStream(f).pipe(res);
    return true;
  }
  if (suite === '/pdf' && req.method === 'GET') {
    const fait = await fabriquerLePdf(p.id);
    const f = fait.ok ? fichierDeLaPiece(fait.piece) : null;
    if (!fait.ok || !f) {
      envoyer(res, 503, PAGE_FERMEE('Le PDF n’est pas disponible pour le moment.'), 'text/html; charset=utf-8');
      return true;
    }
    res.writeHead(200, {
      'content-type': 'application/pdf',
      'cache-control': 'no-store',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fait.piece.name)}`,
      'x-robots-tag': 'noindex',
    });
    fs.createReadStream(f).pipe(res);
    return true;
  }
  if (suite === '/ouverte' && req.method === 'POST') {
    if (!opts.auteur) compterUneOuverture(p);
    res.writeHead(204, { 'cache-control': 'no-store' });
    res.end();
    return true;
  }
  if (suite === '/fils' && req.method === 'GET') {
    /* Le client ne voit ni l'état « lu » ni rien d'interne ; un fil résolu reste (la page le cache, sauf s'il est ouvert). */
    envoyer(res, 200, JSON.stringify({ fils: filsDe(p.id).map((f) => filPourLeClient(f, qui)), version: p.version }), 'application/json; charset=utf-8');
    return true;
  }
  if (m[5] && req.method === 'DELETE') {
    /* SUPPRIMER SON MESSAGE : l'équipe les siens, le client ceux de son navigateur. */
    const r = supprimerUnMessage(p, m[3]!, m[5], opts.auteur ? { role: 'equipe', compte } : { role: 'client', visiteur });
    envoyer(res, r.ok ? 200 : r.raison === 'interdit' ? 403 : 404, JSON.stringify(r.ok ? { ok: true, fil: filPourLeClient(r.fil, qui) } : r), 'application/json');
    return true;
  }
  if (suite.startsWith('/fils') && req.method === 'POST') {
    let corps: Buffer;
    try {
      corps = await opts.lireCorps(8 * 1024);
    } catch {
      envoyer(res, 413, '{"ok":false}', 'application/json');
      return true;
    }
    let brut: unknown;
    try {
      brut = JSON.parse(corps.toString('utf8') || '{}');
    } catch {
      envoyer(res, 400, '{"ok":false}', 'application/json');
      return true;
    }
    /* L'auteur du document (session Beluga) écrit au nom de l'équipe ; le client, au sien. */
    const auteurDuMessage: AuteurDUnMessage = opts.auteur ? { role: 'equipe', compte } : { role: 'client', visiteur };
    const filId = m[3];
    if (m[5]) {
      envoyer(res, 405, '{"ok":false}', 'application/json');
      return true;
    }
    if (filId && m[4]) {
      const r = resoudreLeFil(p, filId, (brut as { resolu?: unknown })?.resolu !== false);
      envoyer(res, r.ok ? 200 : 404, JSON.stringify(r.ok ? { ok: true, fil: filPourLeClient(r.fil, qui) } : r), 'application/json');
      return true;
    }
    if (!opts.auteur && !remarqueAdmise(p.id, opts.ip)) {
      envoyer(res, 429, '{"ok":false,"raison":"trop"}', 'application/json');
      return true;
    }
    const r = filId ? repondreAuFil(p, filId, brut, auteurDuMessage) : creerUnFil(p, brut, auteurDuMessage);
    envoyer(res, r.ok ? 201 : r.raison === 'introuvable' ? 404 : 400, JSON.stringify(r.ok ? { ok: true, fil: filPourLeClient(r.fil, qui) } : r), 'application/json');
    return true;
  }
  envoyer(res, 405, 'méthode refusée', 'text/plain; charset=utf-8');
  return true;
}
