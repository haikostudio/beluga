/**
 * Déployer, c'est RAFRAÎCHIR L'INSTANCE DE DEV — pas seulement fusionner.
 *
 * La publication DEVINAIT comment mettre en ligne par cinq chemins successifs :
 * une consigne écrite, une commande de publication, HaikoDev lui-même, le
 * service système, le dossier servi. Aucun des cinq, et elle refusait : il
 * fallait donc régler un environnement pour qu'un projet puisse seulement
 * partir. Le déploiement est maintenant UNE seule chose, toujours disponible et
 * sans réglage : fusionner, enregistrer, envoyer sur le dépôt, puis rafraîchir
 * l'instance de dev du projet sur ce serveur.
 *
 * Cette règle dit COMMENT ce rafraîchissement se fait, à partir de ce qu'on
 * CONSTATE sur la machine. Un seul réglage passe devant les constats, et il ne
 * vaut QUE pour une mise en production : le PROMPT DE MISE EN PRODUCTION du
 * projet, qui confie le travail à un agent. Règle pure : aucune base, aucun
 * disque, donc rejouable.
 */

/** Ce qu'on a constaté sur la machine à propos de ce projet. */
export type MoyensDeMiseEnLigne = {
  /**
   * PROMPT DE MISE EN PRODUCTION du projet, en français, réglé dans ses
   * paramètres (`shared/src/mise-en-production.ts`). Il passe AVANT tout le
   * reste : quand il est écrit, c'est un agent qui mène la mise en ligne
   * (`shared/src/publication-confiee.ts`), et il peut faire ce qu'aucun des
   * trois constats ne sait décrire. Il n'est transmis que pour une mise en
   * PRODUCTION : le déploiement de l'instance de dev ne le lit pas.
   */
  prompt?: string;
  /** Le projet est HaikoDev : il sait se construire et s'installer lui-même. */
  estHaikoDev?: boolean;
  /** Le projet a un script `build` dans son package.json. */
  scriptBuild?: boolean;
  /** Nom du service système qui fait tourner ce dossier, s'il y en a un. */
  service?: string;
  /** Un serveur web sert ce dossier TEL QUEL (site statique). */
  dossierServi?: boolean;
};

export type Construction = 'npm' | 'agent' | 'aucune';
export type Installation = 'agent' | 'haikodev' | 'service' | 'dossier-servi' | 'aucune';
export type Redemarrage = 'agent' | 'demon' | 'service' | 'aucun';

export type PlanDeMiseEnLigne = {
  construction: Construction;
  installation: Installation;
  redemarrage: Redemarrage;
  /** Une phrase pour le compte rendu : ce qui va être fait, en français. */
  raison: string;
};

/**
 * Comment l'instance de dev de ce projet se rafraîchit-elle sur ce serveur ?
 *
 * Un chemin RÉGLÉ, puis trois cas CONSTATÉS :
 * 1. le PROMPT DE MISE EN PRODUCTION écrit dans les réglages du projet : un
 *    agent le suit de bout en bout, et il peut décrire ce qu'aucun constat ne
 *    sait dire. Il ne vaut que pour une mise en PRODUCTION ;
 * 2. HaikoDev : construction, installation dans le dossier servi, redémarrage ;
 * 3. un service système sur le dossier : construire s'il y a de quoi, puis
 *    relancer le service — c'est lui qui sert le code neuf ;
 * 4. un dossier servi tel quel par un serveur web : les fichiers en place SONT
 *    le site, il n'y a rien à déplacer ni à relancer.
 *
 * Aucun des trois constats n'est plus un refus : le lot est quand même fusionné,
 * enregistré et envoyé sur le dépôt — ce qui est du travail réel — et le plan le
 * DIT plutôt que d'éteindre le bouton. Rien n'est simplement relancé ici.
 */
