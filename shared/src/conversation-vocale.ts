/**
 * LE MODE CONVERSATION VOCALE — parler, puis écouter la réponse.
 *
 * À CÔTÉ de l'écoute par mot de réveil « Dis Haiko » (`reveil-vocal.ts`), qui ne
 * bouge pas. Ici, un interrupteur distinct ouvre le micro pour de bon : on parle
 * SANS mot de réveil, une pause de silence clôt la phrase, elle part chez l'agent
 * (routage inchangé, `routage-vocal.ts`), et sa réponse est LUE à voix haute.
 * Reparler coupe cette réponse (le micro qui capte la voix fait taire le son).
 *
 * Ce fichier ne tient que les RÈGLES pures — sans micro, sans réseau, sans
 * navigateur : les constantes de découpe, et le choix de la réponse à lire. Le
 * micro et la boucle vivent côté navigateur (`web/src/lib/conversation-vocale.ts`).
 */

/**
 * La pause de silence, en millisecondes, après laquelle une phrase dite est
 * considérée finie et part à l'agent. Plus longue que la coupe du mot de réveil
 * (deux secondes) : en conversation, on laisse le temps de respirer entre deux
 * bouts de phrase avant d'envoyer.
 */
export const PAUSE_CONVERSATION_MS = 3000;

/**
 * Le volume (de 0 à 1) au-dessus duquel on considère que quelqu'un parle. Même
 * seuil que l'écoute par mot de réveil : assez haut pour ignorer le souffle
 * d'une pièce, assez bas pour entendre une phrase dite à un mètre.
 */
export const SEUIL_PAROLE_CONVERSATION = 0.06;

/** Où en est le mode conversation : éteint, à l'écoute, ou micro refusé. */
export type EtatConversation = 'eteinte' | 'ecoute' | 'refusee';

/** Un message réduit à ce qu'il faut pour choisir la réponse à lire à voix haute. */
export interface MessageLisible {
  role: string;
  content: string;
  createdAt: number;
  /** Vrai tant que l'agent écrit encore : on ne lit pas une réponse à moitié. */
  streaming?: boolean;
}

/**
 * La réponse de l'agent à lire à voix haute après une phrase dite en
 * conversation : le DERNIER message d'assistant, terminé et non vide, posté
 * APRÈS l'envoi (`depuis`). On écarte l'utilisateur, le système et les outils,
 * un message encore en cours d'écriture, et tout ce qui date d'avant la demande
 * — sinon on relirait une vieille réponse. Rien à lire → chaîne vide : l'appelant
 * ne prononce alors rien. Le nettoyage pour l'oreille reste à l'appelant
 * (`texteAEcouter`), qui n'a pas sa place dans une règle sans navigateur.
 */
export function reponseVocaleDeLAgent(messages: MessageLisible[], depuis: number): string {
  let choisi = '';
  let quand = depuis;
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    if (m.streaming) continue;
    if (m.createdAt <= depuis) continue;
    if (!m.content.trim()) continue;
    if (m.createdAt >= quand) {
      quand = m.createdAt;
      choisi = m.content;
    }
  }
  return choisi;
}
