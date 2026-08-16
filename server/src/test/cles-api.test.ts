import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CleApi,
  DESCRIPTION_EXTERNE_MAX,
  PREFIXE_CLE_API,
  apercuDeCle,
  cleApiPublique,
  cleDesEntetes,
  formeDeCleApi,
  jugerDemandeDeCarte,
  jugerLaCle,
  jugerNomDeCle,
  rechercherClientsParNom,
  trouverLeProjetVise,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* LA PORTE D'ENTRÉE DES SERVICES EXTÉRIEURS                            */
/*                                                                      */
/* Une clé par service, nommée et révocable. Ce qui compte : une clé     */
/* révoquée est REFUSÉE, un envoi mal formé est refusé EN LE DISANT, et  */
/* le projet visé se retrouve par son nom comme par son identifiant.     */
/* ------------------------------------------------------------------ */

const CLE_VALIDE = PREFIXE_CLE_API + 'a'.repeat(64);

function cle(partiel: Partial<CleApi> = {}): CleApi {
  return {
    id: 'cle-1',
    nom: 'boîte mail',
    apercu: apercuDeCle(CLE_VALIDE),
    empreinte: 'peu-importe',
    creeeLe: 1_700_000_000_000,
    cartesCreees: 0,
    ...partiel,
  };
}

/* -------------------- Le nom d'une clé -------------------- */

test('une clé sans nom est refusée, un nom trop long aussi', () => {
  assert.equal(jugerNomDeCle('').ok, false);
  assert.equal(jugerNomDeCle('  ').ok, false);
  assert.equal(jugerNomDeCle(undefined).ok, false);
  assert.equal(jugerNomDeCle('x'.repeat(200)).ok, false);

  const juge = jugerNomDeCle('  boîte   mail  ');
  assert.equal(juge.ok, true);
  assert.equal(juge.ok && juge.nom, 'boîte mail');
});

/* -------------------- La forme d'une clé -------------------- */

test('seule une clé au bon format est reconnue', () => {
  assert.equal(formeDeCleApi(CLE_VALIDE), true);
  assert.equal(formeDeCleApi('hkd_trop-court'), false);
  assert.equal(formeDeCleApi('a'.repeat(68)), false);
  assert.equal(formeDeCleApi(PREFIXE_CLE_API + 'Z'.repeat(64)), false, 'les majuscules ne sont pas hexadécimales');
  assert.equal(formeDeCleApi(42), false);
});

test("l'aperçu garde le préfixe et quelques signes, jamais la clé entière", () => {
  const apercu = apercuDeCle(CLE_VALIDE);
  assert.ok(apercu.startsWith(PREFIXE_CLE_API));
  assert.ok(apercu.length < CLE_VALIDE.length);
  assert.equal(CLE_VALIDE.startsWith(apercu), true);
});

test('la clé se lit dans les deux en-têtes possibles', () => {
  assert.equal(cleDesEntetes({ 'x-haikodev-cle': CLE_VALIDE }), CLE_VALIDE);
  assert.equal(cleDesEntetes({ authorization: `Bearer ${CLE_VALIDE}` }), CLE_VALIDE);
  assert.equal(cleDesEntetes({ authorization: `bearer   ${CLE_VALIDE}` }), CLE_VALIDE);
  assert.equal(cleDesEntetes({}), undefined);
  assert.equal(cleDesEntetes({ authorization: 'Basic quelquechose' }), undefined);
});

/* -------------------- Le verdict sur la clé -------------------- */

test('aucune clé, clé inconnue et clé RÉVOQUÉE sont toutes refusées', () => {
  const absente = jugerLaCle(undefined, undefined);
  assert.equal(absente.ok, false);
  assert.equal(absente.ok === false && absente.motif, 'absente');
  assert.equal(absente.ok === false && absente.statut, 401);

  const malformee = jugerLaCle('bonjour', undefined);
  assert.equal(malformee.ok === false && malformee.motif, 'malformee');

  const inconnue = jugerLaCle(CLE_VALIDE, undefined);
  assert.equal(inconnue.ok === false && inconnue.motif, 'inconnue');

  // LE CŒUR DU CONTRÔLE : révoquée, la même clé ne passe plus.
  const revoquee = jugerLaCle(CLE_VALIDE, cle({ revoqueeLe: 1_700_000_100_000 }));
  assert.equal(revoquee.ok, false);
  assert.equal(revoquee.ok === false && revoquee.motif, 'revoquee');
  assert.equal(revoquee.ok === false && revoquee.statut, 403);
});

test('une clé vivante et connue passe', () => {
  const verdict = jugerLaCle(CLE_VALIDE, cle());
  assert.equal(verdict.ok, true);
  assert.equal(verdict.ok && verdict.cle.nom, 'boîte mail');
});

test("l'empreinte ne sort jamais vers l'interface", () => {
  const publique = cleApiPublique(cle());
  assert.equal('empreinte' in publique, false);
  assert.equal(publique.nom, 'boîte mail');
});

/* -------------------- Ce que le service envoie -------------------- */

test('un envoi doit porter un projet et un titre', () => {
  assert.equal(jugerDemandeDeCarte(null).ok, false);
  assert.equal(jugerDemandeDeCarte('texte').ok, false);
  assert.equal(jugerDemandeDeCarte([]).ok, false);
  assert.equal(jugerDemandeDeCarte({ titre: 'Un titre' }).ok, false, 'sans projet');
  assert.equal(jugerDemandeDeCarte({ projet: 'Chez Dupont', titre: 'ab' }).ok, false, 'titre trop court');
  assert.equal(
    jugerDemandeDeCarte({ projet: 'p', titre: 'Un titre', description: 'x'.repeat(DESCRIPTION_EXTERNE_MAX + 1) }).ok,
    false,
    'description trop longue',
  );
});

