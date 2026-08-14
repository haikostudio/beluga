/**
 * LE MOTEUR CURSOR — les règles PURES, sans réseau ni disque.
 *
 * Cursor est désormais un OUTIL EN LIGNE DE COMMANDE comme Claude et Codex :
 * `cursor-agent`, lancé DANS la copie de travail de la carte, qui lit et
 * modifie les fichiers sur la machine. Il a remplacé les agents cloud
 * (`https://api.cursor.com`, `POST /v1/agents`) où le travail se faisait chez
 * Cursor, sur un dépôt GitHub, et devait ensuite être rapatrié par une branche
 * « cursor/… ». Plus rien de tout cela n'existe.
 *
 * Il reste UNE différence avec les deux autres moteurs, et une seule :
 *
 *  1. LE MODÈLE PORTE SON NIVEAU DANS SON NOM. Claude prend `--effort high`,
 *     Codex une surcharge de configuration ; le CLI de Cursor, lui, n'accepte
 *     qu'une LISTE FERMÉE de noms où le niveau est un suffixe
 *     (« claude-opus-5-thinking-high », « gpt-5.4-xhigh »). Un nom paramétré
 *     entre crochets est refusé (« Cannot use this model », constaté le
 *     14/08/2026). On regroupe donc ces noms par modèle, et le niveau choisi
 *     redevient un suffixe au lancement.
 *  2. AUCUN QUOTA PUBLIÉ. Cursor facture à la dépense : sa ligne de compte
 *     n'affiche pas de jauge, seulement l'état de sa clé.
 *
 * Tout ce qui suit se calcule sans appeler personne : c'est ce qui le rend
 * rejouable dans un test (`server/src/test/moteur-cursor.test.ts`).
 */

/**
 * L'adresse de l'API de Cursor. Elle ne sert plus qu'à ÉPROUVER UNE CLÉ
 * (`GET /v1/me`, à sa déclaration dans les réglages) : le CLI, lui, ne sait
 * pas dire si la clé qu'on lui passe est bonne — sa commande `status` rend le
 * compte connecté sur la machine, pas celui de la clé fournie (constaté :
 * une clé inventée rend « Logged in » sans broncher). Aucun agent, aucun run,
 * aucun dépôt ne passe plus par là.
 */
export const API_CURSOR = 'https://api.cursor.com';

/** Le modèle retenu quand rien n'est choisi : le modèle maison de Cursor. */
export const MODELE_CURSOR_PAR_DEFAUT = 'composer-2.5';

/**
 * Le niveau tel que HaikoDev le nomme partout ailleurs (`low`, `medium`,
 * `high`, `xhigh`, `max`). Cursor écrit « extra-high » là où le reste du projet
 * écrit « xhigh » : on traduit dans les deux sens plutôt que d'ajouter un
 * sixième mot à l'interface.
 */
export function niveauDepuisCursor(valeur: string): string {
  return valeur === 'extra-high' ? 'xhigh' : valeur;
}

/**
 * L'ORDRE D'AFFICHAGE des niveaux, du plus léger au plus poussé — indépendant
 * de l'ordre dans lequel Cursor énumère ses modèles.
 */
const ORDRE_NIVEAUX = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/**
 * LES SUFFIXES DE NIVEAU, du plus long au plus court : « extra-high » doit être
 * reconnu AVANT « high », sinon « gpt-5.5-extra-high » deviendrait le modèle
 * « gpt-5.5-extra » réglé sur « high », un nom que Cursor ne connaît pas.
 */
const SUFFIXES_DE_NIVEAU = ['extra-high', 'minimal', 'medium', 'xhigh', 'high', 'none', 'low', 'max'];

/** La variante « rapide » d'un modèle : même modèle, facturé plus cher. */
const SUFFIXE_RAPIDE = '-fast';

/**
 * LA FAMILLE « THINKING », que Cursor écrit tantôt avant, tantôt après le
 * niveau. Ses noms récents la mettent devant (« claude-opus-5-thinking-high »),
 * ses noms anciens derrière (« claude-4.6-opus-high-thinking ») : sans ce
 * démêlage, le second passait pour un modèle sans niveau, et sa famille ne
 * rejoignait jamais celle de la version récente — trois vieilleries Claude 4.6
 * restaient donc dans le menu.
 */
const SUFFIXE_REFLECHI = '-thinking';

