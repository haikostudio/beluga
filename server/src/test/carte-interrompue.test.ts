import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  Card,
  RAISON_COUPE_EN_VOL,
  RAISON_TRACE_INCONNUE,
  colonneEnFinDeTour,
  demarrageAutomatiqueAutorise,
  etatApresCoupure,
  etatVisuelCarte,
  issueDeFinDeTour,
  RAISON_RENDU_SANS_CODE,
  traceAcquise,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Une tâche coupée par une panne ne passe jamais pour terminée         */
/* ------------------------------------------------------------------ */

/*
 * Le tour d'exécution se range en plusieurs temps : l'agent passe en
 * « terminé », PUIS le dépôt est constaté, PUIS la branche est fusionnée, PUIS
 * seulement la carte bouge. Un arrêt du serveur au milieu de cette fenêtre
 * laissait un agent « terminé » que la reprise ne regardait plus, et une carte
 * restée en « En cours » avec la coche verte du travail rendu — alors que le
 * code dormait sur une branche jamais fusionnée.
 */

// Une vraie base, dans un dossier jetable, avant d'importer ce qui la lit.
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'carte-interrompue-'));
process.env.HAIKODEV_DATA = bacASable;

const store = await import('../store.js');
const { recoverAfterRestart } = await import('../runtime.js');

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

/* ------------------------------------------------------------------ */
/* Les règles pures                                                     */
/* ------------------------------------------------------------------ */

test('sans marque de vol, il n’y a rien à rattraper', () => {
  // Une carte simplement rendue et laissée ouverte ne doit pas être reprise.
  assert.equal(etatApresCoupure({ column: 'running' }), null);
  assert.equal(etatApresCoupure({ column: 'running', scheduling: {} }), null);
});

test('une carte marquée et en travail retombe dans « Planifié », raison écrite', () => {
  const etat = etatApresCoupure({ column: 'running', scheduling: { tourEnVolDepuis: 1 } });
  assert.equal(etat?.colonne, 'planned');
  assert.equal(etat?.raison, RAISON_COUPE_EN_VOL);
  assert.match(etat?.raison ?? '', /interrompue/i);
});

test('une carte marquée dans une fin de parcours ne bouge pas, mais le dit', () => {
  for (const colonne of ['to_deploy', 'archived'] as const) {
    const etat = etatApresCoupure({ column: colonne, scheduling: { tourEnVolDepuis: 1 } });
    assert.equal(etat?.colonne, null, colonne);
    assert.equal(etat?.raison, RAISON_COUPE_EN_VOL, colonne);
  }
});

test('le constat du dépôt reste FIN, mais ne décide plus de la clôture', () => {
  // `traceAcquise` ne dit plus « la carte peut se fermer » : elle dit « du code
  // a été LIVRÉ sur la branche de la carte ». La clôture, elle, tient au
  // rapport rendu.
  assert.equal(traceAcquise('oui'), true);
  assert.equal(traceAcquise('non'), false);
  assert.equal(traceAcquise('inconnue'), false);
  assert.equal(traceAcquise('ailleurs'), false);
  assert.equal(colonneEnFinDeTour('running', true, 'task'), 'done');
});

test('un constat impossible se dit autrement que « rien n’a changé »', () => {
  assert.equal(issueDeFinDeTour('running', true, 'task', 'non', false).raison, RAISON_RENDU_SANS_CODE);
  assert.equal(issueDeFinDeTour('running', true, 'task', 'inconnue', false).raison, RAISON_TRACE_INCONNUE);
  assert.match(RAISON_TRACE_INCONNUE, /sans preuve/);
});

test('sans trace, la carte se ferme quand même — et le DIT', () => {
  // Le rapport est rendu : la laisser en « En cours » démentait la conversation.
  // Ce qui change d'un cas à l'autre, c'est la phrase, jamais la colonne.
  const phrases = new Set<string>();
  for (const trace of ['non', 'inconnue'] as const) {
    const issue = issueDeFinDeTour('running', true, 'task', trace, false);
    assert.equal(issue.colonne, 'done', `trace « ${trace} »`);
    assert.ok(issue.raison, `trace « ${trace} » : la carte ne se ferme pas en silence`);
    phrases.add(issue.raison!);
  }
  assert.equal(phrases.size, 2, 'deux constats différents, deux phrases différentes');
});

/* ------------------------------------------------------------------ */
/* La reprise au démarrage                                              */
/* ------------------------------------------------------------------ */

