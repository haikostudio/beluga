import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CADRAGE_INITIAL,
  PROJET_DU_COFFRE,
  ZOOM_DU_CLIC,
  MAX_IMAGES_PAR_ARCHIVE,
  ZOOM_MAX,
  adresseDuLot,
  basculerZoom,
  bornerCadrage,
  bornerEchelle,
  corpsDArchive,
  glissementFranchi,
  nomDArchiveDImages,
  rangVoisin,
  referenceDArchive,
  tailleContenue,
  zoomerAutour,
  type Attachment,
} from '@beluga/shared';
import { DUREE_D_UN_LOT_MS, archiveDesImages, deposerLot, lireLot, verifierArchive } from '../archive-des-images.js';
import { lireArchive } from '../archive-zip.js';

/*
 * LA VISIONNEUSE D'IMAGES : zoom, carrousel qui boucle, et l'archive « tout
 * télécharger » — qui ne laisse sortir AUCUNE pièce hors de portée.
 */

test('le carrousel boucle dans les deux sens', () => {
  assert.equal(rangVoisin(4, 1, 5), 0);
  assert.equal(rangVoisin(0, -1, 5), 4);
  assert.equal(rangVoisin(2, 1, 5), 3);
  assert.equal(rangVoisin(0, 1, 2), 1);
  assert.equal(rangVoisin(1, 1, 2), 0);
  assert.equal(rangVoisin(0, 1, 0), -1);
});

test('le zoom est borné, et le point visé reste sous le curseur', () => {
  assert.equal(bornerEchelle(0.2), 1);
  assert.equal(bornerEchelle(40), ZOOM_MAX);
  const point = { x: 100, y: -50 };
  const zoome = zoomerAutour(CADRAGE_INITIAL, 2, point);
  // Le point d'image sous le curseur : (p - t) / s, identique avant et après.
  assert.deepEqual({ x: (point.x - zoome.x) / zoome.echelle, y: (point.y - zoome.y) / zoome.echelle }, { x: 100, y: -50 });
  assert.deepEqual(zoomerAutour(zoome, 0.5, point), CADRAGE_INITIAL, 'revenir sous 1 recentre l’image');
});

test('le clic bascule entre l’image entière et l’agrandissement', () => {
  const agrandi = basculerZoom(CADRAGE_INITIAL, { x: 0, y: 0 });
  assert.equal(agrandi.echelle, ZOOM_DU_CLIC);
  assert.deepEqual(basculerZoom(agrandi, { x: 30, y: 30 }), CADRAGE_INITIAL);
});

test('l’image agrandie ne laisse jamais de vide au bord', () => {
  const scene = { l: 1000, h: 800 };
  // Une image très large : contenue, elle fait toute la largeur et 250 px de haut.
  const contenu = tailleContenue({ l: 4000, h: 1000 }, scene);
  assert.deepEqual(contenu, { l: 1000, h: 250 });
  const borne = bornerCadrage({ echelle: 2, x: 5000, y: 5000 }, contenu, scene);
  assert.equal(borne.x, 500, 'à 2×, 2000 px de large : 500 px de jeu de chaque côté');
  assert.equal(borne.y, 0, 'à 2×, 500 px de haut tiennent dans 800 : centrée');
});

test('un glissement franc change d’image, un geste vertical jamais', () => {
  assert.equal(glissementFranchi(-300, 10, 400, 1000), 1);
  assert.equal(glissementFranchi(300, 10, 400, 1000), -1);
  assert.equal(glissementFranchi(-60, 0, 2000, 1000), 0, 'lent et court : on revient');
  assert.equal(glissementFranchi(-60, 0, 80, 1000), 1, 'court mais vif : on passe');
  assert.equal(glissementFranchi(-300, 400, 200, 1000), 0);
});

