import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COLONNES_HORS_REPRISE,
  COLUMN_KEYS,
  MACHINE_ONLY_TARGETS,
  ROLES_QUI_CLOTURENT,
  ROLES_QUI_DEPLACENT,
  canMove,
  colonneApresMoteurMuet,
  colonneAuDemarrage,
  colonneDeReprise,
  colonneEnFinDeTour,
  demarrageAutomatiqueAutorise,
  issueDeCarteOubliee,
  effetDuDepot,
  etatVisuelCarte,
  gesteCarte,
  mentionArchivage,
  repriseAutorisee,
  sortieAutorisee,
  RAISON_DEJA_LIVRE,
  RAISON_MOTEUR_INJOIGNABLE,
  RAISON_SANS_MODIFICATION,
  RAISON_SUSPENDU,
  RAISON_TOUR_SANS_ISSUE,
  RAISON_TRACE_INCONNUE,
  RAISON_TRAVAIL_SAUVE,
  estLaBrancheDeLaCarte,
  natureDeLaMention,
  nomDeBranche,
  issueDeFinDeTour,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* La carte suit les étapes réelles du travail                          */
/* ------------------------------------------------------------------ */

/* -------- Le tour d'exécution démarre -------- */

test('une carte terminée sur laquelle on relance une exécution repasse en cours', () => {
  assert.equal(colonneAuDemarrage('done', 'task'), 'running');
});

test('une carte en amont du parcours part en cours quand l’exécution démarre', () => {
  for (const depart of ['notes', 'planned'] as const) {
    assert.equal(colonneAuDemarrage(depart, 'task'), 'running', `depuis « ${depart} »`);
  }
});

test('une carte déjà en cours ne bouge pas : rien à annoncer', () => {
  assert.equal(colonneAuDemarrage('running', 'task'), null);
});

test('une carte prête à publier ou archivée ne sort pas de son rangement', () => {
  // Poser une question dans sa conversation ne doit pas la retirer du lot.
  assert.equal(colonneAuDemarrage('to_deploy', 'task'), null);
  assert.equal(colonneAuDemarrage('in_production', 'task'), null);
  assert.equal(colonneAuDemarrage('archived', 'task'), null);
  assert.deepEqual(COLONNES_HORS_REPRISE, ['to_deploy', 'in_production', 'archived']);
});

/* -------- Le tour d'exécution se termine -------- */

test('un tour d’exécution réussi pose la carte en terminé', () => {
  assert.equal(colonneEnFinDeTour('running', true, 'task', true), 'done');
});

test('un tour d’exécution en échec ne déplace rien : le travail n’est pas fait', () => {
  assert.equal(colonneEnFinDeTour('running', false, 'task', true), null);
  for (const depart of ['notes', 'planned', 'done'] as const) {
    assert.equal(colonneEnFinDeTour(depart, false, 'task', true), null, `depuis « ${depart} »`);
  }
});

test('une carte qui n’était pas en cours n’est pas déclarée terminée', () => {
  for (const depart of COLUMN_KEYS.filter((c) => c !== 'running')) {
    assert.equal(colonneEnFinDeTour(depart, true, 'task', true), null, `depuis « ${depart} »`);
  }
});

/* -------- Pas de code modifié, pas de « Terminé » -------- */

test('un tour qui n’a rien modifié dans le dépôt ne clôt pas la carte', () => {
  // Le défaut d'origine : répondre suffisait à clore la carte.
  assert.equal(colonneEnFinDeTour('running', true, 'task', false), null);
});

test('le même tour, avec du code enregistré, pose bien la carte en terminé', () => {
  assert.equal(colonneEnFinDeTour('running', true, 'task', true), 'done');
});

test('depuis n’importe quelle colonne, sans modification aucune clôture', () => {
  for (const depart of COLUMN_KEYS) {
    assert.equal(colonneEnFinDeTour(depart, true, 'task', false), null, `depuis « ${depart} »`);
  }
});

/* -------- L'issue du tour : rien ne reste coincé en « En cours » -------- */

test('un tour qui a modifié le dépôt ferme la carte, sans rien à expliquer', () => {
  assert.deepEqual(issueDeFinDeTour('running', true, 'task', 'oui', false), {
    colonne: 'done',
    raison: null,
    retenue: false,
  });
});

