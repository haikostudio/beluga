import fs from 'node:fs';
import path from 'node:path';
import { dedoublonnerModeles, EngineId, ModelInfo, ThinkingOption } from '@haikodev/shared';
import { listAccountRecords } from '../accounts.js';
import { log } from '../logger.js';

/**
 * Le catalogue des modèles est DEMANDÉ AU MOTEUR (PLAN §14, §30) : une liste
 * écrite en dur devient fausse à la première mise à jour et propose des
 * combinaisons qui n'existent plus. Chaque modèle apporte ses propres niveaux
 * de réflexion, avec leurs vrais noms et leurs explications.
 */

const NIVEAU_SANS = { id: 'none', label: 'Sans réflexion', description: 'Réponse directe, la plus rapide' };

/**
 * Un catalogue rendu au serveur : la liste, d'où elle vient, et — quand elle
 * vient du repli — POURQUOI le moteur n'a pas répondu. Cette raison remonte
 * jusqu'au menu de choix du modèle : une liste de secours ne doit pas passer
 * pour la liste complète.
 */
export type Catalogue = { models: ModelInfo[]; live: boolean; error?: string };

const SANS_COMPTE = 'aucun compte joignable';

/**
 * La raison d'une réponse refusée, en FRANÇAIS : elle s'affiche dans le menu du
 * modèle, donc « réponse 401 » n'apprend rien à qui n'est pas informaticien. Le
 * message exact du moteur, lui, part au journal.
 */
async function raisonHttp(res: Response): Promise<string> {
  let detail = '';
  try {
    const corps: any = await res.json();
    const message = corps?.error?.message ?? corps?.message;
    if (typeof message === 'string' && message.trim()) detail = message.trim();
  } catch {
    /* corps illisible : le code suffit */
  }
  if (detail) log.warn(`catalogue refusé (${res.status})`, detail);
  if (res.status === 401 || res.status === 403) return 'compte refusé, il faut le reconnecter';
  if (res.status === 429) return 'moteur momentanément saturé';
  if (res.status >= 500) return 'moteur indisponible';
  return `refus du moteur (réponse ${res.status})`;
}

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

/**
 * Classe les modèles du plus récent au plus ancien : par date de sortie quand
 * le moteur la donne, sinon par numéro de version lu dans le nom.
 */
function versionOf(model: { id: string; label: string }): number {
  const match = `${model.label} ${model.id}`.match(/(\d+)[.\-_](\d+)/);
  if (!match) return 0;
  return Number(match[1]) * 1000 + Number(match[2]);
}

function byRecency(a: ModelInfo, b: ModelInfo): number {
  if (a.releasedAt && b.releasedAt) return b.releasedAt - a.releasedAt;
  const versions = versionOf(b) - versionOf(a);
  if (versions !== 0) return versions;
  return a.label.localeCompare(b.label);
}

/**
 * L'appétit en quota (PLAN §19, esprit) : aucun moteur ne publie ses tarifs
 * dans son catalogue, mais les familles de modèles sont hiérarchisées de façon
 * stable. On donne donc un repère — léger, moyen, gourmand — plutôt qu'un prix
 * qui serait faux dès la semaine prochaine.
 */
function appetiteOf(id: string, label: string): 'light' | 'medium' | 'heavy' {
  const nom = `${id} ${label}`.toLowerCase();
  if (/haiku|mini|lite|flash|small/.test(nom)) return 'light';
  if (/opus|fable|max|sol|terra|ultra|pro\b/.test(nom)) return 'heavy';
  return 'medium';
}

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

/**
 * TOUS les jetons Claude disponibles, du compte prioritaire au dernier, les
 * jetons périmés relégués à la fin. Un seul compte ne doit pas décider du
 * catalogue : son jeton peut être expiré alors qu'un autre compte répond très
 * bien — sinon on retombe sur la liste locale à trois entrées (rencontré le
 * 02/08/2026).
 */
function claudeTokens(): string[] {
  const valides: string[] = [];
  const perimes: string[] = [];
  const accounts = listAccountRecords()
    .filter((a) => a.engine === 'claude')
    .sort((a, b) => a.priority - b.priority);
  for (const account of accounts) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(account.configDir, '.credentials.json'), 'utf8'));
      const token = raw?.claudeAiOauth?.accessToken;
      if (!token) continue;
      const expire = Number(raw?.claudeAiOauth?.expiresAt);
      if (Number.isFinite(expire) && expire <= Date.now()) perimes.push(token);
      else valides.push(token);
    } catch {
      /* compte suivant */
    }
  }
  return [...valides, ...perimes];
}

export async function claudeCatalog(): Promise<Catalogue> {
  const tokens = claudeTokens();
  if (!tokens.length) return { models: claudeFallback(), live: false, error: SANS_COMPTE };

  let dernierEchec = SANS_COMPTE;
  for (const token of tokens) {
    try {
      return await claudeCatalogAvec(token);
    } catch (err: any) {
      dernierEchec = err?.message ?? String(err);
      // Compte suivant : un jeton périmé ne doit pas priver de tout le catalogue.
    }
  }
  log.warn('catalogue Claude indisponible, repli local', dernierEchec);
  return { models: claudeFallback(), live: false, error: dernierEchec };
}

