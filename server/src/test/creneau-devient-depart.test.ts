import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * LE CRÉNEAU CONSEILLÉ RESTE UN CONSEIL — IL NE DEVIENT JAMAIS UN DÉPART.
 *
 * `createCard` (server/src/tools.ts) calcule le créneau conseillé sans appeler
 * le moindre moteur, et le garde sur la carte comme SUGGESTION. Il ne le
 * recopie plus dans `scheduling.departPrevu` : une date de départ est un geste
 * de l'utilisateur, jamais un calcul (demande du 14.09.2026). Une carte qui naît
 * avec une date DONNÉE la garde.
 */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'creneau-devient-depart-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const { createCard } = await import('../tools.js');
const { demarrageAutomatiqueAutorise } = await import('@beluga/shared');

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

test('une carte sans date garde son créneau en SUGGESTION, sans aucun départ programmé', () => {
  const projet = projetDEssai();
  const card = createCard(projet.id, { title: 'Carte sans date', description: 'Essai.' });

  assert.ok(card.scheduling?.creneauConseille, 'le créneau reste affiché comme conseil');
  assert.equal(card.scheduling?.departPrevu, undefined, 'aucune date posée toute seule');
  assert.equal(card.scheduling?.creneauAutomatique, undefined);
  // Rien ne la fait partir seule, même bien après l'heure conseillée.
  assert.equal(demarrageAutomatiqueAutorise(card.scheduling, store.now() + 3 * 24 * 60 * 60 * 1000), false);
});

test('une carte qui naît avec une date DONNÉE la garde, sans créneau par-dessus', () => {
  const projet = projetDEssai();
  const date = store.now() + 5 * 60 * 60 * 1000;
  const card = createCard(projet.id, { title: 'Carte déjà datée', description: 'Essai.', departPrevu: date });

  assert.equal(card.scheduling?.departPrevu, date);
  assert.equal(card.scheduling?.creneauConseille, undefined);
  assert.equal(card.scheduling?.creneauAutomatique, undefined);
});

test('aucun chemin du démon ne recopie le créneau dans departPrevu', () => {
  const racine = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'src');
  for (const fichier of ['tools.ts', 'auto-amelioration.ts']) {
    const source = fs.readFileSync(path.join(racine, fichier), 'utf8');
    assert.doesNotMatch(source, /departPrevu:\s*momentDuCreneau/, fichier);
    assert.doesNotMatch(source, /creneauAutomatique:\s*true/, fichier);
    assert.doesNotMatch(source, /departPrevu:\s*proposal\.departPrevu/, `${fichier} : la nuit ne date rien`);
  }
});
