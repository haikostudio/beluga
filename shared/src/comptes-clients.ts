/**
 * LES COMPTES : UN RÔLE, UNE PORTÉE.
 *
 * Beluga s'ouvrait sur un secret UNIQUE : un identifiant, une empreinte, et
 * tout ce qui passait la porte voyait l'application entière. Il y a désormais
 * de VRAIS comptes, chacun avec un RÔLE (« admin » ou « client ») et, pour un
 * client, une PORTÉE : la liste des projets qu'il a le droit de voir.
 *
 * Ce fichier ne garde que les règles PURES — forme d'un identifiant, force d'un
 * mot de passe, portée d'un compte, ce qu'on montre d'un compte à l'écran. Rien
 * n'y touche la base ni le disque : c'est ce qui les rend testables seules.
 */

/** Les deux rôles. Il n'y en a pas de troisième, et il n'y a pas de défaut. */
export type RoleCompte = 'admin' | 'client';

export interface CompteUtilisateur {
  id: string;
  identifiant: string;
  role: RoleCompte;
  /** Le nom montré dans une bulle, un commentaire, la liste des comptes. */
  nomAffiche: string;
  actif: boolean;
  creeLe: number;
  derniereEntree?: number;
  /** Les projets ouverts à ce compte. Vide pour un administrateur : il voit tout. */
  projets: string[];
  /**
   * L'adresse où lui écrire. SANS ELLE, LE RÉCAPITULATIF DU VENDREDI N'A
   * PERSONNE À VISER : un compte sans adresse est simplement sauté, il ne fait
   * pas tomber l'envoi des autres.
   */
  courriel?: string;
  /**
   * L'APPARENCE CHOISIE PAR CE COMPTE, telle qu'on l'enregistre (`ThemeChoisi` :
   * « clair », « sombre », « auto-origine-sombre »…). Un client n'a pas accès
   * aux préférences du serveur : son thème n'avait donc que le stockage local
   * de son navigateur pour mémoire, perdu d'un appareil à l'autre. ABSENTE tant
   * que personne n'a choisi — l'écran suit alors le réglage du système.
   */
  apparence?: string;
}

/**
 * UNE ADRESSE DE COURRIEL, JUGÉE SANS ZÈLE. On ne cherche pas à valider la
 * norme entière — c'est impossible et inutile : on refuse ce qui ne pourra
 * manifestement pas partir, et on laisse passer le reste. Une adresse vide est
 * ACCEPTÉE : elle veut dire « ne m'écrivez pas », ce qui est un choix.
 */
export function jugerCourriel(brut: string): VerdictDeCompte {
  const adresse = brut.trim();
  if (!adresse) return { ok: true };
  if (adresse.length > 200) return { ok: false, raison: "Cette adresse est trop longue." };
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(adresse)) {
    return { ok: false, raison: "Cette adresse de courriel n'a pas la bonne forme." };
  }
  return { ok: true };
}

/** L'adresse rangée : en minuscules, sans espace de bord. Vide = aucune. */
export function courrielNettoye(brut: string | undefined): string | undefined {
  const adresse = (brut ?? '').trim().toLowerCase();
  return adresse || undefined;
}

/** Longueur minimale d'un identifiant de compte. */
export const IDENTIFIANT_MIN = 3;
/** Longueur maximale d'un identifiant de compte. */
export const IDENTIFIANT_MAX = 32;
/** Longueur minimale d'un mot de passe choisi à la main. */
export const MOT_DE_PASSE_MIN = 12;

/** Ce qu'un jugement de compte rend : oui, ou non avec la raison en français simple. */
export interface VerdictDeCompte {
  ok: boolean;
  raison?: string;
}

/**
 * Un identifiant se tape à la main, souvent sur un téléphone : lettres sans
 * accent, chiffres, point, tiret et souligné, rien d'autre. Il est rangé en
 * minuscules pour que « Marc » et « marc » ne soient jamais deux comptes.
 *
 * LES ACCENTS SONT ÔTÉS PLUTÔT QUE REFUSÉS. Un identifiant saisi « Cyprès »
 * devient « cypres » : c'est ce que la personne tapera de toute façon depuis un
 * clavier étranger, et le refuser ne lui apprendrait rien d'utile. La règle
 * `jugerIdentifiant` reste la même — elle juge l'identifiant NORMALISÉ.
 */
