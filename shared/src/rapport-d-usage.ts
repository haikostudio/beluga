/*
 * LE RAPPORT D'USAGE DES INSTALLATIONS — ce qu'une copie de Beluga Build
 * installée depuis le dépôt public dit de sa journée à l'auteur, en plus du
 * signe de vie (`shared/src/relais-installations.ts`).
 *
 * Décisions de l'utilisateur du 22/10/2026 :
 *  - l'envoi est SILENCIEUX : ni annonce, ni interrupteur, ni question posée ;
 *  - la RÉCEPTION, la conservation, les fiches et les cartes de panne vivent
 *    dans le central de Beluga Build (dépôt belugabuild), qui RECOPIE ce
 *    schéma : un champ changé ici casse la réception là-bas ;
 *  - la PROVENANCE est le pays des PERSONNES qui se connectent, calculé sur
 *    l'installation : seuls des pays et des nombres partent, jamais une adresse ;
 *  - l'usage se mesure AU MAXIMUM (gestes, écrans, temps par zone, sessions,
 *    agents, journal horodaté, fiche anonyme par personne, rapidité, santé de
 *    la machine, mises à jour, moteurs et limites, genre des projets, parcours
 *    d'installation) — mais RIEN de ce que les gens écrivent : ni demande, ni
 *    code, ni nom de projet, de carte ou de personne ;
 *  - la question de satisfaction est ABANDONNÉE : le champ `satisfaction`
 *    reste au contrat, toujours vide ;
 *  - les PANNES partent toutes seules, nettoyées et regroupées par empreinte.
 *
 * Règles pures : ni base, ni disque, ni réseau.
 */

import { z } from 'zod';

/** La porte du relais qui reçoit les rapports d'usage. */
export const ROUTE_DU_RAPPORT_D_USAGE = '/relais/usage';

/** Ce qu'une installation restée longtemps sans relais rattrape au plus, en jours. */
export const JOURS_DE_RATTRAPAGE = 14;

/** Le journal horodaté d'une journée s'arrête là : au-delà, seuls les compteurs avancent. */
export const JOURNAL_MAX_PAR_JOUR = 3000;

/** Combien de pannes DIFFÉRENTES une journée remonte au plus. */
export const PANNES_MAX_PAR_JOUR = 200;

/** Le mot libre d'un avis, coupé au-delà (champ `satisfaction` du contrat, toujours vide depuis le 22/10/2026). */
export const MOT_DE_SATISFACTION_MAX = 500;

/* ------------------------------------------------------------------ */
/* Le nettoyage de tout texte qui quitte l'installation                 */
/* ------------------------------------------------------------------ */

/**
 * LES DOSSIERS DU CODE DE BELUGA : un chemin absolu qui en contient un garde sa
 * fin (`server/dist/ws.js:12`), utile pour retrouver une panne ; tout ce qui
 * précède — souvent le nom du compte de la machine — disparaît.
 */
const DOSSIERS_DU_CODE = ['server', 'web', 'shared', 'node_modules', 'scripts', 'outils'];

function cheminRaccourci(chemin: string): string {
  const morceaux = chemin.split(/[\\/]/);
  for (let i = morceaux.length - 1; i >= 0; i -= 1) {
    if (DOSSIERS_DU_CODE.includes(morceaux[i]!)) {
      // node_modules : le paquet suffit, son emplacement sur la machine ne dit rien d'utile.
      // Rendu RELATIF : une seconde passe (à la réception) ne le reprend pas pour un chemin absolu.
      return morceaux.slice(i).join('/');
    }
  }
  return '[chemin]';
}

/**
 * CE QUI PEUT TRAHIR QUELQU'UN DANS UN TEXTE LIBRE (message d'erreur, mot de
 * la question de satisfaction) : courriels, adresses web, adresses de machine,
 * chemins absolus, jetons et clés, numéros longs (téléphone, carte), et les
 * identifiants tirés au hasard — qui, en prime, empêcheraient deux fois la
 * même panne de se reconnaître. Le texte est ensuite coupé à `max`.
 */
