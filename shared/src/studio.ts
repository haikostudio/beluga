/**
 * LE STUDIO — visuels fixes et vidéos animées, fabriqués pièce par pièce.
 *
 * Une CRÉATION n'est jamais une vidéo aplatie : c'est une COMPOSITION, une
 * donnée structurée faite de PISTES qui portent des SEGMENTS (un dessin, un
 * texte, une image importée, un son, une voix, des sous-titres). L'aperçu ET
 * l'export partent de la MÊME traduction (`studio-page.ts`) : ce qu'on voit est
 * ce qui sort.
 *
 * LE VISUEL PAR DÉFAUT EST UN DESSIN EN CODE (décision du 05/10/2026) : l'agent
 * du studio l'écrit en HTML/SVG/CSS, animé par une chronologie GSAP pilotée à la
 * seconde. Ce qui se règle (textes, couleurs, tailles) est DÉCLARÉ en paramètres ;
 * ce que l'utilisateur déplace à la main est une RETOUCHE — une donnée posée à
 * côté du gabarit, jamais une réécriture, qui survit donc à un redessin partiel.
 *
 * Ce fichier ne contient que des règles pures : types, validation, opérations,
 * recalage des voix, alignement des mots, devis. Le nettoyage d'un dessin vit
 * dans `studio-dessin.ts`, la traduction en page dans `studio-page.ts`, les
 * consignes de l'agent dans `studio-agent.ts`.
 */

/* ------------------------------------------------------------------ */
/* Formats, genres, recettes                                           */
/* ------------------------------------------------------------------ */

/** Les quatre formats des réseaux, en pixels réels de l'export. */
import { type AncrePiece, lireAncre } from './studio-ancres.js';
import type { ReglagesExport } from './studio-export.js';

export const FORMATS_STUDIO = {
  '9:16': { largeur: 1080, hauteur: 1920, libelle: 'Vertical' },
  '1:1': { largeur: 1080, hauteur: 1080, libelle: 'Carré' },
  '4:5': { largeur: 1080, hauteur: 1350, libelle: 'Portrait' },
  '16:9': { largeur: 1920, hauteur: 1080, libelle: 'Horizontal' },
} as const;

export type FormatStudio = keyof typeof FORMATS_STUDIO;
export const CLES_FORMATS_STUDIO = Object.keys(FORMATS_STUDIO) as FormatStudio[];

export function estFormatStudio(valeur: unknown): valeur is FormatStudio {
  return typeof valeur === 'string' && Object.prototype.hasOwnProperty.call(FORMATS_STUDIO, valeur);
}

export const GENRES_SEGMENT = ['dessin', 'texte', 'image', 'video', 'audio', 'voix', 'sous-titres'] as const;
export type GenreSegment = (typeof GENRES_SEGMENT)[number];

/** Ce qu'une piste accepte : on ne pose pas une voix sur une piste d'images. */
export const GENRES_PISTE = ['visuel', 'son', 'sous-titres'] as const;
export type GenrePiste = (typeof GENRES_PISTE)[number];

export function genreDePisteDuSegment(genre: GenreSegment): GenrePiste {
  if (genre === 'audio' || genre === 'voix') return 'son';
  if (genre === 'sous-titres') return 'sous-titres';
  return 'visuel';
}

/**
 * LES RECETTES D'ENTRÉE ET DE SORTIE, une liste NOMMÉE et fermée : 0,4 s, nettes
 * (compétence « video-animee-hyperframes-assemblyai » : les transitions lentes
 * paraissent flottantes). Un nom inconnu vaut « aucune ».
 */
export const RECETTES_ANIMATION = ['aucune', 'fondu', 'glisse-haut', 'glisse-bas', 'glisse-gauche', 'glisse-droite', 'zoom', 'flou'] as const;
export type RecetteAnimation = (typeof RECETTES_ANIMATION)[number];
export const DUREE_TRANSITION_STUDIO = 0.4;

export function recetteValide(valeur: unknown): RecetteAnimation {
  return (RECETTES_ANIMATION as readonly string[]).includes(String(valeur)) ? (valeur as RecetteAnimation) : 'aucune';
}

/** Une scène dure ce que sa ligne demande, six secondes au plus (règle de style, non bloquante). */
export const DUREE_SCENE_CONSEILLEE_MAX = 6;
/** Plus court qu'une image à 30 i/s n'a aucun sens. */
export const DUREE_SEGMENT_MIN = 0.1;
/**
 * AUCUNE LIMITE DE DURÉE (décision de l'utilisateur, 05/10/2026) : l'ancien
 * plafond de 180 s a disparu. Cette borne n'est PAS une limite de produit, seulement
 * un garde-fou contre une valeur absurde reçue (une journée entière).
 */
export const DUREE_ABSURDE = 86_400;
/** La durée voulue d'une création NEUVE : le marqueur bleu de la ligne de temps. */
export const DUREE_VOULUE_PAR_DEFAUT = 15;

/* ------------------------------------------------------------------ */
/* Les pièces d'une composition                                        */
/* ------------------------------------------------------------------ */

export const ALIGNEMENTS_TEXTE = ['gauche', 'centre', 'droite', 'justifie'] as const;
export type AlignementTexte = (typeof ALIGNEMENTS_TEXTE)[number];
export const ALIGNEMENTS_VERTICAUX = ['haut', 'milieu', 'bas'] as const;
export type AlignementVertical = (typeof ALIGNEMENTS_VERTICAUX)[number];
export const DECORATIONS_TEXTE = ['aucune', 'souligne', 'barre'] as const;
export type DecorationTexte = (typeof DECORATIONS_TEXTE)[number];
export const CASSES_TEXTE = ['aucune', 'majuscules', 'minuscules', 'capitales'] as const;
export type CasseTexte = (typeof CASSES_TEXTE)[number];
export const POSITIONS_CONTOUR = ['interieur', 'centre', 'exterieur'] as const;
export type PositionContour = (typeof POSITIONS_CONTOUR)[number];
export const STYLES_CONTOUR = ['plein', 'tirets', 'pointilles'] as const;
export type StyleContour = (typeof STYLES_CONTOUR)[number];
export const CADRAGES_IMAGE = ['couvrir', 'contenir'] as const;
export type CadrageImage = (typeof CADRAGES_IMAGE)[number];
/** Les modes de fusion (`mix-blend-mode`), dans l'ordre de Figma. */
export const MODES_FUSION = ['normal', 'multiply', 'darken', 'color-burn', 'screen', 'lighten', 'color-dodge', 'overlay', 'soft-light', 'hard-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'] as const;
export type ModeFusion = (typeof MODES_FUSION)[number];
export const GENRES_OMBRE = ['portee', 'interieure', 'texte'] as const;
export type GenreOmbre = (typeof GENRES_OMBRE)[number];
/** Quatre valeurs en pixels, dans l'ordre CSS : haut, droite, bas, gauche (ou les coins dans le sens des aiguilles d'une montre). */
export type Quatre = [number, number, number, number];
/** Une ombre : portée (sous la pièce), intérieure (dans la pièce) ou celle des lettres d'un texte. */
export interface OmbrePiece {
  genre: GenreOmbre;
  x: number;
  y: number;
  flou: number;
  /** L'étalement (sans effet sur l'ombre des lettres). */
  etalement: number;
  couleur: string;
}
/** Un dégradé : linéaire (angle en degrés) ou radial, et ses arrêts (position en %). */
export interface Degrade {
  genre: 'lineaire' | 'radial';
  angle: number;
  arrets: { couleur: string; position: number }[];
}
export const OMBRES_MAX = 8;

/** Une retouche à la main d'UN élément (`data-studio-id`) d'un segment. */
export interface Retouche {
  /** Décalage en pixels de la composition, à partir de la place dessinée. */
  x?: number;
  y?: number;
  echelle?: number;
  /** En degrés. */
  rotation?: number;
  /** 0 à 1. */
  opacite?: number;
  /** Le texte réécrit à la main ; ses retours à la ligne (`\n`) sont rendus tels quels. */
  texte?: string;
  /** Couleur du texte (et remplissage d'un dessin SVG). */
  couleur?: string;
  /** Couleur de fond d'une forme (`background-color`). */
  fond?: string;
  /**
   * LA TAILLE DU CADRE, en pixels de la composition : un coin tiré sur un TEXTE
   * agrandit son cadre (le texte se réenroule), sans toucher sa police.
   */
  largeur?: number;
  hauteur?: number;
  /** La taille de la police, en pixels de la composition. */
  taillePolice?: number;
  /** L'alignement des lignes d'un texte dans son cadre. */
  alignement?: AlignementTexte;
  /** Le CONTOUR de la pièce : sa couleur et son épaisseur (trait intérieur, la pièce ne change pas de taille). */
  contour?: string;
  epaisseurContour?: number;
  /** L'arrondi des coins, en pixels de la composition. */
  arrondi?: number;
  /** L'arrondi COIN PAR COIN (haut gauche, haut droit, bas droit, bas gauche) : il l'emporte sur `arrondi`. */
  arrondiCoins?: Quatre;
  /** Où passe le trait du contour : dedans (défaut, la pièce ne grossit pas), à cheval, ou dehors. */
  contourPosition?: PositionContour;
  contourStyle?: StyleContour;
  /** Un DÉGRADÉ en remplissage (posé par-dessus la couleur de fond) ; sans effet sur une forme SVG. */
  degrade?: Degrade;
  /** LA TYPOGRAPHIE d'un texte : une police embarquée (`POLICES_STUDIO`), sa graisse, son rythme. */
  police?: string;
  /** 100 à 900. */
  graisse?: number;
  /** En multiple de la taille des lettres (1,2 = 120 %). */
  interligne?: number;
  /** En pixels de la composition, négatif pour resserrer. */
  espacementLettres?: number;
  italique?: boolean;
  decoration?: DecorationTexte;
  casse?: CasseTexte;
  /** Où tiennent les lignes dans la HAUTEUR du cadre. */
  alignementVertical?: AlignementVertical;
  /** Les MARGES (haut, droite, bas, gauche) : intérieures (`padding`) et extérieures (`margin`). */
  marges?: Quatre;
  margesExterieures?: Quatre;
  /** Les OMBRES, de la première (au-dessus) à la dernière : portée, intérieure, ou ombre des lettres. */
  ombres?: OmbrePiece[];
  /** Le FLOU de la pièce elle-même, et celui de ce qu'il y a derrière elle (verre dépoli), en pixels. */
  flou?: number;
  flouArrierePlan?: number;
  /** Le MODE DE FUSION de la pièce avec ce qu'il y a dessous. */
  fusion?: ModeFusion;
  /** Rogner ce qui dépasse du cadre (vrai), ou le laisser déborder (faux) ; absent : comme le dessin. */
  rogner?: boolean;
  /** UNE IMAGE : comment elle tient dans son cadre, et le média du projet qu'elle montre à la place du sien. */
  cadrage?: CadrageImage;
  source?: string;
  /** Pièce cachée (panneau « Calques ») : absente de l'aperçu ET de l'export. */
  masquee?: boolean;
  /**
   * Plan de la pièce parmi ses voisines : positif = plus en avant, négatif =
   * plus en arrière. Appliqué en RÉORDONNANT les pièces sœurs dans la page
   * (`studio-page.ts`), ce qui vaut aussi pour un dessin SVG.
   */
  plan?: number;
  /**
   * Le REPÈRE où la pièce a été aimantée (`studio-ancres.ts`) : bord, marge de
   * sécurité ou centre, par axe. Dans un autre format, la page la recale sur le
   * même repère (`studio-page.ts`) ; un axe sans ancre suit le cadre en
   * proportion. Un déplacement libre l'efface.
   */
  ancre?: AncrePiece;
}

export const TYPES_PARAMETRE = ['texte', 'couleur', 'nombre', 'choix', 'bascule', 'media'] as const;
export type TypeParametre = (typeof TYPES_PARAMETRE)[number];
export type ValeurParametre = string | number | boolean;

/** Un réglage DÉCLARÉ par l'agent : c'est ce que l'inspecteur montre. */
export interface ParametreDessin {
  id: string;
  type: TypeParametre;
  libelle: string;
  defaut: ValeurParametre;
  options?: string[];
  min?: number;
  max?: number;
  pas?: number;
  /** Pour un nombre : l'unité ajoutée à la variable CSS (« px », « % »…). */
  unite?: string;
}

