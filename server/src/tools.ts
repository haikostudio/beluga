import fs from 'node:fs';
import path from 'node:path';
import {
  AGENT_MOVABLE_COLUMNS,
  AgentQuestion,
  COLUMN_LABELS,
  Card,
  ColumnKey,
  TaskProposal,
  canMove,
} from '@haikodev/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { PATHS } from './config.js';
import { mintDownload } from './auth.js';
import { readMemory, appendMemory, detailMemoire } from './memory.js';
import { synthetiserSiNecessaire } from './synthese-memoire.js';
import { makeZip, safeJoin } from './files.js';
import { log } from './logger.js';

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Les outils du démon, exposés aux agents. Les interdits sont posés ICI, au
 * niveau de l'outil, pas dans la consigne (PLAN §2 principe 3).
 */
export const TOOL_DEFS: ToolDef[] = [
  {
    name: 'board_list_cards',
    description: 'Liste les cartes du tableau du projet, avec leur colonne et leur état.',
    inputSchema: {
      type: 'object',
      properties: { column: { type: 'string', description: 'Filtrer sur une colonne (facultatif)' } },
    },
  },
  {
    name: 'board_create_card',
    description:
      "Propose une carte pour une demande d'ACTION CLAIRE : elle apparaît dans la conversation avec ses boutons valider / refuser, et n'entre dans « À faire » qu'après le clic de l'utilisateur. Rien n'est écrit sur le tableau avant ce clic, et la colonne ne peut pas être choisie. Jamais pour une simple question, qui se répond dans la conversation.",
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string', description: 'Titre court et clair' },
        description: { type: 'string' },
        labels: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'board_update_card',
    description: 'Modifie le titre, la description ou les étiquettes d\'une carte existante.',
    inputSchema: {
      type: 'object',
      required: ['cardId'],
      properties: {
        cardId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        labels: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'board_move_card',
    description:
      "Déplace une carte. Seules les colonnes « notes » et « todo » sont acceptées : toute autre cible est refusée par l'outil.",
    inputSchema: {
      type: 'object',
      required: ['cardId', 'column'],
      properties: {
        cardId: { type: 'string' },
        column: { type: 'string', enum: ['notes', 'todo'] },
      },
    },
  },
  {
    name: 'board_delete_card',
    description: 'Supprime une carte du tableau.',
    inputSchema: { type: 'object', required: ['cardId'], properties: { cardId: { type: 'string' } } },
  },
  {
    name: 'propose_task',
    description:
      "Propose une tâche à l'utilisateur SANS créer de carte : une carte à valider ou refuser apparaît dans la conversation. À utiliser dans les cas ambigus.",
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        labels: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'write_document',
    description:
      'Écrit un document Markdown dans le projet (documentation, compte-rendu). Seul outil d\'écriture autorisé au chef d\'orchestre.',
    inputSchema: {
      type: 'object',
      required: ['relativePath', 'content'],
      properties: {
        relativePath: { type: 'string', description: 'Chemin relatif dans le projet, ex. docs/note.md' },
        content: { type: 'string' },
      },
    },
  },
  {
    name: 'make_archive',
    description:
      "Prépare une archive téléchargeable des fichiers demandés et affiche un bouton de téléchargement dans la conversation.",
    inputSchema: {
      type: 'object',
      required: ['paths'],
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: 'Chemins relatifs au projet' },
        label: { type: 'string' },
      },
    },
  },
  {
    name: 'ask_user',
    description:
      "Pose une question à l'utilisateur et ATTEND sa réponse avant de continuer. À utiliser dès qu'un choix t'appartient pas : options possibles, préférence, information manquante.",
    inputSchema: {
      type: 'object',
      required: ['question'],
      properties: {
        question: { type: 'string', description: 'La question, en une phrase claire' },
        kind: {
          type: 'string',
          enum: ['single', 'multiple', 'text'],
          description: 'single = un seul choix, multiple = plusieurs, text = réponse libre',
        },
        options: {
          type: 'array',
          description: 'Les réponses proposées (pour single ou multiple)',
          items: {
            type: 'object',
            required: ['label'],
            properties: { label: { type: 'string' }, description: { type: 'string' } },
          },
        },
      },
    },
  },
  {
    name: 'project_memory',
    description:
      "Le TEXTE ENTIER des faits de la mémoire du projet. L'index reçu au lancement est tronqué : appelle cet outil dès qu'une ligne de l'index touche à ce que tu vas modifier. Sans argument, il rend l'index complet.",
    inputSchema: {
      type: 'object',
      properties: {
        sujet: {
          type: 'string',
          description:
            "Ce que tu cherches : un numéro de l'index (« 12 »), un nom de sujet (« mobile », « publication »), ou des mots-clés.",
        },
      },
    },
  },
  {
    name: 'remember',
    description:
      "Ajoute une ligne courte et durable à la mémoire du projet (décision, piège, convention). Une ligne devenue fausse est remplacée, jamais empilée.",
    inputSchema: {
      type: 'object',
      required: ['line'],
      properties: {
        line: { type: 'string', description: 'Un fait durable, une seule ligne' },
        replaces: { type: 'string', description: 'Début de la ligne devenue fausse à remplacer (facultatif)' },
      },
    },
  },
];

