/*
 * LA BANDE DU HAUT — une seule forme pour tout ce qui s'annonce au-dessus de l'application (carte « Fin du côté open
 * source », 21/11/2026, maquette #7679b). Décision de l'utilisateur : la bande de l'extension Chrome est LE modèle —
 * pleine largeur, collée au bord du haut, au-dessus de la colonne de gauche et de l'entête, SANS coin arrondi, sans
 * ombre, sans marge autour. Une pastille flottante aux coins arrondis a été refusée : ne jamais la refaire.
 *
 * DEUX GENRES, UNE RÈGLE DE COULEUR :
 *  - « avertissement » : un geste est nécessaire → fond ORANGE (`--banniere-a-faire`), texte presque noir, bouton
 *    presque noir au texte blanc ;
 *  - « information » : rien d'urgent → fond NOIR (`--banniere-info`), texte blanc, bouton blanc au texte noir.
 * La bande sous l'heure de l'iPhone prend la couleur du genre affiché (`styles.css`, `[data-bande-du-haut]`).
 *
 * Elle touche le bord du haut : c'est ELLE qui réserve la zone sûre (`--zone-sure-haut` dans son rembourrage, une
 * seule fois — MEM-2659). Elle MESURE sa hauteur et la pose sur <html> (`--hauteur-banniere`, `--marge-sous-banniere`)
 * pour que les pages fixes partent sous elle ; chaque changement émet `beluga:hauteur-banniere`.
 *
 * Une seule bande à la fois : c'est `BanniereExtension` qui arbitre (l'orange passe avant tout).
 */
import * as React from 'react';
import { ChevronDown, Loader2, X } from '@/components/ui/icones';
import { t } from '@/lib/langue';
import { useTelephone } from '@/lib/telephone';
import { cn } from '@/lib/utils';

export type GenreDeBande = 'avertissement' | 'information';

/** L'air entre la bande et les boutons du haut, au téléphone (le même que sous l'heure sans bande). */
const MARGE_SOUS_LA_BANDE_TELEPHONE = '0.5rem';
const EVENEMENT_HAUTEUR_BANNIERE = 'beluga:hauteur-banniere';

function poserLaHauteur(hauteur: number | null, telephone: boolean) {
  const racine = document.documentElement.style;
  const avant = racine.getPropertyValue('--hauteur-banniere');
  if (hauteur === null) {
    racine.removeProperty('--hauteur-banniere');
    racine.removeProperty('--marge-sous-banniere');
  } else {
    racine.setProperty('--hauteur-banniere', `${Math.round(hauteur)}px`);
    racine.setProperty('--marge-sous-banniere', telephone ? MARGE_SOUS_LA_BANDE_TELEPHONE : '0px');
  }
  if (avant !== racine.getPropertyValue('--hauteur-banniere')) window.dispatchEvent(new Event(EVENEMENT_HAUTEUR_BANNIERE));
}

const COULEURS: Record<GenreDeBande, { fond: string; bouton: string; survol: string }> = {
  avertissement: {
    fond: 'bg-[hsl(var(--banniere-a-faire))] text-[hsl(var(--banniere-a-faire-texte))]',
    /* Fond presque noir, texte BLANC dans les douze palettes (décision de l'utilisateur, 20/11/2026). */
    bouton: 'bg-[hsl(var(--banniere-a-faire-texte))] text-[hsl(var(--banniere-a-faire-bouton-texte))]',
    survol: 'hover:bg-[hsl(var(--banniere-a-faire-texte)/0.1)]',
  },
  information: {
    fond: 'bg-[hsl(var(--banniere-info))] text-[hsl(var(--banniere-info-texte))]',
    bouton: 'bg-[hsl(var(--banniere-info-texte))] text-[hsl(var(--banniere-info))]',
    survol: 'hover:bg-[hsl(var(--banniere-info-texte)/0.12)]',
  },
};

