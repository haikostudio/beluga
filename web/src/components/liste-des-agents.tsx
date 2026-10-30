/*
 * LA LISTE DES AGENTS — ce qui a remplacé le tableau à colonnes (demande du
 * 30/10/2026 : « supprime le kanban, pense en agents »).
 *
 * Une seule pièce, deux lieux : la colonne de gauche d'un projet (et la page
 * plein écran du téléphone), et la page « Tableaux de bord », où elle réunit
 * les agents de tous les projets (`avecProjet`). Chaque carte y est UNE LIGNE :
 * son titre, sa branche en petit dessous, une icône d'état monochrome qui vit
 * (anneau qui tourne, question qui bat, coche qui se dessine) et un badge dans le
 * style de l'application. L'état vient d'une règle pure
 * (`etatDeLAgentEnListe`, `shared/src/etat-d-agent-en-liste.ts`).
 *
 * Une liste unique, la dernière activité en haut ; les étapes d'une demande en
 * plusieurs parties en retrait sous leur carte principale ; les cartes rangées
 * à la suite des actives, chargées au défilement. En tête, une recherche (nom
 * ou branche) et son bouton filtre (états, non lus, projets).
 *
 * Les gestes rares passent par le MENU D'UNE CARTE (`MenuCarte`) : clic droit à
 * la souris, appui long au doigt — où il s'ouvre en panneau du bas. Les cartes
 * se posent par paquets de vingt, une silhouette tient la place tant que rien
 * n'est arrivé, et la zone défile par `ZoneDefilement`.
 */
import * as React from 'react';
import {
  Archive,
  CircleCheck,
  Hourglass,
  ListFilter,
  Loader2,
  MessageCircleQuestion,
  Pause,
  PencilLine,
  Rocket,
  Search,
  X,
} from 'lucide-react';
import {
  CARTES_PAR_PAQUET,
  ETATS_D_AGENT_EN_LISTE,
  LIBELLE_ETAT_D_AGENT,
  TON_ETAT_D_AGENT,
  agentAuTravailALEcran,
  agentCorrespond,
  alertesParCarte,
  brancheDeLaCarte,
  carteMarketingCachee,
  carteNonLue,
  cartesEnAttenteDeQuota,
  etatArchive,
  etatDeLAgentEnListe,
  filtreDesAgentsActif,
  grouperEnFamilles,
  passeLeFiltre,
  resteSurLeServeur,
  type Card,
  type ColumnKey,
  type EtatDAgentEnListe,
  type FamilleDAgents,
  type FiltreDesAgents,
  type LigneDAgent,
  type Project,
} from '@beluga/shared';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ZoneDefilement,
} from '@/components/ui';
import { BadgeDEtape } from '@/components/badge-etape';
import { MenuCarte } from '@/components/card-menu';
import { PastilleProjet } from '@/components/pastille-projet';
import { SilhouetteAgents } from '@/components/silhouettes';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';

/** Les colonnes dont les cartes forment la liste principale (le reste se replie). */
const COLONNES_ACTIVES: ColumnKey[] = ['planned', 'running', 'to_deploy'];

type Ligne = LigneDAgent<Card> & { auTravail: boolean };

/* ------------------------------------------------------------------ */
/* L'icône d'état : noire et grise, jamais en couleur, et qui VIT       */
/* ------------------------------------------------------------------ */

/**
 * L'ICÔNE D'ÉTAT D'UN AGENT. Strictement monochrome (demande du 30/10/2026 :
 * « pas d'icône de couleur, juste du monochrome ») : le noir pour ce qui
 * attend l'utilisateur ou travaille, le gris pour le reste. Elle vit —
 * l'anneau tourne, la question bat, la coche se dessine, le sablier bascule — et
 * se fige pour qui a demandé moins de mouvement à son appareil
 * (`motion-reduce`, et `prefers-reduced-motion` dans `styles.css`).
 */
