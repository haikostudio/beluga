#!/usr/bin/env node
/*
 * LE CHEMINEMENT DU CADRAGE VA TOUJOURS AU BOUT, ET L'ÉCRAN NE SE CONTREDIT PLUS.
 *
 * Trois promesses, rejouées sur une base jetable et par le vrai chemin
 * d'écriture de la carte :
 *
 *  1. UN TOUR QUI NE REND PAS SA COMPRÉHENSION EST RELANCÉ UNE FOIS, PUIS
 *     DEVIENT UN INCIDENT. Un moteur factice qui n'appelle jamais l'outil et
 *     ne dit rien : la relance part, elle échoue, la carte porte l'incident
 *     NOMMÉ, le point « Compréhension » passe en ERREUR et le bouton d'étape
 *     suivante (« Générer le plan ») reste ÉTEINT, avec sa raison.
 *  2. UN TOUR QUI A RÉPONDU EN TEXTE EST UNE DISCUSSION (30/09/2026) : AUCUNE
 *     relance ne part, l'issue « reponse » est écrite sur la carte, le point
 *     se coche et dit « L'agent a répondu à votre question. ». Un tour muet
 *     dont la relance répond enfin en texte se referme de la même façon.
 *  3. AUCUN ÉTAT NE PEUT AFFICHER UN BOUTON D'ÉTAPE SUIVANTE AU-DESSUS D'UNE
 *     ÉTAPE DÉCLARÉE « À VENIR » (`contradictionDuFlux`) — balayé sur tous les
 *     états de carte que le cadrage peut atteindre.
 *
 * AUCUN MOTEUR N'EST APPELÉ : la relance est jouée par sa règle pure, comme le
 * démon la lit. Aucune base réelle n'est touchée.
 *
 *   node scripts/verif-cadrage-cheminement.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Le dépôt d'où PART ce script, jamais un chemin en dur. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'beluga-cadrage-cheminement-'));
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

const {
  INCIDENT_COMPREHENSION_NON_RENDUE,
  RAISONS_DU_GESTE,
  comprehensionManquante,
  contradictionDuFlux,
  gesteDuParcours,
  issueAEcrire,
  issueDeLaRelance,
  pointsDuParcours,
} = partage;

const maintenant = Date.now();

/** Une carte de cadrage, posée pour de vrai dans la base jetable. */
function poserLaCarte(id) {
  store.saveCard({
    id,
    projectId: 'projet-essai',
    title: `Carte ${id}`,
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
  return store.getCard(id);
}

/**
 * LA FERMETURE D'UN TOUR DE CADRAGE, JOUÉE PAR LE MÊME ENCHAÎNEMENT QUE LE
 * DÉMON : la règle pure juge, la relance est simulée par le texte que le
 * moteur rendrait, et la carte est ÉCRITE comme le runtime l'écrit.
 */
function refermerLeTour(carteId, tourId, moteur) {
  const carte = store.getCard(carteId);
  const jugement = {
    comprehensionRendue: carte.parcours?.comprehension?.tourId === tourId,
    questionPosee: !!moteur.questionPosee,
    echec: !!moteur.echec,
    arretDemande: !!moteur.arretDemande,
    planDemande: !!carte.parcours?.planDemandeA,
    texteRendu: !!moteur.texteRendu,
  };
  let relance;
  let relancesParties = 0;
  if (comprehensionManquante(jugement)) {
    relancesParties += 1;
    /* Le moteur factice répond à la relance — ou se tait. */
    if (moteur.relanceAppelleLOutil) {
      const fraiche = store.getCard(carteId);
      store.saveCard({
        ...fraiche,
        parcours: {
          ...(fraiche.parcours ?? { plans: [] }),
          comprehension: { texte: 'Compris, enfin.', hypotheses: [], sujets: [], at: Date.now(), tourId },
        },
      });
    }
    const apres = store.getCard(carteId);
    relance = issueDeLaRelance({
      comprehensionRendue: apres.parcours?.comprehension?.tourId === tourId,
      texte: moteur.texteDeLaRelance ?? '',
    });
    if (relance === 'incident') {
      const fraiche = store.getCard(carteId);
      store.saveCard({
        ...fraiche,
        parcours: {
          ...(fraiche.parcours ?? { plans: [] }),
          incident: { texte: INCIDENT_COMPREHENSION_NON_RENDUE, at: Date.now(), etape: 'comprehension' },
        },
      });
    }
  }
  const issue = issueAEcrire({ ...jugement, relance });
  if (issue) {
    const fraiche = store.getCard(carteId);
    store.saveCard({
      ...fraiche,
      parcours: { ...(fraiche.parcours ?? { plans: [] }), issueDuTour: { issue, at: Date.now(), tourId } },
    });
  }
  return { relancesParties, relance, issue };
}

/** Ce que l'écran affiche d'une carte : son geste et sa ligne de temps. */
function ecran(carteId) {
  const carte = store.getCard(carteId);
  const messages = [{ role: 'user', content: 'fais ceci', at: maintenant - 1_000 }];
  const contexte = {
    colonne: carte.column,
    messages,
    parcours: carte.parcours,
    roleAgent: 'cadrage',
    tourEnCours: false,
  };
  const geste = gesteDuParcours(contexte);
  const points = pointsDuParcours([], {
    chapitre: 'cadrage',
    colonne: carte.column,
    parcours: carte.parcours,
    tourEnCours: false,
    questionsOuvertes: 0,
  });
  return { carte, geste, points, point: (etape) => points.find((p) => p.etape === etape) };
}

/* ------------------------------------------------------------------ */
console.log('\n1. UN MOTEUR QUI N’APPELLE JAMAIS L’OUTIL, ET NE DIT RIEN');
/* ------------------------------------------------------------------ */

poserLaCarte('carte-muette');
const muet = refermerLeTour('carte-muette', 'tour-1', { texteDeLaRelance: '' });
verifier(muet.relancesParties === 1, 'une SEULE relance part, jamais deux');
verifier(muet.relance === 'incident', 'la relance muette devient un incident');
verifier(muet.issue === null, 'aucune issue n’est écrite : le tour n’est pas allé au bout');

const apresMuet = ecran('carte-muette');
verifier(
  apresMuet.carte.parcours?.incident?.texte === INCIDENT_COMPREHENSION_NON_RENDUE,
  'la carte porte l’incident NOMMÉ, avec de quoi reprendre',
);
verifier(apresMuet.carte.parcours?.incident?.etape === 'comprehension', 'l’incident nomme SON étape');
verifier(apresMuet.point('comprehension')?.etat === 'erreur', 'le point « Compréhension » passe en erreur');
verifier(apresMuet.point('plan')?.etat !== 'erreur', '…et le point « Plan » n’est pas rougi à sa place');
verifier(
  apresMuet.geste.geste === 'valider-et-lancer' && apresMuet.geste.possible === false,
  'le bouton d’étape suivante reste ÉTEINT',
);
verifier(
  apresMuet.geste.raison === RAISONS_DU_GESTE.comprehensionAttendue,
  '…et il DIT pourquoi : la compréhension est attendue',
);
verifier(contradictionDuFlux(apresMuet.points, apresMuet.geste) === null, 'aucune contradiction à l’écran');

/* ------------------------------------------------------------------ */
console.log('\n2. UN MOTEUR QUI RATTRAPE SON OUBLI À LA RELANCE');
/* ------------------------------------------------------------------ */

poserLaCarte('carte-rattrapee');
const rattrape = refermerLeTour('carte-rattrapee', 'tour-1', { relanceAppelleLOutil: true });
verifier(rattrape.relancesParties === 1, 'une seule relance, là encore');
verifier(rattrape.issue === 'cadrage', 'l’issue écrite est « cadrage »');

const apresRattrape = ecran('carte-rattrapee');
verifier(!apresRattrape.carte.parcours?.incident, 'aucun incident : le tour est rattrapé');
verifier(apresRattrape.point('comprehension')?.etat === 'fait', 'le point « Compréhension » est coché');
verifier(apresRattrape.geste.possible === true, 'le bouton « Générer le plan » s’allume');
verifier(contradictionDuFlux(apresRattrape.points, apresRattrape.geste) === null, 'aucune contradiction à l’écran');

/* ------------------------------------------------------------------ */
console.log('\n3. UN TOUR QUI DISCUTE');
/* ------------------------------------------------------------------ */

poserLaCarte('carte-reponse');
const reponse = refermerLeTour('carte-reponse', 'tour-1', { texteRendu: true });
verifier(reponse.relancesParties === 0, 'aucune relance : répondre en texte n’est pas un oubli');
verifier(reponse.issue === 'reponse', 'l’issue « reponse » est ÉCRITE sur la carte');

poserLaCarte('carte-muette-puis-reponse');
const tardive = refermerLeTour('carte-muette-puis-reponse', 'tour-1', { texteDeLaRelance: 'Voici ma réponse.' });
verifier(tardive.relancesParties === 1 && tardive.relance === 'reponse', 'un tour muet qui répond à sa relance est rattrapé');
verifier(tardive.issue === 'reponse' && !store.getCard('carte-muette-puis-reponse').parcours?.incident, '…sans incident');

const apresReponse = ecran('carte-reponse');
verifier(!apresReponse.carte.parcours?.incident, 'aucun incident sur une simple réponse');
verifier(apresReponse.point('comprehension')?.etat === 'fait', 'le passage se referme, il ne reste plus allumé');
verifier(
  /répondu/.test(apresReponse.point('comprehension')?.phrase ?? ''),
  '…et il dit sa phrase propre : l’agent a répondu',
);

/* ------------------------------------------------------------------ */
console.log('\n4. LES CAS QUI NE SONT PAS UN MANQUEMENT');
/* ------------------------------------------------------------------ */

for (const [nom, moteur] of [
  ['une question posée attend une réponse', { questionPosee: true }],
  ['un tour tombé porte déjà sa décision', { echec: true }],
  ['un arrêt demandé est un geste, pas une panne', { arretDemande: true }],
]) {
  const id = `carte-${nom.replace(/[^a-z]+/gi, '-')}`;
  poserLaCarte(id);
  const issue = refermerLeTour(id, 'tour-1', moteur);
  verifier(issue.relancesParties === 0, `aucune relance : ${nom}`);
  verifier(!store.getCard(id).parcours?.incident, `aucun incident : ${nom}`);
}

/* ------------------------------------------------------------------ */
console.log('\n5. BALAYAGE : AUCUN BOUTON ALLUMÉ AU-DESSUS D’UNE ÉTAPE « À VENIR »');
/* ------------------------------------------------------------------ */

const comprehension = { texte: 'Compris.', hypotheses: [], sujets: [], at: maintenant };
const plan = { numero: 1, titre: 'Plan', resume: '', texte: '# Plan', at: maintenant + 10 };
const etats = [
  { nom: 'rien', parcours: { plans: [] } },
  { nom: 'compréhension seule', parcours: { plans: [], comprehension } },
  { nom: 'compréhension + issue écrite', parcours: { plans: [], comprehension, issueDuTour: { issue: 'cadrage', at: maintenant } } },
  { nom: 'réponse seule', parcours: { plans: [], issueDuTour: { issue: 'reponse', at: maintenant } } },
  { nom: 'incident de compréhension', parcours: { plans: [], incident: { texte: 'rien', at: maintenant, etape: 'comprehension' } } },
  { nom: 'plan rendu', parcours: { plans: [plan], comprehension } },
  { nom: 'plan rendu, cadrage repris', parcours: { plans: [plan], comprehension: { ...comprehension, at: maintenant + 20 } } },
  { nom: 'plan demandé', parcours: { plans: [], comprehension, planDemandeA: maintenant } },
];
for (const etat of etats) {
  const messages = [{ role: 'user', content: 'fais ceci', at: maintenant - 1_000 }];
  const chapitre = (etat.parcours.plans?.length ?? 0) > 0 ? 'plan' : 'cadrage';
  const geste = gesteDuParcours({
    colonne: 'planned',
    messages,
    parcours: etat.parcours,
    roleAgent: 'cadrage',
    tourEnCours: false,
  });
  const points = pointsDuParcours([], {
    chapitre,
    colonne: 'planned',
    parcours: etat.parcours,
    tourEnCours: false,
    questionsOuvertes: 0,
  });
  const fautive = contradictionDuFlux(points, geste);
  verifier(fautive === null, `état « ${etat.nom} » : le bouton et la ligne de temps concordent`);
}

fs.rmSync(dossier, { recursive: true, force: true });

if (echecs.length) {
  console.error(`\n${echecs.length} vérification(s) en échec.`);
  process.exit(1);
}
console.log('\nTout est conforme : le cheminement du cadrage va au bout, et l’écran ne se contredit plus.');
