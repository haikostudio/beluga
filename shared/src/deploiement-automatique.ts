/**
 * LE DÉPLOIEMENT AUTOMATIQUE D'UN PROJET.
 *
 * Un interrupteur, à DROITE de l'entête d'« À déployer », ÉTEINT PAR DÉFAUT.
 * Une fois allumé, il vaut consentement PERMANENT pour ce projet, et il ne
 * commande plus qu'UNE chose :
 *
 *  - le DÉPART du lot posé dans « À déployer », dès que plus rien ne travaille
 *    sur le projet, sans second clic sur « Publier maintenant ».
 *
 * Il ne POUSSE plus aucune carte : le passage qu'il commandait, de « Terminée »
 * vers « À déployer », n'a plus d'objet depuis le retrait de la colonne
 * « Rapport » — un travail rendu tombe directement dans le lot.
 *
 * La règle d'or n'est pas enfreinte : rien ne part de la propre initiative
 * d'une machine ou d'un agent — c'est l'utilisateur qui a allumé
 * l'interrupteur, projet par projet, et qui peut l'éteindre à tout moment.
 * Aucun agent ne peut l'allumer : le réglage ne se change que depuis
 * l'interface (`project.update`).
 *
 * CE QUI RETIENT LE LOT, et pourquoi :
 *
 *  - un agent au travail, ou une carte en « En cours » : le dossier du projet
 *    est PARTAGÉ ; publier pendant qu'un agent écrit embarque un fichier à
 *    moitié écrit (`startDeploy` refuse d'ailleurs déjà ce cas) ;
 *  - une carte qui va partir toute seule (départ programmé arrivé à échéance,
 *    « dès que possible ») : le calme est trompeur, le travail reprend dans
 *    quelques secondes ;
 *  - une publication déjà en cours sur ce projet ;
 *  - aucune carte dans « À déployer » : il n'y a rien à mettre en ligne ;
 *  - un travail terminé il y a moins d'une minute : deux cartes d'un même lot
 *    finissent rarement à la même seconde, et on ne veut pas d'une publication
 *    par carte.
 *
 * UNE CARTE QUI ATTEND UNE RÉPONSE NE COMPTE JAMAIS DANS LE LOT, même arrivée
 * dans « À déployer » : une question posée par l'agent restée sans réponse, une
 * liste de tâches refermée avec des étapes non faites, ou une discussion
 * rouverte par un message écrit sous le rapport disent toutes qu'une
 * intervention de l'utilisateur reste due. L'interrupteur ne vaut consentement
 * que pour du travail RÉELLEMENT abouti — l'appelant (côté serveur) exclut donc
 * ces cartes de `cartesADeployer` avant d'appeler cette règle, et compte ce
 * qu'il a retenu dans `cartesEnAttenteDeDecision`.
 *
 * Règle PURE : ni base, ni disque, ni git — l'appelant apporte ce qu'il a lu.
 */

/** Le calme exigé après le dernier travail rendu, avant que le lot ne parte. */
export const DELAI_DE_CALME_MS = 60_000;

/**
 * APRÈS UN ÉCHEC, ON ESPACE — ON NE S'ACHARNE PAS.
 *
 * Le 19.09.2026, le filet a rejoué `deploy.start` TOUTES LES QUINZE SECONDES
 * pendant dix minutes : une vingtaine de publications tombées à zéro seconde,
 * qui ont noyé l'historique sans jamais rien réparer. Chaque nouvel essai
 * attend désormais plus longtemps que le précédent, et le nombre d'essais est
 * plafonné : au-delà, le déploiement automatique RENONCE et le dit, au lieu de
 * remplir le journal.
 */
export const ATTENTE_APRES_ECHEC_MS = 60_000;

/** Le plafond de l'attente : une heure, pas davantage. */
export const ATTENTE_APRES_ECHEC_MAX_MS = 60 * 60_000;

/** Combien d'échecs de suite avant de renoncer. */
export const ECHECS_AVANT_ABANDON = 4;

/**
 * Combien de temps attendre avant le n-ième nouvel essai (1 = après le premier
 * échec). Chaque attente double la précédente, jusqu'au plafond.
 */
export function attenteApresEchec(echecsConsecutifs: number): number {
  const rang = Math.max(1, echecsConsecutifs);
  return Math.min(ATTENTE_APRES_ECHEC_MAX_MS, ATTENTE_APRES_ECHEC_MS * 2 ** (rang - 1));
}

export interface EtatDuDeploiementAutomatique {
  /** L'interrupteur posé dans l'entête d'« À déployer » de ce projet. */
  actif: boolean;
  /** Combien de cartes attendent, réellement prêtes à partir, dans « À déployer ». */
  cartesADeployer: number;
  /**
   * Combien de cartes de « À déployer » sont RETENUES par une décision
   * ouverte (question sans réponse), une sous-tâche non faite ou une
   * discussion rouverte — elles ne comptent pas dans `cartesADeployer`, et ne
   * partiront jamais toutes seules.
   */
  cartesEnAttenteDeDecision: number;
  /** Combien de cartes sont encore dans « En cours ». */
  cartesEnCours: number;
  /** Combien de cartes vont repartir d'elles-mêmes (programmées, « dès que possible »). */
  cartesQuiVontPartir: number;
  /** Combien d'agents travaillent encore dans le dossier (chef d'orchestre exclu). */
  agentsAuTravail: number;
  /** Une publication tourne déjà sur ce projet. */
  publicationEnCours: boolean;
  /** La procédure de l'étape de déploiement est définie. */
  procedureEnPlace: boolean;
  /** Quand le dernier travail a été rendu, en millisecondes — rien si aucune date connue. */
  dernierTravailRenduA?: number;
  /** Combien de publications de suite ont échoué sur ce projet, sans succès depuis. */
  echecsConsecutifs?: number;
  /** Quand la dernière d'entre elles est tombée, en millisecondes. */
  dernierEchecA?: number;
}

