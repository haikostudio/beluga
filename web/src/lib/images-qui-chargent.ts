/*
 * UNE IMAGE QUI CHARGE SE VOIT (04/11/2026). Pièces jointes, captures et
 * miniatures vivent désormais sur le disque de stockage de 1 To (décision de
 * l'utilisateur : la place du serveur prime, quitte à charger un peu moins
 * vite). Une image servie par le démon (`/api/…`) porte donc une silhouette qui
 * respire tant qu'elle n'est pas arrivée (`styles.css`, `data-image-chargee`).
 *
 * Un seul écouteur pour toute l'application, en phase de capture (`load` et
 * `error` ne remontent pas) : aucun composant n'a à s'en occuper. Une image
 * dont l'adresse change redevient « en chargement » jusqu'à la nouvelle.
 */
export function brancherImagesQuiChargent(): void {
  if (typeof document === 'undefined') return;
  const marquer = (e: Event) => {
    if (e.target instanceof HTMLImageElement) e.target.setAttribute('data-image-chargee', '');
  };
  document.addEventListener('load', marquer, true);
  document.addEventListener('error', marquer, true);
  new MutationObserver((changements) => {
    for (const c of changements) {
      const image = c.target;
      if (image instanceof HTMLImageElement && !image.complete) image.removeAttribute('data-image-chargee');
    }
  }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['src'] });
}
