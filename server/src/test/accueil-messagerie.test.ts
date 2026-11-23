/**
 * L'ACCUEIL DE LA MESSAGERIE ET LA CONVERSION D'UNE DEMANDE — les règles pures.
 *
 * Ce que ces essais verrouillent : le graphique range bien chaque date dans SA
 * journée locale et ignore ce qui déborde de la période ; les bornes d'une
 * période se remettent d'aplomb et restent sous le plafond ; la répartition par
 * colonne du tableau ne compte pas les demandes rangées ; les totaux
 * additionnent ce que les fiches disent ; les fiches se rangent de la plus
 * active à la moins active ; et le prompt envoyé au cadrage d'une demande
 * convertie porte VRAIMENT l'échange entier, pas seulement la première phrase.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROFONDEUR_MAX_JOURS,
  UN_JOUR_MS,
  bornesDeLEchelle,
  bornesDeLaPeriode,
  clientEnAttente,
  minuitDe,
  demandeDeCadrageDUneDemande,
  fichesRangees,
  joursDInteractions,
  joursDeLaPeriode,
  nombreDeJours,
  repartitionParColonne,
  repartitionVide,
  totauxDuTableau,
  type FicheClientTableau,
} from '@beluga/shared';

const MAINTENANT = 1_800_000_000_000;
/** Le milieu de la journée locale : aucun essai ne doit dépendre de l'heure qu'il est. */
const MIDI = minuitDe(MAINTENANT) + 12 * 3600 * 1000;

function fiche(partiel: Partial<FicheClientTableau> & { clientId: string }): FicheClientTableau {
  return {
    nomAffiche: partiel.clientId,
    actif: true,
    projets: [],
    compteurs: { nonLu: 0, aTraiter: 0 },
    demandesOuvertes: 0,
    parColonne: repartitionVide(),
    tachesOuvertes: 0,
    messages: 0,
    interactions: [],
    ...partiel,
  };
}

/* ---------------- Le découpage des journées ---------------- */

test('chaque échange tombe dans SA journée, la plus récente en dernier', () => {
  const debut = minuitDe(MIDI - 3 * UN_JOUR_MS);
  const cases = joursDInteractions([MIDI, MIDI + 60_000, MIDI - UN_JOUR_MS], debut, MIDI);
  assert.equal(cases.length, 4, 'quatre journées, bornes incluses');
  assert.equal(cases[3], 2, 'les deux échanges du jour sont dans la dernière case');
  assert.equal(cases[2], 1, 'celui de la veille est juste avant');
  assert.deepEqual(cases.slice(0, 2), [0, 0], 'les journées sans échange restent visibles à zéro');
});

test('ce qui déborde de la période est ignoré, jamais tassé dans une case du bord', () => {
  const debut = minuitDe(MIDI - 2 * UN_JOUR_MS);
  const cases = joursDInteractions([MIDI - 40 * UN_JOUR_MS, MIDI + 5 * UN_JOUR_MS], debut, MIDI);
  assert.deepEqual(cases, [0, 0, 0]);
});

test('une période d’un seul jour rend une seule case', () => {
  assert.deepEqual(joursDInteractions([MIDI, MIDI], MIDI, MIDI), [2]);
});

test('le premier et le dernier jour comptent bien, jusqu’à leur dernière seconde', () => {
  const debut = minuitDe(MIDI - UN_JOUR_MS);
  const finDeJournee = minuitDe(MIDI) + 24 * 3600 * 1000 - 1;
  assert.deepEqual(joursDInteractions([debut, finDeJournee], debut, MIDI), [1, 1]);
});

test('sans le moindre échange, le graphique existe quand même et vaut zéro partout', () => {
  const debut = minuitDe(MIDI - 2 * UN_JOUR_MS);
  assert.deepEqual(joursDInteractions([], debut, MIDI), [0, 0, 0]);
});

test('la liste des journées de la période a autant d’entrées que de jours', () => {
  const { debut, fin, jours } = bornesDeLEchelle(7, MIDI);
  assert.equal(jours, 7);
  assert.equal(joursDeLaPeriode(debut, fin).length, 7);
  assert.equal(joursDInteractions([], debut, fin).length, 7);
});

/* ---------------- Les bornes d’une période ---------------- */

test('des bornes inversées se remettent dans l’ordre', () => {
  const droit = bornesDeLaPeriode(MIDI - 4 * UN_JOUR_MS, MIDI, MAINTENANT);
  const envers = bornesDeLaPeriode(MIDI, MIDI - 4 * UN_JOUR_MS, MAINTENANT);
  assert.deepEqual(envers, droit);
  assert.equal(droit.jours, 5);
});

test('une profondeur absurde est ramenée sous le plafond, sans refuser l’écran', () => {
  const bornes = bornesDeLaPeriode(MIDI - 5000 * UN_JOUR_MS, MIDI, MAINTENANT);
  assert.equal(bornes.jours, PROFONDEUR_MAX_JOURS);
  assert.equal(nombreDeJours(bornes.debut, bornes.fin), PROFONDEUR_MAX_JOURS);
});

test('sans bornes, la période par défaut se termine aujourd’hui', () => {
  const bornes = bornesDeLaPeriode(undefined, undefined, MIDI);
  assert.equal(bornes.fin, minuitDe(MIDI) + 24 * 3600 * 1000 - 1);
  assert.equal(bornes.jours, 30);
});