test('la carte d’un agent coupé en plein travail est rendue interrompue', () => {
  const c = carte({ scheduling: { asap: false, attempts: 1, restarts: 0, tourEnVolDepuis: Date.now() } });
  const agent = store.saveAgent({
    id: store.newId(),
    projectId: c.projectId,
    cardId: c.id,
    role: 'task',
    title: c.title,
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status: 'running',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as any);

  recoverAfterRestart();

  const apres = store.getCard(c.id)!;
  assert.equal(apres.column, 'planned');
  assert.equal(apres.scheduling?.waitingReason, RAISON_COUPE_EN_VOL);
  assert.equal(apres.scheduling?.tourEnVolDepuis, undefined, 'la marque est retirée');
  assert.equal(apres.scheduling?.restarts, 1);
  assert.equal(apres.scheduling?.attempts, 1, 'un redémarrage n’est pas un essai raté');
  assert.equal(store.getAgent(agent.id)?.status, 'idle');
});

test('la carte d’un agent DÉJÀ « terminé » est rattrapée elle aussi', () => {
  /*
   * Le trou d'origine : l'agent était passé en « terminé » avant que la carte
   * ne soit rangée. Plus personne ne le regardait, et la carte gardait la coche
   * verte du travail rendu sur un travail jamais fusionné.
   */
  const c = carte({ scheduling: { asap: false, attempts: 1, restarts: 0, tourEnVolDepuis: Date.now() } });
  store.saveAgent({
    id: store.newId(),
    projectId: c.projectId,
    cardId: c.id,
    role: 'task',
    title: c.title,
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status: 'done',
    endedAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as any);

  recoverAfterRestart();

  const apres = store.getCard(c.id)!;
  assert.notEqual(apres.column, 'done');
  assert.equal(apres.column, 'planned');
  assert.equal(apres.scheduling?.waitingReason, RAISON_COUPE_EN_VOL);

  // …et ce qui se voit sur le tableau : une carte en attente, jamais la coche
  // verte du travail rendu.
  assert.equal(
    etatVisuelCarte({ agentStatut: 'done', enAttente: !!apres.scheduling?.waitingReason }),
    'attente',
  );
});

test('une carte rendue et laissée ouverte n’est PAS reprise', () => {
  // Aucune marque : son tour avait fini de tout ranger. On n'y touche pas —
  // sinon l'ordonnanceur relancerait tout seul un travail déjà rendu.
  const c = carte({ column: 'done', scheduling: { asap: false, attempts: 1, restarts: 0 } });

  recoverAfterRestart();

  const apres = store.getCard(c.id)!;
  assert.equal(apres.column, 'done');
  assert.equal(apres.scheduling?.waitingReason, undefined);
  assert.equal(apres.scheduling?.restarts, 0);
});

test('une carte interrompue repart d’elle-même, sans nouveau geste', () => {
  const c = carte({ scheduling: { asap: false, attempts: 1, restarts: 0, tourEnVolDepuis: Date.now() } });

  recoverAfterRestart();

  const apres = store.getCard(c.id)!;
  assert.equal(apres.column, 'planned');
  assert.equal(demarrageAutomatiqueAutorise(apres.scheduling), true);
});

test('une carte interrompue et SUSPENDUE à la main attend le geste', () => {
  const c = carte({
    scheduling: { asap: false, attempts: 1, restarts: 0, suspendu: true, tourEnVolDepuis: Date.now() },
  });

  recoverAfterRestart();

  const apres = store.getCard(c.id)!;
  assert.equal(apres.column, 'planned');
  assert.equal(demarrageAutomatiqueAutorise(apres.scheduling), false);
});

test('le démon pose la marque au départ et l’efface à la clôture', async () => {
  // Les deux gestes vivent dans le démon : on vérifie qu'ils y sont, et qu'ils
  // encadrent bien le tour (posés au démarrage, retirés une fois la carte
  // rangée). Le reste est rejoué par les tests de règles ci-dessus.
  const ici = path.dirname(new URL(import.meta.url).pathname);
  const corps = fs.readFileSync(path.resolve(ici, '../../src/runtime.ts'), 'utf8');
  assert.match(corps, /tourEnVolDepuis: Date\.now\(\)/, 'la marque est posée au départ du tour');
  assert.match(corps, /tourEnVolDepuis: undefined/, 'et retirée quand le tour a fini de ranger');
  assert.match(corps, /store\.cartesEnVol\(\)/, 'le démarrage balaie toutes les cartes marquées');
});
