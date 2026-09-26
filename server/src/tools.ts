import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  colonneApresComprehensionDeRelance,
  AGENT_MOVABLE_COLUMNS,
  AgentQuestion,
  Attachment,
  texteSansAttente,
  COLUMN_LABELS,
  candidatsDeDoublon,
  Card,
  ColumnKey,
  Estimate,
  RunConfig,
  SouhaitReglages,
  TaskProposal,
  canMove,
  aliasDePieceJointe,
  nomSansCollision,
  nomSurDisque,
  heritageAnalyseDeProposition,
  repriseAutorisee,
  reglagesDeLaProposition,
  composerDescription,
  jugerDescription,
  jugerSynthese,
  jugerTitre,
  MAX_SIGNES_TITRE,
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
  moteurDuTriAutomatique,
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
  ETATS_DE_FICHE,
  nomDeCompetenceDeLUnite,
  texteDuBilanDImport,
  type EtatDeFiche,
  raisonDuRefus,
  type ProjetDeLaColonne,
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
  TYPES_ACCES,
  LIBELLE_TYPE_ACCES,
  echeanceArchive,
  champsDuType,
  filtrerAcces,
  analyseDeCadrageFaite,
  ecritureDeCarteAutoriseeAuCadrage,
  REFUS_AVANT_ANALYSE,
  gesteAutoriseAvantLeTitreDeCadrage,
  demandeDeNaissance,
  type AuteurDeCarte,
  appelantPeutDeplacerLaCarte,
  REFUS_DEPLACEMENT_HORS_CADRAGE,
  phraseDeDeplacementParLeCadrage,
  trouverLeProjetVise,
  REFUS_AVANT_LE_TITRE,
  titreDeCarteADonner,
  JALON_COMPREHENSION,
  ComprehensionDeCarte,
  JALON_PLAN_PROPOSE,
  descriptionDepuisLePlanRendu,
  lireComprehensionRendue,
  FORME_DE_LA_COMPREHENSION,
  FORME_DES_RESUMES_DU_FIL,
  SIGNES_MINIMUM_EN_CLAIR,
  lirePlanRendu,
  numeroDuProchainPlan,
  rendrePlan,
} from '@beluga/shared';
import { listerAcces, listerArchives, enregistrerAcces, restaurerAcces, supprimerAcces } from './coffre-fort.js';
import * as store from './store.js';
import { createProjectFolder } from './projects.js';
import { bus } from './bus.js';
import { completerDonneesDuJournal, dernierJalonDeDemande } from './journal-carte.js';
import { CONFIG, PATHS } from './config.js';
import { dossierDEcriture } from './pieces-jointes.js';
import { mintDownload } from './auth.js';
import {
  LECTURE_FICHE_MAX,
  ajouterAuChangelog,
  chercherUnitesMelees,
  entreesDuChangelog,
  ligneDeLaLecture,
  lireUnite,
  lusDansLaSession,
  markdownDeLaFiche,
  noterAuBrouillon,
  noterUneLecture,
  proposerUniteAvecSens,
  rendreUnitesTrouvees,
  texteDUneUnite,
  texteDuResultat,
  uniteARemplacer,
  unitesDeLaPortee,
} from './connaissances.js';
import {
  POIDS_CHANGELOG,
  PORTEE_GLOBALE,
  TYPES_UNITE,
  DEFINITION_TYPE,
  estIdentifiantDUnite,
  etapeDeLaMemoire,
  ficheParNom,
  fichesDeLaPortee,
  ligneDUnite,
  rendreChangelog,
  titreEtResumeDuFait,
  typeDuFait,
  type PropositionUnite,
  type TypeUnite,
} from '@beluga/shared';
import { execFileSync } from 'node:child_process';
import { makeZip, safeJoin } from './files.js';
import { enregistrerSite, essayerLaRecette, essayerLesAcces, lireSite } from './backups.js';
import { enregistrerSurveillance, jouerRecette, lireSurveillance } from './surveillance.js';
import {
  adresseDeBeluga,
  assurerEspace,
  changerEtape as changerEtapeMarketing,
  creerContenu,
  ecrireConfiguration,
  ecrireFiche,
  ecrireAction as ecrireActionMarketing,
  ecrireRapport as ecrireRapportMarketing,
  estAgentMarketing,
  lireContenu,
  listerActions as listerActionsMarketing,
  listerContenus,
  supprimerAction as supprimerActionMarketing,
  marquerSuiviPose,
  modifierContenu,
  resultatsDuProjet,
} from './marketing.js';
import {
  LABEL_MARKETING,
  extraitDeSuivi,
  modeDEmploiDuSuivi,
  phraseDeConfidentialite,
  type Project,
} from '@beluga/shared';
import {
  LIBELLE_RAISON as LIBELLE_RAISON_SURVEILLANCE,
  RECETTE_APPEL,
  type VerdictSite,
  jugerAdresse as jugerAdresseSurveillance,
  jugerRecetteSurveillance,
  phraseDePeriode as phraseDePeriodeSurveillance,
  phraseDeRecetteSurveillance,
} from '@beluga/shared';
import {
  GENRES_D_ETAPE,
  formaterOctets,
  jugerRecette,
  mimeDuFichier,
  refusDeTaille,
  phraseDInventaire,
  phraseDeRecette,
  recetteEffective,
  recetteProposee,
  CLES_CANAUX,
  type IssueDArchive,
} from '@beluga/shared';
import { log } from './logger.js';
import { catalogueMoteurs } from './catalogue-moteurs.js';
import {
  changerLEtat,
  compter,
  compteursDeLaFiche,
  confianceMesureeDeLaFiche,
  ecrireLaFiche,
  lirePool,
  listerCompetences,
  relierCompetencesAuxCoffres,
} from './competences.js';
import { synchroniserSansEchec } from './competences-memoire.js';
import { importerUneBibliotheque } from './bibliotheques-competences.js';

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
import { supprimerLaCarte } from './suppression-carte.js';
import { refusDesProjetsTouches } from './regroupements.js';
import { deleguer, evaluer, suggererModele } from './mode-creation.js';
import { chercherUnDoublon, classerLeGenreDeLaCarte, garderLesPertinents, proposerUnNiveau } from './jugement-rapide.js';

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
const CHAMP_TITRE = {
  type: 'string',
  description:
    `Titre COURT et EXPLICITE : quelques mots qui nomment le sujet, jamais une description du travail attendu. ` +
    `${MAX_SIGNES_TITRE} signes au plus ; l'outil refuse un titre plus long. Le détail va dans la description.`,
};

/**
 * LA SYNTHÈSE DE LA DEMANDE, ÉCRITE AU DÉBUT DU TOUR et non à sa fin. Elle se
 * pose sur le jalon « Demande » du tour en cours, d'où le fil la lit aussitôt
 * (`resumesDuFil`) : le point cesse de dire « Votre demande est notée. » dès les
 * premières secondes, au lieu d'attendre la compréhension de fin de tour.
 */
const CHAMP_RESUME_DEMANDE = {
  type: 'string',
  description:
    "Ce qui vient d'être DEMANDÉ, d'après le seul message de l'utilisateur — aucune solution, aucun nom de " +
    `fichier, aucune connaissance du projet requise : ${FORME_DES_RESUMES_DU_FIL}. S'affiche sous le point ` +
    '« Demande » du fil, dès l\'envoi. À écrire à CHAQUE tour, pour le message de CE tour.',
};

const CHAMP_DESCRIPTION =
  'La demande REFORMULÉE en deux ou trois phrases : ce que veut l’utilisateur et ce qui compte pour lui. ' +
  `Entre ${MIN_SIGNES_CARTE_COURTE} et ${MAX_SIGNES_DESCRIPTION} signes ; une description vide ou réduite au titre est REFUSÉE et rendue à réécrire. ` +
  'N’ouvre pas le projet et n’invente aucun constat sur le code : l’étude est le travail de l’agent qui exécutera la carte. ' +
  'Les champs séparés (constat, attendu, limites, verification) restent acceptés quand tu les as vraiment établis : Beluga Build les met en forme.';

/** Les trois paliers, décrits une seule fois (`shared/src/niveau-agent.ts`). */
const CHAMP_NIVEAU = {
  type: 'string',
  enum: NIVEAUX_AGENT,
  description:
    "Le NIVEAU de l'agent qui exécutera la carte — " +
    NIVEAUX_AGENT.map((id) => `« ${id} » : ${DEFINITIONS_NIVEAU[id].quand}`).join(' ') +
    ` Dans le doute, « ${NIVEAU_PAR_DEFAUT} ». Tu ne nommes jamais un modèle, et le niveau ne remplace jamais celui` +
    " d'une carte qui en a déjà un : il est alors seulement noté.",
};

/**
 * La date de départ, facultative. Elle ne remplace aucun geste : elle donne le
 * geste à l'AVANCE. Sans elle, la carte attend le lancement comme aujourd'hui.
 */
const CHAMP_DEPART =
  "Facultatif. Date et heure de départ souhaitées, au format ISO (« 2026-08-12T06:00 »). La carte attend alors dans " +
  "« Demande » et part TOUTE SEULE à l'heure dite, sans clic. À ne mettre que si l'utilisateur a demandé un moment " +
  'précis. Sans ce champ, rien ne change : la carte attend son geste de lancement.';

/**
 * Le relais d'une analyse RÉELLEMENT menée. Le chef d'orchestre ne le remplit
 * plus — il ne lit plus le projet avant de proposer —, mais le champ reste :
 * un agent qui vient de chiffrer une carte y transmet ses constats.
 */
