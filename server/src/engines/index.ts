import { EngineId, EngineInfo } from '@haikodev/shared';
import { EngineAdapter } from './types.js';
import { claudeAdapter } from './claude.js';
import { codexAdapter } from './codex.js';
import { claudeCatalog, codexCatalog } from './catalog.js';

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
    let models: EngineInfo['models'] = [];
    let live = false;
    if (detected.installed) {
      const catalogue =
        adapter.id === 'claude' ? await claudeCatalog() : await codexCatalog(detected.version ?? '');
      models = catalogue.models;
      live = catalogue.live;
    }
    engines.push({
      id: adapter.id,
      label: adapter.label,
      installed: detected.installed,
      version: detected.version,
      models,
      // Le modèle par défaut est celui du moteur s'il existe encore dans le catalogue.
      defaultModel: models.find((m) => m.id === adapter.defaultModel)?.id ?? models[0]?.id,
      live,
      fetchedAt: Date.now(),
    });
  }
  cache = { at: Date.now(), engines };
  return engines;
}