test('les champs sont acceptés en français comme en anglais', () => {
  const fr = jugerDemandeDeCarte({ projet: 'Chez Dupont', titre: 'Mail reçu', description: 'Le client demande…' });
  const en = jugerDemandeDeCarte({ project: 'Chez Dupont', title: 'Mail reçu', description: 'Le client demande…' });
  assert.equal(fr.ok, true);
  assert.equal(en.ok, true);
  assert.deepEqual(fr.ok && fr.demande, en.ok && en.demande);
});

test('les étiquettes sont bornées, et une liste absente vaut liste vide', () => {
  const sans = jugerDemandeDeCarte({ projet: 'p', titre: 'Un titre' });
  assert.deepEqual(sans.ok && sans.demande.etiquettes, []);

  const mauvaise = jugerDemandeDeCarte({ projet: 'p', titre: 'Un titre', etiquettes: 'urgent' });
  assert.equal(mauvaise.ok, false);

  const trop = jugerDemandeDeCarte({
    projet: 'p',
    titre: 'Un titre',
    labels: Array.from({ length: 40 }, (_, i) => `e${i}`),
  });
  assert.equal(trop.ok && trop.demande.etiquettes.length, 10);
});

/* -------------------- Le projet visé -------------------- */

const PROJETS = [
  { id: 'p-1', name: 'Chez Dupont' },
  { id: 'p-2', name: 'Boulangerie Léa' },
  { id: 'p-3', name: 'Ancien client', archive: true },
];

test('le projet se retrouve par son identifiant, son nom exact ou son nom rapproché', () => {
  assert.equal(trouverLeProjetVise(PROJETS, 'p-2').ok, true);

  const exact = trouverLeProjetVise(PROJETS, 'Chez Dupont');
  assert.equal(exact.ok && exact.projet.id, 'p-1');

  // Un service extérieur écrit rarement les accents et la casse à l'identique.
  const rapproche = trouverLeProjetVise(PROJETS, 'boulangerie lea');
  assert.equal(rapproche.ok && rapproche.projet.id, 'p-2');
});

test('un projet mis de côté le DIT, un nom inconnu rend 404, une ambiguïté rend 409', () => {
  const archive = trouverLeProjetVise(PROJETS, 'Ancien client');
  assert.equal(archive.ok, false);
  assert.equal(archive.ok === false && archive.statut, 409);

  const inconnu = trouverLeProjetVise(PROJETS, 'Jamais vu');
  assert.equal(inconnu.ok === false && inconnu.statut, 404);

  const doublons = [
    { id: 'a', name: 'Café du coin' },
    { id: 'b', name: 'cafe du coin' },
  ];
  const ambigu = trouverLeProjetVise(doublons, 'Café du Coin');
  assert.equal(ambigu.ok, false);
  assert.equal(ambigu.ok === false && ambigu.statut, 409);
});

/* -------------------- Retrouver un projet par le nom d'un client -------------------- */

const PROJETS_AVEC_CLIENT = [
  { id: 'p-1', name: 'Chez Dupont', billing: { clientId: 'c-1', clientName: 'Dupont & Fils SA' } },
  {
    id: 'p-2',
    name: 'Boulangerie Léa',
    billing: {
      clientId: 'c-2',
      clientName: 'Boulangerie Léa Sàrl',
      companyId: 'e-1',
      companyName: 'Groupe Léa',
    },
  },
  { id: 'p-3', name: 'Sans client rapproché' },
  { id: 'p-4', name: 'Client sans nom', billing: { clientId: 'c-4' } },
  { id: 'p-5', name: 'Ancien client', archive: true, billing: { clientId: 'c-5', clientName: 'Dupont Retiré' } },
];

test('sans recherche, seuls les projets VRAIMENT rapprochés d’un client sont rendus', () => {
  const clients = rechercherClientsParNom(PROJETS_AVEC_CLIENT);
  assert.deepEqual(
    clients.map((c) => c.projet.id),
    ['p-1', 'p-2'],
  );
  assert.deepEqual(clients[1].entreprise, { id: 'e-1', nom: 'Groupe Léa' });
});

test('la recherche porte sur le NOM du client, sans accents ni casse, sur une partie du nom', () => {
  const parPartiel = rechercherClientsParNom(PROJETS_AVEC_CLIENT, 'dupont');
  assert.deepEqual(
    parPartiel.map((c) => c.projet.id),
    ['p-1'],
  );

  const sansAccent = rechercherClientsParNom(PROJETS_AVEC_CLIENT, 'lea');
  assert.deepEqual(
    sansAccent.map((c) => c.projet.id),
    ['p-2'],
  );
});

test('la recherche porte aussi sur le nom de l’ENTREPRISE du client', () => {
  const parEntreprise = rechercherClientsParNom(PROJETS_AVEC_CLIENT, 'Groupe Lea');
  assert.deepEqual(
    parEntreprise.map((c) => c.projet.id),
    ['p-2'],
  );
});

test('un projet archivé ne ressort jamais, même quand son client répond à la recherche', () => {
  const clients = rechercherClientsParNom(PROJETS_AVEC_CLIENT, 'dupont');
  assert.ok(!clients.some((c) => c.projet.id === 'p-5'));
});

test('une recherche sans résultat rend une liste vide', () => {
  assert.deepEqual(rechercherClientsParNom(PROJETS_AVEC_CLIENT, 'jamais vu'), []);
});
