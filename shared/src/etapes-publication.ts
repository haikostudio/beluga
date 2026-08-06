import type { ColumnKey } from './columns.js';

/**
 * Mettre en ligne peut demander DEUX étapes, pas une seule.
 *
 * Le tableau s'arrêtait à « À déployer » → « Archivé » : une carte publiée
 * disparaissait aussitôt du parcours, et rien ne distinguait « installé sur
 * l'environnement de dev du client », où l'on montre le travail, de « mis en
 * production », où il sert vraiment. La colonne « En production » se glisse
 * donc entre les deux.
 *
 * La règle est PURE : elle ne connaît ni la base, ni le dépôt, ni le disque.
 * Elle dit seulement, pour un projet donné, quelles étapes de mise en ligne
 * existent, d'où chacune tire les cartes de son lot et où elle les pose une
 * fois la mise en ligne réussie.
 *
 * Principe : le nombre d'étapes suit ce que le projet DÉCLARE, jamais une
 * envie. Un projet sans environnement de dev n'a qu'une mise en ligne — c'est
 * le cas de tous les projets aujourd'hui, et son parcours ne change pas d'un
 * pouce : « À déployer » → publication → « Archivé ». Dès qu'un environnement
 * de dev est déclaré, la publication se dédouble sans qu'aucune clé de colonne
 * ne bouge.
 */

/** Vers quoi une mise en ligne pousse le code. */
export type CiblePublication = 'dev' | 'production';

export interface EtapeDePublication {
  cible: CiblePublication;
  /** Le nom lisible de l'étape, tel qu'on l'annonce à l'écran. */
  libelle: string;
  /**
   * Le verbe du bouton de cette étape : « Tout déployer » en tête de « À
   * déployer », « Tout publier » en tête de « En production ». Il vit ici, avec
   * l'étape, pour que le bouton ne puisse pas dire autre chose que ce qu'il fait.
   */
  verbe: string;
  /** La colonne d'où viennent les cartes du lot. */
  source: ColumnKey;
  /** Où les cartes se posent quand la mise en ligne a réellement abouti. */
  arrivee: ColumnKey;
  /**
   * L'étape CLÔT-elle la carte ? Seule la dernière le fait : document de
   * clôture écrit, branche refermée, ligne ajoutée à l'historique. Une carte
   * seulement montée sur l'environnement de dev n'est pas finie — on peut
   * encore la reprendre, la corriger, la remonter.
   */
  clot: boolean;
}

/** Ce que le projet déclare de ses environnements. */
export interface MoyensDePublication {
  /**
   * Le projet dispose-t-il d'un environnement de dev distinct de sa
   * production ? Les réglages qui le renseignent vivent ailleurs : ici, on ne
   * fait qu'en tirer les conséquences.
   */
  environnementDev?: boolean;
}

const ETAPE_UNIQUE: EtapeDePublication = {
  cible: 'production',
  libelle: 'Mise en production',
  verbe: 'déployer',
  source: 'to_deploy',
  arrivee: 'archived',
  clot: true,
};

const ETAPE_DEV: EtapeDePublication = {
  cible: 'dev',
  libelle: 'Mise sur l’environnement de dev',
  verbe: 'déployer',
  source: 'to_deploy',
  arrivee: 'in_production',
  clot: false,
};

const ETAPE_PRODUCTION: EtapeDePublication = {
  cible: 'production',
  libelle: 'Mise en production',
  verbe: 'publier',
  source: 'in_production',
  arrivee: 'archived',
  clot: true,
};

/**
 * Les étapes de mise en ligne de ce projet, dans l'ordre du parcours.
 *
 * Sans environnement de dev déclaré : UNE étape, celle d'aujourd'hui. Les
 * tableaux déjà enregistrés restent donc lisibles et une carte posée dans
 * « À déployer » suit exactement le même chemin qu'avant.
 */
export function etapesDePublication(moyens: MoyensDePublication): EtapeDePublication[] {
  if (!moyens.environnementDev) return [ETAPE_UNIQUE];
  return [ETAPE_DEV, ETAPE_PRODUCTION];
}

/**
 * L'étape demandée, ou la PREMIÈRE du parcours quand on ne demande rien —
 * c'est ce que fait le bouton unique du bloc de publication.
 *
 * Rend `null` quand l'étape demandée n'existe pas pour ce projet : réclamer
 * une mise sur l'environnement de dev à un projet qui n'en a pas déclaré ne
 * doit pas retomber en silence sur la production.
 */
export function etapeDePublication(
  moyens: MoyensDePublication,
  cible?: CiblePublication,
): EtapeDePublication | null {
  const etapes = etapesDePublication(moyens);
  if (!cible) return etapes[0];
  return etapes.find((etape) => etape.cible === cible) ?? null;
}

/**
 * L'étape dont le lot part de CETTE colonne, s'il y en a une.
 *
 * C'est ce que demande le bloc de publication posé en tête d'une colonne : il
 * ne sait pas à quelle étape il sert, il sait seulement d'où il est. Rendre
 * `null` est une réponse à part entière — « En production » n'a pas d'étape
 * tant que le projet ne déclare pas d'environnement de dev, et le bloc ne
 * s'affiche alors pas du tout.
 */
export function etapeDeLaColonne(
  moyens: MoyensDePublication,
  source: ColumnKey,
): EtapeDePublication | null {
  return etapesDePublication(moyens).find((etape) => etape.source === source) ?? null;
}

/**
 * Cette publication est-elle celle de CETTE étape ?
 *
 * Deux blocs de publication peuvent être à l'écran en même temps ; la
 * publication en cours n'appartient qu'à l'un des deux, et l'autre ne doit
 * afficher ni son déroulé ni son compte rendu. Une publication d'AVANT les deux
 * étapes ne porte pas de cible : elle est celle du lot de « À déployer », le
 * seul qui existait.
 */
export function runDeLEtape(cible: CiblePublication | undefined, etape: EtapeDePublication): boolean {
  if (!cible) return etape.source === 'to_deploy';
  return cible === etape.cible;
}

/**
 * L'environnement proposé d'emblée par le bloc d'une étape.
 *
 * La règle générale ne bouge pas : sans choix, une publication vise le PREMIER
 * environnement de la liste. Mais le bloc de « En production » ferait alors
 * pointer « Tout publier » sur l'environnement de DEV, celui d'où le travail
 * vient justement de sortir. Pour cette étape-là seulement, on présélectionne
 * le premier environnement de rôle « production » ; à défaut, le premier de la
 * liste, comme partout ailleurs. Le menu reste modifiable : c'est une
 * proposition, pas une contrainte.
 */
export function environnementParDefaut<T extends { id: string; role: string }>(
  environnements: T[],
  etape?: EtapeDePublication | null,
): string {
  if (etape?.source === 'in_production') {
    const production = environnements.find((env) => env.role === 'production');
    if (production) return production.id;
  }
  return environnements[0]?.id ?? '';
}

/** Pourquoi une étape demandée n'existe pas, dit en toutes lettres. */
export function raisonEtapeInconnue(cible: CiblePublication): string {
  if (cible === 'dev') {
    return 'Ce projet n’a pas d’environnement de dev déclaré : il n’y a qu’une mise en ligne, celle de production.';
  }
  return 'Ce projet n’a pas d’étape de production distincte.';
}
