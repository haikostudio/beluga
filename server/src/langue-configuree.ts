/**
 * LA LANGUE RÉGLÉE PAR L'UTILISATEUR, LUE CÔTÉ DÉMON.
 *
 * L'interface écrit ce choix dans la préférence « langue »
 * (`web/src/lib/langue.ts`, `usePref('langue', …)`), et les préférences vivent
 * EN BASE : le démon les relit donc directement, sans que le navigateur ait à
 * les lui répéter. C'est ce qui permet à la consigne système d'un agent de
 * porter la langue de l'utilisateur (`consigneDeLangue`).
 *
 * ELLE NE CHANGE PAS D'UN TOUR À L'AUTRE dans une session : seul un changement
 * de réglage la déplace, et la consigne système reste sinon identique — la
 * règle du cache des moteurs est donc tenue.
 */
import { langueValide, type LangueId } from '@beluga/shared';
import * as store from './store.js';

/** La clé de la préférence, la même des deux côtés. */
export const CLE_LANGUE = 'langue';

/** La langue en vigueur, ou le français quand rien n'est réglé. */
export function langueDesAgents(): LangueId {
  try {
    return langueValide(store.readPreferences()[CLE_LANGUE]);
  } catch {
    /* Base indisponible (démarrage, essai isolé) : la langue d'origine. */
    return langueValide(undefined);
  }
}
