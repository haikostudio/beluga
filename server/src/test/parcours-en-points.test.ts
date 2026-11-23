import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ETAPES_DU_PARCOURS,
  JALON_COMPREHENSION,
  JALON_PLAN_DEMANDE,
  JALON_PLAN_PROPOSE,
  JALON_TOUR_LANCE,
  PHRASES_DE_L_ATTENTE,
  PHRASES_DU_POINT,
  ancreDuPoint,
  attenteDeLaDemande,
  echoLocalSelonLaFile,
  chapitreDuParcours,
  PREPARATION_MAX_MS,
  barreDuParcours,
  contenuDesPoints,
  etapeDeLEntree,
  etapeDeLaMemoire,
  fluxDuParcours,
  lignesDeLEtape,
  ligneDUneLecture,
  nomDeLaLigne,
  dernierPassage,
  pointsDuParcours,
  TEXTE_CADRAGE_TOMBE,
  PHRASE_COMPREHENSION_REPONDUE,
  PHRASE_COMPREHENSION_EN_ATTENTE,
  tourDeReponseSeule,
  reponseDuPassage,
  blocDeFinDuPassage,
  blocDeFinAViser,
  pointsOuvertsDOffice,
  phraseDeLaPreparation,
  tourLanceApresLaDemande,
  TEXTE_TRAVAIL_NON_ABOUTI,
  PHRASE_TRAVAIL_SUSPENDU,
  JALON_TOUR_SUSPENDU,
  TEXTE_TOUR_SUSPENDU,
  RAISON_TRAVAIL_SAUVE,
  RAISON_TOUR_SANS_ISSUE,
  RAISON_RENDU_SANS_CODE,
  versionDuPassageDePlan,
  planEnCoursDEcriture,
  versionEnPreparation,
  laCarteAUnPlan,
  barreDeSuivi,
  segmentActifDeSuivi,
} from '@beluga/shared';

/** Le passage d'une étape, par son rang : `passage(points, 'plan', 2)`. */
const passage = (points: any[], etape: string, rang = 1) =>
  points.find((p) => p.etape === etape && p.rang === rang);
/** Les passages du flux, lus « étape rang/total », dans l'ordre du temps. */
const suite = (points: any[]) => points.map((p) => `${p.etape} ${p.rang}/${p.total ?? 1}`);

/* ------------------------------------------------------------------ */
/* Un journal de carte crédible, du cadrage au rapport                  */
/* ------------------------------------------------------------------ */

let rang = 0;
const e = (partiel: Record<string, unknown>) => ({
  id: `e${rang}`,
  cardId: 'c',
  rang: rang++,
  at: 1000 + rang,
  nature: 'requete',
  phase: 'cadrage',
  libelle: '',
  ...partiel,
});

const demande = e({ nature: 'jalon', libelle: 'Demande', agentRole: 'cadrage', resultat: 'Je veux un bouton' });
const tourCadrage = e({ nature: 'jalon', libelle: JALON_TOUR_LANCE, agentRole: 'cadrage' });
const memoireCadrage = e({ outil: 'project_memory', libelle: 'project_memory', agentRole: 'cadrage', params: '{"sujet":"interface"}' });
const question = e({ outil: 'ask_user', libelle: 'ask_user', agentRole: 'cadrage', params: '{"question":"Quel format ?"}', resultat: 'Question posée à l’utilisateur. ARRÊTE-TOI ICI et rends la main.' });
const comprehension = e({ nature: 'jalon', libelle: JALON_COMPREHENSION, agentRole: 'cadrage', resultat: 'compris' });
const reponseCadrage = e({ phase: 'rapport', nature: 'jalon', libelle: 'Réponse rendue', agentRole: 'cadrage', resultat: 'Voilà.' });
const planDemande = e({ nature: 'jalon', libelle: JALON_PLAN_DEMANDE, agentRole: 'cadrage', resultat: 'Première version demandée.' });
const lecturePlan = e({ outil: 'Read', libelle: 'Lecture', agentRole: 'cadrage', params: '{"file_path":"/a.ts"}' });
const planRendu = e({ nature: 'jalon', libelle: JALON_PLAN_PROPOSE, agentRole: 'cadrage', resultat: '# P', donnees: '{"version":1}' });
const affinage = e({ nature: 'jalon', libelle: 'Demande', agentRole: 'cadrage', resultat: 'Ajoute le PDF' });
const planRendu2 = e({ nature: 'jalon', libelle: JALON_PLAN_PROPOSE, agentRole: 'cadrage', resultat: '# P2', donnees: '{"version":2}' });
const tourExecution = e({ phase: 'execution', nature: 'jalon', libelle: JALON_TOUR_LANCE, agentRole: 'tache' });
const commande = e({ phase: 'execution', outil: 'Bash', libelle: 'Commande', agentRole: 'tache', params: '{"command":"npm test"}' });
const messageAgent = e({ phase: 'execution', nature: 'jalon', libelle: 'Demande', agentRole: 'tache', resultat: 'Continue' });
const interrompu = e({ phase: 'rapport', nature: 'jalon', libelle: 'Tour interrompu', agentRole: 'tache', resultat: 'Le moteur est tombé.', reussie: false });
const rapport = e({ phase: 'rapport', nature: 'jalon', libelle: 'Réponse rendue', agentRole: 'tache', resultat: '## 1. Analyse\nfait' });

const CADRAGE = [demande, tourCadrage, memoireCadrage, question, comprehension, reponseCadrage];
const PLAN = [planDemande, lecturePlan, planRendu, affinage, planRendu2];
const TRAVAIL = [tourExecution, commande, messageAgent];
const TOUT = [...CADRAGE, ...PLAN, ...TRAVAIL, rapport];

const base = { colonne: 'planned', tourEnCours: false, parcours: null, questionsOuvertes: 0 } as const;

test('LA RELANCE DU 13/09 : un travail coupé, « Termine », puis un compte rendu court — il est le DERNIER rapport, lisible en entier', () => {
  const coupe = e({ phase: 'rapport', nature: 'jalon', libelle: 'Tour interrompu', agentRole: 'tache', resultat: "You've hit your weekly limit", reussie: false });
  const relance = e({ phase: 'execution', nature: 'jalon', libelle: 'Demande', agentRole: 'tache', resultat: 'Termine' });
  const tourRelance = e({ phase: 'execution', nature: 'jalon', libelle: JALON_TOUR_LANCE, agentRole: 'tache' });
  const rapportCourt = e({
    phase: 'rapport',
    nature: 'jalon',
    libelle: 'Réponse rendue',
    agentRole: 'tache',
    resultat: 'La carte est terminée. Le code était déjà enregistré et envoyé sur sa branche.',
    reussie: true,
  });
  const points = contenuDesPoints([...CADRAGE, ...PLAN, tourExecution, commande, coupe, relance, tourRelance, rapportCourt] as any);
  const rapports = points.filter((p: any) => p.etape === 'rapport' && p.moments.some((m: any) => m.sorte === 'rapport'));
  assert.equal(rapports.length, 1, 'le compte rendu de la relance ouvre son passage « Rapport »');
  const moment: any = rapports[0].moments.find((m: any) => m.sorte === 'rapport');
  assert.equal(moment.dernier, true, 'il est le DERNIER compte rendu : l’écran le montre déplié');
  assert.match(moment.entree.resultat, /La carte est terminée/, 'son texte entier voyage jusqu’à l’écran');
});

test('les sept étapes, dans cet ordre, chacune avec sa phrase pour chaque état', () => {
  /* « Configuration » ouvre le parcours : c'est le premier segment de la barre
     et le premier point du fil, avant « Demande ». « Préparation » se glisse
     entre le plan et le travail : le temps du lancement, et lui seul. */
  assert.deepEqual(
    [...ETAPES_DU_PARCOURS],
    ['configuration', 'demande', 'comprehension', 'plan', 'preparation', 'travail', 'rapport'],
  );
  for (const etape of ETAPES_DU_PARCOURS) {
    for (const etat of ['avenir', 'encours', 'fait', 'question', 'erreur'] as const) {
      assert.ok(PHRASES_DU_POINT[etape][etat].length > 0, `${etape}/${etat}`);
    }
    assert.equal(ancreDuPoint(etape), `point-${etape}`);
    assert.equal(ancreDuPoint(etape, 1), `point-${etape}`, 'le premier passage garde le nom court');
    assert.equal(ancreDuPoint(etape, 3), `point-${etape}-3`, 'les suivants portent leur rang');
  }
});

test('chaque entrée va sous UN point : la demande, la compréhension, le plan, le travail, le rapport', () => {
  assert.equal(etapeDeLEntree(demande as any, false), 'demande');
  assert.equal(etapeDeLEntree(memoireCadrage as any, false), 'comprehension');
  assert.equal(etapeDeLEntree(comprehension as any, false), 'comprehension');
  assert.equal(etapeDeLEntree(reponseCadrage as any, false), 'comprehension');
  assert.equal(etapeDeLEntree(planDemande as any, false), 'plan');
  assert.equal(etapeDeLEntree(lecturePlan as any, true), 'plan');
  assert.equal(
    etapeDeLEntree(affinage as any, true),
    'demande',
    'une précision après le plan rouvre « Demande » : elle ne s’écrit plus dans le plan déjà rendu',
  );
  assert.equal(etapeDeLEntree(commande as any, true), 'travail');
  /* UN MESSAGE HUMAIN REÇU CARTE EN COURS EST UNE « DEMANDE », PAS DU TRAVAIL.
     Il tombait au milieu des lectures et des commandes de l'agent : invisible
     comme demande, introuvable dans le flux. Ce que l'utilisateur écrit n'est
     jamais du travail d'agent — c'est ce qui le déclenche. */
  assert.equal(etapeDeLEntree(messageAgent as any, true), 'demande');
  assert.equal(etapeDeLEntree(interrompu as any, true), 'travail');
  assert.equal(etapeDeLEntree(rapport as any, true), 'rapport');
});

test('le contenu des passages : moments à lire, traces repliées, questions et versions', () => {
  const points = contenuDesPoints(TOUT as any);
  assert.deepEqual(
    suite(points),
    [
      'configuration 1/1',
      'demande 1/1',
      'comprehension 1/1',
      'plan 1/1',
      'demande 2/1',
      'plan 2/1',
      'travail 1/1',
      'demande 3/1',
      'rapport 1/1',
    ],
    'chaque version de plan a SON passage, et tout message humain — même carte en cours — ouvre le sien',
  );
  const d1 = passage(points, 'demande');
  assert.equal(d1.moments.length, 1);
  assert.equal(d1.moments[0].sorte, 'demande');
  const c1 = passage(points, 'comprehension');
  assert.deepEqual(
    c1.traces.map((t: any) => t.id),
    [tourCadrage.id, memoireCadrage.id, reponseCadrage.id],
    'la machine du cadrage est une trace, jamais un moment',
  );
  assert.equal(c1.questions.length, 1, 'la question est rangée à part');
  assert.equal(c1.questions[0].repondue, false, 'une consigne au moteur n’est pas une réponse');
  assert.equal(c1.moments.filter((m: any) => m.sorte === 'comprehension').length, 1);
  const p1 = passage(points, 'plan', 1);
  const p2 = passage(points, 'plan', 2);
  assert.deepEqual(p1.moments.filter((m: any) => m.sorte === 'plan').map((m: any) => m.version), [1]);
  assert.deepEqual(p2.moments.filter((m: any) => m.sorte === 'plan').map((m: any) => m.version), [2]);
  const d2 = passage(points, 'demande', 2);
  assert.ok(
    d2.moments.some((m: any) => m.sorte === 'demande' && m.entree.id === affinage.id),
    'la précision qui a fait refaire le plan ouvre un passage « Demande » NEUF, en bas du flux',
  );
  assert.ok(
    !p1.moments.some((m: any) => m.sorte === 'demande'),
    'elle ne vient PAS s’écrire dans le plan déjà rendu',
  );
  assert.equal(p1.ancre, 'point-plan');
  assert.equal(p2.ancre, 'point-plan-2', 'deux plans ne se disputent jamais la même ancre');
  const t1 = passage(points, 'travail');
  assert.equal(t1.moments.length, 0, 'le travail ne porte que ce que l’agent a fait');
  const d3 = passage(points, 'demande', 3);
  assert.ok(
    d3.moments.some((m: any) => m.sorte === 'demande' && m.entree.id === messageAgent.id),
    'le message envoyé carte en cours ouvre SON passage « Demande », en bas du flux',
  );
  const r1 = passage(points, 'rapport');
  assert.equal(r1.moments.length, 1);
  assert.equal((r1.moments[0] as any).dernier, true);
});

test('le flux GRANDIT à chaque itération : deux compréhensions font deux points', () => {
  const seconde = { ...comprehension, id: 'c2', rang: 99, at: 5000, resultat: 'mieux compris' };
  const points = contenuDesPoints([...CADRAGE, seconde] as any);
  assert.deepEqual(suite(points), ['configuration 1/1', 'demande 1/1', 'comprehension 1/1', 'comprehension 2/1', 'plan 1/1', 'travail 1/1', 'rapport 1/1']);
  const numeros = points
    .flatMap((p) => p.moments)
    .filter((m: any) => m.sorte === 'comprehension')
    .map((m: any) => m.numero);
  assert.deepEqual(numeros, [1, 2], 'les compréhensions restent numérotées de bout en bout');
  /* Un point ancien ne change pas de contenu : la première compréhension reste là où elle était. */
  assert.equal(passage(points, 'comprehension', 1).moments.filter((m: any) => m.sorte === 'comprehension').length, 1);

  /* Trois plans font trois points, et la barre garde ses cinq segments. */
  const plan3 = { ...planRendu, id: 'p3', rang: 300, at: 9000, donnees: '{"version":3}' };
  const precision2 = { ...affinage, id: 'a2', rang: 299, at: 8900, resultat: 'Et le XML' };
  const trois = pointsDuParcours([...CADRAGE, ...PLAN, precision2, plan3] as any, {
    ...base,
    chapitre: 'plan',
    parcours: { plans: [{ numero: 1, titre: 'P', resume: '', texte: '# P', at: 1 }] },
  });
  assert.equal(trois.filter((p) => p.etape === 'plan').length, 3);
  assert.deepEqual(
    trois.filter((p) => p.etape === 'plan').map((p) => `${p.rang}/${p.total}`),
    ['1/3', '2/3', '3/3'],
    'chaque plan sait son rang, pour se repérer dans un flux devenu long',
  );
  assert.equal(barreDuParcours(trois).length, 6, 'la barre ne compte JAMAIS les itérations');
});

