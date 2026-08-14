import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Attachment,
  ajouterJointesCollees,
  emballerJointes,
  jointesDuMessage,
  relireJointes,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Les pièces jointes qui voyagent dans le presse-papiers               */
/* ------------------------------------------------------------------ */

function jointe(id: string, extra: Partial<Attachment> = {}): Attachment {
  return {
    id,
    projectId: 'p1',
    name: `${id}.png`,
    mime: 'image/png',
    size: 10,
    sha: `sha-${id}`,
    createdAt: 1,
    ...extra,
  };
}

test('ce qui est emballé se relit à l’identique', () => {
  const jointes = [jointe('a'), jointe('b', { mime: 'application/pdf', name: 'devis.pdf' })];
  assert.deepEqual(relireJointes(emballerJointes(jointes)), jointes);
});

test('un presse-papiers vide ou illisible ne rend rien, sans casser le collage', () => {
  assert.deepEqual(relireJointes(''), []);
  assert.deepEqual(relireJointes(null), []);
  assert.deepEqual(relireJointes('pas du json'), []);
  assert.deepEqual(relireJointes('{"id":"a"}'), []);
});

test('ce qui n’est pas une pièce jointe valable est écarté, le reste passe', () => {
  const brut = JSON.stringify([jointe('a'), { id: 'sans le reste' }, null]);
  const lues = relireJointes(brut);
  assert.equal(lues.length, 1);
  assert.equal(lues[0]!.id, 'a');
});

test('les fichiers collés s’ajoutent à la suite de ceux déjà posés', () => {
  const suite = ajouterJointesCollees([jointe('a')], [jointe('b')]);
  assert.deepEqual(
    suite.map((item) => item.id),
    ['a', 'b'],
  );
});

test('un fichier déjà joint ne s’ajoute pas deux fois', () => {
  const actuelles = [jointe('a')];
  assert.equal(ajouterJointesCollees(actuelles, [jointe('a')]), actuelles);
});

test('le même contenu sous un autre identifiant ne fait pas de doublon', () => {
  const actuelles = [jointe('a')];
  const jumelle = jointe('autre', { sha: 'sha-a' });
  assert.equal(ajouterJointesCollees(actuelles, [jumelle]), actuelles);
});

test('les pièces jointes d’un message se retrouvent dans la liste du projet', () => {
  const connues = [jointe('a'), jointe('b')];
  assert.deepEqual(
    jointesDuMessage(['b', 'a'], connues).map((item) => item.id),
    ['b', 'a'],
  );
});

test('un identifiant inconnu est sauté : on ne copie que ce qu’on a', () => {
  assert.deepEqual(jointesDuMessage(['a', 'perdu'], [jointe('a')]).length, 1);
});
