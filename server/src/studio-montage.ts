import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CONFIG } from './config.js';
import { dansLaFileLourde } from './studio-file.js';
import { fichierDuMedia, lireCreation, lireMedia } from './studio.js';
import { dureeDuFichier } from './studio-generation.js';

/**
 * LA BANDE D'IMAGES D'UNE VIDÉO, pour la fenêtre d'édition d'un élément du
 * Studio : des vignettes prises à intervalle régulier sur le fichier entier,
 * collées en UNE image (planche). Extraite UNE fois par ffmpeg, DANS la file
 * lourde (MEM-4353 : un seul travail lourd à la fois sur une machine de 7 Go),
 * puis gardée par média. Rendue en `data:` : l'écran l'affiche sans route à part
 * ni adresse signée.
 *
 * Chaque vignette garde le FORMAT de la vidéo (aucun recadrage) : l'écran les
 * pose en tuiles à leur vraie proportion et choisit, pour chaque tuile, la
 * vignette de l'instant qu'elle couvre — jamais une image étirée sur toute la
 * largeur. La vignette k montre l'instant `k × duree / images`.
 */

const execFileAsync = promisify(execFile);
/** Hauteur d'une vignette, en pixels ; sa largeur suit la proportion de la vidéo. */
export const HAUTEUR_VIGNETTE = 96;
/** Deux vignettes par seconde, entre 12 et 60. */
export function imagesDeLaBande(duree: number): number {
  return Math.max(12, Math.min(60, Math.ceil(duree * 2)));
}
const DOSSIER_BANDES = () => path.join(CONFIG.dataDir, 'studio', 'bandes');

type Resultat<T> = ({ ok: true } & T) | { ok: false; raison: string };

export interface BandeDImages {
  image: string;
  /** Nombre de vignettes de la planche. */
  images: number;
  /** Taille d'UNE vignette, en pixels de la planche. */
  largeur: number;
  hauteur: number;
  duree: number;
}

export async function bandeDImages(creationId: string, mediaId: string): Promise<Resultat<BandeDImages>> {
  const creation = lireCreation(creationId);
  const media = lireMedia(mediaId);
  if (!creation || !media || media.projectId !== creation.projectId) return { ok: false, raison: 'média introuvable' };
  if (media.genre !== 'video') return { ok: false, raison: 'ce média n’est pas une vidéo' };
  const fichier = fichierDuMedia(media);
  if (!fichier) return { ok: false, raison: 'le fichier de la vidéo est introuvable' };
  // « -v2 » : les planches d'avant (12 vignettes recadrées en 16:9) ne sont plus jamais servies.
  const sortie = path.join(DOSSIER_BANDES(), `${mediaId}-v2.jpg`);
  const fiche = `${sortie}.json`;
  if (fs.existsSync(sortie) && fs.existsSync(fiche)) {
    try {
      const f = JSON.parse(fs.readFileSync(fiche, 'utf8')) as Omit<BandeDImages, 'image'>;
      return { ok: true, image: `data:image/jpeg;base64,${fs.readFileSync(sortie).toString('base64')}`, ...f };
    } catch {
      /* fiche illisible : la planche se refait */
    }
  }
  const duree = media.duree && media.duree > 0 ? media.duree : await dureeDuFichier(fichier);
  const images = imagesDeLaBande(duree);
  fs.mkdirSync(DOSSIER_BANDES(), { recursive: true });
  const provisoire = `${sortie}.${process.pid}.tmp.jpg`;
  try {
    await dansLaFileLourde(() =>
      execFileAsync(
        'ffmpeg',
        [
          '-v', 'error',
          '-i', fichier,
          '-vf', `fps=${(images / Math.max(0.1, duree)).toFixed(6)},scale=-2:${HAUTEUR_VIGNETTE},tile=${images}x1`,
          '-frames:v', '1',
          '-q:v', '5',
          '-y', provisoire,
        ],
        { timeout: 120_000 },
      ),
    );
    const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'json', provisoire], { timeout: 20_000 });
    const flux = (JSON.parse(stdout).streams ?? [])[0] ?? {};
    const largeur = Math.max(1, Math.round(Number(flux.width) / images));
    const hauteur = Math.max(1, Number(flux.height) || HAUTEUR_VIGNETTE);
    fs.renameSync(provisoire, sortie);
    const f = { images, largeur, hauteur, duree };
    fs.writeFileSync(fiche, JSON.stringify(f));
    return { ok: true, image: `data:image/jpeg;base64,${fs.readFileSync(sortie).toString('base64')}`, ...f };
  } catch (err: any) {
    fs.rmSync(provisoire, { force: true });
    return { ok: false, raison: `la bande d’images n’a pas pu être extraite (${String(err?.message ?? err).slice(0, 160)})` };
  }
}