/** Les outils réservés aux agents de tâche : le chef d'orchestre ne les voit pas. */
export const TASK_ONLY_TOOLS = new Set(['remember']);

export function toolsFor(role: 'task' | 'orchestrator' | 'analysis' | 'deploy'): ToolDef[] {
  if (role === 'orchestrator') return TOOL_DEFS.filter((t) => !TASK_ONLY_TOOLS.has(t.name));
  return TOOL_DEFS;
}

export interface ToolContext {
  agentId: string;
  projectId: string;
  role: 'task' | 'orchestrator' | 'analysis' | 'deploy';
  cardId?: string;
}

export interface ToolResult {
  ok: boolean;
  text: string;
  /** Effets à répercuter dans le fil de conversation. */
  proposal?: TaskProposal;
  question?: AgentQuestion;
  download?: { id: string; label: string; size: number; expiresAt: number };
}

export async function callTool(ctx: ToolContext, name: string, args: Record<string, any>): Promise<ToolResult> {
  const project = store.getProject(ctx.projectId);
  if (!project) return { ok: false, text: "Projet introuvable." };

  switch (name) {
    case 'board_list_cards': {
      const cards = store.listCards(ctx.projectId).filter((c) => !args.column || c.column === args.column);
      if (!cards.length) return { ok: true, text: 'Le tableau est vide.' };
      const lines = cards.map(
        (c) =>
          `- [${c.id}] « ${c.title} » — colonne : ${COLUMN_LABELS[c.column]}${
            c.labels.length ? ` — étiquettes : ${c.labels.join(', ')}` : ''
          }`,
      );
      return { ok: true, text: lines.join('\n') };
    }

    case 'board_create_card': {
      if (!args.title || typeof args.title !== 'string') return { ok: false, text: 'Un titre est obligatoire.' };
      /*
       * Rien n'entre sur le tableau sans un clic de l'utilisateur. L'outil
       * n'écrit donc AUCUNE carte : il affiche une proposition dans la
       * conversation, avec ses boutons valider / refuser. C'est la validation
       * qui fait naître la carte dans « À faire », d'où part ensuite le
       * parcours habituel (analyse, chiffrage, exécution, lot à publier).
       *
       * La règle « toute demande de programmation passe par une carte » reste
       * entière : c'est le mode de création qui change, pas l'obligation.
       */
      const proposal: TaskProposal = {
        id: store.newId(),
        title: String(args.title),
        description: typeof args.description === 'string' ? args.description : '',
        labels: Array.isArray(args.labels) ? args.labels.map(String) : [],
        decision: 'pending',
      };
      return {
        ok: true,
        text:
          `Carte « ${proposal.title} » proposée dans la conversation. ` +
          `Elle n'entrera dans « À faire » qu'après la validation de l'utilisateur.`,
        proposal,
      };
    }

    case 'board_update_card': {
      const card = store.getCard(String(args.cardId));
      if (!card || card.projectId !== ctx.projectId) return { ok: false, text: 'Carte introuvable.' };
      const updated = store.saveCard({
        ...card,
        title: typeof args.title === 'string' ? args.title : card.title,
        description: typeof args.description === 'string' ? args.description : card.description,
        labels: Array.isArray(args.labels) ? args.labels.map(String) : card.labels,
      });
      bus.emit({ type: 'card.upsert', card: updated });
      return { ok: true, text: `Carte mise à jour : ${updated.title}.` };
    }

    case 'board_move_card': {
      const card = store.getCard(String(args.cardId));
      if (!card || card.projectId !== ctx.projectId) return { ok: false, text: 'Carte introuvable.' };
      const target = String(args.column) as ColumnKey;
      const decision = canMove('agent', card.column, target);
      if (!decision.allowed) {
        return {
          ok: false,
          text: `Refusé : ${decision.reason} Colonnes autorisées : ${AGENT_MOVABLE_COLUMNS.join(', ')}.`,
        };
      }
      const updated = store.saveCard({ ...card, column: target, position: store.nextPosition(ctx.projectId, target) });
      bus.emit({ type: 'card.upsert', card: updated });
      return { ok: true, text: `Carte déplacée vers « ${COLUMN_LABELS[target]} ».` };
    }

    case 'board_delete_card': {
      const card = store.getCard(String(args.cardId));
      if (!card || card.projectId !== ctx.projectId) return { ok: false, text: 'Carte introuvable.' };
      store.deleteCard(card.id);
      bus.emit({ type: 'card.delete', id: card.id, projectId: card.projectId });
      return { ok: true, text: `Carte supprimée : ${card.title}.` };
    }

    case 'propose_task': {
      if (!args.title) return { ok: false, text: 'Un titre est obligatoire.' };
      const proposal: TaskProposal = {
        id: store.newId(),
        title: String(args.title),
        description: typeof args.description === 'string' ? args.description : '',
        labels: Array.isArray(args.labels) ? args.labels.map(String) : [],
        decision: 'pending',
      };
      return {
        ok: true,
        text: `Proposition affichée à l'utilisateur : « ${proposal.title} ». Rien n'est créé tant qu'il n'a pas validé.`,
        proposal,
      };
    }

    case 'write_document': {
      const rel = String(args.relativePath ?? '');
      if (!rel.endsWith('.md') && !rel.endsWith('.txt')) {
        return { ok: false, text: 'Seuls les documents .md ou .txt sont autorisés par cet outil.' };
      }
      const full = safeJoin(project.path, rel);
      if (!full) return { ok: false, text: 'Chemin refusé : on ne sort jamais du dossier du projet.' };
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, String(args.content ?? ''), 'utf8');
      return { ok: true, text: `Document écrit : ${rel}.` };
    }

    case 'make_archive': {
      const paths: string[] = Array.isArray(args.paths) ? args.paths.map(String) : [];
      if (!paths.length) return { ok: false, text: 'Aucun fichier demandé.' };
      try {
        const label = String(args.label ?? 'fichiers');
        const zip = await makeZip(project.path, paths, label);
        const token = mintDownload(zip.file, zip.name);
        return {
          ok: true,
          text: `Archive prête : ${zip.name} (${Math.round(zip.size / 1024)} ko). Un bouton de téléchargement est affiché dans la conversation.`,
          download: { id: token, label: zip.name, size: zip.size, expiresAt: Date.now() + 24 * 3600 * 1000 },
        };
      } catch (err: any) {
        return { ok: false, text: `Archive impossible : ${err?.message ?? err}` };
      }
    }

    case 'ask_user': {
      const libelle = String(args.question ?? '').trim();
      if (!libelle) return { ok: false, text: 'La question est vide.' };
      const kind = ['single', 'multiple', 'text'].includes(args.kind) ? args.kind : 'single';
      const options = Array.isArray(args.options)
        ? args.options.slice(0, 8).map((opt: any, index: number) => ({
            id: `o${index}`,
            label: String(opt?.label ?? opt ?? '').slice(0, 120),
            description: typeof opt?.description === 'string' ? opt.description.slice(0, 200) : undefined,
          }))
        : [];

      const question = AgentQuestion.parse({
        id: store.newId(),
        question: libelle,
        kind: options.length ? kind : 'text',
        options,
        allowFreeText: true,
      });
      return {
        ok: true,
        text: "Question posée à l'utilisateur. Attends sa réponse : elle arrivera dans la conversation.",
        question,
      };
    }

    case 'project_memory': {
      // Le détail à la demande : l'index seul part au lancement, le texte
      // entier d'un fait se demande quand le sujet concerne vraiment la tâche.
      return { ok: true, text: detailMemoire(project.path, String(args.sujet ?? '')) };
    }

    case 'remember': {
      if (ctx.role === 'orchestrator') return { ok: false, text: "Cet outil n'est pas autorisé ici." };
      const line = String(args.line ?? '').trim();
      if (!line) return { ok: false, text: 'Ligne vide.' };
      appendMemory(project.path, line, typeof args.replaces === 'string' ? args.replaces : undefined);
      bus.emit({ type: 'memory', projectId: project.id, content: readMemory(project.path) });
      // Au-delà du seuil, un petit modèle relit et resserre — à côté, sans
      // bloquer la tâche en cours.
      synthetiserSiNecessaire(project.path);
      return { ok: true, text: 'Mémoire du projet mise à jour.' };
    }

    default:
      return { ok: false, text: `Outil inconnu : ${name}.` };
  }
}