/** Le gabarit d'un dessin : un fragment HTML/SVG, sa feuille de style, sa chronologie. */
export interface GabaritDessin {
  html: string;
  css: string;
  /**
   * Le CORPS d'une fonction `(tl, el, p, studio)` : `tl` est la chronologie du
   * segment (0 = début du segment), `el` sa racine, `p` les valeurs des
   * paramètres, `studio` la taille du cadre et la durée.
   */
  animation: string;
}

/** Les réglages propres à un format (une même création se décline). */
export interface SurchargeDeFormat {
  retouches?: Record<string, Retouche>;
}

interface SegmentCommun {
  id: string;
  /** En secondes, depuis le début de la composition. */
  debut: number;
  duree: number;
  nom?: string;
  entree?: RecetteAnimation;
  sortie?: RecetteAnimation;
  /** Par format autre que celui de la composition. */
  surcharges?: Partial<Record<FormatStudio, SurchargeDeFormat>>;
  retouches?: Record<string, Retouche>;
}

export interface SegmentDessin extends SegmentCommun {
  genre: 'dessin';
  gabarit: GabaritDessin;
  parametres: ParametreDessin[];
  valeurs: Record<string, ValeurParametre>;
  /** Les `data-studio-id` trouvés au dernier nettoyage. */
  elements?: string[];
}

export interface SegmentTexte extends SegmentCommun {
  genre: 'texte';
  texte: string;
  /** Taille en pixels de la composition. */
  taille: number;
  couleur: string;
  /** Centre du bloc, en pourcentage du cadre. */
  position: { x: number; y: number };
  gras?: boolean;
  police?: string;
}

export interface SegmentImage extends SegmentCommun {
  genre: 'image';
  mediaId: string;
  ajustement: 'couvrir' | 'contenir';
}

export interface SegmentVideo extends SegmentCommun {
  genre: 'video';
  mediaId: string;
  ajustement: 'couvrir' | 'contenir';
  /** Où la lecture du fichier commence, en secondes. */
  debutMedia: number;
  volume: number;
  /** La vitesse de lecture (0,25 à 4) ; absente = 1. Le bloc couvre (passage joué) / vitesse. */
  vitesse?: number;
  /** Les fondus du SON de la vidéo, en secondes. */
  fonduEntree?: number;
  fonduSortie?: number;
}

export interface SegmentAudio extends SegmentCommun {
  genre: 'audio';
  mediaId: string;
  debutMedia: number;
  volume: number;
  fonduEntree?: number;
  fonduSortie?: number;
  vitesse?: number;
}

/**
 * LA VITESSE DE LECTURE D'UN SON OU D'UNE VIDÉO : 0,25 à 4. HyperFrames la lit
 * sur `data-playback-rate` (borné 0,1 à 10) et accélère le son au rendu
 * (ffmpeg `atempo`) ; l'aperçu pose `playbackRate`. Le passage joué du fichier
 * dure `duree × vitesse` : `debutMedia` et les mots se lisent en temps du FICHIER.
 */
export const VITESSE_MIN = 0.25;
export const VITESSE_MAX = 4;

export function vitesseDe(s: Segment): number {
  return (s.genre === 'audio' || s.genre === 'video' || s.genre === 'voix') && s.vitesse ? s.vitesse : 1;
}

/** Où commence le passage joué dans le fichier (0 pour ce qui n'a pas de fichier). */
export function debutMediaDe(s: Segment): number {
  return (s.genre === 'audio' || s.genre === 'video' || s.genre === 'voix') && s.debutMedia ? s.debutMedia : 0;
}

/** Un mot dit, avec ses temps (relatifs au segment pour une voix, absolus pour des sous-titres). */
export interface MotHorodate {
  texte: string;
  debut: number;
  fin: number;
}

export const ETATS_VOIX = ['aucune', 'essai', 'finale', 'a-revalider'] as const;
export type EtatVoix = (typeof ETATS_VOIX)[number];

export interface SegmentVoix extends SegmentCommun {
  genre: 'voix';
  texte: string;
  /** La voix d'essai (Piper, sur le serveur, gratuite). */
  voixEssai: string;
  /** La voix finale (Gemini), choisie à l'oreille. */
  voixFinale?: string;
  etat: EtatVoix;
  /** Le son en cours (essai ou final), rangé dans la bibliothèque. */
  mediaId?: string;
  /** La durée réelle du son, lue sur le fichier. */
  dureeAudio?: number;
  /**
   * Horodatage au mot, en temps du FICHIER de voix (0 = début du son). Sans
   * passage choisi ni vitesse, c'est aussi le temps relatif au segment.
   */
  mots?: MotHorodate[];
  volume: number;
  /** Le passage joué : où la lecture du son commence, en secondes du fichier. */
  debutMedia?: number;
  vitesse?: number;
  /** Ce que la voix finale a vraiment coûté, en dollars (0 par le quota gratuit). */
  coutReel?: number;
}

export interface StyleSousTitres {
  position: 'haut' | 'milieu' | 'bas';
  taille: number;
  couleur: string;
  accent: string;
  fond: 'aucun' | 'bande' | 'ombre';
}

export interface SegmentSousTitres extends SegmentCommun {
  genre: 'sous-titres';
  /** Recalculés depuis les voix à chaque recalage quand `auto` est vrai. */
  auto: boolean;
  mots: MotHorodate[];
  /** Deux mots au plus à l'écran (un spectateur sur téléphone lit d'un coup d'œil). */
  motsParGroupe: 1 | 2;
  style: StyleSousTitres;
}

export type Segment =
  | SegmentDessin
  | SegmentTexte
  | SegmentImage
  | SegmentVideo
  | SegmentAudio
  | SegmentVoix
  | SegmentSousTitres;

export interface Piste {
  id: string;
  nom: string;
  genre: GenrePiste;
  segments: Segment[];
  masquee?: boolean;
  muette?: boolean;
}

/**
 * LA COMPOSITION, SEULE VÉRITÉ. La première piste est au PREMIER PLAN (elle
 * recouvre les suivantes), comme la ligne du haut de la ligne de temps.
 */
export interface Composition {
  format: FormatStudio;
  fond: string;
  pistes: Piste[];
  /**
   * LA DURÉE VOULUE — le marqueur bleu de la ligne de temps. L'export COUPE ici
   * (décision de l'utilisateur), l'aperçu s'y arrête, et l'agent la prend comme
   * longueur visée. Absente (créations d'avant le marqueur) : la vidéo dure ce
   * que dure son contenu, rien n'est coupé.
   */
  dureeVoulue?: number;
}

/** Le kit de marque d'un projet : il arrive dans chaque dessin par variables CSS. */
export interface KitDeMarque {
  primaire?: string;
  secondaire?: string;
  accent?: string;
  fond?: string;
  texte?: string;
  policeTitre?: string;
  policeTexte?: string;
  logoMediaId?: string;
  ton?: string;
}

export interface EspaceStudio {
  projectId: string;
  kit: KitDeMarque;
  /** La voix finale préférée du projet (nom de voix Gemini). */
  voixFinale?: string;
  /** La voix d'essai préférée (identifiant Piper). */
  voixEssai?: string;
  creeLe: number;
  majLe: number;
}

/**
 * UN MODÈLE — une création GARDÉE COMME MODÈLE (fenêtre « Mettre en production »), figée et
 * rangée dans la bibliothèque de son projet pour repartir d'elle. Seule la
 * vidéo ENTIÈRE devient un modèle (décision de l'utilisateur) ; revalider la
 * même création met son modèle à jour. Copiable vers un autre projet, médias
 * compris (ils sont propres à un projet).
 */
export interface ModeleStudio {
  id: string;
  projectId: string;
  /** La création d'où il vient (absente pour un modèle copié d'un autre projet). */
  creationId?: string;
  /** Le modèle d'un autre projet dont celui-ci est la copie. */
  origineId?: string;
  titre: string;
  formats: FormatStudio[];
  composition: Composition;
  /** Le numéro de version de la création au moment de la validation. */
  version: number;
  afficheId?: string;
  duree: number;
  creeLe: number;
  majLe: number;
}

export const ETATS_CREATION = ['brouillon', 'exportee'] as const;
export type EtatCreation = (typeof ETATS_CREATION)[number];

export interface Creation {
  id: string;
  projectId: string;
  titre: string;
  formats: FormatStudio[];
  /** Le contenu de l'atelier Marketing d'où elle vient, s'il y en a un. */
  contenuMarketingId?: string;
  etat: EtatCreation;
  /** La version courante (son numéro). */
  version: number;
  /** L'agent attitré de cette création et sa carte. */
  agentId?: string;
  cardId?: string;
  /** La miniature (dernière affiche exportée). */
  afficheId?: string;
  /**
   * LE RÉGLAGE CHOISI POUR L'AGENT AVANT SA PREMIÈRE DEMANDE (bouton de
   * configuration en tête de la conversation) : il sert à son démarrage. Une
   * fois l'agent né, c'est son propre réglage qui fait foi (`agent.config`).
   */
  runAgent?: { engine: string; model?: string; thinking?: string; account?: string };
  creeLe: number;
  majLe: number;
}

export interface VersionStudio {
  creationId: string;
  numero: number;
  composition: Composition;
  /** Ce qui l'a produite, en mots simples. */
  raison: string;
  auteur: 'humain' | 'agent' | 'systeme';
  creeLe: number;
}

export const PROVENANCES_MEDIA = ['import', 'dessin', 'voix-essai', 'voix-finale', 'genere', 'export', 'apercu'] as const;
export type ProvenanceMedia = (typeof PROVENANCES_MEDIA)[number];
export const GENRES_MEDIA = ['image', 'video', 'audio', 'dessin'] as const;
export type GenreMedia = (typeof GENRES_MEDIA)[number];

/** Une pièce de la bibliothèque du projet. */
export interface MediaStudio {
  id: string;
  projectId: string;
  creationId?: string;
  genre: GenreMedia;
  provenance: ProvenanceMedia;
  nom: string;
  /** La pièce jointe qui porte le fichier (absente pour un dessin gardé). */
  attachmentId?: string;
  mime?: string;
  duree?: number;
  largeur?: number;
  hauteur?: number;
  /** Un dessin gardé : son gabarit et ses paramètres, réutilisables. */
  dessin?: { gabarit: GabaritDessin; parametres: ParametreDessin[]; valeurs: Record<string, ValeurParametre> };
  /** Catégorie et usage (compétence « bibliotheque-d-elements-reutilisables »). */
  categorie?: string;
  usage?: string;
  /** Une musique ou un son sans licence notée est inutilisable. */
  licence?: string;
  cout?: number;
  creeLe: number;
}

export const GENRES_DEPENSE = ['voix', 'musique', 'image', 'clip'] as const;
export type GenreDepense = (typeof GENRES_DEPENSE)[number];
export const ETATS_DEPENSE = ['en-attente', 'validee', 'refusee', 'faite', 'echouee'] as const;
export type EtatDepense = (typeof ETATS_DEPENSE)[number];

/**
 * UNE DÉPENSE, TOUJOURS PRÉCÉDÉE D'UN DEVIS. Aucun appel payant ne part sans
 * une dépense VALIDÉE par un clic : la garde est tenue côté serveur, avant
 * l'appel réseau.
 */
export interface DepenseStudio {
  id: string;
  projectId: string;
  creationId: string;
  genre: GenreDepense;
  modele: string;
  /** Le plafond autorisé, en dollars ; `null` quand le fournisseur ne publie pas de prix. */
  plafond: number | null;
  raison: string;
  etat: EtatDepense;
  /** Ce qui a été réellement débité (0 par un quota gratuit). */
  montantReel?: number;
  /** Ce que la génération doit produire (segments visés, consigne, durée…). */
  details: Record<string, unknown>;
  /** Le message d'échec, dit tel quel. */
  erreur?: string;
  demandeePar: 'humain' | 'agent';
  creeLe: number;
  majLe: number;
}

export const ETATS_EXPORT = ['en-file', 'en-cours', 'pret', 'echoue', 'annule'] as const;
export type EtatExport = (typeof ETATS_EXPORT)[number];