test('rien à changer parce que c’était DÉJÀ livré : la carte se range et le dit', () => {
  // Le bogue rapporté : la carte gardait la coche du travail rendu tout en
  // restant comptée dans « EN COURS », sans un mot.
  assert.deepEqual(issueDeFinDeTour('running', true, 'task', 'non', true), {
    colonne: 'done',
    raison: RAISON_DEJA_LIVRE,
    retenue: false,
  });
  assert.match(RAISON_DEJA_LIVRE, /livré lors d’un tour précédent/);
});

test('une carte NEUVE dont rien n’a bougé redescend en file avec sa raison', () => {
  // Jamais rien produit : pas de « Terminé » — mais pas de blocage non plus.
  assert.deepEqual(issueDeFinDeTour('running', true, 'task', 'non', false), {
    colonne: 'planned',
    raison: RAISON_SANS_MODIFICATION,
    retenue: true,
  });
  assert.match(RAISON_SANS_MODIFICATION, /aucun fichier/);
});

test('une carte renvoyée en file est RETENUE : elle ne repart pas en boucle', () => {
  // Sans cette retenue, l'ordonnanceur (attempts > 0) relancerait le même tour
  // vide toutes les quinze secondes.
  for (const trace of ['non', 'inconnue'] as const) {
    const issue = issueDeFinDeTour('running', true, 'task', trace, false);
    assert.equal(issue.colonne, 'planned', `trace « ${trace} »`);
    assert.equal(issue.retenue, true, `trace « ${trace} »`);
  }
});

test('un dépôt qu’on n’a pas pu consulter n’est pas « rien n’a bougé »', () => {
  // Deux phrases différentes : une observation, et son absence.
  assert.equal(issueDeFinDeTour('running', true, 'task', 'inconnue', true).raison, RAISON_TRACE_INCONNUE);
  assert.notEqual(RAISON_TRACE_INCONNUE, RAISON_SANS_MODIFICATION);
});

test('échec, rôle qui n’exécute pas, colonne autre : l’issue ne touche à rien', () => {
  // L'échec est déjà dit en rouge, et la carte reste là où on la relance.
  assert.deepEqual(issueDeFinDeTour('running', false, 'task', 'non', false).colonne, null);
  for (const role of ['analysis', 'orchestrator', 'deploy'] as const) {
    assert.equal(issueDeFinDeTour('running', true, role, 'non', false).colonne, null, `rôle « ${role} »`);
  }
  for (const depart of COLUMN_KEYS.filter((c) => c !== 'running')) {
    assert.equal(issueDeFinDeTour(depart, true, 'task', 'non', false).colonne, null, `depuis « ${depart} »`);
  }
});

test('rien à publier, rien dans le lot : « À déployer » se gagne par « Terminé »', () => {
  // Le lot à publier se remplit depuis « Terminé ». Une carte qui n'y arrive
  // jamais faute de code modifié ne peut donc pas entrer dans le lot.
  assert.equal(colonneEnFinDeTour('running', true, 'task', false), null);
  assert.equal(canMove('machine', 'running', 'to_deploy').allowed, false);
});

/* -------- Seul l'agent d'exécution déplace la carte -------- */

test('une analyse qui démarre laisse la carte validée où elle est', () => {
  // Le défaut d'origine : la carte sautait en « En cours » dès l'analyse.
  // La carte validée attend son chiffrage DANS « Planifié », la colonne où elle
  // naît : plus de colonne « Validé » ni de colonne « À faire » à traverser.
  assert.equal(colonneAuDemarrage('planned', 'analysis'), null);
  for (const depart of COLUMN_KEYS) {
    assert.equal(colonneAuDemarrage(depart, 'analysis'), null, `depuis « ${depart} »`);
  }
});

test('un tour d’analyse réussi ne clôt pas la carte : rien n’a été exécuté', () => {
  assert.equal(colonneEnFinDeTour('running', true, 'analysis', true), null);
  assert.equal(colonneEnFinDeTour('planned', true, 'analysis', true), null);
});

