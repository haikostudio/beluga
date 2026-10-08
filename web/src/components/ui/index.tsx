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
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Check, ChevronDown, ChevronRight, EllipsisVertical, Info, Loader2, Search, X } from 'lucide-react';
import {
  DUREE_REUSSITE_MS,
  EVENEMENT_ATTENTE_LONGUE,
  SEUIL_LONGUE_ATTENTE_MS,
  boutonOccupe,
  chiffreDePastille,
  estUneRequete,
  etatApresIssue,
  issueDeLaReponse,
  niveauQuota,
  suiteDesEtats,
  type EtatDeBouton,
} from '@beluga/shared';
import { cn } from '@/lib/utils';
import { useSurvol } from '@/lib/pointeur';
import { useTelephone } from '@/lib/telephone';
import { t } from '@/lib/langue';

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
        /*
         * LE BOUTON D'UN PIED — en bas d'un écran, d'une colonne ou d'un tiroir,
         * sur toute la largeur. Tous les pieds ont la MÊME hauteur : celle d'une
         * LIGNE DE LISTE d'un tiroir de choix (`SelecteurTiroir`, 36 px : `py-2`
         * + `leading-5`). « Ajouter un client » sous la liste des clients était
         * plus bas que les lignes au-dessus de lui. Un pied neuf la prend en
         * nommant la taille, sans la recopier ni l'écraser par un `h-…`.
         */
        pied: 'h-9 w-full px-3 text-[14px]',
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

/* ------------------------ Formulaire en colonnes ------------------------ */

/**
 * UN FORMULAIRE EN DEUX COLONNES : les LIBELLÉS dans une colonne de largeur
 * fixe, les VALEURS dans la colonne d'à côté, pleine largeur. Toutes les lignes
 * partagent ces deux colonnes, donc libellés et valeurs s'alignent de haut en
 * bas, avec les mêmes bords droits. Ce qui n'a pas de libellé (une note, un
 * bouton, un encart) se pose DANS la colonne des valeurs, jamais à cheval.
 * Sur téléphone, le libellé repasse au-dessus de sa valeur (`empile`).
 */
export function FormulaireEnColonnes({
  children,
  className,
  largeurLibelle = '11rem',
  empile = true,
  ...attributs
}: {
  children: React.ReactNode;
  className?: string;
  /** La largeur de la colonne des libellés (CSS). */
  largeurLibelle?: string;
  /** Sur téléphone, un libellé au-dessus de sa valeur ; faux = deux colonnes partout. */
  empile?: boolean;
} & Record<`data-${string}`, string | number | boolean | undefined>) {
  return (
    <div
      {...attributs}
      data-formulaire-colonnes
      className={cn(
        'grid gap-x-3 gap-y-2',
        empile ? 'grid-cols-1 sm:grid-cols-[var(--colonne-libelles)_minmax(0,1fr)]' : 'grid-cols-[var(--colonne-libelles)_minmax(0,1fr)]',
        // Ce qui n'est pas une ligne (note, bouton, encart) va dans la colonne des valeurs ;
        // un bloc marqué `data-pleine-largeur` (un historique, un tableau) prend les deux.
        empile
          ? 'sm:[&>:not([data-ligne-formulaire]):not([data-pleine-largeur])]:col-start-2'
          : '[&>:not([data-ligne-formulaire]):not([data-pleine-largeur])]:col-start-2',
        '[&>[data-pleine-largeur]]:col-span-full',
        className,
      )}
      style={{ ['--colonne-libelles' as string]: largeurLibelle }}
    >
      {children}
    </div>
  );
}

/**
 * UNE LIGNE D'UN `FormulaireEnColonnes` : son libellé (et son « i ») à gauche,
 * sa valeur à droite, ses notes SOUS la valeur, dans la même colonne. Elle ne
 * pose aucune boîte (`display: contents`) : ses deux cellules sont celles de la
 * grille.
 */
