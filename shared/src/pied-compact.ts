/**
 * LE PIED DE LA CONVERSATION SE REPLIE PAR ORDRE D'APPARITION, SUR TÉLÉPHONE
 * (demande du 22/10/2026). Déroulé du cahier ou du tournage, images vues par
 * l'agent, panneau de décision : collés sous le fil, ils finissaient par
 * manger l'écran. Quand leur hauteur dépasse la part qui leur est laissée, les
 * blocs se replient du plus ANCIEN au plus récent ; le DERNIER ouvert (par son
 * apparition ou par un appui) reste déplié, et un bloc replié se rouvre d'un
 * appui, qui en fait le dernier ouvert.
 *
 * Le calcul part des hauteurs MÉMORISÉES de chaque bloc (déplié, replié), pas
 * de la hauteur courante du pied : replier ne libère pas une place qui ferait
 * aussitôt tout rouvrir — aucun va-et-vient.
 */

export interface BlocDuPied {
  cle: string;
  /** Sa hauteur dépliée, en pixels (la dernière mesurée). */
  hauteurDepliee: number;
  /** Sa hauteur repliée, en pixels. */
  hauteurRepliee: number;
  /** Le panneau de décision compte dans la hauteur, mais ne se replie pas. */
  repliable: boolean;
}

/** Hauteur supposée d'un bloc replié dont on n'a encore rien mesuré. */
export const HAUTEUR_REPLIEE_PAR_DEFAUT = 44;

/** La part de la hauteur de l'écran laissée au pied, barre d'écriture non comprise. */
export const PART_DE_L_ECRAN_POUR_LE_PIED = 0.45;

/**
 * L'ORDRE D'OUVERTURE, TENU À JOUR : les blocs absents en sortent, les
 * nouveaux venus y entrent à la fin (dans l'ordre où ils sont rendus), et un
 * bloc rouvert par un appui (`rouvert`) passe en dernier.
 */
export function ordreDOuverture(avant: readonly string[], presents: readonly string[], rouvert?: string): string[] {
  const ordre = avant.filter((cle) => presents.includes(cle));
  for (const cle of presents) if (!ordre.includes(cle)) ordre.push(cle);
  if (rouvert && ordre.includes(rouvert)) {
    ordre.splice(ordre.indexOf(rouvert), 1);
    ordre.push(rouvert);
  }
  return ordre;
}

/**
 * LES BLOCS À REPLIER : on part de tout déplié, puis on replie du plus ancien
 * au plus récent tant que le total dépasse le budget. Le dernier ouvert parmi
 * les repliables ne se replie jamais ; un bloc non repliable compte sans bouger.
 */
export function blocsARepliers(blocs: readonly BlocDuPied[], ordre: readonly string[], budget: number): string[] {
  const parCle = new Map(blocs.map((bloc) => [bloc.cle, bloc]));
  const rangs = [...ordre.filter((cle) => parCle.has(cle)), ...blocs.map((b) => b.cle).filter((cle) => !ordre.includes(cle))];
  const repliables = rangs.filter((cle) => parCle.get(cle)!.repliable);
  const dernier = repliables[repliables.length - 1];
  let total = blocs.reduce((somme, bloc) => somme + bloc.hauteurDepliee, 0);
  const replies: string[] = [];
  for (const cle of repliables) {
    if (total <= budget) break;
    if (cle === dernier) break;
    const bloc = parCle.get(cle)!;
    const gain = bloc.hauteurDepliee - bloc.hauteurRepliee;
    if (gain <= 0) continue;
    replies.push(cle);
    total -= gain;
  }
  return replies;
}
