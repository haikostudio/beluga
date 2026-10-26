import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  POLICES_DE_COMPOSITION,
  bibliothequesDemandees,
  delaiDeRenduMs,
  dureeDeLaComposition,
  fautesDeDeterminisme,
  feuilleDesPolices,
  idDeComposition,
  poserLesDimensions,
  squeletteDeComposition,
  type FormatDeMedia,
} from '@beluga/shared';
import { CONFIG } from './config.js';
import { lancerCommandeBornee } from './commande-bornee.js';
import { dansLaFileLourde } from './file-lourde.js';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

/**
 * LA FABRICATION SUR LE SERVEUR — HyperFrames (npm `hyperframes`, Apache-2.0,
 * version ÉPINGLÉE dans `server/package.json`), jamais lancé par `npx` à la volée.
 * Sorti du Studio (retiré le 26/10/2026), il sert désormais le directeur
 * artistique : l'agent écrit un dossier de composition, le serveur le contrôle,
 * en tire des aperçus, puis le rend.
 *
 *  - CONTRÔLE : déterminisme (`fautesDeDeterminisme`), puis `lint` et `validate`
 *    (erreurs JavaScript, fichiers manquants) dans un Chrome sans tête ;
 *  - APERÇUS : `snapshot` aux instants voulus, l'agent les REGARDE ;
 *  - RENDU : `render` MP4 h264 30 i/s, ou une image par `snapshot` ; contrôle
 *    `ffprobe` (durée à 0,5 s près, image présente, son quand il y en a) ;
 *  - UN SEUL travail lourd à la fois (`dansLaFileLourde`), durée plafonnée ;
 *  - télémétrie coupée (`DO_NOT_TRACK=1`) et clé Gemini RETIRÉE de
 *    l'environnement (sinon `snapshot` enverrait les images se faire décrire) ;
 *  - commandes PERMISES : une liste fermée (`publish`, `cloud`, `lambda`,
 *    `cloudrun`, `auth`, `feedback` envoient le contenu au-dehors) ;
 *  - LE RENDU SE FAIT SUR UNE COPIE LOCALE du dossier (le dossier des médias
 *    vit sur le disque de stockage, en réseau), effacée ensuite.
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

/** Le moteur est-il en place ? C'est ce qui « branche » la capacité « composition ». */
export function compositionDisponible(): boolean {
  const o = outilsDeRendu();
  return !!o.hyperframes && !!o.gsap;
}

