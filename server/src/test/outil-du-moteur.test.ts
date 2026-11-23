/**
 * L'OUTIL D'UN MOTEUR SE CHERCHE LÀ OÙ IL EST POSÉ.
 *
 * Sur un serveur neuf, `npm install -g @openai/codex` réussissait mais l'écran
 * restait sur « Installer » : le démon ne regardait que `/root/.local/bin/codex`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { candidatsDeLOutil } from '@beluga/shared';
import { cheminDeLOutil } from '../engines/outil-du-moteur.js';

test('la variable imposée est SEULE candidate, même si elle ne mène nulle part', () => {
  assert.deepEqual(candidatsDeLOutil({ nom: 'codex', impose: '/tmp/nulle-part/codex', maison: '/home/beluga', path: '/usr/bin' }), [
    '/tmp/nulle-part/codex',
  ]);
});

test('ordre : PATH, ~/.local/bin, dossier de Node, /usr/local/bin, /usr/bin, propres à l’outil, ancien chemin', () => {
  const candidats = candidatsDeLOutil({
    nom: 'codex',
    maison: '/home/beluga/',
    path: '/opt/a:relatif:/usr/bin',
    dossierDeNode: '/usr/lib/node/bin',
    enPlus: ['/home/beluga/.codex/packages/standalone/current/bin/codex'],
    historique: '/root/.local/bin/codex',
  });
  assert.deepEqual(candidats, [
    '/opt/a/codex',
    '/usr/bin/codex',
    '/home/beluga/.local/bin/codex',
    '/usr/lib/node/bin/codex',
    '/usr/local/bin/codex',
    '/home/beluga/.codex/packages/standalone/current/bin/codex',
    '/root/.local/bin/codex',
  ]);
});

test('un outil posé sous le préfixe global de npm est trouvé, pas l’ancien chemin figé', () => {
  const pose = '/usr/lib/node/bin/codex';
  assert.equal(cheminDeLOutil({ nom: 'codex', historique: '/root/.local/bin/codex' }, (c) => c === path.join(path.dirname(process.execPath), 'codex') || c === pose), path.join(path.dirname(process.execPath), 'codex'));
});

test('aucun candidat exécutable : le dernier est rendu, pour une erreur lisible', () => {
  assert.equal(cheminDeLOutil({ nom: 'outil-qui-n-existe-pas', historique: '/root/.local/bin/x' }, () => false), '/root/.local/bin/x');
});

test('sur le disque : un exécutable posé dans le PATH est vu dès qu’il existe', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'outil-moteur-'));
  const ancienPath = process.env.PATH;
  try {
    process.env.PATH = `${dossier}:${ancienPath}`;
    const outil = path.join(dossier, 'outil-de-test-beluga');
    assert.notEqual(cheminDeLOutil({ nom: 'outil-de-test-beluga' }), outil);
    fs.writeFileSync(outil, '#!/bin/sh\necho 1\n', { mode: 0o755 });
    assert.equal(cheminDeLOutil({ nom: 'outil-de-test-beluga' }), outil);
  } finally {
    process.env.PATH = ancienPath;
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});
