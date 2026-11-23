import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ClientCommand,
  RAISON_SUSPENDU_EN_PAUSE,
  brouillonApresSuspension,
  carteEnPause,
  issueDeCarteOubliee,
  textesRendusParLaFile,
  travailRestant,
} from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* SUSPENDRE AU LIEU D'ARRÊTER                                          */
/*                                                                     */
/* Le bouton d'une carte coupe le tour SANS ranger la carte : elle      */
/* reste en « En cours », l'agent garde son contexte, et le prochain    */
/* message le relance. La file revient dans le champ d'écriture.        */
/* ------------------------------------------------------------------ */

test('la pause demande les DEUX marques : suspendu seul n’est pas une pause', () => {
  assert.equal(carteEnPause({ suspendu: true, enPause: true }), true);
  assert.equal(carteEnPause({ suspendu: true }), false);
  // Un geste qui efface `suspendu` sans connaître `enPause` lève la pause.
  assert.equal(carteEnPause({ suspendu: false, enPause: true }), false);
  assert.equal(carteEnPause(undefined), false);
});

test('la phrase de la carte dit ce qui la fera repartir', () => {
  assert.match(RAISON_SUSPENDU_EN_PAUSE, /suspendu/i);
  assert.match(RAISON_SUSPENDU_EN_PAUSE, /message/);
});

const oubliee = {
  colonne: 'running' as const,
  agentAuTravail: false,
  dernierTourEnEchec: true,
  dejaEnregistre: false,
};

test('le balayage laisse une carte en pause en « En cours »', () => {
  const issue = issueDeCarteOubliee({ ...oubliee, suspendue: true, enPause: true }, Date.now());
  assert.equal(issue.colonne, null);
});

test('…mais une suspension SANS pause reste un rangement perdu, renvoyé en « Planifié »', () => {
  const issue = issueDeCarteOubliee({ ...oubliee, suspendue: true }, Date.now());
  assert.equal(issue.colonne, 'planned');
});

test('la file rend les messages tapés, jamais les demandes internes', () => {
  const textes = textesRendusParLaFile([
    { text: '  premier message  ' },
    { text: 'relance interne', silencieuse: true },
    { text: 'poursuite', poursuite: true },
    { text: 'reprise de quota', repriseDe: 'm1' },
    { text: '   ' },
    { text: 'second message' },
  ]);
  assert.deepEqual(textes, ['premier message', 'second message']);
});

test('le texte déjà saisi reste en tête, la file suit après une ligne vide', () => {
  assert.equal(brouillonApresSuspension('ma phrase en cours\n', ['un', 'deux']), 'ma phrase en cours\n\nun\n\ndeux');
  assert.equal(brouillonApresSuspension('', ['seul']), 'seul');
  assert.equal(brouillonApresSuspension('rien à ajouter', []), 'rien à ajouter');
});

test('la carte en pause dit qu’elle attend un message, pas une relance', () => {
  const reste = travailRestant(
    { colonne: 'running', suspendu: true, enPause: true, dernierTourEnEchec: true },
    Date.now(),
  );
  assert.equal(reste?.nature, 'relance');
  assert.equal(reste?.etape, 'Agent suspendu');
  assert.match(reste?.attente ?? '', /prochain message/);
});

test('la commande de suspension existe, avec la carte d’où part le geste', () => {
  const cmd = ClientCommand.parse({ type: 'agent.suspend', agentId: 'a1', cardId: 'carte-1' });
  assert.equal((cmd as any).cardId, 'carte-1');
});

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SERVEUR = (fichier: string) => fs.readFileSync(path.resolve(ICI, `../../src/${fichier}`), 'utf8');

test('suspendre : file relevée puis vidée, pause posée, PUIS coupe', () => {
  const bloc = SERVEUR('ws.ts').split("case 'agent.suspend': {")[1].split('    case ')[0];
  const releve = bloc.indexOf('textesRendusParLaFile(store.listQueue(cmd.agentId))');
  const vide = bloc.indexOf('store.clearQueue(cmd.agentId)');
  const pause = bloc.indexOf('mettreLaCarteEnPause(carte)');
  const coupe = bloc.indexOf('arreterLAgent(cmd.agentId)');
  assert.ok(releve > 0 && vide > 0 && pause > 0 && coupe > 0, 'les quatre gestes doivent être là');
  assert.ok(releve < vide, 'la file se lit avant de se vider');
  assert.ok(vide < coupe, 'la file se vide AVANT la coupe (sinon le tour refermé la relance)');
  assert.ok(pause < coupe, 'la pause est posée AVANT la coupe');
  assert.match(bloc, /fileRendue/, 'la file repart vers l’écran');
  assert.doesNotMatch(bloc, /suspendreLaCarte\(/, 'suspendre ne range pas la carte');
  assert.doesNotMatch(bloc, /clearSession/, 'la session du moteur survit : le contexte est gardé');
});

test('la pause garde la colonne et pose les deux marques', () => {
  const corps = SERVEUR('deplacement-carte.ts').split('export function mettreLaCarteEnPause(')[1];
  assert.doesNotMatch(corps.split('\n}')[0], /column:/, 'la colonne ne bouge pas');
  assert.match(corps, /suspendu: true/);
  assert.match(corps, /enPause: true/);
  assert.match(corps, /tourEnVolDepuis: undefined/);
});

test('la fin du tour coupé ne range pas une carte en pause', () => {
  const corps = SERVEUR('deplacement-carte.ts').split('export function carteApresFinDeTour(')[1];
  const garde = corps.indexOf('carteEnPause(card.scheduling)');
  const issue = corps.indexOf('issueDeFinDeTour(');
  assert.ok(garde > 0 && garde < issue, 'la pause est lue avant toute issue de fin de tour');
});

test('le prochain tour lève la pause, même sans changer de colonne', () => {
  const corps = SERVEUR('runtime.ts').split('export function replacerCarteAuDemarrage(')[1].split('\n}\n')[0];
  assert.match(corps, /carteEnPause\(carte\.scheduling\)/);
  assert.match(corps, /suspendu: false, enPause: undefined, waitingReason: undefined/);
});

test('une carte en pause se reprend d’un clic ou d’un message, et peut se terminer', async () => {
  const { gestesDuParcours } = await import('@beluga/shared');
  const gestes = gestesDuParcours({
    colonne: 'running',
    roleAgent: 'task',
    tourEnCours: false,
    enPause: true,
    dernierTourEnEchec: true,
    messages: [
      { role: 'user', content: 'Réalise cette tâche' },
      { role: 'assistant', content: 'Je commence…' },
    ],
  } as any).map((g) => [g.geste, g.possible]);
  assert.deepEqual(gestes, [
    ['reprendre', true],
    ['terminer', true],
  ]);
});
