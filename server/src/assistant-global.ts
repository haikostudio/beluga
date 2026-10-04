/**
 * L'ASSISTANT GLOBAL — côté démon (règles pures : `shared/src/assistant-global.ts`).
 *
 * UN SEUL AGENT, GARDÉ D'UNE OUVERTURE À L'AUTRE (`meta` de la base), comme
 * l'agent « Ajouter un moteur » : sa conversation se retrouve fenêtre refermée,
 * page rechargée, démon redémarré. « Repartir de zéro » vide son contexte comme
 * pour tout agent. Il n'a NI carte NI branche : il ne livre pas de code. Son
 * dossier de travail est HORS de tout dépôt.
 *
 * SES OUTILS : ceux du démon qu'il lui faut (`OUTILS_DE_L_ASSISTANT`), plus six
 * qui n'existent que pour lui (résumé, notes, messagerie de l'espace client,
 * surveillances, sauvegardes, bases des serveurs). Chacun accepte « projet »
 * pour viser n'importe quel projet.
 *
 * LA PORTE D'ACCORD est posée dans le pont (`server/src/http.ts`) : chaque
 * appel est classé puis, s'il le faut, suspendu sur « Autoriser / Refuser »
 * jusqu'au clic. Ce module fournit les morceaux : préparation de l'appel,
 * exécution, et la suite qui n'exécute qu'après l'accord.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import Database from 'better-sqlite3';
import {
  Agent,
  AgentQuestion,
  COLUMN_LABELS,
  OUTILS_DE_L_ASSISTANT,
  OUTILS_PROPRES_A_L_ASSISTANT,
  REPONSE_AUTORISER_ASSISTANT,
  REPONSE_REFUSER_ASSISTANT,
  TITRE_ASSISTANT_GLOBAL,
  accordDonne,
  apercuDuGeste,
  decisionDAccord,
  genreDeLAppel,
  niveauDuTourDeLAssistant,
  reglageNiveauAssistant,
  reglagesDuTourDeLAssistant,
  type MoteurCatalogue,
  type NiveauAgent,
  type ReglageNiveauAssistant,
  questionDAccord,
  texteDeRefus,
  trouverLeProjetVise,
  type GenreDeGeste,
} from '@beluga/shared';
import { getMeta, setMeta } from './db.js';
import { bus } from './bus.js';
import { CONFIG } from './config.js';
import * as store from './store.js';
import { TOOL_DEFS, callTool, type ToolContext, type ToolDef, type ToolResult } from './tools.js';
import { enregistrerNote, listerNotes, supprimerNote } from './notes.js';
import * as espace from './espace-client.js';
import { commandeDeLEspaceClient } from './espace-commandes.js';
import { listerComptes } from './comptes.js';
import {
  listerControles,
  listerSites as listerSurveillances,
  lireSurveillance,
  supprimerSite as supprimerSurveillance,
  verifierSites,
} from './surveillance.js';
import {
  listerPoints,
  listerSites as listerSitesBackups,
  lireSite as lireSiteBackup,
  prendreUnBackup,
  supprimerSite as supprimerSiteBackup,
} from './backups.js';
import { listerAcces } from './coffre-fort.js';
import { log } from './logger.js';

const CLE_AGENT = 'assistant.agent';
const CLE_VALIDATION = 'assistant.validationAuto';
const CLE_PLAFOND = 'assistant.plafond';
const CLE_FIGE = 'assistant.modeFige';

/* ------------------------------------------------------------------ */
/* L'agent et son interrupteur                                          */
/* ------------------------------------------------------------------ */

export function estAssistantGlobal(agent: Pick<Agent, 'assistantGlobal'> | null | undefined): boolean {
  return Boolean(agent?.assistantGlobal);
}

/** L'interrupteur « validation automatique », éteint par défaut. */
export function validationAutomatique(): boolean {
  return getMeta(CLE_VALIDATION) === '1';
}

export function reglerValidationAutomatique(auto: boolean): boolean {
  setMeta(CLE_VALIDATION, auto ? '1' : '0');
  return auto;
}

/** Le niveau de l'assistant : automatique sous un plafond (« standard » par défaut), ou figé. */
export function reglageDuNiveau(): ReglageNiveauAssistant {
  return reglageNiveauAssistant(getMeta(CLE_PLAFOND), getMeta(CLE_FIGE) === '1');
}

