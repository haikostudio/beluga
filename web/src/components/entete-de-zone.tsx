import * as React from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ChevronDown, ChevronRight, EllipsisVertical, Loader2, Menu } from 'lucide-react';
import {
  Button,
  CLASSE_POINT_DE_BOUTON,
  CLASSE_RANGEE_DE_BOUTONS,
  CibleDesGestesDePage,
  DansUneBarreDEnTete,
  CibleDuBasDePage,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tooltip,
  type ButtonProps,
} from '@/components/ui';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';
import { useTabletteOuTelephone, useTelephone } from '@/lib/telephone';

/**
 * L'ENDROIT DE LA BARRE D'EN-TÊTE OÙ UNE PAGE POSE SES GESTES. L'application le
 * fournit (`FournirLaCibleDesGestes`) ; une page y écrit avec `GestesDePage`,
 * sans rien savoir de la barre.
 */
const CibleDesGestes = CibleDesGestesDePage;
export const FournirLaCibleDesGestes = CibleDesGestes.Provider;

/**
 * LA MARGE QUE LA BARRE LAISSE À LA BARRE D'ÉTAT DU TÉLÉPHONE (heure, réseau,
 * batterie). Elle vaut la zone sûre du haut (`--zone-sure-haut`, que les
 * contrôles savent poser : `scripts/lib/zone-sure.mjs`), SAUF là où un parent
 * la porte déjà et remet `--zone-sure-entete` à zéro (`FeuilleDeTiroir`).
 */
const MARGE_HAUTE_DE_LA_BARRE = 'var(--zone-sure-entete, var(--zone-sure-haut, 0px))';

/**
 * LE MENU PRINCIPAL DU TÉLÉPHONE (la colonne des projets, qui vit dans un
 * panneau). L'application le fournit : la barre à DEUX RANGS d'une tâche, qui
 * n'est pas celle de l'application, le pose elle aussi tout en haut, au lieu de
 * la flèche de retour qui l'y remplaçait (demande du 15/10/2026).
 */
export interface MenuPrincipalDuTelephone {
  ouvrir: () => void;
  /** Ce qui attend ailleurs (liaison rompue, un projet qui attend). */
  point?: { classe: string; texte: string } | null;
}
const MenuPrincipal = React.createContext<MenuPrincipalDuTelephone | null>(null);
export const FournirLeMenuPrincipal = MenuPrincipal.Provider;

/** Le bouton du menu principal : il ouvre la colonne des projets, sur téléphone. */
function BoutonDuMenuPrincipal({ ouvrir, point }: MenuPrincipalDuTelephone) {
  return (
    <Button
      variant="ghost"
      size="icon-barre"
      className="relative shrink-0 text-muted sm:hidden"
      aria-label="Projets"
      title={point ? `${t('Projets')} · ${point.texte}` : t('Projets')}
      data-menu-principal
      onClick={ouvrir}
    >
      <Menu className="h-4 w-4" />
      {point ? <span data-point-etat className={cn(CLASSE_POINT_DE_BOUTON, point.classe)} /> : null}
    </Button>
  );
}

/** Un cran qui se clique : son fond paraît au survol, comme tout bouton de la barre. */
const CLASSE_CRAN_CLIQUABLE =
  '-mx-1 min-w-0 shrink rounded-md px-1 py-1 text-muted transition-colors hover:bg-raised hover:text-text';

/**
 * OÙ SE TROUVE LA ZONE PRINCIPALE — « Services › Statistiques », « Tableaux de
 * bord › Local › Beluga ». L'application le dit une fois ; une PAGE ouverte
 * par-dessus (une fiche, un déroulé) le reprend pour écrire son propre fil
 * d'Ariane, son titre en dernier cran (`EnteteDePage`). Plus aucune page ne
 * s'ouvre sur une simple flèche « Retour » : on sait toujours où l'on est, et
 * dans quel enfant.
 */
export interface LieuDeLaZone {
  /** Les crans d'avant (« Services », ou « Tableaux de bord » puis le groupe). */
  chemin: CranDuChemin[];
  /** Le lieu lui-même : le nom du service ou du projet. */
  titre: string;
  /** Ce qui ouvre le fil, tout à gauche : le bouton des services. */
  avant?: React.ReactNode;
}
const Lieu = React.createContext<LieuDeLaZone | null>(null);
export const FournirLeLieu = Lieu.Provider;
export const useLieuDeLaZone = () => React.useContext(Lieu);

/**
 * LA SUITE DU FIL D'ARIANE, écrite par la page affichée : l'ENFANT dans lequel
 * on se trouve à l'intérieur d'un service (le site des statistiques, le client
 * de la messagerie, la création du Studio). Elle monte dans la barre d'en-tête
 * de l'application, juste après le nom du service — qui redevient alors un cran
 * cliquable (`onRacine` : revenir à l'accueil du service). Le service n'a donc
 * PAS de seconde barre à lui.
 */
