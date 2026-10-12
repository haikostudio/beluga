import * as React from 'react';
import { captureDejaVue, clesDeVue, type CaptureDuFlux } from '@beluga/shared';
import { ecouterLesVues, generationDesVues, vuesConnues } from '@/lib/captures-vues';
import { client } from '@/lib/client';

/**
 * L'ŒIL « DÉJÀ VUE », POUR TOUT ENDROIT QUI OUVRE DES IMAGES EN GRAND.
 *
 * Un seul mécanisme, partagé par la bande « Ce que l'agent a vu », l'onglet des
 * pièces jointes et les notes : mêmes clés (`jointe:<id>` / `etape:<id>`), mêmes
 * commandes, un seul ensemble en mémoire (`lib/captures-vues.ts`). Ce crochet ne
 * garde rien lui-même, sauf l'état d'AVANT l'image qu'on vient d'ouvrir.
 *
 * AFFICHER EN GRAND, C'EST AVOIR VU — et l'ordre compte : `ouvrirEnMarquant`
 * lit d'abord si l'image était DÉJÀ vue, puis la marque, dans le geste et non
 * dans un effet. Sinon l'œil de la visionneuse serait allumé dès la première
 * ouverture.
 */
export interface ImagesVues {
  /** L'ensemble des clés vues, tel qu'il est maintenant. */
  vues: ReadonlySet<string>;
  /** Cette image a-t-elle déjà été ouverte en grand ? */
  dejaVue: (c: CaptureDuFlux) => boolean;
  /** Pareil, mais l'image qu'on vient d'ouvrir garde son état d'AVANT l'ouverture. */
  dejaVueAvantOuverture: (c: CaptureDuFlux) => boolean;
  /** À appeler dans le geste qui ouvre (ou feuillette) une image : lit l'état d'avant, puis marque. */
  ouvrirEnMarquant: (c: CaptureDuFlux | undefined) => void;
  /** « Tout marquer comme vu » : ces clés d'un coup, par tranches. */
  marquer: (cles: readonly string[]) => void;
}

/**
 * LES IMAGES DÉJÀ VUES PARMI CELLES D'UN AFFICHAGE. Il demande l'état de ses
 * seules clés (et le redemande à la reconnexion) ; l'ensemble rendu grandit dès
 * qu'une image est ouverte, ici ou sur un autre appareil du compte.
 */
export function useImagesVues(captures: readonly CaptureDuFlux[]): ImagesVues {
  const vues = React.useSyncExternalStore(ecouterLesVues, vuesConnues);
  const generation = React.useSyncExternalStore(ecouterLesVues, generationDesVues);
  const cles = React.useMemo(() => captures.flatMap(clesDeVue), [captures]);
  React.useEffect(() => {
    if (cles.length) client.demanderLesCapturesVues(cles);
  }, [cles, generation]);

  const [arrivee, setArrivee] = React.useState<{ cle: string; vue: boolean } | null>(null);
  const ouvrirEnMarquant = React.useCallback((c: CaptureDuFlux | undefined) => {
    if (!c) return;
    setArrivee({ cle: c.cle, vue: captureDejaVue(c, vuesConnues()) });
    client.marquerCapturesVues(clesDeVue(c));
  }, []);
  const dejaVue = React.useCallback((c: CaptureDuFlux) => captureDejaVue(c, vues), [vues]);
  const dejaVueAvantOuverture = React.useCallback(
    (c: CaptureDuFlux) => (arrivee?.cle === c.cle ? arrivee.vue : captureDejaVue(c, vues)),
    [arrivee, vues],
  );
  const marquer = React.useCallback((aMarquer: readonly string[]) => client.marquerCapturesVues(aMarquer), []);
  return { vues, dejaVue, dejaVueAvantOuverture, ouvrirEnMarquant, marquer };
}
