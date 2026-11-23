import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LIMITE_FRAPPE,
  RELAIS_TERMINAL,
  ROUTE_TERMINAL,
  SESSION_TERMINAL,
  TAILLE_TERMINAL,
  argumentsAttache,
  argumentsCreationSession,
  argumentsSessionExiste,
  argumentsSuiviDeTaille,
  argumentsPressePapiers,
  texteDuPressePapiers,
  choisirLeCompteDuTerminal,
  commandeDuMoteurDuTerminal,
  decoderSortie,
  encoderSortie,
  estMaxX20,
  ligneDeTaille,
  lireMessageDuTerminal,
  tailleDeTerminal,
} from '@beluga/shared';

test('la session partagée porte un nom fixe, et sa voie est à part', () => {
  assert.equal(SESSION_TERMINAL, 'beluga');
  assert.equal(ROUTE_TERMINAL, '/ws/terminal');
  // La voie du terminal reste sous `/ws` : c'est ce préfixe qui passe le mur
  // d'accès dans `attachWebSocket`.
  assert.ok(ROUTE_TERMINAL.startsWith('/ws'));
});

test('une taille hors bornes est ramenée dedans, jamais refusée', () => {
  assert.deepEqual(tailleDeTerminal(1, 1), {
    colonnes: TAILLE_TERMINAL.colonnesMin,
    lignes: TAILLE_TERMINAL.lignesMin,
  });
  assert.deepEqual(tailleDeTerminal(9000, 9000), {
    colonnes: TAILLE_TERMINAL.colonnesMax,
    lignes: TAILLE_TERMINAL.lignesMax,
  });
  // Un navigateur qui mesure mal (NaN) retombe sur la taille d'un terminal nu.
  assert.deepEqual(tailleDeTerminal(Number.NaN, undefined), { colonnes: 80, lignes: 24 });
  assert.deepEqual(tailleDeTerminal(120.6, 40.2), { colonnes: 121, lignes: 40 });
});

test('LES OCTETS DU TERMINAL VOYAGENT ENTIERS, ACCENTS COMPRIS', () => {
  // Le cas qui casse tout si la sortie est décodée en texte trop tôt : « é »
  // occupe deux octets, et le tuyau peut couper entre les deux.
  const phrase = new TextEncoder().encode('accent : été — ✓ 中文');
  assert.deepEqual(decoderSortie(encoderSortie(phrase)), phrase);

  // Coupé en plein milieu d'un caractère, chaque moitié reste elle-même : c'est
  // l'afficheur qui recolle, et il ne le peut que si rien n'a été remplacé par
  // un « ? » en route.
  const debut = phrase.slice(0, 11);
  const fin = phrase.slice(11);
  assert.deepEqual(decoderSortie(encoderSortie(debut)), debut);
  assert.deepEqual(decoderSortie(encoderSortie(fin)), fin);

  // Les trois restes possibles de la découpe par trois octets.
  for (const taille of [0, 1, 2, 3, 4, 5]) {
    const morceau = phrase.slice(0, taille);
    assert.deepEqual(decoderSortie(encoderSortie(morceau)), morceau, `taille ${taille}`);
  }
});

test('un message du navigateur qui n’est pas exactement attendu est refusé', () => {
  assert.deepEqual(lireMessageDuTerminal('pas du json'), { ok: false, refus: 'message illisible' });
  assert.deepEqual(lireMessageDuTerminal('"texte nu"'), { ok: false, refus: 'message illisible' });
  assert.deepEqual(lireMessageDuTerminal('{"type":"exec","cmd":"rm"}'), { ok: false, refus: 'message inconnu' });
  assert.deepEqual(lireMessageDuTerminal('{"type":"frappe"}'), { ok: false, refus: 'frappe sans texte' });
});

