import * as React from 'react';
import { teinteDuTemoinServeur, type TeinteDuTemoinServeur } from '@beluga/shared';
import { t } from '@/lib/langue';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';

/**
 * LE TÉMOIN DU SERVEUR (carte « Colonne repliée et témoin du serveur », 18/11/2026) : en tête de la colonne de gauche,
 * l'icône de l'application, à la place du nom « Beluga », porte un point au coin haut droit — gris-vert quand le lien
 * tient, orange qui clignote pendant un redémarrage ou une reconnexion courte, rouge quand le serveur ne répond plus
 * durablement. La règle est pure (`teinteDuTemoinServeur`, shared/src/panne-serveur.ts) et ne lit que `state.canal`,
 * l'état du lien déjà calculé par le client — jamais `state.connected` seul, qu'un canal zombie peut garder vrai.
 *
 * Il remplace le point qui vivait au pied de la colonne, à côté de « LLM en ligne ».
 *
 * Ces trois teintes sont l'EXCEPTION de couleur décidée par l'utilisateur dans une charte monochrome : jetons
 * `--temoin-stable` et `--temoin-redemarrage` (styles.css, clair et sombre), rouge de l'erreur (`danger`). Le contrôle
 * des thèmes (`verif-themes.mjs`) laisse passer `[data-temoin-serveur]` et lui seul. Le liseré reprend le fond de la zone, pour que le
 * point se détache de l'icône noire dans les douze palettes.
 */
const CLASSE_PAR_TEINTE: Record<TeinteDuTemoinServeur, string> = {
  stable: 'bg-[hsl(var(--temoin-stable))]',
  redemarrage: 'animate-pulse-soft bg-[hsl(var(--temoin-redemarrage))] motion-reduce:animate-none',
  eteint: 'bg-danger',
};

/** La teinte du témoin, relue chaque seconde pendant une coupure : le passage au rouge ne dépend que du temps. */
export function useTeinteDuTemoinServeur(): TeinteDuTemoinServeur {
  const state = useApp();
  const [maintenant, setMaintenant] = React.useState(() => Date.now());
  const coupe = state.canal !== 'en-ligne';
  React.useEffect(() => {
    if (!coupe) return;
    setMaintenant(Date.now());
    const minuteur = window.setInterval(() => setMaintenant(Date.now()), 1_000);
    return () => window.clearInterval(minuteur);
  }, [coupe]);
  return teinteDuTemoinServeur(state.canal, state.canalCoupeDepuis, coupe ? maintenant : Date.now());
}

/** Ce que dit la bulle : la teinte en mots, et combien d'agents travaillent quand tout va bien. */
export function useTexteDuTemoinServeur(teinte: TeinteDuTemoinServeur): string {
  const state = useApp();
  if (teinte !== 'stable') return teinte === 'eteint' ? t('Serveur injoignable') : t('Redémarrage du serveur…');
  // « starting » compte aussi : un tour resté coincé dans sa préparation travaille encore.
  const agentsEnCours = Object.values(state.agents).filter((agent) => agent.status === 'running' || agent.status === 'starting').length;
  return agentsEnCours > 1 ? t('Connecté au serveur · {v0} agents travaillent', { v0: agentsEnCours }) : t('Connecté au serveur');
}

export function TemoinDuServeur({ taille = 28, className }: { taille?: number; className?: string }) {
  const teinte = useTeinteDuTemoinServeur();
  return (
    <span
      className={cn('relative inline-flex shrink-0', className)}
      style={{ width: taille, height: taille }}
      data-temoin-serveur={teinte}
    >
      <img src="/icon.svg" alt="" draggable={false} className="h-full w-full select-none rounded-lg" />
      <span
        aria-hidden
        data-point-du-serveur
        className={cn(
          'pointer-events-none absolute -right-[3px] -top-[3px] h-[9px] w-[9px] rounded-full ring-2 ring-[hsl(var(--fond-zone))]',
          CLASSE_PAR_TEINTE[teinte],
        )}
      />
    </span>
  );
}
