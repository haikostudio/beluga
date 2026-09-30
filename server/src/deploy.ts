/**
 * LA PUBLICATION — déploiement et mise en production, SANS AGENT.
 *
 * Refonte du 22/09/2026. L'ancien moteur (près de 6 000 lignes : procédures
 * rédigées suivies par un agent, agents de dépannage qui rejouaient les étapes,
 * versions préparées d'avance, cibles SSH/FTP, miroir public, vitrine liée) a
 * été retiré d'un bloc : une publication de ProjetB était restée figée plus
 * d'une heure parce qu'un agent de réparation avait relancé une construction
 * RÉUSSIE, sous un plafond de trente minutes.
 *
 * Il reste deux déroulés FIXES (règles pures : `shared/src/publication-simple.ts`) :
 *
 *  - DÉPLOYER (colonne « À déployer ») : fusionner les branches du lot dans la
 *    branche de travail, enregistrer, envoyer, lancer la commande de mise à jour
 *    du projet, relancer son service. Le même pour tous les projets.
 *  - METTRE EN PRODUCTION (bandeau du bas) : fusionner la branche de travail dans
 *    la branche de production, envoyer, puis dérouler le PROCESSUS écrit à
 *    l'initialisation, étape par étape.
 *
 * Chaque commande a une durée MAXIMALE courte ; au-delà, elle est coupée et
 * l'étape échoue en le disant. Une étape réussie n'est jamais rejouée, rien ne
 * se « répare » tout seul : une panne s'arrête net, avec sa raison.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { ZodError } from 'zod';
import {
  Card,
  CiblePublication,
  ColumnKey,
  DeployRun,
  DeployStepKey,
  Project,
  DELAIS_DU_DEPLOIEMENT_MS,
  rienAReconstruire,
  aUnProcessus,
  raisonProductionDesactivee,
  annonceDuDeploiement,
  commandeDeMiseAJour,
  servicesARelancer,
  serviceValide,
  serviceEteintVolontairement,
  constructionsServies,
  constructionPerimee,
  RECIT_SANS_MISE_A_JOUR,
  etapeDePublication,
  etapeDeLaColonne,
  etapeDeRedemarrageDePublication,
  exclusionsDesBranchesDeCartes,
  titreHorsTache,
  descriptionCartePorteuse,
  estPlomberie,
  type CommitObserve,
  type EtatProduction,
  brancheDePublication,
  avertissementsSelection,
  type AvertissementSelection,
  moduleNatifMalCompile,
  commandeDEssaiDuModuleNatif,
  commandeDeRecompilation,
  recitDeRecompilation,
  dependancesAbsentes,
  recitDePoseDesDependances,
  detailDeLEtape,
  avecEtatDeTache,
  lotMisEnLigne,
  cartesHeurtees,
  mentionDeLEcartement,
  rattrapagesAPoser,
  type CarteFusionneeDuLot,
  type EtatDeTache,
  ajouterAuJournal,
  type EtatDuMoment,
  type GenreDEvenement,
  type EvenementDEtape,
  fichiersAAjouter,
  planDEnvoi,
  envoiRefuseCarLeDistantAAvance,
  cibleDuPlanDEnvoi,
  commandesDeRattrapage,
  resumeDEchecDEnvoi,
  messageEchecPublication,
  projetDuDepot,
  depotAnnexe,
  depotsDesTitres,
  depotsDuProjet,
  type DepotsDeCarte,
  agentRetientLaPublication,
  processusJoueAuDeploiement,
} from '@beluga/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { CONFIG } from './config.js';
import { log } from './logger.js';
import { lancerCommandeBornee } from './commande-bornee.js';
import { fichiersEnConflitDuDossier, recollerLesDocumentsEnConflit } from './recollage-documentaire.js';
import { notify } from './notify.js';
import { archiveCard } from './archive.js';
import { noterLEcartementSurLaCarte, reprendreLesRattrapages } from './rattrapage-ecartee.js';
import { agentsActifs } from './runtime.js';
import { etatDemon, demanderRedemarrage, appliquerRedemarrageEnAttente } from './demon.js';
import { branchePrincipale } from './git.js';
import { remonterLeDossierDuProjet } from './remontage.js';
import { fusionnerVersLaProduction } from './fusion-vers-production.js';
import { garderLEnvoi } from './garde-contenu.js';
import { portServi, serviceDuProjet } from './services-du-projet.js';
import { depannerSeulApresLaChute } from './depannage-publication.js';

export { portServi, serviceDuProjet };

const execFileAsync = promisify(execFile);
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ */
/* Commandes                                                           */
/* ------------------------------------------------------------------ */

/** Une commande de shell, bornée, interrompue net par un arrêt demandé. */
async function runCommand(
  cwd: string,
  command: string,
  timeout = 60_000,
  signesGardes = 3000,
  signal?: AbortSignal,
): Promise<{ ok: boolean; out: string; delaiDepasse?: boolean; dureeMs?: number }> {
  return lancerCommandeBornee(cwd, command, { timeout, signesGardes, signal });
}

/** git sans shell. */
async function runGit(
  cwd: string,
  args: string[],
  timeout = 2 * 60 * 1000,
): Promise<{ ok: boolean; sortie: string; erreur: string; out: string; delaiDepasse?: boolean }> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return { ok: true, sortie: stdout, erreur: stderr, out: (stdout + stderr).slice(-3000) };
  } catch (err: any) {
    const delaiDepasse = err?.killed === true || err?.signal === 'SIGTERM';
    const erreur = (err?.stderr ?? '') + (err?.stderr ? '' : (err?.message ?? ''));
    return { ok: false, sortie: err?.stdout ?? '', erreur, out: ((err?.stdout ?? '') + erreur).slice(-3000), delaiDepasse };
  }
}

/** Les dernières lignes d'une sortie, sans couper une ligne en deux. */
export function dernieresLignes(texte: string, max = 400): string {
  const propre = texte.trim();
  if (propre.length <= max) return propre;
  const queue = propre.slice(-max);
  const saut = queue.indexOf('\n');
  return (saut === -1 ? queue : queue.slice(saut + 1)).trim() || queue.trim();
}

function raisonDe(err: unknown): string {
  if (err instanceof ZodError) {
    const champs = err.issues.map((i) => i.path.join('.') || '(racine)').join(', ') || 'champs inconnus';
    return `réponse interne invalide (${champs})`;
  }
  const message = (err as { message?: unknown } | undefined)?.message;
  if (typeof message === 'string' && message) return message;
  return typeof err === 'string' ? err : 'raison inconnue';
}

