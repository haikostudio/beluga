import * as React from 'react';
import { BulleInfo } from '@/components/ui';
import { t } from '@/lib/langue';

/**
 * UN TEXTE COUPÉ SE LIT EN ENTIER DANS UNE PASTILLE « i ».
 *
 * Le titre d'une carte tient sur deux lignes et sa demande aussi ; au-delà, le
 * texte est replié (`line-clamp`) et la suite se perdait. Ce repère ne paraît
 * QUE quand quelque chose est réellement coupé, et porte alors le texte
 * complet, lisible au survol (souris) ou au toucher.
 *
 * UN SEUL OBSERVATEUR pour toutes les cartes : un tableau en montre des
 * centaines, et un observateur par carte coûterait à chaque redimensionnement.
 * La mesure ne se fait qu'à l'arrivée d'une carte, quand son texte change, ou
 * quand sa largeur bouge.
 */
const rappels = new WeakMap<Element, () => void>();
let observateur: ResizeObserver | null = null;

function observer(element: Element, rappel: () => void): () => void {
  if (typeof ResizeObserver === 'undefined') return () => undefined;
  observateur ??= new ResizeObserver((entrees) => {
    for (const entree of entrees) rappels.get(entree.target)?.();
  });
  rappels.set(element, rappel);
  observateur.observe(element);
  return () => {
    rappels.delete(element);
    observateur?.unobserve(element);
  };
}

/**
 * LA MESURE SE FAIT PAR LOTS. Un texte replié (`line-clamp`) ne dit plus sa
 * vraie hauteur : `scrollHeight` s'arrête à la dernière ligne montrée, et la
 * boîte du contenu ne compte pas non plus les lignes cachées. Pour savoir si
 * quelque chose est coupé, on le DÉPLIE un instant et on compare. Faite carte
 * par carte, cette bascule ferait recalculer la page autant de fois qu'il y a
 * de cartes : toutes les demandes d'une image sont donc traitées ensemble —
 * lire d'abord, déplier tout, relire, tout remettre —, en un seul recalcul et
 * sans que rien ne soit peint entre-temps.
 */
type Demande = { elements: Array<HTMLElement | null>; fin: (coupe: boolean) => void };
let file: Demande[] = [];
let planifie = false;

function vider(): void {
  planifie = false;
  const lot = file;
  file = [];
  const avant = lot.map((d) => d.elements.map((e) => (e ? { ch: e.clientHeight, sh: e.scrollHeight } : null)));
  const remis = lot.map((d) =>
    d.elements.map((e) => {
      if (!e) return null;
      const memoire = { display: e.style.display, pli: e.style.getPropertyValue('-webkit-line-clamp') };
      e.style.display = 'block';
      e.style.setProperty('-webkit-line-clamp', 'unset');
      return memoire;
    }),
  );
  const depliees = lot.map((d) => d.elements.map((e) => (e ? e.scrollHeight : 0)));
  lot.forEach((d, n) =>
    d.elements.forEach((e, k) => {
      const memoire = remis[n][k];
      if (!e || !memoire) return;
      e.style.display = memoire.display;
      if (memoire.pli) e.style.setProperty('-webkit-line-clamp', memoire.pli);
      else e.style.removeProperty('-webkit-line-clamp');
    }),
  );
  lot.forEach((d, n) =>
    d.fin(
      d.elements.some((e, k) => {
        const mesure = avant[n][k];
        return !!e && !!mesure && (mesure.sh > mesure.ch + 1 || depliees[n][k] > mesure.ch + 1);
      }),
    ),
  );
}

function planifier(demande: Demande): void {
  file.push(demande);
  if (planifie) return;
  planifie = true;
  requestAnimationFrame(vider);
}

/**
 * Dit si l'un des éléments mesurés est coupé. Le premier est aussi celui dont
 * la largeur est suivie : c'est elle qui fait passer un texte de deux à trois
 * lignes. `dependances` relance la mesure quand le texte change.
 */
export function useTexteCoupe(
  elements: Array<React.RefObject<HTMLElement | null>>,
  dependances: React.DependencyList,
): boolean {
  const [coupe, setCoupe] = React.useState(false);
  const mesurer = React.useCallback(() => {
    planifier({ elements: elements.map((ref) => ref.current), fin: setCoupe });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    mesurer();
    const suivi = elements[0]?.current;
    return suivi ? observer(suivi, mesurer) : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesurer, ...dependances]);

  return coupe;
}

/**
 * La pastille elle-même. Posée dans une carte cliquable et glissable, elle ne
 * doit ni l'ouvrir ni lancer un déplacement : le clic et l'appui s'arrêtent ici
 * — y compris ceux qui remontent du texte affiché, que l'arbre React rattache
 * à la carte bien qu'il soit posé ailleurs dans la page.
 */
export function BulleTexteCoupe({ children }: { children: React.ReactNode }) {
  return (
    <span
      data-texte-coupe
      className="flex shrink-0 items-center"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <BulleInfo label={t('Voir le texte en entier')} cote="start">
        {children}
      </BulleInfo>
    </span>
  );
}
