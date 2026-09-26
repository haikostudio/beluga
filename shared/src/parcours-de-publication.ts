/*
 * CE QUE CHAQUE PARCOURS DE MISE EN LIGNE DÉROULE, ÉTAPE PAR ÉTAPE.
 *
 * Mettre en ligne compte DEUX étapes (`etapes-publication.ts`) : le
 * DÉPLOIEMENT, qui réunit le lot de « À déployer » et rafraîchit l'instance de
 * dev de ce serveur, et la MISE EN PRODUCTION, qui pousse la version déjà
 * déployée chez le client. Les deux traversent les MÊMES six étapes (clés de
 * `DeployStepKey`) — c'est la mécanique du serveur — mais elles ne font pas la
 * même chose : « Mise en ligne » rafraîchit un dossier local d'un côté,
 * transfère un paquet sur une machine distante de l'autre ; « Redémarrage »
 * relance le démon ici, ou le service du client là-bas.
 *
 * L'écran disait pourtant la MÊME phrase dans les deux cas, parce que ces
 * phrases vivaient dans le composant, en un seul exemplaire. Elles vivent
 * désormais ICI, en DEUX TABLES — une par cible —, et le volet ne fait que les
 * dessiner. Ajouter une cible, c'est ajouter une table ; renommer une étape,
 * c'est la renommer une fois.
 *
 * TROIS PRINCIPES.
 *
 *  1. LES ÉTAPES SONT DES DONNÉES, PAS DU DESSIN : libellé, phrase,
 *     explication longue et nature se lisent d'une table, jamais d'un `if`
 *     planté dans le rendu.
 *  2. UNE ÉTAPE FAITE D'AVANCE RESTE DANS LE PARCOURS. Depuis que le clic
 *     DÉSIGNE une version préparée à l'écart, « Construction » est sautée
 *     avec un motif qui dit qu'elle a déjà eu lieu. La masquer ferait croire
 *     qu'on a rogné sur le travail : elle reste visible, marquée « déjà faite
 *     en coulisses », et ne compte
 *     pas dans l'avancement (`avancement-publication.ts` écarte déjà les
 *     étapes sautées).
 *  3. RIEN N'EST INVENTÉ : l'état et le motif d'une étape viennent de la
 *     publication réelle. Sans publication, le parcours s'affiche en entier,
 *     « à venir » — c'est ce qui va se passer, et rien de plus.
 *
 * Ces règles sont PURES : ni base, ni disque, ni horloge.
 */

import type { CiblePublication } from './etapes-publication.js';
import type { DeployStepKey } from './models.js';

/* ------------------------------------------------------------------ */
/* CE QUI S'ÉCRIT QUAND UNE ÉTAPE A DÉJÀ EU LIEU À L'ÉCART             */
/* ------------------------------------------------------------------ */

/**
 * Une étape « sautée » sans motif fait croire qu'on a rogné sur un contrôle.
 * Ces deux phrases disent le contraire : le travail a été fait, simplement
 * AVANT le clic, et sur la table de montage plutôt que sur la version servie.
 *
 * Elles vivent dans les règles pures parce que l'ÉCRAN doit les reconnaître :
 * c'est à ces mots qu'il distingue une étape PRÉPARÉE (« déjà faite en
 * coulisses ») d'une étape sans objet (« ce projet n'a rien à construire »).
 */
export const RECIT_CONTROLES_A_LECART =
  'Contrôles déjà passés à l’écart, sur la version préparée d’avance : les rejouer donnerait le même résultat sur le même code.';
export const RECIT_CONSTRUIT_A_LECART =
  'Construction déjà faite à l’écart : c’est le paquet construit qui a été remis en place, sans recompilation.';

/**
 * CETTE ÉTAPE A-T-ELLE ÉTÉ FAITE D'AVANCE, PLUTÔT QUE LAISSÉE DE CÔTÉ ?
 *
 * On se garde bien de deviner à la clé de l'étape : « Construction » est
 * sautée aussi bien parce que le paquet était prêt que parce que le projet n'a
 * rien à construire. Seul le MOTIF écrit par le serveur tranche, et il
 * commence par l'un des deux récits ci-dessus — la suite du texte (le détail
 * du raccourci) ne change pas la réponse.
 */
export function etapeFaiteALEcart(motif?: string): boolean {
  const texte = (motif ?? '').trim();
  if (!texte) return false;
  return texte.startsWith(RECIT_CONTROLES_A_LECART) || texte.startsWith(RECIT_CONSTRUIT_A_LECART);
}

/* ------------------------------------------------------------------ */
/* LA TABLE D'UN PARCOURS                                              */
/* ------------------------------------------------------------------ */

