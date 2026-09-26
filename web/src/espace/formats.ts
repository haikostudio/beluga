/**
 * LES PETITS FORMATS DE L'ESPACE, à un seul endroit.
 *
 * Les dates, les heures et les tons de couleur étaient recopiés dans trois
 * fichiers : la même fonction, écrite trois fois, dérivait à la première
 * retouche. Ils vivent ici, et les écrans de l'espace les prennent d'ici.
 */
import type { ImportanceDemande } from '@beluga/shared';

/** L'heure d'un message, courte — « 14:03 », jamais « il y a … ». */
export function heureCourte(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** Une date entière : « 12 septembre 2026 ». */
export function jourDe(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Une date courte pour une vignette : « 12 sept. », pas l'année entière. */
export function jourCourt(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** Le ton d'une colonne, en jetons du thème — jamais une couleur écrite en dur. */
export const TON_COLONNE: Record<'neutre' | 'orange' | 'bleu' | 'vert', string> = {
  neutre: 'text-muted',
  orange: 'text-warning',
  bleu: 'text-info',
  vert: 'text-success',
};

/** Le ton d'une importance, en bordure et texte. */
export const TON_IMPORTANCE: Record<ImportanceDemande, string> = {
  basse: 'border-faint/60 text-faint',
  normale: 'border-faint/60 text-muted',
  haute: 'border-warning/50 text-warning',
  urgente: 'border-danger/50 text-danger',
};

/**
 * LE POINT D'IMPORTANCE D'UNE VIGNETTE. Un pastillage de couleur remplace le
 * gros badge en capitales : l'information reste — le FLAT DESIGN ne retire pas
 * un contraste qui portait une information — mais elle ne crie plus.
 */
export const POINT_IMPORTANCE: Record<ImportanceDemande, string> = {
  basse: 'bg-faint/50',
  normale: 'bg-muted/60',
  haute: 'bg-warning',
  urgente: 'bg-danger',
};
