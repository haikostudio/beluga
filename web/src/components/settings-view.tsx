import * as React from 'react';
import {
  Activity,
  Bell,
  ChevronLeft,
  ChevronRight,
  Database,
  FolderTree,
  KeyRound,
  Camera,
  Bug,
  Loader2,
  Palette,
  Save,
  Scale,
  Search,
  Sparkles,
  Users,
  Volume2,
  Wallet,
  Zap,
} from 'lucide-react';
import {
  ARBORESCENCE_REGLAGES,
  chercherDansLesReglages,
  grouperLesResultats,
  pagesDesReglages,
  type FicheDeReglage,
} from '@beluga/shared';
import { Dialog, DialogContentLibre, DialogTitle, Input, ZoneDefilement } from '@/components/ui';
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

const RENDU_DES_PAGES: Record<string, RenduDePage> = {
  theme: {
    icone: Palette,
    rendu: paresseux(() => import('@/components/reglages/page-apparence'), 'SectionApparence'),
  },
  projets: {
    icone: FolderTree,
    rendu: paresseux(() => import('@/components/reglages/page-projets'), 'PageProjetsReunis'),
  },
  'agents-paralleles': {
    icone: Users,
    avecReglages: true,
    rendu: paresseux(() => import('@/components/reglages/page-agents'), 'ReglagesAgents'),
  },
  notifications: {
    icone: Bell,
    avecReglages: true,
    rendu: paresseux(() => import('@/components/reglages/page-notifications'), 'ReglagesNotifications'),
  },
  voix: {
    icone: Volume2,
    avecOuverture: true,
    rendu: paresseux(() => import('@/components/reglages/page-voix'), 'VoiceSection'),
  },
  comptes: {
    icone: KeyRound,
    rendu: paresseux(() => import('@/components/reglages/page-comptes'), 'SectionComptes'),
  },
  consommation: {
    icone: Wallet,
    avecOuverture: true,
    rendu: paresseux(() => import('@/components/reglages/page-consommation'), 'UsageSection'),
  },
  capacite: {
    icone: Activity,
    rendu: paresseux(() => import('@/components/reglages/page-capacite'), 'SectionSysteme'),
  },
  erreurs: {
    icone: Bug,
    rendu: paresseux(() => import('@/components/reglages/page-erreurs-interface'), 'SectionErreursInterface'),
  },
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
  'acces-api': {
    icone: Zap,
    avecOuverture: true,
    rendu: paresseux(() => import('@/components/reglages/page-acces-api'), 'SectionClesApi'),
  },
  'mode-creation': {
    icone: Sparkles,
    avecReglages: true,
    rendu: paresseux(() => import('@/components/reglages/page-mode-creation'), 'PageModeCreation'),
  },
  'juge-rapide': {
    icone: Scale,
    avecOuverture: true,
    rendu: paresseux(() => import('@/components/reglages/page-juge-rapide'), 'PageJugeRapide'),
  },
};

/* ------------------------------------------------------------------ */
/* La modale : un menu à gauche, une page à droite                     */
/* ------------------------------------------------------------------ */

/**
 * LES RÉGLAGES SONT UNE MODALE À MENU, plus un tiroir à dix onglets. Dix
 * onglets ne tenaient pas sur la largeur d'un téléphone, chacun empilait
 * plusieurs blocs sans hiérarchie, et rien ne permettait de CHERCHER : il
 * fallait savoir où le réglage se cachait.
 *
 * Sur grand écran, deux colonnes : le menu (avec sa recherche) à gauche, la
 * sous-page à droite, chacune dans sa propre `ZoneDefilement`. Sur téléphone,
 * le menu occupe l'écran et la page choisie le RECOUVRE, avec un bouton de
 * retour — une colonne de gauche ne tient pas sur cette largeur.
 */