function secondes(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

/** Le dossier du projet répond-il ? Sinon on tente le remontage, une fois. */
async function dossierJoignable(dossier: string): Promise<boolean> {
  const repond = async () => {
    try {
      await fsp.readdir(dossier);
      return true;
    } catch {
      return false;
    }
  };
  if (await repond()) return true;
  if (!(await remonterLeDossierDuProjet(dossier))) return false;
  await pause(2000);
  return repond();
}

/* ------------------------------------------------------------------ */
/* Ce que l'écran demande AVANT le clic                                */
/* ------------------------------------------------------------------ */

/** Les cartes du lot : celles de la colonne source, pas encore mises en ligne. */
export function deployableCards(projectId: string, source: ColumnKey = 'to_deploy', selectedCardIds?: string[]): Card[] {
  if (etapeDeLaColonne(source)?.sansLot) return [];
  const cards = store
    .listCardsInColumn(projectId, source)
    .filter((card) => !card.excludedFromDeploy)
    .filter((card) => !card.deployedAt)
    .sort((a, b) => a.createdAt - b.createdAt);
  if (!selectedCardIds) return cards;
  const retenues = new Set(selectedCardIds);
  return cards.filter((card) => retenues.has(card.id));
}

export type ConflitPrevu = { cardId: string; title: string; branch: string; files: string[] };
export type AgentOccupe = { id: string; title: string };

/** Les agents qui écrivent dans le dossier PARTAGÉ du projet : publier dessous est refusé. */
export function agentsOccupes(projectId: string): AgentOccupe[] {
  return store
    .listAgents(projectId)
    .filter(agentRetientLaPublication)
    .map((agent) => ({ id: agent.id, title: agent.title || 'agent sans titre' }));
}

/** Les fichiers en conflit rendus par `git merge-tree --name-only`. */
export function fichiersEnConflit(sortie: string): string[] {
  const fichiers: string[] = [];
  for (const ligne of sortie.split('\n').slice(1)) {
    if (!ligne.trim()) break;
    fichiers.push(ligne.trim());
  }
  return fichiers;
}

/** Les branches du lot qui se heurteraient à la branche de travail — sans rien toucher. */
export async function conflitsPrevus(projectId: string, source: ColumnKey = 'to_deploy'): Promise<ConflitPrevu[]> {
  const project = store.getProject(projectId);
  if (!project) return [];
  const cwd = project.path;
  if (!(await runCommand(cwd, 'git rev-parse --git-dir', 20000)).ok) return [];
  const cible = etapeDeLaColonne(source)?.cible ?? 'dev';
  const mainBranch = (await brancheDeLEtape(project, cible)).branche;
  const prevus: ConflitPrevu[] = [];
  for (const card of deployableCards(projectId, source)) {
    const branch = card.github?.branch;
    if (!branch) continue;
    const exists = await runCommand(cwd, `git rev-parse --verify --quiet ${branch}`, 20000);
    if (!exists.ok || !exists.out.trim()) continue;
    const essai = await runCommand(cwd, `git merge-tree --write-tree --name-only ${mainBranch} ${branch}`, 60000);
    if (essai.ok) continue;
    const files = fichiersEnConflit(essai.out);
    if (!files.length && !essai.out.includes('CONFLICT')) continue;
    prevus.push({ cardId: card.id, title: card.title, branch, files });
  }
  return prevus;
}

/** Une carte retenue qui touche les mêmes fichiers qu'une carte laissée de côté. */
export async function avertissementsDeLaSelection(
  projectId: string,
  source: ColumnKey,
  selectedCardIds: string[],
): Promise<AvertissementSelection[]> {
  const project = store.getProject(projectId);
  if (!project) return [];
  const cwd = project.path;
  if (!(await runCommand(cwd, 'git rev-parse --git-dir', 20000)).ok) return [];
  const cible = etapeDeLaColonne(source)?.cible ?? 'dev';
  const mainBranch = (await brancheDeLEtape(project, cible)).branche;
  const avecFichiers = await Promise.all(
    deployableCards(projectId, source).map(async (card) => {
      const branch = card.github?.branch;
      if (!branch) return { id: card.id, title: card.title, files: [] as string[] };
      const exists = await runCommand(cwd, `git rev-parse --verify --quiet ${branch}`, 20000);
      if (!exists.ok || !exists.out.trim()) return { id: card.id, title: card.title, files: [] as string[] };
      const diff = await runCommand(cwd, `git diff --name-only ${mainBranch}...${branch}`, 30000);
      return { id: card.id, title: card.title, files: diff.out.split('\n').map((l) => l.trim()).filter(Boolean) };
    }),
  );
  return avertissementsSelection(avecFichiers, new Set(selectedCardIds));
}

/** CE QUE FERA LE CLIC, dit avant : une phrase, calculée depuis les réglages. */
export async function moyenDeMiseEnLigne(projectId: string, cible?: CiblePublication): Promise<{ raison: string } | null> {
  const project = store.getProject(projectId);
  if (!project) return null;
  const branche = (await brancheDeLEtape(project, cible ?? 'dev')).branche;
  if (cible === 'production') {
    const processus = project.miseEnProduction?.processus;
    return {
      raison: processus?.etapes?.length
        ? `Fusion dans « ${branche} », envoi, puis le processus du projet en ${processus.etapes.length} étape(s). Aucun agent n’intervient.`
        : 'Aucun processus de mise en production : il faut d’abord l’initialiser.',
    };
  }
  const processusEcrit = processusJoueAuDeploiement(project);
  if (processusEcrit) {
    return {
      raison: `Fusion du lot dans « ${branche} », enregistrement et envoi, puis le processus du projet en ${processusEcrit.etapes.length} étape(s). Aucun agent n’intervient.`,
    };
  }
  return {
    raison: annonceDuDeploiement({
      branche,
      commande: commandeDeMiseAJour(project.deploiement),
      service: servicesARelancer(project.deploiement).join(' '),
      estBeluga: project.isSelf,
    }),
  };
}

/** Ce qui empêche le clic, dit en clair : un projet sans processus de production. */
export function blocageMiseEnProduction(projectId: string, cible?: CiblePublication): string | null {
  if (cible !== 'production') return null;
  const project = store.getProject(projectId);
  if (!project) return null;
  return aUnProcessus(project)
    ? null
    : 'Ce projet n’a pas encore de processus de mise en production : cliquez sur « Initialiser la mise en production ».';
}

/**
 * La version en production, et de combien la version PRÊTE À PARTIR l'a dépassée.
 * Lecture pure, faite sur le dépôt local (aucun envoi, aucun agent).
 *
 * L'écart se compte contre la branche de l'étape de DÉPLOIEMENT (« dev ») : c'est
 * elle qui porte ce que le bouton « Mettre à jour la version prod » fusionnera
 * puis enverra. La branche de production ne bouge qu'au clic — la mesurer
 * contre elle donnerait « à jour » en permanence. Repli sur la branche de
 * production quand les deux étapes partagent la même branche, ou que celle du
 * déploiement n'existe pas encore (le clic la poserait sur la principale).
 *
 * La dernière tentative non réussie (échouée ou arrêtée) se dit à part : `commit`
 * et `at` restent ceux de la dernière mise en production RÉUSSIE.
 */
export async function etatDeLaProduction(projectId: string): Promise<EtatProduction> {
  const project = store.getProject(projectId);
  if (!project) return { raison: 'projet introuvable' };
  const quand = (run: DeployRun) => run.endedAt ?? run.startedAt;
  const essais = store
    .recentDeploys(projectId, 50)
    .filter((run) => run.cible === 'production')
    .sort((a, b) => quand(b) - quand(a));
  const derniere = essais.find((run) => run.state === 'success');
  const etat: EtatProduction = { commit: derniere?.targetCommit, at: derniere ? quand(derniere) : undefined };
  // Le plus récent essai TERMINÉ : s'il a réussi, tout va bien ; sinon on le dit.
  const dernierEssai = essais.find((run) => run.state !== 'running');
  if (dernierEssai && (dernierEssai.state === 'failed' || dernierEssai.state === 'stopped')) {
    etat.derniere = { etat: dernierEssai.state, at: quand(dernierEssai), erreur: dernierEssai.error };
  }
  if (!derniere) etat.raison = 'Aucune mise en production n’a encore abouti sur ce projet.';
  const cwd = project.path;
  if (!(await runCommand(cwd, 'git rev-parse --git-dir', 20000)).ok) {
    etat.raison = 'Le dossier du projet n’est pas un dépôt git : l’écart ne peut pas se mesurer.';
    return etat;
  }
  const production = (await brancheDeLEtape(project, 'production')).branche;
  const deploiement = (await brancheDeLEtape(project, 'dev')).branche;
  let branche = production;
  let tete = { ok: false, out: '' };
  for (const candidate of deploiement === production ? [production] : [deploiement, production]) {
    branche = candidate;
    tete = await runCommand(cwd, `git rev-parse --verify --quiet ${candidate}`, 20000);
    if (tete.ok && tete.out.trim()) break;
  }
  etat.branche = branche;
  if (!tete.ok || !tete.out.trim()) {
    etat.raison = `La branche « ${branche} » est introuvable dans le dépôt : l’écart ne peut pas se mesurer.`;
    return etat;
  }
  etat.commitDepot = tete.out.trim().slice(0, 40);
  if (!etat.commit) return etat;
  const compte = await runCommand(cwd, `git rev-list --count ${etat.commit}..${branche}`, 30000);
  const n = Number.parseInt(compte.out.trim(), 10);
  if (compte.ok && Number.isFinite(n)) etat.ecart = n;
  return etat;
}

/**
 * Installe la construction du dossier de travail dans le dossier SERVI. On
 * écrit d'abord à côté, puis on échange : à aucun moment l'application n'est
 * servie à moitié.
 */
function installerApplication(): string {
  const source = CONFIG.buildDir;
  if (!fs.existsSync(path.join(source, 'index.html'))) {
    throw new Error(`Rien à installer : ${source} ne contient pas d'application construite.`);
  }
  const cible = CONFIG.liveDir;
  const provisoire = `${cible}.nouveau`;
  const ancien = `${cible}.ancien`;

  fs.rmSync(provisoire, { recursive: true, force: true });
  fs.cpSync(source, provisoire, { recursive: true });

  fs.rmSync(ancien, { recursive: true, force: true });
  if (fs.existsSync(cible)) fs.renameSync(cible, ancien);
  fs.renameSync(provisoire, cible);
  fs.rmSync(ancien, { recursive: true, force: true });

  const fichiers = fs.readdirSync(path.join(cible, 'assets')).length;
  return `Application installée dans ${cible} (${fichiers} fichiers). C'est elle qui est servie.`;
}

/*
 * La branche principale du projet se lit à UN SEUL endroit du démon
 * (`branchePrincipale`, `server/src/git.ts`). La publication en avait sa
 * propre copie, passée par `bash -lc` : un dépôt pouvait être vu « main » ici
 * et « master » à l'ouverture d'une copie de travail.
 */
const mainBranchOf = branchePrincipale;

/**
 * Les branches que ce dépôt connaît, locales ET distantes, sans le préfixe du
 * dépôt distant. Sert uniquement à savoir si une branche « dev » existe : la
 * liste PROPOSÉE dans les réglages, elle, est lue chez GitHub
 * (`branchesDuDepot`). Ici on reste sur git, sans réseau — une publication ne
 * doit pas dépendre de la joignabilité de GitHub pour choisir sa branche.
 */
async function branchesConnues(cwd: string): Promise<string[]> {
  const sortie = await runCommand(
    cwd,
    "git for-each-ref --format='%(refname:short)' refs/heads refs/remotes/origin",
    20000,
    // La liste ENTIÈRE : un dépôt aux centaines de branches dépasse les 3 000
    // signes gardés par défaut, et « dev » pouvait tomber de la liste coupée.
    Infinity,
  );
  return sortie.out
    .split('\n')
    .map((ligne) => ligne.trim().replace(/^'|'$/g, ''))
    .filter((nom) => nom && nom !== 'origin/HEAD')
    .map((nom) => (nom.startsWith('origin/') ? nom.slice('origin/'.length) : nom));
}

/**
 * LA BRANCHE OÙ CETTE ÉTAPE POSE SON LOT.
 *
 * La branche réglée sur le projet l'emporte ; sans réglage, c'est le nom
 * IMPOSÉ par la règle d'or — « dev » au déploiement, « main » à la mise en
 * production, sur tous les projets. La règle elle-même est pure
 * (`shared/src/branche-de-publication.ts`) ; ici on ne fait que lui apporter ce
 * qu'on lit sur le dépôt, pour que sa RAISON dise si la branche est déjà là ou
 * reste à créer — `seposerSurLaBranche` s'en charge le moment venu.
 */
export async function brancheDeLEtape(project: Project, cible: CiblePublication) {
  const cwd = project.path;
  return brancheDePublication({
    cible,
    reglees: project.branchesDePublication,
    principale: await mainBranchOf(cwd),
    branchesConnues: await branchesConnues(cwd),
  });
}

/**
 * Se poser SUR la branche de l'étape, quitte à la CRÉER.
 *
 * Trois passes, dans cet ordre : la branche est là (cas courant) ; elle n'existe
 * que chez GitHub (un « dev » créé depuis le site, jamais rapatrié ici) ; elle
 * n'existe NULLE PART. Ce dernier cas est celui des projets d'avant la règle
 * d'or, qui n'ont ni « dev » ni « main » : la branche imposée est alors posée
 * sur la principale constatée, jamais remplacée par une autre. Sans ces
 * rattrapages, la publication s'arrêtait sur « pathspec did not match ».
 */
async function seposerSurLaBranche(cwd: string, branche: string): Promise<{ ok: boolean; out: string }> {
  const direct = await runCommand(cwd, `git checkout ${branche}`);
  if (direct.ok) return direct;

  await runCommand(cwd, `git fetch origin ${branche}`, 60000);
  const distante = await runCommand(cwd, `git rev-parse --verify --quiet origin/${branche}`, 20000);
  // Un dépôt sans distant fait sortir `rev-parse` en erreur AVEC du texte : on
  // n'accepte donc que ce qui ressemble vraiment à un enregistrement.
  if (distante.ok && /^[0-9a-f]{7,40}$/.test(distante.out.trim())) {
    const depuisDistante = await runCommand(cwd, `git checkout -B ${branche} origin/${branche}`);
    if (depuisDistante.ok) return depuisDistante;
    return { ok: false, out: `${direct.out}\n${depuisDistante.out}` };
  }

  // Nulle part : on la crée sur la principale constatée, et on la pousse.
  const principale = await mainBranchOf(cwd);
  const creee = await runCommand(cwd, `git checkout -B ${branche} ${principale}`);
  if (!creee.ok) return { ok: false, out: `${direct.out}\n${creee.out}` };
  await runGit(cwd, ['push', '-u', 'origin', branche], 120000).catch(() => undefined);
  return creee;
}

/**
 * L'ENVOI SUR LE DÉPÔT, D'UN BOUT À L'AUTRE.
 *
 * Sorti de la publication pour être CONTRÔLABLE sur un dépôt d'essai
 * (`scripts/verif-envoi-sur-le-depot.mjs`) : la branche est lue, le plan est
 * bâti par une règle pure, et rien ne part si ce plan refuse.
 */
export async function envoyerSurLeDepot(
  cwd: string,
  lancer: (args: string[]) => Promise<{ ok: boolean; sortie: string; erreur: string; out: string; delaiDepasse?: boolean }>
    = (args) => runGit(cwd, args),
): Promise<{ ok: boolean; sortie: string; commande: string; delaiDepasse?: boolean }> {
  const suivie = await runGit(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], 20000);
  const locale = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], 20000);
  const plan = planDEnvoi({
    suivie: { ok: suivie.ok, sortie: suivie.sortie },
    locale: { ok: locale.ok, sortie: locale.sortie },
  });
  if (!plan.ok) {
    // Une branche illisible ARRÊTE l'envoi : on ne pousse jamais « au cas où ».
    return {
      ok: false,
      commande: '(aucune commande lancée)',
      sortie: `${plan.raison}\n${(suivie.erreur || locale.erreur || '').trim()}`.trim(),
    };
  }
  let push = await lancer(plan.arguments);
  /*
   * LE DISTANT A AVANCÉ : ON RATTRAPE, PUIS ON RENVOIE — UNE FOIS. Rejouer le
   * même envoi retombait sur le même refus (ProjetA, six échecs de suite). On
   * récupère la branche distante, on la fusionne, et on renvoie ; un heurt
   * annule la fusion et arrête l'envoi en le nommant. Jamais d'envoi forcé.
   */
  let rattrapage = '';
  const cible = !push.ok && envoiRefuseCarLeDistantAAvance(push.out) ? cibleDuPlanDEnvoi(plan.arguments) : null;
  if (cible) {
    const commandes = commandesDeRattrapage(cible);
    const recuperee = await lancer(commandes.recuperer);
    const fusion = recuperee.ok ? await lancer(commandes.fusionner) : null;
    if (!recuperee.ok) {
      rattrapage = `Le dépôt distant a avancé, mais sa branche « ${cible.branche} » n’a pas pu être récupérée :\n${recuperee.out.trim()}\n\n`;
    } else if (!fusion?.ok) {
      await lancer(commandes.annuler);
      rattrapage = `Le dépôt distant a avancé, et ses changements heurtent ceux du lot : la fusion a été annulée, rien n’a été forcé. Réglez le heurt sur « ${cible.branche} », puis relancez.\n${fusion?.out.trim() ?? ''}\n\n`;
    } else {
      rattrapage = `Le dépôt distant avait avancé : « ${cible.distant}/${cible.branche} » récupérée et fusionnée, puis envoi rejoué.\n`;
      push = await lancer(plan.arguments);
    }
  }
  return {
    ok: push.ok,
    commande: plan.commande,
    delaiDepasse: push.delaiDepasse,
    sortie: push.ok
      ? `${rattrapage}${push.out.trim() || `${plan.commande} : terminée sans erreur.`}`
      : `${rattrapage}${resumeDEchecDEnvoi({ commande: plan.commande, sortie: push.out })}`,
  };
}

