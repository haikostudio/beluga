/**
 * L'ORDRE QUE L'UTILISATEUR RÈGLE DANS « COMPTES ET QUOTAS ».
 *
 * Deux listes, réglées par des flèches : celle des MOTEURS (Claude, GPT…), et
 * celle des COMPTES de chaque moteur. Ce fichier ne fait que les mettre en
 * forme pour l'écran et calculer un déplacement d'un cran ; le choix du compte
 * reste celui de `choix-de-compte.ts` (rang d'abord) et celui du moteur reste
 * `moteurDuTriAutomatique`.
 *
 * Règle PURE : ni disque, ni base, ni réseau.
 */

import { ordreDeMoteursComplet } from './tri-automatique-moteur.js';

/** Ce qu'il faut savoir d'une ligne de la liste pour la ranger. */
export interface LigneOrdonnable {
  id: string;
  engine: string;
  priority: number;
  label: string;
  /** Une ligne de SUIVI (Gemini) n'est pas un compte : jamais rangée. */
  suivi?: boolean;
}

export interface GroupeDeComptes<T extends LigneOrdonnable> {
  engine: string;
  /** Le moteur entre-t-il dans l'ordre des moteurs (jamais un moteur payé au crédit) ? */
  reglable: boolean;
  /** Les comptes du moteur, du premier servi au dernier. */
  comptes: T[];
}

/**
 * LES LIGNES, PAR MOTEUR. Les moteurs de l'ordre de l'utilisateur d'abord, dans
 * son ordre ; les autres (payés au crédit, suivis) ensuite, dans l'ordre où ils
 * apparaissent. Dans un moteur, le rang (`priority`) commande, puis le nom.
 */
export function groupesDeComptes<T extends LigneOrdonnable>(
  lignes: readonly T[],
  ordreDesMoteurs?: readonly string[],
): GroupeDeComptes<T>[] {
  const secours = ordreDeMoteursComplet(ordreDesMoteurs) as string[];
  const vus = [...new Set(lignes.map((ligne) => ligne.engine))];
  const moteurs = [...secours.filter((id) => vus.includes(id)), ...vus.filter((id) => !secours.includes(id))];
  return moteurs.map((engine) => ({
    engine,
    reglable: secours.includes(engine),
    comptes: lignes
      .filter((ligne) => ligne.engine === engine)
      .sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label) || a.id.localeCompare(b.id)),
  }));
}

/**
 * LA LISTE APRÈS UN DÉPLACEMENT D'UN CRAN (`-1` : monter, `1` : descendre).
 * `null` quand l'élément est déjà en haut ou en bas, ou absent de la liste.
 */
export function deplacerUnCran(ids: readonly string[], id: string, sens: -1 | 1): string[] | null {
  const index = ids.indexOf(id);
  const cible = index + sens;
  if (index === -1 || cible < 0 || cible >= ids.length) return null;
  const suite = [...ids];
  [suite[index], suite[cible]] = [suite[cible], suite[index]];
  return suite;
}
