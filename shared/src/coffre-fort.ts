/**
 * LE COFFRE-FORT — un seul endroit pour tous les identifiants.
 *
 * Les accès d'un projet vivaient éparpillés : la clé d'un service dans une
 * note, le mot de passe d'une console dans une conversation, les accès SSH de
 * la machine dans l'onglet « Système ». Retrouver « le mot de passe de tel
 * site » demandait de se souvenir OÙ on l'avait rangé. Le coffre-fort les
 * réunit, chacun rattaché à un projet — ou à Beluga Build lui-même — et les rend
 * trouvables par leur nom, leur projet ou leur type.
 *
 * Ces règles sont PURES : elles disent quels TYPES d'accès existent, quels
 * CHAMPS chacun porte, ce qui tient debout et comment une recherche retrouve
 * une fiche. Le serveur (`server/src/coffre-fort.ts`) les range sur le disque ;
 * l'interface (`web/src/components/coffre-fort.tsx`) les affiche.
 *
 * CE QUI EST GARDÉ EN CLAIR L'EST À DESSEIN : le coffre sert à RELIRE un
 * identifiant, pas seulement à le vérifier. Une empreinte à sens unique, comme
 * celle des clés d'API (`cles-api.ts`), ne rendrait jamais le mot de passe
 * qu'on est venu chercher.
 */

/** Les types d'accès proposés à la création. L'ordre est celui du menu. */
export const TYPES_ACCES = [
  'cle-api',
  'mot-de-passe',
  'ssh',
  'jeton',
  'base-de-donnees',
  'autre',
] as const;
export type TypeAcces = (typeof TYPES_ACCES)[number];

/** Le nom affiché d'un type, en français — l'interface le traduit. */
export const LIBELLE_TYPE_ACCES: Readonly<Record<TypeAcces, string>> = {
  'cle-api': 'Clé d’API',
  'mot-de-passe': 'Mot de passe',
  ssh: 'Accès SSH',
  jeton: 'Jeton',
  'base-de-donnees': 'Base de données',
  autre: 'Autre',
};

/** Un champ d'une fiche : sa clé technique, son libellé, et s'il est secret. */
export interface ChampAcces {
  /** Clé technique — elle ne change JAMAIS, sinon les fiches déjà rangées se vident. */
  cle: string;
  /** Libellé français, traduit à l'affichage. */
  libelle: string;
  /** Un champ secret se masque par défaut et n'entre pas dans la recherche. */
  secret?: boolean;
  /** Un champ qui peut tenir sur plusieurs lignes (une clé privée, par exemple). */
  multiligne?: boolean;
  /** Exemple affiché en filigrane. */
  exemple?: string;
}

/**
 * Les champs de chaque type. Un type ne porte que ce qui le concerne : demander
 * un port à une clé d'API n'apprend rien à personne.
 */
export const CHAMPS_PAR_TYPE: Readonly<Record<TypeAcces, readonly ChampAcces[]>> = {
  'cle-api': [
    { cle: 'service', libelle: 'Service', exemple: 'OpenAI, Stripe…' },
    { cle: 'cle', libelle: 'Clé', secret: true, multiligne: true },
    { cle: 'adresse', libelle: 'Adresse', exemple: 'https://api.exemple.com' },
  ],
  'mot-de-passe': [
    { cle: 'adresse', libelle: 'Adresse', exemple: 'https://exemple.com/connexion' },
    { cle: 'identifiant', libelle: 'Identifiant' },
    { cle: 'motDePasse', libelle: 'Mot de passe', secret: true },
  ],
  ssh: [
    { cle: 'hote', libelle: 'Machine', exemple: '203.0.113.10' },
    { cle: 'port', libelle: 'Port', exemple: '22' },
    { cle: 'utilisateur', libelle: 'Utilisateur', exemple: 'root' },
    { cle: 'cle', libelle: 'Clé privée', secret: true, multiligne: true },
    { cle: 'motDePasse', libelle: 'Mot de passe', secret: true },
  ],
  jeton: [
    { cle: 'service', libelle: 'Service', exemple: 'GitHub, Vercel…' },
    { cle: 'jeton', libelle: 'Jeton', secret: true, multiligne: true },
  ],
  'base-de-donnees': [
    { cle: 'hote', libelle: 'Machine', exemple: 'localhost' },
    { cle: 'port', libelle: 'Port', exemple: '5432' },
    { cle: 'base', libelle: 'Base' },
    { cle: 'utilisateur', libelle: 'Utilisateur' },
    { cle: 'motDePasse', libelle: 'Mot de passe', secret: true },
  ],
  autre: [{ cle: 'valeur', libelle: 'Contenu', secret: true, multiligne: true }],
};

