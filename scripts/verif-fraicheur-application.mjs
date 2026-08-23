#!/usr/bin/env node
/*
 * UN TÉLÉPHONE NE PEUT PLUS RESTER SUR UN ANCIEN ÉCRAN.
 *
 * Contrôle STATIQUE, sans navigateur, sans base, sans moteur : il ne lit que des fichiers.
 *
 * POURQUOI. L'application installable garde un cache, et le service worker n'efface les anciens
 * qu'à l'ARRIVÉE d'une version neuve — reconnue au seul fait que `sw.js` a changé d'octets. Son
 * numéro de cache s'écrivait à la main (« haikodev-v4 ») : une mise en ligne ordinaire laissait
 * donc le fichier identique, le navigateur n'y voyait rien de neuf, n'effaçait rien, et l'écran
 * d'avant pouvait rester servi indéfiniment. Depuis le 23/08/2026, le numéro vaut l'EMPREINTE du
 * paquet (`web/empreinte-paquet.ts`), posée à la construction.
 *
 * CE QUE CE SCRIPT PROUVE. Il recalcule l'empreinte LUI-MÊME, à partir des fichiers réellement
 * présents, et exige que `sw.js` porte celle de ses propres voisins. Un paquet neuf a d'autres
 * fichiers, donc une autre empreinte, donc un `sw.js` différent : la chaîne de rafraîchissement ne
 * peut plus rester muette.
 *
 * ET LE RELEVÉ. En fin de course, il compare l'empreinte du paquet SERVI (`data/live`) à celle du
 * paquet du DÉPÔT (`web/dist`). C'est une INFORMATION, pas un contrôle : un écart est normal tant
 * qu'une mise en ligne n'a pas été faite — elle est un geste de l'utilisateur, jamais de ce script.
 *
 * Le contrôle vise le dépôt d'où il PART (`import.meta.url`), jamais un chemin en dur : lancé
 * depuis une copie de travail, il juge cette copie.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const resultats = [];
const verifier = (nom, ok, detail) => {
  resultats.push(ok);
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/**
 * L'EMPREINTE, RECALCULÉE ICI. Volontairement réécrite plutôt qu'importée de `web/` : un contrôle
 * qui demanderait sa réponse au code contrôlé ne prouverait rien. Même définition — les noms des
 * fichiers d'`assets`, triés, hachés —, deux implémentations.
 */
function empreinteDuDossier(racine) {
  const assets = path.join(racine, 'assets');
  const noms = fs.existsSync(assets) ? fs.readdirSync(assets).sort() : [];
  return createHash('sha256').update(noms.join('\n')).digest('hex').slice(0, 16);
}

/** Le numéro de cache déclaré par un service worker, ou `null` s'il est illisible. */
function numeroDeCache(fichier) {
  if (!fs.existsSync(fichier)) return null;
  const trouve = /const CACHE = '([^']+)'/.exec(fs.readFileSync(fichier, 'utf8'));
  return trouve ? trouve[1] : null;
}

console.log("\nL'APPLICATION INSTALLABLE NE PEUT PLUS SERVIR UN ANCIEN ÉCRAN\n");

/* ------------------------------------------------------------------ */
/* 1. La source : le jeton est bien là, et rien n'est écrit à la main  */
/* ------------------------------------------------------------------ */

const swSource = path.join(RACINE, 'web/public/sw.js');
const numeroSource = numeroDeCache(swSource);
verifier(
  'le service worker du dépôt porte le jeton d’empreinte',
  numeroSource === 'haikodev-__EMPREINTE_DU_PAQUET__',
  numeroSource ? `numéro déclaré : « ${numeroSource} »` : 'aucun numéro lisible',
);

/* ------------------------------------------------------------------ */
/* 2. Le paquet construit : son numéro VAUT l'empreinte de ses assets  */
/* ------------------------------------------------------------------ */

const dist = path.join(RACINE, 'web/dist');
if (!fs.existsSync(path.join(dist, 'sw.js'))) {
  console.log('  web/dist n’a pas été construit : lancer « npm run build » avant ce contrôle.');
  console.log(`\n${resultats.filter(Boolean).length}/${resultats.length} contrôles passés.\n`);
  process.exit(resultats.every(Boolean) ? 0 : 1);
}

