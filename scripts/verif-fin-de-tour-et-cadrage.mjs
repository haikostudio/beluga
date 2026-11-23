#!/usr/bin/env node
/*
 * TROIS PROMESSES, VÉRIFIÉES SUR UNE VRAIE BASE ET PAR LE VRAI CHEMIN D'ÉCRITURE.
 *
 *  1. UNE FIN DE TOUR NE MENT PLUS. Un arrêt de quota, un moteur jamais parti
 *     et un arrêt demandé à la main ne sont PAS des incidents : l'étape
 *     « Rapport » ne rougit plus, et le bouton « Reprendre » ne réclame plus
 *     un travail qui repart tout seul. Un vrai incident, lui, rougit toujours.
 *     Et un tour tombé APRÈS avoir rendu son compte rendu garde ce compte
 *     rendu, la cause voyageant à côté.
 *  2. UNE CARTE ROUVERTE N'AFFICHE QU'UNE ÉTAPE EN COURS. Le journal arrive
 *     après le premier rendu : tant qu'il manque, rien ne doit faire tourner
 *     « Demande » et « Travail » ensemble. Et une préparation qui dure
 *     au-delà de son plafond cesse de s'annoncer comme une préparation.
 *  3. LE CADRAGE NE LAISSE AUCUNE QUESTION EN SUSPENS. L'outil
 *     « rendre_comprehension » REFUSE une ligne interrogative tant qu'aucune
 *     question n'a été posée dans le tour, et l'écran affiche les couples
 *     question / réponse relus depuis le journal.
 *
 * AUCUN MOTEUR N'EST APPELÉ, aucune base réelle n'est touchée : une base
 * jetable est ouverte dans un dossier temporaire, puis effacée.
 *
 *   node scripts/verif-fin-de-tour-et-cadrage.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Le dépôt d'où PART ce script, jamais un chemin en dur : il se lance aussi
   bien depuis le dépôt principal que depuis la copie de travail d'une carte. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'beluga-fin-de-tour-'));
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
const journal = await import(path.join(RACINE, 'server/dist/journal-carte.js'));
const outils = await import(path.join(RACINE, 'server/dist/tools.js'));

const {
  JALON_TOUR_ARRETE,
  JALON_TOUR_EN_PAUSE,
  JALON_TOUR_NON_PARTI,
  JALON_TOUR_LANCE,
  RAPPORT_MINIMAL,
  PREPARATION_MAX_MS,
  CONSIGNE_CADRAGE,
  attenteDeLaDemande,
  barreDuParcours,
  genreDAction,
  jalonDeFinDeTour,
  lireComprehensionRendue,
  pointsDuParcours,
  reponseALaQuestion,
} = partage;

/* Une carte de travail, posée pour de vrai : le journal s'écrit sous elle. */
const maintenant = Date.now();
function poserLaCarte(id) {
  store.saveCard({
    id,
    projectId: 'projet-essai',
    title: `Carte ${id}`,
    description: '',
    labels: [],
    column: 'running',
    position: 1,
    origin: 'user',
    attachments: [],
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    scheduling: { asap: false, attempts: 1, restarts: 0 },
    createdAt: maintenant,
    updatedAt: maintenant,
  });
}

/**
 * LA FIN DE TOUR, JOUÉE PAR LE MÊME CHEMIN QUE LE DÉMON : la règle pure décide
 * du jalon (`jalonDeFinDeTour`), puis l'entrée est ÉCRITE en base, comme le
 * fait `startTurn`. Rien n'est simulé à la main.
 */
function finirLeTour(cardId, tour) {
  const issue = jalonDeFinDeTour(tour);
  journal.ajouterAuJournal({
    cardId,
    phase: 'rapport',
    nature: 'jalon',
    agentRole: 'tache',
    libelle: issue.libelle,
    resultat: issue.resultat,
    reussie: issue.reussie,
    donnees: {
      compte: 'Compte d’essai',
      moteur: 'claude',
      ...(issue.reussie && issue.cause ? { causeDArret: issue.cause } : {}),
    },
  });
  return issue;
}

