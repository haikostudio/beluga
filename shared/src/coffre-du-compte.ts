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
 *
 * CE COFFRE N'EST QUE LA PREMIÈRE CAUSE. Une fois les liens rapatriés sur tous
 * les comptes, la liste restait absente : le CLI ne DÉCLARE même plus
 * `TaskCreate` aux modèles récents. Seconde cause, indépendante, traitée par
 * `shared/src/liste-de-taches-du-moteur.ts`.
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
 * On ne rapatrie qu'un chemin qui désigne le coffre de CE moteur dans un
 * dossier personnel (`/home/<qui>/.claude/…`, `/root/.codex/…`) : tout autre
 * chemin mort relève d'un autre problème, et le réécrire à l'aveugle ferait
 * pire. Un lien qui pointe DÉJÀ le bon dossier ne bouge pas (`null`).
 */
export function cibleRapatriee(cible: string, home: string, marque = '/.claude/'): string | null {
  const index = cible.indexOf(marque);
  if (index <= 0) return null;
  const reste = cible.slice(index + marque.length);
  if (!reste) return null;
  const nouvelle = `${home.replace(/\/+$/, '')}${marque}${reste}`;
  return nouvelle === cible ? null : nouvelle;
}

/**
 * Les liens morts à rapatrier vers le dossier personnel d'aujourd'hui.
 *
 * Un lien VIVANT n'est jamais touché, même s'il pointe ailleurs : il rend
 * encore service, et c'est peut-être voulu. Un moteur SANS coffre (Cursor) ne
 * rapatrie rien : la liste rendue est vide, et c'est le bon comportement.
 */
export function reparationsDuCoffre(
  liens: readonly LienDuCoffre[],
  home: string,
  moteur = 'claude',
): ReparationDuCoffre[] {
  const marque = marqueDuCoffre(moteur);
  if (!marque) return [];
  const reparations: ReparationDuCoffre[] = [];
  for (const lien of liens) {
    if (lien.vivant) continue;
    const nouvelleCible = cibleRapatriee(lien.cible, home, marque);
    if (!nouvelleCible) continue;
    reparations.push({ nom: lien.nom, ancienneCible: lien.cible, nouvelleCible });
  }
  return reparations;
}

/* ------------------------------------------------------------------ */
/* Les autres moteurs : Codex a un coffre, Cursor n'en a pas           */
/* ------------------------------------------------------------------ */

/**
 * LE MÊME DÉMÉNAGEMENT CASSE LE COFFRE DE CODEX, EN PLUS DISCRET ENCORE.
 *
 * Un compte Codex de relève partage lui aussi ses dossiers avec le compte
 * principal (`~/.codex`) par des liens ABSOLUS : `auth.json` en tête, mais
 * aussi `config.toml`, `sessions`, `memories`… Le jour où le dossier personnel
 * déménage, ces liens meurent exactement comme ceux de Claude — et le moteur
 * n'a alors plus de quoi s'authentifier.
 *
 * CURSOR, lui, N'A PAS DE COFFRE sur la machine : sa clé voyage par
 * l'environnement (`CURSOR_API_KEY`). Il n'y a donc rien à rapatrier, et c'est
 * un CONSTAT, pas un oubli : `marqueDuCoffre('cursor')` rend `null`, et la
 * réparation passe son chemin sans rien inventer.
 */
export type MoteurDuCoffre = 'claude' | 'codex' | 'cursor';

/** Le morceau de chemin qui désigne le coffre de ce moteur, ou `null` s'il n'en a pas. */
export function marqueDuCoffre(moteur: string): string | null {
  if (moteur === 'claude') return '/.claude/';
  if (moteur === 'codex') return '/.codex/';
  return null;
}

/**
 * Les dossiers que ce moteur doit trouver, même sans lien pour les porter.
 *
 * Claude range la liste de sous-tâches de chaque session dans `tasks/` : sans
 * ce dossier, `TaskCreate` échoue en silence et les trois affichages
 * d'avancement s'éteignent. Codex n'a pas d'équivalent — on ne lui fabrique
 * donc aucun dossier au hasard.
 */
export function dossiersDuCoffre(moteur: string): readonly string[] {
  return moteur === 'claude' ? [DOSSIER_DES_TACHES] : [];
}
