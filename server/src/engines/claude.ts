import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { modeleBanni, modelePermis, TodoItem } from '@beluga/shared';
import { log } from '../logger.js';
import {
  agentBride,
  dossierDesFilsClaude,
  enteteDuTour,
  environnementDeLaListeDeTaches,
  hooksDuGardeDuDemon,
  hooksDuVerrouDAnalyse,
  reglagesClaudeDuChef,
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

const execFileAsync = promisify(execFile);

/**
 * LE FIL SUIT L'AGENT D'UN DOSSIER À L'AUTRE.
 *
 * Claude range chaque conversation sous le dossier de travail qui l'a ouverte
 * (`<coffre>/projects/<dossier échappé>/<fil>.jsonl`), et un `--resume` lancé
 * ailleurs répond « No conversation found ». Or l'agent unique d'une carte
 * change de dossier au lancement : il cadre dans son espace à part, puis
 * exécute dans la copie de travail de la carte (`shared/src/agent-unique-de-carte.ts`).
 * Avant de reprendre, on recopie donc le fil — et son dossier d'annexes s'il en
 * a un — sous le nom du dossier courant. Rien trouvé, ou nom trop long : on ne
 * fait rien, et le filet du fil perdu du démon rappelle la conversation visible.
 */
export function amenerLeFilDansLeDossier(configDir: string, cwd: string, sessionId: string): 'deja-la' | 'recopie' | 'introuvable' {
  const racine = path.join(configDir, 'projects');
  const ici = dossierDesFilsClaude(cwd);
  if (!ici) return 'introuvable';
  const cible = path.join(racine, ici, `${sessionId}.jsonl`);
  let dossiers: string[];
  try {
    dossiers = fs.readdirSync(racine);
  } catch {
    return 'introuvable';
  }
  /* La copie la PLUS RÉCENTE fait foi : un agent revenu au cadrage après sa
     livraison retrouverait sinon, dans son espace, le fil d'avant l'exécution. */
  let plusRecent: { dossier: string; date: number } | null = null;
  for (const dossier of dossiers) {
    try {
      const date = fs.statSync(path.join(racine, dossier, `${sessionId}.jsonl`)).mtimeMs;
      /* À date égale, la copie déjà sous le dossier courant gagne : la
         recopie tombe souvent dans la même milliseconde que l'original, et
         l'ordre de lecture du dossier ne doit pas décider d'une recopie. */
      if (!plusRecent || date > plusRecent.date || (date === plusRecent.date && dossier === ici)) {
        plusRecent = { dossier, date };
      }
    } catch {
      /* pas de fil ici */
    }
  }
  if (!plusRecent) return 'introuvable';
  if (plusRecent.dossier === ici) return 'deja-la';
  fs.mkdirSync(path.dirname(cible), { recursive: true });
  fs.copyFileSync(path.join(racine, plusRecent.dossier, `${sessionId}.jsonl`), cible);
  const annexes = path.join(racine, plusRecent.dossier, sessionId);
  if (fs.existsSync(annexes)) fs.cpSync(annexes, path.join(racine, ici, sessionId), { recursive: true });
  return 'recopie';
}



/** Les niveaux acceptés par le CLI ; « none » signifie : ne rien passer. */
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

function effortFor(thinking?: string): string | null {
  return thinking && EFFORTS.has(thinking) ? thinking : null;
}

/**
 * La ligne de commande du moteur, à part pour être rejouable dans un test :
 * c'est ici que les deux listes du chef d'orchestre partent au moteur, et un
 * moteur qui les oublie ne se voit que si on peut LIRE ce qu'il reçoit.
 */
export function buildClaudeArgs(options: EngineRunOptions): string[] {
  const args: string[] = ['-p', '--output-format', 'stream-json', '--verbose'];

  // DERNIER VERROU : un modèle BANNI (Fable) ne part jamais, d'où qu'il vienne
  // (vieux réglage, reprise, essai). L'alias « opus » du CLI vise l'Opus courant.
  if (modeleBanni(options.model)) {
    log.warn(`modèle banni « ${options.model} » remplacé par Opus au lancement`);
  }
  const modele = modelePermis(options.model);
  if (modele) args.push('--model', modele);
  const effort = effortFor(options.thinking);
  if (effort) args.push('--effort', effort);

  const resuming = Boolean(options.sessionId);
  if (resuming) {
    args.push('--resume', options.sessionId as string);
  } else {
    args.push('--session-id', randomUUID());
  }

  // Accès complet pour les agents de tâche : le consentement a été donné en
  // validant la carte, pas dans une succession de fenêtres (PLAN §6).
  //
  // UN AGENT BRIDÉ PART LUI AUSSI SANS APPROBATION. Il partait en « manual », et
  // cette option ÉCRASE le `defaultMode` des réglages : chaque commande hors de
  // la liste blanche — un `cd … && sqlite3`, un `git -C` vers un autre projet —
  // réclamait un accord que personne ne peut donner dans un tour non interactif,
  // et tombait en rouge (≈ 290 refus en sept jours, mesurés par
  // `scripts/inventaire-echecs.mjs`). Sa frontière ne tient pas sur les
  // approbations : elle tient sur les outils d'ÉDITION retirés par
  // `--disallowedTools`, qu'aucun mode ne rouvre (`bridage-cadrage.ts`).
  args.push('--permission-mode', options.fullAccess || agentBride(options) ? 'bypassPermissions' : 'manual');

  // `--append-system-prompt` est réappliqué à CHAQUE tour, et ce texte se pose
  // TOUT DEVANT la conversation : il en est le PRÉFIXE. En envoyer un plus court
  // en reprise économisait ~930 jetons de texte et faisait RÉÉCRIRE la
  // conversation entière dans le cache — mesuré à six fois le prix
  // (`scripts/mesure-cache-prefixe.mjs`). L'entête ne bouge donc plus d'un tour
  // à l'autre : `enteteDuTour` garde le rappel court pour Codex, qui colle sa
  // consigne derrière l'historique et n'a donc aucun préfixe à perdre.
  const entete = enteteDuTour({
    engine: 'claude',
    reprise: resuming,
    systemPrompt: options.systemPrompt,
    systemPromptRappel: options.systemPromptRappel,
  });
  if (entete) args.push('--append-system-prompt', entete);
  if (options.mcpConfigPath) args.push('--mcp-config', options.mcpConfigPath);
  /*
   * LES OUTILS DU PROJET SONT LES SEULS DANS LA PIÈCE — sous Claude comme sous
   * Codex, qui éteint déjà les serveurs tiers de la configuration du compte
   * (`serveursTiersDuCompte`, `engines/codex.ts`).
   *
   * Le compte claude.ai d'un utilisateur branche ses CONNECTEURS dans chaque
   * session lancée en ligne de commande : un dossier de dessin, un agenda, un
   * hébergeur — et une MÉMOIRE. Ce n'est ni voulu ni utile ici : la mémoire
   * d'un projet vit par sujet dans `docs/memoire/` et se lit avec
   * `project_memory`. Un connecteur de mémoire, lui, est commun à tous les
   * projets, il n'est alimenté par personne, et le modèle l'appelle À LA PLACE
   * de l'outil du démon — quand il ne fait pas tomber le tour parce que ce
   * connecteur n'est même pas autorisé (« claude.ai Memoire » demande une
   * connexion qu'aucun tour non interactif ne peut donner).
   *
   * `--strict-mcp-config` ne garde que les serveurs passés par
   * `--mcp-config` : le pont du démon, et rien d'autre. La configuration du
   * compte n'est pas touchée — elle est seulement ignorée le temps du tour.
   */
  args.push('--strict-mcp-config');
  if (options.allowedTools?.length) args.push('--allowedTools', options.allowedTools.join(','));
  if (options.disallowedTools?.length) args.push('--disallowedTools', options.disallowedTools.join(','));

  // LA FRONTIÈRE DU CHEF BRIDÉ, côté Claude. Le bac à sable est ÉTEINT : le chef
  // lance ce qu'il veut (construire, installer, déployer, redémarrer, administrer
  // la machine), et le PROJET lui est ouvert par `--add-dir`. Ce qui reste fermé,
  // ce sont les outils d'ÉDITION, retirés par `--disallowedTools` juste au-dessus :
  // modifier du code passe par une carte. Absent pour un agent de tâche.
  const reglagesDuChef = reglagesClaudeDuChef(options, options.projectRoot);
  if (reglagesDuChef && options.projectRoot) args.push('--add-dir', options.projectRoot);

  /*
   * LE STOCKAGE DES PIÈCES JOINTES EST OUVERT À TOUS LES TOURS. Il est CENTRAL
   * — un seul dossier pour tous les projets — donc il tombe hors du dossier de
   * travail partout sauf sur Beluga Build. Sans `--add-dir`, la lecture d'une
   * image jointe échoue sur une permission que nul ne peut accorder dans un
   * tour non interactif (voir `dossiersLisibles` dans `types.ts`).
   */
  for (const dossier of options.dossiersLisibles ?? []) args.push('--add-dir', dossier);

  /*
   * LE GARDE DU DÉMON EST POSÉ POUR TOUS, pas seulement pour le chef : c'est un
   * agent de TÂCHE, en accès complet, qui a coupé le serveur le 14/08/2026 avec
   * un `pkill -9` visant le nom de ses propres essais. Le hook s'exécute avant
   * chaque commande et refuse celles qui peuvent atteindre le démon ou un moteur
   * au travail.
   */
  /*
   * CEINTURE, EN PLUS DE `--add-dir` : les dossiers sont AUSSI déclarés dans les
   * réglages, par `permissions.additionalDirectories`.
   *
   * Une règle `allow: Read(<dossier>/**)` NE SUFFIT PAS, et c'est ce qui a fait
   * croire le problème réglé : mesuré le 30/08/2026 depuis un autre projet, un
   * tour non interactif portant cette seule règle refuse toujours l'image
   * (`permission_denials` sur `Read`, réponse « je dois demander votre
   * permission »). Le garde-fou qui parle ici n'est pas celui des OUTILS mais
   * celui de la PORTÉE : un fichier hors du dossier de travail est refusé avant
   * que la règle d'outil soit seulement consultée. Seul un dossier DÉCLARÉ —
   * `--add-dir` sur la ligne de commande, `additionalDirectories` dans les
   * réglages — élargit cette portée.
   *
   * `allow` du chef est donc conservé tel quel : l'écraser lui retirait ses
   * propres autorisations sans rien apporter.
   */
  const dossiersDeclares = options.dossiersLisibles ?? [];
  /*
   * LE VERROU D'ANALYSE EST VIVANT : il est demandé au démon À L'APPEL de chaque
   * outil de terrain, jamais figé au lancement du tour. Retirer ces outils de la
   * liste blanche ne les cachait pas au modèle — il les appelait quand même, en
   * rouge — et la liste ne bougeait plus de tout le premier tour, même une fois
   * la mémoire ouverte (`hooksDuVerrouDAnalyse`, `server/verrou-analyse.mjs`).
   */
  const gardes = [
    ...((options.gardeDuDemonPath ? hooksDuGardeDuDemon(options.gardeDuDemonPath).PreToolUse : []) as unknown[]),
    ...((options.verrouAnalysePath ? hooksDuVerrouDAnalyse(options.verrouAnalysePath).PreToolUse : []) as unknown[]),
  ];
  const permissionsDuChef = (reglagesDuChef?.permissions ?? {}) as {
    additionalDirectories?: string[];
    [cle: string]: unknown;
  };
  const reglages = {
    ...(reglagesDuChef ?? {}),
    ...(dossiersDeclares.length
      ? {
          permissions: {
            ...permissionsDuChef,
            additionalDirectories: [
              ...new Set([...(permissionsDuChef.additionalDirectories ?? []), ...dossiersDeclares]),
            ],
          },
        }
      : {}),
    ...(gardes.length ? { hooks: { PreToolUse: gardes } } : {}),
  };
  if (Object.keys(reglages).length > 0) args.push('--settings', JSON.stringify(reglages));
  return args;
}

export const claudeAdapter: EngineAdapter = {
  id: 'claude',
  label: 'Claude Code',
  binary: process.env.BELUGA_CLAUDE_BIN || 'claude',
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
    const args = buildClaudeArgs(options);

    /*
     * SANS CETTE VARIABLE, L'AGENT N'A MÊME PLUS L'OUTIL POUR ANNONCER SES
     * SOUS-TÂCHES. Le CLI ne déclare plus « TaskCreate » / « TaskUpdate » aux
     * modèles récents (Sonnet 5, Opus 5, Fable 5) : la consigne de déroulé
     * visible tombe alors dans le vide et les trois affichages d'avancement
     * s'éteignent. Détail et mesure : `shared/src/liste-de-taches-du-moteur.ts`.
     */
    const env = { ...process.env, ...options.env, FORCE_COLOR: '0' };

    if (options.sessionId) {
      try {
        amenerLeFilDansLeDossier(
          (env as NodeJS.ProcessEnv).CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
          options.cwd,
          options.sessionId,
        );
      } catch {
        /* Un fil qu'on n'a pas pu recopier se rattrape par le filet du fil perdu. */
      }
    }

    const child = spawn(claudeAdapter.binary, args, {
      cwd: options.cwd,
      env: { ...env, ...environnementDeLaListeDeTaches(env) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdin.write(options.prompt);
    child.stdin.end();

    const pendingSteps = new Map<string, string>();
    const taches = new SuiviDesTaches();
    let buffer = '';
    let stderr = '';
    /*
     * LE MOTEUR A-T-IL SEULEMENT PARLÉ ? Une seule ligne de son protocole
     * suffit à le prouver. C'est ce que l'adaptateur rend au démon
     * (`jamaisDemarre`), au lieu de le laisser le deviner à l'absence
     * d'étapes, de texte et de liste de tâches.
     */
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
      emitFromClaude(event, options.onEvent, pendingSteps, taches);
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
      moteur: 'claude',
      cwd: options.cwd,
      plafondMs: options.plafondMs,
      surErreur: (message) => options.onEvent({ kind: 'error', error: message }),
      cloturer: (code, depassement) => {
        if (buffer.trim()) handleLine(buffer);
        const ok = code === 0 && !depassement;
        const message = depassement
          ? "Le moteur ne rendait pas la main : il a été arrêté pour ne pas bloquer l'agent."
          : stderr.trim().split('\n').slice(-4).join('\n') || `Le moteur s'est arrêté (code ${code}).`;
        if (!ok) options.onEvent({ kind: 'error', error: message });
        options.onEvent({ kind: 'done', exitCode: code ?? -1 });
        return {
          ok,
          error: ok ? undefined : depassement ? message : stderr.trim().slice(-500),
          jamaisDemarre: !ok && !aParle,
        };
      },
    });

    const handle: EngineHandle = {
      pid: child.pid,
      stop: () => arreterProcessus(child, 'claude'),
      finished,
    };
    // Le moteur se fait connaître de son appelant : c'est ce qui permet au
    // bouton d'arrêt de couper aussi un appel de service (compression, relance).
    options.surLancement?.(handle);
    return handle;
  },

  async compact(options: EngineRunOptions) {
    let compactee = false;
    let erreur: string | undefined;
    const compression = claudeAdapter.run({
      ...options,
      prompt: '/compact',
      systemPrompt: undefined,
      systemPromptRappel: undefined,
      onEvent: (event) => {
        if (event.kind === 'compaction') {
          compactee = event.compaction?.ok === true;
          erreur = event.compaction?.error;
        }
      },
    });
    const resultat = await compression.finished;
    if (!resultat.ok || !compactee) {
      return { ok: false, error: erreur ?? resultat.error ?? 'La compression native a été refusée.' };
    }

    // `/context` est une commande locale de Claude : elle mesure la session
    // compactée sans ajouter un nouveau tour de modèle.
    let texteContexte = '';
    const mesure = claudeAdapter.run({
      ...options,
      prompt: '/context',
      systemPrompt: undefined,
      systemPromptRappel: undefined,
      onEvent: (event) => {
        if (event.kind === 'text' && event.text) texteContexte += event.text;
      },
    });
    await mesure.finished;
    const context = lireCommandeContexteClaude(texteContexte);
    return context
      ? { ok: true, context }
      : { ok: false, error: "La session a été compactée, mais sa nouvelle taille n'a pas pu être mesurée." };
  },
};

function nombreAvecUnite(valeur: string, unite: string | undefined): number {
  const n = Number(valeur.replace(',', '.'));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * (unite?.toLowerCase() === 'm' ? 1_000_000 : unite?.toLowerCase() === 'k' ? 1_000 : 1));
}

