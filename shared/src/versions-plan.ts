/**
 * LES VERSIONS D'UN PLAN — numérotage, comparaison, reprise.
 *
 * Un message porte un plan (`Message.plan === true`) à chaque itération du
 * mode plan (§ TRI_MODE_PLAN, `server/src/runtime.ts`). Ce module ne connaît
 * ni base ni disque : il ne fait que relire la liste des messages d'une
 * conversation pour numéroter les versions, retrouver la précédente ou la
 * suivante, et calculer ce qui a changé entre deux textes.
 */

import type { Message } from './models.js';

export interface DiffLigne {
  type: 'egal' | 'ajoute' | 'retire';
  texte: string;
}

/** Les messages porteurs d'un plan rédigé, dans l'ordre de la conversation. */
export function messagesDePlan(messages: Message[]): Message[] {
  return messages.filter((m) => m.plan && m.content.trim());
}

/** Le numéro de version (1-based) d'un message porteur de plan ; 0 s'il n'en porte pas. */
export function numeroDeVersion(messages: Message[], messageId: string): number {
  const index = messagesDePlan(messages).findIndex((m) => m.id === messageId);
  return index === -1 ? 0 : index + 1;
}

/** Les versions ANTÉRIEURES à celle-ci, la plus récente d'abord. */
export function versionsPrecedentes(messages: Message[], messageId: string): Message[] {
  const plans = messagesDePlan(messages);
  const index = plans.findIndex((m) => m.id === messageId);
  if (index <= 0) return [];
  return plans.slice(0, index).reverse();
}

/** La version qui suit celle-ci — pour comparer ; `undefined` si c'est la dernière. */
export function versionSuivante(messages: Message[], messageId: string): Message | undefined {
  const plans = messagesDePlan(messages);
  const index = plans.findIndex((m) => m.id === messageId);
  if (index === -1 || index === plans.length - 1) return undefined;
  return plans[index + 1];
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
