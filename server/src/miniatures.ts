import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from './config.js';

/**
 * LES VIGNETTES NE TÉLÉCHARGENT PAS L'ORIGINAL.
 *
 * Une vignette de 80 pixels qui chargeait une capture de 1 200 × 2 600 pixels
 * faisait décoder une image entière par le téléphone : sur un fil à centaines
 * d'images, un défilement rapide saturait la mémoire de la page, que le
 * navigateur tuait net (« un problème récurrent est survenu »). Une miniature
 * se fabrique une fois (ffmpeg), se garde sur disque, et se sert à la place.
 *
 * Toute panne rend `null` : l'appelant sert alors l'original, comme avant.
 *
 * UN PDF A AUSSI SA VIGNETTE : l'image de sa PREMIÈRE PAGE, rendue par
 * `pdftoppm` (poppler) en PNG, sous le même plafond de temps et dans le même
 * cache. La miniature change alors de type (PDF → PNG) : elle se sert toujours,
 * quel que soit son poids face à l'original.
 */

const FORMATS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'png',
};
/** Le type de la miniature quand il diffère de l'original. */
const TYPE_DE_LA_MINIATURE: Record<string, string> = { 'application/pdf': 'image/png' };
/** Largeurs demandées, bornées : une adresse ne fabrique pas n'importe quelle taille. */
export const LARGEUR_MIN = 64;
export const LARGEUR_MAX = 1024;
const DELAI_MS = 15_000;
const EN_PARALLELE = 2;

export function largeurDemandee(valeur: string | null): number | null {
  if (!valeur || !/^\d{2,4}$/.test(valeur)) return null;
  const n = Number(valeur);
  if (n < LARGEUR_MIN || n > LARGEUR_MAX) return null;
  /* Par paliers de 80 : peu de variantes en cache, jamais plus petit que demandé. */
  return Math.ceil(n / 80) * 80;
}

const enCours = new Map<string, Promise<string | null>>();
let actifs = 0;
const attente: Array<() => void> = [];

async function placeLibre(): Promise<void> {
  if (actifs < EN_PARALLELE) {
    actifs += 1;
    return;
  }
  await new Promise<void>((suite) => attente.push(suite));
  actifs += 1;
}

function rendreLaPlace(): void {
  actifs -= 1;
  attente.shift()?.();
}

/** La première page d'un PDF, en PNG de `largeur` pixels de large. */
function premierePageDuPdf(source: string, cible: string, largeur: number): Promise<boolean> {
  /* `-singlefile` écrit `<préfixe>.png` : le préfixe est la cible sans son extension. */
  const prefixe = cible.replace(/\.png$/, '');
  const args = ['-png', '-f', '1', '-l', '1', '-singlefile', '-scale-to-x', String(largeur), '-scale-to-y', '-1', source, prefixe];
  return new Promise((resolve) => {
    execFile('pdftoppm', args, { timeout: DELAI_MS }, (erreur) => resolve(!erreur && fs.existsSync(cible)));
  });
}

function fabriquer(source: string, cible: string, largeur: number, extension: string, mime: string): Promise<boolean> {
  if (mime === 'application/pdf') return premierePageDuPdf(source, cible, largeur);
  const args = ['-v', 'error', '-y', '-i', source, '-frames:v', '1', '-vf', `scale='min(${largeur},iw)':-2`];
  if (extension === 'jpg') args.push('-q:v', '4');
  args.push(cible);
  return new Promise((resolve) => {
    execFile('ffmpeg', args, { timeout: DELAI_MS }, (erreur) => resolve(!erreur));
  });
}

/**
 * La miniature de cette image, ou `null` quand il faut servir l'original
 * (format inconnu, ffmpeg absent, image déjà plus petite que la demande).
 */
export async function miniatureDe(
  fichier: string,
  mime: string,
  largeur: number,
): Promise<{ file: string; mime: string; taille: number } | null> {
  const extension = FORMATS[mime];
  if (!extension) return null;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(fichier);
  } catch {
    return null;
  }
  const dossier = path.join(CONFIG.dataDir, 'miniatures');
  const cle = crypto.createHash('sha1').update(`${fichier}|${stat.mtimeMs}|${stat.size}|${largeur}`).digest('hex');
  const cible = path.join(dossier, `${cle}.${extension}`);
  const servir = (): { file: string; mime: string; taille: number } | null => {
    try {
      const fait = fs.statSync(cible);
      const typeServi = TYPE_DE_LA_MINIATURE[mime];
      if (typeServi) return fait.size > 0 ? { file: cible, mime: typeServi, taille: fait.size } : null;
      /* Une miniature plus lourde que l'original ne sert à rien. */
      return fait.size > 0 && fait.size < stat.size ? { file: cible, mime, taille: fait.size } : null;
    } catch {
      return null;
    }
  };
  if (fs.existsSync(cible)) return servir();
  let travail = enCours.get(cle);
  if (!travail) {
    travail = (async () => {
      await placeLibre();
      try {
        fs.mkdirSync(dossier, { recursive: true });
        const provisoire = `${cible}.${process.pid}.tmp.${extension}`;
        const ok = await fabriquer(fichier, provisoire, largeur, extension, mime);
        if (ok) fs.renameSync(provisoire, cible);
        else fs.rmSync(provisoire, { force: true });
        return ok ? cible : null;
      } catch {
        return null;
      } finally {
        rendreLaPlace();
        enCours.delete(cle);
      }
    })();
    enCours.set(cle, travail);
  }
  return (await travail) ? servir() : null;
}