export function IconeDEtatDAgent({ etat, className }: { etat: EtatDAgentEnListe; className?: string }) {
  /* PLUS ÉPURÉE (demande du 30/10/2026) : le trait fin de la famille Lucide
     (1,5 au lieu de 2), un cran plus petite. */
  const classe = cn('h-3.5 w-3.5 shrink-0', className);
  const trait = 1.5;
  switch (etat) {
    case 'travail':
      return <Loader2 strokeWidth={trait} className={cn(classe, 'animate-spin text-text [animation-duration:1.6s] motion-reduce:animate-none')} aria-hidden />;
    case 'a-vous':
      return <MessageCircleQuestion strokeWidth={trait} className={cn(classe, 'animate-pulse-soft text-text motion-reduce:animate-none')} aria-hidden />;
    case 'lance':
      return <Hourglass strokeWidth={trait} className={cn(classe, 'icone-sablier text-muted')} aria-hidden />;
    case 'en-pause':
      return <Pause strokeWidth={trait} className={cn(classe, 'text-muted')} aria-hidden />;
    case 'a-deployer':
      return <CircleCheck strokeWidth={trait} className={cn(classe, 'icone-coche-dessinee text-text')} aria-hidden />;
    case 'en-ligne':
      return <Rocket strokeWidth={trait} className={cn(classe, 'text-faint')} aria-hidden />;
    case 'archive':
      return <Archive strokeWidth={trait} className={cn(classe, 'text-faint')} aria-hidden />;
    default:
      return <PencilLine strokeWidth={trait} className={cn(classe, 'text-faint')} aria-hidden />;
  }
}

/**
 * LE LOGO DU PROJET EN TÊTE, L'ÉTAT DANS UN ROND AU COIN (demande du
 * 30/10/2026, capture #aef09) : là où les agents de plusieurs projets se
 * mêlent, c'est le logo qui se lit d'abord ; l'état de l'agent se pose en
 * petit, dans un rond au coin haut droit, sur le fond de la liste.
 */
function IconeDeLAgent({ etat, projet }: { etat: EtatDAgentEnListe; projet?: Project }) {
  if (!projet) return <IconeDEtatDAgent etat={etat} />;
  return (
    <span className="relative flex h-6 w-6 shrink-0 items-center justify-center" data-icone-agent-projet>
      <PastilleProjet project={projet} taille={20} />
      <span
        className="absolute -right-1.5 -top-1.5 flex h-[15px] w-[15px] items-center justify-center rounded-full bg-surface ring-1 ring-faint/40"
        data-rond-d-etat={etat}
      >
        <IconeDEtatDAgent etat={etat} className="h-2.5 w-2.5" />
      </span>
    </span>
  );
}

/** Le badge d'état, dans le style de l'application : jaune, violet, noir ou gris — en petit. */
export function BadgeDEtatDAgent({ etat }: { etat: EtatDAgentEnListe }) {
  return (
    <BadgeDEtape ton={TON_ETAT_D_AGENT[etat]} data-etat-badge={etat} className="h-4 rounded-[5px] px-1 text-[10.5px]">
      {t(LIBELLE_ETAT_D_AGENT[etat])}
    </BadgeDEtape>
  );
}

/* ------------------------------------------------------------------ */
/* Les lignes                                                           */
/* ------------------------------------------------------------------ */

/** La durée d'un appui qui ouvre le menu au doigt — et le déplacement qui l'annule. */
const APPUI_LONG_MS = 480;
const TOLERANCE_APPUI_PX = 8;

