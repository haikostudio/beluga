/**
 * Le COMPTE RENDU d'un geste en lot, au pied d'une colonne.
 *
 * Un pied de colonne déplace les cartes cochées une par une. Certaines passent,
 * d'autres sont refusées par le serveur — la plus fréquente : « Tout lancer »
 * sur un projet où un agent travaille déjà, puisqu'une seule carte à la fois
 * peut tenir dans un dossier de travail (`porteDuDossier`). Sans compte rendu,
 * l'utilisateur voyait ses cartes partir puis revenir sans un mot.
 *
 * La règle est PURE : elle ne sait rien du réseau, elle met en mots un résultat
 * déjà connu. Deux principes tiennent tout :
 *   — on ne cache pas un refus : chaque carte refusée est NOMMÉE avec sa raison ;
 *   — on ne ment pas sur le compte : « 2 lancées, 1 en attente », jamais
 *     « lot terminé ».
 */

/** Une carte que le lot n'a pas pu déplacer, et pourquoi. */
export type RefusDeLot = {
  titre: string;
  /** Le message rendu par le serveur, tel quel. */
  raison?: string;
};

export type BilanDeLot = {
  niveau: 'success' | 'warning' | 'error';
  texte: string;
};

/** Ce qu'on dit quand le serveur refuse sans expliquer — cela ne devrait pas arriver. */
export const RAISON_SANS_MOT = 'refus sans explication';

/**
 * Au plus trois raisons dans le message : au-delà, la bulle deviendrait un mur.
 * Les autres cartes gardent la leur, écrite sur elles (`waitingReason`).
 */
export const RAISONS_AFFICHEES = 3;

const pluriel = (n: number) => (n > 1 ? 's' : '');

/**
 * Met en mots le résultat d'un lot.
 *
 * @param participe le participe passé FÉMININ du geste : « lancée », « validée »,
 *                  « déployée », « archivée » — il s'accorde avec « carte ».
 * @param faites    combien de cartes le serveur a acceptées.
 * @param refusees  les cartes refusées, dans l'ordre où elles ont été tentées.
 */
export function bilanDeLot(participe: string, faites: number, refusees: RefusDeLot[]): BilanDeLot {
  const refus = refusees ?? [];

  if (!refus.length) {
    return {
      niveau: 'success',
      texte: faites
        ? `${faites} carte${pluriel(faites)} ${participe}${pluriel(faites)}.`
        : 'Aucune carte à traiter.',
    };
  }

  const tete = faites
    ? `${faites} carte${pluriel(faites)} ${participe}${pluriel(faites)}, ${refus.length} en attente :`
    : // « Aucune carte » reste au SINGULIER, quel que soit le nombre de refus.
      `Aucune carte ${participe} — ${refus.length} en attente :`;

  const lignes = refus
    .slice(0, RAISONS_AFFICHEES)
    .map((r) => `• « ${r.titre} » — ${r.raison?.trim() || RAISON_SANS_MOT}`);

  const reste = refus.length - lignes.length;
  if (reste > 0) {
    lignes.push(`• et ${reste} autre${pluriel(reste)}, chacune avec sa raison écrite sur sa carte.`);
  }

  return {
    // Rien n'est passé : c'est un échec franc. Un lot partiel est un avertissement.
    niveau: faites ? 'warning' : 'error',
    texte: [tete, ...lignes].join('\n'),
  };
}
