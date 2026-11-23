import test from 'node:test';
import assert from 'node:assert/strict';
import {
  annonceUnAffichage,
  ecritureDemandee,
  fermetureGardeLeTravail,
  recitDesDerniersJours,
  separateurDeDiscussion,
  SIGNES_MAX_DU_RECIT,
} from '@beluga/shared';

test('les annonces d’affichage de DISC-0062 sont reconnues', () => {
  for (const phrase of [
    'Je te les ai mis dans la conversation.',
    'Voilà, je les ai affichés.',
    'Les voilà !',
    'Tu les vois juste là, à l’écran.',
    'C’est affiché.',
    'Je viens de te les mettre ici, à l’écran.',
    'Les trois liens sont dans la bulle juste au-dessus.',
  ]) {
    assert.equal(annonceUnAffichage(phrase), true, phrase);
  }
});

test('une promesse ou une phrase ordinaire n’est pas une annonce d’affichage', () => {
  for (const phrase of ['Je vais te les chercher.', 'Ça va bien, et toi ?', 'La carte est terminée, en attente de mise en ligne.', 'Je regarde les captures.', '']) {
    assert.equal(annonceUnAffichage(phrase), false, phrase);
  }
});

test('l’écriture dans un champ n’est permise que demandée', () => {
  for (const phrase of ['Écris-le dans la carte', 'Ajoute ça à la demande', 'Mets-le dans le champ', 'Note-le', 'C’est ok', 'Oui vas-y', 'Envoie-lui le message']) {
    assert.equal(ecritureDemandee(phrase), true, phrase);
  }
  for (const phrase of ['Trouve-moi les liens de la doc', 'Sors-les ici', 'Montre-moi le tableau', 'Tu peux regarder mes captures ?', undefined]) {
    assert.equal(ecritureDemandee(phrase), false, String(phrase));
  }
});

test('seuls Arrêter et « coupe-toi » coupent le travail ; toute fermeture automatique le garde', () => {
  assert.equal(fermetureGardeLeTravail('bouton Arrêter'), false);
  assert.equal(fermetureGardeLeTravail('coupure demandée à la voix'), false);
  for (const r of ['30 s de silence', 'veille ou fin demandée à la voix', 'écran caché', 'page quittée ou rechargée', 'conversation démontée', undefined]) {
    assert.equal(fermetureGardeLeTravail(r), true, String(r));
  }
});

test('la ligne de date entre deux appels', () => {
  const maintenant = new Date(2026, 10, 23, 9, 12).getTime();
  assert.equal(separateurDeDiscussion(new Date(2026, 10, 23, 9, 5).getTime(), maintenant), 'Aujourd’hui, 9 h 05');
  assert.equal(separateurDeDiscussion(new Date(2026, 10, 22, 22, 31).getTime(), maintenant), 'Hier, 22 h 31');
  assert.equal(separateurDeDiscussion(new Date(2026, 10, 20, 16, 54).getTime(), maintenant), '20 nov., 16 h 54');
  assert.equal(separateurDeDiscussion(new Date(2025, 0, 3, 8, 0).getTime(), maintenant), '3 janv. 2025, 8 h 00');
});

test('le récit des trois derniers jours : fenêtre, ordre, bulles et plafond', () => {
  const maintenant = new Date(2026, 10, 23, 9, 0).getTime();
  const recit = recitDesDerniersJours(
    [
      { id: 'DISC-0050', debut: new Date(2026, 10, 15, 10, 0).getTime(), echanges: [{ role: 'user', texte: 'Très vieux sujet' }] },
      { id: 'DISC-0062', debut: new Date(2026, 10, 22, 22, 31).getTime(), echanges: [{ role: 'user', texte: 'Les liens de la doc' }, { role: 'information', texte: 'Documentation\n[Guide](https://exemple.fr)' }] },
      { id: 'DISC-0063', debut: new Date(2026, 10, 23, 7, 10).getTime(), echanges: [{ role: 'assistant', texte: 'Bonjour' }] },
    ],
    maintenant,
  );
  assert.doesNotMatch(recit, /Très vieux sujet/);
  assert.ok(recit.indexOf('DISC-0063') < recit.indexOf('DISC-0062'));
  assert.match(recit, /Jarvis \(bulle affichée\) : Documentation \[Guide\]\(https:\/\/exemple\.fr\)/);
  const long = recitDesDerniersJours([{ debut: maintenant - 1000, echanges: Array.from({ length: 300 }, (_, i) => ({ role: 'user', texte: `phrase numéro ${i} assez longue pour remplir` })) }], maintenant);
  assert.ok(long.length <= SIGNES_MAX_DU_RECIT);
  assert.match(long, /phrase numéro 299/);
});

test('ce que Jarvis écrit s’ajoute à la suite et ne retire jamais une pastille de fichier', async () => {
  const { texteApresAjout } = await import('@beluga/shared');
  const avant = 'Regarde ces captures [fichier: capture 1.png] [fichier: capture 2.png]';
  const apres = texteApresAjout(avant, 'Les liens de la doc', true);
  assert.ok(apres.startsWith(avant));
  assert.match(apres, /\[fichier: capture 1\.png\] \[fichier: capture 2\.png\]\nLes liens de la doc$/);
  assert.equal(texteApresAjout('', 'bonjour', true), 'bonjour');
  assert.equal(texteApresAjout('beluga', 'quotas', false), 'beluga quotas');
});
