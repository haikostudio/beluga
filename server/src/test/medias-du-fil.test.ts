import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * TOUT MÉDIA DU FIL D'UNE CARTE SE RETRAVAILLE (27/10/2026, capture #ee9e :
 * « les médias doivent être modifiables en tout temps »). Une image rendue
 * par un autre outil que la production (#dca9, générateur de Codex) n'avait
 * aucune ligne dans `medias_realisation` : son menu « … » restait absent. Au
 * premier geste, la pièce est inscrite — une seule fois, à prix nul.
 * Le bac à sable est posé AVANT le premier import du démon.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'medias-du-fil-'));
process.env.BELUGA_DATA = bacASable;

const { Attachment, formatLePlusProche, genreDePieceDuFil, nomSurDisque, pieceDuChemin, planDePieceDuFil, repereDuChemin } = await import('@beluga/shared');
const store = await import('../store.js');
const { createCard } = await import('../tools.js');
const { dossierDEcriture } = await import('../pieces-jointes.js');
const { depenseDeLaCarte, etatDeProductionDeLaCarte, inscrireUnMediaDuFil, mediasDeLaCarte, placerUnMedia, retenirUnMedia } = await import('../realisation.js');
const { evenementsDeLaCarte, noterUnElement } = await import('../production.js');

test('le genre d’une pièce du fil : image, vidéo ou son, rien d’autre', () => {
  assert.equal(genreDePieceDuFil('image/jpeg'), 'image');
  assert.equal(genreDePieceDuFil('video/mp4'), 'video');
  assert.equal(genreDePieceDuFil('audio/mpeg'), 'son');
  assert.equal(genreDePieceDuFil('application/pdf'), null);
  assert.equal(genreDePieceDuFil('image/svg+xml'), null);
  assert.equal(genreDePieceDuFil(undefined), null);
});

test('le plan d’une pièce inscrite : son nom sans extension, borné', () => {
  assert.equal(planDePieceDuFil('IMG_1797.jpeg'), 'IMG_1797');
  assert.equal(planDePieceDuFil("Image de départ de l'angle A"), "Image de départ de l'angle A");
  assert.equal(planDePieceDuFil(''), 'media');
  assert.equal(planDePieceDuFil('x'.repeat(200)).length, 80);
});

test('le format le plus proche des dimensions mesurées', () => {
  assert.equal(formatLePlusProche(1920, 1080, '1:1'), '16:9');
  assert.equal(formatLePlusProche(1080, 1920, '1:1'), '9:16');
  assert.equal(formatLePlusProche(1024, 1024, '16:9'), '1:1');
  assert.equal(formatLePlusProche(1080, 1350, '16:9'), '4:5');
  assert.equal(formatLePlusProche(undefined, 900, '16:9'), '16:9');
});

test('la pièce qu’un chemin désigne, et son repère court', () => {
  const pieces = [
    { id: 'a', alias: 'ae52', name: 'IMG_1797.jpeg' },
    { id: 'b', alias: '3c8a', name: 'IMG_1798.jpeg' },
  ];
  assert.equal(pieceDuChemin('/mnt/stockage/ae52-IMG_1797.jpeg', pieces)?.id, 'a');
  assert.equal(repereDuChemin('/mnt/stockage/3c8a-IMG_1798.jpeg', pieces), '#3c8a');
  assert.equal(pieceDuChemin('/tmp/capture.png', pieces), null);
});

const projet = store.saveProject({
  id: store.newId(),
  name: 'Projet Médias du fil',
  path: bacASable,
  defaultEngine: 'claude',
  isSelf: false,
  archived: false,
  createdAt: store.now(),
  updatedAt: store.now(),
} as any);

function deposer(nom: string, mime: string): string {
  const id = store.newId();
  const piece = Attachment.parse({ id, alias: id.slice(0, 4), projectId: projet.id, name: nom, mime, size: 4, sha: `sha-${id}`, createdAt: Date.now() });
  fs.writeFileSync(path.join(dossierDEcriture(), nomSurDisque(piece)), 'img!');
  store.saveAttachment(piece);
  return id;
}