export function SettingsView({
  open,
  onClose,
  page,
  onPageChange,
}: {
  open: boolean;
  onClose: () => void;
  /** La page demandée par l'adresse ; vide = la première du menu. */
  page?: string;
  onPageChange?: (page: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
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
  onPageChange?: (page: string) => void;
}) {
  const state = useApp();
  const groupes = ARBORESCENCE_REGLAGES;
  const pages = React.useMemo(() => pagesDesReglages(groupes), [groupes]);

  /* LA PAGE OUVERTE est retenue d'une ouverture à l'autre, et l'adresse la
     porte. Une page INCONNUE — un lien vers un ancien onglet, une page
     retirée depuis — retombe sur la première : un écran vide passerait pour une panne. */
  const [pageInterne, setPageInterne] = React.useState<string>(page ?? pages[0]?.cle ?? '');
  React.useEffect(() => {
    if (page) setPageInterne(page);
  }, [page]);
  const pageOuverte = pages.find((item) => item.cle === pageInterne) ?? pages[0];
  const rendu = pageOuverte ? RENDU_DES_PAGES[pageOuverte.cle] : undefined;

  /* SUR TÉLÉPHONE, une seule des deux colonnes est à l'écran : le menu, ou la
     page. À l'ouverture on montre le MENU, sauf si l'adresse désignait déjà une
     page précise. */
  const [pageAuPremierPlan, setPageAuPremierPlan] = React.useState(!!page);

  const [recherche, setRecherche] = React.useState('');

  const ouvrir = (cle: string) => {
    setPageInterne(cle);
    setPageAuPremierPlan(true);
    onPageChange?.(cle);
  };

  React.useEffect(() => {
    if (!open) return;
    setRecherche('');
    setPageAuPremierPlan(!!page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const settings = state.settings;
  /* UN RÉGLAGE PERDU EN SILENCE FAIT CROIRE À UN RÉGLAGE POSÉ : chaque
     interrupteur des réglages attend donc l'accusé du serveur, et son échec se
     voit. */
  const update = (patch: Record<string, unknown>) =>
    void client.geste({ type: 'settings.update', patch }, t('Enregistrement du réglage'));

  /* L'INDEX DE RECHERCHE, construit à partir des fiches déclarées plus haut.
     Les titres et les libellés sont DÉJÀ TRADUITS : on cherche dans la langue
     qu'on lit. Le titre FRANÇAIS reste en mot-clé, pour que « sauvegarde »
     trouve encore la page sur une interface en anglais. Rien du contenu des
     projets n'entre ici : uniquement des textes d'interface. */
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

  const resultatsGroupes = React.useMemo(
    () => grouperLesResultats(chercherDansLesReglages(fiches, recherche)),
    [fiches, recherche],
  );

  return (
    <>
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        {/* Le retour n'existe QUE sur téléphone, et seulement quand la page
            recouvre le menu. */}
        {pageAuPremierPlan ? (
          <button
            type="button"
            data-retour-menu-reglages
            onClick={() => setPageAuPremierPlan(false)}
            className="-ml-1 flex items-center gap-0.5 rounded p-1 text-muted hover:bg-raised hover:text-text sm:hidden"
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="text-[13px]">{t('Réglages')}</span>
          </button>
        ) : null}
        <DialogTitle className={cn(pageAuPremierPlan && 'sm:inline hidden')}>
          {pageAuPremierPlan && pageOuverte ? t(pageOuverte.titre) : t('Réglages')}
        </DialogTitle>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ---------------------------- LE MENU ---------------------------- */}
        <nav
          data-menu-reglages
          className={cn(
            'flex min-h-0 w-full flex-col border-border sm:w-[236px] sm:shrink-0 sm:border-r',
            pageAuPremierPlan && 'hidden sm:flex',
          )}
        >
          <div className="shrink-0 px-3 py-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
              <Input
                value={recherche}
                onChange={(event) => setRecherche(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  const premier = resultatsGroupes[0]?.fiches[0];
                  if (premier) ouvrir(premier.cle);
                }}
                placeholder={t('Rechercher un réglage')}
                data-recherche-reglages
                className="h-8 pl-7 text-[13px]"
                autoComplete="off"
              />
            </div>
          </div>

          <ZoneDefilement className="px-2 pb-3">
            <MenuDesReglages
              groupes={resultatsGroupes}
              pageOuverte={pageOuverte?.cle}
              enRecherche={!!recherche.trim()}
              onOuvrir={ouvrir}
            />
          </ZoneDefilement>
        </nav>

        {/* --------------------------- LA PAGE ----------------------------- */}
        <section
          data-page-reglages={pageOuverte?.cle}
          className={cn(
            'flex min-h-0 w-full flex-1 flex-col',
            !pageAuPremierPlan && 'hidden sm:flex',
          )}
        >
          <ZoneDefilement className="p-4">
            <React.Suspense fallback={<SilhouettePageReglages />}>
              {rendu ? (
                <rendu.rendu
                  {...(rendu.avecReglages ? { settings: settings ?? {}, update } : {})}
                  {...(rendu.avecOuverture ? { open } : {})}
                />
              ) : null}
            </React.Suspense>
          </ZoneDefilement>
        </section>
      </div>
    </>
  );
}

/**
 * L'ATTENTE D'UNE PAGE DE RÉGLAGES. Chaque page est chargée à la demande : le
 * temps qu'elle arrive, on montre la FORME qu'elle aura — un titre, quelques
 * lignes, un bloc — et jamais un écran vide qui laisserait croire à une page
 * sans contenu.
 */
function AttentePage() {
  return (
    <div aria-busy="true" data-silhouette="page-reglages" className="flex flex-col gap-4">
      <Silhouette className="h-5 w-40" />
      <div className="flex flex-col gap-2">
        <Silhouette className="h-4 w-full" />
        <Silhouette className="h-4 w-4/5" />
        <Silhouette className="h-4 w-2/3" />
      </div>
      <Silhouette className="h-24 w-full" />
    </div>
  );
}

/** Le menu, groupe par groupe. En recherche, il affiche les résultats. */
function MenuDesReglages({
  groupes,
  pageOuverte,
  enRecherche,
  onOuvrir,
}: {
  groupes: { groupe: string; fiches: FicheDeReglage[] }[];
  pageOuverte?: string;
  enRecherche: boolean;
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
    <div className="space-y-3">
      {groupes.map((groupe) => (
        <div key={groupe.groupe} data-groupe-reglages={groupe.groupe}>
          <p className="px-2 pb-1 text-[11px] uppercase tracking-wide text-faint">{groupe.groupe}</p>
          <div className="space-y-0.5">
            {groupe.fiches.map((fiche) => {
              const Icone = (fiche as any).icone as React.ComponentType<{ className?: string }>;
              return (
                <button
                  key={fiche.cle}
                  type="button"
                  data-page-menu={fiche.cle}
                  data-actif={pageOuverte === fiche.cle ? 'oui' : undefined}
                  onClick={() => onOuvrir(fiche.cle)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13.5px]',
                    pageOuverte === fiche.cle && !enRecherche
                      ? 'bg-raised text-text'
                      : 'text-muted hover:bg-raised/60 hover:text-text',
                  )}
                >
                  {Icone ? <Icone className="h-3.5 w-3.5 shrink-0 text-faint" /> : null}
                  <span className="min-w-0 flex-1 truncate">{fiche.titre}</span>
                  <ChevronRight className="h-3 w-3 shrink-0 text-faint sm:hidden" />
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
