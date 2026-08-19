import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formeDeJour,
  formeHeureCourte,
  heureExacte,
  memeJour,
  separateurDeJour,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* L'heure et la date sous les messages du fil                         */
/* ------------------------------------------------------------------ */

/** Le 3 août 2026 à 14 h 22 min 05 s, heure locale. */
const base = new Date(2026, 7, 3, 14, 22, 5).getTime();
const minutes = (n: number) => base + n * 60_000;
const jours = (n: number) => new Date(2026, 7, 3 + n, 14, 22, 5).getTime();

test('deux instants du même jour se reconnaissent', () => {
  assert.equal(memeJour(base, new Date(2026, 7, 3, 0, 5).getTime()), true);
  assert.equal(memeJour(base, new Date(2026, 7, 4, 0, 5).getTime()), false);
  // Même jour du mois, mais pas le même mois ni la même année.
  assert.equal(memeJour(base, new Date(2026, 8, 3, 14, 22).getTime()), false);
  assert.equal(memeJour(base, new Date(2025, 7, 3, 14, 22).getTime()), false);
  assert.equal(memeJour(undefined, base), false);
});

test('le premier message du fil ouvre son jour', () => {
  assert.equal(separateurDeJour([{ createdAt: base }], 0), true);
});

test('le séparateur ne tombe qu’aux changements de jour', () => {
  const fil = [
    { createdAt: jours(0) },
    { createdAt: jours(0) + 3_600_000 }, // même jour, une heure plus tard
    { createdAt: jours(1) }, // lendemain
    { createdAt: jours(1) + 60_000 },
    { createdAt: jours(3) }, // deux jours plus tard
  ];
  assert.deepEqual(
    fil.map((_, index) => separateurDeJour(fil, index)),
    [true, false, true, false, true],
  );
});

test('un index hors du fil ne pose aucun séparateur', () => {
  assert.equal(separateurDeJour([{ createdAt: base }], 7), false);
});

test('l’heure sous une bulle reste courte, et change de forme avec l’âge', () => {
  const maintenant = minutes(0);
  assert.deepEqual(formeHeureCourte(minutes(0), maintenant), { genre: 'instant' });
  assert.deepEqual(formeHeureCourte(minutes(-5), maintenant), { genre: 'minutes', minutes: 5 });
  assert.deepEqual(formeHeureCourte(minutes(-59), maintenant), { genre: 'minutes', minutes: 59 });
  // Passé l'heure, mais toujours le même jour : l'heure seule suffit.
  assert.deepEqual(formeHeureCourte(new Date(2026, 7, 3, 8, 43).getTime(), maintenant), {
    genre: 'heure',
  });
  // La veille : la date revient avec l'heure.
  assert.deepEqual(formeHeureCourte(jours(-1), maintenant), { genre: 'dateEtHeure' });
});

test('le jour d’un séparateur se dit « aujourd’hui », « hier », ou en toutes lettres', () => {
  const maintenant = minutes(0);
  assert.deepEqual(formeDeJour(base, maintenant), { genre: 'aujourdhui' });
  assert.deepEqual(formeDeJour(jours(-1), maintenant), { genre: 'hier' });
  assert.deepEqual(formeDeJour(jours(-2), maintenant), { genre: 'date' });
  // Le premier du mois : « hier » se calcule sur le calendrier, pas sur 24 h.
  const premierSeptembre = new Date(2026, 8, 1, 9, 0).getTime();
  const trenteEtUnAout = new Date(2026, 7, 31, 23, 30).getTime();
  assert.deepEqual(formeDeJour(trenteEtUnAout, premierSeptembre), { genre: 'hier' });
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
