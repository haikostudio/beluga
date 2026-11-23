import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  Card,
  PLAFOND_LANCEMENT_EN_ROUTE_MS,
  Project,
  RAISON_LANCEMENT_PENDANT_UNE_PUBLICATION,
  carteLibreDePartirSeule,
  raisonLancementEnPreparation,
  raisonLotBloque,
} from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* UNE CARTE QUI DÉMARRE ET UNE MISE EN LIGNE NE SE CROISENT PLUS      */
/*                                                                     */
/* Les deux touchent le même dépôt : la mise en ligne y fusionne le    */
/* lot, le lancement y ouvre une copie de travail. Chacun attend       */
/* l'autre — la mise en ligne REFUSE en nommant la carte qui démarre,  */
/* le lancement ATTEND et repart seul.                                 */
/* ------------------------------------------------------------------ */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'lancement-et-mise-en-ligne-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const registre = await import('../lancements-en-route.js');
const deploy = await import('../deploy.js');
const scheduler = await import('../scheduler.js');

const PROJET = 'projet-essai';

function poserProjet(id = PROJET): void {
  store.saveProject(
    Project.parse({ id, name: `Projet ${id}`, path: bacASable, deploiement: { herite: true }, createdAt: Date.now(), updatedAt: Date.now() }),
  );
}

function poserCarte(id: string, patch: Partial<Card> = {}, projectId = PROJET): Card {
  const maintenant = Date.now();
  return store.saveCard(
    Card.parse({
      id,
      projectId,
      title: `Carte ${id}`,
      column: 'planned',
      position: 1,
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      scheduling: { asap: false, attempts: 0, restarts: 0 },
      createdAt: maintenant,
      updatedAt: maintenant,
      ...patch,
    }),
  );
}

poserProjet();

/* ------------------------------------------------------------------ */
/* La mise en ligne refuse tant qu'un lancement se prépare             */
/* ------------------------------------------------------------------ */

test('un lancement en préparation compte parmi les occupés du projet, sous le titre de sa carte', () => {
  poserCarte('c-prepare');
  assert.equal(deploy.agentsOccupes(PROJET).length, 0);

  registre.marquerLancementEnRoute('c-prepare', PROJET);
  const occupes = deploy.agentsOccupes(PROJET);
  assert.equal(occupes.length, 1);
  assert.equal(occupes[0].title, 'Carte c-prepare');
  assert.equal(occupes[0].enPreparation, true);

  registre.oublierLancementEnRoute('c-prepare');
  assert.equal(deploy.agentsOccupes(PROJET).length, 0, 'la fin du lancement lève le refus');
});

test('un lancement d’un AUTRE projet ne retient pas celui-ci', () => {
  poserCarte('c-ailleurs');
  registre.marquerLancementEnRoute('c-ailleurs', 'un-autre-projet');
  assert.equal(registre.lancementsEnRouteDuProjet(PROJET).length, 0);
  assert.deepEqual(registre.lancementsEnRouteDuProjet('un-autre-projet'), ['c-ailleurs']);
  registre.oublierLancementEnRoute('c-ailleurs');
});

test('un lancement PENDU passé son plafond ne retient plus la mise en ligne', () => {
  poserCarte('c-pendue');
  const reel = Date.now;
  registre.marquerLancementEnRoute('c-pendue', PROJET);
  assert.equal(deploy.agentsOccupes(PROJET).length, 1);
  try {
    const depart = reel();
    Date.now = () => depart + PLAFOND_LANCEMENT_EN_ROUTE_MS + 1000;
    assert.equal(registre.lancementsEnRouteDuProjet(PROJET).length, 0);
    assert.equal(deploy.agentsOccupes(PROJET).length, 0, 'pas de blocage en cascade');
  } finally {
    Date.now = reel;
    registre.oublierLancementEnRoute('c-pendue');
  }
});

test('startDeploy refuse en nommant la carte qui démarre', async () => {
  poserCarte('c-demarre', { title: 'Ma carte qui démarre' });
  registre.marquerLancementEnRoute('c-demarre', PROJET);
  try {
    const issue = await deploy.startDeploy(PROJET);
    assert.equal(issue.ok, false);
    assert.equal(issue.error, raisonLancementEnPreparation(['Ma carte qui démarre']));
    assert.match(issue.error ?? '', /« Ma carte qui démarre » démarre/);
    assert.ok(!store.latestDeploy(PROJET), 'aucune publication n’a été ouverte');
  } finally {
    registre.oublierLancementEnRoute('c-demarre');
  }
});

test('la règle pure : le bouton s’éteint avec la même phrase que le démon', () => {
  const etat = { verbe: 'déployer', aPublier: 2, cartesDansLaColonne: 2 };
  assert.equal(raisonLotBloque(etat), null);
  assert.equal(
    raisonLotBloque({ ...etat, lancementsEnPreparation: ['A', 'B'] }),
    raisonLancementEnPreparation(['A', 'B']),
  );
  assert.match(raisonLancementEnPreparation(['A', 'B']), /« A », « B » démarrent/);
  // Un agent au travail garde la priorité sur une carte qui démarre : on lève le plus fort d'abord.
  assert.match(
    raisonLotBloque({ ...etat, agentsOccupes: ['X'], lancementsEnPreparation: ['A'] }) ?? '',
    /« X » travaille encore/,
  );
});

