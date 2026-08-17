import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DeployRun,
  REPRISES_ETAPE_MAX,
  avertissementCartesNonRangees,
  consigneDeReparationDEtape,
  journalDesReprises,
  mentionDesReprises,
  panneDAdresseMuette,
  reconnaitrePanneDePublication,
  recitSansReparation,
  MOTIFS_DE_DEPANNAGE,
  niveauDAccueil,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Une étape de publication qui tombe est reconnue, réparée, rejouée —  */
/* et ce qui n'est PAS reconnu n'est jamais bricolé.                    */
/* ------------------------------------------------------------------ */

test('un envoi refusé parce que le dépôt a avancé est reconnu et réparable', () => {
  const sortie = [
    'To github.com:haikostudio/haikodev.git',
    ' ! [rejected]        HEAD -> main (non-fast-forward)',
    'error: failed to push some refs',
    'hint: Updates were rejected because the tip of your current branch is behind',
  ].join('\n');

  const panne = reconnaitrePanneDePublication('push', sortie);
  assert.ok(panne, 'la panne doit être reconnue');
  assert.equal(panne?.reparable, true);
  assert.match(panne!.nom, /dépôt distant a avancé/);
  assert.ok(panne!.gestes.length > 0, 'une panne réparable porte ses gestes');
  // On ne force JAMAIS l'envoi pour faire passer le lot : ce serait écraser le
  // travail arrivé entre-temps.
  assert.ok(
    panne!.gestes.some((geste) => /ne force jamais l’envoi/i.test(geste)),
    'les gestes interdisent l’envoi forcé',
  );
});

test('un identifiant refusé est NOMMÉ, mais on n’envoie personne le réparer', () => {
  const panne = reconnaitrePanneDePublication('push', 'git@github.com: Permission denied (publickey).');
  assert.ok(panne, 'la panne est reconnue');
  assert.equal(panne?.reparable, false, 'elle ne se répare pas depuis une publication');
  assert.deepEqual(panne?.gestes, [], 'aucun geste : il n’y a rien à tenter ici');
  assert.match(recitSansReparation(panne), /rien n’a été tenté/);
});

test('une panne inconnue n’est jamais bricolée, et le récit le dit', () => {
  assert.equal(reconnaitrePanneDePublication('push', 'une sortie que personne n’a jamais vue'), null);
  assert.equal(reconnaitrePanneDePublication('restart', ''), null);
  assert.match(recitSansReparation(null), /panne non reconnue/);
  assert.match(recitSansReparation(null), /rien n’a été bricolé/);
});

test('les trois étapes qui avaient déjà leur réparation ne sont pas doublées', () => {
  // merge, verify et build gardent leur mécanisme d'origine, plus fin : la
  // table générique ne les connaît pas.
  assert.equal(reconnaitrePanneDePublication('merge', 'CONFLICT (content): Merge conflict in a.ts'), null);
  assert.equal(reconnaitrePanneDePublication('verify', 'FAIL src/test/quelque-chose.test.ts'), null);
  assert.equal(reconnaitrePanneDePublication('build', 'error TS2322: Type … is not assignable'), null);
});

test('le service du projet se répare, mais jamais celui du démon', () => {
  const panne = reconnaitrePanneDePublication('restart', 'Job for haiko-compta.service failed (status=1/FAILURE)');
  assert.ok(panne?.reparable, 'un service qui ne repart pas est réparable');
  assert.ok(
    panne!.gestes.some((geste) => /démon HaikoDev/.test(geste)),
    'les gestes interdisent en toutes lettres de toucher au démon',
  );
});

test('un droit d’administration manquant est dit, pas contourné', () => {
  const panne = reconnaitrePanneDePublication('restart', 'sudo: a password is required');
  assert.equal(panne?.reparable, false);
});

test('une adresse muette est toujours la même panne, quel que soit le motif du réseau', () => {
  const panne = panneDAdresseMuette('https://exemple.haikostudio.cloud');
  assert.equal(panne.reparable, true);
  assert.match(panne.nom, /ne répond pas/);
  assert.ok(
    panne.gestes.some((geste) => /NE REDÉMARRE JAMAIS le démon/.test(geste)),
    'on ne redémarre jamais le démon pour « débloquer » une adresse',
  );
});

test('la consigne du dépanneur nomme la panne, montre la sortie et interdit de publier', () => {
  const panne = reconnaitrePanneDePublication('push', 'error: failed to push some refs (non-fast-forward)');
  const consigne = consigneDeReparationDEtape({
    libelleEtape: 'Envoi sur le dépôt',
    panne: panne!,
    sortie: 'non-fast-forward',
    passe: 1,
    passesMax: REPRISES_ETAPE_MAX,
  });
  assert.match(consigne, /Envoi sur le dépôt/);
  assert.match(consigne, /Panne reconnue/);
  assert.match(consigne, /non-fast-forward/);
  assert.match(consigne, /ne mets RIEN en ligne/);
  assert.match(consigne, /ne relance pas la publication/);
  assert.match(consigne, /passe 1 sur 2/);
});

test('un dépannage reçoit l’accueil MINIMAL, comme les trois autres', () => {
  assert.ok(MOTIFS_DE_DEPANNAGE.includes('depannage'));
  assert.equal(niveauDAccueil({ role: 'deploy', motif: 'depannage' }), 'minimal');
  // La mise en production confiée, elle, garde l'accueil complet.
  assert.equal(niveauDAccueil({ role: 'deploy', motif: 'mise-en-ligne' }), 'complet');
});

test('les reprises se lisent dans le déroulé, et zéro reprise ne s’écrit pas', () => {
  assert.equal(mentionDesReprises(0), '');
  assert.equal(mentionDesReprises(undefined), '');
  assert.equal(mentionDesReprises(1), 'réparée · 1 reprise');
  assert.equal(mentionDesReprises(2), 'réparée · 2 reprises');
  assert.equal(journalDesReprises([]), '');
  assert.match(journalDesReprises(['reprise 1 : rejouée']), /Réparations tentées :\n- reprise 1 : rejouée/);
});

test('une étape porte ses reprises et son récit dans le modèle', () => {
  const run = DeployRun.parse({
    id: 'r1',
    projectId: 'p1',
    state: 'success',
    startedAt: Date.now(),
    steps: [{ key: 'push', state: 'done', log: 'ok', reprises: 1, reparations: ['reprise 1 : rejouée, passée'] }],
  });
  assert.equal(run.steps[0].reprises, 1);
  assert.deepEqual(run.steps[0].reparations, ['reprise 1 : rejouée, passée']);
});

test('une publication d’AVANT cette règle se relit sans ses nouveaux champs', () => {
  const run = DeployRun.parse({
    id: 'r0',
    projectId: 'p0',
    state: 'success',
    startedAt: Date.now(),
    steps: [{ key: 'merge', state: 'done', log: 'fusionné' }],
  });
  assert.equal(run.steps[0].reprises, undefined);
  assert.equal(run.steps[0].reparations, undefined);
  assert.equal(run.avertissement, undefined);
});

test('une carte non rangée n’efface pas la mise en ligne : elle s’écrit à côté', () => {
  assert.equal(avertissementCartesNonRangees([]), '');
  const une = avertissementCartesNonRangees(['abc (réponse interne invalide (sansModification))']);
  assert.match(une, /La mise en ligne a bien eu lieu/);
  assert.match(une, /une carte n’a pas pu être rangée/);
  assert.match(une, /le code, lui, est en ligne/);
  const deux = avertissementCartesNonRangees(['abc (…)', 'def (…)']);
  assert.match(deux, /2 cartes n’ont pas pu être rangées/);
});
