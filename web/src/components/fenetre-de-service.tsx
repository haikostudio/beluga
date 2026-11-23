/*
 * LA GRANDE FENÊTRE D'UN SERVICE (décision du 13/11/2026, maquettes #7c9d et #f83d : « quand on clique sur mémoire ou
 * coffre-fort, ça doit ouvrir une modale avec à gauche le menu et à droite les options affichées ; inspire-toi de la
 * modale fichier »). La même forme que la fenêtre Fichiers : titre centré, croix à droite, par-dessus l'écran, que
 * l'on ne touche plus tant qu'elle est ouverte.
 *
 * Le service s'y pose TEL QUEL, sans rien réécrire :
 *  - son menu (`ColonneDeService`) devient le MENU DE GAUCHE de la fenêtre ; ses gestes (« Nouveau dossier »…) en
 *    sont retirés et rejoignent le chevron du coin haut droit, comme dans la zone (`ChevronDesOptions`) ;
 *  - ses gestes de page (`GestesDePage`) et ses options (`OptionsDePage`) se posent au coin haut droit ;
 *  - son geste principal (`GestePrincipal`) descend en bas, pleine largeur ;
 *  - sa page (`Drawer enPage`) et son titre suivent `DansUneFenetreDeService`.
 * Sur téléphone, la fenêtre est la feuille commune qui monte du bas, et le service garde sa navigation à lui.
 *
 * AGRANDIR / RÉDUIRE (13/11/2026, capture #141b : « on doit pouvoir agrandir la modale si nécessaire via un bouton
 * icône agrandir/réduire ») : sur ordinateur, un bouton juste à gauche de la croix fait occuper à la fenêtre tout
 * l'écran (16 px de marge), puis la ramène à sa taille. Le choix est retenu PAR FENÊTRE, en base comme tout réglage
 * d'affichage (`fenetre-agrandie:<repère>`). Le téléphone n'en a pas : sa feuille est déjà pleine hauteur.
 *
 * LA FENÊTRE DES OUTILS DE CRÉATION (`sansMenuDuService`, décision du 13/11/2026 : « je veux pas cette liste, les outils
 * sont relatifs au projet depuis lequel on les ouvre ») : son menu de gauche ne porte QUE les quatre outils (`avant`) ;
 * le service n'y pose pas le sien et garde sa navigation dans sa page, restreinte au projet.
 */
import * as React from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Maximize2, Minimize2 } from '@/components/ui/icones';
import { ChevronDesOptions, useMenuDuService } from '@/components/bande-de-zone';
import { FournirLaColonneDeService } from '@/components/colonne-de-service';
import {
  FournirLaCibleDesGestes,
  FournirLaCibleDuPrincipalDeFeuille,
  FournirLaCibleDuPrincipalOrdinateur,
  FournirLeCoinDeFeuille,
  useSuiteDuFilFournie,
  FournirLaSuiteDuFil,
  FournirLeRegistreDuCoin,
  creerLeRegistreDuMenuDuHaut,
} from '@/components/entete-de-zone';
import {
  CadreDesPagesDeFenetre,
  DansUneFenetreDeService,
  DansUnePageDeService,
  Dialog,
  EmplacementsDeLaPage as EmplacementsDeLaPage_,
  type EmplacementsDeLaPageDeService,
  DialogContentLibre,
  DialogHeader,
  DialogTitle,
  Drawer,
  EnteteDeFeuille,
  EnteteDePageParDefaut,
  OmbreDeTete,
  type ProprietesDEnteteDePage,
  ZoneDefilement,
  buttonVariants,
} from '@/components/ui';
import { RechercheEnIcone } from '@/components/ui/recherche-en-icone';
import { t } from '@/lib/langue';
import { usePref } from '@/lib/prefs';
import { useTelephone } from '@/lib/telephone';
import { cn } from '@/lib/utils';

const sansNiveau = () => undefined;

/** La fenêtre est-elle agrandie ? Retenu par fenêtre, en base (`fenetre-agrandie:<repère>`). */
export function useFenetreAgrandie(repere: string): [boolean, () => void] {
  const [agrandie, ecrire] = usePref<boolean>(`fenetre-agrandie:${repere}`, false);
  return [agrandie, () => ecrire(!agrandie)];
}

/** Les classes d'une grande fenêtre agrandie : tout l'écran, à la marge de l'enveloppe près. */
export const CLASSE_FENETRE_AGRANDIE = 'sm:w-full sm:h-[calc(100dvh-2rem)] sm:max-h-none max-h-none';

/** Le bouton agrandir / réduire, posé juste à gauche de la croix (`DialogHeader droite`). */
export function BoutonAgrandirLaFenetre({ agrandie, onBasculer }: { agrandie: boolean; onBasculer: () => void }) {
  return (
    <button
      type="button"
      onClick={onBasculer}
      title={agrandie ? t('Réduire') : t('Agrandir')}
      aria-label={agrandie ? 'Réduire' : 'Agrandir'}
      aria-pressed={agrandie}
      data-fenetre-agrandir={agrandie ? 'agrandie' : 'normale'}
      className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'h-7 w-7 shrink-0 text-faint hover:text-text max-sm:hidden')}
    >
      {agrandie ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
    </button>
  );
}

