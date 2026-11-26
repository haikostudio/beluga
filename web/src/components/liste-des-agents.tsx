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
 * UNE SEULE LISTE, SANS CLASSEMENT (demande du 30/10/2026) : toutes les cartes, y
 * compris rangées et étapes de suite, de la plus récemment modifiée à la plus
 * ancienne (`shared/src/liste-par-date.ts`), chargées au défilement. En tête, une
 * recherche (nom ou branche) et son filtre (états, non lus, projets), d'un bloc.
 * DEPUIS LE 01/11/2026 (capture #ca0c), les ACTIVES montent au-dessus d'un trait
 * (`ligneActive`, `SeparationDesActives`) — « Archivé » centré sur le trait, sur une page ; dans la colonne,
 * depuis le 04/11/2026, plus de trait : les rangées s'y effacent à 30 % —, et badge comme rond prennent la couleur de leur famille
 * (`familleDeCouleur`) : violet, jaune, vert ou gris.
 *
 * Les gestes rares passent par le MENU D'UNE CARTE (`MenuCarte`) : clic droit à
 * la souris, appui long au doigt — où il s'ouvre en panneau du bas. Les cartes
 * se posent par paquets de vingt, une silhouette tient la place tant que rien
 * n'est arrivé, et la zone défile par `ZoneDefilement`.
 */
import * as React from 'react';
import { LignesDesChefsAuTravail } from '@/components/chefs-au-travail';
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Check,
  CircleCheck,
  Hourglass,
  ListFilter,
  Hammer,
  Loader2,
  MessageCircleQuestion,
  Pause,
  PencilLine,
  Rocket,
  Search,
  X,
} from '@/components/ui/icones';
import {
  CARTES_PAR_DATE_EN_RECHERCHE,
  CARTES_PAR_PAQUET,
  ETATS_D_AGENT_EN_LISTE,
  LIBELLE_ETAT_D_AGENT,
  agentAuTravailALEcran,
  agentCorrespond,
  alertesParCarte,
  questionsParCarte,
  brancheDeLaCarte,
  carteCacheeDesListes,
  cartesAvecAgentActif,
  ligneActive,
  familleDeCouleur,
  separerActives,
  miseEnLigneAfficheeActive,
  type EntreeDuFluxMele,
  type PublicationSysteme,
  termineeNonOuverte,
  type FamilleDeCouleur,
  fluxMele,
  carteNonLue,
  cartesEnAttenteDeQuota,
  cleDeLecture,
  etatDeLAgentEnListe,
  fillesDeLaMere,
  filtreDesAgentsActif,
  sansLesFillesRangees,
  passeLeFiltre,
  trierParDate,
  type Card,
  type EtatDAgentEnListe,
  type FiltreDesAgents,
  type LigneDAgent,
  type Project,
  estUnRegroupement,
  membresActifsDuRegroupement,
  construireFragment,
} from '@beluga/shared';
import {
  BoutonTroisPoints,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
  ZoneDefilement,
} from '@/components/ui';
import { BadgeDEtape } from '@/components/badge-etape';
import { MenuCarte } from '@/components/card-menu';
import { PastilleProjet } from '@/components/pastille-projet';
import { SilhouetteAgents } from '@/components/silhouettes';
import { LigneDeMiseEnLigne, useMisesEnLigneParDate } from '@/components/mises-en-ligne';
import { PortraitDAgent } from '@/components/equipe/portrait-d-agent';
import { client } from '@/lib/client';
import { useMinute } from '@/lib/horloge';
import { t } from '@/lib/langue';
import { useApp } from '@/lib/use-app';
import { cn, dateHeureComplete, depuisCourt, ilYA } from '@/lib/utils';

/**
 * `active` : la ligne monte au-dessus du trait (`ligneActive`) ; `famille` : la couleur de son badge et de son rond
 * (`familleDeCouleur`). Calculés une fois, à l'heure de la minute partagée.
 */
export type Ligne = LigneDAgent<Card> & { auTravail: boolean; active: boolean; famille: FamilleDeCouleur };

/* ------------------------------------------------------------------ */
/* L'icône d'état : noire et grise, sauf le travail en violet, et qui VIT */
/* ------------------------------------------------------------------ */

/**
 * L'ICÔNE D'ÉTAT D'UN AGENT, EN COULEUR (décision du 16/11/2026, capture #7619, remplace le monochrome du
 * 30/10/2026) : vert = terminé (`--etat-termine`), bleu = en cours (`--important`), jaune = question
 * (`--cadre-question`), le sablier d'une carte lancée est bleu et clignote doucement ; pause, en ligne,
 * archivée et brouillon restent gris. Le rond du coin d'une icône de projet reprend la même couleur en bordure
 * (`COULEUR_DU_ROND`) ; hors de ce rond (tableau, listes) l'icône reste monochrome. Elle vit —
 * l'anneau tourne, la question bat, la coche se dessine, le sablier bascule — et
 * se fige pour qui a demandé moins de mouvement à son appareil
 * (`motion-reduce`, et `prefers-reduced-motion` dans `styles.css`).
 */

