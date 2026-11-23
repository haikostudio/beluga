import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PHRASES_DES_FAMILLES,
  estUnMessageTechnique,
  expliquerLErreur,
  familleDeLErreur,
  familleDeReponse,
  questionFamilleDErreur,
  phraseDeLErreurDeTour,
} from '@beluga/shared';

/*
 * UNE ERREUR AFFICHÉE DIT SA CAUSE RÉELLE, EN PHRASE SIMPLE.
 * Les messages de machine se rangent par famille ; une phrase déjà rédigée
 * passe telle quelle ; l'inconnu se dit honnêtement (et part à Jev).
 */

test('les pannes réelles se rangent dans la bonne famille', () => {
  assert.equal(familleDeLErreur('spawn git ENOTCONN'), 'stockage-injoignable');
  assert.equal(familleDeLErreur('ls: cannot access: Transport endpoint is not connected'), 'stockage-injoignable');
  assert.equal(familleDeLErreur('fatal: not a git repository (or any of the parent directories): .git'), 'sans-depot');
  assert.equal(familleDeLErreur('spawn claude EAGAIN'), 'machine-saturee');
  assert.equal(familleDeLErreur('API Error: 429 rate_limit_error'), 'quota');
  assert.equal(familleDeLErreur('API Error: 529 {"type":"overloaded_error"}'), 'panne-fournisseur');
  assert.equal(familleDeLErreur('SQLITE_BUSY: database is locked'), 'base-occupee');
  assert.equal(familleDeLErreur('ENOSPC: no space left on device, write'), 'disque-plein');
  assert.equal(familleDeLErreur('connect ECONNREFUSED 127.0.0.1:7070'), 'reseau');
  assert.equal(familleDeLErreur('ENOENT: no such file or directory, open /x'), 'introuvable');
  assert.equal(familleDeLErreur('CONFLICT (content): Merge conflict in a.ts'), 'conflit-git');
});

test('une phrase française déjà rédigée passe telle quelle', () => {
  const phrase = 'Ce projet est archivé : il ne reçoit plus de carte.';
  assert.equal(estUnMessageTechnique(phrase), false);
  const e = expliquerLErreur(phrase);
  assert.equal(e.phrase, phrase);
  assert.equal(e.source, 'telle-quelle');
  // Même quand elle cite un code : elle a été écrite pour être lue.
  assert.equal(expliquerLErreur('Le site répond HTTP 502 depuis dix minutes.').source, 'telle-quelle');
});

test('un message de machine reconnu prend la phrase de sa famille, sans code système', () => {
  const e = expliquerLErreur('spawn git ENOTCONN');
  assert.equal(e.phrase, PHRASES_DES_FAMILLES['stockage-injoignable']);
  assert.equal(e.brut, 'spawn git ENOTCONN');
  assert.doesNotMatch(e.phrase, /ENOTCONN|git|spawn/);
  assert.equal(e.aClasser, false);
});

test('une trace de bug évidente se reconnaît sans IA', () => {
  assert.equal(familleDeLErreur("TypeError: Cannot read properties of undefined (reading 'x')"), 'bug-interne');
  assert.equal(familleDeLErreur('ReferenceError: carte is not defined'), 'bug-interne');
});

test('un message de machine inconnu dit « erreur inattendue » et demande Jev', () => {
  const e = expliquerLErreur('Error: remote end hung up unexpectedly while pushing refs');
  assert.equal(e.famille, 'inconnue');
  assert.equal(e.phrase, PHRASES_DES_FAMILLES.inconnue);
  assert.equal(e.aClasser, true);
});

test('les phrases de famille ne portent aucun jargon', () => {
  for (const phrase of Object.values(PHRASES_DES_FAMILLES)) {
    assert.doesNotMatch(phrase, /\b(git|E[A-Z]{3,}|SQLITE|HTTP|sshfs|bind|spawn|moteur)\b/, phrase);
  }
});

test('le juge rapide choisit entre deux familles larges, et revient par leur nom', () => {
  const question = questionFamilleDErreur().famille;
  assert.equal(question.type, 'choice');
  assert.deepEqual(Object.keys((question as { criteria: Record<string, string> }).criteria), ['panne-exterieure', 'bug-interne']);
  const choix = (choice: string) => ({ type: 'choice' as const, choice, probabilities: {}, confidence: 0.9 });
  assert.equal(familleDeReponse(choix('bug-interne')), 'bug-interne');
  assert.equal(familleDeReponse(choix('inconnue')), undefined, '« inconnue » n’est jamais un choix offert');
  assert.equal(familleDeReponse(undefined), undefined);
});

test('une erreur de tour affiche la phrase de Jev quand elle existe, sinon la famille', () => {
  assert.equal(phraseDeLErreurDeTour({ cause: 'spawn claude EAGAIN' }), PHRASES_DES_FAMILLES['machine-saturee']);
  assert.equal(phraseDeLErreurDeTour({ cause: 'weird', phrase: 'Phrase posée.' }), 'Phrase posée.');
});

test('sans clé Jev au coffre, l’explication rend la phrase honnête sans lever', async () => {
  /* Base d'essai AVANT le premier import du démon (MEM-2544). */
  process.env.BELUGA_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'erreur-base-'));
  const { expliquerPourLEcran } = await import('../explication-d-erreur.js');
  const e = await expliquerPourLEcran('Error: something odd happened in module xyz');
  assert.equal(e.famille, 'inconnue');
  assert.equal(e.phrase, PHRASES_DES_FAMILLES.inconnue);
  const humain = await expliquerPourLEcran('Ce projet est archivé : il ne reçoit plus de carte.');
  assert.equal(humain.source, 'telle-quelle');
});
