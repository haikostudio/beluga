import assert from 'node:assert/strict';
import test from 'node:test';
import {
  heureLocale,
  previsionEpuisement,
  previsionsDeFamille,
  PROFIL_NUIT_PAR_DEFAUT,
  NUIT_PAR_DEFAUT,
  type CompteDeFamille,
  type ReleveQuota,
} from '@beluga/shared';

// Le cas réel du 23/11/2026 (capture #45db), à une heure ronde : lundi midi.
const MAINTENANT = new Date('2026-11-23T12:00:00+01:00').getTime();
const h = (n: number) => n * 3600_000;
const j = (n: number) => n * 24 * 3600_000;

/** Des relevés toutes les deux heures, de `depuis` heures avant maintenant, montant de `pasParHeure`. */
function montee(depart: number, pasParHeure: number, depuis: number, jusqua = 0): ReleveQuota[] {
  const out: ReleveQuota[] = [];
  for (let i = depuis; i >= jusqua; i -= 2) {
    out.push({ at: MAINTENANT - h(i), weekly: Math.min(100, depart + pasParHeure * (depuis - i)) });
  }
  return out;
}

/** Un compte resté plein (épuisé) sur toute la période observée. */
function plein(depuis: number): ReleveQuota[] {
  return montee(100, 0, depuis);
}

function compte(id: string, usedPct: number, remiseDans: number, releves: ReleveQuota[], extra: Partial<CompteDeFamille> = {}): CompteDeFamille {
  return { id, label: id, plan: 'Max x5', weekly: { usedPct, resetsAt: MAINTENANT + remiseDans }, releves, ...extra };
}

test('pause de nuit par défaut : six heures à poids minimum, moyenne de 1', () => {
  assert.equal(PROFIL_NUIT_PAR_DEFAUT.length, 24);
  const moyenne = PROFIL_NUIT_PAR_DEFAUT.reduce((s, p) => s + p, 0) / 24;
  assert.ok(Math.abs(moyenne - 1) < 1e-9);
  for (let heure = 0; heure < 24; heure++) {
    const nuit = heure >= NUIT_PAR_DEFAUT.debut && heure < NUIT_PAR_DEFAUT.fin;
    assert.equal(PROFIL_NUIT_PAR_DEFAUT[heure] < 0.1, nuit, `heure ${heure}`);
  }
});

test('un compte seul : la nuit 1 h – 7 h ne consomme plus, l’épuisement recule', () => {
  // 1 % par heure observé ce matin, de 8 h à midi : trop peu pour mesurer un profil.
  const prevision = previsionEpuisement(montee(36, 1, 4), { usedPct: 40, resetsAt: MAINTENANT + j(5) }, MAINTENANT);
  assert.ok(prevision);
  assert.equal(prevision.morceaux.base, 'nuits');
  // En ligne droite, les 60 % restants partaient en 60 h ; avec les nuits, plus tard.
  assert.ok(prevision.morceaux.brut > MAINTENANT + h(60), 'la nuit repousse l’épuisement');
  // Et la trajectoire reste plate pendant la nuit.
  const nuit = prevision.trajectoire.filter((p, i, t) => i > 0 && heureLocale(t[i - 1].at) >= 1 && heureLocale(t[i - 1].at) < 6);
  for (const point of nuit) {
    const avant = prevision.trajectoire[prevision.trajectoire.indexOf(point) - 1];
    assert.ok(point.pct - avant.pct < 0.1, 'la nuit ne consomme presque rien');
  }
});

test('deux comptes : celui qui a porté seul la charge n’est plus annoncé épuisé en milieu de semaine', () => {
  // A est reparti à zéro hier à 16 h et a tout pris (≈ 1,2 %/h) pendant que B était épuisé ; B repart dans une heure.
  const a = compte('A', 24, j(6) + h(5), montee(0, 1.2, 20));
  const b = compte('B', 100, h(1), plein(20));
  const seul = previsionEpuisement(a.releves, a.weekly, MAINTENANT);
  const famille = previsionsDeFamille([a, b], MAINTENANT);
  const ensemble = famille.comptes.A;
  // Seul, A s'épuise avant sa remise à zéro ; en famille, B reprend sa part.
  assert.ok(seul, 'seul, A semblait manquer');
  assert.ok(!ensemble || ensemble.morceaux.brut > seul.morceaux.brut + j(1), 'en famille, l’échéance de A recule nettement');
  assert.ok(famille.ensemble, 'la famille est jugée');
});

test('un troisième compte éloigne l’échéance de chacun', () => {
  const rapide = (id: string) => compte(id, 30, j(6), montee(0, 2, 24));
  const deux = previsionsDeFamille([rapide('A'), rapide('B')], MAINTENANT);
  const trois = previsionsDeFamille([rapide('A'), rapide('B'), compte('C', 30, j(6), montee(30, 0, 24))], MAINTENANT);
  assert.ok(deux.comptes.A, 'à deux, A manque');
  const apres = trois.comptes.A?.morceaux.brut ?? Infinity;
  assert.ok(apres > deux.comptes.A.morceaux.brut, 'à trois, A tient plus longtemps');
});

test('un compte coupé ne reçoit rien', () => {
  const a = compte('A', 30, j(6), montee(0, 2, 24));
  const coupe = compte('C', 0, j(6), montee(0, 0, 24), { coupe: true });
  const famille = previsionsDeFamille([a, coupe], MAINTENANT);
  assert.equal(famille.comptes.C, null);
  assert.ok(famille.comptes.A, 'A porte tout et s’épuise');
  assert.deepEqual(famille.comptes.A.morceaux.partage, [], 'personne ne partage avec A');
});

test('la famille dit quand il n’y a plus aucun compte, et jusqu’à quand', () => {
  // Deux comptes presque pleins, gros besoin : plus rien avant la première remise à zéro (dans trois jours).
  const a = compte('A', 90, j(3), montee(60, 1.5, 20));
  const b = compte('B', 90, j(4), montee(60, 1.5, 20));
  const famille = previsionsDeFamille([a, b], MAINTENANT);
  assert.ok(famille.ensemble && !famille.ensemble.tient);
  assert.equal(famille.ensemble.jusqua, MAINTENANT + j(3), 'le trou se referme à la première remise à zéro');
  assert.ok(famille.ensemble.at < MAINTENANT + j(3));
  assert.ok(famille.ensemble.manqueMs > 0);
});

test('les tailles de forfait se comparent : un gros compte monte moins vite qu’un petit', () => {
  const petit = compte('petit', 10, j(6), montee(0, 0.5, 20), { plan: 'Pro' });
  const gros = compte('gros', 10, j(6), montee(0, 0.5, 20), { plan: 'Pro' });
  // Le même besoin, porté par un Max x20 au lieu d'un Pro : le petit tient bien plus longtemps.
  const egaux = previsionsDeFamille([petit, gros], MAINTENANT);
  const inegaux = previsionsDeFamille([petit, { ...gros, plan: 'Max x20' }], MAINTENANT);
  const avant = egaux.comptes.petit?.morceaux.brut ?? Infinity;
  const apres = inegaux.comptes.petit?.morceaux.brut ?? Infinity;
  assert.ok(apres >= avant);
});

test('un compte seul dans sa famille garde la prévision d’un compte seul', () => {
  const a = compte('A', 40, j(5), montee(20, 1, 20));
  const famille = previsionsDeFamille([a], MAINTENANT);
  assert.equal(famille.ensemble, null);
  assert.deepEqual(famille.comptes.A, previsionEpuisement(a.releves, a.weekly, MAINTENANT));
});