/** Un modèle du CLI, décomposé : son nom de base et le niveau qu'il porte. */
export interface NomDeModeleCursor {
  /** Le modèle, sans son niveau (« claude-opus-5-thinking »). */
  base: string;
  /** Le niveau, au vocabulaire de HaikoDev, ou null si le nom n'en porte pas. */
  niveau: string | null;
}

/**
 * DÉCOMPOSER UN NOM DE MODÈLE DU CLI. « claude-opus-5-thinking-xhigh » donne le
 * modèle « claude-opus-5-thinking » au niveau « xhigh ». Un nom sans suffixe
 * connu (« composer-2.5 », « gemini-3.1-pro ») n'a pas de niveau : il part tel
 * quel. « thinking » n'est PAS un niveau — c'est une famille de modèles à part,
 * que Cursor propose à côté de la famille ordinaire.
 */
export function decomposerModeleCursor(id: string): NomDeModeleCursor {
  const nom = (id ?? '').trim();

  // « claude-4.6-opus-high-thinking » : le niveau est au MILIEU. On met la
  // mention « thinking » de côté, on décompose le reste, et on la rend à la
  // base — qui rejoint ainsi « claude-opus-5-thinking », sa version récente.
  if (nom.length > SUFFIXE_REFLECHI.length && nom.endsWith(SUFFIXE_REFLECHI)) {
    const sansMention = nom.slice(0, -SUFFIXE_REFLECHI.length);
    const { base, niveau } = decomposerModeleCursor(sansMention);
    return { base: `${base}${SUFFIXE_REFLECHI}`, niveau };
  }

  for (const suffixe of SUFFIXES_DE_NIVEAU) {
    if (nom.length > suffixe.length + 1 && nom.endsWith(`-${suffixe}`)) {
      return { base: nom.slice(0, -(suffixe.length + 1)), niveau: niveauDepuisCursor(suffixe) };
    }
  }
  return { base: nom, niveau: null };
}

/** Un modèle tel que HaikoDev le propose : un nom, ses niveaux, leurs ids réels. */
export interface ModeleCursorCli {
  /** Le nom de base, celui que la carte retient. */
  id: string;
  /** Le libellé de Cursor, sans mention de niveau. */
  label: string;
  /** Les niveaux réellement proposés, dans l'ordre d'affichage. */
  niveaux: string[];
  /** Le niveau que Cursor donne pour défaut, déduit de ses libellés. */
  niveauParDefaut: string;
  /** Le nom COMPLET à passer à `--model`, pour chaque niveau. */
  ids: Record<string, string>;
  /** La fenêtre de contexte annoncée dans le libellé (« Opus 5 1M »), en jetons. */
  fenetre?: number;
}

/**
 * LA FENÊTRE DE CONTEXTE, lue dans le libellé du modèle. Cursor l'y écrit
 * lui-même (« Opus 5 1M », « GPT-5.6 Sol 1M Max ») et ne la donne nulle part
 * ailleurs en ligne de commande. Un libellé qui n'en porte pas n'en reçoit
 * aucune : on ne devine pas une capacité.
 */
export function fenetreDepuisLibelleCursor(label: string | undefined): number | undefined {
  const trouve = (label ?? '').match(/\b(\d+(?:[.,]\d+)?)\s*([mk])\b/i);
  if (!trouve) return undefined;
  const nombre = Number(trouve[1].replace(',', '.'));
  if (!Number.isFinite(nombre)) return undefined;
  return Math.round(nombre * (trouve[2].toLowerCase() === 'm' ? 1_000_000 : 1_000));
}