test('les états : fait avant l’étape courante, en cours dessus, à venir après', () => {
  /* La BARRE replie les passages sur les étapes : c'est elle qui dit
     l'avancement, quel que soit le nombre d'itérations du flux. TANT QU'AUCUN
     PLAN N'EXISTE, elle n'en compte que CINQ : le segment « Plan » ne paraît
     qu'avec le plan lui-même. */
  const etats = (points: ReturnType<typeof pointsDuParcours>) => barreDuParcours(points).map((s) => s.etat);
  /* Rien dit encore : la demande ATTEND, immobile — elle ne tourne pas tant que rien n'est parti (capture #589d). */
  const vide = pointsDuParcours([], { ...base, chapitre: 'cadrage' });
  assert.deepEqual(etats(vide), ['fait', 'avenir', 'avenir', 'avenir', 'avenir']);
  assert.equal(vide.filter((p) => p.etat === 'encours').length, 0, 'une discussion neuve ne montre rien qui tourne');
  assert.equal(passage(vide, 'demande').phrase, PHRASES_DU_POINT.demande.avenir);
  /* …mais un tour vivant (l'envoi parti, rien encore d'écrit au journal) la fait tourner. */
  assert.equal(
    barreDuParcours(pointsDuParcours([], { ...base, chapitre: 'cadrage', tourEnCours: true })).find((s) => s.etape === 'demande')?.etat,
    'encours',
  );
  /* L'ÉCHO LOCAL d'un envoi se lit dans le flux, mais n'avance pas le point :
     rien n'est encore écrit. */
  const echo = pointsDuParcours([{ ...demande, id: 'envoi-local', provisoire: true }] as any, { ...base, chapitre: 'cadrage' });
  assert.deepEqual(etats(echo), ['fait', 'encours', 'avenir', 'avenir', 'avenir']);
  assert.equal(passage(echo, 'demande').moments.length, 1);
  /* La demande est partie, le tour tourne. */
  assert.deepEqual(
    etats(pointsDuParcours([demande, tourCadrage] as any, { ...base, chapitre: 'cadrage', tourEnCours: true })),
    ['fait', 'fait', 'encours', 'avenir', 'avenir'],
  );
  /* La compréhension est rendue, l'agent attend qu'on demande le plan. */
  const compris = pointsDuParcours([demande, comprehension] as any, {
    ...base,
    chapitre: 'cadrage',
    parcours: { comprehension: { texte: 'compris', at: 1, hypotheses: [], sujets: [] }, plans: [] },
  });
  assert.deepEqual(etats(compris), ['fait', 'fait', 'fait', 'avenir', 'avenir']);
  assert.equal(passage(compris, 'comprehension').phrase, PHRASES_DU_POINT.comprehension.fait);
  /* Le plan est demandé : le point Plan s'anime. */
  assert.deepEqual(
    etats(pointsDuParcours([...CADRAGE, planDemande] as any, { ...base, chapitre: 'cadrage', tourEnCours: true, parcours: { plans: [], planDemandeA: 1 } })),
    ['fait', 'fait', 'fait', 'encours', 'avenir', 'avenir'],
  );
  /* Le plan est rendu : à relire, puis à lancer. */
  const PLAN_RENDU = { plans: [{ numero: 1, titre: 'P', resume: '', texte: '# P', at: 1 }] };
  assert.deepEqual(
    etats(pointsDuParcours([...CADRAGE, ...PLAN] as any, { ...base, chapitre: 'plan', parcours: PLAN_RENDU })),
    ['fait', 'fait', 'fait', 'fait', 'avenir', 'avenir'],
  );
  /* Le travail tourne. */
  assert.deepEqual(
    etats(pointsDuParcours([...CADRAGE, ...PLAN, ...TRAVAIL] as any, { chapitre: 'travail', colonne: 'running', tourEnCours: true, parcours: PLAN_RENDU, questionsOuvertes: 0 })),
    ['fait', 'fait', 'fait', 'fait', 'encours', 'avenir'],
  );
  /* Le rapport est rendu. */
  assert.deepEqual(
    etats(pointsDuParcours(TOUT as any, { chapitre: 'rapport', colonne: 'running', tourEnCours: false, parcours: PLAN_RENDU, questionsOuvertes: 0 })),
    ['fait', 'fait', 'fait', 'fait', 'fait', 'fait'],
  );
});

/* ------------------------------------------------------------------ */
/* LE POINT « PLAN » N'EXISTE QUE SI LA CARTE A UN PLAN                 */
/* ------------------------------------------------------------------ */

test('sans plan demandé ni rendu, ni le flux ni la barre ne montrent l’étape « Plan »', () => {
  /* Le plan de cadrage ne se rend plus tout seul : la plupart des cartes n'en
     ont jamais. Le rendez-vous annoncé entre la compréhension et le travail ne
     s'affiche donc plus du tout. */
  const nue = { ...base, chapitre: 'cadrage' } as const;
  const points = pointsDuParcours(CADRAGE as any, nue);
  assert.equal(laCarteAUnPlan(points, nue as any), false);
  assert.equal(points.filter((p) => p.etape === 'plan').length, 0, 'aucun point « Plan » dans le flux');
  assert.deepEqual(
    barreDuParcours(points).map((s) => s.etape),
    ['configuration', 'demande', 'comprehension', 'travail', 'rapport'],
    'la barre passe à cinq segments, sans trou',
  );
  /* ET AUCUNE CIBLE MORTE : la barre ne propose que des ancres qui existent. */
  const ancres = points.map((p) => p.ancre);
  for (const segment of barreDuParcours(points)) {
    assert.ok(ancres.includes(dernierPassage(points, segment.etape)!.ancre), segment.etape);
  }
  /* Une carte MENÉE JUSQU'AU BOUT sans plan n'en montre pas davantage. */
  const finie = pointsDuParcours([...CADRAGE, ...TRAVAIL, rapport] as any, {
    ...base,
    chapitre: 'rapport',
    colonne: 'to_deploy',
  });
  assert.equal(finie.filter((p) => p.etape === 'plan').length, 0);
});

test('un plan DEMANDÉ, RENDU, ou attendu par un tour de plan ramène le point et son segment', () => {
  /* 1. LE PLAN S'ÉCRIT : `planDemandeA` est posé, rien n'est encore rendu. */
  const enEcriture = {
    ...base,
    chapitre: 'cadrage' as const,
    tourEnCours: true,
    parcours: { plans: [], planDemandeA: 1 },
  };
  const demande1 = pointsDuParcours([...CADRAGE, planDemande] as any, enEcriture);
  assert.equal(laCarteAUnPlan(demande1, enEcriture as any), true);
  assert.equal(passage(demande1, 'plan').etat, 'encours');
  assert.ok(barreDuParcours(demande1).some((s) => s.etape === 'plan'));

  /* 2. LE PLAN EST RENDU : le point reste, même une fois le travail fait. */
  const rendu = { ...base, chapitre: 'plan' as const, parcours: { plans: [{ numero: 1, titre: 'P', resume: '', texte: '# P', at: 1 }] } };
  const points = pointsDuParcours([...CADRAGE, ...PLAN] as any, rendu);
  assert.equal(laCarteAUnPlan(points, rendu as any), true);
  assert.equal(points.filter((p) => p.etape === 'plan').length, 2, 'les deux versions gardent leur passage');
  assert.equal(barreDuParcours(points).length, 6);

  /* 3. LE SEUL JALON SUFFIT : une carte dont la carte ne porte plus de plan —
     journal purgé côté carte — garde son point tant que le journal en parle. */
  const parJalon = { ...base, chapitre: 'travail' as const, colonne: 'running' as const, parcours: null };
  const vieux = pointsDuParcours([...CADRAGE, ...PLAN, ...TRAVAIL] as any, parJalon);
  assert.equal(laCarteAUnPlan(vieux, parJalon as any), true);
  assert.ok(vieux.some((p) => p.etape === 'plan'));

  /* 4. UN INCIDENT NON LEVÉ qui vise le plan garde son point rouge. */
  const incident = {
    ...base,
    chapitre: 'cadrage' as const,
    parcours: { plans: [], incident: { texte: 'Le plan n’est pas venu', at: 2 } },
  };
  const rouge = pointsDuParcours(CADRAGE as any, incident as any);
  assert.equal(laCarteAUnPlan(rouge, incident as any), true);
  assert.equal(passage(rouge, 'plan').etat, 'erreur');
});

test('une question ouverte met son point en jaune, sans point de question à part dans le flux', () => {
  const points = pointsDuParcours(CADRAGE as any, { ...base, chapitre: 'cadrage', questionsOuvertes: 1 });
  assert.equal(passage(points, 'comprehension').etat, 'question');
  assert.equal(passage(points, 'comprehension').phrase, PHRASES_DU_POINT.comprehension.question);
  const flux = fluxDuParcours(points);
  /* La question se lit UNE fois, dans le panneau « Une décision attend » : le
     flux n'en pose plus de double avec un bouton « Répondre ». Le plan jamais
     demandé n'a pas de point. */
  assert.deepEqual(
    flux.map((f) => f.sorte),
    ['point', 'point', 'point', 'point', 'point'],
  );
  assert.equal(passage(points, 'comprehension').questions.some((q: any) => !q.repondue), true);

  /* Répondue, elle rentre dans son point et n'arrête plus rien. */
  const repondue = { ...question, resultat: 'Réponse de l’utilisateur : CSV\nReprends ton travail.' };
  const apres = pointsDuParcours([demande, tourCadrage, repondue, comprehension] as any, { ...base, chapitre: 'cadrage', questionsOuvertes: 1 });
  assert.notEqual(passage(apres, 'comprehension').etat, 'question');
  assert.equal(fluxDuParcours(apres).length, fluxDuParcours(points).length);
  assert.equal(passage(apres, 'comprehension').questions[0].repondue, true);
});

test('les erreurs : un tour interrompu met le point Travail en rouge, avec le geste « reprendre »', () => {
  const journal = [...CADRAGE, ...PLAN, ...TRAVAIL, interrompu];
  const points = pointsDuParcours(journal as any, { chapitre: 'travail', colonne: 'planned', tourEnCours: false, parcours: null, questionsOuvertes: 0 });
  /* LE MESSAGE ENVOYÉ EN COURS DE ROUTE OUVRE SA « DEMANDE » : le travail qui
     le suit est donc un passage NEUF, et c'est lui qui porte l'erreur. La barre
     et l'accordéon lisent tous deux le DERNIER passage de l'étape, l'erreur
     reste donc celle qu'on voit. */
  const travail = dernierPassage(points as any, 'travail') as any;
  assert.equal(travail.etat, 'erreur');
  assert.equal(
    barreDuParcours(points as any).find((s) => s.etape === 'travail')?.etat,
    'erreur',
    'la barre montre l’erreur du dernier passage, pas l’état du premier',
  );
  assert.equal(travail.erreurs.length, 1, 'seule la dernière erreur se montre');
  assert.equal(travail.erreurs[0].texte, 'Le moteur est tombé.');
  assert.equal(travail.erreurs[0].action, 'reprendre');
  /* Une reprise qui rend son rapport efface l'erreur. */
  const repris = pointsDuParcours([...journal, rapport] as any, { chapitre: 'rapport', colonne: 'running', tourEnCours: false, parcours: null, questionsOuvertes: 0 });
  assert.equal((dernierPassage(repris as any, 'travail') as any).etat, 'fait');
  assert.equal(passage(repris, 'rapport').etat, 'fait');
  assert.deepEqual((dernierPassage(repris as any, 'travail') as any).erreurs, []);
});

test('l’incident du parcours (plan non rendu) est une erreur du point Plan, à redemander', () => {
  const points = pointsDuParcours([...CADRAGE, planDemande] as any, {
    ...base,
    chapitre: 'cadrage',
    // Un plan ne se demande qu'après une compréhension rendue sur la carte.
    parcours: {
      plans: [],
      comprehension: { texte: 'compris', at: 5, hypotheses: [], sujets: [] },
      incident: { texte: 'Le plan n’est pas venu.', at: 9 },
    },
  });
  assert.equal(passage(points, 'plan').etat, 'erreur');
  assert.equal(passage(points, 'plan').erreurs[0].action, 'redemander-plan');
});

test('la barre reflète l’état des points, et les points ouverts d’office sont l’étape courante et le plan rendu', () => {
  const PLAN_RENDU = { plans: [{ numero: 1, titre: 'P', resume: '', texte: '# P', at: 1 }] };
  const points = pointsDuParcours([...CADRAGE, ...PLAN] as any, { ...base, chapitre: 'plan', parcours: PLAN_RENDU });
  assert.deepEqual(
    barreDuParcours(points).map((s) => `${s.etape}:${s.etat}`),
    ['configuration:fait', 'demande:fait', 'comprehension:fait', 'plan:fait', 'travail:avenir', 'rapport:avenir'],
  );
  /* LE DERNIER RENDU S'OUVRE D'OFFICE : le second plan, qu'on vient lire. Et
     DEPUIS LE 26/10/2026, chaque passage terminé qui porte des actions de
     l'agent reste ouvert lui aussi (« arrête de refermer les actions »). */
  const ouverts = pointsOuvertsDOffice(points);
  assert.ok(ouverts.includes('point-plan-2'));
  for (const p of points) {
    if (p.etat === 'fait' && p.traces.length) assert.ok(ouverts.includes(p.ancre), `${p.ancre} garde ses actions à l’écran`);
    if (p.etat === 'fait' && !p.traces.length && p.ancre !== 'point-plan-2') assert.ok(!ouverts.includes(p.ancre), `${p.ancre} n’a rien à montrer`);
  }
  assert.equal(dernierPassage(points, 'plan')?.ancre, 'point-plan-2');
  assert.equal(dernierPassage(points, 'demande')?.ancre, 'point-demande-2');
  /* LE MESSAGE ENVOYÉ CARTE EN COURS (`TRAVAIL` finit par lui) ouvre sa
     « Demande », et le travail qui la suit est donc un passage NEUF : EN COURS,
     il s'ouvre d'office — ses points se lisent au fur et à mesure (capture
     #814e) ; le premier, terminé, se replie sur sa ligne. */
  const auTravail = pointsDuParcours([...CADRAGE, ...PLAN, ...TRAVAIL] as any, { chapitre: 'travail', colonne: 'running', tourEnCours: true, parcours: PLAN_RENDU, questionsOuvertes: 0 });
  assert.equal(passage(auTravail, 'travail', 2).etat, 'encours');
  assert.ok(pointsOuvertsDOffice(auTravail).includes('point-travail-2'));
  /* Le premier travail, terminé, garde ses actions à l'écran s'il en a. */
  assert.equal(pointsOuvertsDOffice(auTravail).includes('point-travail'), passage(auTravail, 'travail', 1).traces.length > 0);
  assert.equal(passage(auTravail, 'travail', 1).etat, 'fait');
  /* Les passages dépassés d'une étape sont FAITS : la version 1 du plan ne
     reste pas « en cours » derrière la version 2. */
  assert.equal(passage(points, 'plan', 1).etat, 'fait');
});

