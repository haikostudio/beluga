import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/* L'AGENT DE CONFIGURATION TOMBÉ (25/11/2026, iMiel). Son tour s'est   */
/* coupé pendant sa question : le clic « Initialiser » rouvrait sa      */
/* conversation morte et rien ne repartait, sous un avertissement       */
/* anodin du moteur affiché en rouge comme cause. Désormais un agent    */
/* tombé est remplacé par un agent NEUF (l'ancien gardé, détaché), un   */
/* agent vivant n'est jamais touché, et l'avertissement est écarté.     */
/* ------------------------------------------------------------------ */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-tombe-'));
process.env.BELUGA_DATA = bacASable;

const { Message, Project, agentDeConfigurationTombe, issueDuTour, sortieDErreurUtile, estUnAvertissementAnodin } =
  await import('@beluga/shared');
const store = await import('../store.js');
const { agentDeConfigurationDuProjet, agentDuClicInitialiser, agentRetenuTombe } = await import('../procedure-publication.js');

const AVERTISSEMENT =
  'Ignoring 1 permissions.allow entry from .claude/settings.local.json: this workspace has not been trusted. Run Claude Code interactively here once and accept the trust dialog, or set projects["/root/x"].hasTrustDialogAccepted: true in /home/x/.claude/.claude.json.';

const vivant = { auTravail: false, questionOuverte: false, procedureEcrite: false, dernierTourEnErreur: false };

test('règle pure : seul un agent coupé, sans question ouverte ni procédure, est tombé', () => {
  assert.equal(agentDeConfigurationTombe({ ...vivant, statut: 'failed' }), true);
  assert.equal(agentDeConfigurationTombe({ ...vivant, statut: 'done', dernierTourEnErreur: true }), true);
  assert.equal(agentDeConfigurationTombe({ ...vivant, statut: 'done' }), false, 'un tour fini proprement n’est pas tombé');
  assert.equal(agentDeConfigurationTombe({ ...vivant, statut: 'failed', auTravail: true }), false, 'au travail : jamais');
  assert.equal(agentDeConfigurationTombe({ ...vivant, statut: 'failed', questionOuverte: true }), false, 'attend sa réponse : jamais');
  assert.equal(agentDeConfigurationTombe({ ...vivant, statut: 'failed', procedureEcrite: true }), false, 'procédure écrite : jamais');
});

test('l’avertissement de confiance du moteur est écarté, jamais une vraie erreur', () => {
  assert.equal(estUnAvertissementAnodin(AVERTISSEMENT), true);
  assert.equal(estUnAvertissementAnodin('Error: API rate limit reached'), false);
  assert.equal(sortieDErreurUtile(AVERTISSEMENT), '');
  assert.equal(sortieDErreurUtile(`${AVERTISSEMENT}\nError: connexion refusée`), 'Error: connexion refusée');
  assert.equal(sortieDErreurUtile('\nErreur réelle\n'), 'Erreur réelle');
});

test('l’issue d’un tour coupé pendant sa question le dit en clair, sans l’avertissement', () => {
  const coupe = issueDuTour({ statut: 'failed', erreur: AVERTISSEMENT, questionAnnulee: true });
  assert.ok('raison' in coupe);
  assert.match(coupe.raison, /coupé pendant sa question/);
  assert.doesNotMatch(coupe.raison, /trusted/);
  const seul = issueDuTour({ statut: 'failed', erreur: AVERTISSEMENT });
  assert.ok('raison' in seul);
  assert.doesNotMatch(seul.raison, /trusted/);
  const vraie = issueDuTour({ erreur: `${AVERTISSEMENT}\nquota épuisé` });
  assert.ok('raison' in vraie);
  assert.match(vraie.raison, /quota épuisé/);
});

const projet = store.saveProject(
  Project.parse({ id: 'projet-tombe', name: 'Projet tombé', path: bacASable, createdAt: store.now(), updatedAt: store.now() }),
);

const messageAvecQuestion = (id: string, agentId: string, question: { cancelled?: boolean }, error?: string) =>
  Message.parse({
    id,
    agentId,
    role: 'assistant',
    content: '',
    streaming: false,
    createdAt: store.now(),
    ...(error ? { error } : {}),
    questions: [{ id: `q-${id}`, question: 'La production est-elle bien chez ce client ?', options: [], ...question }],
  });

test('le clic « Initialiser » sur un agent tombé repart d’un agent neuf, l’ancien gardé', () => {
  const ancien = agentDeConfigurationDuProjet(projet.id, 'production')!;
  store.saveMessage(messageAvecQuestion('m-coupe', ancien.id, { cancelled: true }, AVERTISSEMENT));
  store.saveAgent({ ...ancien, status: 'failed' });
  assert.equal(agentRetenuTombe(store.getAgent(ancien.id)!, 'production'), true);

  const neuf = agentDuClicInitialiser(projet.id, 'production');
  assert.ok(neuf);
  assert.notEqual(neuf.id, ancien.id, 'un agent neuf');
  assert.equal(store.getProject(projet.id)?.miseEnProduction?.agentId, neuf.id, 'le neuf est retenu');
  assert.ok(store.getAgent(ancien.id), 'l’ancien n’est pas supprimé');
  assert.equal(agentDuClicInitialiser(projet.id, 'production')?.id, neuf.id, 'un second clic ne crée rien de plus');
});

test('un agent arrêté sur sa question ouverte n’est jamais remplacé', () => {
  const agent = agentDeConfigurationDuProjet(projet.id, 'dev')!;
  store.saveMessage(messageAvecQuestion('m-ouverte', agent.id, {}));
  store.saveAgent({ ...agent, status: 'failed' });
  assert.equal(agentDuClicInitialiser(projet.id, 'dev')?.id, agent.id);
});

test('un agent dont la procédure est écrite n’est jamais remplacé', () => {
  const p = store.getProject(projet.id)!;
  const agent = store.getAgent(p.miseEnProduction!.agentId!)!;
  store.saveProject({
    ...p,
    miseEnProduction: {
      ...p.miseEnProduction,
      processus: { etapes: [{ libelle: 'Contrôler', commande: 'curl -fsS https://x', delaiS: 20 }] },
    },
  } as typeof p);
  store.saveAgent({ ...agent, status: 'failed' });
  assert.equal(agentDuClicInitialiser(projet.id, 'production')?.id, agent.id);
});
