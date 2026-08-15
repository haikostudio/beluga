import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEBUT_PROCEDURE,
  DIALOGUE_FRAIS_MS,
  FIN_PROCEDURE,
  baseDeLaProcedure,
  issueDuTour,
  libelleInitier,
  libelleReglages,
  lireReponseDeProcedure,
  mentionProcedure,
  phraseDeTravail,
  procedureDeLEtape,
  procedureEnPlace,
  promptOuvertureProcedure,
  promptReponseProcedure,
  refusSansProcedure,
  repriseDuDialogue,
  titreDeLaProcedure,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* LA PROCÉDURE DE MISE EN LIGNE SE DÉFINIT, ELLE NE SE DEVINE PLUS     */
/*                                                                      */
/* Un projet neuf n'arrive avec AUCUNE procédure : ni déploiement, ni    */
/* mise en production. Tant qu'elle est vide, la colonne propose de      */
/* l'INITIER, et rien ne part. Les projets d'avant portent le marqueur   */
/* « constaté » (migration 22) : leur déroulé ne bouge pas d'un signe.   */
/* ------------------------------------------------------------------ */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_DEPLOY = fs.readFileSync(path.resolve(ICI, '../../src/deploy.ts'), 'utf8');
const SOURCE_TIROIR = fs.readFileSync(path.resolve(ICI, '../../src/procedure-publication.ts'), 'utf8');
const SOURCE_BLOC = fs.readFileSync(path.resolve(ICI, '../../../web/src/components/deploy-panel.tsx'), 'utf8');
const SOURCE_TABLEAU = fs.readFileSync(path.resolve(ICI, '../../../web/src/components/board.tsx'), 'utf8');
const SOURCE_MIGRATIONS = fs.readFileSync(path.resolve(ICI, '../../src/db.ts'), 'utf8');
const SOURCE_WS = fs.readFileSync(path.resolve(ICI, '../../src/ws.ts'), 'utf8');
const SOURCE_PANNEAU = fs.readFileSync(
  path.resolve(ICI, '../../../web/src/components/procedure-panel.tsx'),
  'utf8',
);

/* ------------------------------------------------------------------ */
/* Une procédure est-elle en place ?                                    */
/* ------------------------------------------------------------------ */

test('un projet NEUF n’a de procédure ni pour l’une ni pour l’autre étape', () => {
  assert.equal(procedureEnPlace({}, 'dev'), false);
  assert.equal(procedureEnPlace({}, 'production'), false);
  assert.equal(procedureEnPlace(undefined, 'dev'), false);
  assert.equal(procedureEnPlace({ deploiement: {}, miseEnProduction: {} }, 'dev'), false);
});

test('un projet d’AVANT, marqué « constaté », garde son déploiement', () => {
  const ancien = { deploiement: { constate: true } };
  assert.equal(procedureEnPlace(ancien, 'dev'), true);
  // Constaté = aucun texte à suivre : c'est le déroulé d'avant, mot pour mot.
  assert.equal(procedureDeLEtape(ancien, 'dev'), '');
});

test('une procédure écrite met l’étape en place, et elle seule', () => {
  const projet = { deploiement: { prompt: 'Copier le dossier, relancer le service.' } };
  assert.equal(procedureEnPlace(projet, 'dev'), true);
  assert.equal(procedureEnPlace(projet, 'production'), false, 'l’une ne vaut jamais pour l’autre');
  assert.equal(procedureDeLEtape(projet, 'dev'), 'Copier le dossier, relancer le service.');
  assert.equal(procedureDeLEtape(projet, 'production'), '');
});

test('la mise en production est en place par son prompt OU par un type de cible choisi', () => {
  assert.equal(procedureEnPlace({ miseEnProduction: { prompt: 'Publier chez le client.' } }, 'production'), true);
  assert.equal(procedureEnPlace({ miseEnProduction: { type: 'ssh' } }, 'production'), true);
  assert.equal(procedureEnPlace({ miseEnProduction: { type: 'aucune' } }, 'production'), true);
  // « consigne » sans prompt, c'est l'état d'un projet qui n'a rien défini.
  assert.equal(procedureEnPlace({ miseEnProduction: { type: 'consigne' } }, 'production'), false);
});

