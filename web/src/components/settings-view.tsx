import { ChampDeRecherche } from '@/components/ui/champ-de-recherche';
import * as React from 'react';
import { niveauDeMonService } from '@/lib/mes-droits';
import {
  Bell,
  Bot,
  Bug,
  Camera,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Database,
  Download,
  FolderTree,
  Github,
  Globe,
  KeyRound,
  Laptop,
  Link2,
  Monitor,
  Palette,
  Power,
  Puzzle,
  Save,
  Scale,
  Server,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
  Volume2,
  Wallet,
  Zap,
} from '@/components/ui/icones';
import {
  ARBORESCENCE_REGLAGES,
  chercherDansLesReglages,
  cibleDesReglages,
  grouperLesResultats,
  type FicheDeReglage,
  type GroupeDeReglages,
} from '@beluga/shared';
import { Dialog, DialogContentLibre, DialogHeader, DialogTitle, ZoneDefilement } from '@/components/ui';
import { SilhouettePageReglages } from '@/components/silhouettes';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';
import { FournisseurDeSousPage, type SousPageDeReglages } from '@/components/reglages/sous-page';
import { FournisseurDuPied } from '@/components/reglages/pied-de-page';
import { ContexteTitreDeSection } from '@/components/reglages/communs';

/* ------------------------------------------------------------------ */
/* CE QUE L'ÉCRAN AJOUTE À L'ARBORESCENCE : une icône, un module        */
/* ------------------------------------------------------------------ */

/**
 * L'arborescence — groupes, pages, titres et mots-clés — vit dans le socle
 * partagé (`shared/src/reglages-arborescence.ts`). Ici on ne pose que ce qui ne
 * peut pas y vivre : l'ICÔNE de chaque page et le MODULE à télécharger quand on
 * l'ouvre. Un écran qu'on n'a pas ouvert ne se télécharge pas.
 */
interface RenduDePage {
  icone: React.ComponentType<{ className?: string }>;
  /** La page reçoit les réglages du démon et la fonction qui les enregistre. */
  avecReglages?: boolean;
  /** La page veut savoir si la modale est ouverte, pour ne charger qu'alors. */
  avecOuverture?: boolean;
  rendu: React.LazyExoticComponent<React.ComponentType<any>>;
}

const paresseux = (charge: () => Promise<Record<string, any>>, nom: string) =>
  React.lazy(() => charge().then((module) => ({ default: module[nom] })));

/** Les pages qu'ouvre le service « Réglages de Beluga » d'un accès tiers (les mêmes qu'avant la refonte en rubriques). */
const PAGES_DU_SERVICE_REGLAGES = ['theme', 'projets', 'notifications', 'agents-paralleles', 'assistant'];
/** Les pages qu'ouvre le service « Moteurs » d'un accès tiers. */
const PAGES_DU_SERVICE_MOTEURS = ['comptes', 'consommation', 'services-creation'];

/**
 * LES BLOCS GRIS SE VOIENT DANS LA FENÊTRE. Une fenêtre centrée ramène `--surface` au fond (`FenetreCentree`) : un
 * bloc `bg-surface` y disparaissait. Le corps des réglages reprend donc la teinte de bloc déclarée par les douze
 * palettes (`--bloc-etapes`) pour `--surface`, et un cran au-dessus (`--border`) pour `--raised` : survols, boutons
 * secondaires et page retenue restent lisibles SUR le bloc.
 */
const STYLE_DES_BLOCS = {
  ['--surface' as string]: 'var(--bloc-etapes)',
  ['--raised' as string]: 'var(--border)',
} as React.CSSProperties;

/** L'icône de chaque rubrique de la colonne fixe. */
const ICONES_DES_RUBRIQUES: Record<string, React.ComponentType<{ className?: string }>> = {
  moi: UserRound,
  acces: KeyRound,
  'agents-ia': Bot,
  ordinateurs: Laptop,
  serveur: Server,
  donnees: Database,
  connexions: Link2,
};

