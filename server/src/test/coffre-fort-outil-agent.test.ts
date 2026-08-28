import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * L'OUTIL « coffre_fort » — ce que les AGENTS peuvent lire et écrire, par
 * l'outil du protocole (pas le tiroir humain, qui lui voit tout).
 *
 * Verrouillé ici : un agent ne voit que les accès de SON projet plus les
 * accès partagés d'HaikoDev (`projectId: null`) — jamais ceux d'un autre
 * projet ; une écriture est TOUJOURS rattachée à son projet ; corriger une
 * fiche d'un autre projet est refusé ; corriger par « id » retrouve la même
 * fiche plutôt que d'en créer une seconde.
 */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'coffre-fort-outil-'));
process.env.HAIKODEV_DATA = bacASable;

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

test('un agent ne voit jamais les accès d’un AUTRE projet', async () => {
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
  assert.equal(depuisB.text.includes('Secret de A'), false);

  const depuisA = await callTool({ projectId: a.id, role: 'task' } as any, 'coffre_fort', { action: 'lister' });
  assert.match(depuisA.text, /Secret de A/);
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

test('corriger une fiche d’un AUTRE projet par id est refusé', async () => {
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

  const refus = await callTool({ projectId: b.id, role: 'task' } as any, 'coffre_fort', {
    action: 'enregistrer',
    id,
    nom: 'Base de D',
    type: 'base-de-donnees',
    champs: { hote: 'ailleurs', base: 'd', motDePasse: 'y' },
  });
  assert.equal(refus.ok, false);
  assert.match(refus.text, /autre projet/);
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

test('supprimer une fiche d’un AUTRE projet est refusé', async () => {
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

  const refus = await callTool({ projectId: b.id, role: 'task' } as any, 'coffre_fort', { action: 'supprimer', id });
  assert.equal(refus.ok, false);
  assert.match(refus.text, /autre projet/);

  const toujoursLa = await callTool({ projectId: a.id, role: 'task' } as any, 'coffre_fort', { action: 'lister', recherche: 'de h' });
  assert.match(toujoursLa.text, /Secret de H/);
});
