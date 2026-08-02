import { EngineId, EngineInfo } from '@haikodev/shared';
import { EngineAdapter } from './types.js';
import { claudeAdapter } from './claude.js';
import { codexAdapter } from './codex.js';

export * from './types.js';

export const ADAPTERS: Record<EngineId, EngineAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
};

export function adapterFor(engine: EngineId | string | undefined): EngineAdapter {
  if (engine === 'codex') return codexAdapter;
  return claudeAdapter;
}

let cache: { at: number; engines: EngineInfo[] } | null = null;

/** Les listes viennent du serveur, jamais d'une liste écrite en dur côté client (PLAN §14). */
export async function listEngines(force = false): Promise<EngineInfo[]> {
  if (!force && cache && Date.now() - cache.at < 5 * 60 * 1000) return cache.engines;
  const engines: EngineInfo[] = [];
  for (const adapter of [claudeAdapter, codexAdapter]) {
    const detected = await adapter.detect();
    const models = detected.installed ? await adapter.models() : [];
    engines.push({
      id: adapter.id,
      label: adapter.label,
      installed: detected.installed,
      version: detected.version,
      models,
      defaultModel: adapter.defaultModel,
    });
  }
  cache = { at: Date.now(), engines };
  return engines;
}
