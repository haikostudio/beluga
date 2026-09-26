/**
 * OÙ VIT LE FICHIER D'UNE PIÈCE JOINTE.
 *
 * Un seul endroit décide du nom sur le disque, pour que le dépôt, la lecture
 * et le prompt ne puissent jamais diverger. Le nom commence par l'ALIAS COURT
 * de la pièce (`shared/src/alias-piece-jointe.ts`) ; les pièces déposées AVANT
 * cette mécanique n'en ont pas et gardent leur nom d'origine, bâti sur leur
 * identifiant entier — leurs fichiers ne sont pas renommés, donc on retombe
 * toujours sur l'ancien nom si le nouveau n'est pas là.
 *
 * DEUX DOSSIERS, UN SEUL CHOIX D'ÉCRITURE. Les vidéos pèsent jusqu'à 2 Go : les
 * pièces jointes s'écrivent donc sur le DISQUE DE STOCKAGE
 * (`PATHS.attachmentsStockage`, un montage réseau de 1 To) dès qu'il est là, et
 * l'ancien dossier (`PATHS.attachments`, sur le disque système) reste LU en
 * repli. Le disque ne compte comme « là » que s'il porte le fichier témoin
 * `MARQUEUR_STOCKAGE` : un montage tombé laisse un dossier vide sur le disque
 * système, où il ne faut surtout pas se mettre à écrire des gigaoctets.
 */
import fs from 'node:fs';
import path from 'node:path';
import { nomSurDisque, type PieceJointeIdentifiee } from '@beluga/shared';
import { PATHS } from './config.js';
import { log } from './logger.js';

/** Le fichier témoin posé par `scripts/transferer-pieces-jointes.mjs`. */
export const MARQUEUR_STOCKAGE = '.beluga-pieces-jointes';

/** Le témoin se relit au plus toutes les 30 s : un montage réseau répond lentement. */
const RELECTURE_MS = 30_000;
let dernierConstat: { a: number; present: boolean } | null = null;

function stockagePresent(): boolean {
  const dossier = PATHS.attachmentsStockage;
  if (!dossier) return false;
  const maintenant = Date.now();
  if (dernierConstat && maintenant - dernierConstat.a < RELECTURE_MS) return dernierConstat.present;
  let present = false;
  try {
    present = fs.statSync(path.join(dossier, MARQUEUR_STOCKAGE)).isFile();
  } catch {
    present = false;
  }
  if (dernierConstat && dernierConstat.present !== present) {
    if (present) log.info('pieces-jointes', `disque de stockage de retour : ${dossier}`);
    else log.warn('pieces-jointes', `disque de stockage absent (${dossier}) : écriture dans ${PATHS.attachments}`);
  }
  dernierConstat = { a: maintenant, present };
  return present;
}

/** Le dossier où S'ÉCRIT une nouvelle pièce jointe (créé s'il manque). */
export function dossierDEcriture(): string {
  if (stockagePresent()) return PATHS.attachmentsStockage;
  fs.mkdirSync(PATHS.attachments, { recursive: true });
  return PATHS.attachments;
}

/** Les dossiers où une pièce jointe peut se LIRE, le disque de stockage d'abord. */
export function dossiersDeLecture(): string[] {
  return stockagePresent() ? [PATHS.attachmentsStockage, PATHS.attachments] : [PATHS.attachments];
}

export function cheminDePieceJointe(piece: PieceJointeIdentifiee): string {
  const noms = [nomSurDisque(piece), `${piece.id}-${piece.name}`];
  const dossiers = dossiersDeLecture();
  for (const dossier of dossiers) {
    for (const nom of noms) {
      const chemin = path.join(dossier, nom);
      if (fs.existsSync(chemin)) return chemin;
    }
  }
  return path.join(dossiers[0]!, noms[0]!);
}

/**
 * LES DOSSIERS DE DONNÉES OUVERTS À TOUT TOUR DE MOTEUR, quel que soit le
 * projet travaillé.
 *
 * Le stockage des pièces jointes est CENTRAL : un seul dossier
 * (`PATHS.attachments`, sous `BELUGA_DATA`) pour tous les projets, hors de tout
 * dépôt, pour qu'une image survive à un changement de branche comme à une
 * publication. Conséquence : il tombe HORS du dossier de travail de l'agent
 * partout sauf sur Beluga Build lui-même. Sans l'ouvrir explicitement, Claude
 * Code réclame une permission que personne ne donne dans un tour non
 * interactif, et l'image jointe au prompt reste illisible — c'est ce que
 * disaient les journaux après la migration de serveur : « Claude requested
 * permissions to read from /root/beluga/data/attachments/…, but you haven't
 * granted it yet ».
 *
 * Le disque de stockage, quand il est là, est ouvert AUSSI : c'est là que
 * vivent désormais les fichiers.
 *
 * Le dossier est créé s'il manque : un moteur n'ouvre pas un chemin absent.
 */
export function dossiersDeDonneesOuverts(): string[] {
  fs.mkdirSync(PATHS.attachments, { recursive: true });
  return stockagePresent() ? [PATHS.attachments, PATHS.attachmentsStockage] : [PATHS.attachments];
}