test('LA CAPTURE #814e : la compréhension EN COURS s’ouvre d’office, puis reste ouverte une fois rendue', () => {
  /* Le tour de cadrage vit, l'agent a déjà ouvert la mémoire, et rien n'est
     encore rendu : le passage tenait en une ligne, flèche à droite, et ses
     points restaient cachés derrière elle. */
  const enCours = pointsDuParcours([demande, tourCadrage, memoireCadrage] as any, { ...base, tourEnCours: true, chapitre: 'cadrage' });
  assert.equal(passage(enCours, 'comprehension').etat, 'encours');
  assert.ok(pointsOuvertsDOffice(enCours).includes('point-comprehension'));
  /* Rendue, elle devient le DERNIER RENDU : elle ne se referme pas sous les yeux. */
  const rendue = pointsDuParcours([demande, tourCadrage, memoireCadrage, comprehension] as any, { ...base, chapitre: 'cadrage' });
  assert.equal(passage(rendue, 'comprehension').etat, 'fait');
  assert.deepEqual(pointsOuvertsDOffice(rendue), ['point-comprehension']);
});

test('un tour d’affinage ouvre un point « Plan » NEUF, en bas du flux', () => {
  /* LA SITUATION DE L'IMAGE #798b : le plan v1 est rendu, l'utilisateur écrit
     une précision, l'agent repart — et c'est le point du plan DÉJÀ RENDU qui
     s'animait, plus haut dans la ligne de temps, comme s'il se réécrivait. */
  const tour2 = e({ nature: 'jalon', libelle: JALON_TOUR_LANCE, agentRole: 'cadrage' });
  const comprehension2 = e({ nature: 'jalon', libelle: JALON_COMPREHENSION, agentRole: 'cadrage', resultat: 'mieux compris' });
  const journal = [demande, tourCadrage, comprehension, planDemande, planRendu, affinage, tour2, comprehension2];
  const points = pointsDuParcours(journal as any, {
    ...base,
    chapitre: 'cadrage',
    tourEnCours: true,
    parcours: { plans: [{ numero: 1, titre: 'P', resume: '', texte: '# P', at: 1 }], planDemandeA: 9_000_000 },
  });
  assert.deepEqual(suite(points), [
    'configuration 1/1',
    'demande 1/2',
    'comprehension 1/2',
    'plan 1/2',
    'demande 2/2',
    'comprehension 2/2',
    'plan 2/2',
    'travail 1/1',
    'rapport 1/1',
  ]);
  const p1 = passage(points, 'plan', 1);
  const p2 = passage(points, 'plan', 2);
  assert.equal(p1.etat, 'fait', 'le plan déjà rendu reste calme, à sa date');
  assert.equal(p2.etat, 'encours', 'c’est un point NEUF qui tourne');
  assert.equal(p2.ancre, 'point-plan-2');
  assert.equal(p2.moments.length, 0, 'le point anticipé n’a aucune entrée de journal derrière lui');
  assert.equal(p2.at, 9_000_000, 'il porte l’horodatage du tour qui l’a ouvert');
  /* IL EST LE DERNIER DU FLUX, hors les étapes encore à venir. */
  const enCours = points.filter((p) => p.etat === 'encours');
  assert.deepEqual(enCours.map((p) => p.ancre), ['point-plan-2']);
  assert.equal(points.indexOf(p2), points.findIndex((p) => p.etape === 'travail') - 1);
  /* LE POINT ANTICIPÉ DISPARAÎT DÈS QUE LE TOUR TOMBE : rien ne reste en l'air. */
  const arrete = pointsDuParcours(journal as any, {
    ...base,
    chapitre: 'cadrage',
    tourEnCours: false,
    parcours: { plans: [{ numero: 1, titre: 'P', resume: '', texte: '# P', at: 1 }] },
  });
  assert.equal(arrete.filter((p) => p.etape === 'plan').length, 1, 'aucun point « Plan » fantôme');
  /* ET IL SE FOND DANS LE PASSAGE RÉEL dès que le plan v2 est rendu : deux
     versions, deux points, jamais trois. */
  const rendu = pointsDuParcours([...journal, planRendu2] as any, {
    ...base,
    chapitre: 'plan',
    parcours: { plans: [{ numero: 1, titre: 'P', resume: '', texte: '# P', at: 1 }, { numero: 2, titre: 'P2', resume: '', texte: '# P2', at: 2 }] },
  });
  assert.equal(rendu.filter((p) => p.etape === 'plan').length, 2);
  assert.deepEqual(
    rendu.filter((p) => p.etape === 'plan').map((p) => `${p.rang}/${p.total} ${p.etat}`),
    ['1/2 fait', '2/2 fait'],
  );
});

test('un tour de POURSUITE (reprise après limite) ne rouvre ni Demande ni Compréhension : le compteur ne bouge pas', () => {
  /* Le tour de cadrage est coupé par la limite d'un compte ; trois reprises
     s'enchaînent, chacune un tour silencieux qui reprend là où il en était.
     Sur la carte du 06.09.2026, chacune ouvrait un point de plus (6/7 → 9/9). */
  const coupe = e({ phase: 'rapport', nature: 'jalon', libelle: 'Tour interrompu', agentRole: 'cadrage', resultat: 'Fable 5.1 requires usage credits.', reussie: false });
  const reprises = [1, 2, 3].flatMap((n) => [
    e({ nature: 'jalon', libelle: JALON_TOUR_LANCE, agentRole: 'cadrage', tourId: `reprise-${n}`, donnees: '{"poursuiteDe":"coupe-1"}' }),
    // Une consigne de reprise qui aurait été écrite comme une demande (ancien
    // bogue de la file) : rattachée elle aussi, jamais un moment « Demande ».
    e({ nature: 'jalon', libelle: 'Demande', agentRole: 'cadrage', tourId: `reprise-${n}`, resultat: 'REPRISE APRÈS ÉPUISEMENT DU QUOTA.' }),
    e({ nature: 'jalon', libelle: JALON_COMPREHENSION, agentRole: 'cadrage', tourId: `reprise-${n}`, resultat: `compris ${n}` }),
    e({ phase: 'rapport', nature: 'jalon', libelle: 'Réponse rendue', agentRole: 'cadrage', tourId: `reprise-${n}`, resultat: 'Je continue.' }),
  ]);
  const sansReprise = contenuDesPoints([demande, tourCadrage, comprehension, coupe] as any);
  const avecReprises = contenuDesPoints([demande, tourCadrage, comprehension, coupe, ...reprises] as any);
  assert.deepEqual(suite(avecReprises), suite(sansReprise), 'trois reprises, zéro point de plus');
  assert.equal(avecReprises.filter((p) => p.etape === 'demande').length, 1);
  assert.equal(avecReprises.filter((p) => p.etape === 'comprehension').length, 1);
  const comp = passage(avecReprises, 'comprehension', 1);
  const dernieres = comp.moments.filter((m: any) => m.sorte === 'comprehension' && m.derniere);
  assert.equal(dernieres.length, 1, 'une seule compréhension « dernière » dans le passage');
  assert.equal(dernieres[0].entree.resultat, 'compris 3', 'et c’est celle de la dernière reprise');
  assert.ok(!avecReprises.some((p) => p.moments.some((m: any) => m.sorte === 'demande' && /REPRISE/.test(m.entree.resultat ?? ''))), 'la consigne de reprise n’est jamais un moment « Demande »');
  /* Un tour ordinaire qui suit rouvre bien un point, comme avant. */
  const suivante = e({ nature: 'jalon', libelle: JALON_COMPREHENSION, agentRole: 'cadrage', resultat: 'nouvelle compréhension' });
  const apres = contenuDesPoints([demande, tourCadrage, comprehension, coupe, ...reprises, suivante] as any);
  assert.equal(apres.filter((p) => p.etape === 'comprehension').length, 2);
});


/* ------------------------------------------------------------------ */
/* Une nouvelle demande, un nouveau point « Travail »                   */
/* ------------------------------------------------------------------ */

/* Le journal d'une première itération complète : demande, tour d'exécution,
   une commande, compte rendu rendu. C'est la carte des captures du 12.09.2026. */
const ITERATION_1 = [demande, tourExecution, commande, rapport];
const demande2 = e({ phase: 'execution', nature: 'jalon', libelle: 'Demande', agentRole: 'tache', resultat: 'Change la couleur' });
const tourExecution2 = e({ phase: 'execution', nature: 'jalon', libelle: JALON_TOUR_LANCE, agentRole: 'tache' });
const commande2 = e({ phase: 'execution', outil: 'Bash', libelle: 'Commande', agentRole: 'tache', params: '{"command":"npm run build"}' });
const rapport2 = e({ phase: 'rapport', nature: 'jalon', libelle: 'Réponse rendue', agentRole: 'tache', resultat: '## 1. Analyse\nrefait' });
const enTravail = { ...base, colonne: 'running', chapitre: 'travail', tourEnCours: true } as const;

test('une nouvelle demande après un compte rendu ouvre un point « Travail » NEUF, en bas du flux', () => {
  /* LE DÉFAUT : le premier point « Travail », à sa date d'origine, se remettait
     à tourner — le travail de la deuxième demande avait l'air de réécrire celui
     de la première, plus haut dans la ligne de temps. */
  const points = pointsDuParcours([...ITERATION_1, demande2] as any, enTravail);
  assert.deepEqual(suite(points), [
    'configuration 1/1',
    'demande 1/2',
    'comprehension 1/1',
    'travail 1/2',
    'rapport 1/2',
    'demande 2/2',
    'travail 2/2',
    'rapport 2/2',
  ]);
  assert.equal(passage(points, 'travail', 1).etat, 'fait', 'le premier travail reste calme, à sa date');
  assert.equal(passage(points, 'travail', 1).at, commande.at);
  const neuf = passage(points, 'travail', 2);
  assert.equal(neuf.etat, 'encours', 'c’est le point NEUF qui tourne');
  assert.equal(neuf.ancre, 'point-travail-2');
  assert.ok((neuf.at ?? 0) >= demande2.at, 'daté de son propre départ, pas de celui d’hier');
  /* UN SEUL POINT EN COURS, et c'est le dernier du flux. */
  assert.deepEqual(points.filter((p) => p.etat === 'encours').map((p) => p.ancre), ['point-travail-2']);
  /* LA SUITE S'ANNONCE SOUS LA NOUVELLE DEMANDE : le bloc se lit en entier. */
  assert.equal(passage(points, 'rapport', 1).etat, 'fait', 'le premier compte rendu reste rendu');
  assert.equal(passage(points, 'rapport', 2).etat, 'avenir');
  assert.equal(passage(points, 'rapport', 2).moments.length, 0);
  /* LA BARRE, ELLE, NE COMPTE PAS LES ITÉRATIONS : cinq segments ici, la carte
     n'ayant jamais eu de plan — jamais deux « Travail ». */
  assert.equal(barreDuParcours(points).length, 5);
  assert.equal(barreDuParcours(points).find((s) => s.etape === 'travail')?.etat, 'encours');
});

test('le deuxième travail rendu se fond dans son propre point : deux itérations, deux blocs', () => {
  const points = pointsDuParcours([...ITERATION_1, demande2, tourExecution2, commande2, rapport2] as any, {
    ...base,
    colonne: 'running',
    chapitre: 'rapport',
  });
  assert.deepEqual(suite(points), [
    'configuration 1/1',
    'demande 1/2',
    'comprehension 1/1',
    'travail 1/2',
    'rapport 1/2',
    'demande 2/2',
    'travail 2/2',
    'rapport 2/2',
  ]);
  assert.deepEqual(
    points.filter((p) => p.etape === 'travail' || p.etape === 'rapport').map((p) => `${p.etape} ${p.rang} ${p.etat}`),
    ['travail 1 fait', 'rapport 1 fait', 'travail 2 fait', 'rapport 2 fait'],
  );
  /* Chaque compte rendu se lit dans SON point, jamais deux dans le même. */
  assert.equal(passage(points, 'rapport', 1).moments.filter((m: any) => m.sorte === 'rapport').length, 1);
  assert.equal(passage(points, 'rapport', 2).moments.filter((m: any) => m.sorte === 'rapport').length, 1);
  assert.equal(passage(points, 'rapport', 2).moments[0].entree.id, rapport2.id);
});

test('un message mis en FILE pendant que le tour travaille ouvre lui aussi son point', () => {
  /* Le cas exact des captures : l'agent travaille encore, l'utilisateur envoie
     une demande, elle part en file — et le travail qui suit ne doit pas revenir
     s'écrire dans le point du travail d'avant. */
  const points = pointsDuParcours([demande, tourExecution, commande, demande2] as any, enTravail);
  assert.deepEqual(suite(points), [
    'configuration 1/1',
    'demande 1/2',
    'comprehension 1/1',
    'travail 1/2',
    'demande 2/2',
    'travail 2/2',
    'rapport 1/1',
  ]);
  assert.equal(passage(points, 'travail', 1).etat, 'fait');
  assert.equal(passage(points, 'travail', 2).etat, 'encours');
  assert.equal(passage(points, 'rapport', 1).etat, 'avenir');
  /* Le point qui TRAVAILLE s'ouvre d'office ; le vieux, terminé, garde ses actions à l'écran (26/10/2026). */
  assert.ok(pointsOuvertsDOffice(points).includes('point-travail-2'));
  assert.equal(pointsOuvertsDOffice(points).includes('point-travail'), passage(points, 'travail', 1).traces.length > 0);
  assert.equal(dernierPassage(points, 'travail')?.rang, 2);
});

