import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  type Composition,
  type Creation,
  type ExportStudio,
  type FormatStudio,
  type MediaPourLaPage,
  type MediaStudio,
  type ReglagesExport,
  POLICES_STUDIO,
  argumentsDeRendu,
  dureeExportee,
  extensionDExport,
  facteurDeDureeDeRendu,
  fichierAvecSon,
  lireReglagesExport,
  mediasDeLaComposition,
  nomDExport,
  tousLesSegments,
  traduireEnPage,
  voixPasFinales,
} from '@beluga/shared';
import { CONFIG } from './config.js';
import { lancerCommandeBornee } from './commande-bornee.js';
import { dansLaFileLourde } from './studio-file.js';
import { joindreUnFichier } from './joindre-fichier.js';
import {
  assurerEspaceStudio,
  compositionCourante,
  creerExport,
  diffuserStudio,
  exportsEnAttente,
  fichierDuMedia,
  lireCreation,
  lireExport,
  lireMedia,
  listerExports,
  majExport,
  type Resultat,
} from './studio.js';
import { bus } from './bus.js';
import { log } from './logger.js';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

/**
 * LE RENDU DU STUDIO — HyperFrames (npm `hyperframes`, Apache-2.0, version
 * ÉPINGLÉE dans `server/package.json`), jamais lancé par `npx` à la volée.
 *
 *  - CONTRÔLE D'UN DESSIN avant de le poser : `lint` puis `validate` (erreurs
 *    JavaScript, médias manquants) ; APERÇU pour l'agent : `snapshot` ;
 *  - EXPORT : `render`, MP4 h264 à 30 i/s ; image fixe et affiche par `snapshot` ;
 *  - UNE SEULE fabrication à la fois (`dansLaFileLourde`), progression diffusée,
 *    annulation possible, durée plafonnée (`lancerCommandeBornee`) ;
 *  - télémétrie coupée (`DO_NOT_TRACK=1`), et la clé Gemini RETIRÉE de
 *    l'environnement : `snapshot` l'enverrait sinon décrire les images chez Google ;
 *  - commandes PERMISES : une liste fermée. `publish`, `cloud`, `lambda`,
 *    `cloudrun`, `auth`, `feedback` envoient le contenu ou des identifiants
 *    au-dehors : elles sont refusées avant de partir ;
 *  - après chaque export, `ffprobe` : durée à 0,5 s près, image ET son présents
 *    (quand la création a du son). Un fichier vide ou coupé n'est jamais annoncé prêt.
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

export function outilsDeRendu(): { hyperframes: string | null; gsap: string | null; polices: string } {
  const hyperframes = cheminDuPaquet('hyperframes', 'bin/hyperframes.mjs');
  const gsap = cheminDuPaquet('gsap', 'dist/gsap.min.js');
  return {
    hyperframes: hyperframes && fs.existsSync(hyperframes) ? hyperframes : null,
    gsap: gsap && fs.existsSync(gsap) ? gsap : null,
    polices: path.join(CONFIG.selfPath, 'outils', 'studio-polices'),
  };
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

/* ------------------------------------------------------------------ */
/* Le dossier de rendu : la page et ses fichiers, rien d'autre          */
/* ------------------------------------------------------------------ */

/** Les médias qu'une composition cite (segments, dessins, paramètres, logo du kit). */
export function mediasCites(composition: Composition, logo?: string): string[] {
  const ids = new Set(mediasDeLaComposition(composition));
  if (logo) ids.add(logo);
  return [...ids];
}

function extensionDuMedia(m: MediaStudio, fichier: string): string {
  const ext = path.extname(fichier);
  if (ext) return ext;
  if (m.mime?.includes('png')) return '.png';
  if (m.mime?.includes('jpeg')) return '.jpg';
  if (m.mime?.includes('mp4')) return '.mp4';
  if (m.mime?.includes('wav')) return '.wav';
  if (m.mime?.includes('mpeg')) return '.mp3';
  return '';
}

/**
 * PRÉPARER UN DOSSIER DE RENDU : la page, GSAP, les polices embarquées et
 * COPIE des médias cités. Le Chrome de rendu ne lit que ce dossier.
 */