export function IconeDEtatDAgent({ etat, className, strokeWidth, colore = false }: { etat: EtatDAgentEnListe; className?: string; strokeWidth?: number; colore?: boolean }) {
  /* PLUS ÉPURÉE (demande du 30/10/2026) : le trait fin de la famille Lucide
     (1,5 au lieu de 2), un cran plus petite. */
  const classe = cn('h-3.5 w-3.5 shrink-0', className);
  const trait = strokeWidth ?? 1.5;
  switch (etat) {
    case 'travail':
      return <Hammer strokeWidth={trait} className={cn(classe, 'icone-marteau-frappe', colore ? 'text-important' : 'text-text')} aria-hidden />;
    case 'cadrage':
      return <PencilLine strokeWidth={trait} className={cn(classe, 'icone-crayon-ecrit', colore ? 'text-important' : 'text-text')} aria-hidden />;
    case 'a-vous':
      return <MessageCircleQuestion strokeWidth={trait} className={cn(classe, 'animate-pulse-soft text-important motion-reduce:animate-none', colore && 'text-[hsl(var(--cadre-question))]')} aria-hidden />;
    case 'lance':
      return <Hourglass strokeWidth={trait} className={cn(classe, 'icone-sablier', colore ? 'animate-pulse-soft text-important motion-reduce:animate-none' : 'text-muted')} aria-hidden />;
    case 'en-pause':
      return <Pause strokeWidth={trait} className={cn(classe, 'text-muted')} aria-hidden />;
    case 'a-deployer':
      return <CircleCheck strokeWidth={trait} className={cn(classe, 'icone-coche-dessinee', colore ? 'text-[hsl(var(--etat-termine))]' : 'text-text')} aria-hidden />;
    case 'en-ligne':
      return <Rocket strokeWidth={trait} className={cn(classe, 'text-faint')} aria-hidden />;
    case 'archive':
      return <Archive strokeWidth={trait} className={cn(classe, 'text-faint')} aria-hidden />;
    case 'echec':
      /* UNE MISE EN LIGNE TOMBÉE (17/11/2026, maquette #fbdfc) : un point ROUGE plein, sans icône. */
      return (
        <span aria-hidden data-point-rouge-echec className={cn('flex items-center justify-center', classe)}>
          <span className="block h-[70%] w-[70%] rounded-full bg-danger" />
        </span>
      );
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
export function IconeDeLAgent({ etat, projet, petite = false }: { etat: EtatDAgentEnListe; projet?: Project; petite?: boolean }) {
  const state = useApp();
  if (!projet) return <IconeDEtatDAgent etat={etat} />;
  /* UN REGROUPEMENT SANS ICÔNE PREND CELLE D'UN DE SES PROJETS (demande du 31/10/2026) : il n'affichait qu'une lettre. */
  const portee = !projet.favicon && estUnRegroupement(projet) ? (membresActifsDuRegroupement(state.projects, projet.id).find((m) => m.favicon) ?? projet) : projet;
  return (
    /* `petite` : la même icône, un cran plus petite, pour la colonne de gauche et les onglets (14/11/2026). */
    <span className={cn('relative flex shrink-0 items-center justify-center', petite ? 'h-[18px] w-[18px]' : 'h-6 w-6')} data-icone-agent-projet>
      <PastilleProjet project={portee} taille={petite ? 16 : 20} />
      {/* LE ROND D'ÉTAT (décision de l'utilisateur du 16/11/2026, #2a77) : plus petit, SANS contour, du fond de la zone
          où il est posé, 2 px autour du signe ; la couleur de l'état est portée par le signe seul. */}
      <span
        className={cn(
          'absolute -right-1.5 -top-1.5 flex items-center justify-center rounded-full bg-[hsl(var(--fond-zone,var(--fond-colonne)))]',
          petite ? 'h-[13px] w-[13px]' : 'h-[15px] w-[15px]',
        )}
        data-rond-d-etat={etat}
      >
        <IconeDEtatDAgent etat={etat} className={petite ? 'h-[9px] w-[9px]' : 'h-[11px] w-[11px]'} strokeWidth={2} colore />
      </span>
    </span>
  );
}

/**
 * L'ÉTAT D'UN AGENT SE LIT À LA FORME (décision de l'utilisateur du 14/11/2026, remplace les quatre couleurs du
 * 01/11/2026) : un ANNEAU QUI TOURNE quand il travaille, un POINT ORANGE quand il attend l'utilisateur, une petite
 * COCHE quand c'est prêt à déployer, RIEN au repos. Le vert et le violet ont disparu. Même taille, même place.
 */
export function PastilleDeFamille({ famille, className }: { famille: FamilleDeCouleur; className?: string }) {
  if (famille === 'agit')
    return (
      <span
        aria-hidden
        data-rond-famille={famille}
        data-forme="anneau"
        className={cn('block h-2 w-2 animate-spin rounded-full border-[1.5px] border-muted border-t-transparent [animation-duration:1.2s] motion-reduce:animate-none', className)}
      />
    );
  if (famille === 'a-vous')
    return <span aria-hidden data-rond-famille={famille} data-forme="point" className={cn('block h-1.5 w-1.5 rounded-full bg-important', className)} />;
  if (famille === 'pret')
    return (
      <span aria-hidden data-rond-famille={famille} data-forme="coche" className={cn('flex h-2 w-2 items-center justify-center text-text', className)}>
        <Check strokeWidth={3} className="h-2 w-2" />
      </span>
    );
  return null;
}

/**
 * DANS LA COLONNE DE GAUCHE, LA PASTILLE D'ÉTAT AU COIN DE L'ICÔNE (01/11/2026, formes depuis le 14/11/2026) : sans
 * texte — la date reste au bout du titre. Posée en `absolute` sur une enveloppe de la taille de l'icône : ni l'icône
 * ni le titre ne bougent d'un pixel. Rien pour la famille au repos.
 */
export function IconeEtRondDeFamille({ etat, famille }: { etat: EtatDAgentEnListe; famille: FamilleDeCouleur }) {
  return (
    <span className="relative flex shrink-0" data-icone-et-rond>
      <IconeDEtatDAgent etat={etat} />
      {famille === 'repos' || famille === 'a-vous' ? null : (
        <span className="absolute -right-0.5 -top-0.5 rounded-full bg-[hsl(var(--fond-zone,var(--surface)))]">
          <PastilleDeFamille famille={famille} />
        </span>
      )}
    </span>
  );
}

/** Le ton du badge pour chaque famille de couleur (`familleDeCouleur`). */
const TON_DE_LA_FAMILLE = { agit: 'travail', 'a-vous': 'comprehension', pret: 'pret', repos: 'neutre' } as const;

/** Le badge d'état, en petit : violet, jaune, vert ou gris selon sa famille (demande du 01/11/2026). */
export function BadgeDEtatDAgent({ etat, famille }: { etat: EtatDAgentEnListe; famille: FamilleDeCouleur }) {
  return (
    <BadgeDEtape
      ton={TON_DE_LA_FAMILLE[famille]}
      data-etat-badge={etat}
      data-famille-badge={famille}
      className="h-3.5 rounded-[4px] px-1 text-[9.5px]"
    >
      {t(LIBELLE_ETAT_D_AGENT[etat])}
    </BadgeDEtape>
  );
}

/**
 * LA DATE DE LA DERNIÈRE ACTIVITÉ D'UN AGENT (31/10/2026) : celle qui range la
 * liste. Sur une page, « il y a 3 h », la date et l'heure après sept jours ;
 * dans la colonne, la forme très courte (« 3 h », « 14/10 »). Elle seule suit
 * l'horloge de la minute, partagée par toute l'application : la ligne ne se
 * redessine pas pour elle.
 */
export function DateDeLAgent({ at, courte }: { at: number; courte?: boolean }) {
  const maintenant = useMinute();
  return (
    <span
      data-date-agent
      className={cn('shrink-0 whitespace-nowrap tabular-nums text-faint', courte ? 'text-[11px]' : 'text-[10.5px] leading-none')}
    >
      {courte ? depuisCourt(at, maintenant) : ilYA(at, maintenant)}
    </span>
  );
}

/** Ce que dit la bulle d'une ligne de la colonne, au survol : statut, titre entier, date exacte, branche. */
function BulleDeLAgent({ ligne, branche }: { ligne: Ligne; branche: string }) {
  return (
    <span className="flex flex-col gap-0.5 whitespace-normal break-words" data-bulle-agent={ligne.carte.id}>
      <span className="text-[11px] font-semibold uppercase tracking-wide opacity-70">{t(LIBELLE_ETAT_D_AGENT[ligne.etat])}</span>
      <span className="font-medium">{ligne.carte.title}</span>
      <span className="text-[12px] opacity-80">{dateHeureComplete(ligne.activite)}</span>
      {branche ? <span className="break-all font-mono text-[11px] opacity-70">{branche}</span> : null}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Les lignes                                                           */
/* ------------------------------------------------------------------ */

/** La durée d'un appui qui ouvre le menu au doigt — et le déplacement qui l'annule. */
const APPUI_LONG_MS = 480;
const TOLERANCE_APPUI_PX = 8;

export function LigneAgent({
  ligne,
  ouverte,
  avecProjet,
  projet,
  pleinePage,
  compacte,
  menuOuvert,
  onMenu,
  onOuvrir,
  filles,
  zoneEnCours = false,
  rangee = false,
  tactile = false,
  porteur,
}: {
  /**
   * L'AGENT QUI PORTE LA TÂCHE (zone « Au travail », carte « Beluga piloté par des agents », 26/11/2026) : son visage
   * remplace l'icône de la ligne, et une seconde ligne dit « Max · Projet » — « Max vous attend · Projet » en couleur
   * d'accent quand la tâche attend une réponse.
   */
  porteur?: { portrait: string | null; couleur: string; nom: string } | null;
  /**
   * LA LIGNE DE LA COLONNE, AU DOIGT (volet « Tâches » du téléphone, décision de l'utilisateur du 16/11/2026 #3836) : la
   * même ligne que sous un projet de la colonne — icône d'état, titre, heure à droite —, haute de 44 px, sans bulle.
   */
  tactile?: boolean;
  ligne: Ligne;
  /**
   * UNE LIGNE DE LA ZONE « EN COURS » de la colonne (`taches-en-cours.tsx`) : la même tâche y paraît AUSSI sous son
   * projet. Elle porte donc `data-agent-en-cours` au lieu de `data-agent-en-liste` (les contrôles visent la ligne
   * sous le projet), et une tâche déjà en ligne n'y pâlit pas : elle y est justement pour être vue.
   */
  zoneEnCours?: boolean;
  /**
   * UNE LIGNE RANGÉE DE LA COLONNE DE GAUCHE (archivée, déjà en ligne — carte du 04/11/2026, capture #2271) : plus de
   * trait « Archivé » au-dessus d'elle, elle s'efface à 30 % et redevient nette au survol, au focus ou au toucher. La
   * carte ouverte et son menu ouvert restent nets.
   */
  rangee?: boolean;
  /** UNE CARTE MÈRE (projet réuni) : son chevron déplie ses filles, une par projet du groupe. */
  filles?: { nombre: number; ouvert: boolean; basculer: () => void };
  ouverte: boolean;
  avecProjet?: boolean;
  projet?: Project;
  pleinePage?: boolean;
  /** Une ligne de la colonne de gauche, sous son projet : l'icône d'état et le titre. */
  compacte?: boolean;
  menuOuvert: boolean;
  onMenu: (ouvert: boolean) => void;
  onOuvrir: () => void;
}) {
  const { carte, etat } = ligne;
  const branche = brancheDeLaCarte(carte).replace(/^tache\//, '');
  /* DANS LA COLONNE, LE MÊME REPÈRE QUE LES TABLEAUX DE BORD (décision du 14/11/2026) : l'icône du projet, l'état de
     l'agent dans son coin — sous son projet comme dans « En cours ». */
  const projetsConnus = useApp().projects;
  const projetDeLaLigne = projet ?? (compacte ? projetsConnus.find((p) => p.id === carte.projectId) : undefined);
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
  const bouton = (
    /* LA LIGNE RESTE UN BOUTON : son appui long (menu au doigt) ne survit pas à un lien, que le navigateur garde pour
       lui. Ctrl/Cmd-clic et clic du milieu l'ouvrent pourtant dans un onglet neuf (03/11/2026), et le clic droit garde
       le menu de la carte, qui propose « Ouvrir dans un nouvel onglet ». */
    <button
      type="button"
      onAuxClick={(event) => {
        if (event.button !== 1 || (event.nativeEvent as PointerEvent).pointerType === 'touch') return;
        event.preventDefault();
        window.open('#' + construireFragment({ vue: 'projet', projectId: carte.projectId, cardId: carte.id }), '_blank', 'noopener');
      }}
      aria-current={ouverte ? 'page' : undefined}
      /* Dans la colonne, la bulle maison dit le titre entier : pas de seconde bulle. */
      title={compacte ? undefined : carte.title}
      onClick={(event) => {
        if (appuiAbouti.current) {
          appuiAbouti.current = false;
          event.preventDefault();
          return;
        }
        /* SEUL UN CLIC MODIFIÉ À LA SOURIS ouvre un onglet neuf : le relâché d'un appui long au doigt arrive comme un
           clic d'un autre bouton, et ouvrait la carte dans un onglet — la page passait en arrière-plan, figée. */
        if (event.button === 0 && (event.metaKey || event.ctrlKey || event.shiftKey) && (event.nativeEvent as PointerEvent).pointerType !== 'touch') {
          window.open('#' + construireFragment({ vue: 'projet', projectId: carte.projectId, cardId: carte.id }), '_blank', 'noopener');
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
        pleinePage ? 'px-3 py-3' : compacte ? (tactile ? 'min-h-[44px] px-2 py-1' : 'min-h-[38px] px-2 py-1 sm:min-h-8') : 'px-2.5 py-2',
        /* DANS LA COLONNE DE GAUCHE, L'AGENT OUVERT A UN FOND TRÈS LÉGER (demande du 01/11/2026, capture #10c2), en
           plus de son repère : sous son projet comme dans « En cours » (`.ligne-ouverte-de-colonne`, styles.css). */
        compacte ? cn('relative hover:bg-raised', ouverte && 'ligne-ouverte-de-colonne') : ouverte ? 'bg-ligne-active' : 'hover:bg-raised',
        'group-data-[bande]/colonne:justify-center group-data-[bande]/colonne:px-0',
      )}
    >
      {compacte && porteur ? (
        <PortraitDAgent portrait={porteur.portrait} couleur={porteur.couleur} nom={porteur.nom} taille={28} attend={etat === 'a-vous'} fond="hsl(var(--fond-zone))" />
      ) : compacte ? (
        projetDeLaLigne ? (
          <IconeDeLAgent etat={etat} projet={projetDeLaLigne} petite />
        ) : (
          <IconeEtRondDeFamille etat={etat} famille={ligne.famille} />
        )
      ) : (
        <IconeDeLAgent etat={etat} projet={avecProjet ? projet : undefined} />
      )}
      <span className="min-w-0 flex-1 leading-tight group-data-[bande]/colonne:sr-only">
        <span className="flex min-w-0 items-center gap-1.5">
          {/* LA ZONE « EN COURS » DE LA COLONNE (tous projets) : la pastille du projet devant le titre. */}
          {/* La pastille du projet devant le titre a disparu (14/11/2026) : elle EST l'icône de la ligne. */}
          <span
            className={cn(
              'min-w-0 flex-1 truncate',
              pleinePage ? 'text-[15px]' : compacte ? (tactile ? 'text-[15px]' : 'text-[13.5px]') : 'text-[14px]',
              /* LA TÂCHE OUVERTE, DANS LA COLONNE : en orange (14/11/2026) ; ailleurs, le gris plein suffit. */
              ouverte && compacte && etat !== 'a-vous' ? 'text-important' : 'text-text',
              ligne.nonLue && 'font-semibold',
            )}
            data-titre-agent
          >
            {carte.title}
          </span>
          {/* DANS LA COLONNE, PAS DE BADGE : la date courte au bout du titre, la bulle dit le reste. */}
          {compacte ? (
            /* AU SURVOL, LA DATE CÈDE SA PLACE AUX TROIS POINTS du menu (posés par-dessus, `BoutonTroisPoints`). */
            <span className={cn('flex shrink-0 group-data-[bande]/colonne:hidden', !tactile && 'group-hover/ligne:invisible', !tactile && menuOuvert && 'invisible')}>
              <DateDeLAgent at={ligne.activite} courte />
            </span>
          ) : null}
        </span>
        {compacte && porteur ? (
          <span className="mt-0.5 block truncate text-[12px]" data-porteur-de-la-tache={porteur.nom}>
            {etat === 'a-vous' ? (
              <span className="text-important">{t('{v0} vous attend', { v0: porteur.nom })}</span>
            ) : (
              <span className="text-faint">{porteur.nom}</span>
            )}
            {projetDeLaLigne ? <span className="text-faint"> · {projetDeLaLigne.name}</span> : null}
          </span>
        ) : null}
        {compacte ? null : (
          <span className="mt-0.5 block truncate font-mono text-[10.5px] text-faint" data-branche-agent>
            {avecProjet && projet ? `${projet.name} · ${branche}` : branche}
          </span>
        )}
      </span>
      {/* SUR UNE PAGE, LE BADGE ET LA DATE À DROITE, l'un sous l'autre (capture #06c6) : c'est le titre qui se coupe. */}
      {compacte ? null : (
        <span className="flex shrink-0 flex-col items-end gap-1 group-data-[bande]/colonne:hidden" data-etat-et-date>
          <BadgeDEtatDAgent etat={etat} famille={ligne.famille} />
          <DateDeLAgent at={ligne.activite} />
        </span>
      )}
    </button>
  );
  return (
    <div
      /* LE CADRE JAUNE D'UN AGENT QUI ATTEND SA RÉPONSE (demande du 30/10/2026) :
         le trait des questions, jusqu'à la réponse — ouvrir la carte n'enlève que
         le gras du titre. Un `outline` : il ne décale pas la ligne d'un pixel. */
      className={cn(
        'group/ligne relative flex items-center rounded-lg',
        etat === 'a-vous' && 'contour-de-question',
        /* UN AGENT DÉJÀ MIS EN LIGNE S'EFFACE À 60 % (demande du 31/10/2026) — sauf la carte ouverte, qui reste lisible. */
        etat === 'en-ligne' && !ouverte && !zoneEnCours && !rangee && 'opacity-60',
        rangee && !ouverte && !menuOuvert && 'opacity-30 transition-opacity duration-150 hover:opacity-100 focus-within:opacity-100 active:opacity-100 motion-reduce:transition-none',
      )}
      data-ligne-rangee={rangee ? '' : undefined}
      role="listitem"
      {...(zoneEnCours ? { 'data-agent-en-cours': carte.id } : { 'data-agent-en-liste': carte.id })}
      data-etat-agent={etat}
      data-agent-attend-reponse={etat === 'a-vous' ? '' : undefined}
      data-ouvert={ouverte ? '' : undefined}
    >
      {compacte && !tactile ? (
        <Tooltip label={<BulleDeLAgent ligne={ligne} branche={branche} />} side="right" desactive={menuOuvert} className="max-w-[300px]">
          {bouton}
        </Tooltip>
      ) : (
        bouton
      )}
      {filles ? (
        <button
          type="button"
          onClick={filles.basculer}
          aria-expanded={filles.ouvert}
          aria-label={filles.ouvert ? 'Replier les cartes des projets' : 'Déplier les cartes des projets'}
          title={filles.ouvert ? t('Replier les cartes des projets') : t('Déplier les cartes des projets ({n})', { n: filles.nombre })}
          className="flex h-7 w-6 shrink-0 items-center justify-center rounded-md text-faint hover:text-text group-data-[bande]/colonne:hidden"
          data-deplier-filles={carte.id}
        >
          {!compacte ? (
            /* Le paquet : le chevron pointe vers le bas et se retourne avec lui. */
            <ChevronDown className={cn('h-4 w-4 transition-transform duration-300 motion-reduce:transition-none', filles.ouvert && 'rotate-180')} />
          ) : (
            <ChevronRight className={cn('h-3.5 w-3.5 transition-transform motion-reduce:transition-none', filles.ouvert && 'rotate-90')} />
          )}
        </button>
      ) : null}
      {/* LES TROIS POINTS DU SURVOL ouvrent le menu du clic droit, au même endroit (coin haut droit de la ligne). Au
          doigt, l'appui long reste le geste : pas de bouton sur un écran tactile. */}
      {!tactile ? (
        <BoutonTroisPoints
          ouvert={menuOuvert}
          className={cn('absolute top-1/2 h-6 w-6 -translate-y-1/2 bg-raised group-data-[bande]/colonne:hidden [@media(hover:none)]:hidden', filles ? 'right-7' : 'right-1.5')}
          onClick={(event) => {
            event.stopPropagation();
            onMenu(!menuOuvert);
          }}
          data-menu-agent={carte.id}
        />
      ) : null}
      {menuOuvert || menuMonte ? (
        <MenuCarte card={carte} ancrage="invisible" open={menuOuvert} onOpenChange={onMenu} agentActif={ligne.auTravail} />
      ) : null}
    </div>
  );
}

/**
 * UNE LIGNE ET, POUR UNE CARTE MÈRE, SES FILLES (demande du 31/10/2026, le concept de l'ancien tableau) : le chevron
 * déplie une ligne par projet du groupe, la pastille du projet en tête. Une fille absente du magasin est demandée à
 * l'ouverture seulement, une à une (`chargerCarte`) : rien n'est lu tant que la mère reste repliée.
 */
const TRANCHES_DU_PAQUET = 3;

export function LigneEtFilles(props: Omit<React.ComponentProps<typeof LigneAgent>, 'filles'> & { carteOuverte?: string | null; onOuvrirFille: (card: Card) => void }) {
  const { carteOuverte, onOuvrirFille, ...ligne } = props;
  const ids = fillesDeLaMere(ligne.ligne.carte);
  const [ouvert, setOuvert] = React.useState(() => !!carteOuverte && ids.includes(carteOuverte));
  /* LES FILLES NE SE MONTENT QU'AU PREMIER DÉPLIAGE (rien n'est lu avant), puis restent là pour se ranger en
     s'animant. Monter d'abord, déplier à l'image d'après : sans cela le paquet s'ouvrirait d'un coup la première fois. */
  const [montees, setMontees] = React.useState(ouvert);
  if (!ids.length) return <LigneAgent {...ligne} />;
  /* Sur une page, jamais dans la colonne : « Tableaux de bord » sur ordinateur n'est pas `pleinePage`. */
  if (!ligne.compacte) {
    const basculer = () => {
      if (montees) return setOuvert((o) => !o);
      setMontees(true);
      requestAnimationFrame(() => requestAnimationFrame(() => setOuvert(true)));
    };
    const tranches = Math.min(ids.length, TRANCHES_DU_PAQUET);
    return (
      <div data-paquet-de-cartes={ouvert ? 'ouvert' : 'ferme'} className="pb-1">
        <div className="carte-du-paquet relative z-[1] rounded-xl pr-1.5" data-cadre-du-paquet>
          <LigneAgent {...ligne} filles={{ nombre: ids.length, ouvert, basculer }} />
        </div>
        {/* LES BORDS DES CARTES DU DESSOUS : un par fille, trois au plus, chacun un peu plus étroit. */}
        <div aria-hidden data-tranches-du-paquet={tranches}>
          {Array.from({ length: tranches }, (_, rang) => (
            <div
              key={rang}
              data-tranche-du-paquet
              className={cn(
                'carte-du-paquet-dessous rounded-b-lg transition-all duration-300 ease-out motion-reduce:transition-none',
                ouvert ? 'mt-0 h-0 opacity-0' : 'mt-0.5 h-[5px]',
              )}
              style={{ marginInline: (rang + 1) * 10, ...(ouvert ? {} : { opacity: 1 - rang * 0.25 }) }}
            />
          ))}
        </div>
        <div
          className={cn(
            /* `invisible` à la fin du repli : une carte rangée ne se clique plus, ne prend plus le clavier. */
            'grid transition-[grid-template-rows,visibility] duration-300 ease-out motion-reduce:transition-none',
            ouvert ? 'visible grid-rows-[1fr]' : 'invisible grid-rows-[0fr]',
          )}
        >
          <div className="min-h-0 overflow-hidden">
            {montees ? (
              <FillesDeLaMere ids={ids} pleinePage={ligne.pleinePage} carteOuverte={carteOuverte} onOuvrir={onOuvrirFille} paquetOuvert={ouvert} />
            ) : null}
          </div>
        </div>
      </div>
    );
  }
  return (
    <>
      <LigneAgent {...ligne} filles={{ nombre: ids.length, ouvert, basculer: () => setOuvert((o) => !o) }} />
      {ouvert ? <FillesDeLaMere ids={ids} compacte={ligne.compacte} pleinePage={ligne.pleinePage} carteOuverte={carteOuverte} onOuvrir={onOuvrirFille} /> : null}
    </>
  );
}

function FillesDeLaMere({
  ids,
  compacte,
  pleinePage,
  carteOuverte,
  onOuvrir,
  paquetOuvert,
}: {
  ids: string[];
  compacte?: boolean;
  pleinePage?: boolean;
  carteOuverte?: string | null;
  onOuvrir: (card: Card) => void;
  /** En pleine page, le groupe est un paquet : chaque fille en sort à son tour, puis y rentre en ordre inverse. */
  paquetOuvert?: boolean;
}) {
  const state = useApp();
  const [menuPour, setMenuPour] = React.useState<string | null>(null);
  React.useEffect(() => {
    for (const id of ids) if (!client.lireEtat().cards[id]) void client.chargerCarte(id);
  }, [ids.join(',')]);
  const cartes = React.useMemo(() => ids.map((id) => state.cards[id]).filter((c): c is Card => !!c), [ids.join(','), state.cards]);
  const lignes = useLignesDAgents(cartes);
  const projetParId = React.useMemo(() => new Map(state.projects.map((p) => [p.id, p])), [state.projects]);
  const enPaquet = paquetOuvert !== undefined;
  return (
    <div
      role="list"
      className={cn('flex flex-col', enPaquet ? 'gap-1 pt-1' : 'gap-0.5 pl-5 group-data-[bande]/colonne:pl-0')}
      data-filles-de-la-mere={ids.join(',')}
    >
      {lignes.map((l, rang) => {
        const fille = (
          <LigneAgent
            key={l.carte.id}
            ligne={l}
            avecProjet
            projet={projetParId.get(l.carte.projectId)}
            compacte={compacte}
            pleinePage={pleinePage}
            ouverte={carteOuverte === l.carte.id}
            menuOuvert={menuPour === l.carte.id}
            onMenu={(o) => setMenuPour(o ? l.carte.id : null)}
            onOuvrir={() => onOuvrir(l.carte)}
          />
        );
        if (!enPaquet) return fille;
        return (
          <div
            key={l.carte.id}
            data-fille-du-paquet
            className={cn(
              'carte-du-paquet-dessous ml-3 rounded-xl transition-[transform,opacity] duration-300 ease-out motion-reduce:transform-none motion-reduce:transition-none',
              paquetOuvert ? 'translate-y-0 opacity-100' : '-translate-y-3 scale-[0.98] opacity-0',
            )}
            style={{ transitionDelay: `${(paquetOuvert ? rang : lignes.length - 1 - rang) * 40}ms` }}
          >
            {fille}
          </div>
        );
      })}
      {lignes.length < ids.length ? (
        <div className="flex h-8 items-center px-2" aria-hidden>
          <Loader2 className="h-3.5 w-3.5 animate-spin text-faint motion-reduce:animate-none" strokeWidth={1.5} />
        </div>
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
    /* UN SEUL BLOC (capture #a4f2) : le champ et son filtre partagent le même fond — le gris DOUX commun
       (`bg-controle-doux`, 15/11/2026 : `bg-surface` valait le fond de la feuille du bas et disparaissait),
       sans écart ; un trait fin les sépare. Pas d'`overflow-hidden` ici : le point du
       filtre et le menu n'ont pas à être rognés. */
    <div className="flex h-[38px] items-stretch rounded-lg bg-controle-doux group-data-[bande]/colonne:hidden sm:h-8" data-recherche-agents>
      <label className="flex min-w-0 flex-1 items-center gap-2 px-2.5" data-recherche-agents-champ>
        <Search className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
        <input
          type="text"
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
      <span aria-hidden className="my-2 w-px shrink-0 bg-faint/40" data-separation-recherche />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn('relative h-full w-[38px] shrink-0 rounded-l-none rounded-r-lg sm:h-full sm:w-8', actif ? 'text-text' : 'text-muted')}
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
  /** Reste-t-il des cartes sur le serveur, sous la dernière reçue ? */
  reste: boolean;
  /** Change à chaque paquet reçu : une même suite ne se demande qu'une fois. */
  jeton: string;
  /** Une lecture refusée se dit telle quelle, au lieu d'une liste qu'on croirait vide. */
  erreur?: string;
  chargerLaSuite: (limite?: number) => void;
}

/**
 * LES CARTES OÙ UN AGENT TOURNE OU ATTEND. Le même ensemble tant que sa composition ne change pas : les agents
 * bougent à chaque mot écrit, et les listes qui en dépendent n'ont à se recalculer que si l'une d'elles change.
 */
export function useCartesAvecAgentActif(): ReadonlySet<string> {
  const agents = useApp().agents;
  const cle = [...cartesAvecAgentActif(Object.values(agents))].sort().join(',');
  return React.useMemo(() => new Set(cle ? cle.split(',') : []), [cle]);
}

/**
 * LES CARTES D'UN PROJET, OU DE TOUS, PAR DATE. Le magasin (`cards`) tient lieu de
 * liste le temps de la première réponse, ou si la lecture tombe (copie locale,
 * coupure) ; ensuite, la lecture par curseur fait foi. Une carte déjà connue du
 * magasin garde sa version la plus récente.
 */
export function useCartesParDate(projectId?: string): SourceDesCartes {
  const state = useApp();
  const portee = React.useMemo(() => (projectId ? { projectId } : {}), [projectId]);
  const lecture = state.lecturesParDate[cleDeLecture(portee)];
  React.useEffect(() => {
    void client.chargerParDate(portee);
  }, [portee]);
  const enService = React.useMemo(
    () => new Set(state.projects.filter((p) => !p.archived).map((p) => p.id)),
    [state.projects],
  );
  const lectureUtile = !!lecture?.charge && !lecture.erreur;
  const actives = useCartesAvecAgentActif();
  /* UNE CARTE ACTIVE ANCIENNE (un agent qui tourne, un vieux brouillon, un rendu pas encore ouvert) n'est peut-être dans
     aucun paquet déjà lu : la lecture de la colonne, elle, les tient toutes (`tachesDeLaColonne`) — elles montent
     au-dessus du trait dès la première lecture (01/11/2026). */
  const pret = state.pret;
  const tachesChargees = !!state.tachesDeLaColonne;
  React.useEffect(() => {
    if (pret && !tachesChargees) void client.chargerLesTachesDeLaColonne();
  }, [pret, tachesChargees]);
  const cartes = React.useMemo(() => {
    const base = lectureUtile
      ? Object.values(lecture.cartes)
      : projectId
        ? Object.values(state.cards).filter((card) => card.projectId === projectId)
        : Object.values(lecture?.cartes ?? {});
    const parId = new Map(base.map((card) => [card.id, card]));
    for (const card of Object.values(state.tachesDeLaColonne ?? {})) {
      if (!parId.has(card.id) && (!projectId || card.projectId === projectId)) parId.set(card.id, card);
    }
    return trierParDate(
      [...parId.values()]
        .map((card) => {
          const connue = state.cards[card.id];
          return connue && connue.updatedAt >= card.updatedAt ? connue : card;
        })
        .filter((card) => enService.has(card.projectId) && !carteCacheeDesListes(card, actives.has(card.id))),
    );
  }, [lectureUtile, lecture?.cartes, projectId, state.cards, state.tachesDeLaColonne, enService, actives]);
  return {
    cartes,
    enAttente: !lecture?.charge && !cartes.length,
    reste: !!lecture?.reste,
    jeton: lecture?.curseur ? `${lecture.curseur.updatedAt}/${lecture.curseur.id}` : '',
    erreur: lecture?.erreur,
    chargerLaSuite: (limite) => void client.chargerLaSuiteParDate(portee, limite),
  };
}

/** Les signaux de l'écran, rangés par carte, puis une ligne par carte. */
export function useLignesDAgents(cartes: Card[]): Ligne[] {
  const state = useApp();
  /* La borne des trente jours d'un rendu à ouvrir n'a pas besoin de la minute : l'instant du montage suffit, et la
     liste ne se redessine pas à chaque tour d'horloge. */
  const [maintenant] = React.useState(() => Date.now());
  const signaux = React.useMemo(() => {
    const auTravail = new Set<string>();
    const auCadrage = new Set<string>();
    const attend = new Set<string>();
    for (const agent of Object.values(state.agents)) {
      if (!agent.cardId) continue;
      if (agentAuTravailALEcran(agent)) {
        /* Un cadrage qui tient son tour : le crayon ; tout autre agent au travail : le marteau. */
        if (agent.role === 'cadrage') auCadrage.add(agent.cardId);
        else auTravail.add(agent.cardId);
      }
      if (agent.attendReponse) attend.add(agent.cardId);
    }
    const quota = cartesEnAttenteDeQuota({
      agents: Object.values(state.agents),
      cartes,
      files: state.queues,
      decisions: state.decisions,
    });
    return { auTravail, auCadrage, attend, quota, decisions: alertesParCarte(state.decisions), questions: questionsParCarte(state.decisions) };
  }, [state.agents, state.queues, state.decisions, cartes]);
  return React.useMemo<Ligne[]>(
    () =>
      cartes.map((carte) => {
        const auCadrage = signaux.auCadrage.has(carte.id) && !signaux.auTravail.has(carte.id);
        const auTravail = signaux.auTravail.has(carte.id) || auCadrage;
        const etat = etatDeLAgentEnListe(carte, {
          auTravail,
          auCadrage,
          attendReponse: signaux.attend.has(carte.id),
          decisions: signaux.decisions[carte.id] ?? 0,
          questions: signaux.questions[carte.id] ?? 0,
          enAttenteDeQuota: signaux.quota.has(carte.id),
        });
        return {
          carte,
          etat,
          auTravail,
          active: ligneActive({ etat, carte }, maintenant),
          famille: familleDeCouleur(etat, termineeNonOuverte(carte, maintenant)),
          // La même clé que l'ordre de la liste et que le curseur du démon.
          activite: carte.updatedAt,
          nonLue: carteNonLue({ colonne: carte.column, renduA: carte.renduA, luA: carte.lastReadAt }),
        };
      }),
    [cartes, signaux, maintenant],
  );
}

/**
 * Une entrée du flux mêlé est-elle active ? La ligne le dit pour une carte ; une mise en ligne l'est tant qu'elle tourne
 * ET, depuis le 17/11/2026, tant qu'elle est tombée sans avoir été dépassée (son dépannage la relancera).
 */
export function entreeActive<R extends PublicationSysteme>(entree: EntreeDuFluxMele<Ligne, R>): boolean {
  return entree.genre === 'carte' ? entree.ligne.active : miseEnLigneAfficheeActive(entree.run);
}

/**
 * LE TRAIT ENTRE LES ACTIVES ET LES RANGÉES (demande du 01/11/2026, capture #ca0c : « une petite ligne qui sépare les
 * cartes archivées des cartes actives »). Un trait qui porte une information suit `--faint`, jamais `--border`. Il
 * porte, AU CENTRE, une petite étiquette « Archivé » (captures #8035f et #9d9f du 01/11/2026) : trait | mot | trait.
 * Il ne se pose que si les deux groupes existent (`separerActives`). SUR UNE PAGE SEULEMENT : la colonne de gauche ne
 * le pose plus (carte du 04/11/2026, capture #2271), ses rangées s'effacent à la place (`rangee` de `LigneAgent`).
 */
export function SeparationDesActives() {
  return (
    <div role="separator" data-separation-actives="libelle" className="flex items-center gap-2 px-2.5 pb-1 pt-2.5">
      <span aria-hidden className="h-px flex-1 bg-faint/30" />
      <span className="shrink-0 text-[11px] leading-none text-faint" data-etiquette-archive>
        {t('Archivé')}
      </span>
      <span aria-hidden className="h-px flex-1 bg-faint/30" />
    </div>
  );
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
  /** Les lignes de la COLONNE (icône, titre, heure), au doigt : le volet « Tâches » du téléphone. */
  formatColonne?: boolean;
  /** Ce qui précède la recherche : le bouton « Lancer un agent ». */
  entete?: React.ReactNode;
  /** Ce qui suit la liste, dans la même zone qui défile (la page d'un projet sur téléphone). */
  pied?: React.ReactNode;
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
  return <ListeAvecSource source={useCartesParDate(projectId)} projectId={projectId} {...reste} />;
}

function ListeDeTousLesProjets(props: ProprietesDeListe) {
  return <ListeAvecSource source={useCartesParDate()} avecProjet {...props} />;
}

function ListeAvecSource({
  source,
  projectId,
  avecProjet = false,
  carteOuverte,
  onOuvrir,
  pleinePage = false,
  formatColonne = false,
  entete,
  pied,
}: {
  source: SourceDesCartes;
  /** Le projet de la liste : ses mises en ligne s'y mêlent. Absent : celles de tous les projets. */
  projectId?: string;
  avecProjet?: boolean;
  carteOuverte?: string | null;
  onOuvrir: (card: Card) => void;
  pleinePage?: boolean;
  formatColonne?: boolean;
  entete?: React.ReactNode;
  pied?: React.ReactNode;
}) {
  const state = useApp();
  const [recherche, setRecherche] = React.useState('');
  const [filtre, setFiltre] = React.useState<FiltreDesAgents>({});
  const [paquets, setPaquets] = React.useState(1);
  const [menuPour, setMenuPour] = React.useState<string | null>(null);

  /* Une fille dont la mère est listée se range sous elle : jamais deux fois la même carte. */
  const racines = React.useMemo(() => sansLesFillesRangees(source.cartes), [source.cartes]);
  const lignes = useLignesDAgents(racines);
  const visibles = lignes.filter(
    (ligne) => agentCorrespond(ligne.carte, recherche) && passeLeFiltre(ligne, filtre),
  );
  const projets = React.useMemo(() => {
    if (!avecProjet) return undefined;
    const ids = new Set(source.cartes.map((c) => c.projectId));
    return state.projects.filter((p) => ids.has(p.id));
  }, [avecProjet, source.cartes, state.projects]);
  const projetParId = React.useMemo(() => new Map(state.projects.map((p) => [p.id, p])), [state.projects]);
  const cherche = !!recherche.trim() || filtreDesAgentsActif(filtre);

  const nombre = paquets * CARTES_PAR_PAQUET;
  /* CHAQUE DÉPLOIEMENT ET CHAQUE MISE EN PRODUCTION EST UNE LIGNE, à sa date parmi les agents (`fluxMele`). Une
     recherche ou un filtre ne cherche que des agents : les mises en ligne se retirent le temps de la recherche. */
  const misesEnLigne = useMisesEnLigneParDate(projectId);
  const runsVisibles = cherche ? [] : misesEnLigne.runs;
  const chargerLaSuiteDesMisesEnLigne = misesEnLigne.chargerLaSuite;
  React.useEffect(() => {
    if (!cherche) chargerLaSuiteDesMisesEnLigne(nombre);
  }, [nombre, cherche, chargerLaSuiteDesMisesEnLigne]);
  const lesVisibles = React.useMemo(() => new Set(visibles.map((ligne) => ligne.carte.id)), [visibles]);
  /* LES ACTIVES AU-DESSUS DU TRAIT (demande du 01/11/2026) : aucune ne reste sous le dernier paquet posé, et chaque
     groupe garde son ordre de date. Une mise en ligne qui tourne est active, finie elle descend avec les rangées. */
  const { entrees: flux, trait } = separerActives(fluxMele(visibles, lesVisibles, runsVisibles, nombre, (ligne) => ligne.active), entreeActive);
  const suite = visibles.length + runsVisibles.length > nombre || source.reste || (!cherche && misesEnLigne.reste);
  /*
   * LE DÉFILEMENT INFINI, PAR UNE SEULE SENTINELLE : approchée, elle pose le paquet
   * suivant, puis fait venir la suite du démon. UNE RECHERCHE VOIT TOUT : tant que ses
   * résultats ne remplissent pas la zone, la sentinelle reste en vue et les paquets
   * s'enchaînent jusqu'au bout, plus gros, sans qu'une carte non reçue puisse manquer.
   */
  const sentinelle = React.useRef<HTMLDivElement>(null);
  const dejaDemande = React.useRef<string | null>(null);
  const avancer = React.useRef<() => void>(() => undefined);
  avancer.current = () => {
    if (visibles.length > nombre) return setPaquets((n) => n + 1);
    if (!source.reste || dejaDemande.current === source.jeton) return;
    dejaDemande.current = source.jeton;
    source.chargerLaSuite(cherche ? CARTES_PAR_DATE_EN_RECHERCHE : undefined);
  };
  /* L'observateur est reposé à chaque paquet : une sentinelle encore visible après
     l'arrivée d'un paquet relance aussitôt le suivant. */
  React.useEffect(() => {
    const noeud = sentinelle.current;
    if (!noeud || !suite) return;
    const observateur = new IntersectionObserver((entrees) => {
      if (entrees.some((e) => e.isIntersecting)) avancer.current();
    }, { rootMargin: '0px 0px 320px 0px' });
    observateur.observe(noeud);
    return () => observateur.disconnect();
  }, [suite, nombre, visibles.length, source.jeton, cherche]);

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
          <div role="list" className="flex flex-col gap-0.5">
            {/* LES CHEFS DE COMMUNICATION AU TRAVAIL, en tête des actives (03/11/2026) : ils n'ont pas de carte. */}
            {cherche ? null : <LignesDesChefsAuTravail projectId={avecProjet ? undefined : projectId} />}
            {/* Un agent actif ne reste jamais au-delà du dernier paquet posé. */}
            {flux.map((entree, index) => {
              const separation = index === trait ? <SeparationDesActives key="separation-actives" /> : null;
              if (entree.genre === 'mise-en-ligne') {
                return (
                  <React.Fragment key={entree.id}>
                  {separation}
                  <LigneDeMiseEnLigne
                    key={entree.id}
                    run={entree.run}
                    avecProjet={avecProjet}
                    projet={projetParId.get(entree.run.projectId)}
                    pleinePage={pleinePage && !formatColonne}
                    compacte={formatColonne || undefined}
                  />
                  </React.Fragment>
                );
              }
              const ligne = entree.ligne;
              return (
              <React.Fragment key={ligne.carte.id}>
              {separation}
              <LigneEtFilles
                carteOuverte={carteOuverte}
                onOuvrirFille={(card) => {
                  client.verserCarte(card);
                  onOuvrir(card);
                }}
                ligne={ligne}
                ouverte={carteOuverte === ligne.carte.id}
                avecProjet={avecProjet}
                projet={projetParId.get(ligne.carte.projectId)}
                pleinePage={pleinePage && !formatColonne}
                compacte={formatColonne || undefined}
                tactile={formatColonne || undefined}
                menuOuvert={menuPour === ligne.carte.id}
                onMenu={(ouvert) => setMenuPour(ouvert ? ligne.carte.id : null)}
                onOuvrir={() => {
                  // Une carte rangée n'est pas forcément dans le magasin que lit la conversation.
                  client.verserCarte(ligne.carte);
                  onOuvrir(ligne.carte);
                }}
              />
              </React.Fragment>
              );
            })}
            {!visibles.length && !runsVisibles.length && !suite ? (
              <p className="px-3 py-6 text-center text-[13px] leading-snug text-faint" data-liste-agents-vide>
                {source.erreur && !lignes.length
                  ? source.erreur
                  : cherche
                    ? t('Aucun agent ne correspond.')
                    : t('Aucun agent pour l’instant. Lancez-en un pour commencer.')}
              </p>
            ) : null}
            {/* LA SENTINELLE DU DÉFILEMENT INFINI : approchée, elle pose le paquet suivant. */}
            {suite ? (
              <div ref={sentinelle} aria-hidden className="flex h-10 items-center justify-center" data-suite-de-la-liste>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-faint motion-reduce:animate-none" strokeWidth={1.5} />
              </div>
            ) : null}
          </div>
        )}
        {pied && !suite ? <div className="px-2 pt-6" data-pied-de-la-liste>{pied}</div> : null}
      </ZoneDefilement>
    </div>
  );
}
