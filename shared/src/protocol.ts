import { z } from 'zod';
import { ColumnKey } from './columns.js';
import {
  ActiviteDemande,
  ColonneDemande,
  Demande,
  ImportanceDemande,
  MessageDemande,
  MessageFil,
  TacheDemande,
} from './espace-client.js';
import { NotificationEspace } from './espace-notifications.js';
import { ConnexionCompte } from './connexion-compte.js';
import { ETAPES_DE_L_ASSISTANT, EtatDesNouveautes, GENRES_DE_SECRET, TravailDInstallation } from './installation.js';
import { FicheMoteurZ } from './moteurs-ajoutes.js';
import { EntreeJournal } from './journal-carte.js';
import { LigneDuCarnet } from './carnet-memoire.js';
import { RUBRIQUES_DU_RESUME } from './resume.js';
import { MediaEnFabrication } from './media-en-fabrication.js';
import { MAX_CLES_DE_CAPTURES, MAX_SIGNES_DE_CLE_DE_CAPTURE } from './captures-du-flux.js';
import {
  Agent,
  AccountQuota,
  EngineId,
  ProjectGroup,
  Attachment,
  Card,
  CapacityEtat,
  DeployRun,
  EngineInfo,
  FileNode,
  Message,
  Project,
  QueuedPrompt,
  RunConfig,
  Settings,
  SystemProcess,
} from './models.js';

/**
 * Version du protocole. RÈGLE (PLAN §30) : on n'ajoute JAMAIS un champ
 * obligatoire — uniquement des champs optionnels, pour qu'un navigateur ouvert
 * depuis trois jours continue de fonctionner.
 */
/*
 * 2 → 3 : l'événement `prefs` peut ne porter QU'UNE PART des réglages
 * (`partiel`). Un écran resté sur la version 2 y verrait son bloc entier
 * remplacé par une clé : il se recharge donc une fois, comme pour le passage
 * 1 → 2 (`doitRechargerPourLeProtocole`).
 */
export const PROTOCOL_VERSION = 3;

/**
 * UN ÉCRAN RESTÉ OUVERT SUR UN AUTRE PROTOCOLE SE RECHARGE, UNE FOIS. La règle
 * ci-dessus tient pour un champ ajouté ; elle ne tient pas pour un message
 * RENOMMÉ (le passage 1 → 2 a donné le nom `*.etat` aux messages d'état d'un
 * agent, d'un projet et d'une file) : l'ancien écran ne reconnaîtrait plus rien et
 * resterait figé. Il se recharge donc dès que le démon annonce un autre
 * numéro — mais UNE seule fois par numéro, pour qu'un habillage encore servi
 * par un cache ne tourne pas en boucle de rechargements.
 */
export function doitRechargerPourLeProtocole(entree: {
  serveur: number | undefined;
  client: number;
  dejaRechargePour: string | null;
}): boolean {
  if (typeof entree.serveur !== 'number' || entree.serveur === entree.client) return false;
  return entree.dejaRechargePour !== String(entree.serveur);
}

/* ------------------------------------------------------------------ */
/* Le pool de compétences, tel qu'il s'affiche                          */
/* ------------------------------------------------------------------ */

/**
 * UNE FICHE, VUE DE L'ÉCRAN. On y met ce qui se DÉCIDE et ce qui se JUGE — état,
 * confiance, usage, provenance, anomalies —, jamais le texte du mode d'emploi :
 * l'écran des réglages liste le pool, il ne le lit pas à la place des agents.
 */
export const FicheDuPool = z.object({
  nom: z.string(),
  description: z.string(),
  etat: z.enum(['active', 'depreciee', 'archivee']),
  themes: z.array(z.string()).default([]),
  symptomes: z.array(z.string()).default([]),
  projets: z.array(z.string()).default([]),
  /** Les fichiers de DÉTAIL, sous la tête : c'est l'arbre. */
  annexes: z.array(z.string()).default([]),
  /** Ce qui cloche sans l'écarter du pool. */
  anomalies: z.array(z.string()).default([]),
  confiance: z.number(),
  servie: z.number().default(0),
  aidee: z.number().default(0),
  inutile: z.number().default(0),
  contredite: z.number().default(0),
  dernierService: z.number().optional(),
  provenanceProjet: z.string().optional(),
  provenanceCarte: z.string().optional(),
  renforceePar: z.array(z.string()).default([]),
  creeeLe: z.number().optional(),
  /** La dernière modification du MODE D'EMPLOI (histoire git du pool), jamais
   *  celle des compteurs d'usage. */
  misAJourLe: z.number().optional(),
});
export type FicheDuPool = z.infer<typeof FicheDuPool>;

export const EtatDuPool = z.object({
  fiches: z.array(FicheDuPool).default([]),
  /** Ce qui a été écarté du pool, avec sa raison en clair. */
  refus: z.array(z.object({ nom: z.string(), raison: z.string() })).default([]),
  /** Le dossier du pool, pour savoir où aller le lire. */
  dossier: z.string().default(''),
  /** Le pool est-il sous git — donc sauvegardé ? */
  versionne: z.boolean().default(false),
});
export type EtatDuPool = z.infer<typeof EtatDuPool>;

/** Une liste de clés d'images de la bande « Ce que l'agent a vu », bornée. */
const ClesDeCaptures = z.array(z.string().min(1).max(MAX_SIGNES_DE_CLE_DE_CAPTURE)).max(MAX_CLES_DE_CAPTURES);

/* ------------------------------------------------------------------ */
/* Client → serveur                                                    */
/* ------------------------------------------------------------------ */

