import test from 'node:test';
import assert from 'node:assert/strict';
import {
  captureDejaVue,
  captureDuChemin,
  capturesArriveesDepuis,
  capturesDuFlux,
  genreDeMedia,
  capturesPasEncoreVues,
  clesAMarquerVues,
  clesDeVue,
  estUneCopieDeConstruction,
  nomDeCaptureRangee,
  pieceVenueDUneConstruction,
  tranchesDeCles,
} from '@beluga/shared';

test('la bande réunit les captures d’étape et les images jointes par l’agent, la plus récente d’abord', () => {
  const rendu = capturesDuFlux(
    [
      { id: 'a', label: 'Ouvrir la page', capture: '/tmp/a.png', startedAt: 100 },
      { id: 'b', label: 'Lire un fichier', startedAt: 200 },
      { id: 'c', label: 'Cliquer', capture: '/tmp/c.png', startedAt: 300 },
    ],
    [
      { id: 'j1', name: 'mascotte-s.webp', mime: 'image/webp', createdAt: 250 },
      { id: 'j2', name: 'notes.txt', mime: 'text/plain', createdAt: 260 },
    ],
  );
  assert.deepEqual(
    rendu.map((c) => c.cle),
    ['etape:c', 'jointe:j1', 'etape:a'],
  );
});

test('une même image prise deux fois ne s’affiche qu’une fois', () => {
  const rendu = capturesDuFlux(
    [
      { id: 'a', label: 'x', capture: '/tmp/a.png' },
      { id: 'b', label: 'y', capture: ' /tmp/a.png ' },
    ],
    [],
  );
  assert.equal(rendu.length, 1);
});

test('sans étape, les images jointes par l’agent font la bande', () => {
  assert.deepEqual(
    capturesDuFlux([], [{ id: 'j1', name: 'e.png', mime: 'image/png' }]).map((c) => c.cle),
    ['jointe:j1'],
  );
});

test('sans capture ni image, la bande est vide', () => {
  assert.deepEqual(capturesDuFlux([{ id: 'a', label: 'x' }], [{ id: 'p', name: 'notes.md', mime: 'text/markdown' }]), []);
});

test('une capture d’étape rangée en pièce jointe s’affiche par sa pièce, une seule fois', () => {
  const rendu = capturesDuFlux(
    [
      { id: 'a', label: 'Cliquer', capture: '/tmp/essai/accueil.png', startedAt: 10 },
      { id: 'b', label: 'Lire', capture: '/tmp/essai/autre.png', startedAt: 20 },
    ],
    [
      { id: 'j1', name: 'accueil.png', mime: 'image/png', createdAt: 11 },
      { id: 'j2', name: 'illustration.png', mime: 'image/png', createdAt: 30 },
    ],
  );
  assert.deepEqual(
    rendu.map((c) => c.cle),
    ['jointe:j2', 'etape:b', 'jointe:j1'],
  );
  assert.equal(rendu[2].libelle, 'Cliquer', 'la pièce garde le libellé de son étape');
});

test('le lien posé par le démon relie une capture à sa pièce renommée', () => {
  const rendu = capturesDuFlux(
    [{ id: 'a', label: 'Capture', capture: '/tmp/image.png', capturePiece: 'j1', startedAt: 10 }],
    [{ id: 'j1', name: 'ma-carte-image.png', mime: 'image/png', createdAt: 11 }],
  );
  assert.deepEqual(
    rendu.map((c) => c.cle),
    ['jointe:j1'],
  );
  assert.equal(captureDuChemin(rendu, '/tmp/image.png')?.cle, 'jointe:j1', 'la vignette du fil retrouve la pièce');
});

test('captureDuChemin retrouve une image par son chemin, sinon par son nom', () => {
  const rendu = capturesDuFlux([{ id: 'a', label: 'x', capture: '/tmp/w/apercu.png' }], [{ id: 'j', name: 'mascotte.webp', mime: 'image/webp' }]);
  assert.equal(captureDuChemin(rendu, '/tmp/w/apercu.png')?.cle, 'etape:a');
  assert.equal(captureDuChemin(rendu, 'apercu.png')?.cle, 'etape:a');
  assert.equal(captureDuChemin(rendu, '/ailleurs/mascotte.webp')?.cle, 'jointe:j');
  assert.equal(captureDuChemin(rendu, '/tmp/inconnue.png'), undefined);
});

test('les copies d’icônes d’une construction d’application sont reconnues', () => {
  for (const chemin of [
    'android/app/src/main/res/mipmap-hdpi/ic_launcher.png',
    'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png',
    'android/app/src/main/res/drawable-port-xhdpi/splash.png',
    'android/app/src/main/res/drawable/splash.png',
    'ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-1.png',
    'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png',
    '/tmp/x/ic_launcher_foreground.png',
  ]) {
    assert.ok(estUneCopieDeConstruction(chemin), chemin);
  }
  for (const chemin of ['/tmp/apercu-1360x860-vague1.png', 'public/kipou-001.webp', 'resources/splash.png', 'docs/drawables.png']) {
    assert.equal(estUneCopieDeConstruction(chemin), false, chemin);
  }
});

