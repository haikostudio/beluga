import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ADRESSE_IP_NEUTRE,
  CORPS_DE_CLE_NEUTRE,
  IDENTITE_PUBLIQUE,
  IDENTITE_PUBLIQUE_MAIL,
  adresseIpPublique,
  examinerIdentites,
  examinerTexte,
  expressionsPourFilterRepo,
  filtrerTexte,
  ipsPubliquesDesInterfaces,
  recitDesRestes,
  reglesDeFiltre,
} from '@beluga/shared';

/*
 * LES VALEURS D'ESSAI SONT DES ADRESSES DE DOCUMENTATION. Ce fichier part au
 * miroir public comme le reste du code : il ne porte aucune vraie valeur, et
 * les formes de secrets s'y écrivent en morceaux pour ne pas se reconnaître.
 */
const VALEURS = {
  ips: ['192.0.2.44'],
  adresses: ['personne@exemple.test'],
  remplacements: [{ valeur: 'compte-de-sauvegarde-42', neutre: 'compte-000' }],
  interdits: ['phrase-interdite'],
  listeBlanche: ['contact@exemple.test'],
};
const regles = reglesDeFiltre(VALEURS);
const DEBUT = '-----BEGIN ' + 'OPENSSH PRIVATE KEY-----';
const FIN = '-----END ' + 'OPENSSH PRIVATE KEY-----';

test('une adresse IP réelle devient une adresse de documentation, pas une adresse plus longue', () => {
  const r = filtrerTexte('placeholder="ex. 192.0.2.44" et 192.0.2.445 et 1192.0.2.44', regles, 'page.tsx');
  assert.equal(r.texte, `placeholder="ex. ${ADRESSE_IP_NEUTRE}" et 192.0.2.445 et 1192.0.2.44`);
  assert.equal(r.remplacements, 1);
  assert.deepEqual(r.restes, []);
});

test('une adresse personnelle devient l’identité publique, la liste blanche reste telle quelle', () => {
  const r = filtrerTexte('Écrire à Personne@exemple.test ou à contact@exemple.test', regles);
  assert.equal(r.texte, `Écrire à ${IDENTITE_PUBLIQUE_MAIL} ou à contact@exemple.test`);
  assert.deepEqual(r.restes, []);
});

test('un vrai corps de clé privée est neutralisé, et le séparateur écrit « \\n » d’une chaîne de code est gardé', () => {
  const code = `const cle = '${DEBUT}\\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmU0123\\n${FIN}';`;
  const r = filtrerTexte(code, regles, 'donnees.ts');
  assert.equal(r.texte, `const cle = '${DEBUT}\\n${CORPS_DE_CLE_NEUTRE}\\n${FIN}';`);
  assert.equal(r.remplacements, 1);
  assert.deepEqual(r.restes, []);

  const pem = `${DEBUT}\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmU0123\n${FIN}\n`;
  assert.equal(filtrerTexte(pem, regles).texte, `${DEBUT}\n${CORPS_DE_CLE_NEUTRE}\n${FIN}\n`);
});

test('une clé factice de démonstration n’est ni remplacée ni refusée', () => {
  const demo = `cle: '${DEBUT}\\nDEMONSTRATION\\n${FIN}', jeton: 'ghp_DEMONSTRATION0000000'`;
  const r = filtrerTexte(demo, regles, 'demo.js');
  assert.equal(r.texte, demo);
  assert.equal(r.remplacements, 0);
  assert.deepEqual(r.restes, []);
});

test('un vrai jeton refuse l’envoi et nomme le fichier, la ligne et le motif, sans recopier le secret', () => {
  const jeton = 'ghp_' + 'A1b2'.repeat(9);
  const r = filtrerTexte(`première ligne\nconst t = "${jeton}";\n`, regles, 'scripts/envoi.mjs');
  assert.equal(r.restes.length, 1);
  assert.equal(r.restes[0].chemin, 'scripts/envoi.mjs');
  assert.equal(r.restes[0].ligne, 2);
  assert.equal(r.restes[0].motif, 'jeton GitHub');
  assert.ok(!r.restes[0].extrait.includes(jeton));
  assert.match(recitDesRestes(r.restes), /scripts\/envoi\.mjs:2 — jeton GitHub/);
});

