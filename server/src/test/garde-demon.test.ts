import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TITRE_DU_PROCESSUS,
  TITRE_DU_SERVEUR_D_ESSAI,
  commandeMenaceLeDemon,
  hooksDuGardeDuDemon,
  motifTouchLeDemon,
  refusDuGarde,
  titreDuProcessus,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Un serveur d'essai ne porte plus le nom du démon                     */
/* ------------------------------------------------------------------ */

/*
 * LE CAS RÉEL DU 14/08/2026. Un script de contrôle lance le VRAI
 * `server/dist/main.js` sur un port et une base à lui. Comme le démon, il se
 * donnait le titre « haikodev-serveur » — tronqué à « haikodev-serveu » par le
 * noyau dans `ps` et `ss`. L'agent, ne pouvant plus distinguer son essai du
 * démon, a lancé `pkill -9 -f "haikodev-serveu"` : le serveur est tombé avec
 * onze étapes de travail en vol.
 */

const DONNEES_DU_DEMON = '/root/haikodev/data';

test('le serveur qui sert la vraie base est le démon', () => {
  const titre = titreDuProcessus({
    dossierDeDonnees: DONNEES_DU_DEMON,
    dossierDeDonneesDuDemon: DONNEES_DU_DEMON,
    port: 7070,
  });
  assert.equal(titre, TITRE_DU_PROCESSUS);
});

test('une barre oblique finale ne fait pas passer le démon pour un essai', () => {
  const titre = titreDuProcessus({
    dossierDeDonnees: `${DONNEES_DU_DEMON}/`,
    dossierDeDonneesDuDemon: DONNEES_DU_DEMON,
    port: 7070,
  });
  assert.equal(titre, TITRE_DU_PROCESSUS);
});

test('un serveur monté sur une base à lui porte un nom d’essai, avec son port', () => {
  const titre = titreDuProcessus({
    dossierDeDonnees: '/tmp/verif-rotation-carte-1234/data',
    dossierDeDonneesDuDemon: DONNEES_DU_DEMON,
    port: 7311,
  });
  assert.equal(titre, `${TITRE_DU_SERVEUR_D_ESSAI}-7311`);
  // Ce que montrent `ps` et `ss` : quinze signes. Le mot qui sépare tient.
  assert.equal(titre.slice(0, 15), 'haikodev-essai-');
  assert.notEqual(titre.slice(0, 15), TITRE_DU_PROCESSUS.slice(0, 15));
});

test('un essai peut aussi se déclarer lui-même', () => {
  const titre = titreDuProcessus({
    dossierDeDonnees: DONNEES_DU_DEMON,
    dossierDeDonneesDuDemon: DONNEES_DU_DEMON,
    port: 7070,
    essaiDeclare: true,
  });
  assert.equal(titre, `${TITRE_DU_SERVEUR_D_ESSAI}-7070`);
});

/* ------------------------------------------------------------------ */
/* Le garde refuse ce qui peut couper le démon                          */
/* ------------------------------------------------------------------ */

test('la commande EXACTE qui a coupé la tâche est refusée', () => {
  const verdict = commandeMenaceLeDemon('pkill -9 -f "haikodev-serveu" 2>/dev/null; sleep 1');
  assert.equal(verdict.refusee, true);
  assert.match(refusDuGarde(verdict), /haikodev-serveur/);
});

test('le motif qui désignait le démon est reconnu, le motif d’un essai non', () => {
  assert.equal(motifTouchLeDemon('haikodev-serveu'), TITRE_DU_PROCESSUS);
  assert.equal(motifTouchLeDemon('server/dist/main.js'), 'server/dist/main.js');
  assert.equal(motifTouchLeDemon('scripts/_essai-rotation-carte.mjs'), null);
  assert.equal(motifTouchLeDemon('haikodev-essai-7311'), null);
});

test('un motif trop large — node, npm, un moteur — est refusé', () => {
  for (const commande of [
    'pkill -f node',
    'pkill -9 -f npm',
    'killall node',
    'pkill -f claude',
    'pkill -f "cursor-agent"',
    'pkill -f .',
  ]) {
    assert.equal(commandeMenaceLeDemon(commande).refusee, true, commande);
  }
});

test('le ménage d’un agent sur SES propres essais passe sans un mot', () => {
  for (const commande of [
    'pkill -9 -f "scripts/_essai-rotation-carte.mjs" 2>/dev/null; sleep 1',
    'pkill -f "verif-rotation-carte\\|_essai-rotation-carte" 2>/dev/null',
    'pkill -f "vite.*7099"',
    'pkill -f playwright_chromiumdev_profile',
    'pkill -f "haikodev-essai-7311"',
    'git status --short && npm test',
  ]) {
    assert.equal(commandeMenaceLeDemon(commande).refusee, false, commande);
  }
});

test('un redémarrage du service par la ligne de commande est refusé, même différé', () => {
  const differe = "setsid nohup bash -c 'sleep 30; systemctl restart haikodev' >/dev/null 2>&1 &";
  assert.equal(commandeMenaceLeDemon(differe).refusee, true);
  assert.equal(commandeMenaceLeDemon('sudo systemctl stop haikodev.service').refusee, true);
  // Un autre service ne regarde pas le démon.
  assert.equal(commandeMenaceLeDemon('sudo systemctl restart autoproject-rezideo-app.service').refusee, false);
  // Regarder n'est pas couper.
  assert.equal(commandeMenaceLeDemon('systemctl status haikodev.service --no-pager').refusee, false);
});

test('un kill par numéro est refusé quand il vise le démon, accepté sinon', () => {
  const monde = { pidDuDemon: 864995 };
  assert.equal(commandeMenaceLeDemon('kill -9 864995 2>/dev/null; sleep 1', monde).refusee, true);
  assert.equal(commandeMenaceLeDemon('kill -9 856528 864982', monde).refusee, false);
  // Un groupe entier emporte le démon avec le reste.
  assert.equal(commandeMenaceLeDemon('kill -9 -1', monde).refusee, true);
});

test('une liste de processus venue d’ailleurs est refusée', () => {
  const verdict = commandeMenaceLeDemon("ps aux | grep node | awk '{print $2}' | xargs kill -9");
  assert.equal(verdict.refusee, true);
  // Lire une liste ne la tue pas.
  assert.equal(commandeMenaceLeDemon('ps aux | grep node').refusee, false);
});

test('un motif qui désigne la racine du dépôt est refusé', () => {
  const monde = { racineDuDemon: '/root/haikodev' };
  assert.equal(commandeMenaceLeDemon('pkill -f /root/haikodev', monde).refusee, true);
  assert.equal(commandeMenaceLeDemon('pkill -f /root/rezideo', monde).refusee, false);
});

test('le garde est branché sur les commandes, et sur elles seules', () => {
  const hooks = hooksDuGardeDuDemon('/root/haikodev/server/garde-demon.mjs') as {
    PreToolUse: { matcher: string; hooks: { type: string; command: string }[] }[];
  };
  assert.equal(hooks.PreToolUse[0].matcher, 'Bash');
  assert.match(hooks.PreToolUse[0].hooks[0].command, /garde-demon\.mjs$/);
});
