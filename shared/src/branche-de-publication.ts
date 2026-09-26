/**
 * DEUX BRANCHES FIXES, ET AUCUNE AUTRE : « dev » ET « main ».
 *
 * C'est la RÈGLE D'OR du parc, valable pour TOUS les projets — ceux qui
 * existent déjà comme ceux qu'on montera demain :
 *
 *  - `dev`  — le DÉPLOIEMENT y fusionne, enregistre et pousse le lot ; c'est
 *             l'image de ce qui tourne sur ce serveur ;
 *  - `main` — la MISE EN PRODUCTION y fusionne le sien ; c'est l'image de ce
 *             qui est chez le client.
 *
 * Le code va donc TOUJOURS dans le même ordre : branche de carte → `dev` au
 * déploiement → `main` à la mise en production. Aucun autre schéma n'est
 * autorisé : ni « master », ni « release », ni « livraison ».
 *
 * CE QUI A CHANGÉ. La règle précédente était molle : sans réglage, le
 * déploiement ne prenait « dev » QUE si le dépôt en avait déjà une, et la mise
 * en production suivait la branche principale CONSTATÉE — donc « master » sur
 * un vieux dépôt. Deux projets voisins pouvaient ainsi vivre sur deux schémas
 * différents, et personne ne savait plus où regardait la production. Les deux
 * noms sont maintenant IMPOSÉS, et le serveur fait EXISTER la branche quand
 * elle manque (`server/src/branche-de-deploiement.ts`) au lieu de retomber en
 * silence sur autre chose.
 *
 * LE RÉGLAGE PAR PROJET SURVIT, mais il devient un ÉCART, pas une option : une
 * branche choisie à la main l'emporte toujours (on ne casse pas un projet en
 * cours), et l'écran le DIT en toutes lettres au lieu de le présenter comme un
 * choix ordinaire.
 *
 * Règle PURE : ni base, ni disque, ni git — l'appelant apporte la branche
 * principale constatée et, s'il l'a, la liste des branches du dépôt. Ces deux
 * renseignements ne servent plus à DÉCIDER : seulement à dire, dans la raison,
 * si la branche imposée est déjà là ou reste à créer.
 */

import type { CiblePublication } from './etapes-publication.js';

/** La branche du DÉPLOIEMENT, pour tous les projets. */
export const BRANCHE_DEV_PAR_DEFAUT = 'dev';

/** La branche de la MISE EN PRODUCTION, pour tous les projets. */
export const BRANCHE_PRODUCTION_PAR_DEFAUT = 'main';

/** Le nom imposé par la règle d'or pour cette étape. */
export function brancheImposee(cible: CiblePublication): string {
  return cible === 'production' ? BRANCHE_PRODUCTION_PAR_DEFAUT : BRANCHE_DEV_PAR_DEFAUT;
}

/** Les deux branches réglées sur un projet. Une clé absente = « le schéma imposé ». */
export interface BranchesDePublication {
  /** Branche du DÉPLOIEMENT vers l'instance de développement. */
  dev?: string;
  /** Branche de la MISE EN PRODUCTION. */
  production?: string;
}

/** D'où vient la branche finalement retenue. */
export type OrigineDeBranche = 'reglee' | 'imposee';

