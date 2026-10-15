import * as React from 'react';
import { appliquerTiroirs, oublierLAttenteSiEcranChange, usePileDeTiroirs, useTiroirAdresse } from '@/lib/tiroirs-adresse';
import { LayoutGrid, Loader2, Plus } from 'lucide-react';
import { BandeauMiseAJour } from '@/components/bandeau-mise-a-jour';
import { BandeauConnexionLente } from '@/components/bandeau-connexion-lente';
import { TooltipProvider, Button, CibleDuBasDePage, EnteteDePageParDefaut, SidePanel, defilerDepuisLesMarges } from '@/components/ui';
import { BoutonPremierProjet, PasAPas } from '@/components/pas-a-pas';
import { VisiteGuidee } from '@/components/visite-guidee';
import { BoutonOptionsDuProjet, MenuGeneral, useEtatDeLiaison } from '@/components/quota-bar';
import { TerminalDeLApplication } from '@/components/terminal-de-l-application';
import { ClocheNotifications } from '@/components/notifications';
import { BoutonDesServices } from '@/components/services';
import { useTelephone } from '@/lib/telephone';
import { Sidebar } from '@/components/sidebar';
import {
  EnteteDePage,
  EnteteDeZone,
  FournirLaCibleDesGestes,
  FournirLaSuiteDuFil,
  CLASSE_CIBLE_DES_GESTES,
  FournirLeLieu,
  FournirLeMenuPrincipal,
  type CranDuChemin,
  type ReperesDeRetour,
} from '@/components/entete-de-zone';
import { FournirLaColonneDeService, type NiveauDeColonne } from '@/components/colonne-de-service';
import { TiroirProjets } from '@/components/tiroir-projets';
import { MenuDesProjets } from '@/components/menu-des-projets';
import { Board } from '@/components/board';
import {
  SilhouetteCoffre,
  SilhouetteEspaceHaiko,
  SilhouetteNotes,
  SilhouetteBackups,
  SilhouetteSurveillance,
  SilhouetteMarketing,
  SilhouetteStudio,
  SilhouetteStatistiques,
  SilhouetteTableau,
  SilhouetteEnRoute,
  SilhouetteResume,
} from '@/components/silhouettes';
import { Toasts } from '@/components/toasts';
import { PanneauALaDemande, prechargerAuRepos } from '@/lib/panneau-a-la-demande';
import { useResizable, ResizeHandle } from '@/components/resizer';
import type { VueFichiers } from '@/components/right-panel';
import { abonnerAuxNotifications } from '@/lib/abonnement-push';
import { client } from '@/lib/client';
import { lieuDuServiceDeLaCarte, serviceDeLaCarteALEcran } from '@/lib/service-de-carte';
import { lancerIntervalleVisible } from '@/lib/veille';
import { usePref, writePref } from '@/lib/prefs';
import { useThemeApplique } from '@/lib/theme';
import { useApp } from '@/lib/use-app';
import { Filet } from '@/components/filet';
import { TiroirNouvelAgent, creerCarteAgent } from '@/components/tiroir-nouvel-agent';
import { cn } from '@/lib/utils';
import {
  CLE_ONGLET_MOBILE,
  carteAReprendre,
  cleCarteOuverte,
  construireFragment,
  destinationDeLEcran,
  ecranDeLaVue,
  elementViseDeLEcran,
  imageDeLAlerte,
  lireFragment,
  memeEcran,
  memeTiroirs,
  ongletAReprendre,
  assistantNecessaire,
  assistantDeDemarrageOuvert,
  Card,
  menuBasTelephone,
  carteVisibleSurLaVue,
  carteARefermerSurChoixDeVue,
  gestesGeles,
  RAISON_CANAL_COUPE,
  TITRE_CARTE_DE_CADRAGE,
  titreEnConstruction,
  type EcranNavigateur,
  type ElementVise,
  type LieuDeService,
  type VueCentrale,
  totalDesRendus,
  RUBRIQUE_CONFIG_PAR_DEFAUT,
  etapeDeLAgentDeConfiguration,
  voletDeLAgentDePublication,
} from '@beluga/shared';
import {
  EVENEMENT_AGENT_CONFIGURATION,
  EVENEMENT_CONFIG_PROJET,
  ouvrirAgentDeConfiguration,
  ouvrirRubriqueDeLEtape,
  type DemandeDAgentDeConfiguration,
  type DemandeDeConfig,
} from '@/lib/ouvrir-config-projet';
import { t, useLangueAppliquee } from '@/lib/langue';
import { EVENEMENT_OUVRIR_COFFRE } from '@/lib/ouvrir-coffre';
import { VisionneuseDeLien } from '@/components/visionneuse-de-lien';

/*
 * LES ÉCRANS QU'ON OUVRE PAR UN BOUTON SONT DES MORCEAUX À PART
 * (`web/src/lib/panneau-a-la-demande.tsx`). Aucun d'eux ne sert au premier
 * affichage — colonne de gauche et tableau —, et tous ensemble ils pesaient
 * plus du tiers du fichier téléchargé au démarrage.
 */
const chargerTableauDeBord = () => import('@/components/dashboard');
const chargerPageNotes = () => import('@/components/notes-page');
const chargerCoffreFort = () => import('@/components/coffre-fort');
/*
 * L'ESPACE CLIENT VU COMME HAIKO est un morceau à part, comme la porte servie
 * aux clients : c'est un écran qu'on ouvre de temps à autre, il n'a pas à
 * peser sur le premier affichage du tableau.
 */
const chargerEspaceHaiko = () => import('@/espace/espace-haiko');
const chargerBackups = () => import('@/components/backups');
const chargerSurveillance = () => import('@/components/surveillance');
const chargerMarketing = () => import('@/components/marketing');
const chargerStudio = () => import('@/components/studio/studio');
const chargerStatistiques = () => import('@/components/statistiques');
/*
 * LA PAGE « EN ROUTE » : ouverte par le bouton des agents, et montrée quand
 * aucun projet n'est ouvert. Un morceau à part comme les autres destinations.
 */
const chargerEnRoute = () => import('@/components/en-route');
const chargerTiroirCarte = () => import('@/components/card-panel');
const chargerReglages = () => import('@/components/settings-view');
/*
 * LA CONFIGURATION D'UN PROJET est une fenêtre à rubriques qu'on n'ouvre que
 * de temps à autre : son morceau n'a pas à peser sur le premier affichage du
 * tableau. Montée ICI, et une seule fois, parce que c'est ici que vit
 * l'adresse — elle seule peut écrire « #projet/<id>/config/<rubrique> ».
 */
const chargerConfigProjet = () => import('@/components/project-settings');
const chargerVoix = () => import('@/components/voix-assistant');
/*
 * L'ASSISTANT DE DÉMARRAGE ne sert QUE sur un serveur où aucun moteur ne
 * répond : sur toutes les autres ouvertures, son morceau n'a aucune raison
 * d'être téléchargé.
 */
const chargerAssistantMoteurs = () => import('@/components/assistant-moteurs');
const chargerAssistantDemarrage = () => import('@/components/assistant-demarrage');
/*
 * La CONVERSATION est le seul cas limite : sur un grand écran elle s'ouvre
 * d'entrée, sur téléphone elle attend son onglet. Elle emporte avec elle la
 * barre d'écriture et l'affichage des messages — le plus gros morceau après le
 * tableau — et le premier écran d'un téléphone est le TABLEAU. Elle part donc
 * elle aussi à part, et se précharge au repos.
 */
const chargerConversation = () => import('@/components/right-panel');

const TiroirFichiers = React.lazy(() => chargerConversation().then((m) => ({ default: m.TiroirFichiers })));

const Dashboard = React.lazy(() => chargerTableauDeBord().then((m) => ({ default: m.Dashboard })));
const NotesPage = React.lazy(() => chargerPageNotes().then((m) => ({ default: m.NotesPage })));
const CoffreFort = React.lazy(() => chargerCoffreFort().then((m) => ({ default: m.CoffreFort })));
const chargerMemoire = () => import('@/components/memoire-classeurs');
const MemoireClasseurs = React.lazy(() => chargerMemoire().then((m) => ({ default: m.MemoireClasseurs })));
const EspaceHaiko = React.lazy(() => chargerEspaceHaiko().then((m) => ({ default: m.EspaceHaiko })));
const Backups = React.lazy(() => chargerBackups().then((m) => ({ default: m.Backups })));
const Surveillance = React.lazy(() =>
  chargerSurveillance().then((m) => ({ default: m.Surveillance })),
);
const Marketing = React.lazy(() => chargerMarketing().then((m) => ({ default: m.Marketing })));
const Studio = React.lazy(() => chargerStudio().then((m) => ({ default: m.Studio })));
const Statistiques = React.lazy(() => chargerStatistiques().then((m) => ({ default: m.Statistiques })));
const EnRoute = React.lazy(() => chargerEnRoute().then((m) => ({ default: m.EnRoute })));
const CardPanel = React.lazy(() => chargerTiroirCarte().then((m) => ({ default: m.CardPanel })));
const SettingsView = React.lazy(() => chargerReglages().then((m) => ({ default: m.SettingsView })));
const TiroirAgentDeConfiguration = React.lazy(() =>
  import('@/components/config-projet/agent-de-configuration').then((m) => ({ default: m.TiroirAgentDeConfiguration })),
);
const ProjectSettings = React.lazy(() =>
  chargerConfigProjet().then((m) => ({ default: m.ProjectSettings })),
);
import { AssistantGlobal, BoutonAssistantEntete } from '@/components/assistant-global';
const VoixAssistant = React.lazy(() => chargerVoix().then((m) => ({ default: m.VoixAssistant })));
const AssistantDemarrage = React.lazy(() =>
  chargerAssistantDemarrage().then((m) => ({ default: m.AssistantDemarrage })),
);
const AssistantMoteurs = React.lazy(() =>
  chargerAssistantMoteurs().then((m) => ({ default: m.AssistantMoteurs })),
);

/**
 * LE CADRE D'UNE SILHOUETTE DE VUE CENTRALE, pendant que son morceau arrive.
 *
 * Les silhouettes ne portent aucune marge à elles : ce sont les écrans qui
 * posent les leurs. Le temps du téléchargement, l'écran n'existe pas encore —
 * ce cadre-ci tient donc sa place, avec les marges d'une vue centrale.
 */
function AttenteEcran({ children }: { children: React.ReactNode }) {
  return <div className="min-h-0 flex-1 overflow-hidden px-4 pt-6">{children}</div>;
}

/**
 * LE TITRE DE CHAQUE SERVICE dans le fil d'Ariane — les mêmes mots que ses
 * lignes dans la colonne de gauche. Des CLÉS du dictionnaire, passées à `t()`.
 */
/**
 * Les services qui posent leur menu dans la colonne de gauche, à la place des
 * projets. TOUS les services en ont un (demande du 12/10/2026 : « chaque
 * sidebar de chaque service doit être spécifique au service ») : la liste des
 * projets n'est plus jamais sous les yeux dans un service. Un service ajouté
 * ici DOIT écrire dans `ColonneDeService`, sinon sa colonne reste vide.
 */
const VUES_A_MENU: readonly VueCentrale[] = [
  'tableau-de-bord',
  'memoire',
  'notes',
  'marketing',
  'coffre',
  'statistiques',
  'espace-client',
  'backups',
  'surveillance',
  'studio',
];

const CLES_TITRE_DE_VUE: Record<Exclude<VueCentrale, 'projet' | 'en-route'>, string> = {
  'tableau-de-bord': 'Résumé',
  statistiques: 'Statistiques',
  coffre: 'Coffre-fort',
  memoire: 'Mémoire',
  'espace-client': 'Messagerie',
  backups: 'Backup',
  surveillance: 'Surveillance',
  marketing: 'Marketing',
  studio: 'Studio',
  notes: 'Notes',
};

/**
 * Les destinations de la barre du bas, sur téléphone. « Fichiers » n'en est
 * plus une : il ouvre le même tiroir que le menu des trois points. Un ancien
 * choix « chat » retenu en base retombe donc sur le tableau.
 */
const ONGLETS_MOBILES = ['board'] as const;
type OngletMobile = (typeof ONGLETS_MOBILES)[number];


