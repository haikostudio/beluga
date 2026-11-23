import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Card, Project, curseurApres } from '@beluga/shared';

/*
 * LA PAGE « EN ROUTE » : le démon rend, en SQL et par paquets, EXACTEMENT
 * l'ordre que l'écran recalcule avec `comparerDerniereAction` — sinon une carte
 * changerait de place entre deux paquets, ou arriverait deux fois.
 */

/** L'ordre attendu, écrit à part de la règle du démon : dernière action, puis identifiant, du plus grand au plus petit. */
const parDerniereAction = (a: { id: string; updatedAt: number }, b: { id: string; updatedAt: number }) =>
  b.updatedAt - a.updatedAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'en-route-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const { getDb } = await import('../db.js');
const { rangerLaCarte } = await import('../deplacement-carte.js');

/** Pose la date de dernière action à la main : `saveCard` la met à l'instant présent. */
function derniereAction(card: Card, updatedAt: number): Card {
  getDb().prepare('UPDATE cards SET updated_at = ? WHERE id = ?').run(updatedAt, card.id);
  return store.getCard(card.id)!;
}

function projet(id: string, archived = false) {
  return store.saveProject(
    Project.parse({ id, name: id, path: path.join(bacASable, id), archived, createdAt: 1, updatedAt: 1 }),
  );
}

function carte(projectId: string, column: string, createdAt: number, renduA?: number) {
  const card = store.saveCard(
    Card.parse({
      id: store.newId(),
      projectId,
      title: `Carte ${projectId} ${column} ${createdAt}`,
      column,
      position: createdAt,
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      createdAt,
      updatedAt: createdAt,
      ...(renduA ? { renduA } : {}),
    }),
  );
  return derniereAction(card, createdAt);
}

projet('a');
projet('b');
projet('de-cote', true);
const attendues: Card[] = [];
for (let i = 1; i <= 25; i += 1) {
  // Des dernières actions en double, pour que l'identifiant départage aussi entre deux paquets.
  attendues.push(
    derniereAction(
      carte(i % 2 ? 'a' : 'b', ['planned', 'running'][i % 3 ? 1 : 0], 1_000 + i, i % 4 ? 5_000 + i : undefined),
      (i * 7_919) % 13 + 1_000,
    ),
  );
}
/** Rangée par l'utilisateur dans « Archiver » de la page, sans changer sa dernière action. */
function rangee(card: Card): Card {
  return derniereAction(store.saveCard({ ...card, rangeeTableauDeBordAt: 3_000 }), card.updatedAt);
}
// Jamais dans « Actifs » : une carte rangée (dans « Archiver »), une carte
// d'un projet mis de côté (nulle part).
const rangeeALaMain = rangee(carte('a', 'archived', 9_000, 99_999));
carte('de-cote', 'running', 9_000, 99_999);
// « Terminer » : le travail rendu qui attend sa publication.
const aPublier: Card[] = [];
for (let i = 1; i <= 7; i += 1) aPublier.push(derniereAction(carte(i % 2 ? 'a' : 'b', 'to_deploy', 1_100 + i), 1_050 + (i % 3)));
carte('de-cote', 'to_deploy', 9_100);

test('« Actifs » : tous projets en service, Demande et Travail, la dernière action d’abord, par paquets', () => {
  const premier = store.cartesEnRoute(undefined, 20);
  assert.equal(premier.cards.length, 20);
  assert.equal(premier.restant, 5);
  const second = store.cartesEnRoute(curseurApres(premier.cards[premier.cards.length - 1]), 20);
  assert.equal(second.cards.length, 5);
  assert.equal(second.restant, 0);
  const recues = [...premier.cards, ...second.cards].map((c) => c.id);
  assert.deepEqual(recues, [...attendues].sort(parDerniereAction).map((c) => c.id));
  assert.equal(new Set(recues).size, 25);
  const dates = [...premier.cards, ...second.cards].map((c) => c.updatedAt);
  assert.deepEqual(dates, [...dates].sort((x, y) => y - x), 'la dernière action d’abord');
});

