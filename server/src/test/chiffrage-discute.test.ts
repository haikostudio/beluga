import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/* Discuter avec l'agent d'analyse met à jour le chiffrage             */
/* ------------------------------------------------------------------ */

/*
 * On écrit à l'agent d'analyse d'une carte en « Planifié » pour corriger une
 * hypothèse : son tour rejoue l'analyse et rend un nouveau chiffrage. La carte
 * doit le refléter — mais elle ne se déplace jamais (l'analyse ne bouge pas une
 * carte) et un tour sans chiffres frais ne casse pas l'estimation existante.
 *
 * La base est réelle mais posée dans un dossier jetable.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'chiffrage-discute-'));
process.env.HAIKODEV_DATA = bacASable;

const store = await import('../store.js');
const { appliquerChiffrageDiscute } = await import('../scheduler.js');

function projetDEssai() {
  return store.saveProject({
    id: store.newId(),
    name: 'Projet d’essai',
    path: bacASable,
    defaultEngine: 'claude',
    isSelf: false,
    archived: false,
    createdAt: store.now(),
    updatedAt: store.now(),
  } as any);
}

function carteEnPlanifie(projetId: string) {
  return store.saveCard({
    id: store.newId(),
    projectId: projetId,
    title: 'Carte d’essai',
    description: 'Une tâche à chiffrer.',
    column: 'planned',
    position: 1,
    run: { engine: 'claude' },
    estimate: {
      machineSeconds: 600,
      seniorHours: 2,
      confidence: 'medium',
      summary: 'Chiffrage initial',
      failed: false,
      producedAt: store.now(),
    },
    createdAt: store.now(),
    updatedAt: store.now(),
  } as any);
}

const REPONSE_CHIFFREE = `Après la précision, je revois mon chiffrage.

\`\`\`json
{"machineSeconds": 1800, "seniorHours": 5, "quotaShare": 0.2, "confidence": "high", "summary": "Chiffrage revu"}
\`\`\``;

test('un nouveau chiffrage remonte sur la carte, sans la déplacer', () => {
  const projet = projetDEssai();
  const carte = carteEnPlanifie(projet.id);

  appliquerChiffrageDiscute(carte.id, REPONSE_CHIFFREE, true);

  const relue = store.getCard(carte.id)!;
  assert.equal(relue.estimate?.seniorHours, 5, 'les heures senior suivent la correction');
  assert.equal(relue.estimate?.machineSeconds, 1800);
  assert.equal(relue.estimate?.failed, false);
  assert.equal(relue.column, 'planned', 'la carte ne quitte jamais « Planifié »');
});

test('un tour sans chiffres frais laisse l’estimation intacte', () => {
  const projet = projetDEssai();
  const carte = carteEnPlanifie(projet.id);

  appliquerChiffrageDiscute(carte.id, "Bonne question — je regarde et je te réponds.", true);

  const relue = store.getCard(carte.id)!;
  assert.equal(relue.estimate?.seniorHours, 2, 'le chiffrage d’origine reste');
  assert.equal(relue.estimate?.failed, false, 'jamais marqué en échec en discutant');
});

test('un tour en échec ne touche à rien', () => {
  const projet = projetDEssai();
  const carte = carteEnPlanifie(projet.id);

  appliquerChiffrageDiscute(carte.id, REPONSE_CHIFFREE, false);

  const relue = store.getCard(carte.id)!;
  assert.equal(relue.estimate?.seniorHours, 2);
});
