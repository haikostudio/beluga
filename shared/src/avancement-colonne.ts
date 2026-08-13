/**
 * « Où en sont les travaux en cours ? » — d'un seul coup d'œil.
 *
 * Chaque carte de la colonne « En cours » dit déjà son propre avancement
 * (« 4/6 faites », `mentionProgressionTaches`). Pour savoir combien de travail
 * reste AVANT la fin des travaux en cours, il fallait additionner ces décomptes
 * de tête, carte par carte.
 *
 * Ici, la même matière — les décomptes portés par les agents au travail — est
 * additionnée en UN pourcentage, posé en tête de la colonne. La règle vit ici,
 * sans base ni réseau : elle se teste seule, et le tableau ne fait que
 * l'afficher.
 */

import type { ProgressionTaches } from './progression-taches.js';

/** Ce qu'on sait d'une carte de la colonne pour l'additionner aux autres. */
export interface CartePourAvancement {
  /** Un agent de tâche travaille-t-il encore sur cette carte ? */
  agentActif?: boolean;
  /** Le décompte porté par cet agent, s'il en a un. */
  todos?: ProgressionTaches;
}

/** L'avancement global de la colonne, tel qu'il s'affiche. */
export interface AvancementColonne {
  /** Étapes cochées, toutes cartes confondues. */
  done: number;
  /** Étapes annoncées, toutes cartes confondues. */
  total: number;
  /** Le pourcentage entier à afficher (0 à 100). */
  pourcent: number;
  /** Tout est coché : le repère passe alors au bleu « terminé ». */
  termine: boolean;
}

/**
 * Le pourcentage à poser en tête de « En cours », ou `null` quand il n'y a
 * rien à dire.
 *
 * Deux silences : aucune carte en cours, ou aucune carte n'a d'étapes comptées
 * (un agent qui n'a pas encore annoncé sa liste ne pèse rien). Une carte sans
 * agent au travail est ignorée : son avancement est figé et fausserait le
 * total.
 *
 * Les arrondis ne mentent jamais aux deux bouts : tant qu'il reste une étape,
 * le repère ne monte pas à 100 %, et dès qu'une étape est cochée il ne retombe
 * pas à 0 %.
 */
export function avancementDeLaColonne(cartes: CartePourAvancement[]): AvancementColonne | null {
  let done = 0;
  let total = 0;
  for (const carte of cartes) {
    if (!carte.agentActif) continue;
    const todos = carte.todos;
    if (!todos || todos.total <= 0) continue;
    // Un décompte abîmé (plus de fait que de total, un négatif) ne doit pas
    // faire passer la colonne au-dessus de 100 % : on le borne ici.
    total += todos.total;
    done += Math.min(Math.max(todos.done, 0), todos.total);
  }
  if (total <= 0) return null;

  const brut = (done / total) * 100;
  let pourcent = Math.round(brut);
  if (pourcent >= 100 && done < total) pourcent = 99;
  if (pourcent <= 0 && done > 0) pourcent = 1;
  return { done, total, pourcent, termine: done >= total };
}
