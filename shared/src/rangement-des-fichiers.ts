import { minusculesSansAccents } from './mots.js';
/**
 * LE RANGEMENT DES FICHIERS — par projet, puis par service (carte « Fichiers rangés et captures pleine page »,
 * 05/11/2026).
 *
 * Tout ce qu'un projet ou un service crée — médias du Studio et de Communication, pièces jointes des conversations,
 * documents des cartes, mémoire rendue en fichiers, stratégie, code, journaux, sauvegardes — s'affiche dans UNE
 * arborescence `<Projet>/<Service>/<sous-dossiers>/<nom>`, la même sur le disque (`data/fichiers/`) et dans la
 * fenêtre « Fichiers ». Ce module ne touche ni base ni disque : il dit OÙ va une chose, QUI la voit, ce qu'on a le
 * DROIT d'en faire, et comment classer une recherche. Le registre et le miroir sur disque vivent dans
 * `server/src/fichiers-ranges.ts`.
 */

/** Les services, dans l'ordre où l'arbre les montre. */
export const SERVICES_DE_FICHIERS = ['studio', 'communication', 'captures', 'medias', 'conversations', 'cartes', 'strategie', 'ajouts', 'code', 'memoire', 'journaux', 'sauvegardes'] as const;
export type ServiceDeFichiers = (typeof SERVICES_DE_FICHIERS)[number];

export interface FicheDeService {
  /** Le nom du dossier, sur le disque comme à l'écran (traduit à l'écran). */
  libelle: string;
  /** Une icône lucide, par son nom. */
  icone: string;
  /** Réservé à l'administrateur (décision du 05/11/2026 : journaux, sauvegardes et mémoire). */
  reserveAdmin: boolean;
  /** Peut-on renommer ce qu'il contient ? */
  renommable: boolean;
  /** Peut-on le mettre à la corbeille ? La mémoire se lit depuis sa base, le code vit dans son dépôt, les sauvegardes ne s'effacent pas d'ici. */
  supprimable: boolean;
  /** Peut-on y déposer un fichier ? */
  depot: boolean;
}

export const FICHES_DES_SERVICES: Readonly<Record<ServiceDeFichiers, FicheDeService>> = {
  studio: { libelle: 'Studio', icone: 'Clapperboard', reserveAdmin: false, renommable: true, supprimable: true, depot: true },
  communication: { libelle: 'Communication', icone: 'Megaphone', reserveAdmin: false, renommable: true, supprimable: true, depot: true },
  /* L'outil de captures d'écran : images, vidéos de parcours, maquettes et PDF des plaquettes (05/11/2026). */
  captures: { libelle: 'Captures', icone: 'Camera', reserveAdmin: false, renommable: true, supprimable: true, depot: false },
  /*
   * LES MÉDIAS FABRIQUÉS PAR LES AGENTS (08/11/2026) : vidéos, images, captures et étapes intermédiaires posées sur le
   * disque de stockage (`beluga-medias/<projet>/…`), MONTRÉS là où ils sont, jamais copiés. Ni renommés ni jetés
   * d'ici : les cartes et le Studio les citent par leur chemin.
   */
  medias: { libelle: 'Médias', icone: 'Images', reserveAdmin: false, renommable: false, supprimable: false, depot: false },
  conversations: { libelle: 'Conversations', icone: 'MessagesSquare', reserveAdmin: false, renommable: true, supprimable: true, depot: false },
  cartes: { libelle: 'Cartes', icone: 'SquareKanban', reserveAdmin: false, renommable: true, supprimable: true, depot: false },
  strategie: { libelle: 'Stratégie', icone: 'Compass', reserveAdmin: false, renommable: false, supprimable: false, depot: false },
  ajouts: { libelle: 'Ajouts', icone: 'FolderInput', reserveAdmin: false, renommable: true, supprimable: true, depot: true },
  code: { libelle: 'Code', icone: 'Code', reserveAdmin: false, renommable: false, supprimable: false, depot: false },
  memoire: { libelle: 'Mémoire', icone: 'Brain', reserveAdmin: true, renommable: false, supprimable: false, depot: false },
  journaux: { libelle: 'Journaux', icone: 'ScrollText', reserveAdmin: true, renommable: false, supprimable: true, depot: false },
  sauvegardes: { libelle: 'Sauvegardes', icone: 'DatabaseBackup', reserveAdmin: true, renommable: false, supprimable: false, depot: false },
};

