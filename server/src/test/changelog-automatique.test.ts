import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pageChangelog, parserChangelog, Card, Project } from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* UNE LIVRAISON RÉELLE ALIMENTE LE CHANGELOG PUBLIC, SANS GESTE À LA MAIN */
/*                                                                      */
/* `archiveCard` (server/src/archive.ts) écrit déjà une ligne dans      */
/* `HISTORIQUE.md` à chaque carte qui se ferme — mais rien ne le        */
/* vérifiait bout en bout : ni l'écriture sur disque, ni sa lecture par */
/* la page publique. Ce test rejoue les deux, sur une base et un projet */
/* jetables.                                                            */
/* ------------------------------------------------------------------ */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'changelog-auto-'));
process.env.HAIKODEV_DATA = bacASable;
const dossierProjet = fs.mkdtempSync(path.join(os.tmpdir(), 'changelog-auto-projet-'));

const store = await import('../store.js');
const { archiveCard } = await import('../archive.js');

const projet = store.saveProject(
  Project.parse({
    id: store.newId(),
    name: 'Projet d’essai',
    path: dossierProjet,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }),
);

const carte = store.saveCard(
  Card.parse({
    id: store.newId(),
    projectId: projet.id,
    title: 'Livraison de test pour le changelog automatique',
    column: 'running',
    position: 1,
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deployedAt: Date.now(),
  }),
);

test('archiver une carte livrée écrit toute seule une ligne dans HISTORIQUE.md', async () => {
  const historique = path.join(dossierProjet, 'HISTORIQUE.md');
  assert.equal(fs.existsSync(historique), false);

  const resultat = await archiveCard(carte.id);
  assert.equal(resultat.ok, true);

  assert.equal(fs.existsSync(historique), true);
  const contenu = fs.readFileSync(historique, 'utf8');
  assert.match(contenu, /« Livraison de test pour le changelog automatique » livrée et publiée\./);
});

test('la page publique /changelog affiche aussitôt cette entrée, sans intervention', () => {
  const contenu = fs.readFileSync(path.join(dossierProjet, 'HISTORIQUE.md'), 'utf8');
  const entrees = parserChangelog(contenu);
  assert.equal(entrees.length, 1);
  assert.match(entrees[0].texte, /Livraison de test pour le changelog automatique/);

  const html = pageChangelog(contenu);
  assert.match(html, /Livraison de test pour le changelog automatique/);
});
