import { Agent, ChoixErreurDeTour, choixDejaFerme } from '@haikodev/shared';
import { bus } from './bus.js';
import { notify } from './notify.js';
import * as store from './store.js';
import { suspendreLaCarte } from './deplacement-carte.js';
import { log } from './logger.js';

/**
 * REPRENDRE LA MAIN APRÈS UNE ERREUR QUI A COUPÉ LE TRAVAIL.
 *
 * Une panne passagère du fournisseur se retente toute seule
 * (`relance-moteur.ts`), une limite de compte a sa propre décision
 * (`reprise-compte.ts`). Ce fichier tient les deux gestes qui manquaient pour
 * l'échec ORDINAIRE : POSER la décision « que faire de cette erreur ? », et la
 * TRANCHER au clic — relancer le même agent, ignorer, ou arrêter. La règle qui
 * dit QUAND poser cette décision vit dans `shared/src/erreur-de-tour.ts`.
 */

export const RAISON_ARRET_APRES_ERREUR =
  'Une erreur a arrêté le travail : la carte revient en « Planifié » sur décision de l’utilisateur.';

/**
 * LA DÉCISION EST POSÉE : le triangle orange s'allume là où elle se prend, et
 * une alerte sort de l'application. Le message porte déjà `erreurDeTour` ; ici
 * on ne fait que le signaler.
 */
export function poserDecisionErreurDeTour(entree: { messageId: string; agent: Agent; cause: string }): void {
  log.info(`tour de l'agent ${entree.agent.id} coupé net par une erreur : ${entree.cause}`);
  notify({
    motif: 'decision-attendue',
    title: 'Une erreur a arrêté le travail',
    body: `${entree.agent.title} — ${entree.cause}`,
    // La CARTE quand il y en a une : deux tours coupés sur la même carte ne
    // font pas deux alertes tant que le choix n'a pas été fait.
    reference: entree.agent.cardId ?? entree.messageId,
    element: entree.agent.title,
    projectId: entree.agent.projectId,
    cardId: entree.agent.cardId,
    agentId: entree.agent.id,
  });
  bus.emit({ type: 'attention', ...store.signalAttention() });
}

export interface ResultatDeReponseErreur {
  ok: boolean;
  error?: string;
}

/**
 * LE CLIC. Trois issues, aucune silencieuse :
 *   — RELANCER reprend le MÊME agent, avec son fil, sa branche et ses étapes
 *     restantes — exactement comme une reprise de compte ;
 *   — IGNORER dit que le travail déjà fait suffit : la carte se range en
 *     « Terminé », comme le bouton « Terminer » du tableau ;
 *   — ARRÊTER remet la carte en « Planifié », par le même chemin que les trois
 *     autres gestes d'arrêt (`suspendreLaCarte`).
 */
export async function repondreErreurDeTour(
  messageId: string,
  choix: ChoixErreurDeTour,
): Promise<ResultatDeReponseErreur> {
  const message = store.getMessage(messageId);
  if (!message) throw new Error('message introuvable');
  const erreur = message.erreurDeTour;
  if (!erreur) throw new Error('ce tour ne porte aucune erreur en attente');
  if (choixDejaFerme(erreur.choix)) return { ok: false, error: 'décision déjà prise' };

  const agent = store.getAgent(message.agentId);
  if (!agent) throw new Error('agent introuvable');

  const retenu = store.saveMessage({
    ...message,
    erreurDeTour: { ...erreur, choix, choisiA: Date.now() },
  });
  bus.emit({ type: 'message.upsert', message: retenu });
  bus.emit({ type: 'attention', ...store.signalAttention() });

  if (choix === 'relancer') {
    const { sendPrompt } = await import('./runtime.js');
    void sendPrompt(
      agent.id,
      "REPRISE APRÈS UNE ERREUR : ton tour précédent a été coupé net par une erreur du moteur, sur décision " +
        "de l'utilisateur de relancer. Continue exactement où tu t'étais arrêté — ne recommence pas ce qui est " +
        'déjà fait.',
      { silent: true },
    ).catch((err) => log.error("relance après erreur impossible", err));
    return { ok: true };
  }

  const card = agent.cardId ? store.getCard(agent.cardId) : undefined;
  if (card && card.column === 'running') {
    if (choix === 'arreter') {
      suspendreLaCarte(card, RAISON_ARRET_APRES_ERREUR);
    } else {
      // IGNORER : le travail déjà fait suffit, la carte est rangée « À déployer ».
      const rangee = store.saveCard({
        ...card,
        column: 'to_deploy',
        position: store.nextPosition(card.projectId, 'to_deploy'),
        doneAt: Date.now(),
        deployedAt: undefined,
      });
      bus.emit({ type: 'card.upsert', card: rangee });
    }
    bus.emit({ type: 'rendus', byProject: store.projectsWithFinishedWork() });
  }

  return { ok: true };
}
