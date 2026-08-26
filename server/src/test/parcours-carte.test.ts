import test from 'node:test';
import assert from 'node:assert/strict';
import {
  construireParcours,
  mesurerTours,
  nomDuRole,
  totalDuParcours,
  type AgentDuParcours,
  type SourceParcours,
} from '@haikodev/shared';

/*
 * LE PARCOURS D'UNE TÂCHE.
 *
 * Deux interdits à verrouiller, et ils sont le cœur du sujet :
 *   — jamais d'estimation : une étape sans mesure porte la RAISON de son
 *     absence, jamais un zéro ;
 *   — jamais un jeton compté deux fois : une étape = des agents, un tour
 *     appartient à un seul agent.
 */

const ACCUEIL_COMPLET = { instructions: true, competences: true, memoire: true };

function tour(entree: number, cache: number, sortie: number, model?: string) {
  return {
    at: 1_000,
    model,
    inputTokens: entree,
    cachedTokens: cache,
    outputTokens: sortie,
    tokens: entree + cache + sortie,
    seconds: 12,
  };
}

function agent(partiel: Partial<AgentDuParcours> = {}): AgentDuParcours {
  return {
    id: 'a1',
    role: 'task',
    createdAt: 2_000,
    tours: [tour(100, 50, 20, 'claude-sonnet-5')],
    sujetsMemoire: [],
    accueil: ACCUEIL_COMPLET,
    ...partiel,
  };
}

function source(partiel: Partial<SourceParcours> = {}): SourceParcours {
  return {
    origin: 'user',
    createdAt: 1_000,
    autorisee: true,
    colonne: 'running',
    agents: [agent()],
    ...partiel,
  };
}

/* ------------------------------------------------------------------ */
/* La mesure                                                           */
/* ------------------------------------------------------------------ */

test('la mesure additionne entrée, cache et sortie sur tous les tours', () => {
  const mesure = mesurerTours([tour(100, 50, 20, 'claude-sonnet-5'), tour(10, 5, 2, 'claude-sonnet-5')]);
  assert.equal(mesure?.tours, 2);
  assert.equal(mesure?.entree, 110);
  assert.equal(mesure?.cache, 55);
  assert.equal(mesure?.sortie, 22);
  assert.equal(mesure?.total, 187);
});

test('un tour dont le moteur n’a rien rendu ne compte pas comme un tour', () => {
  assert.equal(mesurerTours([tour(0, 0, 0)]), undefined);
});

test('un seul modèle sans tarif et le coût de l’étape disparaît, jamais sous-évalué', () => {
  const mesure = mesurerTours([tour(100, 0, 10, 'claude-sonnet-5'), tour(100, 0, 10, 'modele-inconnu-xyz')]);
  assert.equal(mesure?.cout, undefined);
  assert.equal(mesure?.total, 220, 'les jetons, eux, restent comptés');
});

/* ------------------------------------------------------------------ */
/* Les étapes                                                          */
/* ------------------------------------------------------------------ */

test('une carte née d’une demande directe n’a PAS d’étape de tri', () => {
  const etapes = construireParcours(source({ origin: 'user' }));
  assert.equal(etapes.filter((e) => e.cle === 'tri').length, 0);
});

test('une carte proposée par le chef ouvre le parcours sur le tri', () => {
  const etapes = construireParcours(
    source({ origin: 'agent', tri: { tours: [tour(500, 200, 80, 'claude-sonnet-5')], sujetsMemoire: [] } }),
  );
  assert.equal(etapes[0].cle, 'tri');
  assert.equal(etapes[0].mesure?.total, 780);
});

test('un tri sans tour rattaché DIT pourquoi, et ne montre aucun zéro', () => {
  const etapes = construireParcours(source({ origin: 'agent' }));
  const tri = etapes.find((e) => e.cle === 'tri')!;
  assert.equal(tri.mesure, undefined);
  assert.match(tri.sansMesure!, /pas rattaché/);
});

test('les étapes se suivent dans l’ordre du travail', () => {
  const etapes = construireParcours(
    source({ origin: 'agent', colonne: 'archived', deployedAt: 9_000, archivedAt: 10_000 }),
  );
  assert.deepEqual(
    etapes.map((e) => e.cle),
    ['tri', 'autorisation', 'execution', 'deploiement', 'production'],
  );
});

test('une carte jamais lancée annonce l’exécution comme À VENIR, sans mesure', () => {
  const etapes = construireParcours(source({ colonne: 'planned', agents: [], autorisee: false }));
  const execution = etapes.find((e) => e.cle === 'execution')!;
  assert.equal(execution.etat, 'a-venir');
  assert.equal(execution.mesure, undefined);
  assert.match(execution.sansMesure!, /pas encore été lancée/);
});

