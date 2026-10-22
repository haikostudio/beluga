/**
 * LE CLOISONNEMENT SE DÉCIDE ICI, ET IL REFUSE PAR DÉFAUT.
 *
 * Le protocole compte des CENTAINES de commandes. Les garder une par une
 * derrière un « si le rôle est… » dispersé dans le code, c'est se promettre
 * qu'une commande neuve, écrite dans six mois, sera fermée — et elle ne le sera
 * pas. La grille est donc INVERSÉE : tout est fermé, et seule une liste NOMMÉE
 * ici s'ouvre au rôle « client ». Une commande neuve est fermée d'office, sans
 * que personne ait à y penser, et un contrôle (`scripts/verif-cloison-client.mjs`)
 * le vérifie à chaque fois.
 *
 * La même règle vaut pour les ÉVÉNEMENTS diffusés par le canal temps réel : un
 * client ne reçoit rien qui ne soit nommé ici. Ni agent, ni carte, ni quota, ni
 * publication.
 */

import type { CompteUtilisateur, RoleCompte } from './comptes-clients.js';
import {
  COMMANDES_DEPLOIEMENT,
  EVENEMENTS_DES_SERVICES,
  SERVICES_OUVRABLES,
  droitsDuCompte,
  niveauDeServiceSuffit,
  niveauDuService,
  serviceDeLaCommande,
  type NiveauProjet,
} from './droits-d-acces.js';

/**
 * LES SEULES COMMANDES OUVERTES À UN COMPTE CLIENT. Toutes bornées, côté
 * serveur, aux projets de sa portée et à ses propres demandes — la liste ouvre
 * la porte, elle ne dispense jamais de vérifier la portée.
 */
export const COMMANDES_CLIENT: readonly string[] = [
  // Le minimum vital du canal.
  'hello',
  'ping',
  // Les réponses perdues pendant une coupure, redemandées à la reconnexion.
  'acks.reclamer',
  // L'espace client, et rien d'autre.
  'espace.etat',
  'espace.demande.creer',
  'espace.demande.modifier',
  'espace.demande.deplacer',
  'espace.demande.lire',
  'espace.demande.commenter',
  'espace.fil.lire',
  'espace.fil.envoyer',
  'espace.fil.vu',
  // Ranger une demande finie, dire qu'on l'a lue, relire son historique.
  'espace.demande.archiver',
  'espace.demande.marquerLu',
  'espace.demande.activite',
  // SA cloche : la lire, et la marquer lue. Le serveur ne sert jamais que les
  // notifications du compte connecté, quel que soit ce que la commande demande.
  'espace.notifications.lister',
  'espace.notifications.lire',
  // Les archives de SON projet : les voir, en télécharger une. Le serveur
  // revérifie la portée du site de l'archive, pas seulement celle demandée.
  'espace.backups.lister',
  'espace.backups.telecharger',
  // L'espace « Accès » : le lire (le contenu ne vient qu'une fois ouvert), et
  // l'ouvrir après la prise de responsabilité.
  'espace.acces.lire',
  'espace.acces.deverrouiller',
  /*
   * MON COMPTE, ET LE MIEN SEULEMENT. Ces commandes ne portent AUCUN
   * identifiant de compte : le serveur agit sur celui du canal, donc viser le
   * voisin est impossible à écrire, pas seulement refusé. C'est ce qui les
   * sépare des `comptes.*`, qui agissent sur n'importe qui et restent fermées.
   */
  'espace.moi',
  'espace.moi.apparence',
  'espace.moi.profil',
  'espace.moi.identifiant',
  'espace.moi.motDePasse',
];

/**
 * MON COMPTE, OUVERT À TOUS LES NIVEAUX : la même liste pour le client, le
 * membre et le lecteur (aucune ne nomme un compte).
 */
const COMMANDES_MON_COMPTE: readonly string[] = COMMANDES_CLIENT.filter((type) => type.startsWith('espace.moi'));