export function FenetreDeService({
  open,
  onClose,
  titre,
  icone,
  repere,
  large = false,
  avant,
  sansMenuDuService = false,
  enPage = false,
  droiteDeLaPage,
  filDeLaPage,
  sousPage,
  children,
}: {
  /** Les premiers crans du fil d'une page de service (portée ⌄, service ⌄), posés par l'application. */
  filDeLaPage?: React.ReactNode;
  /** La page montre un OBJET du service (une campagne, une création) : le fil « Service / … » remplace le titre. Absent :
   *  le service le dit en écrivant la suite du fil. */
  sousPage?: boolean;
  /**
   * LE SERVICE EST UNE PAGE (décision de l'utilisateur du 14/11/2026, carte « Onglets, services et listes repensés »,
   * façon Claude Desktop) : sur ordinateur, plus de fenêtre par-dessus l'écran, mais une PAGE posée sur toute la zone
   * centrale, à droite de la colonne — aucun bandeau en haut, le grand titre collé en haut, puis UNE rangée : les
   * rubriques du service à gauche (`RubriquesDePage`), le filtre des projets et les gestes à droite, tous à la même
   * hauteur. Dans une SOUS-PAGE (le service a écrit la suite du fil : une campagne, un site), le fil
   * « Service / sous-page » revient en haut à la place du titre. Le téléphone garde la feuille du bas.
   */
  enPage?: boolean;
  /** Ce qui se pose à droite de la rangée de la page, avant les gestes du service : le filtre des projets. */
  droiteDeLaPage?: React.ReactNode;
  open: boolean;
  onClose: () => void;
  titre: string;
  icone: React.ReactNode;
  /** Le repère de la fenêtre (`data-fenetre-de-service`). */
  repere: string;
  /** Une fenêtre plus large (le coffre et ses colonnes). */
  large?: boolean;
  /** Des lignes posées en tête du menu de gauche, avant celui du service (le choix du service de création). */
  avant?: React.ReactNode;
  /** Le service ne pose pas son menu à gauche : il garde sa navigation dans sa page. */
  sansMenuDuService?: boolean;
  children: React.ReactNode;
}) {
  const telephone = useTelephone();
  const [corps, setCorps] = React.useState<HTMLElement | null>(null);
  const [cible, setCible] = React.useState<HTMLElement | null>(null);
  const [bas, setBas] = React.useState<HTMLElement | null>(null);
  /* La partie droite : une page ouverte depuis l'outil (la fiche d'un site…) s'y pose, devant lui. */
  const [cadreDesPages, setCadreDesPages] = React.useState<HTMLElement | null>(null);
  const registre = React.useMemo(() => creerLeRegistreDuMenuDuHaut(), []);
  const coin = React.useMemo(() => ({ registre, cible }), [registre, cible]);
  const colonne = React.useMemo(
    () => (sansMenuDuService ? { corps: null, definirNiveau: sansNiveau, absente: true } : { corps, definirNiveau: sansNiveau }),
    [corps, sansMenuDuService],
  );
  const { lieux, gestes } = useMenuDuService(corps);
  const [agrandie, basculerAgrandie] = useFenetreAgrandie(repere);

  if (!telephone && enPage) {
    return open ? (
      <PageDeService repere={repere} titre={titre} fil={filDeLaPage} droite={droiteDeLaPage} sousPageImposee={sousPage}>
        {children}
      </PageDeService>
    ) : null;
  }

  if (telephone && enPage) {
    /* LES DIX SERVICES SUR TÉLÉPHONE : leur feuille à une seule rangée, sans bande d'outils (`avant` n'y paraît plus). */
    return (
      <FeuilleDeService open={open} onClose={onClose} titre={titre} icone={icone} repere={repere} filtre={droiteDeLaPage}>
        {children}
      </FeuilleDeService>
    );
  }

  if (telephone) {
    /* COFFRE-FORT ET MÉMOIRE SUR TÉLÉPHONE : la MÊME feuille que les dix services (23/11/2026). Sans cible de gestes,
       leurs options (« Nouveau dossier », « Archives ») et leur geste principal (« Nouvel accès ») se posaient en
       rangées de boutons sous le titre ; ils vont désormais au menu « … » de l'entête et en bas, pleine largeur. */
    return (
      <FeuilleDeService open={open} onClose={onClose} titre={titre} icone={icone} repere={repere}>
        {children}
      </FeuilleDeService>
    );
  }

  const avecMenu = !!avant || lieux.length > 0;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContentLibre
        className={cn('h-[min(800px,90dvh)]', large ? 'sm:w-[min(1400px,100%)]' : 'sm:w-[min(1160px,100%)]', agrandie && CLASSE_FENETRE_AGRANDIE)}
        data-fenetre-de-service={repere}
        data-fenetre-de-service-forme="fenetre"
        data-fenetre-agrandie={agrandie ? '' : undefined}
        /* À l'ouverture, aucun bouton ne prend le focus (la croix s'entourait d'un anneau sans qu'on l'ait touchée). */
        onOpenAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          /* Un menu, une fiche ou une visionneuse ouverts PAR-DESSUS ne sont pas « dehors ». */
          const cibleDuClic = event.target as HTMLElement | null;
          if (cibleDuClic?.closest('[role="dialog"], [data-radix-popper-content-wrapper]')) event.preventDefault();
        }}
      >
        <DialogHeader className="border-b border-border pb-2.5" droite={<BoutonAgrandirLaFenetre agrandie={agrandie} onBasculer={basculerAgrandie} />}>
          <DialogTitle className="flex min-w-0 items-center gap-2">
            <span className="flex shrink-0 text-muted [&>svg]:h-4 [&>svg]:w-4">{icone}</span>
            <span className="truncate">{titre}</span>
          </DialogTitle>
        </DialogHeader>
        <DansUneFenetreDeService.Provider value>
          <CadreDesPagesDeFenetre.Provider value={cadreDesPages}>
          <FournirLaSuiteDuFil value={null}>
            <FournirLaColonneDeService value={colonne}>
              <FournirLaCibleDesGestes value={cible}>
                <FournirLeRegistreDuCoin value={coin}>
                  <FournirLaCibleDuPrincipalOrdinateur value={bas}>
                    <div className="flex min-h-0 flex-1">
                      {/* LE MENU DE GAUCHE : celui du service, sans ses gestes. Toujours monté (le service y écrit). */}
                      <nav
                        className={cn('flex min-h-0 w-[232px] shrink-0 flex-col bg-surface', !avecMenu && 'hidden')}
                        data-menu-de-fenetre={repere}
                      >
                        <ZoneDefilement fond="hsl(var(--surface))" classeEnveloppe="min-h-0 flex-1" className="px-2 py-2">
                          {avant ? <div className="flex flex-col gap-0.5 pb-1">{avant}</div> : null}
                          <div ref={setCorps} className="liste-de-service flex flex-col gap-0.5" />
                        </ZoneDefilement>
                      </nav>
                      <div ref={setCadreDesPages} className="relative flex min-h-0 min-w-0 flex-1 flex-col">
                        {/* LE COIN HAUT DROIT : les gestes de la page, puis le chevron de ses options. */}
                        <div className="absolute right-4 top-3 z-10 flex items-center gap-1.5" data-coin-de-fenetre>
                          <div ref={setCible} data-gestes-de-page="barre" data-rangee-de-boutons className="flex shrink-0 items-center gap-1.5 empty:hidden" />
                          <ChevronDesOptions registre={registre} gestes={gestes} cibleDuBas={bas} />
                        </div>
                        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
                        <div ref={setBas} className="shrink-0 px-5 pb-4 pt-2 empty:hidden" data-geste-en-bas="fenetre" />
                      </div>
                    </div>
                  </FournirLaCibleDuPrincipalOrdinateur>
                </FournirLeRegistreDuCoin>
              </FournirLaCibleDesGestes>
            </FournirLaColonneDeService>
          </FournirLaSuiteDuFil>
          </CadreDesPagesDeFenetre.Provider>
        </DansUneFenetreDeService.Provider>
      </DialogContentLibre>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* La page d'un service, façon Claude Desktop                           */
