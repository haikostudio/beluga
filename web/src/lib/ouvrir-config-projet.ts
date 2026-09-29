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
 * LA RUBRIQUE D'UNE ÉTAPE, OÙ VIT SON AGENT DE CONFIGURATION (29/09/2026).
 * Tous les boutons qui mènent à un agent de configuration passent par ici —
 * bandeau de mise en production, tête de « À déployer », vignette de l'agent
 * au travail, aiguillage des agents : la conversation et le processus qu'elle
 * a écrit vivent dans la rubrique de l'étape, jamais dans un volet à part.
 */
export function ouvrirRubriqueDeLEtape(projectId: string, cible: 'dev' | 'production'): void {
  ouvrirConfigProjet(projectId, cible === 'production' ? RUBRIQUE_PRODUCTION : RUBRIQUE_DEPLOIEMENT);
}
