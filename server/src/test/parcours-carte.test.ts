import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CHAPITRES_DU_PARCOURS,
  INCIDENT_PLAN_NON_RENDU,
  LIBELLES_GESTE,
  LIBELLE_NE_PAS_ATTENDRE,
  libelleDeValidation,
  lancementScinde,
  RAISONS_DU_GESTE,
  TITRE_CARTE_DE_CADRAGE,
  chapitreDuParcours,
  blocDuDernierPlan,
  consigneDAffinageDuPlan,
  consigneDeRenduDuPlan,
  decisionsDuParcours,
  descriptionDepuisLePlanRendu,
  gesteDuParcours,
  gestesDuParcours,
  jugerLePlan,
  lireComprehensionRendue,
  HYPOTHESES_MAX,
  lirePlanRendu,
  numeroDuProchainPlan,
  planCourant,
  planManquant,
  planValidePourLaVersionCourante,
  comprehensionValideePourLaVersionCourante,
  versionCouranteDuPlan,
  comprehensionApresLePlan,
  rendrePlan,
  rangerLePlan,
  etapeDeCarteAbandonnee,
  cartePrisonniereDuCadrage,
  DELAI_ETAPE_SANS_TOUR_MS,
  decisionsEnAttente,
  tourNonAbouti,
  travailDExecutionLance,
  Agent,
  Message,
  planEnTexteSimple,
} from '@beluga/shared';

/* Une base jetable : les deux outils du parcours passent par le VRAI démon. */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'parcours-carte-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const { callTool, createCard } = await import('../tools.js');
const { validerLaComprehension, decisionOuverteSurLaCarte } = await import('../scheduler.js');

/* ------------------------------------------------------------------ */
/* LA VALIDATION DE LA COMPRÉHENSION EST UN ÉTAT DE LA CARTE, ÉCRIT UNE FOIS */
/* ------------------------------------------------------------------ */

const COMPREHENSION_ECRITE = (at: number) => ({
  texte: 'Ce que j’ai compris.',
  hypotheses: [],
  sujets: [],
  at,
});

