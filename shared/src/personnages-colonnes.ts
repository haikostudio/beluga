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

/**
 * Les découpes d'un même personnage — elles ne sont pas interchangeables. Les
 * deux premières sont FIXES et existent pour les sept colonnes ; la troisième
 * est la BOUCLE ANIMÉE du geste de travail, et seule la colonne vivante en a
 * une (`COLONNES_ANIMEES`).
 */
export type DecoupeDePersonnage = 'silhouette' | 'portrait' | 'anime';

/** Le dossier public où vivent les images, côté navigateur comme sur le disque. */
export const DOSSIER_DES_PERSONNAGES = 'personnages';

/**
 * Le NOM DE FICHIER d'une découpe. Un seul endroit le décide : le navigateur,
 * le service worker, le script qui fabrique les images et le démon qui sert un
 * personnage REMPLACÉ doivent tous tomber sur le même nom.
 */
export function fichierDuPersonnage(colonne: ColumnKey, decoupe: DecoupeDePersonnage): string {
  if (decoupe === 'portrait') return `${colonne}-rond.png`;
  // Un WEBP animé, jamais un GIF : le GIF ne connaît qu'une transparence
  // tout-ou-rien, qui rendrait au personnage détouré le contour en escalier que
  // l'alpha progressif lui évite — et il pèse plusieurs fois plus lourd, pour
  // une image que le tableau redemande à chaque affichage.
  if (decoupe === 'anime') return `${colonne}-anime.webp`;
  return `${colonne}.png`;
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

/**
 * Les colonnes dont le personnage a une BOUCLE ANIMÉE livrée avec
 * l'application. Une seule aujourd'hui — le mineur de « En cours » qui donne
 * des coups de pioche —, mais la table existe pour que rien, dans l'interface
 * ni dans les contrôles, n'écrive « running » à la main pour le savoir.
 */
export const COLONNES_ANIMEES: readonly ColumnKey[] = [COLONNE_VIVANTE];

/**
 * La question posée au navigateur : cet écran doit-il s'agiter le moins
 * possible ? La feuille de style la pose déjà pour toutes les animations CSS ;
 * elle est écrite ici parce qu'une IMAGE animée oblige le code à la poser aussi.
 */
export const REQUETE_ANIMATIONS_REDUITES = '(prefers-reduced-motion: reduce)';

/** Le fichier de la boucle animée, à la même adresse que les images fixes. */
export function animeDuPersonnage(colonne: ColumnKey): string {
  return `/${DOSSIER_DES_PERSONNAGES}/${fichierDuPersonnage(colonne, 'anime')}`;
}

/**
 * CE QUE FAIT LE PERSONNAGE, à l'instant qu'on regarde. Trois gestes et pas un
 * de plus :
 *
 *  - « immobile » — le cas de tous, presque tout le temps. Aucune classe posée,
 *    aucune image animée demandée : l'immobilité est TOTALE, et c'est elle qui
 *    donne son sens au reste ;
 *  - « pioche » — la boucle animée, quand la colonne en a une. Le mineur donne
 *    de vrais coups de pioche : un geste de TRAVAIL, qui se reconnaît d'un coup
 *    d'œil là où un balancement demandait de deviner ;
 *  - « balancement » — l'animation de repli, tenue par la feuille de style.
 *
 * Deux choses seulement font retomber sur le balancement, et aucune n'est un
 * échec : un personnage REMPLACÉ depuis les réglages (l'image déposée est fixe,
 * garder la boucle livrée montrerait le mineur d'origine à la place de celui
 * qu'on vient de choisir) et une colonne SANS boucle. L'information « ça
 * travaille » n'est donc jamais perdue, seule sa forme change.
 *
 * « Je préfère moins d'animations » ne se décide PAS ici pour le balancement —
 * la feuille de style le neutralise seule. Mais une image animée ne s'arrête
 * par aucune règle CSS : c'est le seul motif pour lequel cette préférence
 * remonte jusqu'ici, et elle rend alors le personnage parfaitement immobile.
 */
export type GesteDuPersonnage = 'immobile' | 'pioche' | 'balancement';

export function gesteDuPersonnage(
  colonne: ColumnKey,
  cartesAuTravail: number,
  etat: { remplace?: boolean; animationsReduites?: boolean } = {},
): GesteDuPersonnage {
  if (!personnageEnMouvement(colonne, cartesAuTravail)) return 'immobile';
  if (etat.remplace || !COLONNES_ANIMEES.includes(colonne)) return 'balancement';
  return etat.animationsReduites ? 'immobile' : 'pioche';
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
  // Un travail rendu : la carte vient d'arriver en « À déployer ».
  'tache-terminee': 'to_deploy',
  'travail-sans-carte': 'to_deploy',
  'liste-taches': 'to_deploy',
  // Un échec ou une question arrêtent une carte EN COURS : c'est là qu'on va.
  'tache-echec': 'running',
  'decision-attendue': 'running',
  // Les deux étapes de la mise en ligne : une publication réussie range ses
  // cartes en « Archivé », c'est donc là qu'on va les voir.
  'publication-terminee': 'archived',
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
