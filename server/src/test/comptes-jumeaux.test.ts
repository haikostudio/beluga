import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compteQuiRecoitLeTravail,
  groupesDeComptesJumeaux,
  groupesDeJumeaux,
  jumeauxParCompte,
  natureDuJumelage,
  sansDoublonDAbonnement,
  signaturesDeGroupe,
} from '@beluga/shared';

/*
 * LE CAS RÉEL DU 02/09/2026 : les deux comptes Claude du serveur rendaient
 * 41 % sur la fenêtre de 5 h et 15 % sur la semaine, avec la même échéance à
 * quelques centaines de millisecondes près — leurs deux jetons portaient le
 * même compte Anthropic.
 */
const CINQ_HEURES = Date.parse('2026-09-03T04:50:00.488Z');
const SEMAINE = Date.parse('2026-09-06T16:00:00.489Z');

const pro = {
  id: 'claude-principal',
  engine: 'claude',
  sessionPct: 41,
  sessionResetsAt: CINQ_HEURES,
  weeklyPct: 15,
  weeklyResetsAt: SEMAINE,
};

// Le même abonnement lu par l'autre coffre : le fournisseur recalcule
// l'échéance à chaque appel, elle diffère donc au millième.
const max20 = {
  ...pro,
  id: 'claude-secondary',
  sessionResetsAt: CINQ_HEURES - 413,
  weeklyResetsAt: SEMAINE - 413,
};

test('deux relevés identiques à la milliseconde près disent le même abonnement', () => {
  assert.notEqual(natureDuJumelage(pro, max20), null);
  assert.deepEqual(groupesDeComptesJumeaux([pro, max20]), [['claude-principal', 'claude-secondary']]);
});

test('une échéance qui diffère de plus d’une minute sépare deux comptes', () => {
  const autre = { ...max20, sessionResetsAt: CINQ_HEURES + 90_000 };
  assert.equal(natureDuJumelage(pro, autre), null);
  assert.deepEqual(groupesDeComptesJumeaux([pro, autre]), []);
});

test('un pourcentage différent suffit à séparer deux comptes', () => {
  assert.deepEqual(groupesDeComptesJumeaux([pro, { ...max20, weeklyPct: 16 }]), []);
});

test('deux moteurs différents ne sont jamais rapprochés', () => {
  assert.deepEqual(groupesDeComptesJumeaux([pro, { ...max20, engine: 'codex' }]), []);
});

test('deux comptes neufs sans échéance connue ne sont pas déclarés jumeaux', () => {
  const neuf = { id: 'a', engine: 'claude', sessionPct: 0, weeklyPct: 0 };
  assert.deepEqual(groupesDeComptesJumeaux([neuf, { ...neuf, id: 'b' }]), []);
});

test('chaque compte reçoit la liste des AUTRES comptes qui disent la même chose', () => {
  const table = jumeauxParCompte([pro, max20]);
  assert.deepEqual(table.get('claude-principal'), ['claude-secondary']);
  assert.deepEqual(table.get('claude-secondary'), ['claude-principal']);
});

test('un compte seul de son espèce ne porte aucune signature de groupe', () => {
  const signatures = signaturesDeGroupe([pro, max20, { ...pro, id: 'seul', sessionPct: 3 }]);
  assert.equal(signatures.get('seul'), undefined);
  assert.equal(signatures.get('claude-principal'), signatures.get('claude-secondary'));
});

test('deux comptes jumeaux ne comptent que pour une seule réserve', () => {
  const comptes = [
    { id: 'claude-principal', plan: 'Max x20', priority: 10, sessionPct: 41, weeklyPct: 15, jumeauDe: 'g' },
    { id: 'claude-secondary', plan: 'Max x20', priority: 10, sessionPct: 41, weeklyPct: 15, jumeauDe: 'g' },
  ];
  assert.equal(sansDoublonDAbonnement(comptes).length, 1);
  assert.equal(compteQuiRecoitLeTravail(comptes)?.id, 'claude-principal');
});

test('le doublon écarté est celui que le classement plaçait en second', () => {
  // Le compte de priorité 10 passe avant celui de priorité 20 : c'est lui que
  // la règle garde, même s'il arrive en second dans la liste reçue.
  const comptes = [
    { id: 'second', plan: 'Max x20', priority: 20, sessionPct: 41, weeklyPct: 15, jumeauDe: 'g' },
    { id: 'premier', plan: 'Max x20', priority: 10, sessionPct: 41, weeklyPct: 15, jumeauDe: 'g' },
  ];
  assert.equal(compteQuiRecoitLeTravail(comptes)?.id, 'premier');
});

test('un compte sans jumeau garde sa place dans le choix', () => {
  const comptes = [
    { id: 'premier', plan: 'Pro', priority: 10, sessionPct: 100, weeklyPct: 15 },
    { id: 'second', plan: 'Max x20', priority: 20, sessionPct: 5, weeklyPct: 15 },
  ];
  assert.equal(compteQuiRecoitLeTravail(comptes)?.id, 'second');
});

/*
 * L'IDENTITÉ LUE CHEZ LE FOURNISSEUR PRIME SUR LES CHIFFRES. Le badge « même
 * abonnement » cesse d'être une déduction : deux coffres qui rendent le même
 * identifiant de compte sont jumeaux CERTAINS, et deux identifiants différents
 * ne le sont pas, quelles que soient les jauges.
 */
const MOI = '74b52c30-f844-4f64-969e-d4b4ca630be4';
const AUTRE = '11111111-2222-3333-4444-555555555555';

test('deux coffres au même compte fournisseur sont jumeaux certains', () => {
  const a = { ...pro, compteFournisseur: MOI };
  const b = { ...max20, compteFournisseur: MOI };
  assert.equal(natureDuJumelage(a, b), 'certain');
  assert.deepEqual(groupesDeJumeaux([a, b]), [
    { ids: ['claude-principal', 'claude-secondary'], nature: 'certain' },
  ]);
});

test('deux identités différentes ne sont pas jumelées, même à chiffres égaux', () => {
  const a = { ...pro, compteFournisseur: MOI };
  const b = { ...max20, compteFournisseur: AUTRE };
  assert.equal(natureDuJumelage(a, b), null);
  assert.deepEqual(groupesDeComptesJumeaux([a, b]), []);
  assert.equal(signaturesDeGroupe([a, b]).size, 0);
});

test('sans identité, les chiffres restent en repli et ne valent qu’une présomption', () => {
  assert.equal(natureDuJumelage(pro, max20), 'presume');
  assert.equal(groupesDeJumeaux([pro, max20])[0]?.nature, 'presume');
});

test('deux coffres au même compte se rapprochent même sans aucun chiffre', () => {
  const a = { id: 'a', engine: 'claude', compteFournisseur: MOI };
  const b = { id: 'b', engine: 'claude', compteFournisseur: MOI };
  assert.deepEqual(groupesDeComptesJumeaux([a, b]), [['a', 'b']]);
});
