import assert from 'node:assert/strict';
import test from 'node:test';
import {
  JALON_COMPREHENSION,
  JALON_PLAN_PROPOSE,
  JALON_TOUR_LANCE,
  PLAFOND_DONNEES,
  PLAFOND_RESULTAT,
  PLAFOND_TEXTE_DE_JALON,
  plafondDuResultat,
  texteEntierDuJalon,
  aDejaExecute,
  bornerTexte,
  donneesDuJournal,
  donneesFusionnees,
  dureeDuGroupe,
  estUneConsigneAuMoteur,
  fusionnerLesAppelsEnDouble,
  montageDuFlux,
  nomNuDOutil,
  ordonnerJournal,
  outilJournalise,
  paramsCanoniques,
  paramsLisibles,
  phaseDuTour,
  reponseALaQuestion,
  texteSansAttente,
  vueDeLEntree,
  journalATrou,
  type EntreeJournal,
} from '@beluga/shared';

function entree(partiel: Partial<EntreeJournal> & { rang: number }): EntreeJournal {
  return {
    id: `e${partiel.rang}`,
    cardId: 'c1',
    phase: 'execution',
    nature: 'requete',
    at: 1_000 + partiel.rang,
    libelle: '',
    ...partiel,
  };
}

test('la phase se déduit du rôle, et le recadrage de ce que le journal contient déjà', () => {
  assert.equal(phaseDuTour('cadrage', false), 'cadrage');
  assert.equal(phaseDuTour('cadrage', true), 'recadrage');
  assert.equal(phaseDuTour('task', false), 'execution');
  assert.equal(phaseDuTour('task', true), 'execution');
  assert.equal(phaseDuTour(undefined, false), 'execution');
});

test('une carte a déjà exécuté dès qu’une entrée d’exécution ou de rapport existe', () => {
  assert.equal(aDejaExecute([{ phase: 'cadrage' }]), false);
  assert.equal(aDejaExecute([{ phase: 'cadrage' }, { phase: 'execution' }]), true);
  assert.equal(aDejaExecute([{ phase: 'rapport' }]), true);
  assert.equal(aDejaExecute([]), false);
});

test('l’ordre vient du rang, jamais de l’horodatage, et la liste reçue n’est pas retournée sur place', () => {
  const brut = [
    entree({ rang: 2, at: 10 }),
    entree({ rang: 0, at: 99 }),
    entree({ rang: 1, at: 50 }),
  ];
  const ordonnees = ordonnerJournal(brut);
  assert.deepEqual(
    ordonnees.map((e) => e.rang),
    [0, 1, 2],
  );
  assert.deepEqual(
    brut.map((e) => e.rang),
    [2, 0, 1],
    'la liste d’origine est intacte',
  );
});

test('un résultat trop long est coupé EN LE DISANT, un texte court reste intact', () => {
  const court = 'trois mots ici';
  assert.equal(bornerTexte(court, PLAFOND_RESULTAT), court);
  assert.equal(bornerTexte('', 10), '');

  const long = 'x'.repeat(PLAFOND_RESULTAT + 500);
  const borne = bornerTexte(long, PLAFOND_RESULTAT);
  assert.ok(borne.length < long.length, 'le texte a été coupé');
  assert.ok(borne.startsWith('x'.repeat(100)), 'le DÉBUT est conservé');
  assert.match(borne, /500 signes de plus, non conservés/, 'ce qui manque est dit en clair');
});

test('tous les outils sont journalisés, sauf celui qui relit le journal', () => {
  assert.equal(outilJournalise('project_memory'), true);
  assert.equal(outilJournalise('coffre_fort'), true);
  assert.equal(outilJournalise('ask_user'), true);
  assert.equal(outilJournalise('journal_carte'), false);
});

test('les paramètres sont mis en JSON lisible, bornés, et un objet impossible ne casse rien', () => {
  assert.equal(paramsLisibles(undefined), '');
  assert.equal(paramsLisibles(null), '');
  assert.equal(paramsLisibles('un texte'), 'un texte');
  assert.match(paramsLisibles({ sujet: 'cartes' }), /"sujet": "cartes"/);

  const circulaire: any = {};
  circulaire.soi = circulaire;
  assert.equal(paramsLisibles(circulaire), '[paramètres illisibles]');
});