export function nettoyerTexteLibre(texte: string, max = MOT_DE_SATISFACTION_MAX): string {
  let propre = String(texte ?? '')
    // Courriels d'abord : ils contiennent des points et pourraient passer pour un nom de machine.
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[courriel]')
    .replace(/\b(?:https?|wss?|ftp|file):\/\/[^\s'"<>)]+/gi, '[adresse]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, '[ip]')
    .replace(/\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b/gi, '[ip]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id]')
    .replace(/\b(?:(?:sk|pk|rk)[-_]|gh[pousr]_|github_pat_|xox[a-z]-|whsec_)[\w-]{10,}|\bAKIA[0-9A-Z]{12,}|\beyJ[\w-]{10,}(?:\.[\w-]+)*/g, '[jeton]')
    .replace(/(?<![\w.@~+-])(?:[A-Za-z]:)?(?:[\\/][\w.@~+-]+){2,}[\\/]?(?::\d+(?::\d+)?)?/g, (chemin) => {
      const suite = /(:\d+(?::\d+)?)$/.exec(chemin)?.[1] ?? '';
      return `${cheminRaccourci(chemin.slice(0, chemin.length - suite.length))}${suite}`;
    })
    .replace(/\b[0-9a-f]{24,}\b/gi, '[jeton]')
    .replace(/\b(?=[A-Za-z0-9+/_-]*\d)(?=[A-Za-z0-9+/_-]*[A-Za-z])[A-Za-z0-9+/_-]{32,}={0,2}/g, '[jeton]')
    // Neuf chiffres au moins : un téléphone, une carte, un horodatage — pas une date ni un numéro de ligne.
    .replace(/(?<![\w-])\+?\d(?:[ .-]?\d){8,}(?![\w-])/g, '[numero]')
    .replace(/\s+/g, ' ')
    .trim();
  if (propre.length > max) propre = `${propre.slice(0, max)}…`;
  return propre;
}

/**
 * LES CITATIONS D'UN MESSAGE DE PANNE : ce qui est entre guillemets est presque
 * toujours une valeur de l'utilisateur (un nom de projet, de carte, de fichier).
 * On la masque — et deux pannes qui ne diffèrent que par elle se regroupent.
 */
export function masquerLesCitations(texte: string): string {
  return String(texte ?? '')
    .replace(/«[^»]{1,160}»/g, '«…»')
    .replace(/"[^"\n]{1,160}"/g, '"…"')
    .replace(/“[^”]{1,160}”/g, '“…”');
}

/** Une pile d'appels nettoyée ligne par ligne : chemins raccourcis, rien d'autre. */
export function nettoyerPile(pile: string | undefined, max = 2000): string | undefined {
  if (!pile) return undefined;
  const lignes = pile
    .split('\n')
    .slice(0, 12)
    .map((ligne) => nettoyerTexteLibre(ligne, 300))
    .filter(Boolean);
  const texte = lignes.join('\n');
  return texte ? texte.slice(0, max) : undefined;
}

/**
 * DE QUOI RECONNAÎTRE DEUX FOIS LA MÊME PANNE, d'une installation à l'autre :
 * l'origine, le message NETTOYÉ et l'endroit. Deux hachages FNV-1a de 32 bits
 * mis bout à bout — pas une protection, une étiquette courte et stable.
 */
export function empreinteDePanne(source: string, message: string, lieu = ''): string {
  const texte = `${source}|${message}|${lieu}`;
  const fnv = (graine: number) => {
    let h = graine >>> 0;
    for (let i = 0; i < texte.length; i += 1) {
      h ^= texte.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  };
  return `${fnv(0x811c9dc5)}${fnv(0x01000193)}`;
}

/** Le lieu d'une panne : la première ligne de sa pile qui pointe un fichier, sinon rien. */
export function lieuDeLaPanne(pile: string | undefined): string {
  const ligne = (pile ?? '').split('\n').find((l) => /\.(?:js|ts|tsx|mjs):\d+/.test(l));
  return ligne ? nettoyerTexteLibre(ligne.replace(/^\s*at\s+/, ''), 120) : '';
}

/* ------------------------------------------------------------------ */
/* Les mesures, réduites en règles pures                                */
/* ------------------------------------------------------------------ */

export interface Centile {
  n: number;
  p50: number;
  p95: number;
  max: number;
}

/** Médiane, 95ᵉ centile et maximum d'une série de durées (millisecondes). */
export function centiles(valeurs: readonly number[]): Centile {
  const tries = valeurs.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (!tries.length) return { n: 0, p50: 0, p95: 0, max: 0 };
  const rang = (p: number) => tries[Math.min(tries.length - 1, Math.ceil((p / 100) * tries.length) - 1)]!;
  return { n: tries.length, p50: Math.round(rang(50)), p95: Math.round(rang(95)), max: Math.round(tries[tries.length - 1]!) };
}

/**
 * LA FAMILLE D'UNE ROUTE : `/api/relais/installations` → `relais`. On ne garde
 * jamais l'adresse entière — elle porte parfois l'identifiant d'une carte.
 */
export function familleDeRoute(route: string): string {
  const morceau = String(route ?? '').replace(/^\/api\//, '').split(/[/?]/)[0] ?? '';
  return /^[a-z][a-z0-9-]{0,30}$/i.test(morceau) ? morceau.toLowerCase() : 'autre';
}

/** La FONCTIONNALITÉ d'un geste : la famille de sa commande (`card.move` → `card`). */
export function fonctionnaliteDuGeste(type: string): string {
  const famille = String(type ?? '').split('.')[0] ?? '';
  return /^[a-z][a-z0-9-]{0,30}$/i.test(famille) ? famille.toLowerCase() : 'autre';
}

/** Les gestes qui ne disent rien de l'usage : le pouls du canal. */
export const GESTES_MUETS: readonly string[] = ['hello', 'ping', 'acks.reclamer', 'ecran.perimetre', 'prefs.set'];

/**
 * LES GRANDES FONCTIONNALITÉS DE BELUGA, pour dire celles qu'une installation
 * n'a JAMAIS ouvertes. La famille d'une commande qui n'est pas ici compte quand
 * même dans l'usage, mais ne fait pas partie de cette liste de découverte.
 */
export const FONCTIONNALITES_DECOUVRABLES: readonly string[] = [
  'card',
  'project',
  'deploy',
  'espace',
  'coffre',
  'stats',
  'marketing',
  'memoire',
  'surveillance',
  'backup',
  'competences',
  'terminal',
  'compta',
];

/** Appareil, système et navigateur, lus dans ce que le navigateur dit de lui-même. */
export function appareilDuNavigateur(userAgent: string): { appareil: 'telephone' | 'tablette' | 'ordinateur'; systeme: string; navigateur: string } {
  const ua = String(userAgent ?? '');
  const tablette = /iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua));
  const telephone = !tablette && /iPhone|Android.*Mobile|Mobile/i.test(ua);
  const systeme = /iPhone|iPad|iPod/i.test(ua)
    ? 'iOS'
    : /Android/i.test(ua)
      ? 'Android'
      : /Mac OS X|Macintosh/i.test(ua)
        ? 'macOS'
        : /Windows/i.test(ua)
          ? 'Windows'
          : /CrOS/i.test(ua)
            ? 'ChromeOS'
            : /Linux/i.test(ua)
              ? 'Linux'
              : 'autre';
  const navigateur = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\/|FxiOS/.test(ua)
        ? 'Firefox'
        : /SamsungBrowser/.test(ua)
          ? 'Samsung'
          : /Chrome\/|CriOS/.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : 'autre';
  return { appareil: tablette ? 'tablette' : telephone ? 'telephone' : 'ordinateur', systeme, navigateur };
}

export const GENRES_DE_PROJET = ['site', 'application', 'mobile', 'script', 'autre'] as const;
export type GenreDeProjet = (typeof GENRES_DE_PROJET)[number];

/**
 * LE GENRE ET LES LANGAGES D'UN PROJET, lus dans les NOMS des fichiers posés à
 * sa racine — jamais dans leur contenu, et rien de ces noms ne part. Une règle
 * de devinette, assumée : elle sert à des statistiques, pas à un diagnostic.
 */
export function genreDuProjet(entrees: readonly string[]): { genre: GenreDeProjet; langages: string[] } {
  const noms = new Set(entrees.map((e) => e.toLowerCase()));
  const a = (...candidats: string[]) => candidats.some((c) => noms.has(c));
  const commence = (prefixe: string) => [...noms].some((n) => n.startsWith(prefixe));
  const langages = new Set<string>();
  if (a('package.json')) langages.add('javascript');
  if (a('tsconfig.json') || commence('tsconfig.')) langages.add('typescript');
  if (a('composer.json', 'wp-config.php', 'index.php', 'artisan')) langages.add('php');
  if (a('pyproject.toml', 'requirements.txt', 'setup.py', 'pipfile', 'manage.py')) langages.add('python');
  if (a('go.mod')) langages.add('go');
  if (a('cargo.toml')) langages.add('rust');
  if (a('gemfile')) langages.add('ruby');
  if (a('pom.xml', 'build.gradle', 'build.gradle.kts')) langages.add('java');
  if (a('pubspec.yaml')) langages.add('dart');
  if (a('package.swift') || commence('podfile')) langages.add('swift');
  if (a('index.html')) langages.add('html');
  if (a('dockerfile', 'docker-compose.yml', 'compose.yml', 'compose.yaml')) langages.add('docker');
  const mobile = commence('capacitor.config') || a('pubspec.yaml', 'android', 'ios');
  const site =
    commence('next.config') ||
    commence('nuxt.config') ||
    commence('astro.config') ||
    commence('svelte.config') ||
    commence('vite.config') ||
    a('wp-config.php', 'wp-content', 'index.html', '_config.yml', 'hugo.toml', 'gatsby-config.js');
  const application = a('server', 'api', 'manage.py', 'artisan', 'go.mod', 'cargo.toml', 'dockerfile', 'docker-compose.yml', 'compose.yml', 'pom.xml');
  const genre: GenreDeProjet = mobile ? 'mobile' : site ? 'site' : application ? 'application' : langages.size ? 'script' : 'autre';
  return { genre, langages: [...langages].sort() };
}

/* ------------------------------------------------------------------ */
/* Le rapport lui-même                                                  */
/* ------------------------------------------------------------------ */

const Numero = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const Secret = z.string().regex(/^[0-9a-f]{64}$/);
/** Le numéro anonyme d'une personne : stable sur son installation, impossible à remonter. */
const NumeroDePersonne = z.string().regex(/^[0-9a-f]{12}$/);
const Cle = z.string().max(80);
const Compteurs = z.record(Cle, z.number().min(0).max(1e14));
const N = z.number().min(0).max(1e14);
const CentileSchema = z.object({ n: N, p50: N, p95: N, max: N });

export const PersonneDuRapport = z.object({
  numero: NumeroDePersonne,
  role: z.string().max(20).default(''),
  pays: z.string().max(2).optional(),
  langue: z.string().max(12).optional(),
  langueNavigateur: z.string().max(20).optional(),
  appareil: z.string().max(20).optional(),
  systeme: z.string().max(30).optional(),
  navigateur: z.string().max(30).optional(),
  ecran: z.string().max(20).optional(),
  installee: z.boolean().optional(),
  theme: z.string().max(40).optional(),
  sessions: N.default(0),
  dureeS: N.default(0),
  gestes: N.default(0),
  fonctionnalites: Compteurs.default({}),
});
export type PersonneDuRapport = z.infer<typeof PersonneDuRapport>;

export const PanneDuRapport = z.object({
  empreinte: z.string().max(32),
  source: z.string().max(20),
  message: z.string().max(600),
  pile: z.string().max(2400).optional(),
  lieu: z.string().max(160).optional(),
  n: N,
});
export type PanneDuRapport = z.infer<typeof PanneDuRapport>;

export const AvisDuRapport = z.object({
  p: NumeroDePersonne,
  t: N,
  note: z.number().int().min(0).max(10),
  mot: z.string().max(MOT_DE_SATISFACTION_MAX + 10).optional(),
});
export type AvisDuRapport = z.infer<typeof AvisDuRapport>;

export const EvenementDuRapport = z.object({
  t: N,
  p: NumeroDePersonne.optional(),
  e: z.string().max(80),
  z: z.string().max(40).optional(),
});
export type EvenementDuRapport = z.infer<typeof EvenementDuRapport>;

export const MiseAJourDuRapport = z.object({
  de: z.string().max(80).default(''),
  vers: z.string().max(80).default(''),
  issue: z.enum(['reussie', 'ratee']),
  dureeS: N.optional(),
  t: N,
});

export const RapportDUsage = z.object({
  installation: Numero,
  secret: Secret,
  /** La journée décrite, en temps universel. */
  jour: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  version: z.string().max(80).default(''),
  machine: z
    .object({
      systeme: z.string().max(80),
      noyau: z.string().max(80),
      arch: z.string().max(20),
      processeurs: N,
      modeleProcesseur: z.string().max(120),
      memoireMo: N,
      disqueMo: N,
      disqueLibreMo: N,
      node: z.string().max(20),
      conteneur: z.boolean(),
      hebergeur: z.string().max(80),
      fuseau: z.string().max(60),
    })
    .partial()
    .default({}),
  sante: z
    .object({
      disquePct: N,
      memoirePicPct: N,
      chargePic: N,
      swapMo: N,
      demarrages: N,
      enMarcheS: N,
      dureeSansPanneS: N,
      retardCommits: N,
      misesAJour: z.array(MiseAJourDuRapport).max(50),
    })
    .partial()
    .default({}),
  moteurs: z
    .object({
      connectes: z.array(z.object({ moteur: z.string().max(40), comptes: N })).max(40),
      choix: Compteurs,
      limitesAtteintes: Compteurs,
      toursCoupesParLimite: N,
      demandesEnAttenteDeQuota: N,
    })
    .partial()
    .default({}),
  agents: z
    .object({
      lances: N,
      termines: N,
      echoues: N,
      arretes: N,
      dureeS: N,
      parMoteur: Compteurs,
      parNiveau: Compteurs,
    })
    .partial()
    .default({}),
  publications: z.object({ reussies: N, echouees: N, arretees: N }).partial().default({}),
  projets: z
    .object({
      total: N,
      liste: z
        .array(
          z.object({
            genre: z.enum(GENRES_DE_PROJET),
            langages: z.array(z.string().max(20)).max(20),
            services: z.array(z.string().max(30)).max(20),
          }),
        )
        .max(500),
    })
    .partial()
    .default({}),
  /** Les services branchés à l'échelle de l'installation (courriels, espace client…). */
  services: z.array(z.string().max(40)).max(40).default([]),
  nbPersonnes: N.default(0),
  personnes: z.array(PersonneDuRapport).max(500).default([]),
  paysUtilisateurs: Compteurs.default({}),
  langues: Compteurs.default({}),
  fonctionnalites: Compteurs.default({}),
  gestes: Compteurs.default({}),
  ecrans: Compteurs.default({}),
  /** Secondes passées par zone de l'écran. */
  zones: Compteurs.default({}),
  sessions: z.object({ n: N, dureeS: N, personnes: N }).partial().default({}),
  rapidite: z
    .object({
      ecrans: z.record(Cle, CentileSchema),
      api: z.record(Cle, CentileSchema),
      demarrageAgent: CentileSchema,
      publication: CentileSchema,
      coupures: N,
      reconnexions: N,
    })
    .partial()
    .default({}),
  parcours: z
    .object({
      installeeLe: N,
      assistant: z.enum(['a-faire', 'termine']),
      etapes: z.record(z.string().max(40), z.enum(['faite', 'passee'])),
      etapeArret: z.string().max(40),
      premiereCarteLe: N,
      premierePublicationLe: N,
      jamaisOuvertes: z.array(z.string().max(40)).max(60),
    })
    .partial()
    .default({}),
  journal: z.array(EvenementDuRapport).max(JOURNAL_MAX_PAR_JOUR).default([]),
  erreurs: z.array(PanneDuRapport).max(PANNES_MAX_PAR_JOUR).default([]),
  satisfaction: z.array(AvisDuRapport).max(500).default([]),
});
export type RapportDUsage = z.infer<typeof RapportDUsage>;

/**
 * LA DERNIÈRE PASSE, DES DEUX CÔTÉS : avant l'envoi sur l'installation, puis à
 * la réception chez l'auteur (défense en profondeur). Les seuls textes libres
 * du rapport — pannes et mots de satisfaction — sont renettoyés ; le reste n'est
 * fait que de nombres, de codes et de noms de fonctionnalités.
 */
export function nettoyerLeRapport<T extends Pick<RapportDUsage, 'erreurs' | 'satisfaction'>>(rapport: T): T {
  return {
    ...rapport,
    erreurs: rapport.erreurs.map((e) => ({
      ...e,
      message: nettoyerTexteLibre(masquerLesCitations(e.message), 500),
      pile: nettoyerPile(e.pile),
      lieu: e.lieu ? nettoyerTexteLibre(e.lieu, 120) : undefined,
    })),
    satisfaction: rapport.satisfaction.map((a) => ({ ...a, mot: a.mot ? nettoyerTexteLibre(a.mot) || undefined : undefined })),
  };
}
