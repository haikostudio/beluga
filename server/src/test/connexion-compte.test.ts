import test from 'node:test';
import assert from 'node:assert/strict';
import {
  commandeDeConnexion,
  connexionTerminee,
  etatDeConnexion,
  peutRenouvelerLaSession,
  lireInvite,
  nettoyerSortie,
  raisonDeSortie,
  refusCodeAppareil,
  validerAdresseDeRetour,
  messageAdresseRefusee,
  modeleRefuse,
  modeleDeRemplacement,
  modeleDeConfig,
  remplacerModeleDeConfig,
  issueDuControle,
} from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* La commande de chaque moteur                                        */
/* ------------------------------------------------------------------ */

test('Codex se connecte en mode « device » : une adresse et un code à saisir sur la page', () => {
  const commande = commandeDeConnexion('codex');
  assert.equal(commande.commande, 'codex');
  assert.deepEqual(commande.args, ['login', '--device-auth']);
  assert.equal(commande.variableDossier, 'CODEX_HOME');
  // Sans ce mode, Codex ouvrirait une page qui renvoie vers le serveur lui-même.
  assert.equal(commande.codeARecopier, false);
});

test('Claude ouvre une page et attend qu’on lui recopie un code', () => {
  const commande = commandeDeConnexion('claude');
  assert.equal(commande.commande, 'claude');
  assert.deepEqual(commande.args, ['auth', 'login']);
  assert.equal(commande.variableDossier, 'CLAUDE_CONFIG_DIR');
  assert.equal(commande.codeARecopier, true);
});

test('chaque moteur reçoit SA variable de coffre, jamais celle de l’autre', () => {
  assert.notEqual(commandeDeConnexion('codex').variableDossier, commandeDeConnexion('claude').variableDossier);
});

/* ------------------------------------------------------------------ */
/* Ce qu'on lit dans la sortie du moteur                               */
/* ------------------------------------------------------------------ */

const SORTIE_CODEX = [
  'Welcome to Codex [v[90m0.146.0[0m]',
  '',
  'Follow these steps to sign in with ChatGPT using device code authorization:',
  '',
  '1. Open this link in your browser and sign in to your account',
  '   [94mhttps://auth.openai.com/codex/device[0m',
  '',
  '2. Enter this one-time code [90m(expires in 15 minutes)[0m',
  '   [94m91QQ-7QZ8L[0m',
].join('\n');

const SORTIE_CLAUDE = [
  'Opening browser to sign in…',
  'If the browser didn’t open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a&state=In4X_VCz',
  'Paste code here if prompted > ',
].join('\n');

test('la sortie de Codex rend son adresse ET son code à usage unique', () => {
  const invite = lireInvite(SORTIE_CODEX);
  assert.equal(invite.lien, 'https://auth.openai.com/codex/device');
  assert.equal(invite.code, '91QQ-7QZ8L');
  // Codex attend tout seul : rien à lui renvoyer.
  assert.equal(invite.attendLeCode, false);
});

test('la sortie de Claude rend son adresse et réclame un code', () => {
  const invite = lireInvite(SORTIE_CLAUDE);
  assert.equal(
    invite.lien,
    'https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a&state=In4X_VCz',
  );
  assert.equal(invite.attendLeCode, true);
  // L'identifiant de client, dans l'adresse, ne doit pas passer pour un code.
  assert.equal(invite.code, undefined);
});

test('les couleurs et les liens cliquables du terminal sont retirés', () => {
  const propre = nettoyerSortie('[94mbonjour[0m');
  assert.equal(propre, 'bonjour');
  const lien = nettoyerSortie('visiter : ]8;;https://exemple.frexemple]8;;');
  assert.equal(lien, 'visiter : exemple');
});

test('une sortie encore vide ne raconte rien', () => {
  const invite = lireInvite('');
  assert.equal(invite.lien, undefined);
  assert.equal(invite.code, undefined);
  assert.equal(invite.attendLeCode, false);
});

test('la lecture est rejouable : le même texte rend toujours la même chose', () => {
  assert.deepEqual(lireInvite(SORTIE_CODEX), lireInvite(SORTIE_CODEX));
});

/* ------------------------------------------------------------------ */
/* La fin de course, dite en français                                  */
/* ------------------------------------------------------------------ */

test('une commande absente se dit, elle ne se tait pas', () => {
  const fin = raisonDeSortie({ code: null, introuvable: true });
  assert.equal(fin.ok, false);
  assert.match(fin.message, /introuvable sur le serveur/);
});

test('un abandon demandé et un délai dépassé ne disent pas la même chose', () => {
  assert.match(raisonDeSortie({ code: null, annulee: true }).message, /abandonnée à la demande/);
  assert.match(raisonDeSortie({ code: null, delaiDepasse: true }).message, /temps imparti/);
});

test('un refus du moteur porte sa dernière phrase utile, jamais l’adresse', () => {
  const fin = raisonDeSortie({
    code: 1,
    texte: 'https://auth.openai.com/codex/device\nlogin failed: code expired',
  });
  assert.equal(fin.ok, false);
  assert.match(fin.message, /code expired/);
  assert.doesNotMatch(fin.message, /https/);
});

