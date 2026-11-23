import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/* LE CAS RÉEL DU 13 AU 19.09.2026 : le bloc « mémoire » du fil d'une   */
/* carte a disparu six jours sans que personne ne le voie. Le carnet    */
/* avait son enregistrement à lui (`memoire_carnet`) ; son seul         */
/* écrivain est parti avec l'ancien arbre de mémoire, la lecture est    */
/* restée, et un bloc VIDE ne s'affiche pas.                            */
/*                                                                     */
/* Le carnet lit désormais LE relevé vivant (`connaissance_lectures`) : */
/* ce test tient le chemin entier, de la lecture notée à la ligne que   */
/* `card.journal` rend à l'écran.                                       */
/* ------------------------------------------------------------------ */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'carnet-vivant-'));
process.env.BELUGA_DATA = bacASable;

const { nomDeLaLigne } = await import('@beluga/shared');
const store = await import('../store.js');
const { getDb } = await import('../db.js');
const { noterUneLecture, ligneDeLaLecture, oublierLesLectures } = await import('../connaissances.js');

/** L'agent n'a besoin que de son rôle : c'est lui qui tranche l'étape d'une lecture sans étape. */
function poserAgent(id: string, role: string): void {
  const colonnes = (getDb().prepare('PRAGMA table_info(agents)').all() as { name: string; notnull: number; dflt_value: unknown; type: string }[])
    .filter((c) => c.notnull && c.dflt_value === null && c.name !== 'id' && c.name !== 'role');
  const noms = ['id', 'role', ...colonnes.map((c) => c.name)];
  const valeurs = [id, role, ...colonnes.map((c) => (/INT|REAL/i.test(c.type) ? 0 : ''))];
  getDb().prepare(`INSERT INTO agents (${noms.join(', ')}) VALUES (${noms.map(() => '?').join(', ')})`).run(...valeurs);
}

test('une lecture notée devient une ligne du carnet de sa carte, avec son étape', () => {
  poserAgent('agent-cadrage', 'cadrage');
  poserAgent('agent-tache', 'task');
  noterUneLecture('DEC-078', 'agent-cadrage', 'carte-1', 'plan');
  noterUneLecture('fiche:global:06_lessons', 'agent-tache', 'carte-1', 'travail');
  noterUneLecture('MEM-0001', 'agent-tache', 'autre-carte', 'travail');

  const carnet = store.carnetDeLaCarte('carte-1');
  assert.deepEqual(carnet.map((l) => [l.cle, l.etape, l.portee]), [
    ['DEC-078', 'plan', 'projet'],
    ['fiche:global:06_lessons', 'travail', 'global'],
  ]);
  assert.equal(nomDeLaLigne(carnet[1]), 'Fiche 06_lessons');

  /* La ligne diffusée en direct est LA MÊME que celle relue à l'ouverture. */
  assert.deepEqual(ligneDeLaLecture('agent-cadrage', 'DEC-078'), carnet[0]);
  assert.equal(ligneDeLaLecture('agent-cadrage', 'MEM-9999'), null);
});

test('une lecture d’avant la colonne « etape » se range par le rôle de son agent', () => {
  getDb().prepare('INSERT INTO connaissance_lectures (agent_id, cle, card_id, en_contexte, at) VALUES (?, ?, ?, 1, ?)').run('agent-cadrage', 'MEM-0002', 'carte-2', Date.now());
  getDb().prepare('INSERT INTO connaissance_lectures (agent_id, cle, card_id, en_contexte, at) VALUES (?, ?, ?, 1, ?)').run('agent-tache', 'MEM-0003', 'carte-2', Date.now() + 1);
  assert.deepEqual(store.carnetDeLaCarte('carte-2').map((l) => l.etape), ['comprehension', 'travail']);
});

test('une session neuve garde la ligne, hors contexte ; « repartir de zéro » la masque', () => {
  noterUneLecture('MEM-0004', 'agent-tache', 'carte-3', 'travail');
  oublierLesLectures('agent-tache');
  assert.deepEqual(store.carnetDeLaCarte('carte-3').map((l) => l.enContexte), [false], 'le récit garde ce qui est sorti du contexte');

  store.setNouveauDepart('agent-tache', Date.now() + 1000);
  assert.deepEqual(store.carnetDeLaCarte('carte-3'), []);
  assert.equal(
    (getDb().prepare("SELECT count(*) AS n FROM connaissance_lectures WHERE card_id = 'carte-3'").get() as { n: number }).n,
    1,
    'le relevé n’est pas effacé : le lancement le lit encore (`lecturesDeLaCarte`)',
  );
});

test('la purge des clés de l’ancienne mémoire servie épargne « memoire.demandes »', () => {
  const db = getDb();
  const poser = (cle: string) => db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(cle, '[]');
  poser('memoire.vue.x');
  poser('memoire.sujets.x');
  poser('memoire.demandes.x');
  db.exec("DELETE FROM meta WHERE key LIKE 'memoire.vue.%' OR key LIKE 'memoire.sujets.%'");
  const restantes = (db.prepare("SELECT key FROM meta WHERE key LIKE 'memoire.%' ORDER BY key").all() as { key: string }[]).map((l) => l.key);
  assert.deepEqual(restantes, ['memoire.demandes.x']);
  assert.ok(
    db.prepare("SELECT 1 FROM migrations WHERE name = 'purge-des-cles-de-l-ancienne-memoire-servie'").get(),
    'la migration de purge est passée',
  );
});
