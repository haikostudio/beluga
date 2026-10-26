import { noterUneCoupure } from './mesure-d-usage';
import {
  AccountQuota,
  Agent,
  Attachment,
  type MediaEnFabrication,
  CapacityEtat,
  Card,
  ColumnKey,
  type TotauxParColonne,
  positionDeReprise,
  premiereTranche,
  resteSurLeServeur,
  totauxApresChangement,
  ClientCommand,
  CommandeSlash,
  ConnexionCompte,
  DecisionAttendue,
  CiblePublication,
  DeployRun,
  productionsApres,
  EngineInfo,
  EntreeJournal,
  fusionnerEntreeJournal,
  journalATrou,
  LigneDuCarnet,
  EtatProcedure,
  FileNode,
  Message,
  Project,
  ProjectGroup,
  QueuedPrompt,
  ServerEvent,
  Settings,
  SiteSurveille,
  SystemProcess,
  AnnonceRecue,
  CLE_PROJET_ACTIF,
  CLE_OUVERTURES_DE_PROJETS,
  noterOuverture,
  ouverturesValides,
  DUREE_MESSAGE_MS,
  PLAFOND_ANNONCES,
  ajouterAnnonce,
  marquerLues,
  EVENEMENT_ATTENTE_LONGUE,
  DELAI_ATTENTE_LANCEMENT_MS,
  RAISON_SANS_REPONSE,
  SEUIL_LONGUE_ATTENTE_MS,
  motDeLancementSansReponse,
  MOT_GESTE_NON_PARTI,
  MOT_GESTE_NOMME_NON_PARTI,
  messageAlerte,
  motDAttenteLongue,
  mentionDeLancement,
  EtapeDeLancement,
  alerteServeurInjoignable,
  attenteAvantAvis,
  retenirDansLePerimetre,
  etatDuCanal,
  messageDuCanal,
  CLE_MESSAGE_DU_CANAL,
  pileAvecMessage,
  pileAvecMessagePersistant,
  type EtatDuCanal,
  choisirProjetAOuvrir,
  projetsADecharger,
  repartirLaFamille,
  curseurApres,
  CARTES_EN_ROUTE_PAR_PAQUET,
  type CurseurEnRoute,
  type OngletEnRoute,
  DELAI_CONVERSATION_MS,
  suiteDuChargementRate,
  PROTOCOL_VERSION,
  doitRechargerPourLeProtocole,
  carteMarketingCachee,
  estEtapeDeSuite,
  poserLesMoteursAjoutes,
  type FicheMoteur,
  separerLesSuivis,
  fusionnerLesReglages,
  CLE_DU_DERNIER_ETAT,
  POIDS_MAX_DU_DERNIER_ETAT,
  composerLeDernierEtat,
  lireLeDernierEtat,
  CLE_DU_DEMARRAGE_EN_COURS,
  DELAI_DE_DEMARRAGE_STABLE_MS,
  demarrageApresCoupure,
  messageAvecContexteRepris,
  canalAAbandonner,
  DELAI_PING_SANS_REPONSE,
  DELAI_OUVERTURE_DU_CANAL,
  DELAI_SONDE_DE_RESEAU,
  delaiRestantAvantAbandonDeLOuverture,
  sondeAuRetourNecessaire,
  reglagesSansRecul,
  numerosApresReprise,
  bilanDeLot,
  definirIdentiteDInstallation,
  droitsLus,
  type DroitsDAcces,
  rapportDuGesteNonParti,
} from '@beluga/shared';
import {
  clesADemander,
  envoiConfirme,
  noterAEnvoyer,
  oublierLaDemande,
  redemanderLesVues,
  retenirLesVues,
  tranchesAEnvoyer,
} from '@/lib/captures-vues';
import { installationEnDirect } from '@/lib/travail-installation';
import { t } from '@/lib/langue';
import { rechargerUneFois } from '@/lib/rechargement';
import { signalerErreur } from '@/lib/erreurs';
import { estEnVeille, pageCachee, surLaVeille, surLaVisibilite } from '@/lib/veille';

/**
 * DEUX PILES SONT-ELLES LA MÊME ? Le message persistant est recalculé toutes
 * les deux secondes ; sans cette comparaison, chaque passage poserait une
 * nouvelle liste et ferait redessiner la pile pour rien.
 */
function memePile(avant: readonly Toast[], apres: readonly Toast[]): boolean {
  if (avant.length !== apres.length) return false;
  return avant.every((entree, rang) => {
    const autre = apres[rang];
    return (
      entree.id === autre.id &&
      entree.text === autre.text &&
      entree.level === autre.level &&
      entree.depuis === autre.depuis
    );
  });
}

export interface Toast {
  id: string;
  level: 'info' | 'success' | 'warning' | 'error';
  text: string;
  cardId?: string;
  at: number;
  /**
   * LA CLÉ D'UN MESSAGE PERSISTANT — un ÉTAT qui dure, pas une nouvelle. Il
   * reste affiché tant que sa cause dure, ne se ferme pas tout seul, ne se
   * ferme pas à la main (il reviendrait à la seconde suivante) et ne compte
   * pas dans le plafond des messages passagers.
   */
  cle?: string;
  /** Depuis quand l'état dure : le message affiche le temps écoulé. */
  depuis?: number;
}

/** Ce que la page « En route » a reçu, et ce qui reste à demander. */
export interface EtatEnRoute {
  cartes: Record<string, Card>;
  /**
   * LE DÉBUT DE LA DEMANDE de chaque carte reçue (`debutsDesDemandes`), par
   * identifiant. À part des cartes : un événement `card.*` REMPLACE la carte
   * et ne porte pas ce texte — rangé ici, il survit à chaque mise à jour.
   */
  demandes: Record<string, string>;
  /** Combien de cartes en route restent SOUS le dernier paquet reçu. */
  restant: number;
  /** Le premier paquet est arrivé : la page cesse de montrer sa silhouette. */
  charge: boolean;
  /** La demande a échoué : dit tel quel, au lieu d'une liste qu'on croirait vide. */
  erreur?: string;
}

/** La réserve de chaque colonne de la page « En route » dans l'état de l'application. */
export const CLE_ETAT_EN_ROUTE = {
  actif: 'enRoute',
  terminer: 'enRouteTerminer',
  archive: 'enRouteArchive',
} as const satisfies Record<OngletEnRoute, string>;

export interface AppState {
  connected: boolean;
  connecting: boolean;
  /**
   * L'ÉTAT DU CANAL, CALCULÉ UNE FOIS ET LU PARTOUT (`etatDuCanal`, `shared`).
   * Personne ne redéduit « suis-je en ligne ? » de son côté : le bandeau, le
   * champ d'écriture, la création de carte et la rangée de gestes du parcours
   * lisent tous CE champ. Il est recalculé par un minuteur, car « le canal est
   * muet » dépend du temps qui passe, pas d'un événement reçu.
   */
  canal: EtatDuCanal;
  /** Depuis quand le canal est coupé — sert au bandeau et à sa durée affichée. */
  canalCoupeDepuis?: number;
  /**
   * Le premier état complet du serveur (`ready`) est-il arrivé ? Tant qu'il
   * manque, la liste des projets est vide SANS qu'aucun projet ne manque : on
   * montre des SILHOUETTES de contenu, jamais « Aucun projet inscrit ».
   */
  pret: boolean;
  /**
   * LE STUDIO EST-IL OUVERT À CE COMPTE ? Dit par le démon dans `ready`
   * (`shared/src/studio-reserve.ts`) : seul le super administrateur le voit.
   * Faux tant que rien n'est arrivé, et sur toute autre installation.
   */
  studioOuvert: boolean;
  /** Machine sur l’offre hébergée : l’étape « Votre propre Beluga » n’existe pas. */
  offreHebergee: boolean;
  /** Le niveau du compte connecté : l'écran retire ce qui lui est fermé (le serveur le refuse de toute façon). */
  monRole: 'admin' | 'membre' | 'lecteur';
  /** LA GRILLE d'un accès tiers (`droits-d-acces.ts`) : ce que son écran peut montrer. Absente pour l'administrateur. */
  mesDroits?: DroitsDAcces;
  /**
   * L'écran est dessiné d'après la COPIE du dernier état vu (`dernier-etat-local.ts`),
   * pas d'après le serveur : on regarde, on n'agit pas — les gestes restent gelés
   * jusqu'au vrai premier état.
   */
  copieLocale: boolean;
  /**
   * Les projets dont les cartes sont réellement arrivées (`project.etat`).
   * Un tableau qui n'est pas encore dans cette liste attend ses cartes : il
   * affiche des silhouettes, pas des colonnes vides. Un projet déchargé après
   * quinze minutes en sort, et redevient donc « en chargement » à sa
   * réouverture.
   */
  cartesChargees: Record<string, boolean>;
  /**
   * LE TOTAL RÉEL DE CHAQUE COLONNE, PAR PROJET (`shared/src/tranches-de-cartes.ts`).
   * L'instantané d'un projet ne descend qu'un paquet de cartes par colonne :
   * c'est ce compte que lit la tête de colonne, et lui qui dit s'il reste des
   * cartes à demander au démon. Entre deux instantanés, il suit les cartes
   * qui bougent (`totauxApresChangement`).
   */
  cartesTotaux: Record<string, TotauxParColonne>;
  /**
   * LA PAGE « EN ROUTE » (`shared/src/en-route.ts`), TOUS PROJETS CONFONDUS.
   * Une réserve À PART, et non `cards` : le tableau d'un projet remplace ses
   * cartes à chaque instantané et le déchargement des quinze minutes les
   * oublie — la page, elle, garde ce qu'elle a reçu, tenu à jour par les mêmes
   * événements `card.*`. `null` tant que la page n'a jamais été ouverte : rien
   * n'est demandé au démon pour un écran que personne ne regarde.
   */
  enRoute: EtatEnRoute | null;
  /**
   * LES DEUX AUTRES COLONNES DE LA MÊME PAGE, chacune sa réserve, ses paquets
   * et son curseur, tenues à jour par les mêmes événements : « Terminer » (À
   * déployer, `estATerminer`) et « Archiver » (tout Archivé, `estArchivee`).
   * `null` tant que la page n'a jamais été ouverte. `enRoute` est « Actifs ».
   */
  enRouteTerminer: EtatEnRoute | null;
  enRouteArchive: EtatEnRoute | null;
  version: string;
  settings: Settings | null;
  prefs: Record<string, unknown>;
  projects: Project[];
  groups: ProjectGroup[];
  /** Projets qui attendent une réponse : nombre de questions en attente. */
  attention: Record<string, number>;
  /**
   * Le DÉTAIL de ces attentes : où chaque décision se prend. C'est ce qui
   * permet de poser le même triangle sur la carte et sur la conversation
   * concernées, au lieu d'un chiffre introuvable sur la ligne du projet.
   */
  decisions: DecisionAttendue[];
  /**
   * LE MESSAGE VISÉ PAR UN CLIC SUR UNE ALERTE. Ouvrir la carte ou la
   * conversation ne suffit pas : dans un fil de cent bulles, la question reste
   * introuvable. Le fil affiché défile jusqu'à ce message et le met en
   * évidence. Le `nonce` fait qu'un second clic sur la MÊME alerte y ramène
   * encore — sans lui, l'état ne changerait pas et rien ne bougerait.
   */
  messageVise: { id: string; nonce: number } | null;
  /**
   * LE VOLET DE MISE EN PRODUCTION DEMANDÉ depuis ailleurs (menu Agents, alerte
   * d'une publication). Gardé dans l'état et non passé en événement : le
   * tableau du projet visé n'est souvent pas encore monté au moment du clic, et
   * le bandeau lit la demande à son arrivée. `agentId` empile en plus le fil de
   * cet agent, quand une décision l'y attend. Le bandeau l'efface une fois lue.
   */
  /** Le tiroir de mise en production demandé d'ailleurs : sur un onglet, avec ou sans fil empilé. */
  /* `surPlace` : la demande vise le tiroir du tableau DÉJÀ affiché (celui d'un
     groupe, pour l'un de ses projets) — l'application ne change pas de projet. */
  productionDemandee: { projectId: string; agentId?: string; surPlace?: boolean; nonce: number } | null;
  /**
   * LE VOLET DU DÉPLOIEMENT demandé d'ailleurs (vignette « Dépannage », menu
   * Agents, cloche) — le pendant de `productionDemandee`. Le bloc « À
   * déployer » du tableau l'ouvre à son arrivée ; `agentId` y empile le fil de
   * l'agent (dépanneur, ou conducteur du déploiement). Effacé une fois lu.
   * `selection` : le bouton « Déployer » du pied d'une carte — le bloc ouvre
   * alors directement la FENÊTRE DE SÉLECTION du lot, comme son propre bouton,
   * et l'écran referme le tiroir de la carte pour la laisser voir.
   */
  deploiementDemande: { projectId: string; agentId?: string; selection?: boolean; nonce: number } | null;
  /**
   * LE TABLEAU D'UN PROJET demandé d'ailleurs : l'icône du projet devant le
   * titre d'une carte. L'écran referme la carte, ouvre le projet et montre son
   * tableau (onglet « Tableau » sur téléphone). Effacé une fois lu.
   */
  tableauDemande: { projectId: string; nonce: number } | null;
  /**
   * UNE CARTE À MONTRER DANS LE TABLEAU : le tableau défile jusqu'à sa rangée
   * (sa colonne, sur un large écran). Posée par le badge bleu d'un projet.
   */
  carteMontree: { cardId: string; nonce: number } | null;
  /** Projets dont un agent a rendu son travail sans qu'on l'ait encore lu. */
  rendus: Record<string, number>;
  engines: EngineInfo[];
  /**
   * LES MOTEURS AJOUTÉS depuis les réglages, fiches entières. Posés aussi dans
   * le registre partagé (`poserLesMoteursAjoutes`) : c'est lui que lisent les
   * menus, les comptes et les icônes.
   */
  moteursAjoutes: FicheMoteur[];
  quotas: AccountQuota[];
  /**
   * LES LIGNES DE SUIVI SEULEMENT (Google Gemini) : un état à regarder dans le
   * volet des quotas, jamais un compte. Séparées de `quotas`, que lisent les
   * réglages et tous les choix de compte.
   */
  quotasSuivi: AccountQuota[];
  /**
   * LE RELEVÉ DES COMPTES A-T-IL ÉTÉ REÇU AU MOINS UNE FOIS ?
   *
   * Une liste vide veut dire deux choses opposées : « aucun compte déclaré » ou
   * « pas encore lu ». Sans ce témoin, l'assistant de démarrage s'ouvrirait une
   * demi-seconde sur un serveur pourtant bien configuré, entre le premier envoi
   * et l'arrivée des quotas.
   */
  quotasRecus: boolean;
  /**
   * LES SITES SURVEILLÉS et leur état actuel. Ils arrivent au premier envoi puis
   * à chaque tournée : c'est ce qui allume la pastille du menu « Surveillance »
   * sans qu'on ouvre sa fenêtre.
   */
  surveillance: SiteSurveille[];
  /**
   * LA LISTE EST-ELLE ARRIVÉE ? Une liste vide veut dire deux choses opposées —
   * « aucune adresse surveillée » ou « rien n'est encore arrivé » —, et l'écran
   * annonçait le premier avant d'avoir reçu quoi que ce soit. Ce drapeau les
   * sépare : tant qu'il est faux, l'écran montre sa silhouette.
   */
  surveillanceRecue: boolean;
  /**
   * L'ATELIER MARKETING : un compteur par projet, avancé à chaque événement
   * `marketing`. L'écran ouvert sur ce projet se relit quand il bouge ; le
   * détail, lui, ne voyage jamais sans avoir été demandé.
   */
  marketingVersions: Record<string, number>;
  /**
   * LE STUDIO : un compteur par création (et « * » pour la liste) qui monte à
   * chaque événement `studio` — l'écran ouvert se relit ; et la progression
   * des exports en cours, qui voyage sans relecture.
   */
  studioVersions: Record<string, number>;
  studioProgression: Record<string, { valeur: number; etape: string }>;
  /**
   * LES DEUX COMPTEURS DE LA MESSAGERIE : le non-lu des clients (demandes jamais
   * ouvertes, commentaires, messages) et les demandes à traiter. Poussés à la
   * connexion puis après chaque geste qui les change.
   */
  compteursMessagerie: { nonLu: number; aTraiter: number };
  /** Les connexions de comptes en cours ou tout juste finies. */
  connexions: ConnexionCompte[];
  capacity: CapacityEtat | null;
  processes: SystemProcess[];
  /** L'état du démon : sert au bouton de redémarrage, en bas de la colonne. */
  demon: {
    demarreA: number;
    construitA?: number;
    agentsEnCours?: number;
    agentsDetail?: string[];
    publications?: string[];
    redemarrageEnAttente?: boolean;
    redemarrageNecessaire: boolean;
  } | null;
  agents: Record<string, Agent>;
  cards: Record<string, Card>;
  /**
   * LES LANCEMENTS EN PRÉPARATION, par carte : l'étape en cours et depuis
   * quand (`card.lancement`). C'est ce qui remplit la barre « Préparation en
   * cours » d'une carte cliquée dont la copie de travail s'ouvre encore.
   * Jamais enregistré nulle part : une préparation ne survit à rien.
   */
  lancements: Record<string, { etape?: EtapeDeLancement; depuis: number }>;
  messages: Record<string, Message[]>;
  /** Toute la conversation d'une carte, tous ses agents confondus. */
  cardMessages: Record<string, { messages: Message[]; activeAgentId?: string }>;
  /**
   * LES CONVERSATIONS DE CARTE RESTÉES SANS RÉPONSE après tous leurs essais
   * (`shared/src/chargement-conversation.ts`). Leur fil montre alors un message
   * et un bouton « Réessayer » au lieu d'une silhouette sans fin ; la réponse,
   * même tardive, efface la marque.
   */
  conversationsEnEchec: Record<string, true>;
  /**
   * LE JOURNAL DU CYCLE COMPLET D'UNE CARTE, par carte
   * (`shared/src/journal-carte.ts`). Rempli à l'ouverture de l'onglet
   * « Parcours » (commande `card.journal`), puis allongé en direct par
   * l'événement `journal.entree` : la ligne de temps grandit sans que l'écran
   * redemande le document entier à chaque appel d'outil. Une carte jamais
   * ouverte n'a pas de clé ici — rien n'est chargé d'avance.
   */
  journaux: Record<string, EntreeJournal[]>;
  /**
   * LE CARNET DE MÉMOIRE DE CHAQUE CARTE (`shared/src/carnet-memoire.ts`) :
   * ce qui lui a été servi, et à quelle étape. Chargé avec le journal, puis
   * allongé par l'événement `carnet.lignes` — le point du flux qui a consommé
   * la mémoire se met à jour à l'instant où elle est servie.
   */
  carnets: Record<string, LigneDuCarnet[]>;
  queues: Record<string, QueuedPrompt[]>;
  /** Échanges mis de côté par un « repartir de zéro », par agent. */
  precedents: Record<string, number>;
  attachments: Record<string, Attachment[]>;
  /** Les médias en fabrication, tous projets : les blocs d'attente du fil (`shared/src/media-en-fabrication.ts`). */
  mediasEnFabrication: MediaEnFabrication[];
  /** L'heure du dernier changement de chaque production du studio créatif, par carte : le volet de suivi relit dessus. */
  productionsMaj: Record<string, number>;
  /** Les veilles qui courent, et l'heure du dernier changement (`veilles.compte`) : la page « Tâches récurrentes » relit sur ce signal. */
  veilles: { actives: number; a: number };
  files: Record<string, FileNode[]>;
  memory: Record<string, string>;
  /**
   * LES COMMANDES « / » RELEVÉES SUR LE DISQUE, par projet puis par moteur.
   * Demandées à l'ouverture du menu de la barre d'écriture, jamais poussées
   * d'office : tant que personne ne tape « / », rien ne voyage.
   */
  slash: Record<string, Record<string, CommandeSlash[]>>;
  deploys: Record<string, DeployRun>;
  /**
   * LES MISES EN PRODUCTION QUI ONT LEUR CARTE VIOLETTE, par projet : celle qui
   * tourne, ou la dernière terminée que personne n'a lue
   * (`shared/src/cartes-systeme.ts`). `deploys` ne suffit pas : il ne garde que
   * la DERNIÈRE publication, toutes étapes confondues, et seulement pour un
   * projet déjà ouvert. Reçue entière à la connexion, tenue à jour ensuite.
   */
  productions: Record<string, DeployRun>;
  /**
   * Les dialogues de PROCÉDURE en cours, par `projet:cible`. Ils viennent du
   * serveur, qui les diffuse à chaque changement : le tiroir n'attend donc plus
   * la réponse d'une requête retenue pendant tout le tour — il suit, et il se
   * rattrape après une coupure.
   */
  procedures: Record<string, EtatProcedure>;
  activeProjectId: string | null;
  toasts: Toast[];
  /**
   * Les ANNONCES du guichet de notifications déjà reçues — celles-là mêmes que
   * le téléphone reçoit poussées. Gardées ici pour que la cloche du bandeau les
   * relise APRÈS coup : un message passager s'efface, une tâche terminée
   * pendant qu'on regardait ailleurs ne doit pas se perdre avec lui. Rangées
   * dans le navigateur (`CLE_ANNONCES`) : elles survivent à un rechargement,
   * et ne sont vraies que pour cet appareil.
   */
  annonces: AnnonceRecue[];
}

