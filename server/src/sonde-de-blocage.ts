/**
 * LA SONDE DE BLOCAGE : savoir QUAND le démon se fige, et SUR QUOI.
 *
 * Le 12/10/2026, l'écran affichait « le serveur ne répond pas » toute la
 * journée, et le serveur se figeait réellement (jusqu'à 17 s mesurées). Une
 * part venait de l'entraînement de nuit ; le reste n'avait AUCUNE trace : le
 * journal ne dit rien d'un fil principal qui ne respire plus.
 *
 * Deux gestes, qui ne coûtent presque rien :
 *  - le fil principal bat toutes les 200 ms, et note au retour toute pause
 *    qui dépasse `SEUIL_DU_JOURNAL_MS` (durée, mémoire, charge de la machine) ;
 *  - un fil gardien (`sonde-de-blocage-travailleur.ts`) relève la PILE D'APPELS
 *    du fil figé au-delà de `SEUIL_DU_RELEVE_MS`, dans `data/logs/blocages.log`.
 *
 * Coupée par `BELUGA_SONDE_BLOCAGE=0`. Ne rend jamais d'erreur : une sonde ne
 * fait pas tomber ce qu'elle surveille.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import { PATHS } from './config.js';
import { log } from './logger.js';

export const BATTEMENT_MS = 200;
/** Au-delà, le retour d'une pause se dit dans le journal du démon. */
export const SEUIL_DU_JOURNAL_MS = 1_000;
/** Au-delà, le gardien relève la pile d'appels du fil figé. */
export const SEUIL_DU_RELEVE_MS = 1_500;

/** Ce que le fil principal dit d'une pause, à son retour. Règle pure. */
export function phraseDeBlocage(pauseMs: number, contexte: { rssMo: number; charge: number; coeurs: number }): string {
  return (
    `le démon s'est figé ${(pauseMs / 1000).toFixed(1)} s ` +
    `(mémoire ${contexte.rssMo} Mo, charge machine ${contexte.charge.toFixed(1)} sur ${contexte.coeurs} cœurs) — ` +
    'la pile d’appels, si elle a pu être relevée, est dans data/logs/blocages.log'
  );
}

export function demarrerLaSondeDeBlocage(options: { fichier?: string; seuilDuReleveMs?: number } = {}): () => void {
  if (process.env.BELUGA_SONDE_BLOCAGE === '0') return () => {};
  const fichier = options.fichier ?? path.join(PATHS.logs, 'blocages.log');
  const battement = new SharedArrayBuffer(8);
  const pouls = new Float64Array(battement);
  pouls[0] = Date.now();

  let worker: Worker | null = null;
  try {
    fs.mkdirSync(path.dirname(fichier), { recursive: true });
    worker = new Worker(fileURLToPath(new URL('./sonde-de-blocage-travailleur.js', import.meta.url)), {
      workerData: { battement, fichier, seuilMs: options.seuilDuReleveMs ?? SEUIL_DU_RELEVE_MS },
    });
    worker.on('error', (err) => log.warn(`sonde de blocage : gardien arrêté (${err.message})`));
    worker.unref();
  } catch (err) {
    log.warn(`sonde de blocage : gardien non lancé (${(err as Error).message})`);
  }

  let dernier = Date.now();
  const minuteur = setInterval(() => {
    const maintenant = Date.now();
    const pause = maintenant - dernier - BATTEMENT_MS;
    dernier = maintenant;
    pouls[0] = maintenant;
    if (pause >= SEUIL_DU_JOURNAL_MS) {
      try {
        log.warn(
          phraseDeBlocage(pause, {
            rssMo: Math.round(process.memoryUsage.rss() / 1024 / 1024),
            charge: os.loadavg()[0] ?? 0,
            coeurs: os.cpus().length,
          }),
        );
      } catch {
        /* la sonde ne dit rien plutôt que de gêner */
      }
    }
  }, BATTEMENT_MS);
  minuteur.unref();

  return () => {
    clearInterval(minuteur);
    void worker?.terminate();
  };
}
