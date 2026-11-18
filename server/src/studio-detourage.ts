/**
 * LE DÉTOURAGE D'UN FOND UNI, SUR CE SERVEUR ET SANS FRAIS (décision de
 * l'utilisateur du 02/11/2026) : une vidéo devient un WebM VP9 à couche alpha, une
 * image un PNG. L'export (HyperFrames) et l'aperçu de Chrome et Firefox lisent cette
 * couche ; prouvé sur la mascotte #b81c de « Lancement ProjetA ».
 *
 * SAFARI ET L'IPHONE NE LISENT PAS L'ALPHA DU VP9 : ils auraient montré un rectangle
 * vert. Une COPIE H.264 (couleur à gauche, masque à droite, `copieAlphaDUneVideo`) leur
 * sert d'aperçu : le moteur de l'aperçu la recompose image par image dans un canevas.
 * Seul l'aperçu de ces navigateurs s'en sert ; l'export garde le WebM d'origine.
 *
 * Tout passe par `dansLaFileLourde`, chez l'appelant.
 */
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { filtreDeCopieAlpha, tailleDeCopieAlpha, couleurFranche, lireLeFond, retirerLeFondRelie, type LectureDuFond } from '@beluga/shared';

const executer = promisify(execFile);

function provisoire(ext: string): string {
  return path.join(os.tmpdir(), `beluga-detourage-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`);
}

