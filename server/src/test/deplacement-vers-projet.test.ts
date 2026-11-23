import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Agent, Attachment, CardComment, Message, Project } from '@beluga/shared';

/*
 * LE DÉPLACEMENT D'UNE CARTE VERS UN AUTRE PROJET, SUR UNE VRAIE BASE.
 *
 * Une base jetable, montée pour ce seul fichier : on y pose deux projets, une
 * carte de cadrage avec tout ce qui pend à elle, et l'on vérifie qu'après le
 * geste RIEN n'est resté derrière — et qu'une carte interdite ne bouge pas d'un
 * pixel.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'deplacement-projet-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const { getDb } = await import('../db.js');
const { createCard } = await import('../tools.js');
const { deplacerLaCarteVersProjet } = await import('../deplacement-vers-projet.js');
const { ajouterAuJournal, entreesDuJournal } = await import('../journal-carte.js');

function projet(id: string, nom: string, extra: Partial<Project> = {}): Project {
  return store.saveProject(
    Project.parse({
      id,
      name: nom,
      path: `/tmp/${id}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...extra,
    }),
  );
}

const source = projet('p-source', 'Projet de départ');
const cible = projet('p-cible', 'Projet d’accueil');

/** Une carte de cadrage complète : agent, messages, pièce jointe, commentaire, journal. */
function carteGarnie(titre: string) {
  const card = createCard(source.id, { title: titre, description: 'à déplacer' });
  const agent = store.saveAgent(
    Agent.parse({
      id: store.newId(),
      projectId: source.id,
      cardId: card.id,
      role: 'cadrage',
      title: titre,
      run: { engine: 'claude', thinking: 'medium' },
      status: 'idle',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  store.setSessionId(agent.id, 'session-de-lancien-projet', 'claude#compte');
  store.saveMessage(
    Message.parse({
      id: store.newId(),
      agentId: agent.id,
      role: 'user',
      content: 'On en parle ici.',
      createdAt: Date.now(),
    }),
  );
  store.saveAttachment(
    Attachment.parse({
      id: store.newId(),
      projectId: source.id,
      name: 'capture.png',
      mime: 'image/png',
      size: 12,
      sha: `sha-${card.id}`,
      cardId: card.id,
      createdAt: Date.now(),
    }),
  );
  store.addCardComment(
    CardComment.parse({
      id: store.newId(),
      cardId: card.id,
      projectId: source.id,
      text: 'un commentaire',
      createdAt: Date.now(),
    }),
  );
  ajouterAuJournal({ cardId: card.id, phase: 'cadrage', nature: 'jalon', libelle: 'Cadrage ouvert' });
  const carte = store.saveCard({ ...card, agentId: agent.id });
  return { card: carte, agent };
}

/** Ce qui pend encore à la carte, par projet. */
function repartition(cardId: string) {
  const db = getDb();
  const un = (sql: string) => (db.prepare(sql).get(cardId) as { projet: string | null } | undefined)?.projet ?? null;
  return {
    carte: un('SELECT project_id AS projet FROM cards WHERE id = ?'),
    agent: un('SELECT project_id AS projet FROM agents WHERE card_id = ? LIMIT 1'),
    commentaire: un('SELECT project_id AS projet FROM card_comments WHERE card_id = ? LIMIT 1'),
    piece: un("SELECT project_id AS projet FROM attachments WHERE json_extract(data, '$.cardId') = ? LIMIT 1"),
  };
}

/* ------------------------------------------------------------------ */
/* TOUT PART ENSEMBLE                                                   */
/* ------------------------------------------------------------------ */

test('la carte et tout ce qui pend à elle changent de projet ensemble', () => {
  const { card, agent } = carteGarnie('Carte à déplacer');
  assert.deepEqual(repartition(card.id), {
    carte: source.id,
    agent: source.id,
    commentaire: source.id,
    piece: source.id,
  });

  const resultat = deplacerLaCarteVersProjet(card.id, cible.id);
  assert.equal(resultat.ok, true, resultat.error);
  assert.equal(resultat.card?.projectId, cible.id);
  assert.equal(resultat.depuis?.id, source.id);
  assert.equal(resultat.vers?.id, cible.id);

  /* RIEN N'EST RESTÉ DERRIÈRE : chaque table à projet a suivi. */
  assert.deepEqual(repartition(card.id), {
    carte: cible.id,
    agent: cible.id,
    commentaire: cible.id,
    piece: cible.id,
  });

  /* La conversation garde tout son contenu. */
  assert.equal(store.listMessages(agent.id).length, 1);
  /* …mais la session du moteur est refermée : le tour suivant repart sur
     l'accueil du nouveau projet. */
  assert.equal(store.getSessionId(agent.id, 'claude#compte'), null);
  /* La carte garde son étape. */
  assert.equal(resultat.card?.column, card.column);
  /* Et le journal dit d'où elle vient. */
  const journal = entreesDuJournal(card.id);
  assert.ok(
    journal.some((entree) => (entree.resultat ?? '').includes(source.name)),
    'le journal doit nommer le projet quitté',
  );
});

test('la carte déplacée sort de la liste de son ancien projet et entre dans l’autre', () => {
  const { card } = carteGarnie('Seconde carte');
  deplacerLaCarteVersProjet(card.id, cible.id);
  assert.equal(
    store.listCards(source.id).some((c) => c.id === card.id),
    false,
  );
  assert.equal(
    store.listCards(cible.id).some((c) => c.id === card.id),
    true,
  );
});

/* ------------------------------------------------------------------ */
/* LES REFUS : LA CARTE NE BOUGE PAS D'UN PIXEL                         */
/* ------------------------------------------------------------------ */

test('une carte déjà travaillée est refusée, et rien n’a bougé', () => {
  const { card } = carteGarnie('Carte avec branche');
  store.saveCard({ ...card, github: { branch: 'tache/deja-travaillee-ab12', fichiers: [], checks: [], commits: [], activity: [] } });

  const resultat = deplacerLaCarteVersProjet(card.id, cible.id);
  assert.equal(resultat.ok, false);
  assert.match(resultat.error ?? '', /déjà été travaillée/);
  assert.deepEqual(repartition(card.id), {
    carte: source.id,
    agent: source.id,
    commentaire: source.id,
    piece: source.id,
  });
});

test('une carte en cours de travail est refusée', () => {
  const { card, agent } = carteGarnie('Carte au travail');
  store.saveAgent({ ...agent, status: 'running' });
  const resultat = deplacerLaCarteVersProjet(card.id, cible.id);
  assert.equal(resultat.ok, false);
  assert.match(resultat.error ?? '', /agent travaille/);
  assert.equal(repartition(card.id).carte, source.id);
});

test('une carte archivée est refusée', () => {
  const { card } = carteGarnie('Carte rangée');
  store.saveCard({ ...card, column: 'archived', archivedAt: Date.now() });
  const resultat = deplacerLaCarteVersProjet(card.id, cible.id);
  assert.equal(resultat.ok, false);
  assert.equal(repartition(card.id).carte, source.id);
});

test('une carte née d’une demande client est refusée', () => {
  const { card } = carteGarnie('Carte du client');
  getDb()
    .prepare(
      `INSERT INTO demandes (id, project_id, auteur_id, colonne, rang, titre, carte_id, data, creee_le, derniere_activite)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run('dem-1', source.id, 'auteur-1', 'nouvelle', 1, 'Une demande', card.id, '{}', Date.now(), Date.now());

  const resultat = deplacerLaCarteVersProjet(card.id, cible.id);
  assert.equal(resultat.ok, false);
  assert.match(resultat.error ?? '', /demande client/);
  assert.equal(repartition(card.id).carte, source.id);
});

test('le même projet et un projet inconnu sont refusés', () => {
  const { card } = carteGarnie('Carte sur place');
  assert.equal(deplacerLaCarteVersProjet(card.id, source.id).ok, false);
  assert.equal(deplacerLaCarteVersProjet(card.id, 'projet-qui-n-existe-pas').ok, false);
  assert.equal(repartition(card.id).carte, source.id);
});

/*
 * L'ESPACE DE DÉVELOPPEMENT, DANS LES DEUX SENS. Il était la seule destination
 * refusée d'office ; il reçoit désormais une carte comme tout autre projet, et
 * la laisse repartir.
 */
test('une carte entre dans l’espace de développement, puis en ressort', () => {
  const dev = projet('p-self', 'Beluga Build', { isSelf: true });
  const { card } = carteGarnie('Carte qui voyage');

  assert.equal(deplacerLaCarteVersProjet(card.id, dev.id).ok, true);
  assert.equal(repartition(card.id).carte, dev.id);

  assert.equal(deplacerLaCarteVersProjet(card.id, cible.id).ok, true);
  assert.equal(repartition(card.id).carte, cible.id);
});

/* ------------------------------------------------------------------ */
/* UN REFUS NE DÉPLACE RIEN                                             */
/* ------------------------------------------------------------------ */

test('un déplacement refusé laisse la carte où elle est', () => {
  const { card } = carteGarnie('Carte à consulter');
  assert.equal(deplacerLaCarteVersProjet(card.id, source.id).ok, false);
  assert.equal(deplacerLaCarteVersProjet('carte-inconnue', cible.id).ok, false);
  assert.equal(repartition(card.id).carte, source.id);
});
