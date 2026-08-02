import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { COLUMN_LABELS } from '@haikodev/shared';
import * as store from './store.js';
import { CONFIG, PATHS } from './config.js';
import { cachedQuotas } from './accounts.js';
import { runningAgentIds } from './runtime.js';
import { log } from './logger.js';

const execFileAsync = promisify(execFile);

const VENV = path.join(CONFIG.dataDir, 'venv');
const PYTHON = path.join(VENV, 'bin', 'python');
const PIPER = path.join(VENV, 'bin', 'piper');
const PIPER_VOICE = path.join(CONFIG.dataDir, 'models', 'piper', 'fr_FR-siwis-medium.onnx');
const TRANSCRIBE_SCRIPT = path.join(CONFIG.selfPath, 'scripts', 'transcribe.py');

export function voiceAvailable(): { transcribe: boolean; speak: boolean } {
  return {
    transcribe: fs.existsSync(PYTHON) && fs.existsSync(TRANSCRIBE_SCRIPT),
    speak: fs.existsSync(PIPER) && fs.existsSync(PIPER_VOICE),
  };
}

/* ------------------------------------------------------------------ */
/* Dictée : les transcriptions passent UNE PAR UNE dans une file       */
/* ------------------------------------------------------------------ */

let queue: Promise<unknown> = Promise.resolve();

export function transcribe(audio: Buffer, extension = 'webm'): Promise<{ ok: boolean; text?: string; error?: string }> {
  const task = queue.then(() => runTranscription(audio, extension));
  queue = task.catch(() => undefined);
  return task;
}

async function runTranscription(
  audio: Buffer,
  extension: string,
): Promise<{ ok: boolean; text?: string; error?: string }> {
  const available = voiceAvailable();
  if (!available.transcribe) {
    return { ok: false, error: 'moteur de transcription absent du serveur' };
  }
  const file = path.join(PATHS.audio, `dictee-${crypto.randomBytes(6).toString('hex')}.${extension}`);
  fs.mkdirSync(PATHS.audio, { recursive: true });
  fs.writeFileSync(file, audio);
  try {
    const { stdout } = await execFileAsync(PYTHON, [TRANSCRIBE_SCRIPT, file], {
      timeout: 300000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, OMP_NUM_THREADS: '1' },
    });
    const text = stdout.trim();
    return { ok: true, text };
  } catch (err: any) {
    log.warn('transcription impossible', err?.message);
    return { ok: false, error: 'transcription impossible' };
  } finally {
    try {
      fs.unlinkSync(file);
    } catch {
      /* fichier déjà parti */
    }
  }
}

/* ------------------------------------------------------------------ */
/* Le résumé vocal du tableau (PLAN §22)                               */
/* ------------------------------------------------------------------ */

export function digestText(projectId?: string): string {
  const projects = projectId ? [store.getProject(projectId)].filter(Boolean) : store.listProjects();
  const parts: string[] = [];
  const heure = new Date().toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' });
  parts.push(`Point HaikoDev de ${heure}.`);

  let published = 0;
  let waiting = 0;
  let running = 0;
  const blocked: string[] = [];
  const since = Date.now() - 24 * 3600 * 1000;

  for (const project of projects) {
    if (!project) continue;
    const cards = store.listCards(project.id);
    published += cards.filter((c) => c.deployedAt && c.deployedAt > since).length;
    waiting += cards.filter((c) => c.column === 'todo' || c.column === 'done').length;
    running += cards.filter((c) => c.column === 'running').length;
    for (const card of cards.filter((c) => c.scheduling?.waitingReason && c.column === 'planned')) {
      blocked.push(`${card.title}, ${card.scheduling!.waitingReason}`);
    }
  }

  parts.push(
    published
      ? `${published} tâche${published > 1 ? 's' : ''} publiée${published > 1 ? 's' : ''} depuis hier.`
      : 'Aucune publication depuis hier.',
  );
  parts.push(
    waiting
      ? `${waiting} tâche${waiting > 1 ? 's attendent' : ' attend'} votre feu vert.`
      : 'Rien n\'attend votre validation.',
  );
  parts.push(running ? `${running} tâche${running > 1 ? 's tournent' : ' tourne'} en ce moment.` : 'Aucune tâche en cours.');

  if (blocked.length) {
    parts.push(`Bloqué : ${blocked.slice(0, 3).join(' ; ')}.`);
  }

  const quotas = cachedQuotas();
  if (quotas.length) {
    const worst = quotas
      .map((q) => ({ label: q.label, pct: Math.max(q.session?.usedPct ?? 0, q.weekly?.usedPct ?? 0) }))
      .sort((a, b) => b.pct - a.pct)[0];
    parts.push(`Quotas : ${worst.label} à ${Math.round(worst.pct)} pour cent.`);
  }

  parts.push(`${runningAgentIds().length} agent${runningAgentIds().length > 1 ? 's' : ''} en activité.`);
  return parts.join(' ');
}

/** Fabrique un fichier audio ordinaire, lisible partout. */
export async function speak(text: string): Promise<{ ok: boolean; file?: string; error?: string }> {
  const available = voiceAvailable();
  if (!available.speak) return { ok: false, error: 'voix absente du serveur' };

  const file = path.join(PATHS.audio, `point-${crypto.randomBytes(6).toString('hex')}.wav`);
  fs.mkdirSync(PATHS.audio, { recursive: true });
  try {
    await new Promise<void>((resolve, reject) => {
      const child = execFile(
        PIPER,
        ['--model', PIPER_VOICE, '--output_file', file],
        { timeout: 180000 },
        (err) => (err ? reject(err) : resolve()),
      );
      child.stdin?.write(text);
      child.stdin?.end();
    });
    return { ok: true, file };
  } catch (err: any) {
    log.warn('synthèse vocale impossible', err?.message);
    return { ok: false, error: 'synthèse vocale impossible' };
  }
}

/**
 * Le rendez-vous quotidien (PLAN §22) : à l'heure choisie, le point du jour est
 * préparé et arrive en notification ; un appui lance la lecture.
 */
export function scheduleDailyDigest(hourGetter: () => number | undefined): NodeJS.Timeout {
  let lastDay = -1;
  return setInterval(
    async () => {
      const hour = hourGetter();
      if (hour === undefined) return;
      const now = new Date();
      if (now.getHours() !== hour || now.getDate() === lastDay) return;
      lastDay = now.getDate();

      const text = digestText();
      // L'audio est fabriqué à l'avance : au clic, la lecture démarre tout de suite.
      const spoken = await speak(text);
      const { notify } = await import('./notify.js');
      notify({
        kind: 'waiting',
        title: 'Le point du jour est prêt',
        body: text.slice(0, 160),
      });
      log.info(`point du jour préparé${spoken.ok ? ' (avec audio)' : ''}`);
    },
    5 * 60 * 1000,
  );
}

export function purgeOldAudio(): void {
  try {
    const cutoff = Date.now() - 24 * 3600 * 1000;
    for (const entry of fs.readdirSync(PATHS.audio)) {
      const full = path.join(PATHS.audio, entry);
      if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
    }
  } catch {
    /* rien à purger */
  }
}