async function claudeCatalogAvec(token: string): Promise<Catalogue> {
  {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
      headers: {
        authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(await raisonHttp(res));
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
      const sortie = entry.created_at ? new Date(entry.created_at).getTime() : undefined;
      return ModelInfo.parse({
        id: entry.id,
        label: entry.display_name ?? entry.id,
        description: entry?.capabilities?.thinking?.supported ? 'Réflexion adaptative disponible' : undefined,
        thinking: niveaux,
        defaultThinking: 'none',
        contextWindow: entry.max_input_tokens ?? undefined,
        releasedAt: Number.isFinite(sortie) ? sortie : undefined,
        appetite: appetiteOf(entry.id, entry.display_name ?? ''),
      });
    });

    // Le plus RÉCENT en haut, le plus ancien en bas — jamais l'ordre alphabétique.
    models.sort(byRecency);
    return { models, live: true };
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

/** Tous les jetons Codex, du compte prioritaire au dernier (même règle que Claude). */
export function codexTokens(): string[] {
  const tokens: string[] = [];
  const accounts = listAccountRecords()
    .filter((a) => a.engine === 'codex')
    .sort((a, b) => a.priority - b.priority);
  for (const account of accounts) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(account.configDir, 'auth.json'), 'utf8'));
      const token = raw?.tokens?.access_token ?? raw?.OPENAI_API_KEY;
      if (token) tokens.push(token);
    } catch {
      /* compte suivant */
    }
  }
  return tokens;
}

export async function codexCatalog(version: string): Promise<Catalogue> {
  const tokens = codexTokens();
  if (!tokens.length) return { models: codexFallback(), live: false, error: SANS_COMPTE };

  let dernierEchec = SANS_COMPTE;
  for (const token of tokens) {
    try {
      return await codexCatalogAvec(version, token);
    } catch (err: any) {
      dernierEchec = err?.message ?? String(err);
    }
  }
  log.warn('catalogue Codex indisponible, repli local', dernierEchec);
  return { models: codexFallback(), live: false, error: dernierEchec };
}

export async function codexCatalogAvec(version: string, token: string): Promise<Catalogue> {
  {
    const clientVersion = (version.match(/[\d.]+/)?.[0] ?? '0.146.0').trim();
    const res = await fetch(`https://chatgpt.com/backend-api/codex/models?client_version=${clientVersion}`, {
      headers: { authorization: `Bearer ${token}`, originator: 'codex_cli_rs' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(await raisonHttp(res));
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
        appetite: appetiteOf(entry.slug, entry.display_name ?? ''),
      });
    });

    // Codex n'annonce pas de date de sortie : le numéro de version fait foi.
    models.sort(byRecency);

    // Un modèle est unique par son IDENTIFIANT : deux modèles réellement
    // différents peuvent porter le même nom affiché, et dédoublonner sur le nom
    // en escamotait un (règle et test dans shared/src/catalogue-modeles.ts).
    return { models: dedoublonnerModeles(models), live: true };
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

/**
 * Un réglage enregistré hier peut nommer un modèle qui n'existe plus, ou un
 * raccourci (« sonnet ») absent du catalogue réel. On le ramène vers le modèle
 * équivalent le plus récent plutôt que de laisser l'interface retomber au
 * hasard sur le premier de la liste.
 */
export function resolveModel(models: ModelInfo[], wanted: string | undefined): string | undefined {
  if (!models.length) return wanted;
  if (wanted && models.some((m) => m.id === wanted)) return wanted;
  if (!wanted) return models[0]?.id;

  const needle = wanted.toLowerCase();
  const famille = ['opus', 'sonnet', 'haiku', 'fable', 'codex', 'gpt'].find((f) => needle.includes(f));
  if (famille) {
    // Le plus récent de la famille : les identifiants récents trient en dernier.
    const candidats = models
      .filter((m) => m.id.toLowerCase().includes(famille) || m.label.toLowerCase().includes(famille))
      .sort((a, b) => a.id.localeCompare(b.id));
    if (candidats.length) return candidats[candidats.length - 1].id;
  }
  return models[0]?.id;
}

/**
 * Le modèle du chef d'orchestre dépend de son moteur. On cherche d'abord la
 * version précise voulue dans le catalogue réel, puis on se replie par famille
 * sur un modèle qui existe vraiment.
 */
export function orchestratorModel(engine: EngineId, models: ModelInfo[]): string | undefined {
  if (!models.length) return undefined;

  const wanted = engine === 'codex' ? 'gpt-5.4' : 'sonnet-5';
  const cible = wanted.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const preferred = models.find((model) => {
    const id = model.id.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const label = model.label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return model.id === wanted || id.includes(cible) || label.includes(cible);
  });
  return preferred?.id ?? resolveModel(models, wanted);
}

/** Les choix manuels l'emportent ; sans eux, les défauts du chef s'appliquent. */
export function orchestratorChoice(
  engine: EngineId,
  models: ModelInfo[],
  memorisedModel?: string,
  memorisedThinking?: string,
): { model: string | undefined; thinking: string } {
  const model = memorisedModel
    ? resolveModel(models, memorisedModel)
    : orchestratorModel(engine, models);
  const thinking = normaliseThinking(
    models,
    model,
    memorisedModel ? memorisedThinking : 'medium',
  );
  return { model, thinking };
}
