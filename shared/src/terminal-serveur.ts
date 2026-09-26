/**
 * LE TERMINAL DU SERVEUR, DANS L'INTERFACE — LES RÈGLES PURES.
 *
 * Un bouton du bandeau ouvre un VRAI terminal du serveur, celui où tournent les
 * agents. Ce n'est pas un exécuteur de commandes : c'est une SESSION TMUX
 * unique et partagée, à laquelle chaque écran ouvert vient s'attacher. Deux
 * conséquences voulues :
 *
 * 1. **Ce qui tourne survit à la fenêtre.** Fermer l'onglet, changer d'appareil,
 *    perdre le réseau ne tue rien : `claude`, `codex`, `npm run build` continuent
 *    dans tmux, et la réouverture retrouve l'écran exactement où il en était.
 * 2. **Tout le monde voit la même chose.** Session PARTAGÉE, décidée au cadrage :
 *    le téléphone et l'ordinateur regardent le même terminal, sans copie.
 *
 * LE POINT DÉLICAT EST L'ATTACHE. `tmux attach` exige un VRAI terminal : lancé
 * sur de simples tuyaux, il refuse (« open terminal failed: not a terminal »).
 * Plutôt que d'ajouter un module NATIF (`node-pty`, à recompiler à chaque
 * changement de Node — le projet en paie déjà un avec la base), un relais de
 * cinquante lignes en bibliothèque standard Python ouvre le terminal lui-même
 * (`scripts/attache-terminal.py`). Aucune dépendance nouvelle.
 *
 * LA TAILLE NE VIENT PAS DE L'ATTACHE MAIS DE L'ÉCRAN. `script(1)`, la solution
 * évidente, aurait fabriqué un terminal de 80×24 et RIEN D'AUTRE : l'écran
 * n'aurait montré qu'un morceau de la fenêtre, quelle que soit la largeur du
 * navigateur. Le relais, lui, POSE la taille demandée avant de lancer tmux, et
 * la refait à chaque fois que la fenêtre du navigateur change.
 *
 * Ce fichier ne connaît ni tmux ni le réseau : il ne dit QUE les règles — le nom
 * de la session, les bornes de taille, la forme des messages échangés. Le démon
 * les applique (`server/src/terminal.ts`), l'écran les relit
 * (`web/src/components/terminal-serveur.tsx`), les tests les rejouent.
 */

/**
 * LA SESSION EST UNIQUE ET ELLE PORTE UN NOM FIXE. Un nom tiré au hasard aurait
 * fabriqué une session de plus à chaque redémarrage du démon, et les anciennes
 * seraient restées à traîner avec leurs processus.
 */
export const SESSION_TERMINAL = 'beluga';

/** La voie WebSocket du terminal, distincte de celle de l'application. */
export const ROUTE_TERMINAL = '/ws/terminal';

/**
 * BORNES DE TAILLE. En dessous, l'écran ne montre plus rien d'utile ; au-dessus,
 * on ne fait que payer de la mémoire dans tmux pour des colonnes qu'aucun écran
 * n'affiche. Une valeur hors bornes est RAMENÉE dedans, jamais refusée : un
 * navigateur qui mesure mal ne doit pas fermer le terminal.
 */
export const TAILLE_TERMINAL = { colonnesMin: 20, colonnesMax: 500, lignesMin: 5, lignesMax: 200 } as const;

/**
 * PLAFOND D'UNE FRAPPE. Un collage géant (un fichier entier lâché dans le
 * terminal) partirait en un seul message et bloquerait la voie. Au-delà, le
 * message est REFUSÉ et le refus se dit à l'écran — il n'est pas tronqué en
 * silence, ce qui exécuterait une demi-commande.
 */
export const LIMITE_FRAPPE = 64 * 1024;

/** Ce que le navigateur envoie au serveur. */
export type MessageVersTerminal =
  | { type: 'frappe'; donnees: string }
  | { type: 'taille'; colonnes: number; lignes: number }
  /**
   * CHANGER LE COMPTE QUI FAIT TOURNER LE TERMINAL. Une session tmux garde
   * l'environnement de sa CRÉATION : le compte ne se change donc pas dans une
   * session vivante, elle est TUÉE puis recréée. Ce qui y tournait est perdu,
   * pour tout le monde — d'où la confirmation exigée à l'écran.
   */
  | { type: 'compte'; id: string };

/** Le compte qui fait tourner le terminal, tel qu'il s'affiche dans l'entête. */
export interface CompteAffiche {
  id: string;
  label: string;
  /** Le palier lisible (« Max x20 »), quand il est connu. */
  plan?: string;
}

