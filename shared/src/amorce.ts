/**
 * Amorcer la fenêtre de cinq heures des comptes Claude.
 *
 * Chez Claude, la fenêtre de cinq heures ne part qu'au PREMIER appel. Tant
 * qu'on n'a rien envoyé, le compteur reste à zéro et la fenêtre commencera au
 * moment où on en aura besoin — c'est-à-dire au pire moment. On envoie donc
 * une requête minuscule dès qu'une fenêtre est retombée à zéro, pour que le
 * décompte tourne déjà quand le travail arrive.
 *
 * La décision vit ici, sans réseau ni base : elle se teste seule.
 */

/** Durée d'une fenêtre Claude, utilisée quand l'heure de remise à zéro manque. */
export const DUREE_FENETRE_MS = 5 * 60 * 60 * 1000;

/** Ce que l'amorçage a besoin de savoir sur un compte. */
export interface EtatCompteAmorce {
  id: string;
  engine: string;
  /** Consommation de la fenêtre de cinq heures, en pour cent. */
  sessionPct?: number;
  /** Heure annoncée de remise à zéro de cette fenêtre. */
  resetsAt?: number;
  /** La dernière lecture de quota a échoué : les chiffres affichés sont périmés. */
  lectureEnEchec?: boolean;
  /** Un agent travaille en ce moment sur ce compte : la fenêtre est déjà lancée. */
  agentEnCours?: boolean;
  /** La dernière amorce posée sur ce compte, telle qu'on l'a retenue. */
  derniereAmorce?: AmorcePosee;
}

/** Une amorce déjà envoyée : quand, et jusqu'à quand elle couvre la fenêtre. */
export interface AmorcePosee {
  at: number;
  /** Instant à partir duquel la fenêtre amorcée est considérée comme terminée. */
  jusqua: number;
  model?: string;
}

export type RaisonAmorce =
  | 'a-amorcer'
  | 'autre-moteur'
  | 'lecture-en-echec'
  | 'fenetre-en-cours'
  | 'agent-en-cours'
  | 'fenetre-deja-amorcee';

/**
 * Faut-il amorcer ce compte maintenant ? Une seule réponse, et sa raison :
 * c'est elle qui part au journal quand rien n'est fait.
 */
export function decisionAmorce(etat: EtatCompteAmorce, maintenant: number): RaisonAmorce {
  if (etat.engine !== 'claude') return 'autre-moteur';
  // Une lecture ratée rejoue les derniers chiffres connus : agir dessus
  // reviendrait à amorcer sur une preuve qu'on n'a plus.
  if (etat.lectureEnEchec) return 'lecture-en-echec';
  // Un agent en train de travailler a forcément lancé la fenêtre lui-même.
  if (etat.agentEnCours) return 'agent-en-cours';
  // La fenêtre tourne déjà : le compteur a bougé.
  if ((etat.sessionPct ?? 0) > 0) return 'fenetre-en-cours';
  // Une amorce minuscule ne fait pas toujours bouger un compteur affiché à un
  // dixième près : c'est NOTRE trace qui empêche de recommencer, pas le
  // compteur. Elle tient jusqu'à la fin de la fenêtre amorcée.
  if (etat.derniereAmorce && maintenant < etat.derniereAmorce.jusqua) return 'fenetre-deja-amorcee';
  return 'a-amorcer';
}

/** Les comptes à amorcer, dans l'ordre reçu : ils seront traités un par un. */
export function comptesAAmorcer(etats: EtatCompteAmorce[], maintenant: number): EtatCompteAmorce[] {
  return etats.filter((etat) => decisionAmorce(etat, maintenant) === 'a-amorcer');
}

/**
 * Jusqu'à quand une amorce posée maintenant couvre la fenêtre. L'heure de
 * remise à zéro annoncée fait foi ; sans elle, on compte cinq heures.
 */
export function finDeFenetre(maintenant: number, resetsAt?: number): number {
  return resetsAt && resetsAt > maintenant ? resetsAt : maintenant + DUREE_FENETRE_MS;
}

/**
 * Le modèle le moins gourmand du catalogue : une amorce ne doit coûter que
 * quelques jetons. À défaut de catalogue, on ne devine pas — l'appelant garde
 * son repli.
 */
export function modeleLePlusLeger<T extends { id: string; appetite?: string }>(models: T[]): T | undefined {
  const rang = (m: T) => (m.appetite === 'light' ? 0 : m.appetite === 'medium' ? 1 : 2);
  // Le catalogue arrive déjà classé du plus récent au plus ancien : à appétit
  // égal, le premier trouvé est donc le plus récent.
  return [...models].sort((a, b) => rang(a) - rang(b))[0];
}
