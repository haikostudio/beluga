/**
 * LA CONFIANCE D'UNE FICHE, MESURÉE SUR SON USAGE RÉEL.
 *
 * Un pool qui s'écrit tout seul fabrique de la dette s'il ne se nettoie jamais.
 * Quatre compteurs, et rien d'autre — tous constatés, aucun déclaré :
 *
 *   • SERVIE — la fiche est partie dans le contexte d'un agent ;
 *   • AIDÉE — l'agent a dit qu'elle lui avait servi (outil « competences »,
 *     action « retour ») ;
 *   • INUTILE — l'agent a dit qu'elle ne lui avait rien apporté ;
 *   • CONTREDITE — une carte a démenti ce qu'elle affirme.
 *
 * Le score monte à l'usage UTILE, descend aux contradictions, et ne bouge
 * presque pas tant que personne ne s'est prononcé : une fiche neuve n'est ni
 * bonne ni mauvaise, elle est neuve. C'est lui qui décide, seul, d'un
 * renforcement, d'une carte de correction ou d'un passage en dépréciée.
 *
 * Rien ici ne touche la base : les compteurs sont TENUS par le démon
 * (`server/src/competences.ts`), le score se calcule et se teste seul.
 */

/** Les compteurs d'une fiche, tels qu'ils vivent en base. */
export interface CompteursDeFiche {
  servie: number;
  aidee: number;
  inutile: number;
  contredite: number;
  /** Quand la fiche a été servie pour la dernière fois. */
  dernierService?: number;
}

export const COMPTEURS_VIDES: CompteursDeFiche = { servie: 0, aidee: 0, inutile: 0, contredite: 0 };

/**
 * LA CONFIANCE DE DÉPART, celle d'une fiche dont personne ne s'est encore
 * servi. Volontairement au milieu : le classement ne la favorise ni ne la
 * pénalise (`ajustementDeCompetence` est centré sur 0,5).
 */
export const CONFIANCE_NEUVE = 0.5;

/**
 * LA CONFIANCE DE DÉPART D'UNE FICHE IMPORTÉE d'une bibliothèque tierce. Elle
 * n'a été prouvée par AUCUN travail d'ici : elle part plus bas qu'une fiche
 * écrite par nos agents, et ne monte qu'avec les retours utiles.
 */
export const CONFIANCE_BIBLIOTHEQUE = 0.4;

/** Le point de départ de la confiance d'une fiche, selon qu'elle vient d'une bibliothèque ou de nos agents. */
export function confianceInitialeDeLaFiche(fiche: { bibliotheque?: string }): number {
  return fiche.bibliotheque ? CONFIANCE_BIBLIOTHEQUE : CONFIANCE_NEUVE;
}

/**
 * CE QUE PÈSE UNE CONTRADICTION. Beaucoup plus qu'un « ça ne m'a rien apporté » :
 * une fiche inutile fait perdre du contexte, une fiche fausse fait perdre une
 * journée — et, dans un pool partagé, elle la fait perdre à TOUS les projets.
 */
export const POIDS_CONTRADICTION = 3;

/**
 * L'INERTIE : combien d'avis « virtuels » neutres pèsent au départ. Sans elle,
 * un seul « ça m'a aidé » ferait bondir une fiche à 1,0 et un seul « inutile »
 * la tuerait. Trois avis réels suffisent alors à déplacer nettement le score.
 */
export const INERTIE = 2;

/**
 * LE SCORE, entre 0 et 1. C'est la part d'avis FAVORABLES, les contradictions
 * comptant triple du côté défavorable, lissée par l'inertie.
 */
export function confianceDeLaFiche(compteurs: CompteursDeFiche, depart = CONFIANCE_NEUVE): number {
  const pour = compteurs.aidee;
  const contre = compteurs.inutile + POIDS_CONTRADICTION * compteurs.contredite;
  const total = pour + contre;
  if (!total) return borner(depart);
  return borner((pour + INERTIE * depart) / (total + INERTIE));
}

function borner(valeur: number): number {
  return Math.min(1, Math.max(0, valeur));
}
