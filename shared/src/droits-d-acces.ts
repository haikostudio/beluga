/**
 * LES DROITS D'UN ACCÈS TIERS À BELUGA, PROJET PAR PROJET ET SERVICE PAR SERVICE.
 *
 * Un accès tiers (une personne qui entre dans l'environnement de développement
 * de Beluga, sans être administrateur) avait UN niveau pour tout (« membre » ou
 * « lecteur ») et une liste de projets cochés. Il a désormais une GRILLE :
 *  - pour chaque projet ouvert : `voir`, `travailler` (cartes, conversations,
 *    agents) ou `deployer` (travailler, plus publier et mettre en production) ;
 *    un projet absent de la grille est fermé ;
 *  - pour chaque service sensible : `aucun`, `voir` ou `modifier`.
 *
 * Les comptes CLIENTS (espace client) ne passent jamais par ici : ils se créent
 * depuis la messagerie, et n'ont que leur espace.
 *
 * Le niveau rangé en base (`membre` / `lecteur`) se DÉDUIT de la grille
 * (`roleDesDroits`) : tout ce qui lisait le niveau continue de marcher, et la
 * liste des projets ouverts (`user_projects`) reste la clé de la portée.
 *
 * TOUT EST FERMÉ PAR DÉFAUT (`DROITS_VIDES`) : un premier accès créé n'ouvre
 * rien tant que personne n'a coché ; les suivants reprennent la grille du
 * dernier accès créé (`droitsDeDepart`).
 */
import type { CompteUtilisateur } from './comptes-clients.js';

export type NiveauProjet = 'voir' | 'travailler' | 'deployer';
export type NiveauService = 'aucun' | 'voir' | 'modifier';

/** Les niveaux d'un projet, du plus étroit au plus large. */
export const NIVEAUX_PROJET: readonly NiveauProjet[] = ['voir', 'travailler', 'deployer'];
export const NIVEAUX_SERVICE: readonly NiveauService[] = ['aucun', 'voir', 'modifier'];

/**
 * LES SERVICES QU'ON PEUT OUVRIR À UN TIERS (décision de cadrage du
 * 18/10/2026). La mise en ligne n'y est pas : elle se donne projet par projet
 * (`deployer`). La gestion des accès reste à l'administrateur, sans case.
 */
export type ServiceOuvrable = 'coffre' | 'reglages' | 'moteurs';
export const SERVICES_OUVRABLES: readonly ServiceOuvrable[] = ['coffre', 'reglages', 'moteurs'];

/** Le nom d'un service à l'écran : clé du dictionnaire. */
export function libelleDuService(service: ServiceOuvrable): string {
  switch (service) {
    case 'coffre':
      return 'Coffre-fort (identifiants)';
    case 'reglages':
      return 'Réglages de Beluga';
    default:
      return 'Comptes des moteurs et consommation';
  }
}

/** Ce que couvre un service, en une phrase : clé du dictionnaire. */
export function aideDuService(service: ServiceOuvrable): string {
  switch (service) {
    case 'coffre':
      return 'Les fiches des projets ouverts à cet accès, et elles seules.';
    case 'reglages':
      return 'Les réglages généraux de l’application.';
    default:
      return 'Les abonnements des agents et leurs quotas.';
  }
}

/** Le nom d'un niveau à l'écran : clé du dictionnaire. */
export function libelleDuNiveau(niveau: 'ferme' | NiveauProjet | NiveauService): string {
  switch (niveau) {
    case 'ferme':
      return 'Fermé';
    case 'voir':
      return 'Voir';
    case 'travailler':
      return 'Travailler';
    case 'deployer':
      return 'Déployer';
    case 'modifier':
      return 'Modifier';
    default:
      return 'Aucun';
  }
}

export interface DroitsDAcces {
  /** Projet ouvert → son niveau. Absent : fermé. */
  projets: Record<string, NiveauProjet>;
  /** Service → son niveau. Absent : `aucun`. */
  services: Partial<Record<ServiceOuvrable, NiveauService>>;
}

export const DROITS_VIDES: DroitsDAcces = Object.freeze({ projets: {}, services: {} }) as DroitsDAcces;

/** Lit une grille venue de la base ou du réseau : tout ce qui n'est pas reconnu tombe (fermé). */
export function droitsLus(brut: unknown, projetsConnus?: readonly string[]): DroitsDAcces {
  const droits: DroitsDAcces = { projets: {}, services: {} };
  if (!brut || typeof brut !== 'object') return droits;
  const o = brut as Record<string, unknown>;
  const projets = o.projets && typeof o.projets === 'object' ? (o.projets as Record<string, unknown>) : {};
  for (const [id, niveau] of Object.entries(projets)) {
    if (projetsConnus && !projetsConnus.includes(id)) continue;
    if (NIVEAUX_PROJET.includes(niveau as NiveauProjet)) droits.projets[id] = niveau as NiveauProjet;
  }
  const services = o.services && typeof o.services === 'object' ? (o.services as Record<string, unknown>) : {};
  for (const service of SERVICES_OUVRABLES) {
    const niveau = services[service];
    if (niveau === 'voir' || niveau === 'modifier') droits.services[service] = niveau;
  }
  return droits;
}

/** Le niveau rangé en base, déduit de la grille : un seul projet où l'on travaille fait un membre. */
export function roleDesDroits(droits: DroitsDAcces): 'membre' | 'lecteur' {
  return Object.values(droits.projets).some((niveau) => niveau !== 'voir') ? 'membre' : 'lecteur';
}