/** Création d'une carte — passage unique, invariants compris. */
export function createCard(
  projectId: string,
  input: { title: string; description?: string; labels?: string[]; origin?: 'user' | 'agent'; run?: Partial<Card['run']> },
): Card {
  const project = store.getProject(projectId);
  const card = Card.parse({
    id: store.newId(),
    projectId,
    title: input.title.slice(0, 200),
    description: input.description ?? '',
    labels: input.labels ?? [],
    // Le champ « colonne » est ignoré à la création : invariant 1.
    column: 'todo' as ColumnKey,
    position: store.nextPosition(projectId, 'todo'),
    origin: input.origin ?? 'user',
    run: {
      engine: input.run?.engine ?? project?.defaultEngine ?? 'claude',
      model: input.run?.model ?? project?.defaultModel,
      thinking: input.run?.thinking ?? 'none',
      mode: input.run?.mode ?? 'direct',
    },
    scheduling: { asap: false, attempts: 0, restarts: 0 },
    excludedFromDeploy: false,
    createdAt: store.now(),
    updatedAt: store.now(),
  });
  return store.saveCard(card);
}

/* ------------------------------------------------------------------ */
/* Interdits du chef d'orchestre (PLAN §5)                             */
/* ------------------------------------------------------------------ */

/**
 * Liste EXPLICITE, pas un joker : tout outil du moteur doit être classé.
 * Un outil ajouté plus tard par une mise à jour du CLI est bloqué par défaut
 * (voir le test de complétude dans test/orchestrator-tools.test.ts).
 */
