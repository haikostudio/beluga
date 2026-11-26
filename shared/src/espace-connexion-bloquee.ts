/**
 * L'ESPACE CLIENT QUI N'ARRIVE PAS À SE RELIER — les règles pures.
 *
 * Carte « Accès client FishFlow bloqué » (26/11/2026) : un client restait sur
 * « Connexion à votre espace… » sans limite ni bouton. Son navigateur ne
 * faisait même plus partir la liaison (aucune requête `/ws` arrivée au relais
 * ni au démon), et un rechargement n'y changeait rien. Le serveur, lui, allait
 * bien : rien à réparer chez nous, tout à rendre visible chez le client.
 *
 * Trois règles vivent ici :
 *  1. le REPLI entre deux tentatives : croissant et plafonné — l'ancien délai
 *     fixe d'1,5 s martelait un démon déjà à la peine ;
 *  2. le délai au-delà duquel l'écran dit que la connexion N'ABOUTIT PAS
 *     (30 s, décision de l'utilisateur), avec « Réessayer » et « Me déconnecter » ;
 *  3. le SIGNALEMENT envoyé au démon par HTTP (le canal étant mort) : borné, et
 *     une seule alerte par compte et par heure côté serveur.
 *
 * Le plafond d'OUVERTURE d'une tentative reste `DELAI_OUVERTURE_DU_CANAL`
 * (`panne-serveur.ts`), déjà éprouvé sur l'administration.
 */

/** Sans liaison depuis ce délai, l'écran le dit et propose deux gestes. */
export const DELAI_AVANT_CONNEXION_BLOQUEE = 30_000;

/** Le premier repli après une coupure, puis son plafond. */
export const REPLI_INITIAL_DU_CANAL = 1_500;
export const REPLI_MAXIMAL_DU_CANAL = 15_000;

/** Entre deux alertes de blocage d'un même compte. */
export const ESPACEMENT_DES_ALERTES_DE_BLOCAGE = 60 * 60 * 1000;

/** La route du signalement, sur l'hôte de l'espace client. */
export const ROUTE_SIGNALEMENT_DE_BLOCAGE = '/api/espace/blocage';

/**
 * Le délai avant la tentative suivante, pour la `tentative`-ième coupure
 * d'affilée (0 : la première). 1,5 s, 3 s, 6 s, 12 s, puis 15 s.
 */
export function repliDuCanal(tentative: number): number {
  const n = Number.isFinite(tentative) && tentative > 0 ? Math.floor(tentative) : 0;
  return Math.min(REPLI_MAXIMAL_DU_CANAL, REPLI_INITIAL_DU_CANAL * 2 ** Math.min(n, 10));
}

/**
 * Combien de temps encore avant de déclarer la connexion bloquée ; 0 : c'est
 * l'heure ; `null` : la liaison est là, rien ne se compte.
 */
export function resteAvantConnexionBloquee(sansLiaisonDepuis: number | null | undefined, maintenant: number): number | null {
  if (sansLiaisonDepuis == null) return null;
  return Math.max(0, DELAI_AVANT_CONNEXION_BLOQUEE - (maintenant - sansLiaisonDepuis));
}

/** Une nouvelle alerte de blocage peut-elle partir pour ce compte ? */
export function alerteDeBlocageAutorisee(derniereAlerte: number | null | undefined, maintenant: number): boolean {
  if (derniereAlerte == null) return true;
  return maintenant - derniereAlerte >= ESPACEMENT_DES_ALERTES_DE_BLOCAGE;
}

/** Où le blocage a été vu : avant la première liaison, ou en cours de session. */
export type EtapeDuBlocage = 'connexion' | 'session';

export interface SignalementDeBlocage {
  etape: EtapeDuBlocage;
  dureeMs: number;
  userAgent: string;
}

/** Le corps reçu par la route : tout ce qui ne colle pas est refusé, jamais rangé à moitié. */
export function signalementDeBlocageValide(brut: unknown): SignalementDeBlocage | null {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return null;
  const b = brut as Record<string, unknown>;
  if (b.etape !== 'connexion' && b.etape !== 'session') return null;
  const duree = typeof b.dureeMs === 'number' && Number.isFinite(b.dureeMs) ? Math.round(b.dureeMs) : NaN;
  if (!(duree >= 0 && duree <= 24 * 60 * 60 * 1000)) return null;
  const userAgent = typeof b.userAgent === 'string' ? b.userAgent.slice(0, 300) : '';
  return { etape: b.etape, dureeMs: duree, userAgent };
}
