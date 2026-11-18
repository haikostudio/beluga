/**
 * LE CONTRÔLE DE SÉCURITÉ D'UN PROJET — LES RÈGLES PURES.
 *
 * Le démon relève (fichiers versionnés, audit des dépendances, en-têtes de l'adresse publique,
 * visibilité du dépôt : `server/src/controle-securite.ts`) ; ce fichier-ci JUGE, sans base ni
 * disque : il reconnaît une clé écrite, une requête montée à la main, une route sans garde, un
 * en-tête manquant, puis classe le tout par gravité et l'écrit pour quelqu'un qui ne programme
 * pas — pour chaque point, « ce qui risque » et « ce qu'on propose ».
 *
 * RIEN N'EST CORRIGÉ D'OFFICE : chaque point devient une carte PROPOSÉE (`carteDeCorrection`).
 *
 * LA FRONTIÈRE DU SILENCE SUR LES IDENTIFIANTS (méthode, instruction 5 — tranchée avec
 * l'utilisateur) : garder ses accès dans son projet est un choix ASSUMÉ, le contrôle ne le signale
 * donc pas. Une clé ne devient un point du rapport que si elle est RÉELLEMENT LISIBLE PAR DES
 * INCONNUS : le dépôt est PUBLIC, ou la clé part au NAVIGATEUR des visiteurs (fichier servi au
 * navigateur, variable que l'outil de construction recopie dans la page). Partout ailleurs :
 * silence complet, pas même une ligne « à savoir ». La valeur d'une clé n'est JAMAIS recopiée.
 */

export type GraviteSecurite = 'critique' | 'elevee' | 'moyenne' | 'faible';

export const ORDRE_DES_GRAVITES: readonly GraviteSecurite[] = ['critique', 'elevee', 'moyenne', 'faible'];

export const LIBELLE_DE_GRAVITE: Record<GraviteSecurite, string> = {
  critique: 'Critique — à traiter tout de suite',
  elevee: 'Élevée — à traiter cette semaine',
  moyenne: 'Moyenne — à planifier',
  faible: 'Faible — à savoir',
};

export type CategorieSecurite =
  | 'dependances'
  | 'cadre'
  | 'secrets'
  | 'acces'
  | 'injection-sql'
  | 'injection-shell'
  | 'xss'
  | 'entetes'
  /** La protection contre les robots : renvoi des IA, adresses de travail fermées, garde des visiteurs insistants. */
  | 'robots'
  /** Un point d'une ÉTUDE rédigée à la main par un agent (`etude-de-securite.ts`), jamais du contrôle automatique. */
  | 'etude';

export interface ConstatSecurite {
  /** Clé stable : sert à dédoublonner et à nommer la carte proposée. */
  id: string;
  categorie: CategorieSecurite;
  gravite: GraviteSecurite;
  /** En mots courants. */
  titre: string;
  /** Ce qui risque d'arriver, pour quelqu'un qui ne programme pas. */
  risque: string;
  /** Ce qu'on propose de faire. */
  proposition: string;
  /** Où regarder (chemin:ligne, paquet, adresse) — quelques exemples, jamais une valeur secrète. */
  ou: string[];
  /** Le détail destiné à l'agent qui fera la correction. */
  technique?: string;
}

/* ------------------------------------------------------------------ */
/* Fichiers                                                            */
/* ------------------------------------------------------------------ */

const EXT_CODE = /\.(m?[jt]sx?|cjs|cts|mts|php|py|rb|go|java|kt|cs|vue|svelte|astro|html?)$/i;
const IGNORES = /(^|\/)(node_modules|vendor|dist|build|\.next|\.nuxt|coverage|\.git|outils|third_party)\//;
const FICHIERS_DE_TEST = /(^|\/)(tests?|__tests__|spec|fixtures?|e2e)\/|\.(test|spec)\.[a-z]+$/i;
const VERROUS = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|poetry\.lock|Cargo\.lock)$/;

/** Un fichier versionné qui mérite d'être lu : du code ou de la configuration, hors dépendances embarquées. */
export function fichierAExaminer(chemin: string): boolean {
  if (IGNORES.test(chemin) || VERROUS.test(chemin)) return false;
  if (/\.min\.(js|css)$/.test(chemin)) return false;
  const nom = chemin.split('/').pop() ?? '';
  return EXT_CODE.test(chemin) || /^\.env/.test(nom) || /\.(json|ya?ml|toml|ini|conf|sh)$/i.test(chemin);
}

/** Outils lancés à la main par l'exploitant (scripts, migrations) : aucun visiteur ne les atteint. */
const OUTILS_D_EXPLOITATION = /(^|\/)(scripts|bin|tools|migrations?|seeds?)\//;

/** Du code que le site exécute pour ses visiteurs : ni test, ni outil d'exploitation. */
export function fichierDeCode(chemin: string): boolean {
  return EXT_CODE.test(chemin) && !IGNORES.test(chemin) && !FICHIERS_DE_TEST.test(chemin) && !OUTILS_D_EXPLOITATION.test(chemin);
}

