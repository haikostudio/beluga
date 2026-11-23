/**
 * LE GARDE-FOU DES CHARTES SUR LE DÉPÔT ENTIER : aucun élément interdit par une
 * charte de `docs/chartes/` dans les fichiers qu'elle couvre (aucun `<select>`,
 * aucune case, date, curseur ou couleur natifs dans `web/src`, hors des
 * composants maison). Même règle que la porte de fin de tour des agents
 * (`shared/src/chartes.ts`), mais sur TOUT le code : c'est elle qui aurait
 * arrêté la liste et le champ couleur natifs des Plaquettes (05/11/2026).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { controlerLesInterdits, lireCharte, texteDesManquements, PLAFOND_D_UNE_CHARTE } from '@beluga/shared';

const RACINE = path.resolve(import.meta.dirname, '..');
const DOSSIER = path.join(RACINE, 'docs/chartes');

const chartes = fs.existsSync(DOSSIER)
  ? fs
      .readdirSync(DOSSIER)
      .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
      .map((f) => lireCharte(f.slice(0, -3), fs.readFileSync(path.join(DOSSIER, f), 'utf8')))
  : [];

test('chaque charte du dépôt se lit et tient sous son plafond', () => {
  assert.ok(chartes.length > 0, 'aucune charte dans docs/chartes');
  for (const c of chartes) {
    assert.ok(c, 'une charte sans entête lisible');
    assert.ok(c.corps.length <= PLAFOND_D_UNE_CHARTE, `la charte « ${c.nom} » fait ${c.corps.length} signes (plafond ${PLAFOND_D_UNE_CHARTE})`);
  }
});

test('aucun élément interdit par une charte dans le code suivi', () => {
  const suivis = execFileSync('git', ['ls-files', '-z'], { cwd: RACINE, encoding: 'utf8' })
    .split('\0')
    .filter((f) => /\.(tsx|jsx|ts|js|vue|svelte|html|astro)$/.test(f) && fs.existsSync(path.join(RACINE, f)));
  const fichiers = suivis.map((chemin) => ({ chemin, contenu: fs.readFileSync(path.join(RACINE, chemin), 'utf8') }));
  const manquements = controlerLesInterdits(chartes.filter(Boolean), fichiers);
  assert.equal(manquements.length, 0, `éléments interdits par la charte :\n${texteDesManquements(manquements)}`);
});