const empreinteDist = empreinteDuDossier(dist);
const numeroDist = numeroDeCache(path.join(dist, 'sw.js'));
verifier(
  'le paquet construit nomme son cache d’après SES PROPRES fichiers',
  numeroDist === `haikodev-${empreinteDist}`,
  `cache « ${numeroDist} », empreinte recalculée « ${empreinteDist} »`,
);

const versionDist = path.join(dist, 'version.json');
verifier(
  'le paquet construit dit sa version en clair',
  fs.existsSync(versionDist) &&
    JSON.parse(fs.readFileSync(versionDist, 'utf8')).empreinte === empreinteDist,
  fs.existsSync(versionDist) ? 'version.json présent et concordant' : 'version.json absent',
);

/*
 * LE CŒUR DE LA PREUVE : deux paquets différents ne peuvent pas porter le même numéro. On le
 * démontre sans reconstruire — en recalculant l'empreinte sur une liste de fichiers modifiée d'un
 * seul nom, comme le ferait la moindre mise en ligne.
 */
const assetsDist = fs.readdirSync(path.join(dist, 'assets')).sort();
const empreinteAutre = createHash('sha256')
  .update([...assetsDist.slice(1), 'index-0000000000.js'].sort().join('\n'))
  .digest('hex')
  .slice(0, 16);
verifier(
  'un paquet différent porte forcément un autre numéro de cache',
  empreinteAutre !== empreinteDist,
  `${empreinteDist} ≠ ${empreinteAutre}`,
);

/* ------------------------------------------------------------------ */
/* 3. RELEVÉ : le paquet servi face au paquet du dépôt                 */
/* ------------------------------------------------------------------ */

console.log('\n  RELEVÉ — ce qui est servi, face à ce que le dépôt produit :');

/*
 * OÙ EST LE PAQUET SERVI. Le CODE se juge dans le dépôt d'où l'on part, mais `data/live` n'est pas
 * du code : c'est le dossier de données, et une copie de travail n'en a pas. On remonte donc au
 * dépôt PRINCIPAL (`git rev-parse --git-common-dir` désigne son `.git`, quel que soit le worktree)
 * — sinon le relevé n'aurait rien à comparer, ce qui est exactement le cas qu'il doit éclairer.
 */
function dossierServi() {
  if (process.env.HAIKO_LIVE_DIR) return process.env.HAIKO_LIVE_DIR;
  const ici = path.join(RACINE, 'data/live');
  if (fs.existsSync(path.join(ici, 'assets'))) return ici;
  try {
    const commun = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: RACINE,
      encoding: 'utf8',
    }).trim();
    return path.join(path.dirname(commun), 'data/live');
  } catch {
    return ici;
  }
}

const live = dossierServi();
if (!fs.existsSync(path.join(live, 'assets'))) {
  console.log(`    aucun paquet servi dans ${live} : rien à comparer.`);
} else {
  const empreinteLive = empreinteDuDossier(live);
  const numeroLive = numeroDeCache(path.join(live, 'sw.js'));
  console.log(`    servi   : empreinte ${empreinteLive}, cache « ${numeroLive ?? 'illisible'} »`);
  console.log(`    dépôt   : empreinte ${empreinteDist}, cache « ${numeroDist} »`);
  if (empreinteLive === empreinteDist) {
    console.log('    → identiques : l’écran servi est celui du dépôt.');
  } else {
    console.log('    → DIFFÉRENTS : le dépôt a du travail pas encore mis en ligne.');
    console.log('      (la mise en ligne est un geste de l’utilisateur ; ce script ne publie rien)');
  }
  if (numeroLive && numeroLive !== `haikodev-${empreinteLive}`) {
    console.log(
      `    ⚠ le paquet SERVI nomme encore son cache à la main (« ${numeroLive} ») : il date d’avant`,
    );
    console.log('      ce correctif. La prochaine mise en ligne le remplace, et le défaut cesse.');
  }
}

/* ------------------------------------------------------------------ */

const echecs = resultats.filter((ok) => !ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles passés.\n`);
process.exit(echecs ? 1 : 0);
