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

/**
 * LE DOSSIER DÉPLIÉ NE REDIT PAS SES LIGNES (demande du 31/10/2026, captures #6eb6 et #5cd0) : la bulle et le signe
 * de travail résument un dossier, et ses tâches sont juste dessous. Ce résumé ne s'efface donc que s'il ne perd
 * RIEN : ce qui attend sans ligne (une conversation sans carte, une carte rangée) garde son signal. Un compte
 * d'attention sans décision connue (`attention`) le garde aussi : on ne cache pas ce qu'on ne sait pas situer.
 */
export function signauxSansLigne(
  projectId: string,
  agents: readonly (AgentPourActivite & { cardId?: string })[],
  decisions: readonly (DecisionPourActivite & { cardId?: string })[],
  cartesListees: ReadonlySet<string>,
  attention = 0,
): { attente: boolean; travail: boolean } {
  const ouvertes = decisions.filter((d) => d.projectId === projectId && !d.reglee);
  return {
    attente: (attention > 0 && !ouvertes.length) || ouvertes.some((d) => !d.cardId || !cartesListees.has(d.cardId)),
    travail: agents.some(
      (a) => a.projectId === projectId && !a.service && agentAuTravailALEcran(a) && (!a.cardId || !cartesListees.has(a.cardId)),
    ),
  };
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
