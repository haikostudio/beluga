import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MODE_SIMPLIFIE_ATTRIBUT,
  MODE_SIMPLIFIE_CLE,
  ONGLETS_CARTE_TECHNIQUES,
  ONGLETS_REGLAGES_TECHNIQUES,
  allegerMessageTechnique,
  ongletTechnique,
  ongletsVisibles,
} from '@haikodev/shared';

test('le réglage a une clé stable, écrite une seule fois', () => {
  assert.equal(MODE_SIMPLIFIE_CLE, 'modeSimplifie');
  assert.equal(MODE_SIMPLIFIE_ATTRIBUT, 'data-mode-simplifie');
});

test('éteint, aucun onglet ne bouge', () => {
  const onglets = [{ cle: 'systeme' }, { cle: 'apparence' }, { cle: 'acces-api' }];
  assert.deepEqual(ongletsVisibles(onglets, ONGLETS_REGLAGES_TECHNIQUES, false), onglets);
});

test('allumé, seuls les onglets techniques disparaissent, dans l’ordre d’origine', () => {
  const onglets = [{ cle: 'systeme' }, { cle: 'apparence' }, { cle: 'acces-api' }, { cle: 'voix' }];
  assert.deepEqual(
    ongletsVisibles(onglets, ONGLETS_REGLAGES_TECHNIQUES, true).map((o) => o.cle),
    ['systeme', 'apparence', 'voix'],
  );
  const cartes = [{ cle: 'chat' }, { cle: 'details' }, { cle: 'billing' }, { cle: 'github' }];
  assert.deepEqual(
    ongletsVisibles(cartes, ONGLETS_CARTE_TECHNIQUES, true).map((o) => o.cle),
    ['chat', 'details', 'billing'],
  );
});

test('les onglets qui portent une fonction ne sont JAMAIS techniques', () => {
  for (const cle of ['chat', 'details', 'billing', 'apparence', 'comptes', 'voix', 'sauvegardes']) {
    assert.equal(ongletTechnique(ONGLETS_REGLAGES_TECHNIQUES, cle), false, cle);
    assert.equal(ongletTechnique(ONGLETS_CARTE_TECHNIQUES, cle), false, cle);
  }
});

test('un message ordinaire traverse sans une virgule de changement', () => {
  const texte = 'La tâche a échoué : le dépôt distant a refusé la branche.';
  assert.equal(allegerMessageTechnique(texte), texte);
});

test('la trame d’appel et les chemins du serveur sont retirés, la phrase reste', () => {
  const brut = [
    'Impossible de lire le fichier demandé.',
    "Error: ENOENT: no such file or directory, open '/root/haikodev/web/src/app.tsx'",
    '    at Object.openSync (node:fs:601:3)',
    '    at readFileSync (node:fs:469:35)',
    '  errno: -2,',
    '  code: ENOENT',
  ].join('\n');
  assert.equal(allegerMessageTechnique(brut), 'Impossible de lire le fichier demandé.');
});

test('un message qui n’était QUE technique ne rend rien — l’écran écrit sa propre phrase', () => {
  const brut = ['TypeError:', '    at monter (/root/haikodev/server/dist/index.js:12:9)', '    ^^^^'].join('\n');
  assert.equal(allegerMessageTechnique(brut), null);
  assert.equal(allegerMessageTechnique(''), null);
  assert.equal(allegerMessageTechnique(undefined), null);
});

test('une ligne de npm ou un module de dépendance ne survit pas', () => {
  const brut = [
    'La construction a échoué.',
    'npm ERR! code ELIFECYCLE',
    'at /root/haikodev/node_modules/vite/dist/node/chunks/dep.js:1:1',
  ].join('\n');
  assert.equal(allegerMessageTechnique(brut), 'La construction a échoué.');
});