/**
 * AJOUTE CE QUI A BOUGÉ, FICHIER PAR FICHIER — jamais `git add -A` : le dossier
 * du projet est PARTAGÉ, et un autre agent (le rangement de nuit de la
 * mémoire, un chef d'orchestre) peut y avoir déposé du travail qui n'a pas à
 * partir dans CETTE publication. On relit `git status --porcelain` pour
 * connaître exactement ce que CET appel voit, et on ajoute chaque chemin
 * nommé — modifié, supprimé ou nouveau, `fichiersAAjouter` les rend tous.
 */
async function ajouterCeQuiABouge(cwd: string, statutDejaLu?: string): Promise<{ out: string; touche: boolean }> {
  /*
   * UN SEUL `git status`, UN SEUL `git add` PAR PAQUET. Sur un dépôt posé sur
   * un disque réseau (HaikoFormations, monté en sshfs), chaque `git status` à
   * froid coûte jusqu'à deux minutes : l'étape de fusion le payait deux fois
   * de suite, puis lançait un `git add` par fichier (mesuré le 21.09.2026 :
   * 250 s avant une fusion de 0,6 s). L'appelant qui vient de lire l'état le
   * repasse ; les fichiers partent par paquets de cinquante.
   */
  const statut = statutDejaLu ?? (await runCommand(cwd, 'git status --porcelain', DELAIS_DU_DEPLOIEMENT_MS.enregistrement, Infinity)).out;
  const fichiers = fichiersAAjouter(statut);
  let out = '';
  for (let i = 0; i < fichiers.length; i += 50) {
    const paquet = fichiers.slice(i, i + 50).map((f) => JSON.stringify(f)).join(' ');
    const ajout = await runCommand(cwd, `git add -- ${paquet}`);
    out += ajout.out;
  }
  return { out, touche: fichiers.length > 0 };
}

/** Les outils dont `npm run build` a besoin, et qu'aucune dépendance ordinaire n'apporte. */
const OUTILS_DE_CONSTRUCTION = ['tsc', 'vite'];

/**
 * POSER LES OUTILS DE CONSTRUCTION AVANT DE CONSTRUIRE.
 *
 * Le démon tourne avec `NODE_ENV=production` : dans cet environnement, `npm
 * install` SAUTE les dépendances de développement — donc `tsc` et `vite`, qui
 * sont exactement ce que `npm run build` appelle. Résultat : la publication
 * passait ses contrôles puis tombait aussitôt sur « tsc: not found », un échec
 * qui n'a rien à voir avec le code du projet.
 *
 * On ne touche à rien tant que les outils sont là ; sinon on les installe une
 * fois, en disant qu'on l'a fait. Aucune étape n'est ajoutée ni déplacée :
 * c'est la préparation de l'étape de construction, qui rend compte dans son
 * propre détail.
 *
 * Les outils présents ne suffisent pas : une carte fusionnée peut DÉCLARER une
 * bibliothèque que `node_modules` n'a jamais reçue (`yazl`, 10/09/2026). Une
 * dépendance déclarée et absente déclenche donc la même installation.
 */
async function poserLesOutilsDeConstruction(cwd: string): Promise<string> {
  const natif = await reparerLeModuleNatif(cwd);
  const manquants = OUTILS_DE_CONSTRUCTION.filter((outil) => !fs.existsSync(path.join(cwd, 'node_modules', '.bin', outil)));
  const absentes = dependancesNonInstallees(cwd);
  if (!manquants.length && !absentes.length) return natif;
  const pose = await runCommand(
    cwd,
    'NODE_ENV=development npm install --include=dev --no-audit --no-fund',
    10 * 60 * 1000,
  );
  if (!manquants.length) {
    return natif + recitDePoseDesDependances(absentes, pose.ok) + (pose.ok ? '' : `${pose.out.slice(-800)}\n\n`);
  }
  return natif + (pose.ok
    ? `Outils de construction absents (${manquants.join(', ')}) : installés avant de construire.\n\n`
    : `Outils de construction absents (${manquants.join(', ')}) et leur installation a échoué :\n${pose.out.slice(-800)}\n\n`);
}

