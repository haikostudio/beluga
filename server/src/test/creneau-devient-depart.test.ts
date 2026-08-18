import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * LE CRÉNEAU CONSEILLÉ DEVIENT UN VRAI DÉPART AUTOMATIQUE.
 *
 * `createCard` (server/src/tools.ts) calculait déjà le créneau conseillé sans
 * appeler le moindre moteur. Il le recopie maintenant tout seul dans
 * `scheduling.departPrevu` — la carte part donc à l'heure dite, exactement
 * comme si cette date avait été posée à la main (`shared/src/depart-programme.ts`,
 * `demarrageAutomatiqueAutorise`). Une carte qui naît DÉJÀ datée n'y touche pas.
 */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'creneau-devient-depart-'));
process.env.HAIKODEV_DATA = bacASable;

const store = await import('../store.js');
const { createCard } = await import('../tools.js');
const { demarrageAutomatiqueAutorise, etatDuDepart } = await import('@haikodev/shared');

function projetDEssai() {
  return store.saveProject({
    id: store.newId(),
    name: 'Projet d’essai',
    path: bacASable,
    defaultEngine: 'claude',
    isSelf: false,
    archived: false,
    createdAt: store.now(),
    updatedAt: store.now(),
  } as any);
}

test('une carte sans date NAÎT avec son créneau déjà recopié dans departPrevu', () => {
  const projet = projetDEssai();
  const card = createCard(projet.id, { title: 'Carte sans date', description: 'Essai.' });

  assert.equal(typeof card.scheduling?.departPrevu, 'number');
  assert.ok(card.scheduling!.departPrevu! > store.now(), 'le départ retenu doit rester dans le futur');
  assert.equal(card.scheduling?.creneauAutomatique, true);
  assert.ok(card.scheduling?.creneauConseille, 'le créneau d’origine reste sur la carte, pour l’expliquer');

  // Exactement comme une date posée à la main : l’heure dite autorise le
  // départ automatique, sans aucun autre geste.
  assert.equal(etatDuDepart(card.scheduling, card.scheduling!.departPrevu! + 1), 'venu');
  assert.equal(demarrageAutomatiqueAutorise(card.scheduling, card.scheduling!.departPrevu! + 1), true);
  // Et rien ne part avant l’heure dite.
  assert.equal(demarrageAutomatiqueAutorise(card.scheduling, card.scheduling!.departPrevu! - 1), false);
});

test('une carte qui naît déjà datée n’a pas de créneau à lui appliquer par-dessus', () => {
  const projet = projetDEssai();
  const date = store.now() + 5 * 60 * 60 * 1000;
  const card = createCard(projet.id, { title: 'Carte déjà datée', description: 'Essai.', departPrevu: date });

  assert.equal(card.scheduling?.departPrevu, date);
  assert.equal(card.scheduling?.creneauConseille, undefined);
  assert.equal(card.scheduling?.creneauAutomatique, undefined);
});
