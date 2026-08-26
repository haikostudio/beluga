import test from 'node:test';
import assert from 'node:assert/strict';
import { dureeDite, phraseDuTravailRestant, travailRestant } from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Si elle est encore en cours, qu'elle dise ce qui tourne              */
/* ------------------------------------------------------------------ */

const MAINTENANT = 1_700_000_000_000;
const MINUTE = 60_000;

/** Une carte en cours, avec un agent au travail depuis quatre minutes. */
const AU_TRAVAIL = {
  colonne: 'running',
  agentActif: {
    etapeEnCours: 'Analyse des fichiers',
    startedAt: MAINTENANT - 4 * MINUTE,
    todos: { done: 3, total: 5 },
  },
};

/* -------- Une carte hors « En cours » n'a rien à dire -------- */

test('hors « En cours », la colonne dit déjà où en est la carte', () => {
  for (const colonne of ['notes', 'planned', 'done', 'to_deploy', 'archived']) {
    assert.equal(travailRestant({ ...AU_TRAVAIL, colonne }, MAINTENANT), null, `depuis « ${colonne} »`);
  }
});

/* -------- Un agent travaille -------- */

test('un agent au travail dit son étape, depuis quand, et ce qui reste', () => {
  const restant = travailRestant(AU_TRAVAIL, MAINTENANT);
  assert.equal(restant?.nature, 'travaille');
  assert.equal(restant?.etape, 'Analyse des fichiers');
  assert.equal(restant?.depuis, 'depuis 4 min');
  assert.equal(restant?.attente, 'il reste 2 étapes sur 5');
});

test('sans étape nommée, la carte ne reste pas muette', () => {
  const restant = travailRestant({ colonne: 'running', agentActif: { startedAt: MAINTENANT - MINUTE } }, MAINTENANT);
  assert.equal(restant?.nature, 'travaille');
  assert.ok(restant?.etape, 'une étape est toujours écrite');
  assert.equal(restant?.attente, 'la fin du tour');
});

test('une liste de tâches TOUTE cochée n’annonce plus d’étape restante', () => {
  const restant = travailRestant(
    { colonne: 'running', agentActif: { startedAt: MAINTENANT, todos: { done: 5, total: 5 } } },
    MAINTENANT,
  );
  assert.equal(restant?.attente, 'la fin du tour');
});

/* -------- Une question attend : c'est VOUS qu'on attend -------- */

test('une question arrêtée passe devant tout le reste', () => {
  const restant = travailRestant({ ...AU_TRAVAIL, agentActif: { ...AU_TRAVAIL.agentActif, attendReponse: true } }, MAINTENANT);
  assert.equal(restant?.nature, 'question');
  assert.match(restant!.attente, /votre réponse/);
});

test('une décision en attente compte même sans agent au travail', () => {
  const restant = travailRestant(
    { colonne: 'running', decisionEnAttente: true, finDuDernierTour: MAINTENANT - 2 * MINUTE },
    MAINTENANT,
  );
  assert.equal(restant?.nature, 'question');
  assert.equal(restant?.depuis, 'depuis 2 min');
});

/* -------- Un tour se range, ou plus personne ne travaille -------- */

test('un tour qui tient encore la carte se dit « en cours de rangement »', () => {
  const restant = travailRestant({ colonne: 'running', tourEnVolDepuis: MAINTENANT - 30_000 }, MAINTENANT);
  assert.equal(restant?.nature, 'rangement');
  assert.equal(restant?.depuis, 'depuis 30 s');
});

test('plus personne au travail : la carte le DIT au lieu de rester muette', () => {
  // Depuis la nouvelle règle, c'est une anomalie que le balayage corrige en
  // quinze secondes — mais elle ne doit jamais passer inaperçue.
  const restant = travailRestant({ colonne: 'running', finDuDernierTour: MAINTENANT - 3 * MINUTE }, MAINTENANT);
  assert.equal(restant?.nature, 'sans-agent');
  assert.match(restant!.attente, /rangement/);
});

test('une carte en cours a TOUJOURS quelque chose à dire', () => {
  // C'est l'exigence de fond : plus jamais une carte qui a l'air finie et qui
  // reste dans « En cours » sans un mot.
  for (const carte of [
    { colonne: 'running' },
    { colonne: 'running', agentActif: {} },
    { colonne: 'running', tourEnVolDepuis: MAINTENANT },
    { colonne: 'running', decisionEnAttente: true },
  ]) {
    const restant = travailRestant(carte, MAINTENANT);
    assert.ok(restant, JSON.stringify(carte));
    assert.ok(restant!.etape && restant!.attente, JSON.stringify(carte));
  }
});

/* -------- Les durées, telles qu'on les dit -------- */

