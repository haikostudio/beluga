import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  AGENT_MOVABLE_COLUMNS,
  AgentQuestion,
  COLUMN_LABELS,
  Card,
  ColumnKey,
  Estimate,
  RunConfig,
  SouhaitReglages,
  TaskProposal,
  canMove,
  heritageAnalyseDeProposition,
  repriseAutorisee,
  reglagesDeLaProposition,
  composerDescription,
  jugerDescription,
  MAX_SIGNES_DESCRIPTION,
  MIN_SIGNES_DESCRIPTION,
  RAISON_ATTENTE_LANCEMENT,
} from '@haikodev/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { PATHS } from './config.js';
import { mintDownload } from './auth.js';
import { readMemory, appendMemory, detailProjet } from './memory.js';
import { synthetiserSiNecessaire } from './synthese-memoire.js';
import { makeZip, safeJoin } from './files.js';
import { log } from './logger.js';
import { catalogueMoteurs } from './catalogue-moteurs.js';
import { listerCompetences } from './competences.js';

const execFileAsync = promisify(execFile);

/**
 * LE SCRIPT DE LA COMPÉTENCE DE FACTURATION.
 *
 * L'outil `compta` (ci-dessous) lance ce script — jamais un chemin écrit en dur
 * vers le dossier personnel d'un compte. On le déduit de la compétence
 * partagée « compta » : son dossier (`data/competences/compta`, un lien ou un
 * vrai dossier) porte `scripts/compta.mjs`. Absente : `undefined`, et l'outil le
 * dit au lieu d'échouer sur un chemin inventé.
 */
function cheminScriptCompta(): string | undefined {
  const compta = listerCompetences().find((c) => c.nom === 'compta');
  if (!compta) return undefined;
  const script = path.join(compta.dossier, 'scripts', 'compta.mjs');
  return fs.existsSync(script) ? script : undefined;
}

/** Les commandes du script de facturation (voir le SKILL.md de la compétence). */
const COMMANDES_COMPTA = [
  'companies',
  'clients',
  'client-create',
  'list',
  'get',
  'create',
  'update',
  'set-items',
  'add-items',
  'add-payment',
  'convert',
  'relance',
  'delete',
  'goal',
  'report',
  'raw',
];

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Le même texte pour les DEUX outils de proposition, et donc pour les deux
 * moteurs : ce qu'on attend d'une description n'est pas laissé au modèle.
 */
const CHAMP_DESCRIPTION =
  'Quatre parties annoncées — Constat (ce que fait le projet aujourd’hui, avec un repère concret que tu as VU : fichier, commande, ' +
  'libellé affiché, règle existante), Attendu, Limites, Vérification. ' +
  `Entre ${MIN_SIGNES_DESCRIPTION} et ${MAX_SIGNES_DESCRIPTION} signes. Une description pauvre est REFUSÉE et rendue à réécrire. ` +
  'Les quatre champs séparés (constat, attendu, limites, verification) font le même travail : HaikoDev les met en forme.';

/**
 * Le chef vient de lire le projet pour produire la description : ce travail
 * est déjà l'analyse de la future carte. On lui demande donc, dans le MÊME
 * appel d'outil, les chiffres futurs et un relais factuel pour l'exécution.
 */
const CHAMP_ANALYSE = {
  type: 'object',
  required: ['machineSeconds', 'seniorHours', 'context'],
  description:
    "Chiffrage et relais issus de l'analyse que tu viens de faire. Ils évitent à la carte de recommencer la même étude après validation.",
  properties: {
    machineSeconds: { type: 'number', description: "Durée machine prévue pour l'exécution, en secondes" },
    seniorHours: { type: 'number', description: "Temps d'un développeur senior à la main, en heures" },
    projection: {
      type: 'object',
      properties: {
        tokens: { type: 'number' },
        quotaShare: { type: 'number' },
        formula: { type: 'string' },
        assumptions: { type: 'array', items: { type: 'string' } },
      },
    },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    summary: { type: 'string', description: 'Résumé court du travail prévu' },
    billingTitle: { type: 'string' },
    billingDescription: { type: 'string' },
    context: {
      type: 'string',
      description:
        "Relais factuel pour l'agent : constats utiles, fichiers concernés, approche retenue et contrôles à rejouer. Ne recopie pas toute la carte.",
    },
  },
};

