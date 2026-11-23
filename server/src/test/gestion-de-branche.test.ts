import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * LA BRANCHE D'UNE CARTE SE GÈRE À LA MAIN (bouton de branche du fil
 * d'Ariane). Les règles pures d'abord, puis les gestes du démon sur un dépôt
 * jetable : renommer, créer depuis un départ, reprendre, et la question
 * « laisser / emporter » quand la carte a déjà du travail.
 */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'gestion-branche-'));
process.env.BELUGA_DATA = path.join(bacASable, 'data');

const shared = await import('@beluga/shared');
const {
  Card,
  Project,
  brancheDeLaCarte,
  branchesInterdites,
  branchesProposees,
  etapeDeLaBranche,
  nomDeBranche,
  raisonDOccupation,
  validerNomDeBranche,
} = shared;
const store = await import('../store.js');
const { agirSurLaBranche, branchesDeLaCarte } = await import('../gestion-de-branche.js');
const { ouvrirDossierDeCarte } = await import('../dossier-de-carte.js');

/* ------------------------------------------------------------------ */
/* Les règles pures                                                    */
/* ------------------------------------------------------------------ */

test('la branche choisie fait foi, sinon celle que tire le titre', () => {
  assert.equal(brancheDeLaCarte({ id: 'abcdef123', title: 'Mon titre' }), nomDeBranche('Mon titre', 'abcdef123'));
  assert.equal(brancheDeLaCarte({ id: 'abcdef123', title: 'Mon titre', brancheChoisie: 'tache/autre' }), 'tache/autre');
  assert.equal(brancheDeLaCarte({ id: 'abcdef123', title: 'Mon titre', brancheChoisie: '  ' }), nomDeBranche('Mon titre', 'abcdef123'));
});

test('une carte déjà lancée garde sa branche réelle, même si le nom tiré du titre est plus court', () => {
  const longue = 'tache/un-titre-assez-long-pour-etre-coupe-par-la-regle-abcdef';
  const carte = { id: 'abcdef123', title: 'Un titre assez long pour être coupé par la règle', github: { branch: longue } };
  assert.equal(brancheDeLaCarte(carte), longue);
  // Une branche supprimée, archivée ou d'une autre carte ne compte plus : nom neuf.
  assert.equal(brancheDeLaCarte({ ...carte, github: { branch: longue, brancheSupprimee: true } }), nomDeBranche(carte.title, carte.id));
  assert.equal(brancheDeLaCarte({ ...carte, github: { branch: `archive/${longue}` } }), nomDeBranche(carte.title, carte.id));
  assert.equal(brancheDeLaCarte({ ...carte, github: { branch: 'tache/autre-carte-zzzzzz' } }), nomDeBranche(carte.title, carte.id));
  // La branche choisie à la main passe toujours devant.
  assert.equal(brancheDeLaCarte({ ...carte, brancheChoisie: 'tache/choisie' }), 'tache/choisie');
});

test('un nom saisi garde le préfixe « tache/ », et ce que git refuse est refusé', () => {
  assert.deepEqual(validerNomDeBranche('ma branche'), { ok: true, nom: 'tache/ma-branche' });
  assert.equal(validerNomDeBranche('tache/deja').nom, 'tache/deja');
  for (const mauvais of ['', 'a..b', 'x~1', 'fin.lock', 'a//b', '.cache', 'x/-y', 'a:b']) {
    assert.equal(validerNomDeBranche(mauvais).ok, false, mauvais);
  }
  assert.equal(validerNomDeBranche('dev', branchesInterdites(['dev'])).ok, true, '« tache/dev » n’est pas « dev »');
});

test('dev, main, les branches réglées et les archives ne se proposent jamais', () => {
  const interdites = branchesInterdites(['livraison']);
  const liste = branchesProposees({
    locales: ['main', 'dev', 'livraison', 'archive/tache/x', 'tache/a', 'tache/courante'],
    distantes: ['HEAD', 'main', 'tache/a', 'tache/b'],
    courante: 'tache/courante',
    interdites,
    cartesParBranche: new Map([['tache/b', [{ id: '1', titre: 'Voisine', active: true }]]]),
  });
  assert.deepEqual(liste.map((b) => b.nom), ['tache/a', 'tache/b']);
  assert.equal(liste[0].distante, false, 'locale et distante se réunissent sous un nom');
  assert.equal(liste[1].distante, true);
  assert.match(liste[1].occupee ?? '', /Voisine/);
  assert.equal(raisonDOccupation([{ id: '1', titre: 'x', active: false }]), undefined, 'une carte au repos ne bloque pas');
});

test('le parcours suit la colonne et la fusion', () => {
  assert.equal(etapeDeLaBranche({ column: 'running' }), 'branche');
  assert.equal(etapeDeLaBranche({ column: 'to_deploy' }), 'a-deployer');
  assert.equal(etapeDeLaBranche({ column: 'archived', deployedAt: 1 }), 'deployee');
  assert.equal(etapeDeLaBranche({ column: 'to_deploy', github: { fusionnee: true } }), 'deployee');
});

/* ------------------------------------------------------------------ */
/* Les gestes, sur un dépôt jetable                                    */
/* ------------------------------------------------------------------ */

const depot = path.join(bacASable, 'depot');
fs.mkdirSync(depot, { recursive: true });
const g = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
g(depot, 'init', '-q', '-b', 'main');
g(depot, 'config', 'user.email', 'essai@example.com');
g(depot, 'config', 'user.name', 'Essai');
fs.writeFileSync(path.join(depot, 'a.txt'), 'a\n');
g(depot, 'add', 'a.txt');
g(depot, 'commit', '-qm', 'départ');
g(depot, 'branch', 'dev');
g(depot, 'branch', 'tache/autre-xyz');

