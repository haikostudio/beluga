/**
 * LES ACCÈS, PROJET PAR PROJET (carte « Retrouver la gestion des accès clients », 24/11/2026).
 *
 * La page « Accès » des réglages réunit ce qui vivait à deux endroits : les comptes CLIENTS (dans la Messagerie) et
 * les accès TIERS à Beluga (dans « Mon compte »). Elle se lit PAR PROJET : un bloc par projet ajouté, une ligne par
 * personne, et sur chaque ligne UN niveau, parmi quatre :
 *  - `client` : l'espace client et la version de travail du site (rôle `client` + portée) ;
 *  - `voir` (« Lecteur »), `travailler` (« Membre »), `deployer` (« Responsable ») : la grille des droits d'un accès
 *    tiers (`droits-d-acces.ts`).
 *
 * UNE PERSONNE EST CLIENTE OU DE L'ÉQUIPE, JAMAIS LES DEUX : un client n'entre jamais dans l'application
 * d'administration (deux visages choisis par l'adresse). Son niveau varie d'un projet à l'autre, mais toujours de son
 * côté.
 *
 * Ce fichier ne garde que des règles pures : le serveur (`comptes.accesProjet`) et l'écran les partagent.
 */
import type { CompteUtilisateur, RoleCompte } from './comptes-clients.js';
import { droitsDuCompte, type DroitsDAcces, type NiveauProjet, NIVEAUX_PROJET } from './droits-d-acces.js';

/** Le niveau d'une personne sur UN projet. */
export type NiveauDAcces = 'client' | NiveauProjet;

/** Les quatre niveaux, dans l'ordre de l'écran. */
export const NIVEAUX_D_ACCES: readonly NiveauDAcces[] = ['client', 'voir', 'travailler', 'deployer'];

/** Les deux côtés : un compte est l'un ou l'autre. */
export type CoteDuCompte = 'client' | 'equipe';

/** Le nom d'un niveau à l'écran : clé du dictionnaire. */
export function libelleDuNiveauDAcces(niveau: NiveauDAcces): string {
  switch (niveau) {
    case 'client':
      return 'Client';
    case 'voir':
      return 'Lecteur';
    case 'travailler':
      return 'Membre';
    default:
      return 'Responsable';
  }
}

/** Ce que permet un niveau, en une phrase : clé du dictionnaire. */
export function aideDuNiveauDAcces(niveau: NiveauDAcces): string {
  switch (niveau) {
    case 'client':
      return 'Son espace client : ses demandes, la version de travail du site, les backups et l’hébergement.';
    case 'voir':
      return 'Voit le projet dans Beluga sans rien changer.';
    case 'travailler':
      return 'Travaille dans le projet : cartes, conversations, agents.';
    default:
      return 'Travaille dans le projet et peut le mettre en ligne.';
  }
}

/** Le côté d'un niveau. */
export function coteDuNiveau(niveau: NiveauDAcces): CoteDuCompte {
  return niveau === 'client' ? 'client' : 'equipe';
}

/** Le côté d'un compte ; `null` pour un administrateur, qui n'apparaît jamais dans la page. */
export function coteDuCompte(compte: Pick<CompteUtilisateur, 'role'>): CoteDuCompte | null {
  if (compte.role === 'admin') return null;
  return compte.role === 'client' ? 'client' : 'equipe';
}

type CompteDeLaPage = Pick<CompteUtilisateur, 'role' | 'projets'> & { droits?: DroitsDAcces };

/** Le niveau d'un compte sur un projet, ou `null` s'il n'y a pas d'accès. */
export function niveauSurLeProjet(compte: CompteDeLaPage, projectId: string): NiveauDAcces | null {
  if (compte.role === 'admin') return null;
  if (compte.role === 'client') return compte.projets.includes(projectId) ? 'client' : null;
  return droitsDuCompte(compte).projets[projectId] ?? null;
}

/** Les projets où ce compte a un accès (jamais un administrateur). */
export function projetsDuCompte(compte: CompteDeLaPage): string[] {
  if (compte.role === 'admin') return [];
  if (compte.role === 'client') return [...compte.projets];
  return Object.keys(droitsDuCompte(compte).projets);
}

/** Les projets où AU MOINS UNE personne a un accès. */
export function projetsAvecAcces(comptes: readonly CompteDeLaPage[]): Set<string> {
  const ids = new Set<string>();
  for (const compte of comptes) for (const id of projetsDuCompte(compte)) ids.add(id);
  return ids;
}

