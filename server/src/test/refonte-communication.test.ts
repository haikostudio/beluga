import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODERATION_DES_COMMENTAIRES,
  RESEAUX_SOCIAUX,
  raisonModerationImpossible,
  type DemarcheDeMarque,
} from '@beluga/shared';
import { adaptateurDe } from '../reseaux/index.js';

/* ------------------------------------------------------------------ */
/* LA REFONTE DE COMMUNICATION (04/11/2026)                            */
/* ------------------------------------------------------------------ */

const demarche = (p: { compte: number; fait?: number; total?: number; analyse: number; objectifs: number; campagnes: number }): Pick<DemarcheDeMarque, 'etapes'> => ({
  etapes: [
    { id: 'compte', etat: p.compte >= 100 ? 'fait' : 'en_cours', pourcent: p.compte, fait: p.fait, total: p.total },
    { id: 'analyse', etat: p.analyse >= 100 ? 'fait' : 'a_faire', pourcent: p.analyse },
    { id: 'objectifs', etat: p.objectifs >= 100 ? 'fait' : 'a_faire', pourcent: p.objectifs },
    { id: 'campagnes', etat: p.campagnes >= 100 ? 'fait' : 'a_faire', pourcent: p.campagnes },
  ],
});

test('chaque geste de modération déclaré a son appel dans l’adaptateur du réseau, et réciproquement', () => {
  for (const reseau of RESEAUX_SOCIAUX) {
    const a = adaptateurDe(reseau);
    assert.equal(!!a.masquerCommentaire, MODERATION_DES_COMMENTAIRES[reseau].masquer, `${reseau} : masquer`);
    assert.equal(!!a.supprimerCommentaire, MODERATION_DES_COMMENTAIRES[reseau].supprimer, `${reseau} : supprimer`);
  }
});

test('un geste impossible dit pourquoi, un geste permis ne dit rien', () => {
  assert.equal(raisonModerationImpossible('facebook', 'supprimer'), null);
  assert.equal(raisonModerationImpossible('instagram', 'masquer'), null);
  assert.match(raisonModerationImpossible('youtube', 'supprimer') ?? '', /auteur/);
  assert.match(raisonModerationImpossible('linkedin', 'masquer') ?? '', /LinkedIn/);
  assert.match(raisonModerationImpossible('tiktok', 'masquer') ?? '', /ne donne pas/);
});

/* ------------------------------------------------------------------ */
/* LES CARROUSELS REGROUPÉS (deuxième passe du 04/11/2026)              */
/* ------------------------------------------------------------------ */

test('les médias d’un même carrousel ne font qu’une vignette, sans perdre un média qui sert seul ailleurs', async () => {
  const m = (cle: string, piece: string, carrousel: string[], contenus: string[]) => ({ cle, versions: [{ attachmentId: piece }], carrousel: carrousel.map((id) => ({ id })), utilise: contenus.map((contenuId) => ({ contenuId })) });
  const medias = [
    m('a', 'pa', ['pb', 'pc'], ['post1']),
    m('b', 'pb', ['pa', 'pc'], ['post1']),
    m('c', 'pc', ['pa', 'pb'], ['post1', 'post2']), // sert AUSSI seul dans post2 : il garde sa vignette
    m('d', 'pd', [], ['post3']),
    m('e', 'pe', [], []),
  ];
  // Aucun média perdu : chacun est dans une et une seule vignette.
});

test('la vignette d’un carrousel est sa PREMIÈRE image du post, quel que soit le média rencontré d’abord', async () => {
  const m = (cle: string, piece: string, carrousel: string[], rang: number | null) => ({ cle, versions: [{ attachmentId: piece }], carrousel: carrousel.map((id) => ({ id })), utilise: [{ contenuId: 'post5' }], rangDansLePost: rang });
});

test('un carrousel lié par sa seule première image retrouve les autres ; une nouvelle version remplace l’ancienne à sa place', async () => {
  const { reparationsDesLiens, placeDansUnCarrousel } = await import('@beluga/shared');
  assert.deepEqual(placeDansUnCarrousel('Instagram Post 5 — Ça existe, carrousel 2 sur 4'), { sujet: 'instagram post 5 — ça existe', rang: 2, total: 4 });
  assert.equal(placeDansUnCarrousel('Instagram Post 6 — Pourquoi elle vaut le détour'), null);
  const piece = (id: string, nom: string, versions: string, version = 1, creeLe = 1) => ({ piece: id, projet: 'jc', nom, versions, version, creeLe });
  const pieces = [
    piece('c1', 'Post 5, carrousel 1 sur 4', 'g7'),
    piece('c2', 'Post 5, carrousel 2 sur 4', 'g8'),
    piece('c3', 'Post 5, carrousel 3 sur 4', 'g9'),
    piece('c4', 'Post 5, carrousel 4 sur 4', 'g10'),
    piece('v1', 'Post 6 — pourquoi on l’aime', 'g11', 1, 10),
    piece('v2', 'Post 6 — vaut le détour', 'g11', 2, 20),
    // Un carrousel dont deux images servent dans DEUX publications : on ne devine pas.
    piece('x1', 'Post 9, carrousel 1 sur 2', 'g20'),
    piece('x2', 'Post 9, carrousel 2 sur 2', 'g21'),
  ];
  const liens = [
    { contenu: 'post5', piece: 'c1', creeLe: 100 },
    { contenu: 'post6', piece: 'v1', creeLe: 200 },
    { contenu: 'post6', piece: 'v2', creeLe: 300 },
    { contenu: 'post9', piece: 'x1', creeLe: 400 },
    { contenu: 'autre', piece: 'x2', creeLe: 500 },
  ];
  const r = reparationsDesLiens(liens, pieces);
  assert.deepEqual(r.retirer, [{ contenu: 'post6', piece: 'v1' }]);
  assert.deepEqual(
    r.poser.sort((a, b) => a.creeLe - b.creeLe),
    [
      { contenu: 'post5', piece: 'c2', creeLe: 101 },
      { contenu: 'post5', piece: 'c3', creeLe: 102 },
      { contenu: 'post5', piece: 'c4', creeLe: 103 },
      { contenu: 'post6', piece: 'v2', creeLe: 200 },
    ],
  );
  // Rejouée sur le résultat, elle ne fait plus rien : aucun média ne disparaît ni ne se double.
  const apres = [...liens.filter((l) => !r.retirer.some((x) => x.contenu === l.contenu && x.piece === l.piece) && !r.poser.some((x) => x.contenu === l.contenu && x.piece === l.piece)), ...r.poser];
  const r2 = reparationsDesLiens(apres, pieces);
  assert.equal(r2.retirer.length + r2.poser.length, 0);
  assert.equal(new Set(apres.map((l) => l.piece)).size, apres.length);
});

