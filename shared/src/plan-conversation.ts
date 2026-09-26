/**
 * « CE PLAN ATTEND-IL ENCORE UNE DÉCISION ? »
 *
 * Ce fichier ne parlait que de l'ANCIEN mode plan — une pile de versions dans
 * un fil, dont seule la dernière comptait. Ce mode n'existe plus : un plan naît
 * désormais du CADRAGE d'une carte, par l'outil `rendre_plan`, et vit sur la
 * carte (`parcours.plans`), pas dans les messages.
 *
 * Ce qui reste ici est ce que le NOUVEAU parcours lit : à quelles conditions le
 * plan d'une carte offre encore le geste « Valider ». Le reste — repérer un
 * plan dans un fil, le recopier au tour suivant, juger sa complétude — est
 * parti avec le mode qui l'employait.
 *
 * La règle vit ici, sans base ni réseau : elle se teste seule.
 */

import { planDeLaRelance } from './relance-apres-rapport.js';

/* ------------------------------------------------------------------ */
/* Un plan DÉJÀ EXÉCUTÉ ne se décide plus                              */
/* ------------------------------------------------------------------ */

/**
 * CE QU'IL FAUT SAVOIR DE LA CARTE pour dire si son plan attend encore une
 * décision.
 *
 * Tout est lu sur la carte, jamais deviné dans un texte : la colonne, l'agent
 * qui la tient aujourd'hui, celui qui a écrit le plan, et la marque du code
 * déjà enregistré.
 */
export interface EtatDeCartePourLePlan {
  /** La colonne de la carte. */
  colonne?: string;
  /** Le cadrage rouvert par un message sous le rapport (`parcours.cadrageRouvertA`). */
  cadrageRouvertA?: number;
  /** L'instant où le plan affiché a été rendu (`PlanDeCarte.at`). */
  planRenduA?: number;
  /** L'agent qui tient la carte aujourd'hui (`Card.agentId`). */
  agentDeLaCarte?: string;
  /** L'agent à qui « Valider » parlerait : celui qui a écrit le plan. */
  agentDuPlan?: string;
  /** La carte a déjà produit du code enregistré (`Card.codeDejaEnregistre`). */
  codeDejaEnregistre?: boolean;
  /**
   * LE PLAN AFFICHÉ EST DÉJÀ VALIDÉ, pour cette version (`parcours.planValide`,
   * écrit par `card.plan.validate`). La décision est prise : plus de boutons.
   */
  planValide?: boolean;
  /**
   * UN TOUR DE L'AGENT TOURNE ENCORE (`temoinDeTravail`). Le plan est écrit par
   * l'outil `rendre_plan` AU MILIEU du tour : son texte s'affiche aussitôt,
   * mais l'agent continue — il relit, il corrige, il peut rendre une version
   * suivante. Décider là-dessus, c'est lancer un travail sur un plan que
   * personne n'a fini d'écrire.
   */
  tourEnCours?: boolean;
  /** Le texte du plan affiché est encore en flux : il n'est pas complet. */
  planEnEcriture?: boolean;
}

/** Les rôles d'agent, tels que le démon les nomme. */
export type RoleDAgent = 'task' | 'analysis' | 'deploy' | 'cadrage';

/** Les colonnes qu'une carte n'atteint qu'une fois son travail commencé. */
export const COLONNES_APRES_LANCEMENT = ['running', 'to_deploy', 'archived'];

/**
 * LE TRAVAIL DE CETTE CARTE A-T-IL DÉJÀ ÉTÉ LANCÉ ?
 *
 * Trois constats, chacun suffisant : la carte est passée dans une colonne
 * d'après-lancement, elle a déjà enregistré du code, ou elle est passée dans
 * les mains d'un AUTRE agent que celui qui a écrit le plan — c'est ce que veut
 * dire, très exactement, « la carte a été lancée » : le cadrage a rendu la
 * main à un agent de tâche.
 *
 * Une carte revenue en « Planifié » après un travail rendu reste donc lancée :
 * c'est le troisième constat qui la rattrape.
 */
export function travailDeLaCarteDejaLance(etat: EtatDeCartePourLePlan): boolean {
  /* Le plan d'une RELANCE après rapport décide du travail suivant : celui
     déjà livré ne ferme pas sa décision (`planDeLaRelance`). */
  if (planDeLaRelance(etat)) return false;
  if (etat.codeDejaEnregistre) return true;
  if (etat.colonne && COLONNES_APRES_LANCEMENT.includes(etat.colonne)) return true;
  return !!etat.agentDuPlan && !!etat.agentDeLaCarte && etat.agentDeLaCarte !== etat.agentDuPlan;
}

/**
 * CE PLAN PORTE-T-IL ENCORE SES BOUTONS « VALIDER » / « REFUSER » ?
 *
 * La règle existait déjà pour les versions PÉRIMÉES : décider sur un plan
 * qu'un autre a remplacé lancerait un travail que personne n'a relu. Il en
 * manquait la moitié : le plan COURANT gardait sa décision même une fois la
 * carte lancée, travaillée et rendue. On lisait donc « Plan proposé · version
 * 1 · Valider » au-dessus d'un travail déjà fait, et un clic aurait relancé la
 * carte entière — constaté le 05.09.2026 sur une carte dont le rapport était
 * déjà rendu.
 *
 * Une décision ne s'offre donc que sur la version COURANTE d'un plan dont le
 * travail n'a pas encore commencé.
 *
 * IL MANQUAIT LA MOITIÉ DE CETTE MOITIÉ : le plan est déposé sur la carte par
 * l'outil `rendre_plan`, EN PLEIN TOUR. Son texte s'affichait donc — c'est
 * voulu, il se lit pendant qu'il s'écrit — mais sa décision aussi, si bien
 * qu'on pouvait valider, et lancer la tâche, sur un plan que l'agent était en
 * train de reprendre. Le TEXTE reste visible dès qu'il arrive ; le GESTE, lui,
 * n'apparaît qu'une fois le tour refermé.
 *
 * Un tour TOMBÉ ou ARRÊTÉ n'est plus un tour en cours (`temoinDeTravail` lit le
 * statut ET le tour vivant) : un plan rendu par un tour qui meurt ensuite reste
 * donc décidable, sans quoi la carte n'aurait plus aucune issue.
 */
