import { Agent } from '@haikodev/shared';
import * as store from './store.js';
import { createAgent } from './runtime.js';
import { bus } from './bus.js';
import { listEngines } from './engines/index.js';
import { orchestratorChoice, resolveModel } from './engines/catalog.js';

/**
 * Le chef d'orchestre (PLAN §5) : un agent permanent par projet, dont la
 * conversation ne meurt jamais.
 *
 * Son modèle est ÉPINGLÉ volontairement sur un modèle rapide et bon marché,
 * PAS hérité du catalogue : sinon il trie des cartes sur le modèle le plus
 * cher (piège Paseo, §30). Depuis qu'il ne fait plus que trier — carte courte
 * et niveau d'exécution, sans lire le projet —, ce modèle est Haiku 4.5 sous
 * Claude (`orchestratorModel`, `engines/catalog.ts`).
 */
export async function getOrCreateOrchestrator(projectId: string): Promise<Agent> {
  const engines = await listEngines();
  const existing = store.getOrchestrator(projectId);

  if (existing) {
    // Un réglage hérité peut nommer un modèle qui n'existe plus : on le
    // ramène vers un modèle réel, sinon l'interface affiche autre chose que
    // ce qui tourne vraiment.
    const engine = engines.find((e) => e.id === existing.run.engine);
    const resolved = resolveModel(engine?.models ?? [], existing.run.model);
    if (resolved && resolved !== existing.run.model) {
      const repaired = store.saveAgent({ ...existing, run: { ...existing.run, model: resolved } });
      bus.emit({ type: 'agent.upsert', agent: repaired });
      return repaired;
    }
    return existing;
  }

  const project = store.getProject(projectId);
  const settings = store.getSettings();

  // Un réglage déjà choisi pour un chef d'orchestre l'emporte : on le retient
  // d'un projet à l'autre. Sans réglage retenu, on retombe sur le modèle épinglé.
  const memorisedEngine = engines.find((e) => e.id === settings.orchestratorEngine);
  const engineId = memorisedEngine?.id ?? project?.defaultEngine ?? 'claude';
  const engine = engines.find((e) => e.id === engineId) ?? engines[0];

  // Le modèle retenu peut avoir disparu du catalogue : on le ramène vers un
  // modèle réel, sinon l'interface afficherait autre chose que ce qui tourne.
  const memorisedModel = memorisedEngine && settings.orchestratorModel
    ? resolveModel(engine?.models ?? [], settings.orchestratorModel)
    : undefined;
  const { model, thinking } = orchestratorChoice(
    engine?.id ?? 'claude',
    engine?.models ?? [],
    memorisedModel,
    settings.orchestratorThinking,
  );

  const agent = createAgent({
    projectId,
    role: 'orchestrator',
    title: `Chef d'orchestre — ${project?.name ?? 'projet'}`,
    run: { engine: engineId, model, thinking },
  });

  const welcome = store.saveMessage({
    id: store.newId(),
    agentId: agent.id,
    role: 'assistant',
    content:
      "Bonjour ! Je suis le chef d'orchestre de ce projet.\n\nPosez-moi une question, je réponds. Demandez une action, je vous propose une carte courte — la demande reformulée, et le niveau de l'agent qui l'exécutera : léger, standard ou approfondi. Elle n'entre dans « Planifié » qu'après votre clic, et c'est là seulement que le projet est étudié.",
    steps: [],
    todos: [],
    proposals: [],
    questions: [],
    downloads: [],
    attachments: [],
    streaming: false,
    plan: false,
    createdAt: store.now(),
  });
  bus.emit({ type: 'message.upsert', message: welcome });

  return agent;
}
