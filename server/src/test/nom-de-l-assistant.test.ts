import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  CONSIGNE_DE_LA_VOIX,
  MOTS_DU_MODELE_D_UNE_INSTALLATION_NEUVE,
  PRENOMS_SURS,
  consigneDeLaVoix,
  etapePassable,
  etapesDeLAssistant,
  motsInconnus,
  nomDeLAssistant,
  nomNettoye,
  nomTireDuReveil,
  nomsProches,
  phraseDAppel,
  phraseEcoutee,
  vocabulaireParForme,
  prenomNettoye,
  titreDeLAssistant,
} from '@beluga/shared';
import { symbolesDuGraphe } from '../modele-de-reveil.js';

/* Le nom de l'assistant et la phrase qui l'appelle (carte « En-tête collant et défilement des pages », 17/11/2026). */

test('le nom se reprend de l’ancien mot de réveil, mots d’appel retirés', () => {
  assert.equal(nomTireDuReveil('Dis Jarvis'), 'Jarvis');
  assert.equal(nomTireDuReveil('Dis jarvis'), 'Jarvis');
  assert.equal(nomTireDuReveil('Hey Nova'), 'Nova');
  assert.equal(nomTireDuReveil('ok   jarvis'), 'Jarvis');
  assert.equal(nomTireDuReveil('Jarvis'), 'Jarvis');
  assert.equal(nomTireDuReveil(''), 'Jarvis');
  assert.equal(nomTireDuReveil(null), 'Jarvis');
  assert.equal(nomTireDuReveil('Dis Haiko'), 'Jarvis', 'l’ancien défaut, jamais choisi, revient au défaut');
  assert.equal(nomTireDuReveil('Dis'), 'Jarvis');
});

test('le nom réglé passe avant l’ancien mot de réveil', () => {
  assert.equal(nomDeLAssistant({ assistantNom: 'Nova', voixReveil: 'Dis Jarvis' }), 'Nova');
  assert.equal(nomDeLAssistant({ assistantNom: '  ', voixReveil: 'Hey Alfred' }), 'Alfred');
  assert.equal(nomDeLAssistant(undefined), 'Jarvis');
});

test('la phrase d’appel et le titre découlent du nom', () => {
  assert.equal(phraseDAppel('Nova'), 'Dis Nova');
  assert.equal(titreDeLAssistant('Jarvis'), 'Assistant Jarvis');
  assert.equal(nomNettoye('  nova  '), 'Nova');
  assert.equal(nomNettoye('   '), null);
  assert.equal(prenomNettoye('  Chris  '), 'Chris');
});

test('un nom est entendu si chacun de ses mots, sans accent, est connu', () => {
  const vocabulaire = new Set(['jarvis', 'leon', 'nova']);
  const connu = (m: string) => vocabulaire.has(m);
  assert.deepEqual(motsInconnus('Jarvis', connu), []);
  assert.deepEqual(motsInconnus('Léon', connu), [], 'l’accent tombe comme dans la grammaire du réveil');
  assert.deepEqual(motsInconnus('Zorglub', connu), ['zorglub']);
});

test('un nom accentué dans le modèle est entendu, et le micro l’écoute sous la forme du modèle', () => {
  const parForme = vocabulaireParForme(['béluga', 'jarvis', 'leon', 'léon', '<eps>']);
  assert.equal(parForme.get('beluga'), 'béluga');
  assert.equal(parForme.get('leon'), 'leon', 'à forme égale, le mot sans accent l’emporte');
  const connu = (m: string) => parForme.has(m);
  assert.deepEqual(motsInconnus('Beluga', connu), []);
  assert.deepEqual(motsInconnus('Béluga', connu), []);
  assert.equal(phraseEcoutee({ assistantNom: 'Beluga', assistantMotsDuModele: ['béluga'] }), 'Dis béluga');
  assert.equal(phraseEcoutee({ assistantNom: 'Jarvis', assistantMotsDuModele: ['béluga'] }), 'Dis Jarvis', 'formes d’un autre nom : ignorées');
  assert.equal(phraseEcoutee({ assistantNom: 'Nova' }), 'Dis Nova');
});

