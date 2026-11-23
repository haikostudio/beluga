/**
 * UNE SUITE D'ÉTAPES DANS LA VRAIE BASE : la validation pose le groupe, le
 * lancement de la carte globale ne lance que l'étape 1, chaque fin d'étape
 * lance la suivante depuis sa branche, les étapes finies restent groupées en
 * « En cours », et toutes passent ENSEMBLE en « À déployer » après la
 * dernière. Une étape bloquée arrête la suite.
 *
 * Le lanceur est un faux : il pose la carte en « En cours » comme le ferait
 * `lancerLaCarte`, sans copie de travail ni moteur. Le départ RÉEL est prouvé
 * par `scripts/verif-cycle-de-vie-carte.mjs`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Project, TaskProposal, type Agent } from '@beluga/shared';

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'suite-de-cartes-demon-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const { bus } = await import('../bus.js');
const { poserLaSuite } = await import('../suites-de-cartes.js');
const { lancerLaSuite, veillerSurLesMeres } = await import('../regroupements.js');
const { carteApresFinDeTour, rangerLesCartesOubliees } = await import('../deplacement-carte.js');

const projet = store.saveProject(
  Project.parse({ id: 'p-suite', name: 'Projet suite', path: bacASable, createdAt: 1, updatedAt: 1 }),
);

/** Les étapes lancées, dans l'ordre : le faux lanceur les note et les pose « En cours ». */
const lancees: string[] = [];
async function fauxLanceur(cardId: string) {
  lancees.push(cardId);
  const carte = store.getCard(cardId)!;
  // Comme `lancerLaCarte` : la carte entre en « En cours » AVEC sa marque de vol.
  const enCours = store.saveCard({
    ...carte,
    column: 'running',
    position: store.nextPosition(carte.projectId, 'running'),
    scheduling: { ...(carte.scheduling ?? { asap: false, attempts: 0, restarts: 0 }), tourEnVolDepuis: Date.now() },
  });
  bus.emit({ type: 'card.upsert', card: enCours });
  return { ok: true };
}
const arreter = veillerSurLesMeres(fauxLanceur);
test.after(() => arreter());

const agentDuChat = { id: 'chat', role: 'orchestrator', projectId: projet.id } as unknown as Agent;

const etape = (title: string) => ({ title, description: `Faire ${title}.`, briefing: `Synthèse de ${title}.`, labels: [] });
const proposition = TaskProposal.parse({
  id: 'prop-1',
  title: 'Refonte en trois temps',
  description: 'Trois étapes ordonnées.',
  briefing: 'La synthèse de la suite.',
  etapes: [etape('Modèle'), etape('Écran'), etape('Contrôles')],
});

/** Une fin de tour réussie, avec du code : la carte irait en « À déployer ». */
function finirLEtape(cardId: string) {
  const carte = store.getCard(cardId)!;
  const finie = store.saveCard(
    carteApresFinDeTour(carte, { agentId: 'a', role: 'task', reussi: true, trace: 'modifie' as never, moteurMuet: false }),
  );
  bus.emit({ type: 'card.upsert', card: finie });
  return finie;
}

const attendre = () => new Promise((resolve) => setTimeout(resolve, 5));

