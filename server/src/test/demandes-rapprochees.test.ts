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
  // La déclaration, plus les trois chemins de fin (tour rendu, fermeture
  // d'autorité, filet de sendPrompt), plus le filet de veille qui reprend la
  // file d'un agent AU REPOS — celle qu'aucune fin de tour ne viendra dépiler.
  assert.equal(enchainements.length, 5, `attendu 5 mentions, trouvé ${enchainements.length}`);
  const filet = RUNTIME.split('const preparation = prochainePreparation++;')[1].split('\nasync function preparerLeTour')[0];
  assert.match(filet, /enchainerLaFile\(agentId\);/, 'le filet de sendPrompt dépile aussi');
});

/* ------------------------------------------------------------------ */
/* Une demande sans quota n'est ni perdue, ni annoncée « Terminé »     */
/* ------------------------------------------------------------------ */

test('le compte se choisit AVANT la bulle de la demande et AVANT la carte', () => {
  const corps = RUNTIME.split('async function preparerLeTour(')[1];
  const compte = corps.indexOf('await pickAccount(agent.run.engine)');
  const bulle = corps.indexOf("role: 'user',");
  const carte = corps.indexOf('replacerCarteAuDemarrage(agent);');
  assert.ok(compte > 0 && bulle > 0 && carte > 0, 'les trois repères doivent exister');
  assert.ok(compte < bulle, 'sans quota, aucune bulle de demande ne doit être écrite');
  assert.ok(
    compte < carte,
    'sans quota, la carte ne doit pas remonter en « En cours » : le balayage la fermerait en « Terminé »',
  );
});

test('sans quota, une demande ORDINAIRE attend en file au lieu d’être perdue', () => {
  const bloc = RUNTIME.split('const account = compteImpose ?? compteChoisi ?? (await pickAccount(agent.run.engine));')[1].split(
    'let userMessageId',
  )[0];
  assert.match(bloc, /const parLaFile = !options\.silent && !options\.onComplete;/);
  assert.match(bloc, /store\.enqueuePrompt\(agentId, text, options\.attachments \?\? \[\]\)/);
});

test('la file d’un agent AU REPOS est reprise, mais seulement quand un compte est disponible', () => {
  const corps = RUNTIME.split('export async function reprendreLesFilesEnAttente(): Promise<void> {')[1].split(
    '\n}',
  )[0];
  assert.match(corps, /if \(live\.has\(agent\.id\) \|\| demarrant\.has\(agent\.id\)\) continue;/);
  assert.match(corps, /if \(!store\.listQueue\(agent\.id\)\.length\) continue;/);
  assert.match(corps, /if \(!compte\) continue;/, 'sans quota, on ne relance aucun tour');
});

test('un nouvel essai après panne emporte le prompt du tour, jamais une consigne nue', () => {
  const bloc = RUNTIME.split('demandeDeRepriseApresPanne({')[1].split('),\n')[0];
  assert.match(bloc, /promptDuTour: prompt,/, 'la demande de CE tour repart avec l’essai');
  assert.match(bloc, /travailCommence:/);
  assert.match(bloc, /filNeuf: !filDuNouvelEssai,/);
  // Les étapes posées par le démon lui-même ne prouvent aucun travail du moteur.
  assert.match(RUNTIME, /cle !== MEMORY_STEP_ID && cle !== ETAPE_PANNE_ID/);
});

/* ------------------------------------------------------------------ */
/* « Muet » veut dire « jamais joint », pas « tombé en travaillant »   */
/* ------------------------------------------------------------------ */

test('« muet » vient du SIGNAL de l’adaptateur, le faisceau d’absences n’étant qu’un repli', () => {
  /*
   * Un moteur qui découpe son travail puis tombe ne crée ni étape ni texte : il
   * était donc pris pour un lancement jamais parti, sa carte repartait en
   * « Planifié » et l'ordonnanceur la relançait de zéro. Constaté par
   * `scripts/verif-cycle-de-vie-carte.mjs`. La réponse n'est plus une
   * déduction : l'adaptateur DIT s'il a lu une ligne du moteur.
   */
  assert.match(RUNTIME, /const jamaisDemarre =\n\s+result\.jamaisDemarre \?\?/);
  assert.match(RUNTIME, /const moteurMuet = !result\.ok && jamaisDemarre;/);
  // Le repli, lui, garde les trois absences — liste de tâches comprise.
  assert.match(
    RUNTIME,
    /\(!etapesDuMoteur\.length && !runState\.text\.trim\(\) && !runState\.todos\.length\)/,
  );
});

test('les trois adaptateurs rendent eux-mêmes le signal « jamais démarré »', () => {
  for (const moteur of ['claude', 'codex', 'cursor']) {
    const source = fs.readFileSync(path.resolve(ICI, `../../src/engines/${moteur}.ts`), 'utf8');
    assert.match(source, /let aParle = false;/, `${moteur} : rien ne note que le moteur a parlé`);
    assert.match(source, /aParle = true;/, `${moteur} : la marque n’est jamais posée`);
    assert.match(source, /jamaisDemarre: !ok && !aParle/, `${moteur} : le signal n’est pas rendu`);
  }
});

test('un processus qui ne se lance même pas rend le signal, sans passer par le démon', () => {
  const fin = fs.readFileSync(path.resolve(ICI, '../../src/engines/fin-de-processus.ts'), 'utf8');
  assert.match(fin, /resolve\(\{ ok: false, error: err\.message, jamaisDemarre: true \}\);/);
});
