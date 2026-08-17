import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as SeparatorPrimitive from '@radix-ui/react-separator';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import { Check, ChevronRight, Loader2, X } from 'lucide-react';
import {
  DUREE_REUSSITE_MS,
  EVENEMENT_ATTENTE_LONGUE,
  SEUIL_LONGUE_ATTENTE_MS,
  boutonOccupe,
  estUneRequete,
  etatApresIssue,
  issueDeLaReponse,
  niveauQuota,
  suiteDesEtats,
  type EtatDeBouton,
} from '@haikodev/shared';
import { cn } from '@/lib/utils';
import { useSurvol } from '@/lib/pointeur';

/**
 * Le socle visuel, posé AVANT les écrans (PLAN §17, §30). Les composants sont
 * copiés dans le projet, pas importés d'une boîte noire : on les possède.
 */

/* ----------------------------- Bouton ----------------------------- */

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-faint disabled:pointer-events-none disabled:opacity-40 select-none',
  {
    variants: {
      variant: {
        default: 'bg-accent text-accent-fg hover:opacity-90',
        // `bg-controle` vaut la TRANSPARENCE dans les deux thèmes d'origine — ce
        // bouton ne bouge donc pas d'un pixel — et un voile translucide dans les
        // thèmes plats, où la bordure ne dessine plus rien (styles.css).
        outline: 'border border-border bg-controle hover:bg-raised text-text',
        ghost: 'hover:bg-raised text-muted hover:text-text',
        subtle: 'bg-raised text-text hover:bg-border',
        danger: 'bg-danger text-sur-etat hover:opacity-90',
        success: 'bg-success text-sur-etat hover:opacity-90',
      },
      size: {
        sm: 'h-7 px-2.5 text-[13.5px]',
        md: 'h-8 px-3 text-[14.5px]',
        lg: 'h-9 px-4 text-[14.5px]',
        icon: 'h-7 w-7',
        'icon-sm': 'h-6 w-6',
      },
    },
    defaultVariants: { variant: 'outline', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /**
   * Le bouton porte son propre témoin de chargement (un `busy` local, déjà
   * dessiné dans ses enfants) : on ne lui en pose pas un second par-dessus.
   */
  sansAttente?: boolean;
}

/**
 * Le TEXTE d'un bouton, pour le nommer dans un message : on ne garde que les
 * morceaux qui sont vraiment du texte — une icône n'a rien à dire.
 */
function libelleDuBouton(children: React.ReactNode): string {
  const morceaux: string[] = [];
  React.Children.forEach(children, (enfant) => {
    if (typeof enfant === 'string' || typeof enfant === 'number') morceaux.push(String(enfant));
  });
  return morceaux.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * UN CLIC SE VOIT TOUT DE SUITE.
 *
 * Quand le gestionnaire de clic rend une REQUÊTE (tout objet muni d'un `then`),
 * le bouton passe en « en cours » avant même la première réponse : ses enfants
 * s'effacent sur place — la largeur ne bouge donc pas —, une roue tourne à leur
 * place et le bouton n'accepte plus de clic. La réussite montre une coche une
 * seconde et demie, l'échec ramène le bouton exactement à son état d'avant ; le
 * refus, lui, est déjà dit en rouge par ailleurs.
 *
 * L'enchaînement des états est une règle PURE (`shared/src/bouton-en-attente.ts`),
 * testable sans monter le moindre composant. Un `onClick` qui ne rend rien — la
 * plupart — ne change strictement pas de comportement.
 *
 * Le bouton reste OUVERT pendant la coche : un geste qu'on veut refaire n'a pas
 * à attendre la fin d'une animation.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, sansAttente = false, onClick, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    const [etat, setEtat] = React.useState<EtatDeBouton>('repos');
    /* Un bouton démonté pendant sa requête ne doit rien reposer : la carte est
       souvent rangée ailleurs par la réponse même qu'on attendait. */
    const monte = React.useRef(true);
    React.useEffect(() => {
      monte.current = true;
      return () => {
        monte.current = false;
      };
    }, []);
    /* La coche s'efface toute seule ; son minuteur meurt avec le bouton. */
    React.useEffect(() => {
      if (etat !== 'reussi') return;
      const t = window.setTimeout(() => {
        if (monte.current) setEtat((e) => suiteDesEtats(e, 'fin-de-coche'));
      }, DUREE_REUSSITE_MS);
      return () => window.clearTimeout(t);
    }, [etat]);
    /*
     * UNE ATTENTE QUI DURE SE DIT. Passé dix secondes, une roue qui tourne
     * n'apprend plus rien : on ne sait plus si ça travaille ou si c'est bloqué.
     * Le bouton ne connaît pas les messages passagers — il annonce l'attente à
     * la PAGE, et c'est l'application qui la met en mots (un seul mot par
     * attente : le minuteur meurt avec l'état).
     */
    React.useEffect(() => {
      if (etat !== 'en-cours') return;
      const t = window.setTimeout(() => {
        if (!monte.current) return;
        window.dispatchEvent(
          new CustomEvent(EVENEMENT_ATTENTE_LONGUE, { detail: { geste: libelleDuBouton(children) } }),
        );
      }, SEUIL_LONGUE_ATTENTE_MS);
      return () => window.clearTimeout(t);
    }, [etat, children]);

    const suivi = asChild || sansAttente ? undefined : etat;
    const occupe = suivi ? boutonOccupe(suivi) : false;

    const auClic = (event: React.MouseEvent<HTMLButtonElement>) => {
      if (occupe) return;
      const retour = onClick?.(event) as unknown;
      if (asChild || sansAttente || !estUneRequete(retour)) return;
      setEtat('en-cours');
      retour.then(
        (valeur) => {
          if (monte.current) setEtat(etatApresIssue(issueDeLaReponse(valeur)));
        },
        () => {
          if (monte.current) setEtat(etatApresIssue('echec'));
        },
      );
    };

    return (
      <Comp
        className={cn(
          buttonVariants({ variant, size }),
          suivi && suivi !== 'repos' && 'relative',
          occupe && 'pointer-events-none',
          className,
        )}
        ref={ref}
        aria-busy={occupe || undefined}
        data-attente={suivi && suivi !== 'repos' ? suivi : undefined}
        onClick={auClic}
        {...props}
      >
        {suivi && suivi !== 'repos' ? (
          <>
            {/* Les enfants gardent leur place : c'est ce qui empêche le bouton
                de rétrécir puis de sauter au retour de la requête. */}
            <span className="pointer-events-none inline-flex items-center gap-1.5 opacity-0">{children}</span>
            <span className="absolute inset-0 flex items-center justify-center">
              {suivi === 'en-cours' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
            </span>
          </>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

/* ----------------------------- Champs ----------------------------- */

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-9 w-full rounded-md border border-border bg-raised px-3 text-[14.5px] text-text placeholder:text-faint focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-faint disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'w-full resize-none rounded-md border border-border bg-raised px-3 py-2.5 text-[14.5px] text-text placeholder:text-faint focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-faint',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-[12.5px] font-medium text-muted', className)} {...props} />;
}

/* ----------------------------- Badge ------------------------------ */

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[12px] font-medium leading-none',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-raised text-muted',
        success: 'border-success/30 bg-success/10 text-success',
        warning: 'border-warning/30 bg-warning/10 text-warning',
        danger: 'border-danger/30 bg-danger/10 text-danger',
        strong: 'border-transparent bg-accent text-accent-fg',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/* ----------------------------- Onglets ---------------------------- */

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & {
    /**
     * Quand les onglets dépassent la largeur disponible, la liste GLISSE de
     * gauche à droite au lieu de déborder. Les onglets gardent leur taille
     * (`shrink-0`) et la barre de défilement reste invisible : c'est un fondu de
     * bord, pas un ascenseur. Sans cette option, la liste s'étale comme avant —
     * l'usage du tiroir d'une carte ne bouge pas.
     */
    defilable?: boolean;
  }
>(({ className, defilable, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      'h-8 items-center gap-0.5 rounded-md bg-surface p-0.5',
      defilable
        ? // Un seul axe : `overflow-x-auto` seul repasserait l'autre en « auto »
          // dès qu'un onglet déborde. La barre de défilement est masquée dans
          // les deux familles de navigateurs.
          'flex overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&>*]:shrink-0 [&::-webkit-scrollbar]:hidden'
        : 'inline-flex',
      className,
    )}
    {...props}
  />
));
TabsList.displayName = 'TabsList';

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'inline-flex h-7 items-center justify-center gap-1.5 whitespace-nowrap rounded px-2.5 text-[13.5px] font-medium text-muted transition-colors hover:text-text data-[state=active]:bg-raised data-[state=active]:text-text',
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = 'TabsTrigger';

export const TabsContent = TabsPrimitive.Content;

/* -------------------- Fondu au bord d'un défilement ---------------- */

/**
 * Où s'arrête chaque calque de flou, en pourcentage de la bande. Quatre
 * calques : le tout premier pixel en cumule quatre, le dernier aucun.
 */
const COUCHES_FLOU = [25, 50, 75, 100];
const FLOU_PAR_COUCHE = 2;

/** La courbe d'extinction de l'ombre : douce au départ, longue à la fin. */
const OMBRE_COURBE =
  'rgb(0 0 0 / 1) 0%, rgb(0 0 0 / 0.92) 18%, rgb(0 0 0 / 0.7) 38%, rgb(0 0 0 / 0.42) 58%, rgb(0 0 0 / 0.18) 78%, rgb(0 0 0 / 0) 100%';

/**
 * Une zone qui défile, avec un fondu en HAUT et en BAS : le contenu ne se
 * coupe plus net sous les onglets ou au-dessus de la barre d'écriture, il
 * s'efface et se floute en glissant derrière. Le voile prend la couleur du
 * fond courant — donc noir en thème sombre, blanc en thème clair, sans
 * réglage.
 *
 * Le fondu du début ne s'allume que si quelque chose est déjà passé derrière,
 * celui de la fin s'éteint une fois le bout atteint : un voile permanent
 * laisserait croire qu'il reste toujours à lire.
 *
 * Le fondu est RÉSERVÉ au défilement vertical, seul cas où le texte glisse
 * derrière un en-tête ou une barre. Sur un rail de colonnes ou une barre
 * d'onglets, il masquerait le bord des éléments sans rien apprendre : l'axe
 * « horizontal » garde donc le conteneur — un seul axe de défilement, l'autre
 * bloqué — mais ne pose aucun voile.
 */
export const ZoneDefilement = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    /** Couleur du fondu ; par défaut celle du fond de l'application. */
    fond?: string;
    /** Épaisseur du fondu, en pixels. */
    hauteur?: number;
    /** Classes de l'enveloppe qui porte les voiles. */
    classeEnveloppe?: string;
    /**
     * Sens du défilement. Un seul axe à la fois : l'autre reste bloqué.
     * « horizontal » ne pose aucun voile — le fondu n'a de sens qu'à la
     * verticale.
     */
    axe?: 'vertical' | 'horizontal';
  }
>(function ZoneDefilement(
  {
    // Sans couleur imposée, le fondu suit le fond RÉEL du conteneur qui
    // l'entoure (`--fond-zone-defilement`, posée par ce conteneur — le
    // tiroir, par exemple) plutôt qu'un noir fixe : un tiroir gris cendré
    // n'a plus de tache sombre en haut et en bas de ses zones qui défilent.
    // Sans conteneur qui la pose, la variable retombe sur le noir de fond.
    fond = 'var(--fond-zone-defilement, hsl(var(--bg)))',
    // Une bande courte redevient une coupure : il faut de la place pour que
    // le flou ait le temps de grandir.
    hauteur = 44,
    classeEnveloppe,
    axe = 'vertical',
    className,
    onScroll,
    children,
    ...props
  },
  ref,
) {
  const horizontal = axe === 'horizontal';
  const interne = React.useRef<HTMLDivElement | null>(null);
  const [debut, setDebut] = React.useState(false);
  const [fin, setFin] = React.useState(false);

  // Sans voile à allumer, il n'y a rien à mesurer : l'axe horizontal ne paie
  // ni l'observateur de taille ni un rendu à chaque défilement.
  const mesurer = React.useCallback(() => {
    const zone = interne.current;
    if (!zone || horizontal) return;
    setDebut(zone.scrollTop > 4);
    setFin(zone.scrollTop + zone.clientHeight < zone.scrollHeight - 4);
  }, [horizontal]);

  /*
   * Le contenu change sans qu'on défile (message qui arrive, onglet qui
   * s'ouvre) : on remesure à chaque remaniement de la zone. L'observateur est
   * donc reposé à chaque rendu — mais UNIQUEMENT si les éléments à surveiller
   * ont vraiment changé. Sans ce garde-fou, chaque rendu de l'application
   * défaisait puis refaisait un observateur sur CHACUN des enfants de CHAQUE
   * zone qui défile : avec quelques centaines de cartes, c'était des milliers
   * de gestes inutiles par frappe au clavier.
   */
  const observateur = React.useRef<ResizeObserver | null>(null);
  const surveilles = React.useRef<Element[]>([]);
  React.useEffect(() => {
    const zone = interne.current;
    if (!zone || horizontal) return;
    mesurer();
    const aSurveiller = [zone as Element, ...Array.from(zone.children)];
    const memes =
      !!observateur.current &&
      surveilles.current.length === aSurveiller.length &&
      surveilles.current.every((noeud, i) => noeud === aSurveiller[i]);
    if (memes) return;
    observateur.current?.disconnect();
    const suivi = new ResizeObserver(mesurer);
    for (const noeud of aSurveiller) suivi.observe(noeud);
    observateur.current = suivi;
    surveilles.current = aSurveiller;
  });

  // Le seul démontage qui compte : celui du composant.
  React.useEffect(
    () => () => {
      observateur.current?.disconnect();
      observateur.current = null;
      surveilles.current = [];
    },
    [],
  );

  const voile = (cote: 'debut' | 'fin', visible: boolean) => {
    if (horizontal) return null;
    const sens = cote === 'debut' ? 'bottom' : 'top';
    return (
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-x-0 z-10 transition-opacity duration-200',
          cote === 'debut' ? 'top-0' : 'bottom-0',
          visible ? 'opacity-100' : 'opacity-0',
        )}
        style={{ height: hauteur }}
      >
        {/*
         * Un flou PROGRESSIF, et non une bande floue posée d'un bloc : un seul
         * calque donne toujours une arête, parce que le flou y est le même
         * partout et que seule son opacité varie. On empile donc plusieurs
         * calques de plus en plus courts — le bord en cumule autant qu'il y en
         * a, le milieu un seul, la fin aucun. Le flou grandit alors doucement,
         * comme le fait un objet qui s'éloigne.
         */}
        {COUCHES_FLOU.map((fin, index) => (
          <div
            key={index}
            className="absolute inset-0"
            style={{
              backdropFilter: `blur(${FLOU_PAR_COUCHE}px)`,
              WebkitBackdropFilter: `blur(${FLOU_PAR_COUCHE}px)`,
              maskImage: `linear-gradient(to ${sens}, black ${COUCHES_FLOU[index - 1] ?? 0}%, transparent ${fin}%)`,
              WebkitMaskImage: `linear-gradient(to ${sens}, black ${COUCHES_FLOU[index - 1] ?? 0}%, transparent ${fin}%)`,
            }}
          />
        ))}
        {/*
         * L'ombre, par-dessus : la couleur du fond s'efface selon une courbe
         * douce. Un dégradé droit se voit finir ; celui-ci s'éteint.
         */}
        <div
          className="absolute inset-0"
          style={{
            background: fond,
            maskImage: `linear-gradient(to ${sens}, ${OMBRE_COURBE})`,
            WebkitMaskImage: `linear-gradient(to ${sens}, ${OMBRE_COURBE})`,
          }}
        />
      </div>
    );
  };

  return (
    <div
      className={cn(
        'relative flex',
        horizontal ? 'min-w-0 flex-1 flex-row' : 'min-h-0 flex-1 flex-col',
        classeEnveloppe,
      )}
    >
      {voile('debut', debut)}
      <div
        ref={(noeud) => {
          interne.current = noeud;
          if (typeof ref === 'function') ref(noeud);
          else if (ref) ref.current = noeud;
        }}
        onScroll={(event) => {
          mesurer();
          onScroll?.(event);
        }}
        className={cn(
          // Un seul axe : un « auto » sur les deux entraîne l'autre.
          horizontal
            ? 'min-w-0 flex-1 overflow-x-auto overflow-y-hidden'
            : 'min-h-0 flex-1 overflow-y-auto overflow-x-hidden',
          className,
        )}
        {...props}
      >
        {children}
      </div>
      {voile('fin', fin)}
    </div>
  );
});

/* ----------------------------- Dialogue --------------------------- */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-voile/70 backdrop-blur-[2px] data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
      {/*
       * La fenêtre est POSÉE par une enveloppe en flux (collée en bas sur
       * téléphone, centrée sur grand écran), jamais par un décalage de moitié :
       * l'animation d'ouverture écrase le décalage le temps qu'elle dure, et la
       * fenêtre partait alors se coller au bord droit de l'écran.
       */}
      <div className="pointer-events-none fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-3">
        <DialogPrimitive.Content
          className={cn(
            'pointer-events-auto relative flex max-h-[85dvh] w-full flex-col overflow-hidden border-t border-border bg-surface shadow-2xl',
            'rounded-t-xl data-[state=open]:animate-slide-sheet data-[state=closed]:animate-slide-sheet-out',
            'sm:w-[min(560px,100%)] sm:rounded-lg sm:border sm:data-[state=open]:animate-slide-up sm:data-[state=closed]:animate-slide-down',
            className,
          )}
          {...props}
        >
          {/* Le contenu d'une fenêtre déborde souvent : il s'efface au bord
              plutôt que de se couper net sous le bouton de fermeture. */}
          <ZoneDefilement
            fond="hsl(var(--surface))"
            className="p-4"
            style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
          >
            {children}
          </ZoneDefilement>
          <DialogPrimitive.Close className="absolute right-3 top-3 rounded p-1 text-faint hover:bg-raised hover:text-text">
            <X className="h-3.5 w-3.5" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </div>
    </DialogPrimitive.Portal>
  );
}