/* ------------------------------------------------------------------ */

/**
 * LA COLONNE COMMUNE DES DIX SERVICES (carte « Services homogènes et centrés », 14/11/2026) : la tête, le corps et le
 * pied d'une page de service ont EXACTEMENT les mêmes bords — 1 200 px marges comprises, centrés dans la zone. Aucun
 * service ne pose plus sa propre largeur (Studio décalé à 980 px, Marketing à 720, Messagerie à 756, Charte collée au
 * bord : c'est ce que l'utilisateur a refusé).
 */
export const CLASSE_COLONNE_DE_SERVICE = 'mx-auto w-full max-w-[max(1200px,80%)] px-10';
/*
 * …ÉLARGIE À 80 % DU PANNEAU (15/11/2026, « le contenu des services va jusqu'à 80 % du panneau principal ») : sur un
 * grand écran, la colonne ne reste plus coincée à 1 200 px au milieu d'un panneau deux fois plus large. Elle ne
 * descend jamais sous 1 200 px (marges comprises) tant que la place existe. Les conversations gardent leur propre
 * largeur de lecture : elles se centrent dans cette colonne.
 */

/**
 * LES EMPLACEMENTS DE LA RANGÉE D'UNE PAGE DE SERVICE, dans l'ordre où ils se lisent à droite du titre : les onglets
 * du service, sa recherche, la bascule lignes / cartes, (le filtre des projets, posé par l'application), ses réglages
 * propres (le mois du calendrier, la période de la messagerie), puis le menu d'options. Sur téléphone, la feuille du
 * service porte la MÊME rangée, sous son titre : un service écrit une fois, pour les deux tailles.
 */
type EmplacementsDeLaPage = EmplacementsDeLaPageDeService;
const Emplacements = EmplacementsDeLaPage_;

function versLEmplacement(cle: keyof EmplacementsDeLaPage) {
  return function DansLEmplacement({ children }: { children: React.ReactNode }) {
    const emplacements = React.useContext(Emplacements);
    /* La page est montée mais son emplacement pas encore : rien ce tour-ci, plutôt qu'un contrôle posé en double. */
    if (emplacements) return emplacements[cle] ? createPortal(children, emplacements[cle]!) : null;
    return <>{children}</>;
  };
}

/** LES RUBRIQUES D'UN SERVICE (sa `BarreDOnglets`) : à droite du titre, en tête de la rangée. */
export const RubriquesDePage = versLEmplacement('rubriques');
/** La recherche du service, dans la rangée (voir `RechercheDuService`). */
const RechercheDansLaRangee = versLEmplacement('recherche');
/** La bascule lignes / cartes du service, dans la rangée. */
export const BasculeDePage = versLEmplacement('bascule');
/** Les réglages propres au service (le mois du calendrier, la période), après le filtre des projets. */
export const DroiteDePage = versLEmplacement('droite');
/**
 * LA LIGNE D'INFORMATIONS SOUS LE TITRE (carte « Sécurité, rapports et marketing restructurés », 22/11/2026, maquette
 * #1173) : ce que la page montre, en petit — pour un projet des Statistiques, son adresse, depuis quand il est suivi et
 * la fraîcheur des données. Sans elle, le titre reste seul.
 */
export const InfosDePage = versLEmplacement('infos');

/**
 * L'EMPLACEMENT DES OUTILS D'UN TABLEAU (son bouton filtre, sa recherche s'il la porte) dans la rangée de la page :
 * juste après la recherche du service. `undefined` hors d'une page de service, `null` tant qu'il n'est pas monté.
 */
export function useEmplacementDesOutils(): HTMLElement | null | undefined {
  const emplacements = React.useContext(Emplacements);
  return emplacements ? emplacements.recherche : undefined;
}

/** Vrai quand le service est rendu dans une page de service (ordinateur) ou sa feuille (téléphone). */
export const useDansUnePageDeService = () => React.useContext(Emplacements) !== null;

/**
 * LA RECHERCHE D'UN SERVICE, TOUJOURS AU MÊME ENDROIT : un champ de 220 px dans la rangée de la page sur ordinateur, une
 * loupe qui s'ouvre sur place dans la rangée de la feuille sur téléphone. Hors d'une page de service, le champ reste
 * où le service le pose. Le service garde son texte ; le tableau le reçoit par `rechercheExterne`.
 */
export function RechercheDuService({
  valeur,
  onChange,
  placeholder,
  ...reperes
}: {
  valeur: string;
  onChange: (v: string) => void;
  placeholder?: string;
} & Record<`data-${string}`, string | number | boolean | undefined>) {
  const telephone = useTelephone();
  /* UNE LOUPE, SUR LES DEUX TAILLES (22/11/2026, « la recherche se réduit à une loupe qui ouvre le champ ») : un clic
     ouvre le champ sur place ; vide, il se referme par Échap ou un clic ailleurs ; une recherche en cours le garde ouvert. */
  return (
    <RechercheDansLaRangee>
      <RechercheEnIcone valeur={valeur} onChange={onChange} placeholder={placeholder} largeur={telephone ? 'w-40' : 'w-[220px]'} {...reperes} />
    </RechercheDansLaRangee>
  );
}

/**
 * HORS DE LA RANGÉE DU TITRE : un tableau posé sous un grand titre de page (les publications en attente des « Tableaux
 * de bord », la facturation d'un projet) garde ses outils au-dessus de lui au lieu de les monter à côté du titre.
 */
export function HorsDeLaRangeeDeLaPage({ children }: { children: React.ReactNode }) {
  return <Emplacements.Provider value={null}>{children}</Emplacements.Provider>;
}

