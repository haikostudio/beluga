import fs from 'node:fs';
import path from 'node:path';
import {
  DOSSIERS_D_ICONES,
  EXTENSIONS_D_ICONE,
  meilleureIconeDuDepot,
  Project,
} from '@beluga/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { PATHS } from './config.js';
import { log } from './logger.js';

/**
 * Récupère l'icône de site d'un projet CÔTÉ SERVEUR, sur DEUX sources, dans
 * cet ordre :
 *
 *  1. son adresse de dev, quand il en a une — le navigateur, lui, y arrive
 *     rarement (mixte http/https, en-têtes bloquants) ; le démon lit la page
 *     d'accueil, y trouve l'icône DÉCLARÉE (balises `<link>`) et la télécharge ;
 *  2. son DÉPÔT, sinon — `public/favicon.svg`, `web/public/icon-192.png`,
 *     `favicon.ico` à la racine… Sans cette seconde source, les projets sans
 *     adresse inscrite (la grande majorité) ne cherchaient l'icône NULLE PART
 *     et gardaient leur rond aux initiales pour toujours.
 *
 * L'icône retenue est copiée dans `data/favicons` et servie par
 * `/api/favicon`. Le projet n'est modifié QUE sur un succès : une adresse
 * momentanément injoignable ne doit pas effacer une icône déjà trouvée, et
 * sans icône trouvée l'écran retombe sur les initiales — jamais une icône
 * cassée.
 */
const DELAI_MS = 8000;
const TAILLE_MAX = 2 * 1024 * 1024;

const EXTENSION_PAR_MIME: Record<string, string> = {
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
  'image/png': '.png',
  'image/svg+xml': '.svg',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

/** Une récupération par projet à la fois : évite les doublons en rafale. */
const enCours = new Set<string>();

function extraireCandidats(html: string, base: string): string[] {
  const candidats: { href: string; priorite: number }[] = [];
  const re = /<link\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const balise = m[0];
    const rel = /\brel\s*=\s*["']([^"']+)["']/i.exec(balise)?.[1]?.toLowerCase() ?? '';
    if (!rel.includes('icon')) continue;
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(balise)?.[1];
    if (!href) continue;
    const priorite = rel === 'icon' ? 0 : rel.includes('shortcut') ? 1 : rel.includes('mask') ? 3 : 2;
    try {
      candidats.push({ href: new URL(href, base).toString(), priorite });
    } catch {
      // adresse d'icône invalide : ignorée
    }
  }
  candidats.sort((a, b) => a.priorite - b.priorite);
  const vus = new Set<string>();
  const ordonnes: string[] = [];
  for (const c of candidats) {
    if (vus.has(c.href)) continue;
    vus.add(c.href);
    ordonnes.push(c.href);
  }
  try {
    ordonnes.push(new URL('/favicon.ico', base).toString());
  } catch {
    // origine invalide, déjà écarté plus haut
  }
  return ordonnes;
}

async function telecharger(url: string): Promise<{ data: Buffer; mime: string } | null> {
  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(DELAI_MS) });
    if (!res.ok) return null;
    const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > TAILLE_MAX) return null;
    if (mime && !mime.startsWith('image/')) return null;
    return { data: buf, mime };
  } catch {
    return null;
  }
}

function extensionPour(mime: string, url: string): string {
  if (EXTENSION_PAR_MIME[mime]) return EXTENSION_PAR_MIME[mime];
  const ext = path.extname(new URL(url).pathname).toLowerCase();
  return /^\.(ico|png|svg|jpg|jpeg|webp|gif)$/.test(ext) ? (ext === '.jpeg' ? '.jpg' : ext) : '.ico';
}

function retirerAnciensFichiers(projectId: string): void {
  if (!fs.existsSync(PATHS.favicons)) return;
  for (const nom of fs.readdirSync(PATHS.favicons)) {
    if (nom.startsWith(`${projectId}.`)) fs.rmSync(path.join(PATHS.favicons, nom), { force: true });
  }
}

/**
 * Retrouve sur le disque le dossier `relatif` (« web/public ») sous `racine`,
 * segment par segment et SANS tenir compte de la casse — le choix compare des
 * chemins en minuscules, un `Public/` doit donc compter comme `public/`.
 * Rend le chemin réel et sa forme relative telle qu'écrite sur le disque.
 */