export function preparerDossier(creation: Creation, composition: Composition, format: FormatStudio, nom: string): { dossier: string; manquants: string[] } {
  const outils = outilsDeRendu();
  if (!outils.gsap) throw new Error('GSAP n’est pas installé (dépendance « gsap » du serveur)');
  const dossier = path.join(CONFIG.dataDir, 'studio', 'rendus', `${creation.id}-${nom}`);
  fs.rmSync(dossier, { recursive: true, force: true });
  fs.mkdirSync(path.join(dossier, 'polices'), { recursive: true });
  fs.mkdirSync(path.join(dossier, 'medias'), { recursive: true });
  fs.copyFileSync(outils.gsap, path.join(dossier, 'gsap.min.js'));
  for (const p of POLICES_STUDIO) {
    const source = path.join(outils.polices, p.fichier);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(dossier, 'polices', p.fichier));
  }
  const espace = assurerEspaceStudio(creation.projectId);
  const medias: Record<string, MediaPourLaPage> = {};
  const manquants: string[] = [];
  for (const id of mediasCites(composition, espace.kit.logoMediaId)) {
    const m = lireMedia(id);
    const fichier = m && m.projectId === creation.projectId ? fichierDuMedia(m) : null;
    if (!m || !fichier) {
      manquants.push(id);
      continue;
    }
    const nomFichier = `${id}${extensionDuMedia(m, fichier)}`;
    fs.copyFileSync(fichier, path.join(dossier, 'medias', nomFichier));
    medias[id] = { url: `medias/${nomFichier}`, genre: m.genre };
  }
  const page = traduireEnPage(composition, { format, kit: espace.kit, medias, gsap: 'gsap.min.js', polices: 'polices/', mode: 'rendu' });
  fs.writeFileSync(path.join(dossier, 'index.html'), page);
  return { dossier, manquants };
}

/* ------------------------------------------------------------------ */
/* Contrôle d'un dessin et aperçu pour l'agent                          */
/* ------------------------------------------------------------------ */

/**
 * CONTRÔLER UNE COMPOSITION DANS UN VRAI CHROME, sans réseau : `lint` (forme
 * HyperFrames) puis `validate` (erreurs JavaScript, fichiers manquants). Rend
 * les erreurs à corriger ; les avertissements de structure ne bloquent pas.
 */
export async function controlerComposition(creation: Creation, composition: Composition, format?: FormatStudio): Promise<{ erreurs: string[]; avertissements: string[] }> {
  return dansLaFileLourde(async () => {
    const { dossier, manquants } = preparerDossier(creation, composition, format ?? composition.format, 'controle');
    const erreurs: string[] = manquants.map((id) => `média « ${id} » introuvable dans la bibliothèque du projet`);
    const avertissements: string[] = [];
    const lint = await hyperframes('lint', [dossier, '--json'], { timeout: 90_000 });
    const l = jsonDeLaSortie(lint.sortie);
    for (const f of l?.findings ?? []) {
      // La structure à plat est voulue : un segment = un clip, sans sous-composition.
      if (f.code === 'nested_structure_needs_subcomposition') continue;
      (f.severity === 'error' ? erreurs : avertissements).push(`${f.code} : ${f.message}`);
    }
    const validation = await hyperframes('validate', [dossier, '--json', '--no-contrast', '--timeout', '4000'], { timeout: 120_000 });
    const v = jsonDeLaSortie(validation.sortie);
    if (!v) erreurs.push(`la page n’a pas pu être contrôlée : ${validation.sortie.slice(-300)}`);
    for (const e of v?.errors ?? []) erreurs.push(String(e.text ?? e.message ?? e).slice(0, 300));
    for (const w of v?.warnings ?? []) avertissements.push(String(w.text ?? w.message ?? w).slice(0, 300));
    return { erreurs: [...new Set(erreurs)].slice(0, 20), avertissements: [...new Set(avertissements)].slice(0, 20) };
  });
}

