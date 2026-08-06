import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  Card,
  CiblePublication,
  ColumnKey,
  ContexteDePublication,
  DeployRun,
  DeployStepKey,
  EnvironnementPublication,
  MoyensDeMiseEnLigne,
  MoyensDePublication,
  PlanDeMiseEnLigne,
  Project,
  ECHECS_NOMMES_MAX,
  etapeDePublication,
  raisonEtapeInconnue,
  environnementVise,
  environnementsDuProjet,
  libelleRole,
  consigneDeDeploiement,
  consigneDeLAgentDePublication,
  mentionEtapeConfiee,
  phraseDEchecConfie,
  recitDeLAgent,
  consigneDeReparationConstruction,
  controlesTombes,
  detailDEchec,
  detailDEchecConstruction,
  phraseDEchecConstruction,
  enregistrementsAEnvoyer,
  envoiDemandeAccord,
  estMentionDEnvoi,
  estPlomberie,
  mentionDAttenteSurCarte,
  mentionDeRefusSurCarte,
  messageEchecPublication,
  miseEnLigneReelle,
  phraseDEchec,
  planDeMiseEnLigne,
  raisonDuRefus,
  texteDeLAttente,
  titreDeLAttente,
} from '@haikodev/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { CONFIG } from './config.js';
import { log } from './logger.js';
import { notify } from './notify.js';
import { archiveCard } from './archive.js';
import { createAgent, sendPrompt, runningAgentIds } from './runtime.js';
import { etatDemon, redemarrerDemon } from './demon.js';

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
 * Ce dont ce projet dispose pour être mis en ligne, constaté sur la machine.
 *
 * La CONSIGNE, la COMMANDE et le NOM viennent de l'environnement visé ; le
 * reste (service système, dossier servi, script de construction) est une
 * propriété du dossier et vaut donc pour tous les environnements.
 */
export function moyensDuProjet(
  cwd: string,
  environnement?: Pick<EnvironnementPublication, 'nom' | 'commande' | 'consigne'>,
  estHaikoDev = false,
): MoyensDeMiseEnLigne {
  return {
    consigne: consigneDeDeploiement(environnement),
    commande: environnement?.commande,
    estHaikoDev,
    scriptBuild: scriptExiste(cwd, 'build'),
    service: serviceDuProjet(cwd) ?? undefined,
    dossierServi: dossierCiteParServeurWeb(configurationsServeurWeb(), cwd),
    environnement: environnement?.nom,
  };
}

/**
 * Ce projet peut-il être mis en ligne, et comment ? Répondu SANS rien publier,
 * pour que la fenêtre de publication le dise avant le clic. Le jugement porte
 * sur l'environnement VISÉ : un projet peut très bien savoir installer son dev
 * client et pas sa production.
 */
export function moyenDeMiseEnLigne(projectId: string, environmentId?: string): PlanDeMiseEnLigne | null {
  const project = store.getProject(projectId);
  if (!project) return null;
  const env = environnementVise(project, environmentId);
  return planDeMiseEnLigne(moyensDuProjet(project.path, env, project.isSelf));
}

