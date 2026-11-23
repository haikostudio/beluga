#!/usr/bin/env node
/**
 * DEUX BRANCHES FIXES, ET AUCUNE AUTRE : « dev » ET « main ».
 *
 * La règle d'or du parc : tout projet — celui qu'on monte à l'instant comme
 * celui qui traîne depuis deux ans — déploie sur « dev » et met en production
 * sur « main ». Aucun autre schéma n'est autorisé.
 *
 * Quatre volets, sur du VRAI git, sans agent ni jeton :
 *
 *   1. LA RÈGLE PURE — sans réglage, « dev » au déploiement et « main » en
 *      production, y compris sur un dépôt qui vit en « master ».
 *   2. LA POSE — `assurerLesBranchesDeLaRegle` fait EXISTER les deux branches
 *      sur un dépôt qui ne les a pas, sans rien supprimer ni renommer, et ne
 *      touche à rien quand elles sont déjà là.
 *   3. L'ÉCART — une branche réglée à la main l'emporte encore, mais elle est
 *      DITE, à l'écran comme dans le déroulé de la publication.
 *   4. L'AGENT — celui qui écrit une procédure de mise en ligne reçoit le
 *      schéma, et l'étape de production reçoit en plus la consigne sur les
 *      automatisations GitHub Actions.
 *
 *   npm run build:server && node scripts/verif-deux-branches-fixes.mjs
 *
 * Aucune base ni aucun dossier du serveur en service n'est touché : tout se
 * passe dans un dossier temporaire, retiré en partant.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-deux-branches-'));
process.env.BELUGA_DATA = path.join(racine, 'data');
fs.mkdirSync(process.env.BELUGA_DATA, { recursive: true });

const {
  BRANCHE_DEV_PAR_DEFAUT,
  BRANCHE_PRODUCTION_PAR_DEFAUT,
  brancheDePublication,
  brancheImposee,
  ecartAuSchema,
  mentionBrancheParDefaut,
  mentionEcartAuSchema,
  schemaDeBranches,
  promptAnalyseProcedure,
} = await import('../shared/dist/index.js');
const { assurerLesBranchesDeLaRegle, brancheDeDeploiement } = await import(
  '../server/dist/branche-de-deploiement.js'
);

let echecs = 0;
const dire = (ok, texte, detail = '') => {
  if (!ok) echecs += 1;
  console.log(`${ok ? '  ok  ' : '  RATÉ'} ${texte}${detail ? ` — ${detail}` : ''}`);
};

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
const existe = (cwd, branche) => {
  try {
    git(cwd, 'rev-parse', '--verify', '--quiet', branche);
    return true;
  } catch {
    return false;
  }
};

/** Un dépôt d'essai, sur la branche principale qu'on veut. */
function monterDepot(nom, principale = 'main', autres = []) {
  const cwd = path.join(racine, nom);
  fs.mkdirSync(cwd, { recursive: true });
  git(cwd, 'init', '-q', '-b', principale);
  git(cwd, 'config', 'user.email', 'essai@beluga');
  git(cwd, 'config', 'user.name', 'Essai');
  fs.writeFileSync(path.join(cwd, 'DEPART.md'), 'la base du projet\n');
  git(cwd, 'add', 'DEPART.md');
  git(cwd, 'commit', '-q', '-m', 'départ');
  for (const branche of autres) git(cwd, 'branch', branche);
  return cwd;
}

/* ------------------------------------------------------------------ */
console.log('\n1. LA RÈGLE PURE — « dev » déploie, « main » met en production');

dire(
  BRANCHE_DEV_PAR_DEFAUT === 'dev' && BRANCHE_PRODUCTION_PAR_DEFAUT === 'main',
  'les deux noms imposés sont bien « dev » et « main »',
);
dire(
  brancheImposee('dev') === 'dev' && brancheImposee('production') === 'main',
  'la branche imposée se lit d’un seul endroit',
);
dire(
  brancheDePublication({ cible: 'dev', principale: 'main' }).branche === 'dev' &&
    brancheDePublication({ cible: 'production', principale: 'main' }).branche === 'main',
  'sans aucun réglage, chaque étape va sur sa branche imposée',
);
dire(
  brancheDePublication({ cible: 'dev', principale: 'master', branchesConnues: ['master'] }).branche ===
    'dev' &&
    brancheDePublication({ cible: 'production', principale: 'master', branchesConnues: ['master'] })
      .branche === 'main',
  'un dépôt en « master » n’échappe pas au schéma',
);
dire(
  /sera créée/.test(
    brancheDePublication({ cible: 'dev', principale: 'main', branchesConnues: ['main'] }).raison,
  ),
  'un dépôt sans la branche imposée le dit, au lieu de repartir ailleurs',
);
dire(
  /« dev »/.test(mentionBrancheParDefaut('dev', ['main', 'dev'])) &&
    /« main »/.test(mentionBrancheParDefaut('production', ['main'])),
  'l’écran annonce la branche imposée sous une liste vide',
);

/* ------------------------------------------------------------------ */
console.log('\n2. LA POSE — les deux branches sont créées sur un dépôt qui ne les a pas');