/** Ce que le serveur renvoie au navigateur. */
export type MessageDuTerminal =
  /** La session est attachée : l'écran peut afficher. */
  | {
      type: 'pret';
      session: string;
      colonnes: number;
      lignes: number;
      /** Le compte dont le coffre a créé la session, s'il y en a un. */
      compte?: CompteAffiche;
      /** Dit en clair pourquoi le terminal ne part sur aucun compte de l'application. */
      avertissement?: string;
    }
  /** Un morceau de la sortie du terminal, en base64 (voir plus bas). */
  | { type: 'sortie'; donnees: string }
  /** La session a été recréée sur un autre compte : l'écran se rattache. */
  | { type: 'compte-change'; compte?: CompteAffiche; avertissement?: string }
  /** Une panne dite en clair, en français, à afficher dans le terminal. */
  | { type: 'panne'; message: string };

/**
 * LA SORTIE VOYAGE EN BASE64, ET CE N'EST PAS UN DÉTAIL. Un terminal ne rend pas
 * du texte mais des OCTETS, et un caractère accentué en occupe deux : le tuyau
 * peut couper « é » en plein milieu, entre deux morceaux. Décoder chaque morceau
 * en texte côté serveur remplacerait la coupure par un « � » définitif. Les
 * octets partent donc bruts, et c'est l'afficheur du navigateur — qui, lui, sait
 * attendre la suite — qui recolle.
 */
const ALPHABET_BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function encoderSortie(octets: Uint8Array): string {
  let sortie = '';
  for (let i = 0; i < octets.length; i += 3) {
    const a = octets[i];
    const b = octets[i + 1];
    const c = octets[i + 2];
    sortie += ALPHABET_BASE64[a >> 2];
    sortie += ALPHABET_BASE64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    sortie += b === undefined ? '=' : ALPHABET_BASE64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    sortie += c === undefined ? '=' : ALPHABET_BASE64[c & 63];
  }
  return sortie;
}

/** L'inverse, côté navigateur. */
export function decoderSortie(donnees: string): Uint8Array {
  const propre = donnees.replace(/=+$/, '');
  const octets = new Uint8Array(Math.floor((propre.length * 3) / 4));
  let tampon = 0;
  let bits = 0;
  let ecrits = 0;
  for (const signe of propre) {
    const valeur = ALPHABET_BASE64.indexOf(signe);
    if (valeur < 0) continue;
    tampon = (tampon << 6) | valeur;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      octets[ecrits++] = (tampon >> bits) & 0xff;
    }
  }
  return octets.subarray(0, ecrits);
}

/** Ramène une taille demandée dans les bornes utilisables. */
export function tailleDeTerminal(colonnes: unknown, lignes: unknown): { colonnes: number; lignes: number } {
  const borner = (valeur: unknown, min: number, max: number, defaut: number): number => {
    const nombre = typeof valeur === 'number' && Number.isFinite(valeur) ? Math.round(valeur) : defaut;
    return Math.min(max, Math.max(min, nombre));
  };
  return {
    colonnes: borner(colonnes, TAILLE_TERMINAL.colonnesMin, TAILLE_TERMINAL.colonnesMax, 80),
    lignes: borner(lignes, TAILLE_TERMINAL.lignesMin, TAILLE_TERMINAL.lignesMax, 24),
  };
}

/** Le verdict rendu sur un message reçu du navigateur. */
export type LectureDeMessage =
  | { ok: true; message: MessageVersTerminal }
  | { ok: false; refus: string };

/**
 * LIT UN MESSAGE DU NAVIGATEUR, ET NE FAIT JAMAIS CONFIANCE. Tout ce qui n'est
 * pas exactement l'une des deux formes attendues est refusé avec une phrase
 * lisible : une voie ouverte sur un terminal du serveur ne devine rien.
 */
export function lireMessageDuTerminal(brut: string): LectureDeMessage {
  let objet: unknown;
  try {
    objet = JSON.parse(brut);
  } catch {
    return { ok: false, refus: 'message illisible' };
  }
  if (!objet || typeof objet !== 'object') return { ok: false, refus: 'message illisible' };
  const source = objet as Record<string, unknown>;
  if (source.type === 'frappe') {
    if (typeof source.donnees !== 'string') return { ok: false, refus: 'frappe sans texte' };
    if (source.donnees.length > LIMITE_FRAPPE) {
      return { ok: false, refus: `frappe trop longue (${source.donnees.length} signes, ${LIMITE_FRAPPE} au plus)` };
    }
    return { ok: true, message: { type: 'frappe', donnees: source.donnees } };
  }
  if (source.type === 'taille') {
    const taille = tailleDeTerminal(source.colonnes, source.lignes);
    return { ok: true, message: { type: 'taille', ...taille } };
  }
  if (source.type === 'compte') {
    // L'identifiant sert à retrouver un compte DÉJÀ déclaré, jamais à composer
    // un chemin : ce qui n'a pas la forme d'un identifiant est refusé ici.
    if (typeof source.id !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(source.id)) {
      return { ok: false, refus: 'compte inconnu' };
    }
    return { ok: true, message: { type: 'compte', id: source.id } };
  }
  return { ok: false, refus: 'message inconnu' };
}