const RENDU_DES_PAGES: Record<string, RenduDePage> = {
  /* — Accès — */
  acces: {
    icone: KeyRound,
    avecReglages: true,
    rendu: paresseux(() => import('@/components/reglages/page-acces'), 'PageAcces'),
  },
  /* — Moi — */
  'mon-compte': {
    icone: UserRound,
    rendu: paresseux(() => import('@/components/reglages/page-mon-compte'), 'PageMonCompte'),
  },
  theme: {
    icone: Palette,
    rendu: paresseux(() => import('@/components/reglages/page-apparence'), 'PageApparenceEtLangue'),
  },
  notifications: {
    icone: Bell,
    avecReglages: true,
    rendu: paresseux(() => import('@/components/reglages/page-notifications'), 'ReglagesNotifications'),
  },
  /* — Agents et IA — */
  comptes: {
    icone: KeyRound,
    rendu: paresseux(() => import('@/components/reglages/page-comptes'), 'SectionComptes'),
  },
  consommation: {
    icone: Wallet,
    avecOuverture: true,
    avecReglages: true,
    rendu: paresseux(() => import('@/components/reglages/page-consommation'), 'UsageSection'),
  },
  'agents-paralleles': {
    icone: Users,
    avecReglages: true,
    rendu: paresseux(() => import('@/components/reglages/page-agents'), 'ReglagesAgents'),
  },
  assistant: {
    icone: Volume2,
    avecOuverture: true,
    rendu: paresseux(() => import('@/components/reglages/page-voix'), 'VoiceSection'),
  },
  'services-creation': {
    icone: Clapperboard,
    rendu: paresseux(() => import('@/components/reglages/page-services-creation'), 'PageServicesCreation'),
  },
  'juge-rapide': {
    icone: Scale,
    avecOuverture: true,
    rendu: paresseux(() => import('@/components/reglages/page-juge-rapide'), 'PageJugeRapide'),
  },
  /* — Ordinateurs — */
  ordinateurs: {
    icone: Monitor,
    rendu: paresseux(() => import('@/components/reglages/page-extension'), 'PageOrdinateurs'),
  },
  /* — Serveur — */
  serveur: {
    icone: Server,
    rendu: paresseux(() => import('@/components/reglages/page-serveur'), 'SectionServeur'),
  },
  'mise-a-jour': {
    icone: Download,
    rendu: paresseux(() => import('@/components/reglages/page-mise-a-jour'), 'PageMiseAJour'),
  },
  adresse: {
    icone: Globe,
    rendu: paresseux(() => import('@/components/reglages/page-adresse-et-fonctions'), 'PageAdresseEtCourriels'),
  },
  fonctions: {
    icone: Sparkles,
    rendu: paresseux(() => import('@/components/reglages/page-adresse-et-fonctions'), 'PageFonctions'),
  },
  'gestes-serveur': {
    icone: Power,
    rendu: paresseux(() => import('@/components/reglages/page-serveur'), 'SectionGestesServeur'),
  },
  erreurs: {
    icone: Bug,
    rendu: paresseux(() => import('@/components/reglages/page-erreurs-interface'), 'SectionErreursInterface'),
  },
  /* — Données — */
  sauvegardes: {
    icone: Save,
    avecReglages: true,
    avecOuverture: true,
    rendu: paresseux(() => import('@/components/reglages/page-sauvegardes'), 'PageSauvegardes'),
  },
  backups: {
    icone: Camera,
    avecReglages: true,
    rendu: paresseux(() => import('@/components/reglages/page-backups'), 'ReglagesBackups'),
  },
  export: {
    icone: Database,
    rendu: paresseux(() => import('@/components/reglages/page-export'), 'SectionExportDonnees'),
  },
  projets: {
    icone: FolderTree,
    rendu: paresseux(() => import('@/components/reglages/page-projets'), 'PageProjetsReunis'),
  },
  /* — Connexions — */
  github: {
    icone: Github,
    rendu: paresseux(() => import('@/components/reglages/page-github'), 'PageGithub'),
  },
  /* La liaison avec Beluga Pass (carte « Relier Beluga Pass dans les réglages », 16/11/2026) : sortie du coffre-fort. */
  belugapass: {
    icone: ShieldCheck,
    rendu: paresseux(() => import('@/components/reglages/page-belugapass'), 'PageBelugaPass'),
  },
  'acces-api': {
    icone: Zap,
    avecOuverture: true,
    rendu: paresseux(() => import('@/components/reglages/page-acces-api'), 'SectionClesApi'),
  },
};

