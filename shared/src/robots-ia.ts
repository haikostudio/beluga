/*
 * LA LISTE UNIQUE DES ROBOTS D'IA (carte « Anti-robots et référencement des projets », 18/11/2026).
 *
 * RÈGLE PAR RÔLE (décision de l'utilisateur, carte « Audit et suivi du GEO », 18/11/2026 — elle remplace « tous les
 * robots d'IA renvoyés vers /pour-les-ia » posée le matin même) :
 *   - les robots d'ENTRAÎNEMENT (GPTBot, ClaudeBot, CCBot…) sont renvoyés vers la page publique « /pour-les-ia » de
 *     chaque site et ne lisent rien d'autre ;
 *   - les robots de RECHERCHE (OAI-SearchBot, PerplexityBot, Claude-SearchBot…) et les AGENTS qui lisent pour un
 *     humain (ChatGPT-User, Claude-User, Perplexity-User…) lisent TOUT le site public : sans eux, ChatGPT ou Perplexity
 *     ne peuvent citer aucune page de service, de prix ou d'article ;
 *   - Googlebot et Bingbot gardent l'accès complet (sinon plus de référencement) ;
 *   - les adresses de travail (« *.<zone des projets> » réglée dans l'installation) restent fermées à TOUS les robots, Google et IA de recherche compris.
 *
 * Cette liste est la SEULE : le bloc Caddy du serveur Beluga, la règle Traefik du serveur Clients, le contrôle du
 * service Sécurité et l'audit SEO + GEO du Marketing la lisent d'ici. Un robot ajouté ici l'est partout au prochain
 * `node scripts/garde-robots.mjs`.
 *
 * Limite assumée, dite dans le rapport : un robot qui se déguise en navigateur ne se reconnaît pas à son nom ; seul le
 * garde par comportement (rafales, pages pièges) l'attrape.
 *
 * Règles PURES : ni base, ni disque, ni horloge.
 */

import { zoneDesProjets } from './installation.js';

export type RoleDeRobotIA = 'entrainement' | 'recherche' | 'agent';

export interface RobotIA {
  /** Le jeton tel qu'il paraît dans l'entête User-Agent (ou dans robots.txt pour les jetons sans visite propre). */
  nom: string;
  editeur: string;
  role: RoleDeRobotIA;
}

export const ROBOTS_IA: readonly RobotIA[] = [
  { nom: 'GPTBot', editeur: 'OpenAI', role: 'entrainement' },
  { nom: 'OAI-SearchBot', editeur: 'OpenAI', role: 'recherche' },
  { nom: 'ChatGPT-User', editeur: 'OpenAI', role: 'agent' },
  { nom: 'ClaudeBot', editeur: 'Anthropic', role: 'entrainement' },
  { nom: 'Claude-SearchBot', editeur: 'Anthropic', role: 'recherche' },
  { nom: 'Claude-User', editeur: 'Anthropic', role: 'agent' },
  { nom: 'anthropic-ai', editeur: 'Anthropic', role: 'entrainement' },
  { nom: 'PerplexityBot', editeur: 'Perplexity', role: 'recherche' },
  { nom: 'Perplexity-User', editeur: 'Perplexity', role: 'agent' },
  { nom: 'Google-Extended', editeur: 'Google', role: 'entrainement' },
  { nom: 'Applebot-Extended', editeur: 'Apple', role: 'entrainement' },
  { nom: 'meta-externalagent', editeur: 'Meta', role: 'entrainement' },
  { nom: 'meta-externalfetcher', editeur: 'Meta', role: 'agent' },
  { nom: 'FacebookBot', editeur: 'Meta', role: 'entrainement' },
  { nom: 'CCBot', editeur: 'Common Crawl', role: 'entrainement' },
  { nom: 'Bytespider', editeur: 'ByteDance', role: 'entrainement' },
  { nom: 'Amazonbot', editeur: 'Amazon', role: 'recherche' },
  { nom: 'cohere-ai', editeur: 'Cohere', role: 'entrainement' },
  { nom: 'cohere-training-data-crawler', editeur: 'Cohere', role: 'entrainement' },
  { nom: 'MistralAI-User', editeur: 'Mistral', role: 'agent' },
  { nom: 'DuckAssistBot', editeur: 'DuckDuckGo', role: 'recherche' },
  { nom: 'YouBot', editeur: 'You.com', role: 'recherche' },
  { nom: 'Diffbot', editeur: 'Diffbot', role: 'entrainement' },
  { nom: 'AI2Bot', editeur: 'Allen Institute', role: 'entrainement' },
  { nom: 'omgili', editeur: 'Webz.io', role: 'entrainement' },
  { nom: 'Timpibot', editeur: 'Timpi', role: 'entrainement' },
  { nom: 'ImagesiftBot', editeur: 'ImageSift', role: 'entrainement' },
  { nom: 'PanguBot', editeur: 'Huawei', role: 'entrainement' },
  { nom: 'Kangaroo Bot', editeur: 'Kangaroo LLM', role: 'entrainement' },
];

