/**
 * LES QUESTIONS GARDÉES SUR LA CARTE, CÔTÉ DÉMON : la réponse, la reprise du
 * cadrage après la dernière, et la conversion des cartes cadrées avant.
 * Les règles pures vivent dans `shared/src/questions-de-carte.ts`.
 */
import {
  COLONNES_AVANT_LE_TRAVAIL,
  convertirLesSuppositions,
  demandeDeRepriseApresLesReponses,
  questionsSansReponse,
  repondreALaQuestionDeCarte,
} from '@beluga/shared';
import type { Card } from '@beluga/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { log } from './logger.js';
import { agentDeCadrage } from './cadrage.js';

/**
 * RÉPONDRE À UNE QUESTION DE LA CARTE. La réponse s'écrit sur la
 * compréhension en cours ; la suivante paraît d'elle-même à l'écran. Après la
 * DERNIÈRE, le cadrage reprend : un tour AVEC témoin (sa demande ne porte aucun
 * marqueur du cadrage sans témoin), qui réécrit la compréhension avec ces
 * décisions. Un agent déjà occupé la reçoit en file (DEC-037) ; le compte est
 * choisi par le chemin ordinaire de `sendPrompt` (DEC-039).
 */
export async function repondreALaQuestionDeLaCarte(
  cardId: string,
  questionId: string,
  reponse: string,
  /** Le tour de reprise ; remplacé dans les tests, qui n'ouvrent aucun moteur. */
  reprendre: (agentId: string, demande: string) => Promise<void> = async (agentId, demande) => {
    const { sendPrompt } = await import('./runtime.js');
    await sendPrompt(agentId, demande, { template: 'none', silent: true });
  },
): Promise<Card> {
  const carte = store.getCard(cardId);
  const comprise = carte?.parcours?.comprehension;
  if (!carte || !comprise) throw new Error('cette carte ne porte aucune compréhension.');
  if (!COLONNES_AVANT_LE_TRAVAIL.includes(carte.column)) throw new Error('cette carte n’est plus en cadrage.');
  const questions = repondreALaQuestionDeCarte(comprise, questionId, reponse);
  if (!questions) throw new Error('cette question n’attend plus de réponse.');
  const ecrite = store.saveCard({
    ...carte,
    parcours: { ...carte.parcours!, comprehension: { ...comprise, questionsEnAttente: questions } },
  });
  bus.emit({ type: 'card.upsert', card: ecrite });
  bus.emit({ type: 'attention', ...store.signalAttention() });
  if (!questionsSansReponse(ecrite.parcours?.comprehension).length) {
    const cadrage = agentDeCadrage(cardId);
    if (cadrage) {
      await reprendre(cadrage.id, demandeDeRepriseApresLesReponses(ecrite.parcours?.comprehension)).catch((err) =>
        log.warn(`questions de la carte ${cardId} : reprise du cadrage impossible`, err),
      );
    }
  }
  return store.getCard(cardId) ?? ecrite;
}

/**
 * LES CARTES DÉJÀ CADRÉES AVEC DES SUPPOSITIONS DEVIENNENT DES CARTES À
 * QUESTIONS. Au démarrage, sans agent ni quota : chaque supposition devient
 * une question « Oui, c'est bien ça / Non, je précise » (`convertirLesSuppositions`),
 * celles déjà validées d'un clic arrivent répondues. Seules les cartes encore
 * en cadrage (avant le travail, dernier agent = cadrage) sont touchées : une
 * carte lancée, interrompue ou rangée garde son histoire. Idempotent — une
 * carte convertie n'a plus de supposition —, donc rejoué sans marque à chaque
 * démarrage, sans rien coûter. Le cadrage ne reprend qu'après les réponses.
 */
export function convertirLesSuppositionsDesCartes(): number {
  let converties = 0;
  for (const projet of store.listProjects()) {
    for (const colonne of COLONNES_AVANT_LE_TRAVAIL) {
      for (const carte of store.listCardsInColumn(projet.id, colonne)) {
        const comprise = carte.parcours?.comprehension;
        if (!comprise) continue;
        const convertie = convertirLesSuppositions(comprise);
        if (!convertie) continue;
        if (store.getLastAgentByCard(carte.id) && !agentDeCadrage(carte.id)) continue;
        const ecrite = store.saveCard({ ...carte, parcours: { ...carte.parcours!, comprehension: convertie } });
        bus.emit({ type: 'card.upsert', card: ecrite });
        converties += 1;
      }
    }
  }
  if (converties) bus.emit({ type: 'attention', ...store.signalAttention() });
  return converties;
}
