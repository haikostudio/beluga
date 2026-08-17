/*
 * LES CARTES MISES EN LIGNE ENSEMBLE RESTENT ENSEMBLE.
 *
 * Une publication embarque un LOT : cinq cartes fusionnées, envoyées,
 * construites et installées d'un seul geste. Arrivées dans « En production »,
 * ces cinq cartes se dispersaient dans une liste triée par date — rien ne disait
 * plus qu'elles étaient parties du même coup, ni par quel déploiement, ni quand.
 * L'historique de ce déploiement existait pourtant, rangé avec la publication :
 * il n'y avait simplement aucun chemin depuis les cartes pour y revenir.
 *
 * La colonne range donc ses cartes par GROUPE : un groupe = une publication.
 * Chaque groupe porte son titre, son heure, son issue, et de quoi rouvrir le
 * fil complet de ce qui s'est passé ce jour-là.
 *
 * TROIS RÈGLES.
 *
 *  1. UNE CARTE APPARTIENT À LA PUBLICATION LA PLUS RÉCENTE QUI L'A EMBARQUÉE.
 *     Une carte redéployée après correction se range sous son DERNIER passage :
 *     c'est celui qui dit ce qui est en ligne.
 *  2. CE QUI N'EST RATTACHÉ À RIEN SE DIT. Une carte posée là à la main, ou
 *     déployée avant que les publications ne soient conservées, forme un groupe
 *     SANS publication — jamais rangée d'office sous la dernière, ce qui
 *     raconterait une histoire fausse.
 *  3. L'ORDRE DES CARTES NE CHANGE PAS À L'INTÉRIEUR D'UN GROUPE : le tableau
 *     les a déjà triées (la plus récente d'abord), on ne fait que les répartir.
 *
 * Règles PURES : ni base, ni requête. On leur donne les cartes de la colonne et
 * les publications connues, elles rendent des groupes.
 */

import type { DeployRun } from './models.js';
import { titreDeLaPublication } from './journal-publication.js';
import { etapeDePublication } from './etapes-publication.js';

/** Un paquet de cartes parties en ligne ensemble. */
export type GroupeDeProduction<C extends { id: string }> = {
  /**
   * La publication qui a embarqué ces cartes. `null` quand aucune ne les
   * revendique : le groupe le DIT au lieu d'en inventer une.
   */
  runId: string | null;
  /** « Déploiement du 17 août, 14:32 », ou la phrase du groupe sans publication. */
  titre: string;
  /** L'instant du départ, pour trier les groupes. 0 quand on ne sait pas. */
  at: number;
  /** L'issue de la publication, telle qu'elle est rangée. */
  etat?: DeployRun['state'];
  cartes: C[];
};

/** La phrase d'un groupe que plus aucune publication ne revendique. */
export const GROUPE_SANS_PUBLICATION = 'Mises en ligne sans déploiement retrouvé';

/**
 * QUELLE PUBLICATION A EMBARQUÉ CHAQUE CARTE.
 *
 * On lit les publications de la plus récente à la plus ancienne et on retient
 * la PREMIÈRE qui nomme la carte. Une publication ARRÊTÉE ou TOMBÉE n'a rien
 * mis en ligne : elle ne revendique aucune carte — sinon un échec du matin
 * s'attribuerait le lot que la reprise de l'après-midi a réellement déployé.
 */
export function publicationDeChaqueCarte(runs: DeployRun[]): Map<string, DeployRun> {
  const index = new Map<string, DeployRun>();
  const parDate = [...runs].sort((a, b) => b.startedAt - a.startedAt);
  for (const run of parDate) {
    if (run.state !== 'success') continue;
    for (const cardId of run.cardIds) if (!index.has(cardId)) index.set(cardId, run);
  }
  return index;
}

/**
 * LES CARTES D'UNE COLONNE, RANGÉES PAR PUBLICATION.
 *
 * Les groupes sortent du plus récent au plus ancien ; le groupe sans
 * publication passe en DERNIER, quelle que soit sa date — c'est un reliquat, pas
 * une mise en ligne.
 */
export function groupesDeProduction<C extends { id: string }>(
  cartes: C[],
  runs: DeployRun[],
): GroupeDeProduction<C>[] {
  if (!cartes.length) return [];
  const parCarte = publicationDeChaqueCarte(runs);
  const groupes = new Map<string, GroupeDeProduction<C>>();
  const orphelines: C[] = [];

  for (const carte of cartes) {
    const run = parCarte.get(carte.id);
    if (!run) {
      orphelines.push(carte);
      continue;
    }
    const existant = groupes.get(run.id);
    if (existant) {
      existant.cartes.push(carte);
      continue;
    }
    groupes.set(run.id, {
      runId: run.id,
      titre: titreDeLaPublication(etapeDePublication(run.cible).libelle, run.startedAt),
      at: run.startedAt,
      etat: run.state,
      cartes: [carte],
    });
  }

  const ranges = [...groupes.values()].sort((a, b) => b.at - a.at);
  if (orphelines.length) {
    ranges.push({ runId: null, titre: GROUPE_SANS_PUBLICATION, at: 0, cartes: orphelines });
  }
  return ranges;
}

/**
 * FAUT-IL MONTRER LES GROUPES ?
 *
 * Un seul groupe qui contient TOUTE la colonne n'apprend rien : le bandeau
 * répéterait le nom de la colonne au-dessus de la même liste. On ne groupe donc
 * qu'à partir de DEUX groupes — sauf si ce groupe unique a une publication à
 * ouvrir, car c'est alors le seul chemin vers son historique.
 */
export function grouperVautLaPeine<C extends { id: string }>(groupes: GroupeDeProduction<C>[]): boolean {
  if (groupes.length > 1) return true;
  return groupes.length === 1 && groupes[0].runId !== null;
}

/** « 3 tâches » / « 1 tâche » — le compte d'un groupe, dit en français. */
export function compteDuGroupe(nombre: number): string {
  return nombre > 1 ? `${nombre} tâches` : `${nombre} tâche`;
}

/**
 * LES CARTES D'UNE COLONNE, RÉORDONNÉES POUR QUE CHAQUE GROUPE SOIT D'UN SEUL
 * TENANT.
 *
 * La colonne pose ses cartes par paquets de vingt : un groupe éclaté entre deux
 * paquets afficherait deux fois le même bandeau, ou pire, un bandeau sans ses
 * cartes. On rend donc la liste à plat, groupe après groupe, dans l'ordre des
 * groupes — aucune carte n'est ajoutée ni retirée.
 */
export function cartesRangeesParGroupe<C extends { id: string }>(groupes: GroupeDeProduction<C>[]): C[] {
  return groupes.flatMap((groupe) => groupe.cartes);
}
