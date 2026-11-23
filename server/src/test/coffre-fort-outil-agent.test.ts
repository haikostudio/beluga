import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * L'OUTIL « coffre_fort » — ce que les AGENTS peuvent lire et écrire, par
 * l'outil du protocole (pas le tiroir humain, qui lui voit tout).
 *
 * Verrouillé ici : LE COFFRE EST CENTRAL POUR TOUT LE MONDE — un agent voit
 * et relit TOUTES les fiches, celles de son projet, celles partagées de Beluga
 * Build (`projectId: null`) ET celles des AUTRES projets, chaque ligne disant
 * d'où elle vient ; une fiche NEUVE se rattache à son projet ; une fiche
 * CORRIGÉE reste rangée où elle était (corriger ne déménage pas) ; corriger par
 * « id » retrouve la même fiche plutôt que d'en créer une seconde.
 */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'coffre-fort-outil-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const { callTool } = await import('../tools.js');

function projet(nom: string) {
  return store.saveProject({
    id: store.newId(),
    name: nom,
    path: bacASable,
    defaultEngine: 'claude',
    isSelf: false,
    archived: false,
    createdAt: store.now(),
    updatedAt: store.now(),
  } as any);
}

test('un agent range une clé nouvelle, toujours rattachée à SON projet', async () => {
  const p = projet('Boutique');
  const resultat = await callTool({ projectId: p.id, role: 'task' } as any, 'coffre_fort', {
    action: 'enregistrer',
    nom: 'Clé Stripe',
    type: 'cle-api',
    champs: { service: 'Stripe', cle: 'sk_test_123' },
  });
  assert.equal(resultat.ok, true, resultat.text);
  assert.match(resultat.text, /Clé Stripe/);

  const lu = await callTool({ projectId: p.id, role: 'task' } as any, 'coffre_fort', {
    action: 'lister',
    recherche: 'stripe',
  });
  assert.equal(lu.ok, true);
  assert.match(lu.text, /Clé Stripe/);
  assert.match(lu.text, /sk_test_123/);
});

test('un agent relit les accès d’un AUTRE projet, valeur comprise, et voit d’où ils viennent', async () => {
  const a = projet('Projet A');
  const b = projet('Projet B');

  await callTool({ projectId: a.id, role: 'task' } as any, 'coffre_fort', {
    action: 'enregistrer',
    nom: 'Secret de A',
    type: 'mot-de-passe',
    champs: { identifiant: 'a', motDePasse: 'motdepasse-a' },
  });

  const depuisB = await callTool({ projectId: b.id, role: 'task' } as any, 'coffre_fort', { action: 'lister' });
  assert.equal(depuisB.ok, true);
  assert.match(depuisB.text, /Secret de A/);
  assert.match(depuisB.text, /motdepasse-a/);
  assert.match(depuisB.text, /projet Projet A/);

  const depuisA = await callTool({ projectId: a.id, role: 'task' } as any, 'coffre_fort', { action: 'lister' });
  assert.match(depuisA.text, /Secret de A/);
});

test('la recherche depuis un projet retrouve une fiche rangée sous un AUTRE projet', async () => {
  const vps = projet('VPS');
  const site = projet('Site vitrine');

  await callTool({ projectId: vps.id, role: 'task' } as any, 'coffre_fort', {
    action: 'enregistrer',
    nom: 'Infomaniak',
    type: 'ssh',
    champs: { hote: 'infomaniak.example', utilisateur: 'root', motDePasse: 'secret-infomaniak' },
  });

  const trouve = await callTool({ projectId: site.id, role: 'task' } as any, 'coffre_fort', {
    action: 'lister',
    recherche: 'infomaniak',
  });
  assert.equal(trouve.ok, true, trouve.text);
  assert.match(trouve.text, /secret-infomaniak/);

  // …et la recherche par NOM DE PROJET marche aussi, depuis n'importe où.
  const parProjet = await callTool({ projectId: site.id, role: 'task' } as any, 'coffre_fort', {
    action: 'lister',
    recherche: 'vps',
  });
  assert.match(parProjet.text, /Infomaniak/);
});

test('corriger par id retrouve la même fiche, sans en créer une seconde', async () => {
  const p = projet('Projet C');
  const cree = await callTool({ projectId: p.id, role: 'task' } as any, 'coffre_fort', {
    action: 'enregistrer',
    nom: 'Jeton GitHub',
    type: 'jeton',
    champs: { service: 'GitHub', jeton: 'ghp_ancien' },
  });
  const id = /\[([a-f0-9-]+)\]/i.exec(
    (await callTool({ projectId: p.id, role: 'task' } as any, 'coffre_fort', { action: 'lister', recherche: 'github' }))
      .text,
  )?.[1];
  assert.ok(id, `identifiant introuvable dans : ${cree.text}`);

  const corrige = await callTool({ projectId: p.id, role: 'task' } as any, 'coffre_fort', {
    action: 'enregistrer',
    id,
    nom: 'Jeton GitHub',
    type: 'jeton',
    champs: { service: 'GitHub', jeton: 'ghp_nouveau' },
  });
  assert.equal(corrige.ok, true);

  const liste = await callTool({ projectId: p.id, role: 'task' } as any, 'coffre_fort', { action: 'lister', recherche: 'github' });
  const occurrences = liste.text.split('Jeton GitHub').length - 1;
  assert.equal(occurrences, 1, `une seule fiche attendue :\n${liste.text}`);
  assert.match(liste.text, /ghp_nouveau/);
  assert.equal(liste.text.includes('ghp_ancien'), false);
});

