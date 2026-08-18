#!/usr/bin/env node
/*
 * CE QUE COÛTE LA FUSION DES BRANCHES, MESURÉ ET NON SUPPOSÉ.
 *
 * Chaque publication garde dans la base (`deploys`) ses sept étapes avec leur
 * `startedAt` / `endedAt` et le journal de la fusion, branche par branche. Ce
 * script relit tout cela et rend quatre choses :
 *
 *  1. le temps passé par étape, et la part de la fusion dans le total ;
 *  2. la fréquence des conflits, et les fichiers qui reviennent ;
 *  3. le surcoût d'un conflit : fusion propre contre fusion en conflit ;
 *  4. les publications tombées ou arrêtées, avec l'étape qui a lâché.
 *
 * ATTENTION AU JOURNAL DE FUSION : `setStep` AJOUTE son texte à celui de
 * l'étape, et la boucle de fusion lui repasse le journal ENTIER à chaque
 * conflit. Les lignes sont donc répétées autant de fois qu'il y a eu de
 * conflits : on dédoublonne avant de compter, sinon les conflits sont comptés
 * deux à trois fois (175 lignes pour 78 conflits réels, relevé le 18/08/2026).
 *
 * Vise le dépôt d'où il PART : la base se lit dans le dossier principal, que
 * l'on soit dans le dépôt ou dans une copie de travail de carte.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function racineDuDepot() {
  const commun = execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim();
  return path.dirname(path.resolve(commun));
}

const base = process.env.HAIKO_DB ?? path.join(racineDuDepot(), 'data', 'haikodev.db');
if (!fs.existsSync(base)) {
  console.error(`Base introuvable : ${base}`);
  process.exit(1);
}

const lignes = JSON.parse(
  execFileSync(
    'sqlite3',
    ['-json', base, 'select id, project_id, state, started_at, ended_at, data from deploys order by started_at asc;'],
    { maxBuffer: 1 << 30, encoding: 'utf8' },
  ) || '[]',
);

/* Le projet à mesurer : celui qui a le plus de publications, sauf demande. */
const parProjet = new Map();
for (const l of lignes) parProjet.set(l.project_id, (parProjet.get(l.project_id) ?? 0) + 1);
const projet =
  process.env.HAIKO_PROJET ?? [...parProjet.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

const runs = lignes
  .filter((l) => l.project_id === projet)
  .map((l) => ({ ...l, data: JSON.parse(l.data) }));

if (!runs.length) {
  console.error('Aucune publication à mesurer.');
  process.exit(1);
}

const moyenne = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const mediane = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);
const sec = (n) => `${n.toFixed(n < 10 ? 1 : 0)} s`;

const debut = new Date(runs[0].started_at).toISOString().slice(0, 10);
const fin = new Date(runs.at(-1).started_at).toISOString().slice(0, 10);
console.log(`Publications mesurées : ${runs.length}, du ${debut} au ${fin}\n`);

/* 1. Le temps par étape ------------------------------------------------- */
const parEtape = new Map();
for (const run of runs)
  for (const etape of run.data.steps ?? []) {
    if (!etape.startedAt || !etape.endedAt) continue;
    const e = parEtape.get(etape.key) ?? { n: 0, durees: [], etats: new Map() };
    e.n += 1;
    e.durees.push((etape.endedAt - etape.startedAt) / 1000);
    e.etats.set(etape.state, (e.etats.get(etape.state) ?? 0) + 1);
    parEtape.set(etape.key, e);
  }
const totalMinutes = [...parEtape.values()].reduce((a, e) => a + e.durees.reduce((x, y) => x + y, 0) / 60, 0);
console.log('TEMPS PAR ÉTAPE');
for (const [cle, e] of parEtape) {
  const minutes = e.durees.reduce((x, y) => x + y, 0) / 60;
  console.log(
    `  ${cle.padEnd(8)} n=${String(e.n).padStart(4)}  médiane ${sec(mediane(e.durees)).padStart(8)}` +
      `  moyenne ${sec(moyenne(e.durees)).padStart(8)}  max ${sec(Math.max(...e.durees)).padStart(8)}` +
      `  total ${minutes.toFixed(0)} min (${((minutes / totalMinutes) * 100).toFixed(0)} %)`,
  );
}

