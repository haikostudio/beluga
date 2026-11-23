#!/usr/bin/env node
/**
 * CE QUE LES AGENTS LISENT VRAIMENT DE LA MÉMOIRE, CARTE PAR CARTE.
 *
 * Constat du 05/11/2026 (carte « Agents qui ignorent la mémoire UI ») : sur les
 * dernières cartes de Beluga, 0 à 2 unités lues par carte, presque jamais à
 * l'étape « travail », et aucune règle d'interface — d'où des listes natives
 * livrées malgré MEM-5799 / MEM-0781. Ce script rejoue la mesure, en LECTURE
 * SEULE sur la base servie, pour comparer avant / après :
 *
 *  - lectures par carte et par étape (comprehension, plan, travail) ;
 *  - cartes qui ont touché l'interface (fichiers de la branche sous un chemin
 *    déclencheur d'une charte, `web/src/` par défaut) ;
 *  - part de ces cartes qui ont REÇU une charte (`charte:<nom>` noté dans
 *    `connaissance_lectures`, posé par le service d'office des chartes).
 *
 *   node scripts/mesure-usage-memoire.mjs                 # Beluga, 25 cartes
 *   node scripts/mesure-usage-memoire.mjs --projet <id> --cartes 50 --json
 */
import Database from 'better-sqlite3';
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';

const PROJET_BELUGA = '90b65dcb-5139-460a-998d-a93cec9230e1';
const arg = (nom, defaut) => {
  const i = process.argv.indexOf(nom);
  return i >= 0 ? process.argv[i + 1] : defaut;
};
const projet = arg('--projet', PROJET_BELUGA);
const combien = Number(arg('--cartes', '25')) || 25;
const prefixeUi = arg('--chemin-ui', 'web/src/');
const enJson = process.argv.includes('--json');
const MOTS_UI = /\b(écran|page|interface|refonte|fiche|tiroir|bouton|formulaire|liste|calendrier|espace|menu|onglet)s?\b/i;

const db = new Database(cheminDeLaBaseServie(), { readonly: true, fileMustExist: true });

const cartes = db
  .prepare(
    `SELECT id, title, data FROM cards
      WHERE project_id = ? AND column_key IN ('review', 'done', 'deploy', 'archived', 'running')
        AND agent_id IS NOT NULL
      ORDER BY updated_at DESC LIMIT ?`,
  )
  .all(projet, combien);

const lectures = db.prepare('SELECT cle, etape FROM connaissance_lectures WHERE card_id = ?');

const lignes = cartes.map((c) => {
  let fichiers = [];
  try {
    fichiers = JSON.parse(c.data)?.github?.fichiers ?? [];
  } catch {
    /* données illisibles : aucune trace de fichiers */
  }
  const lu = lectures.all(c.id);
  const parEtape = { comprehension: 0, plan: 0, travail: 0, autre: 0 };
  for (const l of lu) {
    if (l.cle.startsWith('charte:')) continue;
    parEtape[l.etape in parEtape ? l.etape : 'autre'] += 1;
  }
  const chartes = lu.filter((l) => l.cle.startsWith('charte:')).map((l) => l.cle.slice(7));
  /* Une branche fusionnée perd souvent sa liste de fichiers : le titre de la
     carte sert alors de repli (mêmes mots que les déclencheurs des chartes). */
  const interface_ = fichiers.length
    ? fichiers.some((f) => String(f.chemin ?? '').startsWith(prefixeUi))
    : MOTS_UI.test(c.title ?? '');
  return { id: c.id, titre: c.title, total: lu.length - chartes.length, parEtape, interface: interface_, chartes };
});

const ui = lignes.filter((l) => l.interface);
const bilan = {
  cartes: lignes.length,
  lecturesMoyennes: lignes.length ? +(lignes.reduce((s, l) => s + l.total, 0) / lignes.length).toFixed(2) : 0,
  cartesSansLectureAuTravail: lignes.filter((l) => !l.parEtape.travail).length,
  cartesInterface: ui.length,
  cartesInterfaceAvecCharte: ui.filter((l) => l.chartes.length).length,
};

if (enJson) {
  console.log(JSON.stringify({ bilan, lignes }, null, 2));
} else {
  for (const l of lignes) {
    const e = l.parEtape;
    console.log(
      `${l.interface ? 'UI ' : '   '}${String(l.total).padStart(3)} lues (cadrage ${e.comprehension}, plan ${e.plan}, travail ${e.travail})` +
        `${l.chartes.length ? ` charte : ${l.chartes.join(', ')}` : ''} — ${l.titre}`,
    );
  }
  console.log('');
  console.log(`Cartes : ${bilan.cartes} — lectures moyennes : ${bilan.lecturesMoyennes} — sans lecture au travail : ${bilan.cartesSansLectureAuTravail}`);
  console.log(`Cartes d'interface : ${bilan.cartesInterface} — dont avec charte servie : ${bilan.cartesInterfaceAvecCharte}`);
}
