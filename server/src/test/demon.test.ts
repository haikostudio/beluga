import assert from 'node:assert/strict';
import test from 'node:test';
import {
  avertissementRedemarrage,
  decisionDeRedemarrage,
  decisionSurSignalDArret,
  redemarrageNecessaire,
  resumeDeCeQuiSeraInterrompu,
  suiteDuRedemarrage,
} from '@haikodev/shared';

const DEMARRE = new Date('2026-08-03T09:00:00+02:00').getTime();

test('sans date de construction connue, on ne réclame rien', () => {
  assert.equal(redemarrageNecessaire({ demarreA: DEMARRE }), false);
});

test('code construit APRÈS le démarrage : le redémarrage est attendu', () => {
  assert.equal(redemarrageNecessaire({ demarreA: DEMARRE, construitA: DEMARRE + 60_000 }), true);
});

test('code construit AVANT le démarrage : rien à faire', () => {
  assert.equal(redemarrageNecessaire({ demarreA: DEMARRE, construitA: DEMARRE - 60_000 }), false);
});

test('une construction juste avant le démarrage ne se réclame pas elle-même', () => {
  // Le démon repart aussitôt après une construction : à 300 ms d'écart, la
  // marge évite qu'il demande un redémarrage dès sa première seconde.
  assert.equal(redemarrageNecessaire({ demarreA: DEMARRE, construitA: DEMARRE + 300 }), false);
});

test('l’avertissement nomme les agents qui seront interrompus', () => {
  assert.match(avertissementRedemarrage({ demarreA: DEMARRE }), /repart tout seul/);
  assert.match(avertissementRedemarrage({ demarreA: DEMARRE, agentsEnCours: 1 }), /^Un agent travaille/);
  assert.match(avertissementRedemarrage({ demarreA: DEMARRE, agentsEnCours: 3 }), /^3 agents travaillent/);
});

test('l’avertissement nomme le projet et la nature du travail quand on les connaît', () => {
  const texte = avertissementRedemarrage({
    demarreA: DEMARRE,
    agentsEnCours: 1,
    agentsDetail: ['le chef d’orchestre du projet « Vitrine »'],
  });
  assert.match(texte, /le chef d’orchestre du projet « Vitrine »/);
});

test('un décompte de détails qui ne correspond pas au nombre d’agents ne s’affiche pas à moitié', () => {
  const texte = avertissementRedemarrage({
    demarreA: DEMARRE,
    agentsEnCours: 2,
    agentsDetail: ['une carte du projet « X »'],
  });
  assert.doesNotMatch(texte, /une carte du projet/);
});

/*
 * FORCER LE REDÉMARRAGE — un geste explicite, jamais automatique.
 *
 * L'attente est la bonne règle tant que le travail AVANCE. Le jour où plus rien
 * n'avance, elle bloque l'utilisateur devant un bouton qui ne partira jamais :
 * le forçage est la sortie, et il ne s'obtient que par un second clic, après
 * avoir lu ce qui sera interrompu.
 */

test('sans forçage, un agent au travail retient toujours le redémarrage', () => {
  const decision = decisionDeRedemarrage({ demande: true, publications: [], agents: 1 });
  assert.equal(decision.action, 'attendre');
});

test('sans forçage, une publication retient toujours le redémarrage', () => {
  const decision = decisionDeRedemarrage({ demande: true, publications: ['Site vitrine'], agents: 0 });
  assert.equal(decision.action, 'attendre');
});

test('le forçage passe outre les agents ET les publications', () => {
  const decision = decisionDeRedemarrage({
    demande: true,
    publications: ['Site vitrine'],
    agents: 3,
    force: true,
  });
  assert.equal(decision.action, 'redemarrer');
  assert.equal(decision.raison, undefined);
});

test('le forçage ne crée jamais un redémarrage que personne n’a demandé', () => {
  // `demande: false` — un passage de veille, une fin de publication. Le drapeau
  // de forçage n'est pas une demande : sans clic, il ne se passe rien.
  const decision = decisionDeRedemarrage({ demande: false, publications: [], agents: 2, force: true });
  assert.equal(decision.action, 'rien');
});

test('la fenêtre NOMME ce qui va être interrompu avant de confirmer', () => {
  const resume = resumeDeCeQuiSeraInterrompu({
    demarreA: DEMARRE,
    agentsEnCours: 2,
    agentsDetail: ['la carte « Refonte » (HaikoDev)', 'le chef d’orchestre du projet « Vitrine »'],
    publications: ['Vitrine'],
  });
  assert.match(resume, /2 agents au travail/);
  assert.match(resume, /Refonte/);
  assert.match(resume, /une publication en cours/);
  assert.match(resume, /Vitrine/);
  // La promesse tenue par le démon : on sauve avant de couper.
  assert.match(resume, /enregistré sur la branche/);
});

test('rien qui tourne : le résumé le dit, il n’invente aucune victime', () => {
  const resume = resumeDeCeQuiSeraInterrompu({ demarreA: DEMARRE });
  assert.match(resume, /Rien ne tourne/);
});

test('la suite du redémarrage transmet le forçage', () => {
  const retenue = suiteDuRedemarrage(true, { publications: [], agents: 1 });
  assert.equal(retenue.redemarrer, false);
  assert.equal(retenue.enAttente, true);

  const forcee = suiteDuRedemarrage(true, { publications: [], agents: 1, force: true });
  assert.equal(forcee.redemarrer, true);
  assert.equal(forcee.enAttente, false);
});

test('un SIGNAL du dehors ne force jamais : il reste retenu', () => {
  // Le forçage est un geste humain pris dans la fenêtre. Un `pkill` venu d'un
  // script ne doit pas emprunter ce chemin-là.
  const decision = decisionSurSignalDArret({ publications: [], agents: 1 });
  assert.equal(decision.arreter, false);
  assert.equal(decision.retenu, true);
});
