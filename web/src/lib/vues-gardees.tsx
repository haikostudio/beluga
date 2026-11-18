import * as React from 'react';

/**
 * LES ONGLETS INSTANTANÉS (décision de l'utilisateur du 13/11/2026 : « si je clique sur un onglet, ça ne doit pas
 * changer de page, je dois voir la page instantanément s'afficher comme dans une fenêtre d'onglet »).
 *
 * Avant, un onglet n'était qu'une ADRESSE : le toucher jetait l'écran affiché et reconstruisait l'autre de zéro —
 * téléchargement du morceau, silhouette grise, nouvelle demande au serveur. Désormais chaque écran déjà AFFICHÉ reste
 * MONTÉ, caché, tant que son onglet est ouvert : y revenir le montre d'un coup, tel qu'on l'a laissé (défilement,
 * brouillon, liste dépliée). L'adresse reste la seule source de l'onglet ACTIF ; seul le RENDU change.
 *
 * DEUX RÈGLES DE SOBRIÉTÉ :
 *  - un écran jamais affiché n'est jamais monté (« un écran qu'on n'a pas ouvert ne se télécharge pas ») ;
 *  - au-delà de `plafond` écrans gardés, le moins récemment regardé est démonté (il se reconstruira au retour).
 *
 * L'ORDRE DE RENDU NE BOUGE JAMAIS (ordre d'arrivée) : déplacer une page qui porte un portail la ferait remonter.
 */
export const PLAFOND_DE_VUES_GARDEES = 6;

export function useVuesGardees(courante: string | null, garder: (cle: string) => boolean, plafond = PLAFOND_DE_VUES_GARDEES): string[] {
  const ordre = React.useRef<string[]>([]);
  const recence = React.useRef(new Map<string, number>());
  const horloge = React.useRef(0);
  if (courante) recence.current.set(courante, ++horloge.current);
  let liste = ordre.current.filter((cle) => cle === courante || garder(cle));
  if (courante && !liste.includes(courante)) liste = [...liste, courante];
  while (liste.length > plafond) {
    const plusAncienne = liste
      .filter((cle) => cle !== courante)
      .reduce<string | null>((a, b) => (a === null || (recence.current.get(b) ?? 0) < (recence.current.get(a) ?? 0) ? b : a), null);
    if (!plusAncienne) break;
    liste = liste.filter((cle) => cle !== plusAncienne);
  }
  for (const cle of [...recence.current.keys()]) if (!liste.includes(cle)) recence.current.delete(cle);
  ordre.current = liste;
  return liste;
}

/**
 * LES ÉCRANS DE LA ZONE CENTRALE, GARDÉS. `children` est l'écran de la clé courante ; les autres rejouent le dernier
 * élément qu'ils ont rendu, à l'identique — React n'y touche donc plus (leurs données vivantes, elles, suivent).
 * `envelopper` pose autour de chacun ce qui dépend de sa visibilité (les emplacements de la barre et du bas, coupés
 * pour un écran caché) : il rend TOUJOURS la même forme, pour que montrer ou cacher ne remonte rien.
 */
export function VuesGardees({
  cle,
  garder,
  plafond,
  envelopper,
  children,
}: {
  cle: string;
  garder: (cle: string) => boolean;
  plafond?: number;
  envelopper: (cle: string, visible: boolean, contenu: React.ReactNode) => React.ReactNode;
  children: React.ReactNode;
}) {
  const contenus = React.useRef(new Map<string, React.ReactNode>());
  const cles = useVuesGardees(cle, garder, plafond);
  contenus.current.set(cle, children);
  for (const ancienne of [...contenus.current.keys()]) if (!cles.includes(ancienne)) contenus.current.delete(ancienne);
  return (
    <>
      {cles.map((c) => (
        <React.Fragment key={c}>{envelopper(c, c === cle, contenus.current.get(c))}</React.Fragment>
      ))}
    </>
  );
}
