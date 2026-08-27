#!/usr/bin/env node
/*
 * UNE TÂCHE COUPÉE PAR UNE PANNE NE PASSE JAMAIS POUR TERMINÉE.
 *
 * Le contrôle demandé par la carte, joué pour de vrai : on coupe pendant qu'une
 * carte travaille, on relance, et on regarde ce que la carte affiche.
 *
 *  1. UNE VRAIE COUPURE. Un processus enfant ouvre une base jetable, y pose une
 *     carte en travail avec sa marque de vol, puis se TUE lui-même (SIGKILL) :
 *     aucune fermeture propre, aucun rangement de fin de tour — exactement ce
 *     que fait un serveur qui plante ou qu'on redémarre.
 *  2. LE REDÉMARRAGE. Ce script rouvre la même base et appelle la reprise du
 *     démon, celle qui tourne au lancement du service.
 *  3. LE CONSTAT. La carte est en « Planifié », elle porte la RAISON de son
 *     interruption, elle repartira d'elle-même, et elle n'est JAMAIS déployable.
 *
 * Deux pièges sont vérifiés en plus, parce qu'ils sont l'origine de la panne :
 *  - l'agent déjà passé en « terminé » avant que la carte ne soit rangée est
 *    rattrapé lui aussi (c'est le trou d'origine : personne ne le regardait) ;
 *  - une carte simplement RENDUE et laissée ouverte n'est PAS reprise — sinon
 *    l'ordonnanceur relancerait tout seul un travail déjà fait.
 *
 * AUCUN MOTEUR N'EST APPELÉ, aucune base réelle n'est touchée.
 *
 *   node scripts/verif-carte-interrompue.mjs
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Le dépôt d'où PART ce script, jamais un chemin en dur. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Une base jetable : ce contrôle n'écrit jamais dans celle du serveur. */
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'haikodev-carte-interrompue-'));

const echecs = [];
function verifier(condition, message) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    console.error(`  ✗ ${message}`);
    echecs.push(message);
  }
}

/* ------------------------------------------------------------------ */
console.log('\n1. Le serveur est coupé net pendant qu’une carte travaille');
/* ------------------------------------------------------------------ */

/*
 * Le processus enfant écrit puis se tue : `process.kill(process.pid, 'SIGKILL')`
 * ne laisse tourner aucun code de sortie, aucun rangement. C'est la panne, pas
 * un arrêt demandé.
 */
const enVol = `
import path from 'node:path';
process.env.HAIKODEV_DATA = ${JSON.stringify(dossier)};
const store = await import(${JSON.stringify(path.join(RACINE, 'server/dist/store.js'))});
const maintenant = Date.now();

function poser(id, colonne, scheduling, statutAgent) {
  store.saveCard({
    id, projectId: 'projet-essai', title: 'Carte ' + id, description: '', labels: [],
    column: colonne, position: 1, origin: 'user', attachments: [],
    run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    scheduling, createdAt: maintenant, updatedAt: maintenant,
  });
  if (statutAgent) {
    store.saveAgent({
      id: 'agent-' + id, projectId: 'projet-essai', cardId: id, role: 'task', title: 'Carte ' + id,
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      status: statutAgent, createdAt: maintenant, updatedAt: maintenant,
    });
  }
}

// a) le cas ordinaire : l'agent écrivait encore.
poser('coupee', 'running', { asap: false, attempts: 1, restarts: 0, tourEnVolDepuis: maintenant }, 'running');
// b) le trou d'origine : l'agent était DÉJÀ passé en « terminé », la carte pas encore rangée.
poser('rangement', 'running', { asap: false, attempts: 1, restarts: 0, tourEnVolDepuis: maintenant }, 'done');
// c) le témoin : un travail rendu, laissé ouvert. Rien ne le tient, rien ne doit le reprendre.
poser('rendue', 'to_deploy', { asap: false, attempts: 1, restarts: 0 }, 'done');

process.kill(process.pid, 'SIGKILL');
`;

let coupe = false;
try {
  execFileSync(process.execPath, ['--input-type=module', '-e', enVol], { stdio: 'pipe' });
} catch (err) {
  coupe = err?.signal === 'SIGKILL';
}
verifier(coupe, 'le processus a été tué en plein vol, sans fermeture propre');

/* ------------------------------------------------------------------ */
console.log('\n2. Le serveur redémarre : la reprise du démon passe');
/* ------------------------------------------------------------------ */