/**
 * CE QUI SE VISE, POUR LES NIVEAUX « MEMBRE » ET « LECTEUR ». Une commande
 * ouverte à un collaborateur dit CE QU'ELLE NOMME, pour que le serveur retrouve
 * le projet visé et le compare à la portée du compte — la liste ouvre la porte,
 * elle ne dispense jamais de vérifier le projet. Une commande dont on ne sait
 * pas dire le projet n'a rien à faire ici.
 *
 * Forme : « genre:champ », plusieurs séparés par « + » (toutes doivent être de
 * la portée). Genres : `projet` (un projet), `carte`, `agent`, `message` (celui
 * d'un agent), `file` (un message en attente). `ids` d'un champ liste : chacun.
 * « aucun » : la commande ne vise rien (le serveur filtre alors la réponse).
 */
export type ViseurDeCommande = string;

/** Lecture seule : ce que voit un LECTEUR, et que le membre voit aussi. */
export const COMMANDES_LECTURE: Readonly<Record<string, ViseurDeCommande>> = {
  hello: 'aucun',
  ping: 'aucun',
  'acks.reclamer': 'aucun',
  // Le périmètre d'écran ne fait que choisir quels détails REÇOIT l'écran ; le tri par portée se fait à l'envoi.
  'ecran.perimetre': 'aucun',
  // La réponse est filtrée sur la portée du compte.
  'project.list': 'aucun',
  'project.open': 'projet:id',
  'project.read': 'projet:projectId',
  'projects.relire': 'projet:ids',
  'cards.tranche': 'projet:projectId',
  'card.get': 'carte:id',
  'card.conversation': 'carte:cardId',
  'card.read': 'carte:cardId',
  'card.unread': 'carte:cardId',
  'carte.lieu-de-service': 'carte:cardId',
  'project.unreadCard': 'projet:projectId',
  'agent.open': 'agent:id',
  'comment.list': 'carte:cardId',
  'files.list': 'projet:projectId',
  'attachments.list': 'projet:projectId',
  'card.branches': 'carte:cardId',
  'card.cahierDocument': 'carte:id',
  'project.cahierDocument': 'projet:projectId',
  'card.realisationDocument': 'carte:id',
  'medias.livres.carte': 'carte:cardId',
  'medias.livres.agent': 'agent:agentId',
};

/** Ce que le MEMBRE fait en plus : piloter les cartes, les agents et les conversations des projets cochés. */
export const COMMANDES_TRAVAIL: Readonly<Record<string, ViseurDeCommande>> = {
  'card.create': 'projet:projectId',
  'card.update': 'carte:id',
  'card.move': 'carte:id',
  'card.delete': 'carte:id',
  'card.supprimerSiVide': 'carte:id',
  'card.deplacerVersProjet': 'carte:id+projet:projectId',
  'card.validate': 'carte:id',
  'card.start': 'carte:id',
  'card.finish': 'carte:id',
  'card.veille.arreter': 'carte:cardId',
  'card.veille.verifier': 'carte:cardId',
  'card.cahierPause': 'carte:id',
  'card.cahierReprendre': 'carte:id',
  'card.asap': 'carte:id',
  'card.schedule': 'carte:id',
  'plan.generer': 'carte:cardId',
  'comprehension.redemander': 'carte:cardId',
  'card.comprehension.supposition': 'carte:cardId',
  'card.comprehension.repondre': 'carte:cardId',
  'card.comprehension.validate': 'carte:cardId',
  'card.plan.souhaite': 'carte:cardId',
  'card.creation.souhaitee': 'carte:cardId',
  'card.realisation.souhaitee': 'carte:cardId',
  'card.realisationPause': 'carte:id',
  'card.realisationReprendre': 'carte:id',
  'card.lancement.automatique': 'carte:cardId',
  'plan.fermerIncident': 'carte:cardId',
  'card.redaction.relancer': 'carte:cardId',
  'agent.reset': 'agent:agentId',
  'agent.prompt': 'agent:agentId',
  'agent.stop': 'agent:agentId',
  'agent.suspend': 'agent:agentId',
  'agent.config': 'agent:agentId',
  'queue.update': 'file:id',
  'queue.remove': 'file:id',
  'queue.send-now': 'file:id',
  'queue.edition': 'file:id',
  'question.answer': 'message:messageId',
  'question.cancel': 'message:messageId',
  'question.cancelTexte': 'message:messageId',
  'question.cancelCarte': 'carte:cardId',
  'competence.ecarter': 'message:messageId',
  'reprise.compte': 'message:messageId',
  'reprise.abandon': 'message:messageId',
  'erreur.repondre': 'message:messageId',
  'proposal.decide': 'message:messageId',
  'proposal.config': 'message:messageId',
  'comment.add': 'carte:cardId',
  'comment.delete': 'carte:cardId',
};