function trierNiveaux(niveaux: string[]): string[] {
  return [...niveaux].sort((a, b) => {
    const ia = ORDRE_NIVEAUX.indexOf(a);
    const ib = ORDRE_NIVEAUX.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

/**
 * LE CATALOGUE, LU DANS LA SORTIE DE `cursor-agent --list-models`.
 *
 * Le CLI rend une ligne par nom acceptable (« gpt-5.4-xhigh - GPT-5.4 1M Extra
 * High »), soit près de deux cents lignes où le même modèle revient à chaque
 * niveau. On les REGROUPE : un modèle, ses niveaux, et le nom complet à envoyer
 * pour chacun. Trois décisions, toutes visibles ici :
 *
 *  - les variantes « … -fast » sont ÉCARTÉES : c'est le même modèle, servi plus
 *    vite et facturé plus cher, et HaikoDev n'a nulle part où exprimer ce
 *    choix — les garder doublait la liste sans rien offrir ;
 *  - un modèle SANS suffixe de niveau (« composer-2.5 ») n'a que le niveau
 *    « sans réflexion », et son nom part tel quel ;
 *  - le niveau par DÉFAUT est celui dont le libellé est le plus court, car
 *    Cursor nomme sans mention de niveau celui qu'il applique par défaut
 *    (« Opus 5 1M » pour `claude-opus-5-high`).
 */
export function modelesCursorDepuisListe(sortie: string): ModeleCursorCli[] {
  const groupes = new Map<string, { labels: Map<string, string>; ids: Record<string, string> }>();
  const nouveauGroupe = (): { labels: Map<string, string>; ids: Record<string, string> } => ({
    labels: new Map(),
    ids: {},
  });

  for (const ligne of (sortie ?? '').split('\n')) {
    const trouve = ligne.trim().match(/^([A-Za-z0-9][\w.\-]*)\s+-\s+(.+)$/);
    if (!trouve) continue;
    const id = trouve[1];
    if (id.endsWith(SUFFIXE_RAPIDE)) continue;
    const label = trouve[2].replace(/\s*\((?:current|default)[^)]*\)\s*$/i, '').trim();
    if (!label) continue;

    const { base, niveau } = decomposerModeleCursor(id);
    const cle = niveau ?? 'none';
    const groupe = groupes.get(base) ?? nouveauGroupe();
    // Premier arrivé, premier servi : Cursor liste ses noms du plus courant au
    // plus rare, et deux lignes ne visent jamais le même niveau du même modèle.
    if (!(cle in groupe.ids)) {
      groupe.ids[cle] = id;
      groupe.labels.set(cle, label);
    }
    groupes.set(base, groupe);
  }

  const modeles: ModeleCursorCli[] = [];
  for (const [base, groupe] of groupes) {
    const niveaux = trierNiveaux(Object.keys(groupe.ids));
    let parDefaut = niveaux[0] ?? 'none';
    let plusCourt = Infinity;
    for (const niveau of niveaux) {
      const longueur = (groupe.labels.get(niveau) ?? '').length;
      if (longueur < plusCourt) {
        plusCourt = longueur;
        parDefaut = niveau;
      }
    }
    const label = groupe.labels.get(parDefaut) ?? base;
    modeles.push({
      id: base,
      label,
      niveaux,
      niveauParDefaut: parDefaut,
      ids: groupe.ids,
      fenetre: fenetreDepuisLibelleCursor(label),
    });
  }
  return modeles;
}

/**
 * LE NOM EXACT À PASSER À `--model` pour ce modèle et ce niveau.
 *
 * Le CLI n'accepte que les noms de sa liste : un niveau qu'il n'y propose pas
 * doit retomber sur le défaut du modèle, jamais partir tel quel — un nom
 * inconnu fait refuser le tour ENTIER avant même qu'il commence. Un modèle
 * absent du catalogue (liste illisible, réglage plus ancien que la refonte)
 * part inchangé : c'est le seul repli honnête.
 */
export function idCursorPourNiveau(
  modeles: ModeleCursorCli[],
  modele: string | undefined,
  niveau: string | undefined,
): string {
  const voulu = (modele ?? '').trim();
  if (!voulu) return MODELE_CURSOR_PAR_DEFAUT;
  const groupe = modeles.find((m) => m.id === voulu);
  // Rien de connu sous ce nom : c'est peut-être un nom COMPLET
  // (« gpt-5.4-xhigh ») retenu avant la refonte, ou un catalogue illisible. Il
  // part inchangé — deviner un autre modèle serait pire que le laisser dire non.
  if (!groupe) return voulu;
  const demande = (niveau ?? '').trim();
  return groupe.ids[demande] ?? groupe.ids[groupe.niveauParDefaut] ?? groupe.id;
}

/* ------------------------------------------------------------------ */
/* Ce que le CLI raconte pendant qu'il travaille                       */
/* ------------------------------------------------------------------ */

/**
 * LES OUTILS DU CLI, ramenés au vocabulaire COMMUN des moteurs.
 *
 * Cursor annonce chaque appel sous une clé qui le nomme (`readToolCall`,
 * `editToolCall`, `shellToolCall`…), avec ses propres noms d'arguments. Le
 * journal d'exécution de HaikoDev, lui, n'en connaît qu'un (`humanStep`) :
 * on traduit ici, une fois, plutôt que d'écrire un second vocabulaire dans
 * l'interface. Un outil jamais vu garde son nom nettoyé — mieux vaut une étape
 * au nom brut qu'une étape muette.
 */
export function outilCursor(appel: unknown): { nom: string; entree: Record<string, unknown> } | null {
  if (!appel || typeof appel !== 'object') return null;
  const cle = Object.keys(appel as Record<string, unknown>).find((k) => k.endsWith('ToolCall'));
  if (!cle) return null;
  const contenu = (appel as Record<string, any>)[cle];
  const args: Record<string, any> = (contenu?.args ?? {}) as Record<string, any>;
  const nom = cle.slice(0, -'ToolCall'.length);
  const chemin = typeof args.path === 'string' ? args.path : undefined;

  switch (nom) {
    case 'read':
    case 'piRead':
      return { nom: 'Read', entree: { file_path: chemin } };
    case 'edit':
    case 'piEdit':
    case 'applyAgentDiff':
      return { nom: 'Edit', entree: { file_path: chemin } };
    case 'write':
    case 'piWrite':
      return { nom: 'Write', entree: { file_path: chemin } };
    case 'shell':
    case 'piBash':
      return { nom: 'Bash', entree: { command: typeof args.command === 'string' ? args.command : '' } };
    case 'grep':
    case 'piGrep':
    case 'semSearch':
      return { nom: 'Grep', entree: { pattern: args.pattern ?? args.query ?? args.regex } };
    case 'glob':
    case 'piFind':
      return { nom: 'Glob', entree: { pattern: args.globPattern ?? args.pattern } };
    case 'ls':
    case 'piLs':
      return { nom: 'Glob', entree: { pattern: chemin } };
    case 'webSearch':
      return { nom: 'WebSearch', entree: { query: args.query } };
    case 'fetch':
    case 'webFetch':
      return { nom: 'WebFetch', entree: { url: args.url } };
    case 'task':
    case 'subagent':
      return { nom: 'Task', entree: { description: args.description ?? args.prompt } };
    case 'mcp': {
      const outil = typeof args.toolName === 'string' ? args.toolName : typeof args.tool === 'string' ? args.tool : '';
      return { nom: outil ? `mcp__haikodev__${outil}` : 'Outil du projet', entree: args };
    }
    default:
      return { nom, entree: args };
  }
}

/** La clé sous laquelle Cursor annonce sa liste de tâches. */
export const OUTIL_TACHES_CURSOR = 'updateTodos';

/** La clé sous laquelle Cursor rend son PLAN, en mode plan. */
export const OUTIL_PLAN_CURSOR = 'createPlan';

/**
 * LE PLAN DE CURSOR N'EST PAS UN MESSAGE : C'EST UN APPEL D'OUTIL.
 *
 * En mode plan (`--mode plan`), Cursor n'écrit PAS son plan dans la
 * conversation. Il n'y laisse qu'une narration — « Je commence par lire
 * salut.js pour comprendre sa structure » — et pose le plan entier dans un
 * appel `createPlanToolCall` (constaté sur un vrai tour le 14/08/2026). Sans
 * cette traduction, le plan de Cursor n'arrivait jamais dans le fil : il
 * s'affichait comme une étape opaque nommée « createPlan », `jugerLePlan` ne
 * voyait aucune des quatre parties, le message perdait son cadre et ses boutons
 * « Valider » / « Refuser », et la relance partait pour rien. Claude et Codex
 * écrivent le leur en texte : on ramène donc Cursor au MÊME contrat.
 *
 * Le champ `plan` porte le texte entier ; `overview` n'en est que le résumé, et
 * ne sert que si le premier manque — mieux vaut un plan court qu'un plan perdu.
 */
export function texteDuPlanCursor(entree: unknown): string | null {
  if (!entree || typeof entree !== 'object') return null;
  const args = entree as Record<string, unknown>;
  const plan = typeof args.plan === 'string' ? args.plan.trim() : '';
  if (plan) return plan;
  const resume = typeof args.overview === 'string' ? args.overview.trim() : '';
  return resume || null;
}

/**
 * POURQUOI L'APPEL A ÉTÉ REFUSÉ, en français et pour un lecteur non
 * informaticien. Une panne se dit toujours : un témoin qui tourne sans fin sur
 * une clé refusée est le défaut qu'on répare ici.
 */
export function raisonDeRefusCursor(status: number, message?: string): string {
  const detail = (message ?? '').trim();
  const suffixe = detail ? ` (${detail})` : '';
  if (status === 401 || status === 403) return `Cursor a refusé la clé d'accès${suffixe}.`;
  if (status === 404) return `Cursor n'a pas trouvé ce qui était demandé${suffixe}.`;
  if (status === 400 || status === 422) return `Cursor a refusé la demande${suffixe}.`;
  if (status === 429) return 'Cursor limite les appels pour le moment : la demande n\'est pas partie.';
  if (status >= 500) return `Le service Cursor est indisponible${suffixe}.`;
  return `Cursor a répondu ${status}${suffixe}.`;
}

/**
 * CE QUE LE CLI A ÉCRIT EN PARTANT, dit en français.
 *
 * Le CLI ne rend pas de code d'erreur parlant : il écrit sa plainte sur la
 * sortie d'erreur, en anglais, avec des couleurs de terminal — « ⚠ Warning: The
 * provided API key is invalid. » sur une clé refusée (constaté le 14/08/2026).
 * Recracher ces lignes telles quelles à l'écran, c'est un « code 1 » déguisé :
 * une panne se dit toujours, et dans la langue de l'utilisateur. Ce qui n'est
 * pas reconnu garde sa sortie, nettoyée de ses couleurs — mieux vaut une
 * phrase brute qu'une bulle muette.
 */
export function raisonDeLaSortieCursor(sortie: string | undefined, code: number | null): string {
  const propre = (sortie ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/\[[0-9;]*m/g, '')
    .trim();
  const bas = propre.toLowerCase();
  if (/api key is invalid|invalid api key|unauthorized|not authenticated|not logged in/.test(bas)) {
    return "Cursor a refusé la clé d'accès : le tour n'est pas parti.";
  }
  if (/cannot use this model|unknown model|model not found/.test(bas)) {
    return "Cursor a refusé le modèle demandé : le tour n'est pas parti.";
  }
  if (/rate limit|too many requests/.test(bas)) {
    return "Cursor limite les appels pour le moment : la demande n'est pas passée.";
  }
  if (/insufficient|payment|billing|quota/.test(bas)) {
    return 'Cursor a refusé la demande faute de crédit sur le compte.';
  }
  const dernieres = propre.split('\n').filter(Boolean).slice(-4).join('\n');
  return dernieres || `Le moteur s'est arrêté (code ${code ?? -1}).`;
}

/**
 * UN MOTEUR SANS QUOTA PUBLIÉ n'affiche AUCUNE jauge. Cursor facture à la
 * dépense et ne publie ni fenêtre de cinq heures ni plafond hebdomadaire :
 * afficher « fenêtre 0 % · semaine 0 % » sur sa ligne de compte serait une
 * mesure inventée, et c'est exactement ce que HaikoDev refuse ailleurs.
 */
export function moteurSansQuota(engine: string | undefined): boolean {
  return engine === 'cursor';
}

/** L'état d'un compte Cursor tel que les réglages l'affichent. */
export interface EtatCompteCursor {
  /** La clé répond-elle ? */
  cleAcceptee: boolean;
  /** Le nom que Cursor donne à cette clé, quand elle est acceptée. */
  nomDeLaCle?: string;
  /** Pourquoi elle ne répond pas, en français. */
  erreur?: string;
  /** L'outil en ligne de commande est-il installé sur la machine ? */
  cliInstalle: boolean;
  /** Sa version, telle qu'il l'annonce. */
  versionDuCli?: string;
  /** Pourquoi il n'a pas répondu. */
  erreurDuCli?: string;
}

/**
 * CE QUI MANQUE POUR QU'UN TOUR PARTE, dit en une phrase. Deux pièces sont
 * nécessaires — l'outil sur la machine et une clé — et un moteur qui ne part
 * pas doit dire laquelle manque, jamais rester muet.
 */
export function manqueDuMoteurCursor(cliInstalle: boolean, cleConnue: boolean): string | null {
  if (!cliInstalle && !cleConnue) {
    return "L'outil « cursor-agent » n'est pas installé sur le serveur et aucune clé d'accès n'est configurée.";
  }
  if (!cliInstalle) return "L'outil « cursor-agent » n'est pas installé sur le serveur : le tour n'est pas parti.";
  if (!cleConnue) return "Aucune clé d'accès Cursor n'est configurée sur le serveur : le tour n'est pas parti.";
  return null;
}