test('UNE FRAPPE TROP LONGUE EST REFUSÉE EN ENTIER, JAMAIS TRONQUÉE', () => {
  // Tronquer aurait exécuté une demi-commande : le refus se dit, et rien ne part.
  const collage = 'x'.repeat(LIMITE_FRAPPE + 1);
  const lecture = lireMessageDuTerminal(JSON.stringify({ type: 'frappe', donnees: collage }));
  assert.equal(lecture.ok, false);
  assert.match(lecture.ok ? '' : lecture.refus, /trop longue/);

  // À la limite exacte, ça passe.
  const juste = lireMessageDuTerminal(JSON.stringify({ type: 'frappe', donnees: 'x'.repeat(LIMITE_FRAPPE) }));
  assert.equal(juste.ok, true);
});

test('une frappe ordinaire passe telle quelle, touches de contrôle comprises', () => {
  const lecture = lireMessageDuTerminal(JSON.stringify({ type: 'frappe', donnees: '' }));
  assert.deepEqual(lecture, { ok: true, message: { type: 'frappe', donnees: '' } });
});

test('une taille reçue est bornée avant d’aller plus loin', () => {
  const lecture = lireMessageDuTerminal(JSON.stringify({ type: 'taille', colonnes: 9999, lignes: 2 }));
  assert.deepEqual(lecture, {
    ok: true,
    message: { type: 'taille', colonnes: TAILLE_TERMINAL.colonnesMax, lignes: TAILLE_TERMINAL.lignesMin },
  });
});

test('rien ne passe par un interpréteur de commandes', () => {
  // Les arguments partent en TABLEAU : aucune chaîne assemblée, donc aucune
  // porte par laquelle un caractère de shell pourrait entrer.
  assert.deepEqual(argumentsCreationSession('beluga', 120, 40), [
    'new-session',
    '-d',
    '-s',
    'beluga',
    '-x',
    '120',
    '-y',
    '40',
  ]);
  // Le coffre du compte passe par `-e` : tmux est un SERVEUR, et l'environnement
  // du processus qui appelle n'atteint PAS le shell d'une session créée après.
  assert.deepEqual(argumentsCreationSession('beluga', 120, 40, { CLAUDE_CONFIG_DIR: '/data/accounts/max' }), [
    'new-session',
    '-d',
    '-s',
    'beluga',
    '-x',
    '120',
    '-y',
    '40',
    '-e',
    'CLAUDE_CONFIG_DIR=/data/accounts/max',
  ]);
  // Une valeur vide ne pose rien : mieux vaut l'absence qu'un chemin nul.
  assert.deepEqual(argumentsCreationSession('beluga', 120, 40, { CLAUDE_CONFIG_DIR: '' }).length, 8);
  assert.deepEqual(argumentsSessionExiste('beluga'), ['has-session', '-t', 'beluga']);
  // La fenêtre suit le DERNIER écran actif, pas le plus petit : un téléphone
  // oublié dans un onglet ne bride plus l'ordinateur.
  assert.deepEqual(argumentsSuiviDeTaille('beluga'), ['set-option', '-t', 'beluga', 'window-size', 'latest']);

  const attache = argumentsAttache('beluga', 120, 40, RELAIS_TERMINAL);
  assert.equal(attache.commande, 'python3');
  assert.deepEqual(attache.arguments, [RELAIS_TERMINAL, 'beluga', '120', '40']);
});

test('la nouvelle taille part au relais en une ligne terminée', () => {
  assert.equal(ligneDeTaille(120, 40), '120x40\n');
});

test('le terminal part sur le compte Claude au palier Max x20', () => {
  const comptes = [
    { id: 'claude-principal', engine: 'claude', label: 'Claude — principal', plan: 'Pro' },
    { id: 'claude-max', engine: 'claude', label: 'Claude — Max x20', plan: 'Max x20' },
    { id: 'codex-principal', engine: 'codex', label: 'Codex', plan: 'Plus' },
  ];
  const choix = choisirLeCompteDuTerminal(comptes);
  assert.equal(choix.compte?.id, 'claude-max');
  assert.equal(choix.raison, 'palier');
  assert.equal(choix.avertissement, undefined);
});

test('un choix fait à la main l’emporte sur le palier', () => {
  const comptes = [
    { id: 'claude-principal', engine: 'claude', label: 'Claude — principal', plan: 'Pro' },
    { id: 'claude-max', engine: 'claude', label: 'Claude — Max x20', plan: 'Max x20' },
  ];
  const choix = choisirLeCompteDuTerminal(comptes, 'claude-principal');
  assert.equal(choix.compte?.id, 'claude-principal');
  assert.equal(choix.raison, 'demande');
});

