import test from 'node:test';
import assert from 'node:assert/strict';
import { messageEchecPublication, natureDePublication } from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* Une publication CASSÉE (le code ne passe pas) vs INTERROMPUE (coupée) */
/* ------------------------------------------------------------------ */

test('contrôles tombés → cassée', () => {
  // L'étape « verify » est réellement marquée en échec : le code ne passe pas.
  const nature = natureDePublication({
    etat: 'failed',
    etapeTombee: 'verify',
    motif: 'Le code ne compile pas : les contrôles échouent, rien n’est mis en ligne.',
  });
  assert.equal(nature, 'cassee');
});

test('construction en échec → cassée', () => {
  const nature = natureDePublication({
    etat: 'failed',
    etapeTombee: 'build',
    motif: 'La construction a échoué : rien n’est mis en ligne.',
  });
  assert.equal(nature, 'cassee');
});

test('coupure par redémarrage → interrompue', () => {
  // Aucune étape n'est tombée : le run est mort en route, seul le motif le dit.
  const nature = natureDePublication({
    etat: 'failed',
    etapeTombee: undefined,
    motif: 'Publication interrompue par un redémarrage du serveur.',
  });
  assert.equal(nature, 'interrompue');
});

test('arrêt demandé à la main → interrompue', () => {
  // L'état `stopped` suffit, quel que soit le motif.
  assert.equal(natureDePublication({ etat: 'stopped', motif: 'arrêt demandé' }), 'interrompue');
  assert.equal(natureDePublication({ etat: 'stopped' }), 'interrompue');
});

test('rien à qualifier tant que ça tourne ou que ça a réussi', () => {
  assert.equal(natureDePublication({ etat: 'running' }), null);
  assert.equal(natureDePublication({ etat: 'success' }), null);
});

test('un échec sans étape tombée ni marque d’interruption est traité comme cassé', () => {
  // Un checkout impossible ne marque aucune étape : par défaut, on alerte.
  const nature = natureDePublication({
    etat: 'failed',
    etapeTombee: undefined,
    motif: 'Impossible de revenir sur la branche à installer (main).',
  });
  assert.equal(nature, 'cassee');
});

test('le currentStep de repli ne fait pas passer une coupure pour une casse', () => {
  // L'appelant ne doit passer QUE l'étape réellement tombée : ici aucune, donc
  // la coupure par redémarrage reste une interruption même si le run mourait
  // pendant l'étape « build ».
  const nature = natureDePublication({
    etat: 'failed',
    etapeTombee: null,
    motif: 'Publication interrompue par un redémarrage du serveur.',
  });
  assert.equal(nature, 'interrompue');
});

/* ------------------------------------------------------------------ */
/* Le message court reprend la nature dans son verbe                    */
/* ------------------------------------------------------------------ */

test('le message court dit « en échec » pour une casse, « interrompue » pour une coupure', () => {
  const casse = messageEchecPublication({
    projet: 'Brain',
    etape: 'Construction',
    raison: 'La construction a échoué.',
    nature: 'cassee',
  });
  assert.match(casse, /Publication de « Brain » en échec à l’étape « Construction »/);

  const coupe = messageEchecPublication({
    projet: 'Brain',
    raison: 'Publication interrompue par un redémarrage du serveur.',
    nature: 'interrompue',
  });
  assert.match(coupe, /Publication de « Brain » interrompue :/);
});

/* ------------------------------------------------------------------ */
/* Une machine SATURÉE n'est ni une casse du code, ni une simple coupure */
/* ------------------------------------------------------------------ */

test('un serveur saturé n’est pas un code cassé, même avec une étape tombée', () => {
  /* LE CONTRESENS DU 08.09.2026 : l'étape « Vérification » tombe bel et bien,
     mais la commande n'a jamais démarré — le code n'a donc pas été jugé. Le
     ranger dans « cassée » revenait à accuser un code sain, puis à envoyer des
     agents le réparer. */
  const nature = natureDePublication({
    etat: 'failed',
    etapeTombee: 'verify',
    motif:
      'Serveur saturé pendant l’étape « Vérification » : le serveur a refusé de lancer un programme de plus.',
  });
  assert.equal(nature, 'saturee');
});

test('une vraie casse reste une casse, et une coupure reste une coupure', () => {
  // Le nouveau tri ne déteint sur aucun des deux cas existants.
  assert.equal(
    natureDePublication({ etat: 'failed', etapeTombee: 'build', motif: 'La construction a échoué.' }),
    'cassee',
  );
  assert.equal(
    natureDePublication({ etat: 'failed', etapeTombee: null, motif: 'Publication interrompue par un redémarrage.' }),
    'interrompue',
  );
});

test('le message court d’une saturation ne dit jamais « en échec »', () => {
  const phrase = messageEchecPublication({
    projet: 'Beluga Build',
    etape: 'Vérification du code',
    raison: 'Serveur saturé : le serveur a refusé de lancer un programme de plus.',
    nature: 'saturee',
  });
  assert.match(phrase, /retenue par un serveur saturé/);
  assert.doesNotMatch(phrase, /en échec/);
  assert.match(phrase, /Beluga Build/, 'le projet est nommé');
  assert.match(phrase, /Vérification du code/, 'l’étape est nommée');
});
