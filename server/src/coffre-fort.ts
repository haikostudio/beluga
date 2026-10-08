import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  AccesCoffre,
  PROJET_DU_COFFRE,
  TypeAcces,
  archivePurgeable,
  imagesApresEnregistrement,
  jugerAcces,
  trierAcces,
  type Attachment,
} from '@beluga/shared';
import { getDb } from './db.js';
import { log } from './logger.js';
import { cheminDePieceJointe } from './pieces-jointes.js';
import * as store from './store.js';

/**
 * LE COFFRE-FORT — le rangement sur le disque.
 *
 * Les règles qui se décident sans base vivent dans `shared/src/coffre-fort.ts`.
 * Ici : lire, écrire, effacer. La fiche « accès SSH de la machine », reflet des
 * anciens réglages du VPS, a disparu avec eux : toutes les fiches viennent du
 * coffre lui-même.
 */

interface LigneAcces {
  id: string;
  nom: string;
  type: string;
  project_id: string | null;
  champs: string;
  note: string;
  cree_le: number;
  modifie_le: number;
  archive_le?: number | null;
  images?: string | null;
}

/** La liste d'images d'une ligne : un JSON abîmé vaut « aucune image ». */
function imagesDeLaLigne(brut: string | null | undefined): string[] {
  try {
    const lu = JSON.parse(brut ?? '[]');
    return Array.isArray(lu) ? lu.filter((v): v is string => typeof v === 'string' && v.length > 0) : [];
  } catch {
    return [];
  }
}

function depuisLigne(ligne: LigneAcces): AccesCoffre {
  let champs: Record<string, string> = {};
  try {
    const lu = JSON.parse(ligne.champs ?? '{}');
    if (lu && typeof lu === 'object') champs = lu as Record<string, string>;
  } catch {
    // Une fiche au JSON abîmé se montre vide plutôt que de faire tomber la liste.
  }
  return {
    id: ligne.id,
    nom: ligne.nom,
    type: ligne.type as TypeAcces,
    projectId: ligne.project_id,
    champs,
    note: ligne.note ?? '',
    creeLe: ligne.cree_le,
    modifieLe: ligne.modifie_le,
    origine: 'coffre',
    archiveLe: ligne.archive_le ?? null,
    images: imagesDeLaLigne(ligne.images),
  };
}

/**
 * Toutes les fiches ACTIVES, la plus récemment touchée d'abord. Les fiches archivées n'y sont JAMAIS : ni les agents, ni les surveillances,
 * ni les relais ne s'appuient sur un accès retiré. Elles se lisent à part,
 * par `listerArchives`.
 */
export function listerAcces(): AccesCoffre[] {
  const lignes = getDb().prepare('SELECT * FROM secrets WHERE archive_le IS NULL').all() as LigneAcces[];
  return trierAcces(lignes.map(depuisLigne));
}

/** Les fiches archivées, la plus récemment retirée d'abord. */
export function listerArchives(): AccesCoffre[] {
  const lignes = getDb()
    .prepare('SELECT * FROM secrets WHERE archive_le IS NOT NULL ORDER BY archive_le DESC, nom ASC')
    .all() as LigneAcces[];
  return lignes.map(depuisLigne);
}

export type EnregistrementAcces = { ok: true; acces: AccesCoffre } | { ok: false; raison: string };

/**
 * Écrit une fiche : nouvelle si `id` est vide, remplacée sinon. Le retour est
 * la fiche telle qu'elle est désormais rangée — l'interface s'en sert plutôt
 * que de recopier ce qu'elle croyait avoir envoyé.
 */
