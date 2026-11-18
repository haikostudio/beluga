/**
 * LE VOLET DE DROITE DEVIENT UNE FEUILLE DU BAS SUR TÉLÉPHONE (demande du
 * 25/10/2026, capture #f41f) : tout ce que l'ordinateur ouvre à droite de la
 * conversation — plan, suivi de production, montage, aperçu du site — monte
 * sur téléphone dans un tiroir haut, la conversation restant montée derrière
 * un voile. Jamais plus en page entière.
 *
 * Ce n'est PAS le `Drawer feuille` des écrans : celui-ci démonte son contenu
 * une fois fermé (portail Radix), alors que l'emplacement du document doit
 * rester TOUJOURS monté (le plan y est rendu par portail, sinon il retombe
 * dans le fil). La page de la carte habille donc son propre volet — le même
 * élément sur ordinateur et sur téléphone — avec ce cadre-ci.
 *
 * On le referme en touchant le voile, en tirant la poignée vers le bas — au
 * doigt, toute la bande des 100 px du haut, comme toute feuille
 * (`useGlisserPourFermer`, demande du 31/10/2026) —, par Échap, ou par la
 * flèche de l'en-tête de la page. Plus bas, le doigt reste au contenu : le
 * Studio de montage y a ses propres gestes.
 */
import * as React from 'react';
import { X } from '@/components/ui/icones';
import { CLASSE_BARRE_DE_PRISE, CLASSE_COINS_DE_FEUILLE, CLASSE_PRISE_DE_FEUILLE, HAUTEUR_DE_FEUILLE_HAUTE } from '@/components/ui';
import { useGlisserPourFermer } from '@/lib/glisser-pour-fermer';
import { useVoileAffiche } from '@/lib/barre-de-l-heure';
import { t } from '@/lib/langue';
import { useTelephone } from '@/lib/telephone';
import { cn } from '@/lib/utils';

/** La hauteur de la feuille : au même niveau que le menu principal, juste sous la barre de l'heure. */
const HAUTEUR_DE_FEUILLE = HAUTEUR_DE_FEUILLE_HAUTE;

/** Les classes du cadre posé sur le volet quand il est une feuille. */
export const CLASSE_FEUILLE_DU_VOLET = cn(
  'fixed inset-x-0 z-50 flex flex-col overflow-hidden bg-surface shadow-[0_-10px_30px_-12px_rgba(0,0,0,0.55)] animate-slide-sheet',
  CLASSE_COINS_DE_FEUILLE,
);

export function useFeuilleDuVolet(ouverte: boolean, onFermer: () => void) {
  const fermer = React.useRef(onFermer);
  fermer.current = onFermer;
  const glisser = useGlisserPourFermer(() => fermer.current(), ouverte);

  React.useEffect(() => {
    if (!ouverte) return;
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

  const style: React.CSSProperties = {
    bottom: 'var(--clavier, 0px)',
    height: HAUTEUR_DE_FEUILLE,
    paddingBottom: 'var(--marge-bas-hors-clavier, 0px)',
    /* La feuille a compté la marche du bas : son contenu ne la recompte pas. */
    ['--marche-du-bas' as string]: '0px',
    ['--pied-natif' as string]: 'var(--pied-natif-dedans)',
    ['--fond-zone-defilement' as string]: 'hsl(var(--surface))',
  };

  /** `feuille` se pose sur l'élément de la feuille : sa bande du haut se tire au doigt. */
  return { tirer: glisser.poignee, style, feuille: glisser.feuille };
}

/** Le voile derrière la feuille : un appui le referme, rien de dessous ne réagit. */
export function VoileDuVolet({ onFermer }: { onFermer: () => void }) {
  useVoileAffiche();
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
 * La bande du haut de la feuille : la poignée au centre, et RIEN d'autre. La
 * feuille n'existe que sur téléphone, où AUCUN tiroir ne porte de croix
 * (31/10/2026, capture #ecc5) : on la referme en la tirant, par le voile ou
 * par la poignée touchée.
 */
export function PoigneeDuVolet({
  tirer,
  onFermer,
}: {
  tirer: ReturnType<typeof useFeuilleDuVolet>['tirer'];
  onFermer: () => void;
}) {
  return (
    <div
      {...tirer}
      onPointerDown={(event) => {
        tirer.onPointerDown(event);
      }}
      data-bande-du-volet
      data-poignee-tiroir
      className={cn(CLASSE_PRISE_DE_FEUILLE, 'relative h-8 items-center')}
    >
      <button type="button" data-poignee-du-volet aria-label="Fermer" onClick={onFermer} className={CLASSE_BARRE_DE_PRISE} />
    </div>
  );
}

/**
 * LA CROIX D'UN VOLET DE DROITE, SUR ORDINATEUR (28/10/2026 : « un bouton pour
 * fermer le volet, et ça doit être le cas pour tous les volets que tu ouvres à
 * droite »). La même que celle du plan (`data-fermer-le-plan`), posée au bout
 * de la ligne de titre du suivi, des studios photo et son et de la page
 * Téléchargement. Sur téléphone, le volet est une feuille du bas, sans croix
 * (`PoigneeDuVolet`) : celle-ci ne s'y montre pas.
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
