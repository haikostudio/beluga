/**
 * La mémoire du projet, côté RÈGLES.
 *
 * Les règles vivent PAR SUJET dans la base de connaissances (outil `memoire`).
 * Ce module découpe le texte d'un sujet en puces de règles et en lit les TITRES :
 * il sert au rangement de nuit des instructions (`fichesDeRegles`,
 * `classeurs.ts`). Il ne touche ni au disque ni à la base, il est donc lisible
 * et testable seul.
 */

import { SUJETS_MEMOIRE, type SujetMemoire } from './memoire.js';
import { slugEntier } from './slugs.js';


/** Les puces de règles (`- **…`) d'un texte, chacune avec son corps entier. */
export function decouperRegles(texte: string): string[] {
  const lignes = texte.split('\n');
  const regles: string[] = [];
  let courante: string[] | null = null;
  for (const ligne of lignes) {
    if (/^- \*\*/.test(ligne)) {
      if (courante) regles.push(courante.join('\n').trimEnd());
      courante = [ligne];
    } else if (courante) {
      courante.push(ligne);
    }
  }
  if (courante) regles.push(courante.join('\n').trimEnd());
  return regles;
}

/**
 * LE TITRE D'UNE RÈGLE : ce qui est écrit en gras en tête de sa puce. C'est le
 * nom sous lequel elle est listée quand un sujet est demandé, et celui qu'un
 * agent redonne pour la lire en entier. Une puce sans gras n'a pas de titre.
 */
export function titreDeRegle(regle: string): string {
  // Un titre long est parfois replié sur deux lignes dans le fichier : il
  // reste un seul titre, sur une seule ligne une fois lu.
  const trouve = /^-\s+\*\*([\s\S]+?)\*\*/.exec(regle.trim());
  return trouve?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
}


