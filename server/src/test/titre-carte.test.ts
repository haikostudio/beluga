import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MAX_SIGNES_TITRE, jugerTitre } from '@beluga/shared';

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'titre-carte-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const { callTool } = await import('../tools.js');

const SYNTHESE = [
  "L'utilisateur veut des titres courts sur ses cartes : le dernier était une phrase entière.",
  'Il a montré une capture où le titre recopiait toute la demande.',
  'Il ne veut toucher à rien d’autre dans le tableau.',
].join('\n');

const CARTE_COURTE =
  'Raccourcir les titres de carte : aujourd’hui certains recopient la demande entière au lieu de nommer le sujet en quelques mots.';

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

test('un titre court passe', () => {
  const verdict = jugerTitre('Corriger le clignotement de la colonne');
  assert.equal(verdict.ok, true);
});

test('un titre vide est refusé', () => {
  for (const vide of ['', '   ', undefined, null]) {
    assert.equal(jugerTitre(vide as any).ok, false);
  }
});

test('un titre-pavé (la description recopiée) est refusé', () => {
  const pave =
    'Il faut absolument corriger le fait que la colonne « À déployer » se met à clignoter de façon assez ' +
    'gênante dès qu’une carte y entre, ce qui perturbe la lecture du tableau au moment du déploiement';
  assert.ok(pave.length > MAX_SIGNES_TITRE);
  const verdict = jugerTitre(pave);
  assert.equal(verdict.ok, false);
  assert.match(verdict.message, /REFUS/i);
  assert.match(verdict.message, /court/i);
});

for (const outil of ['board_create_card', 'propose_task']) {
  test(`${outil} : un titre trop long ne devient pas une proposition`, async () => {
    const projet = projetDEssai();
    const resultat = await callTool({ projectId: projet.id, role: 'cadrage' } as any, outil, {
      title:
        'Il faut absolument corriger le fait que la colonne « À déployer » se met à clignoter de façon ' +
        'gênante dès qu’une carte y entre',
      description: CARTE_COURTE,
      contexte: SYNTHESE,
      niveau: 'leger',
    });
    assert.equal(resultat.ok, false);
    assert.equal(resultat.proposal, undefined);
    assert.match(resultat.text, /REFUS/i);
  });

  test(`${outil} : un titre court est accepté`, async () => {
    const projet = projetDEssai();
    const resultat = await callTool({ projectId: projet.id, role: 'cadrage' } as any, outil, {
      title: 'Raccourcir les titres de carte',
      description: CARTE_COURTE,
      contexte: SYNTHESE,
      niveau: 'leger',
    });
    assert.equal(resultat.ok, true, resultat.text);
    assert.equal(resultat.proposal?.title, 'Raccourcir les titres de carte');
  });
}

test('board_update_card : un nouveau titre trop long est refusé, sans toucher la carte', async () => {
  const projet = projetDEssai();
  const carte = store.saveCard({
    id: store.newId(),
    projectId: projet.id,
    title: 'Titre initial',
    description: 'une description',
    labels: [],
    attachments: [],
    column: 'planned',
    position: 0,
    origin: 'user',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    scheduling: { asap: false, attempts: 0, restarts: 0 },
    createdAt: store.now(),
    updatedAt: store.now(),
  } as any);
  const resultat = await callTool({ projectId: projet.id, role: 'cadrage' } as any, 'board_update_card', {
    cardId: carte.id,
    title:
      'Il faut absolument corriger le fait que la colonne « À déployer » se met à clignoter de façon ' +
      'gênante dès qu’une carte y entre',
  });
  assert.equal(resultat.ok, false);
  assert.equal(store.getCard(carte.id)?.title, 'Titre initial');
});