/* ------------------------------------------------------------------ */
/* Le lancement attend la fin de la mise en ligne, et repart seul      */
/* ------------------------------------------------------------------ */

test('startCard pendant une mise en ligne : la carte ne bouge pas, dit pourquoi et repartira seule', async () => {
  poserCarte('c-attend');
  deploy.publicationsActivesPourEssai.set(PROJET, { controleur: new AbortController() });
  try {
    assert.equal(deploy.publicationEnCours(PROJET), true);
    const issue = await scheduler.startCard('c-attend');
    assert.equal(issue.ok, false);
    assert.equal(issue.error, RAISON_LANCEMENT_PENDANT_UNE_PUBLICATION);

    const carte = store.getCard('c-attend')!;
    assert.equal(carte.column, 'planned', 'aucun déplacement vers « En cours »');
    assert.equal(carte.scheduling?.tourEnVolDepuis, undefined, 'aucune marque de vol');
    assert.equal(carte.scheduling?.waitingReason, RAISON_LANCEMENT_PENDANT_UNE_PUBLICATION);
    assert.equal(carte.scheduling?.reprendreDesQuePossible, true, 'le geste n’est pas perdu');
    assert.equal(registre.lancementEnRoute('c-attend'), false, 'aucun lancement n’a été engagé');
    assert.equal(carte.agentId, undefined);

    // La porte dure dit la même chose, et se rouvre seule : le même refus vaut
    // pour la boucle de l'ordonnanceur et pour le dépôt dans « En cours ».
    const porte = await scheduler.portesDures(carte);
    assert.equal(porte.ok, false);
    assert.equal(porte.reprisePossible, true);
    assert.equal(porte.reason, RAISON_LANCEMENT_PENDANT_UNE_PUBLICATION);
  } finally {
    deploy.publicationsActivesPourEssai.delete(PROJET);
  }

  // La mise en ligne est finie (réussie, tombée ou arrêtée : dans les trois cas
  // `active` est vidé dans le `finally` de la publication) : la boucle reprend.
  assert.equal(deploy.publicationEnCours(PROJET), false);
  const carte = store.getCard('c-attend')!;
  assert.equal(carteLibreDePartirSeule(carte, false), true, 'l’ordonnanceur la rejoue sans second clic');
});

test('une carte « dès que possible » ou datée attend elle aussi, et garde son heure', async () => {
  poserCarte('c-asap', { scheduling: { asap: true, attempts: 0, restarts: 0 } });
  poserCarte('c-datee', { scheduling: { asap: false, attempts: 0, restarts: 0, departPrevu: Date.now() - 1000 } });
  deploy.publicationsActivesPourEssai.set(PROJET, { controleur: new AbortController() });
  try {
    for (const id of ['c-asap', 'c-datee']) {
      const carte = store.getCard(id)!;
      const porte = await scheduler.checkGates(carte);
      assert.equal(porte.ok, false, `${id} patiente pendant la mise en ligne`);
      assert.equal(porte.reason, RAISON_LANCEMENT_PENDANT_UNE_PUBLICATION);
    }
  } finally {
    deploy.publicationsActivesPourEssai.delete(PROJET);
  }
  for (const id of ['c-asap', 'c-datee']) {
    assert.equal(carteLibreDePartirSeule(store.getCard(id)!, false), true, `${id} n’a pas raté son heure`);
  }
});

test('une mise en ligne d’un AUTRE projet ne retient pas ce lancement', async () => {
  poserProjet('autre');
  poserCarte('c-libre');
  deploy.publicationsActivesPourEssai.set('autre', { controleur: new AbortController() });
  try {
    assert.equal(deploy.publicationEnCours(PROJET), false);
    const porte = await scheduler.portesDures(store.getCard('c-libre')!);
    assert.notEqual(porte.reason, RAISON_LANCEMENT_PENDANT_UNE_PUBLICATION);
  } finally {
    deploy.publicationsActivesPourEssai.delete('autre');
  }
});

test('le test de la publication et la pose de la marque se suivent sans attente', () => {
  const source = fs.readFileSync(path.resolve(import.meta.dirname, '../../src/scheduler.ts'), 'utf8');
  const corps = source.split('export async function startCard(')[1].split('\n}')[0];
  const test_ = corps.indexOf('publicationEnCours(');
  const marque = corps.indexOf('marquerLancementEnRoute(cardId, carte?.projectId)');
  assert.ok(test_ > 0 && marque > test_, 'le test précède la marque');
  assert.doesNotMatch(corps.slice(test_, marque), /await /, 'aucune attente entre les deux : la fenêtre est fermée');
});
