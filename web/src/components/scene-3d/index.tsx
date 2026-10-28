import * as React from 'react';
import type { CubeDAngle as CubeDAngleT, CubeDeLumiere as CubeDeLumiereT } from './cubes';

/**
 * LES CUBES 3D, CHARGÉS À LA DEMANDE : three.js et la scène ne se téléchargent
 * qu'à l'ouverture d'un écran qui les montre (contrat « un écran qu'on n'a pas
 * ouvert ne se télécharge pas »). Le temps du chargement, une silhouette à la
 * taille du cube.
 */
const Cubes = () => import('./cubes');
const CubeDAngleParesseux = React.lazy(() => Cubes().then((m) => ({ default: m.CubeDAngle })));
const CubeDeLumiereParesseux = React.lazy(() => Cubes().then((m) => ({ default: m.CubeDeLumiere })));

function SilhouetteDuCube() {
  return <div className="h-[240px] w-full animate-pulse rounded-lg bg-raised motion-reduce:animate-none sm:max-w-[300px]" data-cube-silhouette="" aria-hidden />;
}

export function CubeDAngle(props: React.ComponentProps<typeof CubeDAngleT>) {
  return (
    <React.Suspense fallback={<SilhouetteDuCube />}>
      <CubeDAngleParesseux {...props} />
    </React.Suspense>
  );
}

export function CubeDeLumiere(props: React.ComponentProps<typeof CubeDeLumiereT>) {
  return (
    <React.Suspense fallback={<SilhouetteDuCube />}>
      <CubeDeLumiereParesseux {...props} />
    </React.Suspense>
  );
}
