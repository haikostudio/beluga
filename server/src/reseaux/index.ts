import type { ReseauSocial } from '@beluga/shared';
import type { Adaptateur } from './commun.js';
import { facebook, instagram } from './meta.js';
import { threads } from './threads.js';
import { linkedin } from './linkedin.js';
import { ficheGoogle, youtube } from './google.js';
import { tiktok } from './tiktok.js';
import { x } from './x.js';
import { pinterest } from './pinterest.js';

export * from './commun.js';

/** UN ADAPTATEUR PAR RÉSEAU reliable (`RESEAUX_SOCIAUX`). */
const ADAPTATEURS: Record<ReseauSocial, Adaptateur> = {
  facebook,
  instagram,
  threads,
  linkedin,
  youtube,
  'google-business': ficheGoogle,
  tiktok,
  x,
  pinterest,
};

/** Les essais remplacent un réseau par un faux, sans jamais toucher le vrai. */
const remplacants = new Map<ReseauSocial, Adaptateur>();

export function adaptateurDe(reseau: ReseauSocial): Adaptateur {
  return remplacants.get(reseau) ?? ADAPTATEURS[reseau];
}

/** POUR LES ESSAIS SEULEMENT : `null` rend le vrai adaptateur. */
export function remplacerAdaptateur(reseau: ReseauSocial, faux: Adaptateur | null): void {
  if (faux) remplacants.set(reseau, faux);
  else remplacants.delete(reseau);
}
