import test from 'node:test';
import assert from 'node:assert/strict';
import { miseEnLigneReelle, planDeMiseEnLigne } from '@haikodev/shared';
import { dossierCiteParServeurWeb } from '../deploy.js';

/* ------------------------------------------------------------------ */
/* Publier, c'est mettre en ligne — pas seulement fusionner            */
/* ------------------------------------------------------------------ */

test('sans aucun moyen, la publication est IMPOSSIBLE et le dit', () => {
  const plan = planDeMiseEnLigne({});
  assert.equal(plan.possible, false);
  assert.equal(plan.installation, 'aucune');
  assert.match(plan.raison, /aucun moyen d’être mis en ligne/);
  assert.match(plan.raison, /commande de publication/);
});

test('un dépôt git bien rangé ne suffit pas : sans moyen de servir, c’est non', () => {
  // Le piège d'origine : fusion, enregistrement, envoi… et « publié ».
  const plan = planDeMiseEnLigne({ scriptBuild: true });
  assert.equal(plan.possible, false);
});

test('la commande de publication du projet porte tout', () => {
  const plan = planDeMiseEnLigne({ commande: 'bash deploy.sh' });
  assert.equal(plan.possible, true);
  assert.equal(plan.construction, 'commande');
  assert.equal(plan.installation, 'commande');
  assert.equal(plan.redemarrage, 'commande');
});

test('une commande vide ne compte pas pour une commande', () => {
  assert.equal(planDeMiseEnLigne({ commande: '   ' }).possible, false);
});

test('HaikoDev se construit, s’installe et se redémarre lui-même', () => {
  const plan = planDeMiseEnLigne({ estHaikoDev: true });
  assert.equal(plan.installation, 'haikodev');
  assert.equal(plan.redemarrage, 'demon');
});

test('un service système sur le dossier met le code en ligne en repartant', () => {
  const plan = planDeMiseEnLigne({ service: 'monsite.service', scriptBuild: true });
  assert.equal(plan.possible, true);
  assert.equal(plan.construction, 'npm');
  assert.equal(plan.redemarrage, 'service');
  assert.match(plan.raison, /monsite\.service/);
});

test('sans script de construction, le service se relance quand même', () => {
  const plan = planDeMiseEnLigne({ service: 'monsite.service' });
  assert.equal(plan.construction, 'aucune');
  assert.equal(plan.redemarrage, 'service');
});

test('un dossier servi tel quel est en ligne dès que les fichiers sont posés', () => {
  const plan = planDeMiseEnLigne({ dossierServi: true });
  assert.equal(plan.possible, true);
  assert.equal(plan.installation, 'dossier-servi');
  assert.equal(plan.redemarrage, 'aucun');
});

test('la commande passe devant tout le reste', () => {
  const plan = planDeMiseEnLigne({ commande: 'make ship', service: 'x.service', dossierServi: true });
  assert.equal(plan.installation, 'commande');
});

/* ------------------------------------------------------------------ */
/* Sept étapes ignorées ne font pas une publication                     */
/* ------------------------------------------------------------------ */

test('tout ignoré : rien n’est parti en ligne', () => {
  assert.equal(miseEnLigneReelle({ build: 'skipped', publish: 'skipped', restart: 'skipped' }), false);
});

test('une installation menée à terme suffit', () => {
  assert.equal(miseEnLigneReelle({ build: 'skipped', publish: 'done', restart: 'skipped' }), true);
});

test('un service relancé suffit, même sans construction', () => {
  assert.equal(miseEnLigneReelle({ build: 'skipped', publish: 'skipped', restart: 'done' }), true);
});

/* ------------------------------------------------------------------ */
/* Reconnaître un dossier servi par un serveur web                      */
/* ------------------------------------------------------------------ */

const CADDY = `
site.example {
  handle {
    root * /var/www/mon-site
    file_server
  }
}
`;

test('Caddy : « root * dossier » désigne bien ce dossier', () => {
  assert.equal(dossierCiteParServeurWeb([CADDY], '/var/www/mon-site'), true);
  assert.equal(dossierCiteParServeurWeb([CADDY], '/var/www/mon-site/'), true);
  assert.equal(dossierCiteParServeurWeb([CADDY], '/var/www/autre-site'), false);
});

test('nginx : « root dossier; » compte aussi', () => {
  assert.equal(dossierCiteParServeurWeb(['server {\n  root /srv/site;\n}'], '/srv/site'), true);
});

test('une ligne commentée ne sert rien', () => {
  assert.equal(dossierCiteParServeurWeb(['  # root * /srv/site'], '/srv/site'), false);
});

test('aucune configuration lisible : aucun dossier servi', () => {
  assert.equal(dossierCiteParServeurWeb([], '/srv/site'), false);
});