/** DES IMAGES DE LA COMPOSITION à des instants donnés : l'agent VOIT ce qu'il a fait avant de répondre. */
export async function imagesDeLaComposition(creation: Creation, composition: Composition, instants: number[], format?: FormatStudio): Promise<Resultat<{ images: string[]; planche?: string }>> {
  return dansLaFileLourde(async () => {
    const duree = dureeExportee(composition);
    const temps = [...new Set(instants.map((t) => Math.min(Math.max(0, t), Math.max(0, duree - 0.05))))].slice(0, 8);
    if (!temps.length) temps.push(Math.min(1, duree / 2));
    const { dossier } = preparerDossier(creation, composition, format ?? composition.format, 'apercu');
    const sortie = path.join(dossier, 'images');
    const r = await hyperframes('snapshot', [dossier, '--at', temps.map((t) => t.toFixed(2)).join(','), '--no-end', '--describe', 'false', '-o', sortie], { timeout: 120_000 });
    const images = fs.existsSync(sortie)
      ? fs
          .readdirSync(sortie)
          .filter((f) => f.endsWith('.png'))
          .sort()
          .map((f) => path.join(sortie, f))
      : [];
    if (!images.length) return { ok: false, raison: `aucune image n’a pu être prise : ${r.sortie.slice(-300)}` };
    const planche = path.join(sortie, 'contact-sheet.jpg');
    return { ok: true, images, ...(fs.existsSync(planche) ? { planche } : {}) };
  });
}

/* ------------------------------------------------------------------ */
/* Export                                                               */
/* ------------------------------------------------------------------ */

const arrets = new Map<string, AbortController>();

