import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  BilanImport,
  BilanTable,
  CATEGORIES_EXPORT,
  CategorieExport,
  DOSSIER_BASE,
  DOSSIER_GIT,
  EntreeManifeste,
  FICHIER_MANIFESTE,
  Manifeste,
  POLITIQUE_PAR_DEFAUT,
  PolitiqueConflit,
  VERSION_ARCHIVE,
  categorieDeLaTable,
  cheminDeLaTable,
  colonnesRetenues,
  definitionCategorie,
  dependancesManquantes,
  nomArchive,
  tablesDeLaSelection,
  toutesLesCategories,
  validerManifeste,
} from '@beluga/shared';
import { getDb } from './db.js';
import { CONFIG, PATHS } from './config.js';
import { ecrireArchive, lireZip } from './files.js';
import { manifesteAuxNomsActuels } from './passage-backups.js';
import { markdownDeLaPortee, porteesConnues } from './connaissances.js';
import { log } from './logger.js';

const execFileAsync = promisify(execFile);

/**
 * L'EXPORT ET L'IMPORT INTÉGRAL — le travail réel, celui qui touche la base et
 * le disque. Les règles (catégories, ordre de remontée, validation, politiques
 * de conflit) vivent dans `shared/src/export-donnees.ts` et n'ont besoin de
 * rien pour être testées.
 *
 * TROIS PARTIS PRIS, tenus par `scripts/verif-export-donnees.mjs` :
 *
 *  1. L'ARCHIVE EST LISIBLE. Une table = un fichier JSON, rangé dans le dossier
 *     de sa catégorie. On peut l'ouvrir, en retirer un morceau, la relire des
 *     années plus tard sans Beluga Build. La copie brute de la base ne l'accompagne
 *     que par sécurité — l'import ne la lit jamais.
 *
 *  2. LES COLONNES SE LISENT DANS LA VRAIE BASE, jamais recopiées ici. Une
 *     migration qui ajoute une colonne n'oblige donc à toucher à rien : ni
 *     l'export ni l'import ne connaissent la forme des tables.
 *
 *  3. L'IMPORT NE DÉTRUIT RIEN SANS QU'ON LE DEMANDE. Le défaut garde ce qui
 *     est déjà là ; écraser et vider sont deux choix explicites, et chaque
 *     ligne écrite est comptée dans le compte rendu.
 */

/* ------------------------------------------------------------------ */
/* Ce que la base sait d'elle-même                                     */
/* ------------------------------------------------------------------ */

/** Les tables réellement présentes : une base d'essai n'a pas forcément tout. */
function tablesPresentes(): Set<string> {
  const rows = getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

/** Les colonnes d'une table, lues dans la base et jamais recopiées ici. */
function colonnesDe(table: string): string[] {
  const rows = getDb().prepare(`PRAGMA table_info(${citerTable(table)})`).all() as { name: string }[];
  return rows.map((r) => r.name);
}

/** La clé primaire d'une table, quand elle en a une seule (le cas de toutes). */
function clePrimaireDe(table: string): string | null {
  const rows = getDb().prepare(`PRAGMA table_info(${citerTable(table)})`).all() as { name: string; pk: number }[];
  const cles = rows.filter((r) => r.pk > 0);
  return cles.length === 1 ? cles[0].name : null;
}

/**
 * Un nom de table ne peut JAMAIS venir du dehors : il sort du catalogue de
 * `shared/src/export-donnees.ts`. On le cite quand même entre guillemets, et on
 * refuse tout ce qui n'est pas un mot ordinaire — une garde qui ne coûte rien
 * et qui survivra à un futur nom mal choisi.
 */
function citerTable(table: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) throw new Error(`nom de table refusé : ${table}`);
  return `"${table}"`;
}

