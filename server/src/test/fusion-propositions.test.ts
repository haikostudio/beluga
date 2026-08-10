import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ClientCommand,
  composerDescriptionFusionnee,
  fusionnerPropositions,
  partiesDUneDescription,
  type TaskProposal,
} from '@haikodev/shared';

const mesure = {
  inputTokens: 100,
  cachedInputTokens: 20,
  outputTokens: 30,
  totalTokens: 150,
  quota5h: 0.1,
  quotaWeekly: 0.02,
  breakdown: {
    haikoDevInstructions: { status: 'measured' as const, characters: 200, note: 'mesuré' },
    cardDescription: { status: 'measured' as const, characters: 100, note: 'mesuré' },
    memoryAndInstructions: { status: 'measured' as const, characters: 300, note: 'mesuré' },
    agentReads: { status: 'unavailable' as const, note: 'indisponible' },
  },
  measuredAt: 1234,
};

function proposition(id: string, titre: string, attendu: string, variante = false): TaskProposal {
  return {
    id,
    title: titre,
    description: [
      `**Constat** : le composant \`web/src/${id}.tsx\` traite aujourd’hui ${titre.toLowerCase()}.`,
      `**Attendu** : ${attendu}`,
      '**Limites** : ne rien créer ni lancer avant le clic final.',
      `**Vérification** : contrôler ${id} sur ordinateur et téléphone.`,
    ].join('\n\n'),
    labels: variante ? ['interface', 'mobile'] : ['interface'],
    attachments: variante ? ['image-a', 'image-b'] : ['image-a'],
    run: variante
      ? { engine: 'codex', model: 'gpt-5.6', thinking: 'high', mode: 'direct' }
      : { engine: 'claude', model: 'claude-opus-5', thinking: 'medium', mode: 'direct' },
    estimate: {
      machineSeconds: variante ? 180 : 120,
      tokens: variante ? 2_000 : 1_000,
      quotaShare: variante ? 0.2 : 0.1,
      seniorHours: variante ? 2 : 1,
      projection: {
        tokens: variante ? 2_500 : 1_500,
        quotaShare: variante ? 0.25 : 0.15,
        assumptions: variante ? ['écran mobile'] : ['écran ordinateur'],
      },
      analysisMeasurement: mesure,
      confidence: variante ? 'low' : 'high',
      summary: variante ? 'Deuxième étape.' : 'Première étape.',
      billingDescription: variante ? 'Suite du chantier.' : 'Début du chantier.',
      failed: false,
      producedAt: 1234,
    },
    analysisContext: variante ? 'Le second flux vit dans b.tsx.' : 'Le premier flux vit dans a.tsx.',
    decision: 'pending',
    sourceProposalIds: [],
  };
}

test('les quatre parties sont relues puis les attendus deviennent des étapes ordonnées', () => {
  const a = proposition('a', 'Préparer le formulaire', 'ajouter les champs requis.');
  const b = proposition('b', 'Envoyer le formulaire', 'envoyer les données après la saisie.', true);
  const description = composerDescriptionFusionnee([a, b]);

  assert.match(description, /\*\*Constat\*\*/);
  assert.match(description, /Étapes successives/);
  assert.match(description, /1\. ajouter les champs requis/);
  assert.match(description, /2\. envoyer les données/);
  assert.match(description, /\*\*Limites\*\*/);
  assert.match(description, /\*\*Vérification\*\*/);
  assert.equal(partiesDUneDescription(description).attendu.includes('envoyer les données'), true);
});

test('la fusion conserve les contenus, déduplique et garde un chiffrage prudent', () => {
  const a = proposition('a', 'Préparer le formulaire', 'ajouter les champs requis.');
  const b = proposition('b', 'Envoyer le formulaire', 'envoyer les données après la saisie.', true);
  const fusion = fusionnerPropositions([a, b], 'fusion-1');

  assert.deepEqual(fusion.sourceProposalIds, ['a', 'b']);
  assert.deepEqual(fusion.labels, ['interface', 'mobile']);
  assert.deepEqual(fusion.attachments, ['image-a', 'image-b']);
  assert.match(fusion.analysisContext ?? '', /a\.tsx/);
  assert.match(fusion.analysisContext ?? '', /b\.tsx/);
  assert.equal(fusion.estimate?.machineSeconds, 300);
  assert.equal(fusion.estimate?.seniorHours, 3);
  assert.equal(fusion.estimate?.confidence, 'low');
  assert.equal(fusion.estimate?.analysisMeasurement?.totalTokens, 150, 'la même mesure de tour est dédupliquée');
  assert.equal(fusion.run?.engine, 'claude', 'le premier choix reste visible');
  assert.match(fusion.avertissement ?? '', /réglages différents/i);
  assert.equal(fusion.decision, 'pending');
});

test('une estimation incomplète force un nouveau chiffrage au lieu de sous-estimer', () => {
  const a = proposition('a', 'Première étape', 'faire la première étape.');
  const b = { ...proposition('b', 'Deuxième étape', 'faire la deuxième étape.'), estimate: undefined };
  assert.equal(fusionnerPropositions([a, b], 'fusion-2').estimate, undefined);
});

test('le protocole n’accepte qu’une fusion de deux sources ou plus', () => {
  const item = { messageId: 'm1', proposalId: 'p1' };
  assert.equal(ClientCommand.safeParse({ type: 'proposal.merge', items: [item] }).success, false);
  assert.equal(
    ClientCommand.safeParse({ type: 'proposal.merge', items: [item, { messageId: 'm2', proposalId: 'p2' }] }).success,
    true,
  );
});