test('une sortie à zéro est une réussite', () => {
  assert.deepEqual(raisonDeSortie({ code: 0, texte: 'ok' }), { ok: true, message: 'Compte connecté.' });
});

/* ------------------------------------------------------------------ */
/* L'état réel de la connexion d'un compte                             */
/* ------------------------------------------------------------------ */

test('un compte sans jeton demande à être connecté', () => {
  const etat = etatDeConnexion({ erreur: 'compte non connecté' });
  assert.equal(etat.etat, 'absente');
  assert.equal(etat.doitReconnecter, true);
});

test('un coffre sans fichier d’identifiants se dit « non connecté »', () => {
  // La lecture du quota échoue sur le fichier ABSENT, pas sur un jeton vide.
  const etat = etatDeConnexion({ erreur: "ENOENT: no such file or directory, open '/tmp/coffre/auth.json'" });
  assert.equal(etat.etat, 'absente');
  assert.equal(etat.libelle, 'non connecté');
  assert.equal(etatDeConnexion({ erreur: 'compte non connecté (aucune connexion dans son dossier)' }).etat, 'absente');
  assert.equal(etat.doitReconnecter, true);
});

test('un coffre vidé se dit « session expirée », pas « jamais connecté »', () => {
  // Le moteur efface lui-même ses jetons quand le renouvellement expire : le
  // fichier est là, le compte a servi la veille (Claude Pro, 30/08/2026).
  const etat = etatDeConnexion({ erreur: 'session expirée, reconnexion nécessaire', coffreVide: true });
  assert.equal(etat.etat, 'expiree');
  assert.equal(etat.libelle, 'session expirée');
  assert.equal(etat.doitReconnecter, true);
});

test('un jeton de renouvellement échu ferme la session, même sans erreur', () => {
  const etat = etatDeConnexion({ renouvellementExpireA: 1000, maintenant: 2000 });
  assert.equal(etat.etat, 'expiree');
  assert.equal(etat.doitReconnecter, true);
});

test('sans jeton de renouvellement, rien ne sert de relancer le moteur', () => {
  assert.equal(peutRenouvelerLaSession(undefined), false);
  assert.equal(peutRenouvelerLaSession({ refreshToken: '' }), false);
  assert.equal(peutRenouvelerLaSession({ refreshToken: 'abc', refreshTokenExpiresAt: 1000 }, 2000), false);
  assert.equal(peutRenouvelerLaSession({ refreshToken: 'abc', refreshTokenExpiresAt: 5000 }, 2000), true);
  // Sans échéance lisible, on tente : le renouvellement peut très bien passer.
  assert.equal(peutRenouvelerLaSession({ refreshToken: 'abc' }, 2000), true);
});

test('un refus du fournisseur demande une reconnexion', () => {
  assert.equal(etatDeConnexion({ erreur: 'lecture impossible (401)' }).etat, 'refusee');
  assert.equal(etatDeConnexion({ erreur: 'lecture impossible (403)' }).doitReconnecter, true);
});

test('un jeton échu se dit expiré, même sans erreur de lecture', () => {
  const etat = etatDeConnexion({ expireA: 1000, maintenant: 2000 });
  assert.equal(etat.etat, 'expiree');
  assert.equal(etat.doitReconnecter, true);
});

test('un jeton encore bon sur un compte qui répond est valide, sans bouton', () => {
  const etat = etatDeConnexion({ expireA: 5000, maintenant: 2000 });
  assert.equal(etat.etat, 'valide');
  assert.equal(etat.doitReconnecter, false);
});

test('une lecture de quota ratée ne pousse PAS à reconnecter un compte qui marche', () => {
  const etat = etatDeConnexion({ erreur: 'lecture momentanément indisponible' });
  assert.equal(etat.etat, 'inconnue');
  assert.equal(etat.doitReconnecter, false);
});

test('une tentative finie n’attend plus rien', () => {
  assert.equal(connexionTerminee({ etape: 'reussie' }), true);
  assert.equal(connexionTerminee({ etape: 'echec' }), true);
  assert.equal(connexionTerminee({ etape: 'attente' }), false);
  assert.equal(connexionTerminee({ etape: 'demarrage' }), false);
});

/* ------------------------------------------------------------------ */
/* La voie navigateur de Codex                                         */
/* ------------------------------------------------------------------ */

// Sortie mesurée sur codex-cli 0.146.0 (`codex login`, BROWSER=true).
const SORTIE_NAVIGATEUR = [
  'Starting local login server on http://localhost:1455.',
  'If your browser did not open, navigate to this URL to authenticate:',
  '',
  'https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_X&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&scope=openid&code_challenge=abc&code_challenge_method=S256&state=ETAT-123&originator=codex_cli_rs',
  '',
  'On a remote or headless machine? Use `codex login --device-auth` instead.',
].join('\n');

test('la voie navigateur lance `codex login` sans --device-auth, la voie par défaut reste le code d’appareil', () => {
  assert.deepEqual(commandeDeConnexion('codex', 'navigateur').args, ['login']);
  assert.deepEqual(commandeDeConnexion('codex').args, ['login', '--device-auth']);
});

