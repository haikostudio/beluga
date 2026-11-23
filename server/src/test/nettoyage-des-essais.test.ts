import test from 'node:test';
import assert from 'node:assert/strict';
import { raisonDeGarderLaCarte, titreDeCarteDEssai } from '@beluga/shared';

test('une vraie carte qui contient « témoin » au milieu de son titre n’est pas une carte d’essai', () => {
  assert.equal(titreDeCarteDEssai('Colonne repliée et témoin du serveur'), false);
  assert.equal(titreDeCarteDEssai('Le témoin de réflexion clignote'), false);
  assert.equal(titreDeCarteDEssai('carte témoin'), false, 'la casse compte');
});

test('les titres posés par les scripts d’essai sont reconnus', () => {
  for (const t of ['Carte témoin', 'Carte témoin de notification 3', "Carte d'essai — glisser", 'Essai témoin', 'Vérification automatique : proposition', 'Essai création 12']) {
    assert.equal(titreDeCarteDEssai(t), true, t);
  }
});

test('une carte d’essai où quelqu’un tient encore n’est pas effacée', () => {
  const base = { titre: 'Carte témoin', agents: [{ id: 'a1', statut: 'done' }], enFile: 0 };
  assert.equal(raisonDeGarderLaCarte(base), null);
  assert.ok(raisonDeGarderLaCarte({ ...base, agents: [{ id: 'a1', statut: 'running' }] }));
  assert.ok(raisonDeGarderLaCarte({ ...base, enFile: 1 }));
  assert.ok(raisonDeGarderLaCarte(base, 'a1'), 'la carte de l’agent qui lance le nettoyage');
  assert.ok(raisonDeGarderLaCarte({ ...base, titre: 'Colonne repliée et témoin du serveur' }));
});
