import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { chefBride, serveursTiers, surchargesCodexDuChef } from '@haikodev/shared';
import { EngineAdapter, EngineEvent, EngineHandle, EngineRunOptions, humanStep, normalizeTodos } from './types.js';
import { log } from '../logger.js';

const execFileAsync = promisify(execFile);

/**
 * Les serveurs d'outils ÉTRANGERS branchés dans la configuration du compte
 * Codex. Lecture au fil des tours, sans cache : la configuration se modifie à
 * la main, et un fichier de quelques kilo-octets ne coûte rien.
 */
export function serveursTiersDuCompte(codexHome?: string): string[] {
  const dossier = codexHome?.trim() || path.join(os.homedir(), '.codex');
  try {
    return serveursTiers(fs.readFileSync(path.join(dossier, 'config.toml'), 'utf8'));
  } catch {
    return []; // pas de configuration lisible : rien à éteindre
  }
}



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
    const args = buildCodexArgs(options);

    const child = spawn(codexAdapter.binary, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env, FORCE_COLOR: '0' },
      // stdin fermé : sinon Codex attend une entrée supplémentaire et ne rend jamais la main.
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buffer = '';
    let stderr = '';
    let sessionId = options.sessionId ?? undefined;

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('{')) return;
      let event: any;
      try {
        event = JSON.parse(trimmed);
      } catch {
        return;
      }
      if (event.type === 'thread.started' && event.thread_id) sessionId = event.thread_id;
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
        const context = lireContexteCodex(options.env?.CODEX_HOME, sessionId);
        if (context) options.onEvent({ kind: 'context', context });
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

const fichiersDeSession = new Map<string, string>();

function fichierSessionCodex(codexHome: string, sessionId: string): string | null {
  const cle = `${codexHome}:${sessionId}`;
  const connu = fichiersDeSession.get(cle);
  if (connu && fs.existsSync(connu)) return connu;
  const racine = path.join(codexHome, 'sessions');
  try {
    const relatifs = fs.readdirSync(racine, { recursive: true, encoding: 'utf8' }) as string[];
    const relatif = relatifs.find((nom) => nom.endsWith(`${sessionId}.jsonl`));
    if (!relatif) return null;
    const trouve = path.join(racine, relatif);
    fichiersDeSession.set(cle, trouve);
    return trouve;
  } catch {
    return null;
  }
}

/**
 * Codex expose le total du tour sur stdout, mais le DERNIER appel et la
 * fenêtre dans son journal natif de session. On ne lit que la fin du fichier.
 */
