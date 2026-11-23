import test from 'node:test';
import assert from 'node:assert/strict';

/*
 * LE CHEMIN DU TOURNAGE (22/10/2026) : sept étapes visibles, une équipe qui se
 * passe le relais, une petite enveloppe d'aperçus demandée au début et un
 * tableau d'ambiance — tout se déduit de la carte, jamais des messages.
 */
const {
  ENVELOPPE_MAXIMALE,
  JALONS_DE_REALISATION,
  PHASES_DE_REALISATION,
  JALON_DE_LA_PHASE,
  ajouterALAmbiance,
  cheminDeLaRealisation,
  decisionDApercu,
  estUnApercu,
  lireAvancementDeRealisation,
  realisationNeuve,
  roleDuJalon,
} = await import('@beluga/shared');

test('chaque rubrique du questionnaire tombe dans une des quatre étapes d’avant le lancement', () => {
  for (const phase of PHASES_DE_REALISATION) {
    assert.ok(['idee', 'style', 'scenario', 'budget'].includes(JALON_DE_LA_PHASE[phase]), phase);
  }
  assert.deepEqual([...JALONS_DE_REALISATION], ['idee', 'style', 'scenario', 'budget', 'fabrication', 'montage', 'livre']);
});

test('sans types de média : étape Idée, le directeur créatif parle', () => {
  const c = cheminDeLaRealisation({ column: 'planned', realisation: realisationNeuve() });
  assert.equal(c.jalon, 'idee');
  assert.equal(c.role, 'directeur-createur');
  assert.equal(c.etapes[0]!.etat, 'encours');
  assert.equal(c.etapes[1]!.etat, 'avenir');
  assert.deepEqual(c.suivant, { jalon: 'style', role: 'directeur-artistique' });
});

test('types choisis, pas d’idée encore : le producteur prend la parole', () => {
  const c = cheminDeLaRealisation({ column: 'planned', realisation: { ...realisationNeuve(), medias: ['video'] } });
  assert.equal(c.jalon, 'idee');
  assert.equal(c.role, 'producteur');
});

test('le relais suit la rubrique en cours', () => {
  const base = { ...realisationNeuve(), medias: ['video' as const], enveloppe: 1 };
  assert.equal(cheminDeLaRealisation({ column: 'planned', realisation: { ...base, phase: 'direction' } }).role, 'directeur-artistique');
  const scenario = cheminDeLaRealisation({ column: 'planned', realisation: { ...base, phase: 'plans' } });
  assert.equal(scenario.jalon, 'scenario');
  assert.equal(scenario.role, 'realisateur');
  assert.deepEqual(scenario.etapes.slice(0, 3).map((e) => e.etat), ['fait', 'fait', 'encours']);
  assert.equal(cheminDeLaRealisation({ column: 'planned', realisation: { ...base, phase: 'scenario' } }).role, 'scenariste');
  assert.equal(cheminDeLaRealisation({ column: 'planned', realisation: { ...base, phase: 'son' } }).role, 'ingenieur-son');
  assert.equal(cheminDeLaRealisation({ column: 'planned', realisation: { ...base, phase: 'montage' } }).role, 'monteur');
  assert.equal(cheminDeLaRealisation({ column: 'planned', realisation: { ...base, phase: 'controle' } }).role, 'directeur-createur');
  const budget = cheminDeLaRealisation({ column: 'planned', realisation: { ...base, phase: 'budget' } });
  assert.equal(budget.jalon, 'budget');
  assert.equal(budget.role, 'producteur');
});

test('cahier terminé : la fabrication attend le clic ; au travail : en cours ; rendu : livré', () => {
  const fini = { ...realisationNeuve(), medias: ['image' as const], phase: 'budget' as const, termineA: 5 };
  const pret = cheminDeLaRealisation({ column: 'planned', realisation: fini });
  assert.equal(pret.jalon, 'fabrication');
  assert.equal(pret.etapes[4]!.etat, 'pret');
  const auTravail = cheminDeLaRealisation({ column: 'running', realisation: fini });
  assert.equal(auTravail.etapes[4]!.etat, 'encours');
  assert.deepEqual(auTravail.suivant, { jalon: 'montage', role: 'monteur' });
  const livre = cheminDeLaRealisation({ column: 'done', realisation: fini });
  assert.equal(livre.jalon, 'livre');
  assert.ok(livre.etapes.every((e) => e.etat === 'fait'));
  assert.equal(livre.suivant, undefined);
});

