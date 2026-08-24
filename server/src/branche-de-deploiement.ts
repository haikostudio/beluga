/**
 * LA BRANCHE DE DÉPLOIEMENT D'UN PROJET : SON IMAGE DE CE QUI TOURNE.
 *
 * Jusqu'ici, la branche d'une carte rejoignait la branche PRINCIPALE à la
 * seconde où son agent rendait sa réponse (`refermerDossierDeCarte`). Sur un
 * projet servi depuis son dossier — c'est le cas de tous ceux que HaikoDev
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
 * (`shared/src/branche-de-publication.ts`) tranche déjà pour la publication :
 * celle réglée sur le projet, sinon « dev » quand le dépôt en a une, sinon la
 * branche principale constatée. Ce module n'y ajoute qu'une chose, mais elle
 * est indispensable : une branche qui n'existe QUE chez le dépôt distant ne
 * peut pas servir de point de départ à `git worktree add`. On la fait donc
 * exister localement avant de s'en servir, et on retombe sur la principale si
 * on n'y arrive pas — jamais d'échec de lancement pour ce motif.
 *
 * Un projet qui n'a ni réglage ni branche « dev » se comporte au signe près
 * comme avant : tout part de la principale et tout y revient, simplement au
 * clic et non plus en fin de tour.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BRANCHE_DEV_PAR_DEFAUT, brancheDePublication, type BranchesDePublication } from '@haikodev/shared';
import { log } from './logger.js';

const execFileAsync = promisify(execFile);

/* Git parle la langue de l'environnement : on la neutralise, comme ailleurs. */
const LANGUE_NEUTRE = { LC_ALL: 'C', LANG: 'C', LANGUAGE: 'C' };

async function git(cwd: string, args: string[], timeout = 30000): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, ...LANGUE_NEUTRE },
    });
    return { ok: true, out: `${stdout}${stderr}`.trim() };
  } catch (err: any) {
    return { ok: false, out: `${err?.stdout ?? ''}${err?.stderr ?? ''}${err?.message ?? ''}`.trim().slice(-800) };
  }
}

/** La branche existe-t-elle vraiment dans ce dépôt, ici et maintenant ? */
async function existeIci(racine: string, branche: string): Promise<boolean> {
  const r = await git(racine, ['rev-parse', '--verify', '--quiet', branche], 20000);
  return r.ok && !!r.out.trim();
}

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

/**
 * La branche principale du projet : celle que suit le dépôt distant, sinon
 * celle qui existe réellement. Deviner « main » sur un dépôt en « master »
 * ferait partir les cartes du mauvais endroit.
 */
export async function branchePrincipaleDuDepot(racine: string): Promise<string> {
  const distant = await git(racine, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], 20000);
  const nom = distant.ok ? distant.out.trim().replace(/^origin\//, '') : '';
  if (nom) return nom;
  for (const candidat of ['main', 'master']) {
    if (await existeIci(racine, candidat)) return candidat;
  }
  const courante = await git(racine, ['rev-parse', '--abbrev-ref', 'HEAD'], 20000);
  return courante.out.trim() || 'main';
}

/**
 * LA BRANCHE DE DÉPLOIEMENT, UTILISABLE SUR-LE-CHAMP.
 *
 * Rend un nom de branche qui existe LOCALEMENT — c'est la seule forme dont
 * `git worktree add <dossier> <depart>` sache partir. Une branche réglée ou
 * « dev » connue seulement du dépôt distant est d'abord créée d'après lui ; si
 * même cela échoue (branche réglée qui n'existe nulle part, dépôt sans
 * distant), on rend la branche principale en le DISANT au journal.
 */
export async function brancheDeDeploiement(
  racine: string,
  reglees?: BranchesDePublication,
): Promise<string> {
  const principale = await branchePrincipaleDuDepot(racine);
  const retenue = brancheDePublication({
    cible: 'dev',
    reglees,
    principale,
    branchesConnues: await branchesConnues(racine),
  }).branche;
  if (retenue === principale) return principale;
  if (await existeIci(racine, retenue)) return retenue;

  if (await existeIci(racine, `origin/${retenue}`)) {
    const cree = await git(racine, ['branch', retenue, `origin/${retenue}`], 30000);
    if (cree.ok) return retenue;
  }
  log.warn(
    `branche de déploiement « ${retenue} » introuvable dans ${racine} : on repart de « ${principale} »`,
  );
  return principale;
}

/**
 * DONNER SA BRANCHE DE DÉPLOIEMENT À UN PROJET QUI N'EN A PAS.
 *
 * Appelée au MONTAGE d'un projet — création ou reprise d'un dépôt GitHub — pour
 * que la logique s'applique dès la première carte : une branche « dev » posée
 * sur la principale, poussée quand un dépôt distant existe.
 *
 * Ne touche à rien si la branche est déjà là : reprendre un dépôt qui tient
 * déjà son « dev » ne doit ni le déplacer ni le réécrire. Rend le nom de la
 * branche à ranger dans les réglages du projet, ou rien si on n'a pas pu.
 */
export async function assurerLaBrancheDeDeploiement(
  racine: string,
  nom = BRANCHE_DEV_PAR_DEFAUT,
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

  const principale = await branchePrincipaleDuDepot(racine);
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
