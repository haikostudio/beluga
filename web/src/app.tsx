import * as React from 'react';
import { LayoutGrid, Columns3, MessageSquare, Loader2, Bot } from 'lucide-react';
import { TooltipProvider, Button, EmptyState, SidePanel } from '@/components/ui';
import { QuotaBar } from '@/components/quota-bar';
import { Sidebar } from '@/components/sidebar';
import { Board } from '@/components/board';
import {
  SilhouetteCoffre,
  SilhouetteEspaceHaiko,
  SilhouetteNotes,
  SilhouetteBackups,
  SilhouetteSurveillance,
  SilhouetteMarketing,
  SilhouetteStatistiques,
  SilhouetteTableau,
  SilhouetteEnRoute,
} from '@/components/silhouettes';
import { Toasts } from '@/components/toasts';
import { PanneauALaDemande, prechargerAuRepos } from '@/lib/panneau-a-la-demande';
import { useResizable, ResizeHandle } from '@/components/resizer';
import { abonnerAuxNotifications } from '@/lib/abonnement-push';
import { client } from '@/lib/client';
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
  ongletAReprendre,
  carteRobotEstVide,
  assistantNecessaire,
  Card,
  vuePleine,
  menuBasTelephone,
  type EcranNavigateur,
  type ElementVise,
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
/*
 * La CONVERSATION est le seul cas limite : sur un grand écran elle s'ouvre
 * d'entrée, sur téléphone elle attend son onglet. Elle emporte avec elle la
 * barre d'écriture et l'affichage des messages — le plus gros morceau après le
 * tableau — et le premier écran d'un téléphone est le TABLEAU. Elle part donc
 * elle aussi à part, et se précharge au repos.
 */
const chargerConversation = () => import('@/components/right-panel');

const RightPanel = React.lazy(() => chargerConversation().then((m) => ({ default: m.RightPanel })));

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
import { AssistantGlobal } from '@/components/assistant-global';
const VoixAssistant = React.lazy(() => chargerVoix().then((m) => ({ default: m.VoixAssistant })));
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

/** Les destinations de la barre du bas, sur téléphone. */
const ONGLETS_MOBILES = ['board', 'chat'] as const;
type OngletMobile = (typeof ONGLETS_MOBILES)[number];

/** Où l'on retient le choix « ouvert / replié » du volet de droite. */
const CLE_VOLET_DROIT = 'beluga.volet-droit.ouvert';

