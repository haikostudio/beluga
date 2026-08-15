import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TITRE_DU_PROCESSUS,
  decisionDeRedemarrage,
  decisionSurSignalDArret,
  raisonAgents,
  raisonSignalRetenu,
  suiteDuRedemarrage,
} from '@haikodev/shared';

/*
 * NE JAMAIS REDÉMARRER PENDANT UNE PUBLICATION.
 *
 * Le serveur porte TOUTES les publications : le redémarrer en coupe une en plein
 * vol. La règle pure tranche — redémarrer, attendre, ou rien — à partir de l'état
 * des publications et des agents.
 */

test('une publication en cours refuse le redémarrage et nomme le projet', () => {
  const decision = decisionDeRedemarrage({ demande: true, publications: ['Brain'], agents: 0 });
  assert.equal(decision.action, 'attendre');
  assert.match(decision.raison ?? '', /Brain/);
});

test('plusieurs publications sont toutes nommées', () => {
  const decision = decisionDeRedemarrage({ demande: true, publications: ['Brain', 'La Roma'], agents: 0 });
  assert.equal(decision.action, 'attendre');
  assert.match(decision.raison ?? '', /Brain/);
  assert.match(decision.raison ?? '', /La Roma/);
});

test('un agent au travail fait attendre, publication finie', () => {
  const decision = decisionDeRedemarrage({ demande: true, publications: [], agents: 2 });
  assert.equal(decision.action, 'attendre');
  assert.match(decision.raison ?? '', /agents/);
});

test('un agent au travail nomme le projet quand on le connaît', () => {
  const decision = decisionDeRedemarrage({
    demande: true,
    publications: [],
    agents: 1,
    agentsDetail: ['le chef d’orchestre du projet « Brain »'],
  });
  assert.equal(decision.action, 'attendre');
  assert.match(decision.raison ?? '', /le chef d’orchestre du projet « Brain »/);
});

test('la publication passe AVANT les agents dans la raison', () => {
  const decision = decisionDeRedemarrage({ demande: true, publications: ['Brain'], agents: 3 });
  assert.equal(decision.action, 'attendre');
  assert.match(decision.raison ?? '', /Brain/);
});

test('aucune publication et aucun agent : redémarrage immédiat', () => {
  const decision = decisionDeRedemarrage({ demande: true, publications: [], agents: 0 });
  assert.equal(decision.action, 'redemarrer');
  assert.equal(decision.raison, undefined);
});

test('sans demande, il n’y a rien à faire', () => {
  const decision = decisionDeRedemarrage({ demande: false, publications: ['Brain'], agents: 5 });
  assert.equal(decision.action, 'rien');
});

test('un nom vide ne compte pas comme une publication', () => {
  const decision = decisionDeRedemarrage({ demande: true, publications: ['  '], agents: 0 });
  assert.equal(decision.action, 'redemarrer');
});

test('la dernière publication finie lance le redémarrage une seule fois', () => {
  // Une demande retenue pendant qu'une publication tourne.
  let enAttente = true;
  const enPublication = suiteDuRedemarrage(enAttente, { publications: ['Brain'], agents: 0 });
  assert.equal(enPublication.redemarrer, false);
  assert.equal(enPublication.enAttente, true);
  enAttente = enPublication.enAttente;

  // La publication se termine : le redémarrage part, et la demande retombe.
  const finie = suiteDuRedemarrage(enAttente, { publications: [], agents: 0 });
  assert.equal(finie.redemarrer, true);
  assert.equal(finie.enAttente, false);
  enAttente = finie.enAttente;

  // Un second passage sans demande ne relance rien : une seule fois.
  const encore = suiteDuRedemarrage(enAttente, { publications: [], agents: 0 });
  assert.equal(encore.redemarrer, false);
  assert.equal(encore.enAttente, false);
});

/*
 * UN SIGNAL D'ARRÊT VENU DU DEHORS SUIT LA MÊME RÈGLE.
 *
 * Le 14/08/2026, un agent faisant le ménage de ses processus d'essai avec
 * `pkill -f "server/dist/main.js"` a coupé le démon de production trois fois en
 * cinq minutes : le signal arrivait droit sur l'arrêt, sans rien regarder.
 */

test('un signal d’arrêt est RETENU tant qu’un agent travaille', () => {
  const decision = decisionSurSignalDArret({ publications: [], agents: 1 });
  assert.equal(decision.arreter, false);
  assert.equal(decision.retenu, true);
  assert.match(decision.raison ?? '', /agent/i);
});

test('un signal d’arrêt est RETENU tant qu’une publication tourne, et nomme le projet', () => {
  const decision = decisionSurSignalDArret({ publications: ['Brain'], agents: 0 });
  assert.equal(decision.arreter, false);
  assert.match(decision.raison ?? '', /Brain/);
});

test('sans rien en vol, le signal d’arrêt est obéi tout de suite', () => {
  const decision = decisionSurSignalDArret({ publications: [], agents: 0 });
  assert.equal(decision.arreter, true);
  assert.equal(decision.retenu, false);
  assert.equal(decision.raison, undefined);
});

test('un signal répété ne passe jamais outre : il reste retenu', () => {
  // C'est le cas réel : le même `pkill` relancé trois fois de suite.
  for (let essai = 0; essai < 3; essai += 1) {
    const decision = decisionSurSignalDArret({ publications: [], agents: 2 });
    assert.equal(decision.arreter, false);
  }
});

test('la raison retenue se dit en une phrase compréhensible', () => {
  const phrase = raisonSignalRetenu('SIGTERM', raisonAgents(1));
  assert.match(phrase, /SIGTERM/);
  assert.match(phrase, /ne se coupe pas/);
});

test('le nom du processus ne contient plus le chemin du fichier construit', () => {
  // Sinon un `pkill -f "server/dist/main.js"` retrouve le démon, et aucun
  // programme ne peut retenir un `kill -9`.
  assert.doesNotMatch(TITRE_DU_PROCESSUS, /main\.js|dist/);
  assert.match(TITRE_DU_PROCESSUS, /haikodev/);
});
