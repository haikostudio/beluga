/**
 * LA VISIONNEUSE D'IMAGES — SES RÈGLES PURES.
 *
 * Une seule visionneuse pour l'espace de travail ET l'espace client
 * (`web/src/components/attachment-preview.tsx`) : fenêtre centrée de hauteur
 * fixe, zoom au clic, à la molette et au pincement, carrousel qui BOUCLE, et
 * « tout télécharger » (archive ou fichiers séparés). Ce qui se calcule sans
 * écran vit ici et se teste seul : bornes du zoom, point fixe sous le curseur,
 * bornes du déplacement, rang voisin en boucle, et la référence d'archive
 * d'une image d'après l'adresse qui la sert.
 */

/** Le zoom ne descend jamais sous l'image entière, ni au-delà de cinq fois. */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 5;
/** Le zoom d'un clic (ou d'un double toucher) sur l'image entière. */
export const ZOOM_DU_CLIC = 2.5;

export interface Point {
  x: number;
  y: number;
}

/** L'état de la scène : l'image est posée par `translate(x, y) scale(echelle)`, origine au centre. */
export interface Cadrage {
  echelle: number;
  x: number;
  y: number;
}

export const CADRAGE_INITIAL: Cadrage = { echelle: 1, x: 0, y: 0 };

export function bornerEchelle(echelle: number): number {
  if (!Number.isFinite(echelle)) return ZOOM_MIN;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, echelle));
}

/**
 * La taille de l'image AFFICHÉE à l'échelle 1 : elle tient tout entière dans la
 * scène (`object-contain`), agrandie au besoin pour en occuper la hauteur ou la
 * largeur. Sans taille naturelle connue, c'est la scène entière.
 */
export function tailleContenue(naturelle: { l: number; h: number } | null, scene: { l: number; h: number }): { l: number; h: number } {
  if (!naturelle || naturelle.l <= 0 || naturelle.h <= 0) return scene;
  const facteur = Math.min(scene.l / naturelle.l, scene.h / naturelle.h);
  return { l: naturelle.l * facteur, h: naturelle.h * facteur };
}

/**
 * LE DÉPLACEMENT NE LAISSE JAMAIS DE VIDE ENTRE L'IMAGE ET LE BORD : tant que
 * l'image agrandie dépasse la scène, on la promène jusqu'à son bord, pas
 * au-delà ; dans le sens où elle tient, elle reste centrée.
 */
export function bornerCadrage(cadrage: Cadrage, contenu: { l: number; h: number }, scene: { l: number; h: number }): Cadrage {
  const echelle = bornerEchelle(cadrage.echelle);
  const maxX = Math.max(0, (contenu.l * echelle - scene.l) / 2);
  const maxY = Math.max(0, (contenu.h * echelle - scene.h) / 2);
  const borne = (v: number, max: number) => (max === 0 ? 0 : Math.min(max, Math.max(-max, v)));
  return { echelle, x: borne(cadrage.x, maxX), y: borne(cadrage.y, maxY) };
}

/**
 * ZOOMER AUTOUR D'UN POINT : le point visé (relatif au CENTRE de la scène) reste
 * sous le curseur ou sous les doigts. Avec `translate(t) scale(s)` et l'origine
 * au centre, un point de l'image `u` s'affiche en `t + s·u` : on garde `u`.
 */
export function zoomerAutour(cadrage: Cadrage, nouvelleEchelle: number, point: Point): Cadrage {
  const echelle = bornerEchelle(nouvelleEchelle);
  if (echelle === ZOOM_MIN) return { ...CADRAGE_INITIAL };
  const rapport = echelle / cadrage.echelle;
  return {
    echelle,
    x: point.x - rapport * (point.x - cadrage.x),
    y: point.y - rapport * (point.y - cadrage.y),
  };
}

/** Le clic (ou le double toucher) : image entière ↔ agrandie autour du point visé. */
export function basculerZoom(cadrage: Cadrage, point: Point): Cadrage {
  return cadrage.echelle > ZOOM_MIN + 0.01 ? { ...CADRAGE_INITIAL } : zoomerAutour(cadrage, ZOOM_DU_CLIC, point);
}

/** Le facteur d'un cran de molette ; `pincement` : le pincement du pavé tactile (ctrl + molette), plus vif. */
export function facteurDeMolette(deltaY: number, pincement: boolean): number {
  return Math.exp(-deltaY * (pincement ? 0.01 : 0.0025));
}

/** LE CARROUSEL BOUCLE : après la dernière vient la première, avant la première la dernière. */
export function rangVoisin(rang: number, decalage: number, total: number): number {
  if (total <= 0) return -1;
  return (((rang + decalage) % total) + total) % total;
}

