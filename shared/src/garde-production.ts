/*
 * LE GARDE DE LA PRODUCTION : AUCUN AGENT N'ÉCRIT SUR UN VRAI SITE HORS MISE EN PRODUCTION.
 *
 * Le 08/10/2026, une carte InVia a mis à jour trois extensions directement sur
 * association-invia.ch, par SSH, alors que la règle (MEM-4501) veut que tout
 * changement se fasse sur la COPIE DE TEST puis parte en ligne par la mise en
 * production lancée par l'utilisateur. Une consigne ne suffit pas : on ferme le
 * chemin AVANT que la commande ne parte, comme le garde du démon
 * (`garde-demon.ts`), par le même crochet posé devant chaque commande d'agent.
 *
 * Le principe est une LISTE BLANCHE DE LECTURE : vers l'hôte d'un vrai site, ne
 * passe que ce qui est reconnu comme une lecture (inventaire des extensions,
 * lecture d'un journal, `option get`, export de la base). Tout le reste — une
 * écriture reconnue, mais aussi un script envoyé sur l'entrée standard, une
 * substitution `$(…)`, un outil inconnu — est REFUSÉ, avec la marche à suivre.
 *
 * La mise en production elle-même n'est pas concernée : ses étapes sont jouées
 * par le démon, sans agent (`deploy.ts`, `mettreEnProduction`), et l'agent qui
 * la configure ou la répare (rôle « deploy ») ne reçoit pas la liste.
 *
 * LIMITE ASSUMÉE : seul ce qui se LIT dans la commande est jugé. Un script
 * local qui ouvre lui-même la connexion sans nommer l'hôte, ou un navigateur
 * piloté dans l'administration du site, échappent au garde ; la consigne des
 * agents les couvre. Et le crochet n'existe que sous Claude.
 */

/** Un vrai site protégé : ses hôtes (SSH, base) et son domaine web. */
export interface ProductionProtegee {
  /** Le nom lisible du site (« association-invia.ch »). */
  nom: string;
  /** Les hôtes de la machine du site : SSH, base de données. Comparés en entier. */
  hotes: string[];
  /** Les domaines web du site : seules les requêtes HTTP qui ÉCRIVENT y sont refusées. */
  domaines: string[];
  /** Où corriger à la place, en une phrase (copie de test, registre). */
  ailleurs?: string;
  /** Le projet relié au site : ses agents reçoivent la consigne en clair. */
  projet?: string;
}

/**
 * LA CONSIGNE DES AGENTS D'UN PROJET RELIÉ À UN VRAI SITE. Le crochet des
 * commandes n'existe que sous Claude : sous Codex et Cursor, cette phrase est le
 * seul rempart, elle part donc à TOUS les moteurs.
 */
export function consigneDeProduction(productions: readonly ProductionProtegee[]): string {
  if (!productions.length) return '';
  return productions
    .map(
      (p) =>
        `LE VRAI SITE ${p.nom.toUpperCase()} EST EN LECTURE SEULE (MEM-4501). Tu peux le LIRE (inventaire, journaux, copie depuis le site), jamais y écrire — ni mise à jour, ni activation, ni fichier, ni base, ni réglage dans son administration —, même si la demande dit « mets à jour » : seule la mise en production, lancée par l'utilisateur, écrit en ligne. ${p.ailleurs ?? ''}`.trim(),
    )
    .join('\n\n');
}

export interface VerdictDeProduction {
  refusee: boolean;
  /** Ce qui est refusé, en une phrase. */
  raison?: string;
  /** Le site visé. */
  production?: ProductionProtegee;
}

const PASSE: VerdictDeProduction = { refusee: false };

/* ------------------------------------------------------------------ */
/* Lire une ligne de shell, guillemets compris                          */
/* ------------------------------------------------------------------ */

/** Une instruction simple : ses mots, ses redirections et ce qui lui arrive sur l'entrée standard. */
export interface InstructionLue {
  mots: string[];
  /** Les cibles des redirections de sortie (`>`, `>>`), hors `/dev/null` et `&N`. */
  sorties: string[];
  /** L'entrée standard vient d'un fichier (`< fichier`). */
  entreeFichier: boolean;
  /** Le texte d'un document en ligne (`<<FIN … FIN`, `<<< texte`). */
  documentEnLigne?: string;
}

