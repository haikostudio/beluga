import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '../db.js';

/* ------------------------------------------------------------------ */
/* UN NUMÉRO DE MIGRATION REPRIS NE FAIT PLUS SAUTER DU TRAVAIL         */
/*                                                                      */
/* Le 8 septembre 2026, une fusion a renuméroté une migration DÉJÀ      */
/* passée : « retirer-le-journal-des-envois-au-cerveau » portait le 49   */
/* dans la base servie, le code lui a donné le 50, et a offert le 49 à   */
/* « index-message-en-ecriture ». Le lanceur ne regardait que le NUMÉRO. */
/* Voyant un 49 au registre, il a sauté la nouvelle migration POUR       */
/* TOUJOURS, sans un mot. La colonne `messages.streaming` n'a jamais     */
/* existé, `saveMessage` est tombée à CHAQUE message, et plus une seule  */
/* carte ne pouvait être lancée.                                        */
/*                                                                      */
/* Deux exigences, opposées, tenues ensemble ici :                      */
/*  — un numéro REPRIS par une autre migration du code : on applique ;   */
/*  — un numéro portant un nom d'ÉPOQUE, inconnu du code (base ancienne) */
/*    : le numéro fait foi, on ne rejoue rien.                          */
/* ------------------------------------------------------------------ */

const RACINE = path.resolve(import.meta.dirname, '../../..');

/** Ouvre une base par le vrai `openDb()`, dans un bac à sable à part. */
function ouvrirDansUnBac(bac: string): { sortie: string; base: string } {
  const sortie = execFileSync(
    process.execPath,
    ['-e', "import('./server/dist/db.js').then((m) => m.openDb())"],
    { cwd: RACINE, env: { ...process.env, BELUGA_DATA: bac, NODE_ENV: 'test' }, encoding: 'utf8', stdio: 'pipe' },
  );
  return { sortie, base: path.join(bac, 'beluga.db') };
}

test('les noms de migration sont uniques — sinon le registre devient aveugle', () => {
  const vus = new Set<string>();
  for (const migration of MIGRATIONS) {
    assert.ok(!vus.has(migration.name), `le nom « ${migration.name} » est utilisé deux fois`);
    vus.add(migration.name);
  }
});

test('un numéro repris par une autre migration du code : le travail est appliqué', () => {
  const bac = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-reprise-'));
  try {
    // Une base COMPLÈTE, telle que le code la fabrique aujourd'hui.
    const { base } = ouvrirDansUnBac(bac);

    // On rejoue l'accident, sur la migration qui l'a vraiment subi : son
    // numéro est donné au voisin, et son propre travail est défait. Exactement
    // ce qu'une fusion malheureuse laisse derrière elle.
    const sautee = MIGRATIONS.find((m) => m.name === 'index-message-en-ecriture');
    assert.ok(sautee, 'la migration de référence doit exister');
    const usurpatrice = MIGRATIONS.find((m) => m.id === sautee.id + 1);
    assert.ok(usurpatrice, 'il faut une migration voisine pour reprendre le numéro');
    const db = new Database(base);
    // Le numéro de la sautée porte, au registre, le nom de sa VOISINE : c'est
    // la trace exacte que laisse un renumérotage.
    db.prepare('UPDATE migrations SET name = ? WHERE id = ?').run(usurpatrice.name, sautee.id);
    // La colonne posée par la migration sautée disparaît avec elle.
    db.exec('DROP INDEX IF EXISTS idx_messages_streaming');
    db.exec('ALTER TABLE messages DROP COLUMN streaming');
    assert.ok(
      !db
        .prepare('PRAGMA table_info(messages)')
        .all()
        .some((c: any) => c.name === 'streaming'),
      'le décor doit vraiment avoir retiré la colonne',
    );
    db.close();

    // Une seconde ouverture doit VOIR le numéro repris et refaire le travail.
    const { sortie } = ouvrirDansUnBac(bac);
    const relue = new Database(base, { readonly: true });
    const colonnes = relue.prepare('PRAGMA table_info(messages)').all().map((c: any) => c.name);
    const registre = relue.prepare('SELECT id, name FROM migrations').all() as { id: number; name: string }[];
    relue.close();

    assert.ok(colonnes.includes('streaming'), 'la migration sautée doit avoir été rejouée');
    assert.match(sortie, /numéro repris/, 'le saut évité doit se DIRE, pas se faire en silence');
    assert.equal(
      registre.find((r) => r.id === sautee.id)?.name,
      sautee.name,
      'le registre doit être remis d’aplomb',
    );
  } finally {
    fs.rmSync(bac, { recursive: true, force: true });
  }
});

test('un numéro portant un nom d’époque, inconnu du code, fait toujours foi', () => {
  const bac = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-ancienne-'));
  try {
    const { base } = ouvrirDansUnBac(bac);
    const db = new Database(base);
    // Une base d'AVANT : les numéros sont là, les noms sont ceux d'alors.
    db.prepare("UPDATE migrations SET name = 'ancienne-' || id").run();
    db.close();

    // Rien ne doit être rejoué : ces numéros-là disent bien que le travail est fait.
    const { sortie } = ouvrirDansUnBac(bac);
    assert.doesNotMatch(sortie, /appliquée/, 'aucune migration ne doit être rejouée sur une base d’avant');
  } finally {
    fs.rmSync(bac, { recursive: true, force: true });
  }
});
