import test from 'node:test';
import assert from 'node:assert/strict';
import { declinaisonsAPoser, titreSansReseau, type PostDeclinable } from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* LES DÉCLINAISONS D'UN MÊME POST (carte « Fiche publication et médias regroupés ») */
/* ------------------------------------------------------------------ */

test('le titre d’un post perd son réseau, ses accents et sa ponctuation', () => {
  assert.equal(titreSansReseau('TikTok Avant-première 1 — Dîner dans une bulle sur l’eau'), titreSansReseau("Avant-première 1 — Dîner dans une bulle sur l'eau"));
  assert.equal(titreSansReseau('Avant-première 1 — Dîner (Instagram)'), 'avant premiere 1 diner');
  assert.notEqual(titreSansReseau('Avant-première 1 — Dîner'), titreSansReseau('Avant-première 2 — Dîner'));
  /* « X » ne mange pas un mot qui commence par x. */
  assert.equal(titreSansReseau('Xylophone géant'), 'xylophone geant');
});

const post = (id: string, canal: string, titre: string, p: Partial<PostDeclinable> = {}): PostDeclinable => ({
  id,
  projet: 'jc',
  canal,
  campagneId: 'camp',
  datePrevue: '2026-11-10',
  titre,
  creeLe: Number(id.replace(/\D/g, '')) || 1,
  declinaisonDe: null,
  ...p,
});

test('les neuf paires Instagram/TikTok de Wogo se relient, les posts Instagram seuls restent seuls', () => {
  const posts: PostDeclinable[] = [];
  for (let n = 1; n <= 9; n += 1) {
    const jour = `2026-11-${String(10 + n).padStart(2, '0')}`;
    posts.push(post(`ig${n}`, 'instagram', `Avant-première ${n} — Lieu ${n}`, { datePrevue: jour, creeLe: n }));
    posts.push(post(`tt${n}`, 'tiktok', `TikTok Avant-première ${n} — Lieu ${n}`, { datePrevue: jour, creeLe: 100 + n }));
    /* Hors campagne : jamais relié. */
    posts.push(post(`solo${n}`, 'instagram', `Instagram Post ${n} — Autre`, { campagneId: null, datePrevue: jour, creeLe: 200 + n }));
  }
  const liens = declinaisonsAPoser(posts);
  assert.equal(liens.length, 9);
  for (let n = 1; n <= 9; n += 1) assert.ok(liens.some((l) => l.id === `tt${n}` && l.declinaisonDe === `ig${n}`));
  /* Idempotent : une fois posés, plus rien. */
  const poses = posts.map((p) => ({ ...p, declinaisonDe: liens.find((l) => l.id === p.id)?.declinaisonDe ?? null }));
  assert.deepEqual(declinaisonsAPoser(poses), []);
});

test('deux publications du même réseau ne sont jamais des déclinaisons, ni deux jours ou deux campagnes différents', () => {
  assert.deepEqual(declinaisonsAPoser([post('a1', 'instagram', 'Teaser'), post('b2', 'instagram', 'Instagram Teaser')]), []);
  assert.deepEqual(declinaisonsAPoser([post('a1', 'instagram', 'Teaser'), post('b2', 'tiktok', 'Teaser', { datePrevue: '2026-11-11' })]), []);
  assert.deepEqual(declinaisonsAPoser([post('a1', 'instagram', 'Teaser'), post('b2', 'tiktok', 'Teaser', { campagneId: 'autre' })]), []);
  /* Trois réseaux, dont deux fois Instagram : un seul Instagram dans la famille. */
  assert.deepEqual(declinaisonsAPoser([post('a1', 'instagram', 'Teaser'), post('b2', 'tiktok', 'Teaser'), post('c3', 'instagram', 'Teaser')]), [{ id: 'b2', declinaisonDe: 'a1' }]);
});

test('un lien déjà posé n’est jamais déplacé, et une nouvelle version rejoint son origine', () => {
  const posts = [post('a1', 'instagram', 'Teaser'), post('b2', 'tiktok', 'Teaser', { declinaisonDe: 'a1' }), post('c3', 'linkedin', 'LinkedIn Teaser')];
  assert.deepEqual(declinaisonsAPoser(posts), [{ id: 'c3', declinaisonDe: 'a1' }]);
});

const media = (cle: string, piece: string, usages: [contenu: string, canal: string, famille: string][], carrousel: string[] = [], rang: number | null = null) => ({
  cle,
  versions: [{ attachmentId: piece }],
  carrousel: carrousel.map((id) => ({ id })),
  rangDansLePost: rang,
  utilise: usages.map(([contenuId, canal, famille]) => ({ contenuId, canal, famille })),
});

