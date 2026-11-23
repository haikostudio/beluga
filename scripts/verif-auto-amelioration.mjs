#!/usr/bin/env node
/*
 * LE RENDEZ-VOUS D'AUTO-AMÉLIORATION, VÉRIFIÉ DE BOUT EN BOUT.
 *
 * Chaque nuit vers 3 h, un agent d'analyse cherche ce qui peut être amélioré
 * dans Beluga Build et le PROPOSE, sans rien modifier. Ce qui est contrôlé ici :
 *
 *  1. LES VINGT-QUATRE HEURES D'UNE JOURNÉE, une par une : le rendez-vous ne
 *     part QUE dans la fenêtre 3 h – 5 h. Une analyse lancée à 14 h mangerait
 *     la réserve du jour, et c'est précisément ce qu'on protège ;
 *  2. un travail en cours REPORTE le rendez-vous sans l'annuler ;
 *  3. un seul passage par nuit ;
 *  4. sur une VRAIE base, le projet examiné est bien Beluga Build lui-même, et un
 *     projet mis de côté ne l'est plus ;
 *  5. sur cette même base, chaque proposition encore en attente devient, SANS
 *     clic, une carte réelle dans « Planifié », étiquetée « auto amélioration » ;
 *     une proposition déjà décidée n'en fait pas naître une seconde.
 *
 * AUCUN MOTEUR N'EST APPELÉ : le script ne lance jamais le rendez-vous réel —
 * il vérifie la décision qui y mène, et le mécanisme qui l'entoure. Il est donc
 * rejouable à n'importe quelle heure, y compris à 3 h du matin.
 *
 *   node scripts/verif-auto-amelioration.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Le dépôt d'où PART ce script, jamais un chemin en dur. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Une base jetable : ce contrôle n'écrit jamais dans celle du serveur. */
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'beluga-auto-amelioration-'));
process.env.BELUGA_DATA = dossier;

const partage = await import(path.join(RACINE, 'shared/dist/index.js'));
const db = await import(path.join(RACINE, 'server/dist/db.js'));
const store = await import(path.join(RACINE, 'server/dist/store.js'));
const rendezVous = await import(path.join(RACINE, 'server/dist/auto-amelioration.js'));

const echecs = [];
function verifier(condition, message) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    console.error(`  ✗ ${message}`);
    echecs.push(message);
  }
}

const {
  ATTENTE_PLACE_MAX_MS,
  AXES_D_EXAMEN,
  FENETRE_HEURES,
  HEURE_RENDEZ_VOUS,
  PERIODE_MS,
  PROPOSITIONS_MAX,
  consigneDAutoAmelioration,
  decisionDuRendezVous,
} = partage;

const JOUR = new Date(2026, 7, 13);
const instant = (heure) => new Date(2026, 7, 13, heure, 20).getTime();

function decider(surcharges = {}) {
  return decisionDuRendezVous({
    projetPresent: true,
    dernierPassage: undefined,
    maintenant: instant(HEURE_RENDEZ_VOUS),
    heureCourante: HEURE_RENDEZ_VOUS,
    placeLibre: true,
    ...surcharges,
  });
}

/* ------------------------------------------------------------------ */
console.log('\n1. Les vingt-quatre heures d’une journée');
/* ------------------------------------------------------------------ */

const fenetre = [];
for (let heure = 0; heure < 24; heure += 1) {
  if (decider({ heureCourante: heure, maintenant: instant(heure) }).lancer) fenetre.push(heure);
}
const attendue = Array.from({ length: FENETRE_HEURES }, (_, pas) => (HEURE_RENDEZ_VOUS + pas) % 24);
verifier(
  JSON.stringify(fenetre) === JSON.stringify(attendue),
  `le rendez-vous ne part qu’à ${attendue.join(' h, ')} h — constaté : ${fenetre.join(', ') || 'aucune heure'}`,
);
verifier(!fenetre.some((heure) => heure >= 7 && heure <= 22), 'aucun départ en pleine journée');

/* ------------------------------------------------------------------ */
console.log('\n2. Sans place libre, le rendez-vous ATTEND, il ne saute plus la nuit');
/* ------------------------------------------------------------------ */

const occupe = decider({ placeLibre: false });
verifier(!occupe.lancer && occupe.raison === 'travail-en-cours', 'à 3 h, aucune place libre fait patienter');
verifier(
  decider({ heureCourante: HEURE_RENDEZ_VOUS + 1, placeLibre: true }).lancer,
  'une heure plus tard, une place libre, il repart tout seul',
);