/**
 * LA TÊTE D'UNE PAGE RESTE EN HAUT ET SON TITRE RAPETISSE (demande du 17/11/2026, capture #def0f : « la partie haute
 * avec titre et options doit devenir sticky au scroll, le titre doit juste se réduire »). Une seule règle pour la page
 * de service (`PageDeService`) et la page à grand titre (`PageAGrandTitre`) : la tête porte `data-tete-collante`, la
 * feuille de style la colle (`position: sticky`, fond de son conteneur) sur ordinateur, et ce crochet pose
 * `data-tete-reduite` DIRECTEMENT sur le DOM dès que la zone qui la porte a défilé — aucun rendu React par cran.
 *
 * PAS DE SAUT NI D'OSCILLATION AU SEUIL : réduite, la tête perd de la hauteur mais rend exactement la même place en marge
 * basse (`--gain-de-tete`) ; le contenu ne bouge pas d'un pixel, la course de défilement non plus, et le seuil ne peut
 * pas se franchir dans l'autre sens tout seul.
 */
const SEUIL_TETE_REDUITE = 4;
function useTeteReduite() {
  const ref = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const tete = ref.current;
    if (!tete) return;
    let zone: HTMLElement | null = tete.parentElement;
    while (zone && !/(auto|scroll)/.test(getComputedStyle(zone).overflowY)) zone = zone.parentElement;
    if (!zone) return;
    const lire = () => {
      if (zone.scrollTop > SEUIL_TETE_REDUITE) tete.setAttribute('data-tete-reduite', '');
      else tete.removeAttribute('data-tete-reduite');
    };
    lire();
    zone.addEventListener('scroll', lire, { passive: true });
    return () => zone.removeEventListener('scroll', lire);
  }, []);
  return ref;
}

/**
 * LE GRAND TITRE D'UNE PAGE DE LA ZONE, COMME CELUI D'UNE PAGE DE SERVICE (décision de l'utilisateur du 16/11/2026,
 * captures #8891, #4f41 et #56359 : « Tableaux de bord » et l'accueil d'un projet « doivent correspondre aux pages
 * service, avec le grand titre et les options à droite en liste horizontale »). La MÊME rangée que `PageDeService` :
 * le titre à 30 px à gauche ; à droite, sur la même ligne, la recherche et le filtre du tableau de la page
 * (`useEmplacementDesOutils`), ses réglages (`DroiteDePage`, la période), ses gestes (`GestesDePage`) et le chevron de
 * ses options (`OptionsDePage`) — la bande du coin de la zone, vide, ne prend alors plus aucune place.
 *
 * La page pose ce titre DANS sa zone qui défile : il part avec le contenu, et la liste remonte jusqu'au bandeau. Ce qui
 * ne doit pas monter dans la rangée s'enveloppe de `HorsDeLaRangeeDeLaPage`. Ordinateur seulement : le téléphone garde
 * son haut à lui.
 */
export function PageAGrandTitre({ titre, repere, children }: { titre: string; repere: string; children: React.ReactNode }) {
  const [emplacements, definir] = useEmplacements();
  const [cible, setCible] = React.useState<HTMLElement | null>(null);
  const registre = React.useMemo(() => creerLeRegistreDuMenuDuHaut(), []);
  const coin = React.useMemo(() => ({ registre, cible }), [registre, cible]);
  const rubriques = React.useCallback((el: HTMLElement | null) => definir('rubriques', el), [definir]);
  const recherche = React.useCallback((el: HTMLElement | null) => definir('recherche', el), [definir]);
  const bascule = React.useCallback((el: HTMLElement | null) => definir('bascule', el), [definir]);
  const droite = React.useCallback((el: HTMLElement | null) => definir('droite', el), [definir]);
  const tete = useTeteReduite();
  return (
    <>
      <div
        ref={tete}
        className="flex shrink-0 items-center gap-3 pb-5 pt-7 [--gain-de-tete:32px]"
        data-tete-de-page-a-grand-titre={repere}
        data-tete-collante
      >
        <OmbreDeTete className="inset-x-0" />
        <h1
          className="min-w-0 shrink-0 truncate text-[30px] font-semibold leading-9 tracking-tight text-text"
          data-titre-de-page={repere}
          data-titre-collant
        >
          {titre}
        </h1>
        <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-3" data-rangee-de-l-entete={repere}>
          <div ref={rubriques} className="flex min-w-0 shrink-0 items-center empty:hidden" data-rubriques-de-la-page />
          <div className="flex min-w-0 shrink items-center gap-2">
            <div ref={recherche} className="flex min-w-[140px] shrink items-center gap-2 empty:hidden" data-recherche-de-la-page />
            <div ref={bascule} className="flex shrink-0 items-center gap-2 empty:hidden" data-bascule-de-la-page />
          </div>
          <div ref={droite} className="flex shrink-0 items-center gap-2 empty:hidden" data-droite-du-service />
          <div ref={setCible} data-gestes-de-page="rangee-de-service" data-rangee-de-boutons className="flex shrink-0 items-center gap-2 empty:hidden" />
          <ChevronDesOptions registre={registre} gestes={[]} cibleDuBas={null} />
        </div>
      </div>
      <Emplacements.Provider value={emplacements}>
        <FournirLaCibleDesGestes value={cible}>
          <FournirLeRegistreDuCoin value={coin}>{children}</FournirLeRegistreDuCoin>
        </FournirLaCibleDesGestes>
      </Emplacements.Provider>
    </>
  );
}

