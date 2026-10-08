import fs from 'node:fs';
import {
  type Composition,
  type Creation,
  type FormatStudio,
  type MediaStudio,
  type ModeleStudio,
  compositionVide,
  dureeExportee,
  estFormatStudio,
  mediasDeLaComposition,
  remplacerMediasDansComposition,
} from '@beluga/shared';
import { getDb } from './db.js';
import * as store from './store.js';
import { cheminDePieceJointe } from './pieces-jointes.js';
import { joindreUnFichier } from './joindre-fichier.js';
import {
  type Resultat,
  ajouterMedia,
  compositionCourante,
  creerCreation,
  diffuserStudio,
  fichierDuMedia,
  lireCreation,
  lireMedia,
  nouvelId,
  supprimerMedia,
} from './studio.js';
import { log } from './logger.js';

/**
 * LES MODÈLES DU STUDIO — la bibliothèque des vidéos VALIDÉES d'un projet.
 *
 * « Garder comme modèle » (fenêtre « Mettre en production ») fige la version courante en MODÈLE du projet (une
 * création n'a qu'un modèle : revalider le met à jour). On repart d'un modèle
 * pour une nouvelle création, l'agent en reprend une scène, et on le copie vers
 * un autre projet.
 *
 * LES MÉDIAS SUIVENT LE MODÈLE. Les sons propres à la création (voix d'essai,
 * voix finales) disparaîtraient avec elle : le modèle en garde des lignes à lui
 * (`categorie = 'modele:<id>'`, même fichier). Une création née d'un modèle
 * reçoit à son tour ses propres lignes : supprimer le modèle ne la casse pas.
 * Copié vers un autre projet, chaque fichier est recopié dans les pièces jointes
 * du projet cible — un média n'est servi qu'au projet qui le possède.
 */

interface LigneModele {
  id: string;
  project_id: string;
  creation_id: string | null;
  origine_id: string | null;
  titre: string;
  formats: string;
  composition: string;
  version: number;
  affiche_id: string | null;
  duree: number;
  cree_le: number;
  maj_le: number;
}

function lire<T>(texte: string, repli: T): T {
  try {
    return JSON.parse(texte) as T;
  } catch {
    return repli;
  }
}

function depuisLigne(l: LigneModele): ModeleStudio {
  const formats = lire<string[]>(l.formats, ['9:16']).filter(estFormatStudio) as FormatStudio[];
  return {
    id: l.id,
    projectId: l.project_id,
    ...(l.creation_id ? { creationId: l.creation_id } : {}),
    ...(l.origine_id ? { origineId: l.origine_id } : {}),
    titre: l.titre,
    formats: formats.length ? formats : ['9:16'],
    composition: lire<Composition>(l.composition, compositionVide()),
    version: l.version,
    ...(l.affiche_id ? { afficheId: l.affiche_id } : {}),
    duree: l.duree,
    creeLe: l.cree_le,
    majLe: l.maj_le,
  };
}

export function lireModele(id: string): ModeleStudio | null {
  const l = getDb().prepare('SELECT * FROM studio_modeles WHERE id = ?').get(id) as LigneModele | undefined;
  return l ? depuisLigne(l) : null;
}

export function modeleDeLaCreation(creationId: string): ModeleStudio | null {
  const l = getDb().prepare('SELECT * FROM studio_modeles WHERE creation_id = ?').get(creationId) as LigneModele | undefined;
  return l ? depuisLigne(l) : null;
}

export function listerModeles(projectId?: string): ModeleStudio[] {
  const lignes = projectId
    ? (getDb().prepare('SELECT * FROM studio_modeles WHERE project_id = ? ORDER BY maj_le DESC').all(projectId) as LigneModele[])
    : (getDb().prepare('SELECT * FROM studio_modeles ORDER BY maj_le DESC').all() as LigneModele[]);
  return lignes.map(depuisLigne);
}

/** Ce que l'écran montre d'un modèle (sans la composition, parfois lourde). */
export function resumeDuModele(m: ModeleStudio) {
  const { composition, ...reste } = m;
  return { ...reste, scenes: composition.pistes.filter((p) => p.genre === 'visuel').reduce((n, p) => n + p.segments.length, 0) };
}

function marqueDuModele(modeleId: string): string {
  return `modele:${modeleId}`;
}

