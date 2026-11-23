import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Attachment, PROJET_DU_COFFRE, nomSurDisque } from '@beluga/shared';

/**
 * UN TAG COLLÉ DEPUIS UNE AUTRE CARTE RAMÈNE SON FICHIER.
 *
 * Verrouillé ici : une pièce du même projet revient telle quelle ; celle d'un
 * AUTRE projet est recopiée dans le projet où l'on colle (nouvel identifiant,
 * même contenu, même nom) ; coller deux fois ne crée pas de second exemplaire ;
 * un alias inconnu et une image du coffre-fort ne rendent rien.
 */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'rattacher-par-alias-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const { rattacherParAlias } = await import('../joindre-fichier.js');
const { dossierDEcriture } = await import('../pieces-jointes.js');

function projet(nom: string) {
  return store.saveProject({
    id: store.newId(),
    name: nom,
    path: bacASable,
    defaultEngine: 'claude',
    isSelf: false,
    archived: false,
    createdAt: store.now(),
    updatedAt: store.now(),
  } as any);
}

const source = projet('Source');
const cible = projet('Cible');

function deposer(projectId: string, alias: string, contenu: string): Attachment {
  const piece = Attachment.parse({
    id: store.newId(),
    alias,
    projectId,
    name: 'image.png',
    mime: 'image/png',
    size: contenu.length,
    sha: `sha-${alias}`,
    createdAt: Date.now(),
  });
  fs.writeFileSync(path.join(dossierDEcriture(), nomSurDisque(piece)), contenu);
  store.saveAttachment(piece);
  return piece;
}

const ailleurs = deposer(source.id, 'af89', 'contenu-ailleurs');
const ici = deposer(cible.id, '7dba', 'contenu-ici');
deposer(PROJET_DU_COFFRE, 'c0ff', 'secret');

test('la pièce du même projet revient telle quelle', async () => {
  const rendues = await rattacherParAlias({ projectId: cible.id, alias: ['7dba'] });
  assert.deepEqual(rendues.map((r) => [r.alias, r.attachment.id]), [['7dba', ici.id]]);
});

test('la pièce d’un autre projet est recopiée dans celui où l’on colle, une seule fois', async () => {
  const [premiere] = await rattacherParAlias({ projectId: cible.id, alias: ['af89'] });
  assert.ok(premiere);
  assert.equal(premiere.alias, 'af89');
  assert.equal(premiere.attachment.projectId, cible.id);
  assert.notEqual(premiere.attachment.id, ailleurs.id);
  // Un homonyme vit déjà dans la même conversation : la copie se numérote,
  // et le tag collé est réécrit vers sa nouvelle désignation (`tagsRedesignes`).
  assert.equal(premiere.attachment.name, 'image (2).png');
  const copie = path.join(dossierDEcriture(), nomSurDisque(premiere.attachment));
  assert.equal(fs.readFileSync(copie, 'utf8'), 'contenu-ailleurs');
  // La pièce d'origine reste à son projet.
  assert.equal(store.getAttachment(ailleurs.id)?.projectId, source.id);

  const [seconde] = await rattacherParAlias({ projectId: cible.id, alias: ['af89'] });
  assert.equal(seconde?.attachment.id, premiere.attachment.id, 'coller deux fois ne double rien');
});

test('un alias inconnu et une image du coffre-fort ne rendent rien', async () => {
  assert.deepEqual(await rattacherParAlias({ projectId: cible.id, alias: ['zzzz', 'c0ff'] }), []);
  assert.deepEqual(store.attachmentsParAlias([]), []);
});
