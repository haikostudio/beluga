/**
 * MODIFIER UN MESSAGE EN ATTENTE NE LUI FAIT JAMAIS PERDRE UN FICHIER.
 *
 * Le signalement : « quand je veux éditer un prompt en attente, ça casse les
 * images — j'ai peur qu'il ne sache pas les récupérer au moment où je valide ».
 * À l'écran, les dix images du message n'étaient plus que des pastilles sans
 * vignette, sous la pièce jointe d'un AUTRE texte (le brouillon mis de côté).
 *
 * Ce que la file faisait vraiment : `queue.update` ne changeait que le texte.
 * Les fichiers partaient donc bien avec le message — mais retirer la pastille
 * d'une image ne la retirait pas, et une image jointe pendant la modification
 * n'entrait jamais dans le message. Ces essais verrouillent la règle pure
 * (`piecesApresModification`) puis le trajet réel, en base.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Attachment, ancre, designationDePiece, piecesApresModification, tagsEnEspacesOrdinaires } from '@beluga/shared';

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'file-modifiee-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');

const AGENT = 'agent-de-la-file';

function piece(id: string, alias: string, name = 'image.png'): Attachment {
  return Attachment.parse({ id, projectId: 'projet', alias, name, mime: 'image/png', size: 10, sha: `sha-${id}`, createdAt: 1 });
}

const a = piece('a9d60000-0000-4000-8000-000000000001', 'a9d6', 'image (20).png');
const b = piece('eb3f0000-0000-4000-8000-000000000002', 'eb3f', 'image (19).png');
const c = piece('acee0000-0000-4000-8000-000000000003', 'acee', 'image (21).png');

/** Le tag tel qu'il est ENREGISTRÉ : espaces ordinaires, désignation avec alias. */
const tag = (p: Attachment) => tagsEnEspacesOrdinaires(ancre(designationDePiece(p)));
const TEXTE = `le fil d'Ariane ${tag(a)} les backups ${tag(b)} la structure ${tag(c)}`;

/* -------- La règle pure -------- */

test('un écran qui ne dit rien des pièces ne retire rien', () => {
  assert.deepEqual(piecesApresModification([a.id, b.id], [a, b], 'texte réécrit, sans un seul tag'), [a.id, b.id]);
});

test('la pastille retirée retire CE fichier, les autres restent', () => {
  const sansB = `le fil d'Ariane ${tag(a)} les backups la structure ${tag(c)}`;
  assert.deepEqual(piecesApresModification([a.id, b.id, c.id], [a, b, c], sansB, [a.id, c.id]), [a.id, c.id]);
});

test('un fichier joint pendant la modification entre dans le message', () => {
  const avecC = `${tag(a)} et aussi ${tag(c)}`;
  assert.deepEqual(piecesApresModification([a.id], [a], avecC, [a.id, c.id]), [a.id, c.id]);
});

test('une pièce encore citée par son tag reste, même si la liste reçue l’a oubliée', () => {
  assert.deepEqual(piecesApresModification([a.id, b.id, c.id], [a, b, c], TEXTE, []), [a.id, b.id, c.id]);
  // Les espaces insécables du champ de saisie désignent la même pièce.
  assert.deepEqual(piecesApresModification([a.id], [a], `voir ${ancre(designationDePiece(a))}`, []), [a.id]);
});

test('un tag au seul nom ne retient rien de force : il désigne aussi bien un homonyme', () => {
  const premiere = piece('247c0000-0000-4000-8000-000000000004', '247c');
  const seconde = piece('f0da0000-0000-4000-8000-000000000005', 'f0da');
  const texte = 'un seul tag reste [fichier: image.png]';
  assert.deepEqual(
    piecesApresModification([premiere.id, seconde.id], [premiere, seconde], texte, [premiere.id]),
    [premiere.id],
  );
});

test('une pièce demandée deux fois n’est gardée qu’une fois, dans l’ordre demandé', () => {
  assert.deepEqual(piecesApresModification([a.id, b.id], [a, b], 'sans tag', [b.id, a.id, b.id]), [b.id, a.id]);
});

/* -------- Le trajet réel, en base -------- */

for (const p of [a, b, c]) store.saveAttachment(p);

test('modifier le texte seul garde toutes les pièces du message', () => {
  const empilee = store.enqueuePrompt(AGENT, TEXTE, [a.id, b.id, c.id]);
  assert.ok(empilee, 'la demande doit entrer en file');
  const modifiee = store.updateQueued(empilee.id, `${TEXTE} — et relis tout`);
  assert.deepEqual(modifiee?.attachments, [a.id, b.id, c.id]);

  // Relue depuis la base, puis telle qu'elle partira au moteur.
  const depilee = store.dequeuePrompt(AGENT);
  assert.equal(depilee?.text, `${TEXTE} — et relis tout`);
  assert.deepEqual(depilee?.attachments, [a.id, b.id, c.id], 'les fichiers partent avec le message modifié');
});

test('la liste donnée par l’écran remplace celle du message, sans rien perdre de ce qui est encore cité', () => {
  const empilee = store.enqueuePrompt(AGENT, TEXTE, [a.id, b.id]);
  assert.ok(empilee);
  // La pastille de « b » est retirée, « c » est jointe, et la liste oublie « a » (encore citée).
  const texte = `le fil d'Ariane ${tag(a)} la structure ${tag(c)}`;
  const modifiee = store.updateQueued(empilee.id, texte, [c.id]);
  assert.deepEqual(modifiee?.attachments, [c.id, a.id]);
  assert.deepEqual(store.dequeuePrompt(AGENT)?.attachments, [c.id, a.id]);
});

test('la modification ne touche à rien d’autre : bulle déjà écrite, silence, compte imposé', () => {
  const empilee = store.enqueuePrompt(AGENT, 'Reprends.', [a.id], 'bulle-1', {
    silencieuse: true,
    compteImpose: 'claude-secondary',
  });
  assert.ok(empilee);
  store.updateQueued(empilee.id, 'Reprends, mais lentement.', []);
  const depilee = store.dequeuePrompt(AGENT);
  assert.equal(depilee?.messageId, 'bulle-1');
  assert.equal(depilee?.silencieuse, true);
  assert.equal(depilee?.compteImpose, 'claude-secondary');
  assert.deepEqual(depilee?.attachments, [], 'la pièce retirée, que plus aucun tag ne cite, ne part plus');
});

test('un message déjà parti ne se modifie plus', () => {
  assert.equal(store.updateQueued('inconnu', 'trop tard', [a.id]), null);
});
