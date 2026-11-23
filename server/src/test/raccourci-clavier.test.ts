import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUCUN_RACCOURCI,
  RACCOURCI_PAR_DEFAUT,
  creerReconnaisseur,
  raccourciEffectif,
  libelleDeRaccourci,
  raisonRaccourciRefuse,
} from '@beluga/shared';


test('une touche seule ou seulement Maj est refusée : elle partirait en tapant', () => {
  assert.ok(raisonRaccourciRefuse('KeyE'));
  assert.ok(raisonRaccourciRefuse('Shift+KeyE'));
});

test('Alt+lettre et Ctrl+Maj+lettre conviennent', () => {
  assert.equal(raisonRaccourciRefuse('Alt+KeyE'), null);
  assert.equal(raisonRaccourciRefuse('Ctrl+Shift+KeyL'), null);
  assert.equal(raisonRaccourciRefuse('Alt+Digit1'), null);
});

test('Cmd et Ctrl sont permis avec une touche libre (17/11/2026)', () => {
  assert.equal(raisonRaccourciRefuse('Ctrl+KeyE'), null);
  assert.equal(raisonRaccourciRefuse('Meta+KeyK'), null);
  assert.equal(raisonRaccourciRefuse('Alt+Meta+KeyK'), null);
});

test('les raccourcis natifs sont refusés, avec Ctrl comme avec Cmd', () => {
  for (const natif of ['Meta+KeyC', 'Meta+KeyV', 'Ctrl+KeyC', 'Ctrl+KeyV', 'Meta+KeyZ', 'Meta+Shift+KeyZ', 'Ctrl+Shift+KeyT', 'Ctrl+Shift+KeyI', 'Meta+Space', 'Alt+Meta+KeyI']) {
    assert.ok(raisonRaccourciRefuse(natif), natif);
  }
});

test('une touche qui n’est ni lettre, ni chiffre, ni F, ni Espace, ni flèche est refusée', () => {
  assert.ok(raisonRaccourciRefuse('Alt+Enter'));
  assert.ok(raisonRaccourciRefuse('Alt+Tab'));
  assert.equal(raisonRaccourciRefuse('Ctrl+Alt+Space'), null);
});

test('modificateurs seuls : deux au moins', () => {
  assert.equal(raisonRaccourciRefuse('Mods:Ctrl+Shift'), null);
  assert.ok(raisonRaccourciRefuse('Mods:Shift'));
});

test('double appui : seulement sur un modificateur', () => {
  assert.equal(raisonRaccourciRefuse('Double:Shift'), null);
  assert.equal(raisonRaccourciRefuse('Double:Ctrl'), null);
  assert.ok(raisonRaccourciRefuse('Double:KeyE'));
});

test('Maj Maj est le raccourci par défaut ; « Aucun » le retire', () => {
  assert.equal(RACCOURCI_PAR_DEFAUT, 'Double:Shift');
  assert.equal(raccourciEffectif(''), 'Double:Shift');
  assert.equal(raccourciEffectif(undefined), 'Double:Shift');
  assert.equal(raccourciEffectif(AUCUN_RACCOURCI), null);
  assert.equal(raccourciEffectif('Alt+KeyE'), 'Alt+KeyE');
});

test('les touches F conviennent avec Alt', () => {
  assert.equal(raisonRaccourciRefuse('Alt+F2'), null);
});

test('la forme se lit en clair, avec Maj et Cmd en français', () => {
  assert.equal(libelleDeRaccourci('Ctrl+Shift+KeyE'), 'Ctrl + Maj + E');
  assert.equal(libelleDeRaccourci('Alt+Digit1'), 'Alt + 1');
  assert.equal(libelleDeRaccourci('Alt+F2'), 'Alt + F2');
  assert.equal(libelleDeRaccourci(''), '');
  assert.equal(libelleDeRaccourci('Mods:Ctrl+Shift'), 'Ctrl + Maj');
  assert.equal(libelleDeRaccourci('Double:Shift'), 'Maj Maj');
  assert.equal(libelleDeRaccourci('Alt+Meta+KeyK'), 'Alt + Cmd + K');
  assert.equal(libelleDeRaccourci('Alt+Meta+KeyK', 'mac'), '⌥ ⌘ K');
  assert.equal(libelleDeRaccourci('Double:Shift', 'mac'), '⇧ ⇧');
  assert.equal(libelleDeRaccourci(AUCUN_RACCOURCI), '');
});

