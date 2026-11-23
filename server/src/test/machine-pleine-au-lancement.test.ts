import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { machinePleine, panneDeLaMachine, ligneDePanne, RAISON_MACHINE_SATUREE } from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* UNE MACHINE PLEINE N'EST PAS UN DOSSIER CASSÉ                       */
/*                                                                     */
/* Constat qui a produit ce fichier : sur sept jours, 73 tours sur 220  */
/* se sont terminés en échec (base servie, table `telemetrie_tache`).  */
/* Parmi les causes lisibles dans les messages, la même revient :      */
/* « spawn git EAGAIN », « la machine ne peut plus lancer de           */
/* sous-processus ». La table des processus est pleine — rien n'est    */
/* cassé, la place manque, et elle revient dès qu'un agent voisin      */
/* finit.                                                             */
/*                                                                     */
/* Côté MOTEUR, cette cause était déjà une panne passagère qui se      */
/* retente toute seule. Côté OUVERTURE DE LA COPIE DE TRAVAIL, non :   */
/* `git worktree add` rendait un échec définitif, la carte s'arrêtait  */
/* net, et il fallait recliquer. Les deux chemins disent maintenant la */
/* même chose.                                                        */
/* ------------------------------------------------------------------ */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SCHEDULER = fs.readFileSync(path.resolve(ICI, '../../../server/src/scheduler.ts'), 'utf8');

/* -------- La règle pure -------- */

test('les erreurs relevées en base sont reconnues comme une machine pleine', () => {
  // Recopiées telles quelles depuis les tours tombés (08.09.2026).
  const relevees = [
    "Dossier de travail impossible à ouvrir pour cette carte (git worktree) : spawn git EAGAIN",
    "EAGAIN: resource temporarily unavailable, posix_spawn '/usr/bin/node'",
    'fatal: cannot fork: Resource temporarily unavailable',
    'Error: spawn ENOMEM',
  ];
  for (const erreur of relevees) assert.equal(machinePleine(erreur), true, erreur);
});

test('une erreur git ORDINAIRE reste un refus définitif', () => {
  // Sans quoi un dépôt absent ou une branche déjà prise repartirait en boucle.
  const definitives = [
    "Dossier de travail impossible à ouvrir pour cette carte (git worktree) : fatal: 'tache/x' is already checked out",
    'fatal: not a git repository',
    "fatal: invalid reference: main",
    '',
  ];
  for (const erreur of definitives) assert.equal(machinePleine(erreur), false, erreur || '(vide)');
});

test('la règle juge le message ENTIER, pas seulement une bannière', () => {
  /*
   * C'est toute la différence avec `ligneDePanne`, qui n'accepte qu'une ligne
   * courte, en tête et sans citation : la sortie d'un `git worktree add` est un
   * pavé, et la saturation y passait inaperçue.
   */
  const pave = [
    'Preparing worktree (new branch)',
    'Updating files:  61% (25000/41000)',
    'fatal: cannot fork: Resource temporarily unavailable',
  ].join('\n');
  assert.equal(ligneDePanne(pave), null, 'la bannière ne reconnaît rien dans un pavé');
  assert.equal(machinePleine(pave), true, 'la règle du message entier, elle, le voit');
});

test('la saturation reste bien classée comme une panne de NOTRE machine', () => {
  assert.equal(panneDeLaMachine(ligneDePanne('spawn git EAGAIN')), true);
});

/* -------- Le branchement dans le lancement -------- */

test('le lancement remet la carte en file au lieu de la refuser', () => {
  const bloc = SCHEDULER.split("if (prepa.kind === 'echec') {")[1].split('\n  }')[0];
  assert.match(bloc, /machinePleine\(prepa\.raison\)/, 'la saturation doit être reconnue avant le refus');
  assert.match(
    bloc,
    /refus\(card, RAISON_MACHINE_SATUREE, true, colonneAvant\)/,
    'la reprise doit être ARMÉE : l’ordonnanceur rejoue le lancement sans second clic',
  );
  // Et le refus définitif reste, pour tout le reste.
  assert.match(bloc, /refus\(card, prepa\.raison, false, colonneAvant\)/);
});

test('la phrase montrée dit que la carte repartira toute seule', () => {
  assert.match(RAISON_MACHINE_SATUREE, /place/i);
});
