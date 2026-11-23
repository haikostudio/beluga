import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ATTENTE_DE_REPONSE_MAX_MS,
  CONSIGNE_DE_LA_VOIX,
  consigneDeLaVoix,
  DELAI_VEILLE_MS,
  demandeDeFin,
  demandeDeVeille,
  debutDuMotDeReveil,
  formeSonore,
  grammaireDuReveil,
  MOTS_LEURRES,
  motsDuReveil,
  normaliserParole,
  retourEnVeilleDu,
} from '@beluga/shared';

/*
 * LE MOT DE RÉVEIL ET LA VEILLE DU MODULE DE VOIX (carte « Veille privée et réveil « Dis Jarvis » »). Le mot est
 * reconnu SUR L'APPAREIL par une reconnaissance à grammaire restreinte : ces règles disent quoi lui demander,
 * comment lire son résultat, et quand la conversation se referme.
 */

test('la grammaire attend la phrase, ses mots, les mots LEURRES, et le reste en inconnu', () => {
  assert.deepEqual(motsDuReveil('Dis, Jarvis !'), ['dis', 'jarvis']);
  const g = JSON.parse(grammaireDuReveil('Dis Jarvis'));
  assert.deepEqual(g.slice(0, 3), ['dis jarvis', 'dis', 'jarvis']);
  assert.equal(g.at(-1), '[unk]');
  // Les mots qui se faisaient prendre pour « Jarvis » ont leur place (mesure du 16/11/2026).
  for (const leurre of ['devis', 'janvier', 'marvin']) assert.ok(g.includes(leurre), leurre);
  assert.equal(new Set(g).size, g.length);
  assert.ok(!MOTS_LEURRES.includes('jarvis'));
});

test('le réveil exige la phrase entière, dans l’ordre, et des mots SÛRS', () => {
  const mots = (...l: Array<[string, number]>) => l.map(([word, conf], i) => ({ word, conf, start: i, end: i + 0.5 }));
  assert.equal(debutDuMotDeReveil(mots(['dis', 1], ['jarvis', 1]), 'Dis Jarvis'), 0);
  assert.equal(debutDuMotDeReveil(mots(['jarvis', 1]), 'Dis Jarvis'), null);
  assert.equal(debutDuMotDeReveil(mots(['jarvis', 1], ['dis', 1]), 'Dis Jarvis'), null);
  assert.equal(debutDuMotDeReveil(mots(['dis', 1], ['[unk]', 1], ['jarvis', 1]), 'Dis Jarvis'), null);
  // Un mot douteux ne réveille pas.
  assert.equal(debutDuMotDeReveil(mots(['dis', 0.6], ['jarvis', 1]), 'Dis Jarvis'), null);
  assert.equal(debutDuMotDeReveil(mots(['dis', 1], ['jarvis', 0.5]), 'Dis Jarvis'), null);
});

test('la frontière est le DÉBUT du dernier mot de réveil : rien d’avant ne part', () => {
  const resultat = [
    { word: 'dis', start: 0.4, end: 0.6 },
    { word: 'jarvis', start: 0.6, end: 1.1 },
    { word: '[unk]', start: 1.3, end: 1.8 },
    { word: 'dis', start: 2.0, end: 2.2 },
    { word: 'jarvis', start: 2.2, end: 2.7 },
    { word: '[unk]', start: 2.9, end: 3.4 },
  ];
  assert.equal(debutDuMotDeReveil(resultat, 'Dis Jarvis'), 2.0);
  assert.equal(debutDuMotDeReveil(resultat.slice(2, 3), 'Dis Jarvis'), null);
});

test('« mets-toi en veille » et ses variantes demandent la veille', () => {
  for (const dit of [
    'Mets-toi en veille.',
    'met toi en veille',
    'Jarvis, mets-toi en veille s’il te plaît',
    'passe en veille',
    'Va en veille',
    'Mettez-vous en veille',
    'mets toi en vieille',
    // Carte « Relier Beluga Pass dans les réglages » : sans verbe, ou avec un verbe de plus (DISC-0007).
    'Ok, mais toi, en veille',
    'Ok mais toi en veille.',
    'Jarvis, en veille',
    'En veille.',
    'en veille s’il te plaît',
    'Mode veille',
    'passe en mode veille',
    'tu peux te mettre en veille',
    'Tu peux passer en veille maintenant',
    'retourne en veille',
    'reste en veille',
    'remets-toi en veille',
    'Jarvis, veille',
  ]) {
    assert.ok(demandeDeVeille(dit), `« ${dit} » doit remettre en veille`);
  }
});

