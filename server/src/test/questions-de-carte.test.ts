import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  NON_SUPPOSITION,
  OUI_SUPPOSITION,
  RAISONS_DU_GESTE,
  RAISON_QUESTIONS_DE_CARTE,
  carteLibreDePartirSeule,
  convertirLesSuppositions,
  demandeDeRepriseApresLesReponses,
  gesteDuParcours,
  lignesDesReponses,
  lireComprehensionRendue,
  prochaineQuestionDeCarte,
  questionDepuisSupposition,
  questionsSansReponse,
  repondreALaQuestionDeCarte,
  tourDeCadrageSansQuestion,
} from '@beluga/shared';

/* Une base jetable : la réponse, l'alerte et le lancement passent par le VRAI démon. */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'questions-de-carte-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const { createCard } = await import('../tools.js');
const { decisionOuverteSurLaCarte, validerLaComprehension } = await import('../scheduler.js');
const { convertirLesSuppositionsDesCartes, repondreALaQuestionDeLaCarte } = await import('../questions-de-carte.js');

const TECHNIQUE = { taches: [{ titre: 'Poser', description: 'Dans les réglages.' }], faits: ['Aucun.'], risques: 'Le tri.' };
const BASE = { texte: 'Un tri.', resumeDemande: 'Trier la liste.', resumeComprehension: 'Un tri par date.', partieTechnique: TECHNIQUE };
const QUESTION = {
  question: 'Dans quel ordre trier la liste ?',
  description: 'Le plus récent en haut, ou le plus ancien.',
  options: [{ label: 'Le plus récent en haut' }, { label: 'Le plus ancien en haut' }],
  recommandee: 'Le plus récent en haut',
};

test('« questions » se lit avec ses choix et sa réponse conseillée ; il manque quelque chose, le refus le dit', () => {
  const lue = lireComprehensionRendue({ ...BASE, questions: [QUESTION, { question: 'Un nom ?', kind: 'text', recommandee: 'Tri' }] });
  assert.ok(lue.ok);
  assert.deepEqual(
    lue.valeur.questions.map((q) => [q.id, q.kind, q.options.map((o) => o.id), q.recommandee]),
    [
      ['q1', 'single', ['o0', 'o1'], 'Le plus récent en haut'],
      ['q2', 'text', [], 'Tri'],
    ],
  );
  const sansConseil = lireComprehensionRendue({ ...BASE, questions: [{ ...QUESTION, recommandee: '' }] });
  assert.ok(!sansConseil.ok && /recommandee/.test(sansConseil.raison));
  const unSeulChoix = lireComprehensionRendue({ ...BASE, questions: [{ ...QUESTION, options: [{ label: 'Seul' }] }] });
  assert.ok(!unSeulChoix.ok && /deux choix au moins/.test(unSeulChoix.raison));
  const trop = lireComprehensionRendue({ ...BASE, questions: Array.from({ length: 9 }, () => QUESTION) });
  assert.ok(!trop.ok && /8 au plus/.test(trop.raison));
});

test('une question à la fois, une réponse une seule fois', () => {
  const comprise = { questionsEnAttente: [questionDepuisSupposition('Je suppose que la liste se trie par date.', 0), questionDepuisSupposition('x', 1)] };
  assert.equal(prochaineQuestionDeCarte(comprise)?.id, 's1');
  assert.equal(comprise.questionsEnAttente[0].question, 'La liste se trie par date ?');
  const apres = repondreALaQuestionDeCarte(comprise, 's1', ' Oui ', 7)!;
  assert.deepEqual([apres[0].reponse, apres[0].reponduA], ['Oui', 7]);
  assert.equal(prochaineQuestionDeCarte({ questionsEnAttente: apres })?.id, 's2');
  /* Déjà répondue, inconnue, ou réponse vide : rien ne s'écrit. */
  assert.equal(repondreALaQuestionDeCarte({ questionsEnAttente: apres }, 's1', 'Non'), undefined);
  assert.equal(repondreALaQuestionDeCarte({ questionsEnAttente: apres }, 'zz', 'Non'), undefined);
  assert.equal(repondreALaQuestionDeCarte({ questionsEnAttente: apres }, 's2', '  '), undefined);
  assert.deepEqual(lignesDesReponses({ questionsEnAttente: apres }), ['- La liste se trie par date ? → Oui']);
});

test('la conversion change chaque supposition en question, et une validée arrive répondue', () => {
  const avant: Parameters<typeof convertirLesSuppositions>[0] & { texte: string; at: number } = {
    texte: 't',
    hypotheses: ['Je suppose que A.', 'Je suppose que B.'],
    hypothesesValidees: ['Je suppose que B.'],
    at: 3,
  };
  const convertie = convertirLesSuppositions(avant, 9)!;
  assert.deepEqual(convertie.hypotheses, []);
  assert.equal(convertie.hypothesesValidees, undefined);
  assert.deepEqual(
    convertie.questionsEnAttente?.map((q) => [q.question, q.reponse, q.recommandee, q.options.map((o) => o.label)]),
    [
      ['A ?', undefined, OUI_SUPPOSITION, [OUI_SUPPOSITION, NON_SUPPOSITION]],
      ['B ?', OUI_SUPPOSITION, OUI_SUPPOSITION, [OUI_SUPPOSITION, NON_SUPPOSITION]],
    ],
  );
  assert.equal(convertirLesSuppositions({ texte: 't', hypotheses: [], at: 1 }), null);
});

