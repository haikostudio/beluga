import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LABEL_ENTRETIEN_INVISIBLE,
  carteCacheeDesListes,
  carteMarketingCachee,
  cartesAvecAgentActif,
  estTacheDeLaColonne,
  fluxDeLaColonne,
  ligneActive,
  signauxSansLigne,
} from '@beluga/shared';

const creation = { labels: ['studio'], column: 'planned', parcours: { realisationSouhaitee: true } };
const atelier = { labels: ['marketing'], column: 'planned' };

test('le directeur du Studio paraît dans les listes, même fini, et reste caché du tableau', () => {
  assert.equal(carteCacheeDesListes(creation), false);
  assert.equal(carteCacheeDesListes({ ...creation, column: 'archived' }), false);
  assert.equal(carteMarketingCachee(creation), true);
});

test('une carte d’atelier ne paraît dans les listes que le temps de son travail', () => {
  assert.equal(carteCacheeDesListes(atelier), true);
  assert.equal(carteCacheeDesListes(atelier, true), false);
  assert.equal(carteMarketingCachee(atelier), true);
});

test('une routine d’entretien invisible ne paraît jamais, même active', () => {
  assert.equal(carteCacheeDesListes({ labels: [LABEL_ENTRETIEN_INVISIBLE], column: 'running' }, true), true);
});

test('une carte ordinaire n’est jamais cachée', () => {
  assert.equal(carteCacheeDesListes({ labels: [], column: 'archived' }), false);
});

test('les cartes actives : un agent au travail ou qui attend, jamais un cadrage qui a répondu', () => {
  const actives = cartesAvecAgentActif([
    { cardId: 'travail', role: 'task', status: 'running' },
    { cardId: 'question', role: 'task', status: 'idle', attendReponse: true },
    { cardId: 'repos', role: 'task', status: 'idle', endedAt: 1 },
    { role: 'task', status: 'running' },
  ]);
  assert.deepEqual([...actives].sort(), ['question', 'travail']);
});

test('une carte rangée où un agent est actif reste une tâche de la colonne', () => {
  assert.equal(estTacheDeLaColonne({ column: 'archived' }, true), true);
  assert.equal(estTacheDeLaColonne({ column: 'archived' }), false);
});

test('une ligne active ancienne ne reste pas sous « Voir plus », une rangée si', () => {
  const ligne = (id: string, etat: 'travail' | 'en-ligne', updatedAt: number) => ({ carte: { id, updatedAt, column: 'planned' as const, renduA: 0 }, etat });
  const lignes = [ligne('recente', 'en-ligne', 30), ligne('moyenne', 'en-ligne', 20), ligne('ancienne', 'travail', 10), ligne('vieille', 'en-ligne', 5)];
  const flux = fluxDeLaColonne(lignes, new Set(['recente', 'moyenne', 'vieille']), 1, (l) => ligneActive(l));
  assert.deepEqual(flux.map((l) => l.carte.id), ['recente', 'ancienne']);
});

test('depuis le 01/11/2026, un brouillon et un départ programmé sont actifs : ils ne partent plus sous « Voir plus »', () => {
  assert.equal(ligneActive({ etat: 'lance', carte: {} }), true);
  assert.equal(ligneActive({ etat: 'brouillon', carte: {} }), true);
  assert.equal(ligneActive({ etat: 'a-vous', carte: {} }), true);
  assert.equal(ligneActive({ etat: 'archive', carte: {} }), false);
});

test('le dossier déplié : le signal ne s’efface que si ce qui attend a sa ligne', () => {
  const question = { projectId: 'p', genre: 'question' as const, cardId: 'c1' };
  const listees = new Set(['c1']);
  assert.equal(signauxSansLigne('p', [], [question], listees).attente, false);
  assert.equal(signauxSansLigne('p', [], [question], new Set()).attente, true);
  assert.equal(signauxSansLigne('p', [], [{ projectId: 'p', genre: 'question' as const }], listees).attente, true, 'une conversation sans carte garde sa bulle');
  assert.equal(signauxSansLigne('p', [], [{ ...question, reglee: true }], new Set()).attente, false);
  assert.equal(signauxSansLigne('p', [], [{ ...question, projectId: 'autre' }], new Set()).attente, false);
  assert.equal(signauxSansLigne('p', [], [], listees, 2).attente, true, 'un compte sans décision connue garde son signal');
});

test('le dossier déplié : le signe de travail suit la même règle, hors agents de service', () => {
  const agent = { projectId: 'p', role: 'task', status: 'running', cardId: 'c1' };
  assert.equal(signauxSansLigne('p', [agent], [], new Set(['c1'])).travail, false);
  assert.equal(signauxSansLigne('p', [agent], [], new Set()).travail, true);
  assert.equal(signauxSansLigne('p', [{ ...agent, cardId: undefined }], [], new Set()).travail, true);
  assert.equal(signauxSansLigne('p', [{ ...agent, service: {} }], [], new Set()).travail, false);
});
