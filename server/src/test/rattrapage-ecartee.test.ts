import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  JALON_RATTRAPAGE_APRES_ECARTEMENT,
  RATTRAPAGE_PERIME_MS,
  avecRattrapage,
  cartesHeurtees,
  demandeDeReconciliation,
  etatAfficheDuRattrapage,
  genreDAction,
  issueDuRattrapage,
  rattrapageAPartir,
  rattrapagesAPoser,
  reconciliationALaMain,
  tachesARattraper,
  type TacheDuLot,
} from '@beluga/shared';

/*
 * UNE CARTE ÉCARTÉE D'UNE PUBLICATION SE RÉPARE D'ELLE-MÊME — UNE FOIS.
 * Constat (capture #fb73, 23.09.2026) : deux cartes du même lot touchaient
 * `server/src/runtime.ts`, la seconde était écartée et restait là sans rien
 * proposer. Règles pures : `shared/src/rattrapage-ecartee.ts`.
 */

const lot: TacheDuLot[] = [
  { cardId: 'a', titre: 'Réflexion mêlée à la réponse', branche: 'tache/reflexion-297060', etat: 'en-ligne' },
  { cardId: 'b', titre: 'Carte relancée', branche: 'tache/relancee-200798', etat: 'ecartee', detail: 'heurt' },
  { cardId: 'c', titre: 'Branche perdue', branche: 'tache/perdue-cccccc', etat: 'absente' },
];

const T0 = 1_000_000;
const contexte = { maintenant: T0 + 1000, demonDemarreA: 0, redemarrageEnAttente: false };

test('en fin de publication, seule la tâche ÉCARTÉE reçoit un rattrapage prévu — pas une branche absente', () => {
  const poses = rattrapagesAPoser(lot, T0, false);
  assert.equal(poses.find((t) => t.cardId === 'b')?.rattrapage?.etat, 'prevu');
  assert.equal(poses.find((t) => t.cardId === 'a')?.rattrapage, undefined);
  assert.equal(poses.find((t) => t.cardId === 'c')?.rattrapage, undefined);
});

test('une fois par publication et par carte : une tâche qui porte déjà un rattrapage n’en reçoit pas un second', () => {
  const echoue = avecRattrapage(lot, 'b', { etat: 'echec', at: T0 });
  const reposes = rattrapagesAPoser(echoue, T0 + 5000, false);
  assert.equal(reposes.find((t) => t.cardId === 'b')?.rattrapage?.etat, 'echec');
  assert.deepEqual(tachesARattraper(reposes, contexte), [], 'un échec ne repart jamais seul');
});

test('un rattrapage posé avant un redémarrage demandé attend que le démon ait redémarré', () => {
  const r = { etat: 'prevu' as const, at: T0, apresRedemarrage: true };
  assert.equal(rattrapageAPartir(r, { ...contexte, demonDemarreA: T0 - 10 }), false, 'même démon : il attend');
  assert.equal(rattrapageAPartir(r, { ...contexte, demonDemarreA: T0 + 10 }), true, 'démon neuf : il part');
  assert.equal(rattrapageAPartir(r, { ...contexte, demonDemarreA: T0 + 10, redemarrageEnAttente: true }), false);
});

test('en attente de quota, il repart seul ; périmé, il ne repart plus', () => {
  const r = { etat: 'attente-quota' as const, at: T0 };
  assert.equal(rattrapageAPartir(r, contexte), true);
  assert.equal(rattrapageAPartir(r, { ...contexte, maintenant: T0 + RATTRAPAGE_PERIME_MS + 1 }), false);
  assert.equal(rattrapageAPartir({ etat: 'lance', at: T0 }, contexte), false);
});

test('le bouton « Réconcilier » : écartée, pas en cours, carte encore dans « À déployer »', () => {
  const b = lot[1];
  assert.equal(reconciliationALaMain(b, 'to_deploy'), true);
  assert.equal(reconciliationALaMain({ ...b, rattrapage: { etat: 'echec', at: T0 } }, 'to_deploy'), true);
  assert.equal(reconciliationALaMain({ ...b, rattrapage: { etat: 'lance', at: T0 } }, 'to_deploy'), false);
  assert.equal(reconciliationALaMain({ ...b, rattrapage: { etat: 'revenu', at: T0 } }, 'to_deploy'), false);
  assert.equal(reconciliationALaMain(b, 'running'), false);
  assert.equal(reconciliationALaMain(lot[2], 'to_deploy'), false);
});