export interface ExportStudio {
  id: string;
  creationId: string;
  projectId: string;
  format: FormatStudio;
  genre: 'video' | 'image';
  etat: EtatExport;
  progression: number;
  version: number;
  attachmentId?: string;
  afficheId?: string;
  duree?: number;
  erreur?: string;
  /** Combien de voix étaient encore en essai au moment de l'export. */
  voixEnEssai: number;
  /** Les réglages avec lesquels il a été fabriqué (`studio-export.ts`) ; absent sur un export d'avant. */
  reglages?: ReglagesExport;
  /** Le lot du clic « Exporter » (une vidéo par format coché) ; absent sur un export lancé seul. */
  lot?: string;
  creeLe: number;
  majLe: number;
}

/* ------------------------------------------------------------------ */
/* Lecture tolérante d'une composition reçue                           */
/* ------------------------------------------------------------------ */

const ID_VALIDE = /^[a-zA-Z][\w-]{0,63}$/;

export function idValide(valeur: unknown): valeur is string {
  return typeof valeur === 'string' && ID_VALIDE.test(valeur);
}

const COULEUR_VALIDE = /^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|transparent|[a-z]{3,20})$/;

export function couleurValide(valeur: unknown, repli = '#ffffff'): string {
  return typeof valeur === 'string' && COULEUR_VALIDE.test(valeur.trim()) ? valeur.trim() : repli;
}

function nombre(valeur: unknown, repli: number, min = -Infinity, max = Infinity): number {
  const n = typeof valeur === 'number' ? valeur : Number(valeur);
  if (!Number.isFinite(n)) return repli;
  return Math.min(max, Math.max(min, n));
}