/**
 * Les chemins qu'un robot d'IA garde le droit de lire : la page qui lui est destinée (et ses ressources), le fichier
 * des consignes, et le fichier de présentation pour les modèles (sans avantage démontré, mais servi s'il existe).
 */
export const CHEMINS_LIBRES_POUR_IA: readonly string[] = ['/pour-les-ia', '/pour-les-ia/*', '/robots.txt', '/llms.txt', '/favicon.ico'];

export const PAGE_POUR_LES_IA = '/pour-les-ia';

function echapperPourRegex(texte: string): string {
  return texte.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&').replace(/ /g, '\\s');
}

/** Le corps de l'alternance « GPTBot|OAI\-SearchBot|… », valable à la fois en JavaScript et en RE2 (Go : Caddy, Traefik). */
export function alternanceRobotsIA(robots: readonly RobotIA[] = ROBOTS_IA): string {
  return robots.map((r) => echapperPourRegex(r.nom)).join('|');
}

/** L'expression des serveurs (Go/RE2), insensible à la casse : « (?i)(GPTBot|…) ». */
export function motifRobotsIAPourServeur(robots: readonly RobotIA[] = ROBOTS_IA): string {
  return `(?i)(${alternanceRobotsIA(robots)})`;
}

/** Les robots que la règle limite à « /pour-les-ia » sur une adresse PUBLIQUE : ceux qui servent à entraîner. */
export const ROBOTS_IA_ENTRAINEMENT: readonly RobotIA[] = ROBOTS_IA.filter((r) => r.role === 'entrainement');
/** Les robots qui lisent tout le site public : recherche et agents qui lisent pour un humain. */
export const ROBOTS_IA_LECTEURS: readonly RobotIA[] = ROBOTS_IA.filter((r) => r.role !== 'entrainement');

/** Le robot d'IA reconnu dans un User-Agent (le premier de la liste qui y paraît), ou null. */
export function robotIADuUserAgent(ua: string): RobotIA | null {
  if (!ua) return null;
  const re = new RegExp(alternanceRobotsIA(), 'i');
  const m = re.exec(ua);
  if (!m) return null;
  const vu = m[0].toLowerCase().replace(/\s+/g, ' ');
  return ROBOTS_IA.find((r) => r.nom.toLowerCase() === vu) ?? null;
}

/**
 * LA RÈGLE, en une fonction : ce robot (User-Agent) doit-il être renvoyé vers /pour-les-ia sur cet hôte, pour ce chemin ?
 * Adresse de travail → tout robot d'IA ; adresse publique → les seuls robots d'entraînement. Les chemins libres jamais.
 */
export function robotIADoitEtreRenvoye(userAgent: string, hote: string, chemin: string): boolean {
  const robot = robotIADuUserAgent(userAgent);
  if (!robot) return false;
  if (cheminLibrePourIA(chemin)) return false;
  return estAdresseDeTravail(hote) || robot.role === 'entrainement';
}

export function cheminLibrePourIA(chemin: string): boolean {
  const c = chemin.split('?')[0] || '/';
  return CHEMINS_LIBRES_POUR_IA.some((libre) => (libre.endsWith('/*') ? c.startsWith(libre.slice(0, -1)) : c === libre));
}

/** Une adresse de travail : fermée à tous les robots. */
export function estAdresseDeTravail(hote: string, zone: string = zoneDesProjets()): boolean {
  const z = zone.toLowerCase();
  if (!z) return false;
  const h = hote.toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  return h === z || h.endsWith(`.${z}`);
}

/** User-Agent d'essai, pour les contrôles (Sécurité, Marketing) : jamais une vraie identité de robot qu'on usurpe ailleurs. */
export const UA_ESSAI_ROBOT_IA = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot';
/** Un robot de RECHERCHE d'IA (celui qui fait citer une page par ChatGPT) : il doit lire tout le site public. */
export const UA_ESSAI_ROBOT_RECHERCHE_IA = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot';
export const UA_ESSAI_GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

/* ------------------------------------------------------------------------------------------------------------------
 * Les configurations des deux serveurs, GÉNÉRÉES depuis la liste (jamais écrites à la main) :
 *   node scripts/garde-robots.mjs caddy   → le bloc « (garde-robots) » du Caddyfile du serveur Beluga
 *   node scripts/garde-robots.mjs traefik → le fichier dynamique Traefik du serveur Clients
 * ---------------------------------------------------------------------------------------------------------------- */

export const ROBOTS_TXT_FERME = 'User-agent: *\nDisallow: /\n';

