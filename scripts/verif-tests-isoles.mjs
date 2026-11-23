#!/usr/bin/env node
/**
 * AUCUN TEST N'ÉCRIT DANS LA BASE RÉELLEMENT SERVIE.
 *
 * Vingt-quatre fiches de sauvegarde « Boutique » ont dormi dans la base de
 * production entre le 01/09/2026 et le 06/09/2026, posées par un test qui
 * croyait travailler dans un bac à sable. Le passage de nuit les sauvegardait
 * en boucle, échouait — les dossiers temporaires étaient partis depuis
 * longtemps — puis convoquait un assistant après trois échecs : un agent, une
 * conversation, une question posée à l'utilisateur. D'où des décisions
 * attendues qui ne menaient nulle part.
 *
 * Deux contrôles, et il en faut deux :
 *
 *  1. STATIQUE — tout fichier de test qui ENREGISTRE en base doit poser
 *     `BELUGA_DATA` AVANT son premier import du démon.
 *  2. DYNAMIQUE — les tests tournent pour de vrai, et la base servie ne doit
 *     avoir gagné aucune ligne. C'est le seul contrôle qui attrape un chemin de
 *     fuite qu'on n'a pas prévu.
 *
 * Usage :
 *   node scripts/verif-tests-isoles.mjs           # les deux contrôles
 *   node scripts/verif-tests-isoles.mjs --statique  # sans lancer les tests
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { cheminDeLaBaseServie, depotPrincipal } from './base-servie.mjs';

const RACINE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DOSSIER_TESTS = path.join(RACINE, 'server', 'src', 'test');

/*
 * CE QUI COMPTE N'EST PAS L'IMPORT, C'EST L'ÉCRITURE. La base ne s'ouvre qu'au
 * premier `getDb()` : des dizaines de tests importent `runtime` ou `tools` pour
 * lire une consigne ou une liste d'outils, sans jamais toucher une ligne. Les
 * signaler tous ferait un contrôle qui crie en permanence — donc un contrôle
 * qu'on n'écoute plus. On ne retient que les tests qui ENREGISTRENT quelque
 * chose : eux, et eux seuls, peuvent salir la base servie.
 */
const MODULES_QUI_ECRIVENT = ['store.js', 'db.js', 'backups.js', 'tools.js'];

const ECRIVENT = [
  'store.save',
  'saveProject(',
  'saveAgent(',
  'saveCard(',
  'saveMessage(',
  'enregistrerSite(',
  'callTool(',
];

/** Les tables qu'un test égaré remplit — celles qui ont fait le dégât, et leurs voisines. */
const TABLES_SURVEILLEES = ['backup_sites', 'backup_points', 'agents', 'cards', 'projects', 'messages'];

let fautes = 0;
const dire = (ok, texte) => {
  if (!ok) fautes += 1;
  console.log(`${ok ? '  ok  ' : ' FAUX '} ${texte}`);
};

/* ------------------------------------------------------------------ */
/* 1. Le contrôle statique                                             */
/* ------------------------------------------------------------------ */

console.log('— Chaque test qui écrit en base pose-t-il son bac à sable ?');

const fichiers = fs.readdirSync(DOSSIER_TESTS).filter((nom) => nom.endsWith('.test.ts'));
let concernes = 0;

for (const nom of fichiers) {
  const source = fs.readFileSync(path.join(DOSSIER_TESTS, nom), 'utf8');

  /*
   * L'écriture ne compte que si le test a de quoi écrire : plusieurs tests
   * LISENT le code source du démon et y trouvent un `store.saveCard(` en toutes
   * lettres, sans jamais rien enregistrer. On exige donc les deux — un module
   * du démon importé, ET un geste d'écriture.
   */
  const importeLeDemon = MODULES_QUI_ECRIVENT.some((module) => source.includes(`'../${module}'`));
  const ecrit = importeLeDemon && ECRIVENT.some((geste) => source.includes(geste));
  if (!ecrit) continue;
  concernes += 1;

  const posee = source.indexOf('process.env.BELUGA_DATA');
  if (posee === -1) {
    dire(false, `${nom} enregistre dans la base sans jamais poser BELUGA_DATA`);
    continue;
  }
  /*
   * L'ORDRE COMPTE AUTANT QUE LA PRÉSENCE. `config.ts` lit le dossier de
   * données au tout premier import : une variable posée après ne sert plus à
   * rien. On exige donc qu'elle précède le premier import dynamique du démon.
   */
  const premierImport = source.search(/await import\(\s*['"]\.\.\//);
  dire(
    premierImport === -1 || posee < premierImport,
    `${nom} pose BELUGA_DATA avant son premier import du démon`,
  );
}

dire(concernes > 0, `${concernes} test(s) qui écrivent en base passés en revue`);

/* ------------------------------------------------------------------ */
/* 2. Le contrôle dynamique                                            */
/* ------------------------------------------------------------------ */

if (!process.argv.includes('--statique')) {
  const chemin = cheminDeLaBaseServie();
  console.log(`\n— La base servie bouge-t-elle pendant les tests ?\n  ${chemin}`);

  if (!fs.existsSync(chemin)) {
    console.log('  (aucune base servie sur cette machine : contrôle dynamique sans objet)');
  } else {
    const compter = () => {
      const db = new Database(chemin, { readonly: true });
      const relevé = {};
      for (const table of TABLES_SURVEILLEES) {
        try {
          relevé[table] = db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
        } catch {
          /* table absente sur cette génération de base : rien à surveiller */
        }
      }
      db.close();
      return relevé;
    };

    const avant = compter();
    try {
      // Les tests tournent depuis le DÉPÔT PRINCIPAL : c'est de là qu'un test
      // mal isolé atteindrait la base servie. Depuis une copie de carte, il
      // tomberait sur un `data/` vide et le contrôle ne prouverait rien.
      execFileSync('npm', ['test'], { cwd: depotPrincipal(), stdio: 'ignore' });
    } catch {
      console.log('  (npm test a échoué : le relevé reste valable, les tests sont à réparer)');
    }
    const apres = compter();

    for (const table of Object.keys(avant)) {
      dire(
        avant[table] === apres[table],
        `${table} : ${avant[table]} ligne(s) avant, ${apres[table]} après`,
      );
    }
  }
}

console.log(fautes ? `\n${fautes} contrôle(s) en échec.` : '\nTout est isolé.');
process.exit(fautes ? 1 : 0);
