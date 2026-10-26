import { minusculesSansAccents } from './mots.js';
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
  'mot-de-passe',
  'cle-api',
  'jeton',
  'ssh',
  'base-de-donnees',
  'compte-bancaire',
  'carte-paiement',
  'carte-identite',
  'passeport',
  'permis-conduire',
  'autre',
] as const;
export type TypeAcces = (typeof TYPES_ACCES)[number];

/**
 * Le nom affiché d'un type, en français — l'interface le traduit. La CLÉ
 * technique ne change jamais (« mot-de-passe » reste « mot-de-passe ») : seul le
 * libellé suit l'usage, « Compte en ligne » disant mieux ce qu'on range là.
 */
export const LIBELLE_TYPE_ACCES: Readonly<Record<TypeAcces, string>> = {
  'mot-de-passe': 'Compte en ligne',
  'cle-api': 'Clé d’API',
  jeton: 'Jeton',
  ssh: 'Accès SSH',
  'base-de-donnees': 'Base de données',
  'compte-bancaire': 'Compte bancaire',
  'carte-paiement': 'Carte de paiement',
  'carte-identite': 'Carte d’identité',
  passeport: 'Passeport',
  'permis-conduire': 'Permis de conduire',
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
  /**
   * LE SECRET QUI REND LA FICHE UTILISABLE. Une fiche dont AUCUN champ
   * principal n'est rempli est « à compléter » (`champsACompleter`) : elle est
   * acceptée, jamais refusée, et le dit. Plusieurs principaux = l'un OU l'autre
   * suffit (une clé privée ou un mot de passe pour un accès SSH).
   */
  principal?: boolean;
}

/*
 * LES CHAMPS DE CHAQUE TYPE — un modèle par usage. Tout ce qui a sa case y va :
 * la note ne sert qu'à dire À QUOI sert l'accès (`valeurDeLaNoteAvecSaCase`
 * refuse une note qui porte une valeur dont la case existe). Un type ne porte
 * que ce qui le concerne : demander un port à une clé d'API n'apprend rien.
 * Ajouter un champ est permis ; renommer une CLÉ ne l'est jamais.
 */
const ADRESSE: ChampAcces = { cle: 'adresse', libelle: 'Adresse', exemple: 'https://exemple.com/connexion' };
const EXPIRATION: ChampAcces = { cle: 'expiration', libelle: 'Expiration', exemple: '2028-10-16' };
const MOT_DE_PASSE: ChampAcces = { cle: 'motDePasse', libelle: 'Mot de passe', secret: true };

/** Les champs communs aux pièces d'identité. */
function champsDePiece(numero: string): ChampAcces[] {
  return [
    { cle: 'nom', libelle: 'Nom complet', exemple: 'Prénom Nom' },
    { cle: 'naissance', libelle: 'Date de naissance', exemple: '01.12.1984' },
    { cle: 'numero', libelle: numero, secret: true, principal: true },
    { cle: 'delivrance', libelle: 'Délivrance', exemple: '22.06.2023, Lausanne' },
    { cle: 'expiration', libelle: 'Expiration', exemple: '21.06.2033' },
    { cle: 'autorite', libelle: 'Pays ou autorité', exemple: 'Suisse' },
  ];
}

