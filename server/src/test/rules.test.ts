import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_MOVABLE_COLUMNS,
  ClientCommand,
  COLUMN_KEYS,
  ColumnKey,
  canMove,
  checkTemplate,
  denseSections,
  extractEvolutions,
  paragraphBreakAfter,
  RunConfig,
  templateForColumn,
  wrapPrompt,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Règles de déplacement des cartes (PLAN §4)                          */
/* ------------------------------------------------------------------ */

test('un agent ne peut déplacer une carte que vers notes ou à faire', () => {
  for (const target of COLUMN_KEYS) {
    const decision = canMove('agent', 'todo', target);
    if (AGENT_MOVABLE_COLUMNS.includes(target) || target === 'todo') {
      assert.equal(decision.allowed, true, `${target} devrait être autorisée`);
    } else {
      assert.equal(decision.allowed, false, `${target} devrait être refusée`);
      assert.ok(decision.reason, 'un refus doit être expliqué');
    }
  }
});

test('un agent ne peut pas sortir une carte du pipeline', () => {
  const decision = canMove('agent', 'running', 'todo');
  assert.equal(decision.allowed, false);
});

test('la validation reste un geste humain : la machine ne touche pas « à faire »', () => {
  assert.equal(canMove('machine', 'todo', 'planned').allowed, false);
  assert.equal(canMove('machine', 'validated', 'planned').allowed, true);
  assert.equal(canMove('machine', 'planned', 'running').allowed, true);
});

test('la machine ne peut pas promouvoir vers validé, terminé ou à déployer', () => {
  for (const target of ['validated', 'done', 'to_deploy'] as ColumnKey[]) {
    assert.equal(canMove('machine', 'planned', target).allowed, false);
  }
});

test("l'utilisateur peut tout déplacer", () => {
  for (const from of COLUMN_KEYS) {
    for (const to of COLUMN_KEYS) {
      assert.equal(canMove('user', from, to).allowed, true);
    }
  }
});

/* ------------------------------------------------------------------ */
/* Choix du gabarit (PLAN §9)                                          */
/* ------------------------------------------------------------------ */

test('le gabarit dépend de la colonne', () => {
  assert.equal(templateForColumn('validated'), 'pre_run');
  assert.equal(templateForColumn('planned'), 'pre_run');
  assert.equal(templateForColumn('running'), 'in_run');
  assert.equal(templateForColumn('done'), 'in_run');
  assert.equal(templateForColumn('to_deploy'), 'in_run');
  assert.equal(templateForColumn('todo'), 'free');
  assert.equal(templateForColumn(undefined), 'free');
  assert.equal(templateForColumn('running', true), 'deploy');
});

