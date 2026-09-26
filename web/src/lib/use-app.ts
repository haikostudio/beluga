import { useSyncExternalStore } from 'react';
import { gestesGeles, messageDuCanal, RAISON_CANAL_COUPE, type EtatDuCanal } from '@beluga/shared';
import { client, AppState } from './client';
import { t } from './langue';

export function useApp(): AppState {
  return useSyncExternalStore(client.subscribe, client.lireEtat, client.lireEtat);
}

/** Ce que l'interface a le droit de faire, en un seul objet. */
export interface EtatCanal {
  /** L'état publié par le magasin, calculé UNE fois (`etatDuCanal`, `shared`). */
  etat: EtatDuCanal;
  /** Les gestes qui partent au serveur sont-ils gelés ? */
  gele: boolean;
  /** La raison à dire sur un bouton éteint — vide quand rien n'est gelé. */
  raison?: string;
  /** Ce qu'il faut dire du lien, ou rien tant que la coupure est trop courte. */
  message: { etat: Exclude<EtatDuCanal, 'en-ligne'>; texte: string; depuis?: number } | null;
}

/**
 * LE SEUL ENDROIT OÙ L'INTERFACE DEMANDE « PUIS-JE AGIR ? ».
 *
 * Le message du lien, le champ d'écriture, la création de carte, « Tout
 * lancer », le
 * glisser-déposer du tableau et la rangée de gestes du parcours lisent tous
 * ce hook : aucun d'eux ne redéduit l'état du lien de son côté, et aucun ne
 * peut donc en avoir une lecture différente d'un autre.
 */
export function useCanal(): EtatCanal {
  const state = useApp();
  const gele = gestesGeles(state.canal);
  const message = messageDuCanal(state.canal, state.canalCoupeDepuis, Date.now());
  return {
    etat: state.canal,
    gele,
    raison: gele ? t(RAISON_CANAL_COUPE) : undefined,
    message: message ? { ...message, texte: t(message.texte) } : null,
  };
}