test('une demande qui attend son moteur annonce déjà son travail et son compte rendu', () => {
  /* Aucun tour ne vit encore (la demande est en file, faute de quota) : le flux
     ne s'arrête plus sur la demande, il dit ce qui va suivre. Et il ne coche
     RIEN : un point annoncé ne dira jamais « Le travail est fait. ». */
  const points = pointsDuParcours([...ITERATION_1, demande2] as any, { ...base, colonne: 'running', chapitre: 'rapport' });
  assert.deepEqual(suite(points).slice(-3), ['demande 2/2', 'travail 2/2', 'rapport 2/2']);
  assert.equal(passage(points, 'travail', 2).etat, 'avenir');
  assert.equal(passage(points, 'travail', 2).phrase, PHRASES_DU_POINT.travail.avenir);
  assert.equal(passage(points, 'rapport', 2).etat, 'avenir');
  /* Rien ne tourne : aucun point ne prétend le contraire. */
  assert.equal(points.filter((p) => p.etat === 'encours').length, 0);
  /* LA BARRE VISE LE PASSAGE QUI RACONTE, pas le point annoncé. */
  assert.equal(dernierPassage(points, 'travail')?.rang, 1, 'un point qui ne fait qu’annoncer n’est pas la cible');
  assert.ok(pointsOuvertsDOffice(points).includes('point-rapport'));
});

test('une simple question sur une carte « À déployer » garde « Travail » ouvert jusqu’à « Terminer la tâche »', () => {
  /* Capture #1077 : la carte, rendue au lot après une question, gardait sous la
     demande un Travail et un Rapport annoncés — et la barre du haut un
     « Travail » jamais coché. */
  const ctx = (parcours: Record<string, unknown>) =>
    ({ ...base, colonne: 'to_deploy', chapitre: 'rapport', parcours }) as any;
  const ouverte = pointsDuParcours([...ITERATION_1, demande2] as any, ctx({ plans: [], iterationOuverteA: 5 }));
  assert.deepEqual(suite(ouverte).slice(-3), ['demande 2/2', 'travail 2/2', 'rapport 2/2']);
  const carteOuverte = { colonne: 'to_deploy', parcours: { iterationOuverteA: 5 } };
  assert.equal(barreDeSuivi(ouverte, carteOuverte)[2].etat, 'avenir', 'l’étape attend son « Terminer la tâche »');
  assert.equal(segmentActifDeSuivi(carteOuverte), 'travail');

  /* Le clic efface le repère : plus rien d'annoncé, « Travail » coché. Une
     carte d'avant, sans repère, se lit de même. */
  const fermee = pointsDuParcours([...ITERATION_1, demande2] as any, ctx({ plans: [] }));
  assert.equal(fermee.filter((p) => p.annonce).length, 0);
  assert.equal(barreDeSuivi(fermee, { colonne: 'to_deploy', parcours: {} })[2].etat, 'fait');
  assert.equal(segmentActifDeSuivi({ colonne: 'to_deploy', parcours: {} }), 'a_deployer');

  /* Une RELANCE encore en cadrage dans « À déployer » annonce toujours sa suite. */
  const relancee = pointsDuParcours([...ITERATION_1, demande2] as any, ctx({ plans: [], cadrageRouvertA: 5 }));
  assert.ok(relancee.some((p) => p.annonce));
});

test('une REPRISE après limite de compte rejoint son travail d’origine — sauf si une demande s’est glissée entre-temps', () => {
  /* LE JOURNAL SE LIT DANS L'ORDRE DES RANGS (`ordonnerJournal`), pas des
     dates : ce scénario les écrit donc à la main, pour que la coupure tombe
     bien AVANT la nouvelle demande et la reprise après. */
  const r = (n: number, partiel: Record<string, unknown>) => e({ ...partiel, rang: 9000 + n, at: 900_000 + n });
  const d1 = r(1, { phase: 'execution', nature: 'jalon', libelle: 'Demande', agentRole: 'tache', resultat: 'Fais A' });
  const t1 = r(2, { phase: 'execution', nature: 'jalon', libelle: JALON_TOUR_LANCE, agentRole: 'tache' });
  const c1 = r(3, { phase: 'execution', outil: 'Bash', libelle: 'Commande', agentRole: 'tache', params: '{"command":"npm test"}' });
  const coupe = r(4, { phase: 'rapport', nature: 'jalon', libelle: 'Tour interrompu', agentRole: 'tache', resultat: 'Fable 5.1 requires usage credits.', reussie: false });
  const d2 = r(5, { phase: 'execution', nature: 'jalon', libelle: 'Demande', agentRole: 'tache', resultat: 'Fais B' });
  const reprise = r(6, { phase: 'execution', nature: 'jalon', libelle: JALON_TOUR_LANCE, agentRole: 'tache', tourId: 'reprise-t', donnees: '{"poursuiteDe":"coupe-t"}' });
  const commandeReprise = r(7, { phase: 'execution', outil: 'Bash', libelle: 'Commande', agentRole: 'tache', tourId: 'reprise-t', params: '{"command":"npm run build"}' });
  /* SANS demande intercalée : c'est le MÊME travail qui continue, pas une
     itération de plus. Trois reprises enchaînées faisaient trois points de trop. */
  const sansDemande = contenuDesPoints([d1, t1, c1, coupe, reprise, commandeReprise] as any);
  assert.equal(sansDemande.filter((p) => p.etape === 'travail').length, 1, 'la reprise ne fabrique aucun point de plus');
  assert.ok(sansDemande.find((p) => p.etape === 'travail')?.traces.some((t: any) => t.id === commandeReprise.id));
  /* AVEC une demande intercalée : la poursuite n'a plus le droit de renvoyer le
     travail dans le passage d'avant, à sa date d'origine. */
  const avecDemande = contenuDesPoints([d1, t1, c1, coupe, d2, reprise, commandeReprise] as any);
  assert.equal(avecDemande.filter((p) => p.etape === 'travail').length, 2, 'la nouvelle demande borne la poursuite');
  const second = avecDemande.filter((p) => p.etape === 'travail')[1];
  assert.ok(second.traces.some((t: any) => t.id === commandeReprise.id));
  assert.ok((second.debut ?? 0) >= d2.at, 'et il est daté d’après la demande qui l’a ouvert');
});

test('une compréhension qui recommence ouvre elle aussi son point, en bas du flux', () => {
  const affine = e({ nature: 'jalon', libelle: 'Demande', agentRole: 'cadrage', resultat: 'Précision' });
  const points = pointsDuParcours([demande, tourCadrage, comprehension, affine] as any, {
    ...base,
    chapitre: 'cadrage',
    tourEnCours: true,
    parcours: { comprehension: { texte: 'compris', at: 1, hypotheses: [], sujets: [] }, plans: [] },
  });
  assert.deepEqual(suite(points), ['configuration 1/1', 'demande 1/2', 'comprehension 1/2', 'demande 2/2', 'comprehension 2/2', 'travail 1/1', 'rapport 1/1']);
  assert.equal(passage(points, 'comprehension', 1).etat, 'fait');
  assert.equal(passage(points, 'comprehension', 2).etat, 'encours');
});

test('l’attente se dit sous le point « Demande » : quota, file, envoi, préparation', () => {
  /* UNE BULLE DÉJÀ ÉCRITE QUI RETOMBE EN FILE, C'EST LE MANQUE DE QUOTA. */
  assert.deepEqual(
    attenteDeLaDemande({ file: [{ position: 2, messageId: 'm1' }], tourEnCours: false }),
    { sorte: 'quota', position: 2 },
  );
  /* Une demande empilée derrière un agent occupé : ce n'est pas le quota. */
  assert.deepEqual(attenteDeLaDemande({ file: [{ position: 1 }], tourEnCours: true }), { sorte: 'file', position: 1 });
  /* L'écho local du clic, avant même que le serveur ait répondu. */
  assert.deepEqual(attenteDeLaDemande({ envoiLocal: true, tourEnCours: false }), { sorte: 'envoi' });
  /* Le tour est vivant mais pas encore lancé : le démon prépare. */
  assert.deepEqual(attenteDeLaDemande({ tourEnCours: true, tourLance: false }), { sorte: 'preparation' });
  /* Le tour est lancé : le parcours raconte, l'attente se tait. */
  assert.equal(attenteDeLaDemande({ tourEnCours: true, tourLance: true }), undefined);
  assert.equal(attenteDeLaDemande({}), undefined);
  /* UNE PRÉPARATION QUI DURE N'EN EST PLUS UNE : passé le plafond, l'écran se
     tait plutôt que d'afficher « Préparation du tour… » sous un chronomètre à
     54 minutes. */
  assert.deepEqual(attenteDeLaDemande({ tourEnCours: true, tourLance: false, depuisMs: 5_000 }), { sorte: 'preparation' });
  assert.equal(attenteDeLaDemande({ tourEnCours: true, tourLance: false, depuisMs: PREPARATION_MAX_MS + 1 }), undefined);
  /* Chaque sorte a sa phrase, et le tour lancé se lit sur le journal. */
  for (const sorte of ['quota', 'file', 'envoi', 'preparation'] as const) {
    assert.ok(PHRASES_DE_L_ATTENTE[sorte].length > 10);
  }
  assert.equal(tourLanceApresLaDemande([demande, tourCadrage] as any), true);
  assert.equal(tourLanceApresLaDemande([demande, tourCadrage, affinage] as any), false, 'une demande neuve remet le compteur à zéro');
});

test('un recadrage après exécution repart de la compréhension', () => {
  const recadrage = e({ phase: 'recadrage', nature: 'jalon', libelle: 'Demande', agentRole: 'cadrage', resultat: 'Refais autrement' });
  const relecture = e({ phase: 'recadrage', outil: 'Read', libelle: 'Lecture', agentRole: 'cadrage' });
  const points = contenuDesPoints([...TOUT, recadrage, relecture] as any);
  const demandes = points.filter((p) => p.etape === 'demande');
  assert.equal(demandes.length, 4, 'chaque demande ouvre SON passage, elle ne s’empile pas sur la première');
  assert.equal(demandes[3].ancre, 'point-demande-4');
  const comprehensions = points.filter((p) => p.etape === 'comprehension');
  assert.ok(comprehensions[comprehensions.length - 1].traces.some((t: any) => t.id === relecture.id));
});

/* ------------------------------------------------------------------ */
/* Le carnet de mémoire, en règle pure                                  */
/* ------------------------------------------------------------------ */

test('une lecture du relevé vivant devient une ligne du carnet, par identifiant et titre', () => {
  const unite = ligneDUneLecture({ agentId: 'a', cle: 'DEC-078', cardId: 'c', at: 5, enContexte: true, etape: 'plan', titre: 'Le fil en cinq points' });
  assert.equal(unite.id, 'lecture:a:DEC-078', 'identifiant STABLE : une unité rouverte remplace sa ligne');
  assert.equal(unite.etape, 'plan');
  assert.equal(unite.portee, 'projet');
  assert.equal(nomDeLaLigne(unite), 'Le fil en cinq points (DEC-078)');
  assert.equal(nomDeLaLigne(ligneDUneLecture({ agentId: 'a', cle: 'MEM-0001', cardId: 'c', at: 1, enContexte: true })), 'MEM-0001', 'une unité introuvable garde son identifiant');
  assert.equal(ligneDUneLecture({ agentId: 'a', cle: 'MEM-0001', cardId: 'c', at: 1, enContexte: true, globale: true }).portee, 'global');

  const fiche = ligneDUneLecture({ agentId: 'a', cle: 'fiche:global:06_lessons', cardId: 'c', at: 1, enContexte: false });
  assert.equal(nomDeLaLigne(fiche), 'Fiche 06_lessons');
  assert.equal(fiche.portee, 'global');
  assert.equal(fiche.enContexte, false);
  assert.equal(ligneDUneLecture({ agentId: 'a', cle: 'fiche:p1:05_decisions', cardId: 'c', at: 1, enContexte: true }).portee, 'projet');
  assert.equal(nomDeLaLigne(ligneDUneLecture({ agentId: 'a', cle: 'changelog:p1', cardId: 'c', at: 1, enContexte: true })), 'Changelog');

  /* SANS ÉTAPE NOTÉE (lectures du 13 au 19.09.2026), le rôle de l'agent tranche. */
  assert.equal(ligneDUneLecture({ agentId: 'a', cle: 'MEM-0001', cardId: 'c', at: 1, enContexte: true, etape: null, roleAgent: 'cadrage' }).etape, 'comprehension');
  assert.equal(ligneDUneLecture({ agentId: 'a', cle: 'MEM-0001', cardId: 'c', at: 1, enContexte: true, roleAgent: 'task' }).etape, 'travail');
  assert.equal(ligneDUneLecture({ agentId: 'a', cle: 'MEM-0001', cardId: 'c', at: 1, enContexte: true, etape: 'nimporte' }).etape, 'travail');

  /* LES LIGNES DE L'ANCIEN ARBRE RESTENT LISIBLES. */
  assert.equal(nomDeLaLigne({ sujet: 'interface', branche: 'parcours', genre: 'branche' }), 'Interface › Parcours');
  assert.equal(nomDeLaLigne({ sujet: 'cartes', genre: 'faits' }), 'Cartes');

  /* Et le fil range la lecture sous le point de son étape. */
  const points = contenuDesPoints([], [unite, fiche] as any);
  assert.deepEqual(passage(points, 'plan').memoire.map(nomDeLaLigne), ['Le fil en cinq points (DEC-078)']);
  assert.deepEqual(passage(points, 'travail').memoire.map(nomDeLaLigne), ['Fiche 06_lessons']);
});

test('l’étape où la mémoire est servie se lit sur l’agent et la carte', () => {
  assert.equal(etapeDeLaMemoire({ roleAgent: 'cadrage', parcours: { plans: [] } }), 'comprehension');
  assert.equal(etapeDeLaMemoire({ roleAgent: 'cadrage', parcours: { plans: [], planDemandeA: 1 } }), 'plan');
  /* UN PLAN DÉJÀ RENDU NE CLASSE PLUS LA MÉMOIRE SOUS « PLAN » : le tour
     suivant est une compréhension ordinaire tant que le plan n'est pas
     redemandé. */
  assert.equal(
    etapeDeLaMemoire({ roleAgent: 'cadrage', parcours: { plans: [{ numero: 1, titre: '', resume: '', texte: '', at: 1 }] } }),
    'comprehension',
  );
  assert.equal(
    etapeDeLaMemoire({
      roleAgent: 'cadrage',
      parcours: { plans: [{ numero: 1, titre: '', resume: '', texte: '', at: 1 }], planDemandeA: 2 },
    }),
    'plan',
  );
  assert.equal(etapeDeLaMemoire({ roleAgent: 'cadrage', accueil: true }), 'demande');
  assert.equal(etapeDeLaMemoire({ roleAgent: 'tache' }), 'travail');
  assert.equal(etapeDeLaMemoire({ roleAgent: 'tache', accueil: true }), 'travail');
});

