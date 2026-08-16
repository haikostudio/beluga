#!/usr/bin/env node
/* Banc d'essai jetable : mêmes 120 cartes, mêmes classements, variantes de choix. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';

const RACINE = process.env.RACINE || process.cwd();
const CARTES_VOULUES = Number(process.env.CARTES || 120);
const DONNEES_REELLES = '/root/haikodev/data';

const JETABLE = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-memoire-'));
process.on('exit', () => fs.rmSync(JETABLE, { recursive: true, force: true }));
{
  const lecture = new Database(path.join(DONNEES_REELLES, 'haikodev.db'), { readonly: true });
  lecture.exec(`VACUUM INTO '${path.join(JETABLE, 'haikodev.db').replace(/'/g, "''")}'`);
  lecture.close();
}
process.env.HAIKODEV_DATA = JETABLE;
process.env.HAIKODEV_COMPETENCES ??= path.join(DONNEES_REELLES, 'competences');
process.env.HAIKODEV_VECTORISEUR ??= path.join(DONNEES_REELLES, 'vectoriseur');

const passagesMod = await import(path.join(RACINE, 'server/dist/passages.js'));
const memory = await import(path.join(RACINE, 'server/dist/memory.js'));
const store = await import(path.join(RACINE, 'server/dist/store.js'));
const shared = await import(path.join(RACINE, 'shared/dist/index.js'));

const { PASSAGES_CODE_MAX, choisirPassages, classerPassages, jetonsApproches, plafondDeRecherche } = shared;

const projets = store.listProjects().filter((p) => !p.archived);
const projet = projets.find((p) => p.isSelf) ?? projets.find((p) => p.name === 'HaikoDev');
const CHEMIN_PROJET = RACINE;
const git = (...a) => execFileSync('git', a, { cwd: CHEMIN_PROJET, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

function fusionsParBranche() {
  const fusions = new Map();
  for (const ligne of git('log', '--merges', '--format=%H%x09%P%x09%s', '-n', '1500').split('\n')) {
    const [commit, parents, sujet] = ligne.split('\t');
    const nom = sujet?.match(/Merge branch '([^']+)'/);
    if (!nom || fusions.has(nom[1])) continue;
    const [avant, apres] = (parents ?? '').split(' ');
    if (!avant || !apres) continue;
    fusions.set(nom[1], { commit, avant, apres });
  }
  return fusions;
}
const baseCopiee = new Database(path.join(JETABLE, 'haikodev.db'), { readonly: true });
const fusions = fusionsParBranche();
const toutes = [];
for (const ligne of baseCopiee
  .prepare(`SELECT id, title, description, data FROM cards WHERE project_id = ? AND column_key IN ('in_production','archived','to_deploy') ORDER BY created_at DESC LIMIT 400`)
  .all(projet.id)) {
  const branche = JSON.parse(ligne.data || '{}').github?.branch;
  const fusion = branche ? fusions.get(branche) : undefined;
  if (!fusion) continue;
  let fichiers = [];
  try {
    fichiers = git('diff', '--name-only', `${fusion.avant}...${fusion.apres}`).split('\n').map((l) => l.trim()).filter(Boolean);
  } catch {}
  fichiers = fichiers.filter((f) => !f.startsWith('scripts/audit-memoire-rag'));
  if (!fichiers.length) continue;
  toutes.push({
    id: ligne.id,
    titre: ligne.title,
    question: [ligne.title, ligne.description].filter(Boolean).join('\n'),
    fichiers: new Set(fichiers),
  });
}
const OMNIPRESENT = 0.25;
const compte = new Map();
for (const c of toutes) for (const f of c.fichiers) compte.set(f, (compte.get(f) ?? 0) + 1);
const omnipresents = new Set([...compte].filter(([, n]) => n / toutes.length >= OMNIPRESENT).map(([f]) => f));
for (const c of toutes) c.propres = new Set([...c.fichiers].filter((f) => !omnipresents.has(f)));
const cartes = toutes.slice(0, CARTES_VOULUES);

passagesMod.indexerDocumentation(projet.id, CHEMIN_PROJET);
const tous = passagesMod.passagesIndexes(projet.id);
const faits = memory.memoryFacts(CHEMIN_PROJET);
const jetonsIndex = jetonsApproches(memory.blocMemoire(CHEMIN_PROJET).length);
const plafond = plafondDeRecherche(jetonsIndex);
console.log(`corpus ${tous.length} passages · plafond ${plafond} jetons · ${cartes.length} cartes · omniprésents ${[...omnipresents].join(', ')}`);

/* ---- les variantes ---- */
const CHEMIN = /\b(?:[\w.-]+\/)+[\w.-]+\.(?:ts|tsx|mjs|cjs|js|jsx|md|json|css|sh|yml|yaml|service|sql)\b/g;
function cheminsCites(texte) {
  return new Set((texte.match(CHEMIN) ?? []).map((s) => s.replace(/^\.\//, '')));
}

function rebond(classes, options = {}) {
  const graines = options.graines ?? 5;
  const bonus = options.bonus ?? 0.15;
  const cites = new Set();
  let vus = 0;
  for (const p of classes) {
    if (vus >= graines) break;
    if (p.priorite < 0) continue;
    for (const c of cheminsCites(p.texte + ' ' + p.titre)) cites.add(c);
    vus += 1;
  }
  if (!cites.size) return classes;
  return classes
    .map((p) => (cites.has(p.source) ? { ...p, score: p.score + bonus } : p))
    .sort((a, b) => b.score - a.score);
}

function cheminsDeLaQuestion(question) {
  return cheminsCites(question);
}

function rebondN(classes, options = {}) {
  let courant = classes;
  const tours = options.tours ?? 1;
  for (let i = 0; i < tours; i++) courant = rebond(courant, options);
  return courant;
}

function rebondQuestion(classes, question, options = {}) {
  const bonus = options.bonus ?? 0.15;
  const cites = cheminsDeLaQuestion(question);
  if (!cites.size) return classes;
  return classes.map((p) => (cites.has(p.source) ? { ...p, score: p.score + bonus } : p)).sort((a, b) => b.score - a.score);
}

function rebondPlus(classes, question, options = {}) {
  const graines = options.graines ?? 8;
  const bonus = options.bonus ?? 0.15;
  const cites = options.question === false ? new Set() : new Set(cheminsCites(question));
  let vus = 0;
  for (const p of classes) {
    if (vus >= graines) break;
    if (options.code === false && p.priorite < 0) continue;
    for (const c of cheminsCites(p.texte + ' ' + p.titre)) cites.add(c);
    vus += 1;
  }
  if (!cites.size) return classes;
  return classes.map((p) => (cites.has(p.source) ? { ...p, score: p.score + bonus } : p)).sort((a, b) => b.score - a.score);
}

const variantes = {
  base: (cl) => choisirPassages(cl, { plafond, maxCode: PASSAGES_CODE_MAX }),
  g8_s1: (cl, q) => choisirPassages(rebondPlus(cl, q, { code: false, question: false }), { plafond, maxCode: PASSAGES_CODE_MAX, parSource: 1 }),
  g8_s1_q: (cl, q) => choisirPassages(rebondPlus(cl, q, { code: false }), { plafond, maxCode: PASSAGES_CODE_MAX, parSource: 1 }),
  g8_s1_qc: (cl, q) => choisirPassages(rebondPlus(cl, q, {}), { plafond, maxCode: PASSAGES_CODE_MAX, parSource: 1 }),
  g10_s1_q: (cl, q) => choisirPassages(rebondPlus(cl, q, { code: false, graines: 10 }), { plafond, maxCode: PASSAGES_CODE_MAX, parSource: 1 }),
  g6_s1_q: (cl, q) => choisirPassages(rebondPlus(cl, q, { code: false, graines: 6 }), { plafond, maxCode: PASSAGES_CODE_MAX, parSource: 1 }),
  g8_s1_q_b20: (cl, q) => choisirPassages(rebondPlus(cl, q, { code: false, bonus: 0.2 }), { plafond, maxCode: PASSAGES_CODE_MAX, parSource: 1 }),
  g8_s1_q_b12: (cl, q) => choisirPassages(rebondPlus(cl, q, { code: false, bonus: 0.12 }), { plafond, maxCode: PASSAGES_CODE_MAX, parSource: 1 }),
  g8_s2_q: (cl, q) => choisirPassages(rebondPlus(cl, q, { code: false }), { plafond, maxCode: PASSAGES_CODE_MAX, parSource: 2 }),
  g8_s1_q_c3: (cl, q) => choisirPassages(rebondPlus(cl, q, { code: false }), { plafond, maxCode: 3, parSource: 1 }),
  g8_s1_q_p1200: (cl, q) => choisirPassages(rebondPlus(cl, q, { code: false }), { plafond: 1200, maxCode: PASSAGES_CODE_MAX, parSource: 1 }),
  g8_s1_q_p1500: (cl, q) => choisirPassages(rebondPlus(cl, q, { code: false }), { plafond: 1500, maxCode: PASSAGES_CODE_MAX, parSource: 1 }),
};

const bilan = new Map(Object.keys(variantes).map((n) => [n, { touche: 0, strict: 0, passages: 0, jetons: 0, sources: 0 }]));
const rangs = [];
for (const carte of cartes) {
  const classes = classerPassages(tous, carte.question);
  const r = classes.findIndex((p) => carte.fichiers.has(p.source));
  rangs.push(r < 0 ? 0 : r + 1);
  for (const [nom, f] of Object.entries(variantes)) {
    const choix = f(classes, carte.question);
    const sources = new Set(choix.gardes.map((p) => p.source));
    const b = bilan.get(nom);
    if ([...sources].some((s) => carte.fichiers.has(s))) b.touche += 1;
    if ([...sources].some((s) => carte.propres.has(s))) b.strict += 1;
    b.passages += choix.gardes.length;
    b.jetons += choix.jetons;
    b.sources += sources.size;
  }
}
const n = cartes.length;
console.log('\nvariante             large   stricte  passages  sources  jetons');
for (const [nom, b] of bilan) {
  console.log(
    `${nom.padEnd(20)} ${String(Math.round((b.touche / n) * 100)).padStart(3)} %  ${String(Math.round((b.strict / n) * 100)).padStart(4)} %  ${(b.passages / n).toFixed(1).padStart(7)}  ${(b.sources / n).toFixed(1).padStart(6)}  ${Math.round(b.jetons / n).toString().padStart(5)}`,
  );
}
const auRang = (k) => `${Math.round((rangs.filter((r) => r > 0 && r <= k).length / n) * 100)} %`;
console.log(`\nrang de la bonne page (mots) — 7 : ${auRang(7)} · 10 : ${auRang(10)} · 20 : ${auRang(20)} · 50 : ${auRang(50)} · 100 : ${auRang(100)} · 500 : ${auRang(500)} · jamais : ${rangs.filter((r) => !r).length}`);
process.exit(0);
