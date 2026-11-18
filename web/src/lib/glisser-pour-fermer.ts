/**
 * LE GESTE COMMUN DE TOUTES LES FEUILLES DU BAS : on les tire vers le bas pour
 * les refermer (demande du 31/10/2026 : « si le doigt glisse vers le bas dans
 * les 100 px du haut, ça doit entraîner le tiroir afin de le fermer »).
 *
 * Deux chemins, un seul décalage :
 *
 * - AU DOIGT, toute la BANDE DU HAUT de la feuille (`BANDE_DE_PRISE` px depuis
 *   son bord haut réel) est une prise. Le geste ne se décide qu'au-delà de
 *   `SEUIL_D_INTENTION` px, et seulement s'il part VERS LE BAS : un appui court
 *   reste un appui (les boutons de la bande marchent), un geste vers le haut ou
 *   de côté reste au navigateur (défilement). Une fois décidé, le geste est
 *   gardé (`touchmove` non passif — sans quoi Safari iPhone fait rebondir la
 *   page dessous) et le clic qui suivrait le lâcher est avalé. Plus bas que la
 *   bande, rien ne change : le doigt fait défiler le contenu.
 * - À LA SOURIS (et au stylet hors écran tactile), seule la POIGNÉE tire, comme
 *   avant : `poignee` s'étale sur elle.
 *
 * Lâchée au-delà de `SEUIL_DE_FERMETURE` px (ou lancée assez vite vers le bas),
 * la feuille poursuit sa course jusqu'en bas, PUIS se referme par `fermer` ;
 * sinon elle remonte en place.
 *
 * Un élément qui a un geste à lui au doigt (`touch-none`, curseur, ou marqué
 * `data-sans-glisser-pour-fermer`) n'est jamais pris, même dans la bande.
 */
import * as React from 'react';

export const BANDE_DE_PRISE = 100;
const SEUIL_D_INTENTION = 8;
const SEUIL_DE_FERMETURE = 110;
/** Un lancer : px par milliseconde vers le bas, sur la fin du geste. */
const VITESSE_DE_LANCER = 0.6;

type Geste = {
  x: number;
  y: number;
  engage: boolean;
  dernierY: number;
  dernierT: number;
  vitesse: number;
};

/** Avale le clic qui suit un glisser engagé : il ne tombe sur aucun bouton. */
function avalerLeClicSuivant() {
  const avaler = (event: Event) => {
    /* Le clic d'un programme n'est pas celui du doigt : c'est souvent la fermeture elle-même (`fermer` qui clique le bouton d'une fenêtre). */
    if (!event.isTrusted) return;
    event.stopPropagation();
    event.preventDefault();
    retirer();
  };
  const minuterie = window.setTimeout(retirer, 450);
  function retirer() {
    window.clearTimeout(minuterie);
    window.removeEventListener('click', avaler, true);
  }
  window.addEventListener('click', avaler, true);
}

/** La durée de la sortie au doigt, depuis la position du lâcher jusqu'au bas. */
const DUREE_DE_SORTIE = 180;
/** Une feuille encore ouverte ce délai après `fermer` revient en place. */
const DELAI_DE_RETOUR = 450;