export interface BrancheRetenue {
  /** Le nom de la branche où le lot sera fusionné, enregistré et poussé. */
  branche: string;
  origine: OrigineDeBranche;
  /** Vrai quand la branche retenue s'écarte du schéma « dev » / « main ». */
  ecart: boolean;
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
 * Cette branche s'écarte-t-elle du schéma imposé pour cette étape ?
 *
 * Sert à l'écran de réglages et au compte rendu de publication : on n'interdit
 * pas l'écart — un projet en cours ne se casse pas d'autorité —, on le NOMME.
 */
export function ecartAuSchema(cible: CiblePublication, branche: string | undefined): boolean {
  const nom = (branche ?? '').trim();
  if (!nom) return false;
  return nom !== brancheImposee(cible);
}

/**
 * La phrase qui dit l'écart, ou rien quand la branche suit la règle d'or.
 * Un seul texte, écrit ici, pour l'écran comme pour le journal.
 */
export function mentionEcartAuSchema(
  cible: CiblePublication,
  branche: string | undefined,
): string | undefined {
  if (!ecartAuSchema(cible, branche)) return undefined;
  const impose = brancheImposee(cible);
  const etape = cible === 'production' ? 'la mise en production' : 'le déploiement';
  return `Écart à la règle : tous les projets utilisent « ${impose} » pour ${etape}. La branche « ${(branche ?? '').trim()} » sera pourtant suivie, puisqu’elle est choisie ici.`;
}

/**
 * LA BRANCHE DE CETTE ÉTAPE DE MISE EN LIGNE.
 *
 * Deux cas, et deux seulement :
 *
 * 1. une branche RÉGLÉE sur le projet : elle l'emporte toujours, même absente
 *    du dépôt — la publication dira alors clairement qu'elle ne la trouve pas,
 *    ce qui vaut mieux que de repartir en silence sur une autre branche. Si ce
 *    n'est pas le nom imposé, l'écart est signalé (`ecart`) ;
 * 2. rien de réglé : le nom IMPOSÉ par la règle d'or — « dev » au déploiement,
 *    « main » à la mise en production. La branche principale constatée n'entre
 *    plus dans la décision ; un dépôt qui n'a pas encore ces branches se les
 *    voit CRÉER par le serveur avant la fusion.
 *
 * @param cible          déploiement (`dev`) ou mise en production.
 * @param reglees        les deux branches réglées sur le projet, s'il y en a.
 * @param principale     la branche principale constatée sur le dépôt (pour la raison seule).
 * @param branchesConnues les branches réellement présentes sur le dépôt (pour la raison seule).
 */
export function brancheDePublication(input: {
  cible: CiblePublication;
  reglees?: BranchesDePublication;
  principale?: string;
  branchesConnues?: string[];
}): BrancheRetenue {
  const reglee = brancheReglee(input.reglees, input.cible);
  if (reglee) {
    const ecart = ecartAuSchema(input.cible, reglee);
    return {
      branche: reglee,
      origine: 'reglee',
      ecart,
      raison: ecart
        ? `Branche ${reglee}, choisie dans les réglages du projet — hors du schéma « ${BRANCHE_DEV_PAR_DEFAUT} » / « ${BRANCHE_PRODUCTION_PAR_DEFAUT} ».`
        : `Branche ${reglee}, choisie dans les réglages du projet.`,
    };
  }

  const impose = brancheImposee(input.cible);
  const connues = (input.branchesConnues ?? []).map((nom) => nom.trim()).filter(Boolean);
  const deja = connues.length === 0 || connues.includes(impose);
  return {
    branche: impose,
    origine: 'imposee',
    ecart: false,
    raison: deja
      ? `Branche ${impose} : c’est la branche imposée pour cette étape sur tous les projets.`
      : `Branche ${impose} : c’est la branche imposée pour cette étape sur tous les projets ; ce dépôt ne l’a pas encore, elle sera créée.`,
  };
}

/**
 * Ce que l'écran de réglages écrit sous une liste vide : la branche qui
 * s'appliquera tant que rien n'est choisi. Le dit AVANT le premier
 * déploiement, plutôt que de le laisser découvrir dans le déroulé.
 */
export function mentionBrancheParDefaut(cible: CiblePublication, branchesConnues: string[]): string {
  const impose = brancheImposee(cible);
  const connues = branchesConnues.map((nom) => nom.trim()).filter(Boolean);
  const etape = cible === 'production' ? 'la mise en production ira' : 'le déploiement ira';
  if (connues.length === 0 || connues.includes(impose)) {
    return `Rien de choisi : ${etape} sur « ${impose} », la branche imposée sur tous les projets.`;
  }
  return `Rien de choisi : ${etape} sur « ${impose} », la branche imposée sur tous les projets — ce dépôt ne l’a pas encore, elle sera créée au premier passage.`;
}
