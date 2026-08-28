import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AccountQuota,
  EngineInfo,
  assistantNecessaire,
  auMoinsUnMoteurEnLigne,
  compteEnLigne,
  moteursDeLAssistant,
} from '@haikodev/shared';

/**
 * L'ASSISTANT DE DÉMARRAGE : au moins un moteur avant d'utiliser l'application.
 * La règle est pure — elle ne lit ni base ni disque —, donc elle se juge ici.
 */

function moteur(id: 'claude' | 'codex' | 'cursor', patch: Partial<EngineInfo> = {}): EngineInfo {
  return EngineInfo.parse({ id, label: id, installed: false, ...patch });
}

function compte(id: string, engine: 'claude' | 'codex' | 'cursor', patch: Partial<AccountQuota> = {}): AccountQuota {
  return AccountQuota.parse({ id, engine, label: id, ...patch });
}

const CATALOGUE_VIDE = [moteur('claude'), moteur('codex'), moteur('cursor')];

test('sans aucun outil installé, les trois moteurs sont « à installer » et rien n’est en ligne', () => {
  const rendu = moteursDeLAssistant(CATALOGUE_VIDE, []);
  assert.deepEqual(
    rendu.map((m) => m.etape),
    ['a-installer', 'a-installer', 'a-installer'],
  );
  assert.equal(auMoinsUnMoteurEnLigne(CATALOGUE_VIDE, []), false);
});

test('un outil installé sans compte demande un compte, pas une installation', () => {
  const engines = [moteur('claude', { installed: true, cliInstalle: true }), moteur('codex'), moteur('cursor')];
  const claude = moteursDeLAssistant(engines, []).find((m) => m.id === 'claude')!;
  assert.equal(claude.etape, 'a-connecter');
  assert.equal(claude.cliInstalle, true);
  assert.equal(auMoinsUnMoteurEnLigne(engines, []), false);
});

test('un outil installé avec un compte valide met le moteur en ligne', () => {
  const engines = [moteur('claude', { installed: true, cliInstalle: true }), moteur('codex'), moteur('cursor')];
  const quotas = [compte('claude-1', 'claude')];
  const claude = moteursDeLAssistant(engines, quotas).find((m) => m.id === 'claude')!;
  assert.equal(claude.etape, 'pret');
  assert.equal(claude.comptesEnLigne, 1);
  assert.equal(auMoinsUnMoteurEnLigne(engines, quotas), true);
});

test('un compte qui doit être reconnecté ne met pas le moteur en ligne', () => {
  const engines = [moteur('claude', { installed: true, cliInstalle: true }), moteur('codex'), moteur('cursor')];
  const quotas = [
    compte('claude-1', 'claude', {
      connexion: { etat: 'expiree', libelle: 'connexion expirée', doitReconnecter: true },
    }),
  ];
  const claude = moteursDeLAssistant(engines, quotas).find((m) => m.id === 'claude')!;
  assert.equal(claude.etape, 'a-reconnecter');
  assert.equal(claude.comptes, 1);
  assert.equal(claude.comptesEnLigne, 0);
  assert.equal(auMoinsUnMoteurEnLigne(engines, quotas), false);
});

test('un compte coupé à la main ne compte pas, un compte à court de quota compte encore', () => {
  assert.equal(compteEnLigne(compte('a', 'claude', { disabled: true })), false);
  // Une fenêtre épuisée repart toute seule : bloquer l'application entière pour
  // cela reviendrait à réclamer un second compte pour quelques heures.
  assert.equal(compteEnLigne(compte('b', 'claude', { available: false })), true);
});

test('Cursor sait dire « outil installé, il manque une clé »', () => {
  // `installed` reste faux tant qu'aucune clé n'est déclarée ; `cliInstalle`,
  // lui, ne parle que de l'outil posé sur la machine.
  const engines = [moteur('claude'), moteur('codex'), moteur('cursor', { installed: false, cliInstalle: true })];
  const cursor = moteursDeLAssistant(engines, []).find((m) => m.id === 'cursor')!;
  assert.equal(cursor.etape, 'a-connecter');
  assert.equal(cursor.connexionParCle, true);
  assert.match(cursor.libelle, /clé/);
});

test('un catalogue qui ne dit rien de l’outil retombe sur « moteur utilisable »', () => {
  const engines = [moteur('claude', { installed: true }), moteur('codex'), moteur('cursor')];
  assert.equal(moteursDeLAssistant(engines, []).find((m) => m.id === 'claude')!.cliInstalle, true);
});

test('l’assistant ne s’ouvre pas tant que le catalogue ou les comptes ne sont pas arrivés', () => {
  // Premier envoi pas encore reçu.
  assert.equal(assistantNecessaire({ pret: false, engines: CATALOGUE_VIDE, quotas: [], quotasRecus: true }), false);
  // Catalogue des moteurs encore vide : on ne juge pas.
  assert.equal(assistantNecessaire({ pret: true, engines: [], quotas: [], quotasRecus: true }), false);
  // Relevé des comptes jamais reçu : une liste vide ne prouve rien.
  assert.equal(assistantNecessaire({ pret: true, engines: CATALOGUE_VIDE, quotas: [], quotasRecus: false }), false);
});

test('l’assistant s’ouvre sur un serveur nu, et se referme dès qu’un moteur répond', () => {
  assert.equal(assistantNecessaire({ pret: true, engines: CATALOGUE_VIDE, quotas: [], quotasRecus: true }), true);

  const engines = [moteur('claude'), moteur('codex', { installed: true, cliInstalle: true }), moteur('cursor')];
  const quotas = [compte('codex-1', 'codex')];
  assert.equal(assistantNecessaire({ pret: true, engines, quotas, quotasRecus: true }), false);
});

test('chaque moteur porte une commande d’installation, jamais vide', () => {
  for (const m of moteursDeLAssistant(CATALOGUE_VIDE, [])) {
    assert.ok(m.commandeDInstallation.trim().length > 10, `${m.id} sans commande`);
  }
});