/**
 * QUI MÈNE L'ÉTAPE.
 *
 * `automatique` : le démon la joue lui-même, de bout en bout. `agent` : elle
 * peut être confiée à un agent de rôle `deploy` quand le projet règle un
 * prompt de mise en production — le volet montre alors un vrai fil d'agent
 * (outils, questions) et pas un simple journal. `lot` : l'étape travaille sur
 * le LOT de cartes, elle n'existe donc qu'au déploiement.
 */
export type NatureDEtape = 'automatique' | 'agent' | 'lot';

export interface DescriptionDEtape {
  cle: DeployStepKey;
  /** Le nom d'opération, tel qu'on le lit dans la vue technique. */
  libelle: string;
  /** Ce que l'étape fait, dite à la première personne. */
  phrase: string;
  /** L'explication longue, affichée en regard de l'étape choisie. */
  explication: string;
  nature: NatureDEtape;
}

/**
 * LE PARCOURS DU DÉPLOIEMENT : réunir le lot de « À déployer », l'envoyer sur
 * le dépôt, puis rafraîchir l'instance de dev DE CE SERVEUR.
 */
const PARCOURS_DEV: readonly DescriptionDEtape[] = [
  {
    cle: 'merge',
    libelle: 'Fusion des branches',
    phrase: 'Je réunis les branches des cartes terminées.',
    explication:
      'Chaque carte du lot a travaillé sur sa propre branche. Elles sont ramenées une à une sur la branche de déploiement du projet ; une branche qui n’apporte rien est laissée de côté, et un heurt entre deux cartes est confié à un agent de dépannage plutôt que d’arrêter tout le lot.',
    nature: 'lot',
  },
  {
    cle: 'commit',
    libelle: 'Enregistrement',
    phrase: 'J’enregistre le travail réuni.',
    explication:
      'Le résultat de la fusion est inscrit dans l’historique du dépôt. Ce qui est réellement indexé est vérifié avant d’enregistrer : rien ne part sur la foi d’un état de dossier.',
    nature: 'automatique',
  },
  {
    cle: 'push',
    libelle: 'Envoi sur le dépôt',
    phrase: 'J’envoie le tout sur le dépôt.',
    explication:
      'Le code réuni rejoint le dépôt distant. C’est lui qui fait foi ensuite : si la machine tombe, le travail du lot est en sécurité.',
    nature: 'automatique',
  },
  {
    cle: 'build',
    libelle: 'Construction',
    phrase: 'Je reconstruis l’application.',
    explication:
      'Le projet est recompilé à partir du code réuni. Ce qui n’a pas changé n’est pas reconstruit, et un paquet déjà construit d’avance est repris tel quel.',
    nature: 'automatique',
  },
  {
    cle: 'publish',
    libelle: 'Mise en ligne',
    phrase: 'Je mets la nouvelle version en ligne.',
    explication:
      'L’instance de dev hébergée sur ce serveur reçoit la nouvelle version. C’est l’adresse interne du projet qui change à cet instant, pas celle du client.',
    nature: 'automatique',
  },
  {
    cle: 'restart',
    libelle: 'Redémarrage du serveur',
    phrase: 'Je relance le serveur pour qu’il serve la version fraîche.',
    explication:
      'Le service est relancé pour servir la version fraîche, puis l’adresse du projet est interrogée pour prouver qu’elle répond. Un redémarrage n’a jamais lieu tant qu’une autre publication ou une tâche tourne.',
    nature: 'automatique',
  },
];

/**
 * LE PARCOURS DE LA MISE EN PRODUCTION : la version déjà déployée part chez le
 * client. AUCUN lot de cartes — c'est une VERSION qu'on pousse, pas un paquet
 * de travaux — et les deux dernières étapes visent une machine DISTANTE.
 */
const PARCOURS_PRODUCTION: readonly DescriptionDEtape[] = [
  {
    cle: 'merge',
    libelle: 'Report sur la branche de production',
    phrase: 'Je reporte la version déployée sur la branche de production.',
    explication:
      'La branche de production rattrape la branche de déploiement. Aucune carte n’est embarquée ni déplacée : ce qui part est la version DÉJÀ déployée et vue sur l’instance de dev.',
    nature: 'automatique',
  },
  {
    cle: 'commit',
    libelle: 'Enregistrement',
    phrase: 'J’enregistre le report.',
    explication:
      'Le report est inscrit dans l’historique du dépôt, pour que la version partie chez le client soit retrouvable par son empreinte.',
    nature: 'automatique',
  },
  {
    cle: 'push',
    libelle: 'Envoi sur le dépôt',
    phrase: 'J’envoie la branche de production sur le dépôt.',
    explication:
      'La branche de production rejoint le dépôt distant. C’est cette empreinte que le bandeau du tableau affiche ensuite comme « version en production ».',
    nature: 'automatique',
  },
  {
    cle: 'build',
    libelle: 'Construction du paquet',
    phrase: 'Je prépare le paquet à transférer.',
    explication:
      'Le paquet destiné à la machine du client est construit. Quand la version a été préparée à l’écart, c’est ce paquet-là — celui qui a été contrôlé — qui est repris, sans recompilation.',
    nature: 'agent',
  },
  {
    cle: 'publish',
    libelle: 'Transfert chez le client',
    phrase: 'Je transfère la version sur la machine du client.',
    explication:
      'Le paquet part sur la machine du client, par le chemin réglé dans le projet (transfert de fichiers, connexion sécurisée, ou une procédure menée par un agent). C’est la seule étape qui sort de ce serveur.',
    nature: 'agent',
  },
  {
    cle: 'restart',
    libelle: 'Relance du service distant',
    phrase: 'Je relance le service chez le client.',
    explication:
      'Le service du client est relancé pour servir la version transférée, puis son adresse publique est interrogée pour prouver qu’elle répond.',
    nature: 'agent',
  },
];

