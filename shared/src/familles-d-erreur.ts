/**
 * UNE ERREUR AFFICHÉE DIT SA CAUSE RÉELLE, EN PHRASE SIMPLE.
 *
 * Constat qui a produit ce fichier (21.09.2026) : un stockage distant décroché
 * s'affichait « ce projet n'est pas déclaré sur un dépôt git », et d'autres
 * pannes remontaient à l'écran telles que la machine les écrit
 * (« spawn git ENOTCONN », « SQLITE_BUSY: database is locked », « HTTP 529 »…).
 * L'utilisateur ne programme pas : il lui faut la CAUSE et le GESTE, pas le
 * code système.
 *
 * La règle, en trois temps :
 *
 *  1. un message déjà écrit pour un humain (une phrase française du démon)
 *     passe TEL QUEL — on ne réécrit pas une phrase juste ;
 *  2. un message TECHNIQUE se range dans une FAMILLE par motifs déterministes
 *     (`familleDeLErreur`), et c'est la phrase de la famille qui s'affiche ;
 *  3. un message technique qu'aucun motif ne reconnaît est confié à Laya,
 *     la petite IA locale (`server/src/explication-d-erreur.ts`), qui choisit
 *     une famille ; sous son seuil de confiance, la famille reste « inconnue »
 *     et sa phrase le dit honnêtement.
 *
 * Le message brut n'est JAMAIS perdu : il part au journal, et reste lisible
 * dans les détails techniques — seulement plus dans la phrase affichée.
 */

import type { QuestionDuJuge, ReponseDuJuge } from './jugement-rapide.js';

export const FAMILLES_D_ERREUR = [
  'stockage-injoignable',
  'sans-depot',
  'quota',
  'machine-saturee',
  'disque-plein',
  'panne-fournisseur',
  'reseau',
  'delai-depasse',
  'acces-refuse',
  'conflit-git',
  'base-occupee',
  'introuvable',
  'bug-interne',
  'panne-exterieure',
  'inconnue',
] as const;

export type FamilleDErreur = (typeof FAMILLES_D_ERREUR)[number];

/**
 * LA PHRASE DE CHAQUE FAMILLE : la cause, puis le geste. Une ou deux phrases
 * courtes, sans code système ni jargon. Affichées telles quelles et traduites
 * dans les cinq langues (`shared/src/traductions.ts`).
 */
export const PHRASES_DES_FAMILLES: Readonly<Record<FamilleDErreur, string>> = {
  'stockage-injoignable':
    'Le stockage où vit ce projet ne répond plus. Votre travail est intact : la connexion se rétablit en général toute seule, réessayez dans une minute.',
  'sans-depot':
    'Ce dossier n’est pas encore suivi par l’historique des versions. Indiquez dans les réglages du projet le dossier qui l’est.',
  quota:
    'La limite d’utilisation du compte est atteinte. Le travail reprendra dès que la limite se libère, ou sur un autre compte.',
  'machine-saturee':
    'Le serveur est trop chargé pour lancer ce travail maintenant. Il repartira dès que la charge retombe.',
  'disque-plein': 'Le disque du serveur est plein. Il faut libérer de la place avant de continuer.',
  'panne-fournisseur':
    'Le service extérieur appelé a une panne passagère de son côté. Rien n’est cassé ici : réessayez dans quelques minutes.',
  reseau: 'La connexion à un service extérieur a échoué. Vérifiez que le service est en ligne, puis réessayez.',
  'delai-depasse': 'L’opération a pris trop de temps et a été interrompue. Réessayez ; si cela se répète, signalez-le.',
  'acces-refuse':
    'L’accès a été refusé : un identifiant est peut-être expiré ou erroné. Vérifiez la fiche correspondante dans le coffre-fort.',
  'conflit-git':
    'Deux versions du même fichier se contredisent. Il faut choisir laquelle garder avant de continuer.',
  'base-occupee': 'La base de données était occupée à cet instant. Réessayez dans quelques secondes.',
  introuvable: 'Un fichier ou un dossier attendu est introuvable. Il a peut-être été déplacé ou supprimé.',
  'bug-interne':
    'L’application a rencontré une erreur interne inattendue. Le détail est conservé dans le journal : signalez-la si elle se répète.',
  'panne-exterieure':
    'Un service, un stockage ou une connexion extérieure a flanché. Réessayez dans un moment ; si cela se répète, signalez-le.',
  inconnue:
    'Une erreur inattendue s’est produite. Le détail technique est conservé dans le journal ; réessayez, et signalez-le si cela se répète.',
};

