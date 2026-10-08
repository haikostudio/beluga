import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  type Composition,
  type Creation,
  type DepenseStudio,
  type EspaceStudio,
  type EtatDepense,
  type ExportStudio,
  type FormatStudio,
  type GenreDepense,
  type KitDeMarque,
  type MediaStudio,
  type OperationStudio,
  type ReglagesExport,
  type VersionStudio,
  LABEL_STUDIO,
  lireReglagesExport,
  appliquerOperation,
  compositionVide,
  couleurValide,
  estFormatStudio,
  idValide,
  nettoyerDessin,
  tousLesSegments,
  validerComposition,
  POLICES_STUDIO,
} from '@beluga/shared';
import { getDb, getMeta, setMeta } from './db.js';
import { bus } from './bus.js';
import * as store from './store.js';
import { cheminDePieceJointe } from './pieces-jointes.js';
import { log } from './logger.js';

/**
 * LE STUDIO — la base, les versions, la bibliothèque, les dépenses.
 *
 * Les règles vivent dans `shared/src/studio.ts`. Ici : les tables, la version
 * COURANTE de chaque création (une opération → une version, jamais effacée),
 * annuler / rétablir par le lien `parent`, la bibliothèque du projet (fichiers
 * rangés dans les PIÈCES JOINTES, jamais dans un second stockage) et la garde
 * de dépense. La fabrication (voix, rendu) vit dans `studio-generation.ts` et
 * `studio-rendu.ts`, l'agent dans `assistant-studio.ts`.
 */

function json<T>(texte: string | null | undefined, repli: T): T {
  if (!texte) return repli;
  try {
    return JSON.parse(texte) as T;
  } catch {
    return repli;
  }
}

export function nouvelId(prefixe: string): string {
  return `${prefixe}${crypto.randomBytes(5).toString('hex')}`;
}

/** UN CHANGEMENT : l'écran ouvert sur ce projet (ou cette création) se relit. */
export function diffuserStudio(projectId: string, creationId?: string, progression?: { exportId: string; valeur: number; etape: string }): void {
  bus.emit({ type: 'studio', projectId, ...(creationId ? { creationId } : {}), ...(progression ? { progression } : {}) });
}

/* ------------------------------------------------------------------ */
/* Espaces                                                             */
/* ------------------------------------------------------------------ */

interface LigneEspace {
  project_id: string;
  kit: string;
  voix_finale: string | null;
  voix_essai: string | null;
  gemini_facture: number;
  cree_le: number;
  maj_le: number;
}

function depuisLigneEspace(l: LigneEspace): EspaceStudio {
  return {
    projectId: l.project_id,
    kit: json<KitDeMarque>(l.kit, {}),
    ...(l.voix_finale ? { voixFinale: l.voix_finale } : {}),
    ...(l.voix_essai ? { voixEssai: l.voix_essai } : {}),
    creeLe: l.cree_le,
    majLe: l.maj_le,
  };
}

export function assurerEspaceStudio(projectId: string, maintenant = Date.now()): EspaceStudio {
  getDb()
    .prepare('INSERT OR IGNORE INTO studio_espaces (project_id, kit, cree_le, maj_le) VALUES (?, ?, ?, ?)')
    .run(projectId, '{}', maintenant, maintenant);
  return depuisLigneEspace(getDb().prepare('SELECT * FROM studio_espaces WHERE project_id = ?').get(projectId) as LigneEspace);
}

/** Le kit de marque se lit en TOLÉRANT : une couleur illisible est écartée, jamais une erreur. */
function lireKit(brut: any): KitDeMarque {
  const kit: KitDeMarque = {};
  if (!brut || typeof brut !== 'object') return kit;
  for (const cle of ['primaire', 'secondaire', 'accent', 'fond', 'texte'] as const) {
    if (typeof brut[cle] === 'string' && brut[cle].trim()) kit[cle] = couleurValide(brut[cle], '#ffffff');
  }
  for (const cle of ['policeTitre', 'policeTexte'] as const) {
    const p = POLICES_STUDIO.find((x) => x.famille === brut[cle]);
    if (p) kit[cle] = p.famille;
  }
  if (idValide(brut.logoMediaId)) kit.logoMediaId = brut.logoMediaId;
  if (typeof brut.ton === 'string') kit.ton = brut.ton.slice(0, 500);
  return kit;
}

export function ecrireEspaceStudio(
  projectId: string,
  recu: { kit?: unknown; voixFinale?: unknown; voixEssai?: unknown },
  maintenant = Date.now(),
): EspaceStudio {
  const avant = assurerEspaceStudio(projectId);
  const kit = recu.kit !== undefined ? { ...avant.kit, ...lireKit(recu.kit) } : avant.kit;
  const voixFinale = typeof recu.voixFinale === 'string' ? recu.voixFinale.slice(0, 40) : avant.voixFinale;
  const voixEssai = typeof recu.voixEssai === 'string' ? recu.voixEssai.slice(0, 80) : avant.voixEssai;
  // La colonne `gemini_facture` reste en base, plus lue ni écrite : la voix finale passe toute par OpenRouter.
  getDb()
    .prepare('UPDATE studio_espaces SET kit = ?, voix_finale = ?, voix_essai = ?, maj_le = ? WHERE project_id = ?')
    .run(JSON.stringify(kit), voixFinale ?? null, voixEssai ?? null, maintenant, projectId);
  diffuserStudio(projectId);
  return assurerEspaceStudio(projectId);
}

