import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DELAI_MATURITE_MS,
  SIGNAUX_MINIMUM,
  confianceDeDepart,
  consigneDeCapitalisation,
  contradictionEntre,
  etatDeCapitalisation,
  parleDeRetourEnArriere,
  perimetreCommun,
  premiereContradiction,
  proximiteDeSens,
  renvoieA,
  type CarteComparable,
} from '@haikodev/shared';

/*
 * CE QUI A LE DROIT DE DEVENIR UNE COMPÉTENCE.
 *
 * Le pool ne doit apprendre que de travail PROUVÉ : trois volets ensemble —
 * contrôles du projet rejoués et réussis, passage effectif en production, sept
 * jours sans contradiction. « Sept jours sans correctif » seul n'est pas une
 * preuve : c'est une absence de nouvelle.
 *
 * Et une contradiction ne se déclare jamais sur UN signal : deux cartes
 * voisines mais indépendantes se ressemblent beaucoup dans un projet qui
 * travaille toujours au même endroit.
 */

const JOUR = 24 * 60 * 60 * 1000;
const MAINTENANT = 1_800_000_000_000;

test('sans contrôles rejoués, rien n’est capitalisé — et la carte DIT pourquoi', () => {
  const jugement = etatDeCapitalisation({ controlesReussis: false }, MAINTENANT);
  assert.equal(jugement.etat, 'sans-preuve');
  assert.match(jugement.raison, /contrôles/);
});

test('les contrôles passés sans mise en production ne font qu’une CANDIDATE', () => {
  const jugement = etatDeCapitalisation({ controlesReussis: true }, MAINTENANT);
  assert.equal(jugement.etat, 'candidate');
  assert.match(jugement.raison, /production/);
});

test('en production depuis moins de sept jours : candidate, avec le temps qu’il reste', () => {
  const jugement = etatDeCapitalisation(
    { controlesReussis: true, enProductionDepuis: MAINTENANT - 2 * JOUR },
    MAINTENANT,
  );
  assert.equal(jugement.etat, 'candidate');
  assert.ok(jugement.resteAAttendreMs > 4 * JOUR);
  assert.ok(jugement.resteAAttendreMs <= DELAI_MATURITE_MS);
});

test('les trois volets ensemble font une carte MÛRE', () => {
  const jugement = etatDeCapitalisation(
    { controlesReussis: true, enProductionDepuis: MAINTENANT - 8 * JOUR },
    MAINTENANT,
  );
  assert.equal(jugement.etat, 'mure');
});

test('une carte contredite retombe candidate, en nommant celle qui la contredit', () => {
  const jugement = etatDeCapitalisation(
    {
      controlesReussis: true,
      enProductionDepuis: MAINTENANT - 30 * JOUR,
      contrediteLe: MAINTENANT - 2 * JOUR,
      contreditePar: 'Corriger la barre d’état',
    },
    MAINTENANT,
  );
  assert.equal(jugement.etat, 'candidate');
  assert.match(jugement.raison, /Corriger la barre/);
});

test('le forçage saute l’ATTENTE, jamais les contrôles — et la fiche naît en confiance basse', () => {
  const sansControles = etatDeCapitalisation({ controlesReussis: false, forcee: true }, MAINTENANT);
  assert.equal(sansControles.etat, 'sans-preuve');

  const forcee = etatDeCapitalisation(
    { controlesReussis: true, enProductionDepuis: MAINTENANT - 1 * JOUR, forcee: true },
    MAINTENANT,
  );
  assert.equal(forcee.etat, 'mure');
  assert.ok(confianceDeDepart({ controlesReussis: true, forcee: true }) < confianceDeDepart({ controlesReussis: true }));
});

test('une carte dont une fiche est née est PUBLIÉE, et le dit', () => {
  const jugement = etatDeCapitalisation({ controlesReussis: true, ficheNee: 'barre-detat' }, MAINTENANT);
  assert.equal(jugement.etat, 'publiee');
  assert.match(jugement.raison, /barre-detat/);
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

test('la consigne de la nuit nomme les cartes et interdit le code', () => {
  const consigne = consigneDeCapitalisation([{ id: 'c-1', projet: 'HaikoDev', titre: 'Une leçon' }]);
  assert.match(consigne, /HaikoDev · c-1/);
  assert.match(consigne, /PLATEFORME/);
  assert.match(consigne, /N'ÉCRIS AUCUN CODE/);
});
