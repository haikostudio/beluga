import { RUBRIQUE_DEPLOIEMENT, RUBRIQUE_PRODUCTION } from '@beluga/shared';

/**
 * OUVRIR LA CONFIGURATION D'UN PROJET, DEPUIS N'IMPORTE OÙ.
 *
 * La fenêtre est montée UNE fois, tout en haut de l'application, parce que
 * c'est là que vit l'adresse du navigateur : elle seule peut écrire
 * « #projet/<id>/config/<rubrique> » et la relire au rechargement.
 *
 * Plusieurs endroits l'ouvrent, et aucun n'est son parent : la ligne d'un
 * projet dans la colonne de gauche, la tête de la colonne « À déployer », le
 * bandeau de mise en production en bas du tableau, la vignette d'un agent de
 * configuration au travail. Un événement de fenêtre les
 * relie — même mécanique que `ouvrir-decisions.ts` — plutôt que de faire
 * traverser une fonction à trois composants qui n'ont rien à voir entre eux.
 */
export const EVENEMENT_CONFIG_PROJET = 'beluga:config-projet';

export type DemandeDeConfig = { projectId: string; rubrique?: string };

/** Ouvre la configuration d'un projet, sur la rubrique voulue s'il y en a une. */
export function ouvrirConfigProjet(projectId: string, rubrique?: string): void {
  window.dispatchEvent(
    new CustomEvent<DemandeDeConfig>(EVENEMENT_CONFIG_PROJET, { detail: { projectId, rubrique } }),
  );
}

/**
 * LA RUBRIQUE D'UNE ÉTAPE, OÙ SE LIT LE PROCESSUS DE SON AGENT (29/09/2026).
 * Le bandeau de mise en production et la tête de « À déployer » y mènent :
 * on y règle l'étape. L'AGENT lui-même s'ouvre dans son tiroir
 * (`ouvrirAgentDeConfiguration`), sans passer par cette fenêtre.
 */
export function ouvrirRubriqueDeLEtape(projectId: string, cible: 'dev' | 'production'): void {
  ouvrirConfigProjet(projectId, cible === 'production' ? RUBRIQUE_PRODUCTION : RUBRIQUE_DEPLOIEMENT);
}

export const EVENEMENT_AGENT_CONFIGURATION = 'beluga:agent-configuration';

export type DemandeDAgentDeConfiguration = { projectId: string; cible: 'dev' | 'production' };

/**
 * LE TIROIR DE L'AGENT DE CONFIGURATION D'UNE ÉTAPE, DEPUIS N'IMPORTE OÙ
 * (30/09/2026). Il est monté UNE fois, en haut de l'application : le bouton
 * d'en-tête des rubriques « Déploiement » et « Mise en production » l'ouvre
 * par-dessus la fenêtre de réglages, la vignette de l'agent au tableau et
 * l'aiguillage des agents (cloche, tableaux de bord) l'ouvrent seul, sans
 * fenêtre de réglages. Même mécanique d'événement que `ouvrirConfigProjet`.
 */
export function ouvrirAgentDeConfiguration(projectId: string, cible: 'dev' | 'production'): void {
  window.dispatchEvent(
    new CustomEvent<DemandeDAgentDeConfiguration>(EVENEMENT_AGENT_CONFIGURATION, { detail: { projectId, cible } }),
  );
}