export function reglerLeNiveau(patch: { mode?: 'auto' | 'fige'; plafond?: NiveauAgent }): ReglageNiveauAssistant {
  if (patch.plafond) setMeta(CLE_PLAFOND, patch.plafond);
  if (patch.mode) setMeta(CLE_FIGE, patch.mode === 'fige' ? '1' : '0');
  return reglageDuNiveau();
}

/**
 * LE MODÈLE DE CE TOUR, choisi AVANT la clé de session. Figé : rien, le modèle
 * de l'agent fait foi (DEC-213). Auto : le juge rapide (repli « standard », donc
 * aussi quand l'usage est éteint), sous le plafond, traduit en modèle RÉEL du
 * moteur de l'agent. L'agent n'est réécrit que pour un vrai changement : un
 * autre modèle ouvre un fil moteur neuf. Ne lève jamais.
 */
export async function appliquerLeNiveauDeLAssistant(
  agent: Agent,
  texte: string,
  juger: (texte: string) => Promise<NiveauAgent | undefined>,
  moteurs: MoteurCatalogue[],
): Promise<Agent> {
  try {
    const reglage = reglageDuNiveau();
    if (reglage.mode === 'fige') return agent;
    const niveau = niveauDuTourDeLAssistant(await juger(texte), reglage.plafond);
    const moteur = moteurs.find((m) => m?.id === agent.run.engine);
    const voulu = reglagesDuTourDeLAssistant(moteur, niveau, agent.run);
    const dernier = store.getAgent(agent.id) ?? agent;
    if (!voulu) return dernier.niveauServi === niveau ? dernier : sauver({ ...dernier, niveauServi: niveau });
    return sauver({
      ...dernier,
      run: { ...dernier.run, ...voulu },
      niveauServi: niveau,
      // Un autre modèle ouvre un autre fil : l'ancienne mesure ne le décrit plus.
      contextUsage: undefined,
    });
  } catch (err) {
    log.warn(`niveau de l'assistant : ${(err as Error).message}`);
    return agent;
  }
}

/**
 * L'agent ouvert sans modèle (création, ou assistant d'avant ce réglage) porte
 * d'emblée celui du niveau « standard » sous le plafond, au lieu du modèle par
 * défaut du moteur : l'écran le montre avant même le premier message.
 */
export async function poserLeModeleDeDepart(agent: Agent, moteurs: MoteurCatalogue[]): Promise<Agent> {
  if (agent.run.model || reglageDuNiveau().mode === 'fige') return agent;
  return appliquerLeNiveauDeLAssistant(agent, '', async () => undefined, moteurs);
}

function sauver(agent: Agent): Agent {
  const enregistre = store.saveAgent(agent);
  bus.emit({ type: 'agent.upsert', agent: enregistre });
  return enregistre;
}

/** Le projet qui porte l'agent : Beluga Build lui-même ; à défaut, le premier projet. */
function projetDeLAssistant(): string | null {
  const projets = store.listProjects();
  const beluga = projets.find((p) => path.resolve(p.path) === path.resolve(CONFIG.depotDuDemon));
  return (beluga ?? projets[0])?.id ?? null;
}

/** Son dossier de travail : HORS de tout dépôt — il ne lit ni n'écrit le code d'un projet. */
function atelier(): string {
  const dossier = path.join(CONFIG.homeDir || os.homedir(), '.beluga', 'atelier-assistant');
  fs.mkdirSync(dossier, { recursive: true });
  return dossier;
}

export function agentAssistantGlobal(neuf = false): Agent | null {
  const retenuId = neuf ? null : getMeta(CLE_AGENT);
  const retenu = retenuId ? store.getAgent(retenuId) : null;
  if (retenu && estAssistantGlobal(retenu)) return retenu;
  const projectId = projetDeLAssistant();
  if (!projectId) return null;
  const agent = store.saveAgent({
    ...Agent.parse({
      id: store.newId(),
      projectId,
      role: 'deploy',
      title: TITRE_ASSISTANT_GLOBAL,
      workdir: atelier(),
      run: { engine: 'claude', thinking: 'none' },
      status: 'idle',
      createdAt: store.now(),
      updatedAt: store.now(),
    }),
    assistantGlobal: true,
  });
  setMeta(CLE_AGENT, agent.id);
  bus.emit({ type: 'agent.upsert', agent });
  return agent;
}

