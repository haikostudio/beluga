import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEstimate, branchName } from '../scheduler.js';
import { Card } from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Calculs de facturation (PLAN §7)                                    */
/* ------------------------------------------------------------------ */

test('les deux durées ne sont jamais confondues', () => {
  const estimate = parseEstimate(`Voici l'analyse.

\`\`\`json
{"machineSeconds": 900, "tokens": 50000, "quotaShare": 0.04, "confidence": "high",
 "summary": "Refonte du filtre", "seniorHours": 4, "billingTitle": "Filtre par étiquette",
 "billingDescription": "Ajout du filtre et des tests"}
\`\`\``);

  assert.ok(estimate);
  assert.equal(estimate!.machineSeconds, 900, 'la durée machine sert à l\'ordonnanceur');
  assert.equal(estimate!.seniorHours, 4, 'les heures senior servent à la facture');
  assert.notEqual(estimate!.machineSeconds! / 3600, estimate!.seniorHours);
});

test('le montant se calcule sur les heures humaines, jamais sur la durée machine', () => {
  const rate = 130;
  const estimate = parseEstimate('```json\n{"machineSeconds": 180, "seniorHours": 3}\n```')!;
  const facture = estimate.seniorHours! * rate;
  const errone = (estimate.machineSeconds! / 3600) * rate;
  assert.equal(facture, 390);
  assert.ok(facture > errone * 10, 'facturer la durée machine reviendrait à facturer 3 minutes');
});

test('une analyse sans chiffres exploitables ne produit pas d\'estimation par défaut', () => {
  assert.equal(parseEstimate("Je n'ai pas réussi à chiffrer cette tâche."), null);
  assert.equal(parseEstimate('```json\n{"resume": "trop vague"}\n```'), null);
});

test('les chiffres se lisent une fois : le dernier bloc json fait foi', () => {
  const estimate = parseEstimate(`
\`\`\`json
{"machineSeconds": 100, "seniorHours": 1}
\`\`\`
Correction après relecture :
\`\`\`json
{"machineSeconds": 600, "seniorHours": 2.5}
\`\`\``)!;
  assert.equal(estimate.machineSeconds, 600);
  assert.equal(estimate.seniorHours, 2.5);
});

test('les nombres écrits à la française sont acceptés', () => {
  const estimate = parseEstimate('```json\n{"machineSeconds": "300", "seniorHours": "1,5"}\n```')!;
  assert.equal(estimate.seniorHours, 1.5);
});

/* ------------------------------------------------------------------ */
/* Branches                                                            */
/* ------------------------------------------------------------------ */

test('le nom de branche est propre, sans accent ni espace', () => {
  const card = Card.parse({
    id: 'abcdef123456',
    projectId: 'p1',
    title: 'Créer l\'écran « Réglages » (été 2026)',
    column: 'planned',
    position: 1,
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    createdAt: 1,
    updatedAt: 1,
  });
  const branch = branchName(card);
  assert.match(branch, /^tache\/[a-z0-9-]+$/);
  assert.ok(branch.includes('creer-l-ecran-reglages'));
});
