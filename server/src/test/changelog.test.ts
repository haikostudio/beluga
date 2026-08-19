import test from 'node:test';
import assert from 'node:assert/strict';
import { ROUTE_CHANGELOG, pageChangelog, parserChangelog } from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* LE JOURNAL DES LIVRAISONS, PUBLIC                                    */
/*                                                                      */
/* Ce qui compte : l'adresse est bien `/changelog`, les lignes réelles  */
/* de HISTORIQUE.md (« - JJ.MM.AAAA : texte ») sont reconnues et une    */
/* ligne qui ne suit pas ce gabarit (titre, note de tête, ligne vide)   */
/* est ignorée sans faire planter la page. La page ne doit jamais       */
/* ouvrir de balise sur un texte qui contiendrait des chevrons.         */
/* ------------------------------------------------------------------ */

test('l’adresse publique est /changelog', () => {
  assert.equal(ROUTE_CHANGELOG, '/changelog');
});

test('reconnaît les lignes datées et ignore le reste', () => {
  const contenu = [
    '# Historique des livraisons',
    '',
    "_Tenu automatiquement. Jamais envoyé au moteur._",
    '',
    '- 03.08.2026 : « Première livraison » livrée et publiée.',
    '',
    '- 04.08.2026 : « Seconde livraison » livrée et publiée.',
  ].join('\n');

  const entrees = parserChangelog(contenu);
  assert.equal(entrees.length, 2);
  assert.deepEqual(entrees[0], { date: '03.08.2026', texte: '« Première livraison » livrée et publiée.' });
  assert.deepEqual(entrees[1], { date: '04.08.2026', texte: '« Seconde livraison » livrée et publiée.' });
});

test('un fichier vide rend une page sans planter, avec un message clair', () => {
  const html = pageChangelog('');
  assert.match(html, /Aucune livraison enregistrée/);
});

test('un texte avec des chevrons ne casse pas la page', () => {
  const html = pageChangelog('- 03.08.2026 : « Comparaison a < b et a > b » livrée.');
  assert.doesNotMatch(html, /a < b/);
  assert.match(html, /a &lt; b/);
});