test('les agents rendus sont ceux qui portent les cartes envoyées', () => {
  const [premiere] = store.cartesEnRoute(undefined, 1).cards;
  store.saveAgent({
    id: 'agent-au-travail',
    projectId: premiere.projectId,
    cardId: premiere.id,
    role: 'task',
    title: premiere.title,
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status: 'running',
    createdAt: 1,
    updatedAt: 1,
  } as any);
  assert.deepEqual(
    store.agentsDesCartes([premiere]).map((agent) => agent.id),
    ['agent-au-travail'],
  );
});

test('« Terminer » : ce qui est fini et pas rangé, dernière action d’abord, par paquets', () => {
  const premier = store.cartesEnRoute(undefined, 5, 'terminer');
  assert.equal(premier.cards.length, 5);
  assert.equal(premier.restant, 2);
  const second = store.cartesEnRoute(premier.curseur, 5, 'terminer');
  assert.equal(second.restant, 0);
  const recues = [...premier.cards, ...second.cards].map((c) => c.id);
  assert.deepEqual(recues, [...aPublier].sort(parDerniereAction).map((c) => c.id));
  const actives = new Set(store.cartesEnRoute(undefined, 200).cards.map((c) => c.id));
  assert.equal(aPublier.some((c) => actives.has(c.id)), false, '« À déployer » a quitté « Actifs »');
});

/* « ARCHIVER » : ce que l'utilisateur a rangé sur la page, mis en ligne ou non, dernière action d'abord. */

function deployee(projectId: string, deployedAt: number | undefined, updatedAt = 20_000) {
  const card = carte(projectId, 'archived', 2_000 + (deployedAt ?? 0));
  return derniereAction(
    store.saveCard({ ...card, archivedAt: 3_000, rangeeTableauDeBordAt: 3_000, ...(deployedAt ? { deployedAt } : {}) }),
    updatedAt,
  );
}

const enLigne: Card[] = [];
for (let i = 1; i <= 23; i += 1) {
  // Des dernières actions en double, et sans lien avec la date de mise en ligne.
  enLigne.push(deployee(i % 2 ? 'a' : 'b', 10_000 + i, 20_000 + Math.floor(((i * 5) % 23) / 2)));
}
// Une archivée à la main (sans date de mise en ligne) y paraît aussi ; une
// mise en ligne d'un projet mis de côté, jamais.
const abandonnee = deployee('a', undefined);
deployee('de-cote', 50_000);

test('« Archiver » : rangées par l’utilisateur, en ligne ou non, dernière action d’abord, par paquets', () => {
  const archivees = [...enLigne, abandonnee, rangeeALaMain];
  const premier = store.cartesEnRoute(undefined, 20, 'archive');
  assert.equal(premier.cards.length, 20);
  assert.equal(premier.restant, archivees.length - 20);
  const second = store.cartesEnRoute(curseurApres(premier.cards[premier.cards.length - 1]), 20, 'archive');
  assert.equal(second.cards.length, archivees.length - 20);
  assert.equal(second.restant, 0);
  const recues = [...premier.cards, ...second.cards].map((c) => c.id);
  assert.deepEqual(recues, [...archivees].sort(parDerniereAction).map((c) => c.id));
  assert.ok(recues.includes(abandonnee.id), 'une archivée sans date de mise en ligne y est');
});

test('« Actifs » et « Terminer » ne reçoivent aucune carte rangée par l’utilisateur', () => {
  for (const onglet of ['actif', 'terminer'] as const) {
    const recues = store.cartesEnRoute(undefined, 200, onglet).cards;
    assert.equal(recues.some((c) => !!c.rangeeTableauDeBordAt), false, onglet);
  }
  assert.equal(store.cartesEnRoute(undefined, 200, 'actif').cards.some((c) => c.column === 'archived'), false);
});

/* LA DERNIÈRE ACTION : lire une carte n'en est pas une, un message envoyé si. */

