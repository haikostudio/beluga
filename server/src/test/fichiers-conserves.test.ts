import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * UN FICHIER CITÉ RESTE OUVRABLE : copie gardée, historique git, motif de
 * l'absence, purge à 3 mois. Disque de stockage factice, base jetable.
 */
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'conserves-'));
const stockage = fs.mkdtempSync(path.join(os.tmpdir(), 'conserves-stockage-'));
fs.writeFileSync(path.join(stockage, '.beluga-pieces-jointes'), '');
process.env.BELUGA_DATA = data;
process.env.BELUGA_PIECES_JOINTES = stockage;
process.env.BELUGA_PIECES_JOINTES_EN_ESSAI = '1';

const { openDb, getDb } = await import('../db.js');
openDb();
const { attendreLesCopies, conserverLesFichiersCites, conserverUnFichier, purgerLesCopiesAnciennes, racinesDesFichiersCites, resoudreFichierCite } = await import('../fichiers-conserves.js');

const projet = fs.mkdtempSync(path.join(os.tmpdir(), 'conserves-projet-'));
const ctx = { projectId: 'p1', projectPath: projet, workdir: projet, cardId: 'c1', agentId: 'a1' };
const JOUR = 24 * 3600_000;

function ecrire(nom: string, contenu: string, base = projet): string {
  const f = path.join(base, nom);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, contenu);
  return f;
}
const lignes = (where = '1') => getDb().prepare(`SELECT * FROM fichiers_conserves WHERE ${where}`).all() as any[];
const vieillir = (sql: string, ms: number) => getDb().prepare(`UPDATE fichiers_conserves SET at = ? WHERE ${sql}`).run(Date.now() - ms);

test('un fichier temporaire copié puis effacé s’ouvre encore, même carte d’abord', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'conserves-tmp-'));
  const f = ecrire('rapport.md', 'version de la carte', tmp);
  conserverUnFichier(ctx, f);
  await attendreLesCopies();
  fs.writeFileSync(f, 'version d’une autre carte');
  conserverUnFichier({ ...ctx, cardId: 'c2' }, f);
  await attendreLesCopies();
  fs.rmSync(f);

  const r = await resoudreFichierCite(ctx, f);
  assert.ok(r.trouve);
  assert.equal(r.origine, 'copie');
  assert.equal(fs.readFileSync(r.file, 'utf8'), 'version de la carte');
  const ailleurs = await resoudreFichierCite({ ...ctx, cardId: 'c2' }, f);
  assert.ok(ailleurs.trouve);
  assert.equal(fs.readFileSync(ailleurs.file, 'utf8'), 'version d’une autre carte');
  assert.ok(ailleurs.file.startsWith(path.join(stockage, 'fichiers-conserves')), 'sur le disque de stockage');
});

test('une copie de travail refermée : la copie sert par son chemin absolu comme par son relatif', async () => {
  const copie = path.join(projet, '.worktrees', 'carte', 'docs', 'note.md');
  ecrire('.worktrees/carte/docs/note.md', 'note');
  conserverLesFichiersCites(ctx, `Voir \`${copie}\`.`);
  await attendreLesCopies();
  fs.rmSync(path.join(projet, '.worktrees'), { recursive: true });
  for (const chemin of [copie, 'docs/note.md']) {
    const r = await resoudreFichierCite(ctx, chemin);
    assert.ok(r.trouve, chemin);
    assert.equal(r.nom, 'note.md');
  }
});

test('ni secret, ni média, ni fichier hors racines, ni trop gros ne se copient', async () => {
  const avant = lignes().length;
  const dehors = fs.mkdtempSync(path.join(os.homedir(), '.conserves-dehors-'));
  try {
    conserverUnFichier(ctx, ecrire('.env', 'CLE=1'));
    conserverUnFichier(ctx, ecrire('capture.png', 'png'));
    conserverUnFichier(ctx, ecrire('secret.txt', 'non', dehors));
    fs.symlinkSync(path.join(dehors, 'secret.txt'), path.join(projet, 'lien.txt'));
    conserverUnFichier(ctx, 'lien.txt');
    const gros = ecrire('gros.txt', '');
    fs.truncateSync(gros, 21 * 1024 * 1024);
    conserverUnFichier(ctx, gros);
    await attendreLesCopies();
    assert.equal(lignes().length, avant);
    const refuse = await resoudreFichierCite(ctx, 'lien.txt');
    assert.deepEqual(refuse, { trouve: false, motif: 'hors-dossiers' }, 'un lien qui sort reste refusé');
    assert.deepEqual(await resoudreFichierCite(ctx, '../x/y.md'), { trouve: false, motif: 'hors-dossiers' });
  } finally {
    fs.rmSync(dehors, { recursive: true, force: true });
    fs.rmSync(path.join(projet, 'lien.txt'), { force: true });
  }
});