/** Combien de lignes une catégorie emporterait, pour l'afficher avant de cocher. */
export function etatDesCategories(): {
  categories: { cle: CategorieExport; libelle: string; description: string; lignes: number; tables: string[] }[];
  origine: string;
} {
  const presentes = tablesPresentes();
  const categories = CATEGORIES_EXPORT.map((categorie) => {
    let lignes = 0;
    const tables: string[] = [];
    for (const table of categorie.tables) {
      if (!presentes.has(table)) continue;
      tables.push(table);
      const row = getDb().prepare(`SELECT COUNT(*) AS n FROM ${citerTable(table)}`).get() as { n: number };
      lignes += row.n;
    }
    // « branches » ne compte pas des lignes de base mais des dépôts git.
    if (categorie.cle === 'branches') lignes = compterProjetsGit();
    return { cle: categorie.cle, libelle: categorie.libelle, description: categorie.description, lignes, tables };
  });
  return { categories, origine: os.hostname() };
}

function compterProjetsGit(): number {
  try {
    const rows = getDb().prepare('SELECT path FROM projects WHERE archived = 0').all() as { path: string }[];
    return rows.filter((r) => fs.existsSync(path.join(r.path, '.git'))).length;
  } catch {
    return 0;
  }
}

/* ------------------------------------------------------------------ */
/* L'export                                                            */
/* ------------------------------------------------------------------ */

/** Les dossiers de fichiers emportés par une catégorie, quand elle en a. */
const FICHIERS_PAR_CATEGORIE: Partial<Record<CategorieExport, { dossier: string; source: string }>> = {
  messages: { dossier: 'attachments', source: 'attachments' },
  cartes: { dossier: 'documents', source: 'documents' },
};

/**
 * Au-delà, les pièces jointes ne partent PAS : une archive de plusieurs
 * gigaoctets ne se télécharge pas depuis un navigateur, et l'utilisateur
 * découvrirait la panne après dix minutes d'attente. Le manifeste dit alors en
 * clair ce qui a été laissé.
 */
const PLAFOND_FICHIERS_OCTETS = 200 * 1024 * 1024;