test('l’état affiché suit la carte : revenue dans « À déployer » après le départ, c’est revenu', () => {
  const r = { etat: 'lance' as const, at: T0 };
  assert.equal(etatAfficheDuRattrapage(r, { column: 'to_deploy', doneAt: T0 + 1 }), 'revenu');
  assert.equal(etatAfficheDuRattrapage(r, { column: 'to_deploy', doneAt: T0 - 1 }), 'lance');
  assert.equal(etatAfficheDuRattrapage({ etat: 'attente-quota', at: T0 }, { column: 'running' }), 'lance');
  assert.equal(issueDuRattrapage('to_deploy', true).etat, 'revenu');
  assert.equal(issueDuRattrapage('running', false).etat, 'echec');
});

test('la demande nomme la branche, les fichiers, la carte adverse avec son enregistrement, et exige build + tests', () => {
  const contre = cartesHeurtees(['server/src/runtime.ts'], [
    {
      cardId: 'a',
      titre: 'Réflexion mêlée à la réponse',
      branche: 'tache/reflexion-297060',
      commit: 'fb707abd1234567890',
      fichiers: ['server/src/runtime.ts', 'web/src/x.tsx'],
    },
  ]);
  assert.equal(contre[0].commit, 'fb707abd1234567890', 'le commit adverse traverse le croisement');
  const texte = demandeDeReconciliation({
    branche: 'tache/relancee-200798',
    brancheDAccueil: 'dev',
    ecart: { fichiers: ['server/src/runtime.ts'], brancheDAccueil: 'dev', contre },
  });
  assert.match(texte, /Ta branche : tache\/relancee-200798\. Branche publiée : dev\./);
  assert.match(texte, /Fichiers en heurt : server\/src\/runtime\.ts\./);
  assert.match(texte, /« Réflexion mêlée à la réponse » \(branche tache\/reflexion-297060, enregistrement fb707abd12\) sur server\/src\/runtime\.ts/);
  assert.match(texte, /git merge dev/);
  assert.match(texte, /npm run build/);
  assert.match(texte, /npm test/);
  assert.match(texte, /Ne publie pas/);
});

test('une publication d’avant le détail structuré : la demande reprend la raison écrite', () => {
  const texte = demandeDeReconciliation({ branche: 'tache/x', brancheDAccueil: 'dev', raison: 'conflit sur a.ts' });
  assert.match(texte, /Raison de l’écartement : conflit sur a\.ts\./);
  assert.doesNotMatch(texte, /Cartes du lot passées/);
});

test('le jalon du rattrapage est un point de la ligne de temps, pas un incident', () => {
  assert.equal(genreDAction({ nature: 'jalon', libelle: JALON_RATTRAPAGE_APRES_ECARTEMENT, reussie: true }), 'point');
});

/* Le câblage : la publication REBRANCHE la phrase nommée et pose le rattrapage
   après la mise en ligne, jamais dans une étape du déroulé (DEC-255). */
const ici = path.dirname(fileURLToPath(import.meta.url));
const source = (f: string) => fs.readFileSync(path.resolve(ici, '../../src', f), 'utf8');

test('la publication nomme l’écartement et pose le rattrapage après la mise en ligne réussie', () => {
  const deploy = source('deploy.ts');
  assert.match(deploy, /mentionDeLEcartement\(\{ branche: branch, brancheDAccueil: branche, fichiers: enConflit, contre \}\)/);
  assert.match(deploy, /rattrapagesAPoser\(current\.taches, Date\.now\(\), redemarrageDemande\)/);
  const succes = deploy.indexOf("state: 'success'");
  assert.ok(succes > 0 && deploy.indexOf('rattrapagesAPoser(current.taches') > succes, 'posé APRÈS le succès');
  assert.doesNotMatch(deploy, /sendPrompt\(/, 'aucun agent appelé depuis le déroulé');
});

test('le démarrage reprend les rattrapages, et la relance passe par sendPrompt après le choix du compte', () => {
  assert.match(source('main.ts'), /reprendreLesRattrapages\(\)/);
  const r = source('rattrapage-ecartee.ts');
  assert.ok(r.indexOf('pickAccount(') < r.indexOf('sendPrompt(agent.id'), 'le compte se choisit avant tout écrit');
  assert.match(r, /demandeur: 'humain'/);
});
