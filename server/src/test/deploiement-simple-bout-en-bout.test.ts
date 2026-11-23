/**
 * LE DÉPLOIEMENT SIMPLE, SUR UN VRAI DÉPÔT (refonte du 22/09/2026).
 *
 * Un dépôt jetable, un dépôt distant nu, une base jetable : on déroule le
 * déploiement et la mise en production pour de vrai, et l'on vérifie ce que
 * l'utilisateur a demandé — court, prévisible, sans agent, une panne dite net :
 *  - deux cartes fusionnées, une carte en conflit ÉCARTÉE et nommée ;
 *  - la commande de mise à jour jouée, puis sautée quand rien n'a changé ;
 *  - une commande qui dépasse sa durée coupée, la publication en échec ;
 *  - un arrêt demandé coupe la commande en cours ;
 *  - la mise en production fusionne dev → main et joue le processus.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { RAISON_SANS_PROCEDURE_DE_DEPLOIEMENT } from '@beluga/shared';

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'deploiement-simple-'));
process.env.BELUGA_DATA = path.join(bacASable, 'data');
fs.mkdirSync(process.env.BELUGA_DATA, { recursive: true });

const store = await import('../store.js');
const deploy = await import('../deploy.js');

const distant = path.join(bacASable, 'distant.git');
const dossier = path.join(bacASable, 'projet');
const git = (...args: string[]) => execFileSync('git', args, { cwd: dossier, encoding: 'utf8' }).trim();

execFileSync('git', ['init', '--bare', '-q', '-b', 'main', distant]);
execFileSync('git', ['init', '-q', '-b', 'main', dossier]);
git('config', 'user.email', 'essai@example.com');
git('config', 'user.name', 'Essai');
fs.writeFileSync(path.join(dossier, 'a.txt'), 'socle\n');
fs.writeFileSync(path.join(dossier, 'b.txt'), 'socle\n');
git('add', '.');
git('commit', '-qm', 'socle');
git('remote', 'add', 'origin', distant);
git('push', '-q', '-u', 'origin', 'main');
git('checkout', '-qb', 'dev');
git('push', '-q', '-u', 'origin', 'dev');

/** Une branche de carte qui écrit `contenu` dans `fichier`, partie de dev. */
function brancheDeCarte(nom: string, fichier: string, contenu: string) {
  git('checkout', '-qb', nom, 'dev');
  fs.writeFileSync(path.join(dossier, fichier), contenu);
  git('add', '-A');
  git('commit', '-qm', `travail ${nom}`);
  git('checkout', '-q', 'dev');
}

const projet = store.saveProject({
  id: store.newId(),
  name: 'Projet d’essai',
  path: dossier,
  defaultEngine: 'claude',
  isSelf: false,
  archived: false,
  /* Le déroulé commun ne sert plus qu'aux projets qui déployaient déjà
     (`herite`, migration 117) : les autres doivent être initialisés. */
  deploiement: { commande: 'echo construit >> ../construit.log', herite: true },
  createdAt: store.now(),
  updatedAt: store.now(),
} as any);

function carte(titre: string, branche: string) {
  return store.saveCard({
    id: store.newId(),
    projectId: projet.id,
    title: titre,
    column: 'to_deploy',
    position: store.nextPosition(projet.id, 'to_deploy'),
    origin: 'user',
    run: { engine: 'claude' },
    github: { branch: branche, checks: [], activity: [], commits: [] },
    createdAt: store.now(),
    updatedAt: store.now(),
  } as any);
}

