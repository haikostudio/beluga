#!/usr/bin/env node
/*
 * LE JEU D'EXEMPLES DE L'ENTRAÎNEMENT DE LAYA, TIRÉ DES DÉCISIONS RÉELLES.
 *
 *   node scripts/laya-jeu-d-exemples.mjs            → écrit le jeu et dit ce qu'il contient
 *   node scripts/laya-jeu-d-exemples.mjs --essai    → compte seulement, n'écrit rien
 *
 * La base servie est lue en LECTURE SEULE (sqlite3 -readonly). Le jeu est écrit
 * hors git, sous `outils/laya/entrainement/exemples.jsonl` : il porte des
 * textes de cartes et de mémoire, qui n'ont rien à faire dans le dépôt.
 *
 * UNE LIGNE = UNE QUESTION, posée EXACTEMENT comme le démon la pose (mêmes
 * fonctions de `shared/src/jugement-rapide.ts`), avec sa réponse attendue :
 *   { id, usage, groupe, partie, state, cle, question, cible }
 * `cible` vaut la clé retenue pour un choix, `true` / `false` pour un oui/non.
 *
 * CE QUI ENTRE, ET POURQUOI SEULEMENT CELA — une vérité solide, pas une devinette :
 *  - NIVEAU d'une carte : celui que l'agent de cadrage a posé, sur les cartes
 *    SANS plan (un plan validé part toujours en « approfondi », quelle que soit
 *    l'ampleur : ce niveau-là ne dit rien du travail) ;
 *  - PERTINENCE DE LA MÉMOIRE : une unité ouverte par un agent dans la minute
 *    qui suit sa recherche lui était utile (oui) ; trois unités du même projet,
 *    tirées au hasard avec une graine fixe, ne l'étaient pas (non).
 * Ce qui N'ENTRE PAS : question/travail (l'absence de compréhension sur une
 * carte ne dit pas que c'était une question — vérifié à la main le 25.09.2026),
 * les doublons, le genre, la famille d'erreur et l'urgence (aucune vérité en
 * base). Les cas étiquetés à la main (`preuve-laya-cas.json`) restent réservés
 * à l'EXAMEN : ils disent si l'entraînement a abîmé ce qu'il ne visait pas.
 *
 * LA DÉCOUPE entraînement / examen se fait par CARTE d'origine
 * (`partieDeLExemple`, `shared/src/entrainement-laya.ts`) : fixe d'une nuit à
 * l'autre, et jamais un exemple d'examen vu à l'entraînement.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { partieDeLExemple, questionNiveauDeCarte, questionsDePertinence } from '../shared/dist/index.js';
import { cheminDeLaBaseServie, depotPrincipal } from './base-servie.mjs';

const essai = process.argv.includes('--essai');
const base = process.env.HAIKO_DB ?? cheminDeLaBaseServie();
const dossier = process.env.BELUGA_LAYA_DIR?.trim() || path.join(depotPrincipal(), 'outils/laya');
const sortie = path.join(dossier, 'entrainement', 'exemples.jsonl');

const sql = (requete) =>
  JSON.parse(execFileSync('sqlite3', ['-readonly', '-json', base, requete], { maxBuffer: 1 << 28, encoding: 'utf8' }) || '[]');

/** Un tirage reproductible : la même graine rend les mêmes négatifs chaque nuit. */
function hasard(graine) {
  let s = graine >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}