function dossierReel(racine: string, relatif: string): { absolu: string; relatif: string } | null {
  let absolu = racine;
  const vus: string[] = [];
  for (const segment of relatif ? relatif.split('/') : []) {
    let noms: fs.Dirent[];
    try {
      noms = fs.readdirSync(absolu, { withFileTypes: true });
    } catch {
      return null;
    }
    const trouve =
      noms.find((n) => n.isDirectory() && n.name === segment) ??
      noms.find((n) => n.isDirectory() && n.name.toLowerCase() === segment);
    if (!trouve) return null;
    absolu = path.join(absolu, trouve.name);
    vus.push(trouve.name);
  }
  return { absolu, relatif: vus.join('/') };
}

/**
 * Les chemins RELATIFS des fichiers du dépôt qui pourraient être une icône.
 * On ne lit QUE les dossiers où un site range ses icônes (`DOSSIERS_D_ICONES`,
 * dans `shared`), chacun sans descendre : le choix n'accepte rien d'autre, et
 * un parcours de tout le dépôt plafonné à quelques milliers de fichiers
 * s'épuisait dans `data/` avant d'atteindre `web/public` (projet Beluga). Le
 * CHOIX, lui, appartient à `shared` (`meilleureIconeDuDepot`).
 */
export function fichiersCandidatsDuDepot(racine: string): string[] {
  const trouves: string[] = [];
  for (const voulu of DOSSIERS_D_ICONES) {
    const dossier = dossierReel(racine, voulu);
    if (!dossier) continue; // absent ou illisible : on passe au suivant
    let entrees: fs.Dirent[];
    try {
      entrees = fs.readdirSync(dossier.absolu, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entree of entrees) {
      if (!entree.isFile() || entree.name.startsWith('.')) continue;
      const ext = path.extname(entree.name).toLowerCase();
      if (!(EXTENSIONS_D_ICONE as readonly string[]).includes(ext)) continue;
      trouves.push(dossier.relatif ? `${dossier.relatif}/${entree.name}` : entree.name);
    }
  }
  return trouves;
}

/** L'icône que porte le DÉPÔT du projet, quand son adresse n'a rien donné. */
export function iconeDuDepot(project: Pick<Project, 'path'>): { data: Buffer; ext: string; source: string } | null {
  const racine = project.path?.trim();
  if (!racine || !fs.existsSync(racine)) return null;
  const choisi = meilleureIconeDuDepot(fichiersCandidatsDuDepot(racine));
  if (!choisi) return null;
  try {
    const data = fs.readFileSync(path.join(racine, choisi));
    if (data.length === 0 || data.length > TAILLE_MAX) return null;
    const ext = path.extname(choisi).toLowerCase();
    return { data, ext: ext === '.jpeg' ? '.jpg' : ext, source: choisi };
  } catch {
    return null;
  }
}

/** Lance la récupération pour un projet, sans bloquer l'appelant. */
export function recupererFaviconEnTache(project: Project): void {
  if (enCours.has(project.id)) return;
  enCours.add(project.id);
  recupererFavicon(project)
    .catch((err) => log.warn('récupération favicon échouée', project.id, err))
    .finally(() => enCours.delete(project.id));
}

/**
 * Range l'icône trouvée et l'annonce à l'interface. L'adresse servie porte un
 * horodatage qui ne change QUE si l'image a changé : sinon le navigateur
 * retéléchargerait la même image à chaque révision nocturne.
 */
function poserLIcone(project: Project, data: Buffer, ext: string, source: string): void {
  const ancien = fichierFavicon(project.id);
  const identique = ancien ? lireSansBruit(ancien.file)?.equals(data) === true : false;
  if (!identique) {
    fs.mkdirSync(PATHS.favicons, { recursive: true });
    retirerAnciensFichiers(project.id);
    fs.writeFileSync(path.join(PATHS.favicons, `${project.id}${ext}`), data);
  }
  const actuel = store.getProject(project.id);
  if (!actuel) return;
  const attendue = `/api/favicon?project=${project.id}`;
  if (identique && actuel.favicon?.startsWith(attendue)) return;
  const change = store.saveProject({ ...actuel, favicon: `${attendue}&t=${Date.now()}` });
  bus.emit({ type: 'project.upsert', project: change });
  log.info(`icône du projet ${actuel.name} retenue depuis ${source}`);
}

function lireSansBruit(fichier: string): Buffer | null {
  try {
    return fs.readFileSync(fichier);
  } catch {
    return null;
  }
}

async function recupererFavicon(project: Project): Promise<void> {
  const base = project.devUrl?.trim();
  if (base) {
    let html = '';
    try {
      const page = await fetch(base, { method: 'GET', signal: AbortSignal.timeout(DELAI_MS) });
      if (page.ok) html = await page.text();
    } catch {
      // page injoignable : on retombe sur /favicon.ico, puis sur le dépôt
    }
    for (const url of extraireCandidats(html, base)) {
      const trouve = await telecharger(url);
      if (!trouve) continue;
      poserLIcone(project, trouve.data, extensionPour(trouve.mime, url), url);
      return;
    }
  }

  // L'adresse n'a rien donné (ou il n'y en a pas) : le dépôt, lui, est là.
  const locale = iconeDuDepot(project);
  if (locale) {
    poserLIcone(project, locale.data, locale.ext, `le dépôt (${locale.source})`);
    return;
  }

  // Rien nulle part : une adresse enregistrée qui ne pointe plus vers rien ne
  // doit pas laisser une image cassée à l'écran — on rend la main aux initiales.
  const actuel = store.getProject(project.id);
  if (actuel?.favicon && !fichierFavicon(project.id)) {
    const change = store.saveProject({ ...actuel, favicon: undefined });
    bus.emit({ type: 'project.upsert', project: change });
  }
}

/**
 * Un projet a-t-il une icône RÉELLEMENT affichable ? Le champ du projet ne
 * suffit pas : le fichier peut avoir disparu (dossier `data` restauré,
 * ménage), et l'écran montrerait alors une image cassée.
 */
export function iconeManquante(project: Project): boolean {
  return !project.favicon || !fichierFavicon(project.id);
}

/**
 * Un rendez-vous toutes les demi-heures, pour TOUS les projets — qu'ils aient
 * déjà une icône ou pas. Un site déjà réussi peut changer de logo sans rien
 * signaler au démon (cas Haiko Studio) ; un projet encore sans icône peut voir
 * son site démarrer ou son dépôt recevoir un `favicon.svg` après coup. Les
 * deux cas méritaient le même rythme : avant, seul le second était repris
 * avant le lendemain — le premier attendait la révision nocturne, une fois
 * par jour, ce qui donnait l'impression qu'un nouveau logo n'arrivait jamais.
 *
 * `poserLIcone` ne réécrit ni ne notifie rien quand l'icône relue est
 * identique à celle déjà enregistrée : revoir tous les projets plus souvent
 * ne produit donc pas de bruit supplémentaire, seulement des recherches. Un
 * échec sur un projet (site tombé, dépôt sans icône) laisse son icône
 * précédente intacte — voir `recupererFavicon`.
 */
export function planifierRevisionFavicons(): NodeJS.Timeout {
  let battements = 0;
  return setInterval(
    () => {
      if (++battements % 6 !== 0) return;
      for (const projet of store.listProjects(true)) recupererFaviconEnTache(projet);
    },
    5 * 60 * 1000,
  );
}

/** Le fichier d'icône stocké pour un projet, s'il en a un. */
export function fichierFavicon(projectId: string): { file: string; mime: string } | null {
  if (!fs.existsSync(PATHS.favicons)) return null;
  const nom = fs.readdirSync(PATHS.favicons).find((n) => n.startsWith(`${projectId}.`));
  if (!nom) return null;
  const ext = path.extname(nom).toLowerCase();
  const mime =
    Object.entries(EXTENSION_PAR_MIME).find(([, e]) => e === ext)?.[0] ??
    (ext === '.ico' ? 'image/x-icon' : 'application/octet-stream');
  return { file: path.join(PATHS.favicons, nom), mime };
}
