#!/usr/bin/env node
/**
 * LA GÉNÉRATION DE LA BASE DE CONNAISSANCES, PAR UN MODÈLE — rejouable.
 *
 * Pour le Global puis pour chaque projet :
 *   1. rassemble la matière première : les fiches de l'ancienne mémoire (en base
 *      tant que les tables existent, sinon dans la sauvegarde
 *      `data/sauvegardes/memoire-avant-connaissances.json.gz`), et, pour la tête
 *      du projet, son dépôt (package.json, README, fichiers d'instructions,
 *      arborescence) ;
 *   2. la découpe en lots et fait écrire à un modèle des PROPOSITIONS
 *      structurées — jamais du texte libre —, jugées ici par la même règle que la
 *      porte d'écriture (`jugerProposition`), et écartées si elles recopient la
 *      matière mot pour mot ;
 *   3. fait rédiger la tête (00_project et « À ne jamais supposer ») par une
 *      seconde passe ;
 *   4. reconstruit le changelog complet depuis git, `HISTORIQUE.md` et les cartes
 *      livrées, sans rien inventer ;
 *   5. écrit un LOT par portée (`data/connaissances/lots/<portee>.json`) avec son
 *      rapport. Le démon importe les lots par la porte d'écriture au démarrage (et
 *      à la demande, depuis l'écran Mémoire) : le dédoublonnage y fait qu'un lot
 *      rejoué ne double rien.
 *
 * Chaque réponse du modèle est gardée en cache par l'empreinte de sa demande :
 * rejouer la génération ne recoûte aucun quota et rend le même rapport.
 *
 *   node scripts/generer-connaissances.mjs --a-blanc              # compter, sans modèle
 *   node scripts/generer-connaissances.mjs --portee Beluga       # un projet (nom ou id)
 *   node scripts/generer-connaissances.mjs --portee tous         # le Global et tous les projets
 *   node scripts/generer-connaissances.mjs --portee tous --sauf Beluga --portees-paralleles 6
 *   options : --modele claude-sonnet-5 --parallele 3 (appels par portée) --lot-signes 30000 --sortie <dossier>
 *             --portee accepte plusieurs noms séparés par des virgules
 *             --changelog-seul (git, historique et cartes, sans modèle)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { cheminDeLaBaseServie, dossierDesDonnees } from './lib/base-servie.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const partage = await import(path.join(RACINE, 'shared/dist/index.js'));

const args = process.argv.slice(2);
const option = (nom, defaut) => {
  const i = args.indexOf(`--${nom}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : defaut;
};
const drapeau = (nom) => args.includes(`--${nom}`);

const A_BLANC = drapeau('a-blanc');
const CHANGELOG_SEUL = drapeau('changelog-seul');
const PORTEE = option('portee', 'tous');
const MODELE = option('modele', 'claude-sonnet-5');
const PARALLELE = Math.max(1, Number(option('parallele', '3')) || 3);
const PORTEES_PARALLELES = Math.max(1, Number(option('portees-paralleles', '1')) || 1);
const SAUF = option('sauf', '').split(',').map((n) => n.trim().toLowerCase()).filter(Boolean);
const LOT_SIGNES = Math.max(4000, Number(option('lot-signes', '30000')) || 30000);
const DONNEES = dossierDesDonnees();
const SORTIE = option('sortie', path.join(DONNEES, 'connaissances', 'lots'));
const CACHE = path.join(path.dirname(SORTIE), 'cache');
const SAUVEGARDE = path.join(DONNEES, 'sauvegardes', 'memoire-avant-connaissances.json.gz');

const db = new Database(cheminDeLaBaseServie(DONNEES), { readonly: true, fileMustExist: true });
const tableExiste = (nom) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(nom));

/* ------------------------------------------------------------------ */
/* La matière première                                                  */
/* ------------------------------------------------------------------ */

function fichesAnciennes() {
  if (tableExiste('fiches_sujet')) {
    return db.prepare('SELECT classeur_id, sujet, markdown, modifie_le FROM fiches_sujet').all();
  }
  if (fs.existsSync(SAUVEGARDE)) {
    const sauvegarde = JSON.parse(zlib.gunzipSync(fs.readFileSync(SAUVEGARDE)).toString('utf8'));
    return sauvegarde.tables?.fiches_sujet ?? [];
  }
  return [];
}

