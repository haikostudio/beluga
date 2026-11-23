#!/usr/bin/env node
/**
 * LE SCHÉMA DE LA BASE SERVIE DOIT ÊTRE CELUI QUE LE CODE ATTEND.
 *
 * Le 8 septembre 2026, une fusion a renuméroté une migration déjà passée :
 * « retirer-le-journal-des-envois-au-cerveau » portait le 49 dans la base
 * servie, le code lui a donné le 50 et a offert le 49 à
 * « index-message-en-ecriture ». Le lanceur ne regardait que le NUMÉRO : voyant
 * un 49 au registre, il a sauté la nouvelle migration POUR TOUJOURS, sans un
 * mot. La colonne `messages.streaming` n'a jamais existé, `saveMessage` est
 * tombée à CHAQUE message, et plus une seule carte ne pouvait être lancée —
 * « ça plante à peine la demande lancée ».
 *
 * Le lanceur se fie désormais au NOM (`server/src/db.ts`). Ce contrôle-ci est
 * la ceinture par-dessus la bretelle : il fabrique une base NEUVE dans un bac à
 * sable — donc toutes les migrations appliquées dans l'ordre, par le même code
 * — et compare table par table, colonne par colonne, index par index, avec la
 * base RÉELLEMENT SERVIE. Toute dérive se voit, quelle qu'en soit la cause.
 *
 * Il vérifie aussi le REGISTRE lui-même : un numéro portant un autre nom que
 * celui du code est le symptôme exact de l'accident ci-dessus.
 *
 * Usage : node scripts/verif-schema-base.mjs
 *         BELUGA_DATA=/chemin/vers/data node scripts/verif-schema-base.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const donneesServies = process.env.BELUGA_DATA?.trim() || path.join(RACINE, 'data');

/** Le schéma d'une base, réduit à ce qui compte : noms de colonnes et d'index. */
function lire(base, mode) {
  const db = new Database(base, { readonly: mode === 'lecture' });
  try {
    const schema = { tables: {}, index: [], migrations: [] };
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all();
    for (const t of tables) {
      schema.tables[t.name] = db
        .prepare(`PRAGMA table_info(${JSON.stringify(t.name)})`)
        .all()
        .map((c) => c.name)
        .sort();
    }
    schema.index = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((r) => r.name);
    if (schema.tables.migrations) {
      schema.migrations = db.prepare('SELECT id, name FROM migrations ORDER BY id').all();
    }
    return schema;
  } finally {
    db.close();
  }
}

const bac = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-schema-'));

let echecs = 0;
const rate = (message) => {
  console.error(`  ✗ ${message}`);
  echecs += 1;
};

try {
  // 1. UNE BASE NEUVE, fabriquée par le code lui-même : la référence.
  const bacDonnees = path.join(bac, 'data');
  fs.mkdirSync(bacDonnees, { recursive: true });
  execFileSync(process.execPath, ['-e', "import('./server/dist/db.js').then((m) => m.openDb())"], {
    cwd: RACINE,
    env: { ...process.env, BELUGA_DATA: bacDonnees, NODE_ENV: 'test' },
    stdio: 'pipe',
  });
  const baseNeuve = ['beluga.db']
    .map((n) => path.join(bacDonnees, n))
    .find((p) => fs.existsSync(p) && fs.statSync(p).size > 0);
  if (!baseNeuve) throw new Error(`aucune base neuve fabriquée dans ${bacDonnees}`);

  const baseServie = ['beluga.db']
    .map((n) => path.join(donneesServies, n))
    .find((p) => fs.existsSync(p) && fs.statSync(p).size > 0);
  if (!baseServie) throw new Error(`aucune base servie trouvée dans ${donneesServies}`);

  console.log(`base servie : ${baseServie}`);
  console.log(`base neuve  : ${baseNeuve}`);

  const attendu = lire(baseNeuve, 'ecriture');
  const reel = lire(baseServie, 'lecture');

  // 2. TABLES ET COLONNES. Le sens qui compte est « il manque à la base servie
  //    ce que le code attend » ; une table en trop est un reste, pas une panne.
  console.log('\n— tables et colonnes —');
  for (const [table, colonnes] of Object.entries(attendu.tables)) {
    const vues = reel.tables[table];
    if (!vues) {
      rate(`table « ${table} » ABSENTE de la base servie`);
      continue;
    }
    const manquantes = colonnes.filter((c) => !vues.includes(c));
    if (manquantes.length) rate(`table « ${table} » : colonne(s) manquante(s) — ${manquantes.join(', ')}`);
  }

  // 3. INDEX. Un index manquant ne casse pas une requête, il la rend lente —
  //    mais c'est le même symptôme d'une migration sautée.
  console.log('— index —');
  const indexManquants = attendu.index.filter((i) => !reel.index.includes(i));
  if (indexManquants.length) rate(`index manquant(s) — ${indexManquants.join(', ')}`);

  // 4. LE REGISTRE. Un numéro portant un autre nom que celui du code : c'est
  //    l'accident du 8 septembre 2026, repéré avant qu'il ne fasse des dégâts.
  console.log('— registre des migrations —');
  const nomAttendu = new Map(attendu.migrations.map((m) => [m.id, m.name]));
  const nomsServis = new Set(reel.migrations.map((m) => m.name));
  for (const [id, nom] of nomAttendu) {
    if (!nomsServis.has(nom)) rate(`migration « ${nom} » (n° ${id}) JAMAIS appliquée sur la base servie`);
  }
  for (const ligne of reel.migrations) {
    const attenduIci = nomAttendu.get(ligne.id);
    if (attenduIci && attenduIci !== ligne.name) {
      rate(`n° ${ligne.id} : la base servie dit « ${ligne.name} », le code dit « ${attenduIci} » — numéro repris`);
    }
  }

  if (echecs === 0) {
    console.log('\n✓ le schéma servi est celui que le code attend');
    process.exit(0);
  }
  console.error(`\n✗ ${echecs} écart(s) — la base servie n'est pas à jour.`);
  console.error('  Réparer sans couper le démon : node scripts/rejouer-migrations.mjs');
  process.exit(1);
} finally {
  fs.rmSync(bac, { recursive: true, force: true });
}