test('un texte fait d’espaces n’est pas une procédure', () => {
  assert.equal(procedureEnPlace({ deploiement: { prompt: '   \n ' } }, 'dev'), false);
  assert.equal(procedureEnPlace({ miseEnProduction: { prompt: ' ' } }, 'production'), false);
});

test('la réponse de l’utilisateur est gardée à côté de la procédure', () => {
  const projet = { deploiement: { base: 'Comme HaikoDev, sur ce serveur.', prompt: 'Construire puis relancer.' } };
  assert.equal(baseDeLaProcedure(projet, 'dev'), 'Comme HaikoDev, sur ce serveur.');
  assert.equal(baseDeLaProcedure(projet, 'production'), '');
});

/* ------------------------------------------------------------------ */
/* Les mots de l'écran                                                  */
/* ------------------------------------------------------------------ */

test('chaque étape a son titre, son bouton et son refus, jamais ceux de l’autre', () => {
  assert.equal(titreDeLaProcedure('dev'), 'Déploiement');
  assert.equal(titreDeLaProcedure('production'), 'Mise en production');
  assert.equal(libelleInitier('dev'), 'Initier le déploiement');
  assert.equal(libelleInitier('production'), 'Initier la mise en production');
  assert.match(libelleReglages('dev'), /déploiement/);
  assert.match(libelleReglages('production'), /mise en production/);
});

test('le refus sans procédure renvoie au bouton qui l’initie, en tête de colonne', () => {
  const refus = refusSansProcedure('dev');
  assert.match(refus, /Aucune procédure de déploiement/);
  assert.match(refus, /Initier le déploiement/);
  assert.match(refus, /tête de la colonne/);
  assert.match(refusSansProcedure('production'), /Initier la mise en production/);
});

test('l’état de la procédure se dit en une ligne, vide comme pleine', () => {
  assert.match(mentionProcedure('dev', ''), /Aucune procédure/);
  assert.match(mentionProcedure('dev', 'une ligne\nune autre'), /2 lignes/);
});

/* ------------------------------------------------------------------ */
/* Le dialogue avec l'agent                                             */
/* ------------------------------------------------------------------ */

test('le premier tour POSE la question et n’écrit aucune procédure', () => {
  const prompt = promptOuvertureProcedure('dev', { projet: 'Essai', dossier: '/root/essai' });
  assert.match(prompt, /DÉPLOIEMENT/);
  assert.match(prompt, /instance de TRAVAIL/, 'l’agent doit savoir de quelle étape il parle');
  assert.doesNotMatch(prompt, /MISE EN PRODUCTION met le code chez le CLIENT/);
  assert.match(prompt, /Va LIRE le projet/);
  assert.match(prompt, /Ne rends AUCUN bloc de procédure/);
});

test('le tour de production parle du client, jamais de l’instance de dev', () => {
  const prompt = promptOuvertureProcedure('production', { projet: 'Essai', dossier: '/root/essai' });
  assert.match(prompt, /chez le CLIENT/);
  assert.match(prompt, /closes puis archivées/);
  assert.doesNotMatch(prompt, /instance de TRAVAIL/);
});

test('rouvrir pour MODIFIER donne à l’agent la procédure déjà en place', () => {
  const prompt = promptOuvertureProcedure('dev', {
    projet: 'Essai',
    dossier: '/root/essai',
    actuelle: 'Construire puis relancer le service.',
  });
  assert.match(prompt, /procédure actuelle/);
  assert.match(prompt, /Construire puis relancer le service\./);
  assert.match(prompt, /MODIFIER/);
});

test('le tour de réponse demande la procédure entre ses deux repères', () => {
  const prompt = promptReponseProcedure('production', 'Sur le serveur du client, par SSH.');
  assert.match(prompt, /Sur le serveur du client, par SSH\./);
  assert.ok(prompt.includes(DEBUT_PROCEDURE) && prompt.includes(FIN_PROCEDURE));
  assert.match(prompt, /aucune manœuvre git de fusion ou d’envoi/);
});

