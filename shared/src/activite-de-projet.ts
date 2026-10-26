/**
 * CE QUI SE PASSE SUR UN PROJET, EN DEUX CHIFFRES — le compte des agents au
 * travail et la nature de ce qui attend l'utilisateur.
 *
 * La colonne de gauche les calculait seule, ligne par ligne. Les listes qui
 * servent à passer d'un projet à l'autre (le menu du fil d'Ariane, la fenêtre
 * « Changer de projet », les sélecteurs de Marketing et de Statistiques) les
 * montrent maintenant aussi : le calcul est donc écrit UNE fois, ici, pour
 * qu'aucune liste ne puisse dire autre chose que la colonne.
 *
 * Un projet réuni ne totalise PAS ses membres : ils sont listés sous lui avec
 * leurs propres chiffres, les additionner les compterait deux fois.
 *
 * Aucune base, aucun réseau : la règle se teste seule.
 */
import type { GenreDemande } from './attention.js';
import type { GesteAttendu } from './attente-de-geste.js';
import { iconeDuLot, type IconeDAttention } from './nature-attention.js';
import { agentAuTravailALEcran } from './travail-en-cours.js';

/** Ce que la règle lit d'un agent : le projet, et de quoi juger son tour. */
export interface AgentPourActivite {
  projectId?: string;
  role?: string;
  status?: string;
  tourVivantDepuis?: number;
  endedAt?: number;
  /** Un agent porté par un SERVICE de l'application n'est sur aucun projet : jamais compté. */
  service?: unknown;
}

/** Ce que la règle lit d'une décision : son projet, son état, sa nature. */
export interface DecisionPourActivite {
  projectId?: string;
  reglee?: boolean;
  genre: GenreDemande;
  geste?: GesteAttendu;
}

export interface ActiviteDeProjet {
  /** Les agents qui travaillent à l'écran sur ce projet. */
  enCours: number;
  /** La nature de ce qui attend l'utilisateur sur ce projet, ou rien. */
  attente: IconeDAttention | null;
}

/**
 * L'activité d'UN projet. `agents` est connu pour tous les projets dès
 * l'ouverture de l'application — les cartes, elles, ne sont chargées que pour
 * le projet ouvert : on part donc des agents et des décisions, jamais d'elles.
 */
export function activiteDeProjet(
  projectId: string,
  agents: readonly AgentPourActivite[],
  decisions: readonly DecisionPourActivite[],
): ActiviteDeProjet {
  return {
    enCours: agents.filter((a) => a.projectId === projectId && !a.service && agentAuTravailALEcran(a)).length,
    attente: iconeDuLot(decisions.filter((d) => d.projectId === projectId && !d.reglee)),
  };
}