/**
 * CE QUI RESTE FERMÉ, ET POURQUOI — écrit ici pour que l'oubli soit visible.
 *
 * `espace.demande.enCarte` : transformer une demande en carte Beluga est un
 * geste d'ADMIN, et il le reste. Le bouton ne se dessine même pas côté client.
 * `espace.tableauDeBord` : l'accueil de la messagerie montre TOUS les clients
 * à la fois — c'est l'écran de Haiko, un client n'a rien à y voir.
 * `comptes.*` : la gestion des accès n'appartient qu'à Haiko.
 * `espace.acces.ecrire` et `espace.acces.reverrouiller` : le contenu de
 * l'espace « Accès » s'écrit par Haiko, et lui seul peut le refermer — un
 * client qui l'a ouvert en a pris la responsabilité, il ne l'efface pas.
 *
 * L'écriture de `livraisonAnnoncee` n'est PAS une commande : elle voyage dans
 * `espace.demande.modifier`, et c'est `champsModifiables` qui la refuse à un
 * client — la liste blanche ouvre une porte, elle ne trie pas des champs.
 */
export const COMMANDES_FERMEES_AU_CLIENT: readonly string[] = [
  'espace.demande.enCarte',
  'espace.tableauDeBord',
  'espace.acces.ecrire',
  'espace.acces.reverrouiller',
];

/**
 * LES SEULS ÉVÉNEMENTS QU'UN CLIENT REÇOIT. Le bus diffuse à tout le monde :
 * c'est à l'envoi que le tri se fait, jamais à l'affichage.
 */
export const EVENEMENTS_CLIENT: readonly string[] = [
  // La réponse à sa propre commande, et son état de départ.
  'ack',
  'ready.client',
  'espace.demande',
  'espace.demande.retiree',
  'espace.message',
  'espace.fil',
  'toast.client',
  // L'historique d'une demande, et le chiffre de sa propre pastille.
  'espace.activite',
  'espace.nonLus',
  // Une ligne de plus dans SA cloche — trié à l'envoi sur le compte visé.
  'espace.notification',
  // L'espace « Accès » d'un projet de sa portée vient de s'ouvrir ou de se fermer.
  'espace.acces',
];

/**
 * LES SEULES ROUTES `/api/` OUVERTES À UN CLIENT. `/api/me` lui dit qui il est,
 * l'envoi et la lecture d'une pièce jointe servent son kanban — la lecture
 * vérifie en plus, au serveur, que le fichier appartient à quelque chose qu'il
 * a le droit de lire. `/api/download` suit un JETON lié à UN SEUL fichier, émis
 * par `espace.backups.telecharger` après la vérification de portée : la route
 * n'a rien d'autre à vérifier.
 */
export const ROUTES_API_CLIENT: readonly string[] = [
  '/api/me',
  '/api/upload',
  '/api/attachment',
  '/api/attachments/archive',
  '/api/download',
  '/api/erreur',
  '/api/usage',
  '/api/push/subscribe',
  '/api/push/unsubscribe',
];

