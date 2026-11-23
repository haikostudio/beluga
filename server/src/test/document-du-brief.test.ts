import test from 'node:test';
import assert from 'node:assert/strict';
import { documentDuBriefEnMarkdown, citeLeNom, documentDuBrief, mediasDuDocument, nomsDesImagesDuBrief, pieceJointeDuTexte } from '@beluga/shared';

/*
 * LE BRIEF EN UN SEUL DOCUMENT (26/10/2026) : des parties, des sections, les
 * pièces fournies posées là où le texte les cite, l'ambiance dans sa section,
 * et le Markdown de l'archive qui pointe exactement vers ses images.
 */

const piece = (cle: string, genre: string, titre: string, contenu: string, etat = 'valide') => ({ id: `id-${cle}`, cle, genre, titre, contenu, etat, versions: [{ creeLe: 1000 }] });

/* Le cas réel de la carte de la vidéo de Chris. */
const brief = piece(
  'brief',
  'brief',
  'Brief',
  [
    '- Objectif : Présenter l’offre de Chris.',
    '- Pièces à fournir : 1) Photo de face de Chris en pied. 2) Photo de Chris en trois quarts en pied. (réponse)',
    '- Contraintes : DÉCOR : sur toute la hauteur du mur, des lamelles de bois verticales ; des plantes en arrière-plan.',
    '- Durée : Environ 60 secondes.',
  ].join('\n'),
);
const retenue = piece('direction-a2', 'concept', 'Debout, tout simple', 'Un plan américain.');
const ecartee = piece('direction-b2', 'concept', 'Debout, avec l’addition', 'Autre piste.', 'refuse');
const face = piece('piece-photo-de-face-de-chris-en-pied', 'reference', 'Photo de face de Chris en pied', 'Pièce fournie par l’utilisateur : Photo de face de Chris en pied\nPièce jointe : 43f3da04-b1f7 (Image 23_50_33-3.png)');
const troisQuarts = piece('piece-photo-de-chris-en-trois-quarts-en-pied', 'reference', 'Photo de Chris en trois quarts en pied', 'Pièce fournie par l’utilisateur : Photo de Chris en trois quarts en pied\nPièce jointe : 8dbadf0f-6a26 (Image 23_50_31-1.png)');
const logo = piece('piece-logo', 'reference', 'Logo du studio', 'Pièce fournie par l’utilisateur : Logo du studio\nPièce jointe : aaaa-bbbb (logo.svg)');
const scenario = piece('scenario', 'script', 'Le pitch', 'Salut ! Je suis l’avatar.', 'propose');
const plan1 = piece('plan-1', 'plan', 'Plan 1 : « Salut ! »', 'Angle A, 13 s.', 'propose');
const plan2 = piece('plan-2', 'plan', 'Plan 2 : la présentation', 'Angle B, 9 s.', 'propose');

const blocs = [
  { etape: 'brief', elements: [brief] },
  { etape: 'direction', elements: [retenue, ecartee, face, troisQuarts, logo] },
  { etape: 'scenario', elements: [scenario] },
  { etape: 'plans', elements: [plan1, plan2] },
];
const ambiance = [
  { piece: 'mur-bois', phase: 'budget', legende: 'Le décor : bois vertical et plantes floues', at: 2000 },
  { piece: 'storyboard-1', phase: 'plans', at: 3000 },
];

test('le brief se lit en parties, une section par pièce, sans pièce reçue ni piste écartée', () => {
  const parties = documentDuBrief(blocs, ambiance);
  assert.deepEqual(
    parties.map((p) => p.cle),
    ['brief', 'direction', 'scenario', 'plans', 'pieces-fournies'],
  );
  const direction = parties.find((p) => p.cle === 'direction')!;
  assert.deepEqual(direction.sections.map((s) => s.titre), ['Debout, tout simple']);
  /* La piste écartée vit dans le menu « Versions » de la retenue, jamais dans le texte. */
  assert.deepEqual(direction.sections[0]!.pistes.map((p) => p.cle), ['direction-b2']);
  assert.equal(parties.find((p) => p.cle === 'plans')!.sections.length, 2);
  /* Les ancres sont uniques. */
  const ancres = parties.flatMap((p) => [p.ancre, ...p.sections.map((s) => s.ancre)]);
  assert.equal(new Set(ancres).size, ancres.length);
});

