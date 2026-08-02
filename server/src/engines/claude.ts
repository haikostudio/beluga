import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { EngineAdapter, EngineEvent, EngineHandle, EngineRunOptions, humanStep } from './types.js';
import { log } from '../logger.js';

const execFileAsync = promisify(execFile);



/** Les niveaux acceptés par le CLI ; « none » signifie : ne rien passer. */
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

function effortFor(thinking?: string): string | null {
  return thinking && EFFORTS.has(thinking) ? thinking : null;
}

export const claudeAdapter: EngineAdapter = {
  id: 'claude',
  label: 'Claude Code',
  binary: process.env.HAIKODEV_CLAUDE_BIN || 'claude',
  defaultModel: 'sonnet',

  async detect() {
    try {
      const { stdout } = await execFileAsync(claudeAdapter.binary, ['--version'], { timeout: 15000 });
      return { installed: true, version: stdout.trim().split('\n')[0] };
    } catch {
      return { installed: false };
    }
  },

  async models() {
    // Le catalogue réel est construit par catalog.ts ; l'adaptateur ne
    // maintient plus de liste de son côté.
    return [];
  },

  run(options: EngineRunOptions): EngineHandle {
    const args: string[] = ['-p', '--output-format', 'stream-json', '--verbose'];

    if (options.model) args.push('--model', options.model);
    const effort = effortFor(options.thinking);
    if (effort) args.push('--effort', effort);

    if (options.sessionId) {
      args.push('--resume', options.sessionId);
    } else {
      args.push('--session-id', randomUUID());
    }

    // Accès complet pour les agents de tâche : le consentement a été donné en
    // validant la carte, pas dans une succession de fenêtres (PLAN §6).
    args.push('--permission-mode', options.fullAccess ? 'bypassPermissions' : 'manual');

    if (options.systemPrompt) args.push('--append-system-prompt', options.systemPrompt);
    if (options.mcpConfigPath) args.push('--mcp-config', options.mcpConfigPath);
    if (options.allowedTools?.length) args.push('--allowedTools', options.allowedTools.join(','));
    if (options.disallowedTools?.length) args.push('--disallowedTools', options.disallowedTools.join(','));

    const child = spawn(claudeAdapter.binary, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env, FORCE_COLOR: '0' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdin.write(options.prompt);
    child.stdin.end();

    const pendingSteps = new Map<string, string>();
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
      emitFromClaude(event, options.onEvent, pendingSteps);
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
          log.warn('arrêt du moteur claude impossible', err);
        }
      },
      finished,
    };
  },
};

function emitFromClaude(
  event: any,
  onEvent: (e: EngineEvent) => void,
  pendingSteps: Map<string, string>,
): void {
  switch (event.type) {
    case 'system':
      if (event.session_id) onEvent({ kind: 'session', sessionId: event.session_id });
      break;

    case 'rate_limit_event':
      if (event.rate_limit_info) {
        onEvent({
          kind: 'ratelimit',
          rateLimit: {
            status: event.rate_limit_info.status,
            resetsAt: event.rate_limit_info.resetsAt ? event.rate_limit_info.resetsAt * 1000 : undefined,
            type: event.rate_limit_info.rateLimitType,
          },
        });
      }
      break;

    case 'assistant': {
      const content = event.message?.content ?? [];
      for (const block of content) {
        if (block.type === 'text' && block.text) {
          onEvent({ kind: 'text', text: block.text });
        } else if (block.type === 'tool_use') {
          const step = humanStep(block.name, block.input);
          const key = block.id ?? `${block.name}-${Date.now()}`;
          pendingSteps.set(key, step.label);
          onEvent({ kind: 'step', step: { key, label: step.label, state: 'running', detail: step.detail } });
        }
      }
      break;
    }

    case 'user': {
      const content = event.message?.content ?? [];
      for (const block of content) {
        if (block.type === 'tool_result') {
          const key = block.tool_use_id;
          const label = pendingSteps.get(key);
          if (label) {
            pendingSteps.delete(key);
            const failed = block.is_error === true;
            const detail =
              typeof block.content === 'string'
                ? block.content.slice(0, 400)
                : Array.isArray(block.content)
                  ? block.content
                      .map((c: any) => (typeof c?.text === 'string' ? c.text : ''))
                      .join(' ')
                      .slice(0, 400)
                  : undefined;
            onEvent({ kind: 'step', step: { key, label, state: failed ? 'failed' : 'done', detail } });
          }
        }
      }
      break;
    }

    case 'result': {
      if (event.session_id) onEvent({ kind: 'session', sessionId: event.session_id });
      const usage = event.usage ?? {};
      onEvent({
        kind: 'usage',
        usage: {
          inputTokens: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
          outputTokens: usage.output_tokens ?? 0,
          cachedTokens: usage.cache_read_input_tokens ?? 0,
          costUsd: event.total_cost_usd,
          durationMs: event.duration_ms,
          turns: event.num_turns,
        },
      });
      if (event.is_error || event.subtype === 'error_during_execution') {
        onEvent({ kind: 'error', error: typeof event.result === 'string' ? event.result : 'Le moteur a échoué.' });
      }
      // Le texte final est déjà arrivé par les blocs « assistant » : le
      // réémettre ici le ferait apparaître deux fois dans la conversation.
      break;
    }

    default:
      break;
  }
}