/**
 * Le tiroir : il monte depuis le bas et occupe presque tout l'écran. On y
 * travaille, contrairement à une fenêtre qui interrompt.
 */
export function Drawer({
  open,
  onClose,
  children,
  className,
  empile,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  /** Un tiroir ouvert PAR-DESSUS un autre tiroir déjà ouvert : un liseré et
   * une ombre plus marqués font sentir la couche du dessus. */
  empile?: boolean;
}) {
  /*
   * Le tiroir se referme en le tirant vers le bas, comme une vraie feuille :
   * on suit le doigt, et on ne referme que si le geste est franc.
   */
  const [decalage, setDecalage] = React.useState(0);
  const depart = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (open) setDecalage(0);
  }, [open]);

  const poignee = {
    onPointerDown: (event: React.PointerEvent) => {
      depart.current = event.clientY;
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    },
    onPointerMove: (event: React.PointerEvent) => {
      if (depart.current === null) return;
      setDecalage(Math.max(0, event.clientY - depart.current));
    },
    onPointerUp: () => {
      if (depart.current === null) return;
      depart.current = null;
      setDecalage((valeur) => {
        if (valeur > 110) onClose();
        return 0;
      });
    },
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-voile/70 backdrop-blur-[2px] data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
        <DialogPrimitive.Content
          className={cn(
            // Sur téléphone il occupe toute la largeur ; sur grand écran il se
            // pose au centre, plafonné à 960 px : au-delà, les lignes de texte
            // deviennent trop longues pour être lues confortablement.
            'fixed inset-x-0 z-50 mx-auto flex w-full max-w-[960px] flex-col overflow-hidden border-border bg-surface shadow-2xl',
            'rounded-t-xl sm:rounded-t-2xl sm:border-x',
            // Une feuille qui MONTE : le décalage de 6 px des fenêtres se
            // voyait à peine sur un panneau de cette taille.
            'data-[state=open]:animate-slide-sheet data-[state=closed]:animate-slide-sheet-out',
            // Fond gris légèrement plus clair que la page et bordure claire sur le bord
            // du haut, comme le tiroir des quotas : ce liseré est ce qui distingue le
            // tiroir du fond, pas une ombre seule. Le tiroir empilé se marque davantage.
            empile
              ? 'border-t-2 border-t-accent/50 shadow-[0_-14px_38px_-10px_rgba(0,0,0,0.7)]'
              : 'border-t border-t-border',
            className,
          )}
          style={{
            // La hauteur suit le contenu — plafonnée pour ne pas dépasser l'écran —
            // au lieu d'occuper toujours 92 % de la hauteur, vide en bas quand le
            // contenu est court.
            bottom: 'var(--clavier, 0px)',
            maxHeight: 'calc(92dvh - var(--clavier, 0px))',
            paddingBottom: 'env(safe-area-inset-bottom)',
            transform: decalage ? `translateY(${decalage}px)` : undefined,
            transition: depart.current === null ? 'transform 180ms ease-out' : undefined,
            // Le fond du tiroir est gris cendré (bg-surface) : toute zone qui
            // défile à l'intérieur, sans couleur de fondu imposée, doit le
            // savoir pour ne pas garder un fondu noir.
            ['--fond-zone-defilement' as string]: 'hsl(var(--surface))',
          }}
        >
          {/* La poignée : on la tire vers le bas pour refermer. */}
          <div
            {...poignee}
            onPointerCancel={poignee.onPointerUp}
            className="flex shrink-0 cursor-grab touch-none justify-center py-3 active:cursor-grabbing"
          >
            <DialogPrimitive.Close className="h-1 w-10 rounded-full bg-border transition-colors hover:bg-muted" />
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * Le panneau latéral : il glisse depuis la GAUCHE par-dessus l'écran en cours,
 * un voile derrière. C'est un choix qu'on fait au passage, pas une destination :
 * on le referme en touchant le voile, en tirant sa poignée vers la gauche, ou
 * en choisissant ce qu'on était venu chercher.
 */
export function SidePanel({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  /** Nommé pour les lecteurs d'écran : le panneau n'affiche pas de titre. */
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [decalage, setDecalage] = React.useState(0);
  const depart = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (open) setDecalage(0);
  }, [open]);

  /*
   * Le glissement part de la POIGNÉE du bord droit, jamais du contenu : la
   * liste des projets se range déjà au doigt, et les deux gestes se
   * marcheraient dessus.
   */
  const poignee = {
    onPointerDown: (event: React.PointerEvent) => {
      depart.current = event.clientX;
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    },
    onPointerMove: (event: React.PointerEvent) => {
      if (depart.current === null) return;
      setDecalage(Math.min(0, event.clientX - depart.current));
    },
    onPointerUp: () => {
      if (depart.current === null) return;
      depart.current = null;
      setDecalage((valeur) => {
        if (valeur < -70) onClose();
        return 0;
      });
    },
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-voile/70 backdrop-blur-[2px] data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
        <DialogPrimitive.Content
          aria-label={title}
          className={cn(
            'fixed left-0 top-0 z-50 flex w-[min(320px,86vw)] flex-col overflow-hidden border-r border-border bg-bg shadow-2xl',
            'data-[state=open]:animate-slide-in-left data-[state=closed]:animate-slide-out-left',
            className,
          )}
          style={{
            // La hauteur mesurée en direct : l'unité dvh seule laisse une bande
            // vide en bas sur téléphone.
            height: 'var(--hauteur-app, 100dvh)',
            paddingTop: 'env(safe-area-inset-top)',
            paddingBottom: 'env(safe-area-inset-bottom)',
            transform: decalage ? `translateX(${decalage}px)` : undefined,
            transition: depart.current === null ? 'transform 180ms ease-out' : undefined,
          }}
        >
          {/* La bande de droite est réservée à la poignée : sans ce retrait, le
              geste recouvrirait les petits boutons au bout des lignes. */}
          <div className="flex min-h-0 flex-1 overflow-hidden pr-3">{children}</div>
          <div
            {...poignee}
            onPointerCancel={poignee.onPointerUp}
            aria-hidden
            className="absolute inset-y-0 right-0 flex w-3 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
          >
            <span className="h-10 w-1 rounded-full bg-border" />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function DialogTitle({ className, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn('text-[15.5px] font-semibold text-text', className)} {...props} />;
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn('mt-1 text-[14px] text-muted', className)} {...props} />;
}

/* ----------------------------- Infobulle -------------------------- */

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({ children, label }: { children: React.ReactNode; label: React.ReactNode }) {
  const survol = useSurvol();
  // Sans survol, l'infobulle ne s'affichera JAMAIS (elle est masquée en dessous
  // de `sm`) : son déclencheur ne ferait que s'interposer entre le doigt et ce
  // qu'il vise — un interrupteur, par exemple. On ne le pose donc pas du tout.
  if (!label || !survol) return <>{children}</>;
  return (
    <TooltipPrimitive.Root delayDuration={280}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        {/* Sur téléphone, l'infobulle n'a AUCUN sens (rien ne survole) et la
            règle qui pose les menus en tiroir la collait en bas de l'écran,
            sous le bouton de redémarrage. On ne l'affiche qu'à la souris. */}
        <TooltipPrimitive.Content
          data-infobulle
          sideOffset={6}
          className="z-50 hidden max-w-[280px] rounded-md border border-border bg-raised px-2 py-1.5 text-[13px] text-text shadow-xl animate-fade-in sm:block"
        >
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/* ----------------------------- Menu ------------------------------- */

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;

/**
 * Le voile d'un menu devenu TIROIR sur téléphone. La bibliothèque des menus
 * n'en fournit pas — contrairement aux fenêtres — donc on le pose nous-mêmes,
 * directement dans la page, et on le fait vivre au rythme du menu : il suit
 * l'attribut d'état que la bibliothèque écrit sur le panneau, donc il s'efface
 * pendant que le tiroir redescend au lieu de disparaître d'un coup.
 */
function VoileMenu({ panneau }: { panneau: React.RefObject<HTMLDivElement | null> }) {
  const [etat, setEtat] = React.useState<'open' | 'closed'>('open');

  React.useEffect(() => {
    const noeud = panneau.current;
    if (!noeud) return;
    const lire = () => setEtat(noeud.getAttribute('data-state') === 'closed' ? 'closed' : 'open');
    lire();
    const observateur = new MutationObserver(lire);
    observateur.observe(noeud, { attributes: true, attributeFilter: ['data-state'] });
    return () => observateur.disconnect();
  }, [panneau]);

  return ReactDOM.createPortal(
    <div
      aria-hidden
      data-state={etat}
      /* Sur grand écran un menu déroulant n'assombrit rien : il se pose à côté
         de son bouton, il n'interrompt pas. */
      className={cn(
        'fixed inset-0 z-[55] bg-voile/70 backdrop-blur-[2px] sm:hidden',
        'data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out',
      )}
      style={{ opacity: etat === 'closed' ? 0 : undefined }}
    />,
    document.body,
  );
}

export function DropdownMenuContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Content>) {
  /*
   * Sur téléphone le menu est un TIROIR, donc il se referme comme les autres :
   * en tirant la poignée vers le bas. Le geste part de la poignée seule, sinon
   * il empêcherait le contenu de défiler. Le menu n'expose pas son « fermer » :
   * on passe par la touche d'échappement, que la bibliothèque écoute déjà.
   */
  const [decalage, setDecalage] = React.useState(0);
  const depart = React.useRef<number | null>(null);
  const panneau = React.useRef<HTMLDivElement | null>(null);

  const fermer = () =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  const poignee = {
    onPointerDown: (event: React.PointerEvent) => {
      depart.current = event.clientY;
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    },
    onPointerMove: (event: React.PointerEvent) => {
      if (depart.current === null) return;
      setDecalage(Math.max(0, event.clientY - depart.current));
    },
    onPointerUp: () => {
      if (depart.current === null) return;
      depart.current = null;
      setDecalage((valeur) => {
        if (valeur > 110) fermer();
        return 0;
      });
    },
  };

  return (
    <DropdownPrimitive.Portal>
      {/* Posé en bas, sur toute la largeur, avec sa poignée. Les classes « ! »
          sont nécessaires pour couvrir le placement calculé par la
          bibliothèque. */}
      <DropdownPrimitive.Content
        ref={panneau}
        sideOffset={4}
        className={cn(
          'z-50 flex min-w-[170px] flex-col overflow-hidden border border-border bg-surface p-1 shadow-xl',
          'data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out',
          // La hauteur réelle de l'écran, mesurée en direct : dvh seul laisse
          // une bande vide quand l'application est installée sur le téléphone.
          // Le tiroir passe AU-DESSUS de son propre voile, lui-même au-dessus
          // des panneaux déjà ouverts.
          'max-sm:z-[60] max-sm:w-full max-sm:max-h-[calc(var(--hauteur-app,100dvh)*0.8)] max-sm:rounded-t-xl',
          'max-sm:border-x-0 max-sm:border-b-0 max-sm:p-2 max-sm:pb-[calc(10px+env(safe-area-inset-bottom))]',
          'max-sm:data-[state=open]:animate-slide-sheet max-sm:data-[state=closed]:animate-slide-sheet-out',
          'sm:rounded-md',
          className,
        )}
        style={{
          transform: decalage ? `translateY(${decalage}px)` : undefined,
          transition: depart.current === null ? 'transform 180ms ease-out' : undefined,
        }}
        {...props}
      >
        {/* Le voile part dans la page, pas ici : la bibliothèque n'accepte
            qu'un seul enfant sous son portail. */}
        <VoileMenu panneau={panneau} />
        <div
          {...poignee}
          onPointerCancel={poignee.onPointerUp}
          className="mb-1.5 flex shrink-0 cursor-grab touch-none justify-center py-1.5 active:cursor-grabbing sm:hidden"
        >
          <span className="h-1 w-10 rounded-full bg-border" />
        </div>
        {/* Le contenu défile seul : la poignée reste sous le doigt même quand la
            liste est longue. */}
        <ZoneDefilement fond="hsl(var(--surface))" hauteur={32} className="overscroll-contain">
          {props.children}
        </ZoneDefilement>
      </DropdownPrimitive.Content>
    </DropdownPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Item>) {
  return (
    <DropdownPrimitive.Item
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1.5 text-[14px] text-muted outline-none data-[highlighted]:bg-raised data-[highlighted]:text-text',
        className,
      )}
      {...props}
    />
  );
}

/* ------------------------- Menu DANS le menu ----------------------- *
 *
 * UN SOUS-MENU S'OUVRE AU SURVOL **ET** AU CLIC.
 *
 * Une famille de choix qui s'allonge (les cinq thèmes) occupait la moitié du
 * menu : on la range derrière une seule entrée, qui déplie sa liste à côté. La
 * bibliothèque ouvre ce genre d'entrée au survol de la souris ET à l'appui —
 * les deux gestes comptent, puisque le téléphone et le clavier n'ont pas de
 * survol. On ne réécrit donc AUCUN de ces deux chemins ; on ne fait que
 * l'habiller comme une entrée ordinaire, avec le chevron qui dit « il y a une
 * suite ».
 */
export const DropdownMenuSub = DropdownPrimitive.Sub;

export function DropdownMenuSubTrigger({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.SubTrigger>) {
  return (
    <DropdownPrimitive.SubTrigger
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1.5 text-[14px] text-muted outline-none',
        'data-[highlighted]:bg-raised data-[highlighted]:text-text data-[state=open]:bg-raised data-[state=open]:text-text',
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-faint" />
    </DropdownPrimitive.SubTrigger>
  );
}

export function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.SubContent>) {
  return (
    <DropdownPrimitive.Portal>
      {/* Le panneau du sous-menu reste un panneau FLOTTANT, sur téléphone comme
          sur grand écran : le tiroir du bas, lui, appartient au menu de premier
          niveau. Il passe donc au-dessus de ce tiroir (z-index plus haut) et la
          bibliothèque le replace toute seule s'il sortait de l'écran. */}
      <DropdownPrimitive.SubContent
        sideOffset={2}
        alignOffset={-4}
        className={cn(
          'z-50 flex min-w-[170px] flex-col overflow-hidden rounded-md border border-border bg-surface p-1 shadow-xl',
          'data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out',
          'max-sm:z-[70]',
          className,
        )}
        {...props}
      />
    </DropdownPrimitive.Portal>
  );
}

export function DropdownMenuLabel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-2 py-1 text-[12px] uppercase tracking-wide text-faint', className)} {...props} />;
}

