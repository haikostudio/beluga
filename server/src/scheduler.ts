import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  Card,
  Estimate,
  MENTION_EN_PAUSE,
  RAISON_EN_PAUSE,
  effacerPause,
  marquerPause,
  promptDeReprise,
} from '@haikodev/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { createAgent, isRunning, sendPrompt, runningCount, stopAgent } from './runtime.js';
import { canStartAgent, snapshot } from './capacity.js';
import { refreshQuotas } from './accounts.js';
import { notify } from './notify.js';
import { log } from './logger.js';

const execFileAsync = promisify(execFile);

/* ------------------------------------------------------------------ */
/* Analyse profonde (PLAN §6 étape 3)                                  */
/* ------------------------------------------------------------------ */

const analysing = new Set<string>();

export async function analyseCard(cardId: string): Promise<void> {
  const card = store.getCard(cardId);
  if (!card || analysing.has(cardId)) return;
  analysing.add(cardId);

  const project = store.getProject(card.projectId);
  if (!project) {
    analysing.delete(cardId);
    return;
  }

  // Les écarts passés du projet affinent les chiffrages (PLAN §24).
  const feedback = pastGaps(card.projectId);

  const agent = createAgent({
    projectId: card.projectId,
    role: 'analysis',
    title: `Analyse — ${card.title}`,
    cardId: card.id,
    // L'analyse est un chiffrage, pas un développement : modèle rapide.
    run: { engine: card.run.engine, model: card.run.engine === 'claude' ? 'sonnet' : undefined, thinking: 'low' },
  });

  const prompt = `Analyse cette tâche AVANT exécution et chiffre-la.

TÂCHE : ${card.title}
${card.description || '(pas de description)'}

Lis ce qu'il faut dans le projet pour comprendre l'ampleur du travail, sans rien modifier.${
    feedback ? `\n\nÉCARTS CONSTATÉS SUR LES TÂCHES PRÉCÉDENTES DE CE PROJET (pour affiner) :\n${feedback}` : ''
  }`;

  try {
    await sendPrompt(agent.id, prompt, {
      template: 'pre_run',
      silent: true,
      onComplete: async (text, ok) => {
        analysing.delete(cardId);
        const fresh = store.getCard(cardId);
        if (!fresh) return;

        const estimate = ok ? parseEstimate(text) : null;
        if (!estimate) {
          // Une analyse qui ne produit pas de chiffres le DIT sur la carte, au
          // lieu d'être maquillée avec une estimation par défaut (PLAN §9).
          const updated = store.saveCard({
            ...fresh,
            estimate: {
              failed: true,
              failureReason: ok ? "L'analyse n'a pas rendu de chiffres exploitables." : "L'analyse a échoué.",
              summary: text.slice(0, 2000),
              producedAt: Date.now(),
            },
          });
          bus.emit({ type: 'card.upsert', card: updated });
          bus.toast('warning', `Analyse sans chiffres : ${fresh.title}`, fresh.id);
          return;
        }

        // Promotion automatique en « Planifié » dès l'analyse réussie.
        const updated = store.saveCard({
          ...fresh,
          estimate: { ...estimate, summary: estimate.summary ?? text.slice(0, 2000), producedAt: Date.now() },
          column: fresh.column === 'validated' ? 'planned' : fresh.column,
          position: store.nextPosition(fresh.projectId, 'planned'),
          scheduling: { ...(fresh.scheduling ?? { asap: false, attempts: 0, restarts: 0 }), waitingReason: undefined },
        });
        bus.emit({ type: 'card.upsert', card: updated });
        void tick();
      },
    });
  } catch (err) {
    analysing.delete(cardId);
    log.error("analyse impossible", err);
  }
}

