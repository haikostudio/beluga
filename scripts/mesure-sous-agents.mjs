#!/usr/bin/env node
/*
 * LES AIDES (sous-agents) FONT-ELLES GAGNER OU PERDRE DU QUOTA ? Les chiffres.
 *
 * Un agent de tâche sous Claude peut déléguer à une aide (outil `Agent`, jadis
 * `Task`). Ce script relit la base, en LECTURE SEULE, et rend :
 *   1. les délégations des agents de tâche, par type d'aide et par carte
 *      (étapes « Délégation à un sous-agent » des messages) ;
 *   2. la part des aides dans la consommation des tours, quand elle est
 *      relevée (colonnes `aides_*` de `usage`, migration 122) ;
 *   3. la comparaison des cartes AVEC aide et SANS aide : jetons du principal
 *      par tour, part du quota de 5 h, durée machine.
 *
 * Rien n'est affiché dans l'application (« plus aucun compteur de jetons
 * visible ») : c'est ici qu'on juge. Le script ne vise jamais l'application
 * publiée et ne reprend aucun jeton : il lit le fichier de base.
 *
 *   node scripts/mesure-sous-agents.mjs
 *   MESURE_JOURS=7 node scripts/mesure-sous-agents.mjs
 *   HAIKO_DB=/chemin/beluga.db node scripts/mesure-sous-agents.mjs
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function racineDuDepot() {
  const commun = execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim();
  return path.dirname(path.resolve(commun));
}

const base = process.env.HAIKO_DB ?? path.join(racineDuDepot(), 'data', 'beluga.db');
if (!fs.existsSync(base)) {
  console.error(`Base introuvable : ${base}`);
  process.exit(1);
}
const jours = Number(process.env.MESURE_JOURS ?? 30);
const depuis = Date.now() - jours * 86_400_000;

const sql = (requete) =>
  JSON.parse(
    execFileSync('sqlite3', ['-readonly', '-json', base, requete], { maxBuffer: 1 << 30, encoding: 'utf8' }) || '[]',
  );

/* 1. Les délégations des agents de tâche. */
const delegations = sql(`
  SELECT a.card_id AS carte, m.agent_id AS agent,
         json_extract(s.value, '$.entree') AS entree,
         json_extract(s.value, '$.detail') AS detail
  FROM messages m
  JOIN agents a ON a.id = m.agent_id
  JOIN json_each(m.data, '$.steps') s
  WHERE m.created_at >= ${depuis}
    AND a.role = 'task'
    AND json_valid(m.data)
    AND (json_extract(s.value, '$.outil') IN ('Agent', 'Task')
         OR json_extract(s.value, '$.label') = 'Délégation à un sous-agent');
`);

const typeDe = (d) => /"subagent_type"\s*:\s*"([^"]+)"/.exec(d.entree ?? '')?.[1] ?? 'general-purpose';
const enFond = (d) =>
  /"run_in_background"\s*:\s*true/.test(d.entree ?? '') || /Async agent launched/.test(d.detail ?? '');

const parType = new Map();
const cartesAvecAide = new Set();
let enArrierePlan = 0;
for (const d of delegations) {
  parType.set(typeDe(d), (parType.get(typeDe(d)) ?? 0) + 1);
  if (enFond(d)) enArrierePlan += 1;
  if (d.carte) cartesAvecAide.add(d.carte);
}

console.log(`\nAIDES DES AGENTS DE TÂCHE — ${jours} derniers jours (${base})\n`);
console.log(`Délégations : ${delegations.length}, sur ${new Set(delegations.map((d) => d.agent)).size} agents et ${cartesAvecAide.size} cartes`);
console.log(`En arrière-plan : ${enArrierePlan}`);
for (const [type, n] of [...parType].sort((a, b) => b[1] - a[1])) console.log(`  ${type.padEnd(20)} ${n}`);

/* 2. La part des aides, quand elle est relevée. */
const colonnes = sql(`PRAGMA table_info(usage);`).map((c) => c.name);
const aidesRelevees = colonnes.includes('aides_tokens');
const tours = sql(`
  SELECT u.card_id AS carte, u.tokens, u.quota_5h AS q5, u.seconds,
         ${aidesRelevees ? 'u.aides_tokens AS aides, u.aides_modeles AS modeles' : '0 AS aides, NULL AS modeles'}
  FROM usage u
  JOIN agents a ON a.id = u.agent_id
  WHERE u.created_at >= ${depuis} AND u.engine = 'claude' AND a.role = 'task' AND u.card_id IS NOT NULL;
`);

if (!aidesRelevees) {
  console.log('\nPart des aides : pas encore relevée (la colonne arrive avec la migration 122).');
} else {
  const avecPart = tours.filter((t) => t.aides > 0);
  const total = tours.reduce((s, t) => s + (t.tokens ?? 0), 0);
  const aides = tours.reduce((s, t) => s + (t.aides ?? 0), 0);
  const parModele = new Map();
  for (const t of avecPart)
    for (const m of (t.modeles ?? '').split(',').filter(Boolean)) parModele.set(m, (parModele.get(m) ?? 0) + t.aides);
  console.log(`\nPart des aides : ${avecPart.length} tours sur ${tours.length} en ont une`);
  console.log(`  jetons des aides : ${aides.toLocaleString('fr-FR')} — ${total + aides ? ((100 * aides) / (total + aides)).toFixed(1) : 0} % du total`);
  for (const [m, n] of [...parModele].sort((a, b) => b[1] - a[1]))
    console.log(`  ${m.padEnd(22)} ${n.toLocaleString('fr-FR')} jetons (tours où ce modèle a servi d'aide)`);
}

/* 3. Cartes avec aide contre cartes sans aide. */
const parCarte = new Map();
for (const t of tours) {
  const c = parCarte.get(t.carte) ?? { tours: 0, tokens: 0, aides: 0, q5: 0, secondes: 0 };
  c.tours += 1;
  c.tokens += t.tokens ?? 0;
  c.aides += t.aides ?? 0;
  c.q5 += t.q5 ?? 0;
  c.secondes += t.seconds ?? 0;
  parCarte.set(t.carte, c);
}
const mediane = (valeurs) => {
  if (!valeurs.length) return 0;
  const v = [...valeurs].sort((a, b) => a - b);
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};
const groupe = (avec) => [...parCarte].filter(([id, c]) => cartesAvecAide.has(id) === avec || (avec && c.aides > 0)).map(([, c]) => c);
const ligne = (nom, cartes) =>
  console.log(
    `  ${nom.padEnd(10)} ${String(cartes.length).padStart(5)} cartes | jetons/tour ${Math.round(mediane(cartes.map((c) => (c.tokens + c.aides) / c.tours))).toLocaleString('fr-FR').padStart(10)}` +
      ` | quota 5 h/carte ${mediane(cartes.map((c) => c.q5)).toFixed(1).padStart(5)} %` +
      ` | durée/carte ${Math.round(mediane(cartes.map((c) => c.secondes)) / 60)} min`,
  );
console.log('\nCartes de tâche sous Claude (médianes ; jetons = principal + aides) :');
ligne('avec aide', groupe(true));
ligne('sans aide', groupe(false));
console.log(
  '\nÀ lire avec prudence : les cartes qui délèguent sont souvent les plus grosses, et un jeton du modèle léger coûte\n' +
    'bien moins qu’un jeton du principal. Juger sur le QUOTA par carte, AVANT / APRÈS le passage des aides sur modèle\n' +
    'léger (MESURE_JOURS), plutôt que sur les jetons.\n',
);
