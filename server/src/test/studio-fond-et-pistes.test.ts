import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/*
 * LE MONTAGE DU STUDIO : pistes, menus et fond retiré (décisions du 02/11/2026).
 *
 *  - une sortie « Glisse vers… » part du bon côté, l'entrée ne change pas ;
 *  - un vrai fond uni se reconnaît sur TOUT le tour de l'image ; une capture, un cadre plein
 *    ou un décor ne passent pas en retrait d'office ;
 *  - seule la couleur reliée au bord part : un sujet de la même couleur n'est pas troué ;
 *  - une nouvelle piste, un nom choisi, un élément masqué, une opacité qui survit aux transitions.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-fond-'));
process.env.BELUGA_DATA = bacASable;

const shared = await import('@beluga/shared');
const { appliquerOperation, compositionVide, couleurFranche, lireLeFond, poseManuelle, retirerLeFondRelie, traduireEnPage, uneVersionSeLit, validerComposition, MOTEUR_APERCU_STUDIO } = shared;

let n = 0;
const idNeuf = (p: string) => `${p}-${++n}`;

/** Une image RGBA : le fond, puis ce que `peindre` y dépose. */
function image(l: number, h: number, fond: [number, number, number], peindre?: (x: number, y: number) => [number, number, number] | null): Uint8Array {
  const p = new Uint8Array(l * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < l; x++) {
      const c = peindre?.(x, y) ?? fond;
      p.set([c[0], c[1], c[2], 255], (x + y * l) * 4);
    }
  }
  return p;
}
const disque = (cx: number, cy: number, r: number) => (x: number, y: number) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const options = { format: '9:16', medias: {}, gsap: 'gsap.js', polices: '/polices/', mode: 'rendu' } as any;

/* ------------------------------------------------------------------ */