/** La composition a-t-elle un son qui doit s'entendre dans l'export ? */
function aDuSon(composition: Composition): boolean {
  // Un son posé APRÈS le marqueur bleu n'entre pas dans le fichier : il ne compte pas.
  const fin = dureeExportee(composition);
  return composition.pistes.some(
    (p) =>
      !p.muette &&
      p.segments.some(
        (s) => s.debut < fin && (((s.genre === 'voix' || s.genre === 'audio') && !!s.mediaId && s.volume > 0) || (s.genre === 'video' && s.volume > 0)),
      ),
  );
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

/**
 * LANCER UN EXPORT. Rend la main aussitôt : la fabrication attend son tour
 * dans la file lourde. Les voix encore en essai ne l'empêchent pas — l'écran
 * l'a dit avant le clic, et l'export garde ce nombre.
 */
export function lancerExport(
  creationId: string,
  format: FormatStudio,
  genre: 'video' | 'image',
  instant?: number,
  reglagesDemandes?: unknown,
  lot?: string,
): Resultat<{ export: ExportStudio }> {
  const creation = lireCreation(creationId);
  const composition = compositionCourante(creationId);
  if (!creation || !composition) return { ok: false, raison: 'création introuvable' };
  if (!outilsDeRendu().hyperframes) return { ok: false, raison: 'le moteur de rendu (HyperFrames) n’est pas installé sur ce serveur' };
  // Des réglages impossibles (4K en Portrait, son d'un GIF…) sont corrigés ici, jamais passés au moteur.
  const reglages = lireReglagesExport(reglagesDemandes, format);
  const e = creerExport({ creation, format, genre, voixEnEssai: voixPasFinales(composition).length, reglages, ...(lot ? { lot } : {}) });
  const arret = new AbortController();
  arrets.set(e.id, arret);
  void dansLaFileLourde(() => fabriquer(e.id, creation, composition, format, genre, arret.signal, instant, reglages))
    .catch((err) => {
      log.error('studio : export', err);
      majExport(e.id, { etat: 'echoue', erreur: String(err?.message ?? err).slice(0, 300) });
    })
    .finally(() => arrets.delete(e.id));
  return { ok: true, export: e };
}

/**
 * QUEL EXPORT REFAIRE quand la voix finale vient d'être posée : le dernier export VIDÉO de la création, même
 * format et mêmes réglages ; sans export vidéo précédent, le premier format de la création avec les réglages
 * par défaut. Aucun, si un export vidéo de cette version attend déjà ou tourne (jamais deux fois le même).
 */
export function exportARefaire(
  exports: Pick<ExportStudio, 'genre' | 'format' | 'reglages' | 'etat' | 'version'>[],
  formats: FormatStudio[],
  version: number,
): { format: FormatStudio; reglages?: ReglagesExport } | null {
  const videos = exports.filter((e) => e.genre === 'video');
  if (videos.some((e) => e.version === version && (e.etat === 'en-file' || e.etat === 'en-cours'))) return null;
  const dernier = videos[0];
  const format = dernier?.format ?? formats[0];
  if (!format) return null;
  return { format, ...(dernier?.reglages ? { reglages: dernier.reglages } : {}) };
}

/**
 * LA VIDÉO SUIT LA VOIX FINALE : une prise posée relance seule l'export vidéo (décision de l'utilisateur, 07/10/2026),
 * pour que la vidéo montrée dans « Exports » soit la finale et plus celle des voix d'essai. L'export est local et
 * gratuit, il passe par la file lourde comme les autres. Rien ici ne fait échouer la voix : un refus se note, c'est tout.
 */
export function refaireLExportApresLaVoix(creationId: string): ExportStudio | null {
  try {
    const creation = lireCreation(creationId);
    if (!creation) return null;
    const choix = exportARefaire(listerExports(creationId), creation.formats, creation.version);
    if (!choix) return null;
    const r = lancerExport(creationId, choix.format, 'video', undefined, choix.reglages);
    if (!r.ok) {
      log.warn('studio : export après la voix finale non lancé', r.raison);
      return null;
    }
    return r.export;
  } catch (err) {
    log.warn('studio : export après la voix finale non lancé', err);
    return null;
  }
}

export function annulerExport(id: string): Resultat<{}> {
  const e = lireExport(id);
  if (!e) return { ok: false, raison: 'export introuvable' };
  if (e.etat !== 'en-file' && e.etat !== 'en-cours') return { ok: false, raison: 'cet export est déjà terminé' };
  arrets.get(id)?.abort();
  majExport(id, { etat: 'annule', erreur: 'annulé à la main' });
  return { ok: true };
}

async function fabriquer(
  exportId: string,
  creation: Creation,
  composition: Composition,
  format: FormatStudio,
  genre: 'video' | 'image',
  signal: AbortSignal,
  instant?: number,
  reglages: ReglagesExport = lireReglagesExport(undefined, format),
): Promise<void> {
  if (signal.aborted || lireExport(exportId)?.etat === 'annule') return;
  majExport(exportId, { etat: 'en-cours', progression: 0.02 });
  // LA DURÉE DU MARQUEUR BLEU : l'export coupe là, et le contrôle ffprobe l'attend. Le délai croît avec elle (aucune limite de durée).
  const duree = dureeExportee(composition);
  const { dossier, manquants } = preparerDossier(creation, composition, format, exportId);
  if (manquants.length) log.warn(`studio : export ${exportId}, médias absents : ${manquants.join(', ')}`);
  const sortie = path.join(dossier, genre === 'video' ? `export.${reglages.fichier}` : 'export');
  try {
    let fichier: string;
    if (genre === 'video') {
      let dernier = 0;
      const r = await hyperframes('render', [dossier, '-o', sortie, '--workers', '1', ...argumentsDeRendu(reglages, format)], {
        timeout: Math.max(5 * 60_000, duree * 20_000 * facteurDeDureeDeRendu(reglages)),
        signal,
        surLigne: (ligne) => {
          const m = /(\d{1,3})%\s+(.+)$/.exec(ligne);
          if (!m) return;
          const valeur = Math.min(0.95, Number(m[1]) / 100);
          if (valeur - dernier < 0.03 && valeur < 0.95) return;
          dernier = valeur;
          diffuserStudio(creation.projectId, creation.id, { exportId, valeur, etape: m[2]!.trim().slice(0, 60) });
        },
      });
      if (signal.aborted) return;
      if (!r.ok || !fs.existsSync(sortie)) throw new Error(r.delaiDepasse ? 'l’export a dépassé son temps et a été arrêté' : `le rendu a échoué : ${r.sortie.slice(-400)}`);
      // SANS LE SON : la piste audio est retirée du fichier rendu, l'image est recopiée telle quelle.
      let rendu = sortie;
      if (reglages.sansSon && fichierAvecSon(reglages.fichier)) {
        rendu = path.join(dossier, `export-muet.${reglages.fichier}`);
        await execFileAsync('ffmpeg', ['-v', 'error', '-y', '-i', sortie, '-map', '0', '-map', '-0:a', '-c', 'copy', rendu], { timeout: 120_000 });
      }
      // LE CONTRÔLE DE LECTURE : jamais un fichier vide ou coupé annoncé prêt.
      const lu = await lireFichierVideo(rendu);
      if (!lu.image) throw new Error('le fichier exporté n’a pas d’image');
      if (Math.abs(lu.duree - duree) > 0.5) throw new Error(`le fichier dure ${lu.duree.toFixed(2)} s au lieu de ${duree.toFixed(2)} s`);
      const sonAttendu = aDuSon(composition) && !reglages.sansSon && fichierAvecSon(reglages.fichier);
      if (sonAttendu && !lu.son) throw new Error('le fichier exporté a perdu son son');
      if (reglages.sansSon && lu.son) throw new Error('le fichier exporté garde un son alors qu’il devait être muet');
      fichier = rendu;
    } else {
      const t = Math.min(Math.max(0, instant ?? Math.min(1, duree / 2)), Math.max(0, duree - 0.05));
      const images = path.join(dossier, 'image');
      await hyperframes('snapshot', [dossier, '--at', t.toFixed(2), '--no-end', '--describe', 'false', '-o', images], { timeout: 120_000, signal });
      const png = fs.existsSync(images) ? fs.readdirSync(images).find((f) => f.endsWith('.png')) : undefined;
      if (!png) throw new Error('l’image n’a pas pu être prise');
      fichier = path.join(images, png);
      // EN JPG : la prise du moteur (PNG) est convertie, en haute qualité.
      if (reglages.image === 'jpg') {
        const jpg = path.join(dossier, 'image.jpg');
        await execFileAsync('ffmpeg', ['-v', 'error', '-y', '-i', fichier, '-q:v', '2', jpg], { timeout: 60_000 });
        if (!fs.existsSync(jpg)) throw new Error('l’image n’a pas pu être convertie en JPG');
        fichier = jpg;
      }
    }
    if (signal.aborted) return;
    const jointe = await joindreUnFichier({ projectId: creation.projectId, agentId: creation.agentId ?? '', fichier, nom: nomDExport(creation.titre, format, creation.version, genre, extensionDExport(genre, reglages)) });
    if (!jointe.ok) throw new Error(jointe.refus);
    // L'AFFICHE (image de couverture) : la première seconde, gardée à côté du MP4.
    let afficheId: string | undefined;
    if (genre === 'video') {
      try {
        const dossierAffiche = path.join(dossier, 'affiche');
        await hyperframes('snapshot', [dossier, '--at', Math.min(1, duree / 2).toFixed(2), '--no-end', '--describe', 'false', '-o', dossierAffiche], { timeout: 90_000 });
        const png = fs.readdirSync(dossierAffiche).find((f) => f.endsWith('.png'));
        if (png) {
          const a = await joindreUnFichier({ projectId: creation.projectId, agentId: creation.agentId ?? '', fichier: path.join(dossierAffiche, png), nom: nomDExport(creation.titre, format, creation.version, 'image').replace('.png', '-affiche.png') });
          if (a.ok) afficheId = a.attachment.id;
        }
      } catch (err: any) {
        log.warn('studio : affiche impossible', err?.message);
      }
    } else afficheId = jointe.attachment.id;
    majExport(exportId, {
      etat: 'pret',
      progression: 1,
      attachmentId: jointe.attachment.id,
      ...(afficheId ? { afficheId } : {}),
      ...(genre === 'video' ? { duree } : {}),
    });
    // Le média exporté se rattache au contenu Marketing d'où vient la création.
    if (creation.contenuMarketingId) bus.emit({ type: 'marketing', projectId: creation.projectId });
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
}

/** Au démarrage : un export resté « en cours » a été coupé par l'arrêt du démon — il le DIT. */
export function rattraperExportsCoupes(): void {
  for (const e of exportsEnAttente()) {
    majExport(e.id, { etat: 'echoue', erreur: 'coupé par un redémarrage du serveur : relancez l’export' });
  }
}
