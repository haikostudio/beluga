import { Agent } from '@haikodev/shared';
import * as store from './store.js';
import { createAgent } from './runtime.js';
import { bus } from './bus.js';

/**
 * Le chef d'orchestre (PLAN §5) : un agent permanent par projet, dont la
 * conversation ne meurt jamais.
 *
 * Son modèle est ÉPINGLÉ volontairement sur un modèle rapide et bon marché,
 * PAS hérité du catalogue : sinon il trie des cartes sur le modèle le plus
 * cher (piège Paseo, §30).
 */
export const ORCHESTRATOR_MODEL: Record<string, string> = {
  claude: 'sonnet',
  codex: 'gpt-5.1-codex',
};

export function getOrCreateOrchestrator(projectId: string): Agent {
  const existing = store.getOrchestrator(projectId);
  if (existing) return existing;

  const project = store.getProject(projectId);
  const engine = project?.defaultEngine ?? 'claude';

  const agent = createAgent({
    projectId,
    role: 'orchestrator',
    title: `Chef d'orchestre — ${project?.name ?? 'projet'}`,
    run: {
      engine,
      model: ORCHESTRATOR_MODEL[engine] ?? 'sonnet',
      thinking: 'none',
    },
  });

  const welcome = store.saveMessage({
    id: store.newId(),
    agentId: agent.id,
    role: 'assistant',
    content:
      "Bonjour ! Je suis le chef d'orchestre de ce projet.\n\nPosez-moi une question, je réponds. Demandez une action, je crée la carte correspondante dans « À faire ». Dans un cas ambigu, je vous propose la tâche et vous décidez d'un clic.",
    steps: [],
    proposals: [],
    downloads: [],
    attachments: [],
    streaming: false,
    createdAt: store.now(),
  });
  bus.emit({ type: 'message.upsert', message: welcome });

  return agent;
}