/**
 * LES ARGUMENTS DE TMUX, ÉCRITS ICI PLUTÔT QUE DANS UNE CHAÎNE DE SHELL. Rien ne
 * passe par un interpréteur de commandes : le nom de session est fixe, mais la
 * taille vient de l'écran, et une taille assemblée dans une chaîne serait la
 * seule porte par laquelle un caractère de shell pourrait entrer.
 */
export function argumentsCreationSession(
  session: string,
  colonnes: number,
  lignes: number,
  environnement: Readonly<Record<string, string>> = {},
): string[] {
  const args = ['new-session', '-d', '-s', session, '-x', String(colonnes), '-y', String(lignes)];
  /*
   * L'ENVIRONNEMENT PASSE PAR `-e`, JAMAIS PAR CELUI DU PROCESSUS QUI APPELLE.
   * Mesuré le 06/09/2026 : tmux est un SERVEUR. Le premier `tmux` lancé garde
   * l'environnement de son démarrage, et tous les suivants ne font que lui
   * parler. Une session créée par un second appel reçoit donc l'environnement
   * du SERVEUR — celui d'il y a peut-être des semaines —, pas celui du démon qui
   * vient de la demander : le `CLAUDE_CONFIG_DIR` posé sur le `spawn` arrivait
   * VIDE dans le shell. `-e` le pose sur la session elle-même, et il y arrive.
   */
  for (const [nom, valeur] of Object.entries(environnement)) {
    if (!valeur) continue;
    args.push('-e', `${nom}=${valeur}`);
  }
  return args;
}

/**
 * LA FENÊTRE SUIT LE DERNIER ÉCRAN ACTIF (`window-size latest`), pas le plus
 * petit. Par défaut, tmux rétrécit une session partagée à la taille du plus
 * petit de ses clients : un téléphone resté attaché aurait bridé l'ordinateur à
 * sa propre largeur, sans que rien ne l'explique. « latest » donne la fenêtre à
 * celui qui s'en sert — les autres voient la même chose, en plus grand ou avec
 * des marges, et récupèrent la main dès qu'ils frappent une touche.
 */
export function argumentsSuiviDeTaille(session: string): string[] {
  return ['set-option', '-t', session, 'window-size', 'latest'];
}

/**
 * LA NOUVELLE TAILLE, TELLE QU'ELLE PART AU RELAIS. Une ligne « colonnes×lignes »
 * sur son quatrième tuyau : le relais refait la taille du terminal, tmux reçoit
 * son SIGWINCH et redessine, sans qu'on ait à couper puis rouvrir l'attache.
 */
export function ligneDeTaille(colonnes: number, lignes: number): string {
  return `${colonnes}x${lignes}\n`;
}

/** Existe-t-elle déjà ? La seule question posée avant de créer. */
export function argumentsSessionExiste(session: string): string[] {
  return ['has-session', '-t', session];
}

/**
 * POSE UNE VARIABLE DANS L'ENVIRONNEMENT DE LA SESSION. La session tmux garde
 * l'environnement de sa création pour le shell DÉJÀ ouvert ; cette commande-ci
 * sert les fenêtres OUVERTES ENSUITE (`tmux new-window`), qui sinon repartiraient
 * sur l'environnement du démon et donc sur un autre coffre que le shell d'à côté.
 */
export function argumentsEnvironnementSession(session: string, nom: string, valeur: string): string[] {
  return ['set-environment', '-t', session, nom, valeur];
}

/**
 * TUE LA SESSION. Le seul cas où on la tue est le CHANGEMENT DE COMPTE : une
 * session vivante garde l'environnement de sa création, donc l'ancien coffre.
 * Tout ce qui y tournait s'arrête — c'est pour cela que l'écran demande une
 * confirmation avant d'en arriver là.
 */
export function argumentsFinDeSession(session: string): string[] {
  return ['kill-session', '-t', session];
}

