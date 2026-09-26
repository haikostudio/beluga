import fs from 'node:fs';
import path from 'node:path';
import {
  dedoublonnerModeles,
  familleDeModele,
  limiterAuxPlusRecents,
  ModelInfo,
  ThinkingOption,
} from '@beluga/shared';
import { listAccountRecords } from '../accounts.js';
import { clesCursor, modelesCursor } from './cursor.js';
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
 *
 * La partie mineure est FACULTATIVE. En l'exigeant, « Opus 5 1M » n'avait aucune
 * version du tout (0) et passait donc derrière « Opus 4.8 1M » (4008) : le menu
 * de Cursor gardait la vieille version et jetait la nouvelle.
 */
export function versionOf(model: { id: string; label: string }): number {
  const match = `${model.label} ${model.id}`.match(/(\d+)(?:[.\-_](\d+))?/);
  if (!match) return 0;
  return Number(match[1]) * 1000 + Number(match[2] ?? 0);
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

/**
 * « Sans réflexion » ne doit plus se PROPOSER AU CHOIX dès qu'un modèle offre
 * de vrais niveaux : elle ne reste que là où c'est la SEULE option du modèle
 * (Haiku, Composer 2.5…), où le champ ne s'affiche même pas (un seul niveau).
 */
function sansOptionSans(niveaux: ThinkingOption[]): ThinkingOption[] {
  if (niveaux.length <= 1) return niveaux;
  return niveaux.filter((n) => n.id !== 'none');
}

/** Le défaut visé, ramené à « moyenne » quand ce qui était demandé n'existe plus. */
function defautReflexion(niveaux: ThinkingOption[], souhaite?: string): string {
  const ids = niveaux.map((n) => n.id);
  if (souhaite && ids.includes(souhaite)) return souhaite;
  if (ids.includes('medium')) return 'medium';
  return ids[0] ?? 'none';
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
      const brut: ThinkingOption[] = [NIVEAU_SANS];
      if (effort?.supported) {
        for (const key of ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
          if (effort[key]?.supported) brut.push(niveau(key));
        }
      }
      const niveaux = sansOptionSans(brut);
      const sortie = entry.created_at ? new Date(entry.created_at).getTime() : undefined;
      return ModelInfo.parse({
        id: entry.id,
        label: entry.display_name ?? entry.id,
        description: entry?.capabilities?.thinking?.supported ? 'Réflexion adaptative disponible' : undefined,
        thinking: niveaux,
        defaultThinking: defautReflexion(niveaux),
        contextWindow: entry.max_input_tokens ?? undefined,
        releasedAt: Number.isFinite(sortie) ? sortie : undefined,
        appetite: appetiteOf(entry.id, entry.display_name ?? ''),
      });
    });

    // Le plus RÉCENT en haut, le plus ancien en bas — jamais l'ordre alphabétique.
    models.sort(byRecency);
    // Le catalogue affiché garde la version la plus récente de CHAQUE famille :
    // un modèle ancien, plus cher et moins capable, ne doit plus se choisir par
    // habitude — mais aucune famille ne disparaît du menu pour autant.
    return { models: limiterAuxPlusRecents(models), live: true };
  }
}

function claudeFallback(): ModelInfo[] {
  const niveaux = sansOptionSans([
    NIVEAU_SANS,
    niveau('low'),
    niveau('medium'),
    niveau('high'),
    niveau('xhigh'),
    niveau('max'),
  ]);
  return [
    { id: 'opus', label: 'Opus (le plus capable)', thinking: niveaux, defaultThinking: defautReflexion(niveaux) },
    { id: 'sonnet', label: 'Sonnet (équilibré)', thinking: niveaux, defaultThinking: defautReflexion(niveaux) },
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

    return { models: modelesCodexDepuisEntrees(entries), live: true };
  }
}

/**
 * Chaque identifiant que Codex annonce reste dans le catalogue GPT. Le seul
 * retrait permis est un doublon STRICT d'identifiant ; la réduction par
 * famille reste réservée aux moteurs qui veulent masquer leurs anciennes
 * versions.
 */
export function modelesCodexDepuisEntrees(entries: any[]): ModelInfo[] {
    const models: ModelInfo[] = entries.map((entry) => {
      const brut: ThinkingOption[] = (entry.supported_reasoning_levels ?? []).map((level: any) =>
        niveau(String(level.effort), typeof level.description === 'string' ? level.description : undefined),
      );
      const niveaux = sansOptionSans(brut.length ? brut : [NIVEAU_SANS]);
      return ModelInfo.parse({
        id: entry.slug,
        label: entry.display_name ?? entry.slug,
        description: entry.description ?? undefined,
        thinking: niveaux,
        defaultThinking: defautReflexion(niveaux, entry.default_reasoning_level),
        contextWindow: entry.context_window ?? undefined,
        appetite: appetiteOf(entry.slug, entry.display_name ?? ''),
      });
    });

    // Un modèle est unique par son IDENTIFIANT : deux modèles réellement
    // différents peuvent porter le même nom affiché, et dédoublonner sur le nom
    // en escamotait un (règle et test dans shared/src/catalogue-modeles.ts).
    // Le doublon strict est retiré AVANT le tri pour garder la première réponse
    // du moteur, même si ses deux libellés différents se classent autrement.
    const uniques = dedoublonnerModeles(models);
    // Codex n'annonce pas de date de sortie : le numéro de version fait foi.
    uniques.sort(byRecency);
    // Aucune réduction par famille sous GPT : si Codex annonce Astra ou deux
    // versions d'une même famille, elles sont toutes deux sélectionnables.
    return uniques;
}

