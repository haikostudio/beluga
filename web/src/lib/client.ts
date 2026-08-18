import {
  AccountQuota,
  Agent,
  Attachment,
  CapacitySnapshot,
  Card,
  ClientCommand,
  ConnexionCompte,
  DecisionAttendue,
  CiblePublication,
  DeployRun,
  EngineInfo,
  EtatDuPool,
  EtatProcedure,
  FileNode,
  Message,
  Project,
  ProjectGroup,
  QueuedPrompt,
  ServerEvent,
  Settings,
  SystemProcess,
  CLE_PROJET_ACTIF,
  DUREE_MESSAGE_MS,
  EVENEMENT_ATTENTE_LONGUE,
  RAISON_SANS_REPONSE,
  messageAlerte,
  motDAttenteLongue,
  alerteServeurInjoignable,
  choisirProjetAOuvrir,
  projetsADecharger,
} from '@haikodev/shared';
import { t } from '@/lib/langue';

export interface Toast {
  id: string;
  level: 'info' | 'success' | 'warning' | 'error';
  text: string;
  cardId?: string;
  at: number;
}

export interface AppState {
  connected: boolean;
  connecting: boolean;
  /**
   * Le premier état complet du serveur (`ready`) est-il arrivé ? Tant qu'il
   * manque, la liste des projets est vide SANS qu'aucun projet ne manque : on
   * montre des SILHOUETTES de contenu, jamais « Aucun projet inscrit ».
   */
  pret: boolean;
  /**
   * Les projets dont les cartes sont réellement arrivées (`project.snapshot`).
   * Un tableau qui n'est pas encore dans cette liste attend ses cartes : il
   * affiche des silhouettes, pas des colonnes vides. Un projet déchargé après
   * quinze minutes en sort, et redevient donc « en chargement » à sa
   * réouverture.
   */
  cartesChargees: Record<string, boolean>;
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
  /** Projets dont un agent a rendu son travail sans qu'on l'ait encore lu. */
  rendus: Record<string, number>;
  /** Projets où un plan proposé (mode plan) attend encore une décision. */
  plans: Record<string, boolean>;
  /**
   * Les colonnes dont le personnage a été REMPLACÉ dans les réglages, et
   * l'instant de ce remplacement. Une colonne absente garde le personnage
   * d'origine. Le tableau s'en sert pour redemander l'image au serveur au lieu
   * de ressortir celle de son cache.
   */
  personnages: Record<string, number>;
  engines: EngineInfo[];
  /**
   * LE POOL DE COMPÉTENCES, quand le démon vient de le diffuser (une fiche
   * écrite, complétée, dépréciée). Nul tant que rien n'a changé : l'écran des
   * réglages le demande lui-même à l'ouverture.
   */
  pool: EtatDuPool | null;
  quotas: AccountQuota[];
  /** Les connexions de comptes en cours ou tout juste finies. */
  connexions: ConnexionCompte[];
  capacity: CapacitySnapshot | null;
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
  messages: Record<string, Message[]>;
  /** Toute la conversation d'une carte, tous ses agents confondus. */
  cardMessages: Record<string, { messages: Message[]; activeAgentId?: string }>;
  queues: Record<string, QueuedPrompt[]>;
  /** Échanges mis de côté par un « repartir de zéro », par agent. */
  precedents: Record<string, number>;
  attachments: Record<string, Attachment[]>;
  files: Record<string, FileNode[]>;
  memory: Record<string, string>;
  deploys: Record<string, DeployRun>;
  /**
   * Les dialogues de PROCÉDURE en cours, par `projet:cible`. Ils viennent du
   * serveur, qui les diffuse à chaque changement : le tiroir n'attend donc plus
   * la réponse d'une requête retenue pendant tout le tour — il suit, et il se
   * rattrape après une coupure.
   */
  procedures: Record<string, EtatProcedure>;
  activeProjectId: string | null;
  toasts: Toast[];
}