function graineDe(texte) {
  let h = 0x811c9dc5;
  for (let i = 0; i < texte.length; i++) h = Math.imul(h ^ texte.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

const lignes = [];
function ajouter(usage, groupe, id, state, questions, cibles) {
  const partie = partieDeLExemple(groupe);
  for (const [cle, question] of Object.entries(questions)) {
    if (!(cle in cibles)) continue;
    lignes.push({ id: `${id}:${cle}`, usage, groupe, partie, state, cle, question, cible: cibles[cle] });
  }
}

/* ---- Le niveau posé par le cadrage ----------------------------------- */

const cartes = sql(
  `select id, title, description, json_extract(data, '$.run.niveau') as niveau from cards
     where json_extract(data, '$.run.niveau') in ('leger','standard','approfondi')
       and length(coalesce(description,'')) > 40
       and coalesce(json_array_length(json_extract(data, '$.parcours.plans')), 0) = 0`,
);
for (const c of cartes) {
  ajouter(
    'niveau-carte',
    `carte:${c.id}`,
    `niveau:${c.id}`,
    { titre: c.title.slice(0, 300), description: (c.description ?? '').slice(0, 3000) },
    questionNiveauDeCarte(),
    { niveau: c.niveau },
  );
}

/* ---- La mémoire réellement ouverte ----------------------------------- */

const lectures = sql(
  `select l.id as lid, coalesce(l.card_id, l.agent_id) as groupe, c.title as titre,
          substr(r.sujet, 15) as recherche, u.id as uid, u.titre as utitre, u.resume as uresume, u.portee
     from memoire_consultation l
     join memoire_consultation r on r.agent_id = l.agent_id and r.created_at < l.created_at and r.created_at > l.created_at - 60000
       and r.sujet like 'connaissances:%' and r.sujet not like 'connaissances:MEM-%' and r.sujet not like 'connaissances:DEC-%'
       and r.sujet != 'connaissances:changelog'
     join connaissances u on u.id = substr(l.sujet, 15)
     left join cards c on c.id = l.card_id
    where (l.sujet like 'connaissances:MEM-%' or l.sujet like 'connaissances:DEC-%') and u.importance != 'P0'
    group by l.id`,
);
const parPortee = new Map();
for (const u of sql(`select id, titre, resume, portee from connaissances where statut = 'active' and importance != 'P0'`)) {
  const liste = parPortee.get(u.portee) ?? [];
  liste.push(u);
  parPortee.set(u.portee, liste);
}
for (const l of lectures) {
  const tirer = hasard(graineDe(`negatifs:${l.lid}`));
  const voisines = (parPortee.get(l.portee) ?? []).filter((u) => u.id !== l.uid);
  const negatifs = [];
  while (negatifs.length < 3 && voisines.length > negatifs.length) {
    const u = voisines[Math.floor(tirer() * voisines.length)];
    if (!negatifs.includes(u)) negatifs.push(u);
  }
  /* L'unité utile n'est pas toujours en tête : sa place est tirée elle aussi. */
  const docs = negatifs.map((u) => ({ cle: u.id, texte: `${u.titre} — ${u.resume}`, utile: false }));
  docs.splice(Math.floor(tirer() * (docs.length + 1)), 0, { cle: l.uid, texte: `${l.utitre} — ${l.uresume}`, utile: true });
  const demande = `${l.titre ?? ''}\n${l.recherche}`.trim();
  const cibles = Object.fromEntries(docs.map((d, i) => [`d${i}`, d.utile]));
  ajouter('pertinence-memoire', `lecture:${l.groupe}`, `memoire:${l.lid}`, demande, questionsDePertinence(docs), cibles);
}

/* ---- Le bilan ----------------------------------------------------------- */

const compte = {};
for (const l of lignes) {
  const c = (compte[l.usage] ??= { entrainement: 0, examen: 0, cibles: {} });
  c[l.partie] += 1;
  c.cibles[String(l.cible)] = (c.cibles[String(l.cible)] ?? 0) + 1;
}
for (const [usage, c] of Object.entries(compte)) {
  console.log(`${usage.padEnd(22)} entraînement ${c.entrainement}, examen ${c.examen} — réponses : ${JSON.stringify(c.cibles)}`);
}
/* Aucun groupe des deux côtés : c'est la garantie contre la fuite. */
const cotes = new Map();
for (const l of lignes) {
  const deja = cotes.get(l.groupe);
  if (deja && deja !== l.partie) {
    console.error(`FUITE : le groupe ${l.groupe} est des deux côtés.`);
    process.exit(1);
  }
  cotes.set(l.groupe, l.partie);
}

if (essai) process.exit(0);
fs.mkdirSync(path.dirname(sortie), { recursive: true });
fs.writeFileSync(`${sortie}.tmp`, lignes.map((l) => JSON.stringify(l)).join('\n') + '\n');
fs.renameSync(`${sortie}.tmp`, sortie);
console.log(`\n${lignes.length} questions écrites dans ${sortie}`);
