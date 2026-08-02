import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EngineAdapter, EngineEvent, EngineHandle, EngineRunOptions, humanStep, normalizeTodos } from './types.js';
import { log } from '../logger.js';

const execFileAsync = promisify(execFile);



export const codexAdapter: EngineAdapter = {
  id: 'codex',
  label: 'Codex',
  binary: process.env.HAIKODEV_CODEX_BIN || '/root/.local/bin/codex',
  defaultModel: 'gpt-5.1-codex',

  async detect() {
    try {
      const { stdout } = await execFileAsync(codexAdapter.binary, ['--version'], { timeout: 15000 });
      return { installed: true, version: stdout.trim().split('\n')[0] };
    } catch {
      return { installed: false };
    }
  },

  async models() {
    return [];
  },

  run(options: EngineRunOptions): EngineHandle {
    const args: string[] = ['exec', '--json', '--skip-git-repo-check', '-C', options.cwd];

    if (options.sessionId) {
      // Reprise de conversation : « exec resume <id> ».
      args.splice(1, 0, 'resume', options.sessionId);
    }
    if (options.model) args.push('-m', options.model);
    if (options.thinking && options.thinking !== 'none') {
      args.push('-c', `model_reasoning_effort="${options.thinking}"`);
    }
    if (options.fullAccess) {
      args.push('--dangerously-bypass-approvals-and-sandbox');
    } else {
      args.push('-s', 'read-only');
    }
    if (options.mcpConfigPath) {
      // Codex reçoit ses serveurs d'outils par surcharge de configuration.
      args.push('-c', `mcp_servers.haikodev.command="node"`);
      args.push('-c', `mcp_servers.haikodev.args=["${options.mcpConfigPath}"]`);
      if (options.env?.HAIKODEV_TOKEN) {
        args.push('-c', `mcp_servers.haikodev.env.HAIKODEV_TOKEN="${options.env.HAIKODEV_TOKEN}"`);
        args.push('-c', `mcp_servers.haikodev.env.HAIKODEV_URL="${options.env.HAIKODEV_URL ?? ''}"`);
        args.push('-c', `mcp_servers.haikodev.env.HAIKODEV_AGENT="${options.env.HAIKODEV_AGENT ?? ''}"`);
      }
    }

    const prompt = options.systemPrompt ? `${options.systemPrompt}\n\n---\n\n${options.prompt}` : options.prompt;
    args.push(prompt);

    const child = spawn(codexAdapter.binary, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env, FORCE_COLOR: '0' },
      // stdin fermé : sinon Codex attend une entrée supplémentaire et ne rend jamais la main.
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buffer = '';
    let stderr = '';

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('{')) return;
      let event: any;
      try {
        event = JSON.parse(trimmed);
      } catch {
        return;
      }
      emitFromCodex(event, options.onEvent);
    };

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) handleLine(line);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 8000) stderr = stderr.slice(-4000);
    });

    const finished = new Promise<{ ok: boolean; error?: string }>((resolve) => {
      child.on('error', (err) => {
        options.onEvent({ kind: 'error', error: err.message });
        resolve({ ok: false, error: err.message });
      });
      child.on('close', (code) => {
        if (buffer.trim()) handleLine(buffer);
        const ok = code === 0;
        if (!ok) {
          const message = stderr.trim().split('\n').slice(-4).join('\n') || `Le moteur s'est arrêté (code ${code}).`;
          options.onEvent({ kind: 'error', error: message });
        }
        options.onEvent({ kind: 'done', exitCode: code ?? -1 });
        resolve({ ok, error: ok ? undefined : stderr.trim().slice(-500) });
      });
    });

    return {
      pid: child.pid,
      stop: () => {
        try {
          child.kill('SIGTERM');
          setTimeout(() => {
            if (!child.killed) child.kill('SIGKILL');
          }, 4000);
        } catch (err) {
          log.warn('arrêt du moteur codex impossible', err);
        }
      },
      finished,
    };
  },
};

