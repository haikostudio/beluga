#!/usr/bin/env node
/*
 * LE JOURNAL DU CYCLE COMPLET D'UNE CARTE TIENT-IL DEBOUT ?
 *
 * La carte promet UN SEUL document par carte, qui accumule TOUTES les requêtes
 * et TOUS les points de travail, du cadrage au rapport. Trois choses peuvent la
 * trahir sans qu'aucun test unitaire ne bronche :
 *
 *   1. LA BASE. La table existe-t-elle, une entrée s'écrit-elle, l'ordre des
 *      rangs tient-il quand deux entrées tombent dans la même milliseconde, et
 *      l'allègement des vieux journaux garde-t-il la LIGNE en vidant son texte ?
 *   2. LE CÂBLAGE. Le pont d'outils journalise-t-il TOUS les appels (et pas
 *      seulement la mémoire, comme avant), le runtime écrit-il ses jalons de
 *      départ et de rapport, ses étapes et ses points de travail ?
 *   3. L'ÉCRAN. L'onglet « Parcours » existe-t-il, demande-t-il son document, et
 *      suit-il les ajouts diffusés en direct ?
 *
 * AUCUN moteur n'est appelé, aucun jeton n'est dépensé. La base est une base
 * JETABLE, montée dans un dossier temporaire : la vraie n'est jamais touchée.
 * Le contrôle vise le dépôt d'où il PART — copie de travail comprise.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const echecs = [];
const constats = [];
const refuser = (m) => echecs.push(m);
const constater = (m) => constats.push(m);

/* ------------------------------------------------------------------ */
/* 1. La base : écrire, ordonner, alléger                              */
/* ------------------------------------------------------------------ */

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-journal-'));
process.env.BELUGA_DATA = dossier;

const { ajouterAuJournal, journalDeLaCarte, phaseDeLaCarte, allegerLesJournaux } = await import(
  pathToFileURL(path.join(RACINE, 'server/dist/journal-carte.js')).href
);
const { PLAFOND_RESULTAT } = await import(pathToFileURL(path.join(RACINE, 'shared/dist/index.js')).href);
const partage = await import(pathToFileURL(path.join(RACINE, 'shared/dist/index.js')).href);
const { TEXTES_TRADUITS } = await import(
  pathToFileURL(path.join(RACINE, 'shared/dist/traductions.js')).href
);

const CARTE = 'carte-essai';

// Le cadrage ouvre le journal…
ajouterAuJournal({ cardId: CARTE, phase: 'cadrage', nature: 'jalon', libelle: 'Tour lancé' });
ajouterAuJournal({
  cardId: CARTE,
  phase: 'cadrage',
  nature: 'requete',
  libelle: 'memoire',
  outil: 'memoire',
  params: { geste: 'chercher', demande: 'cartes' },
  resultat: 'le texte exact rendu',
  reussie: true,
  dureeMs: 12,
});

// …puis l'exécution ajoute à la MÊME liste, sans rien remplacer.
const phaseExecution = phaseDeLaCarte(CARTE, 'task');
ajouterAuJournal({
  cardId: CARTE,
  phase: phaseExecution,
  nature: 'point',
  libelle: 'Lire le dépôt',
  etat: 'done',
  donnees: { rang: 1, sur: 3 },
});
ajouterAuJournal({
  cardId: CARTE,
  phase: phaseExecution,
  nature: 'requete',
  libelle: 'coffre_fort',
  outil: 'coffre_fort',
  resultat: 'refusé',
  reussie: false,
});
ajouterAuJournal({ cardId: CARTE, phase: 'rapport', nature: 'jalon', libelle: 'Réponse rendue' });

const journal = journalDeLaCarte(CARTE);

if (journal.entrees.length !== 5) {
  refuser(`le journal devrait porter 5 entrées, il en porte ${journal.entrees.length}`);
} else {
  constater('les cinq entrées du cycle complet — cadrage, exécution, rapport — vivent dans UN seul document');
}

const rangs = journal.entrees.map((e) => e.rang);
if (rangs.join(',') !== '0,1,2,3,4') {
  refuser(`les rangs devraient se suivre sans trou, on lit ${rangs.join(',')}`);
} else {
  constater('les rangs se suivent : l’ordre ne dépend pas de l’horodatage');
}

const phases = [...new Set(journal.entrees.map((e) => e.phase))];
if (!phases.includes('cadrage') || !phases.includes('execution') || !phases.includes('rapport')) {
  refuser(`les trois phases attendues ne sont pas toutes présentes : ${phases.join(', ')}`);
} else {
  constater('chaque phase a bien ajouté à la même liste, sans écraser la précédente');
}

const refus = journal.entrees.find((e) => e.outil === 'coffre_fort');
if (!refus || refus.reussie !== false) {
  refuser('un appel d’outil REFUSÉ doit rester au journal, marqué comme échoué');
} else {
  constater('un refus reste au journal, avec son explication');
}

// Un cadrage QUI REPREND une carte déjà exécutée est un RECADRAGE.
if (phaseDeLaCarte(CARTE, 'cadrage') !== 'recadrage') {
  refuser('un cadrage qui reprend une carte déjà exécutée devrait être un RECADRAGE');
} else {
  constater('un cadrage sur une carte déjà exécutée est reconnu comme un recadrage');
}

// Un résultat démesuré est BORNÉ, en le disant.
const enorme = ajouterAuJournal({
  cardId: CARTE,
  phase: 'execution',
  nature: 'requete',
  outil: 'Read',
  resultat: 'x'.repeat(PLAFOND_RESULTAT + 5_000),
});
if (!enorme || !/non conservés/.test(enorme.resultat ?? '')) {
  refuser('un résultat au-delà du plafond doit être coupé EN LE DISANT');
} else {
  constater(`un résultat démesuré est borné à ${PLAFOND_RESULTAT} signes, et ce qui manque est dit`);
}

// L'allègement vide le TEXTE et garde la LIGNE.
const avantAllegement = journalDeLaCarte(CARTE).entrees.length;
allegerLesJournaux(Date.now() + 1_000);
const apres = journalDeLaCarte(CARTE);
if (apres.entrees.length !== avantAllegement) {
  refuser(`l’allègement a fait disparaître des lignes : ${avantAllegement} → ${apres.entrees.length}`);
} else if (apres.entrees.some((e) => e.resultat)) {
  refuser('l’allègement doit vider le TEXTE de chaque entrée');
} else {
  constater('l’allègement vide les textes et GARDE toutes les lignes : la ligne de temps n’est pas trouée');
}

/* ------------------------------------------------------------------ */
/* 1 bis. UNE QUESTION POSÉE NE SE LIT QU'UNE FOIS                      */
/* ------------------------------------------------------------------ */

/*
 * LA SÉQUENCE RÉELLE D'UNE QUESTION, telle qu'elle s'écrit dans un vrai
 * journal : le PONT écrit sa trace à la seconde où la question part, le MOTEUR
 * écrit la sienne quand la réponse arrive — ici trois minutes plus tard. Les
 * deux doivent se réunir en UNE ligne portant la réponse de l'utilisateur, et
 * jamais la consigne technique rendue à l'agent.
 */
