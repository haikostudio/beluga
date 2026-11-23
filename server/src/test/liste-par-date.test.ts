/**
 * LA LISTE UNIQUE PAR DATE (`shared/src/liste-par-date.ts`, `cartesParDate`) : un
 * ordre strict, sans doublon ni trou entre deux paquets, archives mêlées ; une
 * carte qui bouge remonte sans se dédoubler ; un collaborateur ne lit que sa part.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'liste-par-date-'));
process.env.BELUGA_DATA = bacASable;

const { Card, Project, comparerParDate, estTacheDeLaColonne, lectureApresCarte, lectureSansCarte, carteDansLaPortee, cleDeLecture } = await import('@beluga/shared');
const store = await import('../store.js');
const { getDb, openDb } = await import('../db.js');
const { creerCompte } = await import('../comptes.js');
const { refusDeLaCommande, reponsePourLeCollaborateur } = await import('../vue-collaborateur.js');
openDb();

test.after(() => fs.rmSync(bacASable, { recursive: true, force: true }));

const projet = (id: string, archived = false) =>
  store.saveProject(Project.parse({ id, name: id, path: `/tmp/${id}`, defaultEngine: 'claude', archived, createdAt: 1, updatedAt: 1 }));
projet('A');
projet('B');
projet('rangé', true);

const COLONNES = ['planned', 'running', 'to_deploy', 'archived'] as const;
function poser(id: string, projectId: string, column: (typeof COLONNES)[number], a: number, extra: Record<string, unknown> = {}) {
  const carte = Card.parse({ id, projectId, title: id, column, position: a, origin: 'user', run: { engine: 'claude' }, createdAt: a, updatedAt: a, ...extra });
  store.saveCard(carte);
  // `saveCard` date l'écriture : on repose la date voulue, pour un ordre maîtrisé.
  getDb().prepare('UPDATE cards SET updated_at = ?, data = json_set(data, ?, ?) WHERE id = ?').run(a, '$.updatedAt', a, id);
}
/* 45 cartes réparties sur toutes les colonnes et deux projets, plusieurs à la même date. */
for (let i = 0; i < 45; i += 1) {
  poser(`c${String(i).padStart(2, '0')}`, i % 3 ? 'A' : 'B', COLONNES[i % 4], 1000 + Math.floor(i / 2));
}
poser('hors-service', 'rangé', 'planned', 5000);

function toutLire(options: { projectId?: string; colonne?: 'archived' } = {}, limite = 7) {
  const lues: { id: string; updatedAt: number }[] = [];
  let apres: { updatedAt: number; id: string } | undefined;
  for (let garde = 0; garde < 50; garde += 1) {
    const paquet = store.cartesParDate({ ...options, apres, limite });
    assert.ok(paquet.cards.length <= limite);
    lues.push(...paquet.cards);
    if (!paquet.reste) return lues;
    apres = paquet.curseur;
  }
  throw new Error('la lecture ne finit pas');
}

test('tous les projets : ordre strict, ni doublon ni trou, archives mêlées, projet mis de côté absent', () => {
  const lues = toutLire();
  assert.equal(lues.length, 45);
  assert.equal(new Set(lues.map((c) => c.id)).size, 45);
  for (let i = 1; i < lues.length; i += 1) assert.ok(comparerParDate(lues[i - 1]!, lues[i]!) < 0, `ordre à la ligne ${i}`);
  assert.ok(!lues.some((c) => c.id === 'hors-service'));
});

test('une carte archivée récente passe au-dessus d’une carte ouverte plus ancienne', () => {
  poser('archive-recente', 'A', 'archived', 3000);
  poser('ouverte-ancienne', 'A', 'planned', 900);
  const ids = toutLire({ projectId: 'A' }).map((c) => c.id);
  assert.equal(ids[0], 'archive-recente');
  assert.equal(ids[ids.length - 1], 'ouverte-ancienne');
});

test('la portée : un projet, puis ses seules archives', () => {
  assert.ok(toutLire({ projectId: 'B' }).every((c) => (c as unknown as { projectId: string }).projectId === 'B'));
  const archives = toutLire({ projectId: 'A', colonne: 'archived' }, 10) as unknown as { projectId: string; column: string }[];
  assert.ok(archives.length > 0);
  assert.ok(archives.every((c) => c.projectId === 'A' && c.column === 'archived'));
});