function copierLigneDeMedia(m: MediaStudio, champs: { projectId: string; creationId?: string; attachmentId?: string; categorie?: string }): MediaStudio {
  const { id: _id, creeLe: _cree, creationId: _creation, ...reste } = m;
  return ajouterMedia({
    ...reste,
    projectId: champs.projectId,
    ...(champs.creationId ? { creationId: champs.creationId } : {}),
    ...(champs.attachmentId !== undefined ? { attachmentId: champs.attachmentId } : {}),
    ...(champs.categorie ? { categorie: champs.categorie } : {}),
  });
}

/**
 * Les médias PROPRES À UNE CRÉATION (voix…) cités par la composition reçoivent
 * une ligne au nom du modèle — même fichier — et la composition les cite à leur
 * place. Les imports et dessins du projet sont cités tels quels : ils ne
 * disparaissent pas avec une création.
 */
function garderLesMediasDuModele(modeleId: string, composition: Composition): Composition {
  const table: Record<string, string> = {};
  for (const id of mediasDeLaComposition(composition)) {
    const m = lireMedia(id);
    if (!m || !m.creationId || m.provenance === 'import') continue;
    if (m.categorie === marqueDuModele(modeleId)) continue;
    // Revalider ne recopie pas : la ligne du modèle qui porte déjà ce fichier est reprise.
    const deja = m.attachmentId
      ? (getDb().prepare('SELECT id FROM studio_medias WHERE categorie = ? AND attachment_id = ? LIMIT 1').get(marqueDuModele(modeleId), m.attachmentId) as { id: string } | undefined)
      : undefined;
    table[id] = deja?.id ?? copierLigneDeMedia(m, { projectId: m.projectId, categorie: marqueDuModele(modeleId) }).id;
  }
  return remplacerMediasDansComposition(composition, table);
}

/** Les lignes de médias du modèle qu'il ne cite plus (après une revalidation, ou à sa suppression). */
function retirerLesMediasInutiles(modeleId: string, garder: Composition | null): void {
  const cites = new Set(garder ? mediasDeLaComposition(garder) : []);
  const lignes = getDb().prepare('SELECT id FROM studio_medias WHERE categorie = ?').all(marqueDuModele(modeleId)) as { id: string }[];
  for (const { id } of lignes) if (!cites.has(id)) supprimerMedia(id);
}

/**
 * « VALIDER LA CRÉATION » : la version courante devient le modèle du projet. La
 * revalider met le MÊME modèle à jour (titre, formats, composition, affiche).
 */
