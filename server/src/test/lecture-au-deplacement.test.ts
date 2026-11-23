import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Card, carteNonLue } from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* CHANGER DE COLONNE VAUT CONSULTATION                                 */
/*                                                                     */
/* La pastille bleue d'une carte s'éteignait à l'ouverture, au clic sur */
/* la pastille, ou par « tout marquer comme lu ». Elle s'éteint         */
/* désormais AUSSI dès qu'une carte change de colonne — glisser à la    */
/* main comme rangement du démon (fin de tour, archivage, publication,  */
/* retour en arrière). La règle vit dans `store.saveCard`, le passage   */
/* unique de toute écriture de carte : aucun des dix chemins de         */
/* rangement ne peut donc l'oublier.                                    */
/*                                                                     */
/* Deux bornes tenues ici : une CRÉATION n'est pas un déplacement, et   */
/* une écriture qui ne change pas de colonne ne marque rien.            */
/* ------------------------------------------------------------------ */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'lecture-au-deplacement-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');

const PROJET = 'projet-essai';

function poser(id: string, patch: Partial<Card> = {}): Card {
  const maintenant = Date.now();
  return store.saveCard(
    Card.parse({
      id,
      projectId: PROJET,
      title: `Carte ${id}`,
      column: 'planned',
      position: 1,
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      createdAt: maintenant,
      updatedAt: maintenant,
      ...patch,
    }),
  );
}

test('une carte qui naît n’est pas « consultée »', () => {
  const carte = poser('c-neuve');
  assert.equal(carte.lastReadAt, undefined);
});

test('une écriture SANS changement de colonne ne marque rien', () => {
  poser('c-immobile', { renduA: Date.now() });
  const relue = store.saveCard({ ...store.getCard('c-immobile')!, title: 'Titre retouché' });
  assert.equal(relue.lastReadAt, undefined);
  assert.equal(carteNonLue({ colonne: relue.column, renduA: relue.renduA, luA: relue.lastReadAt }), true);
});

test('changer de colonne éteint la pastille, quel que soit le chemin', () => {
  const rendu = Date.now() - 5_000;
  poser('c-deplacee', { renduA: rendu });
  const deplacee = store.saveCard({ ...store.getCard('c-deplacee')!, column: 'running' });
  assert.ok((deplacee.lastReadAt ?? 0) >= rendu, 'le repère de lecture est posé au déplacement');
  assert.equal(
    carteNonLue({ colonne: deplacee.column, renduA: deplacee.renduA, luA: deplacee.lastReadAt }),
    false,
  );
});

test('un repère de lecture plus récent que l’instant du déplacement l’emporte', () => {
  const futur = Date.now() + 60_000;
  poser('c-lue-plus-tard', { renduA: Date.now() });
  const deplacee = store.saveCard({
    ...store.getCard('c-lue-plus-tard')!,
    column: 'archived',
    lastReadAt: futur,
  });
  assert.equal(deplacee.lastReadAt, futur);
});

test('LA CLÔTURE D’UN TRAVAIL RENDU GARDE SA PASTILLE : c’est l’exception', () => {
  poser('c-fin-de-tour', { column: 'running' });
  // Le démon pose d'abord l'instant du rendu, puis range la carte dans le lot à
  // publier. C'est le moment même où le compte rendu arrive : la pastille doit
  // rester allumée jusqu'à ce qu'on ouvre la carte.
  const rendue = store.marquerRendu({ cardId: 'c-fin-de-tour' })!;
  assert.ok(carteNonLue({ colonne: rendue.column, renduA: rendue.renduA, luA: rendue.lastReadAt }));
  const rangee = store.saveCard({ ...store.getCard('c-fin-de-tour')!, column: 'to_deploy' });
  assert.equal(
    carteNonLue({ colonne: rangee.column, renduA: rangee.renduA, luA: rangee.lastReadAt }),
    true,
    'un travail rendu allume bien sa pastille bleue',
  );
});