/** Les chiffres se lisent UNE fois et se rangent (PLAN §30). */
export function parseEstimate(text: string): Estimate | null {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)].map((m) => m[1]);
  // Le dernier bloc fait foi : une correction en fin de réponse remplace la
  // première estimation. On ne cherche du json « nu » que s'il n'y a aucun bloc.
  const candidates = [...blocks];
  if (!candidates.length) {
    const inline = text.match(/\{[^{}]*"machineSeconds"[\s\S]*?\}/);
    if (inline) candidates.push(inline[0]);
  }

  for (const candidate of candidates.reverse()) {
    try {
      const raw = JSON.parse(candidate.trim());
      const machineSeconds = num(raw.machineSeconds);
      const seniorHours = num(raw.seniorHours);
      if (machineSeconds === undefined && seniorHours === undefined) continue;
      return Estimate.parse({
        machineSeconds,
        tokens: num(raw.tokens),
        quotaShare: num(raw.quotaShare),
        confidence: ['low', 'medium', 'high'].includes(raw.confidence) ? raw.confidence : 'medium',
        summary: typeof raw.summary === 'string' ? raw.summary : undefined,
        seniorHours,
        billingTitle: typeof raw.billingTitle === 'string' ? raw.billingTitle : undefined,
        billingDescription: typeof raw.billingDescription === 'string' ? raw.billingDescription : undefined,
        failed: false,
      });
    } catch {
      continue;
    }
  }
  return null;
}

function num(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

function pastGaps(projectId: string): string | null {
  const cards = store
    .listCards(projectId)
    .filter((c) => c.estimate?.machineSeconds && c.consumption?.machineSeconds)
    .slice(0, 5);
  if (!cards.length) return null;
  return cards
    .map(
      (c) =>
        `- « ${c.title} » : annoncé ${Math.round((c.estimate!.machineSeconds ?? 0) / 60)} min, réalisé ${Math.round(
          (c.consumption!.machineSeconds ?? 0) / 60,
        )} min`,
    )
    .join('\n');
}

/* ------------------------------------------------------------------ */
/* Les trois portes (PLAN §6 étape 5)                                  */
/* ------------------------------------------------------------------ */

function isOffPeak(): boolean {
  const settings = store.getSettings();
  const hour = new Date().getHours();
  const { offPeakStart: start, offPeakEnd: end } = settings;
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}

export interface Gate {
  ok: boolean;
  reason?: string;
}

/**
 * Les portes DURES : celles qu'aucun geste ne force, parce que les franchir
 * ferait échouer le tour pour de bon — plus de place sur la machine, plus un
 * seul compte disponible pour ce moteur. Elles valent pour TOUS les chemins de
 * lancement : l'ordonnanceur, le bouton « Lancer maintenant », le dépôt d'une
 * carte dans « En cours ».
 *
 * L'heure creuse, elle, n'est pas une porte dure : c'est une politique
 * d'économie, et l'utilisateur a le droit de passer devant.
 */
export async function portesDures(card: Card): Promise<Gate> {
  const capacity = canStartAgent();
  if (!capacity.ok) return { ok: false, reason: capacity.reason };

  const quotas = await refreshQuotas();
  const engineQuotas = quotas.filter((q) => q.engine === card.run.engine);
  if (engineQuotas.length && !engineQuotas.some((q) => q.available)) {
    const soonest = engineQuotas
      .map((q) => q.weekly?.resetsAt ?? q.session?.resetsAt)
      .filter((v): v is number => !!v)
      .sort((a, b) => a - b)[0];
    return {
      ok: false,
      reason: soonest
        ? `Quota épuisé — reprise à ${new Date(soonest).toLocaleString('fr-CH', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}`
        : 'Quota épuisé sur tous les comptes',
    };
  }

  return { ok: true };
}

/**
 * Toutes les portes de l'ORDONNANCEUR : les dures, plus l'heure creuse. C'est
 * la boucle automatique qui patiente ; un geste humain, lui, ne franchit que
 * les portes dures.
 */
export async function checkGates(card: Card): Promise<Gate> {
  const dures = await portesDures(card);
  if (!dures.ok) return dures;

  const settings = store.getSettings();
  const heavy = (card.estimate?.machineSeconds ?? 0) >= settings.heavyTaskSeconds;
  if (heavy && !card.scheduling?.asap && !isOffPeak()) {
    return {
      ok: false,
      reason: `Tâche lourde : elle attend les heures creuses (à partir de ${settings.offPeakStart} h). Bouton « Dès que possible » pour forcer.`,
    };
  }

  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Démarrage réel                                                      */
/* ------------------------------------------------------------------ */

export function branchName(card: Card): string {
  const slug = card.title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `tache/${slug || 'sans-titre'}-${card.id.slice(0, 6)}`;
}

/**
 * Le résultat de la préparation de branche, DIT en toutes lettres. « Pas de
 * branche » recouvrait deux situations qui n'ont rien à voir : un projet sans
 * dépôt git (l'agent travaille sur place, c'est normal) et un dépôt git où la
 * branche n'a pas pu être créée (là, lancer l'agent serait le lâcher sur la
 * branche de quelqu'un d'autre).
 */
type Branche =
  | { kind: 'sans-depot' }
  | { kind: 'prete'; nom: string }
  | { kind: 'echec'; raison: string };

async function prepareBranch(projectPath: string, card: Card): Promise<Branche> {
  const branch = branchName(card);
  try {
    await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: projectPath, timeout: 8000 });
  } catch {
    return { kind: 'sans-depot' }; // pas un dépôt git : l'agent travaille sur place
  }
  try {
    await execFileAsync('git', ['checkout', '-B', branch], { cwd: projectPath, timeout: 20000 });
    return { kind: 'prete', nom: branch };
  } catch (err: any) {
    // Le verdict se lit sur le RÉSULTAT, pas sur le processus : git peut rendre
    // un code non nul (avertissement, hook local) tout en ayant bien basculé.
    const actual = await currentBranch(projectPath);
    if (actual === branch) return { kind: 'prete', nom: branch };
    log.warn(
      `création de branche impossible (branche courante : ${actual ?? 'inconnue'})`,
      (err?.stderr ?? err?.message ?? '').toString().slice(0, 300),
    );
    return {
      kind: 'echec',
      raison: `Branche « ${branch} » impossible à créer (branche courante : ${actual ?? 'inconnue'}). Le dossier du projet est peut-être occupé par un autre agent.`,
    };
  }
}