export const CHAMPS_PAR_TYPE: Readonly<Record<TypeAcces, readonly ChampAcces[]>> = {
  'mot-de-passe': [
    ADRESSE,
    { cle: 'identifiant', libelle: 'Identifiant', exemple: 'adresse e-mail ou nom d’utilisateur' },
    { ...MOT_DE_PASSE, principal: true },
    { cle: 'connexion', libelle: 'Connexion sans mot de passe', exemple: '« Continuer avec Google », code par e-mail…', principal: true },
    { cle: 'doubleAuth', libelle: 'Double authentification', exemple: 'Code par SMS au +41…, application…' },
    { cle: 'compte', libelle: 'Numéro de compte ou d’équipe', exemple: 'Team ID, n° client…' },
  ],
  'cle-api': [
    { cle: 'service', libelle: 'Service', exemple: 'OpenAI, Stripe…' },
    { cle: 'identifiantCle', libelle: 'Identifiant de la clé', exemple: 'Key ID, identifiant client…' },
    { cle: 'emetteur', libelle: 'Émetteur', exemple: 'Issuer ID' },
    { cle: 'equipe', libelle: 'Équipe ou compte', exemple: 'Team ID, compte acct_…, projet' },
    { cle: 'cle', libelle: 'Clé', secret: true, multiligne: true, principal: true },
    { ...ADRESSE, exemple: 'https://api.exemple.com' },
    EXPIRATION,
  ],
  jeton: [
    { cle: 'service', libelle: 'Service', exemple: 'GitHub, Vercel…' },
    { ...ADRESSE, exemple: 'https://exemple.com/webhook' },
    { cle: 'portee', libelle: 'Portée', exemple: 'lecture seule, dépôt X…' },
    { cle: 'jeton', libelle: 'Jeton', secret: true, multiligne: true, principal: true },
    EXPIRATION,
  ],
  ssh: [
    { cle: 'hote', libelle: 'Machine', exemple: '203.0.113.10' },
    { cle: 'port', libelle: 'Port', exemple: '22' },
    { cle: 'utilisateur', libelle: 'Utilisateur', exemple: 'root' },
    { cle: 'cle', libelle: 'Clé privée', secret: true, multiligne: true, principal: true },
    { cle: 'clePublique', libelle: 'Clé publique', multiligne: true, exemple: 'ssh-ed25519 AAAA…' },
    { cle: 'phrasePasse', libelle: 'Phrase de passe de la clé', secret: true },
    { ...MOT_DE_PASSE, principal: true },
  ],
  'base-de-donnees': [
    { cle: 'moteur', libelle: 'Moteur', exemple: 'PostgreSQL, MySQL…' },
    { cle: 'hote', libelle: 'Machine', exemple: 'localhost' },
    { cle: 'port', libelle: 'Port', exemple: '5432' },
    { cle: 'base', libelle: 'Base' },
    { cle: 'utilisateur', libelle: 'Utilisateur' },
    { ...MOT_DE_PASSE, principal: true },
  ],
  'compte-bancaire': [
    { cle: 'titulaire', libelle: 'Titulaire' },
    { cle: 'banque', libelle: 'Banque' },
    { cle: 'iban', libelle: 'IBAN', secret: true, principal: true, exemple: 'CH00 0000 0000 0000 0000 0' },
    { cle: 'bic', libelle: 'BIC', exemple: 'POFICHBEXXX' },
    { ...ADRESSE, libelle: 'Banque en ligne', exemple: 'https://banque.exemple.com' },
    { cle: 'identifiant', libelle: 'Identifiant de connexion' },
    MOT_DE_PASSE,
  ],
  'carte-paiement': [
    { cle: 'titulaire', libelle: 'Titulaire' },
    { cle: 'banque', libelle: 'Banque ou réseau', exemple: 'Yuh, Mastercard' },
    { cle: 'numero', libelle: 'Numéro de la carte', secret: true, principal: true },
    { cle: 'expiration', libelle: 'Expiration', exemple: '07/2028' },
    { cle: 'cryptogramme', libelle: 'Cryptogramme', secret: true },
    { cle: 'code', libelle: 'Code PIN', secret: true },
  ],
  'carte-identite': champsDePiece('Numéro de la carte'),
  passeport: champsDePiece('Numéro du passeport'),
  'permis-conduire': [
    ...champsDePiece('Numéro du permis'),
    { cle: 'categories', libelle: 'Catégories', exemple: 'B, A1' },
  ],
  autre: [{ cle: 'valeur', libelle: 'Contenu', secret: true, multiligne: true, principal: true }],
};

/**
 * UNE CASE EN PLUS, NOMMÉE PAR CELUI QUI LA REMPLIT : ce qu'aucun modèle ne
 * prévoit (« Code client », « Empreinte du certificat »…) a sa case à lui
 * plutôt qu'une phrase dans la note. Une case secrète se masque et n'entre
 * pas dans la recherche, comme un champ secret du modèle.
 */
export interface ChampLibre {
  libelle: string;
  valeur: string;
  secret?: boolean;
}

/** Combien de cases en plus une fiche peut porter, et la longueur de leur nom. */
export const CHAMPS_LIBRES_MAX = 20;
export const LIBELLE_CHAMP_LIBRE_MAX = 60;

/**
 * Les cases de chaque type en une ligne compacte, pour l'outil des agents :
 * « mot-de-passe → adresse/identifiant/motDePasse*… ; … » (* = le secret
 * principal). Tirée de `CHAMPS_PAR_TYPE` : une seule source, jamais une liste
 * recopiée à la main qui oublierait un type.
 */
export function resumeDesCasesParType(): string {
  return TYPES_ACCES.map(
    (type) => `${type} → ${CHAMPS_PAR_TYPE[type].map((c) => `${c.cle}${c.principal ? '*' : ''}`).join('/')}`,
  ).join(' ; ');
}

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
  /**
   * LES FICHIERS DE LA FICHE (photo, capture, PDF, vidéo, texte… tout sauf un
   * programme ; le nom « images » est resté de la première version) : des
   * identifiants de pièces jointes, dans l'ordre où ils ont été posés. Ils
   * suivent la fiche aux archives, en reviennent avec elle, et sont effacées
   * avec elle. Absent = aucune image (fiche d'avant cette mécanique).
   */
  images?: string[];
  /**
   * LE DOSSIER où la fiche est rangée. Absent ou `null` = à la racine du coffre.
   * Un dossier ne porte aucun secret : il ne sert qu'à ranger.
   */
  dossierId?: string | null;
  /**
   * LE CHEMIN COMPLET de ce dossier (« Clients/Acme/Prod »), calculé à chaque
   * lecture depuis les parents — jamais stocké. C'est ce qu'un agent lit pour
   * trier les fiches. Absent = la fiche est à la racine.
   */
  dossierChemin?: string | null;
  /** LES CASES EN PLUS, dans l'ordre où elles ont été posées. Absent = aucune. */
  champsLibres?: ChampLibre[];
}

/**
 * UN DOSSIER DU COFFRE : un nom et un projet, rien d'autre. Il vit dans sa propre
 * table — jamais parmi les fiches — pour que ni un agent, ni une surveillance, ni
 * un relais ne puisse le prendre pour un secret. Un dossier peut en contenir
 * d'autres, sur autant de niveaux qu'on veut : `parentId` le relie au sien.
 */
