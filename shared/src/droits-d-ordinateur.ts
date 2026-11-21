/*
 * LES DROITS DE BELUGA SUR UN ORDINATEUR (carte « Piloter le Mac depuis Beluga », 21/11/2026).
 *
 * Décisions de l'utilisateur :
 *  - tout se règle DEPUIS BELUGA, ordinateur par ordinateur (Réglages › Extension › la page d'un ordinateur) ;
 *  - un ordinateur relié a TOUS ses droits allumés SAUF le terminal ;
 *  - une commande du terminal et toute SUPPRESSION passent par une fenêtre d'accord dans Beluga : « Refuser »,
 *    « Accepter » (cette action seulement) ou « Accepter pour toute la carte » (le terminal seulement, jusqu'à la fin
 *    du travail de la carte). Une suppression se redemande TOUJOURS, même sous ce raccourci.
 *
 * Règles PURES : la liste des droits, leurs valeurs par défaut, le droit qu'exige chaque geste de l'outil
 * « ordinateur », et la détection PRUDENTE d'une suppression dans une commande (au moindre doute : « supprime »).
 * Le démon les applique (`server/src/outil-ordinateur.ts`) ; le programme du Mac ne décide jamais d'un droit.
 */

export const DROITS_D_ORDINATEUR = ['applications', 'reglages', 'pilotage_apps', 'ecran', 'terminal'] as const;
export type DroitDOrdinateur = (typeof DROITS_D_ORDINATEUR)[number];
export type DroitsDOrdinateur = Record<DroitDOrdinateur, boolean>;

/** Un ordinateur relié : tout allumé, sauf le terminal (décision de l'utilisateur). */
export function defautsDUnOrdinateur(): DroitsDOrdinateur {
  return { applications: true, reglages: true, pilotage_apps: true, ecran: true, terminal: false };
}

/**
 * LES DROITS LUS EN BASE (colonne `ordinateurs.droits`, JSON) : rien ou illisible → les défauts ; un droit absent →
 * sa valeur par défaut. Une valeur qui n'est pas un booléen ne compte pas.
 */
export function droitsDeLOrdinateur(brut: unknown): DroitsDOrdinateur {
  const droits = defautsDUnOrdinateur();
  let objet: unknown = brut;
  if (typeof brut === 'string') {
    try {
      objet = JSON.parse(brut);
    } catch {
      objet = null;
    }
  }
  if (!objet || typeof objet !== 'object') return droits;
  for (const droit of DROITS_D_ORDINATEUR) {
    const v = (objet as Record<string, unknown>)[droit];
    if (typeof v === 'boolean') droits[droit] = v;
  }
  return droits;
}

/** Le nom d'un droit, tel que la page de l'ordinateur l'affiche (dit à l'agent quand il est éteint). */
export const LIBELLE_DU_DROIT: Record<DroitDOrdinateur, string> = {
  applications: 'Ouvrir et fermer des applications',
  reglages: 'Changer les réglages',
  pilotage_apps: 'Piloter vos applications',
  ecran: 'Voir l’écran et cliquer',
  terminal: 'Terminal',
};

/* ------------------------------------------------------------------ */
/* Les gestes de l'outil « ordinateur »                                 */
/* ------------------------------------------------------------------ */

export const GESTES_DE_L_ORDINATEUR = [
  'lister',
  'applications',
  'ouvrir_application',
  'fermer_application',
  'reglage',
  'piloter',
  'ecran_capturer',
  'ecran_cliquer',
  'ecran_taper',
  'ecran_touche',
  'terminal',
  'supprimer',
] as const;

/** Le droit qu'exige un geste ; `null` : aucun interrupteur (lister, ou supprimer — toujours soumis à l'accord). */
export function droitDuGeste(geste: string): DroitDOrdinateur | null {
  switch (geste) {
    case 'applications':
    case 'ouvrir_application':
    case 'fermer_application':
      return 'applications';
    case 'reglage':
      return 'reglages';
    case 'piloter':
      return 'pilotage_apps';
    case 'ecran_capturer':
    case 'ecran_cliquer':
    case 'ecran_taper':
    case 'ecran_touche':
      return 'ecran';
    case 'terminal':
      return 'terminal';
    default:
      return null;
  }
}

