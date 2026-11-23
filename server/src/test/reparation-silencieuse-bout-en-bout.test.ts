/**
 * LA RÉPARATION SILENCIEUSE, SUR UN VRAI DÉPÔT (décision du 2026-10-18).
 *
 * Un dépôt jetable, un faux agent imposé au déroulé : on vérifie ce que
 * l'utilisateur a demandé —
 *  - une tâche en conflit est réglée PENDANT le déploiement et part avec les autres ;
 *  - une étape qui tombe est réparée puis rejouée dans la MÊME publication,
 *    restée « en cours » pendant la réparation (aucune croix) ;
 *  - après trois essais ratés, l'étape tombe avec l'encadré rédigé par l'agent.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'reparation-silencieuse-'));
process.env.BELUGA_DATA = path.join(bacASable, 'data');
fs.mkdirSync(process.env.BELUGA_DATA, { recursive: true });

const store = await import('../store.js');
const deploy = await import('../deploy.js');
const { imposerLesOutilsDeReparation, rendreLaReparation } = await import('../reparation-publication.js');

/** Un dépôt de projet avec son distant, posé sur `dev`. */
function depot(nom: string, commande: string) {
  const distant = path.join(bacASable, `${nom}.git`);
  const dossier = path.join(bacASable, nom);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dossier, encoding: 'utf8' }).trim();
  execFileSync('git', ['init', '--bare', '-q', '-b', 'main', distant]);
  execFileSync('git', ['init', '-q', '-b', 'main', dossier]);
  git('config', 'user.email', 'essai@example.com');
  git('config', 'user.name', 'Essai');
  fs.writeFileSync(path.join(dossier, 'a.txt'), 'socle\n');
  git('add', '.');
  git('commit', '-qm', 'socle');
  git('remote', 'add', 'origin', distant);
  git('push', '-q', '-u', 'origin', 'main');
  git('checkout', '-qb', 'dev');
  git('push', '-q', '-u', 'origin', 'dev');
  const projet = store.saveProject({
    id: store.newId(),
    name: nom,
    path: dossier,
    defaultEngine: 'claude',
    isSelf: false,
    archived: false,
    deploiement: { commande, herite: true },
    createdAt: store.now(),
    updatedAt: store.now(),
  } as any);
  const brancheDeCarte = (branche: string, fichier: string, contenu: string) => {
    git('checkout', '-qb', branche, 'dev');
    fs.writeFileSync(path.join(dossier, fichier), contenu);
    git('add', fichier);
    git('commit', '-qm', `travail ${branche}`);
    git('checkout', '-q', 'dev');
  };
  const carte = (titre: string, branche: string) =>
    store.saveCard({
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
  return { projet, dossier, git, brancheDeCarte, carte };
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

/** Le faux agent : `agir` fait la réparation, puis on lit l'état de la publication pendant qu'elle attend. */
function fauxAgent(agir: (agentId: string, demande: string) => void) {
  const vu: { etat: string; etape?: string; demande: string }[] = [];
  imposerLesOutilsDeReparation({
    catalogue: async () => [{ id: 'claude', installed: true, comptesDisponibles: 1, models: [] }],
    actifs: () => [],
    sondeMs: 5,
    envoyer: async (agentId: string, demande: string) => {
      const lien = store.getAgent(agentId)!.reparationPublication!;
      const run = store.getDeploy(lien.runId)!;
      vu.push({ etat: run.state, etape: run.steps.find((s) => s.key === lien.etape)?.state, demande });
      agir(agentId, demande);
    },
  } as any);
  return vu;
}

test('une tâche en conflit est réglée pendant le déploiement et part avec les autres', async () => {
  const d = depot('conflit', 'true');
  d.brancheDeCarte('tache/une', 'a.txt', 'une\n');
  d.brancheDeCarte('tache/heurt', 'a.txt', 'heurt\n');
  const une = d.carte('Une', 'tache/une');
  const heurt = d.carte('Heurt', 'tache/heurt');
  const vu = fauxAgent((agentId) => {
    // L'agent garde les deux intentions, enregistre la fusion, rend son verdict.
    fs.writeFileSync(path.join(d.dossier, 'a.txt'), 'une\nheurt\n');
    d.git('add', 'a.txt');
    d.git('commit', '-q', '--no-edit');
    assert.equal(rendreLaReparation(agentId, { issue: 'reparee', explication: 'Deux versions du même texte, gardées ensemble.' }).ok, true);
  });

  const lance = await deploy.startDeploy(d.projet.id, { cible: 'dev' });
  assert.equal(lance.ok, true, lance.error);
  const run = await jusquaLaFin(lance.run!.id);

  assert.equal(run.state, 'success', run.error);
  assert.deepEqual(new Set(run.cardIds), new Set([une.id, heurt.id]), 'la tâche en conflit part avec les autres');
  assert.equal(run.taches?.find((t) => t.cardId === heurt.id)?.etat, 'en-ligne');
  assert.equal(vu.length, 1);
  assert.match(vu[0].demande, /a\.txt/);
  assert.equal(vu[0].etat, 'running', 'pendant la réparation, la publication reste en cours');
  assert.equal(vu[0].etape, 'running', 'et l’étape aussi : aucune croix');
  assert.ok(run.steps.every((s) => s.state !== 'failed'), 'aucune étape en échec');
  assert.equal(fs.readFileSync(path.join(d.dossier, 'a.txt'), 'utf8'), 'une\nheurt\n');
  assert.equal(store.getCard(heurt.id)?.column, 'archived');
});

test('une étape qui tombe est réparée puis rejouée dans la même publication', async () => {
  const d = depot('rejeu', 'test -f ../rejeu.repare');
  const vu = fauxAgent((agentId) => {
    fs.writeFileSync(path.join(bacASable, 'rejeu.repare'), 'ok');
    rendreLaReparation(agentId, { issue: 'reparee', explication: 'Le fichier attendu manquait.' });
  });
  const lance = await deploy.startDeploy(d.projet.id, { cible: 'dev' });
  const run = await jusquaLaFin(lance.run!.id);

  assert.equal(run.state, 'success', run.error);
  assert.equal(vu.length, 1);
  assert.equal(vu[0].etape, 'running');
  const build = run.steps.find((s) => s.key === 'build')!;
  assert.equal(build.state, 'done');
  assert.equal(build.reparation?.essais, 1);
  assert.equal(build.blocage, undefined);
  assert.ok(build.journal?.some((m) => m.genre === 'depannage' && m.agentId), 'le passage de l’agent se lit dans le fil technique');
  assert.equal(store.recentDeploys(d.projet.id, 10).length, 1, 'aucune nouvelle publication');
});

test('après trois essais ratés, l’étape tombe avec l’encadré rédigé par l’agent', async () => {
  const d = depot('abandon', 'false');
  const vu = fauxAgent((agentId, demande) => {
    if (/Ne répare plus rien/.test(demande)) {
      rendreLaReparation(agentId, {
        issue: 'abandon',
        explication: 'La commande de mise à jour échoue toujours.',
        marche_a_suivre: 'Vérifiez la commande réglée pour ce projet.',
      });
    } else {
      rendreLaReparation(agentId, { issue: 'reparee', explication: 'Essai.' });
    }
  });
  const lance = await deploy.startDeploy(d.projet.id, { cible: 'dev' });
  const run = await jusquaLaFin(lance.run!.id);

  assert.equal(run.state, 'failed');
  assert.equal(vu.length, 4, 'trois réparations, puis la rédaction de l’encadré');
  assert.ok(vu.slice(0, 3).every((v) => v.etape === 'running' && v.etat === 'running'), 'silence pendant les trois essais');
  assert.equal(new Set(vu.map((v) => v.demande.match(/Essai (\d) sur 3/)?.[1]).filter(Boolean)).size, 3);
  const build = run.steps.find((s) => s.key === 'build')!;
  assert.equal(build.state, 'failed');
  assert.equal(build.blocage?.explication, 'La commande de mise à jour échoue toujours.');
  assert.equal(build.blocage?.marcheASuivre, 'Vérifiez la commande réglée pour ce projet.');
  assert.ok(build.blocage?.agentId, 'l’encadré mène à la conversation de l’agent');
  assert.equal(run.error, 'La commande de mise à jour échoue toujours.');
  // Décision du 17/11/2026 : plus AUCUNE carte « Réparer le déploiement » — un dépanneur s'ouvre de lui-même.
  assert.equal(store.listCards(run.projectId).filter((c) => /Réparer/.test(c.title)).length, 0, 'aucune carte de réparation');
  await new Promise((fin) => setTimeout(fin, 300));
  const apres = store.getDeploy(run.id)!;
  assert.ok(apres.depannage?.agentId || apres.depannage?.refusAuto, 'un dépanneur automatique est ouvert, ou son refus est noté');
});

test('sans compte libre, l’encadré s’affiche tout de suite, sans agent', async () => {
  const d = depot('sans-compte', 'false');
  imposerLesOutilsDeReparation({ catalogue: async () => [], actifs: () => [], envoyer: async () => assert.fail('aucun tour ne part') } as any);
  const lance = await deploy.startDeploy(d.projet.id, { cible: 'dev' });
  const run = await jusquaLaFin(lance.run!.id);
  assert.equal(run.state, 'failed');
  const build = run.steps.find((s) => s.key === 'build')!;
  assert.match(build.blocage?.explication ?? '', /aucun compte/);
  assert.equal(store.listAgents(d.projet.id).filter((a) => a.reparationPublication).length, 0);
});