/** D'où vient une fiche : toujours du coffre lui-même depuis le retrait des
 *  anciens accès VPS, qui étaient le seul reflet d'un réglage. */
export type OrigineAcces = 'coffre';

/** Une fiche du coffre. */
export interface AccesCoffre {
  id: string;
  nom: string;
  type: TypeAcces;
  /** Le projet auquel l'accès est rattaché ; vide = Beluga Build lui-même. */
  projectId: string | null;
  /** Les valeurs, rangées par clé de champ. */
  champs: Record<string, string>;
  note: string;
  creeLe: number;
  modifieLe: number;
  origine: OrigineAcces;
  /**
   * L'instant où la fiche a été RETIRÉE : une fiche retirée n'est plus effacée
   * mais archivée, puis purgée au bout de `DUREE_ARCHIVE_MS`. Absent ou `null`
   * = fiche active.
   */
  archiveLe?: number | null;
}

export const NOM_ACCES_MAX = 80;
export const NOTE_ACCES_MAX = 2000;
export const VALEUR_CHAMP_MAX = 20000;

/** Les champs connus d'un type, jamais un tableau vide. */
export function champsDuType(type: TypeAcces): readonly ChampAcces[] {
  return CHAMPS_PAR_TYPE[type] ?? CHAMPS_PAR_TYPE.autre;
}

export type JugementAcces =
  | { ok: true; nom: string; type: TypeAcces; projectId: string | null; champs: Record<string, string>; note: string }
  | { ok: false; raison: string };

/**
 * Ce qui arrive du navigateur n'est pas cru sur parole : un nom vide, un type
 * inconnu ou un champ démesuré est refusé AVANT d'atteindre le disque, avec une
 * phrase en clair.
 */
export function jugerAcces(brut: unknown): JugementAcces {
  const o = (brut ?? {}) as Record<string, unknown>;

  const nom = String(o.nom ?? '').trim();
  if (!nom) return { ok: false, raison: 'Donnez un nom à cet accès.' };
  if (nom.length > NOM_ACCES_MAX)
    return { ok: false, raison: `Le nom ne peut pas dépasser ${NOM_ACCES_MAX} signes.` };

  const type = String(o.type ?? '') as TypeAcces;
  if (!TYPES_ACCES.includes(type)) return { ok: false, raison: "Ce type d'accès n'existe pas." };

  const projetBrut = o.projectId;
  const projectId =
    typeof projetBrut === 'string' && projetBrut.trim() ? projetBrut.trim() : null;

  const note = String(o.note ?? '').slice(0, NOTE_ACCES_MAX);

  /*
   * On ne garde QUE les champs du type : un champ resté d'un type précédent
   * (le mot de passe d'un « accès SSH » repassé en « clé d'API ») traînerait
   * sinon dans la fiche, invisible et inchangeable.
   */
  const bruts = (o.champs ?? {}) as Record<string, unknown>;
  const champs: Record<string, string> = {};
  for (const champ of champsDuType(type)) {
    const valeur = String(bruts[champ.cle] ?? '');
    if (valeur.length > VALEUR_CHAMP_MAX)
      return { ok: false, raison: `Le champ « ${champ.libelle} » est trop long.` };
    if (valeur) champs[champ.cle] = valeur;
  }

  const regroupement = regroupementDeSecrets(nom, champs, note);
  if (regroupement) return { ok: false, raison: regroupement };

  return { ok: true, nom, type, projectId, champs, note };
}

/* ------------------------------------------------------------------ */
/* UNE FICHE PAR SECRET                                               */
/* ------------------------------------------------------------------ */

/*
 * UNE FICHE = UN SECRET (17/09/2026). Une migration avait recopié des fichiers
 * de configuration ENTIERS (`.env`, `config.php`, `wp-config.php`) dans des
 * fiches « autre » : des centaines de lignes où trois mots de passe se
 * cachaient parmi les réglages, introuvables par la recherche (une valeur
 * secrète n'y entre pas) et impossibles à corriger un par un. Le coffre refuse
 * donc ce qui regroupe MANIFESTEMENT plusieurs secrets. Le garde-fou ne
 * prétend pas tout voir : il attrape les cas évidents, la consigne des agents
 * fait le reste.
 */

