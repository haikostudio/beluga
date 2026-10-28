import { CLE_SUIVIS_FERMES, suivisFermes, suivisFermesApres } from '@beluga/shared';
import { fermerLeDocument, ouvrirLeDocument } from './document-de-carte';
import { readPref, usePref, writePref } from './prefs';

/**
 * LE SUIVI D'UNE PRODUCTION S'OUVRE ET SE FERME, ET CHAQUE CARTE S'EN SOUVIENT
 * (28/10/2026, `shared/src/suivi-ferme.ts`) : sa croix et le bouton « Suivi »
 * écrivent le réglage du compte ; la page de la carte ne le rouvre d'elle-même
 * que si la carte n'y figure pas.
 */
export function useSuiviFerme(cardId: string | undefined): boolean {
  const [liste] = usePref<unknown>(CLE_SUIVIS_FERMES, []);
  return !!cardId && suivisFermes(liste).includes(cardId);
}

export function fermerLeSuivi(cardId: string): void {
  /* La valeur fraîche, pas celle du dernier rendu : deux cartes fermées d'affilée se gardent toutes les deux. */
  writePref(CLE_SUIVIS_FERMES, suivisFermesApres(readPref<unknown>(CLE_SUIVIS_FERMES, []), cardId, true));
  fermerLeDocument();
}

export function ouvrirLeSuivi(cardId: string): void {
  const avant = readPref<unknown>(CLE_SUIVIS_FERMES, []);
  if (suivisFermes(avant).includes(cardId)) writePref(CLE_SUIVIS_FERMES, suivisFermesApres(avant, cardId, false));
  ouvrirLeDocument({ cardId, genre: 'suivi', numero: 0 });
}