/** Les points du parcours d'une carte, lus comme l'écran les lit. */
function parcoursDe(cardId, ctx = {}) {
  const entrees = journal.entreesDuJournal(cardId);
  return pointsDuParcours(entrees, {
    chapitre: 'rapport',
    colonne: 'running',
    tourEnCours: false,
    parcours: null,
    questionsOuvertes: 0,
    ...ctx,
  });
}

const etatDuRapport = (points) => points.find((point) => point.etape === 'rapport')?.etat;

/* ------------------------------------------------------------------ */
console.log('\n1. Une fin de tour qui n’est pas une panne ne se dit plus panne');
/* ------------------------------------------------------------------ */

const CAS = [
  {
    id: 'quota',
    titre: 'une limite de compte est une PAUSE, la relève a sa propre route',
    tour: { failed: true, reprise: true, cause: 'Fable 5.1 requires usage credits.' },
    jalon: JALON_TOUR_EN_PAUSE,
  },
  {
    id: 'muet',
    titre: 'un moteur jamais joint n’est pas parti, la carte repart seule',
    tour: { failed: true, moteurMuet: true, cause: 'Le moteur n’a jamais répondu.' },
    jalon: JALON_TOUR_NON_PARTI,
  },
  {
    id: 'arret',
    titre: 'un arrêt demandé à la main est un geste, pas une panne',
    tour: { failed: true, arretDemande: true, cause: 'Le moteur s’est arrêté (code null).' },
    jalon: JALON_TOUR_ARRETE,
  },
];

for (const cas of CAS) {
  poserLaCarte(cas.id);
  journal.ajouterAuJournal({ cardId: cas.id, phase: 'execution', nature: 'jalon', libelle: JALON_TOUR_LANCE, agentRole: 'tache' });
  const issue = finirLeTour(cas.id, cas.tour);
  verifier(issue.libelle === cas.jalon, `${cas.titre} → jalon « ${cas.jalon} »`);
  verifier(issue.incident === false, `  …et ce jalon n’est pas compté comme un incident`);
  verifier(genreDAction(journal.entreesDuJournal(cas.id).at(-1)) !== 'incident', '  …le journal ne le peint pas en incident');
  verifier(etatDuRapport(parcoursDe(cas.id)) !== 'erreur', '  …et l’étape « Rapport » ne rougit pas');
}

/* Le témoin : une VRAIE panne rougit toujours. Sans lui, ce contrôle passerait
   même si plus rien n'était jamais signalé. */
poserLaCarte('panne');
journal.ajouterAuJournal({ cardId: 'panne', phase: 'execution', nature: 'jalon', libelle: JALON_TOUR_LANCE, agentRole: 'tache' });
const panne = finirLeTour('panne', { failed: true, cause: 'Le moteur est tombé en plein travail.' });
verifier(panne.libelle === 'Tour interrompu' && panne.incident, 'un vrai incident garde son jalon « Tour interrompu »');
verifier(etatDuRapport(parcoursDe('panne')) === 'erreur', '  …et lui SEUL peint l’étape « Rapport » en rouge');

/* ------------------------------------------------------------------ */
console.log('\n2. Un tour tombé APRÈS son compte rendu garde son compte rendu');
/* ------------------------------------------------------------------ */

