/**
 * L'EXPORT ET L'IMPORT INTÉGRAL DES DONNÉES — déménager Beluga Build d'un serveur
 * à l'autre sans rien laisser derrière.
 *
 * Une sauvegarde (`server/src/backup.ts`) répond à « la machine a brûlé, on
 * remonte la même » : elle copie la base telle quelle, tout ou rien, et se
 * remonte sur un serveur JUMEAU. Elle ne répond pas à « j'installe Beluga Build
 * ailleurs et je veux y retrouver mes accès, mes projets et mes cartes » : ni
 * choix de ce qu'on emporte, ni fusion avec ce qui existe déjà en face.
 *
 * L'export est donc un ARCHIVE ZIP LISIBLE, rangée par CATÉGORIES : chaque
 * table part en JSON, une catégorie par dossier, avec un MANIFESTE qui dit ce
 * qu'il y a dedans, combien de lignes, et l'empreinte de chaque fichier. On
 * peut l'ouvrir, la lire, en retirer un morceau. Un copie brute de la base
 * (`base/beluga.db`) l'accompagne quand TOUT est emporté, pour qui préfère
 * repartir du fichier d'origine — l'import, lui, ne lit QUE le JSON.
 *
 * CE FICHIER NE TOUCHE NI BASE NI DISQUE : il ne dit que les règles — quelles
 * catégories existent, ce que chacune emporte, dans quel ORDRE les tables se
 * remontent (les projets avant les cartes, les cartes avant les messages), à
 * quoi ressemble un manifeste valable, et ce qu'on fait d'une ligne déjà là.
 * Le travail réel vit dans `server/src/export-donnees.ts`.
 *
 * LES VALEURS SENSIBLES RESTENT EN CLAIR, à dessein : une archive de
 * déménagement dont les accès ne se relisent pas ne déménage rien. C'est la
 * même décision que celle du coffre-fort (`shared/src/coffre-fort.ts`).
 */

/** La version du format d'archive. Une archive d'une autre version est refusée. */
export const VERSION_ARCHIVE = 1;

/** Le nom du fichier qui décrit l'archive, à sa racine. */
export const FICHIER_MANIFESTE = 'manifeste.json';

/** Le dossier des tables exportées en JSON, une par fichier. */
export const DOSSIER_DONNEES = 'donnees';

/** Le dossier de la copie brute de la base, présente quand tout est emporté. */
export const DOSSIER_BASE = 'base';

/** Le dossier des états git, un fichier par projet. */
export const DOSSIER_GIT = 'git';

/** Les catégories exportables, telles qu'elles s'affichent en cases à cocher. */
export type CategorieExport =
  | 'projets'
  | 'cartes'
  | 'messages'
  | 'historique'
  | 'coffre-fort'
  | 'memoire'
  | 'backups'
  | 'surveillance'
  | 'reglages'
  | 'notes'
  | 'branches';

/** Ce qu'une catégorie emporte, et ce qu'on en dit à l'écran. */
export interface DefinitionCategorie {
  cle: CategorieExport;
  /** Le libellé français ; l'interface le traduit, comme ceux du coffre-fort. */
  libelle: string;
  /** Une phrase qui dit ce qu'on emporte, en français d'utilisateur. */
  description: string;
  /**
   * Les tables de la base emportées par cette catégorie. Vide pour « branches »,
   * qui ne lit pas la base mais les dépôts git des projets.
   */
  tables: readonly string[];
  /**
   * Les catégories dont celle-ci a besoin pour être remontée d'aplomb : une
   * carte sans son projet ne s'affiche nulle part. On ne les coche pas de
   * force — on le DIT, et l'import le redit dans son compte rendu.
   */
  besoinDe: readonly CategorieExport[];
}

/**
 * LE CATALOGUE DES CATÉGORIES, dans l'ordre d'affichage ET dans l'ordre de
 * REMONTÉE : les projets d'abord, puis ce qui s'y accroche. Cet ordre n'est pas
 * cosmétique — c'est lui qui évite qu'une carte arrive avant son projet.
 */
