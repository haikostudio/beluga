import { ecranRegarde } from '@beluga/shared';

/**
 * Lance `geste` dès que quelqu'un regarde la page (`ecranRegarde`, `shared`) :
 * tout de suite s'il la regarde déjà, sinon au premier retour de la page au
 * premier plan. Une seule fois. Rend de quoi annuler l'attente.
 */
export function quandLEcranEstRegarde(geste: () => void): () => void {
  const regarde = () => ecranRegarde({ visibilite: document.visibilityState, auPremierPlan: document.hasFocus() });
  if (regarde()) {
    geste();
    return () => undefined;
  }
  let fait = false;
  const verifier = () => {
    if (fait || !regarde()) return;
    fait = true;
    retirer();
    geste();
  };
  const retirer = () => {
    document.removeEventListener('visibilitychange', verifier);
    window.removeEventListener('focus', verifier);
  };
  document.addEventListener('visibilitychange', verifier);
  window.addEventListener('focus', verifier);
  return retirer;
}
