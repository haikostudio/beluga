#!/usr/bin/env node
/*
 * CE QUE LE TRI ÉCONOMISE EST MESURÉ, ET LA MESURE EST SUIVIE — pas annoncée
 * une fois puis oubliée.
 *
 * Une mécanique se vérifie ici, sur le VRAI pool de compétences, jamais sur un
 * décor fabriqué (la mémoire en arbre de fichiers et son tri ont disparu : la
 * mémoire en classeurs se cherche à la demande) :
 *
 *  1. LES COMPÉTENCES PARTAGÉES. Le pool est servi au poids de la demande de
 *     la carte, et jamais plus lourd que la liste entière.
 *
 * Aucun moteur, aucun démon, aucune base : la mécanique toute seule.
 *
 * Le pool de compétences est une donnée d'exécution : le script le lit dans
 * `BELUGA_COMPETENCES` s'il est posé, sinon sous le dépôt. Sans pool, ce volet
 * le DIT et se saute — la traduction avec lui —, il ne se fabrique pas un décor.
 *
 *   node scripts/verif-economie-du-tri.mjs
 *   BELUGA_COMPETENCES=/root/beluga/data/competences node scripts/verif-economie-du-tri.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Le dépôt d'où PART ce script, jamais un chemin en dur. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const partage = await import(path.join(RACINE, 'shared/dist/index.js'));

const echecs = [];
function verifier(condition, message) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    console.error(`  ✗ ${message}`);
    echecs.push(message);
  }
}

/** Une mesure lisible : signes, et jetons au rapport mesuré de cette doc. */
function poids(signes) {
  return `${signes.toLocaleString('fr-FR')} signes (~${Math.round(signes / partage.SIGNES_PAR_JETON).toLocaleString('fr-FR')} jetons)`;
}

/* Une carte à portée étroite : c'est elle qui trie le pool. */
const CARTE_ETROITE =
  'Le bouton « Publier maintenant » reste allumé pendant la mise en ligne\n' +
  'Constat : le bouton de publication ne s’éteint pas au clic, on peut le cliquer deux fois.';

/* ------------------------------------------------------------------ */
/* 1. LES COMPÉTENCES PARTAGÉES, AU POIDS DE LA DEMANDE                 */
/* ------------------------------------------------------------------ */

console.log('\n1. Le pool de compétences est servi au poids de la demande\n');

/* Le pool est une donnée d'EXÉCUTION, pas du contenu de dépôt : on le lit là où
   le démon le lit (`BELUGA_COMPETENCES`), et à défaut sous le dépôt. */
const dossierPool = process.env.BELUGA_COMPETENCES || path.join(RACINE, 'data', 'competences');
const competences = fs.existsSync(dossierPool)
  ? fs
      .readdirSync(dossierPool, { withFileTypes: true })
      .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && fs.existsSync(path.join(dossierPool, e.name, 'SKILL.md')))
      .map((e) => {
        const tete = partage.enTeteDeCompetence(fs.readFileSync(path.join(dossierPool, e.name, 'SKILL.md'), 'utf8'));
        return {
          nom: tete?.nom || e.name,
          description: tete?.description ?? '',
          dossier: path.join(dossierPool, e.name),
          fichier: path.join(dossierPool, e.name, 'SKILL.md'),
          etat: partage.etatDeFiche(tete?.etat),
          themes: tete?.themes ?? [],
          symptomes: tete?.symptomes ?? [],
          projets: tete?.projets ?? [],
          anomalies: [],
        };
      })
  : [];

/* Les deux poids du pool, entier et trié : la traduction en quota (volet 2) se
   mesure sur eux, jamais sur un chiffre posé à la main. */
let poolEntier = '';
let poolTrie = '';
if (!competences.length) {
  console.log('  (aucune compétence sur ce dépôt : rien à mesurer ici)');
} else {
  poolEntier = partage.texteDesCompetences(competences, dossierPool);
  poolTrie = partage.texteDesCompetences(competences, dossierPool, CARTE_ETROITE);
  console.log(`  pool servi SANS carte : ${poids(poolEntier.length)} pour ${competences.length} fiches`);
  console.log(`  pool servi AVEC carte : ${poids(poolTrie.length)}`);

  verifier(poolTrie.length <= poolEntier.length, 'le tri ne rend JAMAIS un bloc plus lourd que la liste entière');
  verifier(
    partage.texteDesCompetences(competences, dossierPool, '') === poolEntier,
    'sans carte, le pool part exactement comme avant',
  );
  if (poolTrie !== poolEntier) {
    verifier(/autres compétences du pool/.test(poolTrie), 'ce qui est écarté est COMPTÉ, jamais caché en silence');
    verifier(/sommaire/.test(poolTrie), 'et le fichier où tout lire est nommé');
  } else {
    console.log('  (aucune fiche ne parle de cette carte : la liste entière est servie, c’est la règle)');
  }
}

/* ------------------------------------------------------------------ */

console.log('');
if (echecs.length) {
  console.error(`${echecs.length} contrôle(s) en échec.`);
  process.exit(1);
}
console.log('Tous les contrôles sont au vert.');