const CHAMP_ANALYSE = {
  type: 'object',
  description:
    "FACULTATIF, et le chef d'orchestre ne le remplit plus en tri normal : il ne chiffre plus, l'étude appartient à la carte. Réservé à un agent qui vient RÉELLEMENT de mener l'analyse — ET au chef qui vient de faire valider un plan : `context` reprend alors le plan entier, pour qu'il voyage jusqu'à l'agent d'exécution.",
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
 * Beluga Build le dépose en PREMIER MESSAGE du fil de la carte.
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
  // Les champs séparés l'emportent : c'est Beluga Build qui met alors en forme.
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
      "Propose une carte pour une demande d'ACTION CLAIRE : elle apparaît dans la conversation avec ses boutons valider / refuser, et n'entre dans « Demande » qu'après le clic de l'utilisateur. Rien n'est écrit sur le tableau avant ce clic, et la colonne ne peut pas être choisie. Jamais pour une simple question, qui se répond dans la conversation.",
    inputSchema: {
      type: 'object',
      required: ['title', 'niveau', 'contexte'],
      properties: {
        title: CHAMP_TITRE,
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
      "Modifie le titre, la synthèse de la demande, la description, les étiquettes ou le NIVEAU d'exécution d'une carte existante.",
    inputSchema: {
      type: 'object',
      required: ['cardId'],
      properties: {
        cardId: { type: 'string' },
        title: CHAMP_TITRE,
        resumeDemande: CHAMP_RESUME_DEMANDE,
        description: { type: 'string' },
        labels: { type: 'array', items: { type: 'string' } },
        /*
         * LE NIVEAU DE L'AGENT QUI EXÉCUTERA LA CARTE. C'est par ici que
         * l'agent de cadrage choisit l'ampleur du travail — jamais un modèle
         * nommé : Beluga Build traduit le palier en moteur, modèle et réflexion
         * réels (`shared/src/niveau-agent.ts`).
         */
        niveau: CHAMP_NIVEAU,
      },
    },
  },
  {
    name: 'board_move_card',
    description:
      "Déplace une carte. Seule la colonne « planned » est acceptée : toute autre cible est refusée par l'outil.",
    inputSchema: {
      type: 'object',
      required: ['cardId', 'column'],
      properties: {
        cardId: { type: 'string' },
        column: { type: 'string', enum: ['planned'] },
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
        title: CHAMP_TITRE,
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
    name: 'attach_file',
    description:
      "Joint N'IMPORTE QUEL fichier déjà présent sur disque à TA réponse : il s'affiche dans la conversation comme " +
      "une pièce jointe reçue de l'utilisateur, et se télécharge d'un clic sous son vrai nom. Une image apparaît en " +
      "vignette, un PDF s'ouvre dans son cadre, tout le reste (journal, csv, tableur, archive, log) se télécharge. " +
      "À utiliser pour RENDRE un fichier au lieu d'en donner le chemin : captures d'un navigateur d'essai, rapport " +
      "produit, journal d'exécution, export. Le chemin peut être relatif à ton dossier de travail, ou absolu.",
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'Chemin du fichier déjà écrit sur disque, quel que soit son type' },
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
        description: {
          type: 'string',
          description:
            "Ce qu'il faut savoir pour répondre : le constat, ce que change chaque réponse. Affiché sous la question.",
        },
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
    name: 'deplacer_vers_projet',
    description:
      "CADRAGE SEULEMENT — déplace TA carte vers le projet qu'elle vise vraiment, quand la demande relève clairement d'un autre projet que celui-ci. Sans « projet », rend la liste des projets possibles. Le déplacement emporte la conversation ; ton tour s'arrête juste après, et le cadrage reprend tout seul dans le projet d'accueil. Refusé pour une carte déjà lancée ou née d'une demande client. En cas de doute entre plusieurs projets, demande d'abord à l'utilisateur (« ask_user »).",
    inputSchema: {
      type: 'object',
      properties: {
        projet: { type: 'string', description: "Le NOM exact (ou l'identifiant) du projet d'accueil" },
        raison: { type: 'string', description: 'Pourquoi cette carte appartient à ce projet, en une phrase simple' },
      },
    },
  },
  {
    name: 'rendre_comprehension',
    description:
      "CADRAGE — OBLIGATOIRE EN FIN DE CHAQUE TOUR : rends ce que tu as COMPRIS de la demande, en DEUX REGISTRES. Le premier (« texte ») est un miroir tendu à l'utilisateur, en mots courants, jamais une solution. Le second (« partieTechnique ») est replié à l'écran et part à l'agent qui exécutera : c'est le SEUL dossier qu'il recevra quand aucun plan n'est demandé. Le démon écrit le tout sur la carte ; ne le recopie pas en texte.",
    inputSchema: {
      type: 'object',
      required: ['texte', 'resumeDemande', 'resumeComprehension', 'partieTechnique'],
      properties: {
        resumeDemande: {
          type: 'string',
          description: `CE QUI A ÉTÉ DEMANDÉ, affiché sous le point « Demande » du fil : ${FORME_DES_RESUMES_DU_FIL}.`,
        },
        resumeComprehension: {
          type: 'string',
          description: `CE QUE TU AS COMPRIS, affiché sous le point « Compréhension » du fil : ${FORME_DES_RESUMES_DU_FIL}.`,
        },
        texte: {
          type: 'string',
          description: `Écris ${FORME_DE_LA_COMPREHENSION}. Avec ce que la mémoire a permis de préciser ; aucun chemin, aucun détail d’implémentation.`,
        },
        hypotheses: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Ce que tu ASSUMES faute de réponse, une ligne chacune, chacune commençant par « Je suppose que… ». Un point qui CHANGE le travail se pose avec « ask_user », pas ici : une question déposée dans ce champ est refusée. Tableau vide si rien.',
        },
        sujets: {
          type: 'array',
          items: { type: 'string' },
          description: 'Les sujets de mémoire ouverts pour comprendre.',
        },
        projetsTouches: {
          type: 'array',
          items: { type: 'string' },
          description:
            "SEULEMENT SUR UN PROJET RÉUNI (plusieurs projets travaillés depuis un tableau commun) : les NOMS des projets membres que ce travail modifie, et eux seuls. Au lancement, chacun reçoit sa propre carte, dans son propre dépôt et sur sa propre branche. Un projet dont tu doutes se demande avec « ask_user » avant. Absent sur un projet ordinaire.",
        },
        partieTechnique: {
          type: 'object',
          required: ['taches', 'faits', 'risques'],
          description:
            "LE SECOND REGISTRE, JAMAIS AFFICHÉ D'EMBLÉE : replié sous une flèche « Détails techniques », il part tel quel à l'agent qui EXÉCUTERA la carte. C'est ici, et seulement ici, que le jargon est permis : fichiers, fonctions, commandes. Obligatoire — il remplace le plan, devenu facultatif.",
          properties: {
            taches: {
              type: 'array',
              minItems: 1,
              description: 'LA DÉCOUPE DU TRAVAIL en étapes concrètes, dans l’ordre.',
              items: {
                type: 'object',
                required: ['titre', 'description'],
                properties: {
                  titre: { type: 'string', description: 'L’étape en quelques mots' },
                  description: { type: 'string', description: 'Ce qu’elle demande, avec les fichiers et fonctions repérés' },
                },
              },
            },
            faits: {
              type: 'array',
              items: { type: 'string' },
              description:
                'LES FAITS DÉJÀ CONNUS DU PROJET À RESPECTER — décisions tranchées, pièges, conventions, identifiants de mémoire (MEM-…, DEC-…) —, RECOPIÉS ICI depuis la base de connaissances que tu viens d’ouvrir. Deux tiers des travaux exécutés ne l’ouvrent JAMAIS : ce que tu n’écris pas ici, personne ne l’ira chercher.',
            },
            risques: { type: 'string', description: 'CE QUI RISQUE DE CASSER, et ce qu’il faut vérifier pour s’en assurer.' },
          },
        },
      },
    },
  },
  {
    name: 'rendre_plan',
    description:
      "CADRAGE — SEULEMENT QUAND LA CONSIGNE TE LE DEMANDE : rends le PLAN COMPLET de la carte, toutes ses parties. Le démon le met en forme, l'enregistre en version n, et l'écran l'affiche ; n'écris pas le plan en texte. Un plan incomplet est refusé avec ce qui manque. Toutes les parties affichées sont lues par l'utilisateur, qui ne programme pas : mots courants, aucun nom de fichier, de fonction ni de technologie. Le détail technique va dans « notesTechniques ».",
    inputSchema: {
      type: 'object',
      required: ['titre', 'enClair', 'synthese', 'taches', 'decisions', 'faisabilite', 'chemin', 'consequences', 'ameliorations'],
      properties: {
        titre: { type: 'string', description: 'Le titre court du plan' },
        enClair: {
          type: 'string',
          minLength: SIGNES_MINIMUM_EN_CLAIR,
          description:
            "L'OUVERTURE DU PLAN, affichée AVANT la liste des tâches : deux à quatre courts paragraphes adressés à l'utilisateur, qui ne programme pas, pour qu'il se représente le résultat — ce que tu vas faire (« je vais… »), comment ça fonctionnera une fois en place, et à quoi ça lui servira. Deux phrases au moins, aucun nom de fichier ni de technologie.",
        },
        synthese: {
          type: 'string',
          description: `CE QUI VA ÊTRE FAIT, affiché sous le point « Plan » du fil : ${FORME_DES_RESUMES_DU_FIL}.`,
        },
        taches: {
          type: 'array',
          // Les minimums se DÉCLARENT : le moteur les voit avant d'appeler, au
          // lieu de les découvrir dans un refus.
          minItems: 2,
          description: 'LA LISTE DES TÂCHES : tout ce qu\'il y a à réaliser, deux entrées au moins. Le premier bloc du plan.',
          items: {
            type: 'object',
            required: ['titre', 'description'],
            properties: {
              titre: { type: 'string', description: 'Ce qu\'il y a à faire, en quelques mots' },
              description: { type: 'string', description: 'La description détaillée de cette tâche, en texte suivi' },
            },
          },
        },
        decisions: {
          type: 'array',
          minItems: 1,
          items: { type: 'string' },
          description:
            "LES DÉCISIONS DES ITÉRATIONS, une ligne au moins : ce qui a été décidé, changé ou abandonné pendant les échanges, et à quel moment (version, message, réponse à une question). Une nouvelle version REPREND les lignes de la précédente et y ajoute les siennes ; un point retiré du plan y est noté abandonné.",
        },
        resume: { type: 'string', description: 'Le plan en une phrase — sert à la description de la carte, plus au corps du plan' },
        faisabilite: {
          type: 'string',
          description: "Ce que le projet fait aujourd'hui d'après la mémoire ouverte, ce que la demande veut de plus, l'écart, et ce dont tu n'es pas sûr (« je suppose »)",
        },
        chemin: {
          type: 'array',
          minItems: 2,
          description: 'Les étapes numérotées, deux au moins',
          items: {
            type: 'object',
            required: ['titre', 'detail'],
            properties: { titre: { type: 'string' }, detail: { type: 'string' } },
          },
        },
        consequences: { type: 'string', description: 'Ce que ça change, ce que ça casse' },
        ameliorations: {
          type: 'array',
          minItems: 3,
          items: { type: 'string' },
          description: 'Une ligne par demande actionnable, trois au moins',
        },
        verifications: {
          type: 'array',
          items: { type: 'string' },
          description: 'Comment on vérifiera que c’est fait, dit simplement (ce que chaque contrôle prouve)',
        },
        notesTechniques: {
          type: 'string',
          description:
            "JAMAIS AFFICHÉ À L'UTILISATEUR : le détail technique utile à l'agent qui fera le travail — fichiers, fonctions, commandes, contrôles à lancer, pièges repérés. Il le reçoit avec le plan.",
        },
      },
    },
  },
  {
    name: 'memoire',
    description:
      "La BASE DE CONNAISSANCES, cherchée EN LOCAL sans aucun quota : des UNITÉS typées (decision, convention, component, operation…), chacune avec son identifiant (MEM-0042, DEC-007), son importance (P0 vital → P3), sa source et ses liens, rangées dans des fiches numérotées (00_project … 12_lessons ; au Global 00_principles … 06_lessons), plus le CHANGELOG du projet, qui dit ce qui a déjà été fait. " +
      "Cinq gestes. « chercher » (« demande » : des mots précis ; « contexte » : ce que tu fais ; « type » facultatif) rend les unités du projet puis du global, pondérées par pertinence, importance, type, fraîcheur et liens. " +
      "« lire » rend une unité entière par son « id », une fiche numérotée par « fiche » (« 05 », « decisions »… ; « classeur » global au besoin), ou le changelog (« fiche » : « changelog »). Ce qui est déjà lu dans la session n'est pas renvoyé. " +
      "« proposer » soumet une unité à la PORTE D'ÉCRITURE : « action » create (défaut), update ou deprecate (avec « id »), « type », « importance », « titre », « resume », « detail », « raisonnement » (obligatoire pour une décision), « sujets », « remplace » (l'id de l'unité active devenue fausse), « jamais_supposer », « classeur ». Un « update » qui donne un AUTRE type RECLASSE l'unité (historique gardé ; vers ou depuis « decision », elle change d'identifiant et l'ancienne est dépréciée). " +
      "LES TYPES — ce qui entre, et ce qui n'y entre pas : " +
      TYPES_UNITE.map((t) => `${t} = ${DEFINITION_TYPE[t]}`).join(' ') +
      " Le moteur choisit la fiche et l'identifiant, fusionne un doublon, et REFUSE avec sa raison un journal, un raisonnement, une commande triviale, une hypothèse ou le récit d'une tâche. " +
      "« changelog » écrit l'entrée de ta carte au journal des changements, lu par quelqu'un qui ne programme pas : « titre » (ce qui a changé, en mots courants, jamais un nom de branche), « explication » (deux à quatre phrases : ce qui a changé, puis à quoi ça sert) et « poids » (grande-nouveaute pour une fonctionnalité entière qu'on annoncerait à un client, amelioration, correction, retrait, detail pour le bruit). Une entrée trop pauvre est refusée avec sa raison. « brouillon » garde une note de travail liée à ta carte (WORKING) : jamais servie comme mémoire, effacée à la fermeture de la carte.",
    inputSchema: {
      type: 'object',
      required: ['geste'],
      properties: {
        geste: { type: 'string', enum: ['chercher', 'lire', 'proposer', 'changelog', 'brouillon'] },
        demande: { type: 'string', description: 'Pour « chercher » : des mots précis (fichier, fonction, symptôme, sujet)' },
        contexte: { type: 'string', description: 'Pour « chercher » : le contexte de la demande, en quelques mots' },
        id: { type: 'string', description: 'L’identifiant d’une unité (MEM-0042, DEC-007) : pour « lire », ou pour « proposer » avec update ou deprecate' },
        fiche: { type: 'string', description: 'Pour « lire » : une fiche numérotée (« 00 », « 05_decisions », « conventions ») ou « changelog »' },
        action: { type: 'string', enum: ['create', 'update', 'deprecate'], description: 'Pour « proposer » (défaut : create)' },
        type: { type: 'string', enum: [...TYPES_UNITE], description: 'Le type de l’unité (taxonomie fermée) ; filtre facultatif de « chercher »' },
        importance: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'], description: 'P0 : une erreur casse la production ou perd des données ; P3 : anecdotique' },
        titre: { type: 'string', description: 'Pour « proposer » : le titre, court et précis ; pour « changelog » : ce qui a changé, en mots courants' },
        explication: { type: 'string', description: 'Pour « changelog » : deux à quatre phrases, ce qui a changé puis à quoi ça sert' },
        poids: { type: 'string', enum: [...POIDS_CHANGELOG], description: 'Pour « changelog » : l’ampleur réelle du changement' },
        resume: { type: 'string', description: 'Pour « proposer » : le fait en une ou deux phrases complètes' },
        detail: { type: 'string', description: 'Pour « proposer » : le détail en Markdown (sections « ### » du gabarit de son type)' },
        raisonnement: { type: 'string', description: 'Pour « proposer » : pourquoi (obligatoire pour une décision)' },
        sujets: { type: 'string', description: 'Pour « proposer » : les sujets, séparés par des virgules (publication, interface…)' },
        remplace: { type: 'string', description: 'Pour « proposer » : l’id de l’unité active que celle-ci rend fausse' },
        jamais_supposer: { type: 'boolean', description: 'Pour « proposer » : ce qu’un nouvel agent supposerait à tort' },
        texte: { type: 'string', description: 'La note de « brouillon »' },
        classeur: { type: 'string', enum: ['projet', 'global'], description: 'La portée de « lire » et de « proposer » : le projet (défaut) ou le global' },
      },
    },
  },
  {
    name: 'competences',
    description:
      "Le POOL DE COMPÉTENCES PARTAGÉ, valable pour TOUS les projets. Chaque fiche est aussi une unité de la mémoire " +
      "(classeur global) : l'outil « memoire », geste « chercher », les trouve. Cinq actions. « lister » rend les fiches, " +
      "leur état, leur confiance et leur bibliothèque. « ecrire » crée ou COMPLÈTE une fiche à partir d'une leçon PROUVÉE — une fiche " +
      "sans section « Vérification », ou dont la description ne dit pas quand s'en servir, est refusée avec sa raison. " +
      "« retour » dit ce qu'une compétence servie t'a réellement apporté : c'est ce qui fait monter ou descendre sa " +
      "confiance. « importer » installe (ou met à jour) une BIBLIOTHÈQUE entière de compétences publiées ailleurs : « source » = " +
      "un mot connu (« anthropic » ou « claude », « openai » ou « codex »), « propriétaire/dépôt » GitHub, une adresse de dépôt git ou un " +
      "chemin absolu ; « sous_dossier » et « bibliotheque » (son nom court) facultatifs. Les fiches importées sont servies par la " +
      "mémoire SEULEMENT, jamais annoncées en tête de session. « etat » passe une fiche (« nom ») en active, depreciee ou archivee " +
      "(« etat ») : archivée, elle sort du service sans être effacée. Une leçon qui ne vaut que pour un seul projet ne se capitalise pas.",
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['lister', 'ecrire', 'retour', 'importer', 'etat'], description: 'Ce que tu veux faire' },
        source: {
          type: 'string',
          description: 'Pour « importer » : « anthropic », « openai », « propriétaire/dépôt », une adresse de dépôt git ou un chemin absolu',
        },
        sous_dossier: { type: 'string', description: 'Pour « importer » : ne prendre qu’un sous-dossier de la bibliothèque' },
        bibliotheque: { type: 'string', description: 'Pour « importer » : le nom court de la bibliothèque (déduit de la source sinon)' },
        etat: { type: 'string', enum: ['active', 'depreciee', 'archivee'], description: 'Pour « etat » : le nouvel état de la fiche' },
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
      "Ajoute un FAIT court et durable à la base de connaissances (décision, piège, convention) — jamais une livraison datée, qui va au changelog. La ligne passe par la même porte d'écriture que « memoire » geste « proposer » : le type se devine (« type » pour le forcer), le titre est ce qui précède « : ». " +
      "Un fait devenu faux se REMPLACE (« replaces » : l'identifiant de l'unité, ou le début de son titre) : l'ancienne unité est dépréciée et reliée. Une ligne qui double une unité existante la met à jour au lieu d'en créer une autre.",
    inputSchema: {
      type: 'object',
      required: ['line'],
      properties: {
        line: { type: 'string', description: 'Un fait durable, une seule ligne, de préférence « Titre : le fait »' },
        type: { type: 'string', enum: [...TYPES_UNITE], description: 'Le type de l’unité, si la devinette ne suffit pas (facultatif)' },
        importance: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'], description: 'Défaut : P2' },
        sujet: { type: 'string', description: 'Le sujet : publication, interface, cartes, methode… (facultatif)' },
        replaces: { type: 'string', description: 'L’id (MEM-0042) ou le début du titre de l’unité devenue fausse (facultatif)' },
        portee: {
          type: 'string',
          enum: ['projet', 'centrale'],
          description: '« projet » (défaut) ou « centrale » : le GLOBAL, commun à tous les projets, pour un fait qui vaut partout',
        },
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
    name: 'coffre_fort',
    description:
      "LE COFFRE-FORT CENTRAL DES IDENTIFIANTS (clés SSH, mots de passe, clés d'API, jetons, bases de données). " +
      "N'écris JAMAIS un secret en clair dans un message, un fichier du dépôt ou une variable d'environnement " +
      "versionnée : range-le ici. LE COFFRE EST CENTRAL ET ENTIÈREMENT OUVERT : « lister » cherche et RELIT TOUS " +
      "les accès rangés, ceux de TOUS LES PROJETS et ceux partagés de Beluga Build — la ligne de chaque fiche dit " +
      "de quel projet elle vient. Sers-t'en AVANT de demander un identifiant à " +
      "l'utilisateur : il est peut-être déjà là, rangé sous un autre projet. « enregistrer » range une clé NOUVELLE que tu viens de découvrir ou " +
      "de recevoir pendant le travail (une clé donnée dans la conversation, générée par toi, ou trouvée dans un " +
      "fichier non versionné) — une fiche NEUVE se rattache au projet en cours, une fiche CORRIGÉE reste rangée où " +
      "elle est ; redonne l'« id » d'une fiche " +
      "trouvée par « lister » pour la corriger au lieu d'en créer une seconde. Chaque type a ses champs propres " +
      "(cle-api → service/cle/adresse, mot-de-passe → adresse/identifiant/motDePasse, ssh → hote/port/utilisateur/" +
      "cle/motDePasse, jeton → service/jeton, base-de-donnees → hote/port/base/utilisateur/motDePasse, autre → " +
      "valeur) ; ne passe que ceux qui s'appliquent. UNE FICHE PAR SECRET : chaque mot de passe, clé ou jeton a SA " +
      "fiche, du bon type, avec un nom qui dit à quoi il sert et dans quel environnement ; un fichier de configuration " +
      "(.env, config.php…) ne se colle JAMAIS en entier — un fichier plein d'accès donne une fiche par secret, et le " +
      "coffre refuse une fiche qui en regroupe plusieurs. « supprimer » retire une fiche périmée (donne son « id ») : " +
      "elle n'est pas effacée mais ARCHIVÉE six mois, puis effacée pour de bon ; « archives » liste les fiches " +
      "retirées et « restaurer » (avec « id ») en remet une en service. N'archive que ce qui est VRAIMENT périmé, " +
      "une fiche d'un autre projet sert peut-être encore à quelqu'un.",
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['lister', 'enregistrer', 'supprimer', 'archives', 'restaurer'], description: 'Ce que tu veux faire' },
        recherche: { type: 'string', description: "Mots cherchés (pour « lister » ; vide = tout montrer)" },
        id: { type: 'string', description: "L'identifiant d'une fiche déjà rangée, pour la corriger (pour « enregistrer »), la retirer (pour « supprimer ») ou la remettre en service (pour « restaurer »)" },
        nom: { type: 'string', description: "Le nom de la fiche (pour « enregistrer »)" },
        type: { type: 'string', enum: [...TYPES_ACCES], description: "Le type d'accès (pour « enregistrer »)" },
        champs: {
          type: 'object',
          description: "Les valeurs, par champ du type choisi (pour « enregistrer »), ex. { \"hote\": \"…\", \"utilisateur\": \"…\", \"cle\": \"…\" }",
        },
        note: { type: 'string', description: 'Une note libre (pour « enregistrer »)' },
      },
    },
  },
  {
    name: 'relancer_publication',
    description:
      "RELANCE LA PUBLICATION TOMBÉE QUE TU DÉPANNES — réservé à l'agent ouvert par « Résoudre le problème ». Appelle-le UNE fois, après ta réparation : la même publication repartira, à la même étape, dès la fin de ton tour. Aucun autre geste de publication ne t'est permis.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'marketing',
    description:
      "L'ATELIER MARKETING DE CE PROJET — réservé à l'agent marketing. « action » : « lire » (configuration, fiche, rapport, avis sur les canaux, plan d'action, contenus, résultats des 30 derniers jours) ; « configurer » (configuration : nature, hebergement, hebergementDetail, adresse, origines, sourcesVentes, objectifs, methodeSuivi, langue, explication — ce qui n'est pas redit est conservé) ; « fiche » (fiche : cible, probleme, promesse, arguments, ton, offre, prix, concurrents) ; « canaux » (recommandations : ton avis sur les canaux du catalogue, chacun remplace l'avis précédent du même canal ; choisis : les canaux retenus pour commencer) ; « action » (le PLAN : sans « id » pose une action datée, avec « id » la corrige, « supprimer » true la retire : titre, detail, canal, datePrevue AAAA-MM-JJ) ; « contenu » (sans « id » crée, avec « id » modifie : genre, canal, titre, texte, datePrevue AAAA-MM-JJ, etape brouillon|a_valider, varianteDe, lienCible) ; « poser_suivi » (prépare l'installation du script de suivi selon la méthode choisie et rend la phrase de confidentialité) ; « rapport » (rapport : le rapport ENTIER en Markdown, qui remplace le précédent — refusé tant que nature et hebergement ne sont pas configurés). Tu ne valides, ne programmes, ne publies et ne coches jamais « fait » : ce sont des gestes de l'utilisateur.",
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['lire', 'configurer', 'fiche', 'canaux', 'action', 'contenu', 'poser_suivi', 'rapport'] },
        rapport: { type: 'string', description: 'Pour « rapport » : le rapport entier, en Markdown' },
        configuration: { type: 'object', description: 'Pour « configurer »' },
        fiche: { type: 'object', description: 'Pour « fiche »' },
        recommandations: {
          type: 'array',
          description: 'Pour « canaux » : un avis par canal étudié',
          items: {
            type: 'object',
            properties: {
              canal: { type: 'string', enum: [...CLES_CANAUX] },
              pertinence: { type: 'string', enum: ['haute', 'moyenne', 'faible'] },
              raison: { type: 'string', description: 'Pourquoi, pour CE produit, en une phrase simple' },
              premierPas: { type: 'string', description: 'Le premier geste concret' },
            },
            required: ['canal', 'pertinence', 'raison'],
          },
        },
        choisis: { type: 'array', items: { type: 'string', enum: [...CLES_CANAUX] }, description: 'Pour « canaux » : les canaux retenus pour commencer' },
        id: { type: 'string', description: 'Pour « contenu » ou « action » : l’identifiant à modifier' },
        supprimer: { type: 'boolean', description: 'Pour « action » avec « id » : retirer l’action du plan' },
        detail: { type: 'string', description: 'Pour « action » : quoi faire et comment, en pas simples' },
        genre: { type: 'string', enum: ['post', 'courriel', 'page', 'annonce', 'argumentaire'] },
        canal: { type: 'string', enum: [...CLES_CANAUX, 'autre'] },
        titre: { type: 'string' },
        texte: { type: 'string' },
        datePrevue: { type: 'string', description: 'AAAA-MM-JJ' },
        etape: { type: 'string', enum: ['brouillon', 'a_valider'] },
        varianteDe: { type: 'string', description: 'L’identifiant de la version A, pour écrire sa version B' },
        lienCible: { type: 'string', description: 'La page vers laquelle le lien de suivi du contenu mène (par défaut : l’adresse du produit)' },
      },
      required: ['action'],
    },
  },
  {
    name: 'surveillance_essai',
    description:
      "JOUE UNE RECETTE DE SURVEILLANCE POUR DE VRAI, SANS RIEN ENREGISTRER. Donne « url » et « recette » (ou l'« id » d'une surveillance existante pour rejouer la sienne). Rend debout ou tombé, la raison, le code, la durée et, pour un parcours, l'ÉTAPE qui casse. Appelle-le AVANT « surveillance_recette », jusqu'à ce que la recette passe.",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: "L'identifiant d'une surveillance existante" },
        url: { type: 'string', description: 'La page appelée, ou la page de départ du parcours' },
        recette: schemaDeRecetteSurveillance(),
      },
    },
  },
  {
    name: 'surveillance_recette',
    description:
      "ENREGISTRE UNE SURVEILLANCE ET SA RECETTE DE CONTRÔLE. Sans « id », une surveillance naît ; avec l'« id » d'une existante, elle est modifiée et ce que tu ne redis pas est CONSERVÉ. L'outil REJOUE la recette et refuse celle qui tombe, en disant l'étape ; « forcer » seulement avec l'accord explicite de l'utilisateur. Aucun mot de passe dans la recette : « acces » référence une fiche du coffre-fort.",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: "L'identifiant d'une surveillance existante, pour la modifier" },
        url: { type: 'string', description: 'La page appelée, ou la page de départ du parcours' },
        nom: { type: 'string', description: 'Un nom court' },
        recette: schemaDeRecetteSurveillance(),
        periodeMinutes: { type: 'number', description: 'Tous les combien de minutes le contrôle passe (1 au plus souvent, 5 par défaut)' },
        forcer: { type: 'boolean', description: "Enregistrer malgré un essai qui tombe — SEULEMENT si l'utilisateur l'a accepté" },
      },
    },
  },
  {
    name: 'backup_recette',
    description:
      "ENREGISTRE LA FICHE D'UN SITE À SAUVEGARDER ET SA RECETTE DE BACKUP. C'est le geste final de l'agent " +
      "d'analyse : après avoir lu le site, posé ses questions avec « ask_user » et vu sa recette marcher avec " +
      "« backup_essai », tu poses ici la fiche ET la recette, en UN seul appel. Sans « id », un nouveau site est créé ; " +
      "avec l'« id » d'un site existant, la fiche est corrigée et ce que tu ne redis pas est CONSERVÉ (un mot de passe " +
      "ou une recette déjà enregistrés ne se perdent pas). L'outil essaie les accès puis REJOUE la recette pour de " +
      "vrai, et refuse ce qui ne donne pas une archive complète en disant ce qui manque. Sans recette, celle déduite " +
      "de la base et des fichiers de la fiche tourne à sa place.",
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
        recette: schemaDeRecette(),
        forcer: {
          type: 'boolean',
          description:
            "N'enregistre la fiche QUE si l'utilisateur a explicitement accepté qu'un accès qui ne répond pas soit gardé tel quel (machine éteinte, site pas encore en ligne). Sans cela, une fiche dont la base ou les fichiers ne répondent pas est refusée.",
        },
      },
    },
  },
  {
    name: 'backup_essai',
    description:
      "ESSAIE POUR DE VRAI, SANS RIEN ENREGISTRER NI RIEN GARDER. Avec une « recette » (ou « rejouer » sur un site déjà enregistré) : chaque étape est jouée, l'archive zip écrite, relue et jugée, puis jetée — l'outil rend ce que l'archive contient étape par étape et la plainte de chaque commande qui tombe. Sans recette : la base est ouverte (son schéma est lu puis jeté) et le dossier des fichiers est listé. Appelle-le AVANT « backup_recette », jusqu'à une archive complète. Prends soit l'« id » d'un site déjà enregistré, soit les mêmes champs que « backup_recette ».",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: "L'identifiant d'un site déjà enregistré, à essayer tel qu'il est" },
        recette: schemaDeRecette(),
        rejouer: {
          type: 'boolean',
          description: "Rejoue la recette ENREGISTRÉE du site (ou celle déduite de sa fiche), sans en donner une nouvelle",
        },
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
  /*
   * LES OUTILS DU MODE « CRÉATION ». Ils ne sont servis qu'à l'agent d'une
   * carte où l'interrupteur est allumé (`toolsFor(role, { creation })`) : les
   * autres tours n'en paient pas la description.
   */
  {
    name: 'deleguer',
    description:
      "MODE CRÉATION — confie une contribution PONCTUELLE à un autre modèle du serveur, selon la répartition réglée : « texte » (rédaction), « code » (programmation) ou « avis » (regard neuf). Le modèle consulté LIT la copie de travail mais n'écrit rien ; sa réponse te revient en texte, à toi d'assembler et d'appliquer. Borné dans le temps ; les avis sont plafonnés par tour.",
    inputSchema: {
      type: 'object',
      required: ['role', 'consigne'],
      properties: {
        role: { type: 'string', enum: ['texte', 'code', 'avis'], description: 'Le rôle consulté' },
        consigne: { type: 'string', description: 'Ce que tu attends, précisément : le but, les contraintes, la forme du rendu' },
        fichiers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Chemins utiles, relatifs à la copie de travail (facultatif)',
        },
        moteur: {
          type: 'string',
          enum: ['claude', 'codex', 'cursor'],
          description: 'Rôle « avis » seulement : viser un des moteurs d’avis réglés (facultatif)',
        },
      },
    },
  },
  {
    name: 'evaluer',
    description:
      "MODE CRÉATION — fait départager 2 à 5 propositions par le juge local (Laya), selon un critère. Son verdict est un CONSEIL : tu gardes le dernier mot. S'il n'est pas disponible ou pas assez sûr, il le dit et tu tranches.",
    inputSchema: {
      type: 'object',
      required: ['propositions'],
      properties: {
        propositions: { type: 'array', items: { type: 'string' }, description: 'Les propositions, dans l’ordre' },
        critere: { type: 'string', description: 'Sur quoi juger (facultatif) : clarté, justesse, originalité…' },
      },
    },
  },
  {
    name: 'suggerer_modele',
    description:
      "MODE CRÉATION — propose à l'utilisateur de confier un rôle à un autre modèle que celui réglé, pour CETTE carte seulement. Pose une question Accepter / Refuser et ATTEND la réponse ; acceptée, la suggestion s'applique aux délégations suivantes du rôle. À réserver aux cas où le gain est net.",
    inputSchema: {
      type: 'object',
      required: ['role', 'moteur', 'raison'],
      properties: {
        role: { type: 'string', enum: ['texte', 'code', 'avis'] },
        moteur: { type: 'string', enum: ['claude', 'codex', 'cursor'] },
        modele: { type: 'string', description: 'Un modèle réel de ce moteur (facultatif : son modèle par défaut)' },
        raison: { type: 'string', description: 'Pourquoi ce modèle servirait mieux, en une ou deux phrases' },
      },
    },
  },
];

