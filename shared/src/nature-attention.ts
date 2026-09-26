/**
 * « QU'EST-CE QUI M'EST DEMANDÉ, AU JUSTE ? »
 *
 * Le triangle orange disait tout : une question posée, une carte à valider, et
 * maintenant un plan à générer. Trois demandes très différentes derrière le
 * même dessin — l'utilisateur devait ouvrir la carte pour savoir laquelle.
 *
 * Ce fichier pose LA table, une seule, qui associe à chaque nature d'attente
 * son icône et sa phrase. Trois écrans la lisent — la carte du tableau, la
 * ligne du projet dans la colonne de gauche, la ligne de la cloche — et c'est
 * précisément pour qu'aucun des trois ne puisse dire autre chose que les deux
 * autres qu'elle est unique.
 *
 * Aucune base, aucun réseau : la règle se teste seule.
 */
import type { GenreDemande } from './attention.js';
import type { GesteAttendu } from './attente-de-geste.js';

/** Ce qui est attendu, du point de vue de l'utilisateur. */
export type NatureDAttention =
  /** Un agent a posé une question : il faut lui répondre. */
  | 'question'
  /** Un plan attend d'être généré, ou validé. */
  | 'plan'
  /** Tout est prêt, la carte attend son départ. */
  | 'lancement'
  /** Une carte est proposée : à accepter ou à refuser. */
  | 'validation'
  /** Quelque chose est tombé : ce n'est pas une demande, c'est un incident. */
  | 'incident';

/**
 * LES TROIS DESSINS, ET PAS UN DE PLUS. Un signal ne se lit que s'il reste
 * rare : trois icônes se distinguent d'un coup d'œil sur une ligne de quelques
 * centimètres, six ne se distinguent plus.
 *
 *  - `message` : quelqu'un vous PARLE et attend votre réponse ;
 *  - `plan` : le PARCOURS de la carte attend votre geste (le même dessin que
 *    le repère de plan d'avant : `Route`) ;
 *  - `triangle` : ce qui BLOQUE — un incident, une validation à trancher.
 */
export type IconeDAttention = 'message' | 'plan' | 'triangle';

export const ICONE_PAR_NATURE: Record<NatureDAttention, IconeDAttention> = {
  question: 'message',
  plan: 'plan',
  lancement: 'plan',
  validation: 'triangle',
  incident: 'triangle',
};

/**
 * LA NATURE D'UNE DÉCISION, lue sur ce qu'elle porte déjà — son genre et, pour
 * une action, le geste attendu. Rien n'est deviné dans le texte.
 */
export function natureDeLAttention(decision: {
  genre: GenreDemande;
  geste?: GesteAttendu;
}): NatureDAttention {
  if (decision.genre === 'incident') return 'incident';
  if (decision.genre === 'validation') return 'validation';
  if (decision.genre === 'question') return 'question';
  return decision.geste === 'lancer' ? 'lancement' : 'plan';
}

/** L'icône d'une décision, en un pas : c'est ce que les trois écrans appellent. */
export function iconeDeLAttention(decision: { genre: GenreDemande; geste?: GesteAttendu }): IconeDAttention {
  return ICONE_PAR_NATURE[natureDeLAttention(decision)];
}

/**
 * L'ICÔNE D'UN LOT DE DÉCISIONS — ce qu'une carte du tableau ou une ligne de
 * projet montre quand plusieurs choses attendent en même temps.
 *
 * L'ordre est celui de l'EFFORT DEMANDÉ, le même que partout ailleurs : une
 * question bloque une personne, un geste de parcours attend seulement un clic.
 * La ligne garde donc son invariant — UN SEUL repère, la question devant
 * l'action — et ne se met jamais à porter deux dessins côte à côte.
 */
export function iconeDuLot(
  decisions: readonly { genre: GenreDemande; geste?: GesteAttendu }[],
): IconeDAttention | null {
  if (!decisions.length) return null;
  const natures = decisions.map(natureDeLAttention);
  if (natures.includes('question')) return 'message';
  if (natures.includes('validation')) return 'triangle';
  if (natures.includes('plan') || natures.includes('lancement')) return 'plan';
  return 'triangle';
}