/* ------------------------------------------------------------------ */
/* Les outils servis                                                    */
/* ------------------------------------------------------------------ */

/** Les deux outils qui ont déjà leur propre « projet » (le projet à gérer). */
const OUTILS_A_PROJET_PROPRE = new Set(['project_manage', 'group_manage']);

const CHAMP_PROJET = {
  type: 'string',
  description: 'Le projet visé, par son NOM ou son identifiant. Sans lui : Beluga Build (ou tous les projets pour une liste).',
};
const CHAMP_POURQUOI = {
  type: 'string',
  description: 'Une phrase simple : ce que fait ce geste et pourquoi. Elle s’affiche avec la demande d’accord.',
};

const OUTILS_PROPRES: ToolDef[] = [
  {
    name: 'assistant_resume',
    description:
      "Le RÉSUMÉ de Beluga : chaque projet avec ses cartes par colonne, les agents au travail, les décisions qui attendent l'utilisateur et les messages clients non lus. Avec « projet » : le détail des cartes de ce projet.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'assistant_notes',
    description:
      'Les NOTES (service Notes) de tous les projets. Actions : lister (« projet » facultatif), lire (id), creer (projet, titre, description?, echeance AAAA-MM-JJ?, importance haute|moyenne|basse|aucune), modifier (id + champs), supprimer (id).',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['lister', 'lire', 'creer', 'modifier', 'supprimer'] },
        id: { type: 'string' },
        titre: { type: 'string' },
        description: { type: 'string' },
        echeance: { type: 'string', description: 'AAAA-MM-JJ, ou vide pour l’effacer' },
        importance: { type: 'string', enum: ['haute', 'moyenne', 'basse', 'aucune'] },
      },
    },
  },
  {
    name: 'assistant_messagerie',
    description:
      "La MESSAGERIE de l'espace client (demandes des clients et fils de discussion). Actions : en_attente (ce qui attend une réponse de l'administration, tous projets), lister (« projet » facultatif ; les demandes et leur colonne), lire (id d'une demande : fiche et commentaires), fil_lire (filId), repondre (id, texte : commentaire sur une demande), fil_envoyer (filId, texte), creer (projet, titre, description?, importance basse|normale|haute|urgente), modifier (id, titre?, description?, importance?), deplacer (id, colonne a-faire|en-cours|termine|valide), archiver (id). Tout ce qui s'écrit ici prévient le client.",
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['en_attente', 'lister', 'lire', 'fil_lire', 'repondre', 'fil_envoyer', 'creer', 'modifier', 'deplacer', 'archiver'],
        },
        id: { type: 'string' },
        filId: { type: 'string' },
        texte: { type: 'string' },
        titre: { type: 'string' },
        description: { type: 'string' },
        importance: { type: 'string', enum: ['basse', 'normale', 'haute', 'urgente'] },
        colonne: { type: 'string', enum: ['a-faire', 'en-cours', 'termine', 'valide'] },
      },
    },
  },
  {
    name: 'assistant_surveillances',
    description:
      'Les SURVEILLANCES de sites. Actions : lister, historique (id), verifier (id facultatif : relance le contrôle maintenant), supprimer (id). Créer ou modifier une surveillance : surveillance_essai puis surveillance_recette.',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: { action: { type: 'string', enum: ['lister', 'historique', 'verifier', 'supprimer'] }, id: { type: 'string' } },
    },
  },
  {
    name: 'assistant_backups',
    description:
      'Les BACKUPS des sites en production. Actions : lister (les sites et leur dernier point), points (id d’un site facultatif : l’historique des points), lancer (id d’un site : un backup maintenant), supprimer (id d’un site : retire sa fiche). Créer ou modifier une fiche : backup_essai puis backup_recette.',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: { action: { type: 'string', enum: ['lister', 'points', 'lancer', 'supprimer'] }, id: { type: 'string' } },
    },
  },
  {
    name: 'assistant_base_serveur',
    description:
      "Une requête SQL sur une BASE DE DONNÉES de serveur. « mode » : lecture (consultation, ouverte en LECTURE SEULE : une écriture y échoue) ou ecriture (modification, toujours soumise à l'accord de l'utilisateur). « moteur » : sqlite (« fichier » : le chemin du fichier sur cette machine) ou mysql (« acces » : l'identifiant d'une fiche « Base de données » du coffre-fort). Les résultats sont plafonnés à 200 lignes.",
    inputSchema: {
      type: 'object',
      required: ['mode', 'moteur', 'requete'],
      properties: {
        mode: { type: 'string', enum: ['lecture', 'ecriture'] },
        moteur: { type: 'string', enum: ['sqlite', 'mysql'] },
        fichier: { type: 'string' },
        acces: { type: 'string', description: 'Identifiant de la fiche du coffre-fort' },
        requete: { type: 'string' },
      },
    },
  },
];