const debutAttente = instant(HEURE_RENDEZ_VOUS);
verifier(
  !decider({
    heureCourante: HEURE_RENDEZ_VOUS + FENETRE_HEURES,
    maintenant: instant(HEURE_RENDEZ_VOUS + FENETRE_HEURES),
    placeLibre: false,
    enAttenteDepuis: debutAttente,
  }).lancer,
  'passé la fenêtre, toujours occupé, on attend encore',
);
verifier(
  decider({
    heureCourante: HEURE_RENDEZ_VOUS + FENETRE_HEURES,
    maintenant: instant(HEURE_RENDEZ_VOUS + FENETRE_HEURES),
    placeLibre: true,
    enAttenteDepuis: debutAttente,
  }).lancer,
  'passé la fenêtre, une place libérée fait partir le rendez-vous — la nuit n’est pas sautée',
);
verifier(
  !decider({
    heureCourante: 22,
    maintenant: debutAttente + ATTENTE_PLACE_MAX_MS + 60_000,
    placeLibre: false,
    enAttenteDepuis: debutAttente,
  }).lancer,
  'passé le plafond d’attente, on renonce quand même — jusqu’à la nuit suivante',
);

/* ------------------------------------------------------------------ */
console.log('\n3. Un seul passage par nuit');
/* ------------------------------------------------------------------ */

const passage = instant(HEURE_RENDEZ_VOUS);
verifier(
  decider({ dernierPassage: passage, maintenant: passage + 3600_000 }).raison === 'deja-passe',
  'une heure après le passage de la nuit, rien ne repart',
);
verifier(
  decider({ dernierPassage: passage, maintenant: passage + PERIODE_MS }).lancer,
  'vingt-quatre heures plus tard, la nuit suivante a lieu',
);

/* ------------------------------------------------------------------ */
console.log('\n4. Le projet examiné, sur une vraie base');
/* ------------------------------------------------------------------ */

db.openDb();

const autre = store.saveProject(
  partage.Project.parse({
    id: store.newId(),
    name: 'Un autre projet',
    path: path.join(dossier, 'autre'),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }),
);
verifier(!rendezVous.projetDuRendezVous(), 'sans Beluga Build inscrit, aucun projet à examiner');

const soi = store.saveProject(
  partage.Project.parse({
    id: store.newId(),
    name: 'Beluga Build',
    path: RACINE,
    isSelf: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }),
);
verifier(rendezVous.projetDuRendezVous()?.id === soi.id, 'le projet examiné est Beluga Build lui-même');
verifier(rendezVous.projetDuRendezVous()?.id !== autre.id, 'jamais le tableau d’un autre projet');

store.saveProject({ ...soi, archived: true });
verifier(!rendezVous.projetDuRendezVous(), 'un projet mis de côté ne s’améliore plus');
store.saveProject({ ...soi, archived: false });

/* ------------------------------------------------------------------ */
console.log('\n5. Ce qui attend au réveil');
/* ------------------------------------------------------------------ */

const agent = store.saveAgent(
  partage.Agent.parse({
    id: store.newId(),
    projectId: soi.id,
    role: 'analysis',
    title: partage.titreDuRendezVous(JOUR),
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    status: 'done',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }),
);

const proposition = (titre, decision) =>
  partage.TaskProposal.parse({ id: store.newId(), title: titre, description: 'trouvaille de la nuit', decision });

const propositions = [
  proposition('Retirer une fonction que plus rien n’appelle', 'pending'),
  proposition('Fusionner deux contrôles qui verrouillent la même règle', 'pending'),
  proposition('Une piste déjà écartée hier', 'refused'),
];
const message = store.saveMessage(
  partage.Message.parse({
    id: store.newId(),
    agentId: agent.id,
    role: 'assistant',
    content: 'Trois pistes retenues cette nuit.',
    proposals: propositions,
    createdAt: Date.now(),
  }),
);
// Le démon écrit les DEUX sources : le message porte les propositions, la table
// les retient pour la colonne de gauche. Le contrôle refait le même geste.
for (const p of propositions) store.saveProposal(message.id, soi.id, p);

const posees = rendezVous.accepterPropositionsDeLaNuit(agent.id);
verifier(posees.length === 2, `deux cartes doivent naître directement — compté : ${posees.length}`);
verifier(
  posees.length <= PROPOSITIONS_MAX,
  `jamais plus de ${PROPOSITIONS_MAX} propositions : le tableau reste lisible`,
);

