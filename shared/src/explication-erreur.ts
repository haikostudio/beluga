/**
 * QU'EST-CE QUI S'EST PASSÉ, ET QUE FAIRE ? — LA LECTURE D'UN MESSAGE D'ERREUR.
 *
 * Une erreur d'exécution s'affichait telle que le moteur ou le système l'avait
 * écrite : « ENOENT: no such file or directory, chdir '/root/…' ». Juste, mais
 * muet pour qui ne lit pas de code — et surtout sans la seule chose qui compte :
 * est-ce que ça repartira tout seul, et qu'ai-je à faire ?
 *
 * Ce fichier ne réécrit RIEN et n'efface RIEN : il RECONNAÎT le genre d'une
 * erreur à partir de son texte, et dit s'il est PASSAGER. Les phrases, elles,
 * s'écrivent dans l'écran (`web/src/components/message-view.tsx`), qui seul sait
 * parler les cinq langues du dictionnaire — un texte français cousu ici y
 * échapperait. Le texte d'origine reste affiché sous l'explication : on ne cache
 * jamais ce que la machine a dit.
 *
 * Règle pure : ni base, ni disque, ni réseau — elle se teste seule.
 */

/** Le genre d'une erreur : c'est lui qui choisit la cause et l'action affichées. */
export type GenreErreur =
  | 'dossier'
  | 'droits'
  | 'disque'
  | 'reseau'
  | 'identifiant'
  | 'quota'
  | 'moteur'
  | 'construction';

export interface ErreurReconnue {
  genre: GenreErreur;
  /**
   * Passagère : elle vient d'un dehors qui bouge (réseau, quota, service
   * saturé) et un nouvel essai a de bonnes chances de passer. Durable : rien ne
   * changera tant qu'on n'aura pas agi.
   */
  passagere: boolean;
}

/**
 * L'ORDRE COMPTE. Un même texte peut porter plusieurs indices — « spawn claude
 * ENOENT » parle d'un moteur absent, pas d'un dossier disparu. Les motifs les
 * plus précis passent donc devant les plus larges.
 */
const MOTIFS: ReadonlyArray<{ genre: GenreErreur; passagere: boolean; motif: RegExp }> = [
  {
    genre: 'moteur',
    passagere: false,
    motif: /\bspawn\b|command not found|introuvable dans le PATH|not recognized as an internal/i,
  },
  {
    genre: 'quota',
    passagere: true,
    motif: /\bquota\b|rate.?limit|\b429\b|usage limit|limite (atteinte|de compte)|credit balance/i,
  },
  {
    genre: 'identifiant',
    passagere: false,
    motif: /\b401\b|\b403\b|unauthorized|forbidden|invalid api key|authentication|not logged in|identifiant/i,
  },
  {
    genre: 'disque',
    passagere: false,
    motif: /ENOSPC|no space left|disque plein/i,
  },
  {
    genre: 'droits',
    passagere: false,
    motif: /EACCES|EPERM|permission denied|operation not permitted/i,
  },
  {
    genre: 'reseau',
    passagere: true,
    motif:
      /ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up|network error|timed? ?out|délai dépassé|\b50[234]\b|overloaded/i,
  },
  {
    genre: 'dossier',
    passagere: false,
    motif: /ENOENT|no such file or directory|\bchdir\b|worktree|dossier (de travail )?(introuvable|inaccessible)|inaccessible/i,
  },
  {
    genre: 'construction',
    passagere: false,
    motif: /npm ERR|\btsc\b|build failed|compilation|error TS\d+|exit code [1-9]/i,
  },
];

/**
 * Le genre d'une erreur, ou `null` quand rien n'est reconnu — l'écran affiche
 * alors le texte seul, comme avant : mieux vaut pas d'explication qu'une
 * explication fausse.
 */
export function reconnaitreErreur(texte: string | null | undefined): ErreurReconnue | null {
  const nu = (texte ?? '').trim();
  if (!nu) return null;
  for (const entree of MOTIFS) {
    if (entree.motif.test(nu)) return { genre: entree.genre, passagere: entree.passagere };
  }
  return null;
}