process.env.HAIKODEV_DATA = dossier;
const partage = await import(path.join(RACINE, 'shared/dist/index.js'));
const store = await import(path.join(RACINE, 'server/dist/store.js'));
const runtime = await import(path.join(RACINE, 'server/dist/runtime.js'));
const { RAISON_COUPE_EN_VOL, demarrageAutomatiqueAutorise, etatVisuelCarte } = partage;

verifier(store.getCard('coupee')?.column === 'running', 'avant reprise, la carte est restée « En cours »');
runtime.recoverAfterRestart();

/* ------------------------------------------------------------------ */
console.log('\n3. La carte est rendue interrompue, et jamais terminée');
/* ------------------------------------------------------------------ */

for (const id of ['coupee', 'rangement']) {
  const carte = store.getCard(id);
  verifier(carte?.column !== 'to_deploy', `« ${id} » n’est pas passée pour terminée`);
  verifier(carte?.column === 'planned', `« ${id} » est revenue dans la file « Planifié »`);
  verifier(
    carte?.scheduling?.waitingReason === RAISON_COUPE_EN_VOL,
    `« ${id} » porte la raison de son interruption, en toutes lettres`,
  );
  verifier(carte?.doneAt === undefined, `« ${id} » n’a pas de date de clôture`);
  verifier(
    carte?.scheduling?.tourEnVolDepuis === undefined,
    `« ${id} » ne porte plus la marque de vol : elle ne sera pas reprise deux fois`,
  );
  verifier(
    carte?.scheduling?.attempts === 1,
    `« ${id} » ne compte pas la panne comme un essai raté`,
  );
  verifier(
    demarrageAutomatiqueAutorise(carte?.scheduling) === true,
    `« ${id} » repartira d’elle-même, sans nouveau geste`,
  );
  verifier(
    etatVisuelCarte({ agentStatut: 'done', enAttente: !!carte?.scheduling?.waitingReason }) === 'attente',
    `« ${id} » s’affiche en attente, jamais avec la coche du travail rendu`,
  );
}

/* ------------------------------------------------------------------ */
console.log('\n4. Le témoin : un travail rendu n’est pas repris');
/* ------------------------------------------------------------------ */

const rendue = store.getCard('rendue');
verifier(rendue?.column === 'to_deploy', 'la carte rendue est restée dans « À déployer »');
verifier(rendue?.scheduling?.waitingReason === undefined, 'aucune raison d’attente ne lui a été collée');
verifier(rendue?.scheduling?.restarts === 0, 'aucune reprise ne lui a été comptée');

/* ------------------------------------------------------------------ */
console.log('\n5. Le rapport rendu ferme la carte, le constat écrit la phrase');
/* ------------------------------------------------------------------ */

const { traceAcquise, colonneEnFinDeTour, issueDeFinDeTour, RAISON_TRACE_INCONNUE, RAISON_RENDU_SANS_CODE } =
  partage;
verifier(traceAcquise('oui') === true, 'un dépôt qui a bougé atteste une livraison');
verifier(traceAcquise('non') === false, 'un dépôt qui n’a pas bougé n’en atteste aucune');
verifier(
  traceAcquise('inconnue') === false && colonneEnFinDeTour('running', true, 'task') === 'to_deploy',
  'un dépôt qu’on n’a pas pu consulter n’empêche plus la clôture : le rapport suffit',
);
verifier(
  issueDeFinDeTour('running', true, 'task', 'inconnue', false).raison === RAISON_TRACE_INCONNUE,
  'et la carte dit que le constat n’a pas pu être fait',
);
verifier(
  issueDeFinDeTour('running', true, 'task', 'non', false).raison === RAISON_RENDU_SANS_CODE,
  'une carte close sans une ligne de code le dit, plutôt que de laisser croire à une livraison',
);
verifier(
  issueDeFinDeTour('running', true, 'task', 'non', false).colonne === 'to_deploy',
  'et elle ne reste pas coincée en « En cours »',
);

/* ------------------------------------------------------------------ */

fs.rmSync(dossier, { recursive: true, force: true });

if (echecs.length) {
  console.error(`\n${echecs.length} contrôle(s) en échec.`);
  process.exit(1);
}
console.log('\nUne tâche coupée par une panne revient interrompue, reprenable, et jamais terminée.');
