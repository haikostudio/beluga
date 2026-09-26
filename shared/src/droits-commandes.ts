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

import type { RoleCompte } from './comptes-clients.js';

/**
 * LES SEULES COMMANDES OUVERTES À UN COMPTE CLIENT. Toutes bornées, côté
 * serveur, aux projets de sa portée et à ses propres demandes — la liste ouvre
 * la porte, elle ne dispense jamais de vérifier la portée.
 */
export const COMMANDES_CLIENT: readonly string[] = [
  // Le minimum vital du canal.
  'hello',
  'ping',
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
  '/api/download',
  '/api/erreur',
  '/api/push/subscribe',
  '/api/push/unsubscribe',
];

/** Cette commande est-elle permise à ce rôle ? Refus par défaut pour un client. */
export function commandeAutorisee(role: RoleCompte, type: string): boolean {
  if (role === 'admin') return true;
  return COMMANDES_CLIENT.includes(type);
}

/** Cet événement peut-il partir vers ce rôle ? Refus par défaut pour un client. */
export function evenementAutorise(role: RoleCompte, type: string): boolean {
  if (role === 'admin') return true;
  return EVENEMENTS_CLIENT.includes(type);
}

/** Cette route `/api/` est-elle permise à ce rôle ? Refus par défaut pour un client. */
export function routeApiAutorisee(role: RoleCompte, route: string): boolean {
  if (role === 'admin') return true;
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