const DOSSIERS_NAVIGATEUR = new Set([
  'web', 'client', 'frontend', 'front', 'public', 'static', 'www', 'assets', 'pwa', 'browser', 'site',
]);
const DOSSIERS_SERVEUR = new Set(['server', 'serveur', 'api', 'backend', 'functions', 'scripts', 'shared']);

/**
 * Le fichier part-il au navigateur des visiteurs ? Vrai pour une page (`.html`, `.vue`, `.svelte`…)
 * et pour tout fichier rangé sous un dossier de l'interface (« web/ », « public/ »…) qui n'est pas
 * dans un dossier serveur plus proche. Un `.env` n'y part jamais en entier : seules ses variables
 * publiques le font (`ligneVersLeNavigateur`).
 */
export function cheminCoteNavigateur(chemin: string): boolean {
  const nom = chemin.split('/').pop() ?? '';
  if (/^\.env/.test(nom)) return false;
  if (/\.(html?|vue|svelte|astro|jsx|tsx)$/i.test(nom)) return true;
  const segments = chemin.split('/').slice(0, -1).map((s) => s.toLowerCase());
  for (let i = segments.length - 1; i >= 0; i--) {
    if (DOSSIERS_SERVEUR.has(segments[i]!)) return false;
    if (DOSSIERS_NAVIGATEUR.has(segments[i]!)) return true;
  }
  return false;
}

/** Une variable que l'outil de construction recopie dans la page servie au navigateur. */
const VARIABLE_PUBLIQUE = /\b(VITE_|NEXT_PUBLIC_|NUXT_PUBLIC_|REACT_APP_|EXPO_PUBLIC_|PUBLIC_|GATSBY_)[A-Z0-9_]*\s*[:=]/;

export function ligneVersLeNavigateur(ligne: string): boolean {
  return VARIABLE_PUBLIQUE.test(ligne);
}

/* ------------------------------------------------------------------ */
/* Clés écrites en clair                                               */
/* ------------------------------------------------------------------ */

interface MotifDeCle {
  genre: string;
  motif: RegExp;
}

const GENRE_GENERIQUE = 'mot de passe ou clé écrit en clair';

/**
 * Le motif générique (« password = "…" ») attrape aussi les libellés de traduction
 * (« "login.password": "Password" ») : une valeur ne compte que si elle mêle lettres et chiffres,
 * ou si elle est longue et n'est pas un simple mot ou un nom de clé.
 */
export function valeurQuiRessembleAUnSecret(valeur: string): boolean {
  if (/^[\p{L}_.-]+$/u.test(valeur)) return false;
  return (/\d/.test(valeur) && /[A-Za-z]/.test(valeur)) || valeur.length >= 20;
}

