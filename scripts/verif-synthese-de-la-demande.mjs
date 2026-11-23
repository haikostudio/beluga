#!/usr/bin/env node
/*
 * LA SYNTHÈSE DE LA DEMANDE S'AFFICHE AVANT LA FIN DU TOUR.
 *
 * Le point « Demande » du fil empruntait son résumé à la compréhension écrite
 * en TOUTE FIN de tour : il disait donc « Votre demande est notée. » pendant
 * tout le travail de l'agent. Ce contrôle rejoue le tour de cadrage par son
 * VRAI chemin d'écriture — l'outil `board_update_card` —, et s'arrête juste
 * après les deux premiers gestes, avant toute compréhension :
 *
 *  1. LE GESTE 1 PASSE AVANT LA MÉMOIRE : titre + synthèse, en un seul appel,
 *     sans qu'une seule unité de mémoire ait été ouverte.
 *  2. LE FIL MONTRE LA SYNTHÈSE ALORS QUE LE TOUR TOURNE ENCORE — c'est toute
 *     la demande : plus aucune phrase passe-partout pendant le travail.
 *  3. L'ÉCRAN LA REÇOIT SANS RECHARGEMENT : le jalon enrichi est REDIFFUSÉ sur
 *     le canal temps réel, et la liste affichée le remplace au lieu de
 *     l'écarter comme doublon.
 *  4. LES AUTRES GARDE-FOUS TIENNENT : au même instant, une description ou un
 *     niveau restent refusés.
 *  5. LE DEUXIÈME ÉCHANGE A SA PROPRE SYNTHÈSE, distincte de la première.
 *  6. UNE CARTE D'AVANT NE CHANGE PAS D'APPARENCE : sans synthèse sur son
 *     jalon, elle repasse par l'emprunt à la compréhension.
 *
 * AUCUN MOTEUR N'EST APPELÉ et aucune base réelle n'est touchée : base jetable,
 * appels d'outils joués en direct. Aucun quota n'est dépensé.
 *
 *   npm run build:server && node scripts/verif-synthese-de-la-demande.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Le dépôt d'où PART ce script, jamais un chemin en dur. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'beluga-synthese-demande-'));
process.env.BELUGA_DATA = dossier;

const echecs = [];
function verifier(condition, message) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    console.error(`  ✗ ${message}`);
    echecs.push(message);
  }
}

const partage = await import(path.join(RACINE, 'shared/dist/index.js'));
const store = await import(path.join(RACINE, 'server/dist/store.js'));
const journalCarte = await import(path.join(RACINE, 'server/dist/journal-carte.js'));
const outils = await import(path.join(RACINE, 'server/dist/tools.js'));
const { bus } = await import(path.join(RACINE, 'server/dist/bus.js'));

const { PHRASES_DU_POINT, fusionnerEntreeJournal, pointsDuParcours } = partage;
const PHRASE_FIXE = PHRASES_DU_POINT.demande.fait;

const maintenant = Date.now();
const PROJET = 'projet-synthese';
const CARTE = 'carte-synthese';
const AGENT = 'agent-cadrage-synthese';

store.saveProject({
  id: PROJET,
  name: 'Projet d’essai',
  path: path.join(dossier, 'depot'),
  createdAt: maintenant,
  updatedAt: maintenant,
});

store.saveCard({
  id: CARTE,
  projectId: PROJET,
  /* La carte porte le titre ÉCLAIR tiré de la phrase : il est PROVISOIRE, et le
     verrou du geste 1 ne le prend donc pas pour un titre donné. */
  title: 'Je veux un résumé sous le point Demande',
  titreProvisoire: true,
  description: '',
  labels: [],
  column: 'planned',
  position: 1,
  origin: 'user',
  attachments: [],
  run: { engine: 'claude', thinking: 'none', mode: 'direct' },
  scheduling: { asap: false, attempts: 1, restarts: 0 },
  createdAt: maintenant,
  updatedAt: maintenant,
});

/** Ce que l'écran a reçu du canal temps réel, dans l'ordre. */
const recus = [];
bus.subscribe((evenement) => {
  if (evenement.type === 'journal.entree') recus.push(evenement.entree);
});

const contexte = { agentId: AGENT, projectId: PROJET, cardId: CARTE, role: 'cadrage' };

/** Le jalon « Demande », écrit par le démon à la seconde où la phrase arrive. */
function poserLaDemande(messageId, texte) {
  return journalCarte.ajouterAuJournal({
    cardId: CARTE,
    phase: 'cadrage',
    nature: 'jalon',
    libelle: 'Demande',
    agentId: AGENT,
    agentRole: 'cadrage',
    resultat: texte,
    donnees: { messageId, ecriteLe: Date.now(), pieces: ['/data/attachments/capture.png'] },
  });
}

