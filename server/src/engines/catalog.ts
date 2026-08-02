import fs from 'node:fs';
import path from 'node:path';
import { EngineId, ModelInfo, ThinkingOption } from '@haikodev/shared';
import { listAccountRecords } from '../accounts.js';
import { log } from '../logger.js';

/**
 * Le catalogue des modèles est DEMANDÉ AU MOTEUR (PLAN §14, §30) : une liste
 * écrite en dur devient fausse à la première mise à jour et propose des
 * combinaisons qui n'existent plus. Chaque modèle apporte ses propres niveaux
 * de réflexion, avec leurs vrais noms et leurs explications.
 */

const NIVEAU_SANS = { id: 'none', label: 'Sans réflexion', description: 'Réponse directe, la plus rapide' };

/** Traduit les mots des moteurs dans le vocabulaire de l'interface. */
const LIBELLES: Record<string, string> = {
  minimal: 'Réflexion minimale',
  low: 'Réflexion légère',
  medium: 'Réflexion moyenne',
  high: 'Réflexion poussée',
  xhigh: 'Réflexion très poussée',
  max: 'Réflexion maximale',
};

const DESCRIPTIONS: Record<string, string> = {
  minimal: 'Le strict nécessaire avant de répondre',
  low: 'Réponses rapides, réflexion légère',
  medium: 'Équilibre entre vitesse et profondeur',
  high: 'Plus de profondeur pour les sujets complexes',
  xhigh: 'Réflexion très approfondie, plus lente',
  max: 'Réflexion maximale, la plus lente et la plus coûteuse',
};

function niveau(id: string, description?: string): ThinkingOption {
  return {
    id,
    label: LIBELLES[id] ?? `Réflexion « ${id} »`,
    description: description || DESCRIPTIONS[id],
  };
}

/* ------------------------------------------------------------------ */
/* Claude                                                              */
/* ------------------------------------------------------------------ */

function claudeToken(): string | null {
  const accounts = listAccountRecords()
    .filter((a) => a.engine === 'claude')
    .sort((a, b) => a.priority - b.priority);
  for (const account of accounts) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(account.configDir, '.credentials.json'), 'utf8'));
      const token = raw?.claudeAiOauth?.accessToken;
      if (token) return token;
    } catch {
      /* compte suivant */
    }
  }
  return null;
}

export async function claudeCatalog(): Promise<{ models: ModelInfo[]; live: boolean }> {
  const token = claudeToken();
  if (!token) return { models: claudeFallback(), live: false };

  try {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
      headers: {
        authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`réponse ${res.status}`);
    const data: any = await res.json();
    const entries: any[] = Array.isArray(data?.data) ? data.data : [];
    if (!entries.length) throw new Error('catalogue vide');

    const models: ModelInfo[] = entries.map((entry) => {
      const effort = entry?.capabilities?.effort ?? {};
      const niveaux: ThinkingOption[] = [NIVEAU_SANS];
      if (effort?.supported) {
        for (const key of ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
          if (effort[key]?.supported) niveaux.push(niveau(key));
        }
      }
      return ModelInfo.parse({
        id: entry.id,
        label: entry.display_name ?? entry.id,
        description: entry?.capabilities?.thinking?.supported ? 'Réflexion adaptative disponible' : undefined,
        thinking: niveaux,
        defaultThinking: 'none',
        contextWindow: entry.max_input_tokens ?? undefined,
      });
    });

    // Le plus récent en premier, comme dans le reste de l'application.
    models.sort((a, b) => a.label.localeCompare(b.label));
    return { models, live: true };
  } catch (err: any) {
    log.warn('catalogue Claude indisponible, repli local', err?.message ?? err);
    return { models: claudeFallback(), live: false };
  }
}

function claudeFallback(): ModelInfo[] {
  const niveaux = [NIVEAU_SANS, niveau('low'), niveau('medium'), niveau('high'), niveau('xhigh'), niveau('max')];
  return [
    { id: 'opus', label: 'Opus (le plus capable)', thinking: niveaux, defaultThinking: 'none' },
    { id: 'sonnet', label: 'Sonnet (équilibré)', thinking: niveaux, defaultThinking: 'none' },
    { id: 'haiku', label: 'Haiku (rapide et léger)', thinking: [NIVEAU_SANS], defaultThinking: 'none' },
  ].map((m) => ModelInfo.parse(m));
}

/* ------------------------------------------------------------------ */
/* Codex                                                               */
/* ------------------------------------------------------------------ */

function codexToken(): string | null {
  const accounts = listAccountRecords()
    .filter((a) => a.engine === 'codex')
    .sort((a, b) => a.priority - b.priority);
  for (const account of accounts) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(account.configDir, 'auth.json'), 'utf8'));
      const token = raw?.tokens?.access_token ?? raw?.OPENAI_API_KEY;
      if (token) return token;
    } catch {
      /* compte suivant */
    }
  }
  return null;
}

export async function codexCatalog(version: string): Promise<{ models: ModelInfo[]; live: boolean }> {
  const token = codexToken();
  if (!token) return { models: codexFallback(), live: false };

  try {
    const clientVersion = (version.match(/[\d.]+/)?.[0] ?? '0.146.0').trim();
    const res = await fetch(`https://chatgpt.com/backend-api/codex/models?client_version=${clientVersion}`, {
      headers: { authorization: `Bearer ${token}`, originator: 'codex_cli_rs' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`réponse ${res.status}`);
    const data: any = await res.json();
    const entries: any[] = Array.isArray(data?.models) ? data.models : [];
    if (!entries.length) throw new Error('catalogue vide');

    const models: ModelInfo[] = entries.map((entry) => {
      const niveaux: ThinkingOption[] = (entry.supported_reasoning_levels ?? []).map((level: any) =>
        niveau(String(level.effort), typeof level.description === 'string' ? level.description : undefined),
      );
      return ModelInfo.parse({
        id: entry.slug,
        label: entry.display_name ?? entry.slug,
        description: entry.description ?? undefined,
        thinking: niveaux.length ? niveaux : [NIVEAU_SANS],
        defaultThinking: entry.default_reasoning_level ?? niveaux[0]?.id,
        contextWindow: entry.context_window ?? undefined,
      });
    });
    return { models, live: true };
  } catch (err: any) {
    log.warn('catalogue Codex indisponible, repli local', err?.message ?? err);
    return { models: codexFallback(), live: false };
  }
}

function codexFallback(): ModelInfo[] {
  const niveaux = [niveau('low'), niveau('medium'), niveau('high'), niveau('xhigh')];
  return [
    { id: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max', thinking: niveaux, defaultThinking: 'medium' },
    { id: 'gpt-5.1-codex', label: 'GPT-5.1 Codex', thinking: niveaux, defaultThinking: 'medium' },
  ].map((m) => ModelInfo.parse(m));
}

/** Le niveau retenu doit exister pour le modèle choisi. */
export function normaliseThinking(models: ModelInfo[], modelId: string | undefined, wanted: string | undefined): string {
  const model = models.find((m) => m.id === modelId) ?? models[0];
  if (!model) return 'none';
  const available = model.thinking.map((t) => t.id);
  if (wanted && available.includes(wanted)) return wanted;
  return model.defaultThinking && available.includes(model.defaultThinking) ? model.defaultThinking : (available[0] ?? 'none');
}

export function engineOf(id: string): EngineId {
  return id === 'codex' ? 'codex' : 'claude';
}