test('les données d’une entrée restent un JSON relisible, quelle que soit leur taille', () => {
  /* LE CAS RÉEL : une demande à 54 images. Bornée comme un affichage, la liste
     était coupée en plein tableau, et plus une vignette ne s'affichait. */
  const pieces = Array.from({ length: 200 }, (_, i) => `978141b5-525a-4db0-8721-${String(i).padStart(12, '0')}`);
  const ecrit = donneesDuJournal({ messageId: 'm1', ecriteLe: 1, pieces });
  assert.ok(ecrit.length > 2000, 'bien au-delà de l’ancienne borne');
  assert.deepEqual(JSON.parse(ecrit).pieces, pieces, 'la liste entière se relit');
  assert.equal(donneesDuJournal(undefined), '');
  assert.equal(donneesDuJournal('déjà du texte'), 'déjà du texte');

  /* AU-DELÀ DU GARDE-FOU, CE SONT LES TEXTES QU'ON RACCOURCIT, jamais la chaîne :
     le JSON reste valide et les listes entières. */
  const demesure = donneesDuJournal({ pieces, partieTechnique: { analyse: 'x'.repeat(PLAFOND_DONNEES * 2) } });
  const relu = JSON.parse(demesure);
  assert.ok(demesure.length <= PLAFOND_DONNEES);
  assert.deepEqual(relu.pieces, pieces);
  assert.match(relu.partieTechnique.analyse, /signes de plus, non conservés dans le journal/);

  const circulaire: any = {};
  circulaire.soi = circulaire;
  assert.equal(donneesDuJournal(circulaire), '[données illisibles]');
});

test('un enrichissement fusionne, et ne s’écrit jamais par-dessus un existant illisible', () => {
  const pieces = Array.from({ length: 54 }, (_, i) => `piece-${i}`);
  const fusion = donneesFusionnees(donneesDuJournal({ messageId: 'm1', pieces }), { resumeDemande: 'Une refonte.' });
  assert.ok(fusion);
  assert.deepEqual(JSON.parse(fusion), { messageId: 'm1', pieces, resumeDemande: 'Une refonte.' });
  /* Rien d'écrit encore : l'ajout fait les données à lui seul. */
  assert.deepEqual(JSON.parse(donneesFusionnees(undefined, { resumeDemande: 'Seul.' }) ?? ''), { resumeDemande: 'Seul.' });
  /* UN JSON COUPÉ, UN TABLEAU, UNE PHRASE : on ne fusionne pas, on le dit. */
  assert.equal(donneesFusionnees('{\n  "pieces": [\n    "a",\n    "b', { resumeDemande: 'x' }), null);
  assert.equal(donneesFusionnees('["a"]', { resumeDemande: 'x' }), null);
  assert.equal(donneesFusionnees('une phrase', { resumeDemande: 'x' }), null);
});

/*
 * LE MONTAGE DU FLUX — CE QUE L'ÉCRAN DESSINE, DÉCIDÉ EN RÈGLE PURE.
 */
function commande(rang: number, extra: Partial<EntreeJournal> = {}): EntreeJournal {
  return entree({ rang, outil: 'Bash', libelle: `Commande ${rang}`, dureeMs: 1_000, ...extra });
}

/* LE REGROUPEMENT DES COMMANDES SE TESTE DANS LE DÉROULÉ DÉPLIÉ : replié, tout
   le travail de l'agent ne fait plus qu'un point (`sansBlocDeTravail`). */
test('les commandes qui se suivent forment un seul point, et rien d’autre ne s’y glisse', () => {
  const flux = montageDuFlux(
    [
      commande(0),
      commande(1),
      commande(2),
      entree({ rang: 3, outil: 'Read', libelle: 'Lecture' }),
      commande(4),
      commande(5),
    ],
    { sansBlocDeTravail: true },
  );
  assert.deepEqual(
    flux.map((e) => e.sorte),
    ['phase', 'commandes', 'entree', 'commandes'],
    'une lecture au milieu coupe la suite en deux blocs',
  );
  const premier = flux[1];
  assert.equal(premier.sorte === 'commandes' && premier.entrees.length, 3);
  const second = flux[3];
  assert.equal(second.sorte === 'commandes' && second.entrees.length, 2);
});