export interface LigneLue {
  instructions: InstructionLue[];
  /** Une substitution de commande `$(…)` ou `` `…` `` : son contenu n'est pas jugé. */
  substitution: boolean;
}

/**
 * DÉCOUPE UNE LIGNE DE SHELL en instructions, en respectant les guillemets et
 * les documents en ligne. Ce n'est pas un shell : juste assez pour savoir quel
 * programme part, avec quels mots, et où va sa sortie.
 */
export function lireLigneDeShell(texte: string): LigneLue {
  const instructions: InstructionLue[] = [];
  let substitution = false;
  let courante: InstructionLue = { mots: [], sorties: [], entreeFichier: false };
  let mot = '';
  let dansMot = false;
  /** Ce que le prochain mot complète : une redirection de sortie, d'entrée, ou un délimiteur. */
  let attente: 'sortie' | 'entree' | 'delimiteur' | 'chaine' | null = null;
  const documents: { delimiteur: string; retrait: boolean; instruction: InstructionLue }[] = [];
  let retrait = false;

  const finirMot = () => {
    if (!dansMot) return;
    if (attente === 'sortie') {
      if (mot !== '/dev/null' && !/^&\d*-?$/.test(mot)) courante.sorties.push(mot);
    } else if (attente === 'entree') {
      courante.entreeFichier = true;
    } else if (attente === 'delimiteur') {
      documents.push({ delimiteur: mot, retrait, instruction: courante });
    } else if (attente === 'chaine') {
      courante.documentEnLigne = mot;
    } else {
      courante.mots.push(mot);
    }
    attente = null;
    mot = '';
    dansMot = false;
  };
  const finirInstruction = () => {
    finirMot();
    if (courante.mots.length || courante.sorties.length || courante.entreeFichier || courante.documentEnLigne !== undefined) {
      instructions.push(courante);
    }
    courante = { mots: [], sorties: [], entreeFichier: false };
  };

  let i = 0;
  while (i < texte.length) {
    const c = texte[i];
    if (c === "'") {
      const fin = texte.indexOf("'", i + 1);
      const bout = fin === -1 ? texte.slice(i + 1) : texte.slice(i + 1, fin);
      mot += bout;
      dansMot = true;
      i = fin === -1 ? texte.length : fin + 1;
      continue;
    }
    if (c === '"') {
      dansMot = true;
      i += 1;
      while (i < texte.length && texte[i] !== '"') {
        if (texte[i] === '\\' && i + 1 < texte.length) {
          mot += texte[i + 1];
          i += 2;
          continue;
        }
        if (texte[i] === '`' || (texte[i] === '$' && texte[i + 1] === '(')) substitution = true;
        mot += texte[i];
        i += 1;
      }
      i += 1;
      continue;
    }
    if (c === '\\' && i + 1 < texte.length) {
      if (texte[i + 1] !== '\n') {
        mot += texte[i + 1];
        dansMot = true;
      }
      i += 2;
      continue;
    }
    if (c === '`' || (c === '$' && texte[i + 1] === '(')) substitution = true;
    if (c === '\n') {
      finirInstruction();
      i += 1;
      // Les documents en ligne ouverts sur la ligne qui s'achève : leur texte suit.
      while (documents.length) {
        const doc = documents.shift()!;
        const lignes: string[] = [];
        while (i < texte.length) {
          const finDeLigne = texte.indexOf('\n', i);
          const ligne = finDeLigne === -1 ? texte.slice(i) : texte.slice(i, finDeLigne);
          i = finDeLigne === -1 ? texte.length : finDeLigne + 1;
          if ((doc.retrait ? ligne.replace(/^\t+/, '') : ligne).trim() === doc.delimiteur) break;
          lignes.push(ligne);
        }
        doc.instruction.documentEnLigne = lignes.join('\n');
      }
      continue;
    }
    if (c === ' ' || c === '\t') {
      finirMot();
      i += 1;
      continue;
    }
    if (c === ';' || c === '|' || c === '&' || c === '(' || c === ')') {
      // « 2>&1 », « >&2 » : l'esperluette appartient à la redirection.
      if (c === '&' && attente === 'sortie' && !dansMot) {
        mot = '&';
        dansMot = true;
        i += 1;
        continue;
      }
      finirInstruction();
      i += texte[i + 1] === c || (c === '|' && texte[i + 1] === '&') ? 2 : 1;
      continue;
    }
    if (c === '>') {
      // Un nombre collé devant (« 2> ») est le descripteur, pas un mot.
      if (dansMot && /^\d+$/.test(mot)) {
        mot = '';
        dansMot = false;
      } else finirMot();
      attente = 'sortie';
      i += texte[i + 1] === '>' ? 2 : 1;
      if (texte[i] === '|') i += 1;
      continue;
    }
    if (c === '<') {
      finirMot();
      if (texte.startsWith('<<<', i)) {
        attente = 'chaine';
        i += 3;
      } else if (texte.startsWith('<<', i)) {
        attente = 'delimiteur';
        retrait = texte[i + 2] === '-';
        i += retrait ? 3 : 2;
      } else if (texte[i + 1] === '(') {
        // Substitution de processus « <(…) » : son contenu n'est pas jugé.
        substitution = true;
        i += 1;
      } else {
        attente = 'entree';
        i += 1;
      }
      continue;
    }
    mot += c;
    dansMot = true;
    i += 1;
  }
  finirInstruction();
  return { instructions, substitution };
}

