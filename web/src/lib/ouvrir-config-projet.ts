import { RUBRIQUE_DEPLOIEMENT } from '@beluga/shared';
import { client } from '@/lib/client';

/**
 * OUVRIR LA CONFIGURATION D'UN PROJET, DEPUIS N'IMPORTE OÙ.
 *
 * La fenêtre est montée UNE fois, tout en haut de l'application, parce que
 * c'est là que vit l'adresse du navigateur : elle seule peut écrire
 * « #projet/<id>/config/<rubrique> » et la relire au rechargement.
 *
 * Trois endroits l'ouvrent, et aucun n'est son parent : la ligne d'un projet
 * dans la colonne de gauche, la tête de la colonne « À déployer », et le
 * bandeau de mise en production en bas du tableau. Un événement de fenêtre les
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
 * LES DEUX RACCOURCIS DES COLONNES. Celui du déploiement ouvre sa rubrique dans
 * la configuration du projet. Celui de la PRODUCTION ouvre le tiroir du bandeau
 * du bas, sur la conversation avec l'agent de configuration : c'est là que la
 * procédure s'écrit et se reprend (refonte du 24/09/2026).
 */
export function ouvrirRubriqueDeLEtape(projectId: string, cible: 'dev' | 'production'): void {
  if (cible === 'production') {
    client.demanderProduction({ projectId, onglet: 'conversation' });
    return;
  }
  ouvrirConfigProjet(projectId, RUBRIQUE_DEPLOIEMENT);
}
