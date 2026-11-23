import assert from 'node:assert/strict';
import test from 'node:test';
import { separerLaReponse, texteDeReponse } from '@beluga/shared';

/**
 * CE QUI A ÉTÉ CHOISI NE SE REDIT PAS SOUS LES PASTILLES.
 *
 * Le récit d'une carte affichait la réponse ENTIÈRE sous les choix proposés :
 * le libellé retenu se lisait donc deux fois, une fois en pastille bleue et
 * une fois en paragraphe. `separerLaReponse` rend les deux morceaux à part,
 * SANS toucher au journal : ce qui est déjà enregistré se relit au nouveau
 * format.
 */

test('un choix unique laisse les pastilles parler seules', () => {
  assert.deepEqual(separerLaReponse('Non', ['Oui', 'Non']), { libelles: ['Non'] });
});

test('plusieurs choix retenus se retrouvent tous', () => {
  assert.deepEqual(separerLaReponse('Oui, Peut-être', ['Oui', 'Non', 'Peut-être']), {
    libelles: ['Oui', 'Peut-être'],
  });
});

test('le complément écrit à la main se sépare des libellés', () => {
  assert.deepEqual(separerLaReponse('Oui — mais après la mise en ligne', ['Oui', 'Non']), {
    libelles: ['Oui'],
    complement: 'mais après la mise en ligne',
  });
});

test('une réponse libre est un complément, sans aucun libellé', () => {
  assert.deepEqual(separerLaReponse('Le bandeau doit rester en haut', []), {
    libelles: [],
    complement: 'Le bandeau doit rester en haut',
  });
});

test('un libellé qui n’est que le début du texte écrit ne se prend pas pour un choix', () => {
  assert.deepEqual(separerLaReponse('Oui mais pas maintenant', ['Oui', 'Non']), {
    libelles: [],
    complement: 'Oui mais pas maintenant',
  });
});

test('une question restée sans réponse ne rend rien', () => {
  assert.deepEqual(separerLaReponse(undefined, ['Oui']), { libelles: [] });
  assert.deepEqual(separerLaReponse('   ', ['Oui']), { libelles: [] });
});

/**
 * LE CONTRAT AVEC CE QUI ÉCRIT LA RÉPONSE. `texteDeReponse` colle les morceaux,
 * `separerLaReponse` les redécoupe : les deux règles doivent rester d'accord,
 * quoi qu'on change à l'une.
 */
test('ce que la bulle de question a collé se redécoupe à l’identique', () => {
  const options = ['Garder le bandeau', 'Le retirer', 'Le déplacer'];
  for (const [libelles, complement, images] of [
    [['Garder le bandeau'], '', 0],
    [['Le retirer', 'Le déplacer'], '', 0],
    [['Le retirer'], 'et prévenir les clients', 0],
    [[], 'rien de tout ça', 0],
  ] as [string[], string, number][]) {
    const colle = texteDeReponse(libelles, complement, images);
    const separe = separerLaReponse(colle, options);
    assert.deepEqual(separe.libelles, libelles, colle);
    assert.equal(separe.complement ?? '', complement, colle);
  }
});
