import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* La base doit être détournée avant le premier import du serveur. */
const donnees = fs.mkdtempSync(path.join(os.tmpdir(), 'haiko-tache-auto-'));
process.env.HAIKODEV_DATA = donnees;

const store = await import('../store.js');
const { poserCarteDuRangement } = await import('../instructions-en-attente.js');

function projet() {
  const maintenant = Date.now();
  return store.saveProject({
    id: store.newId(),
    name: 'Projet de tâche automatique',
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'haiko-projet-auto-')),
    defaultEngine: 'claude',
    isSelf: false,
    archived: false,
    rank: 1,
    createdAt: maintenant,
    updatedAt: maintenant,
  } as any);
}

test('une tâche automatique terminée reçoit une seule fiche dans « À déployer »', () => {
  const cible = projet();
  const commit = {
    sha: 'a'.repeat(40),
    titre: 'Range les règles durables déposées, une fois pour la nuit',
    branche: 'main',
    date: new Date().toISOString(),
  };

  poserCarteDuRangement(cible, commit);
  poserCarteDuRangement(cible, commit);

  const cartes = store.listCardsInColumn(cible.id, 'to_deploy');
  assert.equal(cartes.length, 1, 'la même fin de tâche ne redemande pas une seconde fiche');
  assert.equal(cartes[0].title, commit.titre);
  assert.equal(cartes[0].codeDejaEnregistre, true);
  assert.equal(cartes[0].github?.commits[0]?.sha, commit.sha);
});
