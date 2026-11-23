import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DUREE_ARCHIVE_MS } from '@beluga/shared';

/**
 * LES ARCHIVES DU COFFRE-FORT — retirer une fiche la met de côté six mois.
 *
 * Verrouillé ici : une fiche retirée (par l'écran ou par un agent) quitte la
 * liste active mais reste dans les archives et se restaure ; la purge efface
 * une archive de plus de six mois, JAMAIS une archive récente ni une fiche
 * active ; une fiche lue par une surveillance ne s'archive pas.
 */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'coffre-fort-archives-'));
process.env.BELUGA_DATA = bacASable;

const { getDb } = await import('../db.js');
const coffre = await import('../coffre-fort.js');
const { callTool } = await import('../tools.js');
const store = await import('../store.js');

const projet = store.saveProject({
  id: store.newId(),
  name: 'Projet Archives',
  path: bacASable,
  defaultEngine: 'claude',
  isSelf: false,
  archived: false,
  createdAt: store.now(),
  updatedAt: store.now(),
} as any);

function ranger(nom: string, maintenant = Date.now()) {
  const r = coffre.enregistrerAcces({ nom, type: 'jeton', champs: { service: 'X', jeton: `j-${nom}` } }, maintenant);
  assert.equal(r.ok, true, (r as any).raison);
  return (r as any).acces.id as string;
}

test('retirer une fiche l’archive : hors de la liste, dans les archives, puis restaurée', () => {
  const id = ranger('Fiche à retirer');
  assert.equal(coffre.supprimerAcces(id).ok, true);
  assert.equal(coffre.listerAcces().some((a) => a.id === id), false);
  const archive = coffre.listerArchives().find((a) => a.id === id);
  assert.ok(archive?.archiveLe, 'la fiche doit être dans les archives, datée');
  assert.equal(coffre.supprimerAcces(id).ok, false, 'une archive ne se ré-archive pas');
  assert.equal(coffre.enregistrerAcces({ id, nom: 'x', type: 'jeton' }).ok, false, 'une archive ne se corrige pas');

  assert.equal(coffre.restaurerAcces(id).ok, true);
  assert.ok(coffre.listerAcces().some((a) => a.id === id));
  assert.equal(coffre.listerArchives().some((a) => a.id === id), false);
});

test('la purge efface une archive de plus de six mois, et rien d’autre', () => {
  const maintenant = Date.now();
  const vieille = ranger('Archive vieille');
  const recente = ranger('Archive récente');
  const active = ranger('Fiche active');
  assert.equal(coffre.supprimerAcces(vieille, maintenant - DUREE_ARCHIVE_MS - 1000).ok, true);
  assert.equal(coffre.supprimerAcces(recente, maintenant - 1000).ok, true);
  // Une fiche active très ancienne n'est jamais purgée.
  getDb().prepare('UPDATE secrets SET cree_le = 0, modifie_le = 0 WHERE id = ?').run(active);

  const effacees = coffre.purgerArchives(maintenant);
  assert.equal(effacees, 1);
  const ids = (getDb().prepare('SELECT id FROM secrets').all() as { id: string }[]).map((l) => l.id);
  assert.equal(ids.includes(vieille), false);
  assert.ok(ids.includes(recente));
  assert.ok(ids.includes(active));
});

test('une fiche lue par une surveillance ne s’archive pas', () => {
  const id = ranger('Fiche surveillée');
  getDb()
    .prepare(
      "INSERT INTO sites_surveilles (id, url, nom, cree_le, recette) VALUES ('s1', 'https://exemple.test', 'Exemple', 0, ?)",
    )
    .run(JSON.stringify({ type: 'parcours', etapes: [{ action: 'remplir', selecteur: '#p', acces: { id, champ: 'jeton' } }] }));
  const r = coffre.supprimerAcces(id);
  assert.equal(r.ok, false);
  assert.match(r.raison ?? '', /surveillance/);
});

test('un agent archive, liste les archives et restaure par l’outil', async () => {
  const ctx = { projectId: projet.id, role: 'task' } as any;
  const id = ranger('Fiche agent');
  const retrait = await callTool(ctx, 'coffre_fort', { action: 'supprimer', id });
  assert.equal(retrait.ok, true, retrait.text);
  assert.match(retrait.text, /archivé/);
  assert.equal((await callTool(ctx, 'coffre_fort', { action: 'lister' })).text.includes('Fiche agent'), false);
  const archives = await callTool(ctx, 'coffre_fort', { action: 'archives' });
  assert.match(archives.text, /Fiche agent.*archivée, effacée le \d{4}-\d{2}-\d{2}/);
  const retour = await callTool(ctx, 'coffre_fort', { action: 'restaurer', id });
  assert.equal(retour.ok, true, retour.text);
  assert.ok((await callTool(ctx, 'coffre_fort', { action: 'lister' })).text.includes('Fiche agent'));
});

test('un agent qui colle un fichier .env entier est refusé, une fiche par secret', async () => {
  const ctx = { projectId: projet.id, role: 'task' } as any;
  const r = await callTool(ctx, 'coffre_fort', {
    action: 'enregistrer',
    nom: 'Projet — .env',
    type: 'autre',
    champs: { valeur: 'APP_NAME=Truc\nDB_PASSWORD=s3cr3t\nSTRIPE_SECRET_KEY=sk_live_abc\n' },
  });
  assert.equal(r.ok, false);
  assert.match(r.text, /Une fiche par secret/);
});
