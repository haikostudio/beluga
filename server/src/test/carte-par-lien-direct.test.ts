import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ClientCommand } from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* UNE TÂCHE OUVERTE PAR LIEN DIRECT NE PEUT PLUS RESTER MUETTE         */
/*                                                                      */
/* Le tiroir d'une carte n'a que l'identifiant lu dans l'adresse. Quand  */
/* la carte n'est pas dans l'instantané du projet, il la RÉCLAME au      */
/* serveur (`card.get`) au lieu d'attendre une arrivée qui, pour une     */
/* carte effacée, n'aura jamais lieu — c'était le symptôme « tâche       */
/* inaccessible » : un tiroir vide, sans contenu et sans erreur.         */
/*                                                                      */
/* Deux promesses tenues ici : la commande existe bel et bien dans le    */
/* protocole, et la lecture d'un identifiant inconnu rend un NULL franc  */
/* — c'est lui que le serveur traduit en « introuvable », et l'écran en  */
/* « Cette tâche n'existe plus ».                                        */
/* ------------------------------------------------------------------ */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'carte-lien-direct-'));
// Posé AVANT tout import du démon : sinon ce test tomberait sur la base
// réellement servie.
process.env.BELUGA_DATA = bacASable;

test('le protocole connaît la demande d’une carte par son seul identifiant', () => {
  const lue = ClientCommand.parse({ type: 'card.get', id: 'peu-importe' });
  assert.equal(lue.type, 'card.get');
});

test('une carte sans identifiant est refusée par le protocole', () => {
  assert.throws(() => ClientCommand.parse({ type: 'card.get' }));
});

test('un identifiant inconnu rend un null franc, jamais une attente', async () => {
  const store = await import('../store.js');
  assert.equal(store.getCard('41f8f788-2a60-4ae1-a2dd-aca2343d2ddd'), null);
});
