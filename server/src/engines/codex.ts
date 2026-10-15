import { spawn, execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  agentBride,
  delaiOutilMoteurMs,
  diseLaCause,
  enteteDuTour,
  pluginsTiers,
  serveursTiers,
  surchargesCodexBridees,
} from '@beluga/shared';
import {
  EngineAdapter,
  EngineEvent,
  EngineHandle,
  EngineRunOptions,
  humanStep,
  normalizeTodos,
  sommeContexte,
} from './types.js';
import { arreterProcessus, finDuProcessus } from './fin-de-processus.js';
import { cheminDeLOutil } from './outil-du-moteur.js';

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



/**
 * LES EXTENSIONS ÉTRANGÈRES du compte Codex (voir `pluginsTiers`), lues comme
 * les serveurs d'outils : au fil des tours, sans cache.
 */
export function pluginsTiersDuCompte(codexHome?: string): string[] {
  const dossier = codexHome?.trim() || path.join(os.homedir(), '.codex');
  try {
    return pluginsTiers(fs.readFileSync(path.join(dossier, 'config.toml'), 'utf8'));
  } catch {
    return [];
  }
}

/** Ce que le dossier personnel de Codex porte et qu'un tour de Beluga ne doit PAS lire. */
const PERSONNEL_DU_COMPTE = new Set(['AGENTS.md', 'AGENTS.override.md', 'hooks.json']);

/**
 * LA MAISON D'UN TOUR : un dossier à part où Codex lit sa configuration, sans
 * les consignes globales ni les automatismes personnels de l'utilisateur.
 *
 * Codex lit `AGENTS.md` et `hooks.json` dans son dossier d'accueil, et aucune
 * option ne les ignore (`--ignore-user-config` ne couvre que `config.toml`,
 * mesuré sur codex-cli 0.146 : le modèle suivait encore la règle « Mémoire
 * consultée »). Sous Claude, un tour n'a que les outils du projet ; la maison
 * donne la même pièce à Codex. Tout le reste du dossier du compte — connexion,
 * fils, bases d'état, configuration — y est relié par des liens : la reprise
 * d'un fil et le coffre du compte restent ceux du compte, et le dossier
 * personnel n'est jamais modifié.
 *
 * Stable par compte (jamais par tour) : rejouée à chaque lancement, elle ne
 * fait que corriger ce qui a changé. `auth.json` est la seule pièce que Codex
 * réécrit : s'il l'a remplacée par un fichier ordinaire dans la maison, on la
 * RAPATRIE chez le compte (jeton rafraîchi) avant de remettre le lien.
 */
export function preparerMaisonDeTour(dossierDuCompte: string, atelier: string): string {
  const reel = path.resolve(dossierDuCompte);
  const nom = `${path.basename(reel).replace(/[^A-Za-z0-9_.-]/g, '_') || 'codex'}-${crypto
    .createHash('sha1')
    .update(reel)
    .digest('hex')
    .slice(0, 8)}`;
  const maison = path.join(atelier, nom);
  fs.mkdirSync(maison, { recursive: true });
  // Le fil d'un tour doit toujours s'écrire chez le compte, jamais dans la maison.
  fs.mkdirSync(path.join(reel, 'sessions'), { recursive: true });

  for (const entree of fs.readdirSync(maison)) {
    const ici = path.join(maison, entree);
    const lien = (() => {
      try {
        return fs.lstatSync(ici);
      } catch {
        return null;
      }
    })();
    if (!lien) continue;
    if (!lien.isSymbolicLink() && entree === 'auth.json') {
      try {
        fs.copyFileSync(ici, path.join(reel, 'auth.json'));
        fs.rmSync(ici, { force: true });
      } catch {
        /* le lien est remis plus bas, le compte garde sa connexion */
      }
      continue;
    }
    const source = path.join(reel, entree);
    if (PERSONNEL_DU_COMPTE.has(entree) || !fs.existsSync(source)) {
      // Une pièce disparue du compte, ou une pièce personnelle : plus rien ne la relie.
      if (lien.isSymbolicLink()) fs.rmSync(ici, { force: true });
    }
  }

  for (const entree of fs.readdirSync(reel)) {
    if (PERSONNEL_DU_COMPTE.has(entree)) continue;
    const ici = path.join(maison, entree);
    const source = path.join(reel, entree);
    try {
      const actuel = fs.lstatSync(ici);
      if (actuel.isSymbolicLink() && fs.readlinkSync(ici) === source) continue;
      // Un fichier ordinaire créé par Codex dans la maison : le compte fait foi.
      fs.rmSync(ici, { recursive: true, force: true });
    } catch {
      /* rien à cet emplacement : on crée le lien */
    }
    try {
      fs.symlinkSync(source, ici);
    } catch {
      /* lien déjà posé par un tour concurrent */
    }
  }
  return maison;
}

