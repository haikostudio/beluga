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
  assert.match(debut, /if \(live\.has\(agentId\) \|\| demarrant\.has\(agentId\) \|\| enchainementEnVol\.has\(agentId\)\) return;/);
  assert.match(debut, /store\.dequeuePrompt\(agentId\)/);
});

test('chaque fin de tour enchaîne la file — jusqu’à la préparation qui n’a lancé aucun moteur', () => {
  const enchainements = [...RUNTIME.matchAll(/enchainerLaFile\(/g)];
  // La déclaration, plus les trois chemins de fin (tour rendu, fermeture
  // d'autorité, filet de sendPrompt), plus le filet de veille qui reprend la
  // file d'un agent AU REPOS — celle qu'aucune fin de tour ne viendra dépiler —,
  // plus `reprendreLaFile`, qui la relance quand une demande en attente se
  // referme dans la barre d'écriture (12/10/2026).
  assert.equal(enchainements.length, 6, `attendu 6 mentions, trouvé ${enchainements.length}`);
  const filet = RUNTIME.split('const preparation = prochainePreparation++;')[1].split('\nasync function preparerLeTour')[0];
  assert.match(filet, /enchainerLaFile\(agentId\);/, 'le filet de sendPrompt dépile aussi');
});

/* ------------------------------------------------------------------ */
/* Une demande sans quota n'est ni perdue, ni annoncée « Terminé »     */
/* ------------------------------------------------------------------ */

/*
 * LA DEMANDE S'ÉCRIT AVANT LE COMPTE, LA CARTE NE BOUGE QU'APRÈS.
 *
 * Les deux repères se sont longtemps confondus : on écrivait la bulle après le
 * choix du compte pour ne pas remonter la carte en « En cours » sans quota.
 * Mais écrire une phrase ne déplace aucune carte, et l'attente coûtait des
 * dizaines de secondes d'écran vide. Ce qui doit rester derrière le choix du
 * compte, c'est le TRAVAIL — la carte déplacée, le contexte, le moteur.
 */
test('la demande s’écrit AVANT le choix du compte, la carte ne bouge qu’APRÈS', () => {
  const corps = RUNTIME.split('async function preparerLeTour(')[1];
  const compte = corps.indexOf('await pickAccount(agent.run.engine)');
  const bulle = corps.indexOf("role: 'user',");
  const carte = corps.indexOf("replacerCarteAuDemarrage(agent, options.demandeur ?? (options.silent ? 'automatique' : 'humain'));");
  assert.ok(compte > 0 && bulle > 0 && carte > 0, 'les trois repères doivent exister');
  assert.ok(
    bulle < compte,
    'la demande doit être enregistrée et affichée tout de suite, sans attendre le relevé des quotas',
  );
  assert.ok(
    compte < carte,
    'sans quota, la carte ne doit pas remonter en « En cours » : le balayage la fermerait en « Terminé »',
  );
});

test('la ligne « Demande » du parcours part avec la bulle, pas avec le moteur', () => {
  const corps = RUNTIME.split('async function preparerLeTour(')[1].split('\nasync function')[0];
  assert.match(
    corps,
    /bus\.emit\(\{ type: 'message\.upsert', message: userMessage \}\);\n\s+journaliserLaDemande\(agent, userMessage\);/,
    'le parcours de la carte doit s’ouvrir à la seconde où la demande arrive',
  );
  // …et plus jamais après le lancement du moteur, sans quoi elle s'y doublerait.
  const apresLancement = RUNTIME.split('runState.handle = handle;')[1];
  assert.ok(
    !/libelle: 'Demande',/.test(apresLancement),
    'la demande ne doit plus être journalisée une seconde fois au départ du tour',
  );
});

test('sans quota, une demande ORDINAIRE attend en file au lieu d’être perdue', () => {
  const bloc = RUNTIME.split('const account = compteRetenu ?? (await pickAccount(agent.run.engine));')[1].split(
    'replacerCarteAuDemarrage',
  )[0];
  assert.match(bloc, /const parLaFile = !options\.silent && !options\.onComplete;/);
  assert.match(bloc, /store\.enqueuePrompt\(agentId, text, options\.attachments \?\? \[\], userMessageId\)/);
  assert.match(bloc, /return true;/, 'la préparation doit dire qu’aucun compte n’est disponible');
});

test('une demande revenue de la file ne réécrit pas sa bulle', () => {
  const corps = (RUNTIME.split('function enchainerLaFile(agentId: string): void {')[1].split('\n}')[0] +
    // L'envoi de la demande dépilée vit à part depuis le 04/11/2026 (`enchainementEnVol`).
    RUNTIME.split('function envoyerLaDemandeDepilee(')[1].split('\n}')[0]);
  assert.match(
    corps,
    /messageDejaEcrit: next\.messageId,/,
    'le tour qui dépile doit reprendre la bulle déjà écrite, pas en créer une seconde',
  );
  const prep = RUNTIME.split('async function preparerLeTour(')[1];
  assert.match(
    prep,
    /let userMessageId: string \| undefined = options\.messageDejaEcrit;\n\s+if \(!options\.silent && !userMessageId\) \{/,
    'une demande déjà écrite ne repasse pas par l’écriture',
  );
});

test('une demande mise en file faute de quota n’est pas redémarrée immédiatement', () => {
  const corps = RUNTIME.split('export async function sendPrompt(')[1].split('\nasync function preparerLeTour')[0];
  assert.match(corps, /attendUnQuota = await preparerLeTour\(/);
  assert.match(
    corps,
    /if \(!attendUnQuota\) enchainerLaFile\(agentId\);/,
    'la demande doit attendre le filet de quota au lieu de boucler toutes les 400 ms',
  );
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
  assert.match(fin, /resolve\(\{ ok: false, error: message, jamaisDemarre: true \}\);/);
});

test('un ENOENT sur un dossier disparu ne se lit plus comme un moteur mal installé', () => {
  const fin = fs.readFileSync(path.resolve(ICI, '../../src/engines/fin-de-processus.ts'), 'utf8');
  const bloc = fin.split('function messageDeLancementRate(')[1]?.split('\n}')[0] ?? '';
  assert.ok(bloc, 'messageDeLancementRate doit exister');
  assert.match(bloc, /code === 'ENOENT' && options\.cwd && !existsSync\(options\.cwd\)/);
  assert.match(bloc, /dossier de travail a disparu/, 'l’écran doit dire la VRAIE cause');
  // Les trois moteurs doivent lui donner de quoi juger.
  for (const moteur of ['claude', 'codex', 'cursor']) {
    const source = fs.readFileSync(path.resolve(ICI, `../../src/engines/${moteur}.ts`), 'utf8');
    assert.match(source, /cwd: options\.cwd,/, `${moteur} doit passer son dossier à finDuProcessus`);
  }
});
