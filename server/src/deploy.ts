import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { ZodError } from 'zod';
import {
  Agent,
  Card,
  CiblePublication,
  ColumnKey,
  RunConfig,
  ContexteDePublication,
  DeployRun,
  DeployStepKey,
  MoyensDeMiseEnLigne,
  PlanDeMiseEnLigne,
  Project,
  ECHECS_NOMMES_MAX,
  etapeDePublication,
  promptDeMiseEnProduction,
  promptDeLAgentDeProduction,
  mentionEtapeConfiee,
  phraseDEchecConfie,
  recitDeLAgent,
  consigneDeReparationConstruction,
  controlesTombes,
  detailDEchec,
  detailDEchecConstruction,
  phraseDEchecConstruction,
  estPlomberie,
  exclusionsDesBranchesDeCartes,
  titreHorsTache,
  descriptionCartePorteuse,
  type CommitObserve,
  messageEchecPublication,
  natureDePublication,
  miseEnLigneReelle,
  phraseDEchec,
  planDeMiseEnLigne,
  annonceDeDeploiement,
  brancheDePublication,
  etapeDeLaColonne,
  typeCibleReglee,
  refusCibleMiseEnProduction,
  raisonCibleMiseEnProduction,
  procedureDeLEtape,
  procedureEnPlace,
  refusSansProcedure,
  avertissementsSelection,
  moduleNatifMalCompile,
  commandeDEssaiDuModuleNatif,
  commandeDeRecompilation,
  recitDeRecompilation,
  REPRISES_ETAPE_MAX,
  reconnaitrePanneDePublication,
  panneDAdresseMuette,
  consigneDeReparationDEtape,
  titreDuDepanneur,
  mentionDeDepannage,
  recitEtapeRejouee,
  recitEtapeRetombee,
  recitSansReparation,
  recitDepanneurEnEchec,
  journalDesReprises,
  passesDeResolution,
  ordreDeFusion,
  mentionDeLOrdre,
  detailDeLEtape,
  lignesNouvelles,
  conflitPurementDocumentaire,
  recollerLesDeuxIntentions,
  mentionDuRecollage,
  avecEtatDeTache,
  lotMisEnLigne,
  type EtatDeTache,
  type TacheDuLot,
  ajouterAuJournal,
  type EvenementDEtape,
  type GenreDEvenement,
  avertissementCartesNonRangees,
  PERIODE_DE_VEILLE_MS,
  PLAFOND_TOUR_D_AGENT_MS,
  alerteDeRetard,
  constatDeDuree,
  dureeDite,
  mentionEtapeQuiTraine,
  panneDeLenteur,
  recitDepassementNonResolu,
  recitTourCoupe,
  sortieDuDepassement,
  type ConstatDeDuree,
  type MotifDeTourDePublication,
  type PanneDePublication,
  type AvertissementSelection,
} from '@haikodev/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { CONFIG } from './config.js';
import { log } from './logger.js';
import { notify } from './notify.js';
import { archiveCard } from './archive.js';
import { createAgent, sendPrompt, agentsActifs, arreterLAgent } from './runtime.js';
import { catalogueMoteurs } from './catalogue-moteurs.js';
import { etatDemon, demanderRedemarrage, appliquerRedemarrageEnAttente } from './demon.js';
import { executerCibleMiseEnProduction } from './cible-mise-en-production.js';
import { moteurPourPublier } from './moteur-de-publication.js';

const execFileAsync = promisify(execFile);

/**
 * Le service système qui fait tourner un projet, reconnu à SON DOSSIER de
 * travail. Sans ce redémarrage, publier ne faisait que pousser le code sur le
 * dépôt : le serveur continuait de servir la version chargée à son lancement,
 * et rien ne changeait à l'écran (rencontré le 03/08/2026).
 */
function serviceDuProjet(cheminProjet: string): string | null {
  const dossier = '/etc/systemd/system';
  let fichiers: string[];
  try {
    fichiers = fs.readdirSync(dossier).filter((nom) => nom.endsWith('.service'));
  } catch {
    return null;
  }
  const vise = path.resolve(cheminProjet);
  // Beaucoup de services tournent dans un SOUS-DOSSIER du projet (`web/`,
  // `server/`…) : les ignorer faisait conclure « aucun moyen de mettre en
  // ligne » sur des projets qui tournent pourtant. L'unité exacte reste
  // prioritaire, le sous-dossier ne sert que de repli.
  let repli: string | null = null;
  for (const fichier of fichiers) {
    try {
      const texte = fs.readFileSync(path.join(dossier, fichier), 'utf8');
      const ligne = texte.match(/^WorkingDirectory=(.+)$/m);
      if (!ligne) continue;
      const travail = path.resolve(ligne[1].trim());
      if (travail === vise) return fichier;
      if (!repli && travail.startsWith(`${vise}${path.sep}`)) repli = fichier;
    } catch {
      // Unité illisible : elle n'apprend rien de plus.
    }
  }
  return repli;
}

