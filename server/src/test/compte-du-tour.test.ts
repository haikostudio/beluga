import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMITE_ECHEANCE_MAX_MS,
  LIMITE_SANS_ECHEANCE_MS,
  LimiteConnue,
  compteDuTour,
  comptesALimiteConnue,
  echeanceAnnonceeParLeMoteur,
  echeanceDeLaLimite,
  limiteEnCours,
} from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* LE COMPTE D'UN TOUR TIENT D'UN TOUR À L'AUTRE                       */
/*                                                                     */
/* Le scénario de la carte « Cohérence du flux plan, compte et         */
/* lancement » (06.09.2026) : Claude Pro répond « requires usage      */
/* credits » alors que son relevé le dit disponible ; chaque tour      */
/* ordinaire repartait dessus, tombait, et une relève partait sur Max  */
/* x20. La règle pure d'ici garde Max x20 tant que la limite de Pro   */
/* est connue, puis rend la main à la répartition à l'échéance.        */
/* ------------------------------------------------------------------ */

const PRO = { id: 'claude-pro', engine: 'claude', plan: 'Pro', priority: 10 };
const MAX = { id: 'claude-max20', engine: 'claude', plan: 'Max x20', priority: 20 };
const MAX_B = { id: 'claude-max20-b', engine: 'claude', plan: 'Max x20', priority: 30 };
const CODEX = { id: 'codex', engine: 'codex', plan: 'Plus', priority: 10 };
const COMPTES = [PRO, MAX, MAX_B, CODEX];

const NOW = Date.parse('2026-09-06T14:00:00+02:00');
const DEMAIN_15H = Date.parse('2026-09-07T15:00:00+02:00');
const PRO_A_SEC: LimiteConnue = { compte: 'claude-pro', motif: 'texte-de-limite', resetsAt: DEMAIN_15H, noteeA: NOW };

test('trois tours de suite après la relève : Max x20 à chaque fois, tant que Pro est à sa limite connue', () => {
  let dernier: string | undefined = 'claude-max20';
  for (let tour = 1; tour <= 3; tour += 1) {
    const decision = compteDuTour({
      engine: 'claude',
      dernier,
      comptes: COMPTES,
      limites: [PRO_A_SEC],
      now: NOW + tour * 60_000,
    });
    assert.equal(decision.compte, 'claude-max20', `tour ${tour} : le compte retenu doit tenir`);
    assert.equal(decision.raison, 'dernier');
    assert.deepEqual(decision.ecartes, ['claude-pro']);
    dernier = decision.compte;
  }
});

test('à l’échéance de la limite, la main revient à la répartition — donc à Pro', () => {
  const decision = compteDuTour({
    engine: 'claude',
    dernier: 'claude-max20',
    comptes: COMPTES,
    limites: [PRO_A_SEC],
    now: DEMAIN_15H + 1,
  });
  assert.equal(decision.compte, undefined, 'plus rien ne retient Max x20 : la répartition tranche');
  assert.equal(decision.raison, 'repartition');
  assert.deepEqual(decision.ecartes, [], 'la limite échue n’écarte plus personne');
});

test('sans limite connue, le dernier compte ne retient rien : la répartition décide comme avant', () => {
  const decision = compteDuTour({ engine: 'claude', dernier: 'claude-max20', comptes: COMPTES, limites: [], now: NOW });
  assert.equal(decision.raison, 'repartition');
  assert.equal(decision.compte, undefined);
});

test('le compte imposé passe devant tout, sauf s’il est à sa limite connue', () => {
  const tenu = compteDuTour({ engine: 'claude', impose: 'claude-max20', regle: 'claude-pro', comptes: COMPTES, limites: [], now: NOW });
  assert.deepEqual([tenu.compte, tenu.raison], ['claude-max20', 'impose']);

  const refuse = compteDuTour({
    engine: 'claude',
    impose: 'claude-pro',
    dernier: 'claude-max20',
    comptes: COMPTES,
    limites: [PRO_A_SEC],
    now: NOW,
  });
  assert.equal(refuse.compte, 'claude-max20', 'le compte imposé à sec cède la place au palier suivant');
  assert.equal(refuse.raison, 'dernier');
  assert.deepEqual(refuse.refuse, { compte: 'claude-pro', raison: 'limite-connue' }, 'et le refus est DIT');
});

