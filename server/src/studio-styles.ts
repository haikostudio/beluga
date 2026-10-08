import fs from 'node:fs';
import path from 'node:path';
import {
  CATEGORIES_DE_STYLES,
  ID_STYLE,
  adresseMediaAcceptable,
  categoriesDuStyle,
  type CategorieDeStyle,
  type EtatSourceDeStyles,
  type RecetteDeSource,
} from '@beluga/shared';
import { CONFIG } from './config.js';
import { getDb } from './db.js';
import { bus } from './bus.js';
import { log } from './logger.js';

/**
 * LE CATALOGUE DE STYLES DU STUDIO — des directions de mise en scène tirées de
 * SOURCES (des sites), l'auteur de chaque consigne crédité. Ce ne sont PAS des
 * animations : des consignes écrites, avec un titre et une phrase en français,
 * des catégories, et une vignette.
 *
 *  - Le catalogue vit EN BASE (`studio_styles`, `studio_sources_styles`) : une
 *    source ajoutée par l'utilisateur, ou une nouveauté trouvée la nuit, y
 *    entre sans mise à jour de l'application (`studio-sources.ts`). Le fichier
 *    versionné `outils/studio-styles/catalogue.json` n'est plus que la GRAINE :
 *    il sème la base au premier usage (mêmes identifiants), et ses deux sources
 *    de départ — la collection libre « awesome-opus5-5-videos » (licence MIT) et
 *    la galerie prompt-motion.com — y reçoivent leur recette de nuit.
 *  - Les vignettes se téléchargent à la PREMIÈRE demande puis restent dans
 *    `data/studio/styles/` : l'aperçu animé — WebP ou VIDÉO mp4 (servie par
 *    plages pour Safari) — ou l'image fixe. Servies par le démon, même origine :
 *    aucun appel extérieur depuis l'écran. Seules les adresses https d'une
 *    source VALIDÉE sont téléchargées, jamais une adresse locale. Source
 *    muette : une image neutre, jamais une erreur.
 *  - L'agent du Studio les lit par l'action « styles » (chercher, lire) :
 *    RIEN n'est injecté d'office dans sa consigne (coût en jetons).
 */

export interface StyleStudio {
  id: string;
  titre: string;
  phrase: string;
  motsCles: string[];
  genre: 'motion' | 'explication';
  /** Les catégories de la liste fixe (une à quatre). */
  categories: string[];
  consigne: string;
  auteur: string;
  auteurUrl?: string;
  lien?: string;
  /** L'id de sa source. */
  source: string;
  /** La fiche du style sur sa galerie d'origine. */
  fiche?: string;
  /** Un aperçu animé WebP existe. */
  apercuAnime: boolean;
  /** Son adresse. */
  animeUrl?: string;
  /** Un aperçu animé VIDÉO (mp4). */
  apercuVideo?: string;
  affiche?: string;
  ajouteLe: number;
  /** Jusqu'à quand la carte porte la marque « Nouveau ». */
  nouveauJusqua?: number;
}

export interface SourceDeStyles {
  id: string;
  adresse: string;
  nom: string;
  licence: string;
  etat: EtatSourceDeStyles;
  recette?: RecetteDeSource;
  resume?: string;
  nbTrouves?: number;
  derniereAnalyse?: number;
  dernierPassage?: number;
  nbNouveaux: number;
  erreur?: string;
  agentId?: string;
  cardId?: string;
  projectId?: string;
  creeLe: number;
  /** L'annuaire où l'agent a trouvé cette source. */
  trouveeDans?: string;
  /** Lue par le vrai navigateur où la vérification anti-robot a été passée. */
  parNavigateur?: boolean;
  /** Quand la cloche a dit pour la dernière fois que la vérification est à refaire. */
  alerteVerification?: number;
}

interface Catalogue {
  sources: SourceDeStyles[];
  styles: StyleStudio[];
}

export const SOURCE_AWESOME = 'awesome-opus5-5-videos';
export const SOURCE_PROMPT_MOTION = 'prompt-motion';

