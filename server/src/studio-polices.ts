import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FichierDePolice, FormatDePolice, PoliceDuProjet, SourceDePolice } from '@beluga/shared';
import { familleSure, policesDuProjet } from '@beluga/shared';
import { CONFIG } from './config.js';
import { assurerEspaceStudio, ecrireLesPolicesDuProjet } from './studio.js';
import * as store from './store.js';
import { log } from './logger.js';

/*
 * LA VRAIE POLICE DU PRODUIT DANS LE STUDIO (décision de l'utilisateur, 11/11/2026).
 *
 * Le Studio n'embarquait que sept polices : une création partie d'un modèle
 * prenait « la plus proche » de celle du produit, et le résultat trahissait
 * la marque. Désormais la police EXACTE s'importe, rangée dans l'identité du
 * projet (kit de marque, `polices`), et toutes ses créations s'en servent.
 *
 * L'ORDRE DE RECHERCHE est celui choisi par l'utilisateur :
 *   1. le CODE du projet (fichiers de police, paquets @fontsource) ;
 *   2. le SITE du projet (règles @font-face de ses feuilles de style) ;
 *   3. la BIBLIOTHÈQUE LIBRE (Google Fonts, par son nom — l'API css2 répond sans clé) ;
 *   4. sinon le directeur DEMANDE le fichier ; sans fichier seulement, la plus
 *      proche des embarquées, et il le dit.
 *
 * Les fichiers vivent sous `data/studio/polices/`, nommés par leur empreinte :
 * jamais versionnés, jamais publiés, servis à l'aperçu par une route publique
 * à nom imprévisible et copiés dans le dossier de rendu à l'export (HyperFrames
 * rend hors ligne : jamais une adresse distante dans la page).
 */

export const TAILLE_MAX_POLICE = 12 * 1024 * 1024;
const MAX_FICHIERS_PAR_POLICE = 40;
const AGENT_NAVIGATEUR =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export function dossierDesPolices(): string {
  return path.join(CONFIG.dataDir, 'studio', 'polices');
}

/** Le fichier d'une police du projet, s'il existe (nom contrôlé : aucune traversée possible). */
export function fichierDePoliceDuProjet(nom: string): string | null {
  if (!/^[a-f0-9]{16,64}\.(woff2|woff|ttf|otf)$/.test(nom)) return null;
  const plein = path.join(dossierDesPolices(), nom);
  return fs.existsSync(plein) ? plein : null;
}

export function typeMimeDePolice(nom: string): string {
  return nom.endsWith('.woff2') ? 'font/woff2' : nom.endsWith('.woff') ? 'font/woff' : nom.endsWith('.otf') ? 'font/otf' : 'font/ttf';
}

/** Le format d'un fichier de police, lu sur sa SIGNATURE — jamais sur son extension seule. */
export function formatDuContenu(contenu: Buffer): FormatDePolice | null {
  if (contenu.length < 12) return null;
  const tete = contenu.subarray(0, 4).toString('latin1');
  if (tete === 'wOF2') return 'woff2';
  if (tete === 'wOFF') return 'woff';
  if (tete === 'OTTO') return 'opentype';
  if (tete === 'true' || contenu.readUInt32BE(0) === 0x00010000) return 'truetype';
  return null;
}

const EXTENSION: Record<FormatDePolice, string> = { woff2: 'woff2', woff: 'woff', truetype: 'ttf', opentype: 'otf' };

/** Range un fichier de police sous son empreinte. Refuse ce qui n'est pas une police ou dépasse la taille. */
export function rangerFichierDePolice(contenu: Buffer): { ok: true; fichier: string; format: FormatDePolice } | { ok: false; raison: string } {
  if (contenu.length > TAILLE_MAX_POLICE) return { ok: false, raison: `fichier trop lourd (${Math.round(contenu.length / 1024 / 1024)} Mo, 12 Mo au plus)` };
  const format = formatDuContenu(contenu);
  if (!format) return { ok: false, raison: 'ce fichier n’est pas une police (woff2, woff, ttf ou otf)' };
  const sha = crypto.createHash('sha256').update(contenu).digest('hex').slice(0, 32);
  const fichier = `${sha}.${EXTENSION[format]}`;
  fs.mkdirSync(dossierDesPolices(), { recursive: true });
  const plein = path.join(dossierDesPolices(), fichier);
  if (!fs.existsSync(plein)) fs.writeFileSync(plein, contenu);
  return { ok: true, fichier, format };
}