/** Lit un manifeste `package.json`, ou rien s'il manque ou ne se lit pas. */
function lireManifeste(dossier: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(path.join(dossier, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Les dépendances déclarées par le projet et ses espaces de travail qu'aucun
 * `node_modules` ne porte — ni celui de la racine, ni celui de l'espace.
 */
function dependancesNonInstallees(cwd: string): string[] {
  const racine = lireManifeste(cwd) as { workspaces?: unknown } | null;
  if (!racine) return [];
  const motifs = Array.isArray(racine.workspaces) ? racine.workspaces.filter((m): m is string => typeof m === 'string') : [];
  const dossiers = [cwd];
  for (const motif of motifs) {
    if (motif.endsWith('/*')) {
      const parent = path.join(cwd, motif.slice(0, -2));
      try {
        for (const entree of fs.readdirSync(parent, { withFileTypes: true })) {
          if (entree.isDirectory()) dossiers.push(path.join(parent, entree.name));
        }
      } catch { /* dossier absent : rien à relever */ }
    } else if (!motif.includes('*')) {
      dossiers.push(path.join(cwd, motif));
    }
  }
  const absentes = new Set<string>();
  for (const dossier of dossiers) {
    const manifeste = lireManifeste(dossier);
    if (!manifeste) continue;
    const presente = (nom: string) =>
      fs.existsSync(path.join(dossier, 'node_modules', nom)) || fs.existsSync(path.join(cwd, 'node_modules', nom));
    for (const nom of dependancesAbsentes([manifeste], presente)) absentes.add(nom);
  }
  return [...absentes].sort();
}

/**
 * RECOMPILER UN MODULE NATIF VENU D'UNE AUTRE VERSION DE NODE.
 *
 * `better-sqlite3` est une bibliothèque COMPILÉE : un binaire fabriqué pour un
 * autre Node se glisse dans `node_modules` sans un mot, puis tout ce qui ouvre
 * la base refuse de démarrer. Les contrôles tombent alors en masse — 87 d'un
 * coup le 14/08/2026 — et la publication n'en nomme que les cinq premiers, ce
 * qui envoie chercher la panne dans le code des cartes, où il n'y a rien.
 *
 * On n'y touche que si le module refuse VRAIMENT de se charger : l'essai est
 * instantané, la recompilation ne part donc jamais pour rien. On recompile
 * depuis les SOURCES, une réinstallation ordinaire reprenant le binaire tout
 * fait dont on vient de constater qu'il ne marche pas.
 */
async function reparerLeModuleNatif(cwd: string): Promise<string> {
  const essai = await runCommand(cwd, commandeDEssaiDuModuleNatif(), 60 * 1000);
  if (essai.ok || !moduleNatifMalCompile(essai.out)) return '';
  const recompile = await runCommand(cwd, commandeDeRecompilation(), 10 * 60 * 1000);
  const verdict = await runCommand(cwd, commandeDEssaiDuModuleNatif(), 60 * 1000);
  return recitDeRecompilation(recompile.ok && verdict.ok);
}

/**
 * Ce qui est ENREGISTRÉ sur la branche principale mais pas encore en ligne.
 *
 * Du travail commité directement sur la principale (une correction menée sans
 * carte, par exemple) restait invisible : la fenêtre de publication disparaît
 * quand la colonne « À déployer » est vide, et plus rien ne pouvait partir en
 * ligne. Rencontré le 03/08/2026 — plusieurs heures de travail bloquées.
 */
export async function commitsEnAttente(
  projectId: string,
): Promise<{ nombre: number; titres: string[]; commits: CommitObserve[]; branche?: string }> {
  const vide = { nombre: 0, titres: [] as string[], commits: [] as CommitObserve[] };
  const project = store.getProject(projectId);
  if (!project) return vide;

  const dernier = store.lastSuccessfulDeploy(projectId);
  const principal = await commitsEnAttenteDansLeDepot(project, dernier?.targetCommit?.trim());
  /*
   * LES DÉPÔTS ANNEXES comptent aussi : leur travail enregistré sans carte se
   * lit depuis l'enregistrement que la dernière publication réussie y a poussé
   * (`DeployRun.depots`). Un annexe jamais publié n'a pas de point de départ :
   * il ne dit rien, comme le principal dans le même cas.
   */
  const commits = [...principal.commits];
  for (const annexe of project.depots ?? []) {
    const depuis = dernier?.depots?.find((d) => d.nom === annexe.nom)?.targetCommit?.trim();
    const lu = await commitsEnAttenteDansLeDepot(projetDuDepot(project, annexe), depuis, annexe.nom);
    commits.push(...lu.commits);
  }
  if (!commits.length) return { ...vide, branche: principal.branche };
  /* Les six premiers TITRES suffisent à l'affichage ; les enregistrements
     entiers servent à FICHER ce travail dans une carte, si on le demande. */
  return {
    nombre: commits.length,
    titres: commits.slice(0, 6).map((commit) => commit.titre),
    commits,
    branche: principal.branche,
  };
}

async function commitsEnAttenteDansLeDepot(
  project: Project,
  depuis: string | undefined,
  nomDuDepot?: string,
): Promise<{ commits: CommitObserve[]; branche?: string }> {
  const vide = { commits: [] as CommitObserve[] };
  const projectId = project.id;
  const cwd = project.path;
  if (!(await runCommand(cwd, 'git rev-parse --git-dir', 20000)).ok) return vide;
  if (!depuis) return vide;
  if (!(await runCommand(cwd, `git rev-parse --verify --quiet ${depuis}`, 20000)).out.trim()) return vide;
  // Le travail « déjà enregistré, pas encore en ligne » se lit sur la branche
  // où le DÉPLOIEMENT fusionne — celle réglée sur le projet, le cas échéant.
  const principale = (await brancheDeLEtape(project, 'dev')).branche;

  /*
   * CE QUI EST PORTÉ PAR LA BRANCHE D'UNE CARTE N'EST PAS ANONYME.
   *
   * Les empreintes relevées sur les cartes (`shasCouverts`) ne suffisent pas :
   * ce relevé n'existe que si l'onglet « GitHub » de la carte a été ouvert une
   * fois. On demande donc au dépôt lui-même d'écarter tout ce que les branches
   * de cartes contiennent. Une branche inconnue de git ferait tomber la
   * commande entière : on ne garde que celles qui existent, et dont le nom ne
   * porte rien qui puisse s'échapper vers le shell.
   */
  const existantes = await runCommand(cwd, "git for-each-ref --format='%(refname:short)' refs/heads", 20000, Infinity);
  const connues = new Set(
    existantes.ok ? existantes.out.split('\n').map((l) => l.trim()).filter(Boolean) : [],
  );
  const branches = store
    .branchesDeCartes(projectId)
    .filter((branche) => /^[A-Za-z0-9._\/-]+$/.test(branche) && connues.has(branche));
  const exclusions = exclusionsDesBranchesDeCartes(branches).join(' ');

  /*
   * `--no-merges` : une fusion n'apporte pas de travail à elle seule — ce
   * qu'elle réunit est déjà dans la plage, sous ses propres enregistrements.
   * Les compter annonçait « 2 modifications sans carte » qui n'étaient que les
   * fusions du déploiement précédent. Même règle que `commitsSansCarte`.
   */
  const journal = await runCommand(
    cwd,
    `git log --no-merges --format=%H%x1f%s ${depuis}..${principale} ${exclusions}`,
    30000,
  );
  if (!journal.ok) return vide;

  /*
   * Un enregistrement qui a DÉJÀ sa carte n'est plus anonyme : il compte dans
   * le lot par sa fiche, pas comme « changement sans carte ». Sans ce tri, le
   * même travail était annoncé deux fois.
   */
  const couverts = new Set(store.shasCouverts(projectId));
  const commits: CommitObserve[] = [];
  for (const ligne of journal.out.split('\n')) {
    if (!ligne.trim()) continue;
    const [sha, titre] = ligne.split('\u001f');
    if (!titre?.trim()) continue;
    if (couverts.has(sha?.trim() ?? '')) continue;
    /*
     * Les gestes de la publication elle-même (« Publication : … », fusions,
     * mise de côté avant publication) ne sont pas du travail : les compter
     * annonçait « 2 changements sans carte » juste après une mise en ligne.
     */
    if (estPlomberie(titre)) continue;
    commits.push({
      sha: sha?.trim() ?? '',
      titre: nomDuDepot ? `[${nomDuDepot}] ${titre.trim()}` : titre.trim(),
      branche: nomDuDepot ? `${nomDuDepot}:${principale}` : principale,
    });
  }
  return { commits, branche: principale };
}

/**
 * FICHER LE TRAVAIL SANS CARTE, sur demande de l'utilisateur.
 *
 * L'avertissement de la colonne « À déployer » nomme ce qui attend sans fiche ;
 * ce geste lui en donne une. La carte est posée dans « À déployer » — le travail
 * est FAIT, il n'y a rien à valider et rien à lancer — et porte les empreintes
 * trouvées, si bien que l'avertissement s'éteint de lui-même au contrôle
 * suivant : le même travail n'est jamais annoncé deux fois.
 *
 * RIEN N'EST PUBLIÉ NI FUSIONNÉ, aucune branche n'est touchée : les
 * enregistrements sont déjà là où ils sont, on ne fait qu'écrire leur fiche.
 * Tout refus est rendu en clair.
 */
export async function ficherLeTravailSansCarte(
  projectId: string,
): Promise<{ ok: boolean; error?: string; card?: Card }> {
  const project = store.getProject(projectId);
  if (!project) return { ok: false, error: 'projet introuvable' };

  const attente = await commitsEnAttente(projectId);
  if (!attente.commits.length) {
    return { ok: false, error: 'plus aucune modification sans carte : il n’y a rien à ficher' };
  }

  const maintenant = Date.now();
  const card = store.saveCard(
    Card.parse({
      id: store.newId(),
      projectId,
      title: titreHorsTache(attente.commits),
      description: descriptionCartePorteuse(attente.commits, attente.branche),
      /* Ce travail vit sur la principale : on le DIT sur la carte, comme le
         fait déjà le fichage automatique quand il ne peut pas isoler. */
      labels: ['hors tâche', 'sur la principale'],
      column: 'to_deploy',
      position: store.nextPosition(projectId, 'to_deploy'),
      origin: 'user',
      /* Rien ne sera exécuté depuis cette carte, mais le modèle en exige un :
         on prend le moteur par défaut du projet, jamais un moteur inventé. */
      run: { engine: project.defaultEngine },
      horsTache: true,
      /* Le CODE est déjà enregistré : la carte ne promet aucun travail à faire,
         et rien ne partira au moteur. */
      codeDejaEnregistre: true,
      github: {
        branch: attente.branche ?? '',
        checks: [],
        activity: [],
        commits: attente.commits.map((commit) => ({ sha: commit.sha, message: commit.titre })),
      },
      createdAt: maintenant,
      updatedAt: maintenant,
    }),
  );
  bus.emit({ type: 'card.upsert', card });
  log.info(`carte porteuse créée pour ${attente.commits.length} enregistrement(s) sans carte (${projectId})`);
  return { ok: true, card };
}

/* ------------------------------------------------------------------ */
/* LES DÉPÔTS ANNEXES d'un projet à plusieurs dépôts                   */
/* ------------------------------------------------------------------ */

/**
 * QUELS DÉPÔTS CHAQUE CARTE DU LOT A RÉELLEMENT MODIFIÉS.
 *
 * Lu sur git, dépôt par dépôt, avec le MÊME critère que la fusion des annexes :
 * la branche de la carte existe dans le dépôt ET a au moins un enregistrement
 * que la branche du déploiement n'a pas. Un travail fiché sans carte (déjà sur
 * la principale) retrouve ses dépôts par les titres de ses enregistrements.
 * Lecture seule : aucune commande n'écrit.
 */
export async function depotsTouchesParLesCartes(project: Project, cards: Card[]): Promise<DepotsDeCarte[]> {
  const depots = depotsDuProjet(project);
  const noms = depots.map((d) => d.nom);
  const touches = new Map(cards.map((card) => [card.id, new Set<string>()]));
  for (const depot of depots) {
    const annexe = depot.principal ? undefined : depotAnnexe(project, depot.nom);
    const vu = annexe ? projetDuDepot(project, annexe) : project;
    const cwd = depot.path;
    if (!(await runCommand(cwd, 'git rev-parse --git-dir', 20000)).ok) continue;
    const lot = (await brancheDeLEtape(vu, 'dev')).branche;
    // Le format entre apostrophes : `bash -lc` lit une parenthèse nue comme une erreur de syntaxe.
    // Liste ENTIÈRE (Infinity) : coupée à 3 000 signes, la branche d'une carte
    // disparaissait des dépôts aux centaines de branches (l'application ProjetC).
    const refs = await runCommand(cwd, "git for-each-ref --format='%(refname:short)' refs/heads", 20000, Infinity);
    const connues = new Set(refs.ok ? refs.out.split('\n').map((l) => l.trim()).filter(Boolean) : []);
    for (const card of cards) {
      const branch = card.github?.branch;
      if (!branch || branch === lot || !/^[A-Za-z0-9._\/-]+$/.test(branch) || !connues.has(branch)) continue;
      const avance = await runCommand(cwd, `git rev-list --count ${lot}..${branch}`, 20000);
      if (avance.ok && Number(avance.out.trim()) > 0) touches.get(card.id)!.add(depot.nom);
    }
  }
  for (const card of cards) {
    const vus = touches.get(card.id)!;
    if (vus.size || !card.horsTache) continue;
    for (const nom of depotsDesTitres((card.github?.commits ?? []).map((c) => c.message), noms)) vus.add(nom);
  }
  return cards.map((card) => ({ cardId: card.id, depots: noms.filter((nom) => touches.get(card.id)!.has(nom)) }));
}


/* ------------------------------------------------------------------ */
/* L'état d'une publication en vol                                     */
/* ------------------------------------------------------------------ */

/** Les publications réellement en vol dans ce démon, une par projet. */
const active = new Map<string, { controleur: AbortController }>();
/** La publication qui attend son tour, AVEC son étape. */
const waiting = new Map<string, { cible?: CiblePublication }>();

/** Le temps laissé à une publication toute neuve avant que le balayage la juge. */
const DELAI_AVANT_JUGEMENT_MS = 2 * 60 * 1000;

/**
 * RIEN NE RESTE COINCÉ EN « EN COURS » : une publication « en cours » en base
 * que plus rien ne porte dans ce démon (serveur redémarré, processus tué) est
 * refermée par le filet de veille, en disant pourquoi.
 */
export function balayerLesPublicationsSansPorteur(maintenant = Date.now()): number {
  let refermees = 0;
  for (const run of store.runningDeploys()) {
    if (active.has(run.projectId)) continue;
    if (maintenant - (run.startedAt ?? maintenant) < DELAI_AVANT_JUGEMENT_MS) continue;
    store.saveDeploy({
      ...run,
      state: 'failed',
      error:
        'Le travail de mise en ligne a disparu sans rendre de résultat (arrêt du serveur, coupure, ou processus tué). La publication est déclarée en échec au lieu de rester affichée « en cours ».',
      endedAt: maintenant,
    });
    refermees += 1;
    log.warn(`publication ${run.id} refermée par le balayage : plus personne ne la portait`);
  }
  return refermees;
}

/* « verify » reste une clé CONNUE — les publications d'avant le 23/09/2026 la
   portent encore en base, et leur tiroir doit s'ouvrir — mais aucune
   publication neuve ne la pose : elle était toujours sautée (DEC-255). */
const STEP_ORDER: DeployStepKey[] = ['merge', 'commit', 'push', 'build', 'publish', 'restart'];

export const STEP_LABELS: Record<DeployStepKey, string> = {
  merge: 'Fusion des branches',
  commit: 'Enregistrement',
  push: 'Envoi sur le dépôt',
  verify: 'Vérification',
  build: 'Mise à jour',
  publish: 'Mise en ligne',
  restart: 'Redémarrage',
};

/* Le fil historique de chaque étape vit À CÔTÉ de la publication, et `emit`
   le recolle à chaque enregistrement : aucune copie périmée ne peut l'effacer. */
const journaux = new Map<string, Map<DeployStepKey, EvenementDEtape[]>>();

function journalDuRun(run: DeployRun): Map<DeployStepKey, EvenementDEtape[]> {
  const connu = journaux.get(run.id);
  if (connu) return connu;
  const fil = new Map<DeployStepKey, EvenementDEtape[]>();
  for (const step of run.steps) if (step.journal?.length) fil.set(step.key, [...step.journal]);
  journaux.set(run.id, fil);
  return fil;
}

function emit(run: DeployRun): DeployRun {
  const fil = journalDuRun(run);
  const steps = run.steps.map((step) => {
    const evenements = fil.get(step.key);
    return evenements?.length ? { ...step, journal: evenements } : step;
  });
  const saved = store.saveDeploy({ ...run, steps });
  bus.emit({ type: 'deploy.upsert', run: saved });
  return saved;
}

function noter(run: DeployRun, etape: DeployStepKey, texte: string, genre: GenreDEvenement = 'progression', etat?: EtatDuMoment): DeployRun {
  const fil = journalDuRun(run);
  fil.set(etape, ajouterAuJournal(fil.get(etape), { at: Date.now(), genre, texte, ...(etat ? { etat } : {}) }));
  return emit(run);
}

function premiereLigne(texte: string): string {
  return texte.trim().split('\n').find((ligne) => ligne.trim())?.trim().slice(0, 200) ?? '';
}

function setStep(run: DeployRun, key: DeployStepKey, state: 'running' | 'done' | 'failed' | 'skipped', logText = ''): DeployRun {
  const steps = run.steps.map((step) =>
    step.key === key
      ? {
          ...step,
          state,
          log: detailDeLEtape(step.log, logText),
          progress: state === 'running' ? step.progress : undefined,
          enRetard: undefined,
          startedAt: step.startedAt ?? Date.now(),
          endedAt: state === 'running' ? undefined : Date.now(),
        }
      : step,
  );
  const raconte =
    state === 'running'
      ? `L’étape « ${STEP_LABELS[key]} » commence.`
      : state === 'done'
        ? `Étape terminée.${logText.trim() ? ` ${premiereLigne(logText)}` : ''}`
        : state === 'skipped'
          ? `Étape sautée${logText.trim() ? ` : ${premiereLigne(logText)}` : ''}.`
          : `Étape tombée${logText.trim() ? ` : ${premiereLigne(logText)}` : ''}.`;
  const etat: EtatDuMoment | undefined =
    state === 'done' ? 'fait' : state === 'failed' ? 'echec' : state === 'skipped' ? 'saute' : undefined;
  const fil = journalDuRun(run);
  fil.set(
    key,
    ajouterAuJournal(fil.get(key), {
      at: Date.now(),
      genre: state === 'running' ? 'debut' : 'issue',
      texte: raconte,
      ...(etat ? { etat } : {}),
    }),
  );
  return emit({ ...run, steps, currentStep: state === 'running' ? key : run.currentStep });
}

function progresser(run: DeployRun, key: DeployStepKey, progress: string): DeployRun {
  const steps = run.steps.map((step) => (step.key === key ? { ...step, progress } : step));
  const fil = journalDuRun(run);
  fil.set(key, ajouterAuJournal(fil.get(key), { at: Date.now(), genre: 'progression', texte: progress }));
  return emit({ ...run, steps });
}

function marquerLaTache(run: DeployRun, cardId: string, etat: EtatDeTache, detail?: string): DeployRun {
  if (!run.taches?.length) return run;
  return emit({ ...run, taches: avecEtatDeTache(run.taches, cardId, etat, detail) });
}

/** Une panne qui arrête la publication : l'étape est marquée, la raison remonte telle quelle. */
class ArretDeLaPublication extends Error {}

/* ------------------------------------------------------------------ */
/* Les dépôts d'un projet                                              */
/* ------------------------------------------------------------------ */

type DepotAPublier = {
  nom: string;
  principal: boolean;
  /** Le projet vu depuis ce dépôt : chemin, branches et réglages du dépôt. */
  projet: Project;
};

function depotsAPublier(project: Project): DepotAPublier[] {
  return depotsDuProjet(project).map((depot) => {
    const annexe = depot.principal ? undefined : depotAnnexe(project, depot.nom);
    return { nom: depot.nom, principal: depot.principal, projet: annexe ? projetDuDepot(project, annexe) : project };
  });
}

/* ------------------------------------------------------------------ */
/* Le service d'un projet                                              */
/* ------------------------------------------------------------------ */

async function systemctl(args: string, timeout: number, signal?: AbortSignal) {
  const direct = await runCommand('/', `systemctl ${args}`, timeout, 3000, signal);
  if (direct.ok || !/authentication required|access denied|permission denied|interactive/i.test(direct.out)) return direct;
  return runCommand('/', `sudo -n systemctl ${args}`, timeout, 3000, signal);
}

/**
 * RELANCER LE SERVICE D'UN PROJET, borné : le redémarrage, son état actif, puis
 * une réponse sur son port quand le projet en a un. Deux minutes au plus en
 * tout — un service qui ne répond pas dans ce délai est une panne, dite.
 */
async function relancerLeService(
  service: string,
  port: number | undefined,
  signal: AbortSignal,
  auProgres: (texte: string) => void,
): Promise<{ ok: boolean; recit: string }> {
  if (!serviceValide(service)) return { ok: false, recit: `Nom de service refusé : « ${service} ».` };
  const debut = Date.now();
  const reste = () => DELAIS_DU_DEPLOIEMENT_MS.redemarrage - (Date.now() - debut);
  const relance = await systemctl(`restart ${service}`, 60_000, signal);
  if (!relance.ok) {
    return { ok: false, recit: `Le service ${service} n’a pas pu être relancé : ${dernieresLignes(relance.out) || 'raison non précisée'}` };
  }
  let etat = '';
  while (reste() > 0 && !signal.aborted) {
    etat = (await systemctl(`is-active ${service}`, 15_000, signal)).out.trim().split('\n').pop() ?? '';
    if (etat === 'active' || etat === 'failed') break;
    await pause(2000);
  }
  if (etat !== 'active') {
    const journal = (await systemctl(`--no-pager -n 12 -o cat status ${service}`, 15_000)).out.trim();
    return {
      ok: false,
      recit: `Le service ${service} n’est pas reparti (état « ${etat || 'inconnu'} »).${journal ? `\n${journal.slice(-1200)}` : ''}`,
    };
  }
  if (!port) return { ok: true, recit: `${service} relancé et actif.` };
  auProgres(`${service} actif : on attend sa réponse sur le port ${port}…`);
  let dernier = 'aucune réponse';
  while (reste() > 0 && !signal.aborted) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(5000) });
      if (res.status < 500) return { ok: true, recit: `${service} relancé, il répond sur le port ${port} en ${secondes(Date.now() - debut)}.` };
      dernier = `erreur ${res.status}`;
    } catch (err: any) {
      dernier = err?.message ?? 'injoignable';
    }
    await pause(3000);
  }
  return {
    ok: false,
    recit: `${service} est actif mais ne répond pas sur le port ${port} après ${secondes(DELAIS_DU_DEPLOIEMENT_MS.redemarrage)} : ${dernier}.`,
  };
}

