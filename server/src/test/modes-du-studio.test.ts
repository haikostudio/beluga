import test from 'node:test';
import assert from 'node:assert/strict';
import { MODES_DU_STUDIO, consigneDuChoixDesModeles, estModeDuStudio, ligneDuModeDuStudio, modesDuStudio } from '@beluga/shared';

test('un mode est disponible dès qu’une de ses capacités est couverte, sinon il dit pourquoi', () => {
  const modes = modesDuStudio(['voix', 'synchro']);
  assert.equal(modes.length, MODES_DU_STUDIO.length);
  const de = (id: string) => modes.find((m) => m.mode.id === id)!;
  assert.equal(de('voix-off').disponible, true);
  assert.equal(de('synchro').disponible, true);
  assert.equal(de('musique').disponible, false);
  assert.ok(de('musique').raison);
  // Aucune capacité au catalogue ne porte le clonage ni le visage en vidéo : éteints, quoi qu'on branche.
  const tout = modesDuStudio(['image', 'video', 'voix', 'son', 'musique', 'avatar', 'synchro', 'animation', 'mouvement', 'visage', 'retouche', 'composition']);
  assert.equal(tout.find((m) => m.mode.id === 'clonage-voix')!.disponible, false);
  assert.equal(tout.find((m) => m.mode.id === 'visage-video')!.disponible, false);
  assert.equal(tout.find((m) => m.mode.id === 'annonce')!.disponible, true);
});

test('le mode retenu part dans la consigne ; un mode inconnu ne dit rien', () => {
  assert.equal(estModeDuStudio('synchro'), true);
  assert.equal(estModeDuStudio('n-importe'), false);
  assert.match(ligneDuModeDuStudio('voix-off'), /MODE DE RÉALISATION CHOISI PAR L’UTILISATEUR : « Voix off »/);
  assert.equal(ligneDuModeDuStudio('inconnu'), '');
  assert.equal(ligneDuModeDuStudio(null), '');
});

test('le choix du modèle se demande dans le fil ; sans aucune clé, le directeur propose de la poser', () => {
  const sans = consigneDuChoixDesModeles({ kie: false, openrouter: false });
  assert.match(sans, /ask_user/);
  assert.match(sans, /Studio — kie\.ai/);
  assert.match(sans, /Studio — OpenRouter/);
  const kie = consigneDuChoixDesModeles({ kie: true, openrouter: false });
  assert.match(kie, /modèles de kie\.ai pour ce type/);
  assert.match(kie, /OpenRouter n’a pas de clé/);
  const deux = consigneDuChoixDesModeles({ kie: true, openrouter: true });
  assert.match(deux, /kie\.ai et OpenRouter/);
  assert.doesNotMatch(deux, /n’a pas de clé/);
});
