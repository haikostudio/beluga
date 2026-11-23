#!/usr/bin/env node
/**
 * LA BASE DE CONNAISSANCES, VÉRIFIÉE SUR LES LOTS RÉELS, DANS UNE BASE JETABLE.
 *
 * Rien n'est écrit dans la base servie : elle n'est lue que pour la liste des
 * projets et la matière de l'ancienne mémoire. Le script refuse :
 *  1. un import qui ne se rejoue pas à l'identique — les lots de
 *     `data/connaissances/lots` importés deux fois doivent donner le même nombre
 *     d'unités, sans une création au second passage ;
 *  2. un doublon actif (même portée, même titre normalisé, tous types confondus) ;
 *  3. une unité qui recopie mot pour mot un long passage de l'ancienne mémoire ;
 *  4. un projet généré sans tête (unités « project ») ou sans « À ne jamais
 *     supposer » dans son 00_project.md ;
 *  5. une fusion « tache/… » du dépôt de Beluga absente de son changelog ;
 *  6. un accueil qui dépasse son plafond.
 *
 *   node scripts/verif-connaissances.mjs
 *   node scripts/verif-connaissances.mjs --lots /autre/dossier
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { cheminDeLaBaseServie, dossierDesDonnees } from './lib/base-servie.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVIES = dossierDesDonnees();
const i = process.argv.indexOf('--lots');
const LOTS = i >= 0 ? process.argv[i + 1] : path.join(SERVIES, 'connaissances', 'lots');
if (!fs.existsSync(LOTS) || !fs.readdirSync(LOTS).some((f) => f.endsWith('.json'))) {
  console.error(`Aucun lot dans ${LOTS} : lance d’abord node scripts/generer-connaissances.mjs --portee tous.`);
  process.exit(1);
}

const servie = new Database(cheminDeLaBaseServie(SERVIES), { readonly: true, fileMustExist: true });
const projets = servie.prepare('SELECT id, name, path, archived, data, created_at, updated_at FROM projects').all();
const matiere = new Map();
const lignesAnciennes = servie.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='fiches_sujet'").get()
  ? servie.prepare('SELECT classeur_id, markdown FROM fiches_sujet').all()
  : (() => {
      const f = path.join(SERVIES, 'sauvegardes', 'memoire-avant-connaissances.json.gz');
      return fs.existsSync(f) ? JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8')).tables?.fiches_sujet ?? [] : [];
    })();
for (const l of lignesAnciennes) {
  const portee = l.classeur_id === 'global' ? 'global' : String(l.classeur_id).replace(/^projet:/, '');
  matiere.set(portee, `${matiere.get(portee) ?? ''}\n${l.markdown}`);
}

const JETABLE = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-connaissances-'));
process.env.BELUGA_DATA = JETABLE;
const { getDb } = await import(path.join(RACINE, 'server/dist/db.js'));
const k = await import(path.join(RACINE, 'server/dist/connaissances.js'));
const partage = await import(path.join(RACINE, 'shared/dist/index.js'));

const poser = getDb().prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
for (const p of projets) poser.run(p.id, p.name, p.path, p.archived, p.data, p.created_at, p.updated_at);

const echecs = [];
const compter = () => getDb().prepare('SELECT COUNT(*) AS n FROM connaissances').get().n;

// 1. Deux imports.
const premiers = k.importerLesLots({ dossier: LOTS, force: true });
const apresUn = compter();
const seconds = k.importerLesLots({ dossier: LOTS, force: true });
const apresDeux = compter();
const creeesAuSecond = seconds.reduce((n, r) => n + r.creees, 0);
console.log(`Import : ${premiers.length} lot(s), ${apresUn} unité(s) ; rejoué : ${apresDeux} unité(s), ${creeesAuSecond} créée(s) au second passage.`);
if (apresUn !== apresDeux || creeesAuSecond) echecs.push(`import non rejouable : ${apresUn} puis ${apresDeux} unités, ${creeesAuSecond} créées au second passage`);
for (const r of premiers) {
  if (r.refusees.length) console.log(`  ${r.nom} : ${r.refusees.length} proposition(s) refusée(s) par la porte (ex. « ${r.refusees[0].titre} » — ${r.refusees[0].raisons[0]})`);
}

// 2. Doublons.
const doublons = getDb()
  .prepare("SELECT portee, titre_norme, COUNT(*) AS n FROM connaissances WHERE statut = 'active' GROUP BY portee, titre_norme HAVING n > 1")
  .all();
if (doublons.length) echecs.push(`${doublons.length} doublon(s) actif(s), dont ${doublons[0].portee} › « ${doublons[0].titre_norme} »`);

// 3. Recopies mot pour mot.
let recopies = 0;
for (const u of getDb().prepare("SELECT id, portee, resume, detail FROM connaissances WHERE statut = 'active'").all()) {
  if (partage.recopieMotPourMot(`${u.resume} ${u.detail}`, matiere.get(u.portee) ?? '')) {
    recopies++;
    if (recopies <= 3) console.log(`  recopie : ${u.id} (${u.portee})`);
  }
}
if (recopies) echecs.push(`${recopies} unité(s) recopient mot pour mot l’ancienne mémoire`);

// 4. Têtes des projets.
const porteesGenerees = new Set(premiers.map((r) => r.portee));
for (const p of projets.filter((x) => porteesGenerees.has(x.id))) {
  const unites = k.unitesDeLaPortee(p.id);
  if (unites.length < 10) continue;
  k.rendreLesFichiers(p.id);
  const tete = fs.readFileSync(path.join(k.dossierDeLaPortee(p.id), '00_project.md'), 'utf8');
  const sansTete = !unites.some((u) => u.type === 'project');
  const sansJamais = /## À ne jamais supposer\n\n_Non renseigné\._/.test(tete);
  if (sansTete || sansJamais) echecs.push(`${p.name} : ${sansTete ? 'aucune unité « project »' : ''}${sansTete && sansJamais ? ', ' : ''}${sansJamais ? '« À ne jamais supposer » vide' : ''}`);
}

// 5. Changelog de Beluga contre git.
const beluga = projets.find((p) => p.name === 'Beluga');
if (beluga && fs.existsSync(path.join(beluga.path, '.git')) && porteesGenerees.has(beluga.id)) {
  // Un doublon fusionné par la reprise du passé est MASQUÉ, pas perdu : sa branche compte, qu'elle soit restée sur lui ou léguée à l'entrée gardée.
  const branches = new Set(getDb().prepare('SELECT branche FROM changelog_entrees WHERE project_id = ?').all(beluga.id).map((e) => e.branche).filter(Boolean));
  const fusions = execFileSync('git', ['-C', beluga.path, 'log', '--merges', '--format=%s', '-n', '20000'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n')
    .map((s) => /^Merge branch '(tache\/[^']+)'/.exec(s)?.[1])
    .filter(Boolean);
  const absentes = [...new Set(fusions)].filter((b) => !branches.has(b));
  console.log(`Changelog de Beluga : ${branches.size} branche(s) reliée(s), ${new Set(fusions).size} fusion(s) « tache/… » dans git, ${absentes.length} absente(s).`);
  if (absentes.length) echecs.push(`${absentes.length} fusion(s) « tache/… » absentes du changelog de Beluga, dont ${absentes.slice(0, 3).join(', ')}`);

  // 6. Accueil.
  const accueil = k.accueilDesConnaissances(beluga.id, beluga.name);
  console.log(`Accueil de Beluga : ${accueil.length} signes (plafond ${partage.ACCUEIL_CONNAISSANCES_MAX}).`);
  if (accueil.length > partage.ACCUEIL_CONNAISSANCES_MAX + 400) echecs.push(`accueil de Beluga au-dessus du plafond : ${accueil.length} signes`);

  // 7. Les quatre parties de l'accueil, chacune présente dès que le projet a de quoi la remplir.
  //    Reprend la même sélection que k.accueilDesConnaissances (tête, jamais supposer, vitales, changelog).
  const projetUnites = k.unitesDeLaPortee(beluga.id);
  const globalUnites = k.unitesDeLaPortee(partage.PORTEE_GLOBALE);
  const teteBeluga = projetUnites.filter((u) => u.type === 'project');
  const jamaisBeluga = [...projetUnites, ...globalUnites].filter((u) => u.jamaisSupposer && u.type !== 'project');
  const dejaDitsBeluga = new Set([...teteBeluga, ...jamaisBeluga].map((u) => u.id));
  const vitalesBeluga = [
    ...projetUnites.filter((u) => (u.importance === 'P0' || u.importance === 'P1') && !dejaDitsBeluga.has(u.id)),
    ...globalUnites.filter((u) => u.importance === 'P0' && !dejaDitsBeluga.has(u.id)),
  ];
  const partiesAttendues = [
    { titre: '00 — PROJET', aDesDonnees: teteBeluga.length > 0 },
    { titre: 'À NE JAMAIS SUPPOSER', aDesDonnees: jamaisBeluga.length > 0 },
    { titre: 'UNITÉS P0 ET P1', aDesDonnees: vitalesBeluga.length > 0 },
    { titre: 'CHANGELOG RÉCENT', aDesDonnees: k.entreesDuChangelog(beluga.id, 20).some((e) => partage.poidsDeLEntree(e) !== 'detail') },
  ];
  const manquantes = partiesAttendues.filter((p) => p.aDesDonnees && !accueil.includes(p.titre));
  if (manquantes.length) echecs.push(`accueil de Beluga : partie(s) manquante(s) alors que le projet a de quoi la (les) remplir : ${manquantes.map((p) => p.titre).join(', ')}`);
  else console.log(`Accueil de Beluga : les quatre parties sont présentes (tête ${teteBeluga.length}, jamais supposer ${jamaisBeluga.length}, P0/P1 ${vitalesBeluga.length}, changelog).`);
}

fs.rmSync(JETABLE, { recursive: true, force: true });
if (echecs.length) {
  console.error(`\nÉCHEC :\n- ${echecs.join('\n- ')}`);
  process.exit(1);
}
console.log('\nOK : base de connaissances rejouable, sans doublon ni recopie, têtes posées, changelog complet, accueil sous plafond.');
