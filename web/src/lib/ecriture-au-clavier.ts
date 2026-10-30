import * as React from 'react';

/** Le temps de passer au champ suivant avant de tout retirer (`focusout`). */
const DELAI_DE_RETRAIT_MS = 150;
/** Deux lignes : le champ ne descend jamais plus bas, même sous un très grand clavier. */
const HAUTEUR_MIN_DU_CHAMP = 44;
/** La part du fil qui reste visible au-dessus de la barre, même champ très long. */
const BANDE_DE_FIL = 64;

/**
 * LA BARRE D'ÉCRITURE SE POSE SUR LE CLAVIER (décision du 30/10/2026, capture
 * #8dff ; remplace le recouvrement « sticky » du 27/10/2026). Sur téléphone, le
 * clavier ouvert donne à l'application la hauteur visible (`--hauteur-visible`,
 * posée par `app.tsx`) ; il reste à libérer la place pour écrire.
 *
 * Tant que le champ d'écriture DE CET ÉCRAN a le curseur et que le clavier est
 * ouvert, l'écran porte `data-ecriture-au-clavier` : `styles.css` efface alors
 * les blocs du pied, la rangée « Annuler / Auto » et la barre des messages en
 * attente, et la barre d'écriture — dernier bloc de la colonne — se pose sur le
 * clavier. Le champ est plafonné à la place restante
 * (`--hauteur-max-du-champ`) et défile en lui-même au-delà. Le champ quitté,
 * l'attribut tombe et tout reprend sa place exacte.
 *
 * Aucun second suivi du clavier : on lit `--clavier`, la seule mesure de
 * l'application, une image APRÈS que `app.tsx` l'a posée (ses écouteurs sont
 * branchés après les nôtres : un effet d'enfant passe avant celui du parent).
 */
export function useEcritureAuClavier(actif: boolean, ecran: React.RefObject<HTMLElement | null>, cle?: string) {
  React.useEffect(() => {
    const noeud = ecran.current;
    if (!actif || !noeud) return;
    const vue = window.visualViewport;
    const racine = document.documentElement;
    let image = 0;
    let retrait = 0;

    const retirer = () => {
      noeud.removeAttribute('data-ecriture-au-clavier');
      noeud.style.removeProperty('--hauteur-max-du-champ');
    };
    const lire = () => {
      const clavier = parseFloat(racine.style.getPropertyValue('--clavier')) || 0;
      const actifDansLeChamp = !!document.activeElement?.closest?.('[data-champ-d-ecriture]');
      const dansCetEcran = actifDansLeChamp && noeud.contains(document.activeElement);
      if (!dansCetEcran || clavier <= 0) return retirer();
      noeud.setAttribute('data-ecriture-au-clavier', '');
      /* LE CHAMP NE SORT JAMAIS DE L'ÉCRAN : la hauteur utile est celle de
         l'écran moins ce qui précède le pied et ne se réduit pas (la barre
         d'étapes), moins ce qui entoure le champ dans la barre (témoin,
         pièces, boutons, marges) et une bande de fil. Mesuré marque posée,
         donc avec la barre telle qu'elle est. */
      const pied = noeud.querySelector<HTMLElement>(':scope > [data-pied-de-conversation]');
      let fixeAuDessus = 0;
      for (const enfant of Array.from(noeud.children) as HTMLElement[]) {
        if (enfant === pied) break;
        if (getComputedStyle(enfant).flexGrow === '0') fixeAuDessus += enfant.offsetHeight;
      }
      const hauteur = Math.max(0, noeud.clientHeight - fixeAuDessus - BANDE_DE_FIL);
      const barre = pied?.querySelector<HTMLElement>(':scope > [data-composer]');
      const zone = barre?.querySelector<HTMLElement>('[data-champ-d-ecriture] textarea');
      if (!barre || !zone) return;
      const autour = barre.offsetHeight - zone.offsetHeight;
      noeud.style.setProperty('--hauteur-max-du-champ', `${Math.max(HAUTEUR_MIN_DU_CHAMP, hauteur - autour)}px`);
    };
    const plusTard = () => {
      window.cancelAnimationFrame(image);
      image = window.requestAnimationFrame(lire);
    };
    const entree = () => {
      window.clearTimeout(retrait);
      plusTard();
    };
    const sortie = () => {
      window.clearTimeout(retrait);
      retrait = window.setTimeout(lire, DELAI_DE_RETRAIT_MS);
    };

    lire();
    vue?.addEventListener('resize', plusTard);
    vue?.addEventListener('scroll', plusTard);
    window.addEventListener('resize', plusTard);
    noeud.addEventListener('focusin', entree);
    noeud.addEventListener('focusout', sortie);
    noeud.addEventListener('input', plusTard);
    return () => {
      window.cancelAnimationFrame(image);
      window.clearTimeout(retrait);
      vue?.removeEventListener('resize', plusTard);
      vue?.removeEventListener('scroll', plusTard);
      window.removeEventListener('resize', plusTard);
      noeud.removeEventListener('focusin', entree);
      noeud.removeEventListener('focusout', sortie);
      noeud.removeEventListener('input', plusTard);
      retirer();
    };
  }, [actif, ecran, cle]);
}
