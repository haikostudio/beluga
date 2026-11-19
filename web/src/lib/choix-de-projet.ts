import * as React from 'react';
import { client } from './client';

/**
 * LE TEMPS LAISSÉ AUX CARTES D'UN PROJET POUR ARRIVER avant de refermer quand même la liste : un serveur qui ne
 * répond pas ne doit jamais laisser une roue tourner sur une liste qu'on ne peut plus fermer.
 */
export const DELAI_MAX_DU_CHOIX_DE_PROJET_MS = 8000;

/**
 * CHOISIR UN PROJET DIT QU'IL SE CHARGE (demande du 19/11/2026, capture #c64e) : sur téléphone, toucher un projet
 * refermait la liste aussitôt et laissait un tableau vide plusieurs secondes, sans rien qui dise que ça venait.
 *
 * `choisir(id, ensuite)` ouvre le projet ; si ses cartes sont déjà là (`cartesChargees`), `ensuite` part tout de
 * suite. Sinon la ligne touchée porte une roue (`enChargement === id`) et `ensuite` — qui referme la liste — n'attend
 * que l'arrivée des cartes, ou le délai de garde. L'écoute du magasin n'existe que pendant l'attente : aucune ligne
 * ne se redessine au repos.
 */
export function useChoixDeProjetAvecAttente(): {
  enChargement: string | null;
  choisir: (projectId: string, ensuite?: () => void) => void;
} {
  const [enChargement, setEnChargement] = React.useState<string | null>(null);
  const annuler = React.useRef<(() => void) | null>(null);
  React.useEffect(() => () => annuler.current?.(), []);

  const choisir = React.useCallback((projectId: string, ensuite?: () => void) => {
    annuler.current?.();
    client.setActiveProject(projectId);
    if (client.lireEtat().cartesChargees[projectId]) {
      ensuite?.();
      return;
    }
    setEnChargement(projectId);
    let fini = false;
    let desabonner: () => void = () => undefined;
    let minuteur = 0;
    const couper = () => {
      fini = true;
      desabonner();
      window.clearTimeout(minuteur);
      annuler.current = null;
    };
    const terminer = () => {
      if (fini) return;
      couper();
      setEnChargement(null);
      ensuite?.();
    };
    desabonner = client.subscribe(() => {
      if (client.lireEtat().cartesChargees[projectId]) terminer();
    });
    minuteur = window.setTimeout(terminer, DELAI_MAX_DU_CHOIX_DE_PROJET_MS);
    annuler.current = couper;
  }, []);

  return { enChargement, choisir };
}
