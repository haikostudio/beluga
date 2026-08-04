import test from 'node:test';
import assert from 'node:assert/strict';
import {
  commandeDeConnexion,
  connexionTerminee,
  etatDeConnexion,
  lireInvite,
  nettoyerSortie,
  raisonDeSortie,
} from '@haikodev/shared';

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

test('un coffre sans fichier d’identifiants compte comme jamais connecté', () => {
  // La lecture du quota échoue sur le fichier ABSENT, pas sur un jeton vide.
  const etat = etatDeConnexion({ erreur: "ENOENT: no such file or directory, open '/tmp/coffre/auth.json'" });
  assert.equal(etat.etat, 'absente');
  assert.equal(etat.doitReconnecter, true);
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
