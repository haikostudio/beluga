#!/usr/bin/env node
/**
 * LE FILTRE DE CONTENU, EN LIGNE DE COMMANDE.
 *
 * Les règles vivent dans `shared/src/filtre-contenu.ts` et se testent seules.
 * Ici : le disque, git et les VALEURS SENSIBLES, lues du côté privé
 * (`prive/valeurs-sensibles.json`, jamais publié) et complétées par les
 * adresses publiques de la machine au moment du filtre.
 *
 * Usages :
 *   node scripts/filtre-contenu.mjs --dossier <d> [--appliquer]   un dossier (la démo construite)
 *   node scripts/filtre-contenu.mjs --lot <depot> [--jusqua <ref>] [--depuis <ref>]…
 *                                                                  les commits qui partiraient
 *   node scripts/filtre-contenu.mjs --arbre <depot> [--rev <ref>] [--public]
 *   node scripts/filtre-contenu.mjs --historique <depot>          tout l'historique (toutes refs)
 *   node scripts/filtre-contenu.mjs --pre-push                    mode crochet git (entrée standard)
 *   node scripts/filtre-contenu.mjs --installer-crochet <depot>   pose le crochet pre-push autonome
 *   node scripts/filtre-contenu.mjs --expressions-filter-repo     les remplacements pour filter-repo
 *
 * Options : --valeurs <fichier> (ou BELUGA_VALEURS_SENSIBLES), --json.
 * Sortie : 0 aucun reste, 1 au moins un reste (envoi refusé), 2 filtre inutilisable.
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ici = path.dirname(fileURLToPath(import.meta.url));

/**
 * LES RÈGLES, PRISES À CÔTÉ D'ABORD. Posé comme crochet dans un dépôt, ce
 * script voyage avec sa copie des règles et des valeurs : il ne dépend alors
 * ni de l'emplacement du dépôt de Beluga Build, ni de sa dernière construction.
 */
function cheminDesRegles() {
  const candidats = [path.join(ici, 'filtre-contenu.js'), path.join(ici, '..', 'shared', 'dist', 'filtre-contenu.js')];
  return candidats.find((c) => fs.existsSync(c)) ?? null;
}

const lanceDirectement = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const reglesTrouvees = cheminDesRegles();
if (!reglesTrouvees) {
  const texte = 'Filtre de contenu inutilisable : shared/dist/filtre-contenu.js introuvable (construire « shared »). Rien ne part.';
  if (!lanceDirectement) throw new Error(texte);
  process.stderr.write(`${texte}\n`);
  process.exit(2);
}
const filtre = await import(pathToFileURL(reglesTrouvees).href);

export const NOM_DES_VALEURS = 'valeurs-sensibles.json';

export function cheminDesValeurs(explicite) {
  const candidats = [
    explicite,
    process.env.BELUGA_VALEURS_SENSIBLES,
    path.join(ici, NOM_DES_VALEURS),
    path.join(ici, '..', 'prive', NOM_DES_VALEURS),
  ].filter(Boolean);
  return candidats.find((c) => fs.existsSync(c)) ?? null;
}

/** Les règles compilées : valeurs déclarées + adresses publiques de la machine. */
export function chargerLesRegles(explicite) {
  const chemin = cheminDesValeurs(explicite);
  if (!chemin) {
    throw new Error('valeurs sensibles introuvables (prive/valeurs-sensibles.json) : le filtre ne répond pas à l’aveugle.');
  }
  const declarees = JSON.parse(fs.readFileSync(chemin, 'utf8'));
  const valeurs = filtre.avecLesIpsDeLaMachine(declarees, filtre.ipsPubliquesDesInterfaces(os.networkInterfaces()));
  return { regles: filtre.reglesDeFiltre(valeurs), valeurs, chemin };
}

function git(depot, args, options = {}) {
  return execFileSync('git', ['-C', depot, ...args], {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    ...options,
  });
}

/* ------------------------------------------------------------------ */
/* Un dossier                                                          */
/* ------------------------------------------------------------------ */

/**
 * FILTRER UN DOSSIER. Sans `appliquer`, rien n'est écrit et tout ce que le
 * filtre changerait compte comme un reste — c'est le contrôle d'un site déjà
 * servi. Avec `appliquer`, les remplacements sont écrits et seuls comptent les
 * restes d'après remplacement — c'est la préparation d'une démo à envoyer.
 */