test('une capture au nom vague reçoit le titre de la carte, les autres gardent leur nom', () => {
  assert.equal(nomDeCaptureRangee('image.png', 'Retouches de la vitrine'), 'retouches-de-la-vitrine-image.png');
  assert.equal(nomDeCaptureRangee('screenshot-2.png', 'Démo'), 'demo-screenshot-2.png');
  assert.equal(nomDeCaptureRangee('apercu-1360x860-vague1.png', 'Démo'), 'apercu-1360x860-vague1.png');
  assert.equal(nomDeCaptureRangee('image.png', undefined), 'image.png');
});

test('les copies d’icônes déjà rangées en pièces jointes restent hors de la bande', () => {
  const noms = ['splash (7).png', 'ic_launcher_round (3).png', 'ic_launcher_foreground.png', 'splash-2732x2732-1.png', 'AppIcon-512@2x.png', 'splash.png'];
  for (const nom of noms) assert.ok(pieceVenueDUneConstruction(nom), nom);
  for (const nom of ['kipou-001.webp', 'apercu-1360x860-vague1.png', 'splash-ecran-accueil.png']) assert.equal(pieceVenueDUneConstruction(nom), false, nom);
  const rendu = capturesDuFlux(
    [],
    [...noms.map((name, i) => ({ id: `c${i}`, name, mime: 'image/png' })), { id: 'k', name: 'kipou-001.webp', mime: 'image/webp' }],
  );
  assert.deepEqual(
    rendu.map((c) => c.cle),
    ['jointe:k'],
  );
});

test('chaque image porte son heure : le début de son étape, à défaut la date de sa pièce', () => {
  const rendu = capturesDuFlux(
    [
      { id: 'a', label: 'Capture rangée', capture: '/tmp/a.png', capturePiece: 'j1', startedAt: 100 },
      { id: 'b', label: 'Capture non rangée', capture: '/tmp/b.png', startedAt: 200 },
      { id: 'c', label: 'Étape sans heure', capture: '/tmp/c.png', capturePiece: 'j3' },
      { id: 'd', label: 'Ni heure ni pièce', capture: '/tmp/d.png' },
    ],
    [
      { id: 'j1', name: 'a.png', mime: 'image/png', createdAt: 160 },
      { id: 'j2', name: 'illustration.png', mime: 'image/png', createdAt: 300 },
      { id: 'j3', name: 'c.png', mime: 'image/png', createdAt: 50 },
    ],
  );
  const heures = Object.fromEntries(rendu.map((c) => [c.cle, c.quand]));
  assert.deepEqual(heures, { 'jointe:j2': 300, 'etape:b': 200, 'jointe:j1': 100, 'jointe:j3': 50, 'etape:d': 0 });
  assert.equal(heures['jointe:j1'], 100, 'le début de l’étape, pas la date de rangement de la pièce');
});

test('une capture rangée en cours de tour garde le repère « vue » posé sous sa première clé', () => {
  const etape = { id: 'a', label: 'Capture', capture: '/tmp/image.png', startedAt: 10 };
  const [avant] = capturesDuFlux([etape], []);
  assert.equal(avant.cle, 'etape:a');
  assert.deepEqual(clesDeVue(avant), ['etape:a']);
  // L'utilisateur l'ouvre en grand : elle est retenue sous sa clé du moment.
  const vues = new Set(clesDeVue(avant));

  // Le démon la range : sa clé devient celle de la pièce.
  const [apres] = capturesDuFlux([{ ...etape, capturePiece: 'j1' }], [{ id: 'j1', name: 'ma-carte-image.png', mime: 'image/png', createdAt: 11 }]);
  assert.equal(apres.cle, 'jointe:j1');
  assert.deepEqual(clesDeVue(apres), ['jointe:j1', 'etape:a']);
  assert.ok(captureDejaVue(apres, vues), 'le repère survit au changement de clé');

  // Une image jamais ouverte, et une pièce sans étape, ne sont pas vues.
  const [autre] = capturesDuFlux([], [{ id: 'j2', name: 'autre.png', mime: 'image/png' }]);
  assert.deepEqual(clesDeVue(autre), ['jointe:j2']);
  assert.equal(captureDejaVue(autre, vues), false);
});

test('une longue liste de clés part en tranches, sans doublon ni clé hors borne', () => {
  const cles = [...Array.from({ length: 1100 }, (_, i) => `jointe:${i}`), 'jointe:0', '', 'x'.repeat(201)];
  const tranches = tranchesDeCles(cles);
  assert.deepEqual(tranches.map((t) => t.length), [500, 500, 100]);
  assert.equal(new Set(tranches.flat()).size, 1100);
  assert.deepEqual(tranchesDeCles([]), []);
});