interface SuiteDuFilDeZone {
  cible: HTMLElement | null;
  retour: React.MutableRefObject<(() => void) | null>;
  signaler: (presente: boolean) => void;
  /** Le geste de la flèche de retour du téléphone, et ses repères (`null` : pas de flèche). */
  retourDUnCran?: React.MutableRefObject<(() => void) | null>;
  signalerLeRetour?: (reperes: ReperesDeRetour | null) => void;
}
const Suite = React.createContext<SuiteDuFilDeZone | null>(null);
export const FournirLaSuiteDuFil = Suite.Provider;

/** Les repères `data-*` que porte la flèche de retour, pour les contrôles. */
export type ReperesDeRetour = Record<`data-${string}`, string>;
const AUCUN_REPERE: ReperesDeRetour = {};

export function SuiteDuFil({
  onRacine,
  retour: retourDeTelephone,
  children,
}: {
  onRacine: () => void;
  /**
   * SUR TÉLÉPHONE, LES CRANS D'AVANT NE SONT PAS AFFICHÉS : on ne peut donc pas
   * y cliquer pour remonter. La page le dit ici, et la barre d'en-tête pose une
   * flèche de retour à la place du bouton des projets — elle remonte d'UN cran
   * (`action`), qui n'est pas toujours la racine (la Mémoire : du sujet au
   * classeur, puis du classeur à la liste). Une page n'a donc JAMAIS de barre
   * de retour à elle sous la barre d'en-tête.
   */
  retour?: { action: () => void; reperes?: ReperesDeRetour };
  children: React.ReactNode;
}) {
  const suite = React.useContext(Suite);
  const retour = suite?.retour;
  const signaler = suite?.signaler;
  const retourDUnCran = suite?.retourDUnCran;
  const signalerLeRetour = suite?.signalerLeRetour;
  React.useEffect(() => {
    if (retour) retour.current = onRacine;
    if (retourDUnCran) retourDUnCran.current = retourDeTelephone?.action ?? null;
  });
  React.useEffect(() => {
    signaler?.(true);
    return () => {
      signaler?.(false);
      if (retour) retour.current = null;
    };
  }, [signaler, retour]);
  /* Les repères sont comparés par leur texte : un objet neuf à chaque rendu ne
     doit pas faire redessiner la barre en boucle. */
  const aUnRetour = !!retourDeTelephone;
  const reperes = JSON.stringify(retourDeTelephone?.reperes ?? AUCUN_REPERE);
  React.useEffect(() => {
    if (!signalerLeRetour || !aUnRetour) return;
    signalerLeRetour(JSON.parse(reperes) as ReperesDeRetour);
    return () => {
      signalerLeRetour(null);
      if (retourDUnCran) retourDUnCran.current = null;
    };
  }, [signalerLeRetour, retourDUnCran, aUnRetour, reperes]);
  /* Hors de l'application (une page ouverte par-dessus), la suite reste en tête
     du contenu : elle ne se perd jamais. */
  if (!suite?.cible) {
    return (
      <div data-suite-du-fil="page" className="flex min-w-0 shrink-0 items-center gap-1.5 pb-3 text-[14.5px]">
        {children}
      </div>
    );
  }
  return createPortal(children, suite.cible);
}

/** Le chevron qui sépare deux crans du fil d'Ariane. */
export function SeparateurDuFil() {
  return <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 text-faint sm:block" aria-hidden data-separateur-du-fil />;
}

/**
 * UN CRAN DE LA SUITE DU FIL. Le dernier s'écrit en texte plein ; un cran
 * d'avant se clique pour y remonter. Un cran qui ouvre une liste (changer de
 * site, de client) pose son propre bouton à la place — voir `SelecteurDeProjet`.
 */
export function CranDuFil({
  children,
  onClick,
  dernier = true,
  sousTitre,
  ...attributs
}: {
  children: React.ReactNode;
  onClick?: () => void;
  dernier?: boolean;
  /** Une précision discrète après le nom (le projet d'une création). */
  sousTitre?: React.ReactNode;
} & Record<`data-${string}`, string | number | boolean | undefined>) {
  /* SUR TÉLÉPHONE, SEUL LE DERNIER CRAN SE LIT : les séparateurs y sont cachés,
     et deux noms collés sans rien entre eux ne disaient plus un chemin. La
     flèche de retour de la barre remonte d'un cran (`SuiteDuFil retour`). */
  const classe = cn('min-w-0 truncate', dernier ? 'font-medium text-text' : 'text-muted transition-colors hover:text-text max-sm:hidden');
  return (
    <>
      <SeparateurDuFil />
      {onClick ? (
        <button type="button" onClick={onClick} className={cn(classe, 'rounded-md text-left')} data-cran-du-fil {...attributs}>
          {children}
        </button>
      ) : (
        <span className={classe} data-cran-du-fil {...attributs}>
          {children}
        </span>
      )}
      {sousTitre ? <span className="hidden min-w-0 shrink-0 truncate text-[12.5px] text-faint md:block">{sousTitre}</span> : null}
    </>
  );
}

