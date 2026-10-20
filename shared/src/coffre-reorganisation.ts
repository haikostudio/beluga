import { SEPARATEUR_CHEMIN } from './coffre-fort.js';
import { minusculesSansAccents } from './mots.js';

/**
 * LA RÉORGANISATION DU COFFRE-FORT — le plan, sans rien écrire.
 *
 * Le coffre se range en UN ARBRE FIXE, le même pour tous (décision de
 * l'utilisateur, carte 79083bc5) :
 *
 *     <Projet> | Global  /  Production | Développement et essai | Commun  /  <Thème>
 *
 *  - la RACINE est le projet qui possède réellement la fiche, ou « Global » (sans
 *    projet) pour les accès communs du studio : comptes Google, GitHub,
 *    hébergeurs, IA, identité et banque ;
 *  - l'ENVIRONNEMENT se lit dans le nom (« production », « réel », « test »,
 *    « dev », « bac à sable », « essai »…) ; ni l'un ni l'autre, ou les deux :
 *    « Commun » ;
 *  - le THÈME vient d'une table fixe de mots (`THEMES`), le premier qui mord
 *    gagne ; sinon le type de la fiche ; sinon « Divers ».
 *
 * AUCUN NOM NE CHANGE : des lecteurs du coffre (relais, Gemini, studio,
 * installation, surveillances) retrouvent une fiche à son nom ou à un mot de son
 * nom. Aucun dossier vide n'est prévu : seuls les chemins qui reçoivent une
 * fiche existent.
 *
 * On n'ARCHIVE que l'explicite : une fiche dite révoquée ou remplacée, ou le
 * doublon exact d'une autre fiche du même projet. Le douteux est SIGNALÉ.
 *
 * La fonction est pure : le script (`scripts/reorganiser-coffre.mjs`) lui donne
 * l'état du coffre et applique ce qu'elle rend, après avoir mis l'état d'avant
 * de côté. Elle ne reçoit JAMAIS une valeur secrète — seulement l'empreinte
 * qui permet de reconnaître deux fiches identiques.
 */

export interface FicheAPlanifier {
  id: string;
  nom: string;
  type: string;
  projectId: string | null;
  projetNom: string | null;
  /** L'empreinte des valeurs secrètes (jamais les valeurs) ; `null` si la fiche n'en porte aucune. */
  empreinte: string | null;
  /** Combien de champs et d'images la fiche porte : à égalité de doublon, la plus riche reste. */
  richesse: number;
  modifieLe: number;
  /** Un lecteur du coffre la retrouve par son nom exact : jamais archivée. */
  figee: boolean;
}

export interface ProjetConnu {
  id: string;
  name: string;
}

export interface PlanDeFiche {
  id: string;
  nom: string;
  projetAvant: string | null;
  projetApres: string | null;
  /** Le CHEMIN du dossier (« Kipou/Production/Paiement »), ou `null` pour une fiche archivée. */
  dossier: string | null;
  /** La raison de l'archivage, ou `null`. */
  archiver: string | null;
  /** Un cas douteux qu'on ne touche pas, dit à l'utilisateur. */
  signaler: string | null;
}

export interface PlanDeDossier {
  /** Le chemin entier, niveaux séparés par « / ». */
  chemin: string;
  /** Le projet de la racine (tout le chemin le prend) ; `null` = Global. */
  projectId: string | null;
  fiches: number;
}

export interface PlanDeReorganisation {
  fiches: PlanDeFiche[];
  dossiers: PlanDeDossier[];
}

export const RACINE_GLOBALE = 'Global';
export const ENVIRONNEMENTS_DU_COFFRE = ['Production', 'Développement et essai', 'Commun'] as const;
export type EnvironnementDuCoffre = (typeof ENVIRONNEMENTS_DU_COFFRE)[number];

const norme = (texte: string) => minusculesSansAccents(texte ?? '').replace(/\s+/g, ' ').trim();

/* ------------------------------------------------------------------ */
/* QUI POSSÈDE LA FICHE                                                */
/* ------------------------------------------------------------------ */

/**
 * Des appellations du nom qui ne sont pas le nom d'un projet : « ProjetA » est le
 * produit, son projet est « ProjetA Saas » ; « HaikoBeluga » vit dans « HaikoDev ».
 * `projet` est le NOM du projet visé, cherché parmi les projets connus.
 */