/* ------------------------------------------------------------------ */
/* Créations                                                           */
/* ------------------------------------------------------------------ */

interface LigneCreation {
  id: string;
  project_id: string;
  titre: string;
  formats: string;
  contenu_marketing_id: string | null;
  etat: string;
  version: number;
  agent_id: string | null;
  card_id: string | null;
  affiche_id: string | null;
  selection: string | null;
  cree_le: number;
  maj_le: number;
}

function depuisLigneCreation(l: LigneCreation): Creation {
  const formats = json<string[]>(l.formats, ['9:16']).filter(estFormatStudio) as FormatStudio[];
  return {
    id: l.id,
    projectId: l.project_id,
    titre: l.titre,
    formats: formats.length ? formats : ['9:16'],
    ...(l.contenu_marketing_id ? { contenuMarketingId: l.contenu_marketing_id } : {}),
    etat: l.etat === 'exportee' ? 'exportee' : 'brouillon',
    version: l.version,
    ...(l.agent_id ? { agentId: l.agent_id } : {}),
    ...(l.card_id ? { cardId: l.card_id } : {}),
    ...(l.affiche_id ? { afficheId: l.affiche_id } : {}),
    creeLe: l.cree_le,
    majLe: l.maj_le,
  };
}

export function lireCreation(id: string): Creation | null {
  const l = getDb().prepare('SELECT * FROM studio_creations WHERE id = ?').get(id) as LigneCreation | undefined;
  return l ? depuisLigneCreation(l) : null;
}

export function listerCreations(projectId?: string): Creation[] {
  const lignes = projectId
    ? (getDb().prepare('SELECT * FROM studio_creations WHERE project_id = ? ORDER BY maj_le DESC').all(projectId) as LigneCreation[])
    : (getDb().prepare('SELECT * FROM studio_creations ORDER BY maj_le DESC').all() as LigneCreation[]);
  return lignes.map(depuisLigneCreation);
}

export function creationsDuContenu(contenuMarketingId: string): Creation[] {
  return (getDb().prepare('SELECT * FROM studio_creations WHERE contenu_marketing_id = ? ORDER BY maj_le DESC').all(contenuMarketingId) as LigneCreation[]).map(
    depuisLigneCreation,
  );
}

export type Resultat<T> = ({ ok: true } & T) | { ok: false; raison: string };

export function creerCreation(entree: {
  projectId: string;
  titre?: string;
  formats?: unknown;
  contenuMarketingId?: string;
  composition?: Composition;
  maintenant?: number;
}): Resultat<{ creation: Creation }> {
  const projet = store.getProject(entree.projectId);
  if (!projet) return { ok: false, raison: 'projet introuvable' };
  const maintenant = entree.maintenant ?? Date.now();
  const formats = (Array.isArray(entree.formats) ? entree.formats.filter(estFormatStudio) : []) as FormatStudio[];
  const retenus: FormatStudio[] = formats.length ? [...new Set(formats)] : ['9:16'];
  const composition = entree.composition ?? compositionVide(retenus[0]);
  const id = nouvelId('cre');
  const titre = (entree.titre ?? '').trim().slice(0, 120) || 'Nouvelle création';
  assurerEspaceStudio(projet.id);
  getDb()
    .prepare(
      'INSERT INTO studio_creations (id, project_id, titre, formats, contenu_marketing_id, etat, version, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
    )
    .run(id, projet.id, titre, JSON.stringify(retenus), entree.contenuMarketingId ?? null, 'brouillon', maintenant, maintenant);
  getDb()
    .prepare('INSERT INTO studio_versions (creation_id, numero, parent, composition, raison, auteur, cree_le) VALUES (?, 1, NULL, ?, ?, ?, ?)')
    .run(id, JSON.stringify(composition), 'création', 'humain', maintenant);
  diffuserStudio(projet.id, id);
  return { ok: true, creation: lireCreation(id)! };
}

export function modifierCreation(id: string, recu: { titre?: unknown; formats?: unknown }): Resultat<{ creation: Creation }> {
  const creation = lireCreation(id);
  if (!creation) return { ok: false, raison: 'création introuvable' };
  const titre = typeof recu.titre === 'string' && recu.titre.trim() ? recu.titre.trim().slice(0, 120) : creation.titre;
  const formats = Array.isArray(recu.formats) ? (recu.formats.filter(estFormatStudio) as FormatStudio[]) : creation.formats;
  if (!formats.length) return { ok: false, raison: 'il faut au moins un format' };
  getDb().prepare('UPDATE studio_creations SET titre = ?, formats = ?, maj_le = ? WHERE id = ?').run(titre, JSON.stringify([...new Set(formats)]), Date.now(), id);
  diffuserStudio(creation.projectId, id);
  return { ok: true, creation: lireCreation(id)! };
}

export function marquerAgentStudio(creationId: string, agentId: string, cardId: string): void {
  getDb().prepare('UPDATE studio_creations SET agent_id = ?, card_id = ? WHERE id = ?').run(agentId, cardId, creationId);
  const c = lireCreation(creationId);
  if (c) diffuserStudio(c.projectId, creationId);
}

