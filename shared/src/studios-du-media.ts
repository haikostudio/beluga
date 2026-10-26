/**
 * LES STUDIOS DE MONTAGE D'UNE CRÉATION DE MÉDIA (décision de l'utilisateur
 * du 26/10/2026 : « chaque type de média aura son studio de montage qui lui
 * est propre ») — règles PURES, sans base ni disque. Les studios ne coûtent
 * RIEN : tout se rend sur le serveur avec ffmpeg, jamais par un service payant.
 *
 *  - LE STUDIO PHOTO : recadrage (libre ou aux formats des réseaux),
 *    redressement, quart de tour, exposition, contraste, hautes lumières,
 *    ombres, température, teinte, saturation, vivacité, netteté, vignettage.
 *    UNE SEULE DÉFINITION, DEUX RENDUS QUI CONCORDENT : la même matrice de
 *    couleur, la même courbe de ton et le même noyau de netteté servent
 *    l'aperçu à l'écran (filtre SVG) ET le rendu final (chaîne ffmpeg) — ce que
 *    l'on voit est ce que l'on télécharge.
 *  - LE STUDIO SON : des pistes (voix, musique, bruitages) et des extraits
 *    placés sur une ligne de temps, coupés, dosés, avec fondus ; le mixage
 *    part en une seule commande ffmpeg (`filter_complex`), en MP3 ou en WAV.
 *  - LES MÉDIAS FINAUX : ce que les studios ont rendu, rangés sur la carte
 *    (`realisation.finaux`) et repris en tête de la page Téléchargement.
 */

import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* 1. Les médias finaux                                                 */
/* ------------------------------------------------------------------ */

export const MediaFinal = z.object({
  /** La pièce jointe rendue. */
  piece: z.string(),
  genre: z.enum(['image', 'video', 'son']),
  /** Le média (ou la pièce jointe) d'où vient le rendu : une photo retouchée remplace son original au téléchargement. */
  source: z.string().nullable().optional(),
  /** Un nom lisible (« portrait-recadre »). */
  nom: z.string().optional(),
  /** Le studio qui l'a rendu. */
  studio: z.enum(['photo', 'son', 'video']).optional(),
  at: z.number(),
});
export type MediaFinal = z.infer<typeof MediaFinal>;

/** Ajoute (ou remplace, pour une même source et un même studio) un média final. */
export function ajouterUnFinal(finaux: readonly MediaFinal[] | undefined, final: MediaFinal): MediaFinal[] {
  const restants = (finaux ?? []).filter((f) => !(final.source && f.source === final.source && f.studio === final.studio) && f.piece !== final.piece);
  return [...restants, final];
}

/* ------------------------------------------------------------------ */
/* 2. Le studio photo                                                   */
/* ------------------------------------------------------------------ */

export const FORMATS_DE_RECADRAGE = ['libre', '1:1', '4:5', '9:16', '16:9', '3:2'] as const;
export type FormatDeRecadrage = (typeof FORMATS_DE_RECADRAGE)[number];

const curseur = z.number().min(-100).max(100).default(0);

export const ReglagesPhoto = z.object({
  /** Le cadre gardé, en fractions de l'image redressée (0 à 1). Absent : l'image entière. */
  recadrage: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), largeur: z.number().min(0.02).max(1), hauteur: z.number().min(0.02).max(1) }).optional(),
  format: z.enum(FORMATS_DE_RECADRAGE).default('libre'),
  /** Quarts de tour dans le sens des aiguilles d'une montre (0 à 3). */
  quartDeTour: z.number().int().min(0).max(3).default(0),
  /** Le redressement fin, en degrés (−45 à 45). */
  redressement: z.number().min(-45).max(45).default(0),
  exposition: curseur,
  contraste: curseur,
  hautesLumieres: curseur,
  ombres: curseur,
  temperature: curseur,
  teinte: curseur,
  saturation: curseur,
  vivacite: curseur,
  nettete: z.number().min(0).max(100).default(0),
  vignettage: z.number().min(0).max(100).default(0),
});
export type ReglagesPhoto = z.infer<typeof ReglagesPhoto>;

export const CURSEURS_DE_LA_PHOTO = ['exposition', 'contraste', 'hautesLumieres', 'ombres', 'temperature', 'teinte', 'saturation', 'vivacite', 'nettete', 'vignettage'] as const;
export type CurseurDeLaPhoto = (typeof CURSEURS_DE_LA_PHOTO)[number];