test('la demande de reprise porte les décisions, et laisse le cadrage questionner', () => {
  const demande = demandeDeRepriseApresLesReponses({
    questionsEnAttente: [{ ...questionDepuisSupposition('Je suppose que A.', 0), reponse: 'Non : B' }],
  });
  assert.match(demande, /A \? → Non : B/);
  assert.match(demande, /« hypotheses » et « questions » vides/);
  /* L'utilisateur vient d'être là : ce tour n'est PAS un cadrage sans témoin. */
  assert.equal(tourDeCadrageSansQuestion(demande), false);
});

test('une question sans réponse éteint le lancement, dit pourquoi, et retient le départ programmé', () => {
  const enAttente = { texte: 'compris', hypotheses: [], sujets: [], at: 1, questionsEnAttente: [questionDepuisSupposition('A', 0)] };
  const cadrage = {
    colonne: 'planned' as const,
    roleAgent: 'cadrage',
    tourEnCours: false,
    messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }],
  };
  const eteint = gesteDuParcours({ ...cadrage, parcours: { plans: [], comprehension: enAttente } });
  assert.deepEqual([eteint.geste, eteint.possible, eteint.raison], ['valider-et-lancer', false, RAISONS_DU_GESTE.questionsDeCarte]);
  /* Même validée, la carte ne repart pas avant la réponse. */
  const validee = gesteDuParcours({ ...cadrage, parcours: { plans: [], comprehension: enAttente, comprehensionValidee: { at: 2, comprehensionAt: 1 } } });
  assert.deepEqual([validee.geste, validee.possible], ['lancer', false]);
  const programmee = { column: 'planned', scheduling: { asap: true }, parcours: { plans: [], comprehension: enAttente, comprehensionValidee: { at: 2, comprehensionAt: 1 } } };
  assert.equal(carteLibreDePartirSeule(programmee, false), false);
  const repondue = { ...enAttente, questionsEnAttente: [{ ...enAttente.questionsEnAttente[0], reponse: 'Oui' }] };
  assert.equal(carteLibreDePartirSeule({ ...programmee, parcours: { ...programmee.parcours, comprehension: repondue } }, false), true);
  assert.equal(questionsSansReponse(repondue).length, 0);
});

test('le démon : alerte, lancement refusé, réponse écrite, conversion des cartes d’avant', async () => {
  const projet = store.saveProject({ id: store.newId(), name: 'Questions', path: bacASable, createdAt: store.now(), updatedAt: store.now() } as any);
  const carte = createCard(projet.id, { title: 'Trier la liste', origin: 'user' });
  const agent = store.saveAgent({
    id: store.newId(),
    projectId: projet.id,
    cardId: carte.id,
    role: 'cadrage',
    title: 'Cadrage',
    run: { engine: 'claude' },
    status: 'idle',
    createdAt: store.now(),
    updatedAt: store.now(),
    endedAt: store.now(),
  } as any);
  store.saveCard({
    ...store.getCard(carte.id)!,
    agentId: agent.id,
    parcours: {
      plans: [],
      comprehension: { texte: 'Un tri.', hypotheses: ['Je suppose que le tri est par date.'], hypothesesValidees: [], sujets: [], at: 5 },
    },
  });
  assert.equal(convertirLesSuppositionsDesCartes(), 1);
  assert.equal(convertirLesSuppositionsDesCartes(), 0, 'rejouée, la conversion ne touche plus rien');
  const convertie = store.getCard(carte.id)!.parcours!.comprehension!;
  assert.deepEqual(convertie.hypotheses, []);
  assert.equal(convertie.questionsEnAttente?.[0].question, 'Le tri est par date ?');

  /* LE TRIANGLE ET LA CLOCHE : une question, même avant toute ouverture de la carte. */
  const alerte = store.decisionsEnAttente().find((d) => d.cardId === carte.id);
  assert.deepEqual([alerte?.genre, alerte?.source, alerte?.texte], ['question', 'question-de-carte', 'Le tri est par date ?']);

  /* AUCUN CHEMIN DE LANCEMENT : ni la validation, ni le départ. */
  assert.equal(validerLaComprehension(carte.id).error, RAISON_QUESTIONS_DE_CARTE);
  assert.match(decisionOuverteSurLaCarte(carte.id) ?? '', /répondez d’abord aux questions/);

  /* LA RÉPONSE s'écrit sur la carte et éteint l'alerte. */
  const reprises: [string, string][] = [];
  const reprendre = async (agentId: string, demande: string) => void reprises.push([agentId, demande]);
  const ecrite = await repondreALaQuestionDeLaCarte(carte.id, convertie.questionsEnAttente![0].id, 'Non, par nom', reprendre);
  /* LA DERNIÈRE RÉPONSE relance le cadrage, avec les décisions. */
  assert.equal(reprises.length, 1);
  assert.equal(reprises[0][0], agent.id);
  assert.match(reprises[0][1], /Le tri est par date \? → Non, par nom/);
  assert.equal(ecrite.parcours?.comprehension?.questionsEnAttente?.[0].reponse, 'Non, par nom');
  assert.equal(store.decisionsEnAttente().some((d) => d.cardId === carte.id && d.source === 'question-de-carte'), false);
  assert.equal(decisionOuverteSurLaCarte(carte.id), null);
  await assert.rejects(repondreALaQuestionDeLaCarte(carte.id, convertie.questionsEnAttente![0].id, 'Encore', reprendre), /n’attend plus/);
  assert.equal(reprises.length, 1);
});
