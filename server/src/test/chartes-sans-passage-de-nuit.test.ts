/**
 * PLUS AUCUNE CARTE DE CHARTE NE SE POSE SEULE LA NUIT (décision de l'utilisateur, carte « Finitions du lecteur de
 * charte », 06/11/2026) : le 06/11/2026 à 2 h 08, le passage de nuit avait posé 25 cartes « Charte d’interface du
 * projet », prises pour des agents qui tournaient. La charte se rédige désormais seulement par le bouton de la
 * configuration du projet (`chartes.rediger` → `poserLaCarteDeCharte`).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ici = path.dirname(fileURLToPath(import.meta.url));

test('le passage de nuit ne pose plus de carte de charte ; le bouton de la configuration, si', async () => {
  const nuit = fs.readFileSync(path.join(ici, '..', 'memoire-de-nuit.js'), 'utf8');
  assert.ok(!/chartes-de-projets|poserLesCartesDeChartesManquantes/.test(nuit), 'la nuit n’appelle plus la pose des cartes de charte');
  const chartes = fs.readFileSync(path.join(ici, '..', 'chartes-de-projets.js'), 'utf8');
  assert.ok(!/poserLesCartesDeChartesManquantes/.test(chartes), 'la pose en série a disparu');
  assert.match(chartes, /export function poserLaCarteDeCharte/, 'la pose sur demande reste');
  const ws = fs.readFileSync(path.join(ici, '..', 'ws.js'), 'utf8');
  assert.match(ws, /case 'chartes\.rediger'/, 'le bouton « Faire rédiger la charte » reste branché');
});