test('ni l’orchestration ni la publication ne déplacent une carte', () => {
  for (const role of ['orchestrator', 'deploy'] as const) {
    assert.equal(colonneAuDemarrage('planned', role), null, `démarrage « ${role} »`);
    assert.equal(colonneAuDemarrage('done', role), null, `démarrage « ${role} »`);
    assert.equal(colonneEnFinDeTour('running', true, role, true), null, `fin « ${role} »`);
  }
});

test('la liste des rôles qui déplacent se réduit à l’exécution', () => {
  assert.deepEqual(ROLES_QUI_DEPLACENT, ['task']);
  // Clore et déplacer, c'est la même liste : un seul rôle décide.
  assert.deepEqual(ROLES_QUI_CLOTURENT, ROLES_QUI_DEPLACENT);
});

/* -------- Le parcours complet -------- */

test('validé, analyse, exécution : la carte ne bouge qu’au bon moment', () => {
  // 1. L'analyse démarre sur une carte validée : elle reste dans « Planifié ».
  assert.equal(colonneAuDemarrage('planned', 'analysis'), null);
  // 2. L'analyse rend son chiffrage : ces règles ne la déplacent toujours pas
  //    — la carte chiffre SUR PLACE, il n'y a plus de promotion à faire.
  assert.equal(colonneEnFinDeTour('planned', true, 'analysis', true), null);
  // 3. L'ordonnanceur lance l'exécution : la carte passe en cours.
  assert.equal(colonneAuDemarrage('planned', 'task'), 'running');
  // 4. L'exécution rend son rapport : terminé.
  assert.equal(colonneEnFinDeTour('running', true, 'task', true), 'done');
});

test('terminé puis relancé puis terminé : la carte fait l’aller-retour', () => {
  const apresPremierTour = colonneEnFinDeTour('running', true, 'task', true);
  assert.equal(apresPremierTour, 'done');
  // Un message dans la conversation de l'agent d'EXÉCUTION la relance.
  const relance = colonneAuDemarrage(apresPremierTour!, 'task');
  assert.equal(relance, 'running');
  assert.equal(colonneEnFinDeTour(relance!, true, 'task', true), 'done');
});

/* -------- Cohérence avec les droits de déplacement -------- */

test('la machine a le droit de poser une carte en terminé', () => {
  assert.equal(MACHINE_ONLY_TARGETS.includes('done'), true);
  assert.equal(canMove('machine', 'running', 'done').allowed, true);
});

test('l’ordonnanceur ne pousse jamais une carte vers une étape de publication', () => {
  // Ce qui protège la dépense n'est plus une colonne interdite — « À faire » a
  // disparu —, c'est la règle de pause. Ici on garde l'autre garde-fou : la
  // machine ne promeut que dans le pipeline d'exécution.
  assert.equal(canMove('machine', 'planned', 'to_deploy').allowed, false);
  assert.equal(canMove('machine', 'planned', 'in_production').allowed, false);
  assert.equal(canMove('machine', 'planned', 'running').allowed, true);
});

/* ------------------------------------------------------------------ */
/* Le dépôt d'une carte à la main vaut un geste                         */
/* ------------------------------------------------------------------ */

test('déposer une carte dans « En cours » vaut un lancement, d’où qu’elle vienne', () => {
  for (const depart of ['notes', 'planned', 'done'] as const) {
    assert.equal(effetDuDepot(depart, 'running'), 'lancer', `depuis « ${depart} »`);
  }
});

test('sortir une carte de « En cours » vers « Planifié » suspend son agent', () => {
  assert.equal(effetDuDepot('running', 'planned'), 'suspendre');
});

test('les autres sorties de « En cours » restent de simples rangements', () => {
  // Elles sont refusées EN AMONT quand l'agent travaille (`sortieAutorisee`) ;
  // quand il ne travaille plus, ranger la carte ne doit rien déclencher.
  for (const arrivee of ['notes', 'done', 'to_deploy', 'archived'] as const) {
    assert.equal(effetDuDepot('running', arrivee), 'ranger', `vers « ${arrivee} »`);
  }
});

test('reposer une carte dans sa propre colonne ne déclenche rien', () => {
  for (const colonne of COLUMN_KEYS) {
    assert.equal(effetDuDepot(colonne, colonne), 'ranger', `« ${colonne} »`);
  }
});