export const codexAdapter: EngineAdapter = {
  id: 'codex',
  label: 'Codex',
  /*
   * Cherché là où l'outil est RÉELLEMENT posé (`cheminDeLOutil`) : le chemin
   * figé de la machine d'origine laissait un Codex fraîchement installé
   * invisible sur un serveur neuf.
   */
  get binary() {
    return cheminDeLOutil({
      nom: 'codex',
      impose: process.env.BELUGA_CODEX_BIN,
      enPlus: [path.join(os.homedir(), '.codex/packages/standalone/current/bin/codex')],
      historique: '/root/.local/bin/codex',
    });
  },
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
    /*
     * UN TOUR DE BELUGA N'A QUE LES OUTILS DU PROJET, comme sous Claude : il lit
     * sa configuration dans la maison du compte (`preparerMaisonDeTour`), sans
     * les consignes globales ni les automatismes personnels de l'utilisateur.
     * Si la maison ne peut pas se préparer, le tour part comme avant.
     */
    const env: NodeJS.ProcessEnv = { ...process.env, ...options.env, FORCE_COLOR: '0' };
    if (options.mcpBridgePath) {
      try {
        const compte = options.env?.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex');
        env.CODEX_HOME = preparerMaisonDeTour(compte, path.join(os.homedir(), '.beluga', 'maisons-codex'));
      } catch {
        /* le dossier du compte reste utilisé tel quel */
      }
    }

    const child = spawn(codexAdapter.binary, args, {
      cwd: options.cwd,
      env,
      // stdin fermé : sinon Codex attend une entrée supplémentaire et ne rend jamais la main.
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buffer = '';
    let stderr = '';
    let sessionId = options.sessionId ?? undefined;
    // Une seule ligne du protocole prouve que le moteur a démarré : c'est le
    // signal explicite rendu au démon, à la place d'une déduction par absences.
    let aParle = false;

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('{')) return;
      let event: any;
      try {
        event = JSON.parse(trimmed);
      } catch {
        return;
      }
      aParle = true;
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

    const finished = finDuProcessus(child, {
      moteur: 'codex',
      cwd: options.cwd,
      plafondMs: options.plafondMs,
      surErreur: (message) => options.onEvent({ kind: 'error', error: message }),
      cloturer: (code, depassement) => {
        if (buffer.trim()) handleLine(buffer);
        const context = lireContexteCodex(options.env?.CODEX_HOME, sessionId);
        if (context) options.onEvent({ kind: 'context', context });
        const ok = code === 0 && !depassement;
        /*
         * `codex-cli` 0.146 écrit « Reading additional input from stdin… » sur
         * sa sortie d'erreur à CHAQUE lancement, y compris quand le tour
         * réussit : ce n'est pas une erreur, c'est une note de démarrage. Gardée
         * telle quelle, elle devenait la dernière ligne du rapport et remplaçait
         * la cause réelle de l'arrêt. On l'écarte ICI, à la source.
         */
        const causes = stderr
          .trim()
          .split('\n')
          .filter((ligne) => diseLaCause(ligne))
          .slice(-4)
          .join('\n');
        const message = depassement
          ? "Le moteur ne rendait pas la main : il a été arrêté pour ne pas bloquer l'agent."
          : causes || `Le moteur s'est arrêté (code ${code}).`;
        if (!ok) options.onEvent({ kind: 'error', error: message });
        options.onEvent({ kind: 'done', exitCode: code ?? -1 });
        return {
          ok,
          error: ok ? undefined : depassement ? message : causes.slice(-500),
          jamaisDemarre: !ok && !aParle,
        };
      },
    });

    const handle: EngineHandle = {
      pid: child.pid,
      stop: () => arreterProcessus(child, 'codex'),
      finished,
    };
    options.surLancement?.(handle);
    return handle;
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
   * travaux de fond éteints) — voir `shared/src/bridage-cadrage.ts`.
   */
  const bride = agentBride(options);
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
  for (const surcharge of surchargesCodexBridees(options)) args.push('-c', surcharge);
  // Posée APRÈS les surcharges du bridage : c'est elle qui l'emporte.
  if (options.sandboxLectureSeule) args.push('-c', 'sandbox_mode="read-only"');
  if (options.mcpBridgePath) {
    // Codex reçoit ses serveurs d'outils par surcharge de configuration, et il
    // veut la COMMANDE à lancer : le pont lui-même, jamais le fichier de
    // configuration de Claude Code (« node fichier.json » sort aussitôt sans
    // rien dire, et la liste d'outils reste vide).
    const set = (key: string, value: unknown) => args.push('-c', `${key}=${JSON.stringify(value)}`);
    set('mcp_servers.beluga.command', process.execPath);
    set('mcp_servers.beluga.args', [options.mcpBridgePath]);
    // Sans ce mode, chaque appel d'outil demande une approbation ; hors bac à
    // sable ouvert, personne ne répond et Codex rend « user cancelled MCP tool
    // call ». Les outils du démon sont les nôtres : ils n'ont rien à demander.
    set('mcp_servers.beluga.default_tools_approval_mode', 'approve');
    /*
     * UN OUTIL A LE DROIT D'ATTENDRE UNE PERSONNE. `ask_user` ne rend la main
     * qu'une fois la réponse donnée : c'est ce qui arrête le moteur au lieu de
     * le laisser enchaîner les étapes suivantes de sa liste. Le délai d'un
     * appel d'outil, très court par défaut chez Codex, doit donc laisser la
     * place au plafond tenu par le démon (`shared/src/attente-question.ts`).
     */
    set('mcp_servers.beluga.tool_timeout_sec', Math.round(delaiOutilMoteurMs() / 1000));
    if (options.env?.BELUGA_TOKEN) {
      set('mcp_servers.beluga.env.BELUGA_TOKEN', options.env.BELUGA_TOKEN);
      set('mcp_servers.beluga.env.BELUGA_URL', options.env.BELUGA_URL ?? '');
      set('mcp_servers.beluga.env.BELUGA_AGENT', options.env.BELUGA_AGENT ?? '');
      // Le tour, pour que le démon reconnaisse un appel venu d'ailleurs.
      set('mcp_servers.beluga.env.BELUGA_TOUR', options.env.BELUGA_TOUR ?? '');
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
    /* Les serveurs de plus de CE tour (REA, pour l'agent d'un clonage). */
    for (const [nom, serveur] of Object.entries(options.mcpServeursEnPlus ?? {})) {
      set(`mcp_servers.${nom}.command`, serveur.command);
      set(`mcp_servers.${nom}.args`, serveur.args);
      set(`mcp_servers.${nom}.default_tools_approval_mode`, 'approve');
      set(`mcp_servers.${nom}.tool_timeout_sec`, 600);
      for (const [cle, valeur] of Object.entries(serveur.env)) set(`mcp_servers.${nom}.env.${cle}`, valeur);
    }
    for (const nom of serveursTiersDuCompte(options.env?.CODEX_HOME)) {
      args.push('-c', `mcp_servers.${nom}.enabled=false`);
    }
    /*
     * Même raison pour la mémoire PROPRE de Codex (son dossier `memories`) :
     * elle est commune à tous les projets, Beluga Build n'y écrit rien, et elle
     * suffit au modèle pour se croire renseigné. La mémoire d'un projet vit
     * par sujet dans `docs/memoire/`, et se lit avec `project_memory`.
     */
    args.push('-c', 'features.memories=false');
    /*
     * LES EXTENSIONS DU COMPTE suivent les serveurs d'outils : une extension
     * personnelle (mémoire, rappel…) apporte ses propres consignes et outils.
     * Éteintes le temps du tour, comme le sont les serveurs étrangers.
     */
    for (const nom of pluginsTiersDuCompte(options.env?.CODEX_HOME)) {
      args.push('-c', `plugins."${nom}".enabled=false`);
    }
  }

  // Codex n'a pas de consigne « système » séparée : elle est collée devant la
  // demande, donc elle ENTRE dans l'historique du fil. La recoller à chaque
  // reprise la stockerait autant de fois qu'il y a de messages, pour rien.
  // En reprise, seul le RAPPEL court repart : sans lui, le déroulé imposé
  // s'effaçait au fil du fil. C'est l'exception que porte `enteteDuTour` : la
  // consigne de Codex n'étant pas un PRÉFIXE, la raccourcir n'invalide aucun
  // cache — sous Claude, où elle en est un, l'entête ne bouge plus.
  const entete = enteteDuTour({
    engine: 'codex',
    reprise: resuming,
    systemPrompt: options.systemPrompt,
    systemPromptRappel: options.systemPromptRappel,
  });
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
              outil: 'Bash',
              entree: { command: item.command ?? '' },
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
              outil: 'Edit',
              entree: { file_path: changes.map((c) => c.path).join('\n') },
            },
          });
          return;
        }
        case 'mcp_tool_call': {
          const step = humanStep(`mcp__beluga__${item.tool ?? ''}`, item.arguments);
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
              capture: step.capture,
              outil: `mcp__beluga__${item.tool ?? ''}`,
              entree: item.arguments,
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
    case 'token_count': {
      const derniereMesure = msg.info?.last_token_usage;
      if (derniereMesure) {
        onEvent({
          kind: 'context',
          context: {
            tokens:
              derniereMesure.total_tokens ??
              sommeContexte(
                derniereMesure.input_tokens,
                derniereMesure.cached_input_tokens,
                derniereMesure.output_tokens,
                derniereMesure.reasoning_output_tokens,
              ) ??
              0,
            window: msg.info.model_context_window,
          },
        });
      }
      onEvent({
        kind: 'usage',
        usage: {
          inputTokens: msg.info?.total_token_usage?.input_tokens ?? 0,
          outputTokens: msg.info?.total_token_usage?.output_tokens ?? 0,
          contextTokens:
            typeof derniereMesure?.total_tokens === 'number'
              ? derniereMesure.total_tokens
              : sommeContexte(
                  derniereMesure?.input_tokens,
                  derniereMesure?.cached_input_tokens,
                  derniereMesure?.output_tokens,
                  derniereMesure?.reasoning_output_tokens,
                ),
          contextWindow:
            typeof msg.info?.model_context_window === 'number' ? msg.info.model_context_window : undefined,
          // Cet ancien format ne communique pas le cache : on le laisse absent
          // pour que l'interface dise « indisponible », jamais zéro.
        },
      });
      break;
    }
    case 'error':
      onEvent({ kind: 'error', error: msg.message ?? 'Erreur du moteur.' });
      break;
    default:
      break;
  }
}
