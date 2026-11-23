import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DELAI_MAX_D_UNE_FABRICATION_MS,
  DUREE_DE_VIE_D_UN_BLOC_TERMINE_MS,
  PLAFOND_DES_MEDIAS_EN_FABRICATION,
  fermerLesBlocsDuTour,
  mediasDeLaConversation,
  piecesMontreesParLesBlocs,
  prixDuMedia,
  rangerLesMedias,
  ratioDuMedia,
  tempsDeFabrication,
  type MediaEnFabrication,
} from '@beluga/shared';

const bloc = (o: Partial<MediaEnFabrication>): MediaEnFabrication => ({
  id: 'm1',
  projectId: 'p',
  sujet: 'Plan 1',
  outil: 'Veo · Google',
  genre: 'video',
  debut: 1000,
  etat: 'en-cours',
  suivi: 'agent',
  ...o,
});

test('la forme du bloc suit le format, sinon le genre', () => {
  assert.equal(ratioDuMedia({ format: '16:9', genre: 'image' }), 16 / 9);
  assert.equal(ratioDuMedia({ format: '9:16', genre: 'video' }), 9 / 16);
  assert.equal(ratioDuMedia({ format: '4x5', genre: 'image' }), 0.8);
  assert.equal(ratioDuMedia({ genre: 'image' }), 1);
  assert.equal(ratioDuMedia({ genre: 'video' }), 16 / 9);
  assert.equal(ratioDuMedia({ genre: 'son' }), 4);
  assert.equal(ratioDuMedia({ format: 'n’importe', genre: 'image' }), 1);
  assert.equal(ratioDuMedia({ format: '100:1', genre: 'image' }), 4, 'borné');
});

test('le temps écoulé et le prix se lisent', () => {
  assert.equal(tempsDeFabrication(0, 7_000), '0:07');
  assert.equal(tempsDeFabrication(0, 161_000), '2:41');
  assert.equal(tempsDeFabrication(0, 3_792_000), '1:03:12');
  assert.equal(tempsDeFabrication(5_000, 0), '0:00');
  assert.equal(prixDuMedia(undefined), null);
  assert.equal(prixDuMedia(null), 'prix non publié');
  assert.equal(prixDuMedia(0), 'gratuit');
  assert.equal(prixDuMedia(0.04), '0,04 $');
  assert.equal(prixDuMedia(1.256), '1,26 $');
});

test('les blocs d’une conversation : la carte, ou l’agent sans carte ; les terminés d’avant la demande sortent', () => {
  const liste = [
    bloc({ id: 'a', cardId: 'c1', debut: 10, etat: 'fini', attachmentId: 'p1' }),
    bloc({ id: 'b', cardId: 'c1', debut: 50 }),
    bloc({ id: 'c', cardId: 'c1', debut: 5 }),
    bloc({ id: 'd', agentId: 'ag', debut: 60, etat: 'fini', attachmentId: 'p2' }),
    bloc({ id: 'e', cardId: 'c2', agentId: 'ag', debut: 70 }),
  ];
  assert.deepEqual(mediasDeLaConversation(liste, { cardId: 'c1' }).map((m) => m.id), ['c', 'a', 'b']);
  assert.deepEqual(mediasDeLaConversation(liste, { cardId: 'c1' }, 20).map((m) => m.id), ['c', 'b'], 'en cours : toujours là');
  assert.deepEqual(mediasDeLaConversation(liste, { agentId: 'ag' }).map((m) => m.id), ['d'], 'ceux d’une carte restent sur la carte');
  assert.deepEqual(mediasDeLaConversation(liste, {}).map((m) => m.id), []);
  assert.deepEqual([...piecesMontreesParLesBlocs(liste)], ['p1', 'p2']);
});

test('le ménage : en cours trop vieux en échec, terminés d’un jour sortis, plafond tenu', () => {
  const maintenant = 10 * DUREE_DE_VIE_D_UN_BLOC_TERMINE_MS;
  const ranges = rangerLesMedias(
    [
      bloc({ id: 'vieux', debut: maintenant - DELAI_MAX_D_UNE_FABRICATION_MS - 1 }),
      bloc({ id: 'frais', debut: maintenant - 1000 }),
      bloc({ id: 'perime', etat: 'fini', debut: 0, fin: maintenant - DUREE_DE_VIE_D_UN_BLOC_TERMINE_MS - 1 }),
    ],
    maintenant,
  );
  assert.deepEqual(ranges.map((m) => `${m.id}:${m.etat}`), ['vieux:echec', 'frais:en-cours']);
  const beaucoup = Array.from({ length: PLAFOND_DES_MEDIAS_EN_FABRICATION + 5 }, (_, i) => bloc({ id: `f${i}`, etat: 'fini', debut: maintenant - 100 + i, fin: maintenant }));
  const tenus = rangerLesMedias([...beaucoup, bloc({ id: 'encours', debut: maintenant - 500 })], maintenant);
  assert.equal(tenus.length, PLAFOND_DES_MEDIAS_EN_FABRICATION);
  assert.ok(tenus.some((m) => m.id === 'encours'), 'un bloc en cours ne sort jamais');
  assert.ok(!tenus.some((m) => m.id === 'f0'), 'les plus anciens terminés sortent d’abord');
});

test('la fin d’un tour ferme les blocs annoncés par son agent, pas ceux que le démon suit', () => {
  const liste = [
    bloc({ id: 'a', agentId: 'ag' }),
    bloc({ id: 'b', agentId: 'ag', suivi: 'service' }),
    bloc({ id: 'c', agentId: 'autre' }),
    bloc({ id: 'd', agentId: 'ag', etat: 'fini' }),
  ];
  const apres = fermerLesBlocsDuTour(liste, 'ag', 99);
  assert.deepEqual(apres.map((m) => m.etat), ['echec', 'en-cours', 'en-cours', 'fini']);
  assert.equal(apres[0]!.fin, 99);
});
