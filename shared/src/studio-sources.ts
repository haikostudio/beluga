/**
 * LA BIBLIOTHÈQUE DE STYLES DU STUDIO — ses CATÉGORIES et ses SOURCES, en règles
 * pures (sans base, sans réseau).
 *
 *  - Les CATÉGORIES sont une liste FIXE, appliquée par l'agent : un style en
 *    porte une à quatre. L'agent n'en crée une nouvelle qu'en dernier recours
 *    (`idDeCategorieNeuve`), et l'écran filtre en OU (`styleDansLesCategories`).
 *  - Une SOURCE est un site d'où viennent des styles. L'agent d'analyse écrit sa
 *    RECETTE D'EXTRACTION — DÉCLARATIVE, jamais du code ni une expression
 *    régulière (une expression écrite par un modèle peut figer le démon) : une
 *    liste JSON ou HTML, des chemins vers les champs, et au besoin une fiche par
 *    entrée lue entre deux repères. Le démon la rejoue seul chaque nuit
 *    (MEM-2723) : `jugerRecetteSource` la refuse avant qu'elle ne tourne.
 */

/* ------------------------------------------------------------------ */
/* Catégories                                                          */
/* ------------------------------------------------------------------ */

export interface CategorieDeStyle {
  id: string;
  libelle: string;
}

/** LA LISTE FIXE. L'ordre est celui de l'écran ; un id ne se renomme jamais. */
export const CATEGORIES_DE_STYLES: readonly CategorieDeStyle[] = [
  { id: 'lancement', libelle: 'Lancement de produit' },
  { id: 'bande-demo', libelle: 'Bande démo' },
  { id: 'explication', libelle: 'Explication' },
  { id: 'typographie', libelle: 'Typographie animée' },
  { id: '3d', libelle: '3D' },
  { id: 'interface', libelle: 'Interface d’application' },
  { id: 'site-web', libelle: 'Site web présenté' },
  { id: 'logo', libelle: 'Logo et marque' },
  { id: 'musique', libelle: 'Clip et musique' },
  { id: 'recit', libelle: 'Histoire racontée' },
  { id: 'donnees', libelle: 'Données et chiffres' },
  { id: 'chronologie', libelle: 'Frise et chronologie' },
  { id: 'vertical', libelle: 'Format vertical' },
  { id: 'personnage', libelle: 'Personnages' },
  { id: 'dessin', libelle: 'Dessin à la main' },
  { id: 'matiere', libelle: 'Papier et matière' },
  { id: 'retro', libelle: 'Rétro' },
  { id: 'neon', libelle: 'Néon et lumière' },
  { id: 'abstrait', libelle: 'Abstrait et génératif' },
  { id: 'plan-continu', libelle: 'Plan continu' },
  { id: 'cinema', libelle: 'Ambiance cinéma' },
  { id: 'minimaliste', libelle: 'Épuré' },
  { id: 'humour', libelle: 'Humour et décalé' },
  { id: 'competence', libelle: 'Compétence d’agent' },
];

export const ID_CATEGORIE = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** Un style porte au plus quatre catégories. */
export const MAX_CATEGORIES_PAR_STYLE = 4;

/** Les catégories d'un style, nettoyées : connues seulement, sans doublon, quatre au plus. */
export function categoriesDuStyle(brut: unknown, connues: ReadonlySet<string>): string[] {
  if (!Array.isArray(brut)) return [];
  const vues = new Set<string>();
  for (const c of brut) {
    const id = String(c ?? '').trim().toLowerCase();
    if (connues.has(id)) vues.add(id);
    if (vues.size >= MAX_CATEGORIES_PAR_STYLE) break;
  }
  return [...vues];
}

/** LE FILTRE DE L'ÉCRAN : un style passe s'il porte AU MOINS UNE des catégories choisies ; aucune choisie, tout passe. */
export function styleDansLesCategories(categories: readonly string[], choisies: readonly string[]): boolean {
  return !choisies.length || choisies.some((c) => categories.includes(c));
}