poserLaCarte('rapport-puis-chute');
const compteRendu = `## 1. Analyse\n${'Le travail a été mené jusqu’au bout. '.repeat(12)}`;
verifier(compteRendu.length >= RAPPORT_MINIMAL, `un compte rendu entier dépasse le seuil de ${RAPPORT_MINIMAL} signes`);
const chute = finirLeTour('rapport-puis-chute', {
  failed: true,
  texte: compteRendu,
  rapportEntier: true,
  cause: 'Le moteur s’est arrêté (code null).',
});
verifier(chute.libelle === 'Réponse rendue' && chute.reussie, 'le jalon dit « Réponse rendue », pas « Tour interrompu »');
verifier(chute.resultat === compteRendu.trim(), 'le journal garde le COMPTE RENDU, plus la cause à sa place');
const ecrite = journal.entreesDuJournal('rapport-puis-chute').at(-1);
verifier(JSON.parse(ecrite.donnees ?? '{}').causeDArret?.length > 0, 'la cause de l’arrêt reste lisible à côté, elle n’est pas perdue');
verifier(etatDuRapport(parcoursDe('rapport-puis-chute')) !== 'erreur', 'l’étape « Rapport » ne rougit pas sur un rapport rendu');

/* Trois mots rendus ne sont PAS un compte rendu : la chute reste un incident. */
const bribe = jalonDeFinDeTour({ failed: true, texte: 'Je continue.', cause: 'Le moteur est tombé.' });
verifier(bribe.libelle === 'Tour interrompu' && bribe.incident, 'une bribe de texte ne passe pas pour un compte rendu');

/* ------------------------------------------------------------------ */
console.log('\n3. Une carte rouverte n’affiche qu’une seule étape en cours');
/* ------------------------------------------------------------------ */

/* La seconde qui suit la réouverture : le journal n'est pas encore arrivé. */
const sansJournal = pointsDuParcours([], {
  chapitre: 'travail',
  colonne: 'running',
  tourEnCours: true,
  parcours: null,
  questionsOuvertes: 0,
});
const enCours = sansJournal.filter((point) => point.etat === 'encours');
verifier(enCours.length === 1, `une seule étape en cours (vu : ${enCours.map((p) => p.etape).join(', ') || 'aucune'})`);
verifier(enCours[0]?.etape === 'travail', '  …et c’est bien « Travail », l’étape la plus avancée');
verifier(sansJournal.find((p) => p.etape === 'demande')?.etat === 'fait', '  …« Demande » est derrière, donc faite');
verifier(barreDuParcours(sansJournal).filter((s) => s.etat === 'encours').length === 1, 'la barre d’étapes en dit autant : un seul segment allumé');

/* Une fois le journal arrivé, le constat tient toujours. */
poserLaCarte('rouverte');
journal.ajouterAuJournal({ cardId: 'rouverte', phase: 'cadrage', nature: 'jalon', libelle: 'Demande', agentRole: 'cadrage', resultat: 'Fais ceci' });
journal.ajouterAuJournal({ cardId: 'rouverte', phase: 'execution', nature: 'jalon', libelle: JALON_TOUR_LANCE, agentRole: 'tache' });
const avecJournal = parcoursDe('rouverte', { chapitre: 'travail', tourEnCours: true });
verifier(
  avecJournal.filter((point) => point.etat === 'encours').length === 1,
  'journal arrivé : toujours une seule étape en cours',
);

/* UNE PRÉPARATION QUI DURE N'EN EST PLUS UNE : passé le plafond, l'écran se
   tait plutôt que d'annoncer « Préparation du tour… » sous un chronomètre à
   54 minutes. */
verifier(
  attenteDeLaDemande({ tourEnCours: true, tourLance: false, depuisMs: 5_000 })?.sorte === 'preparation',
  'les premières secondes s’annoncent « Préparation du tour… »',
);
verifier(
  attenteDeLaDemande({ tourEnCours: true, tourLance: false, depuisMs: PREPARATION_MAX_MS + 1 }) === undefined,
  `passé ${Math.round(PREPARATION_MAX_MS / 1000)} s, la phrase se tait au lieu de mentir`,
);

/* ------------------------------------------------------------------ */
console.log('\n4. Le cadrage pose ses questions, ou assume ses hypothèses');
/* ------------------------------------------------------------------ */

