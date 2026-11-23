import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decisionDePlanOuverte, travailDeLaCarteDejaLance } from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* UNE DEMANDE QUI N'EST JAMAIS PARTIE NE MEURT PLUS EN SILENCE        */
/* ------------------------------------------------------------------ */

/*
 * Le 05.09.2026, deux tours sont morts avant même le lancement de leur moteur
 * (préparation restée bloquée, fermée d'autorité au bout de cinq minutes). Les
 * deux demandes de l'utilisateur sont restées au fil sous une phrase grise :
 * aucun triangle, aucun bouton, rien à faire à part les retaper. Un tour tombé
 * APRÈS le moteur, lui, posait depuis longtemps ses trois issues.
 *
 * Le mot de blocage porte donc la MÊME décision, et il emporte l'identifiant de
 * la demande jamais partie : « Relancer » la RENVOIE au lieu de demander à
 * l'agent de poursuivre un travail qui n'a pas commencé.
 */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME = fs.readFileSync(path.join(ICI, '../../src/runtime.ts'), 'utf8');
const ERREUR = fs.readFileSync(path.join(ICI, '../../src/erreur-de-tour.ts'), 'utf8');

const DIRE_LE_BLOCAGE = RUNTIME.split('function direLeBlocage')[1]?.split('\n}')[0] ?? '';

test('le mot de blocage porte une décision, pas seulement un constat', () => {
  assert.ok(DIRE_LE_BLOCAGE, 'direLeBlocage doit exister');
  assert.match(DIRE_LE_BLOCAGE, /erreurDeTour: \{ cause: raison/);
  assert.match(DIRE_LE_BLOCAGE, /poserDecisionErreurDeTour\(/, 'le triangle orange s’allume aussi');
});

test('…et il emporte la demande restée sans réponse', () => {
  assert.match(DIRE_LE_BLOCAGE, /demandeARejouer/);
  assert.match(
    DIRE_LE_BLOCAGE,
    /dernier\?\.role === 'user'/,
    'la demande perdue est le dernier message du fil, écrit par l’utilisateur',
  );
});

test('« Relancer » renvoie la demande perdue, avec sa bulle déjà écrite', () => {
  const bloc = ERREUR.split("if (choix === 'relancer')")[1]?.split('\n  }')[0] ?? '';
  assert.ok(bloc, 'la branche « relancer » doit exister');
  assert.match(bloc, /erreur\.demandeARejouer/);
  assert.match(bloc, /messageDejaEcrit: perdue\.id/, 'on reprend la bulle, on n’en écrit pas une seconde');
  assert.match(
    bloc,
    /consigneDeRelanceApresErreur\(agent, erreur\.cause\)/,
    'et un tour qui avait DÉMARRÉ reçoit la consigne de reprise, qui nomme ce qui est déjà fait',
  );
  assert.match(
    bloc,
    /poursuite: true/,
    'sans ce drapeau, le nouveau tour repartirait avec une liste de tâches VIDE',
  );
});

test('la consigne de relance reprend celle d’une carte interrompue', () => {
  const bloc = ERREUR.split('function consigneDeRelanceApresErreur(')[1]?.split('\n}')[0] ?? '';
  assert.ok(bloc, 'consigneDeRelanceApresErreur doit exister');
  assert.match(bloc, /consigneDeReprise\(\{/, 'le même bloc que le bouton « Reprendre »');
  assert.match(bloc, /etapes,/, 'les étapes du tour coupé voyagent avec');
  assert.match(
    bloc,
    /\.reverse\(\)\.find\(\(message\) => message\.todos\.length\)/,
    'on remonte au dernier tour qui portait une liste, plutôt que de rendre un vide',
  );
});

/* ------------------------------------------------------------------ */
/* UN PLAN DÉJÀ EXÉCUTÉ NE SE DÉCIDE PLUS                              */
/* ------------------------------------------------------------------ */

const WEB = path.join(ICI, '../../../web/src/components');

test('le SEUL cadre de plan qui reste passe par la règle', () => {
  /*
   * L'ancien mode plan avait DEUX cadres — celui du fil (`PlanBlock`) et celui
   * du flux en points — et ils devaient fermer leur décision ensemble. Le
   * premier est parti avec le mode : il ne reste que le flux en points, et
   * c'est lui qui juge.
   */
  const parcours = fs.readFileSync(path.join(WEB, 'parcours-carte.tsx'), 'utf8');
  assert.match(parcours, /decisionDePlanOuverte\(/, 'le bloc du flux en points juge par la règle');
  assert.match(parcours, /data-plan-deja-lance/, 'et il DIT pourquoi les boutons ont disparu');

  // Et plus rien n'ouvre de cadre décidable dans le FIL des messages.
  const vue = fs.readFileSync(path.join(WEB, 'message-view.tsx'), 'utf8');
  assert.doesNotMatch(vue, /PlanBlock/, 'l’ancien cadre du fil n’existe plus');
});

test('une carte encore au cadrage garde la décision de son plan', () => {
  assert.equal(
    decisionDePlanOuverte({
      estCourant: true,
      colonne: 'planned',
      agentDeLaCarte: 'cadrage-1',
      agentDuPlan: 'cadrage-1',
    }),
    true,
  );
});

test('une version périmée ne se décide pas, quoi qu’il arrive', () => {
  assert.equal(decisionDePlanOuverte({ estCourant: false, colonne: 'planned' }), false);
});

test('un travail lancé ferme la décision — par la colonne', () => {
  for (const colonne of ['running', 'to_deploy', 'archived']) {
    assert.equal(travailDeLaCarteDejaLance({ colonne }), true, colonne);
    assert.equal(decisionDePlanOuverte({ estCourant: true, colonne }), false, colonne);
  }
});

test('…par le code déjà enregistré', () => {
  assert.equal(travailDeLaCarteDejaLance({ colonne: 'planned', codeDejaEnregistre: true }), true);
});

test('…et par l’agent de tâche qui a pris la carte des mains du cadrage', () => {
  // Le cas vécu : carte revenue en « Planifié » après un rapport rendu, mais
  // tenue par l'agent de tâche — le plan proposait toujours « Valider ».
  assert.equal(
    travailDeLaCarteDejaLance({
      colonne: 'planned',
      agentDuPlan: 'cadrage-1',
      agentDeLaCarte: 'tache-1',
    }),
    true,
  );
});

test('sans agent connu, on ne présume rien', () => {
  assert.equal(travailDeLaCarteDejaLance({ colonne: 'planned' }), false);
  assert.equal(travailDeLaCarteDejaLance({ colonne: 'planned', agentDuPlan: 'cadrage-1' }), false);
});

/* ------------------------------------------------------------------ */
/* UN SCRIPT OUVRE LA BASE RÉELLEMENT SERVIE                           */
/* ------------------------------------------------------------------ */

test('les contrôles de tous les jours passent par la base servie, jamais un nom en dur', () => {
  const scripts = path.join(ICI, '../../../scripts');
  for (const nom of [
    'verify-ui.mjs',
    'verif-langues.mjs',
    'verif-themes.mjs',
    'verif-coffre-des-comptes.mjs',
    'nettoyer-essais.mjs',
  ]) {
    const source = fs.readFileSync(path.join(scripts, nom), 'utf8');
    assert.match(source, /cheminDeLaBaseServie/, nom);
    assert.doesNotMatch(source, /'[^']*\/beluga\.db'/, `${nom} ne doit plus nommer la base à la main`);
  }
});