/* ------------------------------------------------------------------ */
/* Le programme réellement lancé                                         */
/* ------------------------------------------------------------------ */

/** Les mots-clés du shell qui précèdent une commande sans en être une. */
const MOTS_CLES = new Set(['do', 'then', 'else', 'elif', 'if', 'while', 'until', '!', '{', 'time']);

/** Les enveloppes qui lancent un autre programme, avec leurs options qui prennent une valeur. */
const ENVELOPPES: Record<string, Set<string>> = {
  sudo: new Set(['-u', '-g', '-C', '-D', '-h', '-p', '-U', '-r', '-t']),
  env: new Set(['-u', '-C', '-S']),
  nohup: new Set(),
  nice: new Set(['-n']),
  ionice: new Set(['-c', '-n']),
  setsid: new Set(),
  exec: new Set(['-a']),
  command: new Set(),
  stdbuf: new Set(['-i', '-o', '-e']),
  sshpass: new Set(['-p', '-f', '-d', '-P']),
  timeout: new Set(['-s', '-k', '--signal', '--kill-after']),
};

/** Le programme et ses arguments, enveloppes, mots-clés et affectations écartés. */
export function programmeLance(mots: string[]): { verbe: string; args: string[] } {
  let i = 0;
  while (i < mots.length) {
    const mot = mots[i];
    if (MOTS_CLES.has(mot) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(mot)) {
      i += 1;
      continue;
    }
    const nom = mot.split('/').pop() ?? mot;
    const options = ENVELOPPES[nom];
    if (!options) break;
    i += 1;
    while (i < mots.length && (mots[i].startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(mots[i]))) {
      if (options.has(mots[i])) i += 1;
      i += 1;
    }
    // « timeout 30 ssh … » : la durée n'est pas le programme.
    if (nom === 'timeout' && i < mots.length && /^\d+(\.\d+)?[smhd]?$/.test(mots[i])) i += 1;
  }
  const verbe = (mots[i] ?? '').split('/').pop() ?? '';
  return { verbe, args: mots.slice(i + 1) };
}

/* ------------------------------------------------------------------ */
/* Ce qui se lit sans rien changer, sur la machine du site               */
/* ------------------------------------------------------------------ */

const LECTURES_SIMPLES = new Set([
  'cd', 'pwd', 'ls', 'll', 'cat', 'head', 'tail', 'grep', 'egrep', 'fgrep', 'zgrep', 'zcat', 'wc', 'stat',
  'du', 'df', 'file', 'test', '[', '[[', ']]', 'echo', 'printf', 'date', 'whoami', 'id', 'hostname', 'uname',
  'md5sum', 'sha1sum', 'sha256sum', 'diff', 'cmp', 'sort', 'uniq', 'cut', 'tr', 'jq', 'less', 'more', 'ps',
  'uptime', 'free', 'nproc', 'which', 'type', 'readlink', 'realpath', 'basename', 'dirname', 'tree', 'true',
  'false', 'sleep', 'exit', 'export', 'set', 'column', 'nl', 'tac', 'rev', 'od', 'xxd', 'strings', 'printenv',
  'locale', 'for', 'done', 'fi', 'esac', '}', 'mysqldump', 'mariadb-dump', 'getent', 'sed', 'find', 'tar',
  'gzip', 'gunzip', 'crontab', 'php', 'awk', 'gawk', 'mysql', 'mariadb', 'git', 'bash', 'sh', 'wp', 'wp-cli',
]);