export interface BandeDuHautProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  genre: GenreDeBande;
  icone: React.ReactNode;
  /** Le texte long (ordinateur, ou téléphone déplié) et le texte court (téléphone replié). */
  texte: React.ReactNode;
  texteCourt?: React.ReactNode;
  /** Un complément discret, à la suite du texte (« (et 1 autre) »). */
  suite?: React.ReactNode;
  bouton?: {
    libelle: string;
    onClick: () => void;
    occupe?: boolean;
    /** Les repères posés sur le bouton (`data-…`) : les contrôles le trouvent par eux. */
    reperes?: Record<string, string | undefined>;
  };
  /** La croix ; absente, la bande s'en va d'elle-même. */
  onFermer?: () => void;
  libelleFermer?: string;
}

export function BandeDuHaut({ genre, icone, texte, texteCourt, suite, bouton, onFermer, libelleFermer, className, ...reste }: BandeDuHautProps) {
  const telephone = useTelephone();
  const [deplie, setDeplie] = React.useState(false);
  const [bande, setBande] = React.useState<HTMLDivElement | null>(null);
  const couleurs = COULEURS[genre];
  const avecChevron = telephone && texteCourt !== undefined && texteCourt !== texte;
  const ouvert = telephone && deplie;

  /* LA HAUTEUR DE LA BANDE, pour que les pages fixes partent sous elle (voir l'en-tête). */
  React.useLayoutEffect(() => {
    if (!bande) return;
    const mesurer = () => poserLaHauteur(bande.getBoundingClientRect().height, telephone);
    mesurer();
    const observateur = new ResizeObserver(mesurer);
    observateur.observe(bande);
    return () => {
      observateur.disconnect();
      poserLaHauteur(null, telephone);
    };
  }, [bande, telephone]);

  return (
    <div
      ref={setBande}
      role="status"
      {...reste}
      data-bande-du-haut={genre}
      data-bande-deplie={ouvert ? '' : undefined}
      /* Le haut réserve la zone sûre (heure de l'iPhone) : 0 partout ailleurs, donc rien ne change hors iPhone. */
      className={cn(
        /* AU-DESSUS de l'écran qui barre la route faute de moteur (`z-[45]`), SOUS les fenêtres (`z-50`) : son bouton se
           clique même sans moteur prêt, comme l'ancien bandeau de mise à jour. */
        'relative z-[46] flex shrink-0 gap-3',
        ouvert ? 'items-start' : 'items-center',
        couleurs.fond,
        'px-4 pb-2 pt-[calc(var(--zone-sure-haut,0px)+0.5rem)] text-[13px] sm:pb-1.5 sm:pt-[calc(var(--zone-sure-haut,0px)+0.375rem)]',
        className,
      )}
    >
      <span className={cn('flex size-4 shrink-0 items-center justify-center', ouvert && 'mt-[6px]')} aria-hidden>
        {icone}
      </span>
      <p data-bande-du-haut-texte className={cn('min-w-0 flex-1', ouvert ? 'pt-[5px] leading-snug' : 'truncate')}>
        {telephone && !deplie && texteCourt !== undefined ? texteCourt : texte}
        {suite ? <span className="opacity-70"> {suite}</span> : null}
      </p>
      {avecChevron ? (
        /* LE CHEVRON QUI DÉPLIE LE MESSAGE (téléphone) : un bouton à part, le texte replié n'est jamais dedans. */
        <button
          type="button"
          data-bande-du-haut-deplier
          aria-expanded={deplie}
          aria-label={deplie ? 'Replier le message' : 'Afficher tout le message'}
          onClick={() => setDeplie((v) => !v)}
          className={cn('-mx-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md', couleurs.survol)}
        >
          <ChevronDown className={cn('size-4 transition-transform', deplie && 'rotate-180')} aria-hidden />
        </button>
      ) : null}
      {bouton ? (
        <button
          type="button"
          {...bouton.reperes}
          disabled={bouton.occupe}
          onClick={bouton.onClick}
          className={cn(
            'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-opacity hover:opacity-90 disabled:opacity-80',
            couleurs.bouton,
          )}
        >
          {bouton.occupe ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
          {bouton.libelle}
        </button>
      ) : null}
      {onFermer ? (
        <button
          type="button"
          data-bande-du-haut-fermer
          title={libelleFermer ?? t('Plus tard')}
          aria-label={libelleFermer ?? t('Plus tard')}
          onClick={onFermer}
          className={cn('-mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md', couleurs.survol)}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
