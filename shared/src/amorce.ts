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
 *
 * CODEX N'EST PAS CONCERNÉ, et ce n'est pas un oubli : essai fait sur le vrai
 * compte le 03/08/2026, une requête minuscule envoyée puis les compteurs
 * relus. Codex n'annonce qu'une seule fenêtre, celle de la semaine ; aucune
 * fenêtre courte n'apparaît ni avant ni après l'appel. Il n'y a donc rien à
 * amorcer de ce côté, et amorcer une fenêtre hebdomadaire n'aurait aucun sens.
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
  | 'heures-de-silence'
  | 'lecture-en-echec'
  | 'fenetre-en-cours'
  | 'agent-en-cours'
  | 'fenetre-deja-amorcee';

/**
 * Faut-il amorcer ce compte maintenant ? Une seule réponse, et sa raison :
 * c'est elle qui part au journal quand rien n'est fait.
 */
export function decisionAmorce(etat: EtatCompteAmorce, maintenant: number, silence = false): RaisonAmorce {
  // Seuls les comptes Claude ont une fenêtre de cinq heures qui s'amorce (voir
  // [[fenetre-codex]] : chez Codex, on n'a trouvé qu'une fenêtre hebdomadaire).
  if (etat.engine !== 'claude') return 'autre-moteur';
  // Pendant les heures de silence, on ne réveille personne : la nuit, la
  // dernière fenêtre amorcée a le temps de s'éteindre, et la reprise du matin
  // en rouvre une aussitôt.
  if (silence) return 'heures-de-silence';
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
export function comptesAAmorcer(
  etats: EtatCompteAmorce[],
  maintenant: number,
  silence = false,
): EtatCompteAmorce[] {
  return etats.filter((etat) => decisionAmorce(etat, maintenant, silence) === 'a-amorcer');
}

/**
 * Les heures de silence, telles qu'elles sont réglées pour les notifications :
 * une plage peut passer minuit (22 h → 7 h). Sans réglage, il n'y a pas de
 * silence du tout.
 */
export function dansLesHeuresDeSilence(heure: number, debut?: number, fin?: number): boolean {
  if (debut === undefined || fin === undefined) return false;
  return debut <= fin ? heure >= debut && heure < fin : heure >= debut || heure < fin;
}

/**
 * Combien d'échecs d'affilée sur le même compte avant de prévenir. Un refus
 * isolé arrive (jeton en cours de renouvellement) ; trois de suite veulent
 * dire que le compte ne répond plus.
 */
export const ECHECS_AVANT_ALERTE = 3;

/**
 * Faut-il prévenir maintenant ? Uniquement au franchissement du seuil : sans
 * cela, chaque passage enverrait une notification de plus.
 */
export function alerterApresEchec(echecsDAffilee: number): boolean {
  return echecsDAffilee === ECHECS_AVANT_ALERTE;
}

/**
 * Un refus 429 dit que le compte a atteint sa limite : une situation normale
 * et attendue, pas une panne. On le reconnaît sur le code que le fournisseur
 * renvoie, jamais sur un mot du message — c'est la seule marque fiable.
 */
export function estRefusDeSaturation(raison?: string): boolean {
  return !!raison && raison.includes('429');
}

/**
 * Le texte à montrer pour un échec d'amorce : le code technique du refus ne
 * parle à personne, « limite atteinte » si. Une vraie panne, elle, garde sa
 * raison telle quelle — c'est elle qu'on doit pouvoir diagnostiquer.
 */
export function texteEchecAmorce(raison: string): string {
  return estRefusDeSaturation(raison) ? 'limite atteinte' : raison;
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