/**
 * LES RECETTES DES DEUX SOURCES DE DÉPART, tirées des anciens scripts
 * d'import (`scripts/importer-styles-*.mjs`) : la liste JSON de la collection,
 * et les données de rendu de prompt-motion avec la consigne lue sur la fiche.
 */
export const RECETTES_DE_DEPART: Record<string, RecetteDeSource> = {
  [SOURCE_AWESOME]: {
    liste: { url: 'https://raw.githubusercontent.com/yihui-dev/awesome-opus5-5-videos/main/data/videos.json', format: 'json' },
    champs: {
      id: 'slug',
      auteur: 'author',
      auteurUrl: 'author_url',
      lien: 'post_url',
      consigne: 'prompt',
      affiche: 'poster_url',
      anime: 'https://media.skillry.dev/opus-5-5/{slug}/preview.webp',
      categorie: 'category',
    },
    garder: { consigneMin: 400, champ: 'category', valeurs: ['motion', 'explainer', '3d'] },
  },
  [SOURCE_PROMPT_MOTION]: {
    liste: { url: 'https://www.prompt-motion.com/', format: 'html', objets: '{"slug":"', desechapper: true },
    champs: { id: 'slug', titre: 'title', auteur: 'handle', affiche: 'poster', video: 'preview' },
    fiche: {
      url: 'https://www.prompt-motion.com/{slug}',
      consigne: { apres: 'id="entry-prompt"', debut: '>', fin: '</div>', texte: true },
      lien: { debut: 'href="https://x.com/', fin: '"', prefixe: 'https://x.com/' },
    },
  },
};

const FICHIER_GRAINE = () => path.join(CONFIG.selfPath, 'outils', 'studio-styles', 'catalogue.json');
const DOSSIER_VIGNETTES = () => path.join(CONFIG.dataDir, 'studio', 'styles');
/** Le serveur d'images refuse les clients sans nom de navigateur (403). */
export const AGENT_HTTP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 BelugaStudio/1.0';

/* ------------------------------------------------------------------ */
/* La graine                                                           */
/* ------------------------------------------------------------------ */

let graineSemee: number | null = null;

/**
 * SEMER LA BASE DEPUIS LE FICHIER VERSIONNÉ — rejoué quand le fichier change
 * (une mise à jour de l'application), jamais destructeur : un style déjà là
 * garde ses textes ; il ne reçoit que des catégories s'il n'en avait pas.
 */
