import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  AGENT_MOVABLE_COLUMNS,
  AgentQuestion,
  Attachment,
  texteSansAttente,
  COLUMN_LABELS,
  Card,
  ColumnKey,
  Estimate,
  RunConfig,
  SouhaitReglages,
  TaskProposal,
  canMove,
  nomSansCollision,
  heritageAnalyseDeProposition,
  repriseAutorisee,
  reglagesDeLaProposition,
  composerDescription,
  jugerDescription,
  jugerSynthese,
  MIN_SIGNES_SYNTHESE,
  MAX_SIGNES_SYNTHESE,
  lireDateDeDepart,
  momentDeDepart,
  MAX_SIGNES_DESCRIPTION,
  MIN_SIGNES_DESCRIPTION,
  MIN_SIGNES_CARTE_COURTE,
  RAISON_ATTENTE_LANCEMENT,
  type ExigenceDescription,
  DEFINITIONS_NIVEAU,
  NIVEAUX_AGENT,
  NIVEAU_PAR_DEFAUT,
  niveauDemande,
  type NiveauAgent,
  DOSSIER_PLANS,
  EXTENSIONS_DOCUMENT,
  cheminDuDocument,
  GESTES_GROUPE,
  GESTES_PROJET,
  lireGesteGroupe,
  lireGesteProjet,
  rangsApresDeplacement,
  resumeColonneDeGauche,
  retrouverParNom,
  confianceDeLaFiche,
  raisonDuRefus,
  type ProjetDeLaColonne,
  momentDuCreneau,
  nomDeSujetMesure,
  CONSERVATION_MAX,
  CONSERVATION_MIN,
  CONSERVATION_PAR_DEFAUT,
  FREQUENCE_MINUTES_MAX,
  FREQUENCE_MINUTES_MIN,
  FREQUENCE_MINUTES_PAR_DEFAUT,
  phraseDeCadence,
  MOTEURS_BASE,
  MOYENS_FICHIERS,
  essaisConcluants,
  ficheProposee,
  siteVide,
  phraseDesEssais,
  jugerSite,
  LIBELLE_MOTEUR_BASE,
  LIBELLE_MOYEN_FICHIERS,
} from '@haikodev/shared';
import * as store from './store.js';
import { createProjectFolder, sourceDHeritageDuProjet } from './projects.js';
import { bus } from './bus.js';
import { CONFIG, PATHS } from './config.js';
import { mintDownload } from './auth.js';
import { readMemory, appendMemory, detailProjet } from './memory.js';
import { synthetiserSiNecessaire } from './synthese-memoire.js';
import { makeZip, safeJoin } from './files.js';
import { enregistrerSite, essayerLesAcces, lireSite } from './snapshots.js';
import { log } from './logger.js';
import { catalogueMoteurs } from './catalogue-moteurs.js';
import {
  compter,
  compteursDeLaFiche,
  ecrireLaFiche,
  etatDuPoolPourLEcran,
  lirePool,
  listerCompetences,
  relierCompetencesAuxCoffres,
} from './competences.js';

/** Une liste écrite en une ligne : « mobile, interface » → deux entrées. */
function decouperListe(valeur?: string): string[] | undefined {
  if (!valeur) return undefined;
  const propres = valeur
    .split(/[,;]/)
    .map((mot) => mot.trim())
    .filter(Boolean);
  return propres.length ? propres : undefined;
}
import { creneauPourUneCarte } from './heure-de-lancement.js';

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
  'La demande REFORMULÉE en deux ou trois phrases : ce que veut l’utilisateur et ce qui compte pour lui. ' +
  `Entre ${MIN_SIGNES_CARTE_COURTE} et ${MAX_SIGNES_DESCRIPTION} signes ; une description vide ou réduite au titre est REFUSÉE et rendue à réécrire. ` +
  'N’ouvre pas le projet et n’invente aucun constat sur le code : l’étude est le travail de l’agent qui exécutera la carte. ' +
  'Les champs séparés (constat, attendu, limites, verification) restent acceptés quand tu les as vraiment établis : HaikoDev les met en forme.';

/** Les trois paliers, décrits une seule fois (`shared/src/niveau-agent.ts`). */
const CHAMP_NIVEAU = {
  type: 'string',
  enum: NIVEAUX_AGENT,
  description:
    "Le NIVEAU de l'agent qui exécutera la carte — " +
    NIVEAUX_AGENT.map((id) => `« ${id} » : ${DEFINITIONS_NIVEAU[id].quand}`).join(' ') +
    ` Dans le doute, « ${NIVEAU_PAR_DEFAUT} ». Tu ne nommes jamais un modèle : HaikoDev traduit le niveau.`,
};

/**
 * La date de départ, facultative. Elle ne remplace aucun geste : elle donne le
 * geste à l'AVANCE. Sans elle, la carte attend le lancement comme aujourd'hui.
 */
const CHAMP_DEPART =
  "Facultatif. Date et heure de départ souhaitées, au format ISO (« 2026-08-12T06:00 »). La carte attend alors dans " +
  "« Planifié » et part TOUTE SEULE à l'heure dite, sans clic. À ne mettre que si l'utilisateur a demandé un moment " +
  'précis. Sans ce champ, rien ne change : la carte attend son geste de lancement.';

/**
 * Le relais d'une analyse RÉELLEMENT menée. Le chef d'orchestre ne le remplit
 * plus — il ne lit plus le projet avant de proposer —, mais le champ reste :
 * un agent qui vient de chiffrer une carte y transmet ses constats.
 */
const CHAMP_ANALYSE = {
  type: 'object',
  description:
    "FACULTATIF, et le chef d'orchestre ne le remplit plus en tri normal : il ne chiffre plus, l'étude appartient à la carte. Réservé à un agent qui vient RÉELLEMENT de mener l'analyse — ET au chef qui vient de faire valider un PLAN (mode plan) : `context` reprend alors le plan entier, pour qu'il voyage jusqu'à l'agent d'exécution.",
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
    clientExplanation: {
      type: 'string',
      description:
        "Ce que le CLIENT lira sur son devis ou sa facture : deux ou trois phrases simples et ludiques, sans jargon technique ni nom de fichier.",
    },
    context: {
      type: 'string',
      description:
        "Relais factuel pour l'agent : constats utiles, fichiers concernés, approche retenue et contrôles à rejouer. Ne recopie pas toute la carte.",
    },
  },
};

/**
 * LE CHAMP QUI PORTE L'ÉCHANGE JUSQU'À L'AGENT. Le titre est court et la
 * description reformule la demande : tout le reste de la discussion — les
 * réflexions, les contraintes dites en passant, ce qui a été écarté — vivait
 * dans la conversation du chef et mourait avec elle. Ce champ le transporte, et
 * HaikoDev le dépose en PREMIER MESSAGE du fil de la carte.
 */
const CHAMP_SYNTHESE = {
  type: 'string',
  description:
    "OBLIGATOIRE. La SYNTHÈSE ENTIÈRE du besoin, telle qu'elle ressort de l'échange avec l'utilisateur : ce qu'il veut, " +
    "pourquoi, sur quel écran, les contraintes et préférences énoncées, ce qui a été écarté en chemin, ce qui reste ouvert. " +
    `Entre ${MIN_SIGNES_SYNTHESE} et ${MAX_SIGNES_SYNTHESE} signes. Ce texte est déposé tel quel comme PREMIER MESSAGE de la ` +
    "conversation de l'agent, visible avant même qu'il démarre : écris-le pour quelqu'un qui n'était pas là.",
};

/**
 * La synthèse du besoin, jugée avant d'être portée par la proposition. Une
 * carte sans elle n'est pas affichée : l'agent repartirait du seul titre.
 */
function syntheseDeProposition(args: any): { briefing: string } | { refus: string } {
  const texte = typeof args?.contexte === 'string' ? args.contexte.trim() : '';
  /*
   * `secours` n'est PAS dans le schéma de l'outil : aucun modèle ne connaît ce
   * drapeau. Seul le démon le pose, quand c'est LUI qui rattrape une carte
   * décrite en texte (`poserLaCarteRelue`) — il n'y a alors pas de synthèse
   * rédigée, et refuser la carte pour cela la ferait disparaître pour de bon.
   */
  if (args?.secours === true) return { briefing: texte };
  const verdict = jugerSynthese(texte);
  if (!verdict.ok) return { refus: verdict.message };
  return { briefing: texte };
}

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
    clientExplanation: raw.clientExplanation,
    failed: false,
  });
  if (!estimate.success || (estimate.data.machineSeconds === undefined && estimate.data.seniorHours === undefined)) {
    return {};
  }
  return { estimate: estimate.data, analysisContext };
}

/**
 * Ce qu'on exige de la description, selon QUI propose. Le chef d'orchestre
 * trie : sa carte est courte, et c'est voulu. Tout autre rôle qui propose une
 * carte vient d'étudier le projet : il garde les quatre parties.
 */
function exigenceDuRole(role: ToolContext['role']): ExigenceDescription {
  return role === 'cadrage' ? 'courte' : 'complete';
}