/** La rangée des emplacements : les contrôles d'une page de service, tous à la hauteur commune. */
function RangeeDesEmplacements({
  filtre,
  definir,
  cibleDesGestes,
  chevron,
  telephone = false,
  sousPage = false,
}: {
  /** Une sous-page est ouverte : les outils de la LISTE (rubriques, recherche, bascule) s'effacent — ils restent
   *  montés, le service y écrit. */
  sousPage?: boolean;
  filtre?: React.ReactNode;
  definir: (cle: keyof EmplacementsDeLaPage, el: HTMLElement | null) => void;
  cibleDesGestes: (el: HTMLElement | null) => void;
  chevron: React.ReactNode;
  telephone?: boolean;
}) {
  const rubriques = React.useCallback((el: HTMLElement | null) => definir('rubriques', el), [definir]);
  const recherche = React.useCallback((el: HTMLElement | null) => definir('recherche', el), [definir]);
  const bascule = React.useCallback((el: HTMLElement | null) => definir('bascule', el), [definir]);
  const droite = React.useCallback((el: HTMLElement | null) => definir('droite', el), [definir]);
  return (
    <div
      /* SUR ORDINATEUR, LA RANGÉE PREND LA PLACE QUE LE TITRE LAISSE, collée à droite : c'est la recherche qui
         rétrécit quand la place manque, jamais le titre ni un contrôle. */
      className={cn('flex min-w-0 items-center gap-2', telephone ? 'w-full' : 'ml-auto flex-1 justify-end')}
      data-rangee-de-la-page
      data-rangee-forme={telephone ? 'feuille' : 'page'}
    >
      <div ref={rubriques} className={cn('flex min-w-0 shrink-0 items-center empty:hidden', sousPage && 'hidden')} data-rubriques-de-la-page />
      {/* Sur téléphone, le filtre des projets prend la place qui reste : il ouvre la rangée. Sans lui, un vide pousse
          le reste à droite. */}
      {telephone ? (
        filtre ? (
          <div className="flex min-w-0 flex-1 [&>*]:w-full" data-filtre-de-la-rangee>
            {filtre}
          </div>
        ) : (
          <span className="min-w-0 flex-1" aria-hidden />
        )
      ) : null}
      <div ref={recherche} className={cn('flex items-center empty:hidden', telephone ? 'shrink-0' : 'min-w-[140px] shrink', sousPage && 'hidden')} data-recherche-de-la-page />
      <div ref={bascule} className={cn('flex shrink-0 items-center empty:hidden', sousPage && 'hidden')} data-bascule-de-la-page />
      {!telephone && filtre ? <div className="flex shrink-0" data-filtre-de-la-rangee>{filtre}</div> : null}
      <div ref={droite} className="flex shrink-0 items-center gap-2 empty:hidden" data-droite-du-service />
      <div ref={cibleDesGestes} data-gestes-de-page="rangee-de-service" data-rangee-de-boutons className="flex shrink-0 items-center gap-2 empty:hidden" />
      {chevron}
    </div>
  );
}

function useEmplacements(): [EmplacementsDeLaPage, (cle: keyof EmplacementsDeLaPage, el: HTMLElement | null) => void] {
  const [emplacements, setEmplacements] = React.useState<EmplacementsDeLaPage>({ rubriques: null, recherche: null, bascule: null, droite: null, infos: null });
  const definir = React.useCallback(
    (cle: keyof EmplacementsDeLaPage, el: HTMLElement | null) => setEmplacements((avant) => (avant[cle] === el ? avant : { ...avant, [cle]: el })),
    [],
  );
  return [emplacements, definir];
}

/**
 * LE GESTE DE L'EN-TÊTE DE LA FEUILLE (téléphone, 22/11/2026, maquette #ccad) : une sous-page ouverte dans la feuille
 * d'un service peut poser UN bouton icône à droite du titre de la feuille (« Lancer un audit » de Sécurité). Hors d'une
 * feuille de service, rien n'est posé : la page garde son geste chez elle.
 */
const CibleDuGesteDeLEntete = React.createContext<HTMLElement | null | undefined>(undefined);
export function useDansUneFeuilleDeService(): boolean {
  return React.useContext(CibleDuGesteDeLEntete) !== undefined;
}
export function GesteDeLEnteteDeFeuille({ children }: { children: React.ReactNode }) {
  const cible = React.useContext(CibleDuGesteDeLEntete);
  return cible ? createPortal(children, cible) : null;
}

/**
 * LA FEUILLE D'UN SERVICE SUR TÉLÉPHONE (carte « Services homogènes et centrés », captures #b253 et #f0c5) : le titre
 * de la feuille, puis UNE SEULE rangée — le filtre des projets, la recherche en loupe, la bascule, les réglages du
 * service et le menu d'options. Plus aucune bande d'outils qui défile de côté : on passe d'un service à l'autre par le
 * menu principal, ligne « Services ». Le geste de création descend en bas, pleine largeur.
 */
