import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dateDeMiseEnLignePerimee,
  libelleCompteLot,
  raisonLotBloque,
} from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* La DATE DE MISE EN LIGNE périmée : le bogue du « Tout déployer » muet */
/* ------------------------------------------------------------------ */

test('une carte repassée d’« Archivé » à « À déployer » perd sa date', () => {
  assert.equal(dateDeMiseEnLignePerimee('archived', 'to_deploy'), true);
});

test('une carte qui revient de « En cours » vers « À déployer » perd sa date', () => {
  // Le cas réel : la carte avait été déployée, elle a été retravaillée, puis
  // reposée dans le lot. Sa vieille date l'écartait de tous les lots suivants.
  assert.equal(dateDeMiseEnLignePerimee('running', 'to_deploy'), true);
});

test('une carte qui QUITTE « À déployer » garde sa date de mise en ligne', () => {
  assert.equal(dateDeMiseEnLignePerimee('to_deploy', 'archived'), false);
  assert.equal(dateDeMiseEnLignePerimee('to_deploy', 'running'), false);
});

test('un rangement sur place ne périme rien', () => {
  assert.equal(dateDeMiseEnLignePerimee('to_deploy', 'to_deploy'), false);
});

/* ------------------------------------------------------------------ */
/* Le bouton éteint DIT pourquoi                                       */
/* ------------------------------------------------------------------ */

test('un lot prêt à partir n’a rien à expliquer', () => {
  assert.equal(raisonLotBloque({ verbe: 'déployer', aPublier: 2, cartesDansLaColonne: 2 }), null);
});

test('le lien coupé passe devant tout', () => {
  const raison = raisonLotBloque({
    verbe: 'déployer',
    aPublier: 3,
    cartesDansLaColonne: 3,
    horsLigne: true,
    autrePublication: true,
  });
  assert.match(raison ?? '', /lien avec le serveur est coupé/);
});

test('une mise en production sans prompt rend sa propre phrase', () => {
  const raison = raisonLotBloque({
    verbe: 'publier',
    aPublier: 4,
    cartesDansLaColonne: 4,
    productionBloquee: 'Aucun prompt de mise en production n’est réglé pour ce projet.',
    autrePublication: true,
  });
  assert.equal(raison, 'Aucun prompt de mise en production n’est réglé pour ce projet.');
});

test('une publication déjà en cours passe devant les agents', () => {
  const raison = raisonLotBloque({
    verbe: 'déployer',
    aPublier: 1,
    cartesDansLaColonne: 1,
    autrePublication: true,
    agentsOccupes: ['refonte du tableau'],
  });
  assert.match(raison ?? '', /déjà en cours/);
});

test('un agent au travail est nommé', () => {
  const raison = raisonLotBloque({
    verbe: 'déployer',
    aPublier: 1,
    cartesDansLaColonne: 1,
    agentsOccupes: ['refonte du tableau'],
  });
  assert.match(raison ?? '', /refonte du tableau/);
});

test('des cartes présentes mais toutes écartées : la cause est nommée', () => {
  // Exactement le bogue constaté : deux cartes dans la colonne, lot vide.
  const raison = raisonLotBloque({ verbe: 'déployer', aPublier: 0, cartesDansLaColonne: 2 });
  assert.match(raison ?? '', /2 cartes sont dans cette colonne/);
  assert.match(raison ?? '', /date de mise en ligne/);
});

test('une colonne vraiment vide le dit simplement', () => {
  const raison = raisonLotBloque({ verbe: 'déployer', aPublier: 0, cartesDansLaColonne: 0 });
  assert.match(raison ?? '', /Rien à déployer/);
});

test('le verbe suit l’étape', () => {
  const raison = raisonLotBloque({ verbe: 'publier', aPublier: 0, cartesDansLaColonne: 0 });
  assert.match(raison ?? '', /Rien à publier/);
});

/* ------------------------------------------------------------------ */
/* Le chiffre du bouton s'explique sans lire la ligne du bas          */
/* ------------------------------------------------------------------ */

test('cinq cartes cochées et cinq changements sans carte : les deux parts sont nommées', () => {
  assert.equal(libelleCompteLot(5, 5), '5 + 5 sans carte');
});

test('aucun changement sans carte : le chiffre seul suffit', () => {
  assert.equal(libelleCompteLot(3, 0), '3');
});

test('rien que du travail sans carte : nommé, pas un chiffre nu', () => {
  assert.equal(libelleCompteLot(0, 2), '2 sans carte');
});

test('rien du tout : zéro', () => {
  assert.equal(libelleCompteLot(0, 0), '0');
});

/* ------------------------------------------------------------------ */
/* « Déployer » au pied d'une carte : la même règle que le démon        */
/* ------------------------------------------------------------------ */

import {
  agentRetientLaPublication,
  raisonDeployerDepuisLaCarte,
  RAISON_SANS_PROCEDURE_DE_DEPLOIEMENT,
} from '@beluga/shared';

const baseCarte = {
  procedureEnPlace: true,
  publicationEnCours: false,
  agents: [] as { title?: string; status?: string; tourVivantDepuis?: number }[],
  cartesDuLot: 2,
  cartesDansLaColonne: 2,
};

test('un agent qui tourne, démarre ou garde un tour vivant retient la publication', () => {
  assert.equal(agentRetientLaPublication({ status: 'running' }), true);
  assert.equal(agentRetientLaPublication({ status: 'starting' }), true);
  assert.equal(agentRetientLaPublication({ status: 'done', tourVivantDepuis: 1 }), true);
  assert.equal(agentRetientLaPublication({ status: 'done' }), false);
  assert.equal(agentRetientLaPublication({ status: 'idle' }), false);
});

test('le bouton de la carte part quand tout est arrêté', () => {
  assert.equal(
    raisonDeployerDepuisLaCarte({ ...baseCarte, agents: [{ title: 'Fini', status: 'done' }] }),
    null,
  );
});

test('le bouton de la carte s’éteint tant qu’un agent du projet travaille, et le nomme', () => {
  const raison = raisonDeployerDepuisLaCarte({ ...baseCarte, agents: [{ title: 'Refonte', status: 'running' }] });
  assert.match(raison ?? '', /« Refonte » travaille encore/);
});

test('le bouton de la carte s’éteint pendant une publication du projet', () => {
  assert.match(raisonDeployerDepuisLaCarte({ ...baseCarte, publicationEnCours: true }) ?? '', /déjà en cours/);
});

test('sans procédure de déploiement, le bouton de la carte le dit', () => {
  assert.equal(
    raisonDeployerDepuisLaCarte({ ...baseCarte, procedureEnPlace: false }),
    RAISON_SANS_PROCEDURE_DE_DEPLOIEMENT,
  );
});

test('hors ligne, le lien coupé passe devant tout', () => {
  assert.match(
    raisonDeployerDepuisLaCarte({ ...baseCarte, procedureEnPlace: false, horsLigne: true }) ?? '',
    /lien avec le serveur est coupé/,
  );
});
