import assert from 'node:assert/strict';
import test from 'node:test';
import { mentionTachesNonFaites, tourClosSansListe, type TodoItem } from '@beluga/shared';

const LIGNES: TodoItem[] = [
  { label: 'Lire la demande', state: 'done' },
  { label: 'Préparer les messages', state: 'unfinished' },
  { label: 'Programmer', state: 'unfinished' },
];

test('une question restée ouverte : les lignes attendent la réponse, elles ne sont pas « non faites »', () => {
  assert.equal(mentionTachesNonFaites(LIGNES), '2 non faites');
  assert.equal(mentionTachesNonFaites(LIGNES, { enAttenteDeReponse: true }), '2 en attente de votre réponse');
});

test('une réponse finie sans liste range la liste d’avant', () => {
  assert.equal(tourClosSansListe({ role: 'assistant', streaming: false, todos: [] }, false), true);
});

test('tant que l’agent travaille, la liste d’avant reste sous les yeux', () => {
  assert.equal(tourClosSansListe({ role: 'assistant', streaming: false, todos: [] }, true), false);
  assert.equal(tourClosSansListe({ role: 'assistant', streaming: true, todos: [] }, false), false);
  assert.equal(tourClosSansListe({ role: 'user', todos: [] }, false), false);
});

test('une réponse qui a sa liste la garde', () => {
  assert.equal(tourClosSansListe({ role: 'assistant', todos: [{}] }, false), false);
  assert.equal(tourClosSansListe(undefined, false), false);
});

test('la réponse tardive demande de réannoncer la liste, dans la demande du tour', async () => {
  const { texteDeReponseTardive } = await import('@beluga/shared');
  const texte = texteDeReponseTardive('Quels canaux ?', 'LinkedIn');
  assert.match(texte, /Réponse à ta question « Quels canaux \? » : LinkedIn/);
  assert.match(texte, /réannonce ta liste de tâches/);
});

test('un rapport rendu est le bloc que le fil vise par son début', async () => {
  const { blocDeFinDuPassage } = await import('@beluga/shared');
  const rapport = { id: 'r1' } as any;
  const passage = { etape: 'rapport', moments: [{ sorte: 'rapport', entree: rapport, dernier: true }], reponse: undefined } as any;
  assert.deepEqual(blocDeFinDuPassage(passage), { sorte: 'rapport', cle: 'r1' });
});

test('les images posées par l’agent se lisent dans son texte ; sinon le filet montre celles du tour', async () => {
  const { piecesIllustreesDuTexte, vignettesDuTour } = await import('@beluga/shared');
  assert.deepEqual(piecesIllustreesDuTexte('Fait.\n![Écran](piece:abc-1)\n![Encore](piece:abc-1)\ntexte'), ['abc-1']);
  const captures = [
    { cle: 'jointe:a', genre: 'jointe', id: 'a', libelle: 'a', quand: 30 },
    { cle: 'etape:b', genre: 'etape', chemin: '/x.png', libelle: 'b', quand: 20 },
    { cle: 'jointe:v', genre: 'jointe', id: 'v', libelle: 'v', quand: 25, media: 'video' },
    { cle: 'jointe:vieux', genre: 'jointe', id: 'vieux', libelle: 'vieux', quand: 5 },
  ] as any;
  assert.deepEqual(vignettesDuTour('Rien de posé', captures, { depuis: 10, jusqua: 40 }).map((c: any) => c.cle), ['jointe:a', 'etape:b']);
  assert.deepEqual(vignettesDuTour('![x](piece:a)', captures, { depuis: 10, jusqua: 40 }), []);
});
