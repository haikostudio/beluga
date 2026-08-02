import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Card, Estimate } from '@haikodev/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { createAgent, isRunning, sendPrompt, runningCount } from './runtime.js';
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

export async function checkGates(card: Card): Promise<Gate> {
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

async function prepareBranch(projectPath: string, card: Card): Promise<string | null> {
  const branch = branchName(card);
  try {
    await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: projectPath, timeout: 8000 });
  } catch {
    return null; // pas un dépôt git : l'agent travaille sur place
  }
  try {
    await execFileAsync('git', ['checkout', '-B', branch], { cwd: projectPath, timeout: 20000 });
    return branch;
  } catch (err: any) {
    // Le verdict se lit sur le RÉSULTAT, pas sur le processus : git peut rendre
    // un code non nul (avertissement, hook local) tout en ayant bien basculé.
    const actual = await currentBranch(projectPath);
    if (actual === branch) return branch;
    log.warn(
      `création de branche impossible (branche courante : ${actual ?? 'inconnue'})`,
      (err?.stderr ?? err?.message ?? '').toString().slice(0, 300),
    );
    return null;
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

  const branch = await prepareBranch(project.path, card);

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
    scheduling: {
      ...(card.scheduling ?? { asap: false, attempts: 0, restarts: 0 }),
      attempts: (card.scheduling?.attempts ?? 0) + 1,
      waitingReason: undefined,
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
    onComplete: async (_text, ok) => {
      const fresh = store.getCard(cardId);
      if (!fresh) return;
      if (ok) {
        // Jamais de passage automatique en « Terminé » : c'est le geste de
        // l'utilisateur (PLAN §4). On le prévient, la carte reste en cours.
        notify({
          kind: 'waiting',
          title: 'Tâche prête à clôturer',
          body: fresh.title,
          cardId: fresh.id,
          projectId: fresh.projectId,
        });
        bus.toast('success', `Agent terminé : ${fresh.title}`, fresh.id);
      } else {
        bus.toast('error', `Agent en échec : ${fresh.title}`, fresh.id);
      }
    },
  });

  return { ok: true };
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
