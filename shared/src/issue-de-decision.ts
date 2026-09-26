/**
 * UNE ALERTE NE VAUT QUE PAR LE GESTE QU'ELLE OFFRE.
 *
 * `decisionOrpheline` (`decision-attendue.ts`) répond à une question : « le
 * LIEU existe-t-il encore ? ». Elle écarte ce dont la carte, le projet ou la
 * conversation a été supprimé. Elle ne dit rien du reste, et c'est là que le
 * triangle orange mentait : une décision peut nommer une carte bien vivante et
 * ne mener à AUCUN bouton — le message qui portait la question a disparu, la
 * décision ne dit même pas où elle se prend, ou sa source n'a jamais rendu de
 * geste.
 *
 * Ce fichier pose donc le critère qui manquait : CETTE DÉCISION OFFRE-T-ELLE
 * ENCORE UN GESTE ? Il ne remplace pas l'orpheline, il la prolonge —
 * l'orpheline couvre « le lieu a disparu », celui-ci couvre « le lieu est là,
 * mais il n'y a rien à y faire ».
 *
 * L'INVARIANT QUI TIENT TOUT : une décision annoncée NOMME LE MESSAGE où son
 * geste se prend. C'est ce qui permet à la fois de la juger ici et d'y conduire
 * l'utilisateur au clic — les deux faces d'une même exigence. Une décision qui
 * ne nomme aucun message est, par construction, une alerte qu'on ne peut pas
 * suivre : elle ne se compte plus.
 *
 * Aucune base, aucun disque : la règle se teste seule.
 */
import type { DecisionAttendue } from './decision-attendue.js';

/**
 * D'OÙ VIENT UNE DÉCISION. Cinq sources, et une seule table pour dire, pour
 * chacune, si l'écran rend vraiment un geste derrière. C'est cette table qu'on
 * complète le jour où une sixième source apparaît — plutôt qu'un `if` perdu
 * dans le calcul du serveur.
 */
export type SourceDeDecision =
  /** `ask_user` : le bouton « Répondre » (et « Annuler ») dans le fil. */
  | 'question-outil'
  /** Un compte à sec : le choix du compte avec lequel poursuivre. */
  | 'reprise-de-compte'
  /** Un tour tombé : « Relancer », « Ignorer », « Arrêter ». */
  | 'erreur-de-tour'
  /** Une question devinée dans du texte ordinaire : le bouton « Annuler ». */
  | 'question-en-texte'
  /** Une carte proposée : « Accepter » ou « Refuser ». */
  | 'carte-proposee'
  /**
   * UN GESTE ATTENDU PAR LE PARCOURS D'UNE CARTE : générer le plan, le
   * valider, lancer. Son bouton ne vit PAS dans une bulle du fil mais sur la
   * carte elle-même, collé au champ de saisie (`gesteDuParcours`).
   */
  | 'geste-de-parcours';

/**
 * Le geste rendu par chaque source. `false` — aucune aujourd'hui — voudrait
 * dire : l'écran affiche cette décision sans jamais offrir de bouton, elle ne
 * doit donc pas allumer d'alerte.
 */
export const GESTE_PAR_SOURCE: Record<SourceDeDecision, boolean> = {
  // Le bouton du parcours, sur la carte : toujours un geste, jamais un message.
  'geste-de-parcours': true,
  'question-outil': true,
  'reprise-de-compte': true,
  'erreur-de-tour': true,
  // Elle n'a pas de champ de réponse, mais elle a bien un geste : « Annuler »
  // (`question.cancelTexte`) éteint le repère. Elle reste donc actionnable.
  'question-en-texte': true,
  'carte-proposee': true,
};

/**
 * LES SOURCES DONT LE GESTE NE VIT PAS DANS UNE BULLE.
 *
 * L'invariant « une décision nomme le message où son geste se prend » vaut
 * pour tout ce qui se règle DANS LE FIL. Le parcours d'une carte, lui, pose
 * son bouton sur la carte : il n'y a aucun message à nommer, et exiger un
 * `messageId` reviendrait à ne jamais compter ces attentes. Ouvrir la carte
 * suffit à les atteindre.
 */
export const SOURCES_SANS_MESSAGE: ReadonlySet<SourceDeDecision> = new Set<SourceDeDecision>([
  'geste-de-parcours',
]);

/** Cette source laisse-t-elle l'utilisateur sans le moindre bouton ? */
export function sourceSansGeste(source?: SourceDeDecision): boolean {
  if (!source) return false;
  return GESTE_PAR_SOURCE[source] === false;
}

/** Ce qui existe encore, tel que l'appelant le connaît. Tout est facultatif :
 *  un appelant qui ne sait pas ne doit rien faire disparaître. */
export interface CeQuiExisteEncore {
  projets?: ReadonlySet<string>;
  cartes?: ReadonlySet<string>;
  agents?: ReadonlySet<string>;
  /** Les messages porteurs encore en base. Absent : on ne juge pas là-dessus. */
  messages?: ReadonlySet<string>;
}

/**
 * CETTE DÉCISION N'OFFRE PLUS AUCUN GESTE.
 *
 * Trois raisons, et trois seulement :
 *
 *  1. elle ne nomme AUCUN LIEU : ni carte, ni conversation. Rien à ouvrir ;
 *  2. elle ne nomme AUCUN MESSAGE PORTEUR, ou celui qu'elle nomme n'existe
 *     plus : le geste vit dans une bulle du fil, sans elle il n'y a rien à
 *     afficher ni où conduire ;
 *  3. sa source ne rend aucun bouton (`GESTE_PAR_SOURCE`).
 *
 * DEUX QUESTIONS QUI NE SONT PAS LA SIENNE, et qui ont déjà leur règle : le
 * LIEU DISPARU reste l'affaire de `decisionOrpheline`, et la décision DÉJÀ
 * RÉGLÉE celle de `decisionsOuvertes`. Une décision tranchée garde sa trace
 * dans la liste du serveur — c'est ainsi que la carte sait qu'on lui a répondu
 * — elle ne doit donc pas être jugée « sans issue » ici.
 */
export function decisionSansIssue(
  decision: DecisionAttendue,
  connu: CeQuiExisteEncore = {},
): boolean {
  if (!decision.cardId?.trim() && !decision.agentId?.trim()) return true;
  if (sourceSansGeste(decision.source)) return true;
  /* Son geste est sur la carte, pas dans une bulle : rien à nommer. */
  if (decision.source && SOURCES_SANS_MESSAGE.has(decision.source)) return false;
  const message = decision.messageId?.trim();
  if (!message) return true;
  return Boolean(connu.messages) && !connu.messages!.has(message);
}

/** Les décisions qui offrent encore un geste. Les autres n'alertent plus. */
export function decisionsAvecIssue(
  decisions: DecisionAttendue[],
  connu: CeQuiExisteEncore = {},
): DecisionAttendue[] {
  return decisions.filter((decision) => !decisionSansIssue(decision, connu));
}
