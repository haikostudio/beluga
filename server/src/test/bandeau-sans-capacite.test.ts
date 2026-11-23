import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEXTES_TRADUITS } from '@beluga/shared/traductions';

/* ------------------------------------------------------------------ */
/* LE BOUTON « N PLACES » A QUITTÉ LE BANDEAU DU HAUT                   */
/*                                                                     */
/* La capacité du système — agents en cours, places libres, mémoire —  */
/* se lit ENTIÈRE dans les réglages. Un compteur de plus dans la barre */
/* du haut ne servait à personne : il occupait une place voisine de la */
/* cloche et du menu, et n'ouvrait qu'un écran déjà atteignable.       */
/* ------------------------------------------------------------------ */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const BANDEAU = path.resolve(ICI, '../../../web/src/components/quota-bar.tsx');
const REGLAGES = path.resolve(ICI, '../../../web/src/components/settings-view.tsx');
/* Les réglages sont passés en modale : chaque page vit dans son module, chargé
   à l'ouverture. La jauge de capacité est donc à lire dans SA page, pendant que
   l'écran des réglages garde l'entrée qui y mène. */
const PAGE_CAPACITE = path.resolve(ICI, '../../../web/src/components/reglages/page-capacite.tsx');
const PAGE_SERVEUR = path.resolve(ICI, '../../../web/src/components/reglages/page-serveur.tsx');

test('le bandeau du haut ne lit plus la capacité du système', () => {
  const source = fs.readFileSync(BANDEAU, 'utf8');
  assert.doesNotMatch(source, /state\.capacity/, 'le bandeau ne consulte plus la capacité');
  assert.doesNotMatch(source, /\{v0\} place/, 'ni le libellé « N places »');
  assert.doesNotMatch(source, /agent\(s\) en cours/, 'ni l’infobulle qui l’accompagnait');
});

test('la capacité reste lisible en entier dans les réglages', () => {
  // Retirer le raccourci ne retire pas l'information : c'est un déplacement,
  // jamais une perte.
  // Depuis le 06/11/2026, la capacité vit dans la page « Serveur », et
  // l'ancienne adresse « capacite » y mène — par les alias de l'arborescence partagée depuis la refonte en rubriques
  // (21/11/2026).
  const alias = fs.readFileSync(path.resolve(ICI, '../../../shared/src/reglages-arborescence.ts'), 'utf8');
  assert.match(alias, /capacite: 'serveur'/, 'l’ancienne page « Capacité » mène à la page « Serveur »');
  const serveur = fs.readFileSync(PAGE_SERVEUR, 'utf8');
  assert.match(serveur, /page-capacite/, 'la page « Serveur » montre la capacité du système');
  const page = fs.readFileSync(PAGE_CAPACITE, 'utf8');
  assert.match(page, /state\.capacity/, 'la jauge complète vit toujours dans cette page');
});

test('les textes du bouton retiré ont quitté le dictionnaire', () => {
  // Le dictionnaire ne garde aucune clé orpheline : un texte qui ne s'affiche
  // plus nulle part se retire en même temps que ce qui l'affichait.
  for (const cle of [
    '{v0} place',
    '{v0} places',
    '{v0} agent(s) en cours · {v1} peuvent encore démarrer · mémoire {v2}/{v3} Go',
  ]) {
    assert.equal(TEXTES_TRADUITS.includes(cle), false, `« ${cle} » ne se traduit plus`);
  }
});