test('les photos fournies se posent après le paragraphe qui les cite, et aucune ne se perd', () => {
  const parties = documentDuBrief(blocs, ambiance);
  const sectionBrief = parties[0]!.sections[0]!;
  const posees = sectionBrief.medias.filter((m) => m.origine === 'piece');
  assert.deepEqual(posees.map((m) => m.attachmentId), ['43f3da04-b1f7', '8dbadf0f-6a26']);
  /* Après « Pièces à fournir », le deuxième paragraphe. */
  assert.ok(posees.every((m) => m.apres === 1));
  assert.equal(posees[0]!.nomDeFichier, 'Image 23_50_33-3.png');
  /* Jamais citée : « Pièces fournies ». */
  const fin = parties.at(-1)!;
  assert.deepEqual(fin.sections[0]!.medias.map((m) => m.attachmentId), ['aaaa-bbbb']);
  /* Invariant : médias posés = pièces reçues + ambiance. */
  assert.equal(mediasDuDocument(parties).length, 3 + ambiance.length);
});

test('l’ambiance descend sous le paragraphe qui en parle, ou à la fin de la section de sa phase', () => {
  const parties = documentDuBrief(blocs, ambiance);
  const mur = parties[0]!.sections[0]!.medias.find((m) => m.attachmentId === 'mur-bois')!;
  assert.equal(mur.apres, 2, 'sous « Contraintes : DÉCOR… bois… plantes »');
  assert.equal(mur.legende, 'Le décor : bois vertical et plantes floues');
  const plans = parties.find((p) => p.cle === 'plans')!;
  const story = plans.sections[0]!.medias[0]!;
  assert.equal(story.attachmentId, 'storyboard-1');
  assert.ok(story.legende.length > 0, 'sans légende : le nom de la phase');
});

test('sans section pour sa phase, l’ambiance rejoint « Pièces fournies »', () => {
  const parties = documentDuBrief([{ etape: 'brief', elements: [] }], [{ piece: 'x', phase: 'direction', at: 1 }]);
  assert.equal(parties.length, 1);
  assert.equal(parties[0]!.cle, 'pieces-fournies');
  assert.equal(parties[0]!.sections[0]!.medias[0]!.attachmentId, 'x');
});

test('toutes les directions écartées : la ligne seule les garde reprenables', () => {
  const parties = documentDuBrief([{ etape: 'direction', elements: [ecartee] }]);
  assert.equal(parties[0]!.sections.length, 0);
  assert.equal(parties[0]!.pistesSeules.length, 1);
});

test('le nom cité se reconnaît sans accents, sans casse, au pluriel', () => {
  assert.ok(citeLeNom('PHOTO DE FACE de Chris, en pied', 'Photo de face de Chris en pied'));
  assert.ok(citeLeNom('les photos des plantes vertes', 'Plante verte photo'));
  assert.ok(!citeLeNom('Durée : 60 secondes', 'Photo de face de Chris en pied'));
  assert.deepEqual(pieceJointeDuTexte('Pièce jointe : #8dba (a.png)'), { id: '8dba', nom: 'a.png' });
  assert.equal(pieceJointeDuTexte('rien'), null);
});

test('le Markdown de l’archive pointe exactement vers ses images, dédoublonnées', () => {
  const parties = documentDuBrief(blocs, ambiance);
  const medias = mediasDuDocument(parties);
  const noms = nomsDesImagesDuBrief(medias, () => 'photo.png');
  const chemins = [...noms.values()];
  assert.equal(new Set(chemins).size, chemins.length);
  assert.ok(chemins.every((c) => /^images\/[^/]+\.png$/.test(c)));
  const md = documentDuBriefEnMarkdown(parties, { titre: 'Brief (Vidéo)', libelleDe: (c) => ({ brief: 'Brief', direction: 'Direction artistique', scenario: 'Scénario', plans: 'Plans', 'pieces-fournies': 'Pièces fournies' })[c] ?? c, images: noms });
  for (const c of chemins) assert.ok(md.includes(`](${c})`), c);
  assert.ok(md.startsWith('# Brief (Vidéo)'));
  /* La section « Brief » porte le nom de sa partie : un seul titre. */
  assert.ok(!md.includes('### Brief\n'));
  assert.ok(md.includes('**Objectif**'));
  assert.ok(!md.includes('Pièce jointe :'), 'aucun identifiant brut');
  assert.ok(!md.includes('Debout, avec l’addition'), 'la piste écartée reste hors du texte');
  /* Le texte copié : « Image : légende » à la place. */
  const copie = documentDuBriefEnMarkdown(parties, { titre: 'Brief', libelleDe: (c) => c });
  assert.ok(copie.includes('*Image : Photo de face de Chris en pied*'));
  assert.ok(!copie.includes(']('));
});
