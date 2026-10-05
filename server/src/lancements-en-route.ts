/**
 * LES LANCEMENTS DE CARTE ENCORE EN PRÉPARATION.
 *
 * Entre le clic et le premier mot du moteur, il se passe des choses longues :
 * portes à franchir, copie de travail à ouvrir (`git worktree add`, parfois
 * plusieurs minutes sur un gros dépôt), branche à préparer, agent à créer.
 * Pendant toute cette fenêtre la carte est DÉJÀ en « En cours » — le clic l'y
 * pose tout de suite — mais aucun agent ne travaille encore, et aucun tour n'a
 * commencé.
 *
 * Ce registre est le seul témoin de cette fenêtre. Il sert à DEUX choses, et
 * c'est pour la seconde qu'il vit dans son propre fichier :
 *
 *  - empêcher l'ordonnanceur de lancer DEUX fois la même carte pendant que sa
 *    copie de travail s'ouvre encore (`startCard`) ;
 *  - empêcher le BALAYAGE DES CARTES OUBLIÉES de fermer une carte dont le
 *    lancement est simplement encore en route (`rangerLesCartesOubliees`).
 *
 * Le second lecteur est dans `deplacement-carte.ts`, que l'ordonnanceur
 * importe déjà : le registre ne peut donc pas vivre dans `scheduler.ts` sans
 * créer un cycle d'import. Il ne dépend, lui, de rien du démon.
 *
 * La marque est DATÉE, jamais éternelle : un lancement lui-même pendu ne doit
 * pas condamner sa carte pour toujours.
 */

import { PLAFOND_LANCEMENT_EN_ROUTE_MS, travailAbandonne } from '@beluga/shared';

const lancementsEnRoute = new Map<string, { depuis: number; projectId?: string }>();

/**
 * Le lancement de cette carte part maintenant. Le PROJET est noté avec elle :
 * une mise en ligne se refuse tant qu'un lancement est en préparation dans le
 * même dépôt (`lancementsEnRouteDuProjet`).
 */
export function marquerLancementEnRoute(cardId: string, projectId?: string): void {
  lancementsEnRoute.set(cardId, { depuis: Date.now(), projectId });
}

/** Le lancement de cette carte est fini — abouti ou refusé, peu importe. */
export function oublierLancementEnRoute(cardId: string): void {
  lancementsEnRoute.delete(cardId);
}

/**
 * Un lancement de cette carte est-il ENCORE en route, et assez récent pour
 * qu'on y croie ?
 *
 * Le plafond suit l'OUVERTURE DE LA COPIE DE TRAVAIL, pas le tour de boucle de
 * l'ordonnanceur : repris des cinq minutes de la boucle, il laissait relancer
 * la même carte pendant qu'un `git worktree add` de gros dépôt travaillait
 * encore.
 */
export function lancementEnRoute(cardId: string): boolean {
  const engage = lancementsEnRoute.get(cardId);
  if (engage === undefined) return false;
  return !travailAbandonne(Date.now() - engage.depuis, PLAFOND_LANCEMENT_EN_ROUTE_MS);
}

/**
 * Les cartes d'un projet dont le lancement est ENCORE en route (même plafond
 * daté : un lancement pendu ne retient pas la mise en ligne pour toujours).
 */
export function lancementsEnRouteDuProjet(projectId: string): string[] {
  return [...lancementsEnRoute.entries()]
    .filter(([cardId, engage]) => engage.projectId === projectId && lancementEnRoute(cardId))
    .map(([cardId]) => cardId);
}
