import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Attachment,
  ajouterJointesCollees,
  emballerJointes,
  jointesDesTags,
  jointesDuMessage,
  nomsDesTags,
  relireJointes,
  texteAvecTagsDesJointes,
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

/* ------------------------------------------------------------------ */
/* Le repli quand le presse-papiers n'a porté que du TEXTE (téléphone)  */
/* ------------------------------------------------------------------ */

test('les noms cités par les tags sont lus dans l’ordre, sans répétition', () => {
  assert.deepEqual(
    nomsDesTags('[fichier: a.png] au début [fichier: b.pdf] puis [fichier: a.png] encore'),
    ['a.png', 'b.pdf'],
  );
  assert.deepEqual(nomsDesTags(''), []);
  assert.deepEqual(nomsDesTags('aucun fichier ici'), []);
});

test('un texte collé sans notre type retrouve ses fichiers par leur nom', () => {
  const connues = [jointe('a', { name: 'capture.png' }), jointe('b', { name: 'devis.pdf' })];
  const trouvees = jointesDesTags('[fichier: capture.png] [fichier: devis.pdf] regarde', connues);
  assert.deepEqual(trouvees.map((item) => item.id), ['a', 'b']);
});

test('un nom envoyé plusieurs fois rend le fichier le plus récent', () => {
  const connues = [
    jointe('vieux', { name: 'capture.png', createdAt: 10 }),
    jointe('recent', { name: 'capture.png', createdAt: 90 }),
  ];
  assert.deepEqual(
    jointesDesTags('[fichier: capture.png]', connues).map((item) => item.id),
    ['recent'],
  );
});

test('un nom inconnu est sauté sans bruit', () => {
  assert.deepEqual(jointesDesTags('[fichier: perdu.png]', [jointe('a')]), []);
  assert.deepEqual(jointesDesTags('rien à voir', [jointe('a')]), []);
});

test('le texte copié nomme les fichiers qui n’avaient pas de tag', () => {
  const jointes = [jointe('a', { name: 'capture.png' }), jointe('b', { name: 'devis.pdf' })];
  assert.equal(
    texteAvecTagsDesJointes('[fichier: capture.png] regarde', jointes),
    '[fichier: capture.png] regarde [fichier: devis.pdf]',
  );
  assert.equal(texteAvecTagsDesJointes('regarde', []), 'regarde');
  assert.equal(texteAvecTagsDesJointes('', [jointe('a', { name: 'capture.png' })]), '[fichier: capture.png]');
});

test('le texte complété se relit par la règle du collage', () => {
  const jointes = [jointe('a', { name: 'capture.png' })];
  const copie = texteAvecTagsDesJointes('regarde ça', jointes);
  assert.deepEqual(jointesDesTags(copie, jointes).map((item) => item.id), ['a']);
});