test('un fichier supprimé du dépôt revient par l’historique, puis par sa copie', async () => {
  const git = (...a: string[]) => execFileSync('git', ['-C', projet, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { stdio: 'pipe' });
  git('init', '-q');
  ecrire('docs/en-attente.md', 'règle');
  git('add', 'docs/en-attente.md');
  git('commit', '-qm', 'a');
  git('rm', '-q', 'docs/en-attente.md');
  git('commit', '-qm', 'retire');

  const chemin = path.join(projet, '.worktrees', 'autre', 'docs', 'en-attente.md');
  const r = await resoudreFichierCite(ctx, chemin);
  assert.ok(r.trouve);
  assert.equal(r.origine, 'git', 'le commit de suppression est écarté');
  assert.equal(fs.readFileSync(r.file, 'utf8'), 'règle');
  const encore = await resoudreFichierCite(ctx, chemin);
  assert.ok(encore.trouve);
  assert.equal(encore.origine, 'copie', 'git n’est pas rappelé');
  const motif = await resoudreFichierCite(ctx, 'docs/$(touch /tmp/pwn)*.md');
  assert.deepEqual(motif, { trouve: false, motif: 'pas-encore-cree' }, 'un chemin n’est ni une commande ni un motif');
});

test('les racines couvrent le dossier temporaire et les copies du projet', () => {
  const racines = racinesDesFichiersCites(ctx);
  assert.ok(racines.includes(os.tmpdir()));
  assert.ok(racines.includes(`${path.resolve(projet)}/.worktrees`));
});

test('à 3 mois la copie s’efface et dit sa date ; un contenu encore visé reste', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'conserves-purge-'));
  const vieux = ecrire('vieux.md', 'contenu partagé', tmp);
  const recent = ecrire('recent.md', 'contenu partagé', tmp);
  const seul = ecrire('seul.md', 'contenu seul', tmp);
  for (const f of [vieux, recent, seul]) conserverUnFichier(ctx, f);
  await attendreLesCopies();
  for (const f of [vieux, recent, seul]) fs.rmSync(f);
  vieillir(`chemin_origine LIKE '%/vieux.md'`, 91 * JOUR);
  vieillir(`chemin_origine LIKE '%/seul.md'`, 91 * JOUR);
  const avant = fs.readdirSync(stockage).length;
  const bilan = purgerLesCopiesAnciennes();
  assert.equal(bilan.expirees, 2);
  assert.equal(bilan.effaces, 1, 'seul le contenu que plus rien ne vise part');
  assert.equal(fs.readdirSync(stockage).length, avant, 'rien d’autre sur le disque ne bouge');

  const expire = await resoudreFichierCite(ctx, seul);
  assert.equal(expire.trouve, false);
  assert.equal(!expire.trouve && expire.motif, 'expire');
  assert.ok(!expire.trouve && expire.date);
  const partage = await resoudreFichierCite(ctx, recent);
  assert.ok(partage.trouve, 'le contenu partagé reste lisible');
  assert.deepEqual(await resoudreFichierCite(ctx, '/tmp/jamais-vu-nulle-part.md'), { trouve: false, motif: 'pas-encore-cree' });

  // Réécrit après sa purge : le fichier revient.
  ecrire('seul.md', 'contenu seul', tmp);
  conserverUnFichier(ctx, seul);
  await attendreLesCopies();
  fs.rmSync(seul);
  assert.ok((await resoudreFichierCite(ctx, seul)).trouve);
});