/**
 * LES GESTES D'UNE PAGE — où ils se posent, sur ordinateur et sur téléphone.
 *
 * Une page ne garde ni titre ni rangée de boutons : le fil d'Ariane dit déjà où
 * l'on est, et tout ce qu'elle propose monte dans la barre d'en-tête ou descend
 * en bas de l'écran. TROIS COMPOSANTS, selon ce qu'on pose — la page écrit une
 * seule fois, pour les deux tailles d'écran :
 *
 *  - `GestePrincipal` : LE bouton de la page (« Nouveau site », « Nouvel
 *    accès »). Sur ordinateur, le dernier bouton de la barre ; sur téléphone,
 *    en bas de l'écran, centré, sur toute la largeur (`BoutonPrincipal`).
 *  - `OptionsDePage` : les gestes secondaires (« Archives », « Vérifier
 *    maintenant »). Sur ordinateur, des boutons de la barre ; sur téléphone,
 *    les lignes NOMMÉES d'UN menu à trois points, à côté de la cloche
 *    (`OptionDePage`).
 *  - `GestesDePage` : ce qui se pose tel quel dans la barre, sur les deux —
 *    une pastille d'état, un interrupteur, un menu déjà à trois points. Deux
 *    petits éléments au plus sur téléphone.
 *
 * Demande du 11/10/2026 : « merge les doubles barres en mettant les éléments en
 * haut […] les boutons principaux doivent être en bas, centre, fullwidth ».
 * Avant elle, `GestesDePage` restait sur téléphone en tête de la page, aligné
 * à droite : une seconde rangée sous la barre, souvent pour un seul bouton.
 *
 * LA BARRE VISÉE EST CELLE DE LA PAGE OÙ L'ON EST : celle de l'application
 * pour un service, celle de la page elle-même pour une fiche ouverte
 * par-dessus (`FeuilleDeTiroir` fournit la sienne). HORS DE TOUTE BARRE — le
 * portail des clients, qui n'a pas de fil d'Ariane — les trois restent en tête
 * du contenu, alignés à droite, comme avant.
 */
const CLASSE_RANGEE_DE_PAGE = 'flex shrink-0 flex-wrap items-center justify-end gap-1 pb-3 sm:gap-1.5';

export function GestesDePage({ children, className }: { children: React.ReactNode; className?: string }) {
  const cible = React.useContext(CibleDesGestes);
  if (cible) return createPortal(<DansUneBarreDEnTete.Provider value>{children}</DansUneBarreDEnTete.Provider>, cible);
  return (
    <div data-gestes-de-page="page" className={cn(CLASSE_RANGEE_DE_PAGE, className)}>
      {children}
    </div>
  );
}

/**
 * LA TENUE D'UNE OPTION : un bouton de la barre, ou une ligne du menu à trois
 * points. Un composant posé dans `OptionsDePage` qui a les deux dessins (un
 * interrupteur, un sous-menu) la lit ici.
 */
const TenueDesOptions = React.createContext<'bouton' | 'ligne'>('bouton');
export const useTenueDesOptions = () => React.useContext(TenueDesOptions);

