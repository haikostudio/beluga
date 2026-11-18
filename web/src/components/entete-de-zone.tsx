import { LienInterne } from '@/components/ui/lien-interne';
import { CLASSE_CHEVRON_AU_SURVOL, ChevronDesVoisins, type VoisinsDuCran } from '@/components/voisins-du-fil';
import * as React from 'react';
import { useBarreDuProjet } from '@/components/barre-du-projet';
import { createPortal } from 'react-dom';
import { ArrowLeft, ChevronDown, ChevronRight, EllipsisVertical, Loader2, Menu } from '@/components/ui/icones';
import {
  Button,
  CLASSE_RANGEE_DE_BOUTONS,
  CLASSE_SEGMENT_DE_GROUPE,
  CibleDesGestesDePage,
  DansUneBarreDEnTete,
  CibleDuBasDePage,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tooltip,
  type ButtonProps,
  DansUneFenetreDeService,
  DansUnePageDeService,
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
/*
 * L'AIR SOUS LES BOUTONS DU HAUT DU TÉLÉPHONE (18/11/2026, capture #b688, maquette #d2f0) : 12 px entre le bas des
 * boutons (40 px au téléphone, mesurés : ☰ et ⋮) et le bas de la barre, comme la marge latérale (`px-3`). Le haut
 * ne bouge pas. Les deux barres propres au téléphone ajoutent ce qui manque sous leur rangée : 44 px de rangée en
 * laissent 2, il en faut 10 de plus ; 48 px en laissent 4, il en faut 8. Contrôle : `scripts/verif-air-sous-le-haut.mjs`.
 */
const AIR_SOUS_LES_BOUTONS_DU_TELEPHONE = 12;
const BOUTON_DU_HAUT = 40;
const complementSous = (rangee: number) => AIR_SOUS_LES_BOUTONS_DU_TELEPHONE - (rangee - BOUTON_DU_HAUT) / 2;

/**
 * LE MENU PRINCIPAL DU TÉLÉPHONE (la colonne des projets, qui vit dans un
 * panneau). L'application le fournit : la barre à DEUX RANGS d'une tâche, qui
 * n'est pas celle de l'application, le pose elle aussi tout en haut, au lieu de
 * la flèche de retour qui l'y remplaçait (demande du 15/10/2026).
 */
export interface MenuPrincipalDuTelephone {
  ouvrir: () => void;
  /*
   * PLUS AUCUN POINT D'ÉTAT SUR CE BOUTON (décision du 06/11/2026) : il « ne servait à rien ». Les alertes des services
   * restent sur leurs tuiles de la grille (`data-alerte-de-tuile`).
   */
  /* L'ANCIENNE GRILLE DES SERVICES (`services`), que le titre centré d'une tâche ouvrait, a disparu du téléphone
     (13/11/2026) : le nom centré ouvre désormais ce menu principal, et les outils du projet sont dans les trois points. */
}
const MenuPrincipal = React.createContext<MenuPrincipalDuTelephone | null>(null);
export const FournirLeMenuPrincipal = MenuPrincipal.Provider;

/**
 * LE PREMIER CRAN DE TOUS LES FILS D'ARIANE : « Tableaux de bord » (demande du
 * 31/10/2026). L'application le fournit, `null` pour un accès tiers qui ne les a pas.
 */
const CranDesTableauxDeBord = React.createContext<CranDuChemin | null>(null);
export const FournirLeCranDesTableauxDeBord = CranDesTableauxDeBord.Provider;
export const useCranDesTableauxDeBord = () => React.useContext(CranDesTableauxDeBord);

/**
 * Le bouton du menu principal : il ouvre la colonne des projets, sur téléphone. Dans une tâche, le logo du projet se
 * pose dans son angle haut droit (`insigne`, demande du 06/11/2026), là où vivait l'ancien point d'état.
 */
export function BoutonDuMenuPrincipal({ ouvrir, insigne }: { ouvrir: () => void; insigne?: React.ReactNode }) {
  return (
    <Button
      variant="doux"
      size="pastille"
      className="relative shrink-0 sm:hidden"
      aria-label="Projets"
      title={t('Projets')}
      data-menu-principal
      onClick={ouvrir}
    >
      <Menu className="h-4 w-4" />
      {insigne ? (
        <span className="pointer-events-none absolute right-0.5 top-0.5 flex items-center justify-center" data-insigne-du-menu>
          {insigne}
        </span>
      ) : null}
    </Button>
  );
}

/**
 * LE NOM CENTRÉ DU TÉLÉPHONE, QUI OUVRE LE MENU PRINCIPAL (décision du 13/11/2026) : le ☰ a disparu, le nom du
 * projet (ou de l'écran) suivi d'un chevron est la seule porte vers la colonne des projets, sur tous les écrans.
 * Il garde le repère `data-menu-principal` du ☰ qu'il remplace.
 */
export function BoutonDuNomQuiOuvreLeMenu({
  libelle,
  icone,
  ouvrir,
}: {
  libelle: React.ReactNode;
  icone?: React.ReactNode;
  ouvrir: () => void;
}) {
  return (
    <button
      type="button"
      onClick={ouvrir}
      aria-label="Menu principal"
      title={t('Menu principal')}
      className="pointer-events-auto flex h-[38px] min-w-0 max-w-full items-center justify-center gap-1 rounded-[11px] px-2 text-[17px] font-semibold text-text transition-colors active:bg-raised"
      data-menu-principal
      data-titre-bandeau
      data-haut-titre
      data-haut-liste="menu"
    >
      {icone ? <span className="flex shrink-0 items-center">{icone}</span> : null}
      <span className="min-w-0 truncate">{libelle}</span>
      <ChevronDown className="h-[17px] w-[17px] shrink-0 text-muted" aria-hidden data-chevron-du-haut />
    </button>
  );
}

/**
 * LE NOM DU PROJET, CENTRÉ, QUI OUVRE SES TÂCHES (carte « Services homogènes et centrés », 14/11/2026, capture #bf3e3 :
 * « quand on clique sur le titre ça ouvre le drawer des tâches du projet, et à gauche il faut remettre le menu
 * principal »). Le chevron se retourne et le nom passe en violet tant que la feuille des tâches est ouverte. Le menu
 * principal, lui, est revenu au coin gauche (`BoutonDuMenuPrincipal`). Repère `data-taches-du-haut` (gardé du bouton
 * « Tâches » qu'il remplace).
 */
export function BoutonDuNomQuiOuvreLesTaches({
  libelle,
  icone,
  ouvrir,
  actif = false,
}: {
  libelle: React.ReactNode;
  icone?: React.ReactNode;
  ouvrir: () => void;
  actif?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={ouvrir}
      aria-label="Tâches du projet"
      aria-expanded={actif}
      title={t('Tâches du projet')}
      className={cn(
        'pointer-events-auto flex h-[38px] min-w-0 max-w-full items-center justify-center gap-1 rounded-[11px] px-2 text-[17px] font-semibold transition-colors active:bg-raised',
        actif ? 'text-teinte' : 'text-text',
      )}
      data-taches-du-haut
      data-actif-du-haut={actif ? '' : undefined}
      data-titre-bandeau
      data-haut-titre
      data-haut-liste="taches"
    >
      {icone ? <span className="flex shrink-0 items-center">{icone}</span> : null}
      <span className="min-w-0 truncate">{libelle}</span>
      <ChevronDown className={cn('h-[17px] w-[17px] shrink-0 transition-transform', actif ? 'rotate-180 text-teinte' : 'text-muted')} aria-hidden data-chevron-du-haut />
    </button>
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
  /** La liste des services, derrière le chevron du lieu (le même que dans la barre de la zone). */
  menuDuTitre?: (declencheur: React.ReactElement) => React.ReactNode;
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
/** La suite du fil fournie plus haut (une feuille de service la reprend pour savoir qu'une sous-page est ouverte). */
export const useSuiteDuFilFournie = () => React.useContext(Suite);

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
  const enFenetre = React.useContext(DansUneFenetreDeService);
  const enPage = React.useContext(DansUnePageDeService);
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
  /* DANS UNE FENÊTRE DE SERVICE, pas de fil : le menu de gauche de la fenêtre dit déjà où l'on est. Dans une PAGE de
     service (14/11/2026), si : la sous-page s'écrit « Service / titre » en haut de la page. */
  if (enFenetre && !enPage) return null;
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

/**
 * LE DOUBLE CLIC D'UN CRAN À MENU MÈNE À SA SECTION (16/11/2026) : le menu ouvert par le premier clic se referme (Échap,
 * que Radix écoute), puis la destination du cran s'ouvre.
 */
function fermerLeMenuPuis(destination: () => void) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  destination();
}

/** Le chevron qui sépare deux crans du fil d'Ariane. */
export function SeparateurDuFil() {
  /* « / » ENTRE DEUX CRANS (14/11/2026) : le même séparateur que le fil d'un projet (`FilDuProjet`). */
  return (
    <span className="hidden shrink-0 text-faint sm:inline" aria-hidden data-separateur-du-fil>
      /
    </span>
  );
}

/**
 * UN CRAN DE LA SUITE DU FIL. Le dernier s'écrit en texte plein ; un cran
 * d'avant se clique pour y remonter. Un cran qui ouvre une liste (changer de
 * site, de client) pose son propre bouton à la place — voir `SelecteurDeProjet`.
 */
export function CranDuFil({
  children,
  onClick,
  adresse,
  dernier = true,
  sousTitre,
  voisins,
  voisinsSurLeDernier = false,
  ...attributs
}: {
  children: React.ReactNode;
  onClick?: () => void;
  /**
   * LE DERNIER CRAN PORTE AUSSI SA LISTE (15/11/2026, capture #f46c1) : le site surveillé ouvert dans son tiroir est le
   * dernier cran, et son chevron liste les autres sites pour basculer de l'un à l'autre.
   */
  voisinsSurLeDernier?: boolean;
  /**
   * LES ÉLÉMENTS DU MÊME NIVEAU (14/11/2026) : un cran d'avant (`dernier={false}`) pose un petit chevron qui ouvre leur
   * liste ; « Ouvrir <nom> », en tête, joue `onClick`. Sans effet sur le dernier cran (son menu est la page elle-même).
   */
  voisins?: VoisinsDuCran;
  /** L'adresse du cran (sans « # ») : un vrai lien, ouvrable dans un nouvel onglet. */
  adresse?: string;
  dernier?: boolean;
  /** Une précision discrète après le nom (le projet d'une création). */
  sousTitre?: React.ReactNode;
} & Record<`data-${string}`, string | number | boolean | undefined>) {
  /* SUR TÉLÉPHONE, SEUL LE DERNIER CRAN SE LIT : les séparateurs y sont cachés,
     et deux noms collés sans rien entre eux ne disaient plus un chemin. La
     flèche de retour de la barre remonte d'un cran (`SuiteDuFil retour`). */
  const avecVoisins = !!voisins && (!dernier || voisinsSurLeDernier);
  const classe = cn('min-w-0 truncate', dernier ? 'font-medium text-text' : 'text-muted transition-colors hover:text-text', !dernier && !avecVoisins && 'max-sm:hidden');
  const nom =
    onClick && adresse ? (
        <LienInterne adresse={adresse} onClick={onClick} className={cn(classe, 'rounded-md text-left')} data-cran-du-fil {...attributs}>
          {children}
        </LienInterne>
      ) : onClick ? (
        <button type="button" onClick={onClick} className={cn(classe, 'rounded-md text-left')} data-cran-du-fil {...attributs}>
          {children}
        </button>
      ) : (
        <span className={classe} data-cran-du-fil {...attributs}>
          {children}
        </span>
      );
  return (
    <>
      <SeparateurDuFil />
      {avecVoisins ? (
        <span className="group/cran flex min-w-0 items-center max-sm:hidden" data-cran-a-voisins={voisins.repere}>
          {nom}
          <ChevronDesVoisins voisins={voisins} onOuvrir={onClick} />
        </span>
      ) : (
        nom
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
  const telephone = useTelephone();
  /* SUR TÉLÉPHONE, LES GESTES D'UNE PAGE VONT DANS LES TROIS POINTS DU HAUT (03/11/2026), en rangée en tête du menu :
     le haut garde un bouton à gauche, deux à droite. */
  const dansLeMenu = useDeclarerDansLeMenuDuHaut(telephone && estLaBarreDuHaut(cible) && React.Children.toArray(children).length > 0, { genre: 'gestes', noeud: children });
  if (dansLeMenu) return null;
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

/**
 * LE MENU À TROIS POINTS DU HAUT DU TÉLÉPHONE (décision de l'utilisateur, 03/11/2026) : au plus un bouton à gauche
 * (menu ou retour) et deux à droite — l'agent, puis ces trois points. Les options d'une page (`OptionsDePage`) et son
 * geste principal quand le bas n'en a pas (`GestePrincipal`) ne posent donc plus leurs propres boutons dans le haut :
 * ils se DÉCLARENT ici, et le menu à trois points (`MenuDuHautTelephone`) les montre, avec la cloche.
 *
 * Un petit magasin à part, et non un état de l'application : écrire ici ne redessine que le menu, jamais la page qui
 * déclare (sinon chaque rendu de la page en relançait un autre).
 */
export interface EntreeDuMenuDuHaut {
  genre: 'principal' | 'gestes' | 'options';
  noeud: React.ReactNode;
  enCours?: boolean;
}
export interface RegistreDuMenuDuHaut {
  lire: () => ReadonlyMap<string, EntreeDuMenuDuHaut>;
  ecrire: (cle: string, entree: EntreeDuMenuDuHaut | null) => void;
  abonner: (ecouteur: () => void) => () => void;
}
export function creerLeRegistreDuMenuDuHaut(): RegistreDuMenuDuHaut {
  let contenu: ReadonlyMap<string, EntreeDuMenuDuHaut> = new Map();
  const ecouteurs = new Set<() => void>();
  return {
    lire: () => contenu,
    ecrire: (cle, entree) => {
      if (!entree && !contenu.has(cle)) return;
      const suivant = new Map(contenu);
      if (entree) suivant.set(cle, entree);
      else suivant.delete(cle);
      contenu = suivant;
      ecouteurs.forEach((f) => f());
    },
    abonner: (ecouteur) => {
      ecouteurs.add(ecouteur);
      return () => ecouteurs.delete(ecouteur);
    },
  };
}
const RegistreDuMenu = React.createContext<RegistreDuMenuDuHaut | null>(null);
export const FournirLeRegistreDuMenuDuHaut = RegistreDuMenu.Provider;
export function useContenuDuMenuDuHaut(registre: RegistreDuMenuDuHaut): ReadonlyMap<string, EntreeDuMenuDuHaut> {
  return React.useSyncExternalStore(registre.abonner, registre.lire, registre.lire);
}
/** La cible des gestes est-elle la barre du HAUT de l'écran (et non le rang d'une feuille du bas) ? */
function estLaBarreDuHaut(cible: HTMLElement | null): boolean {
  return cible?.getAttribute('data-gestes-de-page') === 'barre';
}
/**
 * SUR ORDINATEUR, LES OPTIONS D'UNE PAGE VIVENT DANS LE CHEVRON DU COIN HAUT DROIT DE LA ZONE (13/11/2026,
 * `bande-de-zone.tsx`) : `OptionsDePage` s'y déclare comme sur téléphone dans les trois points, et le chevron les
 * montre avec les gestes du menu du service — un seul bouton d'options, jamais deux.
 */
export interface CoinDeLaZone {
  registre: RegistreDuMenuDuHaut;
  /** La cible des gestes du coin : seules les options qui y visent s'y rangent (une page posée par-dessus a la sienne). */
  cible: HTMLElement | null;
}
const RegistreDuCoin = React.createContext<CoinDeLaZone | null>(null);
export const FournirLeRegistreDuCoin = RegistreDuCoin.Provider;
/**
 * LA FEUILLE D'UN SERVICE AU TÉLÉPHONE A SON PROPRE COIN (carte « Services homogènes et centrés », 14/11/2026) : ses
 * options se rangent dans le chevron de sa rangée, comme sur ordinateur, au lieu de s'empiler en rangées de boutons.
 */
const CoinDeFeuille = React.createContext(false);
export const FournirLeCoinDeFeuille = CoinDeFeuille.Provider;
/** …et son geste principal descend en bas de la feuille, pleine largeur. */
const CibleDuPrincipalDeFeuille = React.createContext<HTMLElement | null>(null);
export const FournirLaCibleDuPrincipalDeFeuille = CibleDuPrincipalDeFeuille.Provider;

/** Déclarer une entrée du menu du haut tant que `actif` ; rend `true` quand elle y est (la page ne pose rien d'autre). */
function useDeclarerDansLeMenuDuHaut(actif: boolean, entree: EntreeDuMenuDuHaut, registreDuCoin = false): boolean {
  const registreDuHaut = React.useContext(RegistreDuMenu);
  const coin = React.useContext(RegistreDuCoin);
  const registre = registreDuCoin ? (coin?.registre ?? null) : registreDuHaut;
  const cle = React.useId();
  const dedans = actif && !!registre;
  React.useLayoutEffect(() => {
    if (registre) registre.ecrire(cle, dedans ? entree : null);
  });
  React.useLayoutEffect(() => () => registre?.ecrire(cle, null), [registre, cle]);
  return dedans;
}


export const useTenueDesOptions = () => React.useContext(TenueDesOptions);
/** Les options d'une page, dessinées en lignes de menu (le menu à trois points du haut du téléphone). */
export function EnLignesDeMenu({ children }: { children: React.ReactNode }) {
  return <TenueDesOptions.Provider value="ligne">{children}</TenueDesOptions.Provider>;
}

export function OptionsDePage({
  children,
  enCours = false,
  enMenu = false,
  className,
}: {
  children: React.ReactNode;
  /**
   * SUR ORDINATEUR AUSSI, LES OPTIONS VIVENT DERRIÈRE LES TROIS POINTS (les
   * tableaux de bord : « Redémarrer le serveur », demande du 20/10/2026) au
   * lieu de s'aligner en boutons dans la barre.
   */
  enMenu?: boolean;
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
  const vide = !React.Children.toArray(children).length;
  /* SUR TÉLÉPHONE, DANS LES TROIS POINTS DU HAUT : la page ne pose plus son propre bouton (03/11/2026). */
  const dansLeMenu = useDeclarerDansLeMenuDuHaut(telephone && estLaBarreDuHaut(cible) && !vide, { genre: 'options', noeud: children, enCours });
  const coin = React.useContext(RegistreDuCoin);
  const coinDeFeuille = React.useContext(CoinDeFeuille);
  const dansLeCoin = useDeclarerDansLeMenuDuHaut((!telephone || coinDeFeuille) && !!cible && coin?.cible === cible && !vide, { genre: 'options', noeud: children, enCours }, true);
  /* Rien à ranger : pas de trois points. */
  if (vide || dansLeMenu || dansLeCoin) return null;
  if (!cible) {
    return (
      <div data-gestes-de-page="page" className={cn(CLASSE_RANGEE_DE_PAGE, className)}>
        {children}
      </div>
    );
  }
  if (!telephone && !enMenu) {
    /*
     * SUR ORDINATEUR, LES OPTIONS SE RANGENT DERRIÈRE UN CHEVRON COLLÉ AU GESTE PRINCIPAL (décision du 03/11/2026 :
     * « réduire le nombre de boutons ; les boutons secondaires derrière un chevron à droite du bouton principal »).
     * Le geste principal et ce chevron forment le BOUTON GROUPÉ commun — une pilule coupée en deux (`styles.css`,
     * `[data-options-de-page="chevron"]`). Sans geste principal, le chevron reste seul, en bouton entier.
     */
    return createPortal(
      <div className="order-[10000] -ml-0.5 flex shrink-0" data-options-de-page="chevron">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(CLASSE_SEGMENT_DE_GROUPE, 'rounded-lg px-2')}
              aria-label="Plus d’options"
              title={t('Plus d’options')}
              data-options-de-page-chevron
              data-options-en-cours={enCours ? '' : undefined}
            >
              {enCours ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" data-options-de-page-menu>
            <TenueDesOptions.Provider value="ligne">{children}</TenueDesOptions.Provider>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>,
      cible,
    );
  }
  return createPortal(
    <DropdownMenu>
      {/* Pas de `Tooltip` autour du déclencheur d'un menu : `title`. */}
      <DropdownMenuTrigger asChild>
        <Button
          variant="doux"
          size="pastille"
          className="order-[9000] shrink-0"
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
  detail,
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
  /**
   * UNE PHRASE SOUS LE NOM, dans le menu : pourquoi la ligne est éteinte. Une
   * ligne éteinte ne montre pas sa bulle ; la raison s'écrit donc dessous.
   * En bouton, elle devient sa bulle.
   */
  detail?: string | null;
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
        {detail ? (
          <span className="flex min-w-0 flex-col">
            <span className="flex min-w-0 items-center gap-1.5 truncate">{children}</span>
            <span className="max-w-[18rem] whitespace-normal text-[12px] leading-snug text-muted" data-option-detail>
              {detail}
            </span>
          </span>
        ) : (
          <span className="flex min-w-0 items-center gap-1.5 truncate">{children}</span>
        )}
      </DropdownMenuItem>
    );
  }
  if (compact) {
    return (
      <Button variant="ghost" size={taille} className={cn('shrink-0', className)} disabled={disabled} onClick={onClick} title={detail ?? title} {...attributs}>
        {icone}
      </Button>
    );
  }
  return (
    <Button variant={variante} size="sm" className={className} disabled={disabled} onClick={onClick} title={detail ?? title} {...attributs}>
      {icone}
      {children}
    </Button>
  );
}

/**
 * SUR ORDINATEUR AUSSI, LE GESTE PRINCIPAL D'UNE PAGE DESCEND EN BAS, PLEINE LARGEUR DU CONTENU (décision du
 * 13/11/2026, maquette #94fc6 : « Installer le suivi » quitte la barre du haut). L'application fournit l'emplacement,
 * sous l'écran affiché ; un écran gardé caché n'en reçoit pas.
 */
const CibleDuPrincipalOrdinateur = React.createContext<HTMLElement | null>(null);
export const FournirLaCibleDuPrincipalOrdinateur = CibleDuPrincipalOrdinateur.Provider;

/** Le geste principal est-il posé en bas de l'écran (téléphone) ? `BoutonPrincipal` le lit. */
const PrincipalEnBas = React.createContext(false);
/** Le geste principal est-il posé dans le haut du téléphone ? Il n'y est qu'une icône. */
const PrincipalEnIcone = React.createContext(false);

/**
 * LE GESTE PRINCIPAL D'UNE PAGE. Sur téléphone, quand le bas de l'écran est un bouton PLEINE LARGEUR fourni par la
 * page (`menuDuBas` → `page` : Notes, l'accueil du Studio), il EST ce bouton. Sur un écran sans bas (Backup,
 * Surveillance…), il reste dans la barre du haut. UN SEUL par page. La page le démonte quand elle ouvre un enfant
 * sur place (un site, une note).
 */
export function GestePrincipal({ children }: { children: React.ReactNode }) {
  const cible = React.useContext(CibleDesGestes);
  const bas = React.useContext(CibleDuBasDePage);
  const basOrdinateur = React.useContext(CibleDuPrincipalOrdinateur);
  const telephone = useTelephone();
  /* SUR TÉLÉPHONE, SANS BAS QUI LE PORTE, LE GESTE PRINCIPAL VA EN TÊTE DES TROIS POINTS (03/11/2026) : le haut n'a
     plus que l'agent et les trois points à droite. */
  const dansLeMenu = useDeclarerDansLeMenuDuHaut(telephone && !bas && estLaBarreDuHaut(cible), { genre: 'principal', noeud: children });
  const basDeFeuille = React.useContext(CibleDuPrincipalDeFeuille);
  if (dansLeMenu) return null;
  if (telephone && basDeFeuille) {
    return createPortal(<PrincipalEnBas.Provider value>{children}</PrincipalEnBas.Provider>, basDeFeuille);
  }
  if (!telephone && basOrdinateur) {
    return createPortal(<PrincipalEnBas.Provider value>{children}</PrincipalEnBas.Provider>, basOrdinateur);
  }
  if (telephone && bas) {
    /* La bande n'est pas encore montée : rien ce tour-ci, plutôt qu'un bouton
       qui passerait une image dans la barre. */
    if (!bas.cible) return null;
    return createPortal(<PrincipalEnBas.Provider value>{children}</PrincipalEnBas.Provider>, bas.cible);
  }
  if (cible) {
    /* SUR TÉLÉPHONE, DANS LE HAUT, LE GESTE N'EST QU'UNE ICÔNE (03/11/2026) : le nom du haut reste centré et lisible
       entre les boutons ; le libellé reste son nom lu à voix haute et sa bulle. */
    return createPortal(
      <div className={cn('order-last shrink-0', CLASSE_RANGEE_DE_BOUTONS)} data-geste-principal="barre">
        <PrincipalEnIcone.Provider value={telephone}>{children}</PrincipalEnIcone.Provider>
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
  const enIcone = React.useContext(PrincipalEnIcone);
  if (enBas) {
    return (
      /* LE BOUTON PLEINE LARGEUR DU BAS DU TÉLÉPHONE (03/11/2026) : gris, jamais l'aplat blanc en sombre. */
      <Button
        ref={ref}
        variant="subtle"
        size="lg"
        data-bouton-principal-du-bas
        data-bouton-pleine-largeur="page"
        className={cn('h-12 w-full justify-center gap-2 rounded-[13px] text-[15px] font-semibold [&>svg]:h-[18px] [&>svg]:w-[18px] [&>svg]:shrink-0', className)}
        {...props}
      />
    );
  }
  if (enIcone) {
    const libelle = typeof props.title === 'string' ? props.title : props['aria-label'];
    return (
      <Button
        ref={ref}
        variant="subtle"
        size="sm"
        data-principal-en-icone
        title={libelle ?? textePlat(props.children)}
        aria-label={libelle ?? textePlat(props.children)}
        className={cn('h-[38px] w-[38px] justify-center gap-0 rounded-[11px] px-0 text-[0px] [&>svg]:h-[18px] [&>svg]:w-[18px] [&>svg:not(:first-child)]:hidden', className)}
        {...props}
      />
    );
  }
  return <Button ref={ref} variant={variant} size="sm" className={className} {...props} />;
});

/** Le texte d'un libellé React, pour la bulle et la lecture à voix haute d'un bouton réduit à son icône. */
function textePlat(noeud: React.ReactNode): string {
  if (typeof noeud === 'string' || typeof noeud === 'number') return String(noeud);
  if (Array.isArray(noeud)) return noeud.map(textePlat).join('').trim();
  if (React.isValidElement(noeud)) return textePlat((noeud.props as { children?: React.ReactNode }).children);
  return '';
}

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
  /**
   * LE CRAN SE CLIQUE ET PORTE SA LISTE (le service d'une page ouverte par-dessus, 31/10/2026) : son nom ramène au
   * lieu (`onClick`), et un chevron qui paraît au survol ouvre la liste des services, comme le titre d'un service.
   */
  menuApres?: (declencheur: React.ReactElement) => React.ReactNode;
  /** L'ADRESSE DU CRAN (sans « # ») : le cran devient un vrai lien, qui s'ouvre aussi dans un nouvel onglet. */
  adresse?: string;
  /**
   * UN CRAN QUI EST SON PROPRE BOUTON (la grille des services, premier cran de tous les fils, 06/11/2026) : posé tel
   * quel, sans nom écrit ; `libelle` ne sert qu'aux lecteurs d'écran.
   */
  element?: React.ReactNode;
}

/* LE CHEVRON D'UNE LISTE NE PARAÎT QU'AU SURVOL : `CLASSE_CHEVRON_AU_SURVOL` vit dans `voisins-du-fil.tsx`, partagé avec les
   crans du milieu du fil. */

/**
 * LA BARRE D'EN-TÊTE D'UNE PAGE — la même partout, sur ordinateur comme sur
 * téléphone.
 *
 * Une seule rangée en haut de la zone principale :
 *  - À GAUCHE, LE FIL D'ARIANE : où l'on se trouve. Les crans d'avant se
 *    cliquent pour remonter ; le dernier — le titre de la page — est en texte
 *    plein. Un cran peut ouvrir une LISTE DÉROULANTE (`menu`, `menuDuTitre`) :
 *    c'est par elle qu'on change de projet sans quitter la page. Sur une page
 *    qu'on a OUVERTE (une carte), une flèche de retour le précède — sur
 *    téléphone seulement, l'ordinateur remonte par les crans ; sinon, sur
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
  infobulleDuMenu,
  titreEnCran = false,
  emplacementDuTitre,
  suite,
  avant,
  onRetour,
  retourDePage = false,
  reperesDeRetour,
  retourDansLaColonne = false,
  onOuvrirColonne: _ouvrirColonne,
  avantTitre,
  children,
  menu,
  deuxRangsSurPetitEcran = false,
  finDuRangDuTitre,
  insigneDuMenu,
  etagesTelephone,
  hautEnLigne = false,
  ongletsDuProjet = false,
  insigneAGauche,
  apresLeMenu,
  className,
  ...attributs
}: {
  /** DANS LA BARRE DU PROJET (ordinateur), CE QUI SE POSE JUSTE APRÈS LES TROIS POINTS : le bouton Aperçu d'une tâche. */
  apresLeMenu?: React.ReactNode;
  /**
   * SUR TÉLÉPHONE, CE QUI TIENT LE COIN GAUCHE QUAND IL N'Y A PAS DE FLÈCHE DE RETOUR : le logo du projet, sur
   * l'accueil d'un projet (13/11/2026). Le ☰ a disparu : le nom centré ouvre le menu principal.
   */
  insigneAGauche?: React.ReactNode;
  /**
   * DANS UN PROJET, SUR ORDINATEUR, LA BARRE UNIQUE À ONGLETS (refonte du 13/11/2026) prend la place du fil
   * d'Ariane : l'icône du projet, les onglets, puis à droite les trois points, les outils du projet et « Publier »
   * (`barre-du-projet.tsx`). Le fil reste monté, caché : la suite qu'une page y écrit garde son emplacement.
   */
  ongletsDuProjet?: boolean;
  /**
   * SUR TÉLÉPHONE, LES DEUX ÉTAGES SERVICE / PROJET (`EtagesDuTelephone`, maquette A du 03/11/2026) prennent la place
   * du fil d'Ariane, à droite du bouton ☰. Le fil reste monté, caché : la suite qu'une page y écrit et le titre
   * qu'une page y loge gardent leur emplacement.
   */
  etagesTelephone?: React.ReactNode;
  /**
   * LE HAUT DU TÉLÉPHONE N'EST PAS UN NOM MAIS UN CONTENU (la recherche de la Mémoire) : il occupe toute la place
   * entre les boutons, au lieu du calque centré.
   */
  hautEnLigne?: boolean;
  /**
   * SUR TÉLÉPHONE ET SUR TABLETTE (moins de 1024 px), LA PAGE D'UNE TÂCHE (le nom est resté de l'époque des deux
   * rangs, 14/10/2026) : UNE rangée depuis le 01/11/2026 (capture #d6cd) — le menu principal (la colonne des
   * projets) à gauche, puis le fil d'Ariane (projet, titre, branche ; aucune flèche de retour : on remonte par le
   * menu principal ou par l'icône du projet), puis les options à droite. Sur ordinateur, la barre ordinaire.
   */
  deuxRangsSurPetitEcran?: boolean;
  /**
   * SUR PETIT ÉCRAN SEULEMENT, CE QUI SE POSE APRÈS LE FIL, avant les options — le bouton du volet de droite d'une
   * carte sur téléphone (demande du 30/10/2026, capture #cffe).
   */
  finDuRangDuTitre?: React.ReactNode;
  /**
   * SUR TÉLÉPHONE, DANS UNE TÂCHE, CE QUI SE POSE DANS L'ANGLE DU BOUTON MENU : le logo du projet (demande du
   * 06/11/2026). Le cran du projet n'y montre alors plus son icône.
   */
  insigneDuMenu?: React.ReactNode;
  /** Les lieux qui mènent à la page, du plus large au plus proche. */
  chemin?: CranDuChemin[];
  titre: React.ReactNode;
  /** Le titre devient un bouton (changer de projet). */
  onTitre?: () => void;
  /** Le titre ouvre une liste déroulante : il reçoit son bouton et rend le menu. */
  menuDuTitre?: (declencheur: React.ReactElement) => React.ReactNode;
  /** La bulle du bouton qui ouvre cette liste. */
  infobulleDuMenu?: string;
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
  /** Un repère posé devant le titre (l'icône du projet). */
  avantTitre?: React.ReactNode;
  /** Les gestes de la page, à droite. */
  children?: React.ReactNode;
  /** Le bouton des options de la page (trois points), tout à droite. */
  menu?: React.ReactNode;
  className?: string;
} & Record<`data-${string}`, string | number | boolean | undefined>) {
  const petitEcran = useTabletteOuTelephone();
  const telephone = useTelephone();
  const menuPrincipal = React.useContext(MenuPrincipal);
  const barreDuProjet = useBarreDuProjet();
  const deuxRangs = deuxRangsSurPetitEcran && petitEcran;
  /*
   * SUR TÉLÉPHONE, LE TITRE D'UNE TÂCHE EST CENTRÉ SUR L'AXE DE L'ÉCRAN, ET UN APPUI OUVRE LA GRILLE DES SERVICES
   * (demande du 06/11/2026) — la même technique que le nom centré des autres pages. Sur tablette, la rangée reste.
   */
  const titreCentre = deuxRangs && telephone;
  const nomCentre = telephone && !!etagesTelephone;
    const refGauche = React.useRef<HTMLDivElement | null>(null);
  const refDroite = React.useRef<HTMLDivElement | null>(null);
  const [cote, setCote] = React.useState(56);
  React.useLayoutEffect(() => {
    if (!nomCentre && !titreCentre) return;
    const mesurer = () => {
      const gauche = refGauche.current?.getBoundingClientRect().width ?? 0;
      const droite = refDroite.current?.getBoundingClientRect().width ?? 0;
      setCote(Math.ceil(12 + Math.max(gauche, droite) + 6));
    };
    mesurer();
    const observateur = new ResizeObserver(mesurer);
    if (refGauche.current) observateur.observe(refGauche.current);
    if (refDroite.current) observateur.observe(refDroite.current);
    return () => observateur.disconnect();
  }, [nomCentre, titreCentre]);
  /*
   * SUR ORDINATEUR, LE FIL D'ARIANE N'A PLUS DE FLÈCHE (demande du 20/10/2026) :
   * on remonte en cliquant un cran. Elle ne reste que là où aucun cran ne se
   * clique — sans quoi la page n'aurait plus de sortie. Sur téléphone, où les
   * crans sont masqués, elle reste : c'est le retour d'un cran de la barre.
   */
  const filQuiSeRemonte = titreEnCran || chemin.some((cran) => !!cran.onClick || !!cran.menu);
  const retour = (
    <>
      {onRetour ? (
        <Tooltip label={t('Retour')}>
          <Button
            variant="doux"
            size="pastille"
            className={cn('shrink-0', !avant && 'sm:-ml-1.5', (retourDansLaColonne || filQuiSeRemonte) && 'sm:hidden')}
            aria-label="Retour"
            {...(reperesDeRetour ? { 'data-retour-du-fil': '', ...reperesDeRetour } : { 'data-retour-carte': '' })}
            {...(retourDePage ? { 'data-retour-de-page': '', 'data-poignee-tiroir': '' } : {})}
            onClick={onRetour}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Tooltip>
      ) : insigneAGauche ? (
        /* PLUS DE ☰ SUR TÉLÉPHONE (décision du 13/11/2026) : le nom centré ouvre le menu principal ; sans flèche de
           retour, le coin gauche montre le logo du projet. */
        <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center sm:hidden" data-insigne-du-haut>
          {insigneAGauche}
        </span>
      ) : null}
    </>
  );
  const fil = (
      <nav aria-label="Fil d'Ariane" data-fil-d-ariane className={cn('min-w-0 flex-1 text-[14.5px]', CLASSE_RANGEE_DE_BOUTONS)}>
        {chemin.map((cran, rang) =>
          cran.element ? (
            <React.Fragment key={`${rang}-${cran.libelle}`}>
              <span className="hidden shrink-0 items-center sm:flex sm:-ml-1.5" data-cran-grille>
                {cran.element}
              </span>
              <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 text-faint sm:block" aria-hidden />
            </React.Fragment>
          ) : (
          <React.Fragment key={`${rang}-${cran.libelle}`}>
            {cran.icone ? (
              cran.onClick ? (
                <button
                  type="button"
                  data-icone-du-cran
                  aria-label={cran.libelle}
                  title={cran.libelle}
                  onClick={cran.onClick}
                  className="flex h-[38px] sm:h-8 w-[38px] sm:w-8 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-raised"
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
                 et un chevron bas s'ouvre une place à droite du nom
                 (`CLASSE_CHEVRON_AU_SURVOL`). Le séparateur « › » reste après
                 le cran, au repos comme au survol : « Messagerie ⌄ › ». */
              cran.menu(
                <button
                  type="button"
                  data-chemin-de-zone
                  data-chemin-a-menu
                  onDoubleClick={cran.onClick ? () => fermerLeMenuPuis(cran.onClick!) : undefined}
                  className={cn(
                    CLASSE_CRAN_CLIQUABLE,
                    'group/cran hidden items-center data-[state=open]:bg-raised data-[state=open]:text-text sm:flex',
                  )}
                >
                  <span className="min-w-0 truncate">{cran.libelle}</span>
                  <ChevronDown className={CLASSE_CHEVRON_AU_SURVOL} aria-hidden data-chevron-de-cran />
                </button>,
              )
            ) : cran.onClick && cran.menuApres ? (
              <span className="group/cran hidden min-w-0 items-center sm:flex" data-cran-a-menu-apres>
                {cran.adresse ? (
                  <LienInterne adresse={cran.adresse} data-chemin-de-zone onClick={cran.onClick} className={cn(CLASSE_CRAN_CLIQUABLE, 'truncate')}>
                    {cran.libelle}
                  </LienInterne>
                ) : (
                  <button type="button" data-chemin-de-zone onClick={cran.onClick} className={cn(CLASSE_CRAN_CLIQUABLE, 'truncate')}>
                    {cran.libelle}
                  </button>
                )}
                {cran.menuApres(
                  <button
                    type="button"
                    data-chevron-du-titre
                    onDoubleClick={() => fermerLeMenuPuis(cran.onClick!)}
                    aria-label="Changer de service"
                    title={t('Changer de service')}
                    className="ml-1.5 flex h-6 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-raised hover:text-text data-[state=open]:bg-raised data-[state=open]:text-text [&[data-state=open]>svg]:w-3.5 [&[data-state=open]>svg]:opacity-100"
                  >
                    <ChevronDown className={cn(CLASSE_CHEVRON_AU_SURVOL, 'mx-1 group-hover/cran:ml-1 [@media(hover:none)]:ml-1')} aria-hidden data-chevron-de-cran />
                  </button>,
                )}
              </span>
            ) : cran.onClick && cran.adresse ? (
              <LienInterne adresse={cran.adresse} data-chemin-de-zone onClick={cran.onClick} className={cn(CLASSE_CRAN_CLIQUABLE, 'hidden truncate sm:block')}>
                {cran.libelle}
              </LienInterne>
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
            <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 text-faint sm:block" aria-hidden />
          </React.Fragment>
          ),
        )}
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
          <span className="group/cran hidden min-w-0 items-center sm:flex">
            <button
              type="button"
              data-chemin-de-zone
              data-titre-bandeau
              onClick={onTitre}
              className={cn(CLASSE_CRAN_CLIQUABLE, 'truncate')}
            >
              {titre}
            </button>
            {/* DANS UN ENFANT DU SERVICE, le nom remonte à son accueil : la liste des
                services reste au bout, derrière son chevron, qui paraît au survol du cran. */}
            {menuDuTitre
              ? menuDuTitre(
                  <button
                    type="button"
                    data-chevron-du-titre
                    onDoubleClick={onTitre ? () => fermerLeMenuPuis(onTitre) : undefined}
                    aria-label={infobulleDuMenu}
                    title={infobulleDuMenu}
                    className="ml-1.5 flex h-6 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-raised hover:text-text data-[state=open]:bg-raised data-[state=open]:text-text [&[data-state=open]>svg]:w-3.5 [&[data-state=open]>svg]:opacity-100"
                  >
                    <ChevronDown className={cn(CLASSE_CHEVRON_AU_SURVOL, 'mx-1 group-hover/cran:ml-1 [@media(hover:none)]:ml-1')} aria-hidden data-chevron-de-cran />
                  </button>,
                )
              : null}
          </span>
        ) : menuDuTitre ? (
          menuDuTitre(
            /* Pas de `Tooltip` ici : imbriqué dans le déclencheur d'un menu, il
               se dispute le même bouton. La bulle maison lit `title`. */
            <button
              type="button"
              className="group/cran -mx-1.5 flex min-w-0 items-center rounded-md px-2 sm:px-1.5 py-1.5 sm:py-1 text-left font-medium text-text transition-colors hover:bg-raised data-[state=open]:bg-raised"
              data-titre-bandeau
              title={infobulleDuMenu}
            >
              <span className="min-w-0 truncate">{titre}</span>
              {/* Le chevron ne paraît qu'au survol (demande du 31/10/2026) : le
                  fond du cran et son chevron disent ensemble qu'il ouvre une
                  liste. Toujours visible sur écran tactile. */}
              <ChevronDown className={cn(CLASSE_CHEVRON_AU_SURVOL, 'text-muted group-hover/cran:text-text group-data-[state=open]/cran:text-text')} aria-hidden data-chevron-de-cran />
            </button>,
          )
        ) : onTitre ? (
          <Tooltip label={t('Changer de projet')}>
            <button
              type="button"
              className="-mx-1.5 min-w-0 truncate rounded-md px-2 sm:px-1.5 py-1.5 sm:py-1 text-left font-medium text-text transition-colors hover:bg-raised"
              data-titre-bandeau
              aria-haspopup="dialog"
              onClick={onTitre}
            >
              {titre}
            </button>
          </Tooltip>
        ) : (
          titreCentre ? null : (
            <span className="min-w-0 truncate font-medium text-text" data-titre-bandeau data-titre-de-zone>
              {titre}
            </span>
          )
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

  if (ongletsDuProjet && barreDuProjet && !telephone && !deuxRangs) {
    return (
      <header
        data-entete-de-zone
        data-barre-du-projet
        {...attributs}
        className={cn('flex h-[52px] shrink-0 items-stretch gap-1 pl-3 pr-3', className)}
        style={{ paddingTop: MARGE_HAUTE_DE_LA_BARRE, height: `calc(52px + ${MARGE_HAUTE_DE_LA_BARRE})` }}
      >
        {/* Le fil reste monté, caché : la suite qu'une page y écrit et le titre qu'une page y loge gardent leur place. */}
        <div className="hidden">{fil}</div>
        {barreDuProjet.onglets}
        <div className={cn('shrink-0 self-center pl-2', CLASSE_RANGEE_DE_BOUTONS)} data-rangee-de-boutons="droite">
          {children}
          {menu}
          {apresLeMenu}
          {barreDuProjet.droite}
        </div>
      </header>
    );
  }

  if (titreCentre) {
    /*
     * LA TÂCHE OUVERTE SUR TÉLÉPHONE A LE MÊME HAUT QUE L'ACCUEIL DU PROJET (13/11/2026) : la flèche de retour à
     * gauche, le NOM DU PROJET centré, suivi d'un chevron, qui ouvre le menu principal — plus aucune grille des
     * services —, les trois points seuls à droite (la branche est leur première ligne), puis la rangée d'onglets du
     * projet, l'onglet de la tâche en violet.
     */
    const nom = barreDuProjet?.nom ?? null;
    const ouvrirLeMenu = menuPrincipal?.ouvrir;
    return (
      <div
        data-entete-de-zone
        data-entete-une-rangee
        data-titre-centre
        {...attributs}
        className={cn('shrink-0', className)}
        style={{ paddingTop: MARGE_HAUTE_DE_LA_BARRE, paddingBottom: complementSous(48) }}
      >
        <div className="relative flex h-12 items-center gap-1 px-3" data-rang-du-titre>
          <div ref={refGauche} className="flex shrink-0 items-center gap-1" data-cote-du-haut="gauche">
            {retour}
            {avant ? <div className="flex shrink-0 items-center" data-avant-le-fil>{avant}</div> : null}
          </div>
          {/* Le fil reste monté, caché : la suite qu'une page y écrit garde sa place. */}
          <div className="hidden">{fil}</div>
          <div className="min-w-0 flex-1" />
          <div ref={refDroite} className="flex shrink-0 items-center gap-1" data-cote-du-haut="droite">
            {finDuRangDuTitre}
            {droite}
          </div>
          <div
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
            style={{ paddingLeft: cote, paddingRight: cote }}
            data-calque-du-nom
          >
            {ouvrirLeMenu ? (
              <BoutonDuNomQuiOuvreLeMenu libelle={nom ?? titre} ouvrir={ouvrirLeMenu} />
            ) : (
              <span className="pointer-events-auto min-w-0 truncate text-[17px] font-semibold text-text" data-titre-bandeau data-titre-de-zone>
                {nom ?? titre}
              </span>
            )}
          </div>
        </div>
        {/* PLUS DE RANGÉE D'ONGLETS SOUS LE NOM (14/11/2026) : le haut du téléphone garde « Tâches », le nom, ⋮, Publier. */}
      </div>
    );
  }

  if (deuxRangs) {
    return (
      <div
        data-entete-de-zone
        data-entete-une-rangee
        {...attributs}
        className={cn('shrink-0', className)}
        /* La marge de la barre d'état se compte une fois, sur le bloc entier. */
        style={{ paddingTop: MARGE_HAUTE_DE_LA_BARRE }}
      >
        {/* UNE SEULE RANGÉE DANS LA DISCUSSION D'UN AGENT (demande du 01/11/2026, capture #d6cd) : l'ancien en-tête
            maître (le menu à gauche, les trois points à droite, seuls sur leur bande) disparaît. Le menu principal
            se pose à GAUCHE du fil (projet, titre, branche), les options à DROITE : la conversation gagne une bande
            entière, et plus rien ne se replie au défilement — seule la barre des étapes le fait. */}
        <div className="flex h-12 items-center gap-1 px-3" data-rang-du-titre>
          {menuPrincipal ? <BoutonDuMenuPrincipal ouvrir={menuPrincipal.ouvrir} /> : null}
          {avant ? <div className="flex shrink-0 items-center" data-avant-le-fil>{avant}</div> : null}
          {fil}
          {finDuRangDuTitre ? <div className="flex shrink-0 items-center">{finDuRangDuTitre}</div> : null}
          {droite}
        </div>
      </div>
    );
  }

  /*
   * SUR TÉLÉPHONE, LE NOM DU HAUT EST CENTRÉ SUR L'AXE DE L'ÉCRAN (décision du 03/11/2026, maquette « 0 · Le haut de
   * l'écran »), quel que soit le nombre de boutons de chaque côté : il se pose en CALQUE sur toute la largeur de la
   * barre, et ce calque s'écarte des deux bords de la largeur du côté le plus chargé (`--cote-du-haut`, mesurée) —
   * un nom trop long se coupe donc avant de toucher un bouton, sans jamais se décentrer.
   */
  if (nomCentre) {
    return (
      <header
        data-entete-de-zone
        data-haut-un-rang
        {...attributs}
        className={cn('relative flex shrink-0 items-center gap-1 px-3', className)}
        /* UN HAUT COMPACT (13/11/2026, captures #0175 et #cda3 : « un gap de trop entre l'heure et la barre des
           onglets ») : 44 px, la hauteur d'une barre de navigation iOS, au lieu de 56. */
        style={{
          paddingTop: MARGE_HAUTE_DE_LA_BARRE,
          paddingBottom: complementSous(44),
          height: `calc(2.75rem + ${complementSous(44)}px + ${MARGE_HAUTE_DE_LA_BARRE})`,
        }}
      >
        <div ref={refGauche} className="flex shrink-0 items-center gap-1" data-cote-du-haut="gauche">
          {retour}
          {avant ? <div className="flex shrink-0 items-center" data-avant-le-fil>{avant}</div> : null}
        </div>
        {/* Le fil reste monté, caché : la suite qu'une page y écrit et le titre qu'une page y loge gardent leur place. */}
        <div className="hidden">{fil}</div>
        {hautEnLigne ? <div className="flex min-w-0 flex-1 items-center pl-1">{etagesTelephone}</div> : <div className="min-w-0 flex-1" />}
        <div ref={refDroite} className="flex shrink-0 items-center" data-cote-du-haut="droite">
          {droite}
        </div>
        {hautEnLigne ? null : <div
          className="pointer-events-none absolute inset-x-0 flex h-11 items-center justify-center"
          /* Calé sur la rangée des boutons, au-dessus de l'air du bas : le nom reste centré sur eux. */
          style={{ paddingLeft: cote, paddingRight: cote, bottom: complementSous(44) }}
          data-calque-du-nom
        >
          <div className="pointer-events-auto flex min-w-0 max-w-full flex-1 justify-center">{etagesTelephone}</div>
        </div>}
      </header>
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
      /* LE MÊME FIL PARTOUT (31/10/2026, capture #6c26) : « Tableaux de bord › Service ⌄ › page ». Le nom du
         service referme la page, son chevron ouvre la liste des services. */
      chemin={lieu ? [...lieu.chemin, { libelle: lieu.titre, onClick: fermer, menuApres: lieu.menuDuTitre }] : []}
      titre=""
      emplacementDuTitre={onCibleDuTitre}
    >
      <div ref={onCibleDesGestes} data-gestes-de-page="barre" data-rangee-de-boutons className={CLASSE_CIBLE_DES_GESTES} />
    </EnteteDeZone>
  );
}