export function lireContexteCodex(
  codexHome: string | undefined,
  sessionId: string | null | undefined,
): { tokens: number; window?: number } | null {
  if (!codexHome || !sessionId) return null;
  const fichier = fichierSessionCodex(codexHome, sessionId);
  if (!fichier) return null;
  try {
    const fd = fs.openSync(fichier, 'r');
    try {
      const taille = fs.fstatSync(fd).size;
      const longueur = Math.min(taille, 512 * 1024);
      const tampon = Buffer.alloc(longueur);
      fs.readSync(fd, tampon, 0, longueur, taille - longueur);
      const lignes = tampon.toString('utf8').split('\n').reverse();
      for (const ligne of lignes) {
        if (!ligne.includes('"type":"token_count"')) continue;
        try {
          const evenement = JSON.parse(ligne);
          const info = evenement?.payload?.info ?? evenement?.msg?.info;
          const dernier = info?.last_token_usage;
          const tokens = dernier?.total_tokens ??
            ((dernier?.input_tokens ?? 0) + (dernier?.output_tokens ?? 0));
          if (tokens > 0) return { tokens, window: info?.model_context_window };
        } catch {
          // Le premier morceau du tampon peut commencer au milieu d'une ligne.
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
  return null;
}

export function buildCodexArgs(options: EngineRunOptions): string[] {
  const resuming = Boolean(options.sessionId);
  const args: string[] = resuming
    ? ['exec', 'resume', options.sessionId as string, '--json', '--skip-git-repo-check']
    : ['exec', '--json', '--skip-git-repo-check', '-C', options.cwd];

  if (options.model) args.push('-m', options.model);
  if (options.thinking && options.thinking !== 'none') {
    args.push('-c', `model_reasoning_effort="${options.thinking}"`);
  }
  /*
   * LE BRIDAGE DU CHEF D'ORCHESTRE. Les deux listes calculées par le démon
   * n'ont pas d'équivalent en ligne de commande chez Codex : elles étaient
   * simplement IGNORÉES, et le chef y écrivait des fichiers là où le même chef
   * sous Claude ne le pouvait pas. Elles sont traduites en surcharges de
   * configuration (outils du projet énumérés, bac à sable en lecture seule,
   * travaux de fond éteints) — voir `shared/src/bridage-chef.ts`.
   */
  const bride = chefBride(options);
  if (options.fullAccess && !bride) {
    args.push('--dangerously-bypass-approvals-and-sandbox');
  } else if (!bride) {
    // `codex exec resume` n'accepte ni `-C` ni `-s`. Le processus est déjà
    // lancé dans options.cwd et la surcharge de configuration reste acceptée.
    if (resuming) args.push('-c', 'sandbox_mode="read-only"');
    else args.push('-s', 'read-only');
  }
  // Bridé : le bac à sable vient des surcharges, valables en reprise comme au
  // premier tour — une seule écriture de la règle, pas deux.
  for (const surcharge of surchargesCodexDuChef(options)) args.push('-c', surcharge);
  if (options.mcpBridgePath) {
    // Codex reçoit ses serveurs d'outils par surcharge de configuration, et il
    // veut la COMMANDE à lancer : le pont lui-même, jamais le fichier de
    // configuration de Claude Code (« node fichier.json » sort aussitôt sans
    // rien dire, et la liste d'outils reste vide).
    const set = (key: string, value: unknown) => args.push('-c', `${key}=${JSON.stringify(value)}`);
    set('mcp_servers.haikodev.command', process.execPath);
    set('mcp_servers.haikodev.args', [options.mcpBridgePath]);
    // Sans ce mode, chaque appel d'outil demande une approbation ; hors bac à
    // sable ouvert, personne ne répond et Codex rend « user cancelled MCP tool
    // call ». Les outils du démon sont les nôtres : ils n'ont rien à demander.
    set('mcp_servers.haikodev.default_tools_approval_mode', 'approve');
    if (options.env?.HAIKODEV_TOKEN) {
      set('mcp_servers.haikodev.env.HAIKODEV_TOKEN', options.env.HAIKODEV_TOKEN);
      set('mcp_servers.haikodev.env.HAIKODEV_URL', options.env.HAIKODEV_URL ?? '');
      set('mcp_servers.haikodev.env.HAIKODEV_AGENT', options.env.HAIKODEV_AGENT ?? '');
    }
    /*
     * LES OUTILS DU PROJET SONT LES SEULS DANS LA PIÈCE. Un autre serveur
     * branché dans la configuration de Codex propose souvent sa propre
     * mémoire : le modèle l'appelle À LA PLACE de `project_memory`, annonce
     * « mémoire consultée » et énonce des faits qu'il n'est jamais allé
     * chercher (constaté sur les tours du 4 août : `chercher_memoire` appelé à
     * chaque fois, `project_memory` jamais). On les éteint LE TEMPS D'UN TOUR
     * d'agent — la configuration de l'utilisateur n'est pas touchée.
     */
    for (const nom of serveursTiersDuCompte(options.env?.CODEX_HOME)) {
      args.push('-c', `mcp_servers.${nom}.enabled=false`);
    }
    /*
     * Même raison pour la mémoire PROPRE de Codex (son dossier `memories`) :
     * elle est commune à tous les projets, HaikoDev n'y écrit rien, et elle
     * suffit au modèle pour se croire renseigné. La mémoire d'un projet vit
     * dans `MEMOIRE.md`, et se lit avec `project_memory`.
     */
    args.push('-c', 'features.memories=false');
  }

  // Codex n'a pas de consigne « système » séparée : elle est collée devant la
  // demande, donc elle ENTRE dans l'historique du fil. La recoller à chaque
  // reprise la stockerait autant de fois qu'il y a de messages, pour rien.
  // En reprise, seul le RAPPEL court repart : sans lui, le déroulé imposé
  // s'effaçait au fil du fil, alors que Claude le reçoit à chaque tour.
  const entete = resuming ? options.systemPromptRappel : options.systemPrompt;
  const prompt = entete ? `${entete}\n\n---\n\n${options.prompt}` : options.prompt;
  args.push(prompt);
  return args;
}

/** Met en français la raison d'un appel d'outil qui n'a pas abouti. */
export function explainToolFailure(raw: unknown): string {
  const message = typeof raw === 'string' ? raw : raw ? String((raw as any).message ?? '') : '';
  const text = message.trim();
  if (/cancell?ed|rejected|denied/i.test(text)) {
    return "Appel refusé par le moteur : l'outil du projet n'était pas autorisé dans cette session.";
  }
  if (/not found|unknown tool|no such tool/i.test(text)) {
    return "Outil introuvable : le pont d'outils du projet n'a pas démarré.";
  }
  return text || "L'appel n'a pas abouti, sans raison donnée par le moteur.";
}

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
          const failed = done && item.status === 'failed';
          // Un appel refusé ou annulé ne doit jamais rester une étape rouge
          // muette : la raison est recopiée dans le détail, en clair.
          const reason = failed ? explainToolFailure(item.error?.message ?? item.error) : undefined;
          onEvent({
            kind: 'step',
            step: {
              key,
              label: failed ? `${step.label} — non aboutie` : step.label,
              state: failed ? 'failed' : done ? 'done' : 'running',
              detail: reason ? [reason, step.detail].filter(Boolean).join('\n') : step.detail,
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
      const cached = usage.cached_input_tokens ?? 0;
      onEvent({
        kind: 'usage',
        usage: {
          // Codex inclut le cache dans `input_tokens`. Le contrat interne garde
          // les deux parts disjointes afin que entrée + cache + sortie soit un
          // vrai total, sans double comptage.
          inputTokens: Math.max(0, (usage.input_tokens ?? 0) - cached),
          outputTokens: (usage.output_tokens ?? 0) + (usage.reasoning_output_tokens ?? 0),
          cachedTokens: cached,
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
      if (msg.info?.last_token_usage) {
        const dernier = msg.info.last_token_usage;
        onEvent({
          kind: 'context',
          context: {
            tokens: dernier.total_tokens ?? (dernier.input_tokens ?? 0) + (dernier.output_tokens ?? 0),
            window: msg.info.model_context_window,
          },
        });
      }
      onEvent({
        kind: 'usage',
        usage: {
          inputTokens: msg.info?.total_token_usage?.input_tokens ?? 0,
          outputTokens: msg.info?.total_token_usage?.output_tokens ?? 0,
          // Cet ancien format ne communique pas le cache : on le laisse absent
          // pour que l'interface dise « indisponible », jamais zéro.
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