export const LIBELLES_CURSEURS_DE_LA_PHOTO: Record<CurseurDeLaPhoto, string> = {
  exposition: 'Exposition',
  contraste: 'Contraste',
  hautesLumieres: 'Hautes lumières',
  ombres: 'Ombres',
  temperature: 'Température',
  teinte: 'Teinte',
  saturation: 'Saturation',
  vivacite: 'Vivacité',
  nettete: 'Netteté',
  vignettage: 'Vignettage',
};

export function reglagesPhotoNeutres(): ReglagesPhoto {
  return ReglagesPhoto.parse({});
}

/** Les réglages lus avec tolérance : une valeur hors bornes est ramenée dedans, une inconnue retombe à zéro. */
export function reglagesPhotoLus(brut: unknown): ReglagesPhoto {
  const b = (brut && typeof brut === 'object' ? brut : {}) as Record<string, unknown>;
  const borne = (v: unknown, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : 0;
  };
  const r = reglagesPhotoNeutres();
  for (const c of CURSEURS_DE_LA_PHOTO) (r as unknown as Record<string, number>)[c] = Math.round(borne(b[c], c === 'nettete' || c === 'vignettage' ? 0 : -100, 100));
  r.quartDeTour = ((Math.round(borne(b.quartDeTour, 0, 3)) % 4) + 4) % 4;
  r.redressement = Math.round(borne(b.redressement, -45, 45) * 10) / 10;
  r.format = (FORMATS_DE_RECADRAGE as readonly string[]).includes(String(b.format)) ? (b.format as FormatDeRecadrage) : 'libre';
  const c = b.recadrage as Record<string, unknown> | undefined;
  if (c && typeof c === 'object') {
    const x = borne(c.x, 0, 1);
    const y = borne(c.y, 0, 1);
    const largeur = Math.max(0.02, Math.min(1 - x, borne(c.largeur, 0, 1)));
    const hauteur = Math.max(0.02, Math.min(1 - y, borne(c.hauteur, 0, 1)));
    if (!(x === 0 && y === 0 && largeur >= 0.999 && hauteur >= 0.999)) r.recadrage = { x, y, largeur, hauteur };
  }
  return r;
}

/** Des réglages qui ne changent rien : le rendu serait l'original. */
export function photoInchangee(r: ReglagesPhoto): boolean {
  return !r.recadrage && !r.quartDeTour && !r.redressement && CURSEURS_DE_LA_PHOTO.every((c) => !r[c]);
}

/** Le rapport largeur/hauteur d'un format de recadrage (`null` : libre). */
export function rapportDuFormat(format: FormatDeRecadrage): number | null {
  if (format === 'libre') return null;
  const [l, h] = format.split(':').map(Number);
  return l! / h!;
}

/**
 * LE CADRE D'UN FORMAT, le plus grand possible et centré, dans une image de
 * `largeur` × `hauteur` pixels — en fractions de l'image.
 */
export function cadreDuFormat(format: FormatDeRecadrage, largeur: number, hauteur: number): { x: number; y: number; largeur: number; hauteur: number } | undefined {
  const rapport = rapportDuFormat(format);
  if (!rapport || largeur <= 0 || hauteur <= 0) return undefined;
  const image = largeur / hauteur;
  if (image > rapport) {
    const l = rapport / image;
    return { x: (1 - l) / 2, y: 0, largeur: l, hauteur: 1 };
  }
  const h = image / rapport;
  return { x: 0, y: (1 - h) / 2, largeur: 1, hauteur: h };
}

/** Les dimensions après les quarts de tour. */
export function dimensionsTournees(largeur: number, hauteur: number, quartDeTour: number): { largeur: number; hauteur: number } {
  return quartDeTour % 2 ? { largeur: hauteur, hauteur: largeur } : { largeur, hauteur };
}

/**
 * LE REDRESSEMENT SANS COINS VIDES : la part de l'image (même proportion,
 * centrée) qui reste entièrement couverte une fois tournée de `degres`.
 */
export function facteurDeRedressement(largeur: number, hauteur: number, degres: number): number {
  const a = (Math.abs(degres) * Math.PI) / 180;
  if (!a || largeur <= 0 || hauteur <= 0) return 1;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return Math.min(largeur / (largeur * c + hauteur * s), hauteur / (largeur * s + hauteur * c));
}

/**
 * LA MATRICE DE COULEUR (3 × 3, lignes R, G, B) : exposition (±1 diaphragme),
 * saturation et vivacité (la matrice de saturation du CSS, qui garde la
 * luminance), température (bleu ↔ orangé) et teinte (vert ↔ magenta).
 */
