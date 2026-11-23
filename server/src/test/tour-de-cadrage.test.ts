import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONSIGNE_COMPREHENSION_RECLAMEE,
  comprehensionManquante,
  contradictionDuFlux,
  gesteDuParcours,
  issueAEcrire,
  issueDeLaRelance,
  pointsDuParcours,
  texteApresDeplacement,
} from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* 1. LE MANQUEMENT                                                     */
/* ------------------------------------------------------------------ */

test('un tour MUET — ni texte, ni compréhension — est un manquement', () => {
  assert.equal(comprehensionManquante({ comprehensionRendue: false }), true);
  assert.equal(comprehensionManquante({ comprehensionRendue: false, texteRendu: false }), true);
});

test('UN TOUR QUI A RÉPONDU EN TEXTE EST UNE DISCUSSION, pas un oubli : aucune relance', () => {
  assert.equal(comprehensionManquante({ comprehensionRendue: false, texteRendu: true }), false);
});

test('une compréhension rendue ne manque rien', () => {
  assert.equal(comprehensionManquante({ comprehensionRendue: true }), false);
});

test('les cinq exceptions écartent le manquement, dont la carte déplacée vers un autre projet', () => {
  for (const exception of ['questionPosee', 'echec', 'arretDemande', 'planDemande', 'carteDeplacee'] as const) {
    assert.equal(
      comprehensionManquante({ comprehensionRendue: false, [exception]: true }),
      false,
      exception,
    );
  }
});

/* ------------------------------------------------------------------ */
/* 2. LA RELANCE                                                        */
/* ------------------------------------------------------------------ */

test('la consigne de relance nomme les deux sorties : la compréhension, ou enfin une réponse', () => {
  assert.ok(CONSIGNE_COMPREHENSION_RECLAMEE.includes('rendre_comprehension'));
  assert.match(CONSIGNE_COMPREHENSION_RECLAMEE, /écris MAINTENANT ta réponse/);
  /* Plus aucun mot convenu à renvoyer pour justifier une simple réponse. */
  assert.doesNotMatch(CONSIGNE_COMPREHENSION_RECLAMEE, /REPONSE SEULE/);
});

test('la relance qui rend la compréhension rattrape le tour', () => {
  assert.equal(issueDeLaRelance({ comprehensionRendue: true, texte: '' }), 'cadrage');
});

test('la relance qui répond enfin en texte n’est pas un incident', () => {
  assert.equal(issueDeLaRelance({ comprehensionRendue: false, texte: 'Voici ma réponse.' }), 'reponse');
});

test('une relance muette pose l’incident', () => {
  assert.equal(issueDeLaRelance({ comprehensionRendue: false, texte: '' }), 'incident');
  assert.equal(issueDeLaRelance({ comprehensionRendue: false, texte: '   ' }), 'incident');
});

/* ------------------------------------------------------------------ */
/* 3. L'ISSUE ÉCRITE                                                    */
/* ------------------------------------------------------------------ */

test('un tour qui a cadré écrit « cadrage »', () => {
  assert.equal(issueAEcrire({ comprehensionRendue: true }), 'cadrage');
  assert.equal(issueAEcrire({ comprehensionRendue: false, relance: 'cadrage' }), 'cadrage');
});

test('un tour qui n’a fait que répondre écrit « reponse »', () => {
  assert.equal(issueAEcrire({ comprehensionRendue: false, relance: 'reponse' }), 'reponse');
  /* sans relance : il a parlé, c'est une discussion */
  assert.equal(issueAEcrire({ comprehensionRendue: false, texteRendu: true }), 'reponse');
  /* qui a parlé ET mis la compréhension à jour a cadré */
  assert.equal(issueAEcrire({ comprehensionRendue: true, texteRendu: true }), 'cadrage');
  /* un tour de plan se juge sous sa propre relance, pas comme une discussion */
  assert.equal(issueAEcrire({ comprehensionRendue: false, texteRendu: true, planDemande: true }), null);
});

test('un tour tombé, arrêté ou arrêté sur une question n’écrit AUCUNE issue', () => {
  assert.equal(issueAEcrire({ comprehensionRendue: true, echec: true }), null);
  assert.equal(issueAEcrire({ comprehensionRendue: true, arretDemande: true }), null);
  assert.equal(issueAEcrire({ comprehensionRendue: true, questionPosee: true }), null);
  assert.equal(issueAEcrire({ comprehensionRendue: false, relance: 'incident' }), null);
});

test('UN TOUR QUI A DÉPLACÉ SA CARTE n’est ni un manquement ni une issue à écrire', () => {
  assert.equal(comprehensionManquante({ comprehensionRendue: false, carteDeplacee: true }), false);
  assert.equal(issueAEcrire({ comprehensionRendue: false, carteDeplacee: true }), null);
  /* sans déplacement, l'oubli reste un manquement */
  assert.equal(comprehensionManquante({ comprehensionRendue: false, carteDeplacee: false }), true);
  /* déplacée MAIS déjà cadrée : l'issue « cadrage » s'écrit comme avant */
  assert.equal(issueAEcrire({ comprehensionRendue: true, carteDeplacee: true }), 'cadrage');
});

test('UN TOUR QUI A DÉPLACÉ SA CARTE N’ÉCRIT AUCUN TEXTE : le démon l’écarte lui-même', () => {
  const phrase = 'J’ai déplacé la carte dans le projet « Beluga » : ce projet-ci est la vitrine publique…';
  assert.equal(texteApresDeplacement({ texte: phrase, carteDeplacee: true }), '');
  /* …la compréhension rendue dans le tour ne change rien : elle est la réponse */
  assert.equal(texteApresDeplacement({ texte: phrase, carteDeplacee: true, echec: false }), '');
});

