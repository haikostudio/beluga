#!/usr/bin/env node
/**
 * EFFACE POUR DE BON un projet de la base, lui et tout ce qui lui est attaché.
 *
 * À ne pas confondre avec « Mettre de côté » (`scripts/retirer-projets-perimes.mjs`,
 * `project_manage retirer`), qui ne fait que cacher : ici, rien n'est
 * récupérable après coup. Ce script existe pour les projets HÉRITÉS dont le
 * dossier n'existe plus sur le serveur et dont on ne veut plus garder la trace
 * — le premier étant « paseo », l'ancien outil tiers, effacé le 18/08/2026 sur
 * demande explicite.
 *
 * Il ne touche RIEN hors de la base : ni le dossier du projet (qui n'existe
 * plus), ni son dépôt GitHub.
 *
 *   node scripts/effacer-projet-perime.mjs paseo            # montre, n'écrit rien
 *   node scripts/effacer-projet-perime.mjs paseo --ecrire   # efface, après sauvegarde
 *
 * TROIS GARDE-FOUS, dans cet ordre :
 *   1. le projet est désigné par son NOM et son identifiant doit figurer dans
 *      la liste blanche ci-dessous — jamais un homonyme, jamais un projet vivant ;
 *   2. il doit être DÉJÀ MIS DE CÔTÉ : on n'efface pas ce qui est en service ;
 *   3. la base entière est SAUVEGARDÉE avant la première écriture.
 *
 * La base visée est `HAIKODEV_DATA`, sinon le `data/` du dépôt d'où part le
 * script — lancé depuis une copie de travail, poser HAIKODEV_DATA=/root/haikodev/data.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Une copie de travail (`.worktrees/…`) n'installe pas toujours les dépendances :
// on retombe alors sur celles du dossier principal, déduites de HAIKODEV_DATA.
function chargerSqlite() {
  const pistes = [path.join(racine, 'node_modules/better-sqlite3')];
  if (process.env.HAIKODEV_DATA) {
    pistes.push(path.join(path.dirname(process.env.HAIKODEV_DATA), 'node_modules/better-sqlite3'));
  }
  for (const piste of pistes) {
    if (fs.existsSync(piste)) return require(piste);
  }
  console.error(`ARRÊT : better-sqlite3 introuvable (cherché : ${pistes.join(', ')}).`);
  process.exit(1);
}
const Database = chargerSqlite();

/** Liste blanche : seuls ces projets-là peuvent être effacés par ce script. */
const EFFAÇABLES = {
  paseo: 'cc112bcc-53b4-451b-9c02-c47037166258',
};

const ECRIRE = process.argv.includes('--ecrire');
const NOM = process.argv.slice(2).find((a) => !a.startsWith('--'));
const DOSSIER_DONNEES = process.env.HAIKODEV_DATA ?? path.join(racine, 'data');
const BASE = path.join(DOSSIER_DONNEES, 'haikodev.db');

if (!NOM || !(NOM in EFFAÇABLES)) {
  console.error(`ARRÊT : nommer un projet de la liste blanche (${Object.keys(EFFAÇABLES).join(', ')}).`);
  process.exit(1);
}
if (!fs.existsSync(BASE)) {
  console.error(`ARRÊT : aucune base à ${BASE} — poser HAIKODEV_DATA sur le dossier data du démon.`);
  process.exit(1);
}

const ID = EFFAÇABLES[NOM];
const db = new Database(BASE);

const projet = db.prepare('SELECT id, archived, data FROM projects WHERE id = ?').get(ID);
if (!projet) {
  console.log(`« ${NOM} » est absent de la base — déjà effacé, rien à faire.`);
  db.close();
  process.exit(0);
}
if (!projet.archived) {
  console.error(`ARRÊT : « ${NOM} » est EN SERVICE. Le mettre de côté d'abord, puis relancer.`);
  db.close();
  process.exit(1);
}