/** Les outils réservés aux agents de tâche : l'agent de cadrage ne les voit pas. */
/**
 * LA FORME D'UNE RECETTE DE BACKUP, commune aux deux outils. Une déclaration
 * de fonction (hissée) : la liste des outils plus haut l'appelle avant que
 * cette ligne ne soit lue.
 */
function schemaDeRecette() {
  return {
    type: 'object',
    description:
      "LA RECETTE DU SITE : des étapes qui prennent chaque part (code, fichiers, base) dans une archive zip, et savent la remettre. Les accès de la fiche arrivent par l'environnement ($BASE_NOM, $BASE_MOT_DE_PASSE, $FICHIERS_CHEMIN…).",
    required: ['etapes'],
    properties: {
      explication: { type: 'string', description: 'Ce que tu as constaté sur le site, et pourquoi ces étapes' },
      etapes: {
        type: 'array',
        items: {
          type: 'object',
          required: ['genre', 'libelle', 'prendre', 'remettre'],
          properties: {
            id: {
              type: 'string',
              description: "Le dossier de l'étape dans l'archive (minuscules, chiffres, tirets) — tiré du libellé s'il manque",
            },
            genre: { type: 'string', enum: [...GENRES_D_ETAPE] },
            libelle: { type: 'string', description: 'Ce que l’étape prend, en clair' },
            prendre: { type: 'string', description: 'Commande bash qui écrit ce qu’elle prend dans "$SORTIE"' },
            remettre: {
              type: 'string',
              description: 'Commande bash qui repose ce qu’elle trouve dans "$ENTREE" — l’inverse exact de « prendre »',
            },
            octetsMin: { type: 'number', description: 'En dessous de ce poids, l’étape est jugée vide (1 par défaut)' },
          },
        },
      },
    },
  };
}

/** Une issue d'archive dite en clair, pour l'agent. */
const PHRASE_D_ISSUE: Readonly<Record<IssueDArchive, string>> = {
  reussi: 'archive complète',
  partiel: 'archive PARTIELLE',
  echec: 'AUCUNE archive',
};

