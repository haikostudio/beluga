import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DETAIL_ETAPE_MAX,
  LIBELLE_ETAT_TACHE,
  annonceDeHeurts,
  avecEtatDeTache,
  bilanDuLotEntierEcarte,
  cartesIntrouvables,
  estUnEnregistrement,
  planDeRapatriement,
  raisonDeLAbsence,
  raisonDeLaNonArrivee,
  detailDeLEtape,
  documentRecollable,
  lotMisEnLigne,
  mentionDuRecollage,
  natureDeLEtat,
  ordreDeFusion,
  recollerLesDeuxIntentions,
  resumeDuLot,
  selectionSansHeurts,
  type TacheDuLot,
} from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* LA FUSION DU LOT : dans quel ordre, ce qui s'écrit                   */
/* ------------------------------------------------------------------ */

/*
 * Les règles nées de l'audit du 18/08/2026
 * (`docs/audit-fusion-deploiement.md`). Toutes PURES : ni base, ni disque, ni
 * git — des listes, rien d'autre.
 */

/* 1. L'ordre de fusion ------------------------------------------------ */

test('les branches sans heurt passent devant, chacune gardant sa place', () => {
  const lot = [
    { cardId: 'a', heurte: true },
    { cardId: 'b', heurte: false },
    { cardId: 'c', heurte: true },
    { cardId: 'd', heurte: false },
  ];
  assert.deepEqual(
    ordreDeFusion(lot).map((b) => b.cardId),
    ['b', 'd', 'a', 'c'],
  );
});

test('sans prévision de heurt, l’ordre d’origine ne bouge pas', () => {
  const lot = [
    { cardId: 'a', heurte: false },
    { cardId: 'b', heurte: false },
  ];
  assert.deepEqual(
    ordreDeFusion(lot).map((b) => b.cardId),
    ['a', 'b'],
  );
});

/* 2. Le détail d'une étape -------------------------------------------- */

test('le détail s’ajoute, sans recopier ce qui y est déjà', () => {
  assert.equal(detailDeLEtape('', 'a'), 'a');
  assert.equal(detailDeLEtape('a', 'b'), 'a\nb');
  assert.equal(detailDeLEtape('a\nb', ''), 'a\nb');
});

test('un détail trop long garde ses DEUX bouts et dit ce qui manque', () => {
  const tete = 'PREMIÈRE BRANCHE';
  const queue = 'DERNIÈRE BRANCHE';
  const long = `${tete}${'x'.repeat(DETAIL_ETAPE_MAX * 2)}${queue}`;
  const rendu = detailDeLEtape('', long);
  assert.ok(rendu.length <= DETAIL_ETAPE_MAX);
  assert.ok(rendu.startsWith(tete), 'la tête du détail est perdue');
  assert.ok(rendu.endsWith(queue), 'la fin du détail est perdue');
  assert.match(rendu, /milieu a été retiré/);
});

/* 3. Prévenir avant de lancer un gros lot ------------------------------ */

test('l’annonce ne paraît que si elle apprend quelque chose', () => {
  assert.equal(annonceDeHeurts(0, 10), null);
  assert.equal(annonceDeHeurts(1, 1), null);
  assert.match(annonceDeHeurts(3, 10) ?? '', /3 tâches sur 10 se heurtent/);
  assert.match(annonceDeHeurts(1, 4) ?? '', /1 tâche sur 4 se heurte/);
});

test('publier en deux fois ne garde que les tâches qui ne heurtent rien', () => {
  const lot = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual([...selectionSansHeurts(lot, ['b'])], ['a', 'c']);
  assert.deepEqual([...selectionSansHeurts(lot, [])], ['a', 'b', 'c']);
  assert.equal(selectionSansHeurts(lot, ['a', 'b', 'c']).size, 0);
});

/* 4. Les heurts de DOCUMENTATION se recollent sans moteur -------------- */

test('la liste des documents recollables est FERMÉE : jamais du code', () => {
  assert.ok(documentRecollable('CLAUDE.md'));
  assert.ok(documentRecollable('MEMOIRE.md'));
  assert.ok(documentRecollable('docs/memoire/quotas.md'));
  assert.ok(documentRecollable('docs/regles/publication.md'));
  assert.ok(documentRecollable('./docs/instructions-en-attente.md'));
  // Du code, un réglage, une prose dont l'ordre a un sens : l'agent tranche.
  assert.equal(documentRecollable('server/src/ws.ts'), false);
  assert.equal(documentRecollable('web/src/styles.css'), false);
  assert.equal(documentRecollable('README.md'), false);
  assert.equal(documentRecollable('docs/plans/plan.md'), false);
  assert.equal(documentRecollable('package.json'), false);
});