const initialState: AppState = {
  connected: false,
  connecting: true,
  pret: false,
  cartesChargees: {},
  version: '',
  settings: null,
  prefs: {},
  projects: [],
  groups: [],
  attention: {},
  decisions: [],
  rendus: {},
  plans: {},
  personnages: {},
  engines: [],
  pool: null,
  quotas: [],
  connexions: [],
  capacity: null,
  processes: [],
  demon: null,
  agents: {},
  cards: {},
  messages: {},
  cardMessages: {},
  queues: {},
  precedents: {},
  attachments: {},
  files: {},
  memory: {},
  deploys: {},
  procedures: {},
  activeProjectId: null,
  toasts: [],
};

type Listener = () => void;

class Client {
  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private retry = 0;
  private reconnectTimer: number | null = null;
  private notifyHandlers = new Set<(event: Extract<ServerEvent, { type: 'notify' }>) => void>();
  /*
   * L'état du LIEN avec le serveur, tel que la règle `alerteServeurInjoignable`
   * le demande : depuis quand le canal est coupé, et combien de requêtes
   * d'affilée sont restées sans réponse. Deux compteurs, pas un état affiché :
   * ils ne servent qu'à décider si l'alerte rouge a le droit de paraître.
   */
  private coupeDepuis: number | null = null;
  private echecsReseau = 0;
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

