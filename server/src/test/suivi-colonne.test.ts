import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COLONNES_HORS_REPRISE,
  COLUMN_KEYS,
  MACHINE_ONLY_TARGETS,
  ROLES_QUI_CLOTURENT,
  ROLES_QUI_DEPLACENT,
  canMove,
  colonneAuDemarrage,
  colonneDeReprise,
  colonneEnFinDeTour,
  effetDuDepot,
  etatVisuelCarte,
  gesteCarte,
  mentionArchivage,
  repriseAutorisee,
  sortieAutorisee,
  RAISON_SANS_MODIFICATION,
  RAISON_SUSPENDU,
  raisonSansModification,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* La carte suit les étapes réelles du travail                          */
/* ------------------------------------------------------------------ */

/* -------- Le tour d'exécution démarre -------- */

test('une carte terminée sur laquelle on relance une exécution repasse en cours', () => {
  assert.equal(colonneAuDemarrage('done', 'task'), 'running');
});

test('une carte en amont du parcours part en cours quand l’exécution démarre', () => {
  for (const depart of ['notes', 'todo'] as const) {
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
  for (const depart of ['todo', 'done'] as const) {
    assert.equal(colonneEnFinDeTour(depart, false, 'task', true), null, `depuis « ${depart} »`);
  }
});

test('une carte qui n’était pas en cours n’est pas déclarée terminée', () => {
  for (const depart of COLUMN_KEYS.filter((c) => c !== 'running')) {
    assert.equal(colonneEnFinDeTour(depart, true, 'task', true), null, `depuis « ${depart} »`);
  }
});

/* -------- Pas de code modifié, pas de « Terminé » -------- */

test('un tour qui n’a rien modifié dans le dépôt laisse la carte en cours', () => {
  // Le défaut d'origine : répondre suffisait à clore la carte.
  assert.equal(colonneEnFinDeTour('running', true, 'task', false), null);
});

test('le même tour, avec du code enregistré, pose bien la carte en terminé', () => {
  assert.equal(colonneEnFinDeTour('running', true, 'task', true), 'done');
});

test('une carte NEUVE laissée en place faute de modification dit pourquoi', () => {
  // Jamais rien produit (dejaEnregistre = false) : la note doit s'afficher.
  assert.equal(raisonSansModification('running', true, 'task', false, false), RAISON_SANS_MODIFICATION);
  assert.match(RAISON_SANS_MODIFICATION, /aucun fichier/);
});

test('une carte qui a DÉJÀ enregistré du code ne dit plus « aucun fichier n’a changé »', () => {
  // Un tour de suite ou de discussion, sans changement, sur un travail déjà
  // atterri : la note ne se rallume pas.
  assert.equal(raisonSansModification('running', true, 'task', true, false), null);
  assert.equal(raisonSansModification('running', true, 'task', false, true), null);
});

test('une carte qui bouge, un tour en échec ou un rôle qui n’exécute pas n’ont rien à expliquer', () => {
  // Le tour a modifié du code : la carte part en « Terminé », pas de phrase.
  assert.equal(raisonSansModification('running', true, 'task', true, false), null);
  // L'échec est déjà signalé par ailleurs : deux messages vaudraient reproche.
  assert.equal(raisonSansModification('running', false, 'task', false, false), null);
  // Une analyse ne clôt jamais : ne rien modifier est son fonctionnement normal.
  for (const role of ['analysis', 'orchestrator', 'deploy'] as const) {
    assert.equal(raisonSansModification('running', true, role, false, false), null, `rôle « ${role} »`);
  }
});

test('depuis n’importe quelle colonne, sans modification rien ne bouge', () => {
  for (const depart of COLUMN_KEYS) {
    assert.equal(colonneEnFinDeTour(depart, true, 'task', false), null, `depuis « ${depart} »`);
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
  // La carte validée attend son chiffrage DANS « À faire » : plus de colonne
  // « Validé » à traverser.
  assert.equal(colonneAuDemarrage('todo', 'analysis'), null);
  for (const depart of COLUMN_KEYS) {
    assert.equal(colonneAuDemarrage(depart, 'analysis'), null, `depuis « ${depart} »`);
  }
});

test('un tour d’analyse réussi ne clôt pas la carte : rien n’a été exécuté', () => {
  assert.equal(colonneEnFinDeTour('running', true, 'analysis', true), null);
  assert.equal(colonneEnFinDeTour('todo', true, 'analysis', true), null);
});

test('ni l’orchestration ni la publication ne déplacent une carte', () => {
  for (const role of ['orchestrator', 'deploy'] as const) {
    assert.equal(colonneAuDemarrage('todo', role), null, `démarrage « ${role} »`);
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
  // 1. L'analyse démarre sur une carte validée : elle reste dans « À faire ».
  assert.equal(colonneAuDemarrage('todo', 'analysis'), null);
  // 2. L'analyse rend son chiffrage : la carte ne bouge pas d'un pouce — il n'y
  //    a plus de colonne « Planifié » où la promouvoir.
  assert.equal(colonneEnFinDeTour('todo', true, 'analysis', true), null);
  // 3. Le lancement part de « À faire » : la carte passe en cours.
  assert.equal(colonneAuDemarrage('todo', 'task'), 'running');
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

test('l’ordonnanceur lance depuis « À faire », devenue la seule file d’attente', () => {
  // L'autorisation, elle, ne se juge pas ici mais dans `demarrageAutomatiqueAutorise` :
  // une carte simplement posée là ne part toujours pas toute seule.
  assert.equal(canMove('machine', 'todo', 'running').allowed, true);
});

/* ------------------------------------------------------------------ */
/* Le dépôt d'une carte à la main vaut un geste                         */
/* ------------------------------------------------------------------ */

test('déposer une carte dans « En cours » vaut un lancement, d’où qu’elle vienne', () => {
  for (const depart of ['notes', 'todo', 'done'] as const) {
    assert.equal(effetDuDepot(depart, 'running'), 'lancer', `depuis « ${depart} »`);
  }
});

test('sortir une carte de « En cours » vers « À faire » suspend son agent', () => {
  assert.equal(effetDuDepot('running', 'todo'), 'suspendre');
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
  assert.equal(effetDuDepot('todo', 'notes'), 'ranger');
  assert.equal(effetDuDepot('done', 'to_deploy'), 'ranger');
  // « À faire » n'est une suspension QUE depuis « En cours ».
  assert.equal(effetDuDepot('notes', 'todo'), 'ranger');
});

/* -------- Ce que le glissement a le droit de faire pendant le travail -------- */

const enTravail = { colonne: 'running', etat: etatVisuelCarte({ agentStatut: 'running' }), agentLance: true };

test('la suspension passe même pendant que l’agent écrit : c’est sa raison d’être', () => {
  assert.equal(sortieAutorisee(enTravail, 'todo').possible, true);
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
  assert.equal(colonneDeReprise('archived'), 'todo');
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
  const mention = mentionArchivage({ column: 'todo', archivedAt: quand });
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
