import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EtatDuPoint, composerLePoint, raisonParlee } from './digest.js';
import * as store from './store.js';
import { CONFIG, PATHS } from './config.js';
import { cachedQuotas } from './accounts.js';
import { runningAgentIds } from './runtime.js';
import { log } from './logger.js';

const execFileAsync = promisify(execFile);

const VENV = path.join(CONFIG.dataDir, 'venv');
const PYTHON = path.join(VENV, 'bin', 'python');
const PIPER = path.join(VENV, 'bin', 'piper');
const VOICES = path.join(CONFIG.dataDir, 'models', 'piper');
const DEFAULT_VOICE = 'fr_FR-siwis-medium';
const PIPER_VOICE = path.join(VOICES, `${DEFAULT_VOICE}.onnx`);

/** Les voix réellement installées sur le serveur. */
export function listVoices(): string[] {
  try {
    return fs
      .readdirSync(VOICES)
      .filter((name) => name.endsWith('.onnx'))
      .map((name) => name.replace(/\.onnx$/, ''))
      .sort();
  } catch {
    return [];
  }
}

/**
 * La voix lue est celle choisie dans les préférences. Si le fichier de cette
 * voix n'est pas (ou plus) sur le serveur, on retombe sur la voix livrée
 * d'origine : mieux vaut une autre voix que pas de son du tout.
 */
function voiceFile(): string {
  let choisie = DEFAULT_VOICE;
  try {
    choisie = (store.getSettings().ttsVoice || DEFAULT_VOICE).replace(/[^\w.-]/g, '');
  } catch {
    /* réglages illisibles : la voix d'origine fera l'affaire */
  }
  const disponibles = listVoices();
  const retenue = disponibles.includes(choisie.replace(/\.onnx$/, ''))
    ? choisie.replace(/\.onnx$/, '')
    : disponibles.includes(DEFAULT_VOICE)
      ? DEFAULT_VOICE
      : disponibles[0];
  return retenue ? path.join(VOICES, `${retenue}.onnx`) : PIPER_VOICE;
}
const TRANSCRIBE_SCRIPT = path.join(CONFIG.selfPath, 'scripts', 'transcribe.py');

export function voiceAvailable(): { transcribe: boolean; speak: boolean } {
  return {
    transcribe: fs.existsSync(PYTHON) && fs.existsSync(TRANSCRIBE_SCRIPT),
    speak: fs.existsSync(PIPER) && listVoices().length > 0,
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

/**
 * Rassemble l'état du tableau, puis le confie au rédacteur pour l'oreille.
 * Ici on ne fait que LIRE et trier ; toute la mise en phrases est dans
 * `digest.ts`, ce qui permet de l'écouter et de la tester séparément.
 */
export function digestText(projectId?: string): string {
  const projects = (projectId ? [store.getProject(projectId)] : store.listProjects()).filter(
    (p): p is NonNullable<typeof p> => !!p,
  );
  const maintenant = Date.now();
  const depuisHier = maintenant - 24 * 3600 * 1000;
  const nomDuProjet = new Map(projects.map((p) => [p.id, p.name]));

  const etat: EtatDuPoint = {
    maintenant,
    projetUnique: projectId ? projects[0]?.name : undefined,
    questions: [],
    bloquees: [],
    aClore: [],
    propositions: [],
    aPublier: [],
    aValider: [],
    enCours: [],
    publiees: [],
  };

  for (const { projectId: pid, question } of store.pendingQuestions()) {
    if (!nomDuProjet.has(pid)) continue;
    etat.questions.push({ projet: nomDuProjet.get(pid)!, titre: question, detail: question });
  }

  for (const { projectId: pid, title } of store.pendingProposals(projectId)) {
    if (!nomDuProjet.has(pid)) continue;
    etat.propositions.push({ projet: nomDuProjet.get(pid)!, titre: title });
  }

  const enMarche = new Set(runningAgentIds());

  for (const project of projects) {
    const projet = project.name;
    for (const card of store.listCards(project.id)) {
      const dite = { projet, titre: card.title };
      if (card.deployedAt && card.deployedAt > depuisHier) {
        etat.publiees.push({ ...dite, quand: card.deployedAt });
      }
      switch (card.column) {
        case 'running': {
          // Une carte reste « en cours » même quand son agent a fini : la
          // clôture est un geste de l'utilisateur (PLAN §4). Trois situations
          // très différentes à l'oreille : ça travaille, c'est fini, c'est en
          // panne. L'état de l'agent tranche, pas la colonne.
          if (card.agentId && enMarche.has(card.agentId)) {
            etat.enCours.push(dite);
            break;
          }
          const agent = card.agentId ? store.getAgent(card.agentId) : store.getAgentByCard(card.id);
          if (agent?.status === 'done') {
            etat.aClore.push(dite);
          } else if (agent) {
            etat.bloquees.push({ ...dite, detail: raisonParlee(card.scheduling?.lastError) });
          } else {
            etat.enCours.push(dite);
          }
          break;
        }
        case 'planned':
          if (card.scheduling?.waitingReason) {
            etat.bloquees.push({ ...dite, detail: raisonParlee(card.scheduling.waitingReason) });
          }
          break;
        case 'to_deploy':
          if (!card.deployedAt) etat.aPublier.push(dite);
          break;
        case 'todo':
          etat.aValider.push(dite);
          break;
        default:
          break;
      }
    }
  }

  const quotas = cachedQuotas();
  if (quotas.length) {
    const worst = quotas
      .map((q) => ({ compte: q.label, pourcent: Math.max(q.session?.usedPct ?? 0, q.weekly?.usedPct ?? 0) }))
      .sort((a, b) => b.pourcent - a.pourcent)[0];
    etat.quota = worst;
  }

  return composerLePoint(etat);
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
        ['--model', voiceFile(), '--output_file', file],
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

/** Les premières phrases COMPLÈTES d'un texte, sans jamais couper un mot. */
function phrasesEntieres(texte: string, maximum: number): string {
  if (texte.length <= maximum) return texte;
  let sortie = '';
  for (const phrase of texte.split(/(?<=[.?!])\s+/)) {
    if (sortie && (sortie + ' ' + phrase).length > maximum) break;
    sortie = sortie ? `${sortie} ${phrase}` : phrase;
  }
  return sortie || texte.slice(0, maximum);
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
        // La notification s'arrête sur une phrase entière : un texte coupé au
        // milieu d'un mot donne l'impression que quelque chose s'est perdu.
        body: phrasesEntieres(text, 200),
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