/* LES DEUX RÉSUMÉS SONT EXIGÉS DEPUIS TOUJOURS, et le second registre l'est
   depuis que le plan est facultatif : sans eux, l'outil refuse AVANT même de
   juger les hypothèses, et le contrôle ne mesurerait plus ce qu'il croit. */
const RESUMES = {
  resumeDemande: 'Vous demandez que la chose soit faite.',
  resumeComprehension: 'Je comprends qu’il faut la faire là où elle se fait.',
};
const PART_TECHNIQUE = {
  taches: [{ titre: 'Faire la chose', description: 'Là où elle se fait.' }],
  faits: [],
  risques: 'Rien de connu.',
};

const QUESTIONS_REFUSÉES = [
  'Quel format de sortie faut-il retenir ?',
  'Faut-il garder l’ancien écran ?',
  'Souhaitez-vous une notification par courriel ?',
  'Combien de lignes au maximum',
];
for (const ligne of QUESTIONS_REFUSÉES) {
  const lu = lireComprehensionRendue({ ...RESUMES, texte: 'La demande est claire.', hypotheses: [ligne], partieTechnique: PART_TECHNIQUE });
  verifier(lu.ok === false, `« ${ligne.slice(0, 44)}… » est refusée : c’est une question, pas une hypothèse`);
  verifier(String(lu.raison ?? '').includes('ask_user'), '  …et le refus RENVOIE à « ask_user », il n’est pas muet');
}

const assumees = lireComprehensionRendue({
  ...RESUMES,
  texte: 'La demande est claire.',
  hypotheses: ['Je suppose que le format reste le PDF.', 'Je tranche pour l’ancien écran, conservé.'],
  partieTechnique: PART_TECHNIQUE,
});
verifier(assumees.ok === true, 'une hypothèse ASSUMÉE passe : « Je suppose que… », « Je tranche… »');
verifier(assumees.ok && assumees.valeur.hypotheses.length === 2, '  …et les deux lignes sont gardées');

/* UNE QUESTION DÉJÀ POSÉE DANS LE TOUR LÈVE LE REFUS : l'utilisateur a eu la
   main, l'agent peut écrire ce qu'il en retient. */
const apresLaQuestion = lireComprehensionRendue(
  { ...RESUMES, texte: 'La demande est claire.', hypotheses: ['Quel format de sortie ?'], partieTechnique: PART_TECHNIQUE },
  { questionsPosees: 1 },
);
verifier(apresLaQuestion.ok === true, 'une question DÉJÀ posée dans le tour lève le refus');

/* Les cartes déjà écrites portent l'ancien champ : il se relit, il ne se perd pas. */
const ancienne = lireComprehensionRendue({
  ...RESUMES,
  texte: 'Compris.',
  questions_ouvertes: ['Je suppose que non.'],
  partieTechnique: PART_TECHNIQUE,
});
verifier(ancienne.ok && ancienne.valeur.hypotheses.length === 1, 'l’ancien champ « questions_ouvertes » se relit encore');

/* L'outil déclaré au moteur dit la même chose que la règle. */
const declaration = outils.TOOL_DEFS.find((def) => def.name === 'rendre_comprehension');
const champs = declaration?.inputSchema?.properties ?? {};
verifier(!!champs.hypotheses, 'l’outil déclare le champ « hypotheses »');
verifier(!!champs.partieTechnique, '  …et le second registre « partieTechnique »');
verifier(
  (declaration?.inputSchema?.required ?? []).includes('partieTechnique'),
  '  …qui est EXIGÉ : c’est le seul dossier que reçoit l’exécution sans plan',
);
verifier(!champs.questions_ouvertes, '  …et ne propose plus « questions_ouvertes » au moteur');
verifier(String(champs.hypotheses?.description ?? '').includes('ask_user'), '  …sa description renvoie à « ask_user »');
verifier(CONSIGNE_CADRAGE.includes('AUCUNE QUESTION EN SUSPENS'), 'la consigne du cadrage l’exige noir sur blanc');