/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* La fenêtre : la colonne fixe des rubriques, la page de la rubrique  */
/* ------------------------------------------------------------------ */

/**
 * LES RÉGLAGES EN COLONNE FIXE (carte « Retrouver la gestion des accès clients », 24/11/2026 — remplace les « deux
 * niveaux » du 21/11, où l'on ne trouvait plus rien : choix C, maquette #b2773).
 *
 * À GAUCHE, TOUJOURS : la recherche, puis les sept rubriques (Moi, Accès, Agents et IA, Ordinateurs, Serveur,
 * Données, Connexions). Plus d'écran d'accueil à tuiles, plus de « ‹ Réglages ».
 * À DROITE : UNE page par rubrique, qui EMPILE toutes ses pages en sections titrées (titre au-dessus, blocs gris en
 * dessous) ; les pages techniques (`avance`) dans un bloc « Avancé » replié, en bas. Chaque section se monte à
 * l'approche de la vue : un écran qu'on n'a pas fait défiler ne se télécharge pas.
 * SUR TÉLÉPHONE, deux crans : la liste des rubriques, puis la page ; la flèche de l'en-tête remonte d'un cran
 * (`data-retour-menu-reglages`).
 *
 * L'adresse porte une clé (`#reglages/<clé>`) : une clé de page ouvre sa rubrique et descend à sa section, une clé
 * de rubrique ouvre la rubrique en haut ; une ancienne clé suit son alias (`cibleDesReglages`).
 */
export function SettingsView({
  open,
  onClose,
  page,
  onPageChange,
}: {
  open: boolean;
  onClose: () => void;
  /** La page (ou la rubrique) demandée par l'adresse ; vide = la première rubrique. */
  page?: string;
  onPageChange?: (page?: string) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        onClose();
        /* Refermée, la fenêtre oublie sa page : la roue dentée la rouvre sur la première rubrique. */
        onPageChange?.(undefined);
      }}
    >
      <DialogContentLibre
        className="sm:w-[min(980px,100%)] sm:h-[min(720px,88dvh)] h-[88dvh]"
        data-modale-reglages
      >
        <CorpsDesReglages open={open} page={page} onPageChange={onPageChange} />
      </DialogContentLibre>
    </Dialog>
  );
}

/** La section à rejoindre dans la page : `cle` vide = le haut ; `n` rejoue le même saut. */
interface Visee {
  cle: string;
  marquer: boolean;
  n: number;
}

