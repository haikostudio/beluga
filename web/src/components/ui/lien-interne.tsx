import * as React from 'react';

/**
 * UN VRAI LIEN POUR TOUT CE QUI MÈNE AILLEURS DANS L'APPLICATION (demande du 03/11/2026, carte « Finitions de l'espace
 * Communication ») : « clic droit → ouvrir dans un nouvel onglet » doit marcher sur une entrée de menu, une marque, une
 * carte, un onglet, un maillon du fil d'Ariane. L'application se pilote par l'adresse en `#…` : un `<a href="#…">`
 * suffit.
 *
 * - Le CLIC GAUCHE SIMPLE garde le chemin de toujours : l'événement natif est retenu (`preventDefault`) et le geste
 *   de l'écran (`onClick`, ou `naviguerVers` à défaut) fait la navigation — aucune double entrée dans l'historique.
 * - Ctrl / Cmd / Maj / Alt, le bouton du MILIEU et le clic droit sont laissés au navigateur : nouvel onglet, nouvelle
 *   fenêtre, menu contextuel. Le geste de l'écran n'est PAS joué.
 * - Les ACTIONS (lancer, valider, supprimer) restent des `<button>` : seul un déplacement devient un lien.
 * - Dans l'application installée, le clic simple ouvre sur place, comme avant.
 */
export type ProprietesDuLien = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  /** Le fragment visé, sans le `#` (`communication/projet:abc/canaux`). */
  adresse: string;
} & Record<`data-${string}`, string | number | boolean | undefined>;

/** Un clic que le navigateur doit garder pour lui (nouvel onglet, nouvelle fenêtre, menu). */
export function clicPourLeNavigateur(event: React.MouseEvent): boolean {
  /* AU DOIGT, PAS DE CLIC « MODIFIÉ » : le relâché d'un appui long arrive avec un autre bouton que le gauche, et ne
     doit jamais passer pour un clic du milieu (onglet neuf, page d'origine figée en arrière-plan). */
  if ((event.nativeEvent as PointerEvent | undefined)?.pointerType === 'touch') return false;
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

/** Aller à une adresse de l'application, comme Précédent / Suivant : l'écran suit l'adresse (`suivreAdresse`). */
export function naviguerVers(adresse: string): void {
  const cible = '#' + adresse.replace(/^#/, '');
  if (window.location.hash !== cible) window.history.pushState(null, '', cible);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export const LienInterne = React.forwardRef<HTMLAnchorElement, ProprietesDuLien>(function LienInterne(
  { adresse, onClick, children, ...reste },
  ref,
) {
  return (
    <a
      ref={ref}
      href={'#' + adresse.replace(/^#/, '')}
      data-lien-interne
      {...reste}
      onClick={(event) => {
        if (clicPourLeNavigateur(event)) {
          /* Le parent (ligne cliquable, glisser) ne doit pas jouer son geste non plus. */
          event.stopPropagation();
          return;
        }
        event.preventDefault();
        if (onClick) onClick(event);
        else naviguerVers(adresse);
      }}
    >
      {children}
    </a>
  );
});