/* Ce qui part avec le projet, table par table. `store.deleteProject` en oublie
 * plusieurs (propositions, consommation, dictées, économie de mémoire, secrets,
 * étiquettes et pièces jointes de cartes) : elles laissaient des orphelins. */
const agents = db.prepare('SELECT id FROM agents WHERE project_id = ?').all(ID).map((r) => r.id);
const cartes = db.prepare('SELECT id FROM cards WHERE project_id = ?').all(ID).map((r) => r.id);
const listeIn = (n) => Array(n).fill('?').join(',');

const compte = (sql, params = [ID]) => (params.length ? db.prepare(sql).get(...params).c : 0);
const inventaire = [
  ['projet', 1],
  ['cartes', cartes.length],
  ['agents', agents.length],
  ['messages', agents.length ? compte(`SELECT count(*) c FROM messages WHERE agent_id IN (${listeIn(agents.length)})`, agents) : 0],
  ['file d’attente', agents.length ? compte(`SELECT count(*) c FROM queue WHERE agent_id IN (${listeIn(agents.length)})`, agents) : 0],
  ['pièces jointes', compte('SELECT count(*) c FROM attachments WHERE project_id = ?')],
  ['publications', compte('SELECT count(*) c FROM deploys WHERE project_id = ?')],
  ['propositions', compte('SELECT count(*) c FROM proposals WHERE project_id = ?')],
  ['consommation', compte('SELECT count(*) c FROM usage WHERE project_id = ?')],
  ['dictées', compte('SELECT count(*) c FROM dictees WHERE project_id = ?')],
  ['identifiants', compte('SELECT count(*) c FROM secrets WHERE project_id = ?')],
  ['économie de mémoire', compte('SELECT count(*) c FROM memoire_economie WHERE project_id = ?')],
  ['étiquettes de cartes', cartes.length ? compte(`SELECT count(*) c FROM card_labels WHERE card_id IN (${listeIn(cartes.length)})`, cartes) : 0],
  ['pièces jointes de cartes', cartes.length ? compte(`SELECT count(*) c FROM card_attachments WHERE card_id IN (${listeIn(cartes.length)})`, cartes) : 0],
];

console.log(`« ${NOM} » (${JSON.parse(projet.data).path}) — ce qui serait effacé :`);
for (const [quoi, n] of inventaire) console.log(`  ${String(n).padStart(5)}  ${quoi}`);

if (!ECRIRE) {
  console.log('\nRien n’a été écrit. Relancer avec --ecrire pour effacer POUR DE BON.');
  db.close();
  process.exit(0);
}

// Garde-fou 3 : la base entière part en sauvegarde avant la première écriture.
const sauvegarde = path.join(DOSSIER_DONNEES, `haikodev.db.avant-effacement-${NOM}`);
db.prepare('VACUUM INTO ?').run(sauvegarde);
console.log(`\nSauvegarde de la base : ${sauvegarde}`);

db.transaction(() => {
  if (agents.length) {
    db.prepare(`DELETE FROM messages WHERE agent_id IN (${listeIn(agents.length)})`).run(...agents);
    db.prepare(`DELETE FROM queue WHERE agent_id IN (${listeIn(agents.length)})`).run(...agents);
  }
  if (cartes.length) {
    db.prepare(`DELETE FROM card_labels WHERE card_id IN (${listeIn(cartes.length)})`).run(...cartes);
    db.prepare(`DELETE FROM card_attachments WHERE card_id IN (${listeIn(cartes.length)})`).run(...cartes);
  }
  for (const table of ['agents', 'cards', 'attachments', 'deploys', 'proposals', 'usage', 'dictees', 'secrets', 'memoire_economie']) {
    db.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(ID);
  }
  db.prepare('DELETE FROM projects WHERE id = ?').run(ID);
})();

const reste = db.prepare('SELECT count(*) c FROM projects WHERE id = ?').get(ID).c;
console.log(reste ? '\n✗ ÉCHEC : le projet est toujours là.' : `\n✓ « ${NOM} » effacé. Recharger la page pour le voir.`);
db.close();
process.exit(reste ? 1 : 0);
