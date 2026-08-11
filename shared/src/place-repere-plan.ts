/**
 * OÙ POSER LE REPÈRE DE PLAN SUR LA LIGNE D'UN PROJET.
 *
 * Le repère (l'icône du plan dans son badge blanc) vivait TOUJOURS à droite du
 * nom, où se pressent déjà la poignée, le repère d'attente et l'engrenage. À
 * gauche, en revanche, un emplacement dit déjà ce que fait le projet : le
 * dossier au repos, la roue quand un agent écrit, le nuage quand une
 * publication tourne (`RepereRobot`). Au repos, cet emplacement ne dit rien
 * qu'on ne sache déjà — le dossier, c'est « un projet ». Un plan qui attend une
 * décision, lui, mérite cette place.
 *
 * La règle tient donc en une phrase : le repère prend la place du dossier
 * quand elle est LIBRE, et retourne à droite quand la roue ou le nuage l'occupe
 * — un travail en cours ou une publication ne se cachent jamais derrière un
 * plan. Le signal ne disparaît donc dans aucun cas, il change seulement de
 * côté. La bordure blanche de la ligne, elle, ne bouge pas : elle s'ajoute à la
 * couleur d'état dans tous les cas.
 *
 * Pas de base, pas de disque, pas de navigateur : la règle se teste seule.
 */

/** Ce qu'il faut savoir de la ligne pour placer le repère. */
export interface EtatDeLaLignePourLePlan {
  /** Un plan proposé attend-il encore une décision sur ce projet ? */
  planEnAttente?: boolean;
  /** Nombre d'agents au travail sur ce projet (0 = aucun). */
  running?: number;
  /** Une publication est-elle en cours sur ce projet ? */
  publie?: boolean;
}

/** Les trois places possibles : nulle part, à gauche, ou à droite du nom. */
export type PlaceDuRepereDePlan = 'aucune' | 'gauche' | 'droite';

/**
 * La place du repère de plan sur la ligne d'un projet.
 *
 * « gauche » = à la place du dossier (ou de l'outil, pour l'espace de
 * développement) ; « droite » = à sa place historique, après le nom.
 */
export function placeDuRepereDePlan(etat: EtatDeLaLignePourLePlan): PlaceDuRepereDePlan {
  if (!etat.planEnAttente) return 'aucune';
  // L'emplacement de gauche est PRIS : la roue d'un agent au travail ou le
  // nuage d'une publication passent avant — ce sont des états en cours, pas une
  // décision qui peut attendre trois centimètres de plus.
  if (etat.publie || (etat.running ?? 0) > 0) return 'droite';
  return 'gauche';
}
