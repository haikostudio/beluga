import test from 'node:test';
import assert from 'node:assert/strict';
import { controlesTombes, detailDEchec, phraseDEchec } from '@haikodev/shared';

/*
 * Quand la publication refuse, elle NOMME ce qui tombe.
 *
 * Le refus lui-même ne change pas : contrôles en échec, rien n'est mis en
 * ligne. Ce qui change, c'est qu'on ne coupe plus la sortie aux 800 derniers
 * signes — qui ne portent que le décompte final.
 */

/** Une sortie de `node --test` comme la publication en reçoit. */
function sortie(noms: string[], remplissage = 2000): string {
  const lignes: string[] = ['TAP version 13', 'ok 1 - un contrôle qui passe'];
  noms.forEach((nom, i) => {
    lignes.push(`not ok ${i + 2} - ${nom}`);
    lignes.push('  ---');
    lignes.push('  duration_ms: 11.3');
    lignes.push(`  location: '/root/projet/server/dist/test/exemple.test.js:${87 + i}:1'`);
    lignes.push('  failureType: \'testCodeFailure\'');
    lignes.push('  ...');
  });
  lignes.push('x'.repeat(remplissage));
  lignes.push('1..10', '# tests 10', `# fail ${noms.length}`);
  return lignes.join('\n');
}

test('le contrôle tombé est relevé avec son endroit', () => {
  const tombes = controlesTombes(sortie(['le briefing envoie l’index']));
  assert.equal(tombes.length, 1);
  assert.equal(tombes[0].nom, 'le briefing envoie l’index');
  assert.match(tombes[0].endroit ?? '', /exemple\.test\.js:87/);
});

test('les sous-contrôles indentés ne sont pas comptés deux fois', () => {
  const texte = ['not ok 3 - le père', '    not ok 1 - l’enfant', '  ---'].join('\n');
  const tombes = controlesTombes(texte);
  assert.deepEqual(tombes.map((c) => c.nom), ['le père']);
});

test('une sortie sans échec ne relève rien', () => {
  assert.deepEqual(controlesTombes('ok 1 - tout va bien\n# fail 0'), []);
});

test('la phrase de refus nomme le contrôle tombé', () => {
  const une = phraseDEchec(sortie(['le briefing envoie l’index']));
  assert.match(une, /Une vérification échoue/);
  assert.match(une, /« le briefing envoie l’index »/);
  assert.match(une, /Rien n'est mis en ligne\./);

  const trois = phraseDEchec(sortie(['un', 'deux', 'trois']));
  assert.match(trois, /^3 vérifications échouent/);
  assert.match(trois, /« deux »/);
});

test('au-delà de cinq contrôles, le reste est compté et non déroulé', () => {
  const phrase = phraseDEchec(sortie(['a', 'b', 'c', 'd', 'e', 'f', 'g']));
  assert.match(phrase, /et 2 autres/);
  assert.doesNotMatch(phrase, /« g »/);
});

test('sans rien à nommer, le refus garde sa phrase et ne rend pas un blanc', () => {
  const phrase = phraseDEchec('la commande est introuvable');
  assert.equal(phrase, 'Les vérifications échouent : rien n\'est mis en ligne.');
});

test('le détail met les contrôles tombés EN TÊTE, avant la fin de la sortie', () => {
  const texte = sortie(['le briefing envoie l’index']);
  const detail = detailDEchec(texte);
  assert.match(detail, /^Contrôles tombés :/);
  assert.match(detail, /le briefing envoie l’index/);
  // La fin brute reste là, mais elle ne passe plus devant.
  assert.match(detail, /# fail 1/);
  assert.ok(detail.indexOf('le briefing') < detail.indexOf('# fail 1'));
  // Le nom était hors des 800 derniers signes : c'est tout le problème.
  assert.doesNotMatch(texte.slice(-800), /le briefing/);
});

test('sans échec relevé, le détail reste la fin de la sortie', () => {
  assert.equal(detailDEchec('rien de tapé ici', 800), 'rien de tapé ici');
});