const enMaster = monterDepot('vieux-projet', 'master');
const posees = await assurerLesBranchesDeLaRegle(enMaster);
dire(posees.ok, 'les deux branches sont annoncées en place', posees.details.join(' ; '));
dire(existe(enMaster, 'dev') && existe(enMaster, 'main'), '« dev » et « main » existent vraiment');
dire(existe(enMaster, 'master'), '« master » n’est ni supprimée ni renommée');
dire(
  git(enMaster, 'rev-parse', 'main').trim() === git(enMaster, 'rev-parse', 'master').trim(),
  '« main » part exactement de la branche principale constatée',
);
dire(
  git(enMaster, 'rev-parse', '--abbrev-ref', 'HEAD').trim() === 'master',
  'le dépôt n’a pas changé de branche',
);
dire(
  posees.branches.dev === 'dev' && posees.branches.production === 'main',
  'les réglages rendus au projet nomment les deux branches',
);

const dejaEnPlace = monterDepot('projet-a-jour', 'main', ['dev']);
const teteAvant = git(dejaEnPlace, 'rev-parse', 'dev').trim();
const reposees = await assurerLesBranchesDeLaRegle(dejaEnPlace);
dire(
  reposees.ok && git(dejaEnPlace, 'rev-parse', 'dev').trim() === teteAvant,
  'un dépôt déjà conforme n’est pas touché',
  reposees.details.join(' ; '),
);
dire(
  (await brancheDeDeploiement(monterDepot('depart-de-carte', 'master'))) === 'dev',
  'une carte lancée part de « dev », créée au besoin, jamais de « master »',
);

/* ------------------------------------------------------------------ */
console.log('\n3. L’ÉCART — une branche réglée à la main l’emporte, mais elle est DITE');

const horsSchema = brancheDePublication({ cible: 'dev', reglees: { dev: 'livraison' }, principale: 'main' });
dire(horsSchema.branche === 'livraison', 'la branche choisie est suivie : un projet en cours ne casse pas');
dire(horsSchema.ecart === true && /hors du schéma/.test(horsSchema.raison), 'l’écart est marqué et expliqué');
dire(
  ecartAuSchema('production', 'master') === true && ecartAuSchema('production', 'main') === false,
  'seul ce qui sort du schéma compte comme un écart',
);
dire(
  mentionEcartAuSchema('dev', 'dev') === undefined &&
    /« dev »/.test(String(mentionEcartAuSchema('dev', 'livraison'))),
  'la phrase d’écart n’apparaît que sur un vrai écart',
);
dire(
  brancheDePublication({ cible: 'production', reglees: { production: 'main' } }).ecart === false,
  'régler exactement le nom imposé n’est pas un écart',
);

/* LA CONFIGURATION D’UN PROJET EST UNE FENÊTRE À RUBRIQUES : le choix de branche
   vit dans le tronc commun des rubriques, pas dans une page précise. On lit donc
   TOUT le dossier — déplacer le champ d’une rubrique à l’autre ne casse rien,
   le retirer casse. */
const dossierConfig = new URL('../web/src/components/config-projet/', import.meta.url);
const ecran = fs
  .readdirSync(dossierConfig)
  .filter((nom) => nom.endsWith('.tsx'))
  .map((nom) => fs.readFileSync(new URL(nom, dossierConfig), 'utf8'))
  .join('\n');
dire(
  ecran.includes('mentionEcartAuSchema') && ecran.includes('data-ecart-schema'),
  'la configuration du projet affiche l’écart sous la liste des branches',
);

const publication = fs.readFileSync(new URL('../server/src/deploy.ts', import.meta.url), 'utf8');
dire(
  publication.includes('mentionEcartAuSchema'),
  'le déroulé d’une publication dit l’écart, il ne le tait pas',
);

/* ------------------------------------------------------------------ */
console.log('\n4. L’AGENT — celui qui écrit une procédure reçoit le schéma');

const consigneDev = schemaDeBranches('dev').join('\n');
const consigneProd = schemaDeBranches('production').join('\n');
dire(
  /« dev »/.test(consigneDev) && /« main »/.test(consigneDev),
  'la consigne nomme les deux branches',
);
dire(/Aucun autre nom de branche/.test(consigneDev), 'la consigne interdit tout autre schéma');
dire(
  /GitHub Actions/.test(consigneProd) && /workflows/.test(consigneProd),
  'la mise en production interroge les automatisations GitHub Actions',
);
dire(!/GitHub Actions/.test(consigneDev), 'le déploiement, lui, n’en parle pas : ce n’est pas son étape');

for (const cible of ['dev', 'production']) {
  const prompt = promptAnalyseProcedure(cible, { projet: 'Essai', dossier: '/tmp/essai' });
  dire(
    /SCHÉMA DE BRANCHES IMPOSÉ/.test(prompt),
    `l’analyse de « ${cible} » porte le schéma imposé`,
  );
}

/* ------------------------------------------------------------------ */
fs.rmSync(racine, { recursive: true, force: true });
console.log(echecs === 0 ? '\nTout est conforme à la règle d’or.\n' : `\n${echecs} contrôle(s) en échec.\n`);
process.exit(echecs === 0 ? 0 : 1);
