import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CONFIG } from './config.js';
import { lancerCommandeBornee } from './commande-bornee.js';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

/**
 * LES OUTILS DE RENDU HYPERFRAMES, EN UN SEUL ENDROIT — partagés par le
 * directeur artistique (`composition.ts`) et par le montage du Studio
 * (`studio-rendu.ts`). Ce module n'importe ni l'un ni l'autre (pas de boucle).
 *
 * Commandes PERMISES : une liste fermée (`publish`, `cloud`, `lambda`,
 * `cloudrun`, `auth`, `feedback` envoient le contenu au-dehors) ; télémétrie
 * coupée et clé Gemini RETIRÉE de l'environnement.
 */

const COMMANDES_PERMISES = new Set(['lint', 'validate', 'snapshot', 'render']);

export function commandeHyperframesPermise(sousCommande: string): boolean {
  return COMMANDES_PERMISES.has(sousCommande);
}

function cheminDuPaquet(nom: string, fichier: string): string | null {
  try {
    return path.join(path.dirname(require.resolve(`${nom}/package.json`)), fichier);
  } catch {
    return null;
  }
}

/** Les outils du rendu : le moteur, GSAP, les polices embarquées et les bibliothèques locales. */
export function outilsDeRendu(): { hyperframes: string | null; gsap: string | null; polices: string; bibliotheques: string } {
  const hyperframes = cheminDuPaquet('hyperframes', 'bin/hyperframes.mjs');
  const gsap = cheminDuPaquet('gsap', 'dist/gsap.min.js');
  return {
    hyperframes: hyperframes && fs.existsSync(hyperframes) ? hyperframes : null,
    gsap: gsap && fs.existsSync(gsap) ? gsap : null,
    polices: path.join(CONFIG.selfPath, 'outils', 'polices-de-composition'),
    bibliotheques: path.join(CONFIG.selfPath, 'outils', 'bibliotheques-de-composition'),
  };
}

function q(chemin: string): string {
  return `'${chemin.replace(/'/g, `'\\''`)}'`;
}

/** Lance UNE commande HyperFrames de la liste permise ; toute autre est refusée avant de partir. */
export async function hyperframes(
  sousCommande: string,
  args: string[],
  options: { timeout: number; surLigne?: (l: string) => void; signal?: AbortSignal },
): Promise<{ ok: boolean; sortie: string; delaiDepasse?: boolean }> {
  if (!commandeHyperframesPermise(sousCommande)) throw new Error(`commande HyperFrames refusée : « ${sousCommande} »`);
  const { hyperframes: cli } = outilsDeRendu();
  if (!cli) throw new Error('HyperFrames n’est pas installé (dépendance « hyperframes » du serveur)');
  const commande = [
    'env -u GEMINI_API_KEY -u GOOGLE_API_KEY DO_NOT_TRACK=1 HYPERFRAMES_SKIP_SKILLS=1 HYPERFRAMES_NO_UPDATE_CHECK=1 NO_COLOR=1',
    q(process.execPath),
    q(cli),
    sousCommande,
    ...args.map(q),
  ].join(' ');
  const r = await lancerCommandeBornee(CONFIG.dataDir, commande, {
    timeout: options.timeout,
    signesGardes: 200_000,
    ...(options.surLigne ? { surLigne: options.surLigne } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  return { ok: r.ok, sortie: r.out, ...(r.delaiDepasse ? { delaiDepasse: true } : {}) };
}

/** Le premier objet JSON d'une sortie (les lignes d'avertissement le précèdent parfois). */
export function jsonDeLaSortie(sortie: string): any {
  const debut = sortie.indexOf('{\n');
  const i = debut >= 0 ? debut : sortie.indexOf('{');
  if (i < 0) return null;
  try {
    return JSON.parse(sortie.slice(i, sortie.lastIndexOf('}') + 1));
  } catch {
    return null;
  }
}

/** Ce que dit ffprobe d'un fichier : durée, flux image et son. */
export async function lireFichierVideo(fichier: string): Promise<{ duree: number; image: boolean; son: boolean; largeur?: number; hauteur?: number }> {
  const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', fichier], { timeout: 30_000 });
  const j = JSON.parse(stdout) as { streams?: { codec_type: string; width?: number; height?: number }[]; format?: { duration?: string } };
  const video = j.streams?.find((s) => s.codec_type === 'video');
  return {
    duree: Number(j.format?.duration ?? 0),
    image: !!video,
    son: !!j.streams?.some((s) => s.codec_type === 'audio'),
    ...(video?.width ? { largeur: video.width, hauteur: video.height } : {}),
  };
}