/** Un geste est un clic tant que le pointeur n'a presque pas bougé. */
export const SEUIL_DE_CLIC_PX = 6;

/**
 * LE GLISSEMENT QUI CHANGE D'IMAGE : un quart de la largeur, ou un geste vif
 * (plus de 0,45 px/ms) d'au moins 24 px. Un glissement plus vertical
 * qu'horizontal n'est jamais pris pour un changement d'image.
 */
export function glissementFranchi(dx: number, dy: number, dureeMs: number, largeur: number): -1 | 0 | 1 {
  const ax = Math.abs(dx);
  if (ax < Math.abs(dy) * 1.2) return 0;
  const vif = ax >= 24 && ax / Math.max(1, dureeMs) > 0.45;
  if (ax < largeur * 0.25 && !vif) return 0;
  return dx < 0 ? 1 : -1;
}

/** Ce qu'une image de la visionneuse devient dans l'archive « tout télécharger ». */
export type ReferenceDArchive = { genre: 'piece'; id: string } | { genre: 'capture'; projet: string; chemin: string };

/**
 * LA RÉFÉRENCE D'ARCHIVE SE LIT SUR L'ADRESSE QUI SERT L'IMAGE : une pièce
 * jointe (`/api/attachment?id=…`) ou une capture d'étape de l'agent
 * (`/api/capture?project=…&path=…`). Une autre adresse n'entre pas dans
 * l'archive (null) — l'appelant le dit plutôt que de livrer un lot incomplet.
 */
export function referenceDArchive(adresse: string): ReferenceDArchive | null {
  let url: URL;
  try {
    url = new URL(adresse, 'http://x');
  } catch {
    return null;
  }
  if (url.pathname === '/api/attachment') {
    const id = url.searchParams.get('id');
    return id ? { genre: 'piece', id } : null;
  }
  if (url.pathname === '/api/capture') {
    const projet = url.searchParams.get('project');
    const chemin = url.searchParams.get('path');
    return projet && chemin ? { genre: 'capture', projet, chemin } : null;
  }
  return null;
}

/**
 * LA ROUTE QUI REND L'ARCHIVE DE PLUSIEURS IMAGES, EN DEUX TEMPS.
 *
 * La liste ne passe JAMAIS dans l'adresse : 300 images y faisaient plus de
 * 16 Ko, et le serveur refusait la demande (431) avant même de la lire — le
 * navigateur ne montrait que « Site non disponible ». L'écran ENVOIE d'abord la
 * liste (`POST`, corps `CorpsDArchive`) ; le serveur vérifie tout et rend une
 * adresse COURTE (`?lot=<jeton>`), qu'on télécharge ensuite comme un fichier.
 */
export const ROUTE_ARCHIVE_DES_IMAGES = '/api/attachments/archive';

/** Au plus autant d'images dans une archive : au-delà, le serveur refuse et la visionneuse propose « séparément ». */
export const MAX_IMAGES_PAR_ARCHIVE = 1000;

/** Ce que l'écran envoie pour préparer une archive (corps JSON du `POST`). */
export interface CorpsDArchive {
  ids: string[];
  /** Le projet des captures d'étape, s'il y en a (toutes du même). */
  project?: string;
  chemins: string[];
  nom: string;
}

/** Ce que le serveur rend quand l'archive est prête : son adresse courte. */
export interface LotDArchive {
  adresse: string;
}

/** L'adresse COURTE d'un lot préparé. */
export function adresseDuLot(jeton: string): string {
  return `${ROUTE_ARCHIVE_DES_IMAGES}?lot=${encodeURIComponent(jeton)}`;
}

/**
 * LE CORPS DE LA DEMANDE D'ARCHIVE, ou null si une seule image n'y entre pas
 * (adresse inconnue, ou captures de deux projets différents).
 */
export function corpsDArchive(adresses: string[], nom: string): CorpsDArchive | null {
  const ids: string[] = [];
  const chemins: string[] = [];
  let projet: string | null = null;
  for (const adresse of adresses) {
    const ref = referenceDArchive(adresse);
    if (!ref) return null;
    if (ref.genre === 'piece') ids.push(ref.id);
    else {
      if (projet && projet !== ref.projet) return null;
      projet = ref.projet;
      chemins.push(ref.chemin);
    }
  }
  if (!ids.length && !chemins.length) return null;
  return { ids, ...(projet ? { project: projet } : {}), chemins, nom };
}

/** Le nom de l'archive : sûr pour un système de fichiers, toujours en « .zip ». */
export function nomDArchiveDImages(nom: string | null | undefined): string {
  const propre = (nom ?? '')
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.zip$/i, '')
    .slice(0, 80);
  return `${propre || 'images'}.zip`;
}