export function LigneFormulaire({
  libelle,
  aide,
  note,
  children,
  htmlFor,
  className,
  ...attributs
}: {
  libelle: React.ReactNode;
  /** Une explication, rangée derrière un « i » à côté du libellé. */
  aide?: React.ReactNode;
  /** Une ligne grise sous la valeur, dans la colonne des valeurs. */
  note?: React.ReactNode;
  children: React.ReactNode;
  htmlFor?: string;
  className?: string;
} & Record<`data-${string}`, string | number | boolean | undefined>) {
  return (
    <div className="contents" data-ligne-formulaire {...attributs}>
      <div className="flex min-h-8 min-w-0 items-center gap-1 self-start">
        <label htmlFor={htmlFor} className="min-w-0 text-[12.5px] font-medium leading-snug text-muted">
          {libelle}
        </label>
        {aide ? <BulleInfo cote="start">{aide}</BulleInfo> : null}
      </div>
      <div className={cn('flex min-w-0 flex-col gap-1', className)}>
        {children}
        {note ? <p className="text-[12px] leading-snug text-faint">{note}</p> : null}
      </div>
    </div>
  );
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
        attention: 'border-a-surveiller/40 bg-a-surveiller/10 text-a-surveiller',
        danger: 'border-danger/30 bg-danger/10 text-danger',
        strong: 'border-transparent bg-accent text-accent-fg',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

/* UNE PASTILLE PEUT RECEVOIR UNE RÉFÉRENCE. Posée dans une infobulle ou un
   déclencheur Radix, elle en reçoit une : sans `forwardRef`, React s'en
   plaignait dans la console à chaque rendu du tableau, et le contrôle
   « aucune erreur dans la console » virait au rouge pour un décor. */
export const Badge = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>
>(({ className, tone, ...props }, ref) => (
  <span ref={ref} className={cn(badgeVariants({ tone }), className)} {...props} />
));
Badge.displayName = 'Badge';

/* ----------------------------- Pastille ----------------------------- */

/**
 * LE POINT D'ÉTAT D'UN BOUTON DE L'ENTÊTE : UNE SEULE PLACE, UNE SEULE TAILLE.
 *
 * Tout point posé sur un bouton du bandeau du haut (menu, repli de la colonne,
 * cloche, assistant, trois points) est un rond de 8 px À CHEVAL sur le coin
 * haut droit du bouton, 2 px dehors — la place de celui de la cloche, qui sert
 * de modèle. Seule la COULEUR change d'un bouton à l'autre : elle s'ajoute à
 * cette classe. Le bouton porte `relative` et ne rogne pas ce qui déborde.
 * Contrôle : `scripts/verif-curseur-pastilles-selecteur.mjs`.
 */
export const CLASSE_POINT_DE_BOUTON = 'pointer-events-none absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full';

/**
 * LA PASTILLE CHIFFRÉE, UNE SEULE POUR TOUTE L'APPLICATION.
 *
 * Elle était écrite à la main à six endroits, en rouge, en orange ou en bleu,
 * chacune à sa taille. Une seule règle de couleur désormais : BLEU pour ce qui
 * est À LIRE (`lire`), ORANGE pour ce qui attend UNE RÉPONSE (`repondre`) —
 * plus aucune pastille rouge. Le chiffre passe par `chiffreDePastille` (« 99+ »
 * au-delà), et rien ne se dessine à zéro. Chaque appelant pose son propre repère
 * `data-*`.
 *
 * Trois places : `coin` (sur le coin haut droit d'un parent `relative`),
 * `coin-deborde` (centrée sur ce coin, à moitié dehors) et `en-ligne`.
 * `teintee` garde la tenue claire des lignes de la colonne de gauche : liseré,
 * fond et texte d'un même jeton.
 */
export const Pastille = React.forwardRef<
  HTMLSpanElement,
  {
    nombre: number;
    ton: 'lire' | 'repondre';
    position?: 'coin' | 'coin-deborde' | 'en-ligne';
    teintee?: boolean;
    icone?: React.ReactNode;
  } & Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'>
>(({ nombre, ton, position = 'en-ligne', teintee, icone, className, ...props }, ref) => {
  if (!(nombre > 0)) return null;
  return (
    <span
      ref={ref}
      data-pastille={ton}
      className={cn(
        'inline-flex h-4 min-w-4 shrink-0 items-center justify-center gap-0.5 rounded-full px-1 text-[10px] font-semibold leading-none tabular-nums',
        teintee
          ? ton === 'lire'
            ? 'border border-info/30 bg-info/10 text-info'
            : 'border border-warning/30 bg-warning/10 text-warning'
          : ton === 'lire'
            ? 'bg-info text-sur-etat'
            : 'bg-warning text-sur-etat',
        position === 'coin' && 'pointer-events-none absolute -right-0.5 -top-0.5',
        position === 'coin-deborde' && 'pointer-events-none absolute right-0 top-0 z-20 -translate-y-1/2 translate-x-1/2',
        className,
      )}
      {...props}
    >
      {icone}
      {chiffreDePastille(nombre)}
    </span>
  );
});
Pastille.displayName = 'Pastille';

/* ----------------------------- Onglets ---------------------------- */

export const Tabs = TabsPrimitive.Root;

/**
 * LA TENUE D'UNE RANGÉE D'ONGLETS, ISOLÉE POUR ÊTRE RÉUTILISÉE. La silhouette
 * de chargement du tableau (`silhouettes.tsx`) doit réserver EXACTEMENT la
 * hauteur de cette rangée, sinon les colonnes sautent à l'arrivée des cartes.
 * Elle emprunte donc ces classes-ci au lieu de les recopier : la hauteur suit
 * le composant partagé toute seule.
 */
export const CLASSES_LISTE_ONGLETS = 'h-8 items-center gap-0.5 rounded-md bg-surface p-0.5';

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
      CLASSES_LISTE_ONGLETS,
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

/** Une barre dessinée s'éteint après ce temps d'immobilité. */
const REPOS_BARRE_MS = 800;
/** Le pouce ne descend jamais sous cette longueur : il reste saisissable. */
const POUCE_MIN_PX = 24;
/**
 * LE FONDU DE LA BARRE : une entrée courte, qui répond au premier cran de
 * molette, et une sortie plus lente, qui s'efface sans « clignoter ».
 */
const FONDU_ENTREE = 'opacity 140ms ease-out';
const FONDU_SORTIE = 'opacity 420ms ease-in';

/**
 * Une zone qui défile, avec un fondu à ses DEUX BOUTS : le contenu ne se
 * coupe plus net sous les onglets ou au-dessus de la barre d'écriture, il
 * s'efface et se floute en glissant derrière. Le voile prend la couleur du
 * fond courant — donc noir en thème sombre, blanc en thème clair, sans
 * réglage.
 *
 * Le fondu du début ne s'allume que si quelque chose est déjà passé derrière,
 * celui de la fin s'éteint une fois le bout atteint : un voile permanent
 * laisserait croire qu'il reste toujours à lire.
 *
 * À LA VERTICALE, LE FONDU EST D'OFFICE ; À L'HORIZONTALE, IL SE DEMANDE.
 * Sur une barre d'onglets ou un rail, un voile masquerait le bord des
 * éléments sans rien apprendre : l'axe « horizontal » ne pose donc RIEN par
 * défaut. Une bande de cartes qui déborde, elle, gagne à dire qu'il en reste
 * hors du cadre : elle demande alors `voile` (et `barre` pour la barre de
 * défilement dessinée). Sans l'un ni l'autre, l'axe horizontal ne paie ni
 * l'observateur de taille ni un rendu à chaque défilement, comme avant.
 */
/**
 * LA LARGEUR D'UN TIROIR (`Drawer`) : pleine largeur sur téléphone, plafonnée
 * à 960 px sur grand écran. La page « En route » pose sa colonne à la même
 * largeur — une seule valeur pour les deux.
 */
export const CLASSE_LARGEUR_TIROIR = 'max-w-[960px]';

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
     */
    axe?: 'vertical' | 'horizontal';
    /**
     * Le fondu aux deux bouts. Allumé d'office à la verticale, éteint d'office
     * à l'horizontale — où il se demande zone par zone.
     */
    voile?: boolean;
    /**
     * LA BARRE DE DÉFILEMENT DESSINÉE, ALLUMÉE D'OFFICE : celle du navigateur
     * est masquée, et un pouce FIN (3 px) est peint à la place — invisible au
     * repos, qui paraît en fondu pendant le mouvement et s'efface près d'une
     * seconde après, saisissable au pointeur. Ce n'est PAS un glisser-déposer
     * (aucun élément déplacé, aucune cible de dépôt) : le pouce capture son
     * propre pointeur, il ne passe donc pas par `usePointerDrag`.
     * `barre={false}` rend la barre du navigateur (amincie dans styles.css).
     */
    barre?: boolean;
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
    voile: voileDemande,
    barre = true,
    className,
    onScroll,
    children,
    ...props
  },
  ref,
) {
  const horizontal = axe === 'horizontal';
  const avecVoile = voileDemande ?? !horizontal;
  // Sans voile ni barre, il n'y a rien à mesurer.
  const mesureUtile = avecVoile || barre;
  const interne = React.useRef<HTMLDivElement | null>(null);
  const [debut, setDebut] = React.useState(false);
  const [fin, setFin] = React.useState(false);
  /**
   * La zone déborde-t-elle ? Seul ce booléen passe par l'état : la taille et
   * la position du pouce s'écrivent DIRECTEMENT sur son style (`transform`),
   * sans rendu React à chaque cran de défilement.
   */
  const [deborde, setDeborde] = React.useState(false);
  const [enMouvement, setEnMouvement] = React.useState(false);
  const piste = React.useRef<HTMLDivElement | null>(null);
  const pouceRef = React.useRef<HTMLDivElement | null>(null);
  /** La longueur du pouce posée à la dernière mesure, en pixels. */
  const longueurPouce = React.useRef(0);

  const mesurer = React.useCallback(() => {
    const zone = interne.current;
    if (!zone || !mesureUtile) return;
    const position = horizontal ? zone.scrollLeft : zone.scrollTop;
    const vue = horizontal ? zone.clientWidth : zone.clientHeight;
    const total = horizontal ? zone.scrollWidth : zone.scrollHeight;
    setDebut(position > 4);
    setFin(position + vue < total - 4);
    if (!barre) return;
    const part = total > 0 ? Math.min(1, vue / total) : 1;
    const course = Math.max(0, total - vue);
    const avance = course > 0 ? Math.min(1, Math.max(0, position / course)) : 0;
    // UN BOOLÉEN, JAMAIS UN OBJET NEUF. `mesurer` part de l'effet sans
    // dépendances, donc après CHAQUE rendu : un objet neuf à chaque mesure
    // relançait un rendu, qui remesurait, qui relançait… une boucle invisible
    // qui tenait le processeur à ~99 % au repos (`scripts/verif-page-au-repos.mjs`).
    setDeborde(part < 0.999);
    const rail = piste.current;
    const pouceElement = pouceRef.current;
    if (!rail || !pouceElement) return;
    const longueurPiste = horizontal ? rail.clientWidth : rail.clientHeight;
    const longueur = Math.min(longueurPiste, Math.max(POUCE_MIN_PX, part * longueurPiste));
    const decalage = avance * (longueurPiste - longueur);
    longueurPouce.current = longueur;
    if (horizontal) {
      pouceElement.style.width = `${longueur}px`;
      pouceElement.style.transform = `translate3d(${decalage}px, 0, 0)`;
    } else {
      pouceElement.style.height = `${longueur}px`;
      pouceElement.style.transform = `translate3d(0, ${decalage}px, 0)`;
    }
  }, [horizontal, mesureUtile, barre]);

  /*
   * UNE MESURE PAR IMAGE, PAS PAR ÉVÉNEMENT. Une molette à haute résolution
   * ou un pavé tactile tirent plusieurs événements de défilement par image :
   * on n'en retient qu'un, calé sur l'affichage.
   */
  const imageDemandee = React.useRef(0);
  const mesurerAlImage = React.useCallback(() => {
    if (imageDemandee.current) return;
    imageDemandee.current = window.requestAnimationFrame(() => {
      imageDemandee.current = 0;
      mesurer();
    });
  }, [mesurer]);
  React.useEffect(() => () => window.cancelAnimationFrame(imageDemandee.current), []);

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
    if (!zone || !mesureUtile) return;
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

  /*
   * LA BARRE NE SE MONTRE QUE PENDANT LE MOUVEMENT. Chaque événement de
   * défilement rallume le pouce et repousse son extinction ; une main posée
   * sur le pouce le garde allumé tant qu'elle ne l'a pas lâché.
   */
  const minuteur = React.useRef(0);
  const auPouce = React.useRef(false);
  /** Le pointeur est posé sur le pouce visible : il ne s'éteint pas sous lui. */
  const surPouce = React.useRef(false);
  const signalerMouvement = React.useCallback(() => {
    if (!barre) return;
    // Rallumer un pouce déjà allumé ne coûte rien (même valeur, aucun rendu) :
    // une rafale de molette repousse seulement l'extinction, sans repasser par
    // l'opacité nulle — aucun clignotement.
    setEnMouvement(true);
    window.clearTimeout(minuteur.current);
    minuteur.current = window.setTimeout(() => {
      if (!auPouce.current && !surPouce.current) setEnMouvement(false);
    }, REPOS_BARRE_MS);
  }, [barre]);
  React.useEffect(() => () => window.clearTimeout(minuteur.current), []);

  /*
   * Saisir le pouce et le traîner. Le pointeur est CAPTURÉ par le pouce :
   * le geste continue même si la main sort de la piste, et il ne réveille ni
   * le glissement d'une carte ni le défilement de la zone.
   */
  const saisirLePouce = (event: React.PointerEvent<HTMLDivElement>) => {
    const zone = interne.current;
    const rail = piste.current;
    if (!zone || !rail) return;
    event.preventDefault();
    event.stopPropagation();
    const pouceElement = event.currentTarget;
    const depart = horizontal ? event.clientX : event.clientY;
    const departDefilement = horizontal ? zone.scrollLeft : zone.scrollTop;
    const longueurPiste = horizontal ? rail.clientWidth : rail.clientHeight;
    const vue = horizontal ? zone.clientWidth : zone.clientHeight;
    const total = horizontal ? zone.scrollWidth : zone.scrollHeight;
    const course = Math.max(0, total - vue);
    // La course du POUCE sur sa piste : la piste moins le pouce lui-même.
    const courseDuPouce = Math.max(1, longueurPiste - longueurPouce.current);
    pouceElement.setPointerCapture(event.pointerId);
    auPouce.current = true;
    setEnMouvement(true);
    const bouger = (e: PointerEvent) => {
      const ecart = (horizontal ? e.clientX : e.clientY) - depart;
      const voulu = departDefilement + (ecart / courseDuPouce) * course;
      // Écriture DIRECTE, sans animation : le contenu suit la main à l'image
      // près, même si une feuille de style demandait un défilement doux.
      zone.scrollTo(horizontal ? { left: voulu, behavior: 'instant' } : { top: voulu, behavior: 'instant' });
    };
    const lacher = () => {
      auPouce.current = false;
      pouceElement.removeEventListener('pointermove', bouger);
      pouceElement.removeEventListener('pointerup', lacher);
      pouceElement.removeEventListener('pointercancel', lacher);
      signalerMouvement();
    };
    pouceElement.addEventListener('pointermove', bouger);
    pouceElement.addEventListener('pointerup', lacher);
    pouceElement.addEventListener('pointercancel', lacher);
  };

  const visible = barre && enMouvement && deborde;

  const voile = (cote: 'debut' | 'fin', visible: boolean) => {
    if (!avecVoile) return null;
    // Le masque part TOUJOURS du bord concerné et s'efface vers l'intérieur.
    const sens = horizontal
      ? cote === 'debut'
        ? 'right'
        : 'left'
      : cote === 'debut'
        ? 'bottom'
        : 'top';
    return (
      <div
        aria-hidden
        data-voile-defilement={`${axe}-${cote}`}
        data-voile-allume={visible ? 'oui' : 'non'}
        className={cn(
          'pointer-events-none absolute z-10 transition-opacity duration-200',
          horizontal ? 'inset-y-0' : 'inset-x-0',
          horizontal
            ? cote === 'debut'
              ? 'left-0'
              : 'right-0'
            : cote === 'debut'
              ? 'top-0'
              : 'bottom-0',
          visible ? 'opacity-100' : 'opacity-0',
        )}
        style={horizontal ? { width: hauteur } : { height: hauteur }}
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
          mesurerAlImage();
          signalerMouvement();
          onScroll?.(event);
        }}
        className={cn(
          // Un seul axe : un « auto » sur les deux entraîne l'autre.
          horizontal
            ? 'min-w-0 flex-1 overflow-x-auto overflow-y-hidden'
            : 'min-h-0 flex-1 overflow-y-auto overflow-x-hidden',
          // La barre du navigateur laisse la place à celle qu'on dessine.
          barre && 'sans-barre-native',
          className,
        )}
        {...props}
      >
        {children}
      </div>
      {voile('fin', fin)}
      {/* LA BARRE DESSINÉE, par-dessus tout : une piste transparente qui ne
          capte rien, et un pouce qui, lui, se saisit. Elle ne paraît que si
          la zone déborde vraiment (`part < 1`). */}
      {barre ? (
        <div
          ref={piste}
          aria-hidden
          data-barre-defilement={axe}
          data-barre-visible={visible ? 'oui' : 'non'}
          className={cn(
            'pointer-events-none absolute z-20',
            // Trois pixels : deux fois plus fin que l'ancien pouce de six.
            horizontal ? 'inset-x-1 bottom-0.5 h-[3px]' : 'inset-y-1 right-0.5 w-[3px]',
          )}
          style={{ opacity: visible ? 1 : 0, transition: visible ? FONDU_ENTREE : FONDU_SORTIE }}
        >
          <div
            ref={pouceRef}
            data-pouce-defilement={axe}
            onPointerDown={saisirLePouce}
            onPointerEnter={() => {
              surPouce.current = true;
            }}
            onPointerLeave={() => {
              surPouce.current = false;
              signalerMouvement();
            }}
            className={cn(
              'absolute left-0 top-0 rounded-full bg-faint/60 transition-colors hover:bg-faint',
              // Invisible, le pouce ne capte rien : il ne vole aucun clic au
              // contenu qui borde la zone.
              visible ? 'pointer-events-auto' : 'pointer-events-none',
              // Une prise plus large que le trait : trois pixels se visent mal.
              "before:absolute before:content-['']",
              horizontal ? 'h-full before:inset-x-0 before:-inset-y-[5px]' : 'w-full before:inset-y-0 before:-inset-x-[5px]',
            )}
            style={{ touchAction: 'none', willChange: 'transform' }}
          />
        </div>
      ) : null}
    </div>
  );
});

