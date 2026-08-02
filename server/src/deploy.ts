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

const execFileAsync = promisify(execFile);

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

  const cards = deployableCards(projectId);
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
          mergeLog += `\n${branch} : ${result.ok ? 'fusionnée' : 'conflit'}`;
          if (!result.ok) {
            await runCommand(cwd, 'git merge --abort');
            throw new Error(`Conflit de fusion sur la branche ${branch}. Résolvez-le puis relancez.`);
          }
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

        current = setStep(
          current,
          'restart',
          'skipped',
          "L'interface est en ligne. Les changements côté serveur demandent un redémarrage du démon, qui reste votre geste.",
        );
      } else {
        for (const key of ['verify', 'build', 'publish', 'restart'] as DeployStepKey[]) {
          current = setStep(current, key, 'skipped', 'aucune commande de publication configurée');
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

      notify({
        kind: 'deploy',
        title: 'Publication terminée',
        body: `${current.cardIds.length} tâche(s) en ligne`,
        projectId,
      });
      bus.toast('success', 'Publication terminée');
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