/** Cette commande est-elle permise à ce rôle ? Refus par défaut pour un client. */
export function commandeAutorisee(role: RoleCompte, type: string): boolean {
  if (role === 'admin') return true;
  if (role === 'lecteur') return Object.hasOwn(COMMANDES_LECTURE, type) || COMMANDES_MON_COMPTE.includes(type);
  if (role === 'membre') {
    return Object.hasOwn(COMMANDES_LECTURE, type) || Object.hasOwn(COMMANDES_TRAVAIL, type) || COMMANDES_MON_COMPTE.includes(type);
  }
  return COMMANDES_CLIENT.includes(type);
}

/**
 * CE QUE VISE UNE COMMANDE POUR UN COLLABORATEUR (`undefined` : rien d'ouvert,
 * donc rien à viser). Le serveur résout ce descripteur en projets et refuse
 * tout ce qui sort de la portée du compte.
 */
export function viseurDeCommande(role: RoleCompte, type: string): ViseurDeCommande | undefined {
  const lecture = Object.hasOwn(COMMANDES_LECTURE, type) ? COMMANDES_LECTURE[type] : undefined;
  if (role === 'lecteur') return lecture;
  if (role === 'membre') return lecture ?? (Object.hasOwn(COMMANDES_TRAVAIL, type) ? COMMANDES_TRAVAIL[type] : undefined);
  return undefined;
}

/**
 * LES ÉVÉNEMENTS QU'UN COLLABORATEUR (membre, lecteur) PEUT RECEVOIR : ceux du
 * tableau, des cartes, des agents et des conversations. Aucun ne part sans que
 * le serveur ait trouvé son projet dans la portée du compte (`vue-collaborateur.ts`),
 * hors le tout petit nombre de signes de vie. Ni quotas, ni comptes, ni réglages,
 * ni processus, ni coffre, ni espace client.
 */
export const EVENEMENTS_COLLABORATEUR: readonly string[] = [
  'ready',
  'pong',
  'ack',
  'project.upsert',
  'project.delete',
  'project.archive',
  'project.etat',
  'attention',
  'rendus',
  'card.upsert',
  'card.delete',
  'card.deplacee',
  'card.lancement',
  'agent.upsert',
  'agent.etat',
  'card.conversation',
  'message.upsert',
  'journal.entree',
  'carnet.lignes',
  'queue.etat',
  'deploy.upsert',
  'attachments',
  'files',
  'memory',
  'engines',
];

/** Cet événement peut-il partir vers ce rôle ? Refus par défaut pour tout autre que l'administrateur. */
export function evenementAutorise(role: RoleCompte, type: string): boolean {
  if (role === 'admin') return true;
  if (role === 'membre' || role === 'lecteur') return EVENEMENTS_COLLABORATEUR.includes(type);
  return EVENEMENTS_CLIENT.includes(type);
}

/**
 * LES ROUTES `/api/` D'UN COLLABORATEUR. Le membre dépose des pièces en plus ;
 * chaque route qu'ils partagent revérifie la portée du projet visé au serveur.
 */
export const ROUTES_API_COLLABORATEUR: readonly string[] = [
  '/api/me',
  '/api/attachment',
  '/api/attachments/archive',
  '/api/favicon',
  '/api/erreur',
  '/api/usage',
  '/api/push/subscribe',
  '/api/push/unsubscribe',
];
const ROUTES_API_MEMBRE_EN_PLUS: readonly string[] = ['/api/upload'];

/** Cette route `/api/` est-elle permise à ce rôle ? Refus par défaut pour tout autre que l'administrateur. */
export function routeApiAutorisee(role: RoleCompte, route: string): boolean {
  if (role === 'admin') return true;
  if (role === 'lecteur') return ROUTES_API_COLLABORATEUR.includes(route);
  if (role === 'membre') return ROUTES_API_COLLABORATEUR.includes(route) || ROUTES_API_MEMBRE_EN_PLUS.includes(route);
  return ROUTES_API_CLIENT.includes(route);
}

/**
 * LE REFUS SE DIT EN CLAIR, ET NE RÉVÈLE RIEN. Le message est le MÊME pour une
 * commande qui existe et pour une commande qui n'existe pas : sinon, la
 * différence des deux réponses dessine la carte de ce qu'on cache.
 */