test('une commande seule garde sa ligne, et un changement de phase coupe la suite', () => {
  const flux = montageDuFlux(
    [
      commande(0),
      entree({ rang: 1, outil: 'Read', libelle: 'Lecture' }),
      commande(2),
      commande(3, { phase: 'rapport' }),
    ],
    { sansBlocDeTravail: true },
  );
  assert.deepEqual(
    flux.map((e) => e.sorte),
    ['phase', 'entree', 'entree', 'entree', 'phase', 'entree'],
    'deux commandes séparées par une phase ne se rejoignent pas, et une commande seule reste une ligne',
  );
});

test('la réponse finale reste à sa place, le plan a son point, et le tour porteur est signalé', () => {
  const flux = montageDuFlux(
    [
      commande(0),
      commande(1),
      entree({ rang: 2, phase: 'rapport', nature: 'jalon', libelle: 'Plan proposé', tourId: 't1', resultat: 'p' }),
      entree({ rang: 3, phase: 'rapport', nature: 'jalon', libelle: 'Réponse rendue', tourId: 't1', resultat: 'r' }),
    ],
    { reponseId: 'e3', toursDePlan: new Set(['t1']), sansBlocDeTravail: true },
  );
  /* LE REPÈRE « RAPPORT » NE DIT RIEN QUE LA RÉPONSE NE DISE MIEUX : il se
     posait juste au-dessus du point qui porte déjà son titre et son heure. */
  assert.deepEqual(
    flux.map((e) => e.sorte),
    ['phase', 'commandes', 'plan', 'reponse'],
  );
  const reponse = flux[3];
  assert.equal(reponse.sorte === 'reponse' && reponse.dernier, true);
  assert.equal(reponse.sorte === 'reponse' && reponse.porteUnPlan, true);
});

test('le temps d’un groupe additionne ce qui a été chronométré, et se tait si rien ne l’a été', () => {
  assert.equal(dureeDuGroupe([commande(0), commande(1, { dureeMs: 500 })]), 1_500);
  assert.equal(dureeDuGroupe([commande(0, { dureeMs: undefined })]), undefined);
  assert.equal(dureeDuGroupe([]), undefined);
});

test('les deux traces d\'un même appel d\'outil ne font qu\'une ligne', () => {
  const fusion = fusionnerLesAppelsEnDouble([
    entree({ rang: 1, id: 'pont', tourId: 't1', outil: 'ask_user', libelle: 'ask_user', params: '{"question":"…"}', resultat: 'Réponse longue et complète' }),
    entree({ rang: 2, id: 'etape', tourId: 't1', outil: 'ask_user', libelle: 'Outil ask_user', resultat: 'court', dureeMs: 46_000 }),
  ]);
  assert.equal(fusion.length, 1);
  assert.equal(fusion[0].libelle, 'Outil ask_user');
  assert.equal(fusion[0].resultat, 'Réponse longue et complète');
  assert.equal(fusion[0].dureeMs, 46_000);
});

test('le préfixe du pont ne cache pas le nom de l\'outil', () => {
  assert.equal(nomNuDOutil('mcp__beluga__ask_user'), 'ask_user');
  assert.equal(nomNuDOutil(undefined), '');
  const fusion = fusionnerLesAppelsEnDouble([
    entree({ rang: 1, id: 'a', tourId: 't1', outil: 'mcp__beluga__board_update_card', libelle: 'board_update_card' }),
    entree({ rang: 2, id: 'b', tourId: 't1', outil: 'board_update_card', libelle: "Modification d'une carte" }),
  ]);
  assert.equal(fusion.length, 1);
  assert.equal(fusion[0].libelle, "Modification d'une carte");
});