test('un compte Codex choisi à la main fait tourner le terminal, et son moteur s’y lance', () => {
  const comptes = [
    { id: 'claude-max', engine: 'claude', label: 'Claude — Max x20', plan: 'Max x20' },
    { id: 'codex-principal', engine: 'codex', label: 'Codex', plan: 'Plus' },
    { id: 'codex-eteint', engine: 'codex', label: 'Codex 2', disabled: true },
  ];
  const choix = choisirLeCompteDuTerminal(comptes, 'codex-principal');
  assert.equal(choix.compte?.id, 'codex-principal');
  assert.equal(choix.raison, 'demande');
  assert.equal(choisirLeCompteDuTerminal(comptes, 'codex-eteint').compte?.id, 'claude-max', 'éteint : retombe sur le Max x20');
  assert.equal(commandeDuMoteurDuTerminal('codex'), 'codex');
  assert.equal(commandeDuMoteurDuTerminal('claude'), 'claude');
  assert.equal(commandeDuMoteurDuTerminal('cursor'), null);
  assert.equal(commandeDuMoteurDuTerminal(undefined), null);
});

test('un compte demandé qui n’existe plus retombe sur le Max x20, et le DIT', () => {
  const comptes = [{ id: 'claude-max', engine: 'claude', label: 'Claude — Max x20', plan: 'Max x20' }];
  const choix = choisirLeCompteDuTerminal(comptes, 'compte-retire');
  assert.equal(choix.compte?.id, 'claude-max');
  assert.ok(choix.avertissement?.includes('Max x20'));
});

test('un compte éteint ou d’un autre moteur ne prend jamais le terminal', () => {
  const comptes = [
    { id: 'claude-max', engine: 'claude', label: 'Claude — Max x20', plan: 'Max x20', disabled: true },
    { id: 'codex-max', engine: 'codex', label: 'Codex', plan: 'Max x20' },
  ];
  const choix = choisirLeCompteDuTerminal(comptes);
  assert.equal(choix.compte, undefined);
  assert.equal(choix.raison, 'aucun');
  // L'absence se DIT : le terminal ne retombe jamais en silence sur le coffre
  // du compte système.
  assert.ok(choix.avertissement && choix.avertissement.length > 0);
  assert.equal(choisirLeCompteDuTerminal([], undefined).raison, 'aucun');
});

test('le palier Max x20 se reconnaît quelle que soit son écriture', () => {
  assert.ok(estMaxX20('Max x20'));
  assert.ok(estMaxX20('max20'));
  assert.ok(estMaxX20('claude_20x'));
  assert.ok(!estMaxX20('Max x5'));
  assert.ok(!estMaxX20('Pro'));
  assert.ok(!estMaxX20(undefined));
});

test('le choix de compte est un message reconnu, et un identifiant tordu est refusé', () => {
  const bon = lireMessageDuTerminal(JSON.stringify({ type: 'compte', id: 'claude-max' }));
  assert.ok(bon.ok && bon.message.type === 'compte' && bon.message.id === 'claude-max');
  assert.ok(!lireMessageDuTerminal(JSON.stringify({ type: 'compte', id: '../../etc' })).ok);
  assert.ok(!lireMessageDuTerminal(JSON.stringify({ type: 'compte' })).ok);
});

test('le presse-papiers : la session peut écrire, jamais lire', () => {
  assert.deepEqual(argumentsPressePapiers(), ['set-option', '-s', 'set-clipboard', 'on']);
  const b64 = Buffer.from('bonjour é', 'utf8').toString('base64');
  assert.equal(texteDuPressePapiers(`c;${b64}`), 'bonjour é');
  assert.equal(texteDuPressePapiers(`;${b64}`), 'bonjour é');
  assert.equal(texteDuPressePapiers('c;?'), null);
  assert.equal(texteDuPressePapiers('c;'), null);
  assert.equal(texteDuPressePapiers('pas de séparateur'), null);
  assert.equal(texteDuPressePapiers('c;***'), null);
});
