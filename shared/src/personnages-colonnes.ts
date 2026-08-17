/**
 * LE PERSONNAGE D'UNE COLONNE — un visage plutôt qu'un titre à lire.
 *
 * Sept personnages en pâte à modeler, un par colonne du tableau, DÉTOURÉS (fond
 * transparent) par `scripts/personnages-colonnes.py` à partir des images
 * fournies. Chacun existe en DEUX découpes, et elles ne sont pas
 * interchangeables :
 *
 *  - la SILHOUETTE entière, posée en tête de colonne. Elle vit dans une boîte de
 *    proportion FIXE (`PROPORTION_SILHOUETTE`), personnage centré et collé au
 *    bas : l'interface peut donc poser les sept au même endroit, avec le même
 *    décalage, sans mesurer chaque image ;
 *  - le PORTRAIT rond — la tête et le haut du corps —, pour les notifications,
 *    où l'on ne dispose que de quelques dizaines de pixels.
 *
 * Ici, aucune image, aucun DOM : seulement OÙ elles vivent, QUELLE colonne
 * représente une alerte, QUAND un personnage bouge et CE QU'ON ACCEPTE quand on
 * veut en remplacer un. Le service worker recopie ces tables (il ne partage
 * rien avec l'application) ; c'est un test qui les empêche de dériver.
 */

import { COLUMN_KEYS, type ColumnKey } from './columns.js';
import { MOTIFS, type MotifNotification } from './notification-tri.js';

/** Trois de large pour quatre de haut : la boîte de toutes les silhouettes. */
export const PROPORTION_SILHOUETTE = 3 / 4;

/** Les deux découpes d'un même personnage — elles ne sont pas interchangeables. */
export type DecoupeDePersonnage = 'silhouette' | 'portrait';

/** Le dossier public où vivent les images, côté navigateur comme sur le disque. */
export const DOSSIER_DES_PERSONNAGES = 'personnages';

/**
 * Le NOM DE FICHIER d'une découpe. Un seul endroit le décide : le navigateur,
 * le service worker, le script qui fabrique les images et le démon qui sert un
 * personnage REMPLACÉ doivent tous tomber sur le même nom.
 */
export function fichierDuPersonnage(colonne: ColumnKey, decoupe: DecoupeDePersonnage): string {
  return decoupe === 'portrait' ? `${colonne}-rond.png` : `${colonne}.png`;
}

/**
 * Où vivent les images, côté navigateur.
 *
 * `remplaceLe` est l'INSTANT du dernier remplacement de ce personnage, quand il
 * en a un : il ne change pas l'adresse servie (c'est le démon qui décide, à
 * cette même adresse, s'il rend l'image d'origine ou celle qu'on a déposée),
 * il force seulement le navigateur à REDEMANDER l'image au lieu de ressortir
 * celle qu'il garde en cache — sans quoi un remplacement ne se verrait qu'après
 * un vidage de cache.
 */
export function imageDuPersonnage(colonne: ColumnKey, remplaceLe?: number): string {
  return `/${DOSSIER_DES_PERSONNAGES}/${fichierDuPersonnage(colonne, 'silhouette')}${remplaceLe ? `?v=${remplaceLe}` : ''}`;
}

/** Le même personnage, tête au centre, découpé en rond. */
export function portraitDuPersonnage(colonne: ColumnKey, remplaceLe?: number): string {
  return `/${DOSSIER_DES_PERSONNAGES}/${fichierDuPersonnage(colonne, 'portrait')}${remplaceLe ? `?v=${remplaceLe}` : ''}`;
}

/* ------------------------------------------------------------------ */
/* Le personnage qui RÉAGIT quand un agent travaille                   */
/* ------------------------------------------------------------------ */

/**
 * LA SEULE COLONNE QUI BOUGE. Le tableau doit avoir l'air VIVANT quand quelque
 * chose se passe, et parfaitement IMMOBILE le reste du temps : c'est le
 * CONTRASTE entre les deux états qui porte l'information, pas le mouvement
 * lui-même. Sept personnages qui remuent en permanence ne diraient plus rien et
 * tireraient l'œil loin des cartes.
 */
export const COLONNE_VIVANTE: ColumnKey = 'running';

/**
 * Ce personnage doit-il bouger ? Oui pour la seule colonne « En cours », et
 * seulement tant qu'au moins une de ses cartes a un agent au travail. La règle
 * ne regarde PAS l'avancement (`avancementDeLaColonne`) : un agent qui n'a pas
 * encore annoncé sa liste de tâches ne pèse rien dans ce pourcentage, alors
 * qu'il travaille bel et bien — le personnage se figerait sur un tableau
 * pourtant occupé.
 *
 * Le respect de « je préfère moins d'animations » ne se décide pas ici : c'est
 * une préférence du système, lue par la feuille de style (`prefers-reduced-
 * motion`), qui coupe l'animation sans que rien d'autre ne change.
 */