/** Le port annoncé par une unité systemd, s'il y en a un. */
export function portDansUnite(texte: string): number | null {
  const ligne = texte.match(/^Environment="?PORT=(\d+)/m);
  return ligne ? Number(ligne[1]) : null;
}

/** Le port sur lequel écoute le service, lu dans son unité systemd. */
function portDuService(service: string): number | null {
  try {
    return portDansUnite(fs.readFileSync(path.join('/etc/systemd/system', service), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Un serveur web sert-il ce dossier TEL QUEL ?
 *
 * Un site statique (le tableau de bord Root, par exemple) n'a ni service
 * système ni construction : ses fichiers SONT le site, servis directement par
 * Caddy ou nginx. Sans cette reconnaissance, la publication d'un tel projet
 * n'avait aucun moyen d'agir et se déclarait pourtant réussie.
 */
export function dossierCiteParServeurWeb(configs: string[], cheminProjet: string): boolean {
  const vise = path.resolve(cheminProjet).replace(/\/+$/, '');
  for (const texte of configs) {
    for (const ligne of texte.split('\n')) {
      const propre = ligne.trim();
      if (propre.startsWith('#')) continue;
      // Caddy : « root * /var/www/site » — nginx : « root /var/www/site; »
      const cite = propre.match(/^root\s+(?:\*\s+)?([^\s;{]+)\s*;?$/);
      if (cite && path.resolve(cite[1]).replace(/\/+$/, '') === vise) return true;
    }
  }
  return false;
}

/** Les fichiers de configuration des serveurs web installés sur la machine. */
function configurationsServeurWeb(): string[] {
  const textes: string[] = [];
  const fichiers = ['/etc/caddy/Caddyfile'];
  for (const dossier of ['/etc/nginx/sites-enabled', '/etc/nginx/conf.d', '/etc/caddy/conf.d']) {
    try {
      for (const nom of fs.readdirSync(dossier)) fichiers.push(path.join(dossier, nom));
    } catch {
      // Serveur web absent : rien à lire, ce n'est pas une erreur.
    }
  }
  for (const fichier of fichiers) {
    try {
      textes.push(fs.readFileSync(fichier, 'utf8'));
    } catch {
      // Fichier illisible : il n'apprend rien de plus.
    }
  }
  return textes;
}

/**
 * Ce dont ce projet dispose pour que son instance de dev soit rafraîchie, tout
 * CONSTATÉ sur la machine : rien de tout cela ne se règle.
 *
 * Une seule exception, et c'est un réglage du PROJET : le PROMPT de mise en
 * production, qui n'entre en jeu que pour une mise en PRODUCTION — l'appelant
 * le passe ou non, cette fonction ne décide pas de l'étape.
 */
export function moyensDuProjet(
  cwd: string,
  estHaikoDev = false,
  prompt?: string,
): MoyensDeMiseEnLigne {
  return {
    prompt: prompt?.trim() || undefined,
    estHaikoDev,
    scriptBuild: scriptExiste(cwd, 'build'),
    service: serviceDuProjet(cwd) ?? undefined,
    dossierServi: dossierCiteParServeurWeb(configurationsServeurWeb(), cwd),
  };
}

/**
 * La PROCÉDURE de cette étape, et d'elle seule.
 *
 * C'est le seul endroit qui tranche. Le déploiement lit désormais la procédure
 * définie depuis la tête de sa colonne (`procedure-publication.ts`) : un projet
 * marqué « constaté » — tous ceux d'avant cette règle — rend la chaîne vide et
 * garde donc exactement le déroulé constaté. La mise en production, elle, lit
 * son prompt réglé, comme avant.
 */
function promptDeLEtape(project: Project, cible?: CiblePublication): string {
  return cible === 'dev' ? procedureDeLEtape(project, 'dev') : promptDeMiseEnProduction(project);
}

/**
 * Le refus d'une MISE EN PRODUCTION sans prompt réglé, dit AVANT le clic — ou
 * `null` quand rien ne bloque.
 *
 * La mise en production suit le PROMPT réglé, et lui seul : sans prompt, elle ne
 * part pas et renvoie au bloc « Mise en production » des réglages. Le
 * DÉPLOIEMENT sur l'instance de dev (cible « dev »), lui, ne lit jamais le
 * prompt : il n'est jamais bloqué ici. Le bloc de publication interroge cette
 * règle pour éteindre le bouton « Tout publier » et dire pourquoi.
 */
export function blocageMiseEnProduction(projectId: string, cible?: CiblePublication): string | null {
  if (cible !== 'production') return null;
  const project = store.getProject(projectId);
  if (!project) return null;
  return refusCibleMiseEnProduction(project.miseEnProduction);
}

/**
 * Comment cette étape de mise en ligne se fera. Répondu SANS rien publier, pour
 * que le bloc de publication le dise avant le clic : l'instance de dev se
 * rafraîchit par ce qu'on constate, la mise en production suit le prompt réglé.
 */
export async function moyenDeMiseEnLigne(
  projectId: string,
  cible?: CiblePublication,
): Promise<PlanDeMiseEnLigne | null> {
  const project = store.getProject(projectId);
  if (!project) return null;
  // La branche où le lot atterrira, dite AVANT le clic — pour les deux étapes.
  const branche = await brancheDeLEtape(project, cible ?? 'dev');

  /*
   * Une MISE EN PRODUCTION dont le type est SSH, FTP ou Aucune ne suit plus le
   * chemin constaté (prompt / HaikoDev / service / dossier servi) : elle a sa
   * propre annonce, dite par la règle pure du type de cible.
   */
  if (cible === 'production') {
    const typeCible = typeCibleReglee(project.miseEnProduction);
    if (typeCible !== 'consigne') {
      return {
        construction: typeCible === 'aucune' ? 'aucune' : 'npm',
        installation: 'agent',
        redemarrage: 'aucun',
        raison: `${raisonCibleMiseEnProduction(project.miseEnProduction)} ${branche.raison}`,
      };
    }
  }

  const plan = planDeMiseEnLigne(
    moyensDuProjet(project.path, project.isSelf, promptDeLEtape(project, cible)),
  );
  /*
   * Pour un DÉPLOIEMENT (cible dev), on complète la raison par ce qui sera
   * contrôlé à la fin : l'adresse réglée du projet, ou son absence — sinon le
   * contrôle final est sauté sans un mot. La mise en production, elle, suit son
   * prompt, qui dit lui-même quoi contrôler : on ne lui ajoute que la branche.
   */
  if (cible !== 'production') {
    return { ...plan, raison: annonceDeDeploiement(plan, project.devUrl, branche.raison) };
  }
  return { ...plan, raison: `${plan.raison} ${branche.raison}` };
}

/** Le projet a-t-il ce script dans son package.json ? */
function scriptExiste(cwd: string, nom: string): boolean {
  try {
    const paquet = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
    return typeof paquet?.scripts?.[nom] === 'string' && paquet.scripts[nom].trim().length > 0;
  } catch {
    return false;
  }
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

/* ------------------------------------------------------------------ */
/* Le compteur du bouton doit dire la vérité (PLAN §30)                */
/* ------------------------------------------------------------------ */

/**
 * Exactement les cartes que le run va embarquer — ni plus, ni moins.
 *
 * La colonne de départ dépend de l'ÉTAPE : un déploiement prend le lot de « À
 * déployer », une mise en production prend celles qui sont déjà « En
 * production ». Sans étape précisée, c'est « À déployer ».
 */
export function deployableCards(
  projectId: string,
  source: ColumnKey = 'to_deploy',
  selectedCardIds?: string[],
): Card[] {
  const cards = store
    .listCardsInColumn(projectId, source)
    .filter((card) => !card.excludedFromDeploy)
    /*
     * Une carte déjà mise en ligne ne repart pas dans le même lot. Le
     * garde-fou ne vaut QUE pour la première étape : une carte posée « En
     * production » porte forcément une date de mise en ligne — celle du
     * déploiement —, et c'est justement elle qu'on veut passer en
     * production. Sa présence dans la colonne prouve qu'elle n'a pas encore
     * franchi CETTE étape-là.
     */
    .filter((card) => source !== 'to_deploy' || !card.deployedAt)
    .sort((a, b) => a.createdAt - b.createdAt);
  /*
   * L'ÉCRAN DE SÉLECTION laisse choisir les tâches à embarquer, à la première
   * étape (« À déployer ») : sans sélection, tout le lot part comme avant ;
   * avec une sélection, seules les cartes retenues partent — les autres
   * restent dans la colonne, disponibles pour la fois suivante.
   */
  if (!selectedCardIds) return cards;
  const retenues = new Set(selectedCardIds);
  return cards.filter((card) => retenues.has(card.id));
}

/* ------------------------------------------------------------------ */
/* Savoir ce qui coincera AVANT de cliquer (PLAN §11)                  */
/* ------------------------------------------------------------------ */

export type ConflitPrevu = { cardId: string; title: string; branch: string; files: string[] };
export type AgentOccupe = { id: string; title: string };

/**
 * Les agents qui travaillent encore dans le dossier. Le chef d'orchestre ne
 * compte pas : c'est souvent LUI qui répond au moment où l'on clique.
 */
export function agentsOccupes(projectId: string): AgentOccupe[] {
  return store
    .listAgents(projectId)
    .filter((agent) => agent.role !== 'orchestrator')
    .filter((agent) => agent.status === 'running' || agent.status === 'starting')
    .map((agent) => ({ id: agent.id, title: agent.title || 'agent sans titre' }));
}

/**
 * Lit la réponse de `git merge-tree --write-tree --name-only` : première ligne
 * l'arbre produit, puis les fichiers en conflit jusqu'à la ligne vide, puis le
 * récit de la fusion — qui n'est pas une liste de fichiers.
 */
export function fichiersEnConflit(sortie: string): string[] {
  const fichiers: string[] = [];
  for (const ligne of sortie.split('\n').slice(1)) {
    if (!ligne.trim()) break;
    fichiers.push(ligne.trim());
  }
  return fichiers;
}

/**
 * Ce qui entrerait en conflit si l'on publiait maintenant. `git merge-tree`
 * fusionne EN MÉMOIRE : ni le dossier de travail ni la branche courante ne
 * bougent, on peut donc l'appeler pendant qu'un agent écrit.
 *
 * C'est une prévision, pas une certitude : les branches sont fusionnées l'une
 * après l'autre, et une fusion réussie peut en fâcher une suivante.
 */
export async function conflitsPrevus(projectId: string, source: ColumnKey = 'to_deploy'): Promise<ConflitPrevu[]> {
  const project = store.getProject(projectId);
  if (!project) return [];
  const cwd = project.path;
  if (!(await runCommand(cwd, 'git rev-parse --git-dir', 20000)).ok) return [];

  /*
   * Le conflit se prévoit contre la branche où CETTE étape fusionnera, pas
   * contre la principale : un projet qui déploie sur « dev » annonçait sinon
   * des conflits contre une branche où rien ne partait.
   */
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
    // Sans marqueur de conflit ni fichier nommé, l'échec vient d'ailleurs
    // (branche exotique, git trop ancien) : on ne crie pas au loup.
    if (!files.length && !essai.out.includes('CONFLICT')) continue;
    prevus.push({ cardId: card.id, title: card.title, branch, files });
  }
  return prevus;
}

/**
 * LES AVERTISSEMENTS DE L'ÉCRAN DE SÉLECTION : une carte retenue qui touche
 * les mêmes fichiers qu'une carte laissée de côté.
 *
 * Lit les fichiers changés par chaque branche contre la branche du dépôt
 * (`git diff --name-only`), puis rejoue la règle pure. Rendu vide si le
 * projet n'est pas un dépôt git, ou si la sélection embarque tout le lot.
 */
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
  const toutes = deployableCards(projectId, source);

  const avecFichiers = await Promise.all(
    toutes.map(async (card) => {
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

/**
 * Le récit d'un échec d'agent de dépannage, JAMAIS le dump brut d'une erreur
 * Zod. `sendPrompt` peut faire remonter n'importe quelle exception : côté
 * publication, on ne veut jamais afficher un tableau `issues` illisible dans
 * le journal d'une carte — seulement ce qui a raté, en une phrase.
 */
function raisonEchecAgent(err: unknown): string {
  if (err instanceof ZodError) {
    const champs = err.issues.map((i) => i.path.join('.') || '(racine)').join(', ') || 'champs inconnus';
    return `réponse interne invalide (${champs})`;
  }
  const message = (err as { message?: unknown } | undefined)?.message;
  if (typeof message === 'string' && message) return message;
  // Un jet qui n'est pas une erreur (une chaîne, un nombre) garde son texte ;
  // seul un objet muet finit en « raison inconnue ».
  const texte = typeof err === 'string' || typeof err === 'number' ? String(err) : '';
  return texte || 'raison inconnue';
}

/* ------------------------------------------------------------------ */
/* L'AGENT DE PUBLICATION PART SUR UN MOTEUR QUI A ENCORE DU QUOTA      */
/* ------------------------------------------------------------------ */

/**
 * TOUS LES AGENTS QUE LA PUBLICATION LANCE PASSENT PAR ICI.
 *
 * Ils partaient sur le moteur par défaut du projet, et `pickAccount` ne
 * cherchait un compte que dans CE moteur. Tous ses comptes saturés, le tour ne
 * partait pas : `sendPrompt` écrivait « Aucun compte n'a de quota disponible »
 * et rendait la main SANS erreur, si bien que la publication croyait l'agent
 * intervenu et rejouait l'étape indéfiniment — le blocage silencieux.
 *
 * Le moteur se choisit donc AVANT la création de l'agent, sur la place
 * réellement restante de tous les moteurs installés
 * (`server/src/moteur-de-publication.ts`). Deux issues, jamais une troisième :
 * un agent posé sur un moteur qui a de quoi finir, ou une PHRASE qui nomme ce
 * qui manque. Rien n'est mis en ligne ici.
 *
 * Le `run` transmis (celui d'une carte, pour un conflit de fusion) garde son
 * modèle TANT QU'ON RESTE sur son moteur : un modèle Claude n'existe pas chez
 * Codex, et l'emporter dans une bascule ferait échouer le tour au lancement.
 */
async function agentDePublication(
  projectId: string,
  title: string,
  // Partiel : une passe de fusion ne porte qu'un moteur, un modèle et un cran.
  run?: Partial<RunConfig>,
): Promise<{ agent: Agent; raison: string } | { manque: string }> {
  const prefere = run?.engine ?? store.getProject(projectId)?.defaultEngine;
  const resultat = await moteurPourPublier(prefere);
  if ('manque' in resultat) return { manque: resultat.manque };

  const { engine, bascule, raison } = resultat.choix;
  const agent = createAgent({
    projectId,
    role: 'deploy',
    title,
    // Sur bascule, le modèle de la carte ne suit pas : il appartient à l'autre
    // moteur. L'adaptateur retenu posera le sien.
    run: bascule || !run ? { engine } : { ...run, engine },
  });
  return { agent, raison };
}

/** Ce qui s'écrit quand aucun moteur n'a le quota nécessaire : la raison, en clair. */
function recitFauteDeQuota(manque: string): string {
  return `Publication interrompue faute de quota. ${manque}`;
}

/**
 * LE TOUR N'A PAS EU LIEU FAUTE DE QUOTA — LE FILET, APRÈS COUP.
 *
 * Le moteur est choisi avant l'agent, mais rien n'empêche le compte de saturer
 * entre ce choix et le départ du tour : `sendPrompt` pose alors un message
 * marqué « quota » et rend la main SANS erreur. Sans ce contrôle, la
 * publication écrirait « l'agent de publication est intervenu » alors qu'aucun
 * moteur n'a rien reçu — le mensonge exact qu'on cherche à faire disparaître.
 *
 * Rend la raison à afficher, ou `null` quand le tour a bien eu lieu.
 */
function tourRefusePourQuota(agentId: string): string | null {
  const messages = store.listMessages(agentId, 10).filter((m) => m.role === 'assistant');
  const dernier = messages[messages.length - 1];
  if (dernier?.error !== 'quota') return null;
  return dernier.content?.trim() || 'aucun compte n’a de quota disponible';
}

/**
 * RECOLLER UN HEURT DE DOCUMENTATION SANS APPELER PERSONNE.
 *
 * 58 des 78 conflits mesurés par l'audit du 18/08/2026 portaient sur
 * `CLAUDE.md` et `MEMOIRE.md` : deux fichiers de TEXTE que le briefing demande
 * à chaque agent de compléter en fin de tâche. Chacun coûtait un agent, un tour
 * de moteur et trois minutes d'attente — pour faire ce que la consigne dit en
 * une phrase : garder les deux intentions.
 *
 * On le fait donc ici, mécaniquement. La fusion est LAISSÉE EN COURS par
 * l'appelant : les fichiers en conflit portent leurs marqueurs, on les recolle,
 * on les enregistre, et `git commit --no-edit` referme la fusion.
 *
 * TROIS REFUS, et chacun rend la main à l'agent plutôt que de bricoler : un
 * fichier hors de la liste fermée (donc du code, ou une prose dont l'ordre a un
 * sens), un fichier illisible sur le disque, un texte dont les marqueurs ne
 * sont pas exactement ceux qu'on attend. Rien n'est jamais écrasé : le
 * recollage AJOUTE, il ne choisit pas de camp.
 */
async function recollerLaDocumentation(
  cwd: string,
  fichiers: string[],
): Promise<{ recollee: boolean; recit: string }> {
  if (!conflitPurementDocumentaire(fichiers)) return { recollee: false, recit: '' };

  for (const fichier of fichiers) {
    const chemin = path.join(cwd, fichier);
    let avant: string;
    try {
      avant = await fs.promises.readFile(chemin, 'utf8');
    } catch {
      return { recollee: false, recit: `fichier illisible (${fichier})` };
    }
    const apres = recollerLesDeuxIntentions(avant);
    if (apres === null) return { recollee: false, recit: `marqueurs inattendus dans ${fichier}` };
    await fs.promises.writeFile(chemin, apres, 'utf8');
  }

  // On n'ajoute QUE les fichiers recollés : le dossier est partagé, et un
  // `git add -A` emporterait ce qu'un autre y a laissé.
  for (const fichier of fichiers) {
    const ajout = await runCommand(cwd, `git add -- ${JSON.stringify(fichier)}`);
    if (!ajout.ok) return { recollee: false, recit: `enregistrement impossible (${fichier})` };
  }
  const commit = await runCommand(cwd, 'git commit --no-edit');
  if (!commit.ok) return { recollee: false, recit: 'la fusion recollée n’a pas pu être enregistrée' };

  return { recollee: true, recit: mentionDuRecollage(fichiers) };
}

/**
 * Un conflit se résout DANS la publication, pas dans une nouvelle tâche.
 *
 * Avant, une branche en conflit produisait une carte « Résoudre le conflit de
 * fusion : … » qu'il fallait valider, chiffrer, lancer, clôturer, puis relancer
 * la publication — tout le parcours refait pour un geste de plomberie. Le
 * publieur appelle maintenant un agent sur-le-champ, attend qu'il ait fini, et
 * retente la fusion. En cas d'échec, la carte est simplement écartée du lot et
 * reste dans « À déployer », comme avant.
 *
 * L'agent de résolution ne porte PAS le `cardId` de la carte en conflit : ce
 * n'est pas SON agent d'exécution, seulement un geste de plomberie ponctuel.
 * Le lui donner faisait de lui « le dernier agent de cette carte »
 * (`getLastAgentByCard`, sans filtre de rôle) — au risque de faire reprendre
 * SA session, au lieu de celle du travail réel, par `startCard` ou par
 * l'onglet Conversation de la carte.
 *
 * ET IL NE PART PLUS SUR LE MODÈLE DE LA CARTE. Recoller deux versions d'un
 * même fichier est de la plomberie : la PREMIÈRE passe se fait sur le modèle
 * léger du même moteur, réflexion moyenne (`passesDeResolution`,
 * `shared/src/fusion-du-lot.ts`), et le modèle de la carte ne reprend la main
 * qu'en SECONDE passe, si la légère n'a pas suffi. Mesure qui l'impose : 59
 * des 99 résolutions de la période ont été faites par Opus 5, pour 102
 * millions de jetons (`docs/audit-fusion-deploiement.md`).
 *
 * Rend vrai si la branche a fini par se fusionner.
 */
async function resoudreConflit(
  projectId: string,
  cwd: string,
  card: Card,
  branch: string,
  mainBranch: string,
  files: string[],
): Promise<{ fusionnee: boolean; recit: string }> {
  const liste = files.length ? files.map((file) => `- ${file}`).join('\n') : '- (fichiers non identifiés)';
  const passes = passesDeResolution(card.run, await catalogueMoteurs());

  const prompt = [
    `La publication est EN COURS et bloque : la branche \`${branch}\` ne se fusionne plus sur \`${mainBranch}\`.`,
    '',
    'Fichiers en conflit :',
    liste,
    '',
    'Fais exactement ceci, et rien d’autre :',
    `1. \`git checkout ${branch}\``,
    `2. \`git merge ${mainBranch}\``,
    '3. Résous chaque conflit en GARDANT LES DEUX INTENTIONS : le travail de la branche principale et celui de cette branche. Ne supprime jamais le travail d’un autre pour faire passer le tien.',
    '4. Enregistre la fusion (`git add` sur les fichiers résolus, puis `git commit`).',
    '5. Vérifie que le projet compile et que les tests passent.',
    '',
    'Ne publie pas, ne redémarre rien : la publication reprendra toute seule dès que tu auras fini. Réponds court.',
  ].join('\n');

  bus.toast('info', `Conflit sur « ${card.title} » : l’agent de publication le résout.`);

  /*
   * LES PASSES SE SUIVENT, DE LA PLUS ÉCONOME À LA PLUS FORTE, et la boucle
   * s'arrête à la première qui fusionne. Chaque passe crée son agent : un
   * changement de modèle ne se glisse pas dans une session déjà ouverte.
   */
  let dernierRecit = 'conflit non résolu';
  for (const passe of passes) {
    const legere = passe.nom === 'legere';
    /*
     * Le moteur se choisit ICI, sur la place restante : une passe posée sur un
     * moteur saturé ne partirait pas, et la publication tournerait sur place.
     * Faute de quota, on s'arrête et on le DIT — la passe suivante se
     * heurterait au même mur.
     */
    const pose = await agentDePublication(
      projectId,
      `Conflit de fusion — ${card.title}${legere ? '' : ' (seconde passe)'}`,
      passe.run,
    );
    if ('manque' in pose) return { fusionnee: false, recit: recitFauteDeQuota(pose.manque) };
    const { agent } = pose;

    /*
     * ET CE TOUR-LÀ EST BORNÉ, comme les quatre autres de la publication.
     * `sendPrompt` était appelé NU ici, et c'était le SEUL endroit à ne pas
     * l'être : un agent dont la préparation restait pendue voyait bien son tour
     * refermé par la veille des tours bloqués, mais refermer un tour dans la
     * base ne dénoue pas la promesse que cette fusion attend. La fusion restait
     * « en cours » pour toujours, et seul un clic humain sur « Arrêter »
     * débloquait la publication (trois cas en vingt-quatre heures dans l'audit
     * du 18/08/2026, dont un de 27 minutes). Un dépassement devient désormais
     * un échec de passe ordinaire : la passe suivante prend la main, et à
     * défaut la carte est écartée du lot — la publication continue.
     */
    const tour = await tourDAgentSousPlafond(agent.id, 'conflit', () =>
      sendPrompt(agent.id, prompt, { template: 'free', silent: true, motif: 'conflit' }),
    );
    if (tour.depasse) {
      dernierRecit = recitTourCoupe('conflit', tour.ecouleMs);
      continue;
    }
    if (tour.erreur) {
      dernierRecit = `agent de résolution en échec (${raisonEchecAgent(tour.erreur)})`;
      continue;
    }

    const sansQuota = tourRefusePourQuota(agent.id);
    if (sansQuota) return { fusionnee: false, recit: recitFauteDeQuota(sansQuota) };

    /*
     * L'agent a pu laisser le dossier sur SA branche : on revient sur la
     * principale avant de retenter, sinon la fusion partirait à l'envers.
     */
    const retour = await runCommand(cwd, `git checkout ${mainBranch}`);
    if (!retour.ok) return { fusionnee: false, recit: 'retour sur la branche principale impossible' };

    const seconde = await runCommand(cwd, `git merge --no-edit ${branch}`);
    if (seconde.ok) {
      return {
        fusionnee: true,
        recit: `conflit résolu par l’agent${legere ? ' (modèle léger)' : ' (modèle de la carte)'}, branche fusionnée`,
      };
    }

    await runCommand(cwd, 'git merge --abort');
    dernierRecit = legere
      ? 'conflit toujours présent après le modèle léger'
      : 'conflit toujours présent après passage de l’agent';
  }
  return { fusionnee: false, recit: dernierRecit };
}

/* ------------------------------------------------------------------ */
/* Les contrôles, et leur réparation pendant la publication            */
/* ------------------------------------------------------------------ */

/**
 * Combien de fois la publication rappelle un agent pour réparer une étape.
 *
 * Le nombre vit dans les règles pures (`REPRISES_ETAPE_MAX`,
 * `shared/src/reparation-publication.ts`) : contrôles, construction et les
 * quatre étapes désormais réparables suivent tous le MÊME plafond, et il se
 * rejoue sans publication en cours.
 */
export const REPARATIONS_MAX = REPRISES_ETAPE_MAX;

/**
 * Les contrôles du projet, sur du code À JOUR.
 *
 * `npm test` lit `server/dist` : sans recompiler d'abord, on jugerait le code
 * du dernier lancement du démon et non le lot qu'on vient de fusionner.
 */
async function controlerLeProjet(
  cwd: string,
  onEtape?: (label: string) => void,
): Promise<{ ok: boolean; etape: 'compilation' | 'controles'; out: string }> {
  onEtape?.('Compilation du code (npm run build:server)…');
  const compile = await runCommand(cwd, 'npm run build:server', 10 * 60 * 1000, Infinity);
  if (!compile.ok) return { ok: false, etape: 'compilation', out: compile.out };
  onEtape?.('Contrôles du projet (npm test)…');
  const test = await runCommand(cwd, 'npm test', 10 * 60 * 1000, Infinity);
  return { ok: test.ok, etape: 'controles', out: test.out };
}

/**
 * Un contrôle tombé se répare DANS la publication, comme un conflit de fusion.
 *
 * Avant, la publication s'arrêtait net et rendait la main : il fallait relire
 * la sortie, ouvrir une carte, la lancer, la clôturer, puis relancer la mise en
 * ligne. Le publieur appelle maintenant un agent sur-le-champ, lui donne les
 * contrôles tombés par leur nom, attend qu'il ait fini, et rejoue les contrôles.
 * Le refus, lui, ne bouge pas : après `REPARATIONS_MAX` passes sans succès, la
 * publication échoue en nommant ce qui tombe encore.
 */
async function reparerLesControles(
  projectId: string,
  cwd: string,
  echec: { etape: 'compilation' | 'controles'; out: string },
  passe: number,
): Promise<{ tente: boolean; recit: string }> {
  const pose = await agentDePublication(
    projectId,
    echec.etape === 'compilation' ? 'Publication — le code ne compile pas' : 'Publication — contrôles en échec',
  );
  if ('manque' in pose) return { tente: false, recit: `passe ${passe} : ${recitFauteDeQuota(pose.manque)}` };
  const { agent } = pose;

  const tombes = controlesTombes(echec.out);
  const liste = tombes.length
    ? tombes.slice(0, ECHECS_NOMMES_MAX).map((c) => `- ${c.nom}${c.endroit ? ` (${c.endroit})` : ''}`).join('\n')
    : '- (aucun nom relevé dans la sortie : lis-la en entier)';

  const prompt = [
    `La publication est EN COURS et bloque (passe ${passe} sur ${REPARATIONS_MAX}).`,
    echec.etape === 'compilation'
      ? '`npm run build:server` échoue : le code ne compile pas, les contrôles n’ont même pas pu être lancés.'
      : '`npm test` échoue sur la branche principale, une fois le lot fusionné.',
    '',
    echec.etape === 'compilation' ? 'Sortie de la compilation :' : 'Contrôles tombés :',
    echec.etape === 'compilation' ? echec.out.slice(-4000) : liste,
    '',
    'Fais exactement ceci, et rien d’autre :',
    '1. Reproduis l’échec (`npm run build:server`, puis `npm test`).',
    '2. Répare la CAUSE, dans le code. Ne supprime, ne désactive et ne mets en commentaire AUCUN test : un contrôle qui tombe dit quelque chose de vrai.',
    '3. Si le contrôle est instable (il passe une fois sur deux), rends-le stable — ne le retire pas.',
    '4. Reconstruis et relance les contrôles jusqu’à ce qu’ils passent en entier.',
    '5. Enregistre ton travail en nommant tes fichiers un par un (jamais `git add -A` : le dossier est partagé).',
    '',
    'Tu es sur la branche principale, dans le dossier du projet : n’en change pas, ne crée pas de branche.',
    'Ne publie pas, ne redémarre rien : la publication reprendra toute seule dès que tu auras fini. Réponds court.',
  ].join('\n');

  bus.toast('info', `Publication bloquée : l’agent de publication répare les contrôles (passe ${passe}).`);

  // Borné comme tous les tours de publication : un agent qui ne rend plus la
  // main tenait l'étape « Vérification » ouverte sans fin.
  const tour = await tourDAgentSousPlafond(agent.id, 'controles', () =>
    sendPrompt(agent.id, prompt, { template: 'free', silent: true, motif: 'controles' }),
  );
  if (tour.depasse) {
    return { tente: false, recit: `passe ${passe} : ${recitTourCoupe('controles', tour.ecouleMs)}` };
  }
  if (tour.erreur) {
    return { tente: false, recit: `agent de réparation en échec (${raisonEchecAgent(tour.erreur)})` };
  }
  const sansQuota = tourRefusePourQuota(agent.id);
  if (sansQuota) return { tente: false, recit: `passe ${passe} : ${recitFauteDeQuota(sansQuota)}` };
  return { tente: true, recit: `passe ${passe} : l’agent de publication est intervenu` };
}

/* ------------------------------------------------------------------ */
/* La construction, et sa réparation pendant la publication            */
/* ------------------------------------------------------------------ */

/**
 * Une construction cassée se répare DANS la publication, comme un conflit de
 * fusion ou un contrôle tombé.
 *
 * L'étape « Construction » était le dernier endroit sans secours : un
 * `npm run build` en échec jetait « La construction a échoué » et tout
 * s'arrêtait, même quand la cause n'avait rien à voir avec le code — un fichier
 * temporaire illisible (`EACCES … node_modules/.tmp/tsconfig.node…`, vu sur
 * haiko-compta), un outil absent, un dossier de sortie occupé. Un agent de rôle
 * « deploy » est donc appelé sur-le-champ, avec la cause NOMMÉE, puis la
 * construction est rejouée.
 */
async function reparerLaConstruction(
  projectId: string,
  cwd: string,
  commande: string,
  sortie: string,
  passe: number,
): Promise<{ tente: boolean; recit: string }> {
  const pose = await agentDePublication(projectId, 'Publication — la construction échoue');
  if ('manque' in pose) return { tente: false, recit: `passe ${passe} : ${recitFauteDeQuota(pose.manque)}` };
  const { agent } = pose;

  const prompt = consigneDeReparationConstruction(commande, sortie, passe, REPARATIONS_MAX);

  bus.toast('info', `Publication bloquée : l’agent de publication répare la construction (passe ${passe}).`);

  const tour = await tourDAgentSousPlafond(agent.id, 'construction', () =>
    sendPrompt(agent.id, prompt, { template: 'free', silent: true, motif: 'construction' }),
  );
  if (tour.depasse) {
    return { tente: false, recit: `passe ${passe} : ${recitTourCoupe('construction', tour.ecouleMs)}` };
  }
  if (tour.erreur) {
    return { tente: false, recit: `agent de réparation en échec (${raisonEchecAgent(tour.erreur)})` };
  }
  const sansQuota = tourRefusePourQuota(agent.id);
  if (sansQuota) return { tente: false, recit: `passe ${passe} : ${recitFauteDeQuota(sansQuota)}` };
  return { tente: true, recit: `passe ${passe} : l’agent de publication est intervenu` };
}

/**
 * Construire, et rappeler un agent tant que ça casse — dans la limite de
 * `REPARATIONS_MAX` passes, exactement comme les contrôles.
 *
 * Le refus ne s'assouplit pas : au bout des passes, l'appelant reçoit `ok:
 * false` et une phrase qui NOMME ce qui bloque encore. La sortie est gardée
 * ENTIÈRE pendant le travail (les causes sont écrites au milieu, pas à la fin) ;
 * c'est le détail rendu qui la résume.
 *
 * `reparer` n'est là que pour les contrôles : ils rejouent le mécanisme entier
 * sans dépenser un tour de moteur. La publication, elle, passe toujours par
 * l'agent de secours.
 */
export async function construireAvecReparation(
  projectId: string,
  cwd: string,
  commande: string,
  entete = '',
  reparer = reparerLaConstruction,
): Promise<{ ok: boolean; detail: string; phrase: string }> {
  let build = await runCommand(cwd, commande, 10 * 60 * 1000, Infinity);
  const passes: string[] = [];
  for (let passe = 1; !build.ok && passe <= REPARATIONS_MAX; passe++) {
    const repare = await reparer(projectId, cwd, commande, build.out, passe);
    passes.push(repare.recit);
    if (!repare.tente) break;
    build = await runCommand(cwd, commande, 10 * 60 * 1000, Infinity);
  }
  const journal = passes.length ? `\n\nRéparations tentées :\n${passes.map((p) => `- ${p}`).join('\n')}` : '';
  const detail = build.ok
    ? `${entete}\`${commande}\`\n${build.out.slice(-800)}${journal}`
    : `${entete}\`${commande}\`\n${detailDEchecConstruction(build.out)}${journal}`;
  return { ok: build.ok, detail, phrase: phraseDEchecConstruction(build.out) };
}

/* ------------------------------------------------------------------ */
/* La mise en ligne confiée à un agent qui suit le prompt réglé         */
/* ------------------------------------------------------------------ */

/**
 * Le compte rendu de l'agent : sa DERNIÈRE réponse, celle qui clôt son tour.
 *
 * On ne lit pas les étapes intermédiaires : ce qui compte, c'est ce qu'il dit
 * avoir fait à la fin. Un fil vide rend `undefined`, et l'appelant le dit.
 */
function derniereReponse(agentId: string): { texte?: string; erreur?: string } {
  const messages = store.listMessages(agentId, 50).filter((m) => m.role === 'assistant');
  const dernier = messages[messages.length - 1];
  return { texte: dernier?.content, erreur: dernier?.error };
}

/**
 * CONFIER LA MISE EN PRODUCTION À UN AGENT.
 *
 * Le code est déjà fusionné, enregistré et envoyé : il ne reste qu'à le mettre
 * en ligne, et c'est le prompt réglé dans les paramètres du projet qui dit
 * comment. L'agent le reçoit tel quel, avec le lot et l'adresse à contrôler.
 *
 * Rend le compte rendu à afficher, et `ok: false` quand le tour n'a pas abouti.
 * Aucune indulgence : un tour en échec est un échec NOMMÉ, et rien n'est
 * annoncé « publié ». Le contrôle de l'adresse publique, lui, tombe juste après
 * dans `startDeploy` — c'est lui qui a le dernier mot.
 */
async function confierLaMiseEnLigne(
  projectId: string,
  ctx: ContexteDePublication,
  constat?: ConstatDeDuree,
): Promise<{ ok: boolean; recit: string; raison?: string; panne?: PanneDePublication }> {
  const pose = await agentDePublication(projectId, `Mise en production — ${ctx.projet}`);
  if ('manque' in pose) {
    // La raison est DITE, et l'étape échoue franchement : rien n'est mis en
    // ligne, et surtout rien ne reste à tourner en silence.
    const raison = recitFauteDeQuota(pose.manque);
    return { ok: false, recit: phraseDEchecConfie(raison), raison };
  }
  const { agent, raison: choixDuMoteur } = pose;

  bus.toast('info', `Mise en production de « ${ctx.projet} » : l’agent suit le prompt du projet.`);
  log.info(`publication : mise en production de « ${ctx.projet} » — ${choixDuMoteur}`);

  /*
   * LA MISE EN PRODUCTION EST BORNÉE DANS LE TEMPS, ELLE AUSSI.
   *
   * C'était le plus long silence possible de toute la publication : un seul
   * tour d'agent, mené de bout en bout d'après le prompt du projet, sans
   * aucune borne. Un moteur qui se taisait laissait l'étape « Mise en ligne »
   * tourner indéfiniment, avec sa petite roue, sans que rien ne distingue ce
   * blocage d'un transfert en cours.
   *
   * Le plafond dépassé, le tour est ARRÊTÉ et la panne est NOMMÉE : l'étape
   * repart alors par le chemin ordinaire — un dépanneur, puis une reprise —
   * au lieu de s'arrêter en rouge. Rien n'est mis en ligne de plus : c'est
   * l'étape que l'utilisateur a lancée qui est rejouée.
   */
  const tour = await tourDAgentSousPlafond(agent.id, 'mise-en-ligne', () =>
    /*
     * Motif ANNONCÉ, mais accueil COMPLET : la mise en production agit sur le
     * projet entier d'après son prompt réglé, elle n'est pas un dépannage
     * (`niveauDAccueil`, `shared/src/accueil-agent.ts`).
     */
    sendPrompt(agent.id, promptDeLAgentDeProduction(ctx), {
      template: 'free',
      silent: true,
      motif: 'mise-en-ligne',
    }),
  );
  if (tour.depasse) {
    const mesure = constat ?? { depasse: true, ecouleMs: tour.ecouleMs, attenduMs: tour.ecouleMs };
    const raison = recitTourCoupe('mise-en-ligne', tour.ecouleMs);
    return {
      ok: false,
      recit: `${phraseDEchecConfie(raison)}\n\n${sortieDuDepassement(STEP_LABELS.publish, mesure, true)}`,
      raison,
      panne: panneDeLenteur(STEP_LABELS.publish, mesure),
    };
  }
  if (tour.erreur) {
    const raison = (tour.erreur as any)?.message ?? 'raison inconnue';
    return { ok: false, recit: phraseDEchecConfie(raison), raison };
  }

  const sansQuota = tourRefusePourQuota(agent.id);
  if (sansQuota) {
    const raison = recitFauteDeQuota(sansQuota);
    return { ok: false, recit: phraseDEchecConfie(raison), raison };
  }

  const rendu = derniereReponse(agent.id);
  const recit = recitDeLAgent(rendu.texte);
  const fini = store.getAgent(agent.id);
  if (fini && fini.status !== 'done') {
    const raison = rendu.erreur?.trim() || `le tour de l’agent s’est terminé en « ${fini.status} »`;
    return { ok: false, recit: `${phraseDEchecConfie(raison)}\n\n${recit}`, raison };
  }
  return { ok: true, recit };
}

/* ------------------------------------------------------------------ */
/* Une publication à la fois                                           */
/* ------------------------------------------------------------------ */

const active = new Map<string, { stop: () => void }>();
/**
 * Les publications qui attendent leur tour, chacune AVEC son étape : une mise
 * en production mise en file ne doit pas repartir en déploiement, ni l'inverse.
 */
const waiting = new Map<string, { cible?: CiblePublication }>();

const STEP_ORDER: DeployStepKey[] = ['merge', 'commit', 'push', 'verify', 'build', 'publish', 'restart'];

export const STEP_LABELS: Record<DeployStepKey, string> = {
  merge: 'Fusion des branches',
  commit: 'Enregistrement',
  push: 'Envoi sur le dépôt',
  verify: 'Vérification du code',
  build: 'Construction',
  publish: 'Mise en ligne',
  restart: 'Redémarrage du serveur',
};

/* ------------------------------------------------------------------ */
/* LE FIL HISTORIQUE DE CHAQUE ÉTAPE                                    */
/* ------------------------------------------------------------------ */

/**
 * LE JOURNAL VIT À CÔTÉ DE LA PUBLICATION, PAS DEDANS — et c'est ce qui le rend
 * increvable.
 *
 * Le fil principal de `startDeploy` promène une COPIE de la publication
 * (`current`) qu'il réassigne à chaque étape. Si le journal ne vivait que dans
 * cette copie, toute écriture venue d'ailleurs — la veille des durées, un
 * dépannage, une note posée depuis une fonction qui n'a pas `current` sous la
 * main — serait effacée au prochain `emit`, exactement comme le prévient le
 * commentaire de la veille.
 *
 * Il est donc gardé ICI, par publication et par étape, et `emit` le RECOLLE
 * systématiquement sur les étapes avant d'enregistrer : peu importe la
 * fraîcheur de la copie qu'on lui passe, le fil complet repart en base.
 */
const journaux = new Map<string, Map<DeployStepKey, EvenementDEtape[]>>();

/**
 * Le journal d'une publication, repris de la BASE la première fois : une
 * publication reprise après un redémarrage du serveur ne recommence pas son fil
 * à zéro.
 */
function journalDuRun(run: DeployRun): Map<DeployStepKey, EvenementDEtape[]> {
  const connu = journaux.get(run.id);
  if (connu) return connu;
  const fil = new Map<DeployStepKey, EvenementDEtape[]>();
  for (const step of run.steps) if (step.journal?.length) fil.set(step.key, [...step.journal]);
  journaux.set(run.id, fil);
  return fil;
}

/** Une publication rangée n'a plus rien à noter : on rend la mémoire. */
function oublierLeJournal(runId: string): void {
  journaux.delete(runId);
}

function emit(run: DeployRun): DeployRun {
  const fil = journalDuRun(run);
  const steps = fil.size
    ? run.steps.map((step) => {
        const evenements = fil.get(step.key);
        return evenements?.length ? { ...step, journal: evenements } : step;
      })
    : run.steps;
  const saved = store.saveDeploy({ ...run, steps });
  bus.emit({ type: 'deploy.upsert', run: saved });
  return saved;
}

/**
 * OÙ EN EST CETTE TÂCHE-LÀ, dit tout de suite à l'écran.
 *
 * La liste des tâches du lot vit sur la publication (`taches`) et se remplit au
 * fil de la fusion : c'est elle que le tiroir montre en tête, avant les sept
 * étapes. Une publication d'avant cette règle n'a pas de liste — on ne lui en
 * invente pas une, et l'écran retombe alors sur le simple compte de cartes.
 */
function marquerLaTache(run: DeployRun, cardId: string, etat: EtatDeTache, detail?: string): DeployRun {
  if (!run.taches?.length) return run;
  return emit({ ...run, taches: avecEtatDeTache(run.taches, cardId, etat, detail) });
}

/**
 * NOTER UN MOMENT DANS LE FIL D'UNE ÉTAPE, et le faire voir tout de suite.
 *
 * L'appelant passe la publication qu'il a en main : elle ne sert qu'à savoir
 * QUI on est en train de raconter. Le fil, lui, ne dépend pas d'elle — c'est
 * tout l'intérêt.
 *
 * CE QUI EST RÉÉMIS EST TOUJOURS LA VERSION EN BASE, jamais la copie reçue :
 * une note peut partir d'une closure (l'envoi rejoué, un redémarrage de
 * service) qui a capturé une copie d'avant le dépannage, et réémettre celle-là
 * ferait reculer la publication à l'écran. La copie ne sert donc qu'à
 * l'identifier ; sans elle en base (contrôle qui fabrique un run à la main), on
 * retombe sur ce qu'on nous a passé.
 *
 * Ce qui n'apporte rien n'est pas noté (texte vide, même ligne répétée) : la
 * règle pure s'en charge, et rend alors le fil inchangé.
 */
function noterAuJournal(
  run: DeployRun,
  etape: DeployStepKey,
  texte: string,
  genre: GenreDEvenement,
): DeployRun {
  const fil = journalDuRun(run);
  const avant = fil.get(etape);
  const apres = ajouterAuJournal(avant, { at: Date.now(), genre, texte });
  if (apres === avant) return run;
  fil.set(etape, apres);
  emit(store.getDeploy(run.id) ?? run);
  return run;
}

/**
 * UNE COMMANDE RÉELLEMENT LANCÉE, ÉCRITE DANS LE FIL AVANT DE PARTIR.
 *
 * On note la commande TELLE QU'ELLE EST LANCÉE — pas une paraphrase —, puis son
 * issue en une ligne. Ce qu'elle a écrit sur sa sortie reste dans le détail de
 * l'étape ; le fil dit ce qui a été tenté et ce que ça a donné.
 */
async function commandeDuFil(
  run: DeployRun,
  etape: DeployStepKey,
  cwd: string,
  command: string,
  timeout?: number,
): Promise<{ ok: boolean; out: string; delaiDepasse?: boolean }> {
  noterAuJournal(run, etape, `$ ${command}`, 'commande');
  const res = await runCommand(cwd, command, timeout);
  const premiere = res.out.trim().split('\n').find((ligne) => ligne.trim()) ?? '';
  noterAuJournal(
    run,
    etape,
    res.ok ? '→ terminée sans erreur' : `→ échec : ${premiere || 'aucune sortie'}`,
    'commande',
  );
  return res;
}

function setStep(run: DeployRun, key: DeployStepKey, state: 'running' | 'done' | 'failed' | 'skipped', logText = ''): DeployRun {
  const steps = run.steps.map((step) =>
    step.key === key
      ? {
          ...step,
          state,
          /*
           * LE DÉTAIL S'AJOUTE — c'est voulu, une étape se raconte au fil de
           * l'eau — MAIS IL NE SE COUPE PLUS PAR LA TÊTE. Il ne gardait que
           * ses 4 000 derniers signes, donc un lot de dix branches perdait les
           * premières, celles qu'on venait justement relire
           * (`detailDeLEtape`, `shared/src/fusion-du-lot.ts`).
           *
           * L'appelant, lui, ne passe QUE la suite : lui repasser son journal
           * entier à chaque conflit le recopiait autant de fois qu'il y avait
           * eu de conflits (175 lignes « CONFLIT » relevées pour 78 conflits
           * réels, audit du 18/08/2026).
           */
          log: detailDeLEtape(step.log, logText),
          // La progression n'a de sens que le temps de l'étape : dès qu'elle
          // s'achève, c'est la durée qui la remplace à l'écran.
          progress: state === 'running' ? step.progress : undefined,
          // Le retard n'a de sens que PENDANT l'étape : une fois terminée,
          // c'est sa durée qui parle.
          enRetard: state === 'running' ? step.enRetard : undefined,
          startedAt: step.startedAt ?? Date.now(),
          endedAt: state === 'running' ? undefined : Date.now(),
        }
      : step,
  );
  /*
   * LE FIL RETIENT LE DÉBUT ET L'ISSUE DE CHAQUE ÉTAPE, ici et nulle part
   * ailleurs : `setStep` est le passage obligé des sept étapes des deux
   * publications, donc aucune ne peut être oubliée — pas même une étape
   * ajoutée demain.
   */
  const rendu0 = { ...run, steps, currentStep: state === 'running' ? key : run.currentStep };
  const fil = journalDuRun(run);
  const raconte =
    state === 'running'
      ? `L’étape « ${STEP_LABELS[key]} » commence.`
      : state === 'done'
        ? `Étape terminée.${logText.trim() ? ` ${premiereLigne(logText)}` : ''}`
        : state === 'skipped'
          ? `Étape sautée${logText.trim() ? ` : ${premiereLigne(logText)}` : ''}.`
          : `Étape tombée${logText.trim() ? ` : ${premiereLigne(logText)}` : ''}.`;
  fil.set(
    key,
    ajouterAuJournal(fil.get(key), {
      at: Date.now(),
      genre: state === 'running' ? 'debut' : 'issue',
      texte: raconte,
    }),
  );
  const rendu = emit(rendu0);
  /*
   * LA SURVEILLANCE DU TEMPS SE POSE ICI, ET NULLE PART AILLEURS.
   *
   * `setStep` est le SEUL passage obligé de toutes les étapes des deux
   * publications : y accrocher la veille garantit qu'aucune n'est oubliée, et
   * qu'une étape ajoutée demain sera surveillée sans qu'on ait à y penser.
   */
  if (state === 'running') ouvrirLaVeille(rendu.id, key);
  else fermerLaVeille(rendu.id, key);
  return rendu;
}

/**
 * Ce qu'une étape est en train de faire, réémis pour que l'écran suive à vue :
 * la branche en cours de fusion, le contrôle lancé, la commande de construction.
 * L'étape reste « en cours » — on ne fait qu'écrire sa ligne de progression.
 */
function progresserEtape(
  run: DeployRun,
  key: DeployStepKey,
  progress: string,
  /* Le genre du moment ainsi écrit dans le fil. Une progression ordinaire est
     une « progression » ; les mentions d'un dépannage disent qu'elles en sont
     un, pour se distinguer d'un coup d'œil dans le tiroir. */
  genre: GenreDEvenement = 'progression',
): DeployRun {
  const steps = run.steps.map((step) => (step.key === key ? { ...step, progress } : step));
  /*
   * LA PROGRESSION EST TRANSITOIRE, LE FIL NE L'EST PAS.
   *
   * « Branche 10 sur 10 » effaçait les neuf précédentes, et disparaissait avec
   * l'étape : c'est exactement ce que l'utilisateur venait chercher et ne
   * trouvait plus. Chaque progression laisse donc sa trace, dans l'ordre.
   */
  const fil = journalDuRun(run);
  fil.set(key, ajouterAuJournal(fil.get(key), { at: Date.now(), genre, texte: progress }));
  return emit({ ...run, steps });
}

/** La première ligne parlante d'une sortie : de quoi raconter sans tout recopier. */
function premiereLigne(texte: string): string {
  return texte.trim().split('\n').find((ligne) => ligne.trim())?.trim().slice(0, 200) ?? '';
}

/* ------------------------------------------------------------------ */
/* Une étape qui TRAÎNE est constatée, dite, puis traitée comme une panne */
/* ------------------------------------------------------------------ */

/**
 * LA VEILLE D'UNE ÉTAPE EN COURS.
 *
 * Elle ne fait qu'une chose : compter le temps et le DIRE quand il dépasse ce
 * qu'on attendait. Elle ne coupe rien — couper une commande en plein
 * `npm install` ferait plus de dégâts que l'attente elle-même, et `runCommand`
 * borne déjà chaque commande. Ce qu'elle apporte est ce qui manquait vraiment :
 * une étape en retard cesse d'être indistinguable d'une étape qui travaille.
 *
 * Elle relit la publication DANS LA BASE à chaque passage, jamais une copie
 * gardée de côté : le fil principal réassigne `current` en permanence, et une
 * veille qui écrirait par-dessus une copie périmée effacerait le travail des
 * étapes suivantes.
 */
interface VeilleDEtape {
  etape: DeployStepKey;
  debutMs: number;
  minuteur: NodeJS.Timeout;
  /** Le temps déjà passé en dépannage, qui ne compte pas comme du travail. */
  depannageMs: number;
  /** Depuis quand un dépannage est en cours, quand il y en a un. */
  suspendueDepuis?: number;
  /** La dernière ligne écrite, pour ne pas réémettre le même texte. */
  derniereMention?: string;
  /**
   * L'alerte de retard est-elle DÉJÀ partie pour cette étape ?
   *
   * Un retard qui dure ne se répète pas toutes les trente secondes : on
   * prévient une fois, au constat, et le déroulé porte la suite.
   */
  alerteEnvoyee?: boolean;
}

const veilles = new Map<string, VeilleDEtape>();

function ouvrirLaVeille(runId: string, etape: DeployStepKey): void {
  const enCours = veilles.get(runId);
  if (enCours?.etape === etape) return;
  if (enCours) clearInterval(enCours.minuteur);
  const minuteur = setInterval(() => passageDeVeille(runId), PERIODE_DE_VEILLE_MS);
  // Une veille ne doit jamais retenir le processus à elle seule.
  minuteur.unref?.();
  veilles.set(runId, { etape, debutMs: Date.now(), minuteur, depannageMs: 0 });
}

function fermerLaVeille(runId: string, etape?: DeployStepKey): void {
  const veille = veilles.get(runId);
  if (!veille) return;
  if (etape && veille.etape !== etape) return;
  clearInterval(veille.minuteur);
  veilles.delete(runId);
}

/** Toutes les veilles d'une publication, à sa fin — réussie, tombée ou arrêtée. */
function arreterLesVeilles(runId: string): void {
  fermerLaVeille(runId);
}

/**
 * Le temps de l'étape en cours, dépannages déduits.
 *
 * Rendu même sans veille ouverte (une étape jouée hors publication, un
 * contrôle) : le constat retombe alors sur un temps nul, jamais sur une panne
 * inventée.
 */
function constatDeLEtape(runId: string, etape: DeployStepKey): ConstatDeDuree {
  const veille = veilles.get(runId);
  const enCours = veille && veille.etape === etape ? veille : undefined;
  return constatDeDuree({
    etape,
    debutMs: enCours?.debutMs,
    maintenantMs: Date.now(),
    tempsDeDepannageMs: (enCours?.depannageMs ?? 0) + (enCours?.suspendueDepuis ? Date.now() - enCours.suspendueDepuis : 0),
  });
}

/**
 * LA PANNE À NOMMER QUAND UNE COMMANDE A ÉTÉ COUPÉE PAR SON DÉLAI.
 *
 * Rend `undefined` dans tous les autres cas — c'est-à-dire chaque fois que la
 * sortie parle d'elle-même et que la reconnaissance au message doit garder la
 * main. Une commande tuée par son minuteur, elle, ne dit rien qu'on sache lire :
 * sans cette phrase, elle repartait en « panne non reconnue » et personne
 * n'était appelé.
 */
function panneSiDelaiDepasse(
  runId: string,
  etape: DeployStepKey,
  delaiDepasse?: boolean,
): PanneDePublication | undefined {
  if (!delaiDepasse) return undefined;
  return panneDeLenteur(STEP_LABELS[etape], constatDeLEtape(runId, etape));
}

/**
 * SUSPENDRE LA VEILLE PENDANT QU'UN DÉPANNEUR TRAVAILLE.
 *
 * Sans cela, l'étape tombée à la cinquième minute puis confiée vingt minutes à
 * un agent serait déclarée « en retard » à l'instant même où elle est rejouée,
 * et un second dépannage partirait sur le dos du premier — la boucle exacte que
 * le plafond de reprises cherche à éviter.
 */
function suspendreLaVeille(runId: string): void {
  const veille = veilles.get(runId);
  if (!veille || veille.suspendueDepuis) return;
  veille.suspendueDepuis = Date.now();
}

function reprendreLaVeille(runId: string): void {
  const veille = veilles.get(runId);
  if (!veille?.suspendueDepuis) return;
  veille.depannageMs += Date.now() - veille.suspendueDepuis;
  veille.suspendueDepuis = undefined;
  veille.derniereMention = undefined;
}

function passageDeVeille(runId: string): void {
  const veille = veilles.get(runId);
  if (!veille || veille.suspendueDepuis) return;

  const run = store.getDeploy(runId);
  const etape = run?.steps.find((step) => step.key === veille.etape);
  // La publication est finie, ou l'étape a tourné la page sans passer par
  // `setStep` : on ne tient pas un minuteur sur du vide.
  if (!run || run.state !== 'running' || etape?.state !== 'running') {
    fermerLaVeille(runId);
    return;
  }

  const constat = constatDeLEtape(runId, veille.etape);
  if (!constat.depasse) return;

  /*
   * ON PRÉVIENT AU CONSTAT, PAS AU DÉPANNAGE.
   *
   * Le dépanneur ne part qu'une fois l'étape RETOMBÉE — et pour une étape
   * pendue, cela peut vouloir dire jamais, ou seulement au bout de son plafond.
   * La ligne orange du déroulé, elle, ne se voit que par qui regarde déjà
   * l'écran. Prévenir ici est donc le seul moment qui tienne la promesse : ne
   * plus avoir à venir surveiller une publication soi-même. Une seule fois par
   * étape, et l'alerte DIT que rien n'est attendu de l'utilisateur.
   */
  if (!veille.alerteEnvoyee) {
    veille.alerteEnvoyee = true;
    const projet = store.getProject(run.projectId);
    const alerte = alerteDeRetard({ projet: projet?.name, libelleEtape: STEP_LABELS[veille.etape], constat });
    notify({
      motif: 'publication-en-retard',
      title: alerte.titre,
      body: alerte.corps,
      // Une étape d'une publication donnée ne prévient qu'une fois, même si le
      // démon redémarre et rouvre la veille.
      reference: `${run.projectId}:retard:${run.id}:${veille.etape}`,
      element: alerte.element,
      projectId: run.projectId,
    });
  }

  const mention = mentionEtapeQuiTraine(STEP_LABELS[veille.etape], constat);
  // Deux passages rendent souvent la même phrase (la durée s'arrondit à la
  // minute) : on ne réémet que ce qui a changé.
  if (mention === veille.derniereMention) return;
  veille.derniereMention = mention;
  const steps = run.steps.map((step) =>
    step.key === veille.etape ? { ...step, progress: mention, enRetard: true } : step,
  );
  emit({ ...run, steps });
}

/**
 * UN TOUR D'AGENT QUI NE REND PAS LA MAIN EST ARRÊTÉ, PROPREMENT.
 *
 * C'est le seul endroit de la publication où l'on COUPE quelque chose, et c'est
 * le seul qui en avait besoin : une commande a son délai, un tour d'agent n'en
 * avait aucun. Un moteur qui se tait tenait donc l'étape ouverte pour toujours.
 *
 * L'arrêt passe par `arreterLAgent` — la règle d'arrêt du démon, qui sait
 * couper un moteur vivant, refermer un tour sans moteur et n'a jamais touché au
 * service du démon. On ne réattend PAS le tour coupé : un moteur pendu dans un
 * appel réseau peut ne jamais rendre la main, et l'attendre reviendrait à
 * remplacer un blocage par un autre.
 *
 * Rien n'est perdu : le travail déjà écrit par l'agent est sur le disque, et
 * l'étape sera rejouée par-dessus.
 *
 * `reglages` n'est là que pour le contrôle du projet
 * (`scripts/verif-garde-fou-duree.mjs`) : il rejoue le mécanisme entier sans
 * attendre vingt minutes ni dépenser un tour de moteur. La publication, elle,
 * passe toujours par le plafond réel et par `arreterLAgent` — même convention
 * que `rejouerAvecDepannage`.
 */
export async function tourDAgentSousPlafond(
  agentId: string,
  motif: MotifDeTourDePublication,
  lancer: () => Promise<void>,
  reglages: { plafondMs?: number; arreter?: (agentId: string) => void } = {},
): Promise<{ depasse: boolean; ecouleMs: number; erreur?: unknown }> {
  const plafondMs = reglages.plafondMs ?? PLAFOND_TOUR_D_AGENT_MS[motif];
  const couper = reglages.arreter ?? arreterLAgent;
  const debut = Date.now();
  let erreur: unknown;

  const tour = lancer().then(
    () => 'fini' as const,
    (err) => {
      erreur = err;
      return 'fini' as const;
    },
  );

  /*
   * CE MINUTEUR-CI N'EST PAS `unref` — contrairement à celui de la veille, qui
   * ne fait qu'écrire une ligne. C'est LUI qui porte la garantie : un minuteur
   * détaché ne réveille pas le processus, et un tour d'agent qui ne rend jamais
   * la main n'atteindrait donc jamais son plafond dès que plus rien d'autre ne
   * tourne. Il est toujours désarmé sur le chemin normal, juste en dessous.
   */
  let minuteur: NodeJS.Timeout | undefined;
  const delai = new Promise<'delai'>((resolve) => {
    minuteur = setTimeout(() => resolve('delai'), plafondMs);
  });

  const issue = await Promise.race([tour, delai]);
  if (minuteur) clearTimeout(minuteur);

  if (issue === 'delai') {
    try {
      couper(agentId);
    } catch (err) {
      log.error(`publication : l’arrêt de l’agent ${agentId} a échoué — ${raisonEchecAgent(err)}`);
    }
    return { depasse: true, ecouleMs: Date.now() - debut };
  }
  return { depasse: false, ecouleMs: Date.now() - debut, erreur };
}

/* ------------------------------------------------------------------ */
/* Une étape qui tombe est réparée, puis rejouée                       */
/* ------------------------------------------------------------------ */

/**
 * Noter sur l'étape ce qui a été tenté pour la relever.
 *
 * Les reprises vivent DANS l'étape (`reprises`, `reparations`), pas dans un
 * fichier de journal : le déroulé de la colonne est le seul endroit où l'on
 * regarde après coup, et on doit y lire d'un coup d'œil ce qui est tombé, ce
 * qui a été tenté, et si ça a fini par passer.
 */
function noterLesReprises(
  run: DeployRun,
  key: DeployStepKey,
  bilan: { reprises: number; reparations: string[] },
): DeployRun {
  if (!bilan.reparations.length) return run;
  const steps = run.steps.map((step) =>
    step.key === key
      ? { ...step, reprises: bilan.reprises, reparations: [...(step.reparations ?? []), ...bilan.reparations] }
      : step,
  );
  return emit({ ...run, steps });
}

/**
 * Appeler un agent de dépannage sur une panne NOMMÉE, et attendre qu'il ait
 * fini.
 *
 * L'agent porte le rôle « deploy » et le motif « depannage » : accueil MINIMAL
 * (`niveauDAccueil`) — sa consigne dit déjà la panne, la sortie réelle et les
 * gestes attendus, il n'a rien à chercher dans l'index de la mémoire.
 */
async function appelerLeDepanneur(
  projectId: string,
  etape: DeployStepKey,
  panne: PanneDePublication,
  sortie: string,
  passe: number,
): Promise<{ tente: boolean; recit: string }> {
  const libelleEtape = STEP_LABELS[etape];
  const pose = await agentDePublication(projectId, titreDuDepanneur(libelleEtape));
  if ('manque' in pose) {
    return { tente: false, recit: recitDepanneurEnEchec(passe, recitFauteDeQuota(pose.manque)) };
  }
  const { agent } = pose;

  bus.toast('info', `Publication bloquée (${libelleEtape}) : un agent de dépannage intervient — reprise ${passe} sur ${REPARATIONS_MAX}.`);

  /*
   * LE DÉPANNEUR EST BORNÉ LUI AUSSI, et c'est le cas le plus important : un
   * agent appelé au secours d'une étape pendue qui se pend à son tour laissait
   * la publication arrêtée pour toujours, avec en prime l'apparence d'un
   * travail en cours. Il est donc arrêté au bout de son plafond, et son
   * abandon se DIT au lieu de disparaître.
   */
  const tour = await tourDAgentSousPlafond(agent.id, 'depannage', () =>
    sendPrompt(
      agent.id,
      consigneDeReparationDEtape({ libelleEtape, panne, sortie, passe, passesMax: REPARATIONS_MAX }),
      { template: 'free', silent: true, motif: 'depannage' },
    ),
  );
  if (tour.depasse) {
    return { tente: false, recit: recitDepanneurEnEchec(passe, recitTourCoupe('depannage', tour.ecouleMs)) };
  }
  if (tour.erreur) {
    return { tente: false, recit: recitDepanneurEnEchec(passe, raisonEchecAgent(tour.erreur)) };
  }
  const sansQuota = tourRefusePourQuota(agent.id);
  if (sansQuota) {
    return { tente: false, recit: recitDepanneurEnEchec(passe, recitFauteDeQuota(sansQuota)) };
  }
  return { tente: true, recit: '' };
}

/**
 * JOUER UNE ÉTAPE, LA FAIRE RÉPARER SI ELLE TOMBE, PUIS LA REJOUER.
 *
 * Le même mécanisme pour l'envoi, la mise en ligne, le redémarrage du service
 * et l'adresse publique — les quatre étapes qui n'avaient aucun secours et
 * laissaient la publication rouge. `jouer` doit être REJOUABLE : on l'appelle
 * autant de fois qu'il y a de reprises.
 *
 * DEUX REFUS, qui sont l'essentiel de la règle. Une panne NON RECONNUE n'est
 * jamais bricolée — on s'arrête et on le DIT. Une panne reconnue mais qui se
 * règle ailleurs (identifiant refusé, droit d'administration absent) est nommée
 * sans qu'on envoie personne. Dans les deux cas, l'étape retombe telle quelle,
 * avec le récit de ce qui a été tenté.
 *
 * `panne` force la panne au lieu de la reconnaître au message : c'est le cas de
 * l'adresse muette, qui est toujours la même panne quel que soit le motif rendu
 * par le réseau.
 *
 * `depanneur` n'est là que pour le contrôle du projet
 * (`scripts/verif-reparation-publication.mjs`) : il rejoue le mécanisme entier
 * sans dépenser un tour de moteur. La publication, elle, passe toujours par
 * l'agent — même convention que `construireAvecReparation`.
 *
 * UN DÉPASSEMENT DE DURÉE ENTRE PAR LE MÊME CHEMIN QU'UNE ERREUR, et c'est tout
 * l'intérêt : `jouer` peut NOMMER sa panne dans ce qu'il rend (`panne`), ce que
 * fait toute étape coupée par son délai — une commande tuée par son minuteur,
 * un tour d'agent arrêté par son plafond. Sans ce chemin, ces pannes-là
 * tombaient en « non reconnues », donc sans secours : exactement le cas que la
 * surveillance du temps devait couvrir. Le reste ne bouge pas — mêmes reprises
 * bornées, mêmes deux refus, même journal.
 */
export async function rejouerAvecDepannage(
  run: DeployRun,
  contexte: { projectId: string; etape: DeployStepKey; panne?: PanneDePublication },
  jouer: () => Promise<{ ok: boolean; sortie: string; panne?: PanneDePublication }>,
  depanneur = appelerLeDepanneur,
): Promise<{ run: DeployRun; ok: boolean; sortie: string; reprises: number; reparations: string[] }> {
  let courant = run;
  let issue = await jouer();
  const reparations: string[] = [];
  let reprises = 0;

  for (let passe = 1; !issue.ok && passe <= REPARATIONS_MAX; passe++) {
    /*
     * Trois sources, dans cet ordre : la panne IMPOSÉE par l'appelant (l'adresse
     * muette), celle que `jouer` a NOMMÉE lui-même (un délai dépassé, qu'aucun
     * message ne trahit), puis la reconnaissance au message. La dernière reste
     * la seule qui puisse rendre `null` — et `null` veut toujours dire « on ne
     * bricole pas ».
     */
    const panne = contexte.panne ?? issue.panne ?? reconnaitrePanneDePublication(contexte.etape, issue.sortie);
    if (!panne || !panne.reparable) {
      reparations.push(recitSansReparation(panne));
      /* Le REFUS de bricoler se lit dans le fil comme le reste : c'est une
         décision, pas un silence. */
      courant = noterAuJournal(courant, contexte.etape, recitSansReparation(panne), 'depannage');
      break;
    }
    const mention = mentionDeDepannage(panne, passe, REPARATIONS_MAX);
    courant = progresserEtape(courant, contexte.etape, mention, 'depannage');
    reparations.push(mention);

    /*
     * Le temps du dépanneur n'est pas du temps d'étape : la veille est
     * suspendue le temps qu'il travaille, sans quoi l'étape serait déclarée en
     * retard à l'instant où elle repart, et un dépannage naîtrait du précédent.
     */
    suspendreLaVeille(courant.id);
    let depanne: { tente: boolean; recit: string };
    try {
      depanne = await depanneur(contexte.projectId, contexte.etape, panne, issue.sortie, passe);
    } finally {
      reprendreLaVeille(courant.id);
    }
    if (!depanne.tente) {
      reparations.push(depanne.recit);
      courant = noterAuJournal(courant, contexte.etape, depanne.recit, 'depannage');
      break;
    }

    reprises += 1;
    courant = progresserEtape(
      courant,
      contexte.etape,
      `Reprise ${passe} de l’étape après réparation…`,
      'depannage',
    );
    issue = await jouer();
    const issueDite = issue.ok ? recitEtapeRejouee(passe) : recitEtapeRetombee(passe);
    reparations.push(issueDite);
    courant = noterAuJournal(courant, contexte.etape, issueDite, 'depannage');
  }

  /*
   * Au bout des reprises, une étape encore bloquée PAR LE TEMPS le dit avec ses
   * chiffres — sinon le déroulé rendrait « l'étape a été rejouée et elle est
   * retombée », sans jamais nommer ce qui n'a pas fini.
   */
  if (!issue.ok && issue.panne && reprises >= REPARATIONS_MAX) {
    reparations.push(recitDepassementNonResolu(constatDeLEtape(courant.id, contexte.etape), reprises));
  }

  return { run: courant, ok: issue.ok, sortie: issue.sortie, reprises, reparations };
}

/**
 * La branche principale du projet : celle que suit le dépôt distant, sinon
 * celle qui existe réellement. Deviner « main » sur un dépôt en « master »
 * ferait fusionner le lot dans la mauvaise branche.
 */
async function mainBranchOf(cwd: string): Promise<string> {
  const fromRemote = await runCommand(
    cwd,
    'git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed s@origin/@@',
    30000,
  );
  const remoteBranch = fromRemote.out.trim();
  if (remoteBranch) return remoteBranch;

  for (const candidate of ['main', 'master']) {
    const exists = await runCommand(cwd, `git rev-parse --verify --quiet ${candidate}`, 20000);
    if (exists.ok && exists.out.trim()) return candidate;
  }
  const current = await runCommand(cwd, 'git rev-parse --abbrev-ref HEAD', 20000);
  return current.out.trim() || 'main';
}

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
 * La branche réglée sur le projet l'emporte ; sans réglage, on retombe sur
 * « dev » pour un déploiement quand le dépôt en a une, sinon sur la branche
 * principale constatée — c'est-à-dire, pour tout projet existant, exactement le
 * comportement d'avant. La règle elle-même est pure
 * (`shared/src/branche-de-publication.ts`) ; ici on ne fait que lui apporter ce
 * qu'on lit sur le dépôt.
 */
async function brancheDeLEtape(project: Project, cible: CiblePublication) {
  const cwd = project.path;
  return brancheDePublication({
    cible,
    reglees: project.branchesDePublication,
    principale: await mainBranchOf(cwd),
    branchesConnues: await branchesConnues(cwd),
  });
}

/**
 * Se poser SUR la branche de l'étape, quitte à la créer d'après le dépôt
 * distant : une branche réglée peut n'exister que chez GitHub (un « dev » créé
 * depuis le site, jamais rapatrié ici). Sans ce rattrapage, la publication
 * s'arrêtait sur « pathspec did not match ».
 */
async function seposerSurLaBranche(cwd: string, branche: string): Promise<{ ok: boolean; out: string }> {
  const direct = await runCommand(cwd, `git checkout ${branche}`);
  if (direct.ok) return direct;

  await runCommand(cwd, `git fetch origin ${branche}`, 60000);
  const distante = await runCommand(cwd, `git rev-parse --verify --quiet origin/${branche}`, 20000);
  if (distante.out.trim()) {
    const depuisDistante = await runCommand(cwd, `git checkout -B ${branche} origin/${branche}`);
    if (depuisDistante.ok) return depuisDistante;
    return { ok: false, out: `${direct.out}\n${depuisDistante.out}` };
  }
  return direct;
}

/**
 * `signesGardes` : combien de signes de sortie on retient.
 *
 * Trois mille suffisent à une commande qui parle peu. Les contrôles du projet,
 * eux, écrivent des milliers de lignes et NOMMENT ce qui tombe au milieu :
 * couper la fin revenait à jeter la seule information utile. L'appelant demande
 * donc la sortie entière quand il sait la résumer lui-même.
 */
async function runCommand(
  cwd: string,
  command: string,
  timeout = 15 * 60 * 1000,
  signesGardes = 3000,
): Promise<{ ok: boolean; out: string; delaiDepasse?: boolean }> {
  const garder = (texte: string) => (signesGardes === Infinity ? texte : texte.slice(-signesGardes));
  try {
    const { stdout, stderr } = await execFileAsync('bash', ['-lc', command], {
      cwd,
      timeout,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true, out: garder(stdout + stderr) };
  } catch (err: any) {
    /*
     * UNE COMMANDE TUÉE PAR SON DÉLAI SE DIT, ELLE NE SE DEVINE PAS.
     *
     * `execFile` coupe au bout du délai et rend « Command failed … » avec le
     * signal en prime — un message que personne ne reconnaît, si bien qu'aucune
     * panne n'était nommée et que la publication s'arrêtait rouge sur du texte
     * brut. On le CONSTATE ici, au seul endroit qui le sait (`err.killed` posé
     * par Node quand c'est lui qui a coupé), et l'appelant peut alors nommer la
     * panne de lenteur au lieu de laisser passer une panne « inconnue ».
     */
    const delaiDepasse = err?.killed === true || err?.signal === 'SIGTERM';
    const entete = delaiDepasse
      ? `La commande a été coupée : elle n’avait toujours pas rendu la main après ${dureeDite(timeout)}.\n`
      : '';
    return {
      ok: false,
      out: entete + garder((err?.stdout ?? '') + (err?.stderr ?? '') + (err?.message ?? '')),
      delaiDepasse,
    };
  }
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
 */
async function poserLesOutilsDeConstruction(cwd: string): Promise<string> {
  const natif = await reparerLeModuleNatif(cwd);
  const manquants = OUTILS_DE_CONSTRUCTION.filter((outil) => !fs.existsSync(path.join(cwd, 'node_modules', '.bin', outil)));
  if (!manquants.length) return natif;
  const pose = await runCommand(
    cwd,
    'NODE_ENV=development npm install --include=dev --no-audit --no-fund',
    10 * 60 * 1000,
  );
  return natif + (pose.ok
    ? `Outils de construction absents (${manquants.join(', ')}) : installés avant de construire.\n\n`
    : `Outils de construction absents (${manquants.join(', ')}) et leur installation a échoué :\n${pose.out.slice(-800)}\n\n`);
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

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `systemctl` exige les droits d'administration ; le démon, lui, tourne sous un
 * compte ordinaire. Sans cela la relance répondait « Interactive authentication
 * required » et l'étape passait au rouge alors que le service, jamais touché,
 * restait « active » — l'échec le plus déroutant possible (03/08/2026).
 */
export function manqueDeDroits(sortie: string): boolean {
  return /authentication required|access denied|permission denied|interactive/i.test(sortie);
}

/** Le motif d'un échec de systemctl, dit en français. */
export function motifSystemctl(sortie: string): string {
  const texte = sortie.trim();
  if (manqueDeDroits(texte)) {
    return 'droits d’administration refusés (le compte qui publie ne peut pas relancer un service système)';
  }
  return texte.slice(-400) || 'raison non précisée par le système';
}

async function systemctlRoot(
  cwd: string,
  args: string,
  timeout = 60000,
): Promise<{ ok: boolean; out: string; delaiDepasse?: boolean }> {
  const direct = await runCommand(cwd, `systemctl ${args}`, timeout);
  if (direct.ok) return direct;
  if (!manqueDeDroits(direct.out)) return direct;
  return runCommand(cwd, `sudo -n systemctl ${args}`, timeout);
}

/** Les dernières lignes du journal du service : le vrai motif y est presque toujours. */
async function journalDuService(cwd: string, service: string): Promise<string> {
  const journal = await systemctlRoot(cwd, `--no-pager -n 12 -o cat status ${service}`, 30000);
  const texte = journal.out.trim();
  return texte ? `\nDernières lignes du service :\n${texte.slice(-1200)}` : '';
}

/**
 * Le contrôle de santé PUBLIC du service (jamais une route demandant une
 * connexion : elle répondrait « non autorisé » même sur un serveur parfaitement
 * à jour). On interroge /api/sante, et à défaut la page d'accueil : toute
 * réponse HTTP prouve que le processus écoute de nouveau.
 */
async function attendreReponse(port: number, secondes: number): Promise<{ ok: boolean; detail: string }> {
  const fin = Date.now() + secondes * 1000;
  let dernier = 'aucune réponse';
  while (Date.now() < fin) {
    for (const chemin of ['/api/sante', '/']) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}${chemin}`, { signal: AbortSignal.timeout(8000) });
        if (chemin === '/api/sante' && res.ok) {
          const corps: any = await res.json().catch(() => null);
          return { ok: true, detail: corps?.version ? `version ${corps.version}` : 'contrôle de santé favorable' };
        }
        if (res.status < 500) return { ok: true, detail: `le serveur répond sur le port ${port}` };
        dernier = `le serveur répond une erreur ${res.status}`;
      } catch (err: any) {
        dernier = err?.message ?? 'injoignable';
      }
    }
    await pause(3000);
  }
  return { ok: false, detail: dernier };
}

/**
 * Relance le service d'un projet et n'annonce le succès qu'une fois qu'il a
 * FINI de repartir. Beaucoup de projets se reconstruisent à leur démarrage :
 * les regarder cinq secondes après la relance ne prouvait rien.
 */
async function redemarrerService(
  cwd: string,
  service: string,
): Promise<{ ok: boolean; recit: string; lent?: boolean }> {
  const relance = await systemctlRoot(cwd, `restart ${service}`, 3 * 60 * 1000);
  if (!relance.ok) {
    return {
      ok: false,
      recit: `Le service ${service} n’a pas pu être relancé : ${motifSystemctl(relance.out)}`,
      // `systemctl restart` qui ne rend pas la main en trois minutes n'est pas
      // un refus : c'est un blocage, et il se nomme comme tel.
      lent: relance.delaiDepasse,
    };
  }

  // On attend qu'il ait fini de s'installer : « activating » n'est pas un échec.
  let etat = '';
  for (let essai = 0; essai < 60; essai += 1) {
    etat = (await systemctlRoot(cwd, `is-active ${service}`, 30000)).out.trim().split('\n').pop() ?? '';
    if (etat === 'active' || etat === 'failed') break;
    await pause(2000);
  }
  if (etat !== 'active') {
    const lisible =
      etat === 'failed'
        ? 'il s’est arrêté sur une erreur'
        : etat === 'activating'
          ? 'il n’a pas fini de démarrer après deux minutes'
          : `état inattendu « ${etat || 'inconnu'} »`;
    return {
      ok: false,
      recit: `Le service ${service} n’est pas reparti : ${lisible}.${await journalDuService(cwd, service)}`,
      // Un service coincé en « activating » depuis deux minutes n'a pas
      // échoué — il ne finit pas. Le journal ne dit alors rien qu'une
      // signature sache reconnaître : c'est le TEMPS qui nomme la panne.
      lent: etat === 'activating',
    };
  }

  const port = portDuService(service);
  if (!port) return { ok: true, recit: `${service} redémarré et actif (aucun port connu à interroger).` };

  const sante = await attendreReponse(port, 150);
  if (!sante.ok) {
    return {
      ok: false,
      recit: `Le service ${service} est actif mais ne répond pas encore sur le port ${port} : ${sante.detail}.${await journalDuService(cwd, service)}`,
    };
  }
  return { ok: true, recit: `${service} redémarré et vérifié : ${sante.detail}.` };
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
  const cwd = project.path;
  if (!(await runCommand(cwd, 'git rev-parse --git-dir', 20000)).ok) return vide;

  const dernier = store.lastSuccessfulDeploy(projectId);
  const depuis = dernier?.targetCommit?.trim();
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
  const existantes = await runCommand(cwd, 'git for-each-ref --format=%(refname:short) refs/heads', 20000);
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
    commits.push({ sha: sha?.trim() ?? '', titre: titre.trim(), branche: principale });
  }
  /* Les six premiers TITRES suffisent à l'affichage ; les enregistrements
     entiers servent à FICHER ce travail dans une carte, si on le demande. */
  return {
    nombre: commits.length,
    titres: commits.slice(0, 6).map((commit) => commit.titre),
    commits,
    branche: principale,
  };
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

export async function startDeploy(
  projectId: string,
  options: { cible?: CiblePublication; reprises?: number; selectedCardIds?: string[] } = {},
): Promise<{ ok: boolean; error?: string; run?: DeployRun }> {
  const project = store.getProject(projectId);
  if (!project) return { ok: false, error: 'projet introuvable' };

  /*
   * Quelle ÉTAPE du parcours ? Les deux existent toujours : le déploiement
   * prend le lot de « À déployer » et le pose en « En production » sans rien
   * clore ; la mise en production prend celui d'« En production » et clôt.
   */
  const etape = etapeDePublication(options.cible);

  /*
   * COMMENT la mise en ligne se fera, décidé une fois pour tout le run : le
   * prompt de mise en production s'il y en a un — et seulement pour une mise en
   * production —, sinon ce qu'on constate sur la machine pour le déploiement.
   */
  const promptProduction = promptDeLEtape(project, etape.cible);
  // Le TYPE de cible réglé pour la mise en production : SSH, FTP, Aucune ou
  // Consigne (le prompt, ci-dessus). Sans réglage, c'est « consigne » — le
  // fonctionnement d'avant ce réglage, intact.
  const typeCible = typeCibleReglee(project.miseEnProduction);

  /*
   * AUCUNE PROCÉDURE DÉFINIE, RIEN NE PART — pour les DEUX étapes, et AVANT
   * tout le reste : avant le motif de cible, avant même la file d'attente.
   *
   * Un projet neuf n'arrive plus avec un déploiement tout fait : tant que la
   * procédure de cette étape n'a pas été définie depuis la tête de sa colonne,
   * la publication est refusée et le refus dit où l'initier. Les projets d'avant
   * portent le marqueur « constaté » (migration 22) : pour eux, rien ne change.
   */
  if (!procedureEnPlace(project, etape.cible)) {
    return { ok: false, error: refusSansProcedure(etape.cible) };
  }

  /*
   * Une MISE EN PRODUCTION dont la CIBLE est réglée mais incomplète se refuse
   * ensuite : des champs d'accès manquants pour SSH/FTP. Le cas « aucun prompt »
   * est déjà tranché juste au-dessus, par la procédure. Le déploiement sur
   * l'instance de dev, lui, n'est jamais bloqué ici.
   */
  if (etape.cible === 'production') {
    const refus = refusCibleMiseEnProduction(project.miseEnProduction);
    if (refus) return { ok: false, error: refus };
  }

  // Une deuxième demande n'ouvre pas un run parallèle : elle attend son tour.
  if (active.has(projectId)) {
    waiting.set(projectId, { cible: etape.cible });
    const current = store.latestDeploy(projectId);
    if (current) emit({ ...current, queued: true });
    return { ok: true, error: 'une publication est déjà en cours' };
  }

  /*
   * Le dossier de travail est PARTAGÉ. Publier pendant qu'un agent écrit,
   * c'est embarquer un fichier à moitié écrit ou lui changer de branche sous
   * les pieds. On refuse, en nommant qui travaille encore.
   */
  const occupes = agentsOccupes(projectId);
  if (occupes.length) {
    return {
      ok: false,
      error: `Un agent travaille encore dans le dossier : ${occupes
        .map((agent) => agent.title)
        .join(', ')}. Attendez qu'il ait fini, ou arrêtez-le.`,
    };
  }

  /*
   * Le plan constaté sert le DÉPLOIEMENT sur l'instance de dev : un projet sans
   * instance sur ce serveur déploie quand même, le plan le dit plutôt que
   * d'éteindre le bouton. La mise en production, elle, suit le prompt (refusé
   * plus haut s'il manque).
   */
  const plan = planDeMiseEnLigne(
    moyensDuProjet(project.path, project.isSelf, promptProduction),
  );

  let cards = deployableCards(projectId, etape.source, options.selectedCardIds);
  // Cartes dont la branche est en conflit : écartées du lot, jamais perdues.
  const ecartees = new Set<string>();

  const run: DeployRun = DeployRun.parse({
    id: store.newId(),
    projectId,
    state: 'running',
    steps: STEP_ORDER.map((key) => ({ key, state: 'todo' as const, log: '' })),
    cardIds: cards.map((c) => c.id),
    /*
     * LA LISTE DES TÂCHES DU LOT, posée dès le départ avec toutes ses cartes
     * « en attente ». Elle se remplit ensuite au fil de la fusion, et c'est
     * elle qu'on lit en tête du tiroir : laquelle est passée, laquelle se fait
     * recoller, laquelle vient d'être écartée. Le compte de `cardIds`, lui, ne
     * disait qu'un nombre.
     */
    taches: cards.map((c) => ({
      cardId: c.id,
      titre: c.title,
      branche: c.github?.branch,
      etat: 'attente' as const,
    })),
    // L'étape voyage avec la publication : c'est elle qui dit dans quel bloc le
    // déroulé s'affiche, et d'où le lot repartira en cas de relance.
    cible: etape.cible,
    // Reprise après une coupure par un redémarrage : on porte le compte des
    // reprises déjà tentées, et on le DIT dans le compte rendu. 0 pour une
    // publication lancée normalement ou relancée à la main.
    reprises: options.reprises ?? 0,
    repriseApresCoupure: (options.reprises ?? 0) > 0,
    // L'adresse de dev n'est l'adresse contrôlée que d'un DÉPLOIEMENT : une mise
    // en production suit son prompt, qui dit lui-même quoi contrôler.
    url: etape.cible === 'dev' ? project.devUrl : typeCible !== 'consigne' ? project.miseEnProduction?.prodUrl : undefined,
    startedAt: Date.now(),
    queued: false,
  });
  emit(run);

  let stopped = false;
  // Le redémarrage du démon se fait EN DERNIER, une fois le run enregistré et
  // les cartes archivées : couper le processus plus tôt perdrait le compte rendu.
  let redemarrageDemande = false;
  active.set(projectId, { stop: () => (stopped = true) });

  void (async () => {
    let current = run;
    try {
      const cwd = project.path;
      const isGit = (await runCommand(cwd, 'git rev-parse --git-dir')).ok;
      /*
       * LA BRANCHE DE CETTE ÉTAPE, décidée une fois pour tout le run : celle
       * réglée dans les paramètres du projet, sinon « dev » quand le dépôt en a
       * une (déploiement seulement), sinon la branche principale constatée —
       * comme avant ce réglage.
       */
      const cibleBranche = await brancheDeLEtape(project, etape.cible);
      const brancheDuLot = cibleBranche.branche;

      // 1. Fusion des branches des cartes du lot
      current = setStep(current, 'merge', 'running');
      if (isGit && cards.length) {
        /*
         * LE DÉTAIL DE L'ÉTAPE S'ÉCRIT UNE FOIS, ET UNE SEULE.
         *
         * `setStep` AJOUTE ce qu'on lui donne à `step.log` : cette boucle lui
         * repassait son journal ENTIER à chaque conflit, d'où des lignes
         * répétées autant de fois qu'il y avait eu de conflits. Les lignes
         * sont donc gardées ici, et seule la SUITE part à `setStep`
         * (`lignesNouvelles`, `shared/src/fusion-du-lot.ts`).
         */
        const lignesDeFusion: string[] = [];
        let dejaEcrites = 0;
        const aVerser = () => {
          const suite = lignesNouvelles(lignesDeFusion, dejaEcrites);
          dejaEcrites = lignesDeFusion.length;
          return suite;
        };

        /*
         * Le dossier de travail est PARTAGÉ : un agent peut avoir laissé des
         * modifications non enregistrées. Git refuse alors de changer de
         * branche et toute la publication s'arrêtait là (rencontré le
         * 03/08/2026). On enregistre donc ce travail SUR SA PROPRE BRANCHE
         * avant de bouger : publier commence par ne rien perdre.
         */
        const enCours = await runCommand(cwd, 'git status --porcelain');
        if (enCours.out.trim()) {
          current = progresserEtape(current, 'merge', 'Enregistrement des travaux en cours…');
          const branche = (await runCommand(cwd, 'git rev-parse --abbrev-ref HEAD')).out.trim() || 'branche courante';
          await runCommand(cwd, 'git add -A');
          const enregistre = await runCommand(
            cwd,
            `git commit -m "Travaux en cours enregistrés avant publication" -m "Branche ${branche}"`,
          );
          lignesDeFusion.push(`${branche} : travaux en cours enregistrés${enregistre.ok ? '' : ' (échec)'}`);
          // La branche doit exister à distance pour être fusionnée plus tard.
          await runCommand(cwd, `git push -u origin ${branche}`, 60000).catch(() => undefined);
        }

        // Toutes les branches du lot vont sur la branche DE CETTE ÉTAPE.
        const mainBranch = brancheDuLot;
        lignesDeFusion.push(cibleBranche.raison);
        const checkout = await seposerSurLaBranche(cwd, mainBranch);
        if (!checkout.ok) {
          throw new Error(
            `Impossible de revenir sur la branche à installer (${mainBranch}) : ${checkout.out.slice(-200)}`,
          );
        }
        /*
         * Chaque carte est fusionnée POUR ELLE-MÊME : une branche en conflit est
         * mise de côté, elle n'emporte plus tout le lot avec elle (rencontré le
         * 03/08/2026 — un seul conflit et rien ne partait en ligne). Les cartes
         * écartées restent dans « À déployer » et repartiront au prochain coup.
         */
        let fusionnees = 0;
        // Le nombre de branches réellement à fusionner : c'est lui qui donne le
        // « sur N » de la progression, jamais le total des cartes (certaines
        // n'ont pas de branche).
        const aFusionner = cards.filter((card) => card.github?.branch).length;

        /*
         * LES BRANCHES QUI NE SE HEURTENT À RIEN PASSENT D'ABORD.
         *
         * Fusionnées dans l'ordre des cartes, chacune se heurtait au cumul de
         * toutes les précédentes : 0,11 conflit en moyenne pour un lot d'une
         * branche, 2,00 pour un lot de dix (audit du 18/08/2026). La
         * prévision se lit avec `git merge-tree`, qui fusionne EN MÉMOIRE —
         * ni le dossier de travail ni la branche courante ne bougent. Une
         * prévision illisible ne réordonne rien : `heurte` reste faux et
         * l'ordre d'origine tient.
         */
        current = progresserEtape(current, 'merge', 'Prévision des heurts sur le lot…');
        const prevision = await Promise.all(
          cards.map(async (card) => {
            const branche = card.github?.branch;
            if (!branche) return { cardId: card.id, heurte: false, card };
            const essai = await runCommand(
              cwd,
              `git merge-tree --write-tree --name-only ${mainBranch} ${branche}`,
              60000,
            );
            const fichiers = essai.ok ? [] : fichiersEnConflit(essai.out);
            const heurte = !essai.ok && (fichiers.length > 0 || essai.out.includes('CONFLICT'));
            return { cardId: card.id, heurte, card };
          }),
        );
        const heurts = prevision.filter((p) => p.heurte).length;
        const mention = mentionDeLOrdre(heurts, aFusionner);
        if (mention) {
          lignesDeFusion.push(mention);
          current = noterAuJournal(current, 'merge', mention, 'progression');
        }

        let rang = 0;
        for (const { card } of ordreDeFusion(prevision)) {
          const branch = card.github?.branch;
          if (!branch) continue;
          rang += 1;
          current = progresserEtape(current, 'merge', `Branche ${rang} sur ${aFusionner} : ${branch}`);
          current = marquerLaTache(current, card.id, 'fusion');

          // Une branche déjà nettoyée (carte ancienne, dépôt réinitialisé) ne
          // doit pas faire échouer tout le lot : on le dit et on continue.
          const exists = await runCommand(cwd, `git rev-parse --verify --quiet ${branch}`, 20000);
          if (!exists.ok || !exists.out.trim()) {
            lignesDeFusion.push(`${branch} : branche absente, carte ignorée`);
            current = marquerLaTache(current, card.id, 'absente');
            current = noterAuJournal(
              current,
              'merge',
              `${branch} : branche absente, carte « ${card.title} » ignorée.`,
              'issue',
            );
            continue;
          }

          /* LE SUIVI BRANCHE PAR BRANCHE : la commande de fusion et son issue
             sont écrites dans le fil, carte nommée. C'est ce qui manquait le
             plus — « Branche 10 sur 10 » n'apprenait rien des neuf autres. */
          const result = await commandeDuFil(current, 'merge', cwd, `git merge --no-edit ${branch}`);
          if (result.ok) {
            fusionnees += 1;
            lignesDeFusion.push(`${branch} : fusionnée`);
            current = marquerLaTache(current, card.id, 'fusionnee');
            current = noterAuJournal(current, 'merge', `${branch} : fusionnée (« ${card.title} »).`, 'issue');
            continue;
          }

          const enConflit = (await runCommand(cwd, 'git diff --name-only --diff-filter=U')).out
            .trim()
            .split('\n')
            .filter(Boolean);

          /*
           * UN HEURT DE PURE DOCUMENTATION SE RECOLLE ICI, SANS MOTEUR.
           *
           * 74 % des conflits mesurés ne portaient que sur `CLAUDE.md` et
           * `MEMOIRE.md` — des fichiers de texte que chaque agent complète en
           * fin de tâche. Chacun coûtait un agent, un tour de moteur et trois
           * minutes. La fusion est donc laissée EN COURS le temps de l'essai :
           * réussi, elle est enregistrée telle quelle ; refusé, on annule et
           * l'agent prend la main exactement comme avant.
           */
          if (conflitPurementDocumentaire(enConflit)) {
            const recollage = await recollerLaDocumentation(cwd, enConflit);
            if (recollage.recollee) {
              fusionnees += 1;
              lignesDeFusion.push(`${branch} : ${recollage.recit}`);
              current = marquerLaTache(current, card.id, 'recollee', enConflit.join(', '));
              current = noterAuJournal(
                current,
                'merge',
                `${branch} : ${recollage.recit} — aucun agent appelé.`,
                'issue',
              );
              continue;
            }
            if (recollage.recit) {
              current = noterAuJournal(
                current,
                'merge',
                `${branch} : recollage automatique refusé (${recollage.recit}) — un agent prend la main.`,
                'depannage',
              );
            }
          }

          await runCommand(cwd, 'git merge --abort');

          // Le conflit se règle ICI, pendant la publication : plus de carte à
          // valider, chiffrer et lancer pour un geste de plomberie.
          lignesDeFusion.push(
            `${branch} : CONFLIT${enConflit.length ? ` (${enConflit.join(', ')})` : ''} — résolution en cours…`,
          );
          current = marquerLaTache(current, card.id, 'conflit', enConflit.join(', '));
          // Seule la SUITE part au détail : le journal entier s'y recopiait.
          current = setStep(current, 'merge', 'running', aVerser());
          current = noterAuJournal(
            current,
            'merge',
            `${branch} : CONFLIT${enConflit.length ? ` sur ${enConflit.join(', ')}` : ''} — un agent de dépannage est appelé.`,
            'depannage',
          );

          const issue = await resoudreConflit(projectId, cwd, card, branch, mainBranch, enConflit);
          if (issue.fusionnee) {
            fusionnees += 1;
            lignesDeFusion.push(`${branch} : ${issue.recit}`);
            current = marquerLaTache(current, card.id, 'fusionnee', issue.recit);
            current = noterAuJournal(current, 'merge', `${branch} : ${issue.recit}`, 'depannage');
            continue;
          }
          ecartees.add(card.id);
          current = marquerLaTache(current, card.id, 'ecartee', issue.recit);
          lignesDeFusion.push(`${branch} : ${issue.recit} — carte écartée de cette publication`);
          current = noterAuJournal(
            current,
            'merge',
            `${branch} : ${issue.recit} — carte « ${card.title} » écartée de cette publication.`,
            'depannage',
          );
        }

        if (ecartees.size) {
          cards = cards.filter((card) => !ecartees.has(card.id));
          current = emit({ ...current, cardIds: cards.map((card) => card.id) });
        }
        if (!fusionnees && ecartees.size) {
          throw new Error(
            `Toutes les branches du lot sont en conflit (${ecartees.size}). Rien n'a pu être fusionné : résolvez les conflits puis relancez.`,
          );
        }
        current = setStep(
          current,
          'merge',
          'done',
          aVerser() || (lignesDeFusion.length ? '' : 'aucune branche à fusionner'),
        );
      } else {
        current = setStep(current, 'merge', 'skipped', isGit ? 'aucune carte à embarquer' : 'projet sans dépôt git');
      }
      if (stopped) throw new Error('arrêt demandé');

      // 2 & 3. Enregistrement et envoi
      if (isGit) {
        current = setStep(current, 'commit', 'running');
        const status = await runCommand(cwd, 'git status --porcelain');
        if (status.out.trim()) {
          await runCommand(cwd, 'git add -A');
          const commit = await commandeDuFil(
            current,
            'commit',
            cwd,
            `git commit -m "Publication : ${cards.length} tâche(s)" -m "HaikoDev"`,
          );
          current = setStep(current, 'commit', commit.ok ? 'done' : 'failed', commit.out);
        } else {
          current = setStep(current, 'commit', 'skipped', 'rien à enregistrer');
        }

        // Un projet sans dépôt distant n'a rien à envoyer : ce n'est pas un échec.
        const hasRemote = (await runCommand(cwd, 'git remote')).out.trim().length > 0;
        if (hasRemote) {
          current = setStep(current, 'push', 'running');
          /*
           * `git push` tout court échoue quand la branche locale ne porte PAS
           * le même nom que celle qu'elle suit (dossier remis sur
           * « archive/main » qui suit « origin/main ») : la règle « simple »
           * de git refuse alors d'envoyer. On vise donc explicitement la
           * branche suivie, et on retombe sur -u si aucune n'est configurée.
           */
          /*
           * L'ENVOI SE RÉPARE ET SE REJOUE. Le cas courant est le plus bête :
           * une autre carte a poussé pendant que la publication vérifiait et
           * construisait, git refuse l'envoi (« non-fast-forward »), et tout
           * s'arrêtait là — alors qu'il suffit de récupérer et de rejouer.
           * La commande est RECALCULÉE à chaque reprise : l'agent a pu remettre
           * la branche suivie d'aplomb.
           */
          const envoyer = async () => {
            const suivie = (
              await runCommand(cwd, 'git rev-parse --abbrev-ref --symbolic-full-name @{u}', 20000)
            ).out.trim();
            const locale = (await runCommand(cwd, 'git rev-parse --abbrev-ref HEAD', 20000)).out.trim();
            const commande = suivie.includes('/')
              ? `git push ${suivie.slice(0, suivie.indexOf('/'))} HEAD:${suivie.slice(suivie.indexOf('/') + 1)}`
              : `git push -u origin ${locale}`;
            const push = await commandeDuFil(current, 'push', cwd, commande);
            // Un envoi qui n'a jamais rendu la main (dépôt distant muet, clé qui
            // attend une phrase de passe) est une panne NOMMÉE, pas une sortie
            // illisible : sans cela, elle repartait en « non reconnue ».
            return {
              ok: push.ok,
              sortie: push.out,
              panne: panneSiDelaiDepasse(current.id, 'push', push.delaiDepasse),
            };
          };
          const envoi = await rejouerAvecDepannage(current, { projectId: project.id, etape: 'push' }, envoyer);
          current = envoi.run;
          current = setStep(current, 'push', envoi.ok ? 'done' : 'failed', `${envoi.sortie}${journalDesReprises(envoi.reparations)}`);
          current = noterLesReprises(current, 'push', envoi);
          if (!envoi.ok) throw new Error("L'envoi sur le dépôt a échoué.");
        } else {
          current = setStep(current, 'push', 'skipped', 'aucun dépôt distant configuré');
        }

        const head = await runCommand(cwd, 'git rev-parse HEAD');
        current = emit({ ...current, targetCommit: head.out.trim().slice(0, 40) });
      } else {
        current = setStep(current, 'commit', 'skipped', 'projet sans dépôt git');
        current = setStep(current, 'push', 'skipped', 'projet sans dépôt git');
      }
      if (stopped) throw new Error('arrêt demandé');

      /*
       * 4 à 7 : la mise en ligne, telle que le plan l'a décidée avant de
       * partir. Un PROMPT DE MISE EN PRODUCTION réglé passe devant ; sinon on
       * rafraîchit l'instance de dev constatée sur la machine, et le déroulé
       * est alors le même pour tous les projets.
       */
      const prompt = promptProduction;
      if (etape.cible === 'production' && typeCible !== 'consigne') {
        /*
         * UN TYPE DE CIBLE EST RÉGLÉ (Aucune, SSH ou FTP) : plus besoin d'un
         * prompt, HaikoDev exécute lui-même le transfert. La construction se
         * fait normalement quand le projet en a une ; « Aucune » n'a rien à
         * construire ni à transférer.
         */
        current = setStep(
          current,
          'verify',
          'skipped',
          `Cible « ${typeCible} » : aucune vérification propre à ce type de mise en production.`,
        );

        if (typeCible !== 'aucune' && scriptExiste(cwd, 'build')) {
          current = setStep(current, 'build', 'running');
          current = progresserEtape(current, 'build', 'Construction du projet (npm run build)…');
          const pose = await poserLesOutilsDeConstruction(cwd);
          const build = await construireAvecReparation(project.id, cwd, 'npm run build', pose);
          current = setStep(current, 'build', build.ok ? 'done' : 'failed', build.detail);
          if (!build.ok) throw new Error(build.phrase);
        } else {
          current = setStep(
            current,
            'build',
            'skipped',
            typeCible === 'aucune' ? 'Type « Aucune » : rien à construire ni à transférer.' : 'Ce projet n’a pas de script de construction : transfert du dossier tel quel.',
          );
        }

        current = setStep(current, 'publish', 'running');
        current = progresserEtape(
          current,
          'publish',
          typeCible === 'ssh' ? 'Transfert vers le serveur SSH…' : typeCible === 'ftp' ? 'Transfert vers le serveur FTP…' : 'Rien à transférer…',
        );
        // Le transfert se répare et se rejoue comme les autres étapes : un
        // dossier refusé à l'écriture, un disque plein, un chemin absent sont
        // des pannes de plomberie, pas des fins de non-recevoir.
        const transfert = await rejouerAvecDepannage(current, { projectId: project.id, etape: 'publish' }, async () => {
          const resultat = await executerCibleMiseEnProduction(project, cwd);
          return { ok: resultat.ok, sortie: resultat.recit };
        });
        current = transfert.run;
        current = setStep(
          current,
          'publish',
          transfert.ok ? 'done' : 'failed',
          `${transfert.sortie}${journalDesReprises(transfert.reparations)}`,
        );
        current = noterLesReprises(current, 'publish', transfert);
        if (!transfert.ok) throw new Error(transfert.sortie);

        current = setStep(
          current,
          'restart',
          'skipped',
          typeCible === 'ssh' && project.miseEnProduction?.ssh?.commandeFin?.trim()
            ? 'Commande de fin exécutée pendant le transfert.'
            : 'Rien à relancer pour ce type de cible.',
        );
      } else if (prompt) {
        /*
         * UN PROMPT DE MISE EN PRODUCTION EST RÉGLÉ : c'est un agent qui mène
         * la mise en ligne.
         *
         * Les quatre étapes restent en place et parlent toutes — trois disent
         * que le prompt les couvre, la quatrième porte le compte rendu de
         * l'agent. La plomberie git au-dessus, elle, n'a pas bougé : c'est elle
         * qui garantit le lot et la fermeture des branches.
         */
        current = setStep(current, 'verify', 'skipped', mentionEtapeConfiee('verify'));
        current = setStep(current, 'build', 'skipped', mentionEtapeConfiee('build'));

        current = setStep(current, 'publish', 'running', mentionEtapeConfiee('publish'));
        current = progresserEtape(current, 'publish', 'L’agent de mise en production suit le prompt du projet…');
        /*
         * La mise en ligne confiée se rejoue elle aussi — mais SEULEMENT sur
         * une panne RECONNUE. Un agent qui s'est arrêté sur une cause qu'on ne
         * sait pas nommer n'est pas renvoyé à l'aveugle : ce serait relancer un
         * transfert à moitié fait sur un espoir. La reprise reste, dans tous les
         * cas, celle de la publication que l'utilisateur a lancée : rien de neuf
         * n'est mis en ligne de notre propre initiative.
         */
        let dernierRecit = '';
        let derniereRaison: string | undefined;
        const confiee = await rejouerAvecDepannage(current, { projectId: project.id, etape: 'publish' }, async () => {
          const menee = await confierLaMiseEnLigne(
            project.id,
            {
              projet: project.name,
              dossier: cwd,
              branche: brancheDuLot,
              // Pas d'adresse imposée : l'adresse de dev n'est pas celle d'une mise
              // en production, et c'est le prompt qui dit quoi contrôler.
              url: undefined,
              prompt,
              cartes: cards.map((card) => ({ titre: card.title, branche: card.github?.branch })),
              enregistrement: current.targetCommit,
              clot: etape.clot,
            },
            constatDeLEtape(current.id, 'publish'),
          );
          dernierRecit = menee.recit;
          derniereRaison = menee.raison;
          /*
           * Un agent qui S'ARRÊTE sur une cause qu'on ne sait pas nommer n'est
           * toujours pas renvoyé à l'aveugle. Mais un agent qui ne RÉPOND PLUS
           * est une panne nommée : elle repart en dépannage puis en reprise, au
           * lieu de laisser la publication rouge sur un silence.
           */
          return { ok: menee.ok, sortie: menee.raison ?? menee.recit, panne: menee.panne };
        });
        current = confiee.run;
        current = setStep(
          current,
          'publish',
          confiee.ok ? 'done' : 'failed',
          `${dernierRecit}${journalDesReprises(confiee.reparations)}`,
        );
        current = noterLesReprises(current, 'publish', confiee);
        // Un échec reste un échec, NOMMÉ : rien n'est annoncé « publié ».
        if (!confiee.ok) throw new Error(phraseDEchecConfie(derniereRaison));

        current = setStep(current, 'restart', 'skipped', mentionEtapeConfiee('restart'));
      } else if (project.isSelf) {
        /*
         * HaikoDev se publie lui-même. La fusion est déjà faite juste au-dessus :
         * on construit CE lot fusionné, puis on INSTALLE le résultat dans le
         * dossier servi. C'est le seul moment où ce que voit l'utilisateur
         * change — une branche non envoyée ne peut plus rien y faire.
         */
        current = setStep(current, 'verify', 'running');
        /*
         * `npm test` lit `server/dist` — le code COMPILÉ. Sans cette
         * recompilation, l'étape jugeait le dist du dernier lancement du démon
         * et non le lot qu'on vient de fusionner : un correctif déjà écrit
         * échouait indéfiniment, et un test réparé restait rouge tant que
         * personne n'avait reconstruit à la main. On pose donc les outils et on
         * recompile shared + server AVANT de vérifier ; l'étape « build » qui
         * suit refait l'ensemble, interface comprise.
         */
        const poseVerif = await poserLesOutilsDeConstruction(cwd);
        const suivreControle = (label: string) => {
          current = progresserEtape(current, 'verify', label);
        };
        let verify = await controlerLeProjet(cwd, suivreControle);
        const passes: string[] = [];
        /*
         * Un contrôle tombé n'arrête plus la publication du premier coup : un
         * agent de publication le répare sur-le-champ, puis on rejoue tout —
         * compilation comprise. Le refus reste entier au bout de
         * `REPARATIONS_MAX` passes.
         */
        for (let passe = 1; !verify.ok && passe <= REPARATIONS_MAX; passe++) {
          const repare = await reparerLesControles(project.id, cwd, verify, passe);
          passes.push(repare.recit);
          if (!repare.tente) break;
          verify = await controlerLeProjet(cwd, suivreControle);
        }
        const journalDesPasses = passes.length ? `\n\nRéparations tentées :\n${passes.map((p) => `- ${p}`).join('\n')}` : '';
        if (!verify.ok && verify.etape === 'compilation') {
          current = setStep(
            current,
            'verify',
            'failed',
            `${poseVerif}Les contrôles portent sur le code compilé : sa compilation a échoué avant même de les lancer.\n\n\`npm run build:server\`\n${verify.out.slice(-2000)}${journalDesPasses}`,
          );
          throw new Error('Le code ne compile pas : les contrôles n’ont pas pu être lancés, rien n’est mis en ligne.');
        }
        current = setStep(
          current,
          'verify',
          verify.ok ? 'done' : 'failed',
          verify.ok
            ? `${poseVerif}Code recompilé avant les contrôles (\`npm run build:server\`).${journalDesPasses}\n\n${verify.out.slice(-800)}`
            : `${detailDEchec(verify.out)}${journalDesPasses}`,
        );
        // Le refus ne bouge pas ; ce qui change, c'est qu'il NOMME ce qui tombe.
        if (!verify.ok) throw new Error(phraseDEchec(verify.out));

        current = setStep(current, 'build', 'running');
        current = progresserEtape(current, 'build', 'Recompilation du projet (npm run build)…');
        const pose = await poserLesOutilsDeConstruction(cwd);
        const build = await construireAvecReparation(project.id, cwd, 'npm run build', pose);
        current = setStep(current, 'build', build.ok ? 'done' : 'failed', build.detail);
        if (!build.ok) throw new Error(build.phrase);

        current = setStep(current, 'publish', 'running');
        current = progresserEtape(current, 'publish', 'Installation de la nouvelle version dans le dossier servi…');
        /*
         * L'installation touche le disque : droits, place, dossier absent. Elle
         * se répare et se rejoue comme le reste, au lieu de faire tomber une
         * publication dont tout le travail est déjà fait.
         */
        let recitInstallation = '';
        const installation = await rejouerAvecDepannage(current, { projectId: project.id, etape: 'publish' }, async () => {
          try {
            recitInstallation = installerApplication();
            return { ok: true, sortie: recitInstallation };
          } catch (err) {
            recitInstallation = raisonEchecAgent(err);
            return { ok: false, sortie: recitInstallation };
          }
        });
        current = installation.run;
        current = setStep(
          current,
          'publish',
          installation.ok ? 'done' : 'failed',
          `${recitInstallation}${journalDesReprises(installation.reparations)}`,
        );
        current = noterLesReprises(current, 'publish', installation);
        if (!installation.ok) throw new Error(`L’installation dans le dossier servi a échoué : ${recitInstallation}`);

        /*
         * Le serveur garde le code chargé à son LANCEMENT : installer
         * l'interface ne suffit pas quand le code serveur a changé. Publier
         * redémarre donc tout seul — mais jamais sous les pieds d'un agent au
         * travail, tous projets confondus, car le démon les porte tous.
         */
        const etat = etatDemon();
        // Les agents dont le MOTEUR écrit, ET ceux dont le tour vient de partir :
        // ouvrir une copie de travail et choisir un compte prend plusieurs
        // secondes, pendant lesquelles un agent tout juste lancé n'existait pour
        // personne — et se faisait couper par ce redémarrage.
        const autres = agentsActifs().length;
        // Les AUTRES publications en cours (jamais celle-ci, encore « running »
        // en base à cet instant) : les couper laisserait leur lot à moitié parti.
        const autresPublications = store
          .runningDeploys()
          .filter((r) => r.id !== current.id)
          .map((r) => store.getProject(r.projectId)?.name ?? 'un projet');
        if (!etat.redemarrageNecessaire) {
          current = setStep(current, 'restart', 'skipped', 'Seule l’interface a changé : le serveur en place sert déjà le bon code.');
        } else if (autres > 0) {
          current = setStep(
            current,
            'restart',
            'skipped',
            `${autres} agent(s) travaillent encore : le redémarrage attend pour ne pas couper leur travail. Il se fait d’un clic sous la liste des projets.`,
          );
        } else if (autresPublications.length > 0) {
          // Une autre publication tourne : le redémarrage est RETENU, il partira
          // tout seul dès la dernière publication terminée.
          current = setStep(
            current,
            'restart',
            'skipped',
            `${autresPublications.length} autre(s) publication(s) en cours (${autresPublications
              .map((n) => `« ${n} »`)
              .join(', ')}) : le redémarrage attend qu’elles finissent. Il partira tout seul dès la dernière terminée.`,
          );
          redemarrageDemande = true;
        } else {
          current = setStep(current, 'restart', 'done', 'Le serveur redémarre : il repart avec le nouveau code en quelques secondes.');
          redemarrageDemande = true;
        }
      } else {
        /*
         * Un projet ordinaire : le plan a déjà dit COMMENT il peut être mis en
         * ligne — par son service système, ou parce que son dossier est servi
         * tel quel par un serveur web. Chaque étape nomme ce qu'elle a fait ou
         * pourquoi elle ne l'a pas fait : plus de « ignoré » sans motif.
         */
        current = setStep(
          current,
          'verify',
          'skipped',
          scriptExiste(cwd, 'test')
            ? 'Ce projet a des tests mais aucune vérification n’est configurée pour la publication.'
            : 'Ce projet n’a pas de vérification à jouer.',
        );

        if (plan.construction === 'npm') {
          current = setStep(current, 'build', 'running');
          current = progresserEtape(current, 'build', 'Construction du projet (npm run build)…');
          const build = await construireAvecReparation(project.id, cwd, 'npm run build');
          current = setStep(current, 'build', build.ok ? 'done' : 'failed', build.detail);
          if (!build.ok) throw new Error(build.phrase);
        } else {
          current = setStep(current, 'build', 'skipped', 'Ce projet n’a pas de script de construction : il n’y a rien à construire.');
        }

        if (plan.installation === 'dossier-servi') {
          /*
           * Site statique : le serveur web lit ce dossier à chaque demande. La
           * fusion a donc DÉJÀ posé la version en ligne — il n'y a rien à
           * copier, et c'est l'adresse publique qui en fait foi juste après.
           */
          current = setStep(
            current,
            'publish',
            'done',
            `Le serveur web sert ${cwd} tel quel : les fichiers en place sont, à cet instant, la version en ligne.`,
          );
        } else if (plan.installation === 'service') {
          current = setStep(
            current,
            'publish',
            'done',
            `Le code est en place dans ${cwd} ; c’est le redémarrage du service qui va le mettre en ligne.`,
          );
        } else {
          /*
           * Aucune instance de dev sur ce serveur. Le lot est bien fusionné,
           * enregistré et envoyé — c'est du travail réel —, mais on ne fait
           * PAS semblant de l'avoir installé quelque part.
           */
          current = setStep(current, 'publish', 'skipped', plan.raison);
        }

        if (plan.redemarrage !== 'service') {
          current = setStep(
            current,
            'restart',
            'skipped',
            plan.installation === 'dossier-servi'
              ? 'Aucun service système ne tourne sur ce dossier : le serveur web relit les fichiers à chaque demande, il n’y a rien à relancer.'
              : 'Aucun service système ne tourne sur ce dossier : il n’y a rien à relancer ici.',
          );
        } else {
          const service = serviceDuProjet(cwd);
          if (!service) {
            // Le service a disparu entre le plan et l'exécution : rien n'a pu
            // être mis en ligne, on ne fait pas semblant.
            current = setStep(current, 'restart', 'failed', 'Le service système attendu sur ce dossier a disparu : rien n’a été mis en ligne.');
            throw new Error('Le service système attendu sur ce dossier a disparu : rien n’a été mis en ligne.');
          }
          current = setStep(current, 'restart', 'running');
          current = progresserEtape(current, 'restart', `Redémarrage du service ${service}…`);
          /*
           * Le service du PROJET, jamais celui du démon : c'est un service
           * ordinaire, qu'on peut relancer et faire réparer. La consigne de
           * dépannage interdit en toutes lettres de toucher au service
           * d'HaikoDev, qui porte cette publication.
           */
          let recitRedemarrage = '';
          const relance = await rejouerAvecDepannage(current, { projectId: project.id, etape: 'restart' }, async () => {
            const bilan = await redemarrerService(cwd, service);
            recitRedemarrage = bilan.recit;
            return {
              ok: bilan.ok,
              sortie: bilan.recit,
              panne: panneSiDelaiDepasse(current.id, 'restart', bilan.lent),
            };
          });
          current = relance.run;
          current = setStep(
            current,
            'restart',
            relance.ok ? 'done' : 'failed',
            `${recitRedemarrage}${journalDesReprises(relance.reparations)}`,
          );
          current = noterLesReprises(current, 'restart', relance);
          // Le motif exact remonte tel quel : plus de ligne rouge sans explication.
          if (!relance.ok) throw new Error(recitRedemarrage.split('\n')[0]);
        }
      }

      // Le verdict se lit sur le RÉSULTAT, pas sur le processus (PLAN §11) :
      // on vérifie ce qui est réellement servi à l'adresse de dev. Ce contrôle
      // ne vaut QUE pour un DÉPLOIEMENT : l'adresse de dev n'est pas celle d'une
      // mise en production, dont c'est le prompt de l'agent qui dit quoi
      // contrôler.
      if (etape.cible === 'dev' && project.devUrl) {
        const controle = await controlerLAdresse(current, project.id, project.devUrl);
        current = controle.run;
        // Une adresse muette n'est pas un déploiement réussi : autrefois
        // l'étape passait au rouge et le run se déclarait quand même « réussi ».
        // Elle vaut désormais un dépannage et une nouvelle vérification : c'est
        // le seul contrôle qui juge le RÉSULTAT, donc celui qui mérite le plus
        // qu'on essaie de le faire passer avant d'abandonner.
        if (!controle.ok) throw new Error(controle.verdict);
      } else if (etape.cible === 'production' && typeCible !== 'consigne' && project.miseEnProduction?.prodUrl) {
        /*
         * Même contrôle, pour une mise en production SSH ou FTP : l'adresse
         * réglée pour ce projet en production, vérifiée après le transfert —
         * exactement comme le déploiement le fait pour l'instance de dev.
         */
        const controle = await controlerLAdresse(current, project.id, project.miseEnProduction.prodUrl);
        current = controle.run;
        if (!controle.ok) throw new Error(controle.verdict);
      }

      /*
       * Dernier garde-fou : sept étapes « ignorées » ne font pas un
       * déploiement. Fusionner, enregistrer et envoyer comptent — c'est du
       * travail réel, même sans instance sur ce serveur ; mais un projet où
       * RIEN n'a bougé échoue au lieu de faire avancer ses cartes.
       */
      const etats = Object.fromEntries(current.steps.map((step) => [step.key, step.state])) as Record<
        DeployStepKey,
        'todo' | 'running' | 'done' | 'failed' | 'skipped'
      >;
      if (
        !miseEnLigneReelle({
          merge: etats.merge,
          commit: etats.commit,
          push: etats.push,
          build: etats.build,
          publish: etats.publish,
          restart: etats.restart,
        })
      ) {
        throw new Error(
          'Rien n’a réellement eu lieu : aucune fusion, aucun envoi, aucune construction, aucun redémarrage. Les cartes restent où elles sont.',
        );
      }

      /*
       * TOUT CE QUI EST PASSÉ EST EN LIGNE : le dernier mot de chaque tâche du
       * lot. Ce qui a été ÉCARTÉ garde son état — la carte est restée dans « À
       * déployer », et lui écrire « en ligne » serait un mensonge.
       */
      current = emit({
        ...current,
        state: 'success',
        endedAt: Date.now(),
        currentStep: undefined,
        taches: current.taches?.length ? lotMisEnLigne(current.taches) : current.taches,
      });

      /*
       * Ce qui se passe quand une carte est vraiment en ligne (PLAN §11).
       *
       * Où elle se pose dépend de l'ÉTAPE. La MISE EN PRODUCTION clôt la carte :
       * document de clôture, branche refermée, « Archivé ». Le DÉPLOIEMENT, lui,
       * se contente de la faire avancer dans « En production » : le travail
       * tourne sur l'instance de dev, mais rien n'est fini et la carte reste
       * reprenable. Une carte déployée ne part donc plus jamais aux archives.
       */
      /*
       * CE RANGEMENT NE PEUT PLUS FAIRE ÉCHOUER UNE MISE EN LIGNE RÉUSSIE.
       *
       * Le 17/08/2026, une publication d'HaikoDev a fusionné, envoyé, vérifié,
       * construit et INSTALLÉ le lot — les sept étapes au vert ou sautées —
       * puis s'est déclarée EN ÉCHEC, en rouge, avec pour seul message un
       * tableau d'erreurs de validation illisible. La cause était ici : une
       * carte de la base portait un champ à `null` là où le modèle attend une
       * chaîne ou RIEN (`sansModification`, posé par la migration 28 dans sa
       * première écriture), `store.getCard` refusait de la lire, et
       * l'exception remontait au `catch` général — alors que le code était
       * déjà en ligne.
       *
       * Le rangement des cartes est de la COMPTABILITÉ : il vient APRÈS la
       * mise en ligne et ne peut plus la démentir. Chaque carte est donc rangée
       * SOUS SON PROPRE FILET — une carte illisible n'emporte plus les six
       * autres —, et l'incident est DIT (avertissement de la publication,
       * visible sous le déroulé) au lieu de transformer une réussite en échec.
       */
      const cartesNonRangees: string[] = [];
      for (const cardId of current.cardIds) {
        try {
          const card = store.getCard(cardId);
          if (!card) continue;
          const deployed = store.saveCard({ ...card, deployedAt: Date.now() });
          bus.emit({ type: 'card.upsert', card: deployed });
          if (etape.clot) {
            await archiveCard(cardId, { url: project.devUrl, commit: current.targetCommit });
          } else {
            const avancee = store.saveCard({
              ...deployed,
              column: etape.arrivee,
              position: store.nextPosition(card.projectId, etape.arrivee),
            });
            bus.emit({ type: 'card.upsert', card: avancee });
          }
        } catch (err) {
          // On ne relit pas la carte pour son titre : c'est justement sa
          // lecture qui vient d'échouer.
          cartesNonRangees.push(`${cardId} (${raisonEchecAgent(err)})`);
          log.error(`publication : carte ${cardId} non rangée après la mise en ligne — ${raisonEchecAgent(err)}`);
        }
      }
      if (cartesNonRangees.length) {
        current = emit({
          ...current,
          avertissement: avertissementCartesNonRangees(cartesNonRangees),
        });
      }

      const reste = ecartees.size
        ? ` — ${ecartees.size} carte(s) écartée(s) pour conflit, restées à déployer`
        : '';
      // Deux étapes, deux annonces : on nomme celle qui vient d'aboutir.
      const ou = ` (${etape.libelle})`;
      notify({
        motif: 'publication-terminee',
        title: `Publication terminée${ou}`,
        body: `${current.cardIds.length} tâche(s) en ligne${reste}`,
        /* Une publication = un lot posé sur un enregistrement précis, à une
           ÉTAPE précise : le même lot déployé puis mis en production fait bien
           deux alertes, sinon la seconde serait avalée comme un doublon. */
        reference: `${projectId}:${etape.cible}:${current.targetCommit ?? current.cardIds.join(',')}`,
        element: `${current.cardIds.length} tâche(s) en ligne${ou}`,
        projectId,
      });
      bus.toast(ecartees.size ? 'info' : 'success', `Publication terminée${ou}${reste}`);

      // Tout est enregistré : le serveur peut repartir avec le nouveau code —
      // mais jamais sous une AUTRE publication. `demanderRedemarrage` rejoue la
      // règle : il part si plus rien ne publie, sinon il est retenu et repartira
      // à la fin de la dernière publication. Cette publication-ci est déjà
      // « réussie » en base, donc elle ne se compte plus.
      if (redemarrageDemande) setTimeout(() => void demanderRedemarrage(), 2000);
    } catch (err: any) {
      /*
       * La raison passe par `raisonEchecAgent` : une exception de VALIDATION
       * (Zod) y devient une phrase, au lieu du tableau `issues` brut qui
       * s'affichait jusqu'ici en rouge sous la publication — illisible, et sans
       * le moindre indice sur ce qu'il fallait réparer.
       */
      const raison = raisonEchecAgent(err);
      current = emit({
        ...current,
        state: stopped ? 'stopped' : 'failed',
        error: raison,
        endedAt: Date.now(),
      });
      // On nomme le projet, l'étape tombée (celle marquée en échec, sinon celle
      // qui tournait) et où lire le détail — jamais l'exception brute toute nue.
      const etapeTombee = current.steps.find((s) => s.state === 'failed')?.key ?? current.currentStep;
      // La NATURE ne se lit que sur une étape RÉELLEMENT tombée : le repli sur
      // `currentStep` reste posé même quand le run est mort en route, et ferait
      // passer une coupure par redémarrage pour une casse.
      const etapeReellementTombee = current.steps.find((s) => s.state === 'failed')?.key;
      const nature = natureDePublication({
        etat: stopped ? 'stopped' : 'failed',
        etapeTombee: etapeReellementTombee,
        motif: raison,
      });
      const message = messageEchecPublication({
        projet: project?.name,
        etape: etapeTombee ? STEP_LABELS[etapeTombee] : undefined,
        raison,
        nature: nature ?? undefined,
      });
      bus.toast('error', message);
      /*
       * Une publication qui tombe se dit AUSSI FORT qu'une qui aboutit : sans
       * cela, on lance la mise en ligne, on ferme l'onglet, et on croit son
       * travail servi alors que rien n'est parti. Un arrêt demandé à la main,
       * lui, ne surprend personne : on ne réveille pas pour ça.
       */
      if (!stopped) {
        notify({
          motif: 'publication-echec',
          title: `Publication en échec (${etape.libelle})`,
          body: `${current.cardIds.length} tâche(s) restent à déployer — ${raison}`,
          reference: `${projectId}:echec:${current.id}`,
          element: `Publication en échec — ${raison}`,
          projectId,
        });
      }
    } finally {
      // La surveillance du temps meurt avec la publication, quelle qu'en soit
      // l'issue : réussie, tombée, arrêtée à la main. Un minuteur laissé
      // derrière écrirait dans une publication finie.
      arreterLesVeilles(current.id);
      /*
       * Le fil, lui, est DÉJÀ en base — c'est `emit` qui l'y recolle à chaque
       * pas. On ne garde donc plus sa copie de travail en mémoire : la
       * publication est finie, elle se relira depuis la base comme toutes les
       * anciennes.
       */
      oublierLeJournal(current.id);
      active.delete(projectId);
      const relance = waiting.has(projectId);
      if (relance) {
        // La publication en attente repart à SON étape, pas à celle de la
        // publication qui vient de se terminer.
        const suivant = waiting.get(projectId);
        waiting.delete(projectId);
        setTimeout(() => void startDeploy(projectId, { cible: suivant?.cible }), 1500);
      }
      // Un redémarrage différé attendait la fin des publications : maintenant que
      // celle-ci est finie, on rejoue la règle. On ne le fait que si plus aucune
      // publication ne tourne NI n'est en file (`relance`) — sinon on couperait
      // le lot suivant avant même son départ.
      if (!relance && active.size === 0) appliquerRedemarrageEnAttente();
    }
  })();

  return { ok: true, run };
}

/**
 * LE VERDICT FINAL : l'adresse publique répond-elle ?
 *
 * C'est le seul contrôle qui juge le RÉSULTAT et non le processus — sept étapes
 * vertes ne valent rien si l'adresse est muette. Il mérite donc, plus que tout
 * autre, qu'on essaie de le faire passer : une adresse qui ne répond pas appelle
 * un agent de dépannage, qui remonte la chaîne (service, port, serveur web),
 * répare, puis l'adresse est RECONTRÔLÉE. Le refus, lui, ne bouge pas : au bout
 * des reprises, la publication échoue et l'étape porte ce qui a été tenté.
 *
 * L'adresse muette est la seule panne qu'on n'a pas à reconnaître au message :
 * elle est toujours la même, quel que soit le motif rendu par le réseau.
 */
async function controlerLAdresse(
  run: DeployRun,
  projectId: string,
  url: string,
): Promise<{ run: DeployRun; ok: boolean; verdict: string }> {
  let verdict = '';
  const controle = await rejouerAvecDepannage(
    run,
    { projectId, etape: 'publish', panne: panneDAdresseMuette(url) },
    async () => {
      const online = await checkOnline(url);
      verdict = online.ok ? `Adresse ${url} joignable (${online.status}).` : `Adresse ${url} injoignable (${online.status}).`;
      return { ok: online.ok, sortie: verdict };
    },
  );
  let courant = setStep(
    controle.run,
    'publish',
    controle.ok ? 'done' : 'failed',
    `${verdict}${journalDesReprises(controle.reparations)}`,
  );
  courant = noterLesReprises(courant, 'publish', controle);
  return { run: courant, ok: controle.ok, verdict };
}

async function checkOnline(url: string): Promise<{ ok: boolean; status: string }> {
  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(15000) });
    return { ok: res.ok, status: String(res.status) };
  } catch (err: any) {
    return { ok: false, status: err?.message ?? 'injoignable' };
  }
}

/*
 * UN ARRÊT AGIT TOUJOURS — même quand la publication n'est plus portée par rien.
 *
 * `handle.stop()` ne lève qu'un DRAPEAU que la boucle de publication relit entre
 * deux étapes. Une étape pendue pour de bon (un agent de dépannage dont la
 * préparation n'a jamais rendu la main) ne le relit jamais : la boucle ne se
 * termine pas, son `finally` ne retire donc pas l'entrée de `active`, et ce
 * fantôme REFUSE ensuite toute publication du projet — « une publication est
 * déjà en cours » — sans que rien ne tourne ni ne le dise. Le bouton « Arrêter »
 * répondait alors « faux » en silence, et seul un redémarrage du démon
 * débloquait le projet. Constaté le 17/08/2026 sur HaikoDev : dix publications
 * dans la journée, toutes refusées après la première.
 *
 * Faute de boucle vivante à interrompre, on referme donc ce que l'on peut
 * ATTEINDRE : le drapeau est levé quand il y a encore quelqu'un pour le lire,
 * l'entrée `active` est retirée, la file d'attente du projet est vidée — sinon
 * elle rejouerait le blocage — et la publication est marquée arrêtée en base si
 * elle s'y croit encore en cours. On ne rend « faux » que sur une publication
 * introuvable : c'est le seul cas où il n'y a vraiment rien à arrêter.
 */
export function stopDeploy(runId: string): boolean {
  const run = store.getDeploy(runId);
  if (!run) return false;

  const handle = active.get(run.projectId);
  if (handle) handle.stop();

  // Une publication DÉJÀ terminée n'a rien à reprendre : on s'arrête là, sans
  // réécrire son issue ni toucher à ce qui tourne peut-être pour un autre run.
  if (run.state !== 'running') return Boolean(handle);

  /*
   * On libère sans chercher à deviner si la boucle respire encore : rien ne le
   * dit de façon sûre depuis ici, et un arrêt DEMANDÉ doit aboutir. Une boucle
   * vivante lira son drapeau à la vérification suivante et s'arrêtera d'
   * elle-même ; son `finally` refait les mêmes retraits, qui ne coûtent rien
   * une seconde fois, et réécrit sa propre issue par-dessus celle-ci.
   */
  active.delete(run.projectId);
  waiting.delete(run.projectId);
  emit({
    ...run,
    state: 'stopped',
    error: "Publication arrêtée : plus rien ne la portait — l'étape en cours ne rendait plus la main.",
    endedAt: Date.now(),
    steps: run.steps.map((etape) =>
      etape.state === 'running'
        ? { ...etape, state: 'failed' as const, progress: undefined }
        : etape,
    ),
  });
  log.warn(
    `publication ${runId} (projet ${run.projectId}) arrêtée alors que plus rien ne la portait : le verrou du projet est levé`,
  );
  return true;
}

export async function retryDeploy(runId: string): Promise<{ ok: boolean; error?: string }> {
  const run = store.getDeploy(runId);
  if (!run) return { ok: false, error: 'publication introuvable' };
  log.info(`relance de la publication du projet ${run.projectId}`);
  // Relancer, c'est refaire LA MÊME publication : même étape du parcours,
  // jamais la première par défaut.
  return startDeploy(run.projectId, { cible: run.cible });
}