/** Les commandes WP-CLI qui ne font que lire (chemins de sous-commandes). */
const WP_EN_LECTURE = new Set([
  'plugin list', 'plugin get', 'plugin status', 'plugin is-active', 'plugin is-installed', 'plugin path',
  'plugin search', 'plugin verify-checksums', 'plugin auto-updates status',
  'theme list', 'theme get', 'theme status', 'theme is-active', 'theme is-installed', 'theme path', 'theme search',
  'core version', 'core verify-checksums', 'core is-installed', 'core check-update',
  'option get', 'option list', 'option pluck',
  'db export', 'db size', 'db tables', 'db check', 'db columns', 'db prefix', 'db search',
  'post list', 'post get', 'post meta list', 'post meta get', 'post term list', 'post-type list', 'post-type get',
  'user list', 'user get', 'user meta list', 'user meta get', 'user session list', 'user application-password list',
  'comment list', 'comment get', 'comment count', 'term list', 'term get', 'taxonomy list', 'taxonomy get',
  'menu list', 'menu item list', 'menu location list', 'site list', 'cron event list', 'cron schedule list', 'cron test',
  'transient get', 'cache type', 'config get', 'config list', 'config path', 'config has', 'config is-true',
  'rewrite list', 'role list', 'role exists', 'cap list', 'language core list', 'language plugin list',
  'language theme list', 'cli version', 'cli info', 'cli check-update', 'package list', 'package path',
  'sidebar list', 'widget list', 'maintenance-mode status', 'super-cache status', 'export', 'help',
]);

/** Les options globales de WP-CLI qui prennent leur valeur dans le mot suivant. */
const OPTIONS_WP_A_VALEUR = new Set(['--path', '--url', '--user', '--require', '--exec', '--context']);

/** Une requête SQL qui ne fait que lire. */
export function requeteEnLecture(requete: string): boolean {
  const instructions = requete
    .split(';')
    .map((morceau) => morceau.trim())
    .filter(Boolean);
  if (!instructions.length) return false;
  return instructions.every(
    (ordre) => /^(select|show|describe|desc|explain|use)\b/i.test(ordre) && !/\binto\s+(out|dump)file\b/i.test(ordre),
  );
}

/** `wp …` : la sous-commande lit-elle seulement ? */
function wpEnLecture(args: string[]): string | null {
  const chemin: string[] = [];
  let requete: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('-')) {
      if (OPTIONS_WP_A_VALEUR.has(arg)) i += 1;
      continue;
    }
    if (chemin[0] === 'db' && chemin[1] === 'query') {
      requete = arg;
      break;
    }
    chemin.push(arg);
  }
  if (!chemin.length) return null;
  if (chemin[0] === 'search-replace') return args.includes('--dry-run') ? null : 'wp search-replace sans --dry-run';
  if (chemin[0] === 'db' && chemin[1] === 'query') {
    return requete !== undefined && requeteEnLecture(requete) ? null : 'wp db query qui écrit (ou lit sa requête sur l’entrée standard)';
  }
  for (let n = Math.min(chemin.length, 3); n >= 1; n -= 1) {
    if (WP_EN_LECTURE.has(chemin.slice(0, n).join(' '))) return null;
  }
  return `wp ${chemin.slice(0, 3).join(' ')}`;
}

/** La requête passée à `mysql -e`, ou `undefined` si elle vient de l'entrée standard. */
function requeteDeMysql(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '-e' || arg === '--execute') return args[i + 1] ?? '';
    if (arg.startsWith('--execute=')) return arg.slice('--execute='.length);
    if (/^-e./.test(arg)) return arg.slice(2);
  }
  return undefined;
}

/**
 * JUGE UNE COMMANDE QUI S'EXÉCUTE SUR LA MACHINE DU SITE. Rend ce qui écrit, ou
 * `null` si tout n'est que lecture.
 */