/**
 * L'ATTACHE PASSE PAR UN PETIT RELAIS QUI OUVRE LE TERMINAL LUI-MÊME
 * (`scripts/attache-terminal.py`). `script(1)` aurait suffi à fabriquer un
 * terminal, mais TOUJOURS en 80×24 : l'écran n'aurait montré qu'un morceau de
 * la fenêtre tmux, quelle que soit la largeur du navigateur. Le relais, lui,
 * POSE la taille demandée avant de lancer `tmux attach`, et la refait à chaque
 * changement de fenêtre.
 */
export const RELAIS_TERMINAL = 'scripts/attache-terminal.py';

export function argumentsAttache(session: string, colonnes: number, lignes: number, relais: string): { commande: string; arguments: string[] } {
  return { commande: 'python3', arguments: [relais, session, String(colonnes), String(lignes)] };
}

/* ------------------------------------------------------------------ */
/* QUEL COMPTE FAIT TOURNER LE `claude` DU TERMINAL                    */
/* ------------------------------------------------------------------ */

/**
 * LE TERMINAL N'EST PAS UN AGENT, MAIS IL DÉPENSE COMME UN AGENT.
 *
 * Tapé dans ce terminal, `claude` lisait le coffre PAR DÉFAUT du compte système
 * — jamais l'un des coffres de Beluga Build. La dépense partait donc sur un
 * abonnement qu'aucun écran de l'application ne montre, pendant que le compte
 * Max x20 du serveur, vingt fois plus large, dormait à côté.
 *
 * La règle est donc explicite : à défaut d'un choix à la main, le terminal part
 * sur le compte Claude au palier « Max x20 ». Elle est PURE — ni base, ni
 * disque, ni réseau : elle prend une liste de comptes et rend celui qui doit
 * recevoir la session.
 */
export interface CompteDuTerminal {
  id: string;
  /** Le moteur du compte : seul « claude » sait quoi faire d'un `CLAUDE_CONFIG_DIR`. */
  engine: string;
  label: string;
  /** Le plan lu sur le coffre, ou le palier lu chez le fournisseur : « Max x20 », « Pro »… */
  plan?: string;
  /** Compte coupé à la main : il ne reçoit plus rien, terminal compris. */
  disabled?: boolean;
}

/** Le palier visé par défaut, écrit une seule fois. */
export const PALIER_TERMINAL = 'Max x20';

/** Ce que la règle a décidé, et POURQUOI — la raison s'affiche telle quelle. */
export interface ChoixDuTerminal {
  compte?: CompteDuTerminal;
  /** `demande` : choisi à la main. `palier` : le Max x20 trouvé tout seul. `aucun` : rien. */
  raison: 'demande' | 'palier' | 'aucun';
  /**
   * Dit en clair quand le terminal ne part PAS sur un compte de l'application.
   * Il ne retombe jamais en silence sur le coffre du compte système.
   */
  avertissement?: string;
}

/** Un compte Claude vivant, seul candidat possible. */
function candidat(compte: CompteDuTerminal): boolean {
  return compte.engine === 'claude' && !compte.disabled;
}

/** Le palier est-il celui d'un Max x20 ? On lit le plan tel qu'il est écrit. */
export function estMaxX20(plan: string | undefined): boolean {
  if (!plan) return false;
  return /max\s*x?\s*20|20x/i.test(plan);
}

/**
 * CHOISIT LE COMPTE DU TERMINAL.
 *
 * Un choix fait à la main l'emporte TOUJOURS : c'est le seul geste explicite de
 * quelqu'un, et une règle automatique ne doit pas le défaire au redémarrage
 * suivant. Un choix devenu invalide (compte retiré, éteint, moteur changé) ne
 * bloque pas le terminal : on retombe sur le Max x20, et le dit.
 */
export function choisirLeCompteDuTerminal(
  comptes: readonly CompteDuTerminal[],
  demande?: string,
): ChoixDuTerminal {
  const vivants = comptes.filter(candidat);
  if (demande) {
    const voulu = vivants.find((compte) => compte.id === demande);
    if (voulu) return { compte: voulu, raison: 'demande' };
  }
  const maxX20 = vivants.find((compte) => estMaxX20(compte.plan));
  if (maxX20) {
    return {
      compte: maxX20,
      raison: 'palier',
      avertissement: demande
        ? `le compte choisi n’est plus disponible : le terminal repart sur « ${maxX20.label} »`
        : undefined,
    };
  }
  return {
    raison: 'aucun',
    avertissement: vivants.length
      ? `aucun compte Claude au palier ${PALIER_TERMINAL} : le terminal garde le coffre du serveur`
      : 'aucun compte Claude actif : le terminal garde le coffre du serveur',
  };
}