export function planDeMiseEnLigne(moyens: MoyensDeMiseEnLigne): PlanDeMiseEnLigne {
  const construction: Construction = moyens.scriptBuild ? 'npm' : 'aucune';

  /*
   * Le prompt passe DEVANT tout : c'est la seule façon de décrire une mise en
   * production que les trois constats ne savent pas exprimer. Un prompt fait
   * d'espaces n'en est pas un — on retombe alors sur le déroulé habituel,
   * jamais sur un agent lancé sans rien à lui dire.
   */
  if (moyens.prompt?.trim()) {
    return {
      construction: 'agent',
      installation: 'agent',
      redemarrage: 'agent',
      raison:
        'Un agent de mise en production suit le prompt réglé dans les paramètres du projet, de bout en bout.',
    };
  }

  if (moyens.estHaikoDev) {
    return {
      construction: 'npm',
      installation: 'haikodev',
      redemarrage: 'demon',
      raison: 'HaikoDev se construit, installe son interface dans le dossier servi et redémarre son serveur.',
    };
  }

  if (moyens.service) {
    return {
      construction,
      installation: 'service',
      redemarrage: 'service',
      raison: `Le service ${moyens.service} fait tourner ce dossier : ${
        construction === 'npm' ? 'construction puis relance' : 'relance'
      } du service, c'est elle qui met le code neuf en ligne.`,
    };
  }

  if (moyens.dossierServi) {
    return {
      construction,
      installation: 'dossier-servi',
      redemarrage: 'aucun',
      raison:
        'Un serveur web sert ce dossier tel quel : les fichiers en place sont la version en ligne, il n’y a rien à déplacer ni à relancer.',
    };
  }

  return {
    construction,
    installation: 'aucune',
    redemarrage: 'aucun',
    raison:
      construction === 'npm'
        ? 'Aucune instance de dev n’a été trouvée sur ce serveur pour ce projet : le lot est fusionné, construit, enregistré et envoyé sur le dépôt, mais il n’y a rien à relancer ici. Pour une mise en production, écrivez le prompt dans le bloc « Mise en production » des réglages du projet.'
        : 'Aucune instance de dev n’a été trouvée sur ce serveur pour ce projet : le lot est fusionné, enregistré et envoyé sur le dépôt, mais il n’y a rien à construire ni à relancer ici. Pour une mise en production, écrivez le prompt dans le bloc « Mise en production » des réglages du projet.',
  };
}

/**
 * L'ANNONCE à afficher AVANT le clic « Tout déployer ».
 *
 * Le plan sait déjà COMMENT l'instance de dev sera rafraîchie (ou qu'aucune
 * n'a été trouvée) : c'est sa `raison`. Il lui manque une chose que
 * l'utilisateur ne découvrait qu'après coup — l'ADRESSE contrôlée à la fin.
 * Sans adresse réglée, le contrôle final est purement sauté, sans un mot ; on
 * le DIT ici, à la suite du moyen trouvé.
 *
 * Ne vaut que pour un DÉPLOIEMENT (cible dev) : une mise en production suit son
 * prompt, qui dit lui-même quoi contrôler. Informe, ne bloque rien : le
 * déploiement reste possible que l'adresse soit là ou non.
 *
 * @param plan   le plan déjà calculé par `planDeMiseEnLigne`.
 * @param devUrl l'adresse réglée du projet, quand elle existe.
 */
export function annonceDeDeploiement(plan: PlanDeMiseEnLigne, devUrl?: string): string {
  const url = devUrl?.trim();
  const adresse = url
    ? `À la fin, l’adresse ${url} sera vérifiée.`
    : 'Aucune adresse à contrôler n’est réglée pour ce projet : la fin du déploiement ne vérifiera rien. Réglez-la dans « Adresse à contrôler » des paramètres du projet.';
  return `${plan.raison} ${adresse}`;
}

/** L'état d'une étape de publication, tel que le tableau de bord l'affiche. */
export type EtatEtape = 'todo' | 'running' | 'done' | 'failed' | 'skipped';

/**
 * Quelque chose a-t-il RÉELLEMENT eu lieu ?
 *
 * Le verdict final ne se lit pas sur l'absence d'erreur mais sur au moins une
 * étape menée à son terme. Sept étapes « ignorées » ne font pas un déploiement,
 * même quand rien n'a planté — un projet sans dépôt git et sans instance de dev
 * doit le dire, pas faire avancer ses cartes.
 *
 * La fusion, l'enregistrement et l'envoi comptent désormais : déployer, c'est
 * d'abord porter le lot sur la branche principale et le mettre à l'abri sur le
 * dépôt. Un projet sans instance sur ce serveur a donc quand même déployé.
 */
export function miseEnLigneReelle(etapes: {
  merge?: EtatEtape;
  commit?: EtatEtape;
  push?: EtatEtape;
  build: EtatEtape;
  publish: EtatEtape;
  restart: EtatEtape;
}): boolean {
  return Object.values(etapes).some((etat) => etat === 'done');
}

