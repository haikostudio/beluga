import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { Card, DeployRun, DeployStepKey } from '@haikodev/shared';
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
  for (const fichier of fichiers) {
    try {
      const texte = fs.readFileSync(path.join(dossier, fichier), 'utf8');
      const ligne = texte.match(/^WorkingDirectory=(.+)$/m);
      if (ligne && path.resolve(ligne[1].trim()) === vise) return fichier;
    } catch {
      // Unité illisible : elle n'apprend rien de plus.
    }
  }
  return null;
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

/** Exactement les cartes que le run va embarquer — ni plus, ni moins. */
export function deployableCards(projectId: string): Card[] {
  return store
    .listCardsInColumn(projectId, 'to_deploy')
    .filter((card) => !card.excludedFromDeploy && !card.deployedAt)
    .sort((a, b) => a.createdAt - b.createdAt);
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
/* Une publication à la fois                                           */
/* ------------------------------------------------------------------ */

const active = new Map<string, { stop: () => void }>();
const waiting = new Set<string>();

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

async function runCommand(cwd: string, command: string, timeout = 15 * 60 * 1000): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('bash', ['-lc', command], {
      cwd,
      timeout,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true, out: (stdout + stderr).slice(-3000) };
  } catch (err: any) {
    return { ok: false, out: ((err?.stdout ?? '') + (err?.stderr ?? '') + (err?.message ?? '')).slice(-3000) };
  }
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
    titres.push(titre.trim());
  }
  return { nombre: titres.length, titres: titres.slice(0, 6) };
}