/** La clé du serveur arrive en base64 « url » : le navigateur la veut en octets. */
export function App() {
  const state = useApp();
  /*
   * LE THÈME S'APPLIQUE DEPUIS LA RACINE, jamais depuis un panneau. Il était posé
   * par un effet du bandeau des quotas : sur téléphone, ce bandeau n'est pas
   * toujours monté, et les réglages qui portent maintenant le choix arrivent en
   * morceau séparé, à la demande. La racine, elle, est toujours là.
   *
   * C'est aussi le seul endroit qui voit les TROIS sources à la fois — le thème
   * du projet ouvert, le réglage général, celui de l'ordinateur —, donc le seul
   * qui puisse changer l'apparence de l'application ENTIÈRE quand on change de
   * projet.
   */
  useThemeApplique();
  /*
   * LA LANGUE SE POSE ICI AUSSI, ET POUR LA MÊME RAISON. `t` lit une variable de
   * module, tenue à jour par ce crochet PENDANT le rendu de la racine : tout ce
   * qui s'affiche en dessous — colonne de gauche, tableau, conversation,
   * fenêtres, panneaux chargés à la demande — voit donc la bonne langue au
   * PREMIER rendu, sans qu'aucun écran n'ait à s'abonner à quoi que ce soit.
   * Changer de langue rend la racine, donc rend tout l'arbre : aucun mot ne
   * reste en arrière.
   */
  useLangueAppliquee();
  const [openCardId, setOpenCardId] = React.useState<string | null>(null);
  /* La vue où la carte ouverte s'est ouverte : c'est elle qui dit sur quel
     écran la carte s'affiche (`carteVisibleSurLaVue`). Tenue ici, avant la
     lecture de l'adresse, parce que l'adresse d'un tableau de bord la pose. */
  const [carteOuverteSur, setCarteOuverteSur] = React.useState<{
    id: string;
    vue: VueCentrale;
    /* Le projet NOMMÉ par l'adresse qui l'a ouverte : tant que les cartes du
       serveur ne sont pas arrivées, c'est le seul qui le sache. */
    projectId?: string;
  } | null>(null);
  /* Lues par la lecture de l'adresse (un rappel sans dépendances) : les valeurs
     du dernier rendu, jamais celles de sa création. */
  const openCardIdRef = React.useRef(openCardId);
  openCardIdRef.current = openCardId;
  const carteOuverteSurRef = React.useRef(carteOuverteSur);
  carteOuverteSurRef.current = carteOuverteSur;
  /*
   * LA CARTE OUVERTE PAR LE BOUTON ROBO (menu du bas) n'existe VRAIMENT que si
   * quelque chose y a été saisi — un message envoyé, ou un brouillon en train
   * de s'écrire. `carteRobotIdRef` porte son identifiant tant qu'elle reste à
   * juger ; l'effet plus bas, déclenché à la FERMETURE du tiroir (un autre
   * `openCardId` prend sa place, ou il retombe à `null`), la supprime si elle
   * est restée vide. `state` est lu par une référence tenue à jour à chaque
   * rendu : l'effet ne se réabonne qu'au changement d'`openCardId`, jamais à
   * chaque frappe dans le brouillon.
   */
  const carteRobotIdRef = React.useRef<string | null>(null);
  /* Le volet « Nouvel agent » du tableau de bord (barre du bas, téléphone). */
  const [tiroirNouvelAgent, setTiroirNouvelAgent] = React.useState(false);
  useTiroirAdresse('nouvel-agent', tiroirNouvelAgent, setTiroirNouvelAgent);
  const stateRef = React.useRef(state);
  stateRef.current = state;
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const fermerLesReglages = React.useCallback(() => setSettingsOpen(false), []);
  /* LA SOUS-PAGE DES RÉGLAGES vit dans l'adresse, comme la carte ouverte : les
     réglages sont un menu de pages, un lien doit pouvoir en désigner une. */
  const [settingsPage, setSettingsPage] = React.useState<string | undefined>(undefined);
  /* UN ÉCRAN PEUT OUVRIR LES RÉGLAGES SUR UNE RUBRIQUE (`beluga:ouvrir-reglages`,
     détail `{ page }`) — l'encadré du Studio mène ainsi à « Services de création ». */
  React.useEffect(() => {
    const ouvrir = (event: Event) => {
      const page = (event as CustomEvent<{ page?: string }>).detail?.page;
      if (page) setSettingsPage(page);
      setSettingsOpen(true);
    };
    window.addEventListener('beluga:ouvrir-reglages', ouvrir);
    return () => window.removeEventListener('beluga:ouvrir-reglages', ouvrir);
  }, []);
  /*
   * LA CONFIGURATION D'UN PROJET, ET LA RUBRIQUE OUVERTE DEDANS.
   *
   * Même nature que les réglages généraux : une couche posée PAR-DESSUS
   * l'écran en cours, dont l'adresse porte le projet ET la rubrique. Elle vit
   * ici et non dans la colonne de gauche, parce que trois endroits l'ouvrent —
   * la ligne du projet, la tête de « À déployer », le bandeau de production —
   * et qu'il n'en faut qu'UNE à l'écran.
   */
  const [configProjetId, setConfigProjetId] = React.useState<string | null>(null);
  const [configRubrique, setConfigRubrique] = React.useState<string | undefined>(undefined);
  /*
   * UNE SEULE VUE CENTRALE À LA FOIS (`shared/src/vue-centrale.ts`).
   *
   * La colonne de gauche est une liste PLATE de destinations : tableau de bord,
   * coffre-fort, backups, surveillance, notes, puis les projets. Cliquer
   * l'une d'elles REMPLACE le contenu du volet central — rien ne se pose plus
   * par-dessus, il n'y a donc plus de croix à trouver pour revenir. Les deux
   * anciens interrupteurs (tableau de bord, notes) sont conservés comme
   * RACCOURCIS de lecture : tout le code qui les appelait continue de marcher.
   */
  const [vueCentrale, setVueCentrale] = React.useState<VueCentrale>('projet');
  /*
   * LE STUDIO EST FERMÉ À QUI N'EST PAS SUPER ADMINISTRATEUR : une adresse
   * « #studio », une vue gardée, le clic sur la carte d'un agent de volet ou un
   * lien le ramenaient à un écran que le démon refuse. Dès que l'état complet
   * est là — jamais avant : le droit n'est pas encore connu —, on retombe sur le
   * tableau. Un seul endroit pour tous ces chemins.
   */
  React.useEffect(() => {
    if (state.pret && !state.studioOuvert && vueCentrale === 'studio') {
      setVueCentrale('projet');
      setElementVise({});
    }
  }, [state.pret, state.studioOuvert, vueCentrale]);
  /*
   * LA FICHE DÉSIGNÉE PAR L'ADRESSE, dans l'espace client : le lien porté par
   * le point quotidien envoyé à Haiko. Il ouvre l'écran sur le bon client ET la
   * bonne demande, prêt à répondre.
   */
  const [espaceVise, setEspaceVise] = React.useState<{ clientId?: string; demandeId?: string } | undefined>();
  /*
   * L'ÉLÉMENT OUVERT DANS CHAQUE SERVICE — une fiche du coffre, une note, une
   * unité de mémoire, un site surveillé ou sauvegardé.
   *
   * Un seul état pour les six : c'est lui que l'adresse décrit, et lui que
   * l'adresse repose au chargement. Il va dans les DEUX sens — le service le
   * reçoit (`vise`) pour rouvrir ce qu'un lien désigne, et le remonte
   * (`onVise`) dès qu'on ouvre autre chose, pour que l'adresse ne mente
   * jamais sur ce qui est à l'écran. Changer de destination l'efface : chaque
   * service est démonté en quittant, son élément ouvert n'a pas à survivre.
   */
  const [elementVise, setElementVise] = React.useState<ElementVise>({});
  /* L'onglet affiché dans la carte ouverte. « chat » est le défaut et ne
     s'écrit pas dans l'adresse (`ONGLET_DE_CARTE_PAR_DEFAUT`). */
  const [ongletCarte, setOngletCarte] = React.useState<string | null>(null);
  const dashboardOpen = vueCentrale === 'tableau-de-bord';
  /* Les écrans qui ne sont dans AUCUN projet : le menu du bas y propose
     « Nouvel agent » au lieu de Tableau / Fichiers. */
  const horsProjet =
    dashboardOpen || vueCentrale === 'en-route' || (vueCentrale === 'projet' && !state.activeProjectId);
  /* LE BAS DE L'ÉCRAN DU TÉLÉPHONE NE PORTE QU'UN BOUTON : « Nouvelle tâche »
     dans un projet, « Nouvel agent » sur les tableaux de bord, et sur un
     service le geste principal que la page affichée y pose elle-même
     (`menuBasTelephone`, `GestePrincipal`). */
  const menuBas = menuBasTelephone(vueCentrale, !!state.activeProjectId);
  /* LA BANDE DU BAS, PRÊTÉE À LA PAGE D'UN SERVICE : son emplacement, connu une
     fois montée. */
  const [cibleDuBas, setCibleDuBas] = React.useState<HTMLElement | null>(null);
  const basDePage = React.useMemo(() => (menuBas === 'geste-de-page' ? { cible: cibleDuBas } : null), [menuBas, cibleDuBas]);
  /* LES FICHIERS ET LES PIÈCES JOINTES S'OUVRENT EN TIROIR, depuis le menu
     des trois points ou le bouton « Fichiers » du bas du téléphone. L'ancien
     volet de droite, son bouton et sa largeur retenue ont disparu. */
  const [tiroirFichiers, setTiroirFichiers] = React.useState<VueFichiers | null>(null);
  /* LES FICHIERS ET LES PIÈCES JOINTES ONT LEUR ADRESSE (« …/volet/pieces-jointes ») :
     les ouvrir change l'adresse, Précédent les referme, un lien collé les rouvre. */
  useTiroirAdresse('fichiers', tiroirFichiers === 'fichiers', (ouvert) => setTiroirFichiers(ouvert ? 'fichiers' : null));
  useTiroirAdresse('pieces-jointes', tiroirFichiers === 'pieces', (ouvert) =>
    setTiroirFichiers(ouvert ? 'pieces' : null),
  );
  /*
   * L'onglet du bas est retenu en base : on rouvre l'application là où on
   * l'avait laissée, et le même onglet suit d'un appareil à l'autre. Un onglet
   * retiré depuis (la liste des projets, devenue un panneau) est ignoré.
   */
  const [ongletMemorise, setMobileView] = usePref<OngletMobile>(CLE_ONGLET_MOBILE, 'board');
  const mobileView = ongletAReprendre(ongletMemorise, ONGLETS_MOBILES, 'board');
  // Sur téléphone, la liste des projets glisse par-dessus l'écran en cours.
  const [projetsOuverts, setProjetsOuverts] = React.useState(false);
  const [dropTarget, setDropTarget] = React.useState(false);

  // Largeur de la colonne des projets, retenue d'une session à l'autre. La clé
  // a changé avec la refonte : la colonne porte désormais des groupes encadrés
  // et ses onglets, l'ancienne largeur (196 px) ne lui convenait plus.
  const gauche = useResizable('colonne-projets', { initial: 288, min: 232, max: 440 });
  /* LE CHANGEMENT DE PROJET (recherche comprise) : un seul tiroir, ouvert par
     la loupe de la colonne, par le titre de la zone principale et par celui du
     bandeau du téléphone. Il a son adresse. */
  const [rechercheProjets, setRechercheProjets] = React.useState(false);
  /* LA SUITE DU FIL D'ARIANE : son emplacement dans la barre, sa présence, et
     le geste qui ramène à l'accueil du service (`SuiteDuFil`). */
  const [cibleDeLaSuite, setCibleDeLaSuite] = React.useState<HTMLElement | null>(null);
  const [suitePresente, setSuitePresente] = React.useState(false);
  const retourDeLaSuite = React.useRef<(() => void) | null>(null);
  /* SUR TÉLÉPHONE, LES CRANS D'AVANT SONT CACHÉS : la page ouverte dans un
     service (un site, une création, un classeur) demande une flèche de retour
     dans la barre, avec ses repères (`SuiteDuFil retour`). */
  const retourDUnCran = React.useRef<(() => void) | null>(null);
  const [reperesDuRetour, setReperesDuRetour] = React.useState<ReperesDeRetour | null>(null);
  useTiroirAdresse('projets', rechercheProjets, setRechercheProjets);
  const telephone = useTelephone();
  /* L'emplacement de la barre d'en-tête où la page affichée pose ses gestes. */
  const [cibleDesGestes, setCibleDesGestes] = React.useState<HTMLElement | null>(null);
  /* L'emplacement de la colonne de gauche où un service pose son menu, et le
     cran où il est descendu (un classeur de la mémoire, par exemple). */
  const [corpsDeColonne, setCorpsDeColonne] = React.useState<HTMLElement | null>(null);
  /* …et celui où la page ouverte par-dessus (une tâche) pose ses options. */
  const [corpsDePage, setCorpsDePage] = React.useState<HTMLElement | null>(null);
  const [niveauDeColonne, setNiveauDeColonne] = React.useState<NiveauDeColonne | null>(null);
  const liaison = useEtatDeLiaison();
  /*
   * LE BORD GAUCHE DE LA ZONE PRINCIPALE, MESURÉ ET PUBLIÉ. Une PAGE (ce
   * qu'étaient les tiroirs, `Drawer`) s'ouvre par-dessus la zone principale et
   * rien qu'elle : il lui faut savoir où la colonne des projets s'arrête. On le
   * mesure — largeur réglée à la main, colonne repliée en icônes, téléphone
   * sans colonne — plutôt que de le recalculer, et on le pose en variable.
   */
  const refZonePrincipale = React.useRef<HTMLElement>(null);
  React.useLayoutEffect(() => {
    const zone = refZonePrincipale.current;
    if (!zone) return;
    const publier = () => {
      const gauche = Math.max(0, Math.round(zone.getBoundingClientRect().left));
      document.documentElement.style.setProperty('--zone-principale-gauche', `${gauche}px`);
    };
    publier();
    const observateur = new ResizeObserver(publier);
    observateur.observe(zone);
    window.addEventListener('resize', publier);
    return () => {
      observateur.disconnect();
      window.removeEventListener('resize', publier);
    };
  });

  React.useEffect(() => {
    client.connect();
  }, []);

  /*
   * Les morceaux des panneaux sont réclamés UNE FOIS L'APPLICATION AU REPOS :
   * le premier affichage ne les attend pas, et le premier clic ne les attend
   * pas non plus. Le tiroir d'une carte passe en tête — c'est le plus ouvert.
   */
  React.useEffect(() => {
    const annuler = [
      chargerConversation,
      chargerTiroirCarte,
      chargerVoix,
      chargerReglages,
      chargerConfigProjet,
      chargerTableauDeBord,
    ].map(
      prechargerAuRepos,
    );
    return () => annuler.forEach((stop) => stop());
  }, []);

  /*
   * LA BANDE VIDE EN BAS (recette éprouvée sur ProjetE et ProjetA).
   *
   * Deux mesures, et deux seulement :
   * — la hauteur d'écran, prise sur l'écran physique quand l'application est
   *   installée sur le téléphone : les autres mesures sous-estiment l'écran au
   *   démarrage à froid, et le manque se reporte en bande vide en bas ;
   * — le clavier, réservé UNIQUEMENT s'il est vraiment ouvert (un champ a le
   *   curseur et l'écart dépasse cent points). Sans cette condition, la barre
   *   d'adresse du navigateur passait pour un clavier et creusait une marge
   *   permanente en bas.
   */
  React.useEffect(() => {
    const vue = window.visualViewport;
    const racine = document.documentElement;

    const appliquer = () => {
      const installee =
        (window.navigator as any).standalone === true ||
        window.matchMedia('(display-mode: standalone)').matches;
      const hauteurEcran = installee ? window.screen?.height || 0 : 0;
      if (hauteurEcran) racine.style.setProperty('--hauteur-app', `${hauteurEcran}px`);
      else racine.style.removeProperty('--hauteur-app');

      const actif = document.activeElement;
      const saisieActive =
        !!actif &&
        (actif.tagName === 'INPUT' || actif.tagName === 'TEXTAREA' || (actif as HTMLElement).isContentEditable);
      const ecart = vue ? window.innerHeight - vue.height - vue.offsetTop : 0;
      const clavierOuvert = saisieActive && ecart > 100;
      racine.style.setProperty('--clavier', `${clavierOuvert ? Math.round(ecart) : 0}px`);
    };

    appliquer();
    const retarde = () => {
      window.setTimeout(appliquer, 60);
      window.setTimeout(appliquer, 350);
    };
    vue?.addEventListener('resize', appliquer);
    vue?.addEventListener('scroll', appliquer);
    window.addEventListener('resize', appliquer);
    window.addEventListener('focusin', appliquer);
    window.addEventListener('focusout', retarde);
    window.addEventListener('orientationchange', retarde);
    return () => {
      vue?.removeEventListener('resize', appliquer);
      vue?.removeEventListener('scroll', appliquer);
      window.removeEventListener('resize', appliquer);
      window.removeEventListener('focusin', appliquer);
      window.removeEventListener('focusout', retarde);
      window.removeEventListener('orientationchange', retarde);
    };
  }, []);

  /* Une carte affichée dans la conversation s'ouvre dans le tiroir. */
  /*
   * OUVRIR UNE CARTE, C'EST REVENIR À SON PROJET. Le tiroir se posait par-dessus
   * le service ouvert (coffre, mémoire, sauvegardes…) : l'adresse décrivait
   * alors le service, pas la carte affichée devant — un lien copié à ce
   * moment-là ne ramenait pas sur la carte. On repasse donc en vue « projet »,
   * qui est l'endroit dont la carte fait partie.
   */
  /*
   * LA CARTE D'UN AGENT DE VOLET MÈNE À SON SERVICE. Studio, Marketing,
   * Surveillance, Sauvegardes : un clic sur leur carte — au tableau, sur « En
   * route », depuis la cloche, un fil ou un lien — ramène sur la conversation de
   * l'agent, dans le service, au lieu d'ouvrir un volet dont on ne sait plus à
   * quoi il correspond. Un SEUL chemin pour tous ces clics : `sinon` rouvre la
   * carte quand le service n'a rien à montrer (élément disparu, démon qui ne
   * répond pas, bibliothèque de styles), un clic ne tombe jamais dans le vide.
   * Une carte ordinaire n'attend rien : le service ne se demande qu'aux cartes
   * que l'écran reconnaît déjà comme celles d'un agent de volet.
   */
  const ouvrirLeService = React.useCallback(
    (lieu: LieuDeService) => {
      setSettingsOpen(false);
      setOpenCardId(null);
      setEspaceVise(undefined);
      setVueCentrale(lieu.vue);
      setElementVise({ [lieu.vue]: lieu.elementId });
      setMobileView('board');
    },
    [setMobileView],
  );
  const ouvrirServiceSinonCarte = React.useCallback(
    (cardId: string, sinon: () => void) => {
      const carte = client.lireEtat().cards[cardId];
      if (!serviceDeLaCarteALEcran(carte)) {
        sinon();
        return;
      }
      void lieuDuServiceDeLaCarte(cardId).then((lieu) => (lieu ? ouvrirLeService(lieu) : sinon()));
    },
    [ouvrirLeService],
  );
  const ouvrirLaCarteDuProjet = React.useCallback((cardId: string) => {
    // Une carte ouverte depuis les réglages (la carte d'un ajout de LLM)
    // doit se voir : la fenêtre des réglages se referme devant elle.
    setSettingsOpen(false);
    setVueCentrale('projet');
    setElementVise({});
    setEspaceVise(undefined);
    setOpenCardId(cardId);
  }, []);
  React.useEffect(
    () => client.onOpenCard((cardId) => ouvrirServiceSinonCarte(cardId, () => ouvrirLaCarteDuProjet(cardId))),
    [ouvrirServiceSinonCarte, ouvrirLaCarteDuProjet],
  );

  /*
   * LA CARTE DU BOUTON ROBO SE JUGE À SA FERMETURE — PAR LE SERVEUR. Dès que
   * `openCardId` cesse d'être la carte tenue par `carteRobotIdRef` (le tiroir
   * s'est refermé, ou une autre carte a pris sa place), on DEMANDE au serveur
   * de la ranger si elle est vide. Il juge sur la base (messages, brouillons
   * de ses agents, pièces jointes, titre, agent au travail) : l'écran ne
   * supprime plus jamais seul une carte d'après son état local, qui pouvait
   * ignorer un texte tapé mais pas encore poussé.
   */
  const carteRobotPrecedenteRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    const precedente = carteRobotPrecedenteRef.current;
    carteRobotPrecedenteRef.current = openCardId;
    if (!precedente || precedente === openCardId || precedente !== carteRobotIdRef.current) return;
    carteRobotIdRef.current = null;
    // Le brouillon encore en temporisation part d'abord, avant que le serveur juge.
    window.dispatchEvent(new Event('beluga:vider-brouillon'));
    window.setTimeout(() => {
      void client.call({ type: 'card.supprimerSiVide', id: precedente }).catch(() => {});
    }, 900);
  }, [openCardId]);

  /*
   * OUVRIR UN AGENT, C'EST OUVRIR CE QUI LE SUIT — jamais une fenêtre à part.
   * Le menu Agents du bas de la colonne et « emmène-moi à la décision »
   * passent tous deux par ici. Un agent qui a sa carte (la sienne, ou celle
   * dont il tient la conversation) l'ouvre exactement comme un clic dans le
   * tableau, après avoir basculé sur son projet. Un agent de publication ouvre
   * le volet de mise en production ; `avecFil` y empile son fil, là où une
   * décision (relancer, ignorer, arrêter) l'attend. Tout autre agent sans
   * carte amène à son projet sans rien ouvrir de faux.
   */
  const ouvrirAgent = React.useCallback(
    (agentId: string, avecFil: boolean) => {
      const etat = client.lireEtat();
      const agent = etat.agents[agentId];
      if (!agent) return;
      const cardId =
        agent.cardId ??
        Object.values(etat.cards).find((card) => card.agentId === agentId || card.conversationAgentId === agentId)?.id;
      client.setActiveProject(agent.projectId);
      setVueCentrale('projet');
      setElementVise({});
      setEspaceVise(undefined);
      if (cardId) {
        ouvrirServiceSinonCarte(cardId, () => setOpenCardId(cardId));
        return;
      }
      setOpenCardId(null);
      // L'onglet du bas n'existe que sur téléphone, et il est RETENU : un clic
      // fait sur ordinateur n'a pas à changer ce qu'on retrouvera sur téléphone.
      if (window.innerWidth < 640) setMobileView('board');
      // Aucun message éphémère pour les autres : un simple renseignement n'est
      // pas l'un des trois genres qui alertent (`messageAlerte`).
      // L'Assistant Beluga porte le rôle « deploy » sans être une publication.
      if (agent.role === 'deploy' && !agent.assistantGlobal) {
        /* UN AGENT DE CONFIGURATION (déploiement ou mise en production) ouvre
           son TIROIR, sans fenêtre de réglages (30/09/2026). */
        const projetDeLAgent = etat.projects.find((p) => p.id === agent.projectId);
        const etapeConfiguree = etapeDeLAgentDeConfiguration(projetDeLAgent, agent.id);
        if (etapeConfiguree && !agent.depannagePublication) {
          ouvrirAgentDeConfiguration(agent.projectId, etapeConfiguree);
          return;
        }
        /* CHAQUE AUTRE AGENT DE PUBLICATION OUVRE LE VOLET DE SON ÉTAPE
           (`voletDeLAgentDePublication`). Un DÉPANNEUR ouvre toujours son fil,
           même sans décision en attente : c'est lui qu'on vient voir. */
        const volet = voletDeLAgentDePublication({
          agent,
          configurationId: projetDeLAgent?.miseEnProduction?.agentId,
          derniere: etat.deploys[agent.projectId],
        });
        const fil = avecFil || !!agent.depannagePublication ? agentId : undefined;
        if (volet === 'configuration') ouvrirRubriqueDeLEtape(agent.projectId, 'production');
        else if (volet === 'dev') client.demanderDeploiement({ projectId: agent.projectId, agentId: fil });
        else client.demanderProduction({ projectId: agent.projectId, agentId: fil });
      }
    },
    [setMobileView, ouvrirServiceSinonCarte],
  );
  React.useEffect(
    () => client.onOpenConversation(({ agentId }) => ouvrirAgent(agentId, true)),
    [ouvrirAgent],
  );

  /*
   * Sur téléphone, changer de projet ramène au tableau. Le panneau, lui, se
   * referme sur le GESTE (voir onChoose) et non sur ce changement d'état : le
   * projet retenu de la veille arrive quelques instants après l'ouverture, et
   * il refermait le panneau sous le doigt.
   */
  const projetPrecedent = React.useRef<string | null>(null);
  React.useEffect(() => {
    const avant = projetPrecedent.current;
    projetPrecedent.current = state.activeProjectId;
    // L'arrivée du projet retenu à l'ouverture n'est pas un changement de
    // projet : elle ne doit pas écraser l'onglet mémorisé.
    if (!avant || avant === state.activeProjectId) return;
    setMobileView('board');
  }, [state.activeProjectId]);

  /*
   * La carte ouverte est retenue, projet par projet : on retrouve le tiroir
   * exactement comme on l'a laissé. La reprise n'a lieu qu'UNE fois par projet
   * — refermer le tiroir est un geste, il ne doit pas se rouvrir tout seul —
   * et une carte supprimée entre-temps laisse simplement le tiroir fermé.
   */
  const carteReprise = React.useRef(new Set<string>());
  React.useEffect(() => {
    const projectId = state.activeProjectId;
    /* LA REPRISE N'A LIEU QUE SUR LE TABLEAU DU PROJET. Arrivé sur un service
       (coffre, mémoire, Studio…), la carte retenue attend le retour au tableau :
       elle ne se rouvre jamais par-dessus un écran qui n'a rien à voir. */
    if (vueCentrale !== 'projet') return;
    if (!projectId || openCardId || carteReprise.current.has(projectId)) return;
    const memorisee = carteAReprendre(
      state.prefs[cleCarteOuverte(projectId)],
      Object.values(state.cards),
      projectId,
    );
    // Tant que les cartes du projet ne sont pas arrivées, on laisse sa chance
    // au tour suivant plutôt que d'abandonner la reprise.
    if (!memorisee) return;
    carteReprise.current.add(projectId);
    setOpenCardId(memorisee);
  }, [state.activeProjectId, state.cards, state.prefs, openCardId, vueCentrale]);

  // Ouvrir ou fermer le tiroir met à jour le souvenir, tout de suite.
  React.useEffect(() => {
    const projectId = (openCardId ? state.cards[openCardId]?.projectId : null) ?? state.activeProjectId;
    if (!projectId) return;
    carteReprise.current.add(projectId);
    const cle = cleCarteOuverte(projectId);
    if ((state.prefs[cle] ?? '') === (openCardId ?? '')) return;
    writePref(cle, openCardId ?? '');
  }, [openCardId]);

  /*
   * L'ADRESSE DU NAVIGATEUR SUIT L'ÉCRAN. Un fragment après le « # » décrit où
   * l'on est (« #projet/<id> », « #projet/<id>/tache/<id>-<slug> »,
   * « #reglages », « #tableau-de-bord ») : recharger, coller l'adresse dans un
   * onglet neuf ou faire Précédent/Suivant retrouve le même écran. La
   * persistance serveur (projet actif, carte ouverte) n'est pas touchée : le
   * fragment s'ajoute par-dessus. L'identifiant reste la clé ; le slug du titre
   * n'est là que pour l'œil, et se jette à la lecture.
   */
  const appliquerEcran = React.useCallback((ecran: EcranNavigateur) => {
    // Les tiroirs ouverts par-dessus l'écran se lisent dans la même adresse.
    appliquerTiroirs(ecran);
    // « #reglages » est une couche par-dessus l'écran en cours : on l'ouvre
    // sans rien changer sous elle.
    if (ecran.vue === 'reglages') {
      setSettingsOpen(true);
      setSettingsPage(ecran.page);
      return;
    }
    /*
     * « …/config/<rubrique> » est une couche aussi — mais elle NOMME son
     * projet : un lien collé dans un onglet neuf doit ouvrir le bon tableau
     * dessous avant d'ouvrir la fenêtre par-dessus.
     */
    if (ecran.vue === 'config-projet') {
      setSettingsOpen(false);
      setConfigProjetId(ecran.projectId);
      setConfigRubrique(ecran.rubrique);
      setVueCentrale('projet');
      if (client.lireEtat().activeProjectId !== ecran.projectId) {
        client.setActiveProject(ecran.projectId);
      }
      return;
    }
    setConfigProjetId(null);
    setConfigRubrique(undefined);
    setSettingsOpen(false);
    /*
     * L'ÉLÉMENT VISÉ EST CELUI DU SERVICE DEMANDÉ, ET LUI SEUL. Poser les six
     * d'un coup évite qu'une fiche visée dans un service en rouvre une autre
     * quand on revient dedans par les flèches du navigateur.
     */
    setElementVise(elementViseDeLEcran(ecran));
    setEspaceVise(
      ecran.vue === 'espace' ? { clientId: ecran.clientId, demandeId: ecran.demandeId } : undefined,
    );
    /* La destination de la colonne de gauche se DÉDUIT de l'écran, elle ne se
       réécrit pas à la main : c'est la table du socle qui fait foi. */
    const destination = destinationDeLEcran(ecran);
    setVueCentrale(destination ?? 'projet');
    /*
     * UN TABLEAU DE BORD PEUT PORTER SA CARTE, nommée avec son projet. Une
     * adresse qui la nomme l'ouvre PAR-DESSUS le tableau (le tableau reste
     * dessous) ; une adresse qui ne la nomme plus — Précédent, ou la carte
     * refermée — la referme, mais seulement si c'est ICI qu'elle s'était
     * ouverte : la carte retenue du tableau d'un projet n'est pas la nôtre.
     */
    if (ecran.vue === 'en-route' || ecran.vue === 'tableau-de-bord') {
      if (ecran.cardId && ecran.projectId) {
        if (client.lireEtat().activeProjectId !== ecran.projectId) {
          client.setActiveProject(ecran.projectId);
        }
        setCarteOuverteSur({ id: ecran.cardId, vue: ecran.vue, projectId: ecran.projectId });
        setOpenCardId(ecran.cardId);
        setOngletCarte(ecran.onglet ?? null);
        return;
      }
      const ouverte = carteOuverteSurRef.current;
      if (ouverte && ouverte.id === openCardIdRef.current && ouverte.vue === ecran.vue) {
        setOpenCardId(null);
      }
      return;
    }
    if (ecran.vue === 'projet') {
      // Ne re-déclencher l'ouverture serveur que si le projet change vraiment.
      if (client.lireEtat().activeProjectId !== ecran.projectId) {
        client.setActiveProject(ecran.projectId);
      }
      setOpenCardId(ecran.cardId ?? null);
      setOngletCarte(ecran.onglet ?? null);
      return;
    }
    /* UN SERVICE PLEIN NE REFERME PAS LA CARTE OUVERTE : il ne l'affiche pas
       (`carteVisibleSurLaVue`), et on la retrouve intacte au retour sur le
       tableau. Seul l'accueil, qui ne désigne rien, remet le volet à zéro. */
    if (destination) return;
    setOpenCardId(null);
  }, []);

  // Au chargement, et à chaque Précédent/Suivant, l'adresse commande l'écran.
  const adresseLue = React.useRef(false);
  /* Un tiroir refermé au clic ramène d'un cran en arrière (voir l'écrivain) :
     tant que ce retour n'est pas arrivé, on n'en redemande pas un second. */
  const retourDeTiroirEnCours = React.useRef(false);
  React.useEffect(() => {
    const suivreAdresse = () => {
      retourDeTiroirEnCours.current = false;
      appliquerEcran(lireFragment(window.location.hash));
    };
    suivreAdresse();
    adresseLue.current = true;
    window.addEventListener('popstate', suivreAdresse);
    return () => window.removeEventListener('popstate', suivreAdresse);
  }, [appliquerEcran]);

  // En sens inverse, chaque changement d'écran réécrit l'adresse. Un même écran
  // ne rajoute rien à l'historique (replaceState, juste pour rafraîchir le
  // slug) ; un écran différent y pousse une entrée, pour que Précédent revienne.
  const titreCarteOuverte = openCardId ? state.cards[openCardId]?.title ?? null : null;

  /*
   * LE STUDIO N'OUVRE AUCUN VOLET DE CARTE TOUT SEUL. La carte retenue pour le
   * projet (reprise ci-dessus), celle d'une adresse restaurée ou celle restée
   * ouverte avant d'entrer se posaient en tiroir PAR-DESSUS le Studio : on
   * revenait à l'atelier et un volet d'agent l'avait recouvert. Au Studio, le
   * tiroir n'est donc jamais AFFICHÉ — mais `openCardId` reste tel quel : le
   * souvenir du tableau n'est pas effacé, et la carte se retrouve au retour.
   * Un geste explicite (clic sur une carte, cloche, alerte) passe par
   * `client.onOpenCard` / `ouvrirAgent`, qui ramènent en vue « projet » : il
   * ouvre la carte comme avant.
   */
  /*
   * PLUS AUCUN VOLET DE CARTE HORS DU TABLEAU DU PROJET. Ce qui valait pour le
   * Studio vaut pour tous les services (coffre, mémoire, sauvegardes,
   * surveillance, marketing, statistiques, notes, espace client) : la carte
   * n'est AFFICHÉE que sur le tableau du projet — et sur « Tableaux de bord » /
   * « En route » seulement si elle y a été ouverte d'un clic. `openCardId`
   * reste tel quel : le souvenir n'est pas effacé, la carte se retrouve au
   * retour sur le tableau.
   */
  const vueCentraleRef = React.useRef(vueCentrale);
  vueCentraleRef.current = vueCentrale;
  /* Une carte qui s'ouvre À CE RENDU appartient à la vue où l'on est. */
  const vueDeLaCarte = openCardId && carteOuverteSur?.id === openCardId ? carteOuverteSur.vue : vueCentrale;
  React.useEffect(() => {
    if (!openCardId) {
      setCarteOuverteSur(null);
      return;
    }
    setCarteOuverteSur((avant) => (avant?.id === openCardId ? avant : { id: openCardId, vue: vueCentrale }));
    // La vue n'est lue qu'à l'ouverture : changer de vue ensuite ne déplace pas la carte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCardId]);
  const carteAffichee = carteVisibleSurLaVue(vueCentrale, vueDeLaCarte) ? openCardId : null;
  /* Le projet de la carte affichée : celui que nomme l'adresse d'un tableau de bord. */
  const projetDeLaCarteAffichee = carteAffichee
    ? state.cards[carteAffichee]?.projectId ??
      (carteOuverteSur?.id === carteAffichee ? carteOuverteSur.projectId : undefined) ??
      null
    : null;
  const premiereEcriture = React.useRef(true);
  const pileTiroirs = usePileDeTiroirs();
  React.useEffect(() => {
    if (!adresseLue.current) return;
    // Le tout premier rendu vient de LIRE l'adresse : ne pas la réécrire à
    // partir d'un état pas encore rafraîchi, sous peine d'effacer le fragment
    // collé avant qu'il ne soit appliqué.
    if (premiereEcriture.current) {
      premiereEcriture.current = false;
      return;
    }
    const ecranSansTiroirs: EcranNavigateur = settingsOpen
      ? { vue: 'reglages', page: settingsPage }
      : configProjetId
      ? {
          vue: 'config-projet',
          projectId: configProjetId,
          ...(configRubrique ? { rubrique: configRubrique } : {}),
        }
      : ecranDeLaVue({
          vue: vueCentrale,
          element: elementVise,
          espace: espaceVise,
          /* Sur un tableau de bord, la carte vient de n'importe quel projet :
             l'adresse nomme LE SIEN. Partout ailleurs, le projet actif. */
          projectId:
            vueCentrale === 'en-route' || vueCentrale === 'tableau-de-bord'
              ? projetDeLaCarteAffichee
              : state.activeProjectId,
          /* LA CARTE AFFICHÉE, pas la carte retenue : `openCardId` est aussi un
             souvenir (carte du tableau d'un projet, restée ouverte avant
             d'arriver ici) qui ne s'écrit pas dans l'adresse d'un autre écran. */
          cardId: carteAffichee,
          titreCarte: titreCarteOuverte,
          onglet: ongletCarte,
        });
    /* Les tiroirs désignés par une adresse collée attendent leur écran : si
       l'écran change sous eux, l'attente tombe. */
    oublierLAttenteSiEcranChange(ecranSansTiroirs, memeEcran);
    const ecran: EcranNavigateur = pileTiroirs.length
      ? { ...ecranSansTiroirs, tiroirs: pileTiroirs }
      : ecranSansTiroirs;

    const cible = construireFragment(ecran);
    const url = cible ? '#' + cible : window.location.pathname + window.location.search;
    const courant = lireFragment(window.location.hash);
    if (memeEcran(courant, ecran)) {
      if (window.location.hash.replace(/^#/, '') !== cible) {
        window.history.replaceState(window.history.state, '', url);
      }
      return;
    }
    const marque = (window.history.state ?? {}) as Record<string, unknown>;
    const memeEcranHorsTiroirs = memeEcran(
      { ...courant, tiroirs: undefined },
      { ...ecran, tiroirs: undefined },
    );
    const tiroirsCourants = courant.tiroirs ?? [];
    if (memeEcranHorsTiroirs) {
      /* UN TIROIR SE REFERME AU CLIC : si l'entrée courante est celle que son
         ouverture a poussée, on RECULE d'un cran au lieu d'en empiler une de
         plus — sinon Précédent le rouvrirait. */
      if (
        tiroirsCourants.length > pileTiroirs.length &&
        memeTiroirs(tiroirsCourants.slice(0, -1), pileTiroirs) &&
        marque.belugaTiroir === true
      ) {
        if (!retourDeTiroirEnCours.current) {
          retourDeTiroirEnCours.current = true;
          window.history.back();
        }
        return;
      }
      if (tiroirsCourants.length > pileTiroirs.length) {
        window.history.replaceState(window.history.state, '', url);
        return;
      }
      /* UN VOLET QUI EN REMPLACE UN AUTRE (la galerie se ferme, la conversation
         s'ouvre) n'empile pas d'entrée : sinon Précédent, en refermant le
         nouveau, rouvrait l'ancien. On n'empile que si la pile PROLONGE celle
         de l'adresse (un volet posé par-dessus). */
      if (!memeTiroirs(pileTiroirs.slice(0, tiroirsCourants.length), tiroirsCourants)) {
        window.history.replaceState(window.history.state, '', url);
        return;
      }
      window.history.pushState({ ...marque, belugaTiroir: true }, '', url);
      return;
    }
    // Une autre destination : la marque d'un tiroir ne la suit pas.
    const { belugaTiroir: _marque, ...reste } = marque;
    void _marque;
    window.history.pushState(Object.keys(reste).length ? reste : null, '', url);
  }, [
    pileTiroirs,
    state.activeProjectId,
    openCardId,
    ongletCarte,
    vueCentrale,
    elementVise,
    espaceVise,
    settingsOpen,
    settingsPage,
    configProjetId,
    configRubrique,
    titreCarteOuverte,
    carteAffichee,
    projetDeLaCarteAffichee,
  ]);

  /*
   * TROIS ENDROITS OUVRENT LA CONFIGURATION D'UN PROJET, et aucun n'est parent
   * de cette fenêtre : la ligne du projet dans la colonne de gauche, la tête de
   * « À déployer », le bandeau de mise en production. Ils passent par un
   * événement de fenêtre (`ouvrir-config-projet.ts`) — c'est la même mécanique
   * que le panneau des décisions, et elle évite de faire traverser une fonction
   * à trois composants qui n'ont rien à voir entre eux.
   */
  /* Le tiroir de l'agent de configuration se monte à la PREMIÈRE demande, puis
     reste monté et écoute seul : la demande qui l'a fait monter lui est
     donnée comme demande initiale, puisqu'il n'écoutait pas encore. */
  const [demandeInitialeConfiguration, setDemandeInitialeConfiguration] =
    React.useState<DemandeDAgentDeConfiguration | null>(null);
  React.useEffect(() => {
    const monter = (event: Event) => {
      const detail = (event as CustomEvent<DemandeDAgentDeConfiguration>).detail;
      if (detail?.projectId) setDemandeInitialeConfiguration((deja) => deja ?? detail);
    };
    window.addEventListener(EVENEMENT_AGENT_CONFIGURATION, monter);
    return () => window.removeEventListener(EVENEMENT_AGENT_CONFIGURATION, monter);
  }, []);
  React.useEffect(() => {
    const ouvrir = (event: Event) => {
      const detail = (event as CustomEvent<DemandeDeConfig>).detail;
      if (!detail?.projectId) return;
      setSettingsOpen(false);
      setConfigProjetId(detail.projectId);
      setConfigRubrique(detail.rubrique ?? RUBRIQUE_CONFIG_PAR_DEFAUT);
    };
    window.addEventListener(EVENEMENT_CONFIG_PROJET, ouvrir);
    return () => window.removeEventListener(EVENEMENT_CONFIG_PROJET, ouvrir);
  }, []);

  /*
   * LE TIROIR DE MISE EN PRODUCTION DEMANDÉ D'AILLEURS — la rubrique des
   * réglages, une alerte, un raccourci. Il vit dans le bandeau du tableau du
   * projet : on referme la fenêtre des réglages et on ramène ce tableau à
   * l'écran, sans quoi la demande attendrait un bandeau qui n'est pas monté.
   */
  const productionDemandee = state.productionDemandee;
  React.useEffect(() => {
    /* Le tiroir du groupe affiché répond lui-même pour l'un de ses projets
       (`surPlace`) : on ne quitte pas son tableau. */
    if (!productionDemandee || productionDemandee.surPlace) return;
    setConfigProjetId(null);
    if (client.lireEtat().activeProjectId !== productionDemandee.projectId) {
      client.setActiveProject(productionDemandee.projectId);
    }
    setVueCentrale('projet');
    if (window.innerWidth < 640) setMobileView('board');
  }, [productionDemandee, setMobileView]);
  /* LE VOLET DU DÉPLOIEMENT DEMANDÉ D'AILLEURS : même ramenée au tableau du
     projet, où le bloc « À déployer » l'ouvre. */
  const deploiementDemande = state.deploiementDemande;
  React.useEffect(() => {
    if (!deploiementDemande) return;
    setConfigProjetId(null);
    if (client.lireEtat().activeProjectId !== deploiementDemande.projectId) {
      client.setActiveProject(deploiementDemande.projectId);
    }
    setVueCentrale('projet');
    /* Demandé depuis le pied d'une carte : la fenêtre de sélection s'ouvre
       sur le tableau, la carte ne doit plus la recouvrir. */
    if (deploiementDemande.selection) setOpenCardId(null);
    if (window.innerWidth < 640) setMobileView('board');
  }, [deploiementDemande, setMobileView]);
  /* LE TABLEAU D'UN PROJET DEMANDÉ D'AILLEURS : l'icône du projet devant le
     titre d'une carte. On referme la carte, on ouvre son projet, et on montre
     son tableau — même depuis « Tableaux de bord » ou un service plein. */
  const tableauDemande = state.tableauDemande;
  React.useEffect(() => {
    if (!tableauDemande) return;
    setConfigProjetId(null);
    if (client.lireEtat().activeProjectId !== tableauDemande.projectId) {
      client.setActiveProject(tableauDemande.projectId);
    }
    setVueCentrale('projet');
    setElementVise({});
    setEspaceVise(undefined);
    setOpenCardId(null);
    setMobileView('board');
    client.demanderTableau(null);
  }, [tableauDemande, setMobileView]);

  // Passé sur grand écran (rotation, écran externe), la colonne de gauche est
  // de nouveau posée là : le panneau qui la recouvre n'a plus lieu d'être.
  React.useEffect(() => {
    const large = window.matchMedia('(min-width: 640px)');
    const suivre = () => large.matches && setProjetsOuverts(false);
    suivre();
    large.addEventListener('change', suivre);
    return () => large.removeEventListener('change', suivre);
  }, []);

  /*
   * Notifications système, cliquables : elles ouvrent la carte concernée.
   *
   * Le démon prévient DEUX fois : par la connexion de l'onglet ouvert, et par
   * la voie poussée qui atteint l'appareil même application fermée. Quand cet
   * appareil est abonné à la voie poussée, l'alerte y arrivera de toute façon :
   * la page se tait, sinon la même nouvelle s'affiche deux fois. Sans
   * abonnement (navigateur qui ne le sait pas faire, permission jamais
   * demandée), la page reste le seul chemin et continue d'annoncer.
   */
  React.useEffect(() => {
    let abonne = false;
    const suivreAbonnement = () => {
      if (!('serviceWorker' in navigator)) return;
      void navigator.serviceWorker.ready
        .then((registration) => registration.pushManager.getSubscription())
        .then((subscription) => {
          abonne = !!subscription;
        })
        .catch(() => {
          abonne = false;
        });
    };
    suivreAbonnement();
    // L'abonnement se pose quelques secondes après l'ouverture : on redemande.
    const arreterLeRappel = lancerIntervalleVisible(suivreAbonnement, 15_000);

    const arreter = client.onNotify((event) => {
      if (abonne) return;
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      // Même image que dans le service worker, tirée du même motif : une
      // alerte ne change pas de visage selon que l'onglet est ouvert ou fermé.
      // C'est l'icône NEUTRE du motif — le détour par le portrait rond d'un
      // personnage de colonne a disparu avec les personnages eux-mêmes.
      const notification = new Notification(event.title, {
        body: event.body,
        tag: event.tag,
        icon: imageDeLAlerte(event.motif),
      });
      notification.onclick = () => {
        window.focus();
        client.allerVersDecision({ projectId: event.projectId, cardId: event.cardId, agentId: event.agentId });
      };
    });
    return () => {
      arreterLeRappel();
      arreter();
    };
  }, []);

  /*
   * Abonnement aux notifications poussées : l'application prévient même fermée.
   * Le geste vit dans `lib/abonnement-push.ts` — l'espace client s'y abonne
   * aussi, et l'abonnement est rangé AU NOM du compte connecté.
   */
  React.useEffect(() => {
    void abonnerAuxNotifications();

    // Un appui sur une notification poussée emmène à la décision concernée
    // (carte, ou conversation quand elle n'en a aucune — question d'un agent
    // d'orchestre).
    const onMessage = (event: MessageEvent) => {
      // Une alerte de l'espace client porte son adresse (la fiche d'un client) :
      // on la pose, et l'écran la suit comme un Précédent/Suivant.
      if (event.data?.type === 'OPEN_URL' && typeof event.data.url === 'string') {
        window.history.pushState(null, '', event.data.url);
        window.dispatchEvent(new PopStateEvent('popstate'));
        return;
      }
      if (event.data?.type === 'OPEN_CARD') {
        client.allerVersDecision({
          projectId: event.data.projectId,
          cardId: event.data.cardId,
          agentId: event.data.agentId,
        });
      }
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage);
  }, []);

  /*
   * LE COMPTE SUR L'ICÔNE DE L'APPLICATION INSTALLÉE. On voit ainsi, sans même
   * ouvrir Beluga Build, qu'un agent a rendu quelque chose. On additionne les
   * réponses non lues de tous les projets ; à zéro, la pastille est retirée
   * plutôt que laissée à « 0 ». Les navigateurs qui ne connaissent pas cette
   * pastille ne font simplement rien.
   */
  // Le MÊME total que les compteurs de la colonne de gauche (`totalDesRendus`).
  const nonLues = totalDesRendus(state.rendus);
  React.useEffect(() => {
    const nav = navigator as Navigator & {
      setAppBadge?: (n?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (!nav.setAppBadge) return;
    const geste = nonLues > 0 ? nav.setAppBadge(nonLues) : nav.clearAppBadge?.();
    void geste?.catch(() => undefined);
  }, [nonLues]);

  const activeProject = state.projects.find((project) => project.id === state.activeProjectId);

  /*
   * FAUT-IL BARRER L'ÉCRAN ? La réponse est une règle pure, jamais un calcul
   * écrit ici : elle attend d'avoir REÇU le catalogue des moteurs et le relevé
   * des comptes avant de juger, pour ne pas s'ouvrir une demi-seconde sur un
   * serveur pourtant bien configuré.
   */
  /*
   * UNE INSTALLATION NEUVE S'OUVRE SUR L'ASSISTANT DE PREMIER DÉMARRAGE, qui
   * porte lui-même la page des moteurs : tant qu'il est ouvert, l'écran qui
   * barre la route faute de moteur ne se pose pas par-dessus.
   */
  const demarrageOuvert = state.pret && assistantDeDemarrageOuvert(state.settings?.assistant);
  const assistantOuvert =
    !demarrageOuvert &&
    assistantNecessaire({
      pret: state.pret,
      engines: state.engines,
      quotas: state.quotas,
      quotasRecus: state.quotasRecus,
    });

  /*
   * CHANGER DE DESTINATION. Une seule vue occupe le centre : la choisir suffit
   * à quitter la précédente. Sur téléphone le volet central n'est visible que
   * sur l'onglet « Tableau » : on y revient, sinon l'écran demandé s'ouvrirait
   * derrière la conversation.
   */
  const ouvrirVue = React.useCallback(
    (vue: VueCentrale) => {
      /* LA PAGE OÙ L'ON EST DÉJÀ, RECOUVERTE PAR UNE CARTE : choisir « Tableaux
         de bord » ou « Résumé » depuis elle ne changeait aucun état, la carte
         restait posée et le bouton semblait mort. On la referme. L'état est lu
         par les références : ce rappel ne se recrée pas à chaque rendu. */
      const carteOuverte = openCardIdRef.current;
      const vueActuelle = vueCentraleRef.current;
      const sur = carteOuverteSurRef.current;
      if (
        carteARefermerSurChoixDeVue({
          vueDemandee: vue,
          vueActuelle,
          vueDeLaCarte: carteOuverte && sur?.id === carteOuverte ? sur.vue : vueActuelle,
          carteOuverte: !!carteOuverte,
        })
      ) {
        setOpenCardId(null);
      }
      setVueCentrale(vue);
      /* Entrer dans un service, c'est y entrer par sa porte : l'élément qu'un
         lien avait désigné la fois d'avant ne se rouvre pas tout seul. */
      setElementVise({});
      if (vue !== 'espace-client') setEspaceVise(undefined);
      setMobileView('board');
    },
    [setMobileView],
  );
  const ouvrirTableauDeBord = () => ouvrirVue('tableau-de-bord');
  /* Le titre d'une page qui n'appartient à aucun projet : il prend la place du
     nom du projet ouvert, qui n'y dirait rien. */
  const surTableauxDeBord =
    vueCentrale === 'en-route' || (vueCentrale === 'projet' && !state.activeProjectId && state.projects.length > 0);
  /*
   * LE FIL D'ARIANE DE LA PAGE AFFICHÉE. Un projet se situe sous « Tableaux de
   * bord » ; un service, sous « Services » ; les tableaux de bord sont une
   * racine. Le dernier cran — le titre — est le lieu lui-même. Le groupe du
   * projet n'y figure pas : c'est le NOM du projet qui importe, et lui seul ouvre
   * la liste des autres projets (le groupe se lit dans cette liste).
   */
  const cheminDeLaPage: CranDuChemin[] = surTableauxDeBord
    ? []
    : vueCentrale === 'projet'
      ? activeProject
        ? [
            /* LE PREMIER CRAN S'APPELLE « TABLEAUX DE BORD » (demande du
               11/10/2026, à la place de « Projets ») : il mène à la page de tous
               les projets. Le nom du projet, lui, ouvre la liste déroulante ;
               la fenêtre « Changer de projet » reste derrière la loupe de la
               colonne. */
            { libelle: t('Tableaux de bord'), onClick: () => ouvrirVue('en-route') },
          ]
        : []
      : [{ libelle: t('Services') }];
  const titreDeLaPage = surTableauxDeBord
    ? t('Tableaux de bord')
    : vueCentrale === 'projet'
      ? (activeProject?.name ?? 'Beluga')
      : t(CLES_TITRE_DE_VUE[vueCentrale]);
  /* LE BOUTON DES SERVICES OUVRE LE FIL D'ARIANE, à gauche du titre (demande du
     11/10/2026) : on change de service depuis la barre d'en-tête, sans passer
     par la colonne — qui ne le porte plus. Sur téléphone aussi : il suit le
     bouton des projets, juste devant le titre. */
  const boutonDesServices = <BoutonDesServices vue={vueCentrale} onOuvrirVue={ouvrirVue} cote="start" />;
  /* OÙ L'ON EST, dit une fois : une page ouverte par-dessus la zone le reprend
     pour écrire son propre fil d'Ariane (`EnteteDePage`). Le bouton des services
     la suit partout, téléphone compris (demande du 13/10/2026) : juste après la
     flèche de retour, avant le titre — on change de service sans refermer la
     page d'abord. */
  const lieu = { chemin: cheminDeLaPage, titre: titreDeLaPage, avant: boutonDesServices };
  /* LE MENU PRINCIPAL DU TÉLÉPHONE, à portée de toute page à deux rangs
     (la tâche) : le bouton qui ouvre la colonne des projets. */
  const menuPrincipal = React.useMemo(
    () => ({
      ouvrir: () => setProjetsOuverts(true),
      point: !liaison.enLigne || liaison.ailleurs ? { classe: liaison.classe, texte: liaison.texte } : null,
    }),
    [liaison.enLigne, liaison.ailleurs, liaison.classe, liaison.texte],
  );
  /* LA SUITE DU FIL, écrite par le service affiché : l'enfant où l'on se trouve. */
  const suiteDuFil = React.useMemo(
    () => ({
      cible: cibleDeLaSuite,
      retour: retourDeLaSuite,
      signaler: setSuitePresente,
      retourDUnCran,
      signalerLeRetour: setReperesDuRetour,
    }),
    [cibleDeLaSuite],
  );
  /* UNE SEULE COLONNE À GAUCHE, QUI SUIT LE LIEU OÙ L'ON EST (demande du
     11/10/2026). Un service qui a son menu (résumé, mémoire, notes, marketing)
     le pose dans la colonne des projets, qui lui laisse la place ; un PROJET y
     pose ses options ; une TÂCHE ouverte, les siennes, par-dessus. En tête, une
     flèche remonte d'un cran : de la tâche au projet, du projet à la page de
     tous les projets. Sur téléphone la colonne vit dans un panneau fermé : rien
     de tout cela n'y vaut. */
  const serviceAMenu = !telephone && VUES_A_MENU.includes(vueCentrale);
  const colonneDeProjet = !telephone && vueCentrale === 'projet' && !!activeProject;
  const carteDeLaColonne = !telephone && carteAffichee ? (state.cards[carteAffichee] ?? null) : null;
  const colonneDeService = React.useMemo(
    () => ({
      corps: serviceAMenu || colonneDeProjet ? corpsDeColonne : null,
      corpsDePage: carteDeLaColonne ? corpsDePage : null,
      definirNiveau: setNiveauDeColonne,
    }),
    [serviceAMenu, colonneDeProjet, corpsDeColonne, !!carteDeLaColonne, corpsDePage],
  );
  /* CE QUI ATTEND AILLEURS se dit sur la flèche de retour de la colonne : la
     liste des projets, qui portait ces alertes, n'est plus sous les yeux. */
  const pointDeRetour = !liaison.enLigne || liaison.ailleurs ? { classe: liaison.classe, texte: liaison.texte } : null;
  const lieuDeLaColonne = carteDeLaColonne
    ? {
        /* UNE CARTE TOUTE NEUVE N'A PAS ENCORE DE TITRE À ELLE : son mot par
           défaut (« Nouvelle tâche ») répétait, en tête de colonne, le bouton
           du même nom posé juste dessous. Tant que le titre est en construction
           (`titreEnConstruction`), la tête dit où l'on est : dans les tâches. */
        titre: titreEnConstruction(carteDeLaColonne) ? t('Tâches') : carteDeLaColonne.title,
        onRetour: () => setOpenCardId(null),
        plan: 'page' as const,
        bande: true,
        point: pointDeRetour,
      }
    : colonneDeProjet && activeProject
      ? { titre: activeProject.name, onRetour: () => ouvrirVue('en-route'), bande: true, point: pointDeRetour }
      : serviceAMenu
        ? {
            titre: niveauDeColonne?.titre ?? titreDeLaPage,
            onRetour: niveauDeColonne?.onRetour ?? (() => ouvrirVue('projet')),
          }
        : null;
  /* LE STUDIO MÈNE AU COFFRE-FORT quand la clé OpenRouter de la voix finale y manque. */
  React.useEffect(() => {
    const versLeCoffre = () => ouvrirVue('coffre');
    window.addEventListener(EVENEMENT_OUVRIR_COFFRE, versLeCoffre);
    return () => window.removeEventListener(EVENEMENT_OUVRIR_COFFRE, versLeCoffre);
  }, [ouvrirVue]);

  /*
   * UNE CARTE OUVERTE DEPUIS LA PAGE « EN ROUTE » : le même tiroir que le
   * tableau, sans quitter la page ni changer de projet. Le tiroir lit la
   * carte dans `cards` : elle y est versée d'abord.
   */
  const ouvrirCarteEnRoute = React.useCallback(
    (card: Card) => {
      client.verserCarte(card);
      ouvrirServiceSinonCarte(card.id, () => {
        /* Ouverte d'un clic SUR CETTE PAGE : c'est ici qu'elle s'affiche, même
           si la même carte était déjà retenue (restée ouverte sur le tableau). */
        setCarteOuverteSur({ id: card.id, vue: vueCentraleRef.current });
        setOpenCardId(card.id);
      });
    },
    [ouvrirServiceSinonCarte],
  );
  /*
   * UNE CARTE OUVERTE DEPUIS UN SERVICE (Marketing, Statistiques) RAMÈNE À SON
   * PROJET : un service plein n'affiche aucun volet de carte, le clic mène donc
   * au tableau du projet de la carte, où elle s'ouvre.
   */
  const ouvrirCarteDepuisUnService = React.useCallback(
    (card: Card) => {
      client.verserCarte(card);
      ouvrirServiceSinonCarte(card.id, () => {
        if (client.lireEtat().activeProjectId !== card.projectId) client.setActiveProject(card.projectId);
        ouvrirLaCarteDuProjet(card.id);
        setMobileView('board');
      });
    },
    [ouvrirServiceSinonCarte, ouvrirLaCarteDuProjet, setMobileView],
  );
  const ouvrirCarteDuTableau = React.useCallback(
    (cardId: string) => ouvrirServiceSinonCarte(cardId, () => setOpenCardId(cardId)),
    [ouvrirServiceSinonCarte],
  );
  /* Le projet de la carte ouverte n'est jamais déchargé (`projetsRetenus`) :
     il peut ne pas être celui qu'affiche le tableau. */
  React.useEffect(() => {
    client.retenirCarteDuTiroir(openCardId);
  }, [openCardId]);
  const pageEnRoute = (
    <Filet zone="Tableaux de bord">
      <PanneauALaDemande monte attente={<SilhouetteEnRoute />}>
        <EnRoute onOpenCard={ouvrirCarteEnRoute} onOpenAgent={(agentId) => ouvrirAgent(agentId, false)} />
      </PanneauALaDemande>
    </Filet>
  );

  if (state.connecting && !state.pret && !state.copieLocale) {
    return (
      <div className="grid h-full place-items-center bg-bg">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-faint" />
          <p className="text-[14px] text-faint">
            {t('Connexion au serveur…')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <EnteteDePageParDefaut.Provider value={EnteteDePage}>
      <FournirLeLieu value={lieu}>
      <FournirLeMenuPrincipal value={menuPrincipal}>
      <FournirLaSuiteDuFil value={suiteDuFil}>
      <FournirLaColonneDeService value={colonneDeService}>
      <div
        /*
         * L'application prend TOUTE la hauteur de la page, en flux normal.
         * Surtout pas « ancrée aux quatre bords » : sur téléphone, une page
         * dont plus rien n'est dans le flux voit sa hauteur s'effondrer, et
         * le système réserve alors une bande vide en bas (le même piège avait
         * été rencontré sur ProjetE et ProjetA). Le creux du bas ne sert qu'au
         * clavier, et seulement quand il est réellement ouvert.
         */
        className="flex h-full flex-col overflow-hidden bg-bg"
        style={{ paddingBottom: 'var(--clavier, 0px)' }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault();
            setDropTarget(true);
          }
        }}
        onDragLeave={() => setDropTarget(false)}
        onDrop={(event) => {
          if (event.dataTransfer.files.length) {
            event.preventDefault();
            setDropTarget(false);
            // Sans conversation ouverte, le dépôt est refusé avec un message clair.
            if (!openCardId) {
              client.pushToast('warning', t('Ouvrez d\'abord une conversation pour y déposer un fichier.'));
            } else {
              client.pushToast('info', t('Déposez le fichier directement dans la barre d\'écriture de la conversation.'));
            }
          }
        }}
      >
        <TiroirProjets
          open={rechercheProjets}
          onClose={() => setRechercheProjets(false)}
          surTableauxDeBord={vueCentrale === 'en-route' || (vueCentrale === 'projet' && !state.activeProjectId)}
          onOuvrirVue={ouvrirVue}
        />

        {/* LE LIEN AVEC LE DÉMON SE DIT DANS LA PILE DE MESSAGES, en haut au
            centre (`Toasts`, message persistant `CLE_MESSAGE_DU_CANAL`) : un
            bandeau posé ICI, en flux, poussait tout l'écran vers le bas en
            apparaissant, puis le remontait au retour du lien. */}

        <div className="flex min-h-0 flex-1">
          {/* Sur grand écran la liste des projets est une colonne posée là ; sur
              téléphone elle vit dans le panneau latéral, plus bas. */}
          <div className="hidden sm:flex">
            <Filet zone="Liste des projets">
              <Sidebar
                onOpenAgent={(agentId) => ouvrirAgent(agentId, false)}
                width={gauche.width}
                vue={vueCentrale}
                onOuvrirVue={ouvrirVue}
                onChercher={() => setRechercheProjets(true)}
                onOpenSettings={() => setSettingsOpen(true)}
                onNouvelAgent={() => setTiroirNouvelAgent(true)}
                service={lieuDeLaColonne}
                onCorpsDeService={setCorpsDeColonne}
                onCorpsDePage={setCorpsDePage}
              />
            </Filet>
          </div>
          <ResizeHandle
            cacheAuRepos
            className="hidden sm:block"
            onPointerDown={(event) => gauche.start(event, 'left')}
            onDoubleClick={gauche.reset}
          />

          {/* `data-zone="centre"` : repère pour l'étagement des fonds du thème
              sombre (`styles.css`) — inerte dans les six autres thèmes. */}
          <main
            ref={refZonePrincipale}
            data-zone="centre"
            /* La molette fait défiler la page même depuis ses marges. */
            onWheel={defilerDepuisLesMarges}
            className={cn('flex min-h-0 min-w-0 flex-1 flex-col', mobileView !== 'board' && 'hidden sm:flex')}
          >
            {/* LA BARRE D'EN-TÊTE, LA MÊME SUR CHAQUE PAGE : le fil d'Ariane à
                gauche, puis la cloche et les options de la page derrière
                trois points. Elle remplace le bandeau qui courait sur toute la
                largeur de l'écran. */}
            <EnteteDeZone
              chemin={cheminDeLaPage}
              titre={titreDeLaPage}
              /* LE NOM DU PROJET — et « Tableaux de bord » — ouvre la liste de
                 tous les projets, sous lui. */
              avant={boutonDesServices}
              /* UN SERVICE QUI A ÉCRIT LA SUITE DU FIL (le site, le client, la
                 création ouverte) : son nom redevient un cran, qui y ramène. */
              titreEnCran={suitePresente}
              onTitre={suitePresente ? () => retourDeLaSuite.current?.() : undefined}
              suite={<div ref={setCibleDeLaSuite} data-suite-du-fil="barre" className="contents" />}
              menuDuTitre={
                surTableauxDeBord || (vueCentrale === 'projet' && activeProject)
                  ? (declencheur) => (
                      <MenuDesProjets
                        declencheur={declencheur}
                        surTableauxDeBord={surTableauxDeBord}
                        onOuvrirVue={ouvrirVue}
                      />
                    )
                  : undefined
              }
              /* SUR TÉLÉPHONE, DANS UN ENFANT DU SERVICE, la flèche de retour
                 prend la place du bouton des projets : elle remonte d'un cran,
                 et aucune page n'a plus de barre de retour à elle. */
              onRetour={telephone && reperesDuRetour ? () => retourDUnCran.current?.() : undefined}
              reperesDeRetour={telephone && reperesDuRetour ? reperesDuRetour : undefined}
              onOuvrirColonne={() => setProjetsOuverts(true)}
              pointDeColonne={!liaison.enLigne || liaison.ailleurs ? { classe: liaison.classe, texte: liaison.texte } : null}
              /* LES OPTIONS DU PROJET : sur ordinateur, la colonne de gauche
                 les porte (`forme="colonne"`) et la barre n'a plus de bouton à
                 trois points ; sur téléphone, où la colonne vit dans un
                 panneau fermé, elles restent derrière ce bouton — avec les
                 deux gestes de publication, qui ont quitté le bas de l'écran.
                 Thème, langue, terminal et redémarrage sont dans les
                 réglages, ouverts de partout. */
              menu={
                vueCentrale === 'projet' && activeProject ? (
                  <MenuGeneral
                    forme={telephone ? 'menu' : 'colonne'}
                    onOpenDashboard={ouvrirTableauDeBord}
                    onOuvrirFichiers={setTiroirFichiers}
                    declencheur={<BoutonOptionsDuProjet />}
                  />
                ) : undefined
              }
            >
              {/* LES GESTES DE LA PAGE AFFICHÉE : chaque service y pose les
                  siens (`GestesDePage`), devant les boutons communs. */}
              <div ref={setCibleDesGestes} data-gestes-de-page="barre" data-rangee-de-boutons className={CLASSE_CIBLE_DES_GESTES} />
              {/* SUR ORDINATEUR, LA CLOCHE VIT DANS LE PIED DE LA COLONNE, à côté des
                  réglages (demande du 12/10/2026) ; sur téléphone, elle reste ici. */}
              {telephone ? <ClocheNotifications /> : null}
              {telephone ? <BoutonAssistantEntete /> : null}
            </EnteteDeZone>
            <FournirLaCibleDesGestes value={cibleDesGestes}>
            <CibleDuBasDePage.Provider value={basDePage}>
            {vueCentrale === 'notes' ? (
              <Filet zone="Notes">
                {/* LE MORCEAU DE L'ÉCRAN EST ENCORE EN ROUTE : sa silhouette
                    tient la place, au lieu de laisser toute la zone du milieu
                    vide le temps du téléchargement. */}
                <PanneauALaDemande monte attente={<AttenteEcran><SilhouetteNotes /></AttenteEcran>}>
                  <NotesPage
                    projectId={activeProject?.id ?? null}
                    vise={elementVise.notes ?? null}
                    onVise={(noteId) => setElementVise((v) => ({ ...v, notes: noteId }))}
                  />
                </PanneauALaDemande>
              </Filet>
            ) : vueCentrale === 'coffre' ? (
              <Filet zone="Coffre-fort">
                <PanneauALaDemande monte attente={<AttenteEcran><SilhouetteCoffre /></AttenteEcran>}>
                  <CoffreFort
                    open
                    enPage
                    onClose={() => ouvrirVue('projet')}
                    vise={elementVise.coffre ?? null}
                    onVise={(ficheId) => setElementVise((v) => ({ ...v, coffre: ficheId }))}
                  />
                </PanneauALaDemande>
              </Filet>
            ) : vueCentrale === 'memoire' ? (
              <Filet zone="Mémoire">
                <PanneauALaDemande monte attente={<AttenteEcran><SilhouetteCoffre /></AttenteEcran>}>
                  <MemoireClasseurs
                    open
                    enPage
                    onClose={() => ouvrirVue('projet')}
                    vise={{
                      porteeId: elementVise.memoirePortee ?? null,
                      ficheId: elementVise.memoireFiche ?? null,
                      uniteId: elementVise.memoireUnite ?? null,
                    }}
                    onVise={(vu) =>
                      setElementVise((v) => ({
                        ...v,
                        memoirePortee: vu.porteeId,
                        memoireFiche: vu.ficheId,
                        memoireUnite: vu.uniteId,
                      }))
                    }
                  />
                </PanneauALaDemande>
              </Filet>
            ) : vueCentrale === 'espace-client' ? (
              <Filet zone="Espace client">
                {/* La silhouette de l'espace client prend TOUTE la zone, sans le
                    cadre `AttenteEcran` : cet écran-là n'a pas de marges, il
                    colle aux bords comme le vrai (`EspaceHaiko`). */}
                <PanneauALaDemande monte attente={<SilhouetteEspaceHaiko />}>
                  <EspaceHaiko
                    vise={espaceVise}
                    onVise={(vu) => setEspaceVise(vu)}
                  />
                </PanneauALaDemande>
              </Filet>
            ) : vueCentrale === 'backups' ? (
              <Filet zone="Backups">
                <PanneauALaDemande monte attente={<AttenteEcran><SilhouetteBackups /></AttenteEcran>}>
                  <Backups
                    open
                    enPage
                    onClose={() => ouvrirVue('projet')}
                    vise={elementVise.backups ?? null}
                    onVise={(siteId) => setElementVise((v) => ({ ...v, backups: siteId }))}
                  />
                </PanneauALaDemande>
              </Filet>
            ) : vueCentrale === 'surveillance' ? (
              <Filet zone="Surveillance">
                <PanneauALaDemande monte attente={<AttenteEcran><SilhouetteSurveillance /></AttenteEcran>}>
                  <Surveillance
                    open
                    enPage
                    onClose={() => ouvrirVue('projet')}
                    vise={elementVise.surveillance ?? null}
                    onVise={(siteId) => setElementVise((v) => ({ ...v, surveillance: siteId }))}
                  />
                </PanneauALaDemande>
              </Filet>
            ) : vueCentrale === 'marketing' ? (
              <Filet zone="Marketing">
                <PanneauALaDemande monte attente={<AttenteEcran><SilhouetteMarketing /></AttenteEcran>}>
                  <Marketing
                    open
                    enPage
                    onClose={() => ouvrirVue('projet')}
                    vise={elementVise.marketing ?? null}
                    onVise={(projectId) => setElementVise((v) => ({ ...v, marketing: projectId }))}
                    onOuvrirCarte={ouvrirCarteDepuisUnService}
                  />
                </PanneauALaDemande>
              </Filet>
            ) : vueCentrale === 'studio' && state.studioOuvert ? (
              <Filet zone="Studio">
                <PanneauALaDemande monte attente={<AttenteEcran><SilhouetteStudio /></AttenteEcran>}>
                  <Studio
                    open
                    enPage
                    onClose={() => ouvrirVue('projet')}
                    vise={elementVise.studio ?? null}
                    onVise={(creationId) => setElementVise((v) => ({ ...v, studio: creationId }))}
                  />
                </PanneauALaDemande>
              </Filet>
            ) : vueCentrale === 'statistiques' ? (
              <Filet zone="Statistiques">
                <PanneauALaDemande monte attente={<AttenteEcran><SilhouetteStatistiques /></AttenteEcran>}>
                  <Statistiques
                    open
                    enPage
                    onClose={() => ouvrirVue('projet')}
                    vise={elementVise.statistiques ?? null}
                    onVise={(siteId) => setElementVise((v) => ({ ...v, statistiques: siteId }))}
                    onOuvrirCarte={ouvrirCarteDepuisUnService}
                  />
                </PanneauALaDemande>
              </Filet>
            ) : vueCentrale === 'en-route' ? (
              pageEnRoute
            ) : dashboardOpen ? (
              <Filet zone="Résumé">
                <PanneauALaDemande monte attente={<SilhouetteResume />}>
                  <Dashboard />
                </PanneauALaDemande>
              </Filet>
            ) : activeProject ? (
              /* `sm:pb-3` répond à `mx-3` du bandeau flottant : l'espace
                 latéral existait déjà, il manquait sous le bandeau. Posé ICI
                 (hors du conteneur `data-tableau`) et pas sur `<main>` en
                 entier, pour ne pas toucher les autres écrans plein cadre
                 (l'espace client, notamment, est conçu sans marges) ni casser
                 le contrôle « il ferme le bas du tableau » de
                 `verif-bandeau-production.mjs`, qui mesure le bord bas de
                 `data-tableau` lui-même. Réservé à `sm:` et plus : sur
                 téléphone, `<nav data-menu-bas>` fournit déjà cet espace. */
              <div className="flex min-h-0 flex-1 flex-col sm:pb-3">
                <Filet zone="Tableau">
                  <Board projectId={activeProject.id} onOpenCard={ouvrirCarteDuTableau} />
                </Filet>
              </div>
            ) : !state.pret && !state.copieLocale ? (
              /* LE PREMIER ÉTAT DU SERVEUR N'EST PAS ENCORE ARRIVÉ : aucun projet
                 n'est choisi parce qu'on ne connaît pas encore la liste. On
                 dessine donc le tableau à venir en silhouette, au lieu d'annoncer
                 un vide qui n'en est pas un. */
              <SilhouetteTableau />
            ) : state.projects.length ? (
              /* AUCUN PROJET OUVERT : le centre montre ce qui est en route dans
                 tous les projets, plutôt qu'un vide. */
              pageEnRoute
            ) : (
              /* AUCUN PROJET DU TOUT : un pas-à-pas court et le bouton qui ouvre l'ajout. */
              <PasAPas
                repere="premier-projet"
                icone={<LayoutGrid className="h-6 w-6" />}
                titre={t('Votre premier projet')}
                explication={t('Un projet, c’est un site ou une application que vos agents font avancer, carte après carte.')}
                etapes={[
                  t('Créez le projet : un dépôt GitHub existant, ou un nouveau.'),
                  t('Décrivez ce que vous voulez à un agent : il en fait une carte.'),
                  t('Suivez la carte sur le tableau jusqu’à « À déployer », puis publiez quand vous le décidez.'),
                ]}
                action={<BoutonPremierProjet />}
              />
            )}
            </CibleDuBasDePage.Provider>
            </FournirLaCibleDesGestes>
          </main>

        </div>

        {/* La liste des projets, en panneau qui glisse depuis la gauche : un
            choix qu'on fait au passage, pas une destination. */}
        <SidePanel open={projetsOuverts} onClose={() => setProjetsOuverts(false)} title={t('Projets')}>
          <Filet zone="Liste des projets">
            <Sidebar
              onOpenAgent={(agentId) => {
                setProjetsOuverts(false);
                ouvrirAgent(agentId, false);
              }}
              onChoose={() => setProjetsOuverts(false)}
              vue={vueCentrale}
              onOuvrirVue={ouvrirVue}
              onChercher={() => {
                setProjetsOuverts(false);
                setRechercheProjets(true);
              }}
              onOpenSettings={() => {
                setProjetsOuverts(false);
                setSettingsOpen(true);
              }}
              onNouvelAgent={() => {
                setProjetsOuverts(false);
                setTiroirNouvelAgent(true);
              }}
            />
          </Filet>
        </SidePanel>

        {/* LE BAS DE L'ÉCRAN DU TÉLÉPHONE : UN SEUL BOUTON, JAMAIS UNE BARRE
            (demande du 11/10/2026 : « je ne veux plus la barre avec tableau,
            agent et fichiers, je veux juste un bouton nouvelle tâche »). Dans
            un projet, « Nouvelle tâche » fait naître une carte de ce projet ;
            hors de tout projet — les tableaux de bord —, « Nouvel agent » fait
            d'abord choisir le projet (`TiroirNouvelAgent`). Rien d'autre ne
            s'empile ici : les fichiers et les deux gestes de publication sont
            dans le menu à trois points du haut. Le conteneur reste dans le
            flux (shrink-0) : il réserve exactement la place du bouton, et le
            contenu ne passe jamais derrière. Le module de voix reste
            positionné à part (voir plus bas, <VoixAssistant />).
            SUR UN SERVICE (`geste-de-page`), LA BANDE EST PRÊTÉE À LA PAGE, qui
            y pose son geste principal (`GestePrincipal`) : même place, même
            bouton. Vide — une page sans geste, ou qui a ouvert un enfant —,
            elle ne prend aucune place (`empty:hidden`) ; ses marges sont celles
            de la page (`px-4`), pour que le bouton s'aligne sur le contenu. */}
        {menuBas === 'geste-de-page' ? (
          <nav
            ref={setCibleDuBas}
            data-menu-bas={menuBas}
            data-zone="centre"
            className="shrink-0 px-4 pb-2 pt-1 empty:hidden sm:hidden"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.5rem)' }}
          />
        ) : (
        <nav
          data-menu-bas={menuBas}
          // LE BAS DE L'ÉCRAN EMPRUNTE LE FOND DE LA ZONE QU'IL PROLONGE. Sans
          // ce repère il retombait sur `--bg`, une bande NOIRE en thème sombre
          // collée sous un tableau gris — deux fonds pour une seule page.
          data-zone="centre"
          className="shrink-0 px-3 pb-2 pt-1 sm:hidden"
          // Juste la zone sûre du téléphone en dessous, pas un doigt de plus.
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.5rem)' }}
        >
          {menuBas === 'nouvel-agent' ? (
            /* HORS DE TOUT PROJET : un seul geste, donc un seul bouton — plein,
               sur toute la largeur, comme sur la maquette des tableaux de bord. */
            <Button
              variant="creation"
              size="lg"
              data-bouton-nouvel-agent
              className="h-11 w-full justify-center gap-2 rounded-lg text-[14.5px]"
              onClick={() => setTiroirNouvelAgent(true)}
            >
              <Plus className="h-4 w-4 shrink-0" /> {t('Nouvel agent')}
            </Button>
          ) : (
            <BoutonNouvelleTacheDuBas
              projectId={state.activeProjectId}
              onCree={(id) => {
                carteRobotIdRef.current = id;
              }}
            />
          )}
        </nav>
        )}
        {/* Le tiroir des fichiers ne se télécharge qu'au premier clic. */}
        {state.activeProjectId ? (
          <PanneauALaDemande monte={tiroirFichiers !== null}>
            <TiroirFichiers
              projectId={state.activeProjectId}
              vue={tiroirFichiers}
              onClose={() => setTiroirFichiers(null)}
            />
          </PanneauALaDemande>
        ) : null}
        {tiroirNouvelAgent ? (
          <TiroirNouvelAgent
            open
            onClose={() => setTiroirNouvelAgent(false)}
            onCree={(id) => {
              carteRobotIdRef.current = id;
            }}
          />
        ) : null}

        {dropTarget ? (
          <div className="pointer-events-none fixed inset-0 z-50 border-2 border-dashed border-muted bg-voile/20" />
        ) : null}

        <Filet zone="Carte" onReprendre={() => setOpenCardId(null)}>
          {/* Fermé, le tiroir d'une carte ne rendait déjà rien : on ne monte
              donc rien, et son morceau n'est même pas demandé. */}
          <PanneauALaDemande monte={!!carteAffichee}>
            <CardPanel
              cardId={carteAffichee}
              onClose={() => setOpenCardId(null)}
              onglet={ongletCarte}
              onOnglet={setOngletCarte}
              onOuvrirVue={(vue) => {
                /* Un projet ou « Tableaux de bord » choisi depuis le fil de la
                   tâche : la tâche se referme et la destination s'affiche. */
                setOpenCardId(null);
                ouvrirVue(vue);
              }}
            />
          </PanneauALaDemande>
        </Filet>
        {/* LE TERMINAL DU SERVEUR : demandé depuis les réglages, il s'ouvre en
            page de la zone principale, la fenêtre des réglages refermée. */}
        <TerminalDeLApplication onOuverture={fermerLesReglages} />
        <Filet zone="Réglages" onReprendre={() => setSettingsOpen(false)}>
          <PanneauALaDemande monte={settingsOpen}>
            <SettingsView
              open={settingsOpen}
              onClose={() => setSettingsOpen(false)}
              page={settingsPage}
              onPageChange={setSettingsPage}
            />
          </PanneauALaDemande>
        </Filet>
        {/* LA CONFIGURATION D'UN PROJET, montée UNE fois pour toute
            l'application : son adresse vit ici, et il n'y en a jamais deux à
            l'écran. Fermée, son morceau n'est même pas demandé. */}
        <Filet zone="Réglages du projet" onReprendre={() => setConfigProjetId(null)}>
          <PanneauALaDemande monte={!!configProjetId}>
            <ProjectSettings
              project={state.projects.find((p) => p.id === configProjetId) ?? null}
              open={!!configProjetId}
              onClose={() => setConfigProjetId(null)}
              rubrique={configRubrique}
              onRubrique={setConfigRubrique}
            />
          </PanneauALaDemande>
        </Filet>
        {/* LE TIROIR DE L'AGENT DE CONFIGURATION D'UNE ÉTAPE, monté UNE fois :
            le bouton d'en-tête des rubriques l'ouvre par-dessus les réglages,
            la vignette du tableau et l'aiguillage des agents l'ouvrent seul.
            Son morceau n'est demandé qu'à la première ouverture. */}
        <Filet zone="Agent de configuration" onReprendre={() => setDemandeInitialeConfiguration(null)}>
          <PanneauALaDemande monte={!!demandeInitialeConfiguration}>
            <TiroirAgentDeConfiguration initiale={demandeInitialeConfiguration} />
          </PanneauALaDemande>
        </Filet>
        <Toasts />
        {/* Dans l'application installée, un lien vers un fichier s'ouvre ICI,
            dans une fenêtre refermable — il ne remplace plus tout l'écran. */}
        <VisionneuseDeLien />

        {/* AU MOINS UN MOTEUR AVANT D'UTILISER L'APPLICATION. Tant qu'aucun
            assistant en ligne de commande n'est installé ET connecté sur le
            serveur, chaque carte lancée retomberait aussitôt : l'écran est donc
            barré, et il se rouvre tout seul dès qu'un moteur répond
            (`shared/src/assistant-moteurs.ts`). Son filet est MUET : si
            l'assistant lui-même tombait, mieux vaut une application ouverte
            qu'un écran noir. */}
        {/* LA MISE EN ROUTE D'UNE INSTALLATION NEUVE, page par page
            (`assistant-demarrage.tsx`). Même filet muet : si l'assistant
            tombait, mieux vaut une application ouverte qu'un écran noir. */}
        <Filet zone="Assistant de premier démarrage" muet>
          <PanneauALaDemande monte={demarrageOuvert}>
            {state.settings?.assistant ? <AssistantDemarrage assistant={state.settings.assistant} /> : null}
          </PanneauALaDemande>
        </Filet>
        {/* LE DÉPÔT PUBLIC DE BELUGA BUILD A DU NOUVEAU : un bandeau en haut, au
            centre. Il ne montre rien sur une installation qui ne le suit pas,
            et se tait pendant la mise en route. */}
        {demarrageOuvert ? null : (
          <Filet zone="Bandeau de mise à jour" muet>
            <BandeauMiseAJour
              onOuvrirLInstallation={() => {
                setSettingsPage('installation');
                setSettingsOpen(true);
              }}
            />
          </Filet>
        )}
        {/* UNE ZONE ATTEND SES DONNÉES DEPUIS PLUS DE QUATRE SECONDES : le
            bandeau le dit, au lieu de laisser croire à une panne. Il se déduit
            des silhouettes affichées, donc vaut pour tous les écrans. */}
        <Filet zone="Bandeau de connexion lente" muet>
          <BandeauConnexionLente />
        </Filet>
        <Filet zone="Assistant de démarrage" muet>
          <PanneauALaDemande monte={assistantOuvert}>
            <AssistantMoteurs onOuvrirReglages={() => setSettingsOpen(true)} />
          </PanneauALaDemande>
        </Filet>
        {/* Le module de voix ouvre un micro et du son : ce qu'il fait de plus
            fragile ne doit pas emporter le tableau avec lui. Son filet ne
            REND RIEN quand il tombe — un bloc d'erreur flottant en bas de
            l'écran gênerait plus qu'il n'aiderait ; l'échec est déjà écrit
            dans la console et l'application, elle, continue. */}
        {/* La voix reste TOUJOURS montée — elle écoute et parle sans qu'on
            l'ouvre —, mais son morceau arrive APRÈS le premier affichage au
            lieu de le retarder. */}
        {/* L'ASSISTANT GLOBAL, le robot en bas à droite de tous les écrans. Son
            filet est muet : s'il tombe, l'application continue sans lui. */}
        <Filet zone="Assistant global" muet>
          <AssistantGlobal />
        </Filet>
        {/* La visite guidée du premier démarrage : une bulle à la fois, fermable. */}
        <Filet zone="Visite guidée" muet>
          <VisiteGuidee />
        </Filet>
        <Filet zone="Module de voix" muet>
          <PanneauALaDemande monte>
            <VoixAssistant />
          </PanneauALaDemande>
        </Filet>

      </div>
      </FournirLaColonneDeService>
      </FournirLaSuiteDuFil>
      </FournirLeMenuPrincipal>
      </FournirLeLieu>
      </EnteteDePageParDefaut.Provider>
    </TooltipProvider>
  );
}

/**
 * LE BOUTON « NOUVELLE TÂCHE » DU BAS DE L'ÉCRAN, sur téléphone, dans un projet.
 *
 * Il a remplacé la barre « Tableau / agent / Fichiers » (demande du
 * 11/10/2026) : plein, sur toute la largeur, le même dessin que « Nouvel
 * agent » des tableaux de bord. Il fait naître la carte de cadrage du projet
 * affiché et ouvre son fil — le même geste que le bouton de tête de la rangée
 * « Demande » sur ordinateur, qui ne se dessine plus sur téléphone : c'est donc
 * lui qui porte le repère `data-nouvelle-carte` des contrôles.
 *
 * La carte ainsi ouverte n'existe VRAIMENT que si quelque chose y est saisi :
 * `onCree` remet son identifiant à l'application, qui demande au serveur de la
 * ranger si elle se referme vide (voir l'effet sur `carteRobotIdRef` dans `App`).
 */
function BoutonNouvelleTacheDuBas({
  projectId,
  onCree,
}: {
  projectId: string | null;
  onCree: (cardId: string) => void;
}) {
  const state = useApp();
  const [busy, setBusy] = React.useState(false);
  /* Lien coupé : la carte ne naîtrait pas. Le bouton s'éteint et dit pourquoi. */
  const gele = gestesGeles(state.canal);
  const ouvrir = async () => {
    if (busy || !projectId) return;
    setBusy(true);
    try {
      await creerCarteAgent(projectId, onCree);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      variant="creation"
      size="lg"
      data-bouton-nouvelle-tache
      data-nouvelle-carte="planned"
      aria-label="Nouvelle tâche"
      aria-busy={busy}
      title={gele ? t(RAISON_CANAL_COUPE) : undefined}
      disabled={busy || gele || !projectId}
      className="h-11 w-full justify-center gap-2 rounded-lg text-[14.5px]"
      onClick={() => void ouvrir()}
    >
      {busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <Plus className="h-4 w-4 shrink-0" />}
      {t(TITRE_CARTE_DE_CADRAGE)}
    </Button>
  );
}