test('sans déplacement, ou avec un déplacement refusé, le texte du tour est gardé', () => {
  const texte = 'Voici ma réponse.';
  /* un déplacement refusé ne change pas le projet : `carteDeplacee` reste faux */
  assert.equal(texteApresDeplacement({ texte, carteDeplacee: false }), texte);
  /* un tour tombé, arrêté, ou qui attend une réponse garde ce qu'il a dit */
  assert.equal(texteApresDeplacement({ texte, carteDeplacee: true, echec: true }), texte);
  assert.equal(texteApresDeplacement({ texte, carteDeplacee: true, arretDemande: true }), texte);
  assert.equal(texteApresDeplacement({ texte, carteDeplacee: true, questionPosee: true }), texte);
});

/* ------------------------------------------------------------------ */
/* 4. L'ÉCRAN NE SE CONTREDIT PLUS                                      */
/* ------------------------------------------------------------------ */

const COMPREHENSION = { texte: 'Ce que j’ai compris de votre demande.', hypotheses: [], sujets: [], at: 1_000 };

test('LE DÉFAUT REPRODUIT : un jalon de demande perdu allumait le bouton au-dessus d’une étape « à venir »', () => {
  /* La carte PORTE sa compréhension, le journal n'a gardé aucun jalon : c'est
     l'état exact d'un tour coupé après l'appel de l'outil. */
  const parcours = { plans: [], comprehension: COMPREHENSION };
  const geste = gesteDuParcours({
    colonne: 'planned',
    messages: [{ role: 'user', content: 'fais ceci', at: 900 }],
    parcours,
    roleAgent: 'cadrage',
    tourEnCours: false,
  });
  assert.equal(geste.geste, 'valider-et-lancer');
  assert.equal(geste.possible, true, 'le bouton lit la carte : il est bien allumé');

  const points = pointsDuParcours([], {
    chapitre: 'cadrage',
    colonne: 'planned',
    parcours,
    tourEnCours: false,
    questionsOuvertes: 0,
  });
  const comprehension = points.find((p) => p.etape === 'comprehension');
  assert.equal(comprehension?.etat, 'fait', 'la ligne de temps dit la MÊME chose que le bouton');
  assert.equal(points.find((p) => p.etape === 'demande')?.etat, 'fait');
  assert.equal(contradictionDuFlux(points, geste), null);
});

test('UN TOUR DE RÉPONSE SEULE REFERME SON PASSAGE, même sans trace au journal', () => {
  const entrees = [
    {
      id: 'a',
      cardId: 'c1',
      rang: 1,
      at: 1_000,
      nature: 'jalon' as const,
      libelle: 'Demande',
      resultat: 'pourquoi ce choix ?',
      phase: 'cadrage' as const,
      tourId: 't1',
    },
  ];
  const sansIssue = pointsDuParcours(entrees, {
    chapitre: 'cadrage',
    colonne: 'planned',
    parcours: { plans: [] },
    tourEnCours: false,
    questionsOuvertes: 0,
  });
  assert.equal(
    sansIssue.find((p) => p.etape === 'comprehension')?.etat,
    'encours',
    'le défaut d’avant : le passage reste allumé faute de trace',
  );

  const avecIssue = pointsDuParcours(entrees, {
    chapitre: 'cadrage',
    colonne: 'planned',
    parcours: { plans: [], issueDuTour: { issue: 'reponse' as const, at: 2_000 } },
    tourEnCours: false,
    questionsOuvertes: 0,
  });
  const point = avecIssue.find((p) => p.etape === 'comprehension');
  assert.equal(point?.etat, 'fait');
  assert.match(point?.phrase ?? '', /répondu/);
});

test('l’incident de compréhension rougit SON point, jamais celui du plan', () => {
  const points = pointsDuParcours([], {
    chapitre: 'cadrage',
    colonne: 'planned',
    parcours: {
      plans: [],
      comprehension: COMPREHENSION,
      incident: { texte: 'rien n’est venu', at: 3_000, etape: 'comprehension' as const },
    },
    tourEnCours: false,
    questionsOuvertes: 0,
  });
  assert.equal(points.find((p) => p.etape === 'comprehension')?.etat, 'erreur');
  /* Et le plan, que cette carte n'a jamais demandé, n'a plus de point du tout :
     il ne peut donc pas hériter du rouge de l'étape d'avant. */
  assert.equal(points.find((p) => p.etape === 'plan'), undefined);
  assert.equal(points.find((p) => p.etape === 'comprehension')?.erreurs[0]?.action, 'relancer');
});

test('un incident d’avant, sans étape nommée, rougit toujours le plan', () => {
  const points = pointsDuParcours([], {
    chapitre: 'cadrage',
    colonne: 'planned',
    parcours: { plans: [], comprehension: COMPREHENSION, incident: { texte: 'pas de plan', at: 3_000 } },
    tourEnCours: false,
    questionsOuvertes: 0,
  });
  assert.equal(points.find((p) => p.etape === 'plan')?.etat, 'erreur');
});

test('la contradiction se NOMME : un bouton allumé au-dessus d’une étape « à venir »', () => {
  const points = [
    { etape: 'demande' as const, etat: 'fait' as const },
    { etape: 'comprehension' as const, etat: 'avenir' as const },
  ];
  assert.equal(contradictionDuFlux(points, { geste: 'valider-et-lancer', possible: true }), 'comprehension');
  assert.equal(contradictionDuFlux(points, { geste: 'valider-et-lancer', possible: false }), null);
  assert.equal(contradictionDuFlux(points, { geste: 'arreter', possible: true }), null);
});
