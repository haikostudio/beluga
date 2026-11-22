/*
 * LES ÉCRANS OUVERTS DE CHAQUE COMPTE (carte « Beluga Connect : liaison et suivi », 22/11/2026). Beluga Connect
 * n'ouvre plus jamais de page : quand sa liaison a besoin de l'accord de la personne, la demande est poussée à ses
 * onglets déjà ouverts. Ce compteur dit s'il y en a au moins un ; sinon, l'application affiche « Ouvrez Beluga pour
 * finir » et attend un clic. Tenu par le canal web (`ws.ts`), rien n'est écrit.
 */
const ouverts = new Map<string, number>();

/** Un canal web s'ouvre pour ce compte ; la fonction rendue le referme (une seule fois). */
export function noterUnEcranOuvert(compteId: string): () => void {
  ouverts.set(compteId, (ouverts.get(compteId) ?? 0) + 1);
  let ferme = false;
  return () => {
    if (ferme) return;
    ferme = true;
    const reste = (ouverts.get(compteId) ?? 1) - 1;
    if (reste > 0) ouverts.set(compteId, reste);
    else ouverts.delete(compteId);
  };
}

export function ecransOuvertsDuCompte(compteId: string): number {
  return ouverts.get(compteId) ?? 0;
}
