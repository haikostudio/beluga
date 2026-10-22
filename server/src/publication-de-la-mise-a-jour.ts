/**
 * LE FILET QUI MET EN LIGNE LA SEULE TÂCHE DE MISE À JOUR DE BELUGA.
 *
 * Le clic « Mettre à jour » de la page « Mise à jour » des réglages pose et
 * lance une carte marquée (`card.miseAJourBeluga`, `installation-copie.ts`).
 * Rendue sans blocage dans « À déployer », elle est publiée SEULE
 * (`selectedCardIds = [carte]`), quel que soit l'interrupteur « déploiement
 * automatique » du projet : les autres cartes de la colonne attendent le clic
 * de l'utilisateur. La décision est pure et testée
 * (`shared/src/publication-de-la-mise-a-jour.ts`) ; ce fichier lui apporte ce
 * qu'il lit dans la base, puis exécute ce qu'elle a tranché.
 *
 * Même modèle que `deploiement-automatique.ts` : un point de passage régulier
 * (le tour de l'ordonnanceur), qui repasse tant que la carte n'est pas partie
 * et couvre toutes les façons d'arriver dans « À déployer ». Le redémarrage
 * qui suit la publication est retenu par l'existant tant qu'un agent ou une
 * publication tourne (DEC-164, DEC-166).
 */

import {
  cadrageRouvertApresRapport,
  doitPublierLaMiseAJour,
  echecsDeLaCarte,
  estLaTacheDeMiseAJour,
} from '@beluga/shared';
import { bus } from './bus.js';
import { agentsOccupes, deployableCards, publicationEnCours, startDeploy } from './deploy.js';
import { carteAttendUneDecision } from './deplacement-carte.js';
import { log } from './logger.js';
import * as store from './store.js';

let enCours = false;
/** Les cartes dont l'abandon a déjà été dit : une fois, pas toutes les quinze secondes. */
const abandonsDits = new Set<string>();

export async function passageDeLaPublicationDeLaMiseAJour(): Promise<void> {
  if (enCours) return;
  enCours = true;
  try {
    const projet = store.listProjects().find((p) => p.isSelf && !p.archived);
    /* L'INTERRUPTEUR ALLUMÉ, le déploiement automatique publie déjà tout le lot
       prêt, cette carte comprise : deux filets lanceraient deux publications. */
    if (!projet || projet.deploiementAutomatique === true) return;
    // Rien d'autre n'est lu tant qu'aucune tâche de mise à jour n'attend : le filet repasse souvent.
    const carte = deployableCards(projet.id, 'to_deploy').find(estLaTacheDeMiseAJour);
    if (!carte) return;

    const agents = store.agentsDesCartesEnCours([], carte.agentId ? [carte.agentId] : []);
    const decision = doitPublierLaMiseAJour(
      {
        prete: true,
        attendUneDecision:
          carteAttendUneDecision(carte, agents, store.decisionsEnAttente()) || cadrageRouvertApresRapport(carte),
        agentsAuTravail: agentsOccupes(projet.id).length,
        publicationEnCours: publicationEnCours(projet.id) || store.latestDeploy(projet.id)?.state === 'running',
        ...echecsDeLaCarte(store.recentDeploys(projet.id, 20), carte.id),
      },
      Date.now(),
    );
    if (!decision.partir) {
      if (decision.abandon && !abandonsDits.has(carte.id)) {
        abandonsDits.add(carte.id);
        log.warn(`mise à jour de Beluga : ${decision.raison}`);
        bus.toast('error', `Mise à jour de Beluga : ${decision.raison}.`);
      }
      return;
    }

    log.info(`mise à jour de Beluga : ${decision.raison} (carte ${carte.id})`);
    // LA LISTE EST EXPLICITE ET NE PORTE QUE CETTE CARTE : jamais le lot entier.
    const resultat = await startDeploy(projet.id, { cible: 'dev', selectedCardIds: [carte.id] });
    if (!resultat.ok) log.warn(`mise à jour de Beluga : publication refusée — ${resultat.error ?? 'raison inconnue'}`);
  } catch (err) {
    log.error('publication de la mise à jour de Beluga', err);
  } finally {
    enCours = false;
  }
}
