/**
 * « Où se prend cette décision ? »
 *
 * La ligne d'un projet annonçait « 4 décisions attendues de votre part » et
 * s'arrêtait là : rien sur le tableau, rien sur la conversation. Le chiffre
 * était juste, mais introuvable. Ce fichier ne recompte RIEN — le total reste
 * celui d'`attentionParProjet` — il dit seulement, pour chaque décision, à quel
 * endroit de l'écran elle doit se voir.
 *
 * Trois endroits, et trois seulement :
 *
 *  - la CARTE, quand la décision est née dans le travail d'une carte (une
 *    question posée par son agent) ;
 *  - la CONVERSATION, quand elle ne concerne aucune carte — une carte proposée
 *    n'existe pas encore, une question du chef d'orchestre non plus ;
 *  - le PROJET lui-même, quand la décision ne tient à aucun fil : une
 *    publication arrêtée avant d'envoyer sur le dépôt (`genre: 'envoi'`) se
 *    tranche dans le bloc de publication, qui n'appartient à aucun agent.
 *
 * Chaque décision est posée à UN seul de ces endroits : c'est ce qui garantit
 * que le compte annoncé sur le projet est exactement le nombre de repères
 * visibles. La règle vit ici, sans base ni réseau : elle se teste seule.
 */
import { DemandeEnAttente, demandeOuverte } from './attention.js';

/** Une décision attendue, et l'endroit d'où elle vient. */
export interface DecisionAttendue extends DemandeEnAttente {
  /**
   * La conversation où elle se prend. Absente pour une décision qui ne tient à
   * aucun fil — l'accord avant envoi, posé sur le projet.
   */
  agentId?: string;
  /** La carte concernée, quand la décision est née dans son travail. */
  cardId?: string;
  /** Quand la demande a été posée : la plus ancienne passe en premier. */
  poseeA?: number;
}

/** L'endroit où l'utilisateur doit être emmené pour trancher. */
export interface LieuDecision {
  projectId: string;
  /** Absent : la décision se prend sur le projet lui-même (bloc de publication). */
  agentId?: string;
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
 * et le total annoncé sur le projet ne collerait plus. Une décision sans agent
 * (l'accord avant envoi) ne se prend dans aucun fil : elle est ignorée ici.
 */
export function decisionsParConversation(decisions: DecisionAttendue[]): Record<string, number> {
  const compte: Record<string, number> = {};
  for (const decision of decisionsOuvertes(decisions)) {
    if (decision.cardId || !decision.agentId) continue;
    compte[decision.agentId] = (compte[decision.agentId] ?? 0) + 1;
  }
  return compte;
}

/**
 * Les décisions d'un projet qui se prennent dans une conversation, sans carte.
 * C'est ce que porte l'entrée « Chef » : on ne peut pas montrer un repère par
 * agent sur un onglet unique. Une décision sans agent n'y compte pas — elle se
 * voit dans le bloc de publication, pas dans un fil.
 */
export function decisionsHorsCarte(decisions: DecisionAttendue[], projectId: string): number {
  return decisionsOuvertes(decisions).filter((d) => !d.cardId && d.agentId && d.projectId === projectId).length;
}

/**
 * Les décisions d'un projet qui se prennent DANS SON BLOC DE PUBLICATION : ni
 * carte, ni conversation. Aujourd'hui l'accord avant envoi, et lui seul.
 */
export function decisionsDePublication(decisions: DecisionAttendue[], projectId: string): number {
  return decisionsOuvertes(decisions).filter((d) => d.genre === 'envoi' && d.projectId === projectId).length;
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
