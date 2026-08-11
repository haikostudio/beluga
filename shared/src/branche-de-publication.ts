/**
 * SUR QUELLE BRANCHE UNE MISE EN LIGNE POSE-T-ELLE LE LOT ?
 *
 * La branche était IMPOSÉE : le déploiement comme la mise en production
 * fusionnaient toujours dans la branche principale constatée sur le dépôt
 * (`main`, sinon `master`). Un projet qui garde une branche d'intégration —
 * « dev » d'un côté, « main » de l'autre — ne pouvait donc pas séparer les deux
 * étapes : tout tombait au même endroit.
 *
 * Le projet porte maintenant DEUX branches réglables, une par étape :
 *
 *  - `dev`        — celle où le DÉPLOIEMENT vers l'instance de développement
 *                   fusionne, enregistre et pousse ;
 *  - `production` — celle où la MISE EN PRODUCTION fait la même chose.
 *
 * Rien de réglé reste un état NORMAL, et c'est le cas de tous les projets
 * existants. On retombe alors sur :
 *
 *  - pour le déploiement : la branche « dev » du dépôt QUAND ELLE EXISTE
 *    vraiment — c'est la valeur par défaut voulue —, sinon la branche
 *    principale constatée, exactement comme avant ;
 *  - pour la mise en production : la branche principale constatée, comme avant.
 *
 * Un dépôt sans branche « dev » se comporte donc au signe près comme
 * aujourd'hui : rien ne casse.
 *
 * Règle PURE : ni base, ni disque, ni git — l'appelant apporte la branche
 * principale et la liste des branches réellement présentes sur le dépôt.
 */

import type { CiblePublication } from './etapes-publication.js';

/** La branche proposée par défaut pour le déploiement vers l'instance de dev. */
export const BRANCHE_DEV_PAR_DEFAUT = 'dev';

/** Les deux branches réglées sur un projet. Une clé absente = « rien de réglé ». */
export interface BranchesDePublication {
  /** Branche du DÉPLOIEMENT vers l'instance de développement. */
  dev?: string;
  /** Branche de la MISE EN PRODUCTION. */
  production?: string;
}

/** D'où vient la branche finalement retenue. */
export type OrigineDeBranche = 'reglee' | 'defaut-dev' | 'principale';

export interface BrancheRetenue {
  /** Le nom de la branche où le lot sera fusionné, enregistré et poussé. */
  branche: string;
  origine: OrigineDeBranche;
  /** Une phrase pour le compte rendu, en français. */
  raison: string;
}

/** Le nom réglé pour cette étape, nettoyé — rien quand il est vide. */
export function brancheReglee(
  branches: BranchesDePublication | undefined,
  cible: CiblePublication,
): string | undefined {
  const valeur = cible === 'production' ? branches?.production : branches?.dev;
  return valeur?.trim() || undefined;
}

/**
 * La branche de CETTE étape de mise en ligne.
 *
 * Trois cas, dans cet ordre :
 *
 * 1. une branche RÉGLÉE sur le projet : elle l'emporte toujours, même absente
 *    du dépôt — la publication dira alors clairement qu'elle ne la trouve pas,
 *    ce qui vaut mieux que de repartir en silence sur une autre branche ;
 * 2. rien de réglé, étape de DÉPLOIEMENT, et le dépôt a bien une branche
 *    « dev » : c'est elle, la valeur par défaut demandée ;
 * 3. rien de réglé : la branche principale constatée, comme avant ce réglage.
 *
 * @param cible          déploiement (`dev`) ou mise en production.
 * @param reglees        les deux branches réglées sur le projet, s'il y en a.
 * @param principale     la branche principale constatée sur le dépôt.
 * @param branchesConnues les branches réellement présentes sur le dépôt.
 */
export function brancheDePublication(input: {
  cible: CiblePublication;
  reglees?: BranchesDePublication;
  principale: string;
  branchesConnues?: string[];
}): BrancheRetenue {
  const principale = input.principale.trim() || 'main';
  const reglee = brancheReglee(input.reglees, input.cible);
  if (reglee) {
    return {
      branche: reglee,
      origine: 'reglee',
      raison: `Branche ${reglee}, choisie dans les réglages du projet.`,
    };
  }

  const connues = (input.branchesConnues ?? []).map((nom) => nom.trim()).filter(Boolean);
  if (input.cible !== 'production' && connues.includes(BRANCHE_DEV_PAR_DEFAUT)) {
    return {
      branche: BRANCHE_DEV_PAR_DEFAUT,
      origine: 'defaut-dev',
      raison: `Branche ${BRANCHE_DEV_PAR_DEFAUT} : aucune branche n’est choisie dans les réglages, et le dépôt en a une.`,
    };
  }

  return {
    branche: principale,
    origine: 'principale',
    raison: `Branche ${principale} : aucune branche n’est choisie dans les réglages, on garde la branche principale du dépôt.`,
  };
}

/**
 * Ce que l'écran de réglages écrit sous une liste vide : la branche qui
 * s'appliquera tant que rien n'est choisi. Le dit AVANT le premier
 * déploiement, plutôt que de le laisser découvrir dans le déroulé.
 */
export function mentionBrancheParDefaut(cible: CiblePublication, branchesConnues: string[]): string {
  const connues = branchesConnues.map((nom) => nom.trim()).filter(Boolean);
  if (cible !== 'production' && connues.includes(BRANCHE_DEV_PAR_DEFAUT)) {
    return `Rien de choisi : le déploiement ira sur « ${BRANCHE_DEV_PAR_DEFAUT} », la branche par défaut.`;
  }
  return cible === 'production'
    ? 'Rien de choisi : la mise en production ira sur la branche principale du dépôt, comme aujourd’hui.'
    : 'Rien de choisi : le déploiement ira sur la branche principale du dépôt, comme aujourd’hui — ce dépôt n’a pas de branche « dev ».';
}