/** Le volet de droite commence replié, sauf choix contraire déjà retenu. */
function choixInitialVoletDroit(): boolean {
  if (typeof window === 'undefined') return false;
  const retenu = window.localStorage.getItem(CLE_VOLET_DROIT);
  return retenu === '1';
}


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
  const stateRef = React.useRef(state);
  stateRef.current = state;
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  /* LA SOUS-PAGE DES RÉGLAGES vit dans l'adresse, comme la carte ouverte : les
     réglages sont un menu de pages, un lien doit pouvoir en désigner une. */
  const [settingsPage, setSettingsPage] = React.useState<string | undefined>(undefined);
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
  /* LA BARRE DU BAS DU TÉLÉPHONE N'EXISTE QUE DANS UN PROJET (Tableau / agent /
     Fichiers) ou sur les tableaux de bord (« Nouvel agent ») : aucune sur les
     autres vues pleines — marketing, coffre, notes… (`menuBasTelephone`). */
  const menuBas = menuBasTelephone(vueCentrale, !!state.activeProjectId);
  const [rightOpen, setRightOpenEtRetenir] = React.useState(choixInitialVoletDroit);
  const setRightOpen = React.useCallback((valeur: boolean | ((precedent: boolean) => boolean)) => {
    setRightOpenEtRetenir((precedent) => {
      const suivant = typeof valeur === 'function' ? valeur(precedent) : valeur;
      try {
        window.localStorage.setItem(CLE_VOLET_DROIT, suivant ? '1' : '0');
      } catch {
        /* navigation privée : le choix vaut pour la session, c'est tout. */
      }
      return suivant;
    });
  }, []);
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

  // Largeurs des deux panneaux, retenues d'une session à l'autre.
  const gauche = useResizable('sidebar', { initial: 196, min: 150, max: 420 });
  const droite = useResizable('panel', { initial: 360, min: 280, max: 720 });

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
  React.useEffect(
    () =>
      client.onOpenCard((cardId) => {
        // Une carte ouverte depuis les réglages (la carte d'un ajout de LLM)
        // doit se voir : la fenêtre des réglages se referme devant elle.
        setSettingsOpen(false);
        setVueCentrale('projet');
        setElementVise({});
        setEspaceVise(undefined);
        setOpenCardId(cardId);
      }),
    [],
  );

  /*
   * LA CARTE DU BOUTON ROBO SE JUGE À SA FERMETURE. Dès que `openCardId`
   * cesse d'être la carte tenue par `carteRobotIdRef` (le tiroir s'est
   * refermé, ou une autre carte a pris sa place), on regarde si un message
   * est parti ou si un brouillon reste dans le champ ; sans l'un ni l'autre,
   * la carte n'a jamais vraiment existé pour l'utilisateur et repart en base.
   */
  const carteRobotPrecedenteRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    const precedente = carteRobotPrecedenteRef.current;
    carteRobotPrecedenteRef.current = openCardId;
    if (!precedente || precedente === openCardId || precedente !== carteRobotIdRef.current) return;
    carteRobotIdRef.current = null;
    const s = stateRef.current;
    const card = s.cards[precedente];
    if (!card) return;
    const conversation = s.cardMessages[precedente];
    const agentId = card.agentId ?? conversation?.activeAgentId;
    const brouillon = agentId ? (s.prefs[`draft.${agentId}`] as string | undefined) : undefined;
    if (!carteRobotEstVide({ nbMessages: conversation?.messages?.length ?? 0, brouillon })) return;
    void client.call({ type: 'card.delete', id: precedente }).catch(() => {});
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
        setOpenCardId(cardId);
        return;
      }
      setOpenCardId(null);
      // L'onglet du bas n'existe que sur téléphone, et il est RETENU : un clic
      // fait sur ordinateur n'a pas à changer ce qu'on retrouvera sur téléphone.
      if (window.innerWidth < 640) setMobileView('board');
      // Aucun message éphémère pour les autres : un simple renseignement n'est
      // pas l'un des trois genres qui alertent (`messageAlerte`).
      if (agent.role === 'deploy') {
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
    [setMobileView],
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
  }, [state.activeProjectId, state.cards, state.prefs, openCardId]);

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
    if (ecran.vue === 'projet') {
      // Ne re-déclencher l'ouverture serveur que si le projet change vraiment.
      if (client.lireEtat().activeProjectId !== ecran.projectId) {
        client.setActiveProject(ecran.projectId);
      }
      setOpenCardId(ecran.cardId ?? null);
      setOngletCarte(ecran.onglet ?? null);
      return;
    }
    /* UN SERVICE PLEIN NE REFERME PAS LA CARTE OUVERTE : il la recouvre, et la
       retrouve intacte au retour. Seul l'accueil, qui ne désigne rien, remet
       le volet à zéro. */
    if (destination) return;
    setOpenCardId(null);
  }, []);

  // Au chargement, et à chaque Précédent/Suivant, l'adresse commande l'écran.
  const adresseLue = React.useRef(false);
  React.useEffect(() => {
    const suivreAdresse = () => appliquerEcran(lireFragment(window.location.hash));
    suivreAdresse();
    adresseLue.current = true;
    window.addEventListener('popstate', suivreAdresse);
    return () => window.removeEventListener('popstate', suivreAdresse);
  }, [appliquerEcran]);

  // En sens inverse, chaque changement d'écran réécrit l'adresse. Un même écran
  // ne rajoute rien à l'historique (replaceState, juste pour rafraîchir le
  // slug) ; un écran différent y pousse une entrée, pour que Précédent revienne.
  const titreCarteOuverte = openCardId ? state.cards[openCardId]?.title ?? null : null;
  const premiereEcriture = React.useRef(true);
  React.useEffect(() => {
    if (!adresseLue.current) return;
    // Le tout premier rendu vient de LIRE l'adresse : ne pas la réécrire à
    // partir d'un état pas encore rafraîchi, sous peine d'effacer le fragment
    // collé avant qu'il ne soit appliqué.
    if (premiereEcriture.current) {
      premiereEcriture.current = false;
      return;
    }
    const ecran: EcranNavigateur = settingsOpen
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
          projectId: state.activeProjectId,
          cardId: openCardId,
          titreCarte: titreCarteOuverte,
          onglet: ongletCarte,
        });

    const cible = construireFragment(ecran);
    const url = cible ? '#' + cible : window.location.pathname + window.location.search;
    if (memeEcran(lireFragment(window.location.hash), ecran)) {
      if (window.location.hash.replace(/^#/, '') !== cible) {
        window.history.replaceState(window.history.state, '', url);
      }
      return;
    }
    window.history.pushState(window.history.state, '', url);
  }, [
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
    if (!productionDemandee) return;
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
  const assistantOuvert = assistantNecessaire({
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

  /*
   * UNE CARTE OUVERTE DEPUIS LA PAGE « EN ROUTE » : le même tiroir que le
   * tableau, sans quitter la page ni changer de projet. Le tiroir lit la
   * carte dans `cards` : elle y est versée d'abord.
   */
  const ouvrirCarteEnRoute = React.useCallback((card: Card) => {
    client.verserCarte(card);
    setOpenCardId(card.id);
  }, []);
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

  if (state.connecting && !state.pret) {
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
            if (!openCardId && !rightOpen) {
              client.pushToast('warning', t('Ouvrez d\'abord une conversation pour y déposer un fichier.'));
            } else {
              client.pushToast('info', t('Déposez le fichier directement dans la barre d\'écriture de la conversation.'));
            }
          }
        }}
      >
        <QuotaBar
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenProjects={() => setProjetsOuverts(true)}
          onOpenDashboard={ouvrirTableauDeBord}
          rightOpen={rightOpen}
          onToggleRight={() => setRightOpen((value) => !value)}
          titreDeVue={vueCentrale === 'en-route' ? t('Tableaux de bord') : undefined}
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
              />
            </Filet>
          </div>
          <ResizeHandle
            className="hidden sm:block"
            onPointerDown={(event) => gauche.start(event, 'left')}
            onDoubleClick={gauche.reset}
          />

          {/* `data-zone="centre"` : repère pour l'étagement des fonds du thème
              sombre (`styles.css`) — inerte dans les six autres thèmes. */}
          <main
            data-zone="centre"
            className={cn('flex min-h-0 min-w-0 flex-1 flex-col', mobileView !== 'board' && 'hidden sm:flex')}
          >
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
                    onOuvrirCarte={ouvrirCarteEnRoute}
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
                    onOuvrirCarte={ouvrirCarteEnRoute}
                  />
                </PanneauALaDemande>
              </Filet>
            ) : vueCentrale === 'en-route' ? (
              pageEnRoute
            ) : dashboardOpen ? (
              <Filet zone="Résumé">
                <PanneauALaDemande monte>
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
                  <Board projectId={activeProject.id} onOpenCard={setOpenCardId} />
                </Filet>
              </div>
            ) : !state.pret ? (
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
              <EmptyState
                icon={<LayoutGrid className="h-5 w-5" />}
                title={t('Aucun projet sélectionné')}
                hint={t('Ajoutez un projet depuis la colonne de gauche pour commencer.')}
              />
            )}
            {/* « NOUVEL AGENT » SUR ORDINATEUR AUSSI, HORS DE TOUT PROJET : le même
                geste que la barre du bas du téléphone (`data-menu-bas`, masquée
                dès `sm:`), posé en bouton flottant au centre bas de CETTE zone
                — ni sur la colonne de gauche, ni sur le volet de droite. Une
                bande de hauteur nulle au pied de `<main>` lui sert d'ancre : il
                flotte au-dessus du contenu sans rien pousser ni toucher aux
                autres écrans. Les deux écrans concernés gardent un blanc en
                bas (`sm:pb-20`) pour que leur dernière carte reste visible. */}
            {horsProjet ? (
              <div className="pointer-events-none relative hidden h-0 shrink-0 justify-center sm:flex">
                <Button
                  variant="default"
                  size="lg"
                  data-bouton-nouvel-agent-bureau
                  className="pointer-events-auto absolute bottom-5 z-20 gap-1.5 rounded-full shadow-lg"
                  onClick={() => setTiroirNouvelAgent(true)}
                >
                  <Bot className="h-3.5 w-3.5 shrink-0" />  {t('Nouvel agent')}
                </Button>
              </div>
            ) : null}
          </main>

          {activeProject && rightOpen && !vuePleine(vueCentrale) ? (
            <>
              <ResizeHandle
                className="hidden lg:block"
                onPointerDown={(event) => droite.start(event, 'right')}
                onDoubleClick={droite.reset}
              />
              {/* `data-zone="droite"` : repère pour l'étagement des fonds du
                  thème sombre (`styles.css`) — inerte dans les six autres
                  thèmes. */}
              <aside
                data-zone="droite"
                className="hidden shrink-0 border-l border-border lg:flex lg:flex-col"
                style={{ width: `${droite.width}px` }}
              >
                <Filet zone="Chef d'orchestre">
                  <PanneauALaDemande monte>
                    <RightPanel projectId={activeProject.id} />
                  </PanneauALaDemande>
                </Filet>
              </aside>
            </>
          ) : null}

          {/* Sur téléphone, l'écran Fichiers prend toute la place — et il prend
              alors le fond de la ZONE DU MILIEU, pas celui du volet de droite.
              L'étagement des douze palettes fait de « droite » la teinte la
              plus CLAIRE : juste, quand ce volet est une bande à côté du
              tableau ; faux quand il occupe l'écran entier, où il tranchait
              alors avec tout le reste de l'application. Le menu du bas suit le
              même repère (voir `data-zone` sur `nav`, plus bas). */}
          {activeProject && mobileView === 'chat' ? (
            <aside data-zone="centre" className="flex min-w-0 flex-1 flex-col sm:hidden">
              <Filet zone="Chef d'orchestre">
                <PanneauALaDemande monte>
                  <RightPanel projectId={activeProject.id} />
                </PanneauALaDemande>
              </Filet>
            </aside>
          ) : null}
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
            />
          </Filet>
        </SidePanel>

        {/* Menu de navigation mobile : un bloc FLOTTANT, arrondi, détaché des
            trois bords — aucun filet sur toute la largeur, qui coupait l'écran
            en deux. Le conteneur reste dans le flux (shrink-0) : il réserve
            donc exactement la place du menu, et le contenu ne passe jamais
            derrière. Dans un projet : Tableau, le ROND « agent » au centre
            (`BoutonRobot`, une nouvelle carte d'agent du projet affiché), puis
            Fichiers. HORS DE TOUT PROJET — les tableaux de bord (« en-route »,
            aussi montrés quand aucun projet n'est ouvert) et les statistiques
            (« tableau-de-bord ») —, Tableau et Fichiers n'ont pas de sens : la
            barre ne porte qu'un bouton « Nouvel agent », qui ouvre le volet de
            choix du projet (`TiroirNouvelAgent`). Le module de voix reste positionné à part
            (voir plus bas, <VoixAssistant />, ancré par sa propre position
            fixe). */}
        {menuBas ? (
        <nav
          data-menu-bas={menuBas}
          // LE MENU DU BAS EMPRUNTE LE FOND DE LA ZONE QU'IL PROLONGE. Sans ce
          // repère il retombait sur `--bg`, une bande NOIRE en thème sombre
          // collée sous un tableau gris — deux fonds pour une seule page.
          // Sur téléphone, les deux écrans (le tableau et les fichiers) portent
          // désormais le MÊME repère « centre » : la bande du bas ne change
          // donc plus de teinte d'un onglet à l'autre.
          data-zone="centre"
          className="shrink-0 px-3 pb-2 pt-1 sm:hidden"
          // Juste la zone sûre du téléphone en dessous, pas un doigt de plus.
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.5rem)' }}
        >
          {/* LA BARRE REPREND LE FOND DE SA ZONE, PAS UNE TEINTE À ELLE. Elle
              posait `--surface` en dur : sur les douze palettes, cela remettait
              exactement la bande d'une autre couleur que le repère `data-zone`
              du parent sert justement à éviter. Le fond de la zone est publié
              par ce repère dans `--fond-zone` (`web/src/styles.css`) : on le
              reprend tel quel, et la barre se détache par son filet seul. */}
          {/* LE MENU DU BAS RESPIRE AUTANT EN HAUT ET EN BAS QU'À GAUCHE ET À
              DROITE. La barre porte `p-1` sur ses quatre côtés, mais sa HAUTEUR
              était dictée par le rond du centre (44 px) : les deux boutons
              (28 px) flottaient alors dans 12 px de vide en haut comme en bas,
              contre 4 px sur les côtés. Le rond et les boutons partagent
              désormais la MÊME hauteur (36 px), et les 4 px de `p-1` sont les
              seuls blancs de la barre, sur les quatre côtés. */}
          {menuBas === 'nouvel-agent' ? (
            <div
              className="grid grid-cols-1 items-center rounded-2xl border border-border p-1"
              style={{ backgroundColor: 'hsl(var(--fond-zone))' }}
            >
              <Button
                variant="ghost"
                size="sm"
                data-bouton-nouvel-agent
                className="h-9 w-full justify-center gap-1.5 rounded-xl px-1 text-xs"
                onClick={() => setTiroirNouvelAgent(true)}
              >
                <Bot className="h-3.5 w-3.5 shrink-0" />  {t('Nouvel agent')}
              </Button>
            </div>
          ) : (
          <div
            className="grid grid-cols-[1fr_auto_1fr] items-center gap-1 rounded-2xl border border-border p-1"
            style={{ backgroundColor: 'hsl(var(--fond-zone))' }}
          >
            {/* L'onglet ACTIF se dit à voix haute (`aria-current`) autant qu'il se
                colore : une couleur écrite en dur ne se vérifie pas, et un
                contrôle qui la cherchait a fini par juger une classe disparue. */}
            <Button
              variant="ghost"
              size="sm"
              aria-current={mobileView === 'board' && !vuePleine(vueCentrale) ? 'page' : undefined}
              className={cn(
                'h-9 w-full justify-center gap-1 rounded-xl px-1 text-xs',
                mobileView === 'board' && !vuePleine(vueCentrale) && 'bg-actif text-actif-fg hover:bg-actif hover:text-actif-fg',
              )}
              onClick={() => {
                setVueCentrale('projet');
                setMobileView('board');
              }}
            >
              <Columns3 className="h-3.5 w-3.5 shrink-0" />  {t('Tableau')}
</Button>
            <BoutonRobot
              projectId={state.activeProjectId}
              onCree={(id) => {
                carteRobotIdRef.current = id;
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              aria-current={mobileView === 'chat' && !vuePleine(vueCentrale) ? 'page' : undefined}
              className={cn(
                'h-9 w-full justify-center gap-1 rounded-xl px-1 text-xs',
                mobileView === 'chat' && !vuePleine(vueCentrale) && 'bg-actif text-actif-fg hover:bg-actif hover:text-actif-fg',
              )}
              onClick={() => {
                setVueCentrale('projet');
                setMobileView('chat');
              }}
            >
              <MessageSquare className="h-3.5 w-3.5 shrink-0" />  {t('Fichiers')}
            </Button>
          </div>
          )}
        </nav>
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
          <PanneauALaDemande monte={!!openCardId}>
            <CardPanel
              cardId={openCardId}
              onClose={() => setOpenCardId(null)}
              onglet={ongletCarte}
              onOnglet={setOngletCarte}
            />
          </PanneauALaDemande>
        </Filet>
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
        <Filet zone="Module de voix" muet>
          <PanneauALaDemande monte>
            <VoixAssistant />
          </PanneauALaDemande>
        </Filet>

      </div>
    </TooltipProvider>
  );
}

/**
 * LE BOUTON ROBO, au centre du menu du bas — à la place de l'ancien rond du
 * module de voix. Un clic fait naître une VRAIE carte de cadrage
 * (`card.create`, `cadrage: true`, même geste que « Nouvelle tâche » en tête
 * de « Planifié ») dans le projet affiché, et l'ouvre aussitôt en tiroir.
 * Elle ne survit que si quelque chose y est saisi : `onCree` prévient
 * l'appelant de son identifiant, pour qu'il la range si le tiroir se referme
 * vide (voir l'effet sur `carteRobotIdRef` dans `App`).
 */
function BoutonRobot({
  projectId,
  onCree,
}: {
  projectId: string | null;
  onCree: (cardId: string) => void;
}) {
  const [busy, setBusy] = React.useState(false);
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
    <button
      type="button"
      data-bouton-robot
      aria-label="Nouvel agent"
      aria-busy={busy}
      disabled={busy || !projectId}
      onClick={() => void ouvrir()}
      /*
       * LE ROND DU CENTRE EST PLUS FONCÉ QUE LA BARRE. Il portait `bg-surface`,
       * exactement le fond de la barre : le rond ne se voyait pas. `--voile` est
       * la teinte SOMBRE de chaque thème (celle qui assombrit la page derrière
       * une fenêtre) : posée en faible part par-dessus le fond de la barre, elle
       * fonce d'un cran sans inventer de couleur — et le fait dans les douze
       * palettes, y compris les claires, où `--raised` ÉCLAIRCIT au lieu de
       * foncer. Même hauteur que les deux boutons (36 px) : la barre garde ses
       * 4 px de blanc sur ses quatre côtés.
       */
      className="mx-auto grid h-9 w-9 shrink-0 place-items-center rounded-full bg-voile/20 text-text transition-colors hover:bg-voile/30 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
    </button>
  );
}