/** Le relevé, rangé en comptes et en lignes de suivi (`separerLesSuivis`). */
function quotasSepares(releves: AccountQuota[]): { quotas: AccountQuota[]; quotasSuivi: AccountQuota[] } {
  const { comptes, suivis } = separerLesSuivis(releves);
  return { quotas: comptes, quotasSuivi: suivis };
}

const initialState: AppState = {
  connected: false,
  connecting: true,
  canal: 'reconnexion',
  pret: false,
  studioOuvert: false,
  offreHebergee: false,
  monRole: 'admin',
  copieLocale: false,
  cartesChargees: {},
  cartesTotaux: {},
  enRoute: null,
  enRouteTerminer: null,
  enRouteArchive: null,
  version: '',
  settings: null,
  prefs: {},
  projects: [],
  groups: [],
  attention: {},
  decisions: [],
  messageVise: null,
  productionDemandee: null,
  deploiementDemande: null,
  tableauDemande: null,
  carteMontree: null,
  rendus: {},
  engines: [],
  moteursAjoutes: [],
  quotas: [],
  quotasSuivi: [],
  quotasRecus: false,
  surveillance: [],
  surveillanceRecue: false,
  marketingVersions: {},
  studioVersions: {},
  studioProgression: {},
  compteursMessagerie: { nonLu: 0, aTraiter: 0 },
  connexions: [],
  capacity: null,
  processes: [],
  demon: null,
  agents: {},
  cards: {},
  lancements: {},
  messages: {},
  cardMessages: {},
  conversationsEnEchec: {},
  journaux: {},
  carnets: {},
  queues: {},
  precedents: {},
  attachments: {},
  mediasEnFabrication: [],
  productionsMaj: {},
  veilles: { actives: 0, a: 0 },
  files: {},
  memory: {},
  slash: {},
  deploys: {},
  productions: {},
  procedures: {},
  activeProjectId: null,
  toasts: [],
  annonces: [],
};

/**
 * Où les annonces reçues sont rangées dans le navigateur. Elles ne valent que
 * pour CET appareil : ce qui a été lu sur le téléphone reste à lire sur
 * l'ordinateur, comme n'importe quelle notification poussée.
 */
const CLE_ANNONCES = 'beluga.notifications';
/** Le plafond d'une demande `cards.enRoute` côté démon (`shared/src/protocol.ts`). */
const LIMITE_EN_ROUTE_PAR_DEMANDE = 200;

/** Relit les annonces rangées au démarrage. Un contenu abîmé est ignoré, jamais fatal. */
function relireAnnoncesRangees(): AnnonceRecue[] {
  try {
    const brut = localStorage.getItem(CLE_ANNONCES);
    if (!brut) return [];
    const lu = JSON.parse(brut);
    if (!Array.isArray(lu)) return [];
    return lu
      .filter((a) => a && typeof a.id === 'string' && typeof a.titre === 'string' && typeof a.a === 'number')
      .slice(0, PLAFOND_ANNONCES);
  } catch {
    return [];
  }
}

type Listener = () => void;

/** Le participe passé que la règle pure `bilanDeLot` accorde (« 3 cartes archivées ») : un mot de la règle, pas un texte d'écran. */
const CLE_PARTICIPE_ARCHIVAGE = 'archivée';
const CLE_PARTICIPE_RESSORTIE = 'ressortie';

/**
 * LA COLONNE OÙ LE TABLEAU COMPTE CETTE CARTE — aucune pour une carte de
 * l'atelier Marketing rangée (`carteMarketingCachee`) : le démon ne la compte
 * pas, l'écran non plus.
 */
function colonneComptee(carte: Card | undefined): Card['column'] | undefined {
  /* Une ÉTAPE DE SUITE se compte dans sa carte globale, jamais dans sa colonne (`estEtapeDeSuite`). */
  return carte && !carteMarketingCachee(carte) && !estEtapeDeSuite(carte) ? carte.column : undefined;
}

class Client {
  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private retry = 0;
  private reconnectTimer: number | null = null;
  private notifyHandlers = new Set<(event: Extract<ServerEvent, { type: 'notify' }>) => void>();
  /** Les images du navigateur des sources : remises au seul volet ouvert, jamais rangées dans l'état général. */
  /*
   * L'état du LIEN avec le serveur, tel que la règle `alerteServeurInjoignable`
   * le demande : depuis quand le canal est coupé, et combien de requêtes
   * d'affilée sont restées sans réponse. Deux compteurs, pas un état affiché :
   * ils ne servent qu'à décider si l'alerte rouge a le droit de paraître.
   */
  private coupeDepuis: number | null = null;
  private echecsReseau = 0;
  /**
   * QUAND UN GESTE A ÉTÉ REFUSÉ FAUTE DE LIEN. Il fait tomber le silence de
   * 1,5 s du message de canal (`messageDuCanal`) : une coupure trop brève pour
   * mériter un message reste trop longue pour avaler un clic sans rien dire.
   * Remis à zéro dès que le canal est de nouveau en ligne.
   */
  private gesteRefuseA: number | null = null;
  /**
   * CE QUE L'ÉTAT DU CANAL LIT. `dernierEvenementA` est posé à CHAQUE message
   * reçu, quel qu'il soit : c'est la seule preuve que le serveur parle encore.
   * `resynchronise` retombe à faux dès que le canal bouge et ne se relève que
   * sur `ready`, l'état complet renvoyé par le serveur à chaque connexion.
   */
  private dernierEvenementA: number | null = null;
  /*
   * DE QUOI DIRE, APRÈS COUP, POURQUOI LE LIEN ÉTAIT COUPÉ : la dernière
   * fermeture (code du navigateur, ou motif quand c'est nous qui avons
   * refermé) et la dernière commande partie. Lues seulement par la trace d'un
   * geste non parti (`rapportDuGesteNonParti`), jamais affichées.
   */
  private derniereFermeture: { motif: string; code?: number; raison?: string; a: number } | null = null;
  private derniereCommande: { type: string; a: number } | null = null;
  private resynchronise = false;
  /** Un premier état complet est déjà arrivé : le prochain `ready` est une RECONNEXION. */
  private dejaSynchronise = false;
  /** Le chargement de la page : le message de coupure ne paraît pas pendant la toute première connexion. */
  private demarreA = Date.now();
  private copieLocaleLue = false;
  private demarrageMarque = false;
  private minuterieDeLaCopie: number | null = null;
  /** Le minuteur qui relit l'état du canal : « muet » dépend du temps qui passe. */
  private veilleDuCanal: number | null = null;
  /**
   * UN CANAL ZOMBIE NE FERME JAMAIS TOUT SEUL. Le navigateur peut garder une
   * connexion WebSocket « ouverte » (veille, changement de réseau, bascule
   * Wi-Fi/4G) sans jamais déclencher `onclose` — le signal de fin de tour
   * (`agent.upsert` qui éteint `tourVivantDepuis`) part bien du serveur mais
   * n'arrive plus jamais : le témoin « Réflexion en cours » reste bloqué à
   * l'écran, même une fois le tour réellement refermé. Un ping réclamé au
   * serveur toutes les BATTEMENT_MS force la preuve que le canal répond
   * encore ; sans réponse sous BATTEMENT_TIMEOUT_MS, on referme nous-mêmes le
   * socket pour déclencher la reconnexion déjà prévue par `onclose`.
   */
  private battement: number | null = null;
  private openCardHandlers = new Set<(cardId: string) => void>();
  private openConversationHandlers = new Set<(lieu: { projectId: string; agentId: string }) => void>();
  /**
   * LA CONVERSATION SOUS LES YEUX, POUR LA REDEMANDER APRÈS UNE RECONNEXION.
   * `agent.etat` et `card.conversation` REMPLACENT tout le fil affiché —
   * ils ne sont redemandés qu'à l'ouverture (effet de `chat.tsx`, qui ne
   * dépend que de l'identifiant de l'agent ou de la carte, jamais du lien).
   * Un message envoyé pendant une coupure (veille, changement de réseau,
   * canal zombie fermé par le battement) part bien au serveur — il est
   * enregistré, l'agent se met au travail — mais son `message.upsert` est
   * diffusé sur un socket déjà mort : silencieusement perdu, sans jamais être
   * redemandé. La conversation reste alors affichée SANS ce message, même une
   * fois le lien revenu. On retient donc ici la DERNIÈRE conversation ouverte
   * et on la redemande à chaque `ready` : le premier, sans effet (rien
   * n'était encore ouvert), tous les suivants — donc chaque reconnexion.
   */
  private dernierAgentOuvert: { id: string; tout: boolean } | null = null;
  private derniereCarteOuverte: string | null = null;

  state: AppState = { ...initialState, annonces: relireAnnoncesRangees() };

  /**
   * POSE LE JOURNAL D'UNE CARTE dans le magasin, tel que le démon vient de le
   * rendre. Les entrées arrivées entre-temps par `journal.entree` sont
   * conservées : elles portent un rang plus haut, et rejeter le document
   * initial ferait clignoter la ligne de temps.
   */
  poserLeJournal = (cardId: string, entrees: EntreeJournal[], carnet?: LigneDuCarnet[]): void => {
    this.set((state) => {
      const connues = state.journaux[cardId] ?? [];
      const parId = new Map(entrees.map((e) => [e.id, e] as const));
      for (const entree of connues) if (!parId.has(entree.id)) parId.set(entree.id, entree);
      const lignes = new Map((carnet ?? state.carnets[cardId] ?? []).map((l) => [l.id, l] as const));
      for (const ligne of state.carnets[cardId] ?? []) if (!lignes.has(ligne.id)) lignes.set(ligne.id, ligne);
      return {
        journaux: {
          ...state.journaux,
          [cardId]: [...parId.values()].sort((a, b) => a.rang - b.rang),
        },
        carnets: { ...state.carnets, [cardId]: [...lignes.values()].sort((a, b) => a.at - b.at) },
      };
    });
  };

  /*
   * LES DONNÉES DÉTAILLÉES D'UNE CARTE OUVERTE — SON FIL ET SON JOURNAL.
   *
   * Elles étaient demandées par la CONVERSATION (`chat.tsx`), c'est-à-dire par
   * un composant qui ne s'affiche qu'une fois le tiroir dessiné. Or le tiroir
   * doit maintenant se taire tant qu'il n'a rien reçu : s'il attend, la
   * conversation n'est pas montée, et personne ne demande plus rien. La
   * demande vit donc ici, chez le client, et le tiroir l'appelle à l'ouverture.
   *
   * Le journal n'est réclamé qu'une fois par carte (`journauxEnVol`), et une
   * demande qui tombe pose un journal VIDE : une carte n'attend jamais sans fin
   * une réponse qui n'arrivera pas.
   */
  private journauxEnVol = new Set<string>();

  ouvrirLesDonneesDeCarte(cardId: string): void {
    this.reessayerLaConversation(cardId);
    this.rechargerLeJournal(cardId);
  }

  /*
   * LE FIL D'UNE CARTE, DEMANDÉ JUSQU'À CE QU'IL ARRIVE.
   *
   * `card.conversation` part sans accusé : sa réponse est un événement. Une
   * demande envoyée juste avant une coupure du canal était donc perdue sans
   * bruit, et la conversation restait sur sa silhouette pour toujours — le
   * tiroir, lui, levait la sienne au bout de douze secondes, d'où un bouton
   * « Valider le plan » posé au-dessus d'un fil qui ne venait jamais. Chaque
   * demande garde ici son minuteur : sans réponse, elle est rejouée, puis
   * déclarée en échec (`suiteDuChargementRate`, `shared`). Une reconnexion
   * rejoue aussi toutes celles qui attendent encore (`ready`).
   */
  private conversationsEnVol = new Map<string, { essais: number; minuteur: number }>();

  /** Repart de zéro : l'échec affiché s'efface, la silhouette revient le temps des essais. */
  reessayerLaConversation(cardId: string): void {
    if (this.state.conversationsEnEchec[cardId]) {
      this.set((state) => {
        const conversationsEnEchec = { ...state.conversationsEnEchec };
        delete conversationsEnEchec[cardId];
        return { conversationsEnEchec };
      });
    }
    this.demanderLaConversation(cardId, 1);
  }

  private demanderLaConversation(cardId: string, essai: number, lire = true): void {
    const enVol = this.conversationsEnVol.get(cardId);
    if (enVol) window.clearTimeout(enVol.minuteur);
    this.send(lire ? { type: 'card.conversation', cardId } : { type: 'card.conversation', cardId, lire: false });
    const minuteur = window.setTimeout(() => {
      if (this.conversationsEnVol.get(cardId)?.minuteur !== minuteur) return;
      if (suiteDuChargementRate(essai) === 'rejouer') {
        this.demanderLaConversation(cardId, essai + 1, lire);
        return;
      }
      this.conversationsEnVol.delete(cardId);
      this.set((state) => ({ conversationsEnEchec: { ...state.conversationsEnEchec, [cardId]: true } }));
    }, DELAI_CONVERSATION_MS);
    this.conversationsEnVol.set(cardId, { essais: essai, minuteur });
  }

  /** La réponse est là : plus rien à attendre, et plus d'échec à afficher. */
  private conversationRecue(cardId: string): void {
    const enVol = this.conversationsEnVol.get(cardId);
    if (enVol) window.clearTimeout(enVol.minuteur);
    this.conversationsEnVol.delete(cardId);
  }

  /*
   * LE JOURNAL ENTIER, REDEMANDÉ. À l'ouverture d'une carte, mais aussi quand
   * l'écran sait avoir raté des lignes : une reconnexion (les entrées diffusées
   * sur le canal mort sont perdues pour lui) ou un rang qui saute
   * (`journalATrou`). `poserLeJournal` fusionne par identifiant : ni doublon,
   * ni clignotement.
   */
  /*
   * « GÉNÉRER LE PLAN » SE VOIT DÈS LE CLIC. Le démon écrit `planDemandeA` sur
   * la carte à réception ; entre le clic et son écho, l'ancien plan restait le
   * dernier cadre lisible. La marque est posée ici tout de suite, et la carte
   * que renvoie le démon la remplace. Rend de quoi la retirer sur un refus —
   * seulement si c'est encore NOTRE marque.
   */
  annoncerPlanDemande(cardId: string): () => void {
    const carte = this.state.cards[cardId];
    if (!carte || carte.parcours?.planDemandeA) return () => undefined;
    const marque = Date.now();
    const poser = (planDemandeA: number | undefined) =>
      this.set((state) => {
        const courante = state.cards[cardId];
        if (!courante) return {};
        if (planDemandeA === undefined && courante.parcours?.planDemandeA !== marque) return {};
        const parcours = { ...(courante.parcours ?? { plans: [] }), planDemandeA };
        return { cards: { ...state.cards, [cardId]: { ...courante, parcours } } };
      });
    poser(marque);
    return () => poser(undefined);
  }