const {
  fusionnerLesAppelsEnDouble,
  reponseALaQuestion,
  estUneConsigneAuMoteur,
  texteSansAttente,
  vueDeLEntree,
} = await import(pathToFileURL(path.join(RACINE, 'shared/dist/index.js')).href);

const CARTE_Q = 'carte-question';
const paramsQuestion = { question: 'Que doit faire la carte ?', options: [{ label: 'Remonter' }] };
const posee = Date.now();
ajouterAuJournal({
  cardId: CARTE_Q,
  phase: 'cadrage',
  nature: 'requete',
  tourId: 'tour-1',
  libelle: 'ask_user',
  outil: 'ask_user',
  params: paramsQuestion,
  resultat: '',
  reussie: true,
  dureeMs: 0,
  at: posee,
});
ajouterAuJournal({
  cardId: CARTE_Q,
  phase: 'cadrage',
  nature: 'requete',
  tourId: 'tour-1',
  libelle: 'Question posée',
  outil: 'mcp__beluga__ask_user',
  params: paramsQuestion,
  resultat: 'Réponse de l’utilisateur : Remonter\nReprends ton travail à partir de cette réponse.',
  reussie: true,
  dureeMs: 180_000,
  at: posee + 180_000,
});

const questions = fusionnerLesAppelsEnDouble(journalDeLaCarte(CARTE_Q).entrees);
if (questions.length !== 1) {
  refuser(`une seule question posée doit tenir en UNE ligne, on en lit ${questions.length}`);
} else if (reponseALaQuestion(questions[0].resultat) !== 'Remonter') {
  refuser('la ligne réunie doit porter la réponse de l’utilisateur, pas le texte rendu au moteur');
} else {
  constater('une question répondue trois minutes plus tard ne s’affiche qu’UNE fois, avec sa vraie réponse');
}

/* …et la consigne rendue à l'agent ne se lit nulle part dans le parcours. */
const vueDUneConsigne = vueDeLEntree({
  id: 'q',
  cardId: CARTE_Q,
  rang: 0,
  phase: 'cadrage',
  nature: 'requete',
  at: posee,
  libelle: 'ask_user',
  outil: 'ask_user',
  params: JSON.stringify(paramsQuestion),
  resultat: texteSansAttente(),
});
if (!estUneConsigneAuMoteur(texteSansAttente()) || vueDUneConsigne.reponse !== undefined) {
  refuser('la consigne « ARRÊTE-TOI ICI… » ne doit jamais passer pour la réponse d’une question');
} else {
  constater('la consigne rendue à l’agent ne se lit pas sous « Réponse » : elle ne s’adresse pas au lecteur');
}

// Une carte sans journal rend un document vide, jamais une erreur.
const vide = journalDeLaCarte('carte-qui-n-existe-pas');
if (vide.entrees.length !== 0) refuser('une carte sans journal doit rendre un document vide');
else constater('une carte sans journal rend un document vide, sans erreur');

fs.rmSync(dossier, { recursive: true, force: true });

/* ------------------------------------------------------------------ */
/* 2. Le câblage, relu dans les sources                                */
/* ------------------------------------------------------------------ */

const lire = (relatif) => fs.readFileSync(path.join(RACINE, relatif), 'utf8');

