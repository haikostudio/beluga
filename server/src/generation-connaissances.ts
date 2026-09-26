import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CONFIG } from './config.js';
import { log } from './logger.js';
import { importerLesLots, type RapportDImport } from './connaissances.js';

/**
 * RÉGÉNÉRER UNE PORTÉE DEPUIS L'ÉCRAN MÉMOIRE : le script de génération tourne
 * dans un processus à part (il appelle un modèle, cela prend des minutes), puis
 * son lot passe par la porte d'écriture. Une seule génération par portée à la
 * fois ; le rapport se relit à l'écran.
 */

const enCours = new Map<string, { depuis: number; journal: string[] }>();

export function generationEnCours(portee: string): { depuis: number; journal: string[] } | null {
  return enCours.get(portee) ?? null;
}

export function lancerLaGeneration(portee: string, surFin?: (rapports: RapportDImport[] | null, erreur?: string) => void): boolean {
  if (enCours.has(portee)) return false;
  const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/generer-connaissances.mjs');
  const env: NodeJS.ProcessEnv = { ...process.env, BELUGA_DATA: CONFIG.dataDir };
  delete env.BELUGA_TOKEN;
  const suivi = { depuis: Date.now(), journal: [] as string[] };
  enCours.set(portee, suivi);
  const enfant = spawn(process.execPath, [script, '--portee', portee], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const noter = (d: Buffer) => {
    for (const ligne of String(d).split(/[\r\n]+/).filter(Boolean)) suivi.journal = [...suivi.journal, ligne].slice(-20);
  };
  enfant.stdout.on('data', noter);
  enfant.stderr.on('data', noter);
  enfant.on('close', (code) => {
    enCours.delete(portee);
    if (code !== 0) {
      const erreur = suivi.journal.slice(-3).join(' ') || `code ${code}`;
      log.warn(`base de connaissances : génération de ${portee} tombée — ${erreur}`);
      surFin?.(null, erreur);
      return;
    }
    try {
      surFin?.(importerLesLots({ portee, force: true }));
    } catch (err) {
      surFin?.(null, (err as Error).message);
    }
  });
  return true;
}