/**
 * La date de départ demandée par le chef, s'il y en a une. Ce qui n'est pas une
 * date est ignoré en silence : une proposition ne doit pas être refusée parce
 * qu'un moteur a écrit « mardi prochain » dans un champ facultatif — la carte
 * repart alors simplement sur le geste de lancement habituel.
 */
function departDeProposition(args: any): Pick<TaskProposal, 'departPrevu'> | Record<string, never> {
  const date = lireDateDeDepart(args?.depart);
  return date ? { departPrevu: date } : {};
}

/** Ce que l'outil répond au chef quand une date a été retenue. */
function resumeDepart(depart: Pick<TaskProposal, 'departPrevu'> | Record<string, never>): string {
  if (!('departPrevu' in depart) || !depart.departPrevu) return '';
  return ` Départ programmé ${momentDeDepart(depart.departPrevu, Date.now())} : la carte partira toute seule à l'heure dite.`;
}

/**
 * Fabrique la description d'une proposition, à partir des quatre champs
 * séparés OU du texte libre, puis la juge. Une description qui ne tient pas
 * debout ne devient PAS une proposition : elle est rendue au moteur avec le
 * gabarit, et le chef recommence. C'est le seul endroit où l'exigence est
 * appliquée — les deux outils du chef passent par ici.
 */
function descriptionDeProposition(
  args: any,
  exigence: ExigenceDescription,
): { description: string } | { refus: string } {
  const parties = {
    intro: typeof args.intro === 'string' ? args.intro : '',
    constat: typeof args.constat === 'string' ? args.constat : '',
    attendu: typeof args.attendu === 'string' ? args.attendu : '',
    limites: typeof args.limites === 'string' ? args.limites : '',
    verification: typeof args.verification === 'string' ? args.verification : '',
  };
  const composee = composerDescription(parties);
  const libre = typeof args.description === 'string' ? args.description.trim() : '';
  // Les champs séparés l'emportent : c'est HaikoDev qui met alors en forme.
  const description = composee || libre;

  /*
   * Une carte du chef d'orchestre est jugée « courte » : il ne lit plus le
   * projet, donc lui réclamer quatre parties et un repère concret reviendrait à
   * lui faire inventer un constat. Un agent d'un AUTRE rôle qui propose une
   * carte a, lui, vraiment étudié : il garde l'exigence complète.
   */
  const verdict = jugerDescription(description, exigence);
  if (!verdict.ok) return { refus: verdict.message };
  return { description };
}

/**
 * Refus posé au niveau de l'outil (pas seulement dans la consigne) quand la
 * conversation tourne en mode plan (PLAN §2 principe 3) : `board_create_card`
 * et `propose_task` créeraient la proposition avec ses boutons valider /
 * refuser — exactement le geste du mode direct que le mode plan doit éviter.
 * Le mode plan attend un PLAN écrit dans la conversation, pas une carte.
 */
