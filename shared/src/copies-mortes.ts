/**
 * LES COPIES DE TRAVAIL MORTES : CELLES QUE `git worktree prune` NE VOIT PAS.
 *
 * Constat, sur le dépôt principal de Beluga Build (septembre 2026) : 1,3 Go de
 * dossiers sous `.worktrees/` qu'aucun `git worktree list` ne nommait plus. Un
 * `git worktree remove` coupé net, un `.git/worktrees/<nom>` effacé par une
 * réparation, un démon d'essai qui a rangé le dépôt sans ranger le disque : la
 * copie perd son inscription dans git, et git — qui ne range que ce qu'il
 * connaît — n'y touchera plus jamais. Personne ne les voit, rien ne les efface.
 *
 * Deux règles PURES ici, et un principe : RIEN NE S'EFFACE TOUT SEUL.
 *
 *  1. `copiesMortes` : parmi les dossiers du rangement des cartes, ceux que git
 *     ne liste plus. Un dossier encore inscrit n'est jamais « mort », même vide.
 *  2. `cheminNettoyable` : le nettoyage ne touche QUE ce qui est SOUS le dossier
 *     des copies du projet, et un seul étage dessous — jamais le dossier
 *     lui-même, jamais le dépôt, jamais un `..` qui remonterait ailleurs.
 *
 * Le démon (`copiesMortesDuProjet`, `nettoyerLesCopies`,
 * `server/src/dossier-de-carte.ts`) lit le disque, l'écran les liste dans les
 * réglages du projet, et seul un clic « Nettoyer » efface — puis
 * `git worktree prune` range ce que git gardait encore de ces copies.
 */

import { memeDossier } from './branche-de-carte.js';
import { DOSSIER_DES_CARTES } from './dossier-de-carte.js';

/** Une copie que git ne liste plus, telle que l'écran la présente. */
export interface CopieMorte {
  /** Le chemin absolu du dossier, tel qu'il sera passé au nettoyage. */
  chemin: string;
  /** Le nom du dossier seul, pour l'affichage. */
  nom: string;
  /** La taille APPROXIMATIVE sur le disque, en octets — ou rien si elle n'a pas pu être mesurée. */
  tailleOctets?: number;
  /** La date de dernière modification du dossier, en millisecondes. */
  modifieA?: number;
  /** La branche sur laquelle la copie était posée, quand on la retrouve encore. */
  branche?: string;
}

/** Le dossier des copies de ce projet : `<projet>/.worktrees`. */
export function racineDesCopies(racine: string): string {
  return `${(racine ?? '').trim().replace(/\/+$/, '')}/${DOSSIER_DES_CARTES}`;
}

/** Un chemin nettoyé de ses barres finales, sans rien résoudre. */
function propre(chemin: string | undefined | null): string {
  return (chemin ?? '').trim().replace(/\/+$/, '');
}

/**
 * LES COPIES MORTES : les dossiers présents sur le disque que git ne liste
 * plus. `presentes` sont les entrées trouvées sous le dossier des copies,
 * `ouvertes` ce que `git worktree list` rend. Une copie encore ouverte n'est
 * jamais rendue, quel que soit son état : c'est peut-être un agent au travail.
 */
export function copiesMortes<T extends { chemin: string }>(presentes: readonly T[], ouvertes: readonly string[]): T[] {
  return presentes.filter((copie) => !ouvertes.some((ouverte) => memeDossier(ouverte, copie.chemin)));
}

/**
 * CE CHEMIN PEUT-IL ÊTRE EFFACÉ PAR LE NETTOYAGE ?
 *
 * Oui seulement s'il est ABSOLU, sans segment vide ni « . » ni « .. », et
 * qu'il désigne un dossier posé DIRECTEMENT sous le dossier des copies du
 * projet. Tout le reste est refusé : le dossier des copies lui-même, le dépôt,
 * un chemin d'un autre projet, un chemin relatif, un chemin qui remonte.
 * Le nettoyage part d'une liste envoyée par le navigateur : c'est ici que le
 * démon refuse d'effacer ce qu'on ne lui a pas montré.
 */
export function cheminNettoyable(chemin: string | undefined | null, racineDesCopiesDuProjet: string): boolean {
  const cible = propre(chemin);
  const racine = propre(racineDesCopiesDuProjet);
  if (!cible || !racine) return false;
  if (!cible.startsWith('/') || !racine.startsWith('/')) return false;
  const segments = cible.split('/').slice(1);
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return false;
  if (!cible.startsWith(`${racine}/`)) return false;
  const reste = cible.slice(racine.length + 1);
  return reste.length > 0 && !reste.includes('/');
}

/**
 * LE TRI DU NETTOYAGE : ce qui part, ce qui est refusé et pourquoi. Une copie
 * encore ouverte dans git est refusée même si son chemin est bien formé — elle
 * n'est pas morte, et un agent y travaille peut-être.
 */
export function trierLeNettoyage(
  demandes: readonly string[],
  racineDesCopiesDuProjet: string,
  ouvertes: readonly string[],
): { aEffacer: string[]; refusees: { chemin: string; raison: string }[] } {
  const aEffacer: string[] = [];
  const refusees: { chemin: string; raison: string }[] = [];
  const vus = new Set<string>();
  for (const demande of demandes ?? []) {
    const chemin = propre(demande);
    if (!chemin || vus.has(chemin)) continue;
    vus.add(chemin);
    if (!cheminNettoyable(chemin, racineDesCopiesDuProjet)) {
      refusees.push({ chemin, raison: "ce chemin n'est pas une copie posée sous le dossier des copies du projet" });
      continue;
    }
    if (ouvertes.some((ouverte) => memeDossier(ouverte, chemin))) {
      refusees.push({ chemin, raison: 'cette copie est encore inscrite dans git : elle n’est pas morte' });
      continue;
    }
    aEffacer.push(chemin);
  }
  return { aEffacer, refusees };
}

/** La taille totale des copies mortes, pour la phrase d'en-tête. */
export function tailleDesCopies(copies: readonly { tailleOctets?: number }[]): number {
  return copies.reduce((total, copie) => total + (copie.tailleOctets ?? 0), 0);
}
