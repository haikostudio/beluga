import test from 'node:test';
import assert from 'node:assert/strict';
import { repliApresObservation } from '@beluga/shared';

test('repli de fin de tour : seule une transition observée agit', () => {
  let e = repliApresObservation({ occupeAvant: undefined, replie: false }, false);
  assert.deepEqual(e, { occupeAvant: false, replie: false }, 'conversation déjà inactive : rien ne se replie');
  e = repliApresObservation(e, true);
  assert.equal(e.replie, false);
  e = repliApresObservation(e, false);
  assert.equal(e.replie, true, 'occupé → inactif : replié');
  e = repliApresObservation(e, false);
  assert.equal(e.replie, true, 'aucun changement : le repli tient');
  e = repliApresObservation(e, true);
  assert.equal(e.replie, false, 'inactif → occupé : rouvert');
});

test('repli de fin de tour : une question en attente ne replie pas', () => {
  const e = repliApresObservation({ occupeAvant: true, replie: false }, false, { questionEnAttente: true });
  assert.equal(e.replie, false);
});

test('étiquette « Pas dans le PDF » : la variante claire ne vaut que pour les pages peintes', async () => {
  const { documentDeLaPlaquette } = await import('@beluga/shared');
  const d = documentDeLaPlaquette(
    { titre: 'A', format: 'diapositives', marque: { nom: 'A', couleur: '#1d4ed8', texte: '#111827', fond: '#ffffff' }, blocs: [{ id: 's', genre: 'sommaire', titre: 'Sommaire', ordre: 0, horsPdf: true }] } as never,
    { mode: 'document', image: () => null, edition: { masquee: 'M', titre: 'T', texte: 'X', horsPdf: 'Pas dans le PDF' } },
  );
  assert.ok(!/\.feuille\.fixe\.hors::before\{[^}]*color:#ffffff/.test(d.css), 'une feuille fixe claire ne reçoit plus du blanc');
  assert.match(d.css, /\.couverture\.hors::before,\.partie\.hors::before,\.diapo\.appel\.hors::before\{background:#ffffff33;color:#ffffff\}/);
  assert.match(d.css, /\.hors::before\{content:attr\(data-hors\)[^}]*color:#1d4ed8/, 'sur une page claire, l’étiquette prend la couleur de la marque');
});