test('…et tout AUTRE déplacement continue de l’éteindre', () => {
  poser('c-archivee', { column: 'to_deploy', renduA: Date.now() - 5_000 });
  const archivee = store.saveCard({ ...store.getCard('c-archivee')!, column: 'archived' });
  assert.equal(
    carteNonLue({ colonne: archivee.column, renduA: archivee.renduA, luA: archivee.lastReadAt }),
    false,
    'archiver une carte vaut consultation',
  );
});

/* « MARQUER COMME NON LU » : le geste inverse de la lecture. */

test('marquer comme non lu rallume la pastille sans faire remonter la carte', () => {
  const rendu = Date.now() - 10_000;
  const posee = poser('c-relue', { column: 'to_deploy', renduA: rendu });
  const lue = store.markCardRead(posee.id)!;
  assert.equal(carteNonLue({ colonne: lue.column, renduA: lue.renduA, luA: lue.lastReadAt }), false);
  const nonLue = store.markCardUnread(posee.id)!;
  assert.ok(nonLue, 'la carte est rendue à diffuser');
  assert.equal(carteNonLue({ colonne: nonLue.column, renduA: nonLue.renduA, luA: nonLue.lastReadAt }), true);
  assert.equal(nonLue.updatedAt, lue.updatedAt, 'la dernière action ne bouge pas');
  assert.equal(store.getCard(posee.id)!.lastReadAt, undefined, 'le repère de lecture est retiré en base');
});

test('marquer comme non lu ne touche ni une carte sans rendu, ni une carte déjà non lue, ni une carte rangée', () => {
  poser('c-sans-rendu');
  assert.equal(store.markCardUnread('c-sans-rendu'), null);
  poser('c-deja-non-lue', { renduA: Date.now() });
  assert.equal(store.markCardUnread('c-deja-non-lue'), null);
  poser('c-rangee', { column: 'archived', renduA: Date.now() - 5_000, lastReadAt: Date.now() });
  assert.equal(store.markCardUnread('c-rangee'), null);
  assert.equal(store.markCardUnread('c-inexistante'), null);
});

/* LA MISE EN LIGNE NE VAUT PAS LECTURE (01/11/2026) : la carte déployée reste en gras dans la zone « En cours ». */

test('la mise en ligne range la carte sans la marquer lue, et l’ouvrir l’éteint', async () => {
  const { deployeeNonVue } = await import('@beluga/shared');
  const lueAvant = Date.now() - 60_000;
  poser('c-deployee', { column: 'to_deploy', renduA: lueAvant - 1000, lastReadAt: lueAvant });
  // La publication pose la date, puis range la carte dans « Archivé ».
  const datee = store.saveCard({ ...store.getCard('c-deployee')!, deployedAt: Date.now() });
  const rangee = store.saveCard({ ...datee, column: 'archived' });
  assert.equal(rangee.lastReadAt, lueAvant, 'le rangement par la publication ne pose pas de lecture');
  assert.equal(deployeeNonVue(rangee), true);
  const ouverte = store.markCardRead('c-deployee', Date.now() + 1)!;
  assert.equal(deployeeNonVue(ouverte), false);
  // la lecture de la colonne la porte tant qu'elle n'est pas ouverte
  const instant = Date.now();
  store.saveProject({ id: PROJET, name: 'Essai', path: bacASable, defaultEngine: 'claude', isSelf: false, archived: false, createdAt: instant, updatedAt: instant } as any);
  poser('c-deployee-2', { column: 'to_deploy' });
  store.saveCard({ ...store.saveCard({ ...store.getCard('c-deployee-2')!, deployedAt: Date.now() }), column: 'archived' });
  const ids = store.tachesDeLaColonne().map((c) => c.id);
  assert.ok(ids.includes('c-deployee-2'));
  assert.ok(!ids.includes('c-deployee'));
});

test('archiver à la main une carte sans date de mise en ligne vaut toujours consultation', () => {
  poser('c-rangee-main', { column: 'to_deploy', renduA: Date.now() - 5_000 });
  const rangee = store.saveCard({ ...store.getCard('c-rangee-main')!, column: 'archived' });
  assert.ok((rangee.lastReadAt ?? 0) >= (rangee.renduA ?? 0));
});