function q(chemin: string): string {
  return `'${chemin.replace(/'/g, `'\\''`)}'`;
}

async function hyperframes(
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
function jsonDeLaSortie(sortie: string): any {
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

/* ------------------------------------------------------------------ */
/* Le dossier d'une composition                                         */
/* ------------------------------------------------------------------ */

/** Copie un dossier entier (les bibliothèques). */
function copierDossier(source: string, cible: string): void {
  fs.cpSync(source, cible, { recursive: true, force: true });
}

/**
 * PRÉPARER LE DOSSIER D'UNE COMPOSITION, sous le dossier des médias de la
 * carte : `lib/` (GSAP et les bibliothèques demandées), `polices/`, `medias/`
 * et un `index.html` de départ s'il n'y en a pas encore. Rien n'est écrasé
 * dans `index.html` ni dans `medias/` : relancer la préparation ajoute ce qui
 * manque (une bibliothèque de plus).
 */
export function preparerComposition(e: {
  dossierDesMedias: string;
  plan: string;
  format: FormatDeMedia;
  duree: number;
  titre?: string;
  bibliotheques?: unknown;
}): { dossier: string; id: string; bibliotheques: string[]; neuf: boolean } {
  const outils = outilsDeRendu();
  if (!outils.gsap) throw new Error('GSAP n’est pas installé (dépendance « gsap » du serveur)');
  const id = idDeComposition(e.plan);
  const dossier = path.join(e.dossierDesMedias, 'compositions', id);
  fs.mkdirSync(path.join(dossier, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(dossier, 'polices'), { recursive: true });
  fs.mkdirSync(path.join(dossier, 'medias'), { recursive: true });
  fs.copyFileSync(outils.gsap, path.join(dossier, 'lib', 'gsap.min.js'));
  for (const p of POLICES_DE_COMPOSITION) {
    const source = path.join(outils.polices, p.fichier);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(dossier, 'polices', p.fichier));
  }
  fs.writeFileSync(path.join(dossier, 'polices', 'polices.css'), `${feuilleDesPolices('./')}\n`);
  const libs = bibliothequesDemandees(e.bibliotheques);
  for (const b of libs) {
    if (!b.dossier) continue;
    const source = path.join(outils.bibliotheques, b.dossier);
    if (fs.existsSync(source)) copierDossier(source, path.join(dossier, 'lib', b.dossier));
  }
  const page = path.join(dossier, 'index.html');
  const neuf = !fs.existsSync(page);
  if (neuf) {
    fs.writeFileSync(page, squeletteDeComposition({ id, format: e.format, duree: e.duree, titre: e.titre ?? e.plan, bibliotheques: libs, feuilleDesPolices: feuilleDesPolices('polices/') }));
  }
  return { dossier, id, bibliotheques: libs.map((b) => b.id), neuf };
}

/** Un dossier de composition valable : absolu, existant, avec son `index.html`. */
export function dossierDeComposition(brut: unknown): string | null {
  const d = String(brut ?? '').trim();
  if (!d || !path.isAbsolute(d)) return null;
  const dossier = d.endsWith('index.html') ? path.dirname(d) : d;
  return fs.existsSync(path.join(dossier, 'index.html')) ? dossier : null;
}

/** Une copie LOCALE du dossier, mise au format demandé : c'est elle que le moteur lit. */
function copieDeTravail(dossier: string, format: FormatDeMedia | null, nom: string): string {
  const travail = path.join(CONFIG.dataDir, 'compositions', 'travail', `${Date.now()}-${nom}`);
  fs.rmSync(travail, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(travail), { recursive: true });
  fs.cpSync(dossier, travail, { recursive: true, filter: (s) => !/\/(apercus|rendus)(\/|$)/.test(s.slice(dossier.length)) });
  if (format) {
    const page = path.join(travail, 'index.html');
    fs.writeFileSync(page, poserLesDimensions(fs.readFileSync(page, 'utf8'), format));
  }
  return travail;
}

/* ------------------------------------------------------------------ */
/* Contrôle, aperçus, rendu                                             */
/* ------------------------------------------------------------------ */

export interface ControleDeComposition {
  erreurs: string[];
  avertissements: string[];
  duree: number | null;
}

/**
 * CONTRÔLER UNE COMPOSITION : déterminisme d'abord (sans lancer de Chrome),
 * puis `lint` (forme) et `validate` (erreurs JavaScript, fichiers manquants).
 */
export async function controlerComposition(dossier: string): Promise<ControleDeComposition> {
  const html = fs.readFileSync(path.join(dossier, 'index.html'), 'utf8');
  const fautes = fautesDeDeterminisme(html);
  const duree = dureeDeLaComposition(html);
  if (fautes.erreurs.length) return { ...fautes, duree };
  return dansLaFileLourde(async () => {
    const travail = copieDeTravail(dossier, null, 'controle');
    try {
      const erreurs: string[] = [];
      const avertissements = [...fautes.avertissements];
      const lint = await hyperframes('lint', [travail, '--json'], { timeout: 90_000 });
      for (const f of jsonDeLaSortie(lint.sortie)?.findings ?? []) {
        if (f.code === 'nested_structure_needs_subcomposition') continue;
        (f.severity === 'error' ? erreurs : avertissements).push(`${f.code} : ${f.message}`);
      }
      const validation = await hyperframes('validate', [travail, '--json', '--no-contrast', '--timeout', '6000'], { timeout: 150_000 });
      const v = jsonDeLaSortie(validation.sortie);
      if (!v) erreurs.push(`la page n’a pas pu être contrôlée : ${validation.sortie.slice(-300)}`);
      for (const x of v?.errors ?? []) erreurs.push(String(x.text ?? x.message ?? x).slice(0, 300));
      for (const w of v?.warnings ?? []) {
        const texte = String(w.text ?? w.message ?? w);
        // Le rendu logiciel de WebGL (aucune carte graphique) parle de « GPU stall » à chaque lecture d'image : du bruit.
        if (/GL Driver Message|GPU stall/i.test(texte)) continue;
        avertissements.push(texte.slice(0, 300));
      }
      return { erreurs: [...new Set(erreurs)].slice(0, 20), avertissements: [...new Set(avertissements)].slice(0, 20), duree };
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });
}

/** DES IMAGES DE LA COMPOSITION aux instants voulus, rangées dans `<dossier>/apercus/` : l'agent VOIT ce qu'il a fait. */
export async function apercusDeLaComposition(dossier: string, instants: number[], format: FormatDeMedia | null): Promise<{ ok: true; images: string[]; planche?: string } | { ok: false; raison: string }> {
  const html = fs.readFileSync(path.join(dossier, 'index.html'), 'utf8');
  const duree = dureeDeLaComposition(html) ?? 1;
  const temps = [...new Set(instants.filter((t) => Number.isFinite(t)).map((t) => Math.min(Math.max(0, t), Math.max(0, duree - 0.05))))].slice(0, 8);
  if (!temps.length) temps.push(Math.min(1, duree / 2));
  return dansLaFileLourde(async () => {
    const travail = copieDeTravail(dossier, format, 'apercu');
    try {
      const sortie = path.join(travail, 'images');
      const r = await hyperframes('snapshot', [travail, '--at', temps.map((t) => t.toFixed(2)).join(','), '--no-end', '--describe', 'false', '-o', sortie], { timeout: 180_000 });
      const pngs = fs.existsSync(sortie) ? fs.readdirSync(sortie).filter((f) => f.endsWith('.png')).sort() : [];
      if (!pngs.length) return { ok: false, raison: `aucune image n’a pu être prise : ${r.sortie.slice(-300)}` };
      const cible = path.join(dossier, 'apercus');
      fs.rmSync(cible, { recursive: true, force: true });
      fs.mkdirSync(cible, { recursive: true });
      const images = pngs.map((f) => {
        fs.copyFileSync(path.join(sortie, f), path.join(cible, f));
        return path.join(cible, f);
      });
      const planche = path.join(sortie, 'contact-sheet.jpg');
      if (fs.existsSync(planche)) fs.copyFileSync(planche, path.join(cible, 'planche.jpg'));
      return { ok: true, images, ...(fs.existsSync(planche) ? { planche: path.join(cible, 'planche.jpg') } : {}) };
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });
}

/** La page a-t-elle un son qui doit s'entendre (une balise audio, ou une vidéo marquée avec son) ? */
function pageAvecSon(html: string): boolean {
  return /<audio\b[^>]*\bsrc\s*=/i.test(html) || /<video\b[^>]*data-has-audio\s*=\s*["']true["']/i.test(html);
}

/**
 * RENDRE UNE COMPOSITION, dans la file lourde : une VIDÉO (MP4, contrôlée par
 * ffprobe) ou une IMAGE (PNG à l'instant voulu). Rend le chemin du fichier,
 * écrit dans `<dossier>/rendus/`.
 */
export async function rendreComposition(
  dossier: string,
  e: { genre: 'video' | 'image'; format: FormatDeMedia; instant?: number; signal?: AbortSignal; surProgression?: (valeur: number, etape: string) => void },
): Promise<{ fichier: string; duree?: number; secondes: number }> {
  const html = fs.readFileSync(path.join(dossier, 'index.html'), 'utf8');
  const fautes = fautesDeDeterminisme(html);
  if (fautes.erreurs.length) throw new Error(`la composition n’est pas rendable : ${fautes.erreurs.join(' ; ')}`);
  const duree = dureeDeLaComposition(html)!;
  return dansLaFileLourde(async () => {
    const debut = Date.now();
    const travail = copieDeTravail(dossier, e.format, e.genre);
    const rendus = path.join(dossier, 'rendus');
    fs.mkdirSync(rendus, { recursive: true });
    try {
      if (e.genre === 'video') {
        const sortie = path.join(travail, 'rendu.mp4');
        let dernier = 0;
        const r = await hyperframes('render', [travail, '-o', sortie, '--workers', '1', '-q', 'standard', '--fps', '30'], {
          timeout: delaiDeRenduMs(duree, e.format),
          ...(e.signal ? { signal: e.signal } : {}),
          surLigne: (ligne) => {
            const m = /(\d{1,3})%\s+(.+)$/.exec(ligne);
            if (!m || !e.surProgression) return;
            const valeur = Math.min(0.95, Number(m[1]) / 100);
            if (valeur - dernier < 0.05 && valeur < 0.95) return;
            dernier = valeur;
            e.surProgression(valeur, m[2]!.trim().slice(0, 60));
          },
        });
        if (!r.ok || !fs.existsSync(sortie)) throw new Error(r.delaiDepasse ? 'le rendu a dépassé son temps et a été arrêté' : `le rendu a échoué : ${r.sortie.slice(-400)}`);
        // LE CONTRÔLE DE LECTURE : jamais un fichier vide ou coupé annoncé prêt.
        const lu = await lireFichierVideo(sortie);
        if (!lu.image) throw new Error('la vidéo rendue n’a pas d’image');
        if (Math.abs(lu.duree - duree) > 0.5) throw new Error(`la vidéo dure ${lu.duree.toFixed(2)} s au lieu de ${duree.toFixed(2)} s`);
        if (pageAvecSon(html) && !lu.son) throw new Error('la vidéo rendue a perdu son son');
        const fichier = path.join(rendus, `${path.basename(dossier)}-${e.format.replace(':', 'x')}.mp4`);
        fs.copyFileSync(sortie, fichier);
        return { fichier, duree: lu.duree, secondes: Math.round((Date.now() - debut) / 1000) };
      }
      const t = Math.min(Math.max(0, e.instant ?? Math.min(1, duree / 2)), Math.max(0, duree - 0.05));
      const images = path.join(travail, 'image');
      await hyperframes('snapshot', [travail, '--at', t.toFixed(2), '--no-end', '--describe', 'false', '-o', images], { timeout: 180_000, ...(e.signal ? { signal: e.signal } : {}) });
      const png = fs.existsSync(images) ? fs.readdirSync(images).find((f) => f.endsWith('.png')) : undefined;
      if (!png) throw new Error('l’image n’a pas pu être prise');
      const fichier = path.join(rendus, `${path.basename(dossier)}-${e.format.replace(':', 'x')}.png`);
      fs.copyFileSync(path.join(images, png), fichier);
      return { fichier, secondes: Math.round((Date.now() - debut) / 1000) };
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });
}

/**
 * LA LIVRAISON D'UN FILM MONTÉ (ffmpeg) : niveau sonore des réseaux (−16 LUFS,
 * crête −1,5 dB) quand il y a du son, lecture immédiate sur le web (faststart),
 * h264 yuv420p. Rend le chemin du fichier livré, à côté de l'original.
 */
export async function livrerLeFilm(fichier: string): Promise<string> {
  const lu = await lireFichierVideo(fichier);
  const sortie = fichier.replace(/\.mp4$/i, '') + '-livre.mp4';
  const son = lu.son ? ['-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000'] : ['-an'];
  await dansLaFileLourde(() =>
    execFileAsync('ffmpeg', ['-v', 'error', '-y', '-i', fichier, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', ...son, '-movflags', '+faststart', sortie], { timeout: Math.max(5 * 60_000, lu.duree * 10_000) }),
  );
  const verifie = await lireFichierVideo(sortie);
  if (!verifie.image || Math.abs(verifie.duree - lu.duree) > 0.5) throw new Error('la livraison a abîmé le film (durée ou image)');
  return sortie;
}
