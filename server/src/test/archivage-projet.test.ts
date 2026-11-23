import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/*
 * ARCHIVER PUIS DÉSARCHIVER UN PROJET JETABLE, POUR DE VRAI.
 *
 * Base, dossier du projet et dossier des archives sont dans un bac à sable
 * (`BELUGA_ARCHIVES_PROJETS`) : on prouve que le dossier ne part qu'après une
 * archive vérifiée, qu'il revient IDENTIQUE (fichiers, lien, lien dur,
 * historique git), que la copie externe est supprimée au retour, et qu'une
 * copie de carte hors du dossier fait refuser l'archivage.
 */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'archivage-projet-'));
process.env.BELUGA_DATA = path.join(bacASable, 'data');
process.env.BELUGA_ARCHIVES_PROJETS = path.join(bacASable, 'archives');
fs.mkdirSync(process.env.BELUGA_DATA, { recursive: true });

const { Project } = await import('@beluga/shared');
const store = await import('../store.js');
const { archiver, desarchiver, estimer, mouvementsDuProjet, transfertsConnus } = await import('../archivage-projet.js');
const { passageDArchivageAuto } = await import('../archivage-auto.js');

function git(dossier: string, ...args: string[]): string {
  return execFileSync('git', ['-C', dossier, ...args], { encoding: 'utf8' });
}

function monter(nom: string) {
  const dossier = path.join(bacASable, 'projets', nom);
  fs.mkdirSync(path.join(dossier, 'src', 'profond'), { recursive: true });
  execFileSync('git', ['init', '-q', dossier]);
  fs.writeFileSync(path.join(dossier, 'src', 'a.txt'), 'bonjour\n'.repeat(1000));
  fs.writeFileSync(path.join(dossier, 'src', 'profond', 'b.bin'), Buffer.alloc(50_000, 7));
  fs.symlinkSync('a.txt', path.join(dossier, 'src', 'lien'));
  fs.linkSync(path.join(dossier, 'src', 'a.txt'), path.join(dossier, 'src', 'dur.txt'));
  git(dossier, '-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.');
  git(dossier, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'premier');
  return store.saveProject(Project.parse({ id: `p-${nom}`, name: nom, path: dossier, createdAt: store.now(), updatedAt: store.now() }));
}