test('le compte réglé sur l’agent passe devant le dernier compte et la répartition', () => {
  const decision = compteDuTour({ engine: 'claude', regle: 'claude-max20-b', dernier: 'claude-max20', comptes: COMPTES, limites: [PRO_A_SEC], now: NOW });
  assert.deepEqual([decision.compte, decision.raison], ['claude-max20-b', 'regle']);
});

test('un compte demandé introuvable, coupé ou d’un autre moteur est refusé en le disant', () => {
  const introuvable = compteDuTour({ engine: 'claude', impose: 'fantome', comptes: COMPTES, limites: [], now: NOW });
  assert.deepEqual(introuvable.refuse, { compte: 'fantome', raison: 'introuvable' });
  assert.equal(introuvable.raison, 'repartition');

  const coupe = compteDuTour({ engine: 'claude', regle: 'claude-pro', comptes: [{ ...PRO, disabled: true }, MAX], limites: [], now: NOW });
  assert.deepEqual(coupe.refuse, { compte: 'claude-pro', raison: 'coupe' });

  const autreMoteur = compteDuTour({ engine: 'claude', impose: 'codex', comptes: COMPTES, limites: [], now: NOW });
  assert.deepEqual(autreMoteur.refuse, { compte: 'codex', raison: 'introuvable' });
});

test('le dernier compte ne tient que si un compte MIEUX classé est écarté', () => {
  // Max x20 « B » est moins bien classé que « A » (priorité) : la limite de B
  // ne retient pas A, la répartition reprend la main.
  const decision = compteDuTour({
    engine: 'claude',
    dernier: 'claude-max20',
    comptes: COMPTES,
    limites: [{ compte: 'claude-max20-b', motif: 'limite-structuree', noteeA: NOW }],
    now: NOW,
  });
  assert.equal(decision.raison, 'repartition');
  assert.deepEqual(decision.ecartes, ['claude-max20-b']);
});

test('un dernier compte lui-même à sa limite ne tient pas', () => {
  const decision = compteDuTour({
    engine: 'claude',
    dernier: 'claude-max20',
    comptes: COMPTES,
    limites: [PRO_A_SEC, { compte: 'claude-max20', motif: 'limite-structuree', noteeA: NOW }],
    now: NOW,
  });
  assert.equal(decision.raison, 'repartition');
  assert.deepEqual(decision.ecartes.sort(), ['claude-max20', 'claude-pro']);
});

/* -------- L'échéance d'une limite -------- */

test('une limite sans échéance dure une fenêtre de cinq heures', () => {
  const limite: LimiteConnue = { compte: 'claude-pro', motif: 'texte-de-limite', noteeA: NOW };
  assert.equal(echeanceDeLaLimite(limite), NOW + LIMITE_SANS_ECHEANCE_MS);
  assert.equal(limiteEnCours(limite, NOW + LIMITE_SANS_ECHEANCE_MS - 1), true);
  assert.equal(limiteEnCours(limite, NOW + LIMITE_SANS_ECHEANCE_MS), false);
});

test('une échéance connue fait foi, plafonnée à sept jours, et une échéance passée vaut « sans échéance »', () => {
  assert.equal(echeanceDeLaLimite(PRO_A_SEC), DEMAIN_15H);
  const lointaine: LimiteConnue = { ...PRO_A_SEC, resetsAt: NOW + 400 * 24 * 3600 * 1000 };
  assert.equal(echeanceDeLaLimite(lointaine), NOW + LIMITE_ECHEANCE_MAX_MS);
  const passee: LimiteConnue = { ...PRO_A_SEC, resetsAt: NOW - 1 };
  assert.equal(echeanceDeLaLimite(passee), NOW + LIMITE_SANS_ECHEANCE_MS);
});