/** L'id d'une catégorie créée par l'agent, tiré de son libellé ; null si rien n'en reste. */
export function idDeCategorieNeuve(libelle: string): string | null {
  const id = String(libelle ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return ID_CATEGORIE.test(id) ? id : null;
}

/* ------------------------------------------------------------------ */
/* Sources                                                             */
/* ------------------------------------------------------------------ */

/**
 * LA VIE D'UNE SOURCE : `analyse` (l'agent lit le site), `a_valider` (sa recette
 * marche, l'utilisateur décide), `recuperation` (validée : les styles arrivent),
 * `active` (contrôlée chaque nuit), `erreur` (le dernier passage a échoué, les
 * styles restent), `retiree` (plus contrôlée, ses styles restent),
 * `annuaire` (une page de liens qui ne publie rien elle-même : l'agent a
 * proposé les sites qu'elle cite, chacun comme une source « à valider »),
 * `verification` (le site demande de passer une vérification anti-robot :
 * l'utilisateur la passe dans un vrai navigateur, ses styles restent).
 */
export type EtatSourceDeStyles = 'analyse' | 'a_valider' | 'recuperation' | 'active' | 'erreur' | 'retiree' | 'annuaire' | 'verification';

/** Combien de sources un annuaire peut proposer, au plus, par analyse. */
export const MAX_SOURCES_PAR_ANNUAIRE = 20;

/** L'étiquette des cartes de l'agent des sources : elle lui ouvre ses outils. */
export const LABEL_BIBLIOTHEQUE = 'bibliotheque';
/** Combien de jours un style arrivé d'une source garde sa marque « Nouveau ». */
export const JOURS_NOUVEAU = 7;
/** Combien de styles l'agent rédige par lot. */
export const TAILLE_LOT_REDACTION = 25;

/** Un morceau d'une page, lu ENTRE deux repères (jamais une expression régulière). */
export interface Extracteur {
  /** Chercher le début seulement APRÈS ce repère. */
  apres?: string;
  debut: string;
  fin: string;
  /** Ajouté devant ce qui est lu (ex. « https://x.com/ » quand le début l'a mangé). */
  prefixe?: string;
  /** Retirer les balises et décoder les entités. */
  texte?: boolean;
}

export interface RecetteDeSource {
  liste: {
    url: string;
    format: 'json' | 'html';
    /** JSON : le chemin vers le tableau (« data.items », vide = la racine). */
    chemin?: string;
    /** HTML : chaque objet JSON de la page qui commence par ce repère (ex. « {"slug":"»). */
    objets?: string;
    /** HTML : les guillemets échappés (\") des données de rendu sont rendus d'abord. */
    desechapper?: boolean;
    /** Pages suivantes : un gabarit avec {n}, de 2 jusqu'à `jusqua` (20 au plus), arrêt à la première page sans nouveauté. */
    pages?: { gabarit: string; jusqua: number };
  };
  /** Pour chaque objet de la liste : un CHEMIN (« author.name ») ou un GABARIT (« https://site/{slug} »). */
  champs: {
    id: string;
    titre?: string;
    auteur?: string;
    auteurUrl?: string;
    consigne?: string;
    lien?: string;
    affiche?: string;
    video?: string;
    anime?: string;
    categorie?: string;
  };
  /** La fiche d'une entrée, lue pour ce que la liste ne donne pas. */
  fiche?: {
    url: string;
    consigne?: Extracteur;
    lien?: Extracteur;
    auteur?: Extracteur;
    affiche?: Extracteur;
    video?: Extracteur;
  };
  /** Ne garder que les entrées dont la consigne fait au moins tant de signes, et/ou dont un champ vaut l'une des valeurs. */
  garder?: { consigneMin?: number; champ?: string; valeurs?: string[] };
}

export type Avis<T> = { ok: true; valeur: T } | { ok: false; raison: string };

/** Une adresse de site : https (http est relu en https), un vrai nom d'hôte, jamais la machine elle-même. */
export function jugerAdresseSource(brut: unknown): Avis<string> {
  const texte = String(brut ?? '').trim();
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(texte) ? texte : `https://${texte}`);
  } catch {
    return { ok: false, raison: 'adresse illisible' };
  }
  if (!/^https?:$/.test(url.protocol)) return { ok: false, raison: 'seules les adresses web (https) sont acceptées' };
  if (!hoteExterieur(url.hostname)) return { ok: false, raison: 'une adresse locale ou une adresse IP n’est pas une source' };
  if (url.port || url.username || url.password) return { ok: false, raison: 'une adresse avec un port ou des identifiants n’est pas une source' };
  // Toujours lue en https : le démon ne suit que des adresses chiffrées.
  url.protocol = 'https:';
  return { ok: true, valeur: url.toString() };
}

/**
 * LA CLÉ D'UNE ADRESSE DE SOURCE — ce qui dit « c'est la même source ». Jamais le
 * seul nom d'hôte : deux dépôts GitHub sont deux sources. Hôte en minuscules sans
 * « www. », chemin sans barre finale, requête gardée ; protocole et fragment ignorés.
 */
export function cleDAdresseSource(adresse: string): string | null {
  try {
    const url = new URL(adresse);
    const hote = url.hostname.toLowerCase().replace(/^www\./, '');
    const chemin = url.pathname.replace(/\/+$/, '');
    return `${hote}${chemin}${url.search}`;
  } catch {
    return null;
  }
}

/** La source déjà suivie à cette adresse, s'il y en a une. */
export function sourceDeLAdresse<S extends { adresse: string }>(adresse: string, sources: readonly S[]): S | undefined {
  const cle = cleDAdresseSource(adresse);
  if (!cle) return undefined;
  return sources.find((s) => cleDAdresseSource(s.adresse) === cle);
}

