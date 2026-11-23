import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * « ASK_USER » REFUSE UNE QUESTION QUI OUBLIE UN EXEMPLE FABRIQUÉ (décision du
 * 04/11/2026, carte Jb2o) : l'agent avait gardé deux images sur quatre, et la
 * question montrait deux cases vides. Le refus rend la main sans question —
 * donc sans attente posée (DEC-026) ; la question complète passe, consomme le
 * lot et porte la lettre de chaque exemple, image de secours comprise.
 */

process.env.BELUGA_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-user-exemples-'));

const { Attachment, Project } = await import('@beluga/shared');
const store = await import('../store.js');
const { callTool } = await import('../tools.js');
const { retenirLeLot, lotDExemplesEnAttente } = await import('../exemples-de-choix.js');

const ctx = { agentId: 'agent-exemples', projectId: 'projet-exemples', role: 'task' as const };

store.saveProject(
  Project.parse({ id: ctx.projectId, name: 'Projet exemples', path: fs.mkdtempSync(path.join(os.tmpdir(), 'projet-exemples-')), createdAt: store.now(), updatedAt: store.now() }),
);

function piece(id: string, name: string) {
  store.saveAttachment(
    Attachment.parse({ id, projectId: ctx.projectId, alias: id.slice(0, 4), name, mime: 'image/png', size: 10, sha: `sha-${id}`, createdAt: store.now() }),
  );
}
piece('aaaa1111', 'exemple-A.png');
piece('bbbb2222', 'exemple-B.png');
piece('cccc3333', 'apercu-exemple-1-v1.png');

const lot = {
  champ: 'image' as const,
  pieces: [
    { id: 'aaaa1111', lettre: 'A', titre: 'Rond', alias: 'aaaa' },
    { id: 'bbbb2222', lettre: 'B', titre: 'Carré', alias: 'bbbb' },
    { id: 'cccc3333', lettre: 'C', titre: 'Étoile', alias: 'cccc' },
  ],
};

test('une question qui reprend une partie du lot est refusée, sans question posée', async () => {
  retenirLeLot(ctx.agentId, lot);
  const r = await callTool(ctx, 'ask_user', {
    question: 'Quel logo ?',
    options: [{ label: 'Rond', image: 'aaaa1111' }, { label: 'Carré', image: '#bbbb' }, { label: 'Un nom provisoire' }],
  });
  assert.equal(r.ok, false);
  assert.equal(r.question, undefined, 'aucune attente ne se pose sur un refus');
  assert.match(r.text, /C \(#cccc\) — Étoile/);
  assert.ok(lotDExemplesEnAttente(ctx.agentId), 'le lot attend toujours sa question');
});

test('une question sans rapport avec le lot passe et laisse le lot en attente', async () => {
  const r = await callTool(ctx, 'ask_user', { question: 'On continue ?', options: [{ label: 'Oui' }, { label: 'Non' }] });
  assert.equal(r.ok, true);
  assert.ok(lotDExemplesEnAttente(ctx.agentId));
});

test('la question complète passe, consomme le lot et écrit la lettre de chaque exemple', async () => {
  const r = await callTool(ctx, 'ask_user', {
    question: 'Quel logo ?',
    options: [
      { label: 'Étoile (ratée)', image: 'cccc3333' },
      { label: 'Rond', image: 'aaaa1111' },
      { label: 'Carré', image: 'bbbb2222' },
      { label: 'Fusionner les deux idées' },
    ],
  });
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.question?.options.map((o) => o.lettre ?? null),
    ['C', 'A', 'B', null],
  );
  assert.equal(lotDExemplesEnAttente(ctx.agentId), undefined);
});
