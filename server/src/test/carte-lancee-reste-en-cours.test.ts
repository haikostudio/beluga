import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Agent,
  Card,
  CARTE_INCHANGEE,
  RAISON_TOUR_SANS_ISSUE,
  issueDeCarteOubliee,
} from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* UNE CARTE QUI VIENT D'ÊTRE LANCÉE RESTE EN « EN COURS ».            */
/*                                                                     */
/* Le bogue rapporté : des cartes à peine lancées sautaient la colonne  */
/* « En cours » — elles s'affichaient aussitôt en « Terminée », puis    */
/* en « À déployer » quand l'interrupteur de déploiement automatique    */
/* était allumé — alors qu'aucun agent n'avait encore écrit une ligne.  */
/*                                                                     */
/* La cause : le clic pose la carte en « En cours » AVANT l'ouverture   */
/* de sa copie de travail (`git worktree add`, plusieurs minutes sur un */
/* gros dépôt). Pendant cette fenêtre, aucun agent n'existe et aucune   */
/* marque de vol n'est posée — `tourEnVolDepuis` ne l'était qu'à        */
/* l'envoi de la demande, tout au bout de la préparation. Le balayage   */
/* des cartes oubliées, qui repasse toutes les quinze secondes, voyait  */
/* donc une carte « en cours » que plus rien ne tenait et la fermait.   */
/*                                                                     */
/* Deux verrous, rejoués ici : la règle pure refuse de fermer une carte */
/* dont le lancement se prépare ou dont la demande attend en file, et   */
/* le lancement pose sa marque de vol dans le même geste que la         */
/* colonne.                                                            */
/* ------------------------------------------------------------------ */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SCHEDULER = path.resolve(ICI, '../../../server/src/scheduler.ts');

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'carte-lancee-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const { rangerLesCartesOubliees } = await import('../deplacement-carte.js');
const { marquerLancementEnRoute, oublierLancementEnRoute, lancementEnRoute } = await import(
  '../lancements-en-route.js'
);

const PROJET = 'projet-essai';

/** L'état d'une carte tout juste lancée : rien ne la tient encore. */
const FRAICHEMENT_LANCEE = {
  colonne: 'running' as const,
  agentAuTravail: false,
  dernierTourEnEchec: false,
  dejaEnregistre: false,
};

/* -------- La règle pure -------- */

test('une carte dont le lancement se prépare n’est pas une carte oubliée', () => {
  assert.deepEqual(
    issueDeCarteOubliee({ ...FRAICHEMENT_LANCEE, lancementEnPreparation: true }, Date.now()),
    CARTE_INCHANGEE,
  );
});

test('une carte dont la demande attend en file n’est pas une carte oubliée', () => {
  assert.deepEqual(
    issueDeCarteOubliee({ ...FRAICHEMENT_LANCEE, demandeEnFile: true }, Date.now()),
    CARTE_INCHANGEE,
  );
});

test('…mais une carte que plus rien ne tient reste bien fermée', () => {
  const issue = issueDeCarteOubliee(FRAICHEMENT_LANCEE, Date.now());
  assert.equal(issue.colonne, 'to_deploy');
  assert.equal(issue.raison, RAISON_TOUR_SANS_ISSUE);
});

/* -------- Le VRAI balayage du démon -------- */

/** Une carte en « En cours » sans agent ni marque : l'état de la fenêtre. */
function poserCarteEnLancement(id: string, avecAgent = false): Card {
  const maintenant = Date.now();
  if (avecAgent) {
    store.saveAgent(
      Agent.parse({
        id: `agent-${id}`,
        projectId: PROJET,
        cardId: id,
        role: 'task',
        title: `Agent de ${id}`,
        run: { engine: 'claude', thinking: 'none', mode: 'direct' },
        status: 'idle',
        createdAt: maintenant,
        updatedAt: maintenant,
      }),
    );
  }
  return store.saveCard(
    Card.parse({
      id,
      projectId: PROJET,
      title: `Carte ${id}`,
      column: 'running',
      position: 1,
      ...(avecAgent ? { agentId: `agent-${id}` } : {}),
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      scheduling: { asap: false, attempts: 1, restarts: 0 },
      createdAt: maintenant,
      updatedAt: maintenant,
    }),
  );
}

test('le balayage laisse tranquille une carte dont le lancement est en route', () => {
  poserCarteEnLancement('c-en-lancement');
  marquerLancementEnRoute('c-en-lancement');
  try {
    rangerLesCartesOubliees();
    assert.equal(store.getCard('c-en-lancement')?.column, 'running');
    assert.equal(store.getCard('c-en-lancement')?.sansModification, undefined);
  } finally {
    oublierLancementEnRoute('c-en-lancement');
  }
  // Le lancement fini, la carte redevient rangeable : le refus n'est pas éternel.
  assert.equal(lancementEnRoute('c-en-lancement'), false);
  rangerLesCartesOubliees();
  assert.equal(store.getCard('c-en-lancement')?.column, 'to_deploy');
});

test('le balayage laisse tranquille une carte dont la demande attend en file', () => {
  poserCarteEnLancement('c-en-file', true);
  store.enqueuePrompt('agent-c-en-file', 'la demande qui attend son tour');

  rangerLesCartesOubliees();
  assert.equal(store.getCard('c-en-file')?.column, 'running');

  // La file dépilée, plus rien ne retient la carte.
  store.dequeuePrompt('agent-c-en-file');
  rangerLesCartesOubliees();
  assert.equal(store.getCard('c-en-file')?.column, 'to_deploy');
});

/* -------- Le lancement pose sa marque dans le même geste -------- */

test('le passage en « En cours » au clic pose la marque de vol', () => {
  const source = fs.readFileSync(SCHEDULER, 'utf8');
  const debut = source.indexOf('const colonneAvant = card.column;');
  assert.ok(debut > 0, 'le déplacement au clic doit rester dans `lancerLaCarte`');
  const geste = source.slice(debut, debut + 1600);
  assert.match(geste, /column: 'running'/);
  assert.match(geste, /tourEnVolDepuis: card\.scheduling\?\.tourEnVolDepuis \?\? Date\.now\(\)/);
});

test('un lancement refusé retire la marque qu’il avait posée', () => {
  const source = fs.readFileSync(SCHEDULER, 'utf8');
  const debut = source.indexOf('function refus(');
  const corps = source.slice(debut, source.indexOf('return { ok: false, error: raison };', debut));
  assert.match(corps, /aRamener \? \{ tourEnVolDepuis: undefined \}/);
});
