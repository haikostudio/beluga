import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/* Le filet des propositions à valider : un index, plus un balayage      */
/* ------------------------------------------------------------------ */

/*
 * Mesuré le 12/10/2026 : le filet du calcul des décisions passait deux `LIKE`
 * sur le texte de tous les messages (590 Mo, 418 ms à chaque calcul). La
 * migration 121 le range dans une colonne GÉNÉRÉE indexée en index partiel.
 * Ces essais verrouillent trois choses : la colonne dit EXACTEMENT ce que les
 * deux `LIKE` disaient, elle suit toute écriture sans que le code y pense, et la
 * requête du filet passe par l'index.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'proposition-indexee-'));
process.env.BELUGA_DATA = bacASable;

const { getDb } = await import('../db.js');

function poser(id: string, data: string) {
  getDb()
    .prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, 'agent-d-essai', 'assistant', data, Date.now());
}
const drapeau = (id: string) =>
  (getDb().prepare('SELECT a_proposition_en_attente AS v FROM messages WHERE id = ?').get(id) as { v: number | null }).v;

test('la colonne ne porte que les messages à proposition non tranchée', () => {
  poser('en-attente', '{"proposals":[{"id":"p1","decision":"pending"}]}');
  poser('tranchee', '{"proposals":[{"id":"p1","decision":"accepted"}]}');
  poser('sans-proposition', '{"content":"bonjour","proposals":[]}');
  assert.equal(drapeau('en-attente'), 1);
  assert.ok(!drapeau('tranchee'));
  assert.ok(!drapeau('sans-proposition'));
});

test('la colonne suit chaque écriture, d’où qu’elle vienne', () => {
  poser('qui-change', '{"proposals":[{"id":"p1","decision":"pending"}]}');
  assert.equal(drapeau('qui-change'), 1);
  getDb()
    .prepare('UPDATE messages SET data = ? WHERE id = ?')
    .run('{"proposals":[{"id":"p1","decision":"accepted"}]}', 'qui-change');
  assert.ok(!drapeau('qui-change'));
  getDb()
    .prepare('UPDATE messages SET data = ? WHERE id = ?')
    .run('{"proposals":[{"id":"p1","decision":"pending"}]}', 'qui-change');
  assert.equal(drapeau('qui-change'), 1);
});

test('la requête du filet passe par l’index partiel et rend ce que les deux LIKE rendaient', () => {
  const filet = `SELECT m.id FROM messages m
     WHERE m.a_proposition_en_attente = 1
       AND m.data LIKE '%"proposals":[{%' AND m.data LIKE '%"decision":"pending"%'
     ORDER BY m.id`;
  const ancien = `SELECT m.id FROM messages m
     WHERE m.data LIKE '%"proposals":[{%' AND m.data LIKE '%"decision":"pending"%'
     ORDER BY m.id`;
  const rendus = (getDb().prepare(filet).all() as { id: string }[]).map((r) => r.id);
  const avant = (getDb().prepare(ancien).all() as { id: string }[]).map((r) => r.id);
  assert.deepEqual(rendus, avant);
  assert.ok(rendus.includes('en-attente'));
  assert.ok(!rendus.includes('tranchee'));
  const plan = (getDb().prepare(`EXPLAIN QUERY PLAN ${filet}`).all() as { detail: string }[]).map((l) => l.detail).join(' | ');
  assert.match(plan, /idx_messages_proposition_en_attente/);
});
