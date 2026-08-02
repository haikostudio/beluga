import { EngineId, ThinkingLevel } from '@haikodev/shared';

export interface EngineEvent {
  kind: 'session' | 'text' | 'step' | 'usage' | 'ratelimit' | 'error' | 'done';
  /** kind=session */
  sessionId?: string;
  /** kind=text : fragment de réponse */
  text?: string;
  /** kind=step : une étape de la liste d'exécution, format unique entre moteurs */
  step?: { key: string; label: string; state: 'running' | 'done' | 'failed'; detail?: string };
  /** kind=usage */
  usage?: { inputTokens: number; outputTokens: number; cachedTokens?: number; costUsd?: number; durationMs?: number; turns?: number };
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
  /** Chemin d'un fichier de configuration MCP (outils du démon). */
  mcpConfigPath?: string;
  /** Accès complet : agents de tâche. Le chef d'orchestre, lui, reste bridé. */
  fullAccess: boolean;
  allowedTools?: string[];
  disallowedTools?: string[];
  env?: Record<string, string>;
  onEvent: (event: EngineEvent) => void;
}

export interface EngineHandle {
  pid?: number;
  stop: () => void;
  finished: Promise<{ ok: boolean; error?: string }>;
}

export interface EngineAdapter {
  id: EngineId;
  label: string;
  binary: string;
  detect: () => Promise<{ installed: boolean; version?: string }>;
  models: () => Promise<unknown[]>;
  defaultModel: string;
  run: (options: EngineRunOptions) => EngineHandle;
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
        return { label: map[short] ?? `Outil ${short}`, detail: JSON.stringify(input ?? {}).slice(0, 200) };
      }
      return { label: `Outil ${tool}`, detail: input ? JSON.stringify(input).slice(0, 200) : undefined };
  }
}
