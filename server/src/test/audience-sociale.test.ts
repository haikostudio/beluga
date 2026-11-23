import test from 'node:test';
import assert from 'node:assert/strict';
import { bilanDAudience, croissance, jourDecale, type ReleveAudience } from '@beluga/shared';

const ligne = (jour: string, publication: string, vues: number | null, abonnes: number | null = null, compteId = 'c1'): ReleveAudience => ({
  compteId,
  publication,
  jour,
  abonnes,
  vues,
  commentaires: vues === null ? null : 0,
  reactions: null,
});

test('la croissance se compare à la période d’avant, et dit quand elle ne peut pas', () => {
  assert.deepEqual(croissance(150, 100), { ecart: 50, pourcent: 50 });
  assert.deepEqual(croissance(50, 100), { ecart: -50, pourcent: -50 });
  assert.deepEqual(croissance(20, 0), { ecart: 20, pourcent: null });
  assert.equal(croissance(null, 10), null);
  assert.equal(croissance(10, null), null);
});

test('jourDecale traverse les mois', () => {
  assert.equal(jourDecale('2026-11-01', -1), '2026-10-31');
  assert.equal(jourDecale('2026-10-31', 1), '2026-11-01');
});

test('les vues d’une période sont ce que le compteur cumulé a gagné, pas sa valeur', () => {
  const bilan = bilanDAudience([ligne('2026-10-20', 'p1', 100), ligne('2026-10-28', 'p1', 130), ligne('2026-10-31', 'p1', 160)], 7, '2026-10-31');
  assert.equal(bilan.vues, 60);
  assert.equal(bilan.serieVues.length, 7);
});

test('une publication apparue dans la période compte en entier', () => {
  const bilan = bilanDAudience([ligne('2026-10-30', 'neuve', 40)], 7, '2026-10-31');
  assert.equal(bilan.vues, 40);
});

test('un compteur corrigé à la baisse ne fait pas de vues négatives', () => {
  const bilan = bilanDAudience([ligne('2026-10-10', 'p1', 100), ligne('2026-10-30', 'p1', 90)], 7, '2026-10-31');
  assert.equal(bilan.vues, 0);
});

test('un réseau qui ne donne pas un chiffre reste « null », jamais zéro', () => {
  const bilan = bilanDAudience([ligne('2026-10-30', 'p1', null, null)], 7, '2026-10-31');
  assert.equal(bilan.vues, null);
  assert.equal(bilan.abonnes, null);
  assert.equal(bilan.croissanceVues, null);
});

test('les abonnés s’additionnent par compte, au dernier relevé, et se comparent à la veille de la période', () => {
  const bilan = bilanDAudience(
    [ligne('2026-10-20', '', null, 100), ligne('2026-10-30', '', null, 120), ligne('2026-10-30', '', null, 50, 'c2'), ligne('2026-10-20', '', null, 50, 'c2')],
    7,
    '2026-10-31',
  );
  assert.equal(bilan.abonnes, 170);
  assert.deepEqual(bilan.croissanceAbonnes, { ecart: 20, pourcent: 13 });
});
