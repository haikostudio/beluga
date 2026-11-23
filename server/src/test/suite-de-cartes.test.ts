import test from 'node:test';
import assert from 'node:assert/strict';
import {
  carteDepuisLigne,
  colonneDeLaTeteDeSuite,
  colonnesDeLaCarte,
  consigneDeLEtape,
  Card,
  etapeAEnchainer,
  etapeRetenue,
  etapeRetenueEnFinDeTour,
  etapesALiberer,
  etatDeLaFille,
  pointsDuParcours,
  suiteFinie,
  suiviDUneSuite,
  travailRestant,
  etapeCouranteDeLaSuite,
  type EtapeDeSuiteLue,
  type SuiviDUneFille,
} from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* LES SUITES D'ÉTAPES : une carte globale, des étapes qui partent une   */
/* à une et restent groupées jusqu'à la dernière                         */
/* (`shared/src/suite-de-cartes.ts`).                                    */
/* ------------------------------------------------------------------ */

const etape = (rang: number, etat: SuiviDUneFille['etat'], column = 'planned', depart?: number): EtapeDeSuiteLue => ({
  cardId: `e${rang}`,
  rang,
  column,
  etat,
  ...(depart ? { departDeLaSuiteAt: depart } : {}),
});

test('enchaînement : la première étape non finie, jamais lancée, part — et elle seule', () => {
  assert.equal(etapeAEnchainer([etape(1, 'attente'), etape(2, 'attente'), etape(3, 'attente')]), 'e1');
  // L'ordre du rang fait foi, pas celui de la liste.
  assert.equal(etapeAEnchainer([etape(2, 'attente'), etape(1, 'fait', 'running'), etape(3, 'attente')]), 'e2');
  assert.equal(etapeAEnchainer([etape(1, 'fait', 'running'), etape(2, 'fait', 'running'), etape(3, 'attente')]), 'e3');
});

test('enchaînement : jamais deux étapes au travail, jamais après une étape bloquée', () => {
  assert.equal(etapeAEnchainer([etape(1, 'travail', 'running'), etape(2, 'attente')]), null);
  assert.equal(etapeAEnchainer([etape(1, 'question', 'running'), etape(2, 'attente')]), null);
  assert.equal(etapeAEnchainer([etape(1, 'panne', 'running'), etape(2, 'attente')]), null);
  // Lancée puis retenue par une porte (quota) : l'ordonnanceur la rejouera, la suite ne la relance pas.
  assert.equal(etapeAEnchainer([etape(1, 'fait', 'running'), etape(2, 'attente', 'planned', 1000)]), null);
  // Tout est fini : rien à lancer.
  assert.equal(etapeAEnchainer([etape(1, 'fait', 'to_deploy'), etape(2, 'fait', 'to_deploy')]), null);
});

test('rétention : seule une étape de suite qui irait en « À déployer » reste dans le groupe', () => {
  assert.equal(etapeRetenueEnFinDeTour({ rangDansLaSuite: 2 }, 'to_deploy'), true);
  assert.equal(etapeRetenueEnFinDeTour({ rangDansLaSuite: 2 }, 'planned'), false);
  assert.equal(etapeRetenueEnFinDeTour({ rangDansLaSuite: 2 }, null), false);
  assert.equal(etapeRetenueEnFinDeTour({}, 'to_deploy'), false);
  assert.equal(etapeRetenue({ column: 'running', rangDansLaSuite: 1, etapeFinieAt: 5 }), true);
  assert.equal(etapeRetenue({ column: 'running', rangDansLaSuite: 1 }), false);
  assert.equal(etapeRetenue({ column: 'to_deploy', rangDansLaSuite: 1, etapeFinieAt: 5 }), false);
  assert.equal(etapeRetenue({ column: 'running', etapeFinieAt: 5 }), false);
});