test('la demande d’archive se lit sur les adresses des images, et ne passe jamais dans l’adresse', () => {
  assert.deepEqual(referenceDArchive('/api/attachment?id=a1&download=1'), { genre: 'piece', id: 'a1' });
  assert.deepEqual(referenceDArchive('/api/capture?project=p&path=%2Ftmp%2Fx.png'), { genre: 'capture', projet: 'p', chemin: '/tmp/x.png' });
  assert.equal(referenceDArchive('https://ailleurs.ch/x.png'), null);
  assert.deepEqual(corpsDArchive(['/api/attachment?id=a1', '/api/capture?project=p&path=a.png', '/api/attachment?id=b2'], 'Fil'), {
    ids: ['a1', 'b2'],
    project: 'p',
    chemins: ['a.png'],
    nom: 'Fil',
  });
  assert.deepEqual(corpsDArchive(['/api/attachment?id=a1'], 'x'), { ids: ['a1'], chemins: [], nom: 'x' });
  assert.equal(corpsDArchive(['/api/attachment?id=a1', '/ailleurs.png'], 'x'), null, 'une image inconnue : pas d’archive incomplète');
  assert.equal(corpsDArchive(['/api/capture?project=p&path=a', '/api/capture?project=q&path=b'], 'x'), null);
  // 400 images aux identifiants longs : la demande est grosse, l'adresse à suivre reste courte.
  const quatreCents = Array.from({ length: 400 }, (_, i) => `/api/attachment?id=${'x'.repeat(30)}${i}`);
  assert.equal(corpsDArchive(quatreCents, 'Fil')!.ids.length, 400);
  assert.ok(adresseDuLot('jeton-de-lot').length < 80);
  assert.equal(adresseDuLot('a b'), '/api/attachments/archive?lot=a%20b');
  assert.equal(nomDArchiveDImages('Images : carte/42'), 'Images carte 42.zip');
  assert.equal(nomDArchiveDImages(''), 'images.zip');
});

function decor() {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'visionneuse-'));
  const piece = (id: string, name: string, projectId = 'p1'): Attachment => {
    fs.writeFileSync(path.join(dossier, id), `image ${id}`);
    return { id, name, projectId, mime: 'image/png', size: 7, sha: id, createdAt: 0 } as Attachment;
  };
  const pieces = new Map<string, Attachment>(
    [piece('a', 'photo.png'), piece('b', 'photo.png'), piece('c', 'acces.png', PROJET_DU_COFFRE), piece('d', 'autre.png')].map((p) => [p.id, p]),
  );
  return { dossier, pieces };
}

test('l’archive garde les vrais noms, dédoublonnés, et se relit', async () => {
  const { dossier, pieces } = decor();
  const r = archiveDesImages(
    { ids: ['a', 'b'], nom: 'Mes images' },
    { lirePiece: (id) => pieces.get(id), peutLire: () => true, cheminDe: (p) => path.join(dossier, p.id), refus: 'non' },
  );
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.nom, 'Mes images.zip');
  assert.deepEqual(r.fichiers, ['photo.png', 'photo-2.png']);
  const cible = path.join(dossier, 'sortie.zip');
  await new Promise<void>((fin, echec) => r.flux.pipe(fs.createWriteStream(cible)).on('finish', fin).on('error', echec));
  assert.equal(fs.statSync(cible).size, await r.poids, 'le poids annoncé est le poids réel');
  const lue = await lireArchive(cible);
  assert.deepEqual(lue!.entrees.map((e) => e.nom).sort(), ['photo-2.png', 'photo.png']);
});

test('le brief téléchargé : son texte à la racine, ses images sous le chemin que le texte cite', async () => {
  const { dossier, pieces } = decor();
  const acces = { lirePiece: (id: string) => pieces.get(id), peutLire: () => true, cheminDe: (p: Attachment) => path.join(dossier, p.id), refus: 'non' };
  const r = archiveDesImages(
    { ids: ['a', 'b'], nom: 'brief-Ma vidéo', nomsDansLArchive: { a: 'images/face.png', b: 'images/profil.png' }, textes: [{ nom: 'brief.md', contenu: '# Brief\n\n![Face](images/face.png)\n' }] },
    acces,
  );
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.fichiers, ['images/face.png', 'images/profil.png', 'brief.md']);
  const cible = path.join(dossier, 'brief.zip');
  await new Promise<void>((fin, echec) => r.flux.pipe(fs.createWriteStream(cible)).on('finish', fin).on('error', echec));
  assert.equal(fs.statSync(cible).size, await r.poids, 'le poids annoncé est le poids réel');
  /* Un texte seul suffit ; un chemin qui sort de l'archive est refusé. */
  assert.ok(verifierArchive({ ids: [], textes: [{ nom: 'brief.md', contenu: 'x' }] }, acces).ok);
  assert.equal(verifierArchive({ ids: [], textes: [{ nom: '../brief.md', contenu: 'x' }] }, acces).ok, false);
  const echappe = verifierArchive({ ids: ['a'], nomsDansLArchive: { a: '../../etc/passwd' } }, acces);
  assert.ok(echappe.ok && echappe.entrees[0]!.nom === 'photo.png', 'un chemin dangereux retombe sur le vrai nom');
});

