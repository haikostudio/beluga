import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  finaliserAnalyseDeProposition,
  heritageAnalyseDeProposition,
  contexteHeritePourExecution,
  RAISON_ATTENTE_LANCEMENT,
} from '@haikodev/shared';

/* Une base jetable : le test suit réellement proposition → carte → planification. */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'analyse-heritee-chef-'));
process.env.HAIKODEV_DATA = bacASable;

const store = await import('../store.js');
const { callTool, createCard, TOOL_DEFS } = await import('../tools.js');
const { validerCarte } = await import('../scheduler.js');

const DESCRIPTION = [
  'Constat : `server/src/ws.ts` déclenche actuellement une analyse après chaque validation.',
  'Attendu : une proposition déjà chiffrée rejoint directement la file de lancement.',
  "Limites : ne changer ni les branches, ni la publication, ni le geste manuel de lancement.",
  'Vérification : contrôler le trajet proposition, validation puis exécution sans second chiffrage.',
].join('\n');

const ANALYSE = {
  machineSeconds: 420,
  seniorHours: 1.5,
  projection: {
    tokens: 20_000,
    quotaShare: 0.02,
    formula: 'analyse × ampleur',
    assumptions: ['deux fichiers et un test ciblé'],
  },
  confidence: 'high',
  summary: 'Réutiliser le travail du chef.',
  billingTitle: 'Réutilisation du chiffrage',
  billingDescription: 'Transmission du chiffrage et du contexte.',
  context: 'Le déclenchement est dans ws.ts ; conserver le clic manuel et rejouer npm test.',
};

function projetDEssai() {
  return store.saveProject({
    id: store.newId(),
    name: 'Projet d’essai',
    path: bacASable,
    defaultEngine: 'claude',
    isSelf: false,
    archived: false,
    createdAt: store.now(),
    updatedAt: store.now(),
  } as any);
}

/*
 * Le chef d'orchestre ne chiffre PLUS : il trie, et l'étude appartient à la
 * carte. Le champ reste offert — un agent qui vient réellement d'analyser y
 * transmet son relais — mais il n'est plus exigé ; ce qui l'est, c'est le
 * NIVEAU de l'agent qui exécutera.
 */
test('les outils du chef exigent le niveau, et offrent encore le relais d’analyse', () => {
  for (const nom of ['board_create_card', 'propose_task']) {
    const outil = TOOL_DEFS.find((item) => item.name === nom)!;
    const schema = outil.inputSchema as any;
    assert.ok(schema.required.includes('niveau'), `${nom} doit demander le niveau`);
    assert.ok(!schema.required.includes('analysis'), `${nom} ne doit plus exiger l’analyse`);
    assert.ok(schema.properties.analysis.properties.context, `${nom} doit offrir le relais`);
  }
});

test('la proposition transporte les chiffres futurs, mais aucune mesure inventée', async () => {
  const projet = projetDEssai();
  const resultat = await callTool(
    { projectId: projet.id, agentId: 'chef-1', role: 'orchestrator' } as any,
    'board_create_card',
    { title: 'Réutiliser l’analyse du chef', description: DESCRIPTION, analysis: ANALYSE },
  );

  assert.equal(resultat.ok, true);
  assert.equal(resultat.proposal?.estimate?.machineSeconds, 420);
  assert.equal(resultat.proposal?.estimate?.seniorHours, 1.5);
  assert.equal(resultat.proposal?.estimate?.analysisMeasurement, undefined);
  assert.match(resultat.proposal?.analysisContext ?? '', /ws\.ts/);
});

test('la mesure réelle du tour complète la proposition puis suit la carte', async () => {
  const projet = projetDEssai();
  const resultat = await callTool(
    { projectId: projet.id, agentId: 'chef-2', role: 'orchestrator' } as any,
    'board_create_card',
    { title: 'Réutiliser l’analyse du chef', description: DESCRIPTION, analysis: ANALYSE },
  );
  const proposal = finaliserAnalyseDeProposition(
    resultat.proposal!,
    {
      usage: { inputTokens: 700, cachedInputTokens: 300, outputTokens: 120 },
      quota: { quota5h: 0.4, quotaWeekly: 0.1 },
      composition: {
        promptCharacters: 4_000,
        systemPromptCharacters: 2_000,
        cardDescriptionCharacters: 0,
        memoryAndInstructionsCharacters: 1_000,
      },
    },
    1234,
  );

  const heritage = heritageAnalyseDeProposition(proposal, proposal.title, proposal.description);
  const card = createCard(projet.id, {
    title: proposal.title,
    description: proposal.description,
    origin: 'agent',
    ...heritage,
  });
  // La carte NAÎT dans « Planifié », déjà chiffrée par le chef : il n'y a plus
  // de colonne à traverser, seulement une raison d'attente à écrire.
  const validee = store.getCard(card.id)!;

  assert.equal(validee.estimate?.analysisMeasurement?.totalTokens, 1_120);
  assert.equal(validee.estimate?.producedAt, 1234);
  assert.match(contexteHeritePourExecution(validee) ?? '', /ne recommence pas/);
  assert.equal(validerCarte(validee.id).ok, true);

  const planifiee = store.getCard(validee.id)!;
  assert.equal(planifiee.column, 'planned');
  assert.equal(planifiee.scheduling?.waitingReason, RAISON_ATTENTE_LANCEMENT);
  assert.equal(store.getLastAgentByCard(validee.id), null, 'aucun second agent d’analyse ne doit naître');
});

test('une édition du sujet ou une carte ordinaire garde le chiffrage habituel', async () => {
  const projet = projetDEssai();
  const proposal = {
    title: 'Titre initial',
    description: DESCRIPTION,
    estimate: { machineSeconds: 300, failed: false },
    analysisContext: 'Contexte initial',
  } as any;
  assert.deepEqual(heritageAnalyseDeProposition(proposal, 'Titre changé', DESCRIPTION), {
    estimate: undefined,
    analysisContext: undefined,
  });

  const heritee = createCard(projet.id, {
    title: proposal.title,
    description: proposal.description,
    estimate: proposal.estimate,
    analysisContext: proposal.analysisContext,
  });
  await callTool(
    { projectId: projet.id, agentId: 'chef-3', role: 'orchestrator' } as any,
    'board_update_card',
    { cardId: heritee.id, description: `${DESCRIPTION}\nPrécision nouvelle.` },
  );
  assert.equal(store.getCard(heritee.id)?.estimate, undefined, 'modifier la carte invalide son ancien chiffrage');
  assert.equal(store.getCard(heritee.id)?.analysisContext, undefined);

  // Une carte SANS chiffrage du chef suit le même chemin : elle monte en
  // « Planifié » et y attend son lancement, sans chiffres et sans rien envoyer
  // au moteur — c'est l'agent d'exécution qui chiffrera.
  const ordinaire = createCard(projet.id, { title: 'Carte ordinaire', description: DESCRIPTION });
  // Avant la validation, rien ne l'annonce en attente de lancement : elle
  // attend d'abord qu'on autorise sa dépense.
  assert.equal(store.getCard(ordinaire.id)?.scheduling?.waitingReason, undefined);
  assert.equal(validerCarte(ordinaire.id).ok, true);
  const validee = store.getCard(ordinaire.id)!;
  assert.equal(validee.column, 'planned');
  assert.equal(validee.scheduling?.waitingReason, RAISON_ATTENTE_LANCEMENT);
  assert.equal(validee.estimate, undefined, 'aucun chiffrage n’est fabriqué avant le lancement');
  assert.equal(store.getLastAgentByCard(ordinaire.id), null, 'aucun agent ne naît à la validation');
});