/**
 * Le service est-il éteint volontairement (désactivé et arrêté) ? Il ne se
 * relance alors pas : le déploiement ne ressuscite pas un projet mis en veille.
 */
async function eteintVolontairement(service: string, signal: AbortSignal): Promise<boolean> {
  if (!serviceValide(service)) return false;
  const activation = await systemctl(`is-enabled ${service}`, 15_000, signal);
  const etat = await systemctl(`is-active ${service}`, 15_000, signal);
  return serviceEteintVolontairement(activation.out.split('\n').pop() ?? '', etat.out.split('\n').pop() ?? '');
}

/**
 * Les constructions que sert un service, avec leur date : son unité, puis le
 * script `.sh` qu'elle lance, lus pour y trouver le fichier servi.
 */
async function constructionsDuService(service: string, dossierDuProjet: string): Promise<{ chemin: string; modifieeLe?: number }[]> {
  if (!serviceValide(service)) return [];
  const unite = await systemctl(`cat ${service}`, 15_000);
  if (!unite.ok) return [];
  let texte = unite.out;
  for (const ligne of unite.out.matchAll(/^ExecStart=(.+)$/gm)) {
    for (const mot of ligne[1].split(/\s+/)) {
      const chemin = mot.replace(/^[-@+!:]+/, '');
      if (!chemin.endsWith('.sh')) continue;
      try {
        texte += `\n${fs.readFileSync(chemin, 'utf8')}`;
      } catch {
        /* Script illisible : il n'apprend rien. */
      }
    }
  }
  const dossier = unite.out.match(/^WorkingDirectory=(.+)$/m)?.[1]?.trim().replace(/^-/, '') || dossierDuProjet;
  return constructionsServies(texte, dossier).map((chemin) => {
    try {
      return { chemin, modifieeLe: fs.statSync(chemin).mtimeMs };
    } catch {
      return { chemin };
    }
  });
}

/**
 * La date (en ms) du commit déployé, celle à laquelle la construction servie
 * doit être postérieure. Illisible (pas de git, commit inconnu) : rien, et
 * l'appelant retombe sur le début du déploiement.
 */
async function dateDuCommit(cwd: string, commit: string | undefined): Promise<number | undefined> {
  const cible = commit && /^[0-9a-f]{7,40}$/.test(commit) ? commit : 'HEAD';
  const sortie = await runCommand(cwd, `git log -1 --format=%ct ${cible}`, 20000);
  const secondesUnix = Number(sortie.out.trim().split('\n').pop());
  return sortie.ok && Number.isFinite(secondesUnix) && secondesUnix > 0 ? secondesUnix * 1000 : undefined;
}

/** L'adresse du projet répond-elle ? Un seul essai, borné. */
async function adresseRepond(url: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(DELAIS_DU_DEPLOIEMENT_MS.adresse), redirect: 'follow' });
    return res.status < 500 ? { ok: true, detail: `${url} répond (${res.status}).` } : { ok: false, detail: `${url} répond une erreur ${res.status}.` };
  } catch (err: any) {
    return { ok: false, detail: `${url} ne répond pas : ${err?.message ?? 'injoignable'}.` };
  }
}

/* ------------------------------------------------------------------ */
/* Lancer une publication                                              */
/* ------------------------------------------------------------------ */

