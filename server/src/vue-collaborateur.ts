/**
 * CE QU'UN MEMBRE OU UN LECTEUR VOIT ET PEUT DEMANDER, TRIÉ AU SERVEUR.
 *
 * Un collaborateur travaille dans l'application principale, mais seulement sur
 * les projets cochés dans son accès. Trois filtres, tous ici, tous AU SERVEUR :
 *  1. `refusDeLaCommande` — la commande est-elle ouverte à son niveau, et le
 *     projet qu'elle vise (retrouvé par la carte, l'agent, le message ou la
 *     file qu'elle nomme) est-il dans sa portée ? Un identifiant deviné ne mène
 *     nulle part : le refus dit la même chose qu'une commande qui n'existe pas ;
 *  2. `reponsePourLeCollaborateur` — une réponse qui liste plusieurs projets
 *     est ramenée à sa portée ;
 *  3. `evenementPourCollaborateur` — chaque événement diffusé à tous est jugé
 *     avant de partir : celui d'un projet hors portée ne part pas, le premier
 *     envoi (`ready`) et les compteurs sont réécrits sur sa portée, et tout ce
 *     qui est global (quotas, comptes, réglages, processus, coffre) est retiré.
 *
 * Les règles de forme (quelle commande, quel descripteur) vivent dans
 * `shared/src/droits-commandes.ts` ; ici, la base et la résolution.
 */
import {
  REFUS_HORS_PORTEE,
  Settings,
  commandeAutorisee,
  evenementAutorise,
  peutVoirProjet,
  viseurDeCommande,
  type ClientCommand,
  type CompteUtilisateur,
  type ServerEvent,
} from '@beluga/shared';
import { getDb } from './db.js';
import * as store from './store.js';

type Commande = ClientCommand & Record<string, unknown>;

/** Le projet d'un agent, ou `null` s'il n'existe plus. */
function projetDeLAgent(agentId: unknown): string | null {
  return typeof agentId === 'string' ? (store.getAgent(agentId)?.projectId ?? null) : null;
}

/** Le projet d'une carte, ou `null` si elle n'existe pas. */
function projetDeLaCarte(cardId: unknown): string | null {
  return typeof cardId === 'string' ? (store.getCard(cardId)?.projectId ?? null) : null;
}

/** Le projet d'un message d'agent, ou `null`. */
function projetDuMessage(messageId: unknown): string | null {
  if (typeof messageId !== 'string') return null;
  const message = store.getMessage(messageId);
  return message ? projetDeLAgent(message.agentId) : null;
}

/** Le projet d'un message en attente dans la file d'un agent, ou `null` s'il est déjà parti. */
function projetDeLaFile(id: unknown): string | null {
  if (typeof id !== 'string') return null;
  const ligne = getDb().prepare('SELECT agent_id FROM queue WHERE id = ?').get(id) as { agent_id: string } | undefined;
  return ligne ? projetDeLAgent(ligne.agent_id) : null;
}

/**
 * Les projets que vise une commande, d'après son descripteur. `null` : un des
 * éléments visés est introuvable — la commande est alors refusée, jamais devinée.
 */
export function projetsVisesParLaCommande(viseur: string, cmd: Record<string, unknown>): string[] | null {
  if (viseur === 'aucun') return [];
  const projets: string[] = [];
  for (const morceau of viseur.split('+')) {
    const [genre, champ] = morceau.split(':');
    const valeur = cmd[champ];
    if (genre === 'projet') {
      if (Array.isArray(valeur)) {
        for (const id of valeur) {
          if (typeof id !== 'string') return null;
          projets.push(id);
        }
      } else if (typeof valeur === 'string') projets.push(valeur);
      else return null;
      continue;
    }
    const trouve =
      genre === 'carte'
        ? projetDeLaCarte(valeur)
        : genre === 'agent'
          ? projetDeLAgent(valeur)
          : genre === 'message'
            ? projetDuMessage(valeur)
            : genre === 'file'
              ? projetDeLaFile(valeur)
              : null;
    if (!trouve) return null;
    projets.push(trouve);
  }
  return projets;
}

/**
 * LE REFUS D'UNE COMMANDE, ou `null` quand elle passe. Même phrase pour une
 * commande fermée, un projet hors portée et un élément qui n'existe pas.
 */
