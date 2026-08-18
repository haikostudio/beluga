import test from 'node:test';
import assert from 'node:assert/strict';
import {
  coucheDAnalyse,
  coucheDExecution,
  ecartProjete,
  jetonsApproches,
  SIGNES_PAR_JETON,
  montantEnFrancs,
  projectionDeLExecution,
  raisonAbsenceDePassages,
  repartitionMemoireEnvoi,
  type TourMesureAgent,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* LES TOKENS RANGÉS PAR COUCHE                                         */
/*                                                                      */
/* Le tiroir « Contexte envoyé » lit d'abord l'ESTIMÉ, puis le RÉEL —   */
/* et le réel se lit couche par couche : la réflexion du chef d'un      */
/* côté, l'exécution de l'autre. Ce qui n'a pas été mesuré reste        */
/* indisponible : jamais un zéro consolant, jamais un total partiel.    */
/* ------------------------------------------------------------------ */

const tour = (model: string | undefined, entree: number, cache: number, sortie: number): TourMesureAgent => ({
  at: 1,
  model,
  inputTokens: entree,
  cachedTokens: cache,
  outputTokens: sortie,
  tokens: entree + cache + sortie,
  seconds: 10,
});

test('la couche d’analyse reprend la mesure du chiffrage, sans coût inventé', () => {
  const couche = coucheDAnalyse({
    inputTokens: 12_000,
    cachedInputTokens: 8_000,
    outputTokens: 1_500,
    totalTokens: 21_500,
    breakdown: {
      haikoDevInstructions: { status: 'measured', characters: 10, note: '' },
      cardDescription: { status: 'measured', characters: 10, note: '' },
      memoryAndInstructions: { status: 'measured', characters: 10, note: '' },
      agentReads: { status: 'unavailable', note: 'non isolable' },
    },
    measuredAt: 1,
  });
  assert.ok(couche);
  assert.equal(couche.cle, 'analyse');
  assert.equal(couche.entree, 12_000);
  assert.equal(couche.cache, 8_000);
  assert.equal(couche.sortie, 1_500);
  assert.equal(couche.total, 21_500);
  // La mesure du chiffrage ne porte pas le modèle employé : aucun coût.
  assert.equal(couche.cout, undefined);
  assert.equal(montantEnFrancs(couche.cout), 'indisponible');
});

test('un cache non communiqué laisse le total indisponible, jamais partiel', () => {
  const couche = coucheDAnalyse({
    inputTokens: 12_000,
    outputTokens: 1_500,
    breakdown: {
      haikoDevInstructions: { status: 'unavailable', note: '' },
      cardDescription: { status: 'unavailable', note: '' },
      memoryAndInstructions: { status: 'unavailable', note: '' },
      agentReads: { status: 'unavailable', note: '' },
    },
    measuredAt: 1,
  });
  assert.equal(couche?.cache, undefined);
  assert.equal(couche?.total, undefined);
});

test('sans chiffrage, aucune couche d’analyse', () => {
  assert.equal(coucheDAnalyse(undefined), undefined);
});

test('la couche d’exécution additionne les tours mesurés et les compte', () => {
  const couche = coucheDExecution([
    tour('claude-sonnet-5', 10_000, 1_000, 900),
    tour('claude-sonnet-5', 20_000, 5_000, 2_000),
  ]);
  assert.ok(couche);
  assert.equal(couche.tours, 2);
  assert.equal(couche.entree, 30_000);
  assert.equal(couche.cache, 6_000);
  assert.equal(couche.sortie, 2_900);
  assert.equal(couche.total, 38_900);
  assert.ok(couche.cout !== undefined && couche.cout > 0);
});

test('un seul tarif inconnu suffit à rendre le coût de la couche indisponible', () => {
  const couche = coucheDExecution([
    tour('claude-sonnet-5', 10_000, 1_000, 900),
    tour('gpt-5.4', 7_000, 0, 500),
  ]);
  // Les jetons, eux, restent additionnés : c'est le COÛT qui manque.
  assert.equal(couche?.total, 19_400);
  assert.equal(couche?.cout, undefined);
});

test('un tour écrit sans mesure ne compte pas comme un tour', () => {
  const couche = coucheDExecution([tour('claude-sonnet-5', 0, 0, 0), tour('claude-sonnet-5', 100, 0, 10)]);
  assert.equal(couche?.tours, 1);
  assert.equal(couche?.total, 110);
  assert.equal(coucheDExecution([tour('claude-sonnet-5', 0, 0, 0)]), undefined);
  assert.equal(coucheDExecution([]), undefined);
});

test('la couche d’exécution porte le nom du rôle qui l’a portée', () => {
  assert.equal(coucheDExecution([tour('claude-opus-5', 5, 0, 5)])?.nom, 'Exécution de la tâche');
  assert.equal(
    coucheDExecution([tour('claude-opus-5', 5, 0, 5)], 'Échange avec le chef d’orchestre')?.nom,
    'Échange avec le chef d’orchestre',
  );
});

test('la projection se relit sous la même forme, ancienne ou récente', () => {
  assert.equal(projectionDeLExecution(undefined), undefined);
  assert.equal(projectionDeLExecution({ failed: false }), undefined);
  // Chiffrage ancien : deux nombres à plat, aucune formule.
  assert.deepEqual(projectionDeLExecution({ failed: false, tokens: 900, quotaShare: 0.02 }), {
    tokens: 900,
    quotaShare: 0.02,
    assumptions: [],
  });
  // Chiffrage récent : la projection rédigée gagne.
  assert.deepEqual(
    projectionDeLExecution({
      failed: false,
      tokens: 900,
      projection: { tokens: 1_200, formula: '3 tours × 400', assumptions: ['trois tours'] },
    }),
    { tokens: 1_200, formula: '3 tours × 400', assumptions: ['trois tours'] },
  );
});

test('l’écart au projeté ne se calcule que sur deux nombres réels', () => {
  assert.equal(ecartProjete(1_000, 1_500), 0.5);
  assert.equal(ecartProjete(1_000, 500), -0.5);
  assert.equal(ecartProjete(undefined, 500), undefined);
  assert.equal(ecartProjete(1_000, undefined), undefined);
  assert.equal(ecartProjete(0, 500), undefined);
});

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

test('la répartition mémoire / envoi ne compte que les blocs de mémoire', () => {
  const blocks = [
    { kind: 'briefing' as const, label: 'Briefing du projet', characters: 800 },
    { kind: 'memory' as const, label: 'Index de la mémoire du projet', characters: 4_000 },
    { kind: 'request' as const, label: 'Demande utilisateur', characters: 200 },
  ];
  const repartition = repartitionMemoireEnvoi(blocks, { inputTokens: 3_000, cachedInputTokens: 1_000 });
  assert.equal(repartition.memoireTokens, jetonsApproches(4_000)); // les seuls blocs de mémoire
  assert.equal(repartition.envoyeTokens, 4_000);
  assert.equal(repartition.part, repartition.memoireTokens / 4_000);
});

test('sans mesure d’envoi, la part reste indéfinie — jamais une division par zéro déguisée', () => {
  const blocks = [{ kind: 'memory' as const, label: 'Nouveaux faits de la mémoire', characters: 400 }];
  const repartition = repartitionMemoireEnvoi(blocks);
  assert.equal(repartition.memoireTokens, jetonsApproches(400));
  assert.equal(repartition.envoyeTokens, undefined);
  assert.equal(repartition.part, undefined);
});

test('aucun bloc de mémoire : la part mémoire est à zéro, pas indisponible', () => {
  const blocks = [{ kind: 'request' as const, label: 'Demande utilisateur', characters: 200 }];
  assert.equal(repartitionMemoireEnvoi(blocks).memoireTokens, 0);
});

test('sans passage, la raison dit la reprise de session en premier', () => {
  assert.match(
    raisonAbsenceDePassages({ nouvelleSession: false, accueilEmporteLaMemoire: true }),
    /Reprise de session/,
  );
  // Même sans mémoire à l'accueil, une reprise reste une reprise : la raison
  // la plus parlante l'emporte.
  assert.match(
    raisonAbsenceDePassages({ nouvelleSession: false, accueilEmporteLaMemoire: false }),
    /Reprise de session/,
  );
});

test('session neuve sans mémoire à l’accueil (tri du chef, dépannage) : la raison le dit', () => {
  assert.match(
    raisonAbsenceDePassages({ nouvelleSession: true, accueilEmporteLaMemoire: false }),
    /n’emporte pas la mémoire/,
  );
});

test('session neuve, mémoire emportée, recherche vide : le repli sur l’index est dit', () => {
  assert.match(
    raisonAbsenceDePassages({ nouvelleSession: true, accueilEmporteLaMemoire: true }),
    /Repli sur l’index complet/,
  );
});
