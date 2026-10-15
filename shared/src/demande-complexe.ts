/*
 * UNE DEMANDE COMPLEXE ALLUME TOUTE SEULE LE « CAHIER DES CHARGES ».
 *
 * L'interrupteur de la barre d'écriture (`parcours.planSouhaite`, libellé
 * « Cahier des charges ») est éteint à la naissance d'une carte. Quand le
 * message envoyé au cadrage est manifestement un gros morceau — plusieurs
 * volets, une liste, un long texte, plusieurs pièces —, le démon l'allume de
 * lui-même et demande à l'agent de poser davantage de questions, pour que le
 * plan suive la TAILLE de la demande.
 *
 * Il ne l'allume qu'une fois et jamais contre un choix : un interrupteur déjà
 * touché à la main (`planSouhaite` défini, vrai ou faux) n'est plus réglé par
 * le démon.
 */

export interface JugementDeComplexite {
  complexe: boolean;
  /** Ce qui a fait pencher, en clair : pour l'infobulle et les contrôles. */
  raisons: string[];
}

/** Un texte au-delà duquel une demande est longue à elle seule. */
export const LONGUEUR_D_UNE_DEMANDE_COMPLEXE = 900;

const LIGNE_DE_LISTE = /^\s*(?:[-*•]|\d+[.)]|\(\d+\))\s+\S/gm;
const VOLET_NUMEROTE = /\(\d+\)\s/g;
const DEMANDES = /\b(?:il faut|faudrait|faut|j'aimerais|j’aimerais|je veux|je voudrais|ajoute[rz]?|mettre|afficher|doit|doivent|aussi)\b/gi;

/** Le corps d'un message, sans les étiquettes de pièces jointes. */
function corps(texte: string): string {
  return (texte ?? '').replace(/\[fichier:[^\]]*\]/g, ' ').trim();
}

export function jugerLaComplexite(texte: string, nombreDeJointes = 0): JugementDeComplexite {
  const brut = corps(texte);
  const raisons: string[] = [];
  const lignes = (brut.match(LIGNE_DE_LISTE) ?? []).length + (brut.match(VOLET_NUMEROTE) ?? []).length;
  const demandes = (brut.match(DEMANDES) ?? []).length;
  if (brut.length >= LONGUEUR_D_UNE_DEMANDE_COMPLEXE) raisons.push('longue demande');
  if (lignes >= 3) raisons.push(`${lignes} points listés`);
  if (demandes >= 5) raisons.push(`${demandes} souhaits exprimés`);
  if (nombreDeJointes >= 3) raisons.push(`${nombreDeJointes} pièces jointes`);
  // Un texte moyen qui porte déjà plusieurs souhaits et des pièces compte aussi.
  if (!raisons.length && brut.length >= 450 && demandes >= 3 && nombreDeJointes >= 1) raisons.push('plusieurs souhaits et des pièces');
  return { complexe: raisons.length > 0, raisons };
}

/** Le démon doit-il allumer l'interrupteur ? Jamais s'il a déjà été touché. */
export function allumerLeCahierToutSeul(planSouhaite: boolean | undefined, jugement: JugementDeComplexite): boolean {
  return planSouhaite === undefined && jugement.complexe;
}

/** La consigne jointe au tour de cadrage d'une demande complexe. */
export function consigneDeDemandeComplexe(jugement: JugementDeComplexite): string {
  return (
    `DEMANDE COMPLEXE (${jugement.raisons.join(', ')}) : le cahier des charges est allumé. ` +
    "Avant de cadrer, pose avec l'outil « ask_user » les questions qui tranchent les choix structurants — " +
    'une question par décision, deux à cinq au total, chacune avec ton option recommandée en premier — ; ' +
    "ne demande pas ce que tu peux trancher en lisant. Le plan suit ensuite la TAILLE de la demande : un volet par sujet, chacun avec ses étapes et sa vérification."
  );
}
