#!/usr/bin/env node
/**
 * LE COMPACTAGE DE LA BASE RESPECTE LE MÊME VERROU QU'UN REDÉMARRAGE.
 *
 *   node scripts/verif-compactage-base.mjs
 *
 * Base et dossier de données jetables, aucun moteur appelé. Ce qui est
 * vérifié :
 *   1. sous le seuil de pages libres (100 Mo), le compactage ne fait rien,
 *      sans qu'on ait besoin de le lui demander ;
 *   2. tant qu'une publication tourne (une ligne `deploys` à l'état
 *      'running'), même au-dessus du seuil, il est SAUTÉ ET REPORTÉ — jamais
 *      bloquant, jamais silencieux : la raison est rendue, et rien ne bouge
 *      sur le disque ;
 *   3. la voie libre et le seuil dépassé, un VACUUM part pour de vrai : le
 *      fichier rétrécit, `freelist_count` retombe à 0, et aucune ligne n'est
 *      perdue.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-compactage-'));
process.env.BELUGA_DATA = path.join(TMP, 'data');
process.env.BELUGA_PROJECTS_DIR = path.join(TMP, 'projets');

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { getDb, openDb } = await import(path.join(RACINE, 'server/dist/db.js'));
const { saveProject } = await import(path.join(RACINE, 'server/dist/store.js'));
const { compacterLaBase } = await import(path.join(RACINE, 'server/dist/compactage.js'));

openDb();
const db = getDb();
const fichierDb = path.join(process.env.BELUGA_DATA, 'beluga.db');

const projectId = crypto.randomUUID();
saveProject({
  id: projectId,
  name: 'projet-jetable',
  path: '/tmp/inexistant',
  defaultEngine: 'claude',
  isSelf: false,
  createdAt: Date.now(),
});

/* ------------------------------------------------------------------ */
/* 1. Sous le seuil : rien ne se passe, sans qu'on force               */
/* ------------------------------------------------------------------ */

{
  const avantOctets = fs.statSync(fichierDb).size;
  const resultat = compacterLaBase();
  const apresOctets = fs.statSync(fichierDb).size;
  noter(
    'compactage sauté sous le seuil de pages libres',
    resultat.fait === false && /seuil/.test(resultat.raison ?? ''),
    resultat.raison,
  );
  noter('rien n\'a bougé sur le disque sous le seuil', avantOctets === apresOctets);
}

/* ------------------------------------------------------------------ */
/* On dépasse le seuil : on écrit puis on efface, pour libérer des     */
/* pages sans avoir à copier la vraie base de production.              */
/* ------------------------------------------------------------------ */

db.exec('CREATE TABLE bourrage (id INTEGER PRIMARY KEY, blob TEXT NOT NULL)');
const gros = 'x'.repeat(1_000_000); // 1 Mo par ligne
const insert = db.prepare('INSERT INTO bourrage (blob) VALUES (?)');
const remplir = db.transaction((n) => {
  for (let i = 0; i < n; i++) insert.run(gros);
});
remplir(150); // ≈ 150 Mo écrits
db.exec('DELETE FROM bourrage');
db.exec('DROP TABLE bourrage');

const pageSize = db.pragma('page_size', { simple: true });
const freelistAvant = db.pragma('freelist_count', { simple: true });
const freeMoAvant = Math.round((pageSize * freelistAvant) / 1024 / 1024);
noter(
  'la base jetable dépasse maintenant le seuil de 100 Mo de pages libres',
  freeMoAvant > 100,
  `${freeMoAvant} Mo de pages libres`,
);

/* ------------------------------------------------------------------ */
/* 2. Une publication en cours REPORTE le compactage, même au-dessus  */
/*    du seuil                                                        */
/* ------------------------------------------------------------------ */

const deployId = crypto.randomUUID();
const maintenant = Date.now();
db.prepare(
  `INSERT INTO deploys (id, project_id, state, data, started_at, ended_at)
   VALUES (?, ?, 'running', ?, ?, NULL)`,
).run(
  deployId,
  projectId,
  JSON.stringify({ id: deployId, projectId, state: 'running', steps: [], startedAt: maintenant }),
  maintenant,
);

{
  const avantOctets = fs.statSync(fichierDb).size;
  const resultat = compacterLaBase();
  const apresOctets = fs.statSync(fichierDb).size;
  noter(
    'compactage sauté tant qu\'une publication tourne',
    resultat.fait === false && /publication/.test(resultat.raison ?? ''),
    resultat.raison,
  );
  noter('rien n\'a bougé sur le disque pendant le report', avantOctets === apresOctets);
}

db.prepare('DELETE FROM deploys WHERE id = ?').run(deployId);

/* ------------------------------------------------------------------ */
/* 3. La voie libre, le seuil dépassé : le VACUUM part pour de vrai    */
/* ------------------------------------------------------------------ */

{
  const avantOctets = fs.statSync(fichierDb).size;
  const compte = db.prepare('SELECT COUNT(*) AS n FROM projects').get().n;
  const resultat = compacterLaBase();
  const apresOctets = fs.statSync(fichierDb).size;
  const compteApres = db.prepare('SELECT COUNT(*) AS n FROM projects').get().n;
  const freelistApres = db.pragma('freelist_count', { simple: true });

  noter('le compactage se déclenche la voie libre', resultat.fait === true, `${resultat.dureeMs} ms`);
  noter(
    'le fichier rétrécit vraiment',
    apresOctets < avantOctets,
    `${Math.round(avantOctets / 1024 / 1024)} Mo → ${Math.round(apresOctets / 1024 / 1024)} Mo`,
  );
  noter('plus aucune page libre après coup', freelistApres === 0, `freelist_count = ${freelistApres}`);
  noter('aucune ligne perdue', compteApres === compte, `${compteApres} projet(s)`);
}

fs.rmSync(TMP, { recursive: true, force: true });

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles au vert`);
if (echecs.length > 0) {
  console.error(`ÉCHEC : ${echecs.map((e) => e.nom).join(', ')}`);
  process.exit(1);
}
