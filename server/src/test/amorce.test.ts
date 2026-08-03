import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DUREE_FENETRE_MS,
  comptesAAmorcer,
  decisionAmorce,
  finDeFenetre,
  modeleLePlusLeger,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Amorcer la fenêtre de 5 h dès qu'elle repart à zéro                  */
/* ------------------------------------------------------------------ */

const T = 1_000_000_000_000;
const compte = (patch: Record<string, unknown> = {}) => ({
  id: 'claude-1',
  engine: 'claude',
  sessionPct: 0,
  ...patch,
});

test('une fenêtre retombée à zéro est amorcée', () => {
  assert.equal(decisionAmorce(compte(), T), 'a-amorcer');
});

test('une fenêtre déjà lancée est laissée tranquille', () => {
  assert.equal(decisionAmorce(compte({ sessionPct: 0.4 }), T), 'fenetre-en-cours');
  assert.equal(decisionAmorce(compte({ sessionPct: 53 }), T), 'fenetre-en-cours');
});

test('un compte sans relevé fiable ne déclenche rien', () => {
  assert.equal(decisionAmorce(compte({ lectureEnEchec: true }), T), 'lecture-en-echec');
});

test("un agent au travail a déjà lancé la fenêtre : pas d'amorce", () => {
  assert.equal(decisionAmorce(compte({ agentEnCours: true }), T), 'agent-en-cours');
});

test('les autres moteurs ne sont pas concernés', () => {
  assert.equal(decisionAmorce(compte({ engine: 'codex' }), T), 'autre-moteur');
});

test('jamais deux amorces sur la même fenêtre, même si le compteur affiche encore zéro', () => {
  const deja = compte({ derniereAmorce: { at: T - 60_000, jusqua: T + 3 * 3600_000 } });
  assert.equal(decisionAmorce(deja, T), 'fenetre-deja-amorcee');
});

test('la fenêtre suivante, elle, est bien amorcée', () => {
  const passee = compte({ derniereAmorce: { at: T - DUREE_FENETRE_MS, jusqua: T - 1 } });
  assert.equal(decisionAmorce(passee, T), 'a-amorcer');
});

test('la liste ne retient que les comptes à amorcer, dans l\'ordre reçu', () => {
  const etats = [
    compte({ id: 'a', sessionPct: 12 }),
    compte({ id: 'b' }),
    compte({ id: 'c', engine: 'codex' }),
    compte({ id: 'd' }),
  ];
  assert.deepEqual(
    comptesAAmorcer(etats, T).map((e) => e.id),
    ['b', 'd'],
  );
});

test("l'heure de remise à zéro annoncée fait foi ; sans elle, cinq heures", () => {
  assert.equal(finDeFenetre(T, T + 3600_000), T + 3600_000);
  assert.equal(finDeFenetre(T, undefined), T + DUREE_FENETRE_MS);
  // Une heure déjà passée ne protège de rien : on repart sur cinq heures.
  assert.equal(finDeFenetre(T, T - 10), T + DUREE_FENETRE_MS);
});

test('le modèle retenu est le moins gourmand du catalogue', () => {
  const catalogue = [
    { id: 'opus-5', appetite: 'heavy' },
    { id: 'sonnet-5', appetite: 'medium' },
    { id: 'haiku-4-5', appetite: 'light' },
  ];
  assert.equal(modeleLePlusLeger(catalogue)?.id, 'haiku-4-5');
  // Catalogue vide : on ne devine pas, l'appelant garde son repli.
  assert.equal(modeleLePlusLeger([]), undefined);
});
