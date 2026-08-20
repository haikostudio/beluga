#!/usr/bin/env node
/*
 * CE QUE LE TRI ÉCONOMISE EST MESURÉ, ET LA MESURE EST SUIVIE — pas annoncée
 * une fois puis oubliée.
 *
 * Trois mécaniques se vérifient ici, sur la VRAIE documentation du dépôt d'où
 * part ce script et sur le VRAI pool de compétences, jamais sur un décor
 * fabriqué :
 *
 *  1. LA MÉMOIRE. `detailProjet` rend, avec son texte, les DEUX poids —
 *     ce qui serait parti sans le tri, ce qui part. C'est ce couple que le
 *     démon range en base et que le tableau de bord additionne sur un mois.
 *  2. LES COMPÉTENCES PARTAGÉES. Le pool est servi au poids de la demande de
 *     la carte lui aussi, et jamais plus lourd que la liste entière.
 *  3. LA TRADUCTION. Signes → jetons → part de quota : rien n'est inventé, et
 *     sans rapport relevé la part de quota reste absente.
 *
 * Aucun moteur, aucun démon, aucune base : les mécaniques toutes seules.
 *
 * Le pool de compétences est une donnée d'exécution : le script le lit dans
 * `HAIKODEV_COMPETENCES` s'il est posé, sinon sous le dépôt. Sans pool, ce volet
 * le DIT et se saute, il ne se fabrique pas un décor.
 *
 *   node scripts/verif-economie-du-tri.mjs
 *   HAIKODEV_COMPETENCES=/root/haikodev/data/competences node scripts/verif-economie-du-tri.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Le dépôt d'où PART ce script, jamais un chemin en dur. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const memory = await import(path.join(RACINE, 'server/dist/memory.js'));
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

/* ------------------------------------------------------------------ */
/* 1. LA MÉMOIRE REND SES DEUX POIDS                                    */
/* ------------------------------------------------------------------ */

console.log('\n1. La mémoire dit ce qu’elle a évité d’envoyer\n');

/* Le sujet le plus volumineux du dépôt, et une carte à portée étroite. */
const sujets = partage.SUJETS_REGLES.map((sujet) => ({
  sujet,
  signes: (() => {
    try {
      return fs.readFileSync(path.join(RACINE, sujet.fichier), 'utf8').length;
    } catch {
      return 0;
    }
  })(),
})).sort((a, b) => b.signes - a.signes);

const gros = sujets[0];
const CARTE_ETROITE =
  'Le bouton « Publier maintenant » reste allumé pendant la mise en ligne\n' +
  'Constat : le bouton de publication ne s’éteint pas au clic, on peut le cliquer deux fois.';

const sansTri = memory.detailProjet(RACINE, gros.sujet.id, [], undefined, '');
const avecTri = memory.detailProjet(RACINE, gros.sujet.id, [], undefined, CARTE_ETROITE);

console.log(`  sujet le plus lourd : « ${gros.sujet.id} », ${poids(gros.signes)}`);
console.log(`  servi SANS carte    : ${poids(sansTri.texte.length)}`);
console.log(`  servi AVEC la carte : ${poids(avecTri.texte.length)}`);

verifier(avecTri.economie !== undefined, 'le détail rend une mesure d’économie');
/* Le texte rendu colle ses morceaux avec un séparateur : la mesure porte sur
   les morceaux, elle ne peut donc que rester SOUS la longueur totale — jamais
   au-dessus, ce qui gonflerait l'économie annoncée. */
verifier(
  avecTri.economie.servis <= avecTri.texte.length,
  'ce qui est compté « servi » ne dépasse jamais le texte réellement rendu',
);
verifier(
  avecTri.economie.entiers > avecTri.economie.servis,
  `le tri a évité ${poids(avecTri.economie.entiers - avecTri.economie.servis)} sur cette seule ouverture`,
);
verifier(
  avecTri.economie.entiers >= sansTri.texte.length * 0.9,
  'le poids « sans tri » relevé correspond bien à ce qui serait parti en entier',
);

/* Sans carte, rien n'est rogné : l'économie doit alors être NULLE, jamais
   inventée pour faire un joli chiffre. */
verifier(
  sansTri.economie.entiers === sansTri.economie.servis,
  'sans carte, aucune économie n’est comptée — le sujet part entier, comme avant',
);

/* ------------------------------------------------------------------ */
/* 2. LES COMPÉTENCES PARTAGÉES, AU POIDS DE LA DEMANDE                 */
/* ------------------------------------------------------------------ */

console.log('\n2. Le pool de compétences est servi au poids de la demande\n');

/* Le pool est une donnée d'EXÉCUTION, pas du contenu de dépôt : on le lit là où
   le démon le lit (`HAIKODEV_COMPETENCES`), et à défaut sous le dépôt. */
const dossierPool = process.env.HAIKODEV_COMPETENCES || path.join(RACINE, 'data', 'competences');
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

if (!competences.length) {
  console.log('  (aucune compétence sur ce dépôt : rien à mesurer ici)');
} else {
  const poolEntier = partage.texteDesCompetences(competences, dossierPool);
  const poolTrie = partage.texteDesCompetences(competences, dossierPool, CARTE_ETROITE);
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
/* 3. SIGNES → JETONS → PART DE QUOTA                                   */
/* ------------------------------------------------------------------ */

console.log('\n3. La traduction en quota n’invente rien\n');

const calcul = partage.economieMemoire(avecTri.economie.entiers, avecTri.economie.servis);
verifier(calcul.quotaEvite === undefined, 'sans rapport jetons → quota relevé, aucune part de quota n’est affichée');

const avecRapport = partage.economieMemoire(avecTri.economie.entiers, avecTri.economie.servis, 0.0004);
verifier(
  Math.abs(avecRapport.quotaEvite - avecRapport.jetonsEvites * 0.0004) < 1e-9,
  'avec le rapport relevé, la part de quota suit exactement les jetons évités',
);
console.log(
  `  sur cette carte d’essai : ${Math.round(calcul.part * 100)} % de la mémoire évitée, ` +
    `soit ${calcul.jetonsEvites.toLocaleString('fr-FR')} jetons`,
);

/* ------------------------------------------------------------------ */

console.log('');
if (echecs.length) {
  console.error(`${echecs.length} contrôle(s) en échec.`);
  process.exit(1);
}
console.log('Tous les contrôles sont au vert.');