const REFUS_MODE_PLAN =
  "Refusé : la conversation est en MODE PLAN. N'appelle pas cet outil ici — réponds directement dans la conversation avec un plan complet et structuré (faisabilité, chemin à suivre, conséquences, améliorations apportées), sans carte ni bouton. " +
  "NE DIS PAS À L'UTILISATEUR QUE LA CRÉATION EST BLOQUÉE et ne lui demande pas de quitter le mode plan : le bouton « Valider » au bas de ton plan s'en charge tout seul, et le tour suivant te laissera proposer la carte. " +
  'Écris donc ton plan, entier, et rien d’autre : c’est lui qu’on attend. Une fois validé, tu proposeras la carte en recopiant le plan entier dans le champ `analysis.context`, pour qu’il suive l’agent d’exécution.';

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
      required: ['title', 'niveau', 'contexte'],
      properties: {
        title: { type: 'string', description: 'Titre court et clair' },
        description: { type: 'string', description: CHAMP_DESCRIPTION },
        contexte: CHAMP_SYNTHESE,
        constat: { type: 'string', description: "Ce que le projet fait aujourd'hui, avec un repère concret vu dans le projet" },
        attendu: { type: 'string', description: 'Ce que le projet doit faire une fois la carte terminée' },
        limites: { type: 'string', description: "Ce qu'on ne touche pas, ni n'élargit" },
        verification: { type: 'string', description: "Comment savoir que c'est fait" },
        niveau: CHAMP_NIVEAU,
        labels: { type: 'array', items: { type: 'string' } },
        depart: { type: 'string', description: CHAMP_DEPART },
        analysis: CHAMP_ANALYSE,
      },
    },
  },
  {
    name: 'board_update_card',
    description:
      "Modifie le titre, la description, les étiquettes ou le NIVEAU d'exécution d'une carte existante.",
    inputSchema: {
      type: 'object',
      required: ['cardId'],
      properties: {
        cardId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        labels: { type: 'array', items: { type: 'string' } },
        /*
         * LE NIVEAU DE L'AGENT QUI EXÉCUTERA LA CARTE. C'est par ici que
         * l'agent de cadrage choisit l'ampleur du travail — jamais un modèle
         * nommé : HaikoDev traduit le palier en moteur, modèle et réflexion
         * réels (`shared/src/niveau-agent.ts`).
         */
        niveau: CHAMP_NIVEAU,
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
      required: ['title', 'niveau', 'contexte'],
      properties: {
        title: { type: 'string' },
        description: { type: 'string', description: CHAMP_DESCRIPTION },
        contexte: CHAMP_SYNTHESE,
        intro: {
          type: 'string',
          description:
            "Une ou deux phrases simples et ludiques, SANS jargon ni nom de fichier, qui disent en langage courant ce que la carte va changer et pourquoi. Affichée en tête de la description, avant le Constat technique.",
        },
        constat: { type: 'string', description: "Ce que le projet fait aujourd'hui, avec un repère concret vu dans le projet" },
        attendu: { type: 'string', description: 'Ce que le projet doit faire une fois la carte terminée' },
        limites: { type: 'string', description: "Ce qu'on ne touche pas, ni n'élargit" },
        verification: { type: 'string', description: "Comment savoir que c'est fait" },
        niveau: CHAMP_NIVEAU,
        labels: { type: 'array', items: { type: 'string' } },
        depart: { type: 'string', description: CHAMP_DEPART },
        analysis: CHAMP_ANALYSE,
      },
    },
  },
  {
    name: 'write_document',
    description:
      'Crée, remplace ou SUPPRIME un document (texte, Markdown, traitement de texte) ' +
      `n'importe où dans le projet : ${EXTENSIONS_DOCUMENT.join(', ')}. Seul outil d'écriture du ` +
      "chef d'orchestre, et le seul geste qui survive à la conversation. Le CODE en est exclu : " +
      "le créer, le modifier ou l'effacer se délègue à un agent de tâche, par une carte. " +
      'Pour MODIFIER un document, relis-le puis réécris-le entier sous le même chemin. ' +
      `Un nom NU sans dossier (« refonte-accueil ») est rangé dans ${DOSSIER_PLANS}/.`,
    inputSchema: {
      type: 'object',
      required: ['relativePath'],
      properties: {
        relativePath: {
          type: 'string',
          description:
            `Chemin dans le projet, ex. « docs/memoire/cartes.md » ou « README.md ». ` +
            `Un nom sans dossier est rangé d'office dans ${DOSSIER_PLANS}/.`,
        },
        content: { type: 'string', description: "Le contenu ENTIER du document (inutile pour « supprimer »)" },
        action: {
          type: 'string',
          enum: ['ecrire', 'supprimer'],
          description: "« ecrire » (par défaut) crée ou remplace ; « supprimer » efface le document",
        },
      },
    },
  },
  {
    name: 'project_manage',
    description:
      "LA COLONNE DE GAUCHE : liste, monte, renomme, range ou met de côté un PROJET. Ouvert à tout agent, chef " +
      "d'orchestre compris — c'est son seul moyen d'agir sur les projets, puisqu'il ne peut pas écrire dans le " +
      "projet. Commence TOUJOURS par « lister » : les projets se désignent par leur NOM, jamais par un identifiant " +
      "deviné. « creer » MONTE le projet en entier (dossier, dépôt git, GitHub, fichiers de départ, adresse " +
      "publique) et exige le sous-domaine et le port, demandés à l'utilisateur avec « ask_user » AVANT l'appel. " +
      "Un projet ne se SUPPRIME jamais : « retirer » le met de côté sans rien perdre, « remettre » le fait revenir. " +
      "Chaque geste se voit aussitôt dans la colonne de gauche.",
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: GESTES_PROJET,
          description:
            'lister = la colonne de gauche telle qu’elle est ; creer = monter un projet neuf ; renommer ; ' +
            'deplacer = changer de groupe et/ou de position ; retirer = mettre de côté ; remettre = remettre en service',
        },
        projet: { type: 'string', description: 'Le projet visé, par son NOM (renommer, deplacer, retirer, remettre)' },
        nom: { type: 'string', description: 'Le nom voulu (creer, renommer)' },
        dossier: { type: 'string', description: 'Nom du dossier sur le serveur (creer, facultatif : déduit du nom)' },
        description: { type: 'string', description: 'À quoi sert ce projet, en une phrase (creer, facultatif)' },
        sousDomaine: { type: 'string', description: "Le nom court de l'adresse publique (creer)" },
        port: { type: 'number', description: 'Le port sur lequel le projet écoutera sur le serveur (creer)' },
        sansAdresse: {
          type: 'boolean',
          description: "À mettre à vrai UNIQUEMENT si l'utilisateur a dit ne pas vouloir d'adresse publique (creer)",
        },
        github: { type: 'boolean', description: 'Créer le dépôt GitHub privé (creer, vrai par défaut)' },
        groupe: {
          type: 'string',
          description: "Le groupe d'arrivée, par son nom — « aucun » pour sortir le projet de son groupe (deplacer)",
        },
        position: { type: 'number', description: 'Rang voulu dans la colonne, 1 = tout en haut (deplacer)' },
      },
    },
  },
  {
    name: 'group_manage',
    description:
      "LES GROUPES DE LA COLONNE DE GAUCHE : liste, crée, renomme et règle un groupe (couleur, replié ou déplié, " +
      "position). Les groupes se désignent par leur NOM. Retirer un groupe n'est PAS possible : cela déplacerait " +
      "d'un coup tous ses projets, et ce geste reste à l'utilisateur. Pour ranger un projet dans un groupe, " +
      "utilise « project_manage » avec l'action « deplacer ».",
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: GESTES_GROUPE,
          description: 'lister ; creer ; renommer ; regler = couleur, repli et position',
        },
        groupe: { type: 'string', description: 'Le groupe visé, par son NOM (renommer, regler)' },
        nom: { type: 'string', description: 'Le nom voulu (creer, renommer)' },
        couleur: {
          type: 'string',
          description: 'Une couleur nommée (« bleu », « vert »…), un code « #3b82f6 », ou « aucune » pour la retirer',
        },
        replie: { type: 'boolean', description: 'Vrai = groupe replié dans la colonne, faux = déplié (regler)' },
        position: { type: 'number', description: 'Rang voulu dans la colonne, 1 = tout en haut (creer, regler)' },
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
    name: 'attach_screenshot',
    description:
      "Joint une image déjà présente sur disque (capture d'écran de test, vignette…) à TA réponse : elle s'affiche " +
      "directement dans la conversation, comme une pièce jointe reçue de l'utilisateur. À utiliser après un script " +
      "de vérification qui a pris des captures (ex. navigateur d'essai) : donne le chemin du fichier PNG/JPG déjà " +
      "écrit. Le chemin peut être relatif à ton dossier de travail, ou absolu.",
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'Chemin du fichier image déjà écrit sur disque' },
        label: { type: 'string', description: 'Nom à afficher (facultatif, sinon celui du fichier)' },
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
            "Ce que tu cherches : un numéro de l'index de faits (« 12 »), un nom de sujet (« publication », « cartes », « voix », « quotas »…), ou des mots-clés. Sur une carte, un gros sujet est servi au poids de ta demande, et ce qui est écarté est dit : ajoute « entier » (« cartes entier ») pour l'avoir en entier.",
        },
      },
    },
  },
  {
    name: 'competences',
    description:
      "Le POOL DE COMPÉTENCES PARTAGÉ, valable pour TOUS les projets. Trois actions. « lister » rend les fiches, " +
      "leur état et leur confiance. « ecrire » crée ou COMPLÈTE une fiche à partir d'une leçon PROUVÉE — une fiche " +
      "sans section « Vérification », ou dont la description ne dit pas quand s'en servir, est refusée avec sa raison. " +
      "« retour » dit ce qu'une compétence servie t'a réellement apporté : c'est ce qui fait monter ou descendre sa " +
      'confiance. Une leçon qui ne vaut que pour un seul projet ne se capitalise pas.',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['lister', 'ecrire', 'retour'], description: 'Ce que tu veux faire' },
        nom: {
          type: 'string',
          description: 'Le nom de la fiche, en minuscules avec des traits d’union (« barre-detat-pwa »)',
        },
        description: {
          type: 'string',
          description: "À quoi elle sert et QUAND s'en servir : c'est cette phrase qui la déclenche",
        },
        themes: { type: 'string', description: 'Thèmes, séparés par des virgules (« mobile, interface »)' },
        symptomes: { type: 'string', description: 'Ce qu’on CONSTATE, séparé par des virgules' },
        projets: {
          type: 'string',
          description: 'Les projets concernés, séparés par des virgules. VIDE = tous (le cas normal)',
        },
        symptome: { type: 'string', description: 'Section « Symptôme »' },
        cause: { type: 'string', description: 'Section « Cause »' },
        procedure: { type: 'string', description: 'Section « Procédure », pas à pas' },
        verification: { type: 'string', description: 'Section « Vérification » — OBLIGATOIRE' },
        pieges: { type: 'string', description: 'Section « Pièges »' },
        echecs: { type: 'string', description: 'Section « Ce qui ne marche pas »' },
        carte: { type: 'string', description: "L'identifiant de la carte d'origine, pour la provenance" },
        utile: { type: 'boolean', description: 'Pour « retour » : la fiche a-t-elle servi (vrai) ou pas (faux) ?' },
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
  {
    name: 'snapshot_site',
    description:
      "ENREGISTRE LA FICHE D'UN SITE À SAUVEGARDER (snapshots des sites en production). C'est le geste final de " +
      "l'assistant de configuration : après avoir lu le serveur et posé ses questions avec « ask_user », tu poses ici " +
      "la fiche entière, en UN seul appel. Sans « id », un nouveau site est créé ; avec l'« id » d'un site existant, " +
      "la fiche est corrigée et ce que tu ne redis pas est CONSERVÉ (un mot de passe déjà enregistré ne se perd pas). " +
      "La fiche doit sauvegarder quelque chose : une base, des fichiers, ou les deux — sinon elle est refusée en " +
      "disant ce qui manque. Les identifiants donnés servent à relire la base et les fichiers chaque nuit.",
    inputSchema: {
      type: 'object',
      required: ['nom'],
      properties: {
        id: { type: 'string', description: "L'identifiant d'un site déjà enregistré, pour le corriger" },
        nom: { type: 'string', description: 'Comment reconnaître ce site' },
        projectId: { type: 'string', description: "Le projet de ce serveur dont ce site est la production (facultatif)" },
        actif: { type: 'boolean', description: 'Un site éteint garde son historique mais ne tourne plus' },
        base: {
          type: 'object',
          description: "La base de données du site. Sans base, mettre moteur « aucune ».",
          properties: {
            moteur: { type: 'string', enum: [...MOTEURS_BASE], description: 'aucune, mysql, postgres ou sqlite' },
            hote: { type: 'string', description: "Machine de la base — vide vaut « la même que le site »" },
            port: { type: 'string' },
            nom: { type: 'string', description: 'Nom de la base, ou CHEMIN du fichier pour sqlite' },
            utilisateur: { type: 'string' },
            motDePasse: { type: 'string' },
          },
        },
        fichiers: {
          type: 'object',
          description: "Les fichiers du site. Sans fichiers, mettre moyen « aucun ».",
          properties: {
            moyen: { type: 'string', enum: [...MOYENS_FICHIERS], description: 'aucun, local, ssh ou ftp' },
            chemin: { type: 'string', description: 'Le dossier à prendre, du côté du site' },
            hote: { type: 'string' },
            port: { type: 'string' },
            utilisateur: { type: 'string' },
            motDePasse: { type: 'string' },
          },
        },
        conservationJours: {
          type: 'number',
          description: `Au-delà de ce nombre de jours, un point de sauvegarde est jeté (${CONSERVATION_MIN} à ${CONSERVATION_MAX}, ${CONSERVATION_PAR_DEFAUT} par défaut)`,
        },
        frequenceMinutes: {
          type: 'number',
          description: `Tous les combien de MINUTES ce site est repris (${FREQUENCE_MINUTES_MIN} à ${FREQUENCE_MINUTES_MAX} ; 15 = un quart d’heure, 60 = une heure, ${FREQUENCE_MINUTES_PAR_DEFAUT} = une fois par jour, par défaut)`,
        },
        note: { type: 'string', description: 'Ce que ce site contient et qui l’exploite, en une phrase' },
        forcer: {
          type: 'boolean',
          description:
            "N'enregistre la fiche QUE si l'utilisateur a explicitement accepté qu'un accès qui ne répond pas soit gardé tel quel (machine éteinte, site pas encore en ligne). Sans cela, une fiche dont la base ou les fichiers ne répondent pas est refusée.",
        },
      },
    },
  },
  {
    name: 'snapshot_essai',
    description:
      "ESSAIE POUR DE VRAI LES ACCÈS D'UNE FICHE DE SAUVEGARDE, sans rien enregistrer ni rien sauvegarder : la base est ouverte (son schéma est lu puis jeté) et le dossier des fichiers est listé. Rend, pour chacun, s'il répond et ce que la machine a dit. Appelle-le AVANT « snapshot_site » : une fiche complète n'est pas une fiche juste. Prends soit l'« id » d'un site déjà enregistré, soit les mêmes champs que « snapshot_site ».",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: "L'identifiant d'un site déjà enregistré, à essayer tel qu'il est" },
        nom: { type: 'string' },
        base: {
          type: 'object',
          properties: {
            moteur: { type: 'string', enum: [...MOTEURS_BASE] },
            hote: { type: 'string' },
            port: { type: 'string' },
            nom: { type: 'string' },
            utilisateur: { type: 'string' },
            motDePasse: { type: 'string' },
          },
        },
        fichiers: {
          type: 'object',
          properties: {
            moyen: { type: 'string', enum: [...MOYENS_FICHIERS] },
            chemin: { type: 'string' },
            hote: { type: 'string' },
            port: { type: 'string' },
            utilisateur: { type: 'string' },
            motDePasse: { type: 'string' },
          },
        },
      },
    },
  },
];