/* ------------------------------------------------------------------ */
/* Graisse et style, lus sur un nom de fichier                          */
/* ------------------------------------------------------------------ */

const GRAISSES: Array<[RegExp, string]> = [
  [/hairline|thin/, '100'],
  [/extra-?light|ultra-?light/, '200'],
  [/semi-?bold|demi-?bold/, '600'],
  [/extra-?bold|ultra-?bold/, '800'],
  [/black|heavy/, '900'],
  [/light/, '300'],
  [/medium/, '500'],
  [/bold/, '700'],
];

export function graisseEtStyleDuNom(nom: string): { graisse: string; style: 'normal' | 'italic' } {
  const bas = path.basename(nom).toLowerCase();
  const style = /italic|oblique|-it\b/.test(bas) ? 'italic' : 'normal';
  if (/variable|\bvf\b|\[wght|-wght/.test(bas)) return { graisse: '100 900', style };
  const nombre = /(?:^|[-_.])([1-9]00)(?:[-_.]|$)/.exec(bas);
  if (nombre) return { graisse: nombre[1]!, style };
  for (const [motif, g] of GRAISSES) if (motif.test(bas)) return { graisse: g, style };
  return { graisse: '400', style };
}

/** « Plus Jakarta Sans » → « plusjakartasans » : la comparaison des noms ignore espaces, tirets et casse. */
export function nomCompact(famille: string): string {
  return famille
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/* ------------------------------------------------------------------ */
/* Lecture des @font-face d'une feuille de style                        */
/* ------------------------------------------------------------------ */

export interface FaceLue {
  famille: string;
  src: string;
  format: FormatDePolice | null;
  graisse: string;
  style: 'normal' | 'italic';
  plage?: string;
  /** Le commentaire qui précède (« latin », « cyrillic »… dans les feuilles de Google Fonts). */
  sousEnsemble?: string;
}

function formatDeLaSource(format: string | undefined, url: string): FormatDePolice | null {
  const f = (format ?? '').toLowerCase();
  if (f.includes('woff2') || /\.woff2(\?|#|$)/i.test(url)) return 'woff2';
  if (f.includes('woff') || /\.woff(\?|#|$)/i.test(url)) return 'woff';
  if (f.includes('opentype') || /\.otf(\?|#|$)/i.test(url)) return 'opentype';
  if (f.includes('truetype') || /\.ttf(\?|#|$)/i.test(url)) return 'truetype';
  return null;
}

const RANG_DU_FORMAT: Record<FormatDePolice, number> = { woff2: 0, woff: 1, opentype: 2, truetype: 3 };

/** Les @font-face d'une feuille de style, une par bloc (la meilleure source de chaque bloc). */
export function facesDeLaFeuille(css: string): FaceLue[] {
  const faces: FaceLue[] = [];
  const motif = /(?:\/\*\s*([\w-]+)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = motif.exec(css))) {
    const corps = m[2]!;
    const prop = (nom: string) => new RegExp(`(?:^|;|\\s)${nom}\\s*:\\s*([^;]+)`, 'i').exec(corps)?.[1]?.trim();
    const famille = (prop('font-family') ?? '').replace(/^["']|["']$/g, '').trim();
    const src = prop('src') ?? '';
    if (!famille || !src) continue;
    const sources = [...src.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)(?:\s*format\(\s*['"]?([^'")]+)['"]?\s*\))?/g)]
      .map((s) => ({ url: s[2]!, format: formatDeLaSource(s[3], s[2]!) }))
      .filter((s) => s.format && !s.url.startsWith('data:'));
    sources.sort((a, b) => RANG_DU_FORMAT[a.format!] - RANG_DU_FORMAT[b.format!]);
    const meilleure = sources[0];
    if (!meilleure) continue;
    const graisseBrute = (prop('font-weight') ?? '400').replace(/\s+/g, ' ');
    const graisse = /^\d{3}( \d{3})?$/.test(graisseBrute) ? graisseBrute : graisseBrute === 'bold' ? '700' : '400';
    const style = /italic|oblique/i.test(prop('font-style') ?? '') ? 'italic' : 'normal';
    const plage = prop('unicode-range');
    faces.push({ famille, src: meilleure.url, format: meilleure.format, graisse, style, ...(plage ? { plage } : {}), ...(m[1] ? { sousEnsemble: m[1] } : {}) });
  }
  return faces;
}

/* ------------------------------------------------------------------ */
/* Réseau                                                               */
/* ------------------------------------------------------------------ */

type Telecharger = (url: string, genre: 'texte' | 'binaire') => Promise<{ ok: boolean; statut: number; texte?: string; contenu?: Buffer }>;

let telecharger: Telecharger = async (url, genre) => {
  const controle = new AbortController();
  const minuterie = setTimeout(() => controle.abort(), 15_000);
  try {
    const r = await fetch(url, { headers: { 'user-agent': AGENT_NAVIGATEUR, accept: genre === 'texte' ? 'text/css,text/html,*/*' : '*/*' }, signal: controle.signal, redirect: 'follow' });
    if (!r.ok) return { ok: false, statut: r.status };
    if (genre === 'texte') return { ok: true, statut: r.status, texte: (await r.text()).slice(0, 3_000_000) };
    const contenu = Buffer.from(await r.arrayBuffer());
    return { ok: true, statut: r.status, contenu };
  } catch {
    return { ok: false, statut: 0 };
  } finally {
    clearTimeout(minuterie);
  }
};

/** Pour les tests seulement : un réseau simulé. */
export function remplacerLeTelechargement(fn: Telecharger): void {
  telecharger = fn;
}

/** « 200 » + « 800 » → « 200 800 » : la plage de graisses d'un même fichier variable. */
export function elargirLaGraisse(a: string, b: string): string {
  const nombres = [...a.split(' '), ...b.split(' ')].map(Number).filter((n) => n >= 1 && n <= 1000);
  if (!nombres.length) return a;
  const min = Math.min(...nombres);
  const max = Math.max(...nombres);
  return min === max ? String(min) : `${min} ${max}`;
}

/** Une même adresse se télécharge une fois : une police variable la cite pour chaque graisse. */
/** Télécharge les fichiers des faces retenues et les range. Rend les fichiers prêts (doublons écartés). */
async function rangerLesFaces(faces: FaceLue[], base: string): Promise<FichierDePolice[]> {
  const fichiers: FichierDePolice[] = [];
  const deja = new Map<string, Awaited<ReturnType<Telecharger>>>();
  for (const face of faces.slice(0, MAX_FICHIERS_PAR_POLICE)) {
    let adresse: string;
    try {
      adresse = new URL(face.src, base).toString();
    } catch {
      continue;
    }
    if (!/^https?:/.test(adresse)) continue;
    const r = deja.get(adresse) ?? (await telecharger(adresse, 'binaire'));
    deja.set(adresse, r);
    if (!r.ok || !r.contenu) continue;
    const range = rangerFichierDePolice(r.contenu);
    if (!range.ok) continue;
    /* UNE POLICE VARIABLE sert le MÊME fichier à toutes ses graisses : une seule déclaration, sa plage élargie. */
    const meme = fichiers.find((f) => f.fichier === range.fichier && f.style === face.style && (f.plage ?? '') === (face.plage ?? ''));
    if (meme) {
      meme.graisse = elargirLaGraisse(meme.graisse, face.graisse);
      continue;
    }
    fichiers.push({ fichier: range.fichier, graisse: face.graisse, style: face.style, format: range.format, ...(face.plage ? { plage: face.plage } : {}) });
  }
  return fichiers;
}

/* ------------------------------------------------------------------ */
/* 1. Le code du projet                                                 */
/* ------------------------------------------------------------------ */

const DOSSIERS_IGNORES = new Set(['.git', '.worktrees', '.next', '.nuxt', '.cache', 'coverage', 'tmp', '.turbo', 'vendor']);
const EXTENSIONS_DE_POLICE = /\.(woff2|woff|ttf|otf)$/i;

/** Les fichiers de police du dépôt dont le nom porte la famille, et ceux du paquet @fontsource de la famille. */
export function fichiersDuDepot(racine: string, famille: string): string[] {
  const cible = nomCompact(famille);
  if (!cible || !racine || !fs.existsSync(racine)) return [];
  const trouves: string[] = [];
  const fontsource = [`@fontsource/${famille.toLowerCase().replace(/\s+/g, '-')}`, `@fontsource-variable/${famille.toLowerCase().replace(/\s+/g, '-')}`];
  for (const paquet of fontsource) {
    const dossier = path.join(racine, 'node_modules', paquet, 'files');
    if (fs.existsSync(dossier)) {
      for (const nom of fs.readdirSync(dossier)) if (/latin-(\d00|wght)-(normal|italic)\.woff2$/.test(nom) && !/latin-ext/.test(nom)) trouves.push(path.join(dossier, nom));
      if (trouves.length) return trouves.slice(0, MAX_FICHIERS_PAR_POLICE);
    }
  }
  let visites = 0;
  const pile: Array<{ dossier: string; profondeur: number }> = [{ dossier: racine, profondeur: 0 }];
  while (pile.length && visites < 4000 && trouves.length < MAX_FICHIERS_PAR_POLICE * 2) {
    const { dossier, profondeur } = pile.pop()!;
    let entrees: fs.Dirent[];
    try {
      entrees = fs.readdirSync(dossier, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entrees) {
      visites++;
      if (e.isDirectory()) {
        if (profondeur < 7 && !DOSSIERS_IGNORES.has(e.name) && e.name !== 'node_modules' && !e.name.startsWith('.')) pile.push({ dossier: path.join(dossier, e.name), profondeur: profondeur + 1 });
      } else if (e.isFile() && EXTENSIONS_DE_POLICE.test(e.name) && nomCompact(e.name).startsWith(cible)) {
        trouves.push(path.join(dossier, e.name));
      }
    }
  }
  /* Un même dessin en plusieurs formats : le meilleur format par graisse et style. */
  const parCle = new Map<string, string>();
  const rang = (f: string) => RANG_DU_FORMAT[formatDeLaSource(undefined, f) ?? 'truetype'];
  for (const f of trouves) {
    const { graisse, style } = graisseEtStyleDuNom(f);
    const cle = `${graisse}|${style}`;
    const deja = parCle.get(cle);
    if (!deja || rang(f) < rang(deja)) parCle.set(cle, f);
  }
  return [...parCle.values()].slice(0, MAX_FICHIERS_PAR_POLICE);
}

function rangerDesFichiersLocaux(chemins: string[]): FichierDePolice[] {
  const fichiers: FichierDePolice[] = [];
  for (const chemin of chemins) {
    let contenu: Buffer;
    try {
      contenu = fs.readFileSync(chemin);
    } catch {
      continue;
    }
    const range = rangerFichierDePolice(contenu);
    if (!range.ok || fichiers.some((f) => f.fichier === range.fichier)) continue;
    fichiers.push({ fichier: range.fichier, format: range.format, ...graisseEtStyleDuNom(chemin) });
  }
  return fichiers;
}

/* ------------------------------------------------------------------ */
/* 2. Le site du projet                                                 */
/* ------------------------------------------------------------------ */

/** Les @font-face de la famille dans les feuilles de style d'une page (balises <style>, <link>, et un niveau d'@import). */
export async function facesDuSite(adresse: string, famille: string): Promise<{ faces: FaceLue[]; base: string }[]> {
  const page = await telecharger(adresse, 'texte');
  if (!page.ok || !page.texte) return [];
  const html = page.texte;
  const lots: { css: string; base: string }[] = [];
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) lots.push({ css: m[1]!, base: adresse });
  const liens = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map((m) => m[0])
    .filter((balise) => /rel\s*=\s*["']?[^"'>]*stylesheet/i.test(balise) || /as\s*=\s*["']?style/i.test(balise))
    .map((balise) => /href\s*=\s*["']([^"']+)["']/i.exec(balise)?.[1])
    .filter((h): h is string => !!h)
    .slice(0, 12);
  const feuilles = new Set<string>();
  for (const h of liens) {
    try {
      feuilles.add(new URL(h, adresse).toString());
    } catch {
      /* lien illisible */
    }
  }
  for (const feuille of feuilles) {
    const r = await telecharger(feuille, 'texte');
    if (!r.ok || !r.texte) continue;
    lots.push({ css: r.texte, base: feuille });
    for (const imp of [...r.texte.matchAll(/@import\s+(?:url\()?\s*['"]?([^'")\s;]+)/g)].slice(0, 4)) {
      try {
        const sous = new URL(imp[1]!, feuille).toString();
        const s = await telecharger(sous, 'texte');
        if (s.ok && s.texte) lots.push({ css: s.texte, base: sous });
      } catch {
        /* import illisible */
      }
    }
  }
  const cible = nomCompact(famille);
  return lots
    .map((l) => ({ faces: retenirLesFaces(facesDeLaFeuille(l.css).filter((f) => nomCompact(f.famille) === cible)), base: l.base }))
    .filter((l) => l.faces.length);
}

/** Des faces découpées par sous-ensembles (Google Fonts) : on garde le latin, et le latin étendu. */
export function retenirLesFaces(faces: FaceLue[]): FaceLue[] {
  if (!faces.some((f) => f.sousEnsemble)) return faces.slice(0, MAX_FICHIERS_PAR_POLICE);
  // Le latin d'abord (toutes graisses), puis le latin étendu (accents rares) s'il reste de la place.
  const latin = faces.filter((f) => !f.sousEnsemble || f.sousEnsemble === 'latin');
  const etendu = faces.filter((f) => f.sousEnsemble === 'latin-ext');
  return [...latin, ...(latin.length + etendu.length <= MAX_FICHIERS_PAR_POLICE ? etendu : [])].slice(0, MAX_FICHIERS_PAR_POLICE);
}

/* ------------------------------------------------------------------ */
/* 3. La bibliothèque libre                                             */
/* ------------------------------------------------------------------ */

export function adressesDeLaBibliotheque(famille: string): string[] {
  const nom = encodeURIComponent(familleSure(famille)).replace(/%20/g, '+');
  const base = `https://fonts.googleapis.com/css2?family=${nom}`;
  // L'adresse historique d'abord : elle TOLÈRE les graisses absentes (css2 refuse toute la demande pour une seule).
  const graisses = ['100', '200', '300', '400', '500', '600', '700', '800', '900'];
  const historique = `https://fonts.googleapis.com/css?family=${nom}:${[...graisses, ...graisses.map((g) => `${g}i`)].join(',')}&display=block`;
  return [
    historique,`${base}:ital,wght@0,100..900;1,100..900&display=block`, `${base}:wght@100..900&display=block`, `${base}:ital,wght@0,400;0,700;1,400;1,700&display=block`, `${base}:wght@400;700&display=block`, `${base}&display=block`];
}

async function facesDeLaBibliotheque(famille: string): Promise<{ faces: FaceLue[]; base: string } | null> {
  const cible = nomCompact(famille);
  for (const adresse of adressesDeLaBibliotheque(famille)) {
    const r = await telecharger(adresse, 'texte');
    if (!r.ok || !r.texte) continue;
    const faces = retenirLesFaces(facesDeLaFeuille(r.texte).filter((f) => nomCompact(f.famille) === cible));
    if (faces.length) return { faces, base: adresse };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* La chaîne entière                                                    */
/* ------------------------------------------------------------------ */

export interface ImportDePolice {
  ok: boolean;
  /** La police rangée dans le projet, quand elle a été trouvée. */
  police?: PoliceDuProjet;
  /** Ce qui a été essayé, dans l'ordre, en clair. */
  essais: string[];
}

/** Range une police dans le projet : une même famille est REMPLACÉE, jamais doublée. */
export function poserLaPoliceDuProjet(projectId: string, police: Omit<PoliceDuProjet, 'ajouteeLe'>, maintenant = Date.now()): PoliceDuProjet {
  const pose: PoliceDuProjet = { ...police, famille: familleSure(police.famille), ajouteeLe: maintenant };
  const autres = policesDuProjet(assurerEspaceStudio(projectId).kit).filter((p) => nomCompact(p.famille) !== nomCompact(pose.famille));
  ecrireLesPolicesDuProjet(projectId, [...autres, pose], maintenant);
  log.info(`studio : police « ${pose.famille} » rangée dans le projet ${projectId} (${pose.source}, ${pose.fichiers.length} fichier(s))`);
  return pose;
}

export function retirerLaPoliceDuProjet(projectId: string, famille: string): boolean {
  const avant = policesDuProjet(assurerEspaceStudio(projectId).kit);
  const apres = avant.filter((p) => nomCompact(p.famille) !== nomCompact(famille));
  if (apres.length === avant.length) return false;
  ecrireLesPolicesDuProjet(projectId, apres);
  return true;
}

/**
 * CHERCHER ET IMPORTER LA POLICE D'UN PRODUIT, dans l'ordre décidé : code du
 * projet, site, bibliothèque libre. Une police déjà rangée est rendue telle
 * quelle. Rien de trouvé : `ok: false`, et le directeur DEMANDE le fichier.
 */
export async function importerLaPoliceDuProduit(projectId: string, famille: string, options: { url?: string } = {}): Promise<ImportDePolice> {
  const nom = familleSure(famille);
  const essais: string[] = [];
  if (!nom) return { ok: false, essais: ['nom de police vide'] };
  const deja = policesDuProjet(assurerEspaceStudio(projectId).kit).find((p) => nomCompact(p.famille) === nomCompact(nom));
  if (deja) return { ok: true, police: deja, essais: ['déjà rangée dans le projet'] };

  const projet = store.getProject(projectId);
  const depot = projet?.path ?? '';
  const locaux = fichiersDuDepot(depot, nom);
  const duDepot = rangerDesFichiersLocaux(locaux);
  if (duDepot.length) {
    const police = poserLaPoliceDuProjet(projectId, { famille: nom, fichiers: duDepot, source: 'depot', origine: path.relative(depot, path.dirname(locaux[0]!)) || '.' });
    return { ok: true, police, essais: [`code du projet : ${duDepot.length} fichier(s)`] };
  }
  essais.push(depot ? 'code du projet : aucun fichier de cette police' : 'code du projet : dossier inconnu');

  const site = options.url && /^https?:\/\//.test(options.url) ? options.url : projet?.devUrl ?? '';
  if (site) {
    const lots = await facesDuSite(site, nom);
    for (const lot of lots) {
      const fichiers = await rangerLesFaces(lot.faces, lot.base);
      if (fichiers.length) {
        const google = /fonts\.(googleapis|gstatic)\.com/.test(lot.base);
        const police = poserLaPoliceDuProjet(projectId, { famille: nom, fichiers, source: google ? 'bibliotheque' : 'site', origine: lot.base });
        return { ok: true, police, essais: [...essais, `site ${site} : ${fichiers.length} fichier(s)`] };
      }
    }
    essais.push(`site ${site} : police non déclarée ou fichiers illisibles`);
  } else essais.push('site : aucune adresse connue');

  const biblio = await facesDeLaBibliotheque(nom);
  if (biblio) {
    const fichiers = await rangerLesFaces(biblio.faces, biblio.base);
    if (fichiers.length) {
      const police = poserLaPoliceDuProjet(projectId, { famille: nom, fichiers, source: 'bibliotheque', origine: 'Google Fonts (licence libre)' });
      return { ok: true, police, essais: [...essais, `bibliothèque libre : ${fichiers.length} fichier(s)`] };
    }
  }
  essais.push('bibliothèque libre : police absente');
  return { ok: false, essais };
}

/** Importer UN fichier donné (déposé par l'utilisateur, ou pièce jointe) sous une famille. Ajoute à la famille existante. */
export function importerUnFichierDePolice(
  projectId: string,
  entree: { famille: string; contenu: Buffer; nom?: string; source?: SourceDePolice; origine?: string },
): { ok: true; police: PoliceDuProjet } | { ok: false; raison: string } {
  const famille = familleSure(entree.famille);
  if (!famille) return { ok: false, raison: 'nom de police vide' };
  const range = rangerFichierDePolice(entree.contenu);
  if (!range.ok) return range;
  const existante = policesDuProjet(assurerEspaceStudio(projectId).kit).find((p) => nomCompact(p.famille) === nomCompact(famille));
  const fichier: FichierDePolice = { fichier: range.fichier, format: range.format, ...graisseEtStyleDuNom(entree.nom ?? '') };
  const fichiers = [...(existante?.fichiers ?? []).filter((f) => f.fichier !== range.fichier && !(f.graisse === fichier.graisse && f.style === fichier.style)), fichier];
  const police = poserLaPoliceDuProjet(projectId, {
    famille: existante?.famille ?? famille,
    fichiers: fichiers.slice(0, MAX_FICHIERS_PAR_POLICE),
    source: entree.source ?? 'fichier',
    ...(entree.origine ? { origine: entree.origine } : {}),
  });
  return { ok: true, police };
}

/** Le nom de famille d'un fichier déposé, deviné sur son nom (« Poppins-Bold.woff2 » → « Poppins »). */
export function familleDuNomDeFichier(nom: string): string {
  const base = path.basename(nom).replace(EXTENSIONS_DE_POLICE, '');
  const sansGraisse = base
    .replace(/[-_ ](variable|vf|italic|oblique|regular|normal|thin|hairline|extra-?light|ultra-?light|light|medium|semi-?bold|demi-?bold|extra-?bold|ultra-?bold|bold|black|heavy|\d00|wght|latin|ext)\b.*$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
  return familleSure(sansGraisse || base);
}

/** Copie les fichiers des polices du projet dans le dossier de rendu (même nom : la page les y lit). */
export function copierLesPolicesDuProjet(kit: Parameters<typeof policesDuProjet>[0], dossier: string): number {
  let n = 0;
  for (const p of policesDuProjet(kit))
    for (const f of p.fichiers) {
      const source = fichierDePoliceDuProjet(f.fichier);
      if (!source) continue;
      fs.copyFileSync(source, path.join(dossier, f.fichier));
      n++;
    }
  return n;
}