test('la carte globale : en cours jusqu’à la dernière étape, puis « À déployer », puis « Archivé »', () => {
  const e = (column: string, etat: SuiviDUneFille['etat']) => ({ column, etat });
  // Pas encore lancée : elle ne bouge pas.
  assert.equal(colonneDeLaTeteDeSuite('planned', [e('planned', 'attente')]), null);
  assert.equal(colonneDeLaTeteDeSuite('running', [e('running', 'fait'), e('planned', 'attente')]), 'running');
  assert.equal(colonneDeLaTeteDeSuite('running', [e('running', 'fait'), e('running', 'fait')]), 'to_deploy');
  assert.equal(colonneDeLaTeteDeSuite('to_deploy', [e('archived', 'fait'), e('to_deploy', 'fait')]), 'to_deploy');
  assert.equal(colonneDeLaTeteDeSuite('to_deploy', [e('archived', 'fait'), e('archived', 'fait')]), 'archived');
  assert.equal(suiteFinie([]), false);
});

test('libération : les étapes retenues ne partent qu’ensemble, quand toutes ont fini', () => {
  const cartes = [
    { id: 'a', column: 'running', rangDansLaSuite: 1, etapeFinieAt: 1 },
    { id: 'b', column: 'running', rangDansLaSuite: 2, etapeFinieAt: 2 },
  ];
  assert.deepEqual(etapesALiberer(cartes, [{ etat: 'fait' }, { etat: 'travail' }]), []);
  assert.deepEqual(
    etapesALiberer(cartes, [{ etat: 'fait' }, { etat: 'fait' }]).map((c) => c.id),
    ['a', 'b'],
  );
});

test('le relevé d’une étape retenue : faite, sauf si un nouveau tour la tient', () => {
  const carte = {
    id: 'f',
    projectId: 'p',
    column: 'running' as const,
    rangDansLaSuite: 2,
    title: 'Brancher l’écran',
    etapeFinieAt: 10,
    codeDejaEnregistre: false,
  };
  const fait = etatDeLaFille({ carte, agent: { status: 'done' } as never, projet: 'P' });
  assert.equal(fait.etat, 'fait');
  assert.equal(fait.rang, 2);
  assert.equal(fait.titre, 'Brancher l’écran');
  assert.equal(etatDeLaFille({ carte, agent: { status: 'running' } as never, projet: 'P' }).etat, 'travail');
  assert.equal(
    etatDeLaFille({ carte, agent: { status: 'done', attendReponse: true } as never, projet: 'P' }).etat,
    'question',
  );
  assert.equal(etatDeLaFille({ carte, agent: { status: 'failed' } as never, projet: 'P' }).etat, 'panne');
  // Une fille de projet réuni n'a ni rang ni titre dans son relevé.
  const reunie = etatDeLaFille({ carte: { id: 'g', projectId: 'p', column: 'planned', codeDejaEnregistre: false }, projet: 'P' });
  assert.equal(reunie.rang, undefined);
  assert.equal(reunie.titre, undefined);
});

test('la consigne d’une étape dit ce qui précède, ce qui suit, et rien de plus', () => {
  const titres = ['Modèle', 'Écran', 'Contrôles'];
  const premiere = consigneDeLEtape(1, titres, 'Refonte');
  assert.match(premiere, /ÉTAPE 1 SUR 3 de la suite « Refonte »/);
  assert.match(premiere, /première étape/);
  assert.match(premiere, /2\. Écran ; 3\. Contrôles/);
  const milieu = consigneDeLEtape(2, titres, 'Refonte');
  assert.match(milieu, /1\. Modèle\) sont terminées/);
  assert.match(milieu, /3\. Contrôles/);
  assert.match(consigneDeLEtape(3, titres, 'Refonte'), /dernière étape/);
});

test('le relevé d’une carte globale parle d’étapes dès qu’une fille a un rang', () => {
  assert.equal(suiviDUneSuite([{ rang: 1 }]), true);
  assert.equal(suiviDUneSuite([{}]), false);
});

