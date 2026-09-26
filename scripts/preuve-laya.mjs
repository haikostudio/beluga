#!/usr/bin/env node
/*
 * LA PREUVE, AVANT D'ALLUMER UN USAGE (MEM-3232).
 *
 * Un usage du juge rapide n'est allumé par défaut que si on a MESURÉ qu'il
 * juge juste. Ce script pose à Laya les MÊMES questions que le démon, avec les
 * MÊMES seuils (`REGLAGES_DES_USAGES`), sur trois sortes de vérité :
 *
 *  1. les jugements de l'ANCIEN JUGE PAYANT tracés en base (modèle
 *     « jev-latest ») : la note de compréhension et le niveau ;
 *  2. les NIVEAUX réellement posés sur les cartes par les agents de cadrage ;
 *  3. des cas ÉTIQUETÉS À LA MAIN (`scripts/preuve-laya-cas.json`) et, pour la
 *     mémoire, les unités que les agents ont réellement OUVERTES après une
 *     recherche (elles étaient utiles : le tri ne doit pas les écarter).
 *
 *   node scripts/preuve-laya.mjs                 → tous les usages
 *   node scripts/preuve-laya.mjs --usage X       → un seul
 *   node scripts/preuve-laya.mjs --limite 40     → au plus N cas par source
 *   node scripts/preuve-laya.mjs --jeu           → l'EXAMEN du jeu d'exemples remplace les tirages au
 *                                                  hasard (niveau posé, mémoire ouverte) : des cas
 *                                                  jamais vus à l'entraînement, les mêmes à chaque fois
 *   node scripts/preuve-laya.mjs --modele DIR    → examine une version entraînée ici, pas celle du cache
 *   node scripts/preuve-laya.mjs --json FICHIER  → écrit aussi le bilan, lu par la bascule de nuit
 *
 * LA RÈGLE, SÉVÈRE : un usage qui DÉCIDE passe s'il répond sur au moins la
 * moitié des cas ET qu'il a raison neuf fois sur dix quand il répond. Un tri
 * de PERTINENCE passe s'il garde au moins 90 % de ce qui était utile ET écarte
 * au moins la moitié de ce qui ne l'était pas — sinon il ne fait rien gagner.
 *
 * CE QU'IL NE FAIT PAS : basculer quoi que ce soit. Il chiffre ; l'état par
 * défaut vit dans `FICHES_DES_USAGES` (`parDefaut`) et se change à la main.
 * La base est LUE seulement (sqlite3 en lecture), aucun démon n'est monté.
 */

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

