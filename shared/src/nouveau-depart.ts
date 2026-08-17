/**
 * Repartir de zéro dans une conversation.
 *
 * Le chef d'orchestre garde une conversation qui ne meurt jamais : chaque
 * message renvoie tout le fil au moteur, donc la réponse est de plus en plus
 * lente et de plus en plus chère. Le nouveau départ coupe ce fil.
 *
 * RIEN N'EST SUPPRIMÉ. On pose simplement un repère dans le temps : les
 * messages plus anciens sortent de la vue (et du contexte envoyé au moteur),
 * mais restent consultables d'un clic. Une conversation effacée par erreur ne
 * se rattrape pas ; une conversation mise de côté, si.
 *
 * Les décisions vivent ici, sans base ni réseau : elles se testent seules.
 */

import { temoinDeTravail, type StatutDAgentSuivi } from './travail-en-cours.js';

/** Le repère de nouveau départ, retenu agent par agent. */
export const cleNouveauDepart = (agentId: string): string => `chat.depart.${agentId}`;

/** Le strict minimum dont ces règles ont besoin d'un message. */
export interface MessageDatable {
  createdAt: number;
  streaming?: boolean;
}

/** Le strict minimum dont ces règles ont besoin d'un agent. */
export interface AgentOccupable {
  status?: string;
  /** L'instant de la dernière fin de tour : il démasque une écriture orpheline. */
  endedAt?: number;
  /** Un tour vit-il encore ? (`Agent.tourVivantDepuis`) — le signal le plus direct. */
  tourVivantDepuis?: number;
}

export interface Verdict {
  /** Vrai si le bouton peut agir. */
  ok: boolean;
  /** Pourquoi il ne peut pas, dit simplement. Vide quand c'est possible. */
  raison: string;
}

/**
 * Peut-on repartir de zéro maintenant ?
 *
 * Jamais pendant un tour : couper le fil sous un agent qui travaille lui ferait
 * perdre le fil de sa propre réponse. Jamais non plus sur une conversation déjà
 * neuve, sinon le bouton ne ferait rien tout en promettant quelque chose.
 */
export function peutRepartir(agent: AgentOccupable | null | undefined, messages: MessageDatable[]): Verdict {
  if (!agent) return { ok: false, raison: "La conversation n'est pas encore ouverte." };
  // Un message resté marqué « en écriture » alors que le tour est refermé depuis
  // ne bloque plus rien : c'est l'AGENT qui fait foi (`temoinDeTravail`).
  if (
    temoinDeTravail({
      statut: agent.status as StatutDAgentSuivi | undefined,
      tourVivantDepuis: agent.tourVivantDepuis,
      finDuTour: agent.endedAt,
      messageEnEcritureA: messages.find((m) => m.streaming)?.createdAt,
    })
  ) {
    return { ok: false, raison: "Le chef d'orchestre travaille : attendez la fin de sa réponse." };
  }
  if (!messages.length) return { ok: false, raison: 'Cette conversation est déjà neuve.' };
  return { ok: true, raison: '' };
}

/**
 * Les messages visibles depuis le dernier départ. Un repère absent (ou farfelu)
 * rend le fil entier : mieux vaut trop montrer que faire disparaître un
 * historique par accident.
 */
export function messagesDepuis<T extends MessageDatable>(messages: T[], depuis: unknown): T[] {
  const repere = typeof depuis === 'number' && Number.isFinite(depuis) && depuis > 0 ? depuis : 0;
  if (!repere) return messages;
  return messages.filter((m) => m.createdAt >= repere);
}

/**
 * Ce qu'un agent doit OUBLIER quand son fil est coupé.
 *
 * Couper le fil ne suffisait pas : la session du moteur partait bien, mais
 * l'agent gardait la MESURE de son contexte (le composeur affichait encore
 * « 9 % » au-dessus d'une conversation vide), son état de remplissage — armé,
 * compressions comptées — et surtout son RÉSUMÉ DE CONTINUITÉ, que le tour
 * suivant renvoyait au moteur. Un départ à zéro qui réexpédie un résumé du fil
 * d'avant n'est pas un départ à zéro.
 *
 * Ces trois-là s'effacent donc ensemble, avec l'avancement d'une liste de
 * tâches qui ne décrit plus rien. Le reste de l'agent — réglages, compte,
 * carte, identité — ne bouge pas : on remet à zéro une conversation, pas un
 * agent.
 */
export interface AgentAOublier {
  contextUsage?: unknown;
  context?: unknown;
  todos?: unknown;
}

export function agentApresNouveauDepart<T extends AgentAOublier>(agent: T): T {
  return { ...agent, contextUsage: undefined, context: undefined, todos: undefined };
}

/** Combien d'échanges sont mis de côté par le repère. */
export function comptePrecedents(messages: MessageDatable[], depuis: unknown): number {
  return messages.length - messagesDepuis(messages, depuis).length;
}

/** Ce que dit le lien qui rouvre les échanges d'avant. */
export function libellePrecedents(nombre: number): string {
  if (nombre <= 0) return '';
  return nombre === 1 ? 'Voir le message précédent' : `Voir les ${nombre} messages précédents`;
}
