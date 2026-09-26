/**
 * LE DÉPLOIEMENT AUTOMATIQUE, CÔTÉ SERVEUR.
 *
 * L'interrupteur, posé à droite de l'entête d'« À déployer »
 * (`project.deploiementAutomatique`), est ÉTEINT par défaut. Allumé, il ne
 * commande plus qu'UNE chose : le DÉPART du lot déjà posé dans « À déployer »,
 * dès que plus rien ne travaille sur le projet, sans qu'on ait à cliquer sur
 * « Publier maintenant ».
 *
 * IL NE POUSSE PLUS AUCUNE CARTE. Le passage « Terminée » → « À déployer »
 * qu'il commandait n'a plus d'objet depuis le retrait de la colonne
 * « Rapport » : un travail rendu tombe DIRECTEMENT dans « À déployer »
 * (`COLONNE_DE_FIN_DE_TOUR`, `shared/src/suivi-colonne.ts`).
 *
 * ÉTEINT, RIEN NE PART : le lot attend le bouton « Publier maintenant ».
 *
 * La DÉCISION ne vit pas ici : elle est pure et testée
 * (`shared/src/deploiement-automatique.ts`). Ce fichier ne fait que lui
 * apporter ce qu'il lit dans la base, puis exécuter ce qu'elle a tranché.
 *
 * Pourquoi le filet plutôt que la fin de tour : une carte peut arriver dans
 * « À déployer » par la fin d'un tour, mais aussi par le balayage des cartes
 * oubliées, ou parce que le dernier agent a été arrêté à la main. Un seul point
 * de passage, régulier, les couvre tous — et il repasse tant que le lot n'est
 * pas parti, ce qui rattrape une publication refusée pour cause de file
 * d'attente.
 */

import {
  decisionDeDeploiementAutomatique,
  lotDuDeploiementAutomatique,
  echecsConsecutifsDePublication,
  COLONNES_AVANT_LE_TRAVAIL,
  cadrageRouvertApresRapport,
  demarrageAutomatiqueAutorise,
  procedureEnPlace,
  type Card,
  type Project,
} from '@beluga/shared';
import { bus } from './bus.js';
import { agentsOccupes, deployableCards, startDeploy } from './deploy.js';
import { carteAttendUneDecision } from './deplacement-carte.js';
import { log } from './logger.js';
import * as store from './store.js';

/**
 * Un seul passage à la fois. Le filet est synchrone, ce passage ne l'est pas :
 * sans ce verrou, deux tours de quinze secondes pourraient lancer DEUX
 * publications pour le même projet pendant que la première démarre encore.
 */
let enCours = false;

/**
 * Les projets dont l'abandon a déjà été annoncé. Une publication réussie, ou un
 * départ à nouveau possible, les en sort.
 */
const abandonsDits = new Set<string>();

/**
 * Les cartes de « À déployer » réellement prêtes à partir — celles qui ne
 * portent ni question sans réponse ni sous-tâche non faite. Une carte qui
 * attend encore l'utilisateur n'est pas un travail abouti : elle ne doit
 * jamais être comptée pour le lot.
 *
 * UNE CARTE DONT LA DISCUSSION EST ROUVERTE EST RETENUE, ELLE AUSSI. Depuis
 * que « À déployer » est le point d'arrivée d'un travail rendu, un message
 * écrit sous le rapport rouvre le cadrage SANS déplacer la carte : publier le
 * lot pendant qu'on discute de ce même travail mettrait en ligne ce qui est
 * justement remis en question. Le bouton « Publier maintenant » reste ouvert :
 * seul le départ AUTOMATIQUE l'écarte.
 */
function cartesDeployables(project: Project): { pretes: Card[]; retenues: Card[] } {
  const enAttente = deployableCards(project.id, 'to_deploy');
  const agents = store.listAgents(project.id);
  const decisions = store.decisionsEnAttente();
  const pretes: Card[] = [];
  const retenues: Card[] = [];
  for (const card of enAttente) {
    const retenue = carteAttendUneDecision(card, agents, decisions) || cadrageRouvertApresRapport(card);
    (retenue ? retenues : pretes).push(card);
  }
  return { pretes, retenues };
}

/**
 * L'état d'un projet, lu dans la base et donné tel quel à la règle pure.
 */
