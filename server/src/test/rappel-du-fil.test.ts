/**
 * LE FIL DU MOTEUR MEURT, LA CONVERSATION NON.
 *
 * Le chef d'orchestre garde une conversation qui ne s'arrête jamais, mais son
 * fil côté moteur repart à neuf pour trois fois rien : une session expirée chez
 * le fournisseur, un modèle ou un moteur changé dans les réglages. Le tour
 * suivant repartait alors avec le SEUL message qu'on venait d'écrire — et
 * « fais-en une carte » ne désigne plus rien. Ces contrôles retiennent la règle
 * qui lui rend ce que l'utilisateur, lui, voit encore à l'écran.
 *
 * Règles pures : ni base, ni démon, ni moteur.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { filARappeler, messagesDepuis, resumeContinuite } from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* 1. Quand faut-il rappeler le fil ?                                   */
/* ------------------------------------------------------------------ */

test('session repartie à neuf sur une conversation déjà entamée : on rappelle', () => {
  assert.equal(filARappeler({ nouvelleSession: true, echangesVisibles: 4 }), true);
});

test('une conversation réellement neuve ne reçoit aucun rappel', () => {
  assert.equal(filARappeler({ nouvelleSession: true, echangesVisibles: 0 }), false);
});

test('une session déjà ouverte n’a rien à rappeler : le moteur tient son fil', () => {
  assert.equal(filARappeler({ nouvelleSession: false, echangesVisibles: 12 }), false);
});

test('la compression garde la main : son résumé passe avant', () => {
  assert.equal(
    filARappeler({ nouvelleSession: true, echangesVisibles: 12, resumeDeCompression: 'RÉSUMÉ…' }),
    false,
  );
  // Un résumé vide n'en est pas un : le rappel reprend la main.
  assert.equal(
    filARappeler({ nouvelleSession: true, echangesVisibles: 12, resumeDeCompression: '   ' }),
    true,
  );
});

test('le changement de compte garde la main : il a déjà son résumé', () => {
  assert.equal(
    filARappeler({ nouvelleSession: true, echangesVisibles: 12, filSurUnAutreCompte: true }),
    false,
  );
});

/* ------------------------------------------------------------------ */
/* 2. Ce que le rappel dit à l'agent                                    */
/* ------------------------------------------------------------------ */

const RAPPEL = resumeContinuite({
  project: 'HaikoDev',
  workdir: '/tmp/projet',
  role: 'orchestrator',
  title: "Chef d'orchestre — HaikoDev",
  exchanges: [
    { role: 'user', content: 'Le bouton « Publier » du bandeau reste gris après un clic.' },
    { role: 'assistant', content: "C'est le témoin de requête qui ne se rallume pas." },
    { role: 'user', content: 'Fais-en une carte.' },
  ],
  motif: 'fil-neuf',
});

test('le rappel se présente comme le sujet EN COURS, pas comme une archive', () => {
  assert.match(RAPPEL, /CE QUI A DÉJÀ ÉTÉ DIT DANS CETTE CONVERSATION/);
  assert.match(RAPPEL, /PAS UNE ARCHIVE/);
});

test('il dit que le message suivant peut renvoyer au fil sans le nommer', () => {
  for (const mot of ['« ça »', 'fais-en une carte', 'vas-y']) {
    assert.ok(RAPPEL.includes(mot), `« ${mot} » manque au rappel`);
  }
  assert.match(RAPPEL, /nomme-le en toutes lettres/i);
});

test('il interdit de repartir de zéro sur un sujet déjà discuté', () => {
  assert.match(RAPPEL, /Ne redis pas bonjour/);
  assert.match(RAPPEL, /ne traite pas comme un sujet neuf/i);
});

test('les échanges eux-mêmes voyagent : le sujet est retrouvable', () => {
  assert.match(RAPPEL, /bouton « Publier »/);
  assert.match(RAPPEL, /Fais-en une carte/);
});

test('les trois motifs ne se disent pas de la même façon', () => {
  const base = { project: 'P', workdir: '/w', role: 'orchestrator', title: 'T', exchanges: [] };
  const titres = (['compression', 'changement-de-compte', 'fil-neuf'] as const).map(
    (motif) => resumeContinuite({ ...base, motif }).split('\n')[0],
  );
  assert.equal(new Set(titres).size, 3);
});

/* ------------------------------------------------------------------ */
/* 3. « Repartir de zéro » n'est pas rattrapé par le rappel             */
/* ------------------------------------------------------------------ */

test('les messages d’avant le nouveau départ restent derrière leur repère', () => {
  const messages = [
    { id: 'a', createdAt: 100, content: 'ancien sujet' },
    { id: 'b', createdAt: 500, content: 'nouveau sujet' },
  ];
  const visibles = messagesDepuis(messages, 300);
  assert.deepEqual(visibles.map((m) => m.id), ['b']);
});