async function currentBranch(projectPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: projectPath,
      timeout: 10000,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function startCard(cardId: string): Promise<{ ok: boolean; error?: string }> {
  const card = store.getCard(cardId);
  if (!card) return { ok: false, error: 'carte introuvable' };
  if (card.agentId && isRunning(card.agentId)) return { ok: true };

  const project = store.getProject(card.projectId);
  if (!project) return { ok: false, error: 'projet introuvable' };

  /*
   * Les portes dures d'abord, et pour TOUS les chemins de lancement. Sans
   * elles, un départ forcé sur une machine pleine ou un quota épuisé créait un
   * agent qui mourait aussitôt, en laissant la carte dans « En cours ».
   */
  const portes = await portesDures(card);
  if (!portes.ok) return { ok: false, error: portes.reason ?? 'lancement impossible' };

  const prepa = await prepareBranch(project.path, card);
  if (prepa.kind === 'echec') return { ok: false, error: prepa.raison };
  const branch = prepa.kind === 'prete' ? prepa.nom : null;

  const agent = createAgent({
    projectId: card.projectId,
    role: 'task',
    title: card.title,
    cardId: card.id,
    run: card.run,
  });

  const running = store.saveCard({
    ...card,
    column: 'running',
    position: store.nextPosition(card.projectId, 'running'),
    agentId: agent.id,
    github: branch ? { ...(card.github ?? { checks: [], commits: [], activity: [] }), branch } : card.github,
    // Un départ efface la pause : c'est le geste qu'elle attendait. La même
    // règle sert au bouton de reprise — une seule marque, un seul effacement.
    scheduling: {
      ...effacerPause(card.scheduling),
      attempts: (card.scheduling?.attempts ?? 0) + 1,
    },
  });
  bus.emit({ type: 'card.upsert', card: running });

  const prompt = `Réalise cette tâche.

TITRE : ${card.title}
${card.description || '(pas de description)'}
${branch ? `\nTu travailles sur la branche « ${branch} ».` : ''}

Va au bout : lis ce qu'il faut, modifie, teste, puis enregistre et sauvegarde (commit + push). Ne publie pas.`;

  await sendPrompt(agent.id, prompt, {
    silent: true,
    // Une carte lancée est une vraie tâche : elle mérite le compte rendu entier.
    ampleur: 'complete',
    onComplete: apresLeTour(cardId),
  });

  return { ok: true };
}

/**
 * Ce qu'on dit à la fin d'un tour de carte. Le MÊME pour un départ et pour une
 * reprise : une reprise n'est pas un autre travail, c'est le même qui continue.
 */
function apresLeTour(cardId: string) {
  return async (_text: string, ok: boolean): Promise<void> => {
    const fresh = store.getCard(cardId);
    if (!fresh) return;
    if (ok) {
      /*
       * Le passage en « Terminé » est déjà fait : la carte suit l'état de son
       * agent (`colonneEnFinDeTour`). On ne prévient que si elle y est
       * VRAIMENT arrivée : un tour qui répond sans rien modifier au dépôt
       * laisse la carte où elle est, il n'y a donc rien à annoncer.
       */
      if (fresh.column === 'done' || fresh.column === 'to_deploy') {
        notify({
          motif: 'tache-terminee',
          title: 'Tâche terminée',
          body: fresh.title,
          reference: fresh.id,
          element: fresh.title,
          cardId: fresh.id,
          projectId: fresh.projectId,
        });
      }
      bus.toast('success', `Agent terminé : ${fresh.title}`, fresh.id);
      return;
    }
    /*
     * Un tour mis en pause revient ici en « pas réussi » — forcément, il n'est
     * pas allé au bout. Ce n'est pas un échec pour autant : le dire serait
     * inquiéter pour rien, alors que le travail est gardé et attend un clic.
     */
    if (fresh.scheduling?.suspendu) {
      bus.toast('info', MENTION_EN_PAUSE, fresh.id);
      return;
    }
    bus.toast('error', `Agent en échec : ${fresh.title}`, fresh.id);
  };
}

/* ------------------------------------------------------------------ */
/* Mettre en pause, et reprendre où l'on s'est arrêté                   */
/* ------------------------------------------------------------------ */

/**
 * METTRE EN PAUSE le travail de CETTE carte. Trois gestes en un, et pas un de
 * plus : le tour en cours est arrêté, la file est vidée (rien ne doit repartir
 * derrière), la marque de suspension est posée — la MÊME que celle du
 * glissement vers « Planifié », celle que l'ordonnanceur regarde.
 *
 * La colonne ne bouge pas : la pause n'est pas un rangement, et déplacer la
 * carte reste un geste à part.
 */
export async function pauseCard(cardId: string): Promise<{ ok: boolean; error?: string }> {
  const card = store.getCard(cardId);
  if (!card) return { ok: false, error: 'carte introuvable' };

  if (card.agentId) {
    stopAgent(card.agentId, 'pause');
    store.clearQueue(card.agentId);
    bus.emit({ type: 'queue.snapshot', agentId: card.agentId, queue: [] });
  }

  const enPause = store.saveCard({ ...card, scheduling: marquerPause(card.scheduling) });
  bus.emit({ type: 'card.upsert', card: enPause });
  bus.toast('info', RAISON_EN_PAUSE, enPause.id);
  return { ok: true };
}

/**
 * REPRENDRE là où le travail s'est arrêté. C'est le même agent qui repart, donc
 * la même session de moteur : son fil et sa liste de tâches sont déjà là, et on
 * lui demande de continuer, jamais de recommencer.
 *
 * Sans agent d'exécution (carte jamais partie), il n'y a rien à reprendre : on
 * retombe sur le départ ordinaire, le seul point d'entrée du lancement.
 */
export async function resumeCard(cardId: string): Promise<{ ok: boolean; error?: string }> {
  const prepa = await preparerReprise(cardId);
  if (!prepa.ok) return { ok: false, error: prepa.error };
  // Rien à reprendre : c'est un premier départ, et il n'a qu'un chemin.
  if (!prepa.agentId || !prepa.prompt) return startCard(cardId);

  // La colonne, elle, revient à « En cours » par le chemin habituel
  // (`colonneAuDemarrage`, appliqué à tout tour d'exécution qui démarre).
  await sendPrompt(prepa.agentId, prepa.prompt, {
    silent: true,
    ampleur: 'complete',
    onComplete: apresLeTour(cardId),
  });

  return { ok: true };
}

/**
 * Tout ce que la reprise décide AVANT de parler au moteur : quel agent repart,
 * sur quelle branche, avec quelle demande, et la marque de pause effacée. C'est
 * séparé pour être rejouable dans un test — sans allumer un vrai moteur.
 */
export interface PrepaReprise {
  ok: boolean;
  error?: string;
  /** L'agent qui repart. Absent : il n'y a rien à reprendre, c'est un départ. */
  agentId?: string;
  /** La branche retrouvée, ou `null` si le projet n'est pas un dépôt git. */
  branche?: string | null;
  prompt?: string;
}

export async function preparerReprise(cardId: string): Promise<PrepaReprise> {
  const card = store.getCard(cardId);
  if (!card) return { ok: false, error: 'carte introuvable' };
  // Déjà reparti : le geste a été fait deux fois, il n'y a rien de plus à faire.
  if (card.agentId && isRunning(card.agentId)) return { ok: true };

  const agent = card.agentId ? store.getAgent(card.agentId) : null;
  if (!agent || agent.role !== 'task') return { ok: true };

  const project = store.getProject(card.projectId);
  if (!project) return { ok: false, error: 'projet introuvable' };

  // Une reprise est un lancement : les portes dures valent pour elle aussi.
  const portes = await portesDures(card);
  if (!portes.ok) return { ok: false, error: portes.reason ?? 'reprise impossible' };

  const branche = await retrouverBranche(project.path, card);
  if (branche.kind === 'echec') return { ok: false, error: branche.raison };
  const nom = branche.kind === 'prete' ? branche.nom : null;

  // Le geste humain, et lui seul, efface la marque de pause.
  const reprise = store.saveCard({ ...card, scheduling: effacerPause(card.scheduling) });
  bus.emit({ type: 'card.upsert', card: reprise });

  return {
    ok: true,
    agentId: agent.id,
    branche: nom,
    prompt: promptDeReprise({ titre: card.title, branche: nom }),
  };
}

/**
 * Retrouver la branche d'une carte qu'on reprend. JAMAIS `checkout -B` ici :
 * la branche existe déjà et porte le travail enregistré avant la pause — la
 * recréer sur le sommet du moment l'effacerait. Si elle n'existe pas encore,
 * c'est que rien n'a été enregistré : le chemin de départ ordinaire la crée.
 */
async function retrouverBranche(projectPath: string, card: Card): Promise<Branche> {
  const branch = card.github?.branch ?? branchName(card);
  try {
    await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: projectPath, timeout: 8000 });
  } catch {
    return { kind: 'sans-depot' };
  }
  try {
    await execFileAsync('git', ['rev-parse', '--verify', branch], { cwd: projectPath, timeout: 8000 });
  } catch {
    return prepareBranch(projectPath, card);
  }
  if ((await currentBranch(projectPath)) === branch) return { kind: 'prete', nom: branch };
  try {
    await execFileAsync('git', ['checkout', branch], { cwd: projectPath, timeout: 20000 });
  } catch {
    /* le verdict se lit sur le résultat, pas sur le code de sortie */
  }
  const actuelle = await currentBranch(projectPath);
  if (actuelle === branch) return { kind: 'prete', nom: branch };
  return {
    kind: 'echec',
    raison: `Branche « ${branch} » impossible à retrouver (branche courante : ${actuelle ?? 'inconnue'}). Le dossier du projet est peut-être occupé par un autre agent.`,
  };
}

