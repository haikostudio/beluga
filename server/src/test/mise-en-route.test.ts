import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAROLE_MAX,
  apresEtape,
  demandeDesParoles,
  etapesDeLaDiscussion,
  lireLesParoles,
  paroleAvecPrenom,
  questionEnCours,
} from '@beluga/shared';

test('la discussion commence par le moteur, puis Beluga se présente et demande les noms', () => {
  const etapes = etapesDeLaDiscussion();
  assert.deepEqual(etapes.slice(0, 4), ['moteurs', 'bienvenue', 'assistant', 'ordinateur']);
  assert.equal(etapes.length, 11);
  assert.ok(!etapesDeLaDiscussion(true).includes('copie'), 'pas de copie sur l’offre hébergée');
  assert.equal(questionEnCours({ statut: 'a-faire', etapes: {} }), 'moteurs');
  assert.equal(questionEnCours({ statut: 'a-faire', etapes: { moteurs: 'faite' } }), 'bienvenue');
});

test('la dernière réponse referme la mise en route, dans l’ordre de la discussion', () => {
  let etat = { statut: 'a-faire' as const, etapes: {} };
  for (const etape of etapesDeLaDiscussion()) {
    assert.equal(questionEnCours(etat), etape);
    etat = apresEtape(etat, etape, 'faite') as typeof etat;
  }
  assert.equal(questionEnCours(etat), 'fin');
  assert.equal((etat as { statut: string }).statut, 'termine');
});

test('une étape indispensable ne se repousse pas', () => {
  const etat = apresEtape({ statut: 'a-faire', etapes: {} }, 'moteurs', 'passee');
  assert.equal(questionEnCours(etat), 'moteurs');
});

test('la demande au moteur couvre chaque étape, dans la langue voulue, sans rien de privé', () => {
  const demande = demandeDesParoles({ langue: 'en', nom: 'Beluga' });
  assert.match(demande, /anglais/);
  for (const etape of etapesDeLaDiscussion().filter((e) => e !== 'moteurs')) assert.ok(demande.includes(`"${etape}"`), etape);
  assert.ok(!demande.includes('"moteurs"'), 'la question du moteur est écrite d’avance');
  assert.ok(!demandeDesParoles({ hebergee: true }).includes('"copie"'));
});

test('les paroles se lisent avec tolérance et se bornent', () => {
  const texte = 'Voici :\n```json\n{"bienvenue": "Bonjour, je suis **Beluga** !", "domaine": "' + 'x '.repeat(400) + '", "inconnue": "non", "assistant": 3}\n```';
  const paroles = lireLesParoles(texte);
  assert.equal(paroles.bienvenue, 'Bonjour, je suis Beluga !');
  assert.ok((paroles.domaine ?? '').length <= PAROLE_MAX + 1);
  assert.equal((paroles as Record<string, unknown>).inconnue, undefined);
  assert.equal(paroles.assistant, undefined);
  assert.deepEqual(lireLesParoles('rien de lisible'), {});
  assert.deepEqual(lireLesParoles('{ cassé'), {});
});

test('le prénom se pose, ou disparaît proprement tant qu’on ne le connaît pas', () => {
  assert.equal(paroleAvecPrenom('Parfait, {prenom} ! On continue.', 'Lou'), 'Parfait, Lou ! On continue.');
  assert.equal(paroleAvecPrenom('Parfait, {prenom} ! On continue.', ''), 'Parfait ! On continue.');
  assert.equal(paroleAvecPrenom('{prenom}, voici la suite.', null), 'Voici la suite.');
  assert.equal(paroleAvecPrenom('Merci. {prenom}, on y va ?', ''), 'Merci. On y va ?');
});
