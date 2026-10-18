import { motsDeRecherche, racineDeMot } from './classeurs.js';

/**
 * UNE REDITE SE RECONNAÎT À SES MOTS. Le rangement de nuit recolle dans une
 * fiche les phrases d'une règle qu'elle ne porte pas ; une reformulation n'a
 * jamais de phrase jumelle exacte, alors on compare le VOCABULAIRE : la part des
 * mots significatifs d'un paragraphe (racinisés, noms de code et de fichier
 * compris, comptés comme des mots entiers) déjà présents dans le texte connu.
 */
export const SEUIL_DE_REDITE = 0.7;

/** Les racines des mots significatifs d'un texte, sans doublons. */
export function racinesSignificatives(texte: string): Set<string> {
  return new Set(motsDeRecherche(texte, 100_000).map(racineDeMot));
}

/**
 * Part (0 à 1) des racines du paragraphe déjà dans `connues`. Un paragraphe sans
 * mot significatif rend 0 : il n'est jamais pris pour une redite.
 */
export function recouvrementLexical(paragraphe: string, connues: Set<string>): number {
  const racines = racinesSignificatives(paragraphe);
  if (!racines.size) return 0;
  let presentes = 0;
  for (const r of racines) if (connues.has(r)) presentes++;
  return presentes / racines.size;
}

/** Vrai si l'essentiel du vocabulaire du paragraphe figure déjà dans le texte connu. */
export function estUneRedite(paragraphe: string, connues: Set<string>, seuil = SEUIL_DE_REDITE): boolean {
  return recouvrementLexical(paragraphe, connues) >= seuil;
}
