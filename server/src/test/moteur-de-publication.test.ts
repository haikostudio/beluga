import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CompteDePublication,
  PLACE_MINIMALE_POUR_PUBLIER,
  compteQuiMeneLaPublication,
  comptesQuiPeuventPublier,
  estUneBasculeDeMoteur,
  phraseAucunMoteurLibre,
  phraseDeBasculeDeMoteur,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* LA PUBLICATION CHOISIT SON MOTEUR : celui qui a encore la place de   */
/* finir, tous moteurs installés confondus — et quand il n'y en a       */
/* aucun, elle le DIT au lieu de rester en attente.                     */
/* ------------------------------------------------------------------ */

function compte(partiel: Partial<CompteDePublication> & { id: string; engine: string }): CompteDePublication {
  return { label: partiel.id, ...partiel };
}

test('le moteur réglé sur le projet garde la main tant qu’il a de la place', () => {
  const retenu = compteQuiMeneLaPublication(
    [
      compte({ id: 'claude-pro', engine: 'claude', plan: 'Pro', sessionPct: 40 }),
      compte({ id: 'codex-pro', engine: 'codex', plan: 'Max x20', sessionPct: 0 }),
    ],
    'claude',
  );
  // Codex a bien plus de place, mais on ne change pas de moteur pour du
  // confort : une bascule repart d'un fil vide.
  assert.equal(retenu?.id, 'claude-pro');
  assert.equal(estUneBasculeDeMoteur(retenu!, 'claude'), false);
});

test('le moteur préféré saturé, la publication bascule sur l’autre moteur libre', () => {
  const comptes = [
    compte({ id: 'claude-pro', engine: 'claude', plan: 'Pro', sessionPct: 98 }),
    compte({ id: 'claude-max', engine: 'claude', plan: 'Max x20', weeklyPct: 100 }),
    compte({ id: 'codex-plus', engine: 'codex', plan: 'Plus', sessionPct: 30 }),
  ];
  const retenu = compteQuiMeneLaPublication(comptes, 'claude');
  assert.equal(retenu?.id, 'codex-plus', 'le travail part là où il reste du quota');
  assert.equal(estUneBasculeDeMoteur(retenu!, 'claude'), true);
  const phrase = phraseDeBasculeDeMoteur(retenu!, 'claude');
  assert.match(phrase, /« claude » n’a plus assez de quota/);
  assert.match(phrase, /passe sur « codex »/);
});

test('la place se compare d’un plan à l’autre, pas en pourcentage', () => {
  const retenu = compteQuiMeneLaPublication([
    compte({ id: 'petit', engine: 'claude', plan: 'Pro', sessionPct: 10 }),
    compte({ id: 'grand', engine: 'codex', plan: 'Max x20', sessionPct: 80 }),
  ]);
  // 20 × 20 % = 4 fenêtres restantes contre 1 × 90 % = 0,9 : le gros compte
  // à 80 % a bien plus de place que le petit à 10 %.
  assert.equal(retenu?.id, 'grand');
});

test('un moteur absent du serveur ne reçoit rien, même avec un quota intact', () => {
  const retenu = compteQuiMeneLaPublication(
    [
      compte({ id: 'codex-neuf', engine: 'codex', plan: 'Max x20', sessionPct: 0, installe: false }),
      compte({ id: 'claude-pro', engine: 'claude', plan: 'Pro', sessionPct: 50 }),
    ],
    'claude',
  );
  assert.equal(retenu?.id, 'claude-pro');
});

test('un compte coupé à la main ne mène jamais une publication', () => {
  const possibles = comptesQuiPeuventPublier([
    compte({ id: 'coupe', engine: 'codex', plan: 'Max x20', sessionPct: 0, disabled: true }),
    compte({ id: 'ouvert', engine: 'claude', plan: 'Pro', sessionPct: 0 }),
  ]);
  assert.deepEqual(possibles.map((c) => c.id), ['ouvert']);
});

