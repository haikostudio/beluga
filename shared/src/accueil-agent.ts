import type { AgentRole } from './models.js';

/**
 * QUEL ACCUEIL MÉRITE UN AGENT QUI DÉMARRE.
 *
 * Au premier tour d'une session, le démon envoie un BRIEFING : le nom et le
 * dossier du projet, les fichiers d'instructions, les compétences partagées, et
 * l'INDEX de la mémoire. Pour un agent de tâche ou un chef d'orchestre, tout y
 * est utile : il va lire le projet, choisir où intervenir, retrouver un piège
 * déjà payé une fois.
 *
 * Pour un agent appelé EN COURS DE PUBLICATION, non. Un conflit de fusion, un
 * contrôle tombé, une construction cassée : la demande NOMME déjà les fichiers,
 * les contrôles ou la cause, dit les commandes à lancer et interdit tout le
 * reste. L'index de la mémoire grandit à chaque carte livrée et partait en
 * entier à CHAQUE incident — plusieurs fois par publication, pour un geste de
 * plomberie de trois minutes.
 *
 * Pour le CHEF D'ORCHESTRE, non plus. Depuis qu'il ne fait qu'un tri — rédiger
 * une carte courte, choisir le niveau de l'agent qui l'exécutera —, il n'a plus
 * à lire le projet avant de proposer : l'étude est faite après validation, par
 * la carte elle-même. L'index de la mémoire et les fichiers d'instructions ne
 * lui servent donc plus à rien, et ils repartaient à chaque conversation neuve.
 * Les COMPÉTENCES PARTAGÉES, elles, restent : le chef n'a pas le droit d'ouvrir
 * celles de son moteur, et sans cette ligne il répondrait « je ne sais pas
 * faire » devant un mode d'emploi qui existe (règle du sujet « methode »).
 *
 * D'où trois niveaux, et la règle qui tranche entre eux. Elle ne connaît ni base
 * ni disque : on lui donne le rôle et le MOTIF de l'appel, elle rend le niveau,
 * puis les parts que ce niveau contient.
 *
 * Ce qui ne change PAS : la règle « session neuve = accueil, session continue =
 * faits ajoutés seulement » (`server/src/runtime.ts`). Le niveau ne dit pas
 * QUAND on accueille, seulement AVEC QUOI.
 */

/** Ce qu'un agent reçoit au premier tour de sa session. */
export type NiveauDAccueil = 'complet' | 'cadrage' | 'tri' | 'minimal';

/**
 * Pourquoi cet agent est lancé, quand ce n'est pas pour une carte.
 *
 * Les trois premiers sont les DÉPANNAGES de publication : l'agent répare une
 * chose nommée puis s'efface. `mise-en-ligne` est l'agent qui mène une mise en
 * production entière d'après le prompt réglé du projet — celui-là agit sur le
 * projet dans son ensemble et garde l'accueil complet.
 */
export type MotifDAppel =
  | 'conflit'
  | 'controles'
  | 'construction'
  | 'depannage'
  | 'mise-en-ligne'
  /**
   * L'ASSISTANT QUI CONFIGURE UN SITE À SAUVEGARDER
   * (`server/src/assistant-snapshot.ts`). Il ne lit pas le projet : il lit UN
   * site, pose ses questions et enregistre une fiche. L'index de la mémoire,
   * les fichiers d'instructions et les compétences partagées ne lui serviraient
   * à rien — et seraient repayés à chaque site configuré.
   */
  | 'configuration-snapshot';

/**
 * Les dépannages : une panne nommée, réparée sur place, rien d'autre.
 *
 * `depannage` est le motif GÉNÉRIQUE des étapes qui n'avaient pas le leur —
 * envoi refusé, mise en ligne impossible, service qui ne repart pas, adresse
 * muette (`shared/src/reparation-publication.ts`). Même accueil minimal que les
 * trois autres : sa consigne NOMME la panne et les gestes attendus, elle n'a
 * rien à chercher dans l'index de la mémoire.
 */
export const MOTIFS_DE_DEPANNAGE: MotifDAppel[] = ['conflit', 'controles', 'construction', 'depannage'];

