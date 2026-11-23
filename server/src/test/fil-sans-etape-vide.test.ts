import assert from 'node:assert/strict';
import test from 'node:test';
import { JALON_COMPREHENSION, JALON_PLAN_DEMANDE, JALON_PLAN_PROPOSE, PHRASE_ETAPE_SAUTEE, pointsDuParcours } from '@beluga/shared';

/*
 * UNE ÉTAPE COCHÉE A TOUJOURS SON CONTENU, ET UN PLAN RENDU N'EN OUVRE PAS UN
 * SECOND (demande du 14.09.2026).
 */

const passage = (points: any[], etape: string, rang = 1) => points.find((p) => p.etape === etape && p.rang === rang);

test('une carte sans journal ne coche plus aucune étape vide', () => {
  const points = pointsDuParcours([], { chapitre: 'rapport', colonne: 'to_deploy', tourEnCours: false, parcours: null });
  /* « Plan » n'est pas de la liste : cette carte n'en a jamais eu, son point
     n'existe donc plus du tout (il n'y a rien à ne pas cocher). */
  assert.equal(points.filter((p: any) => p.etape === 'plan').length, 0);
  for (const etape of ['demande', 'comprehension', 'travail', 'rapport']) {
    const point = passage(points, etape);
    assert.ok(point, etape);
    assert.notEqual(point.etat, 'fait', `${etape} ne doit pas être cochée`);
    assert.equal(point.sautee, true, etape);
    assert.equal(point.phrase, PHRASE_ETAPE_SAUTEE, etape);
  }
});

test('ce que la carte porte remplit les étapes : description, compréhension, plan', () => {
  const points = pointsDuParcours([], {
    chapitre: 'rapport',
    colonne: 'to_deploy',
    tourEnCours: false,
    descriptionDeLaCarte: 'Retirer l’ancienne mémoire.',
    creeeA: 5000,
    parcours: {
      comprehension: { texte: 'J’ai compris.', hypotheses: [], sujets: [], at: 6000 },
      plans: [{ numero: 2, titre: 'Plan', resume: '', texte: '# Plan', at: 7000 }],
    },
  });
  const demande = passage(points, 'demande');
  assert.equal(demande.etat, 'fait');
  assert.equal(demande.moments[0].sorte, 'demande');
  assert.equal(demande.moments[0].entree.resultat, 'Retirer l’ancienne mémoire.');
  assert.equal(passage(points, 'comprehension').moments[0].entree.resultat, 'J’ai compris.');
  const plan = passage(points, 'plan');
  assert.equal(plan.etat, 'fait');
  assert.equal(plan.moments[0].version, 2);
  // Rien d'enregistré pour le travail : sautée, pas cochée.
  assert.equal(passage(points, 'travail').sautee, true);
});

test('l’analyse jointe à une proposition tient lieu de compréhension', () => {
  const points = pointsDuParcours([], {
    chapitre: 'rapport',
    colonne: 'archived',
    tourEnCours: false,
    parcours: null,
    analyseDeLaCarte: 'Constat de la nuit.',
  });
  assert.equal(passage(points, 'comprehension').moments[0].entree.resultat, 'Constat de la nuit.');
});

test('un plan rendu sous un tour qui vit encore ne fait qu’UN point « Plan »', () => {
  let rang = 0;
  const e = (partiel: Record<string, unknown>) => ({ id: `e${rang}`, cardId: 'c', rang: rang++, at: 1000 + rang, phase: 'cadrage', ...partiel }) as any;
  const journal = [
    e({ nature: 'jalon', libelle: 'Demande', resultat: 'Fais X.' }),
    e({ nature: 'jalon', libelle: JALON_PLAN_PROPOSE, resultat: '# Plan', donnees: '{"version":1}' }),
  ];
  const points = pointsDuParcours(journal, {
    chapitre: 'plan',
    colonne: 'planned',
    tourEnCours: true,
    parcours: { plans: [{ numero: 1, titre: 'Plan', resume: '', texte: '# Plan', at: 1002 }] },
  });
  const plans = points.filter((p) => p.etape === 'plan');
  assert.equal(plans.length, 1, plans.map((p) => `${p.etape} ${p.etat}`).join(', '));
  assert.equal(plans[0].etat, 'fait');
});

/*
 * UNE COMPRÉHENSION RENDUE N'EN OUVRE PAS UNE SECONDE (demande du 29.09.2026).
 * Le tour qui vient d'appeler `rendre_comprehension` vit encore : le fil ouvrait
 * « L'agent lit le projet… » sous le premier point, puis le retirait.
 */
const cadrageRendu = () => {
  let rang = 0;
  const e = (at: number, partiel: Record<string, unknown>) =>
    ({ id: `e${rang}`, cardId: 'c', rang: rang++, at, phase: 'cadrage', agentRole: 'cadrage', nature: 'jalon', ...partiel }) as any;
  return {
    e,
    journal: [
      e(1000, { libelle: 'Demande', resultat: 'Fais X.' }),
      e(2000, { libelle: JALON_COMPREHENSION, resultat: 'Compris X.', tourId: 't1' }),
    ],
  };
};

