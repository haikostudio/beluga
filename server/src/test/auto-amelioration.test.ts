import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  AXES_D_EXAMEN,
  FENETRE_HEURES,
  HEURE_RENDEZ_VOUS,
  PERIODE_MS,
  PROPOSITIONS_MAX,
  consigneDAutoAmelioration,
  decisionDuRendezVous,
  heureDuRendezVous,
  raisonDite,
  titreDuRendezVous,
} from '@haikodev/shared';

/*
 * LE RENDEZ-VOUS D'AUTO-AMÉLIORATION (voir [[auto-amelioration]]).
 *
 * Ce que ces tests verrouillent, dans l'ordre de ce qui coûterait cher :
 *   1. le rendez-vous ne part JAMAIS en pleine journée — c'est la réserve du
 *      jour qu'on protège, et un agent d'analyse n'est pas gratuit ;
 *   2. il ne part pas non plus quand un travail est en cours ;
 *   3. un seul passage par nuit ;
 *   4. la consigne dit bien à l'agent de ne rien modifier et de se tenir à
 *      quelques propositions.
 */

const NUIT = (heure: number) => new Date(2026, 7, 13, heure, 20).getTime();

function base(surcharges: Partial<Parameters<typeof decisionDuRendezVous>[0]> = {}) {
  return decisionDuRendezVous({
    projetPresent: true,
    dernierPassage: undefined,
    maintenant: NUIT(HEURE_RENDEZ_VOUS),
    heureCourante: HEURE_RENDEZ_VOUS,
    travauxEnCours: 0,
    ...surcharges,
  });
}

test('à 3 h, sans travail en cours et sans passage du jour, le rendez-vous part', () => {
  assert.deepEqual(base(), { lancer: true });
});

test('en pleine journée, le rendez-vous ne part jamais', () => {
  for (const heure of [8, 11, 14, 17, 20, 22]) {
    const decision = base({ heureCourante: heure, maintenant: NUIT(heure) });
    assert.deepEqual(
      decision,
      { lancer: false, raison: 'pas-l-heure' },
      `il ne doit rien partir à ${heure} h : c'est la réserve de la journée`,
    );
  }
});

test('la fenêtre couvre 3 h, 4 h et 5 h, et rien d’autre', () => {
  for (let pas = 0; pas < FENETRE_HEURES; pas += 1) {
    assert.ok(heureDuRendezVous(HEURE_RENDEZ_VOUS + pas), `${HEURE_RENDEZ_VOUS + pas} h est dans la fenêtre`);
  }
  assert.equal(heureDuRendezVous(HEURE_RENDEZ_VOUS - 1), false, 'juste avant, non');
  assert.equal(heureDuRendezVous(HEURE_RENDEZ_VOUS + FENETRE_HEURES), false, 'juste après, non plus');
});

test('un travail en cours REPORTE le rendez-vous, il ne l’annule pas', () => {
  const reporte = base({ travauxEnCours: 1 });
  assert.deepEqual(reporte, { lancer: false, raison: 'travail-en-cours' });
  // Une heure plus tard, toujours dans la fenêtre : il repart tout seul.
  assert.deepEqual(base({ heureCourante: HEURE_RENDEZ_VOUS + 1, travauxEnCours: 0 }), { lancer: true });
});

test('un seul rendez-vous par nuit', () => {
  const passage = NUIT(HEURE_RENDEZ_VOUS);
  assert.deepEqual(base({ dernierPassage: passage, maintenant: passage + 60_000 }), {
    lancer: false,
    raison: 'deja-passe',
  });
  // Vingt-quatre heures plus tard, la nuit suivante a lieu.
  assert.deepEqual(base({ dernierPassage: passage, maintenant: passage + PERIODE_MS }), { lancer: true });
});

test('sans projet à examiner, rien ne part', () => {
  assert.deepEqual(base({ projetPresent: false }), { lancer: false, raison: 'projet-absent' });
});

test('chaque raison de sauter se dit en français', () => {
  for (const raison of ['pas-l-heure', 'deja-passe', 'travail-en-cours', 'projet-absent'] as const) {
    const dite = raisonDite(raison);
    assert.ok(dite.length > 10, `« ${raison} » doit se dire en clair, pas en code`);
    assert.ok(!dite.includes(raison), 'une raison dite ne recopie pas son code technique');
  }
});

test('la consigne interdit de modifier quoi que ce soit et plafonne les propositions', () => {
  const consigne = consigneDAutoAmelioration('HaikoDev');
  assert.match(consigne, /TU NE MODIFIES RIEN/, "l'interdit d'écrire doit être écrit en toutes lettres");
  assert.match(consigne, /propose_task/, 'la seule sortie du tour est une proposition de carte');
  assert.ok(
    consigne.includes(String(PROPOSITIONS_MAX)),
    'le plafond de propositions vient de la constante partagée, jamais recopié à la main',
  );
  assert.match(consigne, /HaikoDev/, 'le projet examiné est nommé');
  // Les six axes de recherche partent tous : la liste EST le rendez-vous.
  for (const axe of AXES_D_EXAMEN) assert.ok(consigne.includes(axe), `axe manquant : ${axe.slice(0, 40)}…`);
});

test('la consigne autorise une nuit sans rien à proposer', () => {
  const consigne = consigneDAutoAmelioration('HaikoDev');
  assert.match(consigne, /sans rien à proposer est une nuit normale/, 'ne rien trouver ne doit pas forcer la main');
});

test('le titre de la conversation porte la date de la nuit', () => {
  const titre = titreDuRendezVous(new Date(2026, 7, 13, 3, 0));
  assert.match(titre, /13\.08\.2026/, 'la date rend les nuits distinguables dans la liste des agents');
});

/*
 * Le branchement, vérifié sur le TEXTE du démon : sans lui, les règles
 * ci-dessus seraient justes et le rendez-vous n'aurait jamais lieu.
 */
test('la veille du rendez-vous est bien démarrée par le démon, et arrêtée à l’extinction', () => {
  const main = fs.readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8');
  assert.match(main, /planifierAutoAmelioration\(\)/, 'la veille doit être lancée au démarrage');
  assert.match(main, /clearInterval\(autoAmeliorationTimer\)/, "et arrêtée à l'extinction du démon");
  assert.doesNotMatch(
    main,
    /rendezVousDAutoAmelioration\(\s*\{[^}]*auDemarrage/,
    'aucun rattrapage au démarrage : ce serait une analyse en pleine journée',
  );
});