import type { EtatPublication } from './publication-terminee.js';

/**
 * La NATURE d'une publication qui n'a pas abouti.
 *
 * - `cassee` : le code ne passe pas — contrôles tombés, construction en échec,
 *   conflit de fusion, service qui ne repart pas. C'est une vraie alerte, le
 *   rouge lui est réservé.
 * - `interrompue` : rien n'est cassé, la publication a seulement été coupée en
 *   route (redémarrage du serveur, arrêt demandé à la main). Se dit en gris ou
 *   en orange, pas en rouge d'alerte.
 */
export type NaturePublication = 'cassee' | 'interrompue';

/** Les mots d'un motif qui trahissent une COUPURE, pas une casse du code. */
const MARQUES_INTERRUPTION = ['redémarrage', 'redemarrage', 'arrêt demandé', 'arret demande', 'interrompue par'];

function motifDInterruption(motif?: string): boolean {
  const texte = (motif ?? '').toLowerCase();
  return MARQUES_INTERRUPTION.some((marque) => texte.includes(marque));
}

/**
 * Une publication finie est-elle CASSÉE, ou seulement INTERROMPUE ?
 *
 * Une publication n'a que quatre états, et tout ce qui n'aboutit pas tombe dans
 * `failed` : un vrai échec de contrôles s'y présente exactement comme une
 * coupure par redémarrage. Cette règle les sépare, à partir de trois signaux :
 *
 *  - `etat` : l'état du run ;
 *  - `etapeTombee` : la clé d'une étape RÉELLEMENT marquée en échec — jamais le
 *    simple `currentStep` de repli, qui reste posé même quand le run meurt en
 *    route. Une étape tombée prouve que le code ne passe pas ;
 *  - `motif` : le message d'erreur, déjà en français, qui nomme la coupure quand
 *    aucune étape n'a échoué.
 *
 * Renvoie `null` tant qu'il n'y a rien à qualifier (en cours, ou réussi).
 */
export function natureDePublication(input: {
  etat: EtatPublication;
  etapeTombee?: string | null;
  motif?: string;
}): NaturePublication | null {
  // Rien à qualifier tant que le run n'a pas échoué ni été arrêté.
  if (input.etat !== 'failed' && input.etat !== 'stopped') return null;
  // Un arrêt demandé à la main n'est jamais une casse du code.
  if (input.etat === 'stopped') return 'interrompue';
  // failed : une étape réellement tombée = le code ne passe pas.
  if (input.etapeTombee) return 'cassee';
  // Aucune étape tombée : le run a été coupé en route. Le motif le dit.
  if (motifDInterruption(input.motif)) return 'interrompue';
  // Par défaut, un échec sans marque d'interruption est traité comme cassé :
  // mieux vaut alerter à tort que taire une vraie casse.
  return 'cassee';
}

/**
 * Le MESSAGE court d'une publication qui tombe.
 *
 * Le message brut recopiait l'exception (« La construction a échoué : rien
 * n'est mis en ligne. ») sans nommer le PROJET, l'étape tombée, ni où lire le
 * détail. On rend une phrase qui dit les trois : de quel projet il s'agit, à
 * quelle étape la publication s'est arrêtée, et où regarder ensuite. Le VERBE
 * suit la nature : une publication cassée est « en échec », une publication
 * seulement coupée est « interrompue ».
 *
 * Règle pure : l'appelant a déjà résolu le LIBELLÉ de l'étape (« Construction »,
 * « Vérification du code »…) ; celui-ci reste ignorant des clés du serveur.
 *
 * @param projet le nom du projet, quand il est connu.
 * @param etape  le libellé de l'étape tombée, quand une étape précise a échoué.
 * @param raison le message d'erreur, déjà en français.
 * @param nature cassée ou interrompue ; par défaut « en échec ».
 */
export function messageEchecPublication(input: {
  projet?: string;
  etape?: string;
  raison: string;
  nature?: NaturePublication;
}): string {
  const quoi = input.projet?.trim() ? `Publication de « ${input.projet.trim()} »` : 'Publication';
  const ou = input.etape?.trim() ? ` à l’étape « ${input.etape.trim()} »` : '';
  const raison = input.raison?.trim() || 'raison inconnue';
  const verbe = input.nature === 'interrompue' ? 'interrompue' : 'en échec';
  return `${quoi} ${verbe}${ou} : ${raison} — voir le détail dans le bloc de publication du projet.`;
}