test('au travail, le montage annoncé allume l’étape Montage, le monteur parle ; rendu : livré', () => {
  const fini = { ...realisationNeuve(), medias: ['video' as const], phase: 'budget' as const, termineA: 5 };
  assert.equal(cheminDeLaRealisation({ column: 'running', realisation: fini }).jalon, 'fabrication');
  const monte = { ...fini, montageA: 9 };
  const auMontage = cheminDeLaRealisation({ column: 'running', realisation: monte });
  assert.equal(auMontage.jalon, 'montage');
  assert.equal(auMontage.role, 'monteur');
  assert.equal(auMontage.etapes[4]!.etat, 'fait');
  assert.equal(auMontage.etapes[5]!.etat, 'encours');
  assert.deepEqual(auMontage.suivant, { jalon: 'livre', role: 'monteur' });
  /* Avant le lancement, un montage posé ne saute pas le clic. */
  assert.equal(cheminDeLaRealisation({ column: 'planned', realisation: monte }).etapes[4]!.etat, 'pret');
  assert.equal(cheminDeLaRealisation({ column: 'review', realisation: monte }).jalon, 'livre');
});

test('une carte d’avant (ancien genre, sans enveloppe ni ambiance) se lit encore', () => {
  const c = cheminDeLaRealisation({ column: 'planned', realisation: { genre: 'video', phase: 'scenario' } as never });
  assert.equal(c.jalon, 'scenario');
  assert.equal(roleDuJalon('style'), 'directeur-artistique');
});

test('l’enveloppe se lit dans l’outil, bornée, et survit aux réécritures', () => {
  const avant = { ...realisationNeuve(), medias: ['video' as const] };
  const lu = lireAvancementDeRealisation({ faites: 2, phase: 'intention', enveloppe: '1,5' }, avant, 10);
  assert.ok(lu.ok);
  assert.equal(lu.ok && lu.realisation.enveloppe, 1.5);
  const ensuite = lireAvancementDeRealisation({ faites: 3, phase: 'format' }, lu.ok ? lu.realisation : avant, 11);
  assert.equal(ensuite.ok && ensuite.realisation.enveloppe, 1.5);
  assert.equal(lireAvancementDeRealisation({ faites: 2, phase: 'intention', enveloppe: ENVELOPPE_MAXIMALE + 1 }, avant, 10).ok, false);
  assert.equal(lireAvancementDeRealisation({ faites: 2, phase: 'intention', enveloppe: -1 }, avant, 10).ok, false);
});

test('la porte des aperçus : rien sans enveloppe, rien sans prix publié, jamais au-delà', () => {
  /* L'enveloppe est posée d'office à 1 $ (25/10/2026) : sans réglage, un aperçu au prix publié part. */
  assert.equal(decisionDApercu({ enveloppe: undefined, prix: 0.01, depense: 0 }).verdict, 'libre');
  assert.equal(decisionDApercu({ enveloppe: undefined, prix: 0.03, depense: 0.99 }).verdict, 'refus');
  assert.equal(decisionDApercu({ enveloppe: 0, prix: 0.01, depense: 0 }).verdict, 'refus');
  assert.equal(decisionDApercu({ enveloppe: 1, prix: null, depense: 0 }).verdict, 'refus');
  assert.equal(decisionDApercu({ enveloppe: 1, prix: 0.03, depense: 0.5 }).verdict, 'libre');
  assert.equal(decisionDApercu({ enveloppe: 1, prix: 0.03, depense: 0.99 }).verdict, 'refus');
  assert.equal(decisionDApercu({ enveloppe: 1, prix: 0.03, depense: 1 }).verdict, 'refus');
  assert.ok(estUnApercu('apercu-direction-1'));
  assert.ok(!estUnApercu('plan-1'));
});

test('le tableau d’ambiance garde chaque pièce une seule fois, et la réécriture ne le perd pas', () => {
  const r = ajouterALAmbiance({ ...realisationNeuve(), medias: ['image'] }, [{ piece: 'a', phase: 'direction' }], 1);
  const r2 = ajouterALAmbiance(r, [{ piece: 'a', phase: 'direction' }, { piece: 'b', phase: 'personnages', legende: 'Héros' }], 2);
  assert.deepEqual(r2.ambiance?.map((p) => p.piece), ['a', 'b']);
  const relu = lireAvancementDeRealisation({ faites: 4, phase: 'plans' }, r2, 3);
  assert.deepEqual(relu.ok && relu.realisation.ambiance?.map((p) => p.piece), ['a', 'b']);
});