/** La forme d'une recette de surveillance, commune aux deux outils (`shared/src/surveillance.ts`). */
function schemaDeRecetteSurveillance() {
  return {
    type: 'object',
    description:
      "{ type: « appel », motAttendu? } ou { type: « parcours », etapes: [...] }. Étapes : { action: « aller », url }, { action: « remplir », selecteur, valeur } ou { action: « remplir », selecteur, acces: { id: <fiche du coffre-fort>, champ: « motDePasse » } }, { action: « cliquer », selecteur }, { action: « attendre », selecteur | ms }, { action: « verifierTexte », texte }, { action: « verifierSelecteur », selecteur }.",
    required: ['type'],
    properties: {
      type: { type: 'string', enum: ['appel', 'parcours'] },
      motAttendu: { type: 'string', description: 'Pour un appel : un texte qui doit figurer dans la page' },
      explication: { type: 'string', description: 'Ce qui est vérifié, en une phrase' },
      etapes: { type: 'array', items: { type: 'object' } },
    },
  };
}

/** Un verdict de surveillance dit en clair, pour l'agent. */
function phraseDuVerdict(verdict: VerdictSite & { dureeMs: number }): string {
  if (verdict.etat === 'ok') return `DEBOUT${verdict.code ? ` (code ${verdict.code})` : ''}, en ${verdict.dureeMs} ms.`;
  return [
    `TOMBÉ : ${LIBELLE_RAISON_SURVEILLANCE[verdict.raison ?? 'injoignable']}${verdict.code ? ` (code ${verdict.code})` : ''}, en ${verdict.dureeMs} ms.`,
    verdict.etape ? `Étape qui casse : ${verdict.etape}` : null,
    verdict.detail ? `Détail : ${verdict.detail}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

export const TASK_ONLY_TOOLS = new Set(['remember', 'relancer_publication', 'backup_recette', 'backup_essai', 'surveillance_essai', 'surveillance_recette', 'marketing']);

/**
 * LES OUTILS D'UN SEUL GENRE D'AGENT : « marketing » n'est servi qu'à un agent
 * dont la carte porte l'étiquette marketing (`estAgentMarketing`). Aucun autre
 * agent ne le voit — ni ne repaie sa description à chaque tour.
 */
export function outilServiA(nom: string, agentId: string): boolean {
  if (nom === 'marketing') return estAgentMarketing(agentId);
  return true;
}

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

/**
 * LES OUTILS DU SEUL CADRAGE : rendre ce qu'il a compris, rendre le plan. Un
 * agent de tâche n'a rien à comprendre ni à planifier ici — il exécute un plan
 * déjà lancé — et lui offrir ces outils ferait réécrire le parcours d'une
 * carte en plein travail.
 */
export const CADRAGE_ONLY_TOOLS = new Set(['rendre_comprehension', 'rendre_plan', 'deplacer_vers_projet']);

/** Les outils du mode « Création » : servis seulement quand la carte l'a allumé. */
export const CREATION_TOOLS = new Set(['deleguer', 'evaluer', 'suggerer_modele']);

export function toolsFor(role: ToolContext['role'], options: { creation?: boolean } = {}): ToolDef[] {
  const servis = options.creation ? TOOL_DEFS : TOOL_DEFS.filter((t) => !CREATION_TOOLS.has(t.name));
  if (role === 'cadrage') return servis.filter((t) => !CADRAGE_BLOCKED_TOOLS.has(t.name));
  return servis.filter((t) => !CADRAGE_ONLY_TOOLS.has(t.name));
}

/**
 * LA BRANCHE QUI SIGNE UNE ÉCRITURE DE MÉMOIRE : celle du dossier de travail de
 * l'agent (« tache/… » pour une carte), lue dans git. Sans dossier ni branche
 * lisible, l'agent signe de son rôle.
 */
function brancheDeLAgent(ctx: ToolContext): string {
  const agent = store.getAgent(ctx.agentId);
  const dossier = (agent as { workdir?: string } | null)?.workdir;
  if (dossier) {
    try {
      const branche = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dossier, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (branche && branche !== 'HEAD') return branche;
    } catch {
      /* pas un dépôt git : on signe du rôle */
    }
  }
  return ctx.cardId ? `carte ${ctx.cardId.slice(0, 8)}` : `agent ${ctx.role}`;
}

/**
 * NOTE UNE OUVERTURE DE LA MÉMOIRE ET LA DIT AU FIL DE LA CARTE, EN DIRECT.
 * Le relevé (`noterUneLecture`) est la seule écriture ; `carnet.lignes` porte la
 * ligne qu'il vient de produire, avec l'étape du parcours où l'agent en est
 * (`etapeDeLaMemoire`). Rien de tout cela n'arrête une lecture : la diffusion
 * ratée se rattrape à la prochaine ouverture de la carte (`card.journal`).
 */
function noterEtDiffuserLaLecture(cle: string, ctx: ToolContext): void {
  const carte = ctx.cardId ? store.getCard(ctx.cardId) : null;
  const etape = carte ? etapeDeLaMemoire({ roleAgent: ctx.role, colonne: carte.column, parcours: carte.parcours }) : undefined;
  noterUneLecture(cle, ctx.agentId, ctx.cardId, etape);
  if (!carte) return;
  const ligne = ligneDeLaLecture(ctx.agentId, cle);
  if (ligne) bus.emit({ type: 'carnet.lignes', cardId: carte.id, lignes: [ligne] });
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
}

/**
 * Les réglages à poser sur une carte proposée : le MOTEUR de la conversation,
 * et un modèle qui existe VRAIMENT chez lui.
 *
 * Le modèle, lui, ne se recopie plus de la conversation quand le chef annonce un
 * NIVEAU : le chef trie sur un modèle économe, et recopier son modèle ferait
 * exécuter toutes les cartes au rabais. Sans niveau annoncé — un agent d'un
 * autre rôle qui propose —, l'ancien héritage s'applique tel quel.
 *
 * `automatique` n'est donné QUE pour une proposition d'un agent d'ANALYSE
 * (chef d'orchestre, rendez-vous de nuit) : personne n'a discuté avec cet
 * agent, donc le moteur hérité de sa conversation n'est jamais un choix
 * humain — juste le moteur par défaut du projet, toujours le même. Dans ce
 * cas, et SEULEMENT dans ce cas, le moteur suit le genre lu par Laya
 * (`classerLeGenreDeLaCarte`) plutôt que la conversation : Claude pour la
 * programmation avancée, GPT pour l'administratif, un repli sur quota qui
 * n'atteint jamais Cursor tout seul (`moteurDuTriAutomatique`, DEC-156).
 */
async function reglagesProposes(
  souhait: SouhaitReglages | undefined,
  niveau: NiveauAgent | undefined,
  automatique?: { titre: string; description: string; projectId?: string },
): Promise<{ run?: RunConfig; avertissement?: string }> {
  try {
    const catalogue = await catalogueMoteurs();
    let base = souhait;
    if (automatique) {
      const genre = await classerLeGenreDeLaCarte(automatique.titre, automatique.description, { projectId: automatique.projectId });
      base = { engine: moteurDuTriAutomatique(genre, catalogue).engine };
    }
    // LE MODÈLE DE LA CONVERSATION PASSE TOUJOURS (hors tri automatique
    // ci-dessus). On le retirait ici pour laisser le palier choisir à sa
    // place : c'était bon tant que le chef tournait de force sur un modèle
    // économe, ça ne l'est plus depuis qu'il tourne sur le modèle choisi à
    // l'écran. Le palier ne REMPLIT donc plus que ce qui manque
    // (`reglagesDeLaProposition`) : la carte part avec le modèle affiché en
    // haut de la discussion, jamais avec un autre.
    const retenu = reglagesDeLaProposition(niveau ? { ...base, niveau } : base, catalogue);
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
  const niveau = reglages.run.niveau ? ` Niveau « ${reglages.run.niveau} », traduit par Beluga Build en` : ' Réglages repris de cette conversation :';
  return (
    `${niveau} ${reglages.run.engine}${modele} (réflexion : ${reglages.run.thinking}).` +
    (reglages.avertissement ? ` ${reglages.avertissement}` : '')
  );
}

/**
 * UNE CARTE DE L'ANALYSE QUI DOUBLE UNE CARTE OUVERTE EST RENDUE À RÉÉCRIRE.
 *
 * Seulement pour l'agent d'ANALYSE (chef d'orchestre, nuit) : personne n'a
 * discuté avec lui, et une idée déjà sur le tableau n'a pas à y revenir. Une
 * proposition née d'une conversation n'est JAMAIS arrêtée ici — c'est un geste
 * humain. Présélection par les mots (`candidatsDeDoublon`), puis le juge local
 * compare les paires ; sans avis, rien n'est refusé.
 */
async function refusDeDoublon(ctx: ToolContext, titre: string, description: string): Promise<string | undefined> {
  if (ctx.role !== 'analysis') return undefined;
  try {
    const candidates = candidatsDeDoublon({ titre, description }, store.listCards(ctx.projectId));
    if (!candidates.length) return undefined;
    const doublon = await chercherUnDoublon({ titre, description }, candidates, { projectId: ctx.projectId });
    if (!doublon) return undefined;
    return (
      `Refusé : cette carte semble faire le même travail que la carte [${doublon.id}] « ${doublon.title} » ` +
      `(colonne : ${COLUMN_LABELS[doublon.column]}). Ne la propose pas une seconde fois ; si ton idée va plus loin, ` +
      `dis en quoi dans une proposition qui nomme ce qui la distingue.`
    );
  } catch {
    return undefined;
  }
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

  /*
   * LE DÉROULÉ DU CADRAGE EST SYNCHRONE, ET LE TEMPS 2 EST TENU ICI.
   *
   * Tant que la carte s'appelle « Nouvelle tâche », le seul geste servi est
   * `board_update_card` avec le seul champ `title`
   * (`gesteAutoriseAvantLeTitreDeCadrage`). Sans ce verrou, l'agent lisait les
   * pièces jointes et ouvrait la mémoire avant d'avoir titré : l'écran
   * montrait « Définition du titre » encore ouverte pendant que les étapes du
   * dessous se cochaient.
   */
  if (ctx.role === 'cadrage' && ctx.cardId) {
    const carteDuCadrage = store.getCard(ctx.cardId);
    const autoriseAvantLeTitre = gesteAutoriseAvantLeTitreDeCadrage({
      outil: name,
      champs: Object.keys(args).filter((champ) => args[champ] !== undefined),
      /*
       * UN TITRE PROVISOIRE NE LÈVE PAS LE VERROU. La carte reçoit un titre dès
       * l'arrivée de la demande, posé sans moteur depuis la phrase de
       * l'utilisateur (`titreEclairDeLaDemande`) : il tient la place à l'écran,
       * mais il n'a rien lu. Le temps 2 reste donc dû — l'agent doit écrire le
       * SIEN avant tout autre geste (`titreDeCarteADonner`).
       */
      titreDonne: !!carteDuCadrage && titreDeCarteADonner(carteDuCadrage),
    });
    if (!autoriseAvantLeTitre) return { ok: false, text: REFUS_AVANT_LE_TITRE };
  }

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
      const verdictTitre = jugerTitre(args.title);
      if (!verdictTitre.ok) return { ok: false, text: verdictTitre.message };
      /*
       * Rien n'entre sur le tableau sans un clic de l'utilisateur. L'outil
       * n'écrit donc AUCUNE carte : il affiche une proposition dans la
       * conversation, avec ses boutons valider / refuser. C'est la validation
       * qui fait naître la carte dans « À planifier », d'où part ensuite le
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
      const doublon = await refusDeDoublon(ctx, String(args.title), texte.description);
      if (doublon) return { ok: false, text: doublon };

      const reglages = await reglagesProposes(
        ctx.run,
        niveauDemande(args.niveau),
        ctx.role === 'analysis' ? { titre: String(args.title), description: texte.description, projectId: ctx.projectId } : undefined,
      );
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
          `Elle n'entrera dans « Demande » qu'après la validation de l'utilisateur.` +
          resumeReglages(reglages) +
          resumeDepart(depart),
        proposal,
      };
    }

    case 'board_update_card': {
      const card = store.getCard(String(args.cardId));
      if (!card || card.projectId !== ctx.projectId) return { ok: false, text: 'Carte introuvable.' };
      /*
       * LA CARTE S'ÉCRIT APRÈS L'ANALYSE, JAMAIS AVANT. Le cadrage écrivait un
       * titre et un niveau dès la première phrase, sans avoir ouvert un seul
       * sujet de la mémoire : la carte était donc cadrée sur ce que le modèle
       * imaginait du projet. Une ouverture de la mémoire (outil « memoire ») suffit à lever
       * le verrou — même une ouverture qui ne rend rien : ce qui compte est
       * d'être allé voir. Les autres rôles ne sont pas concernés.
       */
      if (ctx.role === 'cadrage') {
        const vues = store.consultationsDeLAgent(ctx.agentId).ouvertures;
        /*
         * SEUL LE TITRE PASSE AVANT. Un titre de trois mots se tire de la
         * PHRASE de l'utilisateur, pas du projet : le faire attendre laissait
         * la carte s'appeler « Nouvelle tâche » pendant tout le premier tour.
         * Dès que l'appel porte autre chose — description, niveau —, le verrou
         * reprend (`ecritureDeCarteAutoriseeAuCadrage`).
         */
        const champs = Object.keys(args).filter((champ) => args[champ] !== undefined);
        const autorise = ecritureDeCarteAutoriseeAuCadrage({
          analyseFaite: analyseDeCadrageFaite({ ouverturesMemoire: vues }),
          champs,
        });
        if (!autorise) return { ok: false, text: REFUS_AVANT_ANALYSE };
      }
      if (typeof args.title === 'string') {
        const verdictTitre = jugerTitre(args.title);
        if (!verdictTitre.ok) return { ok: false, text: verdictTitre.message };
      }
      const title = typeof args.title === 'string' ? args.title : card.title;
      const description = typeof args.description === 'string' ? args.description : card.description;
      /*
       * LE NIVEAU N'EST PAS UN RÉGLAGE DE PLUS : c'est une AMBITION, traduite
       * ici en moteur, modèle et réflexion réels. Le moteur reste celui de la
       * conversation ; un palier illisible laisse la carte comme elle était,
       * plutôt que de la rabattre sur un modèle au hasard.
       */
      const palier = niveauDemande(args.niveau);
      /*
       * UN MODÈLE DÉJÀ POSÉ NE SE REMPLACE JAMAIS. La règle tenait autrefois à
       * un détail — le modèle ne comptait comme « choisi à la main » que s'il
       * n'avait PAS de palier à côté de lui — et le palier reprenait donc la
       * main dès qu'un cadrage en avait écrit un, y compris sur un modèle
       * sélectionné à l'écran. Le palier ne REMPLIT plus que le vide : il
       * s'enregistre comme une ambition, il ne rechoisit plus le moteur.
       */
      const modelePose = !!card.run?.model;
      const reglages = palier && !modelePose ? await reglagesProposes(ctx.run, palier) : {};
      /*
       * LE PALIER EST RETENU MÊME QUAND LE CATALOGUE EST MUET. La traduction en
       * modèle réel demande le catalogue du moteur ; s'il est illisible, garder
       * l'INTENTION reste juste — le lancement la traduira. La perdre ici
       * ferait exécuter au palier par défaut une carte cadrée « approfondi ».
       */
      let run = card.run;
      if (palier) {
        // Le palier est RETENU dans tous les cas — c'est une intention, elle se
        // relit. Seul le modèle est intouchable dès qu'il y en a un.
        if (modelePose) run = card.run ? { ...card.run, niveau: palier } : card.run;
        else {
          const base = reglages.run ?? card.run;
          run = base
            ? { ...base, niveau: palier }
            : RunConfig.parse({ engine: ctx.run?.engine ?? 'claude', niveau: palier });
        }
      }
      /*
       * LE TITRE ÉCRIT ICI N'EST PLUS PROVISOIRE. C'était le défaut constaté :
       * l'agent annonçait un bon titre dans sa réponse, la carte gardait celui
       * tiré de la première phrase, et rien ne les départageait. Un titre passé
       * par l'outil est INTENTIONNEL — il éteint le drapeau, et plus rien ne le
       * remplacera.
       */
      const titreProvisoire = typeof args.title === 'string' ? undefined : card.titreProvisoire;
      const updated = store.saveCard({
        ...card,
        title,
        titreProvisoire,
        description,
        labels: Array.isArray(args.labels) ? args.labels.map(String) : card.labels,
        run,
        ...heritageAnalyseDeProposition(card, title, description),
      });
      bus.emit({ type: 'card.upsert', card: updated });
      /*
       * LA SYNTHÈSE NE VIT PAS SUR LA CARTE, MAIS SUR LE JALON DE SON TOUR. La
       * carte n'en porte qu'une seule, réécrite à chaque tour : elle ne saurait
       * pas dire ce qui a été demandé au DEUXIÈME message. Le jalon « Demande »,
       * lui, est propre à son message — c'est donc lui qu'on enrichit, et le fil
       * l'affiche sous le point qui le montre.
       */
      const synthese = typeof args.resumeDemande === 'string' ? args.resumeDemande.trim() : '';
      let syntheseEcrite = false;
      if (synthese && ctx.cardId) {
        const jalon = dernierJalonDeDemande(ctx.cardId, ctx.agentId);
        const enrichi = jalon ? completerDonneesDuJournal(jalon.id, { resumeDemande: synthese }) : null;
        if (enrichi) {
          bus.emit({ type: 'journal.entree', entree: enrichi });
          syntheseEcrite = true;
        }
      }
      const annonceModele =
        palier && !modelePose
          ? resumeReglages(reglages)
          : palier && modelePose
            ? ' Cette carte porte déjà un modèle : il est conservé tel quel, le palier est seulement noté.'
            : '';
      const annonceSynthese = synthese
        ? syntheseEcrite
          ? ' La synthèse de la demande est affichée dans le fil.'
          : " La synthèse n'a pas pu être rattachée à cette demande : le fil montrera celle de ta compréhension."
        : '';
      /*
       * LE NIVEAU PROPOSÉ : UNE SUGGESTION, JAMAIS UNE ÉCRITURE. Quand le
       * cadrage décrit la carte sans lui donner de niveau, le juge local en
       * propose un dans la réponse de l'outil. Rien n'est posé sur la carte
       * (DEC-213) : l'agent tranche, et un niveau déjà choisi n'est pas relu.
       */
      let annonceNiveau = '';
      if (ctx.role === 'cadrage' && !palier && !updated.run?.niveau && typeof args.description === 'string') {
        const suggere = await proposerUnNiveau(
          { titre: updated.title, description: updated.description },
          { cardId: updated.id, projectId: ctx.projectId },
        );
        if (suggere) {
          annonceNiveau = ` Le juge local suggère le niveau « ${suggere} » — une indication : c'est à toi de le poser (champ « niveau ») ou non.`;
        }
      }
      return {
        ok: true,
        text: `Carte mise à jour : ${updated.title}.${annonceModele}${annonceSynthese}${annonceNiveau}`,
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
      supprimerLaCarte(card.id);
      return { ok: true, text: `Carte supprimée : ${card.title}.` };
    }

    case 'propose_task': {
      const verdictTitre = jugerTitre(args.title);
      if (!verdictTitre.ok) return { ok: false, text: verdictTitre.message };
      // Même exigence que board_create_card : une proposition sans description
      // solide n'est pas affichée, elle est rendue à réécrire.
      const texte = descriptionDeProposition(args, exigenceDuRole(ctx.role));
      if ('refus' in texte) return { ok: false, text: texte.refus };
      // Même exigence de SYNTHÈSE que board_create_card : le fil de l'agent
      // s'ouvre sur ce texte, quel que soit l'outil qui a proposé la carte.
      const synthese = syntheseDeProposition(args);
      if ('refus' in synthese) return { ok: false, text: synthese.refus };
      const doublon = await refusDeDoublon(ctx, String(args.title), texte.description);
      if (doublon) return { ok: false, text: doublon };

      const reglages = await reglagesProposes(
        ctx.run,
        niveauDemande(args.niveau),
        ctx.role === 'analysis' ? { titre: String(args.title), description: texte.description, projectId: ctx.projectId } : undefined,
      );
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

    /*
     * `attach_screenshot` RESTE ACCEPTÉ : un fil déjà ouvert porte l'ancien nom
     * dans le schéma que son moteur a mis en cache, et le renommer sèchement
     * aurait coupé ses appels en plein tour.
     */
    case 'attach_file':
    case 'attach_screenshot': {
      const demande = String(args.path ?? '').trim();
      if (!demande) return { ok: false, text: 'Aucun chemin donné.' };
      const agent = store.getAgent(ctx.agentId);
      /*
       * TROIS RACINES ACCEPTÉES : le dossier de travail de CETTE carte (où vit
       * une capture prise par ses propres scripts), le dépôt du projet, et le
       * dossier de données partagé de Beluga Build (où les scripts de vérification
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
      /*
       * PLUS AUCUN REFUS SUR L'EXTENSION. Le type sert à l'AFFICHAGE (vignette
       * d'image, cadre de PDF), jamais à filtrer : un format inconnu retombe sur
       * `application/octet-stream`, que le navigateur propose à télécharger.
       */
      const mime = mimeDuFichier(full);
      /*
       * LE SEUL REFUS QUI RESTE EST LE POIDS, ET IL SE DIT EN CLAIR. Le fichier
       * est recopié ENTIER en mémoire puis sur disque : sans borne, un agent
       * pouvait joindre un dump de plusieurs gigaoctets et faire tomber le
       * démon sans un mot. Même plafond que l'espace client (200 Mo).
       */
      const poids = fs.statSync(full).size;
      const refus = refusDeTaille(poids);
      if (refus) return { ok: false, text: `${refus} (${demande})` };
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
        const id = store.newId();
        attachment = Attachment.parse({
          id,
          alias: aliasDePieceJointe(id, store.aliasDesPiecesJointes()),
          projectId: project.id,
          name: nomSansCollision(nomVoulu, dejaUtilises),
          mime,
          size: data.length,
          sha,
          cardId: ctx.cardId,
          agentId: ctx.agentId,
          createdAt: Date.now(),
        });
        fs.writeFileSync(path.join(dossierDEcriture(), nomSurDisque(attachment)), data);
        store.saveAttachment(attachment);
        bus.emit({ type: 'attachments', projectId: project.id, items: store.listAttachments(project.id) });
      }
      return {
        ok: true,
        text: `Fichier joint à la conversation : ${attachment.name} (${Math.round(data.length / 1024)} ko). Il se télécharge d'un clic.`,
        attachment,
      };
    }

    /*
     * LE MODE « CRÉATION » : la mécanique vit dans `server/src/mode-creation.ts`.
     * La suggestion de modèle rend une QUESTION, et suit donc exactement le
     * chemin d'« ask_user » : l'appel reste ouvert jusqu'à la réponse.
     */
    case 'deleguer':
      return deleguer(ctx, args);
    case 'evaluer':
      return evaluer(ctx, args);
    case 'suggerer_modele': {
      const suggestion = await suggererModele(ctx, args);
      return suggestion.question ? { ok: true, text: texteSansAttente(), question: suggestion.question } : suggestion;
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

      /* CE QUI ÉCLAIRE LA QUESTION SE RANGE À PART. Sans ce champ, l'agent
         collait tout son contexte dans l'intitulé : la bulle affichait un
         paragraphe entier en gras, et la vraie question s'y perdait. */
      const eclairage =
        typeof args.description === 'string' && args.description.trim()
          ? args.description.trim().slice(0, 1200)
          : undefined;

      const question = AgentQuestion.parse({
        id: store.newId(),
        question: libelle,
        ...(eclairage ? { description: eclairage } : {}),
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

    /*
     * LE PARCOURS S'ÉCRIT PAR DES OUTILS, JAMAIS PAR LA RELECTURE D'UN TEXTE.
     *
     * Le cadrage rendait sa compréhension dans un bloc JSON en fin de réponse,
     * et son plan en markdown reconnu à ses quatre titres ; l'écran relisait
     * les deux, et chaque variation de forme les faisait disparaître. Les deux
     * passent désormais par un appel d'outil : le démon écrit sur la carte,
     * diffuse la carte, pose le jalon — et l'écran ne lit que la carte
     * (`shared/src/parcours-carte.ts`).
     */
    case 'deplacer_vers_projet': {
      /*
       * LE CADRAGE ENVOIE SA CARTE DANS LE BON PROJET, DE LUI-MÊME — et
       * seulement pendant le cadrage (décision du 26.09.2026). La règle du
       * geste à la main s'applique entière (DEC-236) ; seul l'agent appelant ne
       * compte pas comme « agent au travail ».
       */
      if (!ctx.cardId || !appelantPeutDeplacerLaCarte({ role: ctx.role, cardId: ctx.cardId, cardIdVise: ctx.cardId })) {
        return { ok: false, text: REFUS_DEPLACEMENT_HORS_CADRAGE };
      }
      const possibles = store.listProjects().filter((p) => !p.archived && p.id !== ctx.projectId);
      const liste = possibles.map((p) => `- ${p.name}${p.path ? ` — ${p.path}` : ''}`).join('\n') || '(aucun autre projet)';
      const voulu = typeof args.projet === 'string' ? args.projet.trim() : '';
      if (!voulu) {
        return {
          ok: true,
          text: `Projets qui peuvent recevoir cette carte :\n${liste}\n\nRappelle l'outil avec « projet » (le nom exact) et « raison » si la demande relève clairement de l'un d'eux.`,
        };
      }
      const raison = typeof args.raison === 'string' ? args.raison.trim() : '';
      if (!raison) return { ok: false, text: 'Dis en une phrase simple pourquoi cette carte appartient à ce projet (« raison »).' };
      const vise = trouverLeProjetVise(
        store.listProjects(true).map((p) => ({ id: p.id, name: p.name, archive: p.archived })),
        voulu,
      );
      if (!vise.ok) return { ok: false, text: `${vise.raison}\n\nProjets possibles :\n${liste}` };
      const { deplacerLaCarteVersProjet } = await import('./deplacement-vers-projet.js');
      const deplace = deplacerLaCarteVersProjet(ctx.cardId, vise.projet.id, {
        agentAppelantId: ctx.agentId,
        phrase: (depuis, vers) => phraseDeDeplacementParLeCadrage(depuis, vers, raison),
      });
      if (!deplace.ok) return { ok: false, text: deplace.error ?? 'Déplacement refusé.' };
      const { reprendreLeCadrageApresDeplacement } = await import('./naissance-de-carte.js');
      reprendreLeCadrageApresDeplacement(ctx.agentId, ctx.cardId, {
        depuis: deplace.depuis?.name ?? project.name,
        vers: vise.projet.name,
        raison,
      });
      return {
        ok: true,
        text: `La carte est dans le projet « ${vise.projet.name} ». ARRÊTE TON TOUR ICI : n'appelle plus aucun outil. Termine par une seule phrase qui dit à l'utilisateur que la carte est partie dans « ${vise.projet.name} » et pourquoi. Le cadrage y reprend tout seul dès la fin de ce tour, avec la mémoire et le code de ce projet.`,
      };
    }

    case 'rendre_comprehension': {
      if (ctx.role !== 'cadrage' || !ctx.cardId) return { ok: false, text: 'Cet outil n’appartient qu’au cadrage d’une carte.' };
      const runtimeDuCadrage = await import('./runtime.js');
      /*
       * COMBIEN DE QUESTIONS L'AGENT A-T-IL POSÉES DANS CE TOUR ? C'est ce qui
       * distingue un doute ASSUMÉ d'un doute abandonné : l'outil refuse une
       * formulation interrogative tant qu'aucune question n'a été posée
       * (`lireComprehensionRendue`, `shared/src/parcours-carte.ts`).
       */
      const tourDuCadrage = runtimeDuCadrage.liveRun(ctx.agentId)?.messageId;
      const questionsPosees = tourDuCadrage
        ? (store.listMessages(ctx.agentId).find((m) => m.id === tourDuCadrage)?.questions ?? []).length
        : 0;
      const carte = store.getCard(ctx.cardId);
      if (!carte || carte.projectId !== ctx.projectId) return { ok: false, text: 'Carte introuvable.' };
      /*
       * UN TOUR QUI A RENDU SON PLAN EST CLOS. Une compréhension écrite après
       * le plan, dans le même tour, passait à l'écran pour une reprise du
       * cadrage : second point « Plan », bouton « Générer le plan » rallumé
       * par-dessus la décision. L'outil refuse donc poliment.
       */
      if (tourDuCadrage && (carte.parcours?.plans ?? []).some((plan) => plan.tourId === tourDuCadrage)) {
        return {
          ok: false,
          text: 'Le plan de ce tour est déjà rendu : le tour s’arrête avec lui. Ne rends pas de compréhension ici — termine ta réponse en une phrase.',
        };
      }
      const lecture = lireComprehensionRendue(args, { questionsPosees });
      if (!lecture.ok) return { ok: false, text: lecture.raison };
      /* SUR UN PROJET RÉUNI, la compréhension DOIT dire quels projets elle
         touche : c'est ce qui décide des cartes posées au lancement. */
      const refusDesTouches = refusDesProjetsTouches(carte.projectId, lecture.valeur.projetsTouches);
      if (refusDesTouches) return { ok: false, text: refusDesTouches };
      const runtime = runtimeDuCadrage;
      const tourId = tourDuCadrage;
      const comprehension = ComprehensionDeCarte.parse({ ...lecture.valeur, at: Date.now(), tourId });
      const parcours = { ...(carte.parcours ?? { plans: [] }), comprehension };
      /*
       * UNE COMPRÉHENSION RENDUE SUR UNE CARTE RELANCÉE VAUT « NOUVEAU TRAVAIL ».
       *
       * Un message écrit sous un rapport rendu rouvre la discussion sans
       * déplacer la carte : elle reste dans « À déployer », prête à publier,
       * tant que l'échange n'est qu'une QUESTION. Si le cadrage choisit au
       * contraire de CADRER — c'est-à-dire de rendre une compréhension —, alors
       * un travail se prépare, et la carte doit quitter le lot à publier pour
       * reprendre le parcours d'une carte neuve
       * (`shared/src/relance-apres-rapport.ts`). C'est le SEUL chemin
       * automatique qui ressort une carte de « À déployer ».
       */
      const retour = colonneApresComprehensionDeRelance({ column: carte.column, parcours });
      const ecrite = store.saveCard({
        ...carte,
        parcours,
        ...(retour ? { column: retour, position: store.nextPosition(carte.projectId, retour) } : {}),
      });
      bus.emit({ type: 'card.upsert', card: ecrite });
      runtime.journaliserDansLeTour(ctx.agentId, {
        nature: 'jalon',
        libelle: JALON_COMPREHENSION,
        resultat: comprehension.texte,
        reussie: true,
        donnees: {
          hypotheses: comprehension.hypotheses,
          sujets: comprehension.sujets,
          /* LE SECOND REGISTRE VOYAGE AVEC SON JALON, comme les résumés : le
             volet « Détails techniques » de CE tour lit celui de CE tour. */
          ...(comprehension.partieTechnique ? { partieTechnique: comprehension.partieTechnique } : {}),
          // Les résumés voyagent avec LEUR jalon : chaque passage du fil lit celui de son tour.
          resumeDemande: comprehension.resumeDemande,
          resumeComprehension: comprehension.resumeComprehension,
        },
      });
      return {
        ok: true,
        text: comprehension.hypotheses.length
          ? `Compréhension enregistrée, avec ${comprehension.hypotheses.length} hypothèse(s) assumée(s). Elle s’affiche déjà sur la carte : ta réponse en texte ne la recopie pas, elle dit seulement où en est la carte.`
          : 'Compréhension enregistrée. Elle s’affiche déjà sur la carte : ta réponse en texte ne la recopie pas, elle dit seulement où en est la carte.',
      };
    }

    case 'rendre_plan': {
      if (ctx.role !== 'cadrage' || !ctx.cardId) return { ok: false, text: 'Cet outil n’appartient qu’au cadrage d’une carte.' };
      const lecture = lirePlanRendu(args);
      if (!lecture.ok) return { ok: false, text: lecture.raison };
      const carte = store.getCard(ctx.cardId);
      if (!carte || carte.projectId !== ctx.projectId) return { ok: false, text: 'Carte introuvable.' };
      const runtime = await import('./runtime.js');
      const tourId = runtime.liveRun(ctx.agentId)?.messageId;
      const plans = carte.parcours?.plans ?? [];
      const numero = numeroDuProchainPlan(plans);
      const texte = rendrePlan(lecture.valeur);
      const plan = {
        numero,
        titre: lecture.valeur.titre,
        resume: lecture.valeur.resume,
        synthese: lecture.valeur.synthese,
        texte,
        notesTechniques: lecture.valeur.notesTechniques || undefined,
        at: Date.now(),
        tourId,
      };
      /*
       * LA DEMANDE DE PLAN EST HONORÉE : le drapeau tombe, et un incident
       * posé par un tour précédent tombe avec lui — le plan est là.
       */
      const parcours = { ...(carte.parcours ?? {}), plans: [...plans, plan], planDemandeA: undefined, incident: undefined };
      /*
       * LE PLAN DESCEND DANS LA CARTE : le résumé et le chemin deviennent sa
       * description, en clair. La colonne les montre, l'agent d'exécution
       * reçoit le plan entier par ailleurs (`contexteDeDepart`).
       */
      const description = descriptionDepuisLePlanRendu(lecture.valeur) || carte.description;
      /*
       * LE CADRAGE EST CLOS : LA CARTE REÇOIT SON HEURE CONSEILLÉE, EN
       * SUGGESTION SEULEMENT.
       *
       * Le créneau n'est JAMAIS recopié dans `departPrevu` : une date de départ
       * est un geste de l'utilisateur (horloge, « Retenir cette heure »). La
       * recopie faisait partir des cartes toutes seules, à une heure que
       * personne n'avait choisie (demande du 14.09.2026).
       */
      const creneau =
        carte.scheduling?.departPrevu || carte.scheduling?.creneauConseille
          ? undefined
          : creneauPourUneCarte({ moteur: carte.run.engine });
      const scheduling = creneau
        ? { ...(carte.scheduling ?? { asap: false, attempts: 0, restarts: 0 }), creneauConseille: creneau }
        : carte.scheduling;
      const ecrite = store.saveCard({ ...carte, parcours, description, scheduling });
      bus.emit({ type: 'card.upsert', card: ecrite });
      runtime.journaliserDansLeTour(ctx.agentId, {
        nature: 'jalon',
        libelle: JALON_PLAN_PROPOSE,
        resultat: texte,
        reussie: true,
        donnees: { version: numero, titre: plan.titre, synthese: plan.synthese },
      });
      return {
        ok: true,
        text: `Plan enregistré en version ${numero}. Ne le recopie pas en texte : l'écran l'affiche. Le tour s'arrête avec ce plan : ne rends pas de compréhension dans ce tour. Ta réponse tient en une phrase.`,
      };
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
          const confiance = confianceMesureeDeLaFiche(fiche);
          const anomalies = fiche.anomalies.length ? ` — à revoir : ${fiche.anomalies.join(' ; ')}` : '';
          const origine = fiche.bibliotheque ? `, bibliothèque ${fiche.bibliotheque} — mémoire seulement` : '';
          return (
            `- ${fiche.nom} [${fiche.etat}, confiance ${confiance.toFixed(2)}, servie ${compteurs.servie}×${origine}] : ` +
            `${fiche.description}${anomalies}`
          );
        });
        const ecartes = refus.map((r) => `- écarté : ${raisonDuRefus(r)}`);
        return [`POOL DE COMPÉTENCES (${fiches.length}) :`, ...lignes, ...ecartes].join('\n');
      };

      if (action === 'lister' || !action) return { ok: true, text: liste() };

      if (action === 'importer') {
        const source = String(args.source ?? '').trim();
        if (!source) return { ok: false, text: 'Donne la « source » de la bibliothèque : « anthropic », « openai », « propriétaire/dépôt », une adresse git ou un chemin absolu.' };
        const bilan = await importerUneBibliotheque({
          source,
          sousDossier: typeof args.sous_dossier === 'string' ? args.sous_dossier : undefined,
          nom: typeof args.bibliotheque === 'string' ? args.bibliotheque : undefined,
        });
        return { ok: bilan.ok, text: texteDuBilanDImport(bilan) };
      }

      const nom = String(args.nom ?? '').trim();
      if (!nom) return { ok: false, text: 'Le nom de la fiche est requis.' };

      if (action === 'etat') {
        const etat = String(args.etat ?? '').trim() as EtatDeFiche;
        if (!(ETATS_DE_FICHE as readonly string[]).includes(etat)) return { ok: false, text: 'Donne l’« etat » : active, depreciee ou archivee.' };
        const fiche = lirePool().fiches.find((f) => f.nom === nom || path.basename(f.dossier) === nom);
        if (!fiche) return { ok: false, text: `Aucune fiche « ${nom} » dans le pool.` };
        const changement = changerLEtat(path.basename(fiche.dossier), etat);
        if (!changement.ok) return { ok: false, text: `État non changé :\n- ${(changement.raisons ?? []).join('\n- ')}` };
        relierCompetencesAuxCoffres();
        synchroniserSansEchec([fiche.nom]);
        return { ok: true, text: `« ${fiche.nom} » est maintenant ${etat === 'archivee' ? 'archivée : hors service, gardée sur le disque' : etat === 'depreciee' ? 'dépréciée : servie avec une mise en garde' : 'active'}.` };
      }

      if (action === 'retour') {
        const utile = args.utile !== false;
        compter(nom, utile ? 'aidee' : 'inutile');
        // La confiance de la fiche vit aussi sur son unité de mémoire : elle suit.
        synchroniserSansEchec([nom]);
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
      // Et la mémoire aussi : la fiche doit se trouver par « memoire chercher » dès ce tour.
      synchroniserSansEchec([nom]);
      return {
        ok: true,
        text:
          ecriture.geste === 'creee'
            ? `Compétence « ${nom} » créée dans le pool partagé.`
            : `Compétence « ${nom} » complétée : sa provenance d'origine est gardée.`,
      };
    }

    case 'memoire': {
      /*
       * LA BASE DE CONNAISSANCES, À LA DEMANDE : « chercher » rend des unités
       * pondérées, « lire » une unité, une fiche numérotée ou le changelog —
       * jamais deux fois dans la même session —, « proposer » passe par la porte
       * d'écriture unique (`proposerUnite`, `server/src/connaissances.ts`),
       * « brouillon » écrit dans WORKING. Toute la recherche est locale : aucun
       * quota. Chaque ouverture compte comme une lecture de la mémoire pour le
       * verrou du cadrage (`memoire_consultation`).
       */
      const geste = String(args.geste ?? '');
      const debut = Date.now();
      const texte = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
      const consigner = (sujet: string, rendu: string) =>
        store.recordMemoryConsultation({
          projectId: project.id,
          cardId: ctx.cardId,
          agentId: ctx.agentId,
          sujet: `connaissances:${sujet}`,
          dureeMs: Date.now() - debut,
          blocsDemandes: 1,
          blocsRendus: rendu ? 1 : 0,
          signesEntiers: rendu.length,
          signesServis: rendu.length,
        });
      const portee = args.classeur === 'global' ? PORTEE_GLOBALE : project.id;
      const lus = lusDansLaSession(ctx.agentId);

      if (geste === 'chercher') {
        const mots = texte(args.demande) ?? '';
        if (!mots) return { ok: false, text: 'Donne des mots précis à chercher dans « demande », et au besoin leur « contexte ».' };
        const contexte = texte(args.contexte);
        const type = texte(args.type)?.toLowerCase();
        const brutes = await chercherUnitesMelees(contexte ? `${mots} ${contexte}` : mots, {
          projectId: project.id,
          types: type && (TYPES_UNITE as readonly string[]).includes(type) ? [type as TypeUnite] : undefined,
          limite: 8,
        });
        /*
         * LA MÉMOIRE TRIÉE POUR LA DEMANDE. La recherche mêlée (mots + sens)
         * remonte aussi des unités voisines par le vocabulaire mais sans rapport
         * avec le travail : Laya écarte celles qu'il juge franchement hors sujet.
         * Une règle P0 ou « À ne jamais supposer » passe toujours ; sans avis
         * (Laya absent, endormi, usage éteint), tout passe.
         */
        const trouvees = await garderLesPertinents(
          contexte ? `${mots}\n${contexte}` : mots,
          brutes,
          {
            cle: (t) => t.unite.id,
            texte: (t) => `${t.unite.titre} — ${t.unite.resume}`,
            intouchable: (t) => t.unite.importance === 'P0' || t.unite.jamaisSupposer,
          },
          { usage: 'pertinence-memoire', cardId: ctx.cardId, projectId: project.id },
        );
        const rendu = rendreUnitesTrouvees(mots, trouvees, lus);
        consigner(mots, trouvees.length ? rendu : '');
        return { ok: true, text: rendu };
      }

      if (geste === 'lire') {
        const id = texte(args.id) ?? texte(args.code);
        if (id && estIdentifiantDUnite(id)) {
          const unite = lireUnite(id);
          if (!unite || (unite.portee !== project.id && unite.portee !== PORTEE_GLOBALE)) {
            return { ok: false, text: `Aucune unité « ${id} » dans ce projet ni au global : cherche-la avec « chercher ».` };
          }
          if (lus.has(unite.id)) {
            return { ok: true, text: `${unite.id} « ${unite.titre} » est déjà dans ton contexte : tu l'as lue plus tôt dans cette session.` };
          }
          noterEtDiffuserLaLecture(unite.id, ctx);
          // Ouvrir l'unité d'une compétence, c'est se la faire SERVIR : son compteur d'usage le dit.
          const competenceLue = nomDeCompetenceDeLUnite(unite);
          if (competenceLue) compter(competenceLue, 'servie');
          const rendu = texteDUneUnite(unite);
          consigner(unite.id, rendu);
          return { ok: true, text: rendu };
        }
        const nom = texte(args.fiche) ?? texte(args.theme);
        const disponibles = `${fichesDeLaPortee(portee).map((f) => f.id).join(', ')}, changelog`;
        if (!nom) return { ok: false, text: `Donne l'« id » d'une unité (MEM-0042), ou une « fiche » : ${disponibles}.` };
        if (/^changelog$/i.test(nom)) {
          const cle = `changelog:${project.id}`;
          if (lus.has(cle)) return { ok: true, text: 'Le changelog du projet est déjà dans ton contexte : tu l’as lu plus tôt dans cette session.' };
          const entrees = entreesDuChangelog(project.id, 150);
          const rendu = entrees.length ? rendreChangelog(project.name, entrees) : 'Le changelog de ce projet est encore vide.';
          noterEtDiffuserLaLecture(cle, ctx);
          consigner('changelog', rendu);
          return { ok: true, text: rendu };
        }
        const fiche = ficheParNom(portee, nom);
        if (!fiche) return { ok: false, text: `Aucune fiche « ${nom} » ici. Fiches : ${disponibles}.` };
        const cle = `fiche:${portee}:${fiche.id}`;
        if (lus.has(cle)) return { ok: true, text: `La fiche ${fiche.id} est déjà dans ton contexte : tu l'as lue plus tôt dans cette session.` };
        let rendu = markdownDeLaFiche(portee, fiche.id) ?? '';
        if (rendu.length > LECTURE_FICHE_MAX) {
          const unites = unitesDeLaPortee(portee).filter((u) => fiche.types.includes(u.type));
          rendu = `# ${fiche.id} — ${fiche.titre} : ${unites.length} unité(s), trop long pour un seul bloc\n\n${unites.map((u) => ligneDUnite(u, 160)).join('\n')}\n\nLis une unité entière avec « lire » et son « id ».`;
        } else {
          noterEtDiffuserLaLecture(cle, ctx);
        }
        consigner(fiche.id, rendu);
        return { ok: true, text: rendu };
      }

      if (geste === 'proposer' || geste === 'ecrire' || geste === 'enregistrer') {
        const branche = brancheDeLAgent(ctx);
        const resultat = await proposerUniteAvecSens(
          portee,
          {
            action: texte(args.action) as PropositionUnite['action'],
            id: texte(args.id),
            type: texte(args.type),
            importance: texte(args.importance),
            titre: texte(args.titre),
            resume: texte(args.resume) ?? texte(args.texte),
            detail: texte(args.detail),
            raisonnement: texte(args.raisonnement),
            sujets: texte(args.sujets) ?? texte(args.fiche),
            remplace: texte(args.remplace),
            jamaisSupposer: args.jamais_supposer === true || args.jamaisSupposer === true,
            confiance: typeof args.confiance === 'number' ? args.confiance : undefined,
            source: { genre: 'carte', ref: branche },
          },
          { auteur: branche, cardId: ctx.cardId },
        );
        return { ok: resultat.ok, text: texteDuResultat(resultat) };
      }

      if (geste === 'changelog') {
        // Un agent d'avant cette consigne envoie encore « texte » seul : il sert de titre, et le refus dit ce qui manque.
        const ajout = ajouterAuChangelog({
          projectId: project.id,
          titre: texte(args.titre) ?? texte(args.texte) ?? texte(args.demande) ?? '',
          explication: texte(args.explication) ?? texte(args.resume) ?? '',
          poids: texte(args.poids) ?? '',
          branche: brancheDeLAgent(ctx),
          cardId: ctx.cardId,
          source: 'agent',
        });
        if (!ajout.ok) return { ok: false, text: `Entrée de changelog refusée : ${ajout.raison}` };
        return { ok: true, text: ajout.ajoutee ? 'Entrée ajoutée au changelog du projet.' : 'L’entrée de cette carte est tenue à jour : rien de doublé.' };
      }

      if (geste === 'brouillon') {
        if (!ctx.cardId) return { ok: false, text: 'Le brouillon appartient à une carte, et ce tour n’en a pas : garde ta note dans ta réponse.' };
        const note = noterAuBrouillon({ cardId: ctx.cardId, projectId: project.id, agentId: ctx.agentId, texte: texte(args.texte) ?? '' });
        if (!note.ok) return { ok: false, text: note.raison };
        return { ok: true, text: `Note gardée au brouillon de la carte (${note.nombre} au total) : effacée à la fermeture de la carte, jamais servie comme mémoire. Promeus ce qui doit durer avec « proposer ».` };
      }

      return { ok: false, text: 'Geste inconnu : chercher, lire, proposer, changelog ou brouillon.' };
    }

    case 'remember': {
      const line = String(args.line ?? '').trim();
      if (!line) return { ok: false, text: 'Ligne vide.' };
      /*
       * UN FAIT D'UNE LIGNE, PAR LA MÊME PORTE. Le type se devine, le titre est ce
       * qui précède « : » ; « replaces » désigne l'unité devenue fausse, qui est
       * dépréciée et reliée ; un doublon met à jour l'unité existante, dont la
       * version d'avant est gardée (`proposerUnite`, `server/src/connaissances.ts`).
       */
      const centrale = String(args.portee ?? '').trim().toLowerCase() === 'centrale';
      const portee = centrale ? PORTEE_GLOBALE : project.id;
      const texte = (valeur: unknown) => (typeof valeur === 'string' && valeur.trim() ? valeur.trim() : undefined);
      const { titre, resume } = titreEtResumeDuFait(line);
      const typeDonne = texte(args.type)?.toLowerCase();
      const type = typeDonne && (TYPES_UNITE as readonly string[]).includes(typeDonne) ? typeDonne : typeDuFait(line);
      const aRemplacer = texte(args.replaces);
      const remplacee = aRemplacer ? uniteARemplacer(portee, aRemplacer) : null;
      const branche = brancheDeLAgent(ctx);
      const resultat = await proposerUniteAvecSens(
        portee,
        { type, importance: texte(args.importance) ?? 'P2', titre, resume, sujets: texte(args.sujet), remplace: remplacee?.id, source: { genre: 'carte', ref: branche } },
        { auteur: branche, cardId: ctx.cardId },
      );
      if (!resultat.ok) return { ok: false, text: `Fait refusé :\n- ${resultat.raisons.join('\n- ')}` };
      const ou = centrale ? ' (GLOBAL)' : '';
      const sansCible = aRemplacer && !remplacee ? ` Aucune unité active ne répondait à « ${aRemplacer} » : rien n'a été déprécié.` : '';
      return { ok: true, text: `${texteDuResultat(resultat)}${ou}${sansCible}` };
    }

    case 'relancer_publication': {
      // Chargé à l'appel : le module passe par le runtime, qui charge ce fichier-ci.
      const { demanderLaRelance } = await import('./depannage-publication.js');
      const issue = demanderLaRelance(ctx.agentId);
      return { ok: issue.ok, text: issue.texte };
    }

    case 'marketing': {
      if (!estAgentMarketing(ctx.agentId)) return { ok: false, text: 'Cet outil est réservé à l’agent marketing du projet.' };
      return outilMarketing(ctx, project, args);
    }

    case 'surveillance_essai': {
      const existante = typeof args.id === 'string' && args.id.trim() ? lireSurveillance(args.id.trim()) : null;
      if (typeof args.id === 'string' && args.id.trim() && !existante)
        return { ok: false, text: `Aucune surveillance ne porte l'identifiant « ${args.id} ».` };
      const adresse = jugerAdresseSurveillance(args.url ?? existante?.url);
      if (!adresse.ok) return { ok: false, text: `Adresse refusée : ${adresse.raison}` };
      let recette = existante?.recette ?? RECETTE_APPEL;
      if (args.recette !== undefined) {
        const avis = jugerRecetteSurveillance(args.recette);
        if (!avis.ok) return { ok: false, text: `Recette refusée : ${avis.raison}. Corrige et rappelle l'outil.` };
        recette = avis.recette;
      }
      const verdict = await jouerRecette(adresse.url, recette);
      return { ok: true, text: `Essai (rien n'est enregistré) — ${phraseDuVerdict(verdict)}` };
    }

    case 'surveillance_recette': {
      /*
       * UNE RECETTE N'EST JUSTE QUE SI ELLE PASSE. Elle est rejouée ici pour de
       * vrai avant d'être gardée ; « forcer » est la porte de sortie d'un site
       * pas encore en ligne, empruntée seulement avec l'accord de l'utilisateur.
       */
      const existante = typeof args.id === 'string' && args.id.trim() ? lireSurveillance(args.id.trim()) : null;
      if (typeof args.id === 'string' && args.id.trim() && !existante)
        return { ok: false, text: `Aucune surveillance ne porte l'identifiant « ${args.id} ».` };
      const adresse = jugerAdresseSurveillance(args.url ?? existante?.url);
      if (!adresse.ok) return { ok: false, text: `Adresse refusée : ${adresse.raison}` };
      let recette = existante?.recette ?? RECETTE_APPEL;
      if (args.recette !== undefined) {
        const avis = jugerRecetteSurveillance(args.recette);
        if (!avis.ok) return { ok: false, text: `Recette refusée : ${avis.raison}. Corrige et rappelle l'outil.` };
        recette = avis.recette;
      }
      const verdict = await jouerRecette(adresse.url, recette);
      if (verdict.etat !== 'ok' && args.forcer !== true) {
        return {
          ok: false,
          text:
            `Surveillance NON enregistrée : l'essai tombe.\n${phraseDuVerdict(verdict)}\n` +
            'Corrige la recette ou l’accès au coffre-fort et rejoue « surveillance_essai », ou demande à l’utilisateur (« ask_user ») ' +
            's’il accepte qu’on l’enregistre quand même — dans ce cas seulement, rappelle « surveillance_recette » avec « forcer ».',
        };
      }
      const periodeMs = typeof args.periodeMinutes === 'number' ? args.periodeMinutes * 60_000 : undefined;
      const resultat = enregistrerSurveillance({
        id: existante?.id,
        url: adresse.url,
        nom: args.nom,
        recette,
        periodeMs,
        agentId: ctx.agentId,
        projectId: ctx.projectId,
        cardId: ctx.cardId,
      });
      if (!resultat.ok) return { ok: false, text: `Surveillance refusée : ${resultat.raison}` };
      const site = resultat.site;
      return {
        ok: true,
        text:
          `${resultat.cree ? 'Surveillance créée' : 'Surveillance modifiée'} : « ${site.nom} » (identifiant ${site.id}), ` +
          `contrôlée ${phraseDePeriodeSurveillance(site.periodeMs ?? 0)}.\nRecette :\n${phraseDeRecetteSurveillance(recette)}\n` +
          `Essai : ${phraseDuVerdict(verdict)}\nLes passages tournent désormais seuls.`,
      };
    }

    case 'backup_recette': {
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
      // La recette se lit à part, et n'est remplacée que si l'agent en donne une.
      const recetteDonnee = !!args.recette && typeof args.recette === 'object';
      const recette = recetteDonnee ? recetteProposee(args.recette) : (ancienne?.recette ?? null);
      if (recetteDonnee) {
        const avis = jugerRecette(recette);
        if (!avis.ok) return { ok: false, text: `Recette refusée : ${avis.raison}. Corrige et rappelle l'outil.` };
      }
      const fiche = { ...ficheProposee(args, ancienne), recette };
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
            'Corrige cet accès puis rappelle « backup_essai », ou demande à l’utilisateur (« ask_user ») ' +
            's’il accepte qu’on enregistre quand même — dans ce cas seulement, rappelle « backup_recette » avec « forcer ».',
        };
      }

      /*
       * UNE RECETTE N'EST JUSTE QUE SI ELLE DONNE UNE ARCHIVE. Elle est
       * REJOUÉE ici pour de vrai (rien n'est gardé) : c'est l'archive relue, pas
       * la parole de l'agent, qui décide qu'elle marche. Une archive partielle
       * ou vide est refusée — sauf accord explicite, porté par « forcer ».
       */
      const essai = await essayerLaRecette(fiche, recetteEffective(fiche));
      const inventaire = essai.inventaire ? phraseDInventaire(essai.inventaire) : `- ${essai.detail}`;
      if (essai.statut !== 'reussi' && args.forcer !== true) {
        return {
          ok: false,
          text:
            `Fiche NON enregistrée : la recette donne ${PHRASE_D_ISSUE[essai.statut]}.\n${inventaire}\n` +
            'Corrige la recette et rejoue-la avec « backup_essai », ou demande à l’utilisateur (« ask_user ») ' +
            's’il accepte qu’on enregistre quand même — dans ce cas seulement, rappelle « backup_recette » avec « forcer ».',
        };
      }

      // La CONVERSATION qui a posé la fiche est retenue : la fenêtre des
      // backups la rouvre d'un clic, avec ses questions et son compte rendu.
      const resultat = enregistrerSite({
        ...fiche,
        recetteValideeLe: essai.statut === 'reussi' ? Date.now() : 0,
        recetteAgentId: recetteDonnee ? ctx.agentId : (ancienne?.recetteAgentId ?? ''),
        assistantId: ctx.agentId,
        assistantProjectId: ctx.projectId,
        assistantCardId: ctx.cardId ?? '',
      });
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
          `Repris ${phraseDeCadence(site.frequenceMinutes)}, gardé ${site.conservationJours} jours` +
          (morceaux.length ? ` — fiche : ${morceaux.join(' et ')}.` : '.') +
          `\nRecette ${site.recette ? 'écrite par l’agent' : 'déduite de la fiche'} :\n${phraseDeRecette(recetteEffective(site))}\n` +
          `Essai de la recette : ${PHRASE_D_ISSUE[essai.statut]}, ${formaterOctets(essai.taille)} en ${Math.round(essai.dureeMs / 1000)} s.\n${inventaire}\n` +
          `Essai des accès :\n${phraseDesEssais(essais)}\n` +
          'Le passage automatique la rejouera tout seul.',
      };
    }

    case 'backup_essai': {
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

      // UNE RECETTE SE JUGE À SON ARCHIVE : jouée, écrite, relue, puis jetée.
      if ((args.recette && typeof args.recette === 'object') || args.rejouer === true) {
        const recette =
          args.recette && typeof args.recette === 'object' ? recetteProposee(args.recette) : recetteEffective(aEssayer);
        const avis = jugerRecette(recette);
        if (!avis.ok) return { ok: false, text: `Recette refusée : ${avis.raison}. Corrige et rappelle l'outil.` };
        const essai = await essayerLaRecette({ ...aEssayer, recette }, recette);
        return {
          ok: true,
          text:
            `La recette donne ${PHRASE_D_ISSUE[essai.statut]} — ${formaterOctets(essai.taille)} en ${Math.round(
              essai.dureeMs / 1000,
            )} s, rien n'a été gardé.\n` +
            (essai.inventaire ? phraseDInventaire(essai.inventaire) : `- ${essai.detail}`),
        };
      }

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

    case 'coffre_fort': {
      const action = String(args.action ?? '').trim();

      /*
       * LE COFFRE EST CENTRAL, ET IL L'EST POUR TOUT LE MONDE : un agent voit
       * et relit TOUTES les fiches, quel que soit le projet où elles sont
       * rangées. Le cloisonnement d'avant faisait dire « je n'ai pas accès » à
       * un agent alors que l'identifiant était là, rangé sous un autre projet —
       * et le tiroir humain, lui, l'a toujours montré. Le projet d'une fiche
       * n'est donc plus une barrière : c'est une ÉTIQUETTE, dite sur sa ligne.
       */
      const nomDuProjet = (id: string | null) => (id ? store.getProject(id)?.name : undefined);

      if (action === 'lister' || action === 'archives') {
        const archives = action === 'archives';
        const tout = archives ? listerArchives() : listerAcces();
        const recherche = typeof args.recherche === 'string' ? args.recherche.trim() : '';
        const filtres = recherche ? filtrerAcces(tout, recherche, nomDuProjet) : tout;
        if (!filtres.length) {
          if (archives) return { ok: true, text: recherche ? `Aucune archive ne correspond à « ${recherche} ».` : 'Aucune fiche archivée.' };
          return { ok: true, text: recherche ? `Aucun accès ne correspond à « ${recherche} ».` : 'Le coffre-fort est vide.' };
        }
        const lignes = filtres.map((a) => {
          const valeurs = champsDuType(a.type)
            .map((c) => (a.champs[c.cle] ? `${c.libelle} : ${a.champs[c.cle]}` : null))
            .filter(Boolean)
            .join(' · ');
          const portee = a.projectId
            ? ` · projet ${nomDuProjet(a.projectId) ?? a.projectId}`
            : ' · partagé Beluga Build';
          const echeance = echeanceArchive(a);
          const archive = echeance ? ` · archivée, effacée le ${new Date(echeance).toISOString().slice(0, 10)}` : '';
          return `- [${a.id}] ${a.nom} (${LIBELLE_TYPE_ACCES[a.type]}${portee}${archive})${a.note ? ` — ${a.note}` : ''}\n  ${valeurs}`;
        });
        return { ok: true, text: lignes.join('\n') };
      }

      if (action === 'enregistrer') {
        const id = typeof args.id === 'string' ? args.id.trim() : '';
        let existante: { projectId: string | null } | undefined;
        if (id) {
          existante = listerAcces().find((a) => a.id === id);
          if (!existante) return { ok: false, text: `Aucun accès du coffre-fort ne porte l'identifiant « ${id} ».` };
        }
        /*
         * Une fiche CORRIGÉE reste rangée là où elle était : corriger un
         * identifiant depuis un autre projet ne le déménage pas. Une fiche
         * NEUVE, elle, se rattache au projet en cours — c'est de là qu'elle
         * vient, et tout le monde la lira de toute façon.
         */
        const projectId = existante ? existante.projectId : ctx.projectId;
        const resultat = enregistrerAcces({
          id,
          nom: args.nom,
          type: args.type,
          projectId,
          champs: args.champs,
          note: args.note,
        });
        // « Accès refusé » disait une porte fermée pour un simple champ manquant
        // — exactement ce qu'un agent ne doit jamais croire ni répéter.
        if (!resultat.ok) {
          return { ok: false, text: `Enregistrement impossible : ${resultat.raison.replace(/\.$/, '')}. Corrige et rappelle l'outil.` };
        }
        const ou = resultat.acces.projectId
          ? `du projet « ${nomDuProjet(resultat.acces.projectId) ?? resultat.acces.projectId} »`
          : 'partagé de Beluga Build';
        return {
          ok: true,
          text: `Accès « ${resultat.acces.nom} » (${LIBELLE_TYPE_ACCES[resultat.acces.type]}) ${id ? 'corrigé' : 'enregistré'} dans le coffre-fort ${ou}.`,
        };
      }

      if (action === 'supprimer') {
        const id = typeof args.id === 'string' ? args.id.trim() : '';
        if (!id) return { ok: false, text: "Donne l'« id » de la fiche à supprimer." };
        const existante = listerAcces().find((a) => a.id === id);
        if (!existante) return { ok: false, text: `Aucun accès du coffre-fort ne porte l'identifiant « ${id} ».` };
        const resultat = supprimerAcces(id);
        if (!resultat.ok) return { ok: false, text: `Suppression refusée : ${resultat.raison}` };
        return { ok: true, text: `Accès « ${existante.nom} » archivé : il quitte le coffre actif et sera effacé pour de bon dans six mois, sauf restauration.` };
      }

      if (action === 'restaurer') {
        const id = typeof args.id === 'string' ? args.id.trim() : '';
        if (!id) return { ok: false, text: "Donne l'« id » de la fiche archivée à restaurer." };
        const archivee = listerArchives().find((a) => a.id === id);
        if (!archivee) return { ok: false, text: `Aucune fiche archivée ne porte l'identifiant « ${id} ».` };
        const resultat = restaurerAcces(id);
        if (!resultat.ok) return { ok: false, text: `Restauration refusée : ${resultat.raison}` };
        return { ok: true, text: `Accès « ${archivee.nom} » restauré dans le coffre-fort.` };
      }

      return { ok: false, text: 'Action inconnue : « lister », « enregistrer », « supprimer », « archives » ou « restaurer ».' };
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
    /**
     * QUI POSE LA CARTE. Une carte sans demande rédigée en reçoit une, composée
     * depuis son titre et sa description, qui nomme cet auteur
     * (`demandeDeNaissance`, MEM-3555). Sans lui, l'origine tranche.
     */
    auteur?: AuteurDeCarte;
    /** Heure de départ souhaitée : la carte partira toute seule ce moment venu. */
    departPrevu?: number;
    /**
     * LA CARTE OUVRE UN CADRAGE : ELLE N'ANNONCE AUCUN DÉPART.
     *
     * Le « + » de « Planifié » crée une carte vide dont on va DISCUTER le
     * besoin. Lui poser d'office le créneau conseillé — donc une vraie date de
     * départ — affichait « Départ programmé demain à 03:00 » sur une carte dont
     * on n'avait pas encore écrit la première phrase, et l'aurait fait partir
     * toute seule au milieu de la nuit, sans plan. Le créneau se pose plus
     * tard, quand le cadrage est clos (`rendre_plan`).
     */
    cadrage?: boolean;
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
  const creneauConseille =
    input.departPrevu || input.cadrage
      ? undefined
      : creneauPourUneCarte({ moteur, ampleurSecondes: input.estimate?.machineSeconds });
  /*
   * LE CONSEIL RESTE UN CONSEIL. Le créneau s'affiche comme heure conseillée ;
   * seule une date DONNÉE (geste de l'utilisateur, ou demande explicite
   * `departPrevu`) devient un départ. Aucune carte ne part plus toute seule à
   * une heure calculée (demande du 14.09.2026).
   */
  const departPrevu = input.departPrevu;
  const card = Card.parse({
    id: store.newId(),
    projectId,
    title: input.title.slice(0, MAX_SIGNES_TITRE),
    description: input.description ?? '',
    labels: input.labels ?? [],
    attachments: input.attachments ?? [],
    estimate: input.estimate,
    analysisContext: input.analysisContext,
    /*
     * TOUTE CARTE NAÎT AVEC SA DEMANDE (MEM-3555). Une carte posée par un agent
     * ou avec une description ouvre sa conversation sur une demande lisible —
     * celle rédigée par son auteur, sinon une composée ici. Seule la carte vide
     * du « + » n'en a pas : le premier message de l'utilisateur la sera.
     */
    briefing: demandeDeNaissance(
      { title: input.title, description: input.description, briefing: input.briefing, origin: input.origin },
      input.auteur,
    ),
    origineAgentId: input.origineAgentId,
    origineAt: input.origineAt,
    // Le champ « colonne » est ignoré à la création : invariant 1. Une carte
    // naît dans « Demande » — il n'y a plus de colonne d'attente avant elle.
    // Naître là ne fait rien démarrer : le lancement reste un geste humain.
    column: 'planned' as ColumnKey,
    position: store.nextPosition(projectId, 'planned'),
    origin: input.origin ?? 'user',
    run: {
      engine: moteur,
      model: input.run?.model ?? project?.defaultModel,
      thinking: input.run?.thinking ?? project?.defaultThinking ?? 'none',
      account: input.run?.account ?? project?.defaultAccount,
    },
    scheduling: {
      asap: false,
      attempts: 0,
      restarts: 0,
      departPrevu,
      ...(creneauConseille ? { creneauConseille } : {}),
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

/**
 * Les outils du démon autorisés à l'agent de cadrage, préfixés pour le CLI.
 *
 * LA LISTE EST TOUJOURS COMPLÈTE. Elle retirait les outils de terrain tant que
 * la mémoire n'était pas ouverte : le modèle les appelait quand même, en rouge,
 * et la liste restait figée tout le tour. L'ordre du travail est tenu par le
 * verrou d'analyse, demandé au démon À L'APPEL (`hooksDuVerrouDAnalyse`) ; la
 * liste, elle, ne dit que la frontière du rôle.
 */
export function cadrageAllowList(): string[] {
  return [
    ...CADRAGE_ALLOWED_NATIVE,
    // Les outils du mode Création y figurent toujours : le pont ne les SERT
    // qu'à une carte où il est allumé, la liste blanche n'a donc rien à trier.
    ...toolsFor('cadrage', { creation: true }).map((t) => `mcp__beluga__${t.name}`),
  ];
}

export function cadrageDenyList(): string[] {
  return [...CADRAGE_DENIED_NATIVE, ...[...CADRAGE_BLOCKED_TOOLS].map((t) => `mcp__beluga__${t}`)];
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
      beluga: {
        command: process.execPath,
        args: [bridgePath],
        env: { BELUGA_TOKEN: token, BELUGA_URL: url, BELUGA_AGENT: agentId, BELUGA_TOUR: tourId },
      },
    },
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
  log.debug(`configuration d'outils écrite pour l'agent ${agentId}`);
}


/* ------------------------------------------------------------------ */
/* L'outil de l'agent marketing                                        */
/* ------------------------------------------------------------------ */

function centimes(n: number | null | undefined): string {
  return typeof n === 'number' ? `${(n / 100).toFixed(2)}` : '—';
}

/**
 * LES CINQ GESTES DE L'AGENT MARKETING (`shared/src/marketing.ts`). Chaque
 * réponse se lit comme une phrase : c'est l'agent qui la reçoit. L'interdit
 * « l'agent ne valide ni ne publie » est tenu ICI, pas dans sa consigne.
 */
function outilMarketing(ctx: ToolContext, project: Project, args: Record<string, any>): ToolResult | Promise<ToolResult> {
  const action = String(args.action ?? '');
  const espace = assurerEspace(project.id);
  switch (action) {
    case 'lire': {
      const contenus = listerContenus(project.id);
      const actions = listerActionsMarketing(project.id);
      const r = resultatsDuProjet(project.id, 30);
      const parContenu = new Map(r.parContenu.map((l) => [l.contenuId, l]));
      return {
        ok: true,
        text: [
          `CONFIGURATION : ${JSON.stringify(espace.configuration)}`,
          `FICHE : ${JSON.stringify(espace.fiche)}`,
          espace.rapport ? `RAPPORT ACTUEL :\n${espace.rapport}` : 'RAPPORT : aucun pour l’instant.',
          `AVIS SUR LES CANAUX : ${espace.configuration.recommandations.length ? espace.configuration.recommandations.map((r) => `${r.canal} ${r.pertinence}`).join(', ') : 'aucun pour l’instant'} · CHOISIS : ${espace.configuration.canaux.join(', ') || 'aucun'}`,
          `PLAN D'ACTION (${actions.length}) :`,
          ...actions.slice(0, 40).map((a) => `- [${a.id}] ${a.datePrevue ?? 'sans date'}${a.canal ? ` · ${a.canal}` : ''} · « ${a.titre} »${a.faitLe ? ' · FAIT' : ''}`),
          `CONTENUS (${contenus.length}) :`,
          ...contenus.slice(0, 40).map((c) => {
            const l = parContenu.get(c.id);
            return `- [${c.id}] ${c.etape} · ${c.genre} · ${c.canal}${c.datePrevue ? ` · ${c.datePrevue}` : ''} · « ${c.titre} »${c.varianteDe ? ` (version B de ${c.varianteDe})` : ''}${
              l ? ` — ${l.visites} clic(s), ${l.objectifs} objectif(s), ${l.ventes} vente(s), ${centimes(l.montantCentimes)}` : ''
            }`;
          }),
          contenus.length > 40 ? `(${contenus.length - 40} contenu(s) plus ancien(s) non listé(s))` : '',
          `RÉSULTATS DES 30 DERNIERS JOURS : ${JSON.stringify(r.totaux)}`,
          `SOURCES : ${r.sources.map((x) => `${x.source} ${x.visites}`).join(', ') || 'aucune visite'}`,
          `PAGES : ${r.pages.map((x) => `${x.chemin} ${x.vues}`).join(', ') || '—'}`,
        ]
          .filter(Boolean)
          .join('\n'),
      };
    }
    case 'configurer': {
      if (!args.configuration || typeof args.configuration !== 'object') return { ok: false, text: 'Donne « configuration ».' };
      const e = ecrireConfiguration(project.id, args.configuration);
      return { ok: true, text: `Configuration enregistrée : ${JSON.stringify(e.configuration)}` };
    }
    case 'fiche': {
      if (!args.fiche || typeof args.fiche !== 'object') return { ok: false, text: 'Donne « fiche ».' };
      const e = ecrireFiche(project.id, args.fiche);
      return { ok: true, text: `Fiche enregistrée : ${JSON.stringify(e.fiche)}` };
    }
    case 'canaux': {
      if (!Array.isArray(args.recommandations) && !Array.isArray(args.choisis)) return { ok: false, text: 'Donne « recommandations » (et « choisis »).' };
      const e = ecrireConfiguration(project.id, {
        ...(Array.isArray(args.recommandations) ? { recommandations: args.recommandations } : {}),
        ...(Array.isArray(args.choisis) ? { canaux: args.choisis } : {}),
      });
      const c = e.configuration;
      return { ok: true, text: `Avis enregistrés sur ${c.recommandations.length} canal(aux). Canaux choisis : ${c.canaux.join(', ') || 'aucun'}.` };
    }
    case 'action': {
      if (args.supprimer === true) {
        const r = supprimerActionMarketing(String(args.id ?? ''), project.id);
        return r.ok ? { ok: true, text: `Action ${args.id} retirée du plan.` } : { ok: false, text: r.raison ?? 'action introuvable' };
      }
      const r = ecrireActionMarketing(project.id, args);
      if (!r.ok) return { ok: false, text: r.raison };
      return { ok: true, text: `Action ${args.id ? 'corrigée' : 'posée'} : ${r.action.id} · ${r.action.datePrevue ?? 'sans date'} · « ${r.action.titre} ». Elle paraît dans le calendrier.` };
    }
    case 'contenu': {
      if (typeof args.id === 'string' && args.id) {
        const r = modifierContenu(args.id, args, 'agent', project.id);
        if (!r.ok) return { ok: false, text: r.raison };
        if (args.etape === 'brouillon' || args.etape === 'a_valider') {
          const e = changerEtapeMarketing(args.id, args.etape, 'agent', project.id);
          if (!e.ok) return { ok: false, text: e.raison };
        }
        return { ok: true, text: `Contenu ${args.id} modifié (${lireContenu(args.id)?.etape}).` };
      }
      const r = creerContenu({
        projectId: project.id,
        genre: args.genre,
        canal: args.canal,
        titre: args.titre,
        texte: args.texte,
        datePrevue: args.datePrevue,
        etape: args.etape,
        varianteDe: args.varianteDe,
        lienCible: args.lienCible,
        origine: 'agent',
      });
      if (!r.ok) return { ok: false, text: r.raison };
      return {
        ok: true,
        text: `Contenu créé : ${r.contenu.id} (${r.contenu.etape}). Son lien de suivi : ${adresseDeBeluga()}/m/l/${r.contenu.lienCode} — à utiliser dans le texte à la place de l'adresse du site.`,
      };
    }
    case 'poser_suivi':
      return poserLeSuivi(ctx, project, espace);
    case 'rapport': {
      const r = ecrireRapportMarketing(project.id, args.rapport);
      if (!r.ok) return { ok: false, text: r.raison };
      return { ok: true, text: 'Rapport enregistré. Rends-le ENTIER comme réponse finale : l’utilisateur le lit dans ta conversation et te répond dessous.' };
    }
    default:
      return { ok: false, text: `Action inconnue : « ${action} ». Choisis lire, configurer, fiche, canaux, action, contenu, poser_suivi ou rapport.` };
  }
}

async function poserLeSuivi(ctx: ToolContext, project: Project, espace: ReturnType<typeof assurerEspace>): Promise<ToolResult> {
  const config = espace.configuration;
  if (!config.methodeSuivi) return { ok: false, text: 'Choisis d’abord la méthode (« configurer » avec methodeSuivi : carte-code, plateforme ou manuel).' };
  if (!config.origines.length) return { ok: false, text: 'Aucune adresse déclarée : « configurer » avec « adresse » (ou « origines ») d’abord — le script refuse les sites non déclarés.' };
  const extrait = extraitDeSuivi(adresseDeBeluga(), espace.cleSuivi);
  const confidentialite = phraseDeConfidentialite(config.langue, project.name);
  const commun = [
    `EXTRAIT À POSER dans le <head> de chaque page : ${extrait}`,
    `OBJECTIFS ET ACHATS :\n${modeDEmploiDuSuivi()}`,
    `PHRASE À AJOUTER À LA PAGE « CONFIDENTIALITÉ » (transmets-la à l'utilisateur) :\n${confidentialite}`,
  ];
  if (config.methodeSuivi === 'carte-code') {
    /*
     * LA CARTE DU SUIVI SUIT LE PARCOURS COMMUN (MEM-3555). Posée par un simple
     * `createCard`, elle s'ouvrait sur une conversation VIDE — ni demande, ni
     * cadrage (capture du 26.09.2026). Elle naît désormais avec sa demande,
     * son agent de cadrage et un premier tour jusqu'à la compréhension.
     */
    const { faireNaitreLaCarte } = await import('./naissance-de-carte.js');
    const { card } = await faireNaitreLaCarte(project.id, {
      auteur: 'marketing',
      origineAgentId: ctx.agentId,
      origineAt: Date.now(),
      title: 'Installer le suivi marketing anonyme',
      description: [
        'Ajouter le script de suivi de l’atelier marketing à toutes les pages du produit, sans rien changer d’autre.',
        '',
        ...commun,
        '',
        `Objectifs à déclarer : ${config.objectifs.join(', ') || 'aucun pour l’instant'}.`,
        'Le script est anonyme et sans cookie : aucun bandeau de consentement à ajouter pour lui.',
      ].join('\n'),
      labels: [LABEL_MARKETING],
      origin: 'agent',
    });
    marquerSuiviPose(project.id);
    return {
      ok: true,
      text: `Carte « ${card.title} » posée dans « Planifié » du projet : l'utilisateur la relit et la lance. Le suivi sera confirmé à la première visite reçue.\n\n${commun[2]}`,
    };
  }
  marquerSuiviPose(project.id);
  return {
    ok: true,
    text: [
      config.methodeSuivi === 'plateforme'
        ? 'SUR LA PLATEFORME : annonce le geste à l’utilisateur et demande son accord (« ask_user ») AVANT de toucher à son administration ; accès au coffre-fort (« lister » d’abord). Sinon, donne-lui la marche à suivre ci-dessous.'
        : 'MARCHE À SUIVRE à donner à l’utilisateur, pas à pas, avec l’extrait ci-dessous.',
      ...commun,
      'Le suivi sera confirmé tout seul à la première visite reçue.',
    ].join('\n\n'),
  };
}
