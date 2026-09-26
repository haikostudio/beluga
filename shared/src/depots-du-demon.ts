import { depotPrincipalDepuisMarqueur } from './racine-des-donnees.js';

/**
 * LES DÉPÔTS QU'UN DÉMON NE RANGE JAMAIS.
 *
 * Le ménage des copies de travail (`menageDesDossiers`, `nettoyerLesCopies`)
 * referme les dossiers de carte qu'aucun agent n'occupe. Un démon d'ESSAI —
 * ceux que montent les contrôles, levés depuis `<copie>/server/dist/main.js`
 * avec une base NEUVE — n'a aucun agent inscrit : à ses yeux, toutes les copies
 * sont orphelines. Et comme une base neuve adopte d'office les projets de
 * `/root` (`adoptServerProjects`), le dépôt PRINCIPAL en fait partie.
 *
 * Il faut donc épargner DEUX chemins, pas un :
 *
 *  1. la racine du démon lui-même — la copie, quand il tourne depuis une copie ;
 *  2. le dépôt PRINCIPAL dont cette copie dépend, lu dans le marqueur `.git`
 *     de la copie (jamais en lançant git).
 *
 * Le second manquait : un contrôle lancé par un agent refermait la copie de sa
 * propre carte — commit « tâche interrompue » et `git worktree remove --force`
 * compris — puis celles de toutes les autres cartes en cours. C'est arrivé deux
 * fois de suite sur `scripts/verif-erreurs-interface.mjs`.
 *
 * `marqueurGit` est le CONTENU du fichier `.git` de la racine quand c'en est un
 * fichier (donc une copie de travail) ; `null` pour un vrai dépôt.
 */
export function depotsQuUnDemonNeRangePas(racine: string, marqueurGit: string | null): string[] {
  const depots = [racine];
  if (!marqueurGit) return depots;
  const principal = depotPrincipalDepuisMarqueur(marqueurGit);
  if (principal && principal !== racine) depots.push(principal);
  return depots;
}
