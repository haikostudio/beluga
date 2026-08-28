#!/usr/bin/env node
/**
 * L'EXPORT ET L'IMPORT INTÉGRAL DES DONNÉES — l'aller-retour, pour de vrai.
 *
 * Une fonction d'export qu'on ne réimporte jamais n'existe pas : c'est la même
 * règle que celle de la sauvegarde, qui est REMONTÉE avant d'être déclarée
 * bonne. Ce contrôle monte donc DEUX installations à part — deux bases neuves,
 * deux dossiers de données, aucun démon, aucun moteur appelé, aucun quota
 * dépensé — écrit des données dans la première, l'exporte, et la remonte dans
 * la seconde.
 *
 * Ce qu'il vérifie, dans l'ordre :
 *
 *  1. L'ARCHIVE EST LISIBLE : c'est un vrai ZIP, avec son manifeste, un fichier
 *     JSON par table et l'état git de chaque projet.
 *  2. TOUT ARRIVE EN FACE : projets, cartes, messages, coffre-fort, snapshots,
 *     sites surveillés — les mêmes nombres des deux côtés.
 *  3. REJOUER L'IMPORT NE FABRIQUE PAS DE DOUBLON : le second passage ne fait
 *     qu'ignorer, et les nombres ne bougent pas d'une ligne.
 *  4. UNE SÉLECTION PARTIELLE N'EMPORTE QUE CE QU'ON A COCHÉ.
 *  5. UNE ARCHIVE ÉTRANGÈRE OU ABÎMÉE EST REFUSÉE EN CLAIR, avant toute
 *     écriture.
 *
 *   node scripts/verif-export-donnees.mjs
 *
 * PIÈGE : `getDb()` est un singleton lié à `HAIKODEV_DATA`, lu à l'import du
 * module. Deux bases dans un même processus sont donc impossibles — chaque
 * installation tourne dans son PROPRE processus enfant, que ce script relance
 * en lui passant un rôle.
 */
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOI = fileURLToPath(import.meta.url);

/* ------------------------------------------------------------------ */
/* Les rôles joués par les processus enfants                           */
/* ------------------------------------------------------------------ */

const role = process.env.HAIKO_EXPORT_ROLE;
if (role) {
  const { getDb } = await import(path.join(RACINE, 'server/dist/db.js'));
  const donnees = await import(path.join(RACINE, 'server/dist/export-donnees.js'));
  const sortie = await jouerLeRole(role, getDb, donnees);
  process.stdout.write(`\n__RESULTAT__${JSON.stringify(sortie)}\n`);
  process.exit(0);
}

