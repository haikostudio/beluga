import test from 'node:test';
import assert from 'node:assert/strict';
import { IdMoteur, MoteurCatalogue, reglagesDeLaProposition } from '@haikodev/shared';

/** Un catalogue proche du vrai : deux moteurs, leurs modèles, leurs niveaux. */
function catalogue(patch: Partial<Record<IdMoteur, Partial<MoteurCatalogue>>> = {}): MoteurCatalogue[] {
  const base: MoteurCatalogue[] = [
    {
      id: 'claude',
      label: 'Claude Code',
      installed: true,
      models: [
        { id: 'claude-opus-5', thinking: [{ id: 'low' }, { id: 'high' }], defaultThinking: 'high' },
        { id: 'claude-sonnet-5', thinking: [{ id: 'low' }, { id: 'high' }], defaultThinking: 'low' },
      ],
      defaultModel: 'claude-sonnet-5',
      comptesDisponibles: 1,
    },
    {
      id: 'codex',
      label: 'Codex',
      installed: true,
      models: [
        { id: 'gpt-5.1-codex-max', thinking: [{ id: 'medium' }, { id: 'xhigh' }], defaultThinking: 'medium' },
        { id: 'gpt-5.1-codex', thinking: [{ id: 'medium' }], defaultThinking: 'medium' },
      ],
      defaultModel: 'gpt-5.1-codex-max',
      comptesDisponibles: 1,
    },
  ];
  return base.map((m) => ({ ...m, ...(patch[m.id] ?? {}) }));
}

/** Le défaut d'origine : la carte proposée ne portait aucun réglage et repartait
 *  sur le moteur par défaut du projet — du Claude après une heure de Codex. */
test('la proposition reprend le moteur de la conversation', () => {
  const retenu = reglagesDeLaProposition({ engine: 'codex', model: 'gpt-5.1-codex', thinking: 'medium' }, catalogue());
  assert.equal(retenu?.engine, 'codex');
  assert.equal(retenu?.model, 'gpt-5.1-codex');
  assert.equal(retenu?.thinking, 'medium');
  assert.equal(retenu?.avertissement, undefined);
});

/** Le cœur de la carte : jamais un modèle emprunté à l'autre moteur. */
test('une proposition faite sous Codex ne peut pas porter un modèle Claude', () => {
  const retenu = reglagesDeLaProposition({ engine: 'codex', model: 'claude-opus-5', thinking: 'high' }, catalogue());
  assert.equal(retenu?.engine, 'codex');
  assert.ok(retenu?.model?.startsWith('gpt-'), `modèle hors catalogue Codex : ${retenu?.model}`);
  assert.ok(
    ['medium', 'xhigh'].includes(retenu!.thinking),
    `niveau de réflexion inconnu de Codex : ${retenu?.thinking}`,
  );
});

/** Et dans l'autre sens : un identifiant Codex ne survit pas sous Claude. */
test('une proposition faite sous Claude ne peut pas porter un modèle Codex', () => {
  const retenu = reglagesDeLaProposition({ engine: 'claude', model: 'gpt-5.1-codex-max' }, catalogue());
  assert.equal(retenu?.engine, 'claude');
  assert.equal(retenu?.model, 'claude-sonnet-5');
  assert.equal(retenu?.thinking, 'low');
});

/** Un niveau de réflexion inventé retombe sur celui du modèle, pas sur du vide. */
test('le niveau de réflexion retenu existe pour le modèle retenu', () => {
  const retenu = reglagesDeLaProposition({ engine: 'claude', model: 'claude-opus-5', thinking: 'xhigh' }, catalogue());
  assert.equal(retenu?.thinking, 'high');
});

/** Aucun compte : on le DIT, on ne bascule pas de moteur en douce. */
test('un moteur sans compte disponible se dit sur la proposition', () => {
  const retenu = reglagesDeLaProposition(
    { engine: 'codex' },
    catalogue({ codex: { comptesDisponibles: 0 } }),
  );
  assert.equal(retenu?.engine, 'codex', 'le moteur choisi ne doit pas changer dans le dos');
  assert.match(retenu?.avertissement ?? '', /[Aa]ucun compte/);
});

/** Un moteur non installé, lui, ne peut pas exécuter : la bascule se dit aussi. */
test('un moteur absent se dit, et la carte part sur le moteur installé', () => {
  const retenu = reglagesDeLaProposition(
    { engine: 'codex', model: 'gpt-5.1-codex' },
    catalogue({ codex: { installed: false } }),
  );
  assert.equal(retenu?.engine, 'claude');
  assert.equal(retenu?.model, 'claude-sonnet-5', 'le modèle Codex ne doit pas être traîné chez Claude');
  assert.match(retenu?.avertissement ?? '', /pas installé/);
});

/** Sans souhait, on prend un réglage entier plutôt que du vide. */
test('sans réglage souhaité, la proposition porte quand même un choix entier', () => {
  const retenu = reglagesDeLaProposition(undefined, catalogue());
  assert.ok(retenu?.engine);
  assert.ok(retenu?.model);
  assert.ok(retenu?.thinking);
});

/** Aucun moteur installé : rien à proposer, et surtout rien d'inventé. */
test('sans moteur installé, aucun réglage n’est inventé', () => {
  const aucun = catalogue({ claude: { installed: false }, codex: { installed: false } });
  assert.equal(reglagesDeLaProposition({ engine: 'claude' }, aucun), undefined);
});