async function attendreLaFin(id: string): Promise<NonNullable<ReturnType<typeof transfertsConnus>[number]>> {
  for (let i = 0; i < 600; i++) {
    const t = transfertsConnus().find((x) => x.projectId === id);
    if (t?.fini) return t;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('transfert jamais fini');
}

test('archiver libère le dossier, désarchiver le rend identique et supprime la copie externe', async () => {
  const projet = monter('jetable');
  const avantLog = git(projet.path, 'log', '--format=%H %s');
  const avantFichiers = execFileSync('find', [projet.path, '-printf', '%P %y %s\n'], { encoding: 'utf8' }).split('\n').sort().join('\n');

  const estimation = await estimer(projet.id, 'archiver');
  assert.equal(estimation.refus, null);
  assert.ok((estimation.octets ?? 0) > 50_000);

  await archiver(projet.id);
  const fin = await attendreLaFin(projet.id);
  assert.equal(fin.erreur, undefined, fin.erreur);
  assert.deepEqual(fin.faites, ['controles', 'services', 'copie', 'verification', 'liberation']);
  assert.equal(fs.existsSync(projet.path), false, 'le dossier est parti du serveur');
  const archive = store.getProject(projet.id)!;
  assert.equal(archive.archived, true);
  assert.equal(archive.archive?.etat, 'archive');
  assert.ok(archive.archive?.chemin && fs.existsSync(archive.archive.chemin), 'l’archive est sur le disque externe');
  assert.ok(archive.archive.chemin.startsWith(process.env.BELUGA_ARCHIVES_PROJETS!));
  assert.equal(fs.readdirSync(process.env.BELUGA_ARCHIVES_PROJETS!).filter((n) => n.endsWith('.partiel')).length, 0);

  // Un second archivage est refusé, en clair.
  await assert.rejects(archiver(projet.id), /déjà archivé/);

  await desarchiver(projet.id);
  const retour = await attendreLaFin(projet.id);
  assert.equal(retour.erreur, undefined, retour.erreur);
  const revenu = store.getProject(projet.id)!;
  assert.equal(revenu.archived, false);
  assert.equal(revenu.archive, undefined);
  assert.equal(git(projet.path, 'log', '--format=%H %s'), avantLog, 'même historique');
  assert.equal(git(projet.path, 'status', '--porcelain'), '', 'rien de modifié');
  const apresFichiers = execFileSync('find', [projet.path, '-printf', '%P %y %s\n'], { encoding: 'utf8' }).split('\n').sort().join('\n');
  assert.equal(apresFichiers, avantFichiers, 'mêmes fichiers, mêmes tailles');
  assert.equal(fs.statSync(path.join(projet.path, 'src', 'dur.txt')).nlink, 2, 'le lien dur est gardé');
  assert.equal(fs.existsSync(archive.archive!.chemin!), false, 'la copie externe est supprimée');
  assert.equal(fs.readdirSync(path.dirname(projet.path)).some((n) => n.startsWith('.beluga-desarchivage-')), false);

  // L'HISTORIQUE : désarchivage réussi, refus du second archivage, archivage réussi — le plus récent d'abord.
  const historique = mouvementsDuProjet(projet.id);
  assert.deepEqual(
    historique.map((m) => `${m.sens}:${m.issue}:${m.origine}`),
    ['desarchiver:reussi:main', 'archiver:refus:main', 'archiver:reussi:main'],
  );
  assert.ok((historique[2].octets ?? 0) > 50_000, 'la place libérée est notée');
  assert.equal(historique[2].chemin, archive.archive!.chemin, 'le chemin de l’archive est noté');
});

test('la nuit archive un projet endormi, épargne un projet exempté, et note tout dans l’historique', async () => {
  const vieux = Date.now() - 60 * 24 * 60 * 60 * 1000;
  const endormi = store.saveProject({ ...monter('endormi'), createdAt: vieux });
  const exempte = store.saveProject({ ...monter('exempte'), createdAt: vieux, archivageAutoDesactive: true });
  // Les projets des autres essais sont neufs (créés à l'instant) : ils ne partent pas.
  const n = await passageDArchivageAuto();
  assert.equal(n, 1);
  assert.equal(store.getProject(endormi.id)!.archived, true);
  assert.equal(fs.existsSync(endormi.path), false);
  assert.deepEqual(mouvementsDuProjet(endormi.id).map((m) => `${m.sens}:${m.issue}:${m.origine}`), ['archiver:reussi:auto']);
  assert.equal(store.getProject(exempte.id)!.archived, false);
  assert.equal(mouvementsDuProjet(exempte.id).length, 0);
});

test('une copie de carte hors du dossier fait refuser l’archivage, sans rien toucher', async () => {
  const projet = monter('avec-copie');
  const copie = path.join(bacASable, 'copies', 'carte-x');
  git(projet.path, 'worktree', 'add', '-q', copie);
  const estimation = await estimer(projet.id, 'archiver');
  assert.match(estimation.refus ?? '', /copies de travail/);
  await assert.rejects(archiver(projet.id), /copies de travail/);
  assert.equal(fs.existsSync(projet.path), true);
  assert.equal(store.getProject(projet.id)!.archived, false);
});

test('un projet mis de côté sans dossier se désarchive en retirant seulement le badge', async () => {
  const projet = store.saveProject(
    Project.parse({ id: 'p-ancien', name: 'ancien', path: path.join(bacASable, 'disparu'), archived: true, createdAt: store.now(), updatedAt: store.now() }),
  );
  const estimation = await estimer(projet.id, 'desarchiver');
  assert.equal(estimation.refus, null);
  assert.equal(estimation.rienARamener, true);
  await desarchiver(projet.id);
  const fin = await attendreLaFin(projet.id);
  assert.match(fin.bilan ?? '', /Aucune archive/);
  assert.equal(store.getProject(projet.id)!.archived, false);
});

test.after(() => {
  try {
    execFileSync('sudo', ['-n', 'rm', '-rf', bacASable]);
  } catch {
    fs.rmSync(bacASable, { recursive: true, force: true });
  }
});
