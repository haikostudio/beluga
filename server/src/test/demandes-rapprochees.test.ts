import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------ */
/* DEUX DEMANDES TROP RAPPROCHÉES SE SUIVENT, ELLES NE SE DOUBLENT PAS.*/
/*                                                                     */
/* La fenêtre de PRÉPARATION d'un tour (choix du compte, recherche dans */
/* la documentation, copie de travail) dure plusieurs secondes. Une     */
/* demande écrite pendant ce temps ouvrait un tour PAR-DESSUS, et le    */
/* jeton de préparation faisait abandonner le premier — bulle affichée, */
/* aucune réponse, aucune trace visible.                               */
/* ------------------------------------------------------------------ */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME = fs.readFileSync(path.resolve(ICI, '../../src/runtime.ts'), 'utf8');

test('un agent EN PRÉPARATION est occupé : la demande suivante s’empile', () => {
  assert.match(
    RUNTIME,
    /if \(live\.has\(agentId\) \|\| demarrant\.has\(agentId\)\) \{\n\s+const queued = store\.enqueuePrompt\(/,
    'sendPrompt doit empiler dès qu’une préparation court, pas seulement quand un moteur tourne',
  );
});

test('la file n’est dépilée qu’en UN endroit, et jamais par-dessus un tour vivant', () => {
  const appels = [...RUNTIME.matchAll(/store\.dequeuePrompt\(/g)];
  assert.equal(appels.length, 1, 'un seul dépilage dans tout le démon');
  const corps = RUNTIME.split('function enchainerLaFile(agentId: string): void {')[1];
  assert.ok(corps, 'enchainerLaFile doit exister');
  const debut = corps.split('\n}')[0];
  assert.match(debut, /if \(live\.has\(agentId\) \|\| demarrant\.has\(agentId\)\) return;/);
  assert.match(debut, /store\.dequeuePrompt\(agentId\)/);
});

test('chaque fin de tour enchaîne la file — jusqu’à la préparation qui n’a lancé aucun moteur', () => {
  const enchainements = [...RUNTIME.matchAll(/enchainerLaFile\(/g)];
  // La déclaration, plus les trois chemins de fin : tour rendu, fermeture
  // d'autorité, et le filet de sendPrompt.
  assert.equal(enchainements.length, 4, `attendu 4 mentions, trouvé ${enchainements.length}`);
  const filet = RUNTIME.split('const preparation = prochainePreparation++;')[1].split('\nasync function preparerLeTour')[0];
  assert.match(filet, /enchainerLaFile\(agentId\);/, 'le filet de sendPrompt dépile aussi');
});

test('un nouvel essai après panne emporte le prompt du tour, jamais une consigne nue', () => {
  const bloc = RUNTIME.split('demandeDeRepriseApresPanne({')[1].split('),\n')[0];
  assert.match(bloc, /promptDuTour: prompt,/, 'la demande de CE tour repart avec l’essai');
  assert.match(bloc, /travailCommence:/);
  assert.match(bloc, /filNeuf: !filDuNouvelEssai,/);
  // Les étapes posées par le démon lui-même ne prouvent aucun travail du moteur.
  assert.match(RUNTIME, /cle !== MEMORY_STEP_ID && cle !== ETAPE_PANNE_ID/);
});
