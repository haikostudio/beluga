import {
  AccountQuota,
  Agent,
  Attachment,
  CapacitySnapshot,
  Card,
  ClientCommand,
  ConnexionCompte,
  DecisionAttendue,
  DeployRun,
  EngineInfo,
  FileNode,
  Message,
  Project,
  ProjectGroup,
  QueuedPrompt,
  ServerEvent,
  Settings,
  SystemProcess,
  CLE_PROJET_ACTIF,
  choisirProjetAOuvrir,
} from '@haikodev/shared';

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
  engines: EngineInfo[];
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
  activeProjectId: string | null;
  toasts: Toast[];
}

const initialState: AppState = {
  connected: false,
  connecting: true,
  version: '',
  settings: null,
  prefs: {},
  projects: [],
  groups: [],
  attention: {},
  decisions: [],
  rendus: {},
  engines: [],
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

  private set(patch: Partial<AppState> | ((current: AppState) => Partial<AppState>)): void {
    const next = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }

  connect(): void {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.set({ connecting: true });
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${location.host}/ws`);
    this.socket = socket;

    socket.onopen = () => {
      this.retry = 0;
      this.set({ connected: true, connecting: false });
      this.send({ type: 'hello', protocol: 1 });
    };

    socket.onclose = () => {
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

  private handle(event: ServerEvent): void {
    switch (event.type) {
      case 'ready': {
        const prefs = event.prefs ?? {};
        // On rouvre sur le dernier projet consulté, retenu en base. S'il a été
        // archivé ou supprimé, on retombe sans bruit sur le premier de la liste.
        const choix = choisirProjetAOuvrir(event.projects, prefs[CLE_PROJET_ACTIF], this.state.activeProjectId);
        this.set({
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
          this.send({ type: 'project.open', id: choix.id });
          this.send({ type: 'attachments.list', projectId: choix.id });
          if (choix.aCorriger) this.retenirProjetActif(choix.id);
        }
        break;
      }

      case 'ack': {
        const entry = this.pending.get(event.id);
        if (entry) {
          this.pending.delete(event.id);
          if (event.ok) entry.resolve(event.data);
          else entry.reject(new Error(event.error ?? 'commande refusée'));
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

      case 'project.snapshot':
        this.set((state) => ({
          cards: {
            ...Object.fromEntries(Object.entries(state.cards).filter(([, card]) => card.projectId !== event.projectId)),
            ...Object.fromEntries(event.cards.map((card) => [card.id, card])),
          },
          agents: { ...state.agents, ...Object.fromEntries(event.agents.map((agent) => [agent.id, agent])) },
          deploys: event.deploy ? { ...state.deploys, [event.projectId]: event.deploy } : state.deploys,
          memory: event.memory !== undefined ? { ...state.memory, [event.projectId]: event.memory } : state.memory,
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

      case 'quotas':
        this.set({ quotas: event.quotas });
        break;

      // Après une connexion de compte réussie, la liste des modèles redevient
      // complète sans qu'on ait à recharger la page.
      case 'engines':
        this.set({ engines: event.engines });
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
        this.pushToast(event.level, event.text, event.cardId);
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

  pushToast(level: Toast['level'], text: string, cardId?: string): void {
    const toast: Toast = { id: Math.random().toString(36).slice(2), level, text, cardId, at: Date.now() };
    this.set((state) => ({ toasts: [...state.toasts.slice(-5), toast] }));
    // Les messages courts disparaissent seuls ; les erreurs attendent d'être lues.
    if (level !== 'error') {
      window.setTimeout(() => this.dismissToast(toast.id), 4200);
    }
  }

  dismissToast(id: string): void {
    this.set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
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
        reject(new Error('non connecté'));
        return;
      }
      const id = Math.random().toString(36).slice(2);
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, cmd }));
      window.setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('le serveur ne répond pas'));
        }
      }, timeoutMs);
    });
  }

  setActiveProject(id: string | null): void {
    this.set({ activeProjectId: id });
    if (id) {
      this.send({ type: 'project.open', id });
      this.send({ type: 'attachments.list', projectId: id });
      this.retenirProjetActif(id);
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
   * Valider une carte de « À faire » : le geste qui autorise la dépense et
   * lance l'analyse. La carte ne change pas de colonne — elle reste sur place,
   * marquée « chiffrage en cours », et le serveur y pose les chiffres
   * quand ils sont là. Même forme de réponse que `moveCard` : le pied
   * de lot s'en sert exactement pareil.
   */
  async validerCarte(card: Card, options: { silencieux?: boolean } = {}): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.call({ type: 'card.validate', id: card.id });
      return { ok: true };
    } catch (err: any) {
      const raison = err?.message ?? 'validation refusée';
      if (!options.silencieux) this.pushToast('error', raison, card.id);
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
      const raison = err?.message ?? 'déplacement refusé';
      this.set((state) => {
        const fraiche = state.cards[card.id];
        if (!fraiche) return {};
        return { cards: { ...state.cards, [card.id]: { ...fraiche, column: colonneDeDepart } } };
      });
      if (!options.silencieux) this.pushToast('error', raison, card.id);
      return { ok: false, error: raison };
    }
  }
}

export const client = new Client();

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
    message: (level: Toast['level'], text: string) => client.pushToast(level, text),
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
  };
}
