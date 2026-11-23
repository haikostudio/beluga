import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/* LE FILET : un agent marqué « au travail » que plus personne          */
/* n'attend est refermé par la veille de l'ordonnanceur.                */
/* ------------------------------------------------------------------ */

// La base jetable se pose AVANT d'importer les modules qui la lisent
// (piège connu : un import statique fige le chemin réel).
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'tour-bloque-'));
process.env.BELUGA_DATA = bacASable;

const { Agent, Message, Project } = await import('@beluga/shared');
const store = await import('../store.js');
const { refermerLeTour, veilleDesToursBloques, isRunning } = await import('../runtime.js');

function poserAgent(id: string, contenu: string) {
  const projet = store.saveProject(
    Project.parse({
      id: `projet-${id}`,
      name: `Projet ${id}`,
      path: bacASable,
      createdAt: store.now(),
      updatedAt: store.now(),
    }),
  );
  store.saveAgent(
    Agent.parse({
      id,
      projectId: projet.id,
      role: 'cadrage',
      title: 'Chef d’orchestre',
      run: { engine: 'claude' },
      status: 'running',
      startedAt: store.now() - 3_600_000,
      createdAt: store.now() - 3_600_000,
      updatedAt: store.now() - 3_600_000,
    }),
  );
  return store.saveMessage(
    Message.parse({
      id: `message-${id}`,
      agentId: id,
      role: 'assistant',
      content: contenu,
      streaming: true,
      createdAt: store.now(),
    }),
  );
}

test('un agent « au travail » que le serveur ne suit plus est remis au repos', () => {
  const message = poserAgent('agent-orphelin', 'La réponse était pourtant écrite.');
  assert.equal(isRunning('agent-orphelin'), false, 'le tour n’est plus suivi');

  const refermes = veilleDesToursBloques();
  assert.ok(refermes >= 1);

  const agent = store.getAgent('agent-orphelin')!;
  // La réponse était rendue : c'est un travail fini, pas un échec.
  assert.equal(agent.status, 'done');
  assert.ok(agent.endedAt);

  const fige = store.getMessage(message.id)!;
  assert.equal(fige.streaming, false, 'le message ne s’écrit plus');
  assert.equal(fige.error, undefined, 'une réponse rendue ne porte pas de bandeau rouge');
});

test('un tour coupé sans rien rendre est un échec, et la raison est dite', () => {
  const message = poserAgent('agent-muet', '');
  refermerLeTour('agent-muet', 'Le moteur s’est arrêté sans rendre la main.');

  assert.equal(store.getAgent('agent-muet')!.status, 'failed');
  assert.match(store.getMessage(message.id)!.error ?? '', /sans rendre la main/);
});

test('refermer un agent déjà au repos ne fait rien', () => {
  poserAgent('agent-fini', 'Terminé.');
  refermerLeTour('agent-fini', 'première fermeture');
  assert.equal(refermerLeTour('agent-fini', 'seconde fermeture'), false);
  assert.equal(veilleDesToursBloques(), 0, 'plus rien à refermer');
});

test('un agent inconnu ne fait pas tomber la veille', () => {
  assert.equal(refermerLeTour('agent-qui-n-existe-pas', 'peu importe'), false);
});

