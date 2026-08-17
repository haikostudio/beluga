import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LANGUES,
  LANGUE_DORIGINE,
  TRADUCTIONS,
  TEXTES_TRADUITS,
  COLUMN_LABELS,
  etiquetteDeLangue,
  formatDeLangue,
  langueParId,
  langueValide,
  manquesDeLaLangue,
  remplirLesTrous,
  traduire,
  trousDuTexte,
} from '@haikodev/shared';

test('cinq langues, le français en langue d’origine', () => {
  assert.equal(LANGUES.length, 5);
  assert.deepEqual(
    LANGUES.map((langue) => langue.id),
    ['fr', 'en', 'es', 'de', 'zh'],
  );
  assert.equal(LANGUE_DORIGINE, 'fr');
  /* Chaque langue a son propre code `lang` : c'est lui qui commande la coupure
     des mots, la voix de synthèse et le correcteur d'orthographe. */
  const etiquettes = new Set(LANGUES.map((langue) => langue.etiquette));
  assert.equal(etiquettes.size, 5);
  assert.equal(etiquetteDeLangue('zh'), 'zh-Hans');
});

test('un nom de langue s’écrit dans sa propre langue, jamais traduit', () => {
  for (const langue of LANGUES) {
    for (const cible of LANGUES) {
      assert.equal(
        traduire(TRADUCTIONS, cible.id, langue.libelle),
        langue.libelle,
        `« ${langue.libelle} » ne doit pas changer en « ${cible.id} »`,
      );
    }
  }
});

test('une valeur inconnue retombe sur le français, jamais sur un vide', () => {
  assert.equal(langueValide('en-US'), 'en');
  assert.equal(langueValide('ZH_cn'), 'zh');
  assert.equal(langueValide('klingon'), 'fr');
  assert.equal(langueValide(''), 'fr');
  assert.equal(langueValide(null), 'fr');
  assert.equal(langueValide(undefined), 'fr');
  assert.equal(langueParId('n’importe quoi').id, 'fr');
});

test('le format des dates et des nombres suit la langue, et reste suisse en français', () => {
  /* Traduire les mots sans traduire les chiffres laisserait « 17.08.2026 » au
     milieu d'une page anglaise. Et le français d'ici est SUISSE : la valeur ne
     bouge pas d'un cheveu pour qui n'a pas changé de langue. */
  assert.equal(formatDeLangue('fr'), 'fr-CH');
  assert.equal(formatDeLangue('en'), 'en-GB');
  assert.equal(formatDeLangue('inconnu'), 'fr-CH');
});

test('la langue d’origine ne consulte aucun dictionnaire', () => {
  assert.deepEqual(TRADUCTIONS.fr, {});
  assert.equal(traduire(TRADUCTIONS, 'fr', 'Réglages'), 'Réglages');
});

test('une traduction manquante rend le FRANÇAIS, jamais un vide ni une clé', () => {
  const inconnu = 'Ce texte n’est dans aucun dictionnaire';
  for (const langue of LANGUES) {
    assert.equal(traduire(TRADUCTIONS, langue.id, inconnu), inconnu);
  }
});

test('les trous se remplissent, et un trou sans valeur donnée reste visible', () => {
  assert.deepEqual(trousDuTexte('{n} agents sur {total}'), ['n', 'total']);
  assert.equal(remplirLesTrous('{n} agents', { n: 3 }), '3 agents');
  /* Une valeur FOURNIE mais vide n'écrit rien — c'est ce que fait déjà une page
     avec `{projet?.nom}`. Un trou dont PERSONNE n'a donné la valeur reste tel
     quel : le défaut saute aux yeux au lieu de passer inaperçu. */
  assert.equal(remplirLesTrous('a{x}b', { x: null }), 'ab');
  assert.equal(remplirLesTrous('a{x}b', { x: undefined }), 'ab');
  assert.equal(remplirLesTrous('a{x}b', {}), 'a{x}b');
  assert.equal(remplirLesTrous('a{x}b'), 'a{x}b');
});

test('une phrase à trous les garde dans les quatre langues', () => {
  const phrase = 'il y a {n} min';
  for (const langue of LANGUES) {
    const rendu = traduire(TRADUCTIONS, langue.id, phrase, { n: 7 });
    assert.ok(rendu.includes('7'), `« ${rendu} » a perdu son compte en ${langue.id}`);
  }
});

test('les colonnes du tableau sont traduites dans les quatre langues', () => {
  /* Elles viennent d'un catalogue PARTAGÉ et non d'un `t('…')` littéral : rien
     ne les rattraperait si on les oubliait. On exige une ENTRÉE au dictionnaire,
     pas un texte DIFFÉRENT : « Notes » s'écrit « Notes » en anglais, et une
     traduction identique au français n'est pas une traduction oubliée. */
  for (const libelle of Object.values(COLUMN_LABELS)) {
    for (const langue of LANGUES) {
      if (langue.id === LANGUE_DORIGINE) continue;
      assert.ok(
        TRADUCTIONS[langue.id][libelle],
        `la colonne « ${libelle} » n'a pas d'entrée au dictionnaire ${langue.id}`,
      );
    }
  }
});

test('aucune langue ne perd un trou, et aucune ne laisse un texte sans traduction', () => {
  for (const langue of LANGUES) {
    if (langue.id === LANGUE_DORIGINE) continue;
    const manque = manquesDeLaLangue(TEXTES_TRADUITS, langue.id, TRADUCTIONS[langue.id]);
    assert.deepEqual(manque.absents, [], `${langue.libelle} : textes sans traduction`);
    assert.deepEqual(manque.trousPerdus, [], `${langue.libelle} : trous perdus en route`);
  }
});

test('le contrôle des manques VOIT un dictionnaire troué', () => {
  /* Un contrôle qui ne sait pas échouer ne prouve rien. */
  const manque = manquesDeLaLangue(['Réglages', '{n} agents'], 'en', { '{n} agents': 'agents' });
  assert.deepEqual(manque.absents, ['Réglages']);
  assert.deepEqual(manque.trousPerdus, ['{n} agents']);
});