/** La phrase dite à l'agent quand le droit d'un geste est éteint. */
export function texteDuDroitEteint(nomDeLOrdinateur: string, droit: DroitDOrdinateur): string {
  return `Le droit « ${LIBELLE_DU_DROIT[droit]} » est éteint sur « ${nomDeLOrdinateur} » dans Beluga (Réglages › Extension › ${nomDeLOrdinateur}). Ne cherche pas à le contourner : dis-le à la personne, c’est elle qui l’allume.`;
}

/* ------------------------------------------------------------------ */
/* Les réglages du Mac que l'agent peut changer                         */
/* ------------------------------------------------------------------ */

export const REGLAGES_DU_MAC = ['volume', 'sourdine', 'luminosite', 'mode_sombre', 'wifi', 'veille_ecran'] as const;
export type ReglageDuMac = (typeof REGLAGES_DU_MAC)[number];

/**
 * UN RÉGLAGE ET SA VALEUR, vérifiés avant de partir au Mac : volume 0 à 100 ; sourdine, mode sombre, Wi-Fi : oui/non ;
 * luminosité : « plus » ou « moins » (un cran) ; veille de l'écran : aucune valeur. `null` : refusé.
 */
export function reglageValable(reglage: unknown, valeur: unknown): { reglage: ReglageDuMac; valeur: number | boolean | 'plus' | 'moins' | null } | null {
  if (typeof reglage !== 'string' || !(REGLAGES_DU_MAC as readonly string[]).includes(reglage)) return null;
  const r = reglage as ReglageDuMac;
  if (r === 'veille_ecran') return { reglage: r, valeur: null };
  if (r === 'volume') {
    const n = typeof valeur === 'string' ? Number(valeur) : valeur;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 100) return null;
    return { reglage: r, valeur: Math.round(n) };
  }
  if (r === 'luminosite') return valeur === 'plus' || valeur === 'moins' ? { reglage: r, valeur } : null;
  const oui = valeur === true || valeur === 'oui' || valeur === 'true' || valeur === 1;
  const non = valeur === false || valeur === 'non' || valeur === 'false' || valeur === 0;
  if (!oui && !non) return null;
  return { reglage: r, valeur: oui };
}

/* ------------------------------------------------------------------ */
/* Piloter une application (AppleScript)                                */
/* ------------------------------------------------------------------ */

/**
 * UN SCRIPT ENVOYÉ À UNE APPLICATION (« piloter ») : jamais une porte vers le terminal. Refusé s'il lance une commande
 * du système (« do shell script »), un autre script, ou s'il est vide ou trop long. `null` : acceptable ; sinon la
 * raison du refus.
 */
export function refusDuScript(script: unknown): string | null {
  if (typeof script !== 'string' || !script.trim()) return 'Donne le script AppleScript à envoyer à l’application.';
  if (script.length > 4000) return 'Script trop long (4 000 signes au plus).';
  if (/\bdo\s+shell\s+script\b|\brun\s+script\b|\bload\s+script\b|\bstore\s+script\b|\bosascript\b|\bdo\s+script\b/i.test(script)) {
    return 'Ce script lance une commande ou un autre script : passe par le geste « terminal », qui demande l’accord de la personne.';
  }
  return null;
}

/** Un script qui supprime (Finder « delete », vider la corbeille…) : il passe par l'accord, comme toute suppression. */
export function scriptSupprime(script: string): boolean {
  return /\bdelete\b|\berase\b|\bempty\s+(the\s+)?trash\b|\bempty\b|\bremove\b|\bmove\b[\s\S]*\btrash\b/i.test(script);
}

/* ------------------------------------------------------------------ */
/* Une commande du terminal supprime-t-elle quelque chose ?             */
/* ------------------------------------------------------------------ */