/* ----------------------------- Dialogue --------------------------- */

/**
 * LA FORME EN TROIS PARTIES DE TOUTE FENÊTRE ET DE TOUT TIROIR : un ENTÊTE qui
 * ne défile jamais (titre, description courte, croix), un CORPS qui est le seul
 * à défiler, et un PIED d'action facultatif collé en bas. Avant, la fenêtre de
 * base mettait tout dans une seule zone : dans un formulaire long (réglages du
 * projet), le titre partait en haut et « Enregistrer » se cachait tout en bas.
 *
 * `DialogContent` REPÈRE ces emplacements parmi ses enfants directs (fragments
 * compris) : un `DialogHeader` va en tête, un `DialogFooter` en pied, tout le
 * reste dans la zone qui défile. Une fenêtre qui n'en pose aucun garde son
 * ancien rendu, et une fenêtre sans boutons n'a pas de pied vide.
 */
export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-fenetre-entete className={cn('shrink-0 px-4 pb-2 pr-10 pt-4', className)} {...props} />;
}

/**
 * LE PIED D'ACTION : même fond que la fenêtre, boutons alignés à droite, et il
 * reste AU-DESSUS de la barre d'accueil du téléphone (zone sûre du bas). Dans
 * un tiroir, il se pose après la `ZoneDefilement` du corps, jamais dedans.
 */
export function DialogFooter({
  className,
  style,
  pleineLargeur,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  /**
   * LE PIED D'UN PARCOURS : ses boutons s'empilent et prennent TOUTE la largeur,
   * le principal en premier — plus rien d'aligné à droite. Le retour, lui, vit
   * en haut à gauche de la fenêtre (Studio : mise en production, nouvelle création).
   */
  pleineLargeur?: boolean;
}) {
  return (
    <div
      data-fenetre-pied={pleineLargeur ? 'pleine-largeur' : ''}
      className={cn(
        'flex shrink-0 bg-surface px-4 pt-3',
        pleineLargeur ? 'flex-col items-stretch gap-2 [&>*]:w-full' : 'flex-wrap items-center justify-end gap-1.5 gap-y-2',
        className,
      )}
      style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))', ...style }}
      {...props}
    />
  );
}

function repartirEmplacements(children: React.ReactNode) {
  const entete: React.ReactNode[] = [];
  const pied: React.ReactNode[] = [];
  const corps: React.ReactNode[] = [];
  const parcourir = (noeuds: React.ReactNode, prefixe: string) => {
    React.Children.toArray(noeuds).forEach((enfant) => {
      if (!React.isValidElement(enfant)) {
        corps.push(enfant);
        return;
      }
      const cle = `${prefixe}${enfant.key ?? ''}`;
      if (enfant.type === React.Fragment) {
        parcourir((enfant.props as { children?: React.ReactNode }).children, cle);
        return;
      }
      const place = React.cloneElement(enfant, { key: cle });
      if (enfant.type === DialogHeader) entete.push(place);
      else if (enfant.type === DialogFooter) pied.push(place);
      else corps.push(place);
    });
  };
  parcourir(children, '');
  return { entete, pied, corps };
}

export const Dialog = DialogPrimitive.Root;

