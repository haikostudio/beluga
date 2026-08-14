import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COUVERTURE_VECTEURS_MIN,
  DIMENSIONS_VECTEUR,
  PLAFOND_PASSAGE_SIGNES,
  PRIORITE,
  attenteAvantEssai,
  choisirPassages,
  classerPassages,
  cosinus,
  decouperCodeEnPassages,
  estFichierDeCode,
  modeDeRecherche,
  normaliserLeVecteur,
  reponseRejouable,
  texteAVectoriser,
  vecteurUtilisable,
  type PassageClasse,
  type PassageIndexe,
} from '@haikodev/shared';

/*
 * LES RÈGLES DE LA RECHERCHE PAR LE SENS, éprouvées SEULES : aucun réseau,
 * aucune base, aucune clé. Ce qui touche au fournisseur est éprouvé pour de vrai
 * par `scripts/verif-recherche-passages.mjs`.
 */

/* ------------------------------------------------------------------ */
/* Le format des vecteurs                                              */
/* ------------------------------------------------------------------ */

function vecteurDEssai(remplir: (i: number) => number): number[] {
  return Array.from({ length: DIMENSIONS_VECTEUR }, (_, i) => remplir(i));
}

test('un vecteur normalisé est de longueur 1, et un vecteur nul le reste', () => {
  const norme = normaliserLeVecteur(vecteurDEssai((i) => (i % 7) - 3));
  assert.ok(Math.abs(cosinus(norme, norme) - 1) < 1e-9, 'son cosinus avec lui-même vaut 1');
  assert.deepEqual(normaliserLeVecteur([0, 0, 0]), [0, 0, 0], 'un vecteur nul ne se divise pas par zéro');
});

test('un vecteur de mauvaise taille, ou tout à zéro, n’est pas utilisable', () => {
  assert.equal(vecteurUtilisable(undefined), false);
  assert.equal(vecteurUtilisable([1, 2, 3]), false, 'mauvaise taille');
  assert.equal(vecteurUtilisable(vecteurDEssai(() => 0)), false, 'tout à zéro');
  assert.equal(vecteurUtilisable(vecteurDEssai((i) => i + 1)), true);
  assert.equal(vecteurUtilisable(Float32Array.from(vecteurDEssai((i) => i + 1))), true, 'les flottants 32 bits aussi');
});

test('le texte vectorisé porte la source et le titre DEVANT le corps', () => {
  const texte = texteAVectoriser({ source: 'docs/regles/cartes.md', titre: 'Une carte naît', texte: 'Corps.' });
  assert.match(texte, /^docs\/regles\/cartes\.md — Une carte naît/);
  assert.match(texte, /Corps\.$/);
});

/* ------------------------------------------------------------------ */
/* Quand on bascule sur le sens, et quand on ne bascule pas            */
/* ------------------------------------------------------------------ */

const BON_VECTEUR = vecteurDEssai((i) => Math.sin(i));

test('sans vecteur de question, la recherche reste sur les mots — et le dit', () => {
  const mode = modeDeRecherche({ vecteurQuestion: undefined, total: 100, vectorises: 100 });
  assert.equal(mode.vecteurs, false);
  assert.match(mode.raison ?? '', /vectorisée/);
});

test('un index à moitié vectorisé ne bascule pas : les deux échelles ne se comparent pas', () => {
  const mode = modeDeRecherche({ vecteurQuestion: BON_VECTEUR, total: 100, vectorises: 50 });
  assert.equal(mode.vecteurs, false);
  assert.match(mode.raison ?? '', /50 %/);
  const assez = modeDeRecherche({
    vecteurQuestion: BON_VECTEUR,
    total: 100,
    vectorises: Math.ceil(COUVERTURE_VECTEURS_MIN * 100),
  });
  assert.equal(assez.vecteurs, true);
  assert.equal(assez.raison, undefined);
});

test('un index vide ne bascule jamais', () => {
  assert.equal(modeDeRecherche({ vecteurQuestion: BON_VECTEUR, total: 0, vectorises: 0 }).vecteurs, false);
});

/* ------------------------------------------------------------------ */
/* Le classement par le sens réel                                      */
/* ------------------------------------------------------------------ */

function passage(source: string, texte: string, vecteur?: number[]): PassageIndexe {
  return { source, titre: '', sujet: 's', priorite: PRIORITE.normale, texte, empreinte: [], vecteur };
}