export function emitFromCodex(event: any, onEvent: (e: EngineEvent) => void): void {
  // Format « fil » (Codex ≥ 0.40) : thread.started / item.started / item.completed / turn.completed
  switch (event.type) {
    case 'thread.started':
      if (event.thread_id) onEvent({ kind: 'session', sessionId: event.thread_id });
      return;

    case 'item.started':
    case 'item.updated':
    case 'item.completed': {
      const item = event.item ?? {};
      const done = event.type === 'item.completed';
      const key = item.id ?? `${item.type}-${Date.now()}`;
      switch (item.type) {
        case 'agent_message':
          if (done && item.text) onEvent({ kind: 'text', text: item.text });
          return;
        case 'reasoning':
          return; // le raisonnement n'est pas une étape d'exécution
        case 'todo_list':
        case 'plan':
        case 'plan_update':
          // Le plan annoncé par Codex : même affichage que la liste de tâches
          // de Claude, coché en direct.
          onEvent({ kind: 'todo', todos: normalizeTodos(item.items ?? item.todos ?? item.plan) });
          return;
        case 'command_execution': {
          const step = humanStep('Bash', { command: item.command ?? '' });
          const failed = done && typeof item.exit_code === 'number' && item.exit_code !== 0;
          onEvent({
            kind: 'step',
            step: {
              key,
              label: step.label,
              state: done ? (failed ? 'failed' : 'done') : 'running',
              detail: (item.aggregated_output ?? item.command ?? '').slice(0, 400),
            },
          });
          return;
        }
        case 'file_change': {
          const changes: any[] = item.changes ?? [];
          const names = changes.map((c) => String(c.path ?? '').split('/').slice(-1)[0]).filter(Boolean);
          onEvent({
            kind: 'step',
            step: {
              key,
              label: names.length ? `Modification de ${names.slice(0, 3).join(', ')}` : 'Modification de fichiers',
              state: done ? 'done' : 'running',
              detail: changes.map((c) => c.path).join('\n').slice(0, 400),
            },
          });
          return;
        }
        case 'mcp_tool_call': {
          const step = humanStep(`mcp__haikodev__${item.tool ?? ''}`, item.arguments);
          onEvent({
            kind: 'step',
            step: {
              key,
              label: step.label,
              state: done ? (item.status === 'failed' ? 'failed' : 'done') : 'running',
              detail: step.detail,
            },
          });
          return;
        }
        case 'error':
          if (done) onEvent({ kind: 'error', error: item.message ?? 'Erreur du moteur.' });
          return;
        default: {
          if (!done) return;
          const label = `Étape ${item.type ?? 'inconnue'}`;
          onEvent({ kind: 'step', step: { key, label, state: 'done' } });
          return;
        }
      }
    }

    case 'turn.completed': {
      const usage = event.usage ?? {};
      onEvent({
        kind: 'usage',
        usage: {
          inputTokens: usage.input_tokens ?? 0,
          outputTokens: (usage.output_tokens ?? 0) + (usage.reasoning_output_tokens ?? 0),
          cachedTokens: usage.cached_input_tokens ?? 0,
        },
      });
      return;
    }

    case 'turn.failed':
      onEvent({ kind: 'error', error: event.error?.message ?? 'Le tour a échoué.' });
      return;

    default:
      break;
  }

  // Ancien format : { id, msg: { type, ... } }
  const msg = event.msg;
  if (!msg || typeof msg.type !== 'string') return;
  switch (msg.type) {
    case 'session_configured':
      if (msg.session_id) onEvent({ kind: 'session', sessionId: msg.session_id });
      break;
    case 'agent_message':
      if (msg.message) onEvent({ kind: 'text', text: msg.message });
      break;
    case 'plan_update':
    case 'update_plan':
      onEvent({ kind: 'todo', todos: normalizeTodos(msg.plan ?? msg.steps ?? msg.todos) });
      break;
    case 'exec_command_begin':
      onEvent({
        kind: 'step',
        step: {
          key: String(msg.call_id ?? event.id),
          label: humanStep('Bash', { command: (msg.command ?? []).join(' ') }).label,
          state: 'running',
        },
      });
      break;
    case 'exec_command_end':
      onEvent({
        kind: 'step',
        step: {
          key: String(msg.call_id ?? event.id),
          label: 'Commande terminée',
          state: msg.exit_code === 0 ? 'done' : 'failed',
          detail: (msg.stdout ?? msg.stderr ?? '').slice(0, 400),
        },
      });
      break;
    case 'token_count':
      onEvent({
        kind: 'usage',
        usage: {
          inputTokens: msg.info?.total_token_usage?.input_tokens ?? 0,
          outputTokens: msg.info?.total_token_usage?.output_tokens ?? 0,
        },
      });
      break;
    case 'error':
      onEvent({ kind: 'error', error: msg.message ?? 'Erreur du moteur.' });
      break;
    default:
      break;
  }
}
