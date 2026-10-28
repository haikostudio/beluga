import * as React from 'react';
import {
  HAUTEUR_REPLIEE_PAR_DEFAUT,
  PART_DE_L_ECRAN_POUR_LE_PIED,
  blocsARepliers,
  ordreDOuverture,
  type BlocDuPied,
} from '@beluga/shared';

/** Un bloc du pied : sa clé, et s'il se replie (le panneau de décision compte sans se replier). */
export interface BlocSuivi {
  cle: string;
  repliable: boolean;
  /** Toujours déplié : les autres se replient pour lui (`garde`, shared/src/pied-compact.ts). */
  garde?: boolean;
}

interface Hauteurs {
  depliee?: number;
  repliee?: number;
}

/**
 * LE PIED COMPACT DU TÉLÉPHONE (`shared/src/pied-compact.ts`). Rend, pour chaque
 * bloc présent, s'il est replié ; `mesurer(cle)` se pose sur l'enveloppe du
 * bloc pour retenir sa hauteur, `rouvrir(cle)` le déplie et en fait le dernier
 * ouvert. Éteint (ordinateur), rien ne se replie.
 */
export function usePiedCompact(actif: boolean, blocs: readonly BlocSuivi[]) {
  const presents = blocs.map((b) => b.cle);
  const signature = presents.join('|');
  const drapeaux = blocs.map((b) => `${b.repliable ? 'r' : ''}${b.garde ? 'g' : ''}`).join('|');
  const [ordre, setOrdre] = React.useState<string[]>(() => ordreDOuverture([], presents));
  React.useEffect(() => {
    setOrdre((avant) => {
      const apres = ordreDOuverture(avant, presents);
      return apres.join('|') === avant.join('|') ? avant : apres;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  /* Le dernier bloc rouvert D'UN APPUI : seul protégé quand un bloc est gardé. */
  const [rouvertParAppui, setRouvertParAppui] = React.useState<string | null>(null);

  const [hauteurs, setHauteurs] = React.useState<Record<string, Hauteurs>>({});
  const [budget, setBudget] = React.useState(() =>
    typeof window === 'undefined' ? 400 : window.innerHeight * PART_DE_L_ECRAN_POUR_LE_PIED,
  );
  /*
   * LE BUDGET SUIT LA ZONE VISIBLE, HORS FRAPPE. Sur iPhone, seul
   * `visualViewport` change quand la barre du navigateur bouge : la fenêtre ne
   * reçoit aucun `resize`. Mais clavier ouvert (`--clavier`, `app.tsx`), le
   * budget ne bouge pas : les blocs ne se replient pas pendant qu'on écrit, la
   * barre d'écriture passe par-dessus eux (décision du 27/10/2026,
   * `useEcritureAuClavier`). Lu une image plus tard, une fois `--clavier` posée.
   */
  React.useEffect(() => {
    if (!actif) return;
    const vue = window.visualViewport;
    let image = 0;
    const lire = () => {
      const clavier = parseFloat(document.documentElement.style.getPropertyValue('--clavier')) || 0;
      if (clavier > 0) return;
      setBudget((vue?.height ?? window.innerHeight) * PART_DE_L_ECRAN_POUR_LE_PIED);
    };
    const plusTard = () => {
      window.cancelAnimationFrame(image);
      image = window.requestAnimationFrame(lire);
    };
    lire();
    window.addEventListener('resize', plusTard);
    vue?.addEventListener('resize', plusTard);
    return () => {
      window.cancelAnimationFrame(image);
      window.removeEventListener('resize', plusTard);
      vue?.removeEventListener('resize', plusTard);
    };
  }, [actif]);

  const replies = React.useMemo(() => {
    if (!actif) return new Set<string>();
    const mesures: BlocDuPied[] = blocs.map((b) => {
      const h = hauteurs[b.cle] ?? {};
      const repliee = h.repliee ?? HAUTEUR_REPLIEE_PAR_DEFAUT;
      return { cle: b.cle, repliable: b.repliable, garde: b.garde, hauteurRepliee: repliee, hauteurDepliee: h.depliee ?? repliee };
    });
    return new Set(blocsARepliers(mesures, ordre, budget, rouvertParAppui));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actif, signature, drapeaux, hauteurs, ordre, budget, rouvertParAppui]);

  /* Chaque enveloppe est suivie : sa hauteur s'écrit sous l'état où elle a été
     mesurée (repliée ou dépliée), à 2 px près pour ne pas redessiner pour rien. */
  const etatCourant = React.useRef(replies);
  etatCourant.current = replies;
  const observateurs = React.useRef(new Map<string, ResizeObserver>());
  const mesurer = React.useCallback(
    (cle: string) => (noeud: HTMLElement | null) => {
      observateurs.current.get(cle)?.disconnect();
      observateurs.current.delete(cle);
      if (!noeud || typeof ResizeObserver === 'undefined') return;
      const obs = new ResizeObserver(() => {
        const h = noeud.getBoundingClientRect().height;
        const champ: keyof Hauteurs = etatCourant.current.has(cle) ? 'repliee' : 'depliee';
        setHauteurs((avant) => {
          const ancien = avant[cle]?.[champ];
          if (ancien !== undefined && Math.abs(ancien - h) < 2) return avant;
          return { ...avant, [cle]: { ...avant[cle], [champ]: h } };
        });
      });
      obs.observe(noeud);
      observateurs.current.set(cle, obs);
    },
    [],
  );
  React.useEffect(() => () => observateurs.current.forEach((o) => o.disconnect()), []);

  const rouvrir = React.useCallback(
    (cle: string) => {
      setRouvertParAppui(cle);
      setOrdre((avant) => ordreDOuverture(avant, presents, cle));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature],
  );

  return { estReplie: (cle: string) => replies.has(cle), mesurer, rouvrir };
}
