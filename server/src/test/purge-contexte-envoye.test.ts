import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/* LA PURGE DU CONTEXTE ENVOYÉ NE PEUT PAS FAIRE TOMBER UN TOUR.        */
/*                                                                      */
/* Elle relit les lignes de la base TELLES QU'ELLES ONT ÉTÉ ÉCRITES,    */
/* parfois par une version plus ancienne du modèle : un vieux fil (le   */
/* chef d'orchestre et ses centaines de messages) porte des instantanés */
/* sans `passages`. Le champ manquant levait une panne, la panne        */
/* remontait au filet de fin de tour, et le filet affichait « panne     */
/* interne du serveur » sur un tour qui, lui, tournait très bien.       */
/* ------------------------------------------------------------------ */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'purge-contexte-'));
process.env.HAIKODEV_DATA = bacASable;

const { Agent, Message, Project } = await import('@haikodev/shared');
const store = await import('../store.js');
const { getDb } = await import('../db.js');

const AGENT = 'agent-vieux-fil';

function instantane(numero: number) {
  return {
    engine: 'claude' as const,
    session: 'resumed' as const,
    prompt: `demande ${numero}`,
    systemInstruction: { kind: 'reminder' as const, content: 'rappel', transport: 'separate' as const },
    blocks: [
      { kind: 'request' as const, label: 'Demande utilisateur', characters: 10, text: `demande ${numero}` },
    ],
    passages: [{ source: 'docs/regles/cartes.md', titre: 'Cartes', score: 0.5, tokens: 40, texte: 'texte' }],
    history: 'retained_by_engine' as const,
    sentAt: numero,
  };
}

function poserMessage(numero: number) {
  return store.saveMessage(
    Message.parse({
      id: `message-${numero}`,
      agentId: AGENT,
      role: 'user',
      content: `demande ${numero}`,
      sentContext: instantane(numero),
      createdAt: numero,
    }),
  );
}

test('un instantané écrit avant l’existence des passages ne fait pas tomber la purge', () => {
  const projet = store.saveProject(
    Project.parse({
      id: 'projet-vieux-fil',
      name: 'Vieux fil',
      path: bacASable,
      createdAt: store.now(),
      updatedAt: store.now(),
    }),
  );
  store.saveAgent(
    Agent.parse({
      id: AGENT,
      projectId: projet.id,
      role: 'cadrage',
      title: 'Chef d’orchestre',
      run: { engine: 'claude' },
      status: 'running',
      createdAt: store.now(),
      updatedAt: store.now(),
    }),
  );

  // Le plus vieux message d'abord : c'est lui qui sera purgé.
  poserMessage(1);
  for (let numero = 2; numero <= store.TOURS_CONTEXTE_CONSERVES + 1; numero += 1) poserMessage(numero);

  // On le ramène à sa forme d'ORIGINE : un instantané sans `passages`, tel
  // qu'écrit avant que la recherche de passages n'existe. Le schéma poserait
  // son défaut, la base non — c'est tout le piège.
  const ligne = getDb().prepare('SELECT data FROM messages WHERE id = ?').get('message-1') as { data: string };
  const brut = JSON.parse(ligne.data);
  delete brut.sentContext.passages;
  getDb().prepare('UPDATE messages SET data = ? WHERE id = ?').run(JSON.stringify(brut), 'message-1');

  assert.doesNotThrow(() => store.purgerContexteEnvoyeAncien(AGENT));

  const vieux = store.getMessage('message-1')!;
  assert.deepEqual(vieux.sentContext!.passages, [], 'la ligne ancienne repart avec des passages vides');
  assert.equal(vieux.sentContext!.prompt, '', 'le texte du plus vieux tour est bien retiré');
  assert.equal(vieux.sentContext!.blocks[0].text, undefined);

  const recent = store.getMessage(`message-${store.TOURS_CONTEXTE_CONSERVES + 1}`)!;
  assert.equal(recent.sentContext!.prompt, `demande ${store.TOURS_CONTEXTE_CONSERVES + 1}`, 'les tours récents gardent leur texte');
});

test('une ligne illisible est sautée, jamais propagée en panne', () => {
  store.saveMessage(
    Message.parse({
      id: 'message-casse',
      agentId: AGENT,
      role: 'user',
      content: 'peu importe',
      sentContext: instantane(0),
      createdAt: 0,
    }),
  );
  getDb().prepare('UPDATE messages SET data = ? WHERE id = ?').run('{ ceci n’est pas du json', 'message-casse');

  assert.doesNotThrow(() => store.purgerContexteEnvoyeAncien(AGENT));
});