test('une pièce du fil s’inscrit UNE fois, finie, à prix nul — même sur deux demandes simultanées', async () => {
  const carte = createCard(projet.id, { title: 'Vidéo de présentation', origin: 'user' });
  const piece = deposer('angle-a.png', 'image/png');
  const [a, b] = await Promise.all([inscrireUnMediaDuFil(carte.id, piece), inscrireUnMediaDuFil(carte.id, piece)]);
  assert.ok(a.ok && b.ok);
  assert.equal(a.media.id, b.media.id);
  const encore = await inscrireUnMediaDuFil(carte.id, piece);
  assert.ok(encore.ok && encore.deja && encore.media.id === a.media.id);
  const lignes = mediasDeLaCarte(carte.id).filter((m) => m.attachmentId === piece);
  assert.equal(lignes.length, 1);
  assert.equal(lignes[0]!.etat, 'fini');
  assert.equal(lignes[0]!.genre, 'image');
  assert.equal(lignes[0]!.plan, 'angle-a');
  assert.equal(lignes[0]!.retenuLe ?? null, null, 'inscrire ne valide pas');
  assert.equal(depenseDeLaCarte(carte.id), 0, 'la dépense ne bouge pas');
  assert.ok(etatDeProductionDeLaCarte(carte.id).medias.some((m) => m.attachmentId === piece), 'le menu le retrouve dans la production');
});

test('un PDF ou une pièce d’un autre projet ne s’inscrit pas', async () => {
  const carte = createCard(projet.id, { title: 'Autre carte', origin: 'user' });
  const pdf = deposer('devis.pdf', 'application/pdf');
  const r = await inscrireUnMediaDuFil(carte.id, pdf);
  assert.equal(r.ok, false);
  const r2 = await inscrireUnMediaDuFil(carte.id, 'inconnue');
  assert.equal(r2.ok, false);
  assert.equal(mediasDeLaCarte(carte.id).length, 0);
});

test('une pièce du fil se place dans un plan : validée là, l’occupant libéré, et retirer la validation vide sa case', async () => {
  const carte = createCard(projet.id, { title: 'Vidéo en plans', origin: 'user' });
  noterUnElement({ cardId: carte.id, projectId: projet.id, genre: 'plan', cle: 'plan-1', titre: 'Plan 1', contenu: 'Durée : 5 s' });
  noterUnElement({ cardId: carte.id, projectId: projet.id, genre: 'plan', cle: 'plan-2', titre: 'Plan 2', contenu: 'Durée : 4 s' });
  const premiere = await inscrireUnMediaDuFil(carte.id, deposer('premiere.png', 'image/png'));
  const seconde = await inscrireUnMediaDuFil(carte.id, deposer('seconde.png', 'image/png'));
  assert.ok(premiere.ok && seconde.ok);

  const r1 = placerUnMedia(carte.id, premiere.media.id, 'plan-2');
  assert.ok(r1.ok);
  assert.equal(r1.media.planPlace, 'plan-2');
  assert.ok(r1.media.retenuLe, 'placer vaut valider');
  const r2 = placerUnMedia(carte.id, seconde.media.id, 'plan-2');
  assert.ok(r2.ok && r2.echange === null);
  const apres = new Map(mediasDeLaCarte(carte.id).map((m) => [m.id, m]));
  assert.equal(apres.get(premiere.media.id)!.retenuLe ?? null, null, 'l’ancienne image perd sa validation');
  assert.equal(apres.get(premiere.media.id)!.planPlace ?? null, null);
  assert.ok(apres.get(premiere.media.id)!.attachmentId, 'son fichier reste dans le fil');
  assert.equal(etatDeProductionDeLaCarte(carte.id).medias.find((m) => m.id === seconde.media.id)!.planPlace, 'plan-2', 'l’écran lit le plan placé');
  assert.ok(evenementsDeLaCarte(carte.id).some((e) => e.genre === 'media.place'));

  assert.equal(placerUnMedia(carte.id, seconde.media.id, 'plan-9').ok, false);
  const retire = retenirUnMedia(carte.id, seconde.media.id, false);
  assert.ok(retire.ok);
  assert.equal(retire.media.planPlace ?? null, null, 'retirer la validation vide la case');
});
