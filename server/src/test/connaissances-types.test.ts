import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFINITION_TYPE,
  LIBELLE_TYPE,
  NON_RENSEIGNE,
  TYPES_UNITE,
  consigneDeGeneration,
  consigneDeReclassement,
  detailAuGabarit,
  detailSansResumeRepete,
  resumeRedisParLeDetail,
  premierePhraseDuDetail,
  detailSansSectionsVides,
  rendreUnite,
  jugerProposition,
  lireReclassementsDuModele,
  MOTIF_MARKDOWN_EN_LIGNE,
  texteSansPrefixeDeCommit,
} from '@beluga/shared';
import { TEXTES_TRADUITS } from '@beluga/shared/traductions';

const TRADUITS = new Set(TEXTES_TRADUITS);

/*
 * LES TYPES DE LA BASE DE CONNAISSANCES SE LISENT, ET LE DÉTAIL NE S'ENCOMBRE
 * PLUS : une définition par type (servie au modèle et à l'écran, dans les cinq
 * langues), le gabarit « domain » qui n'écrit que ses sections utiles, la
 * consigne de reclassement, le préfixe de commit retiré à l'affichage du
 * changelog, et l'italique qui ne s'ouvre plus au milieu d'un mot.
 */

test('chaque type a une définition qui dit ce qui entre et ce qui n’entre pas, traduite', () => {
  for (const type of TYPES_UNITE) {
    const d = DEFINITION_TYPE[type];
    assert.ok(d.length > 40, type);
    assert.match(d, /; pas /, `${type} : la définition dit aussi ce qui n’y entre pas`);
    assert.ok(TRADUITS.has(d), `${type} : définition absente du dictionnaire`);
    assert.ok(TRADUITS.has(LIBELLE_TYPE[type]), `${type} : libellé absent du dictionnaire`);
  }
});

test('la consigne de génération reprend les définitions', () => {
  const c = consigneDeGeneration({ nomDeLaPortee: 'Essai', global: false, matiere: 'x', dejaConnus: [] });
  for (const type of TYPES_UNITE) assert.ok(c.includes(DEFINITION_TYPE[type]), type);
});

test('le gabarit domain n’écrit plus de sections vides ni redondantes', () => {
  const resume = 'La langue préférée d’un utilisateur est stockée chiffrée en base.';
  assert.equal(detailAuGabarit('domain', '', resume), '');
  assert.equal(detailAuGabarit('domain', 'La colonne vaut NULL tant que rien n’est choisi.', resume), 'La colonne vaut NULL tant que rien n’est choisi.');
  const d = detailAuGabarit('domain', `### Glossaire\n\nLangue : code ISO.\n\n### Entités\n\n${NON_RENSEIGNE}\n\n### États\n\n${resume}`, resume);
  assert.equal(d, '### Glossaire\n\nLangue : code ISO.');
  const j = jugerProposition({ type: 'domain', importance: 'P2', titre: 'Langue chiffrée en base', resume, detail: '' });
  assert.equal(j.ok && j.propre.detail, '');
});