/** Les projets ouverts par la grille : la portée du compte. */
export function projetsDesDroits(droits: DroitsDAcces): string[] {
  return Object.keys(droits.projets).sort();
}

/**
 * LA GRILLE D'UN COMPTE, même ancien. Un accès créé avant la grille n'a que
 * son niveau et ses projets : un membre « travaille » sur chacun, un lecteur
 * les « voit », et aucun service ne lui est ouvert — exactement ce qu'il avait.
 */
export function droitsDuCompte(compte: Pick<CompteUtilisateur, 'role' | 'projets'> & { droits?: DroitsDAcces }): DroitsDAcces {
  if (compte.droits) return compte.droits;
  const niveau: NiveauProjet = compte.role === 'membre' ? 'travailler' : 'voir';
  return { projets: Object.fromEntries(compte.projets.map((id) => [id, niveau])), services: {} };
}

/** Ce niveau couvre-t-il celui demandé ? (`deployer` couvre `travailler`, qui couvre `voir`.) */
export function niveauSuffit(niveau: NiveauProjet | undefined, requis: NiveauProjet): boolean {
  if (!niveau) return false;
  return NIVEAUX_PROJET.indexOf(niveau) >= NIVEAUX_PROJET.indexOf(requis);
}

/** Le niveau d'un service pour ce compte (`aucun` par défaut). */
export function niveauDuService(droits: DroitsDAcces, service: ServiceOuvrable): NiveauService {
  return droits.services[service] ?? 'aucun';
}

/**
 * LE FORMULAIRE D'UN NOUVEL ACCÈS : le tout premier part de « rien d'ouvert »,
 * les suivants reprennent la grille du DERNIER accès créé (décision du
 * 18/10/2026), ramenée aux projets qui existent encore.
 */
export function droitsDeDepart(
  comptes: readonly (Pick<CompteUtilisateur, 'role' | 'projets' | 'creeLe'> & { droits?: DroitsDAcces })[],
  projetsConnus: readonly string[],
): DroitsDAcces {
  const tiers = comptes.filter((c) => c.role === 'membre' || c.role === 'lecteur');
  if (!tiers.length) return { projets: {}, services: {} };
  const dernier = [...tiers].sort((a, b) => b.creeLe - a.creeLe)[0]!;
  return droitsLus(droitsDuCompte(dernier), projetsConnus);
}

/**
 * LES COMMANDES DE LA MISE EN LIGNE, ouvertes projet par projet au niveau
 * `deployer`. Seules celles qui NOMMENT leur projet : arrêter ou relancer une
 * publication en cours (par son numéro de passage) reste à l'administrateur.
 */
export const COMMANDES_DEPLOIEMENT: Readonly<Record<string, string>> = {
  'deploy.start': 'projet:projectId',
  'deploy.check': 'projet:projectId',
  'deploy.selection': 'projet:projectId',
  'deploy.ficherSansCarte': 'projet:projectId',
  'deploy.historique': 'projet:projectId',
  'deploy.etatProduction': 'projet:projectId',
  'deploy.reussites': 'projet:projectId',
};

/**
 * LES COMMANDES DE CHAQUE SERVICE, par niveau. Le coffre est en plus borné, au
 * serveur, aux fiches des projets ouverts (`vue-collaborateur.ts`) ; ses
 * dossiers, communs à tous les projets, restent à l'administrateur.
 */
export const COMMANDES_DES_SERVICES: Readonly<Record<ServiceOuvrable, { voir: readonly string[]; modifier: readonly string[] }>> = {
  coffre: {
    voir: ['coffre.lister'],
    modifier: ['coffre.enregistrer', 'coffre.supprimer', 'coffre.restaurer', 'coffre.ranger'],
  },
  reglages: {
    voir: ['settings.get'],
    modifier: ['settings.update'],
  },
  moteurs: {
    voir: ['engines.list', 'quota.history', 'account.connections', 'moteurs.ajoutes'],
    modifier: [
      'quota.refresh',
      'account.connect',
      'account.code',
      'account.cancel',
      'account.voie',
      'account.adresseDeRetour',
      'compte.reprendreConnexion',
      'account.disable',
      'account.rename',
      'account.forfaitMensuel',
      'account.remove',
      'moteurs.agent',
      'moteurs.retirer',
      'moteurs.eprouver',
    ],
  },
};

/** Le service d'une commande et le niveau qu'elle exige, ou `null` si elle n'appartient à aucun. */
export function serviceDeLaCommande(type: string): { service: ServiceOuvrable; requis: 'voir' | 'modifier' } | null {
  for (const service of SERVICES_OUVRABLES) {
    const listes = COMMANDES_DES_SERVICES[service];
    if (listes.voir.includes(type)) return { service, requis: 'voir' };
    if (listes.modifier.includes(type)) return { service, requis: 'modifier' };
  }
  return null;
}

/** Ce niveau de service couvre-t-il celui demandé ? */
export function niveauDeServiceSuffit(niveau: NiveauService, requis: 'voir' | 'modifier'): boolean {
  return requis === 'voir' ? niveau !== 'aucun' : niveau === 'modifier';
}

/** Les événements globaux qu'un service ouvert laisse passer vers un tiers. */
export const EVENEMENTS_DES_SERVICES: Readonly<Record<ServiceOuvrable, readonly string[]>> = {
  coffre: [],
  reglages: ['settings'],
  moteurs: ['quotas', 'moteurs.ajoutes'],
};