function avecProjetEtPourquoi(def: ToolDef): ToolDef {
  const schema = def.inputSchema as { properties?: Record<string, unknown> };
  const proprietes: Record<string, unknown> = { ...(schema.properties ?? {}) };
  if (!OUTILS_A_PROJET_PROPRE.has(def.name) && !proprietes.projet) proprietes.projet = CHAMP_PROJET;
  if (def.name !== 'ask_user' && def.name !== 'attach_file') proprietes.pourquoi = CHAMP_POURQUOI;
  return { ...def, inputSchema: { ...def.inputSchema, properties: proprietes } };
}

/** Les outils servis à l'assistant, et à lui seul. */
export function outilsDeLAssistant(): ToolDef[] {
  const voulus = new Set<string>(OUTILS_DE_L_ASSISTANT);
  const communs = TOOL_DEFS.filter((t) => voulus.has(t.name) && !OUTILS_PROPRES_A_L_ASSISTANT.has(t.name));
  return [...communs, ...OUTILS_PROPRES].map(avecProjetEtPourquoi);
}

export function outilServiALAssistant(nom: string): boolean {
  return (OUTILS_DE_L_ASSISTANT as readonly string[]).includes(nom);
}

/* ------------------------------------------------------------------ */
/* La préparation et l'exécution d'un appel                             */
/* ------------------------------------------------------------------ */

export type AppelPrepare =
  | { ok: true; projectId?: string; args: Record<string, any>; pourquoi?: string; genre: GenreDeGeste }
  | { ok: false; text: string };

/**
 * « projet » est lu et retiré ; à défaut, la carte visée (`cardId`) donne son
 * projet. « pourquoi » est retiré aussi : il n'est destiné qu'à la question.
 */
export function preparerLAppel(nom: string, brut: Record<string, any>): AppelPrepare {
  const args = { ...brut };
  const pourquoi = typeof args.pourquoi === 'string' ? args.pourquoi : undefined;
  delete args.pourquoi;
  let projectId: string | undefined;
  if (!OUTILS_A_PROJET_PROPRE.has(nom)) {
    const voulu = typeof args.projet === 'string' ? args.projet.trim() : '';
    delete args.projet;
    if (voulu) {
      const vise = trouverLeProjetVise(
        store.listProjects(true).map((p) => ({ id: p.id, name: p.name, archive: p.archived })),
        voulu,
      );
      if (!vise.ok) return { ok: false, text: `${vise.raison} Projets : ${store.listProjects().map((p) => p.name).join(', ')}.` };
      projectId = vise.projet.id;
    } else if (typeof args.cardId === 'string') {
      projectId = store.getCard(args.cardId)?.projectId;
    }
  }
  return { ok: true, projectId, args, pourquoi, genre: genreDeLAppel(nom, args) };
}

/** Exécute un appel de l'assistant — sans aucune garde : la porte d'accord est passée avant. */
export async function executerPourLAssistant(
  ctx: ToolContext,
  nom: string,
  args: Record<string, any>,
  projetVise: string | undefined,
): Promise<ToolResult> {
  try {
    switch (nom) {
      case 'assistant_resume':
        return { ok: true, text: resume(projetVise) };
      case 'assistant_notes':
        return notes(args, projetVise);
      case 'assistant_messagerie':
        return await messagerie(args, projetVise);
      case 'assistant_surveillances':
        return await surveillances(args);
      case 'assistant_backups':
        return backups(args);
      case 'assistant_base_serveur':
        return await baseServeur(args);
      default:
        return await callTool({ ...ctx, projectId: projetVise ?? ctx.projectId }, nom, args);
    }
  } catch (err: any) {
    return { ok: false, text: `Échec : ${err?.message ?? String(err)}` };
  }
}