  rechargerLeJournal(cardId: string): void {
    if (this.journauxEnVol.has(cardId)) return;
    this.journauxEnVol.add(cardId);
    this.call<{ journal: { entrees: EntreeJournal[] }; carnet?: LigneDuCarnet[] }>({
      type: 'card.journal',
      cardId,
    })
      .then((res) => this.poserLeJournal(cardId, res?.journal?.entrees ?? [], res?.carnet ?? []))
      .catch(() => this.poserLeJournal(cardId, [], []))
      .finally(() => this.journauxEnVol.delete(cardId));
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  lireEtat = (): AppState => this.state;

  onNotify(handler: (event: Extract<ServerEvent, { type: 'notify' }>) => void): () => void {
    this.notifyHandlers.add(handler);
    return () => this.notifyHandlers.delete(handler);
  }



  /** Ouvrir une carte depuis n'importe où (une carte affichée dans le chat, par exemple). */
  onOpenCard(handler: (cardId: string) => void): () => void {
    this.openCardHandlers.add(handler);
    return () => this.openCardHandlers.delete(handler);
  }

  openCard(cardId: string): void {
    for (const handler of this.openCardHandlers) handler(cardId);
  }

  /**
   * Ouvrir la CONVERSATION où une décision se prend — quand elle ne tient à
   * aucune carte (une carte proposée, une question d'un agent).
   */
  onOpenConversation(handler: (lieu: { projectId: string; agentId: string }) => void): () => void {
    this.openConversationHandlers.add(handler);
    return () => this.openConversationHandlers.delete(handler);
  }

  openConversation(lieu: { projectId: string; agentId: string }): void {
    for (const handler of this.openConversationHandlers) handler(lieu);
  }

  /**
   * Le geste UNIQUE « emmène-moi où cette décision se prend » : projet, puis
   * carte si elle en a une, sinon la conversation de l'agent. Partagé par la
   * cloche des questions en attente, la notification affichée dans l'onglet
   * ouvert et le clic sur une notification poussée (téléphone, application
   * fermée) — trois entrées, UNE seule règle de routage.
   */
  /**
   * VISER UN MESSAGE PRÉCIS DANS LE FIL QUI VA S'OUVRIR. Le fil s'en saisit
   * pour y défiler et l'entourer un instant ; il efface la visée dès qu'il l'a
   * honorée, pour qu'un défilement à la main ne soit pas ramené en arrière.
   */
  viserMessage(messageId: string | null): void {
    if (!messageId) {
      if (this.state.messageVise) this.set({ messageVise: null });
      return;
    }
    this.set((state) => ({
      messageVise: { id: messageId, nonce: (state.messageVise?.nonce ?? 0) + 1 },
    }));
  }

  demanderProduction(lieu: { projectId: string; agentId?: string; surPlace?: boolean } | null): void {
    if (!lieu) {
      if (this.state.productionDemandee) this.set({ productionDemandee: null });
      return;
    }
    this.set((state) => ({
      productionDemandee: { ...lieu, nonce: (state.productionDemandee?.nonce ?? 0) + 1 },
    }));
  }

  /**
   * LE SUIVI D'UNE MISE EN PRODUCTION, DEPUIS N'IMPORTE OÙ : le tableau du
   * projet, puis le tiroir de son bandeau du bas. C'est le clic de sa carte
   * violette (« Tableaux de bord », chiffre bleu du projet).
   */
  ouvrirMiseEnProduction(projectId: string): void {
    this.demanderProduction({ projectId });
  }

  demanderTableau(projectId: string | null): void {
    if (!projectId) {
      if (this.state.tableauDemande) this.set({ tableauDemande: null });
      return;
    }
    this.set((state) => ({
      tableauDemande: { projectId, nonce: (state.tableauDemande?.nonce ?? 0) + 1 },
    }));
  }

  /**
   * LE BADGE BLEU D'UN PROJET MÈNE À SA CARTE NON LUE. Le projet s'ouvre tout
   * de suite ; la carte — la plus récemment rendue — est demandée à la base,
   * car celles d'un projet qu'on ne consultait plus ont pu quitter la mémoire
   * de l'écran. Le tiroir la réclame lui-même au besoin (`chargerCarte`), et
   * le tableau défile jusqu'à elle. Rend l'identifiant ouvert, ou `null`.
   */
  async ouvrirCarteNonLue(projectId: string, membres: string[] = []): Promise<string | null> {
    this.setActiveProject(projectId);
    let cardId: string | null = null;
    try {
      const reponse = await this.call<{ cardId?: string | null }>(
        { type: 'project.unreadCard', projectId, membres },
        15000,
      );
      cardId = reponse?.cardId ?? null;
    } catch {
      return null;
    }
    if (!cardId || this.state.activeProjectId !== projectId) return null;
    this.montrerCarte(cardId);
    this.openCard(cardId);
    return cardId;
  }

  montrerCarte(cardId: string | null): void {
    if (!cardId) {
      if (this.state.carteMontree) this.set({ carteMontree: null });
      return;
    }
    this.set((state) => ({ carteMontree: { cardId, nonce: (state.carteMontree?.nonce ?? 0) + 1 } }));
  }

  demanderDeploiement(lieu: { projectId: string; agentId?: string; selection?: boolean } | null): void {
    if (!lieu) {
      if (this.state.deploiementDemande) this.set({ deploiementDemande: null });
      return;
    }
    this.set((state) => ({
      deploiementDemande: { ...lieu, nonce: (state.deploiementDemande?.nonce ?? 0) + 1 },
    }));
  }

  allerVersDecision(lieu: {
    projectId?: string;
    cardId?: string;
    agentId?: string;
    messageId?: string;
    url?: string;
  }): void {
    /* UNE ADRESSE DE L'APPLICATION (« #studio/verification:<source> ») : l'alerte mène droit au geste, sans carte. */
    if (lieu.url?.startsWith('#')) {
      window.history.pushState(null, '', lieu.url);
      window.dispatchEvent(new PopStateEvent('popstate'));
      return;
    }
    /*
     * LE PROJET SE RETROUVE, IL NE SE RÉCLAME PAS. Une annonce née hors carte
     * — la question d'un assistant, une carte proposée dans une conversation —
     * ne porte souvent qu'un agent : sans ce rattrapage, le clic ne faisait
     * rien du tout, et l'alerte restait à l'écran sans moyen d'y répondre. La
     * carte et l'agent connus disent tous deux à quel projet ils appartiennent.
     */
    const projectId =
      lieu.projectId ||
      (lieu.cardId ? this.state.cards[lieu.cardId]?.projectId : undefined) ||
      (lieu.agentId ? this.state.agents[lieu.agentId]?.projectId : undefined);

    // La visée est posée AVANT l'ouverture : le fil la lit dès qu'il s'affiche.
    this.viserMessage(lieu.messageId ?? null);

    if (projectId) this.setActiveProject(projectId);
    if (lieu.cardId) {
      this.openCard(lieu.cardId);
      return;
    }
    if (!lieu.agentId) return;

    /*
     * UNE CONVERSATION QU'ON N'A PAS CHARGÉE S'OUVRE QUAND MÊME.
     *
     * C'était le trou : le clic n'ouvrait le fil que si l'agent se trouvait
     * déjà dans l'écran. Or les conversations envoyées au navigateur sont
     * celles qui travaillent, celles qui viennent de finir et celles des cartes
     * affichées — la publication tombée il y a trois jours n'en fait pas
     * partie. La ligne s'affichait, le clic ne faisait RIEN, et l'alerte
     * restait à vie faute de pouvoir atteindre ses trois issues.
     *
     * On réclame donc la conversation au serveur par son seul identifiant,
     * exactement comme une carte ouverte par lien direct (`chargerCarte`), puis
     * on l'ouvre. Le projet, quand il manquait, se déduit de la réponse.
     */
    const agentId = lieu.agentId;
    void this.chargerAgent(agentId).then((agent) => {
      const cible = projectId ?? agent?.projectId;
      if (!cible) return;
      if (!projectId) this.setActiveProject(cible);
      this.openConversation({ projectId: cible, agentId });
    });
  }

  /**
   * UNE CONVERSATION RÉCLAMÉE AU SERVEUR, par son seul identifiant. Rend celle
   * qu'on connaît déjà sans rien demander ; sinon `agent.open` la rend ET
   * pousse ses messages, donc le fil est complet à l'ouverture.
   */
  async chargerAgent(agentId: string): Promise<Agent | null> {
    const deja = this.state.agents[agentId];
    if (deja) {
      // Le fil peut n'avoir jamais été demandé : on le réclame quand même, sans
      // attendre — sans quoi le tiroir s'ouvrirait sur une conversation vide.
      if (!this.state.messages[agentId]) this.send({ type: 'agent.open', id: agentId });
      // Fil déjà chargé : on redit seulement au serveur qu'on le regarde.
      else this.suivre({ agents: [agentId] });
      return deja;
    }
    try {
      const reponse = await this.call<{ agent?: Agent }>({ type: 'agent.open', id: agentId }, 15000);
      const agent = reponse?.agent;
      if (!agent) return null;
      this.set((state) => ({ agents: { ...state.agents, [agent.id]: agent } }));
      return agent;
    } catch {
      return null;
    }
  }

  /*
   * LES REDESSINS EN RAFALE SE REGROUPENT (`attenteAvantAvis`, `shared`).
   *
   * L'état est posé TOUT DE SUITE, toujours : qui lit `this.state` ou
   * `lireEtat()` lit le dernier état. Seul l'AVIS aux composants est regroupé,
   * et seulement pour ce qui vient du CANAL (`enRafale`) : un agent qui écrit
   * sa réponse envoyait des dizaines d'événements par seconde, et chacun
   * faisait redessiner tous les composants abonnés. Un changement né d'un
   * geste de l'utilisateur prévient sans délai — et emporte avec lui ce qui
   * attendait.
   */
  private enRafale = false;
  private avisPrevu: number | null = null;
  private dernierAvisA: number | null = null;

  private prevenir(): void {
    if (this.avisPrevu != null) window.clearTimeout(this.avisPrevu);
    this.avisPrevu = null;
    this.dernierAvisA = Date.now();
    for (const listener of this.listeners) listener();
  }

  /*
   * CE QUE CET ÉCRAN REGARDE (`shared/src/perimetre-ecran.ts`). Le serveur
   * n'envoie le DÉTAIL d'un agent (son fil qui s'écrit, sa file, le journal de
   * sa carte) qu'à l'écran qui affiche son projet ou qui l'a demandé. Il le
   * déduit de nos demandes — mais il oublie tout à chaque reconnexion : on
   * garde donc ici la même liste bornée, et `ready` la lui redit.
   */
  private agentsSuivis = new Set<string>();
  private cartesSuivies = new Set<string>();

  private noterLePerimetre(cmd: ClientCommand): void {
    if (cmd.type === 'agent.open') retenirDansLePerimetre(this.agentsSuivis, cmd.id);
    else if (cmd.type === 'card.conversation' || cmd.type === 'card.journal')
      retenirDansLePerimetre(this.cartesSuivies, cmd.cardId);
  }

  /** Dire au serveur qu'on regarde ces conversations ou ces cartes, sans rien redemander. */
  suivre(lieux: { agents?: string[]; cartes?: string[] }): void {
    const agents = (lieux.agents ?? []).filter((id) => !this.agentsSuivis.has(id));
    const cartes = (lieux.cartes ?? []).filter((id) => !this.cartesSuivies.has(id));
    for (const id of lieux.agents ?? []) retenirDansLePerimetre(this.agentsSuivis, id);
    for (const id of lieux.cartes ?? []) retenirDansLePerimetre(this.cartesSuivies, id);
    if (agents.length || cartes.length) this.send({ type: 'ecran.perimetre', agents, cartes });
  }

  private set(patch: Partial<AppState> | ((current: AppState) => Partial<AppState>)): void {
    const next = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = { ...this.state, ...next };
    if (!this.enRafale) {
      this.prevenir();
      return;
    }
    if (this.avisPrevu != null) return;
    const attente = attenteAvantAvis(this.dernierAvisA, Date.now());
    this.avisPrevu = window.setTimeout(() => this.prevenir(), attente);
  }

  /*
   * LA VEILLE (`lib/veille.ts`, `shared/src/veille-ecran.ts`). Page cachée
   * depuis quelques secondes, sans voix ni micro en cours : le canal est fermé
   * PAR NOUS, et rien ne le rouvre avant le retour à l'écran. Ce n'est PAS une
   * coupure — aucune heure de coupure n'est posée, aucun message de lien
   * n'est affiché, aucun échec n'est compté : l'alerte « le serveur ne répond
   * pas » reste réservée à une indisponibilité réelle et durable.
   *
   * Le réveil emprunte le chemin de toute reconnexion : `ready` rend l'état
   * complet, la conversation et la carte sous les yeux sont redemandées. Le
   * décompte de la coupure part du RÉVEIL, jamais de l'endormissement.
   */
  private veilleBranchee = false;

  private brancherLaVeille(): void {
    if (this.veilleBranchee) return;
    this.veilleBranchee = true;
    surLaVeille((enVeille) => (enVeille ? this.entrerEnVeille() : this.sortirDeVeille()));
  }

  private entrerEnVeille(): void {
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.arreterLeBattement();
    if (this.veilleDuCanal != null) window.clearInterval(this.veilleDuCanal);
    this.veilleDuCanal = null;
    if (this.veilleDechargement) window.clearInterval(this.veilleDechargement);
    this.veilleDechargement = 0;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      this.derniereFermeture = { motif: 'mise en veille', a: Date.now() };
      // Détaché AVANT d'être fermé : cette fermeture n'est pas une coupure, et
      // ne doit lancer ni reconnexion ni message.
      socket.onopen = null;
      socket.onclose = null;
      socket.onmessage = null;
      socket.onerror = null;
      try {
        socket.close(1000);
      } catch {
        /* déjà fermé */
      }
    }
    // Plus aucun accusé n'arrivera par ce canal : le serveur reprend la main.
    this.reglagesEnVol.clear();
  }

  private sortirDeVeille(): void {
    // Les projets quittés avant la veille ont pu dépasser leur quart d'heure.
    this.dechargerLesProjetsOublies();
    this.retry = 0;
    this.echecsReseau = 0;
    // La coupure se compte à partir d'ICI : si le serveur ne répond vraiment
    // pas au réveil, le message paraît après son délai ordinaire.
    this.coupeDepuis = Date.now();
    this.resynchronise = false;
    this.set({ connected: false, connecting: true });
    this.rafraichirLeCanal();
    this.connect();
  }

  /**
   * REDESSINE L'ÉCRAN D'APRÈS LE DERNIER ÉTAT VU, une seule fois, avant la
   * toute première connexion (`shared/src/dernier-etat-local.ts`). Rien n'est
   * posé qui rendrait un geste possible : le lien est dit en reconnexion
   * (`connected` faux), donc tous les gestes restent gelés jusqu'au vrai `ready`.
   */
  private appliquerLaCopieLocale(): void {
    if (this.copieLocaleLue) return;
    this.copieLocaleLue = true;
    if (this.state.pret) return;
    let brut: string | null = null;
    try {
      /* UN DÉMARRAGE COUPÉ SE VOIT AU SUIVANT (`shared/src/demarrage-allege.ts`) :
         la page précédente est morte en route, on repart sans la copie, jetée. */
      const coupe = demarrageApresCoupure(localStorage.getItem(CLE_DU_DEMARRAGE_EN_COURS), Date.now());
      localStorage.setItem(CLE_DU_DEMARRAGE_EN_COURS, String(Date.now()));
      if (coupe) localStorage.removeItem(CLE_DU_DERNIER_ETAT);
      else brut = localStorage.getItem(CLE_DU_DERNIER_ETAT);
    } catch {
      /* stockage refusé : pas de copie, l'attente habituelle */
    }
    const copie = lireLeDernierEtat(brut, PROTOCOL_VERSION, Date.now());
    if (!copie) return;
    const projet = copie.activeProjectId;
    const cartes = copie.cards as Card[];
    this.set({
      projects: copie.projects as Project[],
      groups: copie.groups as ProjectGroup[],
      activeProjectId: projet,
      cards: Object.fromEntries(cartes.map((carte) => [carte.id, carte])),
      cartesTotaux: projet ? { [projet]: copie.totaux as TotauxParColonne } : {},
      cartesChargees: projet ? { [projet]: true } : {},
      copieLocale: true,
    });
  }

  /**
   * LE DÉMARRAGE A TENU : le premier état est là et la page vit encore
   * `DELAI_DE_DEMARRAGE_STABLE_MS` plus tard — le marqueur posé par
   * `appliquerLaCopieLocale` s'efface. Une page tuée avant ne l'efface pas.
   */
  private marquerLeDemarrageReussi(): void {
    if (this.demarrageMarque) return;
    this.demarrageMarque = true;
    window.setTimeout(() => {
      try {
        localStorage.removeItem(CLE_DU_DEMARRAGE_EN_COURS);
      } catch {
        /* stockage refusé : aucun marqueur n'a pu être posé */
      }
    }, DELAI_DE_DEMARRAGE_STABLE_MS);
  }

  /**
   * GARDE LA COPIE À JOUR, sans jamais gêner : une seule écriture par rafale
   * (1,5 s après le dernier état reçu), jamais avant que le vrai premier état
   * soit là, jamais au-delà du poids permis.
   */
  private programmerLaCopieLocale(): void {
    if (this.minuterieDeLaCopie != null) window.clearTimeout(this.minuterieDeLaCopie);
    this.minuterieDeLaCopie = window.setTimeout(() => {
      this.minuterieDeLaCopie = null;
      const etat = this.state;
      if (!etat.pret) return;
      const copie = composerLeDernierEtat({
        protocole: PROTOCOL_VERSION,
        maintenant: Date.now(),
        projects: etat.projects,
        groups: etat.groups,
        activeProjectId: etat.activeProjectId,
        cards: etat.cards,
        totaux: etat.cartesTotaux as Record<string, Record<string, number>>,
      });
      if (!copie) return;
      try {
        const texte = JSON.stringify(copie);
        if (texte.length > POIDS_MAX_DU_DERNIER_ETAT) {
          localStorage.removeItem(CLE_DU_DERNIER_ETAT);
          return;
        }
        localStorage.setItem(CLE_DU_DERNIER_ETAT, texte);
      } catch {
        /* stockage plein ou refusé : la copie est un confort, jamais une obligation */
      }
    }, 1500);
  }