test('une carte modifiée entre deux paquets remonte sans se dédoubler, et rien ne manque', () => {
  const premier = store.cartesParDate({ limite: 5 });
  poser('c00', 'B', 'planned', 9000); // elle était tout en bas
  const suite = store.cartesParDate({ apres: premier.curseur, limite: 200 });
  assert.ok(!suite.cards.some((c) => c.id === 'c00'), 'elle n’arrive plus sous le curseur');
  const base = { portee: {}, cartes: Object.fromEntries(premier.cards.map((c) => [c.id, c])), curseur: premier.curseur, reste: true, charge: true };
  const carte = store.getCard('c00')!;
  const apres = lectureApresCarte(base, carte);
  assert.equal(apres.cartes.c00?.updatedAt, 9000, 'plus récente que le curseur : elle entre en tête');
  assert.equal(Object.keys(lectureApresCarte(apres, carte).cartes).length, Object.keys(apres.cartes).length, 'sans doublon');
});

test('une carte inconnue plus ancienne que le curseur attend son paquet ; hors portée, elle s’en va', () => {
  const vieille = Card.parse({ id: 'v', projectId: 'A', title: 'v', column: 'planned', position: 1, origin: 'user', run: { engine: 'claude' }, createdAt: 1, updatedAt: 1 });
  const lecture = { portee: { projectId: 'A' }, cartes: {}, curseur: { updatedAt: 500, id: 'z' }, reste: true, charge: true };
  assert.equal(lectureApresCarte(lecture, vieille), lecture);
  const finie = { ...lecture, reste: false };
  assert.ok(lectureApresCarte(finie, vieille).cartes.v, 'tout est lu : plus aucun paquet ne l’apportera');
  const ailleurs = { ...vieille, projectId: 'B' };
  assert.ok(!lectureApresCarte({ ...finie, cartes: { v: vieille } }, ailleurs).cartes.v);
  assert.ok(!lectureSansCarte({ ...finie, cartes: { v: vieille } }, 'v').cartes.v);
  assert.equal(carteDansLaPortee(vieille, { colonne: 'archived' }), false);
  assert.equal(cleDeLecture({ projectId: 'A', colonne: 'archived' }), 'A/archived');
});

test('les tâches de la colonne : ni en ligne ni archivées, plus une mère que ses filles font vivre', () => {
  poser('mere-vivante', 'A', 'archived', 4000, {
    cartesFilles: [{ projectId: 'A', cardId: 'fille-vivante' }],
    suiviDesFilles: [{ cardId: 'fille-vivante', projectId: 'A', projet: 'A', colonne: 'running', etat: 'travail' }],
  });
  poser('fille-vivante', 'A', 'running', 4001);
  getDb().prepare("UPDATE cards SET carte_mere_id = 'mere-vivante' WHERE id = 'fille-vivante'").run();
  const taches = store.tachesDeLaColonne();
  assert.ok(taches.some((c) => c.id === 'mere-vivante'));
  assert.ok(taches.some((c) => c.id === 'ouverte-ancienne'));
  assert.ok(!taches.some((c) => c.id === 'archive-recente'));
  assert.ok(!taches.some((c) => c.id === 'hors-service'));
  assert.ok(comparerParDate(taches[0]!, taches[1]!) < 0);
  assert.equal(estTacheDeLaColonne({ column: 'archived' }), false);
  assert.equal(estTacheDeLaColonne({ column: 'planned' }), true);
});

test('la recherche de la colonne : titres seuls, projets en service, portée du compte', () => {
  poser('cherche-a', 'A', 'archived', 7000, { title: 'Clôture annuelle' });
  poser('cherche-b', 'B', 'planned', 7001, { title: 'Clôture du mois' });
  poser('cherche-desc', 'A', 'planned', 7002, { title: 'Autre', description: 'clôture dans le texte' });
  poser('cherche-rangé', 'rangé', 'planned', 7003, { title: 'Clôture cachée' });
  const ids = (options: Parameters<typeof store.rechercherDesCartes>[1]) =>
    store.rechercherDesCartes('clôture', options).map((c) => c.card.id).sort();
  assert.deepEqual(ids({ titreSeul: true, enServiceSeulement: true }), ['cherche-a', 'cherche-b']);
  assert.deepEqual(ids({ titreSeul: true, enServiceSeulement: true, projets: ['A'] }), ['cherche-a']);
  assert.deepEqual(ids({ titreSeul: true, enServiceSeulement: true, projets: [] }), []);
  assert.ok(ids({}).includes('cherche-desc'), 'la recherche d’une colonne regarde toujours la description');
});

