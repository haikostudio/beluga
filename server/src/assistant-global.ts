/**
 * L'ASSISTANT GLOBAL — côté démon (règles pures : `shared/src/assistant-global.ts`).
 *
 * UN SEUL AGENT, GARDÉ D'UNE OUVERTURE À L'AUTRE (`meta` de la base), comme
 * l'agent « Ajouter un moteur » : sa conversation se retrouve fenêtre refermée,
 * page rechargée, démon redémarré. « Repartir de zéro » vide son contexte comme
 * pour tout agent. Il n'a NI carte NI branche : un changement de programme se
 * propose en carte. Son dossier de travail est HORS de tout dépôt, mais il a
 * l'accès complet à la machine, comme un agent de tâche (18/10/2026).
 *
 * SES OUTILS : ceux d'un agent ordinaire, plus ceux du démon qu'il lui faut
 * (`OUTILS_DE_L_ASSISTANT`, dont le marketing) et cinq qui n’existent que pour
 * lui (résumé, messagerie de l’espace client, surveillances,
 * sauvegardes, bases des serveurs). Chacun accepte « projet » pour viser
 * n'importe quel projet. Son modèle se règle dans la barre d'écriture, comme
 * pour tout agent.
 *
 * PLUS AUCUNE PORTE D'ACCORD (décision du 29/10/2026) : le démon n'arrête plus
 * aucun appel sur « Autoriser / Refuser ». L'assistant a tous les droits ; il
 * confirme LUI-MÊME par `ask_user`, en une phrase, avant un geste qui ne se
 * reprend pas (consigne `CONSIGNE_ASSISTANT_GLOBAL`). Ses GESTES d'écran —
 * lancer, déplacer, déployer, redémarrer — passent par la même porte que les
 * boutons (`commandeCommeLUtilisateur`, `server/src/ws.ts`), au nom du compte
 * administrateur : mêmes refus, mêmes effets.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import Database from 'better-sqlite3';
import {
  Agent,
  COLUMN_KEYS,
  COLUMN_LABELS,
  OUTILS_DE_L_ASSISTANT,
  OUTILS_PROPRES_A_L_ASSISTANT,
  brouillonApresSynthese,
  catalogueDesCommandes,
  outilServiALaVoix,
  verdictDeLaCommande,
  motsInconnus,
  nomDeLAssistant,
  nomNettoye,
  nomsProches,
  titreDeLAssistant,
  genreDeLAppel,
  lienDeLaCarte,
  trouverLeProjetVise,
  activiteRecente,
  bornesDuJour,
  dateEtHeureDActivite,
  ligneDActivite,
  limiteDActivite,
  resoudreLeJour,
  publicationsDuResume,
  sectionDesPublicationsEnAttente,
  TITRE_DES_PUBLICATIONS_EN_ATTENTE,
  agentSystemeActif,
  type ColumnKey,
  type GenreDeGeste,
  type Card,
} from '@beluga/shared';
import { getMeta, setMeta } from './db.js';
import { bus } from './bus.js';
import { CONFIG } from './config.js';
import * as store from './store.js';
import { TOOL_DEFS, callTool, outilServiA, toolsFor, type ToolContext, type ToolDef, type ToolResult } from './tools.js';
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
import { OUTIL_ECRAN, ongletDeLaVoix, outilEcran } from './gestes-de-jarvis.js';

const CLE_AGENT = 'assistant.agent';

/* ------------------------------------------------------------------ */
/* L'agent                                                              */
/* ------------------------------------------------------------------ */