test('deux appels distincts du même outil restent deux lignes', () => {
  /* Au-delà de ce qu'un appel d'outil peut tenir, ce sont deux appels. */
  const eloignes = fusionnerLesAppelsEnDouble([
    entree({ rang: 1, id: 'a', tourId: 't1', outil: 'ask_user', libelle: 'ask_user', at: 1_000 }),
    entree({ rang: 2, id: 'b', tourId: 't1', outil: 'ask_user', libelle: 'Outil ask_user', at: 5_000_000 }),
  ]);
  assert.equal(eloignes.length, 2);
  /* DEUX COMMANDES LANCÉES COUP SUR COUP viennent toutes deux du MOTEUR : elles
     ne se réunissent pas, même à deux secondes d'écart. C'est ce qui les
     faisait disparaître l'une dans l'autre au parcours. */
  const deuxCommandes = fusionnerLesAppelsEnDouble([
    entree({ rang: 1, id: 'a', tourId: 't1', outil: 'Bash', libelle: 'Commande : npm test', at: 1_000 }),
    entree({ rang: 2, id: 'b', tourId: 't1', outil: 'Bash', libelle: 'Commande : git status', at: 3_000 }),
  ]);
  assert.equal(deuxCommandes.length, 2);
  /* …et deux traces écrites par le PONT ne se réunissent pas davantage. */
  const deuxDuPont = fusionnerLesAppelsEnDouble([
    entree({ rang: 1, id: 'a', tourId: 't1', outil: 'ask_user', libelle: 'ask_user', at: 1_000 }),
    entree({ rang: 2, id: 'b', tourId: 't1', outil: 'ask_user', libelle: 'ask_user', at: 3_000 }),
  ]);
  assert.equal(deuxDuPont.length, 2);
  const autreTour = fusionnerLesAppelsEnDouble([
    entree({ rang: 1, id: 'a', tourId: 't1', outil: 'ask_user', libelle: 'ask_user' }),
    entree({ rang: 2, id: 'b', tourId: 't2', outil: 'ask_user', libelle: 'Outil ask_user' }),
  ]);
  assert.equal(autreTour.length, 2);
  const separes = fusionnerLesAppelsEnDouble([
    entree({ rang: 1, id: 'a', tourId: 't1', outil: 'ask_user', libelle: 'ask_user' }),
    entree({ rang: 2, id: 'x', tourId: 't1', outil: 'Read', libelle: 'Read' }),
    entree({ rang: 3, id: 'b', tourId: 't1', outil: 'ask_user', libelle: 'Outil ask_user' }),
  ]);
  assert.equal(separes.length, 3);
});

test('une question répondue au bout de plusieurs minutes ne s\'affiche qu\'une fois', () => {
  /*
   * LA SÉQUENCE RÉELLE, RELEVÉE DANS UN JOURNAL : le pont écrit sa trace à la
   * seconde où la question est posée, avec la consigne rendue au moteur ; le
   * moteur écrit la sienne quand la réponse arrive, ici trois minutes plus
   * tard. Une fenêtre d'une minute les laissait toutes deux à l'écran.
   */
  const pose = 1_788_386_799_640;
  const params = '{"question":"Que doit faire la carte ?","options":[{"label":"Remonter"}]}';
  const fusion = fusionnerLesAppelsEnDouble([
    entree({
      rang: 1,
      id: 'pont',
      tourId: 't1',
      at: pose,
      outil: 'ask_user',
      libelle: 'ask_user',
      params,
      resultat: texteSansAttente(),
      dureeMs: 0,
    }),
    entree({
      rang: 2,
      id: 'etape',
      tourId: 't1',
      at: pose + 180_000,
      outil: 'mcp__beluga__ask_user',
      libelle: 'Question posée',
      params,
      resultat: 'Réponse de l’utilisateur : Remonter\nReprends ton travail à partir de cette réponse.',
      dureeMs: 180_000,
    }),
  ]);
  assert.equal(fusion.length, 1, 'une seule question posée, une seule ligne');
  assert.equal(fusion[0].libelle, 'Question posée');
  assert.equal(fusion[0].dureeMs, 180_000);
  /* LA CONSIGNE RENDUE À L'AGENT NE SURVIT PAS À LA RÉUNION : c'est la réponse
     de l'utilisateur qui se lit, même quand elle est plus courte. */
  assert.equal(estUneConsigneAuMoteur(fusion[0].resultat), false);
  assert.equal(reponseALaQuestion(fusion[0].resultat), 'Remonter');
});

