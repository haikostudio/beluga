/**
 * LE CADRAGE SAIT CE QUI A DÉJÀ ÉTÉ FAIT SUR SA CARTE (Wogo 4d0aeccc,
 * 01/11/2026 : un cadrage rouvert a répondu « rien n'a été codé » sur une carte
 * livrée, en ligne et archivée).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { blocDuTravailDejaFait, dateAbsolue } from '@beluga/shared';

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'travail-deja-fait-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const { createCard } = await import('../tools.js');
const { ajouterAuJournal, toursDExecution } = await import('../journal-carte.js');

const T0 = Date.UTC(2026, 10, 1, 20, 29, 10);

test('une carte qui n’a jamais travaillé n’a pas de bloc', () => {
  assert.equal(blocDuTravailDejaFait({ executions: [] }), null);
});

test('le bloc dit le travail, la branche, le rendu et la mise en ligne, en dates absolues', () => {
  const bloc = blocDuTravailDejaFait({
    executions: [{ debut: T0, fin: T0 + 830_000 }],
    branche: 'tache/compteur-4d0aec',
    codeDejaEnregistre: true,
    doneAt: T0 + 830_000,
    deployedAt: T0 + 960_000,
    archivedAt: T0 + 961_000,
  })!;
  assert.match(bloc, /^TRAVAIL DÉJÀ FAIT SUR CETTE CARTE : un agent d'exécution a travaillé à partir du 2026-11-01 20:29 UTC, jusqu'au 2026-11-01 20:43 UTC, sur la branche « tache\/compteur-4d0aec »/);
  assert.match(bloc, /du code a été enregistré/);
  assert.match(bloc, /mis en ligne le 2026-11-01 20:45 UTC/);
  assert.match(bloc, /ne réponds jamais de mémoire/);
  assert.equal(dateAbsolue(T0), '2026-11-01 20:29 UTC');
});

test('un tour encore en cours se dit en cours', () => {
  assert.match(blocDuTravailDejaFait({ executions: [{ debut: T0 }] })!, /un tour tourne encore/);
});

test('les tours d’exécution se lisent dans le journal de la carte, pas ceux du cadrage', () => {
  const projet = store.saveProject({ id: store.newId(), name: 'Journal', path: bacASable, createdAt: store.now(), updatedAt: store.now() } as any);
  const carte = createCard(projet.id, { title: 'Compteur', origin: 'user' });
  ajouterAuJournal({ cardId: carte.id, phase: 'cadrage', nature: 'jalon', libelle: 'Tour lancé', tourId: 'c1', at: T0 - 20_000 });
  ajouterAuJournal({ cardId: carte.id, phase: 'execution', nature: 'jalon', libelle: 'Tour lancé', tourId: 'e1', at: T0 });
  ajouterAuJournal({ cardId: carte.id, phase: 'execution', nature: 'requete', libelle: 'Commande', tourId: 'e1', at: T0 + 60_000 });
  ajouterAuJournal({ cardId: carte.id, phase: 'execution', nature: 'jalon', libelle: 'Réponse rendue', tourId: 'e1', at: T0 + 830_000 });
  ajouterAuJournal({ cardId: carte.id, phase: 'execution', nature: 'jalon', libelle: 'Tour lancé', tourId: 'e2', at: T0 + 900_000 });
  assert.deepEqual(toursDExecution(carte.id), [{ debut: T0, fin: T0 + 830_000 }, { debut: T0 + 900_000 }]);
});