/* 2 et 3. Les conflits --------------------------------------------------- */
let conflits = 0;
let resolus = 0;
let ecartees = 0;
const fichiers = new Map();
const parTaille = new Map();
const sansConflit = [];
const avecConflit = [];
let publicationsEnConflit = 0;

for (const run of runs) {
  const etape = (run.data.steps ?? []).find((e) => e.key === 'merge');
  if (!etape) continue;
  // Dédoublonnage : voir l'avertissement en tête de fichier.
  const lignesLog = [...new Set((etape.log ?? '').split('\n'))];
  const enConflit = lignesLog.filter((l) => / : CONFLIT/.test(l));
  const fusionnees = new Set(lignesLog.filter((l) => / : fusionnée/.test(l)).map((l) => l.split(' : ')[0]));
  conflits += enConflit.length;
  if (enConflit.length) publicationsEnConflit += 1;
  resolus += lignesLog.filter((l) => /conflit résolu par l’agent/.test(l)).length;
  ecartees += lignesLog.filter((l) => /écartée de cette publication/.test(l)).length;
  for (const ligne of enConflit) {
    const nommes = ligne.match(/CONFLIT \(([^)]*)\)/);
    if (!nommes) continue;
    for (const f of nommes[1].split(',').map((x) => x.trim()).filter(Boolean))
      fichiers.set(f, (fichiers.get(f) ?? 0) + 1);
  }
  if (etape.startedAt && etape.endedAt) {
    (enConflit.length ? avecConflit : sansConflit).push((etape.endedAt - etape.startedAt) / 1000);
  }
  const branches = fusionnees.size + enConflit.length;
  const classe = branches >= 10 ? '10+' : String(branches);
  const t = parTaille.get(classe) ?? { n: 0, c: 0 };
  t.n += 1;
  t.c += enConflit.length;
  parTaille.set(classe, t);
}

const propre = moyenne(sansConflit);
const surcout = avecConflit.reduce((a, b) => a + b, 0) - avecConflit.length * propre;
console.log('\nCONFLITS');
console.log(`  ${conflits} conflits sur ${publicationsEnConflit} publications (${((publicationsEnConflit / runs.length) * 100).toFixed(0)} % du total)`);
console.log(`  résolus par un agent : ${resolus} — cartes écartées du lot : ${ecartees}`);
console.log(`  fusion sans conflit : ${sec(propre)} en moyenne (n=${sansConflit.length})`);
console.log(`  fusion avec conflit : ${sec(moyenne(avecConflit))} en moyenne (n=${avecConflit.length})`);
console.log(`  surcoût : ${(surcout / 60).toFixed(0)} min au total, soit ${sec(surcout / conflits)} par conflit`);

console.log('\n  Fichiers qui entrent le plus souvent en conflit :');
for (const [f, n] of [...fichiers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12))
  console.log(`    ${String(n).padStart(3)}  ${f}`);

console.log('\n  Conflits selon la taille du lot :');
for (const [taille, t] of [...parTaille.entries()].sort((a, b) => (a[0] === '10+' ? 1 : b[0] === '10+' ? -1 : a[0] - b[0])))
  console.log(`    ${taille.padStart(3)} branche(s) : ${String(t.n).padStart(3)} publications, ${(t.c / t.n).toFixed(2)} conflit(s) en moyenne`);

/* 4. Ce qui est tombé ---------------------------------------------------- */
const rates = runs.filter((r) => r.state !== 'success');
console.log(`\nPUBLICATIONS NON RÉUSSIES : ${rates.length} / ${runs.length} (${((rates.length / runs.length) * 100).toFixed(0)} %)`);
for (const run of rates) {
  const etape =
    (run.data.steps ?? []).find((e) => e.state === 'failed') ?? (run.data.steps ?? []).find((e) => e.state === 'running');
  const derniere = (etape?.log ?? '').split('\n').filter(Boolean).at(-1) ?? '';
  console.log(
    `  ${new Date(run.started_at).toISOString().slice(0, 16)}  ${run.state.padEnd(8)} ${(etape?.key ?? '?').padEnd(8)} ${derniere.slice(0, 110)}`,
  );
}
