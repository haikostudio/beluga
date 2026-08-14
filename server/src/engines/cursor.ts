import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  API_CURSOR,
  CREDIT_HORS_DE_PORTEE,
  MODELE_CURSOR_PAR_DEFAUT,
  OUTIL_PLAN_CURSOR,
  OUTIL_TACHES_CURSOR,
  ROUTE_DEPENSE_CURSOR,
  creditDepuisReponseCursor,
  enteteDuTour,
  idCursorPourNiveau,
  manqueDuMoteurCursor,
  modePlanFermeLEcriture,
  modelesCursorDepuisListe,
  outilCursor,
  raisonDeLaSortieCursor,
  raisonDeRefusCursor,
  texteDuPlanCursor,
  type CreditCursor,
  type EtatCompteCursor,
  type ModeleCursorCli,
} from '@haikodev/shared';
import { EngineAdapter, EngineEvent, EngineHandle, EngineRunOptions, humanStep, normalizeTodos } from './types.js';
import { finDuProcessus } from './fin-de-processus.js';
import { cleDuCompteCursor, listAccountRecords } from '../accounts.js';
import { log } from '../logger.js';

const execFileAsync = promisify(execFile);

/**
 * L'ADAPTATEUR CURSOR. Comme Claude et Codex, il lance un PROCESSUS dans la
 * copie de travail de la carte et lit ce qu'il écrit : l'outil `cursor-agent`
 * lit et modifie les fichiers SUR LA MACHINE. Il a remplacé les agents cloud,
 * où le travail se faisait chez Cursor sur un dépôt GitHub et devait être
 * rapatrié par une branche « cursor/… » (voir `shared/src/moteur-cursor.ts`).
 *
 * DEUX RÈGLES QUI NE SE NÉGOCIENT PAS :
 *  - un lancement impossible se DIT (`kind: 'error'`) et le tour se REFERME
 *    (`kind: 'done'` avec un code non nul). Un témoin qui tourne sur un outil
 *    absent est précisément le défaut que ce moteur ne doit pas introduire ;
 *  - la clé vient de l'ENVIRONNEMENT du compte porteur (`CURSOR_API_KEY`,
 *    posée par `applyAccountEnv`), jamais d'une constante écrite ici.
 */

/** La clé de ce tour : celle du compte porteur, sinon celle du serveur. */
function cleDuTour(env?: Record<string, string>): string {
  return (env?.CURSOR_API_KEY || process.env.CURSOR_API_KEY || '').trim();
}

/**
 * TOUTES les clés Cursor connues, du compte prioritaire au dernier, celle de
 * l'environnement en dernier recours.
 *
 * Un seul compte ne doit pas décider pour le moteur entier : sa clé peut être
 * révoquée alors qu'un second compte répond très bien. Sans cette liste, le
 * moteur se déclarait ABSENT dès que la clé de l'environnement était refusée —
 * et le compte de relève, pourtant valide, disparaissait avec lui (constaté par
 * `scripts/verif-moteur-cursor.mjs`).
 */
export function clesCursor(): string[] {
  const cles: string[] = [];
  for (const compte of listAccountRecords()
    .filter((a) => a.engine === 'cursor')
    .sort((a, b) => a.priority - b.priority)) {
    const cle = cleDuCompteCursor(compte);
    if (cle && !cles.includes(cle)) cles.push(cle);
  }
  const environnement = cleDuTour();
  if (environnement && !cles.includes(environnement)) cles.push(environnement);
  return cles;
}

export class RefusCursor extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * ÉPROUVER UNE CLÉ. Le seul appel réseau qui reste : le CLI ne sait pas dire si
 * la clé qu'on lui passe est bonne — sa commande `status` rend le compte
 * connecté sur la machine, pas celui de la clé fournie. Sans cette porte, une
 * clé fausse déclarée dans les réglages ne se serait vue qu'au premier tour.
 */