test('valider la compréhension l’écrit sur la carte avec son niveau, sans aucun tour', () => {
  const projet = store.saveProject({
    id: store.newId(),
    name: 'Essai compréhension validée',
    path: '/tmp/essai-comprehension-validee',
    isSelf: false,
    rank: 1,
    archived: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as any);
  const carte = createCard(projet.id, { title: 'À valider', column: 'planned' } as any);
  assert.equal(validerLaComprehension(carte.id).ok, false, 'sans compréhension, rien à valider');

  const comprise = store.saveCard({
    ...store.getCard(carte.id)!,
    parcours: { plans: [], comprehension: COMPREHENSION_ECRITE(7) },
  });
  /* Sans niveau transmis, la validation part quand même en « Approfondi ». */
  const resultat = validerLaComprehension(comprise.id);
  assert.equal(resultat.ok, true);
  const relue = store.getCard(comprise.id)!;
  assert.deepEqual(
    {
      visee: relue.parcours?.comprehensionValidee?.comprehensionAt,
      niveau: relue.parcours?.comprehensionValidee?.niveau,
    },
    { visee: 7, niveau: 'approfondi' },
    'la compréhension AFFICHÉE est validée, avec le niveau retenu',
  );
  assert.equal(relue.run.niveau, 'approfondi', 'le niveau choisi devient celui de la carte');
  assert.equal(relue.analyseDemandee, true, 'valider autorise la carte');
  assert.equal(relue.column, 'planned', 'et la carte ne bouge pas : rien ne part au moteur');
  assert.equal(comprehensionValideePourLaVersionCourante(relue.parcours), true);

  /* UN PLAN N'EST PLUS REQUIS : une carte qui n'en porte aucun se valide et
     part. C'est tout l'objet du changement. */
  assert.equal((relue.parcours?.plans ?? []).length, 0);

  /* UNE COMPRÉHENSION RENDUE ENSUITE PÉRIME LA DÉCISION : on revalide. */
  const affinee = {
    ...relue.parcours!,
    comprehension: COMPREHENSION_ECRITE(9),
  };
  assert.equal(comprehensionValideePourLaVersionCourante(affinee), false);

  /* Revalider la même compréhension ne réécrit rien ; une carte lancée ne se valide plus. */
  const at = relue.parcours!.comprehensionValidee!.at;
  assert.equal(validerLaComprehension(comprise.id).ok, true);
  assert.equal(store.getCard(comprise.id)!.parcours?.comprehensionValidee?.at, at);
  store.saveCard({ ...store.getCard(comprise.id)!, column: 'running' });
  assert.equal(validerLaComprehension(comprise.id).ok, false);
  assert.equal(decisionOuverteSurLaCarte(comprise.id), null, 'aucune décision ouverte : le lancement est libre');

  /* UNE CARTE QUI PORTE UN MODÈLE LE GARDE : le réglage visible au clic est celui qui part. */
  const choisie = store.saveCard({
    ...createCard(projet.id, { title: 'Compréhension au modèle choisi', column: 'planned' } as any),
    run: { engine: 'claude', model: 'claude-sonnet-5', thinking: 'medium' } as any,
    parcours: { plans: [], comprehension: COMPREHENSION_ECRITE(3) },
  });
  assert.equal(validerLaComprehension(choisie.id, 'approfondi').ok, true);
  const gardee = store.getCard(choisie.id)!;
  assert.equal(gardee.run.model, 'claude-sonnet-5');
  assert.equal(gardee.run.thinking, 'medium');
  assert.equal(gardee.run.niveau, undefined, 'le palier « Approfondi » ne s’y superpose plus');
});

test('un PLAN VALIDÉ d’avant le changement vaut toujours décision : rien n’est rétroactif', () => {
  const ancienne = {
    plans: [{ numero: 1, titre: 'P', resume: '', texte: '# P', at: 1 }],
    planValide: { version: 1, at: 2 },
  };
  assert.equal(comprehensionValideePourLaVersionCourante(ancienne as any), true);
  /* Une version suivante du plan périme cette validation-là, comme avant. */
  assert.equal(
    comprehensionValideePourLaVersionCourante({
      ...ancienne,
      plans: [...ancienne.plans, { numero: 2, titre: 'P2', resume: '', texte: '# P2', at: 3 }],
    } as any),
    false,
  );
});

test('« Reprendre » sur une limite de compte : le refus MÈNE à la décision, qui propose moteur et modèle', () => {
  const projet = store.saveProject({
    id: store.newId(),
    name: 'Essai reprise bloquée',
    path: '/tmp/essai-reprise-bloquee',
    isSelf: false,
    rank: 2,
    archived: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as any);
  const carte = createCard(projet.id, { title: 'Coupée par le quota', column: 'planned' } as any);
  const agent = store.saveAgent(
    Agent.parse({
      id: store.newId(),
      projectId: projet.id,
      cardId: carte.id,
      title: 'essai',
      role: 'task',
      status: 'idle',
      run: { engine: 'claude' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  store.saveMessage(
    Message.parse({
      id: store.newId(),
      agentId: agent.id,
      role: 'assistant',
      content: "You've hit your weekly limit · resets 4pm (UTC)",
      createdAt: Date.now(),
      repriseCompte: {
        engine: 'claude',
        compteEpuise: 'claude-secondary',
        compteEpuiseLabel: 'Claude Max x20',
        motif: 'limite-structuree',
        at: Date.now(),
      },
    }),
  );
  const raison = decisionOuverteSurLaCarte(carte.id);
  assert.ok(raison, 'une reprise en attente retient toujours le lancement côté démon');
  assert.match(raison!, /Une décision attend/, 'le refus nomme l’endroit où se prend la décision');
  assert.match(raison!, /moteur ou modèle/, 'et dit qu’on peut y changer de moteur ou de modèle');
  assert.doesNotMatch(raison!, /choisissez d'abord sur quel compte poursuivre\.$/);
});

/* ------------------------------------------------------------------ */
/* LE PARCOURS EST UN ÉTAT ÉCRIT SUR LA CARTE, JAMAIS UNE DÉDUCTION     */
/* ------------------------------------------------------------------ */

const PLAN = { numero: 1, titre: 'P', resume: 'r', texte: '# P', at: 1 };
const DIALOGUE = [
  { role: 'user', content: 'Je veux un bouton' },
  { role: 'assistant', content: 'Compris.' },
];

test('les cinq chapitres, dans cet ordre', () => {
  /* « Préparation » se glisse entre le plan et le travail : c'est ce qui se
     passe entre le clic sur « Lancer » et le premier mot du moteur. */
  assert.deepEqual([...CHAPITRES_DU_PARCOURS], ['cadrage', 'plan', 'preparation', 'travail', 'rapport']);
});

test('le chapitre se lit sur la carte et sa colonne, jamais dans le texte', () => {
  const base = { roleAgent: 'cadrage', tourEnCours: false, messages: DIALOGUE };
  assert.equal(chapitreDuParcours({ ...base, colonne: 'planned' }), 'cadrage');
  assert.equal(chapitreDuParcours({ ...base, colonne: 'planned', parcours: { plans: [PLAN] } }), 'plan');
  /* Un plan écrit en clair dans un message ne fait pas un chapitre : seule la carte compte. */
  assert.equal(
    chapitreDuParcours({
      ...base,
      colonne: 'planned',
      messages: [{ role: 'assistant', content: '# P\n## Faisabilité\n## Chemin à suivre\n## Conséquences\n## Améliorations apportées' }],
    }),
    'cadrage',
  );
  assert.equal(chapitreDuParcours({ ...base, colonne: 'running', roleAgent: 'task', tourEnCours: true }), 'travail');
  assert.equal(chapitreDuParcours({ ...base, colonne: 'running', roleAgent: 'task' }), 'rapport');
  assert.equal(chapitreDuParcours({ ...base, colonne: 'to_deploy', roleAgent: 'task' }), 'rapport');
  assert.equal(chapitreDuParcours({ ...base, colonne: 'archived', roleAgent: 'task' }), 'rapport');
  /* Une carte interrompue — agent de tâche, revenue en « Planifié » — est au travail. */
  assert.equal(chapitreDuParcours({ ...base, colonne: 'planned', roleAgent: 'task' }), 'travail');
});

test('le geste principal rend toujours son bouton ET sa raison quand il est éteint', () => {
  const cadrage = { colonne: 'planned' as const, roleAgent: 'cadrage', tourEnCours: false, messages: DIALOGUE };
  // Rien dit : le geste existe, éteint, et dit pourquoi.
  const vide = gesteDuParcours({ ...cadrage, messages: [] });
  assert.equal(vide.geste, 'valider-et-lancer');
  assert.equal(vide.possible, false);
  assert.equal(vide.raison, RAISONS_DU_GESTE.rienDit);
  // Un tour tourne : le grand bouton devient « Suspendre » (affiché « Annuler »), jamais un lancement éteint.
  const pendant = gesteDuParcours({ ...cadrage, tourEnCours: true });
  assert.equal(pendant.geste, 'arreter');
  assert.equal(pendant.possible, true);
  assert.equal(pendant.chapitre, 'cadrage');
  // Le tour rendu, la décision revient.
  assert.equal(gesteDuParcours({ ...cadrage, tourEnCours: false }).geste, 'valider-et-lancer');
  // Une carte du chef (sans agent de cadrage) garde son « Lancer » éteint pendant un tour.
  const duChefEnTour = gesteDuParcours({ colonne: 'planned', tourEnCours: true, messages: [] });
  assert.equal(duChefEnTour.geste, 'lancer');
  assert.equal(duChefEnTour.raison, RAISONS_DU_GESTE.tourEnCours);
  // La compréhension n'est pas encore rendue.
  const sansReponse = gesteDuParcours({ ...cadrage, messages: [{ role: 'user', content: 'x' }] });
  assert.equal(sansReponse.possible, false);
  assert.equal(sansReponse.raison, RAISONS_DU_GESTE.comprehensionAttendue);
  // Une question d'outil attend.
  const question = gesteDuParcours({
    ...cadrage,
    messages: [...DIALOGUE, { role: 'assistant', content: '', questions: [{ answer: undefined }] }],
  });
  assert.equal(question.raison, RAISONS_DU_GESTE.questionOuverte);
  // Le plan est demandé : le bouton le dit au lieu de repartir.
  assert.equal(
    gesteDuParcours({ ...cadrage, parcours: { plans: [], planDemandeA: 5 } }).raison,
    RAISONS_DU_GESTE.planEnCours,
  );
  /* UNE RÉPONSE EN TEXTE NE TIENT PLUS LIEU DE COMPRÉHENSION : le bouton lit
     ce que la carte a ÉCRIT (`parcours.comprehension`), comme la barre. */
  const enTexteSeulement = gesteDuParcours(cadrage);
  assert.equal(enTexteSeulement.possible, false);
  assert.equal(enTexteSeulement.raison, RAISONS_DU_GESTE.comprehensionAttendue);
  // Tout est là : le geste s'allume, sur l'état écrit.
  const pret = gesteDuParcours({ ...cadrage, parcours: COMPRIS });
  assert.equal(pret.possible, true);
  assert.equal(pret.raison, undefined);
  assert.equal(LIBELLES_GESTE[pret.geste as 'valider-et-lancer'], 'Lancer et valider');
  /* La compréhension rendue par l'OUTIL suffit, même sans réponse en texte :
     c'est elle que la carte porte. */
  assert.equal(gesteDuParcours({ ...cadrage, messages: [{ role: 'user', content: 'x' }], parcours: COMPRIS }).possible, true);
});

test('la raison du bouton éteint dit la vérité : le plan attend un TRAVAIL, pas une question', () => {
  /*
   * Depuis qu'un tour de cadrage peut se terminer par une simple RÉPONSE
   * (`ISSUES_DE_TOUR_DE_CADRAGE`, `shared/src/cadrage.ts`), une carte peut
   * rester longtemps sans compréhension — non par attente, mais parce que rien
   * de ce qui a été dit n'était un travail à faire. « Attendez que l'agent
   * dise ce qu'il a compris » promettait alors une attente qui ne viendrait
   * jamais, et se lisait comme une panne.
   */
  const raison = RAISONS_DU_GESTE.comprehensionAttendue;
  assert.ok(!raison.startsWith('Attendez'), 'elle ne promet plus une attente');
  assert.match(raison, /demande de travail/);
  assert.match(raison, /question/);
  /* LE VERROU, LUI, NE BOUGE PAS : aucun plan sans compréhension. */
  const cadrage = { colonne: 'planned' as const, roleAgent: 'cadrage', tourEnCours: false, messages: DIALOGUE };
  assert.equal(gesteDuParcours(cadrage).possible, false);
  assert.equal(gesteDuParcours({ ...cadrage, parcours: COMPRIS }).possible, true);
});

const COMPRIS = { plans: [], comprehension: { texte: 'compris', hypotheses: [], sujets: [], at: 1 } };

test('une décision ouverte éteint les gestes qui la contrediraient, jamais l’arrêt', () => {
  const tombe = [...DIALOGUE, { role: 'assistant', content: '', erreurDeTour: { choix: undefined } }];
  const limite = [...DIALOGUE, { role: 'assistant', content: '', repriseCompte: { choisi: undefined } }];
  const tranchee = [...DIALOGUE, { role: 'assistant', content: '', erreurDeTour: { choix: 'ignorer' } }];
  const abandonnee = [...DIALOGUE, { role: 'assistant', content: '', repriseCompte: { abandonnee: true } }];
  assert.equal(decisionsEnAttente(tombe), 1);
  assert.equal(decisionsEnAttente(limite), 1);
  assert.equal(decisionsEnAttente(tranchee), 0);
  assert.equal(decisionsEnAttente(abandonnee), 0);

  // Cadrage : « Générer le plan » attend la décision.
  const cadrage = { colonne: 'planned' as const, roleAgent: 'cadrage', tourEnCours: false, parcours: COMPRIS };
  assert.equal(gesteDuParcours({ ...cadrage, messages: tombe }).raison, RAISONS_DU_GESTE.decisionOuverte);
  assert.equal(gesteDuParcours({ ...cadrage, messages: tranchee }).possible, true);
  // Plan : « Lancer » attend la décision.
  const plan = { ...cadrage, parcours: { ...COMPRIS, plans: [PLAN] } };
  assert.equal(gesteDuParcours({ ...plan, messages: limite }).raison, RAISONS_DU_GESTE.decisionOuverte);
  // Carte sans agent : « Lancer » aussi.
  assert.equal(
    gesteDuParcours({ colonne: 'planned', tourEnCours: false, messages: limite }).raison,
    RAISONS_DU_GESTE.decisionOuverte,
  );
  // Tâche arrêtée : « Reprendre » ET « Terminer » attendent — « Relancer / Ignorer / Arrêter » est déjà posé.
  const arretee = gestesDuParcours({ colonne: 'planned', roleAgent: 'task', tourEnCours: false, messages: tombe });
  assert.deepEqual(arretee.map((g) => g.geste), ['reprendre', 'terminer']);
  assert.deepEqual(arretee.map((g) => g.raison), [RAISONS_DU_GESTE.decisionOuverte, RAISONS_DU_GESTE.decisionOuverte]);
  // Rapport : « Terminer » attend.
  assert.equal(
    gesteDuParcours({ colonne: 'running', roleAgent: 'task', tourEnCours: false, messages: limite }).raison,
    RAISONS_DU_GESTE.decisionOuverte,
  );
  // Le travail tourne : « Arrêter » reste possible, décision ou pas.
  assert.equal(gesteDuParcours({ colonne: 'running', roleAgent: 'task', tourEnCours: true, messages: tombe }).possible, true);
  // Une question en texte ordinaire compte comme une question d'outil.
  assert.equal(
    gesteDuParcours({ ...plan, messages: DIALOGUE, questionEnTexte: true }).raison,
    RAISONS_DU_GESTE.questionOuverte,
  );
});

test('un plan affiché ne change pas le geste ; au travail, l’arrêt ; au rapport, la fin', () => {
  /* UN PLAN RENDU N'EST PLUS UNE ÉTAPE VALIDABLE : il accompagne la
     compréhension du même tour. Le geste reste « Valider et lancer », ALLUMÉ —
     un seul clic valide puis lance, et il NOMME la version du plan affiché. */
  const nonValide = gesteDuParcours({
    colonne: 'planned',
    roleAgent: 'cadrage',
    tourEnCours: false,
    messages: DIALOGUE,
    parcours: { ...COMPRIS, plans: [PLAN] },
  });
  assert.equal(nonValide.geste, 'valider-et-lancer');
  assert.equal(nonValide.possible, true);
  assert.equal(nonValide.versionDuPlan, 1);
  /* SANS COMPRÉHENSION, RIEN NE PART : le verrou ne bouge pas, un plan seul ne
     suffit plus à autoriser la dépense. */
  const planSeul = gesteDuParcours({
    colonne: 'planned',
    roleAgent: 'cadrage',
    tourEnCours: false,
    messages: DIALOGUE,
    parcours: { plans: [PLAN] },
  });
  assert.equal(planSeul.possible, false);
  assert.equal(planSeul.raison, RAISONS_DU_GESTE.comprehensionAttendue);
  /* LA DÉCISION PRISE NE SE REDEMANDE PAS. */
  const decidee = gesteDuParcours({
    colonne: 'planned',
    roleAgent: 'cadrage',
    tourEnCours: false,
    messages: DIALOGUE,
    parcours: { ...COMPRIS, plans: [PLAN], comprehensionValidee: { at: 2, comprehensionAt: 1 } },
  });
  assert.equal(decidee.geste, 'lancer');
  assert.equal(decidee.possible, true);
  /* UN PLAN VALIDÉ À L'ANCIENNE VAUT TOUJOURS DÉCISION. */
  const ancienne = gesteDuParcours({
    colonne: 'planned',
    roleAgent: 'cadrage',
    tourEnCours: false,
    messages: DIALOGUE,
    parcours: { ...COMPRIS, plans: [PLAN], planValide: { version: 1, at: 2 } },
  });
  assert.equal(ancienne.geste, 'lancer');
  /* Une compréhension rendue APRÈS la validation la périme : on revalide. */
  const affinee = gesteDuParcours({
    colonne: 'planned',
    roleAgent: 'cadrage',
    tourEnCours: false,
    messages: DIALOGUE,
    parcours: {
      plans: [PLAN],
      comprehension: { texte: 'compris mieux', hypotheses: [], sujets: [], at: 9 },
      comprehensionValidee: { at: 2, comprehensionAt: 1 },
    },
  });
  assert.equal(affinee.geste, 'valider-et-lancer', 'une compréhension suivante redemande la décision');
  assert.equal(affinee.possible, true);
  assert.equal(planValidePourLaVersionCourante({ plans: [PLAN], planValide: { version: 1, at: 2 } }), true);
  assert.equal(planValidePourLaVersionCourante({ plans: [PLAN] }), false);
  assert.equal(planValidePourLaVersionCourante(null), false);
  /* UN PLAN EN COURS D'ÉCRITURE ÉTEINT LE GESTE, et le dit. */
  const affine = gesteDuParcours({
    colonne: 'planned',
    roleAgent: 'cadrage',
    tourEnCours: false,
    messages: DIALOGUE,
    parcours: { ...COMPRIS, plans: [PLAN], planDemandeA: 3 },
  });
  assert.equal(affine.geste, 'valider-et-lancer');
  assert.equal(affine.possible, false);
  assert.equal(affine.raison, RAISONS_DU_GESTE.planEnCours);
  /* Tant que l'agent écrit ce plan, le geste est de le suspendre. */
  const affineEnTour = gesteDuParcours({
    colonne: 'planned',
    roleAgent: 'cadrage',
    tourEnCours: true,
    messages: DIALOGUE,
    parcours: { ...COMPRIS, plans: [PLAN], planDemandeA: 3 },
  });
  assert.equal(affineEnTour.geste, 'arreter');
  assert.equal(affineEnTour.possible, true);

  const travail = gesteDuParcours({ colonne: 'running', roleAgent: 'task', tourEnCours: true, messages: DIALOGUE });
  assert.equal(travail.geste, 'arreter');
  assert.equal(travail.possible, true);
  const rapport = gesteDuParcours({ colonne: 'running', roleAgent: 'task', tourEnCours: false, messages: DIALOGUE });
  assert.equal(rapport.geste, 'terminer');
  assert.equal(rapport.possible, true);
  const rangee = gesteDuParcours({ colonne: 'to_deploy', roleAgent: 'task', tourEnCours: false, messages: DIALOGUE });
  assert.equal(rangee.geste, 'aucun');
  const interrompue = gesteDuParcours({ colonne: 'planned', roleAgent: 'task', tourEnCours: false, messages: DIALOGUE });
  assert.equal(interrompue.geste, 'reprendre');
  /* Une carte sans cadrage — proposée par le chef — se lance telle quelle. */
  const duChef = gesteDuParcours({ colonne: 'planned', tourEnCours: false, messages: [] });
  assert.equal(duChef.geste, 'lancer');
  assert.equal(duChef.possible, true);
});

/*
 * LA RANGÉE PORTE UN GESTE, OU DEUX SUR UNE TÂCHE ARRÊTÉE. C'est la règle qui
 * a fait quitter au geste de fin le pied du tiroir : il vit désormais
 * au-dessus du champ, seul quand le rapport est rendu, à côté de
 * « Reprendre » quand la tâche a été arrêtée.
 */
test('gestesDuParcours : un geste, ou deux après un arrêt', () => {
  const travail = gestesDuParcours({ colonne: 'running', roleAgent: 'task', tourEnCours: true, messages: DIALOGUE });
  assert.deepEqual(travail.map((g) => g.geste), ['arreter']);

  const rapport = gestesDuParcours({ colonne: 'running', roleAgent: 'task', tourEnCours: false, messages: DIALOGUE });
  assert.deepEqual(rapport.map((g) => g.geste), ['terminer']);
  assert.equal(rapport[0].possible, true);

  /* Arrêtée : la carte est retombée en « Planifié » avec son agent de tâche.
     Les deux issues, dans cet ordre, toutes deux possibles. */
  const arretee = gestesDuParcours({ colonne: 'planned', roleAgent: 'task', tourEnCours: false, messages: DIALOGUE });
  assert.deepEqual(arretee.map((g) => g.geste), ['reprendre', 'terminer']);
  assert.equal(arretee[0].possible, true);
  assert.equal(arretee[1].possible, true);

  /* Un tour qui repart éteint les DEUX, chacun avec sa raison. */
  const repartie = gestesDuParcours({ colonne: 'planned', roleAgent: 'task', tourEnCours: true, messages: DIALOGUE });
  assert.deepEqual(repartie.map((g) => g.possible), [false, false]);
  assert.equal(repartie[1].raison, RAISONS_DU_GESTE.tourEnCours);

  /* Une question ouverte éteint la clôture, pas la reprise. */
  const question = gestesDuParcours({
    colonne: 'planned',
    roleAgent: 'task',
    tourEnCours: false,
    messages: [...DIALOGUE, { role: 'assistant', questions: [{}] }],
  });
  assert.equal(question[0].possible, true);
  assert.equal(question[1].possible, false);
  assert.equal(question[1].raison, RAISONS_DU_GESTE.questionOuverte);

  /* Une carte rangée n'a plus de geste du tout dans cette rangée. */
  assert.deepEqual(
    gestesDuParcours({ colonne: 'to_deploy', roleAgent: 'task', tourEnCours: false, messages: DIALOGUE }),
    [],
  );
});

/* ------------------------------------------------------------------ */
/* Le plan rendu par l'outil                                           */
/* ------------------------------------------------------------------ */

const EN_CLAIR = 'Je vais faire en sorte que l’en-tête de la page reste toujours visible en haut, même quand vous descendez dans un long contenu. Une fois en place, vous n’aurez plus à remonter pour retrouver le menu : il vous suit. Cela vous fera gagner du temps sur les pages longues, surtout sur téléphone.';
const CAHIER = [
  { titre: 'Contexte et objectifs', contenu: 'L’en-tête disparaît quand on descend : on veut le garder à portée.' },
  { titre: 'Pour qui', contenu: 'Toute personne qui lit une page longue, surtout sur téléphone.' },
  { titre: 'Périmètre', contenu: 'Compris : l’en-tête. Exclu : le pied de page.' },
  { titre: 'Critères de réussite', contenu: 'L’en-tête reste visible en haut pendant tout le défilement.' },
];

const ARGS_PLAN = {
  titre: 'Rendre sticky un élément',
  enClair: EN_CLAIR,
  cahierDesCharges: CAHIER,
  synthese: 'L’en-tête restera visible en haut de la page pendant le défilement.',
  resume: 'Un élément qui reste en haut.',
  taches: [
    { titre: 'Poser la règle CSS', description: 'Ajouter la position collante au conteneur de l’en-tête.' },
    { titre: 'Vérifier le défilement', description: 'S’assurer que la zone parente ne coupe pas le collage.' },
  ],
  decisions: ['Version 1 : l’en-tête seul reste collé, décidé au premier message.', 'Le pied de page collant est abandonné.'],
  faisabilite: 'Oui, du CSS ordinaire — je suppose que le conteneur ne défile pas.',
  chemin: [
    { titre: 'Repérer l’élément', detail: 'dans la page' },
    { titre: 'Appliquer la règle', detail: 'position sticky' },
  ],
  consequences: 'L’élément reste visible.',
  ameliorations: ['Une ombre au contact', 'Un repli sur mobile', 'Un test visuel'],
  verifications: ['node scripts/verify-ui.mjs'],
};

test('un plan incomplet est refusé en nommant TOUT ce qui manque, d’un coup', () => {
  const refus = lirePlanRendu({ titre: 'x', chemin: [{ titre: 'a' }] });
  assert.equal(refus.ok, false);
  if (!refus.ok) {
    assert.match(refus.raison, /taches/);
    assert.match(refus.raison, /verifications/);
    /* LE PLAN COMPACT (17/10/2026) : ces quatre parties ne s'exigent plus. */
    assert.doesNotMatch(refus.raison, /faisabilite|« chemin »|consequences|ameliorations/);
    assert.match(refus.raison, /rien n'a été enregistré/);
    assert.match(refus.raison, /« enClair »/);
    assert.match(refus.raison, /« cahierDesCharges »/);
  }
  /* LE CAHIER DES CHARGES EST EXIGÉ (12/10/2026) : quatre rubriques au moins,
     et aucune ne reprend le titre d'une autre partie du plan. */
  const cahierCourt = lirePlanRendu({ ...ARGS_PLAN, cahierDesCharges: CAHIER.slice(0, 3) });
  assert.equal(cahierCourt.ok, false);
  const cahierAmbigu = lirePlanRendu({ ...ARGS_PLAN, cahierDesCharges: [...CAHIER, { titre: 'Conséquences', contenu: 'x' }] });
  assert.ok(!cahierAmbigu.ok && /Conséquences/.test(cahierAmbigu.raison));
  assert.equal(lirePlanRendu(ARGS_PLAN).ok, true);
  /* SANS CAHIER RENDU, LE CAHIER VIVANT DE LA CARTE EST REPRIS. */
  const sansCahier: Record<string, unknown> = { ...ARGS_PLAN };
  delete sansCahier.cahierDesCharges;
  assert.equal(lirePlanRendu(sansCahier).ok, false);
  assert.equal(lirePlanRendu(sansCahier, { cahierVivant: CAHIER }).ok, true);
  // Une étape écrite en simple chaîne passe : le titre suffit.
  const simple = lirePlanRendu({ ...ARGS_PLAN, chemin: ['Repérer', 'Appliquer'] });
  assert.ok(simple.ok && simple.valeur.chemin[0].titre === 'Repérer');

  /* LA LISTE DES TÂCHES EST EXIGÉE, comme les quatre parties : une seule
     entrée ne fait pas une liste. */
  const sansTaches = lirePlanRendu({ ...ARGS_PLAN, taches: [{ titre: 'Faire' }] });
  assert.equal(sansTaches.ok, false);
  if (!sansTaches.ok) assert.match(sansTaches.raison, /taches/);

  /* LES DÉCISIONS DES ITÉRATIONS SONT EXIGÉES : le refus les nomme. */
  assert.match(!refus.ok ? refus.raison : '', /decisions/);
  const sansLeChamp: Record<string, unknown> = { ...ARGS_PLAN };
  delete sansLeChamp.decisions;
  for (const args of [sansLeChamp, { ...ARGS_PLAN, decisions: [] }, { ...ARGS_PLAN, decisions: ['  '] }]) {
    const sansDecisions = lirePlanRendu(args);
    assert.equal(sansDecisions.ok, false);
    if (!sansDecisions.ok) {
      assert.match(sansDecisions.raison, /« decisions »/);
      assert.ok(!sansDecisions.raison.includes('« taches »'), 'seul ce qui manque est nommé');
    }
  }

  /* L'OUVERTURE « EN CLAIR » EST EXIGÉE, et avec du fond : une ligne ne suffit pas. */
  const sansOuverture: Record<string, unknown> = { ...ARGS_PLAN };
  delete sansOuverture.enClair;
  for (const args of [sansOuverture, { ...ARGS_PLAN, enClair: 'Je vais coller l’en-tête.' }, { ...ARGS_PLAN, enClair: 'x'.repeat(300) }]) {
    const refusOuverture = lirePlanRendu(args);
    assert.equal(refusOuverture.ok, false);
    if (!refusOuverture.ok) {
      assert.match(refusOuverture.raison, /« enClair »/);
      assert.match(refusOuverture.raison, /ce qu'il constatera une fois fini/);
      assert.ok(!refusOuverture.raison.includes('« taches »'), 'seul ce qui manque est nommé');
    }
  }
});

test('le démon rend le markdown lui-même : le plan compact, puis ce que l’agent a encore donné', () => {
  const lecture = lirePlanRendu(ARGS_PLAN);
  assert.ok(lecture.ok);
  if (!lecture.ok) return;
  const texte = rendrePlan(lecture.valeur);
  /* LE PLAN COMPACT (17/10/2026) : l'ouverture, les tâches, les vérifications. */
  assert.ok(
    texte.startsWith(`# Rendre sticky un élément\n\n## En clair\n${EN_CLAIR}\n\n## Liste des tâches\n**Poser la règle CSS**\nAjouter la position collante`),
    texte.slice(0, 200),
  );
  assert.ok(!texte.includes('_Un élément qui reste en haut._'), texte);
  assert.match(texte, /le collage\.\n\n## Vérifications\n- node scripts\/verify-ui\.mjs\n\n## Décisions des itérations\n- Version 1/);
  /* LES DÉCISIONS, PUIS LE CAHIER, que l'écran replie (`detacherLeCahier`). */
  assert.match(texte, /abandonné\.\n\n## Cahier des charges\n### Contexte et objectifs\n/);
  /* LES PARTIES DE L'ANCIEN GABARIT, données ici, s'écrivent encore — après le cahier. */
  assert.match(texte, /### Critères de réussite\nL’en-tête reste visible[^\n]*\n\n## Faisabilité/);
  assert.equal(jugerLePlan(texte).complet, true, 'les quatre parties sont là');
  const range = rangerLePlan(texte);
  assert.equal(range.conforme, true);
  assert.equal(range.enClair, EN_CLAIR, 'l’ouverture est rangée à part, ni résumé ni tâche');
  assert.match(range.cahier ?? '', /### Périmètre\nCompris : l’en-tête/);
  assert.ok(!range.taches?.includes('Périmètre'), 'le cahier ne tombe pas dans les tâches');
  assert.match(range.decisions ?? '', /abandonné/);
  assert.match(texte, /1\. \*\*Repérer l’élément\*\* — dans la page/);
  assert.match(texte, /- Une ombre au contact/);
  // La description de la carte : le résumé et le chemin, rien de plus.
  assert.equal(
    descriptionDepuisLePlanRendu(lecture.valeur),
    'Un élément qui reste en haut.\n\n1. Repérer l’élément\n2. Appliquer la règle',
  );
  /* SANS ANCIENNES PARTIES, le plan s'arrête au cahier, et la description prend les tâches. */
  const compact = lirePlanRendu({ ...ARGS_PLAN, faisabilite: '', chemin: [], consequences: '', ameliorations: [] });
  assert.ok(compact.ok);
  if (!compact.ok) return;
  const texteCompact = rendrePlan(compact.valeur);
  assert.doesNotMatch(texteCompact, /## Faisabilité|## Chemin à suivre|## Conséquences|## Améliorations apportées/);
  assert.equal(
    descriptionDepuisLePlanRendu(compact.valeur),
    'Un élément qui reste en haut.\n\n1. Poser la règle CSS\n2. Vérifier le défilement',
  );
});

test('les versions se suivent sans trou, et le plan courant est la plus haute', () => {
  assert.equal(numeroDuProchainPlan(undefined), 1);
  assert.equal(numeroDuProchainPlan([{ numero: 3 }, { numero: 1 }]), 4);
  assert.equal(planCourant([{ ...PLAN, numero: 1 }, { ...PLAN, numero: 2, titre: 'deux' }])?.titre, 'deux');
  assert.equal(planCourant([]), undefined);
});

test('la compréhension sans ses deux résumés du fil est refusée, en les nommant', () => {
  const refus = lireComprehensionRendue({ texte: 'Un bouton.', resumeDemande: 'Un bouton.' });
  assert.equal(refus.ok, false);
  if (!refus.ok) {
    assert.match(refus.raison, /« resumeComprehension »/);
    assert.doesNotMatch(refus.raison, /« resumeDemande »/);
  }
  const sansSynthese: Record<string, unknown> = { ...ARGS_PLAN };
  delete sansSynthese.synthese;
  const plan = lirePlanRendu(sansSynthese);
  assert.equal(plan.ok, false);
  if (!plan.ok) assert.match(plan.raison, /« synthese »/);
});

/* LE SECOND REGISTRE, EXIGÉ PARTOUT : un appel sans lui est refusé. */
const TECHNIQUE = {
  taches: [{ titre: 'Poser le bouton', description: 'Dans la barre du haut.' }],
  faits: ['MEM-0001 : la barre du haut est un composant partagé.'],
  risques: 'Le bouton peut recouvrir le menu sur téléphone.',
};

test('la part technique est EXIGÉE : sans découpe ni risques, la compréhension est refusée', () => {
  const base = {
    resumeDemande: 'Un élément qui reste en haut.',
    resumeComprehension: 'Un en-tête collant.',
    texte: 'Un bouton.',
  };
  const sansRien = lireComprehensionRendue(base);
  assert.equal(sansRien.ok, false);
  assert.ok(!sansRien.ok && sansRien.raison.includes('partieTechnique'));
  const sansRisques = lireComprehensionRendue({ ...base, partieTechnique: { ...TECHNIQUE, risques: '  ' } });
  assert.equal(sansRisques.ok, false);
  assert.ok(!sansRisques.ok && sansRisques.raison.includes('risques'));
  /* Complète, elle est relue telle quelle et voyage avec la compréhension. */
  const lue = lireComprehensionRendue({ ...base, partieTechnique: TECHNIQUE });
  assert.ok(lue.ok && lue.valeur.partieTechnique?.taches.length === 1);
  assert.ok(lue.ok && lue.valeur.partieTechnique?.faits.length === 1);
});

test('la compréhension relue : un texte vide est refusé, les listes sont bornées', () => {
  assert.equal(lireComprehensionRendue({ texte: '   ' }).ok, false);
  const lue = lireComprehensionRendue({
    resumeDemande: 'Un élément qui reste en haut.', resumeComprehension: 'Un en-tête collant.', 
    texte: 'Un bouton.',
    hypotheses: ['Je suppose que le bouton va en tête.', '', 'Je suppose que la couleur suit le thème.'],
    sujets: ['interface', 'cartes'],
    partieTechnique: TECHNIQUE,
  });
  assert.ok(lue.ok && lue.valeur.hypotheses.length === 2 && lue.valeur.sujets.length === 2);

  /* UNE QUESTION DÉPOSÉE DANS LES HYPOTHÈSES EST REFUSÉE, tant qu'aucune
     question n'a été posée dans le tour. */
  const refus = lireComprehensionRendue({ resumeDemande: 'Un élément qui reste en haut.', resumeComprehension: 'Un en-tête collant.', texte: 'Un bouton.', hypotheses: ['Où faut-il poser le bouton ?'] });
  assert.equal(refus.ok, false);
  assert.ok(!refus.ok && refus.raison.includes('ask_user'));
  /* La même ligne passe dès qu'une question a réellement été posée. */
  const apres = lireComprehensionRendue({ resumeDemande: 'Un élément qui reste en haut.', resumeComprehension: 'Un en-tête collant.', texte: 'Un bouton.', hypotheses: ['Où faut-il poser le bouton ?'], partieTechnique: TECHNIQUE }, { questionsPosees: 1 });
  assert.equal(apres.ok, true);
  /* Une affirmation assumée passe toujours, même sans question posée. */
  assert.equal(lireComprehensionRendue({ resumeDemande: 'Un élément qui reste en haut.', resumeComprehension: 'Un en-tête collant.', texte: 'Un bouton.', hypotheses: ['Je suppose que ce sera en haut.'], partieTechnique: TECHNIQUE }).ok, true);
});

test('les hypothèses ne sont plus coupées en silence : toutes passent, au-delà du plafond le refus dit de regrouper', () => {
  const treize = Array.from({ length: 13 }, (_, i) => `Je suppose que le point ${i + 1} tient.`);
  const lue = lireComprehensionRendue({ resumeDemande: 'Un élément qui reste en haut.', resumeComprehension: 'Un en-tête collant.', texte: 'Sept demandes.', hypotheses: treize, partieTechnique: TECHNIQUE });
  assert.ok(lue.ok && lue.valeur.hypotheses.length === 13, 'les treize hypothèses sont gardées');

  const trop = Array.from({ length: HYPOTHESES_MAX + 1 }, (_, i) => `Je suppose que le point ${i + 1} tient.`);
  const refus = lireComprehensionRendue({ resumeDemande: 'Un élément qui reste en haut.', resumeComprehension: 'Un en-tête collant.', texte: 'Beaucoup.', hypotheses: trop });
  assert.equal(refus.ok, false);
  assert.ok(!refus.ok && refus.raison.includes('regroupe'), 'le refus dit ce qu’il faut faire');

  /* Le refus d'un texte vide dit ce qu'on attend : ce qui va être fait, plus un gabarit. */
  const vide = lireComprehensionRendue({ resumeDemande: 'Un élément qui reste en haut.', resumeComprehension: 'Un en-tête collant.', texte: '' });
  assert.ok(!vide.ok, 'un texte vide est refusé');
  if (vide.ok) return;
  assert.match(vide.raison, /longueur que la situation appelle/);
  assert.doesNotMatch(vide.raison, /600 signes/);
  assert.match(vide.raison, /IL EST RANGÉ EN POINTS/);
  assert.doesNotMatch(vide.raison, /\*\*1\. Intitulé\*\*|Comment : |Résultat : /);
  assert.doesNotMatch(vide.raison, /deux à quatre/);
});

test('un plan demandé et non rendu est un manquement — sauf question ouverte ou tour tombé', () => {
  assert.equal(planManquant({ planDemandeA: 5, questionPosee: false, echec: false }), true);
  assert.equal(planManquant({ planDemandeA: 5, questionPosee: true, echec: false }), false);
  assert.equal(planManquant({ planDemandeA: 5, questionPosee: false, echec: true }), false);
  assert.equal(planManquant({ planDemandeA: undefined, questionPosee: false, echec: false }), false);
  assert.ok(INCIDENT_PLAN_NON_RENDU.length > 0);
});

test('les consignes du plan nomment l’outil, la version, et refusent le fragment', () => {
  assert.match(consigneDeRenduDuPlan(1), /« rendre_plan »/);
  assert.match(consigneDeRenduDuPlan(3), /version 3/);
  assert.match(consigneDAffinageDuPlan(2), /version 1/);
  assert.match(consigneDAffinageDuPlan(2), /version 2 ENTIÈRE/);
  assert.match(consigneDAffinageDuPlan(2), /voici ce qui change/);

  /* CHAQUE VERSION EST GLOBALE : la consigne part du plan redonné en entier,
     reprend TOUS les échanges, et ne laisse rien tomber sans le noter. */
  const affinage = consigneDAffinageDuPlan(3);
  assert.match(affinage, /GLOBALE/);
  assert.match(affinage, /« Dernier plan rendu »/);
  assert.match(affinage, /version 2/);
  assert.match(affinage, /depuis le premier message/);
  assert.match(affinage, /ABANDONNÉ/);
  assert.match(affinage, /« decisions »/);
  assert.ok(!/vient de le commenter/.test(affinage), 'la consigne ne regarde plus le seul dernier message');
  assert.match(consigneDeRenduDuPlan(1), /decisions/);
  /* LE PLAN COMPACT : la consigne nomme ses blocs et le cahier vivant. */
  assert.match(consigneDeRenduDuPlan(1), /COMPACT/);
  assert.match(consigneDeRenduDuPlan(1), /« verifications »/);
  assert.match(consigneDeRenduDuPlan(1), /VIVANT/);
});

test('le dernier plan repart au cadrage au tour de plan, et à lui seul', () => {
  const plans = [
    { ...PLAN, numero: 1, texte: '# Un\n\nle texte de la première' },
    { ...PLAN, numero: 2, texte: '# Deux\n\nle texte de la seconde' },
  ];
  const bloc = blocDuDernierPlan({ role: 'cadrage', planDemandeA: 5, plans }) ?? '';
  assert.match(bloc, /\(version 2\)/);
  assert.match(bloc, /le texte de la seconde/, 'le texte ENTIER de la version courante');
  assert.ok(!bloc.includes('le texte de la première'), 'jamais une version dépassée');
  assert.match(bloc, /« decisions »/);
  // Un tour de compréhension ne paie pas ce texte, un autre rôle non plus.
  assert.equal(blocDuDernierPlan({ role: 'cadrage', planDemandeA: undefined, plans }), null);
  assert.equal(blocDuDernierPlan({ role: 'task', planDemandeA: 5, plans }), null);
  // Une première version n'a rien à redonner.
  assert.equal(blocDuDernierPlan({ role: 'cadrage', planDemandeA: 5, plans: [] }), null);
});

/* ------------------------------------------------------------------ */
/* Le panneau de décision                                               */
/* ------------------------------------------------------------------ */

test('tout ce qui attend l’utilisateur tient dans une seule liste, dans l’ordre', () => {
  const decisions = decisionsDuParcours({
    messages: [
      { id: 'm1', role: 'assistant', questions: [{ id: 'q1', answer: 'oui' }, { id: 'q2' }] },
      { id: 'm2', role: 'assistant', erreurDeTour: { choix: undefined } },
      { id: 'm3', role: 'assistant', repriseCompte: { choisi: undefined } },
      { id: 'm4', role: 'assistant', erreurDeTour: { choix: 'relancer' } },
    ],
    parcours: { incident: { texte: INCIDENT_PLAN_NON_RENDU, at: 1 } },
    questionEnTexte: true,
  });
  assert.deepEqual(
    decisions.map((d) => d.sorte),
    ['question', 'erreur', 'reprise', 'question-texte', 'incident'],
  );
  assert.equal(decisionsDuParcours({ messages: [] }).length, 0);
});

test('un incident de compréhension nomme son étape et tombe dès qu’une compréhension est rendue depuis', () => {
  const incident = { texte: 'La compréhension n’est pas venue.', at: 100, etape: 'comprehension' as const };
  const lire = (comprehension?: { at: number }) =>
    decisionsDuParcours({ messages: [], parcours: { incident, comprehension }, colonne: 'planned' });
  // Sans compréhension : l'incident se lit, et son geste est celui de la compréhension.
  assert.deepEqual(lire(), [{ sorte: 'incident', texte: incident.texte, etape: 'comprehension' }]);
  assert.deepEqual(lire({ at: 50 }).map((d) => d.sorte), ['incident']);
  // Une compréhension rendue depuis : plus rien à redemander, aucun bouton ne peut lancer un plan.
  assert.deepEqual(lire({ at: 100 }), []);
  assert.deepEqual(lire({ at: 500 }), []);
  // Un incident sans étape (cartes d'avant) reste un incident de plan, jamais périmé par la compréhension.
  const ancien = decisionsDuParcours({
    messages: [],
    parcours: { incident: { texte: INCIDENT_PLAN_NON_RENDU, at: 100 }, comprehension: { at: 500 } },
    colonne: 'planned',
  });
  assert.deepEqual(ancien, [{ sorte: 'incident', texte: INCIDENT_PLAN_NON_RENDU, etape: 'plan' }]);
});

test('l’incident du cadrage ne s’affiche plus sur une carte lancée, rendue ou archivée', () => {
  const parcours = { incident: { texte: INCIDENT_PLAN_NON_RENDU, at: 1 } };
  const sortes = (etat: { colonne?: string; archivee?: boolean }) =>
    decisionsDuParcours({ messages: [], parcours, ...etat }).map((d) => d.sorte);
  assert.deepEqual(sortes({ colonne: 'planned' }), ['incident']);
  assert.deepEqual(sortes({}), ['incident']);
  assert.deepEqual(sortes({ colonne: 'running' }), []);
  assert.deepEqual(sortes({ colonne: 'to_deploy' }), []);
  assert.deepEqual(sortes({ colonne: 'archived' }), []);
  assert.deepEqual(sortes({ colonne: 'planned', archivee: true }), []);
});

/* ------------------------------------------------------------------ */
/* Les deux outils, par le vrai démon                                   */
/* ------------------------------------------------------------------ */

test('« rendre_comprehension » et « rendre_plan » écrivent la carte, et refusent hors du cadrage', async () => {
  const projet = store.saveProject({
    id: store.newId(),
    name: 'Parcours',
    path: bacASable,
    createdAt: store.now(),
    updatedAt: store.now(),
  } as any);
  const carte = createCard(projet.id, { title: 'Bouton sticky', origin: 'user' });
  const contexte = { agentId: 'parcours-1', projectId: projet.id, role: 'cadrage' as const, cardId: carte.id };

  /* UNE QUESTION LAISSÉE EN SUSPENS EST REFUSÉE PAR L'OUTIL LUI-MÊME : la
     consigne seule serait contournée au premier tour pressé. */
  const enSuspens = await callTool(contexte, 'rendre_comprehension', {
    resumeDemande: 'Un élément qui reste en haut.', resumeComprehension: 'Un en-tête collant.', 
    texte: 'Vous voulez un élément qui reste en haut.',
    hypotheses: ['Sur quelle page ?'],
    sujets: ['interface'],
  });
  assert.equal(enSuspens.ok, false);
  assert.ok(enSuspens.text.includes('ask_user'), enSuspens.text);
  assert.equal(store.getCard(carte.id)!.parcours?.comprehension, undefined);

  const comprehension = await callTool(contexte, 'rendre_comprehension', {
    resumeDemande: 'Un élément qui reste en haut.', resumeComprehension: 'Un en-tête collant.', 
    texte: 'Vous voulez un élément qui reste en haut.',
    hypotheses: ['Je suppose que c’est sur la page d’accueil.'],
    sujets: ['interface'],
    partieTechnique: TECHNIQUE,
  });
  assert.equal(comprehension.ok, true, comprehension.text);
  let relue = store.getCard(carte.id)!;
  /* LE SECOND REGISTRE EST ÉCRIT SUR LA CARTE : c'est lui qui partira à
     l'agent d'exécution, avec ou sans plan. */
  assert.deepEqual(relue.parcours?.comprehension?.partieTechnique, TECHNIQUE);
  assert.equal(relue.parcours?.comprehension?.texte, 'Vous voulez un élément qui reste en haut.');
  assert.equal(relue.parcours?.comprehension?.resumeDemande, 'Un élément qui reste en haut.');
  assert.equal(relue.parcours?.comprehension?.resumeComprehension, 'Un en-tête collant.');
  /* HORS D'UN TOUR VIVANT, rien n'est refusé, mais aucune supposition ne
     s'enregistre plus : elle devient une question gardée sur la carte. */
  assert.deepEqual(relue.parcours?.comprehension?.hypotheses, []);
  assert.deepEqual(
    relue.parcours?.comprehension?.questionsEnAttente?.map((q) => [q.question, q.recommandee]),
    [['C’est sur la page d’accueil ?', 'Oui, c’est bien ça']],
  );

  /* Le plan : refusé incomplet, puis enregistré en version 1 — et la carte
     reçoit sa description. */
  const refus = await callTool(contexte, 'rendre_plan', { titre: 'x' });
  assert.equal(refus.ok, false);
  assert.equal(store.getCard(carte.id)!.parcours?.plans?.length ?? 0, 0);

  store.saveCard({ ...store.getCard(carte.id)!, parcours: { ...relue.parcours!, planDemandeA: 42 } });
  const plan = await callTool(contexte, 'rendre_plan', ARGS_PLAN);
  assert.equal(plan.ok, true, plan.text);
  relue = store.getCard(carte.id)!;
  assert.equal(relue.parcours?.plans?.length, 1);
  assert.equal(relue.parcours?.plans?.[0].numero, 1);
  assert.equal(relue.parcours?.plans?.[0].synthese, ARGS_PLAN.synthese);
  assert.equal(relue.parcours?.planDemandeA, undefined, 'la demande de plan est honorée');
  assert.ok(relue.description.startsWith('Un élément qui reste en haut.'));
  assert.equal(jugerLePlan(relue.parcours!.plans[0].texte).complet, true);

  /* Une seconde version s'ajoute, elle ne remplace pas. */
  const v2 = await callTool(contexte, 'rendre_plan', { ...ARGS_PLAN, titre: 'Version affinée' });
  assert.equal(v2.ok, true);
  assert.equal(store.getCard(carte.id)!.parcours?.plans?.length, 2);
  assert.equal(planCourant(store.getCard(carte.id)!.parcours?.plans)?.titre, 'Version affinée');

  /* Hors du cadrage, les deux outils n'existent pas. */
  const tache = { ...contexte, role: 'task' as const };
  assert.equal((await callTool(tache, 'rendre_plan', ARGS_PLAN)).ok, false);
  assert.equal((await callTool(tache, 'rendre_comprehension', { texte: 'x' })).ok, false);
  assert.equal(TITRE_CARTE_DE_CADRAGE, 'Nouvelle tâche');
});

/* ------------------------------------------------------------------ */
/* UN ÉTAT PÉRIMÉ NE DÉCIDE PLUS DE RIEN                                */
/* ------------------------------------------------------------------ */

test('canal coupé : le geste reste affiché, mais éteint, avec sa raison', () => {
  const pret = {
    colonne: 'planned' as const,
    roleAgent: 'cadrage',
    tourEnCours: false,
    messages: DIALOGUE,
    parcours: { plans: [], comprehension: { texte: 'compris', questionsOuvertes: [], sujets: [], at: 1 } },
  };
  /* Lien vivant : le geste est possible. */
  const vivant = gesteDuParcours(pret as any);
  assert.equal(vivant.geste, 'valider-et-lancer');
  assert.equal(vivant.possible, true);
  /* Lien coupé : MÊME geste, éteint, et il dit pourquoi. */
  const perime = gesteDuParcours({ ...pret, etatPerime: true } as any);
  assert.equal(perime.geste, 'valider-et-lancer');
  assert.equal(perime.possible, false);
  assert.equal(perime.raison, RAISONS_DU_GESTE.etatPerime);
});

test('un état périmé n’invente pas non plus un « Arrêter » possible', () => {
  const travail = {
    colonne: 'running' as const,
    roleAgent: 'task',
    tourEnCours: true,
    messages: DIALOGUE,
    etatPerime: true,
  };
  const geste = gesteDuParcours(travail as any);
  assert.equal(geste.possible, false);
  assert.equal(geste.raison, RAISONS_DU_GESTE.etatPerime);
});

/* ------------------------------------------------------------------ */
/* UNE ÉTAPE NE RESTE PAS ALLUMÉE PLUS LONGTEMPS QUE SON TOUR           */
/* ------------------------------------------------------------------ */

const TOUR_MORT = {
  agentAuTravail: false,
  tourEncoreVivant: false,
  demandeEnFile: false,
  lancementEnPreparation: false,
  questionOuverte: false,
};
const MAINTENANT_ETAPE = 1_800_000_000_000;

test('une demande de plan sans tour vivant se referme, passé le délai de grâce', () => {
  assert.equal(
    etapeDeCarteAbandonnee(
      { ...TOUR_MORT, planDemandeA: MAINTENANT_ETAPE - DELAI_ETAPE_SANS_TOUR_MS },
      MAINTENANT_ETAPE,
    ),
    true,
  );
});

test('… mais jamais dans la minute qui suit le clic', () => {
  assert.equal(
    etapeDeCarteAbandonnee({ ...TOUR_MORT, planDemandeA: MAINTENANT_ETAPE - 30_000 }, MAINTENANT_ETAPE),
    false,
  );
});

test('cinq témoins de travail réel retiennent la fermeture', () => {
  const vieille = MAINTENANT_ETAPE - 3 * DELAI_ETAPE_SANS_TOUR_MS;
  for (const temoin of [
    'agentAuTravail',
    'tourEncoreVivant',
    'demandeEnFile',
    'lancementEnPreparation',
    'questionOuverte',
  ]) {
    assert.equal(
      etapeDeCarteAbandonnee({ ...TOUR_MORT, [temoin]: true, planDemandeA: vieille } as any, MAINTENANT_ETAPE),
      false,
      `« ${temoin} » doit retenir la fermeture`,
    );
  }
});

test('sans demande de plan, il n’y a rien à refermer', () => {
  assert.equal(etapeDeCarteAbandonnee({ ...TOUR_MORT, planDemandeA: undefined }, MAINTENANT_ETAPE), false);
});

/* ------------------------------------------------------------------ */
/* UNE CARTE EN CADRAGE NE PART PAS TOUTE SEULE                         */
/* ------------------------------------------------------------------ */

test('un cadrage sans plan retient la carte ; un plan rendu la libère', () => {
  assert.equal(cartePrisonniereDuCadrage({ aUnCadrage: true, plansRendus: 0 }), true);
  assert.equal(cartePrisonniereDuCadrage({ aUnCadrage: true, plansRendus: 1 }), false);
  assert.equal(cartePrisonniereDuCadrage({ aUnCadrage: false, plansRendus: 0 }), false);
});

test('une carte née du « + » n’annonce aucun départ, une carte ordinaire garde le sien', () => {
  const projet = store.saveProject({
    id: store.newId(),
    name: 'Cadrage sans départ',
    path: bacASable,
    createdAt: Date.now(),
  } as any);
  const carte = createCard(projet.id, { title: TITRE_CARTE_DE_CADRAGE, origin: 'user', cadrage: true });
  assert.equal(carte.scheduling?.departPrevu, undefined, 'une carte en cadrage ne porte aucune date');
  assert.equal(carte.scheduling?.creneauConseille, undefined, 'ni créneau conseillé');

  const ordinaire = createCard(projet.id, { title: 'Carte ordinaire', origin: 'agent' });
  assert.ok(ordinaire.scheduling?.creneauConseille, 'une carte hors cadrage garde son créneau');
});

/* ------------------------------------------------------------------ */
/* UNE CARTE PARTIE MAIS PAS ENCORE COMMENCÉE EST EN PRÉPARATION       */
/* ------------------------------------------------------------------ */

/*
 * Depuis que la carte passe en « En cours » AU CLIC, sa colonne vaut `running`
 * alors qu'aucun tour ne vit encore. Le chapitre ne connaissait que deux cas
 * dans cette colonne — travail si un tour vit, RAPPORT sinon — et la ligne de
 * temps annonçait donc « Le travail est fait » puis « Le compte rendu est
 * rendu » à une carte que le moteur n'avait pas encore lue (capture du
 * 06.09.2026).
 */

const EN_VOL = {
  colonne: 'running' as const,
  roleAgent: 'task',
  tourEnCours: false,
  messages: [{ role: 'user', content: 'Réalise cette tâche' }],
  tourEnVolDepuis: 1_000,
};

test('une carte lancée dont le moteur n’a pas parlé est en PRÉPARATION, pas au rapport', () => {
  assert.equal(chapitreDuParcours(EN_VOL), 'preparation');
});

test('…et la préparation se referme au premier mot du moteur', () => {
  /* Le tour vit : c'est le travail. */
  assert.equal(chapitreDuParcours({ ...EN_VOL, tourEnCours: true }), 'travail');
  /* Le tour s'est tu après avoir rendu : c'est le rapport, comme avant. */
  assert.equal(
    chapitreDuParcours({ ...EN_VOL, messages: [...EN_VOL.messages, { role: 'assistant', content: 'Fait.' }] }),
    'rapport',
  );
  /* Une réponse ENCORE EN ÉCRITURE ne referme rien : elle n'est pas rendue. */
  assert.equal(
    chapitreDuParcours({
      ...EN_VOL,
      messages: [...EN_VOL.messages, { role: 'assistant', content: 'Fai', streaming: true }],
    }),
    'preparation',
  );
});

test('…et sans marque de vol, rien ne change : une carte au rapport y reste', () => {
  assert.equal(chapitreDuParcours({ ...EN_VOL, tourEnVolDepuis: undefined }), 'rapport');
  /* La marque ne déborde pas des autres colonnes. */
  assert.equal(chapitreDuParcours({ ...EN_VOL, colonne: 'to_deploy' }), 'rapport');
  assert.equal(chapitreDuParcours({ ...EN_VOL, colonne: 'archived' }), 'rapport');
  assert.equal(chapitreDuParcours({ ...EN_VOL, colonne: 'planned' }), 'travail');
});

/*
 * LE FIL D'UNE CARTE CADRÉE PORTE DÉJÀ DES RÉPONSES AVANT LE CLIC. La règle
 * exigeait qu'AUCUNE réponse d'agent ne figure au fil : après un cadrage —
 * c'est-à-dire presque toujours —, la condition était fausse dès le clic, le
 * chapitre retombait sur « rapport », et tous les points qui le précèdent
 * passaient d'office à « fait ». Seule compte donc ce qui a été écrit DEPUIS
 * le clic.
 */
test('une carte lancée APRÈS un cadrage est encore en préparation', () => {
  const cadree = {
    ...EN_VOL,
    messages: [
      { role: 'user', content: 'Voilà ce que je veux', at: 100 },
      { role: 'assistant', content: 'Voici ce que j’ai compris…', at: 200 },
      { role: 'user', content: 'Oui, et aussi ceci', at: 300 },
      { role: 'assistant', content: '# Le plan\n…', at: 400 },
    ],
    tourEnVolDepuis: 1_000,
  };
  assert.equal(chapitreDuParcours(cadree), 'preparation');

  /* Le premier mot du tour LANCÉ, lui, referme la préparation. */
  assert.equal(
    chapitreDuParcours({
      ...cadree,
      messages: [...cadree.messages, { role: 'assistant', content: 'Fait.', at: 1_500 }],
    }),
    'rapport',
  );
  /* Et une réponse du tour lancé ENCORE EN ÉCRITURE ne referme rien. */
  assert.equal(
    chapitreDuParcours({
      ...cadree,
      messages: [...cadree.messages, { role: 'assistant', content: 'Fai', at: 1_500, streaming: true }],
    }),
    'preparation',
  );
});

test('…et un message SANS date se comporte comme avant : il referme la préparation', () => {
  /* Un appelant qui ne transmet pas la date ne doit jamais faire tourner une
     préparation sans fin : on la referme, comme la règle d'avant. */
  assert.equal(
    chapitreDuParcours({ ...EN_VOL, messages: [{ role: 'assistant', content: 'Plan de cadrage' }] }),
    'rapport',
  );
});

test('le seul geste d’une préparation est SUSPENDRE — jamais « Terminer la tâche »', () => {
  const geste = gesteDuParcours(EN_VOL);
  assert.equal(geste.chapitre, 'preparation');
  assert.equal(geste.geste, 'arreter');
  assert.equal(geste.possible, true);
  assert.equal(LIBELLES_GESTE[geste.geste as 'arreter'], 'Suspendre');
});


/* ------------------------------------------------------------------ */
/* UNE COMPRÉHENSION RENDUE APRÈS LE PLAN RALLUME « GÉNÉRER LE PLAN »   */
/* ------------------------------------------------------------------ */

test('une compréhension plus récente qu’un plan VALIDÉ rouvre la décision', () => {
  const avant = { texte: 'Compris.', hypotheses: [], sujets: [], at: 0 };
  const apres = { texte: 'Compris, version 2.', hypotheses: [], sujets: [], at: 5 };
  assert.equal(comprehensionApresLePlan({ plans: [PLAN], comprehension: avant }), false, 'la compréhension d’avant ne compte pas');
  assert.equal(comprehensionApresLePlan({ plans: [PLAN], comprehension: apres }), true);
  assert.equal(comprehensionApresLePlan({ plans: [], comprehension: apres }), false, 'sans plan, rien à rallumer');
  assert.equal(comprehensionApresLePlan(null), false);

  const base = { colonne: 'planned' as const, roleAgent: 'cadrage', messages: DIALOGUE };
  /* Rien n'est encore validé : le geste est la décision. */
  const aLancer = gesteDuParcours({ ...base, tourEnCours: false, parcours: { plans: [PLAN], comprehension: avant } });
  assert.equal(aLancer.geste, 'valider-et-lancer');
  assert.equal(aLancer.possible, true);

  /* La discussion a repris : le plan affiché ne répond plus au besoin. */
  const repris = gesteDuParcours({
    ...base,
    tourEnCours: false,
    parcours: { plans: [PLAN], comprehension: apres, planValide: { version: 1, at: 2 } },
  });
  assert.equal(repris.chapitre, 'plan', 'le chapitre reste le plan : une version existe');
  assert.equal(repris.geste, 'valider-et-lancer', 'la décision d’avant ne vaut plus pour ce qui vient d’être compris');
  assert.equal(repris.possible, true);

  /* Les mêmes gardes que le cadrage l'éteignent. */
  const pendant = gesteDuParcours({ ...base, tourEnCours: true, parcours: { plans: [PLAN], comprehension: apres } });
  assert.equal(pendant.geste, 'arreter', 'pendant le tour, le bouton suspend l’agent');
  assert.equal(pendant.possible, true);

  const question = gesteDuParcours({
    ...base,
    tourEnCours: false,
    messages: [...DIALOGUE, { role: 'assistant', content: '', questions: [{}] }],
    parcours: { plans: [PLAN], comprehension: apres },
  });
  assert.equal(question.geste, 'valider-et-lancer');
  assert.equal(question.raison, RAISONS_DU_GESTE.questionOuverte);

  /* Le plan redemandé : le bouton s'éteint le temps de l'écrire. */
  const enRoute = gesteDuParcours({
    ...base,
    tourEnCours: true,
    parcours: { plans: [PLAN], comprehension: apres, planDemandeA: 9 },
  });
  assert.equal(enRoute.geste, 'arreter');
  assert.equal(enRoute.possible, true);
  const enRouteSansTour = gesteDuParcours({
    ...base,
    tourEnCours: false,
    parcours: { plans: [PLAN], comprehension: apres, planDemandeA: 9 },
  });
  assert.equal(enRouteSansTour.geste, 'valider-et-lancer');
  assert.equal(enRouteSansTour.raison, RAISONS_DU_GESTE.planEnCours);
});

/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* LA CARTE NE BOUGE PLUS PENDANT LE CADRAGE, par le VRAI démon         */
/* ------------------------------------------------------------------ */

test('une carte discutée reste en « Demande », plan en cours comme après affinage', async () => {
  /*
   * LE CHEMIN RÉEL : `replacerCarteAuDemarrage` (`server/src/runtime.ts`) est
   * appelé aux deux seuls points par lesquels un tour peut naître. Depuis le
   * retrait de la colonne « Plan », il ne doit plus RIEN déplacer tant que
   * l'agent qui parle est celui du cadrage — quel que soit l'état du plan.
   */
  const { replacerCarteAuDemarrage } = await import('../runtime.js');

  const projet = store.saveProject({
    id: store.newId(),
    name: 'Cadrage immobile',
    path: bacASable,
    createdAt: store.now(),
    updatedAt: store.now(),
  } as any);
  const carte = createCard(projet.id, { title: 'Exporter en CSV', origin: 'user' });
  const cadrage = { id: 'agent-cadrage-plan', cardId: carte.id, role: 'cadrage' } as any;

  /* Demande de plan EN COURS : la carte ne bouge pas. */
  store.saveCard({
    ...store.getCard(carte.id)!,
    parcours: { plans: [], planDemandeA: Date.now() },
  });
  replacerCarteAuDemarrage(cadrage);
  assert.equal(store.getCard(carte.id)!.column, 'planned', 'le tour du plan ne déplace pas la carte');

  /* Le plan est rendu (`planDemandeA` effacée) : le tour suivant est un
     AFFINAGE, et la carte ne bouge pas davantage. */
  const rendue = store.getCard(carte.id)!;
  store.saveCard({ ...rendue, parcours: { ...rendue.parcours!, planDemandeA: undefined } });
  replacerCarteAuDemarrage(cadrage);
  assert.equal(store.getCard(carte.id)!.column, 'planned', 'l’affinage ne déplace pas la carte');

  /* Un agent d'EXÉCUTION, lui, la fait toujours entrer en « Travail ». */
  replacerCarteAuDemarrage({ id: 'agent-tache-plan', cardId: carte.id, role: 'task' } as any);
  assert.equal(store.getCard(carte.id)!.column, 'running');
});

/* UN TOUR QUI NE S'EST PAS RENDU JUSQU'AU BOUT SE REPREND              */
/* ------------------------------------------------------------------ */

/*
 * Le chapitre « rapport » d'une carte en « En cours » ne proposait qu'une
 * issue : « Terminer la tâche ». C'était offrir de refermer un travail à
 * moitié rendu — des lignes de la liste de tâches jamais faites, ou un tour
 * tombé en échec. Le geste principal devient « Reprendre » ; « Terminer la
 * tâche » reste offert en SECOND, pour qui juge que ce qui est fait suffit.
 */

const EN_COURS = { colonne: 'running' as const, roleAgent: 'tache', messages: [], tourEnCours: false };

test('un tour abouti garde « Terminer la tâche » comme seul geste', () => {
  const geste = gesteDuParcours(EN_COURS as any);
  assert.equal(geste.chapitre, 'rapport');
  assert.equal(geste.geste, 'terminer');
  assert.equal(geste.possible, true);
  assert.deepEqual(gestesDuParcours(EN_COURS as any).map((g) => g.geste), ['terminer']);
});

test('des étapes non faites font passer le geste à « Reprendre », avec « Terminer » en second', () => {
  const ctx = { ...EN_COURS, tachesNonFaites: 2 };
  assert.equal(tourNonAbouti(ctx as any), true);
  const geste = gesteDuParcours(ctx as any);
  assert.equal(geste.geste, 'reprendre');
  assert.equal(geste.possible, true);
  assert.equal(LIBELLES_GESTE.reprendre, 'Reprendre');
  const rangee = gestesDuParcours(ctx as any);
  assert.deepEqual(rangee.map((g) => g.geste), ['reprendre', 'terminer']);
  assert.equal(rangee[1].possible, true, 'ce qui est fait peut suffire : le second geste reste offert');
});

test('un dernier tour en échec se reprend lui aussi', () => {
  const ctx = { ...EN_COURS, dernierTourEnEchec: true };
  assert.equal(tourNonAbouti(ctx as any), true);
  assert.equal(gesteDuParcours(ctx as any).geste, 'reprendre');
});

/*
 * UNE PANNE DE CADRAGE N'EST PAS UN TRAVAIL INTERROMPU (constaté le
 * 15.09.2026) : l'agent de cadrage est l'agent de la carte, et son tour de
 * compréhension tombé rougissait « Travail » avec un « Reprendre » inutile.
 */
const CADRAGE_TOMBE = {
  colonne: 'planned' as const,
  roleAgent: 'cadrage',
  tourEnCours: false,
  dernierTourEnEchec: true,
  messages: [
    { role: 'user', content: 'Corrige ce domaine' },
    { role: 'assistant', content: '', erreurDeTour: { demandeARejouer: 'm1' } },
  ],
};

test('un tour de compréhension tombé n’est pas un travail non abouti', () => {
  assert.equal(travailDExecutionLance(CADRAGE_TOMBE as any), false);
  assert.equal(tourNonAbouti(CADRAGE_TOMBE as any), false);
  const geste = gesteDuParcours(CADRAGE_TOMBE as any);
  assert.notEqual(geste.geste, 'reprendre');
  assert.equal(geste.raison, RAISONS_DU_GESTE.decisionOuverte, 'la décision du bas reste le seul chemin');
});

test('…ni un tour de plan tombé, ni une préparation de lancement', () => {
  const plan = { ...CADRAGE_TOMBE, parcours: { plans: [{ numero: 1, texte: '# P', at: 1 }] } };
  assert.equal(tourNonAbouti(plan as any), false);
  const preparation = { ...CADRAGE_TOMBE, colonne: 'running' as const, tourEnVolDepuis: 10, messages: [] };
  assert.equal(tourNonAbouti(preparation as any), false);
});

test('une vraie tâche arrêtée puis ramenée en « Planifié » garde « Reprendre »', () => {
  const ctx = { ...CADRAGE_TOMBE, roleAgent: 'task', messages: [] };
  assert.equal(travailDExecutionLance(ctx as any), true);
  assert.equal(tourNonAbouti(ctx as any), true);
  assert.equal(gesteDuParcours(ctx as any).geste, 'reprendre');
});

test('un tour VIVANT n’est jamais « non abouti » : il n’a pas fini de se rendre', () => {
  const ctx = { ...EN_COURS, tourEnCours: true, tachesNonFaites: 2, dernierTourEnEchec: true };
  assert.equal(tourNonAbouti(ctx as any), false);
  /* Le chapitre redescend au travail : le seul geste est d'arrêter. */
  assert.equal(gesteDuParcours(ctx as any).geste, 'arreter');
});

test('une question ou une décision ouverte éteint « Reprendre », en le nommant', () => {
  const question = gesteDuParcours({
    ...EN_COURS,
    tachesNonFaites: 1,
    messages: [{ role: 'assistant', content: '', questions: [{}] }],
  } as any);
  assert.equal(question.geste, 'reprendre');
  assert.equal(question.possible, false);
  assert.equal(question.raison, RAISONS_DU_GESTE.questionOuverte);

  const decision = gesteDuParcours({
    ...EN_COURS,
    tachesNonFaites: 1,
    messages: [{ role: 'assistant', content: '', erreurDeTour: {} }],
  } as any);
  assert.equal(decision.geste, 'reprendre');
  assert.equal(decision.possible, false);
  assert.equal(decision.raison, RAISONS_DU_GESTE.decisionOuverte);
  /* Et le second geste s'éteint pour la même raison, jamais tout seul. */
  const rangee = gestesDuParcours({
    ...EN_COURS,
    tachesNonFaites: 1,
    messages: [{ role: 'assistant', content: '', erreurDeTour: {} }],
  } as any);
  assert.deepEqual(rangee.map((g) => g.possible), [false, false]);
});

/* ------------------------------------------------------------------ */
/* Le bouton du plan lit la MÊME source que le flux, et nomme sa version */
/* ------------------------------------------------------------------ */

/*
 * Le bandeau du plan, dans le flux, ouvre sa décision avec
 * `decisionDePlanOuverte` : version courante, plan non validé, aucun tour en
 * cours, ET travail pas encore lancé. Le bouton collé au champ de saisie ne
 * lisait que la validation — deux réponses possibles à la même question, sur le
 * même écran. Une carte revenue en « Planifié » après avoir enregistré du code
 * offrait donc « Valider le plan » là où le flux, juste au-dessus, n'offrait
 * plus rien.
 */
test('une carte qui a DÉJÀ enregistré du code n’offre plus « Valider le plan »', () => {
  const base = {
    colonne: 'planned' as const,
    roleAgent: 'cadrage',
    tourEnCours: false,
    messages: DIALOGUE,
    parcours: { plans: [PLAN] },
  };
  assert.equal(gesteDuParcours(base).geste, 'valider-et-lancer', 'rien n’a encore été fait : on valide');
  const travaillee = gesteDuParcours({ ...base, codeDejaEnregistre: true });
  assert.equal(travaillee.geste, 'lancer', 'le travail a déjà commencé : plus rien à décider');
  assert.equal(travaillee.possible, true, 'une carte planifiée reste lançable');
});

test('une carte passée dans les mains d’un AUTRE agent que celui du plan ne se valide plus', () => {
  const geste = gesteDuParcours({
    colonne: 'planned',
    roleAgent: 'cadrage',
    tourEnCours: false,
    messages: DIALOGUE,
    parcours: { plans: [PLAN] },
    agentDuPlan: 'agent-du-cadrage',
    agentDeLaCarte: 'agent-de-tache',
  });
  assert.equal(geste.geste, 'lancer');
});

test('le geste NOMME la version du plan sur laquelle il porte', () => {
  const v3 = gesteDuParcours({
    colonne: 'planned',
    roleAgent: 'cadrage',
    tourEnCours: false,
    messages: DIALOGUE,
    parcours: { plans: [PLAN, { ...PLAN, numero: 2 }, { ...PLAN, numero: 3 }] },
  });
  assert.equal(v3.geste, 'valider-et-lancer');
  assert.equal(v3.versionDuPlan, 3, 'la version courante, jamais la première du fil');
  const valide = gesteDuParcours({
    colonne: 'planned',
    roleAgent: 'cadrage',
    tourEnCours: false,
    messages: DIALOGUE,
    parcours: { plans: [PLAN], planValide: { version: 1, at: 2 } },
  });
  assert.equal(valide.geste, 'lancer');
  assert.equal(valide.versionDuPlan, 1, '« Lancer » dit aussi de quel plan il part');
});

test('la version courante du plan se lit sans le reste du parcours', () => {
  assert.equal(versionCouranteDuPlan({ plans: [PLAN, { ...PLAN, numero: 2 }] }), 2);
  assert.equal(versionCouranteDuPlan({ plans: [] }), undefined);
  assert.equal(versionCouranteDuPlan(null), undefined);
});

/* ------------------------------------------------------------------ */
/* UNE COMPRÉHENSION DU TOUR MÊME DU PLAN N'EST PAS UNE REPRISE         */
/* ------------------------------------------------------------------ */

test('une compréhension écrite dans le tour du plan ne rallume pas « Générer le plan »', () => {
  const plan = { ...PLAN, at: 10, tourId: 'tour-plan' };
  const duMemeTour = { texte: 'Compris après coup.', hypotheses: [], sujets: [], at: 20, tourId: 'tour-plan' };
  const vraieReprise = { texte: 'Compris, version 2.', hypotheses: [], sujets: [], at: 30, tourId: 'tour-suivant' };
  assert.equal(comprehensionApresLePlan({ plans: [plan], comprehension: duMemeTour }), false, 'même tour : pas de reprise');
  assert.equal(comprehensionApresLePlan({ plans: [plan], comprehension: vraieReprise }), true, 'un vrai nouveau tour rouvre le cadrage');
});

/* -------- Pas de plan sans compréhension (carte de nuit fd54689b) -------- */

test('le plan ne se demande jamais sans compréhension, et le bouton la redemande', async () => {
  const shared = await import('@beluga/shared');
  const compris = { texte: 'compris', at: 10 };
  assert.equal(shared.comprehensionPourLePlan({ column: 'planned', parcours: { comprehension: compris } }), true);
  assert.equal(shared.comprehensionPourLePlan({ column: 'planned', parcours: {} }), false);
  assert.equal(shared.comprehensionPourLePlan({ column: 'planned', parcours: null }), false);

  // Le point « Plan » en erreur sur une carte sans compréhension : le geste la redemande.
  const points = shared.pointsDuParcours([], {
    chapitre: 'cadrage',
    colonne: 'planned',
    parcours: { plans: [], incident: { texte: 'pas de plan', at: 3_000 } },
    tourEnCours: false,
    questionsOuvertes: 0,
  });
  const erreur = points.find((p) => p.etape === 'plan')?.erreurs[0];
  assert.equal(erreur?.action, 'redemander-comprehension');

  // Le démon garde la règle lui-même, et offre la commande dédiée.
  const fs = await import('node:fs');
  const ws = fs.readFileSync(new URL('../../src/ws.ts', import.meta.url), 'utf8');
  const plan = ws.split('async function demanderLePlan(')[1].split('\n}')[0];
  assert.ok(plan.includes('comprehensionPourLePlan(card)') && plan.includes('REFUS_PLAN_SANS_COMPREHENSION'));
  assert.ok(plan.indexOf('comprehensionPourLePlan') < plan.indexOf('store.saveCard'), 'refusé avant tout écrit');
  assert.ok(ws.includes("case 'comprehension.redemander'"));
  const redemande = ws.split('async function redemanderLaComprehension(')[1].split('\n}')[0];
  assert.ok(!redemande.includes('planDemandeA'), 'redemander la compréhension ne touche pas au plan');
});

test('une carte automatique sans compréhension est rattrapée une fois, et seulement elle', async () => {
  const { comprehensionARattraper } = await import('@beluga/shared');
  const base = {
    automatique: true,
    column: 'planned' as const,
    parcours: {},
    cadrageAuRepos: true,
    dejaRattrapee: false,
  };
  assert.equal(comprehensionARattraper(base), true);
  assert.equal(comprehensionARattraper({ ...base, dejaRattrapee: true }), false);
  assert.equal(comprehensionARattraper({ ...base, automatique: false }), false);
  assert.equal(comprehensionARattraper({ ...base, cadrageAuRepos: false }), false);
  assert.equal(comprehensionARattraper({ ...base, column: 'running' as const }), false);
  assert.equal(comprehensionARattraper({ ...base, parcours: { planDemandeA: 5 } }), false);
  assert.equal(comprehensionARattraper({ ...base, parcours: { comprehension: { texte: 'x', at: 1 } } }), false);
});

test('« Valider et lancer » devient « Ne pas attendre » seulement avec une heure de départ posée', () => {
  assert.equal(libelleDeValidation(undefined), 'Lancer et valider');
  assert.equal(libelleDeValidation({}), 'Lancer et valider');
  /* Un créneau conseillé n'est pas un départ planifié. */
  assert.equal(libelleDeValidation({ creneauConseille: { at: 1 } } as any), 'Lancer et valider');
  assert.equal(libelleDeValidation({ departPrevu: Date.now() + 3600_000 }), LIBELLE_NE_PAS_ATTENDRE);
});

/* UNE CARTE SUSPENDUE À LA MAIN SE REPREND D'UN BOUTON (14/10/2026). */
test('une carte SUSPENDUE en « En cours » offre « Reprendre » — jamais la fin de tâche', () => {
  const ctx = { colonne: 'running' as const, roleAgent: 'task', tourEnCours: false, enPause: true, messages: [], dernierTourEnEchec: true };
  assert.equal(chapitreDuParcours(ctx), 'travail');
  const geste = gesteDuParcours(ctx);
  assert.equal(geste.geste, 'reprendre');
  assert.equal(geste.possible, true);
  /* « Reprendre » mène la rangée ; « Terminer la tâche » reste offert en second. */
  assert.deepEqual(gestesDuParcours(ctx).map((g) => g.geste), ['reprendre', 'terminer']);
  assert.equal(tourNonAbouti(ctx), false, 'une suspension n’est pas un tour mal terminé');
  /* Le tour reparti, le bouton redevient « Suspendre ». */
  assert.equal(gesteDuParcours({ ...ctx, tourEnCours: true }).geste, 'arreter');
  /* Sans pause, la même carte reste au rapport, comme avant. */
  assert.equal(chapitreDuParcours({ ...ctx, enPause: false }), 'rapport');
});

test('les réglages de l’agent rejoignent le bouton de lancement seulement quand il est scindé', () => {
  for (const geste of ['valider-et-lancer', 'lancer', 'reprendre'] as const) {
    assert.equal(lancementScinde([{ geste, chapitre: 'cadrage' }]), true, geste);
  }
  /* « Annuler » du cadrage (ou du plan) garde le groupe, et donc les réglages. */
  assert.equal(lancementScinde([{ geste: 'arreter', chapitre: 'cadrage' }]), true);
  assert.equal(lancementScinde([{ geste: 'arreter', chapitre: 'plan' }]), true);
  /* Travail en cours, fin de tâche, rien : les réglages restent dans la barre d'écriture. */
  assert.equal(lancementScinde([{ geste: 'arreter', chapitre: 'travail' }]), false);
  assert.equal(lancementScinde([{ geste: 'terminer', chapitre: 'rapport' }]), false);
  assert.equal(lancementScinde([{ geste: 'aucun', chapitre: 'cadrage' }]), false);
  assert.equal(lancementScinde([]), false);
  /* Seul le PREMIER geste compte : un « Reprendre » en second ne scinde rien. */
  assert.equal(lancementScinde([{ geste: 'terminer', chapitre: 'rapport' }, { geste: 'reprendre', chapitre: 'rapport' }]), false);
});