test('le récit d’une étape ne redit pas deux fois le même morceau, et garde ce qui est sorti du contexte', () => {
  const ligne = (partiel: Record<string, unknown>) => ({
    id: String(Math.random()),
    cardId: 'c',
    agentId: 'a',
    etape: 'comprehension',
    cle: 'faits:cartes:1',
    genre: 'faits',
    sujet: 'cartes',
    portee: 'projet',
    poids: 100,
    at: 1,
    enContexte: true,
    ...partiel,
  });
  const carnet = [
    ligne({ at: 1 }),
    ligne({ at: 2, cle: 'faits:cartes:2' }),
    ligne({ at: 3, cle: 'branche:interface/parcours:1', sujet: 'interface', branche: 'parcours', genre: 'branche' }),
    ligne({ at: 4, etape: 'travail', cle: 'regles:cartes:1', genre: 'regles', agentId: 'b' }),
    ligne({ at: 5, etape: 'travail', cle: 'regles:quotas:1', genre: 'regles', sujet: 'quotas', agentId: 'b', enContexte: false }),
  ];
  assert.deepEqual(lignesDeLEtape(carnet as any, 'comprehension').map(nomDeLaLigne), ['Cartes', 'Interface › Parcours']);
  const points = contenuDesPoints([], carnet as any);
  assert.equal(passage(points, 'comprehension').memoire.length, 2);
  assert.equal(passage(points, 'travail').memoire.length, 2, 'le récit garde ce qui est sorti du contexte');
});

test('la mémoire va au PASSAGE qui l’a consommée, pas à tous ceux de son étape', () => {
  const seconde = { ...comprehension, id: 'c2', rang: 99, at: 5000, resultat: 'mieux compris' };
  const ligne = (at: number, cle: string, sujet: string) => ({
    id: cle, cardId: 'c', agentId: 'a', etape: 'comprehension', cle, genre: 'faits',
    sujet, portee: 'projet', poids: 10, at, enContexte: true,
  });
  /* Le premier passage de compréhension court autour de 1000 ; le second à 5000. */
  const carnet = [ligne(1002, 'faits:cartes:1', 'cartes'), ligne(5001, 'faits:quotas:1', 'quotas')];
  const points = contenuDesPoints([...CADRAGE, seconde] as any, carnet as any);
  const c = points.filter((p) => p.etape === 'comprehension');
  assert.equal(c.length, 2);
  assert.deepEqual(c[0].memoire.map((l: any) => l.cle), ['faits:cartes:1']);
  assert.deepEqual(c[1].memoire.map((l: any) => l.cle), ['faits:quotas:1']);
});

/* ------------------------------------------------------------------ */
/* DEUX ÉTAPES NE PEUVENT PAS ÊTRE « EN COURS » ENSEMBLE                */
/* ------------------------------------------------------------------ */

test('UNE CARTE ROUVERTE EN PLEIN TRAVAIL N’A QU’UNE SEULE ÉTAPE EN COURS', () => {
  /* Le journal n’est pas encore arrivé — c’est exactement la seconde qui suit
     la réouverture d’une carte : le point « Demande » ne trouve aucun jalon
     écrit, et le chapitre dit « travail ». Les deux tournaient ensemble. */
  const points = pointsDuParcours([], {
    chapitre: 'travail',
    colonne: 'running',
    tourEnCours: true,
    parcours: null,
    questionsOuvertes: 0,
  });
  const enCours = points.filter((point) => point.etat === 'encours');
  assert.equal(enCours.length, 1, enCours.map((p) => p.etape).join(', '));
  assert.equal(enCours[0].etape, 'travail');
  /* Et la « Demande » ne reste jamais à faire quand le travail tourne. */
  const demande = points.find((point) => point.etape === 'demande');
  assert.equal(demande?.etat, 'fait');

  /* La barre en dit autant : un seul segment « en cours ». */
  assert.equal(barreDuParcours(points).filter((s) => s.etat === 'encours').length, 1);
});

const UN_PLAN = { plans: [{ numero: 1, titre: 'P', resume: '', texte: '# P', at: 1 }] };

test('l’invariant tient aussi sur un journal complet, à chaque chapitre', () => {
  const contextes = [
    { chapitre: 'cadrage' as const, colonne: 'planned' as const, tourEnCours: true, parcours: null },
    { chapitre: 'plan' as const, colonne: 'planned' as const, tourEnCours: true, parcours: { plans: [], planDemandeA: 1 } },
    { chapitre: 'travail' as const, colonne: 'running' as const, tourEnCours: true, parcours: UN_PLAN },
    { chapitre: 'rapport' as const, colonne: 'running' as const, tourEnCours: true, parcours: UN_PLAN },
  ];
  for (const ctx of contextes) {
    const points = pointsDuParcours([...CADRAGE, ...PLAN] as any, { ...ctx, questionsOuvertes: 0 } as any);
    const enCours = points.filter((point) => point.etat === 'encours');
    assert.ok(enCours.length <= 1, `${ctx.chapitre} : ${enCours.map((p) => p.etape).join(', ')}`);
  }
});

/* LE MOMENT « PRÉPARATION » : NI TRAVAIL FAIT, NI RAPPORT RENDU        */
/* ------------------------------------------------------------------ */

/*
 * Le mensonge de la capture du 06.09.2026 : entre le clic et le premier mot du
 * moteur, la ligne de temps cochait « Le travail est fait » puis « Le compte
 * rendu est rendu ». Elle doit désormais montrer une PRÉPARATION qui tourne, et
 * laisser les deux points suivants gris.
 */

const EN_PREPARATION = {
  chapitre: 'preparation' as const,
  colonne: 'running' as const,
  tourEnCours: false,
  parcours: null,
  questionsOuvertes: 0,
  tourEnVolDepuis: 7_000,
};

test('pendant la préparation, « Travail » et « Rapport » restent à VENIR', () => {
  const points = pointsDuParcours(TOUT as any, EN_PREPARATION);
  const preparation = passage(points, 'preparation');
  assert.ok(preparation, 'le moment « Préparation » existe dès le clic');
  assert.equal(preparation.etat, 'encours');
  assert.equal(preparation.at, 7_000, 'il est daté du clic, sans dépendre d’aucun signal diffusé');

  const travail = points.filter((p: any) => p.etape === 'travail').pop()!;
  const rapport = points.filter((p: any) => p.etape === 'rapport').pop()!;
  assert.equal(travail.etat, 'avenir');
  assert.equal(rapport.etat, 'avenir');
  assert.notEqual(travail.phrase, PHRASES_DU_POINT.travail.fait);
  assert.notEqual(rapport.phrase, PHRASES_DU_POINT.rapport.fait);
});

test('…et le moment « Préparation » dit l’étape franchie quand le signal est arrivé', () => {
  const avec = pointsDuParcours(TOUT as any, { ...EN_PREPARATION, lancement: 'dossier' });
  assert.equal(passage(avec, 'preparation').phrase, 'Création du dossier de travail…');
  /* Sans signal — page ouverte en cours de route — la phrase générale suffit. */
  assert.equal(passage(pointsDuParcours(TOUT as any, EN_PREPARATION), 'preparation').phrase, PHRASES_DU_POINT.preparation.encours);
  assert.equal(phraseDeLaPreparation(undefined), PHRASES_DU_POINT.preparation.encours);
});

/*
 * LA SCÈNE EXACTE DE LA CAPTURE (07.09.2026) : une carte cadrée — deux
 * compréhensions, deux plans rendus AVANT le clic — que l'utilisateur vient de
 * lancer. Le chapitre n'est pas donné à la main : il est CALCULÉ sur le fil,
 * comme l'écran le fait (`chapitreDuParcours`). Avant le correctif, les
 * réponses du cadrage refermaient la préparation, et la ligne de temps cochait
 * « Le travail est fait » puis « Le compte rendu est rendu ».
 */
test('une carte lancée APRÈS un cadrage montre sa préparation, pas un travail fait', () => {
  const filDeLaCarte = [
    { role: 'user', content: 'Voilà ce que je veux', at: 100 },
    { role: 'assistant', content: 'Voici ce que j’ai compris…', at: 200 },
    { role: 'user', content: 'Oui, et aussi ceci', at: 300 },
    { role: 'assistant', content: '# Le plan\n…', at: 400 },
  ];
  const chapitre = chapitreDuParcours({
    colonne: 'running',
    roleAgent: 'task',
    tourEnCours: false,
    messages: filDeLaCarte,
    tourEnVolDepuis: 5_000,
  });
  assert.equal(chapitre, 'preparation');

  const points = pointsDuParcours([...CADRAGE, ...PLAN] as any, {
    chapitre,
    colonne: 'running',
    tourEnCours: false,
    parcours: { plans: [{ numero: 1, titre: 'P', resume: '', texte: '# P', at: 1 }] },
    questionsOuvertes: 0,
    tourEnVolDepuis: 5_000,
    lancement: 'dossier',
  });

  const preparation = passage(points, 'preparation');
  assert.ok(preparation, 'le point « Préparation » se pose sous le plan');
  assert.equal(preparation.etat, 'encours');
  assert.equal(preparation.phrase, 'Création du dossier de travail…');
  /* Il se pose APRÈS le plan et AVANT les points encore vides. */
  const rangs = points.map((p: any) => p.etape);
  assert.ok(rangs.indexOf('preparation') > rangs.lastIndexOf('plan'));
  assert.ok(rangs.indexOf('preparation') < rangs.indexOf('travail'));

  const travail = points.filter((p: any) => p.etape === 'travail').pop()!;
  const rapport = points.filter((p: any) => p.etape === 'rapport').pop()!;
  assert.equal(travail.etat, 'avenir');
  assert.equal(rapport.etat, 'avenir');
  assert.equal(travail.phrase, PHRASES_DU_POINT.travail.avenir);
  assert.equal(rapport.phrase, PHRASES_DU_POINT.rapport.avenir);
});

test('…et dès que l’agent lancé parle, la carte repasse au rapport', () => {
  const chapitre = chapitreDuParcours({
    colonne: 'running',
    roleAgent: 'task',
    tourEnCours: false,
    messages: [
      { role: 'assistant', content: '# Le plan\n…', at: 400 },
      { role: 'assistant', content: 'Travail terminé.', at: 9_000 },
    ],
    tourEnVolDepuis: 5_000,
  });
  assert.equal(chapitre, 'rapport');
  const points = pointsDuParcours(TOUT as any, {
    chapitre,
    colonne: 'running',
    tourEnCours: false,
    parcours: { plans: [{ numero: 1, titre: 'P', resume: '', texte: '# P', at: 1 }] },
    questionsOuvertes: 0,
    tourEnVolDepuis: 5_000,
  });
  assert.equal(points.filter((p: any) => p.etape === 'preparation').length, 0);
});

test('…et sur une carte SANS journal, la préparation ne remonte pas en tête du flux', () => {
  /* Journal vide — carte du chef, journal purgé : tous les passages sont
     vides, et le point de préparation se posait AVANT la configuration. */
  const points = pointsDuParcours([], {
    chapitre: 'preparation',
    colonne: 'running',
    tourEnCours: false,
    parcours: null,
    questionsOuvertes: 0,
    tourEnVolDepuis: 5_000,
  });
  const ordre = points.map((p: any) => p.etape);
  /* Aucun plan n'a jamais été demandé sur cette carte : son point n'existe pas. */
  assert.deepEqual(ordre, ['configuration', 'demande', 'comprehension', 'preparation', 'travail', 'rapport']);
});

test('une carte qui n’est PAS en préparation ne porte aucun point « Préparation »', () => {
  const points = pointsDuParcours(TOUT as any, { ...base, chapitre: 'rapport', colonne: 'to_deploy' });
  assert.equal(points.filter((p: any) => p.etape === 'preparation').length, 0);
  /* Et une carte qui n’a jamais été lancée non plus : le point n’annonce rien. */
  assert.equal(contenuDesPoints([], []).filter((p: any) => p.etape === 'preparation').length, 0);
});

test('la barre garde ses SIX segments, la préparation n’en prend pas un septième', () => {
  const segments = barreDuParcours(pointsDuParcours(TOUT as any, EN_PREPARATION));
  assert.equal(segments.length, 6);
  assert.deepEqual(
    segments.map((s: any) => s.etape),
    ['configuration', 'demande', 'comprehension', 'plan', 'travail', 'rapport'],
  );
});


test('après un plan rendu, le tour suivant est une COMPRÉHENSION : le plan reste fait, il ne se refait pas tout seul', () => {
  /* LA RÈGLE NEUVE : plus aucune consigne d'affinage ne part toute seule. Un
     message envoyé après un plan rendu ouvre une nouvelle compréhension, et
     c'est elle qui tourne — le plan déjà rendu reste calme, à sa date. */
  const PLANS = { plans: [{ numero: 1, titre: 'P', resume: '', texte: '# P', at: 1 }] };
  const precision = e({ nature: 'jalon', libelle: 'Demande', agentRole: 'cadrage', resultat: 'En fait, ajoute le PDF' });
  const tour2 = e({ nature: 'jalon', libelle: JALON_TOUR_LANCE, agentRole: 'cadrage' });
  const journal = [demande, tourCadrage, comprehension, planDemande, planRendu, precision, tour2];
  const points = pointsDuParcours(journal as any, {
    ...base,
    chapitre: 'plan',
    tourEnCours: true,
    parcours: PLANS,
  });
  assert.equal(passage(points, 'plan').etat, 'fait', 'le plan rendu n’est ni « en cours » ni « à venir »');
  assert.equal(passage(points, 'comprehension', 2).etat, 'encours', 'c’est la nouvelle compréhension qui tourne');

  /* Et le journal purgé ne perd pas la règle : les dates de la carte suffisent. */
  const sansJournal = pointsDuParcours([] as any, {
    ...base,
    chapitre: 'plan',
    tourEnCours: true,
    parcours: { ...PLANS, comprehension: { texte: 'Compris, suite.', hypotheses: [], sujets: [], at: 9 } },
  });
  assert.equal(
    sansJournal.find((point) => point.etat === 'encours')?.etape,
    'comprehension',
    'la compréhension datée après le plan porte l’étape courante',
  );

  /* LE PLAN REDEMANDÉ REPREND LA MAIN : le drapeau de la carte prime. */
  const redemande = pointsDuParcours([...journal, planDemande] as any, {
    ...base,
    chapitre: 'plan',
    tourEnCours: true,
    parcours: { ...PLANS, planDemandeA: 9_000_000 },
  });
  assert.equal(dernierPassage(redemande, 'plan')?.etat, 'encours');
});