/** Les blocs d'une fiche : un par sous-bloc « ### », les puces d'une section regroupées. */
function blocsDeFiche(markdown, sujet) {
  const blocs = [];
  let section = '';
  let courant = null;
  const fermer = () => {
    if (courant && courant.lignes.join('').trim()) blocs.push(`[${sujet} › ${courant.chemin}]\n${courant.lignes.join('\n').trim()}`);
    courant = null;
  };
  for (const ligne of markdown.split('\n')) {
    if (/^# /.test(ligne) || /^_Mis à jour le/.test(ligne) || ligne.trim() === '_Rien pour l’instant._') continue;
    if (/^## /.test(ligne)) {
      fermer();
      section = ligne.slice(3).trim();
      courant = { chemin: section, lignes: [] };
      continue;
    }
    if (/^### /.test(ligne)) {
      fermer();
      courant = { chemin: `${section} › ${ligne.slice(4).trim()}`, lignes: [] };
      continue;
    }
    if (!courant) courant = { chemin: 'À retenir', lignes: [] };
    courant.lignes.push(ligne.replace(/^>\s?/, ''));
  }
  fermer();
  return blocs;
}

function lotsDeMatiere(fiches) {
  const lots = [];
  let courant = '';
  for (const f of fiches) {
    for (const bloc of blocsDeFiche(f.markdown, f.sujet)) {
      const morceaux = bloc.length > LOT_SIGNES ? bloc.match(new RegExp(`[\\s\\S]{1,${LOT_SIGNES}}`, 'g')) : [bloc];
      for (const m of morceaux) {
        if (courant && courant.length + m.length + 2 > LOT_SIGNES) {
          lots.push(courant);
          courant = '';
        }
        courant = courant ? `${courant}\n\n${m}` : m;
      }
    }
  }
  if (courant) lots.push(courant);
  return lots;
}

function lire(fichier, max) {
  try {
    const t = fs.readFileSync(fichier, 'utf8');
    return t.length > max ? `${t.slice(0, max)}\n…` : t;
  } catch {
    return '';
  }
}

function depotDuProjet(projet) {
  const p = projet.path;
  if (!p || !fs.existsSync(p)) return '(dépôt introuvable sur le disque)';
  const morceaux = [];
  const pkg = lire(path.join(p, 'package.json'), 100_000);
  if (pkg) {
    try {
      const j = JSON.parse(pkg);
      morceaux.push(`package.json : nom ${j.name ?? '—'} ; scripts ${Object.keys(j.scripts ?? {}).join(', ')} ; dépendances ${Object.keys(j.dependencies ?? {}).slice(0, 40).join(', ')} ; espaces ${JSON.stringify(j.workspaces ?? [])}`);
    } catch {
      /* package.json illisible */
    }
  }
  for (const nom of ['README.md', 'CLAUDE.md', 'AGENTS.md']) {
    const t = lire(path.join(p, nom), 5000);
    if (t) morceaux.push(`--- ${nom} (début) ---\n${t}`);
  }
  try {
    const fichiers = execFileSync('git', ['-C', p, 'ls-files'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(Boolean);
    const dossiers = new Map();
    for (const f of fichiers) {
      const d = f.split('/').slice(0, 2).join('/');
      dossiers.set(d, (dossiers.get(d) ?? 0) + 1);
    }
    morceaux.push(`Arborescence (dossier : fichiers) : ${[...dossiers].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([d, n]) => `${d} ${n}`).join(' ; ')}`);
  } catch {
    /* pas un dépôt git */
  }
  return morceaux.join('\n\n');
}

/* ------------------------------------------------------------------ */
/* Le modèle                                                            */
/* ------------------------------------------------------------------ */

function appelerLeModele(prompt) {
  const cle = crypto.createHash('sha1').update(`${MODELE}\n${prompt}`).digest('hex');
  const fichier = path.join(CACHE, `${cle}.txt`);
  if (fs.existsSync(fichier)) return Promise.resolve({ texte: fs.readFileSync(fichier, 'utf8'), cache: true });
  return new Promise((resolve, reject) => {
    const enfant = spawn('claude', ['-p', '--output-format', 'json', '--model', MODELE, '--max-turns', '2'], {
      cwd: os.tmpdir(),
      env: { ...process.env, BELUGA_TOKEN: '' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let sortie = '';
    let erreurs = '';
    const minuteur = setTimeout(() => enfant.kill('SIGKILL'), 15 * 60_000);
    enfant.stdout.on('data', (d) => (sortie += d));
    enfant.stderr.on('data', (d) => (erreurs += d));
    enfant.on('error', reject);
    enfant.on('close', (code) => {
      clearTimeout(minuteur);
      try {
        const json = JSON.parse(sortie);
        if (json.is_error || typeof json.result !== 'string') throw new Error(json.result || `réponse sans texte (${json.subtype ?? code})`);
        fs.mkdirSync(CACHE, { recursive: true });
        fs.writeFileSync(fichier, json.result);
        resolve({ texte: json.result, cache: false });
      } catch (err) {
        reject(new Error(`modèle : ${err.message} ${erreurs.slice(0, 300)}`));
      }
    });
    enfant.stdin.end(prompt);
  });
}

async function enParallele(taches, n) {
  const resultats = new Array(taches.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, taches.length) }, async () => {
      while (i < taches.length) {
        const k = i++;
        resultats[k] = await taches[k]();
      }
    }),
  );
  return resultats;
}

/* ------------------------------------------------------------------ */
/* Le changelog                                                         */
/* ------------------------------------------------------------------ */

function changelogDuProjet(projet) {
  let commits = [];
  if (projet.path && fs.existsSync(path.join(projet.path, '.git'))) {
    try {
      const brut = execFileSync('git', ['-C', projet.path, 'log', '--format=%H%x1f%P%x1f%cI%x1f%s', '-n', '20000'], {
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
      });
      commits = brut.split('\n').map(partage.lireLigneDeGitLog).filter(Boolean);
    } catch {
      /* dépôt sans historique */
    }
  }
  const git = partage.entreesDepuisGit(projet.id, commits);
  const historique = lire(path.join(projet.path ?? '', 'HISTORIQUE.md'), 5_000_000)
    .split('\n')
    .map((l) => partage.lireLigneDHistorique(projet.id, l))
    .filter(Boolean);
  const cartes = db
    .prepare(
      `SELECT id, title, json_extract(data, '$.github.branch') AS branche, COALESCE(done_at, updated_at) AS livree, deployed_at
         FROM cards WHERE project_id = ? AND column_key IN ('archived', 'to_deploy')`,
    )
    .all(projet.id)
    .map((c) => ({ id: c.id, titre: c.title, branche: c.branche, livreeLe: c.livree, publieeLe: c.deployed_at }));
  const entrees = partage.reunirLeChangelog({ git, historique, cartes });
  return { entrees, commits: commits.length, historique: historique.length, cartes: cartes.length };
}

/* ------------------------------------------------------------------ */
/* Une portée                                                           */
/* ------------------------------------------------------------------ */

async function genererUnePortee(portee, fiches) {
  const global = portee.id === partage.PORTEE_GLOBALE;
  const nom = global ? 'Global' : portee.name;
  const matiere = fiches.filter((f) => f.sujet !== 'changelog' && !String(f.sujet).startsWith('competences-'));
  const lots = lotsDeMatiere(matiere);
  const rapport = { portee: portee.id, nom, lots: lots.length, signes: lots.reduce((n, l) => n + l.length, 0), propositions: 0, retenues: 0, fusionnees: 0, ecartees: [], appels: 0, cache: 0 };
  const changelog = global ? null : changelogDuProjet(portee);
  if (changelog) Object.assign(rapport, { changelog: changelog.entrees.length, commits: changelog.commits, lignesHistorique: changelog.historique, cartesLivrees: changelog.cartes });

  const retenues = new Map();
  const garder = (brutes, source) => {
    for (const brute of brutes) {
      rapport.propositions++;
      const type = partage.typeReconnu(brute.type) ?? brute.type;
      const j = partage.jugerProposition({ ...brute, type, action: 'create', source: { genre: brute.source?.genre ?? 'note', ref: brute.source?.ref ?? '' } });
      if (!j.ok) {
        rapport.ecartees.push({ titre: String(brute.titre ?? '').slice(0, 120), raisons: j.raisons });
        continue;
      }
      if (partage.recopieMotPourMot(`${j.propre.resume} ${j.propre.detail}`, source)) {
        rapport.ecartees.push({ titre: j.propre.titre, raisons: ['Recopie mot pour mot d’une ancienne note : à réécrire.'] });
        continue;
      }
      const cle = `${j.propre.type}|${partage.titreNormalise(j.propre.titre)}`;
      const deja = retenues.get(cle);
      if (deja) {
        rapport.fusionnees++;
        // La plus complète l'emporte ; « À ne jamais supposer » et l'importance la plus haute se gardent.
        const plusLongue = `${j.propre.resume}${j.propre.detail}`.length > `${deja.resume}${deja.detail}`.length ? j.propre : deja;
        retenues.set(cle, {
          ...plusLongue,
          importance: [deja.importance, j.propre.importance].sort()[0],
          jamaisSupposer: deja.jamaisSupposer || j.propre.jamaisSupposer,
          sujets: [...new Set([...deja.sujets, ...j.propre.sujets])],
        });
        continue;
      }
      retenues.set(cle, j.propre);
    }
  };

  if (!A_BLANC && !CHANGELOG_SEUL && lots.length) {
    let faits = 0;
    await enParallele(
      lots.map((lot) => async () => {
        const prompt = partage.consigneDeGeneration({ nomDeLaPortee: nom, global, matiere: lot, dejaConnus: [] });
        try {
          const { texte, cache } = await appelerLeModele(prompt);
          rapport.appels++;
          if (cache) rapport.cache++;
          garder(partage.lirePropositionsDuModele(texte), lot);
        } catch (err) {
          rapport.ecartees.push({ titre: `(lot ${faits + 1})`, raisons: [String(err.message ?? err).slice(0, 300)] });
        }
        faits++;
        process.stdout.write(`  ${nom} : lot ${faits}/${lots.length}, ${retenues.size} unité(s)\r`);
      }),
      PARALLELE,
    );
    process.stdout.write('\n');
    if (!global) {
      const provisoires = [...retenues.values()].map((u, i) => ({ id: `L-${i + 1}`, type: u.type, importance: u.importance, titre: u.titre, resume: u.resume.slice(0, 200) }));
      const prompt = partage.consigneDeSynthese({ nomDuProjet: nom, depot: depotDuProjet(portee), unites: provisoires.slice(0, 400) });
      try {
        const { texte, cache } = await appelerLeModele(prompt);
        rapport.appels++;
        if (cache) rapport.cache++;
        garder(partage.lirePropositionsDuModele(texte), '');
      } catch (err) {
        rapport.ecartees.push({ titre: '(tête du projet)', raisons: [String(err.message ?? err).slice(0, 300)] });
      }
    }
  }
  rapport.retenues = retenues.size;
  return {
    version: 1,
    portee: portee.id,
    nom,
    genereLe: Date.now(),
    modele: A_BLANC || CHANGELOG_SEUL ? null : MODELE,
    propositions: [...retenues.values()],
    changelog: changelog?.entrees ?? [],
    rapport,
  };
}

/* ------------------------------------------------------------------ */
/* Départ                                                               */
/* ------------------------------------------------------------------ */

const projets = db.prepare('SELECT id, name, path FROM projects WHERE archived = 0 ORDER BY name').all();
const toutes = fichesAnciennes();
const parClasseur = new Map();
for (const f of toutes) parClasseur.set(f.classeur_id, [...(parClasseur.get(f.classeur_id) ?? []), f]);

const portees = [{ id: partage.PORTEE_GLOBALE, name: 'Global', path: '' }, ...projets];
const demandees = PORTEE.split(',').map((n) => n.trim().toLowerCase()).filter(Boolean);
const visees = (demandees.includes('tous') ? portees : portees.filter((p) => demandees.includes(p.id.toLowerCase()) || demandees.includes(p.name.toLowerCase())))
  .filter((p) => !SAUF.includes(p.id.toLowerCase()) && !SAUF.includes(p.name.toLowerCase()));
if (!visees.length) {
  console.error(`Aucune portée ne répond à « ${PORTEE} ». Portées : ${portees.map((p) => p.name).join(', ')}`);
  process.exit(1);
}

fs.mkdirSync(SORTIE, { recursive: true });
console.log(`${A_BLANC ? 'À BLANC — ' : ''}${visees.length} portée(s), modèle ${MODELE}, ${toutes.length} fiche(s) d’ancienne mémoire, sortie ${SORTIE}`);
let total = 0;
await enParallele(visees.map((portee) => async () => {
  const classeur = portee.id === partage.PORTEE_GLOBALE ? 'global' : `projet:${portee.id}`;
  const lot = await genererUnePortee(portee, parClasseur.get(classeur) ?? []);
  const r = lot.rapport;
  total += r.retenues;
  console.log(
    `- ${r.nom} : ${r.lots} lot(s), ${r.signes} signes, ${r.propositions} proposition(s), ${r.retenues} retenue(s), ${r.fusionnees} fusionnée(s), ${r.ecartees.length} écartée(s)` +
      (r.changelog != null ? ` ; changelog ${r.changelog} entrée(s) (${r.commits} commits, ${r.lignesHistorique} lignes d’historique, ${r.cartesLivrees} cartes)` : '') +
      (r.appels ? ` ; ${r.appels} appel(s) dont ${r.cache} en cache` : ''),
  );
  const fichier = path.join(SORTIE, `${portee.id}.json`);
  // `--changelog-seul` rafraîchit le changelog d'un lot sans perdre ses propositions déjà rédigées.
  if (CHANGELOG_SEUL && fs.existsSync(fichier)) {
    const ancien = JSON.parse(fs.readFileSync(fichier, 'utf8'));
    Object.assign(lot, { propositions: ancien.propositions ?? [], modele: ancien.modele ?? null, rapport: { ...ancien.rapport, ...lot.rapport, propositions: ancien.rapport?.propositions, retenues: ancien.propositions?.length ?? 0 } });
  }
  if (!A_BLANC) fs.writeFileSync(fichier, JSON.stringify(lot, null, 1));
}), PORTEES_PARALLELES);
console.log(`${total} unité(s) retenue(s) au total.${A_BLANC ? ' Rien n’a été écrit.' : ' Le démon importera les lots au prochain démarrage, ou depuis l’écran Mémoire.'}`);