function codexFallback(): ModelInfo[] {
  const niveaux = [niveau('low'), niveau('medium'), niveau('high'), niveau('xhigh')];
  return [
    { id: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max', thinking: niveaux, defaultThinking: 'medium' },
    { id: 'gpt-5.1-codex', label: 'GPT-5.1 Codex', thinking: niveaux, defaultThinking: 'medium' },
  ].map((m) => ModelInfo.parse(m));
}

/* ------------------------------------------------------------------ */
/* Cursor                                                              */
/* ------------------------------------------------------------------ */

/**
 * Le catalogue de Cursor vient de son OUTIL EN LIGNE DE COMMANDE
 * (`cursor-agent --list-models`), avec la clé du compte. Cet outil n'accepte
 * qu'une liste FERMÉE de noms où le niveau de réflexion est un suffixe : les
 * niveaux affichés sortent donc du regroupement de ces noms, jamais d'une liste
 * écrite à la main (`shared/src/moteur-cursor.ts`, règles pures et testées).
 */
export async function cursorCatalog(): Promise<Catalogue> {
  const cles = clesCursor();
  if (!cles.length) return { models: cursorFallback(), live: false, error: SANS_COMPTE };

  let dernierEchec = SANS_COMPTE;
  for (const cle of cles) {
    try {
      const entries = await modelesCursor(cle);
      if (!entries.length) throw new Error('catalogue vide');
      const models: ModelInfo[] = entries.map((entry) => {
        // Les niveaux sont ceux que le CLI propose RÉELLEMENT pour ce
        // modèle : en afficher un de plus ferait refuser le tour entier,
        // puisque le niveau fait partie du nom envoyé. « Sans réflexion » ne
        // se PROPOSE plus au choix dès qu'un autre niveau existe pour ce modèle.
        const brut = entry.niveaux.map((id) => (id === 'none' ? NIVEAU_SANS : niveau(id)));
        const niveaux = sansOptionSans(brut);
        return ModelInfo.parse({
          id: entry.id,
          label: entry.label,
          thinking: niveaux,
          defaultThinking: defautReflexion(niveaux, entry.niveauParDefaut),
          contextWindow: entry.fenetre,
          appetite: appetiteOf(entry.id, entry.label),
        });
      });
      models.sort(byRecency);
      return { models: limiterAuxPlusRecents(dedoublonnerModeles(models)), live: true };
    } catch (err: any) {
      dernierEchec = err?.message ?? String(err);
    }
  }
  log.warn('catalogue Cursor indisponible, repli local', dernierEchec);
  return { models: cursorFallback(), live: false, error: dernierEchec };
}

function cursorFallback(): ModelInfo[] {
  const efforts = sansOptionSans([NIVEAU_SANS, niveau('low'), niveau('medium'), niveau('high'), niveau('xhigh')]);
  return [
    { id: 'composer-2.5', label: 'Composer 2.5', thinking: [NIVEAU_SANS], defaultThinking: 'none' },
    { id: 'claude-sonnet-5', label: 'Sonnet 5', thinking: efforts, defaultThinking: defautReflexion(efforts) },
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

  // D'abord la MÊME famille exacte (`familleDeModele`) : « claude-opus-5 »
  // retiré par la mise à jour du moteur devient « claude-opus-5-5 ». Le repli
  // par mot-clé ci-dessous ne sert qu'aux raccourcis (« sonnet »).
  const famille = familleDeModele({ id: wanted });
  const parente = models.find((m) => familleDeModele(m) === famille);
  if (parente) return parente.id;

  const needle = wanted.toLowerCase();
  const motCle = ['opus', 'sonnet', 'haiku', 'fable', 'codex', 'gpt'].find((f) => needle.includes(f));
  if (motCle) {
    // Le plus récent de la famille : les identifiants récents trient en dernier.
    const candidats = models
      .filter((m) => m.id.toLowerCase().includes(motCle) || m.label.toLowerCase().includes(motCle))
      .sort((a, b) => a.id.localeCompare(b.id));
    if (candidats.length) return candidats[candidats.length - 1].id;
  }
  return models[0]?.id;
}

/**
 * LE RÉGLAGE D'UNE CONVERSATION DE CADRAGE : CELUI QUE L'UTILISATEUR A CHOISI.
 *
 * Ce module épinglait ici un modèle ÉCONOME (Haiku 4.5 sous Claude, GPT-5.4
 * sous Codex), puis RAMENAIT SOUS PLAFOND tout choix jugé gourmand : un Opus 5
 * sélectionné dans la barre d'écriture repartait en Haiku au cadrage suivant,
 * sans un mot. C'est le défaut relevé le 02/09/2026 — « quand j'itère, ça passe
 * sur un modèle bon marché ». Le plafond (`shared/src/modele-econome.ts`) est
 * SUPPRIMÉ, pas assoupli : un réglage posé par l'utilisateur ne se réécrit plus
 * jamais tout seul, ni ici ni ailleurs.
 *
 * Ce qui reste n'est plus un choix, seulement un ACCORD avec le catalogue RÉEL
 * du moteur : un modèle retenu hier peut avoir disparu (`resolveModel`), un
 * cran de réflexion peut ne pas exister pour ce modèle (`normaliseThinking`).
 * Sans rien de mémorisé, on prend le modèle par DÉFAUT du moteur — jamais un
 * modèle choisi pour son prix.
 */
export function choixDuCadrage(
  models: ModelInfo[],
  defaultModel: string | undefined,
  memorisedModel?: string,
  memorisedThinking?: string,
): { model: string | undefined; thinking: string } {
  const model = resolveModel(models, memorisedModel ?? defaultModel);
  return { model, thinking: normaliseThinking(models, model, memorisedThinking) };
}
