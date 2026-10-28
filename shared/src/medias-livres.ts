import { z } from 'zod';
import { GENRES_DE_MEDIA_EN_FABRICATION } from './media-en-fabrication.js';

/**
 * LES MÉDIAS LIVRÉS PAR UNE DISCUSSION (décision du 20/10/2026, revue le
 * 26/10/2026, capture #e9bd).
 *
 * Toute image, vidéo ou son fini par une discussion est gardé, versions
 * comprises. CHAQUE MÉDIA EST UNE LIGNE DU FIL, À SON HEURE, comme une capture
 * de l'agent : une phrase qui dit ce qui a été rendu (`phraseDuMediaLivre`),
 * puis le média dessous. Plus de rangée de vignettes sous la réponse ni au bas
 * du fil (« on dirait que c'est flanqué là nulle part ») : un média se pose
 * après ce qui l'a précédé dans le temps (`placerLesMediasDansLeFil`).
 */

export const MediaLivre = z.object({
  id: z.string(),
  projectId: z.string(),
  cardId: z.string().nullable().optional(),
  agentId: z.string().nullable().optional(),
  attachmentId: z.string(),
  genre: z.enum(GENRES_DE_MEDIA_EN_FABRICATION),
  /** Le plan ou le sujet : les versions d'un même groupe se suivent. */
  groupe: z.string(),
  version: z.number().int().positive(),
  sujet: z.string().default(''),
  outil: z.string().default(''),
  /** La phrase de l'agent : ce qu'il a rendu et pourquoi. Vide : elle s'écrit d'après le sujet. */
  legende: z.string().default(''),
  livreLe: z.number(),
});
export type MediaLivre = z.infer<typeof MediaLivre>;

