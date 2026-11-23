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

/* ------------------------------------------------------------------------------------------------------------------
 * L'ACCÈS DES ROBOTS, RÉGLÉ SITE PAR SITE (carte « Sécurité, rapports et marketing restructurés », 22/11/2026,
 * maquette #9542) : un interrupteur « Protection active » et quatre familles de sources. Une famille cochée LIT le
 * site ; décochée, ses robots d'IA sont renvoyés vers /pour-les-ia, et les MOTEURS décochés ferment le site à
 * l'indexation (X-Robots-Tag noindex + robots.txt « Disallow: / »). Protection coupée = tout passe.
 * Sans réglage enregistré, un site garde EXACTEMENT sa protection d'avant (`reglageRobotsParDefaut`).
 * ---------------------------------------------------------------------------------------------------------------- */

export type FamilleDeRobots = 'moteurs' | 'recherche' | 'agents' | 'entrainement';
export const FAMILLES_DE_ROBOTS: readonly FamilleDeRobots[] = ['moteurs', 'recherche', 'agents', 'entrainement'];

export interface ReglageRobots {
  /** Coupée : aucun renvoi, aucune fermeture — le réglage des familles est gardé pour le jour où on la rallume. */
  protection: boolean;
  /** Vrai = la famille LIT le site. */
  moteurs: boolean;
  recherche: boolean;
  agents: boolean;
  entrainement: boolean;
}

/** La famille d'un rôle de robot d'IA. */
export function familleDuRole(role: RoleDeRobotIA): FamilleDeRobots {
  return role === 'agent' ? 'agents' : role;
}

/** La protection d'avant le réglage : adresse de travail fermée à tous ; adresse publique ouverte sauf entraînement. */
export function reglageRobotsParDefaut(hote: string, zone: string = zoneDesProjets()): ReglageRobots {
  return estAdresseDeTravail(hote, zone)
    ? { protection: true, moteurs: false, recherche: false, agents: false, entrainement: false }
    : { protection: true, moteurs: true, recherche: true, agents: true, entrainement: false };
}

/** Un réglage lu en base (ou envoyé par l'écran), borné ; illisible → la valeur par défaut de l'hôte. */
export function reglageRobotsLu(brut: unknown, hote: string, zone: string = zoneDesProjets()): ReglageRobots {
  const defaut = reglageRobotsParDefaut(hote, zone);
  if (!brut || typeof brut !== 'object') return defaut;
  const o = brut as Record<string, unknown>;
  const lire = (cle: keyof ReglageRobots) => (typeof o[cle] === 'boolean' ? (o[cle] as boolean) : defaut[cle]);
  return { protection: lire('protection'), moteurs: lire('moteurs'), recherche: lire('recherche'), agents: lire('agents'), entrainement: lire('entrainement') };
}

export function memeReglageRobots(a: ReglageRobots, b: ReglageRobots): boolean {
  return a.protection === b.protection && FAMILLES_DE_ROBOTS.every((f) => a[f] === b[f]);
}

/** Les rôles de robots d'IA RENVOYÉS vers /pour-les-ia par ce réglage (aucun si la protection est coupée). */
export function rolesRenvoyes(r: ReglageRobots): RoleDeRobotIA[] {
  if (!r.protection) return [];
  return (['entrainement', 'recherche', 'agent'] as RoleDeRobotIA[]).filter((role) => !r[familleDuRole(role)]);
}

/** Le site est-il fermé à l'indexation (moteurs décochés, protection active) ? */
export function fermeAuxMoteurs(r: ReglageRobots): boolean {
  return r.protection && !r.moteurs;
}

/** Combien de familles lisent le site : « 3 sources sur 4 autorisées » (protection coupée : les quatre). */
export function famillesAutorisees(r: ReglageRobots): number {
  return r.protection ? FAMILLES_DE_ROBOTS.filter((f) => r[f]).length : FAMILLES_DE_ROBOTS.length;
}

/** Un site au réglage PARTICULIER (différent de sa valeur par défaut), pour la génération des serveurs. */
export interface ReglageParticulier {
  hotes: string[];
  reglage: ReglageRobots;
}

/** Un nom d'hôte sûr à écrire dans une configuration (lettres, chiffres, points, tirets) ; sinon null. */
export function hoteSur(hote: string): string | null {
  const h = hote.toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  return /^[a-z0-9](?:[a-z0-9-]{0,62}\.)+[a-z0-9-]{1,63}$/.test(h) ? h : null;
}