test('un rangement ordinaire n’est ni un lancement ni une suspension', () => {
  assert.equal(effetDuDepot('planned', 'notes'), 'ranger');
  assert.equal(effetDuDepot('done', 'to_deploy'), 'ranger');
  // « Planifié » n'est une suspension QUE depuis « En cours ».
  assert.equal(effetDuDepot('notes', 'planned'), 'ranger');
});

/* -------- Ce que le glissement a le droit de faire pendant le travail -------- */

const enTravail = { colonne: 'running', etat: etatVisuelCarte({ agentStatut: 'running' }), agentLance: true };

test('la suspension passe même pendant que l’agent écrit : c’est sa raison d’être', () => {
  assert.equal(sortieAutorisee(enTravail, 'planned').possible, true);
});

test('toute autre sortie reste refusée tant que l’agent écrit', () => {
  for (const arrivee of ['notes', 'done', 'to_deploy', 'archived'] as const) {
    const decision = sortieAutorisee(enTravail, arrivee);
    assert.equal(decision.possible, false, `vers « ${arrivee} »`);
    assert.ok(decision.raison, 'un refus se dit en toutes lettres');
  }
});

test('agent au repos : la carte se range librement', () => {
  const auRepos = { colonne: 'running', etat: etatVisuelCarte({ agentStatut: 'done' }), agentLance: true };
  assert.equal(sortieAutorisee(auRepos, 'done').possible, true);
});

test('la raison d’une suspension est écrite pour être lue sur la carte', () => {
  assert.match(RAISON_SUSPENDU, /suspendu/i);
  assert.notEqual(RAISON_SUSPENDU, RAISON_SANS_MODIFICATION);
});

/* ------------------------------------------------------------------ */
/* Sortir une carte d'une fin de parcours : geste humain seulement      */
/* ------------------------------------------------------------------ */

test('aucun chemin automatique ne ressort une carte d’« Archivé » ni d’« À déployer »', () => {
  for (const colonne of COLONNES_HORS_REPRISE) {
    const decision = repriseAutorisee(colonne, 'automatique');
    assert.equal(decision.possible, false, `depuis « ${colonne} »`);
    assert.ok(decision.raison, 'un refus se dit en toutes lettres');
    assert.match(decision.raison!, /utilisateur/);
  }
});

test('un geste humain, lui, peut les ressortir', () => {
  for (const colonne of COLONNES_HORS_REPRISE) {
    assert.equal(repriseAutorisee(colonne, 'humain').possible, true, `depuis « ${colonne} »`);
    assert.equal(repriseAutorisee(colonne, 'humain').raison, undefined);
  }
});

test('les autres colonnes n’ont jamais rien à demander à personne', () => {
  for (const colonne of COLUMN_KEYS.filter((c) => !COLONNES_HORS_REPRISE.includes(c))) {
    for (const demandeur of ['humain', 'automatique'] as const) {
      assert.equal(repriseAutorisee(colonne, demandeur).possible, true, `« ${colonne} » / ${demandeur}`);
    }
  }
});

test('un tour d’agent reste bloqué : la règle par défaut n’a pas bougé', () => {
  // Le même contrôle qu'avant l'exception humaine : c'est la garantie qu'une
  // question posée dans la conversation ne sort pas la carte du lot.
  assert.equal(colonneAuDemarrage('to_deploy', 'task'), null);
  assert.equal(colonneAuDemarrage('archived', 'task'), null);
});

test('la carte ressortie retombe à l’étape juste avant sa fin de parcours', () => {
  assert.equal(colonneDeReprise('archived'), 'planned');
  assert.equal(colonneDeReprise('to_deploy'), 'done');
  for (const colonne of COLUMN_KEYS.filter((c) => !COLONNES_HORS_REPRISE.includes(c))) {
    assert.equal(colonneDeReprise(colonne), null, `« ${colonne} »`);
  }
});

test('le bouton de reprise n’existe que sur les deux fins de parcours', () => {
  for (const colonne of COLUMN_KEYS) {
    const decision = gesteCarte('reprendre', { colonne, etat: 'repos' });
    assert.equal(decision.affiche, COLONNES_HORS_REPRISE.includes(colonne), `« ${colonne} »`);
    if (decision.affiche) assert.equal(decision.possible, true, `« ${colonne} »`);
  }
});