/** Ignore toute prétendue mesure : elle sera ajoutée par le démon en fin de tour. */
function analyseDeProposition(args: any): Pick<TaskProposal, 'estimate' | 'analysisContext'> | Record<string, never> {
  const raw = args?.analysis;
  const analysisContext = typeof raw?.context === 'string' ? raw.context.trim().slice(0, 12_000) : '';
  if (!analysisContext) return {};
  const projection = raw?.projection && typeof raw.projection === 'object' ? raw.projection : {};
  const estimate = Estimate.safeParse({
    machineSeconds: raw.machineSeconds,
    tokens: projection.tokens,
    quotaShare: projection.quotaShare,
    projection: {
      tokens: projection.tokens,
      quotaShare: projection.quotaShare,
      formula: projection.formula,
      assumptions: Array.isArray(projection.assumptions) ? projection.assumptions : [],
    },
    confidence: raw.confidence ?? 'medium',
    summary: raw.summary,
    seniorHours: raw.seniorHours,
    billingTitle: raw.billingTitle,
    billingDescription: raw.billingDescription,
    failed: false,
  });
  if (!estimate.success || (estimate.data.machineSeconds === undefined && estimate.data.seniorHours === undefined)) {
    return {};
  }
  return { estimate: estimate.data, analysisContext };
}

/**
 * Fabrique la description d'une proposition, à partir des quatre champs
 * séparés OU du texte libre, puis la juge. Une description qui ne tient pas
 * debout ne devient PAS une proposition : elle est rendue au moteur avec le
 * gabarit, et le chef recommence. C'est le seul endroit où l'exigence est
 * appliquée — les deux outils du chef passent par ici.
 */