import {
  REGLAGES_DES_USAGES,
  SEUIL_DOUBLON,
  SEUIL_LAYA,
  SEUIL_PERTINENCE,
  questionDoublon,
  questionFamilleDErreur,
  questionGenreDeCarte,
  questionNatureDeLaDemande,
  questionNiveauDeCarte,
  questionUrgence,
  questionsDePertinence,
  reponseDepuisLaya,
} from '../shared/dist/index.js';
import { cheminDeLaBaseServie, depotPrincipal } from './base-servie.mjs';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (nom, defaut) => {
  const i = args.indexOf(nom);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : defaut;
};
const base = process.env.HAIKO_DB ?? cheminDeLaBaseServie();
const limite = Number(option('--limite', '40'));
const filtre = option('--usage', '');
const dossier = process.env.BELUGA_LAYA_DIR?.trim() || path.join(depotPrincipal(), 'outils/laya');
const python = path.join(dossier, 'venv/bin/python');
const cas = JSON.parse(fs.readFileSync(path.join(ICI, 'preuve-laya-cas.json'), 'utf8'));
const modele = option('--modele', '');
const sortieJson = option('--json', '');
const fichierJeu = path.join(dossier, 'entrainement', 'exemples.jsonl');
/* L'EXAMEN DU JEU : les questions réservées, jamais vues à l'entraînement. */
const examen = args.includes('--jeu')
  ? fs
      .readFileSync(fichierJeu, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((l) => l.partie === 'examen')
  : null;

if (!fs.existsSync(python)) {
  console.error(`Laya n’est pas installé (${python}). Voir scripts/installer-laya.mjs --installer.`);
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* LE SERVICE : le même que celui du démon, lancé une fois              */
/* ------------------------------------------------------------------ */

const service = spawn(python, [path.join(ICI, 'laya-service.py')], {
  cwd: dossier,
  env: {
    ...process.env,
    HF_HOME: path.join(dossier, 'hf'),
    HF_HUB_OFFLINE: '1',
    TRANSFORMERS_OFFLINE: '1',
    ...(modele ? { LAYA_DEPOT: path.resolve(modele) } : {}),
  },
  stdio: ['pipe', 'pipe', 'ignore'],
});
const attentes = new Map();
let pret;
const charge = new Promise((r) => (pret = r));
readline.createInterface({ input: service.stdout }).on('line', (ligne) => {
  let r;
  try {
    r = JSON.parse(ligne);
  } catch {
    return;
  }
  if (r.id === 0) return pret(!!r.pret);
  attentes.get(r.id)?.(r.answers);
  attentes.delete(r.id);
});
let prochain = 1;
function demander(state, questions) {
  const id = prochain++;
  return new Promise((resoudre) => {
    attentes.set(id, resoudre);
    service.stdin.write(`${JSON.stringify({ id, state, questions, max_len: 1024 })}\n`);
  });
}

/** Les réponses lues comme le démon les lit, au seuil de l'usage. */
async function juger(usage, etat, questions) {
  const reglage = REGLAGES_DES_USAGES[usage] ?? {};
  const debut = Date.now();
  const brutes = (await demander(etat, questions)) ?? {};
  const ms = Date.now() - debut;
  const reponses = {};
  for (const [cle, question] of Object.entries(questions)) {
    const r = reponseDepuisLaya(question, brutes[cle], reglage.seuil ?? SEUIL_LAYA);
    if (r) reponses[cle] = r;
  }
  return { reponses, brutes, ms };
}

/* ------------------------------------------------------------------ */
/* LE BILAN                                                             */
/* ------------------------------------------------------------------ */

const bilans = [];
function bilanDecision(usage, source, resultats) {
  const total = resultats.length;
  const repondus = resultats.filter((r) => r.obtenu !== undefined);
  const justes = repondus.filter((r) => r.obtenu === r.attendu);
  const ms = Math.round(resultats.reduce((s, r) => s + r.ms, 0) / Math.max(1, total));
  const passe = total > 0 && repondus.length / total >= 0.5 && justes.length / Math.max(1, repondus.length) >= 0.9;
  bilans.push({ usage, source, total, repondus: repondus.length, justes: justes.length, ms, passe, genre: 'decision' });
  const faux = repondus.filter((r) => r.obtenu !== r.attendu).slice(0, 4);
  for (const f of faux) console.log(`    ✗ attendu ${f.attendu}, rendu ${f.obtenu} — ${String(f.texte).slice(0, 90)}`);
}
function bilanTri(usage, source, gardesUtiles, utiles, ecartesInutiles, inutiles, ms) {
  const passe = utiles > 0 && gardesUtiles / utiles >= 0.9 && inutiles > 0 && ecartesInutiles / inutiles >= 0.5;
  bilans.push({ usage, source, utiles, gardesUtiles, inutiles, ecartesInutiles, ms, passe, genre: 'tri' });
}

const veut = (usage) => !filtre || filtre === usage;
const sql = (requete) =>
  JSON.parse(execFileSync('sqlite3', ['-readonly', '-json', base, requete], { maxBuffer: 1 << 28, encoding: 'utf8' }) || '[]');
const melanger = (liste) => liste.map((x) => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map(([, x]) => x);

console.log(`Chargement de Laya (${dossier})…`);
if (!(await charge)) {
  console.error('Laya ne se charge pas.');
  process.exit(1);
}

/* ---- 1. Les jugements de l'ancien juge payant ------------------------ */

if (veut('comprehension-carte') || veut('niveau-carte')) {
  const traces = sql(
    `select usage_cle, question, reponse from jugement_traces
       where issue = 'repondu' and jetons_entree > 0 and usage_cle in ('comprehension-carte','niveau-carte')
       order by at desc`,
  );
  const parUsage = new Map();
  for (const t of traces) {
    if (!veut(t.usage_cle)) continue;
    let demande;
    let attendues;
    try {
      demande = JSON.parse(t.question);
      attendues = JSON.parse(t.reponse);
    } catch {
      continue; /* trace coupée à l'écriture (MEM-3181) : hors compte */
    }
    const liste = parUsage.get(t.usage_cle) ?? [];
    if (liste.length >= limite) continue;
    parUsage.set(t.usage_cle, liste);
    const { reponses, ms } = await juger(t.usage_cle, demande.state, demande.questions);
    const cle = t.usage_cle === 'comprehension-carte' ? 'score' : 'niveau';
    const attendue = attendues[cle];
    const obtenue = reponses[cle];
    const lire = (r) => (r?.type === 'score' ? String(Math.round(r.score)) : r?.choice);
    liste.push({ attendu: lire(attendue), obtenu: obtenue ? lire(obtenue) : undefined, ms, texte: demande.state?.titre });
  }
  for (const [usage, liste] of parUsage) {
    console.log(`\n${usage} — contre l'ancien juge payant (${liste.length} cas)`);
    bilanDecision(usage, 'ancien juge payant', liste);
  }
}

/* ---- 2. Les niveaux posés par le cadrage ----------------------------- */

if (veut('niveau-carte') && examen) {
  const liste = [];
  for (const ex of examen.filter((e) => e.usage === 'niveau-carte')) {
    const { reponses, ms } = await juger('niveau-carte', ex.state, { [ex.cle]: ex.question });
    liste.push({ attendu: ex.cible, obtenu: reponses[ex.cle]?.choice, ms, texte: ex.state?.titre });
  }
  console.log(`\nniveau-carte — examen du jeu d'exemples (${liste.length} cartes jamais vues)`);
  bilanDecision('niveau-carte', 'examen du jeu', liste);
} else if (veut('niveau-carte')) {
  const liste = [];
  for (const niveau of ['leger', 'standard', 'approfondi']) {
    const cartes = sql(
      `select title, description from cards
         where json_extract(data, '$.run.niveau') = '${niveau}' and length(coalesce(description,'')) > 40
         order by random() limit ${Math.ceil(limite / 3)}`,
    );
    for (const c of cartes) {
      const { reponses, ms } = await juger(
        'niveau-carte',
        { titre: c.title.slice(0, 300), description: (c.description ?? '').slice(0, 3000) },
        questionNiveauDeCarte(),
      );
      liste.push({ attendu: niveau, obtenu: reponses.niveau?.choice, ms, texte: c.title });
    }
  }
  console.log(`\nniveau-carte — contre le niveau posé par le cadrage (${liste.length} cartes)`);
  bilanDecision('niveau-carte', 'niveau posé', liste);
}

/* ---- 3. Les cas étiquetés -------------------------------------------- */

async function casDeDecision(usage, questions, etatDe, lire) {
  if (!veut(usage)) return;
  const liste = [];
  for (const c of cas[usage].slice(0, limite)) {
    const { reponses, ms } = await juger(usage, etatDe(c), questions);
    liste.push({ attendu: String(c[0]), obtenu: lire(reponses), ms, texte: c[1] });
  }
  console.log(`\n${usage} — cas étiquetés (${liste.length})`);
  bilanDecision(usage, 'cas étiquetés', liste);
}

await casDeDecision('genre-carte-auto', questionGenreDeCarte(), (c) => ({ titre: c[1], description: '' }), (r) => r.genre?.choice);
await casDeDecision('famille-erreur', questionFamilleDErreur(), (c) => c[1], (r) => r.famille?.choice);
await casDeDecision('nature-demande', questionNatureDeLaDemande(), (c) => c[1], (r) => r.nature?.choice);
await casDeDecision(
  'urgence-demande',
  questionUrgence(),
  (c) => ({ titre: c[1], description: '', arriveePar: 'essai' }),
  (r) => (r.urgente ? String(r.urgente.noul >= 0.6) : undefined),
);
await casDeDecision(
  'doublon-carte',
  questionDoublon(),
  (c) => ({ proposee: { titre: c[1], description: '' }, existante: { titre: c[2], description: '' } }),
  (r) => (r.doublon ? String(r.doublon.noul >= SEUIL_DOUBLON) : undefined),
);

/* ---- 4. Les tris de pertinence --------------------------------------- */

/** Garde-t-on chaque document ? Le démon garde tout ce qui n'est pas un « non » franc. */
async function trier(usage, demande, documents) {
  const questions = questionsDePertinence(documents);
  const { reponses, ms } = await juger(usage, demande, questions);
  const gardes = documents.map((_, i) => {
    const r = reponses[`d${i}`];
    return !(r?.type === 'noul' && r.noul < SEUIL_PERTINENCE);
  });
  return { gardes, ms };
}

function lireLesCompetences() {
  const racine = path.join(depotPrincipal(), 'data/competences');
  /* Les fiches de BIBLIOTHÈQUE ne sont jamais annoncées : le démon ne les trie pas. */
  const importees = new Set();
  try {
    for (const b of Object.values(JSON.parse(fs.readFileSync(path.join(racine, '.bibliotheques.json'), 'utf8')))) {
      for (const nom of b.competences ?? []) importees.add(nom);
    }
  } catch {
    /* sans registre, rien d'importé */
  }
  const fiches = [];
  for (const nom of fs.readdirSync(racine)) {
    const fichier = path.join(racine, nom, 'SKILL.md');
    if (!fs.existsSync(fichier) || importees.has(nom)) continue;
    const tete = /^---\n([\s\S]*?)\n---/.exec(fs.readFileSync(fichier, 'utf8'))?.[1] ?? '';
    const bloc = /^description:\s*(.*(?:\n[ \t]+.*)*)/m.exec(tete)?.[1] ?? '';
    fiches.push({ nom, description: bloc.replace(/^>-?\s*/, '').replace(/\s+/g, ' ').trim() });
  }
  return fiches;
}

if (veut('pertinence-competences')) {
  /* Les fiches transverses (dossier de travail, base servie, contrôles de
     navigateur) peuvent servir presque partout : elles ne comptent ni comme
     utiles ni comme inutiles. */
  const NEUTRES = new Set(['scripts-de-projet-lances-depuis-un-worktree', 'trouver-la-base-reellement-servie', 'verifs-navigateur-etat-plutot-que-hauteur']);
  const fiches = lireLesCompetences();
  let utiles = 0;
  let gardesUtiles = 0;
  let inutiles = 0;
  let ecartes = 0;
  let ms = 0;
  console.log(`\npertinence-competences — ${cas['pertinence-competences'].length} demandes × ${fiches.length} fiches`);
  for (const [demande, attendues] of cas['pertinence-competences']) {
    const r = await trier('pertinence-competences', demande, fiches.map((f) => ({ cle: f.nom, texte: `${f.nom} : ${f.description}` })));
    ms += r.ms;
    fiches.forEach((f, i) => {
      if (NEUTRES.has(f.nom) && !attendues.includes(f.nom)) return;
      if (attendues.includes(f.nom)) {
        utiles += 1;
        if (r.gardes[i]) gardesUtiles += 1;
        else console.log(`    ✗ utile écartée : ${f.nom} — ${demande.slice(0, 60)}`);
      } else {
        inutiles += 1;
        if (!r.gardes[i]) ecartes += 1;
      }
    });
  }
  bilanTri('pertinence-competences', 'cas étiquetés', gardesUtiles, utiles, ecartes, inutiles, Math.round(ms / cas['pertinence-competences'].length));
}

if (veut('pertinence-memoire') && examen) {
  const groupes = new Map();
  for (const ex of examen.filter((e) => e.usage === 'pertinence-memoire')) {
    const id = ex.id.slice(0, ex.id.lastIndexOf(':'));
    const g = groupes.get(id) ?? { state: ex.state, questions: {}, cibles: {} };
    g.questions[ex.cle] = ex.question;
    g.cibles[ex.cle] = ex.cible;
    groupes.set(id, g);
  }
  let utiles = 0;
  let gardesUtiles = 0;
  let inutiles = 0;
  let ecartes = 0;
  let ms = 0;
  for (const g of groupes.values()) {
    const r = await juger('pertinence-memoire', g.state, g.questions);
    ms += r.ms;
    for (const [cle, utile] of Object.entries(g.cibles)) {
      const rep = r.reponses[cle];
      const garde = !(rep?.type === 'noul' && rep.noul < SEUIL_PERTINENCE);
      if (utile) {
        utiles += 1;
        if (garde) gardesUtiles += 1;
      } else {
        inutiles += 1;
        if (!garde) ecartes += 1;
      }
    }
  }
  console.log(`\npertinence-memoire — examen du jeu d'exemples (${groupes.size} recherches jamais vues)`);
  bilanTri('pertinence-memoire', 'examen du jeu', gardesUtiles, utiles, ecartes, inutiles, Math.round(ms / Math.max(1, groupes.size)));
} else if (veut('pertinence-memoire')) {
  /* LA VÉRITÉ : une unité OUVERTE par un agent dans la minute qui suit sa
     recherche lui était utile. Les INUTILES sont des unités tirées au hasard
     dans le même projet, sans rapport avec la recherche. */
  const lectures = sql(
    `select c.title as titre, r.sujet as recherche, u.titre as utitre, u.resume as uresume, u.importance, u.portee
       from memoire_consultation l
       join memoire_consultation r on r.agent_id = l.agent_id and r.created_at < l.created_at and r.created_at > l.created_at - 60000
         and r.sujet like 'connaissances:%' and r.sujet not like 'connaissances:MEM-%' and r.sujet not like 'connaissances:DEC-%'
       join connaissances u on u.id = substr(l.sujet, 15)
       left join cards c on c.id = l.card_id
       where (l.sujet like 'connaissances:MEM-%' or l.sujet like 'connaissances:DEC-%') and u.importance != 'P0'
       group by l.id order by random() limit ${limite}`,
  );
  let utiles = 0;
  let gardesUtiles = 0;
  let inutiles = 0;
  let ecartes = 0;
  let ms = 0;
  for (const l of lectures) {
    const hasard = sql(
      `select titre, resume from connaissances where portee = '${String(l.portee).replace(/'/g, "''")}' and statut = 'active'
         order by random() limit 3`,
    );
    const docs = [{ cle: 'utile', texte: `${l.utitre} — ${l.uresume}` }, ...hasard.map((h, i) => ({ cle: `h${i}`, texte: `${h.titre} — ${h.resume}` }))];
    const demande = `${l.titre ?? ''}\n${String(l.recherche).slice('connaissances:'.length)}`.trim();
    const r = await trier('pertinence-memoire', demande, docs);
    ms += r.ms;
    utiles += 1;
    if (r.gardes[0]) gardesUtiles += 1;
    else console.log(`    ✗ utile écartée : ${l.utitre.slice(0, 60)} — ${demande.replace(/\n/g, ' / ').slice(0, 60)}`);
    for (let i = 1; i < docs.length; i++) {
      inutiles += 1;
      if (!r.gardes[i]) ecartes += 1;
    }
  }
  console.log(`\npertinence-memoire — ${lectures.length} lectures réelles, ${inutiles} unités tirées au hasard`);
  bilanTri('pertinence-memoire', 'lectures réelles', gardesUtiles, utiles, ecartes, inutiles, Math.round(ms / Math.max(1, lectures.length)));
}

service.kill();
if (sortieJson) {
  fs.mkdirSync(path.dirname(path.resolve(sortieJson)), { recursive: true });
  fs.writeFileSync(sortieJson, JSON.stringify({ modele: modele ? path.resolve(modele) : 'origine', ecritLe: Date.now(), bilans }, null, 2));
}

/* ------------------------------------------------------------------ */

const pc = (n, t) => (t ? `${Math.round((n / t) * 100)} %` : '—');
console.log('\n══════════════ BILAN ══════════════');
for (const b of bilans) {
  if (b.genre === 'decision') {
    console.log(
      `${b.passe ? 'PASSE ' : 'ÉCHOUE'} ${b.usage.padEnd(24)} ${b.source.padEnd(20)} répond ${pc(b.repondus, b.total)} ` +
        `(${b.repondus}/${b.total}), juste ${pc(b.justes, b.repondus)} (${b.justes}/${b.repondus}), ${b.ms} ms`,
    );
  } else {
    console.log(
      `${b.passe ? 'PASSE ' : 'ÉCHOUE'} ${b.usage.padEnd(24)} ${b.source.padEnd(20)} garde ${pc(b.gardesUtiles, b.utiles)} des utiles ` +
        `(${b.gardesUtiles}/${b.utiles}), écarte ${pc(b.ecartesInutiles, b.inutiles)} des inutiles (${b.ecartesInutiles}/${b.inutiles}), ${b.ms} ms`,
    );
  }
}
console.log('\nPASSE = peut être allumé par défaut (répond ≥ 50 % et juste ≥ 90 % ; ou garde ≥ 90 % des utiles et écarte ≥ 50 % des inutiles).');
process.exit(0);
