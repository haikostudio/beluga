import { LienInterne } from '@/components/ui/lien-interne';
import * as React from 'react';
import {
  Menu,
  ArchiveRestore,
  FolderOpen,
  ChevronLeft,
  ChevronRight,
  Copy,
  Folder,
  FolderPlus,
  Github,
  GripVertical,
  PanelLeft,
  Settings,
  SquarePen,
  EllipsisVertical,
  SquareKanban,
  Loader2,
  Palette,
  Paperclip,
  Pencil,
  Plus,
  FileCheck2,
  Search,
  Settings2,
  TerminalSquare,
  UploadCloud,
  Waypoints,
  X,
} from '@/components/ui/icones';
import {
  COULEURS_DE_GROUPE,
  CLE_OUVERTURES_DE_PROJETS,
  CLE_TRI_PAR_OUVERTURE,
  ordonnerParDerniereOuverture,
  ouverturesValides,
  Project,
  type VueCentrale,
  ProjectGroup,
  type AvancementColonne,
  type SignalProjet,
  zoneDesProjets,
  type DepotDuCompte,
  filtrerDepots,
  lireLienGithub,
  caseCahierCocheeParDefaut,
  activiteDeProjet,
  agentTientSonTour,
  avancementDeLaColonne,
  doitSecouerLigne,
  premiereDecision,
  repereVisible,
  iconeDuLot,
  carteCacheeDesListes,
  cartesAvecAgentActif,
  decisionsOuvertes,
  fillesDeLaMere,
  signauxSansLigne,
  filtrerLaColonne,
  type Card,
  type IconeDAttention,
  signalDuGroupe,
  estUnRegroupement,
  membresActifsDuRegroupement,
  compterEnPanne,
  texteDuCompteur,
} from '@beluga/shared';
import { construireFragment, idDuGroupeLocal } from '@beluga/shared';
import {
  RAISON_SANS_REPONSE,
  bilanDuMontageRate,
  etapesPrevuesDepuisGithub,
  etapesPrevuesDuMontageNeuf,
  lignesDuMontage,
  type EtapeDuMontage,
  type LigneDuMontage,
} from '@beluga/shared';
import { CLASSE_TRAIT_VERT, RondDEtape } from '@/components/barre-etapes';
import { libelleAttention, RepereAttention } from '@/components/repere-attention';
import {
  BulleInfo,
  Button,
  CLASSE_POINT_DE_BOUTON,
  CLASSE_RANGEE_DE_BOUTONS,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Dot,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Label,
  PromptDialog,
  Switch,
  TabsList,
  TabsTrigger,
  Tooltip,
  ZoneDefilement,
  FormulaireEnColonnes,
  LigneFormulaire,
} from '@/components/ui';
import { PastilleProjet, PastillesEmpilees } from '@/components/pastille-projet';
import { PastillesMessagerie } from '@/components/pastilles-messagerie';
import { ouvrirLesFichiers } from '@/lib/ouvrir-les-fichiers';
import { useServicesOuverts } from '@/components/services';
import { MenuNouvelAgent, type CibleDeCreation, type TypeDAgent } from '@/components/menus-de-la-colonne';
import { ServicesDuBasDeLaColonne } from '@/components/services-de-la-colonne';
import { FlecheDesTaches, TachesDuProjet, TachesTrouvees, useTachesParProjet } from '@/components/taches-du-projet';
import { TachesEnCours } from '@/components/taches-en-cours';
import { QuotaBadge } from '@/components/quota-badge';
import { CLE_COLONNE_REDUITE, useMoteurActif } from '@/components/quota-bar';
import { TemoinDuServeur, useTeinteDuTemoinServeur, useTexteDuTemoinServeur } from '@/components/temoin-du-serveur';
import { PointRedemarrage, useRedemarrage } from '@/components/redemarrage';
import { bulleDuTerminal } from '@/components/pastille-terminal';
import { ouvrirLeTerminal, useEtatDuTerminal } from '@/lib/ouvrir-terminal';
import { ouvrirConfigProjet } from '@/lib/ouvrir-config-projet';
import { client, EVENEMENT_MONTAGE } from '@/lib/client';
import { usePointerDrag } from '@/lib/dnd';
import { modifierLaListe, usePref } from '@/lib/prefs';
import { useTelephone } from '@/lib/telephone';
import { ClocheNotifications } from '@/components/notifications';
import { useApp } from '@/lib/use-app';
import { useGlissementDeCarte } from '@/lib/deplacement-de-projet';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';
import { ouvrirLAjoutDeProjet } from '@/components/pas-a-pas';
import { useTiroirAdresse } from '@/lib/tiroirs-adresse';

/** Un élément de la colonne : un projet hors groupe, ou un groupe entier. */
type Entry =
  | { kind: 'project'; id: string; rank: number; project: Project }
  | { kind: 'group'; id: string; rank: number; group: ProjectGroup; members: Project[] };

/**
 * LA LARGEUR DE LA COLONNE RÉTRÉCIE : juste de quoi poser une icône de projet,
 * son point d'alerte et le retrait de la liste. La MÊME STRUCTURE que le menu
 * large tient dedans — groupes compris —, seuls les noms s'effacent.
 */
const LARGEUR_BANDE = 52;

/** La souris à ce nombre de pixels du bord gauche de la fenêtre ouvre le menu des agents. */
const BORD_QUI_OUVRE_LE_MENU = 4;

