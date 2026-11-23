import assert from 'node:assert/strict';
import test from 'node:test';
import {
  agentAuTravail,
  choixDeQuestionEnTexte,
  decisionEnTexteLibre,
  LONGUEUR_CHOIX_MAX,
  questionEnTexteLibre,
  type MessageAJuger,
} from '@beluga/shared';

/** Le message réel qui a laissé la carte INVIA en plan, raccourci. */
const INVIA: MessageAJuger = {
  role: 'assistant',
  content:
    'Je vais d’abord vérifier les consignes du projet, puis ouvrir le mode d’emploi de comptabilité.\n\n' +
    'Quelle formule dois-je inscrire dans l’offre : **Essentielle — 20 h, 2 600 CHF/an** ou ' +
    '**Sérénité — 30 h, 3 900 CHF/an** (recommandée dans le chiffrage) ?',
};

/* ------------------------------------------------------------------ */
/* Ce qui compte comme question                                         */
/* ------------------------------------------------------------------ */

test('une question écrite en texte libre en fin de réponse est reconnue', () => {
  const question = questionEnTexteLibre(INVIA);
  assert.ok(question);
  assert.match(question, /^Quelle formule/);
  // Les marques de gras ne doivent pas rester dans la phrase affichée.
  assert.doesNotMatch(question, /\*/);
});

test('la question rendue est la DERNIÈRE phrase, pas tout le message', () => {
  const question = questionEnTexteLibre(INVIA);
  assert.doesNotMatch(question ?? '', /consignes du projet/);
});

test('une réponse qui ne se termine pas par une question ne compte pas', () => {
  assert.equal(
    questionEnTexteLibre({ role: 'assistant', content: 'L’offre est créée et enregistrée.' }),
    null,
  );
});

test('une question au milieu du texte, suivie d’une conclusion, ne compte pas', () => {
  const message: MessageAJuger = {
    role: 'assistant',
    content: 'Fallait-il partir de l’audit ?\n\nJ’ai retenu l’audit et terminé le travail.',
  };
  assert.equal(questionEnTexteLibre(message), null);
});

/* ------------------------------------------------------------------ */
/* Ce qu'on écarte : la décision est déjà comptée ailleurs              */
/* ------------------------------------------------------------------ */

test('un message qui porte une question de l’outil n’est pas compté deux fois', () => {
  assert.equal(questionEnTexteLibre({ ...INVIA, questions: [{}] }), null);
});

test('un message qui porte une proposition de carte n’est pas compté deux fois', () => {
  assert.equal(questionEnTexteLibre({ ...INVIA, proposals: [{}] }), null);
});

test('un message encore en cours d’écriture ne se juge pas', () => {
  assert.equal(questionEnTexteLibre({ ...INVIA, streaming: true }), null);
});

test('un message de l’utilisateur ne pose pas de décision', () => {
  assert.equal(questionEnTexteLibre({ ...INVIA, role: 'user' }), null);
});

test('le bouton « Annuler » du repère éteint la question, sans relancer l’agent', () => {
  assert.equal(questionEnTexteLibre({ ...INVIA, texteLibreAnnulee: true }), null);
  assert.ok(questionEnTexteLibre({ ...INVIA, texteLibreAnnulee: false }));
});

/* ------------------------------------------------------------------ */
/* Ce qu'on écarte : ce n'est pas un arbitrage                          */
/* ------------------------------------------------------------------ */

test('une question trop courte est du bavardage, pas un arbitrage', () => {
  assert.equal(questionEnTexteLibre({ role: 'assistant', content: 'On continue ?' }), null);
});

test('une question rhétorique de l’agent ne réclame rien', () => {
  assert.equal(
    questionEnTexteLibre({
      role: 'assistant',
      content: 'Le dépôt est propre.\n\nQue faire ensuite dans ce genre de situation ?',
    }),
    null,
  );
});

test('un bloc de code qui contient un point d’interrogation n’en fait pas une question', () => {
  const message: MessageAJuger = {
    role: 'assistant',
    content: 'Le correctif est en place :\n\n```\nconst valeur = choix ?? defaut ?\n```',
  };
  assert.equal(questionEnTexteLibre(message), null);
});

/* ------------------------------------------------------------------ */
/* Le tour doit être ACHEVÉ                                             */
/* ------------------------------------------------------------------ */

