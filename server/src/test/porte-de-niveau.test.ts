import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attenteDuMotPermise,
  attenteRouverteSansGeste,
  creerPorteDeNiveau,
  ecouteVoulueHorsEcran,
  niveauRms,
} from '@beluga/shared';

test('le micro d’attente ne vit pas hors de l’écran ; une conversation va jusqu’à sa fin', () => {
  assert.equal(attenteDuMotPermise({ visible: true, conversation: false }), true);
  assert.equal(attenteDuMotPermise({ visible: false, conversation: false }), false, 'point orange application fermée');
  assert.equal(attenteDuMotPermise({ visible: false, conversation: true }), true);
  assert.equal(ecouteVoulueHorsEcran({ conversation: false }), false);
  assert.equal(ecouteVoulueHorsEcran({ conversation: true }), true);
});

test('seule l’application iPhone rouvre l’attente sans geste, et jamais si on l’a coupée', () => {
  assert.equal(attenteRouverteSansGeste({ appNative: true, coupeParLUtilisateur: false }), true);
  assert.equal(attenteRouverteSansGeste({ appNative: true, coupeParLUtilisateur: true }), false);
  assert.equal(attenteRouverteSansGeste({ appNative: false, coupeParLUtilisateur: false }), false);
});

test('la porte laisse passer la voix proche et écarte la voix lointaine', () => {
  const porte = creerPorteDeNiveau();
  // Bruit de fond d'un bureau, puis une voix lointaine (~ -14 dB sous la voix proche), puis la voix proche.
  for (let i = 0; i < 30; i += 1) porte.juger(0.004, 85);
  assert.ok(porte.plancher() >= 0.003 && porte.plancher() <= 0.005);
  assert.equal(porte.juger(0.01, 85), false, 'voix lointaine écartée');
  assert.equal(porte.juger(0.08, 85), true, 'voix proche admise');
  // Le maintien garde la fin du mot.
  assert.equal(porte.juger(0.004, 85), true);
  for (let i = 0; i < 5; i += 1) porte.juger(0.004, 85);
  assert.equal(porte.juger(0.004, 85), false, 'puis la porte se referme');
  porte.ouvrirPendant(1000);
  assert.equal(porte.juger(0.001, 85), true, 'le début du mot rejoué ne se coupe jamais');
});

test('le niveau RMS', () => {
  assert.equal(niveauRms([]), 0);
  assert.ok(Math.abs(niveauRms([0.5, -0.5, 0.5, -0.5]) - 0.5) < 1e-9);
});

test('un plancher appris trop haut ne ferme jamais la porte à une voix tenue à la main', async () => {
  const { creerPorteDeNiveau: creer } = await import('@beluga/shared');
  const porte = creer();
  // Un endroit bruyant, appris AVANT le mode « appel » de l'iPhone.
  for (let i = 0; i < 40; i += 1) porte.juger(0.02, 85);
  assert.ok(porte.plancher() <= 0.006, 'plancher borné');
  assert.equal(porte.juger(0.0316, 85), true, 'voix à -30 dBFS admise');
});

test('la porte oublie le fond appris quand le mode audio change, et réapprend vite', async () => {
  const { creerPorteDeNiveau: creer } = await import('@beluga/shared');
  const porte = creer();
  for (let i = 0; i < 40; i += 1) porte.juger(0.005, 85);
  porte.oublier();
  assert.equal(porte.plancher(), 0.003);
  // Le traitement vocal d'Apple baisse tout : le nouveau fond s'apprend en quelques blocs.
  for (let i = 0; i < 10; i += 1) porte.juger(0.001, 85);
  assert.equal(porte.juger(0.02, 85), true);
});

test('il a parlé pendant la connexion : seulement après un vrai moment de parole', async () => {
  const { paroleEntendue } = await import('@beluga/shared');
  assert.equal(paroleEntendue([], 85), false);
  assert.equal(paroleEntendue([0.001, 0.002, 0.003, 0.002], 85), false, 'silence');
  assert.equal(paroleEntendue([0.001, 0.2, 0.001, 0.002], 85), false, 'un claquement isolé');
  assert.equal(paroleEntendue([0.001, 0.05, 0.04, 0.03, 0.05, 0.001], 85), true, 'une phrase');
});

test('le contrôle de vie : le silence n’est jamais une panne, un son coupé ou muet le devient', async () => {
  const { creerControleDeVie } = await import('@beluga/shared');
  const ok = { contexte: 'running', entendu: 0.002, envoye: 0, pisteFinie: false };
  const vie = creerControleDeVie(3);
  for (let s = 1; s <= 10; s += 1) assert.equal(vie.juger({ ...ok, blocs: s * 12 }), 'ok', 'il se tait');
  // Une voix franche entendue, rien envoyé : panne au bout de trois secondes.
  const muet = creerControleDeVie(3);
  assert.equal(muet.juger({ ...ok, blocs: 12, entendu: 0.1 }), 'ok');
  assert.equal(muet.juger({ ...ok, blocs: 24, entendu: 0.1 }), 'ok');
  assert.equal(muet.juger({ ...ok, blocs: 36, entendu: 0.1 }), 'panne');
  assert.match(muet.raison(), /rien envoyé/);
  // Contexte suspendu : relancer d'abord, panne si ça dure ; repris à temps, tout va bien.
  const coupe = creerControleDeVie(3);
  assert.equal(coupe.juger({ ...ok, blocs: 12, contexte: 'interrupted' }), 'relancer');
  assert.equal(coupe.juger({ ...ok, blocs: 24 }), 'ok');
  // Traitement arrêté (les blocs n'avancent plus).
  const arrete = creerControleDeVie(2);
  arrete.juger({ ...ok, blocs: 5 });
  assert.equal(arrete.juger({ ...ok, blocs: 5 }), 'relancer');
  assert.equal(arrete.juger({ ...ok, blocs: 5 }), 'panne');
  // La piste du micro finie : panne aussitôt.
  assert.equal(creerControleDeVie().juger({ ...ok, blocs: 1, pisteFinie: true }), 'panne');
});