const http = lire('server/src/http.ts');
if (!/outilJournalise\(body\.name\)/.test(http) || !/journaliserDansLeTour\(agentId,/.test(http)) {
  refuser('le pont d’outils (server/src/http.ts) ne journalise pas TOUS les appels');
} else if (!/resultat: result\.question \? '' : result\.text/.test(http)) {
  refuser(
    'le pont d’outils doit garder le TEXTE rendu — sauf pour une question, dont la réponse n’existe pas encore',
  );
} else {
  constater('tout appel d’outil passe au journal, avec ses paramètres, son texte exact et sa durée');
  constater('…et une question n’y écrit pas la consigne rendue au moteur : sa réponse viendra avec l’étape');
}

const runtime = lire('server/src/runtime.ts');
const attendus = [
  ["le jalon du tour qui part", /cle: `depart:\$\{runState\.messageId\}`/],
  ["le jalon du rapport final", /cle: `rapport:\$\{runState\.messageId\}`/],
  ["les étapes du moteur", /cle: `step:\$\{step\.id\}`/],
  ["les points de travail", /cle: `todo:\$\{rang\}/],
  ["la phase décidée au départ", /phaseJournal: agent\.cardId \? phaseDeLaCarte/],
  /* LA DEMANDE OUVRE LE FLUX DÈS SON ARRIVÉE, pas au départ du moteur : elle
     est écrite par `journaliserLaDemande`, appelée au moment où la phrase est
     enregistrée — des dizaines de secondes plus tôt. */
  ["la demande de l’utilisateur, en tête du flux", /journaliserLaDemande\(agent, userMessage\);/],
  ["la demande écrite avec la phase de sa carte, sans tour vivant", /phase: phaseDeLaCarte\(agent\.cardId, agent\.role\),/],
  ["le plan rendu, posé comme un moment à part", /cle: `plan:\$\{runState\.messageId\}`/],
];
const manquants = attendus.filter(([, motif]) => !motif.test(runtime)).map(([nom]) => nom);
if (manquants.length) refuser(`le runtime n’alimente pas le journal pour : ${manquants.join(', ')}`);
else constater('le runtime écrit ses jalons, ses étapes et ses points de travail au journal');

const ws = lire('server/src/ws.ts');
if (!/case 'card\.journal'/.test(ws)) refuser('la commande `card.journal` n’est pas servie');
else constater('le document entier se demande par la commande `card.journal`');

/* ------------------------------------------------------------------ */
/* 3. L'écran : le flux en cinq points                                 */
/* ------------------------------------------------------------------ */

/*
 * LA CONVERSATION D'UNE CARTE EST SON PARCOURS, EN CINQ GRANDS POINTS. Le
 * document est demandé une fois par la conversation (`card.journal`, avec le
 * carnet de mémoire), puis suivi en direct (`journal.entree`, `carnet.lignes`).
 * Le flux (`flux-en-points.tsx`) ne fait que dessiner ce que la règle pure
 * `pointsDuParcours` a décidé.
 */
const onglet = lire('web/src/components/flux-en-points.tsx');
/* LE JOURNAL SE DEMANDE DEPUIS LE MAGASIN, plus depuis l'écran : `client.ts`
   porte l'appel `card.journal`, la conversation ne fait que le lire. */
const conversation = lire('web/src/components/chat.tsx') + lire('web/src/lib/client.ts');
if (!/type: 'card\.journal'/.test(conversation)) refuser('la conversation ne demande pas le journal au serveur');
else if (!/pointsDuParcours\(/.test(conversation) || !/fluxDuParcours\(points\)/.test(conversation)) {
  refuser('les passages du flux ne sont pas montés par la règle pure `pointsDuParcours`');
} else if (!/data-point-bascule/.test(onglet) || !/data-bloc-raconte-detail/.test(onglet)) {
  refuser('les points, ou leurs traces, ne se déplient pas');
} else {
  constater('la conversation charge le document entier et le monte en cinq points par la règle pure ; chaque point et chaque trace se déplient');
}

const client = lire('web/src/lib/client.ts');
if (!/case 'journal\.entree'/.test(client)) {
  refuser('l’écran ne suit pas les ajouts diffusés : le flux ne grandirait pas à vue');
} else if (!/case 'carnet\.lignes'/.test(client)) {
  refuser('l’écran ne suit pas les lignes du carnet de mémoire : le point ne raconterait pas la mémoire à l’instant où elle est servie');
} else {
  constater('chaque entrée et chaque ligne de carnet diffusées mettent le flux à jour sans redemander le document');
}

/* PLUS AUCUN BANDEAU TECHNIQUE D'ANCIEN PASSAGE, PLUS AUCUN BOUTON COPIER /
   EXPORTER — nulle part, point « Plan » compris. Le passage RACONTE, il
   n'exporte plus.

   À NE PAS CONFONDRE avec le volet « Détails techniques » de la COMPRÉHENSION,
   arrivé depuis : celui-là est voulu — c'est le second registre, replié sous le
   texte clair, qui part à l'agent d'exécution. Il est vérifié juste en dessous. */
const restes = ['data-point-copier', 'data-point-exporter', 'data-point-boutons-secondaires', 'data-point-traces']
  .filter((repere) => onglet.includes(repere));
if (restes.length) {
  refuser(`le bandeau technique ou ses boutons vivent encore dans le flux : ${restes.join(', ')}`);
} else if (/documentExporte|nomDuFichierExport|reglagesDuTour/.test(onglet)) {
  refuser('l’écran appelle encore les règles d’export ou les réglages du tour, que plus rien n’affiche');
} else {
  constater('plus de bandeau technique de passage, plus de Copier ni d’Exporter : le passage se raconte, il ne s’exporte plus');
}

/* LE SECOND REGISTRE DE LA COMPRÉHENSION : un volet REPLIÉ par défaut, sous le
   texte clair, qui dit d'un coup d'œil ce qu'il porte. Une compréhension
   d'avant ce changement n'en a pas : la flèche ne s'affiche alors pas. */
if (!/data-comprehension-technique=/.test(onglet) || !/data-comprehension-technique-bascule/.test(onglet)) {
  refuser('le volet « Détails techniques » de la compréhension n’existe pas dans le flux');
} else if (!/ouvert' : 'replie'/.test(onglet)) {
  refuser('le volet technique ne naît pas REPLIÉ');
} else if (!/lirePartieTechnique\(lu\.partieTechnique\)/.test(onglet)) {
  refuser('le volet ne lit pas la part technique du jalon de SON tour');
} else {
  constater('la compréhension porte son second registre, replié, et il ne s’affiche que s’il existe');
}

/* LES BLOCS RACONTÉS, DÉPLIÉS D'OFFICE, ET LEUR RÈGLE PURE. */
const recit = lire('shared/src/recit-du-tour.ts');
if (!/data-bloc-raconte=/.test(onglet) || !/data-bloc-raconte-genre=/.test(onglet)) {
  refuser('les blocs racontés ne sont pas dessinés dans le passage');
} else if (!/recitDuPoint\(entrees\)/.test(onglet)) {
  refuser('le récit du passage est refait dans l’écran au lieu de suivre la règle pure `recitDuPoint`');
} else if (!/data-bloc-raconte-vignette/.test(onglet) || !/api\/capture/.test(onglet)) {
  refuser('une capture d’écran regardée n’affiche pas sa vignette');
} else if (!/CARTONS_MONTRES_D_OFFICE/.test(recit) || !/montresDOffice/.test(recit)) {
  refuser('rien ne plafonne l’AFFICHAGE des blocs : un tour de cinquante actions redeviendrait un mur');
} else if (!/data-blocs-repli=/.test(onglet) || !/voir les \{v0\} précédentes/.test(onglet)) {
  refuser('le repli « voir les N précédentes » n’est pas dessiné au-dessus des blocs d’un passage');
} else if (!/recit\.blocs\.slice\(caches\)/.test(onglet)) {
  refuser('le repli cache les DERNIÈRES actions : ce sont les plus anciennes qui doivent se replier');
} else {
  constater('chaque passage se lit en blocs racontés, vignette comprise ; les 15 derniers restent visibles, les plus anciens se replient au-dessus');
}

const panneauCarte = lire('web/src/components/card-panel.tsx');
if (!/<FluxEnPoints/.test(conversation)) {
  refuser('le flux en points n’est pas posé dans la conversation de la carte');
} else if (/value="journal"/.test(panneauCarte)) {
  refuser('l’onglet « Parcours » est encore posé sur la carte : la même histoire s’y lit deux fois');
} else if (fs.existsSync(path.join(RACINE, 'web/src/components/journal-carte.tsx'))) {
  refuser('l’ancien journal ligne par action existe encore à côté du flux en points');
} else {
  constater('le flux en points EST la conversation de la carte, et l’ancien journal ligne par action a disparu');
}

/* ------------------------------------------------------------------ */
/* 4. LES CINQ POINTS : GRANDS RONDS, PHRASE SIMPLE, TRACES REPLIÉES  */
/* ------------------------------------------------------------------ */

/*
 * La carte promet CINQ GRANDS POINTS à icône lisible, chacun avec une phrase
 * simple, ses traces repliées, et une seule ligne verticale. Trois choses
 * peuvent le trahir sans qu'aucun type ne bronche : un rond redevenu petit,
 * une phrase devinée dans l'écran au lieu de la règle pure, des traces
 * affichées d'office.
 */
if (!/data-flux-liste/.test(onglet) || !/absolute bottom-6 top-6 w-px/.test(onglet)) {
  refuser('la ligne verticale n’est pas posée UNE fois sur le flux entier');
} else if (!/h-10 w-10/.test(onglet) || !/ICONE_DE_L_ETAPE/.test(onglet)) {
  refuser('les ronds des points ne sont pas grands, ou n’ont pas d’icône par étape');
} else if (!/data-point-phrase/.test(onglet) || !/t\(point\.phrase\)/.test(onglet)) {
  refuser('la phrase simple d’un point n’est pas celle de la règle pure');
} else if (!/data-blocs-racontes=/.test(onglet)) {
  refuser('un point ouvert ne montre pas ses blocs racontés');
} else {
  constater('cinq grands ronds à icône, une phrase simple par point, un récit déplié, une seule ligne verticale');
}

/*
 * La règle pure, éprouvée : sept étapes, chaque entrée sous UNE d'elles.
 * « Configuration » ouvre la marche (avec quoi la carte va tourner) et
 * « Préparation » se glisse entre le plan et le travail (le temps du
 * lancement) : ni l'une ni l'autre ne reçoit d'entrée du journal.
 */
const ETAPES = [...partage.ETAPES_DU_PARCOURS];
if (ETAPES.join(',') !== 'configuration,demande,comprehension,plan,preparation,travail,rapport') {
  refuser(`les sept étapes ne sont pas celles attendues : ${ETAPES.join(',')}`);

} else if (partage.etapeDeLEntree({ nature: 'jalon', libelle: 'Demande', phase: 'cadrage' }, false) !== 'demande') {
  refuser('la demande ne va pas sous le point « Demande »');
} else if (partage.etapeDeLEntree({ nature: 'requete', outil: 'Read', phase: 'cadrage', agentRole: 'cadrage' }, false) !== 'comprehension') {
  refuser('une lecture du cadrage ne va pas sous le point « Compréhension »');
} else if (partage.etapeDeLEntree({ nature: 'requete', outil: 'Read', phase: 'cadrage', agentRole: 'cadrage' }, true) !== 'plan') {
  refuser('une lecture du cadrage après la demande de plan ne va pas sous le point « Plan »');
} else if (partage.etapeDeLEntree({ nature: 'requete', outil: 'Bash', phase: 'execution' }, true) !== 'travail') {
  refuser('une commande d’exécution ne va pas sous le point « Travail »');
} else if (partage.etapeDeLEntree({ nature: 'jalon', libelle: 'Réponse rendue', phase: 'rapport', agentRole: 'task' }, true) !== 'rapport') {
  refuser('le compte rendu ne va pas sous le point « Rapport »');
} else {
  constater('chaque entrée du journal va sous UN des points du parcours, par la règle pure');
}

/* Les états : orange en cours, bleu fait, jaune question, rouge erreur — décidés par la règle. */
const journalCadrage = [
  { id: 'd', cardId: 'c', rang: 0, phase: 'cadrage', nature: 'jalon', at: 1, libelle: 'Demande', resultat: 'd', agentRole: 'cadrage' },
  { id: 'q', cardId: 'c', rang: 1, phase: 'cadrage', nature: 'requete', at: 2, libelle: 'ask_user', outil: 'ask_user', params: '{"question":"?"}', resultat: 'Question posée à l’utilisateur. ARRÊTE-TOI ICI.', agentRole: 'cadrage' },
];
const enQuestion = partage.pointsDuParcours(journalCadrage, { chapitre: 'cadrage', colonne: 'planned', tourEnCours: false, parcours: null, questionsOuvertes: 1 });
const fluxEnQuestion = partage.fluxDuParcours(enQuestion);
const passageDe = (points, etape) => points.filter((p) => p.etape === etape).at(-1);
if (passageDe(enQuestion, 'comprehension').etat !== 'question') {
  refuser('une question ouverte ne met pas son point en jaune');
/* CINQ POINTS : cette carte n'a jamais demandé de plan, son point n'existe
   donc pas dans le flux, et la question n'a plus de point à elle. */
} else if (fluxEnQuestion.map((f) => f.sorte).join(',') !== 'point,point,point,point,point') {
  refuser(`la question ouverte ne doit plus avoir de point à part dans le flux : ${fluxEnQuestion.map((f) => f.sorte).join(',')}`);
} else if (/data-point-question=/.test(onglet)) {
  refuser('l’écran dessine encore la question ouverte une seconde fois dans le fil');
} else {
  constater('une question ouverte met son point en jaune, et ne se lit qu’une fois : dans le panneau de décision');
}

const interrompu = [
  ...journalCadrage.map((e) => ({ ...e, phase: 'execution', agentRole: 'task', outil: undefined, nature: 'jalon', libelle: 'Tour lancé' })),
  { id: 'x', cardId: 'c', rang: 5, phase: 'rapport', nature: 'jalon', at: 9, libelle: 'Tour interrompu', resultat: 'Le moteur est tombé.', reussie: false, agentRole: 'task' },
];
const enErreur = partage.pointsDuParcours(interrompu, { chapitre: 'travail', colonne: 'planned', tourEnCours: false, parcours: null, questionsOuvertes: 0 });
const travailEnErreur = passageDe(enErreur, 'travail');
if (travailEnErreur.etat !== 'erreur' || travailEnErreur.erreurs[0]?.action !== 'reprendre') {
  refuser('un tour interrompu ne met pas le point « Travail » en rouge avec le geste « reprendre »');
} else if (!/data-point-erreur=/.test(onglet) || !/data-point-erreur-geste/.test(onglet) || !/demanderLeLancement\(carte\.id\)/.test(onglet)) {
  refuser('l’écran ne dessine pas l’erreur en rouge avec son geste direct');
} else {
  constater('une erreur se lit en rouge dans le point de son étape, avec le geste qui la règle');
}

/* Le plan est un POINT du flux, et CHAQUE VERSION a son propre passage. */
const parcoursCarte = lire('web/src/components/parcours-carte.tsx');
if (!/<BlocDuPlan/.test(onglet) || !/nu/.test(onglet)) {
  refuser('le plan n’est pas un point du flux : le bloc du plan vit encore à part');
} else if (/data-chapitre="plan"/.test(parcoursCarte)) {
  refuser('le bloc du plan garde son ancre d’ancien cadre à part');
} else if (/FriseDuParcours|useDetailsTechniques/.test(parcoursCarte)) {
  refuser('l’ancienne frise ou le bouton « Détails techniques » du plan existent encore');
} else {
  constater('le plan est un point du flux, versionné dans le même point ; plus de frise ni d’ancien bouton « Détails techniques »');
}

/*
 * L'ORDRE EST LE MÊME DANS TOUS LES PASSAGES, PLAN COMPRIS : ce qui a demandé,
 * puis le récit du travail, puis ce que ce travail a rendu. Le cadre du plan
 * était la seule exception — il se lisait AVANT le récit — et cassait la
 * lecture chronologique du fil au seul endroit où on vient décider. Il descend
 * donc en bas du passage ; ce qui a DEMANDÉ la version (`entete`) reste en
 * tête, et le défilement vers le point vise le cadre à sa nouvelle place.
 */
const ordreDuPlan =
  /\{entete\}\s*\{recit\}\s*\{carton\}/.test(onglet) &&
  !/point\.etape === 'plan' \? \(\s*<>\s*\{carton\}/.test(onglet) &&
  /ouverture\.etape === 'plan' \? point\?\.querySelector<HTMLElement>\('\[data-bloc-du-plan\]'\)/.test(onglet);
if (!ordreDuPlan) {
  refuser('le cadre du plan ne se lit pas APRÈS le récit de son passage');
} else if (!/data-plan-rendu-le=/.test(parcoursCarte) || !/dateHeure\(vue\.at\)/.test(parcoursCarte)) {
  refuser('l’entête du plan ne porte pas la date et l’heure de sa version');
} else if (/data-plan-a-decider/.test(parcoursCarte) || TEXTES_TRADUITS.includes('Validez ou refusez ce plan au-dessus du champ de saisie.')) {
  refuser('la ligne « Validez ou refusez ce plan au-dessus du champ de saisie » vit encore, à l’écran ou au dictionnaire');
} else if (partage.PHRASES_DU_POINT.plan.fait !== 'Le plan est prêt.' || !/relisez-le, puis validez et lancez/.test(partage.PHRASE_PLAN_A_DECIDER)) {
  refuser('la phrase du point « Plan » ne dit pas où se décide, ou ne se tait pas quand il n’y a plus rien à décider');
} else {
  constater('le point « Plan » : la demande en tête, le récit, le cadre du plan en bas, la date à droite, et une seule phrase de décision');
}

/*
 * L'HORLOGE DE PROGRAMMATION A QUITTÉ L'ÉCRAN (refonte du 13/11/2026, « on ne l'utilise pas ») : le départ programmé
 * vit toujours côté serveur, mais aucun bouton ne le pose plus depuis la rangée de lancement.
 */
if (/SousBoutonProgrammation|InterrupteurLancementAutomatique/.test(parcoursCarte)) {
  refuser('« Auto » ou l’horloge de programmation sont revenus dans la rangée de lancement');
} else {
  constater('ni « Auto » ni l’horloge de programmation dans la rangée de lancement');
}

/* La barre d'étapes : cinq segments, sans illustration, et un raccourci. */
const barre = lire('web/src/components/barre-etapes.tsx');
if (!/data-segment=\{segment\.etape\}/.test(barre) || /imageDuPersonnage/.test(barre)) {
  refuser('la barre d’étapes n’a pas ses segments, ou garde une illustration');
} else if (!/onAller\(segment\.etape\)/.test(barre) || !/scrollIntoView/.test(onglet) || !/IntersectionObserver/.test(onglet)) {
  refuser('la barre n’est pas un raccourci : toucher un segment ne fait pas défiler, ou le segment actif ne suit pas le point visible');
} else {
  constater('la barre d’étapes est minimale, sans illustration, et chaque segment est un raccourci vers son point');
}

/* Le flux raconte la mémoire : chaque point dit ce que le carnet a inscrit pour son étape. */
if (!/data-point-memoire=/.test(onglet) || !/nomDeLaLigne/.test(onglet) || !/data-point-memoire-phrase/.test(onglet)) {
  refuser('les points ne racontent pas la mémoire que le carnet dit de leur étape');
} else {
  constater('chaque point raconte, replié, la mémoire que son étape a consommée');
}

/* Le point Travail suit le dépôt de la branche à la publication. */
if (!/data-point-depot/.test(onglet) || !/git\\s\+push/.test(onglet) || !/carte\.github\?\.fusionnee/.test(onglet) || !/carte\.deployedAt/.test(onglet)) {
  refuser('le point « Travail » ne suit pas le dépôt de la branche à la publication');
} else {
  constater('le point « Travail » porte ses sous-points de dépôt : branche, copie, commandes, enregistrements, poussées, fusion, mise en ligne');
}

/* ------------------------------------------------------------------ */
/* 6. CE QU'UNE ENTRÉE MONTRE : UN DESSIN PAR SORTE, PLUS DE JSON       */
/* ------------------------------------------------------------------ */

/*
 * Le flux montrait chaque entrée de la même façon : deux pavés `<pre>`, les
 * paramètres en JSON et le texte brut. Trois choses peuvent ramener ce pavé
 * sans qu'aucun type ne bronche : la règle pure qui cesse de reconnaître les
 * noms de paramètres des moteurs (ils changent), l'écran qui réaffiche
 * `entree.params` en direct, et la réponse finale rendue en texte brut alors
 * qu'elle est du markdown.
 */
const contenu = lire('web/src/components/contenu-journal.tsx');

if (!/<ContenuDeLEntree entree=\{entree\} projectId=\{projectId\}[ }]/.test(onglet)) {
  refuser('une trace dépliée ne passe pas par le dessin de sa sorte');
} else if (/titre=\{t\('Paramètres'\)\}/.test(onglet) || /texte=\{entree\.params\}/.test(onglet)) {
  refuser('les paramètres bruts en JSON sont encore affichés sur chaque entrée');
} else if (!/data-contenu-sorte=\{vue\.sorte\}/.test(contenu)) {
  refuser('le contenu d’une entrée ne dit pas de quelle sorte il est');
} else if (!/vueDeLEntree\(entree\)/.test(contenu)) {
  refuser('la sorte d’une entrée est devinée dans l’écran au lieu de suivre la règle pure `vueDeLEntree`');
} else {
  constater('une entrée dépliée montre le dessin de sa sorte, jamais ses paramètres en JSON');
}

/* Chaque sorte a SON dessin : une sorte sans composant ne serait qu'un refuge
   déguisé, et l'entrée retomberait en silence sur une liste de champs. */
const sortes = ['texte', 'demande', 'outil', 'question', 'commande', 'fichier', 'modification', 'memoire', 'recherche', 'web', 'point', 'champs'];
const sansDessin = sortes.filter((sorte) => !new RegExp(`vue\\.sorte === '${sorte}'`).test(contenu));
if (sansDessin.length) refuser(`ces sortes de contenu n’ont pas de dessin : ${sansDessin.join(', ')}`);
else constater(`les ${sortes.length} sortes de contenu ont chacune leur dessin`);

/* LE BLOC D'UN APPEL D'OUTIL : son nom en tête, ses données en dessous. */
if (!/data-contenu-outil-nom/.test(contenu) || !/vue\.nom/.test(contenu)) {
  refuser('un appel d’outil ne dit pas le NOM de l’outil appelé');
} else if (!/Données récupérées/.test(contenu)) {
  refuser('les données rendues par un outil ne sont pas annoncées');
} else if (!/data-contenu-pieces/.test(contenu) || !/<PiecesJointes ids=\{vue\.pieces\}/.test(contenu)) {
  refuser('la demande n’affiche pas ses pièces jointes sous le prompt envoyé');
} else {
  constater('un appel d’outil porte son nom et ses données ; la demande porte ses pièces jointes');
}

/* La règle pure, éprouvée sur les vrais noms de paramètres des moteurs. */
const lectures = [
  [{ nature: 'requete', outil: 'Read', params: '{"file_path":"/a/app.tsx","offset":120}' }, 'fichier'],
  [{ nature: 'requete', outil: 'Bash', params: '{"command":"npm test"}' }, 'commande'],
  [{ nature: 'requete', outil: 'Edit', params: '{"file_path":"/a/b.ts","old_string":"x","new_string":"y"}' }, 'modification'],
  [{ nature: 'requete', outil: 'Grep', params: '{"pattern":"journal"}' }, 'recherche'],
  [{ nature: 'requete', outil: 'WebFetch', params: '{"url":"https://exemple.test"}' }, 'web'],
  [{ nature: 'requete', outil: 'mcp__beluga__ask_user', params: '{"question":"On y va ?"}' }, 'question'],
  [{ nature: 'requete', outil: 'mcp__beluga__memoire', params: '{"geste":"chercher","demande":"cartes"}', resultat: 'des faits' }, 'memoire'],
  [{ nature: 'jalon', libelle: 'Demande', resultat: 'ce que je veux' }, 'texte'],
  [{ nature: 'point', libelle: 'une tâche', etat: 'running' }, 'point'],
  [{ nature: 'requete', outil: 'un_outil_jamais_vu', params: '{"quoi":"ceci"}' }, 'outil'],
  [{ nature: 'requete', params: '{"quoi":"ceci"}' }, 'champs'],
  /* UN OUTIL QUI A RENDU QUELQUE CHOSE dit son NOM, et ses données se lisent
     dessous : le refuge ne nommait jamais l'outil appelé. */
  [{ nature: 'requete', outil: 'coffre_fort', params: '{"action":"lister"}', resultat: 'trois accès' }, 'outil'],
  /* LA DEMANDE PORTE SES PIÈCES JOINTES quand il y en a. */
  [
    { nature: 'jalon', libelle: 'Demande', resultat: 'regarde cette capture', donnees: '{"pieces":["a1"]}' },
    'demande',
  ],
];
const malLues = lectures.filter(([e, attendu]) => partage.vueDeLEntree(e).sorte !== attendu);
if (malLues.length) {
  refuser(`la sorte est fausse pour : ${malLues.map(([e]) => e.outil ?? e.libelle).join(', ')}`);
} else {
  constater('chaque entrée rend la sorte de son contenu, lue sur les vrais noms de paramètres des moteurs');
}

/* AUCUNE ENTRÉE NE RETOMBE SUR DU JSON. Le refuge nomme ses champs ; c'est ce
   qui distingue « Fichier : /a/b.ts » d'un `{"file_path":"/a/b.ts"}` réaffiché. */
/* Un appel d'outil NOMMÉ a désormais son propre bloc ; le refuge garde ce qui
   n'a même pas de nom d'outil — une étape de moteur, une vieille entrée. */
const refuge = partage.vueDeLEntree({ nature: 'requete', params: '{"file_path":"/a/b.ts"}' });
const blocOutil = partage.vueDeLEntree({
  nature: 'requete',
  outil: 'inconnu',
  params: '{"file_path":"/a/b.ts"}',
});
if (refuge.sorte !== 'champs' || refuge.champs[0]?.libelle !== 'Fichier') {
  refuser('le refuge ne NOMME pas les champs qu’il montre : le JSON brut reviendrait par la porte de derrière');
} else if (blocOutil.sorte !== 'outil' || blocOutil.nom !== 'inconnu') {
  refuser('un appel d’outil nommé retombe dans le refuge au lieu d’avoir son propre bloc');
} else if (partage.vueDeLEntree({ nature: 'requete', outil: 'inconnu' }).champs.length !== 0) {
  refuser('une entrée sans rien du tout fabrique des champs qui n’existent pas');
} else {
  constater('le refuge nomme ses champs, et une entrée vide ne s’en invente aucun');
}

/* UNE ÉTAPE OUVERTE MONTRE DIRECTEMENT L'ENCADRÉ DE CHAQUE GESTE — plus de
   sous-ligne à rouvrir (« Lire le module de TVA »), qui redisait la phrase du
   bloc et le texte de l'encadré. L'encadré reçoit la phrase déjà lue
   (`dejaDit`) pour ne pas la redire. Le résumé court reste la règle des lignes
   qui en ont encore une (la question posée du fil). */
if (!/<ContenuDeLEntree entree=\{entree\}[^>]*dejaDit=/.test(onglet) || /data-trace-bascule/.test(onglet)) {
  refuser('une étape ouverte ne montre pas directement ses encadrés : la sous-ligne intermédiaire est revenue');
} else if (partage.resumeDeLEntree({ nature: 'requete', outil: 'Read', params: '{"file_path":"/a/b/app.tsx"}' }) !== 'app.tsx') {
  refuser('le résumé d’une ligne ne rend pas le nom du fichier touché');
} else {
  constater('repliée, chaque ligne dit le fichier, la commande, le sujet ou la question qu’elle porte');
}

/* La réponse finale est du MARKDOWN : rendue en texte brut, un rapport soigné
   se lit avec ses dièses et ses étoiles à l'écran. C'est `RapportEnFlux` qui
   rend chaque section, et c'est LUI qui appelle le markdown. */
const flux = lire('web/src/components/rapport-flux.tsx');
if (!/<Markdown\n\s+content=\{section\.corps\}/.test(flux)) {
  refuser('les sections de la réponse finale sont rendues en texte brut au lieu de markdown');
} else {
  constater('la réponse finale se lit mise en forme, section par section');
}

/* Les mots affichés viennent de catalogues PARTAGÉS, donc traduisibles : un
   libellé inventé dans l'écran échapperait aux cinq langues. */
if (Object.keys(partage.LIBELLE_ETAT_POINT).join(',') !== 'todo,running,done,unfinished') {
  refuser('les quatre états d’un point de travail ne sont pas ceux que les moteurs annoncent');
} else if (partage.libelleDEtat('running') !== 'En cours' || partage.libelleDEtat('inconnu') !== 'inconnu') {
  refuser('l’état d’un point n’est pas dit en français, ou un état inconnu disparaît');
} else if (!partage.LIBELLE_DE_CHAMP.file_path) {
  refuser('le catalogue des libellés de champs est vide : les paramètres reviendraient en anglais technique');
} else {
  constater('les mots des champs et des états viennent de catalogues partagés, traduits dans les cinq langues');
}

/* ------------------------------------------------------------------ */
/* 6. LES COMMANDES QUI SE SUIVENT, ET LA QUESTION QU'ON NE PEUT PAS LOUPER */
/* ------------------------------------------------------------------ */

/*
 * UN MUR DE COMMANDES N'EST PAS UN PARCOURS. Vingt « Commande : … » d'affilée
 * noyaient les vraies étapes. Elles se replient en un seul point — mais
 * SEULEMENT si elles se suivent vraiment : la moindre autre étape coupe la
 * suite. C'est une règle pure, éprouvée ici sur un journal mêlé.
 */
const suite = [
  { id: 'k0', cardId: 'c', rang: 0, phase: 'execution', nature: 'requete', at: 1, outil: 'Bash', libelle: '', dureeMs: 1000 },
  { id: 'k1', cardId: 'c', rang: 1, phase: 'execution', nature: 'requete', at: 2, outil: 'Bash', libelle: '', dureeMs: 2000 },
  { id: 'k2', cardId: 'c', rang: 2, phase: 'execution', nature: 'point', at: 3, libelle: 'une étape' },
  { id: 'k3', cardId: 'c', rang: 3, phase: 'execution', nature: 'requete', at: 4, outil: 'Bash', libelle: '' },
];
/* Le travail de l'agent se replie en UN point : le regroupement des commandes
   se juge donc DANS ce déroulé déplié (`sansBlocDeTravail`). */
const monte = partage.montageDuFlux(suite, { sansBlocDeTravail: true });
const enchainement = monte.map((e) => e.sorte).join(',');
if (enchainement !== 'phase,commandes,entree,entree') {
  refuser(`le regroupement des commandes ne suit pas la continuité : ${enchainement}`);
} else if (monte[1].entrees.length !== 2) {
  refuser('le bloc de commandes ne porte pas les deux commandes qui se suivaient');
} else if (partage.dureeDuGroupe(monte[1].entrees) !== 3000) {
  refuser('le bloc de commandes ne dit pas le temps total de ce qu’il contient');
} else {
  constater('les commandes qui se suivent forment UN point, coupé dès qu’une autre étape s’intercale');
}

/* À L'ÉCRAN, CE REGROUPEMENT EST CELUI DU RÉCIT : des commandes qui se suivent
   font UN bloc raconté, qui les nomme et se déplie d'un cran. */
const recitDeDeuxCommandes = partage.recitDuPoint([
  { id: 'c1', cardId: 'c', rang: 1, phase: 'execution', nature: 'requete', at: 1, outil: 'Bash', libelle: 'Bash', params: '{"command":"npm test"}' },
  { id: 'c2', cardId: 'c', rang: 2, phase: 'execution', nature: 'requete', at: 2, outil: 'Bash', libelle: 'Bash', params: '{"command":"npm run build"}' },
]);
const blocsDeCommandes = recitDeDeuxCommandes.blocs;
/* DEUX COMMANDES QUE RIEN NE DISTINGUE FONT UN SEUL CARTON — c'est ce que dit
   le commentaire ci-dessus, et ce que fige `recit-du-tour.test.ts`. Ce jugement
   lisait encore un `bloc.texte` qui n'existe plus et réclamait DEUX cartons :
   il refusait donc un récit juste. Il lit maintenant la forme d'aujourd'hui —
   un carton, son compte, la LISTE de ses sujets. */
if (blocsDeCommandes.length !== 1 || blocsDeCommandes[0].compte !== 2) {
  refuser('deux commandes voisines ne font pas UN carton : le récit ne réunit plus rien');
} else if (blocsDeCommandes[0].titre.motif !== '{v0} commandes lancées') {
  refuser(`le carton de deux commandes ne se nomme pas au pluriel : ${blocsDeCommandes[0].titre.motif}`);
} else if (blocsDeCommandes[0].sujets.join(' | ') !== 'npm test | npm run build') {
  refuser(`le carton ne porte pas la liste de ses commandes : ${blocsDeCommandes[0].sujets.join(' | ')}`);
} else if (recitDeDeuxCommandes.montresDOffice !== 1) {
  refuser('le récit ne dit pas combien de cartons se montrent d’office');
} else if (!/data-bloc-raconte-bascule/.test(onglet) || !/data-bloc-raconte-detail/.test(onglet) || /<LigneDeTrace/.test(onglet)) {
  refuser('le détail exact d’un bloc raconté n’est plus atteignable d’un seul cran');
} else {
  constater('des commandes voisines font UN carton, qui les nomme et garde son détail d’un cran');
}

/*
 * CE QUI SÉPARE DEUX GESTES, C'EST L'INTENTION QUE L'AGENT Y A MISE.
 *
 * Le fil RACONTE : la `description` que le moteur joint à sa commande devient
 * la phrase du carton (`shared/src/phrases-du-recit.ts`). Deux intentions
 * différentes ne peuvent donc plus se fondre en « 2 commandes lancées » — ce
 * serait perdre les deux seules choses qu'on venait lire. Et rien de technique
 * ne remonte au premier niveau : ni chemin, ni ligne de commande.
 */
const recitRaconte = partage.recitDuPoint([
  { id: 'r1', cardId: 'c', rang: 1, phase: 'execution', nature: 'requete', at: 1, outil: 'Bash', libelle: 'Bash', params: '{"command":"npm test","description":"vérifier que les tests passent"}' },
  { id: 'r2', cardId: 'c', rang: 2, phase: 'execution', nature: 'requete', at: 2, outil: 'Bash', libelle: 'Bash', params: '{"command":"npm run build","description":"reconstruire le projet"}' },
  { id: 'r3', cardId: 'c', rang: 3, phase: 'execution', nature: 'requete', at: 3, outil: 'Read', libelle: 'Read', params: '{"file_path":"/root/beluga/web/src/app.tsx"}' },
]);
const ditEnPhrases = recitRaconte.blocs.map((bloc) => partage.phraseDuBloc(bloc));
/* LE CADRE EST À LA PREMIÈRE PERSONNE : les mots de l'agent s'y enchâssent,
   ils ne sont pas réécrits. Une note, elle, est déjà une phrase entière. */
const enPremiereePersonne = ditEnPhrases.every((phrase) =>
  phrase.dit === 'agent' ? true : /^J(?:e |’)/u.test(phrase.motif),
);
const technique = ditEnPhrases.find((phrase) =>
  /\/|npm |\.tsx/.test(phrase.dit === 'agent' ? phrase.texte : String(phrase.valeurs?.v0 ?? '')),
);
if (recitRaconte.blocs.length !== 3) {
  refuser(`deux intentions différentes se fondent encore : ${recitRaconte.blocs.length} carton(s) pour 3 gestes`);
} else if (!enPremiereePersonne) {
  refuser('le premier niveau du récit ne parle pas à la première personne');
} else if (technique) {
  refuser('du technique remonte au premier niveau du récit');
} else if (!/data-bloc-raconte-phrase/.test(onglet) || !/data-point-technique/.test(onglet)) {
  refuser('l’écran n’affiche plus la phrase du récit, ou a perdu son bouton de vue technique');
} else {
  constater('le fil raconte à la première personne, sans technique, et la vue technique reste à un bouton');
}

/* LE POINT « TRAVAIL » SE LIT À TROIS NIVEAUX : Réflexion, les points de la
   liste de tâches avec leur durée, puis les actions sous chacun. */
const sousPointsDuTravail = partage.travailEnSousPoints([
  { id: 't1', cardId: 'c', rang: 1, phase: 'execution', nature: 'requete', at: 1, outil: 'Bash', libelle: 'Bash', params: '{"command":"git status"}' },
  { id: 't2', cardId: 'c', rang: 2, phase: 'execution', nature: 'point', at: 2, libelle: 'Lire les fichiers', etat: 'running', donnees: '{"rang":1,"sur":2,"debutLe":2,"finLe":9}' },
  { id: 't3', cardId: 'c', rang: 3, phase: 'execution', nature: 'requete', at: 3, outil: 'Read', libelle: 'Read', params: '{"file_path":"/x/a.ts"}', reussie: false },
]);
if (sousPointsDuTravail.length !== 2 || sousPointsDuTravail[0].sorte !== 'reflexion') {
  refuser('le travail ne se découpe pas en « Réflexion » puis les points de la liste de tâches');
} else if (sousPointsDuTravail[1].dureeMs !== 7) {
  refuser('un point de la liste de tâches n’affiche pas sa durée, pourtant écrite dans le journal');
} else if (sousPointsDuTravail[1].enEchec !== true) {
  refuser('une action refusée ne marque pas le sous-point où elle a eu lieu');
} else if (!/data-travail-sous-points=/.test(onglet) || !/data-sous-point-duree=/.test(onglet)) {
  refuser('le sous-fil du point « Travail » n’est pas dessiné dans l’écran');
} else {
  constater('le point « Travail » se lit à trois niveaux : Réflexion, les points de la liste avec leur durée, leurs actions dessous');
}

/* LE COMPTE RENDU N'ANNONCE PLUS SON GABARIT, et son entête se cale au bord. */
const rapportFlux = lire('web/src/components/rapport-flux.tsx');
if (/data-rapport-gabarit/.test(onglet)) {
  refuser('la ligne technique du gabarit vit encore dans le point « Compte rendu »');
} else if (!/enteteSansRetrait/.test(onglet) || !/enteteSansRetrait/.test(rapportFlux)) {
  refuser('l’entête du compte rendu garde son retrait dans le fil de la carte');
} else {
  constater('le compte rendu n’annonce plus son gabarit, et son entête se cale au bord gauche dans le fil');
}

/*
 * CE QUE L'AGENT FAIT N'EST PAS UN MOMENT DU PARCOURS. « Tour lancé »,
 * « Commande : … », les lectures et les points de la liste de tâches se
 * rangeaient entre le plan et la réponse finale, où l'on vient lire ce qui a
 * été RENDU. Ils se replient en un seul point, fermé au départ — sauf ce qui
 * réclame les yeux : une question, un échec.
 */
const avecQuestion = [
  ...suite,
  { id: 'k4', cardId: 'c', rang: 4, phase: 'execution', nature: 'requete', at: 5, outil: 'ask_user', libelle: 'Question posée' },
  { id: 'k5', cardId: 'c', rang: 5, phase: 'execution', nature: 'requete', at: 6, outil: 'Read', libelle: 'Lecture' },
];
const replie = partage.montageDuFlux(avecQuestion).map((e) => e.sorte).join(',');
if (replie !== 'phase,travail,entree,travail') {
  refuser(`le travail de l’agent ne se replie pas en un point, ou la question s’y perd : ${replie}`);
} else if (!/data-blocs-racontes=/.test(onglet)) {
  refuser('l’écran ne raconte pas le travail de la machine dans le point');
} else {
  constater('le travail de l’agent se replie en un point, et ce qui réclame les yeux reste dehors');
}

/*
 * LE CADRAGE SE LIT COMME L'EXÉCUTION : ses jalons — la demande, la
 * compréhension rendue, le plan rendu — au premier niveau, et sa machine
 * repliée sous « Travail de l'agent ». Plus aucune timeline relue dans le
 * texte (`montageDuFlux`, règle pure).
 */
const cadrageMonte = partage.montageDuFlux([
  { id: 'c0', cardId: 'x', rang: 0, phase: 'cadrage', nature: 'jalon', at: 1, libelle: 'Demande', resultat: 'd' },
  { id: 'c1', cardId: 'x', rang: 1, phase: 'cadrage', nature: 'requete', at: 2, libelle: 'Mémoire', outil: 'memoire' },
  { id: 'c2', cardId: 'x', rang: 2, phase: 'cadrage', nature: 'jalon', at: 3, libelle: partage.JALON_COMPREHENSION, resultat: 'compris' },
  { id: 'c3', cardId: 'x', rang: 3, phase: 'cadrage', nature: 'jalon', at: 4, libelle: partage.JALON_PLAN_PROPOSE, resultat: '# P' },
]);
const sortesDuCadrage = cadrageMonte.map((e) => e.sorte).join(',');
if (sortesDuCadrage !== 'phase,entree,travail,comprehension,plan') {
  refuser(`le cadrage ne se lit pas comme l’exécution : ${sortesDuCadrage}`);
} else if (!/data-moment="comprehension"/.test(onglet)) {
  refuser('l’écran n’a pas de moment de compréhension');
} else {
  constater('le cadrage se lit par ses jalons ; sa machine se replie sous le travail de l’agent');
}

/*
 * LE NOM D'UN OUTIL SE LIT EN FRANÇAIS. « Outil ToolSearch » et
 * « mcp__beluga__… » sont des noms de fonctions : personne, hors du code, ne
 * sait ce qu'ils désignent.
 */
if (partage.libelleDOutil('ToolSearch') !== 'Recherche d’un outil') {
  refuser('la table des noms d’outils ne traduit pas les outils du moteur');
} else if (partage.libelleLisible({ libelle: 'Outil ToolSearch' }) !== 'Recherche d’un outil') {
  refuser('un libellé technique déjà écrit dans le journal n’est pas remplacé à l’affichage');
} else if (!/libelleLisible\(entree\)/.test(lire('web/src/components/contenu-journal.tsx'))) {
  refuser('l’écran affiche encore le libellé brut de l’entrée au lieu du nom lisible de l’outil');
} else {
  constater('chaque outil porte son nom en français, dans le journal comme à l’écran');
}

/*
 * LES POINTS DU FLUX RESPIRENT, SANS QUOI LA LIGNE VERTICALE DISPARAÎT. Les
 * ronds font 28 px : collés les uns aux autres, ils ne laissaient rien voir du
 * trait qui les relie.
 */
if (!/className="[^"]*space-y-[^"]*" data-bloc-raconte-texte data-bloc-raconte-detail/.test(onglet)) {
  refuser('aucun écart n’est posé entre deux encadrés d’une étape ouverte : ils se collent en un seul pavé');
} else {
  constater('chaque point du flux s’écarte du suivant, et la ligne verticale se voit entre eux');
}

/*
 * TOUT CE QUI ATTEND L'UTILISATEUR TIENT DANS UN SEUL PANNEAU — question,
 * erreur de tour, reprise de compte, incident du parcours —, posé JUSTE
 * au-dessus de la barre d'écriture, hors de la zone qui défile. Déployé
 * d'office, il se replie à la main sans jamais disparaître.
 */
const panneau = fs.readFileSync(path.join(RACINE, 'web/src/components/parcours-carte.tsx'), 'utf8');
if (!/data-panneau-decision/.test(panneau)) {
  refuser('aucune décision ne se prend sur une carte : le panneau n’existe pas');
} else if (!/data-panneau-bascule/.test(panneau) || !/const \[replie, setReplie\] = React\.useState\(false\)/.test(panneau)) {
  refuser('le panneau de décision ne se replie pas, ou n’est pas déployé au départ');
} else if (!/data-panneau-intitule/.test(panneau)) {
  refuser('replié, le panneau ne dit plus ce qui attend');
} else if (!/classeEnveloppe="max-h-\[45vh\]"/.test(panneau)) {
  refuser('le panneau de décision n’a pas de hauteur bornée : il chasserait la barre d’écriture de l’écran');
} else if (!/ErreurDeTourCard/.test(panneau) || !/RepriseDeCompteCard/.test(panneau) || !/data-incident-parcours/.test(panneau)) {
  refuser('le panneau ne porte pas l’erreur de tour, la reprise de compte et l’incident du parcours');
} else {
  constater('tout ce qui attend une décision vit dans un seul panneau, au-dessus de la barre d’écriture');
}

const panneauAvantSaisie = conversation.indexOf('<PanneauDeDecision') < conversation.indexOf('{barreDEcriture}\n      </div>');
if (!panneauAvantSaisie) {
  refuser('le panneau de décision n’est pas collé au-dessus de la barre d’écriture');
} else {
  constater('le panneau est posé hors de la zone qui défile, entre le parcours et la saisie');
}

/* ------------------------------------------------------------------ */

for (const c of constats) console.log(`  ✓ ${c}`);
for (const e of echecs) console.error(`  ✗ ${e}`);
if (echecs.length) {
  console.error(`\n${echecs.length} contrôle(s) en échec.`);
  process.exit(1);
}
console.log(`\n${constats.length} contrôles tenus : le journal du cycle complet d'une carte tient debout.`);