export function matriceDeCouleur(r: Pick<ReglagesPhoto, 'exposition' | 'saturation' | 'vivacite' | 'temperature' | 'teinte'>): number[][] {
  const b = 2 ** (r.exposition / 100);
  const s = Math.max(0, (1 + r.saturation / 100) * (1 + r.vivacite / 200));
  const sat = [
    [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
    [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
    [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s],
  ];
  const t = r.temperature / 100;
  const g = r.teinte / 100;
  const diag = [(1 + 0.18 * t) * (1 + 0.04 * g), 1 - 0.12 * g, (1 - 0.18 * t) * (1 + 0.04 * g)];
  return sat.map((ligne, i) => ligne.map((v) => Math.round(v * diag[i]! * b * 1e5) / 1e5));
}

/**
 * LA COURBE DE TON, appliquée à chaque canal (0 à 1) : le contraste autour
 * du gris moyen, puis les ombres (relevées ou creusées, surtout sous le tiers)
 * et les hautes lumières (surtout au-dessus des deux tiers).
 */
export function courbeDeTon(r: Pick<ReglagesPhoto, 'contraste' | 'ombres' | 'hautesLumieres'>): (v: number) => number {
  const k = 1 + r.contraste / 100;
  const sh = r.ombres / 100;
  const hl = r.hautesLumieres / 100;
  const borne = (v: number) => Math.max(0, Math.min(1, v));
  return (v: number) => {
    const v1 = borne((v - 0.5) * k + 0.5);
    const v2 = borne(v1 + sh * 0.6 * v1 * (1 - v1) ** 2);
    return borne(v2 + hl * 0.6 * v2 * v2 * (1 - v2));
  };
}

/** La courbe échantillonnée, pour l'aperçu (`feComponentTransfer`, type « table »). */
export function tableDeTon(r: Pick<ReglagesPhoto, 'contraste' | 'ombres' | 'hautesLumieres'>, points = 65): number[] {
  const f = courbeDeTon(r);
  return Array.from({ length: points }, (_, i) => Math.round(f(i / (points - 1)) * 1e4) / 1e4);
}

/** La courbe en expression ffmpeg (`lutrgb`), mot pour mot la même que `courbeDeTon`. */
export function expressionDeTon(r: Pick<ReglagesPhoto, 'contraste' | 'ombres' | 'hautesLumieres'>): string {
  const k = 1 + r.contraste / 100;
  const sh = (r.ombres / 100) * 0.6;
  const hl = (r.hautesLumieres / 100) * 0.6;
  const n = (x: number) => Number(x.toFixed(5)).toString();
  const v1 = `clip((val/255-0.5)*${n(k)}+0.5,0,1)`;
  return `st(1,${v1});st(2,clip(ld(1)+${n(sh)}*ld(1)*pow(1-ld(1),2),0,1));clip(255*(ld(2)+${n(hl)}*ld(2)*ld(2)*(1-ld(2))),0,255)`;
}

/** Le noyau de netteté (3 × 3, somme 1) ; l'identité à zéro. */
export function noyauDeNettete(nettete: number): number[] {
  const a = Math.max(0, Math.min(100, nettete)) / 100 * 0.6;
  return [0, -a, 0, -a, 1 + 4 * a, -a, 0, -a, 0].map((v) => Math.round(v * 1e4) / 1e4);
}

/** L'assombrissement des coins (0 à 1) : la même force à l'écran et au rendu. */
export function forceDuVignettage(vignettage: number): number {
  return Math.max(0, Math.min(100, vignettage)) / 100;
}

/**
 * LA CHAÎNE FFMPEG DU RENDU (`-vf`), dans l'ordre : quarts de tour,
 * redressement sans coins vides, recadrage, matrice de couleur, courbe de ton,
 * netteté, vignettage. Les virgules des expressions sont protégées.
 */
export function filtresFfmpegDeLaPhoto(r: ReglagesPhoto, dimensions: { largeur: number; hauteur: number }): string {
  const filtres: string[] = [];
  if (r.quartDeTour === 1) filtres.push('transpose=1');
  if (r.quartDeTour === 2) filtres.push('hflip', 'vflip');
  if (r.quartDeTour === 3) filtres.push('transpose=2');
  const tournee = dimensionsTournees(dimensions.largeur, dimensions.hauteur, r.quartDeTour);
  if (r.redressement) {
    const k = facteurDeRedressement(tournee.largeur, tournee.hauteur, r.redressement);
    filtres.push(`rotate=${((r.redressement * Math.PI) / 180).toFixed(6)}:ow=iw:oh=ih:c=black`);
    filtres.push(`crop=trunc(iw*${k.toFixed(6)}/2)*2:trunc(ih*${k.toFixed(6)}/2)*2`);
  }
  if (r.recadrage) {
    const c = r.recadrage;
    const f = (x: number) => x.toFixed(6);
    filtres.push(`crop=trunc(iw*${f(c.largeur)}/2)*2:trunc(ih*${f(c.hauteur)}/2)*2:trunc(iw*${f(c.x)}):trunc(ih*${f(c.y)})`);
  }
  const m = matriceDeCouleur(r);
  const neutre = m.every((ligne, i) => ligne.every((v, j) => Math.abs(v - (i === j ? 1 : 0)) < 1e-6));
  filtres.push('format=rgb24');
  if (!neutre) {
    const noms = ['r', 'g', 'b'];
    filtres.push(`colorchannelmixer=${m.flatMap((ligne, i) => ligne.map((v, j) => `${noms[i]}${noms[j]}=${v}`)).join(':')}`);
  }
  if (r.contraste || r.ombres || r.hautesLumieres) {
    const e = expressionDeTon(r).replace(/,/g, '\\,').replace(/;/g, '\\;');
    filtres.push(`lutrgb=r=${e}:g=${e}:b=${e}`);
  }
  if (r.nettete) {
    const noyau = noyauDeNettete(r.nettete).map((v) => Math.round(v * 100));
    const matrice = noyau.join(' ');
    filtres.push('format=gbrp', `convolution=0m=${matrice}:1m=${matrice}:2m=${matrice}:0rdiv=0.01:1rdiv=0.01:2rdiv=0.01`);
  }
  if (r.vignettage) filtres.push(`vignette=a=${((Math.PI / 3) * forceDuVignettage(r.vignettage)).toFixed(4)}`);
  return filtres.join(',');
}

/* ------------------------------------------------------------------ */
/* 3. Le studio son                                                     */
/* ------------------------------------------------------------------ */

export const PISTES_DU_STUDIO_SON = ['voix', 'musique', 'bruitages'] as const;
export type PisteDuStudioSon = (typeof PISTES_DU_STUDIO_SON)[number];

export const LIBELLES_PISTES_DU_STUDIO_SON: Record<PisteDuStudioSon, string> = {
  voix: 'Voix',
  musique: 'Musique',
  bruitages: 'Bruitages',
};

export const ExtraitSonore = z.object({
  id: z.string(),
  piste: z.enum(PISTES_DU_STUDIO_SON),
  /** La pièce jointe du son. */
  piece: z.string(),
  /** Le média de production d'où il vient. */
  mediaId: z.string().nullable().optional(),
  nom: z.string().default(''),
  /** Où l'extrait commence sur la ligne de temps, en secondes. */
  debut: z.number().min(0).default(0),
  /** Où l'on entre dans le fichier source (coupe du début), en secondes. */
  entree: z.number().min(0).default(0),
  /** La durée gardée, en secondes. */
  duree: z.number().min(0.05),
  /** Le volume de l'extrait (1 : tel quel). */
  volume: z.number().min(0).max(2).default(1),
  fonduEntree: z.number().min(0).default(0),
  fonduSortie: z.number().min(0).default(0),
});
export type ExtraitSonore = z.infer<typeof ExtraitSonore>;

export const MontageSon = z.object({
  extraits: z.array(ExtraitSonore).default([]),
  /** Le volume de chaque piste, et les pistes coupées. */
  volumes: z.record(z.enum(PISTES_DU_STUDIO_SON), z.number().min(0).max(2)).default({}),
  muettes: z.array(z.enum(PISTES_DU_STUDIO_SON)).default([]),
  /** Égaliser le niveau final (− 16 LUFS, la norme des réseaux et des plateformes). */
  normaliser: z.boolean().default(true),
  majA: z.number().optional(),
});
export type MontageSon = z.infer<typeof MontageSon>;

export const FORMATS_DU_STUDIO_SON = ['mp3', 'wav'] as const;
export type FormatDuStudioSon = (typeof FORMATS_DU_STUDIO_SON)[number];

/** La durée du montage : la fin du dernier extrait entendu. */
export function dureeDuMontageSon(m: Pick<MontageSon, 'extraits' | 'muettes'>): number {
  return Math.max(0, ...m.extraits.filter((x) => !m.muettes.includes(x.piste)).map((x) => x.debut + x.duree));
}

/** Les extraits qu'on entend, avec leur volume final (extrait × piste). */
export function extraitsEntendus(m: MontageSon): (ExtraitSonore & { gain: number })[] {
  return m.extraits
    .filter((x) => !m.muettes.includes(x.piste) && x.duree > 0)
    .map((x) => ({ ...x, gain: Math.round(x.volume * (m.volumes[x.piste] ?? 1) * 1e4) / 1e4 }))
    .filter((x) => x.gain > 0);
}

/**
 * LE MIXAGE EN UNE COMMANDE FFMPEG : les entrées (une par extrait entendu,
 * dans l'ordre), le `filter_complex` et l'étiquette de sortie. Chaque extrait
 * est coupé (`atrim`), fondu (`afade`), dosé (`volume`) et placé (`adelay`) ;
 * le tout se mélange sans baisser chaque entrée (`amix`, `normalize=0`), puis
 * s'égalise (`loudnorm`) si on l'a demandé. Rend `null` sans rien à entendre.
 */
export function mixageFfmpeg(m: MontageSon, cheminDe: (piece: string) => string): { entrees: string[]; filtre: string; sortie: string; duree: number } | null {
  const extraits = extraitsEntendus(m);
  if (!extraits.length) return null;
  const n = (x: number) => Number(x.toFixed(3)).toString();
  const morceaux: string[] = [];
  extraits.forEach((x, i) => {
    const fi = Math.min(x.fonduEntree, x.duree / 2);
    const fo = Math.min(x.fonduSortie, x.duree / 2);
    const etapes = [
      `atrim=start=${n(x.entree)}:duration=${n(x.duree)}`,
      'asetpts=PTS-STARTPTS',
      'aformat=sample_rates=48000:channel_layouts=stereo',
      ...(fi > 0 ? [`afade=t=in:st=0:d=${n(fi)}`] : []),
      ...(fo > 0 ? [`afade=t=out:st=${n(Math.max(0, x.duree - fo))}:d=${n(fo)}`] : []),
      `volume=${n(x.gain)}`,
      ...(x.debut > 0 ? [`adelay=delays=${Math.round(x.debut * 1000)}:all=1`] : []),
    ];
    morceaux.push(`[${i}:a]${etapes.join(',')}[a${i}]`);
  });
  const fin = m.normaliser ? ',loudnorm=I=-16:TP=-1.5:LRA=11' : '';
  if (extraits.length === 1) morceaux.push(`[a0]anull${fin}[sortie]`);
  else morceaux.push(`${extraits.map((_, i) => `[a${i}]`).join('')}amix=inputs=${extraits.length}:normalize=0:dropout_transition=0:duration=longest${fin}[sortie]`);
  return { entrees: extraits.map((x) => cheminDe(x.piece)), filtre: morceaux.join(';'), sortie: '[sortie]', duree: dureeDuMontageSon(m) };
}

/** Les arguments de sortie d'un format audio. */
export function argumentsDuFormatSon(format: FormatDuStudioSon): string[] {
  return format === 'wav' ? ['-c:a', 'pcm_s16le', '-ar', '48000'] : ['-c:a', 'libmp3lame', '-b:a', '192k', '-ar', '48000'];
}

/**
 * LE PREMIER MONTAGE D'UN STUDIO SON : chaque son validé posé sur sa piste,
 * les voix les unes après les autres, la musique et les bruitages au début.
 */
export function montageSonDeDepart(
  sons: readonly { mediaId: string; piece: string; nom: string; capacite: string; duree: number | null }[],
): MontageSon {
  let finDesVoix = 0;
  const extraits: ExtraitSonore[] = sons.map((s, i) => {
    const piste: PisteDuStudioSon = s.capacite === 'voix' ? 'voix' : s.capacite === 'musique' ? 'musique' : 'bruitages';
    const duree = Math.max(0.5, s.duree ?? 10);
    const debut = piste === 'voix' ? finDesVoix : 0;
    if (piste === 'voix') finDesVoix += duree;
    return ExtraitSonore.parse({ id: `x${i + 1}`, piste, piece: s.piece, mediaId: s.mediaId, nom: s.nom, debut, entree: 0, duree, volume: piste === 'musique' ? 0.6 : 1, fonduEntree: piste === 'musique' ? 0.5 : 0, fonduSortie: piste === 'musique' ? 1 : 0 });
  });
  return MontageSon.parse({ extraits });
}