/**
 * LE NOM DE DÉPART D'UNE SOURCE, en attendant celui que l'agent d'analyse écrit :
 * « propriétaire/dépôt » sur GitHub, sinon l'hôte suivi du chemin.
 */
export function nomDeDepartDeSource(adresse: string): string {
  const url = new URL(adresse);
  const hote = url.hostname.toLowerCase().replace(/^www\./, '');
  const morceaux = url.pathname.split('/').filter(Boolean);
  if (hote === 'github.com' && morceaux.length >= 2) return `${morceaux[0]}/${morceaux[1].replace(/\.git$/, '')}`;
  return morceaux.length ? `${hote}/${morceaux.join('/')}` : hote;
}

/** La base de l'identifiant d'une source neuve, tirée de son nom de départ. */
export function baseDIdDeSource(adresse: string): string {
  return nomDeDepartDeSource(adresse).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'source';
}

function hoteExterieur(hote: string): boolean {
  const h = hote.toLowerCase().replace(/^\[|\]$/g, '');
  if (!h.includes('.') || h.endsWith('.local') || h.endsWith('.internal') || h === 'localhost' || h.endsWith('.localhost')) return false;
  if (/^[\d.]+$/.test(h) || h.includes(':')) return false;
  return true;
}

/**
 * UNE ADRESSE DE MÉDIA QUE LE DÉMON ACCEPTE DE TÉLÉCHARGER : https, sur un vrai
 * nom d'hôte, sans port ni identifiants. Le démon sert ensuite le fichier
 * lui-même — sans cette porte il deviendrait un relais vers n'importe quoi.
 */
export function adresseMediaAcceptable(brut: unknown): boolean {
  try {
    const url = new URL(String(brut ?? ''));
    return url.protocol === 'https:' && !url.port && !url.username && !url.password && hoteExterieur(url.hostname);
  } catch {
    return false;
  }
}

const CHAMP = /^[A-Za-z0-9_$-]+(\.[A-Za-z0-9_$-]+)*$/;
const GABARIT = /\{([A-Za-z0-9_$.-]+)\}/g;
const champValide = (v: unknown) => typeof v === 'string' && v.length <= 300 && (v.includes('{') ? [...v.matchAll(GABARIT)].length > 0 && !/[{}]/.test(v.replace(GABARIT, '')) : CHAMP.test(v));

function jugerExtracteur(x: unknown, nom: string): Avis<Extracteur> {
  if (!x || typeof x !== 'object') return { ok: false, raison: `« ${nom} » doit être un objet { debut, fin }` };
  const e = x as Record<string, unknown>;
  for (const cle of ['debut', 'fin'])
    if (typeof e[cle] !== 'string' || !(e[cle] as string).length || (e[cle] as string).length > 200) return { ok: false, raison: `« ${nom}.${cle} » : un repère de 1 à 200 signes` };
  for (const cle of ['apres', 'prefixe']) if (e[cle] !== undefined && (typeof e[cle] !== 'string' || (e[cle] as string).length > 200)) return { ok: false, raison: `« ${nom}.${cle} » : un texte de 200 signes au plus` };
  return { ok: true, valeur: { debut: e.debut as string, fin: e.fin as string, ...(e.apres ? { apres: e.apres as string } : {}), ...(e.prefixe ? { prefixe: e.prefixe as string } : {}), ...(e.texte === true ? { texte: true } : {}) } };
}

const CLES_CHAMPS = ['id', 'titre', 'auteur', 'auteurUrl', 'consigne', 'lien', 'affiche', 'video', 'anime', 'categorie'] as const;
const CLES_FICHE = ['consigne', 'lien', 'auteur', 'affiche', 'video'] as const;

