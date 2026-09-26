/**
 * UNE CARTE ÉCARTÉE D'UNE PUBLICATION SE RÉPARE D'ELLE-MÊME — UNE FOIS.
 *
 * Constat (capture #fb73, 23.09.2026) : deux cartes attendaient ensemble dans
 * « À déployer » et touchaient toutes deux `server/src/runtime.ts`. La
 * première est passée, la seconde a été ÉCARTÉE — et elle restait là, le
 * volet disant seulement « conflit sur server/src/runtime.ts », sans rien
 * proposer. Le recollage en fin de tour (`refermerDossierDeCarte`) ne compare
 * qu'à la branche de travail : deux cartes EN ATTENTE ne se voient pas l'une
 * l'autre, le heurt ne pouvait donc naître qu'à la publication.
 *
 * DEC-255 tient toujours PENDANT le déroulé : aucun agent n'y est appelé, la
 * carte est écartée et nommée. La réparation vient APRÈS, sur la carte :
 *
 *   - la publication finie (et réussie), chaque carte écartée reçoit UN
 *     rattrapage `prevu`, écrit sur la tâche du lot — donc en base, pas dans
 *     une promesse en mémoire : il survit au redémarrage qui suit la
 *     publication de Beluga elle-même ;
 *   - il part APRÈS ce redémarrage (un agent lancé avant le retiendrait,
 *     DEC-166), et seulement si un compte a du quota ; sinon il attend
 *     (`attente-quota`) et repart seul ;
 *   - l'agent de la carte reçoit la demande de réconciliation : fusionner la
 *     branche d'accueil, résoudre en gardant les deux intentions, construire,
 *     tester. La carte repasse « En cours », puis revient « À déployer » par
 *     le parcours normal — elle ne se REPUBLIE PAS ;
 *   - UNE tentative par (publication, carte) : un heurt que l'agent ne sait
 *     pas résoudre ne relance pas à chaque publication. Le bouton
 *     « Réconcilier » du volet, geste humain, reste le secours.
 *
 * Ni base, ni disque, ni git : `server/src/test/rattrapage-ecartee.test.ts`.
 */

import {
  listeDeFichiers,
  natureDeLEtat,
  type EcartStructure,
  type EtatDuRattrapage,
  type RattrapageDeTache,
  type TacheDuLot,
} from './fusion-du-lot.js';

/** Au-delà, un rattrapage resté `prevu` ou `attente-quota` n'est plus repris seul. */
export const RATTRAPAGE_PERIME_MS = 7 * 24 * 60 * 60 * 1000;

/** Le texte de chaque état, pour la ligne de la tâche dans le volet. */
export const LIBELLE_RATTRAPAGE: Record<EtatDuRattrapage, string> = {
  prevu: 'réconciliation prévue après la publication',
  'attente-quota': 'réconciliation en attente de quota',
  lance: 'réconciliation en cours',
  revenu: 'réconciliée, revenue dans « À déployer »',
  echec: 'réconciliation sans succès',
  'sans-objet': 'réconciliation sans objet : la carte a bougé',
};

/** Une tâche du lot peut-elle être réconciliée ? Seule une carte ÉCARTÉE (pas une branche absente). */
export function tacheReconciliable(tache: Pick<TacheDuLot, 'etat'>): boolean {
  return tache.etat === 'ecartee';
}

/**
 * LE RATTRAPAGE AUTOMATIQUE À POSER en fin de publication réussie : toute
 * tâche écartée qui n'en porte pas encore. Le verrou « une fois par
 * publication et par carte » EST là : le rattrapage vit sur la tâche de CETTE
 * publication, et une tâche qui en porte un n'en reçoit jamais un second.
 */
export function rattrapagesAPoser(
  taches: readonly TacheDuLot[],
  at: number,
  apresRedemarrage: boolean,
): TacheDuLot[] {
  return taches.map((tache) =>
    tacheReconciliable(tache) && !tache.rattrapage
      ? {
          ...tache,
          rattrapage: {
            etat: 'prevu' as const,
            at,
            par: 'automatique' as const,
            ...(apresRedemarrage ? { apresRedemarrage: true } : {}),
          },
        }
      : tache,
  );
}

/** Poser un rattrapage sur UNE tâche, sans toucher aux autres. */
export function avecRattrapage(
  taches: readonly TacheDuLot[],
  cardId: string,
  rattrapage: RattrapageDeTache,
): TacheDuLot[] {
  return taches.map((tache) => (tache.cardId === cardId ? { ...tache, rattrapage } : tache));
}

/**
 * CE RATTRAPAGE PEUT-IL PARTIR SEUL, maintenant ? Oui s'il est `prevu` ou en
 * attente de quota, pas périmé, et — quand la publication a demandé un
 * redémarrage du démon — seulement une fois ce redémarrage passé : le démon
 * doit avoir démarré APRÈS la pose du rattrapage.
 */
export function rattrapageAPartir(
  rattrapage: RattrapageDeTache | undefined,
  contexte: { maintenant: number; demonDemarreA: number; redemarrageEnAttente: boolean },
): boolean {
  if (!rattrapage) return false;
  if (rattrapage.etat !== 'prevu' && rattrapage.etat !== 'attente-quota') return false;
  if (contexte.maintenant - rattrapage.at > RATTRAPAGE_PERIME_MS) return false;
  if (contexte.redemarrageEnAttente) return false;
  if (rattrapage.apresRedemarrage && contexte.demonDemarreA < rattrapage.at) return false;
  return true;
}

