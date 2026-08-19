import { EngineId, RoleDAgent, ThinkingLevel, TodoItem } from '@haikodev/shared';

export interface EngineEvent {
  kind: 'session' | 'text' | 'step' | 'todo' | 'usage' | 'context' | 'compaction' | 'ratelimit' | 'error' | 'done';
  /** kind=session */
  sessionId?: string;
  /** kind=text : fragment de réponse */
  text?: string;
  /** kind=step : une étape de la liste d'exécution, format unique entre moteurs */
  step?: { key: string; label: string; state: 'running' | 'done' | 'failed'; detail?: string };
  /** kind=todo : la liste de tâches annoncée par l'agent, entière à chaque fois */
  todos?: TodoItem[];
  /** kind=usage */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cachedTokens?: number;
    /** Jetons présents dans le contexte courant, distincts du cumul facturé du tour. */
    contextTokens?: number;
    /** Capacité annoncée par l'événement lui-même, quand le moteur la fournit. */
    contextWindow?: number;
    costUsd?: number;
    durationMs?: number;
    turns?: number;
  };
  /** kind=context : taille du DERNIER appel, jamais le total facturé. */
  context?: { tokens: number; window?: number };
  /** kind=compaction : résultat de la fonction native du moteur. */
  compaction?: { ok: boolean; error?: string };
  /** kind=ratelimit */
  rateLimit?: { status: string; resetsAt?: number; type?: string };
  /** kind=error | done */
  error?: string;
  exitCode?: number;
}

export interface EngineRunOptions {
  cwd: string;
  prompt: string;
  model?: string;
  thinking?: ThinkingLevel;
  /** Reprise de conversation : identifiant de session du moteur. */
  sessionId?: string | null;
  systemPrompt?: string;
  /**
   * Le rappel court des consignes, pour les moteurs qui ne recollent PAS leur
   * consigne système à chaque tour. Claude Code la repasse lui-même par
   * `--append-system-prompt` ; Codex ne l'a qu'au premier message du fil, donc
   * son déroulé s'effaçait au fil de la conversation.
   */
  systemPromptRappel?: string;
  /** Chemin d'un fichier de configuration MCP (outils du démon), au format de Claude Code. */
  mcpConfigPath?: string;
  /**
   * Chemin du PONT d'outils lui-même (script Node). Codex ne lit pas de fichier
   * de configuration : il reçoit la commande à lancer, donc il lui faut le
   * script, jamais le fichier de configuration.
   */
  mcpBridgePath?: string;
  /**
   * Chemin du GARDE DU DÉMON (script Node) : posé devant chaque commande d'un
   * agent, il refuse celles qui pourraient couper le serveur ou un moteur au
   * travail (`shared/src/garde-demon.ts`).
   */
  gardeDuDemonPath?: string;
  /** Accès complet : agents de tâche. Le chef d'orchestre, lui, reste bridé. */
  fullAccess: boolean;
  /**
   * Mode plan : l'agent réfléchit et propose SANS modifier un fichier ni lancer
   * de commande d'écriture, quel que soit `fullAccess`. Priorité absolue sur le
   * bac à sable habituel — voir `buildClaudeArgs` / `buildCodexArgs`.
   *
   * EXCEPTION, le chef d'orchestre : sa frontière est déjà posée par son bac à
   * sable (projet en lecture seule) et par ses listes d'outils. Fermer en plus
   * l'écriture au niveau du moteur ne protégeait rien et lui retirait ses
   * propres outils — écrire son plan, poser une question
   * (`modePlanFermeLEcriture`, `shared/src/droits-mode-plan.ts`).
   */
  mode?: 'direct' | 'plan';
  /** Le rôle de l'agent : c'est lui qui décide de l'effet du mode plan. */
  role?: RoleDAgent;
  allowedTools?: string[];
  disallowedTools?: string[];
  /**
   * La racine du PROJET, montée en LECTURE SEULE pour un chef bridé. Son `cwd`
   * (ci-dessus) est un dossier de travail à part, le seul écrivable ; le projet,
   * lui, se lit sans se modifier. Claude l'ajoute à sa portée par `--add-dir` ;
   * Codex lit partout depuis son bac à sable `workspace-write`. Absent pour un
   * agent de tâche, qui travaille directement dans le projet.
   */
  projectRoot?: string;
  env?: Record<string, string>;
  /**
   * PLAFOND DE DURÉE, en millisecondes. Réservé aux appels de SERVICE passés
   * autour d'un tour — compression du fil, mesure de la session, relance d'un
   * plan incomplet : aucun d'eux ne doit retenir la barre d'écriture, et l'un
   * d'eux resté pendu laissait l'agent « au travail » pour des heures. Le tour
   * lui-même n'en porte JAMAIS : un agent a le droit de réfléchir longtemps.
   */
  plafondMs?: number;
  /**
   * LE MOTEUR QUI VIENT DE PARTIR SE FAIT CONNAÎTRE.
   *
   * Appelé par l'adaptateur juste après le lancement, avec la poignée du
   * processus. Sans lui, seul le moteur du TOUR était suivi : ceux des appels de
   * SERVICE — compression du fil, relance d'un plan incomplet — tournaient hors
   * de toute vue, et le bouton d'arrêt ne pouvait pas les couper. Un agent
   * qu'on arrêtait pendant sa compression gardait donc un moteur en marche.
   */
  surLancement?: (handle: EngineHandle) => void;
  onEvent: (event: EngineEvent) => void;
}

