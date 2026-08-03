import test from 'node:test';
import assert from 'node:assert/strict';
import { afficherHeure, heureExacte, memeMinute } from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* L'heure sous les messages : une seule par minute                    */
/* ------------------------------------------------------------------ */

/** Le 3 août 2026 à 14 h 22 min 05 s, heure locale. */
const base = new Date(2026, 7, 3, 14, 22, 5).getTime();
const secondes = (n: number) => base + n * 1000;

test('deux instants de la même minute se reconnaissent', () => {
  assert.equal(memeMinute(secondes(0), secondes(50)), true);
  // 14 h 22 min 05 s + 60 s tombe à 14 h 23 : minute suivante.
  assert.equal(memeMinute(secondes(0), secondes(60)), false);
  assert.equal(memeMinute(undefined, secondes(0)), false);
});

test("le dernier message du fil porte toujours son heure", () => {
  const fil = [{ createdAt: secondes(0) }];
  assert.equal(afficherHeure(fil, 0), true);
});

test('une suite écrite dans la même minute ne porte qu’une heure, à la fin', () => {
  const fil = [{ createdAt: secondes(0) }, { createdAt: secondes(20) }, { createdAt: secondes(45) }];
  assert.deepEqual(
    fil.map((_, index) => afficherHeure(fil, index)),
    [false, false, true],
  );
});

test('un message écrit une minute plus tard garde son heure', () => {
  const fil = [{ createdAt: secondes(0) }, { createdAt: secondes(120) }];
  assert.deepEqual(
    fil.map((_, index) => afficherHeure(fil, index)),
    [true, true],
  );
});

test("plusieurs groupes se suivent, chacun avec son heure de fin", () => {
  const fil = [
    { createdAt: secondes(0) },
    { createdAt: secondes(30) }, // même minute que le précédent
    { createdAt: secondes(120) }, // minute suivante, seul de son groupe
    { createdAt: secondes(180) },
    { createdAt: secondes(200) }, // même minute que le précédent
  ];
  assert.deepEqual(
    fil.map((_, index) => afficherHeure(fil, index)),
    [false, true, true, false, true],
  );
});

test("l'heure exacte donne le jour et la minute, jamais les secondes", () => {
  const texte = heureExacte(base);
  assert.match(texte, /2026/);
  assert.match(texte, /14:22/);
  assert.doesNotMatch(texte, /:05/);
  // Le jour se lit d'un trait : « lundi 3 août 2026 », sans virgule.
  assert.doesNotMatch(texte, /,/);
  assert.equal(heureExacte(undefined), '');
});
