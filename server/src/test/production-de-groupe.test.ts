import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MEMBRE_DESACTIVE,
  MEMBRE_SANS_PROCESSUS,
  membrePret,
  raisonMembrePasPret,
  resumeDeLaProductionDuGroupe,
  runDeProductionDuMembre,
  type DeployRun,
  type DeployStepKey,
} from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* LA MISE EN PRODUCTION D'UN REGROUPEMENT : le groupe délègue à ses    */
/* membres (`shared/src/production-de-groupe.ts`).                      */
/* ------------------------------------------------------------------ */

const CLES: DeployStepKey[] = ['merge', 'commit', 'push', 'build', 'publish', 'restart'];

/** Une publication dont les `faites` premières étapes sont cochées. */
function run(
  id: string,
  state: DeployRun['state'],
  faites: number,
  options: Partial<DeployRun> = {},
): DeployRun {
  return {
    id,
    projectId: `p-${id}`,
    cible: 'production',
    state,
    startedAt: 1000,
    endedAt: state === 'running' ? undefined : 2000,
    steps: CLES.map((key, rang) => ({
      key,
      state:
        rang < faites
          ? 'done'
          : rang === faites
            ? state === 'running'
              ? 'running'
              : state === 'success'
                ? 'done'
                : 'failed'
            : state === 'success'
              ? 'done'
              : 'todo',
    })),
    ...options,
  } as DeployRun;
}

const PRET = { miseEnProduction: { processus: { etapes: [{ libelle: 'Envoi', commande: 'true', delaiS: 60 }] } }, miseEnProductionActive: true };

test('la ligne d’un membre raconte sa dernière mise en PRODUCTION, jamais un déploiement', () => {
  const prod = run('a', 'failed', 2);
  const dev = run('b', 'running', 1, { cible: 'dev', startedAt: 9000 });
  assert.equal(runDeProductionDuMembre(dev, prod)?.id, 'a', 'un déploiement en cours ne masque pas la production');
  assert.equal(runDeProductionDuMembre(dev, null), null);
  assert.equal(runDeProductionDuMembre(undefined, undefined), null);

  const recente = run('c', 'running', 1, { startedAt: 5000 });
  assert.equal(runDeProductionDuMembre(recente, prod)?.id, 'c', 'la plus récente l’emporte');
  assert.equal(runDeProductionDuMembre(prod, recente)?.id, 'c');
  /* La même publication des deux côtés : la version vivante, plus fraîche. */
  const vivante = run('a', 'success', 6);
  assert.equal(runDeProductionDuMembre(vivante, prod)?.state, 'success');
});

test('un membre éteint dit pourquoi, dans l’ordre des refus du serveur', () => {
  assert.equal(raisonMembrePasPret({ projet: {} }), MEMBRE_SANS_PROCESSUS);
  assert.equal(raisonMembrePasPret({ projet: { ...PRET, miseEnProductionActive: false } }), MEMBRE_DESACTIVE);
  /* Le tiroir du groupe n'a pas d'interrupteur : la phrase n'y renvoie pas. */
  assert.doesNotMatch(MEMBRE_DESACTIVE, /en haut du tiroir/);
  /* Sans processus ET éteint : le processus manquant se dit d'abord, comme au serveur. */
  assert.equal(raisonMembrePasPret({ projet: { miseEnProductionActive: false } }), MEMBRE_SANS_PROCESSUS);
  assert.equal(raisonMembrePasPret({ projet: PRET }), null);
  assert.equal(membrePret({ projet: PRET }), true);

  assert.match(raisonMembrePasPret({ projet: PRET, agentsOccupes: ['Refonte'] }) ?? '', /« Refonte » travaille encore/);
  assert.match(raisonMembrePasPret({ projet: PRET, autrePublication: true }) ?? '', /déjà en cours/);
  assert.equal(raisonMembrePasPret({ projet: PRET, productionBloquee: 'Processus refusé.' }), 'Processus refusé.');
  assert.match(raisonMembrePasPret({ projet: PRET, horsLigne: true }) ?? '', /lien avec le serveur/);

  /* Une mise en production qui tourne n'est pas une raison à écrire, mais le
     membre ne repart pas : le bouton général ne le compte pas. */
  assert.equal(raisonMembrePasPret({ projet: PRET, enCours: true }), null);
  assert.equal(membrePret({ projet: PRET, enCours: true }), false);
});