test('une phrase qui parle de veille sans la demander ne ferme rien', () => {
  for (const dit of [
    'le serveur est en veille',
    'mets la machine en veille',
    'la veille de Noël',
    'la veille au soir, le site est tombé',
    'veille sur le serveur',
    'le site est en mode veille',
    'mets le serveur en mode veille',
    'je veille sur les tâches',
    'il faut que tu veilles à la facture',
    'est-ce que l’écran est en veille',
    'c’est en veille',
    'quelles tâches sont en cours',
    '',
  ]) {
    assert.ok(!demandeDeVeille(dit), `« ${dit} » ne doit pas remettre en veille`);
  }
});

test('le silence referme la conversation après 30 s, plus tard si une réponse est attendue', () => {
  assert.equal(DELAI_VEILLE_MS, 30_000);
  assert.ok(!retourEnVeilleDu(29_999, 0, false));
  assert.ok(retourEnVeilleDu(30_000, 0, false));
  assert.ok(!retourEnVeilleDu(60_000, 0, true));
  assert.ok(retourEnVeilleDu(ATTENTE_DE_REPONSE_MAX_MS, 0, true));
});

test('le salut « Salut <prénom>, je t’écoute. » est dit par Beluga, et la voix ne le redit pas (18/11/2026)', () => {
  assert.match(CONSIGNE_DE_LA_VOIX, /« Salut, je t’écoute\. »/);
  assert.match(consigneDeLaVoix('Jarvis', 'Camille'), /TON SALUT EST DIT PAR BELUGA à l’ouverture \(« Salut Camille, je t’écoute\. »\) : ne le redis jamais/);
  assert.doesNotMatch(consigneDeLaVoix('Jarvis', 'Camille', { reprise: true }), /« Oui \? »/);
  assert.match(consigneDeLaVoix('Jarvis', 'Camille', { reprise: true }), /LA LIGNE VIENT DE SE RÉTABLIR/);
  assert.doesNotMatch(consigneDeLaVoix('Jarvis', 'Camille'), /LA LIGNE VIENT DE SE RÉTABLIR/);
  assert.match(CONSIGNE_DE_LA_VOIX, /Jarvis/);
  assert.match(CONSIGNE_DE_LA_VOIX, /veille/);
});

test('la forme sonore ramène deux orthographes du même son au même mot', () => {
  assert.equal(formeSonore('Dis Haiko'), 'dieko');
  assert.equal(formeSonore('Dièco'), 'dieko');
  assert.equal(formeSonore('10 écho'), 'dieko');
  assert.equal(formeSonore('et'), 'e');
});

test('la normalisation efface accents, majuscules et ponctuation', () => {
  assert.equal(normaliserParole('Dis, Jarvïs !'), 'dis jarvis');
  assert.equal(normaliserParole('  ÉCOUTE—moi  '), 'ecoute moi');
});

test('la phrase de fin ferme une conversation de préparation, jamais une phrase qui continue', () => {
  for (const dit of ['C’est bon.', 'Ok Jarvis, c’est tout, merci', 'On arrête là', 'Termine', 'Fais la synthèse', 'Stop', 'Merci Jarvis, on a fini', 'C’est ok', 'Ok, c’est ok.', 'C’est ok Jarvis, merci', 'Ok c’est bon', 'C’est parfait', 'Je valide', 'Valide']) {
    assert.ok(demandeDeFin(dit), `« ${dit} » doit fermer la conversation`);
  }
  for (const dit of [
    'c’est bon pour moi, et ajoute une colonne au tableau',
    'est-ce que c’est bon',
    'arrête le serveur de développement',
    'termine la tâche du projet Beluga',
    'ça me va',
    'ok',
    'parfait',
    'c’est ok pour la couleur, mais change le titre',
    'est-ce que c’est ok',
    '',
  ]) {
    assert.ok(!demandeDeFin(dit), `« ${dit} » ne doit pas fermer la conversation`);
  }
});
