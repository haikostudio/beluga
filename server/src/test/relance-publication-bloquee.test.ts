import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Attachment, Card, DeployRun, Project } from '@beluga/shared';

/*
 * « RELANCER » UNE PUBLICATION BLOQUÉE (19/11/2026), LA VEILLE QUI SURVIT AU REDÉMARRAGE, ET L'IMAGE CITÉE PAR SON
 * CHEMIN DE FICHIER.
 */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'relance-publication-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const { depannerLaPublication, relancerLaPublicationBloquee, reprendreLesVeillesDeDepannage } = await import('../depannage-publication.js');

function projetDEssai(nom: string): Project {
  const dossier = fs.mkdtempSync(path.join(bacASable, 'projet-'));
  return store.saveProject(Project.parse({ id: store.newId(), name: nom, path: dossier, createdAt: 1, updatedAt: 1 }));
}

function publicationTombee(projectId: string, depannage?: DeployRun['depannage']): DeployRun {
  return store.saveDeploy(
    DeployRun.parse({
      id: store.newId(),
      projectId,
      state: 'failed',
      cible: 'dev',
      error: 'La construction a échoué.',
      steps: [
        { key: 'merge', state: 'done', log: '' },
        { key: 'build', state: 'failed', log: 'boom' },
      ],
      startedAt: Date.now() - 1000,
      endedAt: Date.now(),
      ...(depannage ? { depannage } : {}),
    }),
  );
}

test('« Relancer » arrête d’abord le dépanneur au travail, puis passe par les gardes de tout lancement', async () => {
  const projet = projetDEssai('Relance');
  const run = publicationTombee(projet.id);
  const { agentId } = await depannerLaPublication(run.id, { catalogue: async () => [], envoyer: async () => {} } as any);
  store.saveAgent({ ...store.getAgent(agentId)!, status: 'running' });

  const issue = await relancerLaPublicationBloquee(run.id, { attente: 3000, pas: 20 });
  const agent = store.getAgent(agentId)!;
  assert.notEqual(agent.status, 'running', 'le dépanneur est arrêté');
  /* Le projet d'essai n'a pas de procédure : le refus vient de `startDeploy`, jamais d'un « agent travaille encore ». */
  assert.equal(issue.ok, false);
  assert.doesNotMatch(issue.error ?? '', /agent travaille/i);
});

test('« Relancer » refuse une publication qui n’est plus la dernière, ou déjà repartie', async () => {
  const projet = projetDEssai('Relance 2');
  const ancienne = publicationTombee(projet.id);
  store.saveDeploy(DeployRun.parse({ id: store.newId(), projectId: projet.id, state: 'running', startedAt: Date.now() + 5000 }));
  const issue = await relancerLaPublicationBloquee(ancienne.id);
  assert.equal(issue.ok, false);
});

test('au démarrage, un dépannage ancien n’annonce plus de reprise : il attend le clic', () => {
  const projet = projetDEssai('Veille');
  const run = publicationTombee(projet.id, { agentId: 'agent-disparu', at: Date.now() - 5 * 60 * 60 * 1000 });
  reprendreLesVeillesDeDepannage();
  assert.equal(store.getDeploy(run.id)!.depannage?.enAttenteDeVous, true);
});

test('une image citée par son chemin retrouve la pièce rangée depuis ce fichier', () => {
  const projet = projetDEssai('Images');
  const piece = store.saveAttachment(
    Attachment.parse({
      id: store.newId(),
      projectId: projet.id,
      name: 'capture.png',
      mime: 'image/png',
      size: 10,
      sha: 'abc',
      createdAt: Date.now(),
      chemins: ['/tmp/captures-743/capture.png'],
    }),
  );
  assert.equal(store.pieceDuChemin('/tmp/captures-743/capture.png')?.id, piece.id);
  assert.equal(store.pieceDuChemin('/tmp/captures-743/autre.png'), null);
  /* Un joker ne mène nulle part, et un identifiant n'est jamais lu comme un chemin. */
  assert.equal(store.pieceDuChemin('/tmp/%'), null);
  assert.equal(store.pieceDuChemin('capture.png'), null);
});

test('les cartes programmées : seulement celles qui attendent avant le travail, la plus proche d’abord', () => {
  const projet = projetDEssai('Programmées');
  const avant = store.cartesProgrammees().length;
  const poser = (titre: string, column: string, departPrevu?: number) =>
    store.saveCard(
      Card.parse({
        id: store.newId(),
        projectId: projet.id,
        title: titre,
        column,
        position: 0,
        labels: [],
        run: { engine: 'claude' },
        createdAt: store.now(),
        updatedAt: store.now(),
        scheduling: { attempts: 0, restarts: 0, asap: false, ...(departPrevu ? { departPrevu } : {}) },
      }),
    );
  poser('Plus tard', 'planned', Date.now() + 2 * 3600_000);
  poser('Bientôt', 'planned', Date.now() + 3600_000);
  poser('Sans date', 'planned');
  poser('Déjà partie', 'running', Date.now() + 3600_000);
  const programmees = store.cartesProgrammees().filter((c) => c.projectId === projet.id);
  assert.deepEqual(programmees.map((c) => c.title), ['Bientôt', 'Plus tard']);
  assert.equal(store.cartesProgrammees().length, avant + 2);
});
