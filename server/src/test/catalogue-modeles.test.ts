import test from 'node:test';
import assert from 'node:assert/strict';
import { dedoublonnerModeles, familleDeModele, limiterAuxPlusRecents, messageDeRepli, ModelInfo } from '@haikodev/shared';
import { versionOf } from '../engines/catalog.js';

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

test('seule la version la plus récente de chaque famille survit, dans l’ordre reçu', () => {
  const rendu = limiterAuxPlusRecents([
    modele('claude-opus-5', 'Opus 5'),
    modele('claude-opus-4-8', 'Opus 4.8'),
    modele('claude-4.5-opus', 'Opus 4.5'),
    modele('claude-sonnet-5', 'Sonnet 5'),
    modele('composer-2.5', 'Composer 2.5'),
  ]);
  assert.deepEqual(
    rendu.map((m) => m.id),
    ['claude-opus-5', 'claude-sonnet-5', 'composer-2.5'],
  );
});

test('des familles nombreuses ne se font plus couper : aucune ne disparaît du menu', () => {
  // Le défaut réparé : couper la liste ENTIÈRE aux trois plus récents ne
  // retirait pas des vieilleries, il retirait Composer, Grok, Opus et Sonnet.
  const rendu = limiterAuxPlusRecents([
    modele('gpt-5.6-luna', 'GPT-5.6 Luna'),
    modele('gpt-5.6-sol', 'GPT-5.6 Sol'),
    modele('gpt-5.6-terra', 'GPT-5.6 Terra'),
    modele('cursor-grok-4.6', 'Cursor Grok 4.6'),
    modele('composer-2.5', 'Composer 2.5'),
  ]);
  assert.equal(rendu.length, 5);
  assert.ok(rendu.some((m) => m.id === 'composer-2.5'));
  assert.ok(rendu.some((m) => m.id === 'cursor-grok-4.6'));
});

test('deux variantes d’un même numéro sont deux familles, pas deux versions', () => {
  assert.notEqual(familleDeModele({ id: 'gpt-5.6-sol' }), familleDeModele({ id: 'gpt-5.6-luna' }));
  assert.equal(familleDeModele({ id: 'claude-opus-4-8' }), familleDeModele({ id: 'claude-opus-5' }));
  assert.equal(familleDeModele({ id: 'claude-4.5-opus' }), 'claude-opus');
  // Un segment qui n'est pas QUE un nombre fait partie du nom : « k3 » reste.
  assert.equal(familleDeModele({ id: 'kimi-k3' }), 'kimi-k3');
});

test('une famille réfléchie n’en écrase pas une ordinaire', () => {
  const rendu = limiterAuxPlusRecents([
    modele('claude-opus-5-thinking', 'Opus 5 Thinking'),
    modele('claude-opus-5', 'Opus 5'),
  ]);
  assert.equal(rendu.length, 2);
});

test('une version sans partie mineure est bien la plus récente', () => {
  // « Opus 5 1M » n'avait aucune version (0) tant que la mineure était exigée :
  // il passait derrière « Opus 4.8 1M » et le menu jetait la nouvelle version.
  assert.ok(versionOf({ id: 'claude-opus-5', label: 'Opus 5 1M' }) > versionOf({ id: 'claude-opus-4-8', label: 'Opus 4.8 1M' }));
  assert.ok(versionOf({ id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol 1M' }) > versionOf({ id: 'gpt-5.5', label: 'GPT-5.5 1M' }));
  assert.equal(versionOf({ id: 'auto', label: 'Auto' }), 0);
});
