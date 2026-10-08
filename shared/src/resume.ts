/**
 * LA PAGE « RÉSUMÉ » — les règles pures (demande du 06/10/2026).
 *
 * La page est découpée en RUBRIQUES, choisies dans une colonne qui lui est
 * propre (une liste déroulante sur téléphone) : ce ne sont PAS des vues
 * centrales (`vue-centrale.ts`), la colonne de gauche de l'application ne
 * bouge pas. UNE seule période vaut pour toutes les rubriques ; elle se remet
 * d'aplomb comme celle de l'accueil de la messagerie (`bornesDeLaPeriode`,
 * fuseau de référence, 366 jours au plus).
 *
 * Chaque rubrique a SA commande (`stats.resume`), demandée à l'ouverture de la
 * rubrique seulement : une rubrique qu'on ne regarde pas ne coûte rien au
 * démon.
 *
 * Les TABLEAUX de la page (`TableauDeDonnees`) trient et découpent en pages
 * côté navigateur, avec les règles ci-dessous : tri stable, valeurs absentes
 * toujours en fin de liste quel que soit le sens, page ramenée dans les bornes.
 *
 * Ce qui touche le COFFRE-FORT ne porte que des COMPTES (nombre de fiches par
 * projet et par type) : aucun champ de fiche ne quitte le démon.
 */
import { finDeJournee, minuitDe, nombreDeJours, UN_JOUR_MS } from './tableau-de-bord-messagerie.js';

/* ------------------------------------------------------------------ */
/* Rubriques                                                           */
/* ------------------------------------------------------------------ */

export const RUBRIQUES_DU_RESUME = [
  'ensemble',
  'taches',
  'memoire',
  'surveillance',
  'studio',
  'coffre',
  'backups',
  'statistiques',
  'messagerie',
  'marketing',
  'notes',
] as const;

export type RubriqueDuResume = (typeof RUBRIQUES_DU_RESUME)[number];

export const RUBRIQUE_PAR_DEFAUT: RubriqueDuResume = 'ensemble';

/** Une rubrique retenue (préférence, adresse) ramenée à une valeur connue. */
export function rubriqueDuResume(valeur: unknown): RubriqueDuResume {
  return (RUBRIQUES_DU_RESUME as readonly unknown[]).includes(valeur) ? (valeur as RubriqueDuResume) : RUBRIQUE_PAR_DEFAUT;
}

/* ------------------------------------------------------------------ */
/* Tableaux : tri et pages                                             */
/* ------------------------------------------------------------------ */

export const TAILLES_DE_PAGE = [10, 20, 50] as const;
export const TAILLE_DE_PAGE_PAR_DEFAUT = 20;

export type SensDuTri = 'asc' | 'desc';
export interface TriDuTableau {
  colonne: string;
  sens: SensDuTri;
}
export type ValeurTriable = number | string | null | undefined;

/**
 * Compare deux valeurs d'une même colonne. Les nombres se comparent comme des
 * nombres, les textes dans l'ordre alphabétique (accents et casse compris, et
 * « 10 » après « 9 »). Les valeurs ABSENTES ne se comparent pas ici : le tri
 * les range toujours en fin de liste, quel que soit le sens.
 */
export function comparerValeurs(a: number | string, b: number | string): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'fr', { numeric: true, sensitivity: 'base' });
}

function absente(valeur: ValeurTriable): valeur is null | undefined {
  return valeur === null || valeur === undefined || (typeof valeur === 'number' && Number.isNaN(valeur));
}

/**
 * LES LIGNES TRIÉES SUR UNE COLONNE. Tri STABLE (deux lignes égales gardent
 * l'ordre reçu, qui est celui du serveur) ; une valeur absente part TOUJOURS
 * en bas, sans quoi un tri descendant poserait les « — » en tête.
 */
export function trierLesLignes<L>(lignes: readonly L[], valeur: (ligne: L) => ValeurTriable, sens: SensDuTri): L[] {
  const signe = sens === 'asc' ? 1 : -1;
  return lignes
    .map((ligne, rang) => ({ ligne, rang, v: valeur(ligne) }))
    .sort((x, y) => {
      const ax = absente(x.v);
      const ay = absente(y.v);
      if (ax || ay) return ax === ay ? x.rang - y.rang : ax ? 1 : -1;
      return signe * comparerValeurs(x.v as number | string, y.v as number | string) || x.rang - y.rang;
    })
    .map((entree) => entree.ligne);
}

/**
 * LE CLIC SUR UN ENTÊTE : premier clic dans le sens naturel de la colonne
 * (décroissant pour un chiffre, croissant pour un texte), second clic dans
 * l'autre sens, troisième clic RETOUR à l'ordre du serveur.
 */
export function triSuivantDuTableau(tri: TriDuTableau | null, colonne: string, sensNaturel: SensDuTri): TriDuTableau | null {
  if (!tri || tri.colonne !== colonne) return { colonne, sens: sensNaturel };
  if (tri.sens === sensNaturel) return { colonne, sens: sensNaturel === 'asc' ? 'desc' : 'asc' };
  return null;
}