test('la validation pose une carte globale et trois étapes groupées dans « Planifié », sans rien lancer', () => {
  const tete = poserLaSuite({
    projectId: projet.id,
    proposal: proposition,
    retenu: { title: proposition.title, description: proposition.description, labels: [] },
    agent: agentDuChat,
    origineAt: 1,
  });
  assert.equal(tete.teteDeSuite, true);
  assert.equal(tete.excludedFromDeploy, true);
  assert.equal(tete.column, 'planned');
  assert.equal(tete.cartesFilles?.length, 3);
  const filles = tete.cartesFilles!.map((f) => store.getCard(f.cardId)!);
  assert.deepEqual(filles.map((f) => f.rangDansLaSuite), [1, 2, 3]);
  assert.ok(filles.every((f) => f.column === 'planned' && f.carteMereId === tete.id));
  assert.ok(filles.every((f) => f.parcours?.comprehensionValidee), 'chaque étape naît cadrée');
  assert.match(filles[1].briefing ?? '', /ÉTAPE 2 SUR 3/);
  assert.equal(tete.suiviDesFilles?.length, 3, 'la carte globale montre ses étapes dès sa naissance');
  assert.deepEqual(lancees, [], 'rien ne part avant le lancement');
  // Les étapes ne comptent dans aucune colonne du tableau, mais voyagent avec leur carte globale (la pile les déplie).
  const tranche = store.premiereTrancheDeCartes(projet.id);
  assert.deepEqual(tranche.cards.map((c) => c.id).sort(), [tete.id, ...filles.map((f) => f.id)].sort());
  assert.equal(tranche.totaux.planned, 1);
  const suivante = store.trancheDeCartes(projet.id, 'planned', undefined);
  assert.equal(suivante.total, 1);
  assert.equal(suivante.cards.length, 4);
});

test('le lancement ne part que sur l’étape 1, puis chaque fin d’étape lance la suivante depuis sa branche', async () => {
  const tete = store.listCards(projet.id).find((c) => c.teteDeSuite)!;
  const [e1, e2, e3] = tete.cartesFilles!.map((f) => f.cardId);
  await lancerLaSuite(tete, fauxLanceur);
  await attendre();
  assert.equal(store.getCard(tete.id)!.column, 'running');
  assert.deepEqual(lancees, [e1]);

  // Des mouvements répétés de l'étape au travail ne relancent rien.
  bus.emit({ type: 'card.upsert', card: store.getCard(e1)! });
  bus.emit({ type: 'card.upsert', card: store.getCard(e1)! });
  await attendre();
  assert.deepEqual(lancees, [e1], 'jamais deux étapes au travail');

  const finie = finirLEtape(e1);
  await attendre();
  assert.equal(finie.column, 'running', 'l’étape finie reste dans le groupe');
  assert.ok(finie.etapeFinieAt);
  assert.deepEqual(lancees, [e1, e2]);
  assert.equal(store.getCard(e2)!.brancheDeDepart?.startsWith('tache/'), true, 'l’étape 2 part de la branche de l’étape 1');

  // Le balayage des cartes oubliées ne range pas une étape qui attend ses sœurs.
  rangerLesCartesOubliees();
  assert.equal(store.getCard(e1)!.column, 'running');

  finirLEtape(e2);
  await attendre();
  assert.deepEqual(lancees, [e1, e2, e3]);
  assert.ok(
    [e1, e2].every((id) => store.getCard(id)!.column === 'running'),
    'rien en « À déployer » avant la dernière étape',
  );
  assert.equal(store.getCard(tete.id)!.column, 'running');

  finirLEtape(e3);
  await attendre();
  assert.ok(
    [e1, e2, e3].every((id) => store.getCard(id)!.column === 'to_deploy'),
    'toute la suite passe ensemble en « À déployer »',
  );
  const rendue = store.getCard(tete.id)!;
  assert.equal(rendue.column, 'to_deploy');
  assert.equal(rendue.excludedFromDeploy, true, 'la carte globale ne publie rien');
  assert.ok(rendue.suiviDesFilles?.every((f) => f.etat === 'fait'));

  // Mises en ligne puis archivées, les étapes emportent la carte globale.
  for (const id of [e1, e2, e3]) {
    const archivee = store.saveCard({ ...store.getCard(id)!, column: 'archived' });
    bus.emit({ type: 'card.upsert', card: archivee });
  }
  await attendre();
  assert.equal(store.getCard(tete.id)!.column, 'archived');
});

