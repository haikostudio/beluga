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
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MOT_CONFIGURATION,
  RAISON_ATTEND_VOTRE_REPONSE,
  RAISON_RENDU_SANS_CODE,
  gesteDuParcours,
  colonneAuDemarrage,
  filDesRecherchesAffiche,
  issueDeFinDeTour,
  messageAttendUneReponse,
} from '@beluga/shared';

/** La racine du dépôt : le test lit l'écran là où il vit, pas dans `dist`. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/* ------------------------------------------------------------------ */
/* 1 et 2 — les phases                                                 */
/* ------------------------------------------------------------------ */

test('une tâche neuve s’ouvre sur sa CONFIGURATION, avant tout échange', () => {
  // Et rien n'est encore possible : il n'y a rien à cadrer, et le geste le dit.
  const geste = gesteDuParcours({ colonne: 'planned', roleAgent: 'cadrage', tourEnCours: false, messages: [] });
  assert.equal(geste.geste, 'valider-et-lancer');
  assert.equal(geste.possible, false);
  assert.ok(geste.raison);
  // La carte de configuration porte ses deux phrases, prêtes à traduire.
  assert.ok(MOT_CONFIGURATION.titre.length > 0);
  /* ET ELLE DIT LE BON MOMENT. Le choix se figeait « jusqu'au lancement » ;
     il se fige désormais à L'ENVOI DE LA DEMANDE, car la conversation d'une
     carte devient son parcours dès le premier message, et la configuration
     y reste modifiable jusqu'à la VALIDATION DE LA COMPRÉHENSION. Une phrase qui
     promettrait le lancement, ou le premier envoi, serait un mensonge. */
  assert.ok(MOT_CONFIGURATION.indice.includes('validation de la compréhension'));
  assert.ok(!MOT_CONFIGURATION.indice.includes('lancement'));
  assert.ok(!MOT_CONFIGURATION.indice.includes('envoi'));
});

test('dès le premier message, la conversation passe en DISCUSSION', () => {
  /* Le lancement n'est pas offert tant que rien n'est compris : on ne confie
     pas une branche à un agent complet sur une intention. Le geste principal
     est alors « Valider et lancer », et il dit ce qu'il attend. */
  const messages = [{ role: 'user', content: 'Un bouton' }, { role: 'assistant', content: 'Compris.' }];
  /* La compréhension se lit dans ce que la carte a ÉCRIT (l'outil
     `rendre_comprehension`), jamais dans une réponse en texte. */
  const compris = { plans: [], comprehension: { texte: 'compris', hypotheses: [], sujets: [], at: 1 } };
  const engage = { colonne: 'planned' as const, roleAgent: 'cadrage', tourEnCours: false, messages, parcours: compris };
  assert.equal(gesteDuParcours(engage).geste, 'valider-et-lancer');
  assert.equal(gesteDuParcours(engage).possible, true);
  assert.equal(gesteDuParcours({ ...engage, parcours: undefined }).possible, false);
  /* UN PLAN RENDU NE CHANGE PAS LE GESTE : il accompagne la compréhension du
     même tour, il n'est plus une étape validable à part. Le geste reste
     « Valider et lancer », dont le clic écrit la validation sur la carte
     (`parcours.comprehensionValidee`) PUIS lance — un seul geste. */
  const avecPlan = gesteDuParcours({
    ...engage,
    parcours: { ...compris, plans: [{ numero: 1, titre: 'P', resume: '', texte: '# P', at: 1 }] },
  });
  assert.equal(avecPlan.geste, 'valider-et-lancer');
  assert.equal(avecPlan.possible, true);
  /* LA DÉCISION PRISE NE SE REDEMANDE PAS : le geste devient « Lancer ». */
  const valide = gesteDuParcours({
    ...engage,
    parcours: { ...compris, comprehensionValidee: { at: 2, comprehensionAt: 1 } },
  });
  assert.equal(valide.geste, 'lancer');
  assert.equal(valide.possible, true);
});

/* ------------------------------------------------------------------ */
/* 3 — la carte reste « En cours » tant qu'elle vous attend             */
/* ------------------------------------------------------------------ */

test('une question sans réponse retient la carte en « En cours »', () => {
  const issue = issueDeFinDeTour('running', true, 'task', 'non', false, true);
  assert.equal(issue.colonne, null, 'la carte ne bouge pas');
  assert.equal(issue.raison, RAISON_ATTEND_VOTRE_REPONSE);
});

test('sans question ouverte, le rapport rendu ferme la carte — archivée s’il n’y a aucun code', () => {
  const issue = issueDeFinDeTour('running', true, 'task', 'non', false, false);
  assert.equal(issue.colonne, 'archived');
  assert.equal(issue.raison, RAISON_RENDU_SANS_CODE);
  // Le dépôt a bougé : clôture sans phrase, exactement comme avant.
  assert.deepEqual(issueDeFinDeTour('running', true, 'task', 'oui', false), { colonne: 'to_deploy', raison: null });
});

test('seule une question de l’agent RESTÉE SANS RÉPONSE compte', () => {
  assert.equal(messageAttendUneReponse({ questions: [{}] }), true);
  // Répondue, ou annulée à la main : plus rien n'est attendu.
  assert.equal(messageAttendUneReponse({ questions: [{ answer: 'oui' }] }), false);
  assert.equal(messageAttendUneReponse({ questions: [{ cancelled: true }] }), false);
  // Deux questions : une seule sans réponse suffit à retenir la carte.
  assert.equal(messageAttendUneReponse({ questions: [{ answer: 'oui' }, {}] }), true);
  // Un message ordinaire n'attend rien.
  assert.equal(messageAttendUneReponse({ questions: [] }), false);
  assert.equal(messageAttendUneReponse(undefined), false);
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

/* ------------------------------------------------------------------ */
/* 5 — le fil des recherches n'est pas de l'exécution                   */
/* ------------------------------------------------------------------ */

test('sur une carte, le fil des recherches de mémoire ne se pose jamais dans le fil', () => {
  assert.equal(filDesRecherchesAffiche({ surUneCarte: true }), false);
});

test('une conversation sans carte garde son carnet de bord', () => {
  assert.equal(filDesRecherchesAffiche({ surUneCarte: false }), true);
});

test('l’écran applique bien la règle, il ne la rejoue pas à sa façon', () => {
  const fil = fs.readFileSync(path.join(RACINE, 'web', 'src', 'components', 'chat.tsx'), 'utf8');
  assert.ok(fil.includes('filDesRecherchesAffiche({ surUneCarte: !!carte })'), 'le fil lit la règle partagée');
  assert.ok(fil.includes('filAgentMasque={filDesRecherchesMasque}'), 'et la passe à chaque message');

  const vue = fs.readFileSync(path.join(RACINE, 'web', 'src', 'components', 'message-view.tsx'), 'utf8');
  assert.ok(!vue.includes('filAgentAilleurs'), 'l’ancien nom, qui promettait un affichage ailleurs, a disparu');
  /* Deux endroits depuis que le découpage par étape du cadrage a disparu :
     sous une demande, et au-dessus d'une réponse sans bulle de demande. */
  assert.equal(
    (vue.match(/message\.sentContext && !filAgentMasque/g) ?? []).length,
    2,
    'les deux endroits qui posent le fil sont gardés par la même condition',
  );
});
