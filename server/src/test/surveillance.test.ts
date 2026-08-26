import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APAISEMENT_MS,
  LIBELLE_RAISON,
  PERIODE_SURVEILLANCE_MS,
  type SiteSurveille,
  apaisement,
  bascule,
  compterEnPanne,
  dejaSurveille,
  doitVerifier,
  interrompt,
  jugerAdresse,
  jugerReponse,
  texteAlerte,
} from '@haikodev/shared';

/**
 * LA SURVEILLANCE DES SITES — les règles qui se jugent sans réseau ni base.
 *
 * Ce que ces tests verrouillent : ce qui compte comme une PANNE (et dans quel
 * ordre), l'adresse rattrapée plutôt que refusée, l'alerte qui ne part qu'à la
 * BASCULE — jamais à chaque tournée —, et le bandeau d'apaisement qui ne
 * s'affiche qu'après une vraie panne.
 */

function site(partiel: Partial<SiteSurveille> = {}): SiteSurveille {
  return {
    id: 's1',
    url: 'https://exemple.ch/',
    nom: 'exemple.ch',
    etat: 'ok',
    verifieLe: 1_000_000,
    depuis: 1_000_000,
    dernierePanne: 0,
    creeLe: 0,
    ...partiel,
  };
}

test('trois choses font une panne, et le contenu se juge en dernier', () => {
  assert.equal(jugerReponse({ statut: 200, taille: 4200 }).etat, 'ok');
  assert.equal(jugerReponse({ statut: 301, taille: 10 }).etat, 'ok');

  assert.deepEqual(jugerReponse({ statut: 404, taille: 900 }), {
    etat: 'panne',
    raison: 'client',
    code: 404,
  });
  assert.deepEqual(jugerReponse({ statut: 503, taille: 900 }), {
    etat: 'panne',
    raison: 'serveur',
    code: 503,
  });
  // Une page servie mais VIDE : le serveur répond, le site non.
  assert.deepEqual(jugerReponse({ statut: 200, taille: 0 }), { etat: 'panne', raison: 'vide', code: 200 });

  // L'ordre compte : un 500 bien rempli reste un 500, et une absence de réponse
  // se juge avant tout code.
  assert.equal(jugerReponse({ statut: 500, taille: 0 }).raison, 'serveur');
  assert.equal(jugerReponse({ delaiDepasse: true, statut: 200 }).raison, 'delai');
  assert.equal(jugerReponse({ erreur: 'getaddrinfo ENOTFOUND' }).raison, 'injoignable');
  // Rien du tout, pas même un code : injoignable, jamais « en ligne ».
  assert.equal(jugerReponse({}).etat, 'panne');
});

test('chaque raison de panne a son libellé, prêt à traduire', () => {
  for (const raison of ['client', 'serveur', 'delai', 'injoignable', 'vide'] as const) {
    assert.equal(typeof LIBELLE_RAISON[raison], 'string');
    assert.ok(LIBELLE_RAISON[raison].length > 3, `libellé trop court pour ${raison}`);
  }
});

test('l’adresse se rattrape, et ce qu’on ne sait pas appeler se refuse', () => {
  const simple = jugerAdresse('exemple.ch');
  assert.equal(simple.ok && simple.url, 'https://exemple.ch/');
  // Le nom se devine du domaine quand on n'en donne pas.
  assert.equal(simple.ok && simple.nom, 'exemple.ch');

  const nomme = jugerAdresse('http://boutique.exemple.ch/etat', '  Boutique  ');
  assert.equal(nomme.ok && nomme.url, 'http://boutique.exemple.ch/etat');
  assert.equal(nomme.ok && nomme.nom, 'Boutique');

  assert.equal(jugerAdresse('').ok, false);
  assert.equal(jugerAdresse('   ').ok, false);
  // Sans nom de domaine, l'appel ne partirait jamais : autant le dire tout de suite.
  assert.equal(jugerAdresse('machin').ok, false);
  assert.equal(jugerAdresse('ftp://exemple.ch').ok, false);
  assert.equal(jugerAdresse(`https://exemple.ch/${'a'.repeat(400)}`).ok, false);
  // « localhost » reste acceptable : c'est ce que visent les essais.
  assert.equal(jugerAdresse('http://localhost:7099').ok, true);
});

