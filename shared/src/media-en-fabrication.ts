/**
 * LES MÉDIAS EN FABRICATION, DANS LE FIL (décision de l'utilisateur du
 * 19/10/2026) — règles PURES.
 *
 * Toute fabrication d'image, de vidéo ou de son — mode réalisation (outil
 * « realiser »), Studio, ou n'importe quel agent qui l'annonce (outil
 * « media_en_cours ») — pose un BLOC dans le fil de sa conversation dès son
 * départ : à la forme du média attendu, avec une lumière douce qui passe
 * lentement (pas un effet de verre), et quatre lignes : le sujet, le temps
 * écoulé, l'outil, le prix. Une fois le média prêt, l'aperçu remplace le
 * scintillement ; un échec se dit dans le bloc.
 *
 * Le démon tient la liste EN MÉMOIRE (`server/src/medias-en-fabrication.ts`) et
 * la diffuse entière à chaque changement (`medias.fabrication`) : elle est
 * courte (bornée ici), et un redémarrage la vide sans dommage — le média
 * terminé reste une pièce jointe ordinaire du fil.
 */

import { z } from 'zod';

export const GENRES_DE_MEDIA_EN_FABRICATION = ['image', 'video', 'son'] as const;
export type GenreDeMediaEnFabrication = (typeof GENRES_DE_MEDIA_EN_FABRICATION)[number];

export const ETATS_DE_MEDIA_EN_FABRICATION = ['en-cours', 'fini', 'echec'] as const;

export const MediaEnFabrication = z.object({
  id: z.string(),
  projectId: z.string(),
  /** La conversation où le bloc paraît : la carte d'abord, l'agent sinon. */
  cardId: z.string().optional(),
  agentId: z.string().optional(),
  /** Le sujet, en mots courants (« Plan 3 — la plage au lever du jour »). */
  sujet: z.string(),
  /** L'outil lisible : modèle et service (« Veo 3 · Google »). */
  outil: z.string(),
  /** Le prix annoncé en dollars ; `null` : le service ne le publie pas. Absent : inconnu. */
  prix: z.number().nullable().optional(),
  /** « 16:9 », « 9:16 », « 1:1 », « 4:5 »… : la forme du bloc. */
  format: z.string().optional(),
  genre: z.enum(GENRES_DE_MEDIA_EN_FABRICATION),
  debut: z.number(),
  fin: z.number().optional(),
  etat: z.enum(ETATS_DE_MEDIA_EN_FABRICATION),
  /** La pièce jointe du média fini : l'aperçu du bloc, et la clé du dédoublonnage. */
  attachmentId: z.string().optional(),
  /** La raison d'un échec, courte. */
  echec: z.string().optional(),
  /** La phrase de l'agent à la fin : ce qu'il a rendu et pourquoi (la ligne du média dans le fil). */
  legende: z.string().optional(),
  /**
   * QUI FERME LE BLOC. « agent » : annoncé par l'agent lui-même ; un tour qui se
   * termine sans l'avoir fermé le passe en échec (rien ne reste « en cours »
   * pour toujours). « service » : le démon suit la fabrication lui-même (mode
   * réalisation, Studio), qui peut durer au-delà du tour.
   */
  suivi: z.enum(['agent', 'service']).default('agent'),
});
export type MediaEnFabrication = z.infer<typeof MediaEnFabrication>;

/** Au-delà, les blocs terminés les plus anciens sortent de la liste. */
export const PLAFOND_DES_MEDIAS_EN_FABRICATION = 60;
/** Un bloc terminé reste dans la liste un jour, puis seule sa pièce jointe demeure. */
export const DUREE_DE_VIE_D_UN_BLOC_TERMINE_MS = 24 * 60 * 60_000;
/** Un bloc « en cours » qu'aucune fin n'a fermé passe en échec après ce délai. */
export const DELAI_MAX_D_UNE_FABRICATION_MS = 45 * 60_000;

/** Le rapport largeur / hauteur du bloc : son format, ou la forme usuelle de son genre. */
export function ratioDuMedia(m: Pick<MediaEnFabrication, 'format' | 'genre'>): number {
  const lu = /^\s*(\d+(?:[.,]\d+)?)\s*[:x×/]\s*(\d+(?:[.,]\d+)?)\s*$/.exec(m.format ?? '');
  if (lu) {
    const l = Number(lu[1]!.replace(',', '.'));
    const h = Number(lu[2]!.replace(',', '.'));
    if (l > 0 && h > 0) return Math.min(4, Math.max(0.25, l / h));
  }
  if (m.genre === 'son') return 4;
  if (m.genre === 'video') return 16 / 9;
  return 1;
}

