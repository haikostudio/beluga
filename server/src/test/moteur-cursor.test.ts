import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attenteAvantRelecture,
  consigneEnTeteDeSession,
  coutEnDollars,
  depotGithubPourCursor,
  fenetreDeContexteCursor,
  fichierNatif,
  issueDuRunCursor,
  messageDeFinCursor,
  niveauxDeReflexionCursor,
  paramsDeReflexionCursor,
  raisonDeRefusCursor,
} from '@haikodev/shared';

/*
 * LES RÈGLES DU MOTEUR CURSOR, jouées sans réseau. Les paramètres de modèles
 * repris ici sont ceux RÉELLEMENT rendus par `GET /v1/models` le 14/08/2026 :
 * un modèle Cursor (effort), un modèle GPT (reasoning, « extra-high »), un
 * modèle Claude à simple oui/non, et un modèle sans aucun réglage.
 */

const EFFORT = [
  { id: 'effort', values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }] },
  { id: 'fast', values: [{ value: 'false' }, { value: 'true' }] },
];
const RAISONNEMENT = [
  { id: 'context', values: [{ value: '272k' }, { value: '1m' }] },
  {
    id: 'reasoning',
    values: [{ value: 'none' }, { value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'extra-high' }],
  },
];
const OUI_NON = [{ id: 'thinking', values: [{ value: 'false' }, { value: 'true' }] }];

/*
 * LES COMBINAISONS ACCEPTÉES, telles que Cursor les énumère. C'est le point qui
 * a fait échouer un vrai tour : envoyer le seul effort voulu fait refuser la
 * demande entière (« does not match a known variant »).
 */
const VARIANTES_EFFORT = [
  { params: [{ id: 'effort', value: 'low' }, { id: 'fast', value: 'false' }] },
  { params: [{ id: 'effort', value: 'high' }, { id: 'fast', value: 'false' }] },
  { params: [{ id: 'effort', value: 'high' }, { id: 'fast', value: 'true' }], isDefault: true },
];
const VARIANTES_RAISONNEMENT = [
  { params: [{ id: 'context', value: '272k' }, { id: 'reasoning', value: 'none' }, { id: 'fast', value: 'false' }] },
  { params: [{ id: 'context', value: '272k' }, { id: 'reasoning', value: 'extra-high' }, { id: 'fast', value: 'false' }] },
];
const VARIANTES_OUI_NON = [
  { params: [{ id: 'thinking', value: 'false' }] },
  { params: [{ id: 'thinking', value: 'true' }], isDefault: true },
];

test('les niveaux de réflexion sont ceux du modèle, « sans réflexion » en tête', () => {
  assert.deepEqual(niveauxDeReflexionCursor(EFFORT), ['none', 'low', 'medium', 'high', 'xhigh']);
  // « extra-high » de Cursor devient le « xhigh » du reste de HaikoDev.
  assert.deepEqual(niveauxDeReflexionCursor(RAISONNEMENT), ['none', 'low', 'medium', 'high', 'xhigh']);
  // Un simple oui/non ne devient pas cinq niveaux imaginaires.
  assert.deepEqual(niveauxDeReflexionCursor(OUI_NON), ['none', 'medium']);
  assert.deepEqual(niveauxDeReflexionCursor([]), ['none']);
  assert.deepEqual(niveauxDeReflexionCursor(undefined), ['none']);
});

test('le niveau demandé part comme une COMBINAISON entière, jamais seul', () => {
  // Le niveau voulu, dans la combinaison que Cursor donne pour défaut.
  assert.deepEqual(paramsDeReflexionCursor({ variants: VARIANTES_EFFORT }, 'high'), [
    { id: 'effort', value: 'high' },
    { id: 'fast', value: 'true' },
  ]);
  // « xhigh » de HaikoDev retrouve « extra-high » chez Cursor, avec son contexte.
  assert.deepEqual(paramsDeReflexionCursor({ variants: VARIANTES_RAISONNEMENT }, 'xhigh'), [
    { id: 'context', value: '272k' },
    { id: 'reasoning', value: 'extra-high' },
    { id: 'fast', value: 'false' },
  ]);
  // Un oui/non : réfléchir vaut le niveau moyen, ne pas réfléchir vaut « none ».
  assert.deepEqual(paramsDeReflexionCursor({ variants: VARIANTES_OUI_NON }, 'medium'), [
    { id: 'thinking', value: 'true' },
  ]);
  assert.deepEqual(paramsDeReflexionCursor({ variants: VARIANTES_OUI_NON }, 'none'), [
    { id: 'thinking', value: 'false' },
  ]);
});

