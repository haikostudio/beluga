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

/*
 * CE QUI RESTE DE LA VOIX DU SERVEUR (carte « En-tête collant et défilement des pages », 17/11/2026).
 *
 * La synthèse vocale de Beluga (Piper, Kokoro, Gemini : annonces, lecture d'un message, point du jour à voix haute,
 * `/api/speak`, `/api/voice-sample`) a été RETIRÉE à la demande de l'utilisateur, jugée trop mécanique : la seule
 * voix de Beluga est désormais la conversation en direct avec Codex (`voix-directe.ts`). Restent ici la DICTÉE
 * (parole → texte, `/api/transcribe`) et le POINT DU JOUR, écrit, qui arrive en notification. Les voix d'essai du
 * Studio ont leur propre chemin (`voix-de-realisation.ts`) et n'en dépendent pas.
 */
const VENV = path.join(CONFIG.dataDir, 'venv');
const PYTHON = path.join(VENV, 'bin', 'python');
const TRANSCRIBE_SCRIPT = path.join(CONFIG.selfPath, 'scripts', 'transcribe.py');
const VOIX_PIPER = path.join(CONFIG.dataDir, 'models', 'piper');

/** Piper est-il réellement posé ? L'interpréteur ET le paquet `piper` dans son environnement (`python -m piper`). */
function piperInstalle(): boolean {
  if (!fs.existsSync(PYTHON)) return false;
  try {
    const lib = path.join(VENV, 'lib');
    return fs.readdirSync(lib).some((version) => fs.existsSync(path.join(lib, version, 'site-packages', 'piper')));
  } catch {
    return false;
  }
}

/**
 * Ce qui est installé sur ce serveur : la dictée, et les voix d'essai du Studio (Piper et au moins un modèle de
 * voix, posés par la fonction facultative « voix » de l'installation).
 */
export function voiceAvailable(): { transcribe: boolean; voixDuStudio: boolean } {
  let modeles = false;
  try {
    modeles = fs.readdirSync(VOIX_PIPER).some((f) => f.endsWith('.onnx'));
  } catch {
    modeles = false;
  }
  return {
    transcribe: fs.existsSync(PYTHON) && fs.existsSync(TRANSCRIBE_SCRIPT),
    voixDuStudio: piperInstalle() && modeles,
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
          /*
           * « Planifié » est désormais la colonne où la carte NAÎT : on y trouve
           * aussi bien celles qui attendent leur feu vert que celles qui, déjà
           * chiffrées, attendent leur lancement. Une carte sans chiffrage et
           * sans chiffrage demandé est de la première sorte.
           */
          if (card.scheduling?.waitingReason) {
            etat.bloquees.push({ ...dite, detail: raisonParlee(card.scheduling.waitingReason) });
          } else if (!card.estimate && !card.analyseDemandee) {
            etat.aValider.push(dite);
          }
          break;
        case 'to_deploy':
          if (!card.deployedAt) etat.aPublier.push(dite);
          break;
        default:
          break;
      }
    }
  }

  const quotas = cachedQuotas().filter((q) => !q.suivi);
  if (quotas.length) {
    const worst = quotas
      .map((q) => ({ compte: q.label, pourcent: Math.max(q.session?.usedPct ?? 0, q.weekly?.usedPct ?? 0) }))
      .sort((a, b) => b.pourcent - a.pourcent)[0];
    etat.quota = worst;
  }

  return composerLePoint(etat);
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
 * préparé et arrive en notification, écrit — il ne se lit plus à voix haute.
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
      const { notify } = await import('./notify.js');
      // Le point du jour attend qu'on l'ouvre : il n'appelle aucune décision,
      // il se signale donc dans l'application seulement.
      notify({
        motif: 'point-du-jour',
        title: 'Le point du jour est prêt',
        // La notification s'arrête sur une phrase entière : un texte coupé au
        // milieu d'un mot donne l'impression que quelque chose s'est perdu.
        body: phrasesEntieres(text, 200),
      });
      log.info('point du jour préparé');
    },
    5 * 60 * 1000,
  );
}

export function purgeOldAudio(): void {
  try {
    const cutoff = Date.now() - 24 * 3600 * 1000;
    for (const entry of fs.readdirSync(PATHS.audio)) {
      const full = path.join(PATHS.audio, entry);
      const stat = fs.statSync(full);
      // L'ancien cache des sons de la voix retirée (`cache/`) part en entier, une fois.
      if (stat.isDirectory()) {
        if (entry === 'cache') fs.rmSync(full, { recursive: true, force: true });
        continue;
      }
      if (stat.mtimeMs < cutoff) fs.unlinkSync(full);
    }
  } catch {
    /* rien à purger */
  }
}