test('la consigne rendue au moteur ne passe jamais pour une réponse', () => {
  assert.equal(estUneConsigneAuMoteur(texteSansAttente()), true);
  assert.equal(estUneConsigneAuMoteur('Remonter les montages'), false);
  assert.equal(estUneConsigneAuMoteur(''), false);
  assert.equal(reponseALaQuestion(texteSansAttente()), undefined);
  /* Une trace du pont restée seule dit « restée sans réponse », pas la consigne. */
  const vue = vueDeLEntree(
    entree({
      rang: 1,
      id: 'seule',
      outil: 'ask_user',
      libelle: 'ask_user',
      params: '{"question":"On y va ?"}',
      resultat: texteSansAttente(),
    }),
  );
  assert.equal(vue.sorte === 'question' && vue.reponse, undefined);
});

/** Les deux traces d'une question : celle du pont à la pose, celle du moteur à la réponse. */
function tracesDUneQuestion(rang: number, question: string, reponse: string): EntreeJournal[] {
  const params = JSON.stringify({ question, options: [{ label: reponse }] });
  return [
    entree({ rang, tourId: 't1', outil: 'ask_user', libelle: 'ask_user', params }),
    entree({
      rang: rang + 1,
      tourId: 't1',
      outil: 'mcp__beluga__ask_user',
      libelle: 'Question posée',
      params,
      resultat: `Réponse de l’utilisateur : ${reponse}\nReprends ton travail à partir de cette réponse.`,
      dureeMs: 20_000,
    }),
  ];
}

test('des questions posées coup sur coup gardent chacune SA réponse', () => {
  /*
   * LA SÉQUENCE RÉELLE, RELEVÉE DANS UN JOURNAL : trois questions enchaînées
   * dans le même tour, sans rien entre elles. La ligne réunie de la première
   * avalait la trace du pont de la deuxième : une question disparaissait, sa
   * réponse se lisait sous la suivante, et la dernière paraissait deux fois.
   */
  const fusion = fusionnerLesAppelsEnDouble([
    ...tracesDUneQuestion(1, 'Sur la roulette des minutes, quel pas ?', 'Minute par minute'),
    ...tracesDUneQuestion(3, 'Sans heure choisie, laquelle retenir ?', 'L’heure qu’il est maintenant'),
    ...tracesDUneQuestion(5, 'Faut-il prévenir la personne invitée ?', 'Oui'),
  ]);
  assert.deepEqual(
    fusion.map((e) => [JSON.parse(e.params ?? '{}').question, reponseALaQuestion(e.resultat)]),
    [
      ['Sur la roulette des minutes, quel pas ?', 'Minute par minute'],
      ['Sans heure choisie, laquelle retenir ?', 'L’heure qu’il est maintenant'],
      ['Faut-il prévenir la personne invitée ?', 'Oui'],
    ],
  );
  assert.ok(fusion.every((e) => e.libelle === 'Question posée'));
});

test('deux consultations de mémoire enchaînées restent deux lignes, chacune avec son résultat', () => {
  const fusion = fusionnerLesAppelsEnDouble([
    entree({ rang: 1, tourId: 't1', outil: 'memoire', libelle: 'memoire', params: '{"geste":"chercher","demande":"a"}' }),
    entree({ rang: 2, tourId: 't1', outil: 'mcp__beluga__memoire', libelle: 'Mémoire du projet', params: '{"geste":"chercher","demande":"a"}', resultat: 'unités de a' }),
    entree({ rang: 3, tourId: 't1', outil: 'memoire', libelle: 'memoire', params: '{"geste":"lire","id":"MEM-0001"}' }),
    entree({ rang: 4, tourId: 't1', outil: 'mcp__beluga__memoire', libelle: 'Mémoire du projet', params: '{"geste":"lire","id":"MEM-0001"}', resultat: 'la fiche' }),
  ]);
  assert.deepEqual(
    fusion.map((e) => [e.params, e.resultat]),
    [
      ['{"geste":"chercher","demande":"a"}', 'unités de a'],
      ['{"geste":"lire","id":"MEM-0001"}', 'la fiche'],
    ],
  );
});