export const ClientCommand = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), protocol: z.number().optional() }),
  z.object({ type: z.literal('ping') }),
  /**
   * LES RÉPONSES PERDUES PENDANT UNE COUPURE (`shared/src/accuses-orphelins.ts`) :
   * l'écran qui se reconnecte redemande celles qu'il attend encore.
   */
  z.object({ type: z.literal('acks.reclamer'), ids: z.array(z.string().max(80)).max(200) }),
  /**
   * CE QUE CET ÉCRAN REGARDE, EN PLUS DE SON PROJET (`shared/src/perimetre-ecran.ts`).
   * Le serveur déduit déjà le périmètre des demandes de l'écran (`project.open`,
   * `agent.open`, `card.conversation`, `card.journal`) ; cette commande le
   * REDIT sans rien redemander — après une reconnexion, où le serveur a tout
   * oublié, ou pour une conversation déjà chargée qu'on rouvre.
   */
  z.object({
    type: z.literal('ecran.perimetre'),
    agents: z.array(z.string()).optional(),
    cartes: z.array(z.string()).optional(),
  }),

  // Projets
  z.object({ type: z.literal('project.list'), includeArchived: z.boolean().optional() }),
  z.object({
    type: z.literal('project.create'),
    name: z.string(),
    path: z.string(),
    gitRemote: z.string().optional(),
    defaultEngine: z.string().optional(),
    devUrl: z.string().optional(),
  }),
  z.object({ type: z.literal('project.update'), id: z.string(), patch: z.record(z.any()) }),
  z.object({ type: z.literal('project.delete'), id: z.string() }),
  /**
   * CE QUI PARTIRAIT avec la suppression définitive d'un projet : nombres réels,
   * dépôt GitHub visé, et la raison d'un refus éventuel. Ne touche à rien.
   */
  z.object({ type: z.literal('project.apercuSuppression'), id: z.string() }),
  /**
   * LA SUPPRESSION DÉFINITIVE : dépôt GitHub, dossier du serveur, projet et tout
   * ce qui s'y rattache. `nomConfirme` doit valoir EXACTEMENT le nom du projet.
   * Distincte de `project.delete`, qui ne fait que mettre de côté.
   */
  z.object({ type: z.literal('project.supprimerDefinitivement'), id: z.string(), nomConfirme: z.string() }),
  /**
   * LES PROJETS RÉUNIS (`shared/src/regroupements.ts`), depuis la rubrique
   * « Projets » des réglages : réunir sous un nom commun, renommer, compléter,
   * retirer un membre, séparer. Aucun dossier n'est touché.
   */
  z.object({ type: z.literal('regroupement.creer'), nom: z.string(), membres: z.array(z.string()) }),
  z.object({ type: z.literal('regroupement.renommer'), id: z.string(), nom: z.string() }),
  z.object({ type: z.literal('regroupement.ajouter'), id: z.string(), membres: z.array(z.string()) }),
  z.object({ type: z.literal('regroupement.retirer'), id: z.string(), projectId: z.string() }),
  z.object({ type: z.literal('regroupement.separer'), id: z.string() }),
  /** Met un projet de côté sans rien perdre : son tableau et son historique restent. */
  z.object({ type: z.literal('project.archive'), id: z.string(), archived: z.boolean() }),
  z.object({ type: z.literal('project.open'), id: z.string() }),
  /**
   * RELIRE LES TABLEAUX DÉJÀ EN MÉMOIRE AU RETOUR DU LIEN. `project.open` diffuse
   * l'instantané à TOUS les écrans ; ici la réponse n'est que pour le demandeur
   * (un `project.etat` par projet, dans `projets`), sans rien diffuser.
   */
  z.object({ type: z.literal('projects.relire'), ids: z.array(z.string()).min(1).max(20) }),
  /**
   * LA TRANCHE SUIVANTE D'UNE COLONNE (`shared/src/tranches-de-cartes.ts`).
   * L'instantané d'un projet ne descend qu'un paquet par colonne avec le total
   * réel ; le tableau demande la suite quand le défilement approche du bas,
   * sous la position la plus basse qu'il a reçue. La réponse porte les cartes,
   * les agents qui les portent, et le total à jour.
   */
  z.object({
    type: z.literal('cards.tranche'),
    projectId: z.string(),
    column: ColumnKey,
    avantPosition: z.number().optional(),
    limit: z.number().int().positive().max(200).optional(),
  }),
  /**
   * LA PAGE « EN ROUTE » (`shared/src/en-route.ts`) : les cartes de TOUS les
   * projets en service d'une de ses trois colonnes (`onglet`), la dernière
   * action d'abord, par paquet. `apres` est la clé de la dernière
   * carte reçue (`curseurApres`) : absent, c'est le premier paquet. Réponse
   * directe : les cartes, les agents qui les portent, et combien il en reste
   * sous la dernière envoyée.
   */
  z.object({
    type: z.literal('cards.enRoute'),
    apres: z.object({ updatedAt: z.number(), id: z.string() }).optional(),
    limit: z.number().int().positive().max(200).optional(),
    /**
     * La colonne demandée (`OngletEnRoute`) : « Actifs » (défaut), « Terminer »
     * (tout ce qui est fini, pas encore rangé sur la page) ou « Archiver »
     * (rangé sur la page par l'utilisateur).
     */
    onglet: z.enum(['actif', 'terminer', 'archive']).optional(),
  }),
  /**
   * L'ANCIENNE COLONNE « TERMINÉS », gardée pour un écran resté ouvert sur la
   * version d'avant : le démon y répond par « Archiver » (`onglet: 'archive'`).
   */
  z.object({
    type: z.literal('cards.deployees'),
    apres: z.object({ updatedAt: z.number(), id: z.string() }).optional(),
    limit: z.number().int().positive().max(200).optional(),
  }),
  /**
   * Les branches du dépôt GitHub de ce projet, pour les proposer au choix dans
   * ses réglages. Lecture seule : rien n'est créé ni changé sur le dépôt.
   */
  z.object({ type: z.literal('project.branches'), id: z.string() }),
  z.object({ type: z.literal('project.scan') }),
  /**
   * Relance à la main la récupération de l'icône de site (`server/src/favicon.ts`) :
   * bouton « réessayer » des réglages, pour un site dont le logo a changé ou
   * qui ne répondait pas encore à la dernière tentative.
   */
  z.object({ type: z.literal('project.faviconRetry'), id: z.string() }),
  /**
   * LES COPIES DE TRAVAIL MORTES d'un projet : les dossiers sous `.worktrees/`
   * que `git worktree list` ne nomme plus (`shared/src/copies-mortes.ts`).
   * Lecture seule : rien n'est effacé. Rend `{ racine, copies }`.
   */
  z.object({ type: z.literal('projet.copiesMortes'), projectId: z.string() }),
  /**
   * EFFACER des copies mortes, par une liste EXPLICITE de chemins — ceux que
   * `projet.copiesMortes` a rendus. Tout chemin qui n'est pas posé directement
   * sous le dossier des copies du projet est refusé (`cheminNettoyable`), une
   * copie encore inscrite dans git aussi. Un `git worktree prune` suit.
   * Rend `{ effacees, refusees }`.
   */
  z.object({ type: z.literal('projet.nettoyerCopies'), projectId: z.string(), chemins: z.array(z.string()) }),
  z.object({ type: z.literal('group.create'), name: z.string() }),
  z.object({
    type: z.literal('group.update'),
    id: z.string(),
    name: z.string().optional(),
    collapsed: z.boolean().optional(),
    color: z.string().optional(),
  }),
  z.object({ type: z.literal('group.delete'), id: z.string() }),
  /**
   * Range la colonne de gauche d'un bloc : projets hors groupe et groupes
   * partagent le même classement, un projet peut donc passer au-dessus d'un
   * groupe et inversement.
   */
  z.object({
    type: z.literal('sidebar.reorder'),
    items: z.array(z.object({ kind: z.enum(['project', 'group']), id: z.string(), groupId: z.string().optional() })),
  }),
  /**
   * Monte un projet NEUF de bout en bout : dossier sur le serveur, dépôt git
   * sur « main », dépôt GitHub, fichiers d'instructions, mémoire et
   * documentation, l'adresse publique quand elle est demandée, puis
   * inscription dans la colonne de gauche.
   */
  z.object({
    type: z.literal('project.new'),
    name: z.string(),
    folder: z.string().optional(),
    description: z.string().optional(),
    git: z.boolean().optional(),
    gitRemote: z.string().optional(),
    github: z.boolean().optional(),
    githubPublic: z.boolean().optional(),
    /** Le nom court de l'adresse publique. Vide : le projet naît sans adresse. */
    sousDomaine: z.string().optional(),
    /** Le port sur lequel le projet écoute sur le serveur. */
    port: z.number().optional(),
    /**
     * « Démarrer par un cahier des charges » : une carte naît au montage et son
     * agent pose les questions (`shared/src/cahier-des-charges.ts`).
     */
    cahierDesCharges: z.boolean().optional(),
    /**
     * LA SOURCE À CLONER, telle que tapée : un lien ou le nom d'un produit
     * (`shared/src/clonage.ts`). Remplie, elle coche le cahier des charges.
     */
    source: z.string().optional(),
  }),
  /**
   * Les dépôts du compte GitHub connecté au serveur, pour en choisir un dans la
   * fenêtre « Projets du serveur ». Lecture seule : rien n'est cloné ici.
   */
  z.object({ type: z.literal('github.depots') }),
  /**
   * Monte un projet À PARTIR D'UN DÉPÔT GITHUB qui existe déjà : le dépôt est
   * récupéré sur le serveur, l'adresse publique demandée est créée, puis le
   * projet est inscrit dans la colonne de gauche. Rien n'est publié.
   */
  z.object({
    type: z.literal('project.fromGithub'),
    /** Le lien collé, ou « compte/depot » choisi dans la liste. */
    lien: z.string(),
    /** Le nom voulu dans la colonne de gauche. Vide : le nom du dépôt. */
    name: z.string().optional(),
    /** Le nom du dossier sur le serveur. Vide : déduit du nom du dépôt. */
    folder: z.string().optional(),
    /** Le nom court de l'adresse publique. Vide : le projet naît sans adresse. */
    sousDomaine: z.string().optional(),
    /** Le port sur lequel le projet écoute sur le serveur. */
    port: z.number().optional(),
    /**
     * « Démarrer par un cahier des charges » : une carte naît au montage et son
     * agent pose les questions (`shared/src/cahier-des-charges.ts`).
     */
    cahierDesCharges: z.boolean().optional(),
  }),

  // Cartes
  z.object({
    type: z.literal('card.create'),
    projectId: z.string(),
    title: z.string(),
    description: z.string().optional(),
    labels: z.array(z.string()).optional(),
    attachments: z.array(z.string()).optional(),
    run: RunConfig.partial().optional(),
    polish: z.boolean().optional(),
    /**
     * LE « + » DE « PLANIFIÉ » : la carte naît avec son AGENT DE CADRAGE, un
     * modèle économe avec qui discuter le besoin dans le fil de la carte
     * (`shared/src/cadrage.ts`). Rien ne part au moteur pour autant : l'agent
     * est créé, il ne parle qu'au premier message.
     */
    cadrage: z.boolean().optional(),
  }),
  z.object({ type: z.literal('card.update'), id: z.string(), patch: z.record(z.any()) }),
  z.object({
    type: z.literal('card.move'),
    id: z.string(),
    column: ColumnKey,
    position: z.number().optional(),
  }),
  /**
   * RANGER (OU RESSORTIR) DES CARTES FINIES SUR LA PAGE « TABLEAUX DE BORD »
   * SEULEMENT : `range` vrai les fait passer de « Terminer » à « Archiver »,
   * faux les y ramène (`rangeeTableauDeBordAt`). La colonne du projet, la
   * date de mise en ligne et le lot de la publication ne bougent pas.
   */
  z.object({
    type: z.literal('card.rangerTableauDeBord'),
    ids: z.array(z.string()).min(1).max(5000),
    range: z.boolean(),
  }),
  z.object({ type: z.literal('card.delete'), id: z.string() }),
  z.object({ type: z.literal('card.supprimerSiVide'), id: z.string() }),
  /**
   * RATTACHER UNE CARTE À UN AUTRE PROJET. Commande DISTINCTE de `card.move` :
   * celle-ci ne touche pas à la colonne (la carte garde son étape) et ses refus
   * n'ont rien à voir avec ceux d'un changement de colonne — ils tiennent à la
   * présence, ou non, d'un travail déjà fait (`deplacementVersProjetPossible`,
   * `shared/src/deplacement-de-projet.ts`).
   */
  z.object({ type: z.literal('card.deplacerVersProjet'), id: z.string(), projectId: z.string() }),
  /**
   * Valider une carte de « Planifié » : c'est le geste qui AUTORISE la dépense.
   * La carte ne change pas de colonne — elle naît dans « Planifié » et y attend
   * son lancement. Rien ne part au moteur : le chiffrage est rendu par l'agent
   * d'exécution, au lancement.
   */
  z.object({ type: z.literal('card.validate'), id: z.string() }),
  z.object({ type: z.literal('card.start'), id: z.string() }),
  z.object({ type: z.literal('card.finish'), id: z.string() }),
  /* La veille d'une carte (`server/src/veille-de-carte.ts`) : l'arrêter, ou la rejouer tout de suite. */
  z.object({ type: z.literal('card.veille.arreter'), cardId: z.string() }),
  z.object({ type: z.literal('card.veille.verifier'), cardId: z.string() }),
  /* Le service « Tâches récurrentes » : toutes les veilles, actives et terminées (`VeilleListee`). */
  z.object({ type: z.literal('veilles.lister') }),
  /**
   * LE CAHIER DES CHARGES D'UN NOUVEAU PROJET : mettre en pause (l'agent
   * s'arrête, l'avancement reste), reprendre (l'agent repart à la question
   * suivante), et lire le document tel qu'il est sur le disque.
   */
  z.object({ type: z.literal('card.cahierPause'), id: z.string() }),
  z.object({ type: z.literal('card.cahierReprendre'), id: z.string() }),
  z.object({ type: z.literal('card.cahierDocument'), id: z.string() }),
  /** Le cahier des charges d'un PROJET (configuration du projet) : `texte` nul s'il n'existe pas. */
  z.object({ type: z.literal('project.cahierDocument'), projectId: z.string() }),
  z.object({ type: z.literal('card.asap'), id: z.string(), value: z.boolean() }),
  /**
   * PROGRAMMER LE DÉPART D'UNE CARTE, à la main. `date` en millisecondes pose
   * l'heure ; `date` absente l'efface. Le geste est HUMAIN : il efface donc
   * `creneauAutomatique` — la carte a sa propre réponse, elle n'a plus besoin
   * qu'on explique d'où vient son heure (`shared/src/depart-programme.ts`).
   */
  z.object({ type: z.literal('card.schedule'), id: z.string(), date: z.number().optional() }),
  /**
   * « GÉNÉRER LE PLAN » : le clic qui ferme le cadrage. Le démon envoie à
   * l'agent de cadrage une consigne INTERNE — jamais un faux message de
   * l'utilisateur dans le fil — qui lui demande le plan par l'outil
   * `rendre_plan`, et marque la demande sur la carte (`parcours.planDemandeA`)
   * pour que l'écran dise « le plan est en cours » au lieu d'un bouton mort.
   * Un tour qui ne rend pas de plan est relancé une fois, puis un INCIDENT est
   * posé sur la carte (`shared/src/parcours-carte.ts`).
   */
  z.object({ type: z.literal('plan.generer'), cardId: z.string() }),
  /**
   * « REDEMANDER LA COMPRÉHENSION » : le bouton de l'incident d'une carte sans
   * compréhension. Un tour interne de l'agent de cadrage, jamais un plan.
   */
  z.object({ type: z.literal('comprehension.redemander'), cardId: z.string() }),
  /**
   * « VALIDER » LA COMPRÉHENSION D'UNE CARTE : UN SEUL CHANGEMENT D'ÉTAT. Le
   * démon écrit sur la carte `parcours.comprehensionValidee` (l'heure, la
   * compréhension visée, le niveau retenu) et répond aussitôt — aucun message
   * n'est envoyé à l'agent, aucun tour ne part. C'est cet état que lit le
   * lancement (`gesteDuParcours`), et l'écran enchaîne les deux dans le même
   * clic. Une compréhension rendue ensuite périme la validation.
   */
  /**
   * VALIDER (ou retirer) UNE SUPPOSITION de la compréhension en cours, par son
   * texte exact. Écrit sur la carte et rien d'autre : aucun tour d'agent.
   */
  z.object({
    type: z.literal('card.comprehension.supposition'),
    cardId: z.string(),
    hypothese: z.string(),
    validee: z.boolean(),
  }),
  /**
   * RÉPONDRE À UNE QUESTION GARDÉE SUR LA CARTE (`questionsEnAttente`). La
   * réponse s'écrit sur la carte ; la DERNIÈRE relance le cadrage, qui réécrit
   * la compréhension avec ces décisions.
   */
  z.object({
    type: z.literal('card.comprehension.repondre'),
    cardId: z.string(),
    questionId: z.string(),
    reponse: z.string(),
  }),
  z.object({
    type: z.literal('card.comprehension.validate'),
    cardId: z.string(),
    niveau: z.enum(['leger', 'standard', 'approfondi']).optional(),
  }),
  /**
   * L'INTERRUPTEUR « PLAN » DE LA BARRE D'ÉCRITURE, allumé ou éteint. Il vit
   * SUR LA CARTE (`parcours.planSouhaite`), ni par utilisateur ni par projet,
   * et naît éteint. Allumé, chaque tour de cadrage rend aussi un plan complet
   * à la fin de son tour, sans second clic.
   */
  z.object({ type: z.literal('card.plan.souhaite'), cardId: z.string(), actif: z.boolean() }),
  /**
   * L'INTERRUPTEUR « CRÉATION », voisin de « Plan » : SUR LA CARTE
   * (`parcours.creationSouhaitee`), éteint à la naissance. Allumé, l'agent de
   * la carte orchestre plusieurs moteurs (`shared/src/mode-creation.ts`).
   */
  z.object({ type: z.literal('card.creation.souhaitee'), cardId: z.string(), actif: z.boolean() }),
  /**
   * L'interrupteur « Réalisation » (caméra) de la barre d'écriture
   * (`parcours.realisationSouhaitee`). L'allumer allume aussi le cahier des
   * charges (`planSouhaite`) : un média se cadre toujours en entier.
   */
  z.object({ type: z.literal('card.realisation.souhaitee'), cardId: z.string(), actif: z.boolean() }),
  /**
   * LA RÉPONSE À « IMAGE OU VIDÉO ? », posée par l'écran dès l'allumage
   * (`Card.realisation.genre`). Elle démarre seule le questionnaire.
   */
  /** Pause, reprise et lecture du document de réalisation — les jumelles du cahier des charges. */
  z.object({ type: z.literal('card.realisationPause'), id: z.string() }),
  z.object({ type: z.literal('card.realisationReprendre'), id: z.string() }),
  z.object({ type: z.literal('card.realisationDocument'), id: z.string() }),
  /** L'interrupteur « lancement automatique » de la carte (`parcours.lancementAutomatique`). */
  z.object({ type: z.literal('card.lancement.automatique'), cardId: z.string(), actif: z.boolean() }),
  /** Refermer l'incident du parcours d'une carte, sans rien relancer. */
  z.object({ type: z.literal('plan.fermerIncident'), cardId: z.string() }),

  // Agents & conversations
  /** `tout` rouvre aussi les échanges d'avant le dernier nouveau départ. */
  z.object({ type: z.literal('agent.open'), id: z.string(), tout: z.boolean().optional() }),
  /**
   * « D'AUTRES IDÉES » : trois suites de plus pour une réponse, cherchées à part
   * par le moteur de la carte, sans tour (`server/src/autres-idees.ts`). La
   * réponse désignée par son message (conversation) ou son jalon (fil de la
   * carte). L'accusé dit l'issue ; les suites arrivent par `message.upsert` et
   * `journal.entree`.
   */
  z.object({
    type: z.literal('suites.autres'),
    messageId: z.string().max(80).optional(),
    entreeId: z.string().max(80).optional(),
  }),
  /**
   * Toute la conversation d'une carte : analyses, exécutions et relances.
   * L'ouvrir vaut lecture, SAUF `lire: false` : une conversation redemandée
   * seule par l'écran après une reconnexion n'a été vue par personne.
   */
  z.object({ type: z.literal('card.conversation'), cardId: z.string(), lire: z.boolean().optional() }),
  /** « J'ai lu » : éteint la pastille de réponse rendue sur cette carte. */
  z.object({ type: z.literal('card.read'), cardId: z.string() }),
  /* OÙ MÈNE LE CLIC SUR LA CARTE D'UN AGENT DE VOLET : le service et l'élément qui porte la conversation de l'agent (`lieuDuServiceDeLaCarte`). */
  z.object({ type: z.literal('carte.lieu-de-service'), cardId: z.string() }),
  /** « Marquer comme non lu » : rallume la pastille d'un rendu déjà consulté. */
  z.object({ type: z.literal('card.unread'), cardId: z.string() }),
  /**
   * UNE CARTE DEMANDÉE PAR SON SEUL IDENTIFIANT. Un lien direct
   * (« #projet/<id>/tache/<id> ») peut viser une carte qui n'est pas dans
   * l'instantané du projet — jamais chargée, appartenant à un autre projet,
   * effacée depuis, ou écartée parce que sa ligne est illisible. Le tiroir la
   * réclame alors ici : la réponse tranche entre « la voici », « elle n'existe
   * plus » et « elle est abîmée », au lieu d'attendre pour toujours.
   */
  z.object({ type: z.literal('card.get'), id: z.string() }),
  /** « J'ai tout lu sur ce projet » : le geste se fait depuis la liste. */
  z.object({ type: z.literal('project.read'), projectId: z.string() }),
  /** Le badge bleu d'un projet : quelle carte non lue ouvrir (la plus récente) ? */
  z.object({
    type: z.literal('project.unreadCard'),
    projectId: z.string(),
    /** Un projet réuni cherche aussi chez ses membres : son tableau est commun. */
    membres: z.array(z.string()).optional(),
  }),
  /** Repartir de zéro : le fil d'avant est mis de côté, pas supprimé. */
  z.object({ type: z.literal('agent.reset'), agentId: z.string() }),
  z.object({
    type: z.literal('agent.prompt'),
    agentId: z.string(),
    text: z.string(),
    attachments: z.array(z.string()).optional(),
    /* L'ACCORD de l'utilisateur, donné par le bouton « Ouvrir une nouvelle
       carte » : sous une carte ordinaire déjà en ligne, le démon refuse le
       message sans lui (`TEXTE_ACCORD_NOUVELLE_CARTE`). */
    ouvrirNouvelleCarte: z.boolean().optional(),
  }),
  /* `cardId` : l'arrêt part du tiroir de CETTE carte, et ne vaut que pour elle
     — le démon refuse un agent qui ne lui appartient pas. */
  z.object({ type: z.literal('agent.stop'), agentId: z.string(), cardId: z.string().optional() }),
  /* SUSPENDRE : le bouton d'une carte (bande « en cours », barre d'écriture).
     L'agent est coupé mais garde son contexte, la carte reste en « En cours »
     et repart au prochain message ; la file revient dans le champ. */
  z.object({ type: z.literal('agent.suspend'), agentId: z.string(), cardId: z.string().optional() }),
  z.object({ type: z.literal('agents.stop-all') }),
  z.object({
    type: z.literal('agent.config'),
    agentId: z.string(),
    run: z.object({
      engine: z.string().optional(),
      model: z.string().optional(),
      thinking: z.string().optional(),
      account: z.string().optional(),
    }),
  }),
  /* Modifier un message en attente. `attachments` : les pièces qu'il porte
     APRÈS la modification (une pastille retirée, un fichier joint entre-temps).
     Absent — un écran d'avant cette règle —, le message garde les siennes. */
  z.object({
    type: z.literal('queue.update'),
    id: z.string(),
    text: z.string(),
    attachments: z.array(z.string()).optional(),
  }),
  z.object({ type: z.literal('queue.remove'), id: z.string() }),
  /* « Envoyer maintenant » : la demande passe en tête de file, le tour en cours
     est coupé, et elle part aussitôt sur la même session. */
  z.object({ type: z.literal('queue.send-now'), id: z.string() }),
  /* Une demande en attente s'ouvre (`actif`) ou se referme dans la barre
     d'écriture : tant qu'elle est ouverte, la file ne la fait pas partir. */
  z.object({ type: z.literal('queue.edition'), id: z.string(), actif: z.boolean() }),

  // Propositions de tâche
  /** Répondre à une question posée par un agent : il reprend aussitôt. */
  z.object({
    type: z.literal('question.answer'),
    messageId: z.string(),
    questionId: z.string(),
    answer: z.string(),
    /** Les images jointes à la réponse : l'agent les reçoit comme celles du fil. */
    attachments: z.array(z.string()).default([]),
  }),
  /** Écarter une compétence retenue d'office au cadrage — refusé une fois la carte lancée. */
  z.object({ type: z.literal('competence.ecarter'), messageId: z.string(), questionId: z.string() }),
  /** Le mode d'emploi d'une compétence du pool, par son nom. */
  z.object({ type: z.literal('competence.lire'), nom: z.string() }),
  /**
   * Fermer une question posée par l'agent SANS y répondre : elle cesse
   * d'attendre, mais l'agent n'est pas relancé.
   */
  z.object({
    type: z.literal('question.cancel'),
    messageId: z.string(),
    questionId: z.string(),
  }),
  /**
   * Fermer une question posée en TEXTE ORDINAIRE (pas par l'outil `ask_user`) :
   * le repère « l'agent attend votre réponse » et le triangle orange s'éteignent
   * sur ce message, sans relancer l'agent — il n'y a rien à reprendre, son tour
   * est déjà terminé.
   */
  z.object({
    type: z.literal('question.cancelTexte'),
    messageId: z.string(),
  }),
  /**
   * Fermer TOUTES les questions encore ouvertes d'une carte, d'un seul geste —
   * le bouton « Annuler » posé à côté de « Répondre » sur la carte du tableau.
   * Utile quand la question dort dans le fil d'un ancien agent, hors de vue :
   * le triangle orange s'éteint sans avoir à retrouver le message.
   */
  z.object({
    type: z.literal('question.cancelCarte'),
    cardId: z.string(),
  }),
  /**
   * POURSUIVRE UN TRAVAIL COUPÉ PAR LA LIMITE D'UN COMPTE, sur le compte
   * choisi. Le serveur revérifie la disponibilité au moment du clic : un compte
   * tombé entre-temps ne lance rien et rafraîchit les choix.
   */
  z.object({
    type: z.literal('reprise.compte'),
    messageId: z.string(),
    accountId: z.string(),
    /**
     * LE MODÈLE DE LA REPRISE, quand on en change. Le moteur, lui, est celui du
     * compte choisi : un compte Codex fait repartir le travail sous Codex.
     */
    model: z.string().optional(),
  }),
  /**
   * FERMER UN CHOIX DE REPRISE SANS REPARTIR — le bouton « Annuler » de la
   * bulle. Ce n'est pas une réponse : rien ne relance, la bulle se referme et
   * la décision cesse d'être comptée. Sans cette sortie, la seule bulle jaune
   * du fil qui n'en avait pas restait allumée à vie.
   */
  z.object({
    type: z.literal('reprise.abandon'),
    messageId: z.string(),
  }),
  /**
   * TRANCHER UNE ERREUR QUI A ARRÊTÉ LE TRAVAIL : relancer le même agent
   * (reprend là où il s'était arrêté), ignorer (le travail déjà fait suffit,
   * la carte se range en « Terminé »), ou arrêter (la carte revient en
   * « Planifié », comme un arrêt à la main).
   */
  z.object({
    type: z.literal('erreur.repondre'),
    messageId: z.string(),
    choix: z.enum(['relancer', 'ignorer', 'arreter']),
  }),
  z.object({
    type: z.literal('proposal.decide'),
    messageId: z.string(),
    proposalId: z.string(),
    accept: z.boolean(),
    /** Corrections faites au moment de valider (facultatif). */
    title: z.string().optional(),
    description: z.string().optional(),
    labels: z.array(z.string()).optional(),
    /**
     * Moteur, modèle et niveau de réflexion choisis AVANT la création : ils
     * sont posés sur la carte et serviront à l'agent qui l'exécutera. Toujours
     * facultatif — une ancienne interface qui ne les envoie pas garde les
     * réglages par défaut du projet.
     */
    run: RunConfig.partial().optional(),
  }),
  /**
   * Enregistre moteur, modèle et réflexion CHOISIS sur une proposition encore
   * en attente, avant le clic de validation. Sans cela, le choix ne vivait
   * que dans l'écran : un rechargement, ou la traduction du palier du chef
   * au moment de valider, le faisait partir avec un autre modèle.
   */
  z.object({
    type: z.literal('proposal.config'),
    messageId: z.string(),
    proposalId: z.string(),
    run: RunConfig.partial(),
  }),
  /**
   * Réunir plusieurs propositions en attente. L'opération ne crée aucune
   * carte : elle remplace les sources par une nouvelle proposition éditable.
   */
  z.object({
    type: z.literal('proposal.merge'),
    items: z
      .array(z.object({ messageId: z.string(), proposalId: z.string() }))
      .min(2),
  }),

  // Publication
  /*
   * `cible` dit à QUELLE ÉTAPE du parcours on est : le déploiement sur
   * l'instance de dev, ou la mise en production. Absente, c'est la première
   * étape — le déploiement.
   */
  z.object({
    type: z.literal('deploy.start'),
    projectId: z.string(),
    cible: z.enum(['dev', 'production']).optional(),
    /**
     * LES TÂCHES RETENUES par l'écran de sélection, à la première étape
     * seulement (« À déployer ») : absent, tout le lot connu part, comme
     * avant cet écran. Présent, seules ces cartes sont fusionnées et
     * envoyées ; les autres restent dans « À déployer ».
     */
    selectedCardIds: z.array(z.string()).optional(),
    /**
     * PUBLIER SEULEMENT CE DÉPÔT (projet à plusieurs dépôts) : le serveur retient
     * les cartes qui le modifient, et chacune part avec TOUS les dépôts qu'elle
     * touche. Les dépôts qu'aucune carte retenue ne touche sont laissés de côté.
     */
    depot: z.string().optional(),
  }),
  z.object({ type: z.literal('deploy.stop'), runId: z.string() }),
  z.object({ type: z.literal('deploy.retry'), runId: z.string() }),
  /**
   * « RÉSOUDRE LE PROBLÈME » : ouvre (ou retrouve) l'agent qui dépanne cette
   * publication tombée, puis la relance lui-même. Idempotent : un agent déjà
   * vivant sur ce run est rendu tel quel, jamais doublé.
   */
  z.object({ type: z.literal('deploy.depanner'), runId: z.string() }),
  /** Le bouton « Réconcilier » d'une carte écartée : relance son agent, comme la fin de publication. */
  z.object({ type: z.literal('deploy.reconcilier'), runId: z.string(), cardId: z.string() }),
  /**
   * Ce qui coincerait si on publiait maintenant — sans rien publier.
   *
   * `source` est la COLONNE d'où le bloc de publication pose la question : un
   * bloc ne sait pas à quelle étape il sert, il sait seulement où il est. Le
   * serveur lui répond avec l'étape correspondante, ou rien du tout quand cette
   * colonne ne publie pas. Absente, c'est « À déployer ».
   */
  z.object({
    type: z.literal('deploy.check'),
    projectId: z.string(),
    source: ColumnKey.optional(),
  }),
  /**
   * LA COPIE DE TEST du projet (`shared/src/copie-de-test.ts`) : ce qui attend
   * sa mise en production, et le bouton qui recopie le vrai site vers la copie.
   */
  z.object({ type: z.literal('copieDeTest.etat'), projectId: z.string() }),
  z.object({ type: z.literal('copieDeTest.rafraichir'), projectId: z.string() }),
  /**
   * Ce qui coincerait avec CETTE sélection de tâches : une carte retenue qui
   * touche les mêmes fichiers qu'une carte laissée de côté. Interrogé par
   * l'écran de sélection à chaque case cochée ou décochée, sans rien publier.
   */
  z.object({
    type: z.literal('deploy.selection'),
    projectId: z.string(),
    source: ColumnKey.optional(),
    selectedCardIds: z.array(z.string()),
  }),
  /**
   * FICHER le travail enregistré sans carte pour le porter : une carte est
   * posée dans « À déployer », reprenant les enregistrements trouvés.
   *
   * C'est un GESTE de l'utilisateur, depuis l'avertissement de la colonne — rien
   * n'est publié ni fusionné au passage, aucune branche n'est touchée. Le
   * travail était déjà enregistré : la carte lui donne seulement la fiche qui
   * lui manquait.
   */
  z.object({ type: z.literal('deploy.ficherSansCarte'), projectId: z.string() }),
  /**
   * LES DERNIÈRES PUBLICATIONS D'UN PROJET, avec leur fil historique.
   *
   * Lecture seule, en base uniquement : ni git, ni GitHub, ni la moindre
   * commande — donc rien n'est publié ni modifié au passage. Elle sert deux
   * choses, et seulement deux : regrouper les cartes d'« En production » sous
   * la publication qui les a mises en ligne, et rouvrir le fil complet d'un
   * déploiement passé.
   */
  z.object({ type: z.literal('deploy.historique'), projectId: z.string(), limite: z.number().optional() }),
  /**
   * L'ÉTAT DE LA VERSION EN PRODUCTION : quel enregistrement est en ligne chez
   * le client, et de combien la branche du dépôt l'a dépassé. Lecture PURE —
   * une entrée de journal et deux commandes git qui n'écrivent rien : elle ne
   * peut donc rien déclencher, et coûte zéro jeton.
   */
  z.object({ type: z.literal('deploy.etatProduction'), projectId: z.string() }),
  /** L'instant de la dernière publication RÉUSSIE de chaque étape (repère « Essai réussi »). Lecture seule. */
  z.object({ type: z.literal('deploy.reussites'), projectId: z.string() }),

  // Fichiers
  z.object({ type: z.literal('files.list'), projectId: z.string(), path: z.string().optional() }),
  z.object({
    type: z.literal('files.archive'),
    projectId: z.string(),
    paths: z.array(z.string()),
  }),
  z.object({ type: z.literal('attachments.list'), projectId: z.string() }),
  /*
   * LES PIÈCES DES TAGS COLLÉS, retrouvées par leur alias sur tout le dépôt et
   * rattachées au projet où l'on colle (recopiées si elles vivent ailleurs).
   * Fermée aux comptes clients, comme toute commande non nommée dans
   * `shared/src/droits-commandes.ts`.
   */
  z.object({
    type: z.literal('attachments.rattacher'),
    projectId: z.string(),
    agentId: z.string().optional(),
    cardId: z.string().optional(),
    alias: z.array(z.string()).max(50),
  }),
  /*
   * L'INSTANT QUI SERT D'APERÇU À UNE VIDÉO. `seconde: null` efface le choix et
   * rend la main à la recherche automatique. `manuel` distingue le GESTE d'un
   * membre de l'équipe du résultat de cette recherche — un geste ne se laisse
   * jamais écraser par elle. Fermée aux comptes clients par défaut
   * (`shared/src/droits-commandes.ts` : tout ce qui n'y est pas nommé est clos).
   */
  z.object({
    type: z.literal('attachment.apercu'),
    id: z.string(),
    seconde: z.number().nullable(),
    manuel: z.boolean().default(false),
  }),
  /*
   * REFAIRE LA RÉDACTION D'UNE TÂCHE NÉE DE LA MESSAGERIE, après un échec.
   * Rien n'est recréé : la carte, ses pièces et son fil restent les mêmes, seul
   * le tour de rédaction repart (`server/src/redaction-de-demande.ts`).
   */
  z.object({ type: z.literal('card.redaction.relancer'), cardId: z.string() }),

  /**
   * L'écart moyen entre chiffrage annoncé et durée réelle des dernières
   * cartes closes d'un projet — lu dans les réglages du projet, sans ouvrir
   * de carte.
   */
  z.object({ type: z.literal('card.ecartChiffrage'), projectId: z.string() }),

  // GitHub
  z.object({ type: z.literal('github.refresh'), cardId: z.string() }),
  /**
   * Le DÉROULÉ des publications qui ont emporté cette carte, jusqu'à la fusion.
   * Lecture en base seule — aucun appel à git ni à GitHub : l'onglet peut donc
   * le demander à chaque ouverture, sans rien coûter.
   */
  z.object({ type: z.literal('github.deploiements'), cardId: z.string() }),
  /**
   * LE BOUTON DE BRANCHE du fil d'Ariane : lire les branches du dépôt pour une
   * carte, puis renommer, créer ou reprendre (`server/src/gestion-de-branche.ts`).
   * `travail` répond à la question « laisser / emporter » que pose le démon
   * quand la carte a déjà du travail.
   */
  z.object({ type: z.literal('card.branches'), cardId: z.string() }),
  z.object({
    type: z.literal('card.branche'),
    cardId: z.string(),
    geste: z.enum(['renommer', 'creer', 'reprendre']),
    nom: z.string().max(200),
    depart: z.string().max(200).optional(),
    travail: z.enum(['laisser', 'emporter']).optional(),
  }),
  z.object({
    type: z.literal('github.merge'),
    cardId: z.string(),
    method: z.enum(['merge', 'squash', 'rebase']).default('squash'),
    auto: z.boolean().optional(),
  }),

  // Commentaires de carte
  z.object({ type: z.literal('comment.list'), cardId: z.string() }),
  z.object({
    type: z.literal('comment.add'),
    cardId: z.string(),
    text: z.string(),
    attachmentIds: z.array(z.string()).default([]),
  }),
  z.object({ type: z.literal('comment.delete'), id: z.string(), cardId: z.string() }),

  // Système
  z.object({ type: z.literal('settings.get') }),
  /** Réglages d'affichage (largeurs, thème, replis) : conservés en base. */
  z.object({ type: z.literal('prefs.set'), key: z.string(), value: z.any() }),
  /**
   * LES IMAGES DÉJÀ OUVERTES EN GRAND, PAR COMPTE (`capture_vues`). L'écran
   * demande l'état des SEULES clés de la bande qu'il affiche (`captures.vues`),
   * puis annonce chaque image qu'il montre en grand (`captures.voir`). Listes
   * bornées (`MAX_CLES_DE_CAPTURES`) : au-delà, l'écran envoie par tranches.
   */
  z.object({ type: z.literal('captures.vues'), cles: ClesDeCaptures }),
  z.object({ type: z.literal('captures.voir'), cles: ClesDeCaptures }),
  z.object({ type: z.literal('settings.update'), patch: z.record(z.any()) }),
  /*
   * L'INSTALLATION : ce que l'assistant de démarrage et la page « Installation »
   * des réglages demandent au démon (`server/src/installation-commandes.ts`).
   * Les réglages simples passent par `settings.update` ; ici, les GESTES.
   */
  z.object({ type: z.literal('installation.etat') }),
  z.object({ type: z.literal('installation.adresse'), genre: z.enum(['administration', 'espace-client']), hote: z.string().max(253) }),
  z.object({ type: z.literal('installation.secret'), genre: z.enum(GENRES_DE_SECRET), valeur: z.string().max(400) }),
  /*
   * L'ÉCRAN FAIT INSTALLER : il ne nomme qu'un GENRE (un moteur du registre, une
   * fonction), jamais une commande — la ligne exécutée est écrite dans le démon.
   */
  z.object({ type: z.literal('installation.installer'), genre: z.string().max(40) }),
  z.object({ type: z.literal('installation.copie'), nom: z.string().max(100).optional() }),
  z.object({ type: z.literal('installation.nouveautes'), forcer: z.boolean().optional() }),
  /**
   * Récupérer les nouveautés du dépôt public. `lancer` : en plus de poser la tâche
   * de mise à jour, l'agent part tout de suite (le geste de l'utilisateur). Ce
   * clic vaut aussi la mise en ligne de CETTE SEULE tâche, une fois rendue sans
   * blocage (`shared/src/publication-de-la-mise-a-jour.ts`).
   */
  z.object({ type: z.literal('installation.nouveautes.appliquer'), lancer: z.boolean().optional() }),
  z.object({ type: z.literal('installation.courriel-essai'), a: z.string().max(254) }),
  /* La sortie directe (port 25) est-elle ouverte ? Sondée à l'ouverture de l'étape « Les courriels ». */
  z.object({ type: z.literal('installation.courriel-sonde') }),
  z.object({ type: z.literal('installation.github'), jeton: z.string().max(400) }),
  /*
   * LA CONNEXION GITHUB PAR CODE : « lancer » rend le code à coller sur GitHub,
   * « etat » la retrouve après un rechargement, « annuler » l'arrête. La fin
   * arrive par l'événement `installation.github`.
   */
  z.object({ type: z.literal('installation.github-code'), action: z.enum(['lancer', 'etat', 'annuler']) }),
  /* La page « GitHub » des réglages : ce qui est relié (lecture), et la réinitialisation du jeton. */
  z.object({ type: z.literal('installation.github-detail') }),
  z.object({ type: z.literal('installation.github-reinitialiser') }),
  /*
   * L'ENVOI DIRECT PAR CE SERVEUR : « lire » rend les contrôles (signature,
   * réglages du domaine, nom inverse) et les enregistrements attendus ;
   * « poser » crée ces enregistrements chez le fournisseur de noms quand
   * Beluga Build le pilote.
   */
  z.object({ type: z.literal('installation.courriels-domaine'), action: z.enum(['lire', 'poser']) }),
  z.object({ type: z.literal('installation.bibliotheque'), source: z.string().max(200) }),
  /*
   * EXPLORER LE POOL depuis la mise en route : la liste légère des fiches, puis
   * le mode d'emploi d'UNE fiche, lu par son nom (jamais par un chemin).
   */
  z.object({ type: z.literal('installation.competences') }),
  z.object({ type: z.literal('installation.competence'), nom: z.string().max(120) }),
  z.object({
    type: z.literal('installation.etape'),
    etape: z.enum(ETAPES_DE_L_ASSISTANT),
    issue: z.enum(['faite', 'passee']),
  }),
  z.object({ type: z.literal('capacity.processes') }),
  z.object({ type: z.literal('capacity.history') }),
  z.object({ type: z.literal('process.stop'), id: z.string() }),
  z.object({ type: z.literal('process.start'), id: z.string() }),
  z.object({ type: z.literal('engines.list') }),
  z.object({ type: z.literal('quota.refresh') }),
  /**
   * L'ÉTAT D'UN COMPTE CURSOR : sa clé répond-elle, et quels dépôts GitHub
   * peut-elle réellement ouvrir ? Cursor ne publiant aucun quota, c'est la
   * seule chose que sa ligne de compte peut dire d'utile.
   */
  z.object({ type: z.literal('cursor.etat'), accountId: z.string().optional() }),
  /**
   * DÉCLARER UNE CLÉ CURSOR DE PLUS, sans toucher au serveur. Cursor ne se
   * connecte pas par une page de connexion comme Claude et Codex : il n'a
   * qu'une clé, et il faut bien un endroit pour en poser une seconde.
   */
  z.object({ type: z.literal('cursor.ajouterCle'), label: z.string(), cle: z.string() }),
  /**
   * DÉCLARER UNE CLÉ D'ACCÈS pour N'IMPORTE QUEL moteur qui se connecte par une
   * clé (`connexion: 'cle'` au registre des moteurs) : Cursor, Xiaomi MiMo…
   */
  z.object({ type: z.literal('compte.ajouterCle'), engine: EngineId, label: z.string(), cle: z.string() }),
  /**
   * RECONNECTER UN COMPTE À CLÉ : la nouvelle clé est éprouvée, puis posée sur
   * le MÊME compte (même identifiant, même nom). Une clé refusée ne remplace
   * jamais l'ancienne.
   */
  z.object({ type: z.literal('compte.remplacerCle'), accountId: z.string(), cle: z.string() }),
  /**
   * L'AGENT « AJOUTER UN MOTEUR » : rend (ou crée) l'agent du tiroir des
   * réglages. `neuf` repart d'un agent vierge pour un autre fournisseur.
   */
  z.object({ type: z.literal('moteurs.agent'), neuf: z.boolean().optional() }),
  /**
   * L'ASSISTANT GLOBAL du robot en bas à droite (`shared/src/assistant-global.ts`) :
   * sa conversation, gardée par le serveur. `neuf` repart d'une conversation vierge.
   */
  z.object({ type: z.literal('assistant.agent'), neuf: z.boolean().optional() }),
  /** Retirer un moteur ajouté : ses comptes partent, ses cartes retombent sur le moteur par défaut. */
  z.object({ type: z.literal('moteurs.retirer'), id: z.string() }),
  /** « Réessayer l'essai » d'un moteur ajouté : la clé collée (facultative), éprouvée puis activée si verte. */
  z.object({ type: z.literal('moteurs.eprouver'), id: z.string(), cle: z.string().max(4000).optional() }),
  /**
   * LE CRÉDIT DÉPENSÉ chez Cursor, compte par compte. Cursor facture à la
   * dépense : là où les autres moteurs montrent une jauge de quota, c'est un
   * montant qui doit se lire. Un compte dont la clé n'a pas le droit de lire ce
   * montant rend la raison, jamais un zéro.
   */
  z.object({ type: z.literal('cursor.credit') }),
  /**
   * Connecter ou RECONNECTER un compte de moteur sans ouvrir de terminal.
   * Sans `accountId`, c'est un compte neuf : il n'entre dans la liste qu'une
   * fois la connexion réussie.
   */
  z.object({
    type: z.literal('account.connect'),
    engine: EngineId,
    accountId: z.string().optional(),
    label: z.string().optional(),
    /** Codex : « appareil » (défaut, code à saisir) ou « navigateur » (adresse de retour collée). */
    voie: z.enum(['appareil', 'navigateur']).optional(),
  }),
  /** Faire repartir une connexion Codex en cours sur l'autre voie (« Se connecter autrement »). */
  z.object({ type: z.literal('account.voie'), id: z.string(), voie: z.enum(['appareil', 'navigateur']) }),
  /**
   * Voie navigateur : l'adresse de la page d'erreur `localhost:1455/auth/callback?…`
   * collée par l'utilisateur, que le serveur rejoue sur son propre port.
   */
  z.object({ type: z.literal('account.adresseDeRetour'), id: z.string(), adresse: z.string() }),
  /**
   * Reprendre une connexion Codex trouvée dans un autre dossier de la machine :
   * ses identifiants sont DÉPLACÉS dans le coffre du compte, jamais recopiés.
   */
  z.object({ type: z.literal('compte.reprendreConnexion'), accountId: z.string(), source: z.string() }),
  /** Le code recopié depuis la page d'authentification, renvoyé au moteur. */
  z.object({ type: z.literal('account.code'), id: z.string(), code: z.string() }),
  /** Abandonner une connexion en cours. */
  z.object({ type: z.literal('account.cancel'), id: z.string() }),
  /** Les connexions de comptes en cours, à l'ouverture des réglages. */
  z.object({ type: z.literal('account.connections') }),
  /**
   * Couper ou remettre en service un compte depuis le volet Quotas. Un compte
   * coupé reste dans la liste, éteint : l'ordonnanceur ne le choisit plus et sa
   * fenêtre de 5 h n'est plus amorcée.
   */
  z.object({ type: z.literal('account.disable'), id: z.string(), disabled: z.boolean() }),
  /**
   * Renommer un compte depuis l'onglet Comptes. On ne touche qu'au nom affiché ;
   * un nom vide est refusé et le compte garde son ancien nom.
   */
  z.object({ type: z.literal('account.rename'), id: z.string(), label: z.string() }),
  /**
   * RÉGLER L'ORDRE DES COMPTES d'un moteur, du premier (servi d'abord) au
   * dernier. `ids` doit nommer exactement les comptes déclarés du moteur : une
   * liste périmée est refusée.
   */
  z.object({ type: z.literal('account.reorder'), engine: z.string(), ids: z.array(z.string()) }),
  /**
   * RÉGLER L'ORDRE DES MOTEURS (Claude, Codex…) : le premier qui a de la place
   * reçoit une carte dont personne n'a choisi le moteur. Les moteurs payés au
   * crédit n'entrent jamais dans ce choix automatique.
   */
  z.object({ type: z.literal('engine.reorder'), ids: z.array(z.string()) }),
  /**
   * RÉGLER LE FORFAIT MENSUEL d'un compte MiMo : plafond, renouvellement et
   * consommé relevé dans la console Xiaomi (en jetons). Un champ absent ne
   * change pas ; `null` l'efface. Donner `consomme` date le relevé de ce
   * moment — c'est le geste qui recale la barre du mois.
   */
  z.object({
    type: z.literal('account.forfaitMensuel'),
    id: z.string(),
    plafond: z.number().positive().nullable().optional(),
    renouvellement: z.number().nullable().optional(),
    consomme: z.number().nonnegative().nullable().optional(),
  }),
  /**
   * RETIRER UN COMPTE POUR DE BON. Il quitte la liste, le volet Quotas et
   * l'ordonnanceur, et son coffre est marqué pour qu'un redémarrage ne le
   * ressuscite pas. Les fichiers d'identifiants restent sur la machine. Le
   * retrait est refusé — avec sa raison — sur un compte au travail ou sur le
   * dernier compte actif de son moteur.
   */
  z.object({ type: z.literal('account.remove'), id: z.string() }),
  /** Consommation des comptes sur les derniers jours, pour la courbe. */
  z.object({ type: z.literal('quota.history'), days: z.number().optional() }),
  /** Le journal des amorces de fenêtre posées par le serveur. */
  z.object({ type: z.literal('amorce.history'), limit: z.number().optional() }),
  /**
   * LES CLÉS D'API des services extérieurs (`shared/src/cles-api.ts`). Lister
   * ne rend jamais le secret : il n'existe qu'une fois, dans la réponse à
   * `cleApi.creer`. Révoquer date la clé sans effacer la ligne ; oublier ne
   * vaut que pour une clé DÉJÀ révoquée.
   */
  z.object({ type: z.literal('cleApi.lister') }),
  z.object({ type: z.literal('cleApi.creer'), nom: z.string() }),
  z.object({ type: z.literal('cleApi.revoquer'), id: z.string() }),
  z.object({ type: z.literal('cleApi.oublier'), id: z.string() }),
  /**
   * LE COFFRE-FORT DES IDENTIFIANTS (`shared/src/coffre-fort.ts`). Lister rend
   * les fiches ENTIÈRES, valeurs comprises : le coffre sert à relire un accès,
   * pas seulement à en vérifier l'existence.
   */
  z.object({ type: z.literal('coffre.lister') }),
  z.object({ type: z.literal('coffre.enregistrer'), acces: z.any() }),
  z.object({ type: z.literal('coffre.supprimer'), id: z.string() }),
  z.object({ type: z.literal('coffre.restaurer'), id: z.string() }),
  z.object({ type: z.literal('coffre.ranger'), id: z.string(), dossierId: z.string().nullable().optional() }),
  z.object({ type: z.literal('coffre.dossier.enregistrer'), dossier: z.any() }),
  z.object({ type: z.literal('coffre.dossier.supprimer'), id: z.string() }),
  z.object({ type: z.literal('coffre.dossier.restaurer'), id: z.string() }),
  /**
   * LE JUGE RAPIDE (`shared/src/jugement-rapide.ts`). `etat` rend tout ce que
   * l'écran affiche : Laya est-il installé, quels usages sont allumés, les
   * dernières traces et leur bilan. `usage` allume ou éteint UN usage, sans
   * toucher aux autres.
   */
  z.object({ type: z.literal('juge.etat') }),
  z.object({ type: z.literal('juge.usage'), usage: z.string(), allume: z.boolean() }),
  z.object({ type: z.literal('juge.traces'), limite: z.number().optional(), usage: z.string().optional() }),
  /**
   * LA BASE DE CONNAISSANCES (`shared/src/connaissances.ts`). Les portées, les
   * fiches numérotées d'une portée et leurs unités, une unité et ses versions, le
   * changelog d'un projet ; chercher passe par le MÊME moteur que les agents,
   * confirmer et déprécier par la même porte d'écriture.
   */
  z.object({ type: z.literal('memoire.portees') }),
  z.object({ type: z.literal('memoire.fiches'), portee: z.string() }),
  z.object({ type: z.literal('memoire.fiche'), portee: z.string(), ficheId: z.string(), depreciees: z.boolean().optional() }),
  z.object({ type: z.literal('memoire.unite'), id: z.string() }),
  z.object({ type: z.literal('memoire.titres'), ids: z.array(z.string()).max(500) }),
  /** Chercher des unités : dans une portée, ou dans toutes à la fois (sans `portee`). */
  z.object({ type: z.literal('memoire.chercher'), recherche: z.string(), portee: z.string().optional() }),
  /**
   * LE GRAPHE DE L'ÉCRAN MÉMOIRE (`shared/src/graphe-memoire.ts`) : toutes les
   * unités actives, légères, et les portées. `signature` : celle que l'écran
   * détient déjà — inchangée, le démon ne renvoie rien d'autre.
   */
  z.object({ type: z.literal('memoire.graphe'), signature: z.string().optional() }),
  /** Les voisins par le sens d'une unité, et le modèle commun d'une compétence qui le précise : les fils de la sélection. */
  z.object({ type: z.literal('memoire.voisins'), id: z.string() }),
  /** Chercher EXACTEMENT comme l'outil de l'agent : dans un projet (et le Global), ou partout (sans projet). */
  z.object({ type: z.literal('memoire.chercherCommeLAgent'), recherche: z.string().max(2000), projectId: z.string().nullable().optional() }),
  z.object({ type: z.literal('memoire.changelog'), projectId: z.string() }),
  /** Corriger à la main le titre, l'explication et le poids d'une entrée : plus aucune rédaction automatique ne la réécrit. */
  z.object({
    type: z.literal('memoire.changelog.corriger'),
    projectId: z.string(),
    id: z.number(),
    titre: z.string(),
    explication: z.string().optional(),
    poids: z.string(),
  }),
  z.object({ type: z.literal('memoire.deprecier'), id: z.string() }),
  z.object({ type: z.literal('memoire.exporter'), portee: z.string() }),
  /** Relancer la génération par un modèle d'une portée ; son lot est importé quand elle finit. */
  z.object({ type: z.literal('memoire.regenerer'), portee: z.string() }),
  z.object({ type: z.literal('memoire.importer'), portee: z.string().optional() }),
  /**
   * LES NOTES (`shared/src/notes.ts`). Lister rend TOUTES les notes, de TOUS
   * les projets, avec leurs pièces jointes résolues : la recherche, le tri et
   * le filtre par projet se font ensuite dans le navigateur, sans un
   * aller-retour de plus à chaque lettre tapée.
   */
  /**
   * LE JOURNAL COMPLET D'UNE CARTE, en UN SEUL document : toutes les requêtes
   * et tous les points de travail, du cadrage au rapport
   * (`shared/src/journal-carte.ts`). L'écran le demande à l'ouverture de
   * l'onglet, puis suit les ajouts par l'événement `journal.entree`.
   */
  z.object({ type: z.literal('card.journal'), cardId: z.string() }),
  z.object({ type: z.literal('notes.lister') }),
  z.object({ type: z.literal('notes.enregistrer'), note: z.any() }),
  z.object({ type: z.literal('notes.supprimer'), id: z.string() }),
  /**
   * LES BACKUPS DES SITES EN PRODUCTION (`shared/src/backups.ts`). `etat`
   * rend tout ce que les deux fenêtres affichent en une fois : les sites, leurs
   * points de sauvegarde, les projets sans fiche et le dossier de stockage
   * réglé. `lancer` ne RETIENT PAS sa réponse — un vidage de base dure des
   * minutes, l'écran relit l'état plutôt que d'attendre.
   */
  z.object({ type: z.literal('backups.etat') }),
  z.object({ type: z.literal('backups.enregistrerSite'), site: z.any() }),
  z.object({ type: z.literal('backups.supprimerSite'), id: z.string() }),
  z.object({ type: z.literal('backups.lancer'), id: z.string().optional() }),
  /**
   * CONFIGURER UN SITE PAR L'AGENT D'ANALYSE plutôt qu'au formulaire : une
   * phrase suffit, l'agent lit le site, questionne, écrit sa recette de backup,
   * l'essaie et l'enregistre (`server/src/assistant-backup.ts`).
   */
  z.object({
    type: z.literal('backups.configurer'),
    description: z.string(),
    projectId: z.string().optional(),
  }),
  /**
   * REPRENDRE UN SITE ENREGISTRÉ : le RÉPARER s'il échoue de suite (le passage
   * automatique le fait tout seul après trois échecs), sinon l'ANALYSER pour
   * lui écrire une vraie recette. Le démon choisit ; rien ne lance d'analyse
   * tout seul sur un site qui marche.
   */
  z.object({ type: z.literal('backups.relire'), id: z.string() }),
  /**
   * RESTAURER UN POINT — le sens inverse de la prise : un FILET est pris, puis
   * chaque étape de la recette enregistrée dans l'archive repose sa part.
   * Même mécanique que `lancer` : la réponse ne retient pas l'écran, l'état se
   * relit ensuite.
   */
  z.object({ type: z.literal('backups.restaurer'), id: z.string() }),
  /**
   * LA SURVEILLANCE DES SITES (`shared/src/surveillance.ts`). Ajouter appelle
   * l'adresse TOUT DE SUITE ; « vérifier » relance une tournée sans attendre
   * l'heure, sur un site ou sur tous. L'état complet revient ensuite par
   * l'événement `surveillance`, jamais seulement par la réponse — la pastille
   * du menu doit suivre dans TOUS les onglets ouverts.
   */
  z.object({ type: z.literal('surveillance.lister') }),
  z.object({ type: z.literal('surveillance.ajouter'), url: z.string(), nom: z.string().optional() }),
  z.object({ type: z.literal('surveillance.supprimer'), id: z.string() }),
  z.object({ type: z.literal('surveillance.verifier'), id: z.string().optional() }),
  /**
   * L'HISTORIQUE D'UNE SURVEILLANCE — ses passages des dernières 24 heures.
   * Demandé à l'ouverture de son tiroir, jamais au premier envoi : un écran
   * qu'on n'a pas ouvert ne se télécharge pas.
   */
  z.object({ type: z.literal('surveillance.historique'), id: z.string() }),
  /**
   * PARLER À L'AGENT DE SURVEILLANCE (`server/src/assistant-surveillance.ts`) :
   * sans « id », il crée une surveillance ; avec, il modifie celle-là. La
   * réponse rend la conversation tout de suite, sans attendre le tour.
   */
  z.object({ type: z.literal('surveillance.assistant'), id: z.string().optional(), demande: z.string() }),
  /**
   * LE PROJET RATTACHÉ À UN SITE, choisi sur sa fiche. C'est le dépôt qui SERT
   * le site, jamais celui où vit l'agent de configuration. `projectId` absent
   * ou vide remet la fiche « à deviner d'après l'adresse »
   * (`shared/src/depannage-site.ts`).
   */
  z.object({ type: z.literal('surveillance.rattacher'), id: z.string(), projectId: z.string().nullish() }),
  /**
   * LE CONTRÔLE WORDPRESS D'UN SITE (`server/src/surveillance-wordpress.ts`) :
   * ses soucis des 30 derniers jours, demandés à l'ouverture du tiroir ; et
   * « accepter » l'état actuel des extensions — celles qui sont actives
   * maintenant deviennent la liste attendue.
   */
  z.object({ type: z.literal('surveillance.wordpress'), id: z.string() }),
  z.object({ type: z.literal('surveillance.wordpress.accepter'), id: z.string() }),
  /* Le bouton sous la liste des soucis : une carte dans le projet du site, qui
     porte tout ce qui a été détecté (`shared/src/correction-wordpress.ts`). */
  z.object({ type: z.literal('surveillance.wordpress.corriger'), id: z.string() }),
  /**
   * L'ATELIER MARKETING (`shared/src/marketing.ts`, `server/src/marketing.ts`).
   * La liste des projets et leur avancement ; l'espace complet d'UN projet,
   * demandé à l'ouverture de son écran (un écran qu'on n'a pas ouvert ne se
   * télécharge pas) ; parler à son agent attitré ; les gestes de l'utilisateur
   * sur un contenu. Chaque changement se rediffuse par l'événement `marketing`.
   */
  /**
   * LE SERVICE STATISTIQUES (`shared/src/statistiques.ts`,
   * `server/src/statistiques.ts`). La liste des sites mesurés (projets et sites
   * autonomes) ; le détail d'UN site, demandé à l'ouverture ; la frise d'un
   * visiteur ; créer, corriger ou retirer un site autonome ; régler le mode.
   * Chaque changement se rediffuse par l'événement `marketing`.
   */
  z.object({ type: z.literal('statistiques.lister') }),
  /**
   * LA PAGE « MÉDIAS » : les projets qui ont des médias fabriqués (mode
   * « Réalisation »), puis ceux d'un projet, rangés par carte et paginés par
   * carte (`avant` : la date de la dernière carte reçue).
   */
  z.object({ type: z.literal('medias.projets') }),
  /* Les médias livrés d'une discussion, rendus sous sa réponse finale (`medias-livres.ts`). */
  z.object({ type: z.literal('medias.livres.carte'), cardId: z.string() }),
  z.object({ type: z.literal('medias.livres.agent'), agentId: z.string() }),
  z.object({
    type: z.literal('medias.lister'),
    projectId: z.string(),
    genre: z.enum(['image', 'video', 'son']).optional(),
    avant: z.number().optional(),
  }),
  z.object({ type: z.literal('statistiques.detail'), id: z.string(), jours: z.number().optional(), debut: z.number().optional(), fin: z.number().optional() }),
  z.object({ type: z.literal('statistiques.visiteur'), id: z.string(), visiteur: z.string() }),
  z.object({ type: z.literal('statistiques.creerSite'), nom: z.string(), adresse: z.string(), mode: z.enum(['anonyme', 'visiteur']).optional() }),
  z.object({ type: z.literal('statistiques.modifierSite'), id: z.string(), nom: z.string().optional(), adresse: z.string().optional() }),
  z.object({ type: z.literal('statistiques.supprimerSite'), id: z.string() }),
  z.object({ type: z.literal('statistiques.reglerMode'), id: z.string(), mode: z.enum(['anonyme', 'visiteur']) }),
  /* « Tester le suivi » : relit la page du site tout de suite. « Étudier le site » : l'agent de l'espace lit un site autonome et propose ses objectifs. */
  z.object({ type: z.literal('statistiques.testerSuivi'), id: z.string() }),
  /* La DERNIÈRE liste de tâches de l'agent d'une carte (installation du suivi) :
     une lecture à l'ouverture, la suite arrive par `message.upsert`. Jamais la conversation entière. */
  z.object({ type: z.literal('statistiques.etapesInstallation'), cardId: z.string() }),
  z.object({ type: z.literal('statistiques.analyserObjectifs'), id: z.string() }),
  z.object({ type: z.literal('statistiques.etudierSite'), id: z.string(), identifiant: z.string().optional(), motDePasse: z.string().optional() }),
  z.object({ type: z.literal('marketing.lister') }),
  z.object({ type: z.literal('marketing.espace'), projectId: z.string(), jours: z.number().optional() }),
  /* « demande » : une phrase libre ; « geste » : le bouton unique de l'écran (initialiser, réanalyser) ou « Générer la suite » (suite). */
  z.object({
    type: z.literal('marketing.assistant'),
    projectId: z.string(),
    demande: z.string().optional(),
    geste: z.enum(['initialiser', 'reanalyser', 'suite']).optional(),
  }),
  z.object({ type: z.literal('marketing.configurer'), projectId: z.string(), configuration: z.record(z.any()) }),
  /* Couper (ou rendre) le suivi marketing d'un projet : il passe dans « Projets inactifs ». */
  z.object({ type: z.literal('marketing.activer'), projectId: z.string(), actif: z.boolean() }),
  z.object({ type: z.literal('marketing.installerSuivi'), projectId: z.string() }),
  z.object({ type: z.literal('marketing.fiche'), projectId: z.string(), fiche: z.record(z.any()) }),
  z.object({
    type: z.literal('marketing.contenu.creer'),
    projectId: z.string(),
    genre: z.string(),
    canal: z.string(),
    canaux: z.array(z.string()).optional(),
    titre: z.string(),
    texte: z.string(),
    datePrevue: z.string().optional(),
  }),
  z.object({
    type: z.literal('marketing.contenu.modifier'),
    id: z.string(),
    titre: z.string().optional(),
    texte: z.string().optional(),
    canal: z.string().optional(),
    canaux: z.array(z.string()).optional(),
    datePrevue: z.string().nullish(),
    heurePrevue: z.string().nullish(),
    lienCible: z.string().nullish(),
  }),
  z.object({ type: z.literal('marketing.contenu.etape'), id: z.string(), etape: z.string() }),
  /**
   * LA PUBLICATION OFFICIELLE SUR LES RÉSEAUX (`shared/src/reseaux-sociaux.ts`) :
   * les comptes cochés d'un contenu, « Publier maintenant », relier / retirer /
   * créer un compte, l'application développeur d'un réseau, et la boîte des
   * commentaires et messages. Une réponse ne part QUE par `marketing.message.repondre`.
   */
  z.object({ type: z.literal('marketing.contenu.cibles'), id: z.string(), comptes: z.array(z.string()) }),
  z.object({ type: z.literal('marketing.contenu.publier'), id: z.string() }),
  z.object({ type: z.literal('marketing.compte.relier'), projectId: z.string(), reseau: z.string() }),
  z.object({ type: z.literal('marketing.compte.retirer'), projectId: z.string(), id: z.string() }),
  z.object({ type: z.literal('marketing.compte.creer'), projectId: z.string(), reseau: z.string() }),
  z.object({
    type: z.literal('marketing.application.ecrire'),
    reseau: z.string(),
    clientId: z.string().optional(),
    secret: z.string().optional(),
    etat: z.enum(['absente', 'en_creation', 'en_validation', 'validee']).optional(),
    note: z.string().optional(),
  }),
  z.object({ type: z.literal('marketing.messages'), projectId: z.string() }),
  z.object({ type: z.literal('marketing.messages.relever'), projectId: z.string() }),
  z.object({ type: z.literal('marketing.messages.lus'), projectId: z.string(), ids: z.array(z.string()) }),
  z.object({ type: z.literal('marketing.message.repondre'), id: z.string(), texte: z.string() }),
  z.object({ type: z.literal('marketing.contenu.supprimer'), id: z.string() }),
  z.object({ type: z.literal('marketing.action.faite'), id: z.string(), fait: z.boolean() }),
  z.object({ type: z.literal('marketing.action.modifier'), projectId: z.string(), id: z.string(), datePrevue: z.string() }),
  /**
   * LE STUDIO (`shared/src/studio.ts`, `server/src/studio.ts`). La liste des
   * créations ; une création ouverte (sa composition courante, son historique,
   * sa bibliothèque, ses exports, ses dépenses — demandée à l'ouverture) ; une
   * OPÉRATION de l'écran devient une version ; voix d'essai gratuite, devis et
   * validation de la voix finale ; exports ; le clic sur une dépense ; parler à
   * l'agent de la création. Chaque changement se rediffuse par l'événement `studio`.
   */
  z.object({ type: z.literal('studio.lister'), projectId: z.string().optional() }),
  z.object({
    type: z.literal('studio.espace.ecrire'),
    projectId: z.string(),
    kit: z.record(z.any()).optional(),
    voixFinale: z.string().optional(),
    voixEssai: z.string().optional(),
  }),
  z.object({
    type: z.literal('studio.creation.creer'),
    projectId: z.string(),
    titre: z.string().optional(),
    formats: z.array(z.string()).optional(),
    /* Un dessin gardé de la bibliothèque, posé comme premier segment. */
    depuisMedia: z.string().optional(),
    /* Un MODÈLE du projet : la nouvelle création part de sa composition entière. */
    depuisModele: z.string().optional(),
  }),
  z.object({ type: z.literal('studio.creation.ouvrir'), id: z.string() }),
  z.object({ type: z.literal('studio.creation.modifier'), id: z.string(), titre: z.string().optional(), formats: z.array(z.string()).optional() }),
  /** Le réglage de l'agent d'une création, choisi avant sa première demande (`null` l'efface). */
  z.object({
    type: z.literal('studio.creation.agent'),
    id: z.string(),
    run: z.object({ engine: z.string(), model: z.string().optional(), thinking: z.string().optional(), account: z.string().optional() }).nullable(),
  }),
  z.object({ type: z.literal('studio.creation.supprimer'), id: z.string() }),
  z.object({ type: z.literal('studio.creation.dupliquer'), id: z.string() }),
  /* LES MODÈLES : « Garder comme modèle » (le refaire met le modèle à jour), lister, retirer, copier vers un autre projet. */
  z.object({ type: z.literal('studio.modele.valider'), creationId: z.string() }),
  z.object({ type: z.literal('studio.modele.lister'), projectId: z.string().optional() }),
  z.object({ type: z.literal('studio.modele.supprimer'), id: z.string() }),
  z.object({ type: z.literal('studio.modele.copier'), id: z.string(), projectId: z.string() }),
  z.object({ type: z.literal('studio.operation'), creationId: z.string(), operation: z.record(z.any()) }),
  z.object({ type: z.literal('studio.annuler'), creationId: z.string() }),
  z.object({ type: z.literal('studio.retablir'), creationId: z.string() }),
  z.object({ type: z.literal('studio.restaurer'), creationId: z.string(), numero: z.number() }),
  z.object({ type: z.literal('studio.historique'), creationId: z.string() }),
  /* Ce que l'écran a sélectionné : l'agent le lit avec chaque demande. */
  z.object({
    type: z.literal('studio.selection'),
    creationId: z.string(),
    segmentIds: z.array(z.string()),
    elementId: z.string().optional(),
    curseur: z.number(),
    format: z.string().optional(),
  }),
  z.object({ type: z.literal('studio.media.importer'), projectId: z.string(), attachmentId: z.string(), creationId: z.string().optional(), licence: z.string().optional() }),
  z.object({ type: z.literal('studio.media.modifier'), id: z.string(), nom: z.string().optional(), categorie: z.string().optional(), usage: z.string().optional(), licence: z.string().optional() }),
  z.object({ type: z.literal('studio.media.supprimer'), id: z.string() }),
  /* La bande d'images d'une vidéo (fenêtre d'édition d'un élément), extraite une fois puis gardée. */
  z.object({ type: z.literal('studio.media.bande'), creationId: z.string(), mediaId: z.string() }),
  /* LE CATALOGUE DE STYLES (collection libre de consignes de vidéos animées) : la galerie « Bibliothèque », en haut de l’aperçu. */
  z.object({ type: z.literal('studio.styles.lister') }),
  /* La fenêtre d'aperçu agrandi : le début de la consigne, les liens et le crédit, demandés à l'ouverture. */
  z.object({ type: z.literal('studio.styles.lire'), id: z.string() }),
  /* LES SOURCES DE LA BIBLIOTHÈQUE (`server/src/studio-sources.ts`) : le volet « Sources » du tiroir. */
  z.object({ type: z.literal('studio.sources.lister') }),
  z.object({ type: z.literal('studio.sources.ajouter'), adresse: z.string() }),
  z.object({ type: z.literal('studio.sources.valider'), id: z.string() }),
  z.object({ type: z.literal('studio.sources.analyser'), id: z.string() }),
  z.object({ type: z.literal('studio.sources.controler'), id: z.string() }),
  z.object({ type: z.literal('studio.sources.retirer'), id: z.string() }),
  /* LE VOLET « PASSER LA VÉRIFICATION » (`server/src/studio-navigateur.ts`) : un vrai navigateur sur le serveur, son
     image à l'écran, les gestes renvoyés ; « terminer » lit la source par lui. */
  z.object({ type: z.literal('studio.navigateur.ouvrir'), sourceId: z.string() }),
  z.object({
    type: z.literal('studio.navigateur.geste'),
    sourceId: z.string(),
    geste: z.union([
      z.object({ genre: z.literal('clic'), x: z.number(), y: z.number() }),
      z.object({ genre: z.literal('molette'), x: z.number(), y: z.number(), dx: z.number(), dy: z.number() }),
      z.object({ genre: z.literal('texte'), texte: z.string().max(500) }),
      z.object({ genre: z.literal('touche'), cle: z.string().max(20) }),
    ]),
  }),
  z.object({ type: z.literal('studio.navigateur.terminer'), sourceId: z.string() }),
  z.object({ type: z.literal('studio.navigateur.fermer'), sourceId: z.string() }),
  /* La voix d'essai, gratuite : un segment, ou toutes les voix qui n'en ont pas. */
  z.object({ type: z.literal('studio.voix.essai'), creationId: z.string(), segmentId: z.string().optional() }),
  /* Le PLAFOND de prix des voix finales, lu en direct AVANT le clic. `refaire` : la prise entière même si tout est déjà final. */
  z.object({ type: z.literal('studio.voix.devis'), creationId: z.string(), segmentIds: z.array(z.string()).optional(), refaire: z.boolean().optional() }),
  /* LE CLIC « Valider la voix » (ou « Refaire la voix », `refaire`) : autorise jusqu'au plafond affiché, et lance. */
  z.object({ type: z.literal('studio.voix.valider'), creationId: z.string(), segmentIds: z.array(z.string()).optional(), plafond: z.number(), refaire: z.boolean().optional() }),
  z.object({ type: z.literal('studio.voix.extraits') }),
  z.object({
    type: z.literal('studio.exporter'),
    creationId: z.string(),
    format: z.string(),
    genre: z.enum(['video', 'image']).optional(),
    /** L'instant pris pour une image : la tête de lecture. */
    instant: z.number().nonnegative().optional(),
    /** Qualité, définition, images par seconde, type, son, format d'image (`studio-export.ts`), lus avec tolérance. */
    reglages: z.record(z.unknown()).optional(),
    /** Le lot du clic « Exporter » : le même pour chaque format coché (`partagerLesExports`). */
    lot: z.string().max(64).optional(),
  }),
  z.object({ type: z.literal('studio.export.annuler'), id: z.string() }),
  /* « Vider les anciens exports » : retire les exports FINIS de la création (lignes et fichiers), sauf ceux à garder. */
  z.object({ type: z.literal('studio.exports.vider'), creationId: z.string(), garder: z.array(z.string()).max(200).optional() }),
  z.object({ type: z.literal('studio.depense.valider'), id: z.string() }),
  z.object({ type: z.literal('studio.depense.refuser'), id: z.string() }),
  z.object({ type: z.literal('studio.credit') }),
  /* LES SERVICES DE CRÉATION de l'utilisateur (sept services vidéo, plus son OpenRouter) : une fiche du coffre par service. */
  z.object({ type: z.literal('studio.services.lister') }),
  z.object({ type: z.literal('studio.services.enregistrer'), service: z.string(), champs: z.record(z.string().max(4000)) }),
  z.object({ type: z.literal('studio.services.tester'), service: z.string() }),
  z.object({ type: z.literal('studio.services.retirer'), service: z.string() }),
  /* Le modèle vidéo retenu pour une création (encadré du chat) : gardé, puis dit à l'agent. */
  z.object({ type: z.literal('studio.modeleVideo.choisir'), creationId: z.string(), service: z.string(), modele: z.string() }),
  z.object({ type: z.literal('studio.assistant'), creationId: z.string(), demande: z.string() }),
  /* « Créer le visuel » depuis un contenu de l'atelier Marketing. */
  z.object({ type: z.literal('studio.depuisMarketing'), contenuId: z.string() }),
  /**
   * Les dernières erreurs remontées par l'interface, pour le bloc des réglages.
   * Elles arrivent par `POST /api/erreur` et vivent dans un fichier de journal.
   */
  z.object({ type: z.literal('erreurs.liste'), limite: z.number().optional() }),
  /** Vider ce journal : le fichier repart vide, il n'est pas supprimé. */
  z.object({ type: z.literal('erreurs.effacer') }),
  /** L'état du démon : depuis quand il tourne, et s'il tourne sur du code périmé. */
  z.object({ type: z.literal('daemon.status') }),
  /**
   * Arrêter le démon pour que le service le relance avec le code construit.
   *
   * `force` passe outre l'attente : le travail en cours est d'abord enregistré,
   * tout ce qui tourne est coupé, puis le serveur repart. Geste EXPLICITE — il
   * ne vient que d'un second bouton, jamais du chemin ordinaire.
   */
  z.object({ type: z.literal('daemon.restart'), force: z.boolean().optional() }),
  z.object({ type: z.literal('backup.now') }),
  z.object({ type: z.literal('backup.list') }),
  /**
   * L'EXPORT ET L'IMPORT INTÉGRAL DES DONNÉES (`shared/src/export-donnees.ts`).
   * `donnees.categories` dit ce qu'il y a à emporter, catégorie par catégorie,
   * avant même de cocher. `donnees.exporter` rend un JETON de téléchargement —
   * l'archive ne passe JAMAIS par ce canal. `donnees.importer` travaille sur une
   * archive déjà déposée par `POST /api/donnees/archive`, qui l'a validée et
   * rendu son aperçu : on ne la fait pas remonter deux fois.
   */
  z.object({ type: z.literal('donnees.categories') }),
  z.object({ type: z.literal('donnees.exporter'), categories: z.array(z.string()).optional() }),
  z.object({
    type: z.literal('donnees.importer'),
    depot: z.string(),
    categories: z.array(z.string()),
    politique: z.enum(['ignorer', 'remplacer', 'remettre-a-zero']).optional(),
  }),
  z.object({ type: z.literal('digest.speak'), projectId: z.string().optional() }),
  /** Les voix installées sur le serveur, pour en choisir une et l'écouter. */
  z.object({ type: z.literal('voice.list') }),
  /* La voix parle-t-elle sur ce serveur ? Sinon, la pièce qui manque, en une phrase. */
  z.object({ type: z.literal('voice.etat') }),
  /**
   * Une phrase DICTÉE, sans destinataire : l'assistant global lit la liste des
   * projets ouverts, dépose la demande dans le chef d'orchestre du bon projet
   * ou POSE LA QUESTION quand un doute demeure.
   */
  z.object({ type: z.literal('voix.demande'), texte: z.string() }),
  /**
   * UN TOUR DU TIROIR DE PROCÉDURE (`shared/src/procedure-publication.ts`).
   *
   * Sans `message`, c'est l'OUVERTURE : un agent lit le projet et rend la
   * question à poser. Avec `message`, c'est la RÉPONSE de l'utilisateur : le
   * même agent écrit alors la procédure, et le serveur l'enregistre sur la
   * `cible` demandée — celle de la colonne d'où l'on vient, jamais l'autre. Tour
   * d'agent PAYANT, comme la génération d'un prompt de mise en production.
   */
  z.object({
    type: z.literal('procedure.tour'),
    projectId: z.string(),
    cible: z.enum(['dev', 'production']),
    agentId: z.string().optional(),
    message: z.string().optional(),
    /**
     * CE QUE L'UTILISATEUR VIENT D'ÉCRIRE, PAS ENCORE ENREGISTRÉ.
     *
     * La description de la mise en ligne se tape dans la rubrique et ne part
     * en base qu'au clic sur « Enregistrer » : sans ce champ, l'agent lisait
     * l'ANCIENNE description du projet, et le tour rangeait ensuite une base
     * VIDE par-dessus celle qu'on venait d'écrire. Fourni, il fait foi pour le
     * prompt comme pour ce qui est rangé ; absent, le projet reste la source.
     */
    base: z.string().optional(),
  }),
  /**
   * L'ÉTAT du dialogue de procédure, SANS lancer aucun tour : ce que le tiroir
   * demande à son ouverture et pendant qu'un tour tourne. Rendre `null` veut
   * dire « plus aucun tour ici » — le tiroir le dit au lieu de tourner.
   */
  z.object({
    type: z.literal('procedure.etat'),
    projectId: z.string(),
    cible: z.enum(['dev', 'production']),
  }),
  z.object({ type: z.literal('stats.usage'), projectId: z.string().optional() }),
  /** La part de quota (5 h et semaine) qu'une carte a consommée, pour son détail. */
  z.object({ type: z.literal('card.quota'), cardId: z.string() }),
  /**
   * LA TÉLÉMÉTRIE DES TÂCHES : une mesure par tâche (jetons réels, sujets de
   * mémoire ouverts et leur temps, blocs demandés contre rendus, note de
   * qualité) et les courbes de tendance de la fenêtre
   * (`shared/src/telemetrie-tache.ts`). Demandée à part du tableau de bord :
   * c'est une autre fenêtre de temps, et elle n'a pas à ralentir le reste.
   */
  z.object({
    type: z.literal('stats.telemetrie'),
    jours: z.number().optional(),
    /** Une période précise (page « Résumé ») ; sans elle, les `jours` derniers jours. */
    debut: z.number().optional(),
    fin: z.number().optional(),
  }),
  /**
   * UNE RUBRIQUE DE LA PAGE « RÉSUMÉ » sur une période (`shared/src/resume.ts`,
   * `server/src/resume.ts`) : demandée à l'ouverture de la rubrique seulement.
   */
  z.object({
    type: z.literal('stats.resume'),
    rubrique: z.enum(RUBRIQUES_DU_RESUME),
    debut: z.number().optional(),
    fin: z.number().optional(),
  }),
  /**
   * LA DERNIÈRE ACTIVITÉ DE CHAQUE PROJET : la date de sa carte modifiée le
   * plus récemment, lue en base. Demandée par le volet « Nouvel agent » du
   * tableau de bord pour ranger les projets du plus récent au plus ancien — le
   * navigateur ne peut pas la calculer, les cartes d'un projet non consulté
   * n'y sont pas (ou plus) chargées, et `Project.updatedAt` ne bouge qu'aux
   * réglages du projet.
   */
  z.object({ type: z.literal('projects.activite') }),
  z.object({ type: z.literal('memory.get'), projectId: z.string() }),
  /**
   * Les commandes « / » réellement présentes sur le disque, moteur par moteur
   * (`server/src/commandes-slash.ts`). Demandé quand la barre d'écriture ouvre
   * son menu, jamais poussé d'office : c'est un relevé de fichiers, il n'a
   * aucune raison de voyager avec l'état de départ.
   */
  z.object({ type: z.literal('slash.list'), projectId: z.string() }),

  /* ---------------- L'espace client ---------------- */
  /*
   * LES SEULES COMMANDES OUVERTES AU RÔLE « CLIENT ». La grille qui les ouvre
   * vit dans `shared/src/droits-commandes.ts` et refuse TOUT le reste par
   * défaut ; une commande neuve, ici ou ailleurs, naît donc fermée.
   *
   * Aucune ne porte l'auteur : le serveur le réécrit depuis la session.
   */
  z.object({ type: z.literal('espace.etat'), projectId: z.string().optional(), filId: z.string().optional() }),
  z.object({
    type: z.literal('espace.demande.creer'),
    projectId: z.string(),
    titre: z.string(),
    description: z.string().optional(),
    importance: ImportanceDemande.optional(),
    fichiers: z.array(z.string()).optional(),
    etiquettes: z.array(z.string()).optional(),
    taches: z.array(TacheDemande).optional(),
    echeance: z.number().optional(),
  }),
  z.object({
    type: z.literal('espace.demande.modifier'),
    id: z.string(),
    titre: z.string().optional(),
    description: z.string().optional(),
    importance: ImportanceDemande.optional(),
    fichiers: z.array(z.string()).optional(),
    etiquettes: z.array(z.string()).optional(),
    taches: z.array(TacheDemande).optional(),
    /** `null` efface la date, l'absence la laisse telle quelle. */
    echeance: z.number().nullable().optional(),
    /** Refusée à un client : c'est un ENGAGEMENT de Haiko. */
    livraisonAnnoncee: z.number().nullable().optional(),
  }),
  z.object({
    type: z.literal('espace.demande.deplacer'),
    id: z.string(),
    colonne: ColonneDemande,
    avantId: z.string().optional(),
    apresId: z.string().optional(),
  }),
  z.object({ type: z.literal('espace.demande.lire'), id: z.string() }),
  z.object({
    type: z.literal('espace.demande.commenter'),
    id: z.string(),
    texte: z.string(),
    fichiers: z.array(z.string()).optional(),
  }),
  z.object({ type: z.literal('espace.fil.lire'), filId: z.string().optional() }),
  z.object({
    type: z.literal('espace.fil.envoyer'),
    filId: z.string().optional(),
    texte: z.string(),
    fichiers: z.array(z.string()).optional(),
  }),
  z.object({ type: z.literal('espace.fil.vu'), filId: z.string().optional() }),
  /** Ranger une demande finie, ou la ressortir de la pile des archivées. */
  z.object({ type: z.literal('espace.demande.archiver'), id: z.string(), archivee: z.boolean() }),
  /** Ouvrir une fiche, c'est l'avoir lue : la pastille de CE compte retombe. */
  z.object({ type: z.literal('espace.demande.marquerLu'), id: z.string() }),
  /** L'historique d'activité d'une demande, pour le tiroir. */
  z.object({ type: z.literal('espace.demande.activite'), id: z.string() }),
  /**
   * LA CLOCHE DU COMPTE CONNECTÉ, gardée par le serveur : les plus récentes
   * d'abord, par pages (`avant` = la date de la dernière ligne déjà reçue).
   */
  z.object({
    type: z.literal('espace.notifications.lister'),
    avant: z.number().optional(),
    limite: z.number().optional(),
  }),
  /** Marquer lue UNE notification, ou toutes quand `id` manque. */
  z.object({ type: z.literal('espace.notifications.lire'), id: z.string().optional() }),
  /**
   * LA CLOCHE D'UN CLIENT, VUE PAR HAIKO : ce qui concerne ce seul client.
   * Absente de `COMMANDES_CLIENT` — fermée d'office à un compte client.
   */
  z.object({ type: z.literal('espace.notifications.client'), clientId: z.string() }),
  /** Les archives téléchargeables d'un projet de la portée. */
  z.object({ type: z.literal('espace.backups.lister'), projectId: z.string().optional() }),
  /** Un jeton de téléchargement pour UNE archive, après vérification de portée. */
  z.object({ type: z.literal('espace.backups.telecharger'), pointId: z.string() }),
  /** L'espace « Accès » : son état, et son contenu une fois ouvert. */
  z.object({ type: z.literal('espace.acces.lire'), projectId: z.string().optional() }),
  /** Ouvrir l'espace « Accès » : confirmation explicite, sur la version du texte lue. */
  z.object({
    type: z.literal('espace.acces.deverrouiller'),
    projectId: z.string().optional(),
    confirme: z.boolean(),
    version: z.number(),
  }),
  /** Haiko seul : écrire le contenu libre de l'espace « Accès ». */
  z.object({ type: z.literal('espace.acces.ecrire'), projectId: z.string(), texte: z.string() }),
  /** Haiko seul : refermer l'espace « Accès ». */
  z.object({ type: z.literal('espace.acces.reverrouiller'), projectId: z.string() }),

  /* ---------------- MON COMPTE — et le mien seulement ---------------- */

  /*
   * AUCUNE DE CES COMMANDES NE PORTE D'IDENTIFIANT DE COMPTE. C'est ce qui les
   * rend sûres PAR CONSTRUCTION : le serveur n'a pas à vérifier qu'on ne vise
   * pas le voisin, il n'y a rien à viser. Les `comptes.*`, elles, agissent sur
   * n'importe quel compte et restent fermées au client.
   */
  /** Ce que je peux lire et changer de mon propre compte. */
  z.object({ type: z.literal('espace.moi') }),
  /** Mon thème, gardé sur MON compte : il me suit d'un appareil à l'autre. */
  z.object({ type: z.literal('espace.moi.apparence'), apparence: z.string() }),
  /** Mon nom affiché et mon adresse de courriel. Adresse vide = ne plus m'écrire. */
  z.object({
    type: z.literal('espace.moi.profil'),
    nomAffiche: z.string().optional(),
    courriel: z.string().optional(),
  }),
  /** Mon identifiant de connexion. Le mot de passe actuel est exigé. */
  z.object({ type: z.literal('espace.moi.identifiant'), identifiant: z.string(), motDePasse: z.string() }),
  /** Mon mot de passe. L'actuel est exigé, et toutes mes sessions tombent. */
  z.object({ type: z.literal('espace.moi.motDePasse'), actuel: z.string(), nouveau: z.string() }),

  /* ---------------- Les accès clients, côté Haiko ---------------- */
  z.object({ type: z.literal('comptes.lister') }),
  z.object({
    type: z.literal('comptes.creer'),
    identifiant: z.string(),
    nomAffiche: z.string().optional(),
    /** Le niveau de l'accès : membre, lecteur ou client (jamais administrateur). Client par défaut. */
    role: z.enum(['membre', 'lecteur', 'client']).default('client'),
    projets: z.array(z.string()).default([]),
    /** L'adresse où écrire au client, posée dès la création. Vide = aucune. */
    courriel: z.string().optional(),
    /** Case cochée : ses identifiants lui partent par courriel. Jamais par défaut. */
    envoyerIdentifiants: z.boolean().optional(),
    /** LA GRILLE d'un accès tiers (`droits-d-acces.ts`) : elle fixe son niveau et ses projets. */
    droits: z.any().optional(),
  }),
  /** Pose la grille des droits d'un accès tiers : projet par projet, service par service. */
  z.object({ type: z.literal('comptes.droits'), id: z.string(), droits: z.any() }),
  z.object({ type: z.literal('comptes.portee'), id: z.string(), projets: z.array(z.string()) }),
  /** Change le niveau d'un accès existant (jamais celui d'un administrateur, jamais vers administrateur). */
  z.object({ type: z.literal('comptes.niveau'), id: z.string(), role: z.enum(['membre', 'lecteur', 'client']) }),
  z.object({ type: z.literal('comptes.renommer'), id: z.string(), nomAffiche: z.string() }),
  /** L'adresse où écrire à ce client. Vide = ne rien lui envoyer. */
  z.object({ type: z.literal('comptes.courriel'), id: z.string(), courriel: z.string() }),
  z.object({ type: z.literal('comptes.suspendre'), id: z.string(), suspendu: z.boolean() }),
  z.object({ type: z.literal('comptes.motDePasse'), id: z.string() }),
  z.object({ type: z.literal('comptes.retirer'), id: z.string() }),
  /**
   * Transformer une demande de client en carte Beluga, lien gardé des deux côtés.
   *
   * LES RÉGLAGES DE L'EXÉCUTANT VOYAGENT AVEC LA CONVERSION. La tâche naissait
   * avec les valeurs par défaut du projet ; le moteur, le modèle et le niveau
   * de réflexion se choisissent désormais AU MOMENT de la conversion, et ce
   * sont eux qui portent le cadrage puis l'exécution. Tous facultatifs : sans
   * eux, les défauts du projet s'appliquent comme avant.
   */
  z.object({
    type: z.literal('espace.demande.enCarte'),
    id: z.string(),
    run: z
      .object({
        engine: EngineId.optional(),
        model: z.string().optional(),
        thinking: z.string().optional(),
        account: z.string().optional(),
      })
      .optional(),
  }),
  /** L'espace vu comme Haiko : les clients, leurs kanbans, leurs fils. */
  z.object({ type: z.literal('espace.clients') }),
  /**
   * L'ACCUEIL DE LA MESSAGERIE, EN UN SEUL APPEL. Tous les chiffres de tous les
   * clients — ce qui attend, les tâches ouvertes, le graphique journalier des
   * échanges — pour que l'écran s'affiche d'un coup. Réservée à Haiko.
   *
   * `debut` et `fin` (en millisecondes) portent la période choisie à l'écran.
   * Absents, le serveur prend sa période par défaut ; absurdes, il les remet
   * d'aplomb et REND les bornes qu'il a retenues.
   */
  z.object({
    type: z.literal('espace.tableauDeBord'),
    debut: z.number().optional(),
    fin: z.number().optional(),
  }),
]);
export type ClientCommand = z.infer<typeof ClientCommand>;

