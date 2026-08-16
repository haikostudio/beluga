import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleDeVecteur,
  sommaireDesSujets,
  texteDesPassages,
  texteDuSommaire,
  vecteursRepris,
  type PassageClasse,
} from '@haikodev/shared';

/*
 * DEUX RÈGLES QUI TIENNENT LA QUALITÉ DE CE QUI PART AU MOTEUR.
 *
 * 1. UN PASSAGE INCHANGÉ GARDE SON VECTEUR. L'indexation est incrémentale par
 *    FICHIER : un fichier réécrit d'une ligne perdait les vecteurs de tous ses
 *    passages. Sur HaikoDev — dont la documentation est réécrite par presque
 *    chaque carte —, 390 passages sur 824 étaient sans vecteur le 16/08/2026,
 *    l'index retombait sous le seuil de couverture, et TOUTE la recherche
 *    repassait sur les mots.
 * 2. LE SOMMAIRE DES SUJETS VOYAGE AVEC LES PASSAGES. La recherche remplace
 *    l'index de la mémoire ; sans la liste des sujets, l'agent à qui on dit
 *    « demande le sujet de ta tâche » devine un nom.
 */

const passage = (titre: string, texte: string): PassageClasse => ({
  source: 'docs/regles/publication.md',
  titre,
  sujet: 'publication',
  priorite: 2,
  texte,
  score: 0.5,
  sens: 0.4,
  mots: 0.1,
  jetons: Math.round(texte.length / 4),
});

test('un passage dont le titre et le texte n’ont pas bougé garde son vecteur', () => {
  const anciens = [
    { titre: 'Lancer', texte: 'npm run build', vecteur: 'V1', modele: 'bge' },
    { titre: 'Publier', texte: 'jamais de sa propre initiative', vecteur: 'V2', modele: 'bge' },
  ];
  const repris = vecteursRepris(anciens, [
    { titre: 'Lancer', texte: 'npm run build' },
    { titre: 'Publier', texte: 'jamais SANS un geste de l’utilisateur' },
  ]);

  assert.deepEqual(repris[0], { vecteur: 'V1', modele: 'bge' });
  assert.equal(repris[1], undefined, 'le passage réécrit repart sans vecteur');
});

test('un passage déplacé dans le fichier garde son vecteur : le rang ne compte pas', () => {
  const anciens = [
    { titre: 'A', texte: 'premier', vecteur: 'VA', modele: 'bge' },
    { titre: 'B', texte: 'second', vecteur: 'VB', modele: 'bge' },
  ];
  // Une section insérée en tête décale tout : c'est le cas le plus courant.
  const repris = vecteursRepris(anciens, [
    { titre: 'Neuf', texte: 'inséré' },
    { titre: 'A', texte: 'premier' },
    { titre: 'B', texte: 'second' },
  ]);

  assert.equal(repris[0], undefined);
  assert.deepEqual(repris[1], { vecteur: 'VA', modele: 'bge' });
  assert.deepEqual(repris[2], { vecteur: 'VB', modele: 'bge' });
});

test('rien n’est repris d’un passage sans vecteur ou vectorisé par un autre modèle', () => {
  const repris = vecteursRepris(
    [
      { titre: 'A', texte: 'texte', vecteur: null, modele: 'bge' },
      { titre: 'B', texte: 'texte', vecteur: 'VB', modele: null },
    ],
    [
      { titre: 'A', texte: 'texte' },
      { titre: 'B', texte: 'texte' },
    ],
  );
  assert.deepEqual(repris, [undefined, undefined]);
});

test('un même texte présent deux fois ne rend son vecteur qu’une fois', () => {
  const repris = vecteursRepris(
    [{ titre: 'A', texte: 'identique', vecteur: 'V', modele: 'bge' }],
    [
      { titre: 'A', texte: 'identique' },
      { titre: 'A', texte: 'identique' },
    ],
  );
  assert.deepEqual(repris[0], { vecteur: 'V', modele: 'bge' });
  assert.equal(repris[1], undefined, 'le second attendra la passe suivante');
});

test('la clé de reprise ignore les espaces de bord, jamais le contenu', () => {
  assert.equal(cleDeVecteur(' Titre ', ' texte '), cleDeVecteur('Titre', 'texte'));
  assert.notEqual(cleDeVecteur('Titre', 'texte'), cleDeVecteur('Titre', 'texte.'));
});

test('le sommaire nomme chaque sujet, son libellé et son poids', () => {
  const faits = [
    'La publication ne part jamais toute seule',
    'Une carte naît dans « Planifié »',
    'Une carte porte sa branche',
  ];
  const sujets = sommaireDesSujets(faits);
  assert.ok(sujets.length >= 1);
  assert.equal(
    sujets.reduce((total, s) => total + s.faits, 0),
    faits.length,
    'aucun fait ne se perd entre les sujets',
  );

  const texte = texteDuSommaire(faits);
  assert.match(texte, /project_memory/);
  for (const sujet of sujets) assert.ok(texte.includes(`« ${sujet.id} »`), `le sujet ${sujet.id} est nommé`);
});

test('une mémoire vide ne rend aucun sommaire', () => {
  assert.equal(texteDuSommaire([]), '');
  assert.deepEqual(sommaireDesSujets([]), []);
});

test('le bloc des passages porte le sommaire quand on le lui donne, et rien de plus sans lui', () => {
  const trouves = [passage('Publier', 'La mise en ligne est un geste de l’utilisateur.')];
  const sommaire = texteDuSommaire(['La publication ne part jamais toute seule']);

  const avec = texteDesPassages(trouves, 12, sommaire);
  assert.ok(avec.includes(sommaire), 'le sommaire est bien dans le bloc envoyé');
  assert.match(avec, /passages retrouvés pour CETTE tâche/);

  const sans = texteDesPassages(trouves, 12);
  assert.ok(!sans.includes('LES SUJETS DE LA MÉMOIRE'), 'sans sommaire, le bloc ne l’invente pas');
  assert.ok(avec.length > sans.length);
});

test('sans passage, il n’y a pas de bloc — même avec un sommaire', () => {
  assert.equal(texteDesPassages([], 12, texteDuSommaire(['un fait'])), '');
});
