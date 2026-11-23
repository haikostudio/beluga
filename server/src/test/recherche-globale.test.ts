import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trierLaRechercheGlobale } from '@beluga/shared';

test('⌘F élargi : documents, coffre, studio, mémoire et sites, rangés par genre, le nom qui commence en tête', () => {
  const r = trierLaRechercheGlobale(
    {
      chartes: [
        { id: 'p1', titre: 'Charte Haiko', projet: 'Haiko' },
        { id: 'p2', titre: 'Présentation', projet: 'Beluga', marque: 'Haiko' },
      ],
      coffre: [{ id: 'c1', nom: 'Haiko — serveur', type: 'ssh', dossierChemin: 'Haiko/Prod' }],
      studio: [{ id: 's1', titre: 'Vidéo de lancement', projet: 'Haiko' }],
      memoire: [{ id: 'MEM-1', titre: 'technique', titreHumain: 'La charte de Haiko', portee: 'beluga' }],
      sites: [{ id: 'w1', nom: 'haiko.ch', adresse: 'https://haiko.ch' }],
    },
    'haiko',
  );
  assert.deepEqual(
    r.map((x) => `${x.genre}:${x.id}`),
    ['charte:p1', 'charte:p2', 'coffre:c1', 'studio:s1', 'memoire:MEM-1', 'site:w1'],
  );
  assert.equal(r.find((x) => x.genre === 'coffre')!.detail, 'Haiko/Prod · ssh');
});

test('⌘F élargi : sans accents ni majuscules, tous les mots requis, et rien sous deux lettres', () => {
  const sources = { chartes: [{ id: 'p1', titre: 'Présentation Été' }, { id: 'p2', titre: 'Présentation' }] };
  assert.deepEqual(trierLaRechercheGlobale(sources, 'presentation ete').map((x) => x.id), ['p1']);
  assert.deepEqual(trierLaRechercheGlobale(sources, 'p'), []);
});

test('⌘F élargi : une fiche du coffre ne rend jamais que son nom, son type et son dossier', () => {
  const fiche = { id: 'c1', nom: 'Base de prod', type: 'base', dossierChemin: null, champs: { motDePasse: 'secret-123' }, note: 'mot secret-123' };
  const r = trierLaRechercheGlobale({ coffre: [fiche] }, 'base');
  assert.equal(r.length, 1);
  assert.ok(!JSON.stringify(r).includes('secret-123'));
  /* Une valeur cherchée ne fait pas trouver sa fiche. */
  assert.deepEqual(trierLaRechercheGlobale({ coffre: [fiche] }, 'secret-123'), []);
});