test('en mode vecteurs, c’est le VECTEUR qui classe, pas les mots communs', () => {
  const proche = vecteurDEssai((i) => Math.sin(i));
  const loin = vecteurDEssai((i) => Math.cos(i * 3));
  const classes = classerPassages(
    [
      passage('loin.md', 'Un texte qui parle de tout autre chose.', normaliserLeVecteur(loin)),
      passage('proche.md', 'Un texte qui parle de tout autre chose.', normaliserLeVecteur(proche)),
    ],
    'la question posée',
    { vecteurQuestion: normaliserLeVecteur(proche), poids: { sens: 0.7, mots: 0.3 } },
  );
  assert.equal(classes[0].source, 'proche.md');
  assert.ok(classes[0].sens > classes[1].sens);
});

test('un passage encore sans vecteur ne perd que le sens, jamais ses mots exacts', () => {
  const classes = classerPassages(
    [passage('sans.md', 'Le fichier carte-sql.ts range les colonnes.', undefined)],
    'carte-sql.ts',
    { vecteurQuestion: BON_VECTEUR, poids: { sens: 0.7, mots: 0.3 } },
  );
  assert.equal(classes[0].sens, 0, 'aucun sens sans vecteur');
  assert.ok(classes[0].mots > 0, 'mais les mots exacts comptent toujours');
});

/* ------------------------------------------------------------------ */
/* Le code ne prend pas toute la place                                 */
/* ------------------------------------------------------------------ */

function classe(source: string, priorite: number, score: number): PassageClasse {
  return { source, titre: '', sujet: 's', priorite, texte: 'x'.repeat(40), score, sens: score, mots: 0, jetons: 10 };
}

test('deux passages de code au plus, même s’ils sont les mieux classés', () => {
  const choix = choisirPassages(
    [
      classe('a.ts', PRIORITE.code, 0.9),
      classe('b.ts', PRIORITE.code, 0.8),
      classe('c.ts', PRIORITE.code, 0.7),
      classe('docs/regles/cartes.md', PRIORITE.regle, 0.6),
    ],
    { maxCode: 2, plafond: 1000 },
  );
  assert.equal(choix.gardes.filter((p) => p.priorite === PRIORITE.code).length, 2);
  assert.ok(choix.gardes.some((p) => p.source.startsWith('docs/')), 'la documentation garde sa place');
});

/* ------------------------------------------------------------------ */
/* Quels fichiers entrent dans l'index, et comment on les coupe        */
/* ------------------------------------------------------------------ */

test('les dossiers de machine et les fichiers construits restent dehors', () => {
  assert.equal(estFichierDeCode('server/src/passages.ts'), true);
  assert.equal(estFichierDeCode('web/src/styles.css'), true);
  assert.equal(estFichierDeCode('node_modules/truc/index.js'), false);
  assert.equal(estFichierDeCode('server/dist/passages.js'), false);
  assert.equal(estFichierDeCode('.worktrees/carte/server/src/a.ts'), false);
  assert.equal(estFichierDeCode('shared/dist/index.d.ts'), false);
  assert.equal(estFichierDeCode('web/public/app.min.js'), false);
  assert.equal(estFichierDeCode('README.md'), false, 'le Markdown a son propre chemin');
});

test('un fichier de code se coupe sous le plafond, chaque morceau nommé par sa déclaration', () => {
  const code = [
    'import fs from "node:fs";',
    '',
    'export function premiere() {',
    ...Array.from({ length: 90 }, (_, i) => `  const ligne${i} = "du texte assez long pour remplir le plafond";`),
    '}',
    '',
    'export function seconde() {',
    ...Array.from({ length: 90 }, (_, i) => `  const autre${i} = "du texte assez long pour remplir le plafond";`),
    '}',
  ].join('\n');
  const passages = decouperCodeEnPassages('server/src/essai.ts', code);
  assert.ok(passages.length >= 2, 'plusieurs morceaux');
  assert.ok(
    passages.every((p) => p.texte.length <= PLAFOND_PASSAGE_SIGNES),
    'aucun morceau ne dépasse le plafond',
  );
  assert.ok(passages.every((p) => p.priorite === PRIORITE.code), 'tous en priorité code');
  assert.ok(
    passages.some((p) => p.titre === 'premiere') && passages.some((p) => p.titre === 'seconde'),
    'les déclarations donnent les titres',
  );
});

/* ------------------------------------------------------------------ */
/* Les pannes du fournisseur                                           */
/* ------------------------------------------------------------------ */

test('on retente une surcharge, jamais un refus franc', () => {
  assert.equal(reponseRejouable(429), true);
  assert.equal(reponseRejouable(500), true);
  assert.equal(reponseRejouable(401), false, 'clé invalide : le repli tout de suite');
  assert.equal(reponseRejouable(400), false);
  assert.ok(attenteAvantEssai(2) > attenteAvantEssai(1), 'l’attente double');
});
