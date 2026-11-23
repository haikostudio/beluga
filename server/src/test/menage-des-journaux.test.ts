/**
 * LE MÉNAGE QUOTIDIEN DES JOURNAUX ET DES TRACES DU JUGE.
 *
 * Verrouillé ici : sur une base d'essai, une ligne de plus de 7 jours est vidée
 * (la ligne et son rang restent), une récente est intacte, la trace vieille est
 * effacée et copiée avant, la récente gardée ; une seconde passe ne change
 * rien ; sans archive possible rien n'est vidé ; la base du juge se cumule
 * sans recalcul et reste sous son plafond.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const bac = fs.mkdtempSync(path.join(os.tmpdir(), 'menage-journaux-'));
process.env.BELUGA_DATA = bac;
const archives = path.join(bac, 'archives');
process.env.BELUGA_ARCHIVES_JOURNAUX = archives;

const { CONSERVATION_JOURNAUX_MS } = await import('@beluga/shared');
const { getDb } = await import('../db.js');
const { menageDesJournaux, fusionner, baseVide, plafonner, PLAFOND_DES_MOTIFS } = await import('../menage-des-journaux.js');

const MAINTENANT = Date.now();
const VIEUX = MAINTENANT - CONSERVATION_JOURNAUX_MS - 60_000;
const RECENT = MAINTENANT - 60_000;

function ligne(id: string, rang: number, at: number, resultat: string | null, params: string | null) {
  getDb()
    .prepare(
      `INSERT INTO card_journal (id, card_id, rang, phase, nature, at, libelle, outil, params, resultat, donnees)
       VALUES (?, 'c1', ?, 'execution', 'requete', ?, '', 'Read', ?, ?, '{"jalon":1}')`,
    )
    .run(id, rang, at, params, resultat);
}
function trace(usage: string, at: number, issue = 'repondu', reponse = '{}', suite = 'ok') {
  getDb()
    .prepare(
      `INSERT INTO jugement_traces (usage_cle, question, reponse, confiance, latence_ms, suite, issue, jetons_entree, jetons_sortie, at)
       VALUES (?, 'q', ?, 0.8, 100, ?, ?, 10, 5, ?)`,
    )
    .run(usage, reponse, suite, issue, at);
}

getDb();
ligne('a', 1, VIEUX, 'texte vieux', '{"p":1}');
ligne('b', 2, VIEUX, '', '{"p":2}'); // trace du pont : paramètres sans résultat
ligne('c', 3, RECENT, 'texte récent', '{"p":3}');
trace('u1', VIEUX);
trace('u1', VIEUX, 'echec', 'délai dépassé', 'repli');
trace('u2', RECENT);

test('archive puis allège : lignes gardées, texte vidé, récent intact, trace vieille effacée', async () => {
  const bilan = await menageDesJournaux(MAINTENANT);
  assert.equal(bilan.ignore, undefined);
  assert.equal(bilan.allegees, 2);
  assert.equal(bilan.traceesEffacees, 2);
  assert.equal(bilan.resumees, 2);
  const lignes = getDb().prepare('SELECT id, rang, resultat, params, donnees FROM card_journal ORDER BY rang').all() as any[];
  assert.equal(lignes.length, 3, 'aucune ligne retirée');
  assert.deepEqual(lignes.map((l) => l.rang), [1, 2, 3], 'rangs contigus');
  assert.equal(lignes[0].resultat, '');
  assert.equal(lignes[0].params, null);
  assert.equal(lignes[1].params, null, 'les paramètres orphelins sont vidés aussi');
  assert.equal(lignes[0].donnees, '{"jalon":1}', 'les données de l’écran ne bougent pas');
  assert.equal(lignes[2].resultat, 'texte récent');
  assert.equal(lignes[2].params, '{"p":3}');
  const restantes = getDb().prepare('SELECT usage_cle FROM jugement_traces').all() as any[];
  assert.deepEqual(restantes.map((t) => t.usage_cle), ['u2']);
});

test('l’archive a été écrite avant le vidage et se relit', () => {
  const fichiers = fs.readdirSync(archives);
  const journal = fichiers.find((f) => f.startsWith('journal-') && f.endsWith('.jsonl.gz'));
  const traces = fichiers.find((f) => f.startsWith('traces-juge-') && f.endsWith('.jsonl.gz'));
  assert.ok(journal && traces, fichiers.join(','));
  assert.ok(!fichiers.some((f) => f.endsWith('.tmp')), 'aucun temporaire oublié');
  const lues = zlib.gunzipSync(fs.readFileSync(path.join(archives, journal!))).toString().trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lues.length, 2);
  assert.equal(lues[0].resultat, 'texte vieux');
  assert.equal(lues[0].rang, 1);
});

test('la base du juge a résumé les traces avant leur effacement', () => {
  const md = fs.readFileSync(path.join(bac, 'juge', 'base-evolutive.md'), 'utf8');
  assert.match(md, /2 jugements/);
  assert.match(md, /délai dépassé/);
});

test('une seconde passe ne change rien', async () => {
  const bilan = await menageDesJournaux(MAINTENANT);
  assert.equal(bilan.allegees, 0);
  assert.equal(bilan.traceesEffacees, 0);
  assert.equal(bilan.resumees, 0);
  assert.equal(bilan.archiveesJournal, 0);
});

test('sans archive possible, rien n’est vidé', async () => {
  ligne('d', 4, VIEUX, 'à garder', null);
  trace('u3', VIEUX);
  const fichier = path.join(bac, 'pas-un-dossier');
  fs.writeFileSync(fichier, 'x');
  process.env.BELUGA_ARCHIVES_JOURNAUX = path.join(fichier, 'sous'); // impossible à créer
  const bilan = await menageDesJournaux(MAINTENANT);
  assert.ok(bilan.ignore);
  assert.equal(bilan.allegees, 0);
  const d = getDb().prepare("SELECT resultat FROM card_journal WHERE id = 'd'").get() as any;
  assert.equal(d.resultat, 'à garder');
  assert.equal((getDb().prepare("SELECT COUNT(*) n FROM jugement_traces WHERE usage_cle = 'u3'").get() as any).n, 1);
  process.env.BELUGA_ARCHIVES_JOURNAUX = archives;
});

test('une table absente ne fait rien tomber', async () => {
  getDb().exec('ALTER TABLE jugement_traces RENAME TO jugement_traces_x');
  const bilan = await menageDesJournaux(MAINTENANT);
  assert.ok(bilan.ignore);
  getDb().exec('ALTER TABLE jugement_traces_x RENAME TO jugement_traces');
});

test('la base du juge se cumule sans recalcul et reste sous son plafond', () => {
  const t = (id: number, suite: string) => ({
    id, usage_cle: 'u', reponse: '', confiance: null, latence_ms: 1, suite, issue: 'repondu', jetons_entree: 0, jetons_sortie: 0, at: id,
  });
  let b = fusionner(baseVide(), [t(1, 'a'), t(2, 'a')]);
  b = fusionner(b, [t(2, 'a'), t(3, 'b')]); // la trace 2 est déjà comptée
  assert.equal(b.total, 3);
  assert.equal(b.suites.a, 2);
  const beaucoup = Array.from({ length: 200 }, (_, i) => t(10 + i, `motif ${i}`));
  const grand = fusionner(b, beaucoup);
  assert.ok(Object.keys(grand.suites).length <= PLAFOND_DES_MOTIFS);
  assert.equal(Object.values(grand.suites).reduce((n, v) => n + v, 0), grand.total, 'rien ne se perd dans « autres »');
  assert.deepEqual(plafonner({ x: 1 }, 5), { x: 1 });
});
