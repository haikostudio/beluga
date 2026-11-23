import test from 'node:test';
import assert from 'node:assert/strict';
import { consigneDeDemandeComplexe, consigneDeLaQuestionDeMode, jugerLaComplexite } from '@beluga/shared';

test('une demande à plusieurs volets est complexe', () => {
  const texte = [
    "- tu penses qu'on peut accélérer l'exécution des tâches ? J'aimerais une meilleure vision dans l'interface.",
    "- j'aimerais aussi que le système pose plus de questions lorsqu'il détecte une demande complexe.",
    "- il faut aussi afficher une fenêtre la première fois qu'on active le mode création.",
  ].join('\n');
  const jugement = jugerLaComplexite(texte);
  assert.equal(jugement.complexe, true);
  assert.ok(jugement.raisons.some((r) => /points listés/.test(r)));
  assert.match(consigneDeDemandeComplexe(jugement), /ask_user/);
});

test('une demande courte et simple ne l\'est pas', () => {
  assert.equal(jugerLaComplexite('Corrige la faute dans le titre de la page Réglages.').complexe, false);
  assert.equal(jugerLaComplexite('[fichier: image.png #12ab] le bouton est trop haut').complexe, false);
});

test('beaucoup de pièces jointes ou un long texte suffisent', () => {
  assert.equal(jugerLaComplexite('Voici les maquettes.', 3).complexe, true);
  assert.equal(jugerLaComplexite('a '.repeat(500)).complexe, true);
});

test('une demande complexe fait PENCHER pour le plan dans le choix du mode, sans rien allumer', () => {
  const consigne = consigneDeLaQuestionDeMode({ raisons: ['longue demande'] });
  assert.match(consigne, /ask_user/);
  assert.match(consigne, /le Plan est probable/);
  assert.match(consigne, /board_update_card/);
  assert.doesNotMatch(consigneDeLaQuestionDeMode(null), /INDICE/);
});
