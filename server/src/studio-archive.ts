import fs from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import yazl from 'yazl';
import { extensionDExport, nomDExport, nomsSansDoublon, slugTitre } from '@beluga/shared';
import * as store from './store.js';
import { cheminDePieceJointe } from './pieces-jointes.js';
import { lireCreation, lireExport } from './studio.js';

/**
 * L'ARCHIVE DE PLUSIEURS EXPORTS DU STUDIO (« Tout télécharger »).
 *
 * Tous les exports nommés doivent être PRÊTS et venir de la MÊME création :
 * sinon rien ne sort, et la raison est dite (un lot à moitié téléchargé se
 * prendrait pour le lot entier). Chaque fichier porte son nom d'export
 * (`nomDExport` : `<titre>-<format>-v<version>.<ext>`), dédoublonné.
 *
 * L'archive part en FLUX, sans compression : `poids` rend son poids final dès
 * qu'il est connu (ou -1), pour l'entête `content-length`.
 */
export type ArchiveDesExports =
  | { ok: true; nom: string; flux: Readable; poids: Promise<number>; fichiers: string[] }
  | { ok: false; statut: 400 | 404; raison: string };

/** Au plus autant de fichiers qu'un lot peut en porter (quatre formats, vidéo et image). */
const MAX_FICHIERS = 24;

export function archiveDesExports(ids: string[]): ArchiveDesExports {
  const uniques = [...new Set(ids)];
  if (!uniques.length) return { ok: false, statut: 400, raison: 'aucun export demandé' };
  if (uniques.length > MAX_FICHIERS) return { ok: false, statut: 400, raison: 'trop d’exports demandés à la fois' };
  const chemins: { chemin: string; nom: string }[] = [];
  let creationId: string | null = null;
  let titre = '';
  for (const id of uniques) {
    const e = lireExport(id);
    if (!e) return { ok: false, statut: 404, raison: 'export introuvable' };
    if (creationId && e.creationId !== creationId) return { ok: false, statut: 400, raison: 'ces exports ne viennent pas de la même création' };
    if (!creationId) titre = lireCreation(e.creationId)?.titre ?? '';
    creationId = e.creationId;
    const piece = e.etat === 'pret' && e.attachmentId ? store.getAttachment(e.attachmentId) : null;
    if (!piece) return { ok: false, statut: 400, raison: 'un de ces exports n’est pas prêt' };
    const chemin = cheminDePieceJointe(piece);
    if (!fs.existsSync(chemin)) return { ok: false, statut: 404, raison: `le fichier « ${piece.name} » est absent du disque` };
    /* LE NOM VIENT DE L'EXPORT, pas de la pièce : deux fichiers identiques au bit près partagent UNE pièce jointe
       (une image exportée à l'instant de l'affiche d'une vidéo porte alors le nom « …-affiche.png »). */
    const extension = e.reglages ? extensionDExport(e.genre, e.reglages) : path.extname(piece.name).slice(1) || undefined;
    chemins.push({ chemin, nom: nomDExport(titre, e.format, e.version, e.genre, extension) });
  }
  const noms = nomsSansDoublon(chemins.map((c) => c.nom));
  const zip = new yazl.ZipFile();
  chemins.forEach((c, i) => zip.addFile(c.chemin, noms[i]!, { compress: false }));
  // Les types de yazl taisent l'argument du rappel : c'est le poids final calculé (-1 s'il est inconnu).
  const finir = zip.end.bind(zip) as unknown as (options: object, poidsCalcule: (octets: number) => void) => void;
  const poids = new Promise<number>((resolve) => finir({}, resolve));
  return { ok: true, nom: `${slugTitre(titre) || 'exports'}-exports.zip`, flux: zip.outputStream as unknown as Readable, poids, fichiers: noms };
}