export const REFUS_HORS_PORTEE = "Cette action ne vous est pas ouverte.";

/**
 * LA PORTÉE D'UN CLIENT SUR UN PROJET, vérifiée AU SERVEUR à chaque commande.
 * Rend le message de refus quand la porte est fermée, `null` quand elle est
 * ouverte — la forme qui rend l'oubli visible à la lecture.
 */
export function refusDePortee(
  role: RoleCompte,
  projetsDuCompte: readonly string[],
  projectId: string | undefined,
): string | null {
  if (role === 'admin') return null;
  if (!projectId) return REFUS_HORS_PORTEE;
  return projetsDuCompte.includes(projectId) ? null : REFUS_HORS_PORTEE;
}

/* ------------------------------------------------------------------ */
/* LA GRILLE DES DROITS D'UN ACCÈS TIERS (`droits-d-acces.ts`)          */
/* ------------------------------------------------------------------ */

type CompteJuge = Pick<CompteUtilisateur, 'role' | 'projets' | 'droits'>;

/**
 * CETTE COMMANDE EST-ELLE OUVERTE À CE COMPTE ? La porte d'entrée : le niveau
 * de base (`commandeAutorisee`), plus ce que la grille ouvre — la mise en
 * ligne si un projet au moins est à « déployer », et les commandes de chaque
 * service ouvert. Le projet visé se vérifie ENSUITE (`niveauRequisPourLaCommande`).
 */
export function commandeOuverteAuCompte(compte: CompteJuge, type: string): boolean {
  if (commandeAutorisee(compte.role, type)) {
    // Un lecteur dont la grille ouvre un projet en travail : le serveur le rangera membre ; en attendant, la grille fait foi.
    return true;
  }
  if (compte.role !== 'membre' && compte.role !== 'lecteur') return false;
  const droits = droitsDuCompte(compte);
  if (Object.hasOwn(COMMANDES_TRAVAIL, type)) return Object.values(droits.projets).some((n) => n !== 'voir');
  if (Object.hasOwn(COMMANDES_DEPLOIEMENT, type)) return Object.values(droits.projets).includes('deployer');
  const service = serviceDeLaCommande(type);
  return !!service && niveauDeServiceSuffit(niveauDuService(droits, service.service), service.requis);
}

/** Ce que vise la commande pour ce compte : celui du niveau, celui de la mise en ligne, ou « aucun » pour un service. */
export function viseurPourLeCompte(compte: CompteJuge, type: string): ViseurDeCommande | undefined {
  if (Object.hasOwn(COMMANDES_LECTURE, type)) return COMMANDES_LECTURE[type];
  if (Object.hasOwn(COMMANDES_TRAVAIL, type)) return COMMANDES_TRAVAIL[type];
  if (Object.hasOwn(COMMANDES_DEPLOIEMENT, type)) return COMMANDES_DEPLOIEMENT[type];
  if (serviceDeLaCommande(type)) return 'aucun';
  return viseurDeCommande(compte.role, type);
}

/** Le niveau qu'exige la commande sur CHAQUE projet qu'elle vise. */
export function niveauRequisPourLaCommande(type: string): NiveauProjet {
  if (Object.hasOwn(COMMANDES_DEPLOIEMENT, type)) return 'deployer';
  if (Object.hasOwn(COMMANDES_TRAVAIL, type)) return 'travailler';
  return 'voir';
}

/** Cet événement global peut-il partir vers ce tiers, d'après les services que sa grille ouvre ? */
export function evenementOuvertParUnService(compte: CompteJuge, type: string): boolean {
  if (compte.role !== 'membre' && compte.role !== 'lecteur') return false;
  const droits = droitsDuCompte(compte);
  return SERVICES_OUVRABLES.some(
    (service) => niveauDuService(droits, service) !== 'aucun' && EVENEMENTS_DES_SERVICES[service].includes(type),
  );
}