test('des appels lancés ensemble s\'écrivent croisés, et chacun retrouve sa moitié', () => {
  /* Pont A, pont B, moteur A, moteur B : le voisin immédiat n'est pas la bonne moitié. */
  const fusion = fusionnerLesAppelsEnDouble([
    entree({ rang: 1, tourId: 't1', outil: 'memoire', libelle: 'memoire', params: '{"id":"A"}' }),
    entree({ rang: 2, tourId: 't1', outil: 'memoire', libelle: 'memoire', params: '{"id":"B"}' }),
    entree({ rang: 3, tourId: 't1', outil: 'mcp__beluga__memoire', libelle: 'Mémoire du projet', params: '{"id":"A"}', resultat: 'fiche A' }),
    entree({ rang: 4, tourId: 't1', outil: 'mcp__beluga__memoire', libelle: 'Mémoire du projet', params: '{"id":"B"}', resultat: 'fiche B' }),
  ]);
  assert.deepEqual(
    fusion.map((e) => [e.params, e.resultat]),
    [
      ['{"id":"A"}', 'fiche A'],
      ['{"id":"B"}', 'fiche B'],
    ],
  );
});

test('deux traces aux paramètres différents sont deux appels, jamais un mélange', () => {
  const fusion = fusionnerLesAppelsEnDouble([
    entree({ rang: 1, tourId: 't1', outil: 'ask_user', libelle: 'ask_user', params: '{"question":"Première ?"}' }),
    entree({ rang: 2, tourId: 't1', outil: 'mcp__beluga__ask_user', libelle: 'Question posée', params: '{"question":"Seconde ?"}', resultat: 'Réponse de l’utilisateur : Oui' }),
  ]);
  assert.equal(fusion.length, 2);
  assert.equal(fusion[0].resultat, undefined);
  assert.equal(fusion[1].params, '{"question":"Seconde ?"}');
});

test('les mêmes paramètres se reconnaissent sous l\'enveloppe d\'un moteur et dans un autre ordre', () => {
  const duPont = '{"path":"/tmp/a.png","label":"Accueil"}';
  const duMoteur = '{"name":"beluga-attach_file","args":{"label":"Accueil","path":"/tmp/a.png"}}';
  assert.equal(paramsCanoniques(duPont), paramsCanoniques(duMoteur));
  /* L'enveloppe RELEVÉE DANS UN JOURNAL porte aussi l'identifiant de l'appel. */
  const releve =
    '{"name":"beluga-attach_file","args":{"path":"/tmp/a.png","label":"Accueil"},"toolCallId":"toolu_01","providerIdentifier":"beluga","toolName":"attach_file","skipApproval":false}';
  assert.equal(paramsCanoniques(releve), paramsCanoniques(duPont));
  assert.equal(paramsCanoniques(undefined), '');
  assert.equal(paramsCanoniques('pas du JSON'), 'pas du JSON');
  /* Un vrai paramètre nommé « args » à côté d'autres n'est pas une enveloppe. */
  assert.notEqual(paramsCanoniques('{"name":"x","args":{},"autre":1}'), paramsCanoniques('{}'));
  const fusion = fusionnerLesAppelsEnDouble([
    entree({ rang: 1, tourId: 't1', outil: 'attach_file', libelle: 'attach_file', params: duPont }),
    entree({ rang: 2, tourId: 't1', outil: 'mcp__beluga__attach_file', libelle: 'Fichier joint', params: duMoteur, resultat: 'joint' }),
  ]);
  assert.equal(fusion.length, 1);
  /* Ceux du pont passent : l'outil les a reçus ainsi, sans enveloppe. */
  assert.equal(fusion[0].params, duPont);
});

test('un échec sur l\'une des deux traces marque la ligne fusionnée', () => {
  const fusion = fusionnerLesAppelsEnDouble([
    entree({ rang: 1, id: 'a', tourId: 't1', outil: 'Bash', libelle: 'Bash', reussie: true }),
    entree({ rang: 2, id: 'b', tourId: 't1', outil: 'Bash', libelle: 'Commande', reussie: false }),
  ]);
  assert.equal(fusion.length, 1);
  assert.equal(fusion[0].reussie, false);
});

