/**
 * LE STOCKAGE CENTRAL DES PIÈCES JOINTES EST OUVERT AU MOTEUR, SUR TOUS LES PROJETS.
 *
 * Ce que ces essais verrouillent : les images vivent dans UN SEUL dossier,
 * commun à tous les projets et hors de tout dépôt. Il tombe donc hors du
 * dossier de travail de l'agent partout sauf sur Beluga Build lui-même, et un
 * moteur qui ne l'a pas dans sa portée refuse de lire l'image faute de
 * permission — personne ne peut l'accorder dans un tour non interactif.
 * La ligne de commande de Claude comme celle de Cursor doit donc TOUJOURS
 * porter ce dossier, chef bridé ou agent de tâche, mode plan ou mode direct.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClaudeArgs } from '../engines/claude.js';
import { buildCursorArgs } from '../engines/cursor.js';
import { dossiersDeDonneesOuverts } from '../pieces-jointes.js';
import { PATHS } from '../config.js';

const PIECES = '/donnees/attachments';

test('le dossier des pièces jointes est celui des données, plus le disque de stockage s’il est là, plus l’arborescence rangée', () => {
  const dossiers = dossiersDeDonneesOuverts();
  assert.equal(dossiers[0], PATHS.attachments);
  assert.equal(dossiers[dossiers.length - 1], PATHS.fichiers);
  assert.deepEqual(dossiers.slice(1, -1), dossiers.length > 2 ? [PATHS.attachmentsStockage] : []);
});

test('Claude reçoit le dossier des pièces jointes, agent de tâche compris', () => {
  const args = buildClaudeArgs({
    cwd: '/root/un-autre-projet',
    prompt: 'p',
    fullAccess: true,
    dossiersLisibles: [PIECES],
    onEvent: () => {},
  });
  const i = args.indexOf('--add-dir');
  assert.ok(i >= 0, '--add-dir attendu');
  assert.equal(args[i + 1], PIECES);
});

test('Claude déclare ce dossier dans ses réglages, même hors accès complet', () => {
  const args = buildClaudeArgs({
    cwd: '/root/un-autre-projet',
    prompt: 'p',
    fullAccess: false,
    role: 'task',
    dossiersLisibles: [PIECES],
    onEvent: () => {},
  });
  assert.ok(args.includes('--add-dir'));
  const reglages = JSON.parse(args[args.indexOf('--settings') + 1]);
  // Un `allow: Read(<dossier>/**)` ne suffit PAS : le refus mesuré le
  // 30/08/2026 portait sur la PORTÉE, pas sur l'outil. Seul un dossier déclaré
  // élargit la portée.
  assert.deepEqual(reglages.permissions.additionalDirectories, [PIECES]);
});

test("le bridage du chef n'efface pas cette déclaration de dossier", () => {
  const args = buildClaudeArgs({
    cwd: '/root/travail-du-chef',
    projectRoot: '/root/un-autre-projet',
    prompt: 'p',
    fullAccess: false,
    allowedTools: ['mcp__beluga__propose_task'],
    disallowedTools: ['Edit'],
    dossiersLisibles: [PIECES],
    onEvent: () => {},
  });
  const reglages = JSON.parse(args[args.indexOf('--settings') + 1]);
  // Le mode du chef reste sans approbation — posé sur la ligne de commande, qui
  // écrasait celui des réglages — et le stockage s'ajoute à ses réglages.
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'bypassPermissions');
  assert.deepEqual(reglages.permissions.additionalDirectories, [PIECES]);
  // Le projet du chef ET le stockage : deux dossiers ouverts, pas un.
  assert.equal(args.filter((a) => a === '--add-dir').length, 2);
});

test('Cursor reçoit lui aussi le dossier des pièces jointes', () => {
  const args = buildCursorArgs({
    cwd: '/root/un-autre-projet',
    prompt: 'p',
    fullAccess: true,
    dossiersLisibles: [PIECES],
    onEvent: () => {},
  }, 'sonnet');
  const i = args.indexOf('--add-dir');
  assert.ok(i >= 0, '--add-dir attendu');
  assert.equal(args[i + 1], PIECES);
});

test("sans dossier ouvert, rien n'est ajouté : le réglage reste facultatif", () => {
  const args = buildClaudeArgs({ cwd: '/root/p', prompt: 'p', fullAccess: true, onEvent: () => {} });
  assert.ok(!args.includes('--add-dir'));
});