test('« pas encore vues » ne garde que les images jamais ouvertes, sous l’une ou l’autre de leurs clés', () => {
  const etapes = [
    { id: 'a', label: 'A', capture: '/tmp/a.png', capturePiece: 'j1', startedAt: 10 },
    { id: 'b', label: 'B', capture: '/tmp/b.png', startedAt: 20 },
  ];
  const jointes = [
    { id: 'j1', name: 'a.png', mime: 'image/png', createdAt: 11 },
    { id: 'j2', name: 'c.png', mime: 'image/png', createdAt: 30 },
  ];
  const captures = capturesDuFlux(etapes, jointes);
  assert.deepEqual(captures.map((c) => c.cle), ['jointe:j2', 'etape:b', 'jointe:j1']);

  assert.deepEqual(capturesPasEncoreVues(captures, new Set()).map((c) => c.cle), ['jointe:j2', 'etape:b', 'jointe:j1']);
  // Ouverte AVANT son rangement : retenue sous « etape:a », donc vue sous « jointe:j1 » aussi.
  assert.deepEqual(capturesPasEncoreVues(captures, new Set(['etape:a', 'etape:b'])).map((c) => c.cle), ['jointe:j2']);
  assert.deepEqual(capturesPasEncoreVues(captures, new Set(['jointe:j2', 'etape:b', 'jointe:j1'])), []);
});

test('« tout marquer comme vu » rend les deux clés de chaque image pas encore vue, sans doublon', () => {
  const captures = capturesDuFlux(
    [{ id: 'a', label: 'A', capture: '/tmp/a.png', capturePiece: 'j1', startedAt: 10 }],
    [
      { id: 'j1', name: 'a.png', mime: 'image/png', createdAt: 11 },
      { id: 'j2', name: 'c.png', mime: 'image/png', createdAt: 30 },
    ],
  );
  assert.deepEqual(clesAMarquerVues(captures, new Set()).sort(), ['etape:a', 'jointe:j1', 'jointe:j2']);
  assert.deepEqual(clesAMarquerVues(captures, new Set(['jointe:j2'])).sort(), ['etape:a', 'jointe:j1']);
  assert.deepEqual(clesAMarquerVues(captures, new Set(['jointe:j1', 'jointe:j2'])), [], 'tout est vu : rien à envoyer');
  // Plusieurs centaines d'images : toutes les clés partent, en tranches du protocole.
  const beaucoup = capturesDuFlux([], Array.from({ length: 1200 }, (_, i) => ({ id: `p${i}`, name: `i${i}.png`, mime: 'image/png', createdAt: i })));
  const cles = clesAMarquerVues(beaucoup, new Set());
  assert.equal(cles.length, 1200);
  assert.deepEqual(tranchesDeCles(cles).map((t) => t.length), [500, 500, 200]);
});

test('le badge de la bande repliée compte les images arrivées après le repli, jamais celles d’heure inconnue', () => {
  const captures = capturesDuFlux(
    [
      { id: 'a', label: 'Avant', capture: '/tmp/a.png', startedAt: 100 },
      { id: 'b', label: 'Après', capture: '/tmp/b.png', startedAt: 300 },
      { id: 'c', label: 'Sans heure', capture: '/tmp/c.png' },
    ],
    [{ id: 'j1', name: 'j1.png', mime: 'image/png', createdAt: 400 }],
  );
  assert.equal(capturesArriveesDepuis(captures, 200), 2);
  assert.equal(capturesArriveesDepuis(captures, 300), 1);
  assert.equal(capturesArriveesDepuis(captures, 500), 0);
  // Aucun moment de repli connu : rien à compter, même les images d'heure inconnue.
  assert.equal(capturesArriveesDepuis(captures, 0), 0);
  assert.equal(capturesArriveesDepuis([], 200), 0);
});

test("la bande prend aussi les vidéos, les sons et les PDF de l'agent, marqués par leur genre", () => {
  const rendu = capturesDuFlux(
    [],
    [
      { id: 'v', name: 'film.mp4', mime: 'video/mp4', createdAt: 3 },
      { id: 's', name: 'voix.mp3', mime: 'audio/mpeg', createdAt: 2 },
      { id: 'i', name: 'vue.png', mime: 'image/png', createdAt: 1 },
      { id: 'p', name: 'note.pdf', mime: 'application/pdf', createdAt: 4 },
    ],
  );
  assert.deepEqual(
    rendu.map((c) => [c.cle, c.genre === 'jointe' ? c.media ?? 'image' : 'etape']),
    [
      ['jointe:p', 'pdf'],
      ['jointe:v', 'video'],
      ['jointe:s', 'son'],
      ['jointe:i', 'image'],
    ],
  );
  assert.equal(genreDeMedia('AUDIO/wav'), 'son');
  assert.equal(genreDeMedia('application/pdf'), 'pdf');
  assert.equal(genreDeMedia('text/plain'), null);
});
