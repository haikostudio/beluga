/**
 * LE FOND RETIRÉ D'UN FICHIER, ET SON LIEN AVEC L'ORIGINAL (décisions de l'utilisateur du 02/11/2026).
 *
 * L'original n'est jamais perdu : `studio_fonds_retires` relie le fichier détouré à celui d'où il vient. Ce lien sert
 * à « Remettre le fond », à ne jamais détourer deux fois, et à rendre le fichier ENTIER aux services qui
 * animent une image (une image transparente leur donnerait un fond noir).
 *
 * Le retrait d'office vaut pour le Studio seulement : ni les cartes caméra, ni les pièces jointes ordinaires.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from './db.js';
import { log } from './logger.js';
import * as store from './store.js';
import { dansLaFileLourde } from './file-lourde.js';
import { joindreUnFichier } from './joindre-fichier.js';
import { cheminDePieceJointe } from './pieces-jointes.js';

export function noterFondRetire(projectId: string, detouree: string, originale: string): void {
  getDb()
    .prepare(
      `INSERT INTO studio_fonds_retires (piece_detouree, piece_originale, project_id, remis_le, cree_le) VALUES (?, ?, ?, NULL, ?)
       ON CONFLICT(piece_detouree) DO UPDATE SET piece_originale = excluded.piece_originale, remis_le = NULL`,
    )
    .run(detouree, originale, projectId, Date.now());
}

/** L'original d'un fichier détouré ; `null` pour tout autre fichier. */
export function pieceOriginaleDuFond(detouree: string): string | null {
  const l = getDb().prepare('SELECT piece_originale FROM studio_fonds_retires WHERE piece_detouree = ?').get(detouree) as { piece_originale: string } | undefined;
  return l?.piece_originale ?? null;
}

/** La version sans fond d'un original, la plus récente. */
export function pieceSansFond(originale: string): { piece: string; remis: boolean } | null {
  const l = getDb().prepare('SELECT piece_detouree, remis_le FROM studio_fonds_retires WHERE piece_originale = ? ORDER BY cree_le DESC LIMIT 1').get(originale) as { piece_detouree: string; remis_le: number | null } | undefined;
  return l ? { piece: l.piece_detouree, remis: l.remis_le !== null } : null;
}

export function marquerFondRemis(detouree: string, remis: boolean): void {
  getDb().prepare('UPDATE studio_fonds_retires SET remis_le = ? WHERE piece_detouree = ?').run(remis ? Date.now() : null, detouree);
}

/** Pour l'écran : fichier détouré → son original, et s'il a été remis. */
export function fondsRetiresDuProjet(projectId: string): Record<string, { original: string; remis: boolean }> {
  const lignes = getDb().prepare('SELECT piece_detouree, piece_originale, remis_le FROM studio_fonds_retires WHERE project_id = ?').all(projectId) as { piece_detouree: string; piece_originale: string; remis_le: number | null }[];
  return Object.fromEntries(lignes.map((l) => [l.piece_detouree, { original: l.piece_originale, remis: l.remis_le !== null }]));
}

/** ffmpeg lit ces formats-là ; un GIF animé ou un SVG restent tels quels. */
const IMAGE_DETOURABLE = /^image\/(png|jpe?g|webp)$/;

/**
 * LE RETRAIT D'OFFICE D'UNE IMAGE : si elle a un vrai fond uni, sa version PNG sans fond rejoint le projet et son
 * identifiant est rendu. `null` sinon, sans rien dire : le média reste entier, et une panne ne fait jamais échouer
 * une génération ou un import.
 */
export async function retirerLeFondDOffice(d: { projectId: string; attachmentId: string; cardId?: string; agentId?: string; deLAgent?: boolean }): Promise<string | null> {
  try {
    const piece = store.getAttachment(d.attachmentId);
    if (!piece || !IMAGE_DETOURABLE.test(piece.mime) || pieceOriginaleDuFond(piece.id)) return null;
    const existante = pieceSansFond(piece.id);
    if (existante) return existante.remis ? null : existante.piece;
    const source = cheminDePieceJointe(piece);
    if (!fs.existsSync(source)) return null;
    const { detourerUneImage, lireLeFondDuFichier } = await import('./studio-detourage.js');
    const lu = await dansLaFileLourde(() => lireLeFondDuFichier(source, { exigeant: true }));
    if (!lu.couleur) return null;
    const png = await dansLaFileLourde(() => detourerUneImage(source, lu.couleur!));
    const jointe = await joindreUnFichier({
      projectId: d.projectId,
      ...(d.cardId ? { cardId: d.cardId } : {}),
      ...(d.agentId ? { agentId: d.agentId } : {}),
      ...(d.deLAgent ? { deLAgent: true } : {}),
      fichier: png,
      nom: `${path.parse(piece.name).name}-sans-fond.png`,
    });
    fs.rmSync(png, { force: true });
    if (!jointe.ok) throw new Error(jointe.refus);
    noterFondRetire(d.projectId, jointe.attachment.id, piece.id);
    return jointe.attachment.id;
  } catch (err) {
    log.info(`fond d’office : « ${d.attachmentId} » laissé entier (${String((err as Error)?.message ?? err).slice(0, 200)})`);
    return null;
  }
}
