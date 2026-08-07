/*
 * Reprendre une publication coupée par un redémarrage.
 *
 * Une publication « running » à l'extinction du démon n'est pas un échec : le
 * processus a disparu au milieu, comme pour un agent. On la RELANCE au démarrage
 * suivant, depuis le début de son étape et avec la même cible — mais une seule
 * fois de trop et l'on bouclerait à l'infini sur une coupure qui se répète. On
 * COMPTE donc les reprises, et au-delà d'un petit plafond l'échec reste et NOMME
 * la cause.
 *
 * Règle PURE, sans base ni disque : elle tranche à partir du seul nombre de
 * reprises déjà tentées, et vit ici pour être rejouable seule.
 */

/**
 * Nombre maximum de reprises AUTOMATIQUES d'une même publication. Au plus une :
 * une publication coupée repart une fois ; si cette reprise se fait couper à son
 * tour (deux coupures d'affilée), l'échec reste. Un plafond volontairement bas —
 * une coupure qui se répète cache un vrai problème, qu'on n'efface pas en
 * relançant sans fin.
 */
export const REPRISES_PUBLICATION_MAX = 1;

/** La cause écrite sur une publication abandonnée après trop de coupures. */
export function raisonAbandonReprise(reprises: number): string {
  return (
    `Publication interrompue par un redémarrage du serveur, puis reprise ${reprises} fois ` +
    `sans aboutir : abandonnée pour ne pas boucler. Relancez-la à la main quand la cause ` +
    `du redémarrage est écartée.`
  );
}

export type DecisionRepriseCoupure =
  | { reprendre: true; reprises: number }
  | { reprendre: false; erreur: string };

/**
 * Que faire d'une publication trouvée « running » au démarrage ?
 *
 * `dejaReprises` est le nombre de reprises déjà portées par la publication
 * coupée (0 pour une première coupure). Tant qu'il reste sous le plafond, on
 * REPREND — la nouvelle publication portera `reprises` = un de plus. Au plafond,
 * on ABANDONNE, en nommant la cause.
 */
export function decisionRepriseCoupure(dejaReprises: number): DecisionRepriseCoupure {
  const faites = Number.isFinite(dejaReprises) && dejaReprises > 0 ? Math.floor(dejaReprises) : 0;
  if (faites < REPRISES_PUBLICATION_MAX) {
    return { reprendre: true, reprises: faites + 1 };
  }
  return { reprendre: false, erreur: raisonAbandonReprise(faites) };
}