/** Traduit la sortie locale de `/context` : « Tokens: 29.4k / 1m ». */
export function lireCommandeContexteClaude(texte: string): { tokens: number; window: number } | null {
  const trouve = texte.match(/Tokens:\*?\*?\s*([\d.,]+)\s*([km])?\s*\/\s*([\d.,]+)\s*([km])?/i);
  if (!trouve) return null;
  const tokens = nombreAvecUnite(trouve[1], trouve[2]);
  const window = nombreAvecUnite(trouve[3], trouve[4]);
  return window ? { tokens, window } : null;
}

/** Le dernier appel Claude, distinct du total cumulé rendu pour la facture. */
export function contexteDepuisResultatClaude(event: any): { tokens: number; window?: number } | null {
  const iterations = Array.isArray(event?.usage?.iterations)
    ? event.usage.iterations
    : Array.isArray(event?.iterations)
      ? event.iterations
      : [];
  const derniere = iterations[iterations.length - 1];
  if (!derniere) return null;
  const tokens =
    (derniere.input_tokens ?? 0) +
    (derniere.cache_creation_input_tokens ?? 0) +
    (derniere.cache_read_input_tokens ?? 0) +
    (derniere.output_tokens ?? 0);
  if (!tokens) return null;

  const usages = Object.values(event?.modelUsage ?? {}) as any[];
  const totalPrincipal =
    (event?.usage?.input_tokens ?? 0) +
    (event?.usage?.cache_read_input_tokens ?? 0) +
    (event?.usage?.cache_creation_input_tokens ?? 0);
  const poids = (usage: any) =>
    (usage?.inputTokens ?? 0) +
    (usage?.cacheReadInputTokens ?? 0) +
    (usage?.cacheCreationInputTokens ?? 0);
  // `modelUsage` peut aussi contenir des sous-agents. Le moteur principal est
  // celui dont le total correspond au `usage` du résultat courant.
  const principal = usages.sort(
    (a, b) => Math.abs(poids(a) - totalPrincipal) - Math.abs(poids(b) - totalPrincipal),
  )[0];
  return { tokens, window: principal?.contextWindow };
}