/** La question « Autoriser / Refuser » d'un geste. */
export function questionDeLAccord(nom: string, args: Record<string, any>, genre: GenreDeGeste, pourquoi?: string): AgentQuestion {
  return AgentQuestion.parse({
    id: store.newId(),
    question: questionDAccord(genre),
    description: apercuDuGeste(nom, args, pourquoi),
    kind: 'single',
    options: [
      { id: 'o0', label: REPONSE_AUTORISER_ASSISTANT },
      { id: 'o1', label: REPONSE_REFUSER_ASSISTANT },
    ],
    allowFreeText: true,
  });
}

/** Le geste attend-il l'accord, vu l'interrupteur actuel ? */
export function demandeLAccord(genre: GenreDeGeste): boolean {
  return decisionDAccord(genre, validationAutomatique()) === 'accord';
}

/** La suite d'une question d'accord : exécuter sur « Autoriser », rendre le refus sinon. */
export function suiteDeLAccord(executer: () => Promise<ToolResult>): (reponse: string) => Promise<string> {
  return async (reponse) => {
    if (!accordDonne(reponse)) return texteDeRefus(reponse);
    const resultat = await executer();
    return `${resultat.ok ? 'AUTORISÉ ET EXÉCUTÉ' : 'AUTORISÉ, MAIS EN ÉCHEC'} — ${resultat.text}`;
  };
}

/* ------------------------------------------------------------------ */
/* Les outils propres                                                   */
/* ------------------------------------------------------------------ */

const nomDuProjet = (id: string | null | undefined) => (id ? (store.getProject(id)?.name ?? id) : 'Beluga Build');
const jour = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString().slice(0, 10) : '—');

function compteAdmin() {
  const admin = listerComptes().find((c) => c.role === 'admin' && c.actif);
  if (!admin) throw new Error('aucun compte administrateur dans l’espace client');
  return admin;
}

function resume(projetVise?: string): string {
  const projets = store.listProjects().filter((p) => !projetVise || p.id === projetVise);
  const agents = store.listAgents();
  const decisions = store.decisionsEnAttente();
  let admin: ReturnType<typeof compteAdmin> | null = null;
  try {
    admin = compteAdmin();
  } catch {
    admin = null;
  }
  const lignes: string[] = [];
  for (const projet of projets) {
    const cartes = store.listCards(projet.id);
    const parColonne = (Object.keys(COLUMN_LABELS) as (keyof typeof COLUMN_LABELS)[])
      .map((col) => `${COLUMN_LABELS[col]} ${cartes.filter((c) => c.column === col).length}`)
      .join(' · ');
    const auTravail = agents.filter((a) => a.projectId === projet.id && (a.status === 'running' || a.status === 'starting')).length;
    const attente = decisions.filter((d) => d.projectId === projet.id).length;
    const nonLus = admin ? espace.demandesAvecDuNouveau(projet.id, admin.id) : 0;
    lignes.push(
      `- ${projet.name} [${projet.id}] — ${parColonne}${auTravail ? ` — ${auTravail} agent(s) au travail` : ''}${attente ? ` — ${attente} décision(s) en attente` : ''}${nonLus ? ` — ${nonLus} demande(s) client avec du nouveau` : ''}`,
    );
    if (projetVise) {
      for (const c of cartes.filter((c) => c.column !== 'archived')) {
        lignes.push(`    · [${c.id}] « ${c.title} » — ${COLUMN_LABELS[c.column]}`);
      }
    }
  }
  return lignes.join('\n') || 'Aucun projet.';
}

