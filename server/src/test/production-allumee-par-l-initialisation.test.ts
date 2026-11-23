/*
 * CARTE « Mémoire, bulles, publication et marketing » (19/11/2026) : l'initialisation de la mise en production allume
 * son option ; un projet sans procédure reste éteint ; les projets déjà initialisés sont rallumés UNE fois.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'production-allumee-'));
process.env.BELUGA_DATA = path.join(bacASable, 'data');
fs.mkdirSync(process.env.BELUGA_DATA, { recursive: true });

const { openDb, setMeta } = await import('../db.js');
openDb();
const store = await import('../store.js');
const { enregistrerProcessus, rallumerLaProductionDesProjetsInitialises } = await import('../procedure-publication.js');
const { PRODUCTION_DESACTIVEE, MEMBRE_DESACTIVE } = await import('@beluga/shared');

function projet(nom: string) {
  const dossier = fs.mkdtempSync(path.join(bacASable, `${nom}-`));
  return store.saveProject({
    id: store.newId(),
    name: nom,
    path: dossier,
    defaultEngine: 'claude',
    isSelf: false,
    archived: false,
    createdAt: store.now(),
    updatedAt: store.now(),
  } as any);
}

const PROCESSUS = { etapes: [{ libelle: 'Envoyer', commande: 'true', delaiS: 60 }] } as any;

test('un projet sans procédure reste éteint ; écrire la procédure de production l’allume', () => {
  const p = projet('neuf');
  assert.notEqual(store.getProject(p.id)!.miseEnProductionActive, true, 'éteint par défaut');
  assert.ok(enregistrerProcessus(p.id, PROCESSUS, 'production'));
  assert.equal(store.getProject(p.id)!.miseEnProductionActive, true, 'allumé par l’initialisation');
});

test('écrire la procédure de DÉPLOIEMENT ne touche pas l’option de production', () => {
  const p = projet('dev-seul');
  assert.ok(enregistrerProcessus(p.id, PROCESSUS, 'dev'));
  assert.notEqual(store.getProject(p.id)!.miseEnProductionActive, true);
});

test('le rattrapage rallume une fois les projets initialisés et éteints, puis ne touche plus rien', () => {
  const ancien = projet('ancien');
  store.saveProject({ ...store.getProject(ancien.id)!, miseEnProduction: { processus: PROCESSUS }, miseEnProductionActive: false });
  const sans = projet('sans-procedure');
  assert.ok(rallumerLaProductionDesProjetsInitialises() >= 1);
  assert.equal(store.getProject(ancien.id)!.miseEnProductionActive, true);
  assert.notEqual(store.getProject(sans.id)!.miseEnProductionActive, true, 'sans procédure : jamais allumé');
  // Éteint exprès ensuite : le second passage ne le rallume pas.
  store.saveProject({ ...store.getProject(ancien.id)!, miseEnProductionActive: false });
  assert.equal(rallumerLaProductionDesProjetsInitialises(), 0);
  assert.equal(store.getProject(ancien.id)!.miseEnProductionActive, false);
  setMeta('migration.productionActiveSiProcessus', '');
});

test('le message renvoie à un endroit qui existe', () => {
  assert.doesNotMatch(PRODUCTION_DESACTIVEE, /en haut du tiroir/);
  assert.match(PRODUCTION_DESACTIVEE, /rubrique « Mise en production »/);
  assert.match(MEMBRE_DESACTIVE, /rubrique « Mise en production »/);
});
