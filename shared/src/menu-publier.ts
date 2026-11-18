/*
 * CE QUE MONTRE LE MENU « PUBLIER » (13/11/2026 — maquettes #ad2d et #625e validées).
 *
 * La publication ne s'ouvre plus dans un grand volet : tout se lit dans le menu du bouton « Publier ». Selon le
 * moment, le menu montre :
 *  - `suivi` : une publication tourne (déploiement ou mise en production) — la liste des étapes cochées une à une,
 *    le pourcentage et la barre ;
 *  - `preparation` : l'agent de configuration écrit la marche à suivre d'une étape (« Initialiser ») ;
 *  - `fini` : la publication vient de réussir — la liste toute cochée reste quelques secondes, puis le menu revient ;
 *  - `ordinaire` : les deux listes à cocher, avec, quand une étape n'a pas encore de marche à suivre, le bouton
 *    « Initialiser le déploiement » ou « Initialiser la mise en production » à la place du bouton de départ.
 * Un BLOCAGE (une étape restée en panne après ses trois réparations) se pose AU-DESSUS de l'ordinaire, jamais à sa
 * place : on doit pouvoir relancer.
 *
 * Règle PURE : ni base, ni horloge (`maintenant` est passé).
 */
import type { CiblePublication } from './etapes-publication.js';

/** Combien de temps la liste toute cochée reste à l'écran après une réussite. */
export const DUREE_DU_FINI_DANS_LE_MENU_MS = 6000;

export interface RunPourLeMenu {
  state: 'running' | 'success' | 'failed' | 'stopped';
  cible?: CiblePublication;
  endedAt?: number;
  masquee?: boolean;
  steps?: readonly { state: string; blocage?: unknown }[];
}

export type VueDuMenuPublier =
  | { genre: 'suivi'; cible: CiblePublication }
  | { genre: 'preparation'; cible: CiblePublication }
  | { genre: 'fini'; cible: CiblePublication }
  | { genre: 'ordinaire' };

export interface SituationDuMenu {
  run?: RunPourLeMenu | null;
  /** L'agent de configuration d'une étape tient-il son tour (préparation en cours) ? */
  preparationDev?: boolean;
  preparationProduction?: boolean;
  maintenant: number;
}

export function vueDuMenuPublier(situation: SituationDuMenu): VueDuMenuPublier {
  const run = situation.run;
  if (run?.state === 'running') return { genre: 'suivi', cible: run.cible ?? 'dev' };
  if (situation.preparationDev) return { genre: 'preparation', cible: 'dev' };
  if (situation.preparationProduction) return { genre: 'preparation', cible: 'production' };
  if (run?.state === 'success' && run.endedAt && situation.maintenant - run.endedAt < DUREE_DU_FINI_DANS_LE_MENU_MS) {
    return { genre: 'fini', cible: run.cible ?? 'dev' };
  }
  return { genre: 'ordinaire' };
}

/**
 * LA PUBLICATION EST-ELLE BLOQUÉE ? Seulement la DERNIÈRE, tombée sur une étape qui a résisté à ses réparations
 * (`step.blocage`), et pas rangée à la main. Une publication plus récente efface le blocage d'elle-même : le menu ne
 * lit que la dernière.
 */
export function publicationBloquee(run?: RunPourLeMenu | null): boolean {
  if (!run || run.masquee) return false;
  if (run.state !== 'failed') return false;
  return (run.steps ?? []).some((step) => !!step.blocage);
}

/**
 * LE MOT DU BOUTON « PUBLIER » PENDANT UN TRAVAIL : « Déploiement », « Mise en production » ou « Préparation » — suivi
 * du pourcentage par l'écran. `null` : rien ne tourne, le bouton dit « Publier ».
 */
export function motDuBoutonPublier(vue: VueDuMenuPublier): string | null {
  if (vue.genre === 'suivi') return vue.cible === 'production' ? 'Mise en production' : 'Déploiement';
  if (vue.genre === 'preparation') return 'Préparation';
  return null;
}

/** Le titre de la liste d'étapes. */
export function titreDuSuivi(vue: VueDuMenuPublier): string {
  if (vue.genre === 'preparation') return vue.cible === 'production' ? 'Préparation de la mise en production' : 'Préparation du déploiement';
  if (vue.genre === 'fini') return vue.cible === 'production' ? 'Mise en production terminée' : 'Déploiement terminé';
  if (vue.genre === 'suivi') return vue.cible === 'production' ? 'Mise en production en cours' : 'Déploiement en cours';
  return '';
}

/**
 * LES TROIS JALONS D'UNE PRÉPARATION, quand l'agent n'a pas encore annoncé sa liste de tâches : il étudie le projet,
 * écrit la marche à suivre, puis fait un essai sans rien mettre en ligne. L'avancement de sa liste (`fait` sur
 * `total`) dit où il en est.
 */
export const JALONS_DE_PREPARATION = ['Étudier le projet', 'Écrire la marche à suivre', 'Faire un essai, sans rien mettre en ligne'] as const;

export function jalonsDePreparation(fait: number, total: number): { libelle: string; etat: 'done' | 'running' | 'todo' }[] {
  const part = total > 0 ? Math.min(1, Math.max(0, fait / total)) : 0;
  const courant = Math.min(JALONS_DE_PREPARATION.length - 1, Math.floor(part * JALONS_DE_PREPARATION.length));
  return JALONS_DE_PREPARATION.map((libelle, i) => ({
    libelle,
    etat: i < courant ? 'done' : i === courant ? 'running' : 'todo',
  }));
}

/** Le pourcentage d'une préparation : la part de la liste de l'agent, jamais 100 tant qu'il travaille. */
export function pourcentDePreparation(fait: number, total: number): number {
  if (total <= 0) return 5;
  return Math.max(5, Math.min(95, Math.round((fait / total) * 100)));
}
