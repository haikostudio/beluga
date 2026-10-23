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
import { ArrowLeft, Check, ChevronDown, ChevronRight, EllipsisVertical, Eye, EyeOff, Info, Loader2, Search, WandSparkles, X } from 'lucide-react';
import {
  DUREE_REUSSITE_MS,
  EVENEMENT_ATTENTE_LONGUE,
  SEUIL_LONGUE_ATTENTE_MS,
  boutonOccupe,
  chiffreDePastille,
  estUneRequete,
  etatApresIssue,
  genererMotDePasse,
  issueDeLaReponse,
  niveauQuota,
  suiteDesEtats,
  type EtatDeBouton,
} from '@beluga/shared';
import { cn } from '@/lib/utils';
import { useSurvol } from '@/lib/pointeur';
import { useTelephone } from '@/lib/telephone';
import { t } from '@/lib/langue';
import { useTiroirAdresse } from '@/lib/tiroirs-adresse';

/**
 * Le socle visuel, posé AVANT les écrans (PLAN §17, §30). Les composants sont
 * copiés dans le projet, pas importés d'une boîte noire : on les possède.
 */

/* ----------------------------- Bouton ----------------------------- */

/**
 * LES BOUTONS QUI CRÉENT (« Nouvel agent », « Nouvelle tâche ») : un aplat
 * d'ENCRE — noir avec une écriture blanche en clair, le gris soutenu des aplats
 * en sombre, jamais le blanc de l'accent —, pour qu'ils se distinguent d'un
 * coup d'œil des lignes grises qui les entourent (demande du 12/10/2026,
 * « noir avec écriture blanche, bien contrastés »). Aucune bordure : le fond
 * dessine le bouton. Posée telle quelle sur une LIGNE de colonne (qui n'est pas
 * un `Button`), ou par la variante `creation`.
 */
export const CLASSE_BOUTON_DE_CREATION = 'bg-encre text-encre-fg hover:opacity-90';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-faint disabled:pointer-events-none disabled:opacity-40 select-none',
  {
    variants: {
      variant: {
        default: 'bg-accent text-accent-fg hover:opacity-90',
        // `bg-controle` vaut la TRANSPARENCE dans les deux thèmes d'origine — ce
        // bouton ne bouge donc pas d'un pixel — et un voile translucide dans les
        // thèmes plats, où la bordure ne dessine plus rien (styles.css).
        outline: 'border border-transparent bg-controle hover:bg-border text-text',
        ghost: 'hover:bg-raised text-muted hover:text-text',
        subtle: 'bg-raised text-text hover:bg-border',
        danger: 'bg-danger text-sur-etat hover:opacity-90',
        success: 'bg-success text-sur-etat hover:opacity-90',
        /*
         * LE GESTE QUI ARRÊTE (un agent, une publication, une écoute) : un
         * aplat ROUGE en permanence, écriture BLANCHE (demande du 12/10/2026 :
         * « rouge avec écriture blanche, pas noir »). Le rouge est le jeton
         * `--danger`, le blanc est franc dans les deux thèmes — `sur-etat`
         * deviendrait foncé en sombre. Aucun trait : un bouton ne porte jamais
         * de bordure, c'est son fond qui le dessine.
         */
        arret: 'bg-danger text-white hover:opacity-90',
        /* Le geste qui CRÉE : le même aplat d'encre que `CLASSE_BOUTON_DE_CREATION`. */
        creation: CLASSE_BOUTON_DE_CREATION,
      },
      size: {
        sm: 'h-8 px-3 text-[13.5px]',
        md: 'h-9 px-3.5 text-[14.5px]',
        lg: 'h-10 px-4 text-[14.5px]',
        icon: 'h-7 w-7',
        /* La case d'icône d'une BARRE d'en-tête (voir `CLASSE_RANGEE_DE_BOUTONS`). */
        'icon-barre': 'h-8 w-8',
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
    const dansUneBarre = React.useContext(DansUneBarreDEnTete);
    /*
     * UN BOUTON À ICÔNE SEULE DIT CE QU'IL FAIT AU SURVOL (demande du
     * 15/10/2026 : « des infobulles partout »). Son nom accessible devient son
     * `title`, que la couche des infobulles (`CoucheDesInfobulles`) rend en bulle
     * rapide. Jamais en double : un `title` posé à la main gagne, et dans un
     * `Tooltip` la bulle est déjà celle de l'enveloppe.
     */
    const dansUneInfobulle = React.useContext(DansUneInfobulle);
    const nomAccessible = props['aria-label'];
    const titreParDefaut =
      !asChild && !dansUneInfobulle && props.title === undefined && typeof size === 'string' && size.startsWith('icon') && typeof nomAccessible === 'string' && nomAccessible
        ? t(nomAccessible)
        : undefined;
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
          buttonVariants({ variant, size: dansUneBarre && size === 'icon' ? 'icon-barre' : size }),
          suivi && suivi !== 'repos' && 'relative',
          occupe && 'pointer-events-none',
          className,
        )}
        ref={ref}
        aria-busy={occupe || undefined}
        data-attente={suivi && suivi !== 'repos' ? suivi : undefined}
        onClick={auClic}
        {...props}
        {...(titreParDefaut ? { title: titreParDefaut } : {})}
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
        'h-10 w-full rounded-lg border border-transparent bg-raised px-3.5 text-[14.5px] text-text placeholder:text-faint transition-colors focus-visible:border-faint/60 focus-visible:outline-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

/**
 * LE CHAMP DE MOT DE PASSE — le seul de l'application.
 *
 * Tout champ secret (mot de passe, phrase secrète, clé, jeton) passe par lui :
 * un ŒIL posé DANS le champ, à droite, montre ou masque ce qu'on tape. Là où
 * l'on CRÉE un mot de passe, `onGenerer` ajoute un second bouton : il tire un
 * mot de passe solide (`genererMotDePasse`) et le rend à l'appelant, qui le pose
 * dans la saisie ET dans la confirmation, puis montre les deux en clair (props
 * `visible` / `onVisibleChange`, partagées par les deux champs). Là où l'on
 * SAISIT un mot de passe existant (connexion, mot de passe actuel, clé à
 * ranger), pas de générateur : il n'aurait aucun sens.
 *
 * `className` habille le champ lui-même (hauteur, police) ; `cadre`, la boîte
 * qui le porte (sa place dans une rangée : `flex-1`…). Compétence globale :
 * « champ-de-mot-de-passe-avec-oeil-et-generateur ».
 */
export const ChampMotDePasse = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
    onGenerer?: (motDePasse: string) => void;
    visible?: boolean;
    onVisibleChange?: (visible: boolean) => void;
    cadre?: string;
  }