export const CATEGORIES_EXPORT: readonly DefinitionCategorie[] = [
  {
    cle: 'reglages',
    libelle: 'Réglages et comptes',
    description: 'Les réglages du système, les préférences d’affichage, les comptes moteur et les clés d’accès.',
    tables: ['meta', 'preferences', 'accounts', 'api_keys', 'push_subs', 'quota_profile'],
    besoinDe: [],
  },
  {
    cle: 'projets',
    libelle: 'Projets et groupes',
    description: 'La liste des projets pilotés, leurs réglages propres et les groupes de la colonne de gauche.',
    tables: ['projects', 'project_groups'],
    besoinDe: [],
  },
  {
    cle: 'cartes',
    libelle: 'Cartes du tableau',
    description: 'Toutes les cartes de tous les tableaux, avec leurs étiquettes, leurs commentaires et les propositions en attente.',
    tables: ['cards', 'card_labels', 'card_comments', 'card_attachments', 'proposals'],
    besoinDe: ['projets'],
  },
  {
    cle: 'messages',
    libelle: 'Conversations',
    description: 'Les fils de discussion avec les agents, leurs messages, leur file d’attente et les pièces jointes.',
    tables: ['agents', 'messages', 'queue', 'attachments', 'dictees'],
    besoinDe: ['projets'],
  },
  {
    cle: 'historique',
    libelle: 'Historique et mesures',
    description: 'Les mises en ligne passées, la consommation, les quotas mesurés et les journaux d’analyse.',
    tables: [
      'deploys',
      'usage',
      'capacity_samples',
      'quota_samples',
      'amorce_log',
      'telemetrie_tache',
      'competence_stats',
      'memoire_consultation',
    ],
    besoinDe: ['projets'],
  },
  {
    cle: 'notes',
    libelle: 'Notes',
    description: 'Les notes de tous les projets, avec leur échéance, leur importance et leurs pièces jointes.',
    tables: ['notes'],
    besoinDe: ['projets'],
  },
  {
    cle: 'coffre-fort',
    // Les IMAGES des fiches ne partent pas avec cette catégorie : l'export
    // n'emporte que des tables, jamais les fichiers des pièces jointes. La
    // colonne `images` voyage, et une image absente à l'arrivée est
    // simplement ignorée (`imagesDesAcces`, `server/src/coffre-fort.ts`).
    libelle: 'Coffre-fort',
    description: 'Tous les accès rangés dans le coffre-fort, valeurs comprises.',
    tables: ['secrets'],
    besoinDe: [],
  },
  {
    cle: 'memoire',
    libelle: 'Mémoire',
    description: 'La base de connaissances : les unités du Global et de chaque projet, leurs versions, les propositions refusées, le changelog de chaque projet et les rapports de génération, avec un rendu lisible par portée.',
    // Les index de recherche et les vecteurs ne partent pas : les déclencheurs et la nuit les refont à la remontée.
    tables: ['connaissances', 'connaissance_compteurs', 'connaissance_versions', 'connaissance_refus', 'connaissance_generations', 'changelog_entrees'],
    besoinDe: [],
  },
  {
    cle: 'backups',
    libelle: 'Backups',
    description: 'Les sites configurés pour être sauvegardés et la liste de leurs points de restauration.',
    tables: ['backup_sites', 'backup_points'],
    besoinDe: [],
  },
  {
    cle: 'surveillance',
    libelle: 'Sites surveillés',
    description: 'Les surveillances, leur recette de contrôle et l’historique de leurs passages des dernières 24 heures.',
    tables: ['sites_surveilles', 'controles_surveillance'],
    besoinDe: [],
  },
  {
    cle: 'branches',
    libelle: 'Branches et dépôts git',
    description: 'Pour chaque projet : son dépôt d’origine, sa branche courante et toutes ses branches avec leur dernier enregistrement.',
    tables: [],
    besoinDe: ['projets'],
  },
];

/** Toutes les catégories, cochées : c'est l'état de départ du tiroir. */
export function toutesLesCategories(): CategorieExport[] {
  return CATEGORIES_EXPORT.map((c) => c.cle);
}

/** La définition d'une catégorie, ou rien si le mot ne veut rien dire ici. */
export function definitionCategorie(cle: string): DefinitionCategorie | undefined {
  return CATEGORIES_EXPORT.find((c) => c.cle === cle);
}

