import assert from 'node:assert/strict';
import test from 'node:test';
import {
  estCibleDeSaisie,
  formeDepuisEvenement,
  libelleDeRaccourci,
  raccourciAssignable,
  raccourciDeclenche,
  raisonRaccourciRefuse,
} from '@haikodev/shared';

const ev = (o: Partial<{ code: string; ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }>) => ({
  code: o.code ?? 'KeyE',
  ctrl: o.ctrl ?? false,
  alt: o.alt ?? false,
  shift: o.shift ?? false,
  meta: o.meta ?? false,
});

test('une touche seule ou seulement Maj est refusée : elle partirait en tapant', () => {
  assert.ok(raisonRaccourciRefuse('KeyE'));
  assert.ok(raisonRaccourciRefuse('Shift+KeyE'));
  assert.equal(raccourciAssignable('KeyE'), false);
});

test('Alt+lettre et Ctrl+Maj+lettre conviennent', () => {
  assert.equal(raisonRaccourciRefuse('Alt+KeyE'), null);
  assert.equal(raisonRaccourciRefuse('Ctrl+Shift+KeyL'), null);
  assert.ok(raccourciAssignable('Alt+Digit1'));
});

test('Ctrl seul et Cmd (Meta) sont écartés', () => {
  assert.ok(raisonRaccourciRefuse('Ctrl+KeyE'));
  assert.ok(raisonRaccourciRefuse('Meta+KeyE'));
});

test('un raccourci réservé du navigateur est refusé', () => {
  assert.ok(raisonRaccourciRefuse('Ctrl+Shift+KeyT'));
  assert.ok(raisonRaccourciRefuse('Ctrl+Shift+KeyI'));
});

test('une touche qui n’est ni lettre, ni chiffre, ni F est refusée', () => {
  assert.ok(raisonRaccourciRefuse('Alt+Space'));
  assert.ok(raisonRaccourciRefuse('Alt+Enter'));
});

test('les touches F conviennent avec Alt', () => {
  assert.equal(raisonRaccourciRefuse('Alt+F2'), null);
});

test('la forme d’un appui met les modificateurs dans l’ordre fixe', () => {
  assert.equal(formeDepuisEvenement(ev({ code: 'KeyE', alt: true })), 'Alt+KeyE');
  assert.equal(
    formeDepuisEvenement(ev({ code: 'KeyL', ctrl: true, shift: true })),
    'Ctrl+Shift+KeyL',
  );
});

test('un appui sur un modificateur seul ne donne aucune forme', () => {
  assert.equal(formeDepuisEvenement(ev({ code: 'AltLeft', alt: true })), null);
  assert.equal(formeDepuisEvenement(ev({ code: 'ShiftRight', shift: true })), null);
});

test('le raccourci se déclenche sur l’appui exact, jamais sur un autre', () => {
  assert.equal(raccourciDeclenche(ev({ code: 'KeyE', alt: true }), 'Alt+KeyE'), true);
  assert.equal(raccourciDeclenche(ev({ code: 'KeyE', ctrl: true }), 'Alt+KeyE'), false);
  assert.equal(raccourciDeclenche(ev({ code: 'KeyE', alt: true }), ''), false);
});

test('la forme se lit en clair, avec Maj et Cmd en français', () => {
  assert.equal(libelleDeRaccourci('Ctrl+Shift+KeyE'), 'Ctrl + Maj + E');
  assert.equal(libelleDeRaccourci('Alt+Digit1'), 'Alt + 1');
  assert.equal(libelleDeRaccourci('Alt+F2'), 'Alt + F2');
  assert.equal(libelleDeRaccourci(''), '');
});

test('un champ de saisie bloque le raccourci, pas un bouton', () => {
  assert.equal(estCibleDeSaisie({ tagName: 'INPUT' }), true);
  assert.equal(estCibleDeSaisie({ tagName: 'TEXTAREA' }), true);
  assert.equal(estCibleDeSaisie({ tagName: 'DIV', editable: true }), true);
  assert.equal(estCibleDeSaisie({ tagName: 'BUTTON' }), false);
  assert.equal(estCibleDeSaisie(null), false);
});