test('le cadrage se lit comme l’exécution : ses jalons au premier niveau, sa machine repliée', () => {
  /*
   * LE PARCOURS NE SE DÉDUIT PLUS DES OUTILS APPELÉS. Le cadrage se dessinait
   * en huit temps d'après les appels de `project_memory`, `ask_user`,
   * `board_update_card` : une timeline relue dans le texte. Ce qui compte
   * désormais est ÉCRIT — la demande, la compréhension rendue par l'outil, le
   * plan rendu par l'outil — et tout le reste est du travail de machine.
   */
  const flux = montageDuFlux([
    entree({ rang: 0, phase: 'cadrage', nature: 'jalon', libelle: 'Demande', resultat: 'la demande' }),
    entree({ rang: 1, phase: 'cadrage', nature: 'jalon', libelle: JALON_TOUR_LANCE, donnees: '{"moteur":"claude"}' }),
    entree({ rang: 2, phase: 'cadrage', outil: 'board_update_card', libelle: "Modification d'une carte" }),
    entree({ rang: 3, phase: 'cadrage', outil: 'project_memory', libelle: 'Mémoire du projet' }),
    entree({ rang: 4, phase: 'cadrage', outil: 'ask_user', libelle: 'Question posée' }),
    entree({ rang: 5, phase: 'cadrage', nature: 'jalon', libelle: JALON_COMPREHENSION, resultat: 'compris' }),
    entree({ rang: 6, phase: 'rapport', nature: 'jalon', libelle: 'Réponse rendue', resultat: 'r' }),
  ]);
  assert.deepEqual(
    flux.map((e) => e.sorte),
    ['phase', 'entree', 'travail', 'entree', 'comprehension', 'reponse'],
  );
  /* Le repère de phase ouvre le cadrage : c'est lui que la frise vient viser. */
  assert.equal(flux[0].sorte === 'phase' && flux[0].phase, 'cadrage');
  /* La demande garde sa ligne, la question aussi ; le titre, la mémoire et
     le départ du tour sont du travail. */
  const travail = flux[2];
  assert.equal(travail.sorte === 'travail' && travail.entrees.length, 3);
  assert.equal(flux[3].sorte === 'entree' && flux[3].entree.outil, 'ask_user');
});

test('la compréhension rendue est un jalon à part, et la dernière est désignée', () => {
  const entrees = [
    entree({ rang: 0, phase: 'cadrage', nature: 'jalon', libelle: JALON_COMPREHENSION, resultat: 'v1' }),
    entree({ rang: 1, phase: 'cadrage', nature: 'jalon', libelle: 'Demande', resultat: 'précision' }),
    entree({ rang: 2, phase: 'cadrage', nature: 'jalon', libelle: JALON_COMPREHENSION, resultat: 'v2' }),
  ];
  const flux = montageDuFlux(entrees, { comprehensionId: 'e2' });
  const comprehensions = flux.filter((e) => e.sorte === 'comprehension');
  assert.equal(comprehensions.length, 2);
  assert.deepEqual(
    comprehensions.map((e) => e.sorte === 'comprehension' && e.dernier),
    [false, true],
  );
});

test('le plan rendu a son point, et il ne se replie jamais sous le travail', () => {
  const flux = montageDuFlux([
    entree({ rang: 0, phase: 'cadrage', outil: 'Read', libelle: 'Lecture' }),
    entree({ rang: 1, phase: 'cadrage', nature: 'jalon', libelle: JALON_PLAN_PROPOSE, resultat: '# Plan' }),
    entree({ rang: 2, phase: 'cadrage', outil: 'Read', libelle: 'Lecture' }),
  ]);
  assert.deepEqual(
    flux.map((e) => e.sorte),
    ['phase', 'travail', 'plan', 'travail'],
  );
});

test('le travail de l’agent se replie en un point, sauf ce qui réclame les yeux', () => {
  const flux = montageDuFlux([
    entree({ rang: 0, phase: 'execution', outil: 'Read', libelle: 'Lecture' }),
    entree({ rang: 1, phase: 'execution', outil: 'Bash', libelle: 'Commande : ls' }),
    entree({ rang: 2, phase: 'execution', outil: 'ask_user', libelle: 'Question posée' }),
    entree({ rang: 3, phase: 'execution', outil: 'Edit', libelle: 'Modification' }),
  ]);
  assert.deepEqual(
    flux.map((e) => e.sorte),
    ['phase', 'travail', 'entree', 'travail'],
  );
  const premier = flux[1];
  assert.equal(premier.sorte === 'travail' && premier.entrees.length, 2);
});