export function decisionDePlanOuverte(input: { estCourant: boolean } & EtatDeCartePourLePlan): boolean {
  if (!input.estCourant) return false;
  if (input.planValide) return false;
  if (input.tourEnCours || input.planEnEcriture) return false;
  return !travailDeLaCarteDejaLance(input);
}

/* ------------------------------------------------------------------ */
/* « En cours d'écriture » : seulement pendant un tour de PLAN          */
/* ------------------------------------------------------------------ */

/** Ce qu'il faut savoir du passage « Plan » qui montre la version. */
export interface PassageDePlanLu {
  etape: string;
  /** L'état du point (`pointsDuParcours`) : « encours » tant que SON tour vit. */
  etat?: string;
  moments: readonly { sorte: string }[];
  traces?: readonly unknown[];
  questions?: readonly unknown[];
  erreurs?: readonly unknown[];
}

const passageVide = (passage: PassageDePlanLu): boolean =>
  !passage.moments.length && !passage.traces?.length && !passage.questions?.length && !passage.erreurs?.length;

/**
 * CE PLAN EST-IL VRAIMENT EN TRAIN DE S'ÉCRIRE ?
 *
 * Le loader « Plan en cours d'écriture » se lisait dès qu'un tour de l'agent
 * tournait — N'IMPORTE QUEL tour : une nouvelle compréhension, une simple
 * réponse. Un plan v2 prêt repassait donc « en cours d'écriture » pendant la
 * précision suivante (cartes #8014, #738e, 11.09.2026). Il ne s'écrit que si le
 * tour vivant est le tour de PLAN qui l'a rendu :
 *  - rien ne s'est écrit APRÈS son passage (ni précision, ni compréhension) ;
 *  - aucune version suivante n'a été demandée (`planDemande`) ;
 *  - le passage « Plan » en cours est le sien, ou le passage anticipé vide que
 *    le tour vivant ouvre juste derrière lui (`avecLePassageDuTourVivant`).
 * Les BOUTONS, eux, restent gelés par `decisionDePlanOuverte` pendant tout
 * tour : seul le MOT change.
 *
 * Sans passage connu (un plan lu hors du flux), on garde la lecture d'avant.
 */
export function planEnCoursDEcriture(input: {
  tourEnCours: boolean;
  passage?: PassageDePlanLu | null;
  passages?: readonly PassageDePlanLu[];
  planDemande?: boolean;
}): boolean {
  if (!input.tourEnCours) return false;
  const { passage } = input;
  if (!passage) return true;
  if (passage.etape !== 'plan' || input.planDemande) return false;
  const passages = input.passages ?? [passage];
  const index = passages.indexOf(passage);
  const suite = index < 0 ? [] : passages.slice(index + 1);
  if (suite.some((autre) => !passageVide(autre))) return false;
  /* LE PLAN QUE CE TOUR VIENT DE RENDRE : plus aucun passage anticipé ne
     s'ouvre derrière lui (un seul point « Plan » par version), c'est donc lui
     qui porte le mot tant que son tour vit. */
  const renduParCeTour = passage.moments.some((moment) => moment.sorte === 'plan') && !suite.some((autre) => autre.etape === 'plan');
  return (
    passage.etat === 'encours' ||
    renduParCeTour ||
    suite.some((autre) => autre.etape === 'plan' && autre.etat === 'encours')
  );
}

/**
 * LA VERSION QUI SE PRÉPARE DANS CE PASSAGE, ou `null`.
 *
 * Au clic sur « Générer le plan », un passage « Plan » neuf s'ouvre, vide :
 * l'ancien plan restait le dernier cadre lisible, et rien ne disait qu'une
 * nouvelle version arrivait. Un passage « Plan » EN COURS qui n'a encore rendu
 * aucun plan, et qui a bien été DEMANDÉ (son jalon, ou la demande écrite sur la
 * carte), annonce donc la version SUIVANTE — une silhouette, pas un vide. Le
 * passage anticipé qui suit un plan rendu en plein tour n'annonce rien : ce
 * tour-là n'écrit pas de nouvelle version. Un tour tombé fait passer le point
 * en erreur : la silhouette disparaît au profit de l'erreur.
 */
export function versionEnPreparation(
  passage: PassageDePlanLu,
  plans: readonly { numero: number }[],
  planDemande = false,
): number | null {
  if (passage.etape !== 'plan' || passage.etat !== 'encours') return null;
  if (passage.moments.some((moment) => moment.sorte === 'plan')) return null;
  if (!planDemande && !passage.moments.some((moment) => moment.sorte === 'plan-demande')) return null;
  return plans.reduce((haut, plan) => Math.max(haut, plan.numero), 0) + 1;
}
