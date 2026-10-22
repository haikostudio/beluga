import { z } from 'zod';
import { GENRES_DE_MEDIA_EN_FABRICATION } from './media-en-fabrication.js';

/**
 * LES MÉDIAS LIVRÉS PAR UNE DISCUSSION (décision du 20/10/2026).
 *
 * À la fin de toute discussion qui a fabriqué des images, des vidéos ou des
 * sons, la réponse finale les montre TOUS, versions comprises — l'utilisateur
 * choisit lui-même — dans un bloc sous la réponse, chacun téléchargeable, avec
 * un « Tout télécharger ». Un média se rattache à la réponse qui CLÔT le tour
 * pendant lequel il a été livré : la première réponse rendue après lui.
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
 * CHAQUE MÉDIA SOUS LA RÉPONSE QUI CLÔT SON TOUR : la première réponse rendue
 * à son heure ou après. Un média livré après la dernière réponse (le tour
 * travaille encore) n'est encore sous aucune : le bloc de fabrication le montre.
 */
export function repartirLesMediasLivres<T extends Pick<MediaLivre, 'livreLe' | 'groupe' | 'version'>>(
  medias: readonly T[],
  reponses: readonly { cle: string; at: number }[],
): Map<string, T[]> {
  const triees = [...reponses].sort((a, b) => a.at - b.at);
  const parReponse = new Map<string, T[]>();
  for (const m of medias) {
    const cible = triees.find((r) => r.at >= m.livreLe);
    if (!cible) continue;
    parReponse.set(cible.cle, [...(parReponse.get(cible.cle) ?? []), m]);
  }
  for (const [cle, liste] of parReponse) parReponse.set(cle, mediasLivres(liste));
  return parReponse;
}