/* ------------------------------------------------------------------ */
console.log('\n5. Les couples question / réponse se relisent depuis le journal');
/* ------------------------------------------------------------------ */

poserLaCarte('questions');
journal.ajouterAuJournal({ cardId: 'questions', phase: 'cadrage', nature: 'jalon', libelle: 'Demande', agentRole: 'cadrage', resultat: 'Fais ceci' });
journal.ajouterAuJournal({
  cardId: 'questions',
  phase: 'cadrage',
  nature: 'requete',
  agentRole: 'cadrage',
  outil: 'ask_user',
  libelle: 'ask_user',
  params: { question: 'Quel format de sortie ?' },
  resultat: 'Réponse de l’utilisateur : Le PDF.\nReprends ton travail exactement où tu t’es arrêté.',
});
journal.ajouterAuJournal({
  cardId: 'questions',
  phase: 'cadrage',
  nature: 'requete',
  agentRole: 'cadrage',
  outil: 'ask_user',
  libelle: 'ask_user',
  params: { question: 'Faut-il prévenir par courriel ?' },
  resultat: 'Question posée à l’utilisateur. ARRÊTE-TOI ICI et rends la main.',
});

const pointsQuestions = parcoursDe('questions', { chapitre: 'cadrage', questionsOuvertes: 0 });
const questionsDuPoint = pointsQuestions.flatMap((point) => point.questions ?? []);
verifier(questionsDuPoint.length === 2, `les deux questions du tour sont rangées dans leur passage (vu : ${questionsDuPoint.length})`);
const reponses = questionsDuPoint.map((q) => reponseALaQuestion(q.entree.resultat));
verifier(reponses[0] === 'Le PDF.', 'la réponse se relit SANS la consigne rendue au moteur');
verifier(reponses[1] === undefined, 'une question restée sans réponse le DIT au lieu de disparaître');

/* PLUS AUCUN RÉCAPITULATIF EN TÊTE DE PASSAGE : les couples restent rangés dans
   leur passage côté données, mais l'écran ne les redit plus, et la question
   ouverte n'a plus de point à elle : le panneau de décision la porte. */
const flux = fs.readFileSync(path.join(RACINE, 'web/src/components/flux-en-points.tsx'), 'utf8');
verifier(!flux.includes('data-questions-reponses'), 'le flux ne pose plus de récapitulatif « Questions et réponses »');
verifier(!flux.includes('QuestionsRepondues'), '  …et le composant qui le dessinait a disparu');
verifier(!flux.includes('data-point-question='), '  …et la question ouverte n’a plus de second point dans le fil : elle se lit dans le panneau de décision');

/* LE PANNEAU « UNE DÉCISION ATTEND » NE PORTE PLUS DEUX CADRES JAUNES : il pose
   le sien à l'extérieur, la bulle intérieure garde son seul fond contrasté. */
const bulle = fs.readFileSync(path.join(RACINE, 'web/src/components/bulle-question.tsx'), 'utf8');
const vue = fs.readFileSync(path.join(RACINE, 'web/src/components/message-view.tsx'), 'utf8');
verifier(bulle.includes("variante === 'contraste'"), 'la bulle de question connaît la variante SANS liseré');
verifier(
  vue.split("variante={sansEntete ? 'contraste' : 'attention'}").length === 3,
  '  …et les deux cartes de question la prennent quand le bloc porteur a son cadre',
);

/* ------------------------------------------------------------------ */
fs.rmSync(dossier, { recursive: true, force: true });
if (echecs.length) {
  console.error(`\n✗ ${echecs.length} contrôle(s) en échec.`);
  process.exit(1);
}
console.log('\n✓ Fin de tour, étapes et questions du cadrage : tout tient.');
