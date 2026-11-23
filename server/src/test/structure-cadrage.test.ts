import test from 'node:test';
import assert from 'node:assert/strict';
import {
  retirerLaStructureDeCadrage,
} from '@beluga/shared';

/**
 * LE BLOC DE STRUCTURE DU CADRAGE NE S'AFFICHE JAMAIS EN CLAIR, refermé ou non,
 * et un bloc de code ordinaire n'est jamais pris pour lui.
 */

const BLOC = `Voici ce que j'en comprends.

\`\`\`cadrage
{ "analyse": "Vous voulez que chaque étape porte son texte." }
\`\`\``;

test('le bloc ne s’affiche jamais en clair, même pas refermé', () => {
  assert.equal(retirerLaStructureDeCadrage(BLOC), "Voici ce que j'en comprends.");
  const enCours = 'Je regarde.\n\n```cadrage\n{ "analyse": "à mo';
  assert.equal(retirerLaStructureDeCadrage(enCours), 'Je regarde.');
});

test('un bloc de code ordinaire n’est jamais pris pour la structure', () => {
  const texte = 'Exemple :\n\n```json\n{ "a": 1 }\n```';
  assert.equal(retirerLaStructureDeCadrage(texte), texte, 'il reste à l’écran, tel quel');
});