/** La clé de groupe d'un sujet : « Plan 2 – v3 » et « plan 2 » vont ensemble. */
export function groupeDuMedia(sujet: string): string {
  return (
    String(sujet ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .replace(/[\s_-]*(?:v|version)\s*\d+\s*$/i, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim() || 'media'
  );
}

/**
 * TOUS LES MÉDIAS, RANGÉS : les groupes dans l'ordre de leur première
 * livraison, et dans chaque groupe les versions croissantes. Rien n'est retiré.
 */
export function mediasLivres<T extends Pick<MediaLivre, 'groupe' | 'version' | 'livreLe'>>(liste: readonly T[]): T[] {
  const premiere = new Map<string, number>();
  for (const m of liste) premiere.set(m.groupe, Math.min(premiere.get(m.groupe) ?? Infinity, m.livreLe));
  return [...liste].sort(
    (a, b) => premiere.get(a.groupe)! - premiere.get(b.groupe)! || a.groupe.localeCompare(b.groupe) || a.version - b.version || a.livreLe - b.livreLe,
  );
}

/**
 * CHAQUE MÉDIA À SA PLACE DANS LE TEMPS : après le dernier repère du fil
 * (message, mot de la discussion, passage) arrivé à son heure ou avant. Un
 * média plus ancien que tous les repères va dans `avant` (en tête du fil).
 * Dans chaque place, les médias se suivent dans l'ordre où ils ont été livrés.
 * Les repères n'ont pas à être triés ; un repère sans heure est ignoré.
 */
export function placerLesMediasDansLeFil<T extends Pick<MediaLivre, 'livreLe' | 'version'>>(
  medias: readonly T[],
  reperes: readonly { cle: string; at?: number | null }[],
): { avant: T[]; apres: Map<string, T[]> } {
  const tries = reperes
    .filter((r): r is { cle: string; at: number } => typeof r.at === 'number' && Number.isFinite(r.at))
    .map((r, rang) => ({ ...r, rang }))
    .sort((a, b) => a.at - b.at || a.rang - b.rang);
  const avant: T[] = [];
  const apres = new Map<string, T[]>();
  const chronologie = [...medias].sort((a, b) => a.livreLe - b.livreLe || a.version - b.version);
  for (const m of chronologie) {
    let cible: string | null = null;
    for (const r of tries) {
      if (r.at > m.livreLe) break;
      cible = r.cle;
    }
    if (cible === null) avant.push(m);
    else apres.set(cible, [...(apres.get(cible) ?? []), m]);
  }
  return { avant, apres };
}

/**
 * LA PHRASE D'UN MÉDIA DU FIL : celle que l'agent a donnée en le rendant,
 * sinon une phrase construite d'après le sujet et la version. Rend le motif
 * à traduire et ses valeurs — l'écran passe par son dictionnaire.
 */
export function phraseDuMediaLivre(m: Pick<MediaLivre, 'legende' | 'sujet' | 'version' | 'genre'>): {
  texte?: string;
  motif?: string;
  valeurs?: Record<string, string | number>;
} {
  const legende = String(m.legende ?? '').trim();
  if (legende) return { texte: legende };
  const sujet = String(m.sujet ?? '').trim();
  /* Les phrases ENTIÈRES, telles que le dictionnaire les connaît (jamais recollées). */
  const motifs = {
    image: { sujet: ['J’ai rendu l’image « {v0} »', 'J’ai rendu l’image « {v0} » · version {v1}'], seul: ['J’ai rendu une image', 'J’ai rendu une image · version {v1}'] },
    video: { sujet: ['J’ai rendu la vidéo « {v0} »', 'J’ai rendu la vidéo « {v0} » · version {v1}'], seul: ['J’ai rendu une vidéo', 'J’ai rendu une vidéo · version {v1}'] },
    son: { sujet: ['J’ai rendu le son « {v0} »', 'J’ai rendu le son « {v0} » · version {v1}'], seul: ['J’ai rendu un son', 'J’ai rendu un son · version {v1}'] },
  } as const;
  const [simple, versionnee] = motifs[m.genre][sujet ? 'sujet' : 'seul'];
  return m.version > 1 ? { motif: versionnee, valeurs: { v0: sujet, v1: m.version } } : { motif: simple, valeurs: { v0: sujet } };
}

/*
 * UN MÉDIA DU FIL INSCRIT DANS LA PRODUCTION (27/10/2026) : tout média de la
 * discussion d'une carte porte son menu « … », même une pièce que la
 * production ne connaissait pas (image d'un autre outil, pièce envoyée,
 * capture regardée). Au premier geste, le démon l'inscrit ; ces règles disent
 * son genre, son nom de plan et son format.
 */

/** Le genre d'une pièce du fil qui se retravaille, ou `null` (PDF, texte…). */
export function genreDePieceDuFil(mime: string | null | undefined): 'image' | 'video' | 'son' | null {
  const m = String(mime ?? '').toLowerCase();
  if (m.startsWith('image/') && m !== 'image/svg+xml') return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'son';
  return null;
}

/** Le nom de plan d'une pièce inscrite : son sujet, sans extension, borné à 80 signes. */
export function planDePieceDuFil(nom: string | null | undefined): string {
  const sans = String(nom ?? '')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (sans || 'media').slice(0, 80).trim();
}

const FORMATS_DU_FIL = [
  { format: '16:9', ratio: 16 / 9 },
  { format: '9:16', ratio: 9 / 16 },
  { format: '1:1', ratio: 1 },
  { format: '4:5', ratio: 4 / 5 },
] as const;

/** Le format de création le plus proche des dimensions mesurées ; sans mesure, celui donné. */
export function formatLePlusProche<D extends '16:9' | '9:16' | '1:1' | '4:5'>(
  largeur: number | null | undefined,
  hauteur: number | null | undefined,
  defaut: D,
): '16:9' | '9:16' | '1:1' | '4:5' {
  if (!largeur || !hauteur || largeur <= 0 || hauteur <= 0) return defaut;
  const r = Math.log(largeur / hauteur);
  return [...FORMATS_DU_FIL].sort((a, b) => Math.abs(Math.log(a.ratio) - r) - Math.abs(Math.log(b.ratio) - r))[0]!.format;
}
