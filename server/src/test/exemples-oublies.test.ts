import test from 'node:test';
import assert from 'node:assert/strict';
import { lettresDesOptions, refusDExemplesOublies, verdictDuLot } from '@beluga/shared';

const lot = [
  { id: 'pa', lettre: 'A', titre: 'Rond', alias: '3351' },
  { id: 'pb', lettre: 'B', titre: 'Carré', alias: '3ec7' },
  { id: 'pc', lettre: 'C', titre: 'Étoile', alias: 'afbc' },
  { id: 'pd', lettre: 'D', titre: 'Vague', alias: null },
];

test('un lot repris en entier est complet, même avec des choix en mots à côté', () => {
  const options = [{ image: 'pa' }, { image: 'pb' }, { image: 'pc' }, { image: 'pd' }, {}, {}];
  assert.deepEqual(verdictDuLot(lot, options), { etat: 'complet' });
});

test('un lot repris en partie dit les exemples oubliés (cas de la carte Jb2o)', () => {
  const v = verdictDuLot(lot, [{ image: 'pa' }, { image: 'pb' }, {}, {}]);
  assert.equal(v.etat, 'incomplet');
  assert.deepEqual(v.etat === 'incomplet' && v.oublies.map((p) => p.lettre), ['C', 'D']);
  const texte = refusDExemplesOublies(v.etat === 'incomplet' ? v.oublies : [], 'image', 8);
  assert.match(texte, /C \(#afbc\) — Étoile : pièce « pc »/);
  assert.match(texte, /D — Vague/);
  assert.match(texte, /ne le retire jamais/);
  assert.match(texte, /8 options au plus/);
});

test('une question sans aucune pièce du lot passe, le lot attend la suivante', () => {
  assert.deepEqual(verdictDuLot(lot, [{}, {}, { image: 'autre' }]), { etat: 'sans-rapport' });
  assert.deepEqual(verdictDuLot([], [{ image: 'pa' }]), { etat: 'sans-rapport' });
});

test('une voix se reprend par « media »', () => {
  const voix = [{ id: 'v1', lettre: 'A', titre: 'Grave' }, { id: 'v2', lettre: 'B', titre: 'Claire' }];
  assert.deepEqual(verdictDuLot(voix, [{ media: 'v1' }, { media: 'v2' }]), { etat: 'complet' });
  assert.equal(verdictDuLot(voix, [{ media: 'v1' }]).etat, 'incomplet');
});

test('la lettre écrite sur l’option prime sur le nom de la pièce de secours', () => {
  const noms: Record<string, string> = { pa: 'exemple-A.png', pc: 'apercu-exemple-1-v1.png' };
  const lettres = lettresDesOptions(
    [
      { id: 'o0', image: 'pa' },
      { id: 'o1', image: 'pc', lettre: 'C' },
    ],
    (id) => ({ name: noms[id] }),
  );
  assert.equal(lettres.get('o0'), 'A');
  assert.equal(lettres.get('o1'), 'C');
});

test('un choix qui porte plusieurs images reprend chacune d’elles (carte « Images groupées dans le fil »)', () => {
  assert.deepEqual(verdictDuLot(lot, [{ image: 'pa', images: ['pa', 'pb'] }, { images: ['pc', 'pd'] }]), { etat: 'complet' });
  const v = verdictDuLot(lot, [{ image: 'pa', images: ['pa', 'pb'] }]);
  assert.deepEqual(v.etat === 'incomplet' && v.oublies.map((p) => p.lettre), ['C', 'D']);
});