export function enregistrerAcces(brut: unknown, maintenant = Date.now()): EnregistrementAcces {
  const juge = jugerAcces(brut);
  if (!juge.ok) return { ok: false, raison: juge.raison };

  const id = String((brut as any)?.id ?? '').trim();

  // Un projet inconnu ne se range pas : la contrainte de la base refuserait la
  // ligne avec un message illisible.
  if (juge.projectId) {
    const existe = getDb().prepare('SELECT 1 FROM projects WHERE id = ?').get(juge.projectId);
    if (!existe) return { ok: false, raison: 'Ce projet n’existe pas.' };
  }

  const champs = JSON.stringify(juge.champs);

  if (id) {
    const ligne = getDb().prepare('SELECT * FROM secrets WHERE id = ?').get(id) as LigneAcces | undefined;
    if (!ligne) return { ok: false, raison: 'Accès introuvable.' };
    if (ligne.archive_le != null)
      return { ok: false, raison: 'Cet accès est archivé : restaurez-le avant de le corriger.' };
    /*
     * UNE CORRECTION QUI NE DIT RIEN DES IMAGES LES GARDE. L'outil des agents
     * ne transporte pas d'images : sans cette règle, corriger un mot de passe
     * depuis une tâche aurait vidé la fiche de ses captures.
     */
    const { images, retirees } = imagesApresEnregistrement(imagesDeLaLigne(ligne.images), juge.images);
    const refus = imagesRefusees(images);
    if (refus) return { ok: false, raison: refus };
    const imagesEcrites = JSON.stringify(images);
    getDb()
      .prepare(
        'UPDATE secrets SET nom = ?, type = ?, project_id = ?, champs = ?, note = ?, images = ?, modifie_le = ? WHERE id = ?',
      )
      .run(juge.nom, juge.type, juge.projectId, champs, juge.note, imagesEcrites, maintenant, id);
    effacerLesImagesOrphelines(retirees);
    return { ok: true, acces: depuisLigne({ ...ligne, nom: juge.nom, type: juge.type, project_id: juge.projectId, champs, note: juge.note, images: imagesEcrites, modifie_le: maintenant }) };
  }

  const refus = imagesRefusees(juge.images ?? []);
  if (refus) return { ok: false, raison: refus };

  const neuf: LigneAcces = {
    id: crypto.randomUUID(),
    nom: juge.nom,
    type: juge.type,
    project_id: juge.projectId,
    champs,
    note: juge.note,
    cree_le: maintenant,
    modifie_le: maintenant,
    images: JSON.stringify(juge.images ?? []),
  };
  getDb()
    .prepare(
      'INSERT INTO secrets (id, nom, type, project_id, champs, note, images, cree_le, modifie_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(neuf.id, neuf.nom, neuf.type, neuf.project_id, neuf.champs, neuf.note, neuf.images, neuf.cree_le, neuf.modifie_le);
  log.info(`coffre-fort : accès « ${neuf.nom} » enregistré`);
  return { ok: true, acces: depuisLigne(neuf) };
}

/* ------------------------------------------------------------------ */
/* LES IMAGES D'UNE FICHE                                              */
/* ------------------------------------------------------------------ */

/**
 * Une fiche ne cite que des images DÉPOSÉES POUR LE COFFRE. Un identifiant de
 * pièce jointe se devine mal, mais s'il venait d'une carte ou d'une demande
 * client, la purge de la fiche effacerait un fichier qui ne lui appartient
 * pas. Rend la phrase de refus, ou rien.
 */
function imagesRefusees(ids: readonly string[]): string | undefined {
  for (const id of ids) {
    const piece = store.getAttachment(id);
    if (!piece) return 'Une image de cette fiche est introuvable : retirez-la et joignez-la de nouveau.';
    if (piece.projectId !== PROJET_DU_COFFRE) return 'Cette image n’a pas été déposée dans le coffre-fort.';
  }
  return undefined;
}

/**
 * LES IMAGES DE QUELQUES FICHES, retrouvées par leur identifiant — avec le
 * chemin du fichier, seule forme qu'un agent sache ouvrir. Une image disparue
 * du disque est simplement absente : la fiche reste lisible sans elle.
 */
export function imagesDesAcces(acces: readonly AccesCoffre[]): (Attachment & { chemin: string })[] {
  const vues = new Set<string>();
  const pieces: (Attachment & { chemin: string })[] = [];
  for (const fiche of acces) {
    for (const id of fiche.images ?? []) {
      if (vues.has(id)) continue;
      vues.add(id);
      const piece = store.getAttachment(id);
      if (piece) pieces.push({ ...piece, chemin: cheminDePieceJointe(piece) });
    }
  }
  return pieces;
}

/** Une AUTRE fiche du coffre (active ou archivée) cite-t-elle encore cette image ? */
function imageEncoreCitee(imageId: string): boolean {
  const lignes = getDb()
    .prepare("SELECT images FROM secrets WHERE images LIKE '%' || ? || '%'")
    .all(imageId) as { images: string | null }[];
  if (lignes.some((l) => imagesDeLaLigne(l.images).includes(imageId))) return true;
  // Une note peut citer la même pièce (collée depuis le coffre) : on ne lui retire rien.
  try {
    const notes = getDb()
      .prepare("SELECT 1 FROM notes WHERE pieces_jointes LIKE '%' || ? || '%' OR description LIKE '%' || ? || '%' LIMIT 1")
      .get(imageId, imageId);
    if (notes) return true;
  } catch {
    /* une base sans notes n'a rien à protéger */
  }
  return false;
}

/**
 * EFFACE LES IMAGES QUE PLUS AUCUNE FICHE NE CITE : la ligne de la pièce jointe
 * et son fichier. Deux fiches peuvent porter la MÊME image (le dépôt dédoublonne
 * par empreinte à l'intérieur du coffre) : tant que l'une la cite, elle reste.
 * Une pièce qui n'appartient pas au coffre n'est jamais touchée. Rend le nombre
 * de fichiers effacés.
 */
export function effacerLesImagesOrphelines(ids: readonly string[]): number {
  let effacees = 0;
  for (const id of new Set(ids)) {
    try {
      const piece = store.getAttachment(id);
      if (!piece || piece.projectId !== PROJET_DU_COFFRE) continue;
      if (imageEncoreCitee(id)) continue;
      const chemin = cheminDePieceJointe(piece);
      store.supprimerPieceJointe(id);
      fs.rmSync(chemin, { force: true });
      effacees += 1;
    } catch (err) {
      log.warn(`coffre-fort : image ${id} non effacée — ${(err as Error).message}`);
    }
  }
  return effacees;
}

/**
 * Les surveillances dont la recette lit cette fiche (`acces: { id, champ }`).
 * Une fiche qu'une surveillance utilise ne s'archive pas : la surveillance
 * tomberait en panne sans que rien ne dise pourquoi.
 */
function surveillancesQuiLisent(id: string): string[] {
  try {
    const lignes = getDb()
      .prepare(
        "SELECT url, recette FROM sites_surveilles WHERE recette LIKE '%' || ? || '%' OR wordpress LIKE '%' || ? || '%'",
      )
      .all(id, id) as { url: string; recette: string | null }[];
    return lignes.map((l) => l.url);
  } catch {
    return [];
  }
}

/**
 * RETIRE une fiche : elle n'est plus effacée mais ARCHIVÉE, avec l'instant du
 * retrait. Elle quitte la liste et tout ce que les agents consultent, reste
 * lisible dans les archives, se restaure, et n'est effacée pour de bon qu'au
 * bout de six mois (`purgerArchives`).
 */
export function supprimerAcces(id: string, maintenant = Date.now()): { ok: boolean; raison?: string } {
  const ligne = getDb().prepare('SELECT nom, archive_le FROM secrets WHERE id = ?').get(id) as
    | { nom: string; archive_le: number | null }
    | undefined;
  if (!ligne) return { ok: false, raison: 'Accès introuvable.' };
  if (ligne.archive_le != null) return { ok: false, raison: 'Cet accès est déjà archivé.' };
  const sites = surveillancesQuiLisent(id);
  if (sites.length)
    return {
      ok: false,
      raison: `Une surveillance lit encore cet accès (${sites.join(', ')}) : faites-la pointer vers une autre fiche avant de le retirer.`,
    };
  getDb().prepare('UPDATE secrets SET archive_le = ? WHERE id = ?').run(maintenant, id);
  log.info(`coffre-fort : accès « ${ligne.nom} » archivé`);
  return { ok: true };
}

/** Remet une fiche archivée parmi les accès actifs. */
export function restaurerAcces(id: string): { ok: boolean; raison?: string } {
  const res = getDb().prepare('UPDATE secrets SET archive_le = NULL WHERE id = ? AND archive_le IS NOT NULL').run(id);
  if (!res.changes) return { ok: false, raison: 'Archive introuvable.' };
  log.info(`coffre-fort : accès ${id} restauré depuis les archives`);
  return { ok: true };
}

/**
 * EFFACE POUR DE BON les fiches archivées depuis plus de six mois, AVEC LEURS
 * IMAGES — et elles seules : la règle (`archivePurgeable`) ne rend jamais vrai pour une fiche
 * active. Chaque effacement laisse sa ligne au journal. Rend le nombre effacé.
 */
export function purgerArchives(maintenant = Date.now()): number {
  let effacees = 0;
  for (const acces of listerArchives()) {
    if (!archivePurgeable(acces, maintenant)) continue;
    getDb().prepare('DELETE FROM secrets WHERE id = ? AND archive_le IS NOT NULL').run(acces.id);
    // La ligne d'abord, les images ensuite : c'est une fois la fiche partie
    // qu'on sait si une AUTRE fiche cite encore la même image.
    effacerLesImagesOrphelines(acces.images ?? []);
    log.info(
      `coffre-fort : archive « ${acces.nom} » (${acces.id}) effacée, retirée le ${new Date(acces.archiveLe ?? 0).toISOString()}`,
    );
    effacees += 1;
  }
  return effacees;
}

/**
 * LES IMAGES ENVOYÉES PUIS JAMAIS RATTACHÉES. Une image part au coffre dès
 * qu'on la choisit, et n'est citée par sa fiche qu'à l'enregistrement : une
 * fiche refermée sans enregistrer laisse donc un fichier sans propriétaire.
 * Après un jour, plus personne ne viendra le réclamer.
 */
const DELAI_IMAGE_SANS_FICHE_MS = 24 * 3600_000;

export function balayerLesImagesSansFiche(maintenant = Date.now()): number {
  const anciennes = store
    .listAttachments(PROJET_DU_COFFRE)
    .filter((piece) => maintenant - piece.createdAt >= DELAI_IMAGE_SANS_FICHE_MS)
    .map((piece) => piece.id);
  return effacerLesImagesOrphelines(anciennes);
}

/** La purge des archives : cinq minutes après le démarrage, puis chaque jour. */
export function planifierPurgeDesArchives(): NodeJS.Timeout[] {
  const passer = () => {
    try {
      purgerArchives();
      balayerLesImagesSansFiche();
    } catch (err) {
      log.warn(`coffre-fort : purge des archives sautée — ${(err as Error).message}`);
    }
  };
  const premiere = setTimeout(passer, 5 * 60_000);
  premiere.unref();
  const chaqueJour = setInterval(passer, 24 * 3600_000);
  chaqueJour.unref();
  return [premiere, chaqueJour];
}