export interface PageDuTableau<L> {
  lignes: L[];
  /** La page affichée, à partir de 0, ramenée dans les bornes. */
  page: number;
  /** Le nombre de pages, au moins 1. */
  pages: number;
  total: number;
  /** Le rang (à partir de 1) de la première et de la dernière ligne montrées ; 0 et 0 sans ligne. */
  premier: number;
  dernier: number;
}

/** LA PAGE DEMANDÉE, ramenée dans les bornes : un tri ou une période plus courte ne laisse jamais une page vide. */
export function pageDuTableau<L>(lignes: readonly L[], page: number, taille: number): PageDuTableau<L> {
  const pas = Math.max(1, Math.round(taille) || TAILLE_DE_PAGE_PAR_DEFAUT);
  const total = lignes.length;
  const pages = Math.max(1, Math.ceil(total / pas));
  const rang = Math.min(pages - 1, Math.max(0, Math.round(page) || 0));
  const debut = rang * pas;
  const morceau = lignes.slice(debut, debut + pas);
  return {
    lignes: morceau,
    page: rang,
    pages,
    total,
    premier: morceau.length ? debut + 1 : 0,
    dernier: morceau.length ? debut + morceau.length : 0,
  };
}

/* ------------------------------------------------------------------ */
/* Pertinence de la mémoire                                            */
/* ------------------------------------------------------------------ */

/**
 * LA PART DE CE QUI A ÉTÉ TROUVÉ ET RÉELLEMENT SERVI : blocs rendus sur blocs
 * demandés, entre 0 et 1. `null` sans demande — un zéro dirait « rien n'a
 * servi » alors que rien n'a été cherché.
 */
export function partRendue(demandes: number, rendus: number): number | null {
  if (!(demandes > 0)) return null;
  return Math.max(0, Math.min(1, rendus / demandes));
}

/**
 * LE TAUX D'AIDE D'UNE COMPÉTENCE : les fois où elle a aidé, sur toutes les
 * fois où son effet a été jugé (aidé, inutile, contredit). `null` tant
 * qu'aucun jugement n'existe — « servie » seule ne dit rien de son effet.
 */
export function tauxDAide(compte: { aidee: number; inutile: number; contredite: number }): number | null {
  const juges = Math.max(0, compte.aidee) + Math.max(0, compte.inutile) + Math.max(0, compte.contredite);
  return juges > 0 ? Math.max(0, compte.aidee) / juges : null;
}

/* ------------------------------------------------------------------ */
/* Séries par jour et couverture                                       */
/* ------------------------------------------------------------------ */

/**
 * DES VALEURS RANGÉES PAR JOURNÉE, du plus ancien au plus récent, une case
 * par jour de la période (bornes incluses) dans le fuseau de référence.
 * Sans `valeur`, chaque point compte pour 1. Un point hors période est
 * ignoré, jamais tassé dans la première ou la dernière case.
 */
export function sommesParJour(points: readonly { at: number; valeur?: number }[], debut: number, fin: number): number[] {
  const depart = minuitDe(debut);
  const arrivee = finDeJournee(fin);
  const cases = new Array<number>(Math.max(1, nombreDeJours(depart, arrivee))).fill(0);
  for (const point of points) {
    if (!Number.isFinite(point.at) || point.at < depart || point.at > arrivee) continue;
    const rang = Math.round((minuitDe(point.at) - depart) / UN_JOUR_MS);
    if (rang < 0 || rang >= cases.length) continue;
    cases[rang] = (cases[rang] ?? 0) + (point.valeur ?? 1);
  }
  return cases;
}

/**
 * LA PÉRIODE EST-ELLE ENTIÈREMENT COUVERTE ? `depuis` est la plus ancienne
 * donnée que le démon garde pour la rubrique. Quand elle est postérieure au
 * début de la période, les jours d'avant ne sont pas « à zéro » : ils ne sont
 * pas connus, et l'écran doit le dire au lieu d'afficher des zéros.
 */
export function periodePartielle(debut: number, depuis: number | null | undefined): boolean {
  return typeof depuis === 'number' && Number.isFinite(depuis) && minuitDe(depuis) > minuitDe(debut);
}

/* ------------------------------------------------------------------ */
/* Ce que rend chaque rubrique                                         */
/* ------------------------------------------------------------------ */

export interface BaseDuResume {
  debut: number;
  fin: number;
  /** Le minuit de chaque jour de la période, du plus ancien au plus récent. */
  jours: number[];
  /** La plus ancienne donnée gardée pour la rubrique ; `null` sans aucune donnée. */
  depuis: number | null;
}

export interface ResumeEnsemble extends BaseDuResume {
  rubrique: 'ensemble';
  secondes: number;
  taches: number;
  tours: number;
  jetons: number;
  /** La note moyenne des tâches mesurées, de 0 à 100 ; `null` sans mesure. */
  note: number | null;
  parJour: { secondes: number[]; taches: number[] };
  projets: { projectId: string; nom: string | null; taches: number; tours: number; secondes: number; jetons: number }[];
}

