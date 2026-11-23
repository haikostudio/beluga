import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Card } from '@beluga/shared';

/*
 * LE RÉSUMÉ DE L'ASSISTANT EST DATÉ, ET LIT LES CARTES RANGÉES (carte « Assistant vocal rapide », 16/11/2026) :
 * « les cinq tâches terminées hier » se répond en UN appel `assistant_resume`, dans l'ordre exact de fin,
 * archivées comprises — la voix fouillait auparavant projet par projet puis lançait `rg` dans les données.
 */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-resume-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const { executerPourLAssistant } = await import('../assistant-global.js');

store.saveProject({
  id: 'projet-essai',
  name: 'Projet d’essai',
  path: bacASable,
  defaultEngine: 'claude',
  isSelf: false,
  archived: false,
  createdAt: store.now(),
  updatedAt: store.now(),
} as any);

function carte(titre: string, column: Card['column'], doneAt?: number) {
  return store.saveCard(
    Card.parse({
      id: store.newId(),
      projectId: 'projet-essai',
      title: titre,
      column,
      position: 1,
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...(doneAt ? { doneAt } : {}),
    }),
  );
}

// Le 15/11/2026 en heure de Paris (UTC+1) : de 14/11 23:00 UTC à 15/11 23:00 UTC.
carte('Première du 15', 'archived', Date.UTC(2026, 10, 14, 23, 5));
carte('Midi du 15', 'to_deploy', Date.UTC(2026, 10, 15, 11, 0));
carte('Dernière du 15', 'archived', Date.UTC(2026, 10, 15, 22, 50));
carte('Déjà le 16', 'archived', Date.UTC(2026, 10, 15, 23, 10));
carte('Encore le 14', 'archived', Date.UTC(2026, 10, 14, 22, 50));
carte('Au travail', 'running');

const appel = (args: Record<string, unknown>) => executerPourLAssistant({} as any, 'assistant_resume', args, undefined);

test('un jour demandé : les terminées de ce jour, archivées comprises, la plus récente d’abord, avec l’heure de Paris', async () => {
  const r = await appel({ jour: '2026-11-15' });
  assert.equal(r.ok, true);
  const titres = [...r.text.matchAll(/« ([^»]+) » \((?:Archivé|À déployer|[^)]+)\)/g)].map((m) => m[1]);
  assert.deepEqual(titres, ['Dernière du 15', 'Midi du 15', 'Première du 15']);
  assert.match(r.text, /15\/11 23:50 — .* « Dernière du 15 »/);
  assert.match(r.text, /15\/11 00:05 — .* « Première du 15 »/);
});

test('sans jour : les dernières terminées, bornées par « limite »', async () => {
  const r = await appel({ limite: 2 });
  const titres = [...r.text.matchAll(/« ([^»]+) » \(/g)].map((m) => m[1]);
  assert.deepEqual(titres.slice(0, 2), ['Déjà le 16', 'Dernière du 15']);
  assert.ok(!titres.includes('Midi du 15'));
});

test('les tâches en cours sont listées, et un jour incompris est refusé en clair', async () => {
  const r = await appel({});
  assert.match(r.text, /En cours \(1\) :\n- .*« Au travail »/);
  const flou = await appel({ jour: 'la semaine des quatre jeudis' });
  assert.equal(flou.ok, false);
  assert.match(flou.text, /n'est pas un jour compris/);
});

test('les tâches EN COURS passent avant les terminées, chacune sous son titre (carte « Raccourcis libres et Jarvis vocal »)', async () => {
  const r = await appel({});
  const enCours = r.text.indexOf('TÂCHES EN COURS (en ce moment)');
  const terminees = r.text.indexOf('DERNIÈRES TÂCHES TERMINÉES (déjà finies, ne sont PAS en cours)');
  assert.ok(enCours > 0 && terminees > enCours, 'la section en cours précède les terminées');
});