export async function startDeploy(
  projectId: string,
  options: { cible?: CiblePublication; selectedCardIds?: string[]; depot?: string; reprises?: number; depannagesAuto?: number } = {},
): Promise<{ ok: boolean; error?: string; run?: DeployRun }> {
  const project = store.getProject(projectId);
  if (!project) return { ok: false, error: 'projet introuvable' };
  const etape = etapeDePublication(options.cible);

  if (!(await dossierJoignable(project.path))) {
    return { ok: false, error: `Le dossier du projet (${project.path}) ne répond pas : rien n’a été tenté.` };
  }
  if (etape.cible === 'production' && !aUnProcessus(project)) {
    return { ok: false, error: blocageMiseEnProduction(projectId, 'production') ?? 'Aucun processus de mise en production.' };
  }
  /* L'INTERRUPTEUR DE MISE EN PRODUCTION, éteint par défaut : tout chemin qui
     relance une production (bouton, « Relancer », file d'attente, outil
     d'agent) passe ici. Le déploiement sur ce serveur n'est jamais concerné. */
  const desactivee = etape.cible === 'production' ? raisonProductionDesactivee(project) : null;
  if (desactivee) return { ok: false, error: desactivee };
  if (active.has(projectId)) {
    waiting.set(projectId, { cible: etape.cible });
    const courante = store.latestDeploy(projectId);
    if (courante) emit({ ...courante, queued: true });
    return { ok: true, error: 'une publication est déjà en cours' };
  }
  const occupes = agentsOccupes(projectId);
  if (occupes.length) {
    return {
      ok: false,
      error: `Un agent travaille encore dans le dossier : ${occupes.map((a) => a.title).join(', ')}. Attendez qu'il ait fini, ou arrêtez-le.`,
    };
  }

  const cards = deployableCards(projectId, etape.source, options.selectedCardIds);
  const run: DeployRun = DeployRun.parse({
    id: store.newId(),
    projectId,
    state: 'running',
    steps: STEP_ORDER.map((key) => ({ key, state: 'todo' as const, log: '' })),
    cardIds: cards.map((c) => c.id),
    taches: cards.map((c) => ({ cardId: c.id, titre: c.title, branche: c.github?.branch, etat: 'attente' as const })),
    cible: etape.cible,
    reprises: options.reprises ?? 0,
    depannagesAuto: options.depannagesAuto ?? 0,
    url: etape.cible === 'dev' ? project.devUrl : undefined,
    startedAt: Date.now(),
    queued: false,
  });
  emit(run);
  const controleur = new AbortController();
  active.set(projectId, { controleur });

  void (async () => {
    let current = run;
    let redemarrageDemande = false;
    const ecartees = new Set<string>();
    try {
      if (etape.cible === 'production') {
        current = await mettreEnProduction(current, project, controleur.signal);
      } else {
        const issue = await deployer(current, project, cards, ecartees, controleur.signal);
        current = issue.run;
        redemarrageDemande = issue.redemarrageDemande;
      }
      if (controleur.signal.aborted) throw new ArretDeLaPublication('arrêt demandé');

      /* Ranger les cartes est de la comptabilité : une carte illisible ne fait
         jamais échouer une mise en ligne réussie, l'incident se DIT. */
      const nonRangees: string[] = [];
      for (const cardId of current.cardIds.filter((id) => !ecartees.has(id))) {
        try {
          const card = store.getCard(cardId);
          if (!card) continue;
          const deployed = store.saveCard({ ...card, deployedAt: Date.now() });
          bus.emit({ type: 'card.upsert', card: deployed });
          if (etape.clot) {
            const rangee = await archiveCard(cardId);
            if (!rangee.ok) nonRangees.push(`« ${card.title} » (${rangee.error ?? 'raison inconnue'})`);
          }
        } catch (err) {
          nonRangees.push(`${cardId} (${raisonDe(err)})`);
        }
      }

      current = emit({
        ...current,
        state: 'success',
        endedAt: Date.now(),
        currentStep: undefined,
        cardIds: current.cardIds.filter((id) => !ecartees.has(id)),
        taches: current.taches?.length ? lotMisEnLigne(current.taches) : current.taches,
        avertissement: nonRangees.length ? `Carte(s) non rangée(s) après la mise en ligne : ${nonRangees.join(', ')}.` : undefined,
      });

      /* LA CARTE ÉCARTÉE SE RÉPARE APRÈS, JAMAIS PENDANT (DEC-255) : un
         rattrapage est ÉCRIT sur sa tâche — il survit au redémarrage — et ne
         part qu'une fois ce redémarrage passé (DEC-166). Une fois par carte et
         par publication (`shared/src/rattrapage-ecartee.ts`). */
      if (ecartees.size && current.taches?.length) {
        current = emit({ ...current, taches: rattrapagesAPoser(current.taches, Date.now(), redemarrageDemande) });
      }

      const reste = ecartees.size ? ` — ${ecartees.size} carte(s) écartée(s), restée(s) à déployer` : '';
      const bilan = etape.sansLot
        ? `Version en production : ${current.targetCommit?.slice(0, 7) ?? 'enregistrement inconnu'}`
        : `${current.cardIds.length} tâche(s) en ligne${reste}`;
      notify({
        motif: 'publication-terminee',
        title: `Publication terminée (${etape.libelle})`,
        body: bilan,
        reference: `${projectId}:${etape.cible}:${current.targetCommit ?? current.cardIds.join(',')}`,
        element: `${bilan} (${etape.libelle})`,
        projectId,
      });
      bus.toast(ecartees.size ? 'info' : 'success', `Publication terminée (${etape.libelle})${reste}`);
      if (redemarrageDemande) setTimeout(() => void demanderRedemarrage(), 2000);
      else if (ecartees.size) setTimeout(() => void reprendreLesRattrapages(), 5000);
    } catch (err) {
      const arrete = controleur.signal.aborted;
      const raison = arrete ? 'Arrêt demandé.' : raisonDe(err);
      current = store.getDeploy(current.id) ?? current;
      current = emit({
        ...current,
        state: arrete ? 'stopped' : 'failed',
        error: raison,
        endedAt: Date.now(),
        steps: current.steps.map((s) => (s.state === 'running' ? { ...s, state: 'failed' as const, progress: undefined, endedAt: Date.now() } : s)),
      });
      const etapeTombee = current.steps.find((s) => s.state === 'failed')?.key ?? current.currentStep;
      bus.toast(
        'error',
        messageEchecPublication({ projet: project.name, etape: etapeTombee ? STEP_LABELS[etapeTombee] : undefined, raison }),
      );
      if (!arrete) {
        notify({
          motif: 'publication-echec',
          title: `Publication en échec (${etape.libelle})`,
          body: `${current.cardIds.length} tâche(s) restent à déployer — ${raison}`,
          reference: `${projectId}:echec:${current.id}`,
          element: `Publication en échec — ${raison}`,
          projectId,
        });
        /* LE DÉPANNEUR PART SEUL, mais APRÈS le `finally` (différé) : il ne retient
           ni `active`, ni la file, ni le redémarrage en attente. Seule la chute
           d'une vraie casse le déclenche (jamais un arrêt, une coupure, une
           saturation — la règle pure tranche). */
        const tombee = current.id;
        setTimeout(() => void depannerSeulApresLaChute(tombee), 2000);
      }
    } finally {
      journaux.delete(current.id);
      active.delete(projectId);
      const suivante = waiting.get(projectId);
      if (suivante) {
        waiting.delete(projectId);
        setTimeout(() => void startDeploy(projectId, { cible: suivante.cible }), 1500);
      } else if (active.size === 0) {
        appliquerRedemarrageEnAttente();
      }
    }
  })();

  return { ok: true, run };
}

/* ------------------------------------------------------------------ */
/* Le déploiement                                                      */
/* ------------------------------------------------------------------ */