/* ------------------------------------------------------------------ */
/* La boucle                                                           */
/* ------------------------------------------------------------------ */

let ticking = false;

export async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    for (const project of store.listProjects()) {
      // Analyse : les cartes fraîchement validées.
      for (const card of store.listCardsInColumn(project.id, 'validated')) {
        if (!card.estimate && !analysing.has(card.id)) {
          void analyseCard(card.id);
        }
      }

      // Démarrage : les cartes planifiées, dans l'ordre d'ancienneté.
      const planned = store
        .listCardsInColumn(project.id, 'planned')
        .sort((a, b) => (b.scheduling?.asap ? 1 : 0) - (a.scheduling?.asap ? 1 : 0) || a.createdAt - b.createdAt);

      for (const card of planned) {
        if (card.agentId && isRunning(card.agentId)) continue;
        // Suspendue à la main : elle reste en file, mais elle attend un geste.
        if (card.scheduling?.suspendu) continue;
        const gate = await checkGates(card);
        if (!gate.ok) {
          if (card.scheduling?.waitingReason !== gate.reason) {
            const updated = store.saveCard({
              ...card,
              scheduling: { ...(card.scheduling ?? { asap: false, attempts: 0, restarts: 0 }), waitingReason: gate.reason },
            });
            bus.emit({ type: 'card.upsert', card: updated });
          }
          continue;
        }
        await startCard(card.id);
        // Les démarrages sont ÉCHELONNÉS : jamais quinze dans la même seconde.
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  } catch (err) {
    log.error('boucle d\'ordonnancement', err);
  } finally {
    ticking = false;
  }
}

export function startScheduler(): NodeJS.Timeout {
  log.info(`ordonnanceur démarré (plafond ${store.getSettings().maxAgents} agents, ${runningCount()} en cours)`);
  return setInterval(() => {
    void tick();
  }, 15000);
}
