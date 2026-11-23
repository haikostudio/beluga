import test from 'node:test';
import assert from 'node:assert/strict';
import {
  derniereActiviteDArchivage,
  horsArchivageAuto,
  joursAvantArchivageAuto,
  projetsAArchiverSeuls,
  refusDejaNote,
} from '@beluga/shared';

/*
 * L'ARCHIVAGE AUTOMATIQUE DES PROJETS — les règles pures (`shared/src/archivage-projet.ts`) : qui part la nuit,
 * quand, et ce qui n'y entre jamais.
 */

const JOUR = 24 * 60 * 60 * 1000;
const maintenant = Date.UTC(2026, 10, 20, 3);
const projet = (id: string, joursSansActivite: number, extra: Record<string, unknown> = {}) => ({
  id,
  createdAt: maintenant - 400 * JOUR,
  derniereActivite: maintenant - joursSansActivite * JOUR,
  ...extra,
});

test('seuls les projets endormis depuis le délai partent, le plus ancien d’abord', () => {
  const choix = projetsAArchiverSeuls([projet('a', 31), projet('b', 29), projet('c', 90), projet('d', 30)], { maintenant, jours: 30 });
  assert.deepEqual(choix.map((p) => p.id), ['c', 'a', 'd']);
});

test('jamais Beluga, ni un regroupement, ni une marque sans dépôt, ni un projet exempté, ni un projet déjà archivé ou en transfert', () => {
  const choix = projetsAArchiverSeuls(
    [
      projet('soi', 100, { isSelf: true }),
      projet('reg', 100, { regroupement: true }),
      projet('marque', 100, { marqueSansDepot: true }),
      projet('exempte', 100, { archivageAutoDesactive: true }),
      projet('archive', 100, { archived: true }),
      projet('transfert', 100, { archive: { etat: 'archivage' } }),
      projet('echec', 100, { archive: { etat: 'echec' } }),
    ],
    { maintenant, jours: 30 },
  );
  assert.deepEqual(choix.map((p) => p.id), ['echec']);
  assert.match(horsArchivageAuto({ id: 'x', createdAt: 0, archivageAutoDesactive: true })!, /coupé/);
});

test('un délai de 0 jour coupe tout', () => {
  assert.deepEqual(projetsAArchiverSeuls([projet('a', 900)], { maintenant, jours: 0 }), []);
  assert.equal(joursAvantArchivageAuto(projet('a', 900), { maintenant, jours: 0 }), null);
});

test('un projet neuf sans carte compte depuis sa création', () => {
  const neuf = { id: 'neuf', createdAt: maintenant - 3 * JOUR };
  assert.equal(derniereActiviteDArchivage(neuf), neuf.createdAt);
  assert.deepEqual(projetsAArchiverSeuls([neuf], { maintenant, jours: 30 }), []);
  assert.equal(joursAvantArchivageAuto(neuf, { maintenant, jours: 30 }), 27);
});

test('un projet qu’on vient de désarchiver ne repart pas la nuit même', () => {
  const p = projet('ancien', 200);
  const derniersDesarchivages = new Map([['ancien', maintenant - 2 * JOUR]]);
  assert.deepEqual(projetsAArchiverSeuls([p], { maintenant, jours: 30, derniersDesarchivages }), []);
  assert.equal(joursAvantArchivageAuto(p, { maintenant, jours: 30, dernierDesarchivage: maintenant - 2 * JOUR }), 28);
});

test('l’échéance : jours restants, 0 quand c’est cette nuit, rien pour un projet archivé', () => {
  assert.equal(joursAvantArchivageAuto(projet('a', 12), { maintenant, jours: 30 }), 18);
  assert.equal(joursAvantArchivageAuto(projet('a', 45), { maintenant, jours: 30 }), 0);
  assert.equal(joursAvantArchivageAuto(projet('a', 45, { archived: true }), { maintenant, jours: 30 }), null);
});

test('un refus de nuit ne se note qu’une fois par raison', () => {
  const dernier = { issue: 'refus' as const, origine: 'auto' as const, detail: 'site public' };
  assert.equal(refusDejaNote(dernier, 'site public'), true);
  assert.equal(refusDejaNote(dernier, 'agent au travail'), false);
  assert.equal(refusDejaNote({ ...dernier, origine: 'main' as const }, 'site public'), false);
  assert.equal(refusDejaNote(null, 'site public'), false);
});