test('trois noms proches, jamais le nom refusé lui-même', () => {
  const proches = nomsProches('Zorglub');
  assert.equal(proches.length, 3);
  for (const nom of proches) assert.ok(PRENOMS_SURS.includes(nom));
  assert.ok(proches.every((n) => n !== 'Zorglub'));
  assert.ok(nomsProches('Jarvis').every((n) => n !== 'Jarvis'));
  assert.equal(nomsProches('Zorglub')[0]?.[0], 'Z', 'même initiale d’abord');
});

test('la voix se présente sous son nom et connaît le prénom de la personne', () => {
  const consigne = consigneDeLaVoix('Nova', 'Chris');
  assert.match(consigne, /Ton nom est Nova/);
  assert.match(consigne, /« Dis Nova »/);
  assert.match(consigne, /s’appelle Chris/);
  assert.doesNotMatch(consigneDeLaVoix('Nova', ''), /s’appelle/);
  assert.match(CONSIGNE_DE_LA_VOIX, /Ton nom est Jarvis/);
});

test('la page « Votre assistant » est une étape nécessaire, juste après GitHub', () => {
  const etapes = etapesDeLAssistant(false);
  assert.ok(etapes.includes('assistant'));
  assert.equal(etapes.indexOf('assistant'), etapes.indexOf('projet') + 1);
  assert.equal(etapePassable('assistant'), false);
});

/** Un graphe OpenFst minimal : entête, puis sa table de mots — le format lu dans `Gr.fst`. */
function grapheDEssai(mots: string[]): Buffer {
  const morceaux: Buffer[] = [];
  const entier = (v: number) => {
    const b = Buffer.alloc(4);
    b.writeInt32LE(v);
    morceaux.push(b);
  };
  const long = (v: number) => {
    const b = Buffer.alloc(8);
    b.writeBigInt64LE(BigInt(v));
    morceaux.push(b);
  };
  const texte = (s: string) => {
    const b = Buffer.from(s, 'utf8');
    entier(b.length);
    morceaux.push(b);
  };
  entier(2125659606);
  texte('ngram');
  texte('standard');
  entier(4);
  entier(3);
  long(0);
  long(1);
  long(1);
  long(0);
  entier(2125658996);
  texte('words.txt');
  long(mots.length);
  long(mots.length);
  mots.forEach((m, i) => {
    texte(m);
    long(i);
  });
  return Buffer.concat(morceaux);
}

test('la table des mots se lit dans l’entête du graphe', () => {
  assert.deepEqual(symbolesDuGraphe(grapheDEssai(['<eps>', 'jarvis', 'léon'])), ['<eps>', 'jarvis', 'léon']);
  assert.throws(() => symbolesDuGraphe(Buffer.alloc(64)), /signature/);
});

test('dans le vrai modèle (s’il est là), Jarvis est entendu, Zorglub non, et chaque prénom sûr l’est', () => {
  const candidats = [
    path.join(process.cwd(), 'data', 'models', 'vosk-fr-small', 'vosk-model-small-fr-0.22.tar.gz'),
    '/root/beluga/data/models/vosk-fr-small/vosk-model-small-fr-0.22.tar.gz',
  ];
  const archive = candidats.find((c) => fs.existsSync(c));
  if (!archive) return; // modèle absent de cette machine : rien à juger
  const tar = zlib.gunzipSync(fs.readFileSync(archive));
  const debut = tar.indexOf(Buffer.from('graph/Gr.fst'));
  assert.ok(debut >= 0);
  const entete = Math.floor(debut / 512) * 512;
  const taille = parseInt(tar.toString('utf8', entete + 124, entete + 136).replace(/\0.*$/s, '').trim(), 8);
  const mots = new Set(symbolesDuGraphe(tar.subarray(entete + 512, entete + 512 + taille)));
  const connu = (m: string) => mots.has(m);
  assert.deepEqual(motsInconnus('Jarvis', connu), []);
  assert.deepEqual(motsInconnus('Dis', connu), []);
  assert.deepEqual(motsInconnus('Zorglub', connu), ['zorglub']);
  const parForme = vocabulaireParForme(mots);
  assert.deepEqual(motsInconnus('Beluga', (m) => parForme.has(m)), [], 'Beluga est entendu (« béluga » dans le modèle)');
  assert.ok(MOTS_DU_MODELE_D_UNE_INSTALLATION_NEUVE.every((m) => mots.has(m)), 'le nom d’une installation neuve est écrit comme le modèle l’écrit');
  for (const nom of PRENOMS_SURS) assert.deepEqual(motsInconnus(nom, connu), [], nom);
});