const projet = store.saveProject(
  Project.parse({ id: 'projet-branches', name: 'Branches', path: depot, createdAt: store.now(), updatedAt: store.now() }),
);
const carte = (id: string, titre: string) =>
  store.saveCard(
    Card.parse({
      id,
      projectId: projet.id,
      column: 'planned',
      position: 1,
      title: titre,
      run: { engine: 'claude' },
      createdAt: store.now(),
      updatedAt: store.now(),
    }),
  );

test('une carte jamais lancée : la liste, puis une branche neuve depuis un départ choisi', async () => {
  const c = carte('carte-neuve-1', 'Carte neuve');
  const vue = await branchesDeLaCarte(c.id);
  assert.equal(vue.existe, false);
  assert.equal(vue.deploiement, 'dev');
  assert.ok(vue.departs.includes('dev') && vue.departs.includes('main'));
  assert.deepEqual(vue.branches.map((b) => b.nom), ['tache/autre-xyz']);

  const r = await agirSurLaBranche({ cardId: c.id, geste: 'creer', nom: 'essai neuf', depart: 'main' });
  assert.equal(r.ok, true, r.message);
  const apres = store.getCard(c.id)!;
  assert.equal(apres.brancheChoisie, 'tache/essai-neuf');
  assert.equal(apres.brancheDeDepart, 'main');

  // Le lancement ouvre la copie SUR la branche choisie, partie du départ choisi.
  const ouvert = await ouvrirDossierDeCarte(depot, apres);
  assert.equal(ouvert.kind, 'pret');
  if (ouvert.kind === 'pret') {
    assert.equal(ouvert.branche, 'tache/essai-neuf');
    assert.equal(g(ouvert.dossier, 'rev-parse', '--abbrev-ref', 'HEAD'), 'tache/essai-neuf');
  }
});

test('renommer suit la branche dans le dépôt et sur la carte', async () => {
  const c = store.getCard('carte-neuve-1')!;
  const r = await agirSurLaBranche({ cardId: c.id, geste: 'renommer', nom: 'tache/essai-renomme' });
  assert.equal(r.ok, true, r.message);
  assert.equal(store.getCard(c.id)!.brancheChoisie, 'tache/essai-renomme');
  assert.ok(g(depot, 'branch', '--list', 'tache/essai-renomme'));
  assert.equal(g(depot, 'branch', '--list', 'tache/essai-neuf'), '');
  const refus = await agirSurLaBranche({ cardId: c.id, geste: 'renommer', nom: 'tache/autre-xyz' });
  assert.equal(refus.ok, false, 'un nom déjà pris est refusé');
});

test('une carte qui a du travail : la question, puis « laisser » le garde sur l’ancienne branche', async () => {
  const c = store.getCard('carte-neuve-1')!;
  const dossier = (await ouvrirDossierDeCarte(depot, c)) as { kind: 'pret'; dossier: string };
  fs.writeFileSync(path.join(dossier.dossier, 'travail.txt'), 'travail\n');

  const question = await agirSurLaBranche({ cardId: c.id, geste: 'reprendre', nom: 'tache/autre-xyz' });
  assert.equal(question.question, 'travail');

  const r = await agirSurLaBranche({ cardId: c.id, geste: 'reprendre', nom: 'tache/autre-xyz', travail: 'laisser' });
  assert.equal(r.ok, true, r.message);
  assert.equal(store.getCard(c.id)!.brancheChoisie, 'tache/autre-xyz');
  assert.match(g(depot, 'log', '--format=%s', '-1', 'tache/essai-renomme'), /Travaux en cours/, 'enregistré d’office');
  assert.equal(fs.existsSync(dossier.dossier), false, 'la copie est refermée');
});

test('« emporter » rejoue le travail propre à la carte sur la nouvelle branche', async () => {
  const c = carte('carte-emporte-2', 'Carte qui emporte');
  const ouvert = (await ouvrirDossierDeCarte(depot, c)) as { kind: 'pret'; dossier: string; base?: string };
  store.saveCard({ ...c, github: { checks: [], commits: [], fichiers: [], activity: [], branch: brancheDeLaCarte(c), baseSha: ouvert.base } as any });
  fs.writeFileSync(path.join(ouvert.dossier, 'emporte.txt'), 'emporté\n');
  g(ouvert.dossier, 'add', 'emporte.txt');
  g(ouvert.dossier, 'commit', '-qm', 'travail à emporter');

  const r = await agirSurLaBranche({ cardId: c.id, geste: 'creer', nom: 'destination', depart: 'main', travail: 'emporter' });
  assert.equal(r.ok, true, r.message);
  assert.equal(g(depot, 'log', '--format=%s', '-1', 'tache/destination'), 'travail à emporter');
  const apres = store.getCard(c.id)!;
  assert.equal(apres.github?.branch, 'tache/destination');
  assert.equal(apres.github?.baseSha, g(depot, 'rev-parse', 'main'));
});

test('dev et main ne se reprennent jamais', async () => {
  const c = carte('carte-interdite-3', 'Interdite');
  for (const nom of ['dev', 'main', 'origin/main']) {
    const r = await agirSurLaBranche({ cardId: c.id, geste: 'reprendre', nom });
    assert.equal(r.ok, false, nom);
  }
});