test('recoller garde les DEUX intentions, celle d’accueil d’abord', () => {
  const texte = [
    '# Sommaire',
    '<<<<<<< HEAD',
    '- carte A',
    '=======',
    '- carte B',
    '>>>>>>> tache/b',
    'fin',
  ].join('\n');
  assert.equal(recollerLesDeuxIntentions(texte), '# Sommaire\n- carte A\n- carte B\nfin');
});

test('une ligne écrite des DEUX côtés n’apparaît pas deux fois', () => {
  const texte = ['<<<<<<< HEAD', '- commun', '- carte A', '=======', '- commun', '- carte B', '>>>>>>> tache/b'].join(
    '\n',
  );
  assert.equal(recollerLesDeuxIntentions(texte), '- commun\n- carte A\n- carte B');
});

test('le style « diff3 » : l’ancêtre commun est jeté, il n’est l’intention de personne', () => {
  const texte = [
    '<<<<<<< HEAD',
    '- carte A',
    '||||||| base',
    '- ancien',
    '=======',
    '- carte B',
    '>>>>>>> tache/b',
  ].join('\n');
  assert.equal(recollerLesDeuxIntentions(texte), '- carte A\n- carte B');
});

test('plusieurs blocs dans le même fichier se recollent tous', () => {
  const texte = [
    '<<<<<<< HEAD',
    'a1',
    '=======',
    'b1',
    '>>>>>>> t',
    'milieu',
    '<<<<<<< HEAD',
    'a2',
    '=======',
    'b2',
    '>>>>>>> t',
  ].join('\n');
  assert.equal(recollerLesDeuxIntentions(texte), 'a1\nb1\nmilieu\na2\nb2');
});

test('on ne bricole JAMAIS un texte qu’on ne comprend pas', () => {
  // Rien à recoller : aucun marqueur.
  assert.equal(recollerLesDeuxIntentions('# Sommaire\n- carte A'), null);
  // Un marqueur ouvert et jamais refermé.
  assert.equal(recollerLesDeuxIntentions('<<<<<<< HEAD\n- carte A\n=======\n- carte B'), null);
  // Un conflit dans un conflit.
  assert.equal(
    recollerLesDeuxIntentions('<<<<<<< HEAD\na\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> t\n=======\nd\n>>>>>>> t'),
    null,
  );
  // Une fin sans début.
  assert.equal(recollerLesDeuxIntentions('- carte A\n>>>>>>> tache/b'), null);
});

test('le recollage se DIT au fil, et il dit qu’aucun agent n’a été appelé', () => {
  assert.match(mentionDuRecollage(['CLAUDE.md']), /CLAUDE\.md/);
  assert.match(mentionDuRecollage(['CLAUDE.md']), /sans agent/);
  assert.match(mentionDuRecollage(['CLAUDE.md', 'MEMOIRE.md']), /2 fichiers de documentation/);
});

/* 5. Où en est chaque tâche du lot ------------------------------------- */

const LOT: TacheDuLot[] = [
  { cardId: 'a', titre: 'Carte A', etat: 'fusionnee' },
  { cardId: 'b', titre: 'Carte B', etat: 'conflit' },
  { cardId: 'c', titre: 'Carte C', etat: 'attente' },
  { cardId: 'd', titre: 'Carte D', etat: 'ecartee' },
];

test('chaque état a son libellé en français simple, et sa nature', () => {
  for (const etat of Object.keys(LIBELLE_ETAT_TACHE) as (keyof typeof LIBELLE_ETAT_TACHE)[]) {
    assert.ok(LIBELLE_ETAT_TACHE[etat].length > 2, `l’état ${etat} n’a pas de libellé`);
  }
  assert.equal(natureDeLEtat('attente'), 'attente');
  assert.equal(natureDeLEtat('conflit'), 'encours');
  assert.equal(natureDeLEtat('fusion'), 'encours');
  assert.equal(natureDeLEtat('recollee'), 'fait');
  assert.equal(natureDeLEtat('en-ligne'), 'fait');
  assert.equal(natureDeLEtat('ecartee'), 'ecart');
  assert.equal(natureDeLEtat('absente'), 'ecart');
});

