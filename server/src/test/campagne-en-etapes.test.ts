/** OÙ EN EST UNE CAMPAGNE : le fil d'étapes (`shared/src/campagne-en-etapes.ts`). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { filDeCampagne } from '@beluga/shared';

const etats = (f: ReturnType<typeof filDeCampagne>) => f.etapes.map((e) => `${e.id}:${e.etat}`);

test('une campagne sans contenu attend ses contenus, et ne montre aucun chiffre', () => {
  const f = filDeCampagne({ statut: 'preparation', publications: 0, aAccepter: 0, jourEcoule: 0, duree: 30 });
  assert.equal(f.enCours, 'contenus');
  assert.equal(f.chiffresVisibles, false);
  assert.deepEqual(etats(f), ['preparee:fait', 'contenus:en_cours', 'lancee:a_faire', 'diffusion:a_faire', 'bilan:a_faire']);
});

test('des contenus à accepter gardent l’étape « contenus » ouverte', () => {
  assert.equal(filDeCampagne({ statut: 'preparation', publications: 4, aAccepter: 2, jourEcoule: 0, duree: 30 }).enCours, 'contenus');
});

test('des contenus tous acceptés : il reste à lancer', () => {
  assert.equal(filDeCampagne({ statut: 'preparation', publications: 4, aAccepter: 0, jourEcoule: 0, duree: 30 }).enCours, 'lancee');
});

test('lancée : la diffusion court et les chiffres paraissent', () => {
  const f = filDeCampagne({ statut: 'en_cours', publications: 4, aAccepter: 0, jourEcoule: 3, duree: 30 });
  assert.equal(f.enCours, 'diffusion');
  assert.equal(f.chiffresVisibles, true);
});

test('la durée écoulée mène au bilan, et une campagne terminée a tout fait', () => {
  assert.equal(filDeCampagne({ statut: 'en_cours', publications: 4, aAccepter: 0, jourEcoule: 30, duree: 30 }).enCours, 'bilan');
  const fin = filDeCampagne({ statut: 'terminee', publications: 4, aAccepter: 0, jourEcoule: 30, duree: 30 });
  assert.equal(fin.enCours, null);
  assert.ok(fin.etapes.every((e) => e.etat === 'fait'));
});

test('une campagne sans date de fin reste en diffusion tant qu’on ne la clôt pas', () => {
  assert.equal(filDeCampagne({ statut: 'en_cours', publications: 1, aAccepter: 0, jourEcoule: 90, duree: 0 }).enCours, 'diffusion');
});