const ALIAS_DE_PROPRIETAIRE: ReadonlyArray<{ cle: string; projet: string }> = [
  { cle: 'projeta', projet: 'ProjetA Saas' },
  { cle: 'projeta vps', projet: 'ProjetA Interface VPS' },
  { cle: 'haikobeluga', projet: 'HaikoDev' },
  { cle: 'beluga heberge', projet: 'Beluga Build' },
  { cle: 'facturation haiko', projet: 'HaikoBill' },
  { cle: 'projetc dashboard', projet: 'projetc' },
];

/** Un projet « d'ensemble » : ce qui y est rangé sans nommer de propriétaire est un accès commun. */
const PROJETS_PARTAGES = new Set(['beluga', 'vps', 'beluga build']);

/**
 * Les fournisseurs dont un COMPTE sert tout le studio. Une fiche dont le nom
 * commence par l'un d'eux, parle d'un compte ou du studio, et ne nomme aucun
 * projet, va dans Global — où qu'elle ait été rangée (« GitHub — compte
 * haikostudio » sous ProjetA Saas).
 */
const FOURNISSEURS_COMMUNS: readonly string[] = [
  'github',
  'google',
  'microsoft',
  'compte developpeur apple',
  'apple',
  'revenuecat',
  'infomaniak',
  'hetzner',
  'hostinger',
  'cloudflare',
  'geoapify',
  'wordfence',
  'openrouter',
  'xiaomi',
  'resend',
];

/** Ce qui est personnel (identité, banque) : Global, Commun, Personnel. */
const MOTS_PERSONNELS: readonly RegExp[] = [/\biban\b/, /carte bancaire/, /informations personnelles/, /(^|[^\w.])x\.com\b/];

/** Le studio lui-même n'est pas un projet qu'on nomme : « compte Haiko », « Haiko Studio ». */
const NOMS_DU_STUDIO = new Set(['haiko', 'haiko studio']);

interface Proprietaire {
  cle: string;
  projet: ProjetConnu | null;
}

function construireLesProprietaires(projets: readonly ProjetConnu[]): Map<string, Proprietaire> {
  const parNom = new Map(projets.map((p) => [norme(p.name), p]));
  const table = new Map<string, Proprietaire>();
  for (const p of projets) table.set(norme(p.name), { cle: norme(p.name), projet: p });
  for (const alias of ALIAS_DE_PROPRIETAIRE) table.set(alias.cle, { cle: alias.cle, projet: parNom.get(norme(alias.projet)) ?? null });
  return table;
}

/** Le propriétaire dont le premier segment du nom porte le nom (le plus long gagne). */
function trouverLeProprietaire(premier: string, table: Map<string, Proprietaire>): Proprietaire | null {
  const n = norme(premier);
  let meilleur: Proprietaire | null = null;
  for (const [cle, proprietaire] of table) {
    if (n === cle || n.startsWith(`${cle} `) || n.startsWith(`${cle}(`)) {
      if (!meilleur || cle.length > meilleur.cle.length) meilleur = proprietaire;
    }
  }
  return meilleur;
}

