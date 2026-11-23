import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FICHES_NOMMEES_MAX,
  SIGNAUX_MINIMUM,
  consigneDuMenage,
  contradictionEntre,
  DESCRIPTION_DU_MENAGE,
  menageNecessaire,
  rapportDuMenage,
  parleDeRetourEnArriere,
  perimetreCommun,
  premiereContradiction,
  proximiteDeSens,
  renvoieA,
  type CarteComparable,
} from '@beluga/shared';

/*
 * LE MÉNAGE DE NUIT DU POOL — ET LA CONTRADICTION QUI LUI SERT.
 *
 * Depuis le 2026-10-02, une compétence naît à la FIN de chaque tâche, propre au
 * projet et commune quand elle vaut ailleurs (DEC-104 et sa preuve triple sont
 * remplacées). La nuit ne crée plus : elle RANGE — doublons, fiches maigres,
 * leçon répétée d'un projet à l'autre, fiche née d'un travail défait depuis.
 *
 * Et une contradiction ne se déclare jamais sur UN signal : deux cartes
 * voisines mais indépendantes se ressemblent beaucoup dans un projet qui
 * travaille toujours au même endroit.
 */

const JOUR = 24 * 60 * 60 * 1000;
const MAINTENANT = 1_800_000_000_000;

test('rien d’écrit ni de contredit depuis le dernier passage : pas d’agent cette nuit', () => {
  assert.equal(menageNecessaire({ touchees: [], aRevoir: [] }), false);
  assert.equal(menageNecessaire({ touchees: [{ nom: 'barre-de-jours', projets: ['Kipou'] }], aRevoir: [] }), true);
  assert.equal(
    menageNecessaire({ touchees: [], aRevoir: [{ nom: 'barre-detat', carte: 'Poser la barre', contreditePar: 'Corriger la barre' }] }),
    true,
  );
});

test('la consigne du ménage nomme les fiches, leur portée, les contredites, et interdit le code', () => {
  const consigne = consigneDuMenage({
    touchees: [
      { nom: 'barre-de-jours-des-statistiques', projets: ['Kipou'] },
      { nom: 'silhouette-de-chargement', projets: [] },
    ],
    aRevoir: [{ nom: 'barre-detat', carte: 'Poser la barre d’état', contreditePar: 'Corriger la barre d’état' }],
  });
  assert.match(consigne, /barre-de-jours-des-statistiques \(propre à Kipou\)/);
  assert.match(consigne, /silhouette-de-chargement \(commune\)/);
  assert.match(consigne, /contredite par « Corriger la barre d’état »/);
  assert.match(consigne, /DOUBLONS/);
  assert.match(consigne, /UNE fiche commune/);
  assert.match(consigne, /N'ÉCRIS AUCUN CODE/);
  // La nuit ne crée plus de leçon, et elle ne plafonne plus ce qu'elle range.
  assert.match(consigne, /Tu ne crées aucune leçon nouvelle/);
  assert.doesNotMatch(consigne, /au plus\)/);
});

test('la liste remise à l’agent est bornée, et dit où lire le reste', () => {
  const touchees = Array.from({ length: FICHES_NOMMEES_MAX + 5 }, (_, i) => ({ nom: `fiche-${i}`, projets: [] }));
  const consigne = consigneDuMenage({ touchees, aRevoir: [] });
  assert.match(consigne, /fiche-0 /);
  assert.doesNotMatch(consigne, new RegExp(`fiche-${FICHES_NOMMEES_MAX} `));
  assert.match(consigne, /et 5 autre\(s\)/);
});

/* ------------------------------------------------------------------ */
/* LA CONTRADICTION                                                     */
/* ------------------------------------------------------------------ */

const AVANT: CarteComparable = {
  id: 'c-1',
  titre: 'Poser la barre d’état sombre sur l’application installable',
  demande: 'La barre d’état reste blanche au lancement de l’application installable sur téléphone.',
  fichiers: ['web/src/styles.css'],
  closeLe: MAINTENANT - 10 * JOUR,
};

test('un seul signal ne suffit jamais à déclarer une contradiction', () => {
  const voisine: CarteComparable = {
    id: 'c-2',
    titre: 'Ajouter un bouton de partage',
    demande: 'Un bouton de partage dans la barre du haut.',
    fichiers: ['web/src/styles.css'],
    closeLe: MAINTENANT - 5 * JOUR,
  };
  const contradiction = contradictionEntre(AVANT, voisine);
  assert.equal(contradiction.contredite, false);
  assert.ok(contradiction.signaux.length < SIGNAUX_MINIMUM);
});

test('deux signaux croisés la déclarent, même sans fichier commun', () => {
  const correctif: CarteComparable = {
    id: 'c-3',
    titre: 'Corriger la barre d’état restée blanche',
    demande:
      'La barre d’état de l’application installable ne fonctionne plus depuis le lancement : elle redevient blanche.',
    // AUCUN fichier commun : le correctif a touché un autre fichier du même écran.
    fichiers: ['web/index.html'],
    closeLe: MAINTENANT - 2 * JOUR,
  };
  const contradiction = contradictionEntre(AVANT, correctif);
  assert.equal(contradiction.contredite, true);
  assert.ok(contradiction.signaux.includes('reouverture'));
  assert.match(contradiction.raison, /revient sur ce travail/);
});

test('une carte ANTÉRIEURE ne contredit rien : ce n’est qu’un précédent', () => {
  const avantEncore: CarteComparable = { ...AVANT, id: 'c-0', closeLe: MAINTENANT - 40 * JOUR };
  assert.equal(contradictionEntre(AVANT, avantEncore).contredite, false);
});

test('les cinq signaux se relèvent séparément', () => {
  assert.ok(perimetreCommun(AVANT, { titre: 'barre d’état blanche', demande: 'lancement installable' }).length >= 0);
  assert.ok(proximiteDeSens(AVANT.demande, AVANT.demande) > 0.9);
  assert.equal(renvoieA({ titre: 'suite', demande: 'voir la carte c-1' }, { id: 'c-1', titre: AVANT.titre }), true);
  assert.equal(parleDeRetourEnArriere('il faut corriger ça'), true);
  assert.equal(parleDeRetourEnArriere('ajouter un écran de réglages'), false);
});

test('la PREMIÈRE contradiction rendue est la plus ancienne : c’est elle qui a coupé le délai', () => {
  const premiere: CarteComparable = {
    id: 'c-4',
    titre: 'Corriger la barre d’état de l’application installable',
    demande: 'La barre d’état ne marche plus au lancement installable.',
    fichiers: ['web/src/styles.css'],
    closeLe: MAINTENANT - 6 * JOUR,
  };
  const seconde: CarteComparable = { ...premiere, id: 'c-5', closeLe: MAINTENANT - 1 * JOUR };
  const trouvee = premiereContradiction(AVANT, [seconde, premiere]);
  assert.equal(trouvee?.carte.id, 'c-4');
});

test('la carte du ménage dit ce qu’il range, et son rapport compte les fiches', () => {
  assert.match(DESCRIPTION_DU_MENAGE, /compétences/);
  assert.equal(rapportDuMenage({ touchees: 1, aRevoir: 0, recurrences: 2 }), 'Ménage terminé : 1 fiche relue, 0 fiche à revoir, 2 récurrences dans le code.');
  assert.equal(rapportDuMenage({ touchees: 3, aRevoir: 1, recurrences: 0 }), 'Ménage terminé : 3 fiches relues, 1 fiche à revoir, 0 récurrence dans le code.');
});
