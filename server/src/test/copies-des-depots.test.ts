import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Project, nomDeBranche } from '@beluga/shared';

const execFileAsync = promisify(execFile);

/*
 * UNE CARTE D'UN PROJET À PLUSIEURS DÉPÔTS ouvre sa copie dans CHAQUE annexe,
 * sur la même branche ; le travail fait dans un annexe est vu, enregistré et
 * rangé ; une reprise retrouve la copie, une copie abîmée se répare, et un
 * annexe qui n'est pas un dépôt fait échouer l'ouverture en se nommant.
 */

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

async function depotDEssai(dossier: string): Promise<void> {
  fs.mkdirSync(dossier, { recursive: true });
  await git(dossier, ['init', '-q', '-b', 'main']);
  await git(dossier, ['config', 'user.email', 'essai@example.com']);
  await git(dossier, ['config', 'user.name', 'essai']);
  fs.writeFileSync(path.join(dossier, 'README.md'), 'départ\n');
  await git(dossier, ['add', '.']);
  await git(dossier, ['commit', '-q', '-m', 'départ']);
}

test('une carte ouvre, retrouve, répare et range sa copie dans chaque dépôt annexe', async () => {
  const bac = fs.mkdtempSync(path.join(os.tmpdir(), 'depots-multiples-'));
  const avant = { copies: process.env.BELUGA_COPIES, force: process.env.BELUGA_COPIES_LOCALES };
  delete process.env.BELUGA_COPIES;
  delete process.env.BELUGA_COPIES_LOCALES;
  try {
    const app = path.join(bac, 'app');
    const admin = path.join(bac, 'admin');
    await depotDEssai(app);
    await depotDEssai(admin);
    const maintenant = Date.now();
    const projet = Project.parse({
      id: 'p-multi',
      name: 'Multi',
      path: app,
      createdAt: maintenant,
      updatedAt: maintenant,
      depots: [{ nom: 'admin', path: admin }],
    });
    const carte = { id: 'ffffff66', title: 'Deux côtés' } as any;
    const branche = nomDeBranche(carte.title, carte.id);

    const { ouvrirLesCopiesAnnexes, refermerLesCopiesAnnexes, travailDansLesAnnexes, avecLesBasesAnnexes } =
      await import('../copies-des-depots.js');

    const ouvertes = await ouvrirLesCopiesAnnexes(projet, carte);
    assert.equal(ouvertes.kind, 'pretes', JSON.stringify(ouvertes));
    if (ouvertes.kind !== 'pretes') return;
    const [copie] = ouvertes.copies;
    assert.equal(copie?.nom, 'admin');
    assert.ok(copie!.dossier.startsWith(`${admin}/.worktrees/`), copie!.dossier);
    assert.equal(await git(copie!.dossier, ['rev-parse', '--abbrev-ref', 'HEAD']), branche);
    assert.ok(copie!.base, 'la base de la branche neuve est notée');

    /* La base connue n'est jamais réécrite. */
    const github = avecLesBasesAnnexes({ checks: [], commits: [], fichiers: [], activity: [] } as any, ouvertes.copies);
    assert.equal(github?.depots?.[0]?.baseSha, copie!.base);
    const encore = avecLesBasesAnnexes(github, [{ ...copie!, base: 'autre' }]);
    assert.equal(encore?.depots?.[0]?.baseSha, copie!.base);

    /* Rien n'a changé dans l'annexe : pas de travail. */
    assert.equal(await travailDansLesAnnexes(projet, carte), false);

    /* L'agent modifie l'admin seule : c'est du travail, enregistré puis rangé. */
    fs.writeFileSync(path.join(copie!.dossier, 'admin.js'), 'écran\n');
    assert.equal(await travailDansLesAnnexes(projet, carte), true);
    const bilans = await refermerLesCopiesAnnexes(projet, carte);
    assert.equal(bilans.length, 1);
    assert.equal(bilans[0]?.retire, true);
    assert.equal(fs.existsSync(copie!.dossier), false);
    assert.match(await git(admin, ['show', '--stat', branche]), /admin\.js/);
    assert.equal(await travailDansLesAnnexes(projet, carte), true, 'la branche porte le travail après fermeture');

    /* Reprise : la copie revient sur la même branche, avec le travail. */
    const reprise = await ouvrirLesCopiesAnnexes(projet, carte);
    assert.equal(reprise.kind, 'pretes');
    if (reprise.kind !== 'pretes') return;
    assert.ok(fs.existsSync(path.join(reprise.copies[0]!.dossier, 'admin.js')));
    assert.equal(reprise.copies[0]!.base, undefined, 'une branche existante ne redonne pas de base');

    /* Copie abîmée : son lien vers le dépôt est cassé, l'ouverture la répare. */
    fs.writeFileSync(path.join(reprise.copies[0]!.dossier, '.git'), 'gitdir: /nulle/part\n');
    const reparee = await ouvrirLesCopiesAnnexes(projet, carte);
    assert.equal(reparee.kind, 'pretes', JSON.stringify(reparee));
    if (reparee.kind !== 'pretes') return;
    assert.equal(await git(reparee.copies[0]!.dossier, ['rev-parse', '--abbrev-ref', 'HEAD']), branche);
    assert.ok(fs.existsSync(path.join(reparee.copies[0]!.dossier, 'admin.js')));
    await refermerLesCopiesAnnexes(projet, carte);

    /* Un annexe qui n'est pas un dépôt : échec nommé. */
    const vide = path.join(bac, 'vide');
    fs.mkdirSync(vide);
    const casse = Project.parse({ ...projet, depots: [{ nom: 'site', path: vide }] });
    const refus = await ouvrirLesCopiesAnnexes(casse, carte);
    assert.equal(refus.kind, 'echec');
    assert.match(refus.kind === 'echec' ? refus.raison : '', /Dépôt « site »/);

    /* Un projet à dépôt simple ne passe par rien. */
    const simple = Project.parse({ ...projet, depots: [] });
    const rien = await ouvrirLesCopiesAnnexes(simple, carte);
    assert.deepEqual(rien, { kind: 'pretes', copies: [] });
  } finally {
    if (avant.copies !== undefined) process.env.BELUGA_COPIES = avant.copies;
    if (avant.force !== undefined) process.env.BELUGA_COPIES_LOCALES = avant.force;
    fs.rmSync(bac, { recursive: true, force: true });
  }
});