const cartes = store.listCards(soi.id);
verifier(cartes.length === 2, `les cartes de la nuit sont bien sur le tableau — trouvé : ${cartes.length}`);
verifier(
  cartes.every((c) => c.column === 'planned'),
  'chaque carte naît directement dans « Planifié », sans attendre un clic',
);
verifier(
  cartes.every((c) => c.labels.includes(partage.LABEL_AUTO_AMELIORATION)),
  'chaque carte porte l’étiquette « auto amélioration »',
);

const decisions = store.decisionsEnAttente().filter((d) => d.projectId === soi.id && !d.reglee);
verifier(
  decisions.length === 0,
  'aucune décision ne reste en attente : les propositions de la nuit sont déjà tranchées',
);

// Rejouer l’acceptation ne doit rien créer de plus : une proposition décidée
// n’attend plus personne.
verifier(
  rendezVous.accepterPropositionsDeLaNuit(agent.id).length === 0,
  'un second passage sur le même agent ne pose rien de plus',
);

/* ------------------------------------------------------------------ */
console.log('\n5 bis. La demande envoyée au cadrage de chaque carte');
/* ------------------------------------------------------------------ */

/*
 * Une carte posée par la nuit n'avait AUCUN agent : sa conversation était
 * muette, la barre d'écriture éteinte. Elle reçoit désormais son agent de
 * cadrage et son premier tour. On ne lance ici AUCUN moteur : on vérifie le
 * TEXTE de cette demande, qui est une règle pure.
 */
const demande = partage.demandeDeCadrageDeLaNuit(
  { title: 'Retirer une fonction morte', description: 'ce qui est attendu', briefing: 'ce que la nuit a lu' },
  'Beluga Build',
);
verifier(demande.includes('Retirer une fonction morte'), 'le titre posé par la nuit voyage avec la demande');
verifier(demande.includes('ce que la nuit a lu'), 'le constat de la nuit est remis au cadrage');
verifier(demande.includes('ce qui est attendu'), 'la description de la carte est remise au cadrage');
verifier(demande.includes('SEPT TEMPS'), 'le cadrage déroule son processus habituel, comme sur toute autre carte');
verifier(
  demande.includes('ask_user'),
  'la demande interdit la question : personne n’est devant l’écran à 3 h du matin',
);
verifier(
  typeof rendezVous.ouvrirLesCadragesDeLaNuit === 'function',
  'le démon sait ouvrir le cadrage des cartes de la nuit',
);
verifier(
  (await rendezVous.ouvrirLesCadragesDeLaNuit([], 'Beluga Build')) === 0,
  'sans carte posée, aucun cadrage ne part',
);

/* Le rattrapage des nuits passées : trois conditions, et rien d'autre. */
const carteDeNuit = cartes[0];
verifier(
  (await rendezVous.rattraperLeCadrageDeLaNuit({ ...carteDeNuit, labels: [] }, 'Beluga Build')) === false,
  'une carte sans l’étiquette de la nuit n’est jamais rattrapée',
);
verifier(
  (await rendezVous.rattraperLeCadrageDeLaNuit({ ...carteDeNuit, column: 'running' }, 'Beluga Build')) === false,
  'une carte déjà lancée n’est jamais rattrapée',
);
verifier(
  (await rendezVous.rattraperLeCadrageDeLaNuit({ ...carteDeNuit, agentId: agent.id }, 'Beluga Build')) === false,
  'une carte qui a déjà un agent garde son fil, sans second agent',
);

/* ------------------------------------------------------------------ */
console.log('\n6. La consigne envoyée à l’agent');
/* ------------------------------------------------------------------ */

const consigne = consigneDAutoAmelioration('Beluga Build');
verifier(consigne.includes('TU NE MODIFIES RIEN'), 'l’interdit d’écrire est dit en toutes lettres');
verifier(consigne.includes('propose_task'), 'la seule sortie du tour est une proposition de carte');
verifier(consigne.includes(String(PROPOSITIONS_MAX)), 'le plafond de propositions y figure');
verifier(
  AXES_D_EXAMEN.every((axe) => consigne.includes(axe)),
  `les ${AXES_D_EXAMEN.length} axes de recherche partent tous`,
);

/* ------------------------------------------------------------------ */

fs.rmSync(dossier, { recursive: true, force: true });

if (echecs.length) {
  console.error(`\n${echecs.length} contrôle(s) en échec.`);
  process.exit(1);
}
console.log('\nTout est en place : le rendez-vous ne part que la nuit, et il ne propose que.');