/** Le jalon « Tour lancé » : à partir d'ici, le tour TOURNE. */
function poserLeTour(tourId) {
  return journalCarte.ajouterAuJournal({
    cardId: CARTE,
    phase: 'cadrage',
    nature: 'jalon',
    libelle: 'Tour lancé',
    agentId: AGENT,
    agentRole: 'cadrage',
    tourId,
    donnees: { moteur: 'claude' },
  });
}

/** Le fil tel que l'écran le dessine, tour EN COURS. */
function filDeLaCarte(entrees) {
  return pointsDuParcours(entrees, {
    colonne: 'planned',
    chapitre: 'cadrage',
    tourEnCours: true,
    creeeA: maintenant,
  });
}

const demande = (points, rang) => points.find((p) => p.etape === 'demande' && p.rang === rang);

/* ------------------------------------------------------------------ */
console.log('\n1. LE GESTE 1 : titre et synthèse, avant toute lecture de mémoire');
/* ------------------------------------------------------------------ */

poserLaDemande('m1', 'Pourquoi je n’ai pas la synthèse sous chaque point ?');
poserLeTour('T1');

/* Le fil AVANT le geste de l'agent : la phrase passe-partout, comme sur la
   capture qui a ouvert cette carte. */
const avant = filDeLaCarte(journalCarte.entreesDuJournal(CARTE));
verifier(demande(avant, 1)?.resume === undefined, 'avant le geste, le point « Demande » n’a pas de résumé');
verifier(demande(avant, 1)?.phrase === PHRASE_FIXE, 'il dit la phrase passe-partout');

verifier(store.consultationsDeLAgent(AGENT).ouvertures === 0, 'aucune mémoire n’a encore été ouverte');

const SYNTHESE_1 = 'Vous demandez que le fil affiche une synthèse de votre message dès son envoi, sous le point « Demande ».';
const geste1 = await outils.callTool(contexte, 'board_update_card', {
  cardId: CARTE,
  title: 'Résumé sous le point Demande',
  resumeDemande: SYNTHESE_1,
});
verifier(geste1.ok, 'le geste 1 est accepté avant la mémoire');
verifier(
  geste1.ok && geste1.text.includes('synthèse'),
  'l’outil confirme à l’agent que la synthèse est affichée',
);
verifier(store.getCard(CARTE)?.title === 'Résumé sous le point Demande', 'le titre de l’agent remplace le provisoire');

/* ------------------------------------------------------------------ */
console.log('\n2. LE FIL MONTRE LA SYNTHÈSE PENDANT QUE LE TOUR TOURNE');
/* ------------------------------------------------------------------ */

const entreesApresGeste1 = journalCarte.entreesDuJournal(CARTE);
verifier(
  entreesApresGeste1.length === 2,
  'le journal n’a pas gagné de ligne : le jalon est ENRICHI, pas doublé',
);
const pendantLeTour = filDeLaCarte(entreesApresGeste1);
verifier(demande(pendantLeTour, 1)?.resume === SYNTHESE_1, 'le point « Demande » affiche la synthèse rédigée');
verifier(
  !pendantLeTour.some((point) => point.etape === 'comprehension' && point.etat === 'fait'),
  'et rien n’a encore été compris : le tour n’est pas fini',
);

const jalonEnrichi = entreesApresGeste1.find((e) => e.libelle === 'Demande');
const donnees = JSON.parse(jalonEnrichi?.donnees ?? '{}');
verifier(donnees.messageId === 'm1', 'le message reste rattaché au jalon');
verifier(
  Array.isArray(donnees.pieces) && donnees.pieces.length === 1,
  'la capture déposée avec la phrase ne disparaît pas du point',
);

/* ------------------------------------------------------------------ */
console.log('\n3. L’ÉCRAN LA REÇOIT SANS RECHARGEMENT');
/* ------------------------------------------------------------------ */

const diffuse = recus.filter((e) => e.id === jalonEnrichi?.id);
verifier(diffuse.length === 1, 'le jalon enrichi est REDIFFUSÉ sur le canal temps réel');