test('ouvrir une carte ne la fait pas remonter', () => {
  const [premiere, deuxieme] = store.cartesEnRoute(undefined, 2).cards;
  const lue = store.markCardRead(deuxieme.id, 999_999)!;
  assert.equal(lue.lastReadAt, 999_999, 'le repère de lecture avance');
  assert.equal(lue.updatedAt, deuxieme.updatedAt, 'la dernière action ne bouge pas');
  assert.equal(store.getCard(deuxieme.id)!.updatedAt, deuxieme.updatedAt);
  assert.deepEqual(
    store.cartesEnRoute(undefined, 2).cards.map((c) => c.id),
    [premiere.id, deuxieme.id],
  );
});

test('réenregistrer une carte sans rien y changer ne la fait pas remonter', () => {
  const [, , troisieme] = store.cartesEnRoute(undefined, 3).cards;
  const resauvee = store.saveCard(store.getCard(troisieme.id)!);
  assert.equal(resauvee.updatedAt, troisieme.updatedAt);
});

test('modifier une carte ou envoyer un message la fait remonter en tête', () => {
  const liste = store.cartesEnRoute(undefined, 200).cards;
  const derniere = liste[liste.length - 1];
  const modifiee = store.saveCard({ ...store.getCard(derniere.id)!, title: 'Titre retouché' });
  assert.ok(modifiee.updatedAt > derniere.updatedAt);
  assert.equal(store.cartesEnRoute(undefined, 1).cards[0].id, derniere.id);
  // Ramenée loin sous l'instant présent, pour que le message qui suit la dépasse à coup sûr.
  derniereAction(modifiee, 50_000);

  const avantDerniere = liste[liste.length - 2];
  const touchee = store.marquerUneAction(avantDerniere.id)!;
  assert.ok(touchee.updatedAt > 50_000);
  assert.equal(touchee.title, avantDerniere.title, 'rien d’autre ne change');
  assert.equal(store.cartesEnRoute(undefined, 1).cards[0].id, avantDerniere.id);
});

/* LES DEMANDES COMMUNES : une famille (mère + filles) = une entrée, rangée d'un bloc. */

// Loin devant les cartes touchées « maintenant » par les tests précédents.
const T0 = Date.now() + 1e9;

test('une famille va dans la colonne la plus à gauche que ses cartes réclament', () => {
  const mere = derniereAction(store.saveCard({ ...carte('a', 'archived', 7_000), archivedAt: 7_000 }), T0);
  const enLigneFille = derniereAction(
    store.saveCard({ ...carte('a', 'archived', 7_001), carteMereId: mere.id, deployedAt: 7_001 }),
    T0 + 2,
  );
  const aDeployer = derniereAction(store.saveCard({ ...carte('b', 'running', 7_002), carteMereId: mere.id }), T0 + 1);
  store.saveCard({ ...store.getCard(mere.id)!, cartesFilles: [
    { projectId: 'a', cardId: enLigneFille.id },
    { projectId: 'b', cardId: aDeployer.id },
  ] });
  derniereAction(store.getCard(mere.id)!, T0);
  assert.equal(store.getCard(enLigneFille.id)!.carteMereId, mere.id, 'le lien se relit depuis sa colonne');

  const actifs = store.cartesEnRoute(undefined, 1);
  assert.deepEqual(actifs.cards.map((c) => c.id), [mere.id, enLigneFille.id, aDeployer.id], 'la famille entière, la mère d’abord');
  assert.deepEqual(actifs.curseur, { updatedAt: T0 + 2, id: mere.id });
  for (const onglet of ['terminer', 'archive'] as const) {
    const ailleurs = store.cartesEnRoute(undefined, 500, onglet).cards.map((c) => c.id);
    assert.equal(ailleurs.includes(enLigneFille.id) || ailleurs.includes(mere.id), false, `rien de la famille dans ${onglet}`);
  }
  const suite = store.cartesEnRoute(actifs.curseur, 500);
  assert.equal(suite.cards.some((c) => c.carteMereId === mere.id || c.id === mere.id), false, 'pas de doublon au paquet suivant');
  assert.equal(actifs.restant, suite.cards.length, 'le reste compte des familles');

  // Le travail rendu : la famille entière passe dans « Terminer ».
  derniereAction(store.saveCard({ ...store.getCard(aDeployer.id)!, column: 'to_deploy' }), T0 + 3);
  assert.equal(store.cartesEnRoute(undefined, 500).cards.some((c) => c.id === mere.id), false);
  const aTerminer = store.cartesEnRoute(undefined, 1, 'terminer');
  assert.deepEqual(aTerminer.cards.map((c) => c.id), [mere.id, aDeployer.id, enLigneFille.id]);
  assert.equal(store.cartesEnRoute(undefined, 500, 'archive').cards.some((c) => c.id === mere.id), false);

  // Publiée : la famille RESTE dans « Terminer » — rien ne s'archive seul sur la page.
  derniereAction(store.saveCard({ ...store.getCard(aDeployer.id)!, column: 'archived', deployedAt: 7_003 }), T0 + 4);
  assert.deepEqual(
    store.cartesEnRoute(undefined, 1, 'terminer').cards.map((c) => c.id),
    [mere.id, aDeployer.id, enLigneFille.id],
  );
  // Rangée par l'utilisateur : la famille entière passe dans « Archiver ».
  for (const id of [mere.id, enLigneFille.id, aDeployer.id]) rangee(store.getCard(id)!);
  assert.equal(store.cartesEnRoute(undefined, 500, 'terminer').cards.some((c) => c.id === mere.id), false);
  const archive = store.cartesEnRoute(undefined, 1, 'archive');
  assert.deepEqual(archive.cards.map((c) => c.id), [mere.id, aDeployer.id, enLigneFille.id]);
});