test('une durée s’écrit comme on la dit, jamais en décimales', () => {
  assert.equal(dureeDite(0), '0 s');
  assert.equal(dureeDite(45_000), '45 s');
  assert.equal(dureeDite(12 * MINUTE), '12 min');
  assert.equal(dureeDite(3 * 60 * MINUTE + 5 * MINUTE), '3 h 05');
  assert.equal(dureeDite(50 * 60 * MINUTE), '2 jours');
  assert.equal(dureeDite(25 * 60 * MINUTE), '1 jour');
});

test('un instant de départ inconnu ne fabrique pas une durée', () => {
  const restant = travailRestant({ colonne: 'running', agentActif: { etapeEnCours: 'Lecture' } }, MAINTENANT);
  assert.equal(restant?.depuis, null);
});

/* -------- La phrase d'une ligne -------- */

test('la phrase colle les morceaux, et saute ceux qui manquent', () => {
  assert.equal(
    phraseDuTravailRestant(travailRestant(AU_TRAVAIL, MAINTENANT)!),
    'Analyse des fichiers · depuis 4 min · il reste 2 étapes sur 5',
  );
  const sansDepuis = phraseDuTravailRestant(
    travailRestant({ colonne: 'running', agentActif: { etapeEnCours: 'Lecture' } }, MAINTENANT)!,
  );
  assert.equal(sansDepuis, 'Lecture · la fin du tour');
  assert.doesNotMatch(sansDepuis, /depuis/);
});

/* ------------------------------------------------------------------ */
/* Elle ne se rangera pas toute seule, et elle le dit                   */
/* ------------------------------------------------------------------ */

/*
 * LE MENSONGE QU'ON RÉPARE : une carte arrêtée à la main, ou dont le tour a
 * échoué, RESTE dans « En cours » — c'est la règle, on doit pouvoir la relire
 * là où on la relance. Mais le balayage de l'ordonnanceur s'interdit alors d'y
 * toucher (`issueDeCarteOubliee`, refus « dernier tour en échec ») : la carte
 * promettait pourtant « le rangement automatique de la carte, sous quinze
 * secondes », et personne ne venait jamais.
 */

test('une carte arrêtée à la main ne promet plus de rangement automatique', () => {
  const restant = travailRestant(
    { colonne: 'running', suspendu: true, finDuDernierTour: MAINTENANT - 3 * MINUTE },
    MAINTENANT,
  );
  assert.equal(restant?.nature, 'relance');
  assert.equal(restant?.etape, 'Tâche arrêtée à la main');
  assert.equal(restant?.depuis, 'depuis 3 min');
  assert.match(restant?.attente ?? '', /votre relance/);
  assert.doesNotMatch(phraseDuTravailRestant(restant!), /quinze secondes/);
});

test('un tour tombé en échec dit qu’il attend une relance, pas un rangement', () => {
  const restant = travailRestant(
    { colonne: 'running', dernierTourEnEchec: true, finDuDernierTour: MAINTENANT - 2 * MINUTE },
    MAINTENANT,
  );
  assert.equal(restant?.nature, 'relance');
  assert.equal(restant?.etape, 'Le tour s’est arrêté sans aboutir');
  assert.match(restant?.attente ?? '', /rien ne repartira tout seul/);
});

test('la marque de vol d’un tour mort ne fait plus croire à un rangement en cours', () => {
  // Le tour a laissé sa marque, mais son agent s'est arrêté : il n'y a plus
  // aucun rangement en route, seulement une carte qui attend un geste.
  const restant = travailRestant(
    { colonne: 'running', dernierTourEnEchec: true, tourEnVolDepuis: MAINTENANT - 40 * MINUTE },
    MAINTENANT,
  );
  assert.equal(restant?.nature, 'relance');
  assert.equal(restant?.depuis, 'depuis 40 min');
});

test('un agent qui travaille passe devant les deux marques', () => {
  // Une marque laissée par le tour PRÉCÉDENT ne doit pas éteindre l'étape du
  // tour qui court : l'agent au travail est toujours la vérité la plus fraîche.
  const restant = travailRestant({ ...AU_TRAVAIL, suspendu: true, dernierTourEnEchec: true }, MAINTENANT);
  assert.equal(restant?.nature, 'travaille');
  assert.equal(restant?.etape, 'Analyse des fichiers');
});

test('une question attend toujours devant tout le reste', () => {
  const restant = travailRestant(
    { colonne: 'running', decisionEnAttente: true, dernierTourEnEchec: true },
    MAINTENANT,
  );
  assert.equal(restant?.nature, 'question');
});

test('sans marque d’arrêt, le rangement automatique reste annoncé', () => {
  // La règle d'origine ne bouge pas : une carte oubliée SANS échec est bien
  // rangée par le balayage, et continue donc de l'annoncer.
  const restant = travailRestant({ colonne: 'running', finDuDernierTour: MAINTENANT - MINUTE }, MAINTENANT);
  assert.equal(restant?.nature, 'sans-agent');
  assert.match(restant?.attente ?? '', /quinze secondes/);
});
