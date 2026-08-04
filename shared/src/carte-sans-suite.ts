/**
 * « Cette carte est en cours depuis ce matin, et rien ne bouge. »
 *
 * Une carte reste en « En cours » tant qu'un tour ne l'a pas menée au bout.
 * C'est voulu : le tableau suit les étapes RÉELLES, et un tour qui n'a rien
 * modifié ne clôt rien. Mais entre « un agent travaille » et « le travail est
 * fini », il existe un troisième état que rien n'affichait : le tour s'est
 * achevé, aucun agent ne tourne, et personne ne l'a repris.
 *
 * Passé un délai, on l'écrit sur la carte. Pas une alerte de plus — la même
 * phrase discrète que « rien n'a changé », posée là où on cherche l'état de la
 * carte.
 *
 * La règle vit ici, sans base ni réseau : elle se teste seule.
 */

/** Une heure sans le moindre mouvement : au-delà, le tour n'a plus de suite. */
export const DELAI_SANS_SUITE = 60 * 60 * 1000;

/** Ce qu'il faut savoir d'une carte pour juger si elle est restée en plan. */
export interface CarteAJuger {
  /** La colonne du tableau. Seule « En cours » est concernée. */
  column: string;
  /** Quand le dernier agent de cette carte a rendu la main. */
  finDuDernierTour?: number;
  /** Un agent travaille-t-il en ce moment sur cette carte ? */
  agentActif?: boolean;
  /** Une question attend une réponse : c'est le triangle qui le dit, pas nous. */
  decisionEnAttente?: boolean;
}

/** Depuis combien de temps, en heures pleines, arrondi vers le bas. */
function heuresEcoulees(depuis: number, maintenant: number): number {
  return Math.floor((maintenant - depuis) / (60 * 60 * 1000));
}

/**
 * La phrase à afficher sur la carte, ou `null` quand il n'y a rien à dire.
 *
 * Quatre raisons de se taire, et elles comptent toutes : la carte n'est pas en
 * « En cours » (sa colonne dit déjà où elle en est), un agent travaille
 * dessus (la roue tourne), le dernier tour est trop récent (on ne signale pas
 * une pause de dix minutes), ou une décision attend déjà — le triangle orange
 * dit alors mieux que nous ce qui bloque, et deux repères pour une même carte
 * feraient du bruit sans rien apprendre.
 */
export function mentionSansSuite(carte: CarteAJuger, maintenant: number): string | null {
  if (carte.column !== 'running') return null;
  if (carte.agentActif) return null;
  if (carte.decisionEnAttente) return null;
  if (!carte.finDuDernierTour) return null;

  const heures = heuresEcoulees(carte.finDuDernierTour, maintenant);
  if (heures < 1) return null;

  if (heures < 24) {
    return `Tour terminé sans suite depuis ${heures} h — aucun agent ne travaille sur cette carte.`;
  }
  const jours = Math.floor(heures / 24);
  return `Tour terminé sans suite depuis ${jours} ${jours > 1 ? 'jours' : 'jour'} — aucun agent ne travaille sur cette carte.`;
}
