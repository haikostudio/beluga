import * as React from 'react';

/** Le temps de passer au champ suivant avant de tout retirer (`focusout`). */
const DELAI_DE_RETRAIT_MS = 150;
/** Deux lignes : le champ ne descend jamais plus bas, même sous un très grand clavier. */
const HAUTEUR_MIN_DU_CHAMP = 44;

/**
 * LA BARRE D'ÉCRITURE PASSE PAR-DESSUS LE PIED, CLAVIER OUVERT (décision du
 * 27/10/2026, captures #f3e9 et #a596c). Sur téléphone, le clavier rétrécit
 * l'application (`--clavier`, posée par `app.tsx`) mais l'en-tête et les blocs
 * collés sous le fil (« Ce que l'agent a vu », la décision, les suggestions…)
 * gardent leur taille : la barre d'écriture, au bout de la colonne, finissait
 * écrasée ou entièrement cachée sous le clavier.
 *
 * Tant que le champ d'écriture DE CET ÉCRAN a le curseur et que le clavier est
 * ouvert, l'écran porte `data-ecriture-au-clavier` et sa hauteur
 * (`--hauteur-ecran-au-clavier`) : `styles.css` colle alors la barre au bas de
 * l'écran, par-dessus les blocs qui ne tiennent plus — ils ne bougent ni ne se
 * replient, ils sont seulement recouverts. Le champ quitté, l'attribut tombe et
 * tout reprend sa place exacte.
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
      noeud.style.removeProperty('--hauteur-ecran-au-clavier');
      noeud.style.removeProperty('--hauteur-max-du-champ');
    };
    const lire = () => {
      const clavier = parseFloat(racine.style.getPropertyValue('--clavier')) || 0;
      const actifDansLeChamp = !!document.activeElement?.closest?.('[data-champ-d-ecriture]');
      const dansCetEcran = actifDansLeChamp && noeud.contains(document.activeElement);
      if (!dansCetEcran || clavier <= 0) return retirer();
      /* La barre colle au bas sans jamais sortir de son pied : sa hauteur
         utile est celle de l'écran, moins ce qui précède le pied et ne se
         réduit pas (la barre d'étapes) — le fil, lui, tombe à rien. */
      const pied = noeud.querySelector<HTMLElement>(':scope > [data-pied-de-conversation]');
      let fixeAuDessus = 0;
      for (const enfant of Array.from(noeud.children) as HTMLElement[]) {
        if (enfant === pied) break;
        if (getComputedStyle(enfant).flexGrow === '0') fixeAuDessus += enfant.offsetHeight;
      }
      const hauteur = Math.max(0, noeud.clientHeight - fixeAuDessus);
      noeud.style.setProperty('--hauteur-ecran-au-clavier', `${hauteur}px`);
      noeud.setAttribute('data-ecriture-au-clavier', '');
      /* LE CHAMP NE SORT JAMAIS DE L'ÉCRAN : ce qui l'entoure dans la barre
         (témoin, boutons, marges) garde sa hauteur, la rangée d'action peut
         tomber à rien, et le champ prend le reste — il défile en lui-même
         au-delà. Mesuré marque posée, donc avec la barre telle qu'elle est. */
      const barre = noeud.querySelector<HTMLElement>(':scope > [data-pied-de-conversation] > [data-composer]');
      const zone = barre?.querySelector<HTMLElement>('[data-champ-d-ecriture] textarea');
      if (!barre || !zone) return;
      const rangee = barre.querySelector<HTMLElement>(':scope > [data-rangee-principale]');
      const autour = barre.scrollHeight - zone.offsetHeight - (rangee?.offsetHeight ?? 0);
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