function notes(args: Record<string, any>, projetVise?: string): ToolResult {
  const action = String(args.action ?? '');
  const toutes = listerNotes();
  const echeance = (v: unknown) => {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    const t = Date.parse(String(v));
    return Number.isFinite(t) ? t : undefined;
  };
  if (action === 'lister') {
    const choisies = toutes.filter((n) => !projetVise || n.projectId === projetVise);
    if (!choisies.length) return { ok: true, text: 'Aucune note.' };
    return {
      ok: true,
      text: choisies
        .map((n) => `- [${n.id}] « ${n.titre} » — ${nomDuProjet(n.projectId)}${n.echeance ? ` — échéance ${jour(n.echeance)}` : ''}${n.importance !== 'aucune' ? ` — ${n.importance}` : ''}`)
        .join('\n'),
    };
  }
  if (action === 'lire') {
    const note = toutes.find((n) => n.id === args.id);
    if (!note) return { ok: false, text: 'Note introuvable.' };
    return { ok: true, text: `« ${note.titre} » — ${nomDuProjet(note.projectId)} — échéance ${jour(note.echeance)} — ${note.importance}\n\n${note.description}` };
  }
  if (action === 'creer' || action === 'modifier') {
    const avant = action === 'modifier' ? toutes.find((n) => n.id === args.id) : undefined;
    if (action === 'modifier' && !avant) return { ok: false, text: 'Note introuvable.' };
    const projectId = projetVise ?? avant?.projectId;
    if (!projectId) return { ok: false, text: 'Dis dans quel projet ranger la note (« projet »).' };
    const r = enregistrerNote({
      ...(avant ?? {}),
      id: avant?.id,
      projectId,
      titre: args.titre ?? avant?.titre,
      description: args.description ?? avant?.description,
      echeance: echeance(args.echeance) === undefined ? avant?.echeance : echeance(args.echeance),
      importance: args.importance ?? avant?.importance,
      piecesJointes: avant?.piecesJointes ?? [],
    });
    if (!r.ok) return { ok: false, text: r.raison };
    return { ok: true, text: `Note ${action === 'creer' ? 'créée' : 'modifiée'} : [${r.note.id}] « ${r.note.titre} » (${nomDuProjet(r.note.projectId)}).` };
  }
  if (action === 'supprimer') {
    const r = supprimerNote(String(args.id ?? ''));
    return r.ok ? { ok: true, text: 'Note supprimée.' } : { ok: false, text: 'Note introuvable.' };
  }
  return { ok: false, text: `Action inconnue : ${action}` };
}

async function messagerie(args: Record<string, any>, projetVise?: string): Promise<ToolResult> {
  const action = String(args.action ?? '');
  const admin = compteAdmin();
  const projets = store.listProjects().filter((p) => !projetVise || p.id === projetVise);

  if (action === 'en_attente') {
    const lignes: string[] = [];
    for (const projet of projets) {
      for (const d of espace.listerDemandes(projet.id).filter((d) => !d.archiveeLe)) {
        const nonLus = espace.nonLusDeLaDemande(d.id, admin.id);
        const jamais = espace.luJusquA(d.id, admin.id) === 0 && d.auteurId !== admin.id;
        if (nonLus || jamais) {
          lignes.push(`- [${d.id}] « ${d.titre} » — ${projet.name} — ${jamais ? 'jamais ouverte' : `${nonLus} nouveauté(s)`} — colonne ${d.colonne}`);
        }
      }
    }
    for (const fil of espace.filsDesClients().filter((f) => f.nonLus > 0)) {
      const client = listerComptes().find((c) => c.id === fil.filId);
      lignes.push(`- fil de discussion [${fil.filId}] de ${client?.nomAffiche ?? fil.filId} — ${fil.nonLus} message(s) non lu(s)`);
    }
    return { ok: true, text: lignes.length ? `Ce qui attend une réponse :\n${lignes.join('\n')}` : 'Rien n’attend de réponse dans la messagerie.' };
  }
  if (action === 'lister') {
    const lignes = projets.flatMap((p) =>
      espace
        .listerDemandes(p.id)
        .filter((d) => !d.archiveeLe)
        .map((d) => `- [${d.id}] « ${d.titre} » — ${p.name} — ${d.colonne} — ${d.importance}${d.echeance ? ` — échéance ${jour(d.echeance)}` : ''}`),
    );
    return { ok: true, text: lignes.join('\n') || 'Aucune demande.' };
  }
  if (action === 'lire') {
    const d = espace.laDemande(String(args.id ?? ''));
    if (!d) return { ok: false, text: 'Demande introuvable.' };
    const messages = espace.messagesDeLaDemande(d.id);
    return {
      ok: true,
      text: [
        `« ${d.titre} » — ${nomDuProjet(d.projectId)} — ${d.colonne} — ${d.importance} — par ${d.auteurNom}`,
        d.description,
        ...messages.map((m) => `[${new Date(m.creeLe).toISOString().slice(0, 16).replace('T', ' ')}] ${m.auteurNom} (${m.auteurRole}) : ${m.texte}`),
      ]
        .filter(Boolean)
        .join('\n\n'),
    };
  }
  if (action === 'fil_lire') {
    const messages = espace.messagesDuFil(String(args.filId ?? ''));
    return {
      ok: true,
      text: messages.map((m) => `[${new Date(m.creeLe).toISOString().slice(0, 16).replace('T', ' ')}] ${m.auteurNom} (${m.auteurRole}) : ${m.texte}`).join('\n') || 'Fil vide.',
    };
  }
  const commandes: Record<string, () => Record<string, unknown>> = {
    repondre: () => ({ type: 'espace.demande.commenter', id: args.id, texte: String(args.texte ?? '') }),
    fil_envoyer: () => ({ type: 'espace.fil.envoyer', filId: args.filId, texte: String(args.texte ?? '') }),
    creer: () => ({ type: 'espace.demande.creer', projectId: projetVise, titre: args.titre, description: args.description, importance: args.importance }),
    modifier: () => ({ type: 'espace.demande.modifier', id: args.id, titre: args.titre, description: args.description, importance: args.importance }),
    deplacer: () => ({ type: 'espace.demande.deplacer', id: args.id, colonne: args.colonne }),
    archiver: () => ({ type: 'espace.demande.archiver', id: args.id, archivee: true }),
  };
  const fabrique = commandes[action];
  if (!fabrique) return { ok: false, text: `Action inconnue : ${action}` };
  if (action === 'creer' && !projetVise) return { ok: false, text: 'Dis dans quel projet poser la demande (« projet »).' };
  await commandeDeLEspaceClient(fabrique() as any, admin);
  return { ok: true, text: `Fait (${action}) dans la messagerie de l’espace client.` };
}

