/**
 * LA COMPRÉHENSION RANGÉE EN POINTS — ouverture, SOMMAIRE numéroté, puis
 * « **1. Intitulé** — explication », « Comment : … », « Résultat : … ».
 *
 * Le gabarit est TOLÉRANT par construction, et il doit le rester des DEUX
 * côtés : les compréhensions d'avant, sans sommaire ni numéro ni sous-parties,
 * continuent de se ranger comme avant ; celles d'aujourd'hui, écrites en TEXTE
 * LIBRE depuis que le cadrage n'impose plus de découpe, se rendent entières
 * sans être hachées ni perdues. Un tour de cadrage perdu coûte cher.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rangerLaComprehension } from '@beluga/shared';

const ANCIENNE = [
  'Vous voulez un fil de carte plus calme.',
  '',
  '**Points gris** — les petits ronds à icône deviennent des points de 5 pixels.',
  '',
  '**Compréhension en points** : elle se lit comme le compte rendu.',
  '',
  'Un paragraphe de suite, rattaché au point précédent.',
  '',
  '**Icônes :** les emojis des sommaires disparaissent.',
].join('\n');

const NOUVELLE = [
  'Vous voulez des compréhensions plus détaillées.',
  '',
  '1. Un sommaire en tête, une phrase par demande.',
  '2. Chaque point repris dessous, avec son numéro.',
  '',
  '**1. Le sommaire en tête** — toutes les demandes tiennent sur une ligne chacune.',
  'Comment : la liste se pose sous la phrase d’ouverture du point « Compréhension ».',
  'Résultat : on voit tout ce qui a été demandé sans rien déplier.',
  '',
  '**2. La reprise point par point** — chaque ligne du sommaire a son bloc.',
  '',
  'Comment : le numéro se pose devant l’intitulé, dans le fil de la carte.',
  '',
  'Résultat : on retrouve d’un coup d’œil à quelle demande un point répond.',
].join('\n');

test('la phrase d’ouverture reste en tête, chaque intitulé en gras devient un point', () => {
  const range = rangerLaComprehension(ANCIENNE);
  assert.equal(range.conforme, true);
  assert.equal(range.ouverture, 'Vous voulez un fil de carte plus calme.');
  assert.deepEqual(
    range.points.map((p) => p.intitule),
    ['Points gris', 'Compréhension en points', 'Icônes'],
  );
  assert.equal(range.points[0].corps, 'les petits ronds à icône deviennent des points de 5 pixels.');
  assert.match(range.points[1].corps, /compte rendu\.\n\nUn paragraphe de suite/);
  assert.equal(range.points[2].corps, 'les emojis des sommaires disparaissent.');
});

test('une compréhension d’avant n’a ni sommaire, ni référence, ni sous-parties', () => {
  const range = rangerLaComprehension(ANCIENNE);
  assert.deepEqual(range.sommaire, []);
  for (const point of range.points) {
    assert.equal(point.reference, undefined);
    assert.equal(point.comment, undefined);
    assert.equal(point.resultat, undefined);
    /* Faute de sous-parties, l'explication EST le corps : l'écran n'y perd rien. */
    assert.equal(point.explication, point.corps);
  }
});

test('le sommaire numéroté est isolé, marqueurs retirés', () => {
  const range = rangerLaComprehension(NOUVELLE);
  assert.equal(range.ouverture, 'Vous voulez des compréhensions plus détaillées.');
  assert.deepEqual(range.sommaire, [
    'Un sommaire en tête, une phrase par demande.',
    'Chaque point repris dessous, avec son numéro.',
  ]);
});

test('le numéro de l’intitulé devient la référence, et le libellé reste seul', () => {
  const range = rangerLaComprehension(NOUVELLE);
  assert.equal(range.conforme, true);
  assert.deepEqual(
    range.points.map((p) => [p.reference, p.intitule]),
    [
      ['1', 'Le sommaire en tête'],
      ['2', 'La reprise point par point'],
    ],
  );
});

test('la manière et le résultat se détachent du corps, en lignes comme en paragraphes', () => {
  const [premier, second] = rangerLaComprehension(NOUVELLE).points;
  assert.equal(premier.explication, 'toutes les demandes tiennent sur une ligne chacune.');
  assert.equal(premier.comment, 'la liste se pose sous la phrase d’ouverture du point « Compréhension ».');
  assert.equal(premier.resultat, 'on voit tout ce qui a été demandé sans rien déplier.');
  assert.equal(second.explication, 'chaque ligne du sommaire a son bloc.');
  assert.equal(second.comment, 'le numéro se pose devant l’intitulé, dans le fil de la carte.');
  assert.equal(second.resultat, 'on retrouve d’un coup d’œil à quelle demande un point répond.');
  /* Le corps ENTIER reste disponible en repli. */
  assert.match(premier.corps, /Comment : la liste se pose/);
});