test('une carte non autorisée le dit, et rappelle qu’attendre ne coûte rien', () => {
  const etapes = construireParcours(source({ autorisee: false }));
  const autorisation = etapes.find((e) => e.cle === 'autorisation')!;
  assert.equal(autorisation.etat, 'a-venir');
  assert.match(autorisation.sansMesure!, /ne consomme rien/);
});

test('un déploiement sans incident ne prétend à aucun tour de moteur', () => {
  const etapes = construireParcours(source({ colonne: 'archived', deployedAt: 9_000 }));
  const deploiement = etapes.find((e) => e.cle === 'deploiement')!;
  assert.equal(deploiement.mesure, undefined);
  assert.match(deploiement.sansMesure!, /opération git/);
});

/* ------------------------------------------------------------------ */
/* Ce que l'étape est allée chercher                                   */
/* ------------------------------------------------------------------ */

test('l’étape de travail nomme les sujets de mémoire réellement demandés', () => {
  const etapes = construireParcours(source({ agents: [agent({ sujetsMemoire: ['cartes', 'interface'] })] }));
  const execution = etapes.find((e) => e.cle === 'execution')!;
  assert.ok(execution.cherche.some((l) => l.includes('cartes') && l.includes('interface')));
});

test('un accueil allégé se lit comme tel, jamais comme un accueil complet', () => {
  const etapes = construireParcours(
    source({ agents: [agent({ accueil: { instructions: false, competences: true, memoire: false } })] }),
  );
  const execution = etapes.find((e) => e.cle === 'execution')!;
  assert.ok(execution.cherche.some((l) => /accueil allégé/.test(l)));
});

test('la ventilation mesurée du contexte est reprise en caractères, jamais devinée', () => {
  const etapes = construireParcours(
    source({ ventilation: { description: 1_200, memoireEtInstructions: 3_400, consignes: 5_600 } }),
  );
  const execution = etapes.find((e) => e.cle === 'execution')!;
  assert.ok(execution.cherche.some((l) => /description de la carte/.test(l) && /caractères mesurés/.test(l)));
});

test('une ventilation absente n’invente aucune ligne', () => {
  const etapes = construireParcours(source());
  const execution = etapes.find((e) => e.cle === 'execution')!;
  assert.ok(!execution.cherche.some((l) => /caractères mesurés/.test(l)));
});

/* ------------------------------------------------------------------ */
/* Le total                                                            */
/* ------------------------------------------------------------------ */

test('le total ne compte QUE les étapes mesurées, et dit combien manquent', () => {
  const etapes = construireParcours(
    source({ origin: 'agent', colonne: 'archived', deployedAt: 9_000 }),
  );
  const total = totalDuParcours(etapes)!;
  assert.equal(total.total, 170, 'seul le tour de l’agent de travail est mesuré');
  assert.equal(total.etapesMesurees, 1);
  // Un seul VRAI trou : le tri, qui appelle le moteur mais n'est pas rattaché.
  // L'autorisation, le déploiement sans incident et la mise en production
  // n'appellent jamais le moteur : leur silence n'est pas un manque.
  assert.equal(total.etapesSansMesure, 1);
});

test('un geste sans moteur n’est jamais compté comme une mesure manquante', () => {
  const etapes = construireParcours(source({ colonne: 'archived', deployedAt: 9_000 }));
  for (const cle of ['autorisation', 'deploiement', 'production']) {
    const etape = etapes.find((e) => e.cle === cle);
    if (etape) assert.equal(etape.attendMesure, false, `« ${cle} » ne doit pas réclamer de mesure`);
  }
});

test('une étape « à venir » ne compte pas comme un trou : elle n’a rien à mesurer', () => {
  const etapes = construireParcours(source({ autorisee: false }));
  const total = totalDuParcours(etapes)!;
  assert.equal(total.etapesSansMesure, 0);
});

test('aucune mesure du tout : pas de total, plutôt qu’un total à zéro', () => {
  const etapes = construireParcours(source({ colonne: 'planned', agents: [] }));
  assert.equal(totalDuParcours(etapes), undefined);
});

test('deux agents de travail ne comptent jamais deux fois les mêmes jetons', () => {
  const etapes = construireParcours(
    source({
      agents: [
        agent({ id: 'a1', tours: [tour(100, 0, 10, 'claude-sonnet-5')] }),
        agent({ id: 'a2', createdAt: 3_000, tours: [tour(200, 0, 20, 'claude-sonnet-5')] }),
      ],
    }),
  );
  const total = totalDuParcours(etapes)!;
  assert.equal(total.total, 330);
  assert.equal(total.tours, 2);
});

test('les rôles se disent en français', () => {
  assert.equal(nomDuRole('cadrage'), "chef d'orchestre");
  assert.equal(nomDuRole('task'), 'exécution');
  assert.equal(nomDuRole('deploy'), 'publication');
});