test('une seule pièce hors de portée refuse toute l’archive', () => {
  const { dossier, pieces } = decor();
  // Le client de ce décor ne lit que « a » et « b » ; le coffre reste fermé hors administrateur.
  const acces = {
    lirePiece: (id: string) => pieces.get(id),
    peutLire: (p: Attachment) => (p.id === 'a' || p.id === 'b') && p.projectId !== PROJET_DU_COFFRE,
    cheminDe: (p: Attachment) => path.join(dossier, p.id),
    refus: 'hors de portée',
  };
  assert.deepEqual(archiveDesImages({ ids: ['a', 'd'] }, acces), { ok: false, statut: 403, raison: 'hors de portée' });
  assert.deepEqual(archiveDesImages({ ids: ['a', 'c'] }, acces), { ok: false, statut: 403, raison: 'hors de portée' });
  assert.deepEqual(archiveDesImages({ ids: ['a', 'inconnue'] }, acces), { ok: false, statut: 403, raison: 'hors de portée' });
  assert.equal(archiveDesImages({ ids: [] }, acces).ok, false);
  // Les captures d'étape : refusées sans `trouverCapture` (un client).
  assert.deepEqual(archiveDesImages({ ids: ['a'], captures: { projet: 'p1', chemins: ['x.png'] } }, acces), {
    ok: false,
    statut: 403,
    raison: 'hors de portée',
  });
  assert.ok(archiveDesImages({ ids: ['a', 'b'] }, acces).ok);
});

test('jusqu’à 1 000 images dans une archive, pas une de plus', () => {
  assert.equal(MAX_IMAGES_PAR_ARCHIVE, 1000);
  const { dossier, pieces } = decor();
  const acces = { lirePiece: (id: string) => pieces.get(id), peutLire: () => true, cheminDe: (p: Attachment) => path.join(dossier, p.id), refus: 'non' };
  // Mille fois la même pièce dédoublonnée : une seule image, donc acceptée.
  assert.ok(verifierArchive({ ids: Array.from({ length: 1000 }, () => 'a') }, acces).ok);
  const trop = verifierArchive({ ids: Array.from({ length: 1001 }, (_, i) => `id${i}`) }, acces);
  assert.equal(trop.ok, false);
  if (!trop.ok) {
    assert.equal(trop.statut, 400);
    assert.match(trop.raison, /séparément/, 'le refus dit quoi faire');
  }
});

test('un lot préparé ne sert que son compte, et pas au-delà de sa durée', () => {
  const t0 = 1_000_000;
  const demande = { ids: ['a', 'b'], nom: 'Lot' };
  const jeton = deposerLot('compte-1', demande, t0);
  assert.ok(jeton.length >= 20, 'un jeton qu’on ne devine pas');
  assert.deepEqual(lireLot(jeton, 'compte-1', t0 + 1000), demande);
  assert.deepEqual(lireLot(jeton, 'compte-1', t0 + 2000), demande, 'relisible : HEAD, puis GET, puis reprise');
  assert.equal(lireLot(jeton, 'compte-2', t0 + 1000), null, 'un autre compte n’en tire rien');
  assert.equal(lireLot('inconnu', 'compte-1', t0 + 1000), null);
  assert.equal(lireLot(jeton, 'compte-1', t0 + DUREE_D_UN_LOT_MS + 1), null, 'périmé');
  assert.equal(lireLot(jeton, 'compte-1', t0 + 1000), null, 'un lot périmé est oublié, pas seulement masqué');
});
