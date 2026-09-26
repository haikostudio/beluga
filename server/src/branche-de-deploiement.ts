/**
 * LA BRANCHE DE DÉPLOIEMENT D'UN PROJET : SON IMAGE DE CE QUI TOURNE.
 *
 * Jusqu'ici, la branche d'une carte rejoignait la branche PRINCIPALE à la
 * seconde où son agent rendait sa réponse (`refermerDossierDeCarte`). Sur un
 * projet servi depuis son dossier — c'est le cas de tous ceux que Beluga Build
 * monte sur le serveur —, cela revenait à mettre en ligne sans que personne
 * n'ait cliqué : le travail d'une tâche terminée était servi avant même
 * d'apparaître dans « À déployer ».
 *
 * La règle est donc renversée, et elle tient en trois phrases :
 *
 *   1. chaque carte travaille sur SA branche, et sa branche ne fusionne nulle
 *      part toute seule ;
 *   2. le clic « Tout déployer » fusionne les branches du lot sur la branche de
 *      DÉPLOIEMENT — c'est elle, et elle seule, qui représente l'instance
 *      servie sur le serveur ;
 *   3. une carte lancée PART de cette même branche : elle démarre donc de ce
 *      qui tourne réellement, pas d'un tronc où d'autres cartes se seraient
 *      déjà invitées.
 *
 * Quelle branche exactement ? La règle pure `brancheDePublication`
 * (`shared/src/branche-de-publication.ts`) tranche : la branche réglée sur le
 * projet, sinon le nom IMPOSÉ par la règle d'or — « dev » au déploiement,
 * « main » à la mise en production, sur TOUS les projets. Ce module y ajoute le
 * seul geste qu'une règle pure ne peut pas faire : FAIRE EXISTER la branche.
 * Une branche connue du seul dépôt distant ne peut pas servir de point de
 * départ à `git worktree add`, et une branche qui n'existe nulle part se crée
 * d'après la principale constatée — jamais de repli silencieux sur un autre
 * schéma.
 *
 * Rien n'est jamais supprimé ni renommé : un vieux dépôt en « master » garde
 * son « master », on lui AJOUTE « dev » et « main » posées dessus.
 */

import {
  BRANCHE_DEV_PAR_DEFAUT,
  BRANCHE_PRODUCTION_PAR_DEFAUT,
  brancheDePublication,
  type BranchesDePublication,
} from '@beluga/shared';
import { log } from './logger.js';
import { branchePrincipale, existeLaBranche as existeIci, git } from './git.js';

/**
 * Les branches que ce dépôt connaît, locales ET distantes, sans le préfixe du
 * dépôt distant. Sert uniquement à savoir si une branche « dev » existe : on
 * reste sur git, sans réseau — un lancement de carte ne doit pas dépendre de la
 * joignabilité de GitHub.
 */
