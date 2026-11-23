import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PLAFOND_ATTENTE_MS,
  TRANCHE_ATTENTE_MS,
  attenteExpiree,
  delaiOutilMoteurMs,
  instantDuTemoin,
  texteDeReponseALaQuestion,
} from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* Une question ARRÊTE l'agent jusqu'à la réponse                       */
/* ------------------------------------------------------------------ */

/*
 * L'appel d'outil `ask_user` ne rend la main qu'une fois l'utilisateur ayant
 * répondu : c'est cela — et rien d'autre — qui empêche le moteur d'enchaîner
 * les étapes suivantes de sa liste. On vérifie ici les deux moitiés de la
 * mécanique : les textes rendus au moteur (règles pures) et le registre des
 * attentes (poser, réveiller, libérer).
 */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'attente-question-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const {
  agentEnAttente,
  attenteDeLAgent,
  annulerLAttente,
  attendreUneTranche,
  libererLesAttentes,
  oublierToutesLesAttentes,
  poserLAttente,
  refusDeQuestionSimultanee,
  repondreALAttente,
} = await import('../attente-question.js');

function agentDEssai() {
  return store.saveAgent({
    id: store.newId(),
    projectId: 'p1',
    role: 'task',
    title: 'essai',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status: 'running',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as any);
}

/* ------------------------------ Les textes ------------------------------ */

test('la réponse rendue au moteur dit quoi en faire', () => {
  const texte = texteDeReponseALaQuestion('Garde la base et déplace-la.');
  assert.match(texte, /Réponse de l'utilisateur : Garde la base/);
  assert.match(texte, /Reprends ton travail à partir de cette réponse/);
});

test('les fichiers joints à la réponse sont annoncés par leur chemin', () => {
  const texte = texteDeReponseALaQuestion('voir la capture', ['/tmp/a.png']);
  assert.match(texte, /\/tmp\/a\.png/);
});

test('le délai laissé aux moteurs dépasse le plafond d’attente', () => {
  assert.ok(delaiOutilMoteurMs() > PLAFOND_ATTENTE_MS);
});

test('une tranche est très courte devant le plafond', () => {
  assert.ok(TRANCHE_ATTENTE_MS < PLAFOND_ATTENTE_MS / 10);
});

test('le plafond se juge sur un temps donné, jamais sur l’horloge', () => {
  assert.equal(attenteExpiree(1000, 1000 + PLAFOND_ATTENTE_MS - 1), false);
  assert.equal(attenteExpiree(1000, 1000 + PLAFOND_ATTENTE_MS), true);
});

/* ------------------------------------------------------------------ */
/* UN AGENT QUI ATTEND N'EST PAS UN AGENT QUI TRAVAILLE                 */
/*                                                                      */
/* La règle vaut pour TOUS les agents : le témoin dit l'attente et son   */
/* chronomètre se fige à l'instant de la question — le temps mis à       */
/* répondre n'est pas du temps de travail.                              */
/* ------------------------------------------------------------------ */

test('sans attente, le chronomètre d’un témoin lit l’instant présent', () => {
  assert.equal(instantDuTemoin(5000), 5000);
  assert.equal(instantDuTemoin(5000, undefined), 5000);
});

test('dès qu’une attente est posée, le chronomètre se fige sur la question', () => {
  assert.equal(instantDuTemoin(900_000, 5000), 5000, 'une demi-heure plus tard, la durée n’a pas bougé');
});

test('une horloge de navigateur en retard ne rend jamais une durée négative', () => {
  assert.equal(instantDuTemoin(4000, 5000), 4000);
});

/* ----------------------------- Le registre ----------------------------- */

test('tant que personne ne répond, la tranche rend « attente »', async () => {
  const agent = agentDEssai();
  poserLAttente('q1', agent.id);
  const issue = await attendreUneTranche('q1', 10);
  assert.equal(issue.etat, 'attente');
  assert.equal(agentEnAttente(agent.id), true, "l'agent attend toujours");
  libererLesAttentes(agent.id);
});

test('la réponse réveille l’attente AVANT la fin de la tranche', async () => {
  const agent = agentDEssai();
  poserLAttente('q2', agent.id);
  // La tranche dort une minute : seule la réponse peut la réveiller à temps.
  const tranche = attendreUneTranche('q2', 60_000);
  assert.equal(repondreALAttente('q2', 'Oui, supprime-la'), true);
  const issue = await tranche;
  assert.equal(issue.etat, 'repondu');
  assert.match(issue.text, /Oui, supprime-la/);
  assert.equal(agentEnAttente(agent.id), false, "l'agent ne l'attend plus");
});

test('répondre deux fois à la même question ne réveille qu’une fois', async () => {
  const agent = agentDEssai();
  poserLAttente('q3', agent.id);
  assert.equal(repondreALAttente('q3', 'première'), true);
  assert.equal(repondreALAttente('q3', 'seconde'), false, 'la seconde ne trouve plus rien');
  const issue = await attendreUneTranche('q3', 10);
  assert.match(issue.text, /première/);
});

test('le registre dit DEPUIS QUAND l’agent attend, quel que soit son type', async () => {
  // Un agent de tiroir (rôle « deploy ») passe par le MÊME registre qu'un agent
  // de carte : c'est cet instant-là qui fige le témoin du tiroir.
  const agent = store.saveAgent({
    id: store.newId(),
    projectId: 'p1',
    role: 'deploy',
    title: 'Procédure — Déploiement',
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status: 'running',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as any);
  assert.equal(attenteDeLAgent(agent.id), undefined, 'rien tant qu’aucune question n’est posée');
  poserLAttente('q-deploy', agent.id, 1234);
  assert.equal(attenteDeLAgent(agent.id), 1234, 'l’instant de la question, pas un oui/non');
  // Répondre suffit à faire repartir le témoin : on n'attend pas que la tranche
  // ait porté la réponse au moteur.
  repondreALAttente('q-deploy', 'Reconstruire sur place');
  assert.equal(attenteDeLAgent(agent.id), undefined, 'la réponse donnée, l’agent repart');
  await attendreUneTranche('q-deploy', 10);
});

test('la plus ANCIENNE attente gagne quand un agent en porte deux', () => {
  const agent = agentDEssai();
  poserLAttente('q-a', agent.id, 5000);
  poserLAttente('q-b', agent.id, 3000);
  assert.equal(attenteDeLAgent(agent.id), 3000);
  libererLesAttentes(agent.id);
});

test('une réponse à une question que plus personne n’attend rend faux', () => {
  assert.equal(repondreALAttente('jamais-posee', 'réponse'), false);
});

test('annuler la question libère le tour sans rien trancher', async () => {
  const agent = agentDEssai();
  poserLAttente('q4', agent.id);
  assert.equal(annulerLAttente('q4'), true);
  const issue = await attendreUneTranche('q4', 10);
  assert.equal(issue.etat, 'annulee');
  assert.match(issue.text, /Ne devine pas à la place de l'utilisateur/);
  assert.equal(agentEnAttente(agent.id), false);
});

test('un tour refermé libère ses attentes, et le drapeau tombe', async () => {
  const agent = agentDEssai();
  poserLAttente('q5', agent.id);
  assert.equal(store.getAgent(agent.id)?.attendReponse, true, 'le drapeau est posé');
  libererLesAttentes(agent.id);
  const issue = await attendreUneTranche('q5', 10);
  assert.equal(issue.etat, 'perdue');
  assert.equal(store.getAgent(agent.id)?.attendReponse, undefined, 'le drapeau est retiré');
});

test('une question inconnue est PERDUE, jamais une attente sans fin', async () => {
  const issue = await attendreUneTranche('question-fantome', 10);
  assert.equal(issue.etat, 'perdue');
});

test('le plafond atteint arrête l’agent au lieu de le laisser deviner', async () => {
  const agent = agentDEssai();
  poserLAttente('q6', agent.id, Date.now() - PLAFOND_ATTENTE_MS - 1);
  const issue = await attendreUneTranche('q6', 10);
  assert.equal(issue.etat, 'expiree');
  assert.match(issue.text, /ARRÊTE-TOI ICI/);
  assert.equal(agentEnAttente(agent.id), false);
});

test('un redémarrage n’en laisse aucune debout', async () => {
  const agent = agentDEssai();
  poserLAttente('q7', agent.id);
  oublierToutesLesAttentes();
  assert.equal(agentEnAttente(agent.id), false);
  assert.equal(store.getAgent(agent.id)?.attendReponse, undefined);
  const issue = await attendreUneTranche('q7', 10);
  assert.equal(issue.etat, 'perdue');
});

test('une question posée allume la pastille bleue de sa carte, et la consultation l’éteint', async () => {
  const { Card, Project, carteNonLue } = await import('@beluga/shared');
  store.saveProject(Project.parse({ id: 'p-pastille', name: 'Pastille', path: bacASable, createdAt: Date.now(), updatedAt: Date.now() }));
  const carte = store.saveCard(
    Card.parse({
      id: 'carte-pastille',
      projectId: 'p-pastille',
      title: 'Carte',
      column: 'running',
      position: 0,
      run: { engine: 'claude' },
      lastReadAt: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  const agent = store.saveAgent({ ...agentDEssai(), cardId: carte.id });
  const avant = store.getCard(carte.id)!;
  assert.equal(carteNonLue({ colonne: avant.column, renduA: avant.renduA, luA: avant.lastReadAt }), false);
  poserLAttente('q-pastille', agent.id);
  const apres = store.getCard(carte.id)!;
  assert.ok(apres.renduA, 'l’instant de la question est écrit sur la carte');
  assert.equal(carteNonLue({ colonne: apres.column, renduA: apres.renduA, luA: apres.lastReadAt }), true);
  // La consultation (ouvrir la carte) éteint la pastille, la question reste posée.
  assert.equal(carteNonLue({ colonne: apres.column, renduA: apres.renduA, luA: (apres.renduA ?? 0) + 1 }), false);
  assert.equal(store.getAgent(agent.id)?.attendReponse, true);
  libererLesAttentes(agent.id);
});

/* ------------------------------------------------------------------ */
/* UNE SEULE QUESTION À LA FOIS, PAR AGENT                              */
/*                                                                      */
/* Une seconde question rédigée avant la réponse à la première peut      */
/* être devenue sans objet : le démon la refuse, lisiblement.            */
/* ------------------------------------------------------------------ */

test('sans question ouverte, une question passe', () => {
  const agent = agentDEssai();
  assert.equal(refusDeQuestionSimultanee(agent.id, 'ask_user'), undefined);
  assert.equal(refusDeQuestionSimultanee(agent.id, 'realiser'), undefined);
});

test('une seconde question est refusée tant que la première attend', () => {
  const agent = agentDEssai();
  poserLAttente('q-premiere', agent.id);
  const refus = refusDeQuestionSimultanee(agent.id, 'ask_user');
  assert.match(refus ?? '', /UNE SEULE question à la fois/i);
  assert.match(refus ?? '', /sans objet/);
  assert.match(refusDeQuestionSimultanee(agent.id, 'realiser') ?? '', /Refusé/);
  /* Un refus ne pose aucune attente : une seule reste ouverte. */
  assert.equal(agentEnAttente(agent.id), true);
  libererLesAttentes(agent.id);
  assert.equal(agentEnAttente(agent.id), false, 'aucune attente fantôme');
});

test('les autres outils ne sont jamais refusés', () => {
  const agent = agentDEssai();
  poserLAttente('q-autre-outil', agent.id);
  assert.equal(refusDeQuestionSimultanee(agent.id, 'memoire'), undefined);
  assert.equal(refusDeQuestionSimultanee(agent.id, 'board_update_card'), undefined);
  libererLesAttentes(agent.id);
});

test('le refus ne gêne pas un autre agent', () => {
  const a = agentDEssai();
  const b = agentDEssai();
  poserLAttente('q-de-a', a.id);
  assert.equal(refusDeQuestionSimultanee(b.id, 'ask_user'), undefined);
  libererLesAttentes(a.id);
});

test('après la réponse, une nouvelle question passe', async () => {
  const agent = agentDEssai();
  poserLAttente('q-reponse', agent.id);
  assert.ok(refusDeQuestionSimultanee(agent.id, 'ask_user'));
  assert.equal(repondreALAttente('q-reponse', 'On supprime.'), true);
  /* La réponse est posée : l'agent est reparti, même avant que la tranche la consomme. */
  assert.equal(refusDeQuestionSimultanee(agent.id, 'ask_user'), undefined);
  const issue = await attendreUneTranche('q-reponse', 10);
  assert.equal(issue.etat, 'repondu');
  assert.equal(refusDeQuestionSimultanee(agent.id, 'ask_user'), undefined);
});

/* ------------------------------------------------------------------ */
/* LA PORTE D'ACCORD DE L'ASSISTANT GLOBAL                              */
/*                                                                      */
/* Le geste suspendu ne part QU'APRÈS « Autoriser », une seule fois     */
/* même si deux tranches arrivent ensemble ; tout autre issue le dit    */
/* non exécuté (`shared/src/assistant-global.ts`).                       */
/* ------------------------------------------------------------------ */

test('un geste suspendu ne s’exécute qu’après « Autoriser », et une seule fois', async () => {
  const agent = agentDEssai();
  let executions = 0;
  const suite = async (reponse: string) => {
    if (reponse !== 'Autoriser') return 'REFUSÉ';
    executions += 1;
    return 'AUTORISÉ ET EXÉCUTÉ';
  };
  poserLAttente('q-accord', agent.id, Date.now(), suite);
  assert.equal((await attendreUneTranche('q-accord', 10)).etat, 'attente');
  assert.equal(executions, 0, 'rien ne part avant le clic');
  repondreALAttente('q-accord', 'Autoriser');
  const [a, b] = await Promise.all([attendreUneTranche('q-accord', 10), attendreUneTranche('q-accord', 10)]);
  assert.equal(a.text, 'AUTORISÉ ET EXÉCUTÉ');
  assert.equal(b.text, 'AUTORISÉ ET EXÉCUTÉ');
  assert.equal(executions, 1, 'deux tranches n’exécutent pas deux fois le geste');
});

test('un refus ou une annulation ne l’exécute jamais', async () => {
  const agent = agentDEssai();
  let executions = 0;
  const suite = async (reponse: string) => {
    if (reponse === 'Autoriser') executions += 1;
    return reponse === 'Autoriser' ? 'fait' : 'REFUSÉ';
  };
  poserLAttente('q-refus', agent.id, Date.now(), suite);
  repondreALAttente('q-refus', 'oui vas-y');
  assert.equal((await attendreUneTranche('q-refus', 10)).text, 'REFUSÉ');
  poserLAttente('q-annule', agent.id, Date.now(), suite);
  annulerLAttente('q-annule');
  assert.match((await attendreUneTranche('q-annule', 10)).text, /N'A PAS été exécuté/);
  assert.equal(executions, 0);
});
