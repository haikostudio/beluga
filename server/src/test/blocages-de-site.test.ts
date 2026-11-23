import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ESSAIS_PAR_BLOCAGE,
  blocageDeLaPage,
  carnetDeDepart,
  champDeNomDefinitif,
  gesteLourd,
  ligneDuBlocage,
  phraseDuGesteLourd,
  sujetDuCarnet,
} from '@beluga/shared';

test('les vraies pages de blocage de X et TikTok sont nommées', () => {
  assert.equal(blocageDeLaPage({ url: 'https://www.tiktok.com/login/download-app', titre: 'TikTok' })?.genre, 'appli-exigee');
  assert.equal(blocageDeLaPage({ url: 'https://www.tiktok.com/signup', texte: 'Maximum number of attempts reached. Try again later.' })?.genre, 'trop-d-essais');
  assert.equal(blocageDeLaPage({ url: 'https://x.com/home', texte: 'Something went wrong. Try reloading.' })?.genre, 'trop-d-essais');
  assert.equal(blocageDeLaPage({ url: 'https://x.com/account/access', texte: 'Your account is suspended' })?.genre, 'compte-suspendu');
  assert.equal(blocageDeLaPage({ url: 'https://x.com/i/flow/login', texte: 'Verify you are human — Arkose' })?.genre, 'image-a-dechiffrer');
  assert.equal(blocageDeLaPage({ url: 'https://www.facebook.com/', texte: 'Nous vous avons envoyé un code de confirmation par e-mail' })?.genre, 'code-par-mail');
});

test('une page saine ne bloque pas, et un mot cité loin dans un article non plus', () => {
  assert.equal(blocageDeLaPage({ url: 'https://example.com', titre: 'Accueil', texte: 'Bienvenue sur notre site.' }), null);
  assert.equal(blocageDeLaPage({ url: 'https://example.com/blog', texte: 'x'.repeat(3000) + ' captcha' }), null);
  // « Something went wrong » hors de X n'est pas un freinage
  assert.equal(blocageDeLaPage({ url: 'https://example.com', texte: 'Something went wrong. Try reloading.' }), null);
});

test('au second blocage du même genre, plus aucun essai', () => {
  const blocage = blocageDeLaPage({ url: 'https://x.com', texte: 'rate limit exceeded' })!;
  assert.match(ligneDuBlocage(blocage, 1), /conduite/);
  assert.match(ligneDuBlocage(blocage, ESSAIS_PAR_BLOCAGE), /PLUS AUCUN ESSAI/);
});

test('le carnet de départ et son sujet', () => {
  assert.ok(carnetDeDepart('www.tiktok.com').length > 0);
  assert.ok(carnetDeDepart('twitter.com').length > 0);
  assert.equal(carnetDeDepart('example.com').length, 0);
  assert.equal(sujetDuCarnet('www.X.com'), 'site:x.com');
});

test('un nom peut-être définitif : reconnu au champ, confirmé seulement s’il est déclaré', () => {
  assert.equal(champDeNomDefinitif('Nom d’utilisateur'), true);
  assert.equal(champDeNomDefinitif('Username'), true);
  assert.equal(champDeNomDefinitif('Nom de la Page'), true);
  assert.equal(champDeNomDefinitif('Message'), false);
  assert.equal(gesteLourd({ intention: 'nom-definitif' }), 'nom-definitif');
  // jamais sur le seul libellé : un nom dicté ne se redemande pas
  assert.equal(gesteLourd({ libelle: 'Créer la Page' }), null);
  assert.match(phraseDuGesteLourd('nom-definitif', 'facebook.com', 'Créer').description, /modifier ensuite/);
});