/** LA RECETTE EST-ELLE JOUABLE ? Rien d'exécutable, des adresses web, des chemins et des repères bornés. */
export function jugerRecetteSource(brut: unknown): Avis<RecetteDeSource> {
  if (!brut || typeof brut !== 'object') return { ok: false, raison: 'la recette doit être un objet { liste, champs, fiche?, garder? }' };
  const r = brut as Record<string, any>;
  const inconnues = Object.keys(r).filter((k) => !['liste', 'champs', 'fiche', 'garder'].includes(k));
  if (inconnues.length) return { ok: false, raison: `clés inconnues : ${inconnues.join(', ')}` };
  const l = r.liste;
  if (!l || typeof l !== 'object') return { ok: false, raison: '« liste » manque' };
  const url = jugerAdresseSource(l.url);
  if (!url.ok) return { ok: false, raison: `« liste.url » : ${url.raison}` };
  if (l.format !== 'json' && l.format !== 'html') return { ok: false, raison: '« liste.format » vaut « json » ou « html »' };
  if (l.format === 'html' && (typeof l.objets !== 'string' || !l.objets.startsWith('{') || l.objets.length > 100))
    return { ok: false, raison: '« liste.objets » (format html) : le repère qui ouvre chaque objet JSON, commençant par « { », 100 signes au plus' };
  if (l.chemin !== undefined && l.chemin !== '' && !CHAMP.test(String(l.chemin))) return { ok: false, raison: '« liste.chemin » : un chemin « a.b.c »' };
  let pages: RecetteDeSource['liste']['pages'];
  if (l.pages !== undefined) {
    const g = String(l.pages?.gabarit ?? '');
    const jusqua = Number(l.pages?.jusqua);
    if (!g.includes('{n}') || !jugerAdresseSource(g.replace('{n}', '2')).ok) return { ok: false, raison: '« liste.pages.gabarit » : une adresse web avec {n}' };
    if (!Number.isInteger(jusqua) || jusqua < 2 || jusqua > 20) return { ok: false, raison: '« liste.pages.jusqua » : de 2 à 20' };
    pages = { gabarit: g, jusqua };
  }
  const c = r.champs;
  if (!c || typeof c !== 'object') return { ok: false, raison: '« champs » manque' };
  const champs: Record<string, string> = {};
  for (const [cle, v] of Object.entries(c)) {
    if (!(CLES_CHAMPS as readonly string[]).includes(cle)) return { ok: false, raison: `champ inconnu « ${cle} » (connus : ${CLES_CHAMPS.join(', ')})` };
    if (!champValide(v)) return { ok: false, raison: `« champs.${cle} » : un chemin (« author.name ») ou un gabarit (« https://site/{slug} »)` };
    champs[cle] = v as string;
  }
  if (!champs.id) return { ok: false, raison: '« champs.id » manque : chaque entrée a besoin d’un identifiant stable' };
  let fiche: RecetteDeSource['fiche'];
  if (r.fiche !== undefined) {
    const f = r.fiche;
    if (!f || typeof f !== 'object' || !champValide(f.url) || !String(f.url).includes('{') || !jugerAdresseSource(String(f.url).replace(GABARIT, 'x')).ok)
      return { ok: false, raison: '« fiche.url » : un gabarit d’adresse web (« https://site/{slug} »)' };
    fiche = { url: f.url };
    for (const [cle, v] of Object.entries(f)) {
      if (cle === 'url') continue;
      if (!(CLES_FICHE as readonly string[]).includes(cle)) return { ok: false, raison: `« fiche.${cle} » inconnu (connus : ${CLES_FICHE.join(', ')})` };
      const e = jugerExtracteur(v, `fiche.${cle}`);
      if (!e.ok) return e;
      (fiche as any)[cle] = e.valeur;
    }
  }
  if (!champs.consigne && !fiche?.consigne) return { ok: false, raison: 'la consigne manque : « champs.consigne » ou « fiche.consigne »' };
  let garder: RecetteDeSource['garder'];
  if (r.garder !== undefined) {
    const g = r.garder ?? {};
    garder = {};
    if (g.consigneMin !== undefined) {
      if (!Number.isInteger(g.consigneMin) || g.consigneMin < 0 || g.consigneMin > 5000) return { ok: false, raison: '« garder.consigneMin » : de 0 à 5000' };
      garder.consigneMin = g.consigneMin;
    }
    if (g.champ !== undefined) {
      if (!CHAMP.test(String(g.champ)) || !Array.isArray(g.valeurs) || !g.valeurs.length || g.valeurs.length > 30) return { ok: false, raison: '« garder.champ » va avec « garder.valeurs » (1 à 30 valeurs)' };
      garder.champ = String(g.champ);
      garder.valeurs = g.valeurs.map((v: unknown) => String(v));
    }
  }
  return {
    ok: true,
    valeur: {
      liste: { url: url.valeur, format: l.format, ...(l.chemin ? { chemin: String(l.chemin) } : {}), ...(l.objets ? { objets: l.objets } : {}), ...(l.desechapper === true ? { desechapper: true } : {}), ...(pages ? { pages } : {}) },
      champs: champs as RecetteDeSource['champs'],
      ...(fiche ? { fiche } : {}),
      ...(garder ? { garder } : {}),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Lecture d'une page selon la recette (pur : le texte est donné)      */
/* ------------------------------------------------------------------ */

function suivreChemin(objet: unknown, chemin: string): unknown {
  let v: any = objet;
  for (const morceau of chemin.split('.')) {
    if (v == null || typeof v !== 'object') return undefined;
    v = v[morceau];
  }
  return v;
}

/** La valeur d'un champ : un chemin, ou un gabarit dont chaque {chemin} est remplacé. */
export function valeurDuChamp(objet: unknown, champ: string | undefined): string | undefined {
  if (!champ) return undefined;
  if (champ.includes('{')) {
    let manque = false;
    const v = champ.replace(GABARIT, (_m, chemin: string) => {
      const x = suivreChemin(objet, chemin);
      if (x == null || typeof x === 'object' || String(x) === '') manque = true;
      return encodeURIComponent(String(x ?? ''));
    });
    return manque ? undefined : v;
  }
  const v = suivreChemin(objet, champ);
  if (v == null || typeof v === 'object') return undefined;
  const s = String(v).trim();
  return s || undefined;
}

/** Les objets JSON équilibrés qui commencent par `repere` dans un texte (accolades comptées hors chaînes). */
export function objetsJsonDansLeTexte(texte: string, repere: string, max = 2000): unknown[] {
  const objets: unknown[] = [];
  let i = texte.indexOf(repere);
  while (i >= 0 && objets.length < max) {
    let profondeur = 0;
    let dansChaine = false;
    let fin = -1;
    for (let k = i; k < texte.length && k - i < 200_000; k++) {
      const ch = texte[k];
      if (dansChaine) {
        if (ch === '\\') k++;
        else if (ch === '"') dansChaine = false;
      } else if (ch === '"') dansChaine = true;
      else if (ch === '{') profondeur++;
      else if (ch === '}' && --profondeur === 0) {
        fin = k;
        break;
      }
    }
    if (fin < 0) break;
    try {
      objets.push(JSON.parse(texte.slice(i, fin + 1)));
    } catch {
      /* un faux départ : on passe au repère suivant */
    }
    i = texte.indexOf(repere, i + 1);
  }
  return objets;
}

/** Les objets de la liste d'une page, selon la recette. */
export function objetsDeLaListe(texte: string, liste: RecetteDeSource['liste']): Avis<unknown[]> {
  if (liste.format === 'json') {
    let lu: unknown;
    try {
      lu = JSON.parse(texte);
    } catch {
      return { ok: false, raison: 'la page de la liste n’est pas du JSON' };
    }
    const tableau = liste.chemin ? suivreChemin(lu, liste.chemin) : lu;
    if (!Array.isArray(tableau)) return { ok: false, raison: `aucun tableau au chemin « ${liste.chemin || '(racine)'} »` };
    return { ok: true, valeur: tableau.slice(0, 2000) };
  }
  const page = liste.desechapper ? texte.replace(/\\"/g, '"').replace(/\\\\/g, '\\') : texte;
  return { ok: true, valeur: objetsJsonDansLeTexte(page, liste.objets ?? '{') };
}

const ENTITES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/** Le texte d'un morceau de HTML : balises retirées, sauts de ligne gardés, entités décodées. */
export function texteDeHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
      e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITES[e.toLowerCase()] ?? m),
    )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Ce qui se trouve entre deux repères (après un troisième, au besoin). */
export function extraire(html: string, e: Extracteur): string | undefined {
  let depart = 0;
  if (e.apres) {
    const a = html.indexOf(e.apres);
    if (a < 0) return undefined;
    depart = a + e.apres.length;
  }
  const d = html.indexOf(e.debut, depart);
  if (d < 0) return undefined;
  const f = html.indexOf(e.fin, d + e.debut.length);
  if (f < 0) return undefined;
  let v = html.slice(d + e.debut.length, f);
  if (e.texte) v = texteDeHtml(v);
  v = v.trim();
  return v ? `${e.prefixe ?? ''}${v}` : undefined;
}

/** Une entrée d'une source, telle que lue — pas encore un style (ni texte français, ni catégories). */
export interface EntreeDeSource {
  idOrigine: string;
  titre?: string;
  auteur?: string;
  auteurUrl?: string;
  consigne?: string;
  lien?: string;
  affiche?: string;
  video?: string;
  anime?: string;
  categorie?: string;
}

/** Un objet de la liste devenu entrée ; null s'il n'a pas d'identifiant. */
export function entreeDeLObjet(objet: unknown, champs: RecetteDeSource['champs']): EntreeDeSource | null {
  const idOrigine = valeurDuChamp(objet, champs.id);
  if (!idOrigine) return null;
  const e: EntreeDeSource = { idOrigine };
  for (const cle of ['titre', 'auteur', 'auteurUrl', 'consigne', 'lien', 'affiche', 'video', 'anime', 'categorie'] as const) {
    const v = valeurDuChamp(objet, champs[cle]);
    if (v) e[cle] = v;
  }
  return e;
}

/** L'entrée passe-t-elle le filtre « garder » de la recette ? (`objet` : l'objet brut de la liste). */
export function entreeGardee(e: EntreeDeSource, objet: unknown, garder: RecetteDeSource['garder']): boolean {
  if (!garder) return true;
  if (garder.consigneMin && (e.consigne ?? '').length < garder.consigneMin) return false;
  if (garder.champ && !garder.valeurs!.includes(String(valeurDuChamp(objet, garder.champ) ?? ''))) return false;
  return true;
}

/** La publication d'origine, réduite à son numéro : x.com et twitter.com se recoupent. */
export function clePublication(lien: unknown): string | null {
  return String(lien ?? '').match(/(?:x|twitter)\.com\/[^/]+\/status\/(\d+)/i)?.[1] ?? null;
}

export const ID_STYLE = /^[a-z0-9][a-z0-9-]{0,79}$/;

/** L'id d'un nouveau style : celui de la source s'il est libre, sinon préfixé par la source ; null s'il n'en reste rien. */
export function idDeStyleNeuf(idOrigine: string, sourceId: string, pris: ReadonlySet<string>): string | null {
  const propre = (t: string) =>
    t
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
      .replace(/-+$/g, '');
  const base = propre(idOrigine);
  if (!base) return null;
  if (ID_STYLE.test(base) && !pris.has(base)) return base;
  const prefixe = propre(`${sourceId}-${base}`);
  return ID_STYLE.test(prefixe) && !pris.has(prefixe) ? prefixe : null;
}

/** La raison d'une page qui demande une vérification anti-robot : reconnue telle quelle, elle fait passer la source en « vérification ». */
export const RAISON_ANTI_ROBOT = 'le site demande une vérification anti-robot : il refuse les lectures automatiques pour l’instant';

/** La page est-elle une vérification anti-robot (Cloudflare et ses semblables) ? */
export function pageAntiRobot(texte: string): boolean {
  return /<title>\s*(Just a moment|Un instant|Attention Required)|cf-challenge|challenges\.cloudflare\.com|cf_chl_opt|hcaptcha\.com\/captcha|g-recaptcha/i.test(texte.slice(0, 20000));
}

/** Une raison d'échec qui vient d'une vérification anti-robot (celle du démon, ou dite par l'agent d'analyse). */
export function raisonAntiRobot(raison: string | null | undefined): boolean {
  return !!raison && (raison === RAISON_ANTI_ROBOT || /anti-?robot|captcha|cloudflare|vérification humaine/i.test(raison));
}

/** « Passer la vérification » est proposé à une source bloquée par une vérification anti-robot, pas à une autre. */
export function peutPasserLaVerification(source: { etat: EtatSourceDeStyles; erreur?: string | null }): boolean {
  return source.etat === 'verification' || (source.etat === 'erreur' && raisonAntiRobot(source.erreur));
}

/**
 * UN SITE TROUVÉ DANS UN ANNUAIRE PEUT-IL DEVENIR UNE SOURCE ? Une vraie adresse web, autre que l'annuaire lui-même, et
 * qu'aucune source ne suit déjà — comparée par ADRESSE COMPLÈTE (`cleDAdresseSource`), jamais par le seul site ni par
 * un identifiant : deux dépôts GitHub sont deux sources. Une source retirée compte aussi : l'utilisateur l'a écartée.
 */
export function jugerPropositionDeSource<S extends { adresse: string; nom: string }>(
  brut: unknown,
  annuaire: { adresse: string },
  sources: readonly S[],
  dejaProposees: number,
): Avis<string> {
  const avis = jugerAdresseSource(brut);
  if (!avis.ok) return avis;
  if (dejaProposees >= MAX_SOURCES_PAR_ANNUAIRE) return { ok: false, raison: `cet annuaire a déjà proposé ${MAX_SOURCES_PAR_ANNUAIRE} sources : c’est le plafond` };
  if (cleDAdresseSource(avis.valeur) === cleDAdresseSource(annuaire.adresse)) return { ok: false, raison: 'c’est l’adresse de l’annuaire lui-même' };
  const deja = sourceDeLAdresse(avis.valeur, sources);
  if (deja) return { ok: false, raison: `cette adresse est déjà dans les sources (« ${deja.nom} ») : rien à proposer` };
  return avis;
}

/** Une page qui ne rend pas la liste : la raison lisible (anti-robot, refus, page vide), ou null. */
export function raisonDePageRefusee(statut: number, texte: string): string | null {
  if (pageAntiRobot(texte)) return RAISON_ANTI_ROBOT;
  if (statut === 401 || statut === 403) return `le site refuse la lecture (code ${statut})`;
  if (statut === 404) return 'la page de la liste n’existe plus (code 404) : le site a changé d’adresse';
  if (statut >= 400) return `le site répond en erreur (code ${statut})`;
  return null;
}

/* ------------------------------------------------------------------ */
/* Ce que l'agent reçoit                                               */
/* ------------------------------------------------------------------ */

/** LA CONSIGNE DE L'AGENT DE LA BIBLIOTHÈQUE : courte, sa demande dit le détail. */
export const CONSIGNE_AGENT_BIBLIOTHEQUE = `Tu travailles dans Beluga Build. Réponds très court.

TU ES L'AGENT DE LA BIBLIOTHÈQUE DE STYLES DU STUDIO. Deux travaux possibles, que ta demande nomme : ANALYSER une source (un site d'exemples de vidéos animées avec leurs consignes) et écrire la RECETTE DÉCLARATIVE qui en récupère les exemples, ou RÉDIGER en français le titre, la phrase et les catégories des styles arrivés d'une source. Tu ne modifies aucun fichier, tu ne crées aucune carte, tu ne publies rien, tu n'écris jamais de code à rejouer : le démon rejoue ta recette seul, chaque nuit.

TU ESSAIES AVANT D'ENREGISTRER (« bibliotheque_source_essai » puis « bibliotheque_source_recette »). UN ANNUAIRE (un sujet GitHub, une liste « awesome », une page de liens) ne publie pas d'exemples lui-même : tu ne t'arrêtes pas là, tu ouvres ses liens et tu PROPOSES chaque site exploitable (« bibliotheque_source_proposer »). Seul un site vraiment illisible (vérification anti-robot, connexion obligatoire, aucune consigne publiée nulle part) se dit avec « impossible », en une phrase simple.

TES TEXTES sont pour une personne qui ne programme pas : des mots courants, la direction visuelle plutôt que la marque, aucun nom technique.

TA RÉPONSE FINALE tient en une ou deux lignes. Aucun titre, aucun tableau, aucun bloc json.`;

/** Une recette d'exemple, montrée à l'agent : la galerie prompt-motion (liste HTML + fiche). */
const EXEMPLE_RECETTE_HTML: RecetteDeSource = {
  liste: { url: 'https://www.prompt-motion.com/', format: 'html', objets: '{"slug":"', desechapper: true },
  champs: { id: 'slug', titre: 'title', auteur: 'handle', affiche: 'poster', video: 'preview' },
  fiche: {
    url: 'https://www.prompt-motion.com/{slug}',
    consigne: { apres: 'id="entry-prompt"', debut: '>', fin: '</div>', texte: true },
    lien: { debut: 'href="https://x.com/', fin: '"', prefixe: 'https://x.com/' },
  },
};
const EXEMPLE_RECETTE_JSON: RecetteDeSource = {
  liste: { url: 'https://raw.githubusercontent.com/yihui-dev/awesome-opus5-5-videos/main/data/videos.json', format: 'json' },
  champs: { id: 'slug', auteur: 'author', auteurUrl: 'author_url', lien: 'post_url', consigne: 'prompt', affiche: 'poster_url', anime: 'https://media.skillry.dev/opus-5-5/{slug}/preview.webp', categorie: 'category' },
  garder: { consigneMin: 400, champ: 'category', valeurs: ['motion', 'explainer', '3d'] },
};

/** LA DEMANDE DE L'AGENT D'ANALYSE : lire le site, écrire la recette, l'essayer, l'enregistrer. */
export function demandeDAnalyseDeSource(source: { id: string; adresse: string; nom: string; recette?: RecetteDeSource | null; erreur?: string | null }): string {
  return [
    `ANALYSE UNE SOURCE DE LA BIBLIOTHÈQUE DE STYLES DU STUDIO : ${source.adresse} (identifiant « ${source.id} »).`,
    '',
    'La bibliothèque rassemble des EXEMPLES de vidéos ou d’animations, chacun avec la CONSIGNE (le prompt) qui l’a produit, son auteur et un aperçu (image, vidéo ou image animée). Ton travail : trouver où ce site liste ses exemples, puis écrire une RECETTE D’EXTRACTION que le démon rejouera seul chaque nuit pour récupérer les nouveaux.',
    '',
    source.recette ? `RECETTE ACTUELLE (à réparer ou à refaire) : ${JSON.stringify(source.recette)}` : '',
    source.erreur ? `DERNIÈRE ERREUR : ${source.erreur}` : '',
    '',
    'LA RECETTE EST DÉCLARATIVE — aucun code, aucune expression régulière :',
    '- « liste » : { url, format: "json" | "html", chemin? (json : « data.items », vide = la racine), objets? (html : le repère qui ouvre chaque objet JSON des données de rendu, ex. « {"slug":" »), desechapper? (html : vrai si ces données sont dans une chaîne aux guillemets échappés \\"), pages? { gabarit: "https://…?page={n}", jusqua: 2 à 20 } }',
    '- « champs » : pour chaque objet de la liste, un CHEMIN (« author.name ») ou un GABARIT (« https://site/{slug} ») — id (obligatoire et stable), titre, auteur, auteurUrl, consigne, lien (la publication d’origine), affiche (image fixe), video (mp4), anime (image animée), categorie',
    '- « fiche » (facultatif) : { url: gabarit de la page d’un exemple, puis consigne / lien / auteur / affiche / video : { apres?, debut, fin, prefixe?, texte? } } — ce qui se trouve ENTRE deux repères de la page, « texte » retire les balises',
    '- « garder » (facultatif) : { consigneMin?: nombre de signes, champ?, valeurs? } pour écarter les exemples sans vraie consigne',
    '',
    `Exemple JSON : ${JSON.stringify(EXEMPLE_RECETTE_JSON)}`,
    `Exemple HTML : ${JSON.stringify(EXEMPLE_RECETTE_HTML)}`,
    '',
    'DÉROULÉ :',
    '1. Lis le site (WebFetch, ou curl dans un terminal) : la page d’accueil, sa liste d’exemples, une fiche, et cherche une source de données plus propre (fichier JSON, API publique, dépôt GitHub, données de rendu « __NEXT_DATA__ » ou « self.__next_f »). Relève aussi la LICENCE ou les conditions d’usage des consignes et des vidéos.',
    `2. Essaie ta recette avec « bibliotheque_source_essai » (sourceId « ${source.id} ») jusqu’à ce que les exemples rendus aient chacun un id, une consigne et un aperçu.`,
    `3. Enregistre-la avec « bibliotheque_source_recette » : sourceId « ${source.id} », nom (court, ex. « prompt-motion.com »), licence (une phrase, en français), resume (deux à quatre phrases en français pour l’utilisateur : ce que contient le site, combien d’exemples, ce qui est gardé ou écarté, les conditions d’usage) et la recette. L’utilisateur validera ensuite dans le volet « Sources » ; rien n’est récupéré avant.`,
    `4. SI LA PAGE EST UN ANNUAIRE (un sujet GitHub comme github.com/topics/…, une liste « awesome », un guide ou une page de liens) qui ne publie pas d’exemples avec leur consigne : ouvre ses liens (${MAX_SOURCES_PAR_ANNUAIRE} au plus, les plus prometteurs d’abord : galeries d’animations, dépôts d’exemples avec leurs consignes). Pour chaque site qui publie des exemples AVEC consigne et aperçu, écris sa recette, essaie-la avec « bibliotheque_source_essai » (sourceId « ${source.id} »), puis propose-la avec « bibliotheque_source_proposer » : depuis « ${source.id} », adresse du site, nom, licence, resume et recette. Une adresse déjà suivie est refusée : passe à la suivante. Enfin, appelle « bibliotheque_source_recette » avec « annuaire » : une phrase qui dit combien de sources tu as proposées et pourquoi les autres liens ont été écartés.`,
    '5. Si le site ne se lit pas (vérification anti-robot, connexion obligatoire, aucune consigne publiée nulle part, aucun lien exploitable), appelle « bibliotheque_source_recette » avec « impossible » : la raison en une phrase simple.',
    '',
    'Tu ne récupères ni ne rédiges aucun style toi-même. Ne pose une question (« ask_user ») que si un vrai choix revient à l’utilisateur. Termine par une phrase qui dit ce que tu as enregistré.',
  ]
    .filter((l, i, tout) => l !== '' || tout[i - 1] !== '')
    .join('\n');
}

/** LA DEMANDE DE L'AGENT DE RÉDACTION : textes français et catégories des styles arrivés d'une source. */
export function demandeDeRedactionDesStyles(entree: { sourceId: string; nom: string; nombre: number }): string {
  return [
    `RÉDIGE LES ${entree.nombre} NOUVEAUX STYLES arrivés de la source « ${entree.nom} » dans la bibliothèque du Studio.`,
    '',
    'Chaque style est une consigne de mise en scène (souvent en anglais). Tant qu’il n’a pas son texte français et ses catégories, il n’est pas montré.',
    '',
    'DÉROULÉ, par lots :',
    `1. « bibliotheque_styles_a_rediger » (sourceId « ${entree.sourceId} ») rend le lot suivant et la liste des catégories.`,
    '2. Pour chacun : titre (60 signes au plus, la DIRECTION VISUELLE, pas la marque : « Lancement d’app minimaliste sur musique »), phrase (une phrase de 200 signes au plus qui décrit ce qu’on voit et à quoi ça sert, ex. « Un film épuré avec un seul accent de couleur… Idéal pour une application grand public. »), motsCles (3 à 6, en français), genre (« motion », ou « explication » pour une vidéo qui explique), categories (1 à 4 identifiants de la liste, du plus juste au moins juste).',
    '3. « bibliotheque_styles_ecrire » avec le lot entier ; recommence jusqu’à ce qu’il ne reste rien.',
    '',
    'LES CATÉGORIES SONT UNE LISTE FIXE : n’en crée une (« categoriesNeuves ») qu’en tout dernier recours, quand AUCUNE ne convient à un style — c’est rare. Un style que tu juges inutilisable (consigne vide, hors sujet, en double) : « ecarter » avec son id.',
    '',
    'Termine par une phrase : combien de styles rédigés, combien écartés.',
  ].join('\n');
}
