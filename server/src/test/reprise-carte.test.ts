import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIBELLE_LANCER,
  LIBELLE_REPRENDRE,
  RAISON_COUPE_EN_VOL,
  RAISON_SANS_MODIFICATION,
  RAISON_SUSPENDU,
  RAISON_TOUR_SANS_ISSUE,
  carteSeReprend,
  consigneDeReprise,
  libelleDeLancement,
  libelleDuLotDeLancement,
  mentionDeReprise,
  origineDeReprise,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Une carte interrompue se REPREND, elle ne repart pas de zéro         */
/* ------------------------------------------------------------------ */

const jamaisLancee = { column: 'planned' as const, scheduling: { attempts: 0, restarts: 0 } };
const coupee = {
  column: 'planned' as const,
  scheduling: { attempts: 1, restarts: 1, waitingReason: RAISON_COUPE_EN_VOL },
};

test('une carte jamais lancée n’est pas une reprise', () => {
  assert.equal(carteSeReprend(jamaisLancee), false);
  assert.equal(libelleDeLancement(jamaisLancee), LIBELLE_LANCER);
  assert.equal(mentionDeReprise(jamaisLancee), null);
  assert.equal(origineDeReprise(jamaisLancee), null);
});

test('une carte déjà lancée puis rendue à la file se reprend', () => {
  assert.equal(carteSeReprend(coupee), true);
  assert.equal(libelleDeLancement(coupee), LIBELLE_REPRENDRE);
  assert.equal(origineDeReprise(coupee), 'coupure');
  assert.match(mentionDeReprise(coupee) ?? '', /^Reprise :/);
});

test('un seul essai suffit : une carte relancée sans interruption se reprend aussi', () => {
  const relancee = { column: 'planned' as const, scheduling: { attempts: 1, restarts: 0 } };
  assert.equal(carteSeReprend(relancee), true);
  assert.equal(origineDeReprise(relancee), 'relance');
});

test('du code déjà enregistré suffit, même sans compteur', () => {
  const livree = { column: 'planned' as const, codeDejaEnregistre: true };
  assert.equal(carteSeReprend(livree), true);
});

test('chaque phrase d’interruption donne son origine', () => {
  const avec = (raison: string) => ({ column: 'planned' as const, scheduling: { attempts: 1, waitingReason: raison } });
  assert.equal(origineDeReprise(avec(RAISON_TOUR_SANS_ISSUE)), 'sans-issue');
  assert.equal(origineDeReprise(avec(RAISON_SANS_MODIFICATION)), 'sans-modification');
  assert.equal(origineDeReprise(avec(RAISON_SUSPENDU)), 'suspension');
});

test('hors de « Planifié », rien ne se reprend : le bouton n’y est pas', () => {
  assert.equal(carteSeReprend({ ...coupee, column: 'running' }), false);
  assert.equal(carteSeReprend({ ...coupee, column: 'done' }), false);
  assert.equal(carteSeReprend({ ...coupee, column: 'to_deploy' }), false);
});

test('le pied de colonne ne dit « Tout reprendre » que si TOUTES se reprennent', () => {
  assert.equal(libelleDuLotDeLancement([coupee, coupee]), 'Tout reprendre');
  assert.equal(libelleDuLotDeLancement([coupee, jamaisLancee]), 'Tout lancer');
  assert.equal(libelleDuLotDeLancement([]), 'Tout lancer');
});

test('la consigne de reprise sépare ce qui est fait de ce qui reste', () => {
  const texte = consigneDeReprise({
    origine: 'coupure',
    raison: RAISON_COUPE_EN_VOL,
    branche: 'tache/exemple-abc123',
    dossier: '/root/projet/.worktrees/exemple-abc123',
    codeDejaEnregistre: true,
    etapes: [
      { label: 'Lire les fichiers', etat: 'done' },
      { label: 'Écrire la règle', etat: 'running' },
      { label: 'Vérifier', etat: 'todo' },
    ],
  });
  assert.match(texte, /REPRISE D’UNE TÂCHE INTERROMPUE/);
  assert.match(texte, /ÉTAPES DÉJÀ FAITES/);
  assert.match(texte, /- Lire les fichiers/);
  assert.match(texte, /ÉTAPES QUI RESTENT/);
  assert.match(texte, /Écrire la règle \(commencée, coupée en route\)/);
  assert.match(texte, /tache\/exemple-abc123/);
  assert.match(texte, /ENREGISTRÉ sur la branche/);
  // Ce qui est fait n'est jamais redemandé.
  assert.equal(texte.split('ÉTAPES QUI RESTENT')[1].includes('Lire les fichiers'), false);
});

test('sans liste d’étapes, la consigne demande de CONSTATER avant de refaire', () => {
  const texte = consigneDeReprise({ origine: 'sans-issue' });
  assert.match(texte, /CONSTATER ce qui est déjà fait/);
  assert.match(texte, /Ne publie pas/);
});
