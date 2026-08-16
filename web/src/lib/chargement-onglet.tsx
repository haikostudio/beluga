import * as React from 'react';

/**
 * UN ONGLET QUI VA CHERCHER SES DONNÉES LE DIT, comme un bouton qui part en
 * requête.
 *
 * « Détails » demande le parcours de la carte, « GitHub » le déroulé de ses
 * déploiements. Sur une liaison lente, on cliquait sur l'onglet et il ne se
 * passait rien de visible : l'onglet changeait, le contenu restait vide, sans
 * qu'on sache s'il était vide ou s'il arrivait.
 *
 * Le contenu d'un onglet vit dans son propre composant, souvent dans un autre
 * fichier : c'est donc lui qui SAIT, et l'onglet qui doit MONTRER. D'où ce
 * petit canal — l'enfant annonce son chargement, le parent pose la roue.
 * Rien n'est branché ? La fonction ne fait rien, et le composant reste
 * utilisable seul (dans un contrôle, par exemple).
 */
const CanalDeChargement = React.createContext<(onglet: string, enCours: boolean) => void>(() => undefined);

export function FournisseurDeChargement({
  signaler,
  children,
}: {
  signaler: (onglet: string, enCours: boolean) => void;
  children: React.ReactNode;
}) {
  return <CanalDeChargement.Provider value={signaler}>{children}</CanalDeChargement.Provider>;
}

/**
 * À poser dans le composant qui charge : il annonce son attente, et l'éteint
 * en partant — un onglet quitté pendant sa requête ne doit pas laisser une roue
 * tourner pour toujours.
 */
export function useChargementOnglet(onglet: string, enCours: boolean): void {
  const signaler = React.useContext(CanalDeChargement);
  React.useEffect(() => {
    signaler(onglet, enCours);
    return () => signaler(onglet, false);
  }, [onglet, enCours, signaler]);
}

/** L'état tenu par le parent : quels onglets attendent encore leurs données. */
export function useOngletsQuiChargent(): [Record<string, boolean>, (onglet: string, enCours: boolean) => void] {
  const [chargement, setChargement] = React.useState<Record<string, boolean>>({});
  const signaler = React.useCallback((onglet: string, enCours: boolean) => {
    setChargement((etat) => (etat[onglet] === enCours ? etat : { ...etat, [onglet]: enCours }));
  }, []);
  return [chargement, signaler];
}