export interface LigneDeTacheExecutee {
  cardId: string;
  titre: string | null;
  projet: string | null;
  /** Le dernier tour de la période. */
  at: number;
  tours: number;
  secondes: number;
  entree: number;
  sortie: number;
  jetons: number;
  moteur: string | null;
}

export interface ResumeTaches extends BaseDuResume {
  rubrique: 'taches';
  lignes: LigneDeTacheExecutee[];
}

export interface ResumeMemoire extends BaseDuResume {
  rubrique: 'memoire';
  unitesCreees: number;
  unitesActives: number;
  modifications: number;
  refus: number;
  appels: number;
  dureeMoyenneMs: number;
  blocsDemandes: number;
  blocsRendus: number;
  competencesCreees: number;
  competences: number;
  /** Le taux d'aide de TOUTES les compétences réunies (compteurs depuis leur création). */
  tauxDAide: number | null;
  parJour: { unites: number[]; modifications: number[]; refus: number[]; appels: number[]; competences: number[] };
  parType: { type: string; nombre: number }[];
  parPortee: { portee: string; nom: string | null; creees: number; actives: number }[];
  sujets: { sujet: string; appels: number; dureeMoyenneMs: number; demandes: number; rendus: number }[];
  fiches: {
    nom: string;
    creeeLe: number | null;
    servie: number;
    aidee: number;
    inutile: number;
    contredite: number;
    confiance: number | null;
    dernierService: number | null;
  }[];
}

export interface ResumeSurveillance extends BaseDuResume {
  rubrique: 'surveillance';
  sites: number;
  controles: number;
  pannes: number;
  dureeMoyenneMs: number;
  constatsOuverts: number;
  parJour: { controles: number[]; pannes: number[] };
  lignes: {
    id: string;
    nom: string;
    url: string;
    etat: string;
    wordpress: boolean;
    controles: number;
    pannes: number;
    dureeMoyenneMs: number;
    dernierePanne: number | null;
    constats: number;
  }[];
}

export interface ResumeStudio extends BaseDuResume {
  rubrique: 'studio';
  creations: number;
  exports: number;
  exportsEnEchec: number;
  /** En dollars, le montant réel facturé par les fournisseurs. */
  depense: number;
  medias: number;
  parJour: { creations: number[]; exports: number[] };
  lignes: { id: string; titre: string; projet: string | null; etat: string; exports: number; depense: number; creeLe: number; majLe: number }[];
}

export interface ResumeCoffre extends BaseDuResume {
  rubrique: 'coffre';
  fiches: number;
  creees: number;
  modifiees: number;
  archivees: number;
  parJour: { creees: number[]; modifiees: number[] };
  parProjet: { projet: string | null; nom: string | null; fiches: number; creees: number; modifiees: number; derniereModif: number | null }[];
  parType: { type: string; fiches: number; creees: number }[];
}

export interface ResumeBackups extends BaseDuResume {
  rubrique: 'backups';
  sites: number;
  prises: number;
  echecs: number;
  octets: number;
  parJour: { prises: number[]; echecs: number[] };
  sitesListe: { id: string; nom: string; projet: string | null; actif: boolean; prises: number; echecs: number; octets: number; dernierePrise: number | null }[];
  points: { id: string; site: string; debut: number; statut: string; octets: number; dureeMs: number | null; origine: string | null }[];
}

export interface ResumeStatistiques extends BaseDuResume {
  rubrique: 'statistiques';
  visites: number;
  visiteurs: number;
  pagesVues: number;
  objectifs: number;
  parJour: { visites: number[]; visiteurs: number[] };
  lignes: { id: string; nom: string; autonome: boolean; visites: number; visiteurs: number; pagesVues: number; objectifs: number }[];
}

export interface ResumeMessagerie extends BaseDuResume {
  rubrique: 'messagerie';
  demandesCreees: number;
  demandesOuvertes: number;
  demandesTerminees: number;
  messages: number;
  parJour: { demandes: number[]; messages: number[] };
  lignes: { id: string; titre: string; projet: string | null; colonne: string; creeeLe: number; derniereActivite: number; messages: number; archivee: boolean }[];
}

export interface ResumeMarketing extends BaseDuResume {
  rubrique: 'marketing';
  contenus: number;
  publies: number;
  actionsFaites: number;
  ventes: number;
  /** En centimes, toutes devises additionnées telles quelles. */
  montant: number;
  parJour: { contenus: number[]; actions: number[] };
  lignes: { projectId: string; nom: string | null; contenus: number; aValider: number; publies: number; actions: number; ventes: number; montant: number }[];
}

export interface ResumeNotes extends BaseDuResume {
  rubrique: 'notes';
  total: number;
  creees: number;
  modifiees: number;
  parJour: { creees: number[]; modifiees: number[] };
  lignes: { id: string; titre: string; projet: string | null; importance: string; echeance: number | null; creeLe: number; modifieLe: number }[];
}

export type ResumeDeRubrique =
  | ResumeEnsemble
  | ResumeTaches
  | ResumeMemoire
  | ResumeSurveillance
  | ResumeStudio
  | ResumeCoffre
  | ResumeBackups
  | ResumeStatistiques
  | ResumeMessagerie
  | ResumeMarketing
  | ResumeNotes;