/** Un réglage que le modèle ne connaît pas ferait refuser la demande ENTIÈRE. */
test('un niveau inconnu du modèle n\'est pas envoyé', () => {
  assert.deepEqual(paramsDeReflexionCursor({ variants: VARIANTES_EFFORT }, 'max'), []);
  // Ce modèle-là n'a pas de « sans réflexion » : on n'en invente pas.
  assert.deepEqual(paramsDeReflexionCursor({ variants: VARIANTES_EFFORT }, 'none'), []);
  // Aucune combinaison connue : le modèle part avec son défaut.
  assert.deepEqual(paramsDeReflexionCursor({ parameters: EFFORT }, 'high'), []);
  assert.deepEqual(paramsDeReflexionCursor(undefined, 'high'), []);
});

test('la fenêtre de contexte se lit dans le paramètre « context »', () => {
  assert.equal(fenetreDeContexteCursor(RAISONNEMENT), 272_000);
  assert.equal(fenetreDeContexteCursor([{ id: 'context', values: [{ value: '1m' }] }]), 1_000_000);
  // Aucun paramètre : on ne devine pas une capacité.
  assert.equal(fenetreDeContexteCursor(EFFORT), undefined);
});

test('l\'adresse du dépôt est ramenée à une URL GitHub que Cursor accepte', () => {
  assert.equal(depotGithubPourCursor('git@github.com:haikostudio/haikodev.git'), 'https://github.com/haikostudio/haikodev');
  assert.equal(depotGithubPourCursor('https://github.com/haikostudio/haikodev.git\n'), 'https://github.com/haikostudio/haikodev');
  // Ni GitHub, ni adresse : aucun dépôt, et surtout aucune adresse inventée.
  assert.equal(depotGithubPourCursor('git@gitlab.com:org/depot.git'), null);
  assert.equal(depotGithubPourCursor(''), null);
  assert.equal(depotGithubPourCursor(undefined), null);
});

test('un refus est dit en français, jamais par un code nu', () => {
  assert.match(raisonDeRefusCursor(401, 'Invalid User API Key'), /refusé la clé/);
  assert.match(raisonDeRefusCursor(401), /refusé la clé/);
  assert.match(raisonDeRefusCursor(503), /indisponible/);
  assert.match(raisonDeRefusCursor(429), /limite les appels/);
  // Un code jamais vu se dit quand même, plutôt que de rester muet.
  assert.match(raisonDeRefusCursor(418, 'théière'), /418/);
});

/*
 * LE POINT QUI COMPTE : un statut INCONNU est terminal. Le traiter comme « en
 * cours » laisserait le témoin tourner pour toujours sur un tour mort — c'est
 * précisément le défaut que ce moteur ne doit pas introduire.
 */
test('un statut inconnu termine le tour au lieu de le laisser tourner', () => {
  assert.equal(issueDuRunCursor('RUNNING'), 'en-cours');
  assert.equal(issueDuRunCursor('CREATING'), 'en-cours');
  assert.equal(issueDuRunCursor('FINISHED'), 'reussi');
  assert.equal(issueDuRunCursor('CANCELLED'), 'arrete');
  assert.equal(issueDuRunCursor('ERROR'), 'echoue');
  assert.equal(issueDuRunCursor('CE_QUE_CURSOR_INVENTERA_DEMAIN'), 'echoue');
  // Pas encore de statut : le suivi commence, il ne conclut pas.
  assert.equal(issueDuRunCursor(''), 'en-cours');
  assert.equal(issueDuRunCursor(null), 'en-cours');
});

test('une fin anormale porte sa cause', () => {
  assert.match(messageDeFinCursor('CANCELLED'), /arrêté chez Cursor/);
  assert.match(messageDeFinCursor('ERROR', 'dépôt introuvable'), /dépôt introuvable/);
});

test('l\'attente entre deux lectures s\'allonge sans dépasser dix secondes', () => {
  assert.ok(attenteAvantRelecture(0) < attenteAvantRelecture(3));
  assert.ok(attenteAvantRelecture(50) <= 10_000);
});

test('le coût se lit en dollars, et une mesure absente le reste', () => {
  // Comparaison à la virgule près : une division par cent ne tombe pas juste
  // en binaire, et c'est le chiffre affiché qui compte, pas ses décimales.
  assert.ok(Math.abs((coutEnDollars(1.41122) ?? 0) - 0.0141122) < 1e-9);
  assert.equal(coutEnDollars(undefined), undefined);
  assert.equal(coutEnDollars('gratuit'), undefined);
});

/*
 * CURSOR SUIT LES RÈGLES DÉJÀ ÉCRITES, il ne s'en invente pas : sa consigne
 * système n'est pas un préfixe de session (comme Codex), et son fichier
 * d'instructions natif est `AGENTS.md`.
 */
test('Cursor prend sa place dans les règles communes aux moteurs', () => {
  assert.equal(consigneEnTeteDeSession('cursor'), false);
  assert.equal(consigneEnTeteDeSession('claude'), true);
  assert.equal(fichierNatif('cursor'), 'AGENTS.md');
});
