import { SUITES_MAX, TITRE_MAX_D_UNE_SUITE, DESCRIPTION_MAX_D_UNE_SUITE, type SuiteProposee } from './suites-proposees.js';

/**
 * LE CONTRÔLE DE SÉCURITÉ PROPOSÉ AU BON MOMENT — sans un signe de plus dans la consigne.
 *
 * C'est le DÉMON qui décide, à la fin d'un tour de carte, et pas l'agent : une ligne ajoutée à
 * la consigne système se paierait à chaque tour, et la consigne doit rester identique d'un tour
 * à l'autre (DEC-109, cache par préfixe). Deux moments déclenchent la proposition :
 *
 *  - le message reçu contient une COMMANDE COLLÉE (shell, `curl … | sh`, `sudo`, script) ;
 *  - le tour a TOUCHÉ une partie sensible du code (connexion, paiement, envoi de fichiers,
 *    API ouverte, requête en base, commande système), repérée par les chemins ET les lignes
 *    ajoutées du diff de la copie de la carte.
 *
 * La proposition est une SUITE (`Message.suites`, même rendu que `proposer_suites`), jamais une
 * alerte : trois genres alertent, pas un de plus (MEM-0490). Son titre est la commande
 * « /securite <cible> » : un clic la dépose dans la barre d'écriture, l'envoi lance le contrôle.
 * Elle ne se répète pas : les genres déjà proposés sont gardés sur la carte (colonne
 * `securite_proposee`) et seul un genre NOUVEAU la fait reparaître (`doitProposer`).
 *
 * Règle pure, éprouvée dans `server/src/test/proposition-securite.test.ts`.
 */

export const GENRES_SENSIBLES = [
  'commande-collee',
  'connexion',
  'paiement',
  'televersement',
  'api-ouverte',
  'requete-base',
  'commande-systeme',
] as const;
export type GenreSensible = (typeof GENRES_SENSIBLES)[number];

/** Ce que la suite nomme, en mots courants — c'est aussi la précision passée à « /securite ». */
export const CIBLE_DU_GENRE: Record<GenreSensible, string> = {
  'commande-collee': 'la commande collée',
  connexion: 'la connexion',
  paiement: 'le paiement',
  televersement: "l'envoi de fichiers",
  'api-ouverte': "l'API ouverte",
  'requete-base': 'les requêtes en base',
  'commande-systeme': 'les commandes système',
};

/* ------------------------------------------------------------------ */
/* Commande collée                                                     */
/* ------------------------------------------------------------------ */

const OUTILS_EN_TETE =
  /^(?:npm|npx|pnpm|yarn|bun|pip3?|apt(?:-get)?|brew|docker|systemctl|ssh|scp|git|kubectl|composer|cargo)\s+(?:-{1,2}[a-z][\w-]*|install|i|run|add|remove|up|down|exec|restart|start|stop|clone|push|pull|reset|checkout|update|upgrade|build|ci|compose|rm|apply|delete|enable|disable)\b/;