async function branchesConnues(racine: string): Promise<string[]> {
  const r = await git(racine, ['branch', '-a', '--format=%(refname:short)'], 30000);
  if (!r.ok) return [];
  return r.out
    .split('\n')
    .map((nom) => nom.trim().replace(/^origin\//, ''))
    .filter((nom) => nom && nom !== 'HEAD');
}

/*
 * La branche principale du projet se lit à UN SEUL endroit du démon
 * (`branchePrincipale`, `server/src/git.ts`) : ce module en avait sa propre
 * copie, comme `dossier-de-carte.ts` et `deploy.ts` — trois réponses possibles
 * à la même question.
 */

/**
 * LA BRANCHE DE DÉPLOIEMENT, UTILISABLE SUR-LE-CHAMP.
 *
 * Rend un nom de branche qui existe LOCALEMENT — c'est la seule forme dont
 * `git worktree add <dossier> <depart>` sache partir. La règle d'or impose
 * « dev » ; si elle n'existe ni ici ni chez le dépôt distant, ON LA CRÉE
 * d'après la branche principale constatée, au lieu de retomber en silence
 * ailleurs. Ce n'est qu'en dernier recours — création impossible, dépôt sans
 * le moindre enregistrement — qu'on rend la principale, en le DISANT au
 * journal : jamais d'échec de lancement pour ce motif.
 */
export async function brancheDeDeploiement(
  racine: string,
  reglees?: BranchesDePublication,
): Promise<string> {
  const principale = await branchePrincipale(racine);
  const retenue = brancheDePublication({
    cible: 'dev',
    reglees,
    principale,
    branchesConnues: await branchesConnues(racine),
  }).branche;
  if (retenue === principale) return principale;
  if (await existeIci(racine, retenue)) return retenue;

  const pose = await assurerLaBranche(racine, retenue);
  if (pose.branche) return pose.branche;

  log.warn(
    `branche de déploiement « ${retenue} » introuvable dans ${racine} (${pose.detail}) : on repart de « ${principale} »`,
  );
  return principale;
}

/**
 * FAIRE EXISTER UNE BRANCHE, ICI, MAINTENANT.
 *
 * Reprise du dépôt distant quand il l'a déjà, création d'après la branche
 * principale sinon, puis envoi au dépôt distant s'il y en a un. Ne touche à
 * rien quand la branche est déjà là : reprendre un dépôt qui tient déjà son
 * « dev » ne doit ni le déplacer ni le réécrire.
 */
export async function assurerLaBranche(
  racine: string,
  nom: string,
): Promise<{ branche?: string; creee: boolean; detail: string }> {
  if (!(await existeIci(racine, 'HEAD'))) {
    return { creee: false, detail: 'dépôt sans enregistrement : aucune branche à poser' };
  }
  if (await existeIci(racine, nom)) {
    return { branche: nom, creee: false, detail: `la branche « ${nom} » existait déjà` };
  }
  if (await existeIci(racine, `origin/${nom}`)) {
    const suivie = await git(racine, ['branch', nom, `origin/${nom}`], 30000);
    if (suivie.ok) return { branche: nom, creee: false, detail: `branche « ${nom} » reprise du dépôt distant` };
  }

  const principale = await branchePrincipale(racine);
  const cree = await git(racine, ['branch', nom, principale], 30000);
  if (!cree.ok) return { creee: false, detail: `branche « ${nom} » non créée : ${cree.out.slice(-160)}` };

  // Poussée seulement s'il y a un distant : un dépôt purement local ne doit pas
  // faire échouer le montage pour un `git push` sans destination.
  const distant = await git(racine, ['remote'], 20000);
  if (distant.ok && distant.out.trim()) {
    await git(racine, ['push', '-u', 'origin', nom], 120000);
  }
  return { branche: nom, creee: true, detail: `branche « ${nom} » créée d'après « ${principale} »` };
}

/**
 * DONNER SA BRANCHE DE DÉPLOIEMENT À UN PROJET QUI N'EN A PAS.
 *
 * Gardée pour ce seul nom : le reste du démon passe par
 * `assurerLesBranchesDeLaRegle`, qui pose les DEUX branches du schéma.
 */
export async function assurerLaBrancheDeDeploiement(
  racine: string,
  nom = BRANCHE_DEV_PAR_DEFAUT,
): Promise<{ branche?: string; creee: boolean; detail: string }> {
  return assurerLaBranche(racine, nom);
}

/** Ce que rend la pose des deux branches du schéma imposé. */
export type BranchesDeLaRegle = {
  /** Les branches à ranger dans les réglages du projet, quand on les a. */
  branches: BranchesDePublication;
  /** Une phrase par branche, pour le compte rendu du montage. */
  details: string[];
  /** Vrai quand les DEUX branches sont en place. */
  ok: boolean;
};

/**
 * LES DEUX BRANCHES DE LA RÈGLE D'OR, POSÉES SUR N'IMPORTE QUEL DÉPÔT.
 *
 * « dev » pour le déploiement, « main » pour la mise en production : tout
 * projet doit les avoir, celui qu'on monte à l'instant comme celui qui traîne
 * depuis deux ans sur « master ». Appelée au MONTAGE d'un projet et au premier
 * passage d'une publication, elle est SANS EFFET quand les deux branches sont
 * déjà là — c'est le cas courant.
 *
 * Rien n'est jamais supprimé ni renommé : un dépôt en « master » garde son
 * « master », on lui AJOUTE « main » posée dessus. La branche réglée à la main
 * sur le projet, elle, l'emporte et c'est ELLE qu'on fait exister.
 */
export async function assurerLesBranchesDeLaRegle(
  racine: string,
  reglees?: BranchesDePublication,
): Promise<BranchesDeLaRegle> {
  const voulues: [keyof BranchesDePublication, string][] = [
    ['dev', brancheDePublication({ cible: 'dev', reglees }).branche],
    ['production', brancheDePublication({ cible: 'production', reglees }).branche],
  ];
  const branches: BranchesDePublication = {};
  const details: string[] = [];
  for (const [cle, nom] of voulues) {
    const pose = await assurerLaBranche(racine, nom);
    details.push(pose.detail);
    if (pose.branche) branches[cle] = pose.branche;
  }
  return { branches, details, ok: !!branches.dev && !!branches.production };
}

/** Le nom imposé pour la mise en production, réexporté pour le confort d'appel. */
export { BRANCHE_PRODUCTION_PAR_DEFAUT };