test('un rang qui saute dit que des lignes du journal se sont perdues en route', () => {
  const connues = [{ rang: 0 }, { rang: 1 }, { rang: 2 }];
  assert.equal(journalATrou(connues, { rang: 3 }), false, 'la suivante attendue');
  assert.equal(journalATrou(connues, { rang: 1 }), false, 'un doublon n’est pas un trou');
  assert.equal(journalATrou(connues, { rang: 5 }), true, 'deux lignes manquent');
  assert.equal(journalATrou([], { rang: 0 }), false, 'la première ligne d’une carte');
  assert.equal(journalATrou([], { rang: 4 }), true, 'un journal vide qui reçoit la cinquième ligne');
});

test('fin de tour : seul le PASSAGE en tour → hors tour d’un agent de la carte affichée relit son journal', async () => {
  const { finDeTourARelire } = await import('@beluga/shared');
  const carte = 'c1';
  assert.equal(finDeTourARelire({ status: 'running' }, { status: 'done', cardId: carte }, carte), true);
  assert.equal(finDeTourARelire({ status: 'starting' }, { status: 'idle', cardId: carte }, carte), true);
  assert.equal(finDeTourARelire({ status: 'running' }, { status: 'failed', cardId: carte }, carte), true);
  // Pas de passage : un agent déjà fini qu'on réécrit, ou qui démarre.
  assert.equal(finDeTourARelire({ status: 'done' }, { status: 'done', cardId: carte }, carte), false);
  assert.equal(finDeTourARelire({ status: 'idle' }, { status: 'running', cardId: carte }, carte), false);
  assert.equal(finDeTourARelire({ status: 'running' }, { status: 'running', cardId: carte }, carte), false);
  // Une autre carte, aucune carte affichée, un agent jamais vu : rien.
  assert.equal(finDeTourARelire({ status: 'running' }, { status: 'done', cardId: 'c2' }, carte), false);
  assert.equal(finDeTourARelire({ status: 'running' }, { status: 'done', cardId: carte }, null), false);
  assert.equal(finDeTourARelire(undefined, { status: 'done', cardId: carte }, carte), false);
});

test('une compréhension ou un plan garde un plafond large, les résultats d’outils restent à 8 000', () => {
  assert.equal(plafondDuResultat({ nature: 'jalon', libelle: JALON_COMPREHENSION }), PLAFOND_TEXTE_DE_JALON);
  assert.equal(plafondDuResultat({ nature: 'jalon', libelle: JALON_PLAN_PROPOSE }), PLAFOND_TEXTE_DE_JALON);
  assert.equal(plafondDuResultat({ nature: 'jalon', libelle: 'Demande' }), PLAFOND_TEXTE_DE_JALON);
  assert.equal(plafondDuResultat({ nature: 'requete', libelle: JALON_COMPREHENSION }), PLAFOND_RESULTAT);
  assert.equal(plafondDuResultat({ nature: 'requete', libelle: 'Lecture d’un fichier' }), PLAFOND_RESULTAT);
  const texte = 'x'.repeat(12000);
  assert.equal(bornerTexte(texte, plafondDuResultat({ nature: 'jalon', libelle: JALON_COMPREHENSION })), texte);
});

test('un jalon déjà coupé retrouve son texte entier sur la carte, jamais une autre version', () => {
  const entier = 'a'.repeat(9000) + 'FIN';
  const coupe = bornerTexte(entier, PLAFOND_RESULTAT);
  assert.match(coupe, /non conservés dans le journal/);
  assert.equal(texteEntierDuJalon(coupe, entier), entier);
  /* Une version antérieure, différente, reste ce qu'elle était. */
  const autre = 'b'.repeat(9000);
  assert.equal(texteEntierDuJalon(coupe, autre), coupe);
  /* Un texte non coupé ne bouge pas. */
  assert.equal(texteEntierDuJalon('court', 'court et plus'), 'court');
  assert.equal(texteEntierDuJalon(undefined, entier), undefined);
});
