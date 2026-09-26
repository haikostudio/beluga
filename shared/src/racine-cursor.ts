/**
 * OÙ CURSOR VA VRAIMENT LIRE LES OUTILS DU PROJET.
 *
 * Le CLI ne prend pas de fichier de configuration en argument : il lit
 * `.cursor/mcp.json`. On croyait qu'il le lisait dans le DOSSIER DU TOUR — c'est
 * faux. Constaté sur la machine (`cursor-agent mcp list`) : il remonte jusqu'à
 * la RACINE DU DÉPÔT git qui contient le dossier, et ne lit QUE celle-là. Un
 * `.cursor/mcp.json` posé dans un sous-dossier n'est jamais ouvert, même quand
 * la racine n'en a aucun. Ni `--workspace`, ni `--add-dir` n'y changent rien.
 *
 * Ce détail a fait ATTERRIR DES CARTES PROPOSÉES DANS LA MAUVAISE CONVERSATION.
 * Le chef bridé d'un projet travaille dans un dossier à lui
 * (`<données>/chef-scratch/<projet>`) — qui se trouve être un sous-dossier du
 * dépôt de Beluga Build. Cursor y lisait donc `<beluga>/.cursor/mcp.json`, laissé
 * par le DERNIER tour lancé à la racine de Beluga Build : le pont d'outils partait
 * avec l'identifiant de CET agent-là. La carte proposée par le chef du projet X
 * était écrite dans le fil d'un agent de Beluga Build déjà terminé, et le chef de X
 * s'entendait dire que son pont d'outils n'avait pas démarré.
 *
 * La règle : on n'écrit JAMAIS dans le dépôt d'un autre. Quand le dossier du
 * tour est enterré dans un dépôt qui n'est pas le sien, on l'ISOLE — on en fait
 * une racine à lui — puis on y pose la configuration. La remontée s'arrête là,
 * et chaque tour lit la sienne.
 *
 * Règle pure : ni disque ni processus, seulement des chemins.
 */

/** La marque qui fait d'un dossier une racine aux yeux de Cursor (dossier OU fichier). */
export const MARQUE_DE_RACINE = '.git';

/** Le dossier de la configuration, sous la racine retenue. */
export const DOSSIER_CONFIGURATION = '.cursor';

/** Le fichier que le CLI ouvre. */
export const FICHIER_CONFIGURATION = 'mcp.json';

/** Le dossier lui-même, puis chacun de ses parents, jusqu'à la racine du disque. */
export function dossiersRemontes(cwd: string): string[] {
  const propre = cwd.replace(/\/+$/, '') || '/';
  const dossiers: string[] = [];
  let courant = propre;
  for (;;) {
    dossiers.push(courant);
    if (courant === '/' || !courant.includes('/')) break;
    const parent = courant.slice(0, courant.lastIndexOf('/')) || '/';
    if (parent === courant) break;
    courant = parent;
  }
  return dossiers;
}

/**
 * La racine que Cursor retiendra pour ce dossier : le premier dépôt rencontré en
 * remontant. Aucun dépôt au-dessus : le dossier du tour EST la racine, et sa
 * configuration sera bien lue.
 */
export function racineLueParCursor(cwd: string, estRacineDeDepot: (dossier: string) => boolean): string {
  for (const dossier of dossiersRemontes(cwd)) {
    if (estRacineDeDepot(dossier)) return dossier;
  }
  return dossiersRemontes(cwd)[0] ?? cwd;
}

/** Ce qu'il faut faire avant d'écrire la configuration d'un tour. */
export interface PoseDeConfigurationCursor {
  /** Le dossier où la configuration s'écrit : TOUJOURS celui du tour. */
  dossier: string;
  /** Faut-il d'abord faire de ce dossier une racine à lui, pour qu'elle soit lue ? */
  isoler: boolean;
  /** Quand on isole : le dépôt qui aurait parlé à la place, dit en clair. */
  depotVoisin?: string;
}

/**
 * Où poser la configuration d'un tour, et faut-il isoler son dossier ?
 *
 * Le dossier du tour reste TOUJOURS la cible : écrire dans le dépôt voisin
 * ferait exactement le dégât qu'on répare — deux tours qui se marchent dessus,
 * et un pont d'outils qui annonce le mauvais agent.
 */
export function poseDeConfigurationCursor(cwd: string, racineLue: string): PoseDeConfigurationCursor {
  const dossier = cwd.replace(/\/+$/, '') || '/';
  if (racineLue.replace(/\/+$/, '') === dossier) return { dossier, isoler: false };
  return { dossier, isoler: true, depotVoisin: racineLue };
}
