import * as React from 'react';

/**
 * UN PANNEAU QU'ON N'A PAS ENCORE OUVERT NE SE TÉLÉCHARGE PAS.
 *
 * Toute l'application partait en un seul fichier : le tableau de bord, les
 * réglages, le tiroir d'une carte, le module de voix — des écrans qu'on ouvre
 * par un bouton, jamais au démarrage — étaient téléchargés avant la première
 * carte. Sur un téléphone, ce fichier EST le temps d'attente qui reste une fois
 * le serveur rendu rapide.
 *
 * Chacun devient donc un MORCEAU à part, réclamé au premier ouvert et gardé
 * ensuite par le navigateur. Deux garde-fous :
 *
 *  - le morceau n'est demandé QUE si le panneau est ouvert (`monte`) : monter un
 *    composant paresseux qui rend `null` déclencherait quand même son
 *    téléchargement, et on n'aurait rien gagné ;
 *  - pendant le chargement, on ne montre RIEN. Ces panneaux s'ouvrent par-dessus
 *    l'écran, en quelques dizaines de millisecondes sur un morceau déjà en
 *    cache : un voile d'attente clignoterait plus qu'il n'informerait.
 */
export function PanneauALaDemande({
  monte,
  children,
}: {
  /** Le panneau est-il ouvert ? Faux : rien n'est monté, donc rien n'est téléchargé. */
  monte: boolean;
  children: React.ReactNode;
}) {
  if (!monte) return null;
  return <React.Suspense fallback={null}>{children}</React.Suspense>;
}

/**
 * Charge un module à l'AVANCE, sans rien afficher : appelé quand l'application
 * est au repos, il évite au premier clic d'attendre le réseau. L'échec est sans
 * conséquence — le morceau sera redemandé à l'ouverture.
 */
export function prechargerAuRepos(charger: () => Promise<unknown>): () => void {
  const lancer = () => void charger().catch(() => undefined);
  const differer = (window as any).requestIdleCallback as
    | ((cb: () => void, options?: { timeout: number }) => number)
    | undefined;
  if (differer) {
    const id = differer(lancer, { timeout: 4000 });
    return () => (window as any).cancelIdleCallback?.(id);
  }
  const minuteur = window.setTimeout(lancer, 2000);
  return () => window.clearTimeout(minuteur);
}