export async function exporterDonnees(
  selection: readonly string[] = toutesLesCategories(),
): Promise<{ ok: true; file: string; name: string; size: number; manifeste: Manifeste } | { ok: false; erreur: string }> {
  try {
    const gardees = CATEGORIES_EXPORT.map((c) => c.cle).filter((cle) => selection.includes(cle));
    if (!gardees.length) return { ok: false, erreur: 'Aucune catégorie sélectionnée : il n’y a rien à exporter.' };

    const presentes = tablesPresentes();
    const entrees: { name: string; data: Buffer }[] = [];
    const tables: EntreeManifeste[] = [];

    for (const table of tablesDeLaSelection(gardees)) {
      if (!presentes.has(table)) continue;
      const lignes = getDb().prepare(`SELECT * FROM ${citerTable(table)}`).all() as Record<string, unknown>[];
      const contenu = Buffer.from(
        `${JSON.stringify({ table, colonnes: colonnesDe(table), lignes }, null, 1)}\n`,
        'utf8',
      );
      const chemin = cheminDeLaTable(table);
      entrees.push({ name: chemin, data: contenu });
      tables.push({
        table,
        categorie: categorieDeLaTable(table) as CategorieExport,
        chemin,
        lignes: lignes.length,
        empreinte: crypto.createHash('sha256').update(contenu).digest('hex'),
      });
    }

    // Les fichiers qui accompagnent les lignes : sans eux, une pièce jointe
    // remontée n'est qu'un nom qui ne s'ouvre pas.
    const laissesDeCote: string[] = [];
    for (const categorie of gardees) {
      const bloc = FICHIERS_PAR_CATEGORIE[categorie];
      if (!bloc) continue;
      const source = path.join(CONFIG.dataDir, bloc.source);
      if (!fs.existsSync(source)) continue;
      // Pesé AVANT d'être lu : les pièces jointes comptent des vidéos de 2 Go,
      // qu'il ne faut jamais charger en mémoire pour découvrir qu'elles restent.
      const poids = poidsDuDossier(source);
      if (poids > PLAFOND_FICHIERS_OCTETS) {
        laissesDeCote.push(`${bloc.dossier} (${Math.round(poids / 1024 / 1024)} Mo)`);
        continue;
      }
      entrees.push(...ramasserFichiers(source, `fichiers/${bloc.dossier}`));
    }

    // La mémoire se relit HORS de l'application : un rendu Markdown par portée,
    // à côté du JSON. L'import ne le lit pas — il ne sert qu'à l'œil.
    if (gardees.includes('memoire') && presentes.has('connaissances')) {
      for (const portee of porteesConnues()) {
        const nom = portee.replace(/[^a-zA-Z0-9_-]+/g, '-');
        entrees.push({ name: `lisible/memoire/${nom}.md`, data: Buffer.from(markdownDeLaPortee(portee), 'utf8') });
      }
    }

    // Les dépôts git : leur état, projet par projet, plus un script de reprise.
    const git: Manifeste['git'] = [];
    if (gardees.includes('branches')) {
      for (const etat of await etatsGitDesProjets()) {
        const chemin = `${DOSSIER_GIT}/${etat.projet}.json`;
        entrees.push({ name: chemin, data: Buffer.from(`${JSON.stringify(etat, null, 1)}\n`, 'utf8') });
        git.push({ projet: etat.projet, nom: etat.nom, chemin });
      }
    }

    const manifeste: Manifeste = {
      version: VERSION_ARCHIVE,
      outil: 'beluga',
      versionOutil: CONFIG.version,
      creeLe: Date.now(),
      origine: os.hostname(),
      categories: gardees,
      tables,
      git,
    };

    // La copie brute de la base, seulement quand TOUT est emporté : à moitié,
    // elle dirait le contraire de la sélection qu'on vient de faire.
    if (gardees.length === CATEGORIES_EXPORT.length) {
      const copie = copierLaBase();
      if (copie) {
        entrees.push({ name: `${DOSSIER_BASE}/beluga.db`, data: copie });
        manifeste.base = { chemin: `${DOSSIER_BASE}/beluga.db`, octets: copie.length };
      }
    }

    entrees.unshift({
      name: FICHIER_MANIFESTE,
      data: Buffer.from(`${JSON.stringify({ ...manifeste, fichiersLaissesDeCote: laissesDeCote }, null, 1)}\n`, 'utf8'),
    });
    entrees.push({ name: 'LISEZ-MOI.md', data: Buffer.from(lisezMoi(manifeste, laissesDeCote), 'utf8') });

    const archive = ecrireArchive(entrees, nomArchive());
    log.info(`export des données : ${archive.name} (${gardees.join(', ')}, ${archive.size} octets)`);
    return { ok: true, ...archive, manifeste };
  } catch (err: any) {
    log.error('export des données impossible', err);
    return { ok: false, erreur: err?.message ?? String(err) };
  }
}

