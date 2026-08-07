import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AccesVps,
  accesDepuisReglages,
  accesRenseignes,
  argumentsSsh,
  citerShell,
  commandeDistante,
  messageErreurSsh,
} from '@haikodev/shared';

const base: AccesVps = { hote: '', port: 22, utilisateur: '', moyen: 'agent', cle: '', motDePasse: '' };

/* ------------------------------------------------------------------ */
/* Renseignés ou non : c'est ce qui décide local ou distant            */
/* ------------------------------------------------------------------ */

test('accès vides = pas renseignés : le chemin local tient', () => {
  assert.equal(accesRenseignes(base), false);
});

test('il faut une adresse ET un utilisateur pour joindre une machine', () => {
  assert.equal(accesRenseignes({ ...base, hote: '10.0.0.1' }), false);
  assert.equal(accesRenseignes({ ...base, utilisateur: 'root' }), false);
  assert.equal(accesRenseignes({ ...base, hote: '10.0.0.1', utilisateur: 'root' }), true);
});

test('les réglages à plat se lisent en accès, avec des défauts sensés', () => {
  const acces = accesDepuisReglages({
    vpsHote: '10.0.0.1',
    vpsPort: 2222,
    vpsUtilisateur: 'root',
    vpsMoyen: 'cle',
    vpsCle: '/root/.ssh/id_ed25519',
    vpsMotDePasse: '',
  });
  assert.equal(acces.hote, '10.0.0.1');
  assert.equal(acces.port, 2222);
  assert.equal(acces.moyen, 'cle');
});

/* ------------------------------------------------------------------ */
/* La ligne de commande distante                                       */
/* ------------------------------------------------------------------ */

test('chaque morceau est entre guillemets simples : une espace ou un heredoc ne casse rien', () => {
  assert.equal(citerShell('abc'), `'abc'`);
  assert.equal(citerShell("l'ourse"), `'l'\\''ourse'`);
  assert.equal(commandeDistante(['echo', 'a b']), `'echo' 'a b'`);
});

test('clés en place : ssh en BatchMode, sans -i', () => {
  const { programme, args } = argumentsSsh({ ...base, hote: '10.0.0.1', utilisateur: 'root' }, 'echo ok');
  assert.equal(programme, 'ssh');
  assert.ok(args.includes('-o'));
  assert.ok(args.includes('BatchMode=yes'));
  assert.ok(!args.includes('-i'));
  assert.equal(args.at(-2), 'root@10.0.0.1');
  assert.equal(args.at(-1), 'echo ok');
});

test('fichier de clé : le chemin part en -i', () => {
  const { args } = argumentsSsh(
    { ...base, hote: '10.0.0.1', utilisateur: 'root', moyen: 'cle', cle: '/k' },
    'echo ok',
  );
  const i = args.indexOf('-i');
  assert.ok(i >= 0);
  assert.equal(args[i + 1], '/k');
});

test('mot de passe : sshpass fournit le mot de passe, sans BatchMode', () => {
  const { programme, args } = argumentsSsh(
    { ...base, hote: '10.0.0.1', utilisateur: 'root', moyen: 'mot-de-passe', motDePasse: 'secret' },
    'echo ok',
  );
  assert.equal(programme, 'sshpass');
  assert.equal(args[0], '-p');
  assert.equal(args[1], 'secret');
  assert.equal(args[2], 'ssh');
  assert.ok(!args.includes('BatchMode=yes'));
});

/* ------------------------------------------------------------------ */
/* La panne se dit en français                                         */
/* ------------------------------------------------------------------ */

test('un refus d’identifiants est nommé', () => {
  assert.match(messageErreurSsh('Permission denied (publickey,password).'), /refusée/);
});

test('une adresse introuvable est nommée', () => {
  assert.match(messageErreurSsh('ssh: Could not resolve hostname zzz: Name or service not known'), /introuvable/);
});

test('sshpass absent renvoie vers un autre moyen', () => {
  assert.match(messageErreurSsh('/bin/sh: sshpass: command not found'), /sshpass/);
});
