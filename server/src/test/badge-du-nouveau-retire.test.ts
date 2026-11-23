import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEXTES_TRADUITS } from '@beluga/shared/traductions';

/* ------------------------------------------------------------------ */
/* LE BADGE « DU NOUVEAU » A QUITTÉ LA VIGNETTE D'UNE DEMANDE          */
/*                                                                     */
/* La vignette portait DEUX repères bleus : le compte des messages non */
/* lus, en haut à droite, et une pastille « Du nouveau » qui disait la  */
/* même chose en moins précis. Le compte reste seul, des deux côtés —  */
/* espace client comme vue de Haiko, qui partagent la même vignette.   */
/* ------------------------------------------------------------------ */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const VIGNETTE = path.resolve(ICI, '../../../web/src/espace/vignette-demande.tsx');
const RESUME = path.resolve(ICI, '../../../shared/src/espace-client.ts');
const CONTROLE = path.resolve(ICI, '../../../scripts/verif-espace-client.mjs');

test('la vignette ne porte plus le badge « Du nouveau »', () => {
  const source = fs.readFileSync(VIGNETTE, 'utf8');
  assert.doesNotMatch(source, /data-nouveaute-vignette/, 'le repère du badge a disparu');
  assert.doesNotMatch(source, /Sparkles/, 'ni l’icône qui n’était là que pour lui');
  // Le badge bleu des non-lus, lui, reste seul en haut à droite.
  assert.match(source, /resume\.nonLus/, 'le compte des non-lus est toujours lu');
});

test('les textes du badge retiré ont quitté le dictionnaire', () => {
  // LE DICTIONNAIRE NE GARDE QUE DES TEXTES RÉELLEMENT AFFICHÉS : une clé
  // orpheline se traduit en cinq langues pour personne.
  for (const cle of ['Du nouveau', 'Du nouveau depuis votre dernière visite']) {
    assert.equal(TEXTES_TRADUITS.includes(cle), false, `« ${cle} » ne se traduit plus`);
  }
});

test('le résumé d’une demande ne calcule plus ce que personne n’affiche', () => {
  const source = fs.readFileSync(RESUME, 'utf8');
  assert.doesNotMatch(source, /nouveautes/, 'le champ a quitté le protocole du résumé');
});

test('le contrôle navigateur prouve l’absence AVEC son porteur à l’écran', () => {
  /*
   * UN CONTRÔLE D'ABSENCE QUI PASSE PARCE QUE L'ÉCRAN EST VIDE NE PROUVE RIEN :
   * celui-ci compte d'abord les vignettes, puis les badges.
   */
  const source = fs.readFileSync(CONTROLE, 'utf8');
  assert.match(source, /vignettes: document\.querySelectorAll\('\[data-demande\]'\)\.length/);
  assert.match(source, /compte\.vignettes > 0 && compte\.badges === 0/);
});