function descriptionDeProposition(args: any): { description: string } | { refus: string } {
  const parties = {
    constat: typeof args.constat === 'string' ? args.constat : '',
    attendu: typeof args.attendu === 'string' ? args.attendu : '',
    limites: typeof args.limites === 'string' ? args.limites : '',
    verification: typeof args.verification === 'string' ? args.verification : '',
  };
  const composee = composerDescription(parties);
  const libre = typeof args.description === 'string' ? args.description.trim() : '';
  // Les champs séparés l'emportent : c'est HaikoDev qui met alors en forme.
  const description = composee || libre;

  const verdict = jugerDescription(description);
  if (!verdict.ok) return { refus: verdict.message };
  return { description };
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
      "Propose une carte pour une demande d'ACTION CLAIRE : elle apparaît dans la conversation avec ses boutons valider / refuser, et n'entre dans « Planifié » qu'après le clic de l'utilisateur. Rien n'est écrit sur le tableau avant ce clic, et la colonne ne peut pas être choisie. Jamais pour une simple question, qui se répond dans la conversation.",
    inputSchema: {
      type: 'object',
      required: ['title', 'analysis'],
      properties: {
        title: { type: 'string', description: 'Titre court et clair' },
        description: { type: 'string', description: CHAMP_DESCRIPTION },
        constat: { type: 'string', description: "Ce que le projet fait aujourd'hui, avec un repère concret vu dans le projet" },
        attendu: { type: 'string', description: 'Ce que le projet doit faire une fois la carte terminée' },
        limites: { type: 'string', description: "Ce qu'on ne touche pas, ni n'élargit" },
        verification: { type: 'string', description: "Comment savoir que c'est fait" },
        labels: { type: 'array', items: { type: 'string' } },
        analysis: CHAMP_ANALYSE,
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
      "Déplace une carte. Seules les colonnes « notes » et « planned » sont acceptées : toute autre cible est refusée par l'outil.",
    inputSchema: {
      type: 'object',
      required: ['cardId', 'column'],
      properties: {
        cardId: { type: 'string' },
        column: { type: 'string', enum: ['notes', 'planned'] },
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
      required: ['title', 'analysis'],
      properties: {
        title: { type: 'string' },
        description: { type: 'string', description: CHAMP_DESCRIPTION },
        constat: { type: 'string', description: "Ce que le projet fait aujourd'hui, avec un repère concret vu dans le projet" },
        attendu: { type: 'string', description: 'Ce que le projet doit faire une fois la carte terminée' },
        limites: { type: 'string', description: "Ce qu'on ne touche pas, ni n'élargit" },
        verification: { type: 'string', description: "Comment savoir que c'est fait" },
        labels: { type: 'array', items: { type: 'string' } },
        analysis: CHAMP_ANALYSE,
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
      "Le TEXTE ENTIER de la mémoire du projet À LA DEMANDE : les FAITS (dont l'index reçu au lancement est tronqué), MAIS AUSSI les RÈGLES du moteur et les CONTRÔLES, rangés par sujet. Appelle-le dès qu'une ligne de l'index — ou le sujet de ta tâche — touche à ce que tu vas modifier : tu recevras d'un coup les faits, les règles et les scripts de vérification qui le concernent. Sans argument, il rend l'index des faits et la liste des sujets de règles.",
    inputSchema: {
      type: 'object',
      properties: {
        sujet: {
          type: 'string',
          description:
            "Ce que tu cherches : un numéro de l'index de faits (« 12 »), un nom de sujet (« publication », « cartes », « voix », « quotas »…), ou des mots-clés.",
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
  {
    name: 'compta',
    description:
      "Exécute une opération de FACTURATION Haiko (compta.haikostudio.cloud) : lire, lister, créer ou modifier " +
      "offres, factures, clients et paiements. Ouvert à TOUT agent, chef d'orchestre compris — c'est le seul moyen, " +
      "pour un chef bridé en lecture seule, d'atteindre l'outil de facturation. Commandes : companies, clients, " +
      "client-create, list, get, create, update, set-items, add-items, add-payment, convert, relance, delete, goal, " +
      "report, raw. La syntaxe exacte de chaque commande et le format des specs JSON sont dans le mode d'emploi de la " +
      "compétence « compta » (data/competences/compta/SKILL.md) — le lire avant d'appeler. Garde-fous inchangés : " +
      "créer TOUJOURS en brouillon (draft) et ne passer un document en sent/paid/accepted que sur demande explicite ; " +
      "« relance » avec send:true UNIQUEMENT après validation explicite de l'utilisateur (montrer d'abord l'aperçu, " +
      "sans send). Rend la sortie JSON du script telle quelle.",
    inputSchema: {
      type: 'object',
      required: ['command'],
      properties: {
        command: {
          type: 'string',
          enum: COMMANDES_COMPTA,
          description: 'La commande de facturation à lancer',
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description:
            "Les arguments de la commande, dans l'ordre du mode d'emploi. Un spec JSON se passe comme un SEUL " +
            'argument (une chaîne JSON), ex. get → ["invoice", "FA-0012"], create → ["quote", "{…json…}"].',
        },
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
  /**
   * Les réglages de la CONVERSATION en cours (moteur, modèle, réflexion),
   * ceux qu'on voit dans la barre d'écriture. Une carte proposée en hérite :
   * discuter avec Codex et se voir proposer du Claude n'a aucun sens.
   */
  run?: SouhaitReglages;
}

/**
 * Les réglages à poser sur une carte proposée : ceux de la conversation,
 * ramenés vers un modèle qui existe VRAIMENT chez le moteur retenu.
 */
async function reglagesProposes(
  souhait: SouhaitReglages | undefined,
): Promise<{ run?: RunConfig; avertissement?: string }> {
  try {
    const retenu = reglagesDeLaProposition(souhait, await catalogueMoteurs());
    if (!retenu) return {};
    return {
      run: RunConfig.parse({ engine: retenu.engine, model: retenu.model, thinking: retenu.thinking }),
      avertissement: retenu.avertissement,
    };
  } catch (err) {
    // Catalogue illisible : la proposition reste affichable sans réglage, elle
    // repartira sur le moteur par défaut du projet. Mieux qu'aucune carte.
    log.warn('réglages de la proposition : catalogue des moteurs illisible', err);
    return {};
  }
}

/**
 * Les pièces jointes du message qui vient de déclencher la proposition : le
 * DERNIER message de l'utilisateur dans cette conversation. On ne remonte pas
 * plus haut — seules les images de ce message-là suivent la carte, jamais tout
 * l'historique.
 */
function imagesDuMessageDeclencheur(agentId: string): string[] {
  const messages = store.listMessages(agentId);
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i].attachments ?? [];
  }
  return [];
}

/** Ce que le moteur doit LIRE de ce qu'on vient de poser sur la proposition. */
function resumeReglages(reglages: { run?: RunConfig; avertissement?: string }): string {
  if (!reglages.run) return '';
  const modele = reglages.run.model ? ` / ${reglages.run.model}` : '';
  return (
    ` Réglages repris de cette conversation : ${reglages.run.engine}${modele} (réflexion : ${reglages.run.thinking}).` +
    (reglages.avertissement ? ` ${reglages.avertissement}` : '')
  );
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
       * qui fait naître la carte dans « Planifié », d'où part ensuite le
       * parcours habituel (chiffrage, lancement, exécution, lot à publier).
       *
       * La règle « toute demande de programmation passe par une carte » reste
       * entière : c'est le mode de création qui change, pas l'obligation.
       *
       * Et rien ne s'affiche tant que la DESCRIPTION ne tient pas debout :
       * une carte pauvre condamne l'agent qui l'exécutera.
       */
      const texte = descriptionDeProposition(args);
      if ('refus' in texte) return { ok: false, text: texte.refus };

      const reglages = await reglagesProposes(ctx.run);
      const analyse = analyseDeProposition(args);
      const proposal: TaskProposal = {
        id: store.newId(),
        title: String(args.title),
        description: texte.description,
        labels: Array.isArray(args.labels) ? args.labels.map(String) : [],
        // Les images jointes au message qui a fait naître la proposition
        // suivent la carte jusqu'à l'agent d'exécution.
        attachments: imagesDuMessageDeclencheur(ctx.agentId),
        ...analyse,
        ...(reglages.run ? { run: reglages.run } : {}),
        ...(reglages.avertissement ? { avertissement: reglages.avertissement } : {}),
        decision: 'pending',
      };
      return {
        ok: true,
        text:
          `Carte « ${proposal.title} » proposée dans la conversation. ` +
          `Elle n'entrera dans « Planifié » qu'après la validation de l'utilisateur.` +
          resumeReglages(reglages),
        proposal,
      };
    }

    case 'board_update_card': {
      const card = store.getCard(String(args.cardId));
      if (!card || card.projectId !== ctx.projectId) return { ok: false, text: 'Carte introuvable.' };
      const title = typeof args.title === 'string' ? args.title : card.title;
      const description = typeof args.description === 'string' ? args.description : card.description;
      const updated = store.saveCard({
        ...card,
        title,
        description,
        labels: Array.isArray(args.labels) ? args.labels.map(String) : card.labels,
        ...heritageAnalyseDeProposition(card, title, description),
      });
      bus.emit({ type: 'card.upsert', card: updated });
      return { ok: true, text: `Carte mise à jour : ${updated.title}.` };
    }

    case 'board_move_card': {
      const card = store.getCard(String(args.cardId));
      if (!card || card.projectId !== ctx.projectId) return { ok: false, text: 'Carte introuvable.' };
      const target = String(args.column) as ColumnKey;
      /*
       * Une fin de parcours ne se rouvre que sur geste humain. Le refus se dit
       * ici en toutes lettres, plutôt que de laisser `canMove` répondre « cette
       * colonne appartient au pipeline » — l'agent doit comprendre que c'est
       * l'utilisateur, et lui seul, qui peut sortir la carte de là.
       */
      const reprise = repriseAutorisee(card.column, 'automatique');
      if (!reprise.possible && card.column !== target) {
        return { ok: false, text: `Refusé : ${reprise.raison}` };
      }
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
      // Même exigence que board_create_card : une proposition sans description
      // solide n'est pas affichée, elle est rendue à réécrire.
      const texte = descriptionDeProposition(args);
      if ('refus' in texte) return { ok: false, text: texte.refus };

      const reglages = await reglagesProposes(ctx.run);
      const analyse = analyseDeProposition(args);
      const proposal: TaskProposal = {
        id: store.newId(),
        title: String(args.title),
        description: texte.description,
        labels: Array.isArray(args.labels) ? args.labels.map(String) : [],
        // Mêmes images que board_create_card : celles du message déclencheur.
        attachments: imagesDuMessageDeclencheur(ctx.agentId),
        ...analyse,
        ...(reglages.run ? { run: reglages.run } : {}),
        ...(reglages.avertissement ? { avertissement: reglages.avertissement } : {}),
        decision: 'pending',
      };
      return {
        ok: true,
        text:
          `Proposition affichée à l'utilisateur : « ${proposal.title} ». Rien n'est créé tant qu'il n'a pas validé.` +
          resumeReglages(reglages),
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
      // Le détail à la demande : l'index seul part au lancement ; le texte
      // entier des faits, des règles et des contrôles d'un sujet se demande
      // quand ce sujet concerne vraiment la tâche — et UNE SEULE FOIS par
      // session : un sujet déjà servi n'est pas repayé.
      const servi = detailProjet(project.path, String(args.sujet ?? ''), store.sujetsMemoireServis(ctx.agentId));
      store.marquerSujetsMemoireServis(ctx.agentId, servi.servis);
      return { ok: true, text: servi.texte };
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

    case 'compta': {
      const commande = String(args.command ?? '').trim();
      if (!commande) return { ok: false, text: 'Une commande de facturation est requise (ex. « get », « list »).' };
      if (!COMMANDES_COMPTA.includes(commande)) {
        return { ok: false, text: `Commande de facturation inconnue : « ${commande} ». Voir le mode d'emploi de la compétence compta.` };
      }
      const script = cheminScriptCompta();
      if (!script) {
        return {
          ok: false,
          text: "La compétence de facturation « compta » est introuvable : aucun scripts/compta.mjs dans le dossier des compétences.",
        };
      }
      const reste = Array.isArray(args.args) ? args.args.map((a: any) => String(a)) : [];
      try {
        // Le script tourne dans le processus du démon (sous l'utilisateur des
        // agents), donc HORS du bac à sable du chef bridé : c'est ce qui ouvre
        // la facturation au chef en lecture seule. Il lit sa clé API dans le
        // dossier personnel courant, d'où l'environnement hérité tel quel.
        const { stdout } = await execFileAsync(process.execPath, [script, commande, ...reste], {
          timeout: 60000,
          maxBuffer: 8 * 1024 * 1024,
        });
        return { ok: true, text: stdout.trim() || '(aucune sortie)' };
      } catch (err: any) {
        // compta.mjs écrit ses erreurs sur stderr et sort en code 1 : on remonte
        // la raison en clair plutôt qu'un « échec » muet.
        const detail = String(err?.stderr || err?.message || err).trim();
        return { ok: false, text: `Facturation : ${detail || 'commande échouée sans détail.'}` };
      }
    }

    default:
      return { ok: false, text: `Outil inconnu : ${name}.` };
  }
}

/** Création d'une carte — passage unique, invariants compris. */
export function createCard(
  projectId: string,
  input: {
    title: string;
    description?: string;
    labels?: string[];
    origin?: 'user' | 'agent';
    run?: Partial<Card['run']>;
    /** Images héritées de la proposition (jointes au chef d'orchestre). */
    attachments?: string[];
    /** Chiffrage préparé par le chef, déjà mesuré en fin de son tour. */
    estimate?: Card['estimate'];
    /** Relais factuel qui évite à l'exécution de recommencer l'étude. */
    analysisContext?: string;
  },
): Card {
  const project = store.getProject(projectId);
  const card = Card.parse({
    id: store.newId(),
    projectId,
    title: input.title.slice(0, 200),
    description: input.description ?? '',
    labels: input.labels ?? [],
    attachments: input.attachments ?? [],
    estimate: input.estimate,
    analysisContext: input.analysisContext,
    // Le champ « colonne » est ignoré à la création : invariant 1. Une carte
    // naît dans « Planifié » — il n'y a plus de colonne d'attente avant elle.
    // Naître là ne fait rien démarrer : le lancement reste un geste humain.
    column: 'planned' as ColumnKey,
    position: store.nextPosition(projectId, 'planned'),
    origin: input.origin ?? 'user',
    run: {
      engine: input.run?.engine ?? project?.defaultEngine ?? 'claude',
      model: input.run?.model ?? project?.defaultModel,
      thinking: input.run?.thinking ?? 'none',
      mode: input.run?.mode ?? 'direct',
    },
    scheduling: {
      asap: false,
      attempts: 0,
      restarts: 0,
      /*
       * Une carte qui naît DÉJÀ chiffrée (l'analyse du chef d'orchestre voyage
       * avec sa proposition) attend son lancement, et le DIT — exactement comme
       * une carte qui sort de son analyse. Sans chiffrage, rien à annoncer : la
       * carte vient d'être posée.
       */
      ...(input.estimate && !input.estimate.failed ? { waitingReason: RAISON_ATTENTE_LANCEMENT } : {}),
    },
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
  // Le chef a TOUS LES DROITS SAUF modifier le code du projet : le shell lui est
  // ouvert (sondages, études, analyses, écritures de brouillon dans son dossier
  // de travail). Ce qui garde le PROJET intouchable n'est pas l'absence de ces
  // outils, mais le bac à sable : le projet est monté en lecture seule, une
  // commande qui tente d'y écrire échoue. Les outils d'ÉDITION de fichiers
  // (« Edit », « Write », « NotebookEdit »), eux, restent interdits plus bas —
  // la ceinture par-dessus le bac à sable. Voir `shared/src/bridage-chef.ts`.
  'Bash',
  'BashOutput',
  'KillShell',
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
  // Les outils d'ÉDITION restent fermés au chef : modifier le code du projet
  // s'ouvre en carte confiée à un agent de tâche (règle absolue). Le shell, lui,
  // est désormais PERMIS plus haut ; c'est le bac à sable qui garde le projet en
  // lecture seule, pas l'absence de « Bash ».
  'Edit',
  'Write',
  'NotebookEdit',
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