export interface DossierCoffre {
  id: string;
  nom: string;
  /** Le dossier qui le contient ; absent ou `null` = à la racine du coffre. */
  parentId?: string | null;
  /** Le projet du dossier ; vide = Beluga Build lui-même. Ses fiches et ses sous-dossiers le suivent. */
  projectId: string | null;
  creeLe: number;
  modifieLe: number;
  /** L'instant où le dossier (et ses fiches, et tout ce qu'il contient) ont été retirés ; `null` = actif. */
  archiveLe?: number | null;
}

export const NOM_ACCES_MAX = 80;
export const NOM_DOSSIER_MAX = 80;
export const NOTE_ACCES_MAX = 2000;
export const VALEUR_CHAMP_MAX = 20000;
/**
 * LE POIDS TOTAL des fichiers d'une fiche : aucune limite de nombre, mais la
 * somme de ce qu'elle cite ne dépasse pas 1 Go. Jugé à l'ENREGISTREMENT de la
 * fiche, pas à l'envoi d'un fichier (qui ne sait pas encore à quoi il s'ajoute).
 */
export const FICHIERS_FICHE_OCTETS_MAX = 1024 * 1024 * 1024;
/** Garde-fou de forme seulement : au-delà, la liste reçue est tronquée. */
const FICHIERS_LISTE_BORNE = 1000;

/**
 * LE « PROJET » DES IMAGES DU COFFRE dans le dépôt des pièces jointes. Une
 * fiche partagée n'appartient à aucun projet, et une image du coffre ne doit
 * JAMAIS se confondre avec la pièce d'une carte ou d'une demande client : les
 * fichiers sont dédoublonnés par empreinte À L'INTÉRIEUR d'un projet, donc ce
 * rangement à part garantit qu'effacer une image du coffre n'efface rien
 * d'autre — et qu'aucun écran de projet ne la liste.
 */
export const PROJET_DU_COFFRE = 'coffre-fort';

/** Les extensions d'un PROGRAMME : le seul genre de fichier que le coffre refuse. */
const EXTENSIONS_DE_PROGRAMME = new Set([
  'exe', 'msi', 'msp', 'bat', 'cmd', 'com', 'scr', 'pif', 'cpl', 'ps1', 'psm1', 'vbs', 'vbe', 'wsf',
  'sh', 'bash', 'zsh', 'csh', 'command', 'app', 'dmg', 'pkg', 'mpkg', 'apk', 'aab', 'xapk', 'ipa',
  'jar', 'deb', 'rpm', 'bin', 'run', 'elf', 'appimage', 'dll', 'so', 'dylib', 'sys', 'drv', 'gadget',
]);
/** Les types annoncés d'un programme — le navigateur envoie souvent `application/octet-stream`, d'où le nom aussi. */
const MIMES_DE_PROGRAMME = new Set([
  'application/x-msdownload', 'application/x-ms-installer', 'application/x-msi', 'application/x-msdos-program',
  'application/x-dosexec', 'application/x-executable', 'application/x-elf', 'application/x-sharedlib',
  'application/x-mach-binary', 'application/x-sh', 'application/x-shellscript', 'application/x-csh',
  'application/x-bat', 'application/vnd.microsoft.portable-executable', 'application/vnd.android.package-archive',
  'application/x-apple-diskimage', 'application/x-newton-compatible-pkg', 'application/java-archive',
  'application/x-java-archive', 'application/vnd.debian.binary-package', 'application/x-debian-package',
  'application/x-rpm', 'application/x-redhat-package-manager', 'application/x-itunes-ipa',
]);

/**
 * LE COFFRE PREND TOUT FICHIER, SAUF UN PROGRAMME : image, PDF, vidéo, son,
 * texte, archive… Un programme se reconnaît à son type annoncé OU à son
 * extension. Rend la raison du refus, `null` quand le fichier est accepté.
 */
export function refusDuFichierDuCoffre(mime: string, nom: string): string | null {
  const type = (mime ?? '').split(';')[0]!.trim().toLowerCase();
  const extension = /\.([a-z0-9]+)$/i.exec((nom ?? '').trim())?.[1]?.toLowerCase() ?? '';
  if (MIMES_DE_PROGRAMME.has(type) || EXTENSIONS_DE_PROGRAMME.has(extension)) {
    return `« ${nom || 'ce fichier'} » est un programme : le coffre-fort ne prend pas les programmes.`;
  }
  return null;
}

/** La raison d'un total trop lourd, `null` s'il tient sous le plafond d'une fiche. */
export function refusDuPoidsDeLaFiche(totalOctets: number): string | null {
  if (totalOctets <= FICHIERS_FICHE_OCTETS_MAX) return null;
  const go = (totalOctets / 1024 / 1024 / 1024).toFixed(2).replace('.', ',');
  return `Les fichiers de la fiche pèseraient ${go} Go : une fiche porte 1 Go de fichiers au plus.`;
}

/**
 * Les images telles qu'elles arrivent d'un enregistrement. `undefined` quand
 * l'appelant n'en DIT RIEN (un agent qui corrige un champ) : la fiche garde
 * alors celles qu'elle a. Un tableau, même vide, est une intention : il
 * remplace la liste. Doublons retirés, liste bornée.
 */
export function jugerImages(brut: unknown): string[] | undefined {
  if (!Array.isArray(brut)) return undefined;
  const vues = new Set<string>();
  for (const valeur of brut) {
    if (typeof valeur !== 'string') continue;
    const id = valeur.trim();
    if (id) vues.add(id);
  }
  return [...vues].slice(0, FICHIERS_LISTE_BORNE);
}

