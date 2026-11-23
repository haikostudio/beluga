import assert from 'node:assert/strict';
import test from 'node:test';
import {
  agentCorrespond,
  etatArchive,
  etatDeLAgentEnListe,
  filtreDesAgentsActif,
  passeLeFiltre,
  vientDeRendre,
  type CarteEnListe,
  type LigneDAgent,
} from '@beluga/shared';

const carte = (patch: Partial<CarteEnListe> = {}): CarteEnListe => ({ id: 'c1', column: 'planned', ...patch }) as CarteEnListe;

test('une carte de « Demande » jamais lancée est un brouillon', () => {
  assert.equal(etatDeLAgentEnListe(carte()), 'brouillon');
});

test('le créneau conseillé seul ne lance rien (DEC-034) ; une date posée par un geste, si', () => {
  const s = { asap: false, attempts: 0, restarts: 0 };
  assert.equal(etatDeLAgentEnListe(carte({ scheduling: { ...s, departPrevu: 1, creneauAutomatique: true } })), 'brouillon');
  assert.equal(etatDeLAgentEnListe(carte({ scheduling: { ...s, departPrevu: 1 } })), 'lance');
  assert.equal(etatDeLAgentEnListe(carte({ scheduling: { ...s, asap: true } })), 'lance');
});

test('une demande en file faute de quota est « Lancé »', () => {
  assert.equal(etatDeLAgentEnListe(carte(), { enAttenteDeQuota: true }), 'lance');
});

test('un agent qui tient son tour est « Au travail », même sur une carte rangée', () => {
  assert.equal(etatDeLAgentEnListe(carte({ column: 'planned' }), { auTravail: true }), 'travail');
  assert.equal(etatDeLAgentEnListe(carte({ column: 'running' }), { auTravail: true }), 'travail');
  assert.equal(etatDeLAgentEnListe(carte({ column: 'archived' }), { auTravail: true }), 'travail');
  assert.equal(etatDeLAgentEnListe(carte({ column: 'archived' }), { attendReponse: true }), 'a-vous');
  assert.equal(etatDeLAgentEnListe(carte({ column: 'archived' })), 'archive');
});

test('une question fait « À vous » même tour vivant (DEC-026) ; une décision seulement une fois le travail fini', () => {
  assert.equal(etatDeLAgentEnListe(carte({ column: 'running' }), { attendReponse: true }), 'a-vous');
  assert.equal(etatDeLAgentEnListe(carte({ column: 'planned' }), { questions: 1, decisions: 1 }), 'a-vous');
  // Un geste attendu (compréhension, plan, carte proposée) n'allume plus le jaune (16/11/2026).
  assert.equal(etatDeLAgentEnListe(carte({ column: 'planned' }), { decisions: 1 }), 'brouillon');
  assert.equal(etatDeLAgentEnListe(carte({ column: 'running' }), { auTravail: true, attendReponse: true }), 'a-vous');
  // 13/11/2026 : une carte proposée en chemin n'allume plus le jaune tant que l'agent travaille
  assert.equal(etatDeLAgentEnListe(carte({ column: 'running' }), { auTravail: true, questions: 2, decisions: 2 }), 'travail');
  assert.equal(etatDeLAgentEnListe(carte({ column: 'to_deploy' }), { questions: 1, decisions: 2 }), 'a-vous');
  assert.equal(etatDeLAgentEnListe(carte({ column: 'to_deploy' }), { decisions: 2 }), 'a-deployer');
});

test('ouvrir la carte n’efface pas « À vous » : seule la réponse le fait', () => {
  const lue = carte({ column: 'running', renduA: 10, lastReadAt: 20 });
  assert.equal(etatDeLAgentEnListe(lue, { attendReponse: true }), 'a-vous');
  assert.equal(etatDeLAgentEnListe(lue), 'lance');
});

test('un rendu non lu ne fait pas « À vous » : il garde son état naturel', () => {
  assert.equal(etatDeLAgentEnListe(carte({ column: 'to_deploy', renduA: 10, lastReadAt: 5 })), 'a-deployer');
  assert.equal(etatDeLAgentEnListe(carte({ column: 'planned', renduA: 10, lastReadAt: 5 })), 'brouillon');
});

test('un rendu lu dans « À déployer » attend sa publication', () => {
  assert.equal(etatDeLAgentEnListe(carte({ column: 'to_deploy', renduA: 10, lastReadAt: 20 })), 'a-deployer');
});

test('« Suspendre » laisse la carte en « En cours » : elle est « En pause » (DEC-372)', () => {
  const s = { asap: false, attempts: 0, restarts: 0, suspendu: true, enPause: true };
  assert.equal(etatDeLAgentEnListe(carte({ column: 'running', scheduling: s })), 'en-pause');
});