export function validerCreationEnModele(creationId: string, maintenant = Date.now()): Resultat<{ modele: ModeleStudio; nouveau: boolean }> {
  const creation = lireCreation(creationId);
  const composition = compositionCourante(creationId);
  if (!creation || !composition) return { ok: false, raison: 'création introuvable' };
  if (!composition.pistes.some((p) => p.segments.length)) return { ok: false, raison: 'la création est vide : il n’y a rien à garder comme modèle' };
  const existant = modeleDeLaCreation(creationId);
  const id = existant?.id ?? nouvelId('mod');
  const figee = garderLesMediasDuModele(id, composition);
  const ligne = [creation.titre, JSON.stringify(creation.formats), JSON.stringify(figee), creation.version, creation.afficheId ?? null, dureeExportee(figee), maintenant];
  if (existant) {
    getDb()
      .prepare('UPDATE studio_modeles SET titre = ?, formats = ?, composition = ?, version = ?, affiche_id = ?, duree = ?, maj_le = ? WHERE id = ?')
      .run(...ligne, id);
    retirerLesMediasInutiles(id, figee);
  } else {
    getDb()
      .prepare(
        'INSERT INTO studio_modeles (titre, formats, composition, version, affiche_id, duree, maj_le, id, project_id, creation_id, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(...ligne, id, creation.projectId, creation.id, maintenant);
  }
  diffuserStudio(creation.projectId, creation.id);
  log.info(`studio : « ${creation.titre} » ${existant ? 'met à jour son modèle' : 'devient un modèle'} (version ${creation.version})`);
  return { ok: true, modele: lireModele(id)!, nouveau: !existant };
}

export function supprimerModele(id: string): Resultat<{}> {
  const m = lireModele(id);
  if (!m) return { ok: false, raison: 'modèle introuvable' };
  getDb().prepare('DELETE FROM studio_modeles WHERE id = ?').run(id);
  retirerLesMediasInutiles(id, null);
  diffuserStudio(m.projectId, m.creationId);
  return { ok: true };
}

/**
 * UNE NOUVELLE CRÉATION DEPUIS UN MODÈLE : sa composition entière (marqueur bleu
 * compris), ses formats ; les sons du modèle sont redonnés à la nouvelle création.
 */
export function creerDepuisModele(modeleId: string, titre?: string): Resultat<{ creation: Creation }> {
  const modele = lireModele(modeleId);
  if (!modele) return { ok: false, raison: 'modèle introuvable' };
  const r = creerCreation({ projectId: modele.projectId, titre: titre?.trim() || modele.titre, formats: modele.formats, composition: modele.composition });
  if (!r.ok) return r;
  const table: Record<string, string> = {};
  for (const id of mediasDeLaComposition(modele.composition)) {
    const m = lireMedia(id);
    if (m?.categorie === marqueDuModele(modele.id)) {
      const { categorie: _c, ...sansMarque } = m;
      table[id] = copierLigneDeMedia(sansMarque as MediaStudio, { projectId: m.projectId, creationId: r.creation.id }).id;
    }
  }
  if (Object.keys(table).length) {
    const remplacee = remplacerMediasDansComposition(modele.composition, table);
    getDb().prepare('UPDATE studio_versions SET composition = ? WHERE creation_id = ? AND numero = 1').run(JSON.stringify(remplacee), r.creation.id);
  }
  getDb().prepare("UPDATE studio_versions SET raison = ? WHERE creation_id = ? AND numero = 1").run(`depuis le modèle « ${modele.titre} »`.slice(0, 200), r.creation.id);
  diffuserStudio(modele.projectId, r.creation.id);
  return { ok: true, creation: lireCreation(r.creation.id)! };
}

/** Recopie une pièce jointe dans les pièces jointes d'un autre projet. */
async function recopierPieceJointe(attachmentId: string, projectId: string): Promise<string | null> {
  const piece = store.getAttachment(attachmentId);
  if (!piece) return null;
  const chemin = cheminDePieceJointe(piece);
  if (!fs.existsSync(chemin)) return null;
  const r = await joindreUnFichier({ projectId, agentId: '', fichier: chemin, nom: piece.name });
  return r.ok ? r.attachment.id : null;
}

/**
 * COPIER UN MODÈLE VERS UN AUTRE PROJET. Chaque média cité est recopié dans le
 * projet cible (fichier compris) sous un nouvel identifiant, et la composition
 * les cite à leur nouvelle place : sans cela, le modèle copié serait muet et
 * vide (un média n'est servi qu'à son projet).
 */
export async function copierModele(id: string, projectIdCible: string, maintenant = Date.now()): Promise<Resultat<{ modele: ModeleStudio; manquants: number }>> {
  const source = lireModele(id);
  if (!source) return { ok: false, raison: 'modèle introuvable' };
  const cible = store.getProject(projectIdCible);
  if (!cible) return { ok: false, raison: 'projet introuvable' };
  if (cible.id === source.projectId) return { ok: false, raison: 'ce modèle est déjà dans ce projet' };
  const nouvelIdModele = nouvelId('mod');
  const table: Record<string, string> = {};
  let manquants = 0;
  for (const mediaId of mediasDeLaComposition(source.composition)) {
    const m = lireMedia(mediaId);
    if (!m) {
      manquants += 1;
      continue;
    }
    let attachmentId: string | undefined;
    if (m.attachmentId) {
      const fichier = fichierDuMedia(m);
      attachmentId = fichier ? ((await recopierPieceJointe(m.attachmentId, cible.id)) ?? undefined) : undefined;
      if (!attachmentId) {
        manquants += 1;
        continue;
      }
    }
    const { categorie: _c, ...sansMarque } = m;
    table[mediaId] = copierLigneDeMedia(sansMarque as MediaStudio, { projectId: cible.id, ...(attachmentId ? { attachmentId } : {}), categorie: marqueDuModele(nouvelIdModele) }).id;
  }
  const composition = remplacerMediasDansComposition(source.composition, table);
  const affiche = source.afficheId ? await recopierPieceJointe(source.afficheId, cible.id) : null;
  getDb()
    .prepare(
      'INSERT INTO studio_modeles (id, project_id, creation_id, origine_id, titre, formats, composition, version, affiche_id, duree, cree_le, maj_le) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(nouvelIdModele, cible.id, source.id, source.titre, JSON.stringify(source.formats), JSON.stringify(composition), source.version, affiche, source.duree, maintenant, maintenant);
  diffuserStudio(cible.id);
  log.info(`studio : modèle « ${source.titre} » copié vers « ${cible.name} » (${Object.keys(table).length} média(s)${manquants ? `, ${manquants} manquant(s)` : ''})`);
  return { ok: true, modele: lireModele(nouvelIdModele)!, manquants };
}
