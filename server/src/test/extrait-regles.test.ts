import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classerRegles, motsDeLaRequete } from '@beluga/shared';

/*
 * SERVIR LA MÉMOIRE AU POIDS DE LA DEMANDE.
 *
 * Un sujet NOMMÉ vaut la liste des TITRES de ses règles ; des MOTS-CLÉS ne
 * valent qu'un extrait, plafonné, et ce qui est écarté est NOMMÉ. C'est le
 * poste de dépense le plus lourd d'une tâche : un mot vague ramenait 36 000
 * signes de règles.
 */

/** Une règle factice, assez longue pour peser dans un plafond. */
function regle(titre: string, corps: string, remplissage = 0): string {
  return `- **${titre}** ${corps}${remplissage ? '\n  ' + 'x'.repeat(remplissage) : ''}`;
}

/* ------------------------------------------------------------------ */
/* Le classement pur                                                   */
/* ------------------------------------------------------------------ */

test('les mots de moins de quatre lettres ne classent rien', () => {
  assert.deepEqual(motsDeLaRequete('le détail de la carte'), ['détail', 'carte']);
});

test('un même mot répété ne compte qu’une fois', () => {
  assert.deepEqual(motsDeLaRequete('carte carte cartes'), ['carte', 'cartes']);
});

test('la règle qui touche le plus de mots passe devant', () => {
  const regles = [
    regle('Une colonne.', 'Parle de colonne seulement.'),
    regle('Le tiroir.', 'Parle de tiroir, de colonne et de jetons.'),
  ];
  const classees = classerRegles(regles, 'tiroir colonne jetons');
  assert.equal(classees.length, 2);
  assert.match(classees[0].texte, /Le tiroir/);
  assert.equal(classees[0].touches, 3);
  assert.equal(classees[1].touches, 1);
});

test('une règle qui ne touche aucun mot est écartée, jamais rendue', () => {
  const regles = [regle('Hors sujet.', 'Ne parle que de bateaux.'), regle('Utile.', 'Parle de jetons.')];
  const classees = classerRegles(regles, 'jetons');
  assert.equal(classees.length, 1);
  assert.match(classees[0].texte, /Utile/);
});

test('une demande sans mot utile ne classe rien — on ne devine pas', () => {
  assert.equal(classerRegles([regle('A.', 'B.')], 'de la à un').length, 0);
});

/* ------------------------------------------------------------------ */
/* Le plafond                                                          */
/* ------------------------------------------------------------------ */