export function estUnServiceDeFichiers(x: unknown): x is ServiceDeFichiers {
  return typeof x === 'string' && (SERVICES_DE_FICHIERS as readonly string[]).includes(x);
}

/* ------------------------------------------------------------------ */
/* Les médias fabriqués et le disque qui porte un fichier               */
/* ------------------------------------------------------------------ */

/** Un projet tel que le rattachement des médias le lit. */
export interface ProjetPourLesMedias {
  id: string;
  nom: string;
  chemin: string;
  regroupement?: boolean;
}

/**
 * À QUEL PROJET APPARTIENT UN DOSSIER DE `beluga-medias/` ? Les dossiers portent le nom que la carte qui les a faits
 * leur a donné : le nom du projet (« haiko-studio », « kipou »), celui de son dossier de travail (« haiko »,
 * « jb2o »), ou un ancien nom (« aerofish »). Dans l'ordre, sur les vrais projets d'abord (un regroupement nommé
 * « Haiko » ne prend pas les médias du projet dont le dossier s'appelle « haiko ») :
 *  1. le dossier de travail du projet porte ce nom ;
 *  2. le nom du projet, écrit en chemin, est ce nom ;
 *  3. un sous-dossier « carte-<8 caractères> » désigne une carte : son projet ;
 *  4. enfin le nom d'un regroupement.
 * Rien ne correspond : `null`, et le dossier reste « non classé » dans le relevé.
 */
export function projetDuDossierDeMedias(
  dossier: string,
  projets: readonly ProjetPourLesMedias[],
  sousDossiers: readonly string[] = [],
  projetDUneCarte: (debutDeLId: string) => string | null = () => null,
): string | null {
  const nom = enChemin(dossier);
  if (!nom) return null;
  const vrais = projets.filter((p) => !p.regroupement);
  const parDossier = vrais.find((p) => enChemin(p.chemin.split('/').filter(Boolean).pop() ?? '') === nom);
  if (parDossier) return parDossier.id;
  const parNom = vrais.find((p) => enChemin(p.nom) === nom);
  if (parNom) return parNom.id;
  for (const sous of sousDossiers) {
    const carte = /^carte-([0-9a-f]{8})\b/i.exec(sous);
    const projet = carte ? projetDUneCarte(carte[1].toLowerCase()) : null;
    if (projet && projets.some((p) => p.id === projet)) return projet;
  }
  return projets.find((p) => p.regroupement && enChemin(p.nom) === nom)?.id ?? null;
}