test('sans repères, la réponse de l’agent est une QUESTION', () => {
  const lue = lireReponseDeProcedure('Où le site est-il servi ?');
  assert.equal(lue.question, 'Où le site est-il servi ?');
  assert.equal(lue.procedure, undefined);
});

test('avec ses repères, la réponse est la PROCÉDURE — même précédée d’une phrase', () => {
  const lue = lireReponseDeProcedure(
    `Voici ce que je retiens.\n${DEBUT_PROCEDURE}\n1. Construire.\n2. Copier.\n${FIN_PROCEDURE}`,
  );
  assert.equal(lue.procedure, '1. Construire.\n2. Copier.');
  assert.equal(lue.question, undefined);
});

test('un bloc VIDE n’est pas une procédure : la réponse reste une question', () => {
  const lue = lireReponseDeProcedure(`${DEBUT_PROCEDURE}\n\n${FIN_PROCEDURE}`);
  assert.equal(lue.procedure, undefined);
  assert.ok(lue.question);
});

/* ------------------------------------------------------------------ */
/* LE TOUR NE SE LIVRE PLUS PAR LA RÉPONSE D'UNE REQUÊTE                */
/*                                                                      */
/* Un tour dure une à deux minutes. Tant qu'il se livrait par la réponse */
/* d'une commande, la question — déjà payée — se perdait dès qu'on       */
/* refermait le tiroir, qu'on rechargeait la page ou que le lien         */
/* clignait, et l'écran restait sur « L'agent travaille… ».             */
/* ------------------------------------------------------------------ */

test('l’issue d’un tour est toujours dite : question, procédure, ou raison', () => {
  assert.deepEqual(issueDuTour({ contenu: 'Où le site est-il servi ?', statut: 'done' }), {
    question: 'Où le site est-il servi ?',
  });
  assert.deepEqual(
    issueDuTour({ contenu: `${DEBUT_PROCEDURE}\n1. Construire.\n${FIN_PROCEDURE}`, statut: 'done' }),
    { procedure: '1. Construire.' },
  );
});

test('un tour qui ne rend RIEN ne laisse jamais le témoin allumé', () => {
  const vide = issueDuTour({ contenu: '   ', statut: 'done' });
  assert.match('raison' in vide ? vide.raison : '', /n’a rien rendu/);

  const arrete = issueDuTour({ contenu: 'à moitié écrit', statut: 'stopped' });
  assert.match('raison' in arrete ? arrete.raison : '', /« stopped »/);

  const panne = issueDuTour({ erreur: 'quota' });
  assert.match('raison' in panne ? panne.raison : '', /quota/);
});

test('rouvrir le tiroir se raccroche au tour qui tourne, il n’en paie pas un second', () => {
  const enCours = { projectId: 'p', cible: 'dev' as const, enCours: true, echanges: [], depuis: 1000 };
  assert.equal(repriseDuDialogue(enCours, 5000), 'attendre');
});

test('une question posée pendant que le tiroir était fermé se RELIT, elle n’est pas perdue', () => {
  const pose = {
    projectId: 'p',
    cible: 'dev' as const,
    enCours: false,
    echanges: [{ qui: 'agent' as const, texte: 'Comment cela doit-il se passer ?' }],
    depuis: 1000,
  };
  assert.equal(repriseDuDialogue(pose, 1000 + DIALOGUE_FRAIS_MS - 1), 'reprendre');
  // Trop vieille : le projet a pu changer, on repose la question.
  assert.equal(repriseDuDialogue(pose, 1000 + DIALOGUE_FRAIS_MS + 1), 'relancer');
});

test('un échec ne se rejoue pas tout seul, et une procédure écrite clôt le dialogue', () => {
  const rate = { projectId: 'p', cible: 'dev' as const, enCours: false, echanges: [], raison: 'quota' };
  assert.equal(repriseDuDialogue(rate, 0), 'reprendre', 'un tour coûte : c’est le bouton qui relance');
  const finie = {
    projectId: 'p',
    cible: 'dev' as const,
    enCours: false,
    echanges: [{ qui: 'agent' as const, texte: 'écrite' }],
    procedure: '1. Construire.',
    depuis: 0,
  };
  assert.equal(repriseDuDialogue(finie, 0), 'proposer', 'le dialogue a abouti : rien ne se repaie');
  assert.equal(repriseDuDialogue(null, 0), 'relancer');
});