export function filtrerUnDossier(dossier, regles, { appliquer = false } = {}) {
  const restes = [];
  const touches = [];
  let remplacements = 0;
  let fichiers = 0;
  const parcourir = (courant) => {
    for (const entree of fs.readdirSync(courant, { withFileTypes: true })) {
      const complet = path.join(courant, entree.name);
      if (entree.isDirectory()) {
        if (entree.name === '.git' || entree.name === 'node_modules') continue;
        parcourir(complet);
        continue;
      }
      if (!entree.isFile()) continue;
      const brut = fs.readFileSync(complet);
      if (brut.includes(0)) continue;
      fichiers += 1;
      const relatif = path.relative(dossier, complet);
      const texte = brut.toString('utf8');
      if (!appliquer) {
        restes.push(...filtre.examinerTexte(texte, regles, relatif));
        continue;
      }
      const filtre1 = filtre.filtrerTexte(texte, regles, relatif);
      if (filtre1.remplacements) {
        remplacements += filtre1.remplacements;
        touches.push(relatif);
        fs.writeFileSync(complet, filtre1.texte);
      }
      restes.push(...filtre1.restes);
    }
  };
  parcourir(dossier);
  return { ok: restes.length === 0, fichiers, remplacements, touches, restes };
}

/* ------------------------------------------------------------------ */
/* Des objets git                                                      */
/* ------------------------------------------------------------------ */

export async function* contenusDesBlobs(depot, shas) {
  const enfant = spawn('git', ['-C', depot, 'cat-file', '--batch'], { stdio: ['pipe', 'pipe', 'ignore'] });
  (async () => {
    for (const sha of shas) {
      if (!enfant.stdin.write(`${sha}\n`)) await new Promise((r) => enfant.stdin.once('drain', r));
    }
    enfant.stdin.end();
  })();
  let tampon = Buffer.alloc(0);
  for await (const morceau of enfant.stdout) {
    tampon = tampon.length ? Buffer.concat([tampon, morceau]) : morceau;
    for (;;) {
      const fin = tampon.indexOf(10);
      if (fin === -1) break;
      const [sha, type, taille] = tampon.subarray(0, fin).toString().split(' ');
      if (type === 'missing') {
        tampon = tampon.subarray(fin + 1);
        continue;
      }
      const n = Number(taille);
      if (tampon.length < fin + 1 + n + 1) break;
      const contenu = tampon.subarray(fin + 1, fin + 1 + n);
      tampon = tampon.subarray(fin + 2 + n);
      yield { sha, contenu };
    }
  }
}

const TAILLE_MAX_EXAMINEE = 16 * 1024 * 1024;

/**
 * EXAMINER DES OBJETS GIT : chaque fichier jamais enregistré dans la plage,
 * chaque message, chaque identité. `plage` suit `git rev-list` : `['--all']`,
 * ou `[tete, '--not', base…]` pour ce qui partirait par-dessus une base.
 */
export async function examinerLesObjets(depot, plage, regles) {
  const chemins = new Map();
  for (const ligne of git(depot, ['rev-list', '--objects', ...plage]).split('\n')) {
    const espace = ligne.indexOf(' ');
    if (espace === -1) continue;
    const sha = ligne.slice(0, espace);
    if (!chemins.has(sha)) chemins.set(sha, ligne.slice(espace + 1));
  }
  const types = spawnSync('git', ['-C', depot, 'cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], {
    input: `${[...chemins.keys()].join('\n')}\n`,
    maxBuffer: 256 * 1024 * 1024,
  }).stdout.toString();
  const blobs = types
    .split('\n')
    .map((ligne) => ligne.split(' '))
    .filter(([, type, taille]) => type === 'blob' && Number(taille) <= TAILLE_MAX_EXAMINEE)
    .map(([sha]) => sha);

  const restes = [];
  for await (const { sha, contenu } of contenusDesBlobs(depot, blobs)) {
    if (contenu.includes(0)) continue;
    restes.push(...filtre.examinerTexte(contenu.toString('utf8'), regles, chemins.get(sha)));
  }

  const identites = [];
  let commits = 0;
  const journal = git(depot, ['log', '--format=%H%x00%an <%ae>%x00%cn <%ce>%x00%B%x1e', ...plage]);
  for (const bloc of journal.split('\x1e')) {
    const [sha, auteur, committeur, message] = bloc.replace(/^\n/, '').split('\x00');
    if (!sha?.trim()) continue;
    commits += 1;
    identites.push(auteur, committeur);
    restes.push(...filtre.examinerTexte(message ?? '', regles, `message du commit ${sha.slice(0, 10)}`));
  }
  restes.push(...filtre.examinerIdentites(identites.filter(Boolean), regles));
  return { ok: restes.length === 0, commits, fichiers: blobs.length, restes };
}