test('une carte rangée qui repart au travail perd son rangement', () => {
  const finie = rangee(carte('a', 'to_deploy', 8_000));
  assert.equal(store.getCard(finie.id)!.rangeeTableauDeBordAt, 3_000, 'le rangement se relit depuis sa colonne');
  assert.equal(store.getCard(finie.id)!.column, 'to_deploy', 'ranger sur la page ne change pas la colonne du projet');
  const rouverte = store.saveCard({ ...store.getCard(finie.id)!, column: 'running' });
  assert.equal(rouverte.rangeeTableauDeBordAt, undefined);
  const refinie = store.saveCard({ ...rouverte, column: 'to_deploy' });
  assert.ok(store.cartesEnRoute(undefined, 500, 'terminer').cards.some((c) => c.id === refinie.id), 'finie de nouveau : « Terminer »');
});

test('archiver à la main range la carte dans « Archiver » ; la mise en ligne la laisse dans « Terminer »', () => {
  const main = carte('a', 'to_deploy', 9_000);
  const rangee = rangerLaCarte(main, 'archived', undefined, 9_500);
  assert.equal(rangee.column, 'archived');
  assert.equal(store.getCard(main.id)!.rangeeTableauDeBordAt, 9_500, 'le rangement se relit depuis sa colonne');
  assert.ok(store.cartesEnRoute(undefined, 500, 'archive').cards.some((c) => c.id === main.id));
  assert.equal(store.cartesEnRoute(undefined, 500, 'terminer').cards.some((c) => c.id === main.id), false);

  // Sans geste (publication, agent sans code) : « Terminer ».
  const auto = carte('a', 'to_deploy', 9_100);
  rangerLaCarte(auto, 'archived');
  assert.equal(store.getCard(auto.id)!.rangeeTableauDeBordAt, undefined);
  assert.ok(store.cartesEnRoute(undefined, 500, 'terminer').cards.some((c) => c.id === auto.id));
  assert.equal(store.cartesEnRoute(undefined, 500, 'archive').cards.some((c) => c.id === auto.id), false);

  // Ressortie d'« Archivé » vers « À déployer » : le rangement disparaît, retour dans « Terminer ».
  const reprise = rangerLaCarte(store.getCard(main.id)!, 'to_deploy', undefined, 9_800);
  assert.equal(reprise.column, 'to_deploy');
  assert.equal(store.getCard(main.id)!.rangeeTableauDeBordAt, undefined);
  assert.ok(store.cartesEnRoute(undefined, 500, 'terminer').cards.some((c) => c.id === main.id));
  assert.equal(store.cartesEnRoute(undefined, 500, 'archive').cards.some((c) => c.id === main.id), false);
});