async function jusquaLaFin(runId: string, plafondMs = 30_000) {
  const debut = Date.now();
  for (;;) {
    const run = store.getDeploy(runId)!;
    if (run.state !== 'running') return run;
    if (Date.now() - debut > plafondMs) throw new Error(`publication toujours en cours après ${plafondMs} ms`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

test('un projet jamais initialisé ne déploie pas, même avec un service relevé au montage', async () => {
  const neuf = store.saveProject({
    ...projet,
    id: store.newId(),
    name: 'Projet neuf',
    deploiement: { service: 'autoproject-neuf' },
  } as any);
  const lance = await deploy.startDeploy(neuf.id, { cible: 'dev' });
  assert.equal(lance.ok, false);
  assert.equal(lance.error, RAISON_SANS_PROCEDURE_DE_DEPLOIEMENT);
  assert.equal(lance.run, undefined);
  assert.equal(store.latestDeploy(neuf.id) ?? null, null, 'aucune publication n’est créée');
  assert.equal(deploy.blocageMiseEnProduction(neuf.id, 'dev'), RAISON_SANS_PROCEDURE_DE_DEPLOIEMENT);
  assert.equal(deploy.blocageMiseEnProduction(projet.id, 'dev'), null, 'un projet hérité n’est pas bloqué');
});

test('deux cartes fusionnées, une en conflit écartée et nommée, en quelques secondes', async () => {
  brancheDeCarte('tache/une', 'a.txt', 'une\n');
  brancheDeCarte('tache/deux', 'c.txt', 'deux\n');
  brancheDeCarte('tache/heurt', 'a.txt', 'heurt\n');
  const une = carte('Une', 'tache/une');
  const deux = carte('Deux', 'tache/deux');
  const heurt = carte('Heurt', 'tache/heurt');

  const depart = Date.now();
  const lance = await deploy.startDeploy(projet.id, { cible: 'dev' });
  assert.equal(lance.ok, true, lance.error);
  const run = await jusquaLaFin(lance.run!.id);
  const duree = Date.now() - depart;

  assert.equal(run.state, 'success', run.error);
  assert.ok(duree < 15_000, `un déploiement local doit tenir en secondes (${duree} ms)`);
  assert.deepEqual(new Set(run.cardIds), new Set([une.id, deux.id]), 'la carte en conflit sort du lot');
  const ecartee = run.taches?.find((t) => t.cardId === heurt.id);
  assert.equal(ecartee?.etat, 'ecartee');
  assert.match(ecartee?.detail ?? '', /a\.txt/, 'le fichier en conflit est nommé');
  assert.equal(store.getCard(une.id)?.column, 'archived', JSON.stringify({ av: run.avertissement, err: run.error, steps: run.steps.map((s) => [s.key, s.state, s.log.slice(0, 300)]) }));
  assert.equal(store.getCard(heurt.id)?.column, 'to_deploy', 'la carte écartée reste à déployer');
  assert.equal(fs.readFileSync(path.join(bacASable, 'construit.log'), 'utf8').trim(), 'construit');
  assert.equal(run.steps.find((s) => s.key === 'build')?.state, 'done');
  // L'envoi a bien eu lieu : le distant porte le travail.
  const distantDev = execFileSync('git', ['--git-dir', distant, 'rev-parse', 'dev'], { encoding: 'utf8' }).trim();
  assert.equal(distantDev, run.targetCommit);
  assert.equal(git('status', '--porcelain', '--untracked-files=no'), '', 'aucun fichier suivi ne traîne après la fusion');
});

test('rien n’a changé depuis la dernière mise en ligne : la mise à jour n’est pas rejouée', async () => {
  const lance = await deploy.startDeploy(projet.id, { cible: 'dev', selectedCardIds: [] });
  const run = await jusquaLaFin(lance.run!.id);
  assert.equal(run.state, 'success', run.error);
  assert.equal(run.steps.find((s) => s.key === 'build')?.state, 'skipped');
  assert.match(run.steps.find((s) => s.key === 'build')?.log ?? '', /rien n’a changé/);
});

test('deux cartes sur une MÊME branche : une seule fusion, et elles partent ensemble', async () => {
  brancheDeCarte('tache/partagee', 'p.txt', 'partagée\n');
  const premiere = carte('Première', 'tache/partagee');
  const seconde = carte('Seconde', 'tache/partagee');
  const lance = await deploy.startDeploy(projet.id, { cible: 'dev', selectedCardIds: [premiere.id, seconde.id] });
  assert.equal(lance.ok, true, lance.error);
  const run = await jusquaLaFin(lance.run!.id);
  assert.equal(run.state, 'success', run.error);
  const merge = run.steps.find((s) => s.key === 'merge')?.log ?? '';
  assert.equal((merge.match(/tache\/partagee : fusionnée/g) ?? []).length, 1, merge);
  // Les deux cartes ont le même instant de création : l'ordre du lot n'est pas fixé.
  assert.match(merge, /déjà fusionnée avec « (Première|Seconde) »/);
  assert.equal(store.getCard(premiere.id)?.column, 'archived');
  assert.equal(store.getCard(seconde.id)?.column, 'archived');
});

test('une commande qui dépasse sa durée maximale est coupée, et la publication le dit', async () => {
  const run = await (async () => {
    const lance = await deploy.startDeploy(projet.id, { cible: 'production' });
    return lance;
  })();
  assert.equal(run.ok, false, 'sans processus, la mise en production est refusée');
  assert.match(run.error ?? '', /Initialiser la mise en production/);

  store.saveProject({
    ...store.getProject(projet.id)!,
    miseEnProduction: {
      processus: { etapes: [{ libelle: 'Trop long', commande: 'sleep 30', delaiS: 1 }] },
    },
  });
  /* L'INTERRUPTEUR DE MISE EN PRODUCTION est éteint par défaut : le processus
     existe, mais rien ne part, et aucune publication n'est ouverte. Les
     déploiements vers dev des tests précédents, eux, sont passés éteint. */
  assert.equal(store.getProject(projet.id)!.miseEnProductionActive, false, 'éteint par défaut');
  const avant = store.recentDeploys(projet.id, 50).length;
  const refusee = await deploy.startDeploy(projet.id, { cible: 'production' });
  assert.equal(refusee.ok, false, 'interrupteur éteint : la mise en production est refusée');
  assert.match(refusee.error ?? '', /mise en production est désactivée pour ce projet/);
  assert.equal(store.recentDeploys(projet.id, 50).length, avant, 'aucune publication ouverte');
  store.saveProject({ ...store.getProject(projet.id)!, miseEnProductionActive: true });

  const depart = Date.now();
  const lance = await deploy.startDeploy(projet.id, { cible: 'production' });
  assert.equal(lance.ok, true, lance.error);
  const fini = await jusquaLaFin(lance.run!.id);
  assert.equal(fini.state, 'failed');
  assert.match(fini.error ?? '', /n’a pas rendu la main en 1 s/);
  assert.ok(Date.now() - depart < 15_000, 'la coupure tombe à l’heure, pas trente minutes plus tard');
});

test('la mise en production fusionne dev dans main, envoie, puis joue le processus', async () => {
  store.saveProject({
    ...store.getProject(projet.id)!,
    miseEnProduction: {
      processus: {
        etapes: [
          { libelle: 'Marquer', commande: 'echo prod > prod.txt', delaiS: 10 },
          { libelle: 'Contrôler', commande: 'test -f prod.txt', delaiS: 10 },
        ],
      },
    },
  });
  const lance = await deploy.startDeploy(projet.id, { cible: 'production' });
  const run = await jusquaLaFin(lance.run!.id);
  assert.equal(run.state, 'success', run.error);
  const distantMain = execFileSync('git', ['--git-dir', distant, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
  const distantDev = execFileSync('git', ['--git-dir', distant, 'rev-parse', 'dev'], { encoding: 'utf8' }).trim();
  assert.equal(distantMain, distantDev, 'main a rejoint dev en avance rapide');
  assert.match(run.steps.find((s) => s.key === 'publish')?.log ?? '', /2\/2 · Contrôler/);
  fs.rmSync(path.join(dossier, 'prod.txt'), { force: true });
});

test('un arrêt demandé coupe la commande en cours', async () => {
  store.saveProject({
    ...store.getProject(projet.id)!,
    miseEnProduction: { processus: { etapes: [{ libelle: 'Long', commande: 'sleep 20', delaiS: 60 }] } },
  });
  const lance = await deploy.startDeploy(projet.id, { cible: 'production' });
  // On attend que la commande soit partie.
  for (let i = 0; i < 100 && store.getDeploy(lance.run!.id)?.steps.find((s) => s.key === 'publish')?.state !== 'running'; i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const depart = Date.now();
  assert.equal(deploy.stopDeploy(lance.run!.id), true);
  const run = await jusquaLaFin(lance.run!.id);
  assert.equal(run.state, 'stopped');
  assert.ok(Date.now() - depart < 10_000, 'l’arrêt agit tout de suite');
});

test.after(() => {
  fs.rmSync(bacASable, { recursive: true, force: true });
});
