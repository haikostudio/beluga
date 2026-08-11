import test from 'node:test';
import assert from 'node:assert/strict';
import { dedoublonnerModeles, limiterAuxPlusRecents, messageDeRepli, ModelInfo } from '@haikodev/shared';

function modele(id: string, label: string): ModelInfo {
  return ModelInfo.parse({ id, label, thinking: [{ id: 'medium', label: 'Réflexion moyenne' }] });
}

test('deux modèles différents qui portent le même nom survivent tous les deux', () => {
  const rendu = dedoublonnerModeles([
    modele('gpt-5.6-sol', 'GPT-5.6'),
    modele('gpt-5.6-terra', 'GPT-5.6'),
    modele('gpt-5.1-codex-max', 'GPT-5.1 Codex Max'),
  ]);
  assert.equal(rendu.length, 3);
  assert.deepEqual(
    rendu.map((m) => m.id),
    ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.1-codex-max'],
  );
});

test('les homonymes portent leur identifiant en repère, les autres non', () => {
  const rendu = dedoublonnerModeles([
    modele('gpt-5.6-sol', 'GPT-5.6'),
    modele('gpt-5.6-terra', 'GPT-5.6'),
    modele('gpt-5.1-codex', 'GPT-5.1 Codex'),
  ]);
  assert.equal(rendu.find((m) => m.id === 'gpt-5.6-sol')?.note, 'gpt-5.6-sol');
  assert.equal(rendu.find((m) => m.id === 'gpt-5.6-terra')?.note, 'gpt-5.6-terra');
  assert.equal(rendu.find((m) => m.id === 'gpt-5.1-codex')?.note, undefined);
});

test('un même identifiant rendu deux fois ne compte que pour un, dans l’ordre reçu', () => {
  const rendu = dedoublonnerModeles([
    modele('gpt-5.6-sol', 'GPT-5.6 Sol'),
    modele('gpt-5.1-codex', 'GPT-5.1 Codex'),
    modele('gpt-5.6-sol', 'Autre nom'),
  ]);
  assert.deepEqual(
    rendu.map((m) => m.id),
    ['gpt-5.6-sol', 'gpt-5.1-codex'],
  );
  assert.equal(rendu[0].label, 'GPT-5.6 Sol');
});

test('une liste venue du moteur ne porte aucun avertissement', () => {
  assert.equal(messageDeRepli({ installed: true, live: true }), null);
  assert.equal(messageDeRepli({ installed: true, live: true, catalogError: 'réponse 401' }), null);
});

test('une liste de secours le DIT, avec la cause quand le moteur la donne', () => {
  const avec = messageDeRepli({ installed: true, live: false, catalogError: 'réponse 401 — session terminée' });
  assert.ok(avec?.includes('secours'));
  assert.ok(avec?.includes('session terminée'));

  const sans = messageDeRepli({ installed: true, live: false });
  assert.ok(sans?.includes('secours'));
});

test('un moteur non installé n’a pas de liste, donc rien à avertir', () => {
  assert.equal(messageDeRepli({ installed: false, live: false, catalogError: 'réponse 401' }), null);
  assert.equal(messageDeRepli(undefined), null);
});

test('seuls les 3 modèles les plus récents survivent, dans l’ordre reçu', () => {
  const rendu = limiterAuxPlusRecents([
    modele('m1', 'Modèle 1'),
    modele('m2', 'Modèle 2'),
    modele('m3', 'Modèle 3'),
    modele('m4', 'Modèle 4'),
    modele('m5', 'Modèle 5'),
  ]);
  assert.deepEqual(
    rendu.map((m) => m.id),
    ['m1', 'm2', 'm3'],
  );
});

test('une liste de 3 modèles ou moins ne perd rien', () => {
  const rendu = limiterAuxPlusRecents([modele('m1', 'Modèle 1'), modele('m2', 'Modèle 2')]);
  assert.equal(rendu.length, 2);
});
