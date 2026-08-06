import type { ColumnKey } from './columns.js';

/**
 * Mettre en ligne compte DEUX étapes, toujours.
 *
 * Le nombre d'étapes dépendait d'un réglage : sans environnement de rôle « dev
 * chez le client », le tableau n'en connaissait qu'une, « À déployer » →
 * « Archivé ». Déployer archivait donc les cartes comme si l'instance de dev et
 * la production étaient une seule chose — et il fallait décrire des
 * environnements pour que le parcours dise la vérité.
 *
 * Les deux étapes existent désormais pour tout projet, sans rien à régler :
 *
 *  1. DÉPLOIEMENT — le lot de « À déployer » est fusionné, enregistré, envoyé
 *     sur le dépôt, puis l'instance de dev du projet est rafraîchie sur ce
 *     serveur. Les cartes se posent en « En production ». Rien n'est clos : on
 *     peut encore reprendre, corriger, redéployer.
 *  2. MISE EN PRODUCTION — le lot d'« En production » part chez le client.
 *     C'est elle, et elle seule, qui CLÔT les cartes : document de clôture,
 *     branche refermée, ligne d'historique, « Archivé ».
 *
 * La règle est PURE : elle ne connaît ni la base, ni le dépôt, ni le disque.
 * Elle dit seulement d'où chaque étape tire son lot, où elle le pose, et si
 * elle clôt.
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
   * seulement déployée sur l'instance de dev n'est pas finie — on peut encore
   * la reprendre, la corriger, la redéployer.
   */
  clot: boolean;
}

const ETAPE_DEV: EtapeDePublication = {
  cible: 'dev',
  libelle: 'Déploiement sur l’instance de dev',
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

/** Les étapes de mise en ligne, dans l'ordre du parcours. Toujours les deux. */
export function etapesDePublication(): EtapeDePublication[] {
  return [ETAPE_DEV, ETAPE_PRODUCTION];
}

/**
 * L'étape demandée, ou la PREMIÈRE du parcours quand on ne demande rien —
 * c'est ce que fait le bouton unique du bloc de publication.
 *
 * Les deux étapes existent toujours : il n'y a plus de cible impossible, donc
 * plus de refus à formuler.
 */
export function etapeDePublication(cible?: CiblePublication): EtapeDePublication {
  const etapes = etapesDePublication();
  if (!cible) return etapes[0];
  return etapes.find((etape) => etape.cible === cible) ?? etapes[0];
}

/**
 * L'étape dont le lot part de CETTE colonne, s'il y en a une.
 *
 * C'est ce que demande le bloc de publication posé en tête d'une colonne : il
 * ne sait pas à quelle étape il sert, il sait seulement d'où il est. Rendre
 * `null` reste une réponse à part entière — toute autre colonne que « À
 * déployer » et « En production » ne publie rien.
 */
export function etapeDeLaColonne(source: ColumnKey): EtapeDePublication | null {
  return etapesDePublication().find((etape) => etape.source === source) ?? null;
}

/**
 * Cette publication est-elle celle de CETTE étape ?
 *
 * Deux blocs de publication sont à l'écran en même temps ; la publication en
 * cours n'appartient qu'à l'un des deux, et l'autre ne doit afficher ni son
 * déroulé ni son compte rendu. Une publication d'AVANT les deux étapes ne porte
 * pas de cible : elle est celle du lot de « À déployer », le seul qui existait.
 */
export function runDeLEtape(cible: CiblePublication | undefined, etape: EtapeDePublication): boolean {
  if (!cible) return etape.source === 'to_deploy';
  return cible === etape.cible;
}