/** La création dont cet agent est l'agent attitré. */
export function creationDeLAgent(agentId: string): Creation | null {
  const l = getDb().prepare('SELECT * FROM studio_creations WHERE agent_id = ?').get(agentId) as LigneCreation | undefined;
  return l ? depuisLigneCreation(l) : null;
}

/**
 * L'AGENT PORTE-T-IL UNE CARTE DU STUDIO ? C'est ce qui lui ouvre l'outil
 * « studio ». Aucun autre agent ne le voit — ni ne repaie sa description.
 */
export function estAgentStudio(agentId: string): boolean {
  const agent = store.getAgent(agentId);
  if (!agent?.cardId) return false;
  if (agent.role === 'cadrage' || (agent as { workdir?: string }).workdir) return false;
  return !!store.getCard(agent.cardId)?.labels.includes(LABEL_STUDIO) && !!creationDeLAgent(agentId);
}

/** La SÉLECTION de l'écran : ce que l'agent reçoit avec chaque demande. */
export interface SelectionStudio {
  segmentIds: string[];
  elementId?: string;
  curseur: number;
  format?: FormatStudio;
}

export function ecrireSelection(creationId: string, recu: any): void {
  const selection: SelectionStudio = {
    segmentIds: Array.isArray(recu?.segmentIds) ? recu.segmentIds.filter(idValide).slice(0, 50) : [],
    ...(idValide(recu?.elementId) ? { elementId: recu.elementId } : {}),
    curseur: Math.max(0, Number(recu?.curseur) || 0),
    ...(estFormatStudio(recu?.format) ? { format: recu.format } : {}),
  };
  getDb().prepare('UPDATE studio_creations SET selection = ? WHERE id = ?').run(JSON.stringify(selection), creationId);
}

export function lireSelection(creationId: string): SelectionStudio {
  const l = getDb().prepare('SELECT selection FROM studio_creations WHERE id = ?').get(creationId) as { selection: string | null } | undefined;
  return json<SelectionStudio>(l?.selection, { segmentIds: [], curseur: 0 });
}

/* ------------------------------------------------------------------ */
/* Versions : une opération → une version                              */
/* ------------------------------------------------------------------ */

interface LigneVersion {
  creation_id: string;
  numero: number;
  parent: number | null;
  composition: string;
  raison: string;
  auteur: string;
  cree_le: number;
}

function depuisLigneVersion(l: LigneVersion): VersionStudio & { parent: number | null } {
  return {
    creationId: l.creation_id,
    numero: l.numero,
    parent: l.parent,
    composition: json<Composition>(l.composition, compositionVide()),
    raison: l.raison,
    auteur: (l.auteur as VersionStudio['auteur']) ?? 'humain',
    creeLe: l.cree_le,
  };
}

export function lireVersion(creationId: string, numero: number) {
  const l = getDb().prepare('SELECT * FROM studio_versions WHERE creation_id = ? AND numero = ?').get(creationId, numero) as LigneVersion | undefined;
  return l ? depuisLigneVersion(l) : null;
}

export function compositionCourante(creationId: string): Composition | null {
  const c = lireCreation(creationId);
  if (!c) return null;
  return lireVersion(creationId, c.version)?.composition ?? null;
}

/** L'historique, sans les compositions (elles se lisent une à une). */
export function historique(creationId: string): { numero: number; parent: number | null; raison: string; auteur: string; creeLe: number }[] {
  return (
    getDb()
      .prepare('SELECT numero, parent, raison, auteur, cree_le FROM studio_versions WHERE creation_id = ? ORDER BY numero DESC LIMIT 200')
      .all(creationId) as { numero: number; parent: number | null; raison: string; auteur: string; cree_le: number }[]
  ).map((l) => ({ numero: l.numero, parent: l.parent, raison: l.raison, auteur: l.auteur, creeLe: l.cree_le }));
}