  connect(): void {
    this.appliquerLaCopieLocale();
    this.brancherLaVeille();
    this.brancherLeReseau();
    // En veille, rien ne rouvre le canal : c'est le retour à l'écran qui le fait.
    if (estEnVeille()) return;
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.lancerLaVeilleDeDechargement();
    this.lancerLaVeilleDuCanal();
    this.set({ connecting: true });
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${location.host}/ws`);
    this.socket = socket;
    /*
     * UNE OUVERTURE A UN PLAFOND (demande du 12/10/2026 : « la synchronisation
     * se fait extrêmement difficilement sur mobile »). Sans lui, un réseau qui
     * laisse partir la demande mais ne rend rien laissait le socket « en
     * ouverture » tant que le navigateur n'avait pas renoncé — plus d'une
     * minute sur un téléphone qui change de réseau — et `connect()` ne
     * rouvrait rien entre-temps. Passé `DELAI_OUVERTURE_DU_CANAL`, on
     * l'abandonne : le repli ordinaire refait une tentative neuve.
     */
    const ouvertDepuis = Date.now();
    const surveillerLOuverture = (attente: number) =>
      window.setTimeout(() => {
        if (this.socket !== socket || socket.readyState !== WebSocket.CONNECTING) return;
        const reste = delaiRestantAvantAbandonDeLOuverture(ouvertDepuis, Date.now());
        if (reste > 0) surveillerLOuverture(reste);
        else this.abandonnerLeCanal(socket, 'ouverture trop longue');
      }, attente);
    surveillerLOuverture(DELAI_OUVERTURE_DU_CANAL);

    socket.onopen = () => {
      this.retry = 0;
      this.coupeDepuis = null;
      this.echecsReseau = 0;
      /*
       * LE CANAL EST OUVERT, MAIS L'ÉTAT EST ENCORE CELUI D'AVANT LA COUPURE.
       * Tant que `ready` n'est pas revenu, on ne sait plus ce qui tourne côté
       * démon : on reste en « resynchronisation », donc gestes gelés. C'est
       * exactement ce qui manquait quand un bouton « Générer le plan »
       * s'allumait sur un `busy` vieux de plusieurs heures.
       */
      this.resynchronise = false;
      this.set({ connected: true, connecting: false });
      this.rafraichirLeCanal();
      this.send({ type: 'hello', protocol: 1 });
      this.lancerLeBattement(socket);
      this.reclamerLesReponsesPerdues();
    };

    socket.onclose = (evenement) => {
      this.derniereFermeture = {
        motif: 'fermé par le navigateur ou le serveur',
        code: evenement.code,
        raison: evenement.reason || undefined,
        a: Date.now(),
      };
      this.apresFermetureDuCanal();
    };

    socket.onerror = () => socket.close();

    socket.onmessage = (event) => {
      let parsed: ServerEvent;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      this.dernierEvenementA = Date.now();
      // Ce qui vient du canal se regroupe ; la réponse à une requête, elle,
      // suit un geste : son effet s'affiche sans délai.
      this.enRafale = parsed.type !== 'ack';
      try {
        this.handle(parsed);
        this.rafraichirLeCanal();
      } finally {
        this.enRafale = false;
      }
    };
  }

  /*
   * UN CANAL QU'ON REFERME SOI-MÊME N'ATTEND PAS SON `onclose`.
   *
   * `socket.close()` sur un canal muet ouvre la poignée de main de fermeture :
   * le socket passe en CLOSING, et `onclose` n'arrive qu'une fois l'autre bout
   * d'accord — ou quand le navigateur renonce, ce qui peut être très long sur
   * un réseau parti. Pendant ce temps, rien ne se reconnectait, le battement se
   * taisait (il ne bat que sur un canal OPEN), et toute demande partait dans le
   * vide. On détache donc le vieux socket et on enchaîne tout de suite sur la
   * reconnexion, exactement comme si `onclose` était arrivé.
   */
  private abandonnerLeCanal(socket: WebSocket, motif: string): void {
    // Déjà fermé : son `onclose` est passé, la reconnexion est déjà prévue.
    const dejaFerme = socket.readyState === WebSocket.CLOSED;
    if (!dejaFerme) this.derniereFermeture = { motif: `abandonné : ${motif}`, a: Date.now() };
    socket.onclose = null;
    socket.onmessage = null;
    socket.onerror = null;
    try {
      socket.close();
    } catch {
      /* déjà fermé : rien à faire */
    }
    if (!dejaFerme && this.socket === socket) this.apresFermetureDuCanal();
  }

  /**
   * LES RÉPONSES ATTENDUES PENDANT LA COUPURE SONT REDEMANDÉES. Une commande
   * longue (créer un projet) peut finir pendant que le canal se renouvelle :
   * sa réponse partait sur l'ancien canal et se perdait, et le bouton tournait
   * dans le vide. Le serveur la garde désormais (`acks.reclamer`,
   * `shared/src/accuses-orphelins.ts`) : on la réclame dès le canal rouvert,
   * et elle se rend comme si elle venait d'arriver.
   */
  private reclamerLesReponsesPerdues(): void {
    const ids = [...this.pending.keys()].slice(-200);
    if (!ids.length) return;
    this.call<{ accuses?: ServerEvent[] }>({ type: 'acks.reclamer', ids }, 15000)
      .then((reponse) => {
        for (const accuse of reponse?.accuses ?? []) this.handle(accuse);
      })
      .catch(() => {
        /* le canal est retombé : la prochaine ouverture redemandera */
      });
  }

  private apresFermetureDuCanal(): void {
    noterUneCoupure();
    this.arreterLeBattement();
    // L'HEURE de la coupure, posée une seule fois : c'est sa DURÉE qui
    // distingue une reconnexion ordinaire d'une vraie panne.
    if (this.coupeDepuis == null) this.coupeDepuis = Date.now();
    this.resynchronise = false;
    // Plus aucun accusé n'arrivera par ce canal : le serveur reprend la main.
    this.reglagesEnVol.clear();
    this.set({ connected: false, connecting: true });
    this.rafraichirLeCanal();
    // Reconnexion automatique : fermer l'onglet n'arrête aucun agent, et le
    // réseau qui tombe ne doit pas casser la session.
    this.retry = Math.min(this.retry + 1, 8);
    const delay = Math.min(500 * 2 ** this.retry, 12000);
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
  }

  /**
   * Rejoue un événement de serveur comme s'il venait d'arriver. Réservé au point
   * d'essai de développement (bas de ce fichier) : un script de vérification
   * peut ainsi provoquer une annonce sans faire tourner un vrai agent.
   */
  handleEssai(event: ServerEvent): void {
    this.handle(event);
  }

  /**
   * RELIT L'ÉTAT DU CANAL ET NE LE POSE QUE S'IL A CHANGÉ.
   *
   * Appelée à chaque événement reçu, à chaque bascule du socket, et par un
   * minuteur — car « le serveur ne dit plus rien depuis trente secondes » est
   * un fait qui naît du TEMPS, sans qu'aucun événement ne l'annonce.
   */
  private rafraichirLeCanal(): void {
    const etat = etatDuCanal(
      {
        connecte: this.state.connected,
        coupeDepuis: this.coupeDepuis ?? undefined,
        dernierEvenementA: this.dernierEvenementA ?? undefined,
        redemarrageEnCours: this.state.demon?.redemarrageEnAttente,
        resynchronise: this.resynchronise,
      },
      Date.now(),
    );
    const depuis = this.coupeDepuis ?? undefined;
    /* LE MESSAGE SE REVOIT À CHAQUE PASSAGE, MÊME QUAND L'ÉTAT N'A PAS BOUGÉ :
       il ne paraît qu'une fois la coupure installée (1,5 s), un seuil qui
       dépend du TEMPS et non de l'état. Le juger seulement sur changement
       d'état, c'est ne jamais l'afficher quand la coupure s'installe sans
       rien d'autre. */
    if (etat === 'en-ligne') this.gesteRefuseA = null;
    let dire = messageDuCanal(etat, depuis, Date.now(), this.gesteRefuseA != null);
    /* LA TOUTE PREMIÈRE CONNEXION D'UNE PAGE N'EST PAS UNE PANNE : l'écran déjà
       dessiné d'après la copie ne doit pas annoncer « le serveur ne répond pas »
       pendant les secondes que prend l'ouverture. Passé ce délai, il le dit. */
    if (dire && this.state.copieLocale && !this.dejaSynchronise && this.gesteRefuseA == null && Date.now() - this.demarreA < 5000) {
      dire = null;
    }
    this.posterLeMessagePersistant(
      CLE_MESSAGE_DU_CANAL,
      dire
        ? {
            level: dire.etat === 'redemarrage' || dire.etat === 'resynchronisation' ? 'info' : 'warning',
            text: t(dire.texte),
            depuis: dire.depuis,
          }
        : null,
    );
    if (etat === this.state.canal && depuis === this.state.canalCoupeDepuis) return;
    this.set({ canal: etat, canalCoupeDepuis: depuis });
  }

  /** Le minuteur qui fait vivre l'état du canal, lancé une fois pour toutes. */
  private lancerLaVeilleDuCanal(): void {
    if (this.veilleDuCanal != null) return;
    this.veilleDuCanal = window.setInterval(() => this.rafraichirLeCanal(), 2000);
  }

  /**
   * RECONNECTER TOUT DE SUITE, sans attendre le repli progressif. Le bandeau
   * de coupure en fait son bouton : une reconnexion différée de douze secondes
   * est insupportable quand on voit que le réseau est revenu.
   */
  reconnecterMaintenant(): void {
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.retry = 0;
    const socket = this.socket;
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      // Canal « ouvert » mais muet, ou ouverture qui traîne : le refermer
      // nous-mêmes est le seul moyen de repartir sur un socket vivant (§ le
      // canal zombie, plus haut). On rouvre tout de suite, sans attendre le
      // repli — c'est le geste de quelqu'un qui voit que le réseau est revenu.
      this.abandonnerLeCanal(socket, 'reconnexion demandée');
      if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connect();
  }

  /*
   * LE RÉSEAU DU TÉLÉPHONE CHANGE, L'ÉCRAN LE SAIT (demande du 12/10/2026).
   * « online » (le réseau revient) et le changement de connexion (Wi-Fi vers
   * 4G, quand le navigateur le dit) étaient ignorés : l'écran attendait son
   * propre battement, 40 à 80 secondes parfois. Un canal absent ou en
   * ouverture repart tout de suite ; un canal « ouvert » est mis à l'épreuve
   * (`sonderLeCanal`) — sa route a pu changer sous lui. En veille, rien ne se
   * rouvre : le retour à l'écran le fait.
   */
  private reseauBranche = false;

  private brancherLeReseau(): void {
    if (this.reseauBranche || typeof window === 'undefined') return;
    this.reseauBranche = true;
    let dernierSignalA = 0;
    const reseauChange = () => {
      if (estEnVeille()) return;
      /* Un réseau instable émet plusieurs signaux à la suite : un seul geste
         par seconde et demie, pour ne pas faire redemander l'état en rafale
         à un démon déjà à la peine. */
      const maintenant = Date.now();
      if (maintenant - dernierSignalA < 1_500) return;
      dernierSignalA = maintenant;
      const socket = this.socket;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        this.reconnecterMaintenant();
        return;
      }
      this.sonderLeCanal(socket);
    };
    window.addEventListener('online', reseauChange);
    (navigator as unknown as { connection?: EventTarget }).connection?.addEventListener?.('change', reseauChange);
    /* Retour à l'écran SANS être passé par la veille (page cachée moins de
       quelques secondes) : un canal resté muet est mis à l'épreuve. */
    surLaVisibilite(() => {
      if (pageCachee() || estEnVeille()) return;
      const socket = this.socket;
      if (socket && socket.readyState === WebSocket.OPEN && sondeAuRetourNecessaire(this.dernierEvenementA, Date.now())) {
        this.sonderLeCanal(socket);
      }
    });
  }

  /** Une seule épreuve à la fois : un ping court, et le canal est refait s'il ne répond pas. */
  private sondeEnCours = false;

  private sonderLeCanal(socket: WebSocket): void {
    if (this.sondeEnCours) return;
    this.sondeEnCours = true;
    const envoyeA = Date.now();
    this.call({ type: 'ping' }, DELAI_SONDE_DE_RESEAU).then(
      () => {
        this.sondeEnCours = false;
      },
      () => {
        this.sondeEnCours = false;
        if (this.socket !== socket) return;
        /* UNE TRAME REÇUE DEPUIS L'ÉPREUVE VAUT PREUVE DE VIE : le serveur est
           seulement lent, comme au battement. */
        if ((this.dernierEvenementA ?? 0) > envoyeA) return;
        this.reconnecterMaintenant();
      },
    );
  }

  private lancerLeBattement(socket: WebSocket): void {
    let manques = 0;
    this.battement = window.setInterval(() => {
      if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) return;
      const envoyeA = Date.now();
      this.call({ type: 'ping' }, DELAI_PING_SANS_REPONSE).then(
        () => {
          manques = 0;
        },
        () => {
          if (this.socket !== socket) return;
          /* UNE TRAME REÇUE DEPUIS LE BATTEMENT VAUT PREUVE DE VIE : le serveur
             est seulement lent (il se fige par moments), pas parti. */
          if ((this.dernierEvenementA ?? 0) > envoyeA) {
            manques = 0;
            return;
          }
          manques += 1;
          // Un canal vraiment zombie — ouvert en apparence, plus rien n'arrive —
          // se referme nous-mêmes : sans ce geste, plus aucun événement (dont la
          // fin d'un tour) n'atteindrait jamais ce client. Mais pas au premier
          // silence : se reconnecter redemande tout au serveur déjà à la peine.
          const silence = Date.now() - (this.dernierEvenementA ?? envoyeA);
          if (canalAAbandonner({ battementsManques: manques, silence }))
            this.abandonnerLeCanal(socket, `battement sans réponse (${manques} manqué(s), ${Math.round(silence / 1000)} s de silence)`);
        },
      );
    }, 20000);
  }

  private arreterLeBattement(): void {
    if (this.battement != null) window.clearInterval(this.battement);
    this.battement = null;
  }

  private handle(event: ServerEvent): void {
    switch (event.type) {
      case 'ready': {
        // Un démon publié sur un AUTRE protocole que cet écran : on recharge une
        // fois (`doitRechargerPourLeProtocole`), plutôt que d'afficher un état
        // dont les messages ne sont plus reconnus.
        const CLE_RECHARGE = 'beluga-protocole-recharge';
        let dejaRechargePour: string | null = null;
        try {
          dejaRechargePour = sessionStorage.getItem(CLE_RECHARGE);
        } catch {
          /* stockage indisponible : on recharge quand même une fois */
        }
        if (doitRechargerPourLeProtocole({ serveur: event.protocol, client: PROTOCOL_VERSION, dejaRechargePour })) {
          try {
            sessionStorage.setItem(CLE_RECHARGE, String(event.protocol));
          } catch {
            /* idem */
          }
          /*
           * LE MÊME COMPTEUR QUE LA MISE À JOUR DE VERSION (`lib/rechargement.ts`).
           * Une mise en ligne apporte presque toujours les deux à la fois : sans
           * ce verrou commun, la page se rechargeait une fois par mécanisme.
           * L'adresse décrivant l'écran exact, le rechargement ramène ici même.
           */
          if (rechargerUneFois('protocole', String(event.protocol))) return;
        }
        /*
         * L'ÉTAT COMPLET EST REVENU : c'est le seul moment où on a le droit de
         * rallumer les gestes. Avant lui, le canal est peut-être ouvert, mais
         * ce qu'on affiche date d'avant la coupure.
         */
        this.resynchronise = true;
        // Les images ouvertes ailleurs pendant la coupure : les bandes à l'écran
        // redemandent leur état, et ce qui n'avait pas pu partir repart.
        redemanderLesVues();
        this.envoyerLesVuesEnAttente();
        /*
         * UN RETOUR DE COUPURE OU DE VEILLE relit TOUTES les colonnes de « En
         * route » déjà lues (et celles restées sur un échec), puis les tableaux
         * des autres projets gardés en mémoire : les événements émis pendant la
         * coupure sont perdus pour cet écran. Le projet affiché, lui, arrive
         * avec `ready` (`project.etat`).
         */
        const reprise = this.dejaSynchronise;
        this.rechargerLesColonnesChargees(reprise);
        const prefs = event.prefs ?? {};
        // On rouvre sur le dernier projet consulté, retenu en base. S'il a été
        // archivé ou supprimé, on retombe sans bruit sur le premier de la liste.
        const choix = choisirProjetAOuvrir(event.projects, prefs[CLE_PROJET_ACTIF], this.state.activeProjectId);
        // Les moteurs ajoutés entrent au registre AVANT le premier affichage.
        poserLesMoteursAjoutes(event.moteursAjoutes ?? []);
        if (event.settings?.installation) definirIdentiteDInstallation(event.settings.installation);
        this.marquerLeDemarrageReussi();
        this.set({
          moteursAjoutes: event.moteursAjoutes ?? [],
          pret: true,
          studioOuvert: event.studioOuvert === true,
          offreHebergee: event.offreHebergee === true,
          monRole: event.role ?? 'admin',
          mesDroits: event.droits ? droitsLus(event.droits) : undefined,
          copieLocale: false,
          version: event.version,
          settings: event.settings,
          prefs,
          projects: event.projects,
          groups: event.groups ?? [],
          engines: event.engines,
          ...quotasSepares(event.quotas),
          // Le premier envoi peut partir AVANT la première lecture de quota :
          // il ne fait foi que s'il porte vraiment des comptes.
          quotasRecus: this.state.quotasRecus || event.quotas.length > 0,
          capacity: event.capacity,
          agents: Object.fromEntries(event.agents.map((agent) => [agent.id, agent])),
          productions: Object.fromEntries((event.productions ?? []).map((run) => [run.projectId, run])),
          activeProjectId: choix.id,
          /*
           * LE STUDIO ET LE MARKETING SE RELISENT APRÈS UNE COUPURE. Leurs écrans ne se rechargent que sur un
           * signal « ça a changé » (`studio`, `marketing`), et un signal émis pendant la coupure est perdu : un
           * agent qui finissait une vidéo laissait l'écran sur l'ancienne version (création cre3de7e25f64,
           * 08/10/2026). Chaque numéro avance donc d'un cran ; la création ouverte lit en plus `reprise`, car
           * elle n'a pas de numéro tant qu'aucun signal ne l'a nommée. Jamais à la toute première connexion.
           */
          ...(this.dejaSynchronise ? numerosApresReprise(this.state.studioVersions, this.state.marketingVersions, event.projects.map((p) => p.id)) : {}),
        });
        this.dejaSynchronise = true;
        if (reprise) this.relireLesProjetsChargesEnMemoire(choix.id);
        this.programmerLaCopieLocale();
        // Le projet retenu à l'ouverture doit CHARGER ses cartes tout de suite :
        // sans cette demande, le tableau reste vide tant qu'on n'a pas cliqué
        // dans la colonne de gauche — invisible sur téléphone, où elle est repliée.
        if (choix.id) {
          // Le serveur pousse déjà les cartes du projet qu'il a choisi, juste
          // derrière ce message : les redemander ferait payer un aller-retour
          // complet — et un second envoi du même tableau — avant le premier
          // affichage. On ne demande que si son choix diffère du nôtre.
          if (event.openedProjectId !== choix.id) this.send({ type: 'project.open', id: choix.id });
          this.send({ type: 'attachments.list', projectId: choix.id });
          if (choix.aCorriger) this.retenirProjetActif(choix.id);
        }
        /*
         * REDEMANDER LA CONVERSATION SOUS LES YEUX. `ready` arrive à CHAQUE
         * connexion, la toute première comme celle d'une reconnexion : sur la
         * première, rien n'est encore ouvert, ces deux envois ne font rien.
         * Sur une reconnexion, ils rattrapent un fil resté silencieusement en
         * retard (`dernierAgentOuvert` / `derniereCarteOuverte`, voir plus
         * haut) : un message envoyé pendant la coupure, correctement reçu et
         * traité par le serveur, dont l'écho avait été diffusé sur le socket
         * mort.
         */
        /*
         * LE PÉRIMÈTRE D'ABORD : le serveur vient d'ouvrir un canal neuf, il ne
         * sait plus ce que cet écran regardait. Les conversations secondaires
         * (assistant, agent de configuration, conducteur d'une publication)
         * les plus récentes sont redemandées aussi — depuis la veille, un
         * retour à l'écran est une reconnexion, et leur fil a pu avancer.
         */
        if (this.agentsSuivis.size || this.cartesSuivies.size) {
          this.send({ type: 'ecran.perimetre', agents: [...this.agentsSuivis], cartes: [...this.cartesSuivies] });
        }
        {
          const principal = this.dernierAgentOuvert;
          const secondaires = [...this.agentsSuivis].filter((id) => id !== principal?.id).slice(-3);
          for (const id of secondaires) {
            if (this.state.messages[id]) this.send({ type: 'agent.open', id });
          }
          // `send` retient la dernière conversation demandée : la principale passe en dernier.
          this.dernierAgentOuvert = principal;
        }
        if (this.dernierAgentOuvert) {
          this.send({ type: 'agent.open', id: this.dernierAgentOuvert.id, tout: this.dernierAgentOuvert.tout });
        }
        /*
         * …ET SON JOURNAL. Le fil était rattrapé, pas le journal : un plan rendu
         * pendant la veille du téléphone restait invisible jusqu'à ce qu'on
         * rouvre la carte (#88b9, 11.09.2026). Les AUTRES cartes déjà chargées
         * n'ont rien à redemander ici : leur journal repart en entier à leur
         * prochaine ouverture (`ouvrirLesDonneesDeCarte`).
         */
        if (this.derniereCarteOuverte) {
          if (this.state.journaux[this.derniereCarteOuverte]) this.rechargerLeJournal(this.derniereCarteOuverte);
        }
        /*
         * …ET TOUTES LES CONVERSATIONS QUI ATTENDENT ENCORE LEUR RÉPONSE. Leur
         * demande a pu partir sur le canal mort : on les rejoue au premier
         * essai, avec un minuteur neuf — la coupure n'est pas leur échec.
         */
        {
          const aRedemander = new Set(this.conversationsEnVol.keys());
          if (this.derniereCarteOuverte) aRedemander.add(this.derniereCarteOuverte);
          /* REDEMANDÉES, PAS LUES : `derniereCarteOuverte` survit à la
             fermeture du tiroir, et chaque réveil du téléphone marquait
             ainsi lue une carte que personne ne regardait. La vraie lecture
             vient de la conversation affichée et regardée (`chat.tsx`). */
          for (const cardId of aRedemander) this.demanderLaConversation(cardId, 1, false);
        }
        break;
      }

      case 'ack': {
        const entry = this.pending.get(event.id);
        if (entry) {
          this.pending.delete(event.id);
          // Le serveur a répondu : la série d'échecs repart de zéro, qu'il ait
          // dit oui ou non. Un refus MÉTIER n'est pas une panne de serveur.
          this.echecsReseau = 0;
          if (event.ok) entry.resolve(event.data);
          else entry.reject(new Error(event.error ?? t('commande refusée')));
        }
        break;
      }

      case 'groups':
        this.set({ groups: event.groups });
        break;

      case 'attention':
        // Le compte et ses endroits arrivent ensemble, et se posent ensemble :
        // le triangle du projet et ceux des cartes disent toujours la même chose.
        this.set({ attention: event.byProject, decisions: event.decisions ?? [] });
        break;

      case 'rendus':
        this.set({ rendus: event.byProject });
        break;

      case 'project.upsert':
        this.set((state) => ({
          // Le rang choisi à la main prime ; à rang égal seulement, par nom.
          projects: [...state.projects.filter((p) => p.id !== event.project.id), event.project].sort(
            (a, b) => (a.rank ?? 1000) - (b.rank ?? 1000) || a.name.localeCompare(b.name),
          ),
        }));
        // Mettre de côté le projet affiché revient à le quitter : on repart sur
        // le premier de la liste plutôt que de rester sur un tableau rangé.
        this.replierSiProjetIndisponible();
        break;

      case 'project.delete':
        this.set((state) => ({ projects: state.projects.filter((p) => p.id !== event.id) }));
        this.replierSiProjetIndisponible();
        break;

      case 'project.etat':
        this.appliquerLEtatDuProjet(event);
        break;

      case 'card.upsert':
        this.set((state) => ({
          cards: { ...state.cards, [event.card.id]: event.card },
          // Une carte de l'agent marketing rangée n'est pas comptée au tableau :
          // le démon l'écarte de ses totaux (`SANS_MARKETING`), l'écran aussi.
          // En travail, elle compte — et elle sort du compte en se rangeant.
          cartesTotaux: this.totauxApresCarte(
            state,
            event.card.projectId,
            colonneComptee(state.cards[event.card.id]),
            colonneComptee(event.card),
          ),
          ...this.pageApresCarte(state, event.card),
        }));
        break;

      /*
       * OÙ EN EST LA PRÉPARATION D'UN LANCEMENT. Sans étape, la préparation est
       * finie : on retire la ligne au lieu de garder une barre figée.
       */
      case 'card.lancement':
        this.set((state) => {
          const lancements = { ...state.lancements };
          if (event.etape) lancements[event.cardId] = { etape: event.etape, depuis: event.depuis };
          else delete lancements[event.cardId];
          return { lancements };
        });
        break;

      /*
       * UNE CARTE A CHANGÉ DE PROJET. Les deux compteurs se corrigent dans le
       * MÊME rendu — l'ancien projet perd la carte de sa colonne, le nouveau la
       * gagne — et la carte, elle, ne quitte jamais le magasin : un tiroir
       * ouvert dessus reste ouvert, il suit simplement son nouveau projet.
       */
      case 'card.deplacee':
        this.set((state) => {
          const avant = state.cards[event.card.id];
          const totauxSansElle = avant
            ? this.totauxApresCarte(state, event.depuisProjectId, avant.column, undefined)
            : state.cartesTotaux;
          return {
            cards: { ...state.cards, [event.card.id]: event.card },
            cartesTotaux: this.totauxApresCarte(
              { ...state, cartesTotaux: totauxSansElle },
              event.card.projectId,
              undefined,
              event.card.column,
            ),
            ...this.pageApresCarte(state, event.card),
          };
        });
        break;

      case 'card.delete':
        this.set((state) => {
          const cards = { ...state.cards };
          const disparue = cards[event.id];
          delete cards[event.id];
          return {
            cards,
            cartesTotaux: this.totauxApresCarte(state, event.projectId, colonneComptee(disparue), undefined),
            enRoute: this.enRouteSansCarte(state.enRoute, event.id),
            enRouteTerminer: this.enRouteSansCarte(state.enRouteTerminer, event.id),
            enRouteArchive: this.enRouteSansCarte(state.enRouteArchive, event.id),
          };
        });
        break;

      case 'agent.upsert':
        this.set((state) => ({ agents: { ...state.agents, [event.agent.id]: event.agent } }));
        break;

      case 'agent.delete':
        this.set((state) => {
          const agents = { ...state.agents };
          delete agents[event.id];
          return { agents };
        });
        break;

      case 'agent.etat':
        this.set((state) => ({
          messages: { ...state.messages, [event.agentId]: event.messages },
          queues: { ...state.queues, [event.agentId]: event.queue },
          precedents: { ...state.precedents, [event.agentId]: event.precedents ?? 0 },
        }));
        break;

      case 'card.conversation':
        this.conversationRecue(event.cardId);
        this.set((state) => ({
          cardMessages: {
            ...state.cardMessages,
            [event.cardId]: { messages: event.messages, activeAgentId: event.activeAgentId },
          },
          conversationsEnEchec: state.conversationsEnEchec[event.cardId]
            ? Object.fromEntries(Object.entries(state.conversationsEnEchec).filter(([id]) => id !== event.cardId))
            : state.conversationsEnEchec,
          // Les agents de la carte ouverte : le tableau n'a que ceux de ses cartes visibles.
          agents: event.agents?.length
            ? { ...state.agents, ...Object.fromEntries(event.agents.map((agent) => [agent.id, agent])) }
            : state.agents,
        }));
        break;

      /*
       * UNE LIGNE DE PLUS AU JOURNAL D'UNE CARTE. On n'ajoute QUE si la carte
       * est déjà chargée : sans cela, une carte jamais ouverte accumulerait en
       * mémoire un journal partiel, qui aurait l'air complet à l'écran alors
       * qu'il ne commencerait qu'au moment où l'onglet a été ouvert. Une ligne
       * déjà connue (reçue par le document initial, ou enrichie depuis) est
       * REMPLACÉE à son identifiant, jamais ajoutée deux fois.
       */
      /*
       * DES LIGNES DE PLUS AU CARNET D'UNE CARTE. Une liste VIDE efface le
       * carnet : c'est « repartir de zéro » qui l'a vidé. Comme le journal,
       * on n'ajoute que sur une carte déjà chargée.
       */
      case 'carnet.lignes':
        this.set((state) => {
          const liste = state.carnets[event.cardId];
          if (!event.lignes.length) return liste ? { carnets: { ...state.carnets, [event.cardId]: [] } } : {};
          if (!liste) return {};
          /* Une ligne déjà connue est REMPLACÉE à son identifiant : une unité
             rouverte après une session neuve garde sa ligne (`lecture:<agent>:<clé>`),
             avec sa nouvelle heure et son retour dans le contexte. */
          const lignes = new Map(liste.map((l) => [l.id, l] as const));
          for (const ligne of event.lignes) lignes.set(ligne.id, ligne);
          return { carnets: { ...state.carnets, [event.cardId]: [...lignes.values()].sort((a, b) => a.at - b.at) } };
        });
        break;

      case 'journal.entree': {
        /* UN RANG QUI SAUTE DIT DES LIGNES PERDUES : la ligne s'ajoute, et le
           journal entier est redemandé pour boucher le trou. */
        const connues = this.state.journaux[event.entree.cardId];
        if (connues && journalATrou(connues, event.entree)) this.rechargerLeJournal(event.entree.cardId);
        this.set((state) => {
          const liste = state.journaux[event.entree.cardId];
          if (!liste) return {};
          /* Une entrée déjà connue est REMPLACÉE, plus écartée comme doublon :
             une ligne enrichie en cours de tour doit arriver à l'écran. */
          return {
            journaux: {
              ...state.journaux,
              [event.entree.cardId]: fusionnerEntreeJournal(liste, event.entree),
            },
          };
        });
        break;
      }

      case 'message.upsert':
        this.set((state) => {
          const list = state.messages[event.message.agentId] ?? [];
          const index = list.findIndex((m) => m.id === event.message.id);
          /* Contexte envoyé dit INCHANGÉ par le serveur : on garde celui déjà connu. */
          const connu =
            index >= 0
              ? list[index]
              : Object.values(state.cardMessages).flatMap((entry) => entry.messages).find((m) => m.id === event.message.id);
          const message = messageAvecContexteRepris(event.message, connu, event.contexteInchange);
          const next = index >= 0 ? [...list] : [...list, message];
          if (index >= 0) next[index] = message;

          // Le message rejoint aussi la conversation de la carte concernée,
          // pour que rien ne disparaisse quand un nouvel agent prend le relais.
          const cardMessages = { ...state.cardMessages };
          // La carte de l'agent tranche : un agent d'analyse tout juste créé
          // n'est encore dans aucune liste, et son compte rendu doit pourtant
          // s'écrire sous les yeux, sans attendre une réouverture.
          const carteDeLAgent = state.agents[event.message.agentId]?.cardId;
          for (const [cardId, entry] of Object.entries(cardMessages)) {
            const dansLaCarte = entry.messages.some((m) => m.agentId === event.message.agentId);
            if (!dansLaCarte && entry.activeAgentId !== event.message.agentId && carteDeLAgent !== cardId) continue;
            const liste = [...entry.messages];
            const position = liste.findIndex((m) => m.id === event.message.id);
            if (position >= 0) liste[position] = messageAvecContexteRepris(event.message, liste[position], event.contexteInchange);
            else liste.push(message);
            cardMessages[cardId] = { ...entry, messages: liste };
          }

          return { messages: { ...state.messages, [event.message.agentId]: next }, cardMessages };
        });
        break;

      case 'queue.etat':
        this.set((state) => ({ queues: { ...state.queues, [event.agentId]: event.queue } }));
        break;

      case 'deploy.upsert':
        this.set((state) => ({
          deploys: { ...state.deploys, [event.run.projectId]: event.run },
          productions: productionsApres(state.productions, event.run, Date.now()),
        }));
        break;

      // Le dialogue d'une procédure a bougé : tour parti, question posée,
      // procédure écrite, tour tombé. Le tiroir n'a rien à demander pour le
      // savoir — et deux tiroirs ouverts voient exactement la même chose.
      case 'procedure':
        this.majProcedure(event.etat.projectId, event.etat.cible, event.etat);
        break;

      case 'quotas':
        this.set({ ...quotasSepares(event.quotas), quotasRecus: true });
        break;

      case 'surveillance':
        this.set({ surveillance: event.sites, surveillanceRecue: true });
        break;


      case 'marketing': {
        const versions = this.state.marketingVersions;
        this.set({ marketingVersions: { ...versions, [event.projectId]: (versions[event.projectId] ?? 0) + 1 } });
        break;
      }

      // Déjà trié à l'envoi sur ce compte : le chiffre est le sien.
      case 'espace.compteurs':
        this.set({ compteursMessagerie: { nonLu: event.nonLu, aTraiter: event.aTraiter } });
        break;

      // Après une connexion de compte réussie, la liste des modèles redevient
      // complète sans qu'on ait à recharger la page.
      case 'engines':
        this.set({ engines: event.engines });
        break;

      case 'moteurs.ajoutes':
        poserLesMoteursAjoutes(event.fiches);
        this.set({ moteursAjoutes: event.fiches });
        break;

      case 'connexion-compte':
        this.set((state) => ({
          connexions: [
            ...state.connexions.filter((c) => c.id !== event.connexion.id),
            event.connexion,
          ].sort((a, b) => a.commenceeA - b.commenceeA),
        }));
        break;

      case 'capacity':
        this.set({ capacity: event.capacity });
        break;

      case 'processes':
        this.set({ processes: event.processes });
        break;

      case 'demon':
        this.set({ demon: event.etat });
        break;

      case 'settings':
        // L'identité de l'installation se lit en mémoire dans les règles
        // partagées : un réglage enregistré vaut tout de suite à l'écran.
        if (event.settings?.installation) definirIdentiteDInstallation(event.settings.installation);
        this.set({ settings: event.settings });
        break;

      // Un travail d'installation lancé depuis l'écran, et les nouveautés du
      // dépôt public : rangés à part (`lib/travail-installation.ts`), pour que
      // la sortie d'un installateur ne réveille pas le tableau à chaque ligne.
      case 'installation.travail':
        installationEnDirect.recevoirLEtat(event.travail);
        break;

      case 'installation.sortie':
        installationEnDirect.recevoirLaSortie(event.genre, event.donnees);
        break;

      case 'installation.nouveautes':
        installationEnDirect.recevoirLesNouveautes(event.etat);
        break;

      // La connexion GitHub par code a abouti (ou non) : la page GitHub de
      // l'assistant et des réglages l'écoute, et relit l'état d'elle-même.
      case 'installation.github':
        window.dispatchEvent(new CustomEvent('beluga:connexion-github', { detail: event.connexion }));
        break;

      case 'prefs':
        // Un réglage envoyé d'ici et pas encore confirmé ne recule pas. Un événement
        // `partiel` ne porte que les clés qui changent : il se fusionne dans le bloc
        // connu (le bloc entier ne part qu'à la connexion).
        this.set((state) => ({
          prefs: reglagesSansRecul(
            event.partiel ? fusionnerLesReglages(state.prefs, event.prefs) : event.prefs,
            Array.from(this.reglagesEnVol, ([cle, enVol]) => [cle, enVol.valeur] as const),
          ),
        }));
        break;

      case 'attachments':
        this.set((state) => ({ attachments: { ...state.attachments, [event.projectId]: event.items } }));
        break;

      case 'medias.fabrication':
        this.set({ mediasEnFabrication: event.items });
        break;

      case 'production.maj':
        this.set((state) => ({ productionsMaj: { ...state.productionsMaj, [event.cardId]: event.at } }));
        break;

      case 'veilles.compte':
        this.set({ veilles: { actives: event.actives, a: event.a } });
        break;

      case 'captures.vues':
        // Un autre appareil de ce compte vient d'ouvrir ces images en grand.
        retenirLesVues(event.cles);
        break;

      case 'files':
        this.set((state) => ({ files: { ...state.files, [`${event.projectId}:${event.path}`]: event.nodes } }));
        break;

      case 'memory':
        if (event.content) {
          this.set((state) => ({ memory: { ...state.memory, [event.projectId]: event.content } }));
        }
        break;

      case 'slash':
        this.set((state) => ({
          slash: { ...state.slash, [event.projectId]: event.commandes as Record<string, CommandeSlash[]> },
        }));
        break;

      case 'toast':
        this.pushToast(event.level, event.text, event.cardId, event.motif);
        break;

      case 'notify':
        this.garderAnnonce(event);
        for (const handler of this.notifyHandlers) handler(event);
        break;


      default:
        break;
    }
  }

  /* ------------------------------------------------------------------ */
  /* LA LISTE DES NOTIFICATIONS                                          */
  /* ------------------------------------------------------------------ */

  /**
   * Toute annonce reçue du guichet est GARDÉE, en plus d'être affichée en
   * message passager : c'est ce qui permet à la cloche du bandeau de la relire
   * ensuite. Rangée dans le navigateur pour survivre à un rechargement — un
   * échec survenu pendant qu'on avait l'onglet fermé se retrouve donc au
   * retour, tant que le plafond ne l'a pas chassé.
   */
  private garderAnnonce(event: Extract<ServerEvent, { type: 'notify' }>): void {
    const annonce: AnnonceRecue = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      titre: event.title,
      corps: event.body,
      motif: event.motif,
      a: Date.now(),
      projectId: event.projectId,
      cardId: event.cardId,
      agentId: event.agentId,
      // Une adresse de l'application (« #studio/… ») : l'alerte mène au geste même sans carte (DEC-082).
      ...(event.url?.startsWith('#') ? { url: event.url } : {}),
    };
    this.set((state) => {
      const annonces = ajouterAnnonce(state.annonces, annonce);
      this.rangerAnnonces(annonces);
      return { annonces };
    });
  }

  /** Le tiroir ouvert : tout ce qui s'y lit est lu. Les demandes, elles, se règlent. */
  marquerAnnoncesLues(): void {
    this.set((state) => {
      if (state.annonces.every((annonce) => annonce.lue)) return {};
      const annonces = marquerLues(state.annonces);
      this.rangerAnnonces(annonces);
      return { annonces };
    });
  }

  /**
   * L'ANNONCE ORPHELINE S'EFFACE, LE JOUR OÙ ON DÉCOUVRE QU'ELLE NE MÈNE NULLE
   * PART. Les annonces reçues vivent dans le navigateur, bien après la carte
   * dont elles parlent : cliquer sur l'une d'elles ouvrait un tiroir disant
   * « Cette tâche n'existe plus », et la ligne revenait au clic suivant. Le
   * serveur, lui, ne compte plus ces décisions-là (`sansDecisionsOrphelines`) ;
   * ici, on retire de la liste locale ce que le serveur vient de déclarer
   * introuvable. Un seul appelant : le tiroir de carte, à l'instant où il
   * l'apprend.
   */
  oublierAnnoncesDeCarte(cardId: string): void {
    this.set((state) => {
      const annonces = state.annonces.filter((annonce) => annonce.cardId !== cardId);
      if (annonces.length === state.annonces.length) return {};
      this.rangerAnnonces(annonces);
      return { annonces };
    });
  }

  /** Vider la liste : un geste explicite, jamais automatique. */
  viderAnnonces(): void {
    this.rangerAnnonces([]);
    this.set({ annonces: [] });
  }

  private rangerAnnonces(annonces: AnnonceRecue[]): void {
    try {
      localStorage.setItem(CLE_ANNONCES, JSON.stringify(annonces.slice(0, PLAFOND_ANNONCES)));
    } catch {
      /* Navigateur sans stockage local : la liste vit alors le temps de l'onglet. */
    }
  }

  /** Applique un réglage tout de suite, avant même la confirmation du serveur. */
  setPrefLocally(key: string, value: unknown): void {
    this.set((state) => ({ prefs: { ...state.prefs, [key]: value } }));
  }

  /**
   * Le compte à rebours de fermeture de chaque message, géré ICI plutôt que
   * par un simple `setTimeout` fixé au moment de l'affichage : tant qu'un
   * doigt ou une souris reste posé sur la pile, `pauseToasts` doit pouvoir
   * geler TOUS les comptes à rebours en cours et `resumeToasts` les reprendre
   * là où ils en étaient — pas les redémarrer à zéro ni les ignorer.
   */
  private toastTimers = new Map<string, { handle: number; restant: number; depuis: number }>();
  private toastsEnPause = false;

  /**
   * LE SECOND CANAL PASSE PAR LE MÊME JUGE QUE LE TÉLÉPHONE
   * (`messageAlerte`, `shared/src/notification-tri.ts`) : trois motifs
   * s'affichent — une attente, une tâche finie, une erreur (un refus ou un
   * blocage compris) — et rien d'autre. Une étape franchie, un état qui change,
   * un geste qu'on vient soi-même de déclencher ne s'annoncent plus : le bouton
   * qui passe en attente puis en coche le dit déjà, et la trace reste là où on
   * la lit (le tableau, la cloche, le déroulé d'une colonne, la conversation).
   */
  pushToast(level: Toast['level'], text: string, cardId?: string, motif?: string): void {
    if (!messageAlerte(level, motif)) return;
    this.afficherMessage(level, text, cardId);
  }

  /**
   * L'AFFICHAGE seul, sans le juge : la pile de messages telle qu'elle est
   * dessinée. Le point d'essai s'en sert pour éprouver la pile pour de vrai
   * (compte à rebours, glissement, empilement) sans dépendre de ce qui mérite
   * aujourd'hui d'être dit.
   */
  afficherMessage(level: Toast['level'], text: string, cardId?: string): void {
    const toast: Toast = { id: Math.random().toString(36).slice(2), level, text, cardId, at: Date.now() };
    /* Le plafond ne mord que sur les PASSAGERS : un message persistant dit un
       état en cours, six erreurs d'affilée ne doivent pas l'effacer. */
    this.set((state) => ({ toasts: pileAvecMessage(state.toasts, toast) }));
    this.armerToast(toast.id, DUREE_MESSAGE_MS);
  }

  /**
   * LE MESSAGE PERSISTANT D'UNE CLÉ : posé, mis à jour ou retiré, sans jamais
   * de minuteur. C'est le magasin qui décide de sa présence à chaque
   * rafraîchissement — l'écran ne fait que dessiner ce qu'il trouve.
   */
  private posterLeMessagePersistant(cle: string, message: Omit<Toast, 'id' | 'at' | 'cle'> | null): void {
    const suite = pileAvecMessagePersistant(
      this.state.toasts,
      cle,
      message ? { ...message, id: `persistant-${cle}`, at: Date.now(), cle } : null,
    );
    /* Rien n'a bougé : on ne touche pas au magasin. Sans ce garde-fou, chaque
       passage de deux secondes réveillerait tous les écrans abonnés. */
    if (memePile(this.state.toasts, suite)) return;
    this.set({ toasts: suite });
  }

  private armerToast(id: string, restant: number): void {
    if (this.toastsEnPause) {
      this.toastTimers.set(id, { handle: 0, restant, depuis: Date.now() });
      return;
    }
    const handle = window.setTimeout(() => this.dismissToast(id), restant);
    this.toastTimers.set(id, { handle, restant, depuis: Date.now() });
  }

  /** Gèle le compte à rebours de tous les messages encore affichés, au survol ou au toucher de la pile. */
  pauseToasts(): void {
    if (this.toastsEnPause) return;
    this.toastsEnPause = true;
    for (const [id, timer] of this.toastTimers) {
      window.clearTimeout(timer.handle);
      const restant = Math.max(0, timer.restant - (Date.now() - timer.depuis));
      this.toastTimers.set(id, { handle: 0, restant, depuis: Date.now() });
    }
  }

  /** Reprend le compte à rebours là où il en était, une fois la pile quittée. */
  resumeToasts(): void {
    if (!this.toastsEnPause) return;
    this.toastsEnPause = false;
    for (const [id, timer] of this.toastTimers) {
      this.armerToast(id, timer.restant);
    }
  }

  dismissToast(id: string): void {
    const timer = this.toastTimers.get(id);
    if (timer) {
      window.clearTimeout(timer.handle);
      this.toastTimers.delete(id);
    }
    this.set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    if (this.state.toasts.length === 0 && this.toastsEnPause) {
      /*
       * La pile disparaît du DOM dès qu'elle est vide (`Toasts` rend `null`),
       * donc plus aucun `mouseleave` ne peut jamais parvenir au conteneur
       * retiré : si le dernier message s'en va pendant un survol (croix,
       * glissement), la pause restait bloquée à vrai pour toujours — tout
       * message poussé ensuite s'armait déjà en pause et ne disparaissait
       * plus jamais tout seul. Rien à protéger sur une pile vide : on relâche.
       */
      this.toastsEnPause = false;
      for (const [, reste] of this.toastTimers) window.clearTimeout(reste.handle);
      this.toastTimers.clear();
    }
  }

  /** Les connexions de comptes que le serveur suit déjà, à l'ouverture des réglages. */
  reprendreConnexions(connexions: ConnexionCompte[]): void {
    this.set({ connexions: [...connexions].sort((a, b) => a.commenceeA - b.commenceeA) });
  }

  /**
   * L'ENVOI SANS RETOUR — IL DIT MAINTENANT S'IL A PU PARTIR.
   *
   * Il ne devient pas bruyant pour autant : ce chemin porte les gestes
   * DÉCORATIFS (dire quel écran on regarde, demander une liste que l'écran
   * redemande de lui-même à la reconnexion), qu'il est juste de perdre en
   * silence. Mais il ne les perdait pas SEULS : tout ce qui engageait quelque
   * chose passait par là aussi, et disparaissait sans un mot dès que le canal
   * n'était pas ouvert — c'est exactement ce qui rendait la reconnexion d'un
   * compte impossible. Le booléen rendu permet à un appelant de savoir, et
   * `geste()` juste en dessous s'en charge pour lui.
   */
  send(cmd: ClientCommand): boolean {
    if (cmd.type === 'agent.open') this.dernierAgentOuvert = { id: cmd.id, tout: !!cmd.tout };
    if (cmd.type === 'card.conversation') this.derniereCarteOuverte = cmd.cardId;
    this.noterLePerimetre(cmd);
    if (cmd.type === 'prefs.set') return this.envoyerReglage(cmd.key, cmd.value);
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ cmd }));
      return true;
    }
    return false;
  }

  /**
   * L'ŒIL « DÉJÀ VUE » DES IMAGES D'UNE BANDE (`lib/captures-vues.ts`). Une
   * bande demande l'état de SES clés — seules celles pas encore demandées
   * partent, par tranches. Une demande sans réponse se refera à la reconnexion.
   */
  demanderLesCapturesVues(cles: readonly string[]): void {
    for (const cle of cles) this.vuesADemander.add(cle);
    if (this.demandeDeVuesPrevue !== null) return;
    // UN SEUL ALLER-RETOUR pour toutes les bandes posées dans le même souffle :
    // un fil de cinquante réponses illustrées ne fait pas cinquante demandes.
    this.demandeDeVuesPrevue = window.setTimeout(() => {
      this.demandeDeVuesPrevue = null;
      const lot = [...this.vuesADemander];
      this.vuesADemander.clear();
      for (const tranche of clesADemander(lot)) {
        this.call<{ cles?: string[] }>({ type: 'captures.vues', cles: tranche }, 20000)
          .then((reponse) => retenirLesVues(reponse?.cles ?? []))
          .catch(() => oublierLaDemande(tranche));
      }
    }, 40);
  }

  private vuesADemander = new Set<string>();
  private demandeDeVuesPrevue: number | null = null;

  /**
   * CES IMAGES VIENNENT D'ÊTRE AFFICHÉES EN GRAND : l'œil s'allume tout de
   * suite ici, et le serveur le retient pour les autres appareils du compte.
   * Un envoi qui n'a pas pu partir attend la reconnexion — il ne se perd pas.
   */
  marquerCapturesVues(cles: readonly string[]): void {
    const nouvelles = retenirLesVues(cles);
    if (!nouvelles.length) return;
    noterAEnvoyer(nouvelles);
    this.envoyerLesVuesEnAttente();
  }

  /** Les clés parties et pas encore accusées : elles ne repartent pas une seconde fois. */
  private vuesEnVol = new Set<string>();

  private envoyerLesVuesEnAttente(): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    for (const tranche of tranchesAEnvoyer()) {
      const partantes = tranche.filter((cle) => !this.vuesEnVol.has(cle));
      if (!partantes.length) continue;
      for (const cle of partantes) this.vuesEnVol.add(cle);
      // Confirmée seulement à l'accusé : un canal qui tombe en vol la laisse en attente.
      this.call({ type: 'captures.voir', cles: partantes }, 20000)
        .then(() => envoiConfirme(partantes))
        .catch(() => {})
        .finally(() => {
          for (const cle of partantes) this.vuesEnVol.delete(cle);
        });
    }
  }

  /**
   * UN RÉGLAGE ENVOYÉ D'ICI NE RECULE PAS AVANT D'ÊTRE CONFIRMÉ
   * (`reglagesSansRecul`, `shared/src/reglages-en-vol.ts`).
   *
   * Le serveur répond à chaque `prefs.set` par le bloc ENTIER des réglages.
   * Deux réglages envoyés coup sur coup — le brouillon d'une conversation et
   * ses pièces jointes, à chaque image jointe — se défaisaient donc l'un
   * l'autre à l'écran : la réponse au premier ne connaît pas encore le second.
   * Le champ d'écriture était réécrit deux fois, et son curseur finissait au
   * bout du texte.
   *
   * L'envoi porte donc un identifiant : tant que son accusé n'est pas revenu,
   * la valeur envoyée vaut pour sa clé, quel que soit le bloc reçu. Le serveur
   * diffuse le bloc AVANT d'accuser réception ; après l'accusé, il fait foi.
   * Un canal qui tombe libère tout (`apresFermetureDuCanal`) : le bloc complet
   * de la reconnexion repart du serveur.
   */
  private reglagesEnVol = new Map<string, { valeur: unknown; envois: Set<string> }>();

  private envoyerReglage(key: string, value: unknown): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    const id = Math.random().toString(36).slice(2);
    const enVol = this.reglagesEnVol.get(key) ?? { valeur: value, envois: new Set<string>() };
    enVol.valeur = value;
    enVol.envois.add(id);
    this.reglagesEnVol.set(key, enVol);
    const liberer = () => {
      // Le MÊME objet seulement : une reconnexion a pu repartir d'une table neuve.
      if (this.reglagesEnVol.get(key) !== enVol) return;
      enVol.envois.delete(id);
      if (!enVol.envois.size) this.reglagesEnVol.delete(key);
    };
    this.pending.set(id, { resolve: liberer, reject: liberer });
    this.socket.send(JSON.stringify({ id, cmd: { type: 'prefs.set', key, value } }));
    // Un accusé qui ne revient pas ne fige pas la clé : le serveur reprend la main.
    window.setTimeout(() => {
      if (this.pending.delete(id)) liberer();
    }, 15000);
    return true;
  }

  /**
   * UN GESTE QUI ENGAGE QUELQUE CHOSE : IL RÉUSSIT OU IL SE PLAINT.
   *
   * Toute commande porteuse d'un identifiant reçoit un accusé du serveur
   * (`ack`, `server/src/ws.ts`) : n'importe quel geste peut donc emprunter
   * `call()`, qui REJETTE quand le canal n'est pas ouvert, au lieu de `send()`,
   * qui jetait. Ici on rend ce chemin utilisable sans rituel : l'échec se voit
   * à l'écran (message nommant le geste), le lien est relancé SUR-LE-CHAMP
   * plutôt qu'au bout du repli progressif, et le message d'état du canal
   * paraît immédiatement — sans attendre les 1,5 s qui font qu'une coupure
   * d'une seconde avalait un clic en silence.
   *
   * Rend vrai si le serveur a accusé réception. Ne lève jamais : un appelant
   * qui veut seulement « que ça se voie » n'a rien à écrire de plus.
   */
  async geste<T = any>(cmd: ClientCommand, quoi?: string, timeoutMs?: number): Promise<T | null> {
    try {
      const rendu = await this.call<T>(cmd, timeoutMs);
      return rendu ?? ({} as T);
    } catch (err: any) {
      const raison: string = err?.message ?? '';
      /* TROIS ÉCHECS QUI NE SE DISENT PAS PAREIL, et qu'on ne confond pas.
         Le geste JAMAIS PARTI (canal fermé) est le seul qui mérite de relancer
         le lien : c'est la panne d'origine de cette carte. Une réponse qui
         n'arrive pas dit qu'on ne sait pas — le battement de cœur juge le
         canal, pas nous. Et un REFUS MÉTIER est bien parti, il a été reçu, et porte
         sa propre raison : la maquiller en panne de réseau serait un mensonge. */
      if (err?.canalFerme) this.signalerGesteRefuse(quoi);
      else if (raison === RAISON_SANS_REPONSE)
        this.pushToast('warning', quoi ? `${quoi} : ${raison}` : raison);
      else this.pushToast('error', quoi && raison ? `${quoi} : ${raison}` : raison || t('commande refusée'));
      return null;
    }
  }

  /**
   * LE GESTE N'EST PAS PARTI : ON LE DIT, ET ON RÉPARE LE LIEN TOUT DE SUITE.
   * Deux effets, jamais l'un sans l'autre — prévenir sans relancer laisserait
   * l'utilisateur réessayer dans le vide pendant douze secondes.
   */
  private signalerGesteRefuse(quoi?: string): void {
    // En veille, personne n'a fait ce geste : c'est un automatisme resté en
    // marche. Ni message, ni reconnexion — le retour à l'écran s'en charge.
    if (estEnVeille()) return;
    this.gesteRefuseA = Date.now();
    this.pushToast('error', quoi ? t(MOT_GESTE_NOMME_NON_PARTI, { geste: quoi }) : t(MOT_GESTE_NON_PARTI));
    this.rafraichirLeCanal();
    this.reconnecterMaintenant();
  }

  /**
   * UN GESTE QUI N'EST PAS PARTI LAISSE SA TRACE au journal des erreurs
   * d'interface : l'état du lien, sa dernière fermeture et son motif. C'est ce
   * qui manquait pour expliquer un « non connecté » vu chez l'utilisateur et
   * jamais reproduit (carte « Coffre-fort qui plante dans un dossier »). En
   * veille, le canal est fermé par nous : rien à dire. La remontée borne
   * elle-même le nombre d'envois par page.
   */
  private tracerLeGesteNonParti(cmd: ClientCommand): void {
    if (estEnVeille() || cmd.type === 'ping') return;
    signalerErreur(
      rapportDuGesteNonParti(
        {
          commande: cmd.type,
          etatDuSocket: this.socket ? this.socket.readyState : null,
          coupeDepuis: this.coupeDepuis,
          derniereFermeture: this.derniereFermeture,
          derniereCommande: this.derniereCommande,
          dernierEvenementA: this.dernierEvenementA,
          enVeille: estEnVeille(),
          pageCachee: pageCachee(),
          enLigne: typeof navigator !== 'undefined' ? navigator.onLine : undefined,
        },
        Date.now(),
      ),
    );
  }

  call<T = any>(cmd: ClientCommand, timeoutMs = 120000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.socket?.readyState !== WebSocket.OPEN) {
        /* LE GESTE N'EST JAMAIS PARTI, et l'erreur le DIT d'elle-même : un
           drapeau posé sur l'objet, jamais une comparaison de texte — la phrase
           est traduite, et un motif de texte se casserait dès la première
           langue changée. */
        const erreur = new Error(t('non connecté'));
        (erreur as Error & { canalFerme?: boolean }).canalFerme = true;
        this.tracerLeGesteNonParti(cmd);
        reject(erreur);
        return;
      }
      const id = Math.random().toString(36).slice(2);
      this.pending.set(id, { resolve, reject });
      this.noterLePerimetre(cmd);
      this.derniereCommande = { type: cmd.type, a: Date.now() };
      this.socket.send(JSON.stringify({ id, cmd }));
      window.setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          // Une requête qui expire compte, mais ne conclut rien à elle seule :
          // un lancement de carte ne répond qu'À LA FIN du tour. C'est
          // `alerteServeurInjoignable` qui dira si cela vaut une alerte.
          // Sauf en veille : le canal a été fermé PAR NOUS, ce silence n'est pas
          // celui du serveur.
          if (!estEnVeille()) this.echecsReseau += 1;
          reject(new Error(RAISON_SANS_REPONSE));
        }
      }, timeoutMs);
    });
  }

  /**
   * Le serveur est-il réellement injoignable, ou est-ce une requête isolée qui
   * n'a pas abouti ? La règle vit dans `shared` et se teste seule ; ici on ne
   * fait que lui passer l'état du lien.
   */
  serveurInjoignable(): boolean {
    return alerteServeurInjoignable(
      {
        connecte: this.state.connected,
        coupeDepuis: this.coupeDepuis ?? undefined,
        echecsConsecutifs: this.echecsReseau,
      },
      Date.now(),
    );
  }

  /**
   * Le message court d'un geste refusé — mais JAMAIS l'alerte « le serveur ne
   * répond pas » sur un simple délai dépassé, canal ouvert. La raison reste
   * rendue à l'appelant : un lot la compte dans son bilan, une carte la porte.
   */
  signalerRefus(raison: string, cardId?: string): void {
    if (raison === RAISON_SANS_REPONSE && !this.serveurInjoignable()) return;
    this.pushToast('error', raison, cardId);
  }

  /**
   * L'état du démon n'arrive normalement que par l'événement `demon`, diffusé
   * toutes les trente secondes — trop lent après une reconnexion (redémarrage
   * du serveur, réseau qui revient) : le bandeau resterait figé sur le dernier
   * état connu avant la coupure. On le redemande explicitement et on l'applique
   * ici, au lieu de laisser la réponse de `daemon.status` sans effet.
   */
  async refreshDaemonStatus(): Promise<void> {
    try {
      const res = await this.call<{ etat: AppState['demon'] }>({ type: 'daemon.status' });
      if (res?.etat) this.set({ demon: res.etat });
    } catch {
      // Pas connecté, ou serveur pas encore remonté : le prochain appel réessaiera.
    }
  }

  /**
   * Le dialogue d'une procédure, tel que le serveur le dit — par un événement
   * ou en réponse à `procedure.etat`. `null` veut dire « plus aucun tour ici » :
   * on l'EFFACE, pour que le tiroir puisse dire qu'il a été perdu au lieu de
   * garder un témoin allumé sur un tour qui ne tourne plus.
   */
  majProcedure(projectId: string, cible: CiblePublication, etat: EtatProcedure | null): void {
    const cle = `${projectId}:${cible}`;
    this.set((state) => {
      const procedures = { ...state.procedures };
      if (etat) procedures[cle] = etat;
      else delete procedures[cle];
      return { procedures };
    });
  }

  /**
   * Ouvre un projet. `automatique` : le projet n'est pas CHOISI — repli quand
   * celui qu'on regardait disparaît. Il ne compte alors pas comme une ouverture
   * (la liste « Récents » et le rangement par dernière ouverture ne bougent pas).
   */
  setActiveProject(id: string | null, options: { automatique?: boolean } = {}): void {
    const quitte = this.state.activeProjectId;
    // Le projet qu'on quitte garde ses cartes un quart d'heure : un aller-retour
    // entre deux projets est un geste courant, il ne doit rien faire clignoter.
    if (quitte && quitte !== id) this.vuA.set(quitte, Date.now());
    this.set({ activeProjectId: id });
    if (id) {
      this.vuA.delete(id);
      this.send({ type: 'project.open', id });
      this.send({ type: 'attachments.list', projectId: id });
      this.retenirProjetActif(id);
      if (!options.automatique) this.noterLOuvertureDuProjet(id);
    }
  }

  /**
   * LA DERNIÈRE OUVERTURE DE CHAQUE PROJET se retient en base
   * (`projets.ouvertLe`, comme le reste des réglages d'affichage) : la liste
   * déroulante et la colonne de gauche s'en servent pour se ranger, et la
   * section « Récents » aussi. UN SEUL envoi par ouverture, et aucun quand le
   * projet est déjà le plus récent. La restauration du projet au démarrage ne
   * passe pas par ici : elle n'est pas un geste.
   */
  private noterLOuvertureDuProjet(id: string): void {
    const avant = ouverturesValides(this.state.prefs[CLE_OUVERTURES_DE_PROJETS]);
    const apres = noterOuverture(avant, id, Date.now());
    if (apres === avant) return;
    this.setPrefLocally(CLE_OUVERTURES_DE_PROJETS, apres);
    this.send({ type: 'prefs.set', key: CLE_OUVERTURES_DE_PROJETS, value: apres });
  }

  /*
   * LES CARTES D'UN PROJET QU'ON NE CONSULTE PLUS SE DÉCHARGENT — APRÈS QUINZE
   * MINUTES, PAS AVANT (`projetsADecharger`, `shared/src/decharge-projets.ts`).
   *
   * Sans cela, ouvrir cinq projets revenait à garder cinq tableaux entiers en
   * mémoire jusqu'à la fin de la session, et à en payer le poids à chaque
   * changement d'état. Un projet rouvert redemande ses cartes au serveur, qui
   * les renvoie entières : `setActiveProject` envoie déjà `project.open`, il n'y
   * a rien de plus à faire — et rien n'est perdu, la base reste la source.
   */
  /** Quand chaque projet a été quitté. Le projet affiché n'y figure jamais. */
  private vuA = new Map<string, number>();
  private veilleDechargement = 0;

  private lancerLaVeilleDeDechargement(): void {
    if (this.veilleDechargement) return;
    this.veilleDechargement = window.setInterval(() => this.dechargerLesProjetsOublies(), 60_000);
  }

  dechargerLesProjetsOublies(maintenant = Date.now()): string[] {
    const carteRetenue = this.carteDuTiroir ? this.state.cards[this.carteDuTiroir] : undefined;
    const oublies = projetsADecharger({
      vuA: Object.fromEntries(this.vuA),
      projetAffiche: this.state.activeProjectId,
      projetsRetenus: carteRetenue ? [carteRetenue.projectId] : [],
      maintenant,
    });
    if (!oublies.length) return [];
    for (const id of oublies) this.vuA.delete(id);
    const aOublier = new Set(oublies);
    /* Les cartes de ces projets : leur journal et leur fil partent avec elles,
       sinon une carte rouverte plus tard afficherait un parcours vieux d'une
       heure sans jamais montrer sa silhouette. */
    const cartesOubliees = new Set(
      Object.values(this.state.cards)
        .filter((carte) => aOublier.has(carte.projectId))
        .map((carte) => carte.id),
    );
    const sansLesCartesOubliees = <T,>(table: Record<string, T>): Record<string, T> =>
      Object.fromEntries(Object.entries(table).filter(([id]) => !cartesOubliees.has(id)));
    this.set((state) => ({
      journaux: sansLesCartesOubliees(state.journaux),
      carnets: sansLesCartesOubliees(state.carnets),
      cardMessages: sansLesCartesOubliees(state.cardMessages),
      conversationsEnEchec: sansLesCartesOubliees(state.conversationsEnEchec),
      cards: Object.fromEntries(
        Object.entries(state.cards).filter(([, carte]) => !aOublier.has(carte.projectId)),
      ),
      // Un projet déchargé n'a plus ses cartes : sa réouverture doit remontrer
      // des silhouettes, pas un tableau qu'on croirait vide.
      cartesChargees: Object.fromEntries(
        Object.entries(state.cartesChargees).filter(([id]) => !aOublier.has(id)),
      ),
      cartesTotaux: Object.fromEntries(
        Object.entries(state.cartesTotaux).filter(([id]) => !aOublier.has(id)),
      ),
    }));
    return oublies;
  }

  /**
   * LA CARTE OUVERTE DANS LE TIROIR, tenue par l'application. Son projet n'est
   * jamais déchargé : ouverte depuis la page « En route », la carte peut
   * appartenir à un projet qu'on n'affiche pas.
   */
  private carteDuTiroir: string | null = null;

  retenirCarteDuTiroir(cardId: string | null): void {
    this.carteDuTiroir = cardId;
  }

  /* ---------------- La page « En route » ---------------- */

  /** La clé de la dernière famille reçue du démon, par colonne : la suite se demande sous elle. */
  private curseursEnRoute: Partial<Record<OngletEnRoute, CurseurEnRoute>> = {};
  private enRouteEnVol: Record<OngletEnRoute, boolean> = { actif: false, terminer: false, archive: false };
  /** Combien de familles la colonne a demandées jusqu'ici : un paquet de plus à chaque « suivantes ». */
  private profondeurEnRoute: Record<OngletEnRoute, number> = {
    actif: CARTES_EN_ROUTE_PAR_PAQUET,
    terminer: CARTES_EN_ROUTE_PAR_PAQUET,
    archive: CARTES_EN_ROUTE_PAR_PAQUET,
  };

  /**
   * LE PREMIER PAQUET D'UNE COLONNE DE LA PAGE, redemandé à chaque ouverture :
   * ce qu'on avait gardé reste affiché pendant ce temps, sans silhouette ni saut.
   */
  async chargerEnRoute(onglet: OngletEnRoute = 'actif', options: { garderLaProfondeur?: boolean } = {}): Promise<void> {
    delete this.curseursEnRoute[onglet];
    // Au retour du lien, on redemande d'un bloc ce que la colonne montrait déjà
    // (plafond du démon : 200 familles) au lieu de la ramener à son premier paquet.
    const limite = options.garderLaProfondeur
      ? Math.min(LIMITE_EN_ROUTE_PAR_DEMANDE, Math.max(CARTES_EN_ROUTE_PAR_PAQUET, this.profondeurEnRoute[onglet]))
      : CARTES_EN_ROUTE_PAR_PAQUET;
    await this.demanderEnRoute(onglet, true, limite);
  }

  /**
   * AU RETOUR DU LIEN, TOUTE COLONNE DÉJÀ LUE SE RELIT — pas seulement celles
   * restées sur un échec. Un événement de carte émis pendant la coupure est
   * perdu pour cet écran : sans cette relecture, la page « Tableaux de bord »
   * gardait ce qu'elle avait lu à l'ouverture (demande du 16/10/2026 : « je
   * reviens du téléphone sur l'ordinateur, il faut rafraîchir »). L'ancien
   * contenu reste affiché pendant la lecture, et les paquets déjà dépliés sont
   * redemandés d'un bloc : ni silhouette, ni saut. À la première connexion il
   * n'y a rien à relire, sauf une colonne restée sur un échec.
   */
  private rechargerLesColonnesChargees(reprise: boolean): void {
    for (const onglet of ['actif', 'terminer', 'archive'] as const) {
      const colonne = this.state[CLE_ETAT_EN_ROUTE[onglet]];
      if (colonne && (colonne.erreur || reprise)) void this.chargerEnRoute(onglet, { garderLaProfondeur: true });
    }
  }

  /**
   * LES TABLEAUX DES AUTRES PROJETS GARDÉS EN MÉMOIRE (déchargés après quinze
   * minutes) se relisent au retour du lien, eux aussi : leurs cartes servent à
   * la colonne de gauche (pastilles, triangle) et à la réouverture. Une seule
   * demande, une réponse pour cet écran seul. Le projet affiché n'en fait pas
   * partie : le démon renvoie le sien avec `ready`.
   */
  private relireLesProjetsChargesEnMemoire(projetAffiche: string | null): void {
    const ids = Object.keys(this.state.cartesChargees).filter(
      (id) => id !== projetAffiche && this.state.projects.some((projet) => projet.id === id),
    );
    if (!ids.length) return;
    this.call<{ projets: Extract<ServerEvent, { type: 'project.etat' }>[] }>({ type: 'projects.relire', ids: ids.slice(0, 20) })
      .then((reponse) => {
        // Un projet quitté entre-temps puis déchargé ne revient pas à la vie.
        for (const etat of reponse.projets) {
          if (this.state.cartesChargees[etat.projectId]) this.appliquerLEtatDuProjet(etat, false);
        }
      })
      .catch(() => {
        /* Un démon d'avant cette commande : la réouverture relit comme avant. */
      });
  }

  private appliquerLEtatDuProjet(event: Extract<ServerEvent, { type: 'project.etat' }>, vider = true): void {
    if (vider) this.tranchesEnVol.clear();
    this.set((state) => ({
      cards: {
        ...Object.fromEntries(Object.entries(state.cards).filter(([, card]) => card.projectId !== event.projectId)),
        ...Object.fromEntries(event.cards.map((card) => [card.id, card])),
      },
      agents: { ...state.agents, ...Object.fromEntries(event.agents.map((agent) => [agent.id, agent])) },
      // Sans totaux (un démon d'avant les tranches) : ce qui est reçu est tout.
      cartesTotaux: {
        ...state.cartesTotaux,
        [event.projectId]: event.totaux ?? premiereTranche(event.cards, Number.POSITIVE_INFINITY).totaux,
      },
      deploys: event.deploy ? { ...state.deploys, [event.projectId]: event.deploy } : state.deploys,
      productions: event.deploy ? productionsApres(state.productions, event.deploy, Date.now()) : state.productions,
      memory: event.memory !== undefined ? { ...state.memory, [event.projectId]: event.memory } : state.memory,
      // Les cartes de ce projet sont là : le tableau peut cesser de montrer
      // ses silhouettes, et dire un vrai « aucune carte » s'il est vide.
      cartesChargees: { ...state.cartesChargees, [event.projectId]: true },
    }));
    this.programmerLaCopieLocale();
  }

  /** Le paquet suivant de la colonne, sous la dernière famille reçue. Rien quand tout est là. */
  async chargerLaSuiteEnRoute(onglet: OngletEnRoute = 'actif'): Promise<void> {
    if (!this.state[CLE_ETAT_EN_ROUTE[onglet]]?.restant) return;
    await this.demanderEnRoute(onglet, false);
  }

  private async demanderEnRoute(
    onglet: OngletEnRoute,
    depuisLeDebut: boolean,
    limite: number = CARTES_EN_ROUTE_PAR_PAQUET,
  ): Promise<void> {
    if (this.enRouteEnVol[onglet]) return;
    this.enRouteEnVol[onglet] = true;
    const cle = CLE_ETAT_EN_ROUTE[onglet];
    try {
      const curseur = this.curseursEnRoute[onglet];
      const reponse = await this.call<{
        cards: Card[];
        agents: Agent[];
        restant: number;
        demandes?: Record<string, string>;
        /** La clé de la dernière FAMILLE envoyée (un démon d'avant les piles n'en rend pas). */
        curseur?: CurseurEnRoute;
      }>({
        type: 'cards.enRoute',
        onglet,
        ...(curseur ? { apres: curseur } : {}),
        limit: limite,
      });
      this.profondeurEnRoute[onglet] = depuisLeDebut ? limite : this.profondeurEnRoute[onglet] + limite;
      const derniere = reponse.cards[reponse.cards.length - 1];
      if (derniere) this.curseursEnRoute[onglet] = reponse.curseur ?? curseurApres(derniere);
      this.set((state) => ({
        [cle]: {
          cartes: {
            // Au premier paquet, ce qui n'est plus dans la colonne part : la page
            // repart de ce que le démon compte vraiment.
            ...(depuisLeDebut ? {} : (state[cle]?.cartes ?? {})),
            ...Object.fromEntries(reponse.cards.map((card) => [card.id, card])),
          },
          demandes: { ...(state[cle]?.demandes ?? {}), ...(reponse.demandes ?? {}) },
          restant: reponse.restant,
          charge: true,
        },
        agents: { ...state.agents, ...Object.fromEntries(reponse.agents.map((agent) => [agent.id, agent])) },
      }));
    } catch (err: any) {
      this.set((state) => ({
        [cle]: {
          cartes: state[cle]?.cartes ?? {},
          demandes: state[cle]?.demandes ?? {},
          restant: state[cle]?.restant ?? 0,
          charge: true,
          erreur: err?.message ?? String(err),
        },
      }));
    } finally {
      this.enRouteEnVol[onglet] = false;
    }
  }

  /**
   * UNE CARTE A BOUGÉ : la page la range dans sa colonne — « Actifs » en
   * Demande ou Travail, « Terminer » une fois rendue (À déployer), « Archiver »
   * une fois rangée. Une carte d'une demande commune emporte TOUTE sa famille
   * connue (`repartirLaFamille`) : une fille publiée ne quitte « Actifs »
   * qu'avec ses sœurs, jamais seule. Le tri se refait à l'affichage
   * (`pilesEnRoute`) : une carte qui bouge (dernière action) remonte seule.
   */
  private pageApresCarte(
    state: AppState,
    card: Card,
  ): Pick<AppState, 'enRoute' | 'enRouteTerminer' | 'enRouteArchive'> {
    const reserves = repartirLaFamille(
      {
        actif: state.enRoute?.cartes ?? null,
        terminer: state.enRouteTerminer?.cartes ?? null,
        archive: state.enRouteArchive?.cartes ?? null,
      },
      card,
    );
    const suite = (etat: EtatEnRoute | null, cartes: Record<string, Card> | null) =>
      etat && cartes ? { ...etat, cartes } : etat;
    return {
      enRoute: suite(state.enRoute, reserves.actif),
      enRouteTerminer: suite(state.enRouteTerminer, reserves.terminer),
      enRouteArchive: suite(state.enRouteArchive, reserves.archive),
    };
  }

  private enRouteSansCarte(enRoute: EtatEnRoute | null, cardId: string): EtatEnRoute | null {
    if (!enRoute?.cartes[cardId]) return enRoute;
    const cartes = { ...enRoute.cartes };
    delete cartes[cardId];
    return { ...enRoute, cartes };
  }

  /**
   * OUVRIR UNE CARTE DE LA PAGE DANS LE TIROIR. Le tiroir lit `cards` : la
   * carte y est versée d'abord, sans toucher au projet affiché ni au tableau.
   */
  verserCarte(card: Card): void {
    if (this.state.cards[card.id] === card) return;
    this.set((state) => ({ cards: { ...state.cards, [card.id]: state.cards[card.id] ?? card } }));
  }

  /* ---------------- Les cartes par tranches ---------------- */

  /** Les tranches déjà demandées et pas encore reçues, par « projet/colonne ». */
  private tranchesEnVol = new Map<string, Promise<boolean>>();

  private totauxApresCarte(
    state: AppState,
    projectId: string,
    avant: string | undefined,
    apres: string | undefined,
  ): Record<string, TotauxParColonne> {
    const totaux = state.cartesTotaux[projectId];
    // Un projet dont on n'a pas l'instantané n'a pas de totaux à tenir.
    if (!totaux || avant === apres) return state.cartesTotaux;
    return { ...state.cartesTotaux, [projectId]: totauxApresChangement(totaux, avant, apres) };
  }

  /** Combien de cartes de cette colonne le démon compte, et combien sont ici. */
  compteDeColonne(projectId: string, column: ColumnKey): { recues: number; total: number } {
    let recues = 0;
    for (const carte of Object.values(this.state.cards)) {
      if (carte.projectId === projectId && carte.column === column && colonneComptee(carte)) recues += 1;
    }
    const total = Math.max(recues, this.state.cartesTotaux[projectId]?.[column] ?? 0);
    return { recues, total };
  }

  /**
   * LA TRANCHE SUIVANTE D'UNE COLONNE, demandée au démon sous la carte la plus
   * basse déjà reçue. Une seule demande à la fois par colonne : le palier de
   * chargement peut se dire visible plusieurs fois avant que la réponse
   * n'arrive. Rien n'est demandé quand tout est déjà là.
   */
  async chargerLaTranche(projectId: string, column: ColumnKey): Promise<boolean> {
    const cle = `${projectId}/${column}`;
    if (this.tranchesEnVol.has(cle)) return false;
    const { recues, total } = this.compteDeColonne(projectId, column);
    if (!resteSurLeServeur(recues, total)) return false;
    /* Les étapes de suite arrivent avec leur carte globale, hors des paquets : elles ne disent rien de la reprise. */
    const chargees = Object.values(this.state.cards).filter((c) => c.projectId === projectId && c.column === column && !estEtapeDeSuite(c));
    const demande = (async () => {
      const reponse = await this.call<{ cards: Card[]; agents: Agent[]; total: number }>({
        type: 'cards.tranche',
        projectId,
        column,
        avantPosition: positionDeReprise(chargees),
      });
      this.set((state) => ({
        cards: { ...state.cards, ...Object.fromEntries(reponse.cards.map((card) => [card.id, card])) },
        agents: { ...state.agents, ...Object.fromEntries(reponse.agents.map((agent) => [agent.id, agent])) },
        cartesTotaux: {
          ...state.cartesTotaux,
          [projectId]: { ...(state.cartesTotaux[projectId] ?? {}), [column]: reponse.total },
        },
      }));
      return reponse.cards.length > 0;
    })();
    this.tranchesEnVol.set(cle, demande);
    try {
      return await demande;
    } finally {
      this.tranchesEnVol.delete(cle);
    }
  }

  /**
   * TOUTE LA COLONNE, tranche après tranche : une sélection en lot doit voir
   * toutes ses cartes, pas seulement celles que le défilement a fait venir.
   *
   * UNE TRANCHE DÉJÀ EN VOL S'ATTEND, elle ne fait pas rendre la main : le
   * palier de chargement et le lot de « Déployer » peuvent demander la même
   * colonne au même instant, et celui qui arrivait second repartait avec une
   * colonne incomplète.
   */
  async chargerToutesLesCartes(projectId: string, column: ColumnKey): Promise<void> {
    const cle = `${projectId}/${column}`;
    for (let garde = 0; garde < 500; garde += 1) {
      const { recues, total } = this.compteDeColonne(projectId, column);
      if (!resteSurLeServeur(recues, total)) return;
      const enVol = this.tranchesEnVol.get(cle);
      if (enVol) {
        await enVol.catch(() => undefined);
        continue;
      }
      if (!(await this.chargerLaTranche(projectId, column))) return;
    }
  }

  /**
   * Le dernier projet consulté vit dans la table des préférences, jamais dans
   * le navigateur : on le retrouve à la réouverture, ordinateur ou téléphone.
   */
  /** Le projet affiché a disparu (archivé, supprimé) : repli sur le premier. */
  private replierSiProjetIndisponible(): void {
    const encore = this.state.projects.some((p) => p.id === this.state.activeProjectId && !p.archived);
    if (encore) return;
    const choix = choisirProjetAOuvrir(this.state.projects, this.state.prefs[CLE_PROJET_ACTIF], null);
    if (choix.id === this.state.activeProjectId) return;
    this.setActiveProject(choix.id, { automatique: true });
  }

  private retenirProjetActif(id: string): void {
    if (this.state.prefs[CLE_PROJET_ACTIF] === id) return;
    this.setPrefLocally(CLE_PROJET_ACTIF, id);
    this.send({ type: 'prefs.set', key: CLE_PROJET_ACTIF, value: id });
  }

  /**
   * Optimisme contrôlé : on affiche tout de suite, puis on réconcilie.
   *
   * On ne remet JAMAIS en place la carte telle qu'on l'avait au départ : entre
   * l'envoi et le refus, le serveur a eu le temps d'écrire la raison de
   * l'attente sur la carte (`waitingReason`) et de nous la diffuser. Restaurer
   * la vieille copie l'effaçait aussitôt — la carte revenait à sa colonne sans
   * un mot. On ne rend donc que la COLONNE, sur la version la plus fraîche.
   *
   * Le résultat est RENDU à l'appelant : un lot en a besoin pour continuer avec
   * les cartes suivantes et faire son compte. `silencieux` lui laisse dire les
   * refus à sa façon, en une seule fois, au lieu d'empiler une bulle par carte.
   */
  /**
   * Valider une carte de « Planifié » : le geste qui autorise la dépense et
   * lance l'analyse. La carte ne change pas de colonne — elle reste sur place,
   * marquée « chiffrage en cours », et affiche ses chiffres dès qu'ils sont
   * là. Même forme de réponse que `moveCard` : le pied
   * de lot s'en sert exactement pareil.
   */
  async validerCarte(card: Card, options: { silencieux?: boolean } = {}): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.call({ type: 'card.validate', id: card.id });
      return { ok: true };
    } catch (err: any) {
      const raison = err?.message ?? t('validation refusée');
      if (!options.silencieux) this.signalerRefus(raison, card.id);
      return { ok: false, error: raison };
    }
  }

  /**
   * LANCER UNE CARTE : UN SEUL CHEMIN, ET IL NE SE TAIT JAMAIS.
   *
   * Constat qui a produit cette méthode : les trois boutons de lancement
   * appelaient `card.start` chacun à sa façon, avec l'attente ordinaire de deux
   * minutes. Une ouverture de copie de travail plus longue que cela (gros dépôt,
   * disque distant) faisait expirer la requête ; le refus expiré est justement
   * celui que `signalerRefus` avale, pour ne pas crier « le serveur ne répond
   * pas » sur une simple lenteur. Résultat : la roue tournait, revenait, et
   * l'écran ne disait RIEN — le symptôme rapporté.
   *
   * Ici, trois choses tiennent ensemble : l'attente suit ce que le serveur peut
   * réellement mettre, une attente qui dure se dit (le même événement que les
   * autres boutons), et une attente dépassée porte SA phrase au lieu du silence.
   * L'erreur reste RENDUE à l'appelant : le bouton doit revenir à son état de
   * repos, jamais afficher une coche sur un lancement qui n'a pas abouti.
   */
  async demanderLeLancement(cardId: string): Promise<void> {
    // Une préparation qui dure n'est PAS un incident : au lieu de
    // l'avertissement commun aux boutons lents (« … prend plus de temps que
    // prévu »), que l'ouverture d'une copie de travail dépasse toujours sur un
    // gros dépôt, on dit l'ÉTAPE atteinte (`shared/src/lancement-en-cours.ts`).
    const lent = window.setTimeout(() => {
      const etape = this.state.lancements[cardId]?.etape;
      if (etape) this.pushToast('info', mentionDeLancement(etape), cardId, 'geste-lent');
    }, SEUIL_LONGUE_ATTENTE_MS);
    try {
      await this.call({ type: 'card.start', id: cardId }, DELAI_ATTENTE_LANCEMENT_MS);
    } catch (err: any) {
      const raison = err?.message ?? t('Lancement refusé');
      if (raison === RAISON_SANS_REPONSE) this.pushToast('warning', motDeLancementSansReponse(), cardId);
      else this.signalerRefus(raison, cardId);
      throw err;
    } finally {
      window.clearTimeout(lent);
    }
  }

  async moveCard(
    card: Card,
    column: Card['column'],
    options: { silencieux?: boolean } = {},
  ): Promise<{ ok: boolean; error?: string }> {
    const colonneDeDepart = (this.state.cards[card.id] ?? card).column;
    this.set((state) => ({
      cards: { ...state.cards, [card.id]: { ...(state.cards[card.id] ?? card), column } },
    }));
    try {
      await this.call({ type: 'card.move', id: card.id, column });
      return { ok: true };
    } catch (err: any) {
      const raison = err?.message ?? t('déplacement refusé');
      this.set((state) => {
        const fraiche = state.cards[card.id];
        if (!fraiche) return {};
        // Entre l'envoi et ce refus, le serveur a pu diffuser sa propre vérité
        // (`card.upsert`) — un lancement réellement parti, juste plus lent que
        // le délai d'attente local. Ne pas l'écraser : on ne revient à la
        // colonne de départ QUE si rien de plus frais n'est arrivé entre-temps.
        if (fraiche.column !== column) return {};
        return { cards: { ...state.cards, [card.id]: { ...fraiche, column: colonneDeDepart } } };
      });
      if (!options.silencieux) this.signalerRefus(raison, card.id);
      return { ok: false, error: raison };
    }
  }

  /**
   * TOUTE LA COLONNE « TERMINER » EN MÉMOIRE : la page ne la charge que par
   * paquets de vingt, et « Tout archiver » doit voir aussi les cartes en ligne
   * qu'elle n'a pas encore affichées. S'arrête dès qu'un paquet ne fait pas
   * baisser le reste (erreur, demande déjà en vol) : jamais de boucle sans fin.
   */
  async chargerToutTerminer(): Promise<void> {
    for (;;) {
      const avant = this.state.enRouteTerminer?.restant ?? 0;
      if (!avant) return;
      await this.chargerLaSuiteEnRoute('terminer');
      const apres = this.state.enRouteTerminer;
      if (!apres || apres.erreur || apres.restant >= avant) return;
    }
  }

  /**
   * RANGER (OU RESSORTIR) DES CARTES FINIES SUR LA PAGE « TABLEAUX DE BORD »
   * SEULEMENT — « Tout archiver » en tête de « Terminer », ou un glisser
   * entre « Terminer » et « Archiver ». La carte ne bouge PAS dans son projet :
   * ni colonne, ni lot de publication (`card.rangerTableauDeBord`). L'écran
   * range tout de suite (même règle que l'écho du démon, `repartirLaFamille`) ;
   * le bilan ne se dit que pour un lot (`silencieux` pour un glisser).
   */
  async rangerDansLeTableauDeBord(cartes: Card[], range: boolean, options: { silencieux?: boolean } = {}): Promise<void> {
    if (!cartes.length) return;
    const instant = Date.now();
    this.set((state) => {
      let page: Pick<AppState, 'enRoute' | 'enRouteTerminer' | 'enRouteArchive'> = {
        enRoute: state.enRoute,
        enRouteTerminer: state.enRouteTerminer,
        enRouteArchive: state.enRouteArchive,
      };
      for (const carte of cartes) {
        const neuve = { ...carte, rangeeTableauDeBordAt: range ? instant : undefined, updatedAt: instant };
        page = this.pageApresCarte({ ...state, ...page }, neuve);
      }
      return page;
    });
    try {
      const reponse = await this.call<{ ids: string[] }>(
        { type: 'card.rangerTableauDeBord', ids: cartes.map((c) => c.id), range },
        30000,
      );
      if (options.silencieux) return;
      const bilan = bilanDeLot(range ? CLE_PARTICIPE_ARCHIVAGE : CLE_PARTICIPE_RESSORTIE, reponse?.ids?.length ?? 0, []);
      this.pushToast(bilan.niveau, bilan.texte);
    } catch (err: any) {
      // Le démon a refusé : l'écran se réaligne sur ce qu'il sait vraiment.
      for (const onglet of ['terminer', 'archive'] as const) void this.chargerEnRoute(onglet);
      this.pushToast('error', err?.message ?? String(err));
    }
  }

  /*
   * UNE CARTE OUVERTE PAR LIEN DIRECT SE RÉCLAME AU SERVEUR. L'instantané du
   * projet ne contient que les cartes de CE projet, et une carte effacée n'y
   * est plus du tout : le tiroir attendait alors une carte qui n'arriverait
   * jamais, sans rien dire. On demande donc la carte par son seul identifiant,
   * et on range la réponse dans l'état quand elle existe.
   */
  async chargerCarte(cardId: string): Promise<'ok' | 'introuvable' | 'illisible' | 'erreur'> {
    try {
      const reponse = await this.call<{ etat: 'ok' | 'introuvable' | 'illisible'; carte?: Card }>(
        { type: 'card.get', id: cardId },
        15000,
      );
      if (reponse.etat === 'ok' && reponse.carte) {
        const carte = reponse.carte;
        this.set((state) => ({ cards: { ...state.cards, [carte.id]: carte } }));
        return 'ok';
      }
      return reponse.etat === 'illisible' ? 'illisible' : 'introuvable';
    } catch {
      return 'erreur';
    }
  }
}

/**
 * UNE CARTE OUVERTE A-T-ELLE REÇU SES DONNÉES ?
 *
 * Trois états, et non deux : la carte n'a rien été demandé, la demande est
 * partie, la réponse est là. Le tiroir se dessinait dès que la CARTE existait
 * dans le magasin — elle arrive avec l'instantané du projet — alors que son
 * journal et son fil, eux, sont réclamés à l'ouverture. Il affichait donc un
 * parcours calculé sur du vide : des étapes « Travail » et « Rapport » en
 * rouge sur une carte qui n'avait encore rien dit.
 *
 * Le drapeau est PAR CARTE : ouvrir une autre carte le fait retomber tout
 * seul, et une carte oubliée depuis quinze minutes perd son journal comme ses
 * cartes (`dechargerLesProjetsOublies`), donc sa réouverture remontre bien la
 * silhouette.
 */
export function donneesDeCarteRecues(state: AppState, cardId: string | null): boolean {
  if (!cardId) return false;
  return state.journaux[cardId] !== undefined && state.cardMessages[cardId] !== undefined;
}

export const client = new Client();

/*
 * UNE ATTENTE QUI DURE SE DIT. Passé dix secondes, un bouton qui tourne annonce
 * son attente à la PAGE (`EVENEMENT_ATTENTE_LONGUE`) : le socle visuel ne
 * connaît pas les messages passagers, et n'a pas à les connaître. C'est ici
 * qu'on met cette attente en mots — un message d'INFORMATION, jamais une
 * alerte : rien n'est en panne, la réponse n'est simplement pas encore là.
 */
if (typeof window !== 'undefined') {
  window.addEventListener(EVENEMENT_ATTENTE_LONGUE, (evenement) => {
    const geste = (evenement as CustomEvent<{ geste?: string }>).detail?.geste;
    // Un geste sans réponse depuis dix secondes est un BLOCAGE — donc l'un des
    // trois motifs qui alertent, et le seul qu'on ne peut lire nulle part
    // ailleurs. Son niveau ne change pas : le message garde sa couleur.
    client.pushToast('info', motDAttenteLongue(geste), undefined, 'geste-lent');
  });
}

/*
  En DÉVELOPPEMENT seulement, un message court peut être provoqué depuis la
  page : c'est ce qui permet à un script de vérification d'essayer la pile
  des messages pour de vrai, sans attendre qu'un agent en produise. La
  construction publiée n'emporte pas cette ligne.

  On juge sur le MODE, pas sur `import.meta.env.DEV` : cet indicateur suit
  `NODE_ENV`, qui vaut « production » dans l'environnement des agents — le
  serveur de développement se retrouvait alors sans son point d'essai.
*/
if (import.meta.env.MODE !== 'production') {
  (window as unknown as { belugaEssai?: unknown }).belugaEssai = {
    // L'affichage brut : ce point d'essai juge la PILE, pas ce qui mérite d'y
    // entrer (le tri des trois motifs a ses propres contrôles).
    message: (level: Toast['level'], text: string) => client.afficherMessage(level, text),
    // Un geste refusé, tel que le rend une commande : c'est ce qui permet de
    // juger POUR DE VRAI qu'une requête isolée restée sans réponse n'allume
    // aucune alerte, alors qu'un vrai refus, lui, se dit toujours.
    refus: (raison: string, cardId?: string) => client.signalerRefus(raison, cardId),
    // Une annonce vocale, comme le démon en émet à la fin d'une tâche : c'est
    // ce qui permet de juger le module de voix sans attendre un vrai agent.
    annonce: (texte: string) =>
      client.handleEssai({
        type: 'notify',
        title: 'Vérification',
        body: texte,
        motif: 'tache-terminee',
        voix: texte,
      }),
    // Un plan écrit par un agent, sans attendre un vrai tour d'écriture :
    // permet de juger le cadre et ses deux boutons pour de vrai, sur le
    // fil d'un agent RÉEL (les boutons, eux, envoient un vrai message).
    // `enEcriture` rejoue le défaut réparé : un message encore en cours
    // d'écriture ne doit ouvrir NI cadre NI boutons, si tôt qu'un moteur y ait
    // déjà posé le drapeau (`cadreDePlanVisible`).
    plan: (agentId: string, content: string, options?: { enEcriture?: boolean; id?: string }) => {
      const message: Message = {
        id: options?.id ?? `essai-${Math.random().toString(36).slice(2)}`,
        agentId,
        role: 'assistant',
        content,
        steps: [],
        todos: [],
        proposals: [],
        questions: [],
        downloads: [],
        attachments: [],
        streaming: !!options?.enEcriture,
        plan: true,
        createdAt: Date.now(),
      };
      client.handleEssai({ type: 'message.upsert', message });
    },
    /*
     * UNE RÉPONSE FINALE D'AGENT, sans attendre un vrai tour : le même message
     * que ci-dessus, mais SANS le drapeau `plan` — c'est ce qui permet de
     * juger le flux vertical du compte rendu (`RapportEnFlux`) pour de vrai.
     */
    rapport: (agentId: string, content: string, options?: { enEcriture?: boolean; id?: string }) => {
      const message: Message = {
        id: options?.id ?? `essai-${Math.random().toString(36).slice(2)}`,
        agentId,
        role: 'assistant',
        content,
        steps: [],
        todos: [],
        proposals: [],
        questions: [],
        downloads: [],
        attachments: [],
        streaming: !!options?.enEcriture,
        plan: false,
        texteLibreAnnulee: false,
        createdAt: Date.now(),
      };
      client.handleEssai({ type: 'message.upsert', message });
    },
    /*
     * UNE RÉPONSE QUI PORTE DES CAPTURES, sans attendre un vrai tour : les
     * pièces jointes désignées (déjà connues du démon) sont posées sur un
     * message d'agent, ce qui permet de juger la bande « Ce que l'agent a vu »
     * et le feuilletage de l'aperçu dans un vrai navigateur.
     */
    captures: (agentId: string | null, idsJointes: string[], options?: { id?: string }) => {
      // Sans agent donné : celui de la carte ouverte à l'écran.
      const agentCible = agentId ?? Object.values(client.lireEtat().cardMessages)[0]?.activeAgentId;
      if (!agentCible) return false;
      const message: Message = {
        id: options?.id ?? `essai-${Math.random().toString(36).slice(2)}`,
        agentId: agentCible,
        role: 'assistant',
        content: '',
        steps: [],
        todos: [],
        proposals: [],
        questions: [],
        downloads: [],
        attachments: idsJointes,
        streaming: false,
        plan: false,
        texteLibreAnnulee: false,
        createdAt: Date.now(),
      };
      client.handleEssai({ type: 'message.upsert', message });
      return true;
    },
    /*
     * Un RÉGLAGE DE PROJET posé par le canal, sans passer par le serveur : c'est
     * ce qui permet de juger le THÈME PROPRE À UN PROJET dans un vrai navigateur
     * alors que le démon en service, construit avant ce champ, le retire du bloc
     * qu'il envoie (Zod écarte les clés qu'il ne connaît pas). Sans ce point, il
     * faudrait redémarrer le démon pour vérifier une couleur.
     */
    projet: (projectId: string, patch: Record<string, unknown>) => {
      const projet = client.lireEtat().projects.find((candidat) => candidat.id === projectId);
      if (!projet) return false;
      client.handleEssai({ type: 'project.upsert', project: { ...projet, ...patch } as typeof projet });
      return true;
    },
    /* L'ÉTAT D'UN AGENT, habillé sans moteur : un démon d'essai remet au
       repos un agent « au travail » qu'aucun processus ne porte, et le suivi
       de l'initialisation de la production doit pourtant se voir. */
    agent: (agentId: string, patch: Record<string, unknown>) => {
      const agent = client.lireEtat().agents[agentId];
      if (!agent) return false;
      client.handleEssai({ type: 'agent.upsert', agent: { ...agent, ...patch } as typeof agent });
      return true;
    },
    /*
     * LE MAGASIN A-T-IL REÇU LA VRAIE RÉPONSE DU SERVEUR ?
     *
     * Les points d'essai existent dès que les modules sont chargés, bien avant
     * le premier message du canal : un contrôle qui partirait aussitôt lirait
     * « aucun projet » et « aucun réglage » — non pas un défaut, seulement une
     * page qui n'a pas fini d'arriver. On expose donc l'état d'attente lui-même
     * plutôt que de laisser deviner par un délai.
     */
    pret: () => client.lireEtat().pret,
    /** Les projets connus, pour désigner celui qu'on veut ouvrir. */
    projets: () =>
      client.lireEtat().projects.map((projet) => ({ id: projet.id, name: projet.name })),
    ouvrirProjet: (projectId: string) => client.setActiveProject(projectId),
    /*
     * UN RÉGLAGE POSÉ COMME LE SERVEUR LE POSE, sans passer par le réseau : le
     * bloc de réglages ARRIVE en entier et REMPLACE le précédent. C'est ce qui
     * permet de rejouer, dans un vrai navigateur, une réponse à laquelle il
     * MANQUE une clé — le cas qui faisait retomber l'apparence sur son défaut.
     */
    reglages: (prefs: Record<string, unknown>) => client.handleEssai({ type: 'prefs', prefs }),
    /** Le bloc en vigueur, pour le remettre en partant. */
    reglagesActuels: () => ({ ...client.lireEtat().prefs }),
    /*
     * UN TOUR D'AGENT QUI ÉTABLIT UNE MARCHE À SUIVRE, tel que le serveur le
     * diffuse — sans en payer un vrai. Établir une procédure coûte un tour
     * d'agent complet (une à deux minutes de lecture du projet) : un contrôle
     * qui en déclencherait un à chaque passage dépenserait du quota pour
     * regarder une liste d'étapes se cocher. On rejoue donc l'état diffusé ET
     * les étapes annoncées sur le message de l'agent, les deux sources que la
     * rubrique lit réellement.
     */
    procedure: (
      projectId: string,
      cible: CiblePublication,
      etat: EtatProcedure | null,
      steps?: Message['steps'],
    ) => {
      if (etat?.agentId && steps) {
        client.handleEssai({
          type: 'message.upsert',
          message: {
            id: `essai-procedure-${etat.agentId}`,
            agentId: etat.agentId,
            role: 'assistant',
            content: '',
            steps,
            todos: [],
            proposals: [],
            questions: [],
            downloads: [],
            attachments: [],
            streaming: true,
            texteLibreAnnulee: false,
            createdAt: Date.now(),
          } as Message,
        });
      }
      client.majProcedure(projectId, cible, etat);
      return true;
    },
    /*
     * UNE RECONNEXION DU CANAL, telle que le magasin la vit : le message
     * d'accueil revient et réhydrate tout. `sansReglages` et `sansProjets`
     * rejouent les deux réponses appauvries qu'une reconnexion peut produire —
     * ni l'une ni l'autre ne doit changer l'apparence.
     */
    reconnexion: (options?: { sansReglages?: boolean; sansProjets?: boolean }) => {
      const etat = client.lireEtat();
      if (!etat.settings) return false;
      client.handleEssai({
        type: 'ready',
        protocol: 1,
        version: etat.version,
        studioOuvert: etat.studioOuvert,
        offreHebergee: etat.offreHebergee,
        role: etat.monRole,
        settings: etat.settings,
        prefs: options?.sansReglages ? {} : etat.prefs,
        projects: options?.sansProjets ? [] : etat.projects,
        groups: etat.groups,
        engines: etat.engines,
        quotas: [...etat.quotas, ...etat.quotasSuivi],
        capacity: etat.capacity,
        agents: Object.values(etat.agents),
      } as ServerEvent);
      return true;
    },
  };
}