test('une étape bloquée arrête la suite, et l’enchaînement reprend quand elle finit', async () => {
  lancees.length = 0;
  const tete = poserLaSuite({
    projectId: projet.id,
    proposal: TaskProposal.parse({ ...proposition, id: 'prop-2', etapes: [etape('Un'), etape('Deux')] }),
    retenu: { title: 'Deux temps', description: 'Deux étapes.', labels: [] },
    agent: agentDuChat,
    origineAt: 2,
  });
  const [e1, e2] = tete.cartesFilles!.map((f) => f.cardId);
  await lancerLaSuite(tete, fauxLanceur);
  await attendre();
  assert.deepEqual(lancees, [e1]);

  // L'étape 1 rend un tour en échec : elle reste « En cours », la suivante ne part pas.
  const carte = store.getCard(e1)!;
  const tombee = store.saveCard(
    carteApresFinDeTour(carte, { agentId: 'a', role: 'task', reussi: false, trace: 'modifie' as never, moteurMuet: false }),
  );
  bus.emit({ type: 'card.upsert', card: tombee });
  await attendre();
  assert.equal(store.getCard(e1)!.column, 'running');
  assert.equal(store.getCard(e1)!.etapeFinieAt, undefined);
  assert.deepEqual(lancees, [e1], 'rien ne part après une étape bloquée');

  // Reprise, puis fin réussie : la suite repart seule.
  finirLEtape(e1);
  await attendre();
  assert.deepEqual(lancees, [e1, e2]);
});

/* ------------------------------------------------------------------ */
/* L'outil : une suite se propose en UN appel, chaque étape jugée       */
/* ------------------------------------------------------------------ */

const { callTool } = await import('../tools.js');

const SYNTHESE_DE_SUITE = [
  "L'utilisateur veut refaire l'écran de facturation en trois temps, parce que chaque partie a besoin de la précédente.",
  'Il a précisé que le modèle des données doit être posé avant l’écran, et les contrôles écrits en dernier.',
  "Il ne veut toucher à rien d'autre : ni à la publication, ni aux autres écrans du projet.",
  'Il validera la suite d’un clic, puis lancera la carte globale quand il le souhaitera.',
].join('\n');
const courte = (sujet: string) =>
  `${sujet} : la facturation doit être refaite dans l’ordre, et cette partie prépare la suivante sans empiéter sur elle.`;

test('board_create_card : une suite se propose en un seul bloc, chaque étape jugée comme une carte', async () => {
  const autre = store.saveProject(
    Project.parse({ id: 'p-outil', name: 'Projet outil', path: bacASable, createdAt: 1, updatedAt: 1 }),
  );
  const ctx = { projectId: autre.id, role: 'cadrage' } as never;
  const appel = {
    title: 'Refaire la facturation',
    description: courte('Refaire la facturation en trois étapes'),
    contexte: SYNTHESE_DE_SUITE,
    niveau: 'standard',
    etapes: [
      { title: 'Poser le modèle', description: courte('Poser le modèle'), contexte: SYNTHESE_DE_SUITE, niveau: 'standard' },
      { title: 'Refaire l’écran', description: courte('Refaire l’écran'), contexte: SYNTHESE_DE_SUITE, niveau: 'standard' },
    ],
  };
  const resultat = await callTool(ctx, 'board_create_card', appel);
  assert.equal(resultat.ok, true, resultat.text);
  assert.deepEqual(resultat.proposal?.etapes?.map((e: { title: string }) => e.title), ['Poser le modèle', 'Refaire l’écran']);
  assert.match(resultat.text, /2 étapes/);

  // Une étape bâclée refuse TOUTE la suite, et dit laquelle.
  const bacle = await callTool(ctx, 'board_create_card', {
    ...appel,
    etapes: [appel.etapes[0], { title: 'Refaire l’écran', description: 'À faire.', contexte: SYNTHESE_DE_SUITE }],
  });
  assert.equal(bacle.ok, false);
  assert.equal(bacle.proposal, undefined);
  assert.match(bacle.text, /^Étape 2 :/);

  // Une seule étape n'est pas une suite.
  const seule = await callTool(ctx, 'board_create_card', { ...appel, etapes: [appel.etapes[0]] });
  assert.equal(seule.ok, false);
  assert.match(seule.text, /de 2 à 8 étapes/);
});
