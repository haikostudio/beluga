import { FenetreDAccordOrdinateur } from '@/components/fenetre-d-accord-ordinateur';
import { FenetreDeLiaison } from '@/components/fenetre-de-liaison';
import { EVENEMENT_OUVRIR_UN_AGENT, allerALEcranDeLAgentDeService } from '@/lib/ouvrir-un-agent';
import { EVENEMENT_QUESTION_DU_DEPANNEUR } from '@/lib/evenements-publier';
import * as React from 'react';
import { aLeNiveauSurLeProjet } from '@/lib/mes-droits';
import { appliquerTiroirs, oublierLAttenteSiEcranChange, usePileDeTiroirs, useTiroirAdresse } from '@/lib/tiroirs-adresse';
import { LayoutGrid, Loader2, Plus } from '@/components/ui/icones';
import { BandeauMiseAJour } from '@/components/bandeau-mise-a-jour';
import { BandeauConnexionLente } from '@/components/bandeau-connexion-lente';
import { TooltipProvider, Button, CibleDuBasDePage, DialogTitle, Drawer, EnteteDePageParDefaut, SidePanel, defilerDepuisLesMarges, CLASSE_LARGEUR_DE_CONTENU, CLASSE_MARGES_DE_PAGE } from '@/components/ui';
import { BoutonPremierProjet, PasAPas } from '@/components/pas-a-pas';
import { VisiteGuidee } from '@/components/visite-guidee';
import { BoutonOptionsDuProjet, MenuGeneral } from '@/components/quota-bar';
import { CLES_DES_SERVICES, FeuilleDesServices, OUTILS_DE_CREATION, useServicesOuverts } from '@/components/services';
import { BandeDeZone } from '@/components/bande-de-zone';
import { FenetreDeService } from '@/components/fenetre-de-service';
import { Key, Library } from '@/components/ui/icones';
import { RechercheCentrale } from '@/components/recherche-centrale';
import { TerminalDeLApplication } from '@/components/terminal-de-l-application';
import { QuestionDuPartage } from '@/components/question-du-partage';
import { demarrerLaMesureDeLEcran } from '@/lib/mesure-d-usage';
import { BandeSousLHeure } from '@/components/bande-sous-l-heure';
import { estTelephone, useTelephone } from '@/lib/telephone';
import { useMesureDuClavier } from '@/lib/mesure-du-clavier';
import { Sidebar } from '@/components/sidebar';
import {
  BoutonDuMenuPrincipal,
  EnteteDePage,
  EnteteDeZone,
  FournirLaCibleDesGestes,
  FournirLaCibleDuPrincipalOrdinateur,
  FournirLeRegistreDuCoin,
  FournirLeRegistreDuMenuDuHaut,
  creerLeRegistreDuMenuDuHaut,
  FournirLaSuiteDuFil,
  CLASSE_CIBLE_DES_GESTES,
  FournirLeLieu,
  FournirLeCranDesTableauxDeBord,
  FournirLeMenuPrincipal,
  type CranDuChemin,
  type ReperesDeRetour,
} from '@/components/entete-de-zone';
import { FournirLaDeclarationDesGestesDuBas, FournirLaDeclarationDuNiveauDuBas, MenuDuBasDuTelephone, useGestesDeLApplication, type GestesDuBas } from '@/components/menu-du-bas';
import { EtagesDuTelephone, FournirLaDeclarationDuProjet, useEtageDuProjetActif, type EtageDuProjet } from '@/components/haut-du-telephone';
import { FournirLaColonneDeService } from '@/components/colonne-de-service';
import { PageDuProjet } from '@/components/page-du-projet';
import {
  EVENEMENT_OUVRIR_LES_OUTILS,
  FournirLaBarreDuProjet,
  FilDuProjet,
  FournirLaCibleDuMenuDeTache,
  estUnServiceDuProjet,
  titreDOnglet,
  type BarreDuProjet,
} from '@/components/barre-du-projet';
import { naviguerVers } from '@/components/ui/lien-interne';
import { BoutonPublier, BoutonPublierDuHaut, EVENEMENT_OUVRIR_PUBLIER, FeuillePublier, useCompteAPublier } from '@/components/menu-publier';
import { ouvrirLePublierDuProjet } from '@/components/mises-en-ligne';
import { FournirLeChoixDeLaPortee, FournirLeFiltreCentral, FournirLeProjetDuService } from '@/components/projet-du-service';
import { CLES_SERVICES_DU_MENU, FilDesPagesDeService, FiltreDuProjetDeLaPage, TOUS_LES_PROJETS, type CibleDeCreation, type TypeDAgent } from '@/components/menus-de-la-colonne';
import { creerUnAgentDeType, ouvrirDansLeProjet } from '@/lib/creer-un-agent';
import { FeuilleDesTaches } from '@/components/feuille-des-taches';
import { Celebrations } from '@/components/celebration';
import {
  SilhouetteCoffre,
  SilhouetteTableauDeService,
  SilhouetteEspaceHaiko,
  SilhouetteMarketing,
  SilhouetteAtelier,
  SilhouetteStudio,
  SilhouetteStatistiques,
  SilhouetteTachesRecurrentes,
  SilhouetteAgents,
  SilhouetteEnRoute,
  SilhouetteResume,
} from '@/components/silhouettes';
import { Toasts } from '@/components/toasts';
import { PanneauALaDemande, prechargerAuRepos } from '@/lib/panneau-a-la-demande';
import { VuesGardees, useVuesGardees } from '@/lib/vues-gardees';
import { VueVisible } from '@/lib/vue-visible';
import { useResizable, ResizeHandle } from '@/components/resizer';
import type { VueFichiers } from '@/components/right-panel';
import { abonnerAuxNotifications } from '@/lib/abonnement-push';
import { brancherLeNatif } from '@/lib/natif';
import { client } from '@/lib/client';
import { lieuDuServiceDeLaCarte, serviceDeLaCarteALEcran } from '@/lib/service-de-carte';
import { lancerIntervalleVisible } from '@/lib/veille';
import { usePref, writePref } from '@/lib/prefs';
import { CLE_VOIX_VISIBLE } from '@/lib/cles-de-voix';
import { useThemeApplique } from '@/lib/theme';
import { useApp } from '@/lib/use-app';
import { Filet } from '@/components/filet';
import { TiroirNouvelAgent, creerCarteAgent } from '@/components/tiroir-nouvel-agent';
import { cn } from '@/lib/utils';
import {
  CLE_ONGLET_MOBILE,
  cleCarteOuverte,
  construireFragment,
  redirectionVersCommunication,
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
  menuDuBas,
  ecranDuBas,
  type NiveauDeclare,
  carteVisibleSurLaVue,
  vueDeDemarrage,
  carteARefermerSurChoixDeVue,
  gestesGeles,
  RAISON_CANAL_COUPE,
  type EcranNavigateur,
  type ElementVise,
  type LieuDeService,
  type VueCentrale,
  totalDesRendus,
  RUBRIQUE_CONFIG_PAR_DEFAUT,
  etapeDeLAgentDeConfiguration,
  voletDeLAgentDePublication,
  cleDesOngletsDuProjet,
  lireLesOnglets,
  ongletDObjet,
  ongletDeService,
  VUES_DE_FONCTIONNEMENT_EN_FENETRE,
  ongletDeTache,
  ouvrirLOnglet,
  rouvrirLOnglet,
  adresseDObjetReel,
  ongletsSansTachesRangees,
  ongletsSansLaCarte,
  EVENEMENT_CARTE_INTROUVABLE,
  type OngletDuProjet,
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
import { VisionneuseDesMedias } from '@/components/visionneuse-des-medias';
import { EVENEMENT_OUVRIR_LES_FICHIERS, ouvrirLesFichiers, type DemandeDOuvertureDesFichiers } from '@/lib/ouvrir-les-fichiers';
import { MenuDuHautTelephone } from '@/components/menu-du-haut-telephone';

/*
 * LES ÉCRANS QU'ON OUVRE PAR UN BOUTON SONT DES MORCEAUX À PART
 * (`web/src/lib/panneau-a-la-demande.tsx`). Aucun d'eux ne sert au premier
 * affichage — colonne de gauche et tableau —, et tous ensemble ils pesaient
 * plus du tiers du fichier téléchargé au démarrage.
 */
const chargerTableauDeBord = () => import('@/components/dashboard');
const chargerCoffreFort = () => import('@/components/coffre-fort');
/*
 * L'ESPACE CLIENT VU COMME HAIKO est un morceau à part, comme la porte servie
 * aux clients : c'est un écran qu'on ouvre de temps à autre, il n'a pas à
 * peser sur le premier affichage du tableau.
 */
const chargerEspaceHaiko = () => import('@/espace/espace-haiko');
const chargerBackups = () => import('@/components/backups');
const chargerSurveillance = () => import('@/components/surveillance');
const chargerSecurite = () => import('@/components/securite');
const chargerStudio = () => import('@/components/studio/studio');
const chargerCommunication2 = () => import('@/components/communication-v2/communication-v2');
const chargerStatistiques = () => import('@/components/statistiques');
const chargerTachesRecurrentes = () => import('@/components/taches-recurrentes');
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
import { EVENEMENT_ARCHIVAGE } from '@/lib/archivage-projet';
/* LA FENÊTRE D'ARCHIVAGE D'UN PROJET : chargée à la première demande seulement. */
const FenetreDArchivage = React.lazy(() => import('@/components/fenetre-d-archivage').then((m) => ({ default: m.FenetreDArchivage })));
/* LA FENÊTRE « FICHIERS » (bouton du haut de la colonne de gauche) : chargée à sa première ouverture seulement. */
const FenetreDesFichiers = React.lazy(() => import('@/components/fichiers/explorateur-de-fichiers').then((m) => ({ default: m.FenetreDesFichiers })));

const Dashboard = React.lazy(() => chargerTableauDeBord().then((m) => ({ default: m.Dashboard })));
const CoffreFort = React.lazy(() => chargerCoffreFort().then((m) => ({ default: m.CoffreFort })));
const chargerMemoire = () => import('@/components/memoire-classeurs');
const MemoireClasseurs = React.lazy(() => chargerMemoire().then((m) => ({ default: m.MemoireClasseurs })));
const EspaceHaiko = React.lazy(() => chargerEspaceHaiko().then((m) => ({ default: m.EspaceHaiko })));
const Backups = React.lazy(() => chargerBackups().then((m) => ({ default: m.Backups })));
const Securite = React.lazy(() => chargerSecurite().then((m) => ({ default: m.Securite })));
const Surveillance = React.lazy(() =>
  chargerSurveillance().then((m) => ({ default: m.Surveillance })),
);
const Studio = React.lazy(() => chargerStudio().then((m) => ({ default: m.Studio })));
const Communication2 = React.lazy(() => chargerCommunication2().then((m) => ({ default: m.Communication2 })));
const Statistiques = React.lazy(() => chargerStatistiques().then((m) => ({ default: m.Statistiques })));
const TachesRecurrentes = React.lazy(() => chargerTachesRecurrentes().then((m) => ({ default: m.TachesRecurrentes })));
/* LES PLAQUETTES CLIENT (`components/plaquettes.tsx`) : un morceau à part, chargé à la première ouverture. */
const Plaquettes = React.lazy(() => import('@/components/plaquettes').then((m) => ({ default: m.Plaquettes })));
const EnRoute = React.lazy(() => chargerEnRoute().then((m) => ({ default: m.EnRoute })));
const CardPanel = React.lazy(() => chargerTiroirCarte().then((m) => ({ default: m.CardPanel })));
const SettingsView = React.lazy(() => chargerReglages().then((m) => ({ default: m.SettingsView })));
const QuestionDuDepanneur = React.lazy(() =>
  import('@/components/question-du-depanneur').then((m) => ({ default: m.QuestionDuDepanneur })),
);
const QuestionDeConfiguration = React.lazy(() =>
  import('@/components/config-projet/question-de-configuration').then((m) => ({ default: m.QuestionDeConfiguration })),
);
const TiroirAgentDeConfiguration = React.lazy(() =>
  import('@/components/config-projet/agent-de-configuration').then((m) => ({ default: m.TiroirAgentDeConfiguration })),
);
const ProjectSettings = React.lazy(() =>
  chargerConfigProjet().then((m) => ({ default: m.ProjectSettings })),
);
import { BanniereExtension } from './components/banniere-extension';
import { SuiviDeConnect } from './components/reglages/suivi-de-connect';
import { AssistantGlobal } from '@/components/assistant-global';
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
/** LES OUTILS QUI OUVRENT DES OBJETS EN ONGLET À PART : une création, une campagne, une charte, une analyse. */
/** Les emplacements qu'un écran de la zone centrale remplit hors de lui. */
interface ValeursDeLaZone {
  suite: React.ComponentProps<typeof FournirLaSuiteDuFil>['value'];
  colonne: React.ComponentProps<typeof FournirLaColonneDeService>['value'];
  declarerProjet: React.ComponentProps<typeof FournirLaDeclarationDuProjet>['value'];
  declarerGestes: React.ComponentProps<typeof FournirLaDeclarationDesGestesDuBas>['value'];
  declarerNiveau: React.ComponentProps<typeof FournirLaDeclarationDuNiveauDuBas>['value'];
  cibleDesGestes: HTMLElement | null;
  registre: React.ComponentProps<typeof FournirLeRegistreDuMenuDuHaut>['value'];
  bas: React.ContextType<typeof CibleDuBasDePage>;
  principalOrdinateur: HTMLElement | null;
}
/* PLUS AUCUN MENU PROPRE DANS LA ZONE CENTRALE (13/11/2026) : chaque service y garde sa navigation dans la page. */
const COLONNE_COUPEE = { corps: null, definirNiveau: () => undefined, absente: true };
const rienAFaire = () => undefined;
/* UN ÉCRAN CACHÉ N'ÉCRIT SA SUITE NULLE PART (20/11/2026) : une suite fournie sans cible ne se rend pas (`SuiteDuFil`). */
const SUITE_MUETTE = { cible: null, retour: { current: null }, signaler: rienAFaire };

/**
 * UN ÉCRAN GARDÉ DE LA ZONE CENTRALE (onglets instantanés, 13/11/2026). Visible, il reçoit les vrais emplacements ;
 * caché, des emplacements VIDES — son titre, ses gestes, son bas, son menu de colonne et la suite du fil ne s'écrivent
 * nulle part, et il n'est ni lu ni atteignable au clavier (`inert`). La forme rendue est la MÊME dans les deux cas :
 * montrer ou cacher un écran ne le remonte jamais.
 */
function GardeDeVue({
  cle,
  visible,
  valeurs,
  projetDuService,
  children,
}: {
  cle: string;
  visible: boolean;
  valeurs: ValeursDeLaZone;
  projetDuService: React.ComponentProps<typeof FournirLeProjetDuService>['value'];
  children: React.ReactNode;
}) {
  return (
    <FournirLaSuiteDuFil value={visible ? valeurs.suite : SUITE_MUETTE}>
      <FournirLaColonneDeService value={visible ? valeurs.colonne : COLONNE_COUPEE}>
        <FournirLaDeclarationDuProjet value={visible ? valeurs.declarerProjet : null}>
          <FournirLaDeclarationDesGestesDuBas value={visible ? valeurs.declarerGestes : null}>
            <FournirLaDeclarationDuNiveauDuBas value={visible ? valeurs.declarerNiveau : null}>
              <FournirLaCibleDesGestes value={visible ? valeurs.cibleDesGestes : null}>
                <FournirLeRegistreDuMenuDuHaut value={visible ? valeurs.registre : null}>
                  <CibleDuBasDePage.Provider value={visible ? valeurs.bas : null}>
                    <FournirLaCibleDuPrincipalOrdinateur value={visible ? valeurs.principalOrdinateur : null}>
                    <FournirLeProjetDuService value={projetDuService}>
                      <VueVisible.Provider value={visible}>
                        <div
                          className={visible ? 'contents' : 'hidden'}
                          data-vue-gardee={cle}
                          data-vue-cachee={visible ? undefined : ''}
                          {...(visible ? {} : { inert: '' })}
                        >
                          {children}
                        </div>
                      </VueVisible.Provider>
                    </FournirLeProjetDuService>
                    </FournirLaCibleDuPrincipalOrdinateur>
                  </CibleDuBasDePage.Provider>
                </FournirLeRegistreDuMenuDuHaut>
              </FournirLaCibleDesGestes>
            </FournirLaDeclarationDuNiveauDuBas>
          </FournirLaDeclarationDesGestesDuBas>
        </FournirLaDeclarationDuProjet>
      </FournirLaColonneDeService>
    </FournirLaSuiteDuFil>
  );
}

/* LES OUTILS DE FONCTIONNEMENT (Statistiques, Messagerie, Backup, Surveillance, Tâches récurrentes) s'ouvrent aussi
   en grande fenêtre, sans onglet (décision du 13/11/2026) : `VUES_DE_FONCTIONNEMENT_EN_FENETRE`. */
const VUES_DE_FONCTIONNEMENT: readonly VueCentrale[] = VUES_DE_FONCTIONNEMENT_EN_FENETRE as readonly VueCentrale[];
const VUES_EN_FENETRE: readonly VueCentrale[] = ['coffre', 'memoire', ...VUES_DE_FONCTIONNEMENT];
const SERVICES_A_OBJETS: readonly VueCentrale[] = ['studio', 'communication2', 'plaquettes', 'marketing2'];

const CLES_TITRE_DE_VUE: Record<Exclude<VueCentrale, 'projet' | 'en-route'>, string> = {
  'tableau-de-bord': 'Résumé',
  statistiques: 'Statistiques',
  coffre: 'Coffre-fort',
  memoire: 'Mémoire',
  'espace-client': 'Messagerie',
  backups: 'Backup',
  surveillance: 'Surveillance',
  securite: 'Sécurité',
  marketing: 'Réseaux sociaux',
  communication2: 'Communication',
  studio: 'Studio',
  medias: 'Médias',
  'taches-recurrentes': 'Tâches planifiées',
  plaquettes: 'Charte graphique',
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
  /* LE RAPPORT D'USAGE ANONYME : ce que l'écran mesure de lui-même (`lib/mesure-d-usage.ts`). */
  React.useEffect(() => demarrerLaMesureDeLEcran(), []);
  const fermerLesReglages = React.useCallback(() => setSettingsOpen(false), []);
  /* LA SOUS-PAGE DES RÉGLAGES vit dans l'adresse, comme la carte ouverte : les
     réglages sont un menu de pages, un lien doit pouvoir en désigner une. */
  const [settingsPage, setSettingsPage] = React.useState<string | undefined>(undefined);
  /* UN ÉCRAN PEUT OUVRIR LES RÉGLAGES SUR UNE RUBRIQUE (`beluga:ouvrir-reglages`,
     détail `{ page }`) — l'encadré de branchement d'un service mène ainsi à « Services de création ». */
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
   * coffre-fort, backups, surveillance, puis les projets. Cliquer
   * l'une d'elles REMPLACE le contenu du volet central — rien ne se pose plus
   * par-dessus, il n'y a donc plus de croix à trouver pour revenir. Les deux
   * anciens interrupteurs (tableau de bord) sont conservés comme
   * RACCOURCIS de lecture : tout le code qui les appelait continue de marcher.
   */
  const [vueCentrale, setVueCentrale] = React.useState<VueCentrale>(
    () => vueDeDemarrage(lireFragment(window.location.hash)) ?? 'projet',
  );
  /*
   * MÉMOIRE ET COFFRE-FORT S'OUVRENT EN GRANDE FENÊTRE PAR-DESSUS L'ÉCRAN (décision du 13/11/2026) : leur adresse et
   * leur vue restent les mêmes (`#coffre`, `#memoire/…`), mais la zone garde l'écran d'avant, dessous — la VUE DU
   * FOND. La fermer y ramène.
   */
  /*
   * LES OUTILS DE CRÉATION ET LE CALENDRIER, OUVERTS EN PAGE PAR-DESSUS L'ÉCRAN (13/11/2026) — ET DANS L'ADRESSE
   * (15/11/2026, « l'adresse ne change pas quand on passe du Studio au Marketing ») : « #studio », « #marketing »,
   * « #communication », « #charte », « #calendrier » (mots sans chiffre depuis le 20/11/2026). L'écrivain d'adresse les
   * écrit, `appliquerEcran` les relit (rechargement, Précédent) ; l'écran du dessous reste la vue du fond.
   */
  const [fenetreDeCreation, setFenetreDeCreation] = React.useState<VueCentrale | null>(null);
  /*
   * LA PORTÉE D'UNE PAGE DE SERVICE (décision du 14/11/2026, revue le 20/11/2026) : `TOUS_LES_PROJETS` (« »), ou
   * l'identifiant du projet choisi. Le menu « Services » ouvre TOUJOURS tous les projets ; la limite à un projet se
   * choisit dans le fil d'Ariane (ou vient d'un onglet du projet, `ouvrirUnOutil`). ELLE S'ÉCRIT DANS L'ADRESSE
   * (« #communication?projet=<id> ») et s'en relit (`appliquerEcran`) : plus aucune page ne se limite en silence au
   * dernier projet touché. `undefined` n'existe plus qu'avant la première ouverture.
   */
  const [filtreDuServiceCentral, setFiltreDuServiceCentral] = React.useState<string | undefined>(undefined);
  const projetDesOngletsRef = React.useRef<string | null>(null);
  const [viseDeCreation, setViseDeCreation] = React.useState<ElementVise>({});
  const fenetreDeService = VUES_EN_FENETRE.includes(vueCentrale) ? vueCentrale : null;
  const fenetreDeFonctionnement = VUES_DE_FONCTIONNEMENT.includes(vueCentrale) ? vueCentrale : null;
  const vueDeFondRetenue = React.useRef<VueCentrale>('projet');
  if (!fenetreDeService) vueDeFondRetenue.current = vueCentrale;
  const vueDuFond: VueCentrale = fenetreDeService ? vueDeFondRetenue.current : vueCentrale;
  /* L'ARRIVÉE SUR « TABLEAUX DE BORD » EST RÉSERVÉE AUX ADMINS, mais le rôle n'est
     connu qu'une fois le serveur joint. Un accès tiers revient à son arrivée
     habituelle, et l'entrée d'historique redevient nue : Précédent n'y ramène pas. */
  const arriveeParDefaut = React.useRef(vueCentrale === 'en-route');
  React.useEffect(() => {
    if (!state.pret || !arriveeParDefaut.current) return;
    arriveeParDefaut.current = false;
    if (state.monRole === 'admin' || vueCentrale !== 'en-route') return;
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    setVueCentrale('projet');
  }, [state.pret, state.monRole, vueCentrale]);
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
  /* LES QUATRE SERVICES RÉUNIS MÈNENT À LEUR LIEU : un ancien lien ouvre le bon lieu de la bonne marque, sans entrée
     d'historique de plus. Le montage d'une création et l'analyse approfondie d'un dossier restent où ils sont. */
  const elementDeLaVue = (elementVise as Record<string, string | null | undefined>)[vueCentrale] ?? null;
  React.useLayoutEffect(() => {
    const redirection = redirectionVersCommunication({ vue: vueCentrale, element: elementDeLaVue });
    if (!redirection) return;
    const cible = construireFragment({ vue: 'communication2', ...(redirection.chemin ? { chemin: redirection.chemin } : {}) });
    window.history.replaceState(window.history.state, '', `#${cible}`);
    setElementVise((v) => ({ ...v, communication2: redirection.chemin || null }));
    setVueCentrale('communication2');
  }, [vueCentrale, elementDeLaVue]);
  const onViseCommunication2 = React.useCallback((chemin: string | null) => setElementVise((v) => ({ ...v, communication2: chemin })), []);
  /* Stable aussi : « Tâches récurrentes » ouvre seule un projet, puis la veille choisie. */
  const onViseRecurrentes = React.useCallback(
    (projet: string | null, veilleId?: string | null) =>
      setElementVise((v) => ({ ...v, recurrentes: projet, recurrenteVeille: projet ? veilleId ?? null : null })),
    [],
  );
  /* Stable aussi : « Plaquettes » ouvre un projet, puis une plaquette. */
  const onVisePlaquettes = React.useCallback(
    (projet: string | null, plaquetteId?: string | null) =>
      setElementVise((v) => ({ ...v, plaquettesProjet: projet, plaquette: plaquetteId ?? null })),
    [],
  );
  /* L'onglet affiché dans la carte ouverte. « chat » est le défaut et ne
     s'écrit pas dans l'adresse (`ONGLET_DE_CARTE_PAR_DEFAUT`). */
  const [ongletCarte, setOngletCarte] = React.useState<string | null>(null);
  /*
   * L'ONGLET « AGENTS » DE L'ACCUEIL D'UN PROJET, et l'agent personnalisé ouvert (24/11/2026) : « #projet/<id>/agents »
   * et « #projet/<id>/agents/<agent> ». Le choix Tâches / Agents est RETENU PAR PROJET (`accueil.agents.<projet>`) : il
   * s'applique en entrant dans un projet par la colonne ; une adresse lue (lien collé, Précédent) fait foi.
   */
  const [accueilAgents, setAccueilAgents] = React.useState<{ projectId: string; agentPersoId?: string } | null>(null);
  const projetDeLAdresseLue = React.useRef<string | null>(null);
  const dashboardOpen = vueCentrale === 'tableau-de-bord';
  /* Les écrans qui ne sont dans AUCUN projet : le menu du bas y propose
     « Nouvel agent » au lieu de Tableau / Fichiers. */
  const horsProjet =
    dashboardOpen || vueCentrale === 'en-route' || (vueCentrale === 'projet' && !state.activeProjectId);
  /* LE BAS DE L'ÉCRAN DU TÉLÉPHONE, ÉCRAN PAR ÉCRAN (03/11/2026, `shared/src/menu-du-bas.ts`) : aucun, un bouton
     pleine largeur, ou des boutons répartis. La page descendue d'un niveau le dit (`useDeclarerLeNiveauDuBas`). */
  const [niveauDuBas, setNiveauDuBas] = React.useState<NiveauDeclare | null>(null);
  const menuBas = React.useMemo(
    () => menuDuBas(ecranDuBas(vueCentrale, { projetActif: !!state.activeProjectId, niveau: niveauDuBas })),
    [vueCentrale, state.activeProjectId, niveauDuBas],
  );
  const [gestesDeclares, setGestesDeclares] = React.useState<GestesDuBas | null>(null);
  /* L'EMPLACEMENT DU GESTE PRINCIPAL DE LA PAGE, QUAND LE BAS EST LE SIEN (Notes, l'accueil du Studio). */
  const [cibleDuBas, setCibleDuBas] = React.useState<HTMLElement | null>(null);
  const basDePage = React.useMemo(
    () => (menuBas.forme === 'pleine-largeur' && menuBas.geste === 'page' ? { cible: cibleDuBas } : null),
    [menuBas, cibleDuBas],
  );
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
  /* LA FENÊTRE « FICHIERS » : tous les fichiers rangés par projet et par service, ouverte par `ouvrirLesFichiers`. */
  const [fenetreFichiers, setFenetreFichiers] = React.useState<{ ouverte: boolean; chemin?: string; projetId?: string } | null>(null);
  /* La fenêtre d'archivage se monte à la première demande, puis reste montée (elle se ferme seule). */
  const [archivageDemande, setArchivageDemande] = React.useState(false);
  React.useEffect(() => {
    if (archivageDemande) return;
    const monter = () => setArchivageDemande(true);
    window.addEventListener(EVENEMENT_ARCHIVAGE, monter);
    return () => window.removeEventListener(EVENEMENT_ARCHIVAGE, monter);
  }, [archivageDemande]);
  React.useEffect(() => {
    const ouvrir = (event: Event) => {
      const demande = (event as CustomEvent<DemandeDOuvertureDesFichiers>).detail ?? {};
      setFenetreFichiers({ ouverte: true, chemin: demande.chemin ?? '', ...(demande.projetId ? { projetId: demande.projetId } : {}) });
    };
    window.addEventListener(EVENEMENT_OUVRIR_LES_FICHIERS, ouvrir);
    return () => window.removeEventListener(EVENEMENT_OUVRIR_LES_FICHIERS, ouvrir);
  }, []);
  /* « FICHIERS » S'OUVRE TOUJOURS EN FENÊTRE PAR-DESSUS LA PAGE (carte « Retouches de la charte graphique ») : le
     menu du haut le fait sur le dossier du projet actif ; seules les PIÈCES JOINTES gardent leur tiroir. */
  const ouvrirFichiersOuPieces = React.useCallback(
    (vue: VueFichiers) => {
      if (vue === 'fichiers') ouvrirLesFichiers(state.activeProjectId ? { projetId: state.activeProjectId } : {});
      else setTiroirFichiers(vue);
    },
    [state.activeProjectId],
  );
  /* …ET LE MENU D'UN AGENT LES OUVRE AUSSI (groupe « Ce projet », 30/10/2026) :
     `beluga:ouvrir-fichiers`, détail `{ vue: 'fichiers' | 'pieces' }`. */
  React.useEffect(() => {
    const ouvrir = (event: Event) => {
      const vue = (event as CustomEvent<{ vue?: VueFichiers }>).detail?.vue;
      if (vue) setTiroirFichiers(vue);
    };
    window.addEventListener('beluga:ouvrir-fichiers', ouvrir);
    return () => window.removeEventListener('beluga:ouvrir-fichiers', ouvrir);
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

  // Largeur de la colonne des projets, retenue d'une session à l'autre. La clé
  // a changé avec la refonte : la colonne porte désormais des groupes encadrés
  // et ses onglets, l'ancienne largeur (196 px) ne lui convenait plus.
  const colonneProjets = useResizable('colonne-projets', { initial: 288, min: 232, max: 440 });
  /* LA COLONNE D'UN SERVICE (Mémoire, Statistiques, Messagerie, Coffre-fort…)
     a SA largeur retenue, plus large par défaut (demande du 20/10/2026 : les
     titres de la Mémoire en liste y étaient coupés). La liste des projets, la
     colonne d'un projet et celle d'une tâche gardent la leur. */
  const colonneServices = useResizable('colonne-services', { initial: 340, min: 232, max: 480 });
  /* LA SUITE DU FIL D'ARIANE : son emplacement dans la barre, sa présence, et
     le geste qui ramène à l'accueil du service (`SuiteDuFil`). */
  /* DEUX CIBLES À PART POUR LA SUITE DU FIL (20/11/2026, capture #fe29) : celle du fil de la zone et celle de la barre
     d'un projet. Un seul état tenu par deux `ref` se faisait remettre à vide par l'élément qui partait, et la suite
     n'avait plus de place. La cible retenue dépend de l'endroit où le fil est réellement posé. */
  const [cibleDuFilDeZone, setCibleDuFilDeZone] = React.useState<HTMLElement | null>(null);
  const [cibleDeLaBarreDuProjet, setCibleDeLaBarreDuProjet] = React.useState<HTMLElement | null>(null);
  const [suitePresente, setSuitePresente] = React.useState(false);
  const retourDeLaSuite = React.useRef<(() => void) | null>(null);
  /* SUR TÉLÉPHONE, LES CRANS D'AVANT SONT CACHÉS : la page ouverte dans un
     service (un site, une création, un classeur) demande une flèche de retour
     dans la barre, avec ses repères (`SuiteDuFil retour`). */
  const retourDUnCran = React.useRef<(() => void) | null>(null);
  const [reperesDuRetour, setReperesDuRetour] = React.useState<ReperesDeRetour | null>(null);
  const telephone = useTelephone();
  /* L'emplacement de la barre d'en-tête où la page affichée pose ses gestes. */
  const [cibleDesGestes, setCibleDesGestes] = React.useState<HTMLElement | null>(null);
  const [cibleDesGestesDuProjet, setCibleDesGestesDuProjet] = React.useState<HTMLElement | null>(null);
  const [principalOrdinateur, setPrincipalOrdinateur] = React.useState<HTMLElement | null>(null);
  /* LES OPTIONS DES PAGES DE LA ZONE, rangées dans le chevron du coin haut droit (`bande-de-zone.tsx`). */
  const registreDuCoin = React.useMemo(() => creerLeRegistreDuMenuDuHaut(), []);
  const coinDeLaZone = React.useMemo(() => ({ registre: registreDuCoin, cible: cibleDesGestes }), [registreDuCoin, cibleDesGestes]);
  /* Ce que les pages déclarent pour les trois points du haut du téléphone (`MenuDuHautTelephone`). */
  const [registreDuMenuDuHaut] = React.useState(creerLeRegistreDuMenuDuHaut);
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

  /* LA BANDE VIDE EN BAS ET LE CLAVIER : une seule mesure, `lib/mesure-du-clavier.ts`. */
  useMesureDuClavier();

  /* Une carte affichée dans la conversation s'ouvre dans le tiroir. */
  /*
   * OUVRIR UNE CARTE, C'EST REVENIR À SON PROJET. Le tiroir se posait par-dessus
   * le service ouvert (coffre, mémoire, sauvegardes…) : l'adresse décrivait
   * alors le service, pas la carte affichée devant — un lien copié à ce
   * moment-là ne ramenait pas sur la carte. On repasse donc en vue « projet »,
   * qui est l'endroit dont la carte fait partie.
   */
  /*
   * LA CARTE D'UN AGENT DE VOLET MÈNE À SON SERVICE. Marketing,
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
      /* L'onglet « Agents » d'un projet s'ouvre par son adresse (`ouvrirServiceSinonCarte`), jamais comme un service. */
      if (lieu.vue === 'agents') return;
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
      void lieuDuServiceDeLaCarte(cardId).then((lieu) => {
        /* LA CARTE DE L'AGENT DES RÉSEAUX OUVRE SA CONVERSATION : c'est elle qu'on venait chercher (sa question s'y
           répond), et Communication n'a qu'une conversation, celle du directeur — son ancien volet n'existe plus. */
        if (!lieu || lieu.vue === 'marketing') return sinon();
        /* L'AGENT PERSONNALISÉ D'UN PROJET (24/11/2026) : sa carte ramène à SA page, dans l'onglet « Agents » du projet. */
        if (lieu.vue === 'agents') {
          if (!lieu.projectId) return sinon();
          window.history.pushState(null, '', `#${construireFragment({ vue: 'projet', projectId: lieu.projectId, agents: true, agentPersoId: lieu.elementId })}`);
          window.dispatchEvent(new PopStateEvent('popstate'));
          return;
        }
        ouvrirLeService(lieu);
      });
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
      /* UN AGENT DE SERVICE SANS CARTE (agent marketing d'un client, chef de Communication, atelier du Studio…) ouvre
         l'écran de son service, comme la bande du tableau de bord — jamais « Choisissez un agent » sur son projet
         (capture #27b88 du 09/11/2026). Les agents de publication gardent leur tiroir, plus bas. */
      if (!cardId && agent.service && agent.role !== 'deploy') {
        allerALEcranDeLAgentDeService(agent.service);
        return;
      }
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
        /* UN AGENT DE CONFIGURATION (déploiement ou mise en production) ouvre le MENU « PUBLIER » du haut, où sa
           préparation se suit et sa question se répond (« Répondre ») — plus son tiroir (décision de l'utilisateur,
           18/11/2026 : « on ne doit pas avoir de tiroir sauf si on débogue manuellement »). Seul un appel EXPLICITE
           de sa conversation (`avecFil`, `client.openConversation`) ouvre encore le tiroir. */
        const projetDeLAgent = etat.projects.find((p) => p.id === agent.projectId);
        const etapeConfiguree = etapeDeLAgentDeConfiguration(projetDeLAgent, agent.id);
        if (etapeConfiguree && !agent.depannagePublication) {
          if (avecFil) ouvrirAgentDeConfiguration(agent.projectId, etapeConfiguree);
          else ouvrirLePublierDuProjet(agent.projectId);
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
        /* LA QUESTION D'UN DÉPANNEUR (cloche, notification touchée — `avecFil`) se répond dans SA FENÊTRE AU CENTRE,
           jamais dans un tiroir ouvert sans qu'on l'ait demandé (décision du 21/11/2026, « Dépannage de publication
           discret »). Le clic sur l'agent lui-même (ligne de colonne, vignette, « Voir la conversation ») ouvre son fil. */
        if (avecFil && agent.depannagePublication && agent.attendReponse) {
          window.dispatchEvent(new CustomEvent<string>(EVENEMENT_QUESTION_DU_DEPANNEUR, { detail: agentId }));
          return;
        }
        const fil = avecFil || !!agent.depannagePublication || !!agent.reparationPublication ? agentId : undefined;
        if (volet === 'configuration') ouvrirRubriqueDeLEtape(agent.projectId, 'production');
        else if (volet === 'dev') client.demanderDeploiement({ projectId: agent.projectId, agentId: fil });
        else client.demanderProduction({ projectId: agent.projectId, agentId: fil });
      }
    },
    [setMobileView, ouvrirServiceSinonCarte],
  );
  /* UN AGENT SANS CARTE OUVERT D'UNE LISTE DE LA COLONNE (`ouvrirUnAgent`, 04/11/2026) : son ouverture habituelle,
     et le menu du téléphone se referme. */
  React.useEffect(() => {
    const surDemande = (event: Event) => {
      const agentId = (event as CustomEvent<string>).detail;
      if (!agentId) return;
      setProjetsOuverts(false);
      ouvrirAgent(agentId, false);
    };
    window.addEventListener(EVENEMENT_OUVRIR_UN_AGENT, surDemande);
    return () => window.removeEventListener(EVENEMENT_OUVRIR_UN_AGENT, surDemande);
  }, [ouvrirAgent]);

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
   * UN PROJET S'OUVRE SUR SA PAGE D'ACCUEIL (décision du 14/11/2026, « s'il y a déjà une tâche dans un projet, je ne
   * peux pas accéder à la page principale du projet »). L'accueil porte désormais le TABLEAU DES TÂCHES du projet :
   * la reprise automatique du dernier agent (30/10/2026) et l'entrée par le nom du projet qui rouvrait sa dernière
   * tâche (31/10/2026) sont retirées. Cliquer le nom d'un projet — dans la colonne comme dans le fil — mène à son
   * accueil (effet `tableauDemande`, qui referme la carte) ; une tâche s'ouvre d'un clic dans le tableau ou la colonne.
   */
  const entrerDansLeProjet = React.useCallback((projectId: string) => {
    client.demanderTableau(projectId);
  }, []);

  /* Ouvrir un agent met à jour le souvenir du dernier agent ouvert du projet (lu par la colonne). */
  React.useEffect(() => {
    const projectId = (openCardId ? state.cards[openCardId]?.projectId : null) ?? state.activeProjectId;
    if (!projectId || !openCardId) return;
    const cle = cleCarteOuverte(projectId);
    if ((state.prefs[cle] ?? '') === openCardId) return;
    writePref(cle, openCardId);
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
     * LE CALENDRIER ET LES OUTILS DE CRÉATION SE ROUVRENT PAR LEUR ADRESSE (15/11/2026) : en page par-dessus l'écran
     * du fond, qui ne bouge pas. Un OBJET réel d'un outil (une création, un dossier ouvert) garde son chemin
     * d'onglet, plus bas. Toute autre adresse les referme : Précédent sort de la page du service.
     */
    /* LE CALENDRIER N'EST PLUS UN SERVICE (20/11/2026) : c'est un volet de chaque campagne. Un ancien lien
       « #calendrier… » ouvre Communication, sur la liste des projets ; l'adresse s'y réécrit. */
    if (ecran.vue === 'calendrier') {
      setViseDeCreation({});
      setFiltreDuServiceCentral(TOUS_LES_PROJETS);
      setFenetreDeCreation('communication2');
      return;
    }
    const outil = destinationDeLEcran(ecran);
    if (outil && OUTILS_DE_CREATION.includes(outil) && !adresseDObjetReel(construireFragment({ ...ecran, tiroirs: undefined }))) {
      setViseDeCreation(elementViseDeLEcran(ecran));
      /* TOUT OUTIL ROUVERT PAR SON ADRESSE GARDE LA PORTÉE QUE L'ADRESSE DIT (carte « Charte FishFlow introuvable »,
         17/11/2026, étendue à tous les outils le 20/11/2026) : sans « ?projet= », tous les projets ; « #charte/<projet> »
         vaut aussi pour la Charte. Sans ce réglage, la page s'enfermait dans le projet actif (« Aucune charte pour
         Beluga », « Beluga n'a pas encore de marque ») alors que les données existaient. */
      setFiltreDuServiceCentral(ecran.portee ?? (ecran.vue === 'plaquettes' ? ecran.projectId : undefined) ?? TOUS_LES_PROJETS);
      setFenetreDeCreation(outil);
      return;
    }
    setFenetreDeCreation(null);
    /* Une page de fonctionnement (Statistiques, Messagerie, Backup…) relit sa portée de l'adresse, elle aussi. */
    const destinationLue = destinationDeLEcran(ecran);
    if (destinationLue && VUES_DE_FONCTIONNEMENT.includes(destinationLue)) setFiltreDuServiceCentral(ecran.portee ?? TOUS_LES_PROJETS);
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
      projetDeLAdresseLue.current = ecran.projectId;
      setAccueilAgents(ecran.agents && !ecran.cardId ? { projectId: ecran.projectId, ...(ecran.agentPersoId ? { agentPersoId: ecran.agentPersoId } : {}) } : null);
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
    /* UNE CHARTE NOMMÉE AVEC SON PROJET S'OUVRE DANS CE PROJET (14/11/2026, « j'ai cliqué sur cette charte et rien, page
       vide ») : ouverte depuis « Tous les projets », elle se rangeait dans le projet affiché, qui ne la connaît pas. */
    if (ecran.vue === 'plaquettes' && ecran.projectId && ecran.plaquetteId && client.lireEtat().activeProjectId !== ecran.projectId) {
      client.setActiveProject(ecran.projectId);
    }
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
    /* À FROID, SANS ADRESSE PRÉCISE : la vue est déjà « Tableaux de bord » (voir son
       `useState`). L'adresse l'écrit EN REMPLAÇANT l'entrée courante : poussée par
       l'écrivain, elle laisserait derrière elle un Précédent vers le projet mémorisé.
       Un Précédent plus tard vers une entrée nue suit, lui, la voie ordinaire. */
    const ecranDeDepart = lireFragment(window.location.hash);
    const vueDeDepart = vueDeDemarrage(ecranDeDepart);
    if (vueDeDepart) {
      window.history.replaceState(window.history.state, '', '#' + construireFragment({ vue: 'en-route' }));
    } else {
      suivreAdresse();
    }
    adresseLue.current = true;
    window.addEventListener('popstate', suivreAdresse);
    return () => window.removeEventListener('popstate', suivreAdresse);
  }, [appliquerEcran]);

  // En sens inverse, chaque changement d'écran réécrit l'adresse. Un même écran
  // ne rajoute rien à l'historique (replaceState, juste pour rafraîchir le
  // slug) ; un écran différent y pousse une entrée, pour que Précédent revienne.
  const titreCarteOuverte = openCardId ? state.cards[openCardId]?.title ?? null : null;

  /*
   * PLUS AUCUN VOLET DE CARTE HORS DU TABLEAU DU PROJET, sur aucun service (coffre, mémoire, sauvegardes,
   * surveillance, marketing, statistiques, espace client) : la carte
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
      : fenetreDeCreation
      ? ecranDeLaVue({ vue: fenetreDeCreation, element: viseDeCreation, projectId: state.activeProjectId })
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
          agents:
            vueCentrale === 'projet' && accueilAgents && accueilAgents.projectId === state.activeProjectId
              ? { agentPersoId: accueilAgents.agentPersoId ?? null }
              : null,
        });
    /* LA PORTÉE CHOISIE S'ÉCRIT au bout de l'adresse d'une page de service (outil de création ou de fonctionnement) ;
       la Charte limitée à un projet le dit déjà dans son chemin. */
    const pageDeService =
      !settingsOpen && !configProjetId && (!!fenetreDeCreation || VUES_DE_FONCTIONNEMENT.includes(vueCentrale));
    const porteeEcrite =
      pageDeService && filtreDuServiceCentral && !(ecranSansTiroirs.vue === 'plaquettes' && ecranSansTiroirs.projectId === filtreDuServiceCentral)
        ? filtreDuServiceCentral
        : undefined;
    const ecranPorte: EcranNavigateur = porteeEcrite ? { ...ecranSansTiroirs, portee: porteeEcrite } : ecranSansTiroirs;
    /* Les tiroirs désignés par une adresse collée attendent leur écran : si
       l'écran change sous eux, l'attente tombe. */
    oublierLAttenteSiEcranChange(ecranPorte, memeEcran);
    const ecran: EcranNavigateur = pileTiroirs.length
      ? { ...ecranPorte, tiroirs: pileTiroirs }
      : ecranPorte;

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
    fenetreDeCreation,
    viseDeCreation,
    filtreDuServiceCentral,
    accueilAgents,
  ]);

  /* ENTRER DANS UN PROJET PAR LA COLONNE reprend son dernier choix Tâches / Agents ; une adresse lue a déjà tranché. */
  React.useEffect(() => {
    const id = state.activeProjectId;
    /* Les préférences arrivent avec le premier état du serveur : on attend qu'il soit là pour lire le choix retenu. */
    if (!id || !state.pret || projetDeLAdresseLue.current === id) return;
    projetDeLAdresseLue.current = id;
    setAccueilAgents(state.prefs[`accueil.agents.${id}`] === '1' ? { projectId: id } : null);
  }, [state.activeProjectId, state.pret]);
  const choisirLAccueil = React.useCallback((projectId: string, choix: { agentPersoId?: string } | null) => {
    setAccueilAgents(choix ? { projectId, ...(choix.agentPersoId ? { agentPersoId: choix.agentPersoId } : {}) } : null);
    if ((client.lireEtat().prefs[`accueil.agents.${projectId}`] === '1') !== !!choix) writePref(`accueil.agents.${projectId}`, choix ? '1' : '');
  }, []);

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
  /* Une question d'agent de configuration a-t-elle déjà été posée ? Alors sa fenêtre est montée, pour de bon. */
  const unePremiereQuestionDeConfiguration = Object.values(state.procedures ?? {}).some((etat) => !!etat?.question);
  const [questionDeConfigurationVue, setQuestionDeConfigurationVue] = React.useState(false);
  if (unePremiereQuestionDeConfiguration && !questionDeConfigurationVue) setQuestionDeConfigurationVue(true);
  const unDepanneurAttend = Object.values(state.agents).some((agent) => !!agent.depannagePublication && agent.attendReponse === true);
  const [unDepanneurAttendVu, setUnDepanneurAttendVu] = React.useState(false);
  if (unDepanneurAttend && !unDepanneurAttendVu) setUnDepanneurAttendVu(true);
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
    /* Demandé depuis le pied d'une carte : sa page monte déjà le bloc du lot, qui
       ouvre la fenêtre de sélection SUR PLACE. Refermer la carte ici démontait ce
       bloc avec sa fenêtre : on atterrissait sur la page du projet. */
    if (deploiementDemande.surPlace) return;
    setConfigProjetId(null);
    if (client.lireEtat().activeProjectId !== deploiementDemande.projectId) {
      client.setActiveProject(deploiementDemande.projectId);
    }
    setVueCentrale('projet');
    /* Sur téléphone la page d'une carte ne monte pas ce bloc : la fenêtre s'ouvre
       sur la page du projet, la carte ne doit plus la recouvrir. */
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
  /* DANS L'APPLICATION IPHONE OU MAC (`natif/`) : jeton APNs, raccourci, notification touchée (`lib/natif.ts`). */
  React.useEffect(() => brancherLeNatif(), []);

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
        !VUES_EN_FENETRE.includes(vue) &&
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
         lien avait désigné la fois d'avant ne se rouvre pas tout seul. Une fenêtre (Mémoire, Coffre-fort) ne fait
         rien oublier à l'écran du fond. */
      setElementVise((avant) =>
        VUES_EN_FENETRE.includes(vue)
          ? {
              ...avant,
              coffre: undefined,
              memoirePortee: undefined,
              memoireFiche: undefined,
              memoireUnite: undefined,
              backups: undefined,
              surveillance: undefined,
              securite: undefined,
              statistiques: undefined,
              recurrentes: undefined,
              recurrenteVeille: undefined,
            }
          : {},
      );
      if (vue !== 'espace-client') setEspaceVise(undefined);
      setMobileView('board');
    },
    [setMobileView],
  );
  const ouvrirTableauDeBord = () => ouvrirVue('tableau-de-bord');
  const fermerLaFenetre = React.useCallback(() => ouvrirVue(vueDeFondRetenue.current), [ouvrirVue]);
  /*
   * LES OUTILS DE CRÉATION S'OUVRENT EN FENÊTRE (décision du 13/11/2026, maquette #50a07) : Studio, Communication,
   * Charte graphique et Marketing montrent, par-dessus l'écran, ce que le projet a déjà dans cet outil — un clic ouvre
   * l'élément dans un onglet du projet — et de quoi en créer un nouveau. Les quatre outils sont à gauche de la fenêtre.
   */
  const servicesOuvertsAuCompte = useServicesOuverts().map((x) => x.cle as string);
  const viserDansLaFenetre = React.useCallback((vue: VueCentrale, element: ElementVise) => {
    const adresse = construireFragment(ecranDeLaVue({ vue, element, projectId: client.lireEtat().activeProjectId }));
    if (adresseDObjetReel(adresse)) {
      setFenetreDeCreation(null);
      setViseDeCreation({});
      naviguerVers('#' + adresse);
      return;
    }
    setViseDeCreation(element);
  }, []);
  /* L'instant où un service vient d'être ouvert (voir « LES PAGES DE SERVICE SE REFERMENT QUAND ON VA AILLEURS »). */
  const ouvertureDeServiceA = React.useRef(0);
  const ouvrirUnOutil = React.useCallback(
    (vue: VueCentrale) => {
      ouvertureDeServiceA.current = Date.now();
      /* DEPUIS UN PROJET (son onglet, la feuille des outils du téléphone) : l'outil se limite à CE projet, écrit en
         toutes lettres — l'adresse le porte, un rechargement le redonne. */
      setFiltreDuServiceCentral(projetDesOngletsRef.current ?? TOUS_LES_PROJETS);
      /* LA PAGE D'UNE TÂCHE SE REFERME AUSSI pour un outil de création (14/11/2026) : posée en z-40, elle recouvrait
         la page du service (z-30), montée mais invisible. Brouillon et pièces jointes suivent l'agent, rien ne se perd. */
      setOpenCardId(null);
      if (OUTILS_DE_CREATION.includes(vue)) {
        setViseDeCreation({});
        setFenetreDeCreation(vue);
        return;
      }
      ouvrirVue(vue);
    },
    [ouvrirVue],
  );
  const ouvrirServiceCentral = React.useCallback(
    (cle: string, portee: string = TOUS_LES_PROJETS) => {
      /* UNE SEULE PAGE DE SERVICE À LA FOIS (14/11/2026) : ouvrir l'une referme l'autre. */
      const fonctionnementOuvert = VUES_DE_FONCTIONNEMENT.includes(vueCentraleRef.current);
      ouvertureDeServiceA.current = Date.now();
      /* DEPUIS LA PAGE D'UNE TÂCHE (14/11/2026, « aucun bouton du menu Services ne fonctionne ») : cette page, en z-40,
         recouvrait la page du service (z-30). Elle se referme d'abord, quel que soit le service. */
      setOpenCardId(null);
      setFiltreDuServiceCentral(portee);
      if (OUTILS_DE_CREATION.includes(cle)) {
        if (fonctionnementOuvert) fermerLaFenetre();
        setViseDeCreation({});
        setFenetreDeCreation(cle as VueCentrale);
        return;
      }
      setFenetreDeCreation(null);
      ouvrirVue(cle as VueCentrale);
    },
    [ouvrirVue, fermerLaFenetre],
  );
  /* L'entrée de « Services » dont la page est ouverte : en orange dans la liste — QUEL QUE SOIT LE CHEMIN PAR LEQUEL
     ON Y EST VENU, et jusque dans ses pages enfants (15/11/2026) : un service rouvert par son adresse, par le fil
     d'Ariane, ou l'objet d'un service ouvert en onglet (une création du Studio, un dossier Marketing) le garde allumé. */
  const serviceCentralActif =
    fenetreDeCreation ?? fenetreDeFonctionnement ?? (CLES_DES_SERVICES.some((x) => x.cle === vueCentrale) ? vueCentrale : null);
  /* « NOUVEL AGENT › TYPE › PROJET » (14/11/2026) : l'élément naît dans le projet choisi et s'ouvre en onglet. */
  const creerUnAgent = React.useCallback((type: TypeDAgent, cible: CibleDeCreation) => {
    setFenetreDeCreation(null);
    void creerUnAgentDeType(type, cible, (id) => (carteRobotIdRef.current = id));
  }, []);
  /* Le titre d'une page qui n'appartient à aucun projet : il prend la place du
     nom du projet ouvert, qui n'y dirait rien. */
  const surTableauxDeBord =
    vueDuFond === 'en-route' || (vueDuFond === 'projet' && !state.activeProjectId && state.projects.length > 0);
  /*
   * LE FIL D'ARIANE DE LA PAGE AFFICHÉE (demande du 31/10/2026) : « Tableaux de
   * bord » en tête partout, sauf sur eux-mêmes et pour un accès tiers qui ne les a
   * pas. Le dernier cran — le titre — est le lieu lui-même ; celui d'un service
   * ouvre la liste des services (`menuDuTitre`, plus bas). Le groupe du projet n'y
   * figure pas : c'est le NOM du projet qui importe.
   */
  /* LE MENU EN GRILLE N'EST PLUS LE PREMIER CRAN DES FILS (décision du 13/11/2026 : il n'existe plus nulle part). Les
     vues communes se rejoignent par le menu ⋮ de la colonne de gauche. */
  const cheminDeLaPage: CranDuChemin[] = [];
  const titreDeLaPage = surTableauxDeBord
    ? t('Tableaux de bord')
    : vueDuFond === 'projet'
      ? (activeProject?.name ?? 'Beluga')
      : t(CLES_TITRE_DE_VUE[vueDuFond]);
  const colonneDuMenu = (
    <Filet zone="Liste des projets">
      <Sidebar
        onOpenAgent={(agentId) => {
          setProjetsOuverts(false);
          ouvrirAgent(agentId, false);
        }}
        onChoose={() => setProjetsOuverts(false)}
        /* TOUCHER UN PROJET MÈNE À SA PAGE PRINCIPALE, ICI AUSSI (décision du 14/11/2026, rappelée le 16/11) : la
           colonne en feuille du téléphone ne le recevait pas et ouvrait la dernière tâche. */
        onEntrerDansLeProjet={(id) => {
          setProjetsOuverts(false);
          entrerDansLeProjet(id);
        }}
        vue={vueDuFond}
        onOuvrirVue={(vue) => {
          setProjetsOuverts(false);
          if (VUES_DE_FONCTIONNEMENT.includes(vue) || OUTILS_DE_CREATION.includes(vue)) ouvrirServiceCentral(vue);
          else ouvrirVue(vue);
        }}
        carteOuverte={carteAffichee}
        onOuvrirCarte={(card) => ouvrirCarteDepuisUnService(card)}
        onCreerAgent={creerUnAgent}
        onOuvrirServiceCentral={ouvrirServiceCentral}
        serviceCentralActif={serviceCentralActif}
        onOpenSettings={() => {
          setProjetsOuverts(false);
          setSettingsOpen(true);
        }}
        onNouvelAgent={(projectId) => {
          setProjetsOuverts(false);
          /* LE « + » D'UNE LIGNE DE PROJET : l'agent naît dans ce projet, sans passer par le choix du projet. */
          if (projectId) void creerCarteAgent(projectId, (id) => (carteRobotIdRef.current = id));
          else setTiroirNouvelAgent(true);
        }}
      />
    </Filet>
  );
  /* Le nom du service n'ouvre plus la liste des services : la grille, premier cran du fil, s'en charge. */
  const lieu = { chemin: cheminDeLaPage, titre: titreDeLaPage };
  /*
   * LA BARRE UNIQUE D'UN PROJET, À ONGLETS (refonte du 13/11/2026, façon Claude Desktop). Sur ordinateur, dans un
   * projet — son accueil, une tâche ouverte, ou un de ses outils —, la barre du haut montre l'icône du projet puis
   * ses onglets ; le fil d'Ariane s'efface. L'onglet ACTIF se déduit de l'écran ; la LISTE est retenue par projet
   * (préférence `onglets-du-projet:<id>`, `shared/src/onglets-du-projet.ts`).
   */
  const projetDesOnglets =
    activeProject && !surTableauxDeBord && (vueDuFond === 'projet' || estUnServiceDuProjet(vueDuFond))
      ? activeProject
      : null;
  /* Lu par `ouvrirUnOutil` (rappel stable, déclaré plus haut) : le projet d'où l'on ouvre un outil. */
  projetDesOngletsRef.current = projetDesOnglets?.id ?? null;
  const cleDesOnglets = projetDesOnglets ? cleDesOngletsDuProjet(projetDesOnglets.id) : null;
  const ongletsRetenus = cleDesOnglets ? state.prefs[cleDesOnglets] : undefined;
  const ongletsDuProjet = React.useMemo(() => lireLesOnglets(ongletsRetenus), [ongletsRetenus]);
  /* LE NOM DE L'OBJET OUVERT DANS UN OUTIL (une création, une campagne) : le service l'écrit dans la suite du fil
     d'Ariane, restée montée, cachée ; l'onglet le lit là. */
  const serviceDuFond = vueDuFond !== 'projet' && CLES_DES_SERVICES.some((x) => x.cle === vueDuFond) ? vueDuFond : null;
  /* L'ONGLET « AGENTS » DE L'ACCUEIL (24/11/2026) écrit lui aussi sa suite dans la barre : « projet / Agents / agent ». */
  const suiteDeLAccueilDesAgents =
    !!projetDesOnglets && !telephone && !serviceDuFond && !carteAffichee && vueDuFond === 'projet' && accueilAgents?.projectId === projetDesOnglets.id;
  const suiteDansLaBarreDuProjet = !!projetDesOnglets && !telephone && (!!serviceDuFond || suiteDeLAccueilDesAgents) && !carteAffichee;
  const cibleDeLaSuite = suiteDansLaBarreDuProjet ? cibleDeLaBarreDuProjet : cibleDuFilDeZone;
  const [texteDeLaSuite, setTexteDeLaSuite] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!cibleDeLaSuite) return;
    const lire = () => {
      const feuilles = [...cibleDeLaSuite.querySelectorAll<HTMLElement>('*')].filter(
        (el) => el.children.length === 0 && (el.textContent ?? '').trim(),
      );
      setTexteDeLaSuite(feuilles.length ? (feuilles[feuilles.length - 1].textContent ?? '').trim() : null);
    };
    lire();
    const observateur = new MutationObserver(lire);
    observateur.observe(cibleDeLaSuite, { childList: true, subtree: true, characterData: true });
    return () => observateur.disconnect();
  }, [cibleDeLaSuite]);
  const fragmentDeLEcran = projetDesOnglets
    ? construireFragment(
        ecranDeLaVue({
          vue: vueDuFond,
          element: elementVise,
          espace: espaceVise,
          projectId: state.activeProjectId,
          cardId: carteAffichee,
          titreCarte: titreCarteOuverte,
        }),
      )
    : '';
  let ongletCourant: OngletDuProjet | null = !projetDesOnglets
    ? null
    : vueDuFond === 'projet'
      ? carteAffichee
        ? ongletDeTache(carteAffichee, fragmentDeLEcran, state.cards[carteAffichee]?.title)
        : null
      : /* UN OBJET RÉEL SEULEMENT (13/11/2026) : la racine d'un service (« Mes marques », la liste des créations) est
           l'onglet du service, jamais un objet — sinon l'onglet du service ne s'allumait jamais. */
        SERVICES_A_OBJETS.includes(vueDuFond) && adresseDObjetReel(fragmentDeLEcran)
        ? ongletDObjet(vueDuFond, fragmentDeLEcran, (suitePresente && texteDeLaSuite) || undefined)
        : ongletDeService(vueDuFond, fragmentDeLEcran);
  const signatureDeLOnglet = ongletCourant ? `${ongletCourant.cle}|${ongletCourant.adresse}|${ongletCourant.titre ?? ''}` : '';
  React.useEffect(() => {
    if (!cleDesOnglets || !ongletCourant) return;
    const maintenant = Date.now();
    let suite = ouvrirLOnglet(lireLesOnglets(client.lireEtat().prefs[cleDesOnglets]), ongletCourant, maintenant);
    /* UNE TÂCHE ARCHIVÉE QUE L'ON ROUVRE garde désormais son onglet : son regard est postérieur à l'archivage. */
    const carte = ongletCourant.cardId ? client.lireEtat().cards[ongletCourant.cardId] : undefined;
    if (carte?.column === 'archived') {
      const liste = suite ?? lireLesOnglets(client.lireEtat().prefs[cleDesOnglets]);
      const avant = liste.find((o) => o.cle === ongletCourant!.cle);
      const range = carte.archivedAt ?? carte.deployedAt ?? 0;
      if (avant && (avant.ouvertA ?? 0) <= range) suite = rouvrirLOnglet(liste, ongletCourant.cle, maintenant) ?? suite;
    }
    if (suite) writePref(cleDesOnglets, suite);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleDesOnglets, signatureDeLOnglet]);
  const activerLOnglet = React.useCallback(
    (onglet: OngletDuProjet | null) => {
      const projectId = client.lireEtat().activeProjectId;
      if (!onglet) {
        /* « TÂCHES », L'ACCUEIL DU PROJET : la même demande que le nom du projet dans l'ancien fil d'Ariane — la
           reprise de la dernière tâche ne la recouvre pas. */
        if (projectId) client.demanderTableau(projectId);
        return;
      }
      naviguerVers('#' + onglet.adresse);
    },
    [],
  );
  /*
   * LES ONGLETS DES TÂCHES RANGÉES SE FERMENT SEULS (décision du 13/11/2026) : à chaque arrivée de cartes, une tâche
   * archivée après son dernier regard perd son onglet (`ongletsSansTachesRangees`). L'onglet qu'on regarde n'est
   * jamais retiré sous les yeux : il tombe quand on le quitte. Rien ne s'écrit quand la liste ne change pas.
   */
  const cleOngletCourant = ongletCourant?.cle ?? null;
  React.useEffect(() => {
    if (!cleDesOnglets) return;
    const liste = lireLesOnglets(client.lireEtat().prefs[cleDesOnglets]);
    const actif = liste.find((o) => o.cle === cleOngletCourant);
    const suite = ongletsSansTachesRangees(
      liste.filter((o) => o.cle !== cleOngletCourant),
      state.cards,
    );
    if (!suite) return;
    writePref(cleDesOnglets, actif ? liste.filter((o) => o.cle === actif.cle || suite.some((s) => s.cle === o.cle)) : suite);
  }, [cleDesOnglets, state.cards, cleOngletCourant]);
  /* UNE TÂCHE QUE LE SERVEUR NE CONNAÎT PLUS : ses onglets tombent, et l'on montre le voisin s'il était affiché. */
  React.useEffect(() => {
    const surIntrouvable = (event: Event) => {
      const cardId = (event as CustomEvent<{ cardId?: string }>).detail?.cardId;
      if (!cardId) return;
      const prefs = client.lireEtat().prefs;
      for (const cle of Object.keys(prefs)) {
        if (!cle.startsWith('onglets-du-projet:')) continue;
        const liste = lireLesOnglets(prefs[cle]);
        const suite = ongletsSansLaCarte(liste, cardId);
        if (!suite) continue;
        writePref(cle, suite);
        if (cle === cleDesOnglets && ongletCourant?.cardId === cardId) {
          const rang = liste.findIndex((o) => o.cardId === cardId);
          setOpenCardId(null);
          activerLOnglet(suite[rang] ?? suite[rang - 1] ?? null);
        }
      }
    };
    window.addEventListener(EVENEMENT_CARTE_INTROUVABLE, surIntrouvable);
    return () => window.removeEventListener(EVENEMENT_CARTE_INTROUVABLE, surIntrouvable);
  }, [cleDesOnglets, ongletCourant?.cardId, activerLOnglet]);
  /* LE PROJET DE L'OUTIL OUVERT EN ONGLET : chaque outil ne montre que lui (`projet-du-service.tsx`). */
  const projetFigeDuService = React.useMemo(
    () => (projetDesOnglets ? { id: projetDesOnglets.id, name: projetDesOnglets.name, path: projetDesOnglets.path } : null),
    [projetDesOnglets?.id, projetDesOnglets?.name, projetDesOnglets?.path],
  );
  const projetDuService = estUnServiceDuProjet(vueDuFond) ? projetFigeDuService : null;
  /* LA PAGE D'UN SERVICE OUVERTE DEPUIS « SERVICES » montre tous les projets, ou celui que son filtre a choisi. */
  const projetFiltreDuServiceCentral = filtreDuServiceCentral ? state.projects.find((p) => p.id === filtreDuServiceCentral) : null;
  const projetDeLaFenetre = React.useMemo(
    () =>
      filtreDuServiceCentral === undefined
        ? projetFigeDuService
        : projetFiltreDuServiceCentral
          ? { id: projetFiltreDuServiceCentral.id, name: projetFiltreDuServiceCentral.name, path: projetFiltreDuServiceCentral.path }
          : null,
    [filtreDuServiceCentral, projetFigeDuService, projetFiltreDuServiceCentral?.id, projetFiltreDuServiceCentral?.name, projetFiltreDuServiceCentral?.path],
  );
  /*
   * LE FIL D'UNE PAGE DE SERVICE (20/11/2026) : le service, puis le projet quand la page est limitée à un projet
   * (`FilDesPagesDeService`). Changer de service garde la portée choisie.
   */
  const porteeDuService = filtreDuServiceCentral ?? projetFigeDuService?.id ?? TOUS_LES_PROJETS;
  /*
   * LE FILTRE DES PROJETS D'UNE PAGE DE SERVICE (14/11/2026) : à droite de la rangée de la page, à la hauteur commune.
   * TOUJOURS POSÉ, MÊME OUVERT DEPUIS UN PROJET (carte « Audits absents et Sécurité sur mobile », 16/11/2026) : sur
   * téléphone, le fil (et sa portée ⌄) n'existe pas ; sans ce filtre, une page ouverte depuis un projet restait figée sur
   * lui, sans moyen de voir « Tous les projets ».
   */
  const filtreDeLaPage = (service: string | null) =>
    /* SUR ORDINATEUR, LE FILTRE NE SERT QUE SUR « TOUS LES PROJETS » (20/11/2026) : limitée à un projet, la page le
       porte en second cran du fil (« Service / Projet »), dont le chevron rend les autres projets. Communication n'en a
       pas : son accueil EST la liste des projets. */
    service === 'communication2' || (!telephone && porteeDuService !== TOUS_LES_PROJETS) ? null : (
      <div className="w-[200px]" data-filtre-du-service-central>
        <FiltreDuProjetDeLaPage valeur={porteeDuService} onChoisir={(id) => setFiltreDuServiceCentral(id)} />
      </div>
    );
  const filDuService = (service: string | null) =>
    service ? (
      <FilDesPagesDeService
        portee={porteeDuService}
        onPortee={(id) => setFiltreDuServiceCentral(id)}
        service={service}
        onService={(cle) => ouvrirServiceCentral(cle, porteeDuService)}
        onTousLesProjets={() => {
          setFiltreDuServiceCentral(TOUS_LES_PROJETS);
          /* Un outil de création revient à son accueil : la liste de tous les projets, plus la fiche d'un seul. */
          if (fenetreDeCreation) setViseDeCreation({});
        }}
      />
    ) : null;
  /*
   * LES PAGES DE SERVICE SE REFERMENT QUAND ON VA AILLEURS (14/11/2026) : une page couvre la zone centrale ; ouvrir une
   * tâche, un projet ou une autre vue depuis la colonne la referme, comme on quitte une page.
   */
  const lieuDeLaZone = `${carteAffichee ?? ''}|${state.activeProjectId ?? ''}|${vueDuFond}`;
  const lieuDeLaZoneVu = React.useRef(lieuDeLaZone);
  React.useEffect(() => {
    if (lieuDeLaZoneVu.current === lieuDeLaZone) return;
    const avant = lieuDeLaZoneVu.current;
    lieuDeLaZoneVu.current = lieuDeLaZone;
    /* …NI L'ARRIVÉE DU PROJET ACTIF AU CHARGEMENT (15/11/2026) : une page de service rouverte par son adresse
       (« #studio », « #calendrier ») ne se referme pas quand le serveur annonce le projet, quelques secondes après. */
    if (!avant.split('|')[1]) return;
    /* …SAUF LE CHANGEMENT QUE L'OUVERTURE DU SERVICE PROVOQUE ELLE-MÊME (14/11/2026) : ouvrir un service depuis une
       tâche referme la tâche, et ce départ ne doit pas refermer aussitôt le service qu'on vient d'ouvrir. */
    if (Date.now() - ouvertureDeServiceA.current < 1500) return;
    setFenetreDeCreation(null);
  }, [lieuDeLaZone]);
  /*
   * LES ONGLETS INSTANTANÉS (13/11/2026, `lib/vues-gardees.tsx`) : l'écran de chaque onglet déjà affiché reste monté,
   * caché, tant que son onglet est ouvert. Dans la zone centrale : l'accueil du projet et chaque outil, par projet ;
   * par-dessus : chaque tâche (et sa facturation), une page chacune. Hors d'un projet, rien n'est gardé.
   */
  const cleDeLaVue = projetDesOnglets ? `${projetDesOnglets.id}:${vueDuFond}` : `hors:${surTableauxDeBord ? 'tableaux' : vueDuFond}`;
  const garderLaVue = React.useCallback(
    (cle: string) => {
      if (!projetDesOnglets || !cle.startsWith(`${projetDesOnglets.id}:`)) return false;
      const vue = cle.slice(projetDesOnglets.id.length + 1);
      return vue === 'projet' || ongletsDuProjet.some((o) => (o.genre === 'service' || o.genre === 'objet') && o.service === vue);
    },
    [projetDesOnglets?.id, ongletsDuProjet],
  );
  let facturationAffichee = false;
  const cleDeCarteAffichee = carteAffichee ? (facturationAffichee ? `facturation:${carteAffichee}` : `tache:${carteAffichee}`) : null;
  const garderLaCarte = React.useCallback((cle: string) => ongletsDuProjet.some((o) => o.cle === cle), [ongletsDuProjet]);
  const vuesDeCarte = useVuesGardees(cleDeCarteAffichee, garderLaCarte);
  /* L'OBJET D'UN SERVICE OUVERT DANS LE PROJET (15/11/2026, capture #22ca « Fishflow / / ») : sur ordinateur, la barre du
     projet porte « service / projet / ce que le service écrit » (ordre inversé le 20/11/2026) — la suite du fil se pose
     DANS elle, plus dans le fil caché de la zone. */
  const barreDuProjet = React.useMemo<BarreDuProjet | null>(
    () =>
      projetDesOnglets
        ? {
            /* PLUS DE RANGÉE D'ONGLETS (14/11/2026) : le fil « projet / page » seul. */
            onglets: (
              <FilDuProjet
                sansIcone={telephone}
                project={projetDesOnglets}
                titre={ongletCourant ? (ongletCourant.titre || titreDOnglet(ongletCourant)) : null}
                onAccueil={() => activerLOnglet(null)}
                {...(suiteDansLaBarreDuProjet && serviceDuFond
                  ? {
                      service: {
                        cle: serviceDuFond,
                        libelle: t(CLES_TITRE_DE_VUE[serviceDuFond as keyof typeof CLES_TITRE_DE_VUE]),
                        adresse: construireFragment({ ...ecranDeLaVue({ vue: serviceDuFond, projectId: projetDesOnglets?.id ?? null }), portee: projetDesOnglets?.id }),
                        onOuvrir: () => ouvrirUnOutil(serviceDuFond),
                        adresseTous: construireFragment(ecranDeLaVue({ vue: serviceDuFond, projectId: null })),
                        onTous: () => ouvrirServiceCentral(serviceDuFond, TOUS_LES_PROJETS),
                        services: CLES_SERVICES_DU_MENU.filter((x) => servicesOuvertsAuCompte.includes(x.requis ?? x.cle)).map((x) => ({
                          valeur: x.cle,
                          libelle: t(x.cleLibelle),
                          groupe: x.groupe === 'creer' ? t('Créer') : t('Suivre'),
                        })),
                        onAutreService: (cle: string) => ouvrirServiceCentral(cle, projetDesOnglets.id),
                        onAutreProjet: (id: string) => ouvrirServiceCentral(serviceDuFond, id),
                      },
                      suite: <div ref={setCibleDeLaBarreDuProjet} data-suite-du-fil="barre-du-projet" className="contents" />,
                    }
                  : suiteDeLAccueilDesAgents
                    ? { suite: <div ref={setCibleDeLaBarreDuProjet} data-suite-du-fil="barre-du-projet" className="contents" /> }
                    : {})}
              />
            ),
            droite: (
              <>
                {/* LE BOUTON AUX QUATRE CARRÉS N'EXISTE PLUS (14/11/2026) : les services s'ouvrent par « Services », dans
                    la colonne de gauche. */}
                <div ref={setCibleDesGestesDuProjet} className="flex shrink-0 items-center gap-1.5 empty:hidden" data-gestes-de-page="barre-du-projet" />
                <BoutonPublier projectId={projetDesOnglets.id} />
              </>
            ),
            nom: projetDesOnglets.name,
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projetDesOnglets, ongletsDuProjet, ongletCourant?.cle, ongletCourant?.titre, activerLOnglet, vueDuFond, ouvrirUnOutil, ouvrirServiceCentral, servicesOuvertsAuCompte.join(','), telephone, cleDesOnglets, suiteDansLaBarreDuProjet, serviceDuFond, suiteDeLAccueilDesAgents],
  );
  /* LE HAUT DU TÉLÉPHONE, SUR DEUX ÉTAGES (03/11/2026) : le service en petit, le projet en grand. Le projet est
     celui que la page a déclaré (Communication : sa marque), sinon le projet actif pour les vues qui le suivent. */
  const [projetDeclare, setProjetDeclare] = React.useState<EtageDuProjet | null>(null);
  const refermerLaCarte = React.useCallback(() => setOpenCardId(null), []);
  const etageDuProjetActif = useEtageDuProjetActif(vueDuFond, refermerLaCarte);
  /* LE + DU CENTRE : un agent naît dans le projet ouvert ; hors de tout projet, on choisit d'abord le projet. */
  const [nouvelAgentEnCours, setNouvelAgentEnCours] = React.useState(false);
  const nouvelAgentDuBas = React.useCallback(() => {
    const projectId = client.lireEtat().activeProjectId;
    if (vueDuFond !== 'projet' || !projectId) {
      setTiroirNouvelAgent(true);
      return;
    }
    if (nouvelAgentEnCours) return;
    setNouvelAgentEnCours(true);
    void creerCarteAgent(projectId, (id) => (carteRobotIdRef.current = id)).finally(() => setNouvelAgentEnCours(false));
  }, [vueDuFond, nouvelAgentEnCours]);
  /*
   * LE HAUT D'UN PROJET SUR TÉLÉPHONE, LE MÊME SUR CHAQUE ÉCRAN DU PROJET (décision de l'utilisateur du 13/11/2026) :
   * « Tâches » à gauche, le nom au centre, les trois points puis « Publier » à droite, la rangée d'onglets dessous
   * avec le « + » en tête. La page d'une tâche ne le recouvre plus : elle s'ouvre SOUS lui (`--bas-du-haut-telephone`,
   * mesuré ici) et porte ses trois points dans son emplacement (`data-menu-de-tache-ici`).
   */
  const hautDuProjetTelephone = telephone && !!projetDesOnglets;
  const [voixVisible] = usePref<boolean>(CLE_VOIX_VISIBLE, false);
  const tacheAffichee = !!cleDeCarteAffichee?.startsWith('tache:');
  const [cibleDuMenuDeTache, setCibleDuMenuDeTache] = React.useState<HTMLElement | null>(null);
  const refHautTelephone = React.useRef<HTMLDivElement | null>(null);
  React.useLayoutEffect(() => {
    const el = refHautTelephone.current;
    const racine = document.documentElement;
    if (!el || !hautDuProjetTelephone) {
      racine.style.removeProperty('--bas-du-haut-telephone');
      return;
    }
    const mesurer = () => racine.style.setProperty('--bas-du-haut-telephone', `${Math.round(el.getBoundingClientRect().bottom)}px`);
    mesurer();
    const observateur = new ResizeObserver(mesurer);
    observateur.observe(el);
    window.addEventListener('resize', mesurer);
    /* La bande orange de l'extension qui paraît, se déplie ou part DÉPLACE le haut sans le redimensionner. */
    window.addEventListener('beluga:hauteur-banniere', mesurer);
    return () => {
      observateur.disconnect();
      window.removeEventListener('resize', mesurer);
      window.removeEventListener('beluga:hauteur-banniere', mesurer);
    };
  }, [hautDuProjetTelephone]);
  /* SUR TÉLÉPHONE, « PUBLIER » ET « OUTILS » MONTENT DU BAS (refonte du 13/11/2026). */
  const [feuillePublier, setFeuillePublier] = React.useState(false);
  const [feuilleOutils, setFeuilleOutils] = React.useState(false);
  /* LES TÂCHES DU PROJET, sur téléphone : la feuille du bas, ouverte par « Tâches » en haut à gauche (13/11/2026). */
  const [feuilleTaches, setFeuilleTaches] = React.useState(false);
  React.useEffect(() => setFeuilleTaches(false), [state.activeProjectId]);
  const compteAPublier = useCompteAPublier(telephone ? state.activeProjectId : null);
  const gestesDeLApplication = useGestesDeLApplication({
    onPublier: telephone ? () => setFeuillePublier(true) : undefined,
    compteAPublier,
    vue: vueDuFond,
    projectId: state.activeProjectId,
    surTableauxDeBord,
    ouvrirVue,
    onNouvelAgent: nouvelAgentDuBas,
    nouvelAgentEnCours,
  });
  /* LE MENU PRINCIPAL DU TÉLÉPHONE, à portée de toute page à deux rangs (la tâche) : le nom centré l'ouvre
     (13/11/2026) — la grille des services qu'il ouvrait n'existe plus sur téléphone. */
  const menuPrincipal = React.useMemo(() => ({ ouvrir: () => setProjetsOuverts(true) }), []);
  /* LE NOM CENTRÉ DU TÉLÉPHONE (14/11/2026) : dans un projet, il ouvre la feuille de ses tâches ; ailleurs, il n'est
     qu'un titre. Le menu principal est revenu au coin gauche. */
  const etagesTelephone = telephone ? (
    <EtagesDuTelephone
      vue={surTableauxDeBord ? 'en-route' : vueDuFond}
      libelleDuService={surTableauxDeBord ? t('Tableaux de bord') : vueDuFond === 'projet' ? t('Projets') : t(CLES_TITRE_DE_VUE[vueDuFond])}
      onOuvrirVue={ouvrirVue}
      projet={projetDeclare ?? etageDuProjetActif}
      onTaches={hautDuProjetTelephone ? () => setFeuilleTaches(true) : null}
      tachesOuvertes={feuilleTaches}
    />
  ) : undefined;
  /* LES OUTILS DU PROJET, SUR TÉLÉPHONE : demandés par les trois points du haut (accueil du projet ou tâche). */
  React.useEffect(() => {
    const ouvrirOutils = () => setFeuilleOutils(true);
    /* La feuille « Publier » est celle du TÉLÉPHONE ; sur ordinateur, le bouton « Publier » ouvre son propre menu. */
    const ouvrirPublier = () => {
      if (estTelephone()) setFeuillePublier(true);
    };
    window.addEventListener(EVENEMENT_OUVRIR_LES_OUTILS, ouvrirOutils);
    window.addEventListener(EVENEMENT_OUVRIR_PUBLIER, ouvrirPublier);
    return () => {
      window.removeEventListener(EVENEMENT_OUVRIR_LES_OUTILS, ouvrirOutils);
      window.removeEventListener(EVENEMENT_OUVRIR_PUBLIER, ouvrirPublier);
    };
  }, []);
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
  /* LA COLONNE DE GAUCHE GARDE TOUJOURS LES PROJETS, et la zone centrale n'a plus de menu de service (13/11/2026) :
     un service y montre sa navigation dans sa page. Seules les fenêtres Mémoire et Coffre-fort ont un menu à gauche. */
  const colonneDeService = COLONNE_COUPEE;
  /* CE QU'UN ÉCRAN DE LA ZONE CENTRALE ÉCRIT HORS DE LUI (barre, bas, colonne, haut du téléphone) : seul l'écran
     VISIBLE y a accès ; un écran gardé caché reçoit des emplacements vides (`GardeDeVue`). */
  /* L'ACCUEIL D'UN PROJET POSE SES GESTES (la période) DANS LA BARRE DU PROJET, à la hauteur de « Publier »
     (14/11/2026, « remonte la barre du milieu à la hauteur des boutons qui sont sur la droite »). */
  /* …ET L'OBJET D'UN SERVICE OUVERT DANS LE PROJET AUSSI (20/11/2026, maquette A de la campagne) : ses gestes et son
     « … » se posent au bout du fil « Service / Projet / Fiche », à côté de « Publier » — plus dans une bande vide qui
     repoussait la page de 48 px. */
  const gestesDansLaBarreDuProjet = !telephone && (vueDuFond === 'projet' || suiteDansLaBarreDuProjet) && !carteAffichee && !!projetDesOnglets && !!cibleDesGestesDuProjet;
  const cibleDesGestesDeLaZone = gestesDansLaBarreDuProjet ? cibleDesGestesDuProjet : cibleDesGestes;
  const valeursDeLaZone = React.useMemo<ValeursDeLaZone>(
    () => ({
      suite: suiteDuFil,
      colonne: colonneDeService,
      declarerProjet: setProjetDeclare,
      declarerGestes: setGestesDeclares,
      declarerNiveau: setNiveauDuBas,
      cibleDesGestes: cibleDesGestesDeLaZone,
      registre: registreDuMenuDuHaut,
      bas: basDePage,
      principalOrdinateur,
    }),
    [suiteDuFil, colonneDeService, cibleDesGestesDeLaZone, registreDuMenuDuHaut, basDePage, principalOrdinateur],
  );
  /* La poignée et la colonne suivent la largeur du lieu affiché. */
  /* LA COLONNE DE GAUCHE EST TOUJOURS LA MÊME (refonte du 13/11/2026) : un service n'en prend plus la place. Son
     menu se pose en RANGÉE en tête de sa page (`data-rangee-de-service`, plus bas). */
  void colonneServices;
  const gauche = colonneProjets;
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
  /* LA CARTE CRÉÉE À LA VOIX s'ouvre sur l'écran principal (décision de l'utilisateur, 20/11/2026), sans volet. */
  React.useEffect(() => {
    const ouvrir = (e: Event) => {
      const d = (e as CustomEvent<{ cardId?: string; projectId?: string }>).detail;
      if (!d?.cardId || !d.projectId) return;
      if (client.lireEtat().activeProjectId !== d.projectId) client.setActiveProject(d.projectId);
      ouvrirLaCarteDuProjet(d.cardId);
      setMobileView('board');
    };
    window.addEventListener('beluga:ouvrir-carte-de-jarvis', ouvrir);
    return () => window.removeEventListener('beluga:ouvrir-carte-de-jarvis', ouvrir);
  }, [ouvrirLaCarteDuProjet, setMobileView]);
  const ouvrirUneCarteDeCommunication = React.useCallback(
    (cardId: string, projectId: string) => {
      if (client.lireEtat().activeProjectId !== projectId) client.setActiveProject(projectId);
      ouvrirLaCarteDuProjet(cardId);
      setMobileView('board');
    },
    [ouvrirLaCarteDuProjet, setMobileView],
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
        {/* Un agent ouvert depuis « Tableaux de bord » s'ouvre DANS SON PROJET
            (30/10/2026), sa ligne allumée dans la colonne de gauche. */}
        <EnRoute onOpenCard={ouvrirCarteDepuisUnService} onOpenAgent={(agentId) => ouvrirAgent(agentId, false)} />
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
      <FournirLeCranDesTableauxDeBord value={null}>
      <FournirLaSuiteDuFil value={suiteDuFil}>
      <FournirLaColonneDeService value={colonneDeService}>
      <FournirLaBarreDuProjet value={barreDuProjet}>
      <FournirLaCibleDuMenuDeTache value={cibleDuMenuDeTache}>
      <FournirLeProjetDuService value={projetDuService}>
      <FournirLaDeclarationDuProjet value={setProjetDeclare}>
      <FournirLaDeclarationDesGestesDuBas value={setGestesDeclares}>
      <FournirLaDeclarationDuNiveauDuBas value={setNiveauDuBas}>
      <div
        /*
         * L'application prend TOUTE la hauteur de la page, en flux normal.
         * Surtout pas « ancrée aux quatre bords » : sur téléphone, une page
         * dont plus rien n'est dans le flux voit sa hauteur s'effondrer, et
         * le système réserve alors une bande vide en bas (le même piège avait
         * été rencontré sur ProjetE et ProjetA). Clavier réellement ouvert, sa
         * hauteur est la zone visible au-dessus de lui (`--hauteur-visible`).
         */
        className="flex h-full flex-col overflow-hidden bg-bg"
        /* LA RACINE QUI REMONTE QUAND LE TERMINAL S'OUVRE derrière elle (`styles.css`). */
        data-app-racine
        style={{ height: 'var(--hauteur-visible, 100%)' }}
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
        <Celebrations />
        {/* LA BANDE DU HAUT (`bande-du-haut.tsx`) : au-dessus de TOUT, colonne et entête compris. L'orange d'une
            extension Chrome en retard passe avant ; sinon, sur une installation qui suit le dépôt public, la bande noire
            « Une nouvelle mise à jour est disponible » (logiciel libre, 23/11/2026), muette pendant la mise en route. */}
        <BanniereExtension
          sinon={
            demarrageOuvert ? null : (
              <Filet zone="Bandeau de mise à jour" muet>
                <BandeauMiseAJour
                  onOuvrirLaPage={() => {
                    setSettingsPage('mise-a-jour');
                    setSettingsOpen(true);
                  }}
                />
              </Filet>
            )
          }
        />
        {/* LE SUIVI DE BELUGA CONNECT (carte « Liaison Chrome automatique et suivie ») : la fenêtre de connexion ouverte seule
            sur l'ordinateur qu'on installe, et un message d'information pour les autres travaux. */}
        <Filet zone="Suivi de Beluga Connect" muet>
          <SuiviDeConnect />
        </Filet>
        {/* LA FENÊTRE DES OUTILS DE CRÉATION, dans le projet affiché. */}
        <FenetreDeService
          open={!!fenetreDeCreation}
          onClose={() => setFenetreDeCreation(null)}
          titre={fenetreDeCreation ? t(CLES_TITRE_DE_VUE[fenetreDeCreation as keyof typeof CLES_TITRE_DE_VUE]) : ''}
          icone={(() => {
            const Icone = CLES_DES_SERVICES.find((x) => x.cle === fenetreDeCreation)?.Icone;
            return Icone ? <Icone /> : null;
          })()}
          repere={`creation-${fenetreDeCreation ?? ''}`}
          sansMenuDuService
          enPage
          sousPage={
            !!fenetreDeCreation &&
            adresseDObjetReel(construireFragment(ecranDeLaVue({ vue: fenetreDeCreation, element: viseDeCreation, projectId: state.activeProjectId })))
          }
          droiteDeLaPage={filtreDeLaPage(fenetreDeCreation)}
          filDeLaPage={filDuService(fenetreDeCreation)}
        >
          <FournirLeFiltreCentral value={filtreDuServiceCentral !== undefined}>
          <FournirLeChoixDeLaPortee value={setFiltreDuServiceCentral}>
          <FournirLeProjetDuService value={projetDeLaFenetre}>
            {/* UN MONTAGE PAR OUTIL (`key`) : passer du Studio à Marketing démonte le Studio pour de bon — sa frise
                restait affichée sous la liste Marketing pendant le chargement de l'autre outil (capture #84cfd). */}
            {fenetreDeCreation === 'studio' ? (
              <PanneauALaDemande key="studio" monte attente={<SilhouetteTableauDeService zone="studio" />}>
                <Studio open enPage onClose={() => setFenetreDeCreation(null)} vise={viseDeCreation.studio ?? null} onVise={(creationId) => viserDansLaFenetre('studio', { studio: creationId })} />
              </PanneauALaDemande>
            ) : fenetreDeCreation === 'communication2' ? (
              <PanneauALaDemande key="communication2" monte attente={<SilhouetteTableauDeService zone="communication" />}>
                <Communication2 vise={viseDeCreation.communication2 ?? null} onVise={(chemin) => viserDansLaFenetre('communication2', { communication2: chemin })} onOuvrirCarte={ouvrirUneCarteDeCommunication} />
              </PanneauALaDemande>
            ) : fenetreDeCreation === 'plaquettes' ? (
              <PanneauALaDemande key="plaquettes" monte attente={<SilhouetteTableauDeService zone="plaquettes" />}>
                <Plaquettes
                  open
                  enPage
                  onClose={() => setFenetreDeCreation(null)}
                  vise={viseDeCreation.plaquettesProjet ?? null}
                  plaquetteVisee={viseDeCreation.plaquette ?? null}
                  onVise={(projet, plaquetteId) => viserDansLaFenetre('plaquettes', { plaquettesProjet: projet, plaquette: plaquetteId ?? null })}
                />
              </PanneauALaDemande>
            ) : null}
          </FournirLeProjetDuService>
          </FournirLeChoixDeLaPortee>
          </FournirLeFiltreCentral>
        </FenetreDeService>
        {/* LES OUTILS DE FONCTIONNEMENT EN GRANDE FENÊTRE, SANS ONGLET (décision du 13/11/2026) : Statistiques,
            Messagerie, Backup, Surveillance, Tâches récurrentes, par-dessus l'écran du fond. À gauche, ces outils ; à
            droite, celui choisi, limité au projet ouvert (ou tous les projets, ouvert depuis « Tous les projets »). */}
        <FenetreDeService
          open={!!fenetreDeFonctionnement}
          onClose={fermerLaFenetre}
          titre={fenetreDeFonctionnement ? t(CLES_TITRE_DE_VUE[fenetreDeFonctionnement as keyof typeof CLES_TITRE_DE_VUE]) : ''}
          icone={(() => {
            const Icone = CLES_DES_SERVICES.find((x) => x.cle === fenetreDeFonctionnement)?.Icone;
            return Icone ? <Icone /> : null;
          })()}
          repere={`fonctionnement-${fenetreDeFonctionnement ?? ''}`}
          sansMenuDuService
          large
          enPage
          droiteDeLaPage={filtreDeLaPage(fenetreDeFonctionnement)}
          filDeLaPage={filDuService(fenetreDeFonctionnement)}
        >
          <FournirLeFiltreCentral value={filtreDuServiceCentral !== undefined}>
          <FournirLeProjetDuService value={projetDeLaFenetre}>
            {fenetreDeFonctionnement === 'espace-client' ? (
              <Filet zone="Espace client">
                <PanneauALaDemande monte attente={<SilhouetteEspaceHaiko />}>
                  <EspaceHaiko vise={espaceVise} onVise={(vu) => setEspaceVise(vu)} />
                </PanneauALaDemande>
              </Filet>
            ) : fenetreDeFonctionnement === 'backups' ? (
              <Filet zone="Backups">
                <PanneauALaDemande monte attente={<SilhouetteTableauDeService zone="backups" />}>
                  <Backups
                    open
                    enPage
                    onClose={fermerLaFenetre}
                    vise={elementVise.backups ?? null}
                    onVise={(siteId) => setElementVise((v) => ({ ...v, backups: siteId }))}
                  />
                </PanneauALaDemande>
              </Filet>
            ) : fenetreDeFonctionnement === 'surveillance' ? (
              <Filet zone="Surveillance">
                <PanneauALaDemande monte attente={<SilhouetteTableauDeService zone="surveillance" />}>
                  <Surveillance
                    open
                    enPage
                    onClose={fermerLaFenetre}
                    vise={elementVise.surveillance ?? null}
                    onVise={(siteId) => setElementVise((v) => ({ ...v, surveillance: siteId }))}
                  />
                </PanneauALaDemande>
              </Filet>
            ) : fenetreDeFonctionnement === 'securite' ? (
              <Filet zone="Sécurité">
                <PanneauALaDemande monte attente={<SilhouetteTableauDeService zone="securite" />}>
                  <Securite
                    open
                    enPage
                    onClose={fermerLaFenetre}
                    vise={elementVise.securite ?? null}
                    onVise={(projetId) => setElementVise((v) => ({ ...v, securite: projetId }))}
                  />
                </PanneauALaDemande>
              </Filet>
            ) : fenetreDeFonctionnement === 'statistiques' ? (
              <Filet zone="Statistiques">
                <PanneauALaDemande monte attente={<AttenteEcran><SilhouetteStatistiques /></AttenteEcran>}>
                  <Statistiques
                    open
                    enPage
                    onClose={fermerLaFenetre}
                    vise={elementVise.statistiques ?? null}
                    onVise={(siteId) => setElementVise((v) => ({ ...v, statistiques: siteId }))}
                    onOuvrirCarte={ouvrirCarteDepuisUnService}
                  />
                </PanneauALaDemande>
              </Filet>
            ) : fenetreDeFonctionnement === 'taches-recurrentes' ? (
              <Filet zone="Tâches planifiées">
                <PanneauALaDemande monte attente={<SilhouetteTableauDeService zone="taches-recurrentes" />}>
                  <TachesRecurrentes
                    open
                    enPage
                    onClose={fermerLaFenetre}
                    vise={elementVise.recurrentes ?? null}
                    veilleVisee={elementVise.recurrenteVeille ?? null}
                    onVise={onViseRecurrentes}
                  />
                </PanneauALaDemande>
              </Filet>
            ) : null}
          </FournirLeProjetDuService>
          </FournirLeFiltreCentral>
        </FenetreDeService>
        {/* LES FENÊTRES DE SERVICE : Mémoire et Coffre-fort, par-dessus l'écran du fond. */}
        <FenetreDeService open={fenetreDeService === 'coffre'} onClose={fermerLaFenetre} titre={t('Coffre-fort')} icone={<Key />} repere="coffre" large>
          {fenetreDeService === 'coffre' ? (
            <Filet zone="Coffre-fort">
                  <PanneauALaDemande monte attente={<AttenteEcran><SilhouetteCoffre /></AttenteEcran>}>
                    <CoffreFort
                      open
                      enPage
                      onClose={fermerLaFenetre}
                      vise={elementVise.coffre ?? null}
                      onVise={(ficheId) => setElementVise((v) => ({ ...v, coffre: ficheId }))}
                    />
                  </PanneauALaDemande>
                </Filet>
          ) : null}
        </FenetreDeService>
        <FenetreDeService open={fenetreDeService === 'memoire'} onClose={fermerLaFenetre} titre={t('Mémoire')} icone={<Library />} repere="memoire">
          {fenetreDeService === 'memoire' ? (
            <Filet zone="Mémoire">
                  <PanneauALaDemande monte attente={<AttenteEcran><SilhouetteCoffre /></AttenteEcran>}>
                    <MemoireClasseurs
                      open
                      enPage
                      onClose={fermerLaFenetre}
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
          ) : null}
        </FenetreDeService>
        {telephone ? (
          <>
            <FeuillePublier projectId={state.activeProjectId} ouvert={feuillePublier} onFermer={() => setFeuillePublier(false)} />
            <FeuilleDesServices ouvert={feuilleOutils} onFermer={() => setFeuilleOutils(false)} vue={vueDuFond} onOuvrirVue={ouvrirUnOutil} />
            <FeuilleDesTaches
              projectId={state.activeProjectId}
              carteOuverte={carteAffichee}
              ouvert={feuilleTaches}
              onFermer={() => setFeuilleTaches(false)}
              onOuvrir={(card) => ouvrirCarteDuTableau(card.id)}
              onCree={(id) => (carteRobotIdRef.current = id)}
            />
          </>
        ) : null}

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
                vue={vueDuFond}
                onOuvrirVue={ouvrirVue}
                onEntrerDansLeProjet={entrerDansLeProjet}
                onOpenSettings={() => setSettingsOpen(true)}
                onNouvelAgent={(projectId) => {
                  if (projectId) void creerCarteAgent(projectId, (id) => (carteRobotIdRef.current = id));
                  else setTiroirNouvelAgent(true);
                }}
                carteOuverte={carteAffichee}
                onOuvrirCarte={(card) => ouvrirCarteDepuisUnService(card)}
                onCreerAgent={creerUnAgent}
                onOuvrirServiceCentral={ouvrirServiceCentral}
                serviceCentralActif={serviceCentralActif}
              />
            </Filet>
          </div>
          <ResizeHandle
            cacheAuRepos
            /* SANS PLACE À ELLE (01/11/2026, capture #e118) : elle chevauche le bord de la zone (`-mr-1`, posée
               au-dessus), pour que la barre du fil d'Ariane et les pages s'ouvrent collées à la colonne — ses 4 px
               laissaient une fente du fond de l'application entre les deux. */
            className="z-10 hidden sm:-mr-1 sm:block"
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
            {/* LA BANDE SOUS L'HEURE, DU FOND EXACT DE LA ZONE : un élément fixe et
                opaque au bord du haut, qui fait renoncer iOS à son flou
                (`bande-sous-l-heure.tsx`). La colonne des projets du téléphone
                s'ouvre déjà en panneau fixe jusqu'en haut : elle n'en a pas besoin. */}
            <BandeSousLHeure className="left-0 right-0 sm:left-[var(--zone-principale-gauche,0px)]" />
            {/* LA BARRE D'EN-TÊTE, LA MÊME SUR CHAQUE PAGE : le fil d'Ariane à
                gauche, puis la cloche et les options de la page derrière
                trois points. Elle remplace le bandeau qui courait sur toute la
                largeur de l'écran. */}
            <div ref={refHautTelephone} className="shrink-0" data-haut-du-telephone={hautDuProjetTelephone ? '' : undefined}>
            <EnteteDeZone
              ongletsDuProjet={!!projetDesOnglets}
              chemin={cheminDeLaPage}
              titre={titreDeLaPage}
              etagesTelephone={etagesTelephone}
              hautEnLigne={!!projetDeclare?.contenu}
              /* SUR TÉLÉPHONE, UN SEUL BOUTON À GAUCHE (menu ou retour) ; l'agent passe À DROITE, devant les trois
                 points (décision de l'utilisateur du 03/11/2026 : au plus un bouton à gauche, deux à droite). */
              /* UN SERVICE QUI A ÉCRIT LA SUITE DU FIL (le site, le client, la
                 création ouverte) : son nom redevient un cran, qui y ramène. */
              titreEnCran={suitePresente}
              onTitre={suitePresente ? () => retourDeLaSuite.current?.() : undefined}
              suite={suiteDansLaBarreDuProjet ? null : <div ref={setCibleDuFilDeZone} data-suite-du-fil="barre" className="contents" />}
              /* SUR TÉLÉPHONE, DANS UN ENFANT DU SERVICE, la flèche de retour
                 prend la place du bouton des projets : elle remonte d'un cran,
                 et aucune page n'a plus de barre de retour à elle. */
              /* …SAUF DANS UN PROJET (décision du 13/11/2026) : « Tâches » y tient le coin gauche, sur tous ses écrans. */
              onRetour={telephone && reperesDuRetour && !hautDuProjetTelephone ? () => retourDUnCran.current?.() : undefined}
              reperesDeRetour={telephone && reperesDuRetour && !hautDuProjetTelephone ? reperesDuRetour : undefined}
              onOuvrirColonne={() => setProjetsOuverts(true)}
              /* DANS UN PROJET, SUR TÉLÉPHONE : « Tâches » tient le coin gauche (plus de logo du projet, plus de flèche).
                 Il ouvre la liste des tâches dans la feuille du bas, sans changer de page ; violet tant qu'elle est
                 ouverte (13/11/2026). */
              insigneAGauche={telephone ? <BoutonDuMenuPrincipal ouvrir={() => setProjetsOuverts(true)} /> : undefined}
              /* LES OPTIONS DU PROJET, derrière les trois points : avec les deux gestes de
                 publication sur téléphone. Thème, langue, terminal et redémarrage sont
                 dans les réglages, ouverts de partout. */
              menu={
                telephone ? (
                  /* LES TROIS POINTS DU TÉLÉPHONE : le geste de la page, la cloche, ses options — et dans un projet,
                     les options du projet, dans le MÊME menu. Sur une tâche, ce sont les siens (`MenuCarte`), qu'elle
                     pose dans l'emplacement ; puis « Publier », tout à droite. */
                  <>
                  {hautDuProjetTelephone && tacheAffichee ? (
                    <div ref={setCibleDuMenuDeTache} className="contents" data-menu-de-tache-ici />
                  ) : null}
                  <div className={hautDuProjetTelephone && tacheAffichee ? 'hidden' : 'contents'}>
                  <MenuDuHautTelephone
                    assistant={hautDuProjetTelephone && state.monRole === 'admin'}
                    registre={registreDuMenuDuHaut}
                    menuDuProjet={
                      vueDuFond === 'projet' && activeProject
                        ? (declencheur, enTete) => (
                            <MenuGeneral
                              onOpenDashboard={ouvrirTableauDeBord}
                              onOuvrirFichiers={ouvrirFichiersOuPieces}
                              onOuvrirVue={ouvrirVue}
                              declencheur={declencheur}
                              enTete={enTete}
                            />
                          )
                        : undefined
                    }
                  />
                  </div>
                  {hautDuProjetTelephone && projetDesOnglets ? <BoutonPublierDuHaut projectId={projetDesOnglets.id} /> : null}
                  </>
                ) : vueDuFond === 'projet' && activeProject ? (
                  <MenuGeneral
                    onOpenDashboard={ouvrirTableauDeBord}
                    onOuvrirFichiers={ouvrirFichiersOuPieces}
                    onOuvrirVue={ouvrirVue}
                    declencheur={<BoutonOptionsDuProjet />}
                  />
                ) : undefined
              }
            >
              {/* LES GESTES DE LA PAGE AFFICHÉE : chaque service y pose les
                  siens (`GestesDePage`), devant les boutons communs. */}
              {/* SUR ORDINATEUR, LES GESTES DE LA PAGE ONT QUITTÉ LA BARRE (13/11/2026) : ils vivent dans le coin haut
                  droit de la zone, sous la barre (`BandeDeZone`). Le téléphone les range dans ses trois points. */}
              {telephone ? (
                <div ref={setCibleDesGestes} data-gestes-de-page="barre" data-rangee-de-boutons className={CLASSE_CIBLE_DES_GESTES} />
              ) : (
                /* SUR ORDINATEUR, LE COIN DE LA ZONE EST DANS LA BARRE (21/11/2026, #d8bc) : gestes et chevron des options
                   à droite du fil, plus aucune bande sous la barre qui ne porte qu'un chevron. */
                <div className={carteAffichee ? 'hidden' : 'contents'}>
                  <BandeDeZone enLigne vue={vueDuFond} onCibleDesGestes={setCibleDesGestes} registre={registreDuCoin} cibleDuBas={principalOrdinateur} />
                </div>
              )}
              {/* SUR ORDINATEUR, LA CLOCHE VIT DANS LE PIED DE LA COLONNE, à côté des réglages (demande du 12/10/2026) ;
                  sur téléphone, elle est dans les trois points, et l'agent se pose juste avant eux (03/11/2026). */}
              {/* L'ASSISTANT N'A PLUS D'ENTRÉE DANS L'ENTÊTE (16/11/2026) : le bouton du bord est sa seule entrée. */}
            </EnteteDeZone>
            {/* SUR TÉLÉPHONE, LA MÊME RANGÉE D'ONGLETS SOUS LE NOM DU PROJET (maquette #03fa), défilable au doigt, le
                « + » d'une nouvelle tâche en tête. */}
            {/* LA RANGÉE D'ONGLETS DU TÉLÉPHONE A DISPARU AVEC CELLE DE L'ORDINATEUR (14/11/2026). */}
            {/* LE REPÈRE DU BAS DE LA BARRE, POUR LE MODULE DE VOIX SUR TÉLÉPHONE (16/11/2026, carte « Assistant vocal
                rapide ») : le module n'est plus en haut à droite mais au BORD GAUCHE, tiré du doigt ; ce repère sans
                hauteur dit seulement où commence la bande où il peut glisser (`voix-assistant.tsx`). */}
            {telephone && (voixVisible || state.monRole === 'admin') ? <div data-place-de-la-voix aria-hidden className="h-0 shrink-0" /> : null}
            </div>
            <FournirLaCibleDesGestes value={cibleDesGestes}>
            <FournirLeRegistreDuCoin value={coinDeLaZone}>
            <FournirLeRegistreDuMenuDuHaut value={registreDuMenuDuHaut}>
            <CibleDuBasDePage.Provider value={basDePage}>
            {/* LA BANDE DE LA ZONE (13/11/2026) : le seul coin haut droit, qui reçoit les gestes et les options de la
                page — plus aucune rangée de boutons en haut à gauche, plus aucune liste en haut des services. */}
            {/* (La bande sous la barre a rejoint la barre elle-même, 21/11/2026.) */}
            {/* LE MORCEAU DE L'ÉCRAN EST ENCORE EN ROUTE : sa silhouette tient la place, au lieu de
                laisser toute la zone du milieu vide le temps du téléchargement. */}
            {/* LES ONGLETS INSTANTANÉS : l'écran de la vue affichée, et ceux des onglets ouverts gardés montés, cachés. */}
            <VuesGardees
              cle={cleDeLaVue}
              garder={garderLaVue}
              envelopper={(cle, visible, contenu) => (
                <GardeDeVue
                  cle={cle}
                  visible={visible}
                  valeurs={valeursDeLaZone}
                  projetDuService={visible ? projetDuService : estUnServiceDuProjet(cle.slice(cle.indexOf(':') + 1)) ? projetFigeDuService : null}
                >
                  {contenu}
                </GardeDeVue>
              )}
            >
            {vueDuFond === 'communication2' ? (
                <Filet zone="Communication">
                  <PanneauALaDemande monte attente={<AttenteEcran><SilhouetteMarketing /></AttenteEcran>}>
                    <Communication2 vise={elementVise.communication2 ?? null} onVise={onViseCommunication2} onOuvrirCarte={ouvrirUneCarteDeCommunication} />
                  </PanneauALaDemande>
                </Filet>
              ) : vueDuFond === 'studio' ? (
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
              ) : vueDuFond === 'plaquettes' ? (
                <Filet zone="Plaquettes">
                  <PanneauALaDemande monte attente={<AttenteEcran><SilhouetteTachesRecurrentes /></AttenteEcran>}>
                    <Plaquettes
                      open
                      enPage
                      onClose={() => ouvrirVue('projet')}
                      vise={elementVise.plaquettesProjet ?? null}
                      plaquetteVisee={elementVise.plaquette ?? null}
                      onVise={onVisePlaquettes}
                    />
                  </PanneauALaDemande>
                </Filet>
              ) : vueDuFond === 'en-route' ? (
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
                /* PLUS DE TABLEAU (30/10/2026) : l'accueil du projet sur
                   ordinateur — où la colonne liste les agents —, la liste en plein
                   écran sur téléphone. */
                <Filet zone="Agents du projet">
                  <PageDuProjet
                    projectId={activeProject.id}
                    onOuvrir={(card) => ouvrirCarteDuTableau(card.id)}
                    agents={accueilAgents && accueilAgents.projectId === activeProject.id ? { ...(accueilAgents.agentPersoId ? { agentPersoId: accueilAgents.agentPersoId } : {}) } : null}
                    onAgents={(choix) => choisirLAccueil(activeProject.id, choix)}
                  />
                </Filet>
              ) : !state.pret && !state.copieLocale ? (
                /* LE PREMIER ÉTAT DU SERVEUR N'EST PAS ENCORE ARRIVÉ : aucun projet
                   n'est choisi parce qu'on ne connaît pas encore la liste. On
                   dessine donc le tableau à venir en silhouette, au lieu d'annoncer
                   un vide qui n'en est pas un. */
                <div className="mx-auto w-full max-w-xl px-4 pt-4">
                  <SilhouetteAgents pleinePage />
                </div>
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
            </VuesGardees>
            {/* LE GESTE PRINCIPAL DE LA PAGE, EN BAS ET PLEINE LARGEUR DU CONTENU, SUR ORDINATEUR AUSSI (13/11/2026). */}
            {!telephone ? (
              <div
                ref={setPrincipalOrdinateur}
                className={cn('mx-auto w-full shrink-0 pb-4 pt-2 empty:hidden', CLASSE_LARGEUR_DE_CONTENU, CLASSE_MARGES_DE_PAGE, carteAffichee && 'hidden')}
                data-geste-en-bas
              />
            ) : null}
            </CibleDuBasDePage.Provider>
            </FournirLeRegistreDuMenuDuHaut>
            </FournirLeRegistreDuCoin>
            </FournirLaCibleDesGestes>
          </main>

        </div>

        {/* LE MENU DU TÉLÉPHONE, LA SEULE PORTE DE NAVIGATION : une feuille qui monte du
            bas jusqu'en haut de la vue, juste sous l'heure (demandes du 30/10/2026),
            avec la même colonne que sur ordinateur. Au-delà, le panneau qui glisse
            depuis la gauche, inchangé. */}
        {telephone ? (
          <Drawer feuille plein jusquEnHaut zone="gauche" open={projetsOuverts} onClose={() => setProjetsOuverts(false)}>
            <DialogTitle className="sr-only">{t('Projets')}</DialogTitle>
            <div data-menu-du-telephone className="flex min-h-0 flex-1 overflow-hidden">
              {colonneDuMenu}
            </div>
          </Drawer>
        ) : (
          <SidePanel open={projetsOuverts} onClose={() => setProjetsOuverts(false)} title={t('Projets')}>
            {colonneDuMenu}
          </SidePanel>
        )}

        {/* LE BAS DE L'ÉCRAN DU TÉLÉPHONE, ÉCRAN PAR ÉCRAN (décision du 03/11/2026, `shared/src/menu-du-bas.ts`) :
            aucun bas, un bouton pleine largeur, ou des boutons répartis sur la largeur, l'action principale au
            centre. Le bas reste dans le flux : il réserve sa place, le contenu ne passe jamais derrière. */}
        {telephone ? (
          <MenuDuBasDuTelephone menu={menuBas} gestes={{ ...gestesDeLApplication, ...(gestesDeclares ?? {}) }} onCibleDuPrincipal={setCibleDuBas} />
        ) : null}
        {/* LA FENÊTRE D'ARCHIVAGE D'UN PROJET : téléchargée à la première demande (`lib/archivage-projet.ts`). */}
        {archivageDemande ? (
          <React.Suspense fallback={null}>
            <FenetreDArchivage />
          </React.Suspense>
        ) : null}
        {fenetreFichiers ? (
          <React.Suspense fallback={null}>
            <FenetreDesFichiers open={fenetreFichiers.ouverte} chemin={fenetreFichiers.chemin} projetId={fenetreFichiers.projetId} onClose={() => setFenetreFichiers((f) => (f ? { ...f, ouverte: false } : f))} />
          </React.Suspense>
        ) : null}
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
          {/* LES TÂCHES OUVERTES EN ONGLETS RESTENT MONTÉES (13/11/2026) : seule celle de l'onglet actif est visible ;
              les autres reviennent d'un coup, telles qu'on les a laissées. Aucune tâche jamais affichée n'est montée. */}
          {vuesDeCarte.map((cle) => {
            const visible = cle === cleDeCarteAffichee;
            const genre = cle.slice(0, cle.indexOf(':'));
            const id = cle.slice(cle.indexOf(':') + 1);
            void genre;
            return (
              <PanneauALaDemande key={cle} monte>
                <CardPanel
                  cardId={id}
                  cache={!visible}
                  onClose={visible ? () => setOpenCardId(null) : rienAFaire}
                  onglet={visible ? ongletCarte : null}
                  onOnglet={visible ? setOngletCarte : undefined}
                  onOuvrirVue={(vue) => {
                    /* Un projet ou « Tableaux de bord » choisi depuis le fil de la
                       tâche : la tâche se referme et la destination s'affiche. */
                    setOpenCardId(null);
                    ouvrirVue(vue);
                  }}
                />
              </PanneauALaDemande>
            );
          })}
        </Filet>
        {/* LE TERMINAL DU SERVEUR : son rond (ordinateur), le pied du menu
            (téléphone) ou les réglages l'ouvrent, la fenêtre des réglages
            refermée. */}
        {/* Fermé sur un serveur loué (offre hébergée) : aucune entrée, aucun volet. */}
        {!state.offreHebergee ? (
          <TerminalDeLApplication onOuverture={fermerLesReglages} admin={state.monRole === 'admin'} />
        ) : null}
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
        {/* LA QUESTION DE L'AGENT DE CONFIGURATION S'OUVRE SEULE, AU CENTRE (15/11/2026) : son morceau ne se demande
            qu'à la première question posée, puis la fenêtre reste montée et écoute. */}
        {/* LA QUESTION DU DÉPANNEUR D'UNE PUBLICATION, AU CENTRE (21/11/2026) : montée dès qu'un dépanneur attend. */}
        <Filet zone="Question du dépanneur">
          <PanneauALaDemande monte={unDepanneurAttendVu}>
            <QuestionDuDepanneur />
          </PanneauALaDemande>
        </Filet>
        <Filet zone="Question de configuration">
          <PanneauALaDemande monte={questionDeConfigurationVue}>
            <QuestionDeConfiguration />
          </PanneauALaDemande>
        </Filet>
        <Filet zone="Agent de configuration" onReprendre={() => setDemandeInitialeConfiguration(null)}>
          <PanneauALaDemande monte={!!demandeInitialeConfiguration}>
            <TiroirAgentDeConfiguration initiale={demandeInitialeConfiguration} />
          </PanneauALaDemande>
        </Filet>
        <Toasts />
        {/* Une commande du terminal ou une suppression sur un ordinateur relié attend l'accord de son propriétaire. */}
        <FenetreDAccordOrdinateur />
        {/* « Relier ce Mac ? » : Beluga Connect a ouvert Beluga pour se relier à ce compte (21/11/2026). */}
        <FenetreDeLiaison />
        {/* Dans l'application installée, un lien vers un fichier s'ouvre ICI,
            dans une fenêtre refermable — il ne remplace plus tout l'écran. */}
        <VisionneuseDeLien />
        {/* Un média d'une réponse d'agent sans galerie autour de lui s'ouvre ICI, jamais dans un onglet. */}
        <VisionneuseDesMedias />

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
        {/* L'ACCORD DU PARTAGE DE L'ADRESSE, demandé une fois aux installations
            déjà en place (`question-du-partage.tsx`). */}
        {demarrageOuvert ? null : <QuestionDuPartage />}
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
        {/* PAS PENDANT LA MISE EN ROUTE (20/11/2026) : resté ouvert, le volet passait devant la discussion. */}
        {state.monRole === 'admin' && !demarrageOuvert ? (
          <Filet zone="Assistant global" muet>
            {/* PARTOUT, COMMUNICATION ET MARKETING COMPRIS (carte « Jarvis : volet, voix et rapidité », 16/11/2026) :
                le volet du chef d'orchestre s'ouvre par le bouton du bord sur tous les écrans. */}
            <AssistantGlobal />
          </Filet>
        ) : null}
        {/* La visite guidée du premier démarrage : une bulle à la fois, fermable. */}
        <Filet zone="Visite guidée" muet>
          <VisiteGuidee />
        </Filet>
        <Filet zone="Module de voix" muet>
          <PanneauALaDemande monte>
            <VoixAssistant />
          </PanneauALaDemande>
        </Filet>
        {/* LA RECHERCHE AU CENTRE (⌘F, ou la loupe du menu des services) : services, projets et tâches. */}
        <Filet zone="Recherche" muet>
          <RechercheCentrale
            onOuvrirVue={(vue) => {
              setOpenCardId(null);
              /* Un SERVICE trouvé s'ouvre comme depuis le menu « Services » : tous les projets, portée dans l'adresse. */
              if (VUES_DE_FONCTIONNEMENT.includes(vue) || OUTILS_DE_CREATION.includes(vue)) ouvrirServiceCentral(vue);
              else ouvrirVue(vue);
            }}
            onOuvrirCarte={(card) => ouvrirCarteDepuisUnService(card)}
          />
        </Filet>

      </div>
      </FournirLaDeclarationDuNiveauDuBas>
      </FournirLaDeclarationDesGestesDuBas>
      </FournirLaDeclarationDuProjet>
      </FournirLeProjetDuService>
      </FournirLaCibleDuMenuDeTache>
      </FournirLaBarreDuProjet>
      </FournirLaColonneDeService>
      </FournirLaSuiteDuFil>
      </FournirLeCranDesTableauxDeBord>
      </FournirLeMenuPrincipal>
      </FournirLeLieu>
      </EnteteDePageParDefaut.Provider>
    </TooltipProvider>
  );
}