async function deployer(
  depart: DeployRun,
  project: Project,
  cards: Card[],
  ecartees: Set<string>,
  signal: AbortSignal,
): Promise<{ run: DeployRun; redemarrageDemande: boolean }> {
  let current = depart;
  const depots = depotsAPublier(project);
  const multi = depots.length > 1;
  const prefixe = (d: DepotAPublier) => (multi ? `[${d.nom}] ` : '');
  const arreter = (key: DeployStepKey, texte: string): never => {
    current = setStep(current, key, 'failed', texte);
    throw new ArretDeLaPublication(premiereLigne(texte));
  };
  const verifierArret = () => {
    if (signal.aborted) throw new ArretDeLaPublication('arrêt demandé');
  };

  /* Dépôts réellement git : un projet sans dépôt n'a rien à fusionner. */
  const gits: DepotAPublier[] = [];
  for (const d of depots) if ((await runCommand(d.projet.path, 'git rev-parse --git-dir', 20000)).ok) gits.push(d);
  const brancheParDepot = new Map<string, string>();

  /* ---------- 1. Fusion ---------- */
  current = setStep(current, 'merge', 'running');
  const recitFusion: string[] = [];
  for (const d of gits) {
    const cwd = d.projet.path;
    const branche = (await brancheDeLEtape(d.projet, 'dev')).branche;
    brancheParDepot.set(d.nom, branche);

    /* Le dossier est PARTAGÉ : un travail laissé non enregistré est enregistré
       sur sa propre branche avant de bouger, jamais perdu ni écrasé. */
    const statut = await runCommand(cwd, 'git status --porcelain', DELAIS_DU_DEPLOIEMENT_MS.enregistrement, Infinity, signal);
    if (!statut.ok) arreter('merge', `${prefixe(d)}L’état du dépôt n’a pas pu être lu : ${dernieresLignes(statut.out)}`);
    if (statut.out.trim()) {
      const courante = (await runCommand(cwd, 'git rev-parse --abbrev-ref HEAD', 20000)).out.trim() || 'branche courante';
      await ajouterCeQuiABouge(cwd, statut.out);
      const enregistre = await runCommand(
        cwd,
        `git commit -m "Travaux en cours enregistrés avant publication" -m "Branche ${courante}"`,
        DELAIS_DU_DEPLOIEMENT_MS.enregistrement,
      );
      recitFusion.push(`${prefixe(d)}${courante} : travaux en cours ${enregistre.ok ? 'enregistrés' : 'NON enregistrés'}`);
    }

    const pose = await seposerSurLaBranche(cwd, branche);
    if (!pose.ok) arreter('merge', `${prefixe(d)}Impossible de se poser sur « ${branche} » : ${dernieresLignes(pose.out)}`);

    /* Ce que chaque carte fusionnée a apporté : c'est ce qui permet, quand la
       suivante heurte, de nommer CONTRE QUI (MEM-1064, `cartesHeurtees`). */
    const fusionnees: CarteFusionneeDuLot[] = [];
    for (const card of cards) {
      verifierArret();
      const branch = card.github?.branch;
      if (!branch || ecartees.has(card.id)) continue;
      const existe = await runCommand(cwd, `git rev-parse --verify --quiet ${branch}`, 20000);
      if (!existe.ok || !existe.out.trim()) {
        if (d.principal) current = marquerLaTache(current, card.id, 'absente');
        continue;
      }
      current = progresser(current, 'merge', `${prefixe(d)}Fusion de ${branch}…`);
      current = marquerLaTache(current, card.id, 'fusion');
      noter(current, 'merge', `$ git merge --no-edit ${branch}`, 'commande');
      const avant = (await runCommand(cwd, 'git rev-parse HEAD', 20000)).out.trim();
      const fusion = await runCommand(cwd, `git merge --no-edit ${branch}`, DELAIS_DU_DEPLOIEMENT_MS.fusion, 3000, signal);
      const retenirLApport = async () => {
        const apport = avant ? await runCommand(cwd, `git diff --name-only ${avant} HEAD`, 20000) : null;
        fusionnees.push({
          cardId: card.id,
          titre: card.title,
          branche: branch,
          commit: existe.out.trim() || undefined,
          fichiers: apport?.ok ? apport.out.split('\n').map((f) => f.trim()).filter(Boolean) : [],
        });
      };
      if (fusion.ok) {
        recitFusion.push(`${prefixe(d)}${branch} : fusionnée`);
        current = marquerLaTache(current, card.id, 'fusionnee');
        await retenirLApport();
        continue;
      }
      /* Un heurt purement DOCUMENTAIRE se recolle mécaniquement (MEM-1152) ;
         tout autre heurt ÉCARTE la carte, nommée, sans appeler personne. */
      const enConflit = await fichiersEnConflitDuDossier(cwd);
      const recollage = fusion.delaiDepasse ? null : await recollerLesDocumentsEnConflit(cwd, enConflit);
      if (recollage?.fusionnee) {
        recitFusion.push(`${prefixe(d)}${branch} : ${recollage.recit}`);
        current = marquerLaTache(current, card.id, 'recollee', enConflit.join(', '));
        await retenirLApport();
        continue;
      }
      await runCommand(cwd, 'git merge --abort', 30000);
      /* LA PHRASE NOMMÉE (MEM-1064) : les fichiers, et chaque carte du lot déjà
         passée qui les a touchés — ou, faute de carte, la branche d'accueil. */
      const contre = cartesHeurtees(enConflit, fusionnees);
      const raison = fusion.delaiDepasse
        ? `la fusion n’a pas rendu la main en ${secondes(DELAIS_DU_DEPLOIEMENT_MS.fusion)}`
        : mentionDeLEcartement({ branche: branch, brancheDAccueil: branche, fichiers: enConflit, contre });
      ecartees.add(card.id);
      recitFusion.push(
        `${prefixe(d)}${fusion.delaiDepasse ? `${branch} : ÉCARTÉE — ${raison}.` : raison} La carte reste dans « À déployer ».`,
      );
      current = marquerLaTache(current, card.id, 'ecartee', raison);
      if (current.taches?.length) {
        current = emit({
          ...current,
          taches: current.taches.map((t) =>
            t.cardId === card.id ? { ...t, ecart: { fichiers: enConflit, brancheDAccueil: branche, contre } } : t,
          ),
        });
      }
      noterLEcartementSurLaCarte(card, raison);
    }
  }
  if (cards.length && ecartees.size === cards.length) {
    arreter('merge', `${recitFusion.join('\n')}\n\nToutes les cartes du lot sont en conflit : rien n’a pu être fusionné.`);
  }
  current = setStep(
    current,
    'merge',
    gits.length ? 'done' : 'skipped',
    gits.length ? recitFusion.join('\n') || 'Aucune branche à fusionner.' : 'Projet sans dépôt git.',
  );
  verifierArret();

  /* ---------- 2. Enregistrement ---------- */
  current = setStep(current, 'commit', 'running');
  const recitCommit: string[] = [];
  for (const d of gits) {
    const cwd = d.projet.path;
    const statut = await runCommand(cwd, 'git status --porcelain', DELAIS_DU_DEPLOIEMENT_MS.enregistrement, Infinity, signal);
    if (!statut.ok) arreter('commit', `${prefixe(d)}L’état du dépôt n’a pas pu être lu : ${dernieresLignes(statut.out)}`);
    if (!statut.out.trim()) continue;
    await ajouterCeQuiABouge(cwd, statut.out);
    /* L'INDEX RÉEL fait foi, jamais `git status` seul. */
    const indexe = await runCommand(cwd, 'git diff --cached --name-only', 30000);
    if (!indexe.out.trim()) continue;
    const commit = await runCommand(cwd, `git commit -m "Publication : ${cards.length} tâche(s)" -m "Beluga Build"`, DELAIS_DU_DEPLOIEMENT_MS.enregistrement);
    if (!commit.ok) arreter('commit', `${prefixe(d)}L’enregistrement a échoué : ${dernieresLignes(commit.out)}`);
    recitCommit.push(`${prefixe(d)}${premiereLigne(commit.out)}`);
  }
  current = setStep(current, 'commit', recitCommit.length ? 'done' : 'skipped', recitCommit.join('\n') || 'Rien à enregistrer.');
  verifierArret();

  /* ---------- 3. Envoi ---------- */
  current = setStep(current, 'push', 'running');
  const recitEnvoi: string[] = [];
  const etatsDepots: NonNullable<DeployRun['depots']> = [];
  for (const d of gits) {
    const cwd = d.projet.path;
    const tete = (await runCommand(cwd, 'git rev-parse HEAD', 20000)).out.trim().slice(0, 40);
    if (d.principal) current = emit({ ...current, targetCommit: tete });
    const aDistant = (await runCommand(cwd, 'git remote', 20000)).out.trim().length > 0;
    if (!aDistant) {
      recitEnvoi.push(`${prefixe(d)}aucun dépôt distant : rien à envoyer`);
    } else {
      if (d.principal && project.depotSansDonneesSensibles) {
        const garde = await garderLEnvoi(
          cwd,
          brancheParDepot.get(d.nom) ?? 'dev',
          cards.map((card) => ({ titre: card.title, branche: card.github?.branch })),
        );
        if (!garde.ok) arreter('push', garde.recit);
      }
      current = progresser(current, 'push', `${prefixe(d)}Envoi de « ${brancheParDepot.get(d.nom)} »…`);
      const envoi = await envoyerSurLeDepot(cwd, (args) => runGit(cwd, args, DELAIS_DU_DEPLOIEMENT_MS.envoi));
      if (!envoi.ok) {
        arreter(
          'push',
          `${prefixe(d)}${envoi.delaiDepasse ? `L’envoi n’a pas rendu la main en ${secondes(DELAIS_DU_DEPLOIEMENT_MS.envoi)}.\n` : ''}${envoi.sortie}`,
        );
      }
      recitEnvoi.push(`${prefixe(d)}${envoi.commande} : envoyé`);
    }
    if (!d.principal) etatsDepots.push({ nom: d.nom, etat: 'reussi', targetCommit: tete });
  }
  if (etatsDepots.length) current = emit({ ...current, depots: etatsDepots });
  current = setStep(current, 'push', gits.length ? 'done' : 'skipped', recitEnvoi.join('\n') || 'Projet sans dépôt git.');
  verifierArret();

  /* ---------- 4 à 6. Mise à jour, mise en ligne, redémarrage ---------- */
  /* CE QUI N'A PAS CHANGÉ NE SE RECONSTRUIT PAS : depuis la dernière mise en
     ligne réussie, seule de la documentation a bougé (le journal des
     livraisons, par exemple) → la mise à jour et le redémarrage sont sautés. */
  const derniere = store.lastSuccessfulDeploy(project.id);
  const inchanges = new Set<string>();
  for (const d of gits) {
    const tete = d.principal ? current.targetCommit : current.depots?.find((x) => x.nom === d.nom)?.targetCommit;
    const avant = d.principal ? derniere?.targetCommit : derniere?.depots?.find((x) => x.nom === d.nom)?.targetCommit;
    if (!tete || !avant) continue;
    const diff = await runCommand(d.projet.path, `git diff --name-only ${avant} ${tete}`, 30000, Infinity);
    if (diff.ok && rienAReconstruire(diff.out.split('\n'))) inchanges.add(d.nom);
  }
  const inchange = (d: DepotAPublier) => inchanges.has(d.nom);

  let redemarrageDemande = false;
  if (project.isSelf) {
    if (inchange(depots[0])) {
      current = setStep(current, 'build', 'skipped', 'Rien n’a changé depuis la dernière mise en ligne : pas de reconstruction.');
      current = setStep(current, 'publish', 'skipped', 'La version servie est déjà celle-ci.');
      current = setStep(current, 'restart', 'skipped', 'Rien à relancer.');
    } else {
      const cwd = project.path;
      current = setStep(current, 'build', 'running');
      current = progresser(current, 'build', 'Outils de construction et module natif…');
      const outils = await poserLesOutilsDeConstruction(cwd);
      current = progresser(current, 'build', '$ npm run build');
      const build = await runCommand(cwd, 'npm run build', DELAIS_DU_DEPLOIEMENT_MS.miseAJour, 4000, signal);
      if (!build.ok) arreter('build', `${outils}La construction a échoué${build.delaiDepasse ? ' (délai dépassé)' : ''} :\n${dernieresLignes(build.out, 2500)}`);
      current = setStep(current, 'build', 'done', `${outils}Construit en ${secondes(build.dureeMs ?? 0)}.`);

      current = setStep(current, 'publish', 'running');
      let installe = '';
      try {
        installe = installerApplication();
      } catch (err) {
        arreter('publish', `L’installation dans le dossier servi a échoué : ${raisonDe(err)}`);
      }
      current = setStep(current, 'publish', 'done', installe);

      /* Le démon porte TOUS les agents : il ne redémarre jamais sous l'un
         d'eux, ni sous une autre publication (DEC-166). La demande est
         RETENUE et repart dès que la voie est libre. */
      const etat = etatDemon();
      const decision = etapeDeRedemarrageDePublication({
        redemarrageNecessaire: etat.redemarrageNecessaire,
        agents: agentsActifs().length,
        agentsDetail: etat.agentsDetail,
        autresPublications: store
          .runningDeploys()
          .filter((r) => r.id !== current.id)
          .map((r) => store.getProject(r.projectId)?.name ?? 'un projet'),
      });
      current = setStep(current, 'restart', decision.etat, decision.message);
      redemarrageDemande = decision.retenir;
    }
  } else {
    const miseAJour: string[] = [];
    const relances: string[] = [];
    let aJoue = false;
    let aRelance = false;
    /* LE PROCESSUS ÉCRIT PAR L'AGENT DE CONFIGURATION DU DÉPLOIEMENT
       (29/09/2026) : présent, il REMPLACE la commande et les services du dépôt
       principal, joué tel quel, arrêt net à la première étape qui échoue.
       Absent, le déroulé commun ci-dessous reste en service. Les dépôts
       annexes gardent leurs propres réglages. */
    const processusEcrit = processusJoueAuDeploiement(project);
    const parLeProcessus = (d: DepotAPublier) => d.principal && !!processusEcrit;
    current = setStep(current, 'build', 'running');
    for (const d of depots) {
      if (parLeProcessus(d) && processusEcrit) {
        if (inchange(d)) {
          miseAJour.push(`${prefixe(d)}rien n’a changé depuis la dernière mise en ligne : le processus du projet n’est pas rejoué.`);
          continue;
        }
        for (const [rang, etape] of processusEcrit.etapes.entries()) {
          verifierArret();
          const entete = `${prefixe(d)}${rang + 1}/${processusEcrit.etapes.length} · ${etape.libelle}`;
          current = progresser(current, 'build', entete);
          current = noter(current, 'build', `$ ${etape.commande}`, 'commande');
          const sortie = await runCommand(d.projet.path, etape.commande, etape.delaiS * 1000, 4000, signal);
          miseAJour.push(
            `${entete} — ${sortie.ok ? `terminée en ${secondes(sortie.dureeMs ?? 0)}` : 'ÉCHEC'}\n$ ${etape.commande}\n${dernieresLignes(sortie.out, sortie.ok ? 400 : 2500)}`,
          );
          if (!sortie.ok) {
            arreter(
              'build',
              `L’étape ${rang + 1} « ${etape.libelle} » ${sortie.delaiDepasse ? `n’a pas rendu la main en ${etape.delaiS} s` : 'a échoué'} : le processus s’arrête là.\n\n${miseAJour.join('\n\n')}`,
            );
          }
        }
        aJoue = true;
        continue;
      }
      const commande = commandeDeMiseAJour(d.projet.deploiement);
      if (!commande) continue;
      if (inchange(d)) {
        miseAJour.push(`${prefixe(d)}rien n’a changé depuis la dernière mise en ligne : « ${commande} » n’est pas relancée.`);
        continue;
      }
      verifierArret();
      current = progresser(current, 'build', `${prefixe(d)}$ ${commande}`);
      const sortie = await runCommand(d.projet.path, commande, DELAIS_DU_DEPLOIEMENT_MS.miseAJour, 4000, signal);
      if (!sortie.ok) {
        arreter(
          'build',
          `${prefixe(d)}« ${commande} » a échoué${sortie.delaiDepasse ? ` : pas de réponse en ${secondes(DELAIS_DU_DEPLOIEMENT_MS.miseAJour)}` : ''}.\n${dernieresLignes(sortie.out, 2500)}`,
        );
      }
      aJoue = true;
      miseAJour.push(`${prefixe(d)}« ${commande} » terminée en ${secondes(sortie.dureeMs ?? 0)}.\n${dernieresLignes(sortie.out, 600)}`);
    }
    current = setStep(
      current,
      'build',
      aJoue ? 'done' : 'skipped',
      miseAJour.join('\n\n') || 'Aucune commande de mise à jour réglée pour ce projet.',
    );
    current = setStep(
      current,
      'publish',
      'done',
      'Le code est en place dans le dossier du projet.',
    );

    current = setStep(current, 'restart', 'running');
    for (const d of depots) {
      /* Le processus écrit porte lui-même ses redémarrages. */
      if (parLeProcessus(d)) continue;
      const services = servicesARelancer(d.projet.deploiement);
      if (!services.length) continue;
      if (inchange(d)) {
        relances.push(`${prefixe(d)}rien n’a changé : ${services.join(', ')} ${services.length > 1 ? 'ne sont pas relancés' : 'n’est pas relancé'}.`);
        continue;
      }
      /* Le port du projet ne se contrôle qu'après le DERNIER service : les
         autres (une API, un worker) n'écoutent pas forcément dessus. */
      const relancesIci: string[] = [];
      for (const [rang, service] of services.entries()) {
        verifierArret();
        if (await eteintVolontairement(service, signal)) {
          relances.push(`${prefixe(d)}${service} est éteint volontairement (désactivé) : il n’est pas rallumé.`);
          continue;
        }
        current = progresser(current, 'restart', `${prefixe(d)}Redémarrage de ${service}…`);
        const port = rang === services.length - 1 ? d.projet.port : undefined;
        const bilan = await relancerLeService(service, port, signal, (texte) => {
          current = progresser(current, 'restart', `${prefixe(d)}${texte}`);
        });
        if (!bilan.ok) arreter('restart', `${prefixe(d)}${bilan.recit}`);
        aRelance = true;
        relancesIci.push(service);
        relances.push(`${prefixe(d)}${bilan.recit}`);
      }
      /* LE SITE SERT-IL LE NOUVEAU CODE ? Un service relancé sur une
         construction d'AVANT le code déployé montre l'ancienne version : c'est
         un échec, dit comme tel, avec ce qu'il faut régler. La référence est
         la date du commit visé (une relance sans nouvelle fusion sert un site
         construit avant le clic, mais à jour) ; une construction encore
         vieille est ré-examinée un temps BORNÉ, le service la refaisant
         peut-être en ce moment. */
      const tete = d.principal ? current.targetCommit : current.depots?.find((x) => x.nom === d.nom)?.targetCommit;
      const dateDuCode = (await dateDuCommit(d.projet.path, tete)) ?? current.startedAt ?? Date.now();
      for (const service of relancesIci) {
        const examiner = async () =>
          constructionPerimee({ constructions: await constructionsDuService(service, d.projet.path), dateDuCode });
        let perimee = await examiner();
        const echeance = Date.now() + DELAIS_DU_DEPLOIEMENT_MS.reconstruction;
        while (perimee && Date.now() < echeance) {
          verifierArret();
          current = progresser(
            current,
            'restart',
            `${prefixe(d)}${service} sert encore une construction antérieure au code déployé : attente de sa reconstruction…`,
          );
          await pause(5000);
          verifierArret();
          perimee = await examiner();
        }
        if (perimee) arreter('restart', `${prefixe(d)}${relances.join('\n')}\n\n${prefixe(d)}${perimee}`);
      }
    }
    const rienDeRegle =
      !processusEcrit &&
      depots.every((d) => !commandeDeMiseAJour(d.projet.deploiement) && !servicesARelancer(d.projet.deploiement).length);
    current = setStep(
      current,
      'restart',
      aRelance ? 'done' : 'skipped',
      relances.join('\n') ||
        (processusEcrit
          ? 'Le processus du projet porte lui-même ses redémarrages.'
          : rienDeRegle
            ? RECIT_SANS_MISE_A_JOUR
            : 'Aucun service réglé pour ce projet : rien à relancer.'),
    );
  }

  /* LE RÉSULTAT, pas le processus : l'adresse du projet répond-elle ? */
  if (project.devUrl?.trim() && !project.isSelf) {
    const controle = await adresseRepond(project.devUrl.trim());
    current = noter(current, 'restart', controle.detail, 'issue', controle.ok ? 'fait' : 'echec');
    if (!controle.ok) throw new ArretDeLaPublication(controle.detail);
  }
  return { run: current, redemarrageDemande };
}