test('deux fois la même adresse ne se garde pas, quelle que soit la casse', () => {
  const liste = [site({ url: 'https://Exemple.ch/' })];
  assert.equal(dejaSurveille(liste, 'https://exemple.ch/'), true);
  assert.equal(dejaSurveille(liste, 'https://autre.ch/'), false);
  // La fiche ne se dédouble pas contre elle-même quand on la réécrit.
  assert.equal(dejaSurveille(liste, 'https://exemple.ch/', 's1'), false);
});

test('l’alerte ne part qu’à la bascule, jamais à chaque tournée', () => {
  assert.equal(bascule('ok', 'panne'), 'tombe');
  assert.equal(bascule('panne', 'ok'), 'retabli');
  // Un premier appel qui trouve le site déjà à terre est bien une nouvelle.
  assert.equal(bascule('inconnu', 'panne'), 'tombe');
  // Un site debout qu'on vient de découvrir n'annonce rien.
  assert.equal(bascule('inconnu', 'ok'), null);
  // Et surtout : tombé qui reste tombé ne réveille personne.
  assert.equal(bascule('panne', 'panne'), null);
  assert.equal(bascule('ok', 'ok'), null);
});

test('une panne de site alerte vraiment, sur les deux canaux', () => {
  // Le motif doit sortir de l'application : sans cela, la notification poussée
  // ne partirait jamais (`shared/src/notification-tri.ts`).
  assert.equal(interrompt('site-indisponible'), true);
});

test('l’alerte nomme le site ET ce qui cloche', () => {
  const texte = texteAlerte(site({ nom: 'Boutique', etat: 'panne', raison: 'serveur', code: 502 }));
  assert.match(texte.titre, /Boutique/);
  assert.match(texte.corps, /502/);
  assert.match(texte.corps, /exemple\.ch/);
});

test('la pastille compte ce qui est tombé, et rien d’autre', () => {
  const liste = [
    site({ id: 'a', etat: 'panne' }),
    site({ id: 'b', etat: 'ok' }),
    site({ id: 'c', etat: 'inconnu' }),
    site({ id: 'd', etat: 'panne' }),
  ];
  assert.equal(compterEnPanne(liste), 2);
  assert.equal(compterEnPanne([]), 0);
  assert.equal(compterEnPanne([site()]), 0);
});

test('le bandeau d’apaisement suit une vraie panne, et s’efface avec le temps', () => {
  const maintenant = 10_000_000;
  const remis = site({ etat: 'ok', dernierePanne: maintenant - 60_000 });
  assert.equal(apaisement([remis], maintenant), true);
  // Une liste qui n'a jamais connu de panne n'affiche pas un « tout va bien »
  // permanent : on cesserait de le voir.
  assert.equal(apaisement([site()], maintenant), false);
  // Tant qu'un site est à terre, c'est l'autre bandeau qui parle.
  assert.equal(apaisement([remis, site({ id: 'x', etat: 'panne' })], maintenant), false);
  // Passé le délai, le rétablissement n'apprend plus rien.
  assert.equal(apaisement([site({ etat: 'ok', dernierePanne: maintenant - APAISEMENT_MS - 1 })], maintenant), false);
  assert.equal(apaisement([], maintenant), false);
});

test('un site n’est rappelé qu’à l’heure suivante', () => {
  const maintenant = 10_000_000;
  assert.equal(doitVerifier(site({ verifieLe: maintenant - 60_000 }), maintenant), false);
  assert.equal(doitVerifier(site({ verifieLe: maintenant - PERIODE_SURVEILLANCE_MS }), maintenant), true);
  // Jamais appelé : il l'est tout de suite.
  assert.equal(doitVerifier(site({ verifieLe: 0 }), maintenant), true);
});
