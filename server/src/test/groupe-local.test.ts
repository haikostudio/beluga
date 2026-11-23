import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  NOM_GROUPE_LOCAL,
  REFUS_SORTIE_GROUPE_LOCAL,
  REFUS_SUPPRESSION_GROUPE_LOCAL,
  choisirGroupeLocal,
  idDuGroupeLocal,
} from '@beluga/shared';

/*
 * Le groupe « Local » (`shared/src/groupe-local.ts`) : créé une fois, repris
 * s'il existe déjà sous ce nom, jamais supprimé, et Beluga n'en sort pas.
 * La base du démon est détournée AVANT le premier import du store.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'groupe-local-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const { callTool } = await import('../tools.js');

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'projet-local-'));

function projet(nom: string, extra: Record<string, unknown> = {}) {
  return store.saveProject({
    id: store.newId(),
    name: nom,
    path: fs.mkdtempSync(path.join(dossier, 'p-')),
    defaultEngine: 'claude',
    isSelf: false,
    archived: false,
    rank: 1000,
    createdAt: store.now(),
    updatedAt: store.now(),
    ...extra,
  } as any);
}

test('la règle pure : garder, reprendre un homonyme, sinon créer en tête', () => {
  const groupes = [
    { id: 'a', name: 'Clients', rank: 10 },
    { id: 'b', name: '  local ', rank: 20 },
  ];
  assert.deepEqual(choisirGroupeLocal('a', groupes, [10, 20]), { geste: 'garder', id: 'a' });
  assert.deepEqual(choisirGroupeLocal(undefined, groupes, [10, 20]), { geste: 'reprendre', id: 'b' });
  assert.deepEqual(choisirGroupeLocal('disparu', [groupes[0]], [10, 30]), {
    geste: 'creer',
    nom: NOM_GROUPE_LOCAL,
    rang: 0,
  });
  assert.equal(idDuGroupeLocal([{ isSelf: true, groupId: 'a' }], groupes), 'a');
  assert.equal(idDuGroupeLocal([{ isSelf: true, groupId: 'zz' }], groupes), undefined);
  assert.equal(idDuGroupeLocal([{ isSelf: false, groupId: 'a' }], groupes), undefined);
});

test('le démarrage reprend le « Local » créé à la main, sans le doubler, et y fixe Beluga', () => {
  const clients = store.saveGroup({ id: store.newId(), name: 'Clients', rank: 10, collapsed: false });
  const aLaMain = store.saveGroup({ id: store.newId(), name: 'LOCAL', rank: 20, collapsed: false });
  const voisin = projet('Voisin', { groupId: aLaMain.id, rank: 5 });
  const soi = projet('Beluga', { isSelf: true });

  const groupe = store.ensureLocalGroup();
  assert.equal(groupe?.id, aLaMain.id);
  assert.equal(store.listGroups().length, 2, 'aucun second groupe « Local »');
  const apres = store.getProject(soi.id)!;
  assert.equal(apres.groupId, aLaMain.id);
  assert.ok((apres.rank ?? 1000) < (voisin.rank ?? 1000), 'Beluga passe devant les membres');

  // Idempotent : un second démarrage ne change rien.
  store.ensureLocalGroup();
  assert.equal(store.listGroups().length, 2);
  assert.equal(store.groupeLocalId(), aLaMain.id);
  assert.ok(clients);
});

test('le groupe « Local » ne se supprime pas ; un autre groupe, si', () => {
  const localId = store.groupeLocalId()!;
  assert.throws(() => store.deleteGroup(localId), { message: REFUS_SUPPRESSION_GROUPE_LOCAL });
  assert.ok(store.listGroups().some((g) => g.id === localId));

  const passager = store.saveGroup({ id: store.newId(), name: 'Passager', rank: 99, collapsed: false });
  store.deleteGroup(passager.id);
  assert.ok(!store.listGroups().some((g) => g.id === passager.id));
});

test('sans groupe d’accueil, « Local » est créé avant tous les autres', () => {
  const soi = store.listProjects(true).find((p) => p.isSelf)!;
  store.saveProject({ ...soi, groupId: undefined });
  for (const g of store.listGroups()) {
    if (g.name.trim().toLowerCase() === 'local') store.saveGroup({ ...g, name: 'Ancien' });
  }
  const groupe = store.ensureLocalGroup()!;
  assert.equal(groupe.name, NOM_GROUPE_LOCAL);
  const rangs = store.listGroups().filter((g) => g.id !== groupe.id).map((g) => g.rank);
  assert.ok(rangs.every((r) => groupe.rank < r), 'en tête de colonne');
  assert.equal(store.getProject(soi.id)!.groupId, groupe.id);
});

test('l’outil des agents ne sort pas Beluga de son groupe', async () => {
  const soi = store.listProjects(true).find((p) => p.isSelf)!;
  const ctx = { agentId: 'chef', projectId: soi.id, role: 'cadrage' as const };
  const res = await callTool(ctx, 'project_manage', { action: 'deplacer', projet: soi.name, groupe: 'aucun' });
  assert.equal(res.ok, false);
  assert.match(res.text, new RegExp(REFUS_SORTIE_GROUPE_LOCAL.slice(0, 30)));
  assert.equal(store.getProject(soi.id)!.groupId, store.groupeLocalId());
});
