import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DELAI_JUGE_EXPRESS_MS,
  FICHES_DES_USAGES,
  PERTINENCE_MAX,
  REGLAGES_DES_USAGES,
  USAGES_JUGE,
  candidatsDeDoublon,
  clesPertinentes,
  indicationDeNature,
  niveauPropose,
  questionsDePertinence,
  texteDesCompetences,
  type Competence,
  type ReponseDuJuge,
} from '@beluga/shared';

/*
 * LES USAGES DU JUGE RAPIDE — leurs règles pures, sans réseau.
 *
 * Ce qui ne doit jamais changer par accident : un tri de pertinence qui ne
 * reçoit pas d'avis GARDE TOUT ; une indication question/travail se dit comme
 * une indication ; un niveau hors liste n'est pas proposé ; la présélection
 * des doublons ne compare jamais une carte archivée ni une carte sans mots
 * communs ; et les usages sans preuve chiffrée naissent éteints.
 */

const oui = (p: number): ReponseDuJuge => ({ type: 'noul', noul: p });

test('sans avis du juge, tous les documents sont gardés', () => {
  const docs = [
    { cle: 'a', texte: 'A' },
    { cle: 'b', texte: 'B' },
  ];
  assert.deepEqual([...clesPertinentes(docs, undefined)], ['a', 'b']);
});

test('seul un « non » franc écarte un document ; un document sans réponse reste', () => {
  const docs = [
    { cle: 'a', texte: 'A' },
    { cle: 'b', texte: 'B' },
    { cle: 'c', texte: 'C' },
  ];
  const gardees = clesPertinentes(docs, { d0: oui(0.9), d1: oui(0.1) });
  assert.deepEqual([...gardees], ['a', 'c'], '« c » n’a pas eu de réponse sûre : il reste');
});

test('au-delà du paquet jugé, les documents restent, et une question par document part', () => {
  const docs = Array.from({ length: PERTINENCE_MAX + 2 }, (_, i) => ({ cle: `k${i}`, texte: `doc ${i}` }));
  assert.equal(Object.keys(questionsDePertinence(docs)).length, PERTINENCE_MAX);
  const toutNon = Object.fromEntries(Array.from({ length: PERTINENCE_MAX }, (_, i) => [`d${i}`, oui(0.01)]));
  assert.deepEqual([...clesPertinentes(docs, toutNon)], [`k${PERTINENCE_MAX}`, `k${PERTINENCE_MAX + 1}`]);
});

test('l’indication question/travail se dit comme une indication, jamais comme un ordre', () => {
  const choix = (choice: string): ReponseDuJuge => ({ type: 'choice', choice, probabilities: {}, confidence: 0.8 });
  assert.match(indicationDeNature(choix('question')), /QUESTION.*La décision reste la tienne/s);
  assert.match(indicationDeNature(choix('travail')), /TRAVAIL.*La décision reste la tienne/s);
  assert.equal(indicationDeNature(choix('autre')), '');
  assert.equal(indicationDeNature(undefined), '');
});

test('un niveau hors liste n’est jamais proposé', () => {
  const choix = (choice: string): ReponseDuJuge => ({ type: 'choice', choice, probabilities: {}, confidence: 0.8 });
  assert.equal(niveauPropose(choix('standard')), 'standard');
  assert.equal(niveauPropose(choix('extreme')), undefined);
  assert.equal(niveauPropose(undefined), undefined);
});

test('la présélection des doublons ne garde que les cartes ouvertes qui partagent des mots', () => {
  const cartes = [
    { id: '1', title: 'Colonne de gauche : afficher la vraie favicon du projet', description: '', column: 'planned' },
    { id: '2', title: 'Colonne de gauche : afficher la vraie favicon du projet', description: '', column: 'archived' },
    { id: '3', title: 'Réduire les coûts GitHub', description: '', column: 'planned' },
  ];
  const retenues = candidatsDeDoublon({ titre: 'Colonne de gauche : faire apparaître la vraie favicon des projets', description: '' }, cartes);
  assert.deepEqual(
    retenues.map((c) => c.id),
    ['1'],
  );
  assert.deepEqual(candidatsDeDoublon({ titre: 'a b', description: '' }, cartes), [], 'aucun mot plein : rien à comparer');
});

test('chaque usage a son réglage, et les usages sans preuve naissent éteints', () => {
  for (const usage of USAGES_JUGE) assert.ok(REGLAGES_DES_USAGES[usage], `réglage de ${usage}`);
  const allumes = FICHES_DES_USAGES.filter((f) => f.parDefaut).map((f) => f.cle).sort();
  /* La pertinence des analyses Marketing naît allumée sur demande expresse de l'utilisateur (28/10/2026) :
     elle ne retire, ne réordonne ni ne chiffre rien, une mention sous le curseur et c'est tout. */
  assert.deepEqual(allumes, ['comprehension-carte', 'pertinence-analyses-marketing', 'tri-propositions']);
  for (const usage of ['nature-demande', 'pertinence-competences', 'pertinence-memoire'] as const) {
    assert.equal(REGLAGES_DES_USAGES[usage]?.delaiMs, DELAI_JUGE_EXPRESS_MS, `${usage} est sur le chemin d’un tour : délai court`);
  }
});

function fiche(nom: string, description: string): Competence {
  return { nom, description, symptomes: [], themes: ['divers'], etat: 'active' } as unknown as Competence;
}

test('les modes d’emploi jugés utiles remplacent le classement par les mots', () => {
  /* Des noms de la longueur des vrais : le tri n'est servi que s'il allège le texte. */
  const noms = [
    'compta',
    'silhouette-de-chargement-sans-saut',
    'voile-de-connexion-des-apps-temps-reel',
    'reprise-de-donnees-sans-doublons',
    'tracer-appels-outils-dans-le-tour',
    'demo-qui-embarque-la-vraie-application',
    'verifier-que-l-en-ligne-est-le-code-du-depot',
    'scripts-de-projet-lances-depuis-un-worktree',
  ];
  const liste = noms.map((nom) => fiche(nom, `Mode d'emploi ${nom} pour une carte de travail sur le tableau`));
  const trie = texteDesCompetences(liste, '/pool', 'carte de travail sur le tableau', new Set(['compta']));
  assert.match(trie, /Celles qui touchent le travail de ta carte :\n- divers \(1\) : compta/);
  const aucune = texteDesCompetences(liste, '/pool', 'carte de travail sur le tableau', new Set());
  assert.match(aucune, /Aucune ne touche le travail de ta carte/);
  const sansAvis = texteDesCompetences(liste, '/pool', 'carte de travail sur le tableau');
  assert.doesNotMatch(sansAvis, /Aucune ne touche/);
});