/**
 * CE QUE LA FICHE GARDE APRÈS UN ENREGISTREMENT : les images demandées, ou
 * celles d'avant quand rien n'est demandé. `retirees` = celles que la fiche
 * ne cite plus, à effacer si personne d'autre ne les cite.
 */
export function imagesApresEnregistrement(
  avant: readonly string[],
  demandees: readonly string[] | undefined,
): { images: string[]; retirees: string[] } {
  if (!demandees) return { images: [...avant], retirees: [] };
  const gardees = new Set(demandees);
  return { images: [...demandees], retirees: avant.filter((id) => !gardees.has(id)) };
}

/** Les champs connus d'un type, jamais un tableau vide. */
export function champsDuType(type: TypeAcces): readonly ChampAcces[] {
  return CHAMPS_PAR_TYPE[type] ?? CHAMPS_PAR_TYPE.autre;
}

export type JugementAcces =
  | {
      ok: true;
      nom: string;
      type: TypeAcces;
      projectId: string | null;
      champs: Record<string, string>;
      note: string;
      /** Absent = l'appelant n'a rien dit des images : la fiche garde les siennes. */
      images?: string[];
      /**
       * Absent = l'appelant n'a rien dit du dossier : la fiche reste où elle est.
       * `null` = la sortir de son dossier ; une chaîne = l'y ranger.
       */
      dossierId?: string | null;
      /** Absent = l'appelant n'a rien dit des cases en plus : la fiche garde les siennes. */
      champsLibres?: ChampLibre[];
    }
  | { ok: false; raison: string };

/**
 * Les cases en plus telles qu'elles arrivent. `undefined` quand l'appelant n'en
 * DIT RIEN (un agent qui corrige un mot de passe) : la fiche garde alors les
 * siennes — même règle que les images. Une case sans valeur est retirée ; une
 * case sans nom, un nom ou une valeur démesurés, ou trop de cases, sont refusés.
 */
