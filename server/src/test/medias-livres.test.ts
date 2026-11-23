import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * LES MÉDIAS LIVRÉS (décision du 20/10/2026, revue le 26/10/2026) : TOUS les
 * médias finis d'une discussion, versions comprises, chacun une ligne du fil à
 * son heure (capture #e9bd).
 * Le bac à sable est posé AVANT le premier import du démon.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'medias-livres-'));
process.env.BELUGA_DATA = bacASable;

const { groupeDuMedia, mediasLivres, phraseDuMediaLivre, placerLesMediasDansLeFil } = await import('@beluga/shared');
const { annoncerUnMedia, terminerUnMedia } = await import('../medias-en-fabrication.js');
const { mediasLivresDe } = await import('../medias-livres.js');

test('le groupe d’un média réunit les versions d’un même plan', () => {
  assert.equal(groupeDuMedia('Plan 2 – v3'), groupeDuMedia('plan 2'));
  assert.equal(groupeDuMedia('ouverture-v2.mp4'), 'ouverture');
  assert.notEqual(groupeDuMedia('Plan 1'), groupeDuMedia('Plan 2'));
  assert.equal(groupeDuMedia(''), 'media');
});

test('tous les médias restent, rangés par groupe puis par version', () => {
  const liste = [
    { groupe: 'b', version: 1, livreLe: 20 },
    { groupe: 'a', version: 2, livreLe: 30 },
    { groupe: 'a', version: 1, livreLe: 10 },
  ];
  assert.deepEqual(mediasLivres(liste).map((m) => `${m.groupe}${m.version}`), ['a1', 'a2', 'b1']);
});

test('chaque média se pose après le dernier repère arrivé avant lui, dans l’ordre de livraison', () => {
  const m = (groupe: string, livreLe: number, version = 1) => ({ groupe, version, livreLe });
  const { avant, apres } = placerLesMediasDansLeFil([m('d', 99), m('a', 5), m('c', 15), m('b', 12), m('e', 20, 2)], [
    { cle: 'q2', at: 20 },
    { cle: 'q1', at: 10 },
    { cle: 'sans-heure', at: undefined },
  ]);
  assert.deepEqual(avant.map((x) => x.groupe), ['a']);
  assert.deepEqual(apres.get('q1')?.map((x) => x.groupe), ['b', 'c']);
  // Livré à l'heure même du repère : après lui ; puis ce qui vient ensuite.
  assert.deepEqual(apres.get('q2')?.map((x) => x.groupe), ['e', 'd']);
  assert.equal(apres.has('sans-heure'), false);
});

test('capture #e9bd : les images de la veille restent avec leur passage, celle de 08:15 suit la question de 08:08', () => {
  const at = (j: number, h: number, min: number) => Date.UTC(2026, 9, j, h, min);
  const images = [
    { groupe: 'visage', version: 1, livreLe: at(25, 23, 59) },
    { groupe: 'decor', version: 1, livreLe: at(25, 23, 59) },
    { groupe: 'visage', version: 2, livreLe: at(26, 8, 15) },
  ];
  const { avant, apres } = placerLesMediasDansLeFil(images, [
    { cle: 'passage-veille', at: at(25, 23, 40) },
    { cle: 'question-0807', at: at(26, 8, 7) },
    { cle: 'question-0808', at: at(26, 8, 8) },
  ]);
  assert.equal(avant.length, 0);
  assert.equal(apres.get('passage-veille')?.length, 2);
  assert.deepEqual(apres.get('question-0808')?.map((x) => x.version), [2]);
  assert.equal(apres.has('question-0807'), false);
});

test('la phrase d’un média : celle de l’agent, sinon d’après le sujet, le genre et la version', () => {
  assert.deepEqual(phraseDuMediaLivre({ legende: '  Votre visage posé sur l’image d’essai.  ', sujet: 'x', version: 3, genre: 'image' }), {
    texte: 'Votre visage posé sur l’image d’essai.',
  });
  assert.deepEqual(phraseDuMediaLivre({ legende: '', sujet: 'Plan 2', version: 1, genre: 'video' }), {
    motif: 'J’ai rendu la vidéo « {v0} »',
    valeurs: { v0: 'Plan 2' },
  });
  assert.deepEqual(phraseDuMediaLivre({ legende: '', sujet: 'Affiche', version: 2, genre: 'image' }), {
    motif: 'J’ai rendu l’image « {v0} » · version {v1}',
    valeurs: { v0: 'Affiche', v1: 2 },
  });
  assert.equal(phraseDuMediaLivre({ legende: '', sujet: '', version: 1, genre: 'son' }).motif, 'J’ai rendu un son');
});

test('un média fini entre, pour de bon, dans les médias livrés de sa carte, avec sa version', () => {
  const finir = (sujet: string, piece: string) => {
    const bloc = annoncerUnMedia({ projectId: 'p1', cardId: 'carte-1', agentId: 'agent-1', sujet, outil: 'essai', genre: 'image' });
    terminerUnMedia(bloc.id, { attachmentId: piece });
  };
  finir('Affiche', 'piece-1');
  finir('Affiche v2', 'piece-2');
  finir('Vidéo d’ouverture', 'piece-3');
  const echec = annoncerUnMedia({ projectId: 'p1', cardId: 'carte-1', sujet: 'Raté', outil: 'essai', genre: 'video' });
  terminerUnMedia(echec.id, { echec: 'refusé' });
  const livres = mediasLivresDe({ cardId: 'carte-1' });
  assert.deepEqual(livres.map((x) => `${x.groupe}:${x.version}:${x.attachmentId}`), ['affiche:1:piece-1', 'affiche:2:piece-2', 'video d ouverture:1:piece-3']);
  // Une conversation d'agent sans carte a sa propre liste.
  const seul = annoncerUnMedia({ projectId: 'p1', agentId: 'agent-2', sujet: 'Logo', outil: 'essai', genre: 'image' });
  terminerUnMedia(seul.id, { attachmentId: 'piece-4' });
  assert.deepEqual(mediasLivresDe({ agentId: 'agent-2' }).map((x) => x.attachmentId), ['piece-4']);
  // La phrase donnée par l'agent à la fin reste avec le média ; sans elle, la ligne est vide (l'écran l'écrit).
  const dit = annoncerUnMedia({ projectId: 'p1', agentId: 'agent-2', sujet: 'Logo', outil: 'essai', genre: 'image' });
  terminerUnMedia(dit.id, { attachmentId: 'piece-5', legende: '  Le logo en violet, version plus lisible.  ' });
  assert.deepEqual(mediasLivresDe({ agentId: 'agent-2' }).map((x) => x.legende), ['', 'Le logo en violet, version plus lisible.']);
  assert.equal(mediasLivresDe({ agentId: 'agent-1' }).length, 0);
});