export function ecritureDistante(script: string, profondeur = 0): string | null {
  if (profondeur > 3) return 'commande trop imbriquée pour être jugée';
  const lue = lireLigneDeShell(script);
  if (lue.substitution) return 'une substitution de commande « $(…) », dont le contenu ne se juge pas';
  for (const instruction of lue.instructions) {
    if (instruction.sorties.length) return `une redirection vers « ${instruction.sorties[0]} »`;
    const { verbe, args } = programmeLance(instruction.mots);
    if (!verbe) continue;
    if (verbe.includes('$')) return `un programme désigné par une variable (« ${verbe} »)`;
    if (!LECTURES_SIMPLES.has(verbe) && !/^wp-cli(\.phar)?$/.test(verbe)) return `« ${verbe} »`;
    const texte = args.join(' ');
    switch (verbe) {
      case 'wp':
      case 'wp-cli':
      case 'wp-cli.phar': {
        const ecrit = wpEnLecture(args);
        if (ecrit) return ecrit;
        break;
      }
      case 'php': {
        const phar = args.findIndex((a) => /wp-cli(\.phar)?$/.test(a));
        if (phar >= 0) {
          const ecrit = wpEnLecture(args.slice(phar + 1));
          if (ecrit) return ecrit;
        } else if (!args.every((a) => ['-v', '--version', '-m', '-i', '-l', '--ini'].includes(a) || a.endsWith('.php'))) {
          return 'php qui exécute du code';
        } else if (!args.some((a) => ['-v', '--version', '-m', '-i', '-l', '--ini'].includes(a))) {
          return 'php qui exécute un fichier';
        }
        break;
      }
      case 'sed':
        if (args.some((a) => a === '-i' || a.startsWith('-i') || a.startsWith('--in-place') || /^-[a-hj-z]*i/.test(a))) return 'sed -i';
        break;
      case 'find':
        if (args.some((a) => ['-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprint0', '-fprintf', '-fls'].includes(a))) {
          return 'find qui agit sur ce qu’il trouve';
        }
        break;
      case 'tar': {
        const mode = (args[0] ?? '').replace(/^-/, '');
        const lecture = args.some((a) => a === '--create' || a === '--list') || (/^[a-zA-Z]+$/.test(mode) && /[ct]/.test(mode) && !/[xru]/.test(mode));
        if (!lecture || args.some((a) => ['--extract', '--delete', '--append', '--update', '-x'].includes(a))) return 'tar qui extrait ou modifie';
        break;
      }
      case 'gzip':
      case 'gunzip':
        if (!args.some((a) => ['-c', '--stdout', '-l', '--list', '-t', '--test'].includes(a) || /^-[a-z]*c/.test(a))) return `${verbe} qui remplace le fichier`;
        break;
      case 'crontab':
        if (!args.includes('-l')) return 'crontab qui modifie les tâches planifiées';
        break;
      case 'awk':
      case 'gawk':
        if (/system\s*\(|>|\|/.test(texte)) return `${verbe} qui écrit ou lance une commande`;
        break;
      case 'mysql':
      case 'mariadb': {
        const requete = requeteDeMysql(args);
        if (requete === undefined || instruction.entreeFichier || instruction.documentEnLigne !== undefined) return `${verbe} qui lit ses ordres sur l’entrée standard`;
        if (!requeteEnLecture(requete)) return `${verbe} qui écrit dans la base`;
        break;
      }
      case 'git':
        if (!['status', 'log', 'diff', 'show', 'rev-parse', 'ls-files'].includes(args.find((a) => !a.startsWith('-')) ?? '')) return 'git qui modifie';
        break;
      case 'bash':
      case 'sh': {
        const c = args.findIndex((a) => /^-[a-z]*c$/.test(a));
        if (c >= 0 && args[c + 1] !== undefined) {
          const ecrit = ecritureDistante(args[c + 1], profondeur + 1);
          if (ecrit) return ecrit;
        } else if (args.length === 0 || (args.length === 1 && args[0] === '-s')) {
          if (instruction.documentEnLigne === undefined) return `${verbe} qui lit un script sur l’entrée standard`;
          const ecrit = ecritureDistante(instruction.documentEnLigne, profondeur + 1);
          if (ecrit) return ecrit;
        } else {
          return `${verbe} qui lance un script`;
        }
        break;
      }
      default:
        break;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Les outils qui atteignent la machine du site                          */
/* ------------------------------------------------------------------ */

/** Les options de `ssh` qui prennent une valeur. */
const OPTIONS_SSH_A_VALEUR = new Set('bcDEeFIiJLlmOoPpQRSWwB'.split('').map((l) => `-${l}`));
/** Celles de `scp`. */
const OPTIONS_SCP_A_VALEUR = new Set(['-c', '-F', '-i', '-J', '-l', '-o', '-P', '-S', '-D', '-X']);
/** Celles de `rsync` quand la valeur est dans le mot suivant. */
const OPTIONS_RSYNC_A_VALEUR = new Set([
  '-e', '-f', '-T', '-B', '-M', '--rsh', '--filter', '--exclude', '--include', '--exclude-from', '--include-from',
  '--files-from', '--temp-dir', '--log-file', '--password-file', '--rsync-path', '--chmod', '--chown',
  '--partial-dir', '--backup-dir', '--suffix', '--compare-dest', '--copy-dest', '--link-dest', '--port',
]);

/** L'hôte d'une destination SSH (« user@hote », « ssh://user@hote:22 »). */
export function hoteDeDestination(destination: string): string {
  let d = destination.replace(/^(ssh|sftp|rsync):\/\//, '');
  d = d.split('/')[0];
  d = d.slice(d.lastIndexOf('@') + 1);
  return d.replace(/:\d*$/, '').replace(/^\[|\]$/g, '').toLowerCase();
}

/** L'hôte d'un chemin distant de scp/rsync (« user@hote:chemin », « hote::module »), ou `null` si local. */
export function hoteDuChemin(chemin: string): string | null {
  if (/^(rsync|scp|sftp):\/\//.test(chemin)) return hoteDeDestination(chemin);
  const deuxPoints = chemin.indexOf(':');
  if (deuxPoints <= 0) return null;
  const avant = chemin.slice(0, deuxPoints);
  // Un chemin local qui contient « : » plus loin qu'un séparateur n'est pas distant.
  if (avant.includes('/')) return null;
  return avant.slice(avant.lastIndexOf('@') + 1).toLowerCase();
}

function memeHote(hote: string, production: ProductionProtegee): boolean {
  const h = hote.toLowerCase();
  return production.hotes.some((p) => p.toLowerCase() === h);
}

function echapper(texte: string): string {
  return texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Ce mot nomme-t-il ce domaine (dans une adresse, sous-domaines compris) ? */
export function mentionneDomaine(mot: string, domaine: string): boolean {
  return new RegExp(`(^|[/@.])${echapper(domaine.toLowerCase())}(?=$|[:/?#])`).test(mot.toLowerCase());
}

/** Les programmes locaux qui peuvent CITER un hôte sans rien lui faire. */
const CITATIONS_SANS_EFFET = new Set([
  'echo', 'printf', 'grep', 'egrep', 'rg', 'cat', 'ping', 'host', 'dig', 'nslookup', 'getent', 'ssh-keyscan',
  'ssh-keygen', 'sed', 'git', 'test', '[', 'export', 'true', 'mysqldump', 'mariadb-dump', 'wc', 'head', 'tail',
]);

interface Contexte {
  productions: ProductionProtegee[];
  /** La production dont un hôte apparaît en clair dans la commande : une destination en variable la vise. */
  citee?: ProductionProtegee;
}

/** La production que désigne cet hôte ; une variable vaut la production citée dans la commande. */
function productionDeLHote(hote: string, ctx: Contexte): ProductionProtegee | undefined {
  if (hote.includes('$')) return ctx.citee;
  return ctx.productions.find((p) => memeHote(hote, p));
}

function refus(production: ProductionProtegee, raison: string): VerdictDeProduction {
  return { refusee: true, raison, production };
}

function jugerSsh(instruction: InstructionLue, args: string[], ctx: Contexte): VerdictDeProduction {
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) {
    if (OPTIONS_SSH_A_VALEUR.has(args[i])) i += 1;
    i += 1;
  }
  const destination = args[i];
  if (!destination) return PASSE;
  const production = productionDeLHote(hoteDeDestination(destination), ctx);
  if (!production) return PASSE;
  const distant = args.slice(i + 1).join(' ').trim();
  if (instruction.entreeFichier) return refus(production, 'un script envoyé sur l’entrée standard de ssh, qui ne se juge pas');
  if (!distant || /^(ba)?sh(\s+-s)?$/.test(distant)) {
    if (instruction.documentEnLigne === undefined) return refus(production, 'une session ssh ouverte sans commande à juger');
    const ecrit = ecritureDistante(instruction.documentEnLigne);
    return ecrit ? refus(production, ecrit) : PASSE;
  }
  const ecrit = ecritureDistante(distant);
  return ecrit ? refus(production, ecrit) : PASSE;
}

function cheminsDeCopie(args: string[], avecValeur: Set<string>): string[] {
  const chemins: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('-')) {
      if (avecValeur.has(arg)) i += 1;
      continue;
    }
    chemins.push(arg);
  }
  return chemins;
}

function jugerCopie(verbe: 'scp' | 'rsync', args: string[], ctx: Contexte): VerdictDeProduction {
  const chemins = cheminsDeCopie(args, verbe === 'scp' ? OPTIONS_SCP_A_VALEUR : OPTIONS_RSYNC_A_VALEUR);
  if (chemins.length < 2) return PASSE;
  const destination = chemins[chemins.length - 1];
  const hoteCible = hoteDuChemin(destination);
  const cible = hoteCible ? productionDeLHote(hoteCible, ctx) : undefined;
  if (cible) return refus(cible, `${verbe} VERS la machine du site (seule la copie depuis le site, en lecture, est permise)`);
  if (verbe === 'rsync' && args.includes('--remove-source-files')) {
    for (const source of chemins.slice(0, -1)) {
      const hote = hoteDuChemin(source);
      const production = hote ? productionDeLHote(hote, ctx) : undefined;
      if (production) return refus(production, 'rsync --remove-source-files, qui efface sur la machine du site');
    }
  }
  return PASSE;
}

function jugerSftp(args: string[], ctx: Contexte): VerdictDeProduction {
  const destination = cheminsDeCopie(args, OPTIONS_SCP_A_VALEUR)[0];
  const production = destination ? productionDeLHote(hoteDeDestination(destination), ctx) : undefined;
  return production ? refus(production, 'une session sftp, qui peut déposer des fichiers (passe par « scp » depuis le site pour lire)') : PASSE;
}

function jugerMysql(instruction: InstructionLue, verbe: string, args: string[], ctx: Contexte): VerdictDeProduction {
  let hote: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '-h' || arg === '--host') hote = args[i + 1];
    else if (arg.startsWith('--host=')) hote = arg.slice('--host='.length);
    else if (/^-h./.test(arg)) hote = arg.slice(2);
  }
  const production = hote ? productionDeLHote(hote, ctx) : undefined;
  if (!production) return PASSE;
  const requete = requeteDeMysql(args);
  if (requete === undefined || instruction.entreeFichier || instruction.documentEnLigne !== undefined) {
    return refus(production, `${verbe} qui lit ses ordres sur l’entrée standard`);
  }
  return requeteEnLecture(requete) ? PASSE : refus(production, `${verbe} qui écrit dans la base du site`);
}

function jugerHttp(verbe: string, args: string[], ctx: Contexte): VerdictDeProduction {
  const production = ctx.productions.find((p) => args.some((a) => p.domaines.some((d) => mentionneDomaine(a, d))));
  if (!production) return PASSE;
  if (verbe === 'curl') {
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];
      const methode = arg === '-X' || arg === '--request' ? args[i + 1] : arg.startsWith('--request=') ? arg.slice(10) : /^-X./.test(arg) ? arg.slice(2) : undefined;
      if (methode && !/^(get|head|options)$/i.test(methode)) return refus(production, `une requête HTTP ${methode.toUpperCase()} vers le site`);
      if (/^(-d|--data.*|-F|--form.*|-T|--upload-file|--json)$/.test(arg.split('=')[0]) || /^-[dFT]./.test(arg)) {
        return refus(production, 'une requête HTTP qui envoie des données au site');
      }
    }
    return PASSE;
  }
  if (args.some((a) => /^--(post-data|post-file|method|body-data|body-file)/.test(a))) {
    return refus(production, 'une requête HTTP qui envoie des données au site');
  }
  return PASSE;
}

