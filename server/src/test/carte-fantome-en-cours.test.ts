import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Card, issueDeCarteOubliee } from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* UNE CARTE SUSPENDUE NE RESTE PAS AFFICHÉE « EN COURS »              */
/* ------------------------------------------------------------------ */

/*
 * « Suspendue » et « En cours » ne peuvent pas être vrais ensemble : le geste
 * qui suspend une carte la range en « Planifié » du même mouvement
 * (`suspendreLaCarte`). Quand les deux marques se retrouvaient sur la même
 * carte — un arrêt dont le rangement s'est perdu, puis une demande qui la
 * remet en travail sans effacer la marque —, plus rien ne l'en sortait : le
 * balayage s'interdit de ranger une carte dont le dernier tour a échoué, et
 * c'est justement l'échec qui l'avait fait suspendre. La carte restait en
 * travail pour toujours, sans agent, sans tour, sans issue.
 *
 * Constaté en vrai : une carte affichée « En cours » pendant des heures avec
 * la phrase « Agent arrêté à la main », alors que son agent était rendu depuis
 * longtemps et que son tour n'avait jamais atteint le moteur.
 */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'carte-fantome-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const { rangerLesCartesOubliees } = await import('../deplacement-carte.js');

const IL_Y_A_LONGTEMPS = Date.now() - 3 * 60 * 60 * 1000;
const PHRASE = 'Agent arrêté à la main : la carte ne repartira que sur votre geste.';

function carte(overrides: Partial<Card> = {}) {
  return store.saveCard(
    Card.parse({
      id: store.newId(),
      projectId: 'projet-essai',
      title: 'Carte d’essai',
      column: 'running',
      position: 1,
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides,
    }),
  );
}

function agentDe(c: Card, status: 'running' | 'done') {
  return store.saveAgent({
    id: store.newId(),
    projectId: c.projectId,
    cardId: c.id,
    role: 'task',
    title: c.title,
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status,
    ...(status === 'done' ? { endedAt: IL_Y_A_LONGTEMPS } : {}),
    createdAt: IL_Y_A_LONGTEMPS,
    updatedAt: IL_Y_A_LONGTEMPS,
  } as any);
}

/* ------------------------------------------------------------------ */
/* La règle pure                                                        */
/* ------------------------------------------------------------------ */

const oubliee = {
  colonne: 'running' as const,
  agentAuTravail: false,
  dernierTourEnEchec: true,
  dejaEnregistre: false,
};

test('une carte suspendue restée en « En cours » retombe en « Planifié »', () => {
  const issue = issueDeCarteOubliee({ ...oubliee, suspendue: true }, Date.now());
  assert.equal(issue.colonne, 'planned');
  // Sa phrase de suspension dit déjà pourquoi elle est garée : on n'en écrit
  // pas une seconde par-dessus.
  assert.equal(issue.raison, null);
});

test('…et ce rangement passe AVANT le refus « dernier tour en échec »', () => {
  // C'est tout l'objet du correctif : sans la marque de suspension, la même
  // carte ne bouge toujours pas — la règle d'avant est intacte, elle attend
  // votre relance.
  assert.equal(issueDeCarteOubliee(oubliee, Date.now()).colonne, null);
});

test('une carte suspendue que quelque chose tient encore ne bouge pas', () => {
  const maintenant = Date.now();
  for (const tenue of [
    { agentAuTravail: true },
    { tourEncoreVivant: true },
    { lancementEnPreparation: true },
    { demandeEnFile: true },
    { tourEnVolDepuis: maintenant },
  ]) {
    const issue = issueDeCarteOubliee({ ...oubliee, suspendue: true, ...tenue }, maintenant);
    assert.equal(issue.colonne, null, JSON.stringify(tenue));
  }
});

test('une carte suspendue AILLEURS qu’en « En cours » ne bouge pas non plus', () => {
  for (const colonne of ['planned', 'to_deploy', 'archived'] as const) {
    const issue = issueDeCarteOubliee({ ...oubliee, colonne, suspendue: true }, Date.now());
    assert.equal(issue.colonne, null, colonne);
  }
});

/* ------------------------------------------------------------------ */
/* Le balayage, sur une vraie base                                      */
/* ------------------------------------------------------------------ */

test('le balayage range la carte fantôme et lui laisse sa phrase', () => {
  const c = carte({
    scheduling: {
      asap: false,
      attempts: 1,
      restarts: 0,
      suspendu: true,
      waitingReason: PHRASE,
      tourEnVolDepuis: IL_Y_A_LONGTEMPS,
    },
  });
  const agent = agentDe(c, 'done');
  store.saveCard({ ...c, agentId: agent.id });

  rangerLesCartesOubliees();

  const apres = store.getCard(c.id)!;
  assert.equal(apres.column, 'planned');
  assert.equal(apres.scheduling?.suspendu, true, 'elle reste garée : rien ne repart tout seul');
  assert.equal(apres.scheduling?.waitingReason, PHRASE, 'et elle garde le mot qui explique pourquoi');
  // La marque de vol ne survit pas : sinon la prochaine relecture raconterait
  // un tour toujours en vol.
  assert.equal(apres.scheduling?.tourEnVolDepuis, undefined);
});

test('…mais il ne touche pas une carte suspendue dont un agent travaille encore', () => {
  const c = carte({
    scheduling: { asap: false, attempts: 1, restarts: 0, suspendu: true, waitingReason: PHRASE },
  });
  const agent = agentDe(c, 'running');
  store.saveCard({ ...c, agentId: agent.id });

  rangerLesCartesOubliees();

  assert.equal(store.getCard(c.id)!.column, 'running');
});


/* ------------------------------------------------------------------ */
/* …ET LA MARQUE NE SURVIT PAS AU DÉPART                                */
/* ------------------------------------------------------------------ */

/*
 * D'OÙ VENAIT L'ÉTAT IMPOSSIBLE. Le départ efface bien la suspension — c'est le
 * geste qu'elle attendait — mais il ne le faisait qu'APRÈS la préparation :
 * copie de travail ouverte, compte choisi, branche créée. Or la carte, elle,
 * passe en « En cours » dès le clic. Une préparation qui meurt dans cet
 * intervalle (un compte au jeton expiré suffit) laissait donc la carte en
 * « En cours » AVEC sa marque de suspension : le balayage s'interdit de la
 * ranger, l'ordonnanceur s'interdit de la reprendre, et elle n'a plus d'issue.
 * Constaté le 05.09.2026 — une carte fantôme pendant près de trois heures.
 *
 * La marque tombe donc dans le MÊME geste que le déplacement en « En cours ».
 */

test('la suspension tombe à l’entrée en « En cours », pas à la fin de la préparation', () => {
  const ici = path.dirname(new URL(import.meta.url).pathname);
  const scheduler = fs.readFileSync(path.resolve(ici, '../../src/scheduler.ts'), 'utf8');
  const lancement = scheduler.split('async function lancerLaCarte(')[1];
  // Tout ce qui précède la première porte : le déplacement au clic, et rien de
  // long. C'est là que la marque doit tomber.
  const auClic = lancement.split("etapeDeLancement(card, 'portes')")[0];
  assert.match(auClic, /suspendu: false/, 'le départ efface la suspension dès le clic');
  assert.match(auClic, /waitingReason: undefined/, 'et la phrase qui l’accompagnait');
});
