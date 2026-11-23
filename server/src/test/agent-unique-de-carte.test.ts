import test from 'node:test';
import assert from 'node:assert/strict';
import { agentDeLaCarteAuLancement, dossierDesFilsClaude } from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* Un seul agent par carte : le cadrage devient l'exécution            */
/* ------------------------------------------------------------------ */

test('même moteur et même modèle : l’agent de cadrage reprend son fil et exécute', () => {
  assert.deepEqual(
    agentDeLaCarteAuLancement({ engine: 'claude', model: 'claude-opus-5' }, { engine: 'claude', model: 'claude-opus-5' }),
    { reprendre: true },
  );
  assert.deepEqual(
    agentDeLaCarteAuLancement({ engine: 'codex', model: 'gpt-5.6' }, { engine: 'codex', model: 'gpt-5.6' }),
    { reprendre: true },
  );
});

test('un moteur absent vaut Claude, des deux côtés', () => {
  assert.deepEqual(agentDeLaCarteAuLancement({ model: 'opus' }, { engine: 'claude', model: 'opus' }), {
    reprendre: true,
  });
});

test('modèle changé entre le cadrage et le lancement : un nouvel agent prend le relais', () => {
  assert.deepEqual(
    agentDeLaCarteAuLancement({ engine: 'claude', model: 'claude-sonnet-5' }, { engine: 'claude', model: 'claude-opus-5' }),
    { reprendre: false, raison: 'modele-change' },
  );
  assert.deepEqual(agentDeLaCarteAuLancement({ engine: 'claude' }, { engine: 'claude', model: 'claude-opus-5' }), {
    reprendre: false,
    raison: 'modele-change',
  });
});

test('moteur changé : un nouvel agent prend le relais', () => {
  assert.deepEqual(
    agentDeLaCarteAuLancement({ engine: 'claude', model: 'x' }, { engine: 'codex', model: 'x' }),
    { reprendre: false, raison: 'moteur-change' },
  );
});

test('Cursor ne reprend pas un fil depuis un autre dossier : relais', () => {
  assert.deepEqual(agentDeLaCarteAuLancement({ engine: 'cursor', model: 'm' }, { engine: 'cursor', model: 'm' }), {
    reprendre: false,
    raison: 'moteur-sans-reprise',
  });
});

test('le dossier des fils Claude : tout signe hors lettres et chiffres devient un tiret', () => {
  assert.equal(dossierDesFilsClaude('/root/beluga'), '-root-beluga');
  assert.equal(
    dossierDesFilsClaude('/root/beluga/.worktrees/un-seul-agent-par-carte-5e9c81'),
    '-root-beluga--worktrees-un-seul-agent-par-carte-5e9c81',
  );
  assert.equal(dossierDesFilsClaude(`/${'a'.repeat(250)}`), null);
});

test('le fil Claude est recopié sous le dossier de la copie de travail avant la reprise', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { amenerLeFilDansLeDossier } = await import('../engines/claude.js');
  const coffre = fs.mkdtempSync(path.join(os.tmpdir(), 'coffre-'));
  const depart = path.join(coffre, 'projects', '-data-cadrage-scratch-p1');
  fs.mkdirSync(path.join(depart, 'fil-1'), { recursive: true });
  fs.writeFileSync(path.join(depart, 'fil-1.jsonl'), '{"type":"user"}\n');
  fs.writeFileSync(path.join(depart, 'fil-1', 'annexe.txt'), 'x');

  assert.equal(amenerLeFilDansLeDossier(coffre, '/root/beluga/.worktrees/carte', 'fil-1'), 'recopie');
  const arrivee = path.join(coffre, 'projects', '-root-beluga--worktrees-carte');
  assert.equal(fs.readFileSync(path.join(arrivee, 'fil-1.jsonl'), 'utf8'), '{"type":"user"}\n');
  assert.ok(fs.existsSync(path.join(arrivee, 'fil-1', 'annexe.txt')));
  // Le fil d'origine reste : le cadrage rouvert après livraison le reprendra.
  assert.ok(fs.existsSync(path.join(depart, 'fil-1.jsonl')));
  assert.equal(amenerLeFilDansLeDossier(coffre, '/root/beluga/.worktrees/carte', 'fil-1'), 'deja-la');
  assert.equal(amenerLeFilDansLeDossier(coffre, '/root/beluga/.worktrees/carte', 'inconnu'), 'introuvable');
  // Le fil a grandi pendant l'exécution : le retour au cadrage reprend la version la plus récente.
  fs.appendFileSync(path.join(arrivee, 'fil-1.jsonl'), '{"type":"assistant"}\n');
  const plusTard = new Date(Date.now() + 60_000);
  fs.utimesSync(path.join(arrivee, 'fil-1.jsonl'), plusTard, plusTard);
  assert.equal(amenerLeFilDansLeDossier(coffre, '/data/cadrage/scratch/p1', 'fil-1'), 'recopie');
  assert.match(fs.readFileSync(path.join(depart, 'fil-1.jsonl'), 'utf8'), /assistant/);
  fs.rmSync(coffre, { recursive: true, force: true });
});
