/**
 * LE MESSAGE D'UNE MISE EN PRODUCTION AU PUBLIC PORTE TOUS SES TRAVAUX.
 *
 * Contrat avec l'administration de Beluga Build (dépôt belugabuild,
 * `central/src/versions.ts`, `changementsDe`) : chaque ligne « - … » du corps devient
 * une modification affichée. On rejoue ici la lecture de l'administration sur un
 * message de 180 travaux : aucun ne doit manquer, la ligne « Source » ferme le tout.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

const RACINE = path.resolve(import.meta.dirname, '..');
const { messageDuMiroir, sourceDuMessage, LIGNE_SOURCE } = await import(path.join(RACINE, 'scripts/synchroniser-miroir-public.mjs'));

/** La lecture de l'administration, recopiée de `changementsDe` (belugabuild). */
function changementsDe(message) {
  const vus = new Set();
  const r = [];
  for (const brut of String(message ?? '').split('\n').slice(1)) {
    const m = /^\s*[-*]\s+(.+?)\s*$/.exec(brut);
    if (!m) continue;
    const ligne = m[1];
    if (/^Travaux en cours enregistrés/i.test(ligne) || vus.has(ligne)) continue;
    vus.add(ligne);
    r.push(ligne.slice(0, 300));
  }
  return r;
}

const SHA = 'a'.repeat(40);

test('180 travaux : les 180 arrivent dans l’administration, rien n’est tronqué', () => {
  const titres = Array.from({ length: 180 }, (_, i) => `Travail numéro ${i + 1}`);
  const message = messageDuMiroir({ branche: 'main', titres, commitPrive: SHA });
  assert.match(message, /^Synchronise le miroir sur main \(180 travail\(aux\)\)\n\n/);
  assert.doesNotMatch(message, /de plus/);
  assert.deepEqual(changementsDe(message), titres);
  assert.equal(sourceDuMessage(message), SHA);
  assert.ok(message.trimEnd().endsWith(`${LIGNE_SOURCE}${SHA}`));
});

test('un titre sur plusieurs lignes reste UNE modification', () => {
  const message = messageDuMiroir({ branche: 'main', titres: ['Premier\nsuite du titre'], commitPrive: SHA });
  assert.deepEqual(changementsDe(message), ['Premier suite du titre']);
});

test('aucun travail : le message garde son titre et sa ligne « Source »', () => {
  const message = messageDuMiroir({ branche: 'main', titres: [], commitPrive: SHA });
  assert.deepEqual(changementsDe(message), []);
  assert.equal(sourceDuMessage(message), SHA);
});