/** Le nom cite-t-il un projet (ou un alias), hors le studio lui-même ? */
function nommeUnProjet(nom: string, table: Map<string, Proprietaire>): boolean {
  const n = norme(nom);
  for (const cle of table.keys()) {
    if (cle.length < 3 || NOMS_DU_STUDIO.has(cle)) continue;
    const echappee = cle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|[^a-z0-9])${echappee}([^a-z0-9]|$)`).test(n)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* L'ENVIRONNEMENT ET LE THÈME                                         */
/* ------------------------------------------------------------------ */

const MOTS_DE_PRODUCTION = /\b(production|prod|reel|reelle|reels|reelles|live)\b/;
const MOTS_DE_DEVELOPPEMENT = /\b(test|tests|dev|developpement|bac a sable|sandbox|essai|essais|staging|preprod|local|seedee|recette)\b/;

/** L'environnement dit par le nom ; les deux à la fois, ou aucun : « Commun ». */
export function environnementDuNom(nom: string): EnvironnementDuCoffre {
  const n = norme(nom);
  const prod = MOTS_DE_PRODUCTION.test(n);
  const dev = MOTS_DE_DEVELOPPEMENT.test(n);
  if (prod && !dev) return 'Production';
  if (dev && !prod) return 'Développement et essai';
  return 'Commun';
}

/**
 * LES THÈMES, dans l'ordre où ils sont essayés : le premier qui mord gagne.
 * L'ordre tranche les noms qui parlent de deux choses : une connexion « Google
 * OAuth » est une connexion avant d'être Google ; un SMTP chez Infomaniak est un
 * e-mail avant d'être un hébergement ; une zone DNS chez Hostinger est un
 * domaine.
 */
const THEMES: ReadonlyArray<{ theme: string; mots: RegExp; types?: readonly string[] }> = [
  { theme: 'Bases de données', mots: /\b(postgres|mysql|mariadb|pocketbase|supabase|redis|mongo|sqlite|base de donnees)\b/, types: ['base-de-donnees'] },
  { theme: 'Connexion par un compte tiers', mots: /\b(oauth|sign in with|identifiant client|secret client)\b/ },
  { theme: 'Notifications', mots: /\b(vapid|push|fcm|fcm_service_account|apns|notifications?|onesignal|centrifugo|rtdn|sms|twilio)\b/ },
  { theme: 'Code et dépôts', mots: /\b(github|ghcr|ghcr_pat|gitlab|github_mobile_token|vercel|netlify)\b/ },
  { theme: 'Mobile', mots: /\b(apple|app store|appstore|testflight|android|google play|play console|firebase|jks|keystore|p12|ios|iphone|capacitor|mobile)\b/ },
  {
    theme: 'Paiement',
    mots: /\b(stripe|paiement|paiements|revenuecat|paypal|verotel|flowguard|twint|sumup|achat|achats)\b/,
    types: ['compte-bancaire', 'carte-paiement'],
  },
  { theme: 'E-mail', mots: /\b(resend|brevo|sendinblue|smtp|imap|mailgun|sendgrid|postmark|courriel|e-mail|e-mails|boite de contact|xsmtpsib)\b/ },
  {
    theme: 'Intelligence artificielle',
    mots: /\b(openrouter|gemini|xiaomi|mimo|groq|llm|llm_api_key|openai|anthropic|claude|mistral|deepseek|elevenlabs|assemblyai|replicate|perplexity|relais ia|ia)\b/,
  },
  {
    theme: 'Secrets de l’application',
    mots: /\b(jwt|jwt_secret|secret jwt|session|sessions|chiffrement|encryption|encryption_key_hex|crypt_key|salt|auth_key|auth_salt|secure_auth_key|secure_auth_salt|logged_in_key|logged_in_salt|nonce_key|nonce_salt|sel|hmac|cron|cron_secret|taches planifiees|secret_key|secret_master_key|admin_key|rsssl_key|turnstile|captcha|recaptcha)\b/,
  },
  { theme: 'Domaines et DNS', mots: /\b(dns|epp|cloudflare|registrar|zone)\b/ },
  {
    theme: 'Hébergement et serveurs',
    mots: /\b(ssh|sftp|ftp|hetzner|hostinger|infomaniak|vps|storage box|serveur|serveurs|infrastructure|ovh|scaleway|docker|deploiement|sauvegarde)\b/,
    types: ['ssh'],
  },
  { theme: 'Domaines et DNS', mots: /\b(domaine|domaines|nom de domaine)\b/ },
  {
    theme: 'Comptes et accès',
    mots: /\b(compte|comptes|connexion|administrateur|administration|admin|superuser|identifiant|mot de passe|code pin|2fa|double authentification|codes de secours)\b/,
    types: ['mot-de-passe'],
  },
];

export const THEME_PERSONNEL = 'Personnel';
const TYPES_PERSONNELS: readonly string[] = ['carte-identite', 'passeport', 'permis-conduire'];
export const THEME_DIVERS = 'Divers';

/** Le thème d'une fiche, d'après son nom puis son type. */
export function themeDeLaFiche(nom: string, type: string): string {
  // « PAS le DNS » dit ce que la fiche n'est pas : ces mots ne votent pas.
  const n = norme(nom)
    .replace(/[’']/g, ' ')
    .replace(/\bpas (le |la |les |de |d )?[\w.-]+/g, ' ');
  if (MOTS_PERSONNELS.some((m) => m.test(norme(nom)))) return THEME_PERSONNEL;
  // Une pièce d'identité est personnelle, quoi que dise son nom.
  if (TYPES_PERSONNELS.includes(type)) return THEME_PERSONNEL;
  for (const t of THEMES) if (t.mots.test(n)) return t.theme;
  for (const t of THEMES) if (t.types?.includes(type)) return t.theme;
  return THEME_DIVERS;
}

/** Un nom de projet devient un nom de dossier : jamais de « / », qui sépare les niveaux. */
function nomDeRacine(nom: string): string {
  return nom.split(SEPARATEUR_CHEMIN).join('-').trim() || RACINE_GLOBALE;
}

/* ------------------------------------------------------------------ */
/* LE PLAN                                                             */
/* ------------------------------------------------------------------ */

/** Les mots d'un nom, sans ponctuation : deux noms qui ne diffèrent que par les séparateurs ont les mêmes. */
function mots(nom: string): string {
  return norme(nom).replace(/[—–\-:,;()«»"'’]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Le VRAI propriétaire d'une fiche : un projet connu, ou `null` pour Global.
 * Rend aussi la raison d'un signalement quand la fiche ne peut pas suivre son
 * propriétaire (une base de données reste à son projet).
 */
function proprietaireDe(f: FicheAPlanifier, table: Map<string, Proprietaire>, projets: Map<string, ProjetConnu>): { projet: ProjetConnu | null; signaler: string | null } {
  const actuel = f.projectId ? (projets.get(f.projectId) ?? null) : null;
  const actuelPartage = !actuel || PROJETS_PARTAGES.has(norme(actuel.name));
  const n = norme(f.nom);

  let projet: ProjetConnu | null;
  if (MOTS_PERSONNELS.some((m) => m.test(n))) projet = null;
  else {
    const premier = f.nom.split(/\s+[—–-]{1,2}\s+/)[0] ?? f.nom;
    // « ProjetA SaaS + VPS » parle de deux projets à la fois : il n'appartient à aucun des deux.
    const trouve = premier.includes(' + ') ? null : trouverLeProprietaire(premier, table);
    if (trouve?.projet && actuel && norme(actuel.name) === norme(trouve.projet.name)) {
      // Deux projets au même nom (« ProjetC » et « projetc ») : la fiche reste à celui qui l'a rangée.
      projet = actuel;
    } else if (trouve?.projet) {
      // Entre deux projets d'ensemble (« Beluga Build — … » rangé sous Beluga), la fiche ne saute pas de l'un à l'autre.
      const versPartage = PROJETS_PARTAGES.has(norme(trouve.projet.name)) && trouve.cle !== 'beluga heberge';
      projet = versPartage && actuel && actuelPartage ? actuel : trouve.projet;
    } else if (!actuelPartage) {
      // Le COMPTE d'un fournisseur commun, au nom du studio, sans nommer de projet, sert tout le studio.
      // Une clé de ce fournisseur (« Google OAuth — secret client ») reste au projet qui l'a rangée.
      const tete = norme(premier);
      const commun = FOURNISSEURS_COMMUNS.some((cle) => tete === cle || tete.startsWith(`${cle} `) || tete.startsWith(`${cle}(`));
      const duStudio = /\b(compte|haiko|haikostudio)\b/.test(n);
      projet = commun && duStudio && !nommeUnProjet(f.nom, table) ? null : actuel;
    } else projet = null;
  }

  // Une base de données porte la protection de production de SON projet : elle n'en change jamais.
  if (f.type === 'base-de-donnees' && (projet?.id ?? null) !== (f.projectId ?? null)) {
    return {
      projet: actuel,
      signaler: `Base de données dont le nom désigne ${projet ? `le projet « ${projet.name} »` : 'un accès commun'} : laissée à son projet, qui porte la protection des sites.`,
    };
  }
  return { projet, signaler: null };
}

/**
 * Décide du chemin, du projet et de l'archivage de chaque fiche.
 * `projets` : les projets connus (pour rattacher une fiche à son vrai projet).
 */
export function planifierReorganisation(fiches: readonly FicheAPlanifier[], projets: readonly ProjetConnu[]): PlanDeReorganisation {
  const table = construireLesProprietaires(projets);
  const parId = new Map(projets.map((p) => [p.id, p]));

  // Une racine par projet : deux projets dont les noms se confondent (« ProjetC », « projetc ») reçoivent deux racines distinctes.
  const racineDe = new Map<string, string>();
  const prises = new Set([norme(RACINE_GLOBALE)]);
  const racineDuProjet = (projet: ProjetConnu): string => {
    const connue = racineDe.get(projet.id);
    if (connue) return connue;
    const base = nomDeRacine(projet.name);
    let nom = base;
    for (let i = 2; prises.has(norme(nom)); i += 1) nom = `${base} (${i})`;
    prises.add(norme(nom));
    racineDe.set(projet.id, nom);
    return nom;
  };

  const plans: PlanDeFiche[] = fiches.map((f) => {
    const { projet, signaler } = proprietaireDe(f, table, parId);
    const theme = themeDeLaFiche(f.nom, f.type);
    const environnement: EnvironnementDuCoffre = theme === THEME_PERSONNEL ? 'Commun' : environnementDuNom(f.nom);
    const racine = projet ? racineDuProjet(projet) : RACINE_GLOBALE;
    return {
      id: f.id,
      nom: f.nom,
      projetAvant: f.projectId,
      projetApres: projet?.id ?? null,
      dossier: [racine, environnement, theme].join(SEPARATEUR_CHEMIN),
      archiver: null,
      signaler,
    };
  });

  // Les archives — seulement l'explicite.
  const planDe = new Map(plans.map((p) => [p.id, p]));
  for (const f of fiches) {
    const plan = planDe.get(f.id)!;
    if (f.figee) continue;
    if (/r[ée]voqu[ée]/i.test(f.nom)) plan.archiver = 'Fiche dite révoquée : la clé ne fonctionne plus.';
    else if (/\bremplac[ée]e?\b/i.test(f.nom)) plan.archiver = 'Fiche dite remplacée par une autre.';
  }
  // Un doublon exact : même type, mêmes valeurs secrètes, MÊME projet. Une même
  // clé partagée entre deux projets n'est pas un doublon : chaque projet la
  // retrouve sous son nom.
  const groupes = new Map<string, FicheAPlanifier[]>();
  for (const f of fiches) {
    if (!f.empreinte) continue;
    const plan = planDe.get(f.id)!;
    if (plan.archiver) continue;
    const cle = `${f.type}|${f.empreinte}|${plan.projetApres ?? ''}`;
    groupes.set(cle, [...(groupes.get(cle) ?? []), f]);
  }
  for (const groupe of groupes.values()) {
    if (groupe.length < 2) continue;
    const classes = [...groupe].sort((x, y) =>
      Number(x.figee) - Number(y.figee) === 0
        ? y.richesse - x.richesse || y.modifieLe - x.modifieLe || y.nom.length - x.nom.length
        : Number(y.figee) - Number(x.figee),
    );
    const gardee = classes[0]!;
    const motsGardee = new Set(mots(gardee.nom).split(' '));
    for (const f of classes.slice(1)) {
      if (f.figee) continue;
      const plan = planDe.get(f.id)!;
      // Le même secret sous deux noms qui ne se recouvrent pas sert peut-être deux usages
      // (deux variables d'environnement, deux applications) : on le signale, on ne l'archive pas.
      if (mots(f.nom).split(' ').every((m) => motsGardee.has(m))) {
        plan.archiver = `Doublon exact de « ${gardee.nom} » (même projet, mêmes valeurs, même nom à peu près).`;
      } else {
        plan.signaler = `Mêmes valeurs que « ${gardee.nom} » sous un nom différent : deux usages peut-être, à confirmer.`;
      }
    }
  }

  // Les cas douteux, dits sans y toucher.
  for (const plan of plans) {
    if (plan.archiver || plan.signaler) continue;
    if (/\b(ancien(ne)?|p[ée]rim[ée]e?|obsol[èe]te|historique|devenu faux|ne fonctionne plus)\b/i.test(plan.nom)) {
      plan.signaler = 'Le nom la dit ancienne ou périmée : à confirmer avant de l’archiver.';
    }
  }

  // Ce qui part aux archives n'est pas rangé : aucun dossier ne naît pour lui.
  for (const plan of plans) if (plan.archiver) plan.dossier = null;

  const compte = new Map<string, PlanDeDossier>();
  for (const plan of plans) {
    if (!plan.dossier) continue;
    const entree = compte.get(plan.dossier) ?? { chemin: plan.dossier, projectId: plan.projetApres, fiches: 0 };
    entree.fiches += 1;
    compte.set(plan.dossier, entree);
  }
  return {
    fiches: plans,
    dossiers: [...compte.values()].sort((x, y) => x.chemin.localeCompare(y.chemin)),
  };
}