/* LE RECONNAISSEUR : une suite d'appuis et de relâchements, horodatés. */
type Pas = [type: 'down' | 'up', code: string, t: number];
function jouer(pas: Pas[]): (string | null)[] {
  const r = creerReconnaisseur();
  const tenus = { ctrl: false, alt: false, shift: false, meta: false };
  return pas.map(([type, code, t]) => {
    const cle = code.startsWith('Control') ? 'ctrl' : code.startsWith('Alt') ? 'alt' : code.startsWith('Shift') ? 'shift' : code.startsWith('Meta') ? 'meta' : null;
    if (cle) tenus[cle] = type === 'down';
    return r.recevoir({ type, code, t, ...tenus });
  });
}
const accomplies = (pas: Pas[]) => jouer(pas).filter(Boolean);

test('Maj Maj rapide déclenche le double appui', () => {
  assert.deepEqual(accomplies([['down', 'ShiftLeft', 0], ['up', 'ShiftLeft', 80], ['down', 'ShiftLeft', 200], ['up', 'ShiftLeft', 260]]), ['Double:Shift']);
});

test('deux appuis sur Maj trop espacés ne déclenchent rien', () => {
  assert.deepEqual(accomplies([['down', 'ShiftLeft', 0], ['up', 'ShiftLeft', 80], ['down', 'ShiftLeft', 600], ['up', 'ShiftLeft', 660]]), []);
});

test('taper deux majuscules (« OK ») ne déclenche pas Maj Maj', () => {
  const pas: Pas[] = [
    ['down', 'ShiftLeft', 0], ['down', 'KeyO', 40], ['up', 'KeyO', 90], ['up', 'ShiftLeft', 120],
    ['down', 'ShiftLeft', 180], ['down', 'KeyK', 220], ['up', 'KeyK', 260], ['up', 'ShiftLeft', 290],
  ];
  assert.deepEqual(accomplies(pas).filter((f) => String(f).startsWith('Double') || String(f).startsWith('Mods')), []);
});

test('une lettre entre deux appuis sur Maj annule le double appui', () => {
  assert.deepEqual(
    accomplies([['down', 'ShiftLeft', 0], ['up', 'ShiftLeft', 60], ['down', 'KeyA', 100], ['up', 'KeyA', 140], ['down', 'ShiftLeft', 200], ['up', 'ShiftLeft', 250]]).filter((f) => String(f).startsWith('Double')),
    [],
  );
});

test('Ctrl+Maj relâchés seuls déclenchent la forme des modificateurs', () => {
  assert.deepEqual(accomplies([['down', 'ControlLeft', 0], ['down', 'ShiftLeft', 50], ['up', 'ShiftLeft', 200], ['up', 'ControlLeft', 220]]), ['Mods:Ctrl+Shift']);
});

test('Ctrl+Maj+T ne déclenche pas la forme des modificateurs, seulement la combinaison', () => {
  assert.deepEqual(
    accomplies([['down', 'ControlLeft', 0], ['down', 'ShiftLeft', 50], ['down', 'KeyT', 100], ['up', 'KeyT', 150], ['up', 'ShiftLeft', 200], ['up', 'ControlLeft', 220]]),
    ['Ctrl+Shift+KeyT'],
  );
});

test('des modificateurs tenus longtemps ne déclenchent rien', () => {
  assert.deepEqual(accomplies([['down', 'ControlLeft', 0], ['down', 'ShiftLeft', 50], ['up', 'ShiftLeft', 2000], ['up', 'ControlLeft', 2100]]), []);
});

test('l’auto-répétition d’une touche tenue est ignorée', () => {
  const r = creerReconnaisseur();
  assert.equal(r.recevoir({ type: 'down', code: 'ShiftLeft', t: 0, ctrl: false, alt: false, shift: true, meta: false }), null);
  assert.equal(r.recevoir({ type: 'down', code: 'ShiftLeft', t: 30, ctrl: false, alt: false, shift: true, meta: false, repeat: true }), null);
  assert.equal(r.recevoir({ type: 'up', code: 'ShiftLeft', t: 60, ctrl: false, alt: false, shift: false, meta: false }), null);
  assert.equal(r.recevoir({ type: 'down', code: 'ShiftLeft', t: 150, ctrl: false, alt: false, shift: true, meta: false }), null);
  assert.equal(r.recevoir({ type: 'up', code: 'ShiftLeft', t: 200, ctrl: false, alt: false, shift: false, meta: false }), 'Double:Shift');
});

test('une combinaison se reconnaît à l’appui de sa touche', () => {
  assert.deepEqual(accomplies([['down', 'MetaLeft', 0], ['down', 'KeyK', 40]]), ['Meta+KeyK']);
});