/** Une image de l'entrée, en pixels bruts réduits : la couleur moyenne de la zone demandée. */
async function couleurMoyenne(source: string, zone: string, seconde: number): Promise<[number, number, number]> {
  const { stdout } = await executer('ffmpeg', ['-v', 'error', '-ss', String(seconde), '-i', source, '-frames:v', '1', '-vf', `${zone},scale=1:1:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { encoding: 'buffer', timeout: 60_000 } as any);
  const octets = stdout as unknown as Buffer;
  return [octets[0] ?? 0, octets[1] ?? 0, octets[2] ?? 0];
}

/** LA COULEUR DU FOND, lue aux quatre coins (repli de l'agent, qui a annoncé un fond) : refusée quand ils ne se ressemblent pas, ce n'est alors pas un fond uni. */
export async function couleurDuFond(source: string, seconde = 0): Promise<string> {
  const coins = await Promise.all(['crop=iw/20:ih/20:0:0', 'crop=iw/20:ih/20:iw-iw/20:0', 'crop=iw/20:ih/20:0:ih-ih/20', 'crop=iw/20:ih/20:iw-iw/20:ih-ih/20'].map((z) => couleurMoyenne(source, z, seconde)));
  const moyenne = [0, 1, 2].map((k) => Math.round(coins.reduce((s, c) => s + c[k]!, 0) / coins.length)) as [number, number, number];
  const ecart = Math.max(...coins.map((c) => Math.max(...c.map((v, k) => Math.abs(v - moyenne[k]!)))));
  if (ecart > 48) throw new Error('les coins de l’image n’ont pas la même couleur : ce n’est pas un fond uni');
  return `#${moyenne.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Un fond franc se retire à la teinte ; un blanc, un noir ou un gris à la couleur exacte : sinon tous les neutres du sujet partaient avec lui. */
function filtreDeCle(couleur: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(couleur.slice(i, i + 2), 16)) as [number, number, number];
  if (!couleurFranche(couleur)) return `colorkey=0x${couleur.slice(1)}:0.14:0.06`;
  /* Le reflet du fond sur les bords se retire seulement pour un fond vert ou bleu franc. `mix=1` : mesuré contre le rouge (ou le vert), sans quoi un sujet jaune virait à l'orange. */
  const reflet = g > r * 1.4 && g > b * 1.4 ? ',despill=type=green:mix=1' : b > r * 1.4 && b > g * 1.4 ? ',despill=type=blue:mix=1' : '';
  return `chromakey=0x${couleur.slice(1)}:0.13:0.06${reflet}`;
}

/** Sa taille et, pour un VP9, de quoi lire sa couche alpha : ffmpeg ne la voit qu'avec ce décodeur-là. */
async function sonde(source: string): Promise<{ largeur: number; hauteur: number; vp9: boolean }> {
  const { stdout } = await executer('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,codec_name', '-of', 'csv=p=0:s=,', source], { timeout: 30_000 });
  const [codec, largeur, hauteur] = stdout.trim().split(',');
  return { largeur: Number(largeur) || 0, hauteur: Number(hauteur) || 0, vp9: codec === 'vp9' };
}

/** Une image de l'entrée en RGBA brut, à la taille demandée. */
async function pixelsDe(source: string, largeur: number, hauteur: number, vp9: boolean, seconde: number): Promise<Buffer> {
  const { stdout } = await executer(
    'ffmpeg',
    ['-v', 'error', ...(vp9 ? ['-c:v', 'libvpx-vp9'] : []), ...(seconde > 0 ? ['-ss', String(seconde)] : []), '-i', source, '-frames:v', '1', '-vf', `scale=${largeur}:${hauteur}:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'],
    { encoding: 'buffer', timeout: 60_000, maxBuffer: 512 * 1024 * 1024 } as any,
  );
  return stdout as unknown as Buffer;
}

/** Le côté de l'image réduite où se lit le fond : assez fin pour voir un texte, assez petit pour rester immédiat. */
const COTE_D_ANALYSE = 240;

async function lectureDUneImage(source: string, m: { largeur: number; hauteur: number; vp9: boolean }, seconde: number, exigeant: boolean): Promise<LectureDuFond> {
  const rapport = Math.min(1, COTE_D_ANALYSE / Math.max(m.largeur, m.hauteur));
  const l = Math.max(4, Math.round(m.largeur * rapport));
  const h = Math.max(4, Math.round(m.hauteur * rapport));
  const pixels = await pixelsDe(source, l, h, m.vp9, seconde);
  if (pixels.length < l * h * 4) return { etat: 'non-uni', raison: 'image illisible' };
  return lireLeFond(pixels, l, h, { exigeant });
}

/**
 * Y A-T-IL UN VRAI FOND UNI ? Tout le tour de l'image ; pour une vidéo, à trois instants qui doivent dire la même
 * couleur. Rend sa couleur, ou `null` avec la raison : aucun fond à retirer n'est jamais une panne. `exigeant` : le
 * retrait d'office, qui écarte en plus les captures et les documents.
 */
export async function lireLeFondDuFichier(source: string, options: { video?: boolean; exigeant?: boolean } = {}): Promise<{ couleur: string | null; transparent: boolean; raison?: string }> {
  const mesure = await sonde(source);
  if (!mesure.largeur || !mesure.hauteur) return { couleur: null, transparent: false, raison: 'fichier illisible' };
  const duree = options.video ? await dureeDe(source) : 0;
  const instants = options.video && duree > 0.6 ? [0.1, duree / 2, Math.max(0.1, duree - 0.3)] : [0];
  const couleurs: string[] = [];
  for (const instant of instants) {
    const lu = await lectureDUneImage(source, mesure, instant, !!options.exigeant);
    if (lu.etat === 'transparent') return { couleur: null, transparent: true };
    if (lu.etat === 'non-uni') return { couleur: null, transparent: false, raison: lu.raison };
    couleurs.push(lu.couleur);
  }
  const canaux = couleurs.map((c) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16)));
  const moyenne = [0, 1, 2].map((k) => Math.round(canaux.reduce((s, c) => s + c[k]!, 0) / canaux.length));
  if (canaux.some((c) => c.some((v, k) => Math.abs(v - moyenne[k]!) > 30))) return { couleur: null, transparent: false, raison: 'le fond change de couleur pendant la vidéo' };
  return { couleur: `#${moyenne.map((v) => v.toString(16).padStart(2, '0')).join('')}`, transparent: false };
}

/** LA PREUVE QUE LE DÉTOURAGE A ÉTÉ UTILE : ni tout transparent, ni rien de retiré. */
async function controlerLAlpha(fichier: string, video: boolean, seconde: number): Promise<void> {
  const { stdout } = await executer(
    'ffmpeg',
    ['-v', 'error', ...(video ? ['-c:v', 'libvpx-vp9', '-ss', String(seconde)] : []), '-i', fichier, '-frames:v', '1', '-vf', 'format=rgba,alphaextract,scale=1:1:flags=area', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'],
    { encoding: 'buffer', timeout: 60_000 } as any,
  );
  const moyenne = (stdout as unknown as Buffer)[0] ?? 0;
  if (moyenne < 3) throw new Error('tout est devenu transparent : le sujet est trop proche du fond');
  if (moyenne > 250) throw new Error('rien n’a été retiré : le fond n’est pas uni ou pas de la couleur annoncée');
}

async function dureeDe(fichier: string): Promise<number> {
  const { stdout } = await executer('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', fichier], { timeout: 30_000 });
  return Number(stdout.trim()) || 0;
}

/** Détoure une vidéo muette. Rend le chemin d'un WebM provisoire ; lève une erreur lisible en cas d'échec. */
export async function detourerUneVideo(source: string, fond: string): Promise<string> {
  const duree = await dureeDe(source);
  const milieu = Math.max(0, duree / 2);
  const couleur = /^#[0-9a-f]{6}$/i.test(fond) ? fond : await couleurDuFond(source, milieu);
  const sortie = provisoire('webm');
  await executer(
    'ffmpeg',
    ['-y', '-v', 'error', '-i', source, '-an', '-vf', `${filtreDeCle(couleur)},format=yuva420p`, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '1500k', '-row-mt', '1', '-deadline', 'realtime', '-cpu-used', '6', '-auto-alt-ref', '0', sortie],
    /* Un entier : une durée à virgule au-delà de 10 s faisait planter le lancement de la commande. */
    { timeout: Math.ceil(Math.max(5 * 60_000, duree * 30_000)) },
  );
  await controlerLAlpha(sortie, true, milieu);
  return sortie;
}

/** Au-delà, l'image passerait trop de temps entière en mémoire du démon. */
const PIXELS_MAX_D_UNE_IMAGE = 40_000_000;

/**
 * Détoure une image : seule la couleur reliée au bord part (`retirerLeFondRelie`). Rend le chemin d'un PNG
 * provisoire. « auto » lit le fond sur tout le tour, puis, sauf `strict`, aux quatre coins comme l'agent l'a toujours eu.
 */
export async function detourerUneImage(source: string, fond: string, options: { strict?: boolean } = {}): Promise<string> {
  let couleur = fond;
  if (!/^#[0-9a-f]{6}$/i.test(fond)) {
    const lu = await lireLeFondDuFichier(source);
    if (lu.transparent) throw new Error('cette image n’a déjà plus de fond');
    if (lu.couleur) couleur = lu.couleur;
    else if (options.strict) throw new Error(lu.raison ?? 'ce n’est pas un fond uni');
    else couleur = await couleurDuFond(source);
  }
  const { largeur, hauteur, vp9 } = await sonde(source);
  if (!largeur || !hauteur) throw new Error('image illisible');
  if (largeur * hauteur > PIXELS_MAX_D_UNE_IMAGE) throw new Error('image trop grande pour être détourée ici');
  const pixels = new Uint8Array(await pixelsDe(source, largeur, hauteur, vp9, 0));
  retirerLeFondRelie(pixels, largeur, hauteur, couleur);
  const sortie = provisoire('png');
  await new Promise<void>((resolu, rejete) => {
    const ffmpeg = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${largeur}x${hauteur}`, '-i', 'pipe:0', '-frames:v', '1', sortie], { stdio: ['pipe', 'ignore', 'pipe'] });
    let erreur = '';
    ffmpeg.stderr.on('data', (d) => (erreur += String(d)));
    ffmpeg.on('error', rejete);
    ffmpeg.on('close', (code) => (code === 0 ? resolu() : rejete(new Error(`écriture du PNG impossible : ${erreur.slice(0, 200)}`))));
    ffmpeg.stdin.on('error', () => undefined);
    ffmpeg.stdin.end(Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength));
  });
  try {
    await controlerLAlpha(sortie, false, 0);
  } catch (err) {
    fs.rmSync(sortie, { force: true });
    throw err;
  }
  return sortie;
}

/** La vidéo porte-t-elle une couche transparente ? Lu dans le fichier : le type annoncé n'en dit rien. */
export async function videoATransparence(fichier: string): Promise<boolean> {
  const { stdout } = await executer('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=pix_fmt:stream_tags', '-of', 'json', fichier], { timeout: 30_000 });
  const flux = (JSON.parse(stdout) as { streams?: { pix_fmt?: string; tags?: Record<string, string> }[] }).streams?.[0];
  if (!flux) return false;
  if (/^(yuva|rgba|bgra|argb|abgr)/.test(flux.pix_fmt ?? '')) return true;
  return Object.entries(flux.tags ?? {}).some(([cle, valeur]) => cle.toLowerCase() === 'alpha_mode' && valeur === '1');
}

/** LA COPIE D'APERÇU d'une vidéo transparente : le décodeur `libvpx-vp9` est imposé, le décodeur natif ignore l'alpha. */
export async function copieAlphaDUneVideo(webm: string, largeur: number, hauteur: number): Promise<{ chemin: string } & { largeur: number; hauteur: number }> {
  const sortie = provisoire('mp4');
  await executer(
    'ffmpeg',
    ['-y', '-v', 'error', '-c:v', 'libvpx-vp9', '-i', webm, '-filter_complex', filtreDeCopieAlpha(largeur, hauteur), '-map', '[v]', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-profile:v', 'high', '-g', '30', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', sortie],
    { timeout: 10 * 60_000 },
  );
  return { chemin: sortie, ...tailleDeCopieAlpha(largeur, hauteur) };
}