function semerDepuisLaGraine(): void {
  const fichier = FICHIER_GRAINE();
  let mtime = 0;
  try {
    mtime = fs.statSync(fichier).mtimeMs;
  } catch {
    mtime = -1;
  }
  if (graineSemee === mtime) return;
  graineSemee = mtime;
  if (mtime < 0) return;
  let lu: any;
  try {
    lu = JSON.parse(fs.readFileSync(fichier, 'utf8'));
  } catch (err: any) {
    log.warn('studio : graine du catalogue de styles illisible', err?.message);
    return;
  }
  const db = getDb();
  const maintenant = Date.now();
  const connues = new Set(CATEGORIES_DE_STYLES.map((c) => c.id));
  const ajouterSource = db.prepare(
    `INSERT OR IGNORE INTO studio_sources_styles (id, adresse, nom, licence, etat, recette, nb_trouves, derniere_analyse, cree_le, maj_le)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
  );
  const ajouterStyle = db.prepare(
    `INSERT OR IGNORE INTO studio_styles (id, source_id, id_origine, etat, rang, titre, phrase, mots_cles, genre, categories, consigne, categorie_origine,
       auteur, auteur_url, lien, fiche, affiche, video, anime, ajoute_le)
     VALUES (?, ?, ?, 'visible', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const completer = db.prepare(`UPDATE studio_styles SET categories = ? WHERE id = ? AND categories = '[]'`);
  const styles: any[] = Array.isArray(lu.styles) ? lu.styles : [];
  db.transaction(() => {
    for (const s of lu.sources ?? []) {
      const nb = styles.filter((x) => (x.source ?? SOURCE_AWESOME) === s.id).length;
      const importe = Date.parse(s.importeLe ?? '') || maintenant;
      ajouterSource.run(s.id, s.adresse, s.id === SOURCE_PROMPT_MOTION ? 'prompt-motion.com' : s.id, s.licence ?? '', RECETTES_DE_DEPART[s.id] ? JSON.stringify(RECETTES_DE_DEPART[s.id]) : null, nb, importe, maintenant, maintenant);
    }
    styles.forEach((s, rang) => {
      if (!ID_STYLE.test(String(s.id))) return;
      const categories = JSON.stringify(categoriesDuStyle(s.categories, connues));
      ajouterStyle.run(
        s.id,
        s.source ?? SOURCE_AWESOME,
        s.id,
        rang,
        s.titre ?? '',
        s.phrase ?? '',
        JSON.stringify(s.motsCles ?? []),
        s.genre === 'explication' ? 'explication' : 'motion',
        categories,
        s.consigne ?? '',
        s.categorie ?? null,
        s.auteur ?? '',
        s.auteurUrl ?? null,
        s.lien ?? null,
        s.fiche ?? null,
        s.affiche ?? null,
        s.apercuVideo ?? null,
        s.apercuAnime ? `https://media.skillry.dev/opus-5-5/${s.id}/preview.webp` : null,
        maintenant,
      );
      completer.run(categories, s.id);
    });
  })();
  cache = null;
}

/* ------------------------------------------------------------------ */
/* Lecture                                                             */
/* ------------------------------------------------------------------ */

interface LigneStyle {
  id: string;
  source_id: string;
  titre: string;
  phrase: string;
  mots_cles: string;
  genre: string;
  categories: string;
  consigne: string;
  auteur: string;
  auteur_url: string | null;
  lien: string | null;
  fiche: string | null;
  affiche: string | null;
  video: string | null;
  anime: string | null;
  ajoute_le: number;
  nouveau_jusqua: number | null;
}

interface LigneSource {
  id: string;
  adresse: string;
  nom: string;
  licence: string | null;
  etat: string;
  recette: string | null;
  resume: string | null;
  nb_trouves: number | null;
  derniere_analyse: number | null;
  dernier_passage: number | null;
  nb_nouveaux: number;
  erreur: string | null;
  agent_id: string | null;
  card_id: string | null;
  project_id: string | null;
  cree_le: number;
  trouvee_dans?: string | null;
  par_navigateur?: number | null;
  alerte_verification?: number | null;
}

const json = <T>(t: string | null | undefined, defaut: T): T => {
  try {
    return t ? (JSON.parse(t) as T) : defaut;
  } catch {
    return defaut;
  }
};

export function styleDeLaLigne(l: LigneStyle): StyleStudio {
  return {
    id: l.id,
    titre: l.titre,
    phrase: l.phrase,
    motsCles: json<string[]>(l.mots_cles, []),
    genre: l.genre === 'explication' ? 'explication' : 'motion',
    categories: json<string[]>(l.categories, []),
    consigne: l.consigne,
    auteur: l.auteur,
    ...(l.auteur_url ? { auteurUrl: l.auteur_url } : {}),
    ...(l.lien ? { lien: l.lien } : {}),
    source: l.source_id,
    ...(l.fiche ? { fiche: l.fiche } : {}),
    apercuAnime: !!l.anime,
    ...(l.anime ? { animeUrl: l.anime } : {}),
    ...(l.video ? { apercuVideo: l.video } : {}),
    ...(l.affiche ? { affiche: l.affiche } : {}),
    ajouteLe: l.ajoute_le,
    ...(l.nouveau_jusqua ? { nouveauJusqua: l.nouveau_jusqua } : {}),
  };
}

export function sourceDeLaLigne(l: LigneSource): SourceDeStyles {
  return {
    id: l.id,
    adresse: l.adresse,
    nom: l.nom,
    licence: l.licence ?? '',
    etat: l.etat as EtatSourceDeStyles,
    ...(l.recette ? { recette: json<RecetteDeSource | undefined>(l.recette, undefined) } : {}),
    ...(l.resume ? { resume: l.resume } : {}),
    ...(l.nb_trouves != null ? { nbTrouves: l.nb_trouves } : {}),
    ...(l.derniere_analyse ? { derniereAnalyse: l.derniere_analyse } : {}),
    ...(l.dernier_passage ? { dernierPassage: l.dernier_passage } : {}),
    nbNouveaux: l.nb_nouveaux,
    ...(l.erreur ? { erreur: l.erreur } : {}),
    ...(l.agent_id ? { agentId: l.agent_id } : {}),
    ...(l.card_id ? { cardId: l.card_id } : {}),
    ...(l.project_id ? { projectId: l.project_id } : {}),
    ...(l.trouvee_dans ? { trouveeDans: l.trouvee_dans } : {}),
    ...(l.par_navigateur ? { parNavigateur: true } : {}),
    ...(l.alerte_verification ? { alerteVerification: l.alerte_verification } : {}),
    creeLe: l.cree_le,
  };
}

let cache: Catalogue | null = null;

/** LA BIBLIOTHÈQUE A CHANGÉ : le cache tombe, et la galerie ouverte se relit (sans relire aucune création). */
export function catalogueModifie(): void {
  cache = null;
  bus.emit({ type: 'studio', projectId: '*', creationId: 'bibliotheque' });
}

/** Les styles MONTRÉS (rédigés) et toutes les sources. */
export function catalogueDesStyles(): Catalogue {
  semerDepuisLaGraine();
  if (cache) return cache;
  try {
    const db = getDb();
    const styles = (db.prepare(`SELECT * FROM studio_styles WHERE etat = 'visible' ORDER BY rang, ajoute_le`).all() as LigneStyle[]).map(styleDeLaLigne);
    const sources = (db.prepare('SELECT * FROM studio_sources_styles ORDER BY cree_le, id').all() as LigneSource[]).map(sourceDeLaLigne);
    cache = { sources, styles };
    return cache;
  } catch (err: any) {
    log.warn('studio : catalogue de styles illisible', err?.message);
    return { sources: [], styles: [] };
  }
}

export function lireStyle(id: string): StyleStudio | null {
  return catalogueDesStyles().styles.find((s) => s.id === id) ?? null;
}

export function lireSource(id: string): SourceDeStyles | null {
  return catalogueDesStyles().sources.find((s) => s.id === id) ?? null;
}

/** La liste fixe, suivie des rares catégories ajoutées par l'agent. */
export function categoriesDeLaBibliotheque(): CategorieDeStyle[] {
  let ajoutees: CategorieDeStyle[] = [];
  try {
    ajoutees = getDb().prepare('SELECT id, libelle FROM studio_categories_ajoutees ORDER BY cree_le').all() as CategorieDeStyle[];
  } catch {
    ajoutees = [];
  }
  return [...CATEGORIES_DE_STYLES, ...ajoutees.filter((a) => !CATEGORIES_DE_STYLES.some((c) => c.id === a.id))];
}

/** Le style a-t-il un aperçu qui bouge (WebP ou vidéo) ? */
const bouge = (s: StyleStudio) => s.apercuAnime || !!s.apercuVideo;
/** La vidéo ne sert que si aucun WebP animé n'existe (l'image animée reste le chemin éprouvé). */
const parVideo = (s: StyleStudio) => !s.apercuAnime && !!s.apercuVideo;

/**
 * Ce que la galerie « Bibliothèque » montre : ni la consigne entière, ni les
 * adresses d'origine (le premier envoi ne porte que l'utile — la fenêtre
 * d'aperçu les demande à l'ouverture, `detailDuStyle`). `apercuAnime` y dit
 * « ça bouge », `video` comment le montrer, `nouveau` la marque.
 */
export function stylesPourLaGalerie(maintenant = Date.now()) {
  return catalogueDesStyles().styles.map((s) => ({
    id: s.id,
    titre: s.titre,
    phrase: s.phrase,
    motsCles: s.motsCles,
    genre: s.genre,
    categories: s.categories,
    auteur: s.auteur,
    source: s.source,
    apercuAnime: bouge(s),
    video: parVideo(s),
    ...(s.nouveauJusqua && s.nouveauJusqua > maintenant ? { nouveau: true } : {}),
  }));
}

/** Ce que la fenêtre d'aperçu agrandi ajoute : la consigne (début), les liens, le crédit. */
export function detailDuStyle(id: string) {
  const s = lireStyle(id);
  if (!s) return null;
  return {
    id: s.id,
    consigne: s.consigne.length > 1500 ? `${s.consigne.slice(0, 1500)}…` : s.consigne,
    ...(s.auteurUrl ? { auteurUrl: s.auteurUrl } : {}),
    ...(s.lien ? { lien: s.lien } : {}),
    ...(s.fiche ? { fiche: s.fiche } : {}),
    credit: creditDuStyle(s),
    sourceNom: lireSource(s.source)?.nom ?? s.source,
  };
}

/** D'où vient un style, pour le créditer (agent, galerie). */
export function creditDuStyle(style: StyleStudio): string {
  if (style.source === SOURCE_AWESOME) return 'licence MIT, collection awesome-opus5-5-videos';
  if (style.source === SOURCE_PROMPT_MOTION) return `galerie prompt-motion.com — vidéo et consigne appartiennent à leur auteur${style.lien ? ` (${style.lien})` : ''}`;
  const source = lireSource(style.source);
  const licence = source?.licence?.trim() || 'conditions du site d’origine — la consigne appartient à son auteur';
  return `${source?.nom ?? style.source} — ${licence}${style.lien ? ` (${style.lien})` : ''}`;
}

function normaliser(t: string): string {
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * CHERCHER DES STYLES pour l'agent : des mots (ambiance, sujet, rythme), cinq à
 * huit styles COURTS en retour (id, titre, phrase). Le titre, les mots-clés et
 * les catégories comptent plus que la consigne d'origine.
 */
export function chercherStyles(demande: string, nombre = 6): Pick<StyleStudio, 'id' | 'titre' | 'phrase' | 'genre'>[] {
  const mots = normaliser(demande)
    .split(' ')
    .filter((m) => m.length > 2);
  const libelles = new Map(categoriesDeLaBibliotheque().map((c) => [c.id, c.libelle]));
  const styles = catalogueDesStyles().styles;
  const notes = styles.map((s, rang) => {
    const tete = normaliser(`${s.titre} ${s.motsCles.join(' ')} ${s.categories.map((c) => libelles.get(c) ?? c).join(' ')}`);
    const corps = normaliser(`${s.phrase} ${s.consigne.slice(0, 1500)}`);
    let note = 0;
    for (const m of mots) {
      if (tete.includes(m)) note += 3;
      else if (corps.includes(m)) note += 1;
    }
    // À égalité, les styles à vraie direction (longue consigne) et à aperçu animé passent devant.
    return { s, note: note + (s.consigne.length >= 400 ? 0.3 : 0) + (bouge(s) ? 0.2 : 0) - rang / 10_000 };
  });
  return notes
    .filter((n) => !mots.length || n.note >= 1)
    .sort((a, b) => b.note - a.note)
    .slice(0, Math.max(1, Math.min(8, nombre)))
    .map(({ s }) => ({ id: s.id, titre: s.titre, phrase: s.phrase, genre: s.genre }));
}

/* ------------------------------------------------------------------ */
/* Vignettes                                                           */
/* ------------------------------------------------------------------ */

/** Une image neutre : un style dont la vignette ne vient pas reste montrable. */
const IMAGE_NEUTRE = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 200"><rect width="160" height="200" fill="#1d2440"/><circle cx="80" cy="92" r="26" fill="none" stroke="#5b8cff" stroke-width="6"/><path d="M72 80 l22 12 -22 12z" fill="#5b8cff"/></svg>`,
);

/** Une source dont les médias se téléchargent : validée un jour (jamais en analyse ni à valider). */
function sourceValidee(id: string): boolean {
  const etat = lireSource(id)?.etat;
  return !!etat && etat !== 'analyse' && etat !== 'a_valider';
}

/**
 * UN APPEL VERS LE DEHORS, redirections suivies À LA MAIN (trois au plus) : une
 * adresse acceptée qui renverrait vers la machine elle-même est refusée à
 * chaque saut.
 */
export async function appelExterieur(adresse: string, delaiMs: number): Promise<Response> {
  let url = adresse;
  for (let saut = 0; saut < 4; saut++) {
    if (!adresseMediaAcceptable(url)) throw new Error(`adresse refusée : ${url}`);
    const r = await fetch(url, { headers: { 'user-agent': AGENT_HTTP, accept: '*/*' }, redirect: 'manual', signal: AbortSignal.timeout(delaiMs) });
    const suite = r.status >= 300 && r.status < 400 ? r.headers.get('location') : null;
    if (!suite) return r;
    url = new URL(suite, url).toString();
  }
  throw new Error('trop de redirections');
}

/** Deux téléchargements simultanés d'un même fichier n'en font qu'un. */
const enCours = new Map<string, Promise<void>>();

/**
 * LA VIGNETTE D'UN STYLE : l'aperçu animé s'il existe et qu'on le veut (WebP,
 * sinon vidéo mp4), sinon l'image fixe. Téléchargée une fois, gardée, puis
 * servie depuis le disque. Une vidéo est rendue par CHEMIN : la route la sert
 * par plages (Range), sans quoi Safari ne la lit pas.
 */
export async function vignetteDuStyle(id: string, anime: boolean): Promise<{ type: string; corps: Buffer | string }> {
  const neutre = { type: 'image/svg+xml', corps: IMAGE_NEUTRE };
  if (!ID_STYLE.test(id)) return neutre;
  const style = lireStyle(id);
  if (!style) return neutre;
  const voulue = anime && style.apercuAnime ? 'anime' : anime && style.apercuVideo ? 'video' : 'fixe';
  const [type, fichier, adresse] =
    voulue === 'video'
      ? ['video/mp4', path.join(DOSSIER_VIGNETTES(), `${id}-anime.mp4`), style.apercuVideo]
      : ['image/webp', path.join(DOSSIER_VIGNETTES(), `${id}-${voulue}.webp`), voulue === 'anime' ? style.animeUrl : style.affiche];
  if (fs.existsSync(fichier)) return { type, corps: fichier };
  if (!adresse || !adresseMediaAcceptable(adresse) || !sourceValidee(style.source)) return voulue === 'fixe' ? neutre : vignetteDuStyle(id, false);
  try {
    let telechargement = enCours.get(fichier);
    if (!telechargement) {
      telechargement = (async () => {
        const r = await appelExterieur(adresse, 30_000);
        const recu = r.headers.get('content-type') ?? '';
        if (!r.ok || !(voulue === 'video' ? /^video\/mp4/ : /^image\//).test(recu)) throw new Error(`réponse ${r.status} ${recu}`);
        const annonce = Number(r.headers.get('content-length') ?? 0);
        if (annonce > 8_000_000) throw new Error('vignette trop lourde');
        const octets = Buffer.from(await r.arrayBuffer());
        if (octets.length > 8_000_000) throw new Error('vignette trop lourde');
        fs.mkdirSync(DOSSIER_VIGNETTES(), { recursive: true });
        fs.writeFileSync(`${fichier}.tmp`, octets);
        fs.renameSync(`${fichier}.tmp`, fichier);
      })().finally(() => enCours.delete(fichier));
      enCours.set(fichier, telechargement);
    }
    await telechargement;
    return { type, corps: fichier };
  } catch (err: any) {
    log.info('studio : vignette de style indisponible', id, err?.message);
    // L'aperçu animé manque : l'image fixe prend le relais.
    return voulue === 'fixe' ? neutre : vignetteDuStyle(id, false);
  }
}