export function estAssistantGlobal(agent: Pick<Agent, 'assistantGlobal'> | null | undefined): boolean {
  return Boolean(agent?.assistantGlobal);
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

/**
 * LE TITRE SUIT LE NOM DE L'ASSISTANT (17/11/2026) : réglé dans Réglages › Voix, le nom donne « Assistant <nom> ». Un
 * agent déjà créé est RENOMMÉ (et tous les écrans le reçoivent) ; l'identification passe toujours par
 * `assistantGlobal`, jamais par le titre.
 */
export function retitrerLAssistant(): void {
  const id = getMeta(CLE_AGENT);
  const agent = id ? store.getAgent(id) : null;
  if (!agent || !estAssistantGlobal(agent)) return;
  const titre = titreDeLAssistant(nomDeLAssistant(store.getSettings()));
  if (agent.title === titre) return;
  const renomme = store.saveAgent({ ...agent, title: titre, updatedAt: store.now() });
  bus.emit({ type: 'agent.upsert', agent: renomme });
}

/** Le verdict sur un nom d'assistant : entendu par le micro ? Sinon, les mots inconnus et trois noms proches. */
export interface VerdictDuNom {
  nom: string;
  entendu: boolean;
  inconnus: string[];
  suggestions: string[];
}

/**
 * UN NOM D'ASSISTANT SERA-T-IL ENTENDU ? Chaque mot doit être dans le vocabulaire du modèle de réveil : sinon, refus
 * et trois noms proches, tous entendus. Une panne de lecture du modèle LÈVE une erreur — jamais d'accord silencieux.
 */
export async function verifierLeNomDeLAssistant(saisi: string): Promise<VerdictDuNom> {
  const nom = nomNettoye(saisi);
  if (!nom) return { nom: '', entendu: false, inconnus: [], suggestions: nomsProches('') };
  const { vocabulaireDuReveil } = await import('./modele-de-reveil.js');
  let mots: Set<string>;
  try {
    mots = await vocabulaireDuReveil();
  } catch (err) {
    throw new Error(`Impossible de vérifier ce nom pour l’instant : ${(err as Error).message}. Le nom actuel est gardé.`);
  }
  const connu = (mot: string) => mots.has(mot);
  const inconnus = motsInconnus(nom, connu);
  return { nom, entendu: inconnus.length === 0, inconnus, suggestions: inconnus.length ? nomsProches(nom, 3, connu) : [] };
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
      title: titreDeLAssistant(nomDeLAssistant(store.getSettings())),
      workdir: atelier(),
      run: { engine: 'claude' },
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
const OUTILS_A_PROJET_PROPRE = new Set(['project_manage', 'group_manage', 'voix_dossier', 'voix_confirmer']);

/**
 * LES OUTILS DE LA CONVERSATION VOCALE SEULE (carte « Jarvis plus fiable et vérifié », 18/11/2026) : servis au cerveau
 * de la voix (`voix: true`), à personne d'autre. Le dossier de vérification ne se prépare que quand le cerveau
 * l'appelle (18/11/2026) : plus de recherche d'office, plus d'étapes dites à voix haute, plus de « voix_silence ».
 */
const OUTILS_DE_LA_VOIX: ToolDef[] = [
  {
    name: 'voix_dossier',
    description:
      "LE DOSSIER DE VÉRIFICATION de la phrase que l'utilisateur vient de dire, À APPELER SEULEMENT quand la demande l'exige (le passé, une décision, l'état de Beluga, une tâche, une action) — JAMAIS pour un salut, un merci, un avis ou une question générale. Beluga y réunit, en deux secondes au plus, la MÉMOIRE du projet (unités et décisions, avec leur id), les DISCUSSIONS vocales passées (DISC-…), les TÂCHES approchantes de tous les projets (avec leur lien) et l'ACTIVITÉ du moment (tâches au travail, mises en ligne et en production avec leur état réel, PUBLICATIONS EN ATTENTE — à déployer et à mettre en production, mêmes chiffres que les Tableaux de bord —, ce qui attend). Ouvre ensuite ce qu'il désigne, autant que la question l'exige. « demande » (facultatif) : un autre sujet à vérifier que la dernière phrase.",
    inputSchema: { type: 'object', properties: { demande: { type: 'string', description: 'Un autre sujet que la dernière phrase, en quelques mots.' } } },
  },
  {
    name: 'voix_confirmer',
    description:
      "LA CONFIRMATION EN BULLE (décision de l'utilisateur, 20/11/2026) : AVANT de créer une carte ou de faire une action, pose la question ICI — elle s'affiche en bulle au-dessus du mode vocal, avec ses choix à toucher. Dis-la aussi à voix haute en une phrase courte, puis ATTENDS : la réponse arrive soit dite à voix haute, soit touchée (« L'utilisateur a répondu en touchant l'écran : … »). « question » : la phrase ; « choix » : deux à quatre réponses courtes (par défaut « Oui, vas-y » et « Non »).",
    inputSchema: {
      type: 'object',
      required: ['question'],
      properties: {
        question: { type: 'string', description: 'La question, en une phrase courte.' },
        choix: { type: 'array', items: { type: 'string' }, description: 'Deux à quatre réponses courtes.' },
      },
    },
  },
];

const CHAMP_PROJET = {
  type: 'string',
  description: 'Le projet visé, par son NOM ou son identifiant. Sans lui : Beluga Build (ou tous les projets pour une liste).',
};

const OUTILS_PROPRES: ToolDef[] = [
  OUTIL_ECRAN as ToolDef,
  {
    name: 'carte_demande',
    description:
      "ÉCRIRE DANS LA DEMANDE D'UNE CARTE, ouverte à l'écran ou non. « carte » : son titre (ou un bout) ou son identifiant ; « projet » aide quand plusieurs cartes se ressemblent. Actions : « ajouter » (« texte » s'ajoute à la suite du champ d'écriture de la carte, SANS partir — l'utilisateur relit puis envoie) ; « envoyer » (« texte » part tout de suite comme message de l'utilisateur à l'agent de la carte — seulement si on te demande de l'envoyer). Préfère cet outil à « assistant_ecran » pour écrire dans une carte.",
    inputSchema: {
      type: 'object',
      required: ['action', 'carte', 'texte'],
      properties: {
        action: { type: 'string', enum: ['ajouter', 'envoyer'] },
        carte: { type: 'string', description: 'Le titre de la carte (ou un bout) ou son identifiant.' },
        texte: { type: 'string', description: 'Le texte à ajouter ou à envoyer.' },
      },
    },
  },
  {
    name: 'beluga_commande',
    description:
      "LA COMMANDE GÉNÉRALE DE BELUGA : tout ce qu'un clic peut faire dans l'application, par la même porte que les boutons, au nom de l'administrateur. « lister » (« filtre » facultatif : un mot — « carte », « deploy », « studio »…) rend le catalogue : une ligne par commande, `type(champ, champ?)`. « executer » joue une commande : « type » (ex. « card.update ») et « donnees » (ses champs, sans « type » : ex. { id, patch }). Ce qui ne se défait pas (mise en production, paiement, message à un client, suppression) est refusé tant que « confirme » n'est pas vrai — redis-le d'abord et attends « oui » à voix haute. Cherche ici avant de dire que tu ne peux pas.",
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['lister', 'executer'] },
        filtre: { type: 'string' },
        type: { type: 'string', description: 'Le type de la commande à jouer.' },
        donnees: { type: 'object', description: 'Les champs de la commande, sans « type ».' },
        confirme: { type: 'boolean', description: 'Vrai seulement après le « oui » dit à voix haute, pour ce qui ne se défait pas.' },
      },
    },
  },
  {
    name: 'assistant_resume',
    description:
      "Le RÉSUMÉ DATÉ de Beluga, en UN appel, tous projets, en sections titrées : d'abord les TÂCHES EN COURS (celles qui tournent maintenant, colonne « En cours »), puis les DERNIÈRES TÂCHES TERMINÉES avec leur date et heure (déjà finies, rangées en « Archivé » comprises, la plus récente d'abord — elles ne sont PAS en cours), les MISES EN LIGNE ET EN PRODUCTION avec leur état réel (en train de tourner, réussie, en échec — une publication qui tourne n'est jamais « en pause »), CE QUI T'ATTEND (décisions, questions d'agents, plans, datés), puis chaque projet avec ses cartes par colonne et ses messages clients non lus. « jour » filtre les terminées sur un jour (« hier », « aujourd'hui », « avant-hier », « 2026-11-15 » ou « 15/11 », heure de Paris) ; « limite » leur nombre (10 par défaut, 30 au plus) ; « projet » restreint à un projet et liste ses cartes. Viennent aussi les PUBLICATIONS EN ATTENTE : les projets qui ont des tâches « À déployer » et ceux dont la version déployée attend la MISE EN PRODUCTION, avec leur nombre de tâches — les mêmes chiffres que les Tableaux de bord. « Qu'est-ce qui tourne » se répond par les TÂCHES EN COURS ET les publications en cours ; « qu'est-ce qui attend la production / le déploiement », « en prod » par les PUBLICATIONS EN ATTENTE — une publication qui ne tourne pas ne veut JAMAIS dire que rien n'attend ; « qu'est-ce qui m'attend » par CE QUI T'ATTEND.",
    inputSchema: {
      type: 'object',
      properties: {
        jour: { type: 'string', description: "Le jour des tâches terminées : « hier », « aujourd'hui », « avant-hier », « AAAA-MM-JJ » ou « JJ/MM »." },
        limite: { type: 'number', description: 'Combien de tâches terminées (10 par défaut, 30 au plus).' },
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
    name: 'assistant_gestes',
    description:
      "Les GESTES DE L'ÉCRAN, joués comme si l'utilisateur cliquait lui-même (mêmes refus, mêmes effets). Actions : « trouver » (« texte » : quelques mots du titre ; « projet » facultatif — rend chaque carte trouvée avec son projet, sa colonne, son rang et le LIEN qui l'ouvre, à recopier tel quel dans ta réponse) ; « lancer » (« cardId » : le bouton « Lancer » d'une carte) ; « valider_proposition » (« proposalId » : la vignette « Créer la carte » d'une carte que tu viens de proposer, quand l'utilisateur t'a demandé de la créer) ; « changer_de_projet » (« cardId », « vers » : nom ou identifiant du projet d'arrivée) ; « deployer » (« projet », « cible » : dev = Déployer sur ce serveur, SANS confirmation dès que l'utilisateur te l'a demandé ; production = Mise en production, qui ne se défait pas : redis-le, attends son « oui » à voix haute, puis passe « confirme »: true — jamais de toi-même) ; « redemarrer » (redémarre Beluga ; REFUSÉ et mis en attente tant qu'un agent ou une publication tourne — dis-le). Pour sortir une carte d'« Archivé » ou d'« À déployer », board_move_card suffit : il agit comme le geste de l'utilisateur.",
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['trouver', 'lancer', 'valider_proposition', 'changer_de_projet', 'deployer', 'redemarrer'] },
        texte: { type: 'string' },
        cardId: { type: 'string' },
        proposalId: { type: 'string' },
        vers: { type: 'string' },
        cible: { type: 'string', enum: ['dev', 'production'] },
        confirme: { type: 'boolean', description: 'Vrai seulement après le « oui » dit à voix haute (mise en production).' },
      },
    },
  },
  {
    name: 'assistant_base_serveur',
    description:
      "Une requête SQL sur une BASE DE DONNÉES de serveur. « mode » : lecture (consultation, ouverte en LECTURE SEULE : une écriture y échoue) ou ecriture (modification ; une requête qui EFFACE des données se confirme d'abord par une question à l'utilisateur). « moteur » : sqlite (« fichier » : le chemin du fichier sur cette machine) ou mysql (« acces » : l'identifiant d'une fiche « Base de données » du coffre-fort). Les résultats sont plafonnés à 200 lignes.",
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

function avecProjet(def: ToolDef): ToolDef {
  const schema = def.inputSchema as { properties?: Record<string, unknown> };
  const proprietes: Record<string, unknown> = { ...(schema.properties ?? {}) };
  if (!OUTILS_A_PROJET_PROPRE.has(def.name) && !proprietes.projet) proprietes.projet = CHAMP_PROJET;
  return { ...def, inputSchema: { ...def.inputSchema, properties: proprietes } };
}

/**
 * LES OUTILS DE L'ASSISTANT : ceux d'un agent ordinaire du même rôle, plus ceux
 * du démon qu'il lui faut en propre (le marketing) et ses six outils à lui.
 */
export function outilsDeLAssistant(agentId: string, options: { realisation?: boolean; voix?: boolean } = {}): ToolDef[] {
  const voulus = new Set<string>(OUTILS_DE_L_ASSISTANT);
  const ordinaires = toolsFor('deploy', options).filter((t) => outilServiA(t.name, agentId));
  const vus = new Set(ordinaires.map((t) => t.name));
  const enPlus = TOOL_DEFS.filter((t) => voulus.has(t.name) && !vus.has(t.name) && !OUTILS_PROPRES_A_L_ASSISTANT.has(t.name));
  for (const t of enPlus) vus.add(t.name);
  /* LA VOIX A TOUS LES OUTILS DU DÉMON (décision du 17/11/2026 : « je veux qu'il puisse tout faire ») — sauf ceux qui
     n'ont de sens que dans le tour d'une carte (`outilServiALaVoix`). */
  const pourLaVoix = options.voix
    ? TOOL_DEFS.filter((t) => !vus.has(t.name) && !OUTILS_PROPRES_A_L_ASSISTANT.has(t.name) && outilServiALaVoix(t.name))
    : [];
  return [...ordinaires, ...enPlus, ...pourLaVoix, ...OUTILS_PROPRES, ...(options.voix ? OUTILS_DE_LA_VOIX : [])].map(avecProjet);
}

export function outilServiALAssistant(nom: string, agentId: string, options: { realisation?: boolean; voix?: boolean } = {}): boolean {
  return outilsDeLAssistant(agentId, options).some((t) => t.name === nom);
}

/* ------------------------------------------------------------------ */
/* La préparation et l'exécution d'un appel                             */
/* ------------------------------------------------------------------ */

export type AppelPrepare =
  | { ok: true; projectId?: string; args: Record<string, any>; pourquoi?: string; genre: GenreDeGeste }
  | { ok: false; text: string };

/**
 * « projet » est lu et retiré ; à défaut, la carte visée (`cardId`) donne son
 * projet. Un ancien « pourquoi » (la phrase de l'accord d'avant) est retiré.
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

/** Exécute un appel de l'assistant. Aucune porte d'accord : il confirme lui-même l'irréversible par `ask_user`. */
export async function executerPourLAssistant(
  ctx: ToolContext,
  nom: string,
  args: Record<string, any>,
  projetVise: string | undefined,
): Promise<ToolResult> {
  try {
    switch (nom) {
      case 'assistant_resume':
        return await resume(projetVise, args);
      case 'voix_dossier': {
        const { dossierPourLeCerveau } = await import('./voix-directe.js');
        return await dossierPourLeCerveau(ctx.agentId, typeof args.demande === 'string' ? args.demande : undefined);
      }
      case 'voix_confirmer': {
        const { poserUneConfirmation } = await import('./voix-directe.js');
        return poserUneConfirmation(ctx.agentId, String(args.question ?? ''), Array.isArray(args.choix) ? args.choix.map(String) : []);
      }
      case 'assistant_messagerie':
        return await messagerie(args, projetVise);
      case 'assistant_surveillances':
        return await surveillances(args);
      case 'assistant_backups':
        return backups(args);
      case 'assistant_base_serveur':
        return await baseServeur(args);
      case 'assistant_gestes':
        return await gestes(args, projetVise);
      case 'assistant_ecran':
        return await outilEcran(args, projetVise);
      case 'carte_demande':
        return await ecrireDansLaDemande(args, projetVise);
      case 'beluga_commande':
        return await commandeGenerale(args);
      /* L'ASSISTANT DÉPLACE COMME L'UTILISATEUR (29/10/2026) : sortir une carte
         d'« Archivé » ou d'« À déployer » est un geste humain quand il le fait
         à la demande de l'utilisateur. Les autres agents restent fermés aux fins
         de parcours (MEM-0339, `board_move_card` de `tools.ts`). */
      case 'board_move_card':
        return await deplacerCommeLUtilisateur(String(args.cardId ?? ''), String(args.column ?? ''));
      case 'marketing':
        /* L'ATELIER EST PROPRE À CHAQUE PROJET : sans projet nommé, l'outil
           viserait celui de l'assistant (Beluga) — jamais en silence. */
        if (!projetVise) {
          return { ok: false, text: 'Dis quel projet viser (« projet », son nom) : l’atelier Réseaux sociaux est propre à chaque projet. Un message qui commence par « Réseaux sociaux de « … » : » le nomme.' };
        }
        return await callTool({ ...ctx, projectId: projetVise }, nom, args);
      default: {
        const resultat = await callTool({ ...ctx, projectId: projetVise ?? ctx.projectId }, nom, args);
        /* L'IDENTIFIANT DE LA CARTE PROPOSÉE revient à l'assistant : c'est lui que « valider_proposition » attend
           (création d'une tâche à la voix, 15/11/2026 — sans lui, le « oui » de l'utilisateur ne menait nulle part). */
        if (nom === 'board_create_card' && resultat.ok && resultat.proposal) {
          return { ...resultat, text: `${resultat.text} Identifiant de la proposition (pour « valider_proposition ») : ${resultat.proposal.id}.` };
        }
        return resultat;
      }
    }
  } catch (err: any) {
    return { ok: false, text: `Échec : ${err?.message ?? String(err)}` };
  }
}

/* ------------------------------------------------------------------ */
/* Les outils propres                                                   */
/* ------------------------------------------------------------------ */

/** Une carte nommée par Jarvis : son identifiant, sinon son titre (exact, puis le plus récent qui le contient). */
function trouverLaCarte(voulue: string, projetVise?: string): { ok: true; card: NonNullable<ReturnType<typeof store.getCard>> } | { ok: false; text: string } {
  const brute = voulue.trim();
  if (!brute) return { ok: false, text: 'Dis quelle carte : son titre ou son identifiant (« carte »).' };
  const parId = store.getCard(brute);
  if (parId) return { ok: true, card: parId };
  const plat = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[«»"'’]/g, '').replace(/\s+/g, ' ').trim();
  const voulu = plat(brute);
  const projets = projetVise ? [projetVise] : store.listProjects(false).map((p) => p.id);
  const cartes = projets.flatMap((id) => store.listCards(id)).filter((c) => c.column !== 'archived');
  const exactes = cartes.filter((c) => plat(c.title) === voulu);
  const proches = exactes.length ? exactes : cartes.filter((c) => plat(c.title).includes(voulu) || voulu.includes(plat(c.title)));
  if (!proches.length) return { ok: false, text: `Aucune carte ne s'appelle « ${brute} »${projetVise ? ` dans ${nomDuProjet(projetVise)}` : ''}. Cherche-la avec « board_list_cards » ou « assistant_resume ».` };
  const card = [...proches].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return { ok: true, card };
}

/**
 * ÉCRIRE DANS LA DEMANDE D'UNE CARTE (décision du 17/11/2026 : « je veux qu'il arrive à ajouter du contenu dans une
 * carte »). « ajouter » : le texte rejoint le BROUILLON du champ d'écriture de la carte — l'onglet de la voix l'ajoute
 * au champ ouvert (comme la synthèse de fin), sinon au brouillon gardé ; sans onglet, le démon écrit le brouillon
 * lui-même. « envoyer » : le message part à l'agent de la carte, par la même porte que le bouton d'envoi.
 */
async function ecrireDansLaDemande(args: Record<string, any>, projetVise?: string): Promise<ToolResult> {
  const action = String(args.action ?? 'ajouter');
  const texte = typeof args.texte === 'string' ? args.texte.trim() : '';
  if (!texte) return { ok: false, text: 'Rien à écrire : donne le « texte ».' };
  const trouvee = trouverLaCarte(String(args.carte ?? args.cardId ?? ''), projetVise);
  if (!trouvee.ok) return trouvee;
  const card = trouvee.card;
  const agent = store.getLastAgentByCard(card.id);
  const lien = `[ouvrir la carte](${lienDeLaCarte(card.projectId, card.id)})`;
  if (action === 'envoyer') {
    if (!agent) return { ok: false, text: `La carte « ${card.title} » n'a pas encore d'agent à qui écrire : ajoute plutôt le texte (« ajouter »), il partira à son lancement.` };
    await commeLUtilisateur({ type: 'agent.prompt', agentId: agent.id, text: texte });
    return { ok: true, text: `Envoyé à l'agent de la carte « ${card.title} » (${nomDuProjet(card.projectId)}) — ${lien}.` };
  }
  if (!agent) {
    // Une carte sans agent encore : le texte rejoint sa description, que son premier agent lira.
    const enregistree = store.saveCard({ ...card, description: brouillonApresSynthese(card.description ?? '', texte), updatedAt: Date.now() });
    bus.emit({ type: 'card.upsert', card: enregistree });
    return { ok: true, text: `Ajouté à la demande de la carte « ${card.title} » (${nomDuProjet(card.projectId)}) — ${lien}.` };
  }
  const onglet = ongletDeLaVoix();
  if (onglet) {
    bus.emit({ type: 'voix.direct.synthese', agentId: agent.id, texte, ajout: true, client: onglet });
  } else {
    const cle = `draft.${agent.id}`;
    const avant = store.readPreference(cle);
    store.writePreference(cle, brouillonApresSynthese(typeof avant === 'string' ? avant : '', texte));
    bus.emit({ type: 'prefs', prefs: { [cle]: store.readPreference(cle) ?? null }, partiel: true });
  }
  return {
    ok: true,
    text: `Ajouté à la demande de la carte « ${card.title} » (${nomDuProjet(card.projectId)}), dans son champ d'écriture, sans l'envoyer — ${lien}.`,
  };
}

/** La forme d'une commande de l'interface : son type et ses champs (« ? » : facultatif), lue sur le protocole. */
async function formeDesCommandes(): Promise<{ type: string; champs: string[] }[]> {
  const { ClientCommand } = await import('@beluga/shared');
  const options = (ClientCommand as unknown as { options: { shape: Record<string, { isOptional?: () => boolean }> }[] }).options ?? [];
  return options.map((o) => {
    const shape = o.shape ?? {};
    const type = String((shape.type as unknown as { value?: string })?.value ?? '');
    const champs = Object.keys(shape)
      .filter((k) => k !== 'type')
      .map((k) => (shape[k]?.isOptional?.() ? `${k}?` : k));
    return { type, champs };
  }).filter((c) => c.type);
}

/**
 * LA COMMANDE GÉNÉRALE (`beluga_commande`, 17/11/2026) : « lister » rend le catalogue, « executer » joue la commande par
 * la même porte que les boutons (`commandeCommeLUtilisateur`, compte administrateur : mêmes gardes, mêmes refus).
 */
async function commandeGenerale(args: Record<string, any>): Promise<ToolResult> {
  const action = String(args.action ?? 'lister');
  if (action === 'lister') {
    return { ok: true, text: catalogueDesCommandes(await formeDesCommandes(), typeof args.filtre === 'string' ? args.filtre : '') };
  }
  if (action !== 'executer') return { ok: false, text: 'Actions : « lister » ou « executer ».' };
  const type = String(args.type ?? '').trim();
  const donnees = args.donnees && typeof args.donnees === 'object' && !Array.isArray(args.donnees) ? { ...(args.donnees as Record<string, unknown>) } : {};
  delete donnees.type;
  const verdict = verdictDeLaCommande(type, donnees);
  if (!verdict.ok) return { ok: false, text: verdict.raison };
  if (verdict.aConfirmer && args.confirme !== true) {
    return { ok: false, text: `Refusé sans confirmation : « ${type} » est ${verdict.aConfirmer}, qui ne se défait pas. Redis-le à l'utilisateur, attends son « oui » à voix haute, puis rejoue avec « confirme »: true.` };
  }
  const { ClientEnvelope } = await import('@beluga/shared');
  const lue = ClientEnvelope.shape.cmd.safeParse({ type, ...donnees });
  if (!lue.success) {
    const forme = (await formeDesCommandes()).find((c) => c.type === type);
    return {
      ok: false,
      text: forme
        ? `Champs invalides pour « ${type} » : ${lue.error.issues.map((i) => `${i.path.join('.') || '(racine)'} — ${i.message}`).join(' ; ')}. Forme : ${type}(${forme.champs.join(', ')}).`
        : `Commande inconnue : « ${type} ». Cherche-la avec « lister ».`,
    };
  }
  try {
    const rendu = await commeLUtilisateur(lue.data as Record<string, unknown>);
    const texte = rendu === undefined ? 'Fait.' : JSON.stringify(rendu);
    return { ok: true, text: `« ${type} » joué. Réponse : ${texte.length > 6000 ? `${texte.slice(0, 6000)}… (coupé)` : texte}` };
  } catch (err: any) {
    return { ok: false, text: `« ${type} » refusé : ${err?.message ?? String(err)}` };
  }
}

/** Le compte au nom duquel l'assistant joue un geste d'écran : l'administrateur. */
async function compteDuGeste() {
  const { listerComptes: comptes } = await import('./comptes.js');
  const admin = comptes().find((c) => c.role === 'admin' && c.actif);
  if (!admin) throw new Error('aucun compte administrateur actif : le geste ne peut pas être joué');
  return admin;
}

/** Un geste d'écran, joué par la même porte que le bouton (`commandeCommeLUtilisateur`). */
async function commeLUtilisateur(cmd: Record<string, unknown>): Promise<any> {
  const { commandeCommeLUtilisateur } = await import('./ws.js');
  return commandeCommeLUtilisateur(cmd as never, await compteDuGeste());
}

function projetParNom(voulu: string): string | null {
  const vise = trouverLeProjetVise(
    store.listProjects(true).map((p) => ({ id: p.id, name: p.name, archive: p.archived })),
    voulu,
  );
  return vise.ok ? vise.projet.id : null;
}

/** Où est une carte, en une ligne : projet, colonne, rang, ancienneté et lien. */
function ligneDeCarte(card: { id: string; projectId: string; title: string; column: string; updatedAt: number }, rang?: number): string {
  const colonne = COLUMN_LABELS[card.column as ColumnKey] ?? card.column;
  const place = rang ? `, ${rang}e de la colonne` : '';
  return `- « ${card.title} » — projet ${nomDuProjet(card.projectId)}, colonne « ${colonne} »${place}, modifiée le ${jour(card.updatedAt)} — lien : [ouvrir la carte](${lienDeLaCarte(card.projectId, card.id)})`;
}

/** Les mots d'une recherche de carte parlée qui ne disent rien du titre (« la tâche de… », « ouvre… »). */
const MOTS_HORS_DU_TITRE = new Set([
  'la', 'le', 'les', 'de', 'du', 'des', 'un', 'une', 'et', 'ou', 'a', 'au', 'aux', 'en', 'sur', 'pour', 'dans', 'avec', 'qui', 'que',
  'tache', 'taches', 'carte', 'cartes', 'ouvre', 'ouvrir', 'montre', 'trouve', 'cherche', 'projet', 'appelle', 'appelee', 'quelque', 'chose',
  'celle', 'celui', 'truc', 'ce', 'cette', 'est', 'il', 'y', 'tu', 'vois', 'moi', 'me', 'peux',
]);

/**
 * LES CARTES QUI APPROCHENT UNE DEMANDE PARLÉE (18/11/2026). « la tâche de Beluga 70% » ne trouvait RIEN : la recherche
 * exige chaque mot tel quel, et « 70% » n'est pas « 70 % ». D'abord la recherche exacte ; sinon chaque mot utile (sans
 * ponctuation, « 70% » → « 70 ») est cherché seul, et les cartes qui en portent le plus passent devant (la moitié au
 * moins). Un projet visé qui n'a rien : tous les projets. Le titre pèse : il est cherché d'abord.
 */
export function trouverDesCartesApprochantes(texte: string, o: { projectId?: string; limite?: number } = {}): { card: Card; rang: number; ailleurs: boolean }[] {
  const limite = o.limite ?? 15;
  const exactes = store.rechercherDesCartes(texte, { projectId: o.projectId, limite });
  if (exactes.length) return exactes.map((t) => ({ ...t, ailleurs: false }));
  const mots = motsDeRecherche(texte);
  if (!mots.length) return [];
  const sansAccent = (v: string) => v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const chercher = (projectId?: string) => {
    const points = new Map<string, { trouvee: { card: Card; rang: number }; n: number }>();
    for (const mot of mots) {
      // UN MOT COMPTE UNE FOIS, par sa meilleure variante (lui, sa racine, ses équivalents).
      const meilleur = new Map<string, { trouvee: { card: Card; rang: number }; poids: number }>();
      for (const variante of mot.variantes) {
        for (const trouvee of store.rechercherDesCartes(variante, { projectId, limite: 50 })) {
          const poids = sansAccent(trouvee.card.title).includes(sansAccent(variante)) ? 1 : 0.5;
          const avant = meilleur.get(trouvee.card.id);
          if (!avant || avant.poids < poids) meilleur.set(trouvee.card.id, { trouvee, poids });
        }
      }
      for (const [id, { trouvee, poids }] of meilleur) points.set(id, { trouvee, n: (points.get(id)?.n ?? 0) + poids });
    }
    const seuil = Math.max(1, Math.ceil(mots.length / 2));
    return [...points.values()]
      .filter((x) => x.n >= seuil)
      .sort((a, b) => b.n - a.n || b.trouvee.card.updatedAt - a.trouvee.card.updatedAt)
      .slice(0, limite)
      .map((x) => x.trouvee);
  };
  const ici = chercher(o.projectId);
  if (ici.length || !o.projectId) return ici.map((t) => ({ ...t, ailleurs: false }));
  return chercher(undefined).map((t) => ({ ...t, ailleurs: true }));
}

/**
 * LES MOTS QUI DÉSIGNENT LA MÊME CHOSE À LA VOIX (carte « Jarvis plus fiable et vérifié », 18/11/2026) : le 18/11,
 * « améliore Jarvis » ne trouvait pas « Rendre l'assistant vocal beaucoup plus rapide ». L'assistant s'appelle Jarvis
 * à l'oral et « assistant vocal » dans les titres.
 */
const EQUIVALENTS_PARLES: Record<string, readonly string[]> = {
  jarvis: ['assistant vocal', 'voix', 'vocal'],
  vocal: ['voix', 'jarvis'],
  vocale: ['voix', 'jarvis'],
  voix: ['vocal', 'jarvis'],
  assistant: ['jarvis'],
};

/**
 * Les mots utiles d'une recherche parlée, chacun avec ses variantes : le mot tel qu'il est écrit (accents gardés : la
 * base compare les lettres telles quelles), sa RACINE quand il est long (« rapidité » → « rapid » trouve « rapide »),
 * et ses équivalents parlés. « 70% » → « 70 ».
 */
export function motsDeRecherche(texte: string): { mot: string; variantes: string[] }[] {
  const vus = new Set<string>();
  const sortie: { mot: string; variantes: string[] }[] = [];
  // « mets à jour la carte de… » : le geste demandé ne dit rien du titre.
  const sansGeste = texte.toLowerCase().replace(/\b(?:mets|met|mettre|mise|mettez)\s+(?:à|a)\s+jour\b/gu, ' ');
  for (const brut of sansGeste.split(/[^\p{L}\p{N}]+/u)) {
    const norme = brut.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (!brut || vus.has(norme) || MOTS_HORS_DU_TITRE.has(norme)) continue;
    if (brut.length < 3 && !/^\d+$/.test(brut)) continue;
    vus.add(norme);
    const variantes = new Set<string>([brut]);
    if (brut.length >= 7) variantes.add(brut.slice(0, Math.max(5, brut.length - 3)));
    for (const e of EQUIVALENTS_PARLES[norme] ?? []) variantes.add(e);
    sortie.push({ mot: brut, variantes: [...variantes] });
    if (sortie.length >= 8) break;
  }
  return sortie;
}

/** Les cartes approchantes, en lignes (projet, colonne, lien) : la note glissée à la voix les cite. */
export function cartesApprochantes(texte: string, limite = 4): string[] {
  return trouverDesCartesApprochantes(texte, { limite }).map(({ card, rang }) => ligneDeCarte(card, rang));
}

export async function deplacerCommeLUtilisateur(cardId: string, column: string): Promise<ToolResult> {
  const card = store.getCard(cardId);
  if (!card) return { ok: false, text: 'Carte introuvable.' };
  if (!(COLUMN_KEYS as readonly string[]).includes(column)) return { ok: false, text: `Colonne inconnue : ${column}. Colonnes : ${COLUMN_KEYS.join(', ')}.` };
  try {
    await commeLUtilisateur({ type: 'card.move', id: cardId, column });
  } catch (err: any) {
    return { ok: false, text: `Refusé : ${err?.message ?? String(err)}` };
  }
  const apres = store.getCard(cardId) ?? card;
  return { ok: true, text: `Carte déplacée.\n${ligneDeCarte(apres)}` };
}

async function gestes(args: Record<string, any>, projetVise?: string): Promise<ToolResult> {
  const action = String(args.action ?? '');
  const cardId = typeof args.cardId === 'string' ? args.cardId : '';
  try {
    switch (action) {
      case 'trouver': {
        const texte = String(args.texte ?? '').trim();
        if (!texte) return { ok: false, text: 'Donne quelques mots du titre (« texte »).' };
        // MOTS APPROCHANTS ET TOUS LES PROJETS (18/11/2026) : « Beluga 70% » trouve « Disque de Beluga à 70 % », dans HaikoInfra.
        const trouvees = trouverDesCartesApprochantes(texte, { projectId: projetVise, limite: 15 });
        if (!trouvees.length) return { ok: true, text: `Aucune carte ne correspond à « ${texte} », dans aucun projet.` };
        const ailleurs = projetVise && trouvees[0]?.ailleurs ? `Rien dans ${nomDuProjet(projetVise)} ; trouvé dans les autres projets :\n` : '';
        return {
          ok: true,
          text: `${ailleurs}${trouvees.map(({ card, rang }) => ligneDeCarte(card, rang)).join('\n')}\nPour l’ouvrir à l’écran : « assistant_ecran » « jouer », UN geste « ouvrir » avec l’adresse du lien (« #projet/…/tache/… »).`,
        };
      }
      case 'lancer': {
        if (!store.getCard(cardId)) return { ok: false, text: 'Carte introuvable.' };
        await commeLUtilisateur({ type: 'card.start', id: cardId });
        return { ok: true, text: `Carte lancée.\n${ligneDeCarte(store.getCard(cardId)!)}` };
      }
      case 'valider_proposition': {
        const proposalId = String(args.proposalId ?? '');
        const message = store.messageDeLaProposition(proposalId);
        if (!message) return { ok: false, text: 'Proposition introuvable (elle doit venir de cette conversation).' };
        await commeLUtilisateur({ type: 'proposal.decide', messageId: message.id, proposalId, accept: true });
        const creee = store.getMessage(message.id)?.proposals.find((p) => p.id === proposalId);
        const carte = creee?.cardId ? store.getCard(creee.cardId) : null;
        /* À LA VOIX, L'ÉCRAN PRINCIPAL BASCULE SUR LA CARTE CRÉÉE (décision de l'utilisateur, 20/11/2026), sans volet. */
        if (carte) void import('./voix-directe.js').then((m) => m.ouvrirLaCarteCreee(message.agentId, carte.id, carte.projectId)).catch(() => {});
        return { ok: true, text: carte ? `Carte créée — elle s'ouvre à l'écran.\n${ligneDeCarte(carte)}` : 'Proposition validée.' };
      }
      case 'changer_de_projet': {
        const vers = projetParNom(String(args.vers ?? ''));
        if (!vers) return { ok: false, text: `Projet d'arrivée introuvable. Projets : ${store.listProjects().map((p) => p.name).join(', ')}.` };
        await commeLUtilisateur({ type: 'card.deplacerVersProjet', id: cardId, projectId: vers });
        return { ok: true, text: `Carte déplacée vers ${nomDuProjet(vers)}.\n${ligneDeCarte(store.getCard(cardId)!)}` };
      }
      case 'deployer': {
        const projectId = projetVise;
        if (!projectId) return { ok: false, text: 'Dis quel projet déployer (« projet »).' };
        const cible = args.cible === 'production' ? 'production' : 'dev';
        // LA PRODUCTION NE SE DÉFAIT PAS (décision du 17/11/2026) : elle seule attend le « oui » dit à voix haute.
        if (cible === 'production' && args.confirme !== true) {
          return { ok: false, text: 'Refusé sans confirmation : la mise en production ne se défait pas. Redis-le à l’utilisateur, attends son « oui » à voix haute, puis rejoue avec « confirme »: true.' };
        }
        await commeLUtilisateur({ type: 'deploy.start', projectId, cible });
        return {
          ok: true,
          text: `${cible === 'production' ? 'Mise en production' : 'Déploiement'} de ${nomDuProjet(projectId)} lancé. Son avancement se lit dans la colonne de son étape.`,
        };
      }
      case 'redemarrer': {
        const issue = (await commeLUtilisateur({ type: 'daemon.restart' })) as { ok?: boolean; raison?: string; enAttente?: boolean };
        if (issue?.ok) return { ok: true, text: 'Beluga redémarre.' };
        return {
          ok: false,
          text: `Redémarrage refusé pour l'instant${issue?.raison ? ` : ${issue.raison}` : ''}. ${issue?.enAttente ? 'La demande est retenue : il partira tout seul dès que plus rien ne tournera (ta propre réponse comprise).' : ''}`.trim(),
        };
      }
      default:
        return { ok: false, text: `Action inconnue : ${action}.` };
    }
  } catch (err: any) {
    return { ok: false, text: `Refusé : ${err?.message ?? String(err)}` };
  }
}

const nomDuProjet = (id: string | null | undefined) => (id ? (store.getProject(id)?.name ?? id) : 'Beluga Build');
const jour = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString().slice(0, 10) : '—');

function compteAdmin() {
  const admin = listerComptes().find((c) => c.role === 'admin' && c.actif);
  if (!admin) throw new Error('aucun compte administrateur dans l’espace client');
  return admin;
}

async function resume(projetVise?: string, args: Record<string, any> = {}): Promise<ToolResult> {
  const maintenant = Date.now();
  const jourVoulu = args.jour !== undefined && args.jour !== null && String(args.jour).trim() ? resoudreLeJour(args.jour, maintenant) : null;
  if (args.jour && String(args.jour).trim() && !jourVoulu) {
    return { ok: false, text: `« ${args.jour} » n'est pas un jour compris : « hier », « aujourd'hui », « avant-hier », « AAAA-MM-JJ » ou « JJ/MM ».` };
  }
  const limite = limiteDActivite(args.limite);
  const projets = store.listProjects().filter((p) => !projetVise || p.id === projetVise);
  const nomParId = new Map(store.listProjects(true).map((p) => [p.id, p.name]));
  const agents = store.listAgents();
  const decisions = store.decisionsEnAttente().filter((d) => !projetVise || d.projectId === projetVise);
  let admin: ReturnType<typeof compteAdmin> | null = null;
  try {
    admin = compteAdmin();
  } catch {
    admin = null;
  }

  // 1. LES DERNIÈRES TÂCHES TERMINÉES, datées — une requête bornée (`shared/src/activite-recente.ts`).
  const bornes = jourVoulu ? bornesDuJour(jourVoulu) : undefined;
  const terminees = activiteRecente(
    store
      .cartesTermineesRecemment({ projectId: projetVise, depuis: bornes?.debut, avant: bornes?.fin, limite })
      .map((c) => ({ id: c.id, titre: c.title, projet: nomParId.get(c.projectId) ?? c.projectId, colonne: c.column, doneAt: c.doneAt })),
    { jour: jourVoulu, limite },
  );
  const libelle = (col: string) => COLUMN_LABELS[col as keyof typeof COLUMN_LABELS] ?? col;
  const sections: string[] = [`Maintenant : ${dateEtHeureDActivite(maintenant)} (heure de Paris).`];

  // 2. CE QUI TOURNE et CE QUI ATTEND, datés, puis 3. chaque projet.
  const enCours: string[] = [];
  const lignes: string[] = [];
  for (const projet of projets) {
    const cartes = store.listCards(projet.id);
    const parColonne = (Object.keys(COLUMN_LABELS) as (keyof typeof COLUMN_LABELS)[])
      .map((col) => `${COLUMN_LABELS[col]} ${cartes.filter((c) => c.column === col).length}`)
      .join(' · ');
    for (const c of cartes.filter((c) => c.column === 'running')) {
      enCours.push(`- ${projet.name} — « ${c.title} » — depuis ${dateEtHeureDActivite(c.updatedAt)} [${c.id}]`);
    }
    const auTravail = agents.filter((a) => a.projectId === projet.id && (a.status === 'running' || a.status === 'starting')).length;
    const attente = decisions.filter((d) => d.projectId === projet.id).length;
    const nonLus = admin ? espace.demandesAvecDuNouveau(projet.id, admin.id) : 0;
    lignes.push(
      `- ${projet.name} [${projet.id}] — ${parColonne}${auTravail ? ` — ${auTravail} agent(s) au travail` : ''}${attente ? ` — ${attente} décision(s) en attente` : ''}${nonLus ? ` — ${nonLus} demande(s) client avec du nouveau` : ''}`,
    );
    if (projetVise) {
      for (const c of cartes.filter((c) => c.column !== 'archived')) {
        lignes.push(`    · [${c.id}] « ${c.title} » — ${COLUMN_LABELS[c.column]} — modifiée ${dateEtHeureDActivite(c.updatedAt)}`);
      }
    }
  }
  /* LES TÂCHES EN COURS D'ABORD, PUIS LES TERMINÉES, chacune sous un titre qui dit ce qu'elle est (carte « Raccourcis
     libres et Jarvis vocal », 17/11/2026) : la voix lisait les terminées en premier et annonçait « en cours » une
     tâche déjà déployée. */
  sections.push(
    enCours.length
      ? `TÂCHES EN COURS (en ce moment) — En cours (${enCours.length}) :\n${enCours.join('\n')}`
      : 'TÂCHES EN COURS (en ce moment) — Aucune tâche en cours.',
  );
  sections.push(
    terminees.length
      ? `DERNIÈRES TÂCHES TERMINÉES (déjà finies, ne sont PAS en cours) — Tâches terminées${jourVoulu ? ` le ${jourVoulu}` : ' récemment'} (la plus récente d'abord, ${terminees.length}) :\n${terminees.map((c) => ligneDActivite(c, libelle(c.colonne))).join('\n')}`
      : `DERNIÈRES TÂCHES TERMINÉES (déjà finies, ne sont PAS en cours) — Aucune tâche terminée${jourVoulu ? ` le ${jourVoulu}` : ''}.`,
  );
  /* LES MISES EN LIGNE ET EN PRODUCTION (carte « Jarvis plus fiable et vérifié », 18/11/2026) : à 10 h 34, des mises
     en production tournaient pendant que Jarvis disait « aucune tâche en cours » ; il les a ensuite dites « en pause ».
     Elles ont désormais leur section, avec leur état réel, à part des tâches et de ce qui attend l'utilisateur. */
  sections.push(sectionDesPublications(maintenant, projetVise, nomParId));
  sections.push(await sectionDesPublicationsQuiAttendent(projetVise, nomParId));
  const attentes = [...decisions]
    .sort((a, b) => (b.poseeA ?? 0) - (a.poseeA ?? 0))
    .slice(0, LIMITE_DECISIONS_DU_RESUME)
    .map(
      (d) =>
        `- ${d.poseeA ? dateEtHeureDActivite(d.poseeA) : '—'} — ${d.projectName ?? nomParId.get(d.projectId) ?? d.projectId} — ${d.lieuTitre ?? ''}${d.texte ? ` : ${d.texte.slice(0, 140)}` : ''}`,
    );
  // Les décisions portent déjà les questions des agents et les plans à valider (la même liste que la cloche).
  sections.push(
    attentes.length
      ? `CE QUI T'ATTEND (décisions, questions, plans — ${decisions.length}) :\n${attentes.join('\n')}`
      : "CE QUI T'ATTEND (décisions, questions, plans) — Rien n'attend ta réponse.",
  );
  sections.push(`Projets :\n${lignes.join('\n') || 'Aucun projet.'}`);
  return { ok: true, text: sections.join('\n\n') };
}

/**
 * La section « MISES EN LIGNE ET EN PRODUCTION » du résumé : les publications qui tournent (seules dites « en cours »),
 * puis celles finies depuis peu, et les agents sans carte au travail (configuration d'une étape, dépannage).
 */
export function sectionDesPublications(maintenant: number, projetVise?: string, noms?: Map<string, string>): string {
  const nom = (id: string) => noms?.get(id) ?? store.getProject(id)?.name ?? id;
  let runs: ReturnType<typeof store.productionsAAfficher> = [];
  try {
    runs = [...store.productionsAAfficher(maintenant), ...store.deploiementsAAfficher(maintenant)];
  } catch (err) {
    log.warn(`résumé : publications illisibles — ${(err as Error).message}`);
  }
  const { enCours, recentes } = publicationsDuResume(
    runs
      .filter((r) => !projetVise || r.projectId === projetVise)
      .map((r) => ({ projet: nom(r.projectId), cible: r.cible, state: r.state, startedAt: r.startedAt, endedAt: r.endedAt })),
  );
  const systeme = store
    .listAgents()
    .filter((a) => !a.cardId && !a.assistantGlobal && a.role !== 'analysis' && a.attendReponse !== true && agentSystemeActif(a))
    .filter((a) => !projetVise || a.projectId === projetVise)
    .map((a) => `- ${nom(a.projectId)} — agent système « ${a.title} » au travail`);
  const enTete = 'MISES EN LIGNE ET EN PRODUCTION (en ce moment, état réel)';
  const morceaux = [
    enCours.length || systeme.length
      ? `${enTete} — En cours (${enCours.length + systeme.length}) :\n${[...enCours, ...systeme].join('\n')}`
      : `${enTete} — Aucune publication en train de tourner.`,
  ];
  if (recentes.length) morceaux.push(`Finies récemment (ne tournent PLUS) :\n${recentes.join('\n')}`);
  return morceaux.join('\n');
}

/**
 * LES PUBLICATIONS QUI ATTENDENT UN GESTE (« À déployer », « Mise en production en attente ») : la même source que les
 * Tableaux de bord (`publicationsEnAttente`, lectures en base seulement), bornée à 3 s pour ne jamais retenir le
 * dossier de la voix (`avantLeDelai`). Illisible : on le DIT, on n'écrit jamais « rien n'attend ».
 */
async function sectionDesPublicationsQuiAttendent(projetVise?: string, noms?: Map<string, string>): Promise<string> {
  const nom = (id: string) => noms?.get(id) ?? store.getProject(id)?.name ?? id;
  try {
    const { publicationsEnAttente } = await import('./deploy.js');
    let minuterie: NodeJS.Timeout | undefined;
    const rendu = await Promise.race([
      publicationsEnAttente(),
      new Promise<never>((_, refus) => {
        minuterie = setTimeout(() => refus(new Error('délai de 3 s dépassé')), 3000);
      }),
    ]).finally(() => clearTimeout(minuterie));
    return sectionDesPublicationsEnAttente(
      {
        aDeployer: rendu.aDeployer.filter((l) => !projetVise || l.projectId === projetVise),
        aProduire: rendu.aProduire.filter((l) => !projetVise || l.projectId === projetVise),
      },
      nom,
    );
  } catch (err) {
    log.warn(`résumé : publications en attente illisibles — ${(err as Error).message}`);
    return `${TITRE_DES_PUBLICATIONS_EN_ATTENTE} — illisibles pour l'instant : ne dis PAS que rien n'attend, renvoie aux Tableaux de bord.`;
  }
}

/**
 * L'ACTIVITÉ DU MOMENT, EN COURT, pour le dossier de vérification de la voix : l'heure, les tâches au travail, les mises
 * en ligne et en production, ce qui attend l'utilisateur — les sections du résumé, sans la liste des projets.
 */
export async function activitePourLaVoix(): Promise<string> {
  const r = await resume(undefined, { limite: 3 });
  return r.text
    .split('\n\n')
    .filter((bloc) => /^(Maintenant|TÂCHES EN COURS|MISES EN LIGNE ET EN PRODUCTION|PUBLICATIONS EN ATTENTE|CE QUI T'ATTEND)/.test(bloc))
    .join('\n\n');
}

/** Les décisions listées dans le résumé : au-delà, seul le compte est donné. */
const LIMITE_DECISIONS_DU_RESUME = 10;

export async function messagerie(args: Record<string, any>, projetVise?: string): Promise<ToolResult> {
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

export async function surveillances(args: Record<string, any>): Promise<ToolResult> {
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

export function backups(args: Record<string, any>): ToolResult {
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