export const ORCHESTRATOR_ALLOWED_NATIVE = [
  'Read',
  'Grep',
  'Glob',
  'WebFetch',
  'WebSearch',
  'ToolSearch',
  // La liste de tâches ne touche à rien : elle affiche seulement le déroulé
  // annoncé, coché en direct dans la conversation. « TodoWrite » est l'ancien
  // nom ; les versions récentes du moteur parlent « TaskCreate / TaskUpdate ».
  // Les oublier revenait à interdire le déroulé visible au chef bridé sous
  // Claude, alors que Codex l'annonçait sans entrave : une divergence entre
  // moteurs pour une règle qui doit être la même partout.
  'TodoWrite',
  'TaskCreate',
  'TaskUpdate',
  'TaskList',
  'TaskGet',
];

export const ORCHESTRATOR_DENIED_NATIVE = [
  'Edit',
  'Write',
  'NotebookEdit',
  'Bash',
  'BashOutput',
  'KillShell',
  'Task',
  'Agent',
  // Apparu avec une mise à jour du moteur : lance des agents en masse, donc
  // interdit au chef d'orchestre (repéré par le test de complétude, 02/08/2026).
  'Workflow',
  'SlashCommand',
  'Skill',
  'CronCreate',
  'CronDelete',
  'CronList',
  // « TaskCreate », « TaskUpdate », « TaskList » et « TaskGet » ne lancent
  // AUCUN agent : ce sont la liste de tâches affichée dans la conversation, au
  // même titre que « TodoWrite ». Les interdire privait le chef bridé du
  // déroulé visible sous Claude, alors que Codex l'annonçait librement.
  // Lancer un travail en arrière-plan reste interdit : « Task », « Agent »,
  // « Workflow » plus haut, et l'arrêt / la lecture d'un travail ci-dessous.
  'TaskStop',
  'TaskOutput',
  'ScheduleWakeup',
  'SendMessage',
  'Monitor',
  'PushNotification',
  'RemoteTrigger',
  'DesignSync',
  'EnterWorktree',
  'ExitWorktree',
  'EnterPlanMode',
  'ExitPlanMode',
  'ReportFindings',
  'Artifact',
  'AskUserQuestion',
];

/** Les outils du démon autorisés au chef d'orchestre, préfixés pour le CLI. */
export function orchestratorAllowList(): string[] {
  return [
    ...ORCHESTRATOR_ALLOWED_NATIVE,
    ...toolsFor('orchestrator').map((t) => `mcp__haikodev__${t.name}`),
  ];
}

export function orchestratorDenyList(): string[] {
  return [...ORCHESTRATOR_DENIED_NATIVE, ...[...TASK_ONLY_TOOLS].map((t) => `mcp__haikodev__${t}`)];
}

export function writeMcpConfig(filePath: string, token: string, url: string, agentId: string, bridgePath: string): void {
  const config = {
    mcpServers: {
      haikodev: {
        command: process.execPath,
        args: [bridgePath],
        env: { HAIKODEV_TOKEN: token, HAIKODEV_URL: url, HAIKODEV_AGENT: agentId },
      },
    },
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
  log.debug(`configuration d'outils écrite pour l'agent ${agentId}`);
}