/** Une référence existe-t-elle dans ce dépôt ? */
function existe(depot, ref) {
  return spawnSync('git', ['-C', depot, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).status === 0;
}

/**
 * CE QUI PARTIRAIT : les commits de `jusqua` absents de toutes les bases. Sans
 * base connue, tout ce qu'aucune branche distante ne porte encore.
 */
export async function examinerUnLot(depot, regles, { jusqua = 'HEAD', depuis = [] } = {}) {
  const bases = depuis.filter((ref) => existe(depot, ref));
  const plage = [jusqua, '--not', ...(bases.length ? bases : ['--remotes'])];
  return examinerLesObjets(depot, plage, regles);
}

/**
 * UN ARBRE, TEL QU'IL SERAIT PUBLIÉ : le contenu d'une révision, filtré. Avec
 * `public`, les chemins interdits au miroir public sont écartés d'abord.
 */
export async function examinerUnArbre(depot, regles, { rev = 'HEAD', public: auPublic = false } = {}) {
  let interdit = () => null;
  if (auPublic) {
    const { chemInterdit } = await import(pathToFileURL(path.join(ici, 'synchroniser-miroir-public.mjs')).href);
    interdit = chemInterdit;
  }
  const entrees = git(depot, ['ls-tree', '-r', '-z', rev])
    .split('\0')
    .filter(Boolean)
    .map((ligne) => {
      const [meta, chemin] = ligne.split('\t');
      const [, type, sha] = meta.split(' ');
      return { type, sha, chemin };
    })
    .filter((e) => e.type === 'blob' && !interdit(e.chemin));
  const parSha = new Map(entrees.map((e) => [e.sha, e.chemin]));
  const restes = [];
  let remplacements = 0;
  for await (const { sha, contenu } of contenusDesBlobs(depot, [...parSha.keys()])) {
    if (contenu.includes(0)) continue;
    const r = filtre.filtrerTexte(contenu.toString('utf8'), regles, parSha.get(sha));
    remplacements += r.remplacements;
    restes.push(...r.restes);
  }
  return { ok: restes.length === 0, fichiers: entrees.length, remplacements, restes };
}

/* ------------------------------------------------------------------ */
/* Le crochet pre-push                                                  */
/* ------------------------------------------------------------------ */

const VIDE = /^0+$/;

export async function examinerUnEnvoi(depot, regles, lignes) {
  const restes = [];
  let commits = 0;
  for (const ligne of lignes) {
    const [refLocale, shaLocal, , shaDistant] = ligne.trim().split(/\s+/);
    if (!refLocale || !shaLocal || VIDE.test(shaLocal)) continue;
    const base = shaDistant && !VIDE.test(shaDistant) && existe(depot, shaDistant) ? [shaDistant] : ['--remotes'];
    const examen = await examinerLesObjets(depot, [shaLocal, '--not', ...base], regles);
    commits += examen.commits;
    restes.push(...examen.restes.map((r) => ({ ...r, chemin: `${refLocale} › ${r.chemin}` })));
  }
  return { ok: restes.length === 0, commits, restes };
}

/**
 * POSER LE CROCHET : une copie AUTONOME du filtre (script, règles, valeurs) dans
 * les crochets du dépôt, et un `pre-push` qui l'appelle. Le verrou tient donc
 * même si le dépôt de Beluga Build est ailleurs, pas construit, ou en travaux.
 */
export function installerLeCrochet(depot, { valeurs } = {}) {
  const commun = git(depot, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim();
  const crochets = path.join(commun, 'hooks');
  const dossier = path.join(crochets, 'garde-contenu');
  fs.mkdirSync(dossier, { recursive: true });
  fs.copyFileSync(fileURLToPath(import.meta.url), path.join(dossier, 'filtre-contenu.mjs'));
  fs.copyFileSync(reglesTrouvees, path.join(dossier, 'filtre-contenu.js'));
  const source = cheminDesValeurs(valeurs);
  if (!source) throw new Error('valeurs sensibles introuvables : crochet non posé');
  fs.copyFileSync(source, path.join(dossier, NOM_DES_VALEURS));
  fs.chmodSync(path.join(dossier, NOM_DES_VALEURS), 0o600);
  const crochet = path.join(crochets, 'pre-push');
  fs.writeFileSync(
    crochet,
    '#!/bin/sh\n' +
      '# Garde de contenu posée par Beluga Build : aucun envoi ne part avec une donnée sensible.\n' +
      'exec node "$(dirname "$0")/garde-contenu/filtre-contenu.mjs" --pre-push\n',
  );
  fs.chmodSync(crochet, 0o755);
  return { crochet, dossier };
}

/* ------------------------------------------------------------------ */
/* La ligne de commande                                                 */
/* ------------------------------------------------------------------ */

function lireLesOptions(argv) {
  const options = { depuis: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const suivant = () => argv[++i];
    if (arg === '--dossier') options.dossier = suivant();
    else if (arg === '--appliquer') options.appliquer = true;
    else if (arg === '--lot') options.lot = suivant();
    else if (arg === '--jusqua') options.jusqua = suivant();
    else if (arg === '--depuis') options.depuis.push(suivant());
    else if (arg === '--arbre') options.arbre = suivant();
    else if (arg === '--rev') options.rev = suivant();
    else if (arg === '--public') options.public = true;
    else if (arg === '--historique') options.historique = suivant();
    else if (arg === '--pre-push') options.prePush = true;
    else if (arg === '--installer-crochet') options.installer = suivant();
    else if (arg === '--expressions-filter-repo') options.expressions = true;
    else if (arg === '--valeurs') options.valeurs = suivant();
    else if (arg === '--json') options.json = true;
  }
  return options;
}

async function principal() {
  const options = lireLesOptions(process.argv.slice(2));
  let charge;
  try {
    charge = chargerLesRegles(options.valeurs);
  } catch (erreur) {
    process.stderr.write(`Filtre de contenu inutilisable : ${erreur.message} Rien ne part.\n`);
    return 2;
  }
  const { regles, valeurs } = charge;

  if (options.expressions) {
    process.stdout.write(filtre.expressionsPourFilterRepo(valeurs));
    return 0;
  }
  if (options.installer) {
    const pose = installerLeCrochet(options.installer, { valeurs: options.valeurs });
    process.stdout.write(`Crochet pre-push posé : ${pose.crochet}\n`);
    return 0;
  }

  let resultat;
  let titre;
  if (options.dossier) {
    resultat = filtrerUnDossier(path.resolve(options.dossier), regles, { appliquer: options.appliquer });
    titre = `Dossier ${options.dossier} : ${resultat.fichiers} fichier(s), ${resultat.remplacements} remplacement(s)${options.appliquer ? ' appliqué(s)' : ''}`;
  } else if (options.lot) {
    resultat = await examinerUnLot(options.lot, regles, { jusqua: options.jusqua, depuis: options.depuis });
    titre = `Lot de ${options.lot} : ${resultat.commits} commit(s), ${resultat.fichiers} fichier(s) examiné(s)`;
  } else if (options.arbre) {
    resultat = await examinerUnArbre(options.arbre, regles, { rev: options.rev, public: options.public });
    titre = `Arbre ${options.rev ?? 'HEAD'} de ${options.arbre}${options.public ? ' (tel que publié)' : ''} : ${resultat.fichiers} fichier(s), ${resultat.remplacements} remplacement(s)`;
  } else if (options.historique) {
    resultat = await examinerLesObjets(options.historique, ['--all'], regles);
    titre = `Historique complet de ${options.historique} : ${resultat.commits} commit(s), ${resultat.fichiers} fichier(s) examiné(s)`;
  } else if (options.prePush) {
    const entree = fs.readFileSync(0, 'utf8');
    resultat = await examinerUnEnvoi(process.cwd(), regles, entree.split('\n').filter(Boolean));
    titre = `Garde de contenu avant envoi : ${resultat.commits} commit(s) examiné(s)`;
  } else {
    process.stderr.write('Rien à filtrer : --dossier, --lot, --arbre, --historique ou --pre-push.\n');
    return 2;
  }

  if (options.json) process.stdout.write(`${JSON.stringify({ titre, ...resultat })}\n`);
  else process.stdout.write(`${titre}\n${filtre.recitDesRestes(resultat.restes)}\n`);
  return resultat.ok ? 0 : 1;
}

if (lanceDirectement) {
  process.exit(await principal());
}
