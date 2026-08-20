/**
 * LE DÉPLOIEMENT AUTOMATIQUE, CÔTÉ SERVEUR.
 *
 * L'interrupteur de la colonne « Terminé » (`project.deploiementAutomatique`)
 * est ÉTEINT par défaut. Allumé, ce passage — joué par le filet de veille,
 * toutes les quinze secondes — pousse les cartes de « Terminé » dans « À
 * déployer » dès que plus rien ne travaille sur le projet, puis lance la mise
 * en ligne sans qu'on ait à cliquer sur « Publier maintenant ».
 *
 * La DÉCISION ne vit pas ici : elle est pure et testée
 * (`shared/src/deploiement-automatique.ts`). Ce fichier ne fait que lui
 * apporter ce qu'il lit dans la base, puis exécuter ce qu'elle a tranché.
 *
 * Pourquoi le filet plutôt que la fin de tour : une carte peut arriver dans
 * « Terminé » par la fin d'un tour, mais aussi par le balayage des cartes
 * oubliées, ou parce que le dernier agent a été arrêté à la main. Un seul point
 * de passage, régulier, les couvre tous — et il repasse tant que le lot n'est
 * pas parti, ce qui rattrape une publication refusée pour cause de file
 * d'attente.
 */

import {
  decisionDeDeploiementAutomatique,
  demarrageAutomatiqueAutorise,
  procedureEnPlace,
  type Card,
  type Project,
} from '@haikodev/shared';
import { agentsOccupes, startDeploy } from './deploy.js';
import { carteAttendUneDecision, rangerLaCarte } from './deplacement-carte.js';
import { bus } from './bus.js';
import { log } from './logger.js';
import * as store from './store.js';

/**
 * Un seul passage à la fois. Le filet est synchrone, ce passage ne l'est pas :
 * sans ce verrou, deux tours de quinze secondes pourraient lancer DEUX
 * publications pour le même projet pendant que la première démarre encore.
 */
let enCours = false;

/**
 * Les cartes de « Terminé » réellement prêtes à partir — celles qui ne
 * portent ni question sans réponse ni sous-tâche non faite. Une carte qui
 * attend encore l'utilisateur n'est pas un travail abouti : elle ne doit
 * jamais être comptée pour le lot, ni y être poussée.
 */
function cartesDeployables(project: Project): { pretes: Card[]; retenues: Card[] } {
  const terminees = store.listCardsInColumn(project.id, 'done');
  const agents = store.listAgents(project.id);
  const decisions = store.decisionsEnAttente();
  const pretes: Card[] = [];
  const retenues: Card[] = [];
  for (const card of terminees) {
    (carteAttendUneDecision(card, agents, decisions) ? retenues : pretes).push(card);
  }
  return { pretes, retenues };
}

/**
 * L'état d'un projet, lu dans la base et donné tel quel à la règle pure.
 */
function etatDuProjet(project: Project) {
  const { pretes, retenues } = cartesDeployables(project);
  const maintenant = Date.now();
  return {
    actif: project.deploiementAutomatique === true,
    cartesTerminees: pretes.length,
    cartesEnAttenteDeDecision: retenues.length,
    cartesEnCours: store.listCardsInColumn(project.id, 'running').length,
    /*
     * Une carte de « Planifié » qui repartirait d'elle-même au prochain tour de
     * l'ordonnanceur (heure venue, « dès que possible », reprise après refus de
     * quota) : le calme est trompeur, on ne publie pas dans ce trou-là.
     */
    cartesQuiVontPartir: store
      .listCardsInColumn(project.id, 'planned')
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
      if (!decision.partir) continue;

      await envoyerLeLot(project, decision.raison);
    }
  } catch (err) {
    log.error('passage du déploiement automatique', err);
  } finally {
    enCours = false;
  }
}

/**
 * POUSSER le lot dans « À déployer », PUIS lancer la mise en ligne.
 *
 * Les deux gestes sont exactement ceux de l'utilisateur : « Tout déployer »
 * (déplacement de colonne, aucune mise en ligne) puis « Publier maintenant ».
 * On rejoue donc `rangerLaCarte` et `startDeploy`, sans chemin parallèle — les
 * dates posées avec la colonne (`deployedAt` périmée) et tous les refus de
 * `startDeploy` valent ici comme au clic.
 */
async function envoyerLeLot(project: Project, raison: string): Promise<void> {
  const { pretes, retenues } = cartesDeployables(project);
  for (const card of pretes) {
    bus.emit({ type: 'card.upsert', card: rangerLaCarte(card, 'to_deploy') });
  }
  log.info(
    `déploiement automatique de « ${project.name} » : ${pretes.length} carte(s) poussée(s) dans « À déployer » (${raison})`,
  );
  if (retenues.length > 0) {
    log.info(
      `déploiement automatique de « ${project.name} » : ${retenues.length} carte(s) retenue(s) dans « Terminé », en attente d'une décision de l'utilisateur`,
    );
  }

  const resultat = await startDeploy(project.id, { cible: 'dev' });
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