/**
 * Les tables à parcourir pour une sélection, DANS L'ORDRE DE REMONTÉE et sans
 * doublon. Une table nommée par deux catégories n'est écrite qu'une fois.
 */
export function tablesDeLaSelection(selection: readonly string[]): string[] {
  const gardees = new Set(selection);
  const tables: string[] = [];
  for (const categorie of CATEGORIES_EXPORT) {
    if (!gardees.has(categorie.cle)) continue;
    for (const table of categorie.tables) {
      if (!tables.includes(table)) tables.push(table);
    }
  }
  return tables;
}

/** À quelle catégorie appartient une table, pour ranger l'archive en dossiers. */
export function categorieDeLaTable(table: string): CategorieExport | undefined {
  return CATEGORIES_EXPORT.find((c) => c.tables.includes(table))?.cle;
}

/** Le chemin d'une table dans l'archive, dossier de catégorie compris. */
export function cheminDeLaTable(table: string): string {
  const categorie = categorieDeLaTable(table) ?? 'divers';
  return `${DOSSIER_DONNEES}/${categorie}/${table}.json`;
}

/**
 * CE QUI MANQUE À UNE SÉLECTION pour tenir debout : les catégories dont une
 * catégorie cochée a besoin et qui, elles, ne le sont pas. On ne coche rien de
 * force — l'utilisateur reste maître de ce qu'il emporte, on lui dit juste ce
 * qui arrivera orphelin.
 */
export function dependancesManquantes(selection: readonly string[]): CategorieExport[] {
  const gardees = new Set(selection);
  const manquantes = new Set<CategorieExport>();
  for (const categorie of CATEGORIES_EXPORT) {
    if (!gardees.has(categorie.cle)) continue;
    for (const besoin of categorie.besoinDe) {
      if (!gardees.has(besoin)) manquantes.add(besoin);
    }
  }
  return [...manquantes];
}

/** Une table telle que le manifeste la décrit. */
export interface EntreeManifeste {
  table: string;
  categorie: CategorieExport;
  chemin: string;
  lignes: number;
  /** L'empreinte SHA-256 du fichier JSON, pour prouver qu'il n'a pas bougé. */
  empreinte: string;
}

/** La carte d'identité d'une archive, à sa racine. */
export interface Manifeste {
  version: number;
  /** Le nom de l'outil, pour ne pas confondre avec l'archive d'un autre logiciel. */
  outil: 'beluga';
  /** La version de Beluga Build qui a écrit l'archive, à titre indicatif. */
  versionOutil: string;
  creeLe: number;
  /** Le nom de la machine d'origine, pour s'y retrouver entre deux archives. */
  origine: string;
  categories: CategorieExport[];
  tables: EntreeManifeste[];
  /** Un fichier par projet dans `git/`, présent seulement avec « branches ». */
  git: { projet: string; nom: string; chemin: string }[];
  /** La copie brute de la base, présente seulement si TOUT a été emporté. */
  base?: { chemin: string; octets: number };
}

/**
 * CE QU'ON FAIT D'UNE LIGNE DÉJÀ PRÉSENTE. Le choix est le même pour toute
 * l'archive : mélanger les politiques d'une table à l'autre ferait des états
 * que personne ne saurait relire.
 *
 *  - `ignorer` : la ligne d'ici gagne, celle de l'archive est sautée. C'est le
 *    défaut, et le seul qui ne peut rien détruire.
 *  - `remplacer` : la ligne de l'archive écrase celle d'ici, à identifiant égal.
 *  - `remettre-a-zero` : la table est VIDÉE avant d'écrire. Le déménagement
 *    complet sur un serveur neuf, quand on veut l'état d'en face à l'identique.
 */
export type PolitiqueConflit = 'ignorer' | 'remplacer' | 'remettre-a-zero';

export const POLITIQUE_PAR_DEFAUT: PolitiqueConflit = 'ignorer';

/** Le libellé français de chaque politique — l'interface le traduit. */
export const LIBELLE_POLITIQUE: Readonly<Record<PolitiqueConflit, string>> = {
  ignorer: 'Garder ce qui est déjà ici',
  remplacer: 'Écraser avec l’archive',
  'remettre-a-zero': 'Vider puis remplir avec l’archive',
};