/**
 * La liste de tâches annoncée par le moteur. Les versions récentes de Claude
 * Code ne proposent plus « TodoWrite » mais « TaskCreate » / « TaskUpdate » :
 * une tâche par appel, mise à jour par son numéro. On rassemble ces appels en
 * UNE liste, celle qui s'affiche et se coche dans la conversation.
 */
export class SuiviDesTaches {
  private items: TodoItem[] = [];
  private parNumero = new Map<string, number>();
  /** Numéro attribué par le moteur à la dernière création, lu dans sa réponse. */
  private creationEnAttente: string | null = null;

  creer(subject: unknown, key: string): TodoItem[] | null {
    const label = typeof subject === 'string' ? subject.trim() : '';
    if (!label) return null;
    this.items.push({ label, state: 'todo' });
    this.creationEnAttente = key;
    return this.liste();
  }

  /** « Task #3 created successfully » : c'est là qu'on apprend le numéro. */
  noterNumero(key: string, texte: string): void {
    if (this.creationEnAttente !== key) return;
    this.creationEnAttente = null;
    const numero = texte.match(/#(\d+)/)?.[1];
    if (numero) this.parNumero.set(numero, this.items.length - 1);
  }

  mettreAJour(input: any): TodoItem[] | null {
    const numero = input?.taskId != null ? String(input.taskId) : '';
    const index = this.parNumero.get(numero);
    if (index === undefined) return null;
    const item = this.items[index];
    if (!item) return null;
    if (typeof input?.subject === 'string' && input.subject.trim()) item.label = input.subject.trim();
    const statut = typeof input?.status === 'string' ? input.status : '';
    if (/^completed$/i.test(statut)) item.state = 'done';
    else if (/^in_progress$/i.test(statut)) item.state = 'running';
    else if (/^pending$/i.test(statut)) item.state = 'todo';
    else if (/^deleted$/i.test(statut)) {
      this.items.splice(index, 1);
      this.parNumero.delete(numero);
      for (const [n, i] of this.parNumero) if (i > index) this.parNumero.set(n, i - 1);
    }
    return this.liste();
  }

  private liste(): TodoItem[] {
    return this.items.map((item) => ({ ...item }));
  }
}

export function emitFromClaude(
  event: any,
  onEvent: (e: EngineEvent) => void,
  pendingSteps: Map<string, string>,
  taches?: SuiviDesTaches,
): void {
  switch (event.type) {
    case 'system':
      if (event.session_id) onEvent({ kind: 'session', sessionId: event.session_id });
      if (event.subtype === 'status' && event.compact_result) {
        onEvent({
          kind: 'compaction',
          compaction: {
            ok: event.compact_result === 'success',
            error: typeof event.compact_error === 'string' ? event.compact_error : undefined,
          },
        });
      }
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
          // La liste de tâches n'est pas une étape : elle a son propre affichage,
          // coché en direct. La noyer dans le journal reviendrait à la cacher.
          if (block.name === 'TodoWrite') {
            onEvent({ kind: 'todo', todos: normalizeTodos(block.input?.todos) });
            continue;
          }
          // Même chose avec le vocabulaire des versions récentes du moteur.
          if (taches && (block.name === 'TaskCreate' || block.name === 'TaskUpdate')) {
            const key = block.id ?? '';
            const liste =
              block.name === 'TaskCreate'
                ? taches.creer(block.input?.subject, key)
                : taches.mettreAJour(block.input);
            if (liste) onEvent({ kind: 'todo', todos: liste });
            if (block.name === 'TaskCreate') pendingSteps.set(key, '');
            continue;
          }
          const step = humanStep(block.name, block.input);
          const key = block.id ?? `${block.name}-${Date.now()}`;
          pendingSteps.set(key, step.label);
          onEvent({
            kind: 'step',
            step: {
              key,
              label: step.label,
              state: 'running',
              detail: step.detail,
              capture: step.capture,
              outil: block.name,
              entree: block.input,
            },
          });
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
          if (label !== undefined) {
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
            // Étiquette vide = création de tâche : pas une étape du journal,
            // seulement le numéro à retenir pour pouvoir la cocher plus tard.
            if (!label) {
              taches?.noterNumero(key, detail ?? '');
              continue;
            }
            onEvent({ kind: 'step', step: { key, label, state: failed ? 'failed' : 'done', detail } });
          }
        }
      }
      break;
    }

    case 'result': {
      if (event.session_id) onEvent({ kind: 'session', sessionId: event.session_id });
      const context = contexteDepuisResultatClaude(event);
      if (context) onEvent({ kind: 'context', context });
      const usage = event.usage ?? {};
      onEvent({
        kind: 'usage',
        usage: {
          inputTokens: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
          outputTokens: usage.output_tokens ?? 0,
          cachedTokens: usage.cache_read_input_tokens ?? 0,
          contextTokens: sommeContexte(
            usage.input_tokens,
            usage.cache_creation_input_tokens,
            usage.cache_read_input_tokens,
            usage.output_tokens,
          ),
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