test('« pas encore à 100 % » ne suffit pas : il faut de quoi aller au bout', () => {
  const comptes = [
    compte({ id: 'claude-pro', engine: 'claude', plan: 'Pro', sessionPct: 95 }),
    compte({ id: 'codex-plus', engine: 'codex', plan: 'Plus', weeklyPct: 90 }),
  ];
  // 0,05 et 0,10 fenêtre : les deux passeraient l'ancien filtre (« available »),
  // aucun ne tient une publication entière.
  assert.equal(compteQuiMeneLaPublication(comptes, 'claude'), undefined);
  assert.ok(PLACE_MINIMALE_POUR_PUBLIER > 0.1);
});

test('aucun moteur libre : la raison est dite, moteur par moteur', () => {
  const phrase = phraseAucunMoteurLibre([
    compte({ id: 'claude-pro', engine: 'claude', label: 'Claude Pro', plan: 'Pro', sessionPct: 95 }),
    compte({ id: 'claude-max', engine: 'claude', label: 'Claude Max', plan: 'Max x20', weeklyPct: 100 }),
    compte({ id: 'codex-plus', engine: 'codex', label: 'Codex Plus', plan: 'Plus', weeklyPct: 90 }),
  ]);
  assert.match(phrase, /Aucun moteur n’a le quota nécessaire/);
  // Le plus dégagé de CHAQUE moteur, nommé : on voit qu'il n'y avait rien à prendre.
  assert.match(phrase, /claude : « Claude Pro »/);
  assert.match(phrase, /codex : « Codex Plus »/);
  assert.doesNotMatch(phrase, /Claude Max/, 'un seul compte par moteur, le plus dégagé');
});

test('aucun compte du tout : la phrase le dit sans inventer de moteur', () => {
  assert.match(phraseAucunMoteurLibre([]), /aucun moteur installé ne porte de compte actif/);
});

test('sans moteur préféré, on prend simplement le plus dégagé', () => {
  const retenu = compteQuiMeneLaPublication([
    compte({ id: 'a', engine: 'claude', plan: 'Pro', sessionPct: 20 }),
    compte({ id: 'b', engine: 'codex', plan: 'Max', sessionPct: 20 }),
  ]);
  assert.equal(retenu?.id, 'b');
  assert.equal(estUneBasculeDeMoteur(retenu!, undefined), false, 'sans préférence, rien n’est une bascule');
});

/* --- Le branchement dans la publication ----------------------------- */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const DEPLOY = fs.readFileSync(path.resolve(ICI, '../../src/deploy.ts'), 'utf8');
const CHOIX = fs.readFileSync(path.resolve(ICI, '../../src/moteur-de-publication.ts'), 'utf8');

test('les CINQ agents que la publication lance passent par la fabrique qui choisit le moteur', () => {
  const appels = DEPLOY.match(/await agentDePublication\(/g) ?? [];
  assert.equal(
    appels.length,
    5,
    'conflit de fusion, contrôles, construction, mise en production confiée et dépanneur',
  );
  // Plus aucun agent de publication créé à la main : ce serait repartir sur le
  // moteur par défaut, donc éventuellement sur un compte à sec.
  const bruts = DEPLOY.match(/createAgent\(\{[\s\S]{0,120}?role: 'deploy'/g) ?? [];
  assert.equal(bruts.length, 1, 'seule la fabrique crée un agent de rôle « deploy »');
});

test('chaque appel a son issue quand aucun moteur n’a de quota — jamais un silence', () => {
  const manques = DEPLOY.match(/if \('manque' in pose\)/g) ?? [];
  assert.equal(manques.length, 5, 'les cinq lancements disent la raison au lieu d’attendre');
  assert.match(DEPLOY, /function recitFauteDeQuota\(/);
  assert.match(DEPLOY, /Publication interrompue faute de quota/);
});

test('le filet d’après-coup : un tour refusé pour quota ne passe pas pour un travail fait', () => {
  assert.match(DEPLOY, /function tourRefusePourQuota\(/);
  const filets = DEPLOY.match(/tourRefusePourQuota\(agent\.id\)/g) ?? [];
  assert.equal(filets.length, 5, 'les cinq tours vérifient que le moteur a vraiment travaillé');
});

test('on ne bascule jamais tout seul vers un moteur facturé au crédit', () => {
  assert.match(CHOIX, /const MOTEURS_DE_BASCULE: EngineId\[\] = \['claude', 'codex'\]/);
  assert.doesNotMatch(CHOIX, /MOTEURS_DE_BASCULE[^\n]*cursor/);
});
