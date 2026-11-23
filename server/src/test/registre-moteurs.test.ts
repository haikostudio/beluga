/**
 * LE REGISTRE DES MOTEURS, ET XIAOMI MIMO QUI S'Y AJOUTE.
 *
 * Un moteur se déclare à UN seul endroit (`shared/src/registre-moteurs.ts`) ;
 * tout ce qui distinguait un moteur des autres par une comparaison écrite en dur
 * doit maintenant suivre ce registre. Ces tests rejouent les règles pures, sans
 * réseau ni compte réel.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMMANDES_D_INSTALLATION,
  EngineId,
  IDS_MOTEURS,
  MOTEURS_DE_L_ASSISTANT,
  consigneEnTeteDeSession,
  descriptionMoteur,
  fichierNatif,
  moteurSansQuota,
  moteursDeSecours,
  moteursParCle,
  moteursParPage,
  motifDArretQuota,
  nomCourtDuMoteur,
  adresseMimoPourCle,
  adressesMimoAEssayer,
  estUneAdresseMimo,
  forfaitMimo,
  compteEpuise,
} from '@beluga/shared';
import {
  catalogueMimoDepuisIds,
  environnementMimo,
  libelleMimo,
  modelesDeTexteMimo,
  raisonDeRefusMimo,
} from '../engines/mimo.js';

test('le schéma des moteurs suit le registre, MiMo compris', () => {
  for (const id of IDS_MOTEURS) assert.equal(EngineId.safeParse(id).success, true);
  assert.ok(IDS_MOTEURS.includes('mimo'));
  assert.equal(EngineId.safeParse('mimo').success, true);
  assert.equal(EngineId.safeParse('inconnu').success, false);
});

test("l'assistant et les commandes d'installation couvrent chaque moteur", () => {
  assert.deepEqual(
    MOTEURS_DE_L_ASSISTANT.map((m) => m.id),
    [...IDS_MOTEURS],
  );
  for (const id of IDS_MOTEURS) assert.ok(COMMANDES_D_INSTALLATION[id], id);
});

test('les anciennes règles gardent leur réponse pour les trois premiers moteurs', () => {
  assert.equal(fichierNatif('claude'), 'CLAUDE.md');
  assert.equal(fichierNatif('codex'), 'AGENTS.md');
  assert.equal(fichierNatif('cursor'), 'AGENTS.md');
  assert.equal(fichierNatif(undefined), 'CLAUDE.md');
  assert.equal(consigneEnTeteDeSession('claude'), true);
  assert.equal(consigneEnTeteDeSession('codex'), false);
  assert.equal(consigneEnTeteDeSession('cursor'), false);
  assert.equal(moteurSansQuota('cursor'), true);
  assert.equal(moteurSansQuota('claude'), false);
  assert.deepEqual(moteursParPage(), ['claude', 'codex']);
  assert.equal(nomCourtDuMoteur('codex'), 'GPT');
});

test("MiMo se comporte comme Claude pour l'outil, comme Cursor pour la facturation", () => {
  assert.equal(fichierNatif('mimo'), 'CLAUDE.md');
  assert.equal(consigneEnTeteDeSession('mimo'), true);
  assert.equal(moteurSansQuota('mimo'), true);
  assert.ok(moteursParCle().includes('mimo'));
  assert.equal(descriptionMoteur('mimo')?.outil, 'claude');
  assert.equal(nomCourtDuMoteur('mimo'), 'MiMo');
});

test("un moteur payé à l'usage n'est jamais choisi seul en secours", () => {
  const secours = moteursDeSecours();
  assert.ok(!secours.includes('mimo'));
  assert.ok(!secours.includes('cursor'));
  assert.ok(secours.includes('claude'));
});

test("l'environnement MiMo vise Xiaomi et n'hérite d'aucun jeton Anthropic", () => {
  const env = environnementMimo('sk-essai', '/tmp/coffre-mimo');
  assert.equal(env.ANTHROPIC_BASE_URL, 'https://api.xiaomimimo.com/anthropic');
  assert.equal(env.ANTHROPIC_API_KEY, 'sk-essai');
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, '');
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, '');
  assert.equal(env.CLAUDE_CONFIG_DIR, '/tmp/coffre-mimo');
  assert.match(env.ANTHROPIC_DEFAULT_HAIKU_MODEL, /^mimo-/);
});

test("une clé d'abonnement « tp- » vise token-plan-sgp, une clé « sk- » l'API à l'usage", () => {
  const tp = environnementMimo('tp-essai', '/tmp/coffre-mimo');
  assert.equal(tp.ANTHROPIC_BASE_URL, 'https://token-plan-sgp.xiaomimimo.com/anthropic');
  assert.equal(adresseMimoPourCle('sk-essai'), 'https://api.xiaomimimo.com');
  assert.deepEqual(adressesMimoAEssayer('tp-essai'), [
    'https://token-plan-sgp.xiaomimimo.com',
    'https://api.xiaomimimo.com',
  ]);
  assert.equal(forfaitMimo('tp-essai'), 'Abonnement (Token Plan)');
  assert.equal(forfaitMimo('sk-essai'), "À l'usage");
});

test("un tour MiMo ne part que vers une adresse Xiaomi connue", () => {
  assert.ok(estUneAdresseMimo('https://api.xiaomimimo.com/anthropic'));
  assert.ok(estUneAdresseMimo('https://token-plan-sgp.xiaomimimo.com/anthropic'));
  assert.ok(!estUneAdresseMimo('https://api.anthropic.com'));
  assert.ok(!estUneAdresseMimo('https://api.xiaomimimo.com.pirate.test/anthropic'));
  assert.ok(!estUneAdresseMimo(''));
});

test('le catalogue MiMo écarte voix et transcription, et garde toutes les versions', () => {
  const publies = [
    'mimo-v2.5',
    'mimo-v2.5-asr',
    'mimo-v2.5-pro',
    'mimo-v2.5-tts',
    'mimo-v2.5-tts-voiceclone',
    'mimo-v2.5-tts-voicedesign',
    'mimo-v2.6-flash',
    'mimo-v2.6-pro',
    'mimo-v2.6-pro-ultraspeed',
  ];
  assert.deepEqual(modelesDeTexteMimo(publies).sort(), [
    'mimo-v2.5',
    'mimo-v2.5-pro',
    'mimo-v2.6-flash',
    'mimo-v2.6-pro',
    'mimo-v2.6-pro-ultraspeed',
  ]);
  const catalogue = catalogueMimoDepuisIds(publies);
  const ids = catalogue.map((m) => m.id);
  assert.ok(ids.includes('mimo-v2.6-pro'));
  assert.ok(ids.includes('mimo-v2.6-flash'));
  assert.ok(ids.includes('mimo-v2.5-pro'), 'la v2.5 pro reste choisissable, après la v2.6');
  assert.ok(ids.indexOf('mimo-v2.6-pro') < ids.indexOf('mimo-v2.5-pro'), 'la plus récente d’abord');
  assert.equal(catalogue.find((m) => m.id === 'mimo-v2.6-flash')?.appetite, 'light');
  assert.equal(catalogue.find((m) => m.id === 'mimo-v2.6-pro')?.appetite, 'heavy');
  assert.ok(catalogue.every((m) => m.thinking.length === 0));
  assert.equal(libelleMimo('mimo-v2.6-pro'), 'MiMo V2.6 Pro');
});

test('un solde vide chez Xiaomi est une limite de compte, pas une panne', () => {
  assert.equal(
    motifDArretQuota({ ok: false, texte: 'API Error: 402 Insufficient account balance' }),
    'texte-de-limite',
  );
  assert.match(raisonDeRefusMimo(402), /solde épuisé/);
  assert.match(raisonDeRefusMimo(401), /clé refusée/);
});

test("« épuisé » ne se dit pas d'un compte dont la clé est refusée", () => {
  assert.equal(compteEpuise({ available: false }), true);
  assert.equal(compteEpuise({ available: false, connexion: { doitReconnecter: true } }), false);
  assert.equal(compteEpuise({ available: true }), false);
});
