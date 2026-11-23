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
  HISTORIQUE_MS,
  PERIODE_MIN_MS,
  RECETTE_APPEL,
  bornerPeriode,
  controlesRecents,
  disponibilite24h,
  frise24h,
  interrompt,
  jugerAdresse,
  jugerRecetteSurveillance,
  jugerReponse,
  recetteDeLigne,
  texteAlerte,
} from '@beluga/shared';

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
  for (const raison of ['client', 'serveur', 'delai', 'injoignable', 'vide', 'contenu', 'parcours'] as const) {
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

test('un site est rappelé à SON rythme, cinq minutes par défaut', () => {
  const maintenant = 100_000_000;
  assert.equal(PERIODE_SURVEILLANCE_MS, 5 * 60_000);
  assert.equal(doitVerifier(site({ verifieLe: maintenant - 60_000 }), maintenant), false);
  assert.equal(doitVerifier(site({ verifieLe: maintenant - PERIODE_SURVEILLANCE_MS }), maintenant), true);
  // Jamais appelé : il l'est tout de suite.
  assert.equal(doitVerifier(site({ verifieLe: 0 }), maintenant), true);
  // Un rythme d'une heure attend son heure.
  assert.equal(doitVerifier(site({ verifieLe: maintenant - 10 * 60_000, periodeMs: 3_600_000 }), maintenant), false);
  assert.equal(doitVerifier(site({ verifieLe: maintenant - 3_600_000, periodeMs: 3_600_000 }), maintenant), true);
});

test('un rythme sous le plancher est ramené au plancher, un rythme illisible vaut cinq minutes', () => {
  assert.equal(bornerPeriode(1000), PERIODE_MIN_MS);
  assert.equal(bornerPeriode(0), PERIODE_SURVEILLANCE_MS);
  assert.equal(bornerPeriode('abc'), PERIODE_SURVEILLANCE_MS);
  assert.equal(bornerPeriode(10 * 60_000), 10 * 60_000);
  assert.equal(bornerPeriode(1e12), 24 * 3_600_000);
});

test('un mot attendu absent fait une panne « contenu », après le code et la page vide', () => {
  assert.deepEqual(jugerReponse({ statut: 200, taille: 50, motTrouve: false }), { etat: 'panne', raison: 'contenu', code: 200 });
  assert.equal(jugerReponse({ statut: 200, taille: 50, motTrouve: true }).etat, 'ok');
  assert.equal(jugerReponse({ statut: 500, taille: 50, motTrouve: false }).raison, 'serveur');
  assert.equal(jugerReponse({ statut: 200, taille: 0, motTrouve: false }).raison, 'vide');
});

test('une recette mal formée est refusée en toutes lettres', () => {
  assert.equal(jugerRecetteSurveillance({ type: 'appel', motAttendu: ' Bienvenue ' }).ok, true);
  assert.equal(jugerRecetteSurveillance({ type: 'autre' }).ok, false);
  assert.equal(jugerRecetteSurveillance(null).ok, false);
  assert.equal(jugerRecetteSurveillance({ type: 'parcours', etapes: [] }).ok, false);
  // Un parcours commence par ouvrir une page.
  const sansAller = jugerRecetteSurveillance({ type: 'parcours', etapes: [{ action: 'cliquer', selecteur: '#a' }] });
  assert.equal(sansAller.ok, false);
  const inconnue = jugerRecetteSurveillance({ type: 'parcours', etapes: [{ action: 'aller', url: 'exemple.ch' }, { action: 'danser' }] });
  assert.ok(!inconnue.ok && /étape 2/.test(inconnue.raison));
  const juste = jugerRecetteSurveillance({
    type: 'parcours',
    etapes: [
      { action: 'aller', url: 'exemple.ch/connexion' },
      { action: 'remplir', selecteur: '#identifiant', valeur: 'haiko' },
      { action: 'remplir', selecteur: '#password', acces: { id: 'fiche-1', champ: 'motDePasse' } },
      { action: 'cliquer', selecteur: 'button[type=submit]' },
      { action: 'verifierTexte', texte: 'Tableau de bord' },
    ],
  });
  assert.equal(juste.ok, true);
  assert.equal(juste.ok && juste.recette.type === 'parcours' && juste.recette.etapes[0].action === 'aller' && juste.recette.etapes[0].url, 'https://exemple.ch/connexion');
});

test('aucun mot de passe ne s’écrit en clair dans une recette', () => {
  const clair = jugerRecetteSurveillance({
    type: 'parcours',
    etapes: [
      { action: 'aller', url: 'exemple.ch' },
      { action: 'remplir', selecteur: 'input[type=password]', valeur: 'secret123' },
    ],
  });
  assert.ok(!clair.ok && /coffre-fort/.test(clair.raison));
  const reference = jugerRecetteSurveillance({
    type: 'parcours',
    etapes: [
      { action: 'aller', url: 'exemple.ch' },
      { action: 'remplir', selecteur: 'input[type=password]', acces: { id: 'x', champ: 'motDePasse' } },
    ],
  });
  assert.equal(reference.ok, true);
  assert.equal(JSON.stringify(reference).includes('secret'), false);
});

test('une ligne reprise d’avant les recettes redevient un simple appel, sans perdre son état', () => {
  assert.deepEqual(recetteDeLigne(null), RECETTE_APPEL);
  assert.deepEqual(recetteDeLigne('{abîmé'), RECETTE_APPEL);
  assert.deepEqual(recetteDeLigne(JSON.stringify({ type: 'appel', motAttendu: 'ok' })), { type: 'appel', motAttendu: 'ok' });
  // La reprise ne change pas l'état : sans bascule, aucune alerte ne repart.
  assert.equal(bascule('panne', 'panne'), null);
  assert.equal(bascule('ok', 'ok'), null);
});

test('l’historique ne garde que les dernières 24 heures', () => {
  const maintenant = 200_000_000;
  const controles = [
    { siteId: 's', instant: maintenant - HISTORIQUE_MS - 1, etat: 'panne' as const, dureeMs: 1 },
    { siteId: 's', instant: maintenant - 3_600_000, etat: 'ok' as const, dureeMs: 1 },
    { siteId: 's', instant: maintenant - 60_000, etat: 'panne' as const, raison: 'serveur' as const, dureeMs: 1 },
  ];
  const recents = controlesRecents(controles, maintenant);
  assert.equal(recents.length, 2);
  assert.ok(recents[0].instant < recents[1].instant);
  assert.equal(disponibilite24h(controles, maintenant), 0.5);
  assert.equal(disponibilite24h([], maintenant), null);
});

test('la frise des 24 heures : une panne ne se noie pas dans une demi-heure verte, un creux reste vide', () => {
  const maintenant = 200_000_000;
  const cases = frise24h(
    [
      { siteId: 's', instant: maintenant - 60_000, etat: 'ok', dureeMs: 1 },
      { siteId: 's', instant: maintenant - 120_000, etat: 'panne', dureeMs: 1 },
      { siteId: 's', instant: maintenant - 5 * 3_600_000, etat: 'ok', dureeMs: 1 },
    ],
    maintenant,
  );
  assert.equal(cases.length, 48);
  assert.equal(cases[47].etat, 'panne');
  assert.equal(cases[47].controles.length, 2);
  assert.equal(cases.filter((c) => c.etat === 'ok').length, 1);
  assert.equal(cases[0].etat, 'vide');
});

test('l’alerte d’un parcours nomme l’étape qui casse', () => {
  const texte = texteAlerte(site({ nom: 'Espace', etat: 'panne', raison: 'contenu', etapeEchouee: '5. vérifier le texte « Bienvenue »' }));
  assert.match(texte.corps, /Bienvenue/);
});