function CorpsDesReglages({
  open,
  page,
  onPageChange,
}: {
  open: boolean;
  page?: string;
  onPageChange?: (page?: string) => void;
}) {
  const state = useApp();
  /* « Services de création » n'existe que pour qui a le Studio (`shared/src/studio-reserve.ts`). */
  const groupes = React.useMemo<GroupeDeReglages[]>(
    () =>
      ARBORESCENCE_REGLAGES.map((groupe) => ({
        ...groupe,
        // Un accès tiers a « Mon compte », plus ce que sa grille ouvre : les
        // réglages de Beluga (« Réglages ») et les comptes des moteurs
        // (« Moteurs »). Le reste — accès, ordinateurs, serveur, données, connexions — reste à l'administrateur.
        pages: groupe.pages.filter(
          (item) =>
            (state.monRole === 'admin' ||
              item.cle === 'mon-compte' ||
              (PAGES_DU_SERVICE_REGLAGES.includes(item.cle) && niveauDeMonService(state, 'reglages') !== 'aucun') ||
              (PAGES_DU_SERVICE_MOTEURS.includes(item.cle) && niveauDeMonService(state, 'moteurs') !== 'aucun')) &&
            /* LES SERVICES DE CRÉATION servent aussi le mode caméra des cartes
               (studio créatif, 24/10/2026) : l'administrateur les voit, Studio
               ouvert ou non ; un collaborateur, jamais. */
            (item.cle !== 'services-creation' || state.studioOuvert || state.monRole === 'admin'),
        ),
      })).filter((groupe) => groupe.pages.length > 0),
    [state.studioOuvert, state.monRole, state.mesDroits],
  );

  const [rubriqueCle, setRubriqueCle] = React.useState<string>(() => groupes[0]?.cle ?? 'moi');
  /* SUR TÉLÉPHONE : la liste des rubriques, ou la page par-dessus. */
  const [pageAuPremierPlan, setPageAuPremierPlan] = React.useState(false);
  const [recherche, setRecherche] = React.useState('');
  const [avanceOuvert, setAvanceOuvert] = React.useState(false);
  const [visee, setVisee] = React.useState<Visee>({ cle: '', marquer: false, n: 0 });
  /* LA SECTION MARQUÉE UN INSTANT après une recherche : un fond gris qui s'éteint, aucune couleur. */
  const [marquee, setMarquee] = React.useState<string | null>(null);
  /* LA SOUS-PAGE OUVERTE PAR UNE PAGE (une personne, un ordinateur) : elle s'ouvre dans le volet de droite, l'entête de
     la page devient son retour (ordinateur) et la flèche de l'en-tête y remonte (téléphone) — `reglages/sous-page.tsx`.
     La colonne de gauche ne change jamais. */
  const [sousPage, setSousPage] = React.useState<SousPageDeReglages | null>(null);
  const [zone, setZone] = React.useState<HTMLDivElement | null>(null);
  const [pied, setPied] = React.useState<HTMLDivElement | null>(null);
  const contenuRef = React.useRef<HTMLDivElement | null>(null);

  /* Une clé de l'adresse : sa rubrique devant, et sa section visée. */
  const allerA = React.useCallback(
    (cle: string, marquer = false) => {
      const cible = cibleDesReglages(groupes, cle);
      if (!cible) return false;
      const premiere = cible.rubrique.pages.find((p) => !p.avance)?.cle;
      const avance = !!(cible.page && cible.rubrique.pages.find((p) => p.cle === cible.page)?.avance);
      setRubriqueCle(cible.rubrique.cle);
      setPageAuPremierPlan(true);
      setAvanceOuvert(avance);
      const versLaSection = !!cible.page && (cible.page !== premiere || marquer);
      setVisee({ cle: versLaSection ? cible.page! : '', marquer: marquer && versLaSection, n: Date.now() });
      return true;
    },
    [groupes],
  );

  /* LA DERNIÈRE CLÉ QUE LA FENÊTRE A ELLE-MÊME POSÉE DANS L'ADRESSE : l'adresse
     qui revient ne doit pas rejouer le saut (ni rouvrir la page sur téléphone). */
  const pageEmise = React.useRef<string | undefined>(undefined);
  const emettre = (cle?: string) => {
    pageEmise.current = cle;
    onPageChange?.(cle);
  };

  const versLaListe = () => {
    setRubriqueCle((avant) => (groupes.some((g) => g.cle === avant) ? avant : groupes[0]?.cle ?? 'moi'));
    setPageAuPremierPlan(false);
    setVisee({ cle: '', marquer: false, n: Date.now() });
  };

  React.useEffect(() => {
    if (!open) return;
    setRecherche('');
    pageEmise.current = page;
    if (!page || !allerA(page)) {
      setRubriqueCle(groupes[0]?.cle ?? 'moi');
      setAvanceOuvert(false);
      versLaListe();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /* Une clé demandée de l'extérieur pendant que la fenêtre est ouverte (bouton d'un autre écran, adresse). */
  React.useEffect(() => {
    if (!open || page === pageEmise.current) return;
    pageEmise.current = page;
    if (!page || !allerA(page)) versLaListe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const rubrique = groupes.find((g) => g.cle === rubriqueCle) ?? groupes[0];
  const pagesOrdinaires = rubrique?.pages.filter((p) => !p.avance) ?? [];
  const pagesAvancees = rubrique?.pages.filter((p) => p.avance) ?? [];
  /* Une rubrique d'une seule page (Accès, Ordinateurs) : le titre de la rubrique suffit, sa section n'en redit pas. */
  const pageSeule = pagesOrdinaires.length === 1;

  const ouvrirRubrique = (cle: string) => {
    const cible = groupes.find((g) => g.cle === cle);
    if (!cible) return;
    setRubriqueCle(cle);
    setPageAuPremierPlan(true);
    setAvanceOuvert(false);
    setRecherche('');
    setVisee({ cle: '', marquer: false, n: Date.now() });
    emettre(cle);
  };

  const ouvrirPage = (cle: string) => {
    if (allerA(cle, true)) {
      setRecherche('');
      emettre(cle);
    }
  };

  /*
   * LE SAUT VERS UNE SECTION. Les sections au-dessus de la cible sont montées d'office (`force`) et se chargent
   * l'une après l'autre : la page grandit sous les yeux. Le saut se RECALE donc à chaque changement de hauteur du
   * contenu, deux secondes et demie durant — sauf si la personne a repris la main (molette, doigt, clavier).
   */
  const indexVise = visee.cle ? rubrique?.pages.findIndex((p) => p.cle === visee.cle) ?? -1 : -1;
  React.useLayoutEffect(() => {
    if (!zone) return;
    if (!visee.cle) {
      zone.scrollTop = 0;
      return;
    }
    let repris = false;
    const reprendre = () => {
      repris = true;
    };
    const aligner = () => {
      if (repris) return;
      const section = zone.querySelector<HTMLElement>(`[data-section-page="${CSS.escape(visee.cle)}"]`);
      if (!section) return;
      zone.scrollTop = section.getBoundingClientRect().top - zone.getBoundingClientRect().top + zone.scrollTop - 12;
    };
    aligner();
    const surveillance = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(aligner) : null;
    if (contenuRef.current) surveillance?.observe(contenuRef.current);
    zone.addEventListener('wheel', reprendre, { passive: true });
    zone.addEventListener('touchstart', reprendre, { passive: true });
    zone.addEventListener('keydown', reprendre);
    const fin = window.setTimeout(() => surveillance?.disconnect(), 2500);
    if (visee.marquer) setMarquee(visee.cle);
    const eteindre = visee.marquer ? window.setTimeout(() => setMarquee(null), 1600) : undefined;
    return () => {
      surveillance?.disconnect();
      window.clearTimeout(fin);
      if (eteindre) window.clearTimeout(eteindre);
      zone.removeEventListener('wheel', reprendre);
      zone.removeEventListener('touchstart', reprendre);
      zone.removeEventListener('keydown', reprendre);
    };
  }, [zone, visee, rubrique?.cle]);

  const settings = state.settings;
  /* UN RÉGLAGE PERDU EN SILENCE FAIT CROIRE À UN RÉGLAGE POSÉ : chaque
     interrupteur des réglages attend donc l'accusé du serveur, et son échec se
     voit. */
  const update = (patch: Record<string, unknown>) =>
    void client.geste({ type: 'settings.update', patch }, t('Enregistrement du réglage'));

  /* L'INDEX DE RECHERCHE : toutes les pages de toutes les rubriques. Les titres
     et les libellés sont DÉJÀ TRADUITS : on cherche dans la langue qu'on lit.
     Le titre FRANÇAIS reste en mot-clé, pour que « sauvegarde » trouve encore
     la page sur une interface en anglais. */
  const fiches = React.useMemo(
    () =>
      groupes.flatMap((groupe) =>
        groupe.pages.map((item) => ({
          cle: item.cle,
          titre: t(item.titre),
          groupe: t(groupe.titre),
          motsCles: [...(item.motsCles ?? []), item.titre, groupe.titre],
          libelles: (item.libelles ?? []).map((libelle) => t(libelle)),
          icone: RENDU_DES_PAGES[item.cle]?.icone,
        })),
      ),
    [groupes],
  );
  const enRecherche = !!recherche.trim();
  const resultatsGroupes = React.useMemo(
    () => grouperLesResultats(chercherDansLesReglages(fiches, recherche)),
    [fiches, recherche],
  );

  /* SUR TÉLÉPHONE, LA FLÈCHE DE L'EN-TÊTE remonte d'un cran : de la sous-page à sa page, de la page à la liste. */
  const retour = pageAuPremierPlan ? (
    sousPage ? (
      <button
        type="button"
        data-retour-menu-reglages="sous-page"
        data-retour-ordinateurs="entete"
        onClick={sousPage.onRetour}
        className="flex min-w-0 items-center gap-0.5 rounded-md p-1.5 text-muted hover:bg-raised hover:text-text sm:hidden"
      >
        <ChevronLeft className="h-4 w-4 shrink-0" />
        <span className="truncate text-[13px]">{sousPage.retour}</span>
      </button>
    ) : (
      <button
        type="button"
        data-retour-menu-reglages="rubriques"
        onClick={() => {
          versLaListe();
          emettre(undefined);
        }}
        className="flex min-w-0 items-center gap-0.5 rounded-md p-1.5 text-muted hover:bg-raised hover:text-text sm:hidden"
      >
        <ChevronLeft className="h-4 w-4 shrink-0" />
        <span className="truncate text-[13px]">{t('Réglages')}</span>
      </button>
    )
  ) : null;

  const sectionDePage = (item: GroupeDeReglages['pages'][number], index: number) => {
    const rendu = RENDU_DES_PAGES[item.cle];
    if (!rendu) return null;
    return (
      <SectionDePage
        key={item.cle}
        cle={item.cle}
        titre={t(item.titre)}
        avecTitre={!(pageSeule && !item.avance)}
        marquee={marquee === item.cle}
        force={indexVise >= 0 && index <= indexVise}
        racine={zone}
      >
        <rendu.rendu
          {...(rendu.avecReglages ? { settings: settings ?? {}, update } : {})}
          {...(rendu.avecOuverture ? { open } : {})}
        />
      </SectionDePage>
    );
  };

  return (
    <>
      <DialogHeader className="border-b border-border pb-2.5" gauche={retour}>
        <DialogTitle className="min-w-0 truncate" data-titre-reglages>
          <span className={cn(pageAuPremierPlan && 'max-sm:hidden')}>{t('Réglages')}</span>
          {pageAuPremierPlan && rubrique ? <span className="sm:hidden">{sousPage?.titre ?? t(rubrique.titre)}</span> : null}
        </DialogTitle>
      </DialogHeader>

      <div
        className="flex min-h-0 flex-1"
        style={STYLE_DES_BLOCS}
        data-niveau-reglages={pageAuPremierPlan ? 'page' : 'liste'}
        data-rubrique-ouverte={rubrique?.cle}
      >
        {/* ------------------------ LA COLONNE FIXE ------------------------ */}
        <nav
          data-menu-reglages
          className={cn(
            'flex min-h-0 w-full flex-col sm:w-[232px] sm:shrink-0 sm:border-r sm:border-border',
            pageAuPremierPlan && 'hidden sm:flex',
          )}
        >
          <div className="shrink-0 px-3 pb-2 pt-3 sm:px-2.5">
            <ChampDeRecherche
              valeur={recherche}
              onChange={setRecherche}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                const premier = resultatsGroupes[0]?.fiches[0];
                if (premier) ouvrirPage(premier.cle);
              }}
              placeholder={t('Rechercher un réglage')}
              data-recherche-reglages
            />
          </div>
          <ZoneDefilement className="px-3 pb-3 sm:px-2.5">
            {enRecherche ? (
              <ResultatsDeRecherche groupes={resultatsGroupes} onOuvrir={ouvrirPage} />
            ) : (
              <div className="flex flex-col gap-0.5" data-rubriques-reglages>
                {groupes.map((groupe) => (
                  <LigneDeRubrique
                    key={groupe.cle}
                    cle={groupe.cle}
                    titre={t(groupe.titre)}
                    active={groupe.cle === rubrique?.cle}
                    onOuvrir={ouvrirRubrique}
                  />
                ))}
              </div>
            )}
          </ZoneDefilement>
        </nav>

        {/* ------------------------ LA PAGE DE LA RUBRIQUE ------------------------ */}
        <section
          data-page-reglages={rubrique?.cle}
          className={cn('flex min-h-0 min-w-0 w-full flex-1 flex-col', !pageAuPremierPlan && 'hidden sm:flex')}
        >
          <FournisseurDeSousPage value={setSousPage}>
            <FournisseurDuPied value={pied}>
              {/* TOUTE PAGE S'OUVRE EN HAUT (décision du 25/11/2026 — « je rentre dans un profil et j'arrive au milieu ») :
                  une sous-page qui s'ouvre, change ou se ferme ramène la zone en haut. Renommer la personne ouverte
                  ne change pas son identité, donc ne fait pas sauter la page. */}
              <ZoneDefilement ref={setZone} hautSur={sousPage?.cle ?? null} className="px-4 pb-6 pt-4 sm:px-6 sm:pt-5">
                {rubrique ? (
                  <div key={rubrique.cle} ref={contenuRef} className="flex flex-col gap-9 max-sm:gap-10" data-page-rubrique={rubrique.cle}>
                    {sousPage ? (
                      /* UNE SOUS-PAGE OUVERTE : l'entête devient son retour vers le volet précédent (ordinateur). Sur
                         téléphone, c'est la flèche de la barre d'en-tête qui remonte : l'entête s'efface. */
                      <header className="-mb-4 flex items-center max-sm:hidden" data-tete-rubrique data-tete-sous-page>
                        <button
                          type="button"
                          onClick={sousPage.onRetour}
                          className="-ml-1 flex min-w-0 items-center gap-0.5 rounded-md py-1 pl-1 pr-2 text-[13px] text-muted transition-colors hover:bg-raised hover:text-text"
                          data-retour-sous-page
                          data-retour-ordinateurs="tete-de-page"
                        >
                          <ChevronLeft className="h-4 w-4 shrink-0" />
                          <span className="truncate">{sousPage.retour}</span>
                        </button>
                      </header>
                    ) : (
                      <header className="flex flex-col gap-1 px-1" data-tete-rubrique>
                        <h2 className="text-[18px] font-semibold text-text max-sm:hidden">{t(rubrique.titre)}</h2>
                        <p className="text-[13px] leading-relaxed text-muted">{t(rubrique.phrase)}</p>
                      </header>
                    )}
                    {pagesOrdinaires.map((item) => sectionDePage(item, rubrique.pages.indexOf(item)))}
                    {pagesAvancees.length ? (
                      <div className="flex flex-col gap-6" data-avance-reglages={avanceOuvert ? 'ouvert' : 'replie'}>
                        <button
                          type="button"
                          onClick={() => setAvanceOuvert((v) => !v)}
                          aria-expanded={avanceOuvert}
                          data-basculer-avance
                          className="flex w-fit items-center gap-1.5 rounded-md px-1 py-1 text-left text-[12px] uppercase tracking-wide text-faint hover:text-muted"
                        >
                          <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 transition-transform', avanceOuvert && 'rotate-90')} />
                          {t('Avancé')}
                        </button>
                        {avanceOuvert ? pagesAvancees.map((item) => sectionDePage(item, rubrique.pages.indexOf(item))) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </ZoneDefilement>
              {/* LE PIED D'UNE PAGE (« Ajouter un projet » d'Accès) : collé en bas, hors du défilement. */}
              <div ref={setPied} className="shrink-0 empty:hidden" data-pied-page-reglages />
            </FournisseurDuPied>
          </FournisseurDeSousPage>
        </section>
      </div>
    </>
  );
}

/**
 * UNE PAGE DANS LA PAGE DE SA RUBRIQUE : son titre, puis ses blocs. Elle ne se MONTE qu'à l'approche de la vue
 * (400 px avant) — ou d'office quand un saut la vise ou vise une section plus bas : un écran qu'on n'a pas fait
 * défiler ne se télécharge pas. Montée, elle le reste.
 */
function SectionDePage({
  cle,
  titre,
  avecTitre,
  marquee,
  force,
  racine,
  children,
}: {
  cle: string;
  titre: string;
  avecTitre: boolean;
  marquee: boolean;
  force: boolean;
  racine: HTMLElement | null;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLElement | null>(null);
  const [montee, setMontee] = React.useState(force);
  React.useEffect(() => {
    if (force) setMontee(true);
  }, [force]);
  React.useEffect(() => {
    if (montee || !racine) return;
    const section = ref.current;
    if (!section || typeof IntersectionObserver === 'undefined') {
      setMontee(true);
      return;
    }
    const observateur = new IntersectionObserver(
      (entrees) => {
        if (entrees.some((e) => e.isIntersecting)) {
          setMontee(true);
          observateur.disconnect();
        }
      },
      { root: racine, rootMargin: '400px 0px' },
    );
    observateur.observe(section);
    return () => observateur.disconnect();
  }, [montee, racine]);
  return (
    <section
      ref={ref}
      data-section-page={cle}
      data-section-montee={montee ? 'oui' : 'non'}
      data-section-marquee={marquee ? 'oui' : undefined}
      className={cn('-m-2 flex flex-col gap-4 rounded-2xl p-2 transition-colors duration-700 max-sm:gap-5', marquee ? 'bg-raised' : 'bg-transparent')}
    >
      {avecTitre ? (
        <h3 className="px-1 text-[16px] font-semibold text-text" data-titre-section>
          {titre}
        </h3>
      ) : null}
      <ContexteTitreDeSection.Provider value={avecTitre ? titre : null}>
        {montee ? <React.Suspense fallback={<SilhouettePageReglages />}>{children}</React.Suspense> : <SilhouettePageReglages />}
      </ContexteTitreDeSection.Provider>
    </section>
  );
}

/** Une rubrique dans la colonne fixe. La rubrique ouverte se marque par un fond gris, jamais par une couleur. */
function LigneDeRubrique({ cle, titre, active, onOuvrir }: { cle: string; titre: string; active: boolean; onOuvrir: (cle: string) => void }) {
  const Icone = ICONES_DES_RUBRIQUES[cle] ?? Puzzle;
  return (
    <button
      type="button"
      data-rubrique-reglages={cle}
      data-actif={active ? 'oui' : undefined}
      aria-current={active ? 'page' : undefined}
      onClick={() => onOuvrir(cle)}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-[14px] sm:py-2 sm:text-[13.5px]',
        /* Sur téléphone, cette colonne est une liste : aucune rubrique n'est « choisie » tant qu'on ne l'a pas ouverte. */
        active ? 'text-text sm:bg-raised sm:font-medium' : 'text-muted hover:bg-raised/60 hover:text-text',
      )}
    >
      <Icone className={cn('h-4 w-4 shrink-0', active ? 'text-muted' : 'text-faint')} />
      <span className="min-w-0 flex-1 truncate">{titre}</span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-faint sm:hidden" />
    </button>
  );
}

/** Les résultats de la recherche, rangés par rubrique : un clic ouvre la rubrique ET descend à la section. */
function ResultatsDeRecherche({
  groupes,
  onOuvrir,
}: {
  groupes: { groupe: string; fiches: FicheDeReglage[] }[];
  onOuvrir: (cle: string) => void;
}) {
  if (!groupes.length) {
    return (
      <p data-aucun-reglage-trouve className="px-2 py-6 text-center text-[12.5px] text-faint">
        {t('Aucun réglage ne correspond.')}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3" data-resultats-reglages>
      {groupes.map((groupe) => (
        <div key={groupe.groupe} data-groupe-reglages={groupe.groupe}>
          <p className="px-2 pb-1 text-[11px] uppercase tracking-wide text-faint">{groupe.groupe}</p>
          <div className="flex flex-col gap-0.5">
            {groupe.fiches.map((fiche) => {
              const Icone = (fiche as any).icone as React.ComponentType<{ className?: string }> | undefined;
              return (
                <button
                  key={fiche.cle}
                  type="button"
                  data-page-menu={fiche.cle}
                  onClick={() => onOuvrir(fiche.cle)}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13.5px] text-text hover:bg-raised"
                >
                  {Icone ? <Icone className="h-3.5 w-3.5 shrink-0 text-faint" /> : null}
                  <span className="min-w-0 flex-1 truncate">{fiche.titre}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
