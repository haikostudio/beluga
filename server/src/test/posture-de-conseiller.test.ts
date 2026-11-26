import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'posture-de-conseiller-'));
process.env.BELUGA_DATA = bacASable;

const {
  CONSIGNE_DE_CONSEILLER,
  CONSIGNE_MENER_A_UN_RESULTAT,
  CONSIGNE_MENER_A_UN_RESULTAT_COURTE,
  REGLE_DU_NOMBRE_DE_QUESTIONS,
  consigneDeDemandeComplexe,
  consigneDePlanDansLeMemeTour,
} = await import('@beluga/shared');
const { rolePrompt, consigneDeLAssistantGlobal } = await import('../runtime.js');

/*
 * LA POSTURE DE CONSEILLER (décisions de l'utilisateur, 2026-10-31) : chaque
 * agent qui travaille avec l'utilisateur conseille en professionnel du métier,
 * puise lui-même dans les compétences, dit franchement un choix faible, et pose
 * autant de questions qu'il en faut — plus aucun plafond chiffré.
 */

test('la posture dit le métier, la recherche dans les compétences, la franchise et le nombre de questions', () => {
  assert.match(CONSIGNE_DE_CONSEILLER, /directeur artistique/);
  assert.match(CONSIGNE_DE_CONSEILLER, /développeur ou architecte senior/);
  assert.match(CONSIGNE_DE_CONSEILLER, /« memoire », geste « chercher »/);
  assert.match(CONSIGNE_DE_CONSEILLER, /SOIS FRANC/);
  assert.match(CONSIGNE_DE_CONSEILLER, /ne se rediscute plus/);
  assert.match(CONSIGNE_DE_CONSEILLER, /pendant le travail/);
  assert.ok(CONSIGNE_DE_CONSEILLER.includes(REGLE_DU_NOMBRE_DE_QUESTIONS));
  assert.match(REGLE_DU_NOMBRE_DE_QUESTIONS, /aucune pour un geste simple/);
  // Payée à chaque tour : elle reste courte.
  assert.ok(CONSIGNE_DE_CONSEILLER.length < 1_500, `${CONSIGNE_DE_CONSEILLER.length} signes`);
});

test('tout accueil qui travaille avec l’utilisateur la porte, une seule fois et à l’identique', () => {
  for (const role of ['cadrage', 'task', 'analysis', 'deploy'] as const) {
    const consigne = rolePrompt(role, false, 'claude');
    assert.equal(consigne.split(CONSIGNE_DE_CONSEILLER).length, 2, role);
    // Statique : la consigne système ne change pas d'un appel à l'autre.
    assert.equal(consigne, rolePrompt(role, false, 'claude'), role);
  }
  assert.ok(rolePrompt('task', false, 'codex').includes(CONSIGNE_DE_CONSEILLER));
  assert.ok(rolePrompt('task', false, 'claude', 'complet', 'configuration-marketing').includes(CONSIGNE_DE_CONSEILLER));
  assert.ok(consigneDeLAssistantGlobal(true, 'claude').includes(CONSIGNE_DE_CONSEILLER));
});

test('les accueils ciblés (dépannage, backups, surveillance) restent courts, sans la posture', () => {
  assert.ok(!rolePrompt('deploy', false, 'claude', 'minimal').includes(CONSIGNE_DE_CONSEILLER));
  for (const motif of ['configuration-backup', 'configuration-surveillance', 'depannage-manuel'] as const) {
    assert.ok(!rolePrompt('task', false, 'claude', 'complet', motif).includes(CONSIGNE_DE_CONSEILLER), motif);
  }
});

test('plus aucun plafond chiffré de questions dans les consignes de plan et de demande complexe', () => {
  for (const numero of [1, 2]) {
    const plan = consigneDePlanDansLeMemeTour(numero);
    assert.doesNotMatch(plan, /trois à huit/);
    assert.ok(plan.includes(REGLE_DU_NOMBRE_DE_QUESTIONS));
    assert.match(plan, /UNE À LA FOIS/);
  }
  assert.match(consigneDePlanDansLeMemeTour(2), /derniers échanges laissent ouvert/);
  const complexe = consigneDeDemandeComplexe({ complexe: true, raisons: ['5 souhaits exprimés'] });
  assert.doesNotMatch(complexe, /deux à cinq/);
  assert.ok(complexe.includes(REGLE_DU_NOMBRE_DE_QUESTIONS));
});

test('les agents des services mènent l’échange jusqu’à un résultat, même sous un accueil minimal (26/11/2026)', () => {
  assert.match(CONSIGNE_MENER_A_UN_RESULTAT, /ENQUÊTE avec tes outils/);
  assert.match(CONSIGNE_MENER_A_UN_RESULTAT, /DIAGNOSTIC/);
  assert.match(CONSIGNE_MENER_A_UN_RESULTAT, /ÉTAPE SUIVANTE/);
  for (const motif of ['configuration-marketing', 'directeur-marketing', 'chef-de-marque', 'chef-de-projet', 'chef-de-campagne'] as const) {
    const consigne = rolePrompt('task', false, 'claude', 'minimal', motif);
    assert.equal(consigne.split(CONSIGNE_MENER_A_UN_RESULTAT).length, 2, motif);
    assert.equal(consigne, rolePrompt('task', false, 'claude', 'minimal', motif), motif);
  }
  for (const motif of ['configuration-backup', 'configuration-surveillance'] as const) {
    const consigne = rolePrompt('task', false, 'claude', 'minimal', motif);
    assert.ok(consigne.includes(CONSIGNE_MENER_A_UN_RESULTAT_COURTE), motif);
    assert.ok(!consigne.includes(CONSIGNE_MENER_A_UN_RESULTAT), motif);
  }
  // Un agent de tâche ordinaire, un dépannage : rien de plus.
  assert.ok(!rolePrompt('task', false, 'claude').includes(CONSIGNE_MENER_A_UN_RESULTAT));
  assert.ok(!rolePrompt('deploy', false, 'claude', 'minimal', 'depannage-manuel').includes(CONSIGNE_MENER_A_UN_RESULTAT_COURTE));
  assert.ok(CONSIGNE_MENER_A_UN_RESULTAT.length < 1_000, `${CONSIGNE_MENER_A_UN_RESULTAT.length} signes`);
});