/** Les affectations « NOM=valeur » de la commande, pour suivre une destination mise en variable. */
function remplacerLesVariables(mots: string[], variables: Map<string, string>): string[] {
  return mots.map((mot) =>
    mot.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (tout, nom: string) => variables.get(nom) ?? tout),
  );
}

/**
 * CETTE COMMANDE D'AGENT ÉCRIT-ELLE SUR UN VRAI SITE ? Rendue avant qu'elle ne
 * parte. Une liste vide ne refuse jamais rien.
 */
export function commandeEcritEnProduction(commande: string, productions: readonly ProductionProtegee[]): VerdictDeProduction {
  const actives = productions.filter((p) => p.hotes.length || p.domaines.length);
  if (!commande?.trim() || !actives.length) return PASSE;
  const bas = commande.toLowerCase();
  const ctx: Contexte = {
    productions: actives,
    citee: actives.find((p) => p.hotes.some((h) => bas.includes(h.toLowerCase()))),
  };
  const lue = lireLigneDeShell(commande);
  const variables = new Map<string, string>();
  for (const instruction of lue.instructions) {
    for (const mot of instruction.mots) {
      const affectation = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(mot);
      if (affectation) variables.set(affectation[1], affectation[2]);
      else break;
    }
  }
  for (const brute of lue.instructions) {
    const instruction = { ...brute, mots: remplacerLesVariables(brute.mots, variables) };
    const { verbe, args } = programmeLance(instruction.mots);
    if (!verbe) continue;
    let verdict: VerdictDeProduction = PASSE;
    if (verbe === 'ssh') verdict = jugerSsh(instruction, args, ctx);
    else if (verbe === 'scp' || verbe === 'rsync') verdict = jugerCopie(verbe, args, ctx);
    else if (verbe === 'sftp') verdict = jugerSftp(args, ctx);
    else if (verbe === 'mysql' || verbe === 'mariadb') verdict = jugerMysql(instruction, verbe, args, ctx);
    else if (verbe === 'curl' || verbe === 'wget') verdict = jugerHttp(verbe, args, ctx);
    else if (!CITATIONS_SANS_EFFET.has(verbe)) {
      // Un autre outil (lftp, sshfs, un script maison) qui NOMME la machine du site : on ne sait pas ce qu'il y fait.
      const texte = `${instruction.mots.join(' ')}\n${instruction.documentEnLigne ?? ''}`.toLowerCase();
      const production = actives.find((p) => p.hotes.some((h) => texte.includes(h.toLowerCase())));
      if (production) verdict = refus(production, `« ${verbe} », un outil qui vise la machine du site et dont on ne sait pas s’il écrit`);
    }
    if (verdict.refusee) return verdict;
  }
  return PASSE;
}