test('la recherche sans projet ne rend à un collaborateur que ses tâches', () => {
  const membre = creerCompte({ identifiant: 'lea', role: 'membre', projets: ['A'] }, ['A', 'B']).compte;
  const commande = { type: 'cards.rechercher', texte: 'x' } as unknown as import('@beluga/shared').ClientCommand;
  assert.equal(refusDeLaCommande(membre, commande), null);
  const reponse = reponsePourLeCollaborateur(membre, commande, {
    cartes: [{ card: { projectId: 'A' }, rang: 1 }, { card: { projectId: 'B' }, rang: 1 }],
  }) as { cartes: unknown[] };
  assert.deepEqual(reponse.cartes, [{ card: { projectId: 'A' }, rang: 1 }]);
});

test('un collaborateur ne reçoit que la part de ses projets', () => {
  const membre = creerCompte({ identifiant: 'marie', role: 'membre', projets: ['A'] }, ['A', 'B']).compte;
  for (const type of ['cards.parDate', 'cards.tachesDeLaColonne']) {
    const commande = { type } as unknown as import('@beluga/shared').ClientCommand;
    assert.equal(refusDeLaCommande(membre, commande), null);
    const reponse = reponsePourLeCollaborateur(membre, commande, {
      cards: [{ projectId: 'A' }, { projectId: 'B' }],
      agents: [{ projectId: 'B' }],
      reste: true,
    }) as { cards: unknown[]; agents: unknown[]; reste: boolean };
    assert.deepEqual(reponse.cards, [{ projectId: 'A' }]);
    assert.deepEqual(reponse.agents, []);
    assert.equal(reponse.reste, true);
  }
});

test('les lectures de liste gardent une carte d’atelier ou rangée où un agent est actif, le tableau non', () => {
  poser('atelier-actif', 'A', 'planned', 9000, { labels: ['marketing'] });
  poser('atelier-repos', 'A', 'planned', 9001, { labels: ['marketing'] });
  poser('rangee-active', 'A', 'archived', 9002);
  poser('rangee-repos', 'A', 'archived', 9003);
  const agent = (id: string, carte: string, status: string, data: Record<string, unknown> = {}) =>
    getDb()
      .prepare('INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, 1)')
      .run(id, 'A', carte, 'task', status, JSON.stringify({ id, projectId: 'A', cardId: carte, role: 'task', status, ...data }));
  agent('ag-atelier', 'atelier-actif', 'running');
  agent('ag-atelier-repos', 'atelier-repos', 'done');
  agent('ag-rangee', 'rangee-active', 'idle', { attendReponse: true });
  const lues = store.cartesParDate({ limite: 200 }).cards.map((c) => c.id);
  assert.ok(lues.includes('atelier-actif'));
  assert.ok(!lues.includes('atelier-repos'));
  const parColonne = store.cartesParDate({ limite: 200, colonne: 'planned' }).cards.map((c) => c.id);
  assert.ok(!parColonne.includes('atelier-actif'), 'une lecture par colonne reste celle du tableau');
  const taches = store.tachesDeLaColonne().map((c) => c.id);
  assert.ok(taches.includes('atelier-actif'));
  assert.ok(taches.includes('rangee-active'));
  assert.ok(!taches.includes('rangee-repos'));
});

test('les tâches de la colonne portent les rangées terminées depuis moins de trente jours et jamais ouvertes (01/11/2026)', () => {
  const maintenant = Date.UTC(2026, 10, 1);
  const jour = 24 * 60 * 60 * 1000;
  poser('rendu-a-ouvrir', 'A', 'archived', 8000, { renduA: maintenant - jour, lastReadAt: maintenant - 2 * jour });
  poser('rendu-ouvert', 'A', 'archived', 8001, { renduA: maintenant - jour, lastReadAt: maintenant });
  poser('rendu-oublie', 'A', 'archived', 8002, { renduA: maintenant - 40 * jour });
  const taches = store.tachesDeLaColonne(maintenant).map((c) => c.id);
  assert.ok(taches.includes('rendu-a-ouvrir'));
  assert.ok(!taches.includes('rendu-ouvert'));
  assert.ok(!taches.includes('rendu-oublie'));
});