function FeuilleDeService({
  open,
  onClose,
  titre,
  icone,
  repere,
  filtre,
  children,
}: {
  open: boolean;
  onClose: () => void;
  titre: string;
  icone: React.ReactNode;
  repere: string;
  filtre?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [emplacements, definir] = useEmplacements();
  const [cible, setCible] = React.useState<HTMLElement | null>(null);
  const [bas, setBas] = React.useState<HTMLElement | null>(null);
  const registre = React.useMemo(() => creerLeRegistreDuMenuDuHaut(), []);
  const coin = React.useMemo(() => ({ registre, cible }), [registre, cible]);
  /*
   * UNE SOUS-PAGE OUVERTE DANS LA FEUILLE (le détail d'un site, d'une campagne) : le service le dit en écrivant la
   * suite du fil ; la rangée pose alors une flèche qui remonte d'un cran, et le filtre des projets s'efface (il ne
   * vaut que pour la liste).
   */
  const parent = useSuiteDuFilFournie();
  const [sousPage, setSousPage] = React.useState(false);
  const retour = React.useRef<(() => void) | null>(null);
  const signalerParent = parent?.signaler;
  const suite = React.useMemo(
    () => ({
      ...(parent ?? {}),
      cible: null,
      retour,
      signaler: (presente: boolean) => {
        setSousPage(presente);
        signalerParent?.(presente);
      },
    }),
    [parent, signalerParent],
  );
  const [cibleDuGeste, setCibleDuGeste] = React.useState<HTMLElement | null>(null);
  /*
   * LE RETOUR VIT DANS L'EN-TÊTE (22/11/2026, capture #7ae7 : « les boutons back doivent être dans l'entête ») : dans une
   * sous-page, la flèche prend la place de l'icône du service, à gauche du titre. La rangée dessous ne paraît que si elle
   * porte quelque chose (filtre, rubriques, recherche, gestes, menu) — plus de ligne qui ne tenait que la flèche
   * (styles.css, `[data-tete-de-la-feuille-de-service]`).
   */
  const gauche = sousPage ? (
    <button
      type="button"
      onClick={() => retour.current?.()}
      className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-fond-survol hover:text-text"
      aria-label="Revenir à la liste"
      title={t('Revenir à la liste')}
      data-retour-de-la-feuille
    >
      <ArrowLeft className="h-4 w-4" />
    </button>
  ) : (
    <span className="ml-1 flex shrink-0 text-muted [&>svg]:h-4 [&>svg]:w-4">{icone}</span>
  );
  return (
    <Drawer feuille hauteurFixe open={open} onClose={onClose}>
      {/* LE MENU DES OPTIONS VIT DANS L'ENTÊTE, à droite du titre (23/11/2026, « les boutons dans l'entête ») : seul dans
          la rangée dessous, il y faisait une ligne d'un bouton sous le titre (Communication). La rangée ne garde que les
          contrôles de la page (filtre, rubriques, recherche, bascule, gestes) et disparaît quand elle n'en a aucun. */}
      <EnteteDeFeuille
        titre={titre}
        gauche={gauche}
        droite={
          <>
            <span ref={setCibleDuGeste} className="flex shrink-0 items-center gap-1 empty:hidden" data-geste-de-l-entete-de-feuille />
            <ChevronDesOptions registre={registre} gestes={[]} cibleDuBas={bas} />
          </>
        }
      />
      <div className="shrink-0 px-4 pb-3" data-tete-de-la-feuille-de-service>
        <RangeeDesEmplacements
          telephone
          sousPage={sousPage}
          filtre={sousPage ? undefined : filtre}
          definir={definir}
          cibleDesGestes={setCible}
          chevron={null}
        />
      </div>
      <DansUneFenetreDeService.Provider value>
        <CibleDuGesteDeLEntete.Provider value={cibleDuGeste}>
        <Emplacements.Provider value={emplacements}>
          <FournirLaSuiteDuFil value={suite}>
          <FournirLaCibleDesGestes value={cible}>
            <FournirLeRegistreDuCoin value={coin}>
              <FournirLeCoinDeFeuille value>
                <FournirLaCibleDuPrincipalDeFeuille value={bas}>
                  <div className="flex min-h-0 flex-1 flex-col" data-fenetre-de-service={repere} data-fenetre-de-service-forme="feuille">
                    {children}
                  </div>
                </FournirLaCibleDuPrincipalDeFeuille>
              </FournirLeCoinDeFeuille>
            </FournirLeRegistreDuCoin>
          </FournirLaCibleDesGestes>
          </FournirLaSuiteDuFil>
        </Emplacements.Provider>
        </CibleDuGesteDeLEntete.Provider>
      </DansUneFenetreDeService.Provider>
      <div ref={setBas} className="shrink-0 px-4 pb-3 pt-2 empty:hidden" data-geste-en-bas="feuille" />
    </Drawer>
  );
}

/**
 * LA SOUS-PAGE OUVERTE PAR-DESSUS UN SERVICE (la fiche d'un site sauvegardé ou surveillé, une tâche récurrente…) N'A
 * PLUS DE BARRE À ELLE (14/11/2026, « une seule barre ») : son titre devient le dernier cran du fil de la page, ses
 * gestes rejoignent la droite de la barre, et le service bascule en sous-page (la rangée de sa liste s'efface — c'est
 * elle qui restait affichée, et la bascule de Backup « ne faisait rien »). Le nom du service, dans le fil, la referme.
 */
const CiblesDeLaSousPage = React.createContext<{ fil: HTMLElement | null; gestes: HTMLElement | null } | null>(null);
function EnteteDansLaPageDeService({ fermer, onCibleDuTitre, onCibleDesGestes }: ProprietesDEnteteDePage) {
  const cibles = React.useContext(CiblesDeLaSousPage);
  const suite = useSuiteDuFilFournie();
  const signaler = suite?.signaler;
  const retour = suite?.retour;
  const fermerRef = React.useRef(fermer);
  fermerRef.current = fermer;
  React.useEffect(() => {
    signaler?.(true);
    const avant = retour?.current ?? null;
    if (retour) retour.current = () => fermerRef.current();
    return () => {
      signaler?.(false);
      if (retour) retour.current = avant;
    };
  }, [signaler, retour]);
  const [titre, setTitre] = React.useState<HTMLElement | null>(null);
  const [gestes, setGestes] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => onCibleDuTitre(titre), [titre, onCibleDuTitre]);
  React.useEffect(() => onCibleDesGestes(gestes), [gestes, onCibleDesGestes]);
  return (
    <>
      {cibles?.fil
        ? createPortal(
            <>
              <span className="shrink-0 text-faint" aria-hidden data-separateur-du-fil>
                /
              </span>
              <span ref={setTitre} className="flex min-w-0 items-center truncate font-medium text-text" data-titre-de-la-sous-page />
            </>,
            cibles.fil,
          )
        : null}
      {cibles?.gestes ? createPortal(<span ref={setGestes} className="contents" data-gestes-de-la-sous-page />, cibles.gestes) : null}
    </>
  );
}

/**
 * LE TITRE D'UNE SOUS-PAGE, LU DANS LE FIL (22/11/2026) : le dernier cran (le titre posé par la page ouverte, sinon le
 * dernier `CranDuFil` écrit par le service). Relu à chaque changement du fil, sans rendu par cran de défilement.
 */
function useTitreDuDernierCran(nav: HTMLElement | null, actif: boolean): string {
  const [titre, setTitre] = React.useState('');
  React.useEffect(() => {
    if (!nav || !actif) {
      setTitre('');
      return;
    }
    const lire = () => {
      /* Le texte qui suit le DERNIER séparateur « / » : le cran de la sous-page, quelle que soit sa forme (simple
         cran, sélecteur de site à menu, titre posé par la page ouverte). Une précision discrète (`sousTitre`) en est
         écartée : elle n'est pas le nom. */
      const separateurs = nav.querySelectorAll('[data-separateur-du-fil]');
      const dernier = separateurs[separateurs.length - 1];
      if (!dernier) return setTitre('');
      const plage = document.createRange();
      plage.setStartAfter(dernier);
      plage.setEnd(nav, nav.childNodes.length);
      const fragment = plage.cloneContents();
      fragment.querySelectorAll('.text-faint, [aria-hidden], svg').forEach((n) => n.remove());
      setTitre((fragment.textContent ?? '').replace(/\s+/g, ' ').trim());
    };
    lire();
    const observateur = new MutationObserver(lire);
    observateur.observe(nav, { subtree: true, childList: true, characterData: true });
    return () => observateur.disconnect();
  }, [nav, actif]);
  return titre;
}

/**
 * PAS DE LIGNE DE TITRE AU-DESSUS D'UNE CONVERSATION + VOLET (22/11/2026, retour de l'utilisateur : « pas besoin de
 * mettre des titres dans les services qui ont un chat à gauche et un volet à droite »). La ligne du titre ne vaut que
 * pour les pages de liste ou de tableau. Une vue « conversation à gauche, volet à droite » (Sécurité d'un projet, dossier
 * Marketing, campagne, charte, création du Studio) le dit par `useSansLigneDeTitre()` : la page cache sa ligne du titre,
 * colle le corps sous la barre du fil et reporte ses gestes et son menu « … » à droite de cette barre. Le signal part
 * d'un effet de mise en page : la ligne ne paraît jamais pour disparaître ensuite.
 */
