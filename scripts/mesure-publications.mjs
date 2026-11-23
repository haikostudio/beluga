#!/usr/bin/env node
/*
 * CE QUE COÛTE UNE MISE EN LIGNE, AU CLIC — MESURÉ, JAMAIS SUPPOSÉ.
 *
 * L'objectif de la carte « Déploiements en moins de 3 secondes » est un CHIFFRE :
 * le temps entre le clic et la bascule. Ce script est son juge. Il relit les
 * publications déjà faites (`deploys`) et les versions préparées d'avance
 * (`releases`), et rend :
 *
 *  1. par projet : le nombre de publications, la médiane et le pire total ;
 *  2. par étape : le temps cumulé, la médiane et le pire — d'où part le temps ;
 *  3. les publications MENÉES PAR UN AGENT, repérées à leur durée d'étape et à
 *     leur journal, qui sont la cause première des quarts d'heure mesurés ;
 *  4. l'état des versions préparées d'avance, par projet et par cible, car une
 *     version « echouee » fait retomber le clic sur le chemin complet SANS
 *     que personne le voie (MEM-3112).
 *
 * Deux options : `--projet <nom|id>` pour n'en garder qu'un, `--dernieres <n>`
 * pour ne regarder que les n dernières publications (25 par défaut).
 *
 * La base se lit dans le dépôt PRINCIPAL, même lancé depuis une copie de
 * travail de carte, dont le dossier `data/` est vide.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { cheminDeLaBaseServie } from './base-servie.mjs';

const args = process.argv.slice(2);
function option(nom, defaut) {
  const i = args.indexOf(nom);
  return i >= 0 && args[i + 1] ? args[i + 1] : defaut;
}

const base = process.env.HAIKO_DB ?? cheminDeLaBaseServie();
if (!fs.existsSync(base)) {
  console.error(`Base introuvable : ${base}`);
  process.exit(1);
}
const filtre = option('--projet', '')?.toLowerCase() ?? '';
const dernieres = Number(option('--dernieres', '25')) || 25;

function sql(requete) {
  return JSON.parse(
    execFileSync('sqlite3', ['-json', base, requete], { maxBuffer: 1 << 30, encoding: 'utf8' }) || '[]',
  );
}

const projets = new Map();
for (const p of sql('select id, name from projects;')) projets.set(p.id, p.name);
const nomDuProjet = (id) => projets.get(id) ?? id.slice(0, 8);

const brutes = sql(
  'select id, project_id, state, started_at, ended_at, data from deploys order by started_at desc;',
);

/** Une publication remise à plat : ses étapes, leur durée, son total. */
function lire(ligne) {
  let data = {};
  try {
    data = JSON.parse(ligne.data);
  } catch {
    /* une ligne illisible ne fait pas tomber la mesure */
  }
  const etapes = (data.steps ?? [])
    .filter((s) => s.startedAt && s.endedAt)
    .map((s) => ({
      cle: s.key,
      etat: s.state,
      ms: Math.max(0, s.endedAt - s.startedAt),
      /* UNE ÉTAPE MENÉE PAR UN AGENT le dit dans son journal : c'est la seule
         marque fiable, la durée seule confondrait une construction lente. */
      parAgent: JSON.stringify(s.journal ?? []).includes('agent'),
    }));
  const total = ligne.ended_at && ligne.started_at ? ligne.ended_at - ligne.started_at : null;
  return {
    id: ligne.id,
    projet: nomDuProjet(ligne.project_id),
    cible: data.cible ?? 'dev',
    etat: ligne.state,
    debut: ligne.started_at,
    total,
    etapes,
  };
}

const toutes = brutes
  .map(lire)
  .filter((p) => !filtre || p.projet.toLowerCase().includes(filtre) || p.id.startsWith(filtre));
const retenues = toutes.slice(0, dernieres);