test('un agent qui travaille encore n’allume aucun triangle', () => {
  assert.equal(decisionEnTexteLibre({ statut: 'running', dernierMessage: INVIA }), null);
  assert.equal(decisionEnTexteLibre({ statut: 'starting', dernierMessage: INVIA }), null);
});

test('un tour achevé sur la question allume le triangle', () => {
  assert.ok(decisionEnTexteLibre({ statut: 'done', dernierMessage: INVIA }));
  assert.ok(decisionEnTexteLibre({ statut: 'stopped', dernierMessage: INVIA }));
});

test('sans dernier message, rien à trancher', () => {
  assert.equal(decisionEnTexteLibre({ statut: 'done' }), null);
});

test('seuls « starting » et « running » comptent comme travail en cours', () => {
  assert.equal(agentAuTravail('running'), true);
  assert.equal(agentAuTravail('starting'), true);
  assert.equal(agentAuTravail('done'), false);
  assert.equal(agentAuTravail(undefined), false);
});

/* ------------------------------------------------------------------ */
/* LES CHOIX LUS DANS UNE QUESTION ÉCRITE EN TEXTE ORDINAIRE           */

test('les deux formules énumérées après un deux-points font deux pastilles', () => {
  assert.deepEqual(choixDeQuestionEnTexte(INVIA.content), [
    'Essentielle — 20 h, 2 600 CHF/an',
    'Sérénité — 30 h, 3 900 CHF/an (recommandée dans le chiffrage)',
  ]);
});

test('la liste posée juste sous la question donne les choix', () => {
  const choix = choixDeQuestionEnTexte(
    'Il reste un arbitrage à faire.\n\nQuel chemin dois-je suivre pour la suite ?\n' +
      '- Refaire le calcul depuis la base\n' +
      '- Garder l’ancien résultat\n' +
      '- Ne rien changer pour l’instant\n',
  );
  assert.deepEqual(choix, [
    'Refaire le calcul depuis la base',
    'Garder l’ancien résultat',
    'Ne rien changer pour l’instant',
  ]);
});

test('la liste posée juste au-dessus de la question sert aussi', () => {
  const choix = choixDeQuestionEnTexte(
    'Deux options se présentent.\n\n' +
      '1. Publier tout de suite\n' +
      '2. Attendre la relecture\n\n' +
      'Laquelle de ces deux options faut-il retenir ?',
  );
  assert.deepEqual(choix, ['Publier tout de suite', 'Attendre la relecture']);
});

test('une question sans énumération ne s’invente aucun choix', () => {
  assert.deepEqual(
    choixDeQuestionEnTexte('Veux-tu que je continue ou que j’arrête tout de suite ?'),
    [],
  );
  assert.deepEqual(choixDeQuestionEnTexte('Quel nom faut-il donner à ce projet ?'), []);
});

test('un seul élément ne fait pas un choix', () => {
  assert.deepEqual(
    choixDeQuestionEnTexte('Quelle suite donner à ceci ?\n- Continuer\n'),
    [],
  );
});

test('une liste trop longue reste du texte à lire', () => {
  const liste = Array.from({ length: 9 }, (_, i) => `- Option ${i + 1}`).join('\n');
  assert.deepEqual(choixDeQuestionEnTexte(`Laquelle de ces options faut-il retenir ?\n${liste}`), []);
});

test('un choix démesuré est écarté, pas tronqué', () => {
  const long = 'x'.repeat(LONGUEUR_CHOIX_MAX + 1);
  assert.deepEqual(
    choixDeQuestionEnTexte(`Quel chemin dois-je suivre ici ?\n- ${long}\n- Court\n`),
    [],
  );
});

test('deux choix identiques ne font qu’une pastille, donc plus de choix du tout', () => {
  assert.deepEqual(
    choixDeQuestionEnTexte('Quel chemin dois-je suivre ici ?\n- Garder\n- garder\n'),
    [],
  );
});

test('un texte sans question ne rend aucun choix', () => {
  assert.deepEqual(choixDeQuestionEnTexte('Le travail est terminé.\n- Un\n- Deux\n'), []);
});

test('un bloc de code n’est pas une liste de choix', () => {
  assert.deepEqual(
    choixDeQuestionEnTexte('Quel chemin dois-je suivre ici ?\n```\n- un\n- deux\n```\n'),
    [],
  );
});