test('un tour refermé sans avoir rien écrit DIT pourquoi, au lieu du silence', () => {
  // Le cas de la panne : la demande de l'utilisateur est au fil, le tour est
  // parti, et rien n'a jamais été écrit en réponse. Avant, l'agent restait
  // « au travail » sans un mot ; maintenant la raison s'affiche.
  const projet = store.saveProject(
    Project.parse({
      id: 'projet-sans-un-mot',
      name: 'Projet muet',
      path: bacASable,
      createdAt: store.now(),
      updatedAt: store.now(),
    }),
  );
  store.saveAgent(
    Agent.parse({
      id: 'agent-sans-un-mot',
      projectId: projet.id,
      role: 'cadrage',
      title: 'Chef d’orchestre',
      run: { engine: 'claude' },
      status: 'starting',
      startedAt: store.now() - 3_600_000,
      createdAt: store.now() - 3_600_000,
      updatedAt: store.now() - 3_600_000,
    }),
  );
  store.saveMessage(
    Message.parse({
      id: 'demande-sans-un-mot',
      agentId: 'agent-sans-un-mot',
      role: 'user',
      content: 'Explique-moi ce que fait ce projet.',
      createdAt: store.now(),
    }),
  );

  veilleDesToursBloques();

  const messages = store.listMessages('agent-sans-un-mot');
  const dernier = messages[messages.length - 1];
  assert.equal(dernier.role, 'assistant', 'une réponse a été posée');
  assert.ok(dernier.error, 'elle porte la raison en clair');
  assert.notEqual(store.getAgent('agent-sans-un-mot')!.status, 'starting', 'l’agent est libéré');
});

test('une raison n’est pas dite deux fois sur le même tour', () => {
  const message = poserAgent('agent-deja-dit', '');
  refermerLeTour('agent-deja-dit', 'Le moteur s’est arrêté sans rendre la main.');
  const avant = store.listMessages('agent-deja-dit').length;

  // L'agent est déjà au repos : la veille n'a plus rien à refermer, donc rien
  // à écrire. Et le message du tour porte déjà sa raison.
  veilleDesToursBloques();

  assert.equal(store.listMessages('agent-deja-dit').length, avant);
  assert.match(store.getMessage(message.id)!.error ?? '', /sans rendre la main/);
});

/* ------------------------------------------------------------------ */
/* L'ÉCRITURE ORPHELINE : un message resté « en cours d'écriture »      */
/* alors que son agent est au repos depuis. C'est ce qui laissait le    */
/* bandeau « réflexion en cours » allumé indéfiniment.                  */
/* ------------------------------------------------------------------ */

test('la veille éteint un message resté en écriture sur un agent en échec', () => {
  const message = poserAgent('agent-ecriture-orpheline', 'Une réponse à moitié écrite.');
  // Le tour s'est refermé en échec APRÈS la naissance du message, et une
  // dernière bribe a rallumé la marque derrière la fermeture.
  const agent = store.getAgent('agent-ecriture-orpheline')!;
  store.saveAgent({ ...agent, status: 'failed', endedAt: message.createdAt + 1_000 });
  store.saveMessage({ ...store.getMessage(message.id)!, streaming: true });

  veilleDesToursBloques();

  assert.equal(store.getMessage(message.id)!.streaming, false, 'la marque d’écriture est éteinte');
  assert.equal(store.getAgent('agent-ecriture-orpheline')!.status, 'failed', 'le verdict du tour ne change pas');
});

test('un message du tour qui démarre n’est jamais pris pour un orphelin', () => {
  const message = poserAgent('agent-qui-demarre', '');
  // L'agent n'est pas encore passé « au travail » : le message vient de naître,
  // il est plus récent que la fin du tour précédent.
  const agent = store.getAgent('agent-qui-demarre')!;
  store.saveAgent({ ...agent, status: 'idle', endedAt: message.createdAt - 1_000 });

  veilleDesToursBloques();

  assert.equal(store.getMessage(message.id)!.streaming, true, 'le tour qui démarre garde sa marque');
});

/* ------------------------------------------------------------------ */
/* LA MÊME MILLISECONDE : la demande et la raison qui lui répond sont   */
/* écrites coup sur coup. Sans départage, le fil les sortait à          */
/* l'envers — la réponse AVANT la question — une fois sur deux.         */
/* ------------------------------------------------------------------ */