export async function startDeploy(projectId: string): Promise<{ ok: boolean; error?: string; run?: DeployRun }> {
  const project = store.getProject(projectId);
  if (!project) return { ok: false, error: 'projet introuvable' };

  // Une deuxième demande n'ouvre pas un run parallèle : elle attend son tour.
  if (active.has(projectId)) {
    waiting.add(projectId);
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

  let cards = deployableCards(projectId);
  // Cartes dont la branche est en conflit : écartées du lot, jamais perdues.
  const ecartees = new Set<string>();
  const run: DeployRun = DeployRun.parse({
    id: store.newId(),
    projectId,
    state: 'running',
    steps: STEP_ORDER.map((key) => ({ key, state: 'todo' as const, log: '' })),
    cardIds: cards.map((c) => c.id),
    url: project.deployUrl,
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

        const mainBranch = await mainBranchOf(cwd);
        const checkout = await runCommand(cwd, `git checkout ${mainBranch}`);
        if (!checkout.ok) {
          throw new Error(
            `Impossible de revenir sur la branche principale (${mainBranch}) : ${checkout.out.slice(-200)}`,
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
          const push = await runCommand(cwd, 'git push');
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

      // 4 à 7 : la commande de publication du projet
      const deployCommand = project.deployCommand?.trim();
      if (deployCommand) {
        current = setStep(current, 'verify', 'running');
        const verify = await runCommand(cwd, 'npm run --if-present lint --silent || true', 5 * 60 * 1000);
        current = setStep(current, 'verify', 'done', verify.out.slice(-800));

        current = setStep(current, 'build', 'running');
        const result = await runCommand(cwd, deployCommand);
        current = setStep(current, 'build', result.ok ? 'done' : 'failed', result.out);
        if (!result.ok) throw new Error('La construction a échoué.');

        current = setStep(current, 'publish', 'done', 'commande de publication exécutée');
        current = setStep(current, 'restart', 'skipped', 'géré par la commande du projet');
      } else if (project.isSelf) {
        /*
         * HaikoDev se publie lui-même. La fusion est déjà faite juste au-dessus :
         * on construit CE lot fusionné, puis on INSTALLE le résultat dans le
         * dossier servi. C'est le seul moment où ce que voit l'utilisateur
         * change — une branche non envoyée ne peut plus rien y faire.
         */
        current = setStep(current, 'verify', 'running');
        const verify = await runCommand(cwd, 'npm test', 10 * 60 * 1000);
        current = setStep(current, 'verify', verify.ok ? 'done' : 'failed', verify.out.slice(-800));
        if (!verify.ok) throw new Error('Les vérifications échouent : rien n\'est mis en ligne.');

        current = setStep(current, 'build', 'running');
        const build = await runCommand(cwd, 'npm run build', 10 * 60 * 1000);
        current = setStep(current, 'build', build.ok ? 'done' : 'failed', build.out.slice(-800));
        if (!build.ok) throw new Error('La construction a échoué.');

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
         * Un projet ordinaire : publier, c'est construire s'il y a de quoi,
         * puis REDÉMARRER le service qui le fait tourner. Auparavant tout était
         * « ignoré, aucune commande configurée » — la fusion partait sur le
         * dépôt et l'utilisateur ne voyait aucun changement.
         */
        current = setStep(current, 'verify', 'skipped', 'aucune vérification configurée pour ce projet');

        if (scriptExiste(cwd, 'build')) {
          current = setStep(current, 'build', 'running');
          const build = await runCommand(cwd, 'npm run build', 10 * 60 * 1000);
          current = setStep(current, 'build', build.ok ? 'done' : 'failed', build.out.slice(-800));
          if (!build.ok) throw new Error('La construction a échoué : rien n’est mis en ligne.');
        } else {
          current = setStep(current, 'build', 'skipped', 'ce projet n’a pas d’étape de construction');
        }

        current = setStep(current, 'publish', 'done', `Le code fusionné est en place dans ${cwd}.`);

        const service = serviceDuProjet(cwd);
        if (!service) {
          current = setStep(current, 'restart', 'skipped', 'aucun service système ne tourne sur ce dossier : rien à redémarrer');
        } else {
          current = setStep(current, 'restart', 'running');
          const restart = await runCommand(cwd, `systemctl restart ${service}`, 3 * 60 * 1000);
          // Le service repart en quelques secondes : on le laisse s'installer
          // avant de le déclarer vivant.
          await new Promise((resolve) => setTimeout(resolve, 5000));
          const actif = (await runCommand(cwd, `systemctl is-active ${service}`, 30000)).out.trim();
          const ok = restart.ok && actif === 'active';
          current = setStep(
            current,
            'restart',
            ok ? 'done' : 'failed',
            ok ? `${service} redémarré, il répond de nouveau.` : `${service} : ${actif || restart.out.slice(-300)}`,
          );
          if (!ok) throw new Error(`Le service ${service} n’est pas reparti.`);
        }
      }

      // Le verdict se lit sur le RÉSULTAT, pas sur le processus (PLAN §11) :
      // on vérifie ce qui est réellement servi en ligne.
      let verdict = 'Publication terminée.';
      if (project.deployUrl) {
        const online = await checkOnline(project.deployUrl);
        verdict = online.ok
          ? `Adresse ${project.deployUrl} joignable (${online.status}).`
          : `Adresse ${project.deployUrl} injoignable pour l'instant (${online.status}).`;
        current = setStep(current, 'publish', online.ok ? 'done' : 'failed', verdict);
      }

      current = emit({ ...current, state: 'success', endedAt: Date.now(), currentStep: undefined });

      // Ce qui se passe quand une carte est vraiment en ligne (PLAN §11).
      for (const cardId of current.cardIds) {
        const card = store.getCard(cardId);
        if (!card) continue;
        const deployed = store.saveCard({ ...card, deployedAt: Date.now() });
        bus.emit({ type: 'card.upsert', card: deployed });
        await archiveCard(cardId, { url: project.deployUrl, commit: current.targetCommit });
      }

      const reste = ecartees.size
        ? ` — ${ecartees.size} carte(s) écartée(s) pour conflit, restées à déployer`
        : '';
      notify({
        kind: 'deploy',
        title: 'Publication terminée',
        body: `${current.cardIds.length} tâche(s) en ligne${reste}`,
        projectId,
      });
      bus.toast(ecartees.size ? 'info' : 'success', `Publication terminée${reste}`);

      // Tout est enregistré : le serveur peut repartir avec le nouveau code.
      if (redemarrageDemande) setTimeout(() => redemarrerDemon(), 2000);
    } catch (err: any) {
      current = emit({
        ...current,
        state: stopped ? 'stopped' : 'failed',
        error: err?.message ?? String(err),
        endedAt: Date.now(),
      });
      bus.toast('error', `Publication interrompue : ${err?.message ?? err}`);
    } finally {
      active.delete(projectId);
      if (waiting.has(projectId)) {
        waiting.delete(projectId);
        setTimeout(() => void startDeploy(projectId), 1500);
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
  return startDeploy(run.projectId);
}