export function normaliserIdentifiant(brut: string): string {
  return brut
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function jugerIdentifiant(brut: string): VerdictDeCompte {
  const identifiant = normaliserIdentifiant(brut);
  if (identifiant.length < IDENTIFIANT_MIN) {
    return { ok: false, raison: `L'identifiant fait au moins ${IDENTIFIANT_MIN} signes.` };
  }
  if (identifiant.length > IDENTIFIANT_MAX) {
    return { ok: false, raison: `L'identifiant fait au plus ${IDENTIFIANT_MAX} signes.` };
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(identifiant)) {
    return {
      ok: false,
      raison: "L'identifiant n'accepte que des lettres sans accent, des chiffres, un point, un tiret ou un souligné.",
    };
  }
  return { ok: true };
}

/**
 * La force d'un mot de passe. On ne réclame ni majuscule ni ponctuation : la
 * LONGUEUR est ce qui compte, et un mot de passe tiré au hasard par le serveur
 * la dépasse toujours largement.
 */
export function jugerMotDePasse(mot: string): VerdictDeCompte {
  if (mot.length < MOT_DE_PASSE_MIN) {
    return { ok: false, raison: `Le mot de passe fait au moins ${MOT_DE_PASSE_MIN} signes.` };
  }
  if (/^\s|\s$/.test(mot)) {
    return { ok: false, raison: 'Le mot de passe ne commence ni ne finit par une espace.' };
  }
  return { ok: true };
}

/**
 * CE COMPTE VOIT-IL CE PROJET ? Un administrateur voit tout, toujours. Un
 * client ne voit QUE les projets de sa portée — et un client sans portée ne
 * voit rien du tout, ce qui est le bon défaut : un compte neuf n'ouvre aucune
 * porte tant que personne ne l'a coché.
 */
export function peutVoirProjet(compte: Pick<CompteUtilisateur, 'role' | 'projets'>, projectId: string): boolean {
  if (compte.role === 'admin') return true;
  return compte.projets.includes(projectId);
}

/**
 * LE NOM MONTRÉ, jamais vide. Un compte sans nom affiché se présente par son
 * identifiant : une bulle signée « » n'apprend rien à personne.
 */
export function nomDuCompte(compte: Pick<CompteUtilisateur, 'identifiant' | 'nomAffiche'>): string {
  const nom = compte.nomAffiche.trim();
  return nom || compte.identifiant;
}

/**
 * L'alphabet d'un mot de passe tiré au hasard : ni « l » ni « 1 », ni « O » ni
 * « 0 ». Ce mot de passe se lit à voix haute ou se recopie d'un message, et
 * deux signes qui se ressemblent coûtent un appel.
 */
export const ALPHABET_MOT_DE_PASSE = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Longueur d'un mot de passe tiré au hasard, avant les tirets de lisibilité. */
export const LONGUEUR_MOT_DE_PASSE_TIRE = 20;

/**
 * Met des tirets tous les cinq signes : un mot de passe de vingt signes se
 * recopie alors sans se perdre. Les tirets FONT PARTIE du mot de passe.
 */
export function decouperPourLaLecture(brut: string, pas = 5): string {
  return brut.replace(new RegExp(`(.{${pas}})(?=.)`, 'g'), '$1-');
}

/**
 * LA PORTÉE APRÈS UN CHANGEMENT : on ne garde que des projets connus, sans
 * doublon, et un administrateur n'en porte aucun. Sans ce ménage, un projet
 * supprimé restait coché dans un compte pour toujours.
 */
export function porteeNettoyee(role: RoleCompte, demandes: readonly string[], projetsConnus: readonly string[]): string[] {
  if (role === 'admin') return [];
  const connus = new Set(projetsConnus);
  const vus = new Set<string>();
  const gardes: string[] = [];
  for (const id of demandes) {
    if (!connus.has(id) || vus.has(id)) continue;
    vus.add(id);
    gardes.push(id);
  }
  return gardes;
}

/**
 * CE QU'ON DIT D'UN COMPTE À L'ÉCRAN, en une phrase. Sert la liste des accès
 * dans les réglages, où l'état compte plus que la date exacte.
 */
export function etatDuCompteEnClair(compte: Pick<CompteUtilisateur, 'actif' | 'derniereEntree'>): string {
  if (!compte.actif) return 'Suspendu';
  if (!compte.derniereEntree) return "Jamais entré";
  return 'Actif';
}
