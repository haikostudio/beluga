import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '../db.js';

/* Formations retrouve « npm run build » au déploiement : son service sert
   `.output` tel quel. La migration ne vise que lui, et ne remplace jamais une
   commande déjà réglée. */
test('Formations retrouve sa construction, et personne d’autre ne bouge', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY, path TEXT NOT NULL, data TEXT NOT NULL);');
  const ajouter = db.prepare('INSERT INTO projects (id, path, data) VALUES (?, ?, ?)');
  ajouter.run('formations', '/root/formations', JSON.stringify({ deploiement: { service: 'autoproject-formations' } }));
  ajouter.run('haikonote', '/root/HaikoNote', JSON.stringify({ deploiement: { service: 'autoproject-haikonote' } }));

  const migration = MIGRATIONS.find((item) => item.name === 'formations-reconstruit-au-deploiement');
  assert.ok(migration);
  db.exec(migration.sql);
  const lire = (id: string) =>
    JSON.parse((db.prepare('SELECT data FROM projects WHERE id = ?').get(id) as { data: string }).data).deploiement;
  assert.deepEqual(lire('formations'), { service: 'autoproject-formations', commande: 'npm run build' });
  assert.deepEqual(lire('haikonote'), { service: 'autoproject-haikonote' }, 'un service qui construit au démarrage reste sans commande');

  // Une commande retouchée à la main n'est pas écrasée par un second passage.
  db.prepare("UPDATE projects SET data = json_set(data, '$.deploiement.commande', 'scripts/autre.sh') WHERE id = 'formations'").run();
  db.exec(migration.sql);
  assert.equal(lire('formations').commande, 'scripts/autre.sh');
  db.close();
});