test('une raison écrite dans la même milliseconde que la demande reste APRÈS elle', () => {
  const vraiMaintenant = Date.now;
  const instant = vraiMaintenant();
  Date.now = () => instant;
  try {
    const projet = store.saveProject(
      Project.parse({
        id: 'projet-meme-milliseconde',
        name: 'Projet pressé',
        path: bacASable,
        createdAt: instant,
        updatedAt: instant,
      }),
    );
    store.saveAgent(
      Agent.parse({
        id: 'agent-meme-milliseconde',
        projectId: projet.id,
        role: 'cadrage',
        title: 'Chef d’orchestre',
        run: { engine: 'claude' },
        status: 'starting',
        startedAt: instant - 3_600_000,
        createdAt: instant - 3_600_000,
        updatedAt: instant - 3_600_000,
      }),
    );
    store.saveMessage(
      Message.parse({
        id: 'demande-meme-milliseconde',
        agentId: 'agent-meme-milliseconde',
        role: 'user',
        content: 'Explique-moi ce que fait ce projet.',
        createdAt: instant,
      }),
    );

    veilleDesToursBloques(instant);

    const messages = store.listMessages('agent-meme-milliseconde');
    assert.equal(messages[0].id, 'demande-meme-milliseconde', 'la demande reste en tête');
    assert.equal(messages[messages.length - 1].role, 'assistant', 'la raison vient après');
    assert.ok(messages[messages.length - 1].error, 'et elle est dite en clair');
  } finally {
    Date.now = vraiMaintenant;
  }
});

test('un tour refermé AVANT le moteur ne prend pas la réponse du tour d’avant pour la sienne', () => {
  // Carte InVia, 27/10/2026 : la demande de lancement (silencieuse) est restée
  // pendue dans sa préparation ; la dernière bulle du fil était la réponse du
  // CADRAGE, d'un tour précédent — le tour passait pour « terminé » et le
  // balayage rangeait la carte dans « À déployer ».
  const projet = store.saveProject(
    Project.parse({ id: 'projet-lancement', name: 'Projet lancement', path: bacASable, createdAt: store.now(), updatedAt: store.now() }),
  );
  store.saveMessage(
    Message.parse({
      id: 'message-du-cadrage',
      agentId: 'agent-lancement',
      role: 'assistant',
      content: 'Compréhension rendue : la carte est prête.',
      createdAt: store.now() - 600_000,
    }),
  );
  store.saveAgent(
    Agent.parse({
      id: 'agent-lancement',
      projectId: projet.id,
      role: 'task',
      title: 'Lancement',
      run: { engine: 'claude' },
      status: 'starting',
      startedAt: store.now(),
      createdAt: store.now() - 3_600_000,
      updatedAt: store.now(),
    }),
  );
  refermerLeTour('agent-lancement', 'La préparation de ce tour est restée bloquée avant même le lancement du moteur.');
  assert.equal(store.getAgent('agent-lancement')!.status, 'failed', 'rien n’a été rendu par CE tour');
});

test('un lancement mort avant le moteur ramène sa carte, et la veille dit l’étape bloquée', () => {
  const runtime = fs.readFileSync(new URL('../../src/runtime.ts', import.meta.url), 'utf8');
  const veille = runtime.split('export function veilleDesToursBloques')[1].split('\n}\n')[0];
  assert.match(veille, /ramenerLeLancementManque\(agent\.id, preparation\.lancement\)/);
  assert.match(veille, /préparation refermée à l'étape/);
  assert.match(runtime, /etapeDePreparation\(agent\.id, preparation, 'démarrage du moteur'\)/);
  const scheduler = fs.readFileSync(new URL('../../src/scheduler.ts', import.meta.url), 'utf8');
  assert.match(scheduler, /lancementDeCarte: \{ cardId: running\.id, colonneAvant/);
  // Le garde « déjà partie » ne vaut plus pour l'agent de cadrage qui range encore sa réponse.
  assert.match(scheduler, /agentInscrit\.role !== 'cadrage' && isRunning\(agentInscrit\.id\)/);
});
