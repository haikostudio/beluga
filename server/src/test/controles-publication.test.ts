import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPARATIONS_MAX } from '../deploy.js';

/* ------------------------------------------------------------------ */
/* Les contrôles de la publication : à jour, et réparés sur-le-champ    */
/* ------------------------------------------------------------------ */

/*
 * Deux défauts se répondaient, et la publication ne passait plus.
 *
 * 1. L'étape « verify » lance `npm test`, qui lit `server/dist` — le code
 *    COMPILÉ, que l'étape SUIVANTE seule reconstruisait. Elle jugeait donc le
 *    dist du dernier lancement du démon, jamais le lot fraîchement fusionné :
 *    un correctif déjà écrit échouait indéfiniment.
 * 2. Un contrôle tombé rendait la main à l'utilisateur, qui devait ouvrir une
 *    carte, la lancer, la clôturer, puis relancer la mise en ligne — tout le
 *    parcours refait pour une réparation de plomberie.
 *
 * Le refus, lui, ne bouge pas : après `REPARATIONS_MAX` passes sans succès, la
 * publication échoue toujours en NOMMANT ce qui tombe.
 */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.resolve(ICI, '../../src/deploy.ts'), 'utf8');

/** Le corps de la fonction qui lance les contrôles du projet. */
function corpsDeControlerLeProjet(): string {
  const debut = SOURCE.indexOf('async function controlerLeProjet');
  assert.notEqual(debut, -1, 'la publication doit passer par `controlerLeProjet`');
  const fin = SOURCE.indexOf('\n}', debut);
  return SOURCE.slice(debut, fin);
}

test('les contrôles portent sur du code recompilé, jamais sur le dist du démon', () => {
  const corps = corpsDeControlerLeProjet();
  const compilation = corps.indexOf('npm run build:server');
  const controles = corps.indexOf('npm test');
  assert.notEqual(compilation, -1, 'la compilation doit précéder les contrôles');
  assert.notEqual(controles, -1, 'les contrôles du projet restent `npm test`');
  assert.ok(compilation < controles, '`npm run build:server` doit passer AVANT `npm test`');
});

test('une compilation qui échoue arrête là : les contrôles ne sont pas lancés à vide', () => {
  const corps = corpsDeControlerLeProjet();
  assert.match(corps, /if \(!compile\.ok\) return \{ ok: false, etape: 'compilation'/);
});

test('la sortie des contrôles est gardée ENTIÈRE, sinon le nom du contrôle tombé disparaît', () => {
  const corps = corpsDeControlerLeProjet();
  const appels = corps.match(/runCommand\([^;]*?\)/gs) ?? [];
  assert.equal(appels.length, 2, 'la compilation et les contrôles, et rien d’autre');
  for (const appel of appels) {
    assert.match(appel, /Infinity/, 'chaque sortie doit être gardée en entier (dernier argument `signesGardes`)');
  }
});

test('un contrôle tombé appelle un agent de publication, jusqu’à REPARATIONS_MAX passes', () => {
  assert.ok(REPARATIONS_MAX >= 1, 'au moins une réparation tentée');
  assert.ok(REPARATIONS_MAX <= 5, 'jamais une boucle sans fin : la publication doit finir par rendre la main');
  assert.match(SOURCE, /for \(let passe = 1; !verify\.ok && passe <= REPARATIONS_MAX; passe\+\+\)/);
  assert.match(SOURCE, /const repare = await reparerLesControles\(project\.id, cwd, verify, passe\)/);
  // Une passe qui n'a même pas pu lancer son agent ne se rejoue pas indéfiniment.
  assert.match(SOURCE, /if \(!repare\.tente\) break;/);
});

test('l’agent de réparation n’a pas le droit de faire taire un contrôle', () => {
  const debut = SOURCE.indexOf('async function reparerLesControles');
  assert.notEqual(debut, -1);
  const consigne = SOURCE.slice(debut, SOURCE.indexOf('\n}\n', debut));
  assert.match(consigne, /Ne supprime, ne désactive et ne mets en commentaire AUCUN test/);
  assert.match(consigne, /rends-le stable/, 'un contrôle instable se stabilise, il ne se retire pas');
  assert.match(consigne, /Ne publie pas, ne redémarre rien/);
  assert.match(consigne, /jamais `git add -A`/, 'le dossier du projet est partagé');
});

test('le refus final ne bouge pas : il nomme ce qui tombe et ne met rien en ligne', () => {
  assert.match(SOURCE, /if \(!verify\.ok\) throw new Error\(phraseDEchec\(verify\.out\)\);/);
  assert.match(SOURCE, /detailDEchec\(verify\.out\)/);
});
