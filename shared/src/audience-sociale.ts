import type { ReseauSocial } from './reseaux-sociaux.js';

/**
 * LES CHIFFRES D'AUDIENCE DES RÉSEAUX — les règles pures, sans base ni réseau.
 *
 * Chaque jour, le démon relève chez les réseaux qui les ouvrent les compteurs
 * CUMULÉS de chaque publication (vues, commentaires, réactions) et les abonnés
 * du compte (`releverAudience`, `server/src/publication-sociale.ts`). Une période
 * se calcule ensuite par DIFFÉRENCE : ce qu'un compteur a gagné entre la veille de
 * la période et son dernier relevé. Une publication qui n'est plus suivie cesse de
 * changer : elle ne fait donc rien chuter.
 *
 * Un chiffre que le réseau n'a pas donné vaut `null`, jamais 0 : l'écran dit
 * qu'il manque au lieu d'afficher un faux zéro.
 */

export const PERIODES_AUDIENCE = [7, 30, 90] as const;
export type PeriodeAudience = (typeof PERIODES_AUDIENCE)[number];

export function estPeriodeAudience(n: unknown): n is PeriodeAudience {
  return (PERIODES_AUDIENCE as readonly unknown[]).includes(n);
}

/** Une ligne de relevé. `publication` vide : le compte lui-même, et seuls ses abonnés comptent. */
export interface ReleveAudience {
  compteId: string;
  publication: string;
  /** Le jour du relevé, « AAAA-MM-JJ ». */
  jour: string;
  abonnes: number | null;
  vues: number | null;
  commentaires: number | null;
  reactions: number | null;
}

export interface Croissance {
  /** L'écart en valeur avec la période d'avant. */
  ecart: number;
  /** L'écart en pourcentage ; `null` si la période d'avant valait 0 (rien à quoi comparer). */
  pourcent: number | null;
}

/** LA CROISSANCE, ou `null` quand l'une des deux valeurs manque. */
export function croissance(actuel: number | null, precedent: number | null): Croissance | null {
  if (actuel === null || precedent === null) return null;
  const ecart = actuel - precedent;
  return { ecart, pourcent: precedent > 0 ? Math.round((ecart / precedent) * 100) : null };
}

/** Le jour « AAAA-MM-JJ » décalé de `n` jours, sans dépendre du fuseau de la machine. */
export function jourDecale(jour: string, n: number): string {
  const d = new Date(`${jour}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

type Compteur = 'vues' | 'commentaires' | 'reactions';

/** Ce qu'un compteur cumulé a gagné entre deux jours (bornes comprises), `null` s'il n'a jamais été donné. */
function gain(lignes: readonly ReleveAudience[], compteur: Compteur, debut: string, fin: string): number | null {
  const series = new Map<string, ReleveAudience[]>();
  for (const l of lignes) {
    if (!l.publication || l[compteur] === null) continue;
    const cle = `${l.compteId}\n${l.publication}`;
    const serie = series.get(cle);
    if (serie) serie.push(l);
    else series.set(cle, [l]);
  }
  let total: number | null = null;
  for (const serie of series.values()) {
    let avant = 0;
    let dernier: number | null = null;
    for (const l of [...serie].sort((a, b) => a.jour.localeCompare(b.jour))) {
      if (l.jour < debut) avant = l[compteur] as number;
      else if (l.jour <= fin) dernier = l[compteur] as number;
    }
    if (dernier === null) continue;
    /* Un compteur corrigé à la baisse par le réseau (vues de robots retirées) ne compte pas en négatif. */
    total = (total ?? 0) + Math.max(0, dernier - avant);
  }
  return total;
}

/** Les abonnés au dernier relevé d'avant `fin`, tous comptes additionnés. */
function abonnesAu(lignes: readonly ReleveAudience[], fin: string): number | null {
  const parCompte = new Map<string, ReleveAudience>();
  for (const l of lignes) {
    if (l.publication || l.abonnes === null || l.jour > fin) continue;
    const connu = parCompte.get(l.compteId);
    if (!connu || l.jour > connu.jour) parCompte.set(l.compteId, l);
  }
  if (!parCompte.size) return null;
  return [...parCompte.values()].reduce((somme, l) => somme + (l.abonnes as number), 0);
}

export interface BilanDAudience {
  vues: number | null;
  commentaires: number | null;
  reactions: number | null;
  abonnes: number | null;
  croissanceVues: Croissance | null;
  croissanceCommentaires: Croissance | null;
  croissanceAbonnes: Croissance | null;
  /** Les vues gagnées chaque jour de la période, du plus ancien au plus récent. */
  serieVues: { jour: string; vues: number }[];
}

/** LE BILAN D'UNE PÉRIODE ET SA COMPARAISON À LA PÉRIODE D'AVANT, de même longueur. */
export function bilanDAudience(lignes: readonly ReleveAudience[], periode: number, aujourdhui: string): BilanDAudience {
  const debut = jourDecale(aujourdhui, -(periode - 1));
  const finAvant = jourDecale(debut, -1);
  const debutAvant = jourDecale(debut, -periode);
  const vues = gain(lignes, 'vues', debut, aujourdhui);
  const commentaires = gain(lignes, 'commentaires', debut, aujourdhui);
  const abonnes = abonnesAu(lignes, aujourdhui);
  const serieVues: { jour: string; vues: number }[] = [];
  for (let i = 0; i < periode; i += 1) {
    const jour = jourDecale(debut, i);
    serieVues.push({ jour, vues: gain(lignes, 'vues', jour, jour) ?? 0 });
  }
  return {
    vues,
    commentaires,
    reactions: gain(lignes, 'reactions', debut, aujourdhui),
    abonnes,
    croissanceVues: croissance(vues, gain(lignes, 'vues', debutAvant, finAvant)),
    croissanceCommentaires: croissance(commentaires, gain(lignes, 'commentaires', debutAvant, finAvant)),
    croissanceAbonnes: croissance(abonnes, abonnesAu(lignes, finAvant)),
    serieVues,
  };
}

/** Ce qui attend quelqu'un : les réponses et les validations. */
export interface EnAttenteSociale {
  messages: number;
  commentaires: number;
  contenus: number;
}

/** La tuile d'un compte relié. */
export interface TuileDeReseau {
  compteId: string;
  reseau: ReseauSocial;
  nom: string;
  /** Ce réseau ouvre-t-il ses chiffres ? Sinon l'écran le dit, sans zéro. */
  ouvert: boolean;
  /** Un premier relevé a-t-il eu lieu ? */
  releve: boolean;
  bilan: BilanDAudience;
}

export interface PublicationChiffree {
  contenuId: string;
  titre: string;
  reseau: ReseauSocial;
  url: string | null;
  publieLe: number | null;
  vues: number | null;
  commentaires: number | null;
  reactions: number | null;
}

/** La vue d'ensemble d'un projet, ou de tous quand on est à l'accueil du service. */
export interface VueDAudience {
  periode: number;
  attente: EnAttenteSociale;
  bilan: BilanDAudience;
  reseaux: TuileDeReseau[];
  publications: PublicationChiffree[];
  /** À l'accueil du service seulement : le résumé de chaque projet. */
  projets?: { projectId: string; nom: string; actif: boolean; comptes: number; attente: EnAttenteSociale; bilan: BilanDAudience }[];
}
