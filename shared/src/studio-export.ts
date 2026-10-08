/**
 * LES RÉGLAGES D'UN EXPORT DU STUDIO — qualité, définition, images par
 * seconde, type de fichier, son, format de l'image.
 *
 * L'export sortait toujours le même fichier : MP4, qualité moyenne, 1080p,
 * 30 images par seconde. Chaque réglage proposé ici a été vérifié contre le
 * moteur de rendu (`hyperframes render --help`, v0.8.134, et sa table
 * `ENCODER_PRESETS`) :
 *
 *  - qualité : `-q draft` (CRF 28), `-q standard` (CRF 18, l'ancien export),
 *    `-q high` (CRF 15), et « maximale » = `-q high --crf 10` ; un MOV garde son
 *    profil fixe (ProRes 4444, transparence) et ignore la qualité ;
 *  - définition : 1080p (la taille de la page), ou 4K par `--resolution`, qui
 *    n'existe que pour les rapports 9:16, 1:1 et 16:9 — PAS pour 4:5 ;
 *  - images par seconde : `--fps` 24, 30 ou 60 ;
 *  - type : `--format` mp4, webm, mov ou gif — un GIF n'a jamais de son ;
 *  - sans le son : la piste audio est retirée après le rendu (ffmpeg `-an`) ;
 *  - image : PNG (la prise du moteur) ou JPG (convertie par ffmpeg).
 *
 * Les défauts redonnent EXACTEMENT l'ancien export. La lecture est tolérante :
 * une valeur inconnue retombe sur son défaut, une combinaison impossible est
 * corrigée — jamais un rendu lancé sur des arguments que le moteur refuserait.
 */
import type { FormatStudio } from './studio.js';

export const QUALITES_EXPORT = ['brouillon', 'standard', 'haute', 'maximale'] as const;
export type QualiteExport = (typeof QUALITES_EXPORT)[number];
export const DEFINITIONS_EXPORT = ['1080p', '4k'] as const;
export type DefinitionExport = (typeof DEFINITIONS_EXPORT)[number];
export const IPS_EXPORT = [24, 30, 60] as const;
export type IpsExport = (typeof IPS_EXPORT)[number];
export const FICHIERS_VIDEO_EXPORT = ['mp4', 'webm', 'mov', 'gif'] as const;
export type FichierVideoExport = (typeof FICHIERS_VIDEO_EXPORT)[number];
export const FICHIERS_IMAGE_EXPORT = ['png', 'jpg'] as const;
export type FichierImageExport = (typeof FICHIERS_IMAGE_EXPORT)[number];

export interface ReglagesExport {
  qualite: QualiteExport;
  definition: DefinitionExport;
  ips: IpsExport;
  fichier: FichierVideoExport;
  sansSon: boolean;
  image: FichierImageExport;
}

/** L'export d'avant : MP4, qualité standard, 1080p, 30 images par seconde, avec le son, image en PNG. */
export const REGLAGES_EXPORT_PAR_DEFAUT: ReglagesExport = {
  qualite: 'standard',
  definition: '1080p',
  ips: 30,
  fichier: 'mp4',
  sansSon: false,
  image: 'png',
};

/** Le préréglage 4K du moteur pour chaque format ; Portrait (4:5) n'en a pas. */
const RESOLUTION_4K: Partial<Record<FormatStudio, string>> = {
  '9:16': 'portrait-4k',
  '1:1': 'square-4k',
  '16:9': 'landscape-4k',
};

export function quatreKPossible(format: FormatStudio): boolean {
  return !!RESOLUTION_4K[format];
}

/** Le son a-t-il un sens pour ce type de fichier ? Un GIF n'en porte jamais. */
export function fichierAvecSon(fichier: FichierVideoExport): boolean {
  return fichier !== 'gif';
}

/** La qualité se règle-t-elle pour ce type ? Un MOV garde son profil fixe, un GIF sa palette. */
export function fichierAvecQualite(fichier: FichierVideoExport): boolean {
  return fichier === 'mp4' || fichier === 'webm';
}