export function OptionsDePage({
  children,
  enCours = false,
  className,
}: {
  children: React.ReactNode;
  /**
   * UN GESTE DU MENU EST EN TRAIN DE SE FAIRE (« Vérifier maintenant ») : le
   * contenu d'un menu est démonté tant qu'il est fermé, et la roue du bouton
   * ne se verrait plus. Sur téléphone, c'est le bouton à trois points qui
   * tourne à sa place.
   */
  enCours?: boolean;
  className?: string;
}) {
  const cible = React.useContext(CibleDesGestes);
  const telephone = useTelephone();
  /* Rien à ranger : pas de trois points. */
  if (!React.Children.toArray(children).length) return null;
  if (!cible) {
    return (
      <div data-gestes-de-page="page" className={cn(CLASSE_RANGEE_DE_PAGE, className)}>
        {children}
      </div>
    );
  }
  if (!telephone) {
    /* L'enveloppe fixe la place des options dans la barre, quel que soit
       l'ordre où les portails se montent : après les gestes posés tels quels,
       avant le geste principal. */
    return createPortal(
      <div className={cn('order-[9000] min-w-0', CLASSE_RANGEE_DE_BOUTONS)} data-options-de-page="barre" data-rangee-de-boutons>
        <DansUneBarreDEnTete.Provider value>{children}</DansUneBarreDEnTete.Provider>
      </div>,
      cible,
    );
  }
  return createPortal(
    <DropdownMenu>
      {/* Pas de `Tooltip` autour du déclencheur d'un menu : `title`. */}
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-barre"
          className="order-[9000] shrink-0 text-muted"
          aria-label="Plus d’options"
          title={t('Plus d’options')}
          data-options-de-page="menu"
          data-options-en-cours={enCours ? '' : undefined}
        >
          {enCours ? <Loader2 className="h-4 w-4 animate-spin" /> : <EllipsisVertical className="h-4 w-4" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" data-options-de-page-menu>
        <TenueDesOptions.Provider value="ligne">{children}</TenueDesOptions.Provider>
      </DropdownMenuContent>
    </DropdownMenu>,
    cible,
  );
}

/**
 * UNE OPTION DE LA PAGE : un bouton de la barre sur ordinateur, une ligne du
 * menu à trois points sur téléphone — où elle porte toujours son nom en toutes
 * lettres, même si le bouton d'ordinateur n'est qu'une icône (`compact`).
 */
export function OptionDePage({
  icone,
  children,
  onClick,
  disabled,
  variante = 'subtle',
  compact = false,
  taille = 'icon',
  title,
  className,
  ...attributs
}: {
  icone?: React.ReactNode;
  /** Le nom du geste (et, à sa suite, un compteur discret). */
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variante?: 'subtle' | 'ghost';
  /** Sur ordinateur, une icône seule : son nom se lit dans sa bulle (`title`). */
  compact?: boolean;
  /** La taille de cette icône seule. */
  taille?: 'icon' | 'icon-sm';
  title?: string;
  className?: string;
  'aria-label'?: string;
  'aria-haspopup'?: React.AriaAttributes['aria-haspopup'];
} & Record<`data-${string}`, string | number | boolean | undefined>) {
  const tenue = React.useContext(TenueDesOptions);
  if (tenue === 'ligne') {
    return (
      <DropdownMenuItem disabled={disabled} onSelect={() => onClick?.()} className={className} {...attributs}>
        {icone ? (
          <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted [&>svg]:h-4 [&>svg]:w-4">{icone}</span>
        ) : null}
        <span className="flex min-w-0 items-center gap-1.5 truncate">{children}</span>
      </DropdownMenuItem>
    );
  }
  if (compact) {
    return (
      <Button variant="ghost" size={taille} className={cn('shrink-0', className)} disabled={disabled} onClick={onClick} title={title} {...attributs}>
        {icone}
      </Button>
    );
  }
  return (
    <Button variant={variante} size="sm" className={className} disabled={disabled} onClick={onClick} title={title} {...attributs}>
      {icone}
      {children}
    </Button>
  );
}

/** Le geste principal est-il posé en bas de l'écran (téléphone) ? `BoutonPrincipal` le lit. */
const PrincipalEnBas = React.createContext(false);

/**
 * LE GESTE PRINCIPAL D'UNE PAGE. Sur téléphone il descend en bas de l'écran,
 * centré, sur toute la largeur — au même endroit et avec la même allure que
 * « Nouvelle tâche » dans un projet (`menuBasTelephone`, `geste-de-page`). UN
 * SEUL par page : le bas de l'écran ne porte jamais deux choses. La page le
 * démonte quand elle ouvre un enfant sur place (un site, une note).
 */
export function GestePrincipal({ children }: { children: React.ReactNode }) {
  const cible = React.useContext(CibleDesGestes);
  const bas = React.useContext(CibleDuBasDePage);
  const telephone = useTelephone();
  if (telephone && bas) {
    /* La bande n'est pas encore montée : rien ce tour-ci, plutôt qu'un bouton
       qui passerait une image dans la barre. */
    if (!bas.cible) return null;
    return createPortal(<PrincipalEnBas.Provider value>{children}</PrincipalEnBas.Provider>, bas.cible);
  }
  if (cible) {
    return createPortal(
      <div className={cn('order-last shrink-0', CLASSE_RANGEE_DE_BOUTONS)} data-geste-principal="barre">
        {children}
      </div>,
      cible,
    );
  }
  return (
    <div data-gestes-de-page="page" className={CLASSE_RANGEE_DE_PAGE}>
      {children}
    </div>
  );
}

/**
 * LE BOUTON DU GESTE PRINCIPAL : son dessin d'ordinateur (`variant`, petit)
 * dans la barre, et en bas de l'écran du téléphone le bouton plein de
 * « Nouvelle tâche » — 44 px de haut, toute la largeur. Il passe sa référence :
 * il peut être le déclencheur d'un menu (« Nouvel accès » ouvre les types).
 *
 * Les gestes principaux CRÉENT quelque chose (« Nouveau site », « Nouvelle
 * note »…) : par défaut ils sont NOIRS avec une écriture blanche — l'aplat
 * d'encre, variante `creation` — pour se distinguer d'un coup d'œil des
 * boutons gris de la barre (demande du 12/10/2026).
 */
export const BoutonPrincipal = React.forwardRef<HTMLButtonElement, Omit<ButtonProps, 'size'>>(function BoutonPrincipal(
  { variant = 'creation', className, ...props },
  ref,
) {
  const enBas = React.useContext(PrincipalEnBas);
  if (enBas) {
    return (
      <Button
        ref={ref}
        variant="creation"
        size="lg"
        data-bouton-principal-du-bas
        className={cn('h-11 w-full justify-center gap-2 rounded-lg text-[14.5px] [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0', className)}
        {...props}
      />
    );
  }
  return <Button ref={ref} variant={variant} size="sm" className={className} {...props} />;
});

/**
 * L'EMPLACEMENT DES GESTES DANS UNE BARRE D'EN-TÊTE. Sur téléphone il ne prend
 * aucune place tant que rien n'y est posé : vide, il ajoutait un écart devant
 * la cloche.
 */
export const CLASSE_CIBLE_DES_GESTES = cn('min-w-0 max-sm:empty:hidden', CLASSE_RANGEE_DE_BOUTONS);

/** Un cran du fil d'Ariane : un lieu, et de quoi y retourner. */
export interface CranDuChemin {
  libelle: string;
  /** Sans geste, le cran se lit mais ne se clique pas. */
  onClick?: () => void;
  /**
   * LE CRAN OUVRE UNE LISTE DÉROULANTE (changer de projet) : il reçoit son
   * bouton et rend le menu qui l'enveloppe. Il l'emporte sur `onClick`.
   */
  menu?: (declencheur: React.ReactElement) => React.ReactNode;
  /**
   * L'ICÔNE DU LIEU, posée devant son nom. Elle reste affichée sur téléphone,
   * où le nom du cran est masqué : c'est le seul repère du projet qui y reste.
   * Elle se clique comme le cran (`onClick`), sans second geste à écrire.
   */
  icone?: React.ReactNode;
}

/**
 * LA BARRE D'EN-TÊTE D'UNE PAGE — la même partout, sur ordinateur comme sur
 * téléphone.
 *
 * Une seule rangée en haut de la zone principale :
 *  - À GAUCHE, LE FIL D'ARIANE : où l'on se trouve. Les crans d'avant se
 *    cliquent pour remonter ; le dernier — le titre de la page — est en texte
 *    plein. Un cran peut ouvrir une LISTE DÉROULANTE (`menu`, `menuDuTitre`) :
 *    c'est par elle qu'on change de projet sans quitter la page. Sur une page
 *    qu'on a OUVERTE (une carte), une flèche de retour le précède ; sur
 *    téléphone, c'est le bouton qui ouvre la colonne des projets.
 *  - À DROITE, LES GESTES DE LA PAGE, puis ses options derrière un bouton à
 *    trois points (`menu`).
 *
 * Elle ne porte RIEN d'autre : ni compteur, ni état, ni étiquette. Ce qu'une
 * page a de plus à dire se range dans son menu.
 */
export function EnteteDeZone({
  chemin = [],
  titre,
  onTitre,
  menuDuTitre,
  titreEnCran = false,
  emplacementDuTitre,
  suite,
  avant,
  onRetour,
  retourDePage = false,
  reperesDeRetour,
  retourDansLaColonne = false,
  onOuvrirColonne,
  pointDeColonne,
  avantTitre,
  children,
  menu,
  deuxRangsSurPetitEcran = false,
  className,
  ...attributs
}: {
  /**
   * SUR TÉLÉPHONE ET SUR TABLETTE (moins de 1024 px), DEUX RANGS (la page d'une
   * tâche, demandes du 14/10/2026 puis du 15/10/2026) : en haut, l'EN-TÊTE
   * MAÎTRE — le menu principal (la colonne des projets) à gauche, les gestes et
   * le menu à droite ; dessous, le fil d'Ariane lui-même, qui s'ouvre sur le
   * BOUTON DES SERVICES (plus de flèche de retour : on remonte par le menu
   * principal ou par l'icône du projet). Sur ordinateur, un seul rang.
   */
  deuxRangsSurPetitEcran?: boolean;
  /** Les lieux qui mènent à la page, du plus large au plus proche. */
  chemin?: CranDuChemin[];
  titre: React.ReactNode;
  /** Le titre devient un bouton (changer de projet). */
  onTitre?: () => void;
  /** Le titre ouvre une liste déroulante : il reçoit son bouton et rend le menu. */
  menuDuTitre?: (declencheur: React.ReactElement) => React.ReactNode;
  /**
   * LE TITRE N'EST PLUS LE DERNIER CRAN : la page a écrit une suite (l'enfant
   * où l'on se trouve). Il se lit alors en gris, et `onTitre` y ramène.
   */
  titreEnCran?: boolean;
  /**
   * LE TITRE EST ÉCRIT PAR LA PAGE : la barre ne pose qu'un emplacement vide,
   * où le premier `DialogTitle` de la page vient se loger.
   */
  emplacementDuTitre?: (element: HTMLElement | null) => void;
  /** L'emplacement de la suite du fil, juste après le titre (`SuiteDuFil`). */
  suite?: React.ReactNode;
  /** Ce qui ouvre le fil, tout à gauche : le bouton des services. */
  avant?: React.ReactNode;
  /** La flèche de retour, tout à gauche : la page a été ouverte depuis une autre. */
  onRetour?: () => void;
  /** La flèche referme une PAGE : elle garde les repères de l'ancienne barre « Retour ». */
  retourDePage?: boolean;
  /**
   * LA FLÈCHE REMONTE D'UN CRAN DANS UN SERVICE (téléphone, `SuiteDuFil retour`) :
   * elle porte les repères de la page (`data-studio-retour`…) À LA PLACE de
   * `data-retour-carte`, que les contrôles lisent comme « refermer la carte ».
   */
  reperesDeRetour?: ReperesDeRetour;
  /**
   * LE RETOUR EST PORTÉ PAR LA COLONNE DE GAUCHE (la page d'une tâche, dont la
   * colonne montre les options sous une flèche de retour) : sur ordinateur la
   * flèche de la barre ferait doublon et s'efface. Sur téléphone, où la colonne
   * n'est pas affichée, elle reste.
   */
  retourDansLaColonne?: boolean;
  /** Sur téléphone : ouvre la colonne des projets, qui vit dans un panneau. */
  onOuvrirColonne?: () => void;
  /** Le point d'état posé sur ce bouton (liaison rompue, un projet qui attend). */
  pointDeColonne?: { classe: string; texte: string } | null;
  /** Un repère posé devant le titre (l'icône du projet). */
  avantTitre?: React.ReactNode;
  /** Les gestes de la page, à droite. */
  children?: React.ReactNode;
  /** Le bouton des options de la page (trois points), tout à droite. */
  menu?: React.ReactNode;
  className?: string;
} & Record<`data-${string}`, string | number | boolean | undefined>) {
  const petitEcran = useTabletteOuTelephone();
  const menuPrincipal = React.useContext(MenuPrincipal);
  const deuxRangs = deuxRangsSurPetitEcran && petitEcran;
  const retour = (
    <>
      {onRetour ? (
        <Tooltip label={t('Retour')}>
          <Button
            variant="ghost"
            size="icon-barre"
            className={cn('shrink-0 text-muted', !avant && 'sm:-ml-1.5', retourDansLaColonne && 'sm:hidden')}
            aria-label="Retour"
            {...(reperesDeRetour ? { 'data-retour-du-fil': '', ...reperesDeRetour } : { 'data-retour-carte': '' })}
            {...(retourDePage ? { 'data-retour-de-page': '', 'data-poignee-tiroir': '' } : {})}
            onClick={onRetour}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Tooltip>
      ) : onOuvrirColonne ? (
        <Button
          variant="ghost"
          size="icon-barre"
          className="relative shrink-0 text-muted sm:hidden"
          aria-label="Projets"
          title={pointDeColonne ? `${t('Projets')} · ${pointDeColonne.texte}` : t('Projets')}
          onClick={onOuvrirColonne}
        >
          <Menu className="h-4 w-4" />
          {pointDeColonne ? <span data-point-etat className={cn(CLASSE_POINT_DE_BOUTON, pointDeColonne.classe)} /> : null}
        </Button>
      ) : null}
    </>
  );
  const fil = (
      <nav aria-label="Fil d'Ariane" data-fil-d-ariane className={cn('min-w-0 flex-1 text-[14.5px]', CLASSE_RANGEE_DE_BOUTONS)}>
        {chemin.map((cran, rang) => (
          <React.Fragment key={`${rang}-${cran.libelle}`}>
            {cran.icone ? (
              cran.onClick ? (
                <button
                  type="button"
                  data-icone-du-cran
                  aria-label={cran.libelle}
                  title={cran.libelle}
                  onClick={cran.onClick}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-raised"
                >
                  {cran.icone}
                </button>
              ) : (
                <span data-icone-du-cran className="flex h-8 w-8 shrink-0 items-center justify-center">
                  {cran.icone}
                </span>
              )
            ) : null}
            {cran.menu ? (
              /* UN CRAN QUI OUVRE UNE LISTE LE DIT AU SURVOL : son fond paraît,
                 et le chevron qui le sépare du cran suivant bascule vers le
                 bas. Le séparateur vit donc DANS le bouton — rien ne bouge
                 d'un pixel entre le repos et le survol. */
              cran.menu(
                <button
                  type="button"
                  data-chemin-de-zone
                  data-chemin-a-menu
                  className={cn(
                    CLASSE_CRAN_CLIQUABLE,
                    'group/cran hidden items-center gap-1.5 data-[state=open]:bg-raised data-[state=open]:text-text sm:flex',
                  )}
                >
                  <span className="min-w-0 truncate">{cran.libelle}</span>
                  <ChevronRight
                    className="h-3.5 w-3.5 shrink-0 text-faint group-hover/cran:hidden group-data-[state=open]/cran:hidden"
                    aria-hidden
                  />
                  <ChevronDown
                    className="hidden h-3.5 w-3.5 shrink-0 group-hover/cran:block group-data-[state=open]/cran:block"
                    aria-hidden
                    data-chevron-de-cran
                  />
                </button>,
              )
            ) : cran.onClick ? (
              <button
                type="button"
                data-chemin-de-zone
                onClick={cran.onClick}
                className={cn(CLASSE_CRAN_CLIQUABLE, 'hidden truncate sm:block')}
              >
                {cran.libelle}
              </button>
            ) : (
              <span data-chemin-de-zone className="hidden min-w-0 shrink truncate text-muted sm:block">
                {cran.libelle}
              </span>
            )}
            {cran.menu ? null : <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 text-faint sm:block" aria-hidden />}
          </React.Fragment>
        ))}
        {avantTitre}
        {emplacementDuTitre ? (
          /* VIDE TANT QUE LA PAGE N'A PAS ÉCRIT SON TITRE : le chevron qui le
             précède s'efface alors avec lui (`styles.css`). */
          <span
            ref={emplacementDuTitre}
            className="block min-w-0 truncate font-medium text-text empty:hidden"
            data-titre-bandeau
            data-titre-de-zone
            data-titre-de-page-ici
          />
        ) : titreEnCran ? (
          <button
            type="button"
            data-chemin-de-zone
            data-titre-bandeau
            onClick={onTitre}
            className={cn(CLASSE_CRAN_CLIQUABLE, 'hidden truncate sm:block')}
          >
            {titre}
          </button>
        ) : menuDuTitre ? (
          menuDuTitre(
            /* Pas de `Tooltip` ici : imbriqué dans le déclencheur d'un menu, il
               se dispute le même bouton. La bulle maison lit `title`. */
            <button
              type="button"
              className="group/cran -mx-1.5 flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-left font-medium text-text transition-colors hover:bg-raised data-[state=open]:bg-raised"
              data-titre-bandeau
              title={t('Changer de projet')}
            >
              <span className="min-w-0 truncate">{titre}</span>
              {/* Le chevron est visible EN PERMANENCE : c'est lui qui dit que le
                  nom du projet ouvre la liste des autres projets (le groupe
                  n'est plus un cran du fil). Il s'assombrit au survol. */}
              <ChevronDown
                className="h-3.5 w-3.5 shrink-0 text-muted transition-colors group-hover/cran:text-text group-data-[state=open]/cran:text-text"
                aria-hidden
                data-chevron-de-cran
              />
            </button>,
          )
        ) : onTitre ? (
          <Tooltip label={t('Changer de projet')}>
            <button
              type="button"
              className="-mx-1.5 min-w-0 truncate rounded-md px-1.5 py-1 text-left font-medium text-text transition-colors hover:bg-raised"
              data-titre-bandeau
              aria-haspopup="dialog"
              onClick={onTitre}
            >
              {titre}
            </button>
          </Tooltip>
        ) : (
          <span className="min-w-0 truncate font-medium text-text" data-titre-bandeau data-titre-de-zone>
            {titre}
          </span>
        )}
        {suite}
      </nav>
  );
  const droite = (
    <>
      {children || menu ? (
        <div className={cn('shrink-0', CLASSE_RANGEE_DE_BOUTONS)} data-rangee-de-boutons="droite">
          {children}
          {menu}
        </div>
      ) : null}
    </>
  );

  if (deuxRangs) {
    return (
      <div
        data-entete-de-zone
        data-entete-deux-rangs
        {...attributs}
        className={cn('shrink-0', className)}
        /* La marge de la barre d'état se compte une fois, sur le bloc entier. */
        style={{ paddingTop: MARGE_HAUTE_DE_LA_BARRE }}
      >
        {/* L'EN-TÊTE MAÎTRE : les boutons globaux. Il reste TOUJOURS affiché :
            seule la barre des étapes, dessous, se replie au défilement. */}
        <div data-entete-maitre="visible">
          <div className="flex h-12 items-center gap-1 px-3">
            {/* LE MENU PRINCIPAL, TOUT EN HAUT : toujours à portée, sur chaque page. */}
            {menuPrincipal ? <BoutonDuMenuPrincipal {...menuPrincipal} /> : null}
            {/* LE BOUTON DES SERVICES, JUSTE À DROITE DU MENU : menu / services
                à gauche, les options de la page à droite (demande du 15/10/2026). */}
            {avant ? <div className="flex shrink-0 items-center" data-avant-le-fil>{avant}</div> : null}
            <span className="flex-1" />
            {droite}
          </div>
        </div>
        {/* LE FIL D'ARIANE : « Tableaux de bord », le projet, la branche et le
            titre. Le bouton des services est monté dans le rang du haut. Ce
            rang-là reste toujours. */}
        <div className="flex h-12 items-center gap-1 px-3" data-rang-du-titre>
          {fil}
        </div>
      </div>
    );
  }

  return (
    <header
      data-entete-de-zone
      {...attributs}
      className={cn('flex h-14 shrink-0 items-center gap-1 px-3 sm:gap-1.5 sm:px-5', className)}
      style={{
        /* LA MARGE DE LA BARRE D'ÉTAT DU TÉLÉPHONE SE COMPTE UNE FOIS. Sur le
           tableau, cette barre est seule à la porter. Dans une page ouverte
           par-dessus (`FeuilleDeTiroir`), la feuille la porte déjà et remet
           `--zone-sure-entete` à zéro : comptée deux fois, elle laissait une
           bande vide de la hauteur de l'heure au-dessus de chaque page. */
        paddingTop: MARGE_HAUTE_DE_LA_BARRE,
        height: `calc(3.5rem + ${MARGE_HAUTE_DE_LA_BARRE})`,
      }}
    >
      {retour}
      {/* LE BOUTON DES SERVICES, À GAUCHE DU TITRE : on change de service depuis
          le fil d'Ariane, sans passer par la colonne. Sur ordinateur il ouvre
          la barre (`sm:order-first`) ; sur téléphone il suit le bouton des
          projets, juste devant le titre — plus à droite, où il se perdait
          entre la cloche et l'assistant. */}
      {avant ? <div className="flex shrink-0 items-center sm:order-first sm:-ml-1.5" data-avant-le-fil>{avant}</div> : null}

      {fil}

      {droite}
    </header>
  );
}

/**
 * L'EN-TÊTE D'UNE PAGE OUVERTE PAR-DESSUS LA ZONE PRINCIPALE — une fiche du
 * coffre-fort, un site surveillé, le déroulé d'un déploiement. La MÊME barre
 * que partout : le bouton des services, la flèche de retour, puis le fil
 * d'Ariane du lieu d'où l'on vient (cliquable : il referme la page) et, en
 * dernier cran, le TITRE DE LA PAGE — son premier `DialogTitle` y monte de
 * lui-même. À droite, les gestes que la page pose avec `GestesDePage`.
 *
 * `FeuilleDeTiroir` (`ui/index.tsx`) le rend par défaut, à travers
 * `EnteteDePageParDefaut` : aucune page n'a eu à changer.
 */
export function EnteteDePage({
  fermer,
  onCibleDuTitre,
  onCibleDesGestes,
}: {
  fermer: () => void;
  onCibleDuTitre: (element: HTMLElement | null) => void;
  onCibleDesGestes: (element: HTMLElement | null) => void;
}) {
  const lieu = React.useContext(Lieu);
  return (
    <EnteteDeZone
      data-entete-de-page
      avant={lieu?.avant}
      onRetour={fermer}
      retourDePage
      chemin={lieu ? [...lieu.chemin, { libelle: lieu.titre, onClick: fermer }] : []}
      titre=""
      emplacementDuTitre={onCibleDuTitre}
    >
      <div ref={onCibleDesGestes} data-gestes-de-page="barre" data-rangee-de-boutons className={CLASSE_CIBLE_DES_GESTES} />
    </EnteteDeZone>
  );
}
