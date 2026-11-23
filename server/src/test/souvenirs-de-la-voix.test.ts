import test from 'node:test';
import assert from 'node:assert/strict';
import { consigneDeLaVoix, souvenirsPourLaVoix, SIGNES_MAX_DES_SOUVENIRS, CONSIGNE_DU_DIRECT } from '@beluga/shared';

const jour = (h: number) => new Date(2026, 10, 17, h, 5).getTime();

test('la voix ne dit jamais qu’elle n’a pas l’historique, et Codex sait où chercher', () => {
  const c = consigneDeLaVoix('Jarvis', 'Chris');
  assert.match(c, /Ne dis JAMAIS que tu n’as pas l’historique/);
  assert.match(c, /passe la main à Codex/);
  // Le cerveau retrouve les discussions passées par son dossier (« DISC-… »), à chaque demande.
  assert.match(CONSIGNE_DU_DIRECT, /voix_dossier/);
  assert.match(CONSIGNE_DU_DIRECT, /DISC-…/);
});

test('les souvenirs entrent dans la consigne, sous leur date, la plus récente d’abord', () => {
  const souvenirs = souvenirsPourLaVoix([
    { debut: jour(16), echanges: [{ role: 'user', texte: 'On parle du bouton du bord' }, { role: 'assistant', texte: 'D’accord, je note.' }] },
    { debut: jour(9), echanges: [{ role: 'user', texte: 'La visionneuse sur téléphone' }] },
  ]);
  assert.match(souvenirs, /^— 17\/11 à 16 h 05 :\nToi : On parle du bouton du bord\nJarvis : D’accord, je note\.\n— 17\/11 à 09 h 05 :/);
  const c = consigneDeLaVoix('Jarvis', 'Chris', { souvenirs });
  assert.match(c, /VOS DERNIÈRES DISCUSSIONS/);
  assert.match(c, /La visionneuse sur téléphone/);
  assert.doesNotMatch(consigneDeLaVoix('Jarvis', 'Chris'), /VOS DERNIÈRES DISCUSSIONS/);
});

test('les souvenirs sont bornés et gardent la fin des échanges', () => {
  const echanges = Array.from({ length: 200 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', texte: `Phrase numéro ${i} avec un peu de texte autour pour remplir.` }));
  const s = souvenirsPourLaVoix([{ debut: jour(10), echanges }, { debut: jour(8), echanges }, { debut: jour(7), echanges }, { debut: jour(6), echanges }]);
  assert.ok(s.length <= SIGNES_MAX_DES_SOUVENIRS, `${s.length}`);
  assert.match(s, /Phrase numéro 199/);
  assert.doesNotMatch(s, /Phrase numéro 0 /);
  // Trois discussions au plus.
  assert.equal(s.match(/^— /gm)?.length, 3);
  assert.equal(souvenirsPourLaVoix([]), '');
  assert.equal(souvenirsPourLaVoix([{ debut: jour(5), echanges: [{ role: 'user', texte: '  ' }] }]), '');
});
