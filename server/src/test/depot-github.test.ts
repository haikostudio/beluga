import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REFUS_AUTRE_HEBERGEUR,
  REFUS_LIEN_MAL_FORME,
  REFUS_LIEN_VIDE,
  adresseDeClone,
  dossierPourDepot,
  filtrerDepots,
  lireLienGithub,
  refusAvantMontage,
  refusDejaInscrit,
} from '@haikodev/shared';

/*
 * AJOUTER UN PROJET DEPUIS GITHUB.
 *
 * La fenêtre « Projets du serveur » n'avait que deux voies : un dossier déjà
 * préparé à la main, ou un projet neuf. Un dépôt qui existe déjà sur GitHub
 * n'entrait pas. Ce qui se juge SANS réseau se verrouille ici.
 */

test('un lien GitHub se lit sous toutes ses formes usuelles', () => {
  for (const lien of [
    'https://github.com/haikostudio/mon-site',
    'https://github.com/haikostudio/mon-site.git',
    'https://github.com/haikostudio/mon-site/tree/main/web',
    'http://www.github.com/haikostudio/mon-site',
    'github.com/haikostudio/mon-site',
    'git@github.com:haikostudio/mon-site.git',
    'haikostudio/mon-site',
    '  haikostudio/mon-site  ',
  ]) {
    const lu = lireLienGithub(lien);
    assert.equal(lu.ok, true, lien);
    assert.equal(lu.depot?.slug, 'haikostudio/mon-site', lien);
    assert.equal(lu.depot?.proprietaire, 'haikostudio');
    assert.equal(lu.depot?.depot, 'mon-site');
  }
});

test("l'adresse de clone passe par https : c'est la seule que le jeton du serveur ouvre", () => {
  const lu = lireLienGithub('git@github.com:haikostudio/mon-site.git');
  assert.equal(adresseDeClone(lu.depot!), 'https://github.com/haikostudio/mon-site.git');
});

test('un lien qui ne va pas se refuse en clair, jamais en silence', () => {
  assert.equal(lireLienGithub('').erreur, REFUS_LIEN_VIDE);
  assert.equal(lireLienGithub('   ').erreur, REFUS_LIEN_VIDE);
  assert.equal(lireLienGithub('https://gitlab.com/moi/projet').erreur, REFUS_AUTRE_HEBERGEUR);
  assert.equal(lireLienGithub('git@gitlab.com:moi/projet.git').erreur, REFUS_AUTRE_HEBERGEUR);
  assert.equal(lireLienGithub('https://github.com/haikostudio').erreur, REFUS_LIEN_MAL_FORME);
  assert.equal(lireLienGithub('bonjour').erreur, REFUS_LIEN_MAL_FORME);
  assert.equal(lireLienGithub('mon compte/projet').erreur, REFUS_LIEN_MAL_FORME);
  for (const lien of ['', 'https://gitlab.com/moi/projet', 'bonjour']) {
    assert.equal(lireLienGithub(lien).ok, false, lien);
    assert.equal(lireLienGithub(lien).depot, undefined, lien);
  }
});

test('un dépôt déjà inscrit est reconnu quelle que soit la forme de son adresse distante', () => {
  const depot = lireLienGithub('https://github.com/haikostudio/mon-site')!.depot!;
  const projets = [
    { name: 'Autre', gitRemote: 'https://github.com/haikostudio/autre.git' },
    { name: 'Mon site', gitRemote: 'git@github.com:HaikoStudio/Mon-Site.git' },
  ];
  assert.equal(refusAvantMontage(depot, projets), refusDejaInscrit('Mon site'));
  assert.equal(refusAvantMontage(depot, [{ name: 'Sans dépôt' }]), undefined);
});

test('le dossier du serveur se déduit du nom, sans accent ni signe exotique', () => {
  assert.equal(dossierPourDepot('Mon Été.js'), 'mon-ete-js');
  assert.equal(dossierPourDepot('---'), 'projet');
});

test('la recherche parmi les dépôts du compte porte sur le nom et la description', () => {
  const depots = [
    { slug: 'haiko/site-vitrine', nom: 'site-vitrine', proprietaire: 'haiko', description: 'Le site de la boutique', prive: true },
    { slug: 'haiko/api-compta', nom: 'api-compta', proprietaire: 'haiko', description: 'Facturation', prive: false },
  ];
  assert.deepEqual(filtrerDepots(depots, 'boutique').map((d) => d.nom), ['site-vitrine']);
  assert.deepEqual(filtrerDepots(depots, 'compta').map((d) => d.nom), ['api-compta']);
  assert.equal(filtrerDepots(depots, '').length, 2);
  assert.equal(filtrerDepots(depots, 'boutique compta').length, 0);
});

test("l'onglet « Depuis GitHub » existe dans la fenêtre des projets du serveur", () => {
  const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const source = fs.readFileSync(path.join(racine, 'web/src/components/sidebar.tsx'), 'utf8');
  assert.equal(source.includes('Depuis GitHub'), true);
  // L'adresse publique se demande AVANT le montage, ici comme pour un projet neuf.
  assert.equal(source.includes('data-adresse-depuis-github'), true);
  assert.equal(source.includes('project.fromGithub'), true);
  assert.equal(source.includes('github.depots'), true);
});
