import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COLONNES_CONSIGNE,
  CONSIGNE_MAX,
  Project,
  baseDeploiement,
  consigneDeploiement,
  ecrireBaseDeploiement,
  ecrireConsigneDeploiement,
  estColonneDeConsigne,
  mentionConsigne,
  nettoyerConsigneGeneree,
  promptGenerationConsigne,
  rappelDeConsigne,
  titreDeConsigne,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Quelles colonnes portent une consigne                                */
/* ------------------------------------------------------------------ */

test('seules « À déployer » et « En production » portent une consigne', () => {
  assert.deepEqual([...COLONNES_CONSIGNE], ['to_deploy', 'in_production']);
  assert.equal(estColonneDeConsigne('to_deploy'), true);
  assert.equal(estColonneDeConsigne('in_production'), true);
  for (const colonne of ['notes', 'todo', 'validated', 'planned', 'running', 'done', 'archived'] as const) {
    assert.equal(estColonneDeConsigne(colonne), false, colonne);
  }
});

test('le titre de la fenêtre nomme la colonne comme à l’écran', () => {
  assert.equal(titreDeConsigne('to_deploy'), 'Déploiement depuis « À déployer »');
  assert.equal(titreDeConsigne('in_production'), 'Déploiement depuis « En production »');
});

/* ------------------------------------------------------------------ */
/* Lire une consigne                                                    */
/* ------------------------------------------------------------------ */

test('un projet sans réglage n’a aucune consigne, et ce n’est pas une erreur', () => {
  assert.equal(consigneDeploiement({}, 'to_deploy'), '');
  assert.equal(consigneDeploiement(undefined, 'in_production'), '');
});

test('la consigne se relit telle qu’écrite, débarrassée de ses bords', () => {
  const projet = { consignesDeploiement: { to_deploy: '  bâtir puis copier  ' } };
  assert.equal(consigneDeploiement(projet, 'to_deploy'), 'bâtir puis copier');
});

test('une consigne faite d’espaces vaut une consigne absente', () => {
  assert.equal(consigneDeploiement({ consignesDeploiement: { to_deploy: '   \n ' } }, 'to_deploy'), '');
});

/* ------------------------------------------------------------------ */
/* Écrire une consigne                                                  */
/* ------------------------------------------------------------------ */

test('écrire une consigne ne touche PAS à celle de l’autre étape', () => {
  const avant = { to_deploy: 'dev : copier le dossier' };
  const apres = ecrireConsigneDeploiement(avant, 'in_production', 'production : passer par le service');
  assert.equal(apres.to_deploy, 'dev : copier le dossier');
  assert.equal(apres.in_production, 'production : passer par le service');
  // L'objet d'origine n'est pas modifié : deux vérités, jamais.
  assert.equal((avant as any).in_production, undefined);
});

test('une consigne vide EFFACE la clé au lieu de ranger du vide', () => {
  const apres = ecrireConsigneDeploiement({ to_deploy: 'quelque chose' }, 'to_deploy', '   ');
  assert.equal('to_deploy' in apres, false);
  assert.equal(consigneDeploiement({ consignesDeploiement: apres }, 'to_deploy'), '');
});

test('une consigne trop longue est ramenée à la longueur permise', () => {
  const apres = ecrireConsigneDeploiement({}, 'to_deploy', 'x'.repeat(CONSIGNE_MAX + 500));
  assert.equal(apres.to_deploy?.length, CONSIGNE_MAX);
});

test('l’écriture ne garde que les deux colonnes connues', () => {
  const apres = ecrireConsigneDeploiement(
    { to_deploy: 'a', in_production: 'b', done: 'jamais' } as any,
    'to_deploy',
    'c',
  );
  assert.deepEqual(Object.keys(apres).sort(), ['in_production', 'to_deploy']);
});

/* ------------------------------------------------------------------ */
/* La base de texte, à côté de la consigne                              */
/* ------------------------------------------------------------------ */

test('la base se lit et s’écrit comme la consigne, sans toucher l’autre étape', () => {
  const avant = { to_deploy: 'brouillon dev' };
  const apres = ecrireBaseDeploiement(avant, 'in_production', '  brouillon prod  ');
  assert.equal(apres.to_deploy, 'brouillon dev');
  assert.equal(apres.in_production, 'brouillon prod');
  assert.equal(baseDeploiement({ basesDeploiement: apres }, 'in_production'), 'brouillon prod');
});

test('une base vide EFFACE la clé, comme la consigne', () => {
  const apres = ecrireBaseDeploiement({ to_deploy: 'quelque chose' }, 'to_deploy', '   ');
  assert.equal('to_deploy' in apres, false);
});