/** La base copiée À CHAUD, cohérente même pendant les écritures — comme la sauvegarde. */
function copierLaBase(): Buffer | null {
  const temp = path.join(PATHS.archives, `base-${crypto.randomBytes(6).toString('hex')}.db`);
  try {
    fs.mkdirSync(PATHS.archives, { recursive: true });
    getDb().exec(`VACUUM INTO '${temp.replace(/'/g, "''")}'`);
    return fs.readFileSync(temp);
  } catch (err: any) {
    log.warn('copie brute de la base sautée', err?.message ?? err);
    return null;
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

function poidsDuDossier(dossier: string): number {
  let total = 0;
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    const chemin = path.join(dossier, entree.name);
    try {
      if (entree.isDirectory()) total += poidsDuDossier(chemin);
      else if (entree.isFile()) total += fs.statSync(chemin).size;
    } catch {
      /* fichier disparu entre-temps */
    }
  }
  return total;
}

function ramasserFichiers(racine: string, prefixe: string, relatif = ''): { name: string; data: Buffer }[] {
  const sortie: { name: string; data: Buffer }[] = [];
  const complet = path.join(racine, relatif);
  if (!fs.existsSync(complet)) return sortie;
  for (const entree of fs.readdirSync(complet, { withFileTypes: true })) {
    const sous = path.posix.join(relatif.replace(/\\/g, '/'), entree.name);
    if (entree.isDirectory()) {
      sortie.push(...ramasserFichiers(racine, prefixe, sous));
    } else if (entree.isFile()) {
      try {
        sortie.push({ name: `${prefixe}/${sous}`, data: fs.readFileSync(path.join(racine, sous)) });
      } catch {
        /* fichier disparu entre-temps */
      }
    }
  }
  return sortie;
}

/* ------------------------------------------------------------------ */
/* L'état git de chaque projet                                         */
/* ------------------------------------------------------------------ */

export interface EtatGitProjet {
  projet: string;
  nom: string;
  chemin: string;
  origine: string;
  brancheCourante: string;
  branches: { nom: string; commit: string; date: string; sujet: string }[];
}

async function etatsGitDesProjets(): Promise<EtatGitProjet[]> {
  const projets = getDb().prepare('SELECT id, name, path FROM projects').all() as { id: string; name: string; path: string }[];
  const etats: EtatGitProjet[] = [];
  for (const projet of projets) {
    if (!fs.existsSync(path.join(projet.path, '.git'))) continue;
    try {
      const lire = async (args: string[]) =>
        (await execFileAsync('git', args, { cwd: projet.path, timeout: 20000, maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
      const origine = await lire(['remote', 'get-url', 'origin']).catch(() => '');
      const brancheCourante = await lire(['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '');
      const brut = await lire([
        'for-each-ref',
        '--format=%(refname:short)\t%(objectname)\t%(committerdate:iso-strict)\t%(contents:subject)',
        'refs/heads',
        'refs/remotes',
      ]).catch(() => '');
      const branches = brut
        .split('\n')
        .filter(Boolean)
        .map((ligne) => {
          const [nom, commit, date, ...reste] = ligne.split('\t');
          return { nom, commit, date, sujet: reste.join('\t') };
        });
      etats.push({ projet: projet.id, nom: projet.name, chemin: projet.path, origine, brancheCourante, branches });
    } catch (err: any) {
      log.warn(`état git illisible pour ${projet.name}`, err?.message ?? err);
    }
  }
  return etats;
}

function lisezMoi(manifeste: Manifeste, laissesDeCote: string[]): string {
  const lignes = [
    '# Archive de données Beluga Build',
    '',
    `Écrite le ${new Date(manifeste.creeLe).toISOString()} depuis « ${manifeste.origine} », version ${manifeste.versionOutil}.`,
    '',
    '## Ce qu’il y a dedans',
    '',
    '- `manifeste.json` : la liste des tables, leur nombre de lignes et leur empreinte.',
    '- `donnees/<catégorie>/<table>.json` : une table par fichier, colonnes et lignes.',
    '- `fichiers/` : les pièces jointes et les documents qui accompagnent les lignes.',
    '- `git/<projet>.json` : le dépôt d’origine et toutes les branches de chaque projet.',
    manifeste.base ? '- `base/beluga.db` : la base entière, copiée à chaud. L’import ne la lit pas.' : '',
    '',
    '## Comment la remonter',
    '',
    'Réglages → Système → « Export et import des données » → onglet « Importer ».',
    'Déposez ce fichier, choisissez les catégories, puis lancez l’import.',
    '',
    '## Les valeurs sensibles',
    '',
    'Elles sont EN CLAIR : une archive de déménagement dont les accès ne se relisent pas ne déménage rien.',
    laissesDeCote.length ? `\n## Laissé de côté\n\n- ${laissesDeCote.join('\n- ')} : trop volumineux pour une archive téléchargeable.` : '',
    '',
    '## Catégories emportées',
    '',
    ...manifeste.categories.map((cle) => `- ${definitionCategorie(cle)?.libelle ?? cle}`),
    '',
  ];
  return lignes.filter((l) => l !== '').join('\n');
}

/* ------------------------------------------------------------------ */
/* La relecture d'une archive                                          */
/* ------------------------------------------------------------------ */

export interface ApercuArchive {
  ok: boolean;
  raison?: string;
  manifeste?: Manifeste;
  /** Ce que chaque catégorie de l'archive apporterait, en nombre de lignes. */
  contenu?: { cle: CategorieExport; libelle: string; lignes: number }[];
  /** Les fichiers dont l'empreinte ne correspond plus : l'archive a bougé. */
  abimes?: string[];
}

/** Ouvre l'archive, valide son manifeste et vérifie l'empreinte de chaque table. */
export function examinerArchive(buffer: Buffer): ApercuArchive {
  let fichiers: Map<string, Buffer>;
  try {
    fichiers = lireZip(buffer);
  } catch (err: any) {
    return { ok: false, raison: err?.message ?? String(err) };
  }

  const brut = fichiers.get(FICHIER_MANIFESTE);
  if (!brut) return { ok: false, raison: 'Archive sans manifeste : impossible de savoir ce qu’elle contient.' };

  let juge: ReturnType<typeof validerManifeste>;
  try {
    // Une archive d'avant le passage aux backups est relue sous les noms d'aujourd'hui.
    juge = validerManifeste(manifesteAuxNomsActuels(JSON.parse(brut.toString('utf8'))));
  } catch {
    return { ok: false, raison: 'Manifeste illisible : le fichier a été modifié ou tronqué.' };
  }
  if (!juge.ok) return { ok: false, raison: juge.raison };

  const abimes: string[] = [];
  const parCategorie = new Map<CategorieExport, number>();
  for (const entree of juge.manifeste.tables) {
    const contenu = fichiers.get(entree.chemin);
    if (!contenu) {
      abimes.push(entree.chemin);
      continue;
    }
    if (crypto.createHash('sha256').update(contenu).digest('hex') !== entree.empreinte) abimes.push(entree.chemin);
    parCategorie.set(entree.categorie, (parCategorie.get(entree.categorie) ?? 0) + entree.lignes);
  }
  if (juge.manifeste.git.length) {
    parCategorie.set('branches', juge.manifeste.git.length);
  }

  return {
    ok: true,
    manifeste: juge.manifeste,
    contenu: juge.manifeste.categories.map((cle) => ({
      cle,
      libelle: definitionCategorie(cle)?.libelle ?? cle,
      lignes: parCategorie.get(cle) ?? 0,
    })),
    abimes,
  };
}

/* ------------------------------------------------------------------ */
/* L'import                                                            */
/* ------------------------------------------------------------------ */

export function importerDonnees(
  buffer: Buffer,
  selection: readonly string[],
  politique: PolitiqueConflit = POLITIQUE_PAR_DEFAUT,
): BilanImport {
  const vide: BilanImport = { ok: false, categories: [], politique, tables: [], git: [], manquantes: [] };

  const apercu = examinerArchive(buffer);
  if (!apercu.ok || !apercu.manifeste) return { ...vide, erreur: apercu.raison };
  if (apercu.abimes?.length) {
    return { ...vide, erreur: `Archive abîmée : ${apercu.abimes.length} fichier(s) ne correspondent plus à leur empreinte.` };
  }

  const fichiers = lireZip(buffer);
  const gardees = CATEGORIES_EXPORT.map((c) => c.cle).filter(
    (cle) => selection.includes(cle) && apercu.manifeste!.categories.includes(cle),
  );
  if (!gardees.length) return { ...vide, erreur: 'Aucune catégorie commune entre l’archive et ce qui est demandé.' };

  const presentes = tablesPresentes();
  const bilans: BilanTable[] = [];
  const db = getDb();

  // TOUT OU RIEN : un import à moitié fait laisserait des cartes sans projet.
  // Une seule transaction, et la base revient d'elle-même à son état d'avant si
  // quoi que ce soit tombe en chemin.
  const remonter = db.transaction(() => {
    for (const table of tablesDeLaSelection(gardees)) {
      if (!presentes.has(table)) continue;
      const entree = apercu.manifeste!.tables.find((t) => t.table === table);
      if (!entree) continue;
      const contenu = fichiers.get(entree.chemin);
      if (!contenu) continue;

      const bloc = JSON.parse(contenu.toString('utf8')) as { colonnes: string[]; lignes: Record<string, unknown>[] };
      const tri = colonnesRetenues(bloc.colonnes ?? [], colonnesDe(table));
      const bilan: BilanTable = {
        table,
        lues: bloc.lignes?.length ?? 0,
        ajoutees: 0,
        remplacees: 0,
        ignorees: 0,
        refusees: 0,
        colonnesIgnorees: tri.ignorees,
      };

      if (!tri.gardees.length || !bloc.lignes?.length) {
        bilans.push(bilan);
        continue;
      }

      if (politique === 'remettre-a-zero') db.prepare(`DELETE FROM ${citerTable(table)}`).run();

      const cle = clePrimaireDe(table);
      const colonnes = tri.gardees.map((c) => `"${c}"`).join(', ');
      const trous = tri.gardees.map(() => '?').join(', ');
      const verbe = politique === 'remplacer' ? 'INSERT OR REPLACE' : 'INSERT OR IGNORE';
      const ecrire = db.prepare(`${verbe} INTO ${citerTable(table)} (${colonnes}) VALUES (${trous})`);
      const existe = cle ? db.prepare(`SELECT 1 FROM ${citerTable(table)} WHERE "${cle}" = ?`) : null;

      for (const ligne of bloc.lignes) {
        const deja = existe && ligne[cle!] !== undefined ? Boolean(existe.get(ligne[cle!] as never)) : false;
        if (deja && politique === 'ignorer') {
          bilan.ignorees++;
          continue;
        }
        try {
          ecrire.run(tri.gardees.map((c) => aplatir(ligne[c])));
          if (deja) bilan.remplacees++;
          else bilan.ajoutees++;
        } catch (err: any) {
          bilan.refusees++;
          if (!bilan.raison) bilan.raison = err?.message ?? String(err);
        }
      }
      bilans.push(bilan);
    }
  });

  try {
    remonter();
  } catch (err: any) {
    log.error('import des données annulé', err);
    return { ...vide, erreur: err?.message ?? String(err), tables: bilans };
  }

  // Les fichiers qui accompagnent les lignes, remis en place sans jamais
  // écraser : un fichier porte le même nom que celui qu'il remplacerait.
  for (const categorie of gardees) {
    const bloc = FICHIERS_PAR_CATEGORIE[categorie];
    if (!bloc) continue;
    for (const [nom, data] of fichiers) {
      if (!nom.startsWith(`fichiers/${bloc.dossier}/`)) continue;
      const relatif = nom.slice(`fichiers/${bloc.dossier}/`.length);
      const cible = path.join(CONFIG.dataDir, bloc.source, relatif);
      if (!cible.startsWith(path.join(CONFIG.dataDir, bloc.source) + path.sep)) continue;
      if (fs.existsSync(cible)) continue;
      fs.mkdirSync(path.dirname(cible), { recursive: true });
      fs.writeFileSync(cible, data);
    }
  }

  const git = gardees.includes('branches') ? deposerEtatsGit(apercu.manifeste, fichiers) : [];

  log.info(`import des données : ${gardees.join(', ')} — politique « ${politique} »`);
  return {
    ok: true,
    categories: gardees,
    politique,
    tables: bilans,
    git,
    manquantes: dependancesManquantes(gardees),
  };
}

/** SQLite ne sait écrire ni objet ni booléen : on les rend tels qu'ils sortiront. */
function aplatir(valeur: unknown): unknown {
  if (valeur === undefined) return null;
  if (typeof valeur === 'boolean') return valeur ? 1 : 0;
  if (valeur !== null && typeof valeur === 'object') return JSON.stringify(valeur);
  return valeur;
}

/**
 * LES DÉPÔTS GIT NE SE RECLONENT PAS TOUT SEULS : cloner des dizaines de
 * dépôts sans qu'on l'ait demandé remplirait le disque du serveur neuf et
 * pourrait écraser un dossier de travail. L'import DÉPOSE donc l'état de chaque
 * dépôt et un script de reprise, prêt à lire et à lancer à la main.
 */
function deposerEtatsGit(manifeste: Manifeste, fichiers: Map<string, Buffer>): string[] {
  const dossier = path.join(CONFIG.dataDir, 'import-git');
  fs.mkdirSync(dossier, { recursive: true });
  const deposes: string[] = [];
  const commandes: string[] = ['#!/usr/bin/env bash', '# Reprise des dépôts d’une archive Beluga Build.', 'set -euo pipefail', ''];

  for (const entree of manifeste.git) {
    const contenu = fichiers.get(entree.chemin);
    if (!contenu) continue;
    const cible = path.join(dossier, `${entree.projet}.json`);
    fs.writeFileSync(cible, contenu);
    deposes.push(entree.nom);
    try {
      const etat = JSON.parse(contenu.toString('utf8')) as EtatGitProjet;
      if (!etat.origine) {
        commandes.push(`# ${etat.nom} : aucun dépôt d’origine connu — à recopier à la main vers ${etat.chemin}`, '');
        continue;
      }
      commandes.push(
        `# ${etat.nom} — ${etat.branches.length} branche(s), branche courante « ${etat.brancheCourante} »`,
        `[ -d ${JSON.stringify(etat.chemin)} ] || git clone ${JSON.stringify(etat.origine)} ${JSON.stringify(etat.chemin)}`,
        `git -C ${JSON.stringify(etat.chemin)} fetch --all --prune`,
        '',
      );
    } catch {
      /* fichier d'état illisible : il reste déposé tel quel */
    }
  }

  const script = path.join(dossier, 'reprendre-les-depots.sh');
  fs.writeFileSync(script, `${commandes.join('\n')}\n`, { mode: 0o755 });
  return deposes;
}

/* ------------------------------------------------------------------ */
/* L'archive DÉPOSÉE, en attendant qu'on décide de l'importer          */
/* ------------------------------------------------------------------ */

/**
 * Une archive arrive par le tuyau HTTP (elle est binaire), mais l'import se
 * décide APRÈS l'avoir regardée — cases décochées, politique choisie. On ne la
 * fait donc pas remonter deux fois : elle est posée dans les archives
 * temporaires, sous un jeton, et `purgeOldArchives` l'y efface au bout de 24 h
 * comme n'importe quelle autre.
 */
export function deposerArchive(buffer: Buffer): string {
  fs.mkdirSync(PATHS.archives, { recursive: true });
  const jeton = crypto.randomBytes(12).toString('hex');
  fs.writeFileSync(path.join(PATHS.archives, `depot-${jeton}.zip`), buffer);
  return jeton;
}

/** L'archive déposée, ou rien si le jeton est faux ou l'archive déjà effacée. */
export function lireDepot(jeton: string): Buffer | null {
  if (!/^[0-9a-f]{24}$/.test(jeton)) return null;
  const fichier = path.join(PATHS.archives, `depot-${jeton}.zip`);
  return fs.existsSync(fichier) ? fs.readFileSync(fichier) : null;
}