export function useGlisserPourFermer(fermer: () => void, actif = true) {
  const [feuille, setFeuille] = React.useState<HTMLElement | null>(null);
  const fermerRef = React.useRef(fermer);
  fermerRef.current = fermer;
  const actifRef = React.useRef(actif);
  actifRef.current = actif;
  const decalageRef = React.useRef(0);
  const sortie = React.useRef(false);
  const image = React.useRef(0);

  /*
   * LE DÉCALAGE S'ÉCRIT SUR L'ÉLÉMENT, JAMAIS PAR UN RENDU (31/10/2026 : « la
   * fermeture n'est pas du tout fluide ») : un rendu React à chaque mouvement
   * du doigt faisait courir la feuille derrière lui. Le style React de la
   * feuille ne porte donc JAMAIS `transform` : rien ne l'écrase en plein geste.
   */
  const ecrire = React.useCallback(
    (valeur: number | string, transition: string) => {
      if (!feuille) return;
      feuille.style.transition = transition;
      feuille.style.transform = valeur === 0 ? '' : typeof valeur === 'number' ? `translateY(${valeur}px)` : valeur;
    },
    [feuille],
  );
  const poser = React.useCallback(
    (valeur: number) => {
      decalageRef.current = valeur;
      if (image.current) return;
      image.current = window.requestAnimationFrame(() => {
        image.current = 0;
        if (!sortie.current) ecrire(decalageRef.current, 'none');
      });
    },
    [ecrire],
  );
  const revenir = React.useCallback(() => {
    window.cancelAnimationFrame(image.current);
    image.current = 0;
    decalageRef.current = 0;
    ecrire(0, `transform ${DUREE_DE_SORTIE}ms ease-out`);
  }, [ecrire]);

  /*
   * LA SORTIE CONTINUE DEPUIS LE DOIGT : lâchée assez bas, la feuille poursuit
   * sa course jusqu'en bas, PUIS se referme. Avant, elle remontait d'abord à 0
   * (le retour animé), et l'animation de fermeture repartait de 0 : la feuille
   * semblait remonter avant de disparaître. `--decalage-feuille` à 100 % fait
   * partir l'animation de fermeture (`slide-sheet-out`) d'en bas : elle ne
   * rejoue rien. Une fermeture refusée (la feuille encore là) la fait revenir.
   */
  const sortir = React.useCallback(() => {
    if (!feuille) return;
    window.cancelAnimationFrame(image.current);
    image.current = 0;
    sortie.current = true;
    let finie = false;
    const finir = () => {
      if (finie) return;
      finie = true;
      feuille.removeEventListener('transitionend', surFin);
      window.clearTimeout(secours);
      feuille.style.setProperty('--decalage-feuille', '100%');
      fermerRef.current();
      window.setTimeout(() => {
        const encoreLa = feuille.isConnected && actifRef.current && feuille.getAttribute('data-state') !== 'closed';
        if (!encoreLa) return;
        sortie.current = false;
        feuille.style.removeProperty('--decalage-feuille');
        revenir();
      }, DELAI_DE_RETOUR);
    };
    const surFin = (event: TransitionEvent) => {
      if (event.target === feuille && event.propertyName === 'transform') finir();
    };
    const secours = window.setTimeout(finir, DUREE_DE_SORTIE + 80);
    feuille.addEventListener('transitionend', surFin);
    /* Le décalage courant est déjà posé : la transition part de lui. */
    feuille.style.transform = `translateY(${decalageRef.current}px)`;
    void feuille.offsetHeight;
    ecrire('translateY(100%)', `transform ${DUREE_DE_SORTIE}ms ease-out`);
  }, [feuille, ecrire, revenir]);

  const lacher = React.useCallback(
    (vitesse = 0) => {
      const tire = decalageRef.current;
      if (tire > SEUIL_DE_FERMETURE || (tire > 40 && vitesse > VITESSE_DE_LANCER)) sortir();
      else revenir();
    },
    [sortir, revenir],
  );

  /* AU DOIGT : la bande du haut de la feuille. */
  React.useEffect(() => {
    if (!actif || !feuille) return;
    let geste: Geste | null = null;
    const debut = (event: TouchEvent) => {
      geste = null;
      if (sortie.current || event.touches.length !== 1) return;
      const doigt = event.touches[0];
      if ((doigt as Touch & { touchType?: string }).touchType === 'stylus') return;
      const cible = event.target as Element | null;
      /* Un élément qui a SES gestes au doigt (curseur, ligne de temps, cubes,
         jauge : `touch-none`) les garde, même dans la bande. La poignée, elle
         aussi `touch-none`, reste une prise. */
      const aSesGestes = cible?.closest?.('[data-sans-glisser-pour-fermer], .touch-none, input[type="range"]');
      if (aSesGestes && !aSesGestes.closest('[data-poignee-tiroir]')) return;
      const haut = feuille.getBoundingClientRect().top - decalageRef.current;
      const dedans = doigt.clientY - haut;
      if (dedans < 0 || dedans > BANDE_DE_PRISE) return;
      geste = { x: doigt.clientX, y: doigt.clientY, engage: false, dernierY: doigt.clientY, dernierT: event.timeStamp, vitesse: 0 };
    };
    const mouvement = (event: TouchEvent) => {
      if (!geste) return;
      if (event.touches.length !== 1) {
        if (geste.engage) lacher();
        geste = null;
        return;
      }
      const doigt = event.touches[0];
      const dy = doigt.clientY - geste.y;
      const dx = doigt.clientX - geste.x;
      if (!geste.engage) {
        if (dy > 0 && dy >= Math.abs(dx)) {
          /* Vers le bas : le navigateur ne part pas défiler pendant qu'on décide. */
          if (event.cancelable) event.preventDefault();
          if (dy < SEUIL_D_INTENTION) return;
          geste.engage = true;
        } else {
          /* Vers le haut ou de côté : ce n'est pas pour nous. */
          if (Math.abs(dx) > 3 || dy < -3) geste = null;
          return;
        }
      }
      if (event.cancelable) event.preventDefault();
      const dt = event.timeStamp - geste.dernierT;
      if (dt > 0) geste.vitesse = (doigt.clientY - geste.dernierY) / dt;
      geste.dernierY = doigt.clientY;
      geste.dernierT = event.timeStamp;
      poser(Math.max(0, dy));
    };
    const fin = () => {
      if (geste?.engage) {
        avalerLeClicSuivant();
        lacher(geste.vitesse);
      }
      geste = null;
    };
    feuille.addEventListener('touchstart', debut, { passive: true });
    feuille.addEventListener('touchmove', mouvement, { passive: false });
    feuille.addEventListener('touchend', fin);
    feuille.addEventListener('touchcancel', fin);
    return () => {
      feuille.removeEventListener('touchstart', debut);
      feuille.removeEventListener('touchmove', mouvement);
      feuille.removeEventListener('touchend', fin);
      feuille.removeEventListener('touchcancel', fin);
    };
  }, [actif, feuille, lacher, poser]);

  /* Une feuille qui se ROUVRE (le volet reste monté d'une fois à l'autre)
     repart d'en haut ; une feuille fermée perd son décalage une fois sa
     sortie jouée — jamais avant, l'animation de fermeture en part. */
  React.useEffect(() => {
    if (!feuille) return;
    if (actif) {
      sortie.current = false;
      decalageRef.current = 0;
      feuille.style.removeProperty('--decalage-feuille');
      feuille.style.transform = '';
      feuille.style.transition = '';
      return;
    }
    const minuterie = window.setTimeout(() => {
      feuille.style.transform = '';
      feuille.style.transition = '';
    }, 400);
    return () => window.clearTimeout(minuterie);
  }, [actif, feuille]);

  React.useEffect(() => () => window.cancelAnimationFrame(image.current), []);

  /* À LA SOURIS : la poignée seule. Le doigt, lui, passe par la bande. */
  const depart = React.useRef<number | null>(null);
  const relacher = (event: React.PointerEvent) => {
    if (event.pointerType === 'touch' || depart.current === null) return;
    depart.current = null;
    lacher();
  };
  const poignee = {
    onPointerDown: (event: React.PointerEvent) => {
      if (event.pointerType === 'touch' || sortie.current) return;
      /* Ni sélection de texte ni glisser-déposer natif : un texte déjà
         sélectionné sous la poignée partait sinon en « drag » du navigateur,
         qui coupe les événements de pointeur — la feuille ne suivait plus. */
      event.preventDefault();
      depart.current = event.clientY;
      // Un pointeur qui n'existe pas — un événement fabriqué par un contrôle —
      // fait lever cette capture : le geste ne doit pas mourir pour autant.
      try {
        (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
      } catch {
        /* rien à capturer : les écouteurs suffisent */
      }
    },
    onPointerMove: (event: React.PointerEvent) => {
      if (event.pointerType === 'touch' || depart.current === null) return;
      poser(Math.max(0, event.clientY - depart.current));
    },
    onPointerUp: relacher,
    onPointerCancel: relacher,
  };

  return { feuille: setFeuille as (noeud: HTMLElement | null) => void, poignee };
}

/**
 * Pose un même nœud dans plusieurs références. La fonction rendue est STABLE
 * tant que les références le sont : une nouvelle à chaque rendu ferait
 * repasser la feuille par `null`, et le geste se redéposerait sans fin.
 */
export function useRefsFusionnees<T>(...refs: Array<React.Ref<T> | undefined>): (noeud: T | null) => void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return React.useCallback((noeud: T | null) => {
    for (const ref of refs) {
      if (typeof ref === 'function') ref(noeud);
      else if (ref) (ref as React.MutableRefObject<T | null>).current = noeud;
    }
  }, refs);
}
