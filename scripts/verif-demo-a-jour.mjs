#!/usr/bin/env node
/**
 * LA DÉMO SERVIE EST-ELLE LA BONNE, ET PROPRE ?
 *
 * Pour chaque site lié (réglage `vitrineLiee` du projet, lu dans la base, ou
 * adresses données en option) :
 *
 *  1. `/demo/origine.json` nomme le commit d'où sort la démo servie : il doit
 *     être celui de `origin/dev` de l'application pour l'instance d'essai, et
 *     celui de `origin/main` pour la production. Sinon, le contrôle dit de
 *     combien de commits le site est en retard ;
 *  2. TOUS les fichiers de `/demo/assets` sont téléchargés — y compris ceux que
 *     l'application ne charge qu'à la demande (c'est un écran chargé à la
 *     demande qui portait l'adresse du serveur, et le fichier d'entrée seul ne
 *     la montrait pas). Chacun doit répondre 200 ;
 *  3. chacun passe au filtre de contenu, sans rien remplacer : ce qui est servi
 *     tel quel ne doit porter aucune valeur sensible.
 *
 *   node scripts/verif-demo-a-jour.mjs                       # les deux sites
 *   node scripts/verif-demo-a-jour.mjs --site essai          # l'instance d'essai seule
 *   node scripts/verif-demo-a-jour.mjs --site production
 *   node scripts/verif-demo-a-jour.mjs --essai <url> --production <url> [--depot <dépôt de l'application>]
 *
 * Ne vise JAMAIS `BELUGA_URL` : il lit les sites, pas l'application.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ici = path.dirname(fileURLToPath(import.meta.url));
const { chargerLesRegles } = await import(pathToFileURL(path.join(ici, 'filtre-contenu.mjs')).href);
const { examinerTexte } = await import(pathToFileURL(path.join(ici, '..', 'shared', 'dist', 'filtre-contenu.js')).href);

function option(nom) {
  const i = process.argv.indexOf(nom);
  return i === -1 ? undefined : process.argv[i + 1];
}

let echecs = 0;
const dire = (ok, texte) => {
  if (!ok) echecs += 1;
  console.log(`${ok ? '  ok  ' : '  ÉCHEC'} ${texte}`);
};

/** Le réglage `vitrineLiee`, lu dans la base réellement servie (lecture seule). */
function reglageDeLaBase() {
  const depot = path.dirname(execFileSync('git', ['-C', ici, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim());
  const donnees = process.env.BELUGA_DATA || path.join(depot, 'data');
  const base = [path.join(donnees, 'beluga.db')].find((f) => fs.existsSync(f) && fs.statSync(f).size > 0);
  if (!base) return null;
  try {
    const Database = createRequire(import.meta.url)('better-sqlite3');
    const db = new Database(base, { readonly: true, fileMustExist: true });
    const ligne = db
      .prepare("SELECT path, json_extract(data, '$.vitrineLiee') AS vitrine FROM projects WHERE json_extract(data, '$.vitrineLiee') IS NOT NULL LIMIT 1")
      .get();
    db.close();
    return ligne ? { depot: ligne.path, ...JSON.parse(ligne.vitrine) } : null;
  } catch {
    return null;
  }
}

const reglage = reglageDeLaBase() ?? {};
const depot = option('--depot') ?? reglage.depot;
const sites = [
  { nom: 'essai', adresse: option('--essai') ?? reglage.adresseEssai, branche: 'dev' },
  { nom: 'production', adresse: option('--production') ?? reglage.adresseProduction, branche: 'main' },
].filter((s) => !option('--site') || option('--site') === s.nom);

if (!depot || sites.some((s) => !s.adresse)) {
  console.error('Aucun site lié : ni réglage « vitrineLiee » dans la base, ni --essai/--production/--depot donnés.');
  process.exit(2);
}

const git = (...args) => execFileSync('git', ['-C', depot, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
try {
  git('fetch', '--quiet', 'origin');
} catch {
  /* hors réseau : on compare à ce que le dépôt connaît déjà */
}
const { regles } = chargerLesRegles();

async function lire(url) {
  const reponse = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'cache-control': 'no-cache' } });
  return { statut: reponse.status, texte: reponse.ok ? await reponse.text() : '' };
}

/** Les fichiers de /demo/assets, suivis de référence en référence jusqu'à la clôture. */
async function toutesLesRessources(base) {
  const vus = new Map();
  const aLire = ['index.html'];
  const motif = /(?:\/demo\/assets\/|\bassets\/|\.\/)([\w.-]+\.(?:js|css|svg|png|webp|jpe?g|woff2?|json))/g;
  while (aLire.length) {
    const relatif = aLire.shift();
    const url = `${base}/demo/${relatif}`;
    if (vus.has(relatif)) continue;
    const lu = await lire(url);
    vus.set(relatif, lu);
    if (!/\.(js|css|html)$/.test(relatif) || !lu.texte) continue;
    for (const trouve of lu.texte.matchAll(motif)) {
      const suivant = `assets/${trouve[1]}`;
      if (!vus.has(suivant) && !aLire.includes(suivant)) aLire.push(suivant);
    }
  }
  return vus;
}

for (const site of sites) {
  const base = site.adresse.replace(/\/$/, '');
  console.log(`\n${site.nom === 'essai' ? 'Instance d’essai' : 'Production'} — ${base}`);

  let attendu = '';
  try {
    attendu = git('rev-parse', `origin/${site.branche}`);
  } catch {
    dire(false, `origin/${site.branche} est introuvable dans ${depot}`);
    continue;
  }
  const origine = await lire(`${base}/demo/origine.json?t=${Date.now()}`).catch((e) => ({ statut: 0, texte: '', erreur: e.message }));
  let servi = '';
  try {
    servi = JSON.parse(origine.texte).commit ?? '';
  } catch {
    servi = '';
  }
  if (servi === attendu) {
    dire(true, `la démo servie sort de origin/${site.branche} (${attendu.slice(0, 12)})`);
  } else {
    let retard = 'un nombre inconnu de';
    try {
      if (servi) retard = git('rev-list', '--count', `${servi}..origin/${site.branche}`);
    } catch {
      /* commit inconnu ici */
    }
    dire(false, `la démo servie sort de ${servi ? servi.slice(0, 12) : `rien (réponse ${origine.statut})`} : ${retard} commit(s) de retard sur origin/${site.branche} (${attendu.slice(0, 12)})`);
  }

  const ressources = await toutesLesRessources(base);
  const assets = [...ressources.keys()].filter((r) => r.startsWith('assets/'));
  const cassees = [...ressources.entries()].filter(([, lu]) => lu.statut !== 200);
  dire(assets.length > 0 && !cassees.length, `${ressources.size} fichier(s) servis dont ${assets.length} dans /demo/assets, tous en 200${cassees.length ? ` — sauf ${cassees.map(([r, lu]) => `${r} (${lu.statut})`).slice(0, 5).join(', ')}` : ''}`);

  const restes = [];
  for (const [relatif, lu] of ressources) restes.push(...examinerTexte(lu.texte, regles, `/demo/${relatif}`));
  dire(
    !restes.length,
    restes.length
      ? `${restes.length} valeur(s) sensible(s) servie(s) : ${restes.slice(0, 5).map((r) => `${r.chemin} (${r.motif})`).join(', ')}`
      : 'aucune valeur sensible dans ce qui est servi',
  );
}

console.log(`\n${echecs === 0 ? 'Tout est vert.' : `${echecs} contrôle(s) au rouge.`}`);
process.exit(echecs === 0 ? 0 : 1);
