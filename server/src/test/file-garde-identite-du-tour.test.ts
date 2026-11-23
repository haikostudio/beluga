import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------ */
/* UNE DEMANDE MISE EN FILE GARDE L'IDENTITÉ DE SON TOUR.              */
/*                                                                     */
/* Le bogue rapporté : « la question du compte Claude à sélectionner    */
/* revient sans arrêt ». Dix fois de suite sur la même carte, le        */
/* 06.09.2026 : à chaque question, « Claude Max x20 » était choisi, à   */
/* chaque fois le tour repartait sur « Claude Pro », retombait sur la   */
/* même limite, et reposait la même question.                          */
/*                                                                     */
/* La cause : la fin d'un tour se joue DANS sa préparation             */
/* (`preparerLeTour` attend `startTurn` jusqu'au bout), donc l'agent    */
/* est encore marqué occupé quand la reprise part. Elle passait par la  */
/* file ordinaire — c'est normal, elle y prend son rang — mais cette    */
/* file ne transportait qu'un texte et ses pièces jointes. Le compte    */
/* IMPOSÉ par le choix humain et le SILENCE de la demande y             */
/* disparaissaient : le tour repartait sur le compte du choix           */
/* automatique, c'est-à-dire celui que la limite venait de fermer, et   */
/* la consigne interne s'affichait comme un message de l'utilisateur.   */
/*                                                                     */
/* Preuve dans la base ce jour-là : dix messages « REPRISE APRÈS        */
/* ÉPUISEMENT DU QUOTA » en rôle `user`, et dix réponses portant        */
/* `account: Claude Pro` alors que `repriseCompte.choisi` valait        */
/* `claude-secondary`.                                                 */
/* ------------------------------------------------------------------ */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME = fs.readFileSync(path.resolve(ICI, '../../src/runtime.ts'), 'utf8');

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'file-identite-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');

const AGENT = 'agent-de-la-file';

/* -------- Ce que la file transporte vraiment -------- */

test('le compte imposé et le silence traversent la file, en base', () => {
  const empilee = store.enqueuePrompt(AGENT, 'REPRISE APRÈS ÉPUISEMENT DU QUOTA.', [], undefined, {
    silencieuse: true,
    compteImpose: 'claude-secondary',
  });
  assert.ok(empilee, 'la demande doit entrer en file');

  // Relue depuis la base, et non depuis l'objet rendu : c'est le trajet réel.
  const [enFile] = store.listQueue(AGENT);
  assert.equal(enFile.silencieuse, true, 'une demande interne ne redevient pas un message de l’utilisateur');
  assert.equal(enFile.compteImpose, 'claude-secondary', 'le compte choisi à la main ne se perd pas en chemin');

  const depilee = store.dequeuePrompt(AGENT);
  assert.equal(depilee?.silencieuse, true);
  assert.equal(depilee?.compteImpose, 'claude-secondary');
});

test('une demande ordinaire n’hérite d’aucun compte ni d’aucun silence', () => {
  store.enqueuePrompt(AGENT, 'Ajoute un bouton.', []);
  const depilee = store.dequeuePrompt(AGENT);
  assert.equal(depilee?.silencieuse, undefined, 'un message tapé reste un message tapé');
  assert.equal(depilee?.compteImpose, undefined, 'et il part sur le choix habituel de compte');
});

test('la bulle déjà écrite traverse la file elle aussi', () => {
  store.enqueuePrompt(AGENT, 'Reprends.', [], 'bulle-1', { compteImpose: 'claude-secondary' });
  const depilee = store.dequeuePrompt(AGENT);
  assert.equal(depilee?.messageId, 'bulle-1', 'sans quoi la même phrase s’afficherait deux fois');
});

/* -------- Les deux bouts du trajet, dans le démon -------- */

test('l’empilage emporte le silence, le compte imposé et la bulle déjà écrite', () => {
  const bloc = RUNTIME.split('if (live.has(agentId) || demarrant.has(agentId)) {')[1].split('\n  }')[0];
  assert.match(
    bloc,
    /store\.enqueuePrompt\(agentId, text, options\.attachments \?\? \[\], options\.messageDejaEcrit, \{\n\s+silencieuse: options\.silent,\n\s+compteImpose: options\.compteImpose,\n\s+poursuite: options\.poursuite,\n\s+repriseDe: options\.repriseDe,\n\s+\}\)/,
    'tout ce qui distingue ce tour doit entrer en file avec lui',
  );
  assert.match(
    bloc,
    /posterTraitementEnAttente\.set\(queued\.id, options\.onComplete\)/,
    'le post-traitement ne s’écrit pas en base : il attend en mémoire, sous le nom de l’élément empilé',
  );
});

test('le dépilage rend au tour son compte imposé et son silence', () => {
  const corps = (RUNTIME.split('function enchainerLaFile(agentId: string): void {')[1].split('\n}')[0] +
    // L'envoi de la demande dépilée vit à part depuis le 04/11/2026 (`enchainementEnVol`).
    RUNTIME.split('function envoyerLaDemandeDepilee(')[1].split('\n}')[0]);
  assert.match(corps, /silent: next\.silencieuse \|\| undefined,/);
  assert.match(
    corps,
    /compteImpose: next\.compteImpose,/,
    'sans lui, une reprise repart sur le compte que la limite vient de fermer',
  );
  assert.match(corps, /onComplete,/, 'et le post-traitement retrouvé lui revient');
  assert.match(corps, /posterTraitementEnAttente\.delete\(next\.id\);/, 'la mémoire ne garde rien après coup');
});

test('un compte demandé qu’on ne peut pas tenir se DIT, au lieu de se deviner sur un écran qui boucle', () => {
  const bloc = RUNTIME.split('const decision = compteDuTour({')[1].split('const account = compteRetenu')[0];
  assert.match(bloc, /if \(decision\.refuse\) \{/);
  assert.match(bloc, /log\.warn\(/);
  /* …et la règle du compte est celle de `shared`, avec ses quatre entrées. */
  assert.match(bloc, /impose: options\.compteImpose,/);
  assert.match(bloc, /regle: agent\.run\.account,/);
  assert.match(bloc, /dernier: agent\.account,/);
  assert.match(bloc, /limites: limitesConnues\(\),/);
});

test('le dépilage rend au tour la reprise qu’il consomme, et jette une reprise déjà consommée', () => {
  const corps = (RUNTIME.split('function enchainerLaFile(agentId: string): void {')[1].split('\n}')[0] +
    // L'envoi de la demande dépilée vit à part depuis le 04/11/2026 (`enchainementEnVol`).
    RUNTIME.split('function envoyerLaDemandeDepilee(')[1].split('\n}')[0]);
  assert.match(corps, /purgerLesReprisesMortes\(agentId\);/, 'la file se purge AVANT de dépiler');
  assert.match(corps, /repriseDe: next\.repriseDe,/, 'la reprise voyage avec la demande dépilée');
  const purge = RUNTIME.split('function purgerLesReprisesMortes(agentId: string): number {')[1].split('\n}')[0];
  assert.match(purge, /reprise\.consommeeA/, 'une reprise consommée est morte');
  assert.match(purge, /reprise\.abandonnee/, 'une reprise abandonnée aussi');
  assert.match(purge, /store\.removeQueued\(demande\.id\)/, 'et elle est retirée de la file, jamais dépilée');
  const filet = RUNTIME.split('export async function reprendreLesFilesEnAttente(): Promise<void> {')[1].split('\n}')[0];
  assert.match(filet, /purgerLesReprisesMortes\(agent\.id\);/, 'le filet de veille purge aussi — même après un redémarrage');
});