/** La table d'étapes du parcours demandé — le déploiement par défaut. */
export function etapesDuParcours(cible?: CiblePublication): readonly DescriptionDEtape[] {
  return cible === 'production' ? PARCOURS_PRODUCTION : PARCOURS_DEV;
}

/** La description d'UNE étape du parcours demandé. */
export function descriptionDeLEtape(cle: DeployStepKey, cible?: CiblePublication): DescriptionDEtape {
  const table = etapesDuParcours(cible);
  return table.find((etape) => etape.cle === cle) ?? table[0];
}

/* ------------------------------------------------------------------ */
/* LE PARCOURS D'UNE PUBLICATION RÉELLE                                */
/* ------------------------------------------------------------------ */

export type EtatEtapeDuVolet = 'todo' | 'running' | 'done' | 'failed' | 'skipped';

/** Ce qu'on lit d'une étape de publication pour dessiner son point du parcours. */
export interface EtapeLue {
  key: string;
  state: EtatEtapeDuVolet;
  log?: string;
  reprises?: number;
}

export interface EtapeDuVolet extends DescriptionDEtape {
  etat: EtatEtapeDuVolet;
  /**
   * L'étape a été faite D'AVANCE, à l'écart, sur la version préparée. Elle
   * reste dans le parcours, marquée comme telle : elle n'a été ni rognée ni
   * oubliée.
   */
  preparee: boolean;
  /** Ce que l'étape a laissé : le motif d'un saut, la raison d'un échec. */
  motif?: string;
  /** L'étape est passée, mais après une reprise — ni échec franc, ni réussite franche. */
  rattrape: boolean;
}

/**
 * LE PARCOURS TEL QU'IL S'AFFICHE, étape par étape.
 *
 * Les SIX étapes sont TOUJOURS rendues, y compris celles que la publication a
 * sautées : une étape absente de la liste se lit comme une étape oubliée. Une
 * étape faite d'avance porte `preparee`, et le volet la marque « déjà faite en
 * coulisses » ; une étape sautée pour une autre raison garde son motif tel
 * qu'écrit par le serveur.
 *
 * Sans publication, le parcours entier s'affiche « à venir » : c'est ce qui va
 * se passer au prochain clic.
 *
 * « Vérification » (`verify`) n'est plus au parcours depuis le 23/09/2026 : elle
 * était toujours sautée. Une ANCIENNE publication qui la porte encore en base
 * s'affiche sans elle — rien ne la lit plus.
 */
export function parcoursDesEtapes(
  cible?: CiblePublication,
  run?: { steps?: readonly EtapeLue[] } | null,
): EtapeDuVolet[] {
  return etapesDuParcours(cible).map((description) => {
    const lue = run?.steps?.find((step) => step.key === description.cle);
    const etat: EtatEtapeDuVolet = lue?.state ?? 'todo';
    const motif = lue?.log?.trim() ? lue.log.trim() : undefined;
    return {
      ...description,
      etat,
      preparee: etat === 'skipped' && etapeFaiteALEcart(motif),
      motif,
      rattrape: etat === 'done' && (lue?.reprises ?? 0) > 0,
    };
  });
}

/**
 * L'ÉTAPE QU'ON OUVRE QUAND ON N'A RIEN CHOISI : celle qui travaille, sinon
 * celle qui est tombée, sinon la dernière qui a réellement joué, sinon la
 * première du parcours.
 *
 * C'est ce qu'on vient regarder, dans cet ordre exact : une publication en
 * cours pour la suivre, une publication tombée pour comprendre, une
 * publication réussie pour relire sa fin.
 */
export function etapeAOuvrir(etapes: readonly EtapeDuVolet[]): DeployStepKey | null {
  if (!etapes.length) return null;
  const enCours = etapes.find((etape) => etape.etat === 'running');
  if (enCours) return enCours.cle;
  const tombee = etapes.find((etape) => etape.etat === 'failed');
  if (tombee) return tombee.cle;
  const jouees = etapes.filter((etape) => etape.etat === 'done');
  if (jouees.length) return jouees[jouees.length - 1].cle;
  return etapes[0].cle;
}
