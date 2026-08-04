import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PONT_ABSENT,
  PONT_LISTE_VIDE,
  PONT_SANS_LISTE,
  etatDuPont,
  serveursTiers,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Le pont a-t-il servi ?                                              */
/* ------------------------------------------------------------------ */

test('aucune trace du pont : la panne se dit en toutes lettres', () => {
  const etat = etatDuPont(null);
  assert.equal(etat.ok, false);
  assert.equal(etat.ok === false && etat.raison, PONT_ABSENT);
  assert.ok(PONT_ABSENT.includes('mémoire'), 'la raison doit dire ce qui a manqué');
});

test('un pont noté « pas démarré » vaut une absence', () => {
  const etat = etatDuPont({ demarre: false, outils: 12 });
  assert.equal(etat.ok, false);
  assert.equal(etat.ok === false && etat.raison, PONT_ABSENT);
});

test('pont démarré mais liste jamais demandée : le tour le dit', () => {
  const etat = etatDuPont({ demarre: true, outils: null });
  assert.equal(etat.ok, false);
  assert.equal(etat.ok === false && etat.raison, PONT_SANS_LISTE);
});

test('liste vide : le tour le dit, au lieu de continuer en inventant', () => {
  const etat = etatDuPont({ demarre: true, outils: 0 });
  assert.equal(etat.ok, false);
  assert.equal(etat.ok === false && etat.raison, PONT_LISTE_VIDE);
});

test('pont démarré avec des outils : rien à signaler', () => {
  assert.deepEqual(etatDuPont({ demarre: true, outils: 9 }), { ok: true });
});

/* ------------------------------------------------------------------ */
/* Les serveurs d'outils étrangers                                     */
/* ------------------------------------------------------------------ */

const CONFIG = `model = "gpt-5.5"

[mcp_servers.memoire]
url = "https://memoire.example.com/mcp"
approval_mode = "never"

[mcp_servers.memoire.tools.chercher_memoire]
approval_mode = "approve"

# [mcp_servers.eteint]
# url = "https://exemple"

mcp_servers.rapide = { command = "node", args = ["pont.mjs"] }

[mcp_servers.haikodev]
command = "node"
`;

test('les serveurs étrangers sont repérés, une seule fois chacun', () => {
  const noms = serveursTiers(CONFIG);
  assert.deepEqual(noms.sort(), ['memoire', 'rapide']);
});

test('le serveur du projet ne s\'éteint jamais lui-même', () => {
  assert.ok(!serveursTiers(CONFIG).includes('haikodev'));
});

test('une ligne mise de côté ne branche rien', () => {
  assert.ok(!serveursTiers(CONFIG).includes('eteint'));
});

test('sans serveur étranger, la liste est vide', () => {
  assert.deepEqual(serveursTiers('model = "gpt-5.5"\n[features]\nmemories = true\n'), []);
});