/* ------------------------------------------------------------------ */
/* L'ICÔNE DE RÉGLAGES NE PAIE PLUS UN AGENT À CHAQUE CLIC             */
/*                                                                      */
/* Avec une procédure DÉJÀ en place, chaque clic relançait un agent      */
/* complet : il relisait tout le projet (une à deux minutes) pour        */
/* reposer depuis le début une question déjà tranchée. Le tiroir montre  */
/* désormais ce qui existe et attend un geste.                          */
/* ------------------------------------------------------------------ */

test('une procédure DÉJÀ écrite ne fait partir aucun tour à l’ouverture', () => {
  // Aucun dialogue en mémoire (le cas normal : ils ne survivent pas au démon).
  assert.equal(repriseDuDialogue(null, 0, true), 'proposer', 'on montre, on ne demande pas');
  assert.equal(repriseDuDialogue(null, 0, false), 'relancer', 'sans procédure, l’initiation part');
  // Un dialogue trop vieux ne relance pas non plus quand la procédure existe.
  const vieux = {
    projectId: 'p',
    cible: 'dev' as const,
    enCours: false,
    echanges: [{ qui: 'agent' as const, texte: 'Comment cela doit-il se passer ?' }],
    depuis: 1000,
  };
  assert.equal(repriseDuDialogue(vieux, 1000 + DIALOGUE_FRAIS_MS + 1, true), 'proposer');
  assert.equal(repriseDuDialogue(vieux, 1000 + DIALOGUE_FRAIS_MS + 1, false), 'relancer');
});

test('une question de l’outil, posée tiroir fermé, se RELIT au lieu de se repayer', () => {
  const pose = {
    projectId: 'p',
    cible: 'dev' as const,
    enCours: false,
    echanges: [],
    depuis: 1000,
    question: { messageId: 'm1', questionId: 'q1', texte: 'Quel service redémarrer ?', options: [] },
  };
  assert.equal(repriseDuDialogue(pose, 1000 + DIALOGUE_FRAIS_MS - 1, true), 'reprendre');
  // L'instant du tour n'est donc PAS effacé à la fin : sans lui, tout paraît vieux.
  const corps = SOURCE_TIROIR.slice(SOURCE_TIROIR.indexOf('async function mener'));
  assert.doesNotMatch(corps, /depuis: undefined/, 'l’instant du tour survit à sa fin');
});

test('le tiroir écrit la procédure DEPUIS une demande de modification, sans redemander', () => {
  assert.match(SOURCE_TIROIR, /promptModificationProcedure/);
  assert.match(SOURCE_TIROIR, /const dialogueEnCours = /, 'la session vivante décide du prompt');
  assert.match(SOURCE_PANNEAU, /data-reposer-question/, 'reposer la question reste un geste');
  assert.match(SOURCE_PANNEAU, /repriseDuDialogue\(res\?\.etat \?\? null, Date\.now\(\), !!actuelle\)/);
});

/* ------------------------------------------------------------------ */
/* LA QUESTION DE L'AGENT S'AFFICHE DANS LE TIROIR, ET S'Y RÉPOND      */
/*                                                                      */
/* `ask_user` arrête le tour jusqu'à la réponse : la question partait    */
/* dans la cloche du bandeau et nulle part dans le tiroir ouvert         */
/* dessous, qui restait sur « L'agent travaille… ».                     */
/* ------------------------------------------------------------------ */

