import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PROMPT_PRODUCTION_MAX,
  Project,
  baseDeMiseEnProduction,
  ecrireMiseEnProduction,
  environnementDeProduction,
  mentionMiseEnProduction,
  nettoyerPromptGenere,
  promptDeMiseEnProduction,
  promptGenerationMiseEnProduction,
  rappelDeMiseEnProduction,
} from '@haikodev/shared';

/*
 * LE PROMPT DE MISE EN PRODUCTION : un seul endroit, un seul texte.
 *
 * Deux mécanismes coexistaient : une consigne d'environnement que la
 * publication lisait mais que rien ne permettait d'écrire, et une fenêtre par
 * colonne qu'on pouvait remplir mais que personne ne lisait. Les deux sont
 * remplacés par ce réglage, rangé sur le PROJET.
 */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_DEPLOY = fs.readFileSync(path.resolve(ICI, '../../src/deploy.ts'), 'utf8');

/* ------------------------------------------------------------------ */
/* Lire                                                                 */
/* ------------------------------------------------------------------ */

test('un projet sans réglage n’a ni base ni prompt, et ce n’est pas une erreur', () => {
  assert.equal(promptDeMiseEnProduction({}), '');
  assert.equal(promptDeMiseEnProduction(undefined), '');
  assert.equal(baseDeMiseEnProduction({}), '');
  assert.equal(baseDeMiseEnProduction(undefined), '');
});

test('base et prompt se relisent tels qu’écrits, débarrassés de leurs bords', () => {
  const projet = { miseEnProduction: { base: '  mon concept  ', prompt: '  mon prompt  ' } };
  assert.equal(baseDeMiseEnProduction(projet), 'mon concept');
  assert.equal(promptDeMiseEnProduction(projet), 'mon prompt');
});

test('un prompt fait d’espaces vaut un prompt absent', () => {
  assert.equal(promptDeMiseEnProduction({ miseEnProduction: { prompt: '  \n ' } }), '');
});

/* ------------------------------------------------------------------ */
/* Écrire                                                               */
/* ------------------------------------------------------------------ */

test('écrire le prompt seul ne touche PAS à la base, et l’inverse', () => {
  const avant = { base: 'mon concept', prompt: 'mon prompt' };
  const apresPrompt = ecrireMiseEnProduction(avant, { prompt: 'nouveau prompt' });
  assert.equal(apresPrompt.base, 'mon concept');
  assert.equal(apresPrompt.prompt, 'nouveau prompt');

  const apresBase = ecrireMiseEnProduction(avant, { base: 'autre concept' });
  assert.equal(apresBase.base, 'autre concept');
  assert.equal(apresBase.prompt, 'mon prompt');
  // L'objet d'origine n'est pas modifié : deux vérités, jamais.
  assert.equal(avant.prompt, 'mon prompt');
});

test('un texte vide EFFACE la clé au lieu de ranger du vide', () => {
  const apres = ecrireMiseEnProduction({ base: 'a', prompt: 'b' }, { prompt: '   ' });
  assert.equal('prompt' in apres, false);
  assert.equal(promptDeMiseEnProduction({ miseEnProduction: apres }), '');
  assert.equal(apres.base, 'a', 'la base reste');
});

test('un texte trop long est ramené à la longueur permise', () => {
  const apres = ecrireMiseEnProduction({}, { prompt: 'x'.repeat(PROMPT_PRODUCTION_MAX + 500) });
  assert.equal(apres.prompt?.length, PROMPT_PRODUCTION_MAX);
});

test('l’écriture ne garde que les deux clés connues', () => {
  const apres = ecrireMiseEnProduction({ base: 'a', colonne: 'jamais' } as any, { prompt: 'b' });
  assert.deepEqual(Object.keys(apres).sort(), ['base', 'prompt']);
});

/* ------------------------------------------------------------------ */
/* Ce que le projet connaît déjà                                        */
/* ------------------------------------------------------------------ */

test('l’environnement visé est celui de PRODUCTION, jamais le dev', () => {
  const env = environnementDeProduction({
    environments: [
      { id: 'dev', nom: 'Dev client', role: 'dev-client' },
      { id: 'prod', nom: 'Production', role: 'production' },
    ],
  });
  assert.equal(env?.id, 'prod');
});

test('sans environnement de production, on vise le premier de la liste', () => {
  const env = environnementDeProduction({ deployCommand: 'bash publier.sh' });
  assert.equal(env?.nom, 'Interne');
});

test('le rappel nomme l’environnement, sa branche et son adresse', () => {
  const ligne = rappelDeMiseEnProduction({
    environments: [
      { id: 'prod', nom: 'Production', role: 'production', branche: 'release', url: 'https://x.test' },
    ],
  });
  assert.match(ligne, /Production/);
  assert.match(ligne, /« release »/);
  assert.match(ligne, /https:\/\/x\.test/);
});

test('sans branche ni adresse, le rappel le dit — jamais un blanc', () => {
  const ligne = rappelDeMiseEnProduction({});
  assert.match(ligne, /branche principale/);
  assert.match(ligne, /aucune adresse à contrôler/);
});

