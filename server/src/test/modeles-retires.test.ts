/**
 * UN MODÈLE RETIRÉ PAR LA MISE À JOUR DU MOTEUR : les réglages mémorisés (défaut
 * du projet, réglage de cadrage, carte planifiée) passent à la version actuelle
 * de leur famille ; l'historique (carte lancée) ne bouge pas ; une liste de
 * secours ne déclenche rien.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Card, EngineInfo } from '@beluga/shared';

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'modeles-retires-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const { suivreLesModelesRetires } = await import('../modeles-retires.js');

const niveaux = [
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'Réflexion haute' },
];
function catalogue(live: boolean): EngineInfo[] {
  return [
    {
      id: 'claude',
      label: 'Claude',
      installed: true,
      live,
      defaultModel: 'claude-sonnet-5',
      models: [
        { id: 'claude-opus-5-5', label: 'Opus 5.5', thinking: niveaux },
        { id: 'claude-sonnet-5', label: 'Sonnet 5', thinking: niveaux },
      ],
    },
  ];
}

const projet = store.saveProject({
  id: store.newId(),
  name: 'ETSigna (essai)',
  path: bacASable,
  defaultEngine: 'claude',
  defaultModel: 'claude-opus-5',
  defaultThinking: 'high',
  isSelf: false,
  archived: false,
  createdAt: store.now(),
  updatedAt: store.now(),
} as any);

function carte(column: 'planned' | 'archived') {
  return store.saveCard(
    Card.parse({
      id: store.newId(),
      projectId: projet.id,
      title: `Carte ${column}`,
      column,
      position: 1,
      run: { engine: 'claude', model: 'claude-opus-5', thinking: 'high', mode: 'direct' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}
const planifiee = carte('planned');
const terminee = carte('archived');
store.saveSettings({ cadrageEngine: 'claude', cadrageModel: 'claude-opus-5', cadrageThinking: 'high' });

test('une liste de secours ne réécrit rien', () => {
  assert.equal(suivreLesModelesRetires(catalogue(false)), 0);
  assert.equal(store.getProject(projet.id)?.defaultModel, 'claude-opus-5');
});

test('les réglages qui serviront passent à la version actuelle, l’historique reste', () => {
  assert.equal(suivreLesModelesRetires(catalogue(true)), 3);
  const p = store.getProject(projet.id)!;
  assert.equal(p.defaultModel, 'claude-opus-5-5');
  assert.equal(p.defaultThinking, 'high');
  assert.equal(store.getSettings().cadrageModel, 'claude-opus-5-5');
  assert.equal(store.getCard(planifiee.id)?.run?.model, 'claude-opus-5-5');
  assert.equal(store.getCard(terminee.id)?.run?.model, 'claude-opus-5');
  // Rejoué : plus rien à faire, aucune boucle.
  assert.equal(suivreLesModelesRetires(catalogue(true)), 0);
});
