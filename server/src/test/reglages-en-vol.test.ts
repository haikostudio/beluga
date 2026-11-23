import test from 'node:test';
import assert from 'node:assert/strict';
import { brouillonSansLesPiecesParties, reglagesSansRecul } from '@beluga/shared';

/*
 * Un réglage envoyé d'ici ne recule pas tant que le serveur ne l'a pas
 * confirmé (`shared/src/reglages-en-vol.ts`) : c'est ce qui renvoyait le
 * curseur du champ d'écriture à la fin du texte.
 */
test('un bloc de réglages plus vieux que notre envoi ne défait pas la clé en vol', () => {
  const recus = { 'draft.a': 'Bonjour [fichier: x.png #1a0c]', 'draftAttachments.a': [], theme: 'sombre' };
  const jointes = [{ id: 'j1' }];
  const rendu = reglagesSansRecul(recus, [['draftAttachments.a', jointes]]);
  assert.equal(rendu['draftAttachments.a'], jointes);
  assert.equal(rendu['draft.a'], recus['draft.a']);
  assert.equal(rendu.theme, 'sombre');
  // Le bloc reçu n'est jamais modifié sur place.
  assert.deepEqual(recus['draftAttachments.a'], []);
});

test('sans rien en vol — ou quand le bloc dit déjà la même chose — le bloc reçu est rendu tel quel', () => {
  const recus = { 'draft.a': 'texte' };
  assert.equal(reglagesSansRecul(recus, []), recus);
  assert.equal(reglagesSansRecul(recus, [['draft.a', 'texte']]), recus);
});

test('une clé en vol absente du bloc reçu y est ajoutée', () => {
  assert.deepEqual(reglagesSansRecul({}, [['draft.a', 'neuf']]), { 'draft.a': 'neuf' });
});

/*
 * Les pièces parties avec un message quittent son brouillon côté serveur
 * (`brouillonSansLesPiecesParties`) : un autre écran pouvait encore le tenir.
 */
test('les pièces parties avec un message sortent du brouillon, les autres y restent', () => {
  const brouillon = [{ id: 'partie-1' }, { id: 'ajoutee-ailleurs' }, { id: 'partie-2' }];
  const rendu = brouillonSansLesPiecesParties(brouillon, ['partie-1', 'partie-2', 'image-de-question']);
  assert.deepEqual(rendu.liste, [{ id: 'ajoutee-ailleurs' }]);
  assert.equal(rendu.change, true);
  // Le brouillon lu n'est jamais modifié sur place.
  assert.equal(brouillon.length, 3);
});

test('un brouillon déjà vidé, ou un message sans pièce, ne réécrit rien', () => {
  assert.deepEqual(brouillonSansLesPiecesParties([], ['a']), { liste: [], change: false });
  const brouillon = [{ id: 'a' }];
  assert.deepEqual(brouillonSansLesPiecesParties(brouillon, []), { liste: brouillon, change: false });
  assert.deepEqual(brouillonSansLesPiecesParties(brouillon, ['b']), { liste: brouillon, change: false });
  // Un réglage absent ou abîmé ne fait rien tomber.
  assert.deepEqual(brouillonSansLesPiecesParties(undefined, ['a']), { liste: [], change: false });
  assert.deepEqual(brouillonSansLesPiecesParties('a', ['a']), { liste: [], change: false });
});

/*
 * UN BROUILLON VIDE N'EST PAS UN RÉGLAGE (12/10/2026) : 4 400 lignes vides
 * pesaient 280 Ko des 384 Ko du premier envoi, rediffusés à chaque frappe.
 */
test('un brouillon vide se retire, un brouillon réel et tout autre réglage restent', async () => {
  const { estUnReglageVide } = await import('@beluga/shared');
  assert.equal(estUnReglageVide('draft.agent-1', ''), true);
  assert.equal(estUnReglageVide('draftAttachments.agent-1', []), true);
  assert.equal(estUnReglageVide('draft.aucun', ''), true);
  assert.equal(estUnReglageVide('draft.agent-1', 'Bonjour'), false);
  assert.equal(estUnReglageVide('draft.agent-1', ' '), false, 'un espace est un texte');
  assert.equal(estUnReglageVide('draftAttachments.agent-1', [{ id: 'j1' }]), false);
  /* Un `false` ou un « » ailleurs est une VRAIE valeur : jamais retiré. */
  assert.equal(estUnReglageVide('voix.visible', false), false);
  assert.equal(estUnReglageVide('theme', ''), false);
  assert.equal(estUnReglageVide('card.open.abc', []), false);
});

test('un réglage diffusé seul se fusionne dans le bloc connu, sans le modifier ni rien perdre', async () => {
  const { fusionnerLesReglages } = await import('@beluga/shared');
  const connus = { theme: 'sombre', 'draft.a': 'abc', 'draft.b': 'x' };
  const rendu = fusionnerLesReglages(connus, { 'draft.a': 'abcd' });
  assert.deepEqual(rendu, { theme: 'sombre', 'draft.a': 'abcd', 'draft.b': 'x' });
  assert.deepEqual(connus, { theme: 'sombre', 'draft.a': 'abc', 'draft.b': 'x' }, 'le bloc connu n’est pas modifié');
  /* `null` dit « cette clé n'existe plus » : un brouillon vidé disparaît. */
  assert.deepEqual(fusionnerLesReglages(connus, { 'draft.b': null }), { theme: 'sombre', 'draft.a': 'abc' });
  /* Un réglage envoyé d'ici et pas encore confirmé ne recule pas, même par un événement partiel. */
  const enVol: [string, unknown][] = [['draft.a', 'abcde']];
  const recu = reglagesSansRecul(fusionnerLesReglages(connus, { 'draft.a': 'abcd' }), enVol);
  assert.equal(recu['draft.a'], 'abcde');
});
