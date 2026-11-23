#!/usr/bin/env node
/**
 * LES COMPÉTENCES REMONTENT-ELLES PAR LE SENS ? Mesure rejouable, avant / après.
 *
 * `scripts/cas-competences-par-le-sens.json` : des demandes types (cartes réelles
 * de plusieurs projets, et des demandes qui appellent une fiche de bibliothèque :
 * devis, logo, référencement, Stripe, parcours d'inscription, vidéo…), chacune
 * avec les fiches qu'on attend — liste vide = aucune compétence attendue.
 *
 * Pour chaque cas, sur une COPIE de la base servie (rien n'est jamais écrit dans
 * la vraie) :
 *  - le rang de la meilleure fiche attendue par la proximité BRUTE par le sens,
 *    parmi les fiches servies au projet ;
 *  - son rang parmi les compétences de la recherche MÊLÉE (mots + sens) ;
 *  - ce que le cadrage PROPOSERAIT (`competencesAProposer`) ;
 *  - le bloc de compétences du BRIEFING d'une carte : sa taille, s'il nomme
 *    une fiche attendue, et le rang de la meilleure attendue dans sa liste
 *    (après le tri par le modèle qui lit, `MODELE_DE_TRI`, quand il est installé) ;
 *  - le temps du cadrage et du briefing, et la mémoire vive du processus du
 *    vectoriseur (qui porte aussi le modèle de tri).
 *
 *   node scripts/mesure-competences-par-le-sens.mjs                 # copie la base, mesure
 *   node scripts/mesure-competences-par-le-sens.mjs --data <dossier> # copie déjà faite
 *   node scripts/mesure-competences-par-le-sens.mjs --synchro        # resynchronise d'abord
 *     les unités de compétence ET leurs vecteurs dans la copie (le code de cette
 *     copie de travail) : c'est la mesure « après » sans attendre le démon.
 *   --json <fichier> écrit le détail, pour comparer deux passages.
 *   --sans-tri : la mesure « avant », sans le modèle de tri (BELUGA_SANS_TRI_DES_COMPETENCES=1).
 *   Le modèle de tri est chargé une fois AVANT la mesure : les temps relevés sont
 *   ceux d'un modèle chaud (à froid, le premier appel retombe sur l'ordre d'avant).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cheminDeLaBaseServie, dossierDesDonnees } from './lib/base-servie.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CAS = JSON.parse(fs.readFileSync(path.join(RACINE, 'scripts/cas-competences-par-le-sens.json'), 'utf8'));
const arg = (nom) => {
  const i = process.argv.indexOf(nom);
  return i >= 0 ? process.argv[i + 1] : null;
};
const dejaCopie = arg('--data');
const sortieJson = arg('--json');
const avecSynchro = process.argv.includes('--synchro');
const sansTri = process.argv.includes('--sans-tri');
if (sansTri) process.env.BELUGA_SANS_TRI_DES_COMPETENCES = '1';

const POOL = process.env.BELUGA_COMPETENCES || path.join(dossierDesDonnees(), 'competences');
let JETABLE = dejaCopie;
if (!dejaCopie) {
  const source = cheminDeLaBaseServie();
  if (!fs.existsSync(source)) {
    console.error(`Base servie introuvable : ${source}`);
    process.exit(1);
  }
  JETABLE = fs.mkdtempSync(path.join(os.tmpdir(), 'mesure-competences-'));
  console.log(`Copie de la base dans ${JETABLE}…`);
  execFileSync('sqlite3', [source, `.backup ${path.join(JETABLE, 'beluga.db')}`]);
  const vectoriseur = path.join(dossierDesDonnees(), 'vectoriseur');
  if (fs.existsSync(vectoriseur)) fs.symlinkSync(vectoriseur, path.join(JETABLE, 'vectoriseur'));
}
process.env.BELUGA_DATA = JETABLE;
// Le POOL lu est le vrai (lecture seule) : seule la base est une copie.
process.env.BELUGA_COMPETENCES = POOL;

const shared = await import(path.join(RACINE, 'shared/dist/index.js'));
const k = await import(path.join(RACINE, 'server/dist/connaissances.js'));
const { listerCompetences, dossierDesCompetences } = await import(path.join(RACINE, 'server/dist/competences.js'));
const { competencesAProposer } = await import(path.join(RACINE, 'server/dist/proposition-competences.js'));
const memory = await import(path.join(RACINE, 'server/dist/memory.js'));
const { getDb } = await import(path.join(RACINE, 'server/dist/db.js'));
const vectoriseur = await import(path.join(RACINE, 'server/dist/vectoriseur.js'));
const avecTri = vectoriseur.modeleDeTriDisponible();
if (avecTri) {
  const t0 = Date.now();
  await vectoriseur.noterParLeTri('essai', ['essai'], 120_000);
  console.log(`Modèle de tri chargé à froid en ${Math.round((Date.now() - t0) / 100) / 10} s.`);
} else console.log('Sans modèle de tri : ordre de la recherche seule.');
let memoireMax = 0;
let memoireVecteursMax = 0;
const relever = () => {
  memoireMax = Math.max(memoireMax, vectoriseur.memoireDuProcessusMo('trieur') ?? 0);
  memoireVecteursMax = Math.max(memoireVecteursMax, vectoriseur.memoireDuProcessusMo('vectoriseur') ?? 0);
};

if (avecSynchro) {
  const { synchroniserCompetencesVersLaBase } = await import(path.join(RACINE, 'server/dist/competences-memoire.js'));
  const bilan = synchroniserCompetencesVersLaBase();
  console.log(`Synchro dans la copie : ${bilan.creees.length} créée(s), ${bilan.misesAJour.length} mise(s) à jour, ${bilan.inchangees.length} inchangée(s).`);
  const t0 = Date.now();
  const n = await k.completerLesVecteurs();
  console.log(`Vecteurs recalculés dans la copie : ${n} (${Math.round((Date.now() - t0) / 1000)} s).`);
}

const projets = new Map(getDb().prepare('SELECT id, name FROM projects').all().map((p) => [p.name, p]));
const fiches = listerCompetences();
const parNom = new Map(fiches.map((f) => [f.nom, f]));
const unites = k.unitesDeLaSource(shared.PORTEE_DES_COMPETENCES, shared.GENRE_SOURCE_COMPETENCE);
const visee = { portees: [shared.PORTEE_GLOBALE], types: ['operation'] };

const lignes = [];
for (const cas of CAS) {
  const projet = projets.get(cas.projet);
  if (!projet) {
    console.log(`(projet introuvable : ${cas.projet})`);
    continue;
  }
  const servies = new Set(fiches.filter((f) => shared.ficheEnService(f.etat) && shared.ficheServieAuProjet(f, projet.name)).map((f) => f.nom));
  const attendu = new Set(cas.attendu);

  const proximites = await k.proximitesParLeSens(cas.demande, visee, 20_000);
  const parSens = [];
  const vues = new Set();
  for (const u of unites) {
    const nom = shared.nomDeCompetenceDeLUnite(u);
    const p = proximites.get(u.id);
    if (!nom || p === undefined || !servies.has(nom) || vues.has(nom)) continue;
    vues.add(nom);
    parSens.push({ nom, p });
  }
  parSens.sort((a, b) => b.p - a.p);
  const rangSens = parSens.findIndex((x) => attendu.has(x.nom));
  if (process.argv.includes('--detail')) {
    console.log(`\n« ${cas.demande.split('\n')[0].slice(0, 70)} »`);
    for (const x of parSens.slice(0, 6)) console.log(`   ${x.p.toFixed(4)} ${x.nom}${parNom.get(x.nom)?.bibliotheque ? ' [bib]' : ''}${attendu.has(x.nom) ? '  ←' : ''}`);
  }

  const melees = await k.chercherUnitesMelees(cas.demande, { projectId: projet.id, ...visee, limite: 40 });
  const rangsMeles = [];
  for (const { unite } of melees) {
    const nom = shared.nomDeCompetenceDeLUnite(unite);
    if (nom && servies.has(nom) && !rangsMeles.includes(nom)) rangsMeles.push(nom);
  }
  const rangMele = rangsMeles.findIndex((n) => attendu.has(n));

  let t0 = Date.now();
  const proposees = (await competencesAProposer(cas.demande, projet)).map((c) => c.nom);
  const msCadrage = Date.now() - t0;
  relever();

  // Le bloc tel que le briefing d'une carte le servirait (fiches proches par le sens quand ce code les connaît).
  t0 = Date.now();
  const proches = memory.competencesProchesDuTravail
    ? await memory.competencesProchesDuTravail(cas.demande, { projet: projet.name, projectId: projet.id })
    : undefined;
  const msBriefing = Date.now() - t0;
  relever();
  const rangBriefing = proches ? proches.findIndex((n) => attendu.has(n)) : -1;
  const bloc = shared.texteDesCompetences(fiches, dossierDesCompetences(), cas.demande, undefined, projet.name, proches);
  const nommees = [...attendu].filter((n) => new RegExp(`(^|[\\s,:(])${n.replace(/[-]/g, '\\-')}([\\s,)]|$)`, 'm').test(bloc));

  lignes.push({
    demande: cas.demande.split('\n')[0].slice(0, 60),
    genre: cas.genre,
    rangSens: rangSens < 0 ? null : rangSens + 1,
    premiereParSens: parSens[0]?.nom,
    marche: parSens.length > 1 ? Math.round((parSens[0].p - parSens[1].p) * 1000) / 1000 : null,
    rangMele: rangMele < 0 ? null : rangMele + 1,
    proposees,
    bonnesProposees: proposees.filter((n) => attendu.has(n)).length,
    signesDuBloc: bloc.length,
    attendueNommee: nommees.length > 0,
    rangBriefing: rangBriefing < 0 ? null : rangBriefing + 1,
    msCadrage,
    msBriefing,
  });
}

console.log('');
console.log('| Demande | Genre | Rang sens | Rang mêlé | Rang au briefing | Proposées au cadrage | Bloc du briefing (signes) | Fiche attendue nommée | Cadrage / briefing (ms) |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const l of lignes) {
  console.log(
    `| ${l.demande} | ${l.genre} | ${l.rangSens ?? '—'} | ${l.rangMele ?? '—'} | ${l.rangBriefing ?? '—'} | ${l.proposees.join(', ') || '—'} | ${l.signesDuBloc} | ${l.genre === 'aucune' ? 's.o.' : l.attendueNommee ? 'oui' : 'non'} | ${l.msCadrage} / ${l.msBriefing} |`,
  );
}
const avecAttente = lignes.filter((l) => l.genre !== 'aucune');
const sans = lignes.filter((l) => l.genre === 'aucune');
const top = (n) => avecAttente.filter((l) => l.rangSens && l.rangSens <= n).length;
console.log('');
console.log(`Par le sens : ${top(1)}/${avecAttente.length} en tête, ${top(5)}/${avecAttente.length} dans les 5 premières.`);
console.log(`Mêlée : ${avecAttente.filter((l) => l.rangMele && l.rangMele <= 5).length}/${avecAttente.length} dans les 5 premières compétences.`);
console.log(`Cadrage : ${avecAttente.filter((l) => l.bonnesProposees).length}/${avecAttente.length} demandes avec une bonne proposition ; ${sans.filter((l) => l.proposees.length).length}/${sans.length} demandes sans compétence attendue avec une proposition (faux positifs) ; ${lignes.reduce((s, l) => s + l.proposees.length - l.bonnesProposees, 0)} proposition(s) hors des attendues en tout.`);
const origine = lignes.filter((l) => l.genre === 'bibliotheque' || (l.genre === 'maison' && !l.demande.startsWith('Alerte mémoire')));
console.log(`Les 11 demandes d'origine : ${origine.filter((l) => l.bonnesProposees).length}/${origine.length} avec une bonne proposition au cadrage, attendue nommée au briefing sur ${origine.filter((l) => l.attendueNommee).length}/${origine.length}.`);
const parMetier = lignes.filter((l) => l.genre === 'metier');
if (parMetier.length) console.log(`Par métier : ${parMetier.filter((l) => l.bonnesProposees).length}/${parMetier.length} avec une bonne proposition, attendue nommée au briefing sur ${parMetier.filter((l) => l.attendueNommee).length}/${parMetier.length}.`);
console.log(`Rang de l'attendue au briefing : ${avecAttente.filter((l) => l.rangBriefing === 1).length}/${avecAttente.length} en tête, ${avecAttente.filter((l) => l.rangBriefing && l.rangBriefing <= 3).length}/${avecAttente.length} dans les 3 premières.`);
const moy = (k) => Math.round(lignes.reduce((s, l) => s + l[k], 0) / lignes.length);
console.log(`Temps moyen : cadrage ${moy('msCadrage')} ms (max ${Math.max(...lignes.map((l) => l.msCadrage))}), briefing ${moy('msBriefing')} ms (max ${Math.max(...lignes.map((l) => l.msBriefing))}) ; mémoire vive au plus haut : vectoriseur ${memoireVecteursMax || '—'} Mo, trieur ${memoireMax || '—'} Mo.`);
console.log(`Briefing : fiche attendue nommée sur ${avecAttente.filter((l) => l.attendueNommee).length}/${avecAttente.length} ; bloc moyen ${Math.round(lignes.reduce((s, l) => s + l.signesDuBloc, 0) / lignes.length)} signes.`);
if (sortieJson) fs.writeFileSync(sortieJson, JSON.stringify(lignes, null, 2));
if (!dejaCopie) console.log(`\n(copie gardée pour un second passage : --data ${JETABLE} ; à effacer ensuite)`);
process.exit(0);
