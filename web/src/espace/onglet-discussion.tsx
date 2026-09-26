/**
 * L'ONGLET « DISCUSSION », EN BAS DU TABLEAU, ET SA FENÊTRE FLOTTANTE.
 *
 * La discussion avait son bouton dans l'entête et s'ouvrait dans le volet de
 * droite, qui repoussait les colonnes. Elle devient un ONGLET posé dans une
 * bande en bas du tableau : un clic ouvre une fenêtre flottante accrochée juste
 * AU-DESSUS de lui, les colonnes ne bougent pas.
 *
 * L'ONGLET SE GLISSE, À L'HORIZONTALE SEULEMENT. On le pousse là où il ne cache
 * rien d'utile. Le geste est celui de toute l'application (`usePointerDrag`,
 * `@/lib/dnd`) : seule la coordonnée X du pointeur est lue, la verticale est
 * ignorée, et la position reste bornée à la largeur de la bande. Elle se garde
 * en FRACTION de la course — une position en pixels ne voudrait plus rien dire
 * sur un écran d'une autre taille — et revient d'une visite à l'autre.
 *
 * IL NE COLLE JAMAIS AU BORD. La course s'arrête, des deux côtés, à la marge du
 * menu principal du bas (`px-3` de `nav[data-menu-bas]`, 12 px) : posé à droite
 * par défaut, l'onglet garde le même retrait que le menu, au lieu de toucher le
 * bord de l'écran.
 *
 * SUR TÉLÉPHONE, UNE ICÔNE SEULE. Le libellé prenait 132 px d'une bande de
 * 390 ; l'onglet devient un bouton rond de 40 px, nommé pour les lecteurs
 * d'écran. Sur ordinateur, le libellé reste.
 *
 * UN CLIC N'EST PAS UN GLISSEMENT. `usePointerDrag` ne démarre qu'au-delà de
 * quelques pixels ; et le clic que le navigateur émet à la fin d'un vrai
 * glissement est avalé, sans quoi lâcher l'onglet ouvrirait la fenêtre.
 *
 * LA FENÊTRE NE SORT JAMAIS DE L'ÉCRAN : centrée sur l'onglet, elle est rabattue
 * contre le bord le plus proche ; sur téléphone, elle prend presque toute la
 * largeur.
 */
import * as React from 'react';
import { MessageSquare } from 'lucide-react';
import { Pastille } from '@/components/ui';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';
import { usePointerDrag, type DropTarget } from '@/lib/dnd';
import { useTelephone } from '@/lib/telephone';

/** La largeur de l'onglet avec son libellé, sur ordinateur. */
const LARGEUR_ONGLET = 132;
/** La largeur de l'onglet réduit à son icône, sur téléphone. */
const LARGEUR_ONGLET_ICONE = 40;
/** La hauteur de la bande qui porte l'onglet. */
const HAUTEUR_BANDE = 44;
/** La largeur de la fenêtre sur un écran qui a la place. */
const LARGEUR_FENETRE = 380;
/** La marge gardée entre la fenêtre et les bords. */
const MARGE = 8;
/** Le retrait de l'onglet au bord : celui du menu principal du bas (`px-3`). */
export const MARGE_BORD_ONGLET = 12;

const CLE_POSITION = 'beluga.espace.onglet-discussion';

function borner(valeur: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, valeur));
}

/** La position gardée : une fraction entre 0 et 1, à droite par défaut. */
function positionGardee(): number {
  const lue = Number(window.localStorage.getItem(CLE_POSITION));
  return window.localStorage.getItem(CLE_POSITION) !== null && Number.isFinite(lue) ? borner(lue, 0, 1) : 1;
}

/** La gauche de l'onglet : la course s'arrête à la marge du bord, des deux côtés. */
export function gaucheDeLOnglet(largeur: number, fraction: number, largeurOnglet = LARGEUR_ONGLET): number {
  return MARGE_BORD_ONGLET + Math.max(0, largeur - largeurOnglet - 2 * MARGE_BORD_ONGLET) * fraction;
}

/**
 * OÙ POSER LA FENÊTRE : centrée sur l'onglet, puis rabattue dans la bande.
 * Rend sa gauche et sa largeur, en pixels, pour une bande de `largeur`.
 */
export function placeDeLaFenetre(
  largeur: number,
  fraction: number,
  largeurOnglet = LARGEUR_ONGLET,
): { gauche: number; largeur: number } {
  const largeurFenetre = Math.max(0, Math.min(LARGEUR_FENETRE, largeur - 2 * MARGE));
  const centre = gaucheDeLOnglet(largeur, fraction, largeurOnglet) + largeurOnglet / 2;
  const gauche = borner(centre - largeurFenetre / 2, MARGE, Math.max(MARGE, largeur - largeurFenetre - MARGE));
  return { gauche, largeur: largeurFenetre };
}

