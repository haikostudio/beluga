import assert from 'node:assert/strict';
import test from 'node:test';
import { auteurDeLaDemandeEcrite, pointsDuParcours } from '@beluga/shared';

/*
 * UNE CARTE POSÉE PAR UN AGENT MONTRE SA DEMANDE EN BULLE, AVEC SON AUTEUR (capture #6e9b, 12/11/2026) :
 * la carte de nuit n'avait aucun jalon « Demande » — premier tour automatique, silencieux — et le point
 * « Demande » montrait un blanc, le texte seulement sous « Voir le prompt envoyé ».
 */

const passage = (points: any[], etape: string) => points.find((p) => p.etape === etape && p.rang === 1);

test('l’auteur de la demande : nuit, marketing, chef ou agent ; rien pour l’utilisateur', () => {
  assert.equal(auteurDeLaDemandeEcrite({ origin: 'user' }), undefined);
  assert.equal(auteurDeLaDemandeEcrite({ origin: 'agent', labels: ['auto amélioration'] }), 'nuit');
  assert.equal(auteurDeLaDemandeEcrite({ origin: 'agent', labels: [] }, { role: 'analysis', title: 'Auto-amélioration — nuit du 12.11.2026' }), 'nuit');
  assert.equal(auteurDeLaDemandeEcrite({ origin: 'agent', labels: ['marketing'] }), 'marketing');
  assert.equal(auteurDeLaDemandeEcrite({ origin: 'agent' }, { title: 'Chef d’orchestre' }), 'chef');
  assert.equal(auteurDeLaDemandeEcrite({ origin: 'agent' }), 'agent');
});

test('sans jalon « Demande », le point en reçoit une bulle — même quand le tour automatique y a déjà agi', () => {
  const journal: any[] = [
    { id: 'j0', cardId: 'c', rang: 0, phase: 'cadrage', nature: 'jalon', at: 1000, libelle: 'Tour lancé', reussie: true },
    { id: 'j1', cardId: 'c', rang: 1, phase: 'cadrage', nature: 'requete', at: 1100, libelle: 'memoire', outil: 'memoire', resultat: '8 unités', reussie: true },
  ];
  const points = pointsDuParcours(journal, {
    chapitre: 'cadrage',
    colonne: 'planned',
    tourEnCours: false,
    parcours: null,
    descriptionDeLaCarte: 'Résumé court.',
    demandeDeLAgent: 'La demande entière écrite par l’agent de nuit.',
    auteurDeLaDemande: 'l’agent d’amélioration de la nuit',
    creeeA: 900,
  } as any);
  const demande = passage(points, 'demande');
  assert.ok(demande, 'le point Demande existe');
  const bulle = demande.moments.find((m: any) => m.sorte === 'demande');
  assert.ok(bulle, 'une bulle de demande');
  assert.equal(bulle.entree.resultat, 'La demande entière écrite par l’agent de nuit.', 'le briefing passe avant la description');
  assert.equal(JSON.parse(bulle.entree.donnees).auteurDeLaDemande, 'l’agent d’amélioration de la nuit');
});
