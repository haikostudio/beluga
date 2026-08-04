import { EngineId, EngineInfo } from '@haikodev/shared';
import { EngineAdapter } from './types.js';
import { claudeAdapter } from './claude.js';
import { codexAdapter } from './codex.js';
import { claudeCatalog, codexCatalog, resolveModel } from './catalog.js';

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
    let catalogError: string | undefined;
    if (detected.installed) {
      const catalogue =
        adapter.id === 'claude' ? await claudeCatalog() : await codexCatalog(detected.version ?? '');
      models = catalogue.models;
      live = catalogue.live;
      catalogError = catalogue.error;
    }
    engines.push({
      id: adapter.id,
      label: adapter.label,
      installed: detected.installed,
      version: detected.version,
      models,
      // Le modèle par défaut suit l'intention de l'adaptateur (un modèle
      // équilibré), ramenée vers un modèle qui existe vraiment — sinon on
      // retomberait sur le premier de la liste, c'est-à-dire le plus cher.
      defaultModel: resolveModel(models, adapter.defaultModel),
      live,
      // Une liste de secours ne passe pas pour la liste du moteur : le menu le dit.
      catalogError,
      fetchedAt: Date.now(),
    });
  }
  cache = { at: Date.now(), engines };
  return engines;
}
