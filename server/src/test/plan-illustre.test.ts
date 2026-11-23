import test from 'node:test';
import assert from 'node:assert/strict';
import { lireLigneDIllustration, lirePlanRendu, rendrePlan } from '@beluga/shared';

const base = {
  titre: 'Plan d’essai',
  enClair: 'Je vais refaire la barre du bas pour qu’elle tienne au-dessus du clavier. Une fois fini, vous écrirez sans que rien ne saute, et tout reviendra à sa place quand le clavier se fermera, sur téléphone comme sur ordinateur.',
  synthese: 'La barre suit le clavier.',
  taches: [
    { titre: 'Mesurer le clavier', description: 'Une seule mesure.' },
    { titre: 'Poser la barre', description: 'Sur le clavier.' },
  ],
  decisions: ['Comportement natif → retenu'],
  verifications: ['La barre touche le clavier'],
  cahierDesCharges: [
    { titre: 'Contexte et objectifs', contenu: 'a' },
    { titre: 'Pour qui', contenu: 'b' },
    { titre: 'Périmètre', contenu: 'c' },
    { titre: 'Critères de réussite', contenu: 'd' },
  ],
};

test('un plan sans illustration se rend comme avant', () => {
  const lu = lirePlanRendu(base);
  assert.equal(lu.ok, true);
  if (!lu.ok) return;
  assert.equal(lu.valeur.illustrations, undefined);
  assert.equal(rendrePlan(lu.valeur).includes('piece:'), false);
});

test('chaque illustration se pose sous sa tâche, les autres en tête', () => {
  const lu = lirePlanRendu({
    ...base,
    illustrations: [
      { piece: '#9d60', legende: 'La barre posée', tache: 2 },
      { piece: 'abcd-1', legende: 'Avant' },
    ],
  });
  assert.equal(lu.ok, true);
  if (!lu.ok) return;
  // Le démon résout la pièce et pose son repère avant le rendu.
  lu.valeur.illustrations = [
    { piece: 'id-1', legende: 'La barre posée', tache: 2, repere: 'A · #9d60' },
    { piece: 'id-2', legende: 'Avant', repere: '#abcd' },
  ];
  const texte = rendrePlan(lu.valeur);
  const lignes = texte.split('\n');
  const tete = lignes.findIndex((l) => l.includes('piece:id-2'));
  const tache2 = lignes.findIndex((l) => l.startsWith('**Poser la barre**'));
  const image2 = lignes.findIndex((l) => l.includes('piece:id-1'));
  assert.ok(tete > 0 && tete < tache2, 'l’illustration sans tâche vient avant la liste des tâches');
  assert.ok(image2 > tache2, 'l’illustration de la tâche 2 vient sous elle');
  assert.deepEqual(lireLigneDIllustration(lignes[image2]!), { piece: 'id-1', libelle: 'A · #9d60 — La barre posée', neuf: false });
  assert.equal(lireLigneDIllustration('![x](https://exemple.com/a.png)'), null);
});

test('une illustration mal formée est refusée avec sa raison', () => {
  const sansLegende = lirePlanRendu({ ...base, illustrations: [{ piece: '#9d60' }] });
  assert.equal(sansLegende.ok, false);
  const horsTaches = lirePlanRendu({ ...base, illustrations: [{ piece: '#9d60', legende: 'x', tache: 5 }] });
  assert.equal(horsTaches.ok, false);
  if (!horsTaches.ok) assert.match(horsTaches.raison, /entre 1 et 2/);
  const tropNombreuses = lirePlanRendu({ ...base, illustrations: Array.from({ length: 5 }, (_, i) => ({ piece: `p${i}`, legende: 'x' })) });
  assert.equal(tropNombreuses.ok, false);
});
