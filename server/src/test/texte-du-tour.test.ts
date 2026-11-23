import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JALON_NOTE_DE_L_AGENT,
  genreDAction,
  noteAvantLAction,
  recitDuPoint,
  texteRenduDuTour,
  vueDeLEntree,
  type EntreeJournal,
} from '@beluga/shared';

/* Le tour de la capture #47ac : deux phrases de passage, puis la vraie réponse. */
const TOUR = [
  'Je vérifie le démon.',
  'Première cause trouvée : le texte est recollé.',
  'Réponse : les phrases de passage vont dans « Réflexions ».',
];

test('la réponse est ce qui suit la dernière action, pas le texte entier', () => {
  assert.equal(texteRenduDuTour(TOUR), 'Réponse : les phrases de passage vont dans « Réflexions ».');
});

test('rien après la dernière action : la réponse reprend le dernier morceau écrit', () => {
  assert.equal(texteRenduDuTour(['Je regarde.', 'Voici ma conclusion.', '', '  ']), 'Voici ma conclusion.');
});

test('un tour sans aucun texte rend une réponse vide', () => {
  assert.equal(texteRenduDuTour(['', ' ']), '');
  assert.equal(texteRenduDuTour([]), '');
});

test('un tour sans action garde son texte tel quel', () => {
  assert.equal(texteRenduDuTour(['Tout tient ici.']), 'Tout tient ici.');
});

test('un rapport écrit en deux fois garde ce qu’il faut pour tenir son gabarit', () => {
  const morceaux = ['Je lance les tests.', '## Analyse\nLa cause.', '## Coûts\n```json\n{}\n```'];
  const tient = (texte: string) => texte.includes('## Analyse') && texte.includes('## Coûts');
  assert.equal(texteRenduDuTour(morceaux, tient), '## Analyse\nLa cause.\n\n## Coûts\n```json\n{}\n```');
});

test('un rapport qui tient seul ne remonte pas chercher les phrases d’avant', () => {
  const morceaux = ['Je lance les tests.', '## Analyse\nLa cause.\n## Coûts\n{}'];
  const tient = (texte: string) => texte.includes('## Analyse') && texte.includes('## Coûts');
  assert.equal(texteRenduDuTour(morceaux, tient), '## Analyse\nLa cause.\n## Coûts\n{}');
});

test('aucune fin ne tient le gabarit : la réponse reste le dernier morceau (la relance jugera)', () => {
  assert.equal(texteRenduDuTour(['Je regarde.', 'Fini.'], () => false), 'Fini.');
});

test('une action qui suit une action ne verse aucune note', () => {
  assert.equal(noteAvantLAction(''), undefined);
  assert.equal(noteAvantLAction('  \n '), undefined);
  assert.equal(noteAvantLAction(' Je vérifie. '), 'Je vérifie.');
});

function entree(partiel: Partial<EntreeJournal> & Pick<EntreeJournal, 'nature' | 'rang'>): EntreeJournal {
  return { id: `e${partiel.rang}`, cardId: 'c', phase: 'cadrage', at: partiel.rang, libelle: '', ...partiel };
}

test('la note de l’agent se lit comme un texte, rangée parmi les actions de la réflexion', () => {
  const note = entree({ nature: 'jalon', rang: 1, libelle: JALON_NOTE_DE_L_AGENT, resultat: TOUR[0] });
  assert.equal(genreDAction(note), 'note');
  assert.deepEqual(vueDeLEntree(note), { sorte: 'texte', texte: TOUR[0] });

  const lecture = entree({
    nature: 'requete',
    rang: 2,
    libelle: 'Lecture de server/src/runtime.ts',
    outil: 'Read',
    params: JSON.stringify({ file_path: 'server/src/runtime.ts' }),
    resultat: '…',
    reussie: true,
  });
  const recit = recitDuPoint([note, lecture]);
  assert.deepEqual(
    recit.blocs.map((bloc) => bloc.genre),
    ['note', 'lecture'],
    'la note précède l’action qu’elle annonce',
  );
  assert.equal(recit.blocs[0].ditParLAgent, TOUR[0]);
});