/** Les outils réservés aux agents de tâche : l'agent de cadrage ne les voit pas. */
export const TASK_ONLY_TOOLS = new Set(['remember', 'snapshot_site', 'snapshot_essai']);

/**
 * Ce que l'AGENT DE CADRAGE ne voit pas. Cette conversation EST la carte : lui
 * laisser de quoi en proposer une autre, c'est repartir dans le parcours que le
 * « + » remplace. Le reste des outils du démon lui sert vraiment — écrire SA
 * carte (`board_update_card`), poser une question (`ask_user`), consulter la
 * mémoire ou les compétences.
 */
export const CADRAGE_BLOCKED_TOOLS = new Set([
  ...TASK_ONLY_TOOLS,
  'board_create_card',
  'propose_task',
  'board_delete_card',
  'board_move_card',
  'make_archive',
]);

export function toolsFor(role: ToolContext['role']): ToolDef[] {
  if (role === 'cadrage') return TOOL_DEFS.filter((t) => !CADRAGE_BLOCKED_TOOLS.has(t.name));
  return TOOL_DEFS;
}

export interface ToolContext {
  agentId: string;
  projectId: string;
  role: 'task' | 'analysis' | 'deploy' | 'cadrage';
  cardId?: string;
  /**
   * Les réglages de la CONVERSATION en cours (moteur, modèle, réflexion),
   * ceux qu'on voit dans la barre d'écriture. Une carte proposée en hérite :
   * discuter avec Codex et se voir proposer du Claude n'a aucun sens.
   */
  run?: SouhaitReglages;
  /**
   * Le mode de la conversation (`RunConfig.mode`). En mode « plan », le chef
   * doit rendre un plan en texte, jamais une carte : les deux outils de
   * proposition sont refusés ICI, au niveau de l'outil (PLAN §2 principe 3),
   * pas seulement dans la consigne.
   */
  mode?: 'direct' | 'plan';
}

/**
 * Les réglages à poser sur une carte proposée : le MOTEUR de la conversation,
 * et un modèle qui existe VRAIMENT chez lui.
 *
 * Le modèle, lui, ne se recopie plus de la conversation quand le chef annonce un
 * NIVEAU : le chef trie sur un modèle économe, et recopier son modèle ferait
 * exécuter toutes les cartes au rabais. Sans niveau annoncé — un agent d'un
 * autre rôle qui propose —, l'ancien héritage s'applique tel quel.
 */