export function refusDeLaCommande(compte: CompteUtilisateur, commande: ClientCommand): string | null {
  if (compte.role === 'admin') return null;
  if (!commandeAutorisee(compte.role, commande.type)) return REFUS_HORS_PORTEE;
  // Mon compte n'a pas de descripteur : aucune de ses commandes ne nomme un autre compte.
  if (commande.type.startsWith('espace.moi')) return null;
  const viseur = viseurDeCommande(compte.role, commande.type);
  if (viseur === undefined) return REFUS_HORS_PORTEE;
  const cmd = commande as Commande;
  // Une carte ne change pas de projet par un simple « patch » : le déplacement a sa propre commande.
  if (commande.type === 'card.update') {
    const patch = (cmd.patch ?? {}) as Record<string, unknown>;
    if ('projectId' in patch || 'id' in patch) return REFUS_HORS_PORTEE;
  }
  const projets = projetsVisesParLaCommande(viseur, cmd);
  if (!projets) return REFUS_HORS_PORTEE;
  return projets.every((id) => peutVoirProjet(compte, id)) ? null : REFUS_HORS_PORTEE;
}

/** La réponse d'une commande, ramenée à la portée du compte quand elle liste plusieurs projets. */
export function reponsePourLeCollaborateur(compte: CompteUtilisateur, commande: ClientCommand, data: unknown): unknown {
  if (compte.role === 'admin') return data;
  if (commande.type === 'project.list' && data && typeof data === 'object') {
    const liste = (data as { projects?: unknown }).projects;
    if (Array.isArray(liste)) {
      return { ...data, projects: liste.filter((projet) => peutVoirProjet(compte, (projet as { id: string }).id)) };
    }
  }
  return data;
}

/** Un dictionnaire par projet (`attention.byProject`, `rendus.byProject`) ramené à la portée. */
function parProjet(compte: CompteUtilisateur, valeurs: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(valeurs).filter(([id]) => peutVoirProjet(compte, id)));
}

/** Le projet qu'un événement concerne, d'après son contenu. `undefined` : l'événement n'en nomme pas. */
function projetsDeLEvenement(event: ServerEvent): string[] | null | undefined {
  const e = event as Record<string, any>;
  switch (event.type) {
    case 'project.upsert':
      return [e.project.id];
    case 'project.delete':
    case 'project.archive':
      return [e.id];
    case 'project.etat':
    case 'card.delete':
    case 'card.lancement':
    case 'attachments':
    case 'files':
    case 'memory':
      return [e.projectId];
    case 'card.upsert':
      return [e.card.projectId];
    case 'card.deplacee':
      return [e.card.projectId, e.depuisProjectId];
    case 'agent.upsert':
      return [e.agent.projectId];
    case 'deploy.upsert':
      return [e.run.projectId];
    case 'agent.etat':
    case 'queue.etat': {
      const projet = projetDeLAgent(e.agentId);
      return projet ? [projet] : null;
    }
    case 'card.conversation':
    case 'carnet.lignes': {
      const projet = projetDeLaCarte(e.cardId);
      return projet ? [projet] : null;
    }
    case 'message.upsert': {
      const projet = projetDeLAgent(e.message.agentId);
      return projet ? [projet] : null;
    }
    case 'journal.entree': {
      const projet = projetDeLaCarte(e.entree.cardId);
      return projet ? [projet] : null;
    }
    default:
      return undefined;
  }
}

/**
 * L'ÉVÉNEMENT TEL QU'UN COLLABORATEUR LE REÇOIT, ou `null` s'il ne part pas.
 * Refus par défaut : un événement dont on ne sait pas dire le projet ne part pas.
 */
export function evenementPourCollaborateur(event: ServerEvent, compte: CompteUtilisateur): ServerEvent | null {
  if (!evenementAutorise(compte.role, event.type)) return null;
  switch (event.type) {
    case 'pong':
    case 'ack':
    case 'engines':
      return event;
    case 'ready': {
      const projets = event.projects.filter((projet) => peutVoirProjet(compte, projet.id));
      return {
        ...event,
        studioOuvert: false,
        // Aucun réglage général, aucune préférence d'un autre, aucun compte moteur ni ligne de quota.
        settings: Settings.parse({}),
        prefs: {},
        projects: projets,
        quotas: [],
        moteursAjoutes: undefined,
        agents: event.agents.filter((agent) => peutVoirProjet(compte, agent.projectId)),
        productions: event.productions?.filter((run) => peutVoirProjet(compte, run.projectId)),
        openedProjectId:
          event.openedProjectId && peutVoirProjet(compte, event.openedProjectId) ? event.openedProjectId : undefined,
      };
    }
    case 'attention':
      return {
        ...event,
        byProject: parProjet(compte, event.byProject),
        decisions: event.decisions.filter((decision) => peutVoirProjet(compte, decision.projectId)),
      };
    case 'rendus':
      return { ...event, byProject: parProjet(compte, event.byProject) };
    default: {
      const projets = projetsDeLEvenement(event);
      if (!projets || !projets.length) return null;
      // Une carte qui QUITTE un projet visible vers un projet caché : l'un des deux suffit à prévenir.
      const visible = event.type === 'card.deplacee' ? projets.some((id) => peutVoirProjet(compte, id)) : projets.every((id) => peutVoirProjet(compte, id));
      return visible ? event : null;
    }
  }
}
