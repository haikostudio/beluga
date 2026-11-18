/**
 * LE MODE CHOISI PAR L'AGENT, ÉCRIT SUR LA CARTE (décision de l'utilisateur du 12/11/2026 ; règles pures dans
 * `shared/src/mode-de-la-carte.ts`). L'agent de cadrage choisit le mode au premier tour — question seulement dans le
 * vrai doute — puis l'écrit par `board_update_card` (champ « mode », et « media » pour le Studio). Les drapeaux sont
 * ceux des anciens interrupteurs (`planSouhaite`, `realisationSouhaitee`) : un seul mode à la fois. Le mode
 * « Création » est retiré, champ `creationSouhaitee` compris (ignoré à la lecture).
 *
 * La question arrive EN COURS DE TOUR : la consigne du mode retenu est donc RENDUE à l'agent dans la réponse de
 * l'outil, pour qu'il la suive dans ce même tour (le plan marque sa demande et son jalon, le Studio ouvre son volet).
 */
import { carteEnCadrage, realisationNeuve, type ModeDeLaCarte, type TypeDeMediaDeRealisation } from '@beluga/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { getMeta, setMeta } from './db.js';

const cleConfirme = (cardId: string) => `carte.mode.confirme.${cardId}`;

/** Le mode a-t-il déjà été posé sur cette carte (« aucun » compris) ? */
export function modeDejaConfirme(cardId: string): boolean {
  return !!getMeta(cleConfirme(cardId));
}

export async function poserLeModeDeLaCarte(
  cardId: string,
  agentId: string,
  mode: ModeDeLaCarte,
  media?: TypeDeMediaDeRealisation,
): Promise<{ ok: true; texte: string } | { ok: false; raison: string }> {
  const card = store.getCard(cardId);
  if (!card) return { ok: false, raison: 'Carte introuvable.' };
  if (!carteEnCadrage(card)) return { ok: false, raison: 'Le mode se pose pendant le cadrage, avant le lancement.' };
  if (mode === 'studio' && !media) return { ok: false, raison: 'Pour le Studio, donne aussi « media » (video, image, son…).' };
  setMeta(cleConfirme(cardId), mode);
  const avant = card.parcours ?? { plans: [] };
  const ecrite = store.saveCard({
    ...card,
    parcours: {
      ...avant,
      planSouhaite: mode === 'plan',
      planAutomatique: undefined,
      realisationSouhaitee: mode === 'studio',
    },
    ...(mode === 'studio' && media ? { realisation: { ...(card.realisation ?? realisationNeuve()), medias: [media] } } : {}),
  });
  bus.emit({ type: 'card.upsert', card: ecrite });

  if (mode === 'aucun') return { ok: true, texte: 'Aucun mode particulier : cadre la carte normalement (compréhension).' };
  if (mode === 'plan') {
    const { annoncerPlanDuMemeTour } = await import('./ws.js');
    const agent = store.getAgent(agentId);
    const plan = agent ? annoncerPlanDuMemeTour(agent) : undefined;
    plan?.noterLeJalon();
    return {
      ok: true,
      texte: `Mode Plan posé (l’étiquette « Plan » paraît près du trombone).${plan ? `\n\nCONSIGNE DU PLAN, à suivre dans CE tour :\n${plan.consigne}` : ' Rends ta compréhension, puis le plan.'}`,
    };
  }
  const { consigneDeRealisationDeLaCarte } = await import('./realisation.js');
  const { noterLaDemandeDeRealisation } = await import('./realisation-questionnaire.js');
  const consigne = consigneDeRealisationDeLaCarte(ecrite, 'cadrage');
  noterLaDemandeDeRealisation(cardId);
  return { ok: true, texte: `Mode Studio posé (${media}) : le volet de réalisation s’ouvre à droite et l’étiquette « Studio » paraît près du trombone.${consigne ? `\n\nCONSIGNE DU MODE STUDIO, à suivre dans CE tour :\n${consigne}` : ''}` };
}