export function personnageEnMouvement(colonne: ColumnKey, cartesAuTravail: number): boolean {
  return colonne === COLONNE_VIVANTE && cartesAuTravail > 0;
}

/* ------------------------------------------------------------------ */
/* Remplacer un personnage depuis les réglages                         */
/* ------------------------------------------------------------------ */

/** Ce qu'on accepte de recevoir : une image, et pas un fichier de dix méga. */
export const TAILLE_MAX_PERSONNAGE = 12 * 1024 * 1024;
export const TYPES_D_IMAGE_ACCEPTES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const EXTENSIONS_ACCEPTEES = ['.png', '.jpg', '.jpeg', '.webp'] as const;

/** Un refus est TOUJOURS dit, avec sa raison — jamais un échec muet. */
export type JugementDePersonnage = { ok: true } | { ok: false; raison: string };

/**
 * L'image déposée peut-elle devenir un personnage ? Le jugement est PUR : il
 * ne regarde ni le disque ni le contenu de l'image, seulement ce qu'on peut
 * savoir avant de dépenser une seconde de détourage. Ce qui échoue plus tard
 * (fond non uni, personnage introuvable) est dit par le détourage lui-même.
 */
export function jugerImageDePersonnage(depot: {
  colonne: string;
  mime?: string;
  taille: number;
  nom?: string;
}): JugementDePersonnage {
  if (!(COLUMN_KEYS as readonly string[]).includes(depot.colonne)) {
    return { ok: false, raison: `« ${depot.colonne} » n'est pas une colonne du tableau.` };
  }
  if (depot.taille <= 0) return { ok: false, raison: "Le fichier reçu est vide." };
  if (depot.taille > TAILLE_MAX_PERSONNAGE) {
    return {
      ok: false,
      raison: `L'image pèse ${Math.round(depot.taille / 1024 / 1024)} Mo : le maximum est de ${TAILLE_MAX_PERSONNAGE / 1024 / 1024} Mo.`,
    };
  }
  const type = (depot.mime ?? '').split(';')[0].trim().toLowerCase();
  const extension = (depot.nom ?? '').toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? '';
  const typeConnu = (TYPES_D_IMAGE_ACCEPTES as readonly string[]).includes(type);
  const extensionConnue = (EXTENSIONS_ACCEPTEES as readonly string[]).includes(extension);
  // L'un OU l'autre suffit : un navigateur peut envoyer un type générique, et
  // un fichier glissé depuis un dossier peut arriver sans extension.
  if (!typeConnu && !extensionConnue) {
    return {
      ok: false,
      raison: "Ce fichier n'est pas une image reconnue : il faut un PNG, un JPEG ou un WebP.",
    };
  }
  return { ok: true };
}

/**
 * La colonne dont l'alerte parle — donc le visage qu'elle porte. Tout motif n'en
 * a pas : un quota qui monte ou un serveur qui repart ne se passent dans AUCUNE
 * colonne, et prendre un personnage au hasard mentirait sur l'endroit où
 * regarder. Ces motifs-là gardent l'image de leur genre (`imageDeLAlerte`).
 */
export const COLONNE_DU_MOTIF: Partial<Record<MotifNotification, ColumnKey>> = {
  // Un travail rendu : la carte vient d'arriver en « Terminé ».
  'tache-terminee': 'done',
  'travail-sans-carte': 'done',
  'liste-taches': 'done',
  // Un échec ou une question arrêtent une carte EN COURS : c'est là qu'on va.
  'tache-echec': 'running',
  'decision-attendue': 'running',
  // Les deux étapes de la mise en ligne, chacune dans sa colonne.
  'publication-terminee': 'in_production',
  'publication-echec': 'to_deploy',
};

export function colonneDuMotif(motif?: string): ColumnKey | undefined {
  return motif && motif in MOTIFS ? COLONNE_DU_MOTIF[motif as MotifNotification] : undefined;
}

/**
 * Le visage d'une alerte : le portrait rond de sa colonne quand elle en a une,
 * sinon `undefined` — à l'appelant de retomber sur l'image du genre.
 */
export function avatarDeLAlerte(motif?: string): string | undefined {
  const colonne = colonneDuMotif(motif);
  return colonne ? portraitDuPersonnage(colonne) : undefined;
}