/** Pose une composition comme NOUVELLE version courante (rien n'est écrasé). */
export function enregistrerVersion(creationId: string, composition: Composition, raison: string, auteur: VersionStudio['auteur']): Resultat<{ numero: number }> {
  const creation = lireCreation(creationId);
  if (!creation) return { ok: false, raison: 'création introuvable' };
  const valide = validerComposition(composition);
  if (!valide.ok) return { ok: false, raison: valide.raison };
  const maintenant = Date.now();
  const numero = enTransaction(() => {
    const max = (getDb().prepare('SELECT MAX(numero) AS n FROM studio_versions WHERE creation_id = ?').get(creationId) as { n: number | null }).n ?? 0;
    const suivant = max + 1;
    getDb()
      .prepare('INSERT INTO studio_versions (creation_id, numero, parent, composition, raison, auteur, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(creationId, suivant, creation.version, JSON.stringify(valide.composition), raison.slice(0, 200), auteur, maintenant);
    getDb().prepare('UPDATE studio_creations SET version = ?, maj_le = ? WHERE id = ?').run(suivant, maintenant, creationId);
    return suivant;
  });
  diffuserStudio(creation.projectId, creationId);
  return { ok: true, numero };
}

function enTransaction<T>(f: () => T): T {
  return getDb().transaction(f)();
}

/** Les erreurs de syntaxe d'un code d'animation, sans l'exécuter. */
export function erreurDeSyntaxeAnimation(code: string): string | null {
  if (!code.trim()) return null;
  try {
    new vm.Script(`(function(tl,el,p,studio){\n${code}\n})`);
    return null;
  } catch (err: any) {
    return `animation : erreur de syntaxe — ${String(err?.message ?? err)}`;
  }
}

/**
 * LE PREMIER VERROU, SUR TOUS LES CHEMINS. Chaque dessin dont le gabarit a
 * changé (ou qui est nouveau) passe par `nettoyerDessin` et par un contrôle de
 * syntaxe : écran, agent ou version restaurée, aucun ne pose un dessin brut.
 * Le gabarit gardé est la version NETTOYÉE.
 */
export function nettoyerLesDessins(avant: Composition | null, apres: Composition): Resultat<{ composition: Composition; avertissements: string[] }> {
  const anciens = new Map<string, string>();
  if (avant) for (const s of tousLesSegments(avant)) if (s.genre === 'dessin') anciens.set(s.id, JSON.stringify(s.gabarit));
  const copie: Composition = JSON.parse(JSON.stringify(apres));
  const erreurs: string[] = [];
  const avertissements: string[] = [];
  for (const s of tousLesSegments(copie)) {
    if (s.genre !== 'dessin') continue;
    if (anciens.get(s.id) === JSON.stringify(s.gabarit)) continue;
    const n = nettoyerDessin(s.gabarit);
    if (!n.ok) {
      erreurs.push(...n.erreurs.map((e) => `[${s.id}] ${e}`));
      continue;
    }
    const syntaxe = erreurDeSyntaxeAnimation(n.dessin.animation);
    if (syntaxe) {
      erreurs.push(`[${s.id}] ${syntaxe}`);
      continue;
    }
    avertissements.push(...n.avertissements.map((a) => `[${s.id}] ${a}`));
    s.gabarit = { html: n.dessin.html, css: n.dessin.css, animation: n.dessin.animation };
    s.elements = n.dessin.elements;
  }
  if (erreurs.length) return { ok: false, raison: erreurs.slice(0, 20).join('\n') };
  return { ok: true, composition: copie, avertissements };
}

/** UNE OPÉRATION (écran ou agent) → une version. */
export function appliquerOperationStudio(
  creationId: string,
  op: OperationStudio,
  auteur: VersionStudio['auteur'],
): Resultat<{ numero: number; composition: Composition; resume: string; avertissements: string[] }> {
  const courante = compositionCourante(creationId);
  if (!courante) return { ok: false, raison: 'création introuvable' };
  const r = appliquerOperation(courante, op, nouvelId);
  if (!r.ok) return r;
  const propre = nettoyerLesDessins(courante, r.composition);
  if (!propre.ok) return propre;
  const v = enregistrerVersion(creationId, propre.composition, r.resume, auteur);
  if (!v.ok) return v;
  return { ok: true, numero: v.numero, composition: propre.composition, resume: r.resume, avertissements: propre.avertissements };
}

/** Revenir à la version d'où vient la courante. */
export function annuler(creationId: string): Resultat<{ numero: number }> {
  const creation = lireCreation(creationId);
  if (!creation) return { ok: false, raison: 'création introuvable' };
  const courante = lireVersion(creationId, creation.version);
  if (!courante?.parent) return { ok: false, raison: 'rien à annuler' };
  return pointerVers(creation, courante.parent);
}

/** Repartir vers la plus récente des versions nées de la courante. */
export function retablir(creationId: string): Resultat<{ numero: number }> {
  const creation = lireCreation(creationId);
  if (!creation) return { ok: false, raison: 'création introuvable' };
  const l = getDb()
    .prepare('SELECT numero FROM studio_versions WHERE creation_id = ? AND parent = ? ORDER BY numero DESC LIMIT 1')
    .get(creationId, creation.version) as { numero: number } | undefined;
  if (!l) return { ok: false, raison: 'rien à rétablir' };
  return pointerVers(creation, l.numero);
}

/** Restaurer une version ancienne : elle devient une NOUVELLE version, l'histoire reste entière. */
export function restaurer(creationId: string, numero: number): Resultat<{ numero: number }> {
  const v = lireVersion(creationId, numero);
  if (!v) return { ok: false, raison: 'version introuvable' };
  return enregistrerVersion(creationId, v.composition, `version ${numero} restaurée`, 'humain');
}

function pointerVers(creation: Creation, numero: number): Resultat<{ numero: number }> {
  getDb().prepare('UPDATE studio_creations SET version = ?, maj_le = ? WHERE id = ?').run(numero, Date.now(), creation.id);
  diffuserStudio(creation.projectId, creation.id);
  return { ok: true, numero };
}

export function etatAnnulerRetablir(creationId: string): { annuler: boolean; retablir: boolean } {
  const creation = lireCreation(creationId);
  if (!creation) return { annuler: false, retablir: false };
  const courante = lireVersion(creationId, creation.version);
  const enfant = getDb().prepare('SELECT 1 FROM studio_versions WHERE creation_id = ? AND parent = ? LIMIT 1').get(creationId, creation.version);
  return { annuler: !!courante?.parent, retablir: !!enfant };
}

/* ------------------------------------------------------------------ */
/* Bibliothèque                                                         */
/* ------------------------------------------------------------------ */

interface LigneMedia {
  id: string;
  project_id: string;
  creation_id: string | null;
  genre: string;
  provenance: string;
  nom: string;
  attachment_id: string | null;
  mime: string | null;
  duree: number | null;
  largeur: number | null;
  hauteur: number | null;
  dessin: string | null;
  categorie: string | null;
  usage: string | null;
  licence: string | null;
  cout: number | null;
  cree_le: number;
}

function depuisLigneMedia(l: LigneMedia): MediaStudio {
  return {
    id: l.id,
    projectId: l.project_id,
    ...(l.creation_id ? { creationId: l.creation_id } : {}),
    genre: l.genre as MediaStudio['genre'],
    provenance: l.provenance as MediaStudio['provenance'],
    nom: l.nom,
    ...(l.attachment_id ? { attachmentId: l.attachment_id } : {}),
    ...(l.mime ? { mime: l.mime } : {}),
    ...(l.duree !== null ? { duree: l.duree } : {}),
    ...(l.largeur !== null ? { largeur: l.largeur } : {}),
    ...(l.hauteur !== null ? { hauteur: l.hauteur } : {}),
    ...(l.dessin ? { dessin: json(l.dessin, undefined as any) } : {}),
    ...(l.categorie ? { categorie: l.categorie } : {}),
    ...(l.usage ? { usage: l.usage } : {}),
    ...(l.licence ? { licence: l.licence } : {}),
    ...(l.cout !== null ? { cout: l.cout } : {}),
    creeLe: l.cree_le,
  };
}

export function lireMedia(id: string): MediaStudio | null {
  const l = getDb().prepare('SELECT * FROM studio_medias WHERE id = ?').get(id) as LigneMedia | undefined;
  return l ? depuisLigneMedia(l) : null;
}

/** La bibliothèque du projet, plus récente d'abord. Les sons d'une AUTRE création restent dans la sienne. */
export function listerMedias(projectId: string, creationId?: string): MediaStudio[] {
  const lignes = getDb().prepare('SELECT * FROM studio_medias WHERE project_id = ? ORDER BY cree_le DESC LIMIT 500').all(projectId) as LigneMedia[];
  return lignes
    .map(depuisLigneMedia)
    .filter((m) => !(m.provenance === 'voix-essai' || m.provenance === 'voix-finale' || m.provenance === 'apercu') || !creationId || m.creationId === creationId);
}

export function ajouterMedia(m: Omit<MediaStudio, 'id' | 'creeLe'> & { id?: string }): MediaStudio {
  const id = m.id ?? nouvelId('med');
  getDb()
    .prepare(
      `INSERT INTO studio_medias (id, project_id, creation_id, genre, provenance, nom, attachment_id, mime, duree, largeur, hauteur, dessin, categorie, usage, licence, cout, cree_le)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      m.projectId,
      m.creationId ?? null,
      m.genre,
      m.provenance,
      m.nom.slice(0, 160),
      m.attachmentId ?? null,
      m.mime ?? null,
      m.duree ?? null,
      m.largeur ?? null,
      m.hauteur ?? null,
      m.dessin ? JSON.stringify(m.dessin) : null,
      m.categorie ?? null,
      m.usage ?? null,
      m.licence ?? null,
      m.cout ?? null,
      Date.now(),
    );
  diffuserStudio(m.projectId, m.creationId);
  return lireMedia(id)!;
}

export function modifierMedia(id: string, recu: { nom?: unknown; categorie?: unknown; usage?: unknown; licence?: unknown }): MediaStudio | null {
  const m = lireMedia(id);
  if (!m) return null;
  const champ = (v: unknown, avant?: string) => (typeof v === 'string' ? v.slice(0, 300) : avant ?? null);
  getDb()
    .prepare('UPDATE studio_medias SET nom = ?, categorie = ?, usage = ?, licence = ? WHERE id = ?')
    .run(typeof recu.nom === 'string' && recu.nom.trim() ? recu.nom.trim().slice(0, 160) : m.nom, champ(recu.categorie, m.categorie), champ(recu.usage, m.usage), champ(recu.licence, m.licence), id);
  diffuserStudio(m.projectId, m.creationId);
  return lireMedia(id);
}

/** Le genre d'un fichier importé, d'après son type. */
export function genreDuMime(mime: string): MediaStudio['genre'] | null {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return null;
}

/** Une pièce jointe du projet entre dans la bibliothèque (import d'une photo, d'une vidéo, d'un son). */
export function importerPieceJointe(projectId: string, attachmentId: string, extra: { licence?: string; creationId?: string } = {}): Resultat<{ media: MediaStudio }> {
  const piece = store.getAttachment(attachmentId);
  if (!piece || piece.projectId !== projectId) return { ok: false, raison: 'fichier introuvable dans ce projet' };
  const genre = genreDuMime(piece.mime);
  if (!genre) return { ok: false, raison: 'seules les images, vidéos et sons entrent dans la bibliothèque' };
  const deja = getDb().prepare("SELECT id FROM studio_medias WHERE project_id = ? AND attachment_id = ? AND provenance = 'import'").get(projectId, attachmentId) as
    | { id: string }
    | undefined;
  if (deja) return { ok: true, media: lireMedia(deja.id)! };
  return {
    ok: true,
    media: ajouterMedia({
      projectId,
      ...(extra.creationId ? { creationId: extra.creationId } : {}),
      genre,
      provenance: 'import',
      nom: piece.name,
      attachmentId: piece.id,
      mime: piece.mime,
      ...(extra.licence ? { licence: extra.licence } : {}),
    }),
  };
}

/** Le fichier d'un média, sur le disque. */
export function fichierDuMedia(m: MediaStudio): string | null {
  if (!m.attachmentId) return null;
  const piece = store.getAttachment(m.attachmentId);
  if (!piece) return null;
  const chemin = cheminDePieceJointe(piece);
  return fs.existsSync(chemin) ? chemin : null;
}

/** Retire un média de la bibliothèque — et son fichier, s'il n'appartient à rien d'autre. */
export function supprimerMedia(id: string): Resultat<{}> {
  const m = lireMedia(id);
  if (!m) return { ok: false, raison: 'média introuvable' };
  getDb().prepare('DELETE FROM studio_medias WHERE id = ?').run(id);
  if (m.attachmentId && m.provenance !== 'import') retirerPieceJointe(m.attachmentId);
  diffuserStudio(m.projectId, m.creationId);
  return { ok: true };
}

function retirerPieceJointe(attachmentId: string): void {
  const piece = store.getAttachment(attachmentId);
  if (!piece) return;
  // Une pièce encore citée par un autre média ou un export reste en place.
  const encore =
    getDb().prepare('SELECT 1 FROM studio_medias WHERE attachment_id = ? LIMIT 1').get(attachmentId) ||
    getDb().prepare('SELECT 1 FROM studio_exports WHERE attachment_id = ? OR affiche_id = ? LIMIT 1').get(attachmentId, attachmentId);
  if (encore) return;
  try {
    fs.rmSync(cheminDePieceJointe(piece), { force: true });
  } catch {
    /* fichier déjà absent */
  }
  store.supprimerPieceJointe(attachmentId);
  bus.emit({ type: 'attachments', projectId: piece.projectId, items: store.listAttachments(piece.projectId) });
}

/* ------------------------------------------------------------------ */
/* Exports                                                              */
/* ------------------------------------------------------------------ */

interface LigneExport {
  id: string;
  creation_id: string;
  project_id: string;
  format: string;
  genre: string;
  etat: string;
  progression: number;
  version: number;
  attachment_id: string | null;
  affiche_id: string | null;
  duree: number | null;
  erreur: string | null;
  voix_en_essai: number;
  reglages?: string | null;
  cree_le: number;
  maj_le: number;
}

function lireReglagesEnregistres(l: LigneExport): ExportStudio['reglages'] {
  if (!l.reglages) return undefined;
  try {
    return lireReglagesExport(JSON.parse(l.reglages), (estFormatStudio(l.format) ? l.format : '9:16') as FormatStudio);
  } catch {
    return undefined;
  }
}

function depuisLigneExport(l: LigneExport): ExportStudio {
  return {
    id: l.id,
    creationId: l.creation_id,
    projectId: l.project_id,
    format: (estFormatStudio(l.format) ? l.format : '9:16') as FormatStudio,
    genre: l.genre === 'image' ? 'image' : 'video',
    etat: l.etat as ExportStudio['etat'],
    progression: l.progression,
    version: l.version,
    ...(l.attachment_id ? { attachmentId: l.attachment_id } : {}),
    ...(l.affiche_id ? { afficheId: l.affiche_id } : {}),
    ...(l.duree !== null ? { duree: l.duree } : {}),
    ...(l.erreur ? { erreur: l.erreur } : {}),
    voixEnEssai: l.voix_en_essai,
    ...(lireReglagesEnregistres(l) ? { reglages: lireReglagesEnregistres(l) } : {}),
    creeLe: l.cree_le,
    majLe: l.maj_le,
  };
}

export function lireExport(id: string): ExportStudio | null {
  const l = getDb().prepare('SELECT * FROM studio_exports WHERE id = ?').get(id) as LigneExport | undefined;
  return l ? depuisLigneExport(l) : null;
}

export function listerExports(creationId: string): ExportStudio[] {
  return (getDb().prepare('SELECT * FROM studio_exports WHERE creation_id = ? ORDER BY cree_le DESC LIMIT 100').all(creationId) as LigneExport[]).map(depuisLigneExport);
}

export function exportsEnAttente(): ExportStudio[] {
  return (getDb().prepare("SELECT * FROM studio_exports WHERE etat IN ('en-file', 'en-cours') ORDER BY cree_le ASC").all() as LigneExport[]).map(depuisLigneExport);
}

export function creerExport(e: { creation: Creation; format: FormatStudio; genre: 'video' | 'image'; voixEnEssai: number; reglages?: ReglagesExport }): ExportStudio {
  const id = nouvelId('exp');
  const maintenant = Date.now();
  getDb()
    .prepare(
      'INSERT INTO studio_exports (id, creation_id, project_id, format, genre, etat, progression, version, voix_en_essai, reglages, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)',
    )
    .run(
      id,
      e.creation.id,
      e.creation.projectId,
      e.format,
      e.genre,
      'en-file',
      e.creation.version,
      e.voixEnEssai,
      e.reglages ? JSON.stringify(e.reglages) : null,
      maintenant,
      maintenant,
    );
  diffuserStudio(e.creation.projectId, e.creation.id);
  return lireExport(id)!;
}

export function majExport(id: string, champs: Partial<Pick<ExportStudio, 'etat' | 'progression' | 'attachmentId' | 'afficheId' | 'duree' | 'erreur'>>): ExportStudio | null {
  const e = lireExport(id);
  if (!e) return null;
  const suivant = { ...e, ...champs };
  getDb()
    .prepare('UPDATE studio_exports SET etat = ?, progression = ?, attachment_id = ?, affiche_id = ?, duree = ?, erreur = ?, maj_le = ? WHERE id = ?')
    .run(
      suivant.etat,
      suivant.progression,
      suivant.attachmentId ?? null,
      suivant.afficheId ?? null,
      suivant.duree ?? null,
      suivant.erreur ?? null,
      Date.now(),
      id,
    );
  if (champs.etat === 'pret') {
    getDb()
      .prepare("UPDATE studio_creations SET etat = 'exportee', affiche_id = COALESCE(?, affiche_id), maj_le = ? WHERE id = ?")
      .run(suivant.afficheId ?? null, Date.now(), e.creationId);
  }
  diffuserStudio(e.projectId, e.creationId);
  return lireExport(id);
}

/** Les médias exportés d'un contenu Marketing : les exports prêts des créations qui en viennent. */
export function mediasDuContenuMarketing(contenuId: string): (ExportStudio & { titre: string })[] {
  const sortie: (ExportStudio & { titre: string })[] = [];
  for (const c of creationsDuContenu(contenuId)) {
    for (const e of listerExports(c.id)) if (e.etat === 'pret') sortie.push({ ...e, titre: c.titre });
  }
  return sortie.sort((a, b) => b.creeLe - a.creeLe);
}

/* ------------------------------------------------------------------ */
/* Dépenses : devis, clic, montant réel                                 */
/* ------------------------------------------------------------------ */

interface LigneDepense {
  id: string;
  project_id: string;
  creation_id: string;
  genre: string;
  modele: string;
  plafond: number | null;
  raison: string;
  etat: string;
  montant_reel: number | null;
  details: string;
  erreur: string | null;
  demandee_par: string;
  cree_le: number;
  maj_le: number;
}

function depuisLigneDepense(l: LigneDepense): DepenseStudio {
  return {
    id: l.id,
    projectId: l.project_id,
    creationId: l.creation_id,
    genre: l.genre as GenreDepense,
    modele: l.modele,
    plafond: l.plafond,
    raison: l.raison,
    etat: l.etat as EtatDepense,
    ...(l.montant_reel !== null ? { montantReel: l.montant_reel } : {}),
    details: json(l.details, {}),
    ...(l.erreur ? { erreur: l.erreur } : {}),
    demandeePar: l.demandee_par === 'agent' ? 'agent' : 'humain',
    creeLe: l.cree_le,
    majLe: l.maj_le,
  };
}

export function lireDepense(id: string): DepenseStudio | null {
  const l = getDb().prepare('SELECT * FROM studio_depenses WHERE id = ?').get(id) as LigneDepense | undefined;
  return l ? depuisLigneDepense(l) : null;
}

export function listerDepenses(creationId: string): DepenseStudio[] {
  return (getDb().prepare('SELECT * FROM studio_depenses WHERE creation_id = ? ORDER BY cree_le DESC LIMIT 100').all(creationId) as LigneDepense[]).map(depuisLigneDepense);
}

export function creerDepense(d: Omit<DepenseStudio, 'id' | 'creeLe' | 'majLe' | 'etat'> & { etat?: EtatDepense }): DepenseStudio {
  const id = nouvelId('dep');
  const maintenant = Date.now();
  getDb()
    .prepare(
      'INSERT INTO studio_depenses (id, project_id, creation_id, genre, modele, plafond, raison, etat, details, demandee_par, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(id, d.projectId, d.creationId, d.genre, d.modele, d.plafond, d.raison.slice(0, 500), d.etat ?? 'en-attente', JSON.stringify(d.details ?? {}), d.demandeePar, maintenant, maintenant);
  diffuserStudio(d.projectId, d.creationId);
  return lireDepense(id)!;
}

/**
 * LE CLIC DE L'UTILISATEUR. Seul un geste humain fait passer une dépense de
 * « en attente » à « validée » ou « refusée » : l'agent n'a aucune porte vers ici.
 */
export function deciderDepense(id: string, decision: 'validee' | 'refusee'): Resultat<{ depense: DepenseStudio }> {
  const d = lireDepense(id);
  if (!d) return { ok: false, raison: 'dépense introuvable' };
  if (d.etat !== 'en-attente') return { ok: false, raison: 'cette dépense a déjà été décidée' };
  getDb().prepare('UPDATE studio_depenses SET etat = ?, maj_le = ? WHERE id = ?').run(decision, Date.now(), id);
  diffuserStudio(d.projectId, d.creationId);
  return { ok: true, depense: lireDepense(id)! };
}

/** Réécrit ce que porte une dépense (l'avancement d'une fabrication), sans toucher à son état. */
export function ecrireDetailsDepense(id: string, details: Record<string, unknown>): void {
  getDb().prepare('UPDATE studio_depenses SET details = ?, maj_le = ? WHERE id = ?').run(JSON.stringify(details), Date.now(), id);
}

/** Les dépenses validées d'un genre, encore à consommer (toutes créations). */
export function depensesValideesDeGenre(genre: GenreDepense): DepenseStudio[] {
  return (getDb().prepare("SELECT * FROM studio_depenses WHERE etat = 'validee' AND genre = ?").all(genre) as LigneDepense[]).map(depuisLigneDepense);
}

/** Ferme une dépense : « faite » avec le montant réel, ou « échouée » avec la raison, dite telle quelle. */
export function solderDepense(id: string, issue: { montantReel?: number; erreur?: string }): DepenseStudio | null {
  const d = lireDepense(id);
  if (!d) return null;
  getDb()
    .prepare('UPDATE studio_depenses SET etat = ?, montant_reel = ?, erreur = ?, maj_le = ? WHERE id = ?')
    .run(issue.erreur ? 'echouee' : 'faite', issue.montantReel ?? (issue.erreur ? 0 : null), issue.erreur ?? null, Date.now(), id);
  diffuserStudio(d.projectId, d.creationId);
  return lireDepense(id);
}

/** Ce qui a été réellement dépensé pour une création. */
export function totalDepense(creationId: string): number {
  return (getDb().prepare("SELECT COALESCE(SUM(montant_reel), 0) AS t FROM studio_depenses WHERE creation_id = ? AND etat = 'faite'").get(creationId) as { t: number }).t;
}

/* ------------------------------------------------------------------ */
/* Dupliquer, supprimer                                                 */
/* ------------------------------------------------------------------ */

export function dupliquerCreation(id: string): Resultat<{ creation: Creation }> {
  const c = lireCreation(id);
  const composition = compositionCourante(id);
  if (!c || !composition) return { ok: false, raison: 'création introuvable' };
  return creerCreation({ projectId: c.projectId, titre: `${c.titre} (copie)`, formats: c.formats, composition });
}

/**
 * SUPPRIMER UNE CRÉATION, C'EST AUSSI RENDRE LE DISQUE : ses versions, ses sons
 * de voix, ses exports et leurs fichiers partent avec elle. Les imports restent
 * dans la bibliothèque du projet (ils servent ailleurs).
 */
export function supprimerCreation(id: string): Resultat<{}> {
  const c = lireCreation(id);
  if (!c) return { ok: false, raison: 'création introuvable' };
  const medias = (getDb().prepare("SELECT * FROM studio_medias WHERE creation_id = ? AND provenance != 'import'").all(id) as LigneMedia[]).map(depuisLigneMedia);
  const exports = listerExports(id);
  enTransaction(() => {
    getDb().prepare('DELETE FROM studio_versions WHERE creation_id = ?').run(id);
    getDb().prepare("DELETE FROM studio_medias WHERE creation_id = ? AND provenance != 'import'").run(id);
    getDb().prepare('DELETE FROM studio_exports WHERE creation_id = ?').run(id);
    getDb().prepare('DELETE FROM studio_depenses WHERE creation_id = ?').run(id);
    // Son MODÈLE lui survit (il a ses propres médias) : il perd seulement le lien vers elle.
    getDb().prepare('UPDATE studio_modeles SET creation_id = NULL WHERE creation_id = ?').run(id);
    getDb().prepare('DELETE FROM studio_creations WHERE id = ?').run(id);
  });
  for (const m of medias) if (m.attachmentId) retirerPieceJointe(m.attachmentId);
  for (const e of exports) {
    if (e.attachmentId) retirerPieceJointe(e.attachmentId);
    if (e.afficheId) retirerPieceJointe(e.afficheId);
  }
  diffuserStudio(c.projectId);
  log.info(`studio : création « ${c.titre} » supprimée avec ${medias.length} son(s) et ${exports.length} export(s)`);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Adresses signées des médias, pour le cadre d'aperçu                  */
/* ------------------------------------------------------------------ */

/**
 * LE CADRE D'APERÇU A UNE ORIGINE OPAQUE : il n'envoie pas le témoin de
 * session. Ses médias passent donc par une adresse SIGNÉE, de courte durée,
 * limitée à UNE création et à UN média de son projet — deviner un identifiant
 * ne mène nulle part, et l'adresse ne sert à rien d'autre.
 */
const DUREE_SIGNATURE_MS = 2 * 60 * 60 * 1000;

function secretDesMedias(): string {
  let s = getMeta('studio_secret_medias');
  if (!s) {
    s = crypto.randomBytes(32).toString('hex');
    setMeta('studio_secret_medias', s);
  }
  return s;
}

function signature(creationId: string, mediaId: string, expire: number): string {
  return crypto.createHmac('sha256', secretDesMedias()).update(`${creationId}:${mediaId}:${expire}`).digest('base64url').slice(0, 32);
}

export function adresseSigneeDuMedia(creationId: string, mediaId: string, maintenant = Date.now()): string {
  // Arrondie à l'heure : deux aperçus de la même heure gardent la même adresse, le cache du navigateur sert.
  const expire = Math.ceil((maintenant + DUREE_SIGNATURE_MS) / 3_600_000) * 3_600_000;
  return `/studio-media/${encodeURIComponent(creationId)}/${encodeURIComponent(mediaId)}?e=${expire}&s=${signature(creationId, mediaId, expire)}`;
}

/** Vérifie une adresse signée et rend le fichier qu'elle ouvre, ou rien. */
export function mediaDeLAdresseSignee(creationId: string, mediaId: string, expire: number, sig: string, maintenant = Date.now()): MediaStudio | null {
  if (!Number.isFinite(expire) || expire < maintenant) return null;
  const attendue = signature(creationId, mediaId, expire);
  if (sig.length !== attendue.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(attendue))) return null;
  const creation = lireCreation(creationId);
  const media = lireMedia(mediaId);
  if (!creation || !media || media.projectId !== creation.projectId) return null;
  return media;
}
