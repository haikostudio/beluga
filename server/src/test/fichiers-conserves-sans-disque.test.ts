import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* SANS DISQUE DE STOCKAGE : pas une écriture sur le disque du serveur, et rien ne se compte à tort comme expiré. */
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'conserves-sans-'));
process.env.BELUGA_DATA = data;
delete process.env.BELUGA_PIECES_JOINTES;

const { openDb, getDb } = await import('../db.js');
openDb();
const { attendreLesCopies, conserverUnFichier, purgerLesCopiesAnciennes, resoudreFichierCite } = await import('../fichiers-conserves.js');

test('rien n’est copié, rien n’expire, et l’écran apprend que le disque ne répond pas', async () => {
  const projet = fs.mkdtempSync(path.join(os.tmpdir(), 'conserves-sans-projet-'));
  const ctx = { projectId: 'p', projectPath: projet, workdir: projet, cardId: 'c', agentId: 'a' };
  const f = path.join(projet, 'a.md');
  fs.writeFileSync(f, 'a');
  conserverUnFichier(ctx, f);
  await attendreLesCopies();
  assert.equal((getDb().prepare('SELECT count(*) n FROM fichiers_conserves').get() as any).n, 0);
  assert.equal(fs.existsSync(path.join(data, 'attachments', 'fichiers-conserves')), false);

  getDb()
    .prepare(`INSERT INTO fichiers_conserves (project_id, card_id, chemin_origine, sha, nom, mime, taille, at) VALUES ('p','c','/tmp/perdu.md','abcd','perdu.md','text/markdown',1,?)`)
    .run(Date.now() - 200 * 24 * 3600_000);
  assert.equal(purgerLesCopiesAnciennes().ignore, 'disque de stockage absent');
  assert.equal((getDb().prepare('SELECT expire_le e FROM fichiers_conserves').get() as any).e, null);
  assert.deepEqual(await resoudreFichierCite(ctx, '/tmp/perdu.md'), { trouve: false, motif: 'stockage-absent' });
});
