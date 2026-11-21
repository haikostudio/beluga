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
  cleActuelleDeLaPage,
  grouperLesResultats,
  rubriqueDeLaPage,
  type FicheDeReglage,
  type GroupeDeReglages,
} from '@beluga/shared';
import { Dialog, DialogContentLibre, DialogHeader, DialogTitle, ZoneDefilement } from '@/components/ui';
import { Silhouette, SilhouettePageReglages } from '@/components/silhouettes';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

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

/** L'icône de chaque rubrique du premier niveau. */
const ICONES_DES_RUBRIQUES: Record<string, React.ComponentType<{ className?: string }>> = {
  moi: UserRound,
  'agents-ia': Bot,
  ordinateurs: Laptop,
  serveur: Server,
  donnees: Database,
  connexions: Link2,
};

const RENDU_DES_PAGES: Record<string, RenduDePage> = {
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
/* La modale : six rubriques, puis la colonne d'une rubrique           */
/* ------------------------------------------------------------------ */

/**
 * LES RÉGLAGES À DEUX NIVEAUX (refonte du 21/11/2026, maquette #0074a). La
 * longue colonne de 22 pages en 9 groupes laissait même son concepteur perdu.
 *
 * PREMIER NIVEAU : la recherche et les SIX RUBRIQUES (titre et phrase), sur
 * toute la largeur. SECOND NIVEAU : la rubrique ouverte DEVIENT la colonne de
 * gauche (ses pages, puis « Avancé », replié, pour les pages techniques), la
 * page à droite ; « ‹ Réglages » dans l'EN-TÊTE de la fenêtre (place `gauche`
 * du `DialogHeader`) ramène au premier niveau. Sur téléphone, trois crans —
 * rubriques, pages, page — et la flèche de l'en-tête remonte d'un cran
 * (`data-retour-menu-reglages`).
 *
 * L'adresse porte la PAGE (`#reglages/<page>`) ; sa rubrique s'en déduit. Une
 * ancienne clé suit son alias (`ALIAS_DES_PAGES_DE_REGLAGES`).
 */
export function SettingsView({
  open,
  onClose,
  page,
  onPageChange,
}: {
  open: boolean;
  onClose: () => void;
  /** La page demandée par l'adresse ; vide = le premier niveau (les six rubriques). */
  page?: string;
  onPageChange?: (page?: string) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        onClose();
        /* Refermée, la fenêtre oublie sa page : la roue dentée la rouvre sur les six rubriques. */
        onPageChange?.(undefined);
      }}
    >
      <DialogContentLibre
        className="sm:w-[min(940px,100%)] sm:h-[min(680px,85dvh)] h-[88dvh]"
        data-modale-reglages
      >
        <CorpsDesReglages open={open} page={page} onPageChange={onPageChange} />
      </DialogContentLibre>
    </Dialog>
  );
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
        // (« Moteurs »). Le reste — ordinateurs, serveur, données, connexions — reste à l'administrateur.
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

  /* LA RUBRIQUE ET LA PAGE OUVERTES. Une page INCONNUE (lien vers une page
     retirée depuis) retombe sur le premier niveau : un écran vide passerait
     pour une panne. */
  const [rubriqueCle, setRubriqueCle] = React.useState<string | null>(null);
  const [pageInterne, setPageInterne] = React.useState<string>('');
  /* SUR TÉLÉPHONE, au second niveau : la liste des pages, ou la page par-dessus. */
  const [pageAuPremierPlan, setPageAuPremierPlan] = React.useState(false);
  const [recherche, setRecherche] = React.useState('');
  const [avanceOuvert, setAvanceOuvert] = React.useState(false);

  /* L'adresse désigne une page : on ouvre sa rubrique, et la page devant. */
  const allerA = React.useCallback(
    (cle: string) => {
      const actuelle = cleActuelleDeLaPage(cle);
      const rubrique = rubriqueDeLaPage(groupes, actuelle);
      if (!rubrique) return false;
      setRubriqueCle(rubrique.cle);
      setPageInterne(actuelle);
      setPageAuPremierPlan(true);
      if (rubrique.pages.find((p) => p.cle === actuelle)?.avance) setAvanceOuvert(true);
      return true;
    },
    [groupes],
  );

  /* LA DERNIÈRE PAGE QUE LA FENÊTRE A ELLE-MÊME POSÉE DANS L'ADRESSE : l'adresse
     qui revient ne doit pas rouvrir la page par-dessus la liste (téléphone). */
  const pageEmise = React.useRef<string | undefined>(undefined);
  const emettre = (cle?: string) => {
    pageEmise.current = cle;
    onPageChange?.(cle);
  };

  React.useEffect(() => {
    if (!open) return;
    setRecherche('');
    pageEmise.current = page;
    if (!page || !allerA(page)) {
      setRubriqueCle(null);
      setPageAuPremierPlan(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /* Une page demandée de l'extérieur pendant que la fenêtre est ouverte (bouton d'un autre écran, adresse). */
  React.useEffect(() => {
    if (!open || page === pageEmise.current) return;
    pageEmise.current = page;
    if (page) allerA(page);
    else {
      setRubriqueCle(null);
      setPageAuPremierPlan(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const rubrique = rubriqueCle ? groupes.find((g) => g.cle === rubriqueCle) ?? null : null;
  const pagesOrdinaires = rubrique?.pages.filter((p) => !p.avance) ?? [];
  const pagesAvancees = rubrique?.pages.filter((p) => p.avance) ?? [];
  const pageOuverte = rubrique ? rubrique.pages.find((p) => p.cle === pageInterne) ?? pagesOrdinaires[0] ?? rubrique.pages[0] : undefined;
  const rendu = pageOuverte ? RENDU_DES_PAGES[pageOuverte.cle] : undefined;

  const ouvrirRubrique = (cle: string) => {
    const cible = groupes.find((g) => g.cle === cle);
    if (!cible) return;
    const premiere = cible.pages.find((p) => !p.avance) ?? cible.pages[0];
    setRubriqueCle(cle);
    setPageInterne(premiere.cle);
    setPageAuPremierPlan(false);
    setAvanceOuvert(false);
    setRecherche('');
    emettre(premiere.cle);
  };

  const ouvrirPage = (cle: string) => {
    if (allerA(cle)) {
      setRecherche('');
      emettre(cle);
    }
  };

  const revenirAuxRubriques = () => {
    setRubriqueCle(null);
    setPageAuPremierPlan(false);
    emettre(undefined);
  };

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
          motsCles: [...(item.motsCles ?? []), item.titre],
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

  /* L'EN-TÊTE : « ‹ Réglages » à gauche dès qu'une rubrique est ouverte. Sur
     téléphone, la flèche remonte d'UN cran : de la page à la liste de la
     rubrique, puis de la rubrique aux six rubriques. */
  const retour = rubrique ? (
    <>
      <button
        type="button"
        data-retour-menu-reglages={pageAuPremierPlan ? 'rubrique' : 'rubriques'}
        onClick={() => (pageAuPremierPlan ? setPageAuPremierPlan(false) : revenirAuxRubriques())}
        className="flex min-w-0 items-center gap-0.5 rounded-md p-1.5 text-muted hover:bg-raised hover:text-text sm:hidden"
      >
        <ChevronLeft className="h-4 w-4 shrink-0" />
        <span className="truncate text-[13px]">{pageAuPremierPlan ? t(rubrique.titre) : t('Réglages')}</span>
      </button>
      <button
        type="button"
        data-retour-rubriques-reglages
        onClick={revenirAuxRubriques}
        className="hidden items-center gap-0.5 rounded-md py-1 pl-1 pr-2 text-muted hover:bg-raised hover:text-text sm:flex"
      >
        <ChevronLeft className="h-4 w-4" />
        <span className="text-[13px]">{t('Réglages')}</span>
      </button>
    </>
  ) : null;

  return (
    <>
      <DialogHeader className="border-b border-border pb-2.5" gauche={retour}>
        <DialogTitle className="min-w-0 truncate" data-titre-reglages>
          {!rubrique ? (
            t('Réglages')
          ) : (
            <>
              <span className={cn(pageAuPremierPlan && 'max-sm:hidden')}>{t(rubrique.titre)}</span>
              {pageAuPremierPlan && pageOuverte ? <span className="sm:hidden">{t(pageOuverte.titre)}</span> : null}
            </>
          )}
        </DialogTitle>
      </DialogHeader>

      {!rubrique ? (
        /* ------------------------ PREMIER NIVEAU ------------------------ */
        <div className="flex min-h-0 flex-1 flex-col" style={STYLE_DES_BLOCS} data-niveau-reglages="rubriques">
          <div className="mx-auto w-full max-w-[720px] shrink-0 px-4 pb-1 pt-3 sm:pb-2 sm:pt-4">
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
          <ZoneDefilement className="px-4 pb-4">
            <div className="mx-auto w-full max-w-[720px] pt-2">
              {enRecherche ? (
                <ResultatsDeRecherche groupes={resultatsGroupes} onOuvrir={ouvrirPage} />
              ) : (
                <div className="grid gap-1.5 sm:grid-cols-2 sm:gap-2" data-rubriques-reglages>
                  {groupes.map((groupe) => {
                    const Icone = ICONES_DES_RUBRIQUES[groupe.cle] ?? Puzzle;
                    return (
                      <button
                        key={groupe.cle}
                        type="button"
                        data-rubrique-reglages={groupe.cle}
                        onClick={() => ouvrirRubrique(groupe.cle)}
                        className="flex items-center gap-3 rounded-2xl bg-surface px-3.5 py-2.5 text-left transition-colors hover:bg-raised sm:items-start sm:p-4"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-raised text-muted sm:h-9 sm:w-9">
                          <Icone className="h-[18px] w-[18px]" />
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="text-[14.5px] font-semibold text-text">{t(groupe.titre)}</span>
                          <span className="text-[12px] leading-snug text-muted sm:text-[12.5px]">{t(groupe.phrase)}</span>
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-faint sm:mt-2.5" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </ZoneDefilement>
        </div>
      ) : (
        /* ------------------------ SECOND NIVEAU ------------------------- */
        <div className="flex min-h-0 flex-1" style={STYLE_DES_BLOCS} data-niveau-reglages="rubrique" data-rubrique-ouverte={rubrique.cle}>
          <nav
            data-menu-reglages
            className={cn(
              'flex min-h-0 w-full flex-col sm:w-[236px] sm:shrink-0 sm:border-r sm:border-border',
              pageAuPremierPlan && 'hidden sm:flex',
            )}
          >
            <ZoneDefilement className="px-2 pb-3 pt-3">
              <p className="px-2.5 pb-2 text-[12.5px] leading-snug text-muted sm:px-2" data-phrase-rubrique>
                {t(rubrique.phrase)}
              </p>
              <div className="space-y-0.5">
                {pagesOrdinaires.map((item) => (
                  <LigneDuMenu key={item.cle} cle={item.cle} titre={t(item.titre)} active={pageOuverte?.cle === item.cle} onOuvrir={ouvrirPage} />
                ))}
              </div>
              {pagesAvancees.length ? (
                <div className="mt-3" data-avance-reglages={avanceOuvert ? 'ouvert' : 'replie'}>
                  <button
                    type="button"
                    onClick={() => setAvanceOuvert((v) => !v)}
                    aria-expanded={avanceOuvert}
                    data-basculer-avance
                    className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-2 text-left text-[12px] uppercase tracking-wide text-faint hover:text-muted sm:px-2 sm:py-1.5"
                  >
                    <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 transition-transform', avanceOuvert && 'rotate-90')} />
                    {t('Avancé')}
                  </button>
                  {avanceOuvert ? (
                    <div className="space-y-0.5">
                      {pagesAvancees.map((item) => (
                        <LigneDuMenu key={item.cle} cle={item.cle} titre={t(item.titre)} active={pageOuverte?.cle === item.cle} onOuvrir={ouvrirPage} />
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </ZoneDefilement>
          </nav>

          <section
            data-page-reglages={pageOuverte?.cle}
            className={cn('flex min-h-0 min-w-0 w-full flex-1 flex-col', !pageAuPremierPlan && 'hidden sm:flex')}
          >
            <ZoneDefilement className="p-4 sm:px-6 sm:py-5">
              <React.Suspense fallback={<SilhouettePageReglages />}>
                {rendu ? (
                  <rendu.rendu
                    key={pageOuverte?.cle}
                    {...(rendu.avecReglages ? { settings: settings ?? {}, update } : {})}
                    {...(rendu.avecOuverture ? { open } : {})}
                  />
                ) : null}
              </React.Suspense>
            </ZoneDefilement>
          </section>
        </div>
      )}
    </>
  );
}

/** Une page dans la colonne d'une rubrique. La page ouverte se marque par un fond gris, jamais par une couleur. */
function LigneDuMenu({ cle, titre, active, onOuvrir }: { cle: string; titre: string; active: boolean; onOuvrir: (cle: string) => void }) {
  const Icone = RENDU_DES_PAGES[cle]?.icone;
  return (
    <button
      type="button"
      data-page-menu={cle}
      data-actif={active ? 'oui' : undefined}
      aria-current={active ? 'page' : undefined}
      onClick={() => onOuvrir(cle)}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13.5px] sm:px-2 sm:py-1.5',
        /* Sur téléphone, cette colonne est une liste de pages : aucune n'est « choisie » tant qu'on ne l'a pas ouverte. */
        active ? 'text-text sm:bg-raised sm:font-medium' : 'text-muted hover:bg-raised/60 hover:text-text',
      )}
    >
      {Icone ? <Icone className="h-3.5 w-3.5 shrink-0 text-faint" /> : null}
      <span className="min-w-0 flex-1 truncate">{titre}</span>
      <ChevronRight className="h-3 w-3 shrink-0 text-faint sm:hidden" />
    </button>
  );
}

/** Les résultats de la recherche, rangés par rubrique : un clic ouvre la rubrique ET la page. */
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
    <div className="space-y-4">
      {groupes.map((groupe) => (
        <div key={groupe.groupe} data-groupe-reglages={groupe.groupe}>
          <p className="px-1 pb-1.5 text-[11px] uppercase tracking-wide text-faint">{groupe.groupe}</p>
          <div className="flex flex-col gap-0.5 rounded-2xl bg-surface p-1.5">
            {groupe.fiches.map((fiche) => {
              const Icone = (fiche as any).icone as React.ComponentType<{ className?: string }> | undefined;
              return (
                <button
                  key={fiche.cle}
                  type="button"
                  data-page-menu={fiche.cle}
                  onClick={() => onOuvrir(fiche.cle)}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[14px] text-text hover:bg-raised"
                >
                  {Icone ? <Icone className="h-4 w-4 shrink-0 text-faint" /> : null}
                  <span className="min-w-0 flex-1 truncate">{fiche.titre}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-faint" />
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
