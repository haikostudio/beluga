import test from 'node:test';
import assert from 'node:assert/strict';
import { miseEnLigneReelle, planDeMiseEnLigne } from '@haikodev/shared';
import { dossierCiteParServeurWeb } from '../deploy.js';

/* ------------------------------------------------------------------ */
/* Déployer, c'est rafraîchir l'instance de dev — et c'est TOUJOURS possible */
/* ------------------------------------------------------------------ */

test('sans instance de dev sur ce serveur, on déploie quand même — et on le DIT', () => {
  // Plus de refus faute de réglage : le lot est fusionné, enregistré, envoyé.
  // Mais on ne laisse pas croire qu'on a relancé quoi que ce soit.
  const plan = planDeMiseEnLigne({});
  assert.equal(plan.installation, 'aucune');
  assert.equal(plan.construction, 'aucune');
  assert.equal(plan.redemarrage, 'aucun');
  assert.match(plan.raison, /Aucune instance de dev/);
  assert.match(plan.raison, /rien à construire ni à relancer/);
});

test('un script de construction se voit même sans instance à relancer', () => {
  const plan = planDeMiseEnLigne({ scriptBuild: true });
  assert.equal(plan.construction, 'npm');
  assert.equal(plan.installation, 'aucune');
  assert.match(plan.raison, /construit/);
});

test('HaikoDev se construit, s’installe et se redémarre lui-même', () => {
  const plan = planDeMiseEnLigne({ estHaikoDev: true });
  assert.equal(plan.construction, 'npm');
  assert.equal(plan.installation, 'haikodev');
  assert.equal(plan.redemarrage, 'demon');
});

test('un service système sur le dossier met le code en ligne en repartant', () => {
  const plan = planDeMiseEnLigne({ service: 'monsite.service', scriptBuild: true });
  assert.equal(plan.construction, 'npm');
  assert.equal(plan.installation, 'service');
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
  assert.equal(plan.installation, 'dossier-servi');
  assert.equal(plan.redemarrage, 'aucun');
});

test('HaikoDev passe devant le service et le dossier servi', () => {
  const plan = planDeMiseEnLigne({ estHaikoDev: true, service: 'x.service', dossierServi: true });
  assert.equal(plan.installation, 'haikodev');
  // Et le service passe devant le dossier servi.
  assert.equal(planDeMiseEnLigne({ service: 'x.service', dossierServi: true }).installation, 'service');
});

/* ------------------------------------------------------------------ */
/* Sept étapes ignorées ne font pas un déploiement                      */
/* ------------------------------------------------------------------ */

test('tout ignoré : rien n’a eu lieu', () => {
  assert.equal(
    miseEnLigneReelle({
      merge: 'skipped',
      commit: 'skipped',
      push: 'skipped',
      build: 'skipped',
      publish: 'skipped',
      restart: 'skipped',
    }),
    false,
  );
});

test('fusionner et envoyer comptent : c’est déjà du travail réel', () => {
  // Un projet sans instance sur ce serveur déploie tout de même son lot.
  assert.equal(
    miseEnLigneReelle({
      merge: 'done',
      commit: 'skipped',
      push: 'done',
      build: 'skipped',
      publish: 'skipped',
      restart: 'skipped',
    }),
    true,
  );
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