/* -------- La carte ressortie garde sa trace -------- */

test('une carte ressortie dit qu’elle avait été archivée, et quand', () => {
  const quand = new Date('2026-08-04T10:00:00Z').getTime();
  const mention = mentionArchivage({ column: 'planned', archivedAt: quand });
  assert.ok(mention);
  assert.match(mention!, /Archivée le /);
  assert.match(mention!, new RegExp(new Date(quand).toLocaleDateString('fr-CH').replace(/\./g, '\\.')));
});

test('rien à dire tant que la carte est encore dans « Archivé » : la colonne le dit', () => {
  assert.equal(mentionArchivage({ column: 'archived', archivedAt: Date.now() }), null);
});

test('une carte jamais archivée ne porte aucune mention', () => {
  assert.equal(mentionArchivage({ column: 'done' }), null);
});

/* -------- Le moteur muet au lancement n'est pas un échec ordinaire -------- */

test('un moteur muet remet la carte en « Planifié », jamais en « Terminé »', () => {
  assert.equal(colonneApresMoteurMuet('running', 'task', true), 'planned');
});

test('sans moteur muet, la règle ne dit rien : le tour ordinaire tranche seul', () => {
  assert.equal(colonneApresMoteurMuet('running', 'task', false), null);
});

test('un moteur muet hors « En cours » ne fait rien bouger', () => {
  for (const depart of COLUMN_KEYS.filter((c) => c !== 'running')) {
    assert.equal(colonneApresMoteurMuet(depart, 'task', true), null, `depuis « ${depart} »`);
  }
});

test('un moteur muet sur un rôle qui ne déplace pas (analysis, orchestrator, deploy) ne fait rien bouger', () => {
  for (const role of ['analysis', 'orchestrator', 'deploy'] as const) {
    assert.equal(colonneApresMoteurMuet('running', role, true), null, `rôle « ${role} »`);
  }
});

test('la carte remise en « Planifié » avec des reprises repart toute seule', () => {
  assert.equal(demarrageAutomatiqueAutorise({ asap: false, attempts: 1, restarts: 1 }), true);
});

test('la raison du moteur injoignable est écrite en toutes lettres', () => {
  assert.match(RAISON_MOTEUR_INJOIGNABLE, /moteur/i);
  assert.match(RAISON_MOTEUR_INJOIGNABLE, /Planifié/);
});

/* -------- Le filet : les cartes OUBLIÉES en « En cours » -------- */

/** Une carte oubliée ordinaire : plus rien ne la tient, rien n'a jamais été livré. */
const OUBLIEE = {
  colonne: 'running' as const,
  tourEnVol: false,
  agentAuTravail: false,
  dernierTourEnEchec: false,
  dejaEnregistre: false,
};

test('une carte oubliée en « En cours », sans code livré, redescend en file et est retenue', () => {
  const issue = issueDeCarteOubliee(OUBLIEE);
  assert.equal(issue.colonne, 'planned');
  assert.equal(issue.raison, RAISON_TOUR_SANS_ISSUE);
  assert.equal(issue.retenue, true);
});

test('une carte oubliée dont le code était DÉJÀ livré est rangée dans « Terminé », avec sa raison', () => {
  const issue = issueDeCarteOubliee({ ...OUBLIEE, dejaEnregistre: true });
  assert.equal(issue.colonne, 'done');
  assert.equal(issue.raison, RAISON_DEJA_LIVRE);
  assert.equal(issue.retenue, false);
});

test('un tour qui TIENT encore la carte (marque de vol) interdit de la ranger', () => {
  assert.equal(issueDeCarteOubliee({ ...OUBLIEE, tourEnVol: true }).colonne, null);
  assert.equal(issueDeCarteOubliee({ ...OUBLIEE, tourEnVol: true, dejaEnregistre: true }).colonne, null);
});

test('un agent au travail interdit de la ranger : l’agent fait foi, pas la colonne', () => {
  assert.equal(issueDeCarteOubliee({ ...OUBLIEE, agentAuTravail: true }).colonne, null);
});