export async function eprouverLaCle(cle: string): Promise<{ ok: boolean; nom?: string; erreur?: string }> {
  try {
    const res = await fetch(`${API_CURSOR}/v1/me`, {
      headers: { authorization: `Bearer ${cle}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const corps: any = await res.json().catch(() => null);
      const message = typeof corps?.error?.message === 'string' ? corps.error.message
        : typeof corps?.message === 'string' ? corps.message
        : undefined;
      return { ok: false, erreur: raisonDeRefusCursor(res.status, message) };
    }
    const moi: any = await res.json().catch(() => ({}));
    return { ok: true, nom: typeof moi?.apiKeyName === 'string' ? moi.apiKeyName : undefined };
  } catch (err: any) {
    return { ok: false, erreur: err?.message ?? "la clé n'a pas pu être éprouvée" };
  }
}

/**
 * LE CRÉDIT DÉPENSÉ, DEMANDÉ À CURSOR. Cursor facture à la dépense : sa ligne
 * n'a pas de jauge, c'est un MONTANT qui doit s'y lire. Ce montant ne se
 * reconstitue pas depuis des jetons et un tarif deviné — on le demande, et
 * quand la clé n'a pas le droit de le lire (une clé personnelle reçoit
 * « Invalid Team API Key »), on le DIT (`shared/src/credit-cursor.ts`).
 */
export async function creditCursor(cle: string): Promise<CreditCursor> {
  if (!cle) return { indisponible: "aucune clé d'accès configurée sur le serveur" };
  try {
    const res = await fetch(`${API_CURSOR}${ROUTE_DEPENSE_CURSOR}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cle}`, 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401 || res.status === 403) return { indisponible: CREDIT_HORS_DE_PORTEE };
    if (!res.ok) {
      const corps: any = await res.json().catch(() => null);
      const message = typeof corps?.message === 'string' ? corps.message : undefined;
      return { indisponible: raisonDeRefusCursor(res.status, message) };
    }
    return creditDepuisReponseCursor(await res.json().catch(() => null));
  } catch (err: any) {
    return { indisponible: err?.message ?? "le montant dépensé n'a pas pu être lu" };
  }
}

/* ------------------------------------------------------------------ */
/* Le catalogue, lu dans le CLI                                        */
/* ------------------------------------------------------------------ */

/**
 * LES MODÈLES QUE LE CLI ACCEPTE (`cursor-agent --list-models`), regroupés par
 * modèle et par niveau. C'est la SEULE source : un nom absent de cette liste
 * fait refuser le tour entier avant qu'il commence, et le format paramétré de
 * l'API (« composer-2.5[effort=high] ») y est refusé lui aussi.
 */
export async function modelesCursor(cle: string): Promise<ModeleCursorCli[]> {
  const { stdout } = await execFileAsync(cursorAdapter.binary, ['--list-models'], {
    timeout: 30_000,
    env: { ...process.env, ...(cle ? { CURSOR_API_KEY: cle } : {}), FORCE_COLOR: '0' },
    maxBuffer: 4 * 1024 * 1024,
  });
  return modelesCursorDepuisListe(stdout);
}

/**
 * Le catalogue gardé quelques minutes : il décide du nom exact envoyé à
 * `--model`, et il ne bouge pas d'un tour à l'autre.
 */
let cacheModeles: { at: number; modeles: ModeleCursorCli[] } | null = null;

async function catalogueDuTour(cle: string): Promise<ModeleCursorCli[]> {
  if (cacheModeles && Date.now() - cacheModeles.at < 5 * 60 * 1000) return cacheModeles.modeles;
  try {
    const modeles = await modelesCursor(cle);
    if (modeles.length) cacheModeles = { at: Date.now(), modeles };
    return modeles;
  } catch (err) {
    // Catalogue illisible : le modèle part tel qu'il est retenu sur la carte
    // plutôt que de faire échouer le tour pour une liste indisponible.
    log.warn('catalogue Cursor illisible avant un tour', err);
    return [];
  }
}

/**
 * L'ÉTAT D'UN COMPTE CURSOR, tel que les réglages l'affichent : l'outil est-il
 * sur la machine, et la clé répond-elle ? Les deux vérifications sont
 * indépendantes — un CLI absent ne fait pas passer une clé valide pour
 * refusée, et l'inverse non plus.
 */
export async function etatDuCompteCursor(cle: string): Promise<EtatCompteCursor> {
  const cli = await cursorAdapter.detect();
  const base = {
    cliInstalle: cli.installed,
    versionDuCli: cli.version,
    erreurDuCli: cli.installed ? undefined : "l'outil « cursor-agent » n'a pas répondu sur ce serveur",
  };
  if (!cle) return { ...base, cleAcceptee: false, erreur: "aucune clé d'accès configurée sur le serveur" };
  const epreuve = await eprouverLaCle(cle);
  return { ...base, cleAcceptee: epreuve.ok, nomDeLaCle: epreuve.nom, erreur: epreuve.erreur };
}

/* ------------------------------------------------------------------ */
/* Les outils du démon                                                 */
/* ------------------------------------------------------------------ */

/**
 * BRANCHER LES OUTILS DU PROJET. Le CLI ne prend pas de fichier de
 * configuration en argument : il lit `.cursor/mcp.json` à la racine de l'espace
 * de travail, ou celui du dossier personnel. On recopie donc la configuration
 * de l'agent — déjà écrite par le démon, au MÊME format (`mcpServers`) — dans
 * le dossier du tour, et on l'écarte du dépôt par son fichier d'exclusion
 * LOCAL : un fichier de service n'a rien à faire dans le travail d'une carte.
 */
export function poserLaConfigurationMcp(cwd: string, mcpConfigPath: string | undefined): void {
  if (!mcpConfigPath) return;
  try {
    const contenu = fs.readFileSync(mcpConfigPath, 'utf8');
    const dossier = path.join(cwd, '.cursor');
    fs.mkdirSync(dossier, { recursive: true });
    fs.writeFileSync(path.join(dossier, 'mcp.json'), contenu, 'utf8');
    ecarterDuDepot(cwd, '/.cursor/');
  } catch (err) {
    // Sans outils, l'agent travaille quand même : il ne peut simplement pas
    // lire la mémoire du projet ni poser de question. On le journalise.
    log.warn('outils du projet non branchés pour Cursor', String(err).slice(0, 200));
  }
}

/**
 * UN SEUL TOUR À LA FOIS ÉCRIT LES OUTILS D'UN DOSSIER DONNÉ. Le chef bridé
 * garde le MÊME dossier de travail d'un tour à l'autre (`chefScratch/<projet>`,
 * pour y retrouver ses notes) — donc deux tours de Cursor sur le même projet,
 * lancés en même temps (une conversation ordinaire et l'auto-amélioration de
 * nuit, par exemple), peuvent y écrire `.cursor/mcp.json` en même temps. Le
 * second écrase alors la configuration du premier avant que SON `cursor-agent`
 * ne l'ait lue : le pont annonce le mauvais agent, et le vrai reste sans outil
 * — sans qu'aucune erreur ne se voie. Un dossier de carte, lui, est propre à
 * une carte et n'a jamais ce voisin ; le verrou n'y coûte donc rien.
 */
const verrousCwd = new Map<string, Promise<unknown>>();

export function avecVerrouCwd<T>(cwd: string, tache: () => Promise<T>): Promise<T> {
  const attente = (verrousCwd.get(cwd) ?? Promise.resolve()).catch(() => undefined);
  const suite = attente.then(tache);
  verrousCwd.set(cwd, suite.catch(() => undefined));
  return suite;
}

/** Une ligne d'exclusion posée dans le fichier LOCAL du dépôt, jamais dans son `.gitignore`. */
function ecarterDuDepot(cwd: string, ligne: string): void {
  try {
    const racine = racineDuDepot(cwd);
    if (!racine) return;
    const info = path.join(racine, 'info');
    const fichier = path.join(info, 'exclude');
    const actuel = fs.existsSync(fichier) ? fs.readFileSync(fichier, 'utf8') : '';
    if (actuel.split('\n').some((l) => l.trim() === ligne)) return;
    fs.mkdirSync(info, { recursive: true });
    fs.writeFileSync(fichier, `${actuel}${actuel.endsWith('\n') || !actuel ? '' : '\n'}${ligne}\n`);
  } catch (err) {
    log.warn("exclusion du fichier d'outils impossible", String(err).slice(0, 200));
  }
}

/**
 * LE DOSSIER GIT du tour. Dans une copie de travail (`git worktree`), `.git`
 * est un FICHIER qui désigne le vrai dossier : l'exclusion doit y aller, pas à
 * côté. Rien de tout cela : ce n'est pas un dépôt, il n'y a rien à écarter.
 */
function racineDuDepot(cwd: string): string | null {
  const marque = path.join(cwd, '.git');
  if (!fs.existsSync(marque)) return null;
  if (fs.statSync(marque).isDirectory()) return marque;
  const pointe = fs.readFileSync(marque, 'utf8').match(/^gitdir:\s*(.+)$/m)?.[1]?.trim();
  if (!pointe) return null;
  return path.isAbsolute(pointe) ? pointe : path.resolve(cwd, pointe);
}

/* ------------------------------------------------------------------ */
/* Le tour                                                             */
/* ------------------------------------------------------------------ */

/**
 * La ligne de commande du moteur, à part pour être rejouable dans un test :
 * c'est ici que se décident le modèle envoyé, la reprise du fil et l'accès
 * complet — trois choses qu'on ne voit que si on peut LIRE ce que le moteur
 * reçoit.
 */
export function buildCursorArgs(options: EngineRunOptions, modele: string): string[] {
  const args: string[] = ['-p', '--output-format', 'stream-json', '--model', modele];

  // Le mode plan l'emporte sur l'accès complet : l'agent prépare sans jamais
  // écrire. Ailleurs, le consentement a été donné en validant la carte, pas
  // dans une succession de fenêtres — d'où `--force`, qui n'en ouvre aucune.
  if (modePlanFermeLEcriture(options.mode, options.role)) args.push('--mode', 'plan');
  else if (options.fullAccess) args.push('--force', '--sandbox', 'disabled');

  if (options.sessionId) args.push('--resume', options.sessionId);
  // Le projet est celui du démon : rien à approuver à la main, et une question
  // posée à un agent qui travaille seul n'a personne pour y répondre.
  args.push('--trust');
  if (options.mcpConfigPath) args.push('--approve-mcps');
  if (options.projectRoot) args.push('--add-dir', options.projectRoot);
  return args;
}

export const cursorAdapter: EngineAdapter = {
  id: 'cursor',
  label: 'Cursor',
  binary: process.env.HAIKODEV_CURSOR_BIN || '/usr/local/bin/cursor-agent',
  defaultModel: MODELE_CURSOR_PAR_DEFAUT,

  /**
   * Le moteur n'existe que si l'outil répond ET qu'une clé est connue : sans
   * clé, aucun tour ne peut partir, et le proposer dans les menus reviendrait
   * à promettre un moteur qui refusera tout.
   */
  async detect() {
    if (!clesCursor().length) return { installed: false };
    try {
      const { stdout } = await execFileAsync(cursorAdapter.binary, ['--version'], { timeout: 15_000 });
      return { installed: true, version: stdout.trim().split('\n')[0] };
    } catch {
      return { installed: false };
    }
  },

  async models() {
    // Le catalogue réel est construit par catalog.ts, qui appelle
    // `modelesCursor` : l'adaptateur ne maintient pas de liste de son côté.
    return [];
  },

  run(options: EngineRunOptions): EngineHandle {
    const cle = cleDuTour(options.env);
    const manque = manqueDuMoteurCursor(fs.existsSync(cursorAdapter.binary), Boolean(cle));
    if (manque) return tourImpossible(options, manque);

    /*
     * La consigne système part COLLÉE DEVANT la demande, comme sous Codex : le
     * CLI n'a pas de consigne séparée. `enteteDuTour` décide de ce qui repart
     * vraiment (`shared/src/prefixe-cache.ts`).
     */
    const entete = enteteDuTour({
      engine: 'cursor',
      reprise: Boolean(options.sessionId),
      systemPrompt: options.systemPrompt,
      systemPromptRappel: options.systemPromptRappel,
    });
    const prompt = entete ? `${entete}\n\n---\n\n${options.prompt}` : options.prompt;

    let enfant: ReturnType<typeof spawn> | null = null;
    let arrete = false;
    const pendingSteps = new Map<string, string>();
    let buffer = '';
    let stderr = '';

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) return;
      let event: any;
      try {
        event = JSON.parse(trimmed);
      } catch {
        return;
      }
      emitFromCursor(event, options.onEvent, pendingSteps);
    };

    /*
     * LE NOM DU MODÈLE SE RÉSOUT AVANT LE LANCEMENT, et il demande une lecture
     * du catalogue : le tour part donc dans une promesse. Tout ce qui suit —
     * flux, fin, arrêt — reste identique aux deux autres moteurs.
     *
     * La pose des outils et le lancement du CLI sont tenus sous LE VERROU du
     * dossier de travail, jusqu'à la fin du tour : aucun autre tour du même
     * dossier ne peut écraser `.cursor/mcp.json` pendant que CE `cursor-agent`
     * le lit encore.
     */
    const finished = avecVerrouCwd(options.cwd, async (): Promise<{ ok: boolean; error?: string }> => {
      poserLaConfigurationMcp(options.cwd, options.mcpConfigPath);

      const modele = idCursorPourNiveau(
        await catalogueDuTour(cle),
        options.model?.trim() || MODELE_CURSOR_PAR_DEFAUT,
        options.thinking,
      );
      if (arrete) {
        options.onEvent({ kind: 'done', exitCode: 1 });
        return { ok: false, error: 'Tour arrêté à la demande.' };
      }

      const child = spawn(cursorAdapter.binary, buildCursorArgs(options, modele), {
        cwd: options.cwd,
        env: { ...process.env, ...options.env, CURSOR_API_KEY: cle, FORCE_COLOR: '0' },
        // stdin fermé : la demande part en argument, et une entrée ouverte
        // ferait attendre le moteur au lieu de lui faire rendre la main.
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      enfant = child;
      child.stdin?.write(prompt);
      child.stdin?.end();

      child.stdout?.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        const lignes = buffer.split('\n');
        buffer = lignes.pop() ?? '';
        for (const ligne of lignes) handleLine(ligne);
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
        if (stderr.length > 8000) stderr = stderr.slice(-4000);
      });

      return finDuProcessus(child, {
        moteur: 'cursor',
        plafondMs: options.plafondMs,
        surErreur: (message) => options.onEvent({ kind: 'error', error: message }),
        cloturer: (code, depassement) => {
          if (buffer.trim()) handleLine(buffer);
          const ok = code === 0 && !depassement;
          const message = depassement
            ? "Le moteur ne rendait pas la main : il a été arrêté pour ne pas bloquer l'agent."
            : raisonDeLaSortieCursor(stderr, code);
          if (!ok) options.onEvent({ kind: 'error', error: message });
          options.onEvent({ kind: 'done', exitCode: code ?? -1 });
          return { ok, error: ok ? undefined : message.slice(0, 500) };
        },
      });
    });

    return {
      stop: () => {
        arrete = true;
        try {
          enfant?.kill('SIGTERM');
          setTimeout(() => {
            if (enfant && !enfant.killed) enfant.kill('SIGKILL');
          }, 4000);
        } catch (err) {
          log.warn('arrêt du moteur cursor impossible', err);
        }
      },
      finished,
    };
  },
};

/** Un tour qui ne peut pas partir se referme tout de suite, en disant pourquoi. */
function tourImpossible(options: EngineRunOptions, raison: string): EngineHandle {
  options.onEvent({ kind: 'error', error: raison });
  options.onEvent({ kind: 'done', exitCode: 1 });
  return { stop: () => undefined, finished: Promise.resolve({ ok: false, error: raison }) };
}

/**
 * LE FLUX DU CLI, traduit dans les événements communs aux moteurs. Le format
 * est proche de celui de Claude Code — `system` au départ, `assistant` pour le
 * texte, `result` à la fin — avec un vocabulaire d'outils à lui
 * (`outilCursor`). Le RAISONNEMENT (`thinking`) n'est pas une étape
 * d'exécution : il ne s'affiche pas, comme sous Codex.
 */
export function emitFromCursor(
  event: any,
  onEvent: (e: EngineEvent) => void,
  pendingSteps: Map<string, string>,
): void {
  switch (event?.type) {
    case 'system':
      if (event.session_id) onEvent({ kind: 'session', sessionId: event.session_id });
      return;

    case 'assistant': {
      for (const bloc of event.message?.content ?? []) {
        if (bloc?.type === 'text' && bloc.text) onEvent({ kind: 'text', text: bloc.text });
      }
      return;
    }

    case 'tool_call': {
      const traduit = outilCursor(event.tool_call);
      if (!traduit) return;
      const key = String(event.call_id ?? `${traduit.nom}-${event.timestamp_ms ?? ''}`);

      // La liste de tâches n'est pas une étape : elle a son propre affichage,
      // coché en direct. La noyer dans le journal reviendrait à la cacher.
      if (traduit.nom === OUTIL_TACHES_CURSOR) {
        const brut = (traduit.entree as any)?.todos ?? (traduit.entree as any)?.items;
        onEvent({ kind: 'todo', todos: normalizeTodos(brut) });
        return;
      }

      /*
       * LE PLAN N'EST PAS UNE ÉTAPE NON PLUS : c'est la RÉPONSE du tour. Cursor
       * le pose dans un appel d'outil au lieu de l'écrire dans la conversation
       * (`texteDuPlanCursor`) ; on le remet donc dans le fil, comme le font
       * Claude et Codex, sinon le cadre du plan et ses boutons de décision ne
       * paraissent jamais. Seul l'appel TERMINÉ compte : Cursor annonce le même
       * plan au départ et à l'arrivée, et l'émettre deux fois le doublerait
       * dans la conversation.
       */
      if (traduit.nom === OUTIL_PLAN_CURSOR) {
        if (event.subtype === 'started') return;
        const texte = texteDuPlanCursor(traduit.entree);
        if (texte) onEvent({ kind: 'text', text: texte });
        const brut = (traduit.entree as any)?.todos;
        if (Array.isArray(brut) && brut.length) onEvent({ kind: 'todo', todos: normalizeTodos(brut) });
        return;
      }

      const step = humanStep(traduit.nom, traduit.entree);
      if (event.subtype === 'started') {
        pendingSteps.set(key, step.label);
        onEvent({ kind: 'step', step: { key, label: step.label, state: 'running', detail: step.detail } });
        return;
      }
      const label = pendingSteps.get(key) ?? step.label;
      pendingSteps.delete(key);
      const resultat = resultatDeLOutil(event.tool_call);
      onEvent({
        kind: 'step',
        step: {
          key,
          label,
          state: resultat.echec ? 'failed' : 'done',
          detail: resultat.detail ?? step.detail,
        },
      });
      return;
    }

    case 'result': {
      if (event.session_id) onEvent({ kind: 'session', sessionId: event.session_id });
      const usage = event.usage ?? {};
      const cache = Number(usage.cacheReadTokens ?? 0);
      onEvent({
        kind: 'usage',
        usage: {
          // Cursor compte le cache À PART de `inputTokens` (constaté sur un
          // tour réel : 13 631 en entrée, 29 184 relus). Les deux parts restent
          // donc disjointes, comme le contrat interne l'exige.
          inputTokens: Number(usage.inputTokens ?? 0) + Number(usage.cacheWriteTokens ?? 0),
          outputTokens: Number(usage.outputTokens ?? 0),
          cachedTokens: Number.isFinite(cache) ? cache : undefined,
          durationMs: typeof event.duration_ms === 'number' ? event.duration_ms : undefined,
        },
      });
      if (event.is_error) {
        onEvent({
          kind: 'error',
          error: typeof event.result === 'string' && event.result.trim() ? event.result : 'Le moteur a échoué.',
        });
      }
      // Le texte final est déjà arrivé par les blocs « assistant » : le
      // réémettre ici le ferait apparaître deux fois dans la conversation.
      return;
    }

    default:
      return;
  }
}

/** Ce qu'un appel d'outil terminé a donné : son échec éventuel, et de quoi le lire. */
function resultatDeLOutil(appel: unknown): { echec: boolean; detail?: string } {
  if (!appel || typeof appel !== 'object') return { echec: false };
  const cle = Object.keys(appel as Record<string, unknown>).find((k) => k.endsWith('ToolCall'));
  const resultat = cle ? (appel as Record<string, any>)[cle]?.result : undefined;
  if (!resultat) return { echec: false };
  if (resultat.error) {
    const texte = typeof resultat.error === 'string' ? resultat.error : JSON.stringify(resultat.error);
    return { echec: true, detail: texte.slice(0, 400) };
  }
  const succes = resultat.success ?? resultat;
  const detail =
    typeof succes?.message === 'string'
      ? succes.message
      : typeof succes?.output === 'string'
        ? succes.output
        : undefined;
  return { echec: false, detail: detail?.slice(0, 400) };
}
