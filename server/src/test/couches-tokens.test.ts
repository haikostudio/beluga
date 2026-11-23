import test from 'node:test';
import assert from 'node:assert/strict';
import {
  jetonsApproches,
  jetonsMessageEnvoye,
  SIGNES_PAR_JETON,
  RAISON_ARBRE,
} from '@beluga/shared';

/*
 * L'ESTIMATION MAISON SUIT LA MESURE, PAS UN CHIFFRE ROND. Elle comptait quatre
 * signes par jeton — vrai d'un texte anglais ordinaire, faux de cette
 * documentation. Mesuré le 17/08/2026 sur `CLAUDE.md` par deux tours réels du
 * moteur : 158 743 signes pour 73 423 jetons, soit 2,16 signes par jeton. Le
 * compteur sous-évaluait donc de 45 %.
 */
test('l’estimation maison suit le rapport MESURÉ, pas quatre signes par jeton', () => {
  assert.equal(SIGNES_PAR_JETON, 2.2);
  assert.equal(jetonsApproches(2_200), 1_000);
  assert.equal(jetonsApproches(0), 0);
  assert.equal(jetonsApproches(-10), 0);
  // Le fichier d'instructions mesuré : l'estimation tombe à 5 % près du réel.
  const ecart = Math.abs(jetonsApproches(158_743) - 73_423) / 73_423;
  assert.ok(ecart < 0.05, `écart de ${Math.round(ecart * 100)} % avec la mesure`);
});

/*
 * LE COMPTEUR SOUS LA BULLE D'UN MESSAGE UTILISATEUR NE CUMULE PLUS LE TOUR
 * AGENTIQUE QUI SUIT. Un message de quelques phrases qui déclenche de
 * nombreux allers-retours d'outils affichait le total FRAIS de tout le tour
 * (des dizaines de milliers de jetons) — `jetonsMessageEnvoye` ne compte plus
 * que ce qui a été assemblé pour CE message : le prompt et les blocs non mis
 * en cache, indépendamment de ce que le moteur a fait ensuite.
 */
test('le poids d’un message écarte ce qui est rejoué depuis le cache', () => {
  const contexte = {
    prompt: 'Corrige ce bug.',
    blocks: [
      { kind: 'memory' as const, label: 'Index de la mémoire', characters: 4_000 },
      { kind: 'system' as const, label: 'Consigne système complète', characters: 20_000, cached: true },
    ],
  };
  assert.equal(jetonsMessageEnvoye(contexte), jetonsApproches('Corrige ce bug.'.length + 4_000));
});

test('le poids d’un message ne dépend jamais de ce que le tour a coûté après coup', () => {
  const contexteCourt = { prompt: 'Ok, merci.', blocks: [] };
  // Même si le tour qui a suivi a enchaîné des dizaines d'appels d'outils
  // (donc un `usage.inputTokens` de plusieurs dizaines de milliers), le poids
  // du message reste celui de ce qui a été envoyé pour LE DÉCLENCHER.
  assert.ok(jetonsMessageEnvoye(contexteCourt) < 100);
});

test('la raison qui remplace les passages dit la base de connaissances, pas une panne', () => {
  // Seul l'accueil borné part d'office : la bulle doit dire que c'est un CHOIX —
  // la tête, les P0/P1, le changelog récent, et l'agent ouvre le reste.
  assert.match(RAISON_ARBRE, /BASE DE CONNAISSANCES/);
  assert.match(RAISON_ARBRE, /« memoire »/);
});