/* ------------------------------------------------------------------ */
/* La mise en production                                               */
/* ------------------------------------------------------------------ */

async function mettreEnProduction(depart: DeployRun, project: Project, signal: AbortSignal): Promise<DeployRun> {
  let current = depart;
  const cwd = project.path;
  const processus = project.miseEnProduction?.processus;
  if (!processus?.etapes?.length) throw new ArretDeLaPublication('Aucun processus de mise en production.');

  /* 1. La branche de travail rejoint la branche de production — avance
        rapide, sinon commit à deux parents, JAMAIS d'envoi forcé (MEM-1275). */
  const estGit = (await runCommand(cwd, 'git rev-parse --git-dir', 20000)).ok;
  if (estGit) {
    const dev = (await brancheDeLEtape(project, 'dev')).branche;
    const production = (await brancheDeLEtape(project, 'production')).branche;
    if (dev === production) {
      current = setStep(current, 'merge', 'skipped', `Le déploiement et la production partagent la branche « ${production} ».`);
    } else {
      current = setStep(current, 'merge', 'running');
      current = progresser(current, 'merge', `Fusion de « ${dev} » dans « ${production} » et envoi…`);
      const fusion = await fusionnerVersLaProduction(cwd, dev, production);
      if (!fusion.ok) {
        current = setStep(current, 'merge', 'failed', fusion.recit);
        throw new ArretDeLaPublication(premiereLigne(fusion.recit));
      }
      current = setStep(current, 'merge', fusion.geste === 'deja-a-jour' ? 'skipped' : 'done', fusion.recit);
    }
    const tete = await runCommand(cwd, `git rev-parse --verify --quiet ${production}`, 20000);
    current = emit({ ...current, targetCommit: tete.out.trim().slice(0, 40) || undefined });
    current = setStep(current, 'commit', 'skipped', 'Rien à enregistrer : la production reprend la branche de travail telle quelle.');
    current = setStep(current, 'push', 'done', `« ${production} » est à jour sur le dépôt distant.`);
  } else {
    current = setStep(current, 'merge', 'skipped', 'Projet sans dépôt git.');
    current = setStep(current, 'commit', 'skipped', 'Projet sans dépôt git.');
    current = setStep(current, 'push', 'skipped', 'Projet sans dépôt git.');
  }
  current = setStep(current, 'build', 'skipped', 'Le processus du projet dit lui-même ce qu’il construit.');

  /* 2. Le processus écrit à l'initialisation, TEL QUEL, sans agent. */
  current = setStep(current, 'publish', 'running');
  const joue: string[] = [];
  for (const [rang, etape] of processus.etapes.entries()) {
    if (signal.aborted) throw new ArretDeLaPublication('arrêt demandé');
    const entete = `${rang + 1}/${processus.etapes.length} · ${etape.libelle}`;
    current = progresser(current, 'publish', entete);
    current = noter(current, 'publish', `$ ${etape.commande}`, 'commande');
    const sortie = await runCommand(cwd, etape.commande, etape.delaiS * 1000, 4000, signal);
    joue.push(`${entete} — ${sortie.ok ? `terminée en ${secondes(sortie.dureeMs ?? 0)}` : 'ÉCHEC'}\n$ ${etape.commande}\n${dernieresLignes(sortie.out, sortie.ok ? 400 : 2500)}`);
    if (!sortie.ok) {
      current = setStep(current, 'publish', 'failed', joue.join('\n\n'));
      throw new ArretDeLaPublication(
        `L’étape ${rang + 1} « ${etape.libelle} » ${sortie.delaiDepasse ? `n’a pas rendu la main en ${etape.delaiS} s` : 'a échoué'} : le processus s’arrête là.`,
      );
    }
  }
  current = setStep(current, 'publish', 'done', joue.join('\n\n'));
  current = setStep(current, 'restart', 'skipped', 'Le processus du projet porte lui-même ses redémarrages.');
  return current;
}

/* ------------------------------------------------------------------ */
/* Arrêter, relancer                                                   */
/* ------------------------------------------------------------------ */

/** Arrêter : la commande en cours est COUPÉE, la publication se referme « arrêtée ». */
export function stopDeploy(runId: string): boolean {
  const run = store.getDeploy(runId);
  if (!run) return false;
  const handle = active.get(run.projectId);
  if (handle) handle.controleur.abort();
  if (run.state !== 'running') return Boolean(handle);
  if (!handle) {
    waiting.delete(run.projectId);
    emit({
      ...run,
      state: 'stopped',
      error: 'Publication arrêtée : plus rien ne la portait.',
      endedAt: Date.now(),
      steps: run.steps.map((s) => (s.state === 'running' ? { ...s, state: 'failed' as const, progress: undefined } : s)),
    });
  }
  return true;
}

/** Relancer, c'est refaire LA MÊME publication, à la même étape. */
export async function retryDeploy(
  runId: string,
  /* `enChaine` : la relance vient du dépanneur — le compte des essais automatiques suit. */
  options: { enChaine?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  const run = store.getDeploy(runId);
  if (!run) return { ok: false, error: 'publication introuvable' };
  const depannagesAuto = options.enChaine && run.depannage?.automatique ? (run.depannagesAuto ?? 0) + 1 : 0;
  return startDeploy(run.projectId, { cible: run.cible, depannagesAuto });
}