  state: AppState = initialState;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): AppState => this.state;

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
   * aucune carte (une carte proposée, une question du chef d'orchestre).
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
  allerVersDecision(lieu: { projectId?: string; cardId?: string; agentId?: string }): void {
    if (lieu.projectId) this.setActiveProject(lieu.projectId);
    if (lieu.cardId) this.openCard(lieu.cardId);
    else if (lieu.agentId && lieu.projectId) this.openConversation({ projectId: lieu.projectId, agentId: lieu.agentId });
  }

  private set(patch: Partial<AppState> | ((current: AppState) => Partial<AppState>)): void {
    const next = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }

  connect(): void {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.lancerLaVeilleDeDechargement();
    this.set({ connecting: true });
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${location.host}/ws`);
    this.socket = socket;

    socket.onopen = () => {
      this.retry = 0;
      this.coupeDepuis = null;
      this.echecsReseau = 0;
      this.set({ connected: true, connecting: false });
      this.send({ type: 'hello', protocol: 1 });
      this.lancerLeBattement(socket);
    };

    socket.onclose = () => {
      this.arreterLeBattement();
      // L'HEURE de la coupure, posée une seule fois : c'est sa DURÉE qui
      // distingue une reconnexion ordinaire d'une vraie panne.
      if (this.coupeDepuis == null) this.coupeDepuis = Date.now();
      this.set({ connected: false, connecting: true });
      // Reconnexion automatique : fermer l'onglet n'arrête aucun agent, et le
      // réseau qui tombe ne doit pas casser la session.
      this.retry = Math.min(this.retry + 1, 8);
      const delay = Math.min(500 * 2 ** this.retry, 12000);
      if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
    };

    socket.onerror = () => socket.close();

    socket.onmessage = (event) => {
      let parsed: ServerEvent;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      this.handle(parsed);
    };
  }

  /**
   * Rejoue un événement de serveur comme s'il venait d'arriver. Réservé au point
   * d'essai de développement (bas de ce fichier) : un script de vérification
   * peut ainsi provoquer une annonce sans faire tourner un vrai agent.
   */
  handleEssai(event: ServerEvent): void {
    this.handle(event);
  }

  private lancerLeBattement(socket: WebSocket): void {
    this.battement = window.setInterval(() => {
      if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) return;
      this.call({ type: 'ping' }, 8000).catch(() => {
        // Pas de réponse en 8 s sur un canal qui se dit pourtant ouvert : un
        // canal zombie. Le fermer nous-mêmes déclenche `onclose`, donc la
        // reconnexion déjà prévue — sans ce geste, plus aucun événement
        // (dont la fin d'un tour) n'atteindra jamais ce client.
        if (this.socket === socket) socket.close();
      });
    }, 20000);
  }

  private arreterLeBattement(): void {
    if (this.battement != null) window.clearInterval(this.battement);
    this.battement = null;
  }

  private handle(event: ServerEvent): void {
    switch (event.type) {
      case 'ready': {
        const prefs = event.prefs ?? {};
        // On rouvre sur le dernier projet consulté, retenu en base. S'il a été
        // archivé ou supprimé, on retombe sans bruit sur le premier de la liste.
        const choix = choisirProjetAOuvrir(event.projects, prefs[CLE_PROJET_ACTIF], this.state.activeProjectId);
        this.set({
          pret: true,
          version: event.version,
          settings: event.settings,
          prefs,
          projects: event.projects,
          groups: event.groups ?? [],
          engines: event.engines,
          quotas: event.quotas,
          capacity: event.capacity,
          agents: Object.fromEntries(event.agents.map((agent) => [agent.id, agent])),
          activeProjectId: choix.id,
        });
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

      case 'plans':
        this.set({ plans: event.byProject });
        break;

      case 'personnages':
        this.set({ personnages: event.remplaces });
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

      case 'project.snapshot':
        this.set((state) => ({
          cards: {
            ...Object.fromEntries(Object.entries(state.cards).filter(([, card]) => card.projectId !== event.projectId)),
            ...Object.fromEntries(event.cards.map((card) => [card.id, card])),
          },
          agents: { ...state.agents, ...Object.fromEntries(event.agents.map((agent) => [agent.id, agent])) },
          deploys: event.deploy ? { ...state.deploys, [event.projectId]: event.deploy } : state.deploys,
          memory: event.memory !== undefined ? { ...state.memory, [event.projectId]: event.memory } : state.memory,
          // Les cartes de ce projet sont là : le tableau peut cesser de montrer
          // ses silhouettes, et dire un vrai « aucune carte » s'il est vide.
          cartesChargees: { ...state.cartesChargees, [event.projectId]: true },
        }));
        break;

      case 'card.upsert':
        this.set((state) => ({ cards: { ...state.cards, [event.card.id]: event.card } }));
        break;

      case 'card.delete':
        this.set((state) => {
          const cards = { ...state.cards };
          delete cards[event.id];
          return { cards };
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

      case 'agent.snapshot':
        this.set((state) => ({
          messages: { ...state.messages, [event.agentId]: event.messages },
          queues: { ...state.queues, [event.agentId]: event.queue },
          precedents: { ...state.precedents, [event.agentId]: event.precedents ?? 0 },
        }));
        break;

      case 'card.conversation':
        this.set((state) => ({
          cardMessages: {
            ...state.cardMessages,
            [event.cardId]: { messages: event.messages, activeAgentId: event.activeAgentId },
          },
        }));
        break;

      case 'message.upsert':
        this.set((state) => {
          const list = state.messages[event.message.agentId] ?? [];
          const index = list.findIndex((m) => m.id === event.message.id);
          const next = index >= 0 ? [...list] : [...list, event.message];
          if (index >= 0) next[index] = event.message;

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
            if (position >= 0) liste[position] = event.message;
            else liste.push(event.message);
            cardMessages[cardId] = { ...entry, messages: liste };
          }

          return { messages: { ...state.messages, [event.message.agentId]: next }, cardMessages };
        });
        break;

      case 'queue.snapshot':
        this.set((state) => ({ queues: { ...state.queues, [event.agentId]: event.queue } }));
        break;

      case 'deploy.upsert':
        this.set((state) => ({ deploys: { ...state.deploys, [event.run.projectId]: event.run } }));
        break;

      // Le dialogue d'une procédure a bougé : tour parti, question posée,
      // procédure écrite, tour tombé. Le tiroir n'a rien à demander pour le
      // savoir — et deux tiroirs ouverts voient exactement la même chose.
      case 'procedure':
        this.majProcedure(event.etat.projectId, event.etat.cible, event.etat);
        break;

      case 'quotas':
        this.set({ quotas: event.quotas });
        break;

      // Après une connexion de compte réussie, la liste des modèles redevient
      // complète sans qu'on ait à recharger la page.
      case 'engines':
        this.set({ engines: event.engines });
        break;

      case 'competences':
        this.set({ pool: event.pool });
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
        this.set({ settings: event.settings });
        break;

      case 'prefs':
        this.set({ prefs: event.prefs });
        break;

      case 'attachments':
        this.set((state) => ({ attachments: { ...state.attachments, [event.projectId]: event.items } }));
        break;

      case 'files':
        this.set((state) => ({ files: { ...state.files, [`${event.projectId}:${event.path}`]: event.nodes } }));
        break;

      case 'memory':
        if (event.content) {
          this.set((state) => ({ memory: { ...state.memory, [event.projectId]: event.content } }));
        }
        break;

      case 'toast':
        this.pushToast(event.level, event.text, event.cardId, event.motif);
        break;

      case 'notify':
        for (const handler of this.notifyHandlers) handler(event);
        break;

      default:
        break;
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
    this.set((state) => ({ toasts: [...state.toasts.slice(-5), toast] }));
    this.armerToast(toast.id, DUREE_MESSAGE_MS);
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

  send(cmd: ClientCommand): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ cmd }));
    }
  }

  call<T = any>(cmd: ClientCommand, timeoutMs = 120000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.socket?.readyState !== WebSocket.OPEN) {
        reject(new Error(t('non connecté')));
        return;
      }
      const id = Math.random().toString(36).slice(2);
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, cmd }));
      window.setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          // Une requête qui expire compte, mais ne conclut rien à elle seule :
          // un lancement de carte ne répond qu'À LA FIN du tour. C'est
          // `alerteServeurInjoignable` qui dira si cela vaut une alerte.
          this.echecsReseau += 1;
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

  setActiveProject(id: string | null): void {
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
    }
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
    const oublies = projetsADecharger({
      vuA: Object.fromEntries(this.vuA),
      projetAffiche: this.state.activeProjectId,
      maintenant,
    });
    if (!oublies.length) return [];
    for (const id of oublies) this.vuA.delete(id);
    const aOublier = new Set(oublies);
    this.set((state) => ({
      cards: Object.fromEntries(
        Object.entries(state.cards).filter(([, carte]) => !aOublier.has(carte.projectId)),
      ),
      // Un projet déchargé n'a plus ses cartes : sa réouverture doit remontrer
      // des silhouettes, pas un tableau qu'on croirait vide.
      cartesChargees: Object.fromEntries(
        Object.entries(state.cartesChargees).filter(([id]) => !aOublier.has(id)),
      ),
    }));
    return oublies;
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
    this.setActiveProject(choix.id);
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
  (window as unknown as { haikodevEssai?: unknown }).haikodevEssai = {
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
     * Un RÉGLAGE DE PROJET posé par le canal, sans passer par le serveur : c'est
     * ce qui permet de juger le THÈME PROPRE À UN PROJET dans un vrai navigateur
     * alors que le démon en service, construit avant ce champ, le retire du bloc
     * qu'il envoie (Zod écarte les clés qu'il ne connaît pas). Sans ce point, il
     * faudrait redémarrer le démon pour vérifier une couleur.
     */
    projet: (projectId: string, patch: Record<string, unknown>) => {
      const projet = client.getSnapshot().projects.find((candidat) => candidat.id === projectId);
      if (!projet) return false;
      client.handleEssai({ type: 'project.upsert', project: { ...projet, ...patch } as typeof projet });
      return true;
    },
    /** Le projet ouvert, pour désigner celui qu'on veut habiller. */
    projets: () =>
      client.getSnapshot().projects.map((projet) => ({ id: projet.id, name: projet.name, theme: projet.theme })),
    ouvrirProjet: (projectId: string) => client.setActiveProject(projectId),
  };
}
