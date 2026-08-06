import fs from 'node:fs';
import path from 'node:path';
import {
  ERREURS_JOURNAL_MAX,
  ErreurInterface,
  ligneDeJournal,
  lireLigneDeJournal,
} from '@haikodev/shared';
import { PATHS } from './config.js';

/**
 * Le journal des erreurs de l'INTERFACE — celles qui se produisent dans le
 * navigateur, pas dans le démon.
 *
 * Il vit à côté des journaux d'agents (`data/logs/`), dans son propre fichier :
 * une erreur par ligne, en JSON, si bien qu'on peut le lire à l'œil ou le
 * relire par programme. Il ne grossit pas sans fin : au-delà de
 * `ERREURS_JOURNAL_MAX` lignes, les plus vieilles tombent.
 *
 * Aucune écriture ici ne doit faire tomber le démon : un disque plein ne vaut
 * pas la peine d'interrompre le travail en cours.
 */

const FICHIER = 'interface-erreurs.log';

function chemin(): string {
  return path.join(PATHS.logs, FICHIER);
}

/** Range une erreur reçue de la page. Rend faux si l'écriture a échoué. */
export function enregistrerErreurInterface(erreur: ErreurInterface): boolean {
  try {
    fs.mkdirSync(PATHS.logs, { recursive: true });
    fs.appendFileSync(chemin(), `${ligneDeJournal(erreur)}\n`);
    rangerLeJournal();
    return true;
  } catch {
    return false;
  }
}

/**
 * Les erreurs rangées, la plus RÉCENTE d'abord. Une ligne abîmée est sautée :
 * un journal à moitié écrit reste lisible.
 */
export function dernieresErreursInterface(limite: number): ErreurInterface[] {
  const lignes = lireLesLignes();
  const erreurs: ErreurInterface[] = [];
  for (let i = lignes.length - 1; i >= 0 && erreurs.length < limite; i--) {
    const erreur = lireLigneDeJournal(lignes[i]);
    if (erreur) erreurs.push(erreur);
  }
  return erreurs;
}

/** Combien d'erreurs le journal contient, sans toutes les mettre en forme. */
export function compterErreursInterface(): number {
  return lireLesLignes().length;
}

/** Le bouton « Tout effacer » : le fichier repart vide, il n'est pas supprimé. */
export function effacerErreursInterface(): boolean {
  try {
    if (fs.existsSync(chemin())) fs.writeFileSync(chemin(), '');
    return true;
  } catch {
    return false;
  }
}

function lireLesLignes(): string[] {
  try {
    if (!fs.existsSync(chemin())) return [];
    return fs.readFileSync(chemin(), 'utf8').split('\n').filter((ligne) => ligne.trim());
  } catch {
    return [];
  }
}

/** Au-delà du plafond, on réécrit le fichier avec les dernières lignes. */
function rangerLeJournal(): void {
  const lignes = lireLesLignes();
  if (lignes.length <= ERREURS_JOURNAL_MAX) return;
  try {
    fs.writeFileSync(chemin(), `${lignes.slice(-ERREURS_JOURNAL_MAX).join('\n')}\n`);
  } catch {
    /* un journal ne doit jamais faire tomber le démon */
  }
}