test('le résumé du lot compte ce que la liste montre', () => {
  assert.equal(resumeDuLot(LOT), '1 passée · 1 en cours · 1 en attente · 1 écartée');
  // Un lot d'une tâche se lit tout seul dans la liste juste dessous.
  assert.equal(resumeDuLot([LOT[0]]), '');
});

test('poser un état ne touche QUE sa tâche', () => {
  const apres = avecEtatDeTache(LOT, 'c', 'fusionnee');
  assert.equal(apres[2].etat, 'fusionnee');
  assert.equal(apres[0].etat, 'fusionnee');
  assert.equal(apres[1].etat, 'conflit');
  // Une carte inconnue ne casse rien : la fusion ne s'arrête pas pour ça.
  assert.deepEqual(avecEtatDeTache(LOT, 'inconnue', 'fusionnee'), LOT);
});

test('la mise en ligne ne ment pas sur ce qui a été écarté', () => {
  const apres = lotMisEnLigne(LOT);
  assert.equal(apres[0].etat, 'en-ligne');
  assert.equal(apres[1].etat, 'en-ligne');
  assert.equal(apres[2].etat, 'en-ligne');
  assert.equal(apres[3].etat, 'ecartee', 'une carte écartée est restée dans « À déployer »');
});

/* 7. Une carte n'est archivée que si son travail est PROUVÉ arrivé ------ */

test('le rapatriement : le distant seul crée la branche, en avance il l’avance, sinon la locale fait foi', () => {
  assert.equal(planDeRapatriement({ locale: null, distante: null }), 'introuvable');
  assert.equal(planDeRapatriement({ locale: '', distante: 'abc1234' }), 'creer');
  assert.equal(planDeRapatriement({ locale: 'abc1234', distante: 'def5678', localeEnRetard: true }), 'avancer');
  // Une locale en avance, ou qui a divergé, garde la main : c'est elle que l'agent a écrite ici.
  assert.equal(planDeRapatriement({ locale: 'abc1234', distante: 'def5678', localeEnRetard: false }), 'locale');
  assert.equal(planDeRapatriement({ locale: 'abc1234', distante: 'abc1234', localeEnRetard: true }), 'locale');
  assert.equal(planDeRapatriement({ locale: 'abc1234' }), 'locale');
});

test('un enregistrement git se reconnaît, le texte d’erreur d’un dépôt sans distant non', () => {
  assert.ok(estUnEnregistrement('0123456789abcdef0123456789abcdef01234567\n'));
  assert.ok(!estUnEnregistrement('fatal: ambiguous argument'));
  assert.ok(!estUnEnregistrement(''));
  assert.ok(!estUnEnregistrement(undefined));
});

test('seule une carte introuvable dans TOUS les dépôts est jugée introuvable', () => {
  const cartes = [
    { cardId: 'trouvee', branche: 'tache/a' },
    { cardId: 'nulle-part', branche: 'tache/b' },
    { cardId: 'sans-branche' },
    { cardId: 'deja-ecartee', branche: 'tache/c' },
  ];
  assert.deepEqual(cartesIntrouvables(cartes, new Set(['trouvee']), new Set(['deja-ecartee'])), ['nulle-part']);
});

test('les raisons d’écartement disent que rien n’a été mis en ligne, et nomment la branche', () => {
  assert.match(raisonDeLAbsence('tache/x'), /tache\/x.*introuvable.*GitHub/);
  assert.match(raisonDeLaNonArrivee('tache/x', 'dev'), /tache\/x.*pas dans dev/);
});

test('un lot entièrement écarté dit SA cause : introuvable, conflit, ou les deux', () => {
  assert.match(bilanDuLotEntierEcarte([{ etat: 'absente' }]).titre, /aucune carte du lot n’a été trouvé/i);
  assert.match(bilanDuLotEntierEcarte([{ etat: 'ecartee' }]).titre, /en conflit/);
  assert.match(bilanDuLotEntierEcarte([{ etat: 'absente' }, { etat: 'ecartee' }]).titre, /introuvables ou en conflit/);
});