/* ------------------------------------------------------------------ */
/* UN TOUR QUI NE S'EST PAS RENDU JUSQU'AU BOUT NE COCHE RIEN           */
/* ------------------------------------------------------------------ */

/*
 * LE MENSONGE QU'ON RÉPARE : une carte restée dans « En cours », son tour
 * terminé, affichait « Le travail est fait. » puis « Le compte rendu est
 * rendu. » — au-dessus d'une liste de tâches qui disait, elle, que deux lignes
 * n'avaient jamais été faites. Le parcours se déduisait de la seule colonne.
 */

const AU_RAPPORT = { chapitre: 'rapport', colonne: 'running', tourEnCours: false, parcours: null, questionsOuvertes: 0 } as const;

test('un tour non abouti met le point « Travail » en erreur, et le dit', () => {
  const points = pointsDuParcours(TOUT as any, { ...AU_RAPPORT, tourNonAbouti: true });
  const travail = points.filter((p: any) => p.etape === 'travail').pop()!;
  assert.equal(travail.etat, 'erreur');
  assert.notEqual(travail.phrase, PHRASES_DU_POINT.travail.fait);
  const erreur = travail.erreurs[travail.erreurs.length - 1];
  assert.equal(erreur.texte, TEXTE_TRAVAIL_NON_ABOUTI);
  assert.equal(erreur.action, 'reprendre', 'le geste qui débloque se lit DANS le point');
});

test('…mais un compte rendu réellement rendu reste rendu', () => {
  // Une phrase de carte ne dit jamais le contraire de ce qui s'est passé :
  // le rapport a été écrit, il ne repasse pas en rouge.
  const points = pointsDuParcours(TOUT as any, { ...AU_RAPPORT, tourNonAbouti: true });
  const rapport = points.filter((p: any) => p.etape === 'rapport').pop()!;
  assert.equal(rapport.etat, 'fait');
});

test('…et sans compte rendu du tout, le point « Rapport » passe en erreur lui aussi', () => {
  const sansRapport = [...CADRAGE, ...PLAN, ...TRAVAIL];
  const points = pointsDuParcours(sansRapport as any, { ...AU_RAPPORT, tourNonAbouti: true });
  const rapport = points.filter((p: any) => p.etape === 'rapport').pop()!;
  assert.equal(rapport.etat, 'erreur');
});

/* UNE SUSPENSION À LA MAIN N'EST NI UNE PANNE NI UN RAPPORT (14/10/2026). */
test('une carte SUSPENDUE garde un point « Travail » neutre, sans erreur ni « Rapport »', () => {
  const suspension = e({ phase: 'execution', nature: 'jalon', libelle: JALON_TOUR_SUSPENDU, agentRole: 'tache', resultat: TEXTE_TOUR_SUSPENDU });
  const journal = [...CADRAGE, ...PLAN, tourExecution, commande, suspension];
  /* Le chapitre d'une carte en pause est le travail (`chapitreDuParcours`). */
  const points = pointsDuParcours(journal as any, { ...AU_RAPPORT, chapitre: 'travail', enPause: true });
  const travail = points.filter((p: any) => p.etape === 'travail').pop()!;
  assert.notEqual(travail.etat, 'erreur');
  assert.notEqual(travail.etat, 'encours', 'aucun « L’agent travaille… » sur un agent suspendu');
  assert.equal(travail.phrase, PHRASE_TRAVAIL_SUSPENDU);
  assert.deepEqual(travail.erreurs, []);
  /* Le « Rapport » reste ce qu'il est pendant tout travail : à venir, gris — ni rouge, ni rendu. */
  for (const rapport of points.filter((p: any) => p.etape === 'rapport')) assert.equal(rapport.etat, 'avenir');
});

/* UN TOUR DE COMPRÉHENSION TOMBÉ SE LIT SUR LA COMPRÉHENSION, ET NULLE PART AILLEURS. */
const CADRAGE_TOMBE = { ...base, chapitre: 'cadrage', tourNonAbouti: false, dernierTourEnEchec: true } as const;

test('une compréhension tombée passe en erreur, sans rougir Travail ni offrir « Reprendre »', () => {
  const points = pointsDuParcours([demande, tourCadrage] as any, { ...CADRAGE_TOMBE, decisionDeTourOuverte: true });
  const compris = dernierPassage(points, 'comprehension')!;
  assert.equal(compris.etat, 'erreur');
  assert.equal(compris.erreurs[0]?.texte, TEXTE_CADRAGE_TOMBE);
  assert.equal(compris.erreurs[0]?.action, undefined, 'aucun bouton de plus : la décision du bas suffit');
  for (const point of points.filter((p: any) => p.etape === 'travail' || p.etape === 'rapport')) {
    assert.equal(point.etat, 'avenir');
  }
  assert.ok(!points.some((p: any) => p.erreurs.some((err: any) => err.action === 'reprendre')));
});

test('…la demande renvoyée, la compréhension tourne de nouveau, sans rouge', () => {
  const points = pointsDuParcours([demande, tourCadrage] as any, { ...CADRAGE_TOMBE, tourEnCours: true, decisionDeTourOuverte: false });
  assert.equal(dernierPassage(points, 'comprehension')?.etat, 'encours');
  assert.ok(!points.some((p: any) => p.etat === 'erreur'));
});

test('…et « Ignorer » la laisse à venir, sans rouge ni roue qui tourne à vide', () => {
  const points = pointsDuParcours([demande, tourCadrage] as any, { ...CADRAGE_TOMBE, decisionDeTourOuverte: false });
  assert.equal(dernierPassage(points, 'comprehension')?.etat, 'avenir');
  assert.ok(!points.some((p: any) => p.etat === 'erreur' || p.etat === 'encours'));
});

test('sans la marque, le même parcours coche tout comme avant', () => {
  const points = pointsDuParcours(TOUT as any, AU_RAPPORT as any);
  const travail = points.filter((p: any) => p.etape === 'travail').pop()!;
  const rapport = points.filter((p: any) => p.etape === 'rapport').pop()!;
  assert.equal(travail.etat, 'fait');
  assert.equal(rapport.etat, 'fait');
});

/* ------------------------------------------------------------------ */
/* LE TABLEAU ET LE TIROIR DISENT LA MÊME CHOSE.                       */
/*                                                                     */
/* La phrase de la carte (`sansModification`) ne se lisait QUE sur la  */
/* vignette : on ouvrait la carte, et le tiroir racontait l'autre       */
/* moitié de l'histoire — l'erreur du tour — sans jamais dire ce qui    */
/* avait été sauvé. Deux mondes, deux versions du même événement.      */
/* ------------------------------------------------------------------ */

test('la phrase de la carte se pose sur le DERNIER point du parcours', () => {
  const points = pointsDuParcours(TOUT as any, {
    ...AU_RAPPORT,
    mentionDeLaCarte: RAISON_TRAVAIL_SAUVE,
  } as any);
  const dernier = points[points.length - 1];
  assert.equal(dernier.mention?.texte, RAISON_TRAVAIL_SAUVE);
  // Un travail ACQUIS ne se lit pas en alerte : il porte le ton du travail.
  assert.equal(dernier.mention?.nature, 'travail');
  // …et elle ne se répète pas sur les points d'avant.
  assert.ok(points.slice(0, -1).every((p: any) => !p.mention));
});

test('chaque phrase garde le ton de sa nature, et l’absence de phrase ne pose rien', () => {
  const ton = (phrase?: string | null) => {
    const points = pointsDuParcours(TOUT as any, { ...AU_RAPPORT, mentionDeLaCarte: phrase } as any);
    return points[points.length - 1].mention?.nature;
  };
  assert.equal(ton(RAISON_TOUR_SANS_ISSUE), 'information');
  assert.equal(ton(RAISON_RENDU_SANS_CODE), 'information');
  assert.equal(ton('Rien n’a changé : la carte revient en file.'), 'attente');
  assert.equal(ton(undefined), undefined);
  assert.equal(ton('   '), undefined);
});

/* ------------------------------------------------------------------ */
/* UN TOUR DE CADRAGE QUI A RÉPONDU AU LIEU DE CADRER EST UN TOUR FINI  */
/*                                                                     */
/* L'agent de cadrage a deux fins de tour : cadrer un travail, ou      */
/* RÉPONDRE à une simple question — en texte libre, sans jalon. La     */
/* seconde ne pose rien sur la carte, et le point « Compréhension »    */
/* restait donc à tourner sur « L'agent lit le projet… », des heures   */
/* après un tour parfaitement terminé.                                 */
/* ------------------------------------------------------------------ */

test('un tour de cadrage sans compréhension mais avec sa réponse ne tourne plus', () => {
  const journal = [demande, tourCadrage, memoireCadrage, reponseCadrage];
  const fini = pointsDuParcours(journal as any, { ...base, chapitre: 'cadrage' });
  const point = passage(fini, 'comprehension');
  assert.equal(point.etat, 'fait', 'le tour est allé au bout : rien ne tourne plus');
  assert.equal(point.phrase, PHRASE_COMPREHENSION_REPONDUE);
  /* Aucun jalon n'a été posé : la réponse se lit dans le fil, pas en moment. */
  assert.equal(point.moments.length, 0);
  /* Pendant le tour, en revanche, il tourne bien. */
  const enVol = pointsDuParcours([demande, tourCadrage, memoireCadrage] as any, {
    ...base,
    chapitre: 'cadrage',
    tourEnCours: true,
  });
  assert.equal(passage(enVol, 'comprehension').etat, 'encours');
  assert.equal(passage(enVol, 'comprehension').phrase, PHRASES_DU_POINT.comprehension.encours);
});

test('une compréhension rendue garde sa phrase à elle, jamais celle de la réponse', () => {
  const compris = pointsDuParcours([demande, tourCadrage, comprehension, reponseCadrage] as any, {
    ...base,
    chapitre: 'cadrage',
    parcours: { comprehension: { texte: 'compris', at: 1, hypotheses: [], sujets: [] }, plans: [] },
  });
  const point = passage(compris, 'comprehension');
  assert.equal(point.etat, 'fait');
  assert.equal(point.phrase, PHRASES_DU_POINT.comprehension.fait);
  assert.equal(tourDeReponseSeule(point), false);
});

test('un tour de cadrage tombé AVANT sa réponse tourne encore : rien ne le referme', () => {
  const coupe = pointsDuParcours([demande, tourCadrage, memoireCadrage] as any, {
    ...base,
    chapitre: 'cadrage',
  });
  assert.equal(passage(coupe, 'comprehension').etat, 'encours');
});

test('un point « Plan » ne montre QUE sa version : la v1 ne se relit pas dans le point de la v2 qui s’écrit', () => {
  /* LA CARTE « SNAPSHOTS » : plan v1 rendu, précision, nouvelle compréhension,
     « Générer le plan » — et, pendant que la v2 s'écrivait, le point neuf
     affichait la v1 sous son propre récit. */
  const v1 = { numero: 1, titre: 'P', resume: '', texte: '# P', at: 1 };
  const v2 = { numero: 2, titre: 'P2', resume: '', texte: '# P2', at: 2 };
  const comprehension2 = e({ nature: 'jalon', libelle: JALON_COMPREHENSION, agentRole: 'cadrage', resultat: 'mieux compris' });
  const planDemande2 = e({ nature: 'jalon', libelle: JALON_PLAN_DEMANDE, agentRole: 'cadrage', resultat: 'Nouvelle version demandée.' });
  const lecture2 = e({ outil: 'Read', libelle: 'Lecture', agentRole: 'cadrage', params: '{"file_path":"/b.ts"}' });
  const journal = [demande, tourCadrage, comprehension, planDemande, planRendu, affinage, comprehension2, planDemande2, lecture2];
  const points = pointsDuParcours(journal as any, {
    ...base,
    chapitre: 'cadrage',
    tourEnCours: true,
    parcours: { plans: [v1], planDemandeA: 9_000_000 },
  });
  const p1 = passage(points, 'plan', 1);
  const p2 = passage(points, 'plan', 2);
  assert.equal(points.filter((p) => p.etape === 'plan').length, 2, 'deux passages « Plan », jamais trois');
  assert.ok(p2.moments.some((m: any) => m.sorte === 'plan-demande'), 'le point neuf garde ce qui l’a demandé');
  assert.equal(versionDuPassageDePlan(p1, points), 1, 'le premier point porte la v1');
  assert.equal(versionDuPassageDePlan(p2, points), null, 'le point qui attend sa version n’en montre aucune');
  assert.equal(versionDuPassageDePlan(passage(points, 'demande', 2), points), null, 'hors « Plan », aucune version');

  /* LA V2 RENDUE : le point la porte, la v1 reste à la sienne. */
  const planRenduV2 = e({ nature: 'jalon', libelle: JALON_PLAN_PROPOSE, agentRole: 'cadrage', resultat: '# P2', donnees: '{"version":2}' });
  const rendu = pointsDuParcours([...journal, planRenduV2] as any, { ...base, chapitre: 'plan', parcours: { plans: [v1, v2] } });
  assert.equal(versionDuPassageDePlan(passage(rendu, 'plan', 1), rendu), 1);
  assert.equal(versionDuPassageDePlan(passage(rendu, 'plan', 2), rendu), 2);

  /* UN JOURNAL ANCIEN, SANS AUCUN JALON « PLAN PROPOSÉ » : le repli sur la courante reste. */
  const ancien = pointsDuParcours([demande, tourCadrage, comprehension, planDemande, lecturePlan] as any, {
    ...base,
    chapitre: 'plan',
    parcours: { plans: [v1] },
  });
  assert.equal(versionDuPassageDePlan(passage(ancien, 'plan'), ancien), 'courante');

  /* UN PLAN D'AVANT L'OUTIL : son jalon n'a pas de numéro, il montre la courante. */
  const sansNumero = e({ nature: 'jalon', libelle: JALON_PLAN_PROPOSE, agentRole: 'cadrage', resultat: '# Vieux plan' });
  const vieux = pointsDuParcours([demande, planDemande, sansNumero] as any, { ...base, chapitre: 'plan', parcours: { plans: [v1] } });
  assert.equal(versionDuPassageDePlan(passage(vieux, 'plan'), vieux), 'courante');
});

