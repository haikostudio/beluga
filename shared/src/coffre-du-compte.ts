/**
 * LE COFFRE D'UN COMPTE MOTEUR NE SURVIT PAS AU DÉMÉNAGEMENT DU DOSSIER
 * PERSONNEL — ET LA LISTE DES SOUS-TÂCHES EN MEURT EN SILENCE.
 *
 * Le coffre d'un compte Claude de relève (`~/.claude-accounts/<nom>`) partage
 * l'essentiel de ses dossiers avec le compte principal par des LIENS
 * SYMBOLIQUES : `tasks`, `projects`, `settings.json`, `skills`, `hooks`…
 * Ces liens portent un chemin ABSOLU. Le jour où le compte système est
 * renommé (`/home/paseo` → `/home/haiko`, 18/08/2026), la cible déménage, le
 * lien non : les treize liens du coffre sont devenus MORTS.
 *
 * Aucune erreur visible côté HaikoDev, mais le moteur, lui, n'écrit plus rien :
 * l'outil `TaskCreate` range sa liste dans `<coffre>/tasks/<session>/` et échoue
 * sur `ENOENT … /.lock` à CHAQUE appel. Plus aucun agent n'annonce donc de liste
 * de tâches, et les trois affichages qui en vivent s'éteignent d'un coup : le
 * volet au-dessus de la barre d'écriture, le pourcentage en tête de la colonne
 * « En cours » et celui de la ligne du projet dans la colonne de gauche.
 *
 * La règle vit ici, sans disque : elle décide QUELS liens sont à rapatrier et
 * VERS QUOI. Le serveur se contente de lire les liens, d'appliquer, et de
 * vérifier que la nouvelle cible existe avant d'écrire.
 */

/** Le dossier où le moteur range la liste de tâches d'une session. */
export const DOSSIER_DES_TACHES = 'tasks';

/** Un lien du coffre, tel que le disque le donne. */
export interface LienDuCoffre {
  /** Son nom dans le coffre (`tasks`, `settings.json`, …). */
  nom: string;
  /** Le chemin qu'il porte, absolu. */
  cible: string;
  /** La cible existe-t-elle encore ? */
  vivant: boolean;
}

/** Ce qu'il faut réécrire, et vers où. */
export interface ReparationDuCoffre {
  nom: string;
  ancienneCible: string;
  nouvelleCible: string;
}

/**
 * Le même dossier, mais sous le dossier personnel D'AUJOURD'HUI.
 *
 * On ne rapatrie qu'un chemin qui désigne le coffre Claude d'un dossier
 * personnel (`/home/<qui>/.claude/…`, `/root/.claude/…`) : tout autre chemin
 * mort relève d'un autre problème, et le réécrire à l'aveugle ferait pire.
 * Un lien qui pointe DÉJÀ le bon dossier ne bouge pas (`null`).
 */
export function cibleRapatriee(cible: string, home: string): string | null {
  const marque = '/.claude/';
  const index = cible.indexOf(marque);
  if (index <= 0) return null;
  const reste = cible.slice(index + marque.length);
  if (!reste) return null;
  const nouvelle = `${home.replace(/\/+$/, '')}/.claude/${reste}`;
  return nouvelle === cible ? null : nouvelle;
}

/**
 * Les liens morts à rapatrier vers le dossier personnel d'aujourd'hui.
 *
 * Un lien VIVANT n'est jamais touché, même s'il pointe ailleurs : il rend
 * encore service, et c'est peut-être voulu.
 */
export function reparationsDuCoffre(liens: readonly LienDuCoffre[], home: string): ReparationDuCoffre[] {
  const reparations: ReparationDuCoffre[] = [];
  for (const lien of liens) {
    if (lien.vivant) continue;
    const nouvelleCible = cibleRapatriee(lien.cible, home);
    if (!nouvelleCible) continue;
    reparations.push({ nom: lien.nom, ancienneCible: lien.cible, nouvelleCible });
  }
  return reparations;
}