export function OngletDiscussion({
  nonLus,
  ouverte,
  onBasculer,
  onFermer,
  children,
}: {
  nonLus: number;
  ouverte: boolean;
  onBasculer: () => void;
  onFermer: () => void;
  /** Le contenu de la fenêtre : le fil de discussion. */
  children: React.ReactNode;
}) {
  const telephone = useTelephone();
  const largeurOnglet = telephone ? LARGEUR_ONGLET_ICONE : LARGEUR_ONGLET;
  const bande = React.useRef<HTMLDivElement | null>(null);
  const [largeur, setLargeur] = React.useState(0);
  const [fraction, setFraction] = React.useState(positionGardee);
  /** Où l'onglet a été saisi : sans ce décalage, il sauterait sous le pointeur. */
  const prise = React.useRef(0);
  /** Le clic qui suit un glissement est avalé. */
  const vientDeGlisser = React.useRef(false);

  React.useEffect(() => {
    const zone = bande.current;
    if (!zone) return;
    const mesurer = () => setLargeur(zone.getBoundingClientRect().width);
    mesurer();
    const observateur = new ResizeObserver(mesurer);
    observateur.observe(zone);
    return () => observateur.disconnect();
  }, []);

  // Une seule surface possible : la bande. `usePointerDrag` n'a qu'à suivre.
  const resolve = React.useCallback(
    (): DropTarget => ({ id: 'bande-discussion', kind: 'bande', position: 'inside' }),
    [],
  );
  const onDrop = React.useCallback(() => {
    vientDeGlisser.current = true;
  }, []);
  const { dragging, pointer, start } = usePointerDrag({ resolve, onDrop });

  // LA SEULE COORDONNÉE LUE EST X : la verticale du pointeur n'entre nulle part.
  React.useEffect(() => {
    if (!dragging || !pointer || !bande.current) return;
    const boite = bande.current.getBoundingClientRect();
    const course = Math.max(1, boite.width - largeurOnglet - 2 * MARGE_BORD_ONGLET);
    setFraction(borner((pointer.x - boite.left - MARGE_BORD_ONGLET - prise.current) / course, 0, 1));
  }, [dragging, pointer, largeurOnglet]);

  React.useEffect(() => {
    if (!dragging) window.localStorage.setItem(CLE_POSITION, String(Math.round(fraction * 1000) / 1000));
  }, [dragging, fraction]);

  // Échap referme la fenêtre — sauf quand un tiroir est ouvert par-dessus : c'est lui qu'Échap vise.
  React.useEffect(() => {
    if (!ouverte) return;
    const touche = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('[role="dialog"]')) return;
      onFermer();
    };
    window.addEventListener('keydown', touche);
    return () => window.removeEventListener('keydown', touche);
  }, [ouverte, onFermer]);

  const gaucheOnglet = gaucheDeLOnglet(largeur, fraction, largeurOnglet);
  const fenetre = placeDeLaFenetre(largeur, fraction, largeurOnglet);

  return (
    <>
      {ouverte && largeur ? (
        <div
          className="absolute z-30 flex flex-col overflow-hidden rounded-xl border border-faint/40 bg-surface shadow-2xl"
          style={{
            left: fenetre.gauche,
            width: fenetre.largeur,
            bottom: HAUTEUR_BANDE + 4,
            height: `min(540px, calc(100% - ${HAUTEUR_BANDE + 64}px))`,
          }}
          data-fenetre-discussion
        >
          {children}
        </div>
      ) : null}

      <div ref={bande} className="relative shrink-0" style={{ height: HAUTEUR_BANDE }} data-bande-discussion>
        <button
          type="button"
          onPointerDown={(event) => {
            prise.current = event.clientX - event.currentTarget.getBoundingClientRect().left;
            start(event, { id: 'onglet-discussion', kind: 'onglet', label: t('Discussion') });
          }}
          onClick={() => {
            if (vientDeGlisser.current) {
              vientDeGlisser.current = false;
              return;
            }
            onBasculer();
          }}
          className={cn(
            'absolute top-1/2 flex -translate-y-1/2 touch-none select-none items-center justify-center gap-1.5 text-[13px] font-medium shadow-md transition-colors',
            /* L'ONGLET PORTE UN LIBELLÉ SUR GRAND ÉCRAN : il prend donc l'arrondi
               maison. Sur téléphone il se réduit à une icône dans un carré —
               une forme réellement ronde, qui garde `rounded-full`. */
            telephone ? 'h-10 rounded-full' : 'rounded-lg px-3 py-1.5',
            ouverte ? 'bg-accent text-accent-fg' : 'bg-raised text-text hover:bg-raised/80',
            dragging ? 'cursor-grabbing' : 'cursor-grab',
          )}
          style={{ left: gaucheOnglet, width: largeurOnglet }}
          aria-expanded={ouverte}
          /* UN REPÈRE NE SE TRADUIT PAS : il doit être le même dans les cinq langues. */
          aria-label="Discussion"
          title={telephone ? t('Discussion') : undefined}
          data-onglet-discussion
          data-onglet-icone={telephone ? '' : undefined}
          data-position={Math.round(fraction * 1000) / 1000}
          data-ouverte={ouverte ? '' : undefined}
          data-alerte={nonLus || undefined}
        >
          <MessageSquare className="h-4 w-4 shrink-0" />
          {telephone ? null : <span className="truncate">{t('Discussion')}</span>}
          {/* CE QUI EST À LIRE EST BLEU : la pastille commune, sur le coin du bouton. */}
          <Pastille nombre={nonLus} ton="lire" position="coin" data-non-lus-discussion={nonLus || undefined} />
        </button>
      </div>
    </>
  );
}
