/**
 * QUAND UN AGENT PEUT-IL PARTIR AVEC L'OBJET QUI LE PORTAIT ?
 *
 * Certaines fiches du produit gardent le fil de la conversation qui les a
 * posées : une fiche de sauvegarde retient l'assistant qui l'a configurée, pour
 * qu'un clic rouvre ses essais et son compte rendu. Retirer la fiche retire
 * donc aussi ce fil — sinon les questions restées ouvertes allument un chiffre
 * sur la cloche pour un objet qui n'existe plus.
 *
 * LE PIÈGE, CONSTATÉ LE 09.09.2026. Ce fil n'est PAS toujours un assistant
 * jetable : c'est simplement l'agent QUI A APPELÉ L'OUTIL. Quand une carte
 * demande à son agent de tâche de corriger une fiche de sauvegarde, cet agent
 * devient le fil de la fiche. S'il retire ensuite une fiche en double — le
 * travail même qu'on lui a demandé —, il supprime SON PROPRE enregistrement,
 * en plein tour :
 *
 *   - la ligne de l'agent et TOUS ses messages disparaissent de la base ;
 *   - la fermeture du tour ne trouve plus rien à refermer et rend « false » ;
 *   - la veille des tours bloqués part de la table des agents : elle ne voit
 *     plus ce tour, donc aucun filet ne peut mordre ;
 *   - l'écran, lui, garde sa copie et continue d'afficher « Réflexion en
 *     cours » — 47 minutes sur le cas réel, sous un compte rendu déjà lu.
 *
 * La règle est donc : UNE SUPPRESSION EN CASCADE NE TOUCHE QU'UN AGENT
 * JETABLE. Elle est ici, pure et testable, plutôt que devinée à chaque appel.
 */

/** Ce qu'il faut savoir d'un agent pour décider s'il peut partir en cascade. */
export interface AgentASupprimer {
  /** La carte que cet agent sert, s'il en sert une. */
  cardId?: string;
  /** Son rôle : un agent de tâche ou de publication n'est jamais jetable. */
  role?: string;
  /** Son statut enregistré. */
  status?: string;
  /** Un tour vit-il encore sur cet agent (`Agent.tourVivantDepuis`) ? */
  tourVivantDepuis?: number;
  /** Le démon suit-il ce tour en mémoire, ici et maintenant ? */
  suivi?: boolean;
}

/** Pourquoi un agent ne part pas avec l'objet qui le portait. */
export interface RefusDeSuppression {
  raison: string;
}

/**
 * Cet agent peut-il être supprimé en même temps que l'objet qui le référence ?
 *
 * `null` : oui, rien ne s'y oppose. Sinon, la raison du refus, à écrire dans le
 * journal — un objet retiré ne doit JAMAIS être retenu par ce refus, c'est
 * seulement le fil de conversation qui reste en place.
 */
export function refusDeSupprimerLAgent(agent: AgentASupprimer): RefusDeSuppression | null {
  if (agent.cardId) {
    return { raison: "cet agent sert une carte : son fil ne part pas avec une fiche" };
  }
  if (agent.role === 'task' || agent.role === 'deploy') {
    return { raison: `un agent « ${agent.role} » n'est pas un fil d'assistant jetable` };
  }
  if (agent.tourVivantDepuis !== undefined || agent.suivi) {
    return { raison: 'un tour vit encore sur cet agent' };
  }
  if (agent.status === 'running' || agent.status === 'starting') {
    return { raison: 'cet agent est au travail' };
  }
  return null;
}