/**
 * Le bloc Caddy importé par chaque site du serveur Beluga (`import garde-robots`).
 * 1. Robot d'ENTRAÎNEMENT hors des chemins libres → 307 vers /pour-les-ia, sur toute adresse.
 * 2. Adresse de travail (*.<zone des projets>) : TOUT robot d'IA (recherche et agents compris) hors des chemins libres → 307, plus
 *    « X-Robots-Tag: noindex, nofollow » sur tout et robots.txt « Disallow: / ».
 * Les robots de recherche et les agents lisent donc tout le site sur une adresse publique (règle par rôle, 18/11/2026).
 * La page elle-même est exclue : aucune boucle possible, un site sans la page répond son propre 404 au robot.
 * `handle /robots.txt` (chemin seul) passe AVANT les `handle` à matcher nommé ou sans matcher des sites : Caddy trie
 * les blocs d'une même directive par spécificité du chemin.
 */
export function blocCaddyGardeRobots(zone: string = zoneDesProjets()): string {
  /* Sans zone réglée : une adresse qui ne correspond à rien, le bloc reste valide. */
  const hotes = zone ? `${zone} *.${zone}` : 'zone-non-reglee.invalid';
  const libres = CHEMINS_LIBRES_POUR_IA.join(' ');
  return [
    '# Garde des robots (Beluga, cartes « Anti-robots et référencement des projets » et « Audit et suivi du GEO », 18/11/2026).',
    '# GÉNÉRÉ par `node scripts/garde-robots.mjs caddy` depuis shared/src/robots-ia.ts : ne pas modifier à la main.',
    "# Règle par rôle : les robots d'entraînement sont renvoyés partout ; recherche et agents seulement sur les adresses de travail.",
    '(garde-robots) {',
    '\t@robot-ia-entrainement {',
    `\t\theader_regexp robot_entrainement User-Agent ${motifRobotsIAPourServeur(ROBOTS_IA_ENTRAINEMENT)}`,
    `\t\tnot path ${libres}`,
    '\t}',
    `\tredir @robot-ia-entrainement ${PAGE_POUR_LES_IA} 307`,
    '\t@robot-ia-travail {',
    `\t\thost ${hotes}`,
    `\t\theader_regexp robot_ia User-Agent ${motifRobotsIAPourServeur()}`,
    `\t\tnot path ${libres}`,
    '\t}',
    `\tredir @robot-ia-travail ${PAGE_POUR_LES_IA} 307`,
    '',
    `\t@adresse-de-travail host ${hotes}`,
    '\theader @adresse-de-travail >X-Robots-Tag "noindex, nofollow"',
    '\t@robots-travail {',
    `\t\thost ${hotes}`,
    '\t\tpath /robots.txt',
    '\t}',
    '\thandle @robots-travail {',
    '\t\theader Content-Type "text/plain; charset=utf-8"',
    '\t\trespond <<ROBOTS',
    ...ROBOTS_TXT_FERME.trimEnd().split('\n').map((l) => `\t\t\t${l}`),
    '\t\t\tROBOTS 200',
    '\t}',
    '}',
    '',
  ].join('\n');
}

/**
 * Le fichier dynamique Traefik (provider fichier) du serveur Clients : un routeur prioritaire par point d'entrée
 * HTTPS, qui reconnaît un robot d'ENTRAÎNEMENT d'IA hors des chemins libres et le renvoie vers /pour-les-ia du même
 * site. Les robots de recherche et les agents lisent tout (règle par rôle, 18/11/2026). Les sites publics NE reçoivent
 * PAS de noindex : seul ce renvoi s'y applique.
 */
export function fichierTraefikGardeRobots(pointDEntree = 'websecure', resolveur?: string): string {
  const exclusions = CHEMINS_LIBRES_POUR_IA.map((c) =>
    c.endsWith('/*') ? `!PathPrefix(\`${c.slice(0, -1)}\`)` : `!Path(\`${c}\`)`,
  ).join(' && ');
  const motif = motifRobotsIAPourServeur(ROBOTS_IA_ENTRAINEMENT).replace(/\\/g, '\\\\');
  const lignes = [
    '# Garde des robots — serveur Clients (Beluga, cartes « Anti-robots et référencement » et « Audit et suivi du GEO », 18/11/2026).',
    "# Seuls les robots d'entraînement sont renvoyés : la recherche et les agents des IA lisent tout le site public.",
    '# GÉNÉRÉ par `node scripts/garde-robots.mjs traefik` depuis shared/src/robots-ia.ts : ne pas modifier à la main.',
    'http:',
    '  routers:',
    '    garde-robots-ia:',
    `      rule: "HeaderRegexp(\`User-Agent\`, \`${motif}\`) && ${exclusions}"`,
    '      priority: 100000',
    `      entryPoints: ["${pointDEntree}"]`,
    '      middlewares: ["renvoi-pour-les-ia"]',
    '      service: "noop@internal"',
  ];
  if (resolveur) lignes.push('      tls:', `        certResolver: "${resolveur}"`);
  else lignes.push('      tls: {}');
  lignes.push(
    '  middlewares:',
    '    renvoi-pour-les-ia:',
    '      redirectRegex:',
    `        regex: "^(https?://[^/]+)/.*$"`,
    `        replacement: "\${1}${PAGE_POUR_LES_IA}"`,
    '        permanent: false',
    '',
  );
  return lignes.join('\n');
}