function arrondi(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function texte(valeur: unknown, max = 5000): string {
  return typeof valeur === 'string' ? valeur.slice(0, max) : '';
}

/** Quatre nombres bornés (marges, coins) ; `null` ou une forme illisible : rien. */
function lireQuatre(brut: unknown, min: number, max: number): Quatre | null {
  if (!Array.isArray(brut) || brut.length !== 4) return null;
  return brut.map((v) => arrondi(nombre(v, 0, min, max))) as Quatre;
}

function lireOmbre(o: any): OmbrePiece | null {
  if (!o || typeof o !== 'object') return null;
  return {
    genre: GENRES_OMBRE.includes(o.genre) ? o.genre : 'portee',
    x: arrondi(nombre(o.x, 0, -2000, 2000)),
    y: arrondi(nombre(o.y, 4, -2000, 2000)),
    flou: arrondi(nombre(o.flou, 8, 0, 1000)),
    etalement: arrondi(nombre(o.etalement, 0, -1000, 1000)),
    couleur: couleurValide(o.couleur, '#00000040'),
  };
}

function lireDegrade(d: any): Degrade | null {
  if (!d || typeof d !== 'object' || !Array.isArray(d.arrets)) return null;
  const arrets = d.arrets
    .slice(0, 8)
    .filter((a: any) => a && typeof a === 'object')
    .map((a: any) => ({ couleur: couleurValide(a.couleur, '#000000'), position: arrondi(nombre(a.position, 0, 0, 100)) }));
  if (arrets.length < 2) return null;
  return { genre: d.genre === 'radial' ? 'radial' : 'lineaire', angle: arrondi(nombre(d.angle, 180, -360, 360)), arrets };
}

function lireRetouche(r: any): Retouche | null {
  if (!r || typeof r !== 'object') return null;
  const sortie: Retouche = {};
  if (r.x !== undefined && r.x !== null) sortie.x = arrondi(nombre(r.x, 0, -5000, 5000));
  if (r.y !== undefined && r.y !== null) sortie.y = arrondi(nombre(r.y, 0, -5000, 5000));
  if (r.echelle !== undefined && r.echelle !== null) sortie.echelle = arrondi(nombre(r.echelle, 1, 0.05, 20));
  if (r.rotation !== undefined && r.rotation !== null) sortie.rotation = arrondi(nombre(r.rotation, 0, -3600, 3600));
  if (r.opacite !== undefined && r.opacite !== null) sortie.opacite = arrondi(nombre(r.opacite, 1, 0, 1));
  if (typeof r.texte === 'string') sortie.texte = r.texte.slice(0, 2000);
  if (r.couleur !== undefined && r.couleur !== null) sortie.couleur = couleurValide(r.couleur);
  if (r.fond !== undefined && r.fond !== null) sortie.fond = couleurValide(r.fond);
  // `null` efface la taille posée : le cadre revient à celle du dessin.
  if (r.largeur !== undefined && r.largeur !== null) sortie.largeur = Math.round(nombre(r.largeur, 100, 4, 20000));
  if (r.hauteur !== undefined && r.hauteur !== null) sortie.hauteur = Math.round(nombre(r.hauteur, 100, 4, 20000));
  if (r.taillePolice !== undefined && r.taillePolice !== null) sortie.taillePolice = arrondi(nombre(r.taillePolice, 48, 4, 2000));
  if (ALIGNEMENTS_TEXTE.includes(r.alignement)) sortie.alignement = r.alignement;
  if (r.contour !== undefined && r.contour !== null) sortie.contour = couleurValide(r.contour, '#000000');
  if (r.epaisseurContour !== undefined && r.epaisseurContour !== null) sortie.epaisseurContour = arrondi(nombre(r.epaisseurContour, 0, 0, 200));
  if (r.arrondi !== undefined && r.arrondi !== null) sortie.arrondi = arrondi(nombre(r.arrondi, 0, 0, 5000));
  const coins = lireQuatre(r.arrondiCoins, 0, 5000);
  if (coins) sortie.arrondiCoins = coins;
  if (POSITIONS_CONTOUR.includes(r.contourPosition)) sortie.contourPosition = r.contourPosition;
  if (STYLES_CONTOUR.includes(r.contourStyle)) sortie.contourStyle = r.contourStyle;
  const degrade = lireDegrade(r.degrade);
  if (degrade) sortie.degrade = degrade;
  if (typeof r.police === 'string' && /^[A-Za-z][\w -]{0,59}$/.test(r.police.trim())) sortie.police = r.police.trim();
  if (r.graisse !== undefined && r.graisse !== null) sortie.graisse = Math.round(nombre(r.graisse, 400, 100, 900) / 100) * 100;
  if (r.interligne !== undefined && r.interligne !== null) sortie.interligne = arrondi(nombre(r.interligne, 1.2, 0.5, 5));
  if (r.espacementLettres !== undefined && r.espacementLettres !== null) sortie.espacementLettres = arrondi(nombre(r.espacementLettres, 0, -100, 500));
  if (typeof r.italique === 'boolean') sortie.italique = r.italique;
  if (DECORATIONS_TEXTE.includes(r.decoration)) sortie.decoration = r.decoration;
  if (CASSES_TEXTE.includes(r.casse)) sortie.casse = r.casse;
  if (ALIGNEMENTS_VERTICAUX.includes(r.alignementVertical)) sortie.alignementVertical = r.alignementVertical;
  const marges = lireQuatre(r.marges, 0, 5000);
  if (marges) sortie.marges = marges;
  const exterieures = lireQuatre(r.margesExterieures, -5000, 5000);
  if (exterieures) sortie.margesExterieures = exterieures;
  if (Array.isArray(r.ombres)) {
    const ombres = r.ombres.slice(0, OMBRES_MAX).map(lireOmbre).filter((o: OmbrePiece | null): o is OmbrePiece => !!o);
    // Une liste VIDE est un choix (aucune ombre, même si le dessin en pose une) : elle est gardée.
    sortie.ombres = ombres;
  }
  if (r.flou !== undefined && r.flou !== null) sortie.flou = arrondi(nombre(r.flou, 0, 0, 500));
  if (r.flouArrierePlan !== undefined && r.flouArrierePlan !== null) sortie.flouArrierePlan = arrondi(nombre(r.flouArrierePlan, 0, 0, 500));
  if (MODES_FUSION.includes(r.fusion)) sortie.fusion = r.fusion;
  if (typeof r.rogner === 'boolean') sortie.rogner = r.rogner;
  if (CADRAGES_IMAGE.includes(r.cadrage)) sortie.cadrage = r.cadrage;
  if (idValide(r.source)) sortie.source = r.source;
  if (r.masquee === true) sortie.masquee = true;
  if (r.plan !== undefined && r.plan !== null) {
    const plan = Math.round(nombre(r.plan, 0, -50, 50));
    if (plan) sortie.plan = plan;
  }
  const ancre = lireAncre(r.ancre);
  if (ancre) sortie.ancre = ancre;
  return Object.keys(sortie).length ? sortie : null;
}

function lireRetouches(brut: any): Record<string, Retouche> | undefined {
  if (!brut || typeof brut !== 'object') return undefined;
  const sortie: Record<string, Retouche> = {};
  for (const [cle, valeur] of Object.entries(brut)) {
    if (!idValide(cle)) continue;
    const r = lireRetouche(valeur);
    if (r) sortie[cle] = r;
  }
  return Object.keys(sortie).length ? sortie : undefined;
}

function lireSurcharges(brut: any): SegmentCommun['surcharges'] {
  if (!brut || typeof brut !== 'object') return undefined;
  const sortie: NonNullable<SegmentCommun['surcharges']> = {};
  for (const format of CLES_FORMATS_STUDIO) {
    const retouches = lireRetouches(brut[format]?.retouches);
    if (retouches) sortie[format] = { retouches };
  }
  return Object.keys(sortie).length ? sortie : undefined;
}

export function lireParametres(brut: unknown): ParametreDessin[] {
  if (!Array.isArray(brut)) return [];
  const vus = new Set<string>();
  const sortie: ParametreDessin[] = [];
  for (const p of brut.slice(0, 40)) {
    if (!p || typeof p !== 'object' || !idValide((p as any).id) || vus.has((p as any).id)) continue;
    const type = (TYPES_PARAMETRE as readonly string[]).includes((p as any).type) ? ((p as any).type as TypeParametre) : 'texte';
    vus.add((p as any).id);
    const parametre: ParametreDessin = {
      id: (p as any).id,
      type,
      libelle: texte((p as any).libelle, 80) || (p as any).id,
      defaut: valeurDuParametre({ type } as ParametreDessin, (p as any).defaut, (p as any)),
    };
    if (type === 'choix') parametre.options = Array.isArray((p as any).options) ? (p as any).options.map(String).slice(0, 20) : [];
    if (type === 'nombre') {
      if ((p as any).min !== undefined) parametre.min = nombre((p as any).min, 0);
      if ((p as any).max !== undefined) parametre.max = nombre((p as any).max, 100);
      if ((p as any).pas !== undefined) parametre.pas = nombre((p as any).pas, 1, 0.001);
      if (typeof (p as any).unite === 'string' && /^(px|%|em|rem|deg|s|cqw|cqh|vw|vh)?$/.test((p as any).unite)) parametre.unite = (p as any).unite;
    }
    sortie.push(parametre);
  }
  return sortie;
}

/** Une valeur ramenée au type de son paramètre. */
export function valeurDuParametre(p: Pick<ParametreDessin, 'type'> & Partial<ParametreDessin>, valeur: unknown, bornes?: Partial<ParametreDessin>): ValeurParametre {
  const b = bornes ?? p;
  switch (p.type) {
    case 'nombre':
      return arrondi(nombre(valeur, typeof b.defaut === 'number' ? b.defaut : 0, b.min ?? -1e6, b.max ?? 1e6));
    case 'bascule':
      return valeur === true || valeur === 'true' || valeur === 1;
    case 'couleur':
      return couleurValide(valeur, '#ffffff');
    case 'choix': {
      const options = b.options ?? [];
      const v = String(valeur ?? '');
      return options.length && !options.includes(v) ? options[0]! : v.slice(0, 200);
    }
    default:
      return String(valeur ?? '').slice(0, 2000);
  }
}

function lireMots(brut: unknown): MotHorodate[] {
  if (!Array.isArray(brut)) return [];
  return brut
    .slice(0, 5000)
    .filter((m) => m && typeof m === 'object' && typeof (m as any).texte === 'string')
    .map((m: any) => {
      const debut = arrondi(nombre(m.debut, 0, 0, DUREE_ABSURDE));
      return { texte: String(m.texte).slice(0, 80), debut, fin: arrondi(Math.max(debut, nombre(m.fin, debut, 0, DUREE_ABSURDE))) };
    });
}

/** Une vitesse reçue, bornée ; 1 (la vitesse normale) n'est pas écrite. */
function lireVitesse(valeur: unknown): { vitesse?: number } {
  if (valeur === undefined || valeur === null || valeur === '') return {};
  const v = Math.round(nombre(valeur, 1, VITESSE_MIN, VITESSE_MAX) * 100) / 100;
  return v === 1 ? {} : { vitesse: v };
}

/** Lit UN segment reçu (écran, agent, base) : tout champ inconnu tombe, toute valeur absurde est bornée. */
export function lireSegment(brut: any): Segment | null {
  if (!brut || typeof brut !== 'object' || !idValide(brut.id)) return null;
  const genre = brut.genre as GenreSegment;
  if (!(GENRES_SEGMENT as readonly string[]).includes(genre)) return null;
  const commun: SegmentCommun = {
    id: brut.id,
    debut: arrondi(nombre(brut.debut, 0, 0, DUREE_ABSURDE)),
    duree: arrondi(nombre(brut.duree, 3, DUREE_SEGMENT_MIN, DUREE_ABSURDE)),
  };
  if (typeof brut.nom === 'string' && brut.nom.trim()) commun.nom = brut.nom.trim().slice(0, 80);
  if (brut.entree !== undefined) commun.entree = recetteValide(brut.entree);
  if (brut.sortie !== undefined) commun.sortie = recetteValide(brut.sortie);
  const retouches = lireRetouches(brut.retouches);
  if (retouches) commun.retouches = retouches;
  const surcharges = lireSurcharges(brut.surcharges);
  if (surcharges) commun.surcharges = surcharges;

  switch (genre) {
    case 'dessin': {
      const parametres = lireParametres(brut.parametres);
      const valeurs: Record<string, ValeurParametre> = {};
      for (const p of parametres) {
        valeurs[p.id] = brut.valeurs && Object.prototype.hasOwnProperty.call(brut.valeurs, p.id) ? valeurDuParametre(p, brut.valeurs[p.id]) : p.defaut;
      }
      return {
        ...commun,
        genre,
        gabarit: {
          html: texte(brut.gabarit?.html, 200_000),
          css: texte(brut.gabarit?.css, 100_000),
          animation: texte(brut.gabarit?.animation, 60_000),
        },
        parametres,
        valeurs,
        ...(Array.isArray(brut.elements) ? { elements: brut.elements.filter(idValide).slice(0, 500) } : {}),
      };
    }
    case 'texte':
      return {
        ...commun,
        genre,
        texte: texte(brut.texte, 2000),
        taille: nombre(brut.taille, 72, 8, 600),
        couleur: couleurValide(brut.couleur),
        position: { x: nombre(brut.position?.x, 50, -50, 150), y: nombre(brut.position?.y, 50, -50, 150) },
        ...(brut.gras ? { gras: true } : {}),
        ...(typeof brut.police === 'string' && brut.police ? { police: brut.police.slice(0, 60) } : {}),
      };
    case 'image':
      if (!idValide(brut.mediaId)) return null;
      return { ...commun, genre, mediaId: brut.mediaId, ajustement: brut.ajustement === 'contenir' ? 'contenir' : 'couvrir' };
    case 'video':
      if (!idValide(brut.mediaId)) return null;
      return {
        ...commun,
        genre,
        mediaId: brut.mediaId,
        ajustement: brut.ajustement === 'contenir' ? 'contenir' : 'couvrir',
        debutMedia: arrondi(nombre(brut.debutMedia, 0, 0, 36_000)),
        volume: nombre(brut.volume, 1, 0, 3),
        ...lireVitesse(brut.vitesse),
        ...(brut.fonduEntree ? { fonduEntree: nombre(brut.fonduEntree, 0, 0, 10) } : {}),
        ...(brut.fonduSortie ? { fonduSortie: nombre(brut.fonduSortie, 0, 0, 10) } : {}),
      };
    case 'audio':
      if (!idValide(brut.mediaId)) return null;
      return {
        ...commun,
        genre,
        mediaId: brut.mediaId,
        debutMedia: arrondi(nombre(brut.debutMedia, 0, 0, 36_000)),
        volume: nombre(brut.volume, 1, 0, 3),
        ...(brut.fonduEntree ? { fonduEntree: nombre(brut.fonduEntree, 0, 0, 10) } : {}),
        ...(brut.fonduSortie ? { fonduSortie: nombre(brut.fonduSortie, 0, 0, 10) } : {}),
        ...lireVitesse(brut.vitesse),
      };
    case 'voix': {
      const etat = (ETATS_VOIX as readonly string[]).includes(brut.etat) ? (brut.etat as EtatVoix) : 'aucune';
      return {
        ...commun,
        genre,
        texte: texte(brut.texte, 4000),
        voixEssai: typeof brut.voixEssai === 'string' && brut.voixEssai ? brut.voixEssai.slice(0, 80) : VOIX_ESSAI_PAR_DEFAUT,
        ...(typeof brut.voixFinale === 'string' && brut.voixFinale ? { voixFinale: brut.voixFinale.slice(0, 40) } : {}),
        etat,
        ...(idValide(brut.mediaId) ? { mediaId: brut.mediaId } : {}),
        ...(brut.dureeAudio !== undefined ? { dureeAudio: arrondi(nombre(brut.dureeAudio, 0, 0, DUREE_ABSURDE)) } : {}),
        ...(Array.isArray(brut.mots) ? { mots: lireMots(brut.mots) } : {}),
        volume: nombre(brut.volume, 1, 0, 3),
        ...(Number(brut.debutMedia) > 0 ? { debutMedia: arrondi(nombre(brut.debutMedia, 0, 0, 36_000)) } : {}),
        ...lireVitesse(brut.vitesse),
        ...(brut.coutReel !== undefined ? { coutReel: nombre(brut.coutReel, 0, 0, 1000) } : {}),
      };
    }
    case 'sous-titres': {
      const s = brut.style ?? {};
      return {
        ...commun,
        genre,
        auto: brut.auto !== false,
        mots: lireMots(brut.mots),
        motsParGroupe: brut.motsParGroupe === 1 ? 1 : 2,
        style: {
          position: s.position === 'haut' || s.position === 'milieu' ? s.position : 'bas',
          taille: nombre(s.taille, 76, 16, 300),
          couleur: couleurValide(s.couleur, '#ffffff'),
          accent: couleurValide(s.accent, '#ffd23f'),
          fond: s.fond === 'aucun' || s.fond === 'bande' ? s.fond : 'ombre',
        },
      };
    }
  }
  return null;
}

/**
 * VALIDER UNE COMPOSITION : la lire en entier, refuser ce qui la rendrait
 * incohérente (deux segments du même id, un genre sur la mauvaise piste), et
 * rendre la version propre. Tout ce qui est récupérable est récupéré.
 */
export function validerComposition(brut: unknown): { ok: true; composition: Composition; avertissements: string[] } | { ok: false; raison: string } {
  if (!brut || typeof brut !== 'object') return { ok: false, raison: 'composition illisible' };
  const b = brut as any;
  const format: FormatStudio = estFormatStudio(b.format) ? b.format : '9:16';
  const avertissements: string[] = [];
  const vus = new Set<string>();
  const pistes: Piste[] = [];
  if (!Array.isArray(b.pistes)) return { ok: false, raison: 'la composition n’a pas de pistes' };
  for (const p of b.pistes.slice(0, 30)) {
    if (!p || !idValide(p.id) || vus.has(p.id)) {
      avertissements.push('une piste sans identifiant valide a été écartée');
      continue;
    }
    vus.add(p.id);
    const genre: GenrePiste = (GENRES_PISTE as readonly string[]).includes(p.genre) ? p.genre : 'visuel';
    const segments: Segment[] = [];
    for (const s of Array.isArray(p.segments) ? p.segments.slice(0, 400) : []) {
      const segment = lireSegment(s);
      if (!segment) {
        avertissements.push(`un segment illisible de la piste « ${p.nom ?? p.id} » a été écarté`);
        continue;
      }
      if (vus.has(segment.id)) return { ok: false, raison: `l’identifiant « ${segment.id} » est utilisé deux fois` };
      if (genreDePisteDuSegment(segment.genre) !== genre) {
        return { ok: false, raison: `un segment « ${segment.genre} » ne va pas sur une piste « ${genre} »` };
      }
      vus.add(segment.id);
      segments.push(segment);
    }
    segments.sort((x, y) => x.debut - y.debut);
    pistes.push({
      id: p.id,
      nom: texte(p.nom, 60) || p.id,
      genre,
      segments,
      ...(p.masquee ? { masquee: true } : {}),
      ...(p.muette ? { muette: true } : {}),
    });
  }
  const composition: Composition = { format, fond: couleurValide(b.fond, '#0b0f17'), pistes };
  const voulue = lireDureeVoulue(b.dureeVoulue);
  if (voulue !== undefined) composition.dureeVoulue = voulue;
  return { ok: true, composition, avertissements };
}

/** Une durée voulue reçue : un dixième de seconde près, une demi-seconde au moins. */
export function lireDureeVoulue(valeur: unknown): number | undefined {
  if (valeur === undefined || valeur === null || valeur === '') return undefined;
  const n = Number(valeur);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(Math.min(DUREE_ABSURDE, Math.max(0.5, n)) * 10) / 10;
}

/** La durée du CONTENU d'une composition : la fin du dernier segment, une seconde au moins. */
export function dureeDeLaComposition(c: Composition): number {
  let fin = 0;
  for (const p of c.pistes) for (const s of p.segments) fin = Math.max(fin, s.debut + s.duree);
  return arrondi(Math.max(1, fin));
}

/**
 * LA DURÉE DE LA VIDÉO QUI SORT : le marqueur bleu s'il est posé (l'export coupe
 * là, même si du contenu continue au-delà), sinon la durée du contenu.
 */
export function dureeExportee(c: Composition): number {
  return c.dureeVoulue !== undefined ? c.dureeVoulue : dureeDeLaComposition(c);
}

/** Tous les médias qu'une composition cite : fichiers des segments, `studio-media:<id>` des dessins, paramètres « média ». */
export function mediasDeLaComposition(c: Composition): string[] {
  const ids = new Set<string>();
  for (const s of tousLesSegments(c)) {
    if ('mediaId' in s && s.mediaId) ids.add(s.mediaId);
    if (s.genre === 'dessin') {
      for (const m of `${s.gabarit.html} ${s.gabarit.css}`.matchAll(/studio-media:([a-zA-Z][\w-]{0,63})/g)) ids.add(m[1]!);
      for (const p of s.parametres) if (p.type === 'media' && typeof s.valeurs[p.id] === 'string' && s.valeurs[p.id]) ids.add(String(s.valeurs[p.id]));
    }
    // L'image d'une pièce remplacée à la main (« Source » de l'inspecteur), dans tous les formats.
    for (const table of retouchesDeTousLesFormats(s)) for (const r of Object.values(table)) if (r.source) ids.add(r.source);
  }
  return [...ids];
}

/**
 * LA MÊME COMPOSITION, SES MÉDIAS RENOMMÉS (`table` : ancien → nouveau). Sert à la
 * copie d'un modèle vers un autre projet, dont les médias reçoivent de nouveaux
 * identifiants. Un média absent de la table garde le sien.
 */
export function remplacerMediasDansComposition(c: Composition, table: Record<string, string>): Composition {
  const copie: Composition = cloner(c);
  const nouveau = (id: string) => table[id] ?? id;
  for (const s of tousLesSegments(copie)) {
    if ('mediaId' in s && s.mediaId) (s as { mediaId?: string }).mediaId = nouveau(s.mediaId);
    if (s.genre === 'dessin') {
      const remplacer = (texteSource: string) => texteSource.replace(/studio-media:([a-zA-Z][\w-]{0,63})/g, (_, id: string) => `studio-media:${nouveau(id)}`);
      s.gabarit = { ...s.gabarit, html: remplacer(s.gabarit.html), css: remplacer(s.gabarit.css) };
      for (const p of s.parametres) {
        const v = s.valeurs[p.id];
        if (p.type === 'media' && typeof v === 'string' && v) s.valeurs[p.id] = nouveau(v);
        if (p.type === 'media' && typeof p.defaut === 'string' && p.defaut) p.defaut = nouveau(p.defaut);
      }
    }
    for (const table of retouchesDeTousLesFormats(s)) for (const r of Object.values(table)) if (r.source) r.source = nouveau(r.source);
  }
  return copie;
}

/** Les tables de retouches d'un segment : celle du format de base, puis celle de chaque autre format. */
function retouchesDeTousLesFormats(s: Segment): Record<string, Retouche>[] {
  const tables: Record<string, Retouche>[] = [];
  if (s.retouches) tables.push(s.retouches);
  for (const f of CLES_FORMATS_STUDIO) {
    const t = s.surcharges?.[f]?.retouches;
    if (t) tables.push(t);
  }
  return tables;
}

export function tousLesSegments(c: Composition): Segment[] {
  return c.pistes.flatMap((p) => p.segments);
}

export function trouverSegment(c: Composition, id: string): { piste: Piste; segment: Segment; index: number } | null {
  for (const piste of c.pistes) {
    const index = piste.segments.findIndex((s) => s.id === id);
    if (index >= 0) return { piste, segment: piste.segments[index]!, index };
  }
  return null;
}

/** La composition d'une création neuve : un fond, des pistes vides, et le marqueur bleu à 15 s. */
export function compositionVide(format: FormatStudio = '9:16', dureeVoulue: number = DUREE_VOULUE_PAR_DEFAUT): Composition {
  return {
    format,
    fond: '#0b0f17',
    dureeVoulue,
    pistes: [
      { id: 'sous-titres', nom: 'Sous-titres', genre: 'sous-titres', segments: [] },
      { id: 'visuels', nom: 'Visuels', genre: 'visuel', segments: [] },
      { id: 'voix', nom: 'Voix', genre: 'son', segments: [] },
      { id: 'musique', nom: 'Musique', genre: 'son', segments: [] },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Les opérations : une opération → une version                         */
/* ------------------------------------------------------------------ */

export type OperationStudio =
  | { op: 'deplacer'; segmentId: string; debut: number; pisteId?: string }
  | { op: 'rogner'; segmentId: string; debut?: number; duree?: number }
  | { op: 'scinder'; segmentId: string; a: number }
  /**
   * RETIRER UN PASSAGE d'un son ou d'une vidéo (`de` → `a`, en secondes de la
   * composition) : le morceau d'après se recolle contre celui d'avant, les autres
   * blocs ne bougent pas. Un seul geste, donc une seule version, annulable.
   */
  | { op: 'retirer-passage'; segmentId: string; de: number; a: number }
  | { op: 'proprietes'; segmentId: string; valeurs: Record<string, unknown> }
  | { op: 'parametre'; segmentId: string; id: string; valeur: unknown }
  | { op: 'retouche'; segmentId: string; elementId: string; retouche: Retouche; format?: FormatStudio }
  | { op: 'effacer-retouche'; segmentId: string; elementId: string; format?: FormatStudio }
  | { op: 'remplacer-media'; segmentId: string; mediaId: string }
  | { op: 'inserer'; pisteId: string; segment: Record<string, unknown> }
  | { op: 'supprimer'; segmentId: string }
  | { op: 'dessin'; segmentId: string; gabarit: GabaritDessin; parametres: unknown; elements?: string[] }
  | { op: 'piste-ajouter'; genre: GenrePiste; nom?: string; position?: number }
  | { op: 'piste-supprimer'; pisteId: string }
  | { op: 'piste-proprietes'; pisteId: string; nom?: string; masquee?: boolean; muette?: boolean; position?: number }
  /** `dureeVoulue: null` retire le marqueur : la vidéo dure alors ce que dure son contenu. */
  | { op: 'composition'; fond?: string; format?: FormatStudio; dureeVoulue?: number | null }
  | { op: 'lot'; operations: OperationStudio[] };

export type ResultatOperation = { ok: true; composition: Composition; resume: string } | { ok: false; raison: string };

/** Les champs qu'une opération « propriétés » peut changer, par genre. */
const PROPRIETES_MODIFIABLES: Record<GenreSegment, readonly string[]> = {
  dessin: ['nom', 'entree', 'sortie'],
  texte: ['nom', 'entree', 'sortie', 'texte', 'taille', 'couleur', 'position', 'gras', 'police'],
  image: ['nom', 'entree', 'sortie', 'ajustement'],
  video: ['nom', 'entree', 'sortie', 'ajustement', 'debutMedia', 'volume', 'vitesse', 'fonduEntree', 'fonduSortie'],
  audio: ['nom', 'debutMedia', 'volume', 'fonduEntree', 'fonduSortie', 'vitesse'],
  // Pas de `voixFinale` : la voix finale est celle du projet, le segment ne garde que celle réellement produite.
  voix: ['nom', 'texte', 'voixEssai', 'volume', 'debutMedia', 'vitesse'],
  'sous-titres': ['nom', 'auto', 'motsParGroupe', 'style', 'mots'],
};

function cloner<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

/** Remplace un segment par sa version relue (bornes et types réappliqués). */
function reposer(piste: Piste, index: number, brut: unknown): boolean {
  const relu = lireSegment(brut);
  if (!relu) return false;
  piste.segments[index] = relu;
  piste.segments.sort((a, b) => a.debut - b.debut);
  return true;
}

/**
 * APPLIQUER UNE OPÉRATION et rendre la composition suivante. Pure : la
 * composition reçue n'est jamais modifiée, les identifiants neufs viennent de
 * `idNeuf` (tirés au hasard par le serveur, fixes dans les tests).
 */
export function appliquerOperation(composition: Composition, op: OperationStudio, idNeuf: (prefixe: string) => string): ResultatOperation {
  const c = cloner(composition);
  const echec = (raison: string): ResultatOperation => ({ ok: false, raison });
  if (!op || typeof op !== 'object' || typeof (op as any).op !== 'string') return echec('opération illisible');

  if (op.op === 'lot') {
    if (!Array.isArray(op.operations) || !op.operations.length) return echec('lot vide');
    let courant = c;
    const resumes: string[] = [];
    for (const sous of op.operations.slice(0, 200)) {
      const r = appliquerOperation(courant, sous, idNeuf);
      if (!r.ok) return r;
      courant = r.composition;
      resumes.push(r.resume);
    }
    return { ok: true, composition: courant, resume: resumes.length > 3 ? `${resumes.length} changements` : resumes.join(', ') };
  }

  if (op.op === 'piste-ajouter') {
    const genre: GenrePiste = (GENRES_PISTE as readonly string[]).includes(op.genre) ? op.genre : 'visuel';
    const piste: Piste = { id: idNeuf('piste'), nom: texte(op.nom, 60) || (genre === 'son' ? 'Son' : genre === 'sous-titres' ? 'Sous-titres' : 'Visuels'), genre, segments: [] };
    const position = Math.round(nombre(op.position, genre === 'son' ? c.pistes.length : 0, 0, c.pistes.length));
    c.pistes.splice(position, 0, piste);
    return { ok: true, composition: c, resume: `piste « ${piste.nom} » ajoutée` };
  }
  if (op.op === 'piste-supprimer' || op.op === 'piste-proprietes') {
    const index = c.pistes.findIndex((p) => p.id === op.pisteId);
    if (index < 0) return echec('piste introuvable');
    if (op.op === 'piste-supprimer') {
      const [retiree] = c.pistes.splice(index, 1);
      return { ok: true, composition: c, resume: `piste « ${retiree!.nom} » retirée` };
    }
    const piste = c.pistes[index]!;
    if (typeof op.nom === 'string' && op.nom.trim()) piste.nom = op.nom.trim().slice(0, 60);
    if (op.masquee !== undefined) piste.masquee = !!op.masquee || undefined;
    if (op.muette !== undefined) piste.muette = !!op.muette || undefined;
    if (op.position !== undefined) {
      c.pistes.splice(index, 1);
      c.pistes.splice(Math.round(nombre(op.position, index, 0, c.pistes.length)), 0, piste);
    }
    return { ok: true, composition: c, resume: `piste « ${piste.nom} » réglée` };
  }
  if (op.op === 'composition') {
    if (op.fond !== undefined) c.fond = couleurValide(op.fond, c.fond);
    if (op.format !== undefined) {
      if (!estFormatStudio(op.format)) return echec('format inconnu');
      c.format = op.format;
    }
    if (op.dureeVoulue === null) {
      delete c.dureeVoulue;
      return { ok: true, composition: c, resume: 'durée voulue retirée' };
    }
    if (op.dureeVoulue !== undefined) {
      const voulue = lireDureeVoulue(op.dureeVoulue);
      if (voulue === undefined) return echec('durée voulue illisible');
      c.dureeVoulue = voulue;
      return { ok: true, composition: c, resume: `durée voulue : ${voulue.toFixed(1)} s` };
    }
    return { ok: true, composition: c, resume: 'composition réglée' };
  }
  if (op.op === 'inserer') {
    const piste = c.pistes.find((p) => p.id === op.pisteId);
    if (!piste) return echec('piste introuvable');
    const brut = { ...(op.segment ?? {}) } as Record<string, unknown>;
    if (!idValide(brut.id) || trouverSegment(c, String(brut.id))) brut.id = idNeuf('seg');
    const segment = lireSegment(brut);
    if (!segment) return echec('segment illisible : genre, début, durée et média sont requis selon le genre');
    if (genreDePisteDuSegment(segment.genre) !== piste.genre) return echec(`un segment « ${segment.genre} » ne va pas sur la piste « ${piste.nom} »`);
    piste.segments.push(segment);
    piste.segments.sort((a, b) => a.debut - b.debut);
    // Des sous-titres automatiques posés à la main suivent aussitôt les voix déjà là.
    const suite = segment.genre === 'sous-titres' && segment.auto ? recalerSousTitres(c) : c;
    return { ok: true, composition: suite, resume: `${libelleGenre(segment.genre)} ajouté` };
  }

  const trouve = trouverSegment(c, (op as any).segmentId);
  if (!trouve) return echec('segment introuvable');
  const { piste, segment, index } = trouve;

  switch (op.op) {
    case 'deplacer': {
      let cible = piste;
      if (op.pisteId && op.pisteId !== piste.id) {
        const autre = c.pistes.find((p) => p.id === op.pisteId);
        if (!autre) return echec('piste introuvable');
        if (autre.genre !== piste.genre) return echec(`un segment « ${segment.genre} » ne va pas sur la piste « ${autre.nom} »`);
        piste.segments.splice(index, 1);
        autre.segments.push(segment);
        cible = autre;
      }
      segment.debut = arrondi(nombre(op.debut, segment.debut, 0, DUREE_ABSURDE - segment.duree));
      cible.segments.sort((a, b) => a.debut - b.debut);
      // Une voix déplacée emmène ses sous-titres automatiques.
      const suite = segment.genre === 'voix' && segment.mots?.length ? recalerSousTitres(c) : c;
      return { ok: true, composition: suite, resume: `${libelleGenre(segment.genre)} déplacé à ${segment.debut.toFixed(1)} s` };
    }
    case 'rogner': {
      const fin = segment.debut + segment.duree;
      if (op.debut !== undefined) {
        const debut = arrondi(nombre(op.debut, segment.debut, 0, fin - DUREE_SEGMENT_MIN));
        const ecart = debut - segment.debut;
        segment.debut = debut;
        segment.duree = arrondi(fin - debut);
        // Rogner le début d'un son avance aussi le point de lecture du fichier (à sa vitesse).
        if ((segment.genre === 'audio' || segment.genre === 'video' || segment.genre === 'voix') && ecart) {
          const debutMedia = arrondi(Math.max(0, debutMediaDe(segment) + ecart * vitesseDe(segment)));
          if (segment.genre === 'voix' && !debutMedia) delete segment.debutMedia;
          else segment.debutMedia = debutMedia;
        }
      }
      if (op.duree !== undefined) segment.duree = arrondi(nombre(op.duree, segment.duree, DUREE_SEGMENT_MIN, DUREE_ABSURDE));
      piste.segments.sort((a, b) => a.debut - b.debut);
      // Le passage d'une voix a changé : ses sous-titres automatiques suivent.
      const suite = segment.genre === 'voix' && segment.mots?.length ? recalerSousTitres(c) : c;
      return { ok: true, composition: suite, resume: `${libelleGenre(segment.genre)} rogné` };
    }
    case 'scinder': {
      const a = nombre(op.a, -1);
      if (a <= segment.debut + DUREE_SEGMENT_MIN || a >= segment.debut + segment.duree - DUREE_SEGMENT_MIN) return echec('le point de coupe doit tomber à l’intérieur du segment');
      if (segment.genre === 'voix' || segment.genre === 'sous-titres') return echec('une voix ou des sous-titres ne se coupent pas : coupe le texte en deux segments');
      const second = cloner(segment);
      second.id = idNeuf('seg');
      second.debut = arrondi(a);
      second.duree = arrondi(segment.debut + segment.duree - a);
      segment.duree = arrondi(a - segment.debut);
      if ((second.genre === 'audio' || second.genre === 'video') && segment.genre === second.genre) second.debutMedia = arrondi(second.debutMedia + segment.duree * vitesseDe(segment));
      piste.segments.push(second);
      piste.segments.sort((x, y) => x.debut - y.debut);
      return { ok: true, composition: c, resume: `${libelleGenre(segment.genre)} coupé en deux` };
    }
    case 'retirer-passage': {
      if (segment.genre !== 'audio' && segment.genre !== 'video') return echec('seul un son ou une vidéo perd un passage : pour une voix, retire les mots de son texte');
      const fin = segment.debut + segment.duree;
      const de = arrondi(Math.max(segment.debut, nombre(op.de, segment.debut)));
      const a = arrondi(Math.min(fin, nombre(op.a, fin)));
      if (a - de < DUREE_SEGMENT_MIN) return echec('le passage à retirer est trop court');
      if (de - segment.debut < DUREE_SEGMENT_MIN && fin - a < DUREE_SEGMENT_MIN) return echec('le passage couvre tout le bloc : supprime-le plutôt');
      const vitesse = vitesseDe(segment);
      const debutMediaApres = arrondi(segment.debutMedia + (a - segment.debut) * vitesse);
      if (de - segment.debut < DUREE_SEGMENT_MIN) {
        // Le passage ouvre le bloc : le reste démarre à la même place, plus loin dans le fichier.
        segment.debutMedia = debutMediaApres;
        segment.duree = arrondi(fin - a);
        delete segment.fonduEntree;
      } else if (fin - a < DUREE_SEGMENT_MIN) {
        segment.duree = arrondi(de - segment.debut);
        delete segment.fonduSortie;
      } else {
        const apres = cloner(segment);
        apres.id = idNeuf('seg');
        apres.debut = de;
        apres.duree = arrondi(fin - a);
        apres.debutMedia = debutMediaApres;
        delete apres.fonduEntree;
        delete apres.entree;
        segment.duree = arrondi(de - segment.debut);
        delete segment.fonduSortie;
        delete segment.sortie;
        piste.segments.push(apres);
      }
      piste.segments.sort((x, y) => x.debut - y.debut);
      return { ok: true, composition: c, resume: `passage de ${(a - de).toFixed(1)} s retiré` };
    }
    case 'proprietes': {
      const permises = PROPRIETES_MODIFIABLES[segment.genre];
      const brut: any = { ...segment };
      for (const [cle, valeur] of Object.entries(op.valeurs ?? {})) {
        if (!permises.includes(cle)) return echec(`« ${cle} » ne se règle pas sur un segment « ${segment.genre} »`);
        brut[cle] = valeur;
      }
      // UN TEXTE DE VOIX CHANGÉ APRÈS VALIDATION repasse CE SEUL segment « à revalider ».
      if (segment.genre === 'voix' && typeof op.valeurs?.texte === 'string' && op.valeurs.texte !== segment.texte) {
        brut.etat = segment.etat === 'finale' ? 'a-revalider' : segment.etat === 'essai' ? 'essai' : segment.etat;
        brut.mots = undefined;
      }
      /* UNE VITESSE CHANGÉE garde le MÊME passage du fichier : le bloc raccourcit
         quand on accélère, s'allonge quand on ralentit. */
      if ((segment.genre === 'audio' || segment.genre === 'video' || segment.genre === 'voix') && op.valeurs && 'vitesse' in op.valeurs) {
        const nouvelle = lireVitesse(op.valeurs.vitesse).vitesse ?? 1;
        brut.duree = arrondi(Math.max(DUREE_SEGMENT_MIN, (segment.duree * vitesseDe(segment)) / nouvelle));
      }
      if (!reposer(piste, index, brut)) return echec('propriétés illisibles');
      const sonDeVoix = segment.genre === 'voix' && op.valeurs && ('vitesse' in op.valeurs || 'debutMedia' in op.valeurs);
      return { ok: true, composition: sonDeVoix ? recalerSousTitres(c) : c, resume: `${libelleGenre(segment.genre)} modifié` };
    }
    case 'parametre': {
      if (segment.genre !== 'dessin') return echec('seul un dessin a des paramètres');
      const p = segment.parametres.find((x) => x.id === op.id);
      if (!p) return echec(`le dessin n’a pas de paramètre « ${op.id} »`);
      segment.valeurs[p.id] = valeurDuParametre(p, op.valeur);
      return { ok: true, composition: c, resume: `« ${p.libelle} » réglé` };
    }
    case 'retouche':
    case 'effacer-retouche': {
      if (!idValide(op.elementId)) return echec('élément illisible');
      const format = op.format && op.format !== c.format ? op.format : undefined;
      let table: Record<string, Retouche>;
      if (format) {
        segment.surcharges = segment.surcharges ?? {};
        const s = (segment.surcharges[format] = segment.surcharges[format] ?? {});
        table = s.retouches = s.retouches ?? {};
      } else {
        table = segment.retouches = segment.retouches ?? {};
      }
      if (op.op === 'effacer-retouche') {
        delete table[op.elementId];
        return { ok: true, composition: c, resume: 'retouche effacée' };
      }
      const fusion = lireRetouche({ ...(table[op.elementId] ?? {}), ...(op.retouche ?? {}) });
      if (!fusion) {
        // Une pièce démasquée (ou remise à son plan) qui n'a plus rien d'autre : sa retouche disparaît.
        if (!table[op.elementId]) return echec('retouche vide');
        delete table[op.elementId];
        return { ok: true, composition: c, resume: 'retouche effacée' };
      }
      table[op.elementId] = fusion;
      const resume = op.retouche?.masquee === true ? 'pièce masquée' : op.retouche?.masquee === false ? 'pièce affichée' : op.retouche?.plan !== undefined ? 'plan de la pièce changé' : 'élément retouché';
      return { ok: true, composition: c, resume };
    }
    case 'remplacer-media': {
      if (segment.genre !== 'image' && segment.genre !== 'video' && segment.genre !== 'audio') return echec('ce segment ne porte pas de média');
      if (!idValide(op.mediaId)) return echec('média illisible');
      segment.mediaId = op.mediaId;
      return { ok: true, composition: c, resume: 'média remplacé' };
    }
    case 'supprimer': {
      piste.segments.splice(index, 1);
      return { ok: true, composition: c, resume: `${libelleGenre(segment.genre)} retiré` };
    }
    case 'dessin': {
      if (segment.genre !== 'dessin') return echec('ce segment n’est pas un dessin');
      const parametres = lireParametres(op.parametres);
      const valeurs: Record<string, ValeurParametre> = {};
      // Les valeurs choisies survivent au redessin quand le paramètre existe encore.
      for (const p of parametres) {
        valeurs[p.id] = Object.prototype.hasOwnProperty.call(segment.valeurs, p.id) ? valeurDuParametre(p, segment.valeurs[p.id]) : p.defaut;
      }
      const elements = (op.elements ?? []).filter(idValide);
      // Les retouches à la main SURVIVENT au redessin pour tout élément encore présent.
      const garder = (table?: Record<string, Retouche>) => {
        if (!table) return undefined;
        const sortie = Object.fromEntries(Object.entries(table).filter(([cle]) => elements.includes(cle)));
        return Object.keys(sortie).length ? sortie : undefined;
      };
      segment.gabarit = { html: texte(op.gabarit?.html, 200_000), css: texte(op.gabarit?.css, 100_000), animation: texte(op.gabarit?.animation, 60_000) };
      segment.parametres = parametres;
      segment.valeurs = valeurs;
      segment.elements = elements;
      segment.retouches = garder(segment.retouches);
      if (segment.surcharges) {
        for (const f of CLES_FORMATS_STUDIO) {
          const s = segment.surcharges[f];
          if (s) s.retouches = garder(s.retouches);
        }
      }
      return { ok: true, composition: c, resume: 'dessin redessiné' };
    }
  }
  return echec('opération inconnue');
}

export function libelleGenre(genre: GenreSegment): string {
  return { dessin: 'dessin', texte: 'texte', image: 'image', video: 'vidéo', audio: 'son', voix: 'voix', 'sous-titres': 'sous-titres' }[genre];
}

/* ------------------------------------------------------------------ */
/* Voix : alignement des mots et recalage                               */
/* ------------------------------------------------------------------ */

/** La voix d'essai par défaut : Piper, voix « Claire ». */
export const VOIX_ESSAI_PAR_DEFAUT = 'fr_FR-siwis-medium';

export const TIMBRES_VOIX = ['ferme', 'legere', 'lumineuse', 'jeune', 'detendue', 'vive', 'douce', 'nette', 'chaleureuse', 'enjouee', 'posee', 'energique', 'claire', 'veloutee', 'grave', 'amicale', 'experte', 'mure'] as const;
export type TimbreVoix = (typeof TIMBRES_VOIX)[number];

/**
 * LES VINGT VOIX FINALES DU STUDIO — des voix préenregistrées de Gemini, dix de
 * femme et dix d'homme, chacune avec son timbre (le qualificatif publié par
 * Google). Liste DÉDIÉE au Studio : `VOIX_GEMINI` (quatre voix) reste celle de la
 * voix de lecture de l'application, qu'elle ne doit pas alourdir. Les quatre de
 * cette liste-là y figurent aussi : un réglage déjà posé reste valable.
 */
export const VOIX_FINALES_STUDIO: readonly { id: string; genre: 'femme' | 'homme'; timbre: TimbreVoix }[] = [
  { id: 'Kore', genre: 'femme', timbre: 'ferme' },
  { id: 'Aoede', genre: 'femme', timbre: 'legere' },
  { id: 'Zephyr', genre: 'femme', timbre: 'lumineuse' },
  { id: 'Leda', genre: 'femme', timbre: 'jeune' },
  { id: 'Callirrhoe', genre: 'femme', timbre: 'detendue' },
  { id: 'Autonoe', genre: 'femme', timbre: 'vive' },
  { id: 'Despina', genre: 'femme', timbre: 'veloutee' },
  { id: 'Erinome', genre: 'femme', timbre: 'nette' },
  { id: 'Achernar', genre: 'femme', timbre: 'douce' },
  { id: 'Sulafat', genre: 'femme', timbre: 'chaleureuse' },
  { id: 'Puck', genre: 'homme', timbre: 'enjouee' },
  { id: 'Charon', genre: 'homme', timbre: 'posee' },
  { id: 'Fenrir', genre: 'homme', timbre: 'energique' },
  { id: 'Orus', genre: 'homme', timbre: 'ferme' },
  { id: 'Iapetus', genre: 'homme', timbre: 'claire' },
  { id: 'Umbriel', genre: 'homme', timbre: 'detendue' },
  { id: 'Algieba', genre: 'homme', timbre: 'veloutee' },
  { id: 'Algenib', genre: 'homme', timbre: 'grave' },
  { id: 'Achird', genre: 'homme', timbre: 'amicale' },
  { id: 'Sadaltager', genre: 'homme', timbre: 'experte' },
];

export function estVoixFinaleStudio(valeur: unknown): valeur is string {
  return typeof valeur === 'string' && VOIX_FINALES_STUDIO.some((v) => v.id === valeur);
}

/** La phrase fixe des extraits : chaque voix la dit une fois, l'extrait est gardé et resservi à tous les projets. */
export const PHRASE_EXTRAIT_STUDIO = 'Bonjour ! Voici ma voix pour vos vidéos. Elle parle français, posément et clairement.';

function normaliserMot(mot: string): string {
  return mot
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Les mots d'un texte, ponctuation gardée sur le mot (c'est ce qui s'affiche). */
export function motsDitsDuTexte(t: string): string[] {
  return t.split(/\s+/).filter((m) => normaliserMot(m) || /\d/.test(m));
}

/**
 * ALIGNER LE TEXTE CONNU SUR LES MOTS RECONNUS. La reconnaissance se trompe
 * parfois de mot (« voie » pour « voix ») : l'affichage garde le texte de
 * l'utilisateur, la reconnaissance ne donne que les TEMPS. Alignement par
 * distance d'édition ; un mot connu resté seul prend un temps interpolé entre
 * ses voisins.
 */
export function alignerMots(texteConnu: string, reconnus: MotHorodate[], dureeTotale?: number): MotHorodate[] {
  const connus = motsDitsDuTexte(texteConnu);
  if (!connus.length) return [];
  const a = connus.map(normaliserMot);
  const b = reconnus.map((m) => normaliserMot(m.texte));
  const n = a.length;
  const m = b.length;
  // Coût : 0 si égaux, 1 si proches (même début), 2 sinon ; insertion/suppression 1.
  const cout = (i: number, j: number) => (a[i] === b[j] ? 0 : a[i]!.slice(0, 3) === b[j]!.slice(0, 3) && a[i]!.length > 2 ? 1 : 2);
  const d: number[][] = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cout(i - 1, j - 1));
    }
  }
  const lien: (number | null)[] = Array(n).fill(null);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (d[i]![j] === d[i - 1]![j - 1]! + cout(i - 1, j - 1) && cout(i - 1, j - 1) < 2) {
      lien[i - 1] = j - 1;
      i--;
      j--;
    } else if (d[i]![j] === d[i - 1]![j]! + 1) i--;
    else if (d[i]![j] === d[i]![j - 1]! + 1) j--;
    else {
      // Substitution franche : on lie quand même, la position compte plus que le mot.
      lien[i - 1] = j - 1;
      i--;
      j--;
    }
  }
  const fin = dureeTotale ?? (reconnus.length ? reconnus[reconnus.length - 1]!.fin : connus.length * 0.35);
  const sortie: MotHorodate[] = connus.map((texte, k) => {
    const r = lien[k] !== null ? reconnus[lien[k]!] : undefined;
    return { texte, debut: r ? r.debut : NaN, fin: r ? r.fin : NaN };
  });
  // Les mots restés seuls : temps interpolés entre les voisins connus.
  for (let k = 0; k < sortie.length; k++) {
    if (!Number.isNaN(sortie[k]!.debut)) continue;
    let g = k - 1;
    while (g >= 0 && Number.isNaN(sortie[g]!.debut)) g--;
    let h = k + 1;
    while (h < sortie.length && Number.isNaN(sortie[h]!.debut)) h++;
    const depuis = g >= 0 ? sortie[g]!.fin : 0;
    const jusqua = h < sortie.length ? sortie[h]!.debut : fin;
    const trou = h - g - 1;
    const pas = Math.max(0, jusqua - depuis) / Math.max(1, trou);
    for (let q = g + 1; q < h; q++) {
      const rang = q - g - 1;
      sortie[q] = { texte: sortie[q]!.texte, debut: arrondi(depuis + rang * pas), fin: arrondi(depuis + (rang + 1) * pas) };
    }
    k = h - 1;
  }
  return sortie.map((mot) => ({ texte: mot.texte, debut: arrondi(mot.debut), fin: arrondi(Math.max(mot.debut, mot.fin)) }));
}

/** Sans reconnaissance des mots : des temps répartis au prorata de la longueur des mots. */
export function motsRepartis(texteConnu: string, duree: number): MotHorodate[] {
  const connus = motsDitsDuTexte(texteConnu);
  const poids = connus.map((m) => Math.max(2, m.length));
  const total = poids.reduce((x, y) => x + y, 0) || 1;
  let t = 0;
  return connus.map((texte, k) => {
    const d = (duree * poids[k]!) / total;
    const mot = { texte, debut: arrondi(t), fin: arrondi(t + d) };
    t += d;
    return mot;
  });
}

/** Un petit souffle après chaque phrase dite, pour que la scène ne coupe pas net. */
export const SOUFFLE_APRES_VOIX = 0.25;

/**
 * RECALER APRÈS UNE NOUVELLE VOIX. La durée réelle du son ajuste son segment ;
 * tout ce qui commence après l'ancienne fin est décalé d'autant (toutes pistes),
 * ce qui chevauchait cette fin est allongé ou raccourci, et les sous-titres
 * automatiques sont recalculés depuis les voix.
 */
export function recaler(
  composition: Composition,
  segmentId: string,
  dureeAudio: number,
  mots?: MotHorodate[],
  passage?: { debut: number; fin: number },
): Composition {
  const c = cloner(composition);
  const trouve = trouverSegment(c, segmentId);
  if (!trouve || trouve.segment.genre !== 'voix') return c;
  const voix = trouve.segment;
  const ancienneFin = voix.debut + voix.duree;
  // UN SON NEUF : l'ancien passage choisi ne veut plus rien dire, la voix est jouée en entier (à sa vitesse)…
  delete voix.debutMedia;
  // …sauf dans une PRISE UNIQUE : la phrase est SON passage du fichier commun, silences de bord compris,
  // et le bloc dure exactement ce passage (un souffle ajouté ferait entendre le début de la phrase suivante).
  if (passage && passage.debut > 0) voix.debutMedia = arrondi(passage.debut);
  const nouvelleDuree = passage
    ? arrondi(Math.max(DUREE_SEGMENT_MIN, (passage.fin - passage.debut) / vitesseDe(voix)))
    : arrondi(Math.max(DUREE_SEGMENT_MIN, dureeAudio / vitesseDe(voix) + SOUFFLE_APRES_VOIX));
  const ecart = nouvelleDuree - voix.duree;
  voix.duree = nouvelleDuree;
  voix.dureeAudio = arrondi(dureeAudio);
  if (mots) voix.mots = mots;
  if (Math.abs(ecart) > 0.001) {
    for (const piste of c.pistes) {
      for (const s of piste.segments) {
        if (s.id === voix.id) continue;
        if (s.genre === 'sous-titres' && s.auto) continue;
        if (s.debut >= ancienneFin - 0.01) s.debut = arrondi(Math.max(0, s.debut + ecart));
        else if (s.debut < ancienneFin && s.debut + s.duree > ancienneFin - 0.01 && piste.genre === 'visuel') {
          s.duree = arrondi(Math.max(DUREE_SEGMENT_MIN, s.duree + ecart));
        }
      }
      piste.segments.sort((x, y) => x.debut - y.debut);
    }
  }
  return recalerSousTitres(c);
}

/**
 * LES MOTS D'UNE VOIX, EN TEMPS DE LA COMPOSITION : les mots sont gardés en temps
 * du fichier ; seuls ceux du passage joué restent, décalés de son début et
 * divisés par la vitesse.
 */
export function motsJoues(v: SegmentVoix): MotHorodate[] {
  const debutMedia = v.debutMedia ?? 0;
  const vitesse = v.vitesse ?? 1;
  const finMedia = debutMedia + v.duree * vitesse;
  return (v.mots ?? [])
    .filter((m) => m.fin > debutMedia + 0.01 && m.debut < finMedia - 0.01)
    .map((m) => ({
      texte: m.texte,
      debut: arrondi(v.debut + (Math.max(m.debut, debutMedia) - debutMedia) / vitesse),
      fin: arrondi(v.debut + (Math.min(m.fin, finMedia) - debutMedia) / vitesse),
    }));
}

/** Les sous-titres automatiques suivent les voix : les mots de chaque voix, mis en temps absolu. */
export function recalerSousTitres(composition: Composition): Composition {
  const c = cloner(composition);
  const voix = tousLesSegments(c)
    .filter((s): s is SegmentVoix => s.genre === 'voix' && !!s.mots?.length)
    .sort((x, y) => x.debut - y.debut);
  const mots = voix.flatMap(motsJoues);
  for (const piste of c.pistes) {
    for (const s of piste.segments) {
      if (s.genre !== 'sous-titres' || !s.auto) continue;
      s.mots = mots;
      if (mots.length) {
        s.debut = 0;
        s.duree = arrondi(Math.max(DUREE_SEGMENT_MIN, mots[mots.length - 1]!.fin + 0.3));
      }
    }
  }
  return c;
}

/** Les groupes de sous-titres (deux mots au plus), chacun avec ses temps. */
export function groupesDeSousTitres(mots: MotHorodate[], parGroupe: 1 | 2): { mots: MotHorodate[]; debut: number; fin: number }[] {
  const groupes: { mots: MotHorodate[]; debut: number; fin: number }[] = [];
  for (let k = 0; k < mots.length; k += parGroupe) {
    const g = mots.slice(k, k + parGroupe);
    const suivant = mots[k + parGroupe];
    // Le groupe reste affiché jusqu'au suivant s'il est proche : pas de clignotement entre deux mots.
    const fin = suivant && suivant.debut - g[g.length - 1]!.fin < 0.4 ? suivant.debut : g[g.length - 1]!.fin;
    groupes.push({ mots: g, debut: g[0]!.debut, fin: Math.max(fin, g[0]!.debut + 0.05) });
  }
  return groupes;
}

/** Les voix d'une composition qui ne sont pas encore en voix finale. */
export function voixPasFinales(c: Composition): SegmentVoix[] {
  return tousLesSegments(c).filter((s): s is SegmentVoix => s.genre === 'voix' && s.etat !== 'finale');
}

/**
 * UNE SEULE VOIX FINALE PAR CRÉATION : celle choisie dans la fenêtre « Mettre
 * en production » (la voix du projet, `EspaceStudio.voixFinale`), Kore à
 * défaut. Le `voixFinale` d'un segment n'est plus un CHOIX : c'est la voix
 * réellement produite, posée par `poserLeSon`, qui sert à repérer une phrase
 * faite dans une autre voix (décision de l'utilisateur, 07/10/2026 — l'agent
 * avait posé « Kore » sur chaque phrase et la voix choisie était ignorée).
 */
export const VOIX_FINALE_PAR_DEFAUT = 'Kore';

export function voixFinaleDuProjet(voixDeLEspace: unknown): string {
  return estVoixFinaleStudio(voixDeLEspace) ? voixDeLEspace : VOIX_FINALE_PAR_DEFAUT;
}

/** Une phrase DÉJÀ en voix finale, mais dans une autre voix que celle du projet. */
export function phraseDansUneAutreVoix(s: Pick<SegmentVoix, 'etat' | 'voixFinale'>, voixDuProjet: string): boolean {
  return s.etat === 'finale' && s.voixFinale !== voixDuProjet;
}

/** Une phrase qui entre dans le prochain « Valider la voix » : pas encore finale, ou finale dans une autre voix. */
export function voixFinaleARefaire(s: Pick<SegmentVoix, 'etat' | 'voixFinale' | 'texte'>, voixDuProjet: string): boolean {
  return !!s.texte.trim() && (s.etat !== 'finale' || phraseDansUneAutreVoix(s, voixDuProjet));
}

/*
 * LA PRISE UNIQUE (décision de l'utilisateur, 07/10/2026 — « je paie pour la
 * voix que j'ai demandée, pas une autre ») : la voix finale de toute la vidéo
 * est dite d'UN SEUL appel, puis découpée phrase par phrase. Chaque appel au
 * moteur tire son propre timbre et son accent (un accent canadien est apparu
 * sur une phrase faite seule) : une phrase refaite à part s'entendrait. Dès
 * qu'UNE phrase est à refaire (texte changé, phrase ajoutée, autre voix), c'est
 * donc TOUTE la prise qui repart.
 */

/** Les phrases de la prise : toutes les voix qui ont des mots à dire, dans l'ordre de la ligne de temps. */
export function phrasesDeLaPrise(c: Composition): SegmentVoix[] {
  return tousLesSegments(c)
    .filter((s): s is SegmentVoix => s.genre === 'voix' && motsDitsDuTexte(s.texte).length > 0)
    .sort((x, y) => x.debut - y.debut);
}

/** La prise est à refaire dès qu'une seule de ses phrases l'est. */
export function priseARefaire(c: Composition, voixDuProjet: string): boolean {
  return phrasesDeLaPrise(c).some((s) => voixFinaleARefaire(s, voixDuProjet));
}

/** Les phrases jointes en un seul texte : un saut de paragraphe entre deux, que le moteur dit comme une pause. */
export function texteDeLaPrise(textes: readonly string[]): string {
  return textes.map((t) => t.trim()).join('\n\n');
}

/**
 * Le plus long texte dit d'un seul appel. Gemini 3.8 Flash TTS a été mesuré
 * juste jusqu'à ≈ 6 500 signes de texte varié (compétence « voix de synthèse
 * d'un seul tenant », 07/10/2026) ; au-delà, la prise se coupe en lots, aux
 * limites de phrases, le moins possible (une vidéo du Studio en est très loin).
 */
export const PLAFOND_SIGNES_PRISE = 5_000;

/** Les lots d'une prise (indices des phrases), chacun sous le plafond ; une phrase trop longue fait son lot seule. */
export function lotsDeLaPrise(textes: readonly string[], plafond = PLAFOND_SIGNES_PRISE): number[][] {
  const lots: number[][] = [];
  let courant: number[] = [];
  let signes = 0;
  textes.forEach((t, i) => {
    const n = t.trim().length + 2;
    if (courant.length && signes + n > plafond) {
      lots.push(courant);
      courant = [];
      signes = 0;
    }
    courant.push(i);
    signes += n;
  });
  if (courant.length) lots.push(courant);
  return lots;
}

/** Ce qu'on laisse au plus avant le premier mot et après le dernier d'une phrase découpée. */
export const MARGE_AVANT_PHRASE = 0.15;
export const MARGE_APRES_PHRASE = 0.35;

/**
 * DÉCOUPER LA PRISE EN PHRASES. `mots` sont ceux du texte joint
 * (`texteDeLaPrise`), alignés sur la prise (`alignerMots`, ou `motsRepartis`
 * à défaut), en temps du FICHIER. Chaque phrase reçoit son passage
 * [debut, fin] et ses mots : la coupe tombe dans le silence entre deux
 * phrases, sans jamais prendre plus de sa marge de part et d'autre, ni mordre
 * sur un mot voisin.
 *
 * LES SILENCES MESURÉS DANS LE SON (`silences`, ffmpeg silencedetect)
 * l'emportent sur les temps des mots : la reconnaissance place mal un mot
 * qu'elle a mal compris (« L'avoir » pour « La voix », 07/10/2026 : le mot
 * interpolé collait à la phrase d'avant et la coupe mordait sur « clients »).
 * Autour de chaque coupe prévue, le plus LONG silence à moins d'une seconde
 * est retenu — la pause entre deux paragraphes, plus longue que celle d'une
 * virgule.
 */
export function bornesDesPhrases(
  textes: readonly string[],
  mots: readonly MotHorodate[],
  duree: number,
  silences: readonly { debut: number; fin: number }[] = [],
): { debut: number; fin: number; mots: MotHorodate[] }[] {
  const parPhrase: MotHorodate[][] = [];
  let k = 0;
  for (const t of textes) {
    const n = motsDitsDuTexte(t).length;
    parPhrase.push(mots.slice(k, k + n));
    k += n;
  }
  const sortie = parPhrase.map((m) => ({ debut: m[0]?.debut ?? 0, fin: m[m.length - 1]?.fin ?? 0, mots: m.map((x) => ({ ...x })) }));
  for (let i = 0; i < sortie.length; i++) {
    const p = sortie[i]!;
    const premier = p.mots[0];
    const dernier = p.mots[p.mots.length - 1];
    if (!premier || !dernier) continue;
    const avant = sortie.slice(0, i).reverse().find((x) => x.mots.length);
    const apres = sortie.slice(i + 1).find((x) => x.mots.length);
    // La pause qui précède (et celle qui suit) : mesurée dans le son si possible, sinon entre les mots.
    const pause = (fin: number, debut: number): { debut: number; fin: number } => {
      const prevue = (fin + debut) / 2;
      const proches = silences.filter((x) => x.fin - x.debut >= 0.15 && x.debut > 0 && x.fin < duree && Math.abs((x.debut + x.fin) / 2 - prevue) <= 1);
      const longue = proches.sort((x, y) => y.fin - y.debut - (x.fin - x.debut))[0];
      return longue ?? { debut: fin, fin: debut };
    };
    const pauseAvant = avant ? pause(avant.mots[avant.mots.length - 1]!.fin, premier.debut) : null;
    const pauseApres = apres ? pause(dernier.fin, apres.mots[0]!.debut) : null;
    p.debut = arrondi(pauseAvant ? Math.max((pauseAvant.debut + pauseAvant.fin) / 2, pauseAvant.fin - MARGE_AVANT_PHRASE) : Math.max(0, premier.debut - MARGE_AVANT_PHRASE));
    p.fin = arrondi(pauseApres ? Math.min((pauseApres.debut + pauseApres.fin) / 2, pauseApres.debut + MARGE_APRES_PHRASE) : Math.min(duree, dernier.fin + MARGE_APRES_PHRASE));
    if (p.fin <= p.debut) p.fin = arrondi(Math.min(duree, p.debut + DUREE_SEGMENT_MIN));
  }
  return sortie;
}

/** La phrase « en cours » d'une fabrication en prise unique : toutes les phrases avancent ensemble. */
export const PRISE_ENTIERE = 'prise-entiere';

/**
 * L'AVANCEMENT D'UNE FABRICATION DE VOIX FINALES, tenu par le serveur dans
 * `details.avancement` de la dépense : la phrase en cours (et depuis quand),
 * celles faites, celles échouées. Le fournisseur rend chaque son d'un bloc :
 * le pourcentage d'une phrase en cours s'ESTIME au temps écoulé.
 */
export interface AvancementVoix {
  enCours?: { id: string; depuis: number };
  faits: string[];
  echecs: { id: string; raison: string }[];
  /** La durée moyenne d'une phrase, en millisecondes, mesurée sur les fabrications précédentes. */
  dureeMs?: number;
}

/** ≈ 10 à 14 s par phrase, mesurées le 07/10/2026 : l'estimation tant qu'aucune mesure n'existe. */
export const DUREE_PHRASE_VOIX_FINALE_MS = 12_000;

/** Une phrase en cours ne dépasse jamais ce chiffre tant que son son n'est pas rendu. */
export const PLAFOND_PHRASE_EN_COURS = 95;

export type EtatAvancementPhrase = 'attente' | 'en-cours' | 'faite' | 'echec';

export function avancementDesVoix(
  segmentIds: readonly string[],
  avancement: Partial<AvancementVoix> | undefined,
  maintenant: number,
): { phrases: Record<string, { pourcent: number; etat: EtatAvancementPhrase; raison?: string }>; global: number } {
  const faits = new Set(avancement?.faits ?? []);
  const echecs = new Map((avancement?.echecs ?? []).map((e) => [e.id, e.raison]));
  const duree = avancement?.dureeMs && avancement.dureeMs > 0 ? avancement.dureeMs : DUREE_PHRASE_VOIX_FINALE_MS;
  const phrases: Record<string, { pourcent: number; etat: EtatAvancementPhrase; raison?: string }> = {};
  let somme = 0;
  for (const id of segmentIds) {
    let p: { pourcent: number; etat: EtatAvancementPhrase; raison?: string };
    if (echecs.has(id)) p = { pourcent: 100, etat: 'echec', raison: echecs.get(id)! };
    else if (faits.has(id)) p = { pourcent: 100, etat: 'faite' };
    else if (avancement?.enCours && (avancement.enCours.id === id || avancement.enCours.id === PRISE_ENTIERE)) {
      const ecoule = Math.max(0, maintenant - avancement.enCours.depuis);
      p = { pourcent: Math.min(PLAFOND_PHRASE_EN_COURS, (ecoule / duree) * 100), etat: 'en-cours' };
    } else p = { pourcent: 0, etat: 'attente' };
    phrases[id] = p;
    somme += p.pourcent;
  }
  return { phrases, global: segmentIds.length ? somme / segmentIds.length : 0 };
}

/* ------------------------------------------------------------------ */
/* Devis                                                                */
/* ------------------------------------------------------------------ */

/** Jetons audio par seconde de voix Gemini (grille officielle Google). */
export const JETONS_AUDIO_PAR_SECONDE = 25;

/** Une voix finale coûte rarement plus que l'essai : on prend une marge, jamais moins de 3 s par segment. */
export const MARGE_DUREE_VOIX_FINALE = 1.3;

export function dureeEstimeeDuTexte(t: string): number {
  // ≈ 15 signes par seconde en français parlé posément.
  return Math.max(1, t.trim().length / 15);
}

/**
 * LE PLAFOND D'UN LOT DE VOIX FINALES : secondes × 25 jetons × prix au jeton,
 * plus le texte envoyé (≈ 4 signes par jeton). Le prix vient de la liste du
 * fournisseur lue en direct, jamais écrit ici.
 */
export function devisVoix(
  segments: Pick<SegmentVoix, 'texte' | 'dureeAudio'>[],
  prix: { parJetonAudio: number; parJetonTexte: number },
): { secondes: number; plafond: number } {
  let secondes = 0;
  let signes = 0;
  for (const s of segments) {
    const base = s.dureeAudio && s.dureeAudio > 0 ? s.dureeAudio : dureeEstimeeDuTexte(s.texte);
    secondes += Math.max(3, base * MARGE_DUREE_VOIX_FINALE);
    signes += s.texte.length + 80;
  }
  const plafond = secondes * JETONS_AUDIO_PAR_SECONDE * prix.parJetonAudio + (signes / 4) * prix.parJetonTexte;
  return { secondes: arrondi(secondes), plafond: Math.ceil(plafond * 10000) / 10000 };
}

/** Le prix d'un clip vidéo d'après les tarifs du fournisseur (`pricing_skus`). */
export function devisClip(
  skus: Record<string, string | number> | undefined,
  entree: { duree: number; son: boolean; resolution?: string },
): number | null {
  if (!skus) return null;
  const suffixe = entree.resolution === '720p' ? '_720p' : entree.resolution === '4K' ? '_4k' : '';
  const cle = `duration_seconds_${entree.son ? 'with' : 'without'}_audio${suffixe}`;
  const brut = skus[cle] ?? skus[`duration_seconds_${entree.son ? 'with' : 'without'}_audio`] ?? skus.duration_seconds;
  const parSeconde = Number(brut);
  if (!Number.isFinite(parSeconde) || parSeconde <= 0) return null;
  return Math.ceil(parSeconde * entree.duree * 10000) / 10000;
}

/** Un montant en dollars, lisible : « 0,0023 $ », « 1,20 $ ». */
export function montantLisible(montant: number | null | undefined, langue = 'fr-FR'): string {
  if (montant === null || montant === undefined) return '—';
  const chiffres = montant > 0 && montant < 0.1 ? 4 : 2;
  return `${montant.toLocaleString(langue, { minimumFractionDigits: chiffres, maximumFractionDigits: chiffres })} $`;
}

/**
 * LA GARDE DE DÉPENSE, en une règle : une génération payante n'est permise
 * qu'avec une dépense VALIDÉE, de son genre, pour sa création, pas encore
 * consommée. C'est le serveur qui l'applique, avant tout appel réseau.
 */
export function raisonDepenseRefusee(
  depense: Pick<DepenseStudio, 'etat' | 'genre' | 'creationId'> | null | undefined,
  attendu: { genre: GenreDepense; creationId: string },
): string | null {
  if (!depense) return 'aucune dépense validée : un appel payant attend toujours un clic sur « Valider »';
  if (depense.creationId !== attendu.creationId) return 'cette dépense a été validée pour une autre création';
  if (depense.genre !== attendu.genre) return `cette dépense couvre « ${depense.genre} », pas « ${attendu.genre} »`;
  if (depense.etat === 'en-attente') return 'cette dépense attend encore le clic de l’utilisateur';
  if (depense.etat === 'refusee') return 'cette dépense a été refusée par l’utilisateur';
  if (depense.etat !== 'validee') return 'cette dépense a déjà été consommée';
  return null;
}

/* ------------------------------------------------------------------ */
/* Titres, étiquettes, liens avec le Marketing                          */
/* ------------------------------------------------------------------ */

/** L'étiquette des cartes de l'agent du studio. */
export const LABEL_STUDIO = 'studio';

export function titreDeLAgentStudio(titreCreation: string): string {
  return `Studio — ${titreCreation}`.slice(0, 80);
}

/** Le format qu'un canal de l'atelier Marketing appelle d'abord. */
export function formatDuCanal(canal: string | undefined): FormatStudio {
  switch (canal) {
    case 'tiktok':
    case 'instagram':
      return '9:16';
    case 'youtube':
    case 'site':
    case 'presse':
    case 'x':
      return '16:9';
    case 'linkedin':
    case 'facebook':
    case 'pinterest':
    case 'publicite-reseaux':
      return '4:5';
    default:
      return '1:1';
  }
}

/** Le nom d'un fichier exporté : titre lisible, format, numéro de version. */
export function nomDExport(titre: string, format: FormatStudio, version: number, genre: 'video' | 'image', extension?: string): string {
  const base =
    titre
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\w]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 40) || 'creation';
  return `${base}-${format.replace(':', 'x')}-v${version}.${extension ?? (genre === 'video' ? 'mp4' : 'png')}`;
}