function etatDuProjet(project: Project) {
  const { pretes, retenues } = cartesDeployables(project);
  const maintenant = Date.now();
  const echecs = echecsConsecutifsDePublication(store.recentDeploys(project.id, 10));
  return {
    actif: project.deploiementAutomatique === true,
    cartesADeployer: pretes.length,
    cartesEnAttenteDeDecision: retenues.length,
    cartesEnCours: store.listCardsInColumn(project.id, 'running').length,
    /*
     * Une carte de « Planifié » qui repartirait d'elle-même au prochain tour de
     * l'ordonnanceur (heure venue, « dès que possible », reprise après refus de
     * quota) : le calme est trompeur, on ne publie pas dans ce trou-là.
     */
    cartesQuiVontPartir: COLONNES_AVANT_LE_TRAVAIL.flatMap((colonne) => store.listCardsInColumn(project.id, colonne))
      .filter((card) => demarrageAutomatiqueAutorise(card.scheduling, maintenant)).length,
    agentsAuTravail: agentsOccupes(project.id).length,
    publicationEnCours: store.latestDeploy(project.id)?.state === 'running',
    procedureEnPlace: procedureEnPlace(project, 'dev'),
    /*
     * Le travail rendu le PLUS RÉCEMMENT du lot RÉELLEMENT déployable. Deux
     * cartes d'un même chantier finissent rarement à la même seconde : ce
     * repère laisse le lot se compléter au lieu de publier une fois par carte.
     */
    dernierTravailRenduA: pretes.reduce<number | undefined>(
      (dernier, card) => (card.doneAt && (!dernier || card.doneAt > dernier) ? card.doneAt : dernier),
      undefined,
    ),
    /*
     * Les échecs de suite, lus dans l'historique : c'est eux qui espacent puis
     * arrêtent les nouveaux essais. Une publication réussie les efface d'elle-même.
     */
    echecsConsecutifs: echecs.echecs,
    dernierEchecA: echecs.dernierEchecA,
  };
}

/**
 * UN PASSAGE sur tous les projets ouverts. Rien ne part sur un projet dont
 * l'interrupteur est éteint — c'est-à-dire, par défaut, sur aucun.
 */
export async function passageDuDeploiementAutomatique(): Promise<void> {
  if (enCours) return;
  enCours = true;
  try {
    for (const project of store.listProjects()) {
      // L'interrupteur d'abord, et sans rien lire d'autre : un projet éteint ne
      // doit rien coûter au filet, qui repasse toutes les quinze secondes.
      if (project.deploiementAutomatique !== true) continue;

      const decision = decisionDeDeploiementAutomatique(etatDuProjet(project), Date.now());
      if (!decision.partir) {
        /*
         * UN ABANDON SE DIT, ET UNE SEULE FOIS. Sans ce garde, le filet
         * répéterait la même ligne toutes les quinze secondes — exactement le
         * bruit qu'on cherche à supprimer.
         */
        if (decision.abandon && !abandonsDits.has(project.id)) {
          abandonsDits.add(project.id);
          log.warn(`déploiement automatique de « ${project.name} » : ${decision.raison}`);
          bus.toast(
            'error',
            `« ${project.name} » : ${decision.raison}.`,
          );
        }
        continue;
      }
      abandonsDits.delete(project.id);

      await envoyerLeLot(project, decision.raison);
    }
  } catch (err) {
    log.error('passage du déploiement automatique', err);
  } finally {
    enCours = false;
  }
}

/**
 * LANCER LA MISE EN LIGNE du lot déjà posé dans « À déployer ».
 *
 * Les cartes n'ont plus à être poussées : une carte rendue tombe désormais
 * directement dans « À déployer », il ne reste qu'à rejouer le geste de
 * l'utilisateur « Publier maintenant » (`startDeploy`), sans chemin parallèle.
 */
async function envoyerLeLot(project: Project, raison: string): Promise<void> {
  const { pretes, retenues } = cartesDeployables(project);
  log.info(
    `déploiement automatique de « ${project.name} » : ${pretes.length} carte(s) prête(s) (${raison})`,
  );
  if (retenues.length > 0) {
    log.info(
      `déploiement automatique de « ${project.name} » : ${retenues.length} carte(s) retenue(s) dans « À déployer », en attente d'une décision de l'utilisateur`,
    );
  }

  /* LA LISTE EST EXPLICITE : sans elle, la publication reprenait toute la
     colonne, cartes retenues comprises (`lotDuDeploiementAutomatique`). */
  const lot = lotDuDeploiementAutomatique(pretes);
  if (!lot) return;
  const resultat = await startDeploy(project.id, { cible: 'dev', selectedCardIds: lot });
  if (!resultat.ok) {
    /*
     * UN REFUS SE DIT, il ne se tait pas. Les cartes restent dans « À
     * déployer » : le prochain passage réessaiera, et l'utilisateur garde de
     * toute façon son bouton « Publier maintenant ».
     */
    log.warn(
      `déploiement automatique de « ${project.name} » refusé : ${resultat.error ?? 'raison inconnue'}`,
    );
  }
}