test('une carte en « En cours » sans tour vivant est « Lancé »', () => {
  assert.equal(etatDeLAgentEnListe(carte({ column: 'running' })), 'lance');
});

test('« Archivé » publiée est « En ligne », sinon « Archivé » — les deux se replient', () => {
  assert.equal(etatDeLAgentEnListe(carte({ column: 'archived', deployedAt: 5 })), 'en-ligne');
  assert.equal(etatDeLAgentEnListe(carte({ column: 'archived' })), 'archive');
  assert.ok(etatArchive('en-ligne') && etatArchive('archive') && !etatArchive('a-deployer'));
});

test('une mère rangée sans date vit par ses filles', () => {
  const mere = carte({
    column: 'archived',
    cartesFilles: [{ projectId: 'p', cardId: 'f' }],
    suiviDesFilles: [{ cardId: 'f', projectId: 'p', etat: 'travail' } as never],
  });
  assert.equal(etatDeLAgentEnListe(mere), 'travail');
  const enQuestion = carte({
    column: 'archived',
    cartesFilles: [{ projectId: 'p', cardId: 'f' }, { projectId: 'p', cardId: 'g' }],
    suiviDesFilles: [
      { cardId: 'f', projectId: 'p', etat: 'travail' } as never,
      { cardId: 'g', projectId: 'p', etat: 'question' } as never,
    ],
  });
  assert.equal(etatDeLAgentEnListe(enQuestion), 'a-vous');
});

test('la recherche trouve par le nom ou la branche, sans accents ni majuscules', () => {
  const c = { id: 'abcdef12-0000', title: 'Le menu du bas du téléphone', brancheChoisie: 'tache/menu-bas-abcdef' };
  assert.ok(agentCorrespond(c, 'TELEPHONE'));
  assert.ok(agentCorrespond(c, 'menu bas'));
  assert.ok(agentCorrespond(c, 'menu-bas-abc'));
  assert.ok(agentCorrespond(c, '  '));
  assert.ok(!agentCorrespond(c, 'kanban'));
});

const ligne = (id: string, activite: number, patch: Partial<LigneDAgent<{ id: string; projectId?: string; carteMereId?: string }>> = {}) => ({
  carte: { id, projectId: 'p1' },
  etat: 'brouillon' as const,
  activite,
  nonLue: false,
  ...patch,
});

test('le filtre lit les états cochés, les non lus et les projets', () => {
  const l = ligne('a', 1, { etat: 'a-vous', nonLue: true });
  assert.ok(!filtreDesAgentsActif({}));
  assert.ok(passeLeFiltre(l, {}));
  assert.ok(passeLeFiltre(l, { etats: ['a-vous', 'travail'] }));
  assert.ok(!passeLeFiltre(l, { etats: ['travail'] }));
  assert.ok(passeLeFiltre(l, { nonLusSeulement: true }));
  assert.ok(!passeLeFiltre({ ...l, nonLue: false }, { nonLusSeulement: true }));
  assert.ok(!passeLeFiltre(l, { projets: ['p2'] }));
});

test('la célébration ne salue qu’un rendu qui avance sous nos yeux, jamais une carte vue au chargement', () => {
  assert.ok(vientDeRendre(0, 10));
  assert.ok(vientDeRendre(10, 20));
  assert.ok(!vientDeRendre(undefined, 10));
  assert.ok(!vientDeRendre(10, 10));
  assert.ok(!vientDeRendre(0, undefined));
});

test('une carte terminée pas encore ouverte est active et verte, même rangée ; ouverte, elle redescend (01/11/2026)', async () => {
  const { familleDeCouleur, ligneActive, termineeNonOuverte, estTacheDeLaColonne } = await import('@beluga/shared');
  const maintenant = Date.UTC(2026, 10, 1);
  const jour = 24 * 60 * 60 * 1000;
  const recente = carte({ column: 'archived', renduA: maintenant - jour, lastReadAt: maintenant - 2 * jour });
  assert.equal(termineeNonOuverte(recente, maintenant), true);
  assert.equal(ligneActive({ etat: 'en-ligne', carte: recente }, maintenant), true);
  assert.equal(familleDeCouleur('en-ligne', termineeNonOuverte(recente, maintenant)), 'pret');
  assert.equal(estTacheDeLaColonne(recente, false, maintenant), true);
  const lue = { ...recente, lastReadAt: maintenant };
  assert.equal(ligneActive({ etat: 'en-ligne', carte: lue }, maintenant), false);
  assert.equal(familleDeCouleur('en-ligne', false), 'repos');
  const vieille = carte({ column: 'archived', renduA: maintenant - 40 * jour });
  assert.equal(termineeNonOuverte(vieille, maintenant), false);
  assert.equal(ligneActive({ etat: 'archive', carte: vieille }, maintenant), false);
  assert.equal(estTacheDeLaColonne(vieille, false, maintenant), false);
});