/**
 * CE QUE REND UN TOUR DE MOTEUR — et notamment s'il a seulement eu lieu.
 *
 * `jamaisDemarre` est un SIGNAL EXPLICITE, rendu par l'adaptateur, qui est le
 * seul à savoir : il a lu (ou pas) le flux du moteur. Il vaut « vrai » quand le
 * processus s'est terminé sans qu'une SEULE ligne de protocole n'en soit sortie
 * — binaire introuvable, lancement refusé, réseau coupé avant le premier mot.
 *
 * Le démon en déduisait la même chose par un faisceau d'ABSENCES : pas
 * d'étape, pas de texte, pas de liste de tâches. Ce faisceau se trompait à
 * chaque fois qu'un moteur parlait sans rien produire de visible — c'est
 * exactement ainsi qu'une liste de tâches annoncée puis un plantage passaient
 * pour « jamais joint », renvoyant la carte en « Planifié » pour une relance
 * de zéro. Le signal remplace la déduction ; l'ancien faisceau ne sert plus
 * que de repli pour un adaptateur qui ne dirait rien.
 */
export interface ResultatDuMoteur {
  ok: boolean;
  error?: string;
  jamaisDemarre?: boolean;
}

export interface EngineHandle {
  pid?: number;
  stop: () => void;
  finished: Promise<ResultatDuMoteur>;
}

export interface EngineAdapter {
  id: EngineId;
  label: string;
  binary: string;
  detect: () => Promise<{ installed: boolean; version?: string }>;
  models: () => Promise<unknown[]>;
  defaultModel: string;
  run: (options: EngineRunOptions) => EngineHandle;
  /** Compression native d'une session, quand le moteur l'expose. */
  compact?: (options: EngineRunOptions) => Promise<{ ok: boolean; context?: { tokens: number; window?: number }; error?: string }>;
}

/** Additionne seulement des nombres réellement présents : aucune valeur reçue ne devient zéro. */
export function sommeContexte(...valeurs: unknown[]): number | undefined {
  const presentes = valeurs.filter((valeur): valeur is number => typeof valeur === 'number' && Number.isFinite(valeur));
  return presentes.length ? presentes.reduce((total, valeur) => total + valeur, 0) : undefined;
}

/**
 * Traduit la liste de tâches d'un moteur en un format unique. Chaque moteur a
 * son vocabulaire (Claude : content/status ; Codex : step/text + completed) ;
 * l'interface, elle, n'en connaît qu'un seul.
 */