test('la phrase d’ouverture collée au sommaire, sans ligne vide, reste l’ouverture', () => {
  const range = rangerLaComprehension(
    ['Vous demandez deux choses.', '1. La première.', '2. La seconde.', '', '**1. Un** — a.', '', '**2. Deux** — b.'].join('\n'),
  );
  assert.equal(range.ouverture, 'Vous demandez deux choses.');
  assert.deepEqual(range.sommaire, ['La première.', 'La seconde.']);
});

test('un paragraphe de prose ne se prend pas pour un sommaire', () => {
  const range = rangerLaComprehension(
    ['Vous voulez ceci.', '', 'Et cela aussi, dit en prose.', '', '**Un** — a.', '', '**Deux** — b.'].join('\n'),
  );
  assert.deepEqual(range.sommaire, []);
  assert.match(range.ouverture, /Et cela aussi/);
});

test('une ancienne compréhension sans intitulés n’est pas conforme', () => {
  const range = rangerLaComprehension('Un texte simple.\n\nSur deux paragraphes, sans gras.');
  assert.equal(range.conforme, false);
  assert.equal(range.points.length, 0);
});

test('un seul intitulé ne fait pas un fil, et un gras en plein texte n’ouvre pas de point', () => {
  assert.equal(rangerLaComprehension('Ouverture.\n\n**Seul** — un point.').conforme, false);
  assert.equal(rangerLaComprehension('Ceci est **important** — vraiment.\n\nEt ceci **aussi**.').points.length, 0);
});

/**
 * UNE COMPRÉHENSION D'AUJOURD'HUI : développée, en paragraphes, sans sommaire
 * ni intitulé ni rubrique. Le cadrage n'impose plus de gabarit — c'est ce texte
 * qui doit traverser le rangement SANS PERTE, pour que l'écran le rende d'un
 * trait au lieu de chercher des volets qui n'existent pas.
 */
const TEXTE_LIBRE = [
  'Vous trouvez les compréhensions trop pauvres : elles ressemblent à un formulaire rempli plutôt qu’à une vraie réponse, et vous voulez retrouver le ton d’une conversation directe.',
  '',
  'En regardant comment la carte est écrite aujourd’hui, deux freins ressortent. Le premier tient à la découpe imposée : chaque idée devait tenir en une ligne de sommaire puis en deux lignes types, si bien que le raisonnement n’avait nulle part où s’écrire. Le second tient aux limites de longueur posées un peu partout, qui coupaient la réponse avant qu’elle ait dit quoi que ce soit d’utile.',
  '',
  'Ce qui change, c’est l’attente : on demande désormais du fond — ce qui est demandé, pourquoi, ce qui a été constaté, la manière, le résultat attendu, les points délicats — et plus une mise en page. La règle du langage courant, elle, ne bouge pas : plus long ne veut pas dire plus technique.',
  '',
  'Vous verrez donc, avant chaque lancement, un texte qui se lit comme une réponse écrite pour vous, de la longueur qu’appelle la demande.',
].join('\n');

test('une compréhension en texte libre se rend entière, sans volet ni découpe', () => {
  const range = rangerLaComprehension(TEXTE_LIBRE);
  /* Pas de volets : l'écran bascule sur le rendu en paragraphes. */
  assert.equal(range.conforme, false);
  assert.equal(range.points.length, 0);
  assert.deepEqual(range.sommaire, []);
  /* RIEN NE SE PERD : les quatre paragraphes sont là, dans l'ordre, séparés. */
  assert.equal(range.ouverture.split('\n\n').length, 4);
  assert.match(range.ouverture, /trop pauvres/);
  assert.match(range.ouverture, /de la longueur qu’appelle la demande\.$/);
});

test('un texte libre qui pose quelques intertitres garde ses volets, sans sommaire', () => {
  const range = rangerLaComprehension(
    [
      'Voici ce que j’ai compris de votre demande, et ce que j’en ferais.',
      '',
      '**Ce que vous voulez** — des réponses complètes, qui raisonnent au lieu de cocher des cases.',
      '',
      'Le détail tient en un paragraphe de suite, rattaché au point qui précède.',
      '',
      '**Ce que je propose** — lever la découpe imposée et les limites de longueur, sans toucher au langage courant.',
    ].join('\n'),
  );
  assert.equal(range.conforme, true);
  assert.deepEqual(range.sommaire, []);
  assert.equal(range.points.length, 2);
  /* Aucun numéro imposé : la référence reste vide, et l'écran numérote lui-même. */
  assert.deepEqual(range.points.map((p) => p.reference), [undefined, undefined]);
  /* Ni « Comment » ni « Résultat » : le corps entier reste dans l'explication. */
  assert.equal(range.points[0].comment, undefined);
  assert.equal(range.points[0].resultat, undefined);
  assert.match(range.points[0].explication, /rattaché au point qui précède/);
});

test('un texte vide se range sans erreur', () => {
  assert.deepEqual(rangerLaComprehension(''), { ouverture: '', sommaire: [], points: [], conforme: false });
});