test('une clé privée sans fin, une valeur interdite ou une clé d’API refusent l’envoi', () => {
  assert.equal(filtrerTexte(`${DEBUT}\nabc`, regles).restes[0]?.motif, 'clé privée');
  assert.equal(filtrerTexte('voir la phrase-interdite ici', regles).restes[0]?.motif, 'valeur interdite');
  assert.equal(
    filtrerTexte('cle sk-' + 'proj-abcdefghij0123456789abcdefghij', regles).restes[0]?.motif,
    'clé d’API',
  );
});

test('une valeur déclarée prend sa forme neutre, un chemin système générique reste tel quel', () => {
  const r = filtrerTexte('ex. /root/' + '.ssh/id_ed25519 sur compte-de-sauvegarde-42, voir /etc/beluga.env', regles);
  assert.equal(r.texte, 'ex. /root/' + '.ssh/id_ed25519 sur compte-000, voir /etc/beluga.env');
  assert.deepEqual(r.restes, []);
});

test('examiner un texte déjà enregistré compte aussi ce qui aurait été remplacé', () => {
  const restes = examinerTexte('serveur 192.0.2.44\nmail personne@exemple.test', regles, 'docs.md');
  assert.deepEqual(
    restes.map((r) => [r.ligne, r.motif]),
    [
      [1, 'adresse IP réelle'],
      [2, 'adresse personnelle'],
    ],
  );
  assert.deepEqual(examinerTexte(`${DEBUT}\\nDEMONSTRATION\\n${FIN}`, regles), []);
});

test('chaque fichier garde son contenu filtré, un binaire reste intact', () => {
  const texte = filtrerTexte('ip 192.0.2.44', regles, 'a.js');
  assert.equal(texte.remplacements, 1);
  assert.equal(texte.texte, `ip ${ADRESSE_IP_NEUTRE}`);
  assert.deepEqual(texte.restes, []);
  const image = filtrerTexte('PNG\u0000192.0.2.44', regles, 'image.png');
  assert.equal(image.remplacements, 0);
  assert.equal(image.texte, 'PNG\u0000192.0.2.44');
});

test('seule l’identité publique est admise sur un commit public', () => {
  assert.deepEqual(examinerIdentites([IDENTITE_PUBLIQUE, IDENTITE_PUBLIQUE], regles), []);
  const restes = examinerIdentites(['Quelqu’un <personne@exemple.test>'], regles);
  assert.equal(restes.length, 1);
  assert.equal(restes[0].motif, 'identité git non neutre');
  assert.ok(!restes[0].extrait.includes('personne@exemple.test'));
});

test('les adresses de la machine : seules les publiques sont retenues', () => {
  assert.equal(adresseIpPublique('10.0.0.3'), false);
  assert.equal(adresseIpPublique('172.20.1.1'), false);
  assert.equal(adresseIpPublique('192.0.2.44'), false);
  assert.equal(adresseIpPublique('8.8.8.8'), true);
  assert.deepEqual(
    ipsPubliquesDesInterfaces({
      lo: [{ address: '127.0.0.1', internal: true }],
      eth0: [
        { address: '8.8.4.4' },
        { address: 'fe80::1%eth0' },
        { address: '2a01:4f8::1' },
      ],
      docker0: [{ address: '172.17.0.1' }],
    }),
    ['8.8.4.4', '2a01:4f8::1'],
  );
});

test('les expressions de filter-repo reprennent les remplacements littéraux', () => {
  const lignes = expressionsPourFilterRepo(VALEURS).trim().split('\n');
  assert.ok(lignes.includes(`192.0.2.44==>${ADRESSE_IP_NEUTRE}`));
  assert.ok(lignes.includes(`personne@exemple.test==>${IDENTITE_PUBLIQUE_MAIL}`));
  assert.ok(lignes.includes('compte-de-sauvegarde-42==>compte-000'));
});

test('le filtre ne se reconnaît pas lui-même : ses règles partent au public sans reste', () => {
  const source = fs.readFileSync(new URL('../../../shared/src/filtre-contenu.ts', import.meta.url), 'utf8');
  assert.deepEqual(filtrerTexte(source, reglesDeFiltre({}), 'filtre-contenu.ts').restes, []);
  const essai = fs.readFileSync(new URL('../../src/test/filtre-contenu.test.ts', import.meta.url), 'utf8');
  assert.deepEqual(filtrerTexte(essai, reglesDeFiltre({}), 'filtre-contenu.test.ts').restes, []);
});
