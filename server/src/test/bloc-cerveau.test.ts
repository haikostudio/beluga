import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EtatCerveau,
  erreursUtiles,
  ligneEtatCerveau,
  validerCleCerveau,
} from '@haikodev/shared';

const quand = (at: number) => `il y a ${at} min`;

function etat(partiel: Partial<EtatCerveau> = {}): EtatCerveau {
  return {
    clePosee: true,
    adresse: 'https://memoire.haiko-s1.com',
    projetsEnvoyes: 0,
    fichiersEnvoyes: 0,
    erreurs: [],
    ...partiel,
  };
}

test('sans clé, une seule ligne, et elle appelle le geste', () => {
  const ligne = ligneEtatCerveau(etat({ clePosee: false }), quand);
  assert.equal(ligne.besoinDeCle, true);
  assert.equal(ligne.ton, 'attente');
  assert.match(ligne.texte, /clé/i);
});

test('clé posée et envoi réussi : la ligne dit le résultat', () => {
  const ligne = ligneEtatCerveau(etat({ dernierSucces: 5, fichiersEnvoyes: 12, projetsEnvoyes: 3 }), quand);
  assert.equal(ligne.ton, 'ok');
  assert.equal(ligne.besoinDeCle, false);
  assert.match(ligne.texte, /12 fichiers pour 3 projets/);
});

test('un seul fichier, un seul projet : pas de « s » de trop', () => {
  const ligne = ligneEtatCerveau(etat({ dernierSucces: 5, fichiersEnvoyes: 1, projetsEnvoyes: 1 }), quand);
  assert.match(ligne.texte, /1 fichier pour 1 projet\./);
});

test('clé posée mais aucun envoi abouti : le problème se dit', () => {
  const ligne = ligneEtatCerveau(etat({ derniereTentative: 9 }), quand);
  assert.equal(ligne.ton, 'probleme');
  assert.match(ligne.texte, /dernière tentative/i);
});

test("l'erreur qui redit l'absence de clé n'est jamais montrée", () => {
  const sans = erreursUtiles(
    etat({ clePosee: false, erreurs: [{ at: 1, message: 'aucune clé (CERVEAU_API_KEY)' }] }),
  );
  assert.equal(sans.length, 0);
  // Une fois la clé posée, cette trace est périmée : elle ne revient pas.
  const avec = erreursUtiles(etat({ erreurs: [{ at: 1, message: 'aucune clé (CERVEAU_API_KEY)' }] }));
  assert.equal(avec.length, 0);
});

test('deux fois la même erreur ne se montre qu\'une fois, trois au plus', () => {
  const erreurs = erreursUtiles(
    etat({
      erreurs: [
        { at: 5, projet: 'A', message: 'refus (401)' },
        { at: 4, projet: 'A', message: 'refus (401)' },
        { at: 3, projet: 'B', message: 'refus (500)' },
        { at: 2, projet: 'C', message: 'envoi impossible' },
        { at: 1, projet: 'D', message: 'délai dépassé' },
      ],
    }),
  );
  assert.equal(erreurs.length, 3);
  assert.deepEqual(
    erreurs.map((e) => e.projet),
    ['A', 'B', 'C'],
  );
});

test('une clé vide ou avec un espace est refusée, une clé normale passe', () => {
  assert.equal(validerCleCerveau('   ').ok, false);
  assert.equal(validerCleCerveau('cle avec espace').ok, false);
  const bonne = validerCleCerveau('  sk-cerveau-123  ');
  assert.equal(bonne.ok, true);
  assert.equal(bonne.ok && bonne.cle, 'sk-cerveau-123');
});