export const ClientEnvelope = z.object({
  id: z.string().optional(),
  cmd: ClientCommand,
});
export type ClientEnvelope = z.infer<typeof ClientEnvelope>;

/* ------------------------------------------------------------------ */
/* Serveur → client                                                    */
/* ------------------------------------------------------------------ */

/**
 * LE DIALOGUE D'UNE PROCÉDURE DE MISE EN LIGNE, tel qu'il voyage.
 *
 * Il vit sur le SERVEUR le temps du dialogue (jamais en base : seule la
 * procédure écrite est enregistrée) et l'écran ne fait que le suivre. Les
 * règles qui le lisent — quand reprendre, quoi afficher — sont pures et vivent
 * dans `shared/src/procedure-publication.ts`.
 */
export const EtatProcedure = z.object({
  projectId: z.string(),
  cible: z.enum(['dev', 'production']),
  agentId: z.string().optional(),
  /** Un tour tourne-t-il ? C'est ce seul champ qui allume le témoin de travail. */
  enCours: z.boolean(),
  echanges: z.array(z.object({ qui: z.enum(['agent', 'moi']), texte: z.string() })).default([]),
  procedure: z.string().optional(),
  raison: z.string().optional(),
  depuis: z.number().optional(),
  /**
   * La question posée par l'outil `ask_user` de l'agent, tant qu'elle attend
   * une réponse. Elle s'affichait dans la cloche du bandeau et NULLE PART dans
   * le tiroir ouvert dessous : elle voyage donc avec l'état du dialogue, avec
   * de quoi y répondre sur place.
   */
  question: z
    .object({
      messageId: z.string(),
      questionId: z.string(),
      texte: z.string(),
      options: z
        .array(z.object({ id: z.string(), label: z.string(), description: z.string().optional() }))
        .default([]),
    })
    .optional(),
  /**
   * DEPUIS QUAND L'AGENT EST ARRÊTÉ SUR SA QUESTION. Le serveur le posait déjà
   * (`server/src/procedure-publication.ts`) et le tiroir le lisait déjà, mais
   * il manquait ICI : le schéma retirait le champ au passage, et le témoin du
   * tiroir tournait sans fin sur un agent qui n'avançait plus.
   */
  attendDepuis: z.number().optional(),
});
export type EtatProcedure = z.infer<typeof EtatProcedure>;