function parmi<T extends string | number>(liste: readonly T[], valeur: unknown, defaut: T): T {
  return liste.includes(valeur as T) ? (valeur as T) : defaut;
}

/** LIT des réglages reçus (écran, base, agent) et les rend possibles pour ce format. */
export function lireReglagesExport(brut: unknown, format: FormatStudio): ReglagesExport {
  const r = (brut && typeof brut === 'object' ? brut : {}) as Record<string, unknown>;
  const d = REGLAGES_EXPORT_PAR_DEFAUT;
  const fichier = parmi(FICHIERS_VIDEO_EXPORT, r.fichier, d.fichier);
  const definition = parmi(DEFINITIONS_EXPORT, r.definition, d.definition);
  return {
    qualite: parmi(QUALITES_EXPORT, r.qualite, d.qualite),
    definition: definition === '4k' && !quatreKPossible(format) ? '1080p' : definition,
    ips: parmi(IPS_EXPORT, typeof r.ips === 'string' ? Number(r.ips) : r.ips, d.ips),
    fichier,
    sansSon: !fichierAvecSon(fichier) || r.sansSon === true,
    image: parmi(FICHIERS_IMAGE_EXPORT, r.image, d.image),
  };
}

/** Les arguments de `hyperframes render` qui portent ces réglages (après le dossier, `-o` et `--workers`). */
export function argumentsDeRendu(reglages: ReglagesExport, format: FormatStudio): string[] {
  const args: string[] = ['--fps', String(reglages.ips), '--format', reglages.fichier];
  if (fichierAvecQualite(reglages.fichier)) {
    const q = { brouillon: 'draft', standard: 'standard', haute: 'high', maximale: 'high' }[reglages.qualite];
    args.push('-q', q);
    if (reglages.qualite === 'maximale') args.push('--crf', '10');
  }
  const r4k = RESOLUTION_4K[format];
  if (reglages.definition === '4k' && r4k) args.push('--resolution', r4k);
  return args;
}

/** L'extension du fichier rendu. */
export function extensionDExport(genre: 'video' | 'image', reglages: ReglagesExport): string {
  return genre === 'video' ? reglages.fichier : reglages.image;
}

/**
 * UN RENDU PLUS LOURD PREND PLUS DE TEMPS. Le délai de base (`duree * 20 s`)
 * suffisait au 1080p à 30 images par seconde ; la 4K quadruple les pixels et 60
 * images doublent les prises — le délai suit, sans quoi un export légitime
 * serait arrêté pour « délai dépassé ».
 */
export function facteurDeDureeDeRendu(reglages: ReglagesExport): number {
  return (reglages.definition === '4k' ? 4 : 1) * (reglages.ips / 30) * (reglages.qualite === 'maximale' ? 1.5 : 1);
}

/**
 * Le rappel des réglages, pour la ligne d'un export : « 4K · 60 i/s · MOV · haute · sans son ».
 * `t` traduit les textes affichés ; sans traducteur, le français brut.
 */
export function resumeReglagesExport(
  genre: 'video' | 'image',
  reglages: ReglagesExport,
  t: (texte: string, valeurs?: { n: number }) => string = (texte, valeurs) => (valeurs ? texte.replace('{n}', String(valeurs.n)) : texte),
): string {
  if (genre === 'image') return reglages.image.toUpperCase();
  const qualites = { brouillon: t('brouillon'), standard: t('standard'), haute: t('haute'), maximale: t('maximale') };
  const morceaux = [reglages.definition === '4k' ? '4K' : '1080p', t('{n} i/s', { n: reglages.ips }), reglages.fichier.toUpperCase()];
  if (fichierAvecQualite(reglages.fichier)) morceaux.push(qualites[reglages.qualite]);
  if (reglages.sansSon && fichierAvecSon(reglages.fichier)) morceaux.push(t('sans son'));
  return morceaux.join(' · ');
}