test('une mère rangée dont une fille travaille est active ; les quatre familles de couleur', async () => {
  const { familleDeCouleur, ligneActive } = await import('@beluga/shared');
  const mere = carte({
    column: 'archived',
    cartesFilles: ['f1'],
    suiviDesFilles: [{ etat: 'travail' }],
  } as unknown as Partial<CarteEnListe>);
  const etat = etatDeLAgentEnListe(mere);
  assert.equal(etat, 'travail');
  assert.equal(ligneActive({ etat, carte: mere }), true);
  for (const e of ['brouillon', 'lance', 'travail', 'en-pause', 'a-vous', 'a-deployer'] as const) {
    assert.equal(ligneActive({ etat: e, carte: {} }), true, e);
  }
  assert.equal(familleDeCouleur('travail'), 'agit');
  assert.equal(familleDeCouleur('lance'), 'agit');
  assert.equal(familleDeCouleur('a-vous'), 'a-vous');
  assert.equal(familleDeCouleur('brouillon'), 'a-vous');
  assert.equal(familleDeCouleur('a-deployer'), 'pret');
  assert.equal(familleDeCouleur('travail', true), 'agit');
  assert.equal(familleDeCouleur('en-pause'), 'repos');
  assert.equal(familleDeCouleur('archive'), 'repos');
});

test('les actives montent au-dessus du trait, chaque groupe dans son ordre', async () => {
  const { separerActives } = await import('@beluga/shared');
  assert.deepEqual(separerActives([1, 2, 3, 4], (n) => n % 2 === 0), { entrees: [2, 4, 1, 3], trait: 2 });
  assert.deepEqual(separerActives([2, 4], (n) => n % 2 === 0), { entrees: [2, 4], trait: null });
  assert.deepEqual(separerActives([1, 3], (n) => n % 2 === 0), { entrees: [1, 3], trait: null });
});

test('la colonne cache les archives tant que « Voir plus » ne les montre pas, jamais une active ni la tâche ouverte', async () => {
  const { entreesDeLaColonne } = await import('@beluga/shared');
  const entrees = [
    { id: 'travail', active: true },
    { id: 'archive-1', active: false },
    { id: 'ouverte', active: false },
    { id: 'archive-2', active: false },
  ];
  const gardee = (e: { id: string; active: boolean }) => e.active || e.id === 'ouverte';
  const cachees = entreesDeLaColonne(entrees, false, gardee);
  assert.deepEqual(cachees.visibles.map((e) => e.id), ['travail', 'ouverte']);
  assert.equal(cachees.cachees, 2);
  const montrees = entreesDeLaColonne(entrees, true, gardee);
  assert.equal(montrees.visibles.length, 4);
  assert.equal(montrees.cachees, 0);
});

test('le jaune est réservé aux questions : un geste de parcours ne compte pas', async () => {
  const { questionsParCarte, alertesParCarte } = await import('@beluga/shared');
  const base = { projectId: 'p', cardId: 'c', poseeA: 1, statut: 'ouverte' } as any;
  const decisions = [
    { ...base, id: 'q', source: 'question-outil', kind: 'question' },
    { ...base, id: 'g', source: 'geste-de-parcours', geste: 'valider-et-lancer', kind: 'validation' },
  ] as any[];
  const alertes = alertesParCarte(decisions);
  const questions = questionsParCarte(decisions);
  assert.ok((questions.c ?? 0) <= (alertes.c ?? 0));
  assert.equal(questionsParCarte([decisions[1]]).c ?? 0, 0, 'un geste à faire n’allume pas le jaune');
});

test('un cadrage en cours se dit « Compréhension » (crayon), un travail « Au travail » (marteau)', async () => {
  const { LIBELLE_ETAT_D_AGENT, familleDeCouleur, ligneActive } = await import('@beluga/shared');
  assert.equal(etatDeLAgentEnListe(carte({ column: 'planned' }), { auTravail: true, auCadrage: true }), 'cadrage');
  assert.equal(etatDeLAgentEnListe(carte({ column: 'running' }), { auTravail: true }), 'travail');
  assert.equal(etatDeLAgentEnListe(carte({ column: 'planned' }), { auTravail: true, auCadrage: true, attendReponse: true }), 'a-vous');
  assert.equal(LIBELLE_ETAT_D_AGENT.cadrage, 'Compréhension');
  assert.equal(familleDeCouleur('cadrage'), 'agit');
  assert.equal(ligneActive({ etat: 'cadrage', carte: {} as any }), true);
});