/** Un nom écrit comme un chemin : minuscules, sans accents, des tirets. */
function enChemin(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Le disque qui porte un fichier, tel que l'explorateur le badge. */
export type DisqueDUnFichier = 'serveur' | 'stockage';

/**
 * LE DISQUE QUI PORTE CE CHEMIN : « stockage » quand il vit sous un point de montage externe (le disque de stockage
 * monté sous `/mnt`), « serveur » sinon. Les montages viennent de `/proc/mounts`, lus par le serveur.
 */
export function disqueQuiPorte(chemin: string, montagesExternes: readonly string[]): DisqueDUnFichier {
  const propre = (chemin ?? '').trim();
  return montagesExternes.some((m) => {
    const racine = m.replace(/\/+$/, '');
    return !!racine && racine !== '/' && (propre === racine || propre.startsWith(`${racine}/`));
  })
    ? 'stockage'
    : 'serveur';
}

/** Le dossier racine de ce qui n'appartient à aucun projet (mémoire commune, non classés). Réservé à l'administrateur. */
export const DOSSIER_COMMUN = 'Commun';
/** Le dossier caché qui garde les fichiers DÉPOSÉS mis à la corbeille. */
export const DOSSIER_CORBEILLE = '.corbeille';
/** Le temps de grâce d'un fichier mis à la corbeille avant qu'il soit retiré pour de bon. */
export const CORBEILLE_JOURS = 30;
const JOUR_MS = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* Les noms                                                             */
/* ------------------------------------------------------------------ */

/**
 * UN NOM DE DOSSIER OU DE FICHIER LISIBLE ET SÛR : accents gardés (l'arbre se lit en français), mais ni barre, ni
 * caractère de contrôle, ni nom réservé (`.`, `..`), ni point en tête (un fichier caché disparaîtrait de `ls`), et
 * jamais plus de 80 signes. Vide → `secours`.
 */
export function nomSur(texte: string | null | undefined, secours = 'Sans titre'): string {
  let n = String(texte ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+/, '')
    .trim();
  if (n.length > 80) {
    const point = n.lastIndexOf('.');
    const ext = point > 0 && n.length - point <= 10 ? n.slice(point) : '';
    n = `${n.slice(0, 80 - ext.length).trim()}${ext}`;
  }
  return n || secours;
}

/** « photo.png » déjà pris → « photo (2).png », puis « photo (3).png »… */
export function nomLibreDansLeDossier(nom: string, pris: ReadonlySet<string>): string {
  if (!pris.has(nom)) return nom;
  const point = nom.lastIndexOf('.');
  const base = point > 0 ? nom.slice(0, point) : nom;
  const ext = point > 0 ? nom.slice(point) : '';
  for (let i = 2; ; i++) {
    const essai = `${base} (${i})${ext}`;
    if (!pris.has(essai)) return essai;
  }
}

/**
 * LE DOSSIER DE CHAQUE PROJET : son nom, et, si deux projets portent le même, les quatre premiers signes de leur
 * identifiant pour les départager (« Site · 4bde »). Déterministe : le plus ancien garde le nom nu.
 */
export function dossiersDesProjets(projets: readonly { id: string; nom: string; creeLe?: number }[]): Map<string, string> {
  const tries = [...projets].sort((a, b) => (a.creeLe ?? 0) - (b.creeLe ?? 0) || a.id.localeCompare(b.id));
  const pris = new Set<string>([DOSSIER_COMMUN.toLowerCase()]);
  const resultat = new Map<string, string>();
  for (const p of tries) {
    let nom = nomSur(p.nom, 'Projet');
    if (pris.has(nom.toLowerCase())) nom = `${nom} · ${p.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4)}`;
    pris.add(nom.toLowerCase());
    resultat.set(p.id, nom);
  }
  return resultat;
}

/** Les morceaux d'un chemin logique (« Studio/Ma vidéo »), nettoyés un par un. Jamais de `..`. */
export function morceauxDuDossier(dossier: string | null | undefined): string[] {
  return String(dossier ?? '')
    .split('/')
    .map((m) => m.trim())
    .filter((m) => m && m !== '.' && m !== '..')
    .map((m) => nomSur(m));
}

/**
 * LE CHEMIN RANGÉ d'une entrée, relatif à la racine des fichiers : `<Projet>/<Service>/<dossier…>/<nom>`. Une entrée
 * sans projet va sous `Commun/`.
 */
export function cheminRange(entree: { dossierProjet: string | null; service: ServiceDeFichiers; dossier: string; nom: string }): string {
  return [entree.dossierProjet ?? DOSSIER_COMMUN, FICHES_DES_SERVICES[entree.service].libelle, ...morceauxDuDossier(entree.dossier), nomSur(entree.nom)].join('/');
}

/* ------------------------------------------------------------------ */
/* Le genre d'un fichier                                                */
/* ------------------------------------------------------------------ */

export type GenreDeFichier = 'image' | 'video' | 'son' | 'pdf' | 'texte' | 'code' | 'archive' | 'autre';

const EXT_CODE = new Set(['ts', 'tsx', 'js', 'mjs', 'cjs', 'jsx', 'vue', 'py', 'php', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'cs', 'css', 'scss', 'html', 'sql', 'sh', 'yml', 'yaml', 'toml', 'json', 'xml']);
const EXT_TEXTE = new Set(['md', 'txt', 'log', 'csv', 'ini', 'env']);

export function genreDeFichier(nom: string, mime?: string | null): GenreDeFichier {
  const m = (mime ?? '').toLowerCase();
  const ext = (nom.toLowerCase().split('.').pop() ?? '').trim();
  if (m.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'heic'].includes(ext)) return 'image';
  if (m.startsWith('video/') || ['mp4', 'mov', 'webm', 'mkv', 'm4v'].includes(ext)) return 'video';
  if (m.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus'].includes(ext)) return 'son';
  if (m === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (['zip', 'gz', 'tgz', 'tar', '7z', 'rar'].includes(ext)) return 'archive';
  if (EXT_CODE.has(ext)) return 'code';
  if (m.startsWith('text/') || EXT_TEXTE.has(ext)) return 'texte';
  return 'autre';
}

/** Ce genre a-t-il un texte qu'on peut lire pour la recherche ? */
export function genreLisible(genre: GenreDeFichier): boolean {
  return genre === 'texte' || genre === 'code';
}

/* ------------------------------------------------------------------ */
/* Qui voit quoi, qui fait quoi                                         */
/* ------------------------------------------------------------------ */

export interface CompteDeFichiers {
  role: string;
  projets: readonly string[];
}

/**
 * CE COMPTE VOIT-IL CETTE ENTRÉE ? L'administrateur voit tout. Un collaborateur ne voit que les projets de sa
 * portée, et jamais journaux, sauvegardes ni mémoire ; ce qui n'a pas de projet (« Commun ») reste à
 * l'administrateur. Vérifié AU SERVEUR à chaque lecture, pas seulement à l'écran.
 */
export function peutVoirLEntree(compte: CompteDeFichiers, entree: { projetId: string | null; service: ServiceDeFichiers }): boolean {
  if (compte.role === 'admin') return true;
  /* Un CLIENT n'a que son espace client : l'arbre interne (conversations, cartes, code) ne lui est jamais ouvert. */
  if (compte.role !== 'membre' && compte.role !== 'lecteur') return false;
  if (!entree.projetId) return false;
  if (FICHES_DES_SERVICES[entree.service].reserveAdmin) return false;
  return compte.projets.includes(entree.projetId);
}

export type GesteSurUnFichier = 'renommer' | 'supprimer' | 'deposer';

/**
 * CE COMPTE PEUT-IL FAIRE CE GESTE ? Il faut d'abord voir l'entrée ; un lecteur ne fait que lire ; puis le service
 * doit permettre le geste.
 */
export function peutFaireLeGeste(compte: CompteDeFichiers, entree: { projetId: string | null; service: ServiceDeFichiers }, geste: GesteSurUnFichier): boolean {
  if (!peutVoirLEntree(compte, entree)) return false;
  if (compte.role !== 'admin' && compte.role !== 'membre') return false;
  const fiche = FICHES_DES_SERVICES[entree.service];
  return geste === 'renommer' ? fiche.renommable : geste === 'supprimer' ? fiche.supprimable : fiche.depot;
}

/* ------------------------------------------------------------------ */
/* La corbeille                                                         */
/* ------------------------------------------------------------------ */

/** Le jour où une entrée mise à la corbeille sera retirée pour de bon. */
export function finDeCorbeille(supprimeLe: number): number {
  return supprimeLe + CORBEILLE_JOURS * JOUR_MS;
}

/** Cette entrée a-t-elle fini son temps de corbeille ? */
export function aPurger(supprimeLe: number | null | undefined, maintenant: number): boolean {
  return typeof supprimeLe === 'number' && maintenant >= finDeCorbeille(supprimeLe);
}

/** Jours restants avant le retrait définitif (jamais négatif). */
export function joursRestantsEnCorbeille(supprimeLe: number, maintenant: number): number {
  return Math.max(0, Math.ceil((finDeCorbeille(supprimeLe) - maintenant) / JOUR_MS));
}

/* ------------------------------------------------------------------ */
/* La recherche                                                         */
/* ------------------------------------------------------------------ */

/** Minuscules, sans accents : « Médiathèque » et « mediatheque » se rejoignent. */
function plat(texte: string): string {
  return minusculesSansAccents(texte);
}

/**
 * LA DEMANDE EN MOTS POUR LE PLEIN TEXTE (FTS5) : chaque mot de deux signes au moins, entre guillemets (aucun
 * opérateur ne passe), le dernier en préfixe — la recherche répond PENDANT la saisie. Vide → `null`.
 */
/** Les mots qui ne disent rien de ce qu'on cherche : une question en mots courants n'est pas une liste de mots-clés. */
const MOTS_VIDES = new Set(
  'le la les l de des du d un une et ou est sont a au aux en dans sur pour par avec sans ce cet cette ces que qui quoi quand comment combien pourquoi ou mon ma mes ton ta tes son sa ses notre nos votre vos leur leurs je tu il elle on nous vous ils elles me te se y ne pas plus tres the of and to in for is on'.split(' '),
);

export function requeteDeFichiers(demande: string): string | null {
  const tous = plat(demande)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((m) => m.length >= 2);
  const pleins = tous.filter((m) => !MOTS_VIDES.has(m));
  const mots = (pleins.length ? pleins : tous).slice(0, 12);
  if (!mots.length) return null;
  return mots.map((m, i) => (i === mots.length - 1 ? `"${m}"*` : `"${m}"`)).join(' OR ');
}

/**
 * LA FUSION DES DEUX CLASSEMENTS (rang réciproque) : le plein texte trouve le mot exact, le sens trouve la chose
 * décrite autrement ; une entrée bien placée dans les deux passe devant. `k` amortit l'écart entre les premiers rangs,
 * `poids` donne plus de voix à un classement (le sens, pour une question en mots courants).
 */
export function fusionnerLesClassements(classements: readonly (readonly string[])[], k = 60, poids: readonly number[] = []): { id: string; score: number }[] {
  const scores = new Map<string, number>();
  classements.forEach((liste, i) => liste.forEach((id, rang) => scores.set(id, (scores.get(id) ?? 0) + (poids[i] ?? 1) / (k + rang + 1))));
  return [...scores.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/** L'EXTRAIT montré sous un résultat : la phrase autour du premier mot trouvé, sinon le début du texte. */
export function extraitAutour(texte: string, demande: string, largeur = 160): string {
  const net = texte.replace(/\s+/g, ' ').trim();
  if (!net) return '';
  const cible = plat(net);
  const mots = plat(demande)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((m) => m.length >= 3);
  let pos = -1;
  for (const m of mots) {
    pos = cible.indexOf(m);
    if (pos >= 0) break;
  }
  if (pos < 0) return net.length > largeur ? `${net.slice(0, largeur).trim()}…` : net;
  const debut = Math.max(0, pos - Math.floor(largeur / 3));
  const fin = Math.min(net.length, debut + largeur);
  return `${debut > 0 ? '…' : ''}${net.slice(debut, fin).trim()}${fin < net.length ? '…' : ''}`;
}

/** Le texte qu'on donne au vectoriseur pour une entrée (e5 : préfixe « passage: »). */
export function passageDUnFichier(e: { cheminLogique: string; nom: string; texte: string }): string {
  return `passage: ${e.nom}. ${e.cheminLogique.replace(/\//g, ' › ')}. ${e.texte}`.replace(/\s+/g, ' ').slice(0, 1500);
}