export function DropdownMenuSeparator() {
  return <DropdownPrimitive.Separator className="my-1 h-px bg-border" />;
}

/* ----------------------------- Divers ----------------------------- */

/**
 * L'interrupteur. Quand la bascule part au serveur et qu'on en attend la
 * réponse, `attente` allume un voyant DANS le rond : un anneau minuscule qui
 * tourne. C'est un signe de vie, pas une jauge — le rond ne fait que 13 px.
 * Pendant ce temps l'interrupteur est bloqué : un second appui partirait en
 * double. L'aspect au repos ne change pas d'un pixel.
 */
export function Switch({
  className,
  attente,
  disabled,
  ...props
}: React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> & {
  /** Une réponse est attendue : le rond porte un anneau qui tourne. */
  attente?: boolean;
}) {
  return (
    <SwitchPrimitive.Root
      aria-busy={attente || undefined}
      disabled={disabled || attente}
      className={cn(
        'peer relative inline-flex h-[18px] w-[32px] shrink-0 cursor-pointer items-center rounded-full border border-border transition-colors data-[state=checked]:bg-accent data-[state=unchecked]:bg-raised',
        // L'interrupteur ne fait que 18 px de haut : au doigt, la moitié des
        // appuis tombe à côté. Un calque invisible de 36 × 32 px, centré
        // dessus, agrandit la CIBLE sans rien changer à l'aspect ni à la place
        // occupée — même idée que les cibles de 32 px de la pile des messages.
        'touch-manipulation after:absolute after:left-1/2 after:top-1/2 after:h-[32px] after:w-[36px] after:-translate-x-1/2 after:-translate-y-1/2 after:content-[""]',
        attente && 'cursor-wait',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="group pointer-events-none relative block h-[13px] w-[13px] rounded-full bg-muted shadow transition-transform data-[state=checked]:translate-x-[15px] data-[state=checked]:bg-accent-fg data-[state=unchecked]:translate-x-[2px]">
        {attente ? (
          /*
           * L'anneau se pose DANS le rond, sans en changer la taille ni la
           * place. Sa couleur est celle du rond D'EN FACE — le fond du rail
           * quand l'interrupteur est allumé, le rond éteint sinon : le rond
           * change de couleur d'un état à l'autre, un anneau de teinte fixe
           * disparaîtrait dans l'un des deux, en thème clair comme en sombre.
           */
          <span
            data-voyant-attente=""
            aria-hidden
            className="absolute inset-[2px] animate-spin rounded-full border-[1.5px] border-transparent border-t-accent-fg group-data-[state=checked]:border-t-accent"
          />
        ) : null}
      </SwitchPrimitive.Thumb>
    </SwitchPrimitive.Root>
  );
}

export function Separator({ className, ...props }: React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>) {
  return <SeparatorPrimitive.Root className={cn('bg-border', 'h-px w-full', className)} {...props} />;
}

export function ScrollArea({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root className={cn('relative overflow-hidden', className)} {...props}>
      <ScrollAreaPrimitive.Viewport className="h-full w-full [&>div]:!block">{children}</ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar
        orientation="vertical"
        className="flex w-1.5 touch-none select-none p-px transition-colors"
      >
        <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-border" />
      </ScrollAreaPrimitive.Scrollbar>
    </ScrollAreaPrimitive.Root>
  );
}

/** Jauge maison, écrite aux mêmes règles que la bibliothèque (PLAN §17). */
export function Gauge({
  value,
  tone = 'auto',
  className,
  height = 'h-1.5',
}: {
  value: number;
  /** « quota » : vert, puis jaune sous 30 % restants, rouge sous 15 %. */
  tone?: 'auto' | 'neutral' | 'quota';
  className?: string;
  height?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  const niveau = niveauQuota(pct);
  const color =
    tone === 'neutral'
      ? 'bg-muted'
      : tone === 'quota'
        ? niveau === 'critique'
          ? 'bg-danger'
          : niveau === 'attention'
            ? 'bg-warning'
            : 'bg-success'
        : pct >= 90
          ? 'bg-danger'
          : pct >= 70
            ? 'bg-warning'
            : 'bg-muted';
  return (
    <div className={cn('w-full overflow-hidden rounded-full bg-raised', height, className)}>
      <div className={cn('h-full rounded-full transition-all duration-500', color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * Voyant d'état : la couleur ne sert qu'à DIRE quelque chose.
 * Elle suit la convention de l'application — ORANGE pour ce qui travaille,
 * BLEU pour ce qui est terminé. L'échec et l'attente ne bougent pas.
 */
export function Dot({ tone, pulse }: { tone: 'idle' | 'running' | 'done' | 'failed' | 'waiting'; pulse?: boolean }) {
  const color =
    tone === 'running'
      ? 'bg-en-cours'
      : tone === 'failed'
        ? 'bg-danger'
        : tone === 'waiting'
          ? 'bg-warning'
          : tone === 'done'
            ? 'bg-termine'
            : 'bg-faint';
  return <span className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', color, pulse && 'animate-pulse-soft')} />;
}

export function EmptyState({ icon, title, hint }: { icon?: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon ? <div className="text-faint">{icon}</div> : null}
      <p className="text-[14.5px] font-medium text-muted">{title}</p>
      {hint ? <p className="max-w-[260px] text-[13.5px] text-faint">{hint}</p> : null}
    </div>
  );
}

/* ----------------------- Demande et confirmation ------------------ */

/**
 * Remplace les fenêtres du navigateur : même vocabulaire visuel partout,
 * jamais d'alerte native (elle casse le thème et bloque la page).
 */
export function PromptDialog({
  open,
  title,
  description,
  placeholder,
  defaultValue = '',
  confirmLabel = 'Valider',
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = React.useState(defaultValue);
  React.useEffect(() => {
    if (open) setValue(defaultValue);
  }, [open, defaultValue]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:w-[min(420px,100%)]">
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
        <Input
          autoFocus
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && value.trim()) {
              onConfirm(value.trim());
              onClose();
            }
          }}
          className="mt-3"
        />
        <div className="mt-4 flex justify-end gap-1.5">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="default"
            size="sm"
            disabled={!value.trim()}
            onClick={() => {
              onConfirm(value.trim());
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirmer',
  danger,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:w-[min(440px,100%)]">
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
        <div className="mt-4 flex justify-end gap-1.5">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant={danger ? 'danger' : 'default'}
            size="sm"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
