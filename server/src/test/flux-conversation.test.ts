/**
 * LE FLUX D'UNE CONVERSATION DE CARTE, DE BOUT EN BOUT.
 *
 * Quatre règles, toutes pures, toutes rejouables sans base ni moteur :
 *
 *  1. une tâche neuve commence par sa CONFIGURATION, pas par la discussion ;
 *  2. la discussion prend la suite dès le premier message ;
 *  3. une fin de tour qui laisse une QUESTION SANS RÉPONSE ne range pas la
 *     carte dans « À déployer » : elle reste « En cours » et le dit ;
 *  4. un MESSAGE ÉCRIT PAR L'UTILISATEUR dans une carte déjà rangée
 *     « À déployer » la ramène « En cours » — un geste automatique, non.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MOT_CONFIGURATION,
  RAISON_ATTEND_VOTRE_REPONSE,
  RAISON_RENDU_SANS_CODE,
  boutonLancerLaTache,
  carteAttendUneQuestion,
  colonneAuDemarrage,
  issueDeFinDeTour,
  phaseDeCarte,
  type DecisionAttendue,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* 1 et 2 — les phases                                                 */
/* ------------------------------------------------------------------ */

test('une tâche neuve s’ouvre sur sa CONFIGURATION, avant tout échange', () => {
  assert.equal(phaseDeCarte({ colonne: 'planned', roleAgent: 'cadrage', messages: 0 }), 'configuration');
  // Et rien n'est encore proposé au lancement : il n'y a rien à lancer.
  assert.equal(
    boutonLancerLaTache({ colonne: 'planned', roleAgent: 'cadrage', agentAuTravail: false, messages: 0 }).affiche,
    false,
  );
  // La carte de configuration porte ses deux phrases, prêtes à traduire.
  assert.ok(MOT_CONFIGURATION.titre.length > 0);
  assert.ok(MOT_CONFIGURATION.indice.includes('lancement'));
});

test('dès le premier message, la conversation passe en DISCUSSION', () => {
  assert.equal(phaseDeCarte({ colonne: 'planned', roleAgent: 'cadrage', messages: 1 }), 'discussion');
  assert.equal(
    boutonLancerLaTache({ colonne: 'planned', roleAgent: 'cadrage', agentAuTravail: false, messages: 1 }).possible,
    true,
  );
});

test('une carte lancée n’a plus rien à configurer : elle TRAVAILLE', () => {
  assert.equal(phaseDeCarte({ colonne: 'running', roleAgent: 'task', messages: 4 }), 'travail');
  // Même en « Planifié », un agent d'exécution n'est plus un cadrage.
  assert.equal(phaseDeCarte({ colonne: 'planned', roleAgent: 'task', messages: 0 }), 'travail');
  // Une carte de cadrage rangée ne repasse jamais en configuration.
  assert.equal(phaseDeCarte({ colonne: 'to_deploy', roleAgent: 'cadrage', messages: 0 }), 'travail');
});

/* ------------------------------------------------------------------ */
/* 3 — la carte reste « En cours » tant qu'elle vous attend             */
/* ------------------------------------------------------------------ */

const question = (cardId: string, reglee = false): DecisionAttendue => ({
  projectId: 'p1',
  cardId,
  genre: 'question',
  reglee,
  poseeA: 1,
});

test('une question sans réponse retient la carte en « En cours »', () => {
  const issue = issueDeFinDeTour('running', true, 'task', 'non', false, true);
  assert.equal(issue.colonne, null, 'la carte ne bouge pas');
  assert.equal(issue.raison, RAISON_ATTEND_VOTRE_REPONSE);
});

test('sans question ouverte, le rapport rendu ferme la carte comme avant', () => {
  const issue = issueDeFinDeTour('running', true, 'task', 'non', false, false);
  assert.equal(issue.colonne, 'to_deploy');
  assert.equal(issue.raison, RAISON_RENDU_SANS_CODE);
  // Le dépôt a bougé : clôture sans phrase, exactement comme avant.
  assert.deepEqual(issueDeFinDeTour('running', true, 'task', 'oui', false), { colonne: 'to_deploy', raison: null });
});

test('seule une QUESTION retient la carte — une carte proposée, non', () => {
  const decisions: DecisionAttendue[] = [question('c1')];
  assert.equal(carteAttendUneQuestion(decisions, 'c1'), true);
  assert.equal(carteAttendUneQuestion(decisions, 'c2'), false);
  // Répondue : plus rien n'est attendu.
  assert.equal(carteAttendUneQuestion([question('c1', true)], 'c1'), false);
  // Une validation de carte proposée n'est pas une question sur ce travail.
  assert.equal(
    carteAttendUneQuestion([{ projectId: 'p1', cardId: 'c1', genre: 'validation', reglee: false }], 'c1'),
    false,
  );
});

/* ------------------------------------------------------------------ */
/* 4 — relancer la discussion remet la carte au travail                 */
/* ------------------------------------------------------------------ */

test('un message de l’utilisateur ressort la carte de « À déployer »', () => {
  assert.equal(colonneAuDemarrage('to_deploy', 'task', 'humain'), 'running');
});

test('…mais aucun chemin AUTOMATIQUE ne l’en ressort', () => {
  assert.equal(colonneAuDemarrage('to_deploy', 'task'), null);
  assert.equal(colonneAuDemarrage('to_deploy', 'task', 'automatique'), null);
});

test('« Archivé » reste fermé, même à un message écrit à la main', () => {
  assert.equal(colonneAuDemarrage('archived', 'task', 'humain'), null);
});

test('un rôle qui n’exécute pas ne déplace toujours rien', () => {
  assert.equal(colonneAuDemarrage('to_deploy', 'cadrage', 'humain'), null);
  assert.equal(colonneAuDemarrage('planned', 'deploy', 'humain'), null);
});

test('une carte en « Planifié » relancée part « En cours », quel que soit le geste', () => {
  assert.equal(colonneAuDemarrage('planned', 'task'), 'running');
  assert.equal(colonneAuDemarrage('planned', 'task', 'humain'), 'running');
  assert.equal(colonneAuDemarrage('running', 'task', 'humain'), null);
});
