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
import { DemandeEnAttente, demandeAlerte, demandeOuverte } from './attention.js';
import type { SourceDeDecision } from './issue-de-decision.js';
import type { GesteAttendu } from './attente-de-geste.js';

/** Une décision attendue, et l'endroit d'où elle vient. */
export interface DecisionAttendue extends DemandeEnAttente {
  /** La conversation où elle se prend. */
  agentId?: string;
  /** La carte concernée, quand la décision est née dans son travail. */
  cardId?: string;
  /** Quand la demande a été posée : la plus ancienne passe en premier. */
  poseeA?: number;
  /**
   * Ce qui est demandé, en clair — le texte de la question ou le titre de la
   * carte proposée. Sert UNIQUEMENT à l'affichage (liste des questions en
   * attente) ; aucune des fonctions de ce fichier n'en dépend.
   */
  texte?: string;
  /** Le nom du projet, recopié pour l'affichage — sans lui, une liste globale ne dit rien. */
  projectName?: string;
  /** Le titre de la carte, ou le nom de la conversation quand il n'y en a pas. */
  lieuTitre?: string;
  /**
   * LE MESSAGE OÙ LE GESTE SE PREND. Une décision se règle TOUJOURS dans une
   * bulle du fil — un champ de réponse, trois issues, deux boutons de
   * validation. Sans cet identifiant, l'alerte ouvre bien un lieu mais laisse
   * chercher la question dans un fil long, et rien ne permet de dire qu'elle
   * mène encore quelque part (`issue-de-decision.ts`).
   */
  messageId?: string;
  /** D'où elle vient : c'est ce qui dit quel geste l'écran rend derrière. */
  source?: SourceDeDecision;
  /**
   * LE GESTE ATTENDU, quand la décision vient du parcours d'une carte. C'est
   * lui qui donne son ICÔNE au repère (`nature-attention.ts`) : générer un
   * plan et répondre à une question ne se signalent pas du même dessin.
   */
  geste?: GesteAttendu;
}

/** L'endroit où l'utilisateur doit être emmené pour trancher. */
export interface LieuDecision {
  projectId: string;
  /** Absent : la décision ne tient à aucune conversation. */
  agentId?: string;
  /** Absent : la décision se prend dans la conversation, sans carte. */
  cardId?: string;
  /**
   * Le message où le geste se prend. Le lieu ouvre la bonne carte ou le bon
   * fil ; celui-ci amène jusqu'à la BULLE, et l'entoure — sans lui, une
   * question posée il y a cent messages reste à chercher.
   */
  messageId?: string;
}

/** Les décisions encore ouvertes, dans l'ordre où elles ont été posées. */
export function decisionsOuvertes(decisions: DecisionAttendue[]): DecisionAttendue[] {
  return decisions.filter(demandeOuverte).sort((a, b) => (a.poseeA ?? 0) - (b.poseeA ?? 0));
}

/**
 * LES SEULES QUI ALLUMENT UN TRIANGLE : les questions et les validations. Un
 * incident (tour coupé par un quota, erreur qui a arrêté le travail) reste dans
 * la cloche et dans le fil de son agent — c'est là qu'on le règle — mais il ne
 * met plus le triangle orange sur une ligne de projet ni sur une carte, où il
 * se lisait « quelqu'un attend une réponse de vous ».
 */
export function decisionsQuiAlertent(decisions: DecisionAttendue[]): DecisionAttendue[] {
  return decisionsOuvertes(decisions).filter(demandeAlerte);
}

/**
 * Combien de décisions ALERTANTES par carte — le triangle posé sur la carte du
 * tableau. Volontairement plus étroit que `decisionsParCarte`, qui compte tout
 * et sert au démon (le balayage ne doit ranger AUCUNE carte qui attend encore,
 * incident compris).
 */
