import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dedoublonnerModeles,
  etiquetteDuRun,
  EngineInfo,
  familleDeModele,
  limiterAuxPlusRecents,
  messageDeRepli,
  migrationDeReglage,
  modeleActuel,
  ModelInfo,
  niveauDeReflexionQuiPart,
  resoudreRun,
} from '@beluga/shared';
import { modelesCodexDepuisEntrees, versionOf } from '../engines/catalog.js';

function modele(id: string, label: string): ModelInfo {
  return ModelInfo.parse({ id, label, thinking: [{ id: 'medium', label: 'Medium' }] });
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

test('GPT conserve Astra et toutes les versions réellement annoncées', () => {
  const rendu = modelesCodexDepuisEntrees([
    { slug: 'gpt-5.6-astra', display_name: 'GPT-5.6 Astra', supported_reasoning_levels: [{ effort: 'medium' }] },
    { slug: 'gpt-5.5-astra', display_name: 'GPT-5.5 Astra', supported_reasoning_levels: [{ effort: 'medium' }] },
    { slug: 'gpt-5.6-astra', display_name: 'Doublon strict', supported_reasoning_levels: [{ effort: 'medium' }] },
  ]);
  assert.deepEqual(rendu.map((m) => m.id), ['gpt-5.6-astra', 'gpt-5.5-astra']);
  assert.equal(rendu[0].label, 'GPT-5.6 Astra');
});

test('le sélecteur garde le catalogue du moteur affiché après changement et rafraîchissement', () => {
  const thinking = [{ id: 'medium', label: 'Medium' }];
  const engines: EngineInfo[] = [
    { id: 'claude', label: 'Claude', installed: true, live: true, models: [modele('claude-sonnet-5', 'Sonnet 5')] },
    {
      id: 'codex',
      label: 'Codex',
      installed: true,
      live: true,
      defaultModel: 'gpt-5.6-astra',
      models: [
        { id: 'gpt-5.6-astra', label: 'GPT-5.6 Astra', thinking },
        { id: 'gpt-5.5', label: 'GPT-5.5', thinking },
      ],
    },
  ];

  const sousGpt = resoudreRun(engines, { engine: 'codex', model: 'claude-sonnet-5' });
  assert.equal(sousGpt.engine?.id, 'codex');
  assert.deepEqual(sousGpt.models.map((m) => m.id), ['gpt-5.6-astra', 'gpt-5.5']);
  assert.equal(sousGpt.model?.id, 'gpt-5.6-astra');

  const rafraichi = resoudreRun(
    engines.map((engine) =>
      engine.id === 'codex' ? { ...engine, defaultModel: 'gpt-5.5', models: [engine.models[1]] } : engine,
    ),
    { engine: 'codex', model: 'gpt-5.6-astra' },
  );
  assert.equal(rafraichi.engine?.id, 'codex');
  assert.equal(rafraichi.model?.id, 'gpt-5.5');
  assert.ok(rafraichi.models.every((m) => m.id.startsWith('gpt-')));
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

/* Un modèle retiré par la mise à jour du moteur suit sa famille. */

function claudeApresMiseAJour(live = true): EngineInfo {
  const niveaux = [
    { id: 'medium', label: 'Medium' },
    { id: 'high', label: 'Réflexion haute' },
  ];
  return {
    id: 'claude',
    label: 'Claude',
    installed: true,
    live,
    defaultModel: 'claude-sonnet-5',
    models: [
      { id: 'claude-opus-5-5', label: 'Opus 5.5', thinking: niveaux },
      { id: 'claude-sonnet-5', label: 'Sonnet 5', thinking: niveaux },
      { id: 'claude-haiku-4-5', label: 'Haiku 4.5', thinking: [{ id: 'none', label: 'Sans réflexion' }] },
    ],
  };
}

test('un modèle retiré passe à la version la plus récente de SA famille', () => {
  const engine = claudeApresMiseAJour();
  assert.equal(modeleActuel(engine, 'claude-opus-5')?.id, 'claude-opus-5-5');
  assert.equal(modeleActuel(engine, 'claude-sonnet-4-6')?.id, 'claude-sonnet-5');
  assert.equal(modeleActuel(engine, 'claude-opus-5-5')?.id, 'claude-opus-5-5');
});

test('une famille disparue retombe sur le défaut du moteur', () => {
  const engine = claudeApresMiseAJour();
  assert.equal(modeleActuel(engine, 'claude-mythos-2')?.id, 'claude-sonnet-5');
  assert.equal(modeleActuel(engine, undefined)?.id, 'claude-sonnet-5');
});

test('le sélecteur affiche la version actuelle et garde le niveau de réflexion', () => {
  const vu = resoudreRun([claudeApresMiseAJour()], { engine: 'claude', model: 'claude-opus-5', thinking: 'high' });
  assert.equal(vu.model?.label, 'Opus 5.5');
  assert.equal(vu.thinking?.id, 'high');
});

test('la migration à écrire garde la réflexion quand elle existe encore, sinon prend la première', () => {
  const engine = claudeApresMiseAJour();
  assert.deepEqual(migrationDeReglage(engine, 'claude-opus-5', 'high'), { model: 'claude-opus-5-5', thinking: 'high' });
  assert.deepEqual(migrationDeReglage(engine, 'claude-haiku-4', 'high'), { model: 'claude-haiku-4-5', thinking: 'none' });
});

test('rien à migrer : modèle présent, réglage vide, ou catalogue de SECOURS', () => {
  assert.equal(migrationDeReglage(claudeApresMiseAJour(), 'claude-opus-5-5', 'high'), null);
  assert.equal(migrationDeReglage(claudeApresMiseAJour(), undefined, 'high'), null);
  assert.equal(migrationDeReglage(claudeApresMiseAJour(false), 'claude-opus-5', 'high'), null);
});

test('deux familles GPT distinctes ne se confondent pas', () => {
  const thinking = [{ id: 'medium', label: 'Medium' }];
  const codex: EngineInfo = {
    id: 'codex',
    label: 'Codex',
    installed: true,
    live: true,
    defaultModel: 'gpt-5.6',
    models: [
      { id: 'gpt-5.6', label: 'GPT-5.6', thinking },
      { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', thinking },
    ],
  };
  assert.equal(modeleActuel(codex, 'gpt-5.5-sol')?.id, 'gpt-5.6-sol');
  assert.equal(modeleActuel(codex, 'gpt-5.5-luna')?.id, 'gpt-5.6');
});

test('le bouton de lancement dit le niveau que la configuration montre', () => {
  const moteurs = [claudeApresMiseAJour()];
  // Le niveau choisi sur la carte.
  assert.equal(niveauDeReflexionQuiPart(moteurs, { engine: 'claude', model: 'claude-opus-5-5', thinking: 'high' }), 'Réflexion haute');
  // Aucun niveau posé : le premier du modèle, comme la configuration.
  assert.equal(niveauDeReflexionQuiPart(moteurs, { engine: 'claude', model: 'claude-sonnet-5' }), 'Medium');
  // Un modèle retiré suit sa famille, et son niveau avec.
  assert.equal(niveauDeReflexionQuiPart(moteurs, { engine: 'claude', model: 'claude-opus-5', thinking: 'high' }), 'Réflexion haute');
});

test('le bouton de lancement ne dit rien sans modèle posé ou avec un seul niveau', () => {
  const moteurs = [claudeApresMiseAJour()];
  assert.equal(niveauDeReflexionQuiPart(moteurs, { engine: 'claude' }), undefined);
  assert.equal(niveauDeReflexionQuiPart(moteurs, undefined), undefined);
  assert.equal(niveauDeReflexionQuiPart(moteurs, { engine: 'claude', model: 'claude-haiku-4-5' }), undefined);
});

test('l’étiquette d’un agent au travail nomme moteur, modèle et niveau', () => {
  const claude = EngineInfo.parse({
    id: 'claude',
    label: 'Claude Code',
    installed: true,
    defaultModel: 'opus',
    models: [
      { id: 'opus', label: 'Opus 5.5', thinking: [{ id: 'none', label: 'Sans réflexion' }, { id: 'high', label: 'Élevée' }] },
      { id: 'haiku', label: 'Haiku 5.5', thinking: [{ id: 'none', label: 'Sans réflexion' }] },
    ],
  });
  assert.equal(etiquetteDuRun([claude], { engine: 'claude', model: 'opus', thinking: 'high' })?.texte, 'Claude Code · Opus 5.5 · Élevée');
  assert.equal(etiquetteDuRun([claude], { engine: 'claude', thinking: 'high' })?.modele, 'Opus 5.5', 'sans modèle : celui qui part par défaut');
  assert.equal(etiquetteDuRun([claude], { engine: 'claude', model: 'haiku', thinking: 'none' })?.texte, 'Claude Code · Haiku 5.5', 'un seul niveau : tu');
  assert.equal(etiquetteDuRun([], { engine: 'codex', model: 'gpt-5.5', thinking: 'medium' })?.texte, 'codex · gpt-5.5', 'catalogue absent : identifiants bruts');
  assert.equal(etiquetteDuRun([claude], { engine: 'claude', model: 'opus', thinking: 'xhigh' })?.niveau, 'Sans réflexion', 'niveau inconnu : le premier, comme resoudreRun');
  assert.equal(etiquetteDuRun([claude], undefined), null);
});