const MOTIFS_DE_SUPPRESSION: readonly RegExp[] = [
  /(^|[\s;&|(`])(sudo\s+)?(rm|rmdir|unlink|srm|shred|trash|truncate|mkfs[\w.]*|wipefs)(\s|$)/,
  /\bfind\b[\s\S]*\s-delete\b/,
  /\s-exec\s+(\S*\/)?(rm|rmdir|unlink|shred)\b/,
  /\bxargs\s+(\S+\s+)*(rm|rmdir|unlink|shred)\b/,
  /\bdiskutil\s+(\S+\s+)?(erase\w*|zero\w*|secureerase|reformat|partitiondisk|apfs\s+delete\w*|deletevolume)\b/i,
  /\bgit\s+(clean|reset\s+--hard|checkout\s+--\s|restore\b|branch\s+-[dD]\b|push\s+(\S+\s+)*(--force|-f|--delete)\b|stash\s+(drop|clear)\b)/,
  /\bdd\b[\s\S]*\bof=/,
  /\b(brew|port)\s+(uninstall|remove|rm|cleanup|zap)\b/,
  /\b(npm|pnpm|yarn)\s+(uninstall|un|rm|remove|prune)\b/,
  /\bpip3?\s+uninstall\b/,
  /\b(tmutil\s+delete\w*|defaults\s+delete|security\s+delete-\w+|launchctl\s+(remove|bootout)|dscl\s+\S+\s+-delete|sqlite3\b[\s\S]*\b(drop|delete)\b)/i,
  /\bmv\b[\s\S]*\.Trash\b/,
  /\b(kill|killall|pkill)\b/,
];

/** Des moyens de CACHER ce qu'une commande fait : on ne lit plus la commande, on la classe « supprime » (prudence). */
const MOTIFS_OPAQUES: readonly RegExp[] = [
  /\beval\b/,
  /\$\(|`/,
  /\|\s*(sudo\s+)?(sh|bash|zsh|dash|ksh|fish|source|\.)\b/,
  /\b(sh|bash|zsh|dash|ksh)\s+-\w*c\b/,
  /\b(python\d?|perl|ruby|node|php|osascript|lua|tclsh|awk|gawk)\b/,
  /\bbase64\s+(-d|--decode|-D)\b/,
  /\bsource\b|(^|[\s;&|])\.\s+\S/,
];

/**
 * UNE REDIRECTION QUI ÉCRASE UN FICHIER (« > fichier », sans « >> » et hors des sorties muettes /dev/null, &1, &2) :
 * le contenu précédent est perdu, c'est une suppression.
 */
function redirectionQuiEcrase(commande: string): boolean {
  const re = /(^|[^>&\d])\d?>\|?(?!>)\s*(&?[^\s;&|]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(commande))) {
    const cible = m[2] ?? '';
    if (/^&\d?$|^\/dev\/(null|stdout|stderr|tty)$/.test(cible) || cible.startsWith('&')) continue;
    return true;
  }
  return false;
}

/**
 * UNE COMMANDE DU TERMINAL SUPPRIME-T-ELLE QUELQUE CHOSE ? Analyse PRUDENTE : au moindre doute (commande cachée dans
 * un autre interprète, substitution, redirection qui écrase), la réponse est oui. Le raccourci « Accepter pour toute la
 * carte » ne couvre jamais une commande qui supprime : elle est redemandée.
 */
export function commandeSupprime(commande: string): boolean {
  const texte = commande.replace(/\\\n/g, ' ');
  if (MOTIFS_DE_SUPPRESSION.some((m) => m.test(texte))) return true;
  if (MOTIFS_OPAQUES.some((m) => m.test(texte))) return true;
  return redirectionQuiEcrase(texte);
}

/** Une commande acceptable à confier au Mac : non vide, bornée, sans caractère de contrôle (hors retour à la ligne). */
export function commandeValable(brut: unknown): string | null {
  if (typeof brut !== 'string') return null;
  const propre = brut.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
  if (!propre || propre.length > 4000) return null;
  return propre;
}

/** Un chemin à mettre à la corbeille : absolu (ou depuis « ~ »), sans retour à la ligne, jamais la racine ni un dossier système entier. */
export function cheminASupprimer(brut: unknown): string | null {
  if (typeof brut !== 'string') return null;
  const net = brut.trim();
  if (!net || net.length > 1024 || /[\u0000-\u001f]/.test(net)) return null;
  if (!net.startsWith('/') && !net.startsWith('~/')) return null;
  const sansFin = net.replace(/\/+$/, '');
  const interdits = ['', '~', '/System', '/Library', '/Applications', '/Users', '/bin', '/sbin', '/usr', '/private', '/etc', '/var', '/Volumes'];
  if (interdits.includes(sansFin)) return null;
  if (/(^|\/)\.\.(\/|$)/.test(net)) return null;
  return net;
}

/* ------------------------------------------------------------------ */
/* La demande d'accord                                                  */
/* ------------------------------------------------------------------ */

export type GenreDAccord = 'terminal' | 'suppression';

/**
 * CE QUE PORTE UNE DEMANDE D'ACCORD (champ `accordOrdinateur` d'une question) : la fenêtre d'accord de l'écran s'en
 * sert, et seul le COMPTE propriétaire de l'ordinateur peut y répondre.
 */
export interface AccordDOrdinateur {
  genre: GenreDAccord;
  compteId: string;
  ordinateurId: string;
  ordinateurNom: string;
  /** Ce que l'agent veut faire, en clair, en une phrase. */
  phrase: string;
  /** La commande exacte (terminal) ou le chemin (suppression). */
  commande: string;
  /** La commande supprime-t-elle quelque chose ? (Une suppression : toujours vrai.) */
  supprime: boolean;
}

export const REPONSE_ACCEPTER = 'Accepter';
export const REPONSE_ACCEPTER_POUR_LA_CARTE = 'Accepter pour toute la carte';
export const REPONSE_REFUSER = 'Refuser';

export type IssueDAccord = 'une_fois' | 'pour_la_carte' | 'refuse';

/** La réponse cliquée (ou écrite) devient une issue. Rien de reconnu : refusé. */
export function issueDeLAccord(reponse: string): IssueDAccord {
  const net = reponse.trim();
  if (net.startsWith(REPONSE_ACCEPTER_POUR_LA_CARTE)) return 'pour_la_carte';
  if (net === REPONSE_ACCEPTER || net.startsWith(`${REPONSE_ACCEPTER} —`) || net.startsWith(`${REPONSE_ACCEPTER} -`)) return 'une_fois';
  return 'refuse';
}

/**
 * « ACCEPTER POUR TOUTE LA CARTE » TIENT-IL ENCORE ? Seulement pendant le TOUR où il a été donné (la fin du travail —
 * rapport, arrêt, carte rangée — le fait tomber), et JAMAIS pour une commande qui supprime.
 */
export function accordPourLaCarteTient(tourDeLAccord: string | null | undefined, tourVivant: string | null | undefined, supprime: boolean): boolean {
  if (supprime) return false;
  return !!tourDeLAccord && !!tourVivant && tourDeLAccord === tourVivant;
}

/** Les choix de la fenêtre : « Accepter pour toute la carte » seulement pour une commande qui ne supprime rien. */
export function choixDeLAccord(accord: Pick<AccordDOrdinateur, 'genre' | 'supprime'>): string[] {
  return accord.genre === 'terminal' && !accord.supprime
    ? [REPONSE_ACCEPTER, REPONSE_ACCEPTER_POUR_LA_CARTE, REPONSE_REFUSER]
    : [REPONSE_ACCEPTER, REPONSE_REFUSER];
}

/** Une phrase claire de l'agent : bornée, sans retour à la ligne superflu. */
export function phraseDeLAccord(brut: unknown, repli: string): string {
  const net = typeof brut === 'string' ? brut.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
  return net || repli;
}