async function reglagesProposes(
  souhait: SouhaitReglages | undefined,
  niveau?: NiveauAgent,
): Promise<{ run?: RunConfig; avertissement?: string }> {
  try {
    // Avec un palier, on ne recopie PAS le modèle de la conversation : c'est le
    // palier qui le choisit. Un modèle passé ici (héritage du chef économe)
    // bloquerait cette traduction, puis un second passage à la validation
    // réécrirait un choix fait à l'écran.
    const retenu = reglagesDeLaProposition(
      niveau ? { engine: souhait?.engine, niveau } : souhait,
      await catalogueMoteurs(),
    );
    if (!retenu) return {};
    return {
      run: RunConfig.parse({
        engine: retenu.engine,
        model: retenu.model,
        thinking: retenu.thinking,
        niveau: retenu.niveau,
      }),
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
  const niveau = reglages.run.niveau ? ` Niveau « ${reglages.run.niveau} », traduit par HaikoDev en` : ' Réglages repris de cette conversation :';
  return (
    `${niveau} ${reglages.run.engine}${modele} (réflexion : ${reglages.run.thinking}).` +
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
  attachment?: Attachment;
}

/**
 * LA COLONNE DE GAUCHE, ÉCRITE POUR UN AGENT qui ne voit pas l'écran. Rendue
 * après chaque geste : c'est ainsi qu'il constate ce qu'il vient de changer, au
 * lieu de l'affirmer.
 */
function colonneDeGauche(): string {
  return resumeColonneDeGauche(store.listProjects(true) as ProjetDeLaColonne[], store.listGroups());
}

/**
 * RANGER À UNE POSITION, comme la souris le ferait.
 *
 * Deux familles de voisins, exactement celles de la colonne : les projets d'un
 * MÊME groupe entre eux ; et, à la racine, les groupes ET les projets hors
 * groupe mêlés — un projet peut passer au-dessus d'un groupe, et l'inverse
 * (`sidebar.reorder`). On renumérote tout le voisinage, jamais la seule ligne
 * déplacée : deux rangs égaux laisseraient l'ordre au hasard.
 */
function rangerLaColonne(
  id: string,
  groupeId: string | undefined,
  position: number,
  estUnGroupe = false,
): ReturnType<typeof store.listProjects> {
  const projets = store.listProjects();
  const groupes = store.listGroups();
  const parRang = (a: { rank?: number }, b: { rank?: number }) => (a.rank ?? 1000) - (b.rank ?? 1000);

  if (!estUnGroupe && groupeId) {
    const freres = projets.filter((p) => p.groupId === groupeId).sort(parRang);
    const ordre = rangsApresDeplacement(freres, id, position);
    return ordre.map((ligne) => {
      const projet = projets.find((p) => p.id === ligne.id)!;
      return store.saveProject({ ...projet, rank: ligne.rank });
    });
  }

  const racine = [
    ...groupes.map((g) => ({ id: g.id, rank: g.rank, groupe: true })),
    ...projets.filter((p) => !p.groupId).map((p) => ({ id: p.id, rank: p.rank, groupe: false })),
  ].sort(parRang);
  const ordre = rangsApresDeplacement(racine, id, position);
  const bouges: ReturnType<typeof store.listProjects> = [];
  for (const ligne of ordre) {
    const groupe = groupes.find((g) => g.id === ligne.id);
    if (groupe) {
      store.saveGroup({ ...groupe, rank: ligne.rank });
      continue;
    }
    const projet = projets.find((p) => p.id === ligne.id);
    if (projet) bouges.push(store.saveProject({ ...projet, rank: ligne.rank }));
  }
  return bouges;
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
      if (ctx.mode === 'plan') return { ok: false, text: REFUS_MODE_PLAN };
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
      const texte = descriptionDeProposition(args, exigenceDuRole(ctx.role));
      if ('refus' in texte) return { ok: false, text: texte.refus };
      /*
       * …et rien ne part non plus sans la SYNTHÈSE du besoin : c'est elle qui
       * sera déposée en premier message du fil de l'agent. Une carte sans elle
       * renverrait l'agent au seul titre, comme avant.
       */
      const synthese = syntheseDeProposition(args);
      if ('refus' in synthese) return { ok: false, text: synthese.refus };

      const reglages = await reglagesProposes(ctx.run, niveauDemande(args.niveau));
      const analyse = analyseDeProposition(args);
      const depart = departDeProposition(args);
      const proposal: TaskProposal = {
        id: store.newId(),
        title: String(args.title),
        description: texte.description,
        briefing: synthese.briefing,
        labels: Array.isArray(args.labels) ? args.labels.map(String) : [],
        // Les images jointes au message qui a fait naître la proposition
        // suivent la carte jusqu'à l'agent d'exécution.
        attachments: imagesDuMessageDeclencheur(ctx.agentId),
        sourceProposalIds: [],
        ...analyse,
        ...depart,
        ...(reglages.run ? { run: reglages.run } : {}),
        ...(reglages.avertissement ? { avertissement: reglages.avertissement } : {}),
        decision: 'pending',
      };
      return {
        ok: true,
        text:
          `Carte « ${proposal.title} » proposée dans la conversation. ` +
          `Elle n'entrera dans « Planifié » qu'après la validation de l'utilisateur.` +
          resumeReglages(reglages) +
          resumeDepart(depart),
        proposal,
      };
    }

    case 'board_update_card': {
      const card = store.getCard(String(args.cardId));
      if (!card || card.projectId !== ctx.projectId) return { ok: false, text: 'Carte introuvable.' };
      const title = typeof args.title === 'string' ? args.title : card.title;
      const description = typeof args.description === 'string' ? args.description : card.description;
      /*
       * LE NIVEAU N'EST PAS UN RÉGLAGE DE PLUS : c'est une AMBITION, traduite
       * ici en moteur, modèle et réflexion réels. Le moteur reste celui de la
       * conversation ; un palier illisible laisse la carte comme elle était,
       * plutôt que de la rabattre sur un modèle au hasard.
       */
      const palier = niveauDemande(args.niveau);
      const reglages = palier ? await reglagesProposes(ctx.run, palier) : {};
      /*
       * LE PALIER EST RETENU MÊME QUAND LE CATALOGUE EST MUET. La traduction en
       * modèle réel demande le catalogue du moteur ; s'il est illisible, garder
       * l'INTENTION reste juste — le lancement la traduira. La perdre ici
       * ferait exécuter au palier par défaut une carte cadrée « approfondi ».
       */
      let run = card.run;
      if (palier) {
        const base = reglages.run ?? card.run;
        run = base
          ? { ...base, niveau: palier }
          : RunConfig.parse({ engine: ctx.run?.engine ?? 'claude', niveau: palier });
      }
      const updated = store.saveCard({
        ...card,
        title,
        description,
        labels: Array.isArray(args.labels) ? args.labels.map(String) : card.labels,
        run,
        ...heritageAnalyseDeProposition(card, title, description),
      });
      bus.emit({ type: 'card.upsert', card: updated });
      return {
        ok: true,
        text: `Carte mise à jour : ${updated.title}.${palier ? ` Niveau d'exécution : ${palier}.` : ''}`,
      };
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
      if (ctx.mode === 'plan') return { ok: false, text: REFUS_MODE_PLAN };
      if (!args.title) return { ok: false, text: 'Un titre est obligatoire.' };
      // Même exigence que board_create_card : une proposition sans description
      // solide n'est pas affichée, elle est rendue à réécrire.
      const texte = descriptionDeProposition(args, exigenceDuRole(ctx.role));
      if ('refus' in texte) return { ok: false, text: texte.refus };
      // Même exigence de SYNTHÈSE que board_create_card : le fil de l'agent
      // s'ouvre sur ce texte, quel que soit l'outil qui a proposé la carte.
      const synthese = syntheseDeProposition(args);
      if ('refus' in synthese) return { ok: false, text: synthese.refus };

      const reglages = await reglagesProposes(ctx.run, niveauDemande(args.niveau));
      const analyse = analyseDeProposition(args);
      const depart = departDeProposition(args);
      const proposal: TaskProposal = {
        id: store.newId(),
        title: String(args.title),
        description: texte.description,
        briefing: synthese.briefing,
        labels: Array.isArray(args.labels) ? args.labels.map(String) : [],
        // Mêmes images que board_create_card : celles du message déclencheur.
        attachments: imagesDuMessageDeclencheur(ctx.agentId),
        sourceProposalIds: [],
        ...analyse,
        ...depart,
        ...(reglages.run ? { run: reglages.run } : {}),
        ...(reglages.avertissement ? { avertissement: reglages.avertissement } : {}),
        decision: 'pending',
      };
      return {
        ok: true,
        text:
          `Proposition affichée à l'utilisateur : « ${proposal.title} ». Rien n'est créé tant qu'il n'a pas validé.` +
          resumeReglages(reglages) +
          resumeDepart(depart),
        proposal,
      };
    }

    case 'write_document': {
      /*
       * LE CHEF ÉCRIT LES DOCUMENTS, PARTOUT, ET JAMAIS LE CODE. Sa frontière
       * ne tient plus à un DOSSIER mais à la NATURE du fichier
       * (`shared/src/documents-de-cadrage.ts`) : tout ce qui est du texte —
       * documentation, mémoire, compte rendu, fichier d'instructions — se crée,
       * se remplace et s'efface librement ; le code est refusé par la liste des
       * extensions, pas par la bonne volonté du modèle. Un nom NU reste rangé
       * dans le dossier des plans, sauf s'il désigne un fichier existant de la
       * racine (« CLAUDE.md »). Le bac à sable, lui, ne bouge pas : c'est le
       * DÉMON qui écrit ici, pas le moteur.
       */
      const demande = String(args.relativePath ?? '');
      const supprimer = String(args.action ?? 'ecrire') === 'supprimer';
      let rel = demande;
      if (ctx.role === 'cadrage') {
        const choix = cheminDuDocument(demande, (relatif) => {
          const cible = safeJoin(project.path, relatif);
          return !!cible && fs.existsSync(cible);
        });
        if (!choix.ok) return { ok: false, text: choix.raison };
        rel = choix.chemin;
      } else if (!EXTENSIONS_DOCUMENT.some((fin) => rel.toLowerCase().endsWith(fin))) {
        return { ok: false, text: `Seuls les documents ${EXTENSIONS_DOCUMENT.join(' ou ')} sont autorisés par cet outil.` };
      }
      const full = safeJoin(project.path, rel);
      if (!full) return { ok: false, text: 'Chemin refusé : on ne sort jamais du dossier du projet.' };
      const existait = fs.existsSync(full);

      // SUPPRIMER est un geste à part : effacer un document qui n'existe pas se
      // dit, plutôt que de rendre un succès qui n'a rien fait.
      if (supprimer) {
        if (!existait) return { ok: false, text: `Aucun document à supprimer : « ${rel} » n'existe pas.` };
        if (fs.statSync(full).isDirectory()) {
          return { ok: false, text: `Refusé : « ${rel} » est un dossier, pas un document.` };
        }
        fs.rmSync(full);
        return { ok: true, text: `Document supprimé : ${rel}.` };
      }

      if (typeof args.content !== 'string') {
        return { ok: false, text: 'Le contenu du document est obligatoire (il remplace le fichier en entier).' };
      }
      if (existait && fs.statSync(full).isDirectory()) {
        return { ok: false, text: `Refusé : « ${rel} » est un dossier, pas un document.` };
      }
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, args.content, 'utf8');
      // L'agent doit savoir s'il a CRÉÉ ou REMPLACÉ : un plan qu'on croit
      // ajuster et qu'on écrase sous un autre nom se perd en silence.
      const geste = existait ? 'Document mis à jour' : 'Document créé';
      const rappel =
        ctx.role === 'cadrage'
          ? ` Pour le modifier, relis-le et réécris « ${rel} » en entier.` +
            (rel.startsWith(`${DOSSIER_PLANS}/`)
              ? " Il sera relu par la recherche au lancement d'une carte sur le même sujet."
              : '')
          : '';
      return { ok: true, text: `${geste} : ${rel}.${rappel}` };
    }

    case 'project_manage': {
      const lu = lireGesteProjet(args);
      if (!lu.ok) return { ok: false, text: lu.raison };
      const demande = lu.demande;

      if (demande.geste === 'lister') return { ok: true, text: colonneDeGauche() };

      if (demande.geste === 'creer') {
        try {
          const monte = await createProjectFolder({
            name: demande.nom,
            folder: demande.dossier,
            description: demande.description,
            git: true,
            github: demande.github,
            sousDomaine: demande.sousDomaine,
            port: demande.port,
          });
          bus.emit({ type: 'project.upsert', project: monte.project });
          const rates = monte.etapes.filter((e) => !e.fait);
          // Une étape ratée se dit : le projet existe quand même, mais il lui
          // manque quelque chose, et le taire ferait croire que tout est en place.
          bus.toast(
            rates.length ? 'warning' : 'success',
            rates.length
              ? `Projet « ${monte.project.name} » créé, ${rates.length} étape(s) en échec`
              : `Projet « ${monte.project.name} » monté sur le serveur`,
          );
          const deroule = monte.etapes
            .map((e) => `${e.fait ? '✓' : '✗'} ${e.titre}${e.detail ? ` — ${e.detail}` : ''}`)
            .join('\n');
          return {
            ok: true,
            text: `Projet « ${monte.project.name} » monté (${monte.project.path}), inscrit dans la colonne de gauche.\n${deroule}`,
          };
        } catch (err: any) {
          return { ok: false, text: `Montage impossible : ${err?.message ?? err}` };
        }
      }

      const trouve = retrouverParNom(demande.cible, store.listProjects(true), 'projet');
      if (!trouve.ok) return { ok: false, text: trouve.raison };
      const vise = trouve.demande;

      if (demande.geste === 'renommer') {
        const ancien = vise.name;
        const change = store.saveProject({ ...vise, name: demande.nom });
        bus.emit({ type: 'project.upsert', project: change });
        bus.toast('info', `« ${ancien} » renommé en « ${change.name} »`);
        return { ok: true, text: `Projet renommé : « ${ancien} » devient « ${change.name} ».` };
      }

      if (demande.geste === 'deplacer') {
        let groupeId = vise.groupId;
        let ou = '';
        if (demande.horsGroupe) {
          groupeId = undefined;
          ou = 'sorti de son groupe';
        } else if (demande.groupe) {
          const groupe = retrouverParNom(demande.groupe, store.listGroups(), 'groupe');
          if (!groupe.ok) return { ok: false, text: groupe.raison };
          groupeId = groupe.demande.id;
          ou = `rangé dans « ${groupe.demande.name} »`;
        }
        const change = store.saveProject({ ...vise, groupId: groupeId });
        const range = demande.position === undefined ? [] : rangerLaColonne(change.id, groupeId, demande.position);
        for (const projet of [change, ...range]) bus.emit({ type: 'project.upsert', project: projet });
        bus.emit({ type: 'groups', groups: store.listGroups() });
        const place = demande.position === undefined ? '' : `${ou ? ', ' : ''}placé en position ${demande.position}`;
        bus.toast('info', `« ${change.name} » ${ou || 'déplacé'}`);
        return { ok: true, text: `Projet « ${change.name} » ${ou}${place}.\n\n${colonneDeGauche()}` };
      }

      if (demande.geste === 'retirer') {
        if (vise.archived) return { ok: true, text: `« ${vise.name} » est déjà mis de côté.` };
        // Rien ne disparaît de la vue sans avoir été dit : les cartes encore
        // vivantes du projet sont NOMMÉES avant qu'il quitte la colonne.
        const vivantes = store.listCards(vise.id).filter((c) => c.column !== 'archived');
        const change = store.saveProject({ ...vise, archived: true });
        bus.emit({ type: 'project.upsert', project: change });
        bus.toast('info', `« ${change.name} » mis de côté`);
        const dites = vivantes.length
          ? `Ses ${vivantes.length} carte(s) hors archive partent de la vue avec lui : ` +
            `${vivantes.slice(0, 12).map((c) => `« ${c.title} » (${COLUMN_LABELS[c.column]})`).join(', ')}` +
            `${vivantes.length > 12 ? '…' : ''}. Rien n'est perdu.`
          : "Il n'avait aucune carte hors archive.";
        return {
          ok: true,
          text: `Projet « ${change.name} » mis de côté : il quitte la colonne de gauche, rien n'est supprimé. ${dites} « Remettre en service » le fait revenir.`,
        };
      }

      if (vise.archived === false) return { ok: true, text: `« ${vise.name} » est déjà en service.` };
      const rendu = store.saveProject({ ...vise, archived: false });
      bus.emit({ type: 'project.upsert', project: rendu });
      bus.toast('info', `« ${rendu.name} » remis en service`);
      return { ok: true, text: `Projet « ${rendu.name} » remis en service : il revient dans la colonne de gauche.` };
    }

    case 'group_manage': {
      const lu = lireGesteGroupe(args);
      if (!lu.ok) return { ok: false, text: lu.raison };
      const demande = lu.demande;

      if (demande.geste === 'lister') return { ok: true, text: colonneDeGauche() };

      if (demande.geste === 'creer') {
        const groupe = store.saveGroup({
          id: store.newId(),
          name: demande.nom,
          rank: store.nextGroupRank(),
          collapsed: false,
          color: demande.couleur,
        });
        bus.emit({ type: 'groups', groups: store.listGroups() });
        bus.toast('info', `Groupe « ${groupe.name} » créé`);
        return {
          ok: true,
          text: `Groupe « ${groupe.name} » créé dans la colonne de gauche. Pour y ranger un projet : « project_manage » action « deplacer ».`,
        };
      }

      const trouve = retrouverParNom(demande.cible, store.listGroups(), 'groupe');
      if (!trouve.ok) return { ok: false, text: trouve.raison };
      const vise = trouve.demande;

      if (demande.geste === 'renommer') {
        const ancien = vise.name;
        const change = store.saveGroup({ ...vise, name: demande.nom });
        bus.emit({ type: 'groups', groups: store.listGroups() });
        bus.toast('info', `Groupe « ${ancien} » renommé en « ${change.name} »`);
        return { ok: true, text: `Groupe renommé : « ${ancien} » devient « ${change.name} ».` };
      }

      const dits: string[] = [];
      const change = store.saveGroup({
        ...vise,
        color: demande.retirerCouleur ? undefined : (demande.couleur ?? vise.color),
        collapsed: demande.replie ?? vise.collapsed,
      });
      if (demande.retirerCouleur) dits.push('pastille retirée');
      else if (demande.couleur) dits.push(`couleur ${demande.couleur}`);
      if (demande.replie !== undefined) dits.push(demande.replie ? 'replié' : 'déplié');
      const bouges = demande.position === undefined ? [] : rangerLaColonne(change.id, undefined, demande.position, true);
      if (demande.position !== undefined) dits.push(`position ${demande.position}`);
      for (const projet of bouges) bus.emit({ type: 'project.upsert', project: projet });
      bus.emit({ type: 'groups', groups: store.listGroups() });
      bus.toast('info', `Groupe « ${change.name} » réglé`);
      return { ok: true, text: `Groupe « ${change.name} » réglé : ${dits.join(', ')}.\n\n${colonneDeGauche()}` };
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

    case 'attach_screenshot': {
      const demande = String(args.path ?? '').trim();
      if (!demande) return { ok: false, text: 'Aucun chemin donné.' };
      const agent = store.getAgent(ctx.agentId);
      /*
       * TROIS RACINES ACCEPTÉES : le dossier de travail de CETTE carte (où vit
       * une capture prise par ses propres scripts), le dépôt du projet, et le
       * dossier de données partagé de HaikoDev (où les scripts de vérification
       * « de tous les jours » écrivent, hors de toute copie de carte).
       */
      const racines = [agent?.workdir, project.path, CONFIG.dataDir].filter(Boolean) as string[];
      let full: string | null = null;
      for (const racine of racines) {
        const essai = path.isAbsolute(demande)
          ? path.resolve(demande) === path.resolve(racine) || path.resolve(demande).startsWith(path.resolve(racine) + path.sep)
            ? demande
            : null
          : safeJoin(racine, demande);
        if (essai && fs.existsSync(essai) && fs.statSync(essai).isFile()) {
          full = essai;
          break;
        }
      }
      if (!full) return { ok: false, text: `Fichier introuvable : ${demande}` };
      const MIME_PAR_EXTENSION: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
      };
      const mime = MIME_PAR_EXTENSION[path.extname(full).toLowerCase()];
      if (!mime) return { ok: false, text: `Ce n'est pas une image reconnue (png, jpg, webp, gif) : ${demande}` };
      const data = fs.readFileSync(full);
      const sha = crypto.createHash('sha256').update(data).digest('hex');
      const existant = store.findAttachmentBySha(project.id, sha);
      let attachment: Attachment;
      if (existant) {
        attachment = existant;
      } else {
        const conversation = ctx.cardId ?? ctx.agentId;
        const dejaUtilises = store
          .listAttachments(project.id)
          .filter((a) => (a.cardId ?? a.agentId) === conversation)
          .map((a) => a.name);
        const nomVoulu = typeof args.label === 'string' && args.label.trim() ? args.label.trim() : path.basename(full);
        attachment = Attachment.parse({
          id: store.newId(),
          projectId: project.id,
          name: nomSansCollision(nomVoulu, dejaUtilises),
          mime,
          size: data.length,
          sha,
          cardId: ctx.cardId,
          agentId: ctx.agentId,
          createdAt: Date.now(),
        });
        fs.mkdirSync(PATHS.attachments, { recursive: true });
        fs.writeFileSync(path.join(PATHS.attachments, `${attachment.id}-${attachment.name}`), data);
        store.saveAttachment(attachment);
        bus.emit({ type: 'attachments', projectId: project.id, items: store.listAttachments(project.id) });
      }
      return {
        ok: true,
        text: `Capture jointe à la conversation : ${attachment.name} (${Math.round(data.length / 1024)} ko).`,
        attachment,
      };
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
      /*
       * L'APPEL D'OUTIL NE REND PAS LA MAIN ICI. Le texte ci-dessous n'est
       * qu'un repli : il ne part au moteur que si l'attente n'a pas pu être
       * posée. Le chemin normal passe par `/internal/call`, qui garde la
       * réponse HTTP ouverte tant que l'utilisateur n'a pas répondu — c'est
       * cela qui ARRÊTE le moteur au lieu de le laisser enchaîner les étapes
       * suivantes de sa liste (`shared/src/attente-question.ts`).
       */
      return {
        ok: true,
        text: texteSansAttente(),
        question,
      };
    }

    case 'project_memory': {
      // Le détail à la demande : l'index seul part au lancement ; le texte
      // entier des faits, des règles et des contrôles d'un sujet se demande
      // quand ce sujet concerne vraiment la tâche — et UNE SEULE FOIS par
      // session : un sujet déjà servi n'est pas repayé.
      /*
       * ...ET IL MONTE D'UN CRAN QUAND LE PROJET N'A RIEN À DIRE. La mémoire est
       * EN ARBRE : un sujet sans règle locale est servi depuis la SOURCE du
       * projet, dite en toutes lettres (`morceauxHerites`, server/src/memory.ts).
       * Cette source est HaikoDev par défaut, mais elle se règle projet par
       * projet — d'où `sourceDHeritageDuProjet`, seule à connaître la liste des
       * projets.
       */
      /*
       * ...ET UN SUJET NOMMÉ EST SERVI AU POIDS DE LA DEMANDE DE LA CARTE. La
       * MÉTHODE imposée envoie l'agent ouvrir « le SUJET de sa tâche » à son
       * premier tour : il NOMME donc un sujet, et un sujet nommé valait le
       * fichier ENTIER — 36 000 signes de `cartes.md` pour une carte qui ne
       * touche qu'un bouton. Le travail réel de la carte (son titre et son
       * constat, ce que l'agent a lui-même reçu) descend jusqu'à la mémoire pour
       * RANGER un gros sujet dans cet ordre-là. Sans carte — une conversation,
       * le chef d'orchestre —, rien ne change : le sujet part entier.
       */
      const carte = ctx.cardId ? store.getCard(ctx.cardId) : null;
      const demande = String(args.sujet ?? '');
      /*
       * LE CHRONOMÈTRE DE L'OUVERTURE. Une descente dans l'arbre lit des
       * fichiers, filtre, recolle : on ne savait pas si cela coûtait trois
       * millisecondes ou trois cents, donc on ne pouvait pas dire si les
       * cinquante minutes d'une tâche venaient de là. Il ne mesure QUE l'appel,
       * jamais l'écriture qui suit.
       */
      const debutMemoire = Date.now();
      const servi = detailProjet(
        project.path,
        demande,
        store.sujetsMemoireServis(ctx.agentId),
        sourceDHeritageDuProjet(project),
        carte ? `${carte.title}\n${carte.description}` : '',
      );
      const dureeMemoire = Date.now() - debutMemoire;
      store.marquerSujetsMemoireServis(ctx.agentId, servi.servis);
      /*
       * LA TÉLÉMÉTRIE DE L'OUVERTURE, à côté de l'économie et sans la remplacer.
       * TOUTES les ouvertures sont écrites ici, y compris celles où le tri n'a
       * rien évité : le rendement du tri se juge sur l'ensemble, pas sur les
       * seules ouvertures rentables. Ce qui est rangé n'est que du CHIFFRE et un
       * NOM de sujet ramené à un mot — jamais la demande, jamais le texte rendu.
       */
      store.recordMemoryConsultation({
        projectId: project.id,
        cardId: ctx.cardId,
        agentId: ctx.agentId,
        sujet: nomDeSujetMesure(demande),
        dureeMs: dureeMemoire,
        blocsDemandes: servi.compte.demandes,
        blocsRendus: servi.compte.rendus,
        signesEntiers: servi.economie.entiers,
        signesServis: servi.economie.servis,
      });
      /*
       * CE QUE LE TRI VIENT D'ÉVITER D'ENVOYER, RELEVÉ ICI ET NULLE PART
       * AILLEURS. La mémoire ne connaît ni base ni carte : elle rend les deux
       * poids, c'est l'outil — qui sait de quelle carte il travaille — qui les
       * enregistre. Le tableau de bord additionne ensuite ces lignes sur un
       * mois glissant, carte par carte.
       */
      store.recordMemoryEconomy({
        projectId: project.id,
        cardId: ctx.cardId,
        agentId: ctx.agentId,
        entiers: servi.economie.entiers,
        servis: servi.economie.servis,
      });
      return { ok: true, text: servi.texte };
    }

    case 'competences': {
      /*
       * LE SEUL CHEMIN D'ÉCRITURE DU POOL. Il passe par `ecrireLaFiche`, donc
       * par le contrôle de qualité : la nuit, le forçage et un agent de tâche
       * qui veut capitaliser franchissent tous la même porte, et un refus
       * revient toujours avec sa raison.
       */
      const action = String(args.action ?? '').trim();
      const liste = () => {
        const { fiches, refus } = lirePool();
        const lignes = fiches.map((fiche) => {
          const compteurs = compteursDeLaFiche(fiche.nom);
          const confiance = confianceDeLaFiche(compteurs);
          const anomalies = fiche.anomalies.length ? ` — à revoir : ${fiche.anomalies.join(' ; ')}` : '';
          return (
            `- ${fiche.nom} [${fiche.etat}, confiance ${confiance.toFixed(2)}, servie ${compteurs.servie}×] : ` +
            `${fiche.description}${anomalies}`
          );
        });
        const ecartes = refus.map((r) => `- écarté : ${raisonDuRefus(r)}`);
        return [`POOL DE COMPÉTENCES (${fiches.length}) :`, ...lignes, ...ecartes].join('\n');
      };

      if (action === 'lister' || !action) return { ok: true, text: liste() };

      const nom = String(args.nom ?? '').trim();
      if (!nom) return { ok: false, text: 'Le nom de la fiche est requis.' };

      if (action === 'retour') {
        const utile = args.utile !== false;
        compter(nom, utile ? 'aidee' : 'inutile');
        return {
          ok: true,
          text: utile
            ? `Merci : « ${nom} » gagne en confiance.`
            : `Noté : « ${nom} » n'a rien apporté ici, sa confiance baisse.`,
        };
      }

      if (action !== 'ecrire') return { ok: false, text: `Action inconnue : « ${action} ».` };

      const texteOuVide = (cle: string) => {
        const valeur = args[cle];
        return typeof valeur === 'string' && valeur.trim() ? valeur.trim() : undefined;
      };
      const listeOuVide = (cle: string) => decouperListe(texteOuVide(cle));
      const ecriture = ecrireLaFiche(
        {
          nom,
          description: String(args.description ?? '').trim(),
          themes: listeOuVide('themes'),
          symptomes: listeOuVide('symptomes'),
          projets: listeOuVide('projets'),
          symptome: texteOuVide('symptome'),
          cause: texteOuVide('cause'),
          procedure: texteOuVide('procedure'),
          verification: texteOuVide('verification'),
          pieges: texteOuVide('pieges'),
          echecs: texteOuVide('echecs'),
          provenance: {
            projet: project.name,
            carte: texteOuVide('carte') ?? ctx.cardId,
          },
        },
        { carte: { id: texteOuVide('carte') ?? ctx.cardId ?? '', projet: project.name } },
      );
      if (!ecriture.ok) {
        return { ok: false, text: `Fiche refusée :\n- ${(ecriture.raisons ?? []).join('\n- ')}` };
      }
      // Le pool change : les coffres des comptes Claude suivent tout de suite,
      // sinon la fiche n'existerait pour le moteur qu'au prochain démarrage.
      relierCompetencesAuxCoffres();
      bus.emit({ type: 'competences', pool: etatDuPoolPourLEcran() });
      return {
        ok: true,
        text:
          ecriture.geste === 'creee'
            ? `Compétence « ${nom} » créée dans le pool partagé.`
            : `Compétence « ${nom} » complétée : sa provenance d'origine est gardée.`,
      };
    }

    case 'remember': {
      const line = String(args.line ?? '').trim();
      if (!line) return { ok: false, text: 'Ligne vide.' };
      appendMemory(project.path, line, typeof args.replaces === 'string' ? args.replaces : undefined);
      bus.emit({ type: 'memory', projectId: project.id, content: readMemory(project.path) });
      // Au-delà du seuil, un petit modèle relit et resserre — à côté, sans
      // bloquer la tâche en cours.
      synthetiserSiNecessaire(project.path);
      return { ok: true, text: 'Mémoire du projet mise à jour.' };
    }

    case 'snapshot_site': {
      /*
       * LE GESTE FINAL DE L'ASSISTANT DE CONFIGURATION. La fiche proposée par un
       * modèle n'a AUCUN droit de plus qu'une fiche saisie au formulaire : elle
       * passe par la même lecture (`ficheProposee`, qui traduit « MariaDB » en
       * `mysql`) puis par le même jugement (`jugerSite`), et un refus REND LA
       * RAISON — l'agent corrige et rappelle l'outil au lieu d'abandonner.
       */
      const ancienne = typeof args.id === 'string' && args.id.trim() ? lireSite(args.id.trim()) : null;
      if (typeof args.id === 'string' && args.id.trim() && !ancienne) {
        return { ok: false, text: `Aucun site à sauvegarder ne porte l'identifiant « ${args.id} ».` };
      }
      const fiche = ficheProposee(args, ancienne);
      const jugement = jugerSite(fiche);
      if (!jugement.ok) return { ok: false, text: `Fiche refusée : ${jugement.raison}. Corrige et rappelle l'outil.` };

      /*
       * UNE FICHE COMPLÈTE N'EST PAS UNE FICHE JUSTE. Les accès sont essayés
       * POUR DE VRAI avant d'enregistrer : sans cela, un mot de passe refusé ou
       * un dossier déplacé ne se découvrait qu'à la première nuit, dans un
       * échec que personne ne regardait. « forcer » reste la porte de sortie,
       * pour une machine éteinte ou un site pas encore en ligne — et l'agent a
       * consigne de ne l'emprunter qu'avec l'accord de l'utilisateur.
       */
      const essais = await essayerLesAcces(fiche);
      if (!essaisConcluants(essais) && args.forcer !== true) {
        return {
          ok: false,
          text:
            `Fiche NON enregistrée : un accès ne répond pas.\n${phraseDesEssais(essais)}\n` +
            'Corrige cet accès puis rappelle « snapshot_essai », ou demande à l’utilisateur (« ask_user ») ' +
            's’il accepte qu’on enregistre quand même — dans ce cas seulement, rappelle « snapshot_site » avec « forcer ».',
        };
      }

      // La CONVERSATION qui a posé la fiche est retenue : la fenêtre des
      // snapshots la rouvre d'un clic, avec ses questions et son compte rendu.
      const resultat = enregistrerSite({ ...fiche, assistantId: ctx.agentId, assistantProjectId: ctx.projectId });
      if (!resultat.ok) return { ok: false, text: `Fiche refusée : ${resultat.raison}.` };

      const site = resultat.site;
      const morceaux = [
        site.base.moteur !== 'aucune' ? `base ${LIBELLE_MOTEUR_BASE[site.base.moteur]} « ${site.base.nom} »` : null,
        site.fichiers.moyen !== 'aucun'
          ? `fichiers ${LIBELLE_MOYEN_FICHIERS[site.fichiers.moyen]} « ${site.fichiers.chemin} »`
          : null,
      ].filter(Boolean);
      return {
        ok: true,
        text:
          `${ancienne ? 'Fiche corrigée' : 'Site enregistré'} : « ${site.nom} » (identifiant ${site.id}). ` +
          `Sauvegarde ${morceaux.join(' et ')} ${phraseDeCadence(site.frequenceMinutes)}, gardés ${site.conservationJours} jours. ` +
          `Essai des accès :\n${phraseDesEssais(essais)}\n` +
          'Le passage de nuit le prendra tout seul.',
      };
    }

    case 'snapshot_essai': {
      /*
       * LE COUP DE SONDE. Il ouvre la base et liste le dossier, puis jette tout :
       * aucune sauvegarde n'est prise, aucune fiche n'est enregistrée. Sur un
       * site déjà là, les champs non redits sont ceux de la base — c'est ainsi
       * qu'on essaie une fiche en échec sans redemander son mot de passe.
       */
      const enregistree = typeof args.id === 'string' && args.id.trim() ? lireSite(args.id.trim()) : null;
      if (typeof args.id === 'string' && args.id.trim() && !enregistree) {
        return { ok: false, text: `Aucun site à sauvegarder ne porte l'identifiant « ${args.id} ».` };
      }
      const aEssayer = ficheProposee(args, enregistree);
      if (siteVide(aEssayer)) {
        return { ok: false, text: 'Rien à essayer : cette fiche ne prend ni base ni fichiers.' };
      }
      const issues = await essayerLesAcces(aEssayer);
      return {
        ok: true,
        text: essaisConcluants(issues)
          ? `Tout répond.\n${phraseDesEssais(issues)}`
          : `Un accès au moins ne répond pas.\n${phraseDesEssais(issues)}`,
      };
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
    /**
     * La synthèse entière du besoin. Elle ouvrira la conversation de la carte,
     * et l'agent la recevra dans son prompt de lancement.
     */
    briefing?: string;
    /** Heure de départ souhaitée : la carte partira toute seule ce moment venu. */
    departPrevu?: number;
    /**
     * L'agent qui a proposé cette carte, et le moment de sa proposition. C'est
     * ce lien — et lui seul — qui permet au parcours de la tâche de porter la
     * mesure RÉELLE du tri : le tour du chef vit dans sa conversation, sans
     * `cardId`, donc rien ne le rattachait à la carte qu'il a produite.
     */
    origineAgentId?: string;
    origineAt?: number;
  },
): Card {
  const project = store.getProject(projectId);
  const moteur = input.run?.engine ?? project?.defaultEngine ?? 'claude';
  /*
   * LE CRÉNEAU CONSEILLÉ SE CALCULE ICI, une fois, et sans appeler le moindre
   * moteur : heures creuses réglées, creux mesuré sur les relevés, état des
   * comptes. Une carte proposée par le chef le porte donc dès sa naissance,
   * sans un jeton de plus (`shared/src/heure-de-lancement.ts`).
   *
   * Une carte qui naît DÉJÀ datée n'en reçoit pas : elle a une réponse ferme,
   * un conseil ne ferait que la contredire.
   */
  const creneauConseille = input.departPrevu
    ? undefined
    : creneauPourUneCarte({ moteur, ampleurSecondes: input.estimate?.machineSeconds });
  /*
   * LE CONSEIL DEVIENT LE DÉPART : une carte qui propose un créneau précis le
   * recopie aussitôt dans `departPrevu`, exactement comme une date posée à la
   * main — elle part donc TOUTE SEULE à l'heure dite, sans attendre un clic
   * de plus. `creneauAutomatique` garde la trace de cette origine, pour que
   * l'écran l'explique ; le premier geste de l'utilisateur sur cette date
   * (la changer, la retirer) efface le drapeau, jamais la date elle-même.
   */
  const maintenant = store.now();
  const departPrevu = input.departPrevu ?? (creneauConseille ? momentDuCreneau(creneauConseille, maintenant) : undefined);
  const card = Card.parse({
    id: store.newId(),
    projectId,
    title: input.title.slice(0, 200),
    description: input.description ?? '',
    labels: input.labels ?? [],
    attachments: input.attachments ?? [],
    estimate: input.estimate,
    analysisContext: input.analysisContext,
    briefing: input.briefing,
    origineAgentId: input.origineAgentId,
    origineAt: input.origineAt,
    // Le champ « colonne » est ignoré à la création : invariant 1. Une carte
    // naît dans « Planifié » — il n'y a plus de colonne d'attente avant elle.
    // Naître là ne fait rien démarrer : le lancement reste un geste humain.
    column: 'planned' as ColumnKey,
    position: store.nextPosition(projectId, 'planned'),
    origin: input.origin ?? 'user',
    run: {
      engine: moteur,
      model: input.run?.model ?? project?.defaultModel,
      thinking: input.run?.thinking ?? 'none',
      mode: input.run?.mode ?? 'direct',
    },
    scheduling: {
      asap: false,
      attempts: 0,
      restarts: 0,
      departPrevu,
      ...(creneauConseille ? { creneauConseille, creneauAutomatique: true } : {}),
      /*
       * Une carte qui naît DÉJÀ chiffrée (l'analyse du chef d'orchestre voyage
       * avec sa proposition) attend son lancement, et le DIT — exactement comme
       * une carte qui sort de son analyse. Sans chiffrage, rien à annoncer : la
       * carte vient d'être posée. Une carte qui porte déjà une date — donnée à
       * la main ou retenue du créneau — n'attend plus un clic : c'est la date
       * qui répond, pas la phrase.
       */
      ...(input.estimate && !input.estimate.failed && !departPrevu
        ? { waitingReason: RAISON_ATTENTE_LANCEMENT }
        : {}),
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
export const CADRAGE_ALLOWED_NATIVE = [
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
  // la ceinture par-dessus le bac à sable. Voir `shared/src/bridage-cadrage.ts`.
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

export const CADRAGE_DENIED_NATIVE = [
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
  // « ListAgents » est le CARNET D'ADRESSES de « SendMessage » : il liste les
  // agents joignables, dans cette session comme sur les autres. Il ne lance
  // rien, mais il n'existe que pour parler à un travail en arrière-plan —
  // interdit comme le reste de cette famille (apparu le 18/08/2026, repéré par
  // le test de complétude).
  'ListAgents',
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

/** Les outils du démon autorisés à l'agent de cadrage, préfixés pour le CLI. */
export function cadrageAllowList(): string[] {
  return [
    ...CADRAGE_ALLOWED_NATIVE,
    ...toolsFor('cadrage').map((t) => `mcp__haikodev__${t.name}`),
  ];
}

export function cadrageDenyList(): string[] {
  return [...CADRAGE_DENIED_NATIVE, ...[...CADRAGE_BLOCKED_TOOLS].map((t) => `mcp__haikodev__${t}`)];
}

/**
 * La configuration du pont d'outils d'UN TOUR. Elle porte l'agent ET le tour :
 * le second est ce qui permet au démon de reconnaître un appel venu d'un
 * fichier périmé — celui d'un tour terminé, ou celui d'un voisin lu par erreur
 * (`shared/src/pont-outils.ts`, `shared/src/racine-cursor.ts`).
 */
export function writeMcpConfig(
  filePath: string,
  token: string,
  url: string,
  agentId: string,
  bridgePath: string,
  tourId = '',
): void {
  const config = {
    mcpServers: {
      haikodev: {
        command: process.execPath,
        args: [bridgePath],
        env: { HAIKODEV_TOKEN: token, HAIKODEV_URL: url, HAIKODEV_AGENT: agentId, HAIKODEV_TOUR: tourId },
      },
    },
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
  log.debug(`configuration d'outils écrite pour l'agent ${agentId}`);
}
