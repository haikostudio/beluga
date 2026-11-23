import test from 'node:test';
import assert from 'node:assert/strict';
import { detacherLeCahier, fusionnerLeCahier, lireLesRubriques, lirePlanRendu, rendrePlan } from '@beluga/shared';

const CAHIER = [
  { titre: 'Contexte et objectifs', contenu: 'Des messages plus courts.' },
  { titre: 'Pour qui', contenu: 'Haiko, qui ne programme pas.' },
  { titre: 'Périmètre', contenu: 'Le fil des cartes ; pas le site vitrine.' },
  { titre: 'Critères de réussite', contenu: 'Aucun message de plus de 600 signes.' },
];

test('le cahier vivant se remplit au fil des réponses : une rubrique de même titre remplace l’ancienne', () => {
  const premier = fusionnerLeCahier(undefined, lireLesRubriques(CAHIER.slice(0, 2)));
  assert.equal(premier.length, 2);
  const suite = fusionnerLeCahier(premier, [
    { titre: 'pour QUI', contenu: 'Haiko et ses clients.' },
    { titre: 'Périmètre', contenu: 'Le fil des cartes.' },
  ]);
  assert.deepEqual(
    suite.map((r) => r.titre),
    ['Contexte et objectifs', 'pour QUI', 'Périmètre'],
    'l’ordre est gardé, la rubrique neuve s’ajoute à la fin',
  );
  assert.equal(suite[1]!.contenu, 'Haiko et ses clients.');
  assert.equal(lireLesRubriques([{ titre: 'Vide', contenu: '' }, { titre: '' }]).length, 0);
});

const PLAN_COMPACT = {
  titre: 'Messages courts',
  enClair:
    'Je vais raccourcir les messages des agents pour qu’ils se lisent comme une messagerie. Vous verrez trois à cinq phrases par réponse, et le détail restera pour l’agent qui travaille, sans s’afficher dans la conversation.',
  synthese: 'Des messages courts.',
  taches: [
    { titre: 'Plafond', description: 'Six cents signes au plus.' },
    { titre: 'Suites', description: 'Deux ou trois pastilles décrites.' },
  ],
  decisions: ['Longueur → 600 signes'],
  verifications: ['Aucun message ne dépasse 600 signes'],
};

test('le plan compact : plus de faisabilité, de chemin, de conséquences ni d’améliorations exigés', () => {
  const sansCahier = lirePlanRendu(PLAN_COMPACT);
  assert.equal(sansCahier.ok, false, 'sans cahier vivant ni cahier rendu, il manque le cahier');
  assert.match(sansCahier.ok ? '' : sansCahier.raison, /cahierDesCharges/);
  assert.doesNotMatch(sansCahier.ok ? '' : sansCahier.raison, /faisabilite|chemin|consequences|ameliorations/);
  const lu = lirePlanRendu(PLAN_COMPACT, { cahierVivant: CAHIER });
  assert.equal(lu.ok, true);
  if (!lu.ok) return;
  assert.equal(lu.valeur.cahierDesCharges.length, 4, 'le cahier vivant est repris');
  const texte = rendrePlan(lu.valeur);
  assert.deepEqual(
    texte.split('\n').filter((l) => l.startsWith('## ')),
    ['## En clair', '## Liste des tâches', '## Vérifications', '## Décisions des itérations', '## Cahier des charges'],
  );
  assert.equal(lirePlanRendu({ ...PLAN_COMPACT, verifications: [] }, { cahierVivant: CAHIER }).ok, false, 'les vérifications sont exigées');
});

test('le cahier sort du texte du plan pour se replier', () => {
  const lu = lirePlanRendu(PLAN_COMPACT, { cahierVivant: CAHIER });
  assert.equal(lu.ok, true);
  if (!lu.ok) return;
  const { reste, rubriques } = detacherLeCahier(rendrePlan(lu.valeur));
  assert.equal(rubriques.length, 4);
  assert.equal(rubriques[3]!.contenu, 'Aucun message de plus de 600 signes.');
  assert.doesNotMatch(reste, /Cahier des charges|Pour qui/);
  assert.match(reste, /## Vérifications/);
  assert.equal(detacherLeCahier('# Plan\n## En clair\nTexte').rubriques.length, 0);
});