/** Seulement des motifs PRÉCIS : un rapport bruyant ne se lit plus. */
const MOTIFS_DE_CLE: readonly MotifDeCle[] = [
  { genre: 'clé privée', motif: /-----BEGIN (RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY( BLOCK)?-----/ },
  { genre: 'clé Amazon Web Services', motif: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { genre: 'jeton GitHub', motif: /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/ },
  { genre: "clé d'intelligence artificielle", motif: /\bsk-(ant-|proj-|or-v1-)?[A-Za-z0-9_-]{32,}/ },
  { genre: 'clé secrète Stripe', motif: /\b(sk|rk)_live_[A-Za-z0-9]{20,}/ },
  { genre: 'jeton Slack', motif: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { genre: 'adresse de base de données avec mot de passe', motif: /\b(postgres(ql)?|mysql|mariadb|mongodb(\+srv)?|redis|amqp):\/\/[^\s:/@'"]+:[^\s@'"$]{4,}@/ },
  {
    genre: GENRE_GENERIQUE,
    motif: /\b[\w-]*(password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret)[\w-]*['"]?\s*[:=]\s*['"]([^'"\s]{8,})['"]/i,
  },
];

/** Valeurs de façade : exemples, gabarits, renvois à une variable. */
const VALEUR_FACTICE = /(example|exemple|changeme|change_me|placeholder|your[_-]|votre[_-]|xxxx|\*\*\*\*|<[^>]+>|\$\{|process\.env|import\.meta\.env|getenv|os\.environ|dummy|fake|test|sample|redacted|\.\.\.)/i;

export interface CleTrouvee {
  chemin: string;
  ligne: number;
  genre: string;
  /** Vrai quand la ligne est une variable recopiée dans la page servie au navigateur. */
  versNavigateur: boolean;
}

/** Les clés écrites dans un fichier — le GENRE et la LIGNE seulement, jamais la valeur. */
export function clesEcrites(chemin: string, contenu: string): CleTrouvee[] {
  const trouvees: CleTrouvee[] = [];
  const lignes = contenu.split('\n');
  lignes.forEach((texte, i) => {
    if (texte.length > 2000) return; // ligne compactée : illisible, et source de faux signaux
    for (const { genre, motif } of MOTIFS_DE_CLE) {
      const m = motif.exec(texte);
      if (!m) continue;
      if (genre !== 'clé privée' && VALEUR_FACTICE.test(m[0])) continue;
      if (genre === GENRE_GENERIQUE && !valeurQuiRessembleAUnSecret(m[m.length - 1] ?? '')) continue;
      trouvees.push({ chemin, ligne: i + 1, genre, versNavigateur: ligneVersLeNavigateur(texte) });
      break;
    }
  });
  return trouvees;
}

/**
 * LA FRONTIÈRE DU SILENCE. Une clé ne se signale que si des inconnus peuvent la lire : dépôt
 * public, ou clé envoyée au navigateur. Sinon : `null`, et le rapport n'en dit rien.
 */
export function graviteDUneCle(cle: CleTrouvee, depotPublic: boolean): GraviteSecurite | null {
  const navigateur = cle.versNavigateur || cheminCoteNavigateur(cle.chemin);
  if (depotPublic) return 'critique';
  if (navigateur) return 'elevee';
  return null;
}

export function constatsDeCles(cles: readonly CleTrouvee[], depotPublic: boolean): ConstatSecurite[] {
  const publiques: CleTrouvee[] = [];
  const navigateur: CleTrouvee[] = [];
  for (const cle of cles) {
    const g = graviteDUneCle(cle, depotPublic);
    if (g === 'critique') publiques.push(cle);
    else if (g === 'elevee') navigateur.push(cle);
  }
  const constats: ConstatSecurite[] = [];
  const ou = (liste: CleTrouvee[]) => liste.slice(0, 8).map((c) => `${c.chemin}:${c.ligne} (${c.genre})`);
  if (publiques.length) {
    constats.push({
      id: 'secrets-depot-public',
      categorie: 'secrets',
      gravite: 'critique',
      titre: `${publiques.length} clé(s) ou mot(s) de passe lisible(s) par tous dans le dépôt public`,
      risque:
        "Le code de ce projet est visible par n'importe qui sur Internet, et des robots y cherchent les clés en permanence. Avec elles, un inconnu peut se connecter à vos services, dépenser sur vos comptes ou lire vos données.",
      proposition:
        "Changer chaque clé concernée chez son fournisseur (l'ancienne doit être considérée comme volée), la ranger hors du code, puis l'effacer de l'historique du dépôt — ou repasser le dépôt en privé.",
      ou: ou(publiques),
      technique:
        'Rotation chez le fournisseur AVANT tout nettoyage ; lecture par variable d’environnement ; purge de l’historique (git filter-repo) puis push forcé ; ou `gh repo edit --visibility private`.',
    });
  }
  if (navigateur.length) {
    constats.push({
      id: 'secrets-navigateur',
      categorie: 'secrets',
      gravite: 'elevee',
      titre: `${navigateur.length} clé(s) envoyée(s) au navigateur des visiteurs`,
      risque:
        "Ces clés partent dans les pages que chaque visiteur télécharge : n'importe qui peut les lire en ouvrant les outils de son navigateur et s'en servir à votre place.",
      proposition:
        "Faire passer l'appel concerné par le serveur, qui garde la clé pour lui ; si la clé est faite pour être publique (carte, statistiques), la restreindre à l'adresse du site chez son fournisseur.",
      ou: ou(navigateur),
      technique:
        'Variable sans préfixe public (VITE_/NEXT_PUBLIC_…), appel relayé par une route serveur ; sinon restriction de domaine/référent chez le fournisseur.',
    });
  }
  return constats;
}

/* ------------------------------------------------------------------ */
/* Injections                                                          */
/* ------------------------------------------------------------------ */

export type GenreInjection = 'injection-sql' | 'injection-shell' | 'xss';

export interface InjectionTrouvee {
  chemin: string;
  ligne: number;
  genre: GenreInjection;
  /** Vrai quand la ligne prend directement une saisie de visiteur (requête, formulaire). */
  saisieDirecte: boolean;
}

const SAISIE = /\b(req|request|ctx\.request|event)\.(query|body|params|headers|cookies)|\$_(GET|POST|REQUEST|COOKIE|SERVER)|request\.(args|form|GET|POST)|searchParams\.get|location\.(search|hash)/;
const SQL_DANS_CHAINE = /[`'"][^`'"]*\b(SELECT\s+[\w*]|INSERT\s+INTO\b|UPDATE\s+\w+\s+SET\b|DELETE\s+FROM\b)/i;
const INTERPOLATION = /\$\{[^}]+\}|['"]\s*\+\s*[\w$.[\]()]+|[\w$.[\]()]+\s*\+\s*['"]|\.\s*\$\w+|"\s*\.\s*\$|\{\s*\$\w+\s*\}|%s|(^|[\s(=,])f["']/;
const APPEL_SQL = /\b(query|execute|exec|prepare|raw|unsafe|all|get|run|mysqli?_query|pg_query)\s*\(/;

const SHELL = /(\b(execSync|exec)\s*\(\s*[`'"]|\bspawn(Sync)?\s*\([^)]*shell\s*:\s*true|\b(shell_exec|passthru|system|popen|proc_open)\s*\(|os\.system\s*\(|subprocess\.\w+\([^)]*shell\s*=\s*True)/;
const XSS = /(\.innerHTML\s*[+]?=\s*(?!\s*['"`]\s*['"`]\s*;?\s*$)|\.outerHTML\s*=|dangerouslySetInnerHTML|\bv-html\s*=|document\.write\s*\(|insertAdjacentHTML\s*\(|\{!!.+!!\}|\|\s*safe\b|echo\s+\$_(GET|POST|REQUEST)|<\?=\s*\$_(GET|POST|REQUEST))/;

/** Les lignes d'un fichier de code qui bâtissent une requête, une commande ou du HTML à partir de variables. */
export function injectionsDansLeCode(chemin: string, contenu: string): InjectionTrouvee[] {
  if (!fichierDeCode(chemin)) return [];
  const trouvees: InjectionTrouvee[] = [];
  contenu.split('\n').forEach((texte, i) => {
    if (texte.length > 2000) return;
    const t = texte.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('#') || t.startsWith('/*')) return;
    // La définition d'un motif de recherche (celui-ci, par exemple) n'est pas du code qui s'exécute.
    if (/^(export\s+)?const\s+[A-Z_]+\s*=\s*\//.test(t)) return;
    const saisieDirecte = SAISIE.test(texte);
    if (SQL_DANS_CHAINE.test(texte) && INTERPOLATION.test(texte) && (APPEL_SQL.test(texte) || saisieDirecte)) {
      trouvees.push({ chemin, ligne: i + 1, genre: 'injection-sql', saisieDirecte });
    } else if (SHELL.test(texte) && (INTERPOLATION.test(texte) || saisieDirecte)) {
      trouvees.push({ chemin, ligne: i + 1, genre: 'injection-shell', saisieDirecte });
    } else if (XSS.test(texte) && !/innerHTML\s*=\s*['"`][^'"`$]*['"`]\s*;?\s*$/.test(t)) {
      trouvees.push({ chemin, ligne: i + 1, genre: 'xss', saisieDirecte });
    }
  });
  return trouvees;
}

const TEXTES_INJECTION: Record<GenreInjection, { titre: string; risque: string; proposition: string; technique: string }> = {
  'injection-sql': {
    titre: 'requête(s) vers la base montée(s) à la main',
    risque:
      "Si un visiteur glisse du texte piégé dans un formulaire ou une adresse, il peut lire, modifier ou effacer des données de la base — c'est l'attaque la plus courante contre les sites.",
    proposition: 'Passer ces requêtes en requêtes « préparées », où les valeurs ne se mélangent jamais au texte de la requête.',
    technique: 'Paramètres liés (?, $1, :nom) au lieu de concaténation / gabarit ; noms de colonnes en liste blanche.',
  },
  'injection-shell': {
    titre: 'commande(s) système montée(s) à partir de variables',
    risque:
      "Si une de ces valeurs vient d'un visiteur, il peut faire exécuter ses propres commandes sur le serveur — en prendre le contrôle, lire ou effacer les fichiers.",
    proposition: 'Lancer ces programmes avec leurs arguments séparés, sans passer par un interpréteur de commandes, et vérifier chaque valeur reçue.',
    technique: 'execFile/spawn avec tableau d’arguments, sans shell:true ; validation stricte (liste blanche) des valeurs.',
  },
  xss: {
    titre: 'endroit(s) où du HTML est inséré tel quel dans la page',
    risque:
      "Si le texte inséré vient d'un visiteur, il peut y cacher un script qui s'exécute chez les autres visiteurs : vol de session, fausse page de connexion, actions faites en leur nom.",
    proposition: 'Afficher ces textes comme du texte, ou les nettoyer avec un filtre éprouvé avant de les insérer.',
    technique: 'textContent / rendu échappé du cadre ; sinon DOMPurify (ou équivalent) ; politique CSP en filet.',
  },
};

export function constatsDInjections(trouvees: readonly InjectionTrouvee[]): ConstatSecurite[] {
  const constats: ConstatSecurite[] = [];
  for (const genre of ['injection-sql', 'injection-shell', 'xss'] as const) {
    const liste = trouvees.filter((t) => t.genre === genre);
    if (!liste.length) continue;
    const directes = liste.filter((t) => t.saisieDirecte);
    const textes = TEXTES_INJECTION[genre];
    const gravite: GraviteSecurite = directes.length
      ? genre === 'xss'
        ? 'elevee'
        : 'critique'
      : genre === 'xss'
        ? 'faible'
        : 'moyenne';
    const exemples = [...directes, ...liste.filter((t) => !t.saisieDirecte)].slice(0, 8);
    constats.push({
      id: genre,
      categorie: genre,
      gravite,
      titre: `${liste.length} ${textes.titre}${directes.length ? `, dont ${directes.length} avec une saisie de visiteur` : ''}`,
      risque: textes.risque,
      proposition: directes.length
        ? textes.proposition
        : `${textes.proposition} Aucune ne prend directement une saisie de visiteur : c'est à relire plus qu'à réparer d'urgence.`,
      ou: exemples.map((t) => `${t.chemin}:${t.ligne}`),
      technique: textes.technique,
    });
  }
  return constats;
}

/* ------------------------------------------------------------------ */
/* Routes et contrôle d'accès                                          */
/* ------------------------------------------------------------------ */

export interface RoutesDUnFichier {
  chemin: string;
  routes: number;
  /** Routes qui modifient quelque chose (POST, PUT, PATCH, DELETE). */
  ecritures: number;
  garde: boolean;
}

const ROUTE = /\b(app|router|server|fastify|api|route|r)\.(get|post|put|patch|delete|all)\s*\(\s*['"`]\//g;
const ROUTE_NEXT = /export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b|export\s+default\s+(async\s+)?function\s+handler/g;
const GARDE = /\b(auth|authenticate|authorize|requireAuth|requireUser|requireAdmin|isAuthenticated|ensureLoggedIn|passport|jwt|verifyToken|session|getServerSession|currentUser|guard|protect|permission|role|token|cookie|bearer|apiKey|basicAuth|clerk|supabase\.auth|login)\b/i;

export function routesDuFichier(chemin: string, contenu: string): RoutesDUnFichier | null {
  if (!fichierDeCode(chemin)) return null;
  const nextApi = /(^|\/)(pages\/api|app\/api)\//.test(chemin);
  let routes = 0;
  let ecritures = 0;
  for (const m of contenu.matchAll(ROUTE)) {
    routes++;
    if (m[2] !== 'get') ecritures++;
  }
  if (nextApi) {
    for (const m of contenu.matchAll(ROUTE_NEXT)) {
      routes++;
      if (m[2] !== 'GET') ecritures++;
    }
  }
  if (!routes) return null;
  return { chemin, routes, ecritures, garde: GARDE.test(contenu) };
}

export function constatsDAcces(fichiers: readonly RoutesDUnFichier[], gardeGlobale: boolean): ConstatSecurite[] {
  if (gardeGlobale) return [];
  const nus = fichiers.filter((f) => !f.garde);
  if (!nus.length) return [];
  const ecritures = nus.reduce((s, f) => s + f.ecritures, 0);
  const routes = nus.reduce((s, f) => s + f.routes, 0);
  return [
    {
      id: 'routes-sans-garde',
      categorie: 'acces',
      gravite: ecritures ? 'elevee' : 'moyenne',
      titre: `${routes} adresse(s) du serveur sans contrôle d'accès visible${ecritures ? `, dont ${ecritures} qui modifient des données` : ''}`,
      risque:
        "Ces points d'entrée du serveur ne vérifient pas, à la lecture, qui les appelle. Si l'un d'eux n'est pas censé être ouvert à tous, n'importe qui peut lire ou modifier ce qu'il protège sans se connecter.",
      proposition:
        'Relire chacune de ces adresses : celles qui doivent rester privées reçoivent une vérification de connexion (et de droits) ; celles qui sont publiques exprès sont notées comme telles.',
      ou: nus.slice(0, 8).map((f) => `${f.chemin} (${f.routes} route(s))`),
      technique:
        'Repérage par motifs (app.get/post…, routes Next) sans mot-clé de garde dans le fichier : un middleware posé ailleurs peut couvrir ces routes — vérifier avant de corriger.',
    },
  ];
}

/* ------------------------------------------------------------------ */
/* En-têtes HTTP de l'adresse publique                                 */
/* ------------------------------------------------------------------ */

export interface ReponseHttp {
  adresse: string;
  statut: number;
  /** Noms en minuscules. `set-cookie` peut porter plusieurs valeurs. */
  entetes: Record<string, string | string[]>;
  /** L'adresse en http:// renvoie-t-elle vers https:// ? `undefined` = non vérifié. */
  redirigeVersHttps?: boolean;
}

function entete(r: ReponseHttp, nom: string): string | undefined {
  const v = r.entetes[nom];
  return Array.isArray(v) ? v.join(', ') : v;
}

export function constatsDEntetes(r: ReponseHttp): ConstatSecurite[] {
  const constats: ConstatSecurite[] = [];
  const https = r.adresse.startsWith('https://');
  const csp = entete(r, 'content-security-policy');
  const ajouter = (c: Omit<ConstatSecurite, 'categorie' | 'ou'>) =>
    constats.push({ ...c, categorie: 'entetes', ou: [r.adresse] });

  if (!https) {
    ajouter({
      id: 'entete-sans-https',
      gravite: 'elevee',
      titre: "L'adresse publique n'est pas chiffrée",
      risque: "Ce qui circule entre le visiteur et le site (mots de passe compris) peut être lu par quelqu'un sur le même réseau Wi-Fi.",
      proposition: "Servir le site en https, avec un certificat gratuit, et rediriger l'ancienne adresse.",
      technique: 'Certificat Let’s Encrypt (Caddy le fait seul) + redirection 301.',
    });
  } else if (r.redirigeVersHttps === false) {
    ajouter({
      id: 'entete-http-sans-redirection',
      gravite: 'moyenne',
      titre: "L'adresse sans « s » ne renvoie pas vers la version chiffrée",
      risque: "Un visiteur qui tape l'adresse sans « https » reste sur une connexion lisible par un voisin de réseau.",
      proposition: 'Rediriger systématiquement http vers https.',
      technique: 'Redirection 301 au niveau du proxy.',
    });
  }
  if (https && !entete(r, 'strict-transport-security')) {
    ajouter({
      id: 'entete-hsts',
      gravite: 'moyenne',
      titre: 'Le navigateur n\'est pas obligé de rester en connexion chiffrée',
      risque: 'Sur un réseau piégé, un attaquant peut faire basculer un visiteur vers une version non chiffrée du site.',
      proposition: 'Ajouter la consigne qui impose la connexion chiffrée pour les visites suivantes.',
      technique: 'Strict-Transport-Security: max-age=31536000; includeSubDomains',
    });
  }
  if (!csp) {
    ajouter({
      id: 'entete-csp',
      gravite: 'moyenne',
      titre: 'Aucune liste des sources autorisées pour les scripts',
      risque: "Si un script piégé parvient à s'insérer dans une page, rien n'empêche le navigateur de l'exécuter.",
      proposition: 'Déclarer les seules sources de scripts, styles et images que le site utilise réellement.',
      technique: 'Content-Security-Policy (commencer en Content-Security-Policy-Report-Only).',
    });
  }
  if (!entete(r, 'x-frame-options') && !(csp && /frame-ancestors/i.test(csp))) {
    ajouter({
      id: 'entete-cadre',
      gravite: 'faible',
      titre: "Le site peut être affiché dans la page d'un autre site",
      risque: "Un site piège peut afficher le vôtre en transparence et faire cliquer vos visiteurs sur vos boutons à leur insu.",
      proposition: 'Interdire l\'affichage du site dans un cadre étranger.',
      technique: "X-Frame-Options: DENY (ou CSP frame-ancestors 'self').",
    });
  }
  if ((entete(r, 'x-content-type-options') ?? '').toLowerCase() !== 'nosniff') {
    ajouter({
      id: 'entete-nosniff',
      gravite: 'faible',
      titre: 'Le navigateur peut deviner lui-même la nature des fichiers',
      risque: 'Un fichier envoyé par un visiteur (image, texte) pourrait être interprété comme un script.',
      proposition: 'Demander au navigateur de respecter le type annoncé de chaque fichier.',
      technique: 'X-Content-Type-Options: nosniff',
    });
  }
  if (!entete(r, 'referrer-policy')) {
    ajouter({
      id: 'entete-referrer',
      gravite: 'faible',
      titre: "Les adresses complètes des pages partent vers les autres sites",
      risque: "Quand un visiteur suit un lien sortant, l'adresse exacte de la page quittée (avec ce qu'elle contient) est transmise au site suivant.",
      proposition: "Ne transmettre que le nom du site, pas l'adresse complète.",
      technique: 'Referrer-Policy: strict-origin-when-cross-origin',
    });
  }
  const revele = [entete(r, 'x-powered-by'), entete(r, 'server')].filter((v): v is string => !!v && /\d/.test(v));
  if (revele.length) {
    ajouter({
      id: 'entete-version',
      gravite: 'faible',
      titre: 'Le serveur annonce ses logiciels et leurs versions',
      risque: 'Un attaquant sait tout de suite quelles failles connues essayer.',
      proposition: 'Retirer ces mentions des réponses du serveur.',
      technique: `En-têtes révélateurs : ${revele.join(' ; ')}`,
    });
  }
  const origine = entete(r, 'access-control-allow-origin');
  if (origine === '*' && (entete(r, 'access-control-allow-credentials') ?? '').toLowerCase() === 'true') {
    ajouter({
      id: 'entete-cors',
      gravite: 'elevee',
      titre: "N'importe quel site peut interroger le vôtre au nom d'un visiteur connecté",
      risque: "Un site tiers peut lire les données d'un visiteur connecté chez vous pendant qu'il le visite.",
      proposition: 'Limiter les sites autorisés à la liste réelle des vôtres.',
      technique: 'Access-Control-Allow-Origin explicite (pas *) avec credentials.',
    });
  }
  const cookies = r.entetes['set-cookie'];
  const listeCookies = Array.isArray(cookies) ? cookies : cookies ? [cookies] : [];
  const fragiles = listeCookies.filter((c) => (https && !/;\s*secure/i.test(c)) || !/;\s*httponly/i.test(c));
  if (fragiles.length) {
    ajouter({
      id: 'entete-cookies',
      gravite: 'moyenne',
      titre: `${fragiles.length} témoin(s) de connexion mal protégé(s)`,
      risque: 'Un témoin lisible par les scripts de la page, ou envoyé sans chiffrement, peut être volé et servir à se faire passer pour le visiteur.',
      proposition: "Marquer ces témoins comme réservés au serveur et à la connexion chiffrée.",
      technique: 'Set-Cookie: …; Secure; HttpOnly; SameSite=Lax — noms : ' +
        fragiles.map((c) => c.split('=')[0]).join(', '),
    });
  }
  return constats;
}

/* ------------------------------------------------------------------ */
/* Dépendances et cadre                                                */
/* ------------------------------------------------------------------ */

export interface DependanceVulnerable {
  nom: string;
  gravite: GraviteSecurite;
  /** Une version corrigée existe-t-elle sans changement majeur ? */
  correctionDisponible: boolean;
  /** Pile : npm, composer, pip… */
  pile: string;
}

/** Les niveaux des outils d'audit (npm, composer, pip-audit) ramenés aux quatre gravités. */
export function graviteDAudit(niveau: string): GraviteSecurite {
  const n = niveau.toLowerCase();
  if (n === 'critical' || n === 'critique') return 'critique';
  if (n === 'high' || n === 'elevee' || n === 'élevée') return 'elevee';
  if (n === 'moderate' || n === 'medium' || n === 'moyenne') return 'moyenne';
  return 'faible';
}

/** Les cadres (frameworks) dont une faille touche TOUT le site, pas une fonction isolée. */
export const CADRES_CONNUS: readonly string[] = [
  'next', 'nuxt', 'express', 'fastify', 'koa', 'hono', '@nestjs/core', 'react', 'react-dom', 'vue',
  'svelte', '@sveltejs/kit', 'astro', 'vite', '@remix-run/node', 'laravel/framework', 'symfony/http-kernel',
  'symfony/symfony', 'django', 'flask', 'fastapi', 'rails', 'wordpress', 'johnpbloch/wordpress',
];

export function estUnCadre(nom: string): boolean {
  return CADRES_CONNUS.includes(nom.toLowerCase());
}

export function constatsDeDependances(liste: readonly DependanceVulnerable[]): ConstatSecurite[] {
  const constats: ConstatSecurite[] = [];
  const cadres = liste.filter((d) => estUnCadre(d.nom));
  if (cadres.length) {
    const pire = trierParGravite(cadres)[0]!.gravite;
    constats.push({
      id: 'cadre-faille-connue',
      categorie: 'cadre',
      gravite: pire === 'faible' ? 'moyenne' : pire,
      titre: `Faille connue dans le socle du site (${[...new Set(cadres.map((c) => c.nom))].join(', ')})`,
      risque:
        "Le socle sur lequel tout le site est bâti a une faille publiée : les attaquants l'essaient automatiquement sur tous les sites qui l'utilisent.",
      proposition: 'Mettre le socle à jour vers la version corrigée, puis vérifier que le site fonctionne comme avant.',
      ou: cadres.map((c) => `${c.nom} (${c.pile})`),
      technique: cadres.some((c) => !c.correctionDisponible)
        ? 'Correction seulement par montée de version majeure pour une partie : à cadrer.'
        : 'Correction disponible sans changement majeur.',
    });
  }
  const autres = liste.filter((d) => !estUnCadre(d.nom));
  for (const gravite of ORDRE_DES_GRAVITES) {
    const ici = autres.filter((d) => d.gravite === gravite);
    if (!ici.length) continue;
    const auto = ici.filter((d) => d.correctionDisponible).length;
    constats.push({
      id: `dependances-${gravite}`,
      categorie: 'dependances',
      gravite,
      titre: `${ici.length} composant(s) externe(s) avec une faille connue de gravité ${LIBELLE_DE_GRAVITE[gravite].split(' —')[0]!.toLowerCase()}`,
      risque:
        'Le projet utilise des briques écrites par d\'autres, dont une version a une faille publiée. Selon la brique, un attaquant peut faire planter le site, lire des données ou exécuter du code.',
      proposition: auto === ici.length
        ? 'Passer ces briques à leur version corrigée : la mise à jour ne change pas leur fonctionnement.'
        : `Passer ces briques à leur version corrigée ; ${ici.length - auto} demandent un changement de version majeur, à essayer avec soin.`,
      ou: ici.slice(0, 12).map((d) => `${d.nom} (${d.pile})`),
      technique: 'npm audit fix (sans --force d’abord) / composer update / pip install -U ; relancer les tests.',
    });
  }
  return constats;
}

/* ------------------------------------------------------------------ */
/* Le rapport                                                          */
/* ------------------------------------------------------------------ */

export function trierParGravite<T extends { gravite: GraviteSecurite }>(liste: readonly T[]): T[] {
  return [...liste].sort((a, b) => ORDRE_DES_GRAVITES.indexOf(a.gravite) - ORDRE_DES_GRAVITES.indexOf(b.gravite));
}

export interface EtapeDuControle {
  /** En mots courants : « Composants externes », « Clés écrites dans le code »… */
  nom: string;
  etat: 'fait' | 'non-verifie';
  /** Pourquoi un contrôle n'a pas pu se faire, ou ce qu'il a couvert. */
  note?: string;
}

export interface RapportDeSecurite {
  projet: string;
  date: string;
  depotPublic: boolean | null;
  adresse?: string;
  constats: ConstatSecurite[];
  etapes: EtapeDuControle[];
}

export function compteParGravite(constats: readonly ConstatSecurite[]): Record<GraviteSecurite, number> {
  const c: Record<GraviteSecurite, number> = { critique: 0, elevee: 0, moyenne: 0, faible: 0 };
  for (const x of constats) c[x.gravite]++;
  return c;
}

/** Le rapport écrit pour quelqu'un qui ne programme pas : par gravité, « ce qui risque » puis « ce qu'on propose ». */
export function rapportEnTexte(r: RapportDeSecurite): string {
  const constats = trierParGravite(r.constats);
  const n = compteParGravite(constats);
  const l: string[] = [];
  l.push(`# Contrôle de sécurité — ${r.projet}`, '');
  l.push(`Fait le ${r.date}.` +
    (r.depotPublic === true ? ' Le code de ce projet est PUBLIC.' : r.depotPublic === false ? ' Le code de ce projet est privé.' : '') +
    (r.adresse ? ` Adresse contrôlée : ${r.adresse}.` : ''));
  l.push('');
  if (!constats.length) {
    l.push('Aucun point à signaler sur ce qui a pu être vérifié.', '');
  } else {
    l.push(`**${constats.length} point(s)** : ${ORDRE_DES_GRAVITES.filter((g) => n[g]).map((g) => `${n[g]} ${LIBELLE_DE_GRAVITE[g].split(' —')[0]!.toLowerCase()}`).join(', ')}.`, '');
    for (const g of ORDRE_DES_GRAVITES) {
      const ici = constats.filter((c) => c.gravite === g);
      if (!ici.length) continue;
      l.push(`## ${LIBELLE_DE_GRAVITE[g]}`, '');
      for (const c of ici) {
        l.push(`### ${c.titre}`, '');
        l.push(`**Ce qui risque :** ${c.risque}`, '');
        l.push(`**Ce qu'on propose :** ${c.proposition}`, '');
        if (c.ou.length) l.push(`Où : ${c.ou.join(' · ')}`, '');
      }
    }
  }
  l.push('## Ce qui a été vérifié', '');
  for (const e of r.etapes) {
    l.push(`- ${e.etat === 'fait' ? '✓' : '○ non vérifié —'} ${e.nom}${e.note ? ` : ${e.note}` : ''}`);
  }
  l.push('');
  l.push(
    'Aucune correction n\'a été faite : chaque point ci-dessus est proposé en carte, à valider. ' +
      "Ce contrôle repère des signes connus ; une relecture approfondie du code par un agent (« security-review » de Claude, « review » de Codex) va plus loin sur la logique propre au projet.",
  );
  return l.join('\n');
}

export interface CarteProposee {
  titre: string;
  description: string;
  gravite: GraviteSecurite;
}

/** Une carte par point : la correction se PROPOSE, elle ne s'applique jamais d'office. */
export function carteDeCorrection(c: ConstatSecurite): CarteProposee {
  const court = c.titre.length > 70 ? `${c.titre.slice(0, 67)}…` : c.titre;
  return {
    titre: `Sécurité : ${court}`,
    gravite: c.gravite,
    description: [
      `Gravité : ${LIBELLE_DE_GRAVITE[c.gravite]}.`,
      '',
      `Ce qui risque : ${c.risque}`,
      '',
      `Ce qu'on propose : ${c.proposition}`,
      '',
      c.ou.length ? `Où : ${c.ou.join(' ; ')}` : '',
      c.technique ? `Notes techniques : ${c.technique}` : '',
      '',
      '**Vérification** : le contrôle de sécurité relancé ne remonte plus ce point, et les contrôles du projet passent.',
    ]
      .filter((x, i, t) => x !== '' || t[i - 1] !== '')
      .join('\n'),
  };
}

/** Une garde posée une fois pour toutes les routes (`app.use(requireAuth)`…) couvre aussi les fichiers sans mot-clé. */
export function gardeGlobaleDansLeCode(contenu: string): boolean {
  return /\.use\(\s*['"`]?\/?[\w/-]*['"`]?\s*,?\s*(auth\w*|requireAuth\w*|passport\.\w+|session\(|jwt\w*|verifyToken|basicAuth|clerkMiddleware|authMiddleware)/i.test(
    contenu,
  ) || /export\s+(default\s+)?(async\s+)?function\s+middleware\b[\s\S]{0,800}(auth|session|token)/i.test(contenu);
}