function particuliersSurs(particuliers: readonly ReglageParticulier[]): ReglageParticulier[] {
  return particuliers
    .map((p) => ({ hotes: [...new Set(p.hotes.map(hoteSur).filter((h): h is string => !!h))].sort(), reglage: p.reglage }))
    .filter((p) => p.hotes.length > 0);
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
export function blocCaddyGardeRobots(zone: string = zoneDesProjets(), particuliers: readonly ReglageParticulier[] = []): string {
  /* Sans zone réglée : une adresse qui ne correspond à rien, le bloc reste valide. */
  const hotes = zone ? `${zone} *.${zone}` : 'zone-non-reglee.invalid';
  const libres = CHEMINS_LIBRES_POUR_IA.join(' ');
  const sites = particuliersSurs(particuliers);
  /* Les sites au réglage particulier sortent de la règle commune : chacun reçoit la sienne, plus bas. */
  const horsParticuliers = sites.length ? [`\t\tnot host ${sites.flatMap((p) => p.hotes).join(' ')}`] : [];
  const lignes = [
    '# Garde des robots (Beluga, cartes « Anti-robots et référencement des projets » et « Audit et suivi du GEO », 18/11/2026).',
    '# GÉNÉRÉ par `node scripts/garde-robots.mjs caddy` depuis shared/src/robots-ia.ts : ne pas modifier à la main.',
    "# Règle par rôle : les robots d'entraînement sont renvoyés partout ; recherche et agents seulement sur les adresses de travail.",
    ...(sites.length ? ["# Réglages par site (service Sécurité, « Accès des robots ») : écrits par le démon, jamais à la main."] : []),
    '(garde-robots) {',
    '\t@robot-ia-entrainement {',
    `\t\theader_regexp robot_entrainement User-Agent ${motifRobotsIAPourServeur(ROBOTS_IA_ENTRAINEMENT)}`,
    `\t\tnot path ${libres}`,
    ...horsParticuliers,
    '\t}',
    `\tredir @robot-ia-entrainement ${PAGE_POUR_LES_IA} 307`,
    '\t@robot-ia-travail {',
    `\t\thost ${hotes}`,
    `\t\theader_regexp robot_ia User-Agent ${motifRobotsIAPourServeur()}`,
    `\t\tnot path ${libres}`,
    ...horsParticuliers,
    '\t}',
    `\tredir @robot-ia-travail ${PAGE_POUR_LES_IA} 307`,
    '',
  ];
  if (sites.length) {
    lignes.push(`\t@adresse-de-travail {`, `\t\thost ${hotes}`, ...horsParticuliers, '\t}');
  } else {
    lignes.push(`\t@adresse-de-travail host ${hotes}`);
  }
  lignes.push(
    '\theader @adresse-de-travail >X-Robots-Tag "noindex, nofollow"',
    '\t@robots-travail {',
    `\t\thost ${hotes}`,
    '\t\tpath /robots.txt',
    ...horsParticuliers,
    '\t}',
    '\thandle @robots-travail {',
    '\t\theader Content-Type "text/plain; charset=utf-8"',
    '\t\trespond <<ROBOTS',
    ...ROBOTS_TXT_FERME.trimEnd().split('\n').map((l) => `\t\t\t${l}`),
    '\t\t\tROBOTS 200',
    '\t}',
  );
  sites.forEach((p, i) => {
    const n = i + 1;
    const roles = rolesRenvoyes(p.reglage);
    const robots = ROBOTS_IA.filter((r) => roles.includes(r.role));
    lignes.push('', `\t# Site ${n} : ${p.hotes.join(', ')} — ${p.reglage.protection ? `lisent : ${FAMILLES_DE_ROBOTS.filter((f) => p.reglage[f]).join(', ') || 'aucune famille'}` : 'protection coupée'}.`);
    if (robots.length) {
      lignes.push(
        `\t@robot-ia-site-${n} {`,
        `\t\thost ${p.hotes.join(' ')}`,
        `\t\theader_regexp robot_site_${n} User-Agent ${motifRobotsIAPourServeur(robots)}`,
        `\t\tnot path ${libres}`,
        '\t}',
        `\tredir @robot-ia-site-${n} ${PAGE_POUR_LES_IA} 307`,
      );
    }
    if (fermeAuxMoteurs(p.reglage)) {
      lignes.push(
        `\t@ferme-site-${n} host ${p.hotes.join(' ')}`,
        `\theader @ferme-site-${n} >X-Robots-Tag "noindex, nofollow"`,
        `\t@robots-site-${n} {`,
        `\t\thost ${p.hotes.join(' ')}`,
        '\t\tpath /robots.txt',
        '\t}',
        `\thandle @robots-site-${n} {`,
        '\t\theader Content-Type "text/plain; charset=utf-8"',
        '\t\trespond <<ROBOTS',
        ...ROBOTS_TXT_FERME.trimEnd().split('\n').map((l) => `\t\t\t${l}`),
        '\t\t\tROBOTS 200',
        '\t}',
      );
    }
  });
  lignes.push('}', '');
  return lignes.join('\n');
}

/**
 * Le fichier dynamique Traefik (provider fichier) du serveur Clients : un routeur prioritaire par point d'entrée
 * HTTPS, qui reconnaît un robot d'ENTRAÎNEMENT d'IA hors des chemins libres et le renvoie vers /pour-les-ia du même
 * site. Les robots de recherche et les agents lisent tout (règle par rôle, 18/11/2026). Les sites publics NE reçoivent
 * PAS de noindex : seul ce renvoi s'y applique.
 */
export function fichierTraefikGardeRobots(pointDEntree = 'websecure', resolveur?: string, particuliers: readonly ReglageParticulier[] = []): string {
  const exclusions = CHEMINS_LIBRES_POUR_IA.map((c) =>
    c.endsWith('/*') ? `!PathPrefix(\`${c.slice(0, -1)}\`)` : `!Path(\`${c}\`)`,
  ).join(' && ');
  const motifDe = (robots: readonly RobotIA[]) => motifRobotsIAPourServeur(robots).replace(/\\/g, '\\\\');
  const motif = motifDe(ROBOTS_IA_ENTRAINEMENT);
  /* LES SITES AU RÉGLAGE PARTICULIER (22/11/2026) sortent de la règle commune et reçoivent un routeur à eux, plus
     prioritaire. Traefik ne sert pas robots.txt : les moteurs s'y règlent dans le robots.txt du site lui-même. */
  const sites = particuliersSurs(particuliers);
  const horsSites = sites.length ? ` && ${sites.flatMap((p) => p.hotes).map((h) => `!Host(\`${h}\`)`).join(' && ')}` : '';
  const lignes = [
    '# Garde des robots — serveur Clients (Beluga, cartes « Anti-robots et référencement » et « Audit et suivi du GEO », 18/11/2026).',
    "# Seuls les robots d'entraînement sont renvoyés : la recherche et les agents des IA lisent tout le site public.",
    '# GÉNÉRÉ par `node scripts/garde-robots.mjs traefik` depuis shared/src/robots-ia.ts : ne pas modifier à la main.',
    'http:',
    '  routers:',
    '    garde-robots-ia:',
    `      rule: "HeaderRegexp(\`User-Agent\`, \`${motif}\`) && ${exclusions}${horsSites}"`,
    '      priority: 100000',
    `      entryPoints: ["${pointDEntree}"]`,
    '      middlewares: ["renvoi-pour-les-ia"]',
    '      service: "noop@internal"',
  ];
  const tls = () => (resolveur ? lignes.push('      tls:', `        certResolver: "${resolveur}"`) : lignes.push('      tls: {}'));
  tls();
  sites.forEach((p, i) => {
    const roles = rolesRenvoyes(p.reglage);
    const robots = ROBOTS_IA.filter((r) => roles.includes(r.role));
    if (!robots.length) return;
    const hotes = p.hotes.map((h) => `Host(\`${h}\`)`).join(' || ');
    lignes.push(
      `    garde-robots-site-${i + 1}:`,
      `      rule: "(${hotes}) && HeaderRegexp(\`User-Agent\`, \`${motifDe(robots)}\`) && ${exclusions}"`,
      '      priority: 100001',
      `      entryPoints: ["${pointDEntree}"]`,
      '      middlewares: ["renvoi-pour-les-ia"]',
      '      service: "noop@internal"',
    );
    tls();
  });
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