export const ServerEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ready'),
    protocol: z.number(),
    version: z.string(),
    /**
     * Le Studio est-il ouvert à CE compte ? Calculé par le démon à la connexion
     * (`shared/src/studio-reserve.ts`) : absent ou faux, l'écran n'en montre
     * aucune entrée.
     */
    studioOuvert: z.boolean().optional(),
    /**
     * Cette machine est-elle sur l'offre hébergée (`shared/src/offre-hebergee.ts`) ?
     * Absent ou faux : sur son propre serveur. L'écran en retire l'étape « Votre
     * propre Beluga » ; le démon, lui, n'inscrit jamais le projet de l'outil.
     */
    offreHebergee: z.boolean().optional(),
    /**
     * Le niveau du compte connecté (`admin`, `membre`, `lecteur`). Absent : un
     * ancien serveur, donc administrateur. L'écran en tire ce qu'il montre ; le
     * serveur, lui, ne s'y fie jamais.
     */
    role: z.enum(['admin', 'membre', 'lecteur']).optional(),
    /** LA GRILLE d'un accès tiers (`droits-d-acces.ts`) : ce que son écran peut montrer. Absente pour l'administrateur. */
    droits: z.any().optional(),
    settings: Settings,
    prefs: z.record(z.any()).default({}),
    projects: z.array(Project),
    groups: z.array(ProjectGroup).default([]),
    engines: z.array(EngineInfo),
    /** Les moteurs ajoutés : le navigateur les pose dans son registre avant tout affichage. */
    moteursAjoutes: z.array(FicheMoteurZ).optional(),
    quotas: z.array(AccountQuota),
    capacity: CapacityEtat,
    agents: z.array(Agent),
    /**
     * LES MISES EN PRODUCTION QUI ONT LEUR CARTE VIOLETTE, tous projets
     * confondus : celles qui tournent, et celles terminées que personne n'a
     * lues. `deploy` (dans `project.etat`) ne dit que la dernière publication
     * du projet OUVERT : sans cette liste, la carte manquerait sur « Tableaux
     * de bord » après un rechargement.
     */
    productions: z.array(DeployRun).optional(),
    /**
     * Le projet dont les cartes sont DÉJÀ en route, poussées juste derrière ce
     * message : le navigateur n'a alors pas à les redemander, ce qui épargne un
     * aller-retour complet avant que le tableau ne s'affiche. Absent, le
     * navigateur demande comme avant.
     */
    openedProjectId: z.string().optional(),
  }),
  z.object({ type: z.literal('pong'), at: z.number() }),
  z.object({
    type: z.literal('ack'),
    id: z.string(),
    ok: z.boolean(),
    data: z.any().optional(),
    error: z.string().optional(),
    /** Une réponse orpheline rediffusée : elle ne part que vers les écrans de CE compte. */
    pour: z.string().optional(),
  }),
  z.object({ type: z.literal('project.upsert'), project: Project }),
  z.object({ type: z.literal('project.delete'), id: z.string() }),
  /** Met un projet de côté sans rien perdre : son tableau et son historique restent. */
  z.object({ type: z.literal('project.archive'), id: z.string(), archived: z.boolean() }),
  z.object({ type: z.literal('groups'), groups: z.array(ProjectGroup) }),
  /**
   * Projets qui attendent une réponse : le compte par projet, ET l'endroit où
   * chaque décision se prend — sans quoi la ligne du projet annoncerait un
   * chiffre que rien à l'écran ne confirme.
   */
  z.object({
    type: z.literal('attention'),
    byProject: z.record(z.number()),
    decisions: z
      .array(
        z.object({
          projectId: z.string(),
          /**
           * La conversation où la décision se prend. Absente quand elle ne
           * tient à aucun fil : l'accord avant envoi se prend dans le bloc de
           * publication du projet.
           */
          agentId: z.string().optional(),
          /** La carte concernée, quand la décision est née dans son travail. */
          cardId: z.string().optional(),
          /* « action » : un GESTE attendu par le parcours d'une carte —
             valider la compréhension (ce qui lance), ou lancer (`attente-de-geste.ts`). */
          genre: z.enum(['question', 'validation', 'incident', 'action']),
          /* Lequel, pour choisir l'icône du repère (`nature-attention.ts`). */
          geste: z.enum(['valider-et-lancer', 'lancer']).optional(),
          reglee: z.boolean().optional(),
          poseeA: z.number().optional(),
        }),
      )
      .default([]),
  }),
  /** Projets dont un agent a rendu son travail sans qu'on l'ait encore lu. */
  z.object({ type: z.literal('rendus'), byProject: z.record(z.number()) }),
  z.object({
    type: z.literal('project.etat'),
    projectId: z.string(),
    /** La PREMIÈRE TRANCHE de chaque colonne, pas toutes les cartes du projet. */
    cards: z.array(Card),
    /** Les agents utiles au tableau : au travail, sur une carte envoyée, ou tout juste finis. */
    agents: z.array(Agent),
    /**
     * Le TOTAL réel de chaque colonne, tel que le démon le compte. C'est lui que
     * lit le compteur de la tête de colonne, et lui qui dit s'il reste des
     * cartes à demander (`cards.tranche`).
     */
    totaux: z.record(z.number()).optional(),
    deploy: DeployRun.optional(),
    memory: z.string().optional(),
  }),
  z.object({ type: z.literal('card.upsert'), card: Card }),
  z.object({ type: z.literal('card.delete'), id: z.string(), projectId: z.string() }),
  /**
   * UNE CARTE A CHANGÉ DE PROJET. Un ÉVÉNEMENT À ELLE, et non un `card.delete`
   * suivi d'un `card.upsert` : entre les deux, la carte n'existerait nulle
   * part, et le tiroir ouvert dessus se refermerait sous les doigts. Ici, les
   * deux compteurs de colonne — l'ancien projet et le nouveau — se corrigent
   * dans le MÊME rendu, et la carte ne disparaît jamais.
   */
  z.object({ type: z.literal('card.deplacee'), card: Card, depuisProjectId: z.string() }),
  /**
   * OÙ EN EST LA PRÉPARATION D'UN LANCEMENT (`shared/src/lancement-en-cours.ts`).
   *
   * Ce qui se passe entre le clic et le premier mot du moteur — portes dures,
   * ouverture de la copie de travail, agent posé — durait parfois des minutes
   * sans qu'un seul signe ne parte à l'écran. L'étape est DIFFUSÉE, jamais
   * enregistrée : aucune préparation ne survit à un redémarrage du démon.
   * `etape` absente = la préparation est finie (ou abandonnée).
   */
  z.object({
    type: z.literal('card.lancement'),
    cardId: z.string(),
    projectId: z.string(),
    etape: z.enum(['portes', 'dossier', 'agent', 'moteur']).optional(),
    depuis: z.number(),
  }),
  z.object({ type: z.literal('agent.upsert'), agent: Agent }),
  z.object({ type: z.literal('agent.delete'), id: z.string() }),
  z.object({
    type: z.literal('agent.etat'),
    agentId: z.string(),
    messages: z.array(Message),
    queue: z.array(QueuedPrompt),
    /** Combien d'échanges dorment derrière le dernier nouveau départ. */
    precedents: z.number().optional(),
  }),
  z.object({
    type: z.literal('card.conversation'),
    cardId: z.string(),
    messages: z.array(Message),
    /** L'agent qui reçoit les nouvelles demandes (le plus récent). */
    activeAgentId: z.string().optional(),
    /**
     * LES AGENTS DE CETTE CARTE, tous : le tableau ne reçoit que les agents
     * de ses cartes visibles, et une carte ouverte depuis une tranche ancienne
     * ou un lien direct n'aurait sinon ni son exécution ni son cadrage.
     */
    agents: z.array(Agent).optional(),
  }),
  z.object({ type: z.literal('message.upsert'), message: Message }),
  /**
   * UNE LIGNE DE PLUS AU JOURNAL D'UNE CARTE (`shared/src/journal-carte.ts`).
   * La ligne de temps du cycle complet grandit ainsi À VUE, sans que l'écran
   * redemande le document entier à chaque appel d'outil.
   */
  z.object({ type: z.literal('journal.entree'), entree: EntreeJournal }),
  /**
   * DES LIGNES DE PLUS AU CARNET DE MÉMOIRE D'UNE CARTE
   * (`shared/src/carnet-memoire.ts`) : le point du flux qui a consommé la
   * mémoire se met à jour à l'instant où elle est servie.
   */
  z.object({ type: z.literal('carnet.lignes'), cardId: z.string(), lignes: z.array(LigneDuCarnet) }),
  z.object({ type: z.literal('queue.etat'), agentId: z.string(), queue: z.array(QueuedPrompt) }),
  z.object({ type: z.literal('deploy.upsert'), run: DeployRun }),
  /**
   * LE DIALOGUE DE PROCÉDURE, diffusé à chaque changement : tour parti, question
   * posée, procédure écrite, tour tombé. C'est ce qui remplace la réponse d'une
   * requête retenue pendant tout le tour — l'écran suit en direct, se rattrape
   * après une coupure, et le témoin de travail s'éteint dès que plus rien ne
   * tourne (`shared/src/procedure-publication.ts`).
   */
  z.object({ type: z.literal('procedure'), etat: EtatProcedure }),
  z.object({ type: z.literal('quotas'), quotas: z.array(AccountQuota) }),
  /**
   * L'ÉTAT DES SITES SURVEILLÉS, rediffusé à chaque tournée et à chaque geste.
   * C'est lui qui allume la pastille du menu : elle doit être juste dans tous
   * les onglets, sans que personne n'ouvre la fenêtre.
   */
  z.object({
    type: z.literal('surveillance'),
    sites: z.array(
      z.object({
        id: z.string(),
        url: z.string(),
        nom: z.string(),
        etat: z.enum(['inconnu', 'ok', 'panne']),
        code: z.number().optional(),
        raison: z.enum(['client', 'serveur', 'delai', 'injoignable', 'vide', 'contenu', 'parcours', 'journaux']).optional(),
        etapeEchouee: z.string().optional(),
        verifieLe: z.number(),
        depuis: z.number(),
        dernierePanne: z.number(),
        creeLe: z.number(),
        recette: z.any().optional(),
        periodeMs: z.number().optional(),
        dureeMs: z.number().optional(),
        agentId: z.string().optional(),
        projectId: z.string().optional(),
        cardId: z.string().optional(),
        // Le contrôle WordPress (`shared/src/surveillance-wordpress.ts`).
        wordpress: z.any().optional(),
        wpResume: z.any().optional(),
        journauxEnErreur: z.any().optional(),
      }),
    ),
  }),
  /**
   * UN ESPACE MARKETING A CHANGÉ : l'écran ouvert sur ce projet se relit. Rien
   * d'autre ne voyage — le détail ne part qu'à qui l'a demandé.
   */
  z.object({ type: z.literal('marketing'), projectId: z.string() }),
  /**
   * LE STUDIO A CHANGÉ (une création, sa bibliothèque, un export) : l'écran
   * ouvert se relit. Un export en cours porte sa progression, sans relecture.
   */
  z.object({
    type: z.literal('studio'),
    projectId: z.string(),
    creationId: z.string().optional(),
    progression: z.object({ exportId: z.string(), valeur: z.number(), etape: z.string() }).optional(),
  }),
  /**
   * LE NAVIGATEUR DU VOLET « PASSER LA VÉRIFICATION » : une image de sa page (JPEG en base64, ses dimensions en
   * pixels CSS), ou un changement d'état. Ne voyage que tant qu'un volet est ouvert.
   */
  z.object({
    type: z.literal('studio.navigateur'),
    sourceId: z.string(),
    etat: z.enum(['ouvert', 'ferme', 'lecture', 'verifie', 'echec']).optional(),
    texte: z.string().optional(),
    image: z.string().optional(),
    largeur: z.number().optional(),
    hauteur: z.number().optional(),
    adresse: z.string().optional(),
  }),
  /**
   * Le catalogue des moteurs, rediffusé quand il a changé — après une
   * connexion de compte réussie, la liste des modèles doit redevenir complète
   * sans attendre le rechargement de la page.
   */
  z.object({ type: z.literal('engines'), engines: z.array(EngineInfo) }),
  /** Les fiches des moteurs AJOUTÉS, entières, rediffusées à chaque changement. */
  z.object({ type: z.literal('moteurs.ajoutes'), fiches: z.array(FicheMoteurZ) }),
  /** Le pool de compétences a changé : une fiche écrite, complétée ou dépréciée. */
  /** Une connexion de compte qui avance : adresse, code, réussite ou échec. */
  z.object({ type: z.literal('connexion-compte'), connexion: ConnexionCompte }),
  z.object({ type: z.literal('capacity'), capacity: CapacityEtat }),
  z.object({ type: z.literal('processes'), processes: z.array(SystemProcess) }),
  z.object({
    type: z.literal('demon'),
    etat: z.object({
      demarreA: z.number(),
      construitA: z.number().optional(),
      agentsEnCours: z.number().optional(),
      agentsDetail: z.array(z.string()).optional(),
      publications: z.array(z.string()).optional(),
      redemarrageEnAttente: z.boolean().optional(),
      redemarrageNecessaire: z.boolean(),
    }),
  }),
  z.object({ type: z.literal('settings'), settings: Settings }),
  /** Un travail d'installation lancé depuis l'écran : son état, puis sa sortie au fil de l'eau. */
  z.object({ type: z.literal('installation.travail'), travail: TravailDInstallation }),
  /* La connexion GitHub par code a changé (réussie, refusée, expirée) : les écrans relisent l'état. */
  z.object({ type: z.literal('installation.github'), connexion: z.record(z.any()) }),
  z.object({ type: z.literal('installation.sortie'), genre: z.string(), donnees: z.string() }),
  z.object({ type: z.literal('installation.nouveautes'), etat: EtatDesNouveautes }),
  z.object({
    type: z.literal('prefs'),
    prefs: z.record(z.any()),
    /** Vrai : `prefs` ne porte que les clés qui changent (`null` = retirée), à fusionner dans le bloc connu. */
    partiel: z.boolean().optional(),
  }),
  /** Des images viennent d'être ouvertes en grand par CE compte, sur un autre de ses appareils. */
  z.object({ type: z.literal('captures.vues'), pour: z.string(), cles: z.array(z.string()) }),
  z.object({ type: z.literal('attachments'), projectId: z.string(), items: z.array(Attachment) }),
  /** LES MÉDIAS EN FABRICATION, liste entière (`shared/src/media-en-fabrication.ts`) : le bloc d'attente du fil. */
  z.object({ type: z.literal('medias.fabrication'), items: z.array(MediaEnFabrication) }),
  /**
   * UNE VEILLE A BOUGÉ (posée, contrôlée, levée, arrêtée, échue) : le nombre de
   * veilles qui courent, pour la tuile du service, et l'heure du changement,
   * pour que la page « Tâches récurrentes » ouverte relise sa liste.
   */
  z.object({ type: z.literal('veilles.compte'), actives: z.number(), a: z.number() }),
  z.object({ type: z.literal('files'), projectId: z.string(), path: z.string(), nodes: z.array(FileNode) }),
  z.object({
    type: z.literal('toast'),
    level: z.enum(['info', 'success', 'warning', 'error']),
    text: z.string(),
    cardId: z.string().optional(),
    /**
     * Le motif, quand le niveau seul ne suffit pas à décider si ce message
     * s'affiche (`genreDuMessage`, `shared/src/notification-tri.ts`).
     */
    motif: z.string().optional(),
  }),
  z.object({
    type: z.literal('notify'),
    title: z.string(),
    body: z.string(),
    tag: z.string().optional(),
    /** Une adresse de l'application (« #studio/verification:<source> ») où mène l'appui, quand l'alerte ne tient à aucune carte. */
    url: z.string().optional(),
    /** Le genre d'événement : c'est lui qui choisit l'image de l'alerte. */
    motif: z.string().optional(),
    /**
     * La phrase déjà rédigée à dire à voix haute, quand Beluga Build a pu la tirer
     * du vrai contenu de la réponse de l'agent. Absente, la voix la refabrique
     * depuis le titre. Voir `shared/src/voix-annonce.ts`.
     */
    voix: z.string().optional(),
    cardId: z.string().optional(),
    projectId: z.string().optional(),
    /** L'agent où la décision se prend quand elle ne tient à aucune carte
        (question du chef d'orchestre) : sans lui, un clic sur la notification
        ne savait ouvrir qu'une carte, jamais une conversation seule. */
    agentId: z.string().optional(),
  }),
  z.object({ type: z.literal('memory'), projectId: z.string(), content: z.string() }),
  /** Le relevé des commandes « / » d'un projet, un tableau par moteur. */
  z.object({
    type: z.literal('slash'),
    projectId: z.string(),
    commandes: z.record(
      z.array(
        z.object({
          nom: z.string(),
          description: z.string().optional(),
          origine: z.enum(['moteur', 'compte', 'projet']),
        }),
      ),
    ),
  }),

  /* ---------------- L'espace client ---------------- */
  /*
   * LES SEULS ÉVÉNEMENTS QU'UN CLIENT PEUT RECEVOIR. Le tri se fait à l'ENVOI
   * (`evenementAutorise`), jamais à l'affichage : un client ne reçoit ni agent,
   * ni carte, ni quota, ni publication.
   */
  z.object({ type: z.literal('espace.demande'), projectId: z.string(), demande: Demande, auteurId: z.string() }),
  z.object({ type: z.literal('espace.demande.retiree'), projectId: z.string(), id: z.string(), auteurId: z.string() }),
  z.object({ type: z.literal('espace.message'), demandeId: z.string(), message: MessageDemande, auteurId: z.string() }),
  z.object({ type: z.literal('espace.fil'), filId: z.string(), message: MessageFil }),
  /** Une ligne de plus dans l'historique d'une demande. */
  z.object({ type: z.literal('espace.activite'), demandeId: z.string(), projectId: z.string(), activite: ActiviteDemande }),
  /**
   * LE CHIFFRE DE LA PASTILLE, poussé au compte qu'il concerne. `pour` porte
   * l'identifiant du compte visé : le bus diffuse à tout le monde, c'est à
   * l'envoi que le tri se fait.
   */
  z.object({
    type: z.literal('espace.nonLus'),
    pour: z.string(),
    messages: z.number(),
    commentaires: z.number(),
    /**
     * LE FIL SUR LEQUEL `messages` A ÉTÉ COMPTÉ, quand il y en a un. Vu comme
     * Haiko, un compte SANS fil est la somme de TOUS les clients : l'écran qui
     * regarde le fil d'un seul client doit le savoir, sinon sa pastille de
     * discussion sauterait au total général à chaque geste.
     */
    filId: z.string().optional(),
  }),
  /** L'espace « Accès » d'un projet vient de s'ouvrir ou de se refermer : l'écran relit. */
  z.object({ type: z.literal('espace.acces'), projectId: z.string(), ouvert: z.boolean() }),
  /**
   * LES DEUX COMPTEURS DE LA MESSAGERIE, poussés à l'administrateur visé : le
   * non-lu (demandes jamais ouvertes, commentaires, messages) et les demandes à
   * traiter. `pour` trie à l'envoi, comme pour `espace.nonLus`.
   */
  z.object({
    type: z.literal('espace.compteurs'),
    pour: z.string(),
    nonLu: z.number(),
    aTraiter: z.number(),
  }),
  /** Une ligne de plus (ou prolongée) dans la cloche d'un client, et son total de non-lues. */
  z.object({
    type: z.literal('espace.notification'),
    pour: z.string(),
    notification: NotificationEspace.optional(),
    nonLues: z.number(),
  }),
  /**
   * Un mot montré au client, et à lui seul : jamais un toast de l'administration.
   * Quand il annonce une notification, il la porte : l'écran rédige alors la
   * phrase dans la langue du lecteur, et un clic mène au même endroit que la cloche.
   */
  z.object({
    type: z.literal('toast.client'),
    filId: z.string(),
    level: z.string(),
    text: z.string(),
    notification: NotificationEspace.optional(),
  }),
  /** La liste des comptes, rafraîchie après chaque geste des réglages. */
  z.object({ type: z.literal('comptes'), comptes: z.array(z.any()) }),
  /**
   * L'ÉTAT DE DÉPART D'UN CLIENT. Rien du premier envoi de l'administration :
   * ni projets, ni moteurs, ni quotas, ni capacité. Qui il est, et c'est tout —
   * son kanban et son fil se demandent ensuite.
   */
  z.object({
    type: z.literal('ready.client'),
    protocol: z.number(),
    version: z.string(),
    moi: z.object({
      id: z.string(),
      identifiant: z.string(),
      nomAffiche: z.string(),
      role: z.enum(['admin', 'client']),
      projets: z.array(z.object({ id: z.string(), nom: z.string() })).default([]),
    }),
  }),
]);
export type ServerEvent = z.infer<typeof ServerEvent>;
