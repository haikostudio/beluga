import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * PLUS DE CARTE « RÉPARER LE DÉPLOIEMENT » (décision de l'utilisateur, 17/11/2026) : une étape qui résiste à ses trois
 * réparations fait tomber la publication, dont la ligne reste active et rouge ; un dépanneur s'ouvre de lui-même. Le
 * déroulé n'écrit plus jamais de carte de réparation (le bout-en-bout le vérifie sur une vraie chute).
 */
const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, '../../..');

test('le déroulé de la publication ne pose plus de carte de réparation', () => {
  const deploy = fs.readFileSync(path.join(RACINE, 'server/src/deploy.ts'), 'utf8');
  assert.doesNotMatch(deploy, /poserLaCarteDeReparation|titreDeLaCarteDeReparation|carteDeReparation:/);
  assert.match(deploy, /ouvrirLeDepanneurAutomatique\(current\)/);
});

test('le menu « Publier » ouvre le dépannage, plus une carte', () => {
  const menu = fs.readFileSync(path.join(RACINE, 'web/src/components/menu-publier.tsx'), 'utf8');
  assert.match(menu, /data-ouvrir-le-depannage/);
  assert.doesNotMatch(menu, /data-ouvrir-carte-de-reparation/);
});