/**
 * LES MOTIFS, DU PLUS SÛR AU PLUS LARGE. L'ordre compte : « ENOTCONN » dit le
 * stockage même quand le message contient aussi « git », et un 429 est un
 * quota avant d'être une panne du fournisseur.
 */
const MOTIFS: readonly (readonly [FamilleDErreur, RegExp])[] = [
  ['stockage-injoignable', /ENOTCONN|Transport endpoint is not connected|ESTALE|Stale file handle|EHOSTDOWN|\bEIO\b|Input\/output error/i],
  ['sans-depot', /not a git repository/i],
  ['disque-plein', /ENOSPC|No space left on device|disk quota exceeded|SQLITE_FULL/i],
  ['machine-saturee', /EAGAIN|ENOMEM|EMFILE|ENFILE|Resource temporarily unavailable|Cannot allocate memory|Too many open files/i],
  ['quota', /\b429\b|rate.?limit|usage limit|quota|insufficient_quota|limit reached|too many requests/i],
  ['panne-fournisseur', /\b(500|502|503|504|529)\b|overloaded|Service Unavailable|Bad Gateway|Internal Server Error|api_error/i],
  ['delai-depasse', /ETIMEDOUT|timed? ?out|délai de \d+ ?ms dépassé|AbortError|deadline exceeded/i],
  ['reseau', /ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|fetch failed|socket hang up|getaddrinfo/i],
  ['acces-refuse', /EACCES|EPERM|Permission denied|\b(401|403)\b|Unauthorized|Forbidden|invalid.{0,10}(api.?key|token)|authentication/i],
  ['conflit-git', /CONFLICT \(|merge conflict|Automatic merge failed|non-fast-forward|\[rejected\]|unmerged files/i],
  ['base-occupee', /SQLITE_BUSY|SQLITE_LOCKED|database is locked/i],
  ['introuvable', /ENOENT|No such file or directory|ENOTDIR/i],
  ['bug-interne', /^\s*(TypeError|ReferenceError|RangeError|SyntaxError|ZodError)\b|is not a function|is not defined|Cannot read propert|Maximum call stack|Unexpected (end of JSON|token)/i],
];

/**
 * CE MESSAGE EST-IL ÉCRIT PAR LA MACHINE ? Un code système, une trace de
 * pile, un statut HTTP, une sortie de git ou d'SQLite : autant de signes qu'il
 * n'a pas été rédigé pour quelqu'un qui ne programme pas.
 */
const SIGNES_TECHNIQUES =
  /\bE[A-Z]{3,}\b|errno|SQLITE_\w+|HTTP \d{3}|\bstatus(?: code)? \d{3}\b|fatal:|error:|Error\b|Exception|\n\s+at \S|spawn \S|exit code|Cannot read prop|undefined is not|is not a function|Unexpected token|ZodError|\{"/;

/**
 * UNE PHRASE FRANÇAISE DÉJÀ RÉDIGÉE RESTE LA SIENNE, même si elle cite un
 * code (« le site répond HTTP 502 ») : elle a été écrite pour être lue, et la
 * remplacer par une phrase de famille lui ferait perdre sa précision.
 */
const PROSE_FRANCAISE = /[àâéèêëîïôûùç’]|\b(le|la|les|des|une|est|pas|ne|du|au|aux|ce|cette|n'a|n’a|sur|dans|pour)\b/i;

export function estUnMessageTechnique(brut: string | undefined): boolean {
  const texte = brut ?? '';
  if (!SIGNES_TECHNIQUES.test(texte)) return false;
  // Une trace de pile ou un code système en TÊTE trahit la machine, prose ou pas.
  if (/^\s*(\w*Error\b|E[A-Z]{3,}\b|SQLITE_|fatal:|error:|spawn |HTTP \d{3}|\{")/i.test(texte)) return true;
  return !PROSE_FRANCAISE.test(texte);
}

/** La famille reconnue par motif, ou 'inconnue'. Déterministe, sans IA. */
export function familleDeLErreur(brut: string | undefined): FamilleDErreur {
  const texte = brut ?? '';
  for (const [famille, motif] of MOTIFS) if (motif.test(texte)) return famille;
  return 'inconnue';
}

export interface ExplicationDErreur {
  /** La phrase à afficher. */
  phrase: string;
  /** La famille retenue ; absente quand le message était déjà une phrase humaine. */
  famille?: FamilleDErreur;
  /** Le message tel qu'il est arrivé, pour le journal et les détails techniques. */
  brut: string;
  /** Qui a rangé l'erreur : un motif connu, Laya, ou personne (phrase gardée). */
  source: 'telle-quelle' | 'motif' | 'laya' | 'repli';
  /** Faut-il demander à Laya ? Vrai seulement pour un message technique non reconnu. */
  aClasser: boolean;
}

/**
 * L'EXPLICATION SANS IA. Un message humain passe tel quel ; un message
 * technique reconnu prend la phrase de sa famille ; un message technique
 * inconnu prend la phrase honnête « erreur inattendue » et signale qu'il
 * mérite d'être confié à Laya.
 */
export function expliquerLErreur(brut: string | undefined): ExplicationDErreur {
  const texte = (brut ?? '').trim();
  if (!texte) return { phrase: PHRASES_DES_FAMILLES.inconnue, famille: 'inconnue', brut: '', source: 'repli', aClasser: false };
  if (!estUnMessageTechnique(texte)) return { phrase: texte, brut: texte, source: 'telle-quelle', aClasser: false };
  const famille = familleDeLErreur(texte);
  if (famille !== 'inconnue') return { phrase: PHRASES_DES_FAMILLES[famille], famille, brut: texte, source: 'motif', aClasser: false };
  return { phrase: PHRASES_DES_FAMILLES.inconnue, famille: 'inconnue', brut: texte, source: 'repli', aClasser: true };
}

/** La même explication, une fois la famille choisie ailleurs (Laya). */
export function explicationDeFamille(brut: string, famille: FamilleDErreur, source: ExplicationDErreur['source']): ExplicationDErreur {
  return { phrase: PHRASES_DES_FAMILLES[famille], famille, brut, source, aClasser: false };
}

/**
 * LA QUESTION POSÉE AU JUGE LOCAL : DEUX RÉPONSES, PAS TREIZE.
 *
 * Mesuré le 21.09.2026 avec l'ancien modèle : offert treize familles, il
 * tombait presque toujours sur la même, à confiance 1,00 — un mauvais message,
 * pire que « erreur inattendue ». Deux familles larges suffisent à choisir une
 * phrase utile, et une erreur qui penche vers « panne extérieure » (dont la
 * phrase dit « réessayez ») reste sans danger. Les treize familles fines
 * restent l'affaire des motifs, qui ne se trompent pas.
 */
export const FAMILLES_DU_JUGE = ['panne-exterieure', 'bug-interne'] as const satisfies readonly FamilleDErreur[];

export function questionFamilleDErreur(): Record<string, QuestionDuJuge> {
  return {
    famille: {
      type: 'choice',
      instructions: "Is this error message caused by the outside world, or by a bug in the program's own code?",
      criteria: {
        'panne-exterieure': 'Network, remote service, disk, credentials or quota problem: the outside world failed.',
        'bug-interne':
          'Programming error in the code: TypeError, undefined, null, invalid state, syntax error, stack overflow, assertion.',
      },
    },
  };
}

/** La famille lue dans la réponse du juge — ou rien. */
export function familleDeReponse(reponse: ReponseDuJuge | undefined): FamilleDErreur | undefined {
  if (reponse?.type !== 'choice') return undefined;
  return (FAMILLES_DU_JUGE as readonly string[]).includes(reponse.choice) ? (reponse.choice as FamilleDErreur) : undefined;
}

/**
 * LA PHRASE D'UNE ERREUR DE TOUR À L'ÉCRAN : celle que Laya a posée s'il
 * en a posé une, sinon celle que les motifs donnent — et la cause brute telle
 * quelle quand c'était déjà une phrase humaine.
 */
export function phraseDeLErreurDeTour(erreur: { cause: string; phrase?: string }): string {
  return erreur.phrase || expliquerLErreur(erreur.cause).phrase;
}
