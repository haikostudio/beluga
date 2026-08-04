import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapPrompt } from '@haikodev/shared';
import { rolePrompt, rappelDeMethode } from '../runtime.js';
import { buildCodexArgs } from '../engines/codex.js';
import { ORCHESTRATOR_ALLOWED_NATIVE } from '../tools.js';

/* ------------------------------------------------------------------ */
/* Le déroulé est le MÊME pour Codex et pour Claude                     */
/* ------------------------------------------------------------------ */

/*
 * HaikoDev impose le processus ; le moteur ne fait que l'exécuter. Ces contrôles
 * garantissent qu'à rôle égal, les deux moteurs reçoivent EXACTEMENT le même
 * déroulé — seul le nom de l'outil de liste, propre à chaque moteur, diffère.
 */

const ROLES = ['orchestrator', 'analysis', 'deploy', 'task'] as const;

/** On retire la seule ligne qui nomme l'outil : le reste doit être identique. */
function sansLigneOutil(prompt: string): string {
  return prompt
    .split('\n')
    .filter((l) => !l.startsWith("1. AVANT d'agir, annonce ta liste de tâches"))
    .join('\n');
}

test('à rôle égal, le déroulé de Codex et de Claude est identique (hors nom d’outil)', () => {
  for (const role of ROLES) {
    const claude = rolePrompt(role, false, 'claude');
    const codex = rolePrompt(role, false, 'codex');
    assert.equal(
      sansLigneOutil(codex),
      sansLigneOutil(claude),
      `Le déroulé diffère entre les moteurs pour le rôle « ${role} »`,
    );
  }
});

test('chaque moteur ne se voit nommer QUE son propre outil de liste', () => {
  const claude = rolePrompt('task', false, 'claude');
  const codex = rolePrompt('task', false, 'codex');

  assert.match(claude, /TaskCreate/);
  assert.match(claude, /TaskUpdate/);
  assert.doesNotMatch(claude, /update_plan/);

  assert.match(codex, /update_plan/);
  assert.doesNotMatch(codex, /TaskCreate/);
  assert.doesNotMatch(codex, /TaskUpdate/);
});

test('les règles de déroulé communes sont présentes dans les deux', () => {
  for (const engine of ['claude', 'codex'] as const) {
    const p = rolePrompt('task', false, engine);
    assert.match(p, /DÉROULÉ VISIBLE/);
    assert.match(p, /Une seule ligne en cours à la fois/);
    assert.match(p, /coche-la dès qu'elle est terminée/);
  }
});

test('sans moteur précisé, le déroulé reste celui de Claude (valeur par défaut sûre)', () => {
  assert.equal(rolePrompt('task', false), rolePrompt('task', false, 'claude'));
});

/* ------------------------------------------------------------------ */
/* La MÉTHODE : lire, constater, ne rien inventer, vérifier             */
/* ------------------------------------------------------------------ */

test('la méthode de travail est imposée à tous les rôles et à tous les moteurs', () => {
  for (const engine of ['claude', 'codex'] as const) {
    for (const role of ROLES) {
      const p = rolePrompt(role, false, engine);
      assert.match(p, /MÉTHODE DE TRAVAIL IMPOSÉE/, `${role} / ${engine}`);
      assert.match(p, /LIRE AVANT DE RÉPONDRE/, `${role} / ${engine}`);
      assert.match(p, /project_memory/, `${role} / ${engine}`);
      assert.match(p, /CONSTATER PAR ÉCRIT/, `${role} / ${engine}`);
      assert.match(p, /NE RIEN INVENTER/, `${role} / ${engine}`);
      assert.match(p, /VÉRIFIER À LA FIN/, `${role} / ${engine}`);
    }
  }
});

test("la méthode ne nomme aucun outil propre à un moteur : elle doit valoir partout", () => {
  const methode = rolePrompt('task', false, 'claude').split('MÉTHODE DE TRAVAIL IMPOSÉE')[1];
  assert.doesNotMatch(methode, /TaskCreate|TaskUpdate|update_plan|Grep|Glob/);
});

/* ------------------------------------------------------------------ */
/* À demande égale, l'instruction envoyée est la même                   */
/* ------------------------------------------------------------------ */

/** L'instruction ENTIÈRE : consignes de rôle + demande enveloppée du gabarit. */
function instruction(engine: 'claude' | 'codex', demande: string): string {
  return `${rolePrompt('task', true, engine)}\n\n---\n\n${wrapPrompt('in_run', demande, 'Projet : essai.')}`;
}

test("sur une même demande, les deux moteurs reçoivent la même instruction (hors nom d'outil)", () => {
  const demande = "Corrige l'affichage du tableau sur téléphone.";
  assert.equal(
    sansLigneOutil(instruction('codex', demande)),
    sansLigneOutil(instruction('claude', demande)),
  );
});

/* ------------------------------------------------------------------ */
/* Le déroulé ne s'efface pas au fil de la conversation                 */
/* ------------------------------------------------------------------ */

/*
 * Claude Code recolle sa consigne système à CHAQUE tour ; Codex ne l'a qu'au
 * premier message du fil. Sans rappel, le déroulé imposé s'effaçait donc d'un
 * moteur mais pas de l'autre — la divergence revenait par la porte de derrière.
 */
test('en reprise, Codex reçoit le rappel de méthode devant la demande', () => {
  const args = buildCodexArgs({
    cwd: '/tmp',
    prompt: 'DEMANDE : ajoute un bouton.',
    sessionId: 'fil-123',
    systemPrompt: rolePrompt('task', true, 'codex'),
    systemPromptRappel: rappelDeMethode('codex'),
    fullAccess: true,
    onEvent: () => {},
  });
  const dernier = args[args.length - 1];
  assert.match(dernier, /RAPPEL DE MÉTHODE/);
  assert.match(dernier, /update_plan/);
  assert.match(dernier, /ajoute un bouton/);
  // Le pavé entier, lui, ne repart pas : il est déjà dans le fil.
  assert.doesNotMatch(dernier, /MÉTHODE DE TRAVAIL IMPOSÉE/);
});

test('au premier tour, Codex reçoit les consignes entières', () => {
  const args = buildCodexArgs({
    cwd: '/tmp',
    prompt: 'DEMANDE : ajoute un bouton.',
    systemPrompt: rolePrompt('task', true, 'codex'),
    systemPromptRappel: rappelDeMethode('codex'),
    fullAccess: true,
    onEvent: () => {},
  });
  assert.match(args[args.length - 1], /MÉTHODE DE TRAVAIL IMPOSÉE/);
});

test('le rappel nomme à chaque moteur son seul outil de liste', () => {
  assert.match(rappelDeMethode('claude'), /TaskCreate/);
  assert.doesNotMatch(rappelDeMethode('claude'), /update_plan/);
  assert.match(rappelDeMethode('codex'), /update_plan/);
  assert.doesNotMatch(rappelDeMethode('codex'), /TaskCreate/);
});

/* ------------------------------------------------------------------ */
/* Le chef bridé peut annoncer sa liste, quel que soit le moteur        */
/* ------------------------------------------------------------------ */

test('la liste de tâches reste autorisée au chef d’orchestre bridé', () => {
  for (const outil of ['TaskCreate', 'TaskUpdate', 'TodoWrite']) {
    assert.ok(
      ORCHESTRATOR_ALLOWED_NATIVE.includes(outil),
      `« ${outil} » manque : le déroulé visible serait impossible sous Claude`,
    );
  }
});