test('comptesALimiteConnue ne garde que les limites encore en cours', () => {
  const limites: LimiteConnue[] = [
    PRO_A_SEC,
    { compte: 'claude-max20', motif: 'limite-structuree', resetsAt: NOW - 1000, noteeA: NOW - LIMITE_SANS_ECHEANCE_MS - 1 },
  ];
  assert.deepEqual([...comptesALimiteConnue(limites, NOW)], ['claude-pro']);
});

/* ------------------------------------------------------------------ */
/* LE PREMIER COMPTE REVIENT À L'HEURE ANNONCÉE PAR LE MOTEUR          */
/* ------------------------------------------------------------------ */

test('l’heure de retour annoncée par le moteur est lue, en UTC comme dans un fuseau nommé', () => {
  const avant = Date.parse('2026-09-17T10:38:27Z');
  const banniere = "You've hit your session limit · resets 12:20pm (UTC)";
  assert.equal(echeanceAnnonceeParLeMoteur(banniere, avant), Date.parse('2026-09-17T12:20:00Z'));
  // Déjà passée aujourd'hui : c'est demain.
  assert.equal(echeanceAnnonceeParLeMoteur(banniere, Date.parse('2026-09-17T13:00:00Z')), Date.parse('2026-09-18T12:20:00Z'));
  assert.equal(echeanceAnnonceeParLeMoteur('resets 3am (Europe/Zurich)', avant), Date.parse('2026-09-18T01:00:00Z'));
  assert.equal(echeanceAnnonceeParLeMoteur('resets 14:05 (UTC)', avant), Date.parse('2026-09-17T14:05:00Z'));
  // Rien à lire, ou une date qu'on ne sait pas lire : on ne devine pas.
  assert.equal(echeanceAnnonceeParLeMoteur('Fable 5.1 requires usage credits', avant), undefined);
  assert.equal(echeanceAnnonceeParLeMoteur('resets Sep 20, 3pm (UTC)', avant), undefined);
  assert.equal(echeanceAnnonceeParLeMoteur('resets 3pm (Nulle/Part)', avant), undefined);
});

test('perso à sa limite puis revenu : le second sert de relais, puis chaque départ revient au perso', () => {
  const PERSO = { id: 'claude-principal', engine: 'claude', plan: 'Max x5', priority: 10 };
  const SECOND = { id: 'claude-secondary', engine: 'claude', plan: 'Max x5', priority: 20 };
  const noteeA = Date.parse('2026-09-17T10:38:27Z');
  const resetsAt = echeanceAnnonceeParLeMoteur("You've hit your session limit · resets 12:20pm (UTC)", noteeA);
  const limites: LimiteConnue[] = [{ compte: 'claude-principal', motif: 'texte-de-limite', resetsAt, noteeA }];
  const entree = { engine: 'claude', comptes: [PERSO, SECOND], limites };
  // Pendant la limite : un agent resté sur le second y tient, un agent neuf laisse la répartition écarter le perso.
  const pendant = Date.parse('2026-09-17T12:10:00Z');
  assert.deepEqual(compteDuTour({ ...entree, dernier: 'claude-secondary', now: pendant }), {
    compte: 'claude-secondary',
    raison: 'dernier',
    ecartes: ['claude-principal'],
    refuse: undefined,
  });
  assert.deepEqual(compteDuTour({ ...entree, now: pendant }).ecartes, ['claude-principal']);
  // Dès l'heure annoncée — pas cinq heures après la limite — le perso redevient candidat.
  const apres = Date.parse('2026-09-17T12:20:01Z');
  const retour = compteDuTour({ ...entree, dernier: 'claude-secondary', now: apres });
  assert.equal(retour.raison, 'repartition');
  assert.deepEqual(retour.ecartes, []);
  assert.ok(apres < noteeA + LIMITE_SANS_ECHEANCE_MS, 'bien avant la fenêtre par défaut');
});
