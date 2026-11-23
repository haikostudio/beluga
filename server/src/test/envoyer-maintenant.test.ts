import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClientCommand } from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* « ENVOYER MAINTENANT » SUR UN MESSAGE EN ATTENTE.                    */
/*                                                                     */
/* Le moteur est un processus à un tour : rien ne s'injecte en plein    */
/* tour. Le geste remonte la demande en TÊTE de file, coupe le tour     */
/* SANS vider la file, et la fin du tour coupé la dépile la première.   */
/* ------------------------------------------------------------------ */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SERVEUR = (fichier: string) => fs.readFileSync(path.resolve(ICI, `../../src/${fichier}`), 'utf8');

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'envoyer-maintenant-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');

const AGENT = 'agent-envoi-maintenant';

test('la demande choisie passe en tête, les autres gardent leur ordre', () => {
  const a = store.enqueuePrompt(AGENT, 'première');
  const b = store.enqueuePrompt(AGENT, 'deuxième');
  const c = store.enqueuePrompt(AGENT, 'troisième');
  assert.ok(a && b && c);

  assert.equal(store.agentDeLaDemandeEnFile(c.id), AGENT);
  assert.equal(store.remonterEnTete(c.id), AGENT);

  assert.deepEqual(
    store.listQueue(AGENT).map((x) => x.text),
    ['troisième', 'première', 'deuxième'],
  );
  // La file n'est PAS vidée : rien n'est perdu.
  assert.equal(store.listQueue(AGENT).length, 3);
  // Et c'est bien elle que la fin du tour dépile en premier.
  assert.equal(store.dequeuePrompt(AGENT)?.text, 'troisième');
  assert.equal(store.dequeuePrompt(AGENT)?.text, 'première');
  assert.equal(store.dequeuePrompt(AGENT)?.text, 'deuxième');
});

test('une demande déjà en tête reste en tête, et on peut répéter le geste', () => {
  const a = store.enqueuePrompt(AGENT, 'seule');
  const b = store.enqueuePrompt(AGENT, 'suivante');
  assert.ok(a && b);
  store.remonterEnTete(a.id);
  store.remonterEnTete(a.id);
  assert.deepEqual(
    store.listQueue(AGENT).map((x) => x.text),
    ['seule', 'suivante'],
  );
  store.clearQueue(AGENT);
});

test('une demande partie ne se remonte plus : le second clic ne coupe rien', () => {
  const a = store.enqueuePrompt(AGENT, 'partie');
  assert.ok(a);
  assert.equal(store.dequeuePrompt(AGENT)?.id, a.id);
  assert.equal(store.agentDeLaDemandeEnFile(a.id), null);
  assert.equal(store.remonterEnTete(a.id), null);
});

test('une demande qu’on était en train de modifier part quand même', () => {
  const a = store.enqueuePrompt(AGENT, 'en édition');
  const b = store.enqueuePrompt(AGENT, 'autre');
  assert.ok(a && b);
  store.marquerEditionEnFile(a.id, true);
  // Retenue : la file l'attend.
  assert.equal(store.dequeuePrompt(AGENT), null);
  store.remonterEnTete(a.id);
  assert.equal(store.dequeuePrompt(AGENT)?.text, 'en édition');
  store.clearQueue(AGENT);
});

test('la demande garde son identité et ses pièces en remontant', () => {
  store.enqueuePrompt(AGENT, 'avant');
  const interne = store.enqueuePrompt(AGENT, 'interne', ['piece-1'], 'msg-1', {
    silencieuse: true,
    compteImpose: 'claude-secondary',
  });
  assert.ok(interne);
  store.remonterEnTete(interne.id);
  const [tete] = store.listQueue(AGENT);
  assert.equal(tete.id, interne.id);
  assert.deepEqual(tete.attachments, ['piece-1']);
  assert.equal(tete.messageId, 'msg-1');
  assert.equal(tete.silencieuse, true);
  assert.equal(tete.compteImpose, 'claude-secondary');
  store.clearQueue(AGENT);
});

test('la commande existe et suit le droit de la file', () => {
  const cmd = ClientCommand.parse({ type: 'queue.send-now', id: 'q1' });
  assert.equal((cmd as any).id, 'q1');
  assert.match(fs.readFileSync(path.resolve(ICI, '../../../shared/src/droits-commandes.ts'), 'utf8'), /'queue\.send-now': 'file:id'/);
});

test('envoyer maintenant : remonte, pause AVANT la coupe, et ne vide JAMAIS la file', () => {
  const bloc = SERVEUR('ws.ts').split("case 'queue.send-now': {")[1].split('    case ')[0];
  const remonte = bloc.indexOf('store.remonterEnTete(cmd.id)');
  const pause = bloc.indexOf('mettreLaCarteEnPause(carte)');
  const coupe = bloc.indexOf('arreterLAgent(agentId)');
  assert.ok(remonte > 0 && pause > 0 && coupe > 0, 'les trois gestes doivent être là');
  assert.ok(remonte < coupe, 'la demande est en tête AVANT la coupe');
  assert.ok(pause < coupe, 'la pause est posée AVANT la coupe');
  assert.doesNotMatch(bloc, /clearQueue/, 'la file est gardée : le tour coupé la dépile');
  assert.doesNotMatch(bloc, /suspendreLaCarte\(/, 'la carte reste en « En cours »');
  assert.match(bloc, /TEXTE_CARTE_EN_PUBLICATION/, 'refusé sous une carte en publication');
  assert.match(bloc, /agentEnAttente\(agentId\)/, 'refusé sur un agent arrêté sur sa question');
  assert.match(bloc, /reprendreLaFile\(agentId\)/, 'agent libre : la file repart seulement');
  assert.doesNotMatch(bloc, /toast/, 'aucun toast sur un envoi réussi');
});

test('le tour coupé dépile la file : le chemin normal comme le secours', () => {
  const runtime = SERVEUR('runtime.ts');
  assert.match(runtime.split('async function startTurn')[0] + runtime, /enchainerLaFile\(agent\.id\);\n}/);
  const secours = runtime.split('function refermerLeTour(')[1];
  assert.match(secours, /enchainerLaFile\(agentId\);\n {2}return true;/);
});

test('le bouton rend sa requête dès le clic', () => {
  const composer = fs.readFileSync(path.resolve(ICI, '../../../web/src/components/composer.tsx'), 'utf8');
  const item = composer.split('function QueuedItem(')[1];
  assert.match(item, /type: 'queue\.send-now'/);
  assert.match(item, /setEnvoiEnCours\(true\)/);
  assert.match(item, /animate-spin/);
});
