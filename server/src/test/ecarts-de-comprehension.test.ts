import test from 'node:test';
import assert from 'node:assert/strict';
import { MARQUE_ECART_FERME as F, MARQUE_ECART_OUVRE as O, ecartsDeComprehension, marquerLesEcarts, sansMarquesDEcart } from '@beluga/shared';

/* Ce qui a changé d'une compréhension à la suivante, marqué en violet (13/11/2026). */
const AVANT = ['### Volet du coffre', 'Le détail s’ouvre à droite. Il se ferme par la croix.', '', '### Menu des outils', 'Trois libellés en tête des groupes.'].join('\n');

test('la première compréhension n’a rien de neuf', () => {
  assert.ok(ecartsDeComprehension(null, AVANT).every((p) => p.etat === 'inchangee'));
  assert.equal(marquerLesEcarts(undefined, AVANT), AVANT);
});

test('une ponctuation ou une casse changée ne colore rien', () => {
  const apres = AVANT.replace('s’ouvre à droite.', 'S’ouvre à droite !').replace('Trois libellés', 'trois  libellés');
  assert.ok(ecartsDeComprehension(AVANT, apres).every((p) => p.etat === 'inchangee'));
  assert.equal(marquerLesEcarts(AVANT, apres), apres);
});

test('une phrase ajoutée ou modifiée est neuve, les autres restent', () => {
  const apres = AVANT.replace('Il se ferme par la croix.', 'Il se ferme par la croix ou en choisissant un dossier. Sur téléphone, rien ne change.');
  const ecarts = ecartsDeComprehension(AVANT, apres);
  assert.deepEqual(
    ecarts.filter((p) => p.etat === 'neuve').map((p) => p.texte),
    ['Il se ferme par la croix ou en choisissant un dossier.', 'Sur téléphone, rien ne change.'],
  );
  const marque = marquerLesEcarts(AVANT, apres);
  assert.match(marque, new RegExp(`^Le détail s’ouvre à droite\\. ${O}Il se ferme`, 'm'));
  assert.equal(sansMarquesDEcart(marque), apres);
});

test('un point au titre nouveau est neuf en entier, sans casser son préfixe', () => {
  const apres = `${AVANT}\n\n### 3. Historique en fenêtre\n- Une fenêtre centrée. Avec sa croix.`;
  const marque = marquerLesEcarts(AVANT, apres);
  assert.match(marque, new RegExp(`^### 3\\. ${O}Historique en fenêtre${F}$`, 'm'));
  assert.match(marque, new RegExp(`^- ${O}Une fenêtre centrée\\.${F} ${O}Avec sa croix\\.${F}$`, 'm'));
  const neuves = ecartsDeComprehension(AVANT, apres).filter((p) => p.etat === 'neuve');
  assert.deepEqual(neuves.map((p) => p.point), ['Historique en fenêtre', 'Historique en fenêtre', 'Historique en fenêtre']);
});

test('un bloc de code n’est jamais marqué', () => {
  const apres = `${AVANT}\n\`\`\`\nnouvelle ligne.\n\`\`\``;
  assert.ok(!marquerLesEcarts(AVANT, apres).split('```')[1].includes(O));
});

test('une phrase n’est jamais coupée dans un passage en gras', () => {
  const apres = `${AVANT}\n**Nouveau. Tout en gras.** Fin.`;
  const marque = marquerLesEcarts(AVANT, apres);
  assert.ok(marque.endsWith(`${O}**Nouveau. Tout en gras.**${F} ${O}Fin.${F}`), marque.split('\n').at(-1));
});

test('une image NEUVE reste une image : sa ligne entière est marquée et se relit (capture #fbac0)', async () => {
  const { lireLigneDIllustration, piecesIllustreesDuTexte } = await import('@beluga/shared');
  const avant = '### Point\nUne phrase.';
  const apres = '### Point\nUne phrase.\n\n![Les services… « Voir plus ». Fin](piece:4eaeed36-cafa-4eab-8063-84018f87f67e)';
  const marque = marquerLesEcarts(avant, apres);
  const ligne = marque.split('\n').find((l) => l.includes('piece:'))!;
  assert.equal(ligne, `${O}![Les services… « Voir plus ». Fin](piece:4eaeed36-cafa-4eab-8063-84018f87f67e)${F}`);
  const lue = lireLigneDIllustration(ligne);
  assert.deepEqual(lue, { piece: '4eaeed36-cafa-4eab-8063-84018f87f67e', libelle: 'Les services… « Voir plus ». Fin', neuf: true });
  assert.deepEqual(piecesIllustreesDuTexte(marque), ['4eaeed36-cafa-4eab-8063-84018f87f67e']);
});

test('une image INCHANGÉE n\'est pas marquée', async () => {
  const { lireLigneDIllustration } = await import('@beluga/shared');
  const texte = '### Point\n![Maquette](piece:abc-123)';
  const marque = marquerLesEcarts(texte, `${texte}\nUne phrase neuve.`);
  const ligne = marque.split('\n')[1]!;
  assert.ok(!ligne.includes(O));
  assert.equal(lireLigneDIllustration(ligne)?.neuf, false);
});
