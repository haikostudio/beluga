/*
 * CARTE « Mémoire, bulles, publication et marketing » (19/11/2026) : l'audit GEO choisit seul un Chrome allumé dont
 * l'extension sait ouvrir une fenêtre privée ; sinon rien ne s'ouvre et le suivi dit quoi mettre à jour.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { versionAuMoins, VERSION_MIN_FENETRE_PRIVEE, choisirPourFenetrePrivee, etatDuPassage, type Ordinateur } from '@beluga/shared';

const aJour = (v: string | null) => versionAuMoins(v, VERSION_MIN_FENETRE_PRIVEE);

function ordinateur(id: string, nom: string, version: string | null, enLigne = true, vuLe = 1): Ordinateur {
  return { id, nom, repere: id, creeLe: 0, programme: null, navigateurs: [{ id: `chrome-${id}`, genre: 'chrome', enLigne, version, vuLe, agentsAuTravail: 0 }] };
}

test('les versions se comparent chiffre par chiffre ; une version inconnue est trop ancienne', () => {
  assert.equal(versionAuMoins('1.0.9', '1.0.9'), true);
  assert.equal(versionAuMoins('1.0.10', '1.0.9'), true);
  assert.equal(versionAuMoins('1.1', '1.0.9'), true);
  assert.equal(versionAuMoins('1.0.8', '1.0.9'), false);
  assert.equal(versionAuMoins('1.0.5', '1.0.9'), false);
  assert.equal(versionAuMoins(null, '1.0.9'), false);
  assert.equal(versionAuMoins('', '1.0.9'), false);
  assert.equal(versionAuMoins('bêta', '1.0.9'), false);
});

test('aucun Chrome à jour : rien ne s’ouvre, et la phrase dit quoi mettre à jour et où', () => {
  const choix = choisirPourFenetrePrivee([ordinateur('mini', 'MacMini', '1.0.8'), ordinateur('mac', 'Mac', '1.0.5')], VERSION_MIN_FENETRE_PRIVEE, aJour);
  assert.equal(choix.genre, 'a-mettre-a-jour');
  if (choix.genre !== 'a-mettre-a-jour') return;
  assert.match(choix.aMettreAJour, /MacMini.*1\.0\.8/);
  assert.match(choix.texte, /rien n’a été ouvert/);
  assert.match(choix.texte, /Autoriser en navigation privée/);
});

test('le Chrome à jour l’emporte, même si l’ordinateur retenu d’habitude est trop ancien', () => {
  const choix = choisirPourFenetrePrivee([ordinateur('mac', 'Mac', '1.0.5', true, 9), ordinateur('mini', 'MacMini', '1.0.9', true, 1)], VERSION_MIN_FENETRE_PRIVEE, aJour, 'mac');
  assert.equal(choix.genre, 'pret');
  if (choix.genre === 'pret') assert.equal(choix.ordinateur.nom, 'MacMini');
});

test('plusieurs à jour : celui du dernier passage d’abord, sinon le plus récemment vu', () => {
  const parc = [ordinateur('a', 'A', '1.0.10', true, 50), ordinateur('b', 'B', '1.0.9', true, 10)];
  const dernier = choisirPourFenetrePrivee(parc, VERSION_MIN_FENETRE_PRIVEE, aJour, 'b');
  assert.equal(dernier.genre === 'pret' && dernier.ordinateur.id, 'b');
  const recent = choisirPourFenetrePrivee(parc, VERSION_MIN_FENETRE_PRIVEE, aJour, null);
  assert.equal(recent.genre === 'pret' && recent.ordinateur.id, 'a');
});

test('un Chrome à jour mais éteint ne compte pas ; Safari non plus', () => {
  const safari: Ordinateur = { id: 's', nom: 'S', repere: 's', creeLe: 0, programme: null, navigateurs: [{ id: 'sa', genre: 'safari', enLigne: true, version: '2.0.0', vuLe: 1, agentsAuTravail: 0 }] };
  const choix = choisirPourFenetrePrivee([ordinateur('m', 'M', '1.0.9', false), safari], VERSION_MIN_FENETRE_PRIVEE, aJour);
  assert.equal(choix.genre, 'aucun');
});

test('le suivi dit « attend la mise à jour » avant « autorisation »', () => {
  assert.equal(etatDuPassage({ complet: false, colonneDeLaCarte: 'todo', chromeEnLigne: true, autorisationManquante: true, miseAJourManquante: true }), 'attend-mise-a-jour');
  assert.equal(etatDuPassage({ complet: false, colonneDeLaCarte: 'running', chromeEnLigne: true, autorisationManquante: false, miseAJourManquante: true }), 'en-cours');
  assert.equal(etatDuPassage({ complet: false, colonneDeLaCarte: 'todo', chromeEnLigne: true, autorisationManquante: false }), 'a-faire');
});