test('un plan que la carte connaît ne se cache jamais, même sans son jalon (carte #88b9)', () => {
  const v1 = { numero: 1, titre: 'P', resume: '', texte: '# P', at: 1 };
  const v2 = { numero: 2, titre: 'P2', resume: '', texte: '# P2', at: 2 };
  const v3 = { numero: 3, titre: 'P3', resume: '', texte: '# P3', at: 3 };
  const cadrage = (partiel: Record<string, unknown>) => e({ nature: 'jalon', agentRole: 'cadrage', ...partiel });
  const journal = [
    cadrage({ libelle: 'Demande', resultat: 'Je veux un bouton' }),
    cadrage({ libelle: JALON_TOUR_LANCE }),
    cadrage({ libelle: JALON_COMPREHENSION, resultat: 'compris' }),
    cadrage({ libelle: JALON_PLAN_DEMANDE, resultat: 'v1' }),
    cadrage({ libelle: JALON_PLAN_PROPOSE, resultat: '# P', donnees: '{"version":1}' }),
    cadrage({ libelle: 'Demande', resultat: 'précision 1' }),
    cadrage({ libelle: JALON_COMPREHENSION, resultat: 'mieux compris' }),
    cadrage({ libelle: JALON_PLAN_DEMANDE, resultat: 'v2' }),
    cadrage({ libelle: JALON_PLAN_PROPOSE, resultat: '# P2', donnees: '{"version":2}' }),
    cadrage({ libelle: 'Demande', resultat: 'précision 2' }),
    cadrage({ libelle: JALON_COMPREHENSION, resultat: 'encore mieux' }),
    cadrage({ libelle: JALON_PLAN_DEMANDE, resultat: 'v3' }),
    /* le jalon « Plan proposé » v3 s'est perdu pendant la coupure */
  ];
  const points = pointsDuParcours(journal as any, { ...base, chapitre: 'plan', parcours: { plans: [v1, v2, v3] } });
  const connues = [1, 2, 3];
  assert.equal(versionDuPassageDePlan(passage(points, 'plan', 1), points, connues), 1);
  assert.equal(versionDuPassageDePlan(passage(points, 'plan', 2), points, connues), 2);
  assert.equal(versionDuPassageDePlan(passage(points, 'plan', 3), points, connues), 3, 'la v3 que « Valider » propose se lit');
  assert.equal(versionDuPassageDePlan(passage(points, 'plan', 3), points), null, 'sans les versions de la carte, rien à montrer');
  /* Toutes les versions portées par leurs jalons : rien ne change. */
  assert.equal(versionDuPassageDePlan(passage(points, 'plan', 3), points, [1, 2]), null);
});

test('le loader « en cours d’écriture » ne vise que le tour qui écrit le plan', () => {
  const v1 = { numero: 1, titre: 'P', resume: '', texte: '# P', at: 1 };
  const v2 = { numero: 2, titre: 'P2', resume: '', texte: '# P2', at: 2 };
  const cadrage = (partiel: Record<string, unknown>) => e({ nature: 'jalon', agentRole: 'cadrage', ...partiel });
  const debut = [
    cadrage({ libelle: 'Demande', resultat: 'Je veux un bouton' }),
    cadrage({ libelle: JALON_TOUR_LANCE }),
    cadrage({ libelle: JALON_COMPREHENSION, resultat: 'compris' }),
    cadrage({ libelle: JALON_PLAN_DEMANDE, resultat: 'v1' }),
    cadrage({ libelle: JALON_PLAN_PROPOSE, resultat: '# P', donnees: '{"version":1}' }),
    cadrage({ libelle: 'Demande', resultat: 'précision' }),
    cadrage({ libelle: JALON_COMPREHENSION, resultat: 'mieux compris' }),
  ];
  const demandeV2 = cadrage({ libelle: JALON_PLAN_DEMANDE, resultat: 'v2' });
  const renduV2 = cadrage({ libelle: JALON_PLAN_PROPOSE, resultat: '# P2', donnees: '{"version":2}' });

  /* 1. Le tour ÉCRIT la v2 : le plan rendu en plein tour dit qu'il s'écrit encore. */
  const enPlan = pointsDuParcours([...debut, demandeV2, renduV2] as any, {
    ...base,
    chapitre: 'plan',
    tourEnCours: true,
    parcours: { plans: [v1, v2] },
  });
  const lu = (points: any[], rangDuPlan: number, planDemande = false) =>
    planEnCoursDEcriture({ tourEnCours: true, passage: passage(points, 'plan', rangDuPlan), passages: points, planDemande });
  assert.equal(lu(enPlan, 2), true);
  assert.equal(lu(enPlan, 1), false, 'la v1 est finie');
  assert.equal(lu(enPlan, 2, true), false, 'une version suivante est déjà demandée');
  assert.equal(passage(enPlan, 'plan', 3), undefined, 'un plan rendu en plein tour n’ouvre plus de second point « Plan »');

  /* 2. Une précision relance une COMPRÉHENSION : la v2 prête ne repasse pas « en cours d'écriture ». */
  const precision = cadrage({ libelle: 'Demande', resultat: 'encore une précision' });
  const enComprehension = pointsDuParcours([...debut, demandeV2, renduV2, precision] as any, {
    ...base,
    chapitre: 'plan',
    tourEnCours: true,
    parcours: { plans: [v1, v2] },
  });
  assert.equal(lu(enComprehension, 2), false);
  assert.equal(planEnCoursDEcriture({ tourEnCours: false, passage: passage(enPlan, 'plan', 2), passages: enPlan }), false, 'tour fini');

  /* 3. « Générer le plan » : le passage neuf annonce la v2, l'ancien n'annonce rien. */
  const enPreparation = pointsDuParcours([...debut, demandeV2] as any, {
    ...base,
    chapitre: 'plan',
    tourEnCours: true,
    parcours: { plans: [v1], planDemandeA: 9_000_000 },
  });
  assert.equal(versionEnPreparation(passage(enPreparation, 'plan', 2), [v1]), 2);
  assert.equal(versionEnPreparation(passage(enPreparation, 'plan', 1), [v1]), null);
  assert.equal(versionEnPreparation(passage(enPlan, 'plan', 2), [v1, v2]), null, 'un plan rendu remplace la silhouette');
  /* Dès le clic, avant même le jalon : `planDemandeA` ouvre le passage anticipé. */
  const desLeClic = pointsDuParcours([...debut] as any, {
    ...base,
    chapitre: 'plan',
    parcours: { plans: [v1], planDemandeA: 9_000_000 },
  });
  assert.equal(versionEnPreparation(passage(desLeClic, 'plan', 2), [v1], true), 2);
});

/* ------------------------------------------------------------------ */
/* LA RÉPONSE D'UN TOUR-QUESTION SORT DU RÉCIT, DANS SON PROPRE CADRE   */
/*                                                                     */
/* Rangée parmi les actions, elle se cachait derrière « voir les N de  */
/* plus » (cartes #f9af et #7430) : il fallait déplier trois fois.     */
/* ------------------------------------------------------------------ */

test('un tour répondu : la réponse sort des traces, se vise, et la réflexion se replie', () => {
  const fini = pointsDuParcours([demande, tourCadrage, memoireCadrage, reponseCadrage] as any, {
    ...base,
    chapitre: 'cadrage',
    parcours: { issueDuTour: { issue: 'reponse', at: 2 } } as any,
  });
  const point = passage(fini, 'comprehension');
  assert.equal(point.reponse?.id, reponseCadrage.id, 'la réponse est posée sur le passage');
  assert.ok(!point.traces.some((trace: any) => trace.id === reponseCadrage.id), 'elle ne compte plus parmi les actions');
  assert.ok(point.traces.some((trace: any) => trace.id === memoireCadrage.id), 'la réflexion, elle, reste');
  assert.deepEqual(blocDeFinDuPassage(point), { sorte: 'reponse', cle: reponseCadrage.id });
  assert.deepEqual(blocDeFinAViser(fini), { ancre: point.ancre, sorte: 'reponse', cle: reponseCadrage.id });
  /* LA RÉPONSE SE LIT HORS DE LA CARTE DU PASSAGE, toujours à l'écran ; la
     carte, elle — la réflexion qui y a mené — reste ouverte tour fini : les
     actions des agents ne se replient plus (26/10/2026). */
  assert.ok(pointsOuvertsDOffice(fini).includes(point.ancre));
});

test('une carte ancienne sans issue écrite : la trace de réponse suffit', () => {
  const ancienne = pointsDuParcours([demande, tourCadrage, memoireCadrage, reponseCadrage] as any, {
    ...base,
    chapitre: 'cadrage',
  });
  assert.equal(passage(ancienne, 'comprehension').reponse?.id, reponseCadrage.id);
});

test('UN TOUR QUI A CADRÉ N’AFFICHE QUE SA COMPRÉHENSION : la réponse écrite reste dans la réflexion repliée', () => {
  /* La compréhension EST la réponse (14/10/2026) : lire en clair le texte
     écrit juste au-dessus d'elle, c'était lire deux fois la même chose. */
  const cadre = pointsDuParcours([demande, tourCadrage, memoireCadrage, comprehension, reponseCadrage] as any, {
    ...base,
    chapitre: 'cadrage',
    parcours: { comprehension: { texte: 'compris', at: 1, hypotheses: [], sujets: [] }, plans: [], issueDuTour: { issue: 'cadrage', at: 2 } } as any,
  });
  const point = passage(cadre, 'comprehension');
  assert.equal(point.reponse, undefined, 'aucune réponse en clair au-dessus de la compréhension');
  assert.equal(reponseDuPassage(point, { issueDuTour: { issue: 'cadrage', at: 2 } } as any), undefined);
  assert.ok(point.traces.some((trace: any) => trace.id === reponseCadrage.id), 'le texte écrit reste lisible parmi les traces repliées');
  assert.ok(point.moments.some((m: any) => m.sorte === 'comprehension'), 'la compréhension reste sur le passage');
  assert.equal(point.etat, 'fait');
  assert.notEqual(point.phrase, PHRASE_COMPREHENSION_REPONDUE, 'le point dit qu’il a compris, pas seulement répondu');
  assert.deepEqual(blocDeFinDuPassage(point), { sorte: 'comprehension', cle: comprehension.id });
  /* Sans réponse écrite, la compréhension reste le bloc de fin, comme avant. */
  const muet = pointsDuParcours([demande, tourCadrage, memoireCadrage, comprehension] as any, {
    ...base,
    chapitre: 'cadrage',
    parcours: { comprehension: { texte: 'compris', at: 1, hypotheses: [], sujets: [] }, plans: [], issueDuTour: { issue: 'cadrage', at: 2 } } as any,
  });
  assert.equal(passage(muet, 'comprehension').reponse, undefined);
  assert.deepEqual(blocDeFinDuPassage(passage(muet, 'comprehension')), { sorte: 'comprehension', cle: comprehension.id });
  /* Un tour en vol, sans rien de rendu : ni bloc, ni repli. */
  const enVol = pointsDuParcours([demande, tourCadrage, memoireCadrage] as any, { ...base, chapitre: 'cadrage', tourEnCours: true });
  assert.equal(blocDeFinDuPassage(passage(enVol, 'comprehension')), null);
  assert.equal(blocDeFinAViser(enVol), null);
});

/* ------------------------------------------------------------------ */
/* LE PLAN RENDU PUIS UNE COMPRÉHENSION RÉCLAMÉE DANS LE MÊME TOUR       */
/* ------------------------------------------------------------------ */

test('une compréhension écrite dans le tour du plan n’ouvre ni compréhension ni second « Plan »', () => {
  const demandePlan = e({ nature: 'jalon', libelle: JALON_PLAN_DEMANDE, agentRole: 'cadrage', resultat: 'Première version demandée.', tourId: 'T2' });
  const rendu = e({ nature: 'jalon', libelle: JALON_PLAN_PROPOSE, agentRole: 'cadrage', resultat: '# P', donnees: '{"version":1}', tourId: 'T2' });
  const parasite = e({ nature: 'jalon', libelle: JALON_COMPREHENSION, agentRole: 'cadrage', resultat: 'compris encore', tourId: 'T2' });
  const apres = e({ outil: 'Read', libelle: 'Lecture', agentRole: 'cadrage', params: '{"file_path":"/b.ts"}', tourId: 'T2' });
  const journal = [demande, tourCadrage, comprehension, demandePlan, rendu, parasite, apres];
  const parcours = {
    plans: [{ numero: 1, titre: 'P', resume: 'r', texte: '# P', at: rendu.at, tourId: 'T2' }],
    comprehension: { texte: 'compris encore', hypotheses: [], sujets: [], at: parasite.at, tourId: 'T2' },
  };
  const points = pointsDuParcours(journal as any, { ...base, chapitre: 'plan', parcours } as any);
  const plans = points.filter((p) => p.etape === 'plan' && !p.annonce);
  assert.equal(plans.length, 1, suite(points).join(', '));
  assert.equal(points.filter((p) => p.etape === 'comprehension').length, 1, suite(points).join(', '));
  assert.ok(plans[0].moments.some((m: any) => m.sorte === 'plan'), 'le plan est dans son point');
  assert.ok(pointsOuvertsDOffice(points).includes(plans[0].ancre), 'le point du plan est ouvert');
});

test('un vrai message après le plan rouvre toujours le cadrage', () => {
  const rendu = e({ nature: 'jalon', libelle: JALON_PLAN_PROPOSE, agentRole: 'cadrage', resultat: '# P', donnees: '{"version":1}', tourId: 'T2' });
  const precision = e({ nature: 'jalon', libelle: 'Demande', agentRole: 'cadrage', resultat: 'Ajoute le PDF', tourId: 'T3' });
  const nouvelle = e({ nature: 'jalon', libelle: JALON_COMPREHENSION, agentRole: 'cadrage', resultat: 'compris v2', tourId: 'T3' });
  const journal = [demande, tourCadrage, comprehension, rendu, precision, nouvelle];
  const passages = contenuDesPoints(journal as any);
  const etapes = passages.map((p) => p.etape);
  assert.ok(etapes.lastIndexOf('comprehension') > etapes.indexOf('plan'), etapes.join(', '));
});

