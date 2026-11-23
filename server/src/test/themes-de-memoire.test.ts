import test from 'node:test';
import assert from 'node:assert/strict';
import { grouperLesUnitesParTheme, libelleDuTheme, sujetCanonique, themeDeLUnite, uniteCorrespond, LIBELLES_DES_THEMES, SUJETS_FUSIONNES, type Unite } from '@beluga/shared';

/*
 * LES THÈMES REPLIÉS DE LA MÉMOIRE (`shared/src/themes-de-memoire.ts`) : les
 * sujets en double se fusionnent, un thème maigre rejoint « Autres sujets »,
 * les vitales passent d'abord, et la recherche mord sur le titre clair comme
 * sur le titre technique.
 */

const u = (id: string, sujets: string[], importance: Unite['importance'] = 'P2', extra: Partial<Unite> = {}) =>
  ({ id, sujets, importance, titre: `Titre ${id}`, resume: '', ...extra }) as Pick<Unite, 'id' | 'sujets' | 'importance' | 'titre' | 'resume' | 'titreHumain'>;

test('les sujets en double se fusionnent en un thème canonique', () => {
  assert.equal(sujetCanonique('carte'), 'cartes');
  assert.equal(sujetCanonique('UI'), 'interface');
  assert.equal(sujetCanonique('Déploiement'), 'publication');
  assert.equal(themeDeLUnite({ sujets: [] }), 'divers');
  assert.equal(themeDeLUnite({ sujets: ['ui', 'cartes'] }), 'interface', 'le premier sujet décide');
  // Une fusion ne mène jamais vers un sujet lui-même fusionné ailleurs (pas de chaîne).
  for (const [de, vers] of Object.entries(SUJETS_FUSIONNES)) assert.equal(SUJETS_FUSIONNES[vers], undefined, `${de} → ${vers} → ?`);
  assert.equal(libelleDuTheme('espace-client'), LIBELLES_DES_THEMES['espace-client']);
  assert.equal(libelleDuTheme('bibliotheque-capgo'), 'Bibliotheque capgo');
});

test('les thèmes : les plus fournis d’abord, les maigres dans « Autres sujets », les vitales en tête', () => {
  const unites = [
    u('MEM-0003', ['ui']),
    u('MEM-0001', ['interface'], 'P0'),
    u('MEM-0002', ['interface'], 'P3'),
    u('MEM-0004', ['carte']),
    u('MEM-0005', ['cartes']),
    u('MEM-0006', ['cartes'], 'P1'),
    u('MEM-0007', ['voix']),
  ];
  const themes = grouperLesUnitesParTheme(unites);
  assert.deepEqual(themes.map((t) => [t.theme, t.unites.length]), [
    ['cartes', 3],
    ['interface', 3],
    ['autres', 1],
  ]);
  assert.deepEqual(themes[1]!.unites.map((x) => x.id), ['MEM-0001', 'MEM-0003', 'MEM-0002']);
  assert.equal(themes[1]!.vitales, 1);
  assert.equal(grouperLesUnitesParTheme([u('MEM-0009', ['voix'])])[0]!.theme, 'voix', 'un seul thème ne part pas dans « Autres »');
});

test('la recherche mord sur le titre clair, le titre technique, le résumé, par la racine des mots', () => {
  const x = u('MEM-0042', ['publication'], 'P1', { titre: 'retryDeploy rejoue tout', titreHumain: 'Relance des mises en ligne tombées', resume: 'Une publication tombée se relance.' });
  assert.ok(uniteCorrespond(x, 'relancer'));
  assert.ok(uniteCorrespond(x, 'retrydeploy'));
  assert.ok(uniteCorrespond(x, 'mises ligne'));
  assert.ok(uniteCorrespond(x, 'MEM-0042'));
  assert.ok(!uniteCorrespond(x, 'coffre'));
  assert.ok(uniteCorrespond(x, '  '));
});
