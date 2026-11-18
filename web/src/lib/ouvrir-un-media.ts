/**
 * OUVRIR UN MÉDIA DANS LA VISIONNEUSE DE L'APPLICATION, depuis n'importe où — un rendu Markdown, une vignette, un
 * lien. Séparé de la visionneuse elle-même (`components/visionneuse-des-medias.tsx`, montée une fois par l'écran
 * principal) pour que le rendu Markdown puisse s'en servir sans importer l'aperçu, qui importe le rendu Markdown.
 *
 * C'est le SEUL repli d'une image ou d'un média de réponse d'agent : jamais `window.open` (03/11/2026).
 */
import type { MediaDuLien } from '@beluga/shared';

export const EVENEMENT_OUVRIR_UN_MEDIA = 'beluga:ouvrir-un-media';

export function ouvrirUnMedia(media: MediaDuLien): void {
  window.dispatchEvent(new CustomEvent<MediaDuLien>(EVENEMENT_OUVRIR_UN_MEDIA, { detail: media }));
}
