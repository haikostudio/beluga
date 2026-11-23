import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CONSIGNE_CADRAGE,
  REGLE_DE_LA_MAQUETTE_DU_CADRAGE,
  REGLE_DE_LA_MAQUETTE_REALISTE,
  avecLeStyleDuProduit,
  enteteDeMaquette,
  jetonsDuTheme,
  pieceDuChemin,
  repereDuChemin,
  tailleDeLaMaquette,
} from '@beluga/shared';
import { TOOL_DEFS } from '../tools.js';
import { pistesLues, styleDuProduit } from '../exemples-de-choix.js';

const CSS = `:root {
    --bg: 0 0% 7.5%;
    /* un commentaire --faux: 1; */
    --text: 0 0% 93%;
    --intensite-calme: var(--faint);
  }
  html:not(.dark) {
    --bg: 0 0% 100%;
    --text: 0 0% 5%;
  }`;

test('maquette réaliste : la règle part à tout agent qui fabrique des exemples, et au cadrage (17/11/2026)', () => {
  const outil = (TOOL_DEFS as Array<{ name: string }>).find((t) => t.name === 'exemple_de_choix') as unknown as { description: string; inputSchema: any };
  assert.ok(outil.description.includes(REGLE_DE_LA_MAQUETTE_REALISTE));
  assert.match(REGLE_DE_LA_MAQUETTE_REALISTE, /TAILLE RÉELLE/);
  assert.match(REGLE_DE_LA_MAQUETTE_REALISTE, /hsl\(var\(--text\)\)/);
  assert.ok(outil.inputSchema.properties.pistes.items.properties.largeur);
  assert.ok(outil.inputSchema.properties.theme);
  assert.match(REGLE_DE_LA_MAQUETTE_DU_CADRAGE, /RÉALISTE/);
  assert.ok(CONSIGNE_CADRAGE.includes(REGLE_DE_LA_MAQUETTE_DU_CADRAGE));
});

test('maquette réaliste : la taille d’une piste est bornée, 960×640 par défaut', () => {
  assert.deepEqual(tailleDeLaMaquette(undefined, undefined), { largeur: 960, hauteur: 640 });
  assert.deepEqual(tailleDeLaMaquette(820, '300'), { largeur: 820, hauteur: 300 });
  assert.deepEqual(tailleDeLaMaquette(5000, 10), { largeur: 1600, hauteur: 120 });
  assert.deepEqual(pistesLues([{ titre: 'A', html: '<p>x</p>', largeur: 788, hauteur: 420 }])[0]?.largeur, 788);
  assert.equal(pistesLues([{ titre: 'A', html: '<p>x</p>' }])[0]?.largeur, undefined);
});

test('maquette réaliste : les jetons du thème sont lus dans la feuille du produit, le clair par-dessus le sombre', () => {
  assert.deepEqual(jetonsDuTheme(CSS, 'sombre'), { '--bg': '0 0% 7.5%', '--text': '0 0% 93%' });
  assert.deepEqual(jetonsDuTheme(CSS, 'clair'), { '--bg': '0 0% 100%', '--text': '0 0% 5%' });
  const entete = enteteDeMaquette({ jetons: jetonsDuTheme(CSS, 'sombre'), polices: ['data:font/woff2;base64,AAAA'] });
  assert.match(entete, /--text:0 0% 93%;/);
  assert.match(entete, /@font-face\{font-family:'Inter Variable'/);
  assert.match(entete, /background:hsl\(var\(--bg\)\)/);
});

test('maquette réaliste : l’en-tête se pose en tête de la page, avant les styles de l’agent', () => {
  const entete = '<style data-style-du-produit></style>';
  assert.equal(avecLeStyleDuProduit('<html><head><style>a{}</style></head><body></body></html>', entete), `<html><head>${entete}<style>a{}</style></head><body></body></html>`);
  assert.equal(avecLeStyleDuProduit('<html lang="fr"><body>x</body></html>', entete), `<html lang="fr"><head>${entete}</head><body>x</body></html>`);
  assert.match(avecLeStyleDuProduit('<div>seul</div>', entete), /^<!doctype html><html><head><meta charset="utf-8"><style data-style-du-produit><\/style><\/head><body><div>seul<\/div>/);
});

test('maquette réaliste : le démon lit la vraie police et les jetons du dépôt', () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'maquette-'));
  fs.mkdirSync(path.join(racine, 'web', 'src', 'polices'), { recursive: true });
  fs.writeFileSync(path.join(racine, 'web', 'src', 'styles.css'), CSS);
  fs.writeFileSync(path.join(racine, 'web', 'src', 'polices', 'inter-latin-wght-normal.woff2'), Buffer.from('police'));
  const entete = styleDuProduit('clair', racine);
  assert.match(entete, /--text:0 0% 5%;/);
  assert.match(entete, new RegExp(`base64,${Buffer.from('police').toString('base64')}`));
});

test('toute image du fil a sa référence : une capture rangée se retrouve par son chemin d’origine (17/11/2026)', () => {
  const pieces = [
    { id: 'a1', name: 'capture.png', alias: 'a1b2', chemins: ['/tmp/beluga-capture-12.png'] },
    { id: 'c3', name: 'logo.png', alias: 'c3d4' },
  ];
  assert.equal(pieceDuChemin('/tmp/beluga-capture-12.png', pieces)?.id, 'a1');
  assert.equal(repereDuChemin('/tmp/beluga-capture-12.png', pieces), '#a1b2');
  assert.equal(repereDuChemin('/disque/c3d4-logo.png', pieces), '#c3d4');
  assert.equal(repereDuChemin('/tmp/autre.png', pieces), null);
});