async function surveillances(args: Record<string, any>): Promise<ToolResult> {
  const action = String(args.action ?? '');
  const id = String(args.id ?? '');
  if (action === 'lister') {
    const sites = listerSurveillances();
    return {
      ok: true,
      text: sites.map((s) => `- [${s.id}] ${s.nom} — ${s.url} — ${s.etat}${s.code ? ` (${s.code})` : ''} — vérifié ${jour(s.verifieLe)}`).join('\n') || 'Aucune surveillance.',
    };
  }
  if (action === 'historique') {
    if (!lireSurveillance(id)) return { ok: false, text: 'Surveillance introuvable.' };
    const controles = listerControles(id).slice(0, 40);
    return {
      ok: true,
      text:
        controles
          .map((c) => `- ${new Date(c.instant).toISOString().slice(0, 16).replace('T', ' ')} ${c.etat}${c.code ? ` (${c.code})` : ''}${c.detail ? ` — ${c.detail}` : ''}`)
          .join('\n') || 'Aucun contrôle.',
    };
  }
  if (action === 'verifier') {
    const sites = await verifierSites(id ? [id] : listerSurveillances().map((s) => s.id));
    return { ok: true, text: sites.map((s) => `- ${s.nom} : ${s.etat}${s.code ? ` (${s.code})` : ''}`).join('\n') || 'Rien à vérifier.' };
  }
  if (action === 'supprimer') {
    const r = supprimerSurveillance(id);
    return r.ok ? { ok: true, text: 'Surveillance supprimée.' } : { ok: false, text: r.raison ?? 'Surveillance introuvable.' };
  }
  return { ok: false, text: `Action inconnue : ${action}` };
}

function backups(args: Record<string, any>): ToolResult {
  const action = String(args.action ?? '');
  const id = String(args.id ?? '');
  if (action === 'lister') {
    const points = listerPoints();
    return {
      ok: true,
      text:
        listerSitesBackups()
          .map((s) => {
            const dernier = points.find((p) => p.siteId === s.id);
            return `- [${s.id}] ${s.nom} — ${nomDuProjet(s.projectId)} — ${s.actif ? 'actif' : 'éteint'} — dernier point : ${dernier ? `${jour(dernier.debut)} ${dernier.statut}` : 'aucun'}`;
          })
          .join('\n') || 'Aucun site sauvegardé.',
    };
  }
  if (action === 'points') {
    const points = listerPoints(id || undefined).slice(0, 40);
    return { ok: true, text: points.map((p) => `- [${p.id}] ${new Date(p.debut).toISOString().slice(0, 16)} — ${p.statut} — ${p.detail}`).join('\n') || 'Aucun point.' };
  }
  if (action === 'lancer') {
    if (!lireSiteBackup(id)) return { ok: false, text: 'Site introuvable.' };
    void prendreUnBackup(id, 'manuel').catch((err) => log.warn('assistant : backup en échec', err));
    return { ok: true, text: 'Backup lancé ; il se suit dans l’écran Backup.' };
  }
  if (action === 'supprimer') {
    const r = supprimerSiteBackup(id);
    return r.ok ? { ok: true, text: 'Fiche de sauvegarde retirée.' } : { ok: false, text: r.raison ?? 'Site introuvable.' };
  }
  return { ok: false, text: `Action inconnue : ${action}` };
}