test('les gabarits decision et component restent complets', () => {
  assert.match(detailAuGabarit('component', 'Un écran.'), /^### Rôle\n\nUn écran\.\n\n### Comportement\n\n_Non renseigné\._/);
});

test('un détail qui change de type perd ses sections restées vides', () => {
  assert.equal(detailSansSectionsVides(`### Entités\n\n${NON_RENSEIGNE}\n\n### États\n\nEn clair, puis chiffré.`), '### États\n\nEn clair, puis chiffré.');
});

const RESUME = 'Le résumé de la fiche tient en une phrase.';
const UNITE = {
  id: 'MEM-0001', type: 'convention', importance: 'P2', statut: 'active', confiance: 0.7, source: { genre: 'agent', ref: '' },
  sujets: [], version: 1, modifieLe: Date.UTC(2026, 9, 27), supersedes: null, supersededBy: null, liens: [], raisonnement: '',
  titre: 'T', resume: RESUME, detail: '',
} as unknown as Parameters<typeof rendreUnite>[0];
const occurrences = (t: string) => t.split(RESUME).length - 1;

test('le résumé recopié dans le détail n’est rendu qu’une fois', () => {
  const detail = `### Quand s'en servir\n\n${RESUME}\n\n### Suite\n\nAutre chose.`;
  const rendu = rendreUnite({ ...UNITE, detail });
  assert.equal(occurrences(rendu), 1);
  assert.ok(!rendu.includes("Quand s'en servir"), 'la section vidée disparaît avec son titre');
  assert.ok(rendu.includes('### Suite') && !rendu.includes('\n\n\n'));
  assert.equal(occurrences(rendreUnite({ ...UNITE, detail: RESUME.replace('résumé de', 'résumé\nde') })), 1, 'retours à la ligne différents');
  assert.equal(occurrences(rendreUnite({ ...UNITE, detail: ` ${RESUME.replace(/ /g, '  ')} ` })), 1);
});

test('une section qui garde d’autres paragraphes reste, un détail sans doublon est inchangé', () => {
  const garde = `### A\n\n${RESUME}\n\nUn autre paragraphe.`;
  assert.equal(detailSansResumeRepete(garde, RESUME), '### A\n\nUn autre paragraphe.');
  const sans = `### A\n\nTexte un.\n\n### B\n\nTexte deux, qui cite : ${RESUME}`;
  assert.equal(detailSansResumeRepete(sans, RESUME), sans, 'une simple inclusion n’est jamais retirée');
  assert.equal(rendreUnite({ ...UNITE, detail: sans }).includes('Texte un.'), true);
  assert.equal(detailSansResumeRepete(RESUME, RESUME), '');
});

test('un résumé tronqué par « … » ou égal au détail aplati ne double plus le détail', () => {
  const corps = 'Première phrase de la règle, assez longue pour compter. Deuxième phrase qui suit.\n\nSecond paragraphe avec d’autres faits.';
  const aplati = corps.replace(/\s+/g, ' ');
  const tronque = `${aplati.slice(0, 60).trim()}…`;
  const a = rendreUnite({ ...UNITE, resume: tronque, detail: corps });
  assert.equal(a.includes(tronque), false, 'le résumé tronqué n’est pas posé');
  assert.ok(a.includes('Second paragraphe avec d’autres faits.'));
  assert.equal(a.split('Première phrase de la règle').length - 1, 1);
  const b = rendreUnite({ ...UNITE, resume: aplati, detail: corps });
  assert.equal(b.split('Première phrase de la règle').length - 1, 1, 'détail entier aplati : un seul texte');
  assert.ok(b.includes('Second paragraphe'));
  assert.equal(resumeRedisParLeDetail(corps, 'Une autre phrase, distincte du détail entier.'), false);
  assert.equal(resumeRedisParLeDetail(corps, 'Deuxième phrase qui suit.'), false, 'une simple inclusion reste affichée');
  assert.equal(resumeRedisParLeDetail(corps, 'court…'), false, 'préfixe trop court');
});

test('un résumé qui est la première phrase du détail ne le double plus ; la première phrase ignore « 1. »', () => {
  const corps = 'Première phrase de la règle, assez longue pour compter. Deuxième phrase qui suit.\n\nSecond paragraphe.';
  const phrase = 'Première phrase de la règle, assez longue pour compter.';
  assert.equal(resumeRedisParLeDetail(corps, phrase), true, 'préfixe sur fin de phrase');
  const r = rendreUnite({ ...UNITE, resume: phrase, detail: corps });
  assert.equal(r.split('Première phrase de la règle').length - 1, 1);
  assert.equal(resumeRedisParLeDetail(corps, 'Première phrase de la règle, assez longue'), false, 'préfixe sans fin de phrase');
  assert.equal(resumeRedisParLeDetail(corps, 'Deuxième phrase qui suit.'), false, 'inclusion non préfixe');
  const enum_ = 'La fiche couvre cinq onglets Bilan, 1. suite du texte. Et après.';
  assert.equal(premierePhraseDuDetail(enum_), 'La fiche couvre cinq onglets Bilan, 1. suite du texte.');
  assert.equal(premierePhraseDuDetail('Fait en 2026. Puis autre chose.'), 'Fait en 2026.', 'deux vraies phrases restent coupées');
  assert.equal(premierePhraseDuDetail('Sans fin de phrase'), 'Sans fin de phrase');
});

test('la consigne de reclassement porte les définitions, et la réponse du modèle est filtrée', () => {
  const unites = [
    { id: 'MEM-0217', type: 'domain' as const, titre: 'Langue chiffrée en base', resume: 'La langue est stockée chiffrée.' },
    { id: 'DEC-004', type: 'decision' as const, titre: 'SQLite plutôt que Postgres', resume: 'On a choisi SQLite.' },
  ];
  const c = consigneDeReclassement({ nomDeLaPortee: 'ETSigna', unites });
  assert.ok(c.includes('MEM-0217') && c.includes(DEFINITION_TYPE.security));
  const lus = lireReclassementsDuModele(
    'Voici : [{"id":"MEM-0217","type":"security","raison":"stockage chiffré"},{"id":"DEC-004","type":"decision"},{"id":"MEM-9999","type":"lesson"},{"id":"DEC-004","type":"opinion"}]',
    unites,
  );
  assert.deepEqual(lus, [{ id: 'MEM-0217', avant: 'domain', apres: 'security', raison: 'stockage chiffré' }]);
  assert.deepEqual(lireReclassementsDuModele('pas de JSON', unites), []);
});

test('le changelog s’affiche sans préfixe de commit', () => {
  assert.equal(texteSansPrefixeDeCommit('feat(memoire): changelog lisible'), 'Changelog lisible');
  assert.equal(texteSansPrefixeDeCommit('fix: italique parasite'), 'Italique parasite');
  assert.equal(texteSansPrefixeDeCommit('docs(regles)!: nouvelle règle'), 'Nouvelle règle');
  assert.equal(texteSansPrefixeDeCommit('Mémoire : écran vérifié'), 'Mémoire : écran vérifié');
  assert.equal(texteSansPrefixeDeCommit('Note: garder le texte'), 'Note: garder le texte');
});

test('l’italique par soulignés ne s’ouvre qu’en bordure de mot', () => {
  /* Ce que le rendu des bulles (`web/src/lib/markdown.tsx`) reconnaît avec ce motif. */
  const jetons = (texte: string) =>
    [...texte.matchAll(new RegExp(MOTIF_MARKDOWN_EN_LIGNE.source, MOTIF_MARKDOWN_EN_LIGNE.flags))].map((m) => m[0]);
  assert.deepEqual(jetons('la colonne userspsy_language_tmp reste'), []);
  assert.deepEqual(jetons('un _vrai_ italique et __init__.py'), ['_vrai_']);
  assert.deepEqual(jetons('**gras** et `code_a_b`'), ['**gras**', '`code_a_b`']);
  assert.deepEqual(jetons('un *vrai* italique, **gras** et *encore un*'), ['*vrai*', '**gras**', '*encore un*']);
  assert.deepEqual(jetons('3 * 4 * 5, la fonction f(*args) et 2*x*y'), []);
});