>(({ className, cadre, onGenerer, visible: visibleImpose, onVisibleChange, ...props }, ref) => {
  const [visibleLocal, setVisibleLocal] = React.useState(false);
  const visible = visibleImpose ?? visibleLocal;
  const basculer = (suivant: boolean) => {
    setVisibleLocal(suivant);
    onVisibleChange?.(suivant);
  };
  const generer = () => {
    onGenerer?.(genererMotDePasse());
    basculer(true);
  };
  return (
    <div className={cn('relative w-full', cadre)} data-champ-mot-de-passe>
      <input
        ref={ref}
        type={visible ? 'text' : 'password'}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        className={cn(
          'h-10 w-full rounded-lg border border-transparent bg-raised px-3.5 text-[14.5px] text-text placeholder:text-faint transition-colors focus-visible:border-faint/60 focus-visible:outline-none disabled:opacity-50',
          onGenerer ? 'pr-[4.25rem]' : 'pr-10',
          className,
        )}
        {...props}
      />
      <div className="absolute inset-y-0 right-1.5 flex items-center gap-0.5">
        {onGenerer ? (
          <button
            type="button"
            data-generer-mot-de-passe
            title={t('Générer un mot de passe solide')}
            aria-label="Générer un mot de passe"
            disabled={props.disabled}
            onClick={generer}
            className="grid h-7 w-7 place-items-center rounded-md text-muted transition-colors hover:bg-border hover:text-text disabled:opacity-50"
          >
            <WandSparkles className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          data-oeil-mot-de-passe={visible ? 'visible' : 'masque'}
          title={visible ? t('Masquer') : t('Afficher')}
          aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
          aria-pressed={visible}
          onClick={() => basculer(!visible)}
          className="grid h-7 w-7 place-items-center rounded-md text-muted transition-colors hover:bg-border hover:text-text"
        >
          {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
});
ChampMotDePasse.displayName = 'ChampMotDePasse';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'w-full resize-none rounded-lg border border-transparent bg-raised px-3.5 py-2.5 text-[14.5px] text-text placeholder:text-faint transition-colors focus-visible:border-faint/60 focus-visible:outline-none',
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
 * UN FORMULAIRE : chaque LIBELLÉ AU-DESSUS DE SON CHAMP, partout et à toutes
 * les largeurs (demande du 09/10/2026 : « les labels au-dessus des champs et
 * non pas à gauche, dans l'ensemble de l'application »). L'ancienne grille à
 * deux colonnes (libellés à gauche, valeurs à droite) a disparu : elle
 * coupait les libellés longs sur trois lignes et volait la moitié de la
 * largeur aux champs.
 *
 * Le nom est resté pour ne pas renommer trente écrans : c'est une colonne de
 * lignes, chacune « libellé, champ, note ». Ce qui n'a pas de libellé (une
 * note, un bouton, un encart) se pose simplement à sa place dans la colonne.
 */
export function FormulaireEnColonnes({
  children,
  className,
  ...attributs
}: {
  children: React.ReactNode;
  className?: string;
} & Record<`data-${string}`, string | number | boolean | undefined>) {
  return (
    <div {...attributs} data-formulaire-colonnes className={cn('flex flex-col gap-3', className)}>
      {children}
    </div>
  );
}

/**
 * UNE LIGNE DE FORMULAIRE : son libellé (et son « i ») AU-DESSUS, puis sa
 * valeur, puis ses notes. Le libellé est un vrai `label` relié au champ.
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
  /** Une ligne grise sous la valeur. */
  note?: React.ReactNode;
  children: React.ReactNode;
  htmlFor?: string;
  className?: string;
} & Record<`data-${string}`, string | number | boolean | undefined>) {
  return (
    <div className="flex min-w-0 flex-col gap-1" data-ligne-formulaire {...attributs}>
      <div className="flex min-w-0 items-center gap-1" data-libelle-formulaire>
        <label htmlFor={htmlFor} className="min-w-0 text-[12.5px] font-medium leading-snug text-muted">
          {libelle}
        </label>
        {aide ? <BulleInfo cote="start">{aide}</BulleInfo> : null}
      </div>
      <div className={cn('flex min-w-0 flex-col gap-1', className)} data-valeur-formulaire>
        {children}
        {note ? <p className="text-[12px] leading-snug text-faint">{note}</p> : null}
      </div>
    </div>
  );
}

/* ----------------------------- Badge ------------------------------ */

const badgeVariants = cva(
  /* AUCUN CADRE : une étiquette se lit par son fond et la force de son texte. */
  'inline-flex items-center gap-1 rounded-md border border-transparent px-1.5 py-0.5 text-[12px] font-medium leading-none',
  {
    variants: {
      tone: {
        neutral: 'bg-raised text-muted',
        success: 'bg-raised text-muted',
        warning: 'bg-raised text-text',
        attention: 'bg-raised text-text',
        /* Le service d'où vient une carte. */
        service: 'bg-raised text-text',
        danger: 'bg-danger/10 text-danger',
        strong: 'bg-accent text-accent-fg',
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
 * LA RÈGLE D'UNE RANGÉE DE BOUTONS : UN SEUL PAS, D'UN BOUT À L'AUTRE.
 *
 * Les boutons d'une même rangée (barre d'en-tête, rangée du bas du champ
 * d'écriture, colonne des projets, petit assistant) ont chacun une case de
 * même taille et sont séparés du MÊME écart : leurs centres tombent à pas
 * égal, et l'œil lit une répartition régulière. L'écart de base est celui de
 * l'ordinateur (6 px), un peu réduit sur téléphone (4 px) — mais jamais
 * différent d'un bouton à l'autre dans une même rangée.
 *
 * La case est celle de la rangée : 32 px dans une barre d'en-tête
 * (`h-8 w-8`, taille `icon-barre`), 28 px dans le champ d'écriture
 * (`h-7 w-7`, taille `icon`). Un bouton à libellé garde la largeur de son
 * texte, mais sa marge intérieure vaut celle de la case d'icône voisine
 * (`CLASSE_MARGE_DU_LIBELLE_DU_CHAMP`) : le vide jusqu'au voisin est le même.
 * Une rangée porte `data-rangee-de-boutons`, que lit
 * `scripts/verif-ecarts-des-boutons.mjs`.
 */
export const CLASSE_RANGEE_DE_BOUTONS = 'flex items-center gap-1 sm:gap-1.5';
/** La marge intérieure d'un bouton à libellé du champ d'écriture : celle de sa case d'icône de 28 px (glyphe de 14 px). */
export const CLASSE_MARGE_DU_LIBELLE_DU_CHAMP = 'px-[7px]';
/**
 * VRAI DANS LES GESTES D'UNE BARRE D'EN-TÊTE (`GestesDePage`, `OptionsDePage`).
 * Un bouton-icône (`size="icon"`, 28 px) qui y est posé prend alors la case de
 * la barre (`icon-barre`, 32 px) : une page n'a pas à connaître la taille de la
 * barre où ses gestes montent, et ses boutons n'y cassent pas le pas régulier.
 */
export const DansUneBarreDEnTete = React.createContext(false);

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
            ? 'border border-transparent bg-info/10 text-info'
            : 'border border-transparent bg-warning/10 text-warning'
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
 *
 * LA RANGÉE A UN FOND QUI SE VOIT (demande du 11/10/2026 : « un arrière-plan à
 * cette barre, pour qu'on la distingue bien »). `--raised` se confondait avec
 * le fond de la page ; `--ligne-active` est le gris le plus marqué des deux
 * palettes, et l'onglet ouvert s'y détache en clair comme en sombre.
 */
export const CLASSES_LISTE_ONGLETS = 'h-8 items-center gap-0.5 rounded-lg bg-ligne-active p-0.5';

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
      'inline-flex h-7 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[13.5px] font-medium text-muted transition-colors hover:text-text data-[state=active]:bg-bg data-[state=active]:text-teinte data-[state=active]:shadow-sm dark:data-[state=active]:bg-faint/30',
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
    /**
     * LE VOILE DE DÉBUT TOUJOURS ALLUMÉ, éteint d'office. Il sépare alors la
     * zone de ce qui la précède (un entête fixe) même au repos, sans attendre
     * le moindre défilement. Celui qui l'allume pose un padding haut au moins
     * égal à `hauteur`, sinon la première ligne est floue au repos.
     */
    voileDebutToujours?: boolean;
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
    voileDebutToujours = false,
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
      {voile('debut', debut || voileDebutToujours)}
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

/* ------------------------ L'en-tête d'une page -------------------- */

/**
 * OÙ UNE PAGE POSE SES GESTES : l'endroit de SA barre d'en-tête, à droite du
 * fil d'Ariane (`GestesDePage`, `entete-de-zone.tsx`). L'application fournit
 * celui de sa barre ; une page ouverte par-dessus fournit le sien.
 */
export const CibleDesGestesDePage = React.createContext<HTMLElement | null>(null);

/**
 * OÙ UNE PAGE POSE SON GESTE PRINCIPAL SUR TÉLÉPHONE : la bande du bas de
 * l'écran, sur toute la largeur (`GestePrincipal`, `entete-de-zone.tsx`).
 * L'application la fournit sur un service ; `cible` reste `null` le temps que
 * la bande soit montée. Sans fournisseur — une page ouverte par-dessus, une
 * fenêtre — il n'y a PAS de bande : le geste reste dans la barre d'en-tête.
 */
export const CibleDuBasDePage = React.createContext<{ cible: HTMLElement | null } | null>(null);

/**
 * OÙ UNE PAGE ÉCRIT SON TITRE : le dernier cran du fil d'Ariane de sa barre
 * d'en-tête. Le PREMIER `DialogTitle` de la page y monte ; les suivants restent
 * où ils sont écrits. Une FENÊTRE ouverte depuis la page remet cet emplacement
 * à zéro : son titre est le sien, au milieu de son propre en-tête.
 */
export interface EmplacementDuTitre {
  cible: HTMLElement;
  occupe: React.MutableRefObject<symbol | null>;
}
export const EmplacementDuTitreDePage = React.createContext<EmplacementDuTitre | null>(null);

/**
 * L'EN-TÊTE PAR DÉFAUT D'UNE PAGE, fourni par l'application : la barre au fil
 * d'Ariane (`EnteteDePage`). Sans lui — l'espace des clients, qui n'a pas de
 * fil — la page garde la simple barre « Retour ».
 */
export interface ProprietesDEnteteDePage {
  fermer: () => void;
  onCibleDuTitre: (element: HTMLElement | null) => void;
  onCibleDesGestes: (element: HTMLElement | null) => void;
}
export const EnteteDePageParDefaut = React.createContext<React.ComponentType<ProprietesDEnteteDePage> | null>(null);

/**
 * LA MOLETTE FAIT DÉFILER LA PAGE MÊME HORS DE SA COLONNE CENTRALE. Le contenu
 * d'une page est centré dans une colonne étroite, et c'est une zone DANS cette
 * colonne qui défile : le curseur posé dans les marges ne faisait rien bouger
 * (« je suis obligé d'aller sur la colonne centrale pour scroller »). Quand
 * rien, sous le curseur, ne sait défiler, le geste est rendu à la plus grande
 * zone qui défile de la page.
 */
export function defilerDepuisLesMarges(event: React.WheelEvent<HTMLElement>) {
  if (event.ctrlKey || Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
  const racine = event.currentTarget;
  const saitDefiler = (element: HTMLElement) => {
    if (element.scrollHeight <= element.clientHeight + 1) return false;
    const mode = getComputedStyle(element).overflowY;
    return mode === 'auto' || mode === 'scroll';
  };
  for (let element = event.target as HTMLElement | null; element && element !== racine; element = element.parentElement) {
    if (saitDefiler(element)) return;
  }
  let choisie: HTMLElement | null = null;
  let aire = 0;
  for (const element of racine.querySelectorAll<HTMLElement>('*')) {
    if (element.clientHeight < 120 || !saitDefiler(element)) continue;
    const boite = element.getBoundingClientRect();
    if (boite.width * boite.height > aire) {
      aire = boite.width * boite.height;
      choisie = element;
    }
  }
  choisie?.scrollBy({ top: event.deltaY });
}

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
/**
 * L'EN-TÊTE D'UNE FENÊTRE, LE MÊME PARTOUT (demande du 11/10/2026 : « une
 * en-tête avec le titre au milieu, les éventuels boutons à gauche et à
 * droite ») : UNE rangée — les boutons de gauche (`gauche` : un retour), le
 * TITRE AU MILIEU, les boutons de droite (`droite`) puis la croix. Les deux
 * côtés ont la même largeur : le titre est centré sur la fenêtre, pas sur la
 * place qui reste. Un titre long passe à la ligne, ou se tronque si l'appelant
 * le demande (`truncate`) — il ne pousse jamais la croix.
 *
 * Ce qui accompagne le titre sans être un bouton passe SOUS la rangée : une
 * `DialogDescription` y descend d'elle-même, le reste (des onglets) par `sous`.
 *
 * LA CROIX reste posée par la fenêtre (`DialogContent`), en absolu : la rangée
 * lui réserve sa place à droite et se cale sur sa hauteur (`pt-3` + 32 px :
 * même milieu que la croix, à 28 px du haut). `sansCroix` rend cette place à
 * une fenêtre qui pose la sienne ; `libre` laisse l'appelant dessiner sa
 * rangée (le Studio, `EnteteDeFenetre`, qui suit déjà ce dessin).
 */
export function DialogHeader({
  className,
  children,
  gauche,
  droite,
  sous,
  libre,
  sansCroix,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  /** Les boutons de gauche : un retour. */
  gauche?: React.ReactNode;
  /** Les boutons de droite, posés juste avant la croix. */
  droite?: React.ReactNode;
  /** Ce qui accompagne le titre, sous la rangée : des onglets. */
  sous?: React.ReactNode;
  libre?: boolean;
  sansCroix?: boolean;
}) {
  if (libre) {
    return (
      <div data-fenetre-entete className={cn('shrink-0 px-5 pb-2 pr-12 pt-5', className)} {...props}>
        {children}
      </div>
    );
  }
  const titre: React.ReactNode[] = [];
  const dessous: React.ReactNode[] = [];
  React.Children.toArray(children).forEach((enfant) => {
    if (React.isValidElement(enfant) && enfant.type === DialogDescription) dessous.push(enfant);
    else titre.push(enfant);
  });
  return (
    <div data-fenetre-entete className={cn('shrink-0 px-3.5 pb-2 pt-3', className)} {...props}>
      <div
        data-fenetre-rangee
        className="grid grid-cols-[minmax(max-content,1fr)_minmax(0,auto)_minmax(max-content,1fr)] items-start gap-2"
      >
        <div data-fenetre-gauche className="flex h-8 min-w-0 items-center justify-start gap-1">
          {gauche}
        </div>
        <div data-fenetre-titre className="flex min-h-8 min-w-0 items-center justify-center gap-1 text-center">
          {titre}
        </div>
        <div data-fenetre-droite className={cn('flex h-8 min-w-0 items-center justify-end gap-1', !sansCroix && 'pr-8')}>
          {droite}
        </div>
      </div>
      {/* Aligné sur le corps de la fenêtre (`px-5`) : le texte se lit d'un seul bord. */}
      {dessous.length ? <div className="px-1.5">{dessous}</div> : null}
      {sous}
    </div>
  );
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
        'flex shrink-0 bg-bg px-5 pt-3',
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

/**
 * LA BANDE DU VOILE, SOUS L'HEURE (demande du 22/10/2026, capture d'un menu
 * ouvert sur l'iPhone). Un voile plein écran est TRANSLUCIDE jusqu'au bord du
 * haut : iOS 26/27 n'y trouve plus d'élément fixe et OPAQUE à échantillonner
 * sous l'heure, et il y remet son flou — un dégradé clair qui dépassait au-
 * dessus du voile sombre. C'est le même mécanisme que la bande des zones
 * (`BandeSousLHeure`, DEC-389) : un élément fixe, opaque, collé au bord, de la
 * hauteur de la zone sûre du haut.
 *
 * SA COULEUR EST CELLE QUE LE VOILE DONNE DÉJÀ À L'ŒIL, jamais une autre (un
 * bandeau visible est refusé) : au montage, la bande lit le fond OPAQUE posé
 * sous elle — la zone, une page, le panneau des projets, selon l'écran et
 * l'ambiance — et peint le mélange exact du voile sur ce fond. Hors iPhone
 * installé, la zone sûre vaut 0 : la bande n'a aucune hauteur, rien ne se lit.
 * Enfant du voile, elle suit son fondu d'entrée et de sortie, et laisse passer
 * le toucher jusqu'à lui (qui referme ce qu'il couvre).
 */
function couleurOpaqueSous(x: number, y: number, ignorer: Element): [number, number, number] | null {
  for (const element of document.elementsFromPoint(x, y)) {
    if (ignorer.contains(element)) continue;
    for (let noeud: Element | null = element; noeud; noeud = noeud.parentElement) {
      const rgba = lireRgba(getComputedStyle(noeud).backgroundColor);
      if (rgba && rgba[3] >= 0.99) return [rgba[0], rgba[1], rgba[2]];
    }
  }
  const fond = lireRgba(getComputedStyle(document.body).backgroundColor);
  return fond ? [fond[0], fond[1], fond[2]] : null;
}

function lireRgba(couleur: string): [number, number, number, number] | null {
  const m = couleur.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1]!.split(/[ ,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
  return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? 1];
}

export function BandeDuVoile() {
  const ref = React.useRef<HTMLDivElement>(null);
  const [couleur, setCouleur] = React.useState<string | undefined>(undefined);
  React.useLayoutEffect(() => {
    const bande = ref.current;
    const voile = bande?.parentElement;
    if (!bande || !voile || bande.offsetHeight === 0) return;
    const teinte = lireRgba(getComputedStyle(voile).backgroundColor);
    const dessous = couleurOpaqueSous(window.innerWidth / 2, Math.max(0, bande.offsetHeight / 2), voile);
    if (!teinte || !dessous) return;
    const a = teinte[3];
    const melange = [0, 1, 2].map((i) => Math.round(teinte[i]! * a + dessous[i]! * (1 - a)));
    setCouleur(`rgb(${melange.join(', ')})`);
  }, []);
  return (
    <div
      ref={ref}
      aria-hidden
      data-bande-du-voile
      className="pointer-events-none absolute inset-x-0 top-0"
      style={{ height: 'var(--zone-sure-haut, 0px)', backgroundColor: couleur }}
    />
  );
}

/**
 * UNE FENÊTRE EST UNE FENÊTRE, CENTRÉE — plus jamais un volet (demande du
 * 11/10/2026, qui défait celle du 09/10 : « je ne veux plus de volets »).
 * `DialogContent` pose une fenêtre au milieu de l'écran, sur un voile léger,
 * avec ses trois parties : entête fixe, corps seul à défiler, pied d'action
 * fixe. Sur téléphone elle s'ancre en bas, faute de place. C'est la forme des
 * questions, des confirmations, des formulaires courts — et des RÉGLAGES, qui
 * y posent leurs deux volets (la liste à gauche, la rubrique à droite).
 *
 * Ce qui demande de la PLACE et du temps (une carte, un fil, un plan, une
 * fiche) n'est pas une fenêtre : c'est une PAGE (`Drawer`).
 *
 * `adresse` : le nom de la fenêtre dans l'adresse du navigateur (voir `Drawer`).
 * `centre`, `plein`, `hauteurFixe` et `empile` sont gardés pour les appelants,
 * sans effet : toute fenêtre est désormais centrée.
 */
type ProprietesDeFenetre = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  centre?: boolean;
  adresse?: string;
  plein?: boolean;
  hauteurFixe?: boolean;
  empile?: boolean;
};

function FenetreCentree({
  className,
  children,
  onInteractOutside,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay data-voile-de-fenetre className="fixed inset-0 z-50 bg-voile/40 data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out">
        <BandeDuVoile />
      </DialogPrimitive.Overlay>
      {/*
       * La fenêtre est POSÉE par une enveloppe en flux (collée en bas sur
       * téléphone, centrée sur grand écran), jamais par un décalage de moitié :
       * l'animation d'ouverture écrase le décalage le temps qu'elle dure, et la
       * fenêtre partait alors se coller au bord droit de l'écran.
       */}
      <div
        className="pointer-events-none fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
        style={{ paddingBottom: 'var(--clavier, 0px)' }}
      >
        <DialogPrimitive.Content
          data-fenetre-centree
          className={cn(
            /* `overflow-clip`, PAS `overflow-hidden` : une fenêtre ne défile
               jamais, même par programme. La zone de prise du pouce d'une zone
               qui défile dépasse de 3 px du bord ; « hidden » la cachait mais
               laissait la fenêtre défilable, et un `scrollIntoView` (un clic
               de contrôle pendant l'ouverture) décalait tout son contenu de
               3 px — titre décentré, flèche de retour au bord. */
            'pointer-events-auto relative flex max-h-[88dvh] w-full min-h-0 flex-col overflow-clip bg-bg shadow-2xl outline-none',
            'rounded-t-2xl data-[state=open]:animate-slide-sheet data-[state=closed]:animate-slide-sheet-out',
            'sm:w-[min(560px,100%)] sm:rounded-2xl sm:border sm:border-border sm:data-[state=open]:animate-slide-up sm:data-[state=closed]:animate-slide-down',
            className,
          )}
          style={{
            /* Une fenêtre est blanche comme la page : ce qui, dedans, se réglait
               sur le fond d'un tiroir se règle sur elle. */
            ['--surface' as string]: 'var(--bg)',
            ['--fond-zone-defilement' as string]: 'hsl(var(--bg))',
          }}
          {...props}
          /* UN APPUI DANS UNE PAGE OUVERTE PAR-DESSUS N'EST PAS UN APPUI
             « DEHORS ». La page empilée (`empile`) n'est pas modale : la
             fenêtre restait donc la couche qui juge les appuis extérieurs, et
             le premier clic dans la page de l'agent de configuration refermait
             la fenêtre « Configuration du projet » restée dessous. */
          onInteractOutside={(event) => {
            onInteractOutside?.(event);
            if ((event.target as Element | null)?.closest?.('[data-tiroir-empile="oui"]')) event.preventDefault();
          }}
        >
          {/* Une fenêtre ouverte depuis une page a SON titre et SES boutons :
              ils ne montent pas dans la barre de la page d'où elle vient. */}
          <EmplacementDuTitreDePage.Provider value={null}>
            <CibleDesGestesDePage.Provider value={null}>
              <CibleDuBasDePage.Provider value={null}>{children}</CibleDuBasDePage.Provider>
            </CibleDesGestesDePage.Provider>
          </EmplacementDuTitreDePage.Provider>
        </DialogPrimitive.Content>
      </div>
    </DialogPrimitive.Portal>
  );
}

/**
 * L'ADRESSE D'UNE FENÊTRE. Ce petit composant est posé DANS le contenu Radix,
 * qui n'est monté que fenêtre ouverte : il pose le nom dans la pile à
 * l'ouverture, l'en retire à la fermeture, et Précédent referme la fenêtre par
 * sa croix. (Posé dans `DialogContent` lui-même, toujours rendu par son parent,
 * il inscrivait les fenêtres FERMÉES dans l'adresse.)
 */
function AdresseDeFenetre({ adresse, fermer }: { adresse: string; fermer: () => void }) {
  useTiroirAdresse(adresse, true, (ouvert) => {
    if (!ouvert) fermer();
  });
  return null;
}

export function DialogContent({
  className,
  children,
  centre,
  adresse,
  plein,
  hauteurFixe,
  empile,
  ...props
}: ProprietesDeFenetre) {
  void centre;
  void plein;
  void hauteurFixe;
  void empile;
  const { entete, pied, corps } = repartirEmplacements(children);
  const croix = React.useRef<HTMLButtonElement>(null);
  return (
    <FenetreCentree className={className} {...props}>
      {adresse ? <AdresseDeFenetre adresse={adresse} fermer={() => croix.current?.click()} /> : null}
      {entete}
      {/* Le contenu d'une fenêtre déborde souvent : il s'efface au bord
          plutôt que de se couper net sous l'entête ou le pied. */}
      <ZoneDefilement
        fond="hsl(var(--bg))"
        data-fenetre-corps
        className={cn('px-5', entete.length ? 'pt-1' : 'pt-5', pied.length ? 'pb-4' : null)}
        style={pied.length ? undefined : { paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}
      >
        {corps}
      </ZoneDefilement>
      {pied}
      <DialogPrimitive.Close
        ref={croix}
        aria-label="Fermer"
        title={t('Fermer')}
        className="absolute right-3.5 top-3.5 z-10 rounded-md p-1.5 text-faint transition-colors hover:bg-raised hover:text-text"
      >
        <X className="h-4 w-4" />
      </DialogPrimitive.Close>
    </FenetreCentree>
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
  centre,
  adresse,
  plein,
  hauteurFixe,
  empile,
  ...props
}: ProprietesDeFenetre) {
  void centre;
  void plein;
  void hauteurFixe;
  void empile;
  const croix = React.useRef<HTMLButtonElement>(null);
  return (
    <FenetreCentree className={className} {...props}>
      {adresse ? <AdresseDeFenetre adresse={adresse} fermer={() => croix.current?.click()} /> : null}
      {children}
      <DialogPrimitive.Close
        ref={croix}
        aria-label="Fermer"
        title={t('Fermer')}
        className="absolute right-3.5 top-3.5 z-10 rounded-md p-1.5 text-faint transition-colors hover:bg-raised hover:text-text"
      >
        <X className="h-4 w-4" />
      </DialogPrimitive.Close>
    </FenetreCentree>
  );
}

/**
 * LA FENÊTRE DE LA VISIONNEUSE D'IMAGES : CENTRÉE, ET TOUJOURS DE LA MÊME
 * HAUTEUR. Ni volet qui monte du bas (l'aperçu y restait « coincé en bas »), ni
 * `FenetreCentree` (collée en bas sur téléphone, hauteur qui suit l'image) :
 * sur téléphone elle prend l'écran entier, zones sûres comprises ; sur
 * ordinateur une grande fenêtre de hauteur FIXE — une image haute et une image
 * large ouvrent exactement la même fenêtre. Le contenu reçoit une colonne : à
 * lui de poser son entête (avec `DialogClose`) et sa scène.
 */
export function FenetreDeVisionneuse({
  className,
  children,
  adresse,
  style,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { adresse?: string }) {
  const croix = React.useRef<HTMLButtonElement>(null);
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay data-voile-de-fenetre className="fixed inset-0 z-50 bg-voile/80 backdrop-blur-[3px] data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out">
        <BandeDuVoile />
      </DialogPrimitive.Overlay>
      <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center sm:p-4">
        <DialogPrimitive.Content
          data-fenetre-visionneuse
          className={cn(
            'pointer-events-auto relative flex w-full min-h-0 flex-col overflow-hidden bg-surface shadow-2xl outline-none',
            'h-[var(--hauteur-app,100dvh)] sm:h-[min(88dvh,940px)] sm:w-[min(1200px,100%)] sm:rounded-xl',
            'data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out',
            className,
          )}
          style={{
            paddingTop: 'var(--zone-sure-haut, 0px)',
            paddingBottom: 'var(--zone-sure-bas, 0px)',
            ['--fond-zone-defilement' as string]: 'hsl(var(--surface))',
            ...style,
          }}
          {...props}
        >
          {adresse ? <AdresseDeFenetre adresse={adresse} fermer={() => croix.current?.click()} /> : null}
          <EmplacementDuTitreDePage.Provider value={null}>
            <CibleDesGestesDePage.Provider value={null}>
              <CibleDuBasDePage.Provider value={null}>{children}</CibleDuBasDePage.Provider>
            </CibleDesGestesDePage.Provider>
          </EmplacementDuTitreDePage.Provider>
          <DialogPrimitive.Close ref={croix} className="hidden" aria-hidden tabIndex={-1} />
        </DialogPrimitive.Content>
      </div>
    </DialogPrimitive.Portal>
  );
}

export const DialogClose = DialogPrimitive.Close;

/**
 * UNE PAGE DE LA ZONE PRINCIPALE — ce qu'était le « tiroir ».
 *
 * PLUS RIEN NE MONTE DU BAS PAR-DESSUS L'ÉCRAN (demande du 11/10/2026 : « je ne
 * veux plus de volets, je veux que les choses s'ouvrent dans des pages à
 * droite, comme dans Claude Code ou ChatGPT Desktop »). Tout ce qui passait par
 * `Drawer` s'ouvre désormais en PAGE : elle occupe la zone principale, à droite
 * de la colonne des projets (tout l'écran sur téléphone), sans voile ni feuille
 * ni poignée à tirer. Une barre d'en-tête la coiffe — la flèche de retour, puis
 * ce que la page a à dire — et son contenu se centre dans une colonne lisible.
 *
 * LA COLONNE RESTE VIVANTE. La page n'est pas une fenêtre modale : on peut
 * toujours cliquer un projet ou un service dans la colonne, ce qui referme la
 * page et y mène. Un clic ailleurs (un message passager, l'assistant) ne la
 * referme pas.
 *
 * `--zone-principale-gauche` est posée par l'application (`app.tsx`) : le bord
 * gauche de la zone principale, mesuré. Sans elle — l'espace des clients, qui
 * n'a pas de colonne — la page prend toute la largeur.
 *
 * Le nom `FeuilleDeTiroir` et le composant `Drawer` sont GARDÉS : une
 * soixantaine d'écrans les appellent, aucun n'a eu à changer.
 */
/**
 * LA LARGEUR DE TOUT CE QUI N'EST PAS UN TABLEAU DE CARTES — une seule, pour
 * une page de service, un formulaire, une fiche (demande du 11/10/2026 : « que
 * tous les formulaires et tous les contenus en dehors des kanbans soient de la
 * même largeur »). Une fiche ouverte depuis une liste a exactement la largeur
 * de cette liste. Seuls les espaces de travail (tableaux, conversation d'une
 * carte, atelier du Studio, terminal) demandent autre chose par leur classe.
 */
export const CLASSE_LARGEUR_DE_CONTENU = 'max-w-[820px]';
/** Les marges d'une page autour de son contenu : avec elles, 756 px de lecture. */
export const CLASSE_MARGES_DE_PAGE = 'px-4 sm:px-8';
/*
 * L'ÉCHELLE DES ÉCARTS (demande du 22/10/2026 : « que tous les gaps soient
 * corrects »). Trois écarts verticaux entre deux blocs, et aucun autre :
 * SERRÉ (4 px) entre deux lignes d'un même groupe, BLOC (8 px) entre deux
 * blocs empilés, SECTION (16 px) entre deux sections. Les marges des côtés
 * d'une page (`CLASSE_MARGES_DE_PAGE`) valent la même chose que la SECTION sur
 * téléphone : 16 px. `scripts/verif-ecarts-et-alignements.mjs` lit les écarts
 * réels dans le navigateur et refuse ce qui sort de cette échelle (0, 4, 8,
 * 16 px : `gap-1`, `gap-2`, `gap-4`).
 */
/**
 * LE PIED D'UNE CONVERSATION : chaque bloc empilé sous le fil — déroulé du
 * cahier ou du tournage, « Ce que l'agent a vu », panneau de décision,
 * rangée d'action, barre d'écriture — porte CETTE classe, et rien d'autre ne
 * l'écarte de son voisin. Mêmes bords que la barre d'écriture (16 px, la marge
 * de page du téléphone), et un écart BLOC (8 px) au-dessus de chacun. Le
 * dernier bloc ajoute 8 px dessous : la zone sûre du bas est déjà réservée par
 * la page qui les porte (`FeuilleDeTiroir`), elle ne se recompte pas.
 */
export const CLASSE_BLOC_DU_PIED = 'shrink-0 px-4 pt-2';
/** Ce qui suit le dernier bloc du pied : l'écart BLOC, seul. */
export const CLASSE_FIN_DU_PIED = 'pb-2';
export const CLASSE_LARGEUR_PAGE = CLASSE_LARGEUR_DE_CONTENU;
/** La largeur de la feuille du bas (`Drawer feuille`) : 960 px au plus sur grand écran. */
const CLASSE_LARGEUR_TIROIR = 'max-w-[960px]';

/* Une hauteur demandée pour l'ancienne feuille (`max-h-[80dvh]`, `h-[92dvh]`)
   n'a plus de sens sur une page, qui prend toujours la hauteur de la zone. */
function sansHauteurDeFeuille(classe?: string): string | undefined {
  if (!classe) return classe;
  return classe
    .split(/\s+/)
    .filter((mot) => !/^(max-h-|min-h-\[|h-\[|h-full|h-screen)/.test(mot))
    .join(' ');
}

function FeuilleDeTiroir({
  onClose,
  open = true,
  plein,
  hauteurFixe,
  empile,
  enFenetre,
  entete,
  className,
  children,
  onInteractOutside,
  ...props
}: Omit<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, 'children'> & {
  onClose?: () => void;
  open?: boolean;
  plein?: boolean;
  hauteurFixe?: boolean;
  empile?: boolean;
  enFenetre?: boolean;
  /** L'en-tête propre à la page ; sans lui, la barre « Retour » ordinaire. */
  entete?: React.ReactNode;
  children: React.ReactNode;
}) {
  void open;
  void hauteurFixe;
  void enFenetre;
  /* L'EN-TÊTE PAR DÉFAUT EST LA BARRE AU FIL D'ARIANE de l'application : la
     page lui prête deux emplacements — son titre, ses gestes — et les offre à
     son contenu. Une page qui apporte son propre en-tête (la conversation d'une
     carte) garde tout chez elle. */
  const Entete = React.useContext(EnteteDePageParDefaut);
  const [cibleDuTitre, setCibleDuTitre] = React.useState<HTMLElement | null>(null);
  const [cibleDesGestes, setCibleDesGestes] = React.useState<HTMLElement | null>(null);
  const titreOccupe = React.useRef<symbol | null>(null);
  const emplacementDuTitre = React.useMemo(
    () => (cibleDuTitre ? { cible: cibleDuTitre, occupe: titreOccupe } : null),
    [cibleDuTitre],
  );
  const filDAriane = entete === undefined && !!Entete;
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Content
        {...props}
        data-tiroir={plein ? 'plein' : 'normal'}
        data-tiroir-empile={empile ? 'oui' : undefined}
        data-page-de-zone
        onWheel={defilerDepuisLesMarges}
        /* UNE PAGE N'EST PAS UNE FENÊTRE : à l'ouverture, le focus ne saute pas
           sur le premier bouton de sa barre, qui s'entourait d'un anneau sans
           qu'on l'ait touché. Il se pose sur la page elle-même. */
        tabIndex={-1}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus?.({ preventScroll: true });
        }}
        /* SEULE LA COLONNE REFERME LA PAGE EN CLIQUANT DEHORS : elle mène
           ailleurs, la page n'a plus lieu d'être. Tout autre clic extérieur
           (message passager, assistant, module de voix) la laisse ouverte —
           et, dans la colonne, le bouton qui la replie ou la déplie : il ne
           mène nulle part, il change seulement la place qu'elle prend — comme
           le pied de la colonne, qui n'ouvre que des volets par-dessus. */
        onInteractOutside={(event) => {
          onInteractOutside?.(event);
          const cible = event.target as Element | null;
          /* …et, dans la colonne, le MENU DE LA PAGE ELLE-MÊME (les options
             d'une tâche, `data-colonne-de-page`) : y choisir une ligne change
             ce que la page montre, il ne la quitte pas.
             …et le PIED de la colonne (`data-pied-colonne` : quotas, cloche,
             réglages) : il n'ouvre que des volets ou des fenêtres par-dessus la
             page, on la retrouve en les refermant. */
          if (
            !cible?.closest?.('[data-colonne-projets]') ||
            cible.closest('[data-replier-colonne]') ||
            cible.closest('[data-colonne-de-page]') ||
            cible.closest('[data-pied-colonne]')
          )
            event.preventDefault();
        }}
        className={cn(
          'fixed bottom-0 right-0 top-0 flex flex-col overflow-hidden bg-bg outline-none',
          /* UNE PAGE OUVERTE PAR-DESSUS (`empile`) PASSE DEVANT LA FENÊTRE QUI
             L'A OUVERTE. Les fenêtres sont en `z-50` : en `z-40`, la page de
             l'agent de configuration s'ouvrait SOUS la fenêtre « Configuration
             du projet », et rien ne s'y cliquait. À rang égal, c'est la
             dernière ouverte qui est devant — la page, puis les menus et les
             fenêtres qu'elle ouvre à son tour. */
          empile ? 'z-50' : 'z-40',
          'left-0 sm:left-[var(--zone-principale-gauche,0px)]',
          'data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out',
        )}
        style={{
          /* La page s'arrête sous la barre d'état et au-dessus de la barre
             d'accueil du téléphone, et laisse sa place au clavier. */
          paddingTop: 'var(--zone-sure-haut, 0px)',
          paddingBottom: 'calc(var(--zone-sure-bas, 0px) + var(--clavier, 0px))',
          /* LA MARGE DU HAUT EST DÉJÀ COMPTÉE ICI : la barre d'en-tête de la
             page (`EnteteDeZone`) ne la recompte pas. Comptée deux fois, elle
             laissait une bande vide de la hauteur de l'heure sur téléphone. */
          ['--zone-sure-entete' as string]: '0px',
          /* Une page EST le fond de page : tout ce qui, dedans, se réglait sur
             le fond d'un tiroir (`--surface`) se règle sur lui. */
          ['--surface' as string]: 'var(--bg)',
          ['--fond-zone-defilement' as string]: 'hsl(var(--bg))',
        }}
      >
        {entete ?? (Entete ? (
          <Entete fermer={() => onClose?.()} onCibleDuTitre={setCibleDuTitre} onCibleDesGestes={setCibleDesGestes} />
        ) : (
          <div data-entete-de-page className="flex h-14 shrink-0 items-center gap-1.5 px-4 max-sm:h-12 max-sm:px-2">
            <DialogPrimitive.Close
              aria-label="Fermer"
              data-poignee-tiroir
              data-retour-de-page
              className="flex h-8 items-center gap-1.5 rounded-md pl-1.5 pr-2.5 text-[14px] text-muted transition-colors hover:bg-raised hover:text-text"
            >
              <ArrowLeft className="h-4 w-4" />
              {t('Retour')}
            </DialogPrimitive.Close>
          </div>
        ))}
        <EmplacementDuTitreDePage.Provider value={filDAriane ? emplacementDuTitre : null}>
          <CibleDesGestesDePage.Provider value={filDAriane ? cibleDesGestes : null}>
            {/* Une page ouverte par-dessus recouvre le bas de l'écran : son
                geste principal reste dans SA barre d'en-tête. */}
            <CibleDuBasDePage.Provider value={null}>
              <div
                data-corps-de-page
                className={cn('mx-auto flex min-h-0 w-full flex-1 flex-col sm:px-5', CLASSE_LARGEUR_PAGE, sansHauteurDeFeuille(className))}
              >
                {children}
              </div>
            </CibleDuBasDePage.Provider>
          </CibleDesGestesDePage.Provider>
        </EmplacementDuTitreDePage.Provider>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/**
 * LA FEUILLE DU BAS, À LA DEMANDE (`Drawer feuille`) : voile, feuille qui monte
 * du bas, poignée qu'on tire vers le bas pour refermer. Le voile recouvre toute
 * l'application et un clic dessus referme la feuille (jamais deux à la fois). C'est l'ancien tiroir,
 * rétabli pour DEUX surfaces seulement — « Déploiement » et « Mise en
 * production » (demande du 15/10/2026 : « des drawers, pas des pages
 * entières »). Tout le reste de l'application garde sa page de zone.
 *
 * Elle n'a ni barre d'en-tête ni fil d'Ariane : le titre et les gestes de son
 * contenu se posent EN TÊTE de la feuille, dans le contenu (`DialogTitle`,
 * `GestesDePage` y retrouvent leur repli « sans barre »).
 */
function FeuilleDuBas({
  onClose,
  open,
  plein,
  hauteurFixe,
  empile,
  className,
  children,
}: {
  onClose: () => void;
  open: boolean;
  plein?: boolean;
  hauteurFixe?: boolean;
  empile?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [decalage, setDecalage] = React.useState(0);
  const depart = React.useRef<number | null>(null);
  const poignee = {
    onPointerDown: (event: React.PointerEvent) => {
      depart.current = event.clientY;
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
      // `onClose()` ne vit pas dans la fonction de mise à jour : React la joue
      // pendant le rendu.
      const tire = decalage;
      setDecalage(0);
      if (tire > 110) onClose();
    },
  };
  const hauteurPleine = 'calc(100dvh - max(10px, var(--zone-sure-haut, 0px)) - var(--clavier, 0px))';
  return (
    <DialogPrimitive.Portal>
      {/* LE VOILE EST UNE VRAIE SURFACE (demande du 15/10/2026 : « le backdrop ne
          recouvre pas l'application, je peux encore cliquer sur des boutons »).
          Il couvre tout l'écran — colonne de gauche et barre du haut comprises —
          et rien de ce qui est dessous ne réagit tant que la feuille est
          ouverte. Un clic dessus referme CETTE feuille, et seulement elle : il
          ne mène nulle part (cliquer un projet de la colonne n'y emmène plus en
          même temps). La fermeture se fait au CLIC, pas à l'appui : le clic est
          consommé par le voile lui-même, il ne retombe pas sur le bouton
          dessous. Le voile reste monté pendant l'animation de sortie
          (`Portal` de Radix), donc il absorbe aussi le clic fantôme d'un
          toucher. `onInteractOutside` ignore le voile (voir plus bas) : deux
          feuilles empilées ne se ferment pas ensemble. */}
      <div
        data-voile-tiroir
        data-state={open ? 'open' : 'closed'}
        aria-hidden
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        className="fixed inset-0 z-50 bg-voile/70 data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out"
      >
        <BandeDuVoile />
      </div>
      <DialogPrimitive.Content
        onInteractOutside={(event) => {
          /* Ni le focus qui passe ailleurs, ni un menu, une fenêtre ou une
             info-bulle posés par-dessus ne referment la feuille. Le VOILE non
             plus, d'ici : c'est lui qui ferme sa propre feuille au clic
             (`onClick` plus haut) — sans quoi le voile d'une feuille posée
             par-dessus fermerait aussi celle du dessous. */
          const cible = event.target as Element | null;
          const origine = (event.detail as { originalEvent?: Event } | undefined)?.originalEvent;
          if (
            origine?.type === 'focusin' ||
            cible?.closest?.(
              '[data-voile-tiroir], [role="dialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper], [data-replier-colonne], [data-pied-colonne], [data-fenetre-centree]',
            )
          )
            event.preventDefault();
        }}
        data-tiroir={plein ? 'plein' : 'normal'}
        data-tiroir-empile={empile ? 'oui' : undefined}
        data-feuille-du-bas
        className={cn(
          'fixed inset-x-0 z-50 mx-auto flex w-full flex-col overflow-hidden bg-surface outline-none',
          CLASSE_LARGEUR_TIROIR,
          'rounded-t-xl sm:rounded-t-2xl',
          'data-[state=open]:animate-slide-sheet data-[state=closed]:animate-slide-sheet-out',
          empile ? 'shadow-[0_-14px_38px_-10px_rgba(0,0,0,0.7)]' : 'shadow-[0_-10px_30px_-12px_rgba(0,0,0,0.55)]',
          className,
        )}
        style={{
          bottom: 'var(--clavier, 0px)',
          maxHeight: plein ? hauteurPleine : 'calc(92dvh - var(--clavier, 0px))',
          height: plein ? hauteurPleine : hauteurFixe ? 'calc(92dvh - var(--clavier, 0px))' : undefined,
          paddingBottom: 'var(--zone-sure-bas, 0px)',
          transform: decalage ? `translateY(${decalage}px)` : undefined,
          transition: depart.current === null ? 'transform 180ms ease-out' : undefined,
          ['--fond-zone-defilement' as string]: 'hsl(var(--surface))',
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus?.({ preventScroll: true });
        }}
        tabIndex={-1}
      >
        <div
          {...poignee}
          onPointerCancel={poignee.onPointerUp}
          data-poignee-tiroir
          className={cn(
            'flex shrink-0 cursor-grab touch-none justify-center active:cursor-grabbing',
            plein ? 'pb-2 pt-3.5' : 'pb-3 pt-5',
          )}
        >
          <DialogPrimitive.Close
            aria-label="Fermer"
            className="h-1 w-10 rounded-full bg-muted transition-colors hover:bg-text"
          />
        </div>
        {/* Une feuille n'a pas de barre de page : son titre et ses gestes
            restent dans son contenu, jamais dans la barre de la page dessous. */}
        <EmplacementDuTitreDePage.Provider value={null}>
          <CibleDesGestesDePage.Provider value={null}>
            <CibleDuBasDePage.Provider value={null}>{children}</CibleDuBasDePage.Provider>
          </CibleDesGestesDePage.Provider>
        </EmplacementDuTitreDePage.Provider>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function Drawer({
  open,
  onClose,
  children,
  className,
  empile,
  enPage,
  plein,
  hauteurFixe,
  adresse,
  onOuvrir,
  pret,
  entete,
  feuille,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  /**
   * LA FEUILLE DU BAS au lieu de la page de zone : voile, poignée à tirer,
   * titre et gestes en tête du contenu. Réservé à « Déploiement » et « Mise en
   * production » — les autres écrans restent des pages (refonte du 11/10/2026).
   */
  feuille?: boolean;
  /** L'en-tête propre à la page (fil d'Ariane, gestes) ; sans lui, la barre « Retour ». */
  entete?: React.ReactNode;
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
  /**
   * LE NOM DU VOLET DANS L'ADRESSE DU NAVIGATEUR (« pieces-jointes ») : un mot
   * court, unique dans l'application. Ouvert, il s'écrit après l'écran
   * (« #projet/<id>/volet/pieces-jointes ») ; Précédent le referme. Sans
   * `onOuvrir`, un lien collé ne le rouvre pas (volet qui dépend d'un choix
   * fait à l'écran) — mais l'adresse change quand même à l'ouverture.
   */
  adresse?: string;
  /** Rouvrir le volet quand l'adresse le désigne (lien collé, Suivant). */
  onOuvrir?: () => void;
  /** Les données du volet sont arrivées : avant, un lien collé n'ouvre rien. */
  pret?: boolean;
}) {
  /* Le volet suit l'adresse du navigateur dès qu'il porte un nom. */
  useTiroirAdresse(enPage ? null : adresse, open, (ouvert) => (ouvert ? onOuvrir?.() : onClose()), {
    pret: pret ?? true,
  });

  if (enPage) {
    return (
      <DialogPrimitive.Root open={open} modal={false} onOpenChange={() => undefined}>
        <DialogPrimitive.Content
          data-ecran-plein
          onInteractOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.preventDefault()}
          // UNE PAGE N'EST PAS UNE FENÊTRE : à l'ouverture, le focus ne saute pas
          // sur son premier bouton, qui s'entourait d'un anneau sans qu'on l'ait
          // touché.
          onOpenAutoFocus={(event) => event.preventDefault()}
          // AUCUN CONTOUR DE FOCUS SUR L'ÉCRAN ENTIER : la fenêtre reçoit le focus à
          // l'ouverture, et le navigateur l'entourait d'un cadre bleu (capture #e021).
          // Les boutons qu'elle contient gardent leur propre anneau.
          //
          // UNE COLONNE ÉTROITE, CENTRÉE DANS LA ZONE, AVEC DE L'AIR AU-DESSUS :
          // la page ne colle plus aux bords. Un écran qui porte un tableau ou un
          // atelier demande plus large par sa propre classe (`max-w-…`).
          className={cn(
            'mx-auto flex h-full min-h-0 w-full flex-col pt-2 outline-none sm:pt-8',
            CLASSE_LARGEUR_DE_CONTENU,
            CLASSE_MARGES_DE_PAGE,
            className,
          )}
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

  if (feuille) {
    return (
      <DialogPrimitive.Root open={open} modal={false} onOpenChange={(next) => !next && onClose()}>
        <FeuilleDuBas onClose={onClose} open={open} plein={plein} hauteurFixe={hauteurFixe} empile={empile} className={className}>
          {children}
        </FeuilleDuBas>
      </DialogPrimitive.Root>
    );
  }

  return (
    /* `modal={false}` : la page ne fige pas le reste de l'écran — la colonne des
       projets reste cliquable (voir `FeuilleDeTiroir`). */
    <DialogPrimitive.Root open={open} modal={false} onOpenChange={(next) => !next && onClose()}>
      <FeuilleDeTiroir
        open={open}
        onClose={onClose}
        plein={plein}
        hauteurFixe={hauteurFixe}
        empile={empile}
        entete={entete}
        className={className}
      >
        {children}
      </FeuilleDeTiroir>
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
        <DialogPrimitive.Overlay data-voile-de-fenetre className="fixed inset-0 z-50 bg-voile/70 backdrop-blur-[2px] data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out">
          <BandeDuVoile />
        </DialogPrimitive.Overlay>
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
            paddingTop: 'var(--zone-sure-haut, 0px)',
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

/**
 * L'EN-TÊTE COMMUN DES FEUILLES DU BAS (demande du 19/10/2026 : « homogénéise
 * les drawers »). Trois colonnes, les deux côtés de largeur ÉGALE : le titre
 * est donc TOUJOURS au centre exact de la feuille, qu'il y ait zéro, un ou
 * trois boutons d'un côté. À gauche ce qui situe (retour, icône du sujet), à
 * droite ce qui agit (interrupteur, réglages). Le « i » se pose juste après le
 * titre, hors du calcul du centre : c'est le TEXTE du titre qui est centré.
 * Le titre est le `DialogTitle` de la feuille, lu à voix haute.
 */
export function EnteteDeFeuille({
  titre,
  info,
  gauche,
  droite,
  sousTitre,
  className,
  ...attributs
}: {
  titre: React.ReactNode;
  /** L'explication du titre, derrière un « i » posé à sa droite. */
  info?: React.ReactNode;
  gauche?: React.ReactNode;
  droite?: React.ReactNode;
  /** Une ligne discrète sous le titre, centrée avec lui. */
  sousTitre?: React.ReactNode;
  className?: string;
} & Record<`data-${string}`, string | number | boolean | undefined>) {
  return (
    <header className={cn('shrink-0 px-3 pb-2', className)} data-entete-feuille {...attributs}>
      <div className="grid min-h-8 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <div className="flex min-w-0 items-center justify-start gap-1" data-entete-gauche>
          {gauche}
        </div>
        <div className="relative flex min-w-0 max-w-[min(70vw,560px)] items-center justify-center" data-entete-titre>
          <DialogTitle className="min-w-0 truncate text-center text-[15.5px] font-semibold text-text">{titre}</DialogTitle>
          {info ? (
            <span className="absolute left-full top-1/2 ml-0.5 flex -translate-y-1/2 items-center" data-entete-info>
              <BulleInfo cote="start">{info}</BulleInfo>
            </span>
          ) : null}
        </div>
        <div className="flex min-w-0 items-center justify-end gap-1" data-entete-droite>
          {droite}
        </div>
      </div>
      {sousTitre ? (
        <p className="mt-0.5 truncate text-center text-[12.5px] text-faint" data-entete-sous-titre>
          {sousTitre}
        </p>
      ) : null}
    </header>
  );
}

export function DialogTitle({ className, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  /* DANS UNE PAGE, LE TITRE EST LE DERNIER CRAN DU FIL D'ARIANE : le premier
     titre écrit monte dans la barre d'en-tête de la page, au lieu de refaire un
     en-tête sous elle. Il reste le titre lu à voix haute de la page. */
  const emplacement = React.useContext(EmplacementDuTitreDePage);
  const jeton = React.useRef(Symbol('titre'));
  const [enTete, setEnTete] = React.useState(false);
  React.useLayoutEffect(() => {
    if (!emplacement) {
      setEnTete(false);
      return;
    }
    if (emplacement.occupe.current && emplacement.occupe.current !== jeton.current) return;
    emplacement.occupe.current = jeton.current;
    setEnTete(true);
    const mien = jeton.current;
    return () => {
      if (emplacement.occupe.current === mien) emplacement.occupe.current = null;
    };
  }, [emplacement]);
  if (emplacement && enTete) {
    return ReactDOM.createPortal(
      <DialogPrimitive.Title className="min-w-0 truncate text-[14.5px] font-medium text-text" data-titre-de-page {...props} />,
      emplacement.cible,
    );
  }
  return <DialogPrimitive.Title className={cn('text-[15.5px] font-semibold text-text', className)} {...props} />;
}

/**
 * LE TITRE D'UNE PAGE DE SERVICE : grand, seul sur sa ligne, en tête de la
 * colonne centrée. Il reste le titre lu à voix haute de la page (`Dialog`).
 *
 * SUR TÉLÉPHONE, LE NOM DE LA PAGE NE S'ÉCRIT QU'UNE FOIS, dans la barre
 * d'en-tête (demande du 11/10/2026 : « éviter les doubles header avec le titre
 * à double ») : ce titre-ci ne se dessine plus (`CLASSE_TITRE_SEUL_EN_BARRE`),
 * il reste seulement lu à voix haute.
 */
export const CLASSE_TITRE_SEUL_EN_BARRE = 'max-sm:sr-only';
export function TitreDePage({ className, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-titre-de-page
      className={cn('shrink-0 pb-5 text-[26px] font-semibold leading-tight tracking-tight text-text sm:pb-6', className, CLASSE_TITRE_SEUL_EN_BARRE)}
      {...props}
    />
  );
}

/** UNE LISTE REGROUPÉE : un seul fond doux, sans trait, qui porte toutes ses lignes. */
export const CLASSE_GROUPE_DE_LIGNES = 'flex flex-col gap-0.5 rounded-2xl bg-surface p-1.5';
/** Une ligne d'une liste regroupée : son fond ne paraît qu'au survol. */
export const CLASSE_LIGNE_DE_GROUPE = 'rounded-xl px-3.5 py-3 text-left transition-colors hover:bg-raised';

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

/* CONTRASTÉE : l'encre du thème devient le fond de la bulle et le fond du thème
   son texte — noire sur une interface claire, blanche sur une interface sombre. */
const CLASSES_INFOBULLE =
  'pointer-events-none z-[100] max-w-[280px] select-none whitespace-pre-line rounded-md bg-text px-2 py-1.5 text-[13px] leading-snug text-surface shadow-xl';

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={DELAI_INFOBULLE_MS} skipDelayDuration={400}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

/** Vrai sous un `Tooltip` : un bouton y garde sa bulle d'enveloppe, sans `title` en doublon. */
const DansUneInfobulle = React.createContext(false);

export function Tooltip({ children, label }: { children: React.ReactNode; label: React.ReactNode }) {
  const survol = useSurvol();
  // Sans survol, l'infobulle ne s'affichera JAMAIS (elle est masquée en dessous
  // de `sm`) : son déclencheur ne ferait que s'interposer entre le doigt et ce
  // qu'il vise — un interrupteur, par exemple. On ne le pose donc pas du tout.
  if (!label || !survol) return <>{children}</>;
  return (
    <DansUneInfobulle.Provider value>
    <TooltipPrimitive.Root delayDuration={DELAI_INFOBULLE_MS}>
      <TooltipPrimitive.Trigger asChild data-infobulle-declencheur="">
        {children}
      </TooltipPrimitive.Trigger>
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
    </DansUneInfobulle.Provider>
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
      const trouve = (e.target as Element | null)?.closest?.('[title],[data-infobulle-titre]') as HTMLElement | null;
      /* UNE BULLE PLUS PROCHE GAGNE : un déclencheur de `Tooltip` posé DANS
         l'élément titré (l'interrupteur dans l'entête d'une colonne) a sa
         propre bulle — celle de l'ancêtre la recouvrait et l'empêchait de
         paraître. */
      const declencheur = (e.target as Element | null)?.closest?.('[data-infobulle-declencheur]');
      const el = trouve && declencheur && declencheur !== trouve && trouve.contains(declencheur) ? null : trouve;
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
  dansBarre: dansBarreVoulue,
}: {
  children: React.ReactNode;
  label?: string;
  cote?: 'start' | 'end';
  /**
   * DANS UNE BARRE D'EN-TÊTE : la même case de 32 px que les boutons qui
   * l'entourent (`CLASSE_RANGEE_DE_BOUTONS`), au lieu de la petite case de
   * 20 px d'un « i » posé à côté d'un titre — qui faisait paraître l'écart
   * plus large de ce côté-là.
   */
  dansBarre?: boolean;
}) {
  const dansUneBarre = React.useContext(DansUneBarreDEnTete);
  const dansBarre = dansBarreVoulue ?? dansUneBarre;
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
          className={cn(
            'flex shrink-0 items-center justify-center text-faint transition-colors hover:bg-bloc hover:text-text data-[state=open]:text-text',
            dansBarre ? 'h-8 w-8 rounded-lg' : 'h-5 w-5 rounded-full',
          )}
        >
          <Info className={dansBarre ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
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
          className="z-[60] max-w-[300px] select-text whitespace-pre-line rounded-md border border-border bg-raised px-2.5 py-2 text-[12.5px] font-normal normal-case leading-relaxed tracking-normal text-muted shadow-xl animate-fade-in max-sm:max-w-none max-sm:rounded-b-none max-sm:px-4 max-sm:pb-6 max-sm:pt-3"
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
    >
      <BandeDuVoile />
    </div>,
    document.body,
  );
}

/**
 * LA POIGNÉE D'UN PANNEAU QUI MONTE DU BAS (menu, liste déroulante sur
 * téléphone) : on le referme en la tirant vers le bas. Le geste part de la
 * poignée seule, sinon il empêcherait le contenu de défiler. Rend les
 * écouteurs à étaler sur la poignée et le style à poser sur le panneau.
 */
function usePoigneeDuBas(fermer: () => void) {
  const [decalage, setDecalage] = React.useState(0);
  const depart = React.useRef<number | null>(null);
  const relacher = () => {
    if (depart.current === null) return;
    depart.current = null;
    setDecalage((valeur) => {
      if (valeur > 110) fermer();
      return 0;
    });
  };
  return {
    poignee: {
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
      onPointerUp: relacher,
      onPointerCancel: relacher,
    },
    style: {
      transform: decalage ? `translateY(${decalage}px)` : undefined,
      transition: depart.current === null ? 'transform 180ms ease-out' : undefined,
    } as React.CSSProperties,
  };
}

/**
 * UN PANNEAU POSÉ EN BAS DE L'ÉCRAN DU TÉLÉPHONE PREND TOUTE LA LARGEUR, quoi
 * que demande son appelant (demande du 11/10/2026 : « ces drawer qui ne sont pas
 * en pleine largeur »). Sous 640 px l'enveloppe est déjà épinglée d'un bord à
 * l'autre (`styles.css`) ; c'est le CONTENU qu'un `max-w-…` d'appelant bridait
 * — le menu de la Mémoire s'arrêtait à 320 px. Cette classe se pose APRÈS
 * `className`, et ses « ! » la rendent impossible à plafonner.
 */
export const CLASSE_PANNEAU_DU_BAS_PLEINE_LARGEUR = 'max-sm:!w-full max-sm:!max-w-none';

/**
 * LA TAPE QUI FERME UN MENU DU BAS NE TOUCHE RIEN D'AUTRE (demande du
 * 13/10/2026 : fermer le volet des quotas ouvrait « Dans quel projet ? »).
 *
 * La bibliothèque des menus ferme à l'APPUI, pas au clic, contrairement aux
 * fenêtres. Le tiroir se retire ensuite pendant 200 ms, puis sa couche
 * disparaît ; or le doigt, lui, est encore posé. Quand il se lève, le clic du
 * même geste est distribué à ce qui se trouve alors SOUS le doigt — ici le
 * bouton « Nouvel agent » de la colonne des projets — et un toucher un peu long
 * suffit à dépasser la sortie du tiroir. Aucune couche ne tient plus ce clic :
 * on l'attrape donc nous-mêmes, une seule fois, avant qu'il n'atteigne la page.
 *
 * L'écouteur ne vit que de cet appui au clic du MÊME geste. Il tombe sur
 * `pointercancel` (le geste est devenu un défilement : aucun clic ne viendra),
 * 400 ms après le relâché (le clic suit le relâché presque aussitôt), à l'appui
 * suivant, et par un garde-fou — un clic qui n'a rien à voir avec la fermeture
 * ne doit jamais être mangé. Seul le téléphone est concerné : sur grand écran
 * le menu n'est pas un tiroir et le clic ordinaire reste celui de la page.
 */
function avalerLaTapeDeFermeture(): void {
  if (typeof window === 'undefined' || window.matchMedia('(min-width: 640px)').matches) return;
  let relache = false;
  let minuterie: number | undefined;
  const garde = window.setTimeout(() => retirer(), 10_000);
  function retirer() {
    window.clearTimeout(minuterie);
    window.clearTimeout(garde);
    window.removeEventListener('click', avaler, true);
    window.removeEventListener('pointerup', apresLeRelache, true);
    window.removeEventListener('pointercancel', retirer, true);
    window.removeEventListener('pointerdown', apresUnAutreAppui, true);
  }
  function avaler(event: Event) {
    event.stopPropagation();
    event.preventDefault();
    retirer();
  }
  function apresLeRelache() {
    relache = true;
    minuterie = window.setTimeout(retirer, 400);
  }
  function apresUnAutreAppui() {
    // Un nouvel appui, une fois le doigt levé : le clic attendu n'est pas venu.
    if (relache) retirer();
  }
  window.addEventListener('click', avaler, true);
  window.addEventListener('pointerup', apresLeRelache, true);
  window.addEventListener('pointercancel', retirer, true);
  window.addEventListener('pointerdown', apresUnAutreAppui, true);
}

export function DropdownMenuContent({
  className,
  onPointerDownOutside,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Content>) {
  /*
   * Sur téléphone le menu est un TIROIR, donc il se referme comme les autres :
   * en tirant la poignée vers le bas (`usePoigneeDuBas`). Le menu n'expose pas
   * son « fermer » : on passe par la touche d'échappement, que la bibliothèque
   * écoute déjà.
   */
  const panneau = React.useRef<HTMLDivElement | null>(null);
  const { poignee, style: styleDeLaPoignee } = usePoigneeDuBas(() =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  );

  return (
    <DropdownPrimitive.Portal>
      {/* Posé en bas, sur toute la largeur, avec sa poignée. Les classes « ! »
          sont nécessaires pour couvrir le placement calculé par la
          bibliothèque. */}
      <DropdownPrimitive.Content
        ref={panneau}
        sideOffset={4}
        className={cn(
          // RANG 60 : AU-DESSUS DE LA COLONNE DÉPLIÉE AU SURVOL (`z-[55]`, sidebar.tsx),
          // qui ouvre elle-même des menus — en `z-50`, ils passeraient sous elle.
          'z-[60] flex min-w-[190px] flex-col overflow-hidden border border-border bg-bg p-1.5 shadow-xl',
          'data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out',
          // La hauteur réelle de l'écran, mesurée en direct : dvh seul laisse
          // une bande vide quand l'application est installée sur le téléphone.
          // Le tiroir passe AU-DESSUS de son propre voile, lui-même au-dessus
          // des panneaux déjà ouverts.
          'max-sm:z-[60] max-sm:w-full max-sm:max-h-[calc(var(--hauteur-app,100dvh)*0.8)] max-sm:rounded-t-xl',
          'max-sm:border-x-0 max-sm:border-b-0 max-sm:p-2 max-sm:pb-[calc(10px+env(safe-area-inset-bottom))]',
          'max-sm:data-[state=open]:animate-slide-sheet max-sm:data-[state=closed]:animate-slide-sheet-out',
          'sm:rounded-xl',
          className,
          CLASSE_PANNEAU_DU_BAS_PLEINE_LARGEUR,
        )}
        style={styleDeLaPoignee}
        onPointerDownOutside={(event) => {
          onPointerDownOutside?.(event);
          // Un appelant qui retient la fermeture garde aussi son clic.
          if (!event.defaultPrevented) avalerLaTapeDeFermeture();
        }}
        {...props}
      >
        {/* Le voile part dans la page, pas ici : la bibliothèque n'accepte
            qu'un seul enfant sous son portail. */}
        <VoileMenu panneau={panneau} />
        <div
          {...poignee}
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
        'flex cursor-pointer select-none items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] text-text outline-none data-[highlighted]:bg-raised data-[disabled]:cursor-default data-[disabled]:opacity-50',
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
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.SubContent>) {
  return (
    <DropdownPrimitive.Portal>
      {/* Sur grand écran, le sous-menu FLOTTE à côté de son entrée, et la
          bibliothèque le replace s'il sortait de l'écran. Sur téléphone, tout
          panneau flottant se pose au bas de l'écran (`styles.css`) : il passe
          donc AU-DESSUS du panneau du menu (z-index plus haut) et en prend la
          tenue — coins du haut arrondis, creux du bas réservé.
          UNE LISTE LONGUE (les modèles d'un moteur, les étiquettes d'un
          projet) NE SORT PAS DE L'ÉCRAN : la hauteur est bornée à la place
          libre, et la liste défile chez elle. */}
      <DropdownPrimitive.SubContent
        sideOffset={2}
        alignOffset={-4}
        collisionPadding={8}
        className={cn(
          'z-[60] flex min-w-[170px] flex-col overflow-hidden rounded-md border border-border bg-surface p-1 shadow-xl',
          'max-h-[min(420px,var(--radix-dropdown-menu-content-available-height))]',
          'data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out',
          'max-sm:z-[70] max-sm:max-h-[calc(var(--hauteur-app,100dvh)*0.7)] max-sm:rounded-b-none max-sm:rounded-t-xl',
          'max-sm:border-x-0 max-sm:border-b-0 max-sm:p-2 max-sm:pb-[calc(10px+env(safe-area-inset-bottom))]',
          className,
          CLASSE_PANNEAU_DU_BAS_PLEINE_LARGEUR,
        )}
        {...props}
      >
        <ZoneDefilement fond="hsl(var(--surface))" hauteur={24} className="overscroll-contain">
          {children}
        </ZoneDefilement>
      </DropdownPrimitive.SubContent>
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
export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> & {
    /** Une réponse est attendue : le rond porte un anneau qui tourne. */
    attente?: boolean;
  }
  /* LA RÉFÉRENCE PASSE : sous un `Tooltip`, la bulle s'accroche à l'interrupteur
     par elle — sans, elle s'ouvrait hors de l'écran. */
>(function Switch({ className, attente, disabled, ...props }, ref) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      aria-busy={attente || undefined}
      disabled={disabled || attente}
      className={cn(
        /* AUCUN TRAIT : c'est le fond qui dit l'état. Éteint, un gris franc
           (`--faint` voilé) — en `--raised`, tout près du fond, on ne voyait
           plus l'interrupteur, en clair comme en sombre. */
        'peer relative inline-flex h-[18px] w-[32px] shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors data-[state=checked]:bg-accent data-[state=unchecked]:bg-faint/40',
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
});

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

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon ? <div className="text-faint">{icon}</div> : null}
      <p className="text-[14.5px] font-medium text-muted">{title}</p>
      {hint ? <p className="max-w-[260px] text-[13.5px] text-faint">{hint}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
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
      <DialogContent adresse="confirmation" className="sm:w-[min(420px,100%)]">
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
      <DialogContent adresse="saisie" className="sm:w-[min(440px,100%)]">
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
 *  - `MenuActions` : le bouton « … » qui range les gestes rares dans un petit
 *    menu ancré sous lui (jamais une page), avec un repère chiffré quand
 *    quelque chose est actif.
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
 * même largeur au moins) ; sur TÉLÉPHONE, elle monte du bas — sous le pouce —
 * dans le MÊME panneau qu'un menu (`DropdownMenuContent`) : voile, poignée à
 * tirer, hauteur bornée. UNE LISTE DE CHOIX N'EST JAMAIS UNE PAGE (demande du
 * 11/10/2026, « la liste de clients doit être un dropdown ») : elle passait
 * par `Drawer`, devenu une page entière avec la refonte, et choisir un client
 * quittait l'écran. Le corps est le même des deux côtés : recherche dès que les
 * choix dépassent `seuilRecherche`, icône, description sur une seconde ligne,
 * coche du choix retenu, geste propre à chaque ligne (▶ écouter), intertitres,
 * et le CLAVIER (flèches, Début/Fin, Entrée, Échap ; la frappe va à la recherche).
 *
 * Une ligne d'option est un `div role="option"`, jamais un `button` : elle peut
 * porter son propre bouton (le geste à droite) et un texte replié.
 *
 * CHOIX MULTIPLE : avec `valeurs`, chaque ligne porte une case, `onChoisir`
 * reçoit l'option BASCULÉE et la liste RESTE OUVERTE pour la coche suivante
 * (les projets d'un accès client). `valeur` est alors ignorée.
 */
export function ListeDeroulante({
  valeur,
  valeurs,
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
  /** Le mode MULTIPLE : les valeurs cochées ; `onChoisir` bascule une option sans refermer. */
  valeurs?: string[];
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
  const multiple = !!valeurs;
  const estChoisie = (v: string) => (valeurs ? valeurs.includes(v) : v === valeur);
  const retenue = multiple ? undefined : options.find((o) => o.valeur === valeur);
  const cochees = multiple ? options.filter((o) => valeurs!.includes(o.valeur)) : [];
  const libelle = multiple ? (cochees.length ? cochees.map((o) => o.libelle).join(', ') : placeholder ?? '—') : retenue?.libelle ?? placeholder ?? '—';
  const rienDeRetenu = multiple ? !cochees.length : !retenue;
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
    setActif(Math.max(0, options.findIndex((o) => estChoisie(o.valeur))));
  }, [ouvert]);
  /* MODALE DANS UNE FENÊTRE, la liste ne se fermait pas à un appui sur la fenêtre elle-même (le libellé de son
     champ, un autre champ) : Radix n'y voyait pas un appui « dehors ». Elle se ferme donc ici, au même titre. */
  /* `panneau` DOIT ÊTRE POSÉ SUR LE PANNEAU AFFICHÉ, téléphone compris : sans lui, cet écouteur prend CHAQUE appui
     pour un appui dehors — la liste se refermait à la première coche d'un choix multiple, ou dès qu'on touchait
     sa recherche. */
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
  /* SUR TÉLÉPHONE, « PRÉCÉDENT » REFERME LA LISTE au lieu de quitter l'écran :
     ouverte, elle s'écrit dans l'adresse comme un volet. */
  useTiroirAdresse(telephone ? 'choix' : null, ouvert, (encore) => {
    if (!encore) setOuvert(false);
  });
  const { poignee, style: styleDeLaPoignee } = usePoigneeDuBas(() => setOuvert(false));
  void empile;
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
    if (!multiple) setOuvert(false);
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
    const choisie = estChoisie(option.valeur);
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
          /* L'OPTION RETENUE S'ÉCRIT EN VIOLET (`--teinte`), survolée ou non :
             la coche seule, au bout de la ligne, ne suffisait pas à la
             distinguer des autres. */
          option.desactivee
            ? 'cursor-default opacity-50'
            : cn(index === actif && 'bg-raised', choisie ? 'text-teinte' : index === actif ? 'text-text' : 'text-muted'),
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
        {multiple ? (
          <span
            aria-hidden
            className={cn(
              'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors',
              choisie ? 'border-accent bg-accent text-accent-fg' : 'border-faint',
            )}
          >
            {choisie ? <Check className="h-3 w-3" /> : null}
          </span>
        ) : (
          <Check className={cn('h-3.5 w-3.5 shrink-0 text-teinte', !choisie && 'invisible')} aria-hidden />
        )}
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
          // Sur téléphone, le clavier ne monte que si l'on touche la recherche :
          // ouvert d'office, il mangerait la moitié du panneau.
          autoFocus={!telephone}
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
      aria-multiselectable={multiple || undefined}
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
    : { 'data-liste-deroulante': repere ?? '', 'data-liste-valeur': multiple ? valeurs!.join(',') : valeur };

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
          ? /* La tenue d'un champ de saisie (`Input`) : un fond, aucun trait au
               repos ; ouverte, le même filet discret qu'un champ qui a le focus. */
            'h-8 w-full rounded-md border border-transparent bg-raised px-2 text-[13px] text-text hover:bg-border'
          : 'h-7 max-w-full rounded-md px-1.5 text-[13px] text-text hover:bg-raised',
        ouvert && variante === 'champ' && 'border-faint/60',
        className,
      )}
      {...marquesDeclencheur}
      {...attributs}
    >
      {icone ?? retenue?.icone ? <span className="flex shrink-0 items-center text-faint">{icone ?? retenue?.icone}</span> : null}
      {/* LE NOM S'AFFICHE EN ENTIER tant que la place le permet. */}
      <span className={cn('min-w-0 flex-1 truncate', rienDeRetenu && 'text-faint')} style={retenue?.style}>
        {libelle}
      </span>
      <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-faint transition-transform', ouvert && 'rotate-180')} aria-hidden />
    </button>
  );

  const leDeclencheur = declencheur ? declencheur(ouvrir, libelle) : declencheurParDefaut;

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
            if (!avecRecherche || telephone) {
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
          style={{ minWidth: Math.max(220, ancre.current?.getBoundingClientRect().width ?? 0), ...styleDeLaPoignee }}
          className={cn(
            'z-[80] flex max-h-[min(380px,var(--radix-popover-content-available-height))] max-w-[min(440px,calc(100vw-16px))] flex-col overflow-hidden rounded-md border border-border bg-surface p-1 shadow-xl',
            'data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out',
            /* SUR TÉLÉPHONE : le panneau du bas, sur toute la largeur (son
               enveloppe y est épinglée par `styles.css`), comme un menu. */
            'max-sm:w-full max-sm:max-w-none max-sm:max-h-[calc(var(--hauteur-app,100dvh)*0.8)] max-sm:rounded-none max-sm:rounded-t-xl',
            'max-sm:border-x-0 max-sm:border-b-0 max-sm:p-2 max-sm:pb-[calc(10px+env(safe-area-inset-bottom))]',
            'max-sm:data-[state=open]:animate-slide-sheet max-sm:data-[state=closed]:animate-slide-sheet-out',
          )}
        >
          {telephone ? (
            <>
              <VoileMenu panneau={panneau} />
              <div
                {...poignee}
                data-liste-poignee
                className="mb-1 flex shrink-0 cursor-grab touch-none justify-center py-1.5 active:cursor-grabbing"
              >
                <span className="h-1 w-10 rounded-full bg-muted" />
              </div>
            </>
          ) : null}
          {actionTitre || telephone ? (
            <header className="flex shrink-0 items-center gap-2 px-2 pb-1 pt-0.5">
              <span
                className={cn('min-w-0 flex-1 truncate font-medium', telephone ? 'text-[14.5px] text-text' : 'text-[12px] text-muted')}
                data-liste-titre
              >
                {titre}
              </span>
              {actionTitre ? actionTitre(fermer) : null}
            </header>
          ) : null}
          {recherche}
          <ZoneDefilement fond="hsl(var(--surface))" hauteur={24} className="min-h-0 overscroll-contain">
            {listbox}
          </ZoneDefilement>
          {pied ? <div className="shrink-0 px-1 pb-0.5 pt-1 max-sm:pt-2.5">{pied(fermer)}</div> : null}
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
 * UN MENU S'OUVRE AU CLIC, PAS À L'APPUI.
 *
 * La bibliothèque ouvre un menu dès l'APPUI sur son bouton. Sur un petit bouton
 * cela ne se voit pas ; sur un déclencheur large posé dans une zone qui défile
 * (le bloc des réglages d'une carte, une ligne de configuration), poser le
 * doigt pour faire défiler ouvrait le menu. On retient donc l'appui et on ouvre
 * au clic : un défilement n'est pas un clic, et un contrôle qui clique sans
 * pointeur ouvre le menu comme une main. Le clavier, lui, garde les gestes de
 * la bibliothèque (Entrée, Espace, flèche bas).
 *
 * À étaler sur `DropdownMenuTrigger` d'un menu dont l'ouverture est TENUE par
 * celui qui l'écrit (`open` / `onOpenChange`).
 */
export function ouvertureAuClic(ouvrir: () => void) {
  return {
    onPointerDown: (event: React.PointerEvent) => event.preventDefault(),
    onClick: ouvrir,
  };
}

/**
 * RENDRE LA MAIN À L'ENTRÉE QUI A DÉPLIÉ UN SOUS-MENU, juste avant de le
 * replier sur un choix. Le menu, lui, reste ouvert : sans ce geste le focus
 * tomberait sur la page avec le sous-menu, et le clavier perdrait le menu. Le
 * sous-menu nomme son entrée (`aria-labelledby`) : c'est par là qu'on la
 * retrouve, depuis n'importe quel élément posé dedans.
 */
export function rendreLeFocusALEntreeDuSousMenu(dansLeSousMenu: Element | null) {
  const entree = dansLeSousMenu?.closest('[role="menu"]')?.getAttribute('aria-labelledby');
  if (entree) document.getElementById(entree)?.focus({ preventScroll: true });
}

/**
 * LE BOUTON « ⋮ » ET SON MENU D'ACTIONS. Il porte un repère chiffré quand
 * quelque chose d'invisible est actif — un filtre, par exemple : on ne cherche
 * plus pourquoi une liste semble vide.
 *
 * UN BOUTON D'OPTIONS OUVRE UN PETIT MENU SOUS LUI, JAMAIS UNE PAGE (demande du
 * 11/10/2026). Le menu s'ancre au bouton (il devient de lui-même un panneau du
 * bas sur téléphone, `DropdownMenuContent`), sa hauteur est bornée à l'écran et
 * son contenu défile chez lui.
 *
 * LES TROIS POINTS SONT VERTICAUX, ici comme partout ailleurs dans Beluga : un
 * menu d'actions se reconnaît au même dessin sur tous les écrans. Un menu qui
 * n'est PAS un menu d'actions — un filtre, un tri — passe son propre `icone` :
 * c'est la seule raison d'en changer.
 *
 * LE MENU NE SE REFERME PAS TOUT SEUL SUR UNE ACTION : c'est l'appelant qui le
 * décide (`fermer`, reçu par `children`). Une bascule de filtre le laisse
 * ouvert, « Archiver » le referme.
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
  taille: tailleVoulue,
}: {
  titre: string;
  repere: string;
  /** Le nombre de réglages actifs — pastille discrète, en bas à droite. */
  actifs?: number;
  /**
   * CE QUI RÉCLAME UNE RÉPONSE. La pastille commune, en ORANGE (ton
   * « répondre »), en haut à droite : elle ne se confond pas avec le compte des
   * réglages actifs, et ne se cache jamais dans le menu.
   */
  alerte?: number;
  /** L'icône du bouton — les trois points verticaux à défaut. */
  icone?: React.ReactNode;
  /** Le contenu du menu : des `ActionTiroir`, des blocs, ce qu'on veut. */
  children: React.ReactNode | ((fermer: () => void) => React.ReactNode);
  className?: string;
  /** Sans effet depuis que c'est un menu : il s'ancre à son bouton, il ne s'empile sur rien. */
  empile?: boolean;
  taille?: ButtonProps['size'];
}) {
  void empile;
  const dansUneBarre = React.useContext(DansUneBarreDEnTete);
  const taille = tailleVoulue ?? (dansUneBarre ? 'icon-barre' : 'icon-sm');
  const [ouvert, setOuvert] = React.useState(false);
  const fermer = React.useCallback(() => setOuvert(false), []);

  /*
   * LE CLAVIER ATTEINT AUSSI CE QUI N'EST PAS UNE ENTRÉE. Un menu retient la
   * touche de tabulation et ne fait circuler les flèches qu'entre ses entrées :
   * le bloc « Historique » de la fiche d'une demande, qui se déplie DANS le
   * menu, restait hors d'atteinte. La tabulation passe donc d'un bouton au
   * suivant, entrées comprises, et les flèches sortent d'un bouton qui n'est
   * pas une entrée.
   */
  const clavier = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const menu = event.currentTarget;
    const cible = event.target as HTMLElement;
    // Une touche frappée dans un sous-menu remonte jusqu'ici : elle n'est pas la nôtre.
    if (cible.closest('[data-radix-menu-content]') !== menu) return;
    const horsEntree = cible !== menu && !cible.matches('[role^="menuitem"]');
    const pas =
      event.key === 'Tab'
        ? event.shiftKey
          ? -1
          : 1
        : horsEntree && event.key === 'ArrowDown'
          ? 1
          : horsEntree && event.key === 'ArrowUp'
            ? -1
            : 0;
    if (!pas) return;
    const boutons = [...menu.querySelectorAll<HTMLElement>('button:not([disabled]), [role^="menuitem"]:not([data-disabled])')];
    if (!boutons.length) return;
    event.preventDefault();
    const ici = boutons.indexOf(cible);
    const suivant = ici < 0 ? (pas > 0 ? 0 : boutons.length - 1) : (ici + pas + boutons.length) % boutons.length;
    boutons[suivant]?.focus();
  };

  return (
    <DropdownMenu open={ouvert} onOpenChange={setOuvert}>
      <span className="relative inline-flex shrink-0">
        <DropdownMenuTrigger asChild {...ouvertureAuClic(() => setOuvert(true))}>
          <Button
            variant="ghost"
            size={taille}
            title={titre}
            aria-label={titre}
            className={className}
            data-menu-actions={repere}
            data-actifs={actifs || undefined}
            data-alerte={alerte || undefined}
          >
            {icone ?? <EllipsisVertical className="h-4 w-4" />}
          </Button>
        </DropdownMenuTrigger>
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
      <DropdownMenuContent
        align="end"
        collisionPadding={8}
        onKeyDown={clavier}
        data-menu-actions-contenu={repere}
        /* Borné à la place réellement libre sous (ou sur) le bouton : un bloc
           qui se déplie dedans fait défiler le menu, il ne le sort pas de
           l'écran. Sur téléphone, le panneau du bas garde son propre plafond. */
        className="min-w-[220px] sm:max-h-[min(560px,var(--radix-dropdown-menu-content-available-height))] sm:max-w-[min(340px,calc(100vw-16px))]"
      >
        <div className="flex flex-col gap-0.5">{typeof children === 'function' ? children(fermer) : children}</div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Une entrée d'un `MenuActions` — icône, libellé, état à droite. Elle ne vit
 * QUE dans un menu (`MenuActions`, `SousMenuTiroir`) : c'est une entrée de
 * menu, que le clavier parcourt aux flèches.
 */
export function ActionTiroir({
  icone,
  children,
  onClick,
  actif,
  valeur,
  ton,
  className,
  disabled,
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
    <DropdownPrimitive.Item
      asChild
      disabled={disabled}
      /* Le menu ne se referme pas de lui-même : l'appelant le décide (`fermer`). */
      onSelect={(event) => event.preventDefault()}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          'flex min-w-0 cursor-pointer select-none items-center gap-2 rounded-md px-2 py-2 text-left text-[14px] outline-none transition-colors',
          /* Le choix RETENU s'écrit en violet, sur son fond : aucun trait. */
          actif
            ? 'bg-raised text-teinte'
            : 'text-muted hover:bg-raised hover:text-text data-[highlighted]:bg-raised data-[highlighted]:text-text',
          ton === 'danger' && 'text-danger hover:text-danger data-[highlighted]:text-danger',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        data-action-active={actif ? '' : undefined}
        /* Une entrée qui porte un état le dit à une machine ; sans état, elle
           garde le rôle d'entrée que le menu lui donne. */
        {...(actif === undefined ? {} : { role: 'menuitemcheckbox', 'aria-checked': actif })}
        {...props}
      >
        {icone ? <span className="shrink-0 text-faint">{icone}</span> : null}
        <span className="min-w-0 flex-1 truncate">{children}</span>
        {valeur ? <span className="shrink-0 text-[12px] text-faint">{valeur}</span> : null}
        {actif && !valeur ? <Check className="h-3.5 w-3.5 shrink-0 text-teinte" /> : null}
      </button>
    </DropdownPrimitive.Item>
  );
}

/**
 * UNE ENTRÉE QUI DÉPLIE SA LISTE DE CHOIX EN SOUS-MENU — le filtre
 * « Étiquette » d'une colonne. Elle montre ce qu'elle vaut à droite, comme une
 * `ActionTiroir`, et pose ses choix (des `ActionTiroir`) dans un sous-menu
 * borné qui défile. `children` reçoit `replier` : un choix replie le sous-menu
 * et laisse le menu ouvert, avec sa valeur à jour.
 */
export function SousMenuTiroir({
  icone,
  titre,
  valeur,
  children,
  ...props
}: {
  icone?: React.ReactNode;
  titre: string;
  valeur?: string;
  children: React.ReactNode | ((replier: () => void) => React.ReactNode);
} & Record<`data-${string}`, string | number | boolean | undefined>) {
  const [ouvert, setOuvert] = React.useState(false);
  const liste = React.useRef<HTMLDivElement | null>(null);
  const replier = () => {
    rendreLeFocusALEntreeDuSousMenu(liste.current);
    setOuvert(false);
  };
  return (
    <DropdownMenuSub open={ouvert} onOpenChange={setOuvert}>
      <DropdownMenuSubTrigger className="min-w-0 rounded-md py-2" {...props}>
        {icone ? <span className="shrink-0 text-faint">{icone}</span> : null}
        <span className="min-w-0 flex-1 truncate">{titre}</span>
        {valeur ? <span className="max-w-[55%] shrink-0 truncate text-[12px] text-faint">{valeur}</span> : null}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <div ref={liste} className="flex flex-col gap-0.5">
          {typeof children === 'function' ? children(replier) : children}
        </div>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/** Un intertitre dans un menu d'actions : « Filtrer », « Trier », « Ouvrir ». */
export function GroupeTiroir({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={titre} className="flex flex-col gap-0.5" data-groupe-tiroir={titre}>
      <span aria-hidden className="px-2 pt-2 text-[11px] uppercase tracking-wide text-faint">
        {titre}
      </span>
      {children}
    </div>
  );
}
