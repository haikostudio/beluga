import { MODELE_TTS_GEMINI } from './voix-gemini.js';

/**
 * GOOGLE GEMINI, SUIVI SEULEMENT.
 *
 * Gemini ne rend aucun quota avec une simple clé d'API, et l'essai d'agent a
 * raté : il n'a donc AUCUN compte. Le volet des quotas garde pourtant une ligne
 * qui dit l'état réel de la clé du coffre — sans interrupteur, sans priorité,
 * hors de tout choix de compte. Ce fichier porte ce qui ne demande ni réseau
 * ni base : l'identité de la ligne et la lecture de la réponse de Google.
 */

/** L'identifiant de la ligne : n'est celui d'aucun compte. */
export const ID_SUIVI_GEMINI = 'suivi-google-gemini';
/** Le moteur dont l'usage mesuré ici s'additionne (la fiche ajoutée, jamais activée). */
export const MOTEUR_SUIVI_GEMINI = 'ext-google-gemini';
export const LIBELLE_SUIVI_GEMINI = 'Google Gemini';

/** Compter les jetons d'un mot ne consomme aucun quota : c'est la sonde. */
export const URL_SONDE_GEMINI = `https://generativelanguage.googleapis.com/v1beta/models/${MODELE_TTS_GEMINI}:countTokens`;

export interface EtatDeCleGemini {
  /** La clé répond et le quota tient. */
  ok: boolean;
  /** Google a refusé faute de quota : la ligne s'affiche pleine. */
  quotaAtteint?: boolean;
  /** Ligne d'état, en français. */
  resume?: string;
  /** Une panne de la clé ou du réseau, jamais un manque de quota. */
  erreur?: string;
}

/**
 * Lire la réponse de la sonde. 429 = quota atteint ; 401/403 = clé refusée ;
 * 5xx = Google saturé pour le moment, ce qui ne dit RIEN de la clé (la voix
 * peut répondre pendant que le texte est en « forte demande »).
 */
export function etatDeCleGemini(statut: number): EtatDeCleGemini {
  if (statut >= 200 && statut < 300) return { ok: true, resume: 'Clé active chez Google · voix disponible' };
  if (statut === 429) return { ok: false, quotaAtteint: true, resume: 'Quota atteint chez Google' };
  if (statut === 401 || statut === 403) return { ok: false, erreur: 'clé refusée par Google' };
  if (statut >= 500) return { ok: true, resume: 'Google Gemini saturé pour le moment · clé non mise en cause' };
  return { ok: false, erreur: `Google a répondu ${statut}` };
}

/**
 * Le relevé arrive d'un seul tenant, mais une ligne de suivi n'est PAS un
 * compte : l'écran la garde à part, pour que ni les réglages des comptes ni les
 * listes « avec quel compte lancer ? » ne la voient jamais.
 */
export function separerLesSuivis<T extends { suivi?: boolean }>(releves: readonly T[]): { comptes: T[]; suivis: T[] } {
  return { comptes: releves.filter((r) => !r.suivi), suivis: releves.filter((r) => r.suivi) };
}