test('voie navigateur : le lien est la page d’OpenAI, jamais le port local imprimé en premier', () => {
  const invite = lireInvite(SORTIE_NAVIGATEUR);
  assert.ok(invite.lien?.startsWith('https://auth.openai.com/oauth/authorize?'));
  assert.equal(invite.state, 'ETAT-123');
  assert.equal(invite.code, undefined);
});

test('le refus du code d’appareil est reconnu, l’invite de la voie navigateur n’en est pas un', () => {
  assert.ok(refusCodeAppareil('Error logging in with device code: device code login is not enabled for this Codex server. Use the browser login or verify the server URL.'));
  assert.ok(refusCodeAppareil('Enable device code authorization for Codex in ChatGPT Security Settings'));
  assert.ok(refusCodeAppareil("Activez la connexion par code d'appareil pour Codex"));
  assert.ok(!refusCodeAppareil(SORTIE_NAVIGATEUR));
});

test('une adresse de retour collée est acceptée telle qu’on la copie, et rend le seul chemin à rejouer', () => {
  for (const collee of [
    'http://localhost:1455/auth/callback?code=AB&state=ETAT-123',
    '  localhost:1455/auth/callback?code=AB&state=ETAT-123 \n',
    'http://127.0.0.1:1455/auth/callback?code=AB&state=ETAT-123',
  ]) {
    assert.deepEqual(validerAdresseDeRetour(collee, 'ETAT-123'), { ok: true, chemin: '/auth/callback?code=AB&state=ETAT-123' });
  }
});

test('une adresse ancienne, incomplète ou fausse est refusée avec sa raison', () => {
  const raison = (c: string, s = 'ETAT-123') => {
    const r = validerAdresseDeRetour(c, s);
    return r.ok ? 'ok' : r.raison;
  };
  assert.equal(raison(''), 'pas-une-adresse');
  assert.equal(raison('http://'), 'pas-une-adresse');
  assert.equal(raison('pas une adresse du tout'), 'pas-une-adresse');
  assert.equal(raison('localhost:1455/autre?code=A&state=ETAT-123'), 'mauvais-chemin');
  assert.equal(raison('localhost:1455/auth/callback?state=ETAT-123'), 'sans-code');
  assert.equal(raison('localhost:1455/auth/callback?code=A'), 'sans-state');
  assert.equal(raison('localhost:1455/auth/callback?code=A&state=VIEUX'), 'ancienne-tentative');
  // Sans tentative en cours, aucune adresse ne passe.
  assert.equal(raison('localhost:1455/auth/callback?code=A&state=ETAT-123', ''), 'ancienne-tentative');
  const refus = validerAdresseDeRetour('localhost:1455/auth/callback?error=access_denied&error_description=Refus%C3%A9', 'ETAT-123');
  assert.deepEqual(refus, { ok: false, raison: 'erreur-openai', detail: 'Refusé' });
  assert.match(messageAdresseRefusee('ancienne-tentative'), /connexion précédente/);
});

test('essai réel : le modèle refusé est remplacé par le premier modèle proposé du cache, la seule ligne touchée', () => {
  const sortie = "ERROR: {\"detail\":\"The 'gpt-5.5' model is not supported when using Codex with a ChatGPT account.\"}";
  assert.ok(modeleRefuse(sortie));
  const cache = { models: [{ slug: 'cache-x', visibility: 'hide' }, { slug: 'gpt-5.6-terra', visibility: 'list' }, { slug: 'gpt-5.6-luna', visibility: 'list' }] };
  assert.equal(modeleDeRemplacement(cache, 'gpt-5.5'), 'gpt-5.6-terra');
  assert.equal(modeleDeRemplacement(cache, 'gpt-5.6-terra'), 'gpt-5.6-luna');
  assert.equal(modeleDeRemplacement({}), undefined);
  const toml = 'model = "gpt-5.5"\nmodel_reasoning_effort = "high"\n\n[projects."/root"]\ntrust_level = "trusted"\nmodel = "garde"\n';
  assert.equal(modeleDeConfig(toml), 'gpt-5.5');
  const repare = remplacerModeleDeConfig(toml, 'gpt-5.6-terra');
  assert.equal(repare, toml.replace('model = "gpt-5.5"', 'model = "gpt-5.6-terra"'));
  assert.equal(remplacerModeleDeConfig('[a]\nb = 1\n', 'm'), 'model = "m"\n[a]\nb = 1\n');
});

test('l’issue de l’essai réel se dit en français, et seul un essai qui répond dit « opérationnel »', () => {
  assert.equal(issueDuControle({ code: 0, sortie: 'OK' }).message, 'Connecté et opérationnel.');
  assert.match(issueDuControle({ code: 1, sortie: '401 Unauthorized' }).message, /reconnectez/);
  assert.match(issueDuControle({ code: 1, sortie: "You've hit your usage limit" }).message, /quota/);
  assert.match(issueDuControle({ code: null, sortie: '', delaiDepasse: true }).message, /temps imparti/);
  assert.equal(issueDuControle({ code: 1, sortie: 'boom' }).ok, false);
});
