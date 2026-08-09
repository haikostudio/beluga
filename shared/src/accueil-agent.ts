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
 * D'où deux niveaux, et la règle qui tranche entre eux. Elle ne connaît ni base
 * ni disque : on lui donne le rôle et le MOTIF de l'appel, elle rend le niveau,
 * puis les parts que ce niveau contient.
 *
 * Ce qui ne change PAS : la règle « session neuve = accueil, session continue =
 * faits ajoutés seulement » (`server/src/runtime.ts`). Le niveau ne dit pas
 * QUAND on accueille, seulement AVEC QUOI.
 */

/** Ce qu'un agent reçoit au premier tour de sa session. */
export type NiveauDAccueil = 'complet' | 'minimal';

/**
 * Pourquoi cet agent est lancé, quand ce n'est pas pour une carte.
 *
 * Les trois premiers sont les DÉPANNAGES de publication : l'agent répare une
 * chose nommée puis s'efface. `mise-en-ligne` est l'agent qui mène une mise en
 * production entière d'après le prompt réglé du projet — celui-là agit sur le
 * projet dans son ensemble et garde l'accueil complet.
 */
export type MotifDAppel = 'conflit' | 'controles' | 'construction' | 'mise-en-ligne';

/** Les dépannages : une panne nommée, réparée sur place, rien d'autre. */
export const MOTIFS_DE_DEPANNAGE: MotifDAppel[] = ['conflit', 'controles', 'construction'];

/** Les parts du briefing qu'un niveau d'accueil emporte. */
export interface PartsDAccueil {
  /** Les fichiers d'instructions du projet, et lequel fait foi. */
  instructions: boolean;
  /** La liste des compétences partagées, avec le chemin de leur mode d'emploi. */
  competences: boolean;
  /** L'index de la mémoire du projet, et l'invitation à demander un sujet. */
  memoire: boolean;
}

/**
 * Le niveau d'accueil d'un agent qui démarre.
 *
 * Minimal UNIQUEMENT pour un agent de publication appelé sur un dépannage :
 * partout ailleurs — agent de tâche, chef d'orchestre, analyse, et jusqu'à la
 * mise en ligne confiée — l'accueil reste complet. Dans le doute, on accueille :
 * un motif inconnu ne rogne rien.
 */
export function niveauDAccueil(input: { role: AgentRole; motif?: MotifDAppel }): NiveauDAccueil {
  if (input.role !== 'deploy') return 'complet';
  if (!input.motif) return 'complet';
  return MOTIFS_DE_DEPANNAGE.includes(input.motif) ? 'minimal' : 'complet';
}

/**
 * Ce que le niveau emporte. Le nom et le dossier du projet ne sont dans aucune
 * part : ils restent TOUJOURS dits — un agent doit savoir où il travaille.
 */
export function partsDAccueil(niveau: NiveauDAccueil): PartsDAccueil {
  if (niveau === 'minimal') return { instructions: false, competences: false, memoire: false };
  return { instructions: true, competences: true, memoire: true };
}