test('LE SENS DES SORTIES : la recette décrit l’entrée, la sortie part de l’autre côté', () => {
  const c = compositionVide('9:16', 10);
  const piste = c.pistes.find((p) => p.genre === 'image')!;
  piste.segments.push({ id: 'seg-a', genre: 'image', debut: 0, duree: 5, mediaId: 'med-1', ajustement: 'contenir', sortie: 'glisse-bas' } as any);
  const page = traduireEnPage(c, { ...options, medias: { 'med-1': { url: 'a.png', genre: 'image' } } });
  assert.match(page, /function versLaSortie\(o\)/);
  assert.match(page, /var b=versLaSortie\(hors\[0\]\)/);
  /* L'entrée reste jouée telle quelle : ni la table ni son sens ne changent. */
  assert.match(page, /'glisse-bas':\[\{yPercent:-14/);
  assert.match(page, /tl\.fromTo\(el,copie\(dans\[0\]\),a,s\.debut\)/);
  /* On joue la règle : glisse-bas sort vers le bas (positif), glisse-gauche vers la gauche (négatif). */
  const corps = /function versLaSortie\(o\)\{[^\n]*\}/.exec(page)![0];
  const versLaSortie = new Function(`function copie(o){var r={};for(var k in o)r[k]=o[k];return r;}\n${corps}\nreturn versLaSortie;`)();
  assert.equal(versLaSortie({ yPercent: -14, opacity: 0 }).yPercent, 14);
  assert.equal(versLaSortie({ xPercent: 14, opacity: 0 }).xPercent, -14);
  assert.doesNotThrow(() => new Function(MOTEUR_APERCU_STUDIO as string));
});

test('UN VRAI FOND UNI : reconnu sur le tour de l’image, y compris un buste coupé par le bas', () => {
  const vert: [number, number, number] = [0, 200, 40];
  const mascotte = image(100, 100, vert, (x, y) => (disque(50, 50, 25)(x, y) ? [200, 80, 30] : null));
  assert.deepEqual(lireLeFond(mascotte, 100, 100, { exigeant: true }), { etat: 'uni', couleur: '#00c828' });
  const buste = image(100, 100, [255, 255, 255], (x, y) => (disque(50, 100, 40)(x, y) ? [40, 40, 40] : null));
  assert.equal(lireLeFond(buste, 100, 100, { exigeant: true }).etat, 'uni');
});

test('PAS UN FOND UNI : un décor, un aplat sans sujet, une image déjà transparente', () => {
  const degrade = image(100, 100, [0, 0, 0], (x) => [x * 2, 100, 255 - x * 2]);
  assert.equal(lireLeFond(degrade, 100, 100).etat, 'non-uni');
  assert.equal(lireLeFond(image(100, 100, [10, 20, 30]), 100, 100).etat, 'non-uni');
  const coinsUnis = image(100, 100, [255, 255, 255], (x, y) => (y > 10 && y < 90 && x < 5 ? [0, 0, 0] : y > 10 && y < 90 && x > 94 ? [0, 0, 0] : null));
  assert.equal(lireLeFond(coinsUnis, 100, 100).etat, 'non-uni', 'quatre coins pareils ne font pas un fond uni');
  const vide = new Uint8Array(100 * 100 * 4);
  assert.equal(lireLeFond(vide, 100, 100).etat, 'transparent');
});

test('LE RETRAIT D’OFFICE ÉCARTE une capture d’écran et un cadre plein, que le geste à la main accepte', () => {
  /* Des lignes de texte : beaucoup de petits morceaux. */
  const capture = image(200, 200, [255, 255, 255], (x, y) => (y % 12 < 4 && x % 9 < 5 && x > 10 && x < 190 && y > 10 && y < 190 ? [30, 30, 30] : null));
  assert.equal(lireLeFond(capture, 200, 200, { exigeant: true }).etat, 'non-uni');
  assert.equal(lireLeFond(capture, 200, 200).etat, 'uni');
  const cadre = image(200, 200, [255, 255, 255], (x, y) => (x > 30 && x < 170 && y > 30 && y < 170 ? [90, 120, 200] : null));
  assert.equal(lireLeFond(cadre, 200, 200, { exigeant: true }).etat, 'non-uni');
});

test('SEULE LA COULEUR RELIÉE AU BORD PART : le blanc des yeux reste, le fond vert fermé part aussi', () => {
  const blanc = image(100, 100, [255, 255, 255], (x, y) => (disque(50, 50, 10)(x, y) ? [255, 255, 255] : disque(50, 50, 30)(x, y) ? [40, 40, 40] : null));
  retirerLeFondRelie(blanc, 100, 100, '#ffffff');
  const alpha = (p: Uint8Array, x: number, y: number) => p[(x + y * 100) * 4 + 3];
  assert.equal(alpha(blanc, 2, 2), 0, 'le fond part');
  assert.equal(alpha(blanc, 50, 50), 255, 'le sujet blanc reste entier');
  assert.equal(alpha(blanc, 50, 30), 255, 'le sujet reste');

  assert.ok(couleurFranche('#00c828'));
  assert.ok(!couleurFranche('#ffffff'));
  const vert = image(100, 100, [0, 200, 40], (x, y) => (disque(50, 50, 10)(x, y) ? [0, 200, 40] : disque(50, 50, 30)(x, y) ? [200, 80, 30] : null));
  retirerLeFondRelie(vert, 100, 100, '#00c828');
  assert.equal(alpha(vert, 50, 50), 0, 'un trou fermé de couleur franche part aussi');
  assert.equal(alpha(vert, 50, 30), 255);
});

test('SUR DE VRAIS FICHIERS : PNG transparent, et sujet de la couleur du fond intact', async () => {
  const { detourerUneImage, lireLeFondDuFichier } = await import('../studio-detourage.js');
  const source = path.join(bacASable, 'source.png');
  const brut = path.join(bacASable, 'source.rgba');
  fs.writeFileSync(brut, image(320, 320, [255, 255, 255], (x, y) => (disque(160, 160, 30)(x, y) ? [255, 255, 255] : disque(160, 160, 90)(x, y) ? [30, 30, 90] : null)));
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', '320x320', '-i', brut, '-frames:v', '1', source]);
  const lu = await lireLeFondDuFichier(source, { exigeant: true });
  assert.equal(lu.couleur, '#ffffff');
  const sortie = await detourerUneImage(source, 'auto', { strict: true });
  const pixels = execFileSync('ffmpeg', ['-v', 'error', '-i', sortie, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { maxBuffer: 2e7 });
  assert.equal(pixels[(5 + 5 * 320) * 4 + 3], 0, 'le coin est transparent');
  assert.equal(pixels[(160 + 160 * 320) * 4 + 3], 255, 'le centre blanc reste');
  /* Déjà transparent : aucun second détourage. */
  const relu = await lireLeFondDuFichier(sortie, { exigeant: true });
  assert.equal(relu.transparent, true);
  await assert.rejects(detourerUneImage(sortie, 'auto', { strict: true }));
  fs.rmSync(sortie, { force: true });
});

test('UNE VIDÉO À FOND BLANC ET À DURÉE À VIRGULE se détoure sans planter, au-delà de 10 s', async () => {
  const { detourerUneVideo, lireLeFondDuFichier } = await import('../studio-detourage.js');
  const source = path.join(bacASable, 'clip.mp4');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=160x160:d=10.37:r=5', '-vf', "drawbox=x=50:y=50:w=60:h=60:color=0x204060:t=fill", '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '12', source]);
  const lu = await lireLeFondDuFichier(source, { video: true, exigeant: false });
  assert.ok(lu.couleur, `un fond uni attendu (${lu.raison})`);
  const webm = await detourerUneVideo(source, lu.couleur!);
  assert.ok(fs.statSync(webm).size > 0);
  fs.rmSync(webm, { force: true });
});

/* ------------------------------------------------------------------ */

test('NOUVELLE PISTE : une piste neuve du bon type, à sa position, en une seule opération', () => {
  const c = compositionVide('9:16', 10);
  const avant = c.pistes.length;
  const r = poseManuelle(c, { nouvellePiste: true, segment: { genre: 'video', debut: 1, duree: 2, mediaId: 'med-v', debutMedia: 0, volume: 1, ajustement: 'couvrir' } }, undefined, idNeuf);
  assert.ok(r.ok);
  assert.equal(r.operation.op, 'lot');
  const a = appliquerOperation(c, r.operation, idNeuf);
  assert.ok(a.ok);
  assert.equal(a.composition.pistes.length, avant + 1);
  assert.equal(a.composition.pistes.find((p: any) => p.id === r.pisteId)!.genre, 'video');
  /* Une voix va sur une Voix, une musique sur un Son, grâce à sa capacité. */
  const voix = poseManuelle(c, { nouvellePiste: true, capacite: 'voix', segment: { genre: 'audio', debut: 0, duree: 2, mediaId: 'med-a', debutMedia: 0, volume: 1 } }, undefined, idNeuf);
  assert.ok(voix.ok && voix.operation.op === 'lot' && (voix.operation.operations[0] as any).genre === 'voix');
  const son = poseManuelle(c, { nouvellePiste: true, segment: { genre: 'audio', debut: 0, duree: 2, mediaId: 'med-a', debutMedia: 0, volume: 1 } }, undefined, idNeuf);
  assert.ok(son.ok && son.operation.op === 'lot' && (son.operation.operations[0] as any).genre === 'son');
});

test('LE NOM CHOISI : gardé après un réordre et une relecture ; vide, le nom automatique revient ; les autres restent automatiques', () => {
  const c = compositionVide('9:16', 10);
  const video = c.pistes.find((p) => p.genre === 'video')!;
  const r = appliquerOperation(c, { op: 'piste-proprietes', pisteId: video.id, nom: ' Mascotte ' }, idNeuf);
  assert.ok(r.ok);
  assert.equal(r.composition.pistes.find((p: any) => p.id === video.id)!.nom, 'Mascotte');
  const deplace = appliquerOperation(r.composition, { op: 'piste-proprietes', pisteId: video.id, position: 0 }, idNeuf);
  assert.ok(deplace.ok);
  const relue = validerComposition(deplace.composition);
  assert.ok(relue.ok);
  const lue = relue.composition.pistes.find((p: any) => p.id === video.id)!;
  assert.equal(lue.nom, 'Mascotte');
  assert.equal(lue.nomChoisi, 'Mascotte');
  const retour = appliquerOperation(relue.composition, { op: 'piste-proprietes', pisteId: video.id, nom: '' }, idNeuf);
  assert.ok(retour.ok);
  const fin = retour.composition.pistes.find((p: any) => p.id === video.id)!;
  assert.equal(fin.nom, 'Vidéo 1');
  assert.equal(fin.nomChoisi, undefined);
  /* Une ancienne composition sans nom choisi reste à l'identique. */
  const ancienne = validerComposition(compositionVide('9:16', 10));
  assert.ok(ancienne.ok && ancienne.composition.pistes.every((p: any) => p.nomChoisi === undefined));
});

test('ÉLÉMENT MASQUÉ : hors de la page et de « une version se lit », il garde sa place et survit à la coupe', () => {
  const c = compositionVide('9:16', 10);
  const piste = c.pistes.find((p) => p.genre === 'image')!;
  piste.segments.push({ id: 'seg-m', genre: 'image', debut: 0, duree: 4, mediaId: 'med-1', ajustement: 'contenir' } as any);
  const medias = { 'med-1': { url: 'a.png', genre: 'image' } };
  const m = appliquerOperation(c, { op: 'proprietes', segmentId: 'seg-m', valeurs: { masque: true } }, idNeuf);
  assert.ok(m.ok);
  assert.equal(traduireEnPage(m.composition, { ...options, medias }).includes('id="seg-seg-m"'), false);
  assert.equal(uneVersionSeLit(m.composition), false);
  const coupe = appliquerOperation(m.composition, { op: 'scinder', segmentId: 'seg-m', a: 2 }, idNeuf);
  assert.ok(coupe.ok);
  assert.ok(coupe.composition.pistes.find((p: any) => p.id === piste.id)!.segments.every((s: any) => s.masque === true), 'la coupe garde le masque');
  const montre = appliquerOperation(m.composition, { op: 'proprietes', segmentId: 'seg-m', valeurs: { masque: false } }, idNeuf);
  assert.ok(montre.ok);
  assert.equal(traduireEnPage(montre.composition, { ...options, medias }).includes('id="seg-seg-m"'), true);
});

test('L’OPACITÉ : refusée sur un son, posée sur la page, et les transitions s’arrêtent à elle', () => {
  const c = compositionVide('9:16', 10);
  const piste = c.pistes.find((p) => p.genre === 'image')!;
  piste.segments.push({ id: 'seg-o', genre: 'image', debut: 0, duree: 4, mediaId: 'med-1', ajustement: 'contenir', entree: 'fondu', sortie: 'glisse-haut' } as any);
  c.pistes.find((p) => p.genre === 'son')!.segments.push({ id: 'seg-s', genre: 'audio', debut: 0, duree: 4, mediaId: 'med-2', debutMedia: 0, volume: 1 } as any);
  assert.equal(appliquerOperation(c, { op: 'proprietes', segmentId: 'seg-s', valeurs: { opacite: 0.5 } }, idNeuf).ok, false);
  const r = appliquerOperation(c, { op: 'proprietes', segmentId: 'seg-o', valeurs: { opacite: 0.4 } }, idNeuf);
  assert.ok(r.ok);
  const page = traduireEnPage(r.composition, { ...options, medias: { 'med-1': { url: 'a.png', genre: 'image' } } });
  assert.match(page, /id="seg-seg-o"[^>]*style="z-index:\d+;opacity:0\.4;/);
  assert.match(page, /"opacite":0\.4/);
  assert.match(page, /visible\(dans\[1\],k\)/);
  assert.match(page, /tl\.fromTo\(el,visible\(hors\[1\],k\),b/);
  /* Revenir à 1 : plus aucune trace, la composition reste celle d'avant. */
  const plein = appliquerOperation(r.composition, { op: 'proprietes', segmentId: 'seg-o', valeurs: { opacite: 1 } }, idNeuf);
  assert.ok(plein.ok);
  assert.equal((plein.composition.pistes.find((p: any) => p.id === piste.id)!.segments[0] as any).opacite, undefined);
});

/* ------------------------------------------------------------------ */
/* Le démon : retrait d'office, retrait et remise à la main              */
/* ------------------------------------------------------------------ */

const { Project, Card } = shared;
const store = await import('../store.js');
const studio = await import('../studio.js');
const { joindreUnFichier } = await import('../joindre-fichier.js');
const generation = await import('../studio-generation.js');
const montage = await import('../studio-montage-de-carte.js');
const fonds = await import('../studio-fond.js');
const { bus } = await import('../bus.js');

const dossierProjet = path.join(bacASable, 'projet');
fs.mkdirSync(dossierProjet, { recursive: true });
const projet = store.saveProject(Project.parse({ id: 'projet-fond', name: 'Fond', path: dossierProjet, createdAt: store.now(), updatedAt: store.now() }));
const creee = studio.creerCreation({ projectId: projet.id, titre: 'Fond', formats: ['9:16'], composition: compositionVide('9:16', 12) });
assert.ok(creee.ok);
const creationId = creee.creation.id;

let graine = 0;
/** Une image réelle ; `fond` : une couleur unie, ou un dégradé sans fond uni. Chaque fichier diffère : deux contenus identiques feraient une seule pièce. */
async function unePiece(fond: [number, number, number] | null): Promise<string> {
  graine++;
  const brut = path.join(bacASable, `p${graine}.rgba`);
  const png = path.join(bacASable, `p${graine}.png`);
  fs.writeFileSync(brut, image(240, 240, fond ?? [0, 0, 0], (x, y) => (disque(120, 120, 60 + graine)(x, y) ? [200, 40 + graine, 30] : fond ? null : [x, y, 128])));
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', '240x240', '-i', brut, '-frames:v', '1', png]);
  const jointe = await joindreUnFichier({ projectId: projet.id, fichier: png, nom: `p${graine}.png` });
  assert.ok(jointe.ok);
  return (jointe as any).attachment.id;
}

/** L'issue d'un geste du fond, lue sur l'événement que l'écran reçoit. */
function issueDuGeste(geste: 'retirer' | 'remettre', d: { attachmentId: string }): Promise<any> {
  return new Promise((resolu) => {
    const arret = bus.subscribe((e: any) => {
      if (e.type === 'studio' && e.fond?.cle === d.attachmentId) {
        arret();
        resolu(e.fond);
      }
    });
    assert.deepEqual(montage.lancerLeGesteDuFond(geste, { creationId, ...d }), { enCours: true, cle: d.attachmentId });
  });
}

const segmentsDu = (mediaId: string) => studio.compositionCourante(creationId)!.pistes.flatMap((p: any) => p.segments).filter((s: any) => s.mediaId === mediaId);

test('L’IMPORT EN STUDIO : un fond uni part, l’original reste relié ; un décor reste entier ; un second import ne refait rien', async () => {
  const piece = await unePiece([0, 200, 40]);
  const r = await generation.importerPieceJointeMesuree(projet.id, piece, { creationId });
  assert.ok(r.ok);
  assert.notEqual(r.media.attachmentId, piece, 'c’est la version sans fond qui entre');
  assert.equal(r.media.mime, 'image/png');
  assert.equal(fonds.pieceOriginaleDuFond(r.media.attachmentId!), piece);
  const encore = await generation.importerPieceJointeMesuree(projet.id, piece, { creationId });
  assert.ok(encore.ok);
  assert.equal(encore.media.id, r.media.id, 'pas de second détourage');

  const decor = await unePiece(null);
  const d = await generation.importerPieceJointeMesuree(projet.id, decor, { creationId });
  assert.ok(d.ok);
  assert.equal(d.media.attachmentId, decor, 'pas de fond uni : le média reste entier, sans bruit');

  const garde = await unePiece([0, 40, 220]);
  const g = await generation.importerPieceJointeMesuree(projet.id, garde, { creationId, garderLeFond: true });
  assert.ok(g.ok);
  assert.equal(g.media.attachmentId, garde, '« fond: aucun » protège un décor voulu');

  /* Hors création du Studio, une pièce ordinaire n'est jamais détourée. */
  const ordinaire = await unePiece([0, 0, 200]);
  const o = await generation.importerPieceJointeMesuree(projet.id, ordinaire, {});
  assert.ok(o.ok);
  assert.equal(o.media.attachmentId, ordinaire);
});

test('LA POSE SUR UNE NOUVELLE PISTE, PUIS RETIRER ET REMETTRE LE FOND PARTOUT, EN UN SEUL ANNULER', async () => {
  const piece = await unePiece([0, 0, 0]);
  const garde = await generation.importerPieceJointeMesuree(projet.id, piece, { creationId, garderLeFond: true });
  assert.ok(garde.ok);
  const original = garde.media.id;
  const pistesAvant = studio.compositionCourante(creationId)!.pistes.length;
  const p1 = await montage.poserALaMain({ creationId, mediaId: original, debut: 1 });
  assert.ok(p1.ok);
  const p2 = await montage.poserALaMain({ creationId, mediaId: original, debut: 6, nouvellePiste: true });
  assert.ok(p2.ok);
  assert.equal(studio.compositionCourante(creationId)!.pistes.length, pistesAvant + 1, 'une piste neuve, une seule');
  assert.equal(segmentsDu(original).length, 2);

  const numero = () => studio.compositionCourante(creationId)!;
  const avant = JSON.stringify(numero());
  const issue = await issueDuGeste('retirer', { attachmentId: piece });
  assert.equal(issue.etat, 'fait');
  assert.equal(issue.segments, 2, 'remplacé partout où il est posé');
  assert.equal(segmentsDu(original).length, 0);
  const sansFond = fonds.pieceSansFond(piece)!;
  assert.ok(sansFond && !sansFond.remis);
  const detoure = studio.compositionCourante(creationId)!.pistes.flatMap((p: any) => p.segments).filter((s: any) => studio.lireMedia(s.mediaId)?.attachmentId === sansFond.piece);
  assert.equal(detoure.length, 2);
  assert.ok(detoure.every((s: any) => s.ajustement === 'contenir'), 'un sujet détouré ne se rogne pas');

  /* Un seul Annuler rend tout. */
  assert.ok(studio.annuler(creationId).ok);
  assert.equal(JSON.stringify(numero()), avant);
  assert.ok(studio.retablir(creationId).ok);

  const remis = await issueDuGeste('remettre', { attachmentId: piece });
  assert.equal(remis.etat, 'fait');
  assert.equal(segmentsDu(original).length, 2, 'l’original reprend toutes ses places');
  assert.equal(fonds.pieceSansFond(piece)!.remis, true);
  /* Remis : l'import suivant garde l'original, le retrait d'office ne recommence pas. */
  const relu = await generation.importerPieceJointeMesuree(projet.id, piece, { creationId });
  assert.ok(relu.ok);
  assert.equal(relu.media.id, original);
});

test('À LA MAIN, UN FOND QUI N’EST PAS UNI SE DIT, ET RIEN NE CHANGE', async () => {
  const piece = await unePiece(null);
  const issue = await issueDuGeste('retirer', { attachmentId: piece });
  assert.equal(issue.etat, 'non-uni');
  assert.ok(issue.raison);
  assert.equal(fonds.pieceSansFond(piece), null);
});