async function jouerLeRole(quel, getDb, donnees) {
  const db = getDb();

  if (quel === 'semer') {
    const maintenant = Date.now();
    db.prepare(
      'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
    ).run('p1', 'Projet d’essai', process.env.HAIKO_EXPORT_DEPOT, '{}', maintenant, maintenant);
    for (const n of [1, 2, 3]) {
      db.prepare(
        'INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(`c${n}`, 'p1', 'planned', n, `Carte ${n}`, '{}', maintenant, maintenant);
    }
    db.prepare(
      'INSERT INTO secrets (id, nom, type, project_id, champs, note, cree_le, modifie_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('s1', 'Accès d’essai', 'mot-de-passe', null, JSON.stringify({ motDePasse: 'en-clair' }), '', maintenant, maintenant);
    db.prepare(
      'INSERT INTO snapshot_sites (id, project_id, nom, actif, data, cree_le, modifie_le) VALUES (?, ?, ?, 1, ?, ?, ?)',
    ).run('sn1', 'p1', 'Site d’essai', '{}', maintenant, maintenant);
    db.prepare(
      'INSERT INTO sites_surveilles (id, url, nom, etat, verifie_le, depuis, derniere_panne, cree_le) VALUES (?, ?, ?, ?, 0, 0, 0, ?)',
    ).run('sv1', 'https://exemple.test', 'Exemple', 'ok', maintenant);
    return { compte: compter(db) };
  }

  if (quel === 'exporter') {
    const selection = process.env.HAIKO_EXPORT_SELECTION
      ? process.env.HAIKO_EXPORT_SELECTION.split(',')
      : undefined;
    const resultat = await donnees.exporterDonnees(selection);
    if (!resultat.ok) return { ok: false, erreur: resultat.erreur };
    fs.copyFileSync(resultat.file, process.env.HAIKO_EXPORT_ARCHIVE);
    return { ok: true, taille: resultat.size, manifeste: resultat.manifeste };
  }

  if (quel === 'examiner') {
    return donnees.examinerArchive(fs.readFileSync(process.env.HAIKO_EXPORT_ARCHIVE));
  }

  if (quel === 'importer') {
    const bilan = donnees.importerDonnees(
      fs.readFileSync(process.env.HAIKO_EXPORT_ARCHIVE),
      process.env.HAIKO_EXPORT_SELECTION.split(','),
      process.env.HAIKO_EXPORT_POLITIQUE ?? 'ignorer',
    );
    return { bilan, compte: compter(db) };
  }

  throw new Error(`rôle inconnu : ${quel}`);
}

function compter(db) {
  const un = (table) => {
    try {
      return db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n;
    } catch {
      return -1;
    }
  };
  return {
    projects: un('projects'),
    cards: un('cards'),
    secrets: un('secrets'),
    snapshot_sites: un('snapshot_sites'),
    sites_surveilles: un('sites_surveilles'),
  };
}

/* ------------------------------------------------------------------ */
/* Le contrôle lui-même                                                */
/* ------------------------------------------------------------------ */

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-export-donnees-'));
const SOURCE = path.join(TMP, 'source');
const CIBLE = path.join(TMP, 'cible');
const DEPOT = path.join(TMP, 'depot');
const ARCHIVE = path.join(TMP, 'archive.zip');
const ARCHIVE_PARTIELLE = path.join(TMP, 'partielle.zip');
for (const dossier of [SOURCE, CIBLE, DEPOT]) fs.mkdirSync(dossier, { recursive: true });

// Un vrai dépôt git, pour que la catégorie « branches » ait quelque chose à lire.
execFileSync('git', ['init', '-q', '-b', 'principale'], { cwd: DEPOT });
fs.writeFileSync(path.join(DEPOT, 'LISEZ-MOI.md'), '# essai\n');
execFileSync('git', ['add', 'LISEZ-MOI.md'], { cwd: DEPOT });
execFileSync('git', ['-c', 'user.email=essai@local', '-c', 'user.name=essai', 'commit', '-qm', 'départ'], { cwd: DEPOT });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

function lancer(role, data, extra = {}) {
  const enfant = spawnSync(process.execPath, [MOI], {
    cwd: RACINE,
    encoding: 'utf8',
    env: {
      ...process.env,
      HAIKO_EXPORT_ROLE: role,
      HAIKODEV_DATA: data,
      HAIKODEV_PROJECTS_ROOT: TMP,
      HAIKO_EXPORT_DEPOT: DEPOT,
      HAIKO_EXPORT_ARCHIVE: ARCHIVE,
      ...extra,
    },
  });
  const marque = enfant.stdout?.split('__RESULTAT__')[1];
  if (!marque) {
    console.error(enfant.stdout ?? '');
    console.error(enfant.stderr ?? '');
    throw new Error(`le rôle « ${role} » n'a rien rendu`);
  }
  return JSON.parse(marque.trim());
}

console.log('\nEXPORT ET IMPORT INTÉGRAL DES DONNÉES\n');

/* 1. On sème, puis on exporte tout. */
const seme = lancer('semer', SOURCE);
noter(
  'une installation d’essai est montée avec projet, cartes, coffre-fort, snapshots et surveillance',
  seme.compte.projects === 1 && seme.compte.cards === 3 && seme.compte.secrets === 1,
  JSON.stringify(seme.compte),
);

const exporte = lancer('exporter', SOURCE);
noter("l'archive est écrite", exporte.ok === true, exporte.ok ? `${exporte.taille} octets` : exporte.erreur);

/* 2. L'archive se relit toute seule, et dit ce qu'elle contient. */
const apercu = lancer('examiner', SOURCE);
noter(
  "l'archive se relit : manifeste valable, aucune empreinte en défaut",
  apercu.ok === true && (apercu.abimes?.length ?? 0) === 0,
  apercu.ok ? `${apercu.contenu.length} catégorie(s)` : apercu.raison,
);
noter(
  "l'état git du projet est dans l'archive, avec sa branche courante",
  (exporte.manifeste?.git?.length ?? 0) === 1,
  `${exporte.manifeste?.git?.length ?? 0} dépôt(s)`,
);
noter(
  'la copie brute de la base accompagne un export complet',
  Boolean(exporte.manifeste?.base?.octets),
  `${exporte.manifeste?.base?.octets ?? 0} octets`,
);

/* 3. Tout arrive en face, sur une installation NEUVE. */
const TOUT = 'reglages,projets,cartes,messages,historique,coffre-fort,snapshots,surveillance,branches';
const premier = lancer('importer', CIBLE, { HAIKO_EXPORT_SELECTION: TOUT });
noter(
  'tout est remonté sur l’installation neuve, aux mêmes nombres',
  premier.compte.projects === 1 &&
    premier.compte.cards === 3 &&
    premier.compte.secrets === 1 &&
    premier.compte.snapshot_sites === 1 &&
    premier.compte.sites_surveilles === 1,
  JSON.stringify(premier.compte),
);
noter(
  'le coffre-fort est remonté avec sa valeur, en clair',
  premier.bilan.tables.find((t) => t.table === 'secrets')?.ajoutees === 1,
);
noter(
  'les dépôts git ne sont pas reclonés tout seuls : leur état est déposé',
  premier.bilan.git.length === 1,
  premier.bilan.git.join(', '),
);

/* 4. Rejouer le même import ne fabrique aucun doublon. */
const second = lancer('importer', CIBLE, { HAIKO_EXPORT_SELECTION: TOUT });
noter(
  'rejouer l’import ne fabrique aucun doublon',
  second.compte.projects === 1 && second.compte.cards === 3 && second.compte.secrets === 1,
  JSON.stringify(second.compte),
);
noter(
  'le second passage ne fait qu’ignorer : rien n’est ajouté ni remplacé',
  second.bilan.tables.every((table) => table.ajoutees === 0 && table.remplacees === 0),
);

/* 5. Une sélection partielle n'emporte que ce qu'on a coché. */
const partielle = lancer('exporter', SOURCE, {
  HAIKO_EXPORT_SELECTION: 'coffre-fort',
  HAIKO_EXPORT_ARCHIVE: ARCHIVE_PARTIELLE,
});
noter(
  'décocher retire vraiment : une archive du seul coffre-fort ne porte que lui',
  partielle.ok === true &&
    partielle.manifeste.tables.length === 1 &&
    partielle.manifeste.tables[0].table === 'secrets' &&
    !partielle.manifeste.base,
  partielle.ok ? partielle.manifeste.tables.map((t) => t.table).join(', ') : partielle.erreur,
);

/* 6. Une archive étrangère ou abîmée est refusée AVANT toute écriture. */
const ETRANGERE = path.join(TMP, 'etrangere.zip');
fs.writeFileSync(ETRANGERE, Buffer.from('ceci n’est pas un ZIP'));
const refus = lancer('examiner', SOURCE, { HAIKO_EXPORT_ARCHIVE: ETRANGERE });
noter(
  'un fichier qui n’est pas une archive est refusé en clair',
  refus.ok === false && Boolean(refus.raison),
  refus.raison,
);

const ABIMEE = path.join(TMP, 'abimee.zip');
const octets = fs.readFileSync(ARCHIVE);
// On abîme un octet au milieu du contenu compressé, sans toucher au catalogue.
octets[Math.floor(octets.length / 3)] ^= 0xff;
fs.writeFileSync(ABIMEE, octets);
const abimee = lancer('examiner', SOURCE, { HAIKO_EXPORT_ARCHIVE: ABIMEE });
noter(
  'une archive abîmée est repérée par ses empreintes, ou refusée à la lecture',
  abimee.ok === false || (abimee.abimes?.length ?? 0) > 0,
  abimee.ok ? `${abimee.abimes.length} fichier(s) en défaut` : abimee.raison,
);

/* ------------------------------------------------------------------ */

fs.rmSync(TMP, { recursive: true, force: true });

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.\n`);
process.exit(echecs.length ? 1 : 0);