/* ------------------------------------------------------------------ */
/* LE RÉSUMÉ ÉCRIT PAR L'AGENT SOUS « DEMANDE », « COMPRÉHENSION », « PLAN » */
/* ------------------------------------------------------------------ */

test('chaque point lit le résumé de SON tour, et une carte d’avant garde ses phrases fixes', () => {
  const d1 = e({ nature: 'jalon', libelle: 'Demande', agentRole: 'cadrage', resultat: 'Je veux un bouton' });
  const c1 = e({
    nature: 'jalon',
    libelle: JALON_COMPREHENSION,
    agentRole: 'cadrage',
    resultat: 'compris',
    donnees: JSON.stringify({ resumeDemande: 'Un bouton est demandé.', resumeComprehension: 'Un bouton en tête de page.' }),
  });
  const pd = e({ nature: 'jalon', libelle: JALON_PLAN_DEMANDE, agentRole: 'cadrage', resultat: 'Première version demandée.' });
  const p1 = e({ nature: 'jalon', libelle: JALON_PLAN_PROPOSE, agentRole: 'cadrage', resultat: '# P', donnees: '{"version":1}' });
  const d2 = e({ nature: 'jalon', libelle: 'Demande', agentRole: 'cadrage', resultat: 'Et un PDF' });
  const c2 = e({
    nature: 'jalon',
    libelle: JALON_COMPREHENSION,
    agentRole: 'cadrage',
    resultat: 'compris 2',
    donnees: JSON.stringify({ resumeDemande: 'Un PDF s’ajoute.', resumeComprehension: 'Le bouton et un PDF.' }),
  });
  const plans = [{ numero: 1, titre: 'P', resume: '', synthese: 'On pose le bouton, puis on le teste.', texte: '# P', at: 1 }];
  const points = pointsDuParcours([d1, c1, pd, p1, d2, c2] as any, {
    ...base,
    colonne: 'running',
    chapitre: 'travail',
    parcours: { comprehension: { texte: 'compris 2', at: 2, hypotheses: [], sujets: [] }, plans, planValide: { version: 1, at: 3 } },
  } as any);
  assert.equal(passage(points, 'demande', 1).resume, 'Un bouton est demandé.');
  /* LA COMPRÉHENSION SE LIT EN ENTIER, DÉTACHÉE DU BLOC (12/10/2026) : son court résumé ne se
     répète plus sous le point dès qu'une compréhension est rendue — il reste sur le jalon. */
  assert.equal(passage(points, 'comprehension', 1).resume, undefined);
  assert.equal(passage(points, 'plan', 1).resume, 'On pose le bouton, puis on le teste.');
  assert.equal(passage(points, 'demande', 2).resume, 'Un PDF s’ajoute.', 'la précision lit le résumé de la compréhension qui la suit');
  assert.equal(passage(points, 'comprehension', 2).resume, undefined);
  /* La phrase fixe reste en dessous, pour le texte à traduire et les contrôles. */
  assert.equal(passage(points, 'demande', 1).phrase, PHRASES_DU_POINT.demande.fait);

  /* UNE CARTE D'AVANT, sans résumé : rien ne remplace ses phrases. */
  const avant = pointsDuParcours([demande, comprehension] as any, {
    ...base,
    chapitre: 'cadrage',
    parcours: { comprehension: { texte: 'compris', at: 1, hypotheses: [], sujets: [] }, plans: [] },
  });
  for (const point of avant) assert.equal(point.resume, undefined, point.etape);

  /* UNE DEMANDE PAS ENCORE COMPRISE n'emprunte pas le résumé d'avant. */
  const enCours = pointsDuParcours([d1, c1, d2, tourCadrage] as any, { ...base, chapitre: 'cadrage', tourEnCours: true });
  assert.equal(passage(enCours, 'demande', 2).resume, undefined);
});

/* ------------------------------------------------------------------ */
/* LA SYNTHÈSE ÉCRITE AU DÉBUT DU TOUR, SOUS « DEMANDE »                */
/* ------------------------------------------------------------------ */

test('le point « Demande » montre la synthèse de son jalon AVANT la fin du tour', () => {
  const d1 = e({
    nature: 'jalon',
    libelle: 'Demande',
    agentRole: 'cadrage',
    resultat: 'Je veux un bouton',
    donnees: JSON.stringify({ messageId: 'm1', resumeDemande: 'Un bouton est demandé en haut de page.' }),
  });
  const t1 = e({ nature: 'jalon', libelle: JALON_TOUR_LANCE, agentRole: 'cadrage', tourId: 'T1' });
  /* Le tour TOURNE encore : ni compréhension, ni plan, ni rapport. */
  const points = pointsDuParcours([d1, t1] as any, { ...base, chapitre: 'cadrage', tourEnCours: true });
  assert.equal(passage(points, 'demande', 1).resume, 'Un bouton est demandé en haut de page.');
});

test('la compréhension du tour AFFINE la synthèse d’ouverture', () => {
  const d1 = e({
    nature: 'jalon',
    libelle: 'Demande',
    agentRole: 'cadrage',
    resultat: 'Je veux un bouton',
    donnees: JSON.stringify({ resumeDemande: 'Synthèse d’ouverture.' }),
  });
  const c1 = e({
    nature: 'jalon',
    libelle: JALON_COMPREHENSION,
    agentRole: 'cadrage',
    resultat: 'compris',
    donnees: JSON.stringify({ resumeDemande: 'Synthèse affinée.', resumeComprehension: 'Un bouton en tête de page.' }),
  });
  const points = pointsDuParcours([d1, c1] as any, {
    ...base,
    chapitre: 'cadrage',
    parcours: { comprehension: { texte: 'compris', at: 2, hypotheses: [], sujets: [] }, plans: [] },
  } as any);
  assert.equal(passage(points, 'demande', 1).resume, 'Synthèse affinée.');
});

test('chaque échange a SA synthèse, et une carte d’avant garde l’ancien chemin', () => {
  const d1 = e({
    nature: 'jalon',
    libelle: 'Demande',
    agentRole: 'cadrage',
    resultat: 'Je veux un bouton',
    donnees: JSON.stringify({ resumeDemande: 'Le premier message demande un bouton.' }),
  });
  const c1 = e({ nature: 'jalon', libelle: JALON_COMPREHENSION, agentRole: 'cadrage', resultat: 'compris' });
  const d2 = e({
    nature: 'jalon',
    libelle: 'Demande',
    agentRole: 'cadrage',
    resultat: 'Et un PDF',
    donnees: JSON.stringify({ resumeDemande: 'Le second message ajoute un PDF.' }),
  });
  const t2 = e({ nature: 'jalon', libelle: JALON_TOUR_LANCE, agentRole: 'cadrage', tourId: 'T2' });
  const points = pointsDuParcours([d1, c1, d2, t2] as any, { ...base, chapitre: 'cadrage', tourEnCours: true });
  assert.equal(passage(points, 'demande', 1).resume, 'Le premier message demande un bouton.');
  assert.equal(passage(points, 'demande', 2).resume, 'Le second message ajoute un PDF.');

  /* UNE CARTE D'AVANT : aucun jalon de demande ne porte de synthèse, l'emprunt
     à la compréhension qui suit reste le seul chemin — rien n'a régressé. */
  const ancienD = e({ nature: 'jalon', libelle: 'Demande', agentRole: 'cadrage', resultat: 'Je veux un bouton' });
  const ancienC = e({
    nature: 'jalon',
    libelle: JALON_COMPREHENSION,
    agentRole: 'cadrage',
    resultat: 'compris',
    donnees: JSON.stringify({ resumeDemande: 'Un bouton est demandé.', resumeComprehension: 'Un bouton.' }),
  });
  const avant = pointsDuParcours([ancienD, ancienC] as any, {
    ...base,
    chapitre: 'cadrage',
    parcours: { comprehension: { texte: 'compris', at: 2, hypotheses: [], sujets: [] }, plans: [] },
  } as any);
  assert.equal(passage(avant, 'demande', 1).resume, 'Un bouton est demandé.');
});

test('un tour coupé garde sa synthèse d’ouverture, et le reste du fil garde ses phrases', () => {
  const d1 = e({
    nature: 'jalon',
    libelle: 'Demande',
    agentRole: 'cadrage',
    resultat: 'Je veux un bouton',
    donnees: JSON.stringify({ resumeDemande: 'Un bouton est demandé.' }),
  });
  const t1 = e({ nature: 'jalon', libelle: JALON_TOUR_LANCE, agentRole: 'cadrage', tourId: 'T1' });
  const points = pointsDuParcours([d1, t1] as any, { ...base, chapitre: 'cadrage', tourEnCours: true });
  assert.equal(passage(points, 'demande', 1).resume, 'Un bouton est demandé.');
  /* AUCUN AUTRE POINT n'a été ouvert par l'assouplissement. */
  for (const point of points) {
    if (point.etape === 'demande') continue;
    assert.equal(point.resume, undefined, point.etape);
  }
});

/*
 * UN CADRAGE QUI N'A JAMAIS DÉMARRÉ NE TOURNE PAS À VIDE (constaté le
 * 26.09.2026 : des cartes « suivi des visites » disaient « L'agent lit le
 * projet… » pour toujours, sur un agent qui n'avait jamais rien reçu).
 */
test('un cadrage jamais parti laisse la compréhension « à venir », jamais en cours', () => {
  const etats = (points: ReturnType<typeof pointsDuParcours>) => barreDuParcours(points).map((s) => s.etat);
  const enAttente = pointsDuParcours([demande] as any, { ...base, chapitre: 'cadrage', cadrageEnAttente: true });
  assert.deepEqual(etats(enAttente), ['fait', 'fait', 'avenir', 'avenir', 'avenir']);
  assert.equal(passage(enAttente, 'comprehension').phrase, PHRASE_COMPREHENSION_EN_ATTENTE);
  /* Sans le constat, l'ancien comportement tient. */
  const sansConstat = pointsDuParcours([demande] as any, { ...base, chapitre: 'cadrage' });
  assert.equal(passage(sansConstat, 'comprehension').etat, 'encours');
  /* Un tour vivant l'emporte toujours : l'étape tourne. */
  const vivant = pointsDuParcours([demande, tourCadrage] as any, { ...base, chapitre: 'cadrage', tourEnCours: true, cadrageEnAttente: true });
  assert.equal(passage(vivant, 'comprehension').etat, 'encours');
});

/*
 * LES COMPÉTENCES RETENUES SE LISENT DANS LE FLUX, à l'heure où l'agent les a
 * récupérées : chacune rejoint le dernier passage ouvert avant sa retenue, une
 * seule fois, même quand le tour vivant ouvre un passage de plus.
 */
test('une compétence retenue est rangée au passage ouvert avant elle, une seule fois', () => {
  const competence = (nom: string, proposeeLe: number) => ({
    nom,
    titre: nom,
    correspondance: 'parle de la demande',
    questionId: `q-${nom}`,
    etat: 'utilisee' as const,
    proposeeLe,
  });
  const points = pointsDuParcours([demande, tourCadrage, comprehension] as any, {
    ...base,
    chapitre: 'cadrage',
    parcours: { competencesProposees: [competence('a', 1), competence('b', 2)] } as any,
  });
  const total = points.reduce((n, point) => n + (point.competences?.length ?? 0), 0);
  assert.equal(total, 2, 'chaque compétence apparaît une seule fois dans le flux');
  const porteur = points.find((point) => point.competences?.length);
  assert.ok(porteur, 'un passage porte les compétences');
  assert.notEqual(porteur!.annonce, true, 'jamais un passage qui ne fait qu’annoncer la suite');
});

test('LE PASSAGE « PLAN » SORT SA RÉPONSE DU RÉCIT : le mot à l’utilisateur se lit en clair, le plan reste le bloc de fin', () => {
  /* Capture #40a5 (22/10/2026) : une question après le plan relance un tour qui
     rend compréhension, version 3 et une réponse — la réponse restait une
     trace tronquée du récit. */
  const trace = { id: 'r-plan', phase: 'rapport', nature: 'jalon', libelle: 'Réponse rendue', resultat: 'Oui, ta vidéo convient.', at: 10 };
  const vide = { ...trace, id: 'r-vide', resultat: '  ', at: 11 };
  const passagePlan = { etape: 'plan', moments: [{ sorte: 'plan', entree: { id: 'p3', at: 9 } }], traces: [{ id: 'lecture', libelle: 'Lecture', at: 5 }, trace, vide] };
  assert.equal(reponseDuPassage(passagePlan as any)?.id, 'r-plan', 'la dernière réponse non vide');
  assert.deepEqual(blocDeFinDuPassage({ ...passagePlan, reponse: trace } as any), { sorte: 'plan', cle: 'p3' });
  assert.equal(reponseDuPassage({ ...passagePlan, traces: [] } as any), undefined);
});

test('une création de média n’a jamais de point « Plan », même avec un plan rendu', () => {
  const media = {
    ...base,
    chapitre: 'cadrage' as const,
    tourEnCours: false,
    parcours: { plans: [{ numero: 1, titre: 'Vidéo', texte: 'x', at: 1 }], realisationSouhaitee: true },
  };
  const points = pointsDuParcours([...CADRAGE, planDemande] as any, media as any);
  assert.equal(laCarteAUnPlan(points, media as any), false);
  assert.ok(!barreDuParcours(points).some((s) => s.etape === 'plan'));
});

test('l’écho local suit la demande de file qui le porte, et s’efface quand elle en sort', () => {
  const echo = { texte: 'Fais l’image du plan 2', at: 1 };
  // Envoi normal : jamais passé par la file, l'écho reste.
  assert.deepEqual(echoLocalSelonLaFile(echo, []), echo);
  assert.equal(echoLocalSelonLaFile(null, [{ id: 'q1', text: 'x' }]), null);
  // L'envoi atterrit en file : l'écho s'y accroche.
  const enFile = echoLocalSelonLaFile(echo, [{ id: 'q1', text: 'Fais l’image du plan 2 ' }]);
  assert.equal(enFile?.fileId, 'q1');
  // Modifié dans la file : l'écho suit le nouveau texte.
  assert.equal(echoLocalSelonLaFile(enFile, [{ id: 'q1', text: 'Fais plutôt le plan 3' }])?.texte, 'Fais plutôt le plan 3');
  // Retiré de la file (ou parti) : l'écho s'efface.
  assert.equal(echoLocalSelonLaFile(enFile, []), null);
  assert.equal(echoLocalSelonLaFile(enFile, [{ id: 'q2', text: 'autre' }]), null);
});