export function DialogContent({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>) {
  const { entete, pied, corps } = repartirEmplacements(children);
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-voile/70 backdrop-blur-[2px] data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
      {/*
       * La fenêtre est POSÉE par une enveloppe en flux (collée en bas sur
       * téléphone, centrée sur grand écran), jamais par un décalage de moitié :
       * l'animation d'ouverture écrase le décalage le temps qu'elle dure, et la
       * fenêtre partait alors se coller au bord droit de l'écran.
       *
       * L'enveloppe s'arrête AU-DESSUS DU CLAVIER du téléphone (`--clavier`,
       * mesuré par l'application) : le pied d'action reste touchable.
       */}
      <div
        className="pointer-events-none fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-3"
        style={{ paddingBottom: 'var(--clavier, 0px)' }}
      >
        <DialogPrimitive.Content
          className={cn(
            'pointer-events-auto relative flex max-h-[85dvh] w-full min-h-0 flex-col overflow-hidden border-t border-border bg-surface shadow-2xl',
            'rounded-t-xl data-[state=open]:animate-slide-sheet data-[state=closed]:animate-slide-sheet-out',
            'sm:w-[min(560px,100%)] sm:rounded-lg sm:border sm:data-[state=open]:animate-slide-up sm:data-[state=closed]:animate-slide-down',
            className,
          )}
          {...props}
        >
          {entete}
          {/* Le contenu d'une fenêtre déborde souvent : il s'efface au bord
              plutôt que de se couper net sous l'entête ou le pied. */}
          <ZoneDefilement
            fond="hsl(var(--surface))"
            data-fenetre-corps
            className={cn('px-4', entete.length ? 'pt-1' : 'pt-4', pied.length ? 'pb-3' : null)}
            style={pied.length ? undefined : { paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
          >
            {corps}
          </ZoneDefilement>
          {pied}
          <DialogPrimitive.Close className="absolute right-3 top-3 z-10 rounded p-1 text-faint hover:bg-raised hover:text-text">
            <X className="h-3.5 w-3.5" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </div>
    </DialogPrimitive.Portal>
  );
}

/**
 * LA MÊME FENÊTRE, MAIS SANS ZONE DE DÉFILEMENT IMPOSÉE. `DialogContent` pose
 * une `ZoneDefilement` unique autour de son contenu : parfait pour une question
 * ou un formulaire, impossible pour un écran à DEUX COLONNES qui défilent
 * chacune de leur côté (les réglages). Ici, le contenu reçoit une boîte en
 * colonne, à lui de poser ses propres zones — la règle « toute zone qui défile
 * passe par ZoneDefilement » vaut toujours, elle est simplement appliquée un
 * cran plus bas.
 */
export function DialogContentLibre({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-voile/70 backdrop-blur-[2px] data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
      <div
        className="pointer-events-none fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-3"
        style={{ paddingBottom: 'var(--clavier, 0px)' }}
      >
        <DialogPrimitive.Content
          className={cn(
            'pointer-events-auto relative flex max-h-[85dvh] w-full min-h-0 flex-col overflow-hidden border-t border-border bg-surface shadow-2xl',
            'rounded-t-xl data-[state=open]:animate-slide-sheet data-[state=closed]:animate-slide-sheet-out',
            'sm:w-[min(560px,100%)] sm:rounded-lg sm:border sm:data-[state=open]:animate-slide-up sm:data-[state=closed]:animate-slide-down',
            className,
          )}
          {...props}
        >
          {children}
          <DialogPrimitive.Close className="absolute right-3 top-3 z-10 rounded p-1 text-faint hover:bg-raised hover:text-text">
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
  enPage,
  plein,
  hauteurFixe,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  /**
   * LA FEUILLE PREND TOUTE LA HAUTEUR : le tiroir d'une carte sur téléphone,
   * où chaque pixel rendu au flux compte. Ailleurs, la feuille garde sa marge
   * de 8 % en haut, qui laisse voir qu'on est posé par-dessus le tableau.
   */
  plein?: boolean;
  /**
   * LA FEUILLE GARDE LA MÊME HAUTEUR, PLEINE OU VIDE : le tiroir d'une tâche,
   * qui s'ouvre sur une silhouette puis se remplit. Sans cette hauteur, la
   * feuille suivait son contenu — basse pendant l'attente, puis d'un bond à
   * 92 % à l'arrivée des données. Elle ne se pose QUE là : les tiroirs courts
   * (quotas, déploiement, backups, espace client) resteraient à moitié
   * vides.
   */
  hauteurFixe?: boolean;
  /** Un tiroir ouvert PAR-DESSUS un autre tiroir déjà ouvert : une ombre plus
   * marquée fait sentir la couche du dessus. */
  empile?: boolean;
  /**
   * LE MÊME CONTENU, MAIS EN ÉCRAN PLEIN : ni voile, ni feuille qui monte, ni
   * poignée à tirer. Le coffre-fort, les backups et la surveillance sont des
   * DESTINATIONS de la colonne de gauche, pas des panneaux posés par-dessus le
   * tableau : ils occupent tout le volet central, et on en sort en cliquant
   * ailleurs dans la colonne — il n'y a plus de croix à chercher.
   *
   * L'enveloppe Radix est conservée (sans portail ni voile) pour que les
   * `DialogTitle` des trois écrans restent valides et lus à voix haute.
   */
  enPage?: boolean;
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
      // Un pointeur qui n'existe pas — un événement fabriqué par un contrôle —
      // fait lever cette capture : le geste ne doit pas mourir pour autant.
      try {
        (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
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
      /*
       * `onClose()` NE PEUT PAS VIVRE DANS LA FONCTION DE MISE À JOUR. React la
       * joue pendant le RENDU, et changer l'état d'un composant PARENT à ce
       * moment-là est une faute qu'il signale en console (« Cannot update a
       * component while rendering a different component »). On lit donc le
       * déplacement tel quel, on remet la feuille à zéro, puis on referme.
       */
      const tire = decalage;
      setDecalage(0);
      if (tire > 110) onClose();
    },
  };

  if (enPage) {
    return (
      <DialogPrimitive.Root open={open} modal={false} onOpenChange={() => undefined}>
        <DialogPrimitive.Content
          data-ecran-plein
          onInteractOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.preventDefault()}
          // AUCUN CONTOUR DE FOCUS SUR L'ÉCRAN ENTIER : la fenêtre reçoit le focus à
          // l'ouverture, et le navigateur l'entourait d'un cadre bleu (capture #e021).
          // Les boutons qu'elle contient gardent leur propre anneau.
          className={cn('flex h-full min-h-0 w-full flex-col pt-3 outline-none', className)}
          style={{
            // La zone qui défile à l'intérieur prend le fond de la page, pas
            // celui d'un tiroir : l'écran plein n'est plus une feuille posée.
            ['--fond-zone-defilement' as string]: 'hsl(var(--bg))',
          }}
        >
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Root>
    );
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-voile/70 backdrop-blur-[2px] data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
        <DialogPrimitive.Content
          data-tiroir={plein ? 'plein' : 'normal'}
          data-tiroir-empile={empile ? 'oui' : undefined}
          className={cn(
            // Sur téléphone il occupe toute la largeur ; sur grand écran il se
            // pose au centre, plafonné à 960 px : au-delà, les lignes de texte
            // deviennent trop longues pour être lues confortablement.
            'fixed inset-x-0 z-50 mx-auto flex w-full flex-col overflow-hidden bg-surface outline-none',
            CLASSE_LARGEUR_TIROIR,
            'rounded-t-xl sm:rounded-t-2xl',
            // Une feuille qui MONTE : le décalage de 6 px des fenêtres se
            // voyait à peine sur un panneau de cette taille.
            'data-[state=open]:animate-slide-sheet data-[state=closed]:animate-slide-sheet-out',
            // AUCUN LISERÉ. Le trait clair du bord haut se lisait comme une
            // bordure blanche posée par erreur ; la feuille se détache par son
            // fond (`bg-surface`, plus clair que la page), son voile et son
            // ombre. Le tiroir empilé garde une ombre plus marquée.
            empile
              ? 'shadow-[0_-14px_38px_-10px_rgba(0,0,0,0.7)]'
              : 'shadow-[0_-10px_30px_-12px_rgba(0,0,0,0.55)]',
            className,
          )}
          style={{
            // La hauteur suit le contenu — plafonnée pour ne pas dépasser l'écran —
            // SAUF quand le tiroir demande une hauteur fixe (`hauteurFixe`) : un
            // tiroir qui s'ouvre sur une silhouette puis se remplit ne doit pas
            // grandir d'un bond sous les yeux. Les autres gardent leur hauteur à
            // la demande, pour ne pas être vides en bas quand le contenu est court.
            bottom: 'var(--clavier, 0px)',
            /*
             * LE TIROIR S'ARRÊTE SOUS LA BARRE D'ÉTAT, JAMAIS DESSOUS. En mode
             * plein il montait à 10 px du bord haut — une marge FIXE, qui
             * ignorait la zone sûre : sur un iPhone, l'entête du tiroir passait
             * sous l'heure et la batterie. Le plafond suit maintenant la zone
             * sûre du haut, et garde les 10 px là où il n'y en a pas
             * (ordinateur, Android sans encoche) : rien ne bouge d'un pixel où
             * rien ne débordait.
             */
            maxHeight: plein
              ? 'calc(100dvh - max(10px, var(--zone-sure-haut, 0px)) - var(--clavier, 0px))'
              : 'calc(92dvh - var(--clavier, 0px))',
            /*
             * EN MODE PLEIN, C'EST UNE HAUTEUR, PAS UN PLAFOND. Le plafond
             * seul laissait la feuille suivre son contenu : une fiche courte
             * s'arrêtait au milieu de l'écran, et la bande morte du haut
             * revenait. On demande donc la hauteur ENTIÈRE — le corps prend le
             * reste en `flex-1`, et la fiche touche vraiment le bord haut.
             *
             * MÊME RAISON POUR `hauteurFixe`, sur ordinateur : la feuille vaut
             * son plafond, exactement, avant comme après l'arrivée du contenu.
             */
            height: plein
              ? 'calc(100dvh - max(10px, var(--zone-sure-haut, 0px)) - var(--clavier, 0px))'
              : hauteurFixe
                ? 'calc(92dvh - var(--clavier, 0px))'
                : undefined,
            /* Le CONTENU s'arrête au-dessus de la barre d'accueil ; le fond du
               tiroir, lui, va jusqu'au bord — sinon une bande vide apparaîtrait. */
            paddingBottom: 'var(--zone-sure-bas, 0px)',
            transform: decalage ? `translateY(${decalage}px)` : undefined,
            transition: depart.current === null ? 'transform 180ms ease-out' : undefined,
            // Le fond du tiroir est gris cendré (bg-surface) : toute zone qui
            // défile à l'intérieur, sans couleur de fondu imposée, doit le
            // savoir pour ne pas garder un fondu noir.
            ['--fond-zone-defilement' as string]: 'hsl(var(--surface))',
          }}
        >
          {/* La poignée : on la tire vers le bas pour refermer. Plus d'air AU-DESSUS
              qu'en dessous : collée au bord, elle se perdait sur téléphone. */}
          <div
            {...poignee}
            onPointerCancel={poignee.onPointerUp}
            data-poignee-tiroir
            className={cn(
              'flex shrink-0 cursor-grab touch-none justify-center active:cursor-grabbing',
              plein ? 'pb-2 pt-3.5' : 'pb-3 pt-5',
            )}
          >
            <DialogPrimitive.Close className="h-1 w-10 rounded-full bg-muted transition-colors hover:bg-text" />
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
      try {
        (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
      } catch {
        /* rien à capturer : les écouteurs suffisent */
      }
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
            <span className="h-10 w-1 rounded-full bg-muted transition-colors hover:bg-text" />
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

/**
 * L'INFOBULLE DE L'APPLICATION — UN SEUL DESSIN, RAPIDE, EN FONDU.
 *
 * Elle s'ouvre en 120 ms (la bulle native des navigateurs attend près d'une
 * seconde), entre et sort en fondu, et n'existe JAMAIS sans survol (doigt,
 * stylet). Deux portes, un seul aspect (`CLASSES_INFOBULLE`) :
 *  - `Tooltip`, pour un contenu riche posé sur un déclencheur ;
 *  - `InfobullesDeLApplication`, montée une fois, qui reprend TOUS les
 *    attributs `title` de l'application : un `title` écrit n'importe où devient
 *    cette bulle, sans rien changer à l'écran qui le porte.
 */
export const DELAI_INFOBULLE_MS = 120;

const CLASSES_INFOBULLE =
  'pointer-events-none z-[100] max-w-[280px] select-none whitespace-pre-line rounded-md border border-border bg-raised px-2 py-1.5 text-[13px] leading-snug text-text shadow-xl';

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={DELAI_INFOBULLE_MS} skipDelayDuration={400}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

export function Tooltip({ children, label }: { children: React.ReactNode; label: React.ReactNode }) {
  const survol = useSurvol();
  // Sans survol, l'infobulle ne s'affichera JAMAIS (elle est masquée en dessous
  // de `sm`) : son déclencheur ne ferait que s'interposer entre le doigt et ce
  // qu'il vise — un interrupteur, par exemple. On ne le pose donc pas du tout.
  if (!label || !survol) return <>{children}</>;
  return (
    <TooltipPrimitive.Root delayDuration={DELAI_INFOBULLE_MS}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        {/* Sur téléphone, l'infobulle n'a AUCUN sens (rien ne survole) et la
            règle qui pose les menus en tiroir la collait en bas de l'écran,
            sous le bouton de redémarrage. On ne l'affiche qu'à la souris. */}
        <TooltipPrimitive.Content
          data-infobulle
          sideOffset={6}
          className={cn(
            CLASSES_INFOBULLE,
            'pointer-events-auto hidden sm:block',
            'data-[state=delayed-open]:animate-fade-in data-[state=instant-open]:animate-fade-in data-[state=closed]:animate-fade-out',
          )}
        >
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/**
 * LA COUCHE DES INFOBULLES — chaque `title` de l'application, rendu par la bulle
 * maison. À l'entrée de la souris sur un élément qui porte un `title`,
 * l'attribut est mis de côté (`data-infobulle-titre`) : la bulle native, lente,
 * ne paraît donc jamais ; il est rendu dès que la souris sort, appuie ou que la
 * page défile. La bulle se pose au-dessus de l'élément (en dessous faute de
 * place), centrée, tenue dans l'écran.
 *
 * Sous un navigateur PILOTÉ (contrôles automatiques : `navigator.webdriver`),
 * l'attribut reste en place : la bulle native n'y est jamais dessinée, et les
 * contrôles qui lisent `title` le lisent toujours.
 */
export function InfobullesDeLApplication() {
  const survol = useSurvol();
  const [bulle, setBulle] = React.useState<{ texte: string; rect: DOMRect; visible: boolean } | null>(null);
  const boite = React.useRef<HTMLDivElement | null>(null);
  const [place, setPlace] = React.useState<{ left: number; top: number } | null>(null);

  React.useEffect(() => {
    if (!survol) return;
    const pilote = typeof navigator !== 'undefined' && navigator.webdriver === true;
    let cible: HTMLElement | null = null;
    let ouverture = 0;
    let effacement = 0;
    let derniereFermeture = 0;
    const rendre = (el: HTMLElement | null) => {
      if (!el) return;
      const mis = el.getAttribute('data-infobulle-titre');
      if (mis === null) return;
      el.removeAttribute('data-infobulle-titre');
      // React a pu reposer un nouveau `title` entre-temps : c'est lui qui gagne.
      if (!el.hasAttribute('title')) el.setAttribute('title', mis);
    };
    const fermer = () => {
      window.clearTimeout(ouverture);
      if (!cible) return;
      rendre(cible);
      cible = null;
      derniereFermeture = Date.now();
      setBulle((b) => (b ? { ...b, visible: false } : b));
      window.clearTimeout(effacement);
      effacement = window.setTimeout(() => setBulle((b) => (b && !b.visible ? null : b)), 200);
    };
    const entrer = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const el = (e.target as Element | null)?.closest?.('[title],[data-infobulle-titre]') as HTMLElement | null;
      if (el === cible) return;
      fermer();
      if (!el) return;
      const texte = (el.getAttribute('title') ?? el.getAttribute('data-infobulle-titre') ?? '').trim();
      if (!texte) return;
      cible = el;
      if (!pilote && el.hasAttribute('title')) {
        el.setAttribute('data-infobulle-titre', el.getAttribute('title')!);
        el.removeAttribute('title');
      }
      // D'une bulle à la voisine, sans attendre : on lit une rangée d'icônes d'un geste.
      const delai = Date.now() - derniereFermeture < 400 ? 0 : DELAI_INFOBULLE_MS;
      ouverture = window.setTimeout(() => {
        if (cible !== el || !el.isConnected) return;
        window.clearTimeout(effacement);
        setBulle({ texte, rect: el.getBoundingClientRect(), visible: true });
      }, delai);
    };
    const sortir = (e: PointerEvent) => {
      if (!cible) return;
      const vers = e.relatedTarget as Node | null;
      if (vers && cible.contains(vers)) return;
      fermer();
    };
    document.addEventListener('pointerover', entrer, true);
    document.addEventListener('pointerout', sortir, true);
    document.addEventListener('pointerdown', fermer, true);
    document.addEventListener('keydown', fermer, true);
    window.addEventListener('scroll', fermer, true);
    window.addEventListener('blur', fermer);
    return () => {
      fermer();
      window.clearTimeout(effacement);
      document.removeEventListener('pointerover', entrer, true);
      document.removeEventListener('pointerout', sortir, true);
      document.removeEventListener('pointerdown', fermer, true);
      document.removeEventListener('keydown', fermer, true);
      window.removeEventListener('scroll', fermer, true);
      window.removeEventListener('blur', fermer);
    };
  }, [survol]);

  /* La place : centrée au-dessus de l'élément, en dessous s'il touche le haut, toujours dans l'écran. */
  React.useLayoutEffect(() => {
    if (!bulle || !boite.current) return;
    const { width, height } = boite.current.getBoundingClientRect();
    const centre = bulle.rect.left + bulle.rect.width / 2;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, centre - width / 2));
    const dessus = bulle.rect.top - height - 6;
    setPlace({ left, top: dessus >= 8 ? dessus : bulle.rect.bottom + 6 });
  }, [bulle?.texte, bulle?.rect]);

  if (!bulle) return null;
  return ReactDOM.createPortal(
    <div
      ref={boite}
      role="tooltip"
      data-infobulle
      className={cn(CLASSES_INFOBULLE, 'fixed transition-opacity duration-150', bulle.visible && place ? 'animate-fade-in opacity-100' : 'opacity-0')}
      style={{ left: place?.left ?? -9999, top: place?.top ?? -9999 }}
    >
      {bulle.texte}
    </div>,
    document.body,
  );
}

/* --------------------------- Bulle « i » -------------------------- */

/**
 * UN BOUTON « i » ET SA BULLE : les explications qui n'appellent aucune
 * réaction, rangées hors du corps d'une carte. Contrairement à `Tooltip`, elle
 * existe AUSSI sans survol : la souris l'ouvre en passant, le doigt d'un appui.
 * Posée dans un menu déroulant, un appui dans la bulle ne ferme pas le menu —
 * la bibliothèque compte la bulle comme faisant partie de l'arbre du menu.
 *
 * C'EST LA SEULE PLACE D'UNE EXPLICATION D'ÉCRAN OU DE RÉGLAGE : la phrase qui
 * dit à quoi sert une page, un groupe ou un champ ne s'affiche plus en
 * paragraphe grisé sous son titre, elle vit ici, posée juste après le titre.
 * `cote` aligne la bulle sur le bouton : « start » quand le « i » suit un titre
 * à gauche, « end » (défaut) quand il est rangé à droite d'une ligne.
 */
export function BulleInfo({
  children,
  label,
  cote = 'end',
}: {
  children: React.ReactNode;
  label?: string;
  cote?: 'start' | 'end';
}) {
  const [ouvert, setOuvert] = React.useState(false);
  const fermeture = React.useRef<number | undefined>(undefined);
  const pointeur = React.useRef('');
  const entrer = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    window.clearTimeout(fermeture.current);
    setOuvert(true);
  };
  const sortir = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    fermeture.current = window.setTimeout(() => setOuvert(false), 160);
  };
  React.useEffect(() => () => window.clearTimeout(fermeture.current), []);

  return (
    <PopoverPrimitive.Root open={ouvert} onOpenChange={setOuvert}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={label ?? t('Explications')}
          data-bulle-info-bouton
          onPointerDown={(e) => {
            pointeur.current = e.pointerType;
          }}
          onPointerEnter={entrer}
          onPointerLeave={sortir}
          onClick={(e) => {
            // Le survol l'a déjà ouverte : le clic de souris la garde ouverte
            // au lieu de la refermer aussitôt.
            if (pointeur.current === 'mouse' && ouvert) e.preventDefault();
          }}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-bloc hover:text-text data-[state=open]:text-text"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          data-bulle-info
          side="bottom"
          align={cote}
          sideOffset={6}
          collisionPadding={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onPointerEnter={entrer}
          onPointerLeave={sortir}
          className="z-50 max-w-[300px] select-text whitespace-pre-line rounded-md border border-border bg-raised px-2.5 py-2 text-[12.5px] font-normal normal-case leading-relaxed tracking-normal text-muted shadow-xl animate-fade-in max-sm:max-w-none max-sm:rounded-b-none max-sm:px-4 max-sm:pb-6 max-sm:pt-3"
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
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
      // Un pointeur qui n'existe pas — un événement fabriqué par un contrôle —
      // fait lever cette capture : le geste ne doit pas mourir pour autant.
      try {
        (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
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
          <span className="h-1 w-10 rounded-full bg-muted transition-colors hover:bg-text" />
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
    <div className={cn('w-full overflow-hidden rounded-full bg-faint/25', height, className)} data-jauge-rail>
      <div className={cn('h-full rounded-full transition-all duration-500', color)} style={{ width: `${pct}%`, minWidth: pct > 0 ? 4 : 0 }} />
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
  confirmLabel = t('Valider'),
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
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
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
          className="mt-2"
        />
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('Annuler')}</Button>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = t('Confirmer'),
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
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {description ? <DialogDescription className="mt-0">{description}</DialogDescription> : null}
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('Annuler')}</Button>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------- Les briques d'un écran dense ------------------ *
 *
 * TROIS BRIQUES, ÉCRITES POUR TOUTE L'APPLICATION — pas pour un écran.
 *
 *  - `BlocRepliable` : un titre, un chevron, un contenu. L'état d'ouverture est
 *    retenu PAR APPAREIL quand on lui donne une clé ;
 *  - `SelecteurTiroir` : le remplaçant d'une liste native. Il montre la valeur
 *    courante et ouvre le TIROIR de l'application (`Drawer`, celui des réglages
 *    de l'agent) avec un champ de recherche et une coche sur la valeur retenue ;
 *  - `MenuActions` : le bouton « … » qui range les gestes rares dans ce même
 *    tiroir, avec un repère chiffré quand quelque chose est actif.
 *
 * Aucune ne connaît l'écran qui l'emploie : elles ne parlent qu'en jetons de
 * thème et passent leurs textes par `t()`.
 */

/** L'état d'un bloc, retenu par appareil : `null` quand aucune clé n'est donnée. */
function useEtatRetenu(clef: string | undefined, defaut: boolean) {
  const [ouvert, setOuvert] = React.useState(() => {
    if (!clef || typeof window === 'undefined') return defaut;
    const garde = window.localStorage.getItem(`beluga.bloc.${clef}`);
    return garde === null ? defaut : garde === '1';
  });
  const basculer = React.useCallback(() => {
    setOuvert((avant) => {
      const suite = !avant;
      if (clef && typeof window !== 'undefined') {
        window.localStorage.setItem(`beluga.bloc.${clef}`, suite ? '1' : '0');
      }
      return suite;
    });
  }, [clef]);
  return [ouvert, basculer] as const;
}

export function BlocRepliable({
  titre,
  repere,
  clef,
  defautOuvert = true,
  compte,
  action,
  children,
  className,
}: {
  titre: string;
  /** Le marqueur porté par le bloc, pour les contrôles. */
  repere: string;
  /** La clé de mémoire, si l'état doit survivre à la fermeture de l'écran. */
  clef?: string;
  defautOuvert?: boolean;
  /** Un chiffre discret à droite du titre — le nombre d'éléments dedans. */
  compte?: number | string;
  /** Un bouton posé au bout de la ligne de titre, hors du bouton de repli. */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const [ouvert, basculer] = useEtatRetenu(clef, defautOuvert);
  return (
    <section
      className={cn('flex flex-col', className)}
      data-bloc-repliable={repere}
      data-bloc-ouvert={ouvert ? '' : undefined}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={basculer}
          aria-expanded={ouvert}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left text-[11px] uppercase tracking-wide text-faint transition-colors hover:text-text"
          data-bloc-bascule={repere}
        >
          <ChevronDown
            className={cn('h-3.5 w-3.5 shrink-0 transition-transform', ouvert ? '' : '-rotate-90')}
            aria-hidden
          />
          <span className="truncate">{titre}</span>
          {compte !== undefined && compte !== 0 ? (
            <span className="shrink-0 text-faint">({compte})</span>
          ) : null}
        </button>
        {action ? <span className="shrink-0">{action}</span> : null}
      </div>
      {/* Le contenu est RETIRÉ du flux quand le bloc est replié : un `hidden`
          laisserait ses champs accessibles au clavier et à un contrôle. */}
      {ouvert ? <div className="pb-1">{children}</div> : null}
    </section>
  );
}

/** Une section d'accordéon : son nom, ce qu'elle vaut, ce qu'elle contient. */
export interface SectionAccordeon {
  clef: string;
  titre: string;
  /** Ce que la section vaut aujourd'hui, LU SANS L'OUVRIR — « Normale », « 3 juin ». */
  resume?: string;
  icone?: React.ReactNode;
  contenu: React.ReactNode;
}

/**
 * L'ACCORDÉON : PLUSIEURS SECTIONS, UNE SEULE OUVERTE À LA FOIS.
 *
 * Ce n'est pas une pile de `BlocRepliable` : là, chacun s'ouvre de son côté et
 * l'écran s'allonge sans fin. Ici, ouvrir une section referme la précédente —
 * la hauteur reste tenue, et l'on voit toujours la LISTE des réglages
 * possibles, ce qu'une pile de blocs dépliés fait perdre.
 *
 * CHAQUE SECTION DIT SA VALEUR SANS S'OUVRIR (`resume`) : on lit d'un regard
 * « Anomalie · Haute · 3 juin » et l'on n'ouvre que ce qu'on veut changer.
 *
 * Rien de propre à l'espace client ici : la fiche d'une demande et le
 * formulaire de création s'en servent tous deux, avec les mêmes sections.
 */
export function Accordeon({
  sections,
  repere,
  ouverteParDefaut = null,
  className,
  variante = 'traits',
}: {
  sections: SectionAccordeon[];
  /** Le marqueur porté par l'accordéon, pour les contrôles. */
  repere: string;
  /** La section ouverte au premier affichage — aucune, par défaut. */
  ouverteParDefaut?: string | null;
  className?: string;
  /**
   * « traits » : les sections se séparent d'un trait. « blocs » : AUCUN trait,
   * chaque section posée sur un fond un cran plus sombre que ce qui la porte
   * (`surface` sur `raised`), avec un petit espace entre les blocs — la
   * hiérarchie passe par les fonds, dans les douze palettes.
   */
  variante?: 'traits' | 'blocs';
}) {
  const [ouverte, setOuverte] = React.useState<string | null>(ouverteParDefaut);
  const blocs = variante === 'blocs';
  return (
    <div className={cn('flex flex-col', blocs && 'gap-1.5', className)} data-accordeon={repere} data-accordeon-variante={variante}>
      {sections.map((section) => {
        const ouvert = section.clef === ouverte;
        return (
          <section
            key={section.clef}
            /* Un trait qui SÉPARE deux sections porte une information : `--faint`. */
            className={blocs ? 'rounded-md bg-surface px-2.5' : 'border-b border-faint/40 last:border-b-0'}
            data-accordeon-section={section.clef}
            data-accordeon-ouverte={ouvert ? '' : undefined}
          >
            <button
              type="button"
              onClick={() => setOuverte(ouvert ? null : section.clef)}
              aria-expanded={ouvert}
              className="flex w-full min-w-0 items-center gap-2 py-2 text-left transition-colors hover:text-text"
              data-accordeon-bascule={section.clef}
            >
              <ChevronDown
                className={cn('h-3.5 w-3.5 shrink-0 text-faint transition-transform', ouvert ? '' : '-rotate-90')}
                aria-hidden
              />
              {section.icone ? <span className="shrink-0 text-faint">{section.icone}</span> : null}
              <span className="min-w-0 flex-1 truncate text-[13px] text-text">{section.titre}</span>
              {/* La valeur du moment, tant que la section est fermée. */}
              {section.resume && !ouvert ? (
                <span className="min-w-0 max-w-[50%] truncate text-[11.5px] text-faint" data-accordeon-resume>
                  {section.resume}
                </span>
              ) : null}
            </button>
            {/* Replié, le contenu QUITTE le flux : sinon ses champs resteraient
                joignables au clavier et à un contrôle. */}
            {ouvert ? <div className="pb-3">{section.contenu}</div> : null}
          </section>
        );
      })}
    </div>
  );
}

/** Une option d'une liste déroulante : ce qu'elle montre, ce qu'elle rend. */
export interface OptionSelecteur {
  valeur: string;
  libelle: string;
  /** Une ligne grise sous le libellé — un projet, une description, un compte de non-lus. */
  detail?: string;
  /**
   * Ce qui se pose AU BOUT de la ligne, juste avant la coche du choix retenu :
   * des pastilles, un état. La recherche ne le lit pas — elle ne filtre que sur
   * le libellé et le détail.
   */
  fin?: React.ReactNode;
  /** Une icône devant le libellé (aussi montrée par le déclencheur quand l'option est retenue). */
  icone?: React.ReactNode;
  /** Le style du LIBELLÉ seul (une police montrée dans sa police), repris par le déclencheur quand l'option est retenue. */
  style?: React.CSSProperties;
  /**
   * UN GESTE PROPRE À LA LIGNE, à droite : écouter une voix, prévisualiser. Il
   * ne CHOISIT pas l'option et ne referme pas la liste.
   */
  action?: { libelle: string; icone: React.ReactNode; onClick: () => void; active?: boolean };
  /** Montrée mais pas choisissable (un format déjà pris, une voix pas prête). */
  desactivee?: boolean;
  /** L'intertitre sous lequel l'option se range ; les options d'un groupe se suivent. */
  groupe?: string;
  /** Des marqueurs posés sur la ligne, pour les contrôles (`data-membre-de` d'un projet réuni…). */
  attributs?: Record<`data-${string}`, string | undefined>;
}

/**
 * LE CLIC QUI FERME UNE LISTE NE LA ROUVRE PAS.
 *
 * Une liste ouverte se ferme au `pointerdown` extérieur (Radix). Le `click` du
 * MÊME geste arrivait ensuite sur son déclencheur — ou sur le libellé du champ,
 * un `<label>` qui renvoie le clic à son bouton — et la rouvrait aussitôt : il
 * fallait cliquer plusieurs fois pour s'en débarrasser (Studio, 06.10.2026).
 * Le geste qui ferme est donc marqué jusqu'à son `click`, et aucun `ouvrir`
 * déclenché par un événement ne passe pendant ce temps.
 */
let gesteDeFermeture = false;
let numeroDuGeste = 0;
function marquerGesteDeFermeture() {
  const numero = ++numeroDuGeste;
  const debut = performance.now();
  gesteDeFermeture = true;
  const finir = () => {
    window.removeEventListener('click', lever, { capture: true });
    window.removeEventListener('pointerdown', suivant, { capture: true });
    if (numero === numeroDuGeste) gesteDeFermeture = false;
  };
  // Levée APRÈS le `click` : ses gestionnaires (bouton, libellé) le voient encore.
  const lever = () => window.setTimeout(finir, 0);
  /* UN NOUVEAU GESTE lève la marque de l'ancien : un geste dont le `click` ne
     vient jamais (relâché ailleurs, avalé) bloquait sinon le clic suivant sur
     le déclencheur pendant une seconde — la liste ne se rouvrait pas. */
  const suivant = (e: PointerEvent) => {
    if (e.timeStamp > debut) finir();
  };
  window.addEventListener('click', lever, { capture: true, once: true });
  window.addEventListener('pointerdown', suivant, { capture: true });
  // Un geste sans `click` (glisser, appui long) ne doit pas bloquer la suite.
  window.setTimeout(finir, 1000);
}

/**
 * LA LISTE DÉROULANTE DE L'APPLICATION — elle remplace TOUTE liste native
 * (`<select>`) et l'ancien sélecteur en tiroir.
 *
 * Sur ORDINATEUR, elle s'ouvre ANCRÉE sous son déclencheur (panneau flottant,
 * même largeur au moins) ; sur TÉLÉPHONE, elle monte du bas comme un tiroir —
 * sous le pouce. Le corps est le même des deux côtés : recherche dès que les
 * choix dépassent `seuilRecherche`, icône, description sur une seconde ligne,
 * coche du choix retenu, geste propre à chaque ligne (▶ écouter), intertitres,
 * et le CLAVIER (flèches, Début/Fin, Entrée, Échap ; la frappe va à la recherche).
 *
 * Une ligne d'option est un `div role="option"`, jamais un `button` : elle peut
 * porter son propre bouton (le geste à droite) et un texte replié.
 */
export function ListeDeroulante({
  valeur,
  options,
  onChoisir,
  titre,
  placeholder,
  repere,
  icone,
  seuilRecherche = 6,
  className,
  declencheur,
  empile,
  pied,
  actionTitre,
  variante = 'champ',
  desactivee,
  marques = 'liste',
  surOuverture,
  ...attributs
}: {
  valeur: string;
  options: OptionSelecteur[];
  onChoisir: (valeur: string) => void;
  /** Le titre de la liste (entête du tiroir sur téléphone, nom lu à voix haute). */
  titre: string;
  /** Ce qu'affiche le déclencheur quand rien n'est retenu. */
  placeholder?: string;
  /** Le marqueur du déclencheur, pour les contrôles ; les options portent leur valeur. */
  repere?: string;
  icone?: React.ReactNode;
  /** Au-delà de ce nombre d'options, le champ de recherche paraît. */
  seuilRecherche?: number;
  className?: string;
  /**
   * Un déclencheur à soi ; sinon un bouton qui montre la valeur. `ouvrir`
   * reçoit l'événement du clic : la liste s'ancre sur l'élément cliqué.
   */
  declencheur?: (ouvrir: (evenement?: { currentTarget?: EventTarget | null } | Element | null) => void, libelle: string) => React.ReactNode;
  /** Ouverte par-dessus un tiroir déjà ouvert. */
  empile?: boolean;
  /** UN PIED FIXE, HORS DU DÉFILEMENT : un geste qui vaut pour toute la liste (« Ajouter un client »). */
  pied?: (fermer: () => void) => React.ReactNode;
  /** UN GESTE À DROITE DU TITRE : la gestion associée à la liste (l'engrenage des « Accès clients »). */
  actionTitre?: (fermer: () => void) => React.ReactNode;
  /** « champ » : un champ de formulaire pleine largeur ; « discret » : un bouton fantôme. */
  variante?: 'champ' | 'discret';
  desactivee?: boolean;
  /**
   * Les marqueurs posés pour les contrôles : « liste » (`data-liste-*`), ou
   * « selecteur » (`data-selecteur-*`) pour les écrans qui passaient par
   * l'ancien sélecteur en tiroir.
   */
  marques?: 'liste' | 'selecteur';
  /** Appelé à chaque ouverture : ce que la liste montre se charge alors, pas avant (les polices à prévisualiser). */
  surOuverture?: () => void;
} & Record<`data-${string}`, string | number | boolean | undefined>) {
  const telephone = useTelephone();
  const [ouvert, setOuvert] = React.useState(false);
  const [cherche, setCherche] = React.useState('');
  const [actif, setActif] = React.useState(-1);
  const [dansUneFenetre, setDansUneFenetre] = React.useState(false);
  const ancre = React.useRef<HTMLElement | null>(null);
  const bouton = React.useRef<HTMLButtonElement | null>(null);
  const corpsListe = React.useRef<HTMLDivElement | null>(null);
  const panneau = React.useRef<HTMLDivElement | null>(null);
  const retenue = options.find((o) => o.valeur === valeur);
  const libelle = retenue?.libelle ?? placeholder ?? '—';
  const m = marques === 'selecteur';
  const id = React.useId();

  const mot = cherche.trim().toLowerCase();
  const vues = mot ? options.filter((o) => `${o.libelle} ${o.detail ?? ''} ${o.groupe ?? ''}`.toLowerCase().includes(mot)) : options;
  const avecRecherche = options.length > seuilRecherche;

  React.useEffect(() => {
    if (!ouvert) {
      setCherche('');
      return;
    }
    setActif(Math.max(0, options.findIndex((o) => o.valeur === valeur)));
  }, [ouvert]);
  /* MODALE DANS UNE FENÊTRE, la liste ne se fermait pas à un appui sur la fenêtre elle-même (le libellé de son
     champ, un autre champ) : Radix n'y voyait pas un appui « dehors ». Elle se ferme donc ici, au même titre. */
  React.useEffect(() => {
    if (!ouvert || !dansUneFenetre) return;
    const appui = (e: PointerEvent) => {
      const cible = e.target as Node | null;
      if (!cible || panneau.current?.contains(cible)) return;
      marquerGesteDeFermeture();
      setOuvert(false);
    };
    window.addEventListener('pointerdown', appui, { capture: true });
    return () => window.removeEventListener('pointerdown', appui, { capture: true });
  }, [ouvert, dansUneFenetre]);
  React.useEffect(() => {
    if (mot) setActif(vues.findIndex((o) => !o.desactivee));
  }, [mot]);
  React.useEffect(() => {
    if (!ouvert || actif < 0) return;
    corpsListe.current?.querySelector(`[data-index="${actif}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [actif, ouvert]);

  const ouvrir = (evenement?: { currentTarget?: EventTarget | null } | Element | null) => {
    if (desactivee) return;
    // Le clic qui vient de FERMER une liste ne rouvre rien (§ `gesteDeFermeture`).
    if (evenement && gesteDeFermeture) return;
    const cible =
      evenement instanceof Element
        ? evenement
        : evenement?.currentTarget instanceof Element
          ? evenement.currentTarget
          : document.activeElement;
    ancre.current = cible instanceof HTMLElement && cible !== document.body ? cible : bouton.current;
    setDansUneFenetre(!!ancre.current?.closest('[role="dialog"], [role="alertdialog"]'));
    surOuverture?.();
    setOuvert(true);
  };
  const fermer = () => setOuvert(false);
  const choisir = (o: OptionSelecteur) => {
    if (o.desactivee) return;
    onChoisir(o.valeur);
    setOuvert(false);
  };

  const deplacer = (sens: 1 | -1, depuis = actif) => {
    if (!vues.length) return;
    let i = depuis;
    for (let n = 0; n < vues.length; n++) {
      i = (i + sens + vues.length) % vues.length;
      if (!vues[i]!.desactivee) break;
    }
    setActif(i);
  };
  const clavier = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      deplacer(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      deplacer(-1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      deplacer(1, -1);
    } else if (e.key === 'End') {
      e.preventDefault();
      deplacer(-1, vues.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const o = vues[actif];
      if (o) choisir(o);
    } else if (!avecRecherche && e.key.length === 1 && /\S/.test(e.key)) {
      // Sans champ de recherche, une lettre saute à la première option qui commence par elle.
      const lettre = e.key.toLowerCase();
      const i = vues.findIndex((o, k) => k > actif && !o.desactivee && o.libelle.toLowerCase().startsWith(lettre));
      const j = i >= 0 ? i : vues.findIndex((o) => !o.desactivee && o.libelle.toLowerCase().startsWith(lettre));
      if (j >= 0) setActif(j);
    }
    // Rien ne remonte jusqu'aux raccourcis de l'écran (espace = lecture, Suppr…).
    e.stopPropagation();
  };

  const lignes: React.ReactNode[] = [];
  let groupe: string | undefined;
  vues.forEach((option, index) => {
    if (option.groupe && option.groupe !== groupe) {
      lignes.push(
        <div key={`g-${option.groupe}-${index}`} className="px-2 pb-0.5 pt-2 text-[11px] uppercase tracking-wide text-faint" role="presentation">
          {option.groupe}
        </div>,
      );
    }
    groupe = option.groupe;
    const choisie = option.valeur === valeur;
    lignes.push(
      <div
        key={option.valeur}
        id={`${id}-o${index}`}
        role="option"
        aria-selected={choisie}
        aria-disabled={option.desactivee || undefined}
        data-index={index}
        onPointerMove={() => actif !== index && !option.desactivee && setActif(index)}
        onClick={() => choisir(option)}
        className={cn(
          'flex min-w-0 cursor-pointer select-none items-center gap-2 rounded-md px-2 text-left leading-5 transition-colors',
          telephone ? 'py-2 text-[14px]' : 'py-1.5 text-[13px]',
          option.desactivee ? 'cursor-default opacity-50' : index === actif ? 'bg-raised text-text' : choisie ? 'text-text' : 'text-muted',
        )}
        {...(m
          ? { 'data-selecteur-option': option.valeur, 'data-selecteur-choisi': choisie ? '' : undefined }
          : { 'data-liste-option': option.valeur, 'data-liste-choisie': choisie ? '' : undefined })}
        {...option.attributs}
      >
        {option.icone ? <span className="flex shrink-0 items-center text-faint">{option.icone}</span> : null}
        <span className="min-w-0 flex-1">
          <span className="block truncate" style={option.style}>
            {option.libelle}
          </span>
          {option.detail ? <span className="block truncate text-[11.5px] text-faint">{option.detail}</span> : null}
        </span>
        {option.fin ? <span className="flex shrink-0 items-center gap-1">{option.fin}</span> : null}
        {option.action ? (
          <button
            type="button"
            aria-label={option.action.libelle}
            title={option.action.libelle}
            data-liste-action={option.valeur}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              option.action!.onClick();
            }}
            className={cn(
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-bloc hover:text-text',
              option.action.active ? 'text-accent' : 'text-faint',
            )}
          >
            {option.action.icone}
          </button>
        ) : null}
        <Check className={cn('h-3.5 w-3.5 shrink-0 text-accent', !choisie && 'invisible')} aria-hidden />
      </div>,
    );
  });

  const recherche = avecRecherche ? (
    <div className={cn('shrink-0', telephone ? 'px-3 pb-2' : 'p-1 pb-1.5')}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
        <Input
          value={cherche}
          onChange={(event) => setCherche(event.target.value)}
          onKeyDown={clavier}
          placeholder={t('Rechercher…')}
          className="h-8 pl-7 text-[13px]"
          aria-controls={`${id}-liste`}
          aria-activedescendant={actif >= 0 ? `${id}-o${actif}` : undefined}
          {...(m ? { 'data-selecteur-recherche': repere } : { 'data-liste-recherche': repere })}
          autoFocus
        />
      </div>
    </div>
  ) : null;

  const listbox = (
    <div
      ref={corpsListe}
      id={`${id}-liste`}
      role="listbox"
      aria-label={titre}
      tabIndex={avecRecherche ? -1 : 0}
      onKeyDown={avecRecherche ? undefined : clavier}
      aria-activedescendant={!avecRecherche && actif >= 0 ? `${id}-o${actif}` : undefined}
      className="flex flex-col gap-0.5 outline-none"
    >
      {lignes}
      {!vues.length ? <p className="px-2 py-6 text-center text-[13px] text-faint">{t('Rien ne correspond.')}</p> : null}
    </div>
  );

  const marquesDeclencheur = m
    ? { 'data-selecteur-tiroir': repere, 'data-selecteur-valeur': valeur }
    : { 'data-liste-deroulante': repere ?? '', 'data-liste-valeur': valeur };

  const declencheurParDefaut = (
    <button
      ref={bouton}
      type="button"
      disabled={desactivee}
      onClick={ouvrir}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          ouvrir(e);
        }
      }}
      aria-haspopup="listbox"
      aria-expanded={ouvert}
      aria-label={titre}
      className={cn(
        'flex min-w-0 items-center gap-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        variante === 'champ'
          ? 'h-8 w-full rounded-md border border-border bg-controle px-2 text-[13px] text-text hover:border-faint'
          : 'h-7 max-w-full rounded-md px-1.5 text-[13px] text-text hover:bg-raised',
        ouvert && variante === 'champ' && 'border-accent',
        className,
      )}
      {...marquesDeclencheur}
      {...attributs}
    >
      {icone ?? retenue?.icone ? <span className="flex shrink-0 items-center text-faint">{icone ?? retenue?.icone}</span> : null}
      {/* LE NOM S'AFFICHE EN ENTIER tant que la place le permet. */}
      <span className={cn('min-w-0 flex-1 truncate', !retenue && 'text-faint')} style={retenue?.style}>
        {libelle}
      </span>
      <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-faint transition-transform', ouvert && 'rotate-180')} aria-hidden />
    </button>
  );

  const leDeclencheur = declencheur ? declencheur(ouvrir, libelle) : declencheurParDefaut;

  if (telephone) {
    return (
      <>
        {leDeclencheur}
        <Drawer open={ouvert} onClose={fermer} empile={empile} className="max-h-[80dvh]">
          <header className="flex shrink-0 items-center gap-2 px-3 pb-2">
            <DialogTitle className="min-w-0 flex-1 truncate">{titre}</DialogTitle>
            {actionTitre ? actionTitre(fermer) : null}
          </header>
          {recherche}
          <ZoneDefilement fond="hsl(var(--surface))" className="min-h-0 px-2 pb-3">
            {listbox}
          </ZoneDefilement>
          {pied ? <div className="shrink-0 px-3 pb-3 pt-1">{pied(fermer)}</div> : null}
        </Drawer>
      </>
    );
  }

  return (
    /* OUVERTE DANS UNE FENÊTRE, LA LISTE EST MODALE. Une fenêtre (Dialog Radix,
       tiroir) verrouille le défilement de tout ce qui n'est pas elle ; le
       panneau de la liste, porté au bout de la page, en était exclu : la
       molette ne le faisait plus défiler (liste des voix de « Mettre en
       production », 07/10/2026). Modale, la liste pose SON verrou par-dessus
       celui de la fenêtre — seul le dernier compte —, et le sien la laisse
       défiler. Hors fenêtre, elle reste non modale : la page défile encore. */
    <PopoverPrimitive.Root modal={dansUneFenetre} open={ouvert} onOpenChange={(o) => (o ? setOuvert(true) : fermer())}>
      <PopoverPrimitive.Anchor virtualRef={{ current: { getBoundingClientRect: () => (ancre.current ?? bouton.current ?? document.body).getBoundingClientRect() } }} />
      {leDeclencheur}
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          ref={panneau}
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          aria-label={titre}
          data-liste-panneau={repere ?? ''}
          onOpenAutoFocus={(e) => {
            // Le focus va à la recherche (autoFocus) ou à la liste, jamais au premier bouton d'action.
            if (!avecRecherche) {
              e.preventDefault();
              corpsListe.current?.focus();
            }
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            ancre.current?.focus?.();
          }}
          onPointerDownOutside={marquerGesteDeFermeture}
          onKeyDown={(e) => {
            if (e.key === 'Escape') e.stopPropagation();
          }}
          style={{ minWidth: Math.max(220, ancre.current?.getBoundingClientRect().width ?? 0) }}
          className={cn(
            'z-[80] flex max-h-[min(380px,var(--radix-popover-content-available-height))] max-w-[min(440px,calc(100vw-16px))] flex-col overflow-hidden rounded-md border border-border bg-surface p-1 shadow-xl',
            'data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out',
          )}
        >
          {actionTitre ? (
            <header className="flex shrink-0 items-center gap-2 px-2 pb-1 pt-0.5">
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-muted">{titre}</span>
              {actionTitre(fermer)}
            </header>
          ) : null}
          {recherche}
          <ZoneDefilement fond="hsl(var(--surface))" hauteur={24} className="min-h-0 overscroll-contain">
            {listbox}
          </ZoneDefilement>
          {pied ? <div className="shrink-0 px-1 pb-0.5 pt-1">{pied(fermer)}</div> : null}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

/**
 * L'ANCIEN SÉLECTEUR EN TIROIR, devenu une enveloppe de `ListeDeroulante`
 * (variante discrète, marqueurs `data-selecteur-*` gardés pour les contrôles).
 */
export function SelecteurTiroir({
  className,
  ...props
}: Omit<React.ComponentProps<typeof ListeDeroulante>, 'variante' | 'marques'> & { repere: string }) {
  return <ListeDeroulante {...props} className={cn('min-w-0 max-w-full gap-1.5 px-1.5 text-[13px] text-text', className)} variante="discret" marques="selecteur" />;
}

/**
 * LE BOUTON « ⋮ » ET SON TIROIR D'ACTIONS. Il porte un repère chiffré quand
 * quelque chose d'invisible est actif — un filtre, par exemple : on ne cherche
 * plus pourquoi une liste semble vide.
 *
 * LES TROIS POINTS SONT VERTICAUX, ici comme partout ailleurs dans Beluga : un
 * menu d'actions se reconnaît au même dessin sur tous les écrans. Un tiroir qui
 * n'est PAS un menu d'actions — un filtre, un tri — passe son propre `icone` :
 * c'est la seule raison d'en changer.
 */
export function MenuActions({
  titre,
  repere,
  actifs,
  alerte,
  icone,
  children,
  className,
  empile,
  taille = 'icon-sm',
}: {
  titre: string;
  repere: string;
  /** Le nombre de réglages actifs — pastille discrète, en bas à droite. */
  actifs?: number;
  /**
   * CE QUI RÉCLAME UNE RÉPONSE. La pastille commune, en ORANGE (ton
   * « répondre »), en haut à droite : elle ne se confond pas avec le compte des
   * réglages actifs, et ne se cache jamais dans le tiroir.
   */
  alerte?: number;
  /** L'icône du bouton — les trois points verticaux à défaut. */
  icone?: React.ReactNode;
  /** Le contenu du tiroir : des `ActionTiroir`, des blocs, ce qu'on veut. */
  children: React.ReactNode | ((fermer: () => void) => React.ReactNode);
  className?: string;
  empile?: boolean;
  taille?: ButtonProps['size'];
}) {
  const [ouvert, setOuvert] = React.useState(false);
  const fermer = React.useCallback(() => setOuvert(false), []);
  return (
    <>
      <span className="relative inline-flex shrink-0">
        <Button
          variant="ghost"
          size={taille}
          onClick={() => setOuvert(true)}
          title={titre}
          aria-label={titre}
          className={className}
          data-menu-actions={repere}
          data-actifs={actifs || undefined}
          data-alerte={alerte || undefined}
        >
          {icone ?? <EllipsisVertical className="h-4 w-4" />}
        </Button>
        <Pastille nombre={alerte ?? 0} ton="repondre" position="coin" data-alerte-repere={alerte} />

        {actifs ? (
          <span
            className="pointer-events-none absolute -bottom-0.5 -right-0.5 min-w-[15px] rounded-full bg-accent px-1 text-center text-[9px] font-medium leading-4 text-accent-fg"
            data-actifs-repere={actifs}
          >
            {actifs}
          </span>
        ) : null}
      </span>
      <Drawer open={ouvert} onClose={fermer} empile={empile} className="max-h-[80dvh]">
        <header className="flex shrink-0 items-center gap-2 px-3 pb-2">
          <DialogTitle className="min-w-0 flex-1 truncate">{titre}</DialogTitle>
        </header>
        <ZoneDefilement fond="hsl(var(--surface))" className="min-h-0 px-2 pb-3">
          <div className="flex flex-col gap-1">
            {typeof children === 'function' ? children(fermer) : children}
          </div>
        </ZoneDefilement>
      </Drawer>
    </>
  );
}

/** Une ligne d'action dans un `MenuActions` — icône, libellé, état à droite. */
export function ActionTiroir({
  icone,
  children,
  onClick,
  actif,
  valeur,
  ton,
  className,
  ...props
}: {
  icone?: React.ReactNode;
  children: React.ReactNode;
  onClick?: () => void;
  /** Une action qui bascule : la coche dit qu'elle est allumée. */
  actif?: boolean;
  /** Ce que l'action vaut aujourd'hui, à droite — comme les réglages de l'agent. */
  valeur?: string;
  ton?: 'danger';
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'children'>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left text-[14px] transition-colors',
        actif ? 'bg-raised text-text' : 'text-muted hover:bg-raised hover:text-text',
        ton === 'danger' && 'text-danger hover:text-danger',
        className,
      )}
      data-action-active={actif ? '' : undefined}
      {...props}
    >
      {icone ? <span className="shrink-0 text-faint">{icone}</span> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {valeur ? <span className="shrink-0 text-[12px] text-faint">{valeur}</span> : null}
      {actif && !valeur ? <Check className="h-3.5 w-3.5 shrink-0 text-accent" /> : null}
    </button>
  );
}

/** Un intertitre dans un tiroir d'actions : « Filtrer », « Trier », « Ouvrir ». */
export function GroupeTiroir({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5" data-groupe-tiroir={titre}>
      <span className="px-2 pt-2 text-[11px] uppercase tracking-wide text-faint">{titre}</span>
      {children}
    </div>
  );
}