export function normalizeTodos(raw: unknown): TodoItem[] {
  if (!Array.isArray(raw)) return [];
  const todos: TodoItem[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string') {
      if (entry.trim()) todos.push({ label: entry.trim(), state: 'todo' });
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const label = ['content', 'step', 'text', 'label', 'title', 'task', 'description']
      .map((k) => (typeof item[k] === 'string' ? (item[k] as string) : ''))
      .find((value) => value.trim());
    if (!label) continue;

    const rawState = typeof item.status === 'string' ? item.status : typeof item.state === 'string' ? item.state : '';
    let state: TodoItem['state'] = 'todo';
    if (/^(completed|complete|done|finished)$/i.test(rawState) || item.completed === true) state = 'done';
    else if (/^(in_progress|in-progress|running|active|current)$/i.test(rawState)) state = 'running';

    todos.push({ label: label.trim().slice(0, 200), state });
  }
  return todos;
}

/** Traduit un nom d'outil brut en une étape lisible par un humain. */
export function humanStep(tool: string, input: Record<string, unknown> | undefined): { label: string; detail?: string } {
  const val = (k: string) => (input && typeof input[k] === 'string' ? (input[k] as string) : undefined);
  const shortPath = (p?: string) => (p ? p.split('/').slice(-2).join('/') : undefined);
  switch (tool) {
    case 'Read':
      return { label: `Lecture de ${shortPath(val('file_path')) ?? 'un fichier'}`, detail: val('file_path') };
    case 'Write':
      return { label: `Écriture de ${shortPath(val('file_path')) ?? 'un fichier'}`, detail: val('file_path') };
    case 'Edit':
    case 'NotebookEdit':
      return { label: `Modification de ${shortPath(val('file_path')) ?? 'un fichier'}`, detail: val('file_path') };
    case 'Bash': {
      const cmd = val('command') ?? '';
      const first = cmd.split('\n')[0].slice(0, 90);
      if (/^git (commit|add|push)/.test(cmd)) return { label: 'Enregistrement et sauvegarde', detail: cmd };
      if (/(npm|pnpm|yarn) (run )?(test|vitest|jest)/.test(cmd)) return { label: 'Lancement des tests', detail: cmd };
      if (/(npm|pnpm|yarn) (run )?build/.test(cmd)) return { label: 'Construction du projet', detail: cmd };
      return { label: `Commande : ${first}`, detail: cmd };
    }
    case 'Grep':
      return { label: `Recherche de « ${val('pattern')?.slice(0, 40) ?? '…'} »`, detail: val('pattern') };
    case 'Glob':
      return { label: `Recherche de fichiers ${val('pattern') ?? ''}`.trim(), detail: val('pattern') };
    case 'WebFetch':
    case 'WebSearch':
      return { label: 'Consultation du web', detail: val('url') ?? val('query') };
    case 'Task':
      return { label: 'Délégation à un sous-agent', detail: val('description') };
    case 'TodoWrite':
      return { label: 'Mise à jour du plan', detail: undefined };
    default:
      if (tool.startsWith('mcp__haikodev__')) {
        const short = tool.replace('mcp__haikodev__', '');
        const map: Record<string, string> = {
          board_list_cards: 'Lecture du tableau',
          board_create_card: 'Création d\'une carte',
          board_update_card: 'Modification d\'une carte',
          board_move_card: 'Déplacement d\'une carte',
          board_delete_card: 'Suppression d\'une carte',
          propose_task: 'Proposition d\'une tâche',
          write_document: 'Rédaction d\'un document',
          make_archive: 'Préparation d\'une archive',
          project_memory: 'Lecture de la mémoire du projet',
          remember: 'Mise à jour de la mémoire du projet',
        };
        // La mémoire ne part plus qu'en index : quand un agent va chercher le
        // TEXTE ENTIER d'un fait, l'étape dit sur quoi — sinon on lit « lecture
        // de la mémoire » sans savoir ce qu'il est allé y prendre.
        if (short === 'project_memory') {
          const sujet = val('sujet')?.trim();
          return {
            label: sujet ? `Mémoire du projet : le détail sur « ${sujet.slice(0, 60)} »` : 'Lecture de la mémoire du projet',
            detail: sujet,
          };
        }
        return { label: map[short] ?? `Outil ${short}`, detail: JSON.stringify(input ?? {}).slice(0, 200) };
      }
      return { label: `Outil ${tool}`, detail: input ? JSON.stringify(input).slice(0, 200) : undefined };
  }
}
