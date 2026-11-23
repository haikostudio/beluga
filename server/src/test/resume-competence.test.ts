import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CORPS_LU_POUR_LE_RESUME_MAX,
  SYMPTOMES_RESUME_MAX,
  ficheAResumer,
  messagesDuResume,
  quandSenServir,
  validerLeResume,
} from '@beluga/shared';

/**
 * LE RÉSUMÉ EN FRANÇAIS DES FICHES DE BIBLIOTHÈQUE (carte dd481232) : quelles
 * fiches l'attendent, ce que le petit modèle lit, et la sortie qu'on accepte.
 */

test('seules les fiches de bibliothèque en service, sans résumé, lisibles ici et hors pstack attendent leur résumé', () => {
  const base = { etat: 'active' as const, bibliotheque: 'marketingskills' };
  assert.equal(ficheAResumer(base), true);
  assert.equal(ficheAResumer({ ...base, bibliotheque: undefined }), false, 'une fiche maison est déjà écrite en français');
  assert.equal(ficheAResumer({ ...base, resumeFr: 'À utiliser quand…' }), false, 'reprise idempotente');
  assert.equal(ficheAResumer({ ...base, etat: 'archivee' }), false);
  assert.equal(ficheAResumer({ ...base, etat: 'depreciee' }), true);
  assert.equal(ficheAResumer({ ...base, bibliotheque: 'pstack' }), false, 'pstack : au jugement de l’agent, cherché en mots anglais');
  assert.equal(ficheAResumer({ ...base, fournie: true }), false, 'lot fourni : lecture seule');
  assert.equal(ficheAResumer({ ...base, protegee: true }), false);
});

test('le modèle lit le nom, la description d’origine, les thèmes et le DÉBUT du mode d’emploi seulement', () => {
  const [systeme, demande] = messagesDuResume(
    { nom: 'seo-audit', description: 'When the user wants to audit SEO.', themes: ['seo'] },
    'x'.repeat(CORPS_LU_POUR_LE_RESUME_MAX + 500),
  );
  assert.match(systeme.content, /À utiliser quand/);
  assert.match(demande.content, /Nom : seo-audit/);
  assert.match(demande.content, /Description d’origine : When the user wants to audit SEO\./);
  assert.match(demande.content, /Thèmes : seo/);
  assert.ok(demande.content.length < CORPS_LU_POUR_LE_RESUME_MAX + 300);
});

test('une sortie conforme est acceptée et nettoyée ; le reste est refusé avec sa raison', () => {
  const ok = validerLeResume(
    JSON.stringify({
      resume: 'À utiliser quand le site ne remonte pas sur Google : la compétence audite le référencement et propose des corrections.',
      symptomes: ['Mon site ne remonte pas sur Google', 'audit SEO, technique', 'audit seo, technique', 'mots-clés.', 'ok', 'trafic en baisse', 'pages non indexées', 'balises title', 'temps de chargement', 'liens cassés'],
    }),
  );
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.symptomes[0], 'mon site ne remonte pas sur Google');
    assert.ok(ok.symptomes.every((s) => !/[,;]/.test(s)), 'une ligne d’en-tête se coupe aux virgules');
    assert.equal(ok.symptomes.filter((s) => s === 'audit SEO  technique' || s === 'audit SEO technique').length, 1, 'dédoublonnés');
    assert.ok(!ok.symptomes.includes('ok'), 'trop court');
    assert.ok(ok.symptomes.length <= SYMPTOMES_RESUME_MAX);
  }
  assert.equal(validerLeResume('pas du json').ok, false);
  assert.deepEqual(validerLeResume({ resume: 'Use when the user wants SEO help on their website pages.', symptomes: ['a b c', 'd e f', 'g h i'] }), {
    ok: false,
    raison: 'résumé qui ne commence pas par « À utiliser »',
  });
  assert.equal(validerLeResume({ resume: 'À utiliser quand il faut un devis pour un site vitrine.', symptomes: ['faire un devis'] }).ok, false);
  assert.equal(validerLeResume({ resume: `À utiliser quand ${'x'.repeat(500)}`, symptomes: ['a b c', 'd e f', 'g h i'] }).ok, false);
});

test('ce qui dit QUAND s’en servir : le résumé en français s’il existe, sinon la description', () => {
  assert.equal(quandSenServir({ description: 'Use for SEO.', resumeFr: 'À utiliser quand le site ne remonte pas.' }), 'À utiliser quand le site ne remonte pas.');
  assert.equal(quandSenServir({ description: 'Use for SEO.' }), 'Use for SEO.');
  assert.equal(quandSenServir({ description: 'Use for SEO.', resumeFr: '  ' }), 'Use for SEO.');
});
