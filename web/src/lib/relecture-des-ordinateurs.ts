import * as React from 'react';
import { RELECTURE_DES_ORDINATEURS_MS } from '@beluga/shared';
import { client } from '@/lib/client';
import { pageCachee, surLaVisibilite } from '@/lib/veille';

/**
 * LA RELECTURE DES ORDINATEURS, PARTAGÉE PAR TOUS LES ÉCRANS QUI LES SUIVENT (carte « Ordinateurs : pannes et volets
 * alignés », 22/11/2026). Le 22/11, Safari est tombé en échec sur le Mac pendant que l'onglet Beluga dormait : le signal
 * `extension.change` s'est perdu, et la fenêtre de connexion a gardé « en cours » alors que Beluga Connect disait
 * « À réparer ». Désormais l'état se relit :
 *  - à chaque signal du démon (`client.onExtension`, rejoué aussi à chaque retour du canal, `ready`) ;
 *  - au retour de l'onglet à l'écran ;
 *  - toutes les `RELECTURE_DES_ORDINATEURS_MS` tant que `actif` (un travail de Beluga Connect est en cours, ou un
 *    parcours d'installation attend), et seulement page à l'écran — rien ne tourne pour rien.
 */
export function useRelectureDesOrdinateurs(lire: () => void | Promise<unknown>, actif: boolean): void {
  const lireRef = React.useRef(lire);
  lireRef.current = lire;
  React.useEffect(() => {
    void lireRef.current();
    const lacherSignal = client.onExtension(() => void lireRef.current());
    const lacherVisibilite = surLaVisibilite(() => {
      if (!pageCachee()) void lireRef.current();
    });
    return () => {
      lacherSignal();
      lacherVisibilite();
    };
  }, []);
  React.useEffect(() => {
    if (!actif) return;
    const minuteur = window.setInterval(() => {
      if (!pageCachee()) void lireRef.current();
    }, RELECTURE_DES_ORDINATEURS_MS);
    return () => window.clearInterval(minuteur);
  }, [actif]);
}