/* ---------------- La répartition par colonne ---------------- */

test('la répartition compte chaque colonne du tableau, et saute les demandes rangées', () => {
  const par = repartitionParColonne([
    { colonne: 'a-faire' },
    { colonne: 'a-faire' },
    { colonne: 'en-cours' },
    { colonne: 'valide' },
    { colonne: 'termine', archiveeLe: 42 },
  ]);
  assert.deepEqual(par, { 'a-faire': 2, 'en-cours': 1, termine: 0, valide: 1 });
});

test('sans la moindre demande, les quatre colonnes existent quand même à zéro', () => {
  assert.deepEqual(repartitionParColonne([]), { 'a-faire': 0, 'en-cours': 0, termine: 0, valide: 0 });
});

/* ---------------- Les chiffres clés ---------------- */

test('les totaux additionnent ce que les fiches disent, colonnes comprises', () => {
  const fiches = [
    fiche({
      clientId: 'a',
      compteurs: { nonLu: 2, aTraiter: 1 },
      tachesOuvertes: 3,
      messages: 12,
      parColonne: { 'a-faire': 2, 'en-cours': 1, termine: 0, valide: 0 },
    }),
    fiche({ clientId: 'b', tachesOuvertes: 1, messages: 3, parColonne: { 'a-faire': 0, 'en-cours': 2, termine: 1, valide: 4 } }),
    fiche({ clientId: 'c', compteurs: { nonLu: 0, aTraiter: 4 } }),
  ];
  assert.deepEqual(totauxDuTableau(fiches), {
    clients: 3,
    clientsEnAttente: 2,
    nonLu: 2,
    aTraiter: 5,
    tachesOuvertes: 4,
    messages: 15,
    parColonne: { 'a-faire': 2, 'en-cours': 3, termine: 1, valide: 4 },
  });
});

test('un client n’attend rien tant qu’il n’a ni non-lu ni demande à traiter', () => {
  assert.equal(clientEnAttente(fiche({ clientId: 'a' })), false);
  assert.equal(clientEnAttente(fiche({ clientId: 'a', compteurs: { nonLu: 0, aTraiter: 1 } })), true);
  assert.equal(clientEnAttente(fiche({ clientId: 'a', compteurs: { nonLu: 1, aTraiter: 0 } })), true);
});

test('LE PLUS ACTIF EN TÊTE : ce qui attend ne double plus personne dans l’ordre', () => {
  const range = fichesRangees([
    fiche({ clientId: 'calme', derniereActivite: 10 }),
    fiche({ clientId: 'charge', compteurs: { nonLu: 3, aTraiter: 2 }, derniereActivite: 100 }),
    fiche({ clientId: 'recent', derniereActivite: 999 }),
    fiche({ clientId: 'jamais' }),
  ]);
  assert.deepEqual(
    range.map((f) => f.clientId),
    ['recent', 'charge', 'calme', 'jamais'],
  );
});

test('à activité égale, le nom départage — l’ordre ne danse pas d’un appel à l’autre', () => {
  const range = fichesRangees([
    fiche({ clientId: 'z', nomAffiche: 'Zoé', derniereActivite: 5 }),
    fiche({ clientId: 'a', nomAffiche: 'Alice', derniereActivite: 5 }),
  ]);
  assert.deepEqual(
    range.map((f) => f.clientId),
    ['a', 'z'],
  );
});

/* ---------------- Ce qu’on dit à l’agent de cadrage ---------------- */

test('le prompt du cadrage porte l’échange ENTIER, ses pièces et le projet visé', () => {
  const prompt = demandeDeCadrageDUneDemande({
    titre: 'Le bouton ne répond plus',
    description: 'Ce que je faisais : je cliquais sur Envoyer.',
    auteurNom: 'Alice',
    nomDuProjet: 'Boutique',
    messages: [
      { auteurNom: 'Haiko', texte: 'Sur quel navigateur ?', creeLe: 1 },
      { auteurNom: 'Alice', texte: 'Firefox, et seulement sur téléphone.', creeLe: 2 },
    ],
    pieces: ['capture.png'],
  });
  assert.ok(prompt.includes('Alice'));
  assert.ok(prompt.includes('Boutique'));
  assert.ok(prompt.includes('Le bouton ne répond plus'));
  assert.ok(prompt.includes('je cliquais sur Envoyer'));
  assert.ok(prompt.includes('Sur quel navigateur ?'), 'le fil doit y être en entier');
  assert.ok(prompt.includes('seulement sur téléphone'), 'y compris le dernier message');
  assert.ok(prompt.includes('capture.png'));
  assert.ok(/ne rends pas/i.test(prompt), 'le cadrage ne doit pas rendre de plan');
});

test('une demande sans suite ni pièce jointe reste un prompt lisible', () => {
  const prompt = demandeDeCadrageDUneDemande({
    titre: 'Une idée',
    description: '',
    auteurNom: 'Bob',
    nomDuProjet: 'Site',
    messages: [],
    pieces: [],
  });
  assert.ok(prompt.includes('Aucun message après la demande'));
  assert.ok(prompt.includes('Aucune pièce jointe'));
  assert.ok(prompt.includes('Sans description'));
});