function LigneAgent({
  ligne,
  ouverte,
  retrait,
  avecProjet,
  projet,
  pleinePage,
  menuOuvert,
  onMenu,
  onOuvrir,
}: {
  ligne: Ligne;
  ouverte: boolean;
  retrait?: boolean;
  avecProjet?: boolean;
  projet?: Project;
  pleinePage?: boolean;
  menuOuvert: boolean;
  onMenu: (ouvert: boolean) => void;
  onOuvrir: () => void;
}) {
  const { carte, etat } = ligne;
  const branche = brancheDeLaCarte(carte).replace(/^tache\//, '');
  /*
   * L'APPUI LONG, AU DOIGT SEULEMENT : il ouvre le menu sans ouvrir la carte.
   * Bouger avant la fin fait défiler la liste, comme d'habitude ; le clic qui
   * suit un appui long abouti est avalé.
   */
  const appui = React.useRef<{ x: number; y: number; minuterie: number } | null>(null);
  const appuiAbouti = React.useRef(false);
  /* LE MENU RESTE MONTÉ UNE FOIS OUVERT : ses fenêtres (renommer, supprimer,
     confirmer un « Passer en… » qui dépense) vivent dans le même composant, et
     le démonter à la fermeture du menu les emportait avant qu'elles s'ouvrent. */
  const [menuMonte, setMenuMonte] = React.useState(false);
  if (menuOuvert && !menuMonte) setMenuMonte(true);
  const lacher = () => {
    if (appui.current) window.clearTimeout(appui.current.minuterie);
    appui.current = null;
  };
  React.useEffect(() => lacher, []);
  return (
    <div
      /* LE CADRE JAUNE D'UN AGENT QUI ATTEND SA RÉPONSE (demande du 30/10/2026) :
         le trait des questions, jusqu'à la réponse — ouvrir la carte n'enlève que
         le gras du titre. Un `outline` : il ne décale pas la ligne d'un pixel. */
      className={cn('relative rounded-lg', etat === 'a-vous' && 'contour-de-question')}
      role="listitem"
      data-agent-en-liste={carte.id}
      data-etat-agent={etat}
      data-agent-attend-reponse={etat === 'a-vous' ? '' : undefined}
      data-ouvert={ouverte ? '' : undefined}
    >
      <button
        type="button"
        aria-current={ouverte ? 'page' : undefined}
        title={carte.title}
        onClick={(event) => {
          if (appuiAbouti.current) {
            appuiAbouti.current = false;
            event.preventDefault();
            return;
          }
          onOuvrir();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          /* Le relâchement du clic droit qui ouvre le menu tomberait sur
             l'entrée posée sous le curseur : on avale CE seul relâchement
             (compétence « clic-droit-radix-qui-choisit-une-ligne »). */
          const avaler = (relache: PointerEvent) => {
            if (relache.button === 2) relache.stopPropagation();
          };
          document.addEventListener('pointerup', avaler, { capture: true, once: true });
          onMenu(true);
        }}
        onPointerDown={(event) => {
          if (event.pointerType === 'mouse') return;
          appuiAbouti.current = false;
          lacher();
          const { clientX: x, clientY: y } = event;
          appui.current = {
            x,
            y,
            minuterie: window.setTimeout(() => {
              appui.current = null;
              appuiAbouti.current = true;
              navigator.vibrate?.(8);
              onMenu(true);
            }, APPUI_LONG_MS),
          };
        }}
        onPointerMove={(event) => {
          const depart = appui.current;
          if (depart && Math.hypot(event.clientX - depart.x, event.clientY - depart.y) > TOLERANCE_APPUI_PX) lacher();
        }}
        onPointerUp={lacher}
        onPointerCancel={lacher}
        className={cn(
          'flex w-full min-w-0 touch-manipulation select-none items-center gap-2.5 rounded-lg text-left transition-colors [-webkit-touch-callout:none]',
          pleinePage ? 'px-3 py-3' : 'px-2.5 py-2',
          retrait && (pleinePage ? 'pl-9' : 'pl-7'),
          ouverte ? 'bg-ligne-active' : 'hover:bg-raised',
          'group-data-[bande]/colonne:justify-center group-data-[bande]/colonne:px-0',
        )}
      >
        <IconeDeLAgent etat={etat} projet={avecProjet ? projet : undefined} />
        <span className="min-w-0 flex-1 leading-tight group-data-[bande]/colonne:sr-only">
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              className={cn(
                'min-w-0 flex-1 truncate',
                pleinePage ? 'text-[15px]' : 'text-[14px]',
                ouverte ? 'text-teinte' : 'text-text',
                ligne.nonLue && 'font-semibold',
              )}
              data-titre-agent
            >
              {carte.title}
            </span>
          </span>
          <span className="mt-0.5 block truncate font-mono text-[10.5px] text-faint" data-branche-agent>
            {avecProjet && projet ? `${projet.name} · ${branche}` : branche}
          </span>
        </span>
        <span className="shrink-0 group-data-[bande]/colonne:hidden">
          <BadgeDEtatDAgent etat={etat} />
        </span>
      </button>
      {menuOuvert || menuMonte ? (
        <MenuCarte card={carte} ancrage="invisible" open={menuOuvert} onOpenChange={onMenu} agentActif={ligne.auTravail} />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* La recherche et son filtre                                           */
/* ------------------------------------------------------------------ */

function BarreDeRecherche({
  recherche,
  onRecherche,
  filtre,
  onFiltre,
  projets,
}: {
  recherche: string;
  onRecherche: (valeur: string) => void;
  filtre: FiltreDesAgents;
  onFiltre: (filtre: FiltreDesAgents) => void;
  projets?: Project[];
}) {
  const actif = filtreDesAgentsActif(filtre);
  const basculerEtat = (etat: EtatDAgentEnListe) => {
    const etats = filtre.etats ?? [];
    onFiltre({ ...filtre, etats: etats.includes(etat) ? etats.filter((e) => e !== etat) : [...etats, etat] });
  };
  const basculerProjet = (id: string) => {
    const liste = filtre.projets ?? [];
    onFiltre({ ...filtre, projets: liste.includes(id) ? liste.filter((p) => p !== id) : [...liste, id] });
  };
  const coche = (allume: boolean) => (
    <span
      aria-hidden
      className={cn(
        'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border',
        allume ? 'border-text bg-text text-bg' : 'border-faint',
      )}
    >
      {allume ? <span className="h-1.5 w-1.5 rounded-[1px] bg-bg" /> : null}
    </span>
  );
  return (
    <div className="flex items-center gap-1 group-data-[bande]/colonne:hidden" data-recherche-agents>
      <label className="flex h-[38px] min-w-0 flex-1 items-center gap-2 rounded-lg bg-surface px-2.5 sm:h-8">
        <Search className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
        <input
          type="search"
          value={recherche}
          onChange={(event) => onRecherche(event.target.value)}
          placeholder={t('Rechercher un agent')}
          aria-label="Rechercher un agent"
          data-champ-recherche-agents
          className="min-w-0 flex-1 bg-transparent text-[13.5px] text-text outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:hidden"
        />
        {recherche ? (
          <button
            type="button"
            aria-label="Effacer la recherche"
            className="shrink-0 text-faint hover:text-text"
            onClick={() => onRecherche('')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </label>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn('relative h-[38px] w-[38px] shrink-0 sm:h-8 sm:w-8', actif ? 'text-text' : 'text-muted')}
            aria-label="Filtrer les agents"
            title={t('Filtrer les agents')}
            data-filtre-agents={actif ? 'actif' : 'vide'}
          >
            <ListFilter className="h-4 w-4" />
            {actif ? <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-text" aria-hidden /> : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[220px]">
          <DropdownMenuLabel>{t('État')}</DropdownMenuLabel>
          {ETATS_D_AGENT_EN_LISTE.map((etat) => (
            <DropdownMenuItem
              key={etat}
              data-filtre-etat={etat}
              onSelect={(event) => {
                event.preventDefault();
                basculerEtat(etat);
              }}
            >
              {coche(!!filtre.etats?.includes(etat))}
              <IconeDEtatDAgent etat={etat} className="h-3.5 w-3.5" />
              <span className="flex-1">{t(LIBELLE_ETAT_D_AGENT[etat])}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            data-filtre-non-lus
            onSelect={(event) => {
              event.preventDefault();
              onFiltre({ ...filtre, nonLusSeulement: !filtre.nonLusSeulement });
            }}
          >
            {coche(!!filtre.nonLusSeulement)}
            <span className="flex-1">{t('Non lus seulement')}</span>
          </DropdownMenuItem>
          {projets && projets.length > 1 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{t('Projets')}</DropdownMenuLabel>
              {projets.map((projet) => (
                <DropdownMenuItem
                  key={projet.id}
                  data-filtre-projet={projet.id}
                  onSelect={(event) => {
                    event.preventDefault();
                    basculerProjet(projet.id);
                  }}
                >
                  {coche(!!filtre.projets?.includes(projet.id))}
                  <PastilleProjet project={projet} />
                  <span className="min-w-0 flex-1 truncate">{projet.name}</span>
                </DropdownMenuItem>
              ))}
            </>
          ) : null}
          {actif ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem data-filtre-effacer onSelect={() => onFiltre({})}>
                <X className="h-3.5 w-3.5" />
                {t('Effacer les filtres')}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* La liste                                                             */
/* ------------------------------------------------------------------ */

/** Ce que la liste montre, et comment elle fait venir la suite. */
interface SourceDesCartes {
  cartes: Card[];
  /** Rien n'est encore arrivé : la silhouette tient la place. */
  enAttente: boolean;
  /** Le nombre réel de cartes rangées (le démon les compte, même non reçues). */
  totalArchives: number;
  /** Reste-t-il des cartes actives sur le serveur ? */
  resteActives: boolean;
  resteArchives: boolean;
  chargerActives: () => void;
  chargerArchives: () => void;
  /** Tout faire venir avant une recherche : une carte non reçue ne se trouverait pas. */
  chargerTout: () => void;
}

/** Les cartes d'UN projet, lues dans le magasin et complétées tranche par tranche. */
function useCartesDuProjet(projectId: string): SourceDesCartes {
  const state = useApp();
  const cartes = React.useMemo(
    () => Object.values(state.cards).filter((card) => card.projectId === projectId && !carteMarketingCachee(card)),
    [state.cards, projectId],
  );
  const totaux = state.cartesTotaux[projectId];
  const recues = (colonne: ColumnKey) => cartes.filter((c) => c.column === colonne).length;
  const resteActives = COLONNES_ACTIVES.some((colonne) => resteSurLeServeur(recues(colonne), totaux?.[colonne]));
  const resteArchives = resteSurLeServeur(recues('archived'), totaux?.archived);
  return {
    cartes,
    enAttente: !state.pret && !state.copieLocale && !cartes.length,
    totalArchives: Math.max(recues('archived'), totaux?.archived ?? 0),
    resteActives,
    resteArchives,
    chargerActives: () => {
      for (const colonne of COLONNES_ACTIVES) {
        if (resteSurLeServeur(recues(colonne), totaux?.[colonne])) void client.chargerLaTranche(projectId, colonne).catch(() => undefined);
      }
    },
    chargerArchives: () => {
      if (resteArchives) void client.chargerLaTranche(projectId, 'archived').catch(() => undefined);
    },
    chargerTout: () => {
      for (const colonne of [...COLONNES_ACTIVES, 'archived'] as ColumnKey[]) {
        if (resteSurLeServeur(recues(colonne), totaux?.[colonne])) void client.chargerToutesLesCartes(projectId, colonne).catch(() => undefined);
      }
    },
  };
}

/** Les cartes de TOUS les projets, par les trois listes de « Tableaux de bord ». */
function useCartesDeTousLesProjets(): SourceDesCartes {
  const state = useApp();
  React.useEffect(() => {
    for (const onglet of ['actif', 'terminer', 'archive'] as const) void client.chargerEnRoute(onglet);
  }, []);
  const enService = React.useMemo(
    () => new Set(state.projects.filter((p) => !p.archived).map((p) => p.id)),
    [state.projects],
  );
  const cartes = React.useMemo(() => {
    const index = new Map<string, Card>();
    for (const reserve of [state.enRouteArchive?.cartes, state.enRouteTerminer?.cartes, state.enRoute?.cartes]) {
      for (const card of Object.values(reserve ?? {})) {
        if (enService.has(card.projectId) && !carteMarketingCachee(card)) index.set(card.id, state.cards[card.id] ?? card);
      }
    }
    return [...index.values()];
  }, [state.enRoute?.cartes, state.enRouteTerminer?.cartes, state.enRouteArchive?.cartes, state.cards, enService]);
  const resteActives = !!(state.enRoute?.restant || state.enRouteTerminer?.restant);
  const resteArchives = !!state.enRouteArchive?.restant;
  const archivesRecues = cartes.filter((c) => c.column === 'archived').length;
  return {
    cartes,
    enAttente: !state.enRoute?.charge,
    totalArchives: archivesRecues + (state.enRouteArchive?.restant ?? 0),
    resteActives,
    resteArchives,
    chargerActives: () => {
      if (state.enRoute?.restant) void client.chargerLaSuiteEnRoute('actif');
      if (state.enRouteTerminer?.restant) void client.chargerLaSuiteEnRoute('terminer');
    },
    chargerArchives: () => {
      if (state.enRouteArchive?.restant) void client.chargerLaSuiteEnRoute('archive');
    },
    chargerTout: () => {
      if (state.enRouteTerminer?.restant) void client.chargerToutTerminer();
    },
  };
}

export function ListeDesAgents({
  projectId,
  avecProjet = false,
  ...reste
}: {
  /** Le projet dont la liste montre les agents ; absent avec `avecProjet` (tous les projets). */
  projectId?: string;
  /** « Tableaux de bord » : tous les projets, la pastille du projet sur chaque ligne. */
  avecProjet?: boolean;
  /** La carte affichée à côté : sa ligne s'allume. */
  carteOuverte?: string | null;
  onOuvrir: (card: Card) => void;
  /** Une page entière (téléphone, Tableaux de bord) plutôt qu'une colonne. */
  pleinePage?: boolean;
  /** Ce qui précède la recherche : le bouton « Lancer un agent ». */
  entete?: React.ReactNode;
}) {
  return avecProjet || !projectId ? (
    <ListeDeTousLesProjets {...reste} />
  ) : (
    // Changer de projet, c'est une autre liste : recherche, filtre et paquets repartent à zéro.
    <ListeDUnProjet key={projectId} projectId={projectId} {...reste} />
  );
}

type ProprietesDeListe = Omit<React.ComponentProps<typeof ListeAvecSource>, 'source' | 'avecProjet'>;

function ListeDUnProjet({ projectId, ...reste }: ProprietesDeListe & { projectId: string }) {
  return <ListeAvecSource source={useCartesDuProjet(projectId)} {...reste} />;
}

function ListeDeTousLesProjets(props: ProprietesDeListe) {
  return <ListeAvecSource source={useCartesDeTousLesProjets()} avecProjet {...props} />;
}

function ListeAvecSource({
  source,
  avecProjet = false,
  carteOuverte,
  onOuvrir,
  pleinePage = false,
  entete,
}: {
  source: SourceDesCartes;
  avecProjet?: boolean;
  carteOuverte?: string | null;
  onOuvrir: (card: Card) => void;
  pleinePage?: boolean;
  entete?: React.ReactNode;
}) {
  const state = useApp();
  const [recherche, setRecherche] = React.useState('');
  const [filtre, setFiltre] = React.useState<FiltreDesAgents>({});
  const [paquets, setPaquets] = React.useState(1);
  const [paquetsArchives, setPaquetsArchives] = React.useState(1);
  const [menuPour, setMenuPour] = React.useState<string | null>(null);

  /* UNE RECHERCHE VOIT TOUT : ce qui n'est pas encore venu du serveur est
     demandé une fois, dès le premier caractère. */
  const toutDemande = React.useRef(false);
  React.useEffect(() => {
    if (!recherche.trim() || toutDemande.current) return;
    toutDemande.current = true;
    source.chargerTout();
  }, [recherche]);

  /* Les signaux de l'écran, rangés par carte une fois par rendu. */
  const signaux = React.useMemo(() => {
    const auTravail = new Set<string>();
    const attend = new Set<string>();
    for (const agent of Object.values(state.agents)) {
      if (!agent.cardId) continue;
      if (agentAuTravailALEcran(agent)) auTravail.add(agent.cardId);
      if (agent.attendReponse) attend.add(agent.cardId);
    }
    const quota = cartesEnAttenteDeQuota({
      agents: Object.values(state.agents),
      cartes: source.cartes,
      files: state.queues,
      decisions: state.decisions,
    });
    return { auTravail, attend, quota, decisions: alertesParCarte(state.decisions) };
  }, [state.agents, state.queues, state.decisions, source.cartes]);

  const lignes = React.useMemo<Ligne[]>(
    () =>
      source.cartes.map((carte) => {
        const auTravail = signaux.auTravail.has(carte.id);
        const etat = etatDeLAgentEnListe(carte, {
          auTravail,
          attendReponse: signaux.attend.has(carte.id),
          decisions: signaux.decisions[carte.id] ?? 0,
          enAttenteDeQuota: signaux.quota.has(carte.id),
        });
        return {
          carte,
          etat,
          auTravail,
          activite: Math.max(carte.updatedAt, carte.renduA ?? 0),
          nonLue: carteNonLue({ colonne: carte.column, renduA: carte.renduA, luA: carte.lastReadAt }),
        };
      }),
    [source.cartes, signaux],
  );

  const visibles = lignes.filter(
    (ligne) => agentCorrespond(ligne.carte, recherche) && passeLeFiltre(ligne, filtre),
  );
  const actives = grouperEnFamilles(visibles.filter((l) => !etatArchive(l.etat)));
  const archivees = grouperEnFamilles(visibles.filter((l) => etatArchive(l.etat)));
  const projets = React.useMemo(() => {
    if (!avecProjet) return undefined;
    const ids = new Set(source.cartes.map((c) => c.projectId));
    return state.projects.filter((p) => ids.has(p.id));
  }, [avecProjet, source.cartes, state.projects]);
  const projetParId = React.useMemo(() => new Map(state.projects.map((p) => [p.id, p])), [state.projects]);
  const cherche = !!recherche.trim() || filtreDesAgentsActif(filtre);

  const rendreFamille = (famille: FamilleDAgents<Ligne>) => (
    <React.Fragment key={famille.tete.carte.id}>
      {[famille.tete, ...famille.etapes].map((ligne, index) => (
        <LigneAgent
          key={ligne.carte.id}
          ligne={ligne}
          retrait={index > 0}
          ouverte={carteOuverte === ligne.carte.id}
          avecProjet={avecProjet}
          projet={projetParId.get(ligne.carte.projectId)}
          pleinePage={pleinePage}
          menuOuvert={menuPour === ligne.carte.id}
          onMenu={(ouvert) => setMenuPour(ouvert ? ligne.carte.id : null)}
          onOuvrir={() => onOuvrir(ligne.carte)}
        />
      ))}
    </React.Fragment>
  );

  const nombreActives = paquets * CARTES_PAR_PAQUET;
  const suiteActive = actives.length > nombreActives || (!cherche && source.resteActives);
  /*
   * LES ARCHIVÉS SUIVENT LES CARTES ACTIVES, SANS BOUTON (demande du
   * 30/10/2026) : la liste continue sur eux, par paquets à la mesure de la zone
   * (`pasArchives`, autant de lignes que la hauteur en montre), et le paquet
   * suivant arrive quand on approche du bas — défilement infini, par une
   * sentinelle observée, jamais par un clic.
   */
  const listeRef = React.useRef<HTMLDivElement>(null);
  const sentinelle = React.useRef<HTMLDivElement>(null);
  const [pasArchives, setPasArchives] = React.useState(12);
  React.useLayoutEffect(() => {
    const zone = listeRef.current?.closest<HTMLElement>('[data-zone-liste-agents]');
    if (!zone) return;
    const hauteurDeLigne = pleinePage ? 66 : 52;
    const mesurer = () => setPasArchives(Math.max(6, Math.ceil(zone.clientHeight / hauteurDeLigne) + 2));
    mesurer();
    const observateur = new ResizeObserver(mesurer);
    observateur.observe(zone);
    return () => observateur.disconnect();
  }, [pleinePage, source.enAttente]);
  const nombreArchives = paquetsArchives * pasArchives;
  const suiteArchives = archivees.length > nombreArchives || (!cherche && source.resteArchives);
  const totalArchives = cherche ? archivees.length : Math.max(source.totalArchives, archivees.length);
  /* Une même demande au serveur ne part qu'une fois par nombre de cartes reçues. */
  const dejaDemande = React.useRef<Record<string, number>>({});
  const demander = (cle: 'actives' | 'archives', recues: number, charger: () => void) => {
    if (dejaDemande.current[cle] === recues) return;
    dejaDemande.current[cle] = recues;
    charger();
  };
  const avancer = React.useRef<() => void>(() => undefined);
  avancer.current = () => {
    if (actives.length > nombreActives) return setPaquets((n) => n + 1);
    if (!cherche && source.resteActives) return demander('actives', actives.length, source.chargerActives);
    if (archivees.length > nombreArchives) return setPaquetsArchives((n) => n + 1);
    if (!cherche && source.resteArchives) demander('archives', archivees.length, source.chargerArchives);
  };
  /* Rien d'archivé n'est encore venu : le premier paquet se demande d'office. */
  React.useEffect(() => {
    if (!source.enAttente && !archivees.length && source.resteArchives) demander('archives', 0, source.chargerArchives);
  }, [source.enAttente, archivees.length, source.resteArchives]);
  /* L'observateur est reposé à chaque paquet : une sentinelle encore visible
     après l'arrivée d'un paquet relance aussitôt le suivant. */
  React.useEffect(() => {
    const noeud = sentinelle.current;
    if (!noeud || !(suiteActive || suiteArchives)) return;
    const observateur = new IntersectionObserver((entrees) => {
      if (entrees.some((e) => e.isIntersecting)) avancer.current();
    }, { rootMargin: '0px 0px 320px 0px' });
    observateur.observe(noeud);
    return () => observateur.disconnect();
  }, [suiteActive, suiteArchives, nombreActives, nombreArchives, actives.length, archivees.length]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-liste-des-agents={avecProjet ? 'tous' : 'projet'}>
      <div className={cn('flex shrink-0 flex-col gap-2 pb-2', pleinePage ? 'px-4 pt-3' : 'pt-1')}>
        {entete}
        <BarreDeRecherche recherche={recherche} onRecherche={setRecherche} filtre={filtre} onFiltre={setFiltre} projets={projets} />
      </div>
      <ZoneDefilement
        hauteur={16}
        classeEnveloppe="min-h-0 flex-1"
        className={cn('touch-pan-y pb-4', pleinePage && 'px-2')}
        data-zone-liste-agents
      >
        {source.enAttente ? (
          <SilhouetteAgents pleinePage={pleinePage} />
        ) : (
          <div ref={listeRef} role="list" className="flex flex-col gap-0.5">
            {actives.slice(0, nombreActives).map(rendreFamille)}
            {!actives.length && !archivees.length ? (
              <p className="px-3 py-6 text-center text-[13px] leading-snug text-faint" data-liste-agents-vide>
                {cherche ? t('Aucun agent ne correspond.') : t('Aucun agent pour l’instant. Lancez-en un pour commencer.')}
              </p>
            ) : null}
            {totalArchives > 0 && (!suiteActive || cherche) ? (
              <>
                <p
                  data-titre-archives
                  className="mt-3 px-2.5 py-1.5 text-[12px] text-faint group-data-[bande]/colonne:hidden"
                >
                  {t('Archivés ({n})', { n: totalArchives })}
                </p>
                <div role="list" className="flex flex-col gap-0.5" data-liste-archives>
                  {archivees.slice(0, nombreArchives).map(rendreFamille)}
                </div>
              </>
            ) : null}
            {/* LA SENTINELLE DU DÉFILEMENT INFINI : approchée, elle pose le paquet suivant. */}
            {suiteActive || suiteArchives ? (
              <div ref={sentinelle} aria-hidden className="flex h-10 items-center justify-center" data-suite-de-la-liste>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-faint motion-reduce:animate-none" strokeWidth={1.5} />
              </div>
            ) : null}
          </div>
        )}
      </ZoneDefilement>
    </div>
  );
}