test("une carte qui n'a rien exécuté n'a pas le droit d'écrire « ce qui est fait »", () => {
  const prompt = wrapPrompt('pre_run', 'Ajoute un bouton');
  assert.match(prompt, /Interdit d'écrire « Ce qui est fait »/);
  assert.match(prompt, /Analyse de la demande/);
  assert.doesNotMatch(prompt.split('FORME DE TA RÉPONSE')[1] ?? '', /^## 1\. Ce qui est fait/m);
});

test('le gabarit d\'analyse réclame des chiffres exploitables', () => {
  const prompt = wrapPrompt('pre_run', 'Refonte du tableau');
  assert.match(prompt, /machineSeconds/);
  assert.match(prompt, /seniorHours/);
  assert.match(prompt, /Ne confonds JAMAIS les deux/);
});

test('le chef d\'orchestre ne reçoit aucun gabarit', () => {
  const prompt = wrapPrompt('none', 'Bonjour');
  assert.equal(prompt, 'Bonjour');
});

const RAPPORT = [
  '## 1. Analyse',
  '## 2. Ce qui est fait',
  '## 3. Conséquences',
  '## 4. Impact',
  '## 5. Évolutions possibles',
  '## 6. Coûts',
].join('\n\n');

/** Un remplissage aéré, assez long pour réclamer le compte rendu entier. */
function longueur(mots: number): string {
  return Array.from({ length: mots }, (_, i) => (i % 12 === 11 ? 'ligne.\n' : 'mot')).join(' ');
}

test('le contrôle de forme repère une réponse hors format', () => {
  assert.equal(checkTemplate('in_run', RAPPORT).ok, true);

  // Une réponse LONGUE doit servir les six titres : elle a de quoi les remplir.
  const bad = `## 1. Analyse\n\n${longueur(400)}\n\n## 2. Bla\n\n${longueur(200)}`;
  const result = checkTemplate('in_run', bad);
  assert.equal(result.ok, false);
  assert.ok(result.missing.includes('Impact'));
});

/* ------------------------------------------------------------------ */
/* Mise en forme : des blocs lisibles, pas un pavé                     */
/* ------------------------------------------------------------------ */

test('le compte rendu tient en six sections nettement séparées', () => {
  const prompt = wrapPrompt('in_run', 'Range le tableau');
  for (const titre of ['Analyse', 'Ce qui est fait', 'Conséquences', 'Impact', 'Évolutions possibles', 'Coûts']) {
    assert.ok(prompt.includes(titre), `section manquante : ${titre}`);
  }
  assert.match(prompt, /## 1\. Analyse\n\n## 2\. Ce qui est fait/);
  assert.match(prompt, /MISE EN FORME/);
  assert.match(prompt, /LIGNE VIDE/);
  assert.doesNotMatch(prompt, /Sois bref/);
});

test('une section tassée est signalée comme un pavé', () => {
  const phrase = 'Le tableau a été repris de fond en comble pour que chaque partie se distingue. ';
  const pave = `## 1. Analyse\n${phrase.repeat(6)}\n\n## 2. Impact\nDeux phrases courtes.\n\nEt un second paragraphe.`;
  const dense = denseSections(pave);
  assert.deepEqual(dense, ['Analyse']);
  assert.equal(checkTemplate('in_run', pave).ok, false);

  assert.deepEqual(denseSections(RAPPORT), []);
});

test('une longue liste ou un bloc de code ne passent pas pour un pavé', () => {
  const puces = ['## 1. Analyse', ...Array.from({ length: 12 }, (_, i) => `- Un point de détail assez long numéro ${i}`)];
  assert.deepEqual(denseSections(puces.join('\n')), []);

  const code = '## 1. Analyse\n```\n' + 'const x = 1;\n'.repeat(60) + '```\n';
  assert.deepEqual(denseSections(code), []);
});

test('un retour à la ligne du moteur ouvre un vrai paragraphe', () => {
  assert.equal(paragraphBreakAfter('Le travail est terminé.', 'Les tests passent.'), true);
  assert.equal(paragraphBreakAfter('Trois points restent :', '- un premier'), true);
  // Une phrase coupée en plein milieu se recolle, elle.
  assert.equal(paragraphBreakAfter('Le tableau affiche désormais', 'les six sections attendues.'), false);
  assert.equal(paragraphBreakAfter('Voir M.', 'dupont pour la suite.'), false);
});

test('un journal de publication ne finit pas par une ligne de facture', () => {
  const prompt = wrapPrompt('deploy', 'Publie le lot');
  assert.match(prompt, /Interdit de terminer par une ligne de facture/);
});

/* ------------------------------------------------------------------ */
/* Évolutions cliquables (PLAN §15)                                    */
/* ------------------------------------------------------------------ */

test('les suggestions sont extraites de la section « Évolutions possibles »', () => {
  const text = `## 3. Impact
- Un point qui ne compte pas

## 4. Évolutions possibles
- Ajouter un filtre par étiquette
- **Exporter** le tableau en PDF

## 5. Activation & facturation
- Rien ici`;
  const items = extractEvolutions(text);
  assert.deepEqual(items, ['Ajouter un filtre par étiquette', 'Exporter le tableau en PDF']);
});

/* ------------------------------------------------------------------ */
/* Réglages choisis sur la carte à valider (PLAN §10)                  */
/* ------------------------------------------------------------------ */

test('valider une carte peut porter moteur, modèle et réflexion — et sans eux aussi', () => {
  const base = { type: 'proposal.decide' as const, messageId: 'm1', proposalId: 'p1', accept: true };

  // Le champ est FACULTATIF : une interface qui ne l'envoie pas reste valable.
  assert.equal(ClientCommand.safeParse(base).success, true);

  const avecReglages = ClientCommand.safeParse({
    ...base,
    run: { engine: 'codex', model: 'gpt-5', thinking: 'high' },
  });
  assert.equal(avecReglages.success, true);
  assert.deepEqual(
    avecReglages.success && avecReglages.data.type === 'proposal.decide' ? avecReglages.data.run : null,
    { engine: 'codex', model: 'gpt-5', thinking: 'high' },
  );

  // Un moteur inconnu est refusé plutôt que posé tel quel sur la carte.
  assert.equal(ClientCommand.safeParse({ ...base, run: { engine: 'inconnu' } }).success, false);
});

test('un réglage partiel devient un réglage complet une fois posé sur la carte', () => {
  const run = RunConfig.parse({ engine: 'claude', model: 'claude-opus-5' });
  assert.equal(run.thinking, 'none');
  assert.equal(run.mode, 'direct');
});
