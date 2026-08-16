import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DUREE_REUSSITE_MS,
  EVENEMENT_ATTENTE_LONGUE,
  SEUIL_LONGUE_ATTENTE_MS,
  boutonOccupe,
  motDAttenteLongue,
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
const CLIENT = path.resolve(ICI, '../../../web/src/lib/client.ts');
const PARCOURS = path.resolve(ICI, '../../../web/src/components/parcours-tache.tsx');
const MESSAGES = path.resolve(ICI, '../../../web/src/components/message-view.tsx');
const PANNEAU_DROIT = path.resolve(ICI, '../../../web/src/components/right-panel.tsx');

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

test('une attente qui dure se dit, sans rien conclure', () => {
  assert.equal(SEUIL_LONGUE_ATTENTE_MS, 10_000);
  const mot = motDAttenteLongue('Terminer la tâche');
  assert.match(mot, /Terminer la tâche/);
  assert.match(mot, /prend plus de temps/);
  // Ni panne, ni réussite : la demande est partie, elle attend.
  assert.ok(!/panne|échec|erreur|réussi/i.test(mot));
  assert.match(motDAttenteLongue(), /^La demande/);
  assert.match(motDAttenteLongue('   '), /^La demande/);
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

test('l’attente longue part du bouton et arrive aux messages passagers', () => {
  const bouton = fs.readFileSync(UI, 'utf8');
  const client = fs.readFileSync(CLIENT, 'utf8');
  // Le socle visuel ne connaît pas les messages passagers : il annonce à la page…
  assert.ok(bouton.includes('EVENEMENT_ATTENTE_LONGUE'));
  assert.ok(bouton.includes('SEUIL_LONGUE_ATTENTE_MS'));
  assert.ok(!/pushToast/.test(bouton), 'le socle visuel ne doit pas appeler les messages passagers');
  // …et c'est le client qui l'écoute et la met en mots, sans crier à la panne.
  assert.ok(client.includes(`addEventListener(${'EVENEMENT_ATTENTE_LONGUE'}`));
  assert.ok(client.includes('motDAttenteLongue'));
  assert.ok(/pushToast\('info'/.test(client));
  assert.ok(EVENEMENT_ATTENTE_LONGUE.startsWith('haikodev:'));
});

test('les onglets qui vont chercher leurs données le disent aussi', () => {
  const panneau = fs.readFileSync(PANNEAU, 'utf8');
  const parcours = fs.readFileSync(PARCOURS, 'utf8');
  assert.ok(panneau.includes('useOngletsQuiChargent'));
  assert.ok(panneau.includes('data-onglet-charge'));
  assert.ok(parcours.includes("useChargementOnglet('details'"));
  assert.ok(panneau.includes("useChargementOnglet('github'"));
});

test('plus aucun bouton repris ne garde sa roue maison', () => {
  /*
   * Les gestes repris — actualiser GitHub, fusionner, ajouter la ligne de
   * facturation, répondre ou annuler une question, télécharger des fichiers —
   * ne portent plus de drapeau `busy` à eux : leur clic REND sa requête et le
   * bouton fait le reste. Deux mécaniques pour un seul geste, c'était une de
   * trop.
   */
  for (const fichier of [PANNEAU, PANNEAU_DROIT]) {
    const source = fs.readFileSync(fichier, 'utf8');
    assert.ok(!/const \[busy, setBusy\]/.test(source), `drapeau maison restant dans ${path.basename(fichier)}`);
  }
  const messages = fs.readFileSync(MESSAGES, 'utf8');
  assert.ok(!/disabled=\{annulation\}/.test(messages));
  assert.ok(!/disabled=\{!pret \|\| busy\}/.test(messages));
  /*
   * Une exception ASSUMÉE, et elle reste : le choix d'un compte de reprise est
   * une LISTE de boutons bruts dont un seul clic doit éteindre TOUS les autres.
   * Aucun état porté par un bouton ne sait faire cela.
   */
  assert.ok(/data-compte-reprise/.test(messages) && /const \[busy, setBusy\]/.test(messages));
});
