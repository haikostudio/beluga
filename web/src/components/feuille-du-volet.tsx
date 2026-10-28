/**
 * LE VOLET DE DROITE DEVIENT UNE FEUILLE DU BAS SUR TÉLÉPHONE (demande du
 * 25/10/2026, capture #f41f) : tout ce que l'ordinateur ouvre à droite de la
 * conversation — plan, suivi de production, montage, aperçu du site — monte
 * sur téléphone dans un tiroir haut, la conversation restant visible derrière
 * un voile. Jamais plus en page entière.
 *
 * Ce n'est PAS le `Drawer feuille` des écrans : celui-ci démonte son contenu
 * une fois fermé (portail Radix), alors que l'emplacement du document doit
 * rester TOUJOURS monté (le plan y est rendu par portail, sinon il retombe
 * dans le fil). La page de la carte habille donc son propre volet — le même
 * élément sur ordinateur et sur téléphone — avec ce cadre-ci.
 *
 * On le referme en touchant le voile, en tirant la poignée (ou la bande du
 * haut) vers le bas, par Échap, ou par la flèche de l'en-tête de la page. Le
 * glissement ne part JAMAIS du contenu : le Studio de montage y a ses propres
 * gestes.
 */
import * as React from 'react';
import { X } from 'lucide-react';
import { t } from '@/lib/langue';
import { useTelephone } from '@/lib/telephone';
import { cn } from '@/lib/utils';

/** La hauteur de la feuille : haute, mais elle laisse voir la page au-dessus. */
const HAUTEUR_DE_FEUILLE = 'calc(92dvh - var(--clavier, 0px))';

/** Les classes du cadre posé sur le volet quand il est une feuille. */
export const CLASSE_FEUILLE_DU_VOLET =
  'fixed inset-x-0 z-50 flex flex-col overflow-hidden rounded-t-xl bg-surface shadow-[0_-10px_30px_-12px_rgba(0,0,0,0.55)] animate-slide-sheet';

export function useFeuilleDuVolet(ouverte: boolean, onFermer: () => void) {
  const [decalage, setDecalage] = React.useState(0);
  const depart = React.useRef<number | null>(null);
  const fermer = React.useRef(onFermer);
  fermer.current = onFermer;

  React.useEffect(() => {
    if (!ouverte) return;
    setDecalage(0);
    const touche = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      /* Une fenêtre ou un menu posés PAR-DESSUS (visionneuse, menu « … ») prennent
         Échap pour eux seuls : la feuille dessous reste ouverte. */
      if (document.querySelector('[role="dialog"][data-state="open"], [role="menu"][data-state="open"], [role="listbox"]')) return;
      fermer.current();
    };
    window.addEventListener('keydown', touche);
    return () => window.removeEventListener('keydown', touche);
  }, [ouverte]);

  const tirer = {
    onPointerDown: (event: React.PointerEvent) => {
      if ((event.target as Element).closest('button:not([data-poignee-du-volet])')) return;
      depart.current = event.clientY;
      try {
        (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
      } catch {
        /* rien à capturer : les écouteurs suffisent */
      }
    },
    onPointerMove: (event: React.PointerEvent) => {
      if (depart.current === null) return;
      setDecalage(Math.max(0, event.clientY - depart.current));
    },
    onPointerUp: () => {
      if (depart.current === null) return;
      depart.current = null;
      const tire = decalage;
      setDecalage(0);
      if (tire > 110) fermer.current();
    },
  };

  const style: React.CSSProperties = {
    bottom: 'var(--clavier, 0px)',
    height: HAUTEUR_DE_FEUILLE,
    paddingBottom: 'var(--zone-sure-bas, 0px)',
    transform: decalage ? `translateY(${decalage}px)` : undefined,
    transition: depart.current === null ? 'transform 180ms ease-out' : undefined,
    ['--fond-zone-defilement' as string]: 'hsl(var(--surface))',
  };

  return { tirer, style };
}

/** Le voile derrière la feuille : un appui le referme, rien de dessous ne réagit. */
export function VoileDuVolet({ onFermer }: { onFermer: () => void }) {
  return (
    <div
      data-voile-tiroir
      data-voile-du-volet
      aria-hidden
      onClick={(event) => {
        event.stopPropagation();
        onFermer();
      }}
      className="fixed inset-0 z-50 animate-fade-in bg-voile/70"
    />
  );
}

/**
 * La bande du haut de la feuille : la poignée au centre, et une croix à droite
 * quand le document n'a pas déjà la sienne (le plan en porte une).
 */
export function PoigneeDuVolet({
  tirer,
  onFermer,
  croix,
}: {
  tirer: ReturnType<typeof useFeuilleDuVolet>['tirer'];
  onFermer: () => void;
  croix: boolean;
}) {
  return (
    <div
      {...tirer}
      onPointerCancel={tirer.onPointerUp}
      data-bande-du-volet
      className="relative flex h-8 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
    >
      <button
        type="button"
        data-poignee-du-volet
        aria-label="Fermer"
        onClick={onFermer}
        className="h-1 w-10 rounded-full bg-muted transition-colors hover:bg-text"
      />
      {croix ? (
        <button
          type="button"
          data-fermer-le-volet
          aria-label="Fermer"
          onClick={onFermer}
          className="absolute right-2 top-1 flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-raised hover:text-text"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

/**
 * LA CROIX D'UN VOLET DE DROITE, SUR ORDINATEUR (28/10/2026 : « un bouton pour
 * fermer le volet, et ça doit être le cas pour tous les volets que tu ouvres à
 * droite »). La même que celle du plan (`data-fermer-le-plan`), posée au bout
 * de la ligne de titre du suivi, des studios photo et son et de la page
 * Téléchargement. Sur téléphone, le volet est une feuille du bas dont la bande
 * porte déjà sa croix (`PoigneeDuVolet`) : celle-ci ne s'y montre pas.
 */
export function CroixDuVolet({ genre, onFermer, className }: { genre: string; onFermer: () => void; className?: string }) {
  const telephone = useTelephone();
  if (telephone) return null;
  return (
    <button
      type="button"
      onClick={onFermer}
      title={t('Fermer le volet')}
      aria-label="Fermer le volet"
      data-croix-du-volet={genre}
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-text',
        className,
      )}
    >
      <X className="h-4 w-4" />
    </button>
  );
}