/** Le texte rendu à l'agent quand sa commande est refusée. */
export function refusDuGardeDeProduction(verdict: VerdictDeProduction): string {
  if (!verdict.refusee || !verdict.production) return '';
  const p = verdict.production;
  return [
    `Commande refusée : elle ÉCRIRAIT sur le vrai site ${p.nom} (${verdict.raison}).`,
    `Le vrai site est en LECTURE SEULE pour tous les agents : seule la mise en production, lancée par l'utilisateur, y écrit (MEM-4501).`,
    p.ailleurs ?? 'Fais le changement sur la copie de test du projet, et note-le au registre des changements à mettre en production.',
    'Une lecture passe : inventaire (wp plugin list, wp option get…), journaux (tail, grep), copie DEPUIS le site (scp/rsync site → ici).',
  ].join(' ');
}

/** La variable d'environnement qui porte la liste jusqu'au crochet des commandes. */
export const VARIABLE_DES_PRODUCTIONS = 'BELUGA_PRODUCTIONS_PROTEGEES';

/** Relit la liste portée par l'environnement ; illisible = vide (le garde se tait). */
export function productionsDepuisLEnvironnement(brut: string | undefined): ProductionProtegee[] {
  if (!brut) return [];
  try {
    const lu = JSON.parse(brut) as unknown;
    if (!Array.isArray(lu)) return [];
    return lu
      .filter((p): p is ProductionProtegee => !!p && typeof p === 'object' && typeof (p as ProductionProtegee).nom === 'string')
      .map((p) => ({
        nom: p.nom,
        hotes: Array.isArray(p.hotes) ? p.hotes.filter((h) => typeof h === 'string' && h.trim()) : [],
        domaines: Array.isArray(p.domaines) ? p.domaines.filter((d) => typeof d === 'string' && d.trim()) : [],
        ailleurs: typeof p.ailleurs === 'string' ? p.ailleurs : undefined,
        projet: typeof p.projet === 'string' ? p.projet : undefined,
      }));
  } catch {
    return [];
  }
}