/** Un nom de clé qui annonce un secret : `DB_PASSWORD`, `api_key`, « mot de passe »… */
const CLE_SECRETE =
  /(pass(word|wd)?|pwd|secret|token|jeton|api[_ .-]?key|private[_ .-]?key|access[_ .-]?key|auth[_ .-]?key|encryption[_ .-]?key|\bsalt|credential|mot[ _-]?de[ _-]?passe|\bmdp\b|\bcl[eé][ _-]?(d['’ _-]?api|priv[eé]e|secr[eè]te))/i;

/**
 * Une valeur vide, factice ou qui est une PHRASE (« voir la fiche X ») ne
 * compte pas comme un secret : un secret tient en un seul bloc de signes.
 */
function valeurVide(valeur: string): boolean {
  const v = valeur.trim().replace(/[,;)]+$/, '').trim().replace(/^['"`]|['"`]$/g, '').trim();
  return !v || /\s/.test(v) || /^(null|none|false|true|changeme|xxx+|\*+|<.*>|\$\{.*\}|process\.env.*|getenv\(.*)$/i.test(v);
}

/** Les blocs PEM (clé privée, certificat) sont UN secret, jamais une suite de lignes. */
function sansBlocsPem(texte: string): { reste: string; blocs: number } {
  let blocs = 0;
  const reste = texte.replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, () => {
    blocs += 1;
    return '';
  });
  return { reste, blocs };
}

/**
 * Compte les secrets RECONNAISSABLES d'un texte : une affectation dont la clé
 * annonce un secret et dont la valeur n'est pas vide (`KEY=val`, `key: val`,
 * `define('DB_PASSWORD', 'x')`, `$config['encryption_key'] = 'x'`,
 * `'password' => 'x'`), une adresse qui porte `utilisateur:motdepasse@`, et
 * chaque bloc de clé privée.
 */
export function compterSecrets(texte: string): number {
  const { reste, blocs } = sansBlocsPem(texte ?? '');
  let total = blocs;
  for (const brute of reste.split(/\r?\n/)) {
    const ligne = brute.trim();
    if (!ligne || /^(#|\/\/|;|\*|\/\*)/.test(ligne)) continue;
    /*
     * Un fichier collé dans un champ MASQUÉ perd ses retours à la ligne : le
     * navigateur les retire d'un champ d'une ligne. Les affectations se
     * retrouvent alors collées (`APP=xDB_PASSWORD=yAPI_KEY=z`) : on compte les
     * noms de variable en majuscules qui annoncent un secret, où qu'ils soient.
     */
    const colles = [...ligne.matchAll(/([A-Z][A-Z0-9_]{2,})=(?!=)/g)].filter((m) => CLE_SECRETE.test(m[1])).length;
    if (colles >= 2) {
      total += colles;
      continue;
    }
    if (/[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]+@/i.test(ligne)) {
      total += 1;
      continue;
    }
    const define = /define\s*\(\s*['"]([^'"]+)['"]\s*,\s*(.+)\)\s*;?\s*$/i.exec(ligne);
    const affectation =
      define ??
      /^\$\w+((?:\s*\[[^\]]*\])+)\s*=\s*(.+)$/.exec(ligne) ??
      /^['"]([^'"]+)['"]\s*=>\s*(.+)$/.exec(ligne) ??
      /^(?:export\s+)?([A-Za-z_][\w.-]*(?:\s[\w'’-]+){0,3})\s*[=:]\s*(.+)$/.exec(ligne);
    if (!affectation) continue;
    if (CLE_SECRETE.test(affectation[1]) && !valeurVide(affectation[2])) total += 1;
  }
  return total;
}

/** Un nom de fiche qui est un nom de fichier de configuration. */
const NOM_DE_FICHIER_DE_CONFIG = /(^|[\s/«"'(])(\.env(\.[\w-]+)?|[\w-]*config[\w.-]*\.(php|js|json|ya?ml|ini|toml)|wp-config\.php|[\w-]+\.env)(?=$|[\s»"')])/i;

/** Le nombre de lignes « clé = valeur » d'un texte, secrètes ou non. */
function lignesDeReglage(texte: string): number {
  return (texte ?? '')
    .split(/\r?\n/)
    .filter((l) => /^\s*(export\s+)?[A-Za-z_$][\w$.'"\[\]-]*\s*(=|=>|:)\s*\S/.test(l) || /^\s*define\s*\(/i.test(l)).length;
}

export const RAISON_UNE_FICHE_PAR_SECRET =
  'Une fiche par secret : cet accès en regroupe plusieurs. Créez une fiche pour chaque mot de passe, clé ou jeton, avec un nom qui dit à quoi il sert — un fichier de configuration ne se colle pas en entier.';

/**
 * La phrase de refus si la fiche regroupe plusieurs secrets, sinon `null`.
 * Refusés : plusieurs secrets reconnaissables dans les champs ; un secret
 * glissé dans la NOTE (il appartient à sa propre fiche) ; un fichier de
 * configuration recopié (nom de fichier de config, ou plus de cinq lignes de
 * réglage). Tolérés : une clé privée sur plusieurs lignes, une note libre.
 */
export function regroupementDeSecrets(nom: string, champs: Record<string, string>, note = ''): string | null {
  const valeurs = Object.values(champs ?? {});
  const secrets = valeurs.reduce((n, v) => n + compterSecrets(v), 0);
  if (secrets >= 2) return RAISON_UNE_FICHE_PAR_SECRET;
  const reglages = valeurs.reduce((n, v) => n + lignesDeReglage(sansBlocsPem(v).reste), 0);
  if (reglages >= 5 || (reglages >= 2 && NOM_DE_FICHIER_DE_CONFIG.test(nom ?? '')))
    return RAISON_UNE_FICHE_PAR_SECRET;
  if (compterSecrets(note) >= 1)
    return 'Une fiche par secret : la note contient un mot de passe, une clé ou un jeton. Rangez-le dans sa propre fiche et gardez la note pour dire à quoi sert l’accès.';
  return null;
}

/* ------------------------------------------------------------------ */
/* LES ARCHIVES                                                        */
/* ------------------------------------------------------------------ */

/** Une fiche retirée dort six mois (183 jours) dans les archives avant d'être effacée. */
export const DUREE_ARCHIVE_MS = 183 * 24 * 3600 * 1000;

/** L'instant où une fiche archivée sera effacée pour de bon, ou `null` si elle est active. */
export function echeanceArchive(acces: Pick<AccesCoffre, 'archiveLe'>): number | null {
  return typeof acces.archiveLe === 'number' ? acces.archiveLe + DUREE_ARCHIVE_MS : null;
}

/** Vrai seulement pour une fiche ARCHIVÉE dont l'échéance est passée. Une fiche active ne l'est jamais. */
export function archivePurgeable(acces: Pick<AccesCoffre, 'archiveLe'>, maintenant = Date.now()): boolean {
  const echeance = echeanceArchive(acces);
  return echeance !== null && echeance <= maintenant;
}

/** Enlève les accents et la casse : « Clé OVH » se trouve en tapant « cle ovh ». */
export function normaliserRecherche(texte: string): string {
  return (texte ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Le texte sur lequel une recherche mord : le nom, le type, le projet, la note
 * et les champs NON secrets. Un mot de passe ne sert pas à retrouver sa propre
 * fiche — et le taper dans une barre de recherche serait le pire endroit où
 * l'écrire.
 */
export function texteCherchable(acces: AccesCoffre, nomProjet?: string): string {
  const morceaux = [acces.nom, LIBELLE_TYPE_ACCES[acces.type] ?? '', nomProjet ?? '', acces.note];
  for (const champ of champsDuType(acces.type)) {
    if (champ.secret) continue;
    const valeur = acces.champs[champ.cle];
    if (valeur) morceaux.push(valeur);
  }
  return normaliserRecherche(morceaux.join(' '));
}

/**
 * La recherche : tous les mots tapés doivent se retrouver, dans n'importe quel
 * ordre. « ovh ssh » trouve donc « Accès SSH — OVH » sans qu'on ait à écrire le
 * nom exact.
 */
export function filtrerAcces(
  liste: readonly AccesCoffre[],
  recherche: string,
  nomProjet: (projectId: string | null) => string | undefined = () => undefined,
): AccesCoffre[] {
  const mots = normaliserRecherche(recherche).split(/\s+/).filter(Boolean);
  if (!mots.length) return [...liste];
  return liste.filter((acces) => {
    const texte = texteCherchable(acces, nomProjet(acces.projectId));
    return mots.every((mot) => texte.includes(mot));
  });
}

/**
 * La ligne d'aperçu d'une fiche dans la liste : ce qui identifie l'accès sans
 * rien dévoiler. Jamais une valeur secrète.
 */
export function apercuAcces(acces: AccesCoffre): string {
  const c = acces.champs;
  switch (acces.type) {
    case 'ssh':
      return c.hote ? `${c.utilisateur ? `${c.utilisateur}@` : ''}${c.hote}${c.port && c.port !== '22' ? `:${c.port}` : ''}` : '';
    case 'base-de-donnees':
      return c.hote ? `${c.base ? `${c.base} · ` : ''}${c.hote}${c.port ? `:${c.port}` : ''}` : (c.base ?? '');
    case 'mot-de-passe':
      return [c.identifiant, c.adresse].filter(Boolean).join(' · ');
    default:
      return c.service ?? c.adresse ?? '';
  }
}

/**
 * Le plus récemment touché d'abord, puis par nom : une fiche qu'on vient
 * d'écrire se retrouve en haut, sans avoir à la chercher.
 */
export function trierAcces(liste: readonly AccesCoffre[]): AccesCoffre[] {
  return [...liste].sort((a, b) => b.modifieLe - a.modifieLe || a.nom.localeCompare(b.nom));
}
