import fs from 'node:fs';
import path from 'node:path';
import { Project } from '@haikodev/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { PATHS } from './config.js';
import { log } from './logger.js';

/**
 * Récupère l'icône de site d'un projet CÔTÉ SERVEUR, sur son adresse de dev :
 * le navigateur y arrive rarement (mixte http/https, en-têtes bloquants). Le
 * démon lit la page d'accueil, y trouve l'icône DÉCLARÉE (balises `<link>`),
 * la télécharge et la garde sur disque — servie ensuite par `/api/favicon`.
 *
 * Ne modifie le projet QUE sur un succès : une adresse momentanément
 * injoignable ne doit pas effacer une icône déjà trouvée, et sans icône
 * trouvée l'écran retombe sur les initiales — jamais une icône cassée.
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

/** Lance la récupération pour un projet, sans bloquer l'appelant. */
export function recupererFaviconEnTache(project: Project): void {
  if (!project.devUrl?.trim() || enCours.has(project.id)) return;
  enCours.add(project.id);
  recupererFavicon(project)
    .catch((err) => log.warn('récupération favicon échouée', project.id, err))
    .finally(() => enCours.delete(project.id));
}

async function recupererFavicon(project: Project): Promise<void> {
  const base = project.devUrl!.trim();
  let html = '';
  try {
    const page = await fetch(base, { method: 'GET', signal: AbortSignal.timeout(DELAI_MS) });
    if (page.ok) html = await page.text();
  } catch {
    // page injoignable : on retombe sur /favicon.ico ci-dessous
  }
  const candidats = extraireCandidats(html, base);
  for (const url of candidats) {
    const trouve = await telecharger(url);
    if (!trouve) continue;
    const ext = extensionPour(trouve.mime, url);
    fs.mkdirSync(PATHS.favicons, { recursive: true });
    retirerAnciensFichiers(project.id);
    fs.writeFileSync(path.join(PATHS.favicons, `${project.id}${ext}`), trouve.data);
    const actuel = store.getProject(project.id);
    if (!actuel) return;
    const nouvelleValeur = `/api/favicon?project=${project.id}&t=${Date.now()}`;
    if (actuel.favicon?.split('&t=')[0] === nouvelleValeur.split('&t=')[0] && actuel.favicon) return;
    const change = store.saveProject({ ...actuel, favicon: nouvelleValeur });
    bus.emit({ type: 'project.upsert', project: change });
    return;
  }
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
