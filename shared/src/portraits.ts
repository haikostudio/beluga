/**
 * LA RÉSERVE DE PORTRAITS DES AGENTS (carte « Beluga piloté par des agents », 26/11/2026).
 *
 * Une cinquantaine de visages tous différents, fabriqués par Codex (planches de 4 × 4 découpées, plus les portraits
 * nommés de l'équipe par défaut), servis par l'application dans `web/public/portraits/<id>.webp` (256 px). Chacun porte
 * la couleur de son fond : c'est la couleur par défaut de l'agent qui le reçoit (anneau, liaisons de la table, nom
 * dans la discussion). Ce fichier est RÉÉCRIT par `scripts/portraits/decouper-portraits.mjs` ; un visage écarté pour
 * doublon n'y entre pas.
 */
export interface PortraitDeLaReserve {
  id: string;
  /** La couleur dominante du fond, « #rrggbb ». */
  couleur: string;
}

export const PORTRAITS: readonly PortraitDeLaReserve[] = [
  { id: 'max', couleur: '#58738f' },
  { id: 'eliot', couleur: '#c28161' },
  { id: 'zoe', couleur: '#c7a046' },
  { id: 'lea', couleur: '#799b82' },
  { id: 'karim', couleur: '#4f6a8b' },
  { id: 'victor', couleur: '#ac5a4f' },
  { id: 'a01', couleur: '#577099' },
  { id: 'a02', couleur: '#b15b47' },
  { id: 'a03', couleur: '#d8a050' },
  { id: 'a04', couleur: '#7d9379' },
  { id: 'a05', couleur: '#bf7374' },
  { id: 'a06', couleur: '#4e8587' },
  { id: 'a07', couleur: '#7e465e' },
  { id: 'a09', couleur: '#747349' },
  { id: 'a10', couleur: '#934238' },
  { id: 'a11', couleur: '#6d727c' },
  { id: 'a12', couleur: '#9488a0' },
  { id: 'a13', couleur: '#cf9b52' },
  { id: 'a14', couleur: '#344f3d' },
  { id: 'a16', couleur: '#303b61' },
  { id: 'b01', couleur: '#5d8588' },
  { id: 'b02', couleur: '#958584' },
  { id: 'b03', couleur: '#b75f39' },
  { id: 'b04', couleur: '#65703f' },
  { id: 'b05', couleur: '#3f6578' },
  { id: 'b07', couleur: '#d39a4b' },
  { id: 'b08', couleur: '#38543c' },
  { id: 'b09', couleur: '#904634' },
  { id: 'b10', couleur: '#7c81a8' },
  { id: 'b11', couleur: '#a68d66' },
  { id: 'b12', couleur: '#aa4f5b' },
  { id: 'b13', couleur: '#c6aa94' },
  { id: 'b14', couleur: '#5c3448' },
  { id: 'b15', couleur: '#668c8e' },
  { id: 'c01', couleur: '#779abe' },
  { id: 'c02', couleur: '#b56657' },
  { id: 'c03', couleur: '#f7cd68' },
  { id: 'c04', couleur: '#859d7e' },
  { id: 'c05', couleur: '#934856' },
  { id: 'c06', couleur: '#53645e' },
  { id: 'c07', couleur: '#f09b68' },
  { id: 'c08', couleur: '#524f7d' },
  { id: 'c10', couleur: '#af494a' },
  { id: 'c11', couleur: '#97b3a1' },
  { id: 'c12', couleur: '#76523e' },
  { id: 'c14', couleur: '#97a89f' },
  { id: 'c15', couleur: '#f4904e' },
  { id: 'c16', couleur: '#454b61' },
  { id: 'd01', couleur: '#797667' },
  { id: 'd02', couleur: '#b56a66' },
  { id: 'd03', couleur: '#58787f' },
  { id: 'd04', couleur: '#db9954' },
  { id: 'd05', couleur: '#79627d' },
  { id: 'd09', couleur: '#7c3038' },
  { id: 'd10', couleur: '#878f80' },
  { id: 'd11', couleur: '#e7a244' },
  { id: 'd12', couleur: '#364563' },
  { id: 'd14', couleur: '#70805b' },
  { id: 'd15', couleur: '#706183' },
  { id: 'd16', couleur: '#d1a277' },
];

/** La couleur neutre d'un agent sans portrait connu. */
export const COULEUR_PAR_DEFAUT = '#8a8f98';

export function couleurDuPortrait(id: string | null | undefined): string {
  return PORTRAITS.find((p) => p.id === id)?.couleur ?? COULEUR_PAR_DEFAUT;
}

/** L'adresse de l'image d'un portrait (servie par l'application) ; un portrait téléversé garde son adresse à lui. */
export function adresseDuPortrait(id: string | null | undefined): string | null {
  if (!id) return null;
  if (/^(https?:|\/|data:)/.test(id)) return id;
  return PORTRAITS.some((p) => p.id === id) ? `/portraits/${id}.webp` : null;
}