test('la mention dit l’état du réglage, vide comprise', () => {
  assert.match(mentionMiseEnProduction(''), /Aucun prompt/i);
  assert.match(mentionMiseEnProduction('une ligne\nune autre'), /2 lignes/);
});

/* ------------------------------------------------------------------ */
/* Fabriquer le prompt par un agent                                     */
/* ------------------------------------------------------------------ */

test('le prompt de génération porte la base et le rappel du projet', () => {
  const texte = promptGenerationMiseEnProduction(
    { deployCommand: 'bash publier.sh' },
    'copier le dossier puis relancer',
  );
  assert.match(texte, /copier le dossier puis relancer/);
  assert.match(texte, /Interne/); // le rappel de l'environnement visé
  assert.match(texte, /SEUL texte/i); // rendre uniquement le prompt
});

test('le prompt de génération interdit de déployer et de refaire la plomberie git', () => {
  const texte = promptGenerationMiseEnProduction({}, 'peu importe');
  assert.match(texte, /Tu ne DÉPLOIES rien/);
  assert.match(texte, /tu ne modifies aucun fichier/);
  assert.match(texte, /HaikoDev s’en charge/, 'fusion et envoi ne sont pas son affaire');
});

test('le nettoyage retire un bloc de code qui enveloppe toute la réponse', () => {
  assert.equal(nettoyerPromptGenere('```\nfaire ceci\npuis cela\n```'), 'faire ceci\npuis cela');
  assert.equal(nettoyerPromptGenere('```md\nune ligne\n```'), 'une ligne');
  assert.equal(nettoyerPromptGenere('  déjà propre  '), 'déjà propre');
});

test('le nettoyage borne le prompt généré à la longueur permise', () => {
  assert.equal(nettoyerPromptGenere('y'.repeat(PROMPT_PRODUCTION_MAX + 200)).length, PROMPT_PRODUCTION_MAX);
});

/* ------------------------------------------------------------------ */
/* Ce que le projet range                                               */
/* ------------------------------------------------------------------ */

test('un projet enregistré sans réglage en rend un objet vide, jamais une erreur', () => {
  const projet = Project.parse({
    id: 'p1',
    name: 'Essai',
    path: '/root/essai',
    createdAt: 1,
    updatedAt: 1,
  });
  assert.deepEqual(projet.miseEnProduction, {});
  assert.equal(promptDeMiseEnProduction(projet), '');
});

test('un projet garde base ET prompt après un aller-retour par le modèle', () => {
  const projet = Project.parse({
    id: 'p1',
    name: 'Essai',
    path: '/root/essai',
    createdAt: 1,
    updatedAt: 1,
    miseEnProduction: { base: 'mon concept', prompt: 'mon prompt' },
  });
  const relu = Project.parse(JSON.parse(JSON.stringify(projet)));
  assert.equal(baseDeMiseEnProduction(relu), 'mon concept');
  assert.equal(promptDeMiseEnProduction(relu), 'mon prompt');
});

test('les anciens réglages par colonne ne sont plus rangés nulle part', () => {
  const projet = Project.parse({
    id: 'p1',
    name: 'Essai',
    path: '/root/essai',
    createdAt: 1,
    updatedAt: 1,
    consignesDeploiement: { to_deploy: 'ancienne consigne' },
    basesDeploiement: { to_deploy: 'ancienne base' },
    environments: [{ id: 'prod', nom: 'Production', role: 'production', consigne: 'ancienne' }],
  } as any);
  assert.equal((projet as any).consignesDeploiement, undefined);
  assert.equal((projet as any).basesDeploiement, undefined);
  assert.equal((projet.environments[0] as any).consigne, undefined);
});

/* ------------------------------------------------------------------ */
/* Le branchement dans la publication                                   */
/* ------------------------------------------------------------------ */

test('seule une mise en PRODUCTION lit le prompt : le dev garde ses moyens d’avant', () => {
  const debut = SOURCE_DEPLOY.indexOf('function promptDeLEtape(');
  assert.notEqual(debut, -1, 'un seul endroit doit trancher');
  const corps = SOURCE_DEPLOY.slice(debut, SOURCE_DEPLOY.indexOf('\n}\n', debut));
  assert.match(corps, /cible === 'dev' \? '' : promptDeMiseEnProduction\(project\)/);
});

test('le plan de publication reçoit le prompt de l’étape, jamais un autre texte', () => {
  assert.match(SOURCE_DEPLOY, /const promptProduction = promptDeLEtape\(project, etape\.cible\);/);
  assert.match(
    SOURCE_DEPLOY,
    /moyensDuProjet\(project\.path, environnement, project\.isSelf, promptProduction\)/,
  );
});

test('la commande de génération ne persiste ni ne déploie rien', () => {
  const source = fs.readFileSync(path.resolve(ICI, '../../src/mise-en-production.ts'), 'utf8');
  assert.match(source, /role: 'deploy'/);
  assert.match(source, /template: 'none'/, 'la dernière réponse EST le prompt');
  assert.doesNotMatch(source, /saveProject|startDeploy/, 'générer n’écrit rien et ne publie rien');
});
