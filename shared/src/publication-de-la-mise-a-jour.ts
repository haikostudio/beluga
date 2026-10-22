/**
 * LA MISE EN LIGNE DE LA SEULE TÂCHE DE MISE À JOUR DE BELUGA.
 *
 * Le bouton « Mettre à jour » de la page « Mise à jour » des réglages pose une
 * carte MARQUÉE (`card.miseAJourBeluga`) dans le projet de l'application et la
 * lance. Ce clic vaut le geste explicite de mise en ligne (MEM-2607) : quand
 * l'agent a rendu son travail SANS blocage, le démon publie cette carte, ET
 * ELLE SEULE — les autres cartes de « À déployer » attendent le clic de
 * l'utilisateur. Le redémarrage qui suit est retenu tant qu'un agent ou une
 * publication tourne (DEC-164, DEC-166).
 *
 * L'agent S'ARRÊTE sur une question au moindre heurt entre une nouveauté et
 * une personnalisation, ou si la construction ou les tests échouent : une
 * question sans réponse retient la carte, rien ne part.
 *
 * La décision est pure : le filet du démon
 * (`server/src/publication-de-la-mise-a-jour.ts`) lui apporte ce qu'il lit dans
 * la base, puis exécute ce qu'elle a tranché.
 */

import type { Card } from './models.js';
import { attenteApresEchec } from './deploiement-automatique.js';

/** Le titre de la tâche, tel qu'il paraît sur le tableau. */
export const TITRE_DE_LA_TACHE_DE_MISE_A_JOUR = 'Récupérer les nouveautés de Beluga Build';

/** Au-delà de ce nombre d'échecs de publication pour la même carte, le démon renonce. */
export const ECHECS_DE_LA_MISE_A_JOUR_AVANT_ABANDON = 3;

/** Les colonnes où la tâche de mise à jour est encore « en cours » pour l'écran. */
const COLONNES_OUVERTES = ['planned', 'running', 'to_deploy'] as const;

/** La carte est-elle la tâche de mise à jour de Beluga ? */
export function estLaTacheDeMiseAJour(card: Pick<Card, 'miseAJourBeluga'>): boolean {
  return card.miseAJourBeluga === true;
}

/**
 * La tâche de mise à jour encore OUVERTE parmi ces cartes — à lancer, au
 * travail, ou rendue et pas encore en ligne —, la plus récente d'abord.
 */
export function tacheDeMiseAJourOuverte<C extends Pick<Card, 'miseAJourBeluga' | 'column' | 'deployedAt' | 'createdAt'>>(
  cards: readonly C[],
): C | null {
  const ouvertes = cards.filter(
    (card) =>
      estLaTacheDeMiseAJour(card) &&
      (COLONNES_OUVERTES as readonly string[]).includes(card.column) &&
      !card.deployedAt,
  );
  return ouvertes.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
}

export interface EtatDeLaTacheDeMiseAJour {
  /** La carte est dans « À déployer », pas encore en ligne, ni exclue du lot. */
  prete: boolean;
  /** Une question sans réponse, une sous-tâche non faite ou une discussion rouverte la retient. */
  attendUneDecision: boolean;
  /** Des agents écrivent encore dans le dossier du projet : la publication serait refusée. */
  agentsAuTravail: number;
  /** Une publication tourne déjà sur le projet de l'application. */
  publicationEnCours: boolean;
  /** Combien de publications de CETTE carte ont échoué. */
  echecs: number;
  /** Quand la dernière a échoué, en millisecondes. */
  dernierEchecA?: number;
}

export interface DecisionDeLaMiseAJour {
  partir: boolean;
  raison: string;
  /** Le démon renonce : il ne réessaiera plus tout seul. */
  abandon?: boolean;
}

/**
 * La tâche de mise à jour doit-elle partir en ligne MAINTENANT ? Chaque refus
 * nomme ce qui retient, pour le journal du serveur.
 */
export function doitPublierLaMiseAJour(etat: EtatDeLaTacheDeMiseAJour, maintenant: number): DecisionDeLaMiseAJour {
  if (!etat.prete) return { partir: false, raison: 'la tâche de mise à jour n’est pas dans « À déployer »' };
  if (etat.attendUneDecision) return { partir: false, raison: 'la tâche de mise à jour attend une décision de l’utilisateur' };
  if (etat.publicationEnCours) return { partir: false, raison: 'une publication tourne déjà' };
  if (etat.agentsAuTravail > 0) {
    return { partir: false, raison: `${etat.agentsAuTravail} agent(s) travaillent encore dans le dossier` };
  }
  if (etat.echecs >= ECHECS_DE_LA_MISE_A_JOUR_AVANT_ABANDON) {
    return {
      partir: false,
      abandon: true,
      raison: `la mise en ligne de la mise à jour a échoué ${etat.echecs} fois : elle attend votre clic dans « À déployer »`,
    };
  }
  if (etat.echecs > 0) {
    const depuis = maintenant - (etat.dernierEchecA ?? 0);
    const attente = attenteApresEchec(etat.echecs);
    if (depuis < attente) {
      return { partir: false, raison: `échec n° ${etat.echecs} : nouvel essai dans ${Math.round((attente - depuis) / 1000)} s` };
    }
  }
  return { partir: true, raison: 'la tâche de mise à jour est rendue sans blocage : elle part seule' };
}

/** Ce qu'il faut savoir d'une publication passée pour compter les échecs d'une carte. */
export interface PublicationDUneCarte {
  state: string;
  cardIds: readonly string[];
  endedAt?: number;
  startedAt?: number;
}

/** Les échecs de publication qui portaient CETTE carte, et le plus récent. */
export function echecsDeLaCarte(runs: readonly PublicationDUneCarte[], cardId: string): { echecs: number; dernierEchecA?: number } {
  let echecs = 0;
  let dernierEchecA: number | undefined;
  for (const run of runs) {
    if (run.state !== 'failed' || !run.cardIds.includes(cardId)) continue;
    echecs += 1;
    const quand = run.endedAt ?? run.startedAt;
    if (quand !== undefined && (dernierEchecA === undefined || quand > dernierEchecA)) dernierEchecA = quand;
  }
  return { echecs, dernierEchecA };
}