test('la question ouverte de l’agent voyage dans l’état du dialogue', () => {
  assert.match(SOURCE_TIROIR, /function questionDeLAgent/);
  assert.match(SOURCE_TIROIR, /!q\.answer && !q\.cancelled/, 'seule une question sans réponse attend');
  assert.match(SOURCE_TIROIR, /bus\.subscribe/, 'le tiroir l’apprend tout de suite');
  const debut = SOURCE_TIROIR.indexOf('export function etatDeProcedure');
  const corps = SOURCE_TIROIR.slice(debut, SOURCE_TIROIR.indexOf('\n}\n', debut));
  assert.match(corps, /questionDeLAgent/, 'relue à chaque lecture : une coupure ne la perd pas');
});

test('on répond à la question DANS le tiroir, sans payer un tour de plus', () => {
  assert.match(SOURCE_PANNEAU, /data-question-procedure/);
  assert.match(SOURCE_PANNEAU, /type: 'question\.answer'/, 'la réponse va à l’appel d’outil arrêté');
  const corps = SOURCE_PANNEAU.slice(
    SOURCE_PANNEAU.indexOf('const repondreALaQuestion'),
    SOURCE_PANNEAU.indexOf('const envoyer'),
  );
  assert.doesNotMatch(corps, /procedure\.tour/, 'répondre ne relance jamais un tour');
  assert.match(SOURCE_PANNEAU, /disabled=\{\(enCours && !question\) \|\| !saisie\.trim\(\)\}/);
});

test('le témoin dit ce que l’agent fait et depuis quand, jamais un mot seul', () => {
  assert.equal(phraseDeTravail({ depuis: 1000 }, 43000), 'L’agent travaille… 42 s');
  assert.equal(
    phraseDeTravail({ depuis: 1000, etape: 'Lecture de scripts/haikodev.service' }, 91000),
    'L’agent travaille… Lecture de scripts/haikodev.service · 1 min 30 s',
  );
});