test('le bandeau fermé du groupe : repos, moyenne des mises en production en route, échec', () => {
  assert.deepEqual(resumeDeLaProductionDuGroupe([{}, {}]), {
    suivi: 'repos',
    enRoute: false,
    tombee: false,
    pourcent: null,
    enAttente: null,
  });

  const deux = resumeDeLaProductionDuGroupe([{ run: run('a', 'running', 1) }, { run: run('b', 'running', 3) }]);
  assert.equal(deux.suivi, 'en-cours');
  assert.equal(deux.enRoute, true);
  assert.equal(deux.tombee, false);
  const seulA = resumeDeLaProductionDuGroupe([{ run: run('a', 'running', 1) }]).pourcent!;
  const seulB = resumeDeLaProductionDuGroupe([{ run: run('b', 'running', 3) }]).pourcent!;
  assert.equal(deux.pourcent, Math.round((seulA + seulB) / 2), 'la moyenne des deux');
  assert.ok(seulA < seulB);
});

test('une réussite et un échec en même temps : le bandeau ne reste pas « en cours »', () => {
  const pendant = resumeDeLaProductionDuGroupe([{ run: run('a', 'running', 4) }, { run: run('b', 'failed', 2) }]);
  assert.equal(pendant.enRoute, true, 'tant qu’un membre tourne, le groupe est en route');
  assert.equal(pendant.tombee, true, 'et l’échec de l’autre se sait déjà');
  assert.equal(pendant.suivi, 'en-cours');

  const apres = resumeDeLaProductionDuGroupe([{ run: run('a', 'success', 6) }, { run: run('b', 'failed', 2) }]);
  assert.equal(apres.enRoute, false);
  assert.equal(apres.tombee, true);
  assert.equal(apres.suivi, 'en-echec');
  assert.equal(apres.pourcent, resumeDeLaProductionDuGroupe([{ run: run('b', 'failed', 2) }]).pourcent, 'figé sur le membre tombé');

  const fini = resumeDeLaProductionDuGroupe([{ run: run('a', 'success', 6) }, { run: run('b', 'success', 6) }]);
  assert.deepEqual([fini.suivi, fini.enRoute, fini.tombee, fini.pourcent], ['repos', false, false, null]);

  const arretee = resumeDeLaProductionDuGroupe([{ run: run('a', 'stopped', 1) }]);
  assert.equal(arretee.tombee, true);
});

test('les versions en attente du groupe : la somme des écarts fiables de ses membres', () => {
  const resume = resumeDeLaProductionDuGroupe([
    { etat: { commit: 'abc1234', ecart: 3 } },
    { etat: { commit: 'def5678', ecart: 0 } },
    /* Jamais mise en production, puis écart inconnu : ni l'un ni l'autre ne compte. */
    { etat: { raison: 'aucune mise en production' } },
    { etat: { commit: 'aaa0000' } },
  ]);
  assert.deepEqual(resume.enAttente, { nombre: 3, enRetard: true });

  assert.deepEqual(resumeDeLaProductionDuGroupe([{ etat: { commit: 'abc1234', ecart: 0 } }]).enAttente, {
    nombre: 0,
    enRetard: false,
  });
  /* À jour, mais la dernière tentative est tombée : le repère alerte quand même. */
  assert.deepEqual(
    resumeDeLaProductionDuGroupe([{ etat: { commit: 'abc1234', ecart: 0, derniere: { etat: 'failed', at: 1 } } }]).enAttente,
    { nombre: 0, enRetard: true },
  );
  assert.equal(resumeDeLaProductionDuGroupe([{ etat: { raison: 'rien' } }, {}]).enAttente, null);
});