/** Les parts du briefing qu'un niveau d'accueil emporte. */
export interface PartsDAccueil {
  /** Les fichiers d'instructions du projet, et lequel fait foi. */
  instructions: boolean;
  /** La liste des compétences partagées, avec le chemin de leur mode d'emploi. */
  competences: boolean;
  /** L'index de la mémoire du projet, et l'invitation à demander un sujet. */
  memoire: boolean;
  /**
   * L'annonce de l'accès GitHub direct (`shared/src/acces-github.ts`) : l'outil
   * `gh` est identifié dans l'environnement de TOUT agent, mais celui qui
   * l'ignore propose une carte au lieu de lancer la commande.
   */
  github: boolean;
}

/**
 * Le niveau d'accueil d'un agent qui démarre.
 *
 * Minimal UNIQUEMENT pour un agent de publication appelé sur un dépannage ;
 * « cadrage » pour l'agent qui discute la tâche — la mémoire du projet, pas ses
 * fichiers d'instructions. Partout
 * ailleurs — agent de tâche, analyse, et jusqu'à la mise en ligne confiée —
 * l'accueil reste complet. Dans le doute, on accueille : un motif inconnu ne
 * rogne rien.
 */
export function niveauDAccueil(input: { role: AgentRole; motif?: MotifDAppel }): NiveauDAccueil {
  // Un assistant appelé sur une tâche NOMMÉE — configurer un site à sauvegarder
  // — n'ouvre pas le projet : sa consigne dit tout, quel que soit son rôle.
  if (input.motif === 'configuration-snapshot') return 'minimal';
  /*
   * L'AGENT QUI DISCUTE LA TÂCHE REÇOIT LA MÉMOIRE DU PROJET.
   *
   * Il n'ouvre toujours pas les fichiers du projet — il ne code pas, la carte
   * n'a pas de branche — mais discuter un besoin SANS RIEN SAVOIR du projet
   * produit un cadrage hors sol : on redit ce qui existe déjà, on propose ce
   * qui a été refusé, on ignore la règle qui interdit justement ce qu'on
   * propose. La CARTE de l'arbre de mémoire lui est donc donnée (quelques
   * lignes, une seule fois par session), et l'outil `project_memory` — qu'il
   * avait déjà — lui sert à descendre sur le sujet de la demande.
   */
  if (input.role === 'cadrage') return 'cadrage';
  if (input.role !== 'deploy') return 'complet';
  if (!input.motif) return 'complet';
  return MOTIFS_DE_DEPANNAGE.includes(input.motif) ? 'minimal' : 'complet';
}

/**
 * Ce que le niveau emporte. Le nom et le dossier du projet ne sont dans aucune
 * part : ils restent TOUJOURS dits — un agent doit savoir où il travaille.
 */
export function partsDAccueil(niveau: NiveauDAccueil): PartsDAccueil {
  // Un dépannage de publication répare une chose NOMMÉE : ni mémoire, ni
  // compétences, ni GitHub — la demande dit déjà les commandes à lancer.
  if (niveau === 'minimal') return { instructions: false, competences: false, memoire: false, github: false };
  // Le cadrage discute : ni instructions du projet, ni index de la mémoire. Les
  // compétences partagées restent, elles seules lui disent ce que HaikoDev sait
  // déjà faire (facturation…), et il n'a pas le droit d'aller les chercher.
  // L'accès GitHub reste lui aussi : consulter un dépôt ou lire une demande de
  // fusion pour répondre à une question n'est pas modifier le code du projet.
  /*
   * Le CADRAGE discute : pas les fichiers d'instructions du projet (il ne code
   * pas), mais la MÉMOIRE oui — c'est elle qui lui dit ce que le projet est
   * déjà, et d'où il peut demander un sujet en entier.
   */
  if (niveau === 'cadrage') return { instructions: false, competences: true, memoire: true, github: true };
  if (niveau === 'tri') return { instructions: false, competences: true, memoire: false, github: true };
  return { instructions: true, competences: true, memoire: true, github: true };
}