export function jugerChampsLibres(brut: unknown): { ok: true; champsLibres?: ChampLibre[] } | { ok: false; raison: string } {
  if (brut === undefined || brut === null) return { ok: true };
  if (!Array.isArray(brut)) return { ok: false, raison: 'Les cases en plus sont une liste de { libelle, valeur, secret }.' };
  const champsLibres: ChampLibre[] = [];
  for (const element of brut) {
    const o = (element ?? {}) as Record<string, unknown>;
    const libelle = String(o.libelle ?? '').trim();
    const valeur = String(o.valeur ?? '');
    if (!valeur.trim()) continue;
    if (!libelle) return { ok: false, raison: 'Chaque case en plus a besoin d’un nom.' };
    if (libelle.length > LIBELLE_CHAMP_LIBRE_MAX)
      return { ok: false, raison: `Le nom d’une case ne peut pas dépasser ${LIBELLE_CHAMP_LIBRE_MAX} signes.` };
    if (valeur.length > VALEUR_CHAMP_MAX) return { ok: false, raison: `La case « ${libelle} » est trop longue.` };
    champsLibres.push({ libelle, valeur, ...(o.secret === true ? { secret: true } : {}) });
  }
  if (champsLibres.length > CHAMPS_LIBRES_MAX)
    return { ok: false, raison: `Une fiche porte ${CHAMPS_LIBRES_MAX} cases en plus au plus.` };
  return { ok: true, champsLibres };
}

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

  const libres = jugerChampsLibres(o.champsLibres);
  if (!libres.ok) return libres;

  /*
   * Les cases en plus passent par le MÊME garde-fou que les champs du modèle :
   * une case = un champ. Sans cela, un fichier de configuration entier se
   * glisserait dans des cases nommées « DB_PASSWORD », « API_KEY »…
   */
  const pourLeGardeFou: Record<string, string> = { ...champs };
  // Le nom d'une case compte comme une étiquette (« API_KEY » → secret) quand la valeur ne se dit pas elle-même.
  (libres.champsLibres ?? []).forEach(
    (c, i) => (pourLeGardeFou[`libre${i}`] = compterSecrets(c.valeur) ? c.valeur : `${c.libelle}: ${c.valeur}`),
  );
  const regroupement = regroupementDeSecrets(nom, pourLeGardeFou, note);
  if (regroupement) return { ok: false, raison: regroupement };

  // Taire les cases en plus les garde : la note se juge alors contre celles que la fiche porte déjà.
  const libresDeLaFiche =
    libres.champsLibres ?? (Array.isArray(o.champsLibresActuels) ? (o.champsLibresActuels as ChampLibre[]) : []);
  const dansLaNote = valeurDeLaNoteAvecSaCase(type, note, champs, libresDeLaFiche);
  if (dansLaNote) return { ok: false, raison: raisonNoteAvecSaCase(dansLaNote) };

  // Les images ne passent JAMAIS par le garde-fou « une fiche par secret » :
  // ce sont des identifiants de fichiers, pas un texte où compter des secrets.
  const images = jugerImages(o.images);

  // Le dossier suit la même règle que les images : le taire ne déplace rien.
  let dossierId: string | null | undefined;
  if (o.dossierId !== undefined) {
    dossierId = typeof o.dossierId === 'string' && o.dossierId.trim() ? o.dossierId.trim() : null;
  }

  return {
    ok: true,
    nom,
    type,
    projectId,
    champs,
    note,
    ...(images ? { images } : {}),
    ...(dossierId !== undefined ? { dossierId } : {}),
    ...(libres.champsLibres ? { champsLibres: libres.champsLibres } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* LA NOTE N'EST PAS UN CHAMP                                          */
/* ------------------------------------------------------------------ */

/*
 * LA NOTE DIT À QUOI SERT L'ACCÈS, ELLE NE PORTE PAS SES VALEURS (20/10/2026).
 * La fiche « Compte développeur Apple » avait ses trois champs vides et tout
 * dans la note — Team ID, appareil de la double authentification — et les clés
 * Apple entassaient Key ID, Issuer ID et Team ID dans « Service ». Une valeur
 * qui a SA case dans le type de la fiche est donc refusée dans la note, avec le
 * nom de la case où la mettre. Les motifs sont ÉTROITS : une étiquette
 * explicite suivie d'une valeur d'un seul bloc (« Team ID X6ZLFDBZ7M »,
 * « APNS_KEY_ID=T3HPQK4TRF », « Identifiant : jean »), un IBAN, un numéro de
 * carte valide. Une note qui RACONTE (« le code arrive sur l'iPad ») passe.
 * Une valeur déjà rangée dans sa case peut être redite : ce n'est plus une
 * valeur perdue dans la note.
 */

/** Une valeur trouvée dans la note alors que sa case existe. */
export interface ValeurDansLaNote {
  /** Ce qui a été lu, tel quel (« Team ID X6ZLFDBZ7M »). */
  extrait: string;
  valeur: string;
  /** La case du type où elle va. */
  champ: ChampAcces;
}

/** Une valeur d'un seul bloc : pas une phrase, pas un exemple factice. */
const BLOC = String.raw`([A-Za-z0-9][A-Za-z0-9._@+\-]{2,})`;

interface MotifDeNote {
  /** Les cases candidates, dans l'ordre : la première que le type porte reçoit la valeur. */
  cases: readonly string[];
  motif: RegExp;
}

const MOTIFS_DE_NOTE: readonly MotifDeNote[] = [
  { cases: ['equipe', 'compte'], motif: new RegExp(String.raw`\b(?:team[ _-]?id|[A-Z]+_TEAM_ID)\s*[:=]?\s*` + BLOC, 'gi') },
  { cases: ['identifiantCle'], motif: new RegExp(String.raw`\b(?:key[ _-]?id|[A-Z]+_KEY_ID)\s*[:=]?\s*` + BLOC, 'gi') },
  { cases: ['emetteur'], motif: new RegExp(String.raw`\b(?:issuer[ _-]?id|[A-Z]+_ISSUER_ID)\s*[:=]?\s*` + BLOC, 'gi') },
  {
    cases: ['identifiantCle'],
    motif: new RegExp(String.raw`\b(?:identifiant client|client[ _]id|[A-Z]+_CLIENT_ID)\s*[:=]\s*` + BLOC, 'gi'),
  },
  { cases: ['identifiant'], motif: new RegExp(String.raw`\b(?:identifiant(?: de connexion)?|login|nom d['’]utilisateur)\s*[:=]\s*` + BLOC, 'gi') },
  { cases: ['utilisateur'], motif: new RegExp(String.raw`\b(?:utilisateur|user(?:name)?)\s*[:=]\s*` + BLOC, 'gi') },
  { cases: ['bic'], motif: new RegExp(String.raw`\b(?:BIC|SWIFT)\s*[:=]?\s*([A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b`, 'g') },
  { cases: ['iban'], motif: /\b([A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?)\b/g },
];

/** Le contrôle de Luhn : ce qui distingue un numéro de carte d'une suite de chiffres. */
function numeroDeCarteValide(chiffres: string): boolean {
  if (chiffres.length < 13 || chiffres.length > 19) return false;
  let somme = 0;
  for (let i = 0; i < chiffres.length; i += 1) {
    let n = Number(chiffres[chiffres.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    somme += n;
  }
  return somme % 10 === 0;
}

const sansEspaces = (v: string) => v.replace(/\s+/g, '').toLowerCase();

/**
 * La première valeur de la note qui a SA case dans le type, sinon `null`. Une
 * valeur déjà rangée dans cette case (`champs`) n'est pas reprochée.
 */
export function valeurDeLaNoteAvecSaCase(
  type: TypeAcces,
  note: string,
  champs: Record<string, string> = {},
  champsLibres: readonly ChampLibre[] = [],
): ValeurDansLaNote | null {
  const texte = note ?? '';
  if (!texte.trim()) return null;
  const parCle = new Map(champsDuType(type).map((c) => [c.cle, c]));
  const dejaRangee = (cle: string, valeur: string) =>
    [champs[cle] ?? '', ...champsLibres.map((c) => c.valeur)].some((v) => sansEspaces(v).includes(sansEspaces(valeur)));
  for (const { cases, motif } of MOTIFS_DE_NOTE) {
    const cle = cases.find((c) => parCle.has(c));
    if (!cle) continue;
    for (const m of texte.matchAll(motif)) {
      const valeur = m[1]!.replace(/[.,;:)]+$/, '');
      if (cle === 'iban' && !/\d{4}/.test(valeur.replace(/\s/g, '').slice(4))) continue;
      if (dejaRangee(cle, valeur)) continue;
      return { extrait: m[0].trim(), valeur, champ: parCle.get(cle)! };
    }
  }
  const numero = parCle.get('numero');
  if (numero && type === 'carte-paiement') {
    for (const m of texte.matchAll(/\b\d(?:[ -]?\d){12,18}\b/g)) {
      const chiffres = m[0].replace(/\D/g, '');
      if (numeroDeCarteValide(chiffres) && !dejaRangee('numero', chiffres)) return { extrait: m[0], valeur: chiffres, champ: numero };
    }
  }
  return null;
}

/** La phrase de refus : elle NOMME la case où mettre la valeur. */
export function raisonNoteAvecSaCase(trouvee: ValeurDansLaNote): string {
  return `La note n’est pas un champ : « ${trouvee.extrait} » va dans la case « ${trouvee.champ.libelle} ». Gardez la note pour dire à quoi sert l’accès.`;
}

/* ------------------------------------------------------------------ */
/* À COMPLÉTER                                                         */
/* ------------------------------------------------------------------ */

/**
 * Les champs PRINCIPAUX d'une fiche qui n'en a aucun de rempli — le secret qui
 * la rendrait utilisable. Vide = la fiche est complète. Calculé à chaque
 * lecture, JAMAIS stocké : remplir le champ suffit à faire tomber la mention.
 * Une fiche sans son secret est acceptée (décision du 20/10/2026) : elle le dit.
 */
export function champsACompleter(acces: Pick<AccesCoffre, 'type' | 'champs'>): ChampAcces[] {
  const principaux = champsDuType(acces.type).filter((c) => c.principal);
  if (!principaux.length) return [];
  const rempli = principaux.some((c) => (acces.champs?.[c.cle] ?? '').trim());
  return rempli ? [] : principaux;
}

/* ------------------------------------------------------------------ */
/* LES DOSSIERS                                                        */
/* ------------------------------------------------------------------ */

export type JugementDossier =
  | {
      ok: true;
      nom: string;
      projectId: string | null;
      /** `undefined` = l'appelant ne dit rien du projet : un dossier corrigé garde le sien. */
      projectIdDit: boolean;
      /** Absent = l'appelant ne dit rien du parent : le dossier reste où il est. `null` = la racine. */
      parentId?: string | null;
    }
  | { ok: false; raison: string };

/** Ce qui sépare les niveaux dans un chemin que l'on écrit (« Clients/Acme/Prod »). */
export const SEPARATEUR_CHEMIN = '/';
/** Ce qui sépare les niveaux dans un chemin que l'on LIT à l'écran. */
export const SEPARATEUR_AFFICHAGE = ' › ';

/** Ce qui arrive pour un dossier : un nom, un projet, un parent — rien de plus n'est gardé. */
export function jugerDossier(brut: unknown): JugementDossier {
  const o = (brut ?? {}) as Record<string, unknown>;
  const nom = String(o.nom ?? '').trim();
  if (!nom) return { ok: false, raison: 'Donnez un nom à ce dossier.' };
  if (nom.length > NOM_DOSSIER_MAX)
    return { ok: false, raison: `Le nom d’un dossier ne peut pas dépasser ${NOM_DOSSIER_MAX} signes.` };
  if (nom.includes(SEPARATEUR_CHEMIN))
    return { ok: false, raison: `Le nom d’un dossier ne peut pas contenir « ${SEPARATEUR_CHEMIN} » : c’est ce qui sépare les niveaux d’un chemin.` };
  const projetBrut = o.projectId;
  const projectId = typeof projetBrut === 'string' && projetBrut.trim() ? projetBrut.trim() : null;
  let parentId: string | null | undefined;
  if (o.parentId !== undefined) {
    parentId = typeof o.parentId === 'string' && o.parentId.trim() ? o.parentId.trim() : null;
  }
  return {
    ok: true,
    nom,
    projectId,
    projectIdDit: o.projectId !== undefined,
    ...(parentId !== undefined ? { parentId } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* L'ARBRE DES DOSSIERS                                                */
/* ------------------------------------------------------------------ */

type DossierPlat = Pick<DossierCoffre, 'id' | 'nom' | 'parentId'>;

/**
 * Les NOMS des dossiers de la racine jusqu'à celui-ci, dans l'ordre. Vide si le
 * dossier est inconnu. Un parent introuvable arrête la remontée (le dossier est
 * alors traité comme s'il était à la racine), et une boucle ne tourne jamais.
 */
export function cheminDuDossier(dossiers: readonly DossierPlat[], id: string | null | undefined): string[] {
  if (!id) return [];
  const parId = new Map(dossiers.map((d) => [d.id, d]));
  const noms: string[] = [];
  const vus = new Set<string>();
  let courant = parId.get(id);
  while (courant && !vus.has(courant.id)) {
    vus.add(courant.id);
    noms.unshift(courant.nom);
    courant = courant.parentId ? parId.get(courant.parentId) : undefined;
  }
  return noms;
}

/** Le chemin sous forme de texte : « Clients/Acme/Prod » pour écrire, `SEPARATEUR_AFFICHAGE` pour lire. */
export function cheminTexte(
  dossiers: readonly DossierPlat[],
  id: string | null | undefined,
  separateur: string = SEPARATEUR_CHEMIN,
): string {
  return cheminDuDossier(dossiers, id).join(separateur);
}

/** Tout ce que le dossier contient, à tous les niveaux (lui-même n'en fait pas partie). */
export function descendantsDuDossier<T extends DossierPlat>(dossiers: readonly T[], id: string): T[] {
  const enfantsDe = new Map<string, T[]>();
  for (const d of dossiers) {
    if (!d.parentId) continue;
    const liste = enfantsDe.get(d.parentId) ?? [];
    liste.push(d);
    enfantsDe.set(d.parentId, liste);
  }
  const trouves: T[] = [];
  const vus = new Set<string>([id]);
  const pile = [...(enfantsDe.get(id) ?? [])];
  while (pile.length) {
    const d = pile.pop()!;
    if (vus.has(d.id)) continue;
    vus.add(d.id);
    trouves.push(d);
    pile.push(...(enfantsDe.get(d.id) ?? []));
  }
  return trouves;
}

/**
 * Mettre `id` sous `nouveauParentId` ferait-il tourner l'arbre en rond ? Vrai si
 * le futur parent EST le dossier ou l'un de ses descendants.
 */
export function creeUnCycle(
  dossiers: readonly DossierPlat[],
  id: string,
  nouveauParentId: string | null | undefined,
): boolean {
  if (!nouveauParentId) return false;
  if (nouveauParentId === id) return true;
  return descendantsDuDossier(dossiers, id).some((d) => d.id === nouveauParentId);
}

/** Un nœud de l'arbre d'affichage : un dossier, ses fiches, ses sous-dossiers. */
export interface NoeudDeDossier {
  dossier: DossierCoffre;
  /** Le chemin complet, en texte à lire. */
  chemin: string;
  profondeur: number;
  /** Les fiches rangées DIRECTEMENT dans ce dossier. */
  acces: AccesCoffre[];
  enfants: NoeudDeDossier[];
  /** Les fiches de ce dossier ET de tout ce qu'il contient. */
  total: number;
}

export interface ArbreDeDossiers {
  /** Les dossiers de la racine. */
  racines: NoeudDeDossier[];
  /** Les fiches restées à la racine du coffre. */
  acces: AccesCoffre[];
}

/**
 * Range les fiches dans l'arbre des dossiers : à chaque niveau, les sous-dossiers
 * par ordre alphabétique. Une fiche qui cite un dossier inconnu retombe à la
 * racine plutôt que de disparaître ; un dossier dont le parent est inconnu aussi.
 * `sansVides` écarte les branches où il n'y a aucune fiche.
 */
export function construireArbreDeDossiers(
  liste: readonly AccesCoffre[],
  dossiers: readonly DossierCoffre[],
  options: { sansVides?: boolean } = {},
): ArbreDeDossiers {
  const connus = new Map(dossiers.map((d) => [d.id, d]));
  const fichesDe = new Map<string, AccesCoffre[]>();
  const racineFiches: AccesCoffre[] = [];
  for (const fiche of liste) {
    const id = fiche.dossierId ?? null;
    if (id && connus.has(id)) {
      const groupe = fichesDe.get(id) ?? [];
      groupe.push(fiche);
      fichesDe.set(id, groupe);
    } else racineFiches.push(fiche);
  }
  const enfantsDe = new Map<string | null, DossierCoffre[]>();
  for (const d of dossiers) {
    const parent = d.parentId && connus.has(d.parentId) && d.parentId !== d.id ? d.parentId : null;
    const groupe = enfantsDe.get(parent) ?? [];
    groupe.push(d);
    enfantsDe.set(parent, groupe);
  }
  const vus = new Set<string>();
  const construire = (d: DossierCoffre, profondeur: number): NoeudDeDossier | null => {
    if (vus.has(d.id)) return null; // une boucle abîmée en base ne fait pas tourner l'écran
    vus.add(d.id);
    const enfants = (enfantsDe.get(d.id) ?? [])
      .sort((a, b) => a.nom.localeCompare(b.nom))
      .map((e) => construire(e, profondeur + 1))
      .filter((n): n is NoeudDeDossier => !!n)
      .filter((n) => !options.sansVides || n.total > 0);
    const acces = fichesDe.get(d.id) ?? [];
    return {
      dossier: d,
      chemin: cheminTexte(dossiers, d.id, SEPARATEUR_AFFICHAGE),
      profondeur,
      acces,
      enfants,
      total: acces.length + enfants.reduce((n, e) => n + e.total, 0),
    };
  };
  const racines = (enfantsDe.get(null) ?? [])
    .sort((a, b) => a.nom.localeCompare(b.nom))
    .map((d) => construire(d, 0))
    .filter((n): n is NoeudDeDossier => !!n)
    .filter((n) => !options.sansVides || n.total > 0);
  return { racines, acces: racineFiches };
}

/** Un groupe d'affichage : un dossier et ses fiches, ou (`dossier: null`) les fiches à la racine. */
export interface GroupeDeDossier {
  dossier: DossierCoffre | null;
  /** Le chemin complet du dossier, en texte à lire ; vide pour la racine. */
  chemin: string;
  acces: AccesCoffre[];
}

/**
 * Range des fiches par dossier, À PLAT, chaque groupe portant le chemin de son
 * dossier : les dossiers d'abord, par ordre alphabétique de chemin (même vides,
 * sauf si `sansVides`), puis les fiches restées à la racine. Une
 * fiche qui cite un dossier inconnu retombe à la racine plutôt que de disparaître.
 */
export function regrouperParDossier(
  liste: readonly AccesCoffre[],
  dossiers: readonly DossierCoffre[],
  options: { sansVides?: boolean } = {},
): GroupeDeDossier[] {
  const connus = new Map(dossiers.map((d) => [d.id, d]));
  const parDossier = new Map<string, AccesCoffre[]>();
  const racine: AccesCoffre[] = [];
  for (const fiche of liste) {
    const id = fiche.dossierId ?? null;
    if (id && connus.has(id)) {
      const groupe = parDossier.get(id) ?? [];
      groupe.push(fiche);
      parDossier.set(id, groupe);
    } else racine.push(fiche);
  }
  const groupes: GroupeDeDossier[] = dossiers
    .map((dossier) => ({
      dossier,
      chemin: cheminTexte(dossiers, dossier.id, SEPARATEUR_AFFICHAGE),
      acces: parDossier.get(dossier.id) ?? [],
    }))
    .sort((a, b) => a.chemin.localeCompare(b.chemin))
    .filter((g) => !options.sansVides || g.acces.length > 0);
  if (racine.length) groupes.push({ dossier: null, chemin: '', acces: racine });
  return groupes;
}

export type RechercheDeDossier<T> =
  | { ok: true; dossier: T }
  | { ok: false; raison: string; candidats: string[] };

/**
 * Retrouve un dossier par son identifiant, par son CHEMIN (« Clients/Acme/Prod »,
 * casse et accents ignorés) ou, à défaut, par son nom simple. Un nom simple que
 * portent plusieurs dossiers n'est JAMAIS tranché au hasard : le refus liste les
 * chemins possibles. `tous` = l'ensemble où remonter les parents (par défaut,
 * `dossiers` lui-même).
 */
export function chercherDossier<T extends DossierPlat>(
  dossiers: readonly T[],
  cle: string,
  tous: readonly DossierPlat[] = dossiers,
): RechercheDeDossier<T> {
  const brut = (cle ?? '').trim();
  const introuvable = { ok: false as const, raison: `Aucun dossier ne correspond à « ${brut} ».`, candidats: [] };
  if (!brut) return introuvable;
  const parId = dossiers.find((d) => d.id === brut);
  if (parId) return { ok: true, dossier: parId };

  const chemin = (d: T) => cheminTexte(tous, d.id);
  const visees = brut.split(SEPARATEUR_CHEMIN).map((m) => normaliserRecherche(m)).filter(Boolean);
  const normalise = (d: T) => cheminDuDossier(tous, d.id).map((m) => normaliserRecherche(m));

  // Un chemin complet, ou un nom simple dont le chemin est lui-même.
  const exacts = dossiers.filter((d) => {
    const c = normalise(d);
    return c.length === visees.length && c.every((m, i) => m === visees[i]);
  });
  if (exacts.length === 1) return { ok: true, dossier: exacts[0]! };
  if (exacts.length > 1)
    return { ok: false, raison: `Plusieurs dossiers répondent à « ${brut} ».`, candidats: exacts.map(chemin) };

  // Un nom simple : le dernier niveau d'un dossier, où qu'il soit dans l'arbre.
  if (visees.length === 1) {
    const parNom = dossiers.filter((d) => normaliserRecherche(d.nom) === visees[0]);
    if (parNom.length === 1) return { ok: true, dossier: parNom[0]! };
    if (parNom.length > 1)
      return {
        ok: false,
        raison: `Le nom « ${brut} » est porté par plusieurs dossiers : donnez le chemin complet.`,
        candidats: parNom.map(chemin),
      };
  }
  return introuvable;
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
  return minusculesSansAccents(texte ?? '').trim();
}

/**
 * Le texte sur lequel une recherche mord : le nom, le type, le projet, la note
 * et les champs NON secrets. Un mot de passe ne sert pas à retrouver sa propre
 * fiche — et le taper dans une barre de recherche serait le pire endroit où
 * l'écrire.
 */
export function texteCherchable(acces: AccesCoffre, nomProjet?: string, nomDossier?: string): string {
  const morceaux = [acces.nom, LIBELLE_TYPE_ACCES[acces.type] ?? '', nomProjet ?? '', nomDossier ?? '', acces.note];
  for (const champ of champsDuType(acces.type)) {
    if (champ.secret) continue;
    const valeur = acces.champs[champ.cle];
    if (valeur) morceaux.push(valeur);
  }
  for (const libre of acces.champsLibres ?? []) {
    morceaux.push(libre.libelle);
    if (!libre.secret) morceaux.push(libre.valeur);
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
  nomDossier: (dossierId: string | null) => string | undefined = () => undefined,
): AccesCoffre[] {
  const mots = normaliserRecherche(recherche).split(/\s+/).filter(Boolean);
  if (!mots.length) return [...liste];
  return liste.filter((acces) => {
    const texte = texteCherchable(acces, nomProjet(acces.projectId), nomDossier(acces.dossierId ?? null));
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
    case 'compte-bancaire':
    case 'carte-paiement':
      return [c.banque, c.titulaire].filter(Boolean).join(' · ');
    case 'carte-identite':
    case 'passeport':
    case 'permis-conduire':
      return [c.nom, c.expiration ? `expire ${c.expiration}` : ''].filter(Boolean).join(' · ');
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