/** Ce qu'une politique fait, en une phrase — l'interface la traduit aussi. */
export const EXPLICATION_POLITIQUE: Readonly<Record<PolitiqueConflit, string>> = {
  ignorer: 'Une fiche portant le même identifiant est laissée telle quelle. Rien ne peut être perdu.',
  remplacer: 'Une fiche portant le même identifiant est remplacée par celle de l’archive.',
  'remettre-a-zero': 'Chaque table emportée est vidée avant d’être remplie. À réserver à un serveur neuf.',
};

/** Le résultat de la relecture d'une table, ligne par ligne. */
export interface BilanTable {
  table: string;
  lues: number;
  ajoutees: number;
  remplacees: number;
  ignorees: number;
  /** Les lignes refusées par la base, avec la raison de la première. */
  refusees: number;
  raison?: string;
  /** Les colonnes de l'archive absentes d'ici : elles sont laissées de côté. */
  colonnesIgnorees: string[];
}

/** Le compte rendu complet d'un import. */
export interface BilanImport {
  ok: boolean;
  erreur?: string;
  categories: CategorieExport[];
  politique: PolitiqueConflit;
  tables: BilanTable[];
  /** Les états git remontés : ils s'écrivent en documents, jamais en base. */
  git: string[];
  manquantes: CategorieExport[];
}

/**
 * UNE ARCHIVE SE VALIDE AVANT D'ÊTRE OUVERTE. Trois choses la disqualifient :
 * ce n'est pas une archive Beluga Build, sa version n'est pas celle qu'on sait
 * lire, ou son manifeste ne décrit rien. Le refus est rendu EN CLAIR — c'est la
 * phrase que l'écran affiche.
 */
export function validerManifeste(brut: unknown): { ok: true; manifeste: Manifeste } | { ok: false; raison: string } {
  if (!brut || typeof brut !== 'object') {
    return { ok: false, raison: 'Ce fichier n’est pas une archive Beluga Build : son manifeste est illisible.' };
  }
  const m = brut as Partial<Manifeste>;
  if (m.outil !== 'beluga') {
    return { ok: false, raison: 'Ce fichier n’est pas une archive Beluga Build.' };
  }
  if (m.version !== VERSION_ARCHIVE) {
    return {
      ok: false,
      raison: `Archive en version ${String(m.version ?? '?')}, or cette installation lit la version ${VERSION_ARCHIVE}.`,
    };
  }
  if (!Array.isArray(m.tables) || !Array.isArray(m.categories)) {
    return { ok: false, raison: 'Manifeste incomplet : l’archive ne dit pas ce qu’elle contient.' };
  }
  return {
    ok: true,
    manifeste: {
      version: m.version,
      outil: 'beluga',
      versionOutil: typeof m.versionOutil === 'string' ? m.versionOutil : '?',
      creeLe: typeof m.creeLe === 'number' ? m.creeLe : 0,
      origine: typeof m.origine === 'string' ? m.origine : '?',
      categories: m.categories.filter((c): c is CategorieExport => Boolean(definitionCategorie(String(c)))),
      tables: m.tables.filter((t): t is EntreeManifeste => Boolean(t && typeof (t as EntreeManifeste).table === 'string')),
      git: Array.isArray(m.git) ? m.git : [],
      base: m.base,
    },
  };
}

/**
 * LES COLONNES RÉELLEMENT REMONTABLES : celles que l'archive apporte ET que la
 * base d'ici connaît. Une archive écrite par une version plus récente peut
 * porter une colonne qui n'existe pas encore ici — on la laisse de côté au lieu
 * de faire tomber tout l'import sur un « no such column ».
 */
export function colonnesRetenues(
  colonnesArchive: readonly string[],
  colonnesIci: readonly string[],
): { gardees: string[]; ignorees: string[] } {
  const connues = new Set(colonnesIci);
  const gardees = colonnesArchive.filter((c) => connues.has(c));
  const ignorees = colonnesArchive.filter((c) => !connues.has(c));
  return { gardees, ignorees };
}

/** Le nom de fichier proposé au téléchargement, daté à la minute. */
export function nomArchive(date = new Date()): string {
  const stamp = date.toISOString().replace(/[:.]/g, '-').slice(0, 16);
  return `beluga-donnees-${stamp}.zip`;
}