test('le tour part en FOND et son issue est diffusée, jamais rendue à une requête retenue', () => {
  // La commande rend l'état tout de suite : rien n'attend le moteur.
  assert.match(SOURCE_TIROIR, /export function tourDeProcedure/, 'plus une commande qui attend le tour');
  assert.match(SOURCE_TIROIR, /void mener\(etat, prompt, reponse\)/);
  assert.match(SOURCE_TIROIR, /bus\.emit\(\{ type: 'procedure', etat \}\)/);
  // Chaque sortie de `mener` repose un état : aucun chemin ne laisse `enCours`.
  const debut = SOURCE_TIROIR.indexOf('async function mener');
  const corps = SOURCE_TIROIR.slice(debut);
  assert.equal((corps.match(/poser\(\{/g) ?? []).length, 4, 'les quatre issues reposent l’état');
  assert.match(corps, /enCours: false/);
});

test('un tour DÉJÀ en cours n’est jamais doublé, et un agent occupé n’est pas repris', () => {
  assert.match(SOURCE_TIROIR, /if \(courant\?\.enCours\) return courant/);
  assert.match(SOURCE_TIROIR, /agentsActifs\(\)\.includes\(precedent\.id\)/);
});

test('l’état se demande SANS lancer de tour : c’est ce qui rattrape un tour perdu', () => {
  assert.match(SOURCE_WS, /case 'procedure\.etat':/);
  assert.match(SOURCE_WS, /etat: etatDeProcedure\(cmd\.projectId, cmd\.cible\)/);
  const debut = SOURCE_TIROIR.indexOf('export function etatDeProcedure');
  assert.notEqual(debut, -1);
  assert.doesNotMatch(SOURCE_TIROIR.slice(debut, SOURCE_TIROIR.indexOf('\n}\n', debut)), /sendPrompt/);
});

test('le témoin du tiroir suit le SEUL champ « enCours », pas une requête en attente', () => {
  assert.match(SOURCE_PANNEAU, /const enCours = !!etat\?\.enCours/);
  assert.match(SOURCE_PANNEAU, /\{enCours \? \(/, 'le témoin ne s’allume que là');
  assert.doesNotMatch(SOURCE_PANNEAU, /setBusy/, 'plus aucun témoin tenu par une promesse');
  assert.match(SOURCE_PANNEAU, /data-relancer-procedure/, 'un échec se relance à la main');
  assert.match(SOURCE_PANNEAU, /RAISON_TOUR_PERDU/, 'un tour disparu se dit');
});

/* ------------------------------------------------------------------ */
/* Le branchement                                                       */
/* ------------------------------------------------------------------ */

test('le tiroir n’écrit que la cible d’où il vient, jamais l’autre', () => {
  const debut = SOURCE_TIROIR.indexOf('export function enregistrerProcedure');
  assert.notEqual(debut, -1, 'un seul endroit doit écrire');
  const corps = SOURCE_TIROIR.slice(debut, SOURCE_TIROIR.indexOf('\n}\n', debut));
  assert.match(corps, /cible === 'dev'/);
  assert.match(corps, /deploiement: \{/);
  assert.match(corps, /miseEnProduction: \{/);
  // Le type de cible et les accès SSH/FTP déjà réglés ne sont pas balayés.
  assert.match(corps, /\.\.\.projet\.miseEnProduction/);
});

test('le tiroir mène un tour d’agent et n’en lance aucun tout seul', () => {
  assert.match(SOURCE_TIROIR, /role: 'deploy'/);
  assert.match(SOURCE_TIROIR, /template: 'none'/, 'la réponse EST la question ou la procédure');
  assert.doesNotMatch(SOURCE_TIROIR, /startDeploy/, 'définir une procédure ne publie rien');
});

test('startDeploy refuse les DEUX étapes sans procédure, avant la file d’attente', () => {
  const refus = SOURCE_DEPLOY.indexOf('if (!procedureEnPlace(project, etape.cible))');
  const file = SOURCE_DEPLOY.indexOf('if (active.has(projectId))');
  assert.notEqual(refus, -1, 'le refus doit être écrit noir sur blanc');
  assert.ok(refus < file, 'on refuse avant même de mettre en file');
  assert.match(SOURCE_DEPLOY.slice(refus, refus + 160), /refusSansProcedure\(etape\.cible\)/);
});

test('la migration 22 marque « constaté » les projets déjà inscrits, et eux seuls', () => {
  const debut = SOURCE_MIGRATIONS.indexOf('id: 22,');
  assert.notEqual(debut, -1, 'la migration doit exister');
  const corps = SOURCE_MIGRATIONS.slice(debut, debut + 1400);
  assert.match(corps, /UPDATE projects/);
  assert.match(corps, /"constate":true/);
  assert.match(corps, /json_extract\(data, '\$\.deploiement'\) IS NULL/, 'une clé déjà écrite n’est pas écrasée');
});

/* ------------------------------------------------------------------ */
/* L'écran                                                              */
/* ------------------------------------------------------------------ */

test('sans procédure, le bloc ne montre QUE le bouton qui l’initie', () => {
  const debut = SOURCE_BLOC.indexOf('if (!enPlace) {');
  assert.notEqual(debut, -1, 'le bloc doit trancher avant de dessiner le bouton d’action');
  const corps = SOURCE_BLOC.slice(debut, debut + 900);
  assert.match(corps, /BoutonInitierProcedure/);
  assert.doesNotMatch(corps, /data-bouton-publication/, 'aucun bouton « Tout … » tant que rien n’est défini');
  assert.doesNotMatch(corps, /data-chevron-process/, 'aucun déroulé à montrer non plus');
});

test('l’icône de réglages ne paraît qu’une fois la procédure en place', () => {
  // Le dernier emploi, pas la ligne d'import : c'est celui qui dessine.
  const debut = SOURCE_TABLEAU.lastIndexOf('<BoutonReglagesProcedure');
  assert.notEqual(debut, -1);
  const avant = SOURCE_TABLEAU.slice(Math.max(0, debut - 400), debut);
  assert.match(avant, /procedureEnPlace\(projetOuvert, etapeCol\.cible\)/);
});

test('le tiroir est unique et porte la cible de la colonne d’où il s’ouvre', () => {
  assert.match(SOURCE_TABLEAU, /<TiroirProcedure/);
  assert.match(SOURCE_TABLEAU, /cible=\{procedureOuverte\}/);
  assert.match(SOURCE_TABLEAU, /setProcedureOuverte\(etapeCol\.cible\)/);
});
