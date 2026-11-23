import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  origineDuBloc,
  partagePourLOeil,
  partsDuContexte,
  type SentContextBlock,
} from '@beluga/shared';

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'heritage-'));
process.env.BELUGA_DATA = bacASable;

const { briefingSepare } = await import('../memory.js');

/* ------------------------------------------------------------------ */
/* La part plateforme et la part projet                                */
/* ------------------------------------------------------------------ */

test('le briefing sépare ce qui vient du projet de ce qui vient de la plateforme', () => {
  const projet = fs.mkdtempSync(path.join(os.tmpdir(), 'briefing-parts-'));
  try {
    const { sansMemoire, socle } = briefingSepare(projet, 'Essai', true);

    // Le PROJET : son dossier. La PLATEFORME : l'accès GitHub et la façon
    // d'écrire une règle durable — identiques sur tous les projets.
    assert.match(sansMemoire, /Projet : Essai/);
    assert.ok(socle, 'le socle de la plateforme doit être isolé');
    assert.match(socle as string, /GITHUB EST DIRECTEMENT ACCESSIBLE/);
    assert.match(socle as string, /RÈGLE DURABLE APPRISE/);
    // …et il ne doit surtout plus être compté du côté du projet.
    assert.doesNotMatch(sansMemoire, /RÈGLE DURABLE APPRISE/);
  } finally {
    fs.rmSync(projet, { recursive: true, force: true });
  }
});

function bloc(kind: SentContextBlock['kind'], characters: number, origine?: SentContextBlock['origine']) {
  return { kind, label: kind, characters, origine } as SentContextBlock;
}

test('le partage additionne chaque origine, et les pourcentages font 100', () => {
  const parts = partsDuContexte([
    bloc('briefing', 300, 'projet'),
    bloc('briefing', 600, 'plateforme'),
    bloc('memory', 100, 'projet'),
    bloc('request', 100, 'demande'),
  ]);
  assert.deepEqual(parts, { plateforme: 600, projet: 400, demande: 100, total: 1100 });

  const lignes = partagePourLOeil(parts);
  assert.equal(
    lignes.reduce((n, l) => n + l.part, 0),
    100,
    'trois arrondis ne doivent jamais donner 99 % ou 101 %',
  );
  assert.equal(lignes.find((l) => l.cle === 'plateforme')?.part, 55);
});

test('une origine à zéro ne s’affiche pas, et un tour vide ne rend rien', () => {
  const sansDemande = partagePourLOeil(partsDuContexte([bloc('briefing', 10, 'plateforme')]));
  assert.deepEqual(
    sansDemande.map((l) => l.cle),
    ['plateforme'],
  );
  assert.deepEqual(partagePourLOeil(partsDuContexte([])), []);
});

test('un tour enregistré AVANT ce partage se range sur son genre, sans rien inventer', () => {
  // Aucun `origine` : ce sont les tours d'avant. On ne réécrit pas leur histoire,
  // on les range grossièrement — et le gabarit reste du côté de la plateforme.
  assert.equal(origineDuBloc({ kind: 'format' } as SentContextBlock), 'plateforme');
  assert.equal(origineDuBloc({ kind: 'request' } as SentContextBlock), 'demande');
  assert.equal(origineDuBloc({ kind: 'memory' } as SentContextBlock), 'projet');
  // Une étiquette POSÉE l'emporte toujours sur la déduction.
  assert.equal(origineDuBloc({ kind: 'briefing', origine: 'plateforme' } as SentContextBlock), 'plateforme');
});
