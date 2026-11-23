import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ERREUR_LIMITES,
  appareilEnClair,
  empreinteErreur,
  jugerRapportErreur,
  ligneDeJournal,
  lireLigneDeJournal,
  origineEnClair,
  rapportDuGesteNonParti,
} from '@beluga/shared';

const MAINTENANT = 1_770_000_000_000;

test("un rapport complet est accepté et daté par le serveur", () => {
  const juge = jugerRapportErreur(
    {
      source: 'fenetre',
      message: "x is not a function",
      pile: 'TypeError: x is not a function\n  at app.js:12',
      url: 'https://beluga.example/#projet/abc',
      appareil: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/605.1',
      // La date envoyée par la page est IGNORÉE : c'est le serveur qui date.
      at: 1,
    },
    MAINTENANT,
  );
  assert.equal(juge.ok, true);
  if (!juge.ok) return;
  assert.equal(juge.erreur.at, MAINTENANT);
  assert.equal(juge.erreur.source, 'fenetre');
  assert.match(juge.erreur.pile ?? '', /app\.js:12/);
});

test('un envoi mal formé est refusé, et le refus dit pourquoi', () => {
  for (const brut of [null, 'coucou', 42, [], { source: 'fenetre' }, { source: 'fenetre', message: '   ' }]) {
    const juge = jugerRapportErreur(brut, MAINTENANT);
    assert.equal(juge.ok, false, `accepté à tort : ${JSON.stringify(brut)}`);
    if (!juge.ok) assert.ok(juge.raison.length > 5);
  }
});

test('une origine inconnue est refusée', () => {
  const juge = jugerRapportErreur({ source: 'ailleurs', message: 'boum' }, MAINTENANT);
  assert.equal(juge.ok, false);
  if (!juge.ok) assert.match(juge.raison, /inconnue/i);
});

test('ce qui dépasse est coupé, pas rejeté', () => {
  const juge = jugerRapportErreur(
    { source: 'promesse', message: 'a'.repeat(2000), pile: 'b'.repeat(9000) },
    MAINTENANT,
  );
  assert.equal(juge.ok, true);
  if (!juge.ok) return;
  assert.equal(juge.erreur.message.length, ERREUR_LIMITES.message + 1); // le « … » de fin
  assert.equal(juge.erreur.pile?.length, ERREUR_LIMITES.pile + 1);
});

test('les champs vides ne sont pas rangés comme des chaînes vides', () => {
  const juge = jugerRapportErreur({ source: 'affichage', message: 'boum', zone: '  ' }, MAINTENANT);
  assert.equal(juge.ok, true);
  if (!juge.ok) return;
  assert.equal(juge.erreur.zone, undefined);
  assert.equal(juge.erreur.url, undefined);
});

test("la même erreur porte la même empreinte, une autre non", () => {
  const a = { source: 'fenetre' as const, message: 'boum', pile: 'at app.js:1\nat main.js:9' };
  const b = { source: 'fenetre' as const, message: 'boum', pile: 'at app.js:1\nat autre.js:4' };
  const c = { source: 'promesse' as const, message: 'boum', pile: 'at app.js:1' };
  assert.equal(empreinteErreur(a), empreinteErreur(b));
  assert.notEqual(empreinteErreur(a), empreinteErreur(c));
});

test('une ligne de journal se relit telle quelle, une ligne abîmée est ignorée', () => {
  const juge = jugerRapportErreur({ source: 'affichage', message: 'panneau cassé', zone: 'Tableau' }, MAINTENANT);
  assert.equal(juge.ok, true);
  if (!juge.ok) return;
  const relue = lireLigneDeJournal(ligneDeJournal(juge.erreur));
  assert.deepEqual(relue, juge.erreur);

  assert.equal(lireLigneDeJournal(''), null);
  assert.equal(lireLigneDeJournal('{ pas du json'), null);
  assert.equal(lireLigneDeJournal('{"source":"ailleurs","message":"x"}'), null);
});

test("l'appareil se dit en français", () => {
  assert.equal(
    appareilEnClair('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Version/17.0 Safari/605.1'),
    'iPhone · Safari',
  );
  assert.equal(
    appareilEnClair('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537 Chrome/120.0 Mobile Safari/537'),
    'Android · Chrome',
  );
  // Edge se déclare aussi « Chrome » et « Safari » : le plus précis gagne.
  assert.equal(
    appareilEnClair('Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537 Edg/120'),
    'Windows · Edge',
  );
  assert.equal(appareilEnClair(''), 'appareil inconnu');
  assert.equal(appareilEnClair(undefined), 'appareil inconnu');
});

test("chaque origine a une phrase, et elles sont distinctes", () => {
  const dites = ['affichage', 'fenetre', 'promesse', 'canal', 'voix'].map((s) => origineEnClair(s as never));
  assert.equal(new Set(dites).size, 5);
  for (const phrase of dites) assert.ok(phrase.length > 5);
});

test("un geste non parti dit l'état du lien, sans rien du projet, et passe le portier", () => {
  const maintenant = 1_000_000;
  const rapport = rapportDuGesteNonParti(
    {
      commande: 'coffre.lister',
      etatDuSocket: 0,
      coupeDepuis: maintenant - 4200,
      derniereFermeture: { motif: 'fermé par le serveur', code: 1006, a: maintenant - 4200 },
      derniereCommande: { type: 'ping', a: maintenant - 25_000 },
      dernierEvenementA: maintenant - 30_000,
      enVeille: false,
      pageCachee: false,
      enLigne: true,
    },
    maintenant,
  );
  assert.equal(rapport.source, 'canal');
  assert.equal(rapport.message, 'geste non parti : coffre.lister');
  assert.match(rapport.pile ?? '', /canal : en ouverture/);
  assert.match(rapport.pile ?? '', /code 1006/);
  assert.match(rapport.pile ?? '', /coupé depuis : il y a 4.2 s/);
  assert.match(rapport.pile ?? '', /ping il y a 25 s/);
  const juge = jugerRapportErreur(rapport, maintenant);
  assert.ok(juge.ok);
  const vide = rapportDuGesteNonParti({ commande: 'x', etatDuSocket: null, enVeille: true, pageCachee: true }, maintenant);
  assert.match(vide.pile ?? '', /canal : aucun/);
  assert.match(vide.pile ?? '', /dernière fermeture : aucune/);
  assert.doesNotMatch(vide.pile ?? '', /attente de l.ouverture/);
  // Un geste qui a attendu l'ouverture du canal le dit : c'est ce qui le fait compter.
  const attendu = rapportDuGesteNonParti({ commande: 'x', etatDuSocket: 0, enVeille: false, pageCachee: false, attenteMs: 10_012 }, maintenant);
  assert.match(attendu.pile ?? '', /attente de l’ouverture : 10 s$/);
});