/**
 * LES PROJETS DE LA PAGE, DANS L'ORDRE. D'abord la liste gardée dans les réglages (`projetsDesAcces`, ordre
 * d'ajout), puis — pour qu'aucun accès ne soit JAMAIS caché — les projets qui ont un accès sans y figurer, par ordre
 * de nom. Un projet inconnu (supprimé, archivé : absent de `projetsActifs`) ne laisse pas de bloc fantôme.
 */
export function projetsDeLaPageAcces(
  liste: readonly string[] | undefined,
  comptes: readonly CompteDeLaPage[],
  projetsActifs: readonly { id: string; name: string }[],
): string[] {
  const actifs = new Map(projetsActifs.map((p) => [p.id, p.name]));
  const vus = new Set<string>();
  const ordre: string[] = [];
  for (const id of liste ?? []) {
    if (!actifs.has(id) || vus.has(id)) continue;
    vus.add(id);
    ordre.push(id);
  }
  const manquants = [...projetsAvecAcces(comptes)]
    .filter((id) => actifs.has(id) && !vus.has(id))
    .sort((a, b) => actifs.get(a)!.localeCompare(actifs.get(b)!, undefined, { sensitivity: 'base' }));
  return [...ordre, ...manquants];
}

/** Un projet se retire-t-il de la liste ? Seulement quand plus personne n'y a d'accès. */
export function projetRetirable(projectId: string, comptes: readonly CompteDeLaPage[]): boolean {
  return !projetsAvecAcces(comptes).has(projectId);
}

/** Les comptes d'un bloc de projet, par nom. */
export function comptesDuProjet<C extends CompteDeLaPage & Pick<CompteUtilisateur, 'identifiant' | 'nomAffiche'>>(
  comptes: readonly C[],
  projectId: string,
): C[] {
  return comptes
    .filter((c) => niveauSurLeProjet(c, projectId) !== null)
    .sort((a, b) => (a.nomAffiche || a.identifiant).localeCompare(b.nomAffiche || b.identifiant, undefined, { sensitivity: 'base' }));
}

/** Les comptes sans aucun projet (le bloc « Sans projet ») : jamais un administrateur. */
export function comptesSansProjet<C extends CompteDeLaPage>(comptes: readonly C[]): C[] {
  return comptes.filter((c) => c.role !== 'admin' && projetsDuCompte(c).length === 0);
}

/** Ce qu'il faut écrire pour poser (ou retirer, `null`) l'accès d'un compte sur UN projet. */
export type ChangementDAcces = { genre: 'portee'; projets: string[] } | { genre: 'droits'; droits: DroitsDAcces };

/**
 * L'ACCÈS D'UN COMPTE APRÈS UN CHANGEMENT SUR UN SEUL PROJET. Seule l'entrée de CE projet change : la portée d'un
 * client ou la grille d'un accès tiers sur les autres projets est recopiée telle quelle. Un niveau de l'autre côté
 * est refusé avec sa raison.
 */
export function accesApresChangement(
  compte: CompteDeLaPage & { role: RoleCompte },
  projectId: string,
  niveau: NiveauDAcces | null,
): ChangementDAcces {
  if (compte.role === 'admin') throw new Error('Un administrateur voit déjà tous les projets.');
  if (compte.role === 'client') {
    if (niveau !== null && niveau !== 'client') {
      throw new Error('Un client n’entre jamais dans Beluga : il ne reçoit qu’un accès Client.');
    }
    const autres = compte.projets.filter((id) => id !== projectId);
    return { genre: 'portee', projets: niveau ? [...autres, projectId] : autres };
  }
  if (niveau === 'client') {
    throw new Error('Une personne de l’équipe ne peut pas recevoir un accès Client : créez-lui un compte client.');
  }
  if (niveau !== null && !NIVEAUX_PROJET.includes(niveau)) throw new Error('Ce niveau n’existe pas.');
  const actuels = droitsDuCompte(compte);
  const projets = { ...actuels.projets };
  if (niveau) projets[projectId] = niveau;
  else delete projets[projectId];
  return { genre: 'droits', droits: { projets, services: { ...actuels.services } } };
}

/** Les comptes qu'on peut AJOUTER à un projet : ceux qui n'y ont pas encore d'accès (jamais un administrateur). */
export function comptesAjoutables<C extends CompteDeLaPage>(comptes: readonly C[], projectId: string): C[] {
  return comptes.filter((c) => c.role !== 'admin' && niveauSurLeProjet(c, projectId) === null);
}
