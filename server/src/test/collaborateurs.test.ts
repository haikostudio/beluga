/**
 * UN MEMBRE ET UN LECTEUR NE VOIENT, NE DEMANDENT ET NE TOUCHENT QUE LEURS PROJETS.
 *
 * Ce que ces essais verrouillent, AU SERVEUR (l'écran n'est jamais le juge) :
 *  - tout ce qui n'est pas nommé reste fermé, y compris une commande envoyée à la main ;
 *  - une commande qui NOMME une carte, un agent, un message ou un élément de file
 *    est rapportée au projet de cet élément : hors portée, le même refus que pour
 *    une commande qui n'existe pas ;
 *  - un lecteur ne modifie rien, un membre ne publie pas, ne gère pas les comptes,
 *    n'ouvre ni le coffre-fort ni les réglages ;
 *  - les événements diffusés à tous sont jugés avant de partir, le premier envoi
 *    est réécrit sur la portée, et rien de global (quotas, comptes, réglages) ne part ;
 *  - « Mon compte » reste ouvert à tous les niveaux, et lui seul agit sur le compte du canal.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'collaborateurs-'));
process.env.BELUGA_DATA = bacASable;

const {
  Agent,
  Card,
  Message,
  Project,
  REFUS_HORS_PORTEE,
  commandeAutorisee,
  evenementAutorise,
  routeApiAutorisee,
  COMMANDES_LECTURE,
  COMMANDES_TRAVAIL,
  ClientCommand,
} = await import('@beluga/shared');
const store = await import('../store.js');
const { openDb } = await import('../db.js');
const { creerCompte, compteParId, changerLeRole } = await import('../comptes.js');
const { refusDeLaCommande, reponsePourLeCollaborateur, evenementPourCollaborateur } = await import('../vue-collaborateur.js');
openDb();

const projet = (id: string) =>
  store.saveProject(
    Project.parse({ id, name: `Projet ${id}`, path: path.join(bacASable, id), createdAt: store.now(), updatedAt: store.now() }),
  );
const A = projet('projet-a');
const B = projet('projet-b');

function poserTravail(projectId: string, suffixe: string) {
  const carte = store.saveCard(
    Card.parse({
      id: `carte-${suffixe}`,
      projectId,
      column: 'planned',
      position: 1,
      title: `Carte ${suffixe}`,
      run: { engine: 'claude' },
      createdAt: store.now(),
      updatedAt: store.now(),
    }),
  );
  const agent = store.saveAgent(
    Agent.parse({
      id: `agent-${suffixe}`,
      projectId,
      cardId: carte.id,
      role: 'task',
      title: 'Agent',
      run: { engine: 'claude' },
      status: 'idle',
      createdAt: store.now(),
      updatedAt: store.now(),
    }),
  );
  const message = store.saveMessage(
    Message.parse({ id: `message-${suffixe}`, agentId: agent.id, role: 'assistant', content: 'bonjour', createdAt: store.now() }),
  );
  return { carte, agent, message };
}
const a = poserTravail(A.id, 'a');
const b = poserTravail(B.id, 'b');

const projetsConnus = [A.id, B.id];
const membre = creerCompte({ identifiant: 'marie', role: 'membre', projets: [A.id] }, projetsConnus).compte;
const lecteur = creerCompte({ identifiant: 'luc', role: 'lecteur', projets: [A.id] }, projetsConnus).compte;
const admin = creerCompte({ identifiant: 'chef', role: 'admin' }, projetsConnus).compte;

const cmd = (c: Record<string, unknown>) => c as unknown as import('@beluga/shared').ClientCommand;

test('les rôles se lisent, et un rôle inconnu retombe sur le plus étroit', () => {
  assert.equal(membre.role, 'membre');
  assert.equal(lecteur.role, 'lecteur');
  assert.equal(admin.role, 'admin');
  assert.deepEqual(membre.projets, [A.id], 'la portée est gardée pour un membre');
  assert.deepEqual(admin.projets, [], 'un administrateur n’en porte aucune : il voit tout');
});

test('un administrateur passe partout ; rien n’est refusé de sa part', () => {
  assert.equal(refusDeLaCommande(admin, cmd({ type: 'deploy.start', projectId: B.id })), null);
});

test('le membre lit et travaille sur son projet', () => {
  assert.equal(refusDeLaCommande(membre, cmd({ type: 'card.get', id: a.carte.id })), null);
  assert.equal(refusDeLaCommande(membre, cmd({ type: 'cards.tranche', projectId: A.id, column: 'planned' })), null);
  assert.equal(refusDeLaCommande(membre, cmd({ type: 'card.create', projectId: A.id, title: 'x' })), null);
  assert.equal(refusDeLaCommande(membre, cmd({ type: 'agent.prompt', agentId: a.agent.id, text: 'bonjour' })), null);
  assert.equal(refusDeLaCommande(membre, cmd({ type: 'question.answer', messageId: a.message.id, questionId: 'q', answer: 'oui' })), null);
});

test('le membre est refusé hors de sa portée, quelle que soit la façon de nommer le projet', () => {
  const hors = [
    { type: 'card.get', id: b.carte.id },
    { type: 'card.update', id: b.carte.id, patch: { title: 'piraté' } },
    { type: 'card.create', projectId: B.id, title: 'x' },
    { type: 'cards.tranche', projectId: B.id, column: 'planned' },
    { type: 'agent.open', id: b.agent.id },
    { type: 'agent.prompt', agentId: b.agent.id, text: 'bonjour' },
    { type: 'question.answer', messageId: b.message.id, questionId: 'q', answer: 'oui' },
    { type: 'comment.add', cardId: b.carte.id, text: 'x', attachmentIds: [] },
    { type: 'projects.relire', ids: [A.id, B.id] },
    { type: 'card.deplacerVersProjet', id: a.carte.id, projectId: B.id },
    { type: 'card.deplacerVersProjet', id: b.carte.id, projectId: A.id },
  ];
  for (const c of hors) {
    assert.equal(refusDeLaCommande(membre, cmd(c)), REFUS_HORS_PORTEE, `${c.type} doit être refusée hors de sa portée`);
  }
});

test('un identifiant inconnu est refusé de la même façon qu’un projet interdit', () => {
  assert.equal(refusDeLaCommande(membre, cmd({ type: 'card.get', id: 'n-existe-pas' })), REFUS_HORS_PORTEE);
  assert.equal(refusDeLaCommande(membre, cmd({ type: 'agent.stop', agentId: 'n-existe-pas' })), REFUS_HORS_PORTEE);
  assert.equal(refusDeLaCommande(membre, cmd({ type: 'queue.remove', id: 'n-existe-pas' })), REFUS_HORS_PORTEE);
});

test('une carte ne change pas de projet par un simple « patch »', () => {
  assert.equal(
    refusDeLaCommande(membre, cmd({ type: 'card.update', id: a.carte.id, patch: { projectId: B.id } })),
    REFUS_HORS_PORTEE,
  );
  assert.equal(refusDeLaCommande(membre, cmd({ type: 'card.update', id: a.carte.id, patch: { title: 'ok' } })), null);
});

test('le membre n’a ni mise en ligne, ni comptes, ni coffre-fort, ni réglages, ni terminal', () => {
  const fermees = [
    { type: 'deploy.start', projectId: A.id },
    { type: 'deploy.retry', runId: 'r' },
    { type: 'comptes.lister' },
    { type: 'comptes.creer', identifiant: 'intrus' },
    { type: 'coffre.lister' },
    { type: 'settings.update', patch: {} },
    { type: 'settings.get' },
    { type: 'project.update', id: A.id, patch: { path: '/etc' } },
    { type: 'project.create', name: 'x', path: '/tmp/x' },
    { type: 'project.delete', id: A.id },
    { type: 'installation.etat' },
    { type: 'account.connections' },
    { type: 'quota.refresh' },
    { type: 'prefs.set', key: 'k', value: 1 },
    { type: 'process.stop', id: 'p' },
    { type: 'agents.stop-all' },
    { type: 'cards.enRoute' },
    { type: 'espace.etat' },
  ];
  for (const c of fermees) {
    assert.equal(refusDeLaCommande(membre, cmd(c)), REFUS_HORS_PORTEE, `${c.type} doit rester fermée au membre`);
    assert.equal(commandeAutorisee('membre', c.type), false);
  }
});

test('le lecteur lit sur son projet et ne modifie rien', () => {
  assert.equal(refusDeLaCommande(lecteur, cmd({ type: 'card.get', id: a.carte.id })), null);
  assert.equal(refusDeLaCommande(lecteur, cmd({ type: 'card.get', id: b.carte.id })), REFUS_HORS_PORTEE);
  for (const type of Object.keys(COMMANDES_TRAVAIL)) {
    assert.equal(commandeAutorisee('lecteur', type), false, `${type} est une écriture : fermée au lecteur`);
  }
  assert.equal(refusDeLaCommande(lecteur, cmd({ type: 'card.create', projectId: A.id, title: 'x' })), REFUS_HORS_PORTEE);
  assert.equal(refusDeLaCommande(lecteur, cmd({ type: 'agent.prompt', agentId: a.agent.id, text: 'x' })), REFUS_HORS_PORTEE);
});

test('« Mon compte » reste ouvert à tous les niveaux, et ne nomme jamais un autre compte', () => {
  for (const role of ['membre', 'lecteur', 'client', 'admin'] as const) {
    for (const type of ['espace.moi', 'espace.moi.profil', 'espace.moi.identifiant', 'espace.moi.motDePasse']) {
      assert.equal(commandeAutorisee(role, type), true, `${type} doit être ouverte à « ${role} »`);
    }
  }
  assert.equal(refusDeLaCommande(membre, cmd({ type: 'espace.moi.profil', nomAffiche: 'Marie' })), null);
  // Les commandes de l'espace client ne sont pas celles d'un collaborateur.
  assert.equal(commandeAutorisee('membre', 'espace.demande.creer'), false);
  assert.equal(commandeAutorisee('lecteur', 'espace.fil.lire'), false);
});

test('chaque commande ouverte à un collaborateur existe au protocole et dit ce qu’elle vise', () => {
  const connues = new Set(ClientCommand.options.map((o: any) => o.shape.type.value));
  for (const type of [...Object.keys(COMMANDES_LECTURE), ...Object.keys(COMMANDES_TRAVAIL)]) {
    assert.ok(connues.has(type), `${type} n'existe pas au protocole`);
  }
  for (const viseur of [...Object.values(COMMANDES_LECTURE), ...Object.values(COMMANDES_TRAVAIL)]) {
    assert.match(viseur, /^(aucun|((projet|carte|agent|message|file|contenu):\w+)(\+(projet|carte|agent|message|file|contenu):\w+)*)$/);
  }
});

test('la liste des projets est ramenée à la portée', () => {
  const brut = { projects: [A, B] };
  const rendu = reponsePourLeCollaborateur(membre, cmd({ type: 'project.list' }), brut) as { projects: { id: string }[] };
  assert.deepEqual(rendu.projects.map((p) => p.id), [A.id]);
  const entier = reponsePourLeCollaborateur(admin, cmd({ type: 'project.list' }), brut) as { projects: unknown[] };
  assert.equal(entier.projects.length, 2);
});

test('les événements d’un autre projet ne partent pas ; ceux du sien, oui', () => {
  const ev = (e: Record<string, unknown>) => e as unknown as import('@beluga/shared').ServerEvent;
  assert.ok(evenementPourCollaborateur(ev({ type: 'card.upsert', card: a.carte }), membre));
  assert.equal(evenementPourCollaborateur(ev({ type: 'card.upsert', card: b.carte }), membre), null);
  assert.ok(evenementPourCollaborateur(ev({ type: 'agent.upsert', agent: a.agent }), lecteur));
  assert.equal(evenementPourCollaborateur(ev({ type: 'agent.upsert', agent: b.agent }), lecteur), null);
  assert.ok(evenementPourCollaborateur(ev({ type: 'message.upsert', message: a.message }), membre));
  assert.equal(evenementPourCollaborateur(ev({ type: 'message.upsert', message: b.message }), membre), null);
  assert.ok(evenementPourCollaborateur(ev({ type: 'agent.etat', agentId: a.agent.id, messages: [], queue: [] }), membre));
  assert.equal(evenementPourCollaborateur(ev({ type: 'agent.etat', agentId: b.agent.id, messages: [], queue: [] }), membre), null);
  assert.equal(evenementPourCollaborateur(ev({ type: 'agent.etat', agentId: 'disparu', messages: [], queue: [] }), membre), null, 'un agent introuvable ne part pas');
  assert.equal(evenementPourCollaborateur(ev({ type: 'project.upsert', project: B }), membre), null);
});

test('rien de global ne part vers un collaborateur', () => {
  const ev = (e: Record<string, unknown>) => e as unknown as import('@beluga/shared').ServerEvent;
  for (const type of ['quotas', 'comptes', 'settings', 'prefs', 'processes', 'capacity', 'installation.travail', 'surveillance', 'espace.demande', 'espace.compteurs', 'toast', 'notify', 'studio', 'connexion-compte']) {
    assert.equal(evenementAutorise('membre', type), false, `${type} ne doit pas partir vers un membre`);
    assert.equal(evenementPourCollaborateur(ev({ type }), membre), null);
  }
});

test('le premier envoi est réécrit sur la portée : projets, agents, pas de réglages ni de quotas', () => {
  const ready = {
    type: 'ready',
    protocol: 1,
    version: 'x',
    studioOuvert: true,
    settings: store.getSettings(),
    prefs: { secret: 'à ne pas montrer' },
    projects: [A, B],
    groups: [],
    engines: [],
    quotas: [{ id: 'compte-secret', engine: 'claude', label: 'compte@exemple.com' }],
    capacity: {},
    agents: [a.agent, b.agent],
    openedProjectId: B.id,
  };
  const rendu = evenementPourCollaborateur(ready as any, membre) as any;
  assert.deepEqual(rendu.projects.map((p: any) => p.id), [A.id]);
  assert.deepEqual(rendu.agents.map((x: any) => x.id), [a.agent.id]);
  assert.deepEqual(rendu.quotas, []);
  assert.deepEqual(rendu.prefs, {});
  assert.equal(rendu.studioOuvert, false);
  assert.equal(rendu.openedProjectId, undefined, 'un projet hors portée ne s’ouvre pas au départ');

  const attention = evenementPourCollaborateur(
    { type: 'attention', byProject: { [A.id]: 1, [B.id]: 3 }, decisions: [{ projectId: B.id, genre: 'question' }, { projectId: A.id, genre: 'question' }] } as any,
    membre,
  ) as any;
  assert.deepEqual(Object.keys(attention.byProject), [A.id]);
  assert.equal(attention.decisions.length, 1);
});

test('routes /api/ : le membre dépose, le lecteur non ; ni l’un ni l’autre n’ouvre les routes d’administration', () => {
  assert.equal(routeApiAutorisee('membre', '/api/upload'), true);
  assert.equal(routeApiAutorisee('lecteur', '/api/upload'), false);
  for (const role of ['membre', 'lecteur'] as const) {
    assert.equal(routeApiAutorisee(role, '/api/me'), true);
    assert.equal(routeApiAutorisee(role, '/api/attachment'), true);
    for (const route of ['/api/terminal', '/api/file', '/api/zip', '/api/digest', '/api/studio/extrait', '/api/download', '/api/donnees/archive']) {
      assert.equal(routeApiAutorisee(role, route), false, `${route} reste fermée à « ${role} »`);
    }
  }
});

test('changer le niveau d’un accès coupe ses sessions ; un administrateur ne change pas de niveau', () => {
  const jeune = creerCompte({ identifiant: 'paul', role: 'client', projets: [A.id] }, projetsConnus).compte;
  assert.equal(changerLeRole(jeune.id, 'membre').role, 'membre');
  assert.deepEqual(compteParId(jeune.id)?.projets, [A.id], 'la portée est gardée');
  assert.throws(() => changerLeRole(admin.id, 'lecteur'), /administrateur/);
  assert.equal(compteParId(admin.id)?.role, 'admin');
});