test('corriger une fiche d’un AUTRE projet la corrige SANS la déménager', async () => {
  const a = projet('Projet D');
  const b = projet('Projet E');
  await callTool({ projectId: a.id, role: 'task' } as any, 'coffre_fort', {
    action: 'enregistrer',
    nom: 'Base de D',
    type: 'base-de-donnees',
    champs: { hote: 'localhost', base: 'd', motDePasse: 'x' },
  });
  const id = /\[([a-f0-9-]+)\]/i.exec(
    (await callTool({ projectId: a.id, role: 'task' } as any, 'coffre_fort', { action: 'lister', recherche: 'de d' })).text,
  )?.[1];
  assert.ok(id);

  const corrige = await callTool({ projectId: b.id, role: 'task' } as any, 'coffre_fort', {
    action: 'enregistrer',
    id,
    nom: 'Base de D',
    type: 'base-de-donnees',
    champs: { hote: 'ailleurs', base: 'd', motDePasse: 'y' },
  });
  assert.equal(corrige.ok, true, corrige.text);
  assert.match(corrige.text, /Projet D/);

  const depuisA = await callTool({ projectId: a.id, role: 'task' } as any, 'coffre_fort', { action: 'lister', recherche: 'de d' });
  assert.match(depuisA.text, /ailleurs/);
  assert.match(depuisA.text, /projet Projet D/);
  assert.equal(depuisA.text.split('Base de D').length - 1, 1, `une seule fiche attendue :\n${depuisA.text}`);
});

test('une action inconnue est refusée en clair', async () => {
  const p = projet('Projet F');
  const resultat = await callTool({ projectId: p.id, role: 'task' } as any, 'coffre_fort', { action: 'effacer' });
  assert.equal(resultat.ok, false);
});

test('un agent supprime une fiche périmée de SON projet', async () => {
  const p = projet('Projet G');
  await callTool({ projectId: p.id, role: 'task' } as any, 'coffre_fort', {
    action: 'enregistrer',
    nom: 'Clé périmée',
    type: 'jeton',
    champs: { service: 'X', jeton: 'ancien' },
  });
  const id = /\[([a-f0-9-]+)\]/i.exec(
    (await callTool({ projectId: p.id, role: 'task' } as any, 'coffre_fort', { action: 'lister', recherche: 'perimee' }))
      .text,
  )?.[1];
  assert.ok(id);

  const supprime = await callTool({ projectId: p.id, role: 'task' } as any, 'coffre_fort', { action: 'supprimer', id });
  assert.equal(supprime.ok, true, supprime.text);

  const liste = await callTool({ projectId: p.id, role: 'task' } as any, 'coffre_fort', { action: 'lister', recherche: 'perimee' });
  assert.equal(liste.text.includes('Clé périmée'), false);
});

test('supprimer une fiche d’un AUTRE projet est possible : le coffre est commun', async () => {
  const a = projet('Projet H');
  const b = projet('Projet I');
  await callTool({ projectId: a.id, role: 'task' } as any, 'coffre_fort', {
    action: 'enregistrer',
    nom: 'Secret de H',
    type: 'mot-de-passe',
    champs: { identifiant: 'h', motDePasse: 'x' },
  });
  const id = /\[([a-f0-9-]+)\]/i.exec(
    (await callTool({ projectId: a.id, role: 'task' } as any, 'coffre_fort', { action: 'lister', recherche: 'de h' })).text,
  )?.[1];
  assert.ok(id);

  const supprime = await callTool({ projectId: b.id, role: 'task' } as any, 'coffre_fort', { action: 'supprimer', id });
  assert.equal(supprime.ok, true, supprime.text);

  const liste = await callTool({ projectId: a.id, role: 'task' } as any, 'coffre_fort', { action: 'lister', recherche: 'de h' });
  assert.equal(liste.text.includes('Secret de H'), false);
});

test('une fiche PARTAGÉE de Beluga Build reste lisible et dite partagée', async () => {
  // Une fiche SANS projet, rangée comme le fait le tiroir humain (la fiche
  // « accès SSH de la machine » qui jouait ce rôle a disparu avec le VPS).
  const { enregistrerAcces } = await import('../coffre-fort.js');
  const range = enregistrerAcces({
    nom: 'Jeton commun',
    type: 'jeton',
    projectId: null,
    champs: { service: 'Commun', jeton: 'jeton-commun' },
  });
  assert.equal(range.ok, true);
  const p = projet('Projet J');
  const liste = await callTool({ projectId: p.id, role: 'task' } as any, 'coffre_fort', { action: 'lister' });
  assert.match(liste.text, /Jeton commun \(Jeton · partagé Beluga Build\)/);
});
