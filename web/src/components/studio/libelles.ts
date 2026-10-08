import type { EtatVoix, FormatStudio, GenreSegment, RecetteAnimation, TimbreVoix } from '@beluga/shared';
import { t } from '@/lib/langue';

/**
 * LES MOTS DU STUDIO À L'ÉCRAN. Chaque texte passe par `t(...)` avec sa clé
 * écrite en toutes lettres : le dictionnaire ne garde que des textes réellement
 * affichés, et un appel calculé lui échapperait.
 */

export function libelleDuGenre(genre: GenreSegment): string {
  switch (genre) {
    case 'dessin':
      return t('Dessin');
    case 'texte':
      return t('Texte');
    case 'image':
      return t('Image');
    case 'video':
      return t('Vidéo');
    case 'audio':
      return t('Son');
    case 'voix':
      return t('Voix');
    default:
      return t('Sous-titres');
  }
}

export function libelleRecette(r: RecetteAnimation): string {
  switch (r) {
    case 'fondu':
      return t('Fondu');
    case 'glisse-haut':
      return t('Glisse vers le haut');
    case 'glisse-bas':
      return t('Glisse vers le bas');
    case 'glisse-gauche':
      return t('Glisse vers la gauche');
    case 'glisse-droite':
      return t('Glisse vers la droite');
    case 'zoom':
      return t('Zoom');
    case 'flou':
      return t('Sortie du flou');
    default:
      return t('Aucune');
  }
}

export function libelleEtatVoix(e: EtatVoix): string {
  switch (e) {
    case 'essai':
      return t('Voix d’essai');
    case 'finale':
      return t('Voix finale');
    case 'a-revalider':
      return t('À revalider');
    default:
      return t('Pas encore de voix');
  }
}

export function libelleFormat(f: FormatStudio): string {
  switch (f) {
    case '9:16':
      return t('Vertical');
    case '1:1':
      return t('Carré');
    case '4:5':
      return t('Portrait');
    default:
      return t('Horizontal');
  }
}

export function libelleDepense(genre: string): string {
  switch (genre) {
    case 'voix':
      return t('Voix finale');
    case 'musique':
      return t('Musique générée');
    case 'image':
      return t('Image fabriquée par IA');
    default:
      return t('Clip filmé par IA');
  }
}

export function libelleTimbre(timbre: TimbreVoix): string {
  switch (timbre) {
    case 'ferme':
      return t('ferme et claire');
    case 'legere':
      return t('légère et aérée');
    case 'lumineuse':
      return t('lumineuse');
    case 'jeune':
      return t('jeune');
    case 'detendue':
      return t('détendue');
    case 'vive':
      return t('vive');
    case 'douce':
      return t('douce');
    case 'nette':
      return t('nette');
    case 'chaleureuse':
      return t('chaleureuse');
    case 'enjouee':
      return t('enjouée');
    case 'posee':
      return t('posée, informative');
    case 'energique':
      return t('énergique');
    case 'claire':
      return t('claire');
    case 'veloutee':
      return t('veloutée');
    case 'grave':
      return t('grave, un peu rocailleuse');
    case 'amicale':
      return t('amicale');
    case 'experte':
      return t('savante, experte');
    default:
      return t('mûre');
  }
}

/** « Voix de femme · ferme et claire » : la seconde ligne d'une voix finale dans sa liste. */
export function descriptionDeVoix(v: { genre: 'femme' | 'homme'; timbre: TimbreVoix }): string {
  return `${v.genre === 'femme' ? t('Voix de femme') : t('Voix d’homme')} · ${libelleTimbre(v.timbre)}`;
}
