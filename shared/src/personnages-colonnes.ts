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
 * Ici, aucune image, aucun DOM : seulement OÙ elles vivent et QUELLE colonne
 * représente une alerte. Le service worker recopie ces tables (il ne partage
 * rien avec l'application) ; c'est un test qui les empêche de dériver.
 */

import type { ColumnKey } from './columns.js';
import { MOTIFS, type MotifNotification } from './notification-tri.js';

/** Trois de large pour quatre de haut : la boîte de toutes les silhouettes. */
export const PROPORTION_SILHOUETTE = 3 / 4;

/** Où vivent les images, côté navigateur. */
export function imageDuPersonnage(colonne: ColumnKey): string {
  return `/personnages/${colonne}.png`;
}

/** Le même personnage, tête au centre, découpé en rond. */
export function portraitDuPersonnage(colonne: ColumnKey): string {
  return `/personnages/${colonne}-rond.png`;
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