export interface DecisionDeploiementAutomatique {
  /** Le lot part-il maintenant ? */
  partir: boolean;
  /** Ce qui a été décidé, en français, pour le journal du serveur. */
  raison: string;
  /** Le déploiement automatique a RENONCÉ : il ne réessaiera plus tout seul. */
  abandon?: boolean;
}

/**
 * Le lot de « À déployer » doit-il partir MAINTENANT ?
 *
 * Chaque refus NOMME ce qui retient, dans l'ordre où on le constate : c'est
 * cette phrase qu'on lit dans le journal quand rien ne part.
 */
export function decisionDeDeploiementAutomatique(
  etat: EtatDuDeploiementAutomatique,
  maintenant: number,
): DecisionDeploiementAutomatique {
  if (!etat.actif) return { partir: false, raison: 'déploiement automatique éteint' };
  if (!etat.procedureEnPlace) return { partir: false, raison: 'aucune procédure de déploiement définie' };
  if (etat.publicationEnCours) return { partir: false, raison: 'une publication tourne déjà' };
  if (etat.agentsAuTravail > 0) {
    return { partir: false, raison: `${etat.agentsAuTravail} agent(s) travaillent encore dans le dossier` };
  }
  if (etat.cartesEnCours > 0) {
    return { partir: false, raison: `${etat.cartesEnCours} carte(s) encore en cours` };
  }
  if (etat.cartesQuiVontPartir > 0) {
    return { partir: false, raison: `${etat.cartesQuiVontPartir} carte(s) sur le point de repartir` };
  }
  if (etat.cartesADeployer < 1) {
    if (etat.cartesEnAttenteDeDecision > 0) {
      return {
        partir: false,
        raison: `${etat.cartesEnAttenteDeDecision} carte(s) attendent encore une décision de l'utilisateur`,
      };
    }
    return { partir: false, raison: 'rien à déployer dans « À déployer »' };
  }

  /*
   * LES ÉCHECS EN RAFALE S'ESPACENT, PUIS S'ARRÊTENT. Ce garde vient APRÈS les
   * refus de calme (un agent au travail n'est pas un échec) et AVANT le départ :
   * c'est le dernier mot du filet.
   */
  const echecs = etat.echecsConsecutifs ?? 0;
  if (echecs > 0) {
    if (echecs >= ECHECS_AVANT_ABANDON) {
      return {
        partir: false,
        abandon: true,
        raison: `${echecs} publications de suite ont échoué : le déploiement automatique renonce, à vous de relancer`,
      };
    }
    const depuis = maintenant - (etat.dernierEchecA ?? 0);
    const attente = attenteApresEchec(echecs);
    if (depuis < attente) {
      return {
        partir: false,
        raison: `échec n° ${echecs} il y a ${Math.round(depuis / 1000)} s : on attend ${Math.round(attente / 1000)} s avant de réessayer`,
      };
    }
  }

  const rendu = etat.dernierTravailRenduA;
  if (typeof rendu === 'number' && maintenant - rendu < DELAI_DE_CALME_MS) {
    return { partir: false, raison: 'le dernier travail vient d’être rendu, on laisse le lot se compléter' };
  }

  return {
    partir: true,
    raison: `${etat.cartesADeployer} carte(s) prête(s) et plus rien au travail : le lot part tout seul`,
  };
}

/** Ce qu'il faut savoir d'une publication passée pour compter les échecs de suite. */
export interface PublicationPassee {
  state: string;
  endedAt?: number;
  startedAt?: number;
}

/**
 * Combien de publications ont échoué D'AFFILÉE, en partant de la plus récente.
 *
 * Une réussite remet le compteur à zéro : c'est ce qui fait que le déploiement
 * automatique se remet en marche tout seul dès qu'une publication aboutit,
 * sans réglage à toucher. Une publication encore en cours ne compte ni pour ni
 * contre — on l'ignore.
 */
export function echecsConsecutifsDePublication(
  runs: PublicationPassee[],
): { echecs: number; dernierEchecA?: number } {
  let echecs = 0;
  let dernierEchecA: number | undefined;
  for (const run of runs) {
    if (run.state === 'running') continue;
    if (run.state !== 'failed') break;
    echecs += 1;
    if (dernierEchecA === undefined) dernierEchecA = run.endedAt ?? run.startedAt;
  }
  return { echecs, dernierEchecA };
}

/**
 * LE LOT AUTOMATIQUE N'EMPORTE QUE LES CARTES PRÊTES.
 *
 * Le départ automatique calculait bien les cartes RETENUES (décision attendue,
 * cadrage rouvert — DEC-161, MEM-1162), puis appelait la publication SANS liste :
 * elle reprenait alors TOUTE la colonne « À déployer », retenues comprises. La
 * liste est donc toujours explicite ; vide, rien ne part.
 */
export function lotDuDeploiementAutomatique(pretes: readonly { id: string }[]): string[] | null {
  return pretes.length ? pretes.map((carte) => carte.id) : null;
}
