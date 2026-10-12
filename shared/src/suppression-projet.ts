/**
 * SUPPRIMER UN PROJET POUR DE BON : LES RÈGLES, SANS BASE NI DISQUE.
 *
 * Le 22/09/2026, l'ancien bouton « Effacer » a détruit HaikoDev d'un clic. La
 * suppression est revenue le 08/10/2026, mais derrière TROIS verrous qui ne
 * se négocient pas : « Mettre de côté » est proposé d'abord, l'utilisateur
 * recopie le NOM EXACT du projet, et la base entière est sauvegardée avant la
 * première écriture. Ce fichier porte les refus qui ne dépendent d'aucun
 * état du disque : le démon (`server/src/suppression-projet.ts`) les
 * applique, les tests les rejouent seuls.
 */

/** Un dépôt GitHub nommé par son propriétaire et son nom. */
export interface DepotGithubCible {
  proprietaire: string;
  nom: string;
}

/**
 * Le dépôt GitHub visé par l'adresse distante d'un projet (`git@github.com:o/r.git`,
 * `https://github.com/o/r`). `null` pour tout ce qui n'est pas GitHub : on n'efface
 * jamais un dépôt qu'on ne sait pas nommer.
 */
export function depotGithubDeLAdresse(adresse: string | undefined): DepotGithubCible | null {
  const texte = (adresse ?? '').trim();
  if (!texte) return null;
  const forme = texte.match(/^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https?:\/\/(?:[^@/]+@)?github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  if (!forme) return null;
  return { proprietaire: forme[1], nom: forme[2] };
}

export interface ProjetASupprimer {
  name: string;
  isSelf?: boolean;
  regroupement?: boolean;
}

export interface SituationDuProjet {
  projet: ProjetASupprimer;
  /** Ce que l'utilisateur a recopié. */
  nomConfirme: string | undefined;
  /** Les membres encore rattachés, quand le projet est un regroupement. */
  membres: number;
  /** Les titres des agents au travail sur ce projet (tour vivant, tâche, publication). */
  agentsAuTravail: readonly string[];
  /** Une mise en ligne de ce projet tourne-t-elle ? */
  publicationEnCours: boolean;
}

/**
 * Pourquoi ce projet ne peut PAS être supprimé maintenant — `null` si tout est en
 * règle. La première raison rencontrée est rendue, en français simple : c'est
 * ce que l'écran affiche.
 */
export function refusDeSuppressionDeProjet(situation: SituationDuProjet): string | null {
  const { projet, nomConfirme } = situation;
  if (projet.isSelf) {
    return 'Beluga Build ne peut pas se supprimer lui-même.';
  }
  if (projet.regroupement && situation.membres > 0) {
    return 'Ce regroupement réunit encore des projets : les séparer d’abord.';
  }
  if (situation.publicationEnCours) {
    return 'Une mise en ligne de ce projet est en cours : attendre qu’elle se termine.';
  }
  if (situation.agentsAuTravail.length > 0) {
    const noms = situation.agentsAuTravail.slice(0, 3).join(', ');
    return `Un agent travaille encore sur ce projet (${noms}) : l’arrêter ou attendre la fin de son tour.`;
  }
  // Le nom se recopie à l'identique : ni espace en trop, ni casse différente.
  if (nomConfirme !== undefined && nomConfirme !== projet.name) {
    return 'Le nom saisi n’est pas celui du projet.';
  }
  if (nomConfirme === undefined) {
    return 'Le nom du projet doit être recopié pour confirmer.';
  }
  return null;
}

function segments(chemin: string): string[] {
  return chemin.split('/').filter(Boolean);
}

/** `a` est-il `b` ou un dossier qui CONTIENT `b` ? */
function contientOuEgale(a: string, b: string): boolean {
  const sa = segments(a);
  const sb = segments(b);
  return sa.length <= sb.length && sa.every((part, index) => sb[index] === part);
}

export interface DossierASupprimer {
  /** Le dossier déclaré du projet, tel qu'il est en base. */
  dossier: string;
  /** Ce même dossier après résolution des liens (`fs.realpath`), ou `undefined` s'il n'existe pas. */
  dossierReel: string | undefined;
  /** Ce dossier est-il la racine d'un dépôt git ? */
  estUnDepotGit: boolean;
  /** Les dossiers qu'on ne touche JAMAIS : le dépôt de Beluga, ses données, le dossier personnel, etc. */
  proteges: readonly string[];
  /** Les dossiers déclarés par TOUS les autres projets. */
  autresProjets: readonly string[];
}

/**
 * Ce dossier peut-il être effacé ? `null` : oui. Sinon la raison du refus.
 *
 * Le piège évité (MEM-2575) : une cible qui vaut le PARENT d'autre chose.
 * Effacer `/root` ou le dossier qui range d'autres projets est refusé, comme
 * tout dossier qui contient un dossier protégé ou le dossier d'un autre projet.
 */
export function refusDeSupprimerLeDossier(cible: DossierASupprimer): string | null {
  const { dossier } = cible;
  if (!dossier || !dossier.startsWith('/')) return 'Le dossier du projet n’est pas un chemin absolu.';
  if (segments(dossier).some((part) => part === '..' || part === '.')) {
    return 'Le chemin du dossier contient des détours (« .. »).';
  }
  const net = '/' + segments(dossier).join('/');
  if (segments(net).length < 2) {
    return `« ${net} » est trop haut dans l’arborescence pour être effacé.`;
  }
  if (cible.dossierReel === undefined) {
    return 'absent'; // cas traité par l'appelant : rien à effacer, ce n'est pas un blocage.
  }
  if (!cible.estUnDepotGit) {
    return 'Ce dossier n’est pas un dépôt git : il n’est pas effacé par prudence.';
  }
  const aVerifier = [net, cible.dossierReel];
  for (const chemin of aVerifier) {
    for (const protege of cible.proteges) {
      if (protege && contientOuEgale(chemin, protege)) {
        return `« ${chemin} » contient ou est un dossier protégé (« ${protege} »).`;
      }
    }
    for (const autre of cible.autresProjets) {
      if (autre && contientOuEgale(chemin, autre)) {
        return `« ${chemin} » contient le dossier d’un autre projet (« ${autre} »).`;
      }
    }
  }
  return null;
}

/** Le refus « dossier absent » n'est pas un blocage : le dossier est déjà parti. */
export const DOSSIER_ABSENT = 'absent';

/**
 * Ce dossier peut-il être effacé AVEC ÉLÉVATION (`sudo rm -rf`) ? `null` : oui.
 *
 * Les dossiers de projets sous `/root` naissent par `sudo -n mkdir -p`
 * (`server/src/projects.ts`) : le démon n'a pas le droit de les retirer de
 * `/root` sans la même élévation. Ce contrôle est refait JUSTE AVANT l'appel,
 * indépendamment de `refusDeSupprimerLeDossier` : une commande en `root` ne
 * part jamais sur un chemin relatif, à détours, trop haut, ou qui contient un
 * dossier protégé.
 */
export function refusDEffacerEnElevation(dossier: string, proteges: readonly string[]): string | null {
  if (!dossier || !dossier.startsWith('/')) return `« ${dossier} » n’est pas un chemin absolu.`;
  if (segments(dossier).some((part) => part === '..' || part === '.')) return `« ${dossier} » contient des détours.`;
  if (segments(dossier).length < 2) return `« ${dossier} » est trop haut dans l’arborescence.`;
  for (const protege of proteges) {
    if (protege && contientOuEgale(dossier, protege)) return `« ${dossier} » contient ou est un dossier protégé (« ${protege} »).`;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* La copie de secours d'un projet supprimé                             */
/* ------------------------------------------------------------------ */

/** Le début du nom de chaque copie de secours : la purge ne regarde rien d'autre. */
export const PREFIXE_COPIE_PROJET_SUPPRIME = 'projet-supprime-';

/** Décision de l'utilisateur (08/10/2026) : la copie vit 15 jours, puis s'efface sans restauration. */
export const CONSERVATION_COPIE_PROJET_SUPPRIME_MS = 15 * 24 * 3600 * 1000;

/** `projet-supprime-<nom>-<8 signes de l'id>-<AAAA-MM-JJTHH-MM-SS>.tar` : lisible, unique, sans espace. */
export function nomDeCopieDeProjetSupprime(nom: string, id: string, date: Date): string {
  const lisible =
    nom
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'projet';
  const court = id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'sans-id';
  const horodatage = date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${PREFIXE_COPIE_PROJET_SUPPRIME}${lisible}-${court}-${horodatage}.tar`;
}

/** Ce fichier est-il une copie de secours de plus de 15 jours ? Rien d'autre n'est jamais purgé. */
export function copieDeProjetSupprimeAPurger(nomFichier: string, modifieLe: number, maintenant: number): boolean {
  if (!nomFichier.startsWith(PREFIXE_COPIE_PROJET_SUPPRIME) || !nomFichier.endsWith('.tar')) return false;
  return maintenant - modifieLe > CONSERVATION_COPIE_PROJET_SUPPRIME_MS;
}