test('les champs d’une suite sont de vraies colonnes, et une carte ordinaire se relit à l’identique', () => {
  const base = Card.parse({
    id: 'c1',
    projectId: 'p',
    title: 'Étape',
    column: 'running',
    position: 1,
    run: { engine: 'claude' },
    createdAt: 1,
    updatedAt: 1,
  });
  const ordinaire = colonnesDeLaCarte(base);
  assert.equal(ordinaire.tete_de_suite, null);
  assert.equal(ordinaire.rang_dans_la_suite, null);
  const relue = carteDepuisLigne({ ...ordinaire } as never);
  assert.equal('rangDansLaSuite' in relue, false);
  assert.equal('teteDeSuite' in relue, false);

  const fille = { ...base, rangDansLaSuite: 2, etapeFinieAt: 50, departDeLaSuiteAt: 40 };
  const colonnes = colonnesDeLaCarte(fille);
  assert.equal(colonnes.rang_dans_la_suite, 2);
  assert.equal(colonnes.etape_finie_at, 50);
  assert.doesNotMatch(colonnes.data, /rangDansLaSuite|etapeFinieAt|departDeLaSuiteAt/);
  const filleRelue = carteDepuisLigne({ ...colonnes } as never);
  assert.equal(filleRelue.rangDansLaSuite, 2);
  assert.equal(filleRelue.etapeFinieAt, 50);
  assert.equal(filleRelue.departDeLaSuiteAt, 40);
  const tete = carteDepuisLigne({ ...colonnesDeLaCarte({ ...base, teteDeSuite: true }) } as never);
  assert.equal(tete.teteDeSuite, true);
});

test('le fil de la carte globale parle d’étapes, dans l’ordre', () => {
  const suivi: SuiviDUneFille[] = [
    { projectId: 'p', cardId: 'b', projet: 'P', colonne: 'planned', etat: 'attente', rang: 2, titre: 'Deux' },
    { projectId: 'p', cardId: 'a', projet: 'P', colonne: 'running', etat: 'travail', rang: 1, titre: 'Un' },
  ];
  const ctx = {
    chapitre: 'rapport' as const,
    colonne: 'running' as const,
    tourEnCours: false,
    parcours: { comprehension: { texte: 'Compris.', at: 1 } } as never,
  };
  const points = pointsDuParcours([], { ...ctx, suiviDesFilles: suivi } as never);
  const travail = points.find((p) => p.etape === 'travail');
  assert.ok(travail, 'le point « Travail » existe');
  assert.deepEqual(
    travail.filles?.map((f) => f.cardId),
    ['a', 'b'],
  );
  assert.match(travail.phrase ?? '', /étapes partent une à une/);
});

test('le bas de la carte globale parle d’étapes, et dit que la suite attend une étape bloquée', () => {
  const filles: Record<string, unknown> = { enTravail: 0, enQuestion: 0, enPanne: 0, enAttente: 0, faites: 0, total: 0, suite: true };
  const lire = (f: Record<string, unknown>) => travailRestant({ colonne: 'running', filles: { ...filles, ...f } } as never, Date.now());
  assert.equal(lire({ enTravail: 1 })?.etape, 'Une étape au travail');
  assert.match(lire({ enQuestion: 1 })?.attente ?? '', /la suite attend/);
  assert.match(lire({ enPanne: 1 })?.attente ?? '', /la suite attend/);
  assert.equal(lire({ enAttente: 1 })?.etape, 'Une étape en attente de départ');
  // La barre dit l'étape où en est la suite, sur le total.
  assert.equal(lire({ enTravail: 1, etape: { rang: 2, total: 3 } })?.etape, 'Étape 2/3 au travail');
  assert.deepEqual(etapeCouranteDeLaSuite([{ etat: 'fait', rang: 1 }, { etat: 'travail', rang: 2 }, { etat: 'attente', rang: 3 }]), { rang: 2, total: 3 });
  assert.equal(etapeCouranteDeLaSuite([{ etat: 'fait', rang: 1 }]), null);
  // Une mère de projets réunis garde ses phrases.
  assert.equal(travailRestant({ colonne: 'running', filles: { ...filles, suite: false, enTravail: 1 } } as never, Date.now())?.etape, 'Un projet au travail');
});