/** Le temps écoulé, « 0:07 », « 2:41 », « 1:03:12 ». */
export function tempsDeFabrication(debut: number, maintenant: number): string {
  const s = Math.max(0, Math.floor((maintenant - debut) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Le prix tel qu'il s'affiche : « 0,04 $ », « gratuit », « prix non publié » ; `null` si inconnu. */
export function prixDuMedia(prix: number | null | undefined): string | null {
  if (prix === undefined) return null;
  if (prix === null) return 'prix non publié';
  if (prix === 0) return 'gratuit';
  const arrondi = prix < 0.1 ? Math.round(prix * 1000) / 1000 : Math.round(prix * 100) / 100;
  return `${String(arrondi).replace('.', ',')} $`;
}

/**
 * LES BLOCS D'UNE CONVERSATION, dans l'ordre de leur départ : ceux de la carte
 * (n'importe quel agent qui y travaille), ou ceux de l'agent pour une
 * conversation sans carte. Seuls ceux partis DEPUIS la dernière demande
 * restent au bas du fil, plus ceux encore en cours : les médias plus anciens
 * sont déjà des pièces jointes du fil.
 */
export function mediasDeLaConversation(
  liste: readonly MediaEnFabrication[],
  ou: { cardId?: string | null; agentId?: string | null },
  depuis = 0,
): MediaEnFabrication[] {
  return liste
    .filter((m) => (ou.cardId ? m.cardId === ou.cardId : !!ou.agentId && !m.cardId && m.agentId === ou.agentId))
    .filter((m) => m.etat === 'en-cours' || m.debut >= depuis)
    .sort((a, b) => a.debut - b.debut);
}

/** Les pièces jointes déjà montrées par un bloc : le fil ne les redit pas. */
export function piecesMontreesParLesBlocs(blocs: readonly MediaEnFabrication[]): Set<string> {
  return new Set(blocs.filter((m) => m.etat === 'fini' && m.attachmentId).map((m) => m.attachmentId!));
}

/**
 * LE MÉNAGE : les blocs « en cours » trop vieux passent en échec, les blocs
 * terminés depuis plus d'un jour sortent, et la liste reste sous son plafond
 * (les plus anciens terminés d'abord ; un bloc en cours ne sort jamais).
 */
export function rangerLesMedias(liste: readonly MediaEnFabrication[], maintenant: number): MediaEnFabrication[] {
  const vivants = liste
    .map((m) =>
      m.etat === 'en-cours' && maintenant - m.debut > DELAI_MAX_D_UNE_FABRICATION_MS
        ? { ...m, etat: 'echec' as const, fin: maintenant, echec: m.echec ?? 'sans nouvelles de la fabrication' }
        : m,
    )
    .filter((m) => m.etat === 'en-cours' || maintenant - (m.fin ?? m.debut) <= DUREE_DE_VIE_D_UN_BLOC_TERMINE_MS)
    .sort((a, b) => a.debut - b.debut);
  let trop = vivants.length - PLAFOND_DES_MEDIAS_EN_FABRICATION;
  return vivants.filter((m) => {
    if (trop > 0 && m.etat !== 'en-cours') {
      trop--;
      return false;
    }
    return true;
  });
}

/**
 * LA FIN D'UN TOUR FERME LES BLOCS QUE SON AGENT AVAIT ANNONCÉS et laissés
 * ouverts : ils passent en échec. Ceux que le démon suit lui-même
 * (`suivi: 'service'`) continuent : leur fabrication dure au-delà du tour.
 */
export function fermerLesBlocsDuTour(liste: readonly MediaEnFabrication[], agentId: string, maintenant: number): MediaEnFabrication[] {
  return liste.map((m) =>
    m.agentId === agentId && m.etat === 'en-cours' && m.suivi !== 'service'
      ? { ...m, etat: 'echec' as const, fin: maintenant, echec: 'le tour s’est terminé sans que la fabrication soit annoncée finie' }
      : m,
  );
}