/** Les environnements d'un projet, tels que l'interface doit les montrer. */
export function environnementsDePublication(projectId: string): EnvironnementPublication[] {
  const project = store.getProject(projectId);
  return project ? environnementsDuProjet(project) : [];
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
 * Ce que le projet déclare de ses environnements, pour la règle des étapes.
 *
 * Aucun projet ne déclare encore d'environnement de dev : les réglages qui le
 * renseignent font l'objet d'une carte à part. Tant qu'ils n'existent pas, il
 * n'y a qu'une mise en ligne — celle d'aujourd'hui —, et le parcours des
 * cartes ne change pas d'un pouce. Le jour où le réglage arrive, c'est cette
 * seule fonction qui le lit.
 */
export function moyensDePublication(_project: Project): MoyensDePublication {
  return { environnementDev: false };
}

/**
 * Exactement les cartes que le run va embarquer — ni plus, ni moins.
 *
 * La colonne de départ dépend de l'ÉTAPE : une mise sur l'environnement de dev
 * prend le lot de « À déployer », une mise en production prend celles qui sont
 * déjà « En production » chez le client. Sans étape précisée, c'est « À
 * déployer » — le seul cas existant.
 */
export function deployableCards(projectId: string, source: ColumnKey = 'to_deploy'): Card[] {
  return (
    store
      .listCardsInColumn(projectId, source)
      .filter((card) => !card.excludedFromDeploy)
      /*
       * Une carte déjà mise en ligne ne repart pas dans le même lot. Le
       * garde-fou ne vaut QUE pour la première étape : une carte posée « En
       * production » porte forcément une date de mise en ligne — celle de
       * l'environnement de dev —, et c'est justement elle qu'on veut passer en
       * production. Sa présence dans la colonne prouve qu'elle n'a pas encore
       * franchi CETTE étape-là.
       */
      .filter((card) => source !== 'to_deploy' || !card.deployedAt)
      .sort((a, b) => a.createdAt - b.createdAt)
  );
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
export async function conflitsPrevus(projectId: string): Promise<ConflitPrevu[]> {
  const project = store.getProject(projectId);
  if (!project) return [];
  const cwd = project.path;
  if (!(await runCommand(cwd, 'git rev-parse --git-dir', 20000)).ok) return [];

  const mainBranch = await mainBranchOf(cwd);
  const prevus: ConflitPrevu[] = [];
  for (const card of deployableCards(projectId)) {
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
 * Un conflit se résout DANS la publication, pas dans une nouvelle tâche.
 *
 * Avant, une branche en conflit produisait une carte « Résoudre le conflit de
 * fusion : … » qu'il fallait valider, chiffrer, lancer, clôturer, puis relancer
 * la publication — tout le parcours refait pour un geste de plomberie. Le
 * publieur appelle maintenant un agent sur-le-champ, attend qu'il ait fini, et
 * retente la fusion. En cas d'échec, la carte est simplement écartée du lot et
 * reste dans « À déployer », comme avant.
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
  const agent = createAgent({
    projectId,
    role: 'deploy',
    title: `Conflit de fusion — ${card.title}`,
    cardId: card.id,
    run: card.run,
  });

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

  try {
    await sendPrompt(agent.id, prompt, { template: 'free', silent: true });
  } catch (err: any) {
    return { fusionnee: false, recit: `agent de résolution en échec (${err?.message ?? 'raison inconnue'})` };
  }

  /*
   * L'agent a pu laisser le dossier sur SA branche : on revient sur la
   * principale avant de retenter, sinon la fusion partirait à l'envers.
   */
  const retour = await runCommand(cwd, `git checkout ${mainBranch}`);
  if (!retour.ok) return { fusionnee: false, recit: 'retour sur la branche principale impossible' };

  const seconde = await runCommand(cwd, `git merge --no-edit ${branch}`);
  if (seconde.ok) return { fusionnee: true, recit: 'conflit résolu par l’agent, branche fusionnée' };

  await runCommand(cwd, 'git merge --abort');
  return { fusionnee: false, recit: 'conflit toujours présent après passage de l’agent' };
}

/* ------------------------------------------------------------------ */
/* Les contrôles, et leur réparation pendant la publication            */
/* ------------------------------------------------------------------ */

/** Combien de fois la publication rappelle un agent pour réparer ses contrôles. */
export const REPARATIONS_MAX = 2;

/**
 * Les contrôles du projet, sur du code À JOUR.
 *
 * `npm test` lit `server/dist` : sans recompiler d'abord, on jugerait le code
 * du dernier lancement du démon et non le lot qu'on vient de fusionner.
 */
async function controlerLeProjet(cwd: string): Promise<{ ok: boolean; etape: 'compilation' | 'controles'; out: string }> {
  const compile = await runCommand(cwd, 'npm run build:server', 10 * 60 * 1000, Infinity);
  if (!compile.ok) return { ok: false, etape: 'compilation', out: compile.out };
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
  const agent = createAgent({
    projectId,
    role: 'deploy',
    title: echec.etape === 'compilation' ? 'Publication — le code ne compile pas' : 'Publication — contrôles en échec',
  });

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

  try {
    await sendPrompt(agent.id, prompt, { template: 'free', silent: true });
  } catch (err: any) {
    return { tente: false, recit: `agent de réparation en échec (${err?.message ?? 'raison inconnue'})` };
  }
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
  const agent = createAgent({
    projectId,
    role: 'deploy',
    title: 'Publication — la construction échoue',
  });

  const prompt = consigneDeReparationConstruction(commande, sortie, passe, REPARATIONS_MAX);

  bus.toast('info', `Publication bloquée : l’agent de publication répare la construction (passe ${passe}).`);

  try {
    await sendPrompt(agent.id, prompt, { template: 'free', silent: true });
  } catch (err: any) {
    return { tente: false, recit: `agent de réparation en échec (${err?.message ?? 'raison inconnue'})` };
  }
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
/* La mise en ligne confiée à un agent qui suit la consigne réglée      */
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
 * CONFIER LA MISE EN LIGNE À UN AGENT.
 *
 * Le code est déjà fusionné, enregistré et envoyé : il ne reste qu'à le mettre
 * en ligne, et c'est la consigne réglée pour cet environnement qui dit comment.
 * L'agent la reçoit telle quelle, avec le lot et l'environnement visé.
 *
 * Rend le compte rendu à afficher, et `ok: false` quand le tour n'a pas abouti.
 * Aucune indulgence : un tour en échec est un échec NOMMÉ, et rien n'est
 * annoncé « publié ». Le contrôle de l'adresse publique, lui, tombe juste après
 * dans `startDeploy` — c'est lui qui a le dernier mot.
 */
async function confierLaMiseEnLigne(
  projectId: string,
  ctx: ContexteDePublication,
): Promise<{ ok: boolean; recit: string; raison?: string }> {
  const agent = createAgent({
    projectId,
    role: 'deploy',
    title: `Publication — ${ctx.environnement.nom}`,
  });

  bus.toast('info', `Publication de « ${ctx.projet} » : l’agent suit la consigne de « ${ctx.environnement.nom} ».`);

  try {
    await sendPrompt(agent.id, consigneDeLAgentDePublication(ctx), { template: 'free', silent: true });
  } catch (err: any) {
    const raison = err?.message ?? 'raison inconnue';
    return { ok: false, recit: phraseDEchecConfie(ctx.environnement.nom, raison), raison };
  }

  const rendu = derniereReponse(agent.id);
  const recit = recitDeLAgent(rendu.texte, ctx.environnement.nom);
  const fini = store.getAgent(agent.id);
  if (fini && fini.status !== 'done') {
    const raison = rendu.erreur?.trim() || `le tour de l’agent s’est terminé en « ${fini.status} »`;
    return { ok: false, recit: `${phraseDEchecConfie(ctx.environnement.nom, raison)}\n\n${recit}`, raison };
  }
  return { ok: true, recit };
}

/* ------------------------------------------------------------------ */
/* Une publication à la fois                                           */
/* ------------------------------------------------------------------ */

const active = new Map<string, { stop: () => void }>();
/** Les publications qui attendent leur tour, chacune AVEC son environnement. */
const waiting = new Map<string, string | undefined>();

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

function emit(run: DeployRun): DeployRun {
  const saved = store.saveDeploy(run);
  bus.emit({ type: 'deploy.upsert', run: saved });
  return saved;
}

function setStep(run: DeployRun, key: DeployStepKey, state: 'running' | 'done' | 'failed' | 'skipped', logText = ''): DeployRun {
  const steps = run.steps.map((step) =>
    step.key === key
      ? {
          ...step,
          state,
          log: (step.log + (logText ? `\n${logText}` : '')).slice(-4000),
          startedAt: step.startedAt ?? Date.now(),
          endedAt: state === 'running' ? undefined : Date.now(),
        }
      : step,
  );
  return emit({ ...run, steps, currentStep: state === 'running' ? key : run.currentStep });
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
): Promise<{ ok: boolean; out: string }> {
  const garder = (texte: string) => (signesGardes === Infinity ? texte : texte.slice(-signesGardes));
  try {
    const { stdout, stderr } = await execFileAsync('bash', ['-lc', command], {
      cwd,
      timeout,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true, out: garder(stdout + stderr) };
  } catch (err: any) {
    return { ok: false, out: garder((err?.stdout ?? '') + (err?.stderr ?? '') + (err?.message ?? '')) };
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
  const manquants = OUTILS_DE_CONSTRUCTION.filter((outil) => !fs.existsSync(path.join(cwd, 'node_modules', '.bin', outil)));
  if (!manquants.length) return '';
  const pose = await runCommand(
    cwd,
    'NODE_ENV=development npm install --include=dev --no-audit --no-fund',
    10 * 60 * 1000,
  );
  return pose.ok
    ? `Outils de construction absents (${manquants.join(', ')}) : installés avant de construire.\n\n`
    : `Outils de construction absents (${manquants.join(', ')}) et leur installation a échoué :\n${pose.out.slice(-800)}\n\n`;
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

async function systemctlRoot(cwd: string, args: string, timeout = 60000): Promise<{ ok: boolean; out: string }> {
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
async function redemarrerService(cwd: string, service: string): Promise<{ ok: boolean; recit: string }> {
  const relance = await systemctlRoot(cwd, `restart ${service}`, 3 * 60 * 1000);
  if (!relance.ok) {
    return { ok: false, recit: `Le service ${service} n’a pas pu être relancé : ${motifSystemctl(relance.out)}` };
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
    return { ok: false, recit: `Le service ${service} n’est pas reparti : ${lisible}.${await journalDuService(cwd, service)}` };
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
export async function commitsEnAttente(projectId: string): Promise<{ nombre: number; titres: string[] }> {
  const vide = { nombre: 0, titres: [] as string[] };
  const project = store.getProject(projectId);
  if (!project) return vide;
  const cwd = project.path;
  if (!(await runCommand(cwd, 'git rev-parse --git-dir', 20000)).ok) return vide;

  const dernier = store.lastSuccessfulDeploy(projectId);
  const depuis = dernier?.targetCommit?.trim();
  if (!depuis) return vide;
  if (!(await runCommand(cwd, `git rev-parse --verify --quiet ${depuis}`, 20000)).out.trim()) return vide;

  const principale = await mainBranchOf(cwd);
  const journal = await runCommand(cwd, `git log --format=%H%x1f%s ${depuis}..${principale}`, 30000);
  if (!journal.ok) return vide;

  /*
   * Un enregistrement qui a DÉJÀ sa carte n'est plus anonyme : il compte dans
   * le lot par sa fiche, pas comme « changement sans carte ». Sans ce tri, le
   * même travail était annoncé deux fois.
   */
  const couverts = new Set(store.shasCouverts(projectId));
  const titres: string[] = [];
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
    titres.push(titre.trim());
  }
  return { nombre: titres.length, titres: titres.slice(0, 6) };
}

/* ------------------------------------------------------------------ */
/* Prévenir avant tout envoi qui met la production à jour              */
/* ------------------------------------------------------------------ */

/**
 * Ce que l'envoi emporterait, constaté sur le dépôt : la branche visée, les
 * enregistrements qui partiraient, et si du travail non enregistré traîne.
 *
 * Deux sources d'enregistrements, réunies sans doublon : ce qui est déjà sur la
 * branche principale sans avoir été envoyé, et ce que les branches des cartes du
 * lot y ajouteraient.
 */
async function ceQuiPartirait(
  cwd: string,
  cards: Card[],
): Promise<{ branche: string; enregistrements: string[]; travauxEnCours: boolean }> {
  const branche = await mainBranchOf(cwd);
  const sorties: string[] = [];

  const dejaEnregistre = await runCommand(cwd, `git log --format=%s origin/${branche}..${branche}`, 30000);
  if (dejaEnregistre.ok) sorties.push(dejaEnregistre.out);

  for (const card of cards) {
    const branch = card.github?.branch;
    if (!branch) continue;
    const journal = await runCommand(cwd, `git log --format=%s ${branche}..${branch}`, 30000);
    if (journal.ok) sorties.push(journal.out);
  }

  const sale = await runCommand(cwd, 'git status --porcelain', 30000);
  return {
    branche,
    enregistrements: enregistrementsAEnvoyer(sorties),
    travauxEnCours: sale.out.trim().length > 0,
  };
}

/**
 * Écrit la même phrase sur chaque carte du lot. La décision, elle, reste posée
 * à UN SEUL endroit — le bloc de publication : un triangle par carte ferait
 * annoncer une décision et en montrer dix. Mais une carte qui ne part pas doit
 * dire pourquoi, sinon elle semble bloquée sans raison.
 */
function marquerLesCartes(cardIds: string[], mention: string | undefined): void {
  for (const cardId of cardIds) {
    const card = store.getCard(cardId);
    if (!card) continue;
    const marquee = store.saveCard({
      ...card,
      scheduling: { ...(card.scheduling ?? { asap: false, attempts: 0, restarts: 0 }), waitingReason: mention },
    });
    bus.emit({ type: 'card.upsert', card: marquee });
  }
}

/**
 * L'accord donné : la publication repart du DÉBUT, ce qui est possible parce
 * que l'attente est posée avant la moindre commande git — rien n'avait bougé.
 * L'accord refusé : le lot reste entier, et chaque carte le dit.
 */
export async function repondreEnvoi(runId: string, accord: boolean): Promise<{ ok: boolean; error?: string }> {
  const run = store.getDeploy(runId);
  if (!run) return { ok: false, error: 'publication introuvable' };
  if (run.state !== 'awaiting') return { ok: false, error: 'cette publication n’attend plus votre accord' };
  const project = store.getProject(run.projectId);
  if (!project) return { ok: false, error: 'projet introuvable' };
  const branche = run.attente?.branche ?? 'la branche principale';

  if (!accord) {
    const raison = raisonDuRefus(project.name, branche);
    emit({ ...run, state: 'stopped', attente: undefined, error: raison, endedAt: Date.now() });
    /*
     * Un refus n'est pas un échec : les cartes restent EXACTEMENT où elles
     * sont, et portent la raison en toutes lettres — sinon le lot semblerait
     * bloqué sans que rien ne dise pourquoi.
     */
    marquerLesCartes(run.cardIds, mentionDeRefusSurCarte(branche));
    bus.emit({ type: 'attention', ...store.signalAttention() });
    bus.toast('info', raison);
    return { ok: true };
  }

  /*
   * L'accord fait repartir LA MÊME publication (`reprendre`), pas une nouvelle :
   * sinon la ligne « en attente » resterait en base et le triangle ne
   * s'éteindrait jamais. Elle repart de la première étape — rien n'avait bougé.
   */
  // L'environnement du run repart AVEC lui : un accord donné sur le dev client
  // ne doit pas relancer la publication vers la production.
  const relance = await startDeploy(run.projectId, run.environmentId, { accordEnvoi: true, reprendre: run });
  bus.emit({ type: 'attention', ...store.signalAttention() });
  return relance.ok ? { ok: true } : { ok: false, error: relance.error };
}

export async function startDeploy(
  projectId: string,
  environmentId?: string,
  options: { cible?: CiblePublication; accordEnvoi?: boolean; reprendre?: DeployRun } = {},
): Promise<{ ok: boolean; error?: string; run?: DeployRun }> {
  const project = store.getProject(projectId);
  if (!project) return { ok: false, error: 'projet introuvable' };

  /*
   * Quelle ÉTAPE de mise en ligne ? Sans environnement de dev déclaré, il n'y
   * en a qu'une et le lot part de « À déployer » pour finir « Archivé », comme
   * toujours. Une étape réclamée qui n'existe pas est REFUSÉE en le disant :
   * on ne retombe pas en silence sur la production.
   */
  const etape = etapeDePublication(moyensDePublication(project), options.cible);
  if (!etape) return { ok: false, error: raisonEtapeInconnue(options.cible ?? 'production') };

  /*
   * L'environnement visé, décidé UNE fois pour tout le run : c'est lui qui
   * porte la commande de publication, l'adresse à contrôler et la branche à
   * installer. Sans choix explicite, c'est le premier de la liste — et pour un
   * projet réglé à l'ancienne, l'environnement « Interne » fabriqué à la
   * lecture, qui porte exactement ses anciennes valeurs.
   *
   * L'étape et l'environnement répondent à deux questions distinctes — à quel
   * moment du parcours on est, et vers quelle machine on pousse : les mêler
   * ici ferait dépendre le parcours des cartes d'un réglage d'adresse.
   */
  const environnement = environnementVise(project, environmentId);

  // Une deuxième demande n'ouvre pas un run parallèle : elle attend son tour.
  if (active.has(projectId)) {
    waiting.set(projectId, environmentId);
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
   * Publier, c'est METTRE EN LIGNE. Un projet qui n'a aucun moyen de l'être
   * fusionnait, poussait, puis s'annonçait « publié » : les cartes partaient
   * aux archives et rien n'avait bougé à l'écran. On refuse maintenant AVANT
   * de toucher au dépôt, en nommant ce qui manque.
   */
  const plan = planDeMiseEnLigne(moyensDuProjet(project.path, environnement, project.isSelf));
  if (!plan.possible) return { ok: false, error: plan.raison };

  let cards = deployableCards(projectId, etape.source);
  // Cartes dont la branche est en conflit : écartées du lot, jamais perdues.
  const ecartees = new Set<string>();

  /*
   * PRÉVENIR AVANT TOUT ENVOI QUI MET LA PRODUCTION À JOUR.
   *
   * Un projet peut avoir déclaré que sa branche principale déclenche un
   * déploiement chez le client : envoyer, c'est alors mettre en ligne. On
   * s'arrête ICI, avant la moindre commande git — la fusion elle-même pousse la
   * branche courante quand du travail y traîne, et un refus doit laisser le lot
   * entier, pas à moitié fusionné. La publication repartira de la première
   * étape au clic, puisque rien n'a bougé.
   */
  if (project.deployeSurEnvoi && !options.accordEnvoi) {
    const cwd = project.path;
    const estUnDepot = (await runCommand(cwd, 'git rev-parse --git-dir', 20000)).ok;
    const aUnDepotDistant = estUnDepot && (await runCommand(cwd, 'git remote', 20000)).out.trim().length > 0;
    if (envoiDemandeAccord({ deployeSurEnvoi: true, estUnDepot, aUnDepotDistant })) {
      const partirait = await ceQuiPartirait(cwd, cards);
      const texte = texteDeLAttente({
        projet: project.name,
        branche: partirait.branche,
        enregistrements: partirait.enregistrements,
        cartes: cards.length,
        adresse: environnement.url,
        travauxEnCours: partirait.travauxEnCours,
      });
      const attente = DeployRun.parse({
        id: store.newId(),
        projectId,
        state: 'awaiting',
        steps: STEP_ORDER.map((key) => ({ key, state: 'todo' as const, log: '' })),
        cardIds: cards.map((c) => c.id),
        // L'attente RETIENT son environnement : l'accord relancera la même
        // publication, vers le même endroit.
        environmentId: environnement.id,
        environmentName: environnement.nom,
        url: environnement.url,
        attente: {
          branche: partirait.branche,
          enregistrements: partirait.enregistrements,
          texte,
          demandeeA: Date.now(),
        },
        startedAt: Date.now(),
        queued: false,
      });
      emit(attente);
      // Chaque carte du lot dit pourquoi elle ne part pas ; la DÉCISION, elle,
      // reste à un seul endroit — le bloc de publication.
      marquerLesCartes(attente.cardIds, mentionDAttenteSurCarte(partirait.branche));
      // Le même triangle orange que toute décision attendue, et la même alerte.
      bus.emit({ type: 'attention', ...store.signalAttention() });
      notify({
        motif: 'decision-attendue',
        title: titreDeLAttente(project.name),
        body: texte.split('\n')[0].slice(0, 160),
        reference: `${projectId}:envoi:${attente.id}`,
        element: titreDeLAttente(project.name),
        projectId,
      });
      return { ok: true, run: attente };
    }
  }

  const run: DeployRun = DeployRun.parse({
    // L'accord donné fait repartir LA MÊME publication : on garde son
    // identifiant, sinon la ligne « en attente » resterait en base.
    id: options.reprendre?.id ?? store.newId(),
    projectId,
    state: 'running',
    steps: STEP_ORDER.map((key) => ({ key, state: 'todo' as const, log: '' })),
    cardIds: cards.map((c) => c.id),
    environmentId: environnement.id,
    environmentName: environnement.nom,
    url: environnement.url,
    startedAt: options.reprendre?.startedAt ?? Date.now(),
    queued: false,
  });
  emit(run);

  /*
   * Une carte marquée par un refus d'envoi précédent repart propre : garder la
   * mention ferait lire « refusé » sur une carte en train de partir en ligne.
   */
  for (const card of cards) {
    if (!estMentionDEnvoi(card.scheduling?.waitingReason)) continue;
    const propre = store.saveCard({
      ...card,
      scheduling: { ...(card.scheduling ?? { asap: false, attempts: 0, restarts: 0 }), waitingReason: undefined },
    });
    bus.emit({ type: 'card.upsert', card: propre });
  }

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

      // 1. Fusion des branches des cartes du lot
      current = setStep(current, 'merge', 'running');
      if (isGit && cards.length) {
        let mergeLog = '';

        /*
         * Le dossier de travail est PARTAGÉ : un agent peut avoir laissé des
         * modifications non enregistrées. Git refuse alors de changer de
         * branche et toute la publication s'arrêtait là (rencontré le
         * 03/08/2026). On enregistre donc ce travail SUR SA PROPRE BRANCHE
         * avant de bouger : publier commence par ne rien perdre.
         */
        const enCours = await runCommand(cwd, 'git status --porcelain');
        if (enCours.out.trim()) {
          const branche = (await runCommand(cwd, 'git rev-parse --abbrev-ref HEAD')).out.trim() || 'branche courante';
          await runCommand(cwd, 'git add -A');
          const enregistre = await runCommand(
            cwd,
            `git commit -m "Travaux en cours enregistrés avant publication" -m "Branche ${branche}"`,
          );
          mergeLog += `\n${branche} : travaux en cours enregistrés${enregistre.ok ? '' : ' (échec)'}`;
          // La branche doit exister à distance pour être fusionnée plus tard.
          await runCommand(cwd, `git push -u origin ${branche}`, 60000).catch(() => undefined);
        }

        /*
         * La branche INSTALLÉE par cet environnement. Vide — le cas de tous les
         * projets d'aujourd'hui — c'est la branche principale, exactement comme
         * avant. Un environnement qui nomme une branche absente ne se rabat pas
         * en silence sur la principale : il le dit, sinon on publierait autre
         * chose que ce qui est écrit dans les réglages.
         */
        const mainBranch = environnement.branche || (await mainBranchOf(cwd));
        if (environnement.branche) {
          const existe = await runCommand(cwd, `git rev-parse --verify --quiet ${mainBranch}`, 20000);
          if (!existe.ok || !existe.out.trim()) {
            throw new Error(
              `L’environnement « ${environnement.nom} » installe la branche ${mainBranch}, qui n’existe pas dans ce dépôt : rien n’est mis en ligne.`,
            );
          }
          mergeLog += `\nEnvironnement « ${environnement.nom} » : branche installée ${mainBranch}`;
        }
        const checkout = await runCommand(cwd, `git checkout ${mainBranch}`);
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
        for (const card of cards) {
          const branch = card.github?.branch;
          if (!branch) continue;

          // Une branche déjà nettoyée (carte ancienne, dépôt réinitialisé) ne
          // doit pas faire échouer tout le lot : on le dit et on continue.
          const exists = await runCommand(cwd, `git rev-parse --verify --quiet ${branch}`, 20000);
          if (!exists.ok || !exists.out.trim()) {
            mergeLog += `\n${branch} : branche absente, carte ignorée`;
            continue;
          }

          const result = await runCommand(cwd, `git merge --no-edit ${branch}`);
          if (result.ok) {
            fusionnees += 1;
            mergeLog += `\n${branch} : fusionnée`;
            continue;
          }

          const enConflit = (await runCommand(cwd, 'git diff --name-only --diff-filter=U')).out
            .trim()
            .split('\n')
            .filter(Boolean);
          await runCommand(cwd, 'git merge --abort');

          // Le conflit se règle ICI, pendant la publication : plus de carte à
          // valider, chiffrer et lancer pour un geste de plomberie.
          mergeLog += `\n${branch} : CONFLIT${enConflit.length ? ` (${enConflit.join(', ')})` : ''} — résolution en cours…`;
          current = setStep(current, 'merge', 'running', mergeLog.trim());

          const issue = await resoudreConflit(projectId, cwd, card, branch, mainBranch, enConflit);
          if (issue.fusionnee) {
            fusionnees += 1;
            mergeLog += `\n${branch} : ${issue.recit}`;
            continue;
          }
          ecartees.add(card.id);
          mergeLog += `\n${branch} : ${issue.recit} — carte écartée de cette publication`;
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
        current = setStep(current, 'merge', 'done', mergeLog.trim() || 'aucune branche à fusionner');
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
          const commit = await runCommand(
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
          const suivie = (
            await runCommand(cwd, 'git rev-parse --abbrev-ref --symbolic-full-name @{u}', 20000)
          ).out.trim();
          const locale = (await runCommand(cwd, 'git rev-parse --abbrev-ref HEAD', 20000)).out.trim();
          const commande = suivie.includes('/')
            ? `git push ${suivie.slice(0, suivie.indexOf('/'))} HEAD:${suivie.slice(suivie.indexOf('/') + 1)}`
            : `git push -u origin ${locale}`;
          const push = await runCommand(cwd, commande);
          current = setStep(current, 'push', push.ok ? 'done' : 'failed', push.out);
          if (!push.ok) throw new Error("L'envoi sur le dépôt a échoué.");
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

      // 4 à 7 : la mise en ligne, telle que le plan l'a décidée avant de partir
      const consigne = consigneDeDeploiement(environnement);
      const deployCommand = environnement.commande?.trim();
      if (consigne) {
        /*
         * UNE CONSIGNE EST RÉGLÉE : c'est un agent qui mène la mise en ligne.
         *
         * Les quatre étapes restent en place et parlent toutes — trois disent
         * que la consigne les couvre, la quatrième porte le compte rendu de
         * l'agent. La plomberie git au-dessus, elle, n'a pas bougé : c'est elle
         * qui garantit le lot, l'attente d'accord et la fermeture des branches.
         */
        current = setStep(current, 'verify', 'skipped', mentionEtapeConfiee('verify', environnement.nom));
        current = setStep(current, 'build', 'skipped', mentionEtapeConfiee('build', environnement.nom));

        current = setStep(current, 'publish', 'running', mentionEtapeConfiee('publish', environnement.nom));
        const menee = await confierLaMiseEnLigne(project.id, {
          projet: project.name,
          dossier: cwd,
          environnement: {
            nom: environnement.nom,
            role: libelleRole(environnement.role),
            url: environnement.url,
            branche: environnement.branche,
          },
          consigne,
          cartes: cards.map((card) => ({ titre: card.title, branche: card.github?.branch })),
          enregistrement: current.targetCommit,
          clot: etape.clot,
        });
        current = setStep(current, 'publish', menee.ok ? 'done' : 'failed', menee.recit);
        // Un échec reste un échec, NOMMÉ : rien n'est annoncé « publié ».
        if (!menee.ok) throw new Error(phraseDEchecConfie(environnement.nom, menee.raison));

        current = setStep(current, 'restart', 'skipped', mentionEtapeConfiee('restart', environnement.nom));
      } else if (deployCommand) {
        current = setStep(current, 'verify', 'running');
        const verify = await runCommand(cwd, 'npm run --if-present lint --silent || true', 5 * 60 * 1000);
        current = setStep(current, 'verify', 'done', verify.out.slice(-800));

        current = setStep(current, 'build', 'running');
        const result = await runCommand(cwd, deployCommand);
        current = setStep(
          current,
          'build',
          result.ok ? 'done' : 'failed',
          `Commande de publication du projet : \`${deployCommand}\`\n${result.out}`,
        );
        if (!result.ok) throw new Error(`La commande de publication a échoué : \`${deployCommand}\`.`);

        current = setStep(current, 'publish', 'done', `La commande \`${deployCommand}\` s’est exécutée jusqu’au bout : c’est elle qui installe la version en ligne.`);
        current = setStep(current, 'restart', 'skipped', 'Relance comprise dans la commande de publication du projet : rien à relancer ici.');
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
        let verify = await controlerLeProjet(cwd);
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
          verify = await controlerLeProjet(cwd);
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
        const pose = await poserLesOutilsDeConstruction(cwd);
        const build = await construireAvecReparation(project.id, cwd, 'npm run build', pose);
        current = setStep(current, 'build', build.ok ? 'done' : 'failed', build.detail);
        if (!build.ok) throw new Error(build.phrase);

        current = setStep(current, 'publish', 'running');
        const installe = installerApplication();
        current = setStep(current, 'publish', 'done', installe);

        /*
         * Le serveur garde le code chargé à son LANCEMENT : installer
         * l'interface ne suffit pas quand le code serveur a changé. Publier
         * redémarre donc tout seul — mais jamais sous les pieds d'un agent au
         * travail, tous projets confondus, car le démon les porte tous.
         */
        const etat = etatDemon();
        const autres = runningAgentIds().length;
        if (!etat.redemarrageNecessaire) {
          current = setStep(current, 'restart', 'skipped', 'Seule l’interface a changé : le serveur en place sert déjà le bon code.');
        } else if (autres > 0) {
          current = setStep(
            current,
            'restart',
            'skipped',
            `${autres} agent(s) travaillent encore : le redémarrage attend pour ne pas couper leur travail. Il se fait d’un clic sous la liste des projets.`,
          );
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
        } else {
          current = setStep(
            current,
            'publish',
            'done',
            `Le code est en place dans ${cwd} ; c’est le redémarrage du service qui va le mettre en ligne.`,
          );
        }

        if (plan.redemarrage !== 'service') {
          current = setStep(
            current,
            'restart',
            'skipped',
            'Aucun service système ne tourne sur ce dossier : le serveur web relit les fichiers à chaque demande, il n’y a rien à relancer.',
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
          const bilan = await redemarrerService(cwd, service);
          current = setStep(current, 'restart', bilan.ok ? 'done' : 'failed', bilan.recit);
          // Le motif exact remonte tel quel : plus de ligne rouge sans explication.
          if (!bilan.ok) throw new Error(bilan.recit.split('\n')[0]);
        }
      }

      // Le verdict se lit sur le RÉSULTAT, pas sur le processus (PLAN §11) :
      // on vérifie ce qui est réellement servi en ligne.
      if (environnement.url) {
        const online = await checkOnline(environnement.url);
        const verdict = online.ok
          ? `Adresse ${environnement.url} joignable (${online.status}).`
          : `Adresse ${environnement.url} injoignable (${online.status}).`;
        current = setStep(current, 'publish', online.ok ? 'done' : 'failed', verdict);
        // Une adresse muette n'est pas une publication réussie : autrefois
        // l'étape passait au rouge et le run se déclarait quand même « réussi ».
        if (!online.ok) throw new Error(verdict);
      }

      /*
       * Dernier garde-fou : sept étapes « ignorées » ne font pas une
       * publication. Si rien n'a réellement été construit, installé ni
       * relancé, le run échoue au lieu d'archiver des cartes qui ne sont pas
       * en ligne.
       */
      const etats = Object.fromEntries(current.steps.map((step) => [step.key, step.state])) as Record<
        DeployStepKey,
        'todo' | 'running' | 'done' | 'failed' | 'skipped'
      >;
      if (!miseEnLigneReelle({ build: etats.build, publish: etats.publish, restart: etats.restart })) {
        throw new Error(
          'Aucune mise en ligne n’a réellement eu lieu : ni construction, ni installation, ni redémarrage. Les cartes restent à déployer.',
        );
      }

      current = emit({ ...current, state: 'success', endedAt: Date.now(), currentStep: undefined });

      /*
       * Ce qui se passe quand une carte est vraiment en ligne (PLAN §11).
       *
       * Où elle se pose dépend de l'ÉTAPE. La DERNIÈRE clôt la carte :
       * document de clôture, branche refermée, « Archivé ». Une étape
       * intermédiaire — la mise sur l'environnement de dev — se contente de la
       * faire avancer dans « En production » : le travail est en ligne quelque
       * part, mais rien n'est encore fini, et la carte reste reprenable.
       */
      for (const cardId of current.cardIds) {
        const card = store.getCard(cardId);
        if (!card) continue;
        const deployed = store.saveCard({ ...card, deployedAt: Date.now() });
        bus.emit({ type: 'card.upsert', card: deployed });
        if (etape.clot) {
          // L'adresse retenue dans le document de clôture est celle de
          // l'environnement RÉELLEMENT visé, pas l'ancien champ du projet.
          await archiveCard(cardId, { url: environnement.url, commit: current.targetCommit });
        } else {
          const avancee = store.saveCard({
            ...deployed,
            column: etape.arrivee,
            position: store.nextPosition(card.projectId, etape.arrivee),
          });
          bus.emit({ type: 'card.upsert', card: avancee });
        }
      }

      const reste = ecartees.size
        ? ` — ${ecartees.size} carte(s) écartée(s) pour conflit, restées à déployer`
        : '';
      // Avec plusieurs environnements, « publication terminée » ne suffit plus :
      // on nomme LEQUEL vient de partir en ligne.
      const ou = ` (${environnement.nom})`;
      notify({
        motif: 'publication-terminee',
        title: `Publication terminée${ou}`,
        body: `${current.cardIds.length} tâche(s) en ligne${reste}`,
        /* Une publication = un lot posé sur un enregistrement précis, DANS un
           environnement précis : le même lot mis en dev puis en production fait
           bien deux alertes, sinon la seconde serait avalée comme un doublon. */
        reference: `${projectId}:${environnement.id}:${current.targetCommit ?? current.cardIds.join(',')}`,
        element: `${current.cardIds.length} tâche(s) en ligne${ou}`,
        projectId,
      });
      bus.toast(ecartees.size ? 'info' : 'success', `Publication terminée${ou}${reste}`);

      // Tout est enregistré : le serveur peut repartir avec le nouveau code.
      if (redemarrageDemande) setTimeout(() => redemarrerDemon(), 2000);
    } catch (err: any) {
      const raison = err?.message ?? String(err);
      current = emit({
        ...current,
        state: stopped ? 'stopped' : 'failed',
        error: raison,
        endedAt: Date.now(),
      });
      // On nomme le projet, l'étape tombée (celle marquée en échec, sinon celle
      // qui tournait) et où lire le détail — jamais l'exception brute toute nue.
      const etapeTombee = current.steps.find((s) => s.state === 'failed')?.key ?? current.currentStep;
      const message = messageEchecPublication({
        projet: project?.name,
        etape: etapeTombee ? STEP_LABELS[etapeTombee] : undefined,
        raison,
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
          title: `Publication en échec (${environnement.nom})`,
          body: `${current.cardIds.length} tâche(s) restent à déployer — ${raison}`,
          reference: `${projectId}:echec:${current.id}`,
          element: `Publication en échec — ${raison}`,
          projectId,
        });
      }
    } finally {
      active.delete(projectId);
      if (waiting.has(projectId)) {
        // La publication en attente repart sur SON environnement, pas sur celui
        // qui vient de se terminer.
        const suivant = waiting.get(projectId);
        waiting.delete(projectId);
        setTimeout(() => void startDeploy(projectId, suivant), 1500);
      }
    }
  })();

  return { ok: true, run };
}

async function checkOnline(url: string): Promise<{ ok: boolean; status: string }> {
  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(15000) });
    return { ok: res.ok, status: String(res.status) };
  } catch (err: any) {
    return { ok: false, status: err?.message ?? 'injoignable' };
  }
}

export function stopDeploy(runId: string): boolean {
  const run = store.getDeploy(runId);
  if (!run) return false;
  const handle = active.get(run.projectId);
  if (!handle) return false;
  handle.stop();
  return true;
}

export async function retryDeploy(runId: string): Promise<{ ok: boolean; error?: string }> {
  const run = store.getDeploy(runId);
  if (!run) return { ok: false, error: 'publication introuvable' };
  log.info(`relance de la publication du projet ${run.projectId}`);
  // Relancer, c'est refaire LA MÊME publication : même environnement visé.
  return startDeploy(run.projectId, run.environmentId);
}
