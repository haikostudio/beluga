/**
 * LA DIFFÉRENCE ENTRE DEUX TEXTES DE PLAN, ligne à ligne.
 *
 * Ce module numérotait aussi les versions d'un plan dans un FIL — l'ancien mode
 * plan, où chaque itération était un message porteur du drapeau `plan`. Ce mode
 * n'existe plus : un plan vit désormais sur la CARTE (`parcours.plans`), avec
 * son numéro de version écrit dessus. Seule la comparaison de deux textes
 * restait utile, et c'est tout ce qui vit encore ici — sans base ni disque,
 * donc rejouable seule.
 */

export interface DiffLigne {
  type: 'egal' | 'ajoute' | 'retire';
  texte: string;
}

/**
 * Différence ligne à ligne entre deux textes (plus longue sous-suite
 * commune, algorithme classique) : les plans sont des textes courts, un
 * tableau O(n×m) suffit largement.
 */
export function differencesDeTexte(ancien: string, nouveau: string): DiffLigne[] {
  const a = ancien.split('\n');
  const b = nouveau.split('\n');
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const resultat: DiffLigne[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      resultat.push({ type: 'egal', texte: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      resultat.push({ type: 'retire', texte: a[i] });
      i++;
    } else {
      resultat.push({ type: 'ajoute', texte: b[j] });
      j++;
    }
  }
  while (i < n) {
    resultat.push({ type: 'retire', texte: a[i] });
    i++;
  }
  while (j < m) {
    resultat.push({ type: 'ajoute', texte: b[j] });
    j++;
  }
  return resultat;
}