export function Sidebar({
  onOpenAgent,
  width,
  onChoose,
  vue,
  onOuvrirVue,
  onOpenSettings,
  onNouvelAgent,
  service,
  onCorpsDeService,
  carteOuverte,
  onOuvrirCarte,
  onEntrerDansLeProjet,
  onCreerAgent,
  onOuvrirServiceCentral,
  serviceCentralActif,
}: {
  /** « Nouvel agent › type › projet » (14/11/2026) : l'application crée l'élément et ouvre son onglet. */
  onCreerAgent?: (type: TypeDAgent, cible: CibleDeCreation) => void;
  /** « Services › … » (14/11/2026) : la page centrale du service, tous projets. */
  onOuvrirServiceCentral?: (cle: string) => void;
  serviceCentralActif?: string | null;
  /** Le NOM d'un projet cliqué (pas son badge « rendu ») : la page s'ouvre sur son dernier agent. */
  /** Obligatoire : toute instance de la colonne mène un projet touché à sa page principale. */
  onEntrerDansLeProjet: (projectId: string) => void;
  onOpenAgent: (agentId: string) => void;
  width?: number;
  /**
   * UN SERVICE QUI A SON MENU LE POSE DANS LA COLONNE (`ColonneDeService`) : la tête
   * porte alors son nom et le bouton menu des agents et projets. Partout ailleurs —
   * tableau de bord, projet, tâche —, la colonne reste la même (demande du
   * 30/10/2026). `plan: 'page'` : une tâche est ouverte par-dessus le service ; son
   * menu reste monté, caché, et la colonne rend les projets.
   */
  service?: {
    titre: string;
    plan?: 'service' | 'page';
  } | null;
  /** L'emplacement où le service pose son menu, remis à l'application. */
  onCorpsDeService?: (element: HTMLElement | null) => void;
  /** La tâche affichée au centre : sa ligne s'allume sous son projet. */
  carteOuverte?: string | null;
  /** Ouvre une tâche de l'arbre, dans son projet. */
  onOuvrirCarte?: (card: Card) => void;
  /** Ouvre les réglages : LE bouton du pied de colonne. */
  onOpenSettings?: () => void;
  /**
   * Lance un nouvel agent : sans projet, le choix du projet (première ligne de la colonne) ; avec un projet, le « + »
   * posé au survol de sa ligne — l'agent naît directement dans ce projet (un projet réuni : une carte mère qui
   * travaille sur les projets du groupe).
   */
  onNouvelAgent?: (projectId?: string) => void;
  /** Prévenu dès qu'un projet est choisi : le panneau latéral se referme. */
  onChoose?: () => void;
  /**
   * LA DESTINATION AFFICHÉE AU CENTRE. La colonne est une liste PLATE : chaque
   * ligne est une destination, celle qui est affichée s'allume, et cliquer une
   * autre REMPLACE le contenu central. Aucune ne se pose par-dessus, donc
   * aucune n'a de croix.
   */
  vue: VueCentrale;
  onOuvrirVue: (vue: VueCentrale) => void;
}) {
  const state = useApp();
  /* SUR TÉLÉPHONE, LES OUTILS DES LIGNES (poignées, réglages, crayon, croix)
     SE CACHENT derrière un interrupteur de la tête de colonne : sans survol,
     ils restaient toujours visibles et chargeaient la liste. Éteint à chaque
     ouverture du volet ; l'ordinateur ne change pas (le survol les révèle). */
  const telephone = useTelephone();
  const [outilsVisibles, setOutilsVisibles] = React.useState(false);
  const outilsCaches = telephone && !outilsVisibles;
  const [adding, setAdding] = React.useState(false);
  /* « Projets du serveur » a son adresse ; la colonne posée à gauche la tient
     (un lien collé la rouvre). Celle du panneau du téléphone n'est montée qu'à
     l'ouverture : c'est le volet lui-même qui écrit son nom. */
  useTiroirAdresse(onChoose ? null : 'projets-du-serveur', adding, setAdding);
  /* L'assistant de premier démarrage fait ouvrir CETTE fenêtre d'ajout plutôt
     que d'en écrire une seconde (`assistant-demarrage.tsx`). Seule la colonne
     posée à gauche écoute : celle du téléphone n'est pas toujours montée, et
     deux à l'écoute ouvriraient deux fenêtres. */
  React.useEffect(() => {
    if (onChoose) return;
    const ouvrir = () => setAdding(true);
    window.addEventListener('beluga:ajouter-projet', ouvrir);
    return () => window.removeEventListener('beluga:ajouter-projet', ouvrir);
  }, [onChoose]);
  const [showArchived, setShowArchived] = React.useState(false);
  const [archived, setArchived] = React.useState<Project[]>([]);
  // Ce qui est replié est enregistré côté serveur, comme le reste.
  /* CES TROIS LISTES SE MODIFIENT PAR `modifierLaListe` (demande du 01/11/2026 : « mémoriser les projets
     ouverts ou fermés ») : depuis la dernière valeur connue, jamais avant l'arrivée des réglages du serveur.
     Sinon un geste ou le dépliage automatique repartait d'une liste vide ou ancienne, et la défaisait. */
  const [collapsed] = usePref<string[]>('sidebar.collapsed', []);
  /* LES PROJETS RÉUNIS DÉPLIÉS — repliés par défaut : un clic sur leur nom ou
     leur flèche ouvre le sous-groupe de leurs membres. */
  const [regroupementsOuverts] = usePref<string[]>('sidebar.regroupementsOuverts', []);
  /* LES PROJETS DÉPLIÉS SUR LEURS TÂCHES : plusieurs à la fois, retenus comme le reste.
     Le projet où l'on entre se déplie seul ; sa flèche le replie. */
  const [projetsDeplies] = usePref<string[]>('sidebar.projetsDeplies', []);
  const deplierLeProjet = (id: string) => {
    modifierLaListe('sidebar.projetsDeplies', id, true);
  };
  const basculerLeProjet = (id: string) => {
    modifierLaListe('sidebar.projetsDeplies', id);
  };
  const projetRegarde = vue === 'projet' ? state.activeProjectId : null;
  /* Le projet regardé se déplie seul — une fois les réglages du serveur arrivés, pas avant. */
  const reglagesArrives = state.pret && !state.copieLocale;
  React.useEffect(() => {
    if (projetRegarde && reglagesArrives) deplierLeProjet(projetRegarde);
  }, [projetRegarde, reglagesArrives]);
  const tachesParProjet = useTachesParProjet();
  /*
   * LE TRI PAR DERNIÈRE OUVERTURE est une BASCULE, éteinte par défaut (demande
   * du 15/10/2026). Allumée, la colonne montre groupes et projets du plus
   * récemment ouvert au plus ancien et le glisser-déposer est SUSPENDU ; éteinte,
   * c'est l'ordre manuel, exactement. Le rang (`rank`) n'est JAMAIS écrit par
   * ce mode : il ne change que par un geste de rangement, ordre manuel actif.
   */
  const [triParOuverture, setTriParOuverture] = usePref<boolean>(CLE_TRI_PAR_OUVERTURE, false);
  const ouvertLe = React.useMemo(
    () => ouverturesValides(state.prefs[CLE_OUVERTURES_DE_PROJETS]),
    [state.prefs[CLE_OUVERTURES_DE_PROJETS]],
  );

  /*
   * LA COLONNE ENTIÈRE SE RÉDUIT À UNE BANDE D'ICÔNES.
   *
   * `sidebar.collapsed` ne replie que des GROUPES ; c'est un second réglage,
   * `colonne.reduite`, qui replie la COLONNE. Il vit en base comme le reste :
   * le choix survit au rechargement et suit l'appareil.
   *
   * RÉDUITE, LA COLONNE NE MONTRE QUE DES ICÔNES ALIGNÉES ; au survol de la
   * bande, le panneau entier se déplie EN SURIMPRESSION (`absolute`, au-dessus
   * du contenu) : la zone de droite ne bouge pas d'un pixel. À la sortie du
   * curseur, il se referme — après un court délai de grâce, sans quoi le
   * moindre passage sur un bord le ferait clignoter.
   *
   * SUR TÉLÉPHONE, RIEN DE TOUT CELA : il n'y a pas de survol, et la colonne
   * vit déjà dans un panneau qui s'ouvre au toucher. Le réglage y est ignoré.
   */
  const [reduite, setReduite] = usePref<boolean>(CLE_COLONNE_REDUITE, false);
  const [survolee, setSurvolee] = React.useState(false);
  const minuterieSurvol = React.useRef<number | undefined>(undefined);
  const refColonne = React.useRef<HTMLElement>(null);
  const reduitEffectif = reduite && !telephone;
  /** La bande seule : réduite, et le curseur n'est pas dessus. */
  const bandeSeule = reduitEffectif && !survolee;
  const ouvrirAuSurvol = () => {
    window.clearTimeout(minuterieSurvol.current);
    setSurvolee(true);
  };
  /*
   * UN MENU OUVERT DEPUIS LA COLONNE LA RETIENT. Les services, les quotas, le
   * « … » d'un projet s'ouvrent dans un calque posé HORS de la colonne : aller
   * vers eux, c'est la quitter. Elle se refermait donc sous le menu, démontait
   * son bouton, et le menu disparaissait avant le clic (« le bouton des
   * services ferme la colonne et je n'y ai pas accès »). Tant qu'un de ses
   * boutons tient un menu ouvert (`aria-haspopup` + `aria-expanded`, posés par
   * Radix), la fermeture attend ; le menu refermé, elle a lieu — sauf si le
   * curseur est revenu sur la colonne.
   */
  const fermerAuSurvolBientot = () => {
    window.clearTimeout(minuterieSurvol.current);
    const tenter = () => {
      const colonne = refColonne.current;
      if (colonne?.querySelector('[aria-haspopup][aria-expanded="true"]')) {
        minuterieSurvol.current = window.setTimeout(tenter, 150);
        return;
      }
      if (colonne?.matches(':hover')) return;
      /* On tape dans la recherche : le panneau ne se referme pas sous les doigts. */
      if (document.activeElement?.matches('[data-champ-recherche-colonne]')) {
        minuterieSurvol.current = window.setTimeout(tenter, 150);
        return;
      }
      setSurvolee(false);
    };
    minuterieSurvol.current = window.setTimeout(tenter, 150);
  };
  React.useEffect(() => () => window.clearTimeout(minuterieSurvol.current), []);
  // Repliée à la main : le panneau ne doit pas rester ouvert sous le curseur.
  React.useEffect(() => {
    if (!reduitEffectif) setSurvolee(false);
  }, [reduitEffectif]);

  /*
   * LE BOUTON QUI REPLIE LA COLONNE N'EST PLUS ICI. Il était posé dans la ligne
   * de titre « PROJETS », au milieu de la colonne ; il vit désormais tout en
   * haut à gauche de la barre du haut (`quota-bar.tsx`), là où se trouvait le
   * point d'état — qu'il porte maintenant dans son coin. Un seul bouton dans
   * l'application, pas deux : celui-ci a été RETIRÉ, il n'a pas été copié.
   *
   * Le réglage, lui, reste lu ici (`colonne.reduite`) : les deux composants
   * passent par le magasin des préférences et ne peuvent pas diverger.
   */
  const [creatingGroup, setCreatingGroup] = React.useState(false);
  const [renaming, setRenaming] = React.useState<ProjectGroup | null>(null);
  const [deleting, setDeleting] = React.useState<ProjectGroup | null>(null);

  // Le glissement suit le pointeur : l'emplacement visé se marque exactement là
  // où on vise, à la souris comme au doigt.
  const entriesRef = React.useRef<Entry[]>([]);
  const projetsRef = React.useRef(state.projects);
  projetsRef.current = state.projects;

  /*
   * Hauteur de la ligne saisie, mesurée au moment où on l'attrape : c'est de
   * cette hauteur que l'espace s'ouvre, ni plus ni moins.
   */
  const [hauteurLigne, setHauteurLigne] = React.useState(32);

  /*
   * La place de chaque ligne, relevée UNE fois au moment où on l'attrape, et
   * comptée depuis le haut du contenu (le défilement est donc sans effet).
   * On vise d'après ce relevé, jamais d'après ce qu'il y a sous le curseur :
   * comme les voisins se décalent, la ligne visée se déroberait sous le
   * pointeur et l'affichage se mettrait à osciller.
   */
  const geoRef = React.useRef<{
    lignes: { id: string; kind: string; haut: number; bas: number; hauteur: number; regroupement: boolean }[];
    groupes: { id: string; haut: number; bas: number }[];
  } | null>(null);

  const releverGeometrie = (root: HTMLElement) => {
    const base = root.getBoundingClientRect().top - root.scrollTop;
    // Marge du bas comprise : les zones se touchent, il n'y a pas de trou où la
    // visée se perdrait entre deux lignes.
    const zone = (el: Element) => {
      const rect = el.getBoundingClientRect();
      /* Les tâches dépliées sous un projet comptent dans sa place : viser elles, c'est
         viser lui, et non « sortir du groupe ». */
      const bloc = el.nextElementSibling?.matches('[data-taches-du-projet]') ? el.nextElementSibling : null;
      return { haut: rect.top - base, bas: (bloc?.getBoundingClientRect().bottom ?? rect.bottom) - base + 2 };
    };
    geoRef.current = {
      lignes: Array.from(root.querySelectorAll<HTMLElement>('[data-drag-id]')).map((el) => ({
        id: el.dataset.dragId!,
        /* La ligne seule, sans les tâches dépliées dessous : c'est son milieu qui fait entrer un projet. */
        hauteur: el.getBoundingClientRect().height,
        regroupement: el.dataset.regroupementCible !== undefined,
        kind: el.dataset.dragKind!,
        ...zone(el),
      })),
      groupes: Array.from(root.querySelectorAll<HTMLElement>('[data-drop-group]')).map((el) => ({
        id: el.dataset.dropGroup!,
        ...zone(el),
      })),
    };
  };

  const resolve = React.useCallback((element: Element, y: number) => {
    // Hors de la colonne, on ne dépose rien.
    const root = element.closest('[data-drop-root]') as HTMLElement | null;
    const geo = geoRef.current;
    if (!root || !geo) return null;
    const point = y - root.getBoundingClientRect().top + root.scrollTop;

    for (const ligne of geo.lignes) {
      if (point < ligne.haut || point > ligne.bas) continue;
      /* LE MILIEU D'UN REGROUPEMENT : on y fait ENTRER le projet, même replié (demande du 31/10/2026). */
      const tiers = ligne.hauteur / 3;
      if (ligne.regroupement && point > ligne.haut + tiers && point < ligne.haut + ligne.hauteur - tiers) {
        return { id: ligne.id, kind: 'regroupement', position: 'inside' as const };
      }
      return {
        id: ligne.id,
        kind: ligne.kind,
        position: (point < (ligne.haut + ligne.bas) / 2 ? 'before' : 'after') as 'before' | 'after',
      };
    }
    // Le corps d'un groupe, en dehors de ses lignes : on y range l'élément.
    for (const groupe of geo.groupes) {
      if (point >= groupe.haut && point <= groupe.bas) {
        return { id: groupe.id, kind: 'group', position: 'inside' as const };
      }
    }
    // Ailleurs dans la colonne : on sort du groupe.
    return { id: '__racine__', kind: 'root', position: 'inside' as const };
  }, []);

  /*
   * L'espace de développement de l'application (le projet marqué `isSelf`)
   * n'est PAS un projet comme les autres : il ne se range pas et ne se glisse
   * pas. Il sort donc de la liste rangeable, mais s'affiche FIXÉ EN TÊTE de son
   * groupe « Local » (`shared/src/groupe-local.ts`), que le démon garantit au
   * démarrage et qui ne se supprime pas. Sans ce groupe (démon plus ancien), il
   * reste ancré sous le libellé « Projets ». Cela ne l'empêche pas de RECEVOIR
   * une carte : le dépôt suit la règle commune.
   */
  const tousActifs = state.projects.filter((p) => !p.archived && !p.isSelf);
  /*
   * LES MEMBRES D'UN PROJET RÉUNI NE SE RANGENT PLUS EUX-MÊMES : ils vivent
   * dans le SOUS-GROUPE de leur regroupement, qui prend leur place dans la
   * liste (`shared/src/regroupements.ts`). Un membre dont le regroupement est
   * mis de côté redevient une ligne ordinaire.
   */
  const regroupementsActifs = new Set(tousActifs.filter((p) => estUnRegroupement(p)).map((p) => p.id));
  const actifs = tousActifs.filter((p) => !(p.regroupementId && regroupementsActifs.has(p.regroupementId)));
  const membresDe = (id: string) => membresActifsDuRegroupement(tousActifs, id);
  const espaceDev = state.projects.find((p) => !p.archived && p.isSelf) ?? null;
  const groups = state.groups;
  /** Le groupe « Local » : celui où vit l'espace de développement. */
  const groupeLocalId = idDuGroupeLocal(state.projects, groups);

  /*
   * UNE CARTE EST EN VOL AU-DESSUS DE LA COLONNE. Le tableau publie ce qu'il
   * tient (`useGlissementDeCarte`) : on n'ouvre PAS un second mécanisme de
   * glissement ici — celui de la colonne ne sert qu'au rangement des projets.
   * La ligne visée s'éclaire quand le dépôt est permis, et reste inerte sinon :
   * on voit AVANT de lâcher si ça va marcher.
   */
  const glissementDeCarte = useGlissementDeCarte();
  const cibleDeCarteDe = (projetId: string): 'acceptee' | 'refusee' | null => {
    if (!glissementDeCarte || glissementDeCarte.cibleProjetId !== projetId) return null;
    return glissementDeCarte.cibleAcceptee ? 'acceptee' : 'refusee';
  };

  /*
   * LA LOUPE DE LA COLONNE A ÉTÉ RETIRÉE (demande du 06/11/2026) : on cherche désormais dans la fenêtre au centre
   * (⌘F, `recherche-centrale.tsx`). L'état ci-dessous reste fermé ; il garde le filtre prêt sans rien afficher.
   * Avant : LA RECHERCHE DE LA COLONNE (la loupe) : un champ au-dessus de la tête, qui filtre
   * la liste sur place. Les noms se filtrent aussitôt ; les titres de tâches, archives
   * comprises, viennent du démon après une courte pause de frappe. Ce filtre n'est
   * qu'un état d'affichage : il n'écrit ni `sidebar.collapsed` ni `sidebar.projetsDeplies`,
   * et le glisser-déposer est suspendu tant qu'il agit (`shared/src/filtre-de-la-colonne.ts`).
   */
  const [rechercheOuverte, setRechercheOuverte] = React.useState(false);
  const [recherche, setRecherche] = React.useState('');
  const [cartesTrouvees, setCartesTrouvees] = React.useState<Card[]>([]);
  const [rechercheEnCours, setRechercheEnCours] = React.useState(false);
  const fermerLaRecherche = () => {
    setRechercheOuverte(false);
    setRecherche('');
  };
  const texteCherche = rechercheOuverte ? recherche.trim() : '';
  React.useEffect(() => {
    setCartesTrouvees((avant) => (texteCherche ? avant : []));
    setRechercheEnCours(!!texteCherche);
    if (!texteCherche) return;
    let abandonnee = false;
    const minuterie = window.setTimeout(() => {
      void client
        .rechercherDansLaColonne(texteCherche)
        .catch(() => [] as Card[])
        .then((cartes) => {
          if (abandonnee) return;
          const actives = cartesAvecAgentActif(Object.values(client.lireEtat().agents));
          setCartesTrouvees(cartes.filter((card) => !carteCacheeDesListes(card, actives.has(card.id))));
          setRechercheEnCours(false);
        });
    }, 250);
    return () => {
      abandonnee = true;
      window.clearTimeout(minuterie);
    };
  }, [texteCherche]);
  const filtre = React.useMemo(
    () =>
      texteCherche && !bandeSeule
        ? filtrerLaColonne(
            texteCherche,
            groups,
            state.projects
              .filter((p) => !p.archived)
              .map((p) => ({
                id: p.id,
                name: p.name,
                groupId: p.isSelf ? (groupeLocalId ?? undefined) : p.groupId,
                regroupementId: p.regroupementId,
              })),
            cartesTrouvees,
          )
        : null,
    [texteCherche, bandeSeule, groups, state.projects, groupeLocalId, cartesTrouvees],
  );
  const cartesDuFiltre = (projectId: string) => {
    const ids = filtre?.cartesParProjet.get(projectId);
    return ids ? cartesTrouvees.filter((card) => ids.includes(card.id)) : [];
  };

  /** Projets hors groupe et groupes rangés ENSEMBLE, par rang — ou, la bascule allumée, par dernière ouverture. */
  const entries: Entry[] = React.useMemo(() => {
    const list: Entry[] = [];
    for (const project of actifs) {
      if (project.groupId && groups.some((g) => g.id === project.groupId)) continue;
      list.push({ kind: 'project', id: project.id, rank: project.rank ?? 1000, project });
    }
    for (const group of groups) {
      list.push({
        kind: 'group',
        id: group.id,
        rank: group.rank ?? 1000,
        group,
        members: actifs.filter((p) => p.groupId === group.id).sort((a, b) => (a.rank ?? 1000) - (b.rank ?? 1000)),
      });
    }
    const parRang = list.sort((a, b) => a.rank - b.rank);
    if (!triParOuverture) return parRang;
    /* Un projet réuni vaut l'ouverture de ses membres, un groupe celle de ses
       projets — l'espace de développement compte dans « Local », où il reste
       fixé en tête, comme en ordre manuel. */
    const idsDuProjet = (p: Project) => [p.id, ...membresDe(p.id).map((m) => m.id)];
    const membresParOuverture = (membres: Project[]) =>
      ordonnerParDerniereOuverture(membres, ouvertLe, (p) => ({ ids: idsDuProjet(p), rang: p.rank }));
    return ordonnerParDerniereOuverture(
      parRang.map((entry): Entry => (entry.kind === 'group' ? { ...entry, members: membresParOuverture(entry.members) } : entry)),
      ouvertLe,
      (entry) => ({
        ids:
          entry.kind === 'project'
            ? idsDuProjet(entry.project)
            : [
                ...entry.members.flatMap(idsDuProjet),
                ...(entry.id === groupeLocalId && espaceDev ? [espaceDev.id] : []),
              ],
        rang: entry.rank,
      }),
    );
  }, [actifs, groups, triParOuverture, ouvertLe, groupeLocalId, espaceDev?.id]);

  /** Ce que la colonne montre : tout, ou ce que la recherche a gardé. */
  const entreesAffichees: Entry[] = filtre
    ? entries.flatMap((entry): Entry[] => {
        if (entry.kind === 'project') return filtre.projets.has(entry.id) ? [entry] : [];
        if (!filtre.groupes.has(entry.id)) return [];
        return [{ ...entry, members: entry.members.filter((p) => filtre.projets.has(p.id)) }];
      })
    : entries;
  const espaceDevAffiche = !!espaceDev && (!filtre || filtre.projets.has(espaceDev.id));

  React.useEffect(() => {
    if (!showArchived) return;
    client
      .call<{ projects: Project[] }>({ type: 'project.list', includeArchived: true })
      .then((data) => setArchived((data.projects ?? []).filter((p) => p.archived)))
      .catch(() => setArchived([]));
  }, [showArchived, state.projects]);

  const appliquer = React.useCallback(
    async (item: { id: string; kind: string }, cible: { id: string; kind: string; position: string } | null) => {
      if (!cible) return;
      /*
       * LES PROJETS REGROUPÉS SE RANGENT COMME LES AUTRES (demande du 31/10/2026) : ils figurent dans la liste à plat
       * avec leur regroupement (`membreDe`), on les réordonne, on les sort et on y en fait entrer. L'appartenance
       * passe par les portes du démon, qui gardent leurs refus (dernier membre, travail en cours) ; le rang, ensuite.
       */
      type Place = { kind: 'project' | 'group'; id: string; groupId?: string; membreDe?: string };
      const projets = projetsRef.current;
      const plat: Place[] = [];
      const poserProjet = (id: string, groupId?: string) => {
        plat.push({ kind: 'project', id, groupId });
        for (const membre of membresActifsDuRegroupement(projets, id)) plat.push({ kind: 'project', id: membre.id, groupId: membre.groupId, membreDe: id });
      };
      for (const entry of entriesRef.current) {
        if (entry.kind === 'project') poserProjet(entry.id);
        else {
          plat.push({ kind: 'group', id: entry.id });
          for (const membre of entry.members) poserProjet(membre.id, entry.id);
        }
      }

      const depuis = plat.findIndex((e) => e.id === item.id);
      if (depuis < 0) return;
      const [element] = plat.splice(depuis, 1);
      const avant = element.membreDe;
      /* Un dossier ou un regroupement n'entre jamais dans un regroupement. */
      const simpleProjet = element.kind === 'project' && !projets.some((p) => p.id === element.id && estUnRegroupement(p));

      if (cible.kind === 'root') {
        if (element.kind === 'project') element.groupId = undefined;
        element.membreDe = undefined;
        plat.push(element);
      } else if (cible.kind === 'regroupement') {
        const index = plat.findIndex((e) => e.id === cible.id);
        if (index < 0) return;
        if (simpleProjet) element.membreDe = cible.id;
        else if (element.kind === 'project') element.groupId = plat[index].groupId;
        plat.splice(index + 1, 0, element);
      } else if (cible.position === 'inside') {
        // Déposé dans un groupe : il en prend la tête.
        if (element.kind === 'project') element.groupId = cible.id;
        element.membreDe = undefined;
        const index = plat.findIndex((e) => e.kind === 'group' && e.id === cible.id);
        plat.splice(index < 0 ? plat.length : index + 1, 0, element);
      } else {
        const index = plat.findIndex((e) => e.id === cible.id);
        if (index < 0) return;
        if (plat[index].membreDe && !simpleProjet) return;
        if (element.kind === 'project') element.groupId = plat[index].groupId;
        element.membreDe = plat[index].membreDe;
        plat.splice(cible.position === 'before' ? index : index + 1, 0, element);
      }

      try {
        if (avant !== element.membreDe) {
          if (avant) await client.call({ type: 'regroupement.retirer', id: avant, projectId: element.id });
          if (element.membreDe) await client.call({ type: 'regroupement.ajouter', id: element.membreDe, membres: [element.id] });
        }
        await client.call({ type: 'sidebar.reorder', items: plat.map(({ kind, id, groupId }) => ({ kind, id, groupId })) });
      } catch (err: any) {
        client.pushToast('error', err?.message ?? t('Rangement non enregistré'));
      }
    },
    [],
  );

  // Contrôle : node scripts/verif-glissement-projets.mjs — en déplaçant un
  // projet sur toute la hauteur de la liste, aucune ligne ne doit sauter : la
  // longueur de la liste ne bouge pas pendant le glissement.
  const { dragging, target, start } = usePointerDrag({ resolve, onDrop: appliquer });

  /*
   * Où l'espace s'ouvre. Rien n'est AJOUTÉ ni retiré à la liste pendant le
   * glissement : ce qui vient après l'emplacement visé descend simplement d'une
   * hauteur de ligne. La liste garde sa longueur, donc plus rien ne saute.
   * La ligne saisie, elle, ne bouge pas : on voit d'où l'on part.
   */
  const decales = React.useMemo(() => {
    const racine = new Set<string>();
    const membres = new Set<string>();
    // « inside » range dans un groupe : le groupe s'éclaire, rien ne se décale.
    if (!dragging || !target || target.position === 'inside') return { racine, membres };

    const apres = target.position === 'after' ? 1 : 0;
    const pousser = (depuis: number) => {
      for (const entry of entriesRef.current.slice(depuis)) {
        if (entry.id !== dragging.id) racine.add(entry.id);
      }
    };

    const rang = entriesRef.current.findIndex((entry) => entry.id === target.id);
    if (rang >= 0) {
      pousser(rang + apres);
      return { racine, membres };
    }

    // Sinon la cible est un projet RANGÉ dans un groupe : ses voisins du groupe
    // descendent, et tout ce qui suit le groupe aussi.
    for (let i = 0; i < entriesRef.current.length; i += 1) {
      const entry = entriesRef.current[i];
      if (entry.kind !== 'group') continue;
      const place = entry.members.findIndex((membre) => membre.id === target.id);
      if (place < 0) continue;
      for (const membre of entry.members.slice(place + apres)) {
        if (membre.id !== dragging.id) membres.add(membre.id);
      }
      pousser(i + 1);
      break;
    }
    return { racine, membres };
  }, [dragging, target, entries]);

  /** Le décalage lui-même : court, régulier, et immédiat si l'on a demandé moins d'animations. */
  const glisse = (decale: boolean): React.CSSProperties =>
    decale ? { transform: `translateY(${hauteurLigne}px)` } : {};

  /** L'emplacement visé, marqué d'un trait fin au-dessus ou en dessous de la ligne. */
  const marqueurDe = (id: string): 'before' | 'after' | undefined =>
    target && target.id === id && target.position !== 'inside' ? target.position : undefined;

  const commit = async (ordre: { kind: 'project' | 'group'; id: string; groupId?: string }[]) => {
    try {
      await client.call({ type: 'sidebar.reorder', items: ordre });
    } catch {
      client.pushToast('error', t('Rangement non enregistré'));
    }
  };





  const toggle = (id: string) => {
    modifierLaListe('sidebar.collapsed', id);
  };

  /* LE COMPTE ET L'ICÔNE D'UN PROJET viennent d'une règle partagée
     (`activiteDeProjet`) : les listes déroulantes de projets les montrent aussi
     (`IndicateursDeProjet`) et ne peuvent donc pas dire autre chose que la colonne. */
  const activiteOf = (projectId: string) =>
    activiteDeProjet(projectId, Object.values(state.agents), state.decisions);
  const runningOf = (projectId: string) => activiteOf(projectId).enCours;

  /*
   * Le même pourcentage que celui affiché en tête de la colonne « En cours » du
   * tableau (`avancementDeLaColonne`, `board.tsx`), additionné pour CE projet.
   * On part directement des agents de rôle « task » encore au travail — `state
   * .agents` est connu pour TOUS les projets dès l'ouverture (`runningOf`
   * ci-dessus fait de même), alors que les cartes ne sont chargées que pour le
   * projet ouvert : partir d'elles laisserait les autres lignes sans chiffre.
   */
  const avancementOf = (projectId: string): AvancementColonne | null =>
    avancementDeLaColonne(
      Object.values(state.agents)
        .filter((a) => a.projectId === projectId && !a.service && a.role === 'task' && agentTientSonTour(a))
        .map((agent) => ({ agentActif: true, todos: agent.todos })),
    );

  // Une publication est EN COURS tant que son run le dit ; elle s'éteint dès
  // qu'il se termine, quel qu'en soit le sort (réussite, échec, arrêt).
  const publieOf = (projectId: string) => state.deploys[projectId]?.state === 'running';

  /*
   * QUELLE NATURE D'ATTENTE CE PROJET PORTE-T-IL ? Une question, un plan à
   * générer ou à valider, une carte à trancher : la table partagée
   * (`nature-attention.ts`) choisit UNE icône pour le lot, et c'est la même
   * table que lisent la carte du tableau et la cloche.
   */
  const iconeAttenteOf = (projectId: string): IconeDAttention | null => activiteOf(projectId).attente;

  React.useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  /*
   * La ligne se contente de DIRE ce qu'elle est (pour le dépôt) ; c'est la
   * poignée à gauche qui déclenche le glissement. Sinon un simple appui sur le
   * nom du projet embarquait la ligne au moindre mouvement du doigt.
   */
  const basculerRegroupement = (id: string, ouvrir?: boolean) => {
    modifierLaListe('sidebar.regroupementsOuverts', id, ouvrir);
  };

  /* UN SEUL REPÈRE À LA FOIS : une tâche ouverte et visible sous son projet le porte, pas lui. */
  const repereSurLeProjet = (id: string) => !carteOuverte || bandeSeule || !!filtre || !projetsDeplies.includes(id);

  /**
   * UN DOSSIER DÉPLIÉ NE REDIT PAS SES LIGNES : ni bulle ni signe de travail, sauf pour ce qui n'a aucune ligne
   * dessous (`signauxSansLigne`). Le calcul partagé `activiteDeProjet` ne change pas : les menus de projets, qui ne
   * montrent pas ces lignes, gardent leurs repères. Publication et rendus non lus restent affichés.
   */
  const allegementDuDossier = (id: string, deplie: boolean): { running?: number; attention?: number; icone?: null } => {
    const lignes = tachesParProjet?.get(id);
    if (!deplie || filtre || bandeSeule || !tachesParProjet) return {};
    const listees = new Set((lignes ?? []).flatMap((l) => [l.carte.id, ...fillesDeLaMere(l.carte)]));
    const sans = signauxSansLigne(id, Object.values(state.agents), decisionsOuvertes(state.decisions), listees, state.attention[id] ?? 0);
    return { ...(sans.travail ? {} : { running: 0 }), ...(sans.attente ? {} : { attention: 0, icone: null }) };
  };

  /** Les tâches sous un projet : son flux, ou ce que la recherche y a trouvé. */
  const blocDeTaches = (id: string) => {
    if (bandeSeule) return null;
    const ouvrir = (card: Card) => {
      onOuvrirCarte?.(card);
      onChoose?.();
    };
    if (filtre) {
      const trouvees = cartesDuFiltre(id);
      return trouvees.length ? <TachesTrouvees projectId={id} cartes={trouvees} carteOuverte={carteOuverte} onOuvrir={ouvrir} /> : null;
    }
    return projetsDeplies.includes(id) ? (
      <TachesDuProjet
        projectId={id}
        taches={tachesParProjet ? (tachesParProjet.get(id) ?? []) : null}
        carteOuverte={carteOuverte}
        onOuvrir={ouvrir}
      />
    ) : null;
  };
  /* Pendant une recherche, ce qui est déplié est dicté par les résultats : pas de flèche. */
  const flecheDeTaches = (id: string) =>
    filtre ? undefined : { ouvert: projetsDeplies.includes(id), basculer: () => basculerLeProjet(id) };

  /**
   * UNE LIGNE DE PROJET — ou, pour un projet réuni, sa ligne SUIVIE DE SON
   * SOUS-GROUPE. Replié, le regroupement porte aussi le travail de ses membres ;
   * déplié, chaque membre a sa ligne, son repère d'activité et ses réglages.
   */
  const rendreLigne = (
    project: Project,
    place: {
      style?: React.CSSProperties;
      marqueur?: 'before' | 'after';
      groupColor?: string;
      emboite?: boolean;
    },
  ) => {
    const ligne = (p: Project, extra: Partial<React.ComponentProps<typeof ProjectRow>> = {}) => (
      <ProjectRow
        key={p.id}
        project={p}
        active={p.id === state.activeProjectId && vue === 'projet'}
        repere={repereSurLeProjet(p.id)}
        running={runningOf(p.id)}
        publie={publieOf(p.id)}
        attention={state.attention[p.id]}
        rendus={state.rendus[p.id]}
        icone={iconeAttenteOf(p.id)}
        avancement={avancementOf(p.id)}
        dimmed={dragging?.id === p.id}
        cibleDeCarte={cibleDeCarteDe(p.id)}
        rowProps={rowProps(p.id, 'project')}
        poigneeProps={poigneeProps(p.id, 'project', p.name)}
        onSettings={() => ouvrirConfigProjet(p.id)}
        onNouvelAgent={
          onNouvelAgent
            ? () => {
                onNouvelAgent(p.id);
                onChoose?.();
              }
            : undefined
        }
        bande={bandeSeule}
        outilsCaches={outilsCaches}
        taches={flecheDeTaches(p.id)}
        onChoose={() => {
          deplierLeProjet(p.id);
          onOuvrirVue('projet');
          onChoose?.();
        }}
        onEntrer={onEntrerDansLeProjet ? () => onEntrerDansLeProjet(p.id) : undefined}
        groupColor={place.groupColor}
        emboite={place.emboite}
        sansPoignee={triParOuverture || !!filtre}
        {...extra}
      />
    );
    /* La ligne et ses tâches bougent ensemble quand un rangement ouvre un espace. */
    const ligneEtTaches = (p: Project, extra: Partial<React.ComponentProps<typeof ProjectRow>> = {}, style?: React.CSSProperties) => (
      <div key={p.id} style={style} data-projet-et-taches={p.id}>
        {ligne(p, { ...allegementDuDossier(p.id, projetsDeplies.includes(p.id)), ...extra })}
        {blocDeTaches(p.id)}
      </div>
    );
    if (!estUnRegroupement(project)) return ligneEtTaches(project, { marqueur: place.marqueur }, place.style);
    const membres = membresDe(project.id);
    const ouvert = filtre ? filtre.regroupementsOuverts.has(project.id) : regroupementsOuverts.includes(project.id);
    const membresAffiches = filtre ? membres.filter((m) => filtre.projets.has(m.id)) : membres;
    const signal = signalDuGroupe([project.id, ...membres.map((m) => m.id)], state.attention, state.rendus);
    return (
      <div key={project.id} style={place.style} data-regroupement-colonne={project.id} data-ouvert={ouvert || undefined}>
        {ligne(project, {
          marqueur: place.marqueur,
          rowProps: { ...rowProps(project.id, 'project'), 'data-regroupement-cible': '' },
          cibleDeCarte: target?.kind === 'regroupement' && target.id === project.id && dragging?.id !== project.id ? 'acceptee' : cibleDeCarteDe(project.id),
          running: runningOf(project.id) + (ouvert ? 0 : membres.reduce((n, m) => n + runningOf(m.id), 0)),
          publie: publieOf(project.id) || (!ouvert && membres.some((m) => publieOf(m.id))),
          attention: ouvert ? state.attention[project.id] : signal.attention,
          rendus: ouvert ? state.rendus[project.id] : signal.rendus,
          ...allegementDuDossier(project.id, ouvert),
          sousGroupe: {
            ouvert,
            nombre: membres.length,
            membres,
            basculer: (ouvrir?: boolean) => {
              if (!filtre) basculerRegroupement(project.id, ouvrir);
            },
          },
          /* Sa flèche déplie déjà ses membres, et ses propres tâches avec. */
          taches: undefined,
        })}
        {filtre ? blocDeTaches(project.id) : ouvert && !bandeSeule ? (
          <TachesDuProjet
            projectId={project.id}
            taches={tachesParProjet ? (tachesParProjet.get(project.id) ?? []) : null}
            carteOuverte={carteOuverte}
            onOuvrir={(card) => {
              onOuvrirCarte?.(card);
              onChoose?.();
            }}
          />
        ) : null}
        {ouvert ? (
          <div
            className={cn(
              /* LE RETRAIT DES MEMBRES est constant (`pl-4`) : la
                 poignée de rangement a quitté la gauche de la ligne, plus rien
                 ne décale la pile d'icônes du projet réuni. */
              bandeSeule ? 'px-0' : 'pl-4',
            )}
            data-membres-regroupement={project.id}
          >
            {membresAffiches.map((membre) =>
              bandeSeule ? (
                ligne(membre, {
                  emboite: 'reuni',
                  /* Colonne réduite : ni poignée ni nom, le rangement se fait colonne dépliée. */
                  rowProps: { 'data-membre-de': project.id },
                  poigneeProps: {},
                  sansPoignee: true,
                })
              ) : (
                /* PLUS AUCUN TRAIT D'ARBORESCENCE (demande du 31/10/2026) : le retrait seul dit l'appartenance. */
                <div key={membre.id} className="relative flow-root">
                  {ligneEtTaches(membre, {
                    emboite: 'reuni',
                    rowProps: { ...rowProps(membre.id, 'project'), 'data-membre-de': project.id },
                    marqueur: marqueurDe(membre.id),
                  })}
                </div>
              ),
            )}
          </div>
        ) : null}
      </div>
    );
  };

  const redemarrage = useRedemarrage();
  const moteurActif = useMoteurActif();
  const texteDuServeur = useTexteDuTemoinServeur(useTeinteDuTemoinServeur());
  const terminal = useEtatDuTerminal();

  const rowProps = (id: string, kind: 'project' | 'group') => ({
    'data-drag-id': id,
    'data-drag-kind': kind,
  });

  /* La bascule de tri allumée, ou une recherche, suspend le glisser-déposer : aucune
     poignée n'attrape rien, et aucun rang n'est écrit. */
  const poigneeProps = (id: string, kind: 'project' | 'group', label: string) =>
    triParOuverture || filtre
      ? {}
      : {
          onPointerDown: (event: React.PointerEvent) => {
            const ligne = (event.currentTarget as HTMLElement).closest('[data-drag-id]') as HTMLElement | null;
            // Marge comprise : c'est l'espace que la ligne occupe vraiment.
            if (ligne) {
              const bloc = ligne.nextElementSibling?.matches('[data-taches-du-projet]') ? ligne.nextElementSibling : null;
              setHauteurLigne(Math.round((bloc?.getBoundingClientRect().bottom ?? ligne.getBoundingClientRect().bottom) - ligne.getBoundingClientRect().top) + 2);
            }
            const root = ligne?.closest('[data-drop-root]') as HTMLElement | null;
            // Rien n'est encore décalé : c'est le bon moment pour relever les places.
            if (root) releverGeometrie(root);
            start(event, { id, kind, label });
          },
        };

  /** La classe d'une LIGNE de la colonne : du texte, une icône, un fond gris au survol — rien d'autre. */
  const classeLigne = (active: boolean) =>
    cn(
      'group/l flex h-9 w-full min-w-0 items-center gap-2.5 rounded-lg text-left text-[14px] text-text transition-colors',
      bandeSeule ? 'justify-center px-0' : 'px-2.5',
      /* La ligne OUVERTE s'écrit en violet : c'est elle qu'on cherche des yeux. */
      'hover:bg-raised',
      active && 'text-important',
    );
  /** Une tâche ouverte par-dessus un service rend la colonne : le menu du service attend, caché. */
  const serviceEnTete = !!service && service.plan !== 'page';
  /**
   * LES AGENTS RESTENT À UN CLIC, OÙ QU'ON SOIT (demande du 31/10/2026) : le bouton
   * menu de la tête d'un service montre la colonne principale PAR-DESSUS le menu du
   * service, qui reste monté (il garde son état) et revient à la fermeture.
   */
  const [projetsParDessus, setProjetsParDessus] = React.useState(false);
  const serviceVisible = serviceEnTete && !projetsParDessus;
  /* LES SERVICES COMMUNS À TOUS LES PROJETS, dans le menu à trois points : Coffre-fort et Mémoire. */
  const servicesOuverts = useServicesOuverts();
  const servicesCommuns = servicesOuverts.filter((s) => s.cle === 'coffre' || s.cle === 'memoire');
  /* PLUS DE VUES « TOUS LES PROJETS » ICI (décision du 13/11/2026 au soir) : Résumé, Statistiques, Messagerie, Backup,
     Surveillance et Tâches récurrentes n'ont de sens que dans un projet. Ils s'ouvrent par le menu des outils du
     projet (`MenuDesOutils` sur ordinateur, « Outils » sur téléphone). */
  /* Choisir un agent, un projet ou un autre service mène ailleurs : la surcouche a fini son office. */
  React.useEffect(() => setProjetsParDessus(false), [vue, carteOuverte, state.activeProjectId]);
  React.useEffect(() => {
    if (!projetsParDessus) return;
    /* Un menu ou une fenêtre ouverts DEPUIS la colonne vivent en portail : ils n'en sont pas « dehors ». */
    const dansUnCalque = (cible: Element) =>
      !!cible.closest('[data-radix-popper-content-wrapper], [role="dialog"], [data-voile-de-fenetre], [data-voile-tiroir]');
    const auPointeur = (event: PointerEvent) => {
      const cible = event.target;
      if (!(cible instanceof Element) || refColonne.current?.contains(cible) || dansUnCalque(cible)) return;
      setProjetsParDessus(false);
    };
    const auClavier = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('[data-radix-popper-content-wrapper]')) return;
      setProjetsParDessus(false);
    };
    document.addEventListener('pointerdown', auPointeur);
    document.addEventListener('keydown', auClavier);
    return () => {
      document.removeEventListener('pointerdown', auPointeur);
      document.removeEventListener('keydown', auClavier);
    };
  }, [projetsParDessus]);
  /*
   * LE MENU DES AGENTS SUIT LA SOURIS (demande du 31/10/2026) : il se referme quand elle quitte la colonne, et
   * glisse à l'écran dès qu'elle touche le bord gauche de la fenêtre. Ordinateur seulement. La fermeture attend ce
   * qui vit en portail hors de la colonne (un menu, une fenêtre, une feuille) et un glisser en cours.
   */
  const minuterieDuMenu = React.useRef<number | undefined>(undefined);
  const fermerLeMenuBientot = () => {
    window.clearTimeout(minuterieDuMenu.current);
    const tenter = () => {
      if (refColonne.current?.matches(':hover')) return;
      const retenu =
        document.querySelector('[data-radix-popper-content-wrapper], [data-voile-de-fenetre][data-state=open], [data-voile-tiroir][data-state=open]') ||
        document.body.style.cursor === 'grabbing' ||
        document.activeElement?.matches('[data-champ-recherche-colonne]');
      if (retenu) minuterieDuMenu.current = window.setTimeout(tenter, 150);
      else setProjetsParDessus(false);
    };
    minuterieDuMenu.current = window.setTimeout(tenter, 250);
  };
  React.useEffect(() => () => window.clearTimeout(minuterieDuMenu.current), []);
  /* Revenue à la bande, la colonne n'a plus de menu à montrer. */
  React.useEffect(() => {
    if (bandeSeule) setProjetsParDessus(false);
  }, [bandeSeule]);
  const ouvertureAuBord = !telephone && serviceEnTete;
  React.useEffect(() => {
    if (!ouvertureAuBord) return;
    /* Seul le PASSAGE au bord ouvre : refermé par un clic, le menu ne revient pas tant que la souris y reste. */
    let auBord = false;
    const auMouvement = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      const toucheLeBord = event.clientX <= BORD_QUI_OUVRE_LE_MENU;
      if (toucheLeBord && !auBord && document.body.style.cursor !== 'grabbing' && !document.querySelector('[data-voile-de-fenetre][data-state=open], [data-voile-tiroir][data-state=open]')) {
        window.clearTimeout(minuterieDuMenu.current);
        setProjetsParDessus(true);
      }
      auBord = toucheLeBord;
    };
    window.addEventListener('pointermove', auMouvement, { passive: true });
    return () => window.removeEventListener('pointermove', auMouvement);
  }, [ouvertureAuBord]);
  /** L'intitulé d'une section (« Services », « Projets ») : petit, gris, repliable. */
  const classeSection = 'flex h-8 w-full items-center gap-1 rounded-lg px-2.5 text-left text-[12.5px] text-faint transition-colors hover:text-muted';

  return (
    <aside
      ref={refColonne}
      // Sur téléphone la liste occupe tout l'écran ; la largeur réglée à la
      // main ne vaut qu'à partir des écrans larges. AUCUN TRAIT ne sépare la
      // colonne de la zone principale : c'est son fond, un gris très pâle, qui
      // la distingue (`data-zone="gauche"`, `styles.css`).
      data-zone="gauche"
      data-colonne-projets={reduitEffectif ? (survolee ? 'survolee' : 'reduite') : 'depliee'}
      /*
       * L'ASIDE NE PORTE QUE LA PLACE RÉSERVÉE. Réduite, elle ne vaut plus que
       * la largeur d'une bande d'icônes : c'est ELLE qui décide de ce que la
       * zone de droite occupe, et elle ne bouge pas quand le panneau s'ouvre.
       */
      className={cn(
        'relative flex w-full shrink-0 flex-col',
        reduitEffectif ? 'sm:w-[var(--largeur-bande)]' : 'sm:w-[var(--largeur-projets)]',
      )}
      style={{
        ['--largeur-projets' as any]: `${width ?? 264}px`,
        ['--largeur-bande' as any]: `${LARGEUR_BANDE}px`,
      }}
      onPointerEnter={(event) => {
        /* Une carte en vol ouvre la colonne repliée QUEL QUE SOIT le pointeur :
           au doigt il n'y a pas de survol, et sans cela on ne pourrait déposer
           une carte que colonne dépliée. */
        if (reduitEffectif && (event.pointerType === 'mouse' || glissementDeCarte)) ouvrirAuSurvol();
        window.clearTimeout(minuterieDuMenu.current);
      }}
      onPointerLeave={(event) => {
        if (reduitEffectif && (event.pointerType === 'mouse' || glissementDeCarte)) fermerAuSurvolBientot();
        if (projetsParDessus && !telephone && event.pointerType === 'mouse') fermerLeMenuBientot();
      }}
    >
      {/*
       * LE PANNEAU, POSÉ PAR-DESSUS LE CONTENU QUAND LA COLONNE EST RÉDUITE.
       * Il reprend le repère de zone pour garder le fond de la colonne — un
       * panneau transparent laisserait lire la page au travers. Déplié, il
       * n'est qu'une colonne ordinaire.
       */}
      <div
        data-zone="gauche"
        data-panneau-projets={bandeSeule ? 'bande' : 'deplie'}
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          reduitEffectif &&
            /* RANG 55 : DEVANT TOUTES LES PAGES, même celles ouvertes par-dessus
               une autre (`Drawer empile`, `z-50`, posées en portail APRÈS la
               colonne — à rang égal, elles gagnaient et coupaient le panneau au
               bord de la bande). Les menus et bulles qu'il ouvre sont en
               `z-[60]` ; une FENÊTRE modale ouverte (son voile porte
               `data-voile-de-fenetre`) ou une FEUILLE DU BAS (`data-voile-tiroir`)
               le renvoie en `z-40`, sous elle. */
            (survolee
              ? 'absolute inset-y-0 left-0 z-[55] w-[var(--largeur-projets)] animate-glisse-du-bord shadow-2xl [body:has([data-voile-de-fenetre][data-state=open])_&]:z-40 [body:has([data-voile-tiroir][data-state=open])_&]:z-40'
              : 'w-[var(--largeur-bande)]'),
        )}
      >
        {/*
         * LA TÊTE : le nom de l'application, puis deux gestes — chercher un
         * projet, replier la colonne. Rien d'autre. Rétrécie, la colonne n'en
         * garde que le bouton qui la déplie.
         */}
        <div
          className={cn('h-14 shrink-0', CLASSE_RANGEE_DE_BOUTONS, bandeSeule ? 'justify-center px-0' : 'pl-4 pr-2.5')}
          data-rangee-de-boutons
          data-titre-projets={bandeSeule ? 'bande' : 'deplie'}
        >
          {bandeSeule ? (
            /* REPLIÉE, LA TÊTE EST LE TÉMOIN DU SERVEUR, QUI DEVIENT « DÉPLIER » AU SURVOL (façon ChatGPT, 18/11/2026) :
               l'icône de l'application et son point d'état au repos ; la souris ou le clavier dessus, elle cède la
               place au bouton qui déplie. Mêmes repères qu'avant pour les contrôles. */
            <Button
              variant="ghost"
              size="icon"
              className="group/deplier h-[38px] sm:h-8 w-[38px] sm:w-8 text-muted"
              aria-label="Déplier le menu"
              title={`${t('Déplier le menu')} · ${texteDuServeur}`}
              data-deplier-colonne
              data-replier-colonne="reduite"
              onClick={() => setReduite(false)}
            >
              <TemoinDuServeur taille={26} className="group-hover/deplier:hidden group-focus-visible/deplier:hidden" />
              <PanelLeft className="hidden h-4 w-4 group-hover/deplier:block group-focus-visible/deplier:block" />
            </Button>
          ) : (
            <>
              {serviceEnTete ? (
                /* UN SERVICE A PRIS LA COLONNE : le bouton menu, qui montre les agents et
                   les projets par-dessus. On remonte d'un cran par le fil d'Ariane. */
                <Tooltip label={t('Agents et projets')}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn('relative -ml-2 h-[38px] sm:h-8 w-[38px] sm:w-8 shrink-0 text-muted', projetsParDessus && 'bg-raised text-text')}
                    aria-label="Agents et projets"
                    aria-expanded={projetsParDessus}
                    data-menu-de-colonne={projetsParDessus ? 'ouvert' : 'ferme'}
                    onClick={() => setProjetsParDessus((ouvert) => !ouvert)}
                  >
                    <Menu className="h-4 w-4" />
                  </Button>
                </Tooltip>
              ) : null}
              {serviceVisible ? (
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight text-text" data-titre-de-colonne>
                  {service.titre}
                </span>
              ) : (
                /* LE TÉMOIN DU SERVEUR À LA PLACE DU NOM « BELUGA » (demande de l'utilisateur, 18/11/2026) : l'icône de
                   l'application, avec au coin le point d'état du lien — il a quitté le pied de la colonne. */
                <span className="flex min-w-0 flex-1 items-center" data-nom-application>
                  <Tooltip label={texteDuServeur} side="bottom">
                    <span className="inline-flex" tabIndex={-1}>
                      <TemoinDuServeur />
                    </span>
                  </Tooltip>
                </span>
              )}
              {telephone ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn('h-[38px] sm:h-8 w-[38px] sm:w-8 text-muted', outilsVisibles && 'bg-raised text-text')}
                  aria-pressed={outilsVisibles}
                  aria-label={outilsVisibles ? 'Cacher les poignées et réglages' : 'Afficher les poignées et réglages'}
                  title={outilsVisibles ? t('Cacher les poignées et réglages') : t('Afficher les poignées et réglages')}
                  data-outils-projets={outilsVisibles ? 'visibles' : 'caches'}
                  onClick={() => setOutilsVisibles((v) => !v)}
                >
                  <Settings2 className="h-4 w-4" />
                </Button>
              ) : null}
              {/* LE MENU À TROIS POINTS DE LA COLONNE (refonte du 13/11/2026, façon Claude Desktop) : les icônes de la
                  tête — Fichiers, le menu dossier — et les deux services COMMUNS à tous les projets, Coffre-fort et
                  Mémoire, réunis derrière un seul bouton. Tous les autres services vivent dans le projet (bouton aux
                  quatre carrés, en haut à droite). Les repères des contrôles restent sur les entrées. */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-[38px] sm:h-8 w-[38px] sm:w-8 text-muted data-[state=open]:bg-raised data-[state=open]:text-text"
                    aria-label="Menu"
                    title={t('Menu')}
                    data-menu-dossier
                    data-trois-points-colonne
                  >
                    <EllipsisVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="sm:w-[232px]" data-menu-dossier-panneau>
                  {/* « RECHERCHER » A QUITTÉ CE MENU (14/11/2026) : c'est la loupe, juste à droite. ⌘F ouvre toujours la
                      recherche centrale. */}
                  <DropdownMenuItem
                    data-ligne-fichiers
                    onSelect={() => {
                      ouvrirLesFichiers();
                      onChoose?.();
                    }}
                    className="gap-2.5"
                  >
                    <FolderOpen className="h-4 w-4 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 truncate">{t('Fichiers')}</span>
                  </DropdownMenuItem>
                  {/* « PIÈCES JOINTES » rejoint ce menu (14/11/2026) : le menu aux quatre carrés qui la portait n'existe plus. */}
                  <DropdownMenuItem
                    data-menu-pieces
                    onSelect={() => {
                      window.dispatchEvent(new CustomEvent('beluga:ouvrir-fichiers', { detail: { vue: 'pieces' } }));
                      onChoose?.();
                    }}
                    className="gap-2.5"
                  >
                    <Paperclip className="h-4 w-4 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 truncate">{t('Pièces jointes')}</span>
                  </DropdownMenuItem>
                  {!serviceVisible ? (
                    <>
                      <DropdownMenuItem data-ouvrir-projets onSelect={() => setAdding(true)} className="gap-2.5">
                        <Plus className="h-4 w-4 shrink-0 text-muted" />
                        <span className="min-w-0 flex-1 truncate">{t('Nouveau projet')}</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem data-nouveau-groupe onSelect={() => setCreatingGroup(true)} className="gap-2.5">
                        <Folder className="h-4 w-4 shrink-0 text-muted" />
                        <span className="min-w-0 flex-1 truncate">{t('Nouveau dossier')}</span>
                      </DropdownMenuItem>
                    </>
                  ) : null}
                  {/* COFFRE-FORT ET MÉMOIRE ONT QUITTÉ CE MENU (carte « Services homogènes et centrés », 14/11/2026) : ils
                      sont dans la liste de la ligne « Services », en bas de la colonne. */}
                </DropdownMenuContent>
              </DropdownMenu>
              {/* LA LOUPE DE LA COLONNE REVIENT (décision du 14/11/2026), entre les trois points et le repli : elle
                  ouvre un champ tout en haut de la colonne, curseur dedans, qui filtre aussitôt agents et projets.
                  Échap, ou le champ vidé puis quitté, la referme et rend la colonne entière. */}
              {!serviceVisible ? (
                <Tooltip label={t('Chercher')}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn('h-[38px] sm:h-8 w-[38px] sm:w-8 text-muted', rechercheOuverte && 'bg-raised text-text')}
                    aria-label="Chercher"
                    aria-pressed={rechercheOuverte}
                    data-chercher-projet
                    data-loupe-colonne
                    onClick={() => (rechercheOuverte ? fermerLaRecherche() : setRechercheOuverte(true))}
                  >
                    <Search className="h-4 w-4" />
                  </Button>
                </Tooltip>
              ) : null}
              {telephone ? null : reduitEffectif ? (
                /* LA COLONNE N'EST QUE SURVOLÉE : ce bouton la ROUVRE pour de
                   bon. Il redemandait de la réduire — elle l'était déjà —, et
                   celui qui la déplie n'existait que dans la bande, que le
                   curseur ne peut pas atteindre sans ouvrir ce panneau : « le
                   bouton ne marche que dans un sens ». */
                <Tooltip label={t('Déplier le menu')}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-[38px] sm:h-8 w-[38px] sm:w-8 text-muted"
                    aria-label="Déplier le menu"
                    data-deplier-colonne
                    data-replier-colonne="survolee"
                    onClick={() => setReduite(false)}
                  >
                    <PanelLeft className="h-4 w-4" />
                  </Button>
                </Tooltip>
              ) : (
                <Tooltip label={t('Replier le menu')}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-[38px] sm:h-8 w-[38px] sm:w-8 text-muted"
                    aria-label="Replier le menu"
                    data-replier-colonne="depliee"
                    onClick={() => setReduite(true)}
                  >
                    <PanelLeft className="h-4 w-4" />
                  </Button>
                </Tooltip>
              )}
            </>
          )}
        </div>

        {/* LE CHAMP DE RECHERCHE, au-dessus de « Tableaux de bord » et hors de la zone qui défile : il reste sous les
            yeux pendant qu'on parcourt les résultats (14/11/2026). */}
        {rechercheOuverte && !bandeSeule && !serviceVisible ? (
          <div className="relative mb-1.5 shrink-0 px-2" data-recherche-colonne>
            <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <Input
              autoFocus
              data-champ-recherche-colonne
              value={recherche}
              onChange={(event) => setRecherche(event.target.value)}
              onBlur={() => {
                if (!recherche.trim()) fermerLaRecherche();
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  fermerLaRecherche();
                }
              }}
              placeholder={t('Chercher un agent, un projet…')}
              aria-label="Chercher un agent, un projet"
              className="pl-8 pr-8"
            />
            {rechercheEnCours ? (
              <Loader2
                data-recherche-en-cours
                aria-hidden
                className="absolute right-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-faint motion-reduce:animate-none"
              />
            ) : null}
          </div>
        ) : null}

        {/* LE MENU DU SERVICE OUVERT, à la place des projets. L'emplacement
            reste monté quand la colonne est réduite : le menu garde son état,
            et reparaît au survol. */}
        {service ? (
          <div
            ref={onCorpsDeService}
            data-colonne-de-service
            data-bande={bandeSeule ? '' : undefined}
            className={cn(
              'group/colonne flex min-h-0 flex-1 flex-col',
              bandeSeule ? 'px-1.5' : 'px-2',
              bandeSeule && 'invisible',
              (service.plan === 'page' || projetsParDessus) && 'hidden',
            )}
          />
        ) : null}
        <ZoneDefilement
          hauteur={16}
          classeEnveloppe={serviceVisible ? 'hidden' : projetsParDessus ? 'animate-glisse-du-bord' : undefined}
          className={cn('touch-pan-y pb-4', bandeSeule ? 'px-1.5' : 'px-2')}
          data-drop-root
        >
          {/* ------------------------------------------------------------------
              LA TÊTE, LA MÊME PARTOUT : « Nouvel agent », en VIOLET (carte « Lecteur de charte : commentaires et
              barre », décision de l'utilisateur). Le bouton « Tableaux de bord » a quitté la colonne : on y va par
              le menu à trois points de sa tête (le menu en grille n'existe plus depuis le 13/11/2026).
              Colonne réduite : son icône.
              ------------------------------------------------------------------ */}
          {onNouvelAgent ? (
            /* LA TÊTE (13/11/2026, maquette #76ac validée) : « Tableaux de bord » en VIOLET en tête — un vrai lien vers la
               vue de tous les projets —, puis « Nouvel artefact », sans fond (15/11/2026). Le menu ⋮ ne porte plus « Tableaux de
               bord ». Colonne réduite : leurs icônes. */
            <div className="mb-1.5 flex flex-col gap-1.5" data-tete-de-colonne>
              {state.monRole === 'admin' ? (
                <LienInterne
                  adresse={construireFragment({ vue: 'en-route' })}
                  data-bouton-tableaux-de-bord
                  data-ouvrir-en-route
                  data-destination="en-route"
                  data-bouton-violet
                  title={bandeSeule ? t('Tableaux de bord') : undefined}
                  aria-current={vue === 'en-route' ? 'page' : undefined}
                  onClick={() => {
                    onOuvrirVue?.('en-route');
                    onChoose?.();
                  }}
                  className={cn(
                    'flex h-[43px] sm:h-9 w-full min-w-0 items-center gap-2.5 rounded-lg text-left text-[14px] font-medium transition-opacity',
                    bandeSeule ? 'justify-center px-0' : 'px-2.5',
                  )}
                >
                  <SquareKanban className="h-4 w-4 shrink-0" />
                  <span className={cn('min-w-0 flex-1 truncate', bandeSeule && 'sr-only')}>{t('Tableaux de bord')}</span>
                </LienInterne>
              ) : null}
              {/* « SERVICES » JUSTE SOUS « TABLEAUX DE BORD », AU-DESSUS DE « NOUVEL ARTEFACT » (décision de l'utilisateur
                  du 15/11/2026) : sa liste s'ouvre VERS LE BAS, et les services épinglés se rangent juste sous lui.
                  PENDANT UNE RECHERCHE, LA COLONNE NE MONTRE QUE LES RÉSULTATS (14/11/2026, capture #85295) : la ligne
                  et ses épingles s'effacent, et reviennent quand le champ est vidé ou refermé. */}
              {onOuvrirServiceCentral && state.monRole === 'admin' && !serviceVisible && !filtre ? (
                <ServicesDuBasDeLaColonne
                  bandeSeule={bandeSeule}
                  enTete
                  actif={serviceCentralActif ?? (vue === 'coffre' || vue === 'memoire' ? vue : null)}
                  onOuvrir={(cle) => {
                    onOuvrirServiceCentral(cle);
                    onChoose?.();
                  }}
                  communs={servicesCommuns}
                  onOuvrirCommun={(cle) => {
                    onOuvrirVue?.(cle as VueCentrale);
                    onChoose?.();
                  }}
                />
              ) : null}
              {/* « NOUVEL AGENT » DEMANDE LE TYPE, PUIS LE PROJET (14/11/2026). */}
              {onCreerAgent ? (
                <MenuNouvelAgent bandeSeule={bandeSeule} onOuvert={onChoose} onCreer={onCreerAgent} />
              ) : (
                <button
                  type="button"
                  data-ligne-nouvel-agent
                  title={bandeSeule ? t('Nouvel artefact') : undefined}
                  onClick={() => {
                    onNouvelAgent();
                    onChoose?.();
                  }}
                  className={cn(
                    'flex h-[43px] sm:h-9 w-full min-w-0 items-center gap-2.5 rounded-lg text-left text-[14px] font-medium text-text transition-colors hover:bg-raised data-[state=open]:bg-raised',
                    bandeSeule ? 'justify-center px-0' : 'px-2.5',
                  )}
                >
                  <SquarePen className="h-4 w-4 shrink-0" />
                  <span className={cn('min-w-0 flex-1 truncate', bandeSeule && 'sr-only')}>{t('Nouvel artefact')}</span>
                </button>
              )}
              {/* « SERVICES » A QUITTÉ LA TÊTE (14/11/2026) : les services vivent en bas de la colonne, au-dessus du pied. */}
            </div>
          ) : null}

          {/* « FICHIERS » (carte « Fichiers rangés et captures pleine page », 05/11/2026) : en haut de la colonne, la
              fenêtre de TOUS les fichiers rangés par projet et par service, avec la recherche intelligente. */}
          {/* Colonne réduite à sa bande : la tête n'a plus la place de l'icône, « Fichiers » reste ici. */}
          {bandeSeule ? (
            <button
              type="button"
              data-ligne-fichiers
              title={t('Parcourir les fichiers')}
              onClick={() => {
                ouvrirLesFichiers();
                onChoose?.();
              }}
              className="mt-1 flex h-[43px] w-full min-w-0 items-center justify-center rounded-lg px-0 text-[14px] text-muted transition-colors hover:bg-raised hover:text-text sm:h-9"
            >
              <FolderOpen className="h-4 w-4 shrink-0" />
              <span className="sr-only">{t('Parcourir les fichiers')}</span>
            </button>
          ) : null}

          {/* LA ZONE « EN COURS » (demande du 01/11/2026) : tout ce qui tourne, tous projets confondus,
              entre « Nouvel agent » et le groupe « Local ». Ni en colonne réduite, ni pendant une recherche. */}
          {!bandeSeule && !filtre && state.pret ? (
            <div className="mt-1.5">
              <TachesEnCours
                carteOuverte={carteOuverte ?? null}
                onOuvrir={(card) => {
                  onOuvrirCarte?.(card);
                  onChoose?.();
                }}
              />
            </div>
          ) : null}

          {/* ------------------------------------------------------------------
              LES PROJETS, directement sous « Nouvel agent » : la liste, rangée en
              DOSSIERS repliables (les groupes). Ses gestes d'ajout sont dans le menu
              dossier de la tête ; le tri par dernière ouverture, dans Réglages › Projets.
              ------------------------------------------------------------------ */}
          {bandeSeule ? (
            <div className="my-2 flex justify-center" aria-hidden>
              <span className="h-px w-5 bg-border" />
            </div>
          ) : (
            <div className="h-2" aria-hidden />
          )}

          {/* TANT QUE LE PREMIER ÉTAT DU SERVEUR N'EST PAS ARRIVÉ, un indicateur discret :
              la colonne n'a plus de silhouette. Aucune phrase de liste vide ne s'écrit avant. */}
          {!state.pret && !state.copieLocale ? (
            <div className={cn('flex h-9 items-center', bandeSeule ? 'justify-center' : 'px-2.5')} data-chargement-projets>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-faint motion-reduce:animate-none" aria-hidden />
            </div>
          ) : (
            <>
              {/* EN TÊTE de la liste, et ancré là : l'espace où l'application
                  elle-même est développée, quand le groupe « Local » manque
                  (démon plus ancien). Pas de poignée, pas de rang. */}
              {espaceDev && espaceDevAffiche && !groupeLocalId ? (
                <LigneEspaceDev
                  taches={flecheDeTaches(espaceDev.id)}
                  project={espaceDev}
                  active={espaceDev.id === state.activeProjectId && vue === 'projet'}
                  repere={repereSurLeProjet(espaceDev.id)}
                  running={runningOf(espaceDev.id)}
                  publie={publieOf(espaceDev.id)}
                  attention={state.attention[espaceDev.id]}
                  rendus={state.rendus[espaceDev.id]}
                  icone={iconeAttenteOf(espaceDev.id)}
                  avancement={avancementOf(espaceDev.id)}
                  cibleDeCarte={cibleDeCarteDe(espaceDev.id)}
                  onSettings={() => ouvrirConfigProjet(espaceDev.id)}
                  onNouvelAgent={onNouvelAgent ? () => { onNouvelAgent(espaceDev.id); onChoose?.(); } : undefined}
                  bande={bandeSeule}
                  outilsCaches={outilsCaches}
                  onChoose={onChoose}
                  onEntrer={onEntrerDansLeProjet ? () => onEntrerDansLeProjet(espaceDev.id) : undefined}
                  onQuitterTableauDeBord={() => {
                    deplierLeProjet(espaceDev.id);
                    onOuvrirVue('projet');
                  }}
                />
              ) : null}
              {espaceDev && espaceDevAffiche && !groupeLocalId ? blocDeTaches(espaceDev.id) : null}

              {entreesAffichees.map((entry) => {
                if (entry.kind === 'project') {
                  return rendreLigne(entry.project, {
                    style: glisse(decales.racine.has(entry.id)),
                    marqueur: marqueurDe(entry.id),
                  });
                }

                // Le groupe « Local » porte l'espace de développement en tête : il
                // compte parmi ses membres pour les signaux et le repli.
                const localDuGroupe = entry.id === groupeLocalId && espaceDev ? espaceDev : null;
                const local = localDuGroupe && espaceDevAffiche ? localDuGroupe : null;
                const membres = entry.members;
                const membresVus = localDuGroupe ? [localDuGroupe, ...membres] : membres;
                // Replié, un dossier cacherait ce que ses projets attendent ET ce
                // qu'ils ont rendu : les deux signaux remontent jusqu'à son en-tête.
                const signal = signalDuGroupe(
                  membresVus.map((p) => p.id),
                  state.attention,
                  state.rendus,
                );
                const replie = !filtre && collapsed.includes(entry.id);
                const outilDeGroupe = cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-faint hover:bg-raised hover:text-text',
                  outilsCaches && 'hidden',
                );
                return (
                  <div
                    key={entry.id}
                    data-drop-group={entry.id}
                    data-groupe-projets={entry.id}
                    style={glisse(decales.racine.has(entry.id))}
                    className={cn(
                      'relative rounded-lg transition-[transform,background-color] duration-150 motion-reduce:transition-none',
                      // Survoler le corps du dossier l'éclaire en entier : on comprend
                      // que le projet va s'y ranger.
                      target?.kind === 'group' && target.id === entry.id && target.position === 'inside' && 'bg-raised',
                    )}
                  >
                    <Trait ou={marqueurDe(entry.id)} />
                    <EnteteGroupe
                      rowProps={rowProps(entry.id, 'group')}
                      dimmed={dragging?.id === entry.id}
                      signal={signal}
                      regarde={membresVus.some((p) => p.id === state.activeProjectId)}
                      bande={bandeSeule}
                      titre={entry.group.name}
                    >
                      {/* LA POIGNÉE DU DOSSIER, à gauche de sa flèche, au survol. */}
                      <span
                        {...poigneeProps(entry.id, 'group', entry.group.name)}
                        title={t('Glisser pour ranger')}
                        className={cn(
                          CLASSE_POIGNEE_A_GAUCHE,
                          'survol:group-focus-within/g:opacity-100 survol:group-hover/g:opacity-100',
                          (triParOuverture || filtre || outilsCaches) && 'hidden',
                        )}
                        data-poignee-groupe={entry.id}
                      >
                        <GripVertical className="h-3.5 w-3.5 shrink-0" />
                      </span>
                      {/* LE DOSSIER : sa flèche, son nom. Un clic le replie. */}
                      <button
                        onClick={() => toggle(entry.id)}
                        aria-expanded={!replie}
                        title={replie ? t('Déplier le groupe') : t('Replier le groupe')}
                        className="flex min-w-0 flex-1 items-center gap-2.5 text-left text-[14px] text-text"
                      >
                        <ChevronRight
                          className={cn('h-4 w-4 shrink-0 text-faint transition-transform', !replie && 'rotate-90')}
                        />
                        <span className="min-w-0 truncate">{entry.group.name}</span>
                      </button>
                      {/* Replié, le dossier porte ce que ses projets ont rendu sans
                          être lus ; un clic les marque consultés. */}
                      {replie && (signal.rendus ?? 0) > 0 ? (
                        <Tooltip label={libelleNonConsultees(signal.rendus ?? 0, true)}>
                          <button
                            type="button"
                            data-groupe-non-consultees={signal.rendus}
                            aria-label={libelleNonConsultees(signal.rendus ?? 0, true)}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation();
                              membresVus
                                .filter((p) => state.rendus[p.id])
                                .forEach((p) => client.call({ type: 'project.read', projectId: p.id }));
                            }}
                            className="h-2 w-2 shrink-0 rounded-full bg-faint"
                          />
                        </Tooltip>
                      ) : null}
                      {/* Replié, un membre qui publie ne se voit plus : le repère
                          remonte jusqu'à l'en-tête du dossier. */}
                      {replie && membresVus.some((p) => publieOf(p.id)) ? <RepereePublication publie /> : null}
                      {replie ? (
                        <RepereLigne
                          signal={{ attention: signal.attention }}
                          /* Replié, le dossier porte la nature de ce que ses membres
                             attendent : un seul repère, jamais deux côte à côte. */
                          icone={iconeDuLot(
                            state.decisions.filter((d) => !d.reglee && membresVus.some((p) => p.id === d.projectId)),
                          )}
                          /* Replié, le dossier emmène à la décision du premier de ses
                             projets qui en attend une. */
                          onDecision={() => {
                            const projet = membresVus.find((p) => state.attention[p.id]);
                            if (projet) allerALaDecision(projet.id, onChoose);
                          }}
                        />
                      ) : null}
                      {/* LES OUTILS DU DOSSIER, au survol seulement : le renommer, le
                          supprimer. Ils s'ouvrent en glissant, comme ceux d'une
                          ligne de projet ; la poignée est à gauche. */}
                      <span className={CLASSE_ENVELOPPE_D_OUTILS_DE_DOSSIER} data-outils-de-ligne>
                      <span className="flex min-w-0 items-center gap-1 overflow-hidden">
                      <button
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => setRenaming(entry.group)}
                        data-outil-groupe="renommer"
                        className={outilDeGroupe}
                        title={t('Renommer le groupe')}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => setDeleting(entry.group)}
                        data-outil-groupe="supprimer"
                        className={cn(
                          outilDeGroupe,
                          'hover:text-danger',
                          // Le groupe « Local » abrite Beluga : il ne se supprime pas.
                          localDuGroupe && 'hidden',
                        )}
                        title={t('Supprimer le groupe')}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                      </span>
                      </span>
                    </EnteteGroupe>

                    {!replie ? (
                      <div className={bandeSeule ? undefined : 'pl-3'}>
                        {/* FIXÉ EN TÊTE du groupe « Local » : aucune prise pour la
                            souris, les projets glissés ici se rangent sous lui. */}
                        {local ? (
                          <LigneEspaceDev
                            taches={flecheDeTaches(local.id)}
                            project={local}
                            active={local.id === state.activeProjectId && vue === 'projet'}
                            repere={repereSurLeProjet(local.id)}
                            running={runningOf(local.id)}
                            publie={publieOf(local.id)}
                            attention={state.attention[local.id]}
                            rendus={state.rendus[local.id]}
                            icone={iconeAttenteOf(local.id)}
                            avancement={avancementOf(local.id)}
                            {...allegementDuDossier(local.id, projetsDeplies.includes(local.id))}
                            cibleDeCarte={cibleDeCarteDe(local.id)}
                            onSettings={() => ouvrirConfigProjet(local.id)}
                            onNouvelAgent={onNouvelAgent ? () => { onNouvelAgent(local.id); onChoose?.(); } : undefined}
                            bande={bandeSeule}
                            outilsCaches={outilsCaches}
                            onChoose={onChoose}
                            onEntrer={onEntrerDansLeProjet ? () => onEntrerDansLeProjet(local.id) : undefined}
                            onQuitterTableauDeBord={() => {
                              deplierLeProjet(local.id);
                              onOuvrirVue('projet');
                            }}
                          />
                        ) : null}
                        {local ? blocDeTaches(local.id) : null}
                        {membresVus.length || filtre ? (
                          membres.map((project) =>
                            rendreLigne(project, {
                              style: glisse(decales.membres.has(project.id)),
                              marqueur: marqueurDe(project.id),
                              groupColor: entry.group.color,
                              emboite: true,
                            }),
                          )
                        ) : (
                          // Une seule ligne, jamais coupée ; INVISIBLE en colonne
                          // réduite (elle y débordait mot par mot) mais gardant sa
                          // hauteur, pour que les lignes suivantes ne sautent pas
                          // d'un mode à l'autre (MEM-2899).
                          <p
                            data-groupe-vide={entry.id}
                            aria-hidden={bandeSeule || undefined}
                            className={cn('truncate px-2.5 py-2 text-[13px] text-faint', bandeSeule && 'invisible')}
                          >
                            {t('Glissez un projet ici.')}
                          </p>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}

              {/* « Aucun projet inscrit » ne s'écrit que si la colonne n'en a
                  vraiment aucun. */}
              {filtre && !entreesAffichees.length && !espaceDevAffiche && !rechercheEnCours ? (
                <p className="truncate px-2.5 py-2 text-[13px] text-faint" data-recherche-vide>
                  {t('Aucun résultat.')}
                </p>
              ) : null}
              {bandeSeule ? null : !entries.length && !espaceDev ? (
                <button
                  type="button"
                  data-creer-premier-projet="colonne"
                  onClick={ouvrirLAjoutDeProjet}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-muted transition-colors hover:bg-raised hover:text-text"
                >
                  <Plus className="h-3.5 w-3.5 shrink-0" />
                  {t('Créer votre premier projet')}
                </button>
              ) : null}
            </>
          )}

          {/* « MIS DE CÔTÉ » : un dernier dossier, replié, tout en bas de la
              liste. Caché tant que la colonne reste réduite. */}
          {!bandeSeule && !filtre ? (
            <>
              <button onClick={() => setShowArchived((value) => !value)} className={cn(classeSection, 'mt-3')}>
                <span className="min-w-0 truncate">{t('Mis de côté')}</span>
                <ChevronRight className={cn('h-3 w-3 shrink-0 transition-transform', showArchived && 'rotate-90')} />
              </button>

              {showArchived ? (
                archived.length ? (
                  archived.map((project) => (
                    <div
                      key={project.id}
                      className="group flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[14px] text-faint hover:bg-raised"
                    >
                      <Folder className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{project.name}</span>
                      <button
                        onClick={() => client.call({ type: 'project.archive', id: project.id, archived: false })}
                        className="shrink-0 opacity-0 transition-opacity hover:text-text group-hover:opacity-100"
                        title={t('Remettre en service')}
                      >
                        <ArchiveRestore className="h-4 w-4" />
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="px-2.5 py-2 text-[13px] text-faint">{t('Aucun projet mis de côté.')}</p>
                )
              ) : null}
            </>
          ) : null}
        </ZoneDefilement>

        {/* LES SERVICES ONT QUITTÉ LE BAS DE LA COLONNE (15/11/2026) : ils vivent dans la tête, juste sous « Tableaux de
            bord » (voir plus haut). Le pied ne garde que l'état des moteurs, la cloche et les réglages. */}

        {/* LE PIED : l'état du moteur à gauche — « LLM en ligne », le compte en
            service, et les quotas au clic — et UN bouton à droite, les
            réglages. Rien d'autre. */}
        <div
          data-pied-colonne
          data-rangee-de-boutons
          data-pied-cache-par-la-recherche={filtre ? '' : undefined}
          className={cn('shrink-0', CLASSE_RANGEE_DE_BOUTONS, bandeSeule ? 'flex-col px-0 pb-3 pt-2' : 'px-2 pb-2.5 pt-1.5', filtre && '!hidden')}
        >
          {/* Le lien avec le serveur ne se lit plus ici : il est au témoin de la tête de colonne (`TemoinDuServeur`). */}
          <QuotaBadge activeEngine={moteurActif} variante={bandeSeule ? 'bande' : 'pied'} />
          {/* LA CLOCHE DES NOTIFICATIONS, à côté des réglages (demande du
              12/10/2026) : sur ordinateur seulement — sur téléphone, elle
              reste en haut à droite de l'écran (`app.tsx`). */}
          {!telephone ? <ClocheNotifications className="h-9 w-9 shrink-0" /> : null}
          {/* LE TERMINAL DU SERVEUR, SUR TÉLÉPHONE (décision du 20/10/2026) :
              ici seulement, à côté des réglages — plus aucun rond ni pastille
              flottante. Il tourne, en violet, quand le terminal réduit
              travaille. Sur ordinateur, son rond flotte à gauche de
              l'assistant (`pastille-terminal.tsx`). */}
          {telephone && state.monRole === 'admin' && !state.offreHebergee ? (
            <Button
              variant="ghost"
              size="icon"
              className="relative h-[43px] sm:h-9 w-[43px] sm:w-9 shrink-0 text-muted"
              aria-label="Terminal du serveur"
              title={bulleDuTerminal(terminal.etat, terminal.actif)}
              data-terminal-pied
              data-terminal-etat={terminal.etat}
              data-terminal-actif={terminal.actif ? 'oui' : 'non'}
              onClick={() => {
                ouvrirLeTerminal();
                onChoose?.();
              }}
            >
              {terminal.actif ? <Loader2 className="h-4 w-4 animate-spin text-teinte" /> : <TerminalSquare className="h-4 w-4" />}
            </Button>
          ) : null}
          {onOpenSettings ? (
            <Tooltip label={t('Réglages')}>
              <Button
                variant="ghost"
                size="icon"
                className="relative h-[43px] sm:h-9 w-[43px] sm:w-9 shrink-0 text-muted"
                aria-label="Réglages"
                data-reglages-menu
                onClick={() => {
                  onOpenSettings();
                  onChoose?.();
                }}
              >
                <Settings className="h-4 w-4" />
                {/* UN REDÉMARRAGE ATTEND : le point le dit ici, sur le bouton
                    qui mène à son geste (réglages, « Serveur »). */}
                <PointRedemarrage etat={redemarrage.etat} />
              </Button>
            </Tooltip>
          ) : null}
        </div>
      </div>

      {/* LES FENÊTRES RESTENT MONTÉES DANS LES DEUX ÉTATS : replier la colonne
          pendant qu'une d'elles est ouverte ne doit pas la faire disparaître. */}
      <ProjectsDialog
        open={adding}
        onClose={() => setAdding(false)}
        onOuvrirVue={onOuvrirVue}
        adresse={onChoose ? 'projets-du-serveur' : undefined}
      />
      <PromptDialog
        open={creatingGroup}
        title={t('Nouveau dossier')}
        description={t('Un rangement pour vous y retrouver : « Clients », « Mes projets », « Capitaux »…')}
        placeholder={t('Nom du dossier')}
        confirmLabel={t('Créer')}
        onConfirm={(nom) => client.call({ type: 'group.create', name: nom })}
        onClose={() => setCreatingGroup(false)}
      />

      <PromptDialog
        open={!!renaming}
        title={t('Renommer le groupe')}
        defaultValue={renaming?.name ?? ''}
        placeholder={t('Nom du groupe')}
        confirmLabel={t('Renommer')}
        onConfirm={(nom) => renaming && client.call({ type: 'group.update', id: renaming.id, name: nom })}
        onClose={() => setRenaming(null)}
      />

      <ConfirmDialog
        open={!!deleting}
        title={t('Supprimer le groupe « {v0} » ?', { v0: deleting?.name ?? '' })}
        description={t('Les projets qu\'il contient ne sont pas supprimés : ils remontent simplement hors groupe.')}
        confirmLabel={t('Supprimer le groupe')}
        danger
        onConfirm={() => deleting && client.call({ type: 'group.delete', id: deleting.id })}
        onClose={() => setDeleting(null)}
      />
    </aside>
  );
}

/**
 * La palette des groupes : seize teintes franches, plus « aucune ». Elle vit
 * dans `shared/src/gestion-projets.ts` — un agent qui règle un groupe par outil
 * choisit dans la MÊME palette que ce sélecteur, sinon la pastille posée par le
 * cadrage ne serait dans aucune case du nuancier.
 */
const COULEURS = COULEURS_DE_GROUPE;

function ColorPicker({ value, onPick }: { value?: string; onPick: (color: string) => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          // Le glissement démarre sur la ligne : on l'empêche ici, sinon le clic
          // sur la palette est avalé par le déplacement du groupe.
          onPointerDown={(event) => event.stopPropagation()}
          className="shrink-0 text-faint opacity-40 hover:text-text group-hover/g:opacity-100"
          title={t('Couleur du groupe')}
        >
          {value ? (
            <span className="block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: value }} />
          ) : (
            <Palette className="h-2.5 w-2.5" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto p-2">
        <div className="grid grid-cols-8 gap-1.5">
          {COULEURS.map((couleur) => (
            <button
              key={couleur}
              onClick={() => {
                onPick(couleur);
                setOpen(false);
              }}
              className={cn(
                'h-6 sm:h-5 w-6 sm:w-5 rounded-full ring-offset-2 ring-offset-surface transition-transform hover:scale-110',
                value === couleur ? 'ring-2 ring-text' : '',
              )}
              style={{ backgroundColor: couleur }}
              title={couleur}
            />
          ))}
        </div>
        <button
          onClick={() => {
            onPick('');
            setOpen(false);
          }}
          className="mt-2 w-full rounded bg-raised px-2.5 sm:px-2 py-1.5 sm:py-1 text-[12px] text-muted transition-colors hover:bg-fond-survol hover:text-text"
        >
          {t('Aucune couleur')}</button>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * « Quelque chose de nouveau vous attend ici. »
 *
 * Un petit signal se rate dans une longue liste : la ligne bouge donc une fois,
 * à l'ARRIVÉE de la nouvelle — une demande à trancher COMME un travail que
 * l'agent vient de rendre. Elle ne rejoue pas tant que le compte ne remonte pas
 * — signaler, pas harceler — et la ligne qu'on regarde déjà ne bouge jamais.
 * La règle de déclenchement vit dans `shared`, testée seule ; ici on ne tient
 * que la minuterie.
 */
function useSecousse(signal: SignalProjet, regarde: boolean): boolean {
  const [tour, setTour] = React.useState(0);
  const [secoue, setSecoue] = React.useState(false);
  const attention = signal.attention ?? 0;
  const rendus = signal.rendus ?? 0;
  const avant = React.useRef<SignalProjet>({ attention, rendus });

  React.useEffect(() => {
    const declenche = doitSecouerLigne({
      avant: avant.current,
      maintenant: { attention, rendus },
      regarde,
    });
    avant.current = { attention, rendus };
    // Un tour de plus, et rien d'autre : décider n'est pas animer.
    if (declenche) setTour((n) => n + 1);
  }, [attention, rendus, regarde]);

  /*
   * La minuterie ne dépend QUE du numéro de tour, jamais des comptes.
   * Autrement, un second signal qui bouge PENDANT la secousse relançait ce
   * calcul, son ménage effaçait la minuterie de fin — et la ligne tremblait
   * sans fin. Le ménage remet donc lui-même la ligne au repos, et deux signaux
   * coup sur coup rejouent bien l'animation, la classe étant retirée d'abord.
   */
  React.useEffect(() => {
    if (!tour) return;
    const depart = window.setTimeout(() => setSecoue(true), 20);
    const fin = window.setTimeout(() => setSecoue(false), 700);
    return () => {
      window.clearTimeout(depart);
      window.clearTimeout(fin);
      setSecoue(false);
    };
  }, [tour]);

  return secoue;
}

/**
 * La ligne d'un groupe. Elle existe surtout pour porter la secousse : un
 * crochet ne s'appelle pas au milieu d'une boucle d'affichage.
 */
function EnteteGroupe({
  rowProps,
  dimmed,
  signal,
  regarde,
  bande = false,
  titre,
  children,
}: {
  rowProps: Record<string, unknown>;
  dimmed?: boolean;
  /** Ce que ses projets attendent, et ce qu'ils ont rendu sans être lus. */
  signal: SignalProjet;
  /** Le projet ouvert est-il DANS ce groupe ? Alors rien ne bouge. */
  regarde: boolean;
  /** La colonne est rétrécie : le titre se réduit à son initiale. */
  bande?: boolean;
  /** Le nom du groupe, dont l'initiale tient lieu de titre une fois rétréci. */
  titre?: string;
  children: React.ReactNode;
}) {
  const secoue = useSecousse(signal, regarde);
  return (
    <div
      {...rowProps}
      data-groupe-attention={signal.attention || undefined}
      data-groupe-rendus={signal.rendus || undefined}
      className={cn(
        // `min-h-[43px] sm:min-h-9` FIXE : réduite à sa seule initiale, l'en-tête de groupe
        // était plus basse que son propre bouton de nom en mode ouvert (une
        // lettre tient dans moins de hauteur qu'un libellé) — chaque groupe
        // décalait d'autant tout ce qui suivait entre les deux modes.
        'group/g relative flex h-[43px] sm:h-9 items-center gap-1 rounded-lg transition-colors hover:bg-raised sm:gap-1.5',
        bande ? 'justify-center px-0' : 'pl-2.5 pr-1',
        dimmed && 'opacity-40',
        secoue && 'animate-secousse',
      )}
    >
      {/* RÉTRÉCI, LE TITRE TIENT EN UNE LETTRE. Le groupe garde sa place et son
          ordre — c'est la même structure qu'en large —, et son nom entier
          revient dès que le menu se déplie au survol. */}
      {bande ? (
        <span
          className="text-[10px] font-semibold uppercase leading-none text-faint"
          data-groupe-initiale
          title={titre}
        >
          {(titre ?? '').trim().slice(0, 1) || '—'}
        </span>
      ) : (
        children
      )}
    </div>
  );
}

/**
 * « Un agent travaille ici. »
 *
 * Un loader qui tourne, et rien d'autre : il remplace à lui seul l'icône de
 * dossier tant qu'un agent écrit, pour que l'activité se lise d'un coup
 * d'œil — un robot immobile ne le disait pas. Le nombre ne s'écrit que s'il y
 * a VRAIMENT plusieurs agents : « 1 » ne dit rien de plus que le loader
 * lui-même.
 *
 * Une PUBLICATION en cours prend la même place, mais change de signe : une
 * icône réseau / envoi, violette et clignotante (jeton `publie`), au lieu du
 * loader orange — un déploiement doit se voir d'un coup d'œil, sans se
 * confondre avec un travail ordinaire. Elle remplace alors le loader, elle
 * ne s'y ajoute pas.
 *
 * Rien de tout ça n'est vrai : le repère ne s'affiche pas (`null`), pour
 * laisser sa place au repère de repos de l'appelant (favicon du projet,
 * outil de l'espace de développement…) — sur une ligne de projet, il vient
 * s'AJOUTER entre ce repère de repos et le nom, jamais le remplacer.
 *
 * En variante `mini` (une ligne de projet ordinaire), il ne s'ajoute plus à
 * côté du favicon — ce qui élargissait le bouton en colonne réduite — mais se
 * pose EN INCRUSTATION sur son coin haut droit.
 *
 * UN SEUL REPÈRE À LA FOIS, dans l'ordre de ce qui compte le plus : une
 * publication en cours, puis une réponse attendue (question, plan, décision —
 * `icone`, la même table que lit `RepereLigne`), puis un vrai travail en
 * cours, puis un rapport rendu pas encore consulté (`rendus`), et enfin rien.
 * Un agent encore associé au projet mais arrêté sur une question ne « travaille »
 * plus au sens de ce badge : c'est l'utilisateur qu'on attend.
 */
function RepereRobot({
  running,
  publie,
  icone,
  rendus,
  mini = false,
}: {
  running: number;
  publie?: boolean;
  /**
   * LA NATURE DE CE QUI ATTEND sur ce projet (`iconeAttenteOf`). Prime sur la
   * roue : un agent techniquement encore associé au projet, mais arrêté sur
   * une question ou un plan, ne « travaille » pas au sens où l'utilisateur
   * l'entend — c'est LUI qu'on attend, pas l'inverse.
   */
  icone?: IconeDAttention | null;
  /** Rendu et pas encore consulté — montré seulement quand rien de plus urgent n'attend. */
  rendus?: number;
  /** Incrustation sur le coin de l'icône, au lieu d'un ajout à côté d'elle. */
  mini?: boolean;
}) {
  // En incrustation (`mini`), le repère se fond sinon dans les couleurs du
  // favicon en dessous : chaque état pose donc une pastille pleine de sa
  // propre couleur, avec son dessin en blanc par-dessus — jamais un dessin
  // transparent posé à même le logo.
  const pastilleMini = 'flex h-3 w-3 items-center justify-center rounded-full shadow-sm';
  if (publie) {
    return (
      <Tooltip label={t('Publication en cours')}>
        <span
          className={cn(
            'flex shrink-0 items-center gap-0.5',
            mini && cn(pastilleMini, 'absolute -right-[7px] -top-[6px] bg-publie'),
          )}
          data-repere-robot
          aria-label="Publication en cours"
        >
          <UploadCloud
            className={cn(
              'shrink-0 animate-pulse-soft motion-reduce:animate-none',
              mini ? 'h-2 w-2 text-sur-etat' : 'h-[15px] w-[15px] text-publie',
            )}
          />
        </span>
      </Tooltip>
    );
  }
  if (icone) {
    const libelle =
      icone === 'message'
        ? t('Une question attend votre réponse')
        : icone === 'plan'
          ? t('Un plan attend votre geste')
          : t('Une décision attend votre geste');
    return <RepereAttention compte={1} icone={icone} libelle={libelle} badge={{ mini }} />;
  }
  if (running) {
    const libelle = running > 1 ? `${running} agents au travail` : t('Un agent au travail');
    return (
      <Tooltip label={libelle}>
        <span
          className={cn(
            'flex shrink-0 items-center gap-0.5',
            mini && cn(pastilleMini, 'absolute -right-[7px] -top-[6px] bg-teinte-plein'),
          )}
          data-repere-robot
          aria-label={libelle}
        >
          <Loader2
            className={cn(
              'shrink-0 animate-spin motion-reduce:animate-none',
              mini ? 'h-2 w-2 text-sur-couleur' : 'h-[15px] w-[15px] text-teinte',
            )}
          />
          {!mini && running >= 1 ? <span className="text-[10.5px] leading-none text-teinte">{running}</span> : null}
        </span>
      </Tooltip>
    );
  }
  if (rendus) {
    const libelle = libelleNonConsultees(rendus);
    return (
      <Tooltip label={libelle}>
        <span
          className={cn(
            'flex shrink-0 items-center gap-0.5',
            mini && cn(pastilleMini, 'absolute -right-[7px] -top-[6px] cursor-pointer bg-termine'),
          )}
          data-repere-robot
          data-repere-rendus
          aria-label={libelle}
        >
          <FileCheck2 className={cn('shrink-0', mini ? 'h-2 w-2 text-sur-etat' : 'h-[15px] w-[15px] text-termine')} />
          {!mini ? <span className="text-[10.5px] leading-none text-termine">{texteDuCompteur(rendus)}</span> : null}
        </span>
      </Tooltip>
    );
  }
  return null;
}

function libelleNonConsultees(n: number, groupe = false): string {
  const base =
    n > 1 ? t('{n} cartes avec un rendu non consulté', { n }) : t('Une carte avec un rendu non consulté');
  return groupe
    ? t('{v0} — cliquez pour tout marquer comme consulté', { v0: base })
    : t('{v0} — cliquez pour l’ouvrir', { v0: base });
}

/**
 * LE BADGE BLEU D'UNE LIGNE MÈNE À SA CARTE. Il vit DANS le bouton du projet
 * (un bouton n'en contient pas un autre, et sortir le badge décalerait l'icône
 * en colonne réduite) : le bouton regarde donc où le clic est tombé. Sur le
 * badge `data-repere-rendus`, il ouvre la carte non lue la plus récente
 * (`ouvrirCarteNonLue`) ; ailleurs, il garde son geste d'origine.
 */
function clicSurLeBadgeRendu(event: React.MouseEvent): boolean {
  return !!(event.target as Element | null)?.closest?.('[data-repere-rendus]');
}

/**
 * « Ce projet est en train d'être mis en ligne. »
 *
 * Un point jaune qui respire, du côté du robot : c'est l'ÉTAT du projet, pas une
 * décision à prendre. Il ne porte donc AUCUN geste (la publication se suit sur
 * la carte d'« À déployer »), et ne compte pas parmi les deux repères d'attente
 * de droite. Il ne vit que le temps de la publication et s'éteint dès qu'elle
 * se termine — réussite, échec ou arrêt.
 */
function RepereePublication({ publie }: { publie: boolean }) {
  if (!publie) return null;
  return (
    <Tooltip label={t('Publication en cours')}>
      <span
        aria-label="Publication en cours"
        data-repere-publication
        className="h-2 w-2 shrink-0 rounded-full bg-publie animate-pulse-soft motion-reduce:animate-none"
      />
    </Tooltip>
  );
}

/**
 * « Où en est le travail en cours sur ce projet ? » — le même pourcentage que
 * celui de la tête de la colonne « En cours » du tableau (`avancementDeLaColonne`),
 * additionné sur les cartes de ce seul projet, posé dans l'espace laissé libre
 * par le point bleu déplacé à gauche (`RepereRobot`).
 *
 * Il cède la place au triangle de décision (`RepereLigne`) : les deux vivent
 * au même endroit, jamais ensemble — une décision qui attend prime toujours.
 *
 * Contrairement à `RepereLigne`, qui EMPRUNTE au repos la place de l'icône
 * réglages (encore invisible) puis s'en écarte au survol pour la lui rendre,
 * le pourcentage emprunte la MÊME place mais n'en bouge JAMAIS : le décalage
 * (`survol:translate-x-4`, un « quart » = la largeur de l'icône réglages plus
 * son espacement) reste posé qu'on survole ou non — un chiffre qui glisserait
 * à chaque passage de souris est justement ce que cet écran ne veut plus. Il
 * s'efface par l'OPACITÉ, jamais par la position, pour laisser voir l'icône
 * réglages quand elle apparaît par-dessus au survol.
 */
function RepereAvancementProjet({
  avancement,
  className,
}: {
  avancement: AvancementColonne | null;
  /** Le décalage fixe qui le colle au bord droit, posé par l'appelant. */
  className?: string;
}) {
  if (!avancement) return null;
  const { done, total, pourcent, termine } = avancement;
  return (
    <Tooltip label={t('{done} étape{v0} faite{v1} sur {total}', { done, v0: done > 1 ? 's' : '', v1: done > 1 ? 's' : '', total })}>
      <span
        data-avancement-projet
        className={cn(
          'shrink-0 px-0.5 text-[11px] font-medium tabular-nums',
          termine ? 'text-termine' : 'text-en-cours',
          className,
        )}
      >
        {pourcent} %
      </span>
    </Tooltip>
  );
}

/**
 * Le SEUL repère d'attente de la ligne, à droite du nom.
 *
 * Ils étaient trois à se disputer trois centimètres : triangle orange, pastille
 * verte chiffrée, point bleu. Deux disaient la même chose (du travail rendu,
 * pas encore lu) et le troisième, la seule chose qui demande vraiment un geste.
 * `repereVisible` tranche — la décision d'abord, la lecture ensuite — et un
 * seul apparaît. Ce qui est caché n'est pas perdu : la décision réglée, le
 * point bleu reparaît tout seul.
 *
 * La colonne ne lui passe plus que la décision : le travail rendu vit dans le
 * repère posé sur l'icône du projet (`RepereRobot`).
 */
/**
 * Emmener à la première décision en attente d'un projet — celle qui patiente
 * depuis le plus longtemps. Une carte : son tiroir s'ouvre. Aucune carte : la
 * conversation où le bouton attend se déplie. Dans les deux cas le projet
 * devient celui qu'on regarde, sinon on arriverait sur le tableau d'un autre.
 */
function allerALaDecision(projectId: string, onChoose?: () => void): void {
  client.setActiveProject(projectId);
  onChoose?.();
  const lieu = premiereDecision(client.lireEtat().decisions, projectId);
  if (!lieu) return;
  /*
   * LE MÊME CHEMIN QUE LA CLOCHE ET QUE LA NOTIFICATION POUSSÉE. Ce triangle
   * ouvrait la carte ou la conversation lui-même, et ne savait donc ni
   * réclamer un fil que l'écran n'a pas chargé, ni conduire jusqu'à la BULLE
   * qui porte la question. Une seule route pour les trois entrées.
   */
  client.allerVersDecision(lieu);
}

function RepereLigne({
  signal,
  icone,
  onDecision,
  className,
}: {
  signal: SignalProjet;
  /**
   * LA NATURE DE CE QUI ATTEND, choisie par la table partagée
   * (`iconeDuLot`). Absente : le triangle, comme avant.
   */
  icone?: IconeDAttention | null;
  /** Emmener à l'endroit où la décision se prend. */
  onDecision?: () => void;
  /** Décalage doux appliqué au repère (glissement au survol). */
  className?: string;
}) {
  const quoi = repereVisible(signal);
  if (!quoi) return null;

  if (quoi === 'attention') {
    const compte = signal.attention ?? 0;
    const libelle = t('{v0} — cliquez pour y aller', { v0: libelleAttention(compte) });
    /*
     * Le triangle EMMÈNE : c'est le chaînon qui manquait. Annoncer « 4
     * décisions attendues » sans dire où elles se prennent revenait à montrer
     * un chiffre introuvable. Un clic ouvre la première, la plus ancienne.
     */
    return (
      <RepereAttention
        compte={compte}
        icone={icone}
        libelle={libelle}
        className={className}
        onClick={() => onDecision?.()}
      />
    );
  }

  return null;
}

function Trait({ ou }: { ou?: 'before' | 'after' }) {
  if (!ou) return null;
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-x-0 h-px bg-warning',
        ou === 'before' ? '-top-px' : '-bottom-px',
      )}
    />
  );
}

/**
 * « Beluga » : l'espace de développement de l'application, fixé en tête de
 * son groupe « Local ».
 *
 * Le projet posé sur le dossier de Beluga Build (marque `isSelf`) n'est pas un
 * projet client : c'est l'atelier où l'outil lui-même évolue. Il quitte donc le
 * RANGEMENT — plus de poignée, pas de `data-drag-id` : on ne peut ni le
 * déplacer ni le sortir de son groupe (`data-espace-dev-verrouille`) — pour
 * occuper la PREMIÈRE place du groupe « Local » (`shared/src/groupe-local.ts`),
 * ou, sans ce groupe, celle du haut de la liste. Il REÇOIT en revanche une carte glissée du
 * tableau, exactement comme une ligne de projet (`data-projet-cible`) : c'est
 * le seul geste de souris qui lui reste, et il s'éclaire pendant le survol. Il porte l'icône de l'application
 * (`/icon.svg`, le beluga du favicon), qui le distingue d'un coup d'œil de
 * toutes les autres lignes. Rien d'autre ne change : même identifiant, mêmes cartes, même
 * conversation, mêmes réglages, et les MÊMES repères qu'une ligne de projet
 * (robot, triangle de décision, point bleu de travail rendu, point jaune de
 * publication) — les perdre reviendrait à cesser de voir ce qui s'y passe.
 */
function LigneEspaceDev({
  project,
  active,
  running,
  publie,
  attention,
  icone,
  rendus,
  avancement,
  cibleDeCarte,
  onSettings,
  onNouvelAgent,
  onChoose,
  onQuitterTableauDeBord,
  onEntrer,
  bande = false,
  outilsCaches = false,
  taches,
  repere = true,
}: {
  /** Le nom cliqué (pas le badge « rendu ») : une entrée explicite dans le projet, qui relance la reprise. */
  onEntrer?: () => void;
  /** Faux : la tâche ouverte, visible dessous, est marquée à sa place. (Le point d'avant a disparu, 16/11/2026.) */
  repere?: boolean;
  /** La flèche qui déplie les tâches de l'espace de développement. */
  taches?: { ouvert: boolean; basculer: () => void };
  /** Sur téléphone, interrupteur éteint : le réglage de la ligne se cache. */
  outilsCaches?: boolean;
  /** La colonne est rétrécie : plus que l'icône, le nom passant en bulle. */
  bande?: boolean;
  project: Project;
  active: boolean;
  running: number;
  publie?: boolean;
  attention?: number;
  /** La nature de ce qui attend sur ce projet (`iconeDuLot`). */
  icone?: IconeDAttention | null;
  rendus?: number;
  /** L'avancement des cartes en cours, pour la même place que le triangle de décision. */
  avancement?: AvancementColonne | null;
  /** Une carte survole cette ligne : permise (elle s'éclaire) ou refusée (inerte). */
  cibleDeCarte?: 'acceptee' | 'refusee' | null;
  onSettings: () => void;
  /** Le « + » du survol : un nouvel agent dans l'espace de développement. */
  onNouvelAgent?: () => void;
  onChoose?: () => void;
  /** Le tableau de bord occupe la place : un clic ici doit le refermer. */
  onQuitterTableauDeBord?: () => void;
}) {
  const secoue = useSecousse({ attention, rendus }, active);
  void avancement;
  /* LE NOM CLIQUÉ EST UNE ENTRÉE DANS LE PROJET, comme sur toute autre ligne (`ProjectRow.onEntrer`,
     01/11/2026) : sans elle, la tâche d'un autre projet restait affichée sous Beluga. */
  const ouvrir = (event: React.MouseEvent) => {
    const badge = !!rendus && clicSurLeBadgeRendu(event);
    if (badge) void client.ouvrirCarteNonLue(project.id);
    else client.setActiveProject(project.id);
    onQuitterTableauDeBord?.();
    onChoose?.();
    if (!badge) onEntrer?.();
  };
  return (
    <div
      data-espace-dev={project.id}
      data-actif={active || undefined}
      // IMMUABLE AU RANGEMENT, MAIS PAS INERTE. La ligne ne se glisse pas et
      // n'entre dans aucun groupe (`data-espace-dev-verrouille`, aucun
      // `data-drag-id`) — en revanche elle REÇOIT une carte comme toute autre
      // ligne de projet : c'est ce que dit `data-projet-cible`, lu par
      // `resolve` dans `board.tsx` pendant un glissement de carte.
      data-espace-dev-verrouille="oui"
      data-projet-cible={project.id}
      data-projet-survole={cibleDeCarte ?? undefined}
      draggable={false}
      data-espace-dev-attention={attention || undefined}
      data-espace-dev-rendus={rendus || undefined}
      className={cn(
        CLASSE_LIGNE_DE_PROJET,
        bande ? 'justify-center px-0' : 'pl-2.5 pr-1',
        'hover:bg-raised',
        active && 'text-important',
        secoue && 'animate-secousse',
        cibleDeCarte === 'acceptee' && 'bg-raised ring-1 ring-inset ring-faint',
        cibleDeCarte === 'refusee' && 'opacity-50',
      )}
    >
      <button
        data-ouvrir-espace-dev
        onClick={ouvrir}
        title={t('{v0} — l’espace où l’application elle-même est développée', { v0: project.name })}
        className={cn('flex h-[43px] sm:h-9 min-w-0 items-center gap-2.5 text-left', bande ? 'justify-center' : 'flex-1')}
      >
        {/* L'ICÔNE DE L'APPLICATION RESTE TOUJOURS LÀ. L'état (un agent
            travaille, une publication part, une réponse attend) se pose EN
            INCRUSTATION sur son coin (`RepereRobot mini`). */}
        <span className="relative inline-flex shrink-0 items-center">
          <img src="/icon.svg" alt="" aria-hidden data-espace-dev-favicon className="h-[15px] w-[15px] shrink-0 rounded-[3px]" />
          {running || publie || icone || rendus ? (
            <RepereRobot running={running} publie={publie} icone={icone} rendus={rendus} mini />
          ) : null}
        </span>
        <span className={cn('min-w-0 flex-1 truncate', bande && 'sr-only')}>{project.name}</span>
      </button>
      {/* Hors du bouton : le repère de décision porte son propre geste, et un
          bouton n'en contient pas un autre. */}
      {bande ? (
        repereVisible({ attention }) ? (
          <span
            className="pointer-events-none absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-text"
            data-alerte-projet={project.id}
            aria-hidden
          />
        ) : null
      ) : (
        <div className="flex shrink-0 items-center">
          {repereVisible({ attention }) ? (
            <RepereLigne
              signal={{ attention }}
              icone={icone}
              onDecision={() => {
                onQuitterTableauDeBord?.();
                allerALaDecision(project.id, onChoose);
              }}
            />
          ) : null}
          <span className={CLASSE_ENVELOPPE_D_OUTILS} data-outils-de-ligne>
            <span className="flex min-w-0 items-center overflow-hidden">
              {onNouvelAgent ? (
                <button
                  type="button"
                  onClick={onNouvelAgent}
                  data-nouvel-agent-projet={project.id}
                  className={cn(CLASSE_OUTIL_DE_LIGNE, outilsCaches && 'hidden')}
                  title={t('Nouvel artefact dans ce projet')}
                  aria-label="Nouvel artefact dans ce projet"
                >
                  <Plus className="h-4 w-4" />
                </button>
              ) : null}
              <button
                onClick={onSettings}
                data-reglages-projet={project.id}
                className={cn(CLASSE_OUTIL_DE_LIGNE, outilsCaches && 'hidden')}
                title={t('Réglages de l’espace de développement')}
              >
                <EllipsisVertical className="h-4 w-4" />
              </button>
            </span>
          </span>
          {taches ? <FlecheDesTaches projectId={project.id} ouvert={taches.ouvert} basculer={taches.basculer} /> : null}
        </div>
      )}
    </div>
  );
}

/**
 * LA TENUE D'UNE LIGNE DE PROJET : une icône, un nom, 36 px de haut, un fond
 * gris au survol. Aucun cadre, aucun compteur. La ligne ouverte s'écrit en couleur, SANS
 * aucun point devant elle (16/11/2026).
 *
 * LES OUTILS NE RÉSERVENT AUCUNE PLACE AU REPOS : ce qui attend sur la ligne touche
 * le chevron. Au survol ou au focus clavier, leur enveloppe s'ouvre en glissant
 * (`grid-template-columns` de 0fr à 1fr, la seule façon d'animer vers une largeur que
 * personne n'a écrite) et pousse le repère vers la gauche. Ils restent MONTÉS : la
 * poignée doit pouvoir tenir un glissement qui sort de la ligne. Sans survol
 * (téléphone), l'enveloppe reste ouverte et `outilsCaches` décide de les montrer.
 */
const CLASSE_LIGNE_DE_PROJET =
  'group relative flex h-9 w-full items-center gap-1 rounded-lg text-[14px] text-text transition-[transform,background-color] duration-150 motion-reduce:transition-none sm:gap-1.5';
const CLASSE_OUTIL_DE_LIGNE =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-faint hover:bg-fond-survol hover:text-text';
/**
 * LA POIGNÉE QUI RANGE UN PROJET OU UN DOSSIER, À GAUCHE DE SON ICÔNE (31/10/2026,
 * capture #6515). À la souris, elle se pose dans la marge gauche de la ligne
 * (`pl-2.5`), en absolu, et ne paraît qu'au survol : ni l'icône ni le nom ne
 * bougent. Sans survol (téléphone, outils montrés), elle reprend sa place de
 * doigt dans le flux, avant l'icône. Elle n'est jamais dans le bouton du nom :
 * elle a son propre geste.
 */
const CLASSE_POIGNEE_A_GAUCHE =
  'flex h-7 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-faint hover:text-text active:cursor-grabbing survol:absolute survol:left-0 survol:top-1/2 survol:z-10 survol:h-6 survol:w-2.5 survol:-translate-y-1/2 survol:opacity-0 survol:transition-opacity';
const CLASSE_ENVELOPPE_D_OUTILS =
  'grid shrink-0 grid-cols-[1fr] transition-[grid-template-columns] duration-150 ease-out motion-reduce:transition-none survol:grid-cols-[0fr] survol:focus-within:grid-cols-[1fr] survol:group-hover:grid-cols-[1fr]';
const CLASSE_ENVELOPPE_D_OUTILS_DE_DOSSIER =
  'grid shrink-0 grid-cols-[1fr] transition-[grid-template-columns] duration-150 ease-out motion-reduce:transition-none survol:grid-cols-[0fr] survol:focus-within:grid-cols-[1fr] survol:group-hover/g:grid-cols-[1fr]';

function ProjectRow({
  project,
  active,
  running,
  publie,
  attention,
  icone,
  rendus,
  avancement,
  dimmed,
  cibleDeCarte,
  style,
  marqueur,
  rowProps,
  poigneeProps,
  onSettings,
  onChoose,
  groupColor,
  emboite,
  bande = false,
  outilsCaches = false,
  sousGroupe,
  sansPoignee = false,
  taches,
  repere = true,
  onNouvelAgent,
  onEntrer,
}: {
  /** Le nom cliqué (pas le badge « rendu ») : une entrée explicite dans le projet, qui relance la reprise. */
  onEntrer?: () => void;
  /** LE « + » DU SURVOL, à gauche du « ⋮ » : un nouvel agent dans ce projet (ou ce projet réuni). */
  onNouvelAgent?: () => void;
  /** Faux : la tâche ouverte, visible dessous, est marquée à sa place. (Le point d'avant a disparu, 16/11/2026.) */
  repere?: boolean;
  /** La flèche qui déplie les tâches du projet (un projet réuni a déjà celle de son sous-groupe). */
  taches?: { ouvert: boolean; basculer: () => void };
  /** Sur téléphone, interrupteur éteint : poignée et réglages se cachent. */
  outilsCaches?: boolean;
  /**
   * CETTE LIGNE EST UN PROJET RÉUNI : elle porte la flèche de son sous-groupe.
   * Un clic sur son nom ouvre le tableau commun SANS déplier ni replier ses
   * membres : seule la flèche de droite bascule le sous-groupe.
   */
  sousGroupe?: { ouvert: boolean; nombre: number; membres: Project[]; basculer: (ouvrir?: boolean) => void };
  /** Un membre de projet réuni ne se glisse pas : pas de poignée. */
  sansPoignee?: boolean;
  /**
   * LA COLONNE EST RÉTRÉCIE : la ligne se réduit à son icône, son nom vivant
   * dans une bulle au survol. Elle RESTE dans le document — c'est bien le même
   * projet, à la même place, dans le même ordre : rien ne disparaît, et le
   * dépliage au survol le rend tel quel.
   */
  bande?: boolean;
  project: Project;
  active: boolean;
  running: number;
  /** Une publication de ce projet est-elle en cours ? */
  publie?: boolean;
  attention?: number;
  /** La nature de ce qui attend sur ce projet (`iconeDuLot`). */
  icone?: IconeDAttention | null;
  /** Réponses rendues et pas encore lues sur ce projet. */
  rendus?: number;
  /** L'avancement des cartes en cours, pour la même place que le triangle de décision. */
  avancement?: AvancementColonne | null;
  dimmed?: boolean;
  /**
   * UNE CARTE DU TABLEAU EST EN VOL AU-DESSUS DE CETTE LIGNE.
   * « acceptee » : le dépôt se fera — la ligne s'éclaire. « refusee » : la
   * ligne reste inerte, et le motif s'affichera au relâchement.
   */
  cibleDeCarte?: 'acceptee' | 'refusee' | null;
  /** La couleur du groupe qui range ce projet, pour le demi-rond du projet ouvert. */
  groupColor?: string;
  /** Le projet est rangé dans un groupe (décalage « pl-3 » à rattraper), ou dans un projet réuni. */
  emboite?: boolean | 'reuni';
  /** Le décalage vers le bas quand un élément vise une place au-dessus. */
  style?: React.CSSProperties;
  /** Le trait de l'emplacement visé, au-dessus ou en dessous de la ligne. */
  marqueur?: 'before' | 'after';
  rowProps: Record<string, unknown>;
  /** Le glissement part d'ICI, jamais de la ligne entière. */
  poigneeProps: Record<string, unknown>;
  onSettings: () => void;
  onChoose?: () => void;
}) {
  // Le projet qu'on regarde déjà ne bouge pas : le signal sert à ce qu'on ne
  // voit pas.
  const secoue = useSecousse({ attention, rendus }, active);
  void avancement;
  void groupColor;
  void emboite;
  return (
    <div
      {...rowProps}
      style={style}
      data-projet-attention={attention || undefined}
      data-projet-rendus={rendus || undefined}
      /* La ligne du projet OUVERT : son nom s'écrit en violet (`text-teinte`). */
      data-actif={active || undefined}
      /* LA LIGNE EST UNE DESTINATION POUR UNE CARTE TIRÉE DU TABLEAU. Le repère
         est posé en permanence : il n'est lu que pendant un glissement de carte
         (`resolve`, `board.tsx`), et le rangement des projets entre eux, lui,
         passe par la poignée et son propre mécanisme. */
      data-projet-cible={project.id}
      data-projet-survole={cibleDeCarte ?? undefined}
      className={cn(
        CLASSE_LIGNE_DE_PROJET,
        bande ? 'justify-center px-0' : 'pl-2.5 pr-1',
        // La ligne reste NUE : ni cadre ni couleur. L'état ne vit que sur
        // l'icône (`RepereRobot`) et sur le repère de droite (`RepereLigne`).
        'hover:bg-raised',
        active && 'text-important',
        dimmed && 'opacity-40',
        secoue && 'animate-secousse',
        cibleDeCarte === 'acceptee' && 'bg-raised ring-1 ring-inset ring-faint',
        cibleDeCarte === 'refusee' && 'opacity-50',
      )}
    >
      <Trait ou={marqueur} />
      {bande ? null : (
        <span
          {...poigneeProps}
          title={t('Glisser pour ranger')}
          className={cn(
            CLASSE_POIGNEE_A_GAUCHE,
            'survol:group-focus-within:opacity-100 survol:group-hover:opacity-100',
            (outilsCaches || sansPoignee) && 'hidden',
          )}
          data-poignee-projet={project.id}
        >
          <GripVertical className="h-3.5 w-3.5 shrink-0" />
        </span>
      )}
      <LienInterne
        adresse={construireFragment({ vue: 'projet', projectId: project.id })}
        draggable={false}
        onClick={(event) => {
          if (rendus && clicSurLeBadgeRendu(event)) {
            // Un projet réuni REPLIÉ compte aussi les rendus de ses membres.
            const membres = sousGroupe && !sousGroupe.ouvert ? sousGroupe.membres.map((m) => m.id) : [];
            void client.ouvrirCarteNonLue(project.id, membres);
            onChoose?.();
            return;
          }
          client.setActiveProject(project.id);
          // Choisir, c'est aussi refermer : même quand c'est déjà le projet
          // affiché, le panneau ne doit pas rester ouvert sur un choix fait.
          onChoose?.();
          onEntrer?.();
        }}
        title={bande ? project.name : undefined}
        className={cn('flex h-[43px] sm:h-9 min-w-0 items-center gap-2.5 text-left', bande ? 'justify-center' : 'flex-1')}
      >
        {/* L'icône du projet (ou ses initiales) reste TOUJOURS en premier, à sa
            taille et sa place fixes : c'est la seule couleur de la ligne.
            L'état se pose EN INCRUSTATION sur son coin haut droit. */}
        <span className="relative inline-flex shrink-0 items-center">
          {/* Un projet réuni montre la pile des icônes de ses membres. */}
          {sousGroupe?.membres.length ? (
            <PastillesEmpilees projects={sousGroupe.membres} />
          ) : (
            <PastilleProjet project={project} />
          )}
          {running || publie || icone || rendus ? (
            <RepereRobot running={running} publie={publie} icone={icone} rendus={rendus} mini />
          ) : null}
        </span>
        {/* LE NOM RESTE LISIBLE AUX OUTILS D'ASSISTANCE même rétréci : il passe
            en `sr-only`, il ne disparaît pas du document. */}
        <span className={cn('min-w-0 flex-1 truncate', bande && 'sr-only')}>{project.name}</span>
      </LienInterne>
      {/* Le repère de décision vit HORS du bouton du nom : il porte son propre
          geste, et un bouton n'en contient pas un autre. */}
      {bande ? (
        /* UNE ALERTE NE SE CACHE JAMAIS DERRIÈRE LE REPLI : un point la dit. */
        repereVisible({ attention }) ? (
          <span
            className="pointer-events-none absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-text"
            data-alerte-projet={project.id}
            aria-hidden
          />
        ) : null
      ) : (
        <div className="flex shrink-0 items-center">
          {repereVisible({ attention }) ? (
            <RepereLigne icone={icone} signal={{ attention }} onDecision={() => allerALaDecision(project.id, onChoose)} />
          ) : null}
          {/* LES OUTILS DE LA LIGNE, au survol seulement : un nouvel agent, puis
              les réglages du projet. La poignée, elle, est à gauche de l'icône. */}
          <span className={CLASSE_ENVELOPPE_D_OUTILS} data-outils-de-ligne>
            <span className="flex min-w-0 items-center overflow-hidden">
              {onNouvelAgent ? (
                <button
                  type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={onNouvelAgent}
                  data-nouvel-agent-projet={project.id}
                  className={cn(CLASSE_OUTIL_DE_LIGNE, outilsCaches && 'hidden')}
                  title={sousGroupe ? t('Nouvel artefact sur les projets réunis') : t('Nouvel artefact dans ce projet')}
                  aria-label={sousGroupe ? 'Nouvel artefact sur les projets réunis' : 'Nouvel artefact dans ce projet'}
                >
                  <Plus className="h-4 w-4" />
                </button>
              ) : null}
              <button
                onPointerDown={(event) => event.stopPropagation()}
                onClick={onSettings}
                data-reglages-projet={project.id}
                className={cn(CLASSE_OUTIL_DE_LIGNE, outilsCaches && 'hidden')}
                title={t('Réglages du projet')}
              >
                <EllipsisVertical className="h-4 w-4" />
              </button>
            </span>
          </span>
          {taches && !sousGroupe ? <FlecheDesTaches projectId={project.id} ouvert={taches.ouvert} basculer={taches.basculer} /> : null}
          {/* La flèche du sous-groupe, à DROITE, comme celle d'un dossier. */}
          {sousGroupe ? (
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => sousGroupe.basculer()}
              data-deplier-regroupement={project.id}
              className="flex h-[34px] sm:h-7 w-[29px] sm:w-6 shrink-0 items-center justify-center rounded-md text-faint hover:text-text"
              title={sousGroupe.ouvert ? t('Replier les projets réunis') : t('Déplier les projets réunis')}
            >
              <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', sousGroupe.ouvert && 'rotate-90')} />
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ajouter un projet existant, ou en créer un nouveau                   */
/* ------------------------------------------------------------------ */

interface Found {
  name: string;
  path: string;
  git: boolean;
}

/** Une étape du montage d'un projet, telle qu'elle revient du serveur. */
type Etape = EtapeDuMontage;

/**
 * UN MONTAGE SUIVI EN DIRECT : la liste prévue posée dès le clic, puis l'état
 * que le démon pousse à chaque étape (`project.montage`, filtré par `suivi`).
 * La réponse finale l'écrase toujours : un événement perdu ne laisse rien de faux.
 */
interface MontageSuivi {
  suivi: string;
  prevues: string[];
  etapes: Etape[];
  enCours?: string;
  fini: boolean;
}

function nouveauSuivi(): string {
  return `montage-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Les lignes à montrer : fini, la liste notée par le démon fait foi, telle quelle. */
function lignesDuMontageSuivi(montage: MontageSuivi): LigneDuMontage[] {
  return lignesDuMontage(montage.fini ? [] : montage.prevues, montage.etapes, montage.enCours);
}

/**
 * Le déroulé du montage, le même pour un projet neuf et pour un dépôt GitHub :
 * une étape par ligne, posée dès le clic et cochée au fil du montage — le même
 * rond que les barres d'étapes (`RondDEtape`), relié au suivant par un trait.
 * Ce qui a raté s'écrit avec sa cause.
 *
 * IL PREND LA PLACE DU FORMULAIRE (demande du 15/11/2026) : pendant le montage,
 * la fenêtre ne montre QUE lui, aéré (texte 14 px, une marge autour, de l'air
 * entre deux étapes). Chaque étape réussie y passe au VERT, coche blanche, et
 * le trait qui la relie à la suivante aussi — exception au monochrome voulue
 * par l'utilisateur, limitée à ce déroulé (`CLASSE_ROND_VERT`).
 */
function DerouleDesEtapes({ lignes }: { lignes: LigneDuMontage[] }) {
  return (
    <ol className="px-1 py-4 sm:px-3" data-deroule-montage aria-live="polite">
      {lignes.map((ligne, index) => {
        const dernier = index === lignes.length - 1;
        return (
          <li key={ligne.cle} className="flex items-stretch gap-3 text-[14px]" data-etape-montage={ligne.cle} data-etat={ligne.etat}>
            <span className="flex flex-col items-center pt-px">
              <RondDEtape
                vert
                forme={ligne.etat === 'fait' ? 'faite' : ligne.etat === 'en-cours' ? 'travail' : ligne.etat === 'rate' ? 'erreur' : 'avenir'}
              />
              {/* Un trait qui porte une information suit `--faint`, jamais `--border` ; vert entre deux étapes faites. */}
              {dernier ? null : (
                <span aria-hidden className={cn('my-1 min-h-3 w-px flex-1', ligne.etat === 'fait' ? CLASSE_TRAIT_VERT : 'bg-faint/60')} />
              )}
            </span>
            <span className={cn('min-w-0 flex-1', !dernier && 'pb-4')}>
              <span
                className={cn(
                  'block leading-[19px]',
                  ligne.etat === 'rate' ? 'text-danger' : ligne.etat === 'a-venir' ? 'text-faint' : 'text-text',
                  ligne.etat === 'en-cours' && 'font-medium',
                )}
              >
                {ligne.titre}
              </span>
              {ligne.detail ? (
                <span className={cn('mt-0.5 block break-words text-[12.5px]', ligne.etat === 'rate' ? 'text-danger/80' : 'text-faint')}>{ligne.detail}</span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * CE QUI S'EST PASSÉ, QUAND LE MONTAGE N'A PAS TOUT RÉUSSI. Toute erreur ramène
 * le formulaire (décision de l'utilisateur, 15/11/2026), et ce message s'écrit
 * EN TÊTE, au-dessus des champs restés remplis : il remplace l'ancien message
 * éphémère, et reste jusqu'au prochain envoi.
 */
interface ErreurDeMontage {
  titre: string;
  /** Les étapes ratées, avec leur cause ; vide pour un refus avant montage. */
  etapes: { titre: string; detail?: string }[];
  /** La cause d'un refus, ou ce qu'il faut savoir pour la suite. */
  explication: string;
}

/** Le message d'un montage refusé ou resté sans réponse : rien n'est monté, ou on ne le sait pas. */
function erreurDuMontageRefuse(err: any, depuisGithub: boolean): ErreurDeMontage {
  const message = typeof err?.message === 'string' ? err.message : '';
  if (message === RAISON_SANS_REPONSE) {
    return {
      titre: t('Le serveur n\'a pas répondu à temps'),
      etapes: [],
      explication: t('Le montage continue peut-être sur le serveur. Regardez si le projet apparaît dans la colonne de gauche avant de réessayer.'),
    };
  }
  return {
    titre: depuisGithub ? t('Le dépôt n\'a pas été ajouté') : t('Le projet n\'a pas été créé'),
    etapes: [],
    explication: message
      ? t('Raison : {v0}. Rien n\'a été créé sur le serveur : corrigez puis réessayez.', { v0: message })
      : t('Rien n\'a été créé sur le serveur : corrigez puis réessayez.'),
  };
}

/** Le message d'un montage allé au bout avec une ou plusieurs étapes ratées (`bilanDuMontageRate`). */
function erreurDuMontagePartiel(etapes: readonly Etape[], depuisGithub: boolean): ErreurDeMontage | null {
  const bilan = bilanDuMontageRate(etapes);
  if (!bilan) return null;
  return {
    titre:
      bilan.ratees.length > 1
        ? t('{v0} étapes du montage ont échoué', { v0: bilan.ratees.length })
        : t('Une étape du montage a échoué'),
    etapes: bilan.ratees.map((etape) => ({ titre: etape.titre, detail: etape.detail })),
    explication: !bilan.projetInscrit
      ? t('Le dossier existe déjà sur le serveur, mais le projet n\'est pas inscrit dans la colonne de gauche. Un nouvel envoi sous le même nom de dossier sera refusé.')
      : depuisGithub
        ? t('Le projet a quand même été ajouté : il apparaît déjà dans la colonne de gauche. Ajouter à nouveau le même dépôt sera refusé : ouvrez le projet pour terminer.')
        : t('Le projet a quand même été créé : il apparaît déjà dans la colonne de gauche. Un nouvel envoi sous le même nom de dossier sera refusé : ouvrez le projet pour terminer, ou choisissez un autre nom de dossier.'),
  };
}

function MessageDErreurDeMontage({ erreur }: { erreur: ErreurDeMontage }) {
  return (
    <div role="alert" className="rounded-lg bg-danger/10 px-3 py-2.5 text-[13.5px] text-danger" data-erreur-montage>
      <p className="font-medium">{erreur.titre}</p>
      {erreur.etapes.length ? (
        <ul className="mt-1.5 space-y-1">
          {erreur.etapes.map((etape, index) => (
            <li key={index} className="break-words">
              {etape.titre}
              {etape.detail ? <span className="text-danger/80"> — {etape.detail}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-1.5 break-words text-danger/90">{erreur.explication}</p>
    </div>
  );
}

/** Les quatre chemins d'arrivée d'un projet, proposés en cartes à l'ouverture. */
type CheminDuServeur = 'new' | 'source' | 'github' | 'existing';

function titreDuChemin(chemin: CheminDuServeur): string {
  if (chemin === 'new') return t('Nouveau projet');
  if (chemin === 'source') return t('À partir d\'un produit existant');
  if (chemin === 'github') return t('Depuis GitHub');
  return t('Déjà sur le serveur');
}

/*
 * L'ÉCRAN DE CHOIX (15/11/2026, à la place du menu des chemins) : quatre
 * cartes de même tenue, titre et description entiers — jamais repliés dans un
 * bouton —, deux colonnes sur ordinateur, une sur téléphone. Grises comme le
 * reste : le choix fait changer d'écran, il n'a pas à être teinté.
 */
function ChoixDuChemin({ onChoisir }: { onChoisir: (chemin: CheminDuServeur) => void }) {
  const chemins: { cle: CheminDuServeur; Icone: typeof FolderPlus; description: string }[] = [
    { cle: 'new', Icone: FolderPlus, description: t('Un dossier vide, prêt à recevoir votre projet, avec son dépôt et son adresse.') },
    {
      cle: 'source',
      Icone: Copy,
      description: t('Clonez un site, un SaaS, une application ou un jeu, ou inspirez-vous-en : Beluga l\'analyse et rédige le cahier des charges.'),
    },
    { cle: 'github', Icone: Github, description: t('Reprenez un dépôt qui existe déjà sur votre compte GitHub ou par son lien.') },
    { cle: 'existing', Icone: Folder, description: t('Suivez un dossier déjà présent sur cette machine.') },
  ];
  return (
    <div className="mt-2 grid gap-3 sm:grid-cols-2" data-choix-du-chemin>
      {chemins.map(({ cle, Icone, description }) => (
        <button
          key={cle}
          type="button"
          onClick={() => onChoisir(cle)}
          data-chemin={cle}
          className="flex h-full min-w-0 items-start gap-3 rounded-xl bg-raised px-3.5 py-3 text-left transition-colors hover:bg-fond-survol focus-visible:bg-fond-survol focus-visible:outline-none"
        >
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface text-muted">
            <Icone className="h-4 w-4" />
          </span>
          <span className="flex min-w-0 flex-col gap-1">
            <span className="text-[14.5px] font-medium text-text">{titreDuChemin(cle)}</span>
            <span className="text-[13px] leading-snug text-muted">{description}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function ProjectsDialog({
  open,
  onClose,
  onOuvrirVue,
  adresse,
}: {
  open: boolean;
  onClose: () => void;
  onOuvrirVue: (vue: VueCentrale) => void;
  /** Le nom du volet dans l'adresse, quand la colonne ne le tient pas elle-même. */
  adresse?: string;
}) {
  /*
   * UNE FOIS LE PROJET MONTÉ, ON ENTRE DEDANS : il devient le projet regardé,
   * le centre revient à son tableau, et sa carte « Cahier des charges » s'ouvre
   * quand on l'a demandée. Si la réponse n'a pas pu emporter l'identifiant de
   * la carte (pose plus lente que prévu), on ouvre celle qui arrive.
   */
  const entrerDansLeProjet = (projectId: string, cahierCardId: string | undefined, cahierDemande: boolean) => {
    client.setActiveProject(projectId);
    onOuvrirVue('projet');
    if (cahierCardId) {
      client.openCard(cahierCardId);
      return;
    }
    if (!cahierDemande) return;
    const fin = Date.now() + 20_000;
    const guetter = () => {
      const carte = Object.values(client.lireEtat().cards).find((c) => c.projectId === projectId && c.cahierDesCharges);
      if (carte) client.openCard(carte.id);
      else if (Date.now() < fin) window.setTimeout(guetter, 500);
    };
    guetter();
  };
  const [found, setFound] = React.useState<Found[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [filter, setFilter] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null);
  /* LE CHEMIN CHOISI SUR L'ÉCRAN DE DÉPART (15/11/2026 : plus de menu en tête
     de fenêtre). `null` = l'écran des quatre cartes, où la fenêtre s'ouvre
     toujours ; les saisies, elles, survivent à un aller-retour. */
  const [chemin, setChemin] = React.useState<CheminDuServeur | null>(null);

  /* Le troisième chemin : un dépôt qui existe DÉJÀ sur GitHub. Deux entrées —
     les dépôts du compte connecté, ou un lien collé à la main. */
  const [depots, setDepots] = React.useState<DepotDuCompte[]>([]);
  const [compteGithub, setCompteGithub] = React.useState<string | undefined>();
  const [depotsErreur, setDepotsErreur] = React.useState<string | undefined>();
  const [depotsCharges, setDepotsCharges] = React.useState(false);
  const [chercheDepot, setChercheDepot] = React.useState('');
  const [lienGithub, setLienGithub] = React.useState('');
  const [ghSousDomaine, setGhSousDomaine] = React.useState('');
  const [ghPort, setGhPort] = React.useState('');
  /* Les deux mêmes descriptions de mise en ligne : les deux chemins d'arrivée
     dans l'application offrent la même chose. */
  const [montageGithub, setMontageGithub] = React.useState<MontageSuivi | null>(null);
  const [erreurGithub, setErreurGithub] = React.useState<ErreurDeMontage | null>(null);

  const [newName, setNewName] = React.useState('');
  const [newFolder, setNewFolder] = React.useState('');
  const [newRemote, setNewRemote] = React.useState('');
  const [newResume, setNewResume] = React.useState('');
  const [withGit, setWithGit] = React.useState(true);
  const [withGithub, setWithGithub] = React.useState(true);
  /* « Démarrer par un cahier des charges » : cochée d'office pour un projet
     VIDE, décochée pour un dépôt importé, qui contient souvent déjà une
     application (`caseCahierCocheeParDefaut`). */
  const [withCahier, setWithCahier] = React.useState(caseCahierCocheeParDefaut('vide'));
  const [ghCahier, setGhCahier] = React.useState(caseCahierCocheeParDefaut('github'));
  /* LE PRODUIT À CLONER (facultatif) : un lien ou un nom. Rempli, il coche le
     cahier des charges, qui part alors de cette source (`shared/src/clonage.ts`). */
  const [newSource, setNewSource] = React.useState('');
  /* LE CLONAGE EST UN CHEMIN À PART : seul le chemin « source » envoie le lien,
     et il force le cahier des charges. Une saisie faite là ne fuit jamais dans
     un « Nouveau projet ». */
  const avecSource = chemin === 'source';
  /* L'adresse publique se demande ICI, au montage : un projet monté sans elle
     est un projet dont le déploiement n'a rien à contrôler à la fin. */
  const [newSousDomaine, setNewSousDomaine] = React.useState('');
  const [newPort, setNewPort] = React.useState('');
  /* CE QUE L'UTILISATEUR DIT DE SA MISE EN LIGNE, demandé ICI parce que c'est
     le seul moment où il y pense : où ça part, et selon quelles consignes. Les
     deux sont FACULTATIFS — vides, le projet se monte exactement comme avant —
     et se relisent ensuite dans les réglages du projet. */
  /* Le déroulé du montage : on le garde à l'écran après coup, sinon une étape
     ratée passerait dans un message qui s'efface tout seul. */
  const [montage, setMontage] = React.useState<MontageSuivi | null>(null);
  const [erreurMontage, setErreurMontage] = React.useState<ErreurDeMontage | null>(null);
  /* L'AVANCÉE POUSSÉE PAR LE DÉMON : seul le montage lancé ICI, et pas encore
     fini, prend l'état reçu — une autre création (autre onglet) n'y touche pas. */
  React.useEffect(() => {
    const recevoir = (evenement: Event) => {
      const recu = (evenement as CustomEvent<{ suivi: string; etapes: Etape[]; enCours?: string }>).detail;
      if (!recu?.suivi) return;
      const avancer = (courant: MontageSuivi | null) =>
        courant && !courant.fini && courant.suivi === recu.suivi ? { ...courant, etapes: recu.etapes, enCours: recu.enCours } : courant;
      setMontage(avancer);
      setMontageGithub(avancer);
    };
    window.addEventListener(EVENEMENT_MONTAGE, recevoir);
    return () => window.removeEventListener(EVENEMENT_MONTAGE, recevoir);
  }, []);
  /* PENDANT UN MONTAGE, LE DÉROULÉ PREND LA PLACE DU FORMULAIRE — et la flèche
     de retour au choix disparaît : on ne change pas de chemin en plein montage. Fermer la
     fenêtre n'arrête rien côté démon. */
  const enMontage = !!montage || !!montageGithub;
  /* CHAQUE OUVERTURE REPART DE L'ÉCRAN DE CHOIX — sauf pendant un montage, dont
     le déroulé doit rester sous les yeux. */
  React.useEffect(() => {
    if (open && !enMontage) setChemin(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  React.useEffect(() => {
    if (!open) return;
    setLoading(true);
    client
      .call<{ found: Found[] }>({ type: 'project.scan' })
      .then((data) => setFound(data.found ?? []))
      .catch(() => setFound([]))
      .finally(() => setLoading(false));
  }, [open]);

  const addExisting = async (entry: Found) => {
    setBusy(entry.path);
    try {
      const data = await client.call<{ project: { id: string } }>({
        type: 'project.create',
        name: entry.name,
        path: entry.path,
      });
      setFound((current) => current.filter((f) => f.path !== entry.path));
      client.pushToast('success', t('« {v0} » ajouté', { v0: entry.name }));
      onClose();
      entrerDansLeProjet(data.project.id, undefined, false);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'inscription impossible');
    } finally {
      setBusy(null);
    }
  };

  const createNew = async () => {
    if (!newName.trim() || (avecSource && !newSource.trim())) return;
    setBusy('new');
    /* La liste PRÉVUE paraît dès le clic, sa première étape en train de tourner :
       on voit tout de suite ce qui va se faire, et ce qui se fait. */
    const suivi = nouveauSuivi();
    const prevues = etapesPrevuesDuMontageNeuf({
      git: withGit,
      gitRemote: newRemote,
      github: withGithub,
      sousDomaine: newSousDomaine,
      port: newPort || undefined,
      cahier: withCahier || avecSource,
    });
    setErreurMontage(null);
    setMontage({ suivi, prevues, etapes: [], enCours: prevues[0], fini: false });
    try {
      const data = await client.call<{ project: { id: string }; etapes?: Etape[]; cahierCardId?: string }>(
        {
          type: 'project.new',
          suivi,
          name: newName.trim(),
          folder: newFolder.trim() || undefined,
          description: newResume.trim() || undefined,
          git: withGit,
          gitRemote: newRemote.trim() || undefined,
          github: withGithub,
          sousDomaine: newSousDomaine.trim() || undefined,
          port: newPort ? Number(newPort) : undefined,
          cahierDesCharges: withCahier || avecSource,
          source: avecSource ? newSource.trim() : undefined,
        },
        /* La création de l'adresse attend que le nom soit visible sur Internet :
           le montage peut donc durer plus longtemps qu'avant. */
        300000,
      );
      /* UNE ÉTAPE RATÉE RAMÈNE LE FORMULAIRE, champs gardés, avec le message
         qui dit laquelle, pourquoi, et que le projet existe déjà. Sinon la
         fenêtre se referme et l'on arrive dans le projet, sur sa carte du cahier. */
      const echec = erreurDuMontagePartiel(data.etapes ?? [], false);
      if (echec) {
        setMontage((courant) => (courant?.suivi === suivi ? null : courant));
        setErreurMontage(echec);
        client.setActiveProject(data.project.id);
        return;
      }
      setMontage((courant) => (courant?.suivi === suivi ? { ...courant, etapes: data.etapes ?? [], enCours: undefined, fini: true } : courant));
      // Un instant pour voir la dernière coche, puis on entre dans le projet.
      await new Promise((resolve) => window.setTimeout(resolve, 600));
      onClose();
      entrerDansLeProjet(data.project.id, data.cahierCardId, withCahier || avecSource);
      setNewName('');
      setNewFolder('');
      setNewRemote('');
      setNewResume('');
      setNewSousDomaine('');
      setNewPort('');
      setNewSource('');
      setMontage((courant) => (courant?.suivi === suivi ? null : courant));
    } catch (err: any) {
      // Refusé avant tout montage (dossier déjà là, port pris), ou resté sans réponse : le formulaire revient avec la raison.
      setMontage((courant) => (courant?.suivi === suivi ? null : courant));
      setErreurMontage(erreurDuMontageRefuse(err, false));
    } finally {
      setBusy(null);
    }
  };

  /*
   * Les dépôts du compte ne se demandent qu'au CHOIX du chemin GitHub : les
   * lister appelle GitHub, et personne ne veut payer cet appel pour ouvrir la
   * fenêtre sur un autre chemin.
   */
  React.useEffect(() => {
    if (!open || chemin !== 'github' || depotsCharges) return;
    setDepotsCharges(true);
    setLoading(true);
    client
      .call<{ depots?: DepotDuCompte[]; compte?: string; erreur?: string }>({ type: 'github.depots' }, 60000)
      .then((data) => {
        setDepots(data.depots ?? []);
        setCompteGithub(data.compte);
        setDepotsErreur(data.erreur);
      })
      .catch((err: any) => setDepotsErreur(err?.message ?? t('les dépôts GitHub sont illisibles')))
      .finally(() => setLoading(false));
  }, [open, chemin, depotsCharges]);

  /** Le seul chemin d'ajout : le lien lu, l'adresse demandée, puis le montage. */
  const ajouterDepuisGithub = async (lien: string, cle: string) => {
    const lu = lireLienGithub(lien);
    if (!lu.ok || !lu.depot) {
      client.pushToast('error', lu.erreur ?? 'lien illisible');
      return;
    }
    setBusy(cle);
    const suivi = nouveauSuivi();
    const prevues = etapesPrevuesDepuisGithub({ sousDomaine: ghSousDomaine, port: ghPort || undefined, cahier: ghCahier });
    setErreurGithub(null);
    setMontageGithub({ suivi, prevues, etapes: [], enCours: prevues[0], fini: false });
    try {
      const data = await client.call<{ project: { id: string }; etapes?: Etape[]; cahierCardId?: string }>(
        {
          type: 'project.fromGithub',
          suivi,
          lien: lu.depot.slug,
          sousDomaine: ghSousDomaine.trim() || undefined,
          port: ghPort ? Number(ghPort) : undefined,
          cahierDesCharges: ghCahier,
        },
        /* Récupérer un dépôt puis créer son adresse peut durer : on laisse le
           temps du clone, sinon un gros dépôt passerait pour une panne. */
        600000,
      );
      // Le dépôt est inscrit, même si une étape a raté : il ne se propose plus.
      setDepots((current) => current.filter((depot) => depot.slug !== lu.depot!.slug));
      /* Une étape ratée ramène le formulaire, avec le message qui l'explique. */
      const echec = erreurDuMontagePartiel(data.etapes ?? [], true);
      if (echec) {
        setMontageGithub((courant) => (courant?.suivi === suivi ? null : courant));
        setErreurGithub(echec);
        client.setActiveProject(data.project.id);
        return;
      }
      setMontageGithub((courant) =>
        courant?.suivi === suivi ? { ...courant, etapes: data.etapes ?? [], enCours: undefined, fini: true } : courant,
      );
      await new Promise((resolve) => window.setTimeout(resolve, 600));
      onClose();
      entrerDansLeProjet(data.project.id, data.cahierCardId, ghCahier);
      setLienGithub('');
      setGhSousDomaine('');
      setGhPort('');
      setMontageGithub((courant) => (courant?.suivi === suivi ? null : courant));
    } catch (err: any) {
      setMontageGithub((courant) => (courant?.suivi === suivi ? null : courant));
      setErreurGithub(erreurDuMontageRefuse(err, true));
    } finally {
      setBusy(null);
    }
  };

  const visible = filter ? found.filter((entry) => entry.name.toLowerCase().includes(filter.toLowerCase())) : found;
  const depotsVisibles = filtrerDepots(depots, chercheDepot);

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="sm:w-[min(640px,100%)]" adresse={adresse} data-projets-du-serveur data-chemin-choisi={chemin ?? ''}>
        <DialogHeader
          /* LA FLÈCHE RAMÈNE À L'ÉCRAN DE CHOIX — absente pendant un montage :
             on ne quitte pas un chemin dont le déroulé tourne. */
          gauche={
            chemin && !enMontage ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Revenir au choix"
                title={t('Revenir au choix')}
                onClick={() => setChemin(null)}
                data-retour-au-choix
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            ) : null
          }
        >
          <DialogTitle className="min-w-0 truncate">{chemin ? titreDuChemin(chemin) : t('Projets du serveur')}</DialogTitle>
        </DialogHeader>

        {chemin === null ? <ChoixDuChemin onChoisir={setChemin} /> : null}

        {chemin === 'existing' ? (
          <div className="mt-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-faint" />
              <Input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={t('Chercher un projet…')}
                className="pl-7"
              />
            </div>

            {loading ? (
              <p className="mt-3 flex items-center gap-1.5 text-[13.5px] text-faint">
                <Loader2 className="h-3 w-3 animate-spin" />  {t('Lecture des dossiers du serveur…')}
</p>
            ) : visible.length ? (
              <>
                <p className="mt-2 text-[12.5px] text-faint">
                  {t('{v0} projet{v1} trouvé{v2} et pas encore suivi{v3}.', { v0: visible.length, v1: visible.length > 1 ? 's' : '', v2: visible.length > 1 ? 's' : '', v3: visible.length > 1 ? 's' : '' })}</p>
                <ZoneDefilement classeEnveloppe="mt-1.5 max-h-[340px] flex-none" className="space-y-0.5">
                  {visible.map((entry) => (
                    <div
                      key={entry.path}
                      className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1.5"
                    >
                      <Folder className="h-3 w-3 shrink-0 text-faint" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] text-text">{entry.name}</p>
                        <p className="truncate text-[11.5px] text-faint">
                          {entry.path}
                          {entry.git ? t(' · suivi par git') : ''}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === entry.path}
                        onClick={() => addExisting(entry)}
                      >
                        {busy === entry.path ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                        
{t('Suivre')}
</Button>
                    </div>
                  ))}
                </ZoneDefilement>
              </>
            ) : (
              <p className="mt-3 text-[13.5px] text-faint">{t('Tous les projets du serveur sont déjà dans votre liste.')}</p>
            )}
          </div>
        ) : null}

        {chemin === 'github' ? (
          <div className="mt-3 space-y-2.5">
            {montageGithub ? (
              <DerouleDesEtapes lignes={lignesDuMontageSuivi(montageGithub)} />
            ) : (
              <>
                {erreurGithub ? <MessageDErreurDeMontage erreur={erreurGithub} /> : null}
                {/* L'adresse publique se demande AVANT le montage, ici comme pour un projet neuf. */}
                <div data-adresse-depuis-github>
                  <div className="flex items-center gap-1">
                    <Label>{t('Adresse publique du projet (facultatif)')}</Label>
                    <BulleInfo cote="start">
                      {t('Le nom et le port sur lequel le projet écoutera. Ils sont demandés avant le montage : c\'est cette adresse qui sera contrôlée à la fin de chaque déploiement. Laissés vides, le projet est ajouté sans adresse.')}
                    </BulleInfo>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <Input
                      value={ghSousDomaine}
                      onChange={(event) => setGhSousDomaine(event.target.value)}
                      placeholder="nom-du-site"
                      className="flex-1"
                      data-sous-domaine-github
                    />
                    <span className="shrink-0 text-[12.5px] text-faint" data-zone-des-projets>.{zoneDesProjets() || t('domaine à régler')}</span>
                    <Input
                      value={ghPort}
                      onChange={(event) => setGhPort(event.target.value.replace(/[^0-9]/g, ''))}
                      placeholder="port"
                      className="w-[74px]"
                      data-port-github
                    />
                  </div>
                </div>


                <div className="border-t border-border pt-2.5">
                  <Label>{t('Vos dépôts GitHub{v0}', { v0: compteGithub ? ` (compte ${compteGithub})` : '' })}</Label>
                  <div className="relative mt-1">
                    <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-faint" />
                    <Input
                      value={chercheDepot}
                      onChange={(event) => setChercheDepot(event.target.value)}
                      placeholder={t('Chercher un dépôt…')}
                      className="pl-7"
                      data-recherche-depot
                    />
                  </div>

                  {loading && !depots.length ? (
                    <p className="mt-2 flex items-center gap-1.5 text-[13.5px] text-faint">
                      <Loader2 className="h-3 w-3 animate-spin" />  {t('Lecture des dépôts du compte GitHub…')}
    </p>
                  ) : depotsErreur ? (
                    <p className="mt-2 text-[13px] text-danger">{depotsErreur}</p>
                  ) : depotsVisibles.length ? (
                    <ZoneDefilement classeEnveloppe="mt-1.5 max-h-[220px] flex-none" className="space-y-0.5">
                      {depotsVisibles.map((depot) => (
                        <div
                          key={depot.slug}
                          className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1.5"
                          data-depot-github={depot.slug}
                        >
                          <Github className="h-3 w-3 shrink-0 text-faint" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[14px] text-text">{depot.slug}</p>
                            <p className="truncate text-[11.5px] text-faint">
                              {depot.prive ? t('privé') : 'public'}
                              {depot.vide ? t(' · vide') : ''}
                              {depot.description ? ` · ${depot.description}` : ''}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy === depot.slug || depot.vide}
                            sansAttente
                            onClick={() => ajouterDepuisGithub(depot.slug, depot.slug)}
                          >
                            {busy === depot.slug ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Plus className="h-3 w-3" />
                            )}
                        
    {t('Ajouter')}
    </Button>
                        </div>
                      ))}
                    </ZoneDefilement>
                  ) : (
                    <p className="mt-2 text-[13.5px] text-faint">
                      {depots.length ? t('Aucun dépôt ne correspond à cette recherche.') : t('Aucun dépôt trouvé sur ce compte.')}
                    </p>
                  )}
                </div>

                <div className="border-t border-border pt-2.5">
                  <div className="flex items-center gap-1">
                    <Label>{t('Ou collez le lien d\'un dépôt')}</Label>
                    <BulleInfo cote="start">
                      {t('Pour un dépôt qui n\'appartient pas à ce compte. Le dépôt est récupéré sur le serveur et le projet apparaît dans la liste de gauche. Rien n\'est publié ni mis en ligne au passage.')}
                    </BulleInfo>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <Input
                      value={lienGithub}
                      onChange={(event) => setLienGithub(event.target.value)}
                      placeholder="https://github.com/compte/depot"
                      className="flex-1"
                      data-lien-github
                    />
                    <Button
                      size="sm"
                      variant="default"
                      disabled={!lienGithub.trim() || busy === 'lien'}
                      sansAttente
                      onClick={() => ajouterDepuisGithub(lienGithub, 'lien')}
                    >
                      {busy === 'lien' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                  
    {t('Ajouter')}
    </Button>
                  </div>
                </div>

                <label className="flex items-center gap-2 text-[14px] text-muted" data-case-cahier="github">
                  <Switch checked={ghCahier} onCheckedChange={setGhCahier} />
                  <span>{t('Démarrer par un cahier des charges')}</span>
                </label>
              </>
            )}
          </div>
        ) : null}

        {chemin === 'new' || chemin === 'source' ? (
          <div className="mt-3 space-y-2.5">
            {montage ? (
              <DerouleDesEtapes lignes={lignesDuMontageSuivi(montage)} />
            ) : (
              <>
                {erreurMontage ? <MessageDErreurDeMontage erreur={erreurMontage} /> : null}
                <FormulaireEnColonnes>
                  {/* LE PRODUIT EXISTANT VIENT EN PREMIER, et il est obligatoire :
                      c'est lui qui fait de ce chemin un clonage. */}
                  {avecSource ? (
                    <LigneFormulaire
                      libelle={t('Lien ou nom du produit')}
                      aide={t('Le lien ou le nom d\'un site, d\'un SaaS, d\'une application ou d\'un jeu existant. Beluga vous demandera si vous voulez un vrai clone ou vous en inspirer, l\'analysera puis rédigera le cahier des charges à partir de ce qu\'il a trouvé. Un fichier (APK, captures) se joint à la première question.')}
                    >
                      <Input
                        value={newSource}
                        onChange={(event) => setNewSource(event.target.value)}
                        placeholder="https://…"
                        autoFocus
                        data-source-a-cloner
                      />
                    </LigneFormulaire>
                  ) : null}
                  <LigneFormulaire libelle={t('Nom du projet')}>
                    <Input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder={t('Mon nouveau site')} autoFocus={!avecSource} />
                  </LigneFormulaire>
                  <LigneFormulaire libelle={t('Nom du dossier (facultatif)')}>
                    <Input value={newFolder} onChange={(event) => setNewFolder(event.target.value)} placeholder={t('déduit du nom')} />
                  </LigneFormulaire>
                  <LigneFormulaire
                    libelle={t('En une phrase, à quoi sert ce projet ? (facultatif)')}
                    aide={t('Cette phrase ouvre la documentation du projet et décrit le dépôt sur GitHub.')}
                  >
                    <Input value={newResume} onChange={(event) => setNewResume(event.target.value)} placeholder={t('Le site vitrine de l\'atelier')} />
                  </LigneFormulaire>
                  {/* L'adresse publique : demandée ici, créée pendant le montage. */}
                  <LigneFormulaire
                    libelle={t('Adresse publique du projet (facultatif)')}
                    aide={t('Le nom et le port sur lequel le projet écoutera. Beluga Build crée l\'adresse pendant le montage : c\'est elle qui sera contrôlée à la fin de chaque déploiement. Laissés vides, le projet est monté sans adresse.')}
                    data-adresse-nouveau-projet
                  >
                    <div className="flex items-center gap-1.5">
                      <Input
                        value={newSousDomaine}
                        onChange={(event) => setNewSousDomaine(event.target.value)}
                        placeholder="nom-du-site"
                        className="flex-1"
                        data-sous-domaine
                      />
                      <span className="shrink-0 text-[12.5px] text-faint" data-zone-des-projets>.{zoneDesProjets() || t('domaine à régler')}</span>
                      <Input
                        value={newPort}
                        onChange={(event) => setNewPort(event.target.value.replace(/[^0-9]/g, ''))}
                        placeholder="port"
                        className="w-[74px]"
                        data-port-projet
                      />
                    </div>
                  </LigneFormulaire>
                  {/* Les deux descriptions de mise en ligne, juste après l'adresse :
                      c'est le moment où l'on pense à où le projet va vivre. */}
                  <LigneFormulaire libelle={t('Dépôt distant existant (facultatif)')}>
                    <Input value={newRemote} onChange={(event) => setNewRemote(event.target.value)} placeholder={t('laisser vide pour en créer un sur GitHub')} />
                  </LigneFormulaire>
                </FormulaireEnColonnes>
                <label className="flex items-center gap-2 text-[14px] text-muted">
                  <Switch checked={withGit} onCheckedChange={setWithGit} />
              
    {t('Démarrer un dépôt git dans le dossier')}
    </label>
                <label className="flex items-center gap-2 text-[14px] text-muted">
                  <Switch
                    checked={withGithub && withGit && !newRemote.trim()}
                    disabled={!withGit || !!newRemote.trim()}
                    onCheckedChange={setWithGithub}
                  />
              
    {t('Créer aussi le dépôt privé sur GitHub')}
    </label>
                <label className="flex items-center gap-2 text-[14px] text-muted" data-case-cahier="vide">
                  <Switch checked={withCahier || avecSource} disabled={avecSource} onCheckedChange={setWithCahier} />
                  <span>{t('Démarrer par un cahier des charges')}</span>
                  <BulleInfo cote="start">
                    {t('Une carte « Cahier des charges » apparaît dans le projet : son agent vous pose les questions une à une, rédige le cahier des charges sous vos yeux, puis le plan de construction. On peut le mettre en pause et le reprendre plus tard.')}
                  </BulleInfo>
                </label>

                <div className="flex items-center gap-1.5">
                  {/* Le bouton porte SA propre attente, sans l'avertissement commun
                      « … prend plus de temps que prévu » : la liste dit ce qui se fait. */}
                  <Button variant="default" size="sm" disabled={!newName.trim() || (avecSource && !newSource.trim()) || busy === 'new'} sansAttente onClick={createNew}>
                    {busy === 'new' ? <Loader2 className="h-3 w-3 animate-spin" /> : <FolderPlus className="h-3 w-3" />}
                    {t('Créer le projet')}
                  </Button>
                  <BulleInfo cote="start">
                    {t('Le dossier est créé pour de vrai sur le serveur, sur la branche « main », avec les fichiers d\'instructions des moteurs, la mémoire, l\'historique et une documentation de départ. Le projet apparaît ensuite dans la liste de gauche.')}
                  </BulleInfo>
                </div>
              </>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * LA PASTILLE DES SITES EN PANNE. Les mêmes couleurs que l'étiquette « danger »
 * de l'interface : lisibles dans les douze palettes, sans jeton posé à la main.
 * Seule la ligne « Surveillance » porte le repère `data-surveillance-pastille` ;
 * le bouton compact la redit sans le doubler.
 */