/**
 * LE BOUTON « RÉCONCILIER » S'AFFICHE-T-IL ? Sur une tâche écartée dont le
 * rattrapage n'a pas encore travaillé, a échoué ou attend — jamais pendant
 * qu'un agent réconcilie, ni une fois la carte revenue.
 */
export function reconciliationALaMain(tache: Pick<TacheDuLot, 'etat' | 'rattrapage'>, colonneDeLaCarte?: string): boolean {
  if (!tacheReconciliable(tache)) return false;
  if (colonneDeLaCarte && colonneDeLaCarte !== 'to_deploy') return false;
  const etat = tache.rattrapage?.etat;
  return !etat || etat === 'prevu' || etat === 'attente-quota' || etat === 'echec';
}

/**
 * L'ÉTAT À AFFICHER, corrigé par la colonne réelle de la carte : un
 * rattrapage `lance` dont la carte est revenue dans « À déployer » APRÈS son
 * départ est revenu, même si la fin du tour n'a pas pu l'écrire (redémarrage).
 */
export function etatAfficheDuRattrapage(
  rattrapage: RattrapageDeTache | undefined,
  carte?: { column?: string; doneAt?: number },
): EtatDuRattrapage | undefined {
  if (!rattrapage) return undefined;
  if (rattrapage.etat === 'lance' && carte?.column === 'to_deploy' && (carte.doneAt ?? 0) > rattrapage.at) return 'revenu';
  if (rattrapage.etat === 'attente-quota' && carte?.column === 'running') return 'lance';
  return rattrapage.etat;
}

/** L'ISSUE D'UN TOUR DE RÉCONCILIATION, lue sur la colonne où il laisse la carte. */
export function issueDuRattrapage(colonne: string | undefined, ok: boolean): { etat: EtatDuRattrapage; detail?: string } {
  if (colonne === 'to_deploy') return { etat: 'revenu' };
  if (!ok) return { etat: 'echec', detail: 'le tour de l’agent s’est arrêté avant la fin' };
  return { etat: 'echec', detail: `la carte n’est pas revenue dans « À déployer »${colonne ? ` (elle est en « ${colonne} »)` : ''}` };
}

export interface DemandeDeReconciliation {
  /** La branche de la carte écartée (« tache/… »). */
  branche: string;
  /** La branche d'accueil de la publication (« dev »). */
  brancheDAccueil: string;
  ecart?: EcartStructure;
  /** La raison écrite sur la tâche, quand le détail structuré manque (publication d'avant). */
  raison?: string;
}

/**
 * LA DEMANDE ENVOYÉE À L'AGENT DE LA CARTE. Elle nomme la branche à fusionner,
 * les fichiers en heurt, chaque carte adverse AVEC son enregistrement — pour
 * que l'agent lise ce que l'autre a voulu avant d'y toucher — et exige
 * construction et tests : une résolution ne garde jamais un appel sans sa
 * définition (MEM-3190).
 */
export function demandeDeReconciliation(d: DemandeDeReconciliation): string {
  const fichiers = d.ecart?.fichiers?.length ? listeDeFichiers(d.ecart.fichiers) : '';
  const contre = (d.ecart?.contre ?? []).map(
    (c) =>
      `- « ${c.titre} »${c.branche ? ` (branche ${c.branche}` : ''}${c.commit ? `${c.branche ? ', ' : ' ('}enregistrement ${c.commit.slice(0, 10)}` : ''}${c.branche || c.commit ? ')' : ''} sur ${listeDeFichiers(c.fichiers)}`,
  );
  const lignes: (string | null)[] = [
    'RÉCONCILIATION APRÈS ÉCARTEMENT — cette carte a été écartée de la dernière publication : sa branche heurtait ce qui venait d’être mis en ligne.',
    '',
    `Ta branche : ${d.branche}. Branche publiée : ${d.brancheDAccueil}.`,
    fichiers ? `Fichiers en heurt : ${fichiers}.` : d.raison ? `Raison de l’écartement : ${d.raison}.` : null,
    contre.length ? 'Cartes du lot passées avant toi sur ces fichiers :' : null,
    ...contre,
    '',
    'À faire, dans ta copie de travail :',
    `1. Fusionne « ${d.brancheDAccueil} » dans ta branche (git fetch si besoin, puis git merge ${d.brancheDAccueil}).`,
    '2. Résous chaque heurt en GARDANT LES DEUX INTENTIONS : lis d’abord ce que la carte adverse a changé (git show de son enregistrement), ne supprime rien de son travail, et ne garde aucun appel sans sa définition.',
    '3. Construis (npm run build) puis lance les tests (npm test) ; corrige ce qui casse.',
    '4. Enregistre la fusion et pousse ta branche. Ne publie pas : la carte revient dans « À déployer » et attend la prochaine mise en ligne.',
    '',
    'Si le heurt ne peut pas se résoudre sans trancher entre les deux intentions, arrête-toi et dis-le clairement dans ton compte rendu.',
  ];
  return lignes.filter((ligne): ligne is string => ligne !== null).join('\n');
}

/** Les tâches d'une publication dont le rattrapage peut partir seul. */
export function tachesARattraper(
  taches: readonly TacheDuLot[] | undefined,
  contexte: { maintenant: number; demonDemarreA: number; redemarrageEnAttente: boolean },
): TacheDuLot[] {
  return (taches ?? []).filter(
    (tache) => natureDeLEtat(tache.etat) === 'ecart' && tacheReconciliable(tache) && rattrapageAPartir(tache.rattrapage, contexte),
  );
}
