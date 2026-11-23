import assert from 'node:assert/strict';
import test from 'node:test';
import {
  POIDS_MAX_DU_DERNIER_ETAT,
  VALIDITE_DU_DERNIER_ETAT_MS,
  composerLeDernierEtat,
  lireLeDernierEtat,
} from '@beluga/shared';

/*
 * LE DERNIER ÉTAT VU SE REDESSINE TOUT DE SUITE (12/10/2026) : sur téléphone,
 * l'application restait blanche tant que le serveur n'avait pas parlé. La copie
 * ne sert qu'à REGARDER ; une copie d'un autre protocole ou trop vieille est jetée.
 */
const carte = (id: string, projectId: string) => ({ id, projectId, title: id });
const base = {
  protocole: 3,
  maintenant: 1_000_000,
  projects: [{ id: 'p1' }, { id: 'p2' }],
  groups: [{ id: 'g1' }],
  activeProjectId: 'p1',
  cards: { a: carte('a', 'p1'), b: carte('b', 'p2'), c: carte('c', 'p1') },
  totaux: { p1: { planned: 2 }, p2: { planned: 1 } },
};

test('la copie ne garde que les cartes du projet ouvert, et ses totaux', () => {
  const copie = composerLeDernierEtat(base)!;
  assert.deepEqual(
    copie.cards.map((c) => c.id).sort(),
    ['a', 'c'],
  );
  assert.deepEqual(copie.totaux, { planned: 2 });
  assert.equal(copie.projects.length, 2);
  assert.equal(copie.activeProjectId, 'p1');
});

test('sans projet connu, il n’y a rien à redessiner', () => {
  assert.equal(composerLeDernierEtat({ ...base, projects: [] }), null);
});

test('la copie relue est rendue telle quelle quand elle est valable', () => {
  const brut = JSON.stringify(composerLeDernierEtat(base));
  const lue = lireLeDernierEtat(brut, 3, base.maintenant + 60_000);
  assert.ok(lue);
  assert.equal(lue!.projects.length, 2);
});

test('une copie d’un autre protocole, trop vieille ou abîmée est jetée sans bruit', () => {
  const brut = JSON.stringify(composerLeDernierEtat(base));
  assert.equal(lireLeDernierEtat(brut, 4, base.maintenant), null, 'autre protocole');
  assert.equal(lireLeDernierEtat(brut, 3, base.maintenant + VALIDITE_DU_DERNIER_ETAT_MS + 1), null, 'trop vieille');
  assert.equal(lireLeDernierEtat('{pas du json', 3, base.maintenant), null);
  assert.equal(lireLeDernierEtat(null, 3, base.maintenant), null);
  assert.equal(lireLeDernierEtat('{"protocole":3,"ecritA":1000000}', 3, base.maintenant), null, 'forme incomplète');
  assert.ok(POIDS_MAX_DU_DERNIER_ETAT > 100_000, 'le plafond tient largement un tableau ordinaire');
});
