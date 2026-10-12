/**
 * LES PIÈCES JOINTES D'UN MESSAGE EN ATTENTE, UNE FOIS MODIFIÉ.
 *
 * Un message écrit pendant que l'agent travaille attend son tour dans la file,
 * avec ses pièces jointes. Le modifier ne changeait que son TEXTE : la liste
 * de ses pièces restait celle du premier envoi. Retirer la pastille d'une
 * image ne retirait donc rien — le fichier partait quand même à l'agent —, et
 * une image jointe pendant la modification n'y entrait jamais : son tag
 * partait seul, sans fichier derrière.
 *
 * L'écran dit désormais quelles pièces le message porte APRÈS la modification
 * (`queue.update`, champ `attachments`). Deux garde-fous tiennent la règle
 * « modifier un message ne lui fait jamais perdre un fichier » :
 *
 * - un écran qui ne dit RIEN (une version d'avant) ne retire rien : la liste
 *   d'origine reste telle quelle ;
 * - une pièce d'origine encore CITÉE par un tag du nouveau texte reste au
 *   message, même si la liste reçue l'a oubliée — le texte et la liste ne se
 *   contredisent jamais (`shared/src/ancres.ts`).
 *
 * Le second ne joue que sur un tag qui porte l'ALIAS de la pièce
 * (« [fichier: image.png #f0da] ») : un tag d'avant, au seul nom, désigne
 * aussi bien un homonyme, et ne peut donc rien retenir de force.
 */
import { designationDePiece, type PieceJointeIdentifiee } from './alias-piece-jointe.js';
import { tagsDuTexte } from './ancres.js';

export function piecesApresModification(
  /** Les identifiants que le message portait, dans l'ordre. */
  idsDOrigine: readonly string[],
  /** Celles de ces pièces qui existent encore, avec leur nom et leur alias. */
  piecesDOrigine: readonly PieceJointeIdentifiee[],
  /** Le texte du message APRÈS la modification. */
  texte: string,
  /** Ce que l'écran demande ; absent, il n'a rien dit des pièces. */
  demandees?: readonly string[],
): string[] {
  if (!demandees) return [...idsDOrigine];
  const suite = [...new Set(demandees)];
  const cites = new Set(tagsDuTexte(texte).map((tag) => tag.nom));
  for (const piece of piecesDOrigine) {
    if (!piece.alias || suite.includes(piece.id)) continue;
    if (cites.has(designationDePiece(piece))) suite.push(piece.id);
  }
  return suite;
}
