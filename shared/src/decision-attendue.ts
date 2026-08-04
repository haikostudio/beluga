/**
 * « Où se prend cette décision ? »
 *
 * La ligne d'un projet annonçait « 4 décisions attendues de votre part » et
 * s'arrêtait là : rien sur le tableau, rien sur la conversation. Le chiffre
 * était juste, mais introuvable. Ce fichier ne recompte RIEN — le total reste
 * celui d'`attentionParProjet` — il dit seulement, pour chaque décision, à quel
 * endroit de l'écran elle doit se voir.
 *
 * Deux endroits, et deux seulement :
 *
 *  - la CARTE, quand la décision est née dans le travail d'une carte (une
 *    question posée par son agent) ;
 *  - la CONVERSATION, quand elle ne concerne aucune carte — une carte proposée
 *    n'existe pas encore, une question du chef d'orchestre non plus.
 *
 * Chaque décision est posée à UN seul de ces endroits : c'est ce qui garantit
 * que le compte annoncé sur le projet est exactement le nombre de repères
 * visibles. La règle vit ici, sans base ni réseau : elle se teste seule.
 */
import { DemandeEnAttente, demandeOuverte } from './attention.js';

/** Une décision attendue, et l'endroit d'où elle vient. */
export interface DecisionAttendue extends DemandeEnAttente {
  /** La conversation où elle se prend. */
  agentId: string;
  /** La carte concernée, quand la décision est née dans son travail. */
  cardId?: string;
  /** Quand la demande a été posée : la plus ancienne passe en premier. */
  poseeA?: number;
}

/** L'endroit où l'utilisateur doit être emmené pour trancher. */
export interface LieuDecision {
  projectId: string;
  agentId: string;
  /** Absent : la décision se prend dans la conversation, sans carte. */
  cardId?: string;
}

/** Les décisions encore ouvertes, dans l'ordre où elles ont été posées. */
export function decisionsOuvertes(decisions: DecisionAttendue[]): DecisionAttendue[] {
  return decisions.filter(demandeOuverte).sort((a, b) => (a.poseeA ?? 0) - (b.poseeA ?? 0));
}

/**
 * Combien de décisions attend chaque CARTE — le triangle posé sur la carte du
 * tableau, et sur l'onglet « Conversation » de son tiroir.
 */
export function decisionsParCarte(decisions: DecisionAttendue[]): Record<string, number> {
  const compte: Record<string, number> = {};
  for (const decision of decisionsOuvertes(decisions)) {
    if (!decision.cardId) continue;
    compte[decision.cardId] = (compte[decision.cardId] ?? 0) + 1;
  }
  return compte;
}

/**
 * Combien de décisions attend chaque CONVERSATION, par agent. Seules celles qui
 * ne tiennent à aucune carte : sinon la même décision serait marquée deux fois,
 * et le total annoncé sur le projet ne collerait plus.
 */
export function decisionsParConversation(decisions: DecisionAttendue[]): Record<string, number> {
  const compte: Record<string, number> = {};
  for (const decision of decisionsOuvertes(decisions)) {
    if (decision.cardId) continue;
    compte[decision.agentId] = (compte[decision.agentId] ?? 0) + 1;
  }
  return compte;
}

/**
 * Les décisions d'un projet qui se prennent dans une conversation, sans carte.
 * C'est ce que porte l'entrée « Chef » : on ne peut pas montrer un repère par
 * agent sur un onglet unique.
 */
export function decisionsHorsCarte(decisions: DecisionAttendue[], projectId: string): number {
  return decisionsOuvertes(decisions).filter((d) => !d.cardId && d.projectId === projectId).length;
}

/**
 * Où emmener l'utilisateur quand il clique sur le triangle du projet : la plus
 * ANCIENNE décision en attente. La plus ancienne, et non la dernière arrivée :
 * c'est celle qui bloque depuis le plus longtemps.
 */
export function premiereDecision(
  decisions: DecisionAttendue[],
  projectId: string,
): LieuDecision | null {
  const premiere = decisionsOuvertes(decisions).find((d) => d.projectId === projectId);
  if (!premiere) return null;
  return { projectId: premiere.projectId, agentId: premiere.agentId, cardId: premiere.cardId };
}

/**
 * Le garde-fou de la promesse : « jamais quatre annoncés et rien de visible ».
 * Pour chaque projet, le nombre de repères réellement posés — cartes plus
 * conversations — doit valoir le compte annoncé sur sa ligne.
 */
export function reperesParProjet(decisions: DecisionAttendue[]): Record<string, number> {
  const compte: Record<string, number> = {};
  for (const decision of decisionsOuvertes(decisions)) {
    compte[decision.projectId] = (compte[decision.projectId] ?? 0) + 1;
  }
  return compte;
}