test('base et consigne sont deux objets distincts sur le projet', () => {
  const projet = {
    basesDeploiement: { to_deploy: 'ma base' },
    consignesDeploiement: { to_deploy: 'ma consigne' },
  };
  assert.equal(baseDeploiement(projet, 'to_deploy'), 'ma base');
  assert.equal(consigneDeploiement(projet, 'to_deploy'), 'ma consigne');
});

/* ------------------------------------------------------------------ */
/* Le prompt de génération et le nettoyage du rendu                     */
/* ------------------------------------------------------------------ */

test('le prompt de génération porte la base, l’étape et le rappel du projet', () => {
  const prompt = promptGenerationConsigne(
    { deployCommand: 'bash publier.sh' },
    'to_deploy',
    'construire puis copier',
  );
  assert.match(prompt, /À déployer/);
  assert.match(prompt, /construire puis copier/);
  assert.match(prompt, /Interne/); // le rappel de l'environnement visé
  assert.match(prompt, /SEUL texte/i); // consigne : rendre uniquement la consigne
});

test('le nettoyage retire un bloc de code qui enveloppe toute la réponse', () => {
  assert.equal(nettoyerConsigneGeneree('```\nfaire ceci\npuis cela\n```'), 'faire ceci\npuis cela');
  assert.equal(nettoyerConsigneGeneree('```md\nune ligne\n```'), 'une ligne');
  assert.equal(nettoyerConsigneGeneree('  déjà propre  '), 'déjà propre');
});

test('le nettoyage borne la consigne générée à la longueur permise', () => {
  assert.equal(nettoyerConsigneGeneree('y'.repeat(CONSIGNE_MAX + 200)).length, CONSIGNE_MAX);
});

/* ------------------------------------------------------------------ */
/* Ce que la fenêtre rappelle                                           */
/* ------------------------------------------------------------------ */

test('le rappel nomme l’environnement visé et la branche principale par défaut', () => {
  const ligne = rappelDeConsigne({ deployCommand: 'bash publier.sh' });
  assert.match(ligne, /Interne/);
  assert.match(ligne, /interne/);
  assert.match(ligne, /branche principale/);
});

test('le rappel nomme la branche installée quand elle est déclarée', () => {
  const ligne = rappelDeConsigne({
    environments: [{ id: 'prod', nom: 'Production', role: 'production', branche: 'release' }],
  });
  assert.match(ligne, /Production/);
  assert.match(ligne, /« release »/);
});

test('avec plusieurs environnements, le rappel dit lequel est visé par défaut', () => {
  const ligne = rappelDeConsigne({
    environments: [
      { id: 'dev', nom: 'Dev client', role: 'dev-client' },
      { id: 'prod', nom: 'Production', role: 'production' },
    ],
  });
  assert.match(ligne, /Dev client/);
  assert.match(ligne, /2 environnements/);
});

test('la mention dit l’état de la consigne, vide comprise', () => {
  assert.match(mentionConsigne(''), /déroulé habituel/i);
  assert.match(mentionConsigne('une ligne\nune autre'), /2 lignes/);
});

/* ------------------------------------------------------------------ */
/* Ce que le projet range                                               */
/* ------------------------------------------------------------------ */

test('un projet enregistré sans consigne en rend un objet vide, jamais une erreur', () => {
  const projet = Project.parse({
    id: 'p1',
    name: 'Essai',
    path: '/root/essai',
    createdAt: 1,
    updatedAt: 1,
  });
  assert.deepEqual(projet.consignesDeploiement, {});
  assert.deepEqual(projet.basesDeploiement, {});
  assert.equal(consigneDeploiement(projet, 'to_deploy'), '');
  assert.equal(baseDeploiement(projet, 'to_deploy'), '');
});

test('un projet garde base ET consigne après un aller-retour par le modèle', () => {
  const projet = Project.parse({
    id: 'p1',
    name: 'Essai',
    path: '/root/essai',
    createdAt: 1,
    updatedAt: 1,
    basesDeploiement: { to_deploy: 'base dev' },
    consignesDeploiement: { to_deploy: 'consigne dev' },
  });
  const relu = Project.parse(JSON.parse(JSON.stringify(projet)));
  assert.equal(baseDeploiement(relu, 'to_deploy'), 'base dev');
  assert.equal(consigneDeploiement(relu, 'to_deploy'), 'consigne dev');
});

test('un projet garde ses deux consignes après un aller-retour par le modèle', () => {
  const projet = Project.parse({
    id: 'p1',
    name: 'Essai',
    path: '/root/essai',
    createdAt: 1,
    updatedAt: 1,
    consignesDeploiement: { to_deploy: 'consigne dev', in_production: 'consigne prod' },
  });
  const relu = Project.parse(JSON.parse(JSON.stringify(projet)));
  assert.equal(consigneDeploiement(relu, 'to_deploy'), 'consigne dev');
  assert.equal(consigneDeploiement(relu, 'in_production'), 'consigne prod');
});