/* ------------------------------------------------------------------ */
/* Les bases des serveurs                                               */
/* ------------------------------------------------------------------ */

const LIGNES_MAX = 200;

/**
 * LA LECTURE SEULE EST TENUE PAR LA BASE, PAS PAR LE TEXTE : SQLite ouvert en
 * `readonly`, MySQL dans une transaction `READ ONLY` annulée à la fin. Le
 * premier mot est contrôlé EN PLUS — une ceinture, pas la garde.
 */
const PREMIER_MOT_DE_LECTURE = /^\s*(select|with|show|describe|desc|explain|pragma)\b/i;

function tableau(lignes: Record<string, unknown>[]): string {
  if (!lignes.length) return '(aucune ligne)';
  const colonnes = Object.keys(lignes[0]);
  const rendu = lignes.slice(0, LIGNES_MAX).map((l) => colonnes.map((c) => String(l[c] ?? 'NULL')).join(' | '));
  return [colonnes.join(' | '), ...rendu, lignes.length > LIGNES_MAX ? `… ${lignes.length - LIGNES_MAX} ligne(s) de plus` : '']
    .filter(Boolean)
    .join('\n');
}

async function baseServeur(args: Record<string, any>): Promise<ToolResult> {
  const lecture = args.mode === 'lecture';
  const requete = String(args.requete ?? '').trim();
  if (!requete) return { ok: false, text: 'La requête est vide.' };
  if (lecture && !PREMIER_MOT_DE_LECTURE.test(requete)) {
    return { ok: false, text: 'En mode « lecture », seule une consultation passe (SELECT, SHOW, DESCRIBE, EXPLAIN). Pour modifier, appelle avec mode « ecriture » : l’utilisateur devra l’autoriser.' };
  }
  if (args.moteur === 'sqlite') {
    const fichier = String(args.fichier ?? '').trim();
    if (!fichier || !fs.existsSync(fichier)) return { ok: false, text: `Fichier de base introuvable : ${fichier || '(vide)'}` };
    const db = new Database(fichier, { readonly: lecture, fileMustExist: true });
    try {
      const stmt = db.prepare(requete);
      if (stmt.reader) return { ok: true, text: tableau(stmt.all() as Record<string, unknown>[]) };
      if (lecture) return { ok: false, text: 'Cette requête écrit : refusée en mode lecture.' };
      const r = stmt.run();
      return { ok: true, text: `${r.changes} ligne(s) modifiée(s).` };
    } finally {
      db.close();
    }
  }
  if (args.moteur === 'mysql') {
    const fiche = listerAcces().find((a) => a.id === args.acces && a.type === 'base-de-donnees');
    if (!fiche) return { ok: false, text: 'Fiche « Base de données » introuvable dans le coffre-fort (« acces »).' };
    const c = fiche.champs;
    const sql = lecture
      ? `SET SESSION TRANSACTION READ ONLY; START TRANSACTION; ${requete.replace(/;\s*$/, '')}; ROLLBACK;`
      : requete;
    const sortie = await new Promise<string>((resolve, reject) => {
      execFile(
        'mysql',
        ['--batch', '-h', c.hote || 'localhost', '-P', c.port || '3306', '-u', c.utilisateur || 'root', ...(c.base ? [c.base] : []), '-e', sql],
        { env: { ...process.env, MYSQL_PWD: c.motDePasse ?? '' }, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
        (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).trim())) : resolve(stdout)),
      );
    });
    const lignes = sortie.split('\n');
    return { ok: true, text: lignes.slice(0, LIGNES_MAX + 1).join('\n') + (lignes.length > LIGNES_MAX + 1 ? `\n… ${lignes.length - LIGNES_MAX - 1} ligne(s) de plus` : '') || '(aucune ligne)' };
  }
  return { ok: false, text: 'Moteur inconnu : sqlite ou mysql.' };
}
