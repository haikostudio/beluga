import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DUREE_REUSSITE_MS,
  boutonOccupe,
  estUneRequete,
  etatApresIssue,
  issueDeLaReponse,
  suiteDesEtats,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* UN BOUTON QUI PART EN REQUÊTE LE DIT TOUT DE SUITE.                 */
/*                                                                     */
/* « Terminer la tâche » restait figé entre le clic et la réponse : on */
/* croyait que rien ne s'était passé, et on recliquait.                */
/* ------------------------------------------------------------------ */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const UI = path.resolve(ICI, '../../../web/src/components/ui/index.tsx');
const PANNEAU = path.resolve(ICI, '../../../web/src/components/card-panel.tsx');

/* -------- La règle pure -------- */

test('un clic ouvre l’attente, et un second clic ne repart pas', () => {
  assert.equal(suiteDesEtats('repos', 'clic'), 'en-cours');
  assert.equal(suiteDesEtats('en-cours', 'clic'), 'en-cours');
  assert.ok(boutonOccupe('en-cours'));
  assert.ok(!boutonOccupe('repos'));
  // La coche reste cliquable : refaire un geste n'attend pas une animation.
  assert.ok(!boutonOccupe('reussi'));
});

test('la réussite se montre, puis s’efface d’elle-même', () => {
  assert.equal(suiteDesEtats('en-cours', 'reussite'), 'reussi');
  assert.equal(suiteDesEtats('reussi', 'fin-de-coche'), 'repos');
  assert.equal(suiteDesEtats('en-cours', 'fin-de-coche'), 'en-cours');
  assert.ok(DUREE_REUSSITE_MS > 500 && DUREE_REUSSITE_MS < 3000);
});

test('un échec ramène le bouton à son état initial', () => {
  assert.equal(suiteDesEtats('en-cours', 'echec'), 'repos');
  assert.equal(etatApresIssue('echec'), 'repos');
  assert.equal(etatApresIssue('reussite'), 'reussi');
});

test('un refus rendu sans erreur reste un échec', () => {
  // `moveCard` et `validerCarte` ne lèvent rien : elles rendent { ok: false }.
  assert.equal(issueDeLaReponse({ ok: false, error: 'déplacement refusé' }), 'echec');
  assert.equal(issueDeLaReponse({ ok: true }), 'reussite');
  assert.equal(issueDeLaReponse(undefined), 'reussite');
  assert.equal(issueDeLaReponse({ etat: 'quelconque' }), 'reussite');
});

test('seule une vraie requête ouvre l’attente', () => {
  assert.ok(estUneRequete(Promise.resolve()));
  assert.ok(estUneRequete({ then: () => undefined }));
  assert.ok(!estUneRequete(undefined));
  assert.ok(!estUneRequete(null));
  assert.ok(!estUneRequete(false));
  assert.ok(!estUneRequete({ ok: true }));
});

/* -------- L'écran s'en sert vraiment -------- */

test('le bouton branche la règle au lieu de la redire à sa façon', () => {
  const source = fs.readFileSync(UI, 'utf8');
  for (const nom of ['estUneRequete', 'etatApresIssue', 'issueDeLaReponse', 'suiteDesEtats', 'DUREE_REUSSITE_MS']) {
    assert.ok(source.includes(nom), `le bouton devrait utiliser ${nom}`);
  }
  // La roue pendant l'attente, la coche à la réussite.
  assert.ok(/animate-spin/.test(source));
  assert.ok(/data-attente/.test(source));
  // Les enfants gardent leur place : le bouton ne doit pas rétrécir.
  assert.ok(/opacity-0/.test(source));
});

test('un lancement ou une clôture refusés ne montrent pas de coche', () => {
  const source = fs.readFileSync(PANNEAU, 'utf8');
  // Les deux gestes disent leur refus PUIS le relancent : sans cela le bouton
  // verrait une requête « réussie » et afficherait une coche sur un refus.
  const relances = source.match(/signalerRefus\([^)]*\);\s*(\/\/[^\n]*\n\s*)*throw err;/g) ?? [];
  assert.ok(relances.length >= 2, `refus relancés : ${relances.length}`);
});
