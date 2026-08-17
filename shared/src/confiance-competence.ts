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

/**
 * UNE FICHE SERVIE QUI N'AIDE JAMAIS PERSONNE. Servie dix fois sans un seul
 * retour utile, elle occupe une place dans chaque contexte pour rien : c'est un
 * signal à part, que le score seul ne donne pas (personne ne s'est prononcé
 * contre elle, personne ne s'est prononcé du tout).
 */
export const SERVICES_SANS_RETOUR_MAX = 10;

/** En dessous, la fiche ne mérite plus d'être servie comme une procédure. */
export const SEUIL_DEPRECIATION = 0.25;

/** En dessous, elle mérite une carte de correction — pas encore la dépréciation. */
export const SEUIL_CORRECTION = 0.4;

/** Au-dessus, et avec de l'usage, elle mérite d'être renforcée (détails, exemples). */
export const SEUIL_RENFORCEMENT = 0.75;

/** Ce que l'entretien de nuit doit faire d'une fiche. */
export type GesteDEntretien = 'rien' | 'renforcer' | 'corriger' | 'deprecier';

export interface DecisionDEntretien {
  geste: GesteDEntretien;
  raison: string;
}

/**
 * CE QU'ON FAIT D'UNE FICHE, à la lecture de ses seuls chiffres. Aucune de ces
 * décisions ne s'exécute toute seule : la nuit PROPOSE une carte (limite posée
 * par la carte), sauf la dépréciation, qui est un simple changement d'état — la
 * fiche reste lisible, elle cesse d'être servie comme une procédure sûre.
 */
export function decisionDEntretien(compteurs: CompteursDeFiche, confiance: number): DecisionDEntretien {
  if (compteurs.contredite > 0 && confiance < SEUIL_DEPRECIATION) {
    return {
      geste: 'deprecier',
      raison: `contredite ${compteurs.contredite} fois : confiance ${confiance.toFixed(2)}`,
    };
  }
  if (confiance < SEUIL_CORRECTION && compteurs.servie > 0) {
    return { geste: 'corriger', raison: `confiance ${confiance.toFixed(2)} : la fiche mérite une reprise` };
  }
  if (compteurs.servie >= SERVICES_SANS_RETOUR_MAX && compteurs.aidee === 0) {
    return {
      geste: 'corriger',
      raison: `servie ${compteurs.servie} fois sans qu'un seul agent l'ait dite utile`,
    };
  }
  if (confiance >= SEUIL_RENFORCEMENT && compteurs.aidee >= 3) {
    return { geste: 'renforcer', raison: `confiance ${confiance.toFixed(2)} sur ${compteurs.aidee} usages utiles` };
  }
  return { geste: 'rien', raison: 'rien à signaler' };
}

/**
 * UNE FICHE ÉPINGLÉE reste à faire : le favori est un privilège, donc il se
 * borne et il se mesure — ses usages devraient être comptés à part, sinon
 * l'épingle se justifie toute seule par le trafic qu'elle s'octroie. Rien n'est
 * posé ici tant que ce compteur séparé n'existe pas.
 */
export const FAVORI_NON_IMPLEMENTE = true;
