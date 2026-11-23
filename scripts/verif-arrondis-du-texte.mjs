#!/usr/bin/env node
/*
 * UN ARRONDI PLEIN N'ENFERME JAMAIS UN LIBELLÉ.
 *
 * Contrôle STATIQUE, sans navigateur, sans base, sans moteur : il ne lit que des fichiers.
 *
 * POURQUOI. `rounded-full` demande au navigateur la MOITIÉ de la hauteur de l'élément. Sur une
 * pastille d'une seule ligne, cela donne une gélule — discutable mais supportable. Dès que le
 * libellé passe à DEUX lignes, la hauteur double et la courbe devient énorme : la pastille est plus
 * ronde que la carte qui la contient, et l'écran paraît cassé. Le cas a été photographié sur les
 * options d'une question (`web/src/components/flux-en-points.tsx`).
 *
 * LA RÈGLE. Un arrondi plein est réservé aux formes réellement CIRCULAIRES (point d'état, rond de
 * ligne de temps, bouton icône carré, pastille de notification) et aux BARRES (jauge, barre de
 * progression, poignée de tiroir). Tout conteneur de TEXTE prend l'arrondi maison — `rounded-lg`,
 * redéfini à 10 px dans `web/tailwind.config.js`, la même courbe que les cartes et les blocs.
 *
 * CE QUI EST JUGÉ. Un `rounded-full` qui cohabite, dans le même bloc de classes, avec un padding
 * HORIZONTAL (`px-…`) et une taille de TEXTE (`text-[…]`, `text-xs`…) : la signature exacte de la
 * gélule. Les exceptions légitimes sont NOMMÉES ci-dessous, une par une, avec leur raison — on n'en
 * ajoute pas sans l'écrire.
 *
 * Le contrôle vise le dépôt d'où il PART (`import.meta.url`), jamais un chemin en dur : lancé depuis
 * une copie de travail, il doit juger cette copie et non le dossier principal.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(RACINE, 'web', 'src');

/**
 * LES EXCEPTIONS ASSUMÉES — fichier, puis le repère qui doit se trouver sur la ligne. Chacune est
 * une forme réellement ronde qui porte un ou deux CHIFFRES, jamais une phrase : son libellé ne peut
 * pas passer à la ligne, donc la gélule ne peut pas apparaître.
 */
const EXCEPTIONS = [
  {
    fichier: 'components/ui/index.tsx',
    repere: 'h-4 min-w-4',
    raison: 'la Pastille de compte : un ou deux chiffres dans un rond (h-4 min-w-4)',
  },
  {
    fichier: 'components/ui/index.tsx',
    repere: 'min-w-[15px]',
    raison: "la pastille de notification posée dans le coin d'un bouton",
  },
  /* Le compte des pièces jointes d'une demande (`espace/tiroir-demande.tsx`) est
     passé sur la `Pastille` commune : son exception n'a plus lieu d'être. */
];

/* Les classes de taille de texte de Tailwind, plus la forme entre crochets du projet. */
const TEXTE = /\btext-(?:\[[^\]]+\]|xs\b|sm\b|base\b|lg\b|xl\b|\dxl\b)/;
const PADDING_H = /\bpx-[\d.[]/;

const resultats = [];
const verifier = (nom, ok, detail) => {
  resultats.push(ok);
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/** Tous les fichiers d'interface du dépôt, sans dist ni node_modules. */
function fichiers(dossier) {
  const sortie = [];
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    const complet = path.join(dossier, entree.name);
    if (entree.isDirectory()) {
      if (entree.name === 'node_modules' || entree.name === 'dist') continue;
      sortie.push(...fichiers(complet));
    } else if (/\.tsx?$/.test(entree.name)) {
      sortie.push(complet);
    }
  }
  return sortie;
}

console.log('\nLES ARRONDIS : PLEIN POUR LES RONDS, MAISON POUR LE TEXTE\n');

if (!fs.existsSync(SOURCE)) {
  console.log("  Pas de dossier web/src dans ce dépôt : rien à juger.");
  process.exit(0);
}

const coupables = [];
let emplois = 0;

for (const fichier of fichiers(SOURCE)) {
  const relatif = path.relative(path.join(RACINE, 'web', 'src'), fichier).split(path.sep).join('/');
  const lignes = fs.readFileSync(fichier, 'utf8').split('\n');
  for (let i = 0; i < lignes.length; i += 1) {
    if (!lignes[i].includes('rounded-full')) continue;
    emplois += 1;

    /*
     * LE BLOC DE CLASSES, PAS LA SEULE LIGNE. Un `cn(…)` étale souvent l'arrondi sur une ligne et
     * son padding sur la suivante (`telephone ? 'h-10' : 'px-3 py-1.5'`). On regarde donc une
     * petite fenêtre, arrêtée dès que l'expression se referme.
     */
    const bloc = [lignes[i]];
    for (let j = i + 1; j < Math.min(i + 5, lignes.length); j += 1) {
      const suite = lignes[j];
      if (/^\s*(\)|\}|>|\/>|<)/.test(suite) || !suite.trim()) break;
      bloc.push(suite);
    }
    const texte = bloc.join(' ');
    if (!(PADDING_H.test(texte) && TEXTE.test(texte))) continue;

    const excuse = EXCEPTIONS.find((e) => e.fichier === relatif && texte.includes(e.repere));
    if (excuse) continue;
    coupables.push(`${relatif}:${i + 1}`);
  }
}

verifier(
  'aucun `rounded-full` autour d’un libellé',
  coupables.length === 0,
  coupables.length
    ? `à passer en rounded-lg : ${coupables.join(', ')}`
    : `${emplois} emplois de rounded-full relus, ${EXCEPTIONS.length} exceptions nommées`,
);

/*
 * L'ARRONDI MAISON VAUT BIEN 10 px. Si quelqu'un ramenait `rounded-lg` aux 8 px de Tailwind, toutes
 * les pastilles basculées ci-dessus changeraient de courbe sans que personne ne s'en aperçoive.
 */
const config = fs.readFileSync(path.join(RACINE, 'web', 'tailwind.config.js'), 'utf8');
verifier("l'arrondi maison `rounded-lg` vaut 10 px", /lg:\s*'10px'/.test(config), 'web/tailwind.config.js');

/*
 * UN CALQUE POSÉ EN `-inset-px` SUIT LE RAYON DE SON HÔTE, PLUS UN PIXEL. Au-dessus d'un bloc en
 * 10 px, il prend 11 px — jamais `rounded-full`, qui dessinerait une gélule par-dessus un carré.
 */
const calques = [];
for (const fichier of fichiers(SOURCE)) {
  const relatif = path.relative(path.join(RACINE, 'web', 'src'), fichier).split(path.sep).join('/');
  const lignes = fs.readFileSync(fichier, 'utf8').split('\n');
  lignes.forEach((ligne, i) => {
    if (ligne.includes('-inset-px') && ligne.includes('rounded-full')) calques.push(`${relatif}:${i + 1}`);
  });
}
verifier(
  'aucun calque `-inset-px` en arrondi plein',
  calques.length === 0,
  calques.length ? calques.join(', ') : 'les calques suivent le rayon de leur hôte',
);

/* ------------------------------------------------------------------ */

const echecs = resultats.filter((ok) => !ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles passés.\n`);
process.exit(echecs ? 1 : 0);