export function alertesParCarte(decisions: DecisionAttendue[]): Record<string, number> {
  const compte: Record<string, number> = {};
  for (const decision of decisionsQuiAlertent(decisions)) {
    if (!decision.cardId) continue;
    compte[decision.cardId] = (compte[decision.cardId] ?? 0) + 1;
  }
  return compte;
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
  return {
    projectId: premiere.projectId,
    agentId: premiere.agentId,
    cardId: premiere.cardId,
    messageId: premiere.messageId,
  };
}

/**
 * L'ALERTE ORPHELINE : UNE DÉCISION QUI NE MÈNE NULLE PART.
 *
 * Supprimer une carte n'efface que sa ligne : le fil de son agent, lui, reste
 * en base avec ses questions ouvertes et ses cartes proposées. Le compte des
 * décisions les ramassait encore — un triangle sur le projet, un chiffre sur la
 * cloche — et le clic n'ouvrait plus qu'un tiroir disant « Cette tâche n'existe
 * plus ». Rien à régler, rien à fermer : une alerte à vie.
 *
 * La règle est donc simple, et elle vaut pour les DEUX bouts du chemin : une
 * décision ne se compte que si l'endroit où on l'irait trancher existe encore —
 * son projet, sa carte quand elle en désigne une, et sa CONVERSATION quand elle
 * n'a que celle-là.
 *
 * LA CONVERSATION COMPTE AUTANT QUE LA CARTE. On la croyait toujours ouvrable,
 * et c'était vrai tant que seules les cartes disparaissaient. Mais un agent
 * s'efface aussi : l'assistant d'une fiche de sauvegarde s'en va avec sa fiche
 * (`supprimerSite`). Sa question restait alors comptée, sans carte pour la
 * rattraper et sans fil pour l'ouvrir — exactement l'alerte à vie que cette
 * règle existe pour empêcher. `agents` est FACULTATIF : un appelant qui ne
 * connaît pas la liste des conversations ne doit rien perdre.
 */
export function decisionOrpheline(
  decision: DecisionAttendue,
  connu: { projets?: ReadonlySet<string>; cartes: ReadonlySet<string>; agents?: ReadonlySet<string> },
): boolean {
  if (connu.projets && !connu.projets.has(decision.projectId)) return true;
  if (Boolean(decision.cardId) && !connu.cartes.has(decision.cardId as string)) return true;
  return Boolean(connu.agents) && Boolean(decision.agentId) && !connu.agents!.has(decision.agentId as string);
}

/**
 * UNE DÉCISION ANNONCÉE SE CLIQUE, MÊME SANS CARTE.
 *
 * La cloche ne rendait une ligne cliquable que si elle portait un PROJET, et le
 * routage n'ouvrait une conversation que si le projet ET l'agent étaient là. Or
 * beaucoup de décisions naissent hors carte — une question de l'assistant qui
 * configure une sauvegarde, une carte proposée par le chef, un tour coupé — et
 * l'annonce poussée ne porte alors qu'une conversation. La ligne s'affichait,
 * bien visible, et le clic ne faisait rien : une alerte qu'on ne peut pas
 * suivre est pire qu'une alerte absente.
 *
 * La règle : un lieu est atteignable dès qu'il nomme QUELQUE CHOSE — une carte,
 * une conversation, ou au moins un projet. Le projet manquant se retrouve à
 * partir de la carte ou de l'agent (`allerVersDecision`, côté client) ; c'est
 * un détail de routage, pas une raison d'éteindre le clic.
 */
export function lieuAtteignable(lieu: LieuDecision | { projectId?: string; cardId?: string; agentId?: string }): boolean {
  return Boolean(lieu.cardId?.trim() || lieu.agentId?.trim() || lieu.projectId?.trim());
}

/** Les décisions dont l'endroit existe encore. Les autres n'ont plus rien à dire. */
export function sansDecisionsOrphelines(
  decisions: DecisionAttendue[],
  connu: { projets?: ReadonlySet<string>; cartes: ReadonlySet<string>; agents?: ReadonlySet<string> },
): DecisionAttendue[] {
  return decisions.filter((decision) => !decisionOrpheline(decision, connu));
}
