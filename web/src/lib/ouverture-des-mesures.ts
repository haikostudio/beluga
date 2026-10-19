/*
 * OÙ S'OUVRE L'ÉCRAN CACHÉ DES MESURES (`components/mesures-ecran.tsx`). Ce petit
 * module est chargé dès le départ ; l'écran, lui, n'est téléchargé que si on
 * l'ouvre.
 */
export function adresseDesMesures(): string {
  return `${location.origin}/?mesures=1`;
}

export function mesuresDemandees(): boolean {
  return new URLSearchParams(location.search).has('mesures');
}

/** Six appuis en moins de trois secondes dans le coin haut gauche ouvrent l'écran, partout dans l'application. */
export function brancherOuvertureDesMesures(): void {
  let appuis: number[] = [];
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.clientX > 90 || e.clientY > 90) return;
      const maintenant = Date.now();
      appuis = [...appuis.filter((t) => maintenant - t < 3000), maintenant];
      if (appuis.length >= 6) location.assign(adresseDesMesures());
    },
    { capture: true, passive: true },
  );
}