test('une compréhension rendue sous un tour qui vit encore ne fait qu’UN point, fait, avec son résumé', () => {
  const { journal } = cadrageRendu();
  journal[1].donnees = JSON.stringify({ resume: 'Le fil garde un seul point.' });
  const points = pointsDuParcours(journal, {
    chapitre: 'cadrage',
    colonne: 'planned',
    tourEnCours: true,
    parcours: { comprehension: { texte: 'Compris X.', hypotheses: [], sujets: [], at: 2000 }, plans: [] },
  });
  const comprehensions = points.filter((p) => p.etape === 'comprehension');
  assert.equal(comprehensions.length, 1, comprehensions.map((p) => `${p.rang} ${p.etat}`).join(', '));
  assert.equal(comprehensions[0].etat, 'fait');
  assert.equal(comprehensions[0].moments.length, 1);
  assert.equal(points.filter((p) => p.etat === 'encours').length, 0);
});

test('une nouvelle demande après la compréhension rendue, tour vivant, ouvre un second point en cours', () => {
  const { e, journal } = cadrageRendu();
  journal.push(e(3000, { libelle: 'Demande', resultat: 'Ajoute Y.' }));
  const points = pointsDuParcours(journal, {
    chapitre: 'cadrage',
    colonne: 'planned',
    tourEnCours: true,
    parcours: { comprehension: { texte: 'Compris X.', hypotheses: [], sujets: [], at: 2000 }, plans: [] },
  });
  const comprehensions = points.filter((p) => p.etape === 'comprehension');
  assert.equal(comprehensions.length, 2);
  assert.equal(comprehensions[0].etat, 'fait');
  assert.equal(comprehensions[1].etat, 'encours');
});

/*
 * L'INTERRUPTEUR « PLAN » : LA NOUVELLE ITÉRATION S'AJOUTE EN BAS (carte
 * « Atelier marketing », 23.09.2026). « Plan demandé » était noté 5 ms AVANT la
 * « Demande » du même message : le passage du plan s'ouvrait au-dessus d'elle.
 */
const iterationAvecInterrupteur = (planAvantDemande: boolean) => {
  let rang = 0;
  const e = (at: number, partiel: Record<string, unknown>) =>
    ({ id: `e${rang}`, cardId: 'c', rang: rang++, at, phase: 'cadrage', agentRole: 'cadrage', nature: 'jalon', ...partiel }) as any;
  const demandeV2 = () => e(10_005, { libelle: 'Demande', resultat: 'Ajoute Y.' });
  const planV2 = () => e(10_000, { libelle: JALON_PLAN_DEMANDE, resultat: 'Version 2 demandée.' });
  return [
    e(1000, { libelle: 'Demande', resultat: 'Fais X.' }),
    e(2000, { libelle: JALON_COMPREHENSION, resultat: 'Compris X.', tourId: 't1' }),
    e(3000, { libelle: JALON_PLAN_DEMANDE, resultat: 'Première version demandée.' }),
    e(4000, { libelle: JALON_PLAN_PROPOSE, resultat: '# Plan 1', donnees: '{"version":1}', tourId: 't2' }),
    ...(planAvantDemande ? [planV2(), demandeV2()] : [demandeV2(), planV2()]),
    e(11_000, { nature: 'action', libelle: 'Lecture', tourId: 't3' }),
    e(12_000, { libelle: JALON_COMPREHENSION, resultat: 'Compris Y.', tourId: 't3' }),
    e(13_000, { libelle: JALON_PLAN_PROPOSE, resultat: '# Plan 2', donnees: '{"version":2}', tourId: 't3' }),
  ];
};

for (const planAvantDemande of [true, false]) {
  test(`une itération demandée avec l’interrupteur se lit Demande → Compréhension → Plan en bas (jalon ${planAvantDemande ? 'avant' : 'après'} la demande)`, () => {
    const points = pointsDuParcours(iterationAvecInterrupteur(planAvantDemande), {
      chapitre: 'plan',
      colonne: 'planned',
      tourEnCours: false,
      parcours: {
        plans: [
          { numero: 1, titre: 'Plan', resume: '', texte: '# Plan 1', at: 4000 },
          { numero: 2, titre: 'Plan', resume: '', texte: '# Plan 2', at: 13_000 },
        ],
      },
    });
    const vus = points.filter((p: any) => p.moments.length).map((p: any) => `${p.etape}${p.rang}`);
    assert.deepEqual(vus.slice(0, 6), ['demande1', 'comprehension1', 'plan1', 'demande2', 'comprehension2', 'plan2']);
    /* Le plan précédent reste tel qu'il était : sa seule version, rien de neuf. */
    const ancien = passage(points, 'plan', 1);
    assert.deepEqual(ancien.moments.map((m: any) => m.sorte), ['plan-demande', 'plan']);
    const nouveau = passage(points, 'plan', 2);
    assert.deepEqual(nouveau.moments.map((m: any) => m.sorte), ['plan-demande', 'plan']);
    assert.equal(points.filter((p: any) => p.etape === 'plan').length, 2);
  });
}

test('le plan demandé avec le message, tour encore vivant, se pose sous la nouvelle demande', () => {
  const journal = iterationAvecInterrupteur(true).slice(0, 6);
  const points = pointsDuParcours(journal, {
    chapitre: 'cadrage',
    colonne: 'planned',
    tourEnCours: true,
    parcours: { plans: [{ numero: 1, titre: 'Plan', resume: '', texte: '# Plan 1', at: 4000 }], planDemandeA: 10_000 },
  });
  const ordre = points.map((p: any) => `${p.etape}${p.rang}`);
  assert.ok(ordre.indexOf('demande2') < ordre.indexOf('plan2'), ordre.join(', '));
  assert.ok(ordre.indexOf('plan1') < ordre.indexOf('demande2'), ordre.join(', '));
  assert.deepEqual(passage(points, 'plan', 1).moments.map((m: any) => m.sorte), ['plan-demande', 'plan']);
});
