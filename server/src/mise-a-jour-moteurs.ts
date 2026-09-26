/**
 * L'OUTIL DE CHAQUE MOTEUR (Claude, Codex, Cursor) SE TIENT À JOUR TOUT SEUL.
 *
 * Le 22.09.2026, le CLI Claude installé (2.1.278) refusait le modèle
 * « Opus 5.5 » sorti la veille, alors que l'API le proposait déjà : un
 * `claude update` a suffi. Sans passage automatique, ce trou se rouvre à
 * chaque nouvelle sortie de modèle. Ce module repasse `<outil> update` une
 * fois par jour pour chacun des trois outils, sans jamais toucher à celui
 * qu'un agent est en train d'utiliser (`agentsActifs`), et sans jamais
 * changer le modèle choisi par quiconque — seul l'OUTIL bouge.
 *
 * Une panne ici (réseau absent, commande introuvable) se journalise et
 * n'interrompt jamais le reste des tâches planifiées du serveur.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { EngineId } from '@beluga/shared';
import { moteurDoitEtreMisAJour, PERIODE_MISE_A_JOUR_MOTEURS_MS } from '@beluga/shared';
import { claudeAdapter } from './engines/claude.js';
import { codexAdapter } from './engines/codex.js';
import { cursorAdapter } from './engines/cursor.js';
import { getMeta, setMeta } from './db.js';
import { log } from './logger.js';
import { agentsActifs } from './runtime.js';
import * as store from './store.js';

const execFileAsync = promisify(execFile);

/** Le nécessaire pour mettre un outil à jour, sans dépendre de l'adaptateur réel — pour rester rejouable en essai. */
export interface MoteurAMettreAJour {
  id: EngineId;
  label: string;
  binary: string;
  detect: () => Promise<{ installed: boolean; version?: string; cliInstalle?: boolean }>;
}

function moteursConnus(): MoteurAMettreAJour[] {
  return [claudeAdapter, codexAdapter, cursorAdapter].map((adapter) => ({
    id: adapter.id,
    label: adapter.label,
    binary: adapter.binary,
    detect: () => adapter.detect(),
  }));
}

const CLE_PREFIXE = 'moteurs:derniere-tentative-maj:';

/** Les outils dont un agent se sert EN CE MOMENT : ceux-là ne sont pas touchés. */
function moteursOccupes(): Set<EngineId> {
  const occupes = new Set<EngineId>();
  for (const id of agentsActifs()) {
    const engine = store.getAgent(id)?.run?.engine;
    if (engine) occupes.add(engine as EngineId);
  }
  return occupes;
}

/** Une seule mise à jour : la commande `update` de l'outil, avec la version avant/après en journal. */
async function mettreAJourUnMoteur(moteur: MoteurAMettreAJour): Promise<void> {
  const avant = await moteur.detect().catch(() => ({ installed: false, version: undefined }));
  try {
    // Cinq minutes : un téléchargement peut prendre du temps, mais ne doit jamais bloquer indéfiniment.
    await execFileAsync(moteur.binary, ['update'], { timeout: 5 * 60_000 });
  } catch (err) {
    log.warn(`mise à jour des moteurs : ${moteur.label} — échec — ${(err as Error).message}`);
    return;
  }
  const apres = await moteur.detect().catch(() => ({ installed: false, version: undefined }));
  if (avant.version && apres.version && avant.version !== apres.version) {
    log.info(`mise à jour des moteurs : ${moteur.label} passé de ${avant.version} à ${apres.version}`);
  } else {
    log.info(`mise à jour des moteurs : ${moteur.label} vérifié (version ${apres.version ?? 'inconnue'})`);
  }
}

export interface BilanDeMiseAJourDesMoteurs {
  traites: EngineId[];
  sautes: EngineId[];
}

/**
 * Un passage : chaque outil dû (plus d'un jour depuis sa dernière TENTATIVE)
 * et pas occupé par un agent est mis à jour. Un outil occupé n'avance pas sa
 * date de tentative : il sera reproposé au prochain passage, sans attendre
 * un jour de plus.
 */
export async function passageDeMiseAJourDesMoteurs(
  maintenant = Date.now(),
  moteurs: readonly MoteurAMettreAJour[] = moteursConnus(),
): Promise<BilanDeMiseAJourDesMoteurs> {
  const occupes = moteursOccupes();
  const traites: EngineId[] = [];
  const sautes: EngineId[] = [];
  for (const moteur of moteurs) {
    const cle = `${CLE_PREFIXE}${moteur.id}`;
    const dernier = Number(getMeta(cle) ?? 0) || undefined;
    if (!moteurDoitEtreMisAJour(maintenant, dernier)) continue;
    if (occupes.has(moteur.id)) {
      sautes.push(moteur.id);
      continue;
    }
    setMeta(cle, String(maintenant));
    await mettreAJourUnMoteur(moteur);
    traites.push(moteur.id);
  }
  return { traites, sautes };
}

/** La veille, à la même cadence que les autres travaux de fond — la vraie mise à jour reste une fois par jour. */
const PERIODE_DE_VEILLE_MS = 10 * 60 * 1000;

export function planifierMiseAJourDesMoteurs(): NodeJS.Timeout {
  return setInterval(() => {
    passageDeMiseAJourDesMoteurs().catch((err) => {
      log.warn(`mise à jour des moteurs : passage sauté — ${(err as Error).message}`);
    });
  }, PERIODE_DE_VEILLE_MS);
}

export { PERIODE_MISE_A_JOUR_MOTEURS_MS };
