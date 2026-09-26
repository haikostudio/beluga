import {
  COLONNE_DE_FIN_DE_TOUR,
  Agent,
  ChoixErreurDeTour,
  EtapeDeReprise,
  choixDejaFerme,
  consigneDeReprise,
  expliquerLErreur,
  nomDeBranche,
} from '@beluga/shared';
import { bus } from './bus.js';
import { notify } from './notify.js';
import * as store from './store.js';
import { suspendreLaCarte } from './deplacement-carte.js';
import { log } from './logger.js';
import { expliquerPourLEcran } from './explication-d-erreur.js';

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
  'Une erreur a arrêté le travail : la carte revient en « Demande » sur décision de l’utilisateur.';

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
  void poserLaPhraseSimple(entree.messageId, entree.cause);
}

/**
 * UNE CAUSE ÉCRITE PAR LA MACHINE ET INCONNUE DES MOTIFS est confiée à
 * Laya, APRÈS coup : la décision est déjà posée et affichée, la phrase
 * simple la rejoint une seconde plus tard. Rien n'attend ce classement.
 */
async function poserLaPhraseSimple(messageId: string, cause: string): Promise<void> {
  try {
    if (!expliquerLErreur(cause).aClasser) return;
    const explication = await expliquerPourLEcran(cause, 'erreur de tour');
    if (explication.source !== 'laya') return;
    const message = store.getMessage(messageId);
    if (!message?.erreurDeTour) return;
    const retenu = store.saveMessage({
      ...message,
      erreurDeTour: { ...message.erreurDeTour, phrase: explication.phrase, famille: explication.famille },
    });
    bus.emit({ type: 'message.upsert', message: retenu });
  } catch (err) {
    log.warn(`phrase simple non posée (message ${messageId}) : ${(err as Error).message}`);
  }
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
    /*
     * RIEN N'AVAIT COMMENCÉ : ON RENVOIE LA DEMANDE, PAS UNE REPRISE.
     *
     * Un tour mort AVANT le moteur (préparation restée bloquée) n'a pas de
     * travail à poursuivre : lui dire « continue où tu t'étais arrêté » le
     * ferait repartir sur rien, et la phrase de l'utilisateur — la seule chose
     * qui comptait — resterait perdue. Elle est encore en base, déjà affichée
     * dans le fil : on la renvoie TELLE QUELLE, avec ses pièces jointes, en
     * reprenant sa bulle au lieu d'en écrire une seconde.
     */
    const perdue = erreur.demandeARejouer ? store.getMessage(erreur.demandeARejouer) : undefined;
    if (perdue && perdue.role === 'user' && perdue.content.trim()) {
      void sendPrompt(agent.id, perdue.content, {
        attachments: perdue.attachments,
        messageDejaEcrit: perdue.id,
      }).catch((err) => log.error('renvoi de la demande impossible', err));
      return { ok: true };
    }
    /*
     * RELANCER, C'EST REPRENDRE — PAS REDEMANDER POLIMENT DE CONTINUER.
     *
     * La consigne d'avant tenait en une phrase (« continue exactement où tu
     * t'étais arrêté »), et le tour partait SANS le drapeau `poursuite` : la
     * liste de tâches du tour coupé ne repartait donc pas avec lui. L'écran se
     * vidait de ses sept étapes faites, et l'agent, ne sachant plus où il en
     * était, recommençait. C'est le geste « Reprendre » d'une carte
     * interrompue qui fait le travail complet : il NOMME ce qui est déjà fait
     * et ce qui reste (`shared/src/reprise-carte.ts`). On le reprend ici.
     */
    void sendPrompt(agent.id, consigneDeRelanceApresErreur(agent, erreur.cause), {
      silent: true,
      poursuite: true,
    }).catch((err) => log.error('relance après erreur impossible', err));
    return { ok: true };
  }

  const card = agent.cardId ? store.getCard(agent.cardId) : undefined;
  if (card && card.column === 'running') {
    if (choix === 'arreter') {
      suspendreLaCarte(card, RAISON_ARRET_APRES_ERREUR);
    } else {
      // IGNORER : le travail déjà fait suffit, la carte rejoint le lot à
      // publier — le point d'arrivée de tout travail rendu.
      const rangee = store.saveCard({
        ...card,
        column: COLONNE_DE_FIN_DE_TOUR,
        position: store.nextPosition(card.projectId, COLONNE_DE_FIN_DE_TOUR),
        doneAt: Date.now(),
        deployedAt: undefined,
      });
      bus.emit({ type: 'card.upsert', card: rangee });
    }
    bus.emit({ type: 'rendus', byProject: store.projectsWithFinishedWork() });
  }

  return { ok: true };
}

/**
 * LA CONSIGNE D'UNE RELANCE APRÈS ERREUR.
 *
 * Le même bloc que la reprise d'une carte interrompue — ce qui est fait, ce qui
 * reste, la branche et le dossier qui n'ont pas bougé — avec, en tête, la cause
 * réelle de la coupure plutôt qu'un « une erreur du moteur » qui n'apprend rien.
 *
 * Les étapes viennent du DERNIER tour qui en portait une : un tour coupé net
 * n'a pas toujours eu le temps d'en écrire, et remonter le fil vaut mieux que
 * de rendre une liste vide — qui ferait croire à un travail sans étapes.
 */
function consigneDeRelanceApresErreur(agent: Agent, cause: string): string {
  const carte = agent.cardId ? store.getCard(agent.cardId) : null;
  const dernier = [...store.listMessages(agent.id)].reverse().find((message) => message.todos.length);
  const etapes: EtapeDeReprise[] = (dernier?.todos ?? []).map((todo) => ({
    label: todo.label,
    etat: todo.state,
  }));
  return consigneDeReprise({
    origine: 'panne',
    raison:
      `ton tour précédent a été coupé net par une erreur : ${cause.trim()}. ` +
      'L’utilisateur a demandé de RELANCER.',
    branche: carte ? nomDeBranche(carte.title, carte.id) : undefined,
    dossier: agent.workdir ?? undefined,
    etapes,
    codeDejaEnregistre: carte?.codeDejaEnregistre,
  });
}
