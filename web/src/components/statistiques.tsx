import * as React from 'react';
import { ArrowDown, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUp, ArrowUpDown, ArrowUpRight, BarChart3, Check, Copy, Globe, Hourglass, Loader2, Minus, Play, Plus, RotateCcw, Search, Stethoscope, Trash2, Wrench, X } from 'lucide-react';
import {
  type AnalyseDesParcours,
  type Card,
  type DiagnosticSuivi,
  type EspaceMarketing,
  type EtapeVisiteur,
  type EtatAfficheDuSuivi,
  type FluxDUnParcours,
  type ModeSuivi,
  type NoeudDeFlux,
  type ParcoursDeSuivi,
  type RepereDeSuivi,
  type ResultatsMarketing,
  type ColonneDeLaListe,
  type TableauDeBord,
  type TendanceDesVisites,
  type TodoItem,
  type TriDeLaListe,
  PROFONDEUR_STATISTIQUES_JOURS,
  filtrerLesSites,
  indicateursDe,
  libelleDeRepere,
  separerProjetsActifs,
  tendanceDesVisites,
  triDeLaListe,
  trierLesSites,
} from '@beluga/shared';
import {
  BulleInfo,
  Button,
  ConfirmDialog,
  DialogTitle,
  Drawer,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ZoneDefilement,
} from '@/components/ui';
import { SelecteurPeriode } from '@/components/selecteur-periode';
import { SilhouetteStatistiques } from '@/components/silhouettes';
import {
  BarresParCreneau,
  CourbeParJour,
  CourbesActifs,
  FluxDeComportementSvg,
  FluxDeParcoursSvg,
  MiniCourbe,
  Repartition,
  copier,
  couleurDuSuivi,
  drapeau,
  libelleSuivi,
  montant,
  nomDuPays,
  valeurIndicateur,
} from '@/components/graphiques-statistiques';
import { TableauDeBlocs, type BlocDuTableau } from '@/components/tableau-statistiques';
import { InterrupteurDeSuivi } from '@/components/interrupteur-suivi';
import { PastilleProjet } from '@/components/pastille-projet';
import { SelecteurDeProjet } from '@/components/selecteur-de-projet';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { usePref } from '@/lib/prefs';
import { useTelephone } from '@/lib/telephone';
import { formatRegional, t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * LE SERVICE « STATISTIQUES » (demande du 27/09/2026) — un Google Analytics
 * intégré à Beluga, sorti de l'onglet Statistiques de l'atelier Marketing.
 *
 *  - LA LISTE : les projets Beluga actifs, puis inactifs (même règle que
 *    l'atelier Marketing), puis les SITES AUTONOMES créés ici (« Nouveau
 *    site » : un nom, une adresse, et l'extrait à poser) ;
 *  - LE DÉTAIL d'un site, avec un sélecteur pour passer à un autre, la barre
 *    de période commune (`SelecteurPeriode`) et deux onglets : « Audience »
 *    (courbes et répartitions) et « Parcours » (Suivi complet : chemins,
 *    entonnoir, repères, frise d'un visiteur, lecture résumée) ;
 *  - L'INSTALLATION : un bouton en haut à droite du détail ouvre l'assistant
 *    pas à pas (type de suivi → méthode → code ou tâche lancée).
 *
 * Tout vient du démon à l'ouverture (`statistiques.lister`,
 * `statistiques.detail`) et se relit quand l'événement `marketing` passe.
 */

interface LigneSite {
  id: string;
  nom: string;
  autonome: boolean;
  adresse: string | null;
  modeSuivi: ModeSuivi;
  etatSuivi: string;
  /** Ce que l'écran dit du suivi, la même règle partout (`etatAfficheDuSuivi`). */
  etatAffiche: EtatAfficheDuSuivi;
  actif: boolean;
  visites: number[];
  /** Les chiffres de la liste en tableau, sur 28 jours (`listerLesSites`). */
  visiteurs: number;
  objectifs: number;
  visitesPrecedentes: number;
}

interface DetailSite {
  id: string;
  nom: string;
  autonome: boolean;
  espace: EspaceMarketing;
  resultats: ResultatsMarketing & { tronque: boolean };
  parcours: AnalyseDesParcours;
  parcoursTronque: boolean;
  reperes: (RepereDeSuivi & { posePar: string | null; creeLe: number })[];
  /** Les parcours déclarés (ou le principal déduit) ; leur flux : `tableau.parcours`, même ordre. */
  parcoursDeclares: ParcoursDeSuivi[];
  extrait: string;
  confidentialite: string;
  modeDEmploi: string;
  diagnosticSuivi: DiagnosticSuivi | null;
  carteSuivi: Card | null;
  /** Site autonome : la carte qui l'étudie (dans le projet Beluga), s'il en a une. */
  carteEtude: Card | null;
  /** La carte qui analyse les objectifs (étude d'un site autonome, ou analyse d'un projet). */
  carteObjectifs: Card | null;
  etatAffiche: EtatAfficheDuSuivi;
  /** Le groupe de chiffres complet de la période (`tableauDeBord`). */
  tableau: TableauDeBord;
}

type OngletStats = 'audience' | 'parcours';

/** Ce qu'on demande au démon : une échelle toute prête, ou une plage (`periodeDesStatistiques`). */
interface ChoixDePeriode {
  echelle: number | null;
  debut: number;
  fin: number;
}

const UN_JOUR = 86_400_000;

export function Statistiques({
  open,
  onClose,
  enPage,
  vise,
  onVise,
  onOuvrirCarte,
}: {
  open: boolean;
  onClose: () => void;
  enPage?: boolean;
  /** LE SITE DÉSIGNÉ PAR L'ADRESSE : « #statistiques/<site> ». */
  vise?: string | null;
  onVise?: (siteId: string | null) => void;
  onOuvrirCarte?: (card: Card) => void;
}) {
  const state = useApp();
  const version = Object.values(state.marketingVersions).reduce((a, b) => a + b, 0);
  const [liste, setListe] = React.useState<{ sites: LigneSite[]; jours: string[] } | null>(null);
  const [creation, setCreation] = React.useState(false);
  /** LA RECHERCHE DE LA LISTE : oubliée à la fermeture, jamais gardée d'une visite à l'autre. */
  const [recherche, setRecherche] = React.useState('');
  /** Un site tout juste créé s'ouvre sur l'assistant, directement au code à poser. */
  const [assistantVoulu, setAssistantVoulu] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    let vivant = true;
    client
      .call<{ sites: LigneSite[]; jours: string[] }>({ type: 'statistiques.lister' })
      .then((r) => vivant && setListe(r))
      .catch(() => vivant && setListe((l) => l ?? { sites: [], jours: [] }));
    return () => {
      vivant = false;
    };
  }, [open, version]);

  const ouvrir = (id: string | null, assistant = false) => {
    setAssistantVoulu(assistant);
    onVise?.(id);
  };

  return (
    <Drawer open={open} onClose={onClose} enPage={enPage}>
      {vise ? (
        <DetailDuSite key={vise} id={vise} sites={liste?.sites ?? []} assistantInitial={assistantVoulu} onChoisir={(id) => ouvrir(id)} onOuvrirCarte={onOuvrirCarte} />
      ) : (
        <>
          <header className="flex shrink-0 items-center gap-2 px-3 pb-2">
            <BarChart3 className="h-3.5 w-3.5 shrink-0 text-accent" />
            <DialogTitle className="min-w-0 flex-1 truncate">{t('Statistiques')}</DialogTitle>
            <Button size="sm" onClick={() => setCreation(true)} data-stats-nouveau-site>
              <Plus className="h-3.5 w-3.5" />
              {t('Nouveau site')}
            </Button>
          </header>
          <div className="shrink-0 px-3 pb-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
              <Input
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && recherche && (e.stopPropagation(), setRecherche(''))}
                placeholder={t('Rechercher un projet ou un site')}
                aria-label="Rechercher un projet ou un site"
                className="pl-7 pr-8"
                data-stats-recherche
              />
              {recherche ? (
                <button
                  type="button"
                  onClick={() => setRecherche('')}
                  aria-label="Effacer la recherche"
                  title={t('Effacer la recherche')}
                  className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-sm text-faint hover:text-text"
                  data-stats-recherche-effacer
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          </div>
          <ZoneDefilement fond="hsl(var(--surface))" className="px-3 pb-3">
            {liste === null ? <SilhouetteStatistiques /> : <ListeDesSites sites={liste.sites} recherche={recherche} onOuvrir={(id) => ouvrir(id)} />}
          </ZoneDefilement>
        </>
      )}
      <TiroirNouveauSite ouvert={creation} onClose={() => setCreation(false)} onCree={(id) => ouvrir(id, true)} />
    </Drawer>
  );
}

/**
 * LE VISAGE D'UN SITE devant son nom (demande du 28/09/2026) : le favicon du
 * projet, celui de la colonne de gauche (`PastilleProjet`, récupéré par le
 * serveur), sinon ses initiales. Un site autonome n'a pas de projet, donc pas
 * de favicon : il garde son globe.
 */
function IconeDuSite({ site }: { site: Pick<LigneSite, 'id' | 'nom' | 'autonome'> }) {
  const projet = useApp().projects.find((p) => p.id === site.id);
  if (site.autonome) return <Globe className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden data-stats-icone-autonome />;
  return <PastilleProjet project={projet ?? { name: site.nom, favicon: undefined }} />;
}

/**
 * LA LISTE, EN TABLEAU TRIABLE (demande du 28/09/2026) : les projets actifs en
 * haut, les inactifs (suivi marketing coupé) dessous — même règle que
 * l'atelier Marketing, `separerProjetsActifs` —, puis les sites autonomes.
 * Un seul tableau, un corps par groupe : les colonnes restent alignées d'un
 * groupe à l'autre et le tri (`trierLesSites`) s'applique aux trois à la fois.
 * Le nom à gauche, les chiffres des 28 derniers jours alignés à droite, et la
 * flèche de popularité (`tendanceDesVisites`) en dernier. Un clic sur un
 * entête trie, un second inverse ; le tri est une PRÉFÉRENCE gardée.
 *
 * LA RECHERCHE (`filtrerLesSites`) filtre les trois groupes à la fois, sur le
 * nom et l'adresse : chaque compteur suit le filtre, un groupe vide disparaît,
 * et une phrase le dit quand rien ne correspond.
 */
function ListeDesSites({ sites, recherche, onOuvrir }: { sites: LigneSite[]; recherche: string; onOuvrir: (id: string) => void }) {
  const [garde, garder] = usePref<TriDeLaListe | null>('statistiques.liste.tri', null);
  // Le titre d'un groupe couvre EXACTEMENT les colonnes affichées : plus large, il en créerait de fantômes.
  const colonnes = useTelephone() ? 3 : 6;
  const tri = triDeLaListe(garde);
  const retenus = trierLesSites(filtrerLesSites(sites, recherche), tri);
  const { actifs, inactifs } = separerProjetsActifs(retenus.filter((s) => !s.autonome));
  const autonomes = retenus.filter((s) => s.autonome);
  const filtre = recherche.trim().length > 0;
  if (!sites.length) return <p className="px-1 py-3 text-[12.5px] text-faint">{t('Aucun site mesuré.')}</p>;
  if (!retenus.length) {
    return (
      <p className="px-1 py-3 text-[12.5px] text-faint" data-stats-recherche-vide>
        {t('Aucun projet ni site ne correspond à « {texte} ».', { texte: recherche.trim() })}
      </p>
    );
  }
  // Une colonne neuve part du plus grand chiffre ; le nom, de A à Z.
  const trierPar = (colonne: ColonneDeLaListe) =>
    garder(tri.colonne === colonne ? { colonne, sens: tri.sens === 'asc' ? 'desc' : 'asc' } : { colonne, sens: colonne === 'nom' ? 'asc' : 'desc' });
  const entete = (colonne: ColonneDeLaListe, libelle: string, className?: string) => (
    <EnteteDeColonne colonne={colonne} libelle={libelle} tri={tri} onTrier={trierPar} className={className} />
  );
  return (
    <table className="w-full table-fixed border-collapse text-left" data-stats-liste={retenus.length} data-stats-tri={`${tri.colonne}:${tri.sens}`}>
      <thead>
        <tr className="text-[11.5px] text-faint">
          {entete('nom', t('Projet'), 'pl-1')}
          <th className="hidden w-20 px-2 py-1.5 font-normal sm:table-cell" aria-hidden />
          {entete('visites', t('Visites'), 'w-[4.5rem] sm:w-24')}
          {entete('visiteurs', t('Visiteurs'), 'hidden w-24 sm:table-cell')}
          {entete('objectifs', t('Objectifs'), 'hidden w-24 sm:table-cell')}
          {entete('tendance', t('Tendance'), 'w-24 pr-3 sm:w-28')}
        </tr>
      </thead>
      {actifs.length || !filtre ? <GroupeDeSites titre={t('Projets actifs')} groupe="actifs" sites={actifs} colonnes={colonnes} onOuvrir={onOuvrir} /> : null}
      {inactifs.length ? <GroupeDeSites titre={t('Projets inactifs')} groupe="inactifs" sites={inactifs} colonnes={colonnes} onOuvrir={onOuvrir} /> : null}
      {autonomes.length || !filtre ? (
        <GroupeDeSites
          titre={t('Sites autonomes')}
          groupe="autonomes"
          sites={autonomes}
          colonnes={colonnes}
          onOuvrir={onOuvrir}
          vide={t('Aucun site autonome : « Nouveau site » en crée un et donne son code de suivi.')}
        />
      ) : null}
    </table>
  );
}

function EnteteDeColonne({
  colonne,
  libelle,
  tri,
  onTrier,
  className,
}: {
  colonne: ColonneDeLaListe;
  libelle: string;
  tri: TriDeLaListe;
  onTrier: (colonne: ColonneDeLaListe) => void;
  className?: string;
}) {
  const actif = tri.colonne === colonne;
  const aDroite = colonne !== 'nom';
  return (
    <th
      className={cn('px-2 py-1.5 font-normal', aDroite && 'text-right', className)}
      aria-sort={actif ? (tri.sens === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onTrier(colonne)}
        className={cn('inline-flex max-w-full items-center gap-1 hover:text-text', aDroite && 'flex-row-reverse', actif && 'text-text')}
        data-stats-tri-colonne={colonne}
      >
        <span className="truncate">{libelle}</span>
        {actif ? (
          tri.sens === 'asc' ? <ArrowUp className="h-3 w-3 shrink-0" /> : <ArrowDown className="h-3 w-3 shrink-0" />
        ) : (
          <ArrowUpDown className="h-3 w-3 shrink-0 opacity-40" />
        )}
      </button>
    </th>
  );
}

function GroupeDeSites({
  titre,
  groupe,
  sites,
  colonnes,
  onOuvrir,
  vide,
}: {
  titre: string;
  groupe: string;
  sites: LigneSite[];
  colonnes: number;
  onOuvrir: (id: string) => void;
  vide?: string;
}) {
  const chiffre = (n: number) => n.toLocaleString(formatRegional());
  return (
    <tbody data-stats-groupe={groupe}>
      <tr>
        <th colSpan={colonnes} scope="colgroup" className="px-1 pb-1 pt-4 text-left text-[12px] font-medium text-faint">
          {titre} <span className="tabular-nums">· {sites.length}</span>
        </th>
      </tr>
      {sites.length ? (
        sites.map((s) => {
          const total = s.visites.reduce((a, b) => a + b, 0);
          return (
            <tr
              key={s.id}
              onClick={() => onOuvrir(s.id)}
              data-stats-site={s.id}
              className="cursor-pointer border-t-2 border-surface bg-bloc text-[12.5px] transition-colors hover:bg-bloc/70"
            >
              <td className="min-w-0 rounded-l-md py-2 pl-3 pr-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <IconeDuSite site={s} />
                  <button
                    type="button"
                    onClick={(e) => (e.stopPropagation(), onOuvrir(s.id))}
                    className="min-w-0 truncate text-left text-[13px] font-medium text-text"
                  >
                    {s.nom}
                  </button>
                  {s.modeSuivi === 'visiteur' ? (
                    <span className="shrink-0 rounded-sm bg-accent/15 px-1.5 text-[11px] text-accent max-sm:hidden" data-stats-mode-visiteur>
                      {t('Suivi complet')}
                    </span>
                  ) : null}
                </span>
                <span className="block truncate text-[12px] text-faint">
                  {s.adresse ?? t('Aucune adresse')} ·{' '}
                  <span className={couleurDuSuivi(s.etatAffiche)} data-stats-etat={s.etatAffiche}>
                    {libelleSuivi(s.etatAffiche)}
                  </span>
                </span>
              </td>
              <td className="hidden px-2 py-2 sm:table-cell">
                <MiniCourbe valeurs={s.visites} />
              </td>
              <td className="px-2 py-2 text-right tabular-nums text-text" data-stats-visites={total}>
                {chiffre(total)}
              </td>
              <td className="hidden px-2 py-2 text-right tabular-nums text-text sm:table-cell" data-stats-visiteurs={s.visiteurs}>
                {chiffre(s.visiteurs)}
              </td>
              <td className="hidden px-2 py-2 text-right tabular-nums text-text sm:table-cell" data-stats-objectifs-atteints={s.objectifs}>
                {chiffre(s.objectifs)}
              </td>
              <td className="rounded-r-md py-2 pl-2 pr-3 text-right">
                <FlecheDeTendance tendance={tendanceDesVisites(total, s.visitesPrecedentes)} />
              </td>
            </tr>
          );
        })
      ) : vide ? (
        <tr>
          <td colSpan={colonnes} className="px-1 text-[12.5px] text-faint">
            {vide}
          </td>
        </tr>
      ) : null}
    </tbody>
  );
}

/** LA FLÈCHE DE POPULARITÉ : verte qui monte, rouge qui descend, un trait quand rien ne bouge. */
function FlecheDeTendance({ tendance }: { tendance: TendanceDesVisites }) {
  const { sens, ecart } = tendance;
  const texte = ecart === null ? (sens === 'hausse' ? t('Nouveau') : '—') : `${ecart > 0 ? '+' : ''}${ecart.toLocaleString(formatRegional())} %`;
  // « Aucune » : un seul tiret, sans icône ; « stable » garde son écart et un trait plat.
  const Icone = sens === 'hausse' ? ArrowUpRight : sens === 'baisse' ? ArrowDownRight : sens === 'stable' ? Minus : null;
  return (
    <span
      className={cn(
        'inline-flex items-center justify-end gap-0.5 tabular-nums',
        sens === 'hausse' ? 'text-success' : sens === 'baisse' ? 'text-danger' : 'text-faint',
      )}
      title={t('Visites des 28 derniers jours comparées aux 28 jours d’avant')}
      data-stats-tendance={sens}
    >
      <span className="truncate">{texte}</span>
      {Icone ? <Icone className="h-3.5 w-3.5 shrink-0" /> : null}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Le détail d'un site                                                  */
/* ------------------------------------------------------------------ */

/**
 * LE BOUTON D'INSTALLATION DIT L'ÉTAT RÉEL (demande du 28/09/2026) : « Suivi
 * installé » seulement quand une visite est arrivée — un code posé sans visite
 * ne se dit plus installé (HaikoDev), il se dit « en attente de visites ».
 */
function boutonDuSuivi(etat: EtatAfficheDuSuivi): { libelle: string; icone: React.ReactNode; principal: boolean } {
  switch (etat) {
    case 'verifie':
      return { libelle: t('Suivi installé'), icone: <Check className="h-3.5 w-3.5" />, principal: false };
    case 'installation':
      return { libelle: t('Installation en cours'), icone: <Loader2 className="h-3.5 w-3.5 animate-spin" />, principal: false };
    case 'attente':
      return { libelle: t('En attente de visites'), icone: <Hourglass className="h-3.5 w-3.5" />, principal: false };
    default:
      return { libelle: t('Installer'), icone: <Wrench className="h-3.5 w-3.5" />, principal: true };
  }
}

/**
 * LE NOM DU SITE, EN TÊTE DE SA FICHE, ouvre le menu qui passe d'un site à
 * l'autre (demande du 28/09/2026) — le même `SelecteurDeProjet` que l'atelier
 * Marketing. Le menu ne liste que les PROJETS ACTIFS (ni inactifs, ni sites
 * autonomes) ; le site ouvert garde pourtant son icône en tête, cherché dans
 * la liste complète.
 */
function SelecteurDeSite({ id, nom, sites, onChoisir }: { id: string; nom: string; sites: LigneSite[]; onChoisir: (id: string | null) => void }) {
  const site = sites.find((s) => s.id === id);
  return (
    <SelecteurDeProjet
      id={id}
      nom={nom}
      icone={site ? <IconeDuSite site={site} /> : null}
      choix={sites.filter((s) => !s.autonome && s.actif).map((s) => ({ id: s.id, nom: s.nom, adresse: s.adresse, icone: <IconeDuSite site={s} /> }))}
      onChoisir={onChoisir}
      repere="stats"
      libelleFiltre={t('Filtrer les sites')}
      libelleVide={t('Aucun site ne correspond.')}
    />
  );
}

function DetailDuSite({
  id,
  sites,
  assistantInitial,
  onChoisir,
  onOuvrirCarte,
}: {
  id: string;
  sites: LigneSite[];
  assistantInitial?: boolean;
  onChoisir: (id: string | null) => void;
  onOuvrirCarte?: (card: Card) => void;
}) {
  const state = useApp();
  const version = state.marketingVersions[id] ?? 0;
  const [periode, setPeriode] = React.useState<ChoixDePeriode>(() => ({ echelle: 30, debut: Date.now() - 30 * UN_JOUR, fin: Date.now() }));
  const [detail, setDetail] = React.useState<DetailSite | null>(null);
  const [onglet, setOnglet] = React.useState<OngletStats>('audience');
  const [assistant, setAssistant] = React.useState(!!assistantInitial);

  React.useEffect(() => {
    let vivant = true;
    const demande = periode.echelle !== null ? { jours: periode.echelle } : { debut: periode.debut, fin: periode.fin };
    client
      .call<DetailSite>({ type: 'statistiques.detail', id, ...demande })
      .then((r) => vivant && setDetail(r))
      .catch((err: any) => {
        if (!vivant) return;
        client.pushToast('error', err?.message ?? t('Statistiques illisibles'));
        onChoisir(null);
      });
    return () => {
      vivant = false;
    };
  }, [id, version, periode.echelle, periode.debut, periode.fin]);

  const nom = detail?.nom ?? sites.find((s) => s.id === id)?.nom ?? t('Statistiques');
  /** LE CHOIX DES DATES vit dans la barre d'outils de chaque onglet, juste avant « Blocs ». */
  const dates = (
    <SelecteurPeriode
      echelle={periode.echelle}
      debut={periode.debut}
      fin={periode.fin}
      min={Date.now() - PROFONDEUR_STATISTIQUES_JOURS * UN_JOUR}
      onEchelle={(n) => setPeriode({ echelle: n, debut: Date.now() - n * UN_JOUR, fin: Date.now() })}
      onLibre={(debut, fin) => setPeriode({ echelle: null, debut, fin })}
    />
  );
  const bouton = detail ? boutonDuSuivi(detail.etatAffiche) : null;
  return (
    <>
      <header className="flex shrink-0 items-center gap-2 px-3 pb-2">
        <Button variant="ghost" size="icon" aria-label="Tous les sites" title={t('Tous les sites')} onClick={() => onChoisir(null)} data-stats-retour>
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <SelecteurDeSite id={id} nom={nom} sites={sites} onChoisir={onChoisir} />
        {/* « SUIVI ACTIF » : le même réglage que l'atelier Marketing — éteint, le
            projet passe dans « Projets inactifs ». Un site autonome n'a pas cet état. */}
        {detail && !detail.autonome ? <InterrupteurDeSuivi projectId={detail.id} actif={detail.espace.actif !== false} libelle={t('Suivi actif')} repere="Suivi actif" /> : null}
        {/* L'INSTALLATION N'EST PLUS UN ONGLET (demande du 28/09/2026) : un
            bouton, en haut à droite, ouvre l'assistant pas à pas. */}
        {detail && bouton ? (
          <Button
            size="sm"
            variant={bouton.principal ? 'default' : 'subtle'}
            className="shrink-0"
            onClick={() => setAssistant(true)}
            data-stats-installer={detail.etatAffiche}
          >
            {bouton.icone}
            {bouton.libelle}
          </Button>
        ) : null}
      </header>
      {!detail ? (
        <div className="px-3">
          <SilhouetteStatistiques lignes={3} />
        </div>
      ) : (
        <Tabs value={onglet} onValueChange={(v) => setOnglet(v as OngletStats)} className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center px-3 pb-2">
            <TabsList defilable>
              <TabsTrigger value="audience" data-stats-onglet="audience">{t('Audience')}</TabsTrigger>
              <TabsTrigger value="parcours" data-stats-onglet="parcours">{t('Parcours')}</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="audience" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
            <ZoneDefilement fond="hsl(var(--surface))" className="px-3 pb-4">
              <Audience detail={detail} dates={dates} onInstaller={() => setAssistant(true)} />
            </ZoneDefilement>
          </TabsContent>
          <TabsContent value="parcours" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
            <ZoneDefilement fond="hsl(var(--surface))" className="px-3 pb-4">
              <Parcours detail={detail} dates={dates} onInstaller={() => setAssistant(true)} onOuvrirCarte={onOuvrirCarte} />
            </ZoneDefilement>
          </TabsContent>
        </Tabs>
      )}
      {detail && assistant ? (
        <AssistantInstallation
          detail={detail}
          etapeInitiale={assistantInitial && detail.autonome ? 3 : 1}
          onClose={() => setAssistant(false)}
          onOuvrirCarte={onOuvrirCarte}
          onRetire={() => onChoisir(null)}
        />
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Audience                                                             */
/* ------------------------------------------------------------------ */

/**
 * LE BANDEAU AU-DESSUS DES CHIFFRES, quand aucune visite n'est mesurée : il dit
 * l'état réel du suivi (`etatAfficheDuSuivi`) et propose le SEUL geste utile —
 * installer tant que rien n'est posé, suivre l'installation en cours, ou
 * tester le suivi quand le code est posé mais qu'aucune visite n'arrive.
 */
function BandeauDuSuivi({ detail, onInstaller }: { detail: DetailSite; onInstaller: () => void }) {
  const etat = detail.etatAffiche;
  const phrase =
    etat === 'verifie'
      ? t('Aucune visite mesurée sur cette période.')
      : etat === 'installation'
        ? t('L’installation est en cours : les chiffres arriveront une fois le site mis en ligne.')
        : etat === 'attente'
          ? t('Le code est posé sur le site, mais aucune visite n’a encore été reçue.')
          : etat === 'probleme'
            ? t('Le code de suivi lu sur le site est à corriger.')
            : t('Les chiffres arrivent dès que le code de suivi est posé sur le site.');
  return (
    <div className="flex flex-col gap-1.5 rounded-md bg-bloc px-3 py-2.5 text-[12.5px] text-muted" data-marketing-statistiques-vide={etat}>
      <p>
        {phrase}{' '}
        {etat === 'absent' || etat === 'probleme' ? (
          <button type="button" className="text-accent underline-offset-2 hover:underline" onClick={onInstaller}>
            {t('Installer le suivi')}
          </button>
        ) : etat === 'installation' ? (
          <button type="button" className="text-accent underline-offset-2 hover:underline" onClick={onInstaller}>
            {t('Suivre l’installation')}
          </button>
        ) : null}
      </p>
      {etat === 'attente' ? <TesterLeSuivi id={detail.id} /> : null}
    </div>
  );
}

/** Ce que le test rend, en mots courants — et ce qu'il reste à faire. */
function phraseDuTest(diagnostic: DiagnosticSuivi): string {
  switch (diagnostic) {
    case 'ok':
      return t('Le code est bien sur la page en ligne. Visitez le site depuis un navigateur ordinaire : une visite avec « Ne pas me suivre », un bloqueur de publicités ou un robot n’est pas comptée.');
    case 'absent':
      return t('Le code de suivi n’est pas sur la page en ligne : le site n’a peut-être pas encore été mis en ligne avec lui.');
    case 'mauvaise-cle':
      return t('La page en ligne porte un autre code de suivi que celui de ce site.');
    case 'ancien-outil':
      return t('La page en ligne porte encore l’ancien outil de statistiques.');
    default:
      return t('Le site ne répond pas pour l’instant : réessayez dans un moment.');
  }
}

/** « TESTER LE SUIVI » : le démon relit la page en ligne tout de suite et dit ce qu'elle porte. */
function TesterLeSuivi({ id }: { id: string }) {
  const [envoi, setEnvoi] = React.useState(false);
  const [resultat, setResultat] = React.useState<DiagnosticSuivi | null>(null);
  const tester = async () => {
    setEnvoi(true);
    try {
      const r = await client.call<{ diagnostic: DiagnosticSuivi }>({ type: 'statistiques.testerSuivi', id });
      setResultat(r.diagnostic);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Test impossible'));
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <div className="flex flex-col gap-1.5" data-stats-tester>
      <Button size="sm" variant="subtle" className="self-start" disabled={envoi} onClick={() => void tester()} data-stats-tester-bouton>
        {envoi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Stethoscope className="h-3.5 w-3.5" />}
        {envoi ? t('Test en cours…') : t('Tester le suivi')}
      </Button>
      {resultat ? (
        <p className={cn('text-[12px]', resultat === 'ok' ? 'text-termine' : 'text-danger')} data-stats-tester-resultat={resultat}>
          {phraseDuTest(resultat)}
        </p>
      ) : null}
    </div>
  );
}

/** Les jours de la semaine, lundi d'abord, dans la langue de l'écran. */
function joursDeLaSemaine(): string[] {
  // Le 5 janvier 2026 est un lundi.
  return Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2026, 0, 5 + i, 12)).toLocaleDateString(formatRegional(), { weekday: 'short' }));
}

/** La base qui relie une adresse à son pays (licence CC BY 4.0) : un nom propre, cité sous le bloc des pays. */
const SOURCE_DES_PAYS = 'DB-IP';

/** Une source de visite, dite en mots courants. */
function nomDeSource(source: string): string {
  return source === 'direct' ? t('Direct') : source === 'recherche' ? t('Moteurs de recherche') : source;
}

function nomDAppareil(appareil: string): string {
  return t(appareil === 'mobile' ? 'Téléphone' : appareil === 'tablette' ? 'Tablette' : 'Ordinateur');
}

/**
 * L'AUDIENCE, EN BLOCS (demande du 28/09/2026) : chiffres clés, courbes,
 * utilisateurs actifs, pays, provenance, appareils, heures et jours, pages
 * d'entrée et de sortie… Chaque bloc se déplace et se masque
 * (`TableauDeBlocs`). Rebond, durée et pages par session viennent des
 * SESSIONS du tableau de bord (`tableauDeBord`), pas des pages vues seules.
 */
function Audience({ detail, dates, onInstaller }: { detail: DetailSite; dates: React.ReactNode; onInstaller: () => void }) {
  const r = detail.resultats;
  const tb = detail.tableau;
  const config = detail.espace.configuration;
  const indicateurs = indicateursDe(config.nature);
  const parJour = r.parJour ?? [];
  const avecVentes = parJour.some((j) => (j.ventes ?? 0) > 0);
  const avecObjectifs = parJour.some((j) => (j.objectifs ?? 0) > 0);
  const aucuneVisite = !(r.totaux.visites ?? 0);
  const valeur = (cle: string): number | null | undefined =>
    cle === 'rebond' ? tb.rebond : cle === 'duree' ? tb.dureeMoyenne : cle === 'pagesParVisite' ? tb.pagesParSession : r.totaux[cle as keyof typeof r.totaux];
  const heures = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')} h`);
  const blocs: BlocDuTableau[] = [
    {
      id: 'chiffres',
      titre: t('Chiffres clés'),
      large: true,
      rendu: () => (
        <div className="grid grid-cols-2 gap-1.5 rounded-md bg-bloc p-1.5 sm:grid-cols-3" data-stats-bloc="chiffres" data-stats-titre>
          <Tuile cle="sessions" libelle={t('Sessions')} valeur={tb.sessions.toLocaleString(formatRegional())} explication={t('Une session : les pages vues d’affilée par une même personne, jusqu’à trente minutes d’absence.')} />
          <Tuile cle="utilisateurs" libelle={t('Utilisateurs')} valeur={tb.utilisateurs.toLocaleString(formatRegional())} explication={t('Les personnes différentes : reconnues en suivi complet, comptées jour par jour en suivi anonyme.')} />
          {indicateurs.map((i) => (
            <Tuile key={i.cle} cle={i.cle} libelle={t(i.libelle)} valeur={valeurIndicateur(i.cle, valeur(i.cle))} explication={t(i.explication)} />
          ))}
        </div>
      ),
    },
    { id: 'visites', titre: t('Visites par jour'), large: true, rendu: () => <CourbeParJour cle="visites" titre={t('Visites par jour')} points={parJour.map((j) => ({ jour: j.jour, valeur: j.visites }))} /> },
    { id: 'actifs', titre: t('Utilisateurs actifs'), large: true, rendu: () => <CourbesActifs points={tb.actifs} /> },
    { id: 'visiteurs', titre: t('Visiteurs par jour'), large: true, rendu: () => <CourbeParJour cle="visiteurs" titre={t('Visiteurs par jour')} points={parJour.map((j) => ({ jour: j.jour, valeur: j.visiteurs }))} /> },
    { id: 'flux', titre: t('Flux de comportement'), large: true, rendu: () => <BlocFluxDeComportement detail={detail} onInstaller={onInstaller} /> },
    {
      id: 'pays',
      titre: t('Sessions par pays'),
      rendu: () => (
        <Repartition
          cle="pays"
          titre={t('Sessions par pays')}
          lignes={tb.pays.map((p) => [`${drapeau(p.pays)} ${nomDuPays(p.pays)}`.trim(), p.sessions])}
          pied={
            <span className="text-[10.5px] text-faint">
              {t('Pays déduit à la visite, adresse jamais gardée —')}{' '}
              <a href="https://db-ip.com" target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
                {SOURCE_DES_PAYS}
              </a>
            </span>
          }
        />
      ),
    },
    { id: 'sources', titre: t('Provenance'), rendu: () => <Repartition cle="sources" titre={t('Provenance')} lignes={tb.sources.map((x) => [nomDeSource(x.source), x.sessions])} /> },
    { id: 'appareils', titre: t('Sessions par appareil'), rendu: () => <Repartition cle="appareils" titre={t('Sessions par appareil')} lignes={tb.appareils.map((a) => [nomDAppareil(a.appareil), a.sessions])} /> },
    {
      id: 'heures',
      titre: t('Sessions par heure'),
      rendu: () => (
        <BarresParCreneau
          cle="heures"
          titre={t('Sessions par heure')}
          valeurs={tb.parHeure}
          etiquettes={heures}
          graduations={[0, 6, 12, 18]}
          note={t('Heure du serveur ({fuseau})', { fuseau: tb.fuseau })}
        />
      ),
    },
    { id: 'semaine', titre: t('Sessions par jour de la semaine'), rendu: () => <BarresParCreneau cle="semaine" titre={t('Sessions par jour de la semaine')} valeurs={tb.parJourDeSemaine} etiquettes={joursDeLaSemaine()} /> },
    { id: 'pages', titre: t('Pages les plus vues'), rendu: () => <Repartition cle="pages" titre={t('Pages les plus vues')} lignes={r.pages.map((x) => [x.chemin, x.vues])} /> },
    { id: 'entrees', titre: t('Pages d’entrée'), rendu: () => <Repartition cle="entrees" titre={t('Pages d’entrée')} lignes={tb.entrees.map((x) => [x.chemin, x.sessions])} /> },
    { id: 'sorties', titre: t('Pages de sortie'), rendu: () => <Repartition cle="sorties" titre={t('Pages de sortie')} lignes={tb.sorties.map((x) => [x.chemin, x.sessions])} /> },
    { id: 'reperes', titre: t('Clics par repère'), rendu: () => <Repartition cle="reperes" titre={t('Clics par repère')} lignes={detail.parcours.reperes.map((x) => [x.nom, x.clics])} /> },
    ...(avecObjectifs
      ? [{ id: 'objectifs-jour', titre: t('Objectifs atteints par jour'), large: true, rendu: () => <CourbeParJour cle="objectifs" barres titre={t('Objectifs atteints par jour')} points={parJour.map((j) => ({ jour: j.jour, valeur: j.objectifs ?? 0 }))} /> }]
      : []),
    ...(avecVentes
      ? [
          {
            id: 'ventes-jour',
            titre: t('Chiffre d’affaires par jour'),
            large: true,
            rendu: () => <CourbeParJour cle="ventes" barres titre={t('Chiffre d’affaires par jour')} format={(v) => montant(Math.round(v))} points={parJour.map((j) => ({ jour: j.jour, valeur: j.montantCentimes ?? 0 }))} />,
          },
        ]
      : []),
  ];
  return (
    <div className="flex flex-col gap-3" data-marketing-statistiques={r.totaux.visites ?? 0}>
      <TableauDeBlocs onglet="audience" blocs={blocs} outils={dates} avant={aucuneVisite ? <BandeauDuSuivi detail={detail} onInstaller={onInstaller} /> : null} />
      {r.tronque ? <p className="text-[12px] text-warning">{t('Période très chargée : seuls les passages les plus récents sont comptés.')}</p> : null}
    </div>
  );
}

function Tuile({ cle, libelle, valeur, explication }: { cle: string; libelle: string; valeur: string; explication: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md bg-surface/40 px-3 py-2" data-marketing-indicateur={cle} title={explication}>
      <span className="truncate text-[12px] text-faint">{libelle}</span>
      <span className="text-[18px] font-medium text-text">{valeur}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Parcours                                                             */
/* ------------------------------------------------------------------ */

/** Le nom d'un parcours : le sien, ou « Parcours principal » pour celui déduit des anciens objectifs. */
function nomDuParcours(p: ParcoursDeSuivi): string {
  return p.nom || t('Parcours principal');
}

/** Une page de départ, en mots courants : « autres » regroupe le reste. */
function nomDeLaPage(chemin: string | null): string {
  return chemin === null ? t('autres pages') : chemin;
}

/**
 * LE RÉSUMÉ, à gauche de la barre d'outils du Parcours : combien de parcours
 * l'agent a définis, et la date de sa dernière analyse.
 */
function ResumeDesParcours({ detail }: { detail: DetailSite }) {
  const n = detail.parcoursDeclares.length;
  const derniere = detail.reperes.length ? Math.max(...detail.reperes.map((r) => r.creeLe)) : null;
  return (
    <div className="flex min-w-0 flex-col gap-0.5" data-stats-objectifs={n}>
      <span className="text-[12.5px] text-text">{n ? t('{n} parcours définis par l’agent', { n }) : <span className="text-muted">{t('Aucun parcours défini pour ce site.')}</span>}</span>
      <span className="text-[11.5px] text-faint">
        {derniere ? t('Dernière analyse : {date}', { date: new Date(derniere).toLocaleDateString(formatRegional(), { day: 'numeric', month: 'long', year: 'numeric' }) }) : t('Jamais analysé')}
      </span>
    </div>
  );
}

/**
 * LE BOUTON DE L'AGENT, avant le choix des dates dans la barre d'outils du
 * Parcours : « Relancer l'analyse des objectifs » pour un site dont le parcours
 * a pu changer. Tant qu'une carte d'analyse (ou d'installation, qui fixe aussi
 * les objectifs) est en demande ou au travail, il devient « Voir l'agent au
 * travail ».
 */
function BoutonDeLAgent({ detail, onOuvrirCarte }: { detail: DetailSite; onOuvrirCarte?: (card: Card) => void }) {
  const [envoi, setEnvoi] = React.useState(false);
  const [lancee, setLancee] = React.useState<Card | null>(null);
  const carte = carteEnTravail(lancee) ?? carteEnTravail(detail.carteObjectifs) ?? (detail.autonome ? null : carteEnTravail(detail.carteSuivi));
  const analyser = async () => {
    setEnvoi(true);
    try {
      const r = await client.call<{ card: Card; deja: boolean }>({ type: 'statistiques.analyserObjectifs', id: detail.id });
      setLancee(r.card);
      client.pushToast(r.deja ? 'info' : 'success', r.deja ? t('Une analyse est déjà en cours pour ce site.') : t('Analyse des objectifs demandée : sa carte attend votre feu vert.'));
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Analyse impossible à demander'));
    } finally {
      setEnvoi(false);
    }
  };
  return carte && onOuvrirCarte ? (
    <Button size="sm" variant="subtle" className="shrink-0" onClick={() => onOuvrirCarte(carte)} data-stats-relancer-objectifs="ouvrir">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      {t('Voir l’agent au travail')}
    </Button>
  ) : (
    <Button size="sm" variant="subtle" className="shrink-0" disabled={envoi || !!carte} onClick={() => void analyser()} data-stats-relancer-objectifs="relancer">
      {envoi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
      {envoi ? t('Envoi…') : detail.parcoursDeclares.length ? t('Relancer l’analyse des objectifs') : t('Analyser les objectifs')}
    </Button>
  );
}

/** Le nom d'un nœud du flux de comportement. */
function nomDuNoeud(n: NoeudDeFlux): string {
  if (n.genre === 'autres') return t('{n} autres', { n: Number(n.nom) });
  if (n.genre === 'source') return nomDeSource(n.nom);
  return n.nom;
}

/**
 * LE FLUX DE COMPORTEMENT, bloc de l'onglet Audience (demande du 29/09/2026) :
 * il ne se lit qu'en suivi complet, les pages d'une même session n'étant
 * reliées qu'après l'accord du visiteur.
 */
function BlocFluxDeComportement({ detail, onInstaller }: { detail: DetailSite; onInstaller: () => void }) {
  const complet = detail.espace.modeSuivi === 'visiteur' || detail.tableau.flux.colonnes.length > 0;
  return (
    <Bloc titre={t('Flux de comportement')} repere="flux" aide={t('D’où viennent les sessions, sur quelle page elles arrivent, puis leurs trois étapes suivantes. En rouge : celles qui s’arrêtent là.')}>
      {complet ? (
        <FluxDeComportementSvg flux={detail.tableau.flux} libelle={nomDuNoeud} />
      ) : (
        <p className="text-[12px] text-faint" data-stats-flux="anonyme">
          {t('Le flux de comportement demande le Suivi complet : en anonyme, les pages d’une même visite ne sont pas reliées.')}{' '}
          <button type="button" className="text-accent underline-offset-2 hover:underline" onClick={onInstaller}>
            {t('Changer le type de suivi')}
          </button>
        </p>
      )}
    </Bloc>
  );
}

/** Une étape vue dans un chemin : le libellé lisible d'un repère quand un parcours le nomme. */
function libelleDEtape(x: EtapeVisiteur, libelles: Map<string, string>): string {
  if (x.genre === 'page') return x.nom;
  return libelles.get(x.nom) ?? libelleDeRepere(x.nom);
}

/** La teinte d'une étape dans une frise : page, repère cliqué, ou étape d'un parcours. */
function teinteDEtape(x: EtapeVisiteur, libelles: Map<string, string>): string {
  if (x.genre === 'page') return 'hsl(var(--faint))';
  return libelles.has(x.nom) || x.genre === 'objectif' ? 'hsl(var(--serie-2))' : 'hsl(var(--serie-1))';
}

/**
 * LES CHEMINS LES PLUS SUIVIS, EN BARRES (demande du 29/09/2026) : chaque
 * chemin est une barre dont la longueur suit ses sessions, et ses étapes y
 * sont dessinées en frise — un point par étape, relié au suivant, teinté selon
 * qu'il s'agit d'une page, d'un clic ou d'une étape d'un parcours.
 */
function CheminsEnBarres({ detail }: { detail: DetailSite }) {
  const p = detail.parcours;
  const libelles = React.useMemo(() => new Map(detail.parcoursDeclares.flatMap((pc) => pc.etapes.map((e) => [e.repere, e.libelle] as const))), [detail.parcoursDeclares]);
  const max = Math.max(1, ...p.chemins.map((c) => c.sessions));
  if (!p.chemins.length) return <p className="text-[12px] text-faint">{t('Aucune donnée sur cette période.')}</p>;
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-1.5">
        {p.chemins.map((c, i) => (
          <li key={i} className="flex items-center gap-2" data-stats-chemin={c.sessions}>
            <div className="relative min-w-0 flex-1 overflow-hidden rounded-md">
              <span className="absolute inset-y-0 left-0 rounded-md" style={{ width: `${Math.max(4, (c.sessions / max) * 100)}%`, background: 'hsl(var(--serie-1) / 0.14)' }} aria-hidden />
              <ol className="relative flex min-w-0 items-center px-2 py-1.5">
                {c.etapes.map((x, j) => {
                  const nom = libelleDEtape(x, libelles);
                  return (
                    <li key={j} className="flex min-w-0 items-center" title={x.genre === 'page' ? x.nom : `${nom} (${x.nom})`}>
                      {j ? <span className="mx-1 h-px w-3 shrink-0 sm:w-5" style={{ background: 'hsl(var(--faint))' }} aria-hidden /> : null}
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: teinteDEtape(x, libelles) }} aria-hidden />
                      <span className={cn('ml-1 min-w-0 max-w-[140px] truncate text-[11.5px]', x.genre === 'page' ? 'text-muted' : 'text-text')}>{nom}</span>
                    </li>
                  );
                })}
              </ol>
            </div>
            <span className="w-12 shrink-0 text-right text-[12.5px] tabular-nums text-text">{c.sessions.toLocaleString(formatRegional())}</span>
            <span className="hidden w-11 shrink-0 text-right text-[11.5px] tabular-nums text-faint sm:inline">{p.sessions ? `${Math.round((c.sessions / p.sessions) * 100)} %` : ''}</span>
          </li>
        ))}
      </ul>
      <span className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-faint">
        {(
          [
            [{ genre: 'page', nom: '' }, t('Page vue')],
            [{ genre: 'repere', nom: '' }, t('Clic sur un repère')],
            [{ genre: 'objectif', nom: '' }, t('Étape d’un parcours')],
          ] as const
        ).map(([exemple, legende]) => (
          <span key={legende} className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: teinteDEtape(exemple, libelles) }} aria-hidden />
            {legende}
          </span>
        ))}
      </span>
    </div>
  );
}

/**
 * LA LISTE DES PARCOURS (demande du 29/09/2026) : une ligne par parcours
 * défini par l'agent — son nom, son objectif, ses étapes et la part des
 * sessions qui vont jusqu'au bout. Un clic ouvre son flux.
 */
function ListeDesParcours({ detail, onOuvrir }: { detail: DetailSite; onOuvrir: (id: string) => void }) {
  const tous = detail.parcoursDeclares;
  if (!tous.length) return <p className="text-[12px] text-faint">{t('Aucun parcours défini : l’agent d’analyse des objectifs les déclare en étudiant le site.')}</p>;
  return (
    <ul className="flex flex-col gap-1">
      {tous.map((pc, i) => {
        const f = detail.tableau.parcours[i];
        const fin = f?.marches[f.marches.length - 1];
        const entree = f?.marches[0]?.sessions ?? 0;
        return (
          <li key={pc.id}>
            <button
              type="button"
              onClick={() => onOuvrir(pc.id)}
              className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-surface"
              data-stats-parcours-ligne={pc.id}
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[13px] font-medium text-text">{nomDuParcours(pc)}</span>
                <span className="truncate text-[12px] text-muted">{pc.objectif || pc.etapes.map((e) => e.libelle).join(' → ')}</span>
                <span className="flex min-w-0 items-center gap-1 text-[11px] text-faint">
                  {pc.etapes.map((e, j) => (
                    <React.Fragment key={j}>
                      {j ? <span className="h-px w-2 shrink-0" style={{ background: 'hsl(var(--faint))' }} aria-hidden /> : null}
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: 'hsl(var(--serie-2))' }} aria-hidden />
                    </React.Fragment>
                  ))}
                  <span className="ml-1">{t('{n} étape(s)', { n: pc.etapes.length })}</span>
                </span>
              </span>
              <span className="hidden w-32 shrink-0 flex-col gap-1 sm:flex">
                <span className="block h-1.5 overflow-hidden rounded-full bg-faint/15">
                  <span className="block h-full rounded-full" style={{ width: `${fin?.tauxGlobal ?? 0}%`, background: 'hsl(var(--serie-2))' }} />
                </span>
                <span className="text-[11px] text-faint">{t('{fin} sur {entree} sessions', { fin: (fin?.sessions ?? 0).toLocaleString(formatRegional()), entree: entree.toLocaleString(formatRegional()) })}</span>
              </span>
              <span className="w-16 shrink-0 text-right text-[15px] font-medium tabular-nums text-text" data-stats-conversion-finale={fin?.tauxGlobal ?? 0}>
                {(fin?.tauxGlobal ?? 0).toLocaleString(formatRegional())} %
              </span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-faint" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * UN PARCOURS OUVERT : sa fiche (le but, la conversion, la plus grosse perte),
 * son GRAND flux de conversion, puis la nomenclature complète de ses étapes.
 */
function DetailDuParcours({ detail, parcours, flux, barre }: { detail: DetailSite; parcours: ParcoursDeSuivi; flux: FluxDUnParcours; barre: React.ReactNode }) {
  const marches = flux.marches;
  const fin = marches[marches.length - 1];
  const pire = flux.plusGrosDecrochage !== null ? parcours.etapes[flux.plusGrosDecrochage - 1] : null;
  const nombre = (n: number) => n.toLocaleString(formatRegional());
  return (
    <div className="flex flex-col gap-3" data-stats-parcours-ouvert={parcours.id}>
      {barre}
      <section className="flex flex-col gap-2 rounded-md bg-bloc px-3 py-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-[15px] font-medium text-text">{nomDuParcours(parcours)}</h3>
          {parcours.objectif ? (
            <p className="text-[12.5px] text-text">
              <span className="text-faint">{t('Objectif :')}</span> {parcours.objectif}
            </p>
          ) : null}
          {parcours.description ? <p className="text-[12px] text-muted">{parcours.description}</p> : null}
        </div>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          <Chiffre libelle={t('Sessions au départ')} valeur={marches[0]?.sessions ?? 0} />
          <Chiffre libelle={t('Objectif atteint')} valeur={fin?.sessions ?? 0} />
          <Chiffre libelle={t('Conversion')} valeur={fin?.tauxGlobal ?? 0} suffixe=" %" />
          <div className="flex min-w-0 flex-col gap-0.5 rounded-md bg-surface/40 px-3 py-2">
            <span className="truncate text-[12px] text-faint">{t('La plus grosse perte')}</span>
            <span className={cn('truncate text-[14px] font-medium', pire ? 'text-danger' : 'text-muted')} title={pire?.libelle}>
              {pire ? t('avant « {etape} »', { etape: pire.libelle }) : '—'}
            </span>
          </div>
        </div>
      </section>
      <Bloc titre={t('Flux de conversion')} repere="entonnoir" aide={t('De l’entrée jusqu’à l’objectif : chaque boîte est une étape, sa hauteur suit ses sessions. En rouge, ceux qui s’arrêtent avant l’étape suivante, et les pages d’où ils quittent le site.')}>
        {marches[0]?.sessions ? null : <p className="text-[12px] text-faint">{t('Aucune session reconnue sur cette période : le flux se remplira avec les visites.')}</p>}
        <FluxDeParcoursSvg parcours={parcours} flux={flux} nomDeLaPage={nomDeLaPage} />
      </Bloc>
      <Bloc titre={t('Les étapes du parcours')} repere="etapes">
        <table className="w-full text-[12.5px]" data-stats-nomenclature={parcours.etapes.length}>
          <thead>
            <tr className="text-left text-[11.5px] text-faint">
              <th className="w-8 py-1 font-normal">#</th>
              <th className="py-1 font-normal">{t('Étape')}</th>
              <th className="w-20 py-1 text-right font-normal">{t('Sessions')}</th>
              <th className="hidden w-20 py-1 text-right font-normal sm:table-cell">{t('Passage')}</th>
              <th className="hidden w-20 py-1 text-right font-normal sm:table-cell">{t('Du départ')}</th>
              <th className="w-20 py-1 text-right font-normal">{t('Abandons')}</th>
            </tr>
          </thead>
          <tbody>
            {parcours.etapes.map((e, i) => {
              const m = marches[i + 1];
              return (
                <tr key={i} className="align-top" data-stats-etape={e.repere}>
                  <td className="py-1.5">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-medium" style={{ background: 'hsl(var(--serie-2) / 0.18)', color: 'hsl(var(--text))' }}>
                      {i + 1}
                    </span>
                  </td>
                  <td className="py-1.5 pr-2">
                    <span className="block text-text">{e.libelle}</span>
                    {e.description ? <span className="block text-[11.5px] text-muted">{e.description}</span> : null}
                    <span className="block font-mono text-[10.5px] text-faint">{e.repere}</span>
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-text">{nombre(m?.sessions ?? 0)}</td>
                  <td className="hidden py-1.5 text-right tabular-nums text-muted sm:table-cell">{(m?.tauxEtape ?? 0).toLocaleString(formatRegional())} %</td>
                  <td className="hidden py-1.5 text-right tabular-nums text-muted sm:table-cell">{(m?.tauxGlobal ?? 0).toLocaleString(formatRegional())} %</td>
                  <td className={cn('py-1.5 text-right tabular-nums', m?.abandons ? 'text-danger' : 'text-faint')}>{nombre(m?.abandons ?? 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Bloc>
      {detail.parcoursTronque ? <p className="text-[12px] text-warning">{t('Période très chargée : seuls les passages les plus récents sont comptés.')}</p> : null}
    </div>
  );
}

/**
 * L'ONGLET PARCOURS (refondu le 29/09/2026) : d'abord la LISTE des parcours
 * définis par l'agent, puis, un parcours ouvert, son flux et ses étapes. Les
 * chemins les plus suivis et les visiteurs récents restent des blocs de la
 * liste ; le flux de comportement vit dans l'onglet Audience.
 */
function Parcours({
  detail,
  dates,
  onInstaller,
  onOuvrirCarte,
}: {
  detail: DetailSite;
  dates: React.ReactNode;
  onInstaller: () => void;
  onOuvrirCarte?: (card: Card) => void;
}) {
  const p = detail.parcours;
  const [visiteur, setVisiteur] = React.useState<string | null>(null);
  const [ouvert, setOuvert] = React.useState<string | null>(null);
  const resume = <ResumeDesParcours detail={detail} />;
  const outils = (
    <>
      <BoutonDeLAgent detail={detail} onOuvrirCarte={onOuvrirCarte} />
      {dates}
    </>
  );
  /* Sans tableau à blocs, la même barre, sans « Blocs ». */
  const barre = (gauche: React.ReactNode) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-bloc px-3 py-2" data-stats-barre="parcours">
      <div className="min-w-0 flex-1 basis-60">{gauche}</div>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2 [&_[role=group]]:bg-surface/60" data-stats-outils>
        {outils}
      </div>
    </div>
  );
  if (detail.espace.modeSuivi !== 'visiteur' && !p.sessions) {
    return (
      <div className="flex flex-col gap-3">
        {barre(resume)}
        <div className="flex flex-col gap-2 rounded-md bg-bloc px-3 py-3 text-[12.5px] text-muted" data-stats-parcours="anonyme">
          <p className="flex items-center gap-1">
            {t('Ce site est mesuré de façon anonyme : les parcours, le flux de conversion et le flux de comportement demandent le Suivi complet.')}
            <BulleInfo cote="start">{t('En Suivi complet, le site demande l’accord de chaque visiteur, puis relie ses pages d’une visite à l’autre.')}</BulleInfo>
          </p>
          <Button size="sm" variant="subtle" className="self-start" onClick={onInstaller}>
            {t('Changer le type de suivi')}
          </Button>
        </div>
      </div>
    );
  }
  const rang = ouvert ? detail.parcoursDeclares.findIndex((pc) => pc.id === ouvert) : -1;
  if (rang >= 0 && detail.tableau.parcours[rang]) {
    return (
      <DetailDuParcours
        detail={detail}
        parcours={detail.parcoursDeclares[rang]}
        flux={detail.tableau.parcours[rang]}
        barre={barre(
          <button type="button" onClick={() => setOuvert(null)} className="flex items-center gap-1.5 text-[12.5px] text-muted hover:text-text" data-stats-retour-parcours>
            <ArrowLeft className="h-3.5 w-3.5" />
            {t('Tous les parcours')}
          </button>,
        )}
      />
    );
  }
  const blocs: BlocDuTableau[] = [
    {
      id: 'parcours',
      titre: t('Parcours'),
      large: true,
      rendu: () => (
        <Bloc titre={t('Parcours')} repere="parcours" aide={t('Les parcours que l’agent a définis en étudiant le site : chacun mène à un objectif. La part à droite : les sessions allées jusqu’au bout.')}>
          <ListeDesParcours detail={detail} onOuvrir={setOuvert} />
        </Bloc>
      ),
    },
    {
      id: 'chemins',
      titre: t('Chemins les plus suivis'),
      large: true,
      rendu: () => (
        <Bloc titre={t('Chemins les plus suivis')} repere="chemins" aide={t('Le début de chaque session, étape par étape : la barre suit le nombre de sessions qui ont suivi exactement ce chemin.')}>
          <CheminsEnBarres detail={detail} />
        </Bloc>
      ),
    },
    {
      id: 'visiteurs',
      titre: t('Visiteurs récents'),
      rendu: () => (
        <Bloc titre={t('Visiteurs récents')} repere="visiteurs">
          {p.derniersVisiteurs.length ? (
            <ul className="flex flex-col gap-0.5">
              {p.derniersVisiteurs.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    onClick={() => setVisiteur(v.id)}
                    className="flex w-full items-center gap-2 rounded-sm px-1 py-1 text-left text-[12.5px] hover:bg-surface"
                    data-stats-visiteur={v.id}
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted">{v.id.slice(0, 8)}</span>
                    <span className="shrink-0 text-faint">{t('{n} sessions', { n: v.sessions })}</span>
                    <span className="shrink-0 text-faint">{t('{n} pages', { n: v.pages })}</span>
                    <span className="w-20 shrink-0 text-right text-faint">{new Date(v.dernier).toLocaleDateString(formatRegional(), { day: 'numeric', month: 'short' })}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-faint">{t('Aucun visiteur reconnu sur cette période.')}</p>
          )}
        </Bloc>
      ),
    },
  ];
  return (
    <div className="flex flex-col gap-3" data-stats-parcours={p.sessions}>
      <TableauDeBlocs
        onglet="parcours"
        blocs={blocs}
        entete={resume}
        outils={outils}
        avant={
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            <Chiffre libelle={t('Visiteurs reconnus')} valeur={p.visiteurs} />
            <Chiffre libelle={t('Sessions')} valeur={p.sessions} />
            <Chiffre libelle={t('Pages par session')} valeur={p.pagesParSession} />
            <Chiffre libelle={t('Visiteurs revenus')} valeur={p.visiteursRevenus} />
          </div>
        }
      />
      {detail.parcoursTronque ? <p className="text-[12px] text-warning">{t('Période très chargée : seuls les passages les plus récents sont comptés.')}</p> : null}
      <FriseDuVisiteur id={detail.id} visiteur={visiteur} onClose={() => setVisiteur(null)} />
    </div>
  );
}

function Chiffre({ libelle, valeur, suffixe = '' }: { libelle: string; valeur: number | null; suffixe?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md bg-bloc px-3 py-2">
      <span className="truncate text-[12px] text-faint">{libelle}</span>
      <span className="text-[18px] font-medium text-text">{valeur === null ? '—' : `${valeur.toLocaleString(formatRegional())}${suffixe}`}</span>
    </div>
  );
}

function Bloc({ titre, repere, aide, children }: { titre: string; repere: string; aide?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5 rounded-md bg-bloc px-3 py-2.5" data-stats-bloc={repere}>
      <h3 className="flex items-center gap-1 text-[12.5px] text-text" data-stats-titre>
        {titre}
        {aide ? <BulleInfo cote="start">{aide}</BulleInfo> : null}
      </h3>
      {children}
    </section>
  );
}

function Etape({ genre, nom }: { genre: 'page' | 'repere' | 'objectif'; nom: string }) {
  return (
    <span
      className={cn(
        'max-w-[220px] truncate rounded-sm px-1.5 py-0.5 text-[11.5px]',
        genre === 'page' ? 'bg-surface text-muted' : genre === 'repere' ? 'bg-accent/15 text-accent' : 'bg-termine/15 text-termine',
      )}
      title={nom}
    >
      {nom}
    </span>
  );
}

type SessionFrise = { session: string; debut: number; appareil?: string; source?: string; etapes: { genre: 'page' | 'repere' | 'objectif'; nom: string; instant: number }[] };

function FriseDuVisiteur({ id, visiteur, onClose }: { id: string; visiteur: string | null; onClose: () => void }) {
  const [sessions, setSessions] = React.useState<SessionFrise[] | null>(null);
  React.useEffect(() => {
    if (!visiteur) return;
    let vivant = true;
    setSessions(null);
    client
      .call<{ sessions: SessionFrise[] }>({ type: 'statistiques.visiteur', id, visiteur })
      .then((r) => vivant && setSessions(r.sessions))
      .catch((err: any) => {
        if (!vivant) return;
        client.pushToast('error', err?.message ?? t('Parcours illisible'));
        onClose();
      });
    return () => {
      vivant = false;
    };
  }, [id, visiteur]);
  if (!visiteur) return null;
  const heure = (instant: number) => new Date(instant).toLocaleTimeString(formatRegional(), { hour: '2-digit', minute: '2-digit' });
  return (
    <Drawer open onClose={onClose} empile>
      <header className="flex shrink-0 items-center gap-2 px-4 pb-2">
        <DialogTitle className="min-w-0 flex-1 truncate">{t('Parcours du visiteur {id}', { id: visiteur.slice(0, 8) })}</DialogTitle>
      </header>
      <ZoneDefilement fond="hsl(var(--surface))" className="px-4 pb-5">
        {sessions === null ? (
          <SilhouetteStatistiques lignes={3} />
        ) : (
          <ol className="flex flex-col gap-3" data-stats-frise={sessions.length}>
            {sessions.map((s) => (
              <li key={s.session} className="flex flex-col gap-1.5 rounded-md bg-bloc px-3 py-2.5">
                <span className="text-[12px] text-faint">
                  {new Date(s.debut).toLocaleString(formatRegional(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  {s.source ? ` · ${s.source === 'direct' ? t('Direct') : s.source === 'recherche' ? t('Moteurs de recherche') : s.source}` : ''}
                  {s.appareil ? ` · ${t(s.appareil === 'mobile' ? 'Téléphone' : s.appareil === 'tablette' ? 'Tablette' : 'Ordinateur')}` : ''}
                </span>
                <ol className="flex flex-col gap-1 border-l border-faint/40 pl-3">
                  {s.etapes.map((x, i) => (
                    <li key={i} className="flex items-center gap-2 text-[12.5px]">
                      <span className="w-11 shrink-0 text-[11px] text-faint">{heure(x.instant)}</span>
                      <Etape genre={x.genre} nom={x.nom} />
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        )}
      </ZoneDefilement>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ */
/* L'assistant d'installation                                           */
/* ------------------------------------------------------------------ */

type Methode = 'manuel' | 'auto';

/** Une carte du suivi où le travail n'est pas encore fait (demande ou travail) : on la rouvre. */
function carteEnTravail(carte: Card | null): Card | null {
  return carte && (carte.column === 'planned' || carte.column === 'running') ? carte : null;
}

/**
 * L'ASSISTANT D'INSTALLATION (demandes du 28/09/2026) — un parcours LINÉAIRE :
 * on choisit le projet, on clique « Installer », l'assistant lance l'agent,
 * l'utilisateur met en ligne, et les données arrivent.
 *
 *  1. le TYPE de suivi, en blocs-choix : Anonyme ou Suivi complet (la valeur
 *     stockée reste `visiteur`) — le clic SÉLECTIONNE, « Suivant » enregistre
 *     (`statistiques.reglerMode`) puis avance ;
 *  2. la MÉTHODE : automatiquement (par défaut, projets Beluga seulement) ou
 *     manuellement. Un site autonome ne vit pas sur ce serveur : jamais
 *     d'installation automatique ;
 *  3. manuel → le code et la phrase à copier, puis « Terminé » ; automatique →
 *     ce que la tâche va faire, puis « Lancer l'installation » : la carte du
 *     suivi (`marketing.installerSuivi`) est LANCÉE dans la foulée — ce clic est
 *     le geste explicite — et l'assistant passe au SUIVI de l'installation.
 *
 * LE SUIVI (vue « resume ») : une frise en trois temps — l'agent pose le code,
 * la mise en ligne (le geste de l'utilisateur, jamais automatique), la
 * première visite reçue —, lue sur la colonne de la carte et sur l'état du
 * suivi (`etatAfficheDuSuivi`). Code posé sans visite : « Tester le suivi ».
 * Puis les REPÈRES POSÉS. Le bouton du pied : « Voir l'agent au travail »
 * tant que la carte d'installation est en demande ou au travail (la liste de
 * ses tâches se coche sous « L'agent pose le code »), « Relancer l'assistant »
 * sinon. Les explications passent par l'icône d'info, jamais en paragraphes.
 *
 * LES OBJECTIFS : en Suivi complet, la carte d'installation demande à l'agent
 * de fixer les objectifs propres au site (`consigneDesObjectifs`). Un site
 * autonome en Suivi complet propose « Demander l'étude » : un agent lit le site
 * (avec l'accès donné, rangé au coffre-fort) et propose ses objectifs.
 *
 * MISE EN PAGE : le titre au centre de l'entête ; les boutons dans un PIED
 * FIXE, hors de la zone qui défile — une petite flèche de retour à gauche, le
 * bouton principal étiré sur le reste de la largeur.
 *
 * Repères de contrôle : `data-stats-assistant=<1|2|3|resume>`,
 * `data-stats-assistant-retour`, `data-stats-assistant-suivant`,
 * `data-stats-assistant-relancer`, `data-marketing-installer-suivi=<installer|ouvrir>`,
 * `data-stats-frise`, `data-stats-etude`.
 */
function AssistantInstallation({
  detail,
  etapeInitiale,
  onClose,
  onOuvrirCarte,
  onRetire,
}: {
  detail: DetailSite;
  etapeInitiale: 1 | 2 | 3;
  onClose: () => void;
  onOuvrirCarte?: (card: Card) => void;
  onRetire: () => void;
}) {
  const etat = detail.etatAffiche;
  const mode = detail.espace.modeSuivi;
  const [lancee, setLancee] = React.useState<Card | null>(null);
  /* La carte suivie EN DIRECT : la réponse du serveur n'est qu'une photo, la
     colonne réelle arrive par `card.upsert` dans le magasin. */
  const cartes = useApp().cards;
  const carteSuivie = lancee ?? detail.carteSuivi;
  const carteVive = carteSuivie ? cartes[carteSuivie.id] ?? carteSuivie : null;
  const carte = carteEnTravail(carteVive);
  // Un suivi déjà engagé (code posé, visites, installation au travail) s'ouvre sur son suivi.
  const engage = etat !== 'absent' && etat !== 'probleme';
  const [vue, setVue] = React.useState<'assistant' | 'resume'>((engage || carte) && etapeInitiale === 1 ? 'resume' : 'assistant');
  const [etape, setEtape] = React.useState<1 | 2 | 3>(etapeInitiale);
  const [modeChoisi, setModeChoisi] = React.useState<ModeSuivi>(mode);
  const [methode, setMethode] = React.useState<Methode>(detail.autonome || etapeInitiale === 3 ? 'manuel' : 'auto');
  const [envoi, setEnvoi] = React.useState<string | null>(null);
  const [retirer, setRetirer] = React.useState(false);

  const validerMode = async () => {
    if (modeChoisi !== mode) {
      setEnvoi('mode');
      try {
        await client.call({ type: 'statistiques.reglerMode', id: detail.id, mode: modeChoisi });
      } catch (err: any) {
        client.pushToast('error', err?.message ?? t('Mode impossible à changer'));
        return;
      } finally {
        setEnvoi(null);
      }
    }
    setEtape(2);
  };
  const lancer = async () => {
    setEnvoi('installer');
    try {
      const r = await client.call<{ card: Card; deja: boolean }>({ type: 'marketing.installerSuivi', projectId: detail.id });
      /* La carte existe : l'assistant passe au SUIVI tout de suite, même si le
         lancement est refusé ensuite (le refus se dit par sa propre bulle) —
         le bouton du bas ouvre alors la carte, au lieu de rester à l'étape 3. */
      setLancee(r.card);
      setVue('resume');
      if (!r.deja) await client.demanderLeLancement(r.card.id);
      client.pushToast(r.deja ? 'info' : 'success', r.deja ? t('La carte d’installation existe déjà.') : t('Installation lancée dans le projet.'));
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Installation impossible à lancer'));
    } finally {
      setEnvoi(null);
    }
  };
  const supprimer = async () => {
    setRetirer(false);
    try {
      await client.call({ type: 'statistiques.supprimerSite', id: detail.id });
      onClose();
      onRetire();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Site impossible à retirer'));
    }
  };
  const relancer = () => {
    setEtape(1);
    setModeChoisi(mode);
    setMethode(detail.autonome ? 'manuel' : 'auto');
    setVue('assistant');
  };
  const retour = () => {
    if (etape > 1) setEtape((etape - 1) as 1 | 2);
    else setVue('resume');
  };

  const titres = [t('Type de suivi'), t('Méthode'), methode === 'manuel' ? t('Le code à poser') : t('L’installation automatique')];
  const enAssistant = vue === 'assistant';
  // La flèche de retour : à partir de l'étape 2, ou dès l'étape 1 quand un suivi existe derrière.
  const retourPossible = enAssistant && (etape > 1 || engage || !!carte);
  const chargement = <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  const etudePossible = detail.autonome && (enAssistant ? modeChoisi : mode) === 'visiteur';

  let principal: React.ReactNode;
  if (!enAssistant && carte && onOuvrirCarte) {
    /* PENDANT L'INSTALLATION, LE BOUTON DU BAS OUVRE L'AGENT AU TRAVAIL :
       relancer l'assistant à ce moment-là n'a pas de sens, et le lien vers la
       carte se perdait au milieu de la frise. */
    principal = (
      <Button variant="default" size="pied" className="min-w-0 flex-1" onClick={() => onOuvrirCarte(carte)} data-marketing-installer-suivi="ouvrir">
        {chargement}
        {t('Voir l’agent au travail')}
      </Button>
    );
  } else if (!enAssistant) {
    principal = (
      <Button variant="default" size="pied" className="min-w-0 flex-1" onClick={relancer} data-stats-assistant-relancer>
        <RotateCcw className="h-3.5 w-3.5" />
        {t('Relancer l’assistant')}
      </Button>
    );
  } else if (etape === 1) {
    principal = (
      <Button variant="default" size="pied" className="min-w-0 flex-1" disabled={envoi !== null} onClick={() => void validerMode()} data-stats-assistant-suivant>
        {envoi === 'mode' ? chargement : null}
        {t('Suivant')}
        {envoi === 'mode' ? null : <ArrowRight className="h-3.5 w-3.5" />}
      </Button>
    );
  } else if (etape === 2) {
    principal = (
      <Button variant="default" size="pied" className="min-w-0 flex-1" disabled={methode === 'auto' && detail.autonome} onClick={() => setEtape(3)} data-stats-assistant-suivant>
        {t('Suivant')}
        <ArrowRight className="h-3.5 w-3.5" />
      </Button>
    );
  } else if (methode === 'manuel') {
    principal = (
      <Button variant="default" size="pied" className="min-w-0 flex-1" onClick={() => setVue('resume')} data-stats-assistant-termine>
        <Check className="h-3.5 w-3.5" />
        {t('Terminé')}
      </Button>
    );
  } else if (carte) {
    principal = (
      <Button variant="subtle" size="pied" className="min-w-0 flex-1" onClick={() => setVue('resume')} data-stats-assistant-suivre>
        <ArrowRight className="h-3.5 w-3.5" />
        {t('Suivre l’installation')}
      </Button>
    );
  } else {
    principal = (
      <Button variant="default" size="pied" className="min-w-0 flex-1" disabled={envoi !== null} onClick={() => void lancer()} data-marketing-installer-suivi="installer">
        {envoi === 'installer' ? chargement : <Play className="h-3.5 w-3.5" />}
        {envoi === 'installer' ? t('Lancement…') : t('Lancer l’installation')}
      </Button>
    );
  }

  return (
    <Drawer open onClose={onClose} empile>
      <header className="flex shrink-0 flex-col items-center gap-1.5 px-4 pb-3">
        <DialogTitle className="max-w-full truncate text-center" data-stats-assistant-titre>{t('Installer le suivi')}</DialogTitle>
        <span className={cn('text-center text-[12px]', couleurDuSuivi(carte && etat === 'absent' ? 'installation' : etat))} data-marketing-suivi-etat={carte && etat === 'absent' ? 'installation' : etat}>
          {libelleSuivi(carte && etat === 'absent' ? 'installation' : etat)}
        </span>
        {enAssistant ? (
          <ol className="flex w-full items-center gap-1" data-stats-assistant={etape}>
            {titres.map((titre, i) => {
              const n = (i + 1) as 1 | 2 | 3;
              const atteinte = n <= etape;
              return (
                <li key={n} className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className={cn('h-1 rounded-full', atteinte ? 'bg-accent' : 'bg-faint/25')} />
                  <button
                    type="button"
                    disabled={n > etape}
                    onClick={() => setEtape(n)}
                    className={cn('truncate text-left text-[11.5px]', n === etape ? 'font-medium text-text' : atteinte ? 'text-muted hover:text-text' : 'text-faint')}
                    data-stats-assistant-etape={n}
                  >
                    {n}. {titre}
                  </button>
                </li>
              );
            })}
          </ol>
        ) : null}
      </header>
      <ZoneDefilement fond="hsl(var(--surface))" className="px-4 pb-4">
        <div className="flex flex-col gap-3" data-stats-assistant={enAssistant ? undefined : 'resume'}>
          {!enAssistant ? (
            <>
              <Bloc titre={t('Le suivi de ce site')} repere="etat">
                <p className="text-[12.5px] text-muted">{mode === 'anonyme' ? t('Anonyme') : t('Suivi complet')}</p>
                <FriseDInstallation detail={detail} carte={carteVive} />
                {etat === 'attente' || (detail.autonome && etat !== 'verifie') ? <TesterLeSuivi id={detail.id} /> : null}
              </Bloc>
              {etudePossible ? <EtudeDuSite detail={detail} onOuvrirCarte={onOuvrirCarte} /> : null}
              <Reperes detail={detail} />
            </>
          ) : etape === 1 ? (
            <>
              <TitreDEtape titre={t('Quel suivi pour ce site ?')}>
                {t('Changer de type ne demande pas de retoucher le site : le code déjà posé suit le réglage.')}
              </TitreDEtape>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {(['anonyme', 'visiteur'] as const).map((m) => (
                  <BlocChoix
                    key={m}
                    actif={modeChoisi === m}
                    disabled={envoi !== null}
                    onClick={() => setModeChoisi(m)}
                    titre={m === 'anonyme' ? t('Anonyme') : t('Suivi complet')}
                    description={
                      m === 'anonyme'
                        ? t('Rien n’est écrit sur l’appareil, aucun bandeau : les visites sont comptées, sans relier les pages d’une même personne.')
                        : t('Un bandeau demande l’accord. Après accord, les pages de chaque visiteur sont reliées d’une visite à l’autre, et l’agent fixe les objectifs propres au site.')
                    }
                    repere={{ 'data-stats-mode': m }}
                  />
                ))}
              </div>
            </>
          ) : etape === 2 ? (
            <>
              <TitreDEtape titre={t('Qui pose le code ?')}>
                {t('Le code est le même dans les deux cas : un script à placer dans l’en-tête de chaque page du site.')}
              </TitreDEtape>
              <div className="grid gap-1.5 sm:grid-cols-2">
                <BlocChoix
                  actif={methode === 'auto'}
                  disabled={detail.autonome}
                  onClick={() => setMethode('auto')}
                  titre={t('Automatiquement')}
                  description={
                    detail.autonome
                      ? t('Réservé aux projets hébergés dans Beluga : ce site vit ailleurs, son code se pose à la main.')
                      : t('L’agent du projet pose le code, la phrase et les repères, dans une tâche lancée tout de suite.')
                  }
                  repere={{ 'data-stats-methode': 'auto' }}
                />
                <BlocChoix
                  actif={methode === 'manuel'}
                  onClick={() => setMethode('manuel')}
                  titre={t('Manuellement')}
                  description={t('Vous copiez le code et la phrase de confidentialité, et vous les posez vous-même sur le site.')}
                  repere={{ 'data-stats-methode': 'manuel' }}
                />
              </div>
            </>
          ) : methode === 'manuel' ? (
            <>
              <Bloc titre={t('Le code de suivi')} repere="code" aide={t('À coller dans l’en-tête (<head>) de chaque page du site.')}>
                <LigneCopiable texte={detail.extrait} quoi={t('Script')} code repere="extrait" />
              </Bloc>
              <Bloc titre={t('La phrase de confidentialité')} repere="confidentialite" aide={t('À ajouter à la page « Confidentialité » du site. Elle suit le type de suivi choisi.')}>
                <LigneCopiable texte={detail.confidentialite} quoi={t('Phrase')} repere="confidentialite" />
              </Bloc>
              {etudePossible ? <EtudeDuSite detail={detail} onOuvrirCarte={onOuvrirCarte} /> : null}
            </>
          ) : (
            <>
              <TitreDEtape titre={t('Ce que la tâche va faire')}>
                {t('Une carte « Installer le suivi des visites » est créée dans le projet et lancée aussitôt. La mise en ligne reste votre geste.')}
              </TitreDEtape>
              <ol className="flex flex-col gap-1.5" data-stats-etapes-auto>
                {[
                  t('Poser le code de suivi dans l’en-tête de chaque page du site.'),
                  t('Ajouter la phrase de confidentialité à la page prévue.'),
                  modeChoisi === 'visiteur'
                    ? t('Étudier le site et fixer ses objectifs : les étapes du parcours qui comptent pour lui.')
                    : t('Marquer d’un repère les boutons et liens qui comptent.'),
                  t('Vous mettez le site en ligne ; les chiffres arrivent dès la première visite.'),
                ].map((texte, i) => (
                  <li key={i} className="flex items-start gap-2 rounded-md bg-bloc px-3 py-2 text-[12.5px] text-text">
                    <span className="w-4 shrink-0 font-mono text-[11.5px] tabular-nums text-faint">{i + 1}</span>
                    <span className="min-w-0 flex-1">{texte}</span>
                  </li>
                ))}
              </ol>
            </>
          )}

          {detail.autonome ? (
            <Button size="sm" variant="ghost" className="self-start text-danger" onClick={() => setRetirer(true)} data-stats-retirer>
              <Trash2 className="h-3.5 w-3.5" />
              {t('Retirer ce site')}
            </Button>
          ) : null}
        </div>
      </ZoneDefilement>
      <footer className="flex shrink-0 items-center gap-2 px-4 pb-4 pt-2" data-stats-assistant-pied>
        {retourPossible ? (
          <Button variant="subtle" size="icon" className="h-9 w-9 shrink-0" aria-label="Retour" title={t('Retour')} onClick={retour} data-stats-assistant-retour>
            <ArrowLeft className="h-3.5 w-3.5" />
          </Button>
        ) : null}
        {principal}
      </footer>
      <ConfirmDialog
        open={retirer}
        danger
        title={t('Retirer « {nom} » ?', { nom: detail.nom })}
        description={t('Le site, ses repères et toutes ses visites mesurées sont effacés. Le code posé sur le site cessera d’être compté.')}
        confirmLabel={t('Retirer')}
        onConfirm={() => void supprimer()}
        onClose={() => setRetirer(false)}
      />
    </Drawer>
  );
}

type TempsDeLaFrise = 'fait' | 'en-cours' | 'a-venir';

/**
 * LA FRISE DE L'INSTALLATION : où en est le suivi, en trois temps pour un
 * projet (l'agent pose le code → la mise en ligne, votre geste → la première
 * visite), en deux pour un site autonome (code posé à la main → première
 * visite). « Posé » se lit sur la page en ligne, jamais sur la carte seule.
 */
function FriseDInstallation({ detail, carte }: { detail: DetailSite; carte: Card | null }) {
  const etat = detail.etatAffiche;
  const codeEnLigne = etat === 'attente' || etat === 'verifie';
  const carteAuTravail = !!carte && (carte.column === 'planned' || carte.column === 'running');
  const temps: { cle: string; titre: string; etat: TempsDeLaFrise; aide?: string; suite?: React.ReactNode }[] = [];
  if (!detail.autonome) {
    const pose: TempsDeLaFrise = codeEnLigne || (carte && !carteAuTravail) ? 'fait' : carteAuTravail ? 'en-cours' : 'a-venir';
    temps.push({
      cle: 'agent',
      titre: t('L’agent pose le code'),
      etat: pose,
      // Les étapes de l'agent, cochées en direct, tant qu'il travaille.
      suite: carteAuTravail && carte ? <EtapesDeLAgent carte={carte} /> : null,
    });
    temps.push({
      cle: 'en-ligne',
      titre: t('Mise en ligne du site'),
      etat: codeEnLigne ? 'fait' : pose === 'fait' ? 'en-cours' : 'a-venir',
      aide: !codeEnLigne && pose === 'fait' ? t('À vous : mettez le projet en ligne depuis la colonne « À déployer ».') : undefined,
    });
  } else {
    temps.push({ cle: 'code', titre: t('Code posé sur le site'), etat: codeEnLigne ? 'fait' : 'en-cours' });
  }
  temps.push({ cle: 'visite', titre: t('Première visite reçue'), etat: etat === 'verifie' ? 'fait' : codeEnLigne ? 'en-cours' : 'a-venir' });
  return (
    <ol className="flex flex-col gap-1.5" data-stats-frise>
      {temps.map((x) => (
        <li key={x.cle} className="flex items-start gap-2 text-[12.5px]" data-stats-frise-temps={x.cle} data-etat={x.etat}>
          <span
            className={cn(
              'mt-1 h-2 w-2 shrink-0 rounded-full',
              x.etat === 'fait' ? 'bg-termine' : x.etat === 'en-cours' ? 'bg-en-cours' : 'bg-faint/40',
            )}
          />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex items-center gap-1">
              <span className={x.etat === 'a-venir' ? 'text-faint' : 'text-text'}>{x.titre}</span>
              {x.aide ? <BulleInfo cote="start">{x.aide}</BulleInfo> : null}
            </span>
            {x.suite}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * LES ÉTAPES DE L'AGENT D'INSTALLATION, COCHÉES EN DIRECT — sans ouvrir sa
 * conversation. Une lecture à l'ouverture (`statistiques.etapesInstallation` :
 * la seule DERNIÈRE liste de tâches, jamais le fil entier), puis la suite
 * arrive d'elle-même : chaque liste renvoyée par le moteur est diffusée
 * (`message.upsert`) et rangée dans le magasin sous l'agent. Tant qu'aucune
 * liste n'existe, l'étape en cours de l'agent (`etapeEnCours`) tient lieu de
 * ligne. Repère de contrôle : `data-stats-frise-taches`.
 */
function EtapesDeLAgent({ carte }: { carte: Card }) {
  const state = useApp();
  const [lu, setLu] = React.useState<{ agentId: string | null; etapes: TodoItem[] } | null>(null);
  React.useEffect(() => {
    let vivant = true;
    client
      .call<{ agentId: string | null; etapes: TodoItem[] }>({ type: 'statistiques.etapesInstallation', cardId: carte.id })
      .then((r) => {
        if (!vivant) return;
        setLu(r);
        // Sa liste de tâches se lit en direct : on dit au serveur qu'on la regarde.
        if (r?.agentId) client.suivre({ agents: [r.agentId] });
      })
      .catch(() => vivant && setLu({ agentId: null, etapes: [] }));
    return () => {
      vivant = false;
    };
  }, [carte.id]);
  // L'agent le plus récent de la carte d'abord : une reprise en ouvre un nouveau.
  const agents = Object.values(state.agents)
    .filter((agent) => agent.cardId === carte.id)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const enDirect = agents
    .map((agent) => [...(state.messages[agent.id] ?? [])].reverse().find((message) => message.todos.length)?.todos)
    .find((liste) => liste?.length);
  const etapes = enDirect ?? lu?.etapes ?? [];
  const enCours = agents[0]?.etapeEnCours;
  if (!etapes.length && !enCours) return null;
  const lignes: Pick<TodoItem, 'label' | 'state'>[] = etapes.length ? etapes : [{ label: enCours ?? '', state: 'running' }];
  return (
    <ul className="mt-1 flex flex-col gap-1" data-stats-frise-taches>
      {lignes.map((ligne, i) => (
        <li key={`${i}-${ligne.label}`} className="flex items-start gap-1.5 text-[12px]" data-etat={ligne.state}>
          <span className="mt-[1px] flex h-3.5 w-3.5 shrink-0 items-center justify-center">
            {ligne.state === 'done' ? (
              <Check className="h-3.5 w-3.5 text-termine" />
            ) : ligne.state === 'running' ? (
              <Loader2 className="h-3 w-3 animate-spin text-en-cours" />
            ) : ligne.state === 'unfinished' ? (
              <X className="h-3 w-3 text-faint" />
            ) : (
              <span className="h-2.5 w-2.5 rounded-full border border-faint" />
            )}
          </span>
          <span className={cn('min-w-0 flex-1', ligne.state === 'done' ? 'text-muted line-through decoration-faint/60' : ligne.state === 'running' ? 'text-text' : 'text-faint')}>
            {ligne.label}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * L'ÉTUDE D'UN SITE AUTONOME EN SUIVI COMPLET : pas d'installation automatique
 * (le site vit ailleurs), mais un agent lit le site et propose ses objectifs.
 * L'accès, facultatif, part au coffre-fort — jamais dans la carte.
 */
function EtudeDuSite({ detail, onOuvrirCarte }: { detail: DetailSite; onOuvrirCarte?: (card: Card) => void }) {
  const [identifiant, setIdentifiant] = React.useState('');
  const [motDePasse, setMotDePasse] = React.useState('');
  const [envoi, setEnvoi] = React.useState(false);
  const [lancee, setLancee] = React.useState<Card | null>(null);
  const carte = lancee ?? carteEnTravail(detail.carteEtude);
  const demander = async () => {
    setEnvoi(true);
    try {
      const r = await client.call<{ card: Card; deja: boolean; fiche: string | null }>({
        type: 'statistiques.etudierSite',
        id: detail.id,
        ...(identifiant.trim() ? { identifiant: identifiant.trim() } : {}),
        ...(motDePasse ? { motDePasse } : {}),
      });
      setLancee(r.card);
      setIdentifiant('');
      setMotDePasse('');
      client.pushToast(r.deja ? 'info' : 'success', r.deja ? t('L’étude de ce site est déjà ouverte.') : t('Étude demandée : sa carte est ouverte dans Beluga.'));
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Étude impossible à demander'));
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <Bloc
      titre={t('Les objectifs du site')}
      repere="etude"
      aide={t('Un agent lit le site et propose ses objectifs et ses repères, à poser à la main. Donnez un accès si des pages sont protégées : il est rangé dans le coffre-fort.')}
    >
      {carte ? (
        <div className="flex flex-col gap-1.5" data-stats-etude="ouverte">
          <p className="text-[12.5px] text-en-cours">{t('Étude en cours : la carte « {titre} » est ouverte.', { titre: carte.title })}</p>
          {onOuvrirCarte ? (
            <Button size="sm" variant="ghost" className="self-start" onClick={() => onOuvrirCarte(carte)} data-stats-etude-carte="ouvrir">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('Ouvrir la carte d’étude')}
            </Button>
          ) : null}
        </div>
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void demander();
          }}
          data-stats-etude="a-demander"
        >
          <p className="text-[12px] text-muted">{t('Adresse étudiée : {adresse}', { adresse: detail.espace.configuration.adresse ?? '—' })}</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            <Input value={identifiant} onChange={(e) => setIdentifiant(e.target.value)} placeholder={t('Identifiant (facultatif)')} autoComplete="off" data-stats-etude-champ="identifiant" />
            <Input type="password" value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} placeholder={t('Mot de passe (facultatif)')} autoComplete="new-password" data-stats-etude-champ="mot-de-passe" />
          </div>
          <Button type="submit" size="sm" className="self-start" disabled={envoi || !detail.espace.configuration.adresse} data-stats-etude-demander>
            {envoi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            {envoi ? t('Envoi…') : t('Demander l’étude')}
          </Button>
        </form>
      )}
    </Bloc>
  );
}

/** Le titre d'une étape de l'assistant, son explication dans la pastille « i ». */
function TitreDEtape({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-1 text-[13px] font-medium text-text">
      {titre}
      <BulleInfo cote="start">{children}</BulleInfo>
    </h3>
  );
}

/** Un bloc-choix : un titre, et sa description courte — la seule aide qui reste affichée. */
function BlocChoix({
  actif,
  disabled,
  onClick,
  titre,
  description,
  repere,
}: {
  actif: boolean;
  disabled?: boolean;
  onClick: () => void;
  titre: string;
  description: string;
  repere: Record<string, string>;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      data-actif={actif ? '' : undefined}
      {...repere}
      className={cn(
        'flex flex-col gap-0.5 rounded-md px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55',
        actif ? 'bg-accent/15 ring-1 ring-accent' : 'bg-bloc hover:bg-bloc/70',
      )}
    >
      <span className="text-[13px] font-medium text-text">{titre}</span>
      <span className="text-[12px] text-muted">{description}</span>
    </button>
  );
}

function Reperes({ detail }: { detail: DetailSite }) {
  return (
    <Bloc titre={t('Repères posés')} repere="reperes" aide={t('L’agent qui installe le suivi étudie le site et marque les boutons, liens et zones qui comptent.')}>
      {detail.reperes.length ? (
        <ul className="flex flex-col gap-1.5">
          {detail.reperes.map((r) => (
            <li key={r.nom} className="flex flex-col gap-0.5 text-[12.5px]" data-stats-repere={r.nom}>
              <span className="flex items-center gap-1.5">
                <Etape genre={r.objectif ? 'objectif' : 'repere'} nom={r.nom} />
                <span className="min-w-0 truncate text-faint">{r.emplacement}</span>
              </span>
              {r.raison ? <span className="text-muted">{r.raison}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-faint">{t('Aucun repère posé.')}</p>
      )}
    </Bloc>
  );
}

function LigneCopiable({ texte, quoi, code, repere }: { texte: string; quoi: string; code?: boolean; repere: string }) {
  return (
    <div className="flex items-start gap-1.5" data-stats-copiable={repere}>
      {code ? (
        <code className="min-w-0 flex-1 break-all rounded-sm bg-surface px-1.5 py-1 text-[11.5px] text-muted">{texte}</code>
      ) : (
        <p className="min-w-0 flex-1 text-[12px] text-muted" data-marketing-confidentialite>
          {texte}
        </p>
      )}
      <Button size="icon" variant="ghost" aria-label="Copier" title={t('Copier')} onClick={() => void copier(texte, quoi)}>
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Nouveau site                                                         */
/* ------------------------------------------------------------------ */

function TiroirNouveauSite({ ouvert, onClose, onCree }: { ouvert: boolean; onClose: () => void; onCree: (id: string) => void }) {
  const [nom, setNom] = React.useState('');
  const [adresse, setAdresse] = React.useState('https://');
  const [mode, setMode] = React.useState<ModeSuivi>('anonyme');
  const [envoi, setEnvoi] = React.useState(false);
  if (!ouvert) return null;
  const creer = async () => {
    setEnvoi(true);
    try {
      const r = await client.call<{ espace: EspaceMarketing }>({ type: 'statistiques.creerSite', nom, adresse, mode });
      setNom('');
      setAdresse('https://');
      setMode('anonyme');
      onClose();
      onCree(r.espace.projectId);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Site impossible à créer'));
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <Drawer open onClose={onClose} empile>
      <header className="flex shrink-0 items-center gap-2 px-4 pb-2">
        <Globe className="h-3.5 w-3.5 shrink-0 text-accent" />
        <DialogTitle className="min-w-0 truncate">{t('Nouveau site de statistiques')}</DialogTitle>
        <BulleInfo cote="start">{t('Un site hors de Beluga : il reçoit sa propre clé de suivi. Le code à poser s’affiche juste après.')}</BulleInfo>
      </header>
      <ZoneDefilement fond="hsl(var(--surface))" className="px-4 pb-5">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void creer();
          }}
          data-stats-formulaire
        >
          <label className="flex flex-col gap-1 text-[12.5px] text-text">
            {t('Nom')}
            <Input value={nom} onChange={(e) => setNom(e.target.value)} placeholder={t('Mon site')} data-stats-champ="nom" autoFocus />
          </label>
          <label className="flex flex-col gap-1 text-[12.5px] text-text">
            {t('Adresse du site')}
            <Input value={adresse} onChange={(e) => setAdresse(e.target.value)} inputMode="url" data-stats-champ="adresse" />
          </label>
          <div className="flex flex-col gap-1 text-[12.5px] text-text">
            {t('Type de suivi')}
            <div className="flex gap-1.5">
              {(['anonyme', 'visiteur'] as const).map((m) => (
                <Button key={m} type="button" size="sm" variant={mode === m ? 'subtle' : 'ghost'} onClick={() => setMode(m)} data-stats-champ-mode={m}>
                  {m === 'anonyme' ? t('Anonyme') : t('Suivi complet')}
                </Button>
              ))}
            </div>
          </div>
          <Button type="submit" disabled={envoi || !nom.trim()} className="self-start" data-stats-creer>
            {envoi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {envoi ? t('Création…') : t('Créer le site')}
          </Button>
        </form>
      </ZoneDefilement>
    </Drawer>
  );
}
