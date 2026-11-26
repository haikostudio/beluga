/**
 * LE PARCOURS D'AJOUT D'UN ORDINATEUR, TENU PAR BELUGA (carte « Agents des services et Beluga Connect », 26/11/2026).
 *
 * Constaté : le parcours « Ajouter ce Mac » ne vivait que dans l'écran. Un clic à côté de la fenêtre des réglages le
 * perdait, et « Lier cet ordinateur » relançait alors le téléchargement. Le démon le TIENT désormais par compte : quand il
 * a commencé, si le fichier est téléchargé, si Beluga Connect s'est lancé (il s'annonce avec le code de son
 * téléchargement), et l'ordinateur relié. La page le relit à chaque ouverture et reprend à son étape.
 *
 * DÉCISION DE L'UTILISATEUR (26/11/2026) : le lien se fait TOUJOURS par un code tapé dans Beluga Connect, sur Mac,
 * Windows et Linux. Le code du téléchargement ne relie plus rien : il ne sert qu'à reconnaître le parcours. Le code à
 * taper (six chiffres, dix minutes, « Nouveau code ») s'affiche dans les réglages.
 *
 * Règle pure : ni base, ni disque, ni réseau.
 */
import type { SystemeDOrdinateur } from './ordinateurs.js';

export interface ParcoursDAjout {
  /** Le clic « Lier » qui l'a ouvert. */
  debut: number;
  systeme: SystemeDOrdinateur;
  /** Le fichier de Beluga Connect a été téléchargé (ou la commande Linux copiée) : « Lier » ne le refait plus. */
  telechargeLe?: number;
  /** Beluga Connect s'est lancé et s'est annoncé avec le code de son téléchargement. */
  connectVuLe?: number;
  /** Le code tapé dans Beluga Connect a relié l'ordinateur. */
  relieLe?: number;
  ordinateurId?: string;
}

/** Un parcours oublié depuis plus d'un jour ne se reprend plus : « Lier » repart de zéro. */
export const DUREE_DU_PARCOURS_MS = 24 * 60 * 60_000;

/** Le code à taper dans Beluga Connect vit dix minutes ; « Nouveau code » en donne un autre. */
export const DUREE_DU_CODE_A_TAPER_MS = 10 * 60_000;

export type EtapeDAjout = 'telecharger' | 'lancer' | 'code' | 'relie';

/** Le parcours est-il encore à reprendre ? */
export function parcoursVivant(p: ParcoursDAjout | null | undefined, maintenant: number): p is ParcoursDAjout {
  return !!p && p.debut + DUREE_DU_PARCOURS_MS > maintenant;
}

/**
 * OÙ EN EST LE PARCOURS : à télécharger, à lancer (téléchargé, Connect pas encore vu), au code (Connect lancé : le code
 * se tape dans sa fenêtre), relié. Un parcours téléchargé n'est jamais renvoyé au téléchargement.
 */
export function etapeDAjout(p: ParcoursDAjout | null | undefined): EtapeDAjout {
  if (!p) return 'telecharger';
  if (p.relieLe) return 'relie';
  if (p.connectVuLe) return 'code';
  if (p.telechargeLe) return 'lancer';
  return 'telecharger';
}

/** « Lier cet ordinateur » relance-t-il le téléchargement ? Seulement sans parcours vivant déjà téléchargé. */
export function lierTelecharge(p: ParcoursDAjout | null | undefined, maintenant: number): boolean {
  return !(parcoursVivant(p, maintenant) && !!p.telechargeLe && !p.relieLe);
}

/** Un code lu dans un champ : six chiffres, espaces et tirets retirés. */
export function codeATaperLu(brut: unknown): string | null {
  const net = String(brut ?? '').replace(/[\s-]+/g, '');
  return /^\d{6}$/.test(net) ? net : null;
}
