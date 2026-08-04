/**
 * « L'agent attendait une réponse, et personne ne l'a su. »
 *
 * Un agent qui a besoin d'un arbitrage doit appeler l'outil `ask_user` : la
 * question est alors enregistrée, le triangle orange s'allume sur la carte, et
 * la réponse relance le tour. Mais rien n'oblige le moteur à s'en servir — il
 * lui suffit d'écrire sa question en TEXTE ORDINAIRE à la fin de sa réponse.
 * Le tour se termine alors normalement (code de sortie 0), aucune décision
 * n'est enregistrée, et la carte reste en « En cours » avec sa liste de tâches
 * inachevée : l'attente est invisible du tableau.
 *
 * On ne peut pas empêcher le moteur d'écrire ce qu'il veut. On peut, en
 * revanche, le RECONNAÎTRE : le dernier message d'un tour achevé qui se termine
 * sur une question adressée à l'utilisateur vaut une décision attendue, et
 * allume le même triangle que l'outil.
 *
 * La règle vit ici, sans base ni réseau : elle se teste seule.
 */

/** Le strict nécessaire pour juger : ce qu'un message porte de pertinent. */
export interface MessageAJuger {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  /** L'agent écrit-il encore ? Un message en cours ne se juge pas. */
  streaming?: boolean;
  /** Des questions posées par l'outil : le mécanisme prévu a servi. */
  questions?: unknown[];
  /** Des propositions en attente : elles comptent déjà comme décision. */
  proposals?: unknown[];
}

/**
 * Une question doit dire quelque chose. En dessous de cette longueur, on est
 * devant un « ok ? » de politesse ou une fin de phrase tronquée, pas devant un
 * arbitrage qui bloque le travail.
 */
export const LONGUEUR_MINIMALE = 20;

/** Au-delà, ce n'est plus une question mais un paragraphe qui finit mal. */
export const LONGUEUR_MAXIMALE = 400;

/**
 * Les tournures qui ne demandent RIEN : l'agent se parle à lui-même, ou
 * annonce ce qu'il va faire. Comparées sur le texte mis en minuscules et
 * débarrassé de ses accents.
 */
const TOURNURES_SANS_DEMANDE = [
  'que faire ensuite',
  'qu est-ce qui a change',
  'pourquoi cela',
  'est-ce vraiment le cas',
];

/** Minuscules, sans accents : pour comparer des tournures sans se tromper. */
function aplati(texte: string): string {
  return texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * La dernière phrase du texte : ce qui suit le dernier saut de ligne, puis le
 * dernier point ou point d'exclamation. Les marques de mise en forme
 * (**gras**, listes, citations) sont retirées — elles ne changent pas le sens
 * et fausseraient la lecture du dernier signe.
 */
function dernierePhrase(texte: string): string {
  const propre = texte
    .replace(/```[\s\S]*?```/g, ' ') // les blocs de code ne posent pas de question
    .replace(/[*_`>#]/g, '')
    .trim();
  const derniereLigne = propre.split(/\n+/).filter((l) => l.trim()).pop() ?? '';
  const morceaux = derniereLigne.split(/(?<=[.!])\s+/);
  return (morceaux.pop() ?? '').replace(/^[-–—•\d.)\s]+/, '').trim();
}

/**
 * Le dernier message d'un tour achevé pose-t-il une question restée sans
 * mécanisme ? On rend la question elle-même — c'est elle qu'on affichera —, ou
 * `null` quand il n'y a rien à trancher.
 *
 * Ce qui l'écarte, dans l'ordre : un message qui n'est pas de l'agent, un
 * message encore en cours d'écriture, un message qui porte DÉJÀ une question de
 * l'outil ou une proposition (la décision est comptée ailleurs, on ne la
 * doublerait pas), un texte qui ne finit pas par un point d'interrogation, et
 * enfin une question trop courte, trop longue ou purement rhétorique.
 */
export function questionEnTexteLibre(message: MessageAJuger): string | null {
  if (message.role !== 'assistant') return null;
  if (message.streaming) return null;
  if (message.questions?.length) return null;
  if (message.proposals?.length) return null;

  const phrase = dernierePhrase(message.content ?? '');
  if (!phrase.endsWith('?')) return null;
  if (phrase.length < LONGUEUR_MINIMALE || phrase.length > LONGUEUR_MAXIMALE) return null;

  const compare = aplati(phrase);
  if (TOURNURES_SANS_DEMANDE.some((t) => compare.startsWith(t))) return null;

  return phrase;
}

/** L'état d'un agent, réduit à ce qui dit s'il travaille encore. */
export type StatutAgent = 'idle' | 'starting' | 'running' | 'stopped' | 'failed' | 'done';

/** Un agent au travail : son dernier message n'est pas le mot de la fin. */
export function agentAuTravail(statut: StatutAgent | undefined): boolean {
  return statut === 'starting' || statut === 'running';
}

/**
 * Le tour est-il ACHEVÉ sur cette question ? Deux conditions, toutes deux
 * nécessaires : l'agent ne travaille plus, et le message jugé est bien le
 * DERNIER de la conversation. Un message plus récent — la réponse de
 * l'utilisateur, ou la suite du travail — règle la question de fait : on ne
 * garde pas un triangle allumé sur un échange déjà repris.
 */
export function decisionEnTexteLibre(entree: {
  statut?: StatutAgent;
  dernierMessage?: MessageAJuger;
}): string | null {
  if (agentAuTravail(entree.statut)) return null;
  if (!entree.dernierMessage) return null;
  return questionEnTexteLibre(entree.dernierMessage);
}
