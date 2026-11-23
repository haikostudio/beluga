import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lettreDeLExemple,
  lettreDeLaLegende,
  lettresDesOptions,
  libelleDUnChoixEnImage,
  libellesDUneReponseEnImages,
  nomDeLExemple,
  texteDeReponse,
} from '@beluga/shared';

test('la lettre est écrite dans le nom de la pièce, et relue', () => {
  assert.equal(nomDeLExemple(0, 'png'), 'exemple-A.png');
  assert.equal(nomDeLExemple(3, '.wav'), 'exemple-D.wav');
  assert.equal(lettreDeLExemple('exemple-B.png'), 'B');
  assert.equal(lettreDeLExemple('exemple-c.PNG'), 'C');
  // Les pièces nommées avant la règle gardent leur lettre par leur numéro.
  assert.equal(lettreDeLExemple('exemple-2.png'), 'B');
  assert.equal(lettreDeLExemple('capture.png'), null);
  assert.equal(lettreDeLExemple(undefined), null);
});

test('la lettre suit la pièce, pas l’ordre des options', () => {
  const noms: Record<string, string> = { p1: 'exemple-A.png', p2: 'exemple-B.png', p3: 'exemple-C.png' };
  // L'agent a réordonné ses options : C, A, B.
  const lettres = lettresDesOptions(
    [
      { id: 'o1', image: 'p3' },
      { id: 'o2', image: 'p1' },
      { id: 'o3', image: 'p2' },
    ],
    (id) => ({ name: noms[id] }),
  );
  assert.deepEqual([...lettres.entries()], [
    ['o1', 'C'],
    ['o2', 'A'],
    ['o3', 'B'],
  ]);
});

test('une image qui n’est pas un exemple prend la première lettre libre', () => {
  const noms: Record<string, string> = { p1: 'exemple-A.png', p2: 'maquette.png' };
  const lettres = lettresDesOptions(
    [
      { id: 'o1', image: 'p2' },
      { id: 'o2', image: 'p1' },
      { id: 'o3' },
    ],
    (id) => ({ name: noms[id] }),
  );
  assert.equal(lettres.get('o2'), 'A');
  assert.equal(lettres.get('o1'), 'B');
  assert.equal(lettres.has('o3'), false);
});

test('la réponse cite lettre et référence, dans l’ordre des touchers', () => {
  assert.equal(libelleDUnChoixEnImage('Icônes vivantes', 'B', '9d60'), 'B (#9d60) — Icônes vivantes');
  assert.equal(libelleDUnChoixEnImage('Sobre', null, null), 'Sobre');
  const options = [
    { id: 'o1', label: 'Sobre' },
    { id: 'o2', label: 'Vivant' },
  ];
  const reperes: Record<string, { lettre: string; alias: string }> = { o1: { lettre: 'A', alias: 'aa11' }, o2: { lettre: 'B', alias: 'bb22' } };
  const multiples = libellesDUneReponseEnImages(options, ['o2', 'o1'], true, (id) => reperes[id]);
  assert.deepEqual(multiples, ['1. B (#bb22) — Vivant', '2. A (#aa11) — Sobre']);
  assert.deepEqual(libellesDUneReponseEnImages(options, ['o1'], true, (id) => reperes[id]), ['A (#aa11) — Sobre']);
  assert.deepEqual(libellesDUneReponseEnImages(options, ['o2', 'x'], false, (id) => reperes[id]), ['B (#bb22) — Vivant']);
  assert.equal(texteDeReponse(multiples, '', 0), '1. B (#bb22) — Vivant, 2. A (#aa11) — Sobre');
});

test('la phrase d’un média livré rend sa lettre', () => {
  assert.equal(lettreDeLaLegende('B — Icônes vivantes'), 'B');
  assert.equal(lettreDeLaLegende('J’ai rendu une image'), null);
});