/* L'écran avait déjà la ligne : il doit la REMPLACER, pas l'écarter. */
const listeAffichee = [{ id: jalonEnrichi.id, rang: jalonEnrichi.rang, donnees: undefined }];
const apresReception = fusionnerEntreeJournal(listeAffichee, diffuse[0]);
verifier(apresReception.length === 1, 'la ligne connue est remplacée, sans doublon');
verifier(
  JSON.parse(apresReception[0].donnees ?? '{}').resumeDemande === SYNTHESE_1,
  'et l’écran porte bien la synthèse, sans rechargement de la page',
);

/* ------------------------------------------------------------------ */
console.log('\n4. LES AUTRES GARDE-FOUS TIENNENT');
/* ------------------------------------------------------------------ */

for (const [champ, valeur] of [
  ['description', 'Une description écrite sans avoir rien lu du projet.'],
  ['niveau', 'approfondi'],
]) {
  const refus = await outils.callTool(contexte, 'board_update_card', { cardId: CARTE, [champ]: valeur });
  verifier(!refus.ok, `« ${champ} » reste refusé tant que la mémoire n’est pas ouverte`);
}
verifier(store.getCard(CARTE)?.description === '', 'et rien n’a été écrit sur la carte');

/* ------------------------------------------------------------------ */
console.log('\n5. LE DEUXIÈME ÉCHANGE A SA PROPRE SYNTHÈSE');
/* ------------------------------------------------------------------ */

poserLaDemande('m2', 'Ajoute aussi un PDF.');
poserLeTour('T2');
const SYNTHESE_2 = 'Vous demandez en plus qu’un PDF soit joint.';
const geste2 = await outils.callTool(contexte, 'board_update_card', { cardId: CARTE, resumeDemande: SYNTHESE_2 });
verifier(geste2.ok, 'aux tours suivants, la synthèse passe SEULE : le titre est acquis');

const filDeuxEchanges = filDeLaCarte(journalCarte.entreesDuJournal(CARTE));
verifier(demande(filDeuxEchanges, 1)?.resume === SYNTHESE_1, 'le premier échange garde la sienne');
verifier(demande(filDeuxEchanges, 2)?.resume === SYNTHESE_2, 'le second porte la sienne, distincte');

/* ------------------------------------------------------------------ */
console.log('\n6. UNE CARTE D’AVANT NE CHANGE PAS D’APPARENCE');
/* ------------------------------------------------------------------ */

const ANCIENNE = 'carte-d-avant';
store.saveCard({
  id: ANCIENNE,
  projectId: PROJET,
  title: 'Une carte d’avant',
  description: '',
  labels: [],
  column: 'planned',
  position: 2,
  origin: 'user',
  attachments: [],
  run: { engine: 'claude', thinking: 'none', mode: 'direct' },
  scheduling: { asap: false, attempts: 1, restarts: 0 },
  createdAt: maintenant,
  updatedAt: maintenant,
});
/* Son jalon de demande n'a JAMAIS porté de synthèse : seule la compréhension
   qui suit en écrit une, exactement comme avant ce changement. */
journalCarte.ajouterAuJournal({
  cardId: ANCIENNE,
  phase: 'cadrage',
  nature: 'jalon',
  libelle: 'Demande',
  agentId: 'agent-d-avant',
  agentRole: 'cadrage',
  resultat: 'Je veux un bouton',
  donnees: { messageId: 'vieux-1' },
});
journalCarte.ajouterAuJournal({
  cardId: ANCIENNE,
  phase: 'cadrage',
  nature: 'jalon',
  libelle: 'Compréhension',
  agentId: 'agent-d-avant',
  agentRole: 'cadrage',
  tourId: 'V1',
  resultat: 'Un bouton en tête de page.',
  donnees: { resumeDemande: 'Un bouton est demandé.', resumeComprehension: 'Un bouton en tête de page.' },
});
const ancien = pointsDuParcours(journalCarte.entreesDuJournal(ANCIENNE), {
  colonne: 'planned',
  chapitre: 'cadrage',
  creeeA: maintenant,
  parcours: { comprehension: { texte: 'Un bouton en tête de page.', at: maintenant, hypotheses: [], sujets: [] }, plans: [] },
});
verifier(
  demande(ancien, 1)?.resume === 'Un bouton est demandé.',
  'l’ancien chemin — l’emprunt à la compréhension — tient toujours',
);

/* ------------------------------------------------------------------ */
fs.rmSync(dossier, { recursive: true, force: true });

if (echecs.length) {
  console.error(`\nÉCHEC : ${echecs.length} contrôle(s) en défaut.`);
  echecs.forEach((message) => console.error(`  - ${message}`));
  process.exit(1);
}
console.log('\nLa synthèse de la demande s’affiche dès le début du tour, et rien d’autre ne s’est ouvert.');
