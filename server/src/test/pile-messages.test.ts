import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MESSAGES_PASSAGERS_GARDES,
  heureEtDate,
  pileAvecMessage,
  pileAvecMessagePersistant,
} from '@beluga/shared';

test("l'heure et la date se lisent en une ligne courte", () => {
  const ligne = heureEtDate(new Date(2026, 7, 4, 14, 32).getTime());
  assert.match(ligne, /^\d{2}:\d{2} · 04\.08\.2026$/);
  assert.equal(heureEtDate(undefined), '');
});

/* ------------------------------------------------------------------ */
/* LE MESSAGE QUI RESTE TANT QUE SA CAUSE DURE                         */
/* ------------------------------------------------------------------ */

const passager = (id: string, at = 1000) => ({ id, at });
const persistant = (cle: string, at = 1000) => ({ id: `persistant-${cle}`, cle, at });

test('un message persistant entre en TÊTE de pile, avant ce qui s’est passé', () => {
  const pile = [passager('a'), passager('b')];
  const suite = pileAvecMessagePersistant(pile, 'canal', persistant('canal', 5000));
  assert.deepEqual(
    suite.map((m) => m.id),
    ['persistant-canal', 'a', 'b'],
  );
});

test('le même message persistant se remplace EN PLACE, sans perdre son heure', () => {
  const pile = pileAvecMessagePersistant([passager('a')], 'canal', persistant('canal', 5000));
  const suite = pileAvecMessagePersistant(pile, 'canal', { ...persistant('canal', 9999), id: 'autre' });
  assert.equal(suite.length, 2);
  assert.equal(suite[0].at, 5000, 'l’heure d’arrivée ne remonte pas');
  assert.equal(suite[0].id, 'persistant-canal', 'l’identifiant ne change pas : rien ne clignote');
});

test('la cause disparue, le message persistant s’en va — et lui seul', () => {
  const pile = pileAvecMessagePersistant([passager('a'), passager('b')], 'canal', persistant('canal'));
  const suite = pileAvecMessagePersistant(pile, 'canal', null);
  assert.deepEqual(
    suite.map((m) => m.id),
    ['a', 'b'],
  );
});

test('rien à retirer : la pile revient telle quelle', () => {
  const pile = [passager('a')];
  assert.deepEqual(pileAvecMessagePersistant(pile, 'canal', null), pile);
});

test('le plafond des messages ne mord QUE sur les passagers', () => {
  let pile: { id: string; at: number; cle?: string }[] = pileAvecMessagePersistant(
    [],
    'canal',
    persistant('canal'),
  );
  for (let rang = 0; rang < 12; rang += 1) pile = pileAvecMessage(pile, passager(`p${rang}`, 2000 + rang));
  assert.equal(pile.filter((m) => m.cle === 'canal').length, 1, 'l’état du lien survit à douze messages');
  assert.equal(pile.filter((m) => !m.cle).length, MESSAGES_PASSAGERS_GARDES + 1);
  assert.equal(pile[0].cle, 'canal', 'et il reste en tête');
});