const MOTIFS_DE_COMMANDE: readonly RegExp[] = [
  /^```(?:bash|sh|zsh|shell|console|powershell|ps1)\b/m, // bloc de code shell
  /^#!\//m, // en-tête de script
  /^\s*\$\s+[a-z][\w./-]*/m, // invite « $ commande »
  /^\s*sudo\s+[a-z][\w.-]*/m, // sudo en tête de ligne
  /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/, // curl … | sh
  /\b(?:ba|z)?sh\s+<\(\s*(?:curl|wget)\b/, // bash <(curl …)
  /^\s*chmod\s+(?:[ugoa]*\+x|[0-7]{3,4})\s+\S/m,
  /\brm\s+-(?:[a-z]*r[a-z]*f|[a-z]*f[a-z]*r)[a-z]*\s+\S/, // rm -rf
  /\beval\s+"\$\(/, // eval "$(…)"
  /\b(?:iex|Invoke-Expression)\s*[(\s]/, // PowerShell
];

/**
 * Le message porte-t-il une commande à lancer, collée telle quelle ? Les tags « [fichier: …] »
 * et les commandes « / » de Beluga sont écartés : citer un chemin, un outil (« npm ») ou un
 * dossier (« /root ») dans une phrase ne déclenche rien.
 */
export function commandeCollee(texte: string): 'commande-collee' | null {
  const nettoye = String(texte ?? '')
    .replace(/\[fichier:[^\]]*\]/gi, ' ')
    .split('\n')
    .filter((ligne) => !/^\s*\/[a-z]/i.test(ligne))
    .join('\n');
  if (!nettoye.trim()) return null;
  if (MOTIFS_DE_COMMANDE.some((motif) => motif.test(nettoye))) return 'commande-collee';
  for (const ligne of nettoye.split('\n')) if (OUTILS_EN_TETE.test(ligne.trim())) return 'commande-collee';
  return null;
}

/* ------------------------------------------------------------------ */
/* Travail sensible                                                    */
/* ------------------------------------------------------------------ */

export interface FichierDuTour {
  chemin: string;
  /** Les lignes AJOUTÉES par le tour (bornées par l'appelant). */
  ajouts: readonly string[];
}

const CODE = /\.(?:[cm]?[jt]sx?|py|php|rb|go|rs|java|kt|cs|sql|sh|vue|svelte|astro)$/i;
const ECARTES =
  /(?:^|\/)(?:dist|build|out|node_modules|vendor|data|coverage|\.next|\.nuxt|docs?)\/|(?:^|\/)(?:test|tests|__tests__|spec)\/|\.(?:test|spec)\.[a-z]+$|(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|Cargo\.lock)$/i;

/** Un fichier qui compte : du code, hors construits, dépendances, données, documentation et tests. */
export function fichierACompter(chemin: string): boolean {
  return CODE.test(chemin) && !ECARTES.test(chemin);
}

/* Les mots du CHEMIN, coupés sur / . _ - : « auth-middleware.ts » donne « auth ». Les mots
   « session » et « token/jeton » sont exclus exprès : ils désignent aussi les sessions et les
   jetons d'un moteur, et feraient du bruit à chaque tour. */
const CHEMIN_DU_GENRE: Partial<Record<GenreSensible, RegExp>> = {
  connexion: /^(?:auth\w*|login|logout|signin|signup|oauth\w*|passwords?|passwd|connexion|sso|2fa|totp|mot-de-passe)$/,
  paiement: /^(?:stripe|payments?|paiements?|checkout|billing|paypal|abonnements?|subscriptions?)$/,
  televersement: /^(?:uploads?|uploader|televersements?|multer)$/,
};

const LIGNES_DU_GENRE: Partial<Record<GenreSensible, RegExp>> = {
  connexion: /\b(?:bcrypt|argon2|jsonwebtoken|jwt\.(?:sign|verify)|passport\.|req\.session\b|setCookie\s*\(|signInWith\w*|verifyPassword|hashPassword)\b/,
  paiement: /\b(?:stripe\.|new Stripe\(|paymentIntents?|checkout\.sessions|paypal\.)/i,
  televersement: /\b(?:multer|busboy|formidable|multipart\/form-data|req\.files?\b|type=["']file["'])/,
  'api-ouverte':
    /\b(?:app|router|server|fastify|api)\.(?:get|post|put|patch|delete|all|route)\s*\(\s*['"`]\/|export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE)\b|Access-Control-Allow-Origin|\bcors\s*\(/,
  'requete-base':
    /\b(?:SELECT\s+[\w*,\s.]+\s+FROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b|\.(?:prepare|query|raw|execute)\s*\(\s*[`'"]/i,
  'commande-systeme':
    /\b(?:child_process|execSync|execFileSync|spawnSync|shell_exec|passthru|os\.system|subprocess\.(?:run|Popen|call))\b|\b(?:exec|spawn|execFile)\s*\(\s*[`'"\w]|\bshell:\s*true\b/,
};

/** Les genres sensibles touchés par le tour, d'après ses chemins et ses lignes ajoutées. */
export function genresSensibles(fichiers: readonly FichierDuTour[]): Set<GenreSensible> {
  const trouves = new Set<GenreSensible>();
  for (const fichier of fichiers) {
    const chemin = fichier.chemin.replace(/\\/g, '/');
    if (!fichierACompter(chemin)) continue;
    const mots = chemin.toLowerCase().split(/[/._]+/).flatMap((m) => [m, ...m.split('-')]);
    for (const [genre, motif] of Object.entries(CHEMIN_DU_GENRE) as [GenreSensible, RegExp][]) {
      if (mots.some((mot) => motif.test(mot)) || (genre === 'connexion' && /mot-de-passe/.test(chemin))) trouves.add(genre);
    }
    for (const ligne of fichier.ajouts) {
      const l = ligne.trim();
      if (!l || /^(?:\/\/|\*|\/\*|#)/.test(l)) continue; // un commentaire ne fait rien
      for (const [genre, motif] of Object.entries(LIGNES_DU_GENRE) as [GenreSensible, RegExp][]) {
        if (!trouves.has(genre) && motif.test(l)) trouves.add(genre);
      }
    }
  }
  return trouves;
}

/* ------------------------------------------------------------------ */
/* Une fois par carte, sauf genre nouveau                              */
/* ------------------------------------------------------------------ */

/** Relit la colonne `securite_proposee` (genres séparés par des virgules), sans genre inconnu. */
export function lireGenresProposes(brut: unknown): GenreSensible[] {
  const liste = Array.isArray(brut) ? brut : String(brut ?? '').split(',');
  return GENRES_SENSIBLES.filter((g) => liste.map((x) => String(x).trim()).includes(g));
}

/** Les genres trouvés qui n'ont PAS encore été proposés sur cette carte, dans l'ordre fixe. */
export function doitProposer(dejaProposes: readonly string[], trouves: Iterable<GenreSensible>): GenreSensible[] {
  const deja = new Set(dejaProposes);
  const vus = new Set(trouves);
  return GENRES_SENSIBLES.filter((g) => vus.has(g) && !deja.has(g));
}

/* ------------------------------------------------------------------ */
/* La suite posée sous la réponse                                      */
/* ------------------------------------------------------------------ */

export const COMMANDE_DU_CONTROLE = '/securite';

/** La suite « /securite <cible> », titre et description sous les plafonds de `proposer_suites`. */
export function suiteDuControle(genres: readonly GenreSensible[]): SuiteProposee {
  const cibles = genres.map((g) => CIBLE_DU_GENRE[g]);
  let titre = COMMANDE_DU_CONTROLE;
  for (const cible of cibles) {
    const essai = titre === COMMANDE_DU_CONTROLE ? `${titre} ${cible}` : `${titre}, ${cible}`;
    if (essai.length > TITRE_MAX_D_UNE_SUITE) break;
    titre = essai;
  }
  const colle = genres.includes('commande-collee');
  const touches = genres.filter((g) => g !== 'commande-collee').map((g) => CIBLE_DU_GENRE[g]);
  const description = colle && !touches.length
    ? 'Votre message contient une commande à lancer : la faire relire par le contrôle de sécurité, sans rien modifier.'
    : `Ce travail touche ${touches.join(', ')}${colle ? ' et votre message contient une commande' : ''} : un contrôle de sécurité classé par gravité, sans rien modifier.`;
  return { titre, description: description.slice(0, DESCRIPTION_MAX_D_UNE_SUITE) };
}

/**
 * Les suites du message avec celle du contrôle EN DERNIER. Une suite « /securite » déjà là est
 * remplacée ; s'il y en a déjà le plafond, la dernière cède sa place — celles de l'agent avant
 * elle ne sont jamais touchées.
 */
export function suitesAvecLeControle(existantes: readonly SuiteProposee[] | undefined, suite: SuiteProposee): SuiteProposee[] {
  const autres = (existantes ?? []).filter((s) => !s.titre.trim().toLowerCase().startsWith(COMMANDE_DU_CONTROLE));
  return [...autres.slice(0, SUITES_MAX - 1), suite];
}