const SignalSansLigneDeTitre = React.createContext<((present: boolean) => void) | null>(null);
export function useSansLigneDeTitre(actif = true): void {
  const signaler = React.useContext(SignalSansLigneDeTitre);
  React.useLayoutEffect(() => {
    if (!actif || !signaler) return;
    signaler(true);
    return () => signaler(false);
  }, [actif, signaler]);
}

function PageDeService({
  repere,
  titre,
  fil,
  droite,
  sousPageImposee,
  children,
}: {
  repere: string;
  titre: string;
  /** Les premiers crans du fil (la portée ⌄, puis le service ⌄), posés par l'application. */
  fil?: React.ReactNode;
  droite?: React.ReactNode;
  sousPageImposee?: boolean;
  children: React.ReactNode;
}) {
  const [cible, setCible] = React.useState<HTMLElement | null>(null);
  const [bas, setBas] = React.useState<HTMLElement | null>(null);
  const [emplacements, definir] = useEmplacements();
  const [cibleDuFil, setCibleDuFil] = React.useState<HTMLElement | null>(null);
  const [filDeLaSousPage, setFilDeLaSousPage] = React.useState<HTMLElement | null>(null);
  const [gestesDeLaSousPage, setGestesDeLaSousPage] = React.useState<HTMLElement | null>(null);
  const [cadreDesPages, setCadreDesPages] = React.useState<HTMLElement | null>(null);
  const [suitesEcrites, setSuitesEcrites] = React.useState(0);
  const signaler = React.useCallback((presente: boolean) => setSuitesEcrites((n) => Math.max(0, n + (presente ? 1 : -1))), []);
  const sousPage = sousPageImposee ?? suitesEcrites > 0;
  const retour = React.useRef<(() => void) | null>(null);
  const registre = React.useMemo(() => creerLeRegistreDuMenuDuHaut(), []);
  const coin = React.useMemo(() => ({ registre, cible }), [registre, cible]);
  const colonne = React.useMemo(() => ({ corps: null, definirNiveau: sansNiveau, absente: true }), []);
  const suite = React.useMemo(() => ({ cible: cibleDuFil, retour, signaler }), [cibleDuFil, signaler]);
  const ciblesDeLaSousPage = React.useMemo(() => ({ fil: filDeLaSousPage, gestes: gestesDeLaSousPage }), [filDeLaSousPage, gestesDeLaSousPage]);
  const rubriques = React.useCallback((el: HTMLElement | null) => definir('rubriques', el), [definir]);
  const recherche = React.useCallback((el: HTMLElement | null) => definir('recherche', el), [definir]);
  const bascule = React.useCallback((el: HTMLElement | null) => definir('bascule', el), [definir]);
  const droiteDuService = React.useCallback((el: HTMLElement | null) => definir('droite', el), [definir]);
  const infos = React.useCallback((el: HTMLElement | null) => definir('infos', el), [definir]);
  const [navDuFil, setNavDuFil] = React.useState<HTMLElement | null>(null);
  const titreDeLaSousPage = useTitreDuDernierCran(navDuFil, sousPage);
  const tete = useTeteReduite();
  const [vuesSansTitre, setVuesSansTitre] = React.useState(0);
  const signalerSansTitre = React.useCallback((present: boolean) => setVuesSansTitre((n) => Math.max(0, n + (present ? 1 : -1))), []);
  const sansTitre = vuesSansTitre > 0;
  /* Les réglages du service, les gestes de la page et le menu « … » : sur la ligne du titre, ou — sans elle — à droite
     de la barre du fil, comme avant la ligne du titre. Un seul exemplaire monté, jamais deux. */
  const outilsDeDroite = (
    <>
      <div ref={droiteDuService} className="flex shrink-0 items-center gap-2 empty:hidden" data-droite-du-service />
      <div ref={setGestesDeLaSousPage} className="flex shrink-0 items-center gap-2 empty:hidden" data-gestes-de-page="sous-page" />
      <div ref={setCible} data-gestes-de-page="rangee-de-service" data-rangee-de-boutons className="flex shrink-0 items-center gap-2 empty:hidden" />
      <ChevronDesOptions registre={registre} gestes={[]} cibleDuBas={bas} enPoints />
    </>
  );
  const page = (
    <div
      /* Part sous la bande orange de l'extension (`--hauteur-banniere`, 0 sans elle) : elle reste au-dessus de tout. */
      className="fixed bottom-0 right-0 top-[var(--hauteur-banniere,0px)] z-30 flex flex-col bg-bg left-[var(--zone-principale-gauche,0px)]"
      data-page-de-service={repere}
      data-fenetre-de-service={repere}
      data-fenetre-de-service-forme="page"
      data-sous-page={sousPage ? '' : undefined}
    >
      {/*
        UNE SEULE BARRE EN TÊTE DE TOUTE PAGE DE SERVICE, ACCUEIL COMPRIS (14/11/2026, « le fil d'Ariane n'est pas bon, on
        n'a pas toutes les étapes en amont ») : la portée (un projet ou « Tous les projets ») ⌄, le service ⌄, puis les
        étapes que le service écrit (`SuiteDuFil`, `CranDuFil`) jusqu'à la page où l'on est. À droite : les réglages du
        service, les gestes de la page et le menu « … ». Plus jamais de second en-tête sous elle dans une sous-page.
      */}
      <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border px-5" data-barre-de-la-page-de-service>
        {/* LE BANDEAU NE GARDE QUE LE FIL D'ARIANE (22/11/2026, maquettes #1173 et #60a3) : réglages, gestes et menu « … »
            descendent sur la ligne du titre, au-dessus du contenu. */}
        <nav ref={setNavDuFil} aria-label="Fil d'Ariane" className="flex min-w-0 flex-1 items-center gap-1 text-[14px]" data-fil-de-la-page-de-service>
          {fil ? <FournirLaSuiteDuFil value={suite}>{fil}</FournirLaSuiteDuFil> : (
            <button
              type="button"
              className={cn('shrink-0 rounded-md px-1.5 py-1 transition-colors hover:text-text', sousPage ? 'text-muted' : 'font-medium text-text')}
              data-cran-du-service={repere}
              onClick={() => retour.current?.()}
            >
              {titre}
            </button>
          )}
          <div ref={setCibleDuFil} className="contents" data-suite-du-fil="page-de-service" />
          <div ref={setFilDeLaSousPage} className="contents" data-fil-de-la-sous-page />
        </nav>
        {sansTitre ? (
          <div className="flex shrink-0 items-center gap-2" data-outils-dans-la-barre>
            {outilsDeDroite}
          </div>
        ) : null}
      </div>
      {/*
        C'EST LE PANNEAU QUI DÉFILE, PLUS LA COLONNE (15/11/2026, « sur toutes les pages, c'est le panneau qui défile, barre
        à droite ») : sous la barre du fil, UNE zone pleine largeur porte le titre et le corps du service. La molette marche
        où que soit la souris, et la barre se pose au bord droit du panneau ; les listes du service s'étendent à leur
        hauteur au lieu de défiler dans leur colonne. Une vue qui a besoin de TOUTE la hauteur — une conversation, un
        atelier (montage, charte), un dossier à deux colonnes — garde sa hauteur bornée : elle le dit par
        `data-pleine-hauteur` (ou par le fil d'une conversation), et la règle `[data-contenu-de-la-page-de-service]` de
        styles.css borne alors le contenu à la zone.
      */}
      <ZoneDefilement
        classeEnveloppe="min-h-0 flex-1"
        className="flex flex-col"
        data-defilement-de-la-page-de-service={repere}
      >
      {/* `shrink-0` : sans lui, ce bloc — élément d'une colonne flexible — se tassait à la hauteur de la zone, et c'était
          encore la liste du service qui défilait dans sa colonne. */}
      <div className="flex min-h-full shrink-0 flex-col" data-contenu-de-la-page-de-service>
      {/* LA LIGNE DU TITRE, SUR TOUTES LES PAGES (22/11/2026) : le titre à gauche et ses informations dessous (pour un
          projet : son adresse, depuis quand il est suivi, la fraîcheur) ; à droite les rubriques, la loupe, la bascule,
          le filtre des projets, les réglages du service (périodes), les gestes et le menu « … ». Dans une sous-page, le
          titre devient celui de la sous-page (le dernier cran du fil) et les outils de la LISTE s'effacent — ils restent
          montés : le service y écrit. */}
      <div
        ref={tete}
        className={cn(CLASSE_COLONNE_DE_SERVICE, 'flex shrink-0 items-center gap-3 pt-7 [--gain-de-tete:12px]', sansTitre && 'hidden')}
        data-tete-de-la-page-de-service
        data-tete-collante
        data-sans-ligne-de-titre={sansTitre ? '' : undefined}
      >
        {/* L'ombre tient dans la colonne, sa marge intérieure exclue (`px-10` de la colonne). */}
        <OmbreDeTete className="inset-x-10" />
        <div className="flex min-w-0 shrink flex-col gap-0.5">
          <h1
            className="min-w-0 truncate text-[30px] font-semibold leading-9 tracking-tight text-text"
            data-titre-de-page-de-service
            data-titre-collant
          >
            {sousPage ? titreDeLaSousPage || titre : titre}
          </h1>
          <div ref={infos} className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[13px] text-muted empty:hidden" data-infos-de-la-page />
        </div>
        <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2" data-rangee-de-la-page data-rangee-forme="page">
          <div className={cn('flex min-w-0 items-center justify-end gap-3', sousPage && 'hidden')}>
            <div ref={rubriques} className="flex min-w-0 shrink-0 items-center empty:hidden" data-rubriques-de-la-page />
            <div className="flex min-w-0 shrink items-center gap-2">
              <div ref={recherche} className="flex shrink items-center gap-2 empty:hidden" data-recherche-de-la-page />
              <div ref={bascule} className="flex shrink-0 items-center gap-2 empty:hidden" data-bascule-de-la-page />
            </div>
            {droite ? (
              <div className="flex shrink-0" data-filtre-de-la-rangee>
                {droite}
              </div>
            ) : null}
          </div>
          {sansTitre ? null : outilsDeDroite}
        </div>
      </div>
      <SignalSansLigneDeTitre.Provider value={signalerSansTitre}>
      <DansUneFenetreDeService.Provider value>
        <DansUnePageDeService.Provider value>
          <CadreDesPagesDeFenetre.Provider value={cadreDesPages}>
            <FournirLaSuiteDuFil value={suite}>
              <CiblesDeLaSousPage.Provider value={ciblesDeLaSousPage}>
                <EnteteDePageParDefaut.Provider value={EnteteDansLaPageDeService}>
                  <FournirLaColonneDeService value={colonne}>
                    <FournirLaCibleDesGestes value={cible}>
                      <FournirLeRegistreDuCoin value={coin}>
                        <FournirLaCibleDuPrincipalOrdinateur value={bas}>
                          <Emplacements.Provider value={emplacements}>
                            <div
                              ref={setCadreDesPages}
                              className={cn(CLASSE_COLONNE_DE_SERVICE, 'relative flex min-h-0 flex-1 flex-col pb-6', sansTitre ? 'mt-0' : sousPage ? 'mt-6' : 'mt-5')}
                              data-corps-de-la-page-de-service
                            >
                              {children}
                            </div>
                          </Emplacements.Provider>
                        </FournirLaCibleDuPrincipalOrdinateur>
                      </FournirLeRegistreDuCoin>
                    </FournirLaCibleDesGestes>
                  </FournirLaColonneDeService>
                </EnteteDePageParDefaut.Provider>
              </CiblesDeLaSousPage.Provider>
            </FournirLaSuiteDuFil>
          </CadreDesPagesDeFenetre.Provider>
        </DansUnePageDeService.Provider>
      </DansUneFenetreDeService.Provider>
      </SignalSansLigneDeTitre.Provider>
      </div>
      </ZoneDefilement>
      {/* Le geste principal de la LISTE (« Nouveau site ») ne vaut pas pour une sous-page : il s'efface avec sa rangée. */}
      <div ref={setBas} className={cn(CLASSE_COLONNE_DE_SERVICE, 'shrink-0 pb-4 pt-2 empty:hidden', sousPage && 'hidden')} data-geste-en-bas="page" />
    </div>
  );
  return createPortal(page, document.body);
}
