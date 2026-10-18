/**
 * RELIER GITHUB À UNE INSTALLATION — les règles pures.
 *
 * Deux voies, et la première est mise en avant :
 *
 *  - LA CONNEXION PAR CODE (« device flow ») : le démon lance l'outil GitHub,
 *    qui affiche un code à usage unique ; l'écran le montre et ouvre la page de
 *    GitHub, où l'on colle le code et accepte. Les droits demandés (`repo`,
 *    `workflow`) ouvrent les dépôts PRIVÉS : rien à régler de plus ;
 *  - LE JETON COLLÉ, gardé derrière un lien discret. Il a fait tomber un piège :
 *    la page « Personal access tokens » de GitHub propose d'abord le jeton « à
 *    grain fin », qui par défaut ne voit QUE les dépôts publics — et la liste
 *    des dépôts proposés à l'ajout d'un projet sortait amputée de tous les
 *    privés, sans rien dire. Un tel jeton est donc REFUSÉ au moment où on le
 *    colle (`refusDuJetonGithub`), avec le lien vers un jeton classique déjà
 *    réglé.
 *
 * Rien ici ne touche au réseau ni au disque : le démon lit, ces règles jugent.
 */

/** La page où l'on colle le code de la connexion par code. */
export const ADRESSE_DE_LA_CONNEXION_PAR_CODE = 'https://github.com/login/device';

/**
 * LA PAGE DE CRÉATION D'UN JETON CLASSIQUE, DÉJÀ RÉGLÉE : droits `repo` et
 * `workflow` cochés, description posée. Il ne reste qu'à choisir une durée.
 */
export const ADRESSE_D_UN_JETON_CLASSIQUE =
  'https://github.com/settings/tokens/new?scopes=repo,workflow&description=Beluga%20Build';

/** Les droits que Beluga Build demande : les dépôts (privés compris) et les fichiers d'automatisation. */
export const DROITS_GITHUB_DEMANDES = ['repo', 'workflow'] as const;

/** La durée de vie d'un code GitHub : quinze minutes, après quoi il faut recommencer. */
export const DUREE_DU_CODE_GITHUB_MS = 15 * 60_000;

/* ------------------------------------------------------------------ */
/* La connexion par code                                               */
/* ------------------------------------------------------------------ */

/** Où en est une connexion par code, telle que l'écran la suit. */
export interface ConnexionGithubParCode {
  etat: 'aucune' | 'attente' | 'reussie' | 'echouee' | 'expiree';
  /** Le code à coller sur la page de GitHub (« ABCD-1234 »). */
  code?: string;
  /** La page où le coller. */
  adresse?: string;
  /** Quand le code cesse de valoir (millisecondes). */
  expireA?: number;
  /** Ce qui a empêché la connexion, en une phrase. */
  erreur?: string;
  /** Le compte relié, une fois la connexion réussie. */
  compte?: string;
}

/**
 * LE CODE ET LA PAGE, LUS DANS CE QUE L'OUTIL GITHUB ÉCRIT. Il écrit, sur sa
 * sortie d'erreur :
 *   ! First copy your one-time code: ABCD-1234
 *   Open this URL to continue in your web browser: https://github.com/login/device
 * La page n'est pas toujours écrite (l'outil essaie d'ouvrir un navigateur) :
 * le code seul suffit, la page est connue.
 */
export function codeDeConnexionLu(sortie: string): { code: string; adresse: string } | null {
  const code = /one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i.exec(sortie ?? '')?.[1];
  if (!code) return null;
  const adresse = /(https:\/\/github\.com\/login\/device\S*)/i.exec(sortie)?.[1] ?? ADRESSE_DE_LA_CONNEXION_PAR_CODE;
  return { code: code.toUpperCase(), adresse };
}

/* ------------------------------------------------------------------ */
/* Le jeton collé                                                      */
/* ------------------------------------------------------------------ */

/** Ce que le démon a lu de GitHub avec le jeton, avant de l'enregistrer. */
export interface LectureDuJetonGithub {
  /** GitHub a-t-il reconnu le jeton (réponse 200 à `/user`) ? */
  reconnu: boolean;
  /** GitHub était-il joignable ? Faux : on ne juge pas le jeton, on le dit. */
  joignable?: boolean;
  /**
   * Les droits d'un jeton CLASSIQUE (entête `X-OAuth-Scopes`). `null` : GitHub
   * n'a pas envoyé l'entête — c'est un jeton à grain fin (ou d'application).
   */
  droits: string[] | null;
  /** Les dépôts privés que le COMPTE possède, selon `/user` (absent : inconnu). */
  privesPossedes?: number;
  /** Les dépôts privés que le JETON voit vraiment (sonde `/user/repos?visibility=private`). */
  privesVisibles?: number;
}

export const REFUS_JETON_INJOIGNABLE = 'GitHub ne répond pas : le jeton n’a pas pu être vérifié. Réessayez dans un instant.';
export const REFUS_JETON_INCONNU = 'GitHub ne reconnaît pas ce jeton : il est faux, expiré ou révoqué.';
export const REFUS_JETON_SANS_DEPOTS_PRIVES =
  'Ce jeton ne voit que les dépôts publics : vos dépôts privés n’apparaîtraient pas. Créez plutôt un jeton classique avec les droits « repo » et « workflow ».';
export const REFUS_JETON_SANS_WORKFLOW =
  'Ce jeton n’a pas le droit « workflow » : Beluga Build ne pourrait pas enregistrer les fichiers d’automatisation de vos dépôts. Créez un jeton classique avec les droits « repo » et « workflow ».';

/**
 * CE JETON PEUT-IL ÊTRE ENREGISTRÉ ? `null` : oui ; sinon la phrase du refus.
 *
 *  - JETON CLASSIQUE : ses droits sont lus dans l'entête. Sans `repo`, il ne
 *    voit que les dépôts publics ; sans `workflow`, il refuserait d'enregistrer
 *    un fichier d'automatisation (`.github/workflows`) — les deux sont exigés ;
 *  - JETON À GRAIN FIN : pas d'entête de droits. On regarde ce qu'il voit : si
 *    le compte possède des dépôts privés (ou si on ne sait pas) et que le jeton
 *    n'en voit aucun, il est limité aux publics. Un compte qui n'a VRAIMENT
 *    aucun dépôt privé n'est pas refusé : il n'a rien à cacher au jeton.
 */
export function refusDuJetonGithub(lecture: LectureDuJetonGithub): string | null {
  if (lecture.joignable === false) return REFUS_JETON_INJOIGNABLE;
  if (!lecture.reconnu) return REFUS_JETON_INCONNU;
  if (lecture.droits) {
    if (!lecture.droits.includes('repo')) return REFUS_JETON_SANS_DEPOTS_PRIVES;
    if (!lecture.droits.includes('workflow')) return REFUS_JETON_SANS_WORKFLOW;
    return null;
  }
  const possedes = lecture.privesPossedes;
  const visibles = lecture.privesVisibles ?? 0;
  if (possedes === 0) return null;
  return visibles > 0 ? null : REFUS_JETON_SANS_DEPOTS_PRIVES;
}

/** Les droits d'un entête `X-OAuth-Scopes` (« repo, workflow, gist »). `null` : pas d'entête. */
export function droitsDeLEntete(entete: string | null | undefined): string[] | null {
  if (entete === null || entete === undefined) return null;
  return entete
    .split(',')
    .map((droit) => droit.trim())
    .filter(Boolean);
}
