/**
 * LE RAPPORT QUI FERME UNE CARTE : LE PLANCHER, LA RELANCE UNIQUE, LES TÂCHES DE FOND.
 *
 * Ce que ces essais verrouillent : un message d'attente de deux paragraphes,
 * sans aucune section, n'est plus un compte rendu de carte — mais reste une
 * réponse acceptable pour un tour de suivi ; les commandes lancées en tâche de
 * fond et jamais relues sont nommées ; un tour arrêté, tombé ou en attente
 * d'une réponse n'est jamais relancé.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkTemplate,
  consigneDeRelanceDuRapport,
  idDeTacheDeFond,
  rapportAuPlancher,
  relanceDuRapport,
  tachesDeFondVivantes,
} from '@beluga/shared';

/** Le texte réellement rendu par la carte « Espace client : backups et accès libre ». */
const MESSAGE_D_ATTENTE = [
  "J'ai lancé la construction complète et les contrôles de l'espace client en tâche de fond ; ils prennent quelques minutes.",
  '',
  "J'attends leur résultat avant de rédiger le compte rendu, et je reviens dès qu'ils sont finis.",
].join('\n');

test('le compte rendu n’a plus de plafond : un long message tient sa forme (25/10/2026)', () => {
  assert.equal(checkTemplate('in_run', MESSAGE_D_ATTENTE, 'complete', { plancher: true }).ok, true);
  const long = 'Une phrase de compte rendu complète. '.repeat(40);
  assert.equal(checkTemplate('in_run', long, 'complete', { plancher: true }).ok, true);
  assert.equal(checkTemplate('free', long, 'breve').ok, true, 'l’assistant général aussi');
});

test('le plancher ne vise que l’exécution d’une carte, à ampleur imposée', () => {
  assert.equal(rapportAuPlancher({ role: 'task', porteUneCarte: true, kind: 'in_run', ampleurImposee: 'complete' }), true);
  assert.equal(rapportAuPlancher({ role: 'task', porteUneCarte: true, kind: 'in_run' }), false);
  assert.equal(rapportAuPlancher({ role: 'chat', porteUneCarte: false, kind: 'free', ampleurImposee: 'complete' }), false);
  assert.equal(rapportAuPlancher({ role: 'cadrage', porteUneCarte: true, kind: 'none', ampleurImposee: 'complete' }), false);
});

test('une commande lancée en tâche de fond et jamais relue reste vivante', () => {
  const vivantes = tachesDeFondVivantes([
    {
      cle: 'a',
      outil: 'Bash',
      entree: { command: 'npm run build && npm test', run_in_background: true },
      resultat: 'Command running in background with ID: b7f3a1. Output is being written to: /tmp/x',
      etat: 'done',
    },
    { cle: 'b', outil: 'Bash', entree: { command: 'ls' }, resultat: 'a b', etat: 'done' },
  ]);
  assert.equal(vivantes.length, 1);
  assert.equal(vivantes[0]!.id, 'b7f3a1');
  assert.equal(vivantes[0]!.commande, 'npm run build && npm test');
});

test('une tâche relue jusqu’au bout, ou coupée, n’est plus vivante', () => {
  const lancement = (cle: string, id: string) => ({
    cle,
    outil: 'Bash',
    entree: { command: `essai ${id}`, run_in_background: true },
    resultat: `Command running in background with ID: ${id}`,
    etat: 'done',
  });
  const vivantes = tachesDeFondVivantes([
    lancement('a', 'b1'),
    lancement('b', 'b2'),
    lancement('c', 'b3'),
    { cle: 'd', outil: 'BashOutput', entree: { bash_id: 'b1' }, resultat: '<status>completed</status><exit_code>0</exit_code>' },
    { cle: 'e', outil: 'KillShell', entree: { shell_id: 'b2' }, etat: 'done' },
    // Une lecture en cours de route ne ferme rien.
    { cle: 'f', outil: 'TaskOutput', entree: { task_id: 'b3' }, resultat: '<status>running</status>' },
  ]);
  assert.deepEqual(vivantes.map((t) => t.id), ['b3']);
});

test('un lancement refusé n’a rien laissé tourner', () => {
  assert.deepEqual(
    tachesDeFondVivantes([{ cle: 'a', outil: 'Bash', entree: { command: 'x', run_in_background: true }, etat: 'failed' }]),
    [],
  );
  assert.equal(idDeTacheDeFond('rien à lire'), undefined);
});

test('une seule relance, et jamais pour un tour arrêté, tombé ou en attente de réponse', () => {
  const base = { plancher: true, formeTenue: false, texte: MESSAGE_D_ATTENTE, echec: false, arrete: false };
  assert.equal(relanceDuRapport(base), true);
  assert.equal(relanceDuRapport({ ...base, formeTenue: true }), false);
  assert.equal(relanceDuRapport({ ...base, plancher: false }), false);
  assert.equal(relanceDuRapport({ ...base, plancher: false }), false, 'un message n’est plus relancé pour sa longueur');
  assert.equal(relanceDuRapport({ ...base, formeTenue: true, tachesVivantes: 1 }), true, 'le message d’attente attend ses tâches de fond');
  assert.equal(relanceDuRapport({ ...base, formeTenue: true, plancher: false, tachesVivantes: 1 }), false);
  assert.equal(relanceDuRapport({ ...base, echec: true }), false);
  assert.equal(relanceDuRapport({ ...base, arrete: true }), false);
  assert.equal(relanceDuRapport({ ...base, questionPosee: true }), false);
  assert.equal(relanceDuRapport({ ...base, texte: '  ' }), false);
});

test('la consigne de relance nomme les tâches de fond', () => {
  const consigne = consigneDeRelanceDuRapport({
    taches: [{ cle: 'a', outil: 'Bash', id: 'b7f3a1', commande: 'npm test' }],
  });
  assert.match(consigne, /npm test \(ID b7f3a1\)/);
  assert.match(consigne, /Attends leur résultat/);
  assert.doesNotMatch(consigne, /600 signes/);
});