test('un dernier tour en échec laisse la carte là où on la relance', () => {
  assert.equal(issueDeCarteOubliee({ ...OUBLIEE, dernierTourEnEchec: true }).colonne, null);
  assert.equal(issueDeCarteOubliee({ ...OUBLIEE, dernierTourEnEchec: true, dejaEnregistre: true }).colonne, null);
});

test('hors « En cours », le balayage ne touche à rien', () => {
  for (const colonne of COLUMN_KEYS.filter((c) => c !== 'running')) {
    assert.equal(issueDeCarteOubliee({ ...OUBLIEE, colonne }).colonne, null, `depuis « ${colonne} »`);
    assert.equal(
      issueDeCarteOubliee({ ...OUBLIEE, colonne, dejaEnregistre: true }).colonne,
      null,
      `depuis « ${colonne} », code livré`,
    );
  }
});

test('une carte retenue par le balayage ne repart pas toute seule', () => {
  const issue = issueDeCarteOubliee(OUBLIEE);
  assert.equal(demarrageAutomatiqueAutorise({ asap: true, attempts: 1, restarts: 1, suspendu: issue.retenue }), false);
});

test('la raison du tour sans issue dit où va la carte, sans accuser le travail', () => {
  assert.match(RAISON_TOUR_SANS_ISSUE, /Planifié/);
  assert.match(RAISON_TOUR_SANS_ISSUE, /En cours/);
  assert.notEqual(RAISON_TOUR_SANS_ISSUE, RAISON_SANS_MODIFICATION);
});

/* ------------------------------------------------------------------ */
/* « Rien à changer » alors que le travail était bel et bien fait      */
/* ------------------------------------------------------------------ */

test('la phrase du travail déjà livré commence par le FAIT, jamais par « rien »', () => {
  // Le bogue rapporté : la carte disait « Rien à changer » à côté d'un travail
  // enregistré et fusionné. La phrase doit affirmer que le code est là.
  assert.doesNotMatch(RAISON_DEJA_LIVRE, /^Rien à changer/);
  assert.match(RAISON_DEJA_LIVRE, /enregistré/);
  assert.match(RAISON_DEJA_LIVRE, /branche/);
});

test('la phrase du travail sauvé d’office dit que rien n’est perdu', () => {
  assert.match(RAISON_TRAVAIL_SAUVE, /d’office/);
  assert.match(RAISON_TRAVAIL_SAUVE, /rien n’est perdu/);
  assert.notEqual(RAISON_TRAVAIL_SAUVE, RAISON_DEJA_LIVRE);
});

test('une phrase de TRAVAIL acquis ne s’affiche pas comme une attente', () => {
  assert.equal(natureDeLaMention(RAISON_DEJA_LIVRE), 'travail');
  assert.equal(natureDeLaMention(RAISON_TRAVAIL_SAUVE), 'travail');
});

test('une phrase d’ATTENTE garde son alerte', () => {
  for (const phrase of [
    RAISON_SANS_MODIFICATION,
    RAISON_TOUR_SANS_ISSUE,
    RAISON_TRACE_INCONNUE,
    RAISON_SUSPENDU,
    RAISON_MOTEUR_INJOIGNABLE,
  ]) {
    assert.equal(natureDeLaMention(phrase), 'attente', phrase);
  }
  assert.equal(natureDeLaMention(undefined), 'attente');
  assert.equal(natureDeLaMention(''), 'attente');
});

test('la branche d’une carte se reconnaît au NUMÉRO, même si le titre a changé', () => {
  const id = 'c9194151-9caa-49c7-84fc-b730829edb02';
  const branche = nomDeBranche('Afficher le décompte des étapes sur la carte', id);
  assert.equal(estLaBrancheDeLaCarte(branche, id), true);
  // Le titre change entre l'interruption et le redémarrage : la branche, elle,
  // reste la même — et la carte doit encore s'y reconnaître.
  assert.notEqual(nomDeBranche('Tout autre titre', id), branche);
  assert.equal(estLaBrancheDeLaCarte(branche, id), true);
  assert.equal(estLaBrancheDeLaCarte(branche, 'aaaaaa11-0000-0000-0000-000000000000'), false);
  assert.equal(estLaBrancheDeLaCarte('main', id), false);
  assert.equal(estLaBrancheDeLaCarte('hors-tache/quelque-chose-c91941', id), false);
});