const s = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)} s`);
function mediane(liste) {
  if (!liste.length) return null;
  const tri = [...liste].sort((a, b) => a - b);
  return tri[Math.floor(tri.length / 2)];
}

console.log(`Base : ${base}`);
console.log(`Publications lues : ${toutes.length} — mesurées : ${retenues.length}\n`);

/* 1. Par projet et par cible ------------------------------------------- */
const parProjet = new Map();
for (const p of retenues) {
  const cle = `${p.projet} · ${p.cible === 'dev' ? 'déploiement' : 'production'}`;
  if (!parProjet.has(cle)) parProjet.set(cle, []);
  parProjet.get(cle).push(p);
}
console.log('— DURÉE AU CLIC, PAR PROJET —');
const lignesProjet = [...parProjet.entries()]
  .map(([cle, liste]) => {
    const totaux = liste.map((p) => p.total).filter((t) => t != null);
    return { cle, n: liste.length, med: mediane(totaux), pire: totaux.length ? Math.max(...totaux) : null };
  })
  .sort((a, b) => (b.pire ?? 0) - (a.pire ?? 0));
for (const l of lignesProjet) {
  console.log(`  ${l.cle.padEnd(34)} ${String(l.n).padStart(3)} pub.  médiane ${s(l.med).padStart(10)}  pire ${s(l.pire).padStart(10)}`);
}

/* 2. Par étape ---------------------------------------------------------- */
const parEtape = new Map();
for (const p of retenues) {
  for (const e of p.etapes) {
    if (!parEtape.has(e.cle)) parEtape.set(e.cle, []);
    parEtape.get(e.cle).push(e);
  }
}
console.log('\n— OÙ PART LE TEMPS, PAR ÉTAPE —');
const lignesEtape = [...parEtape.entries()]
  .map(([cle, liste]) => {
    const durees = liste.map((e) => e.ms);
    return {
      cle,
      n: liste.length,
      cumul: durees.reduce((a, b) => a + b, 0),
      med: mediane(durees),
      pire: Math.max(...durees),
      agents: liste.filter((e) => e.parAgent).length,
    };
  })
  .sort((a, b) => b.cumul - a.cumul);
for (const l of lignesEtape) {
  console.log(
    `  ${l.cle.padEnd(10)} ${String(l.n).padStart(3)}×  cumul ${s(l.cumul).padStart(11)}  médiane ${s(l.med).padStart(9)}  pire ${s(l.pire).padStart(10)}  menées par agent : ${l.agents}`,
  );
}

/* 3. Les publications les plus longues, détaillées ---------------------- */
console.log('\n— LES CINQ PLUS LONGUES —');
for (const p of [...retenues].sort((a, b) => (b.total ?? 0) - (a.total ?? 0)).slice(0, 5)) {
  const detail = p.etapes
    .filter((e) => e.ms > 1000)
    .map((e) => `${e.cle} ${s(e.ms)}${e.parAgent ? ' (agent)' : ''}`)
    .join(' · ');
  console.log(`  ${new Date(p.debut).toISOString().slice(0, 16)}  ${p.projet} [${p.cible}] ${s(p.total)} — ${p.etat}`);
  console.log(`      ${detail || 'aucune étape de plus d’une seconde'}`);
}

/* 4. Les versions préparées d'avance ------------------------------------ */
const versions = sql('select project_id, cible, etat, count(*) as n from releases group by 1,2,3;');
console.log('\n— VERSIONS PRÉPARÉES D’AVANCE —');
if (!versions.length) console.log('  aucune version préparée');
for (const v of versions.filter((v) => !filtre || nomDuProjet(v.project_id).toLowerCase().includes(filtre))) {
  console.log(`  ${nomDuProjet(v.project_id).padEnd(24)} ${String(v.cible).padEnd(12)} ${String(v.etat).padEnd(10)} ${v.n}`);
}

/* 5. Le verdict de la carte --------------------------------------------- */
const sousTroisSecondes = retenues.filter((p) => p.total != null && p.total <= 3000).length;
const mesurables = retenues.filter((p) => p.total != null).length;
console.log(
  `\nVERDICT : ${sousTroisSecondes}/${mesurables} publication(s) sous 3 s — médiane générale ${s(mediane(retenues.map((p) => p.total).filter((t) => t != null)))}`,
);
