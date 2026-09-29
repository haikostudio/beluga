import fs from 'node:fs';
import path from 'node:path';
import { ModelInfo, dedoublonnerModeles, type FicheMoteur } from '@beluga/shared';
import { EngineAdapter, EngineHandle, EngineRunOptions } from './types.js';
import { claudeAdapter } from './claude.js';
import { codexAdapter } from './codex.js';
import { estUneNoteDeModeleInconnu, sansNoteDeModeleInconnu } from './mimo.js';
import { adresseCodexDeLaFiche } from './relais-chat.js';

/**
 * LES ADAPTATEURS DES MOTEURS AJOUTÉS — un par FAMILLE, paramétré par la fiche.
 *
 * Un fournisseur qui imite l'API d'Anthropic tourne dans l'outil de Claude,
 * pointé sur ses serveurs (comme MiMo, `mimo.ts`) ; un fournisseur qui imite
 * l'API « responses » d'OpenAI tourne dans l'outil de Codex, avec un
 * fournisseur déclaré dans le coffre du compte (`config.toml`). Un fournisseur
 * qui ne sert que `/chat/completions` (`api: 'chat'`, Gemini) passe par le
 * relais local du démon (`relais-chat.ts`), qui traduit. Éprouvé le
 * 27/09/2026 avec Codex 0.146 sur l'accès OpenAI de Xiaomi : lecture de
 * fichier par un outil, réponse finale, fin de processus propre — à condition
 * d'éteindre la recherche web, que ces passerelles refusent.
 *
 * LA RÈGLE QUI NE SE NÉGOCIE PAS : sans l'adresse DE LA FICHE et sa clé dans
 * l'environnement du tour, on NE LANCE RIEN. Sinon l'outil partirait chez
 * Anthropic ou OpenAI sur un coffre d'abonnement, et un tour « ajouté »
 * consommerait en silence le quota de l'utilisateur.
 */

/** La variable qui porte la clé d'un moteur ajouté de la famille OpenAI. */
export const VARIABLE_CLE_OPENAI = 'BELUGA_MOTEUR_AJOUTE_CLE';
/** Le nom du fournisseur déclaré dans le `config.toml` du compte. */
const FOURNISSEUR_CODEX = 'beluga_ajoute';

/** L'environnement d'un tour, famille Anthropic : `ANTHROPIC_*` vers la fiche. */
export function environnementAnthropique(fiche: FicheMoteur, cle: string, configDir: string): Record<string, string> {
  const leger = fiche.modeleLeger || fiche.modeleParDefaut;
  return {
    CLAUDE_CONFIG_DIR: configDir,
    ANTHROPIC_BASE_URL: fiche.urlDeBase,
    ANTHROPIC_API_KEY: cle,
    // Un jeton resté dans l'environnement du service passerait avant la clé.
    ANTHROPIC_AUTH_TOKEN: '',
    CLAUDE_CODE_OAUTH_TOKEN: '',
    // Les appels de fond de l'outil visent « haiku », qui n'existe pas ailleurs.
    ANTHROPIC_DEFAULT_HAIKU_MODEL: leger,
    ANTHROPIC_SMALL_FAST_MODEL: leger,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };
}

/** Le `config.toml` d'un compte de la famille OpenAI : le fournisseur de la fiche, et rien d'autre. */
export function configCodexDeLaFiche(fiche: FicheMoteur, adresse: string = adresseCodexDeLaFiche(fiche) ?? fiche.urlDeBase): string {
  const texte = (v: string) => JSON.stringify(v);
  return [
    '# Écrit par Beluga Build pour un moteur ajouté — réécrit à chaque lancement.',
    `model = ${texte(fiche.modeleParDefaut)}`,
    `model_provider = ${texte(FOURNISSEUR_CODEX)}`,
    // Les passerelles compatibles refusent l'outil de recherche d'OpenAI : avec
    // lui, le tout premier appel tombe (« tool type 'web_search' is not supported »).
    'web_search = "disabled"',
    '',
    `[model_providers.${FOURNISSEUR_CODEX}]`,
    `name = ${texte(fiche.label)}`,
    `base_url = ${texte(adresse)}`,
    `env_key = ${texte(VARIABLE_CLE_OPENAI)}`,
    'wire_api = "responses"',
    '',
  ].join('\n');
}

/** L'environnement d'un tour, famille OpenAI. Le `config.toml` du compte est réécrit au passage. */
export function environnementOpenAI(fiche: FicheMoteur, cle: string, configDir: string): Record<string, string> {
  // En « chat », sans relais qui écoute, aucune adresse : le tour ne part pas.
  const adresse = adresseCodexDeLaFiche(fiche);
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.toml'), configCodexDeLaFiche(fiche, adresse ?? ''), { mode: 0o600 });
  return {
    CODEX_HOME: configDir,
    [VARIABLE_CLE_OPENAI]: cle,
    // Une clé OpenAI restée dans l'environnement du service ne sert jamais ici.
    OPENAI_API_KEY: '',
    BELUGA_MOTEUR_AJOUTE_URL: adresse ? fiche.urlDeBase : '',
  };
}

/** Le coffre du compte déclare-t-il bien le fournisseur de la fiche ? */
function coffreCodexConforme(fiche: FicheMoteur, codexHome: string | undefined): boolean {
  if (!codexHome) return false;
  try {
    // L'outil peut ajouter ses propres lignes (dossiers de confiance) : on
    // exige seulement que le fournisseur et son adresse soient ceux de la fiche.
    const adresse = adresseCodexDeLaFiche(fiche);
    if (!adresse) return false;
    const contenu = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
    return (
      contenu.includes(`model_provider = ${JSON.stringify(FOURNISSEUR_CODEX)}`) &&
      contenu.includes(`base_url = ${JSON.stringify(adresse)}`)
    );
  } catch {
    return false;
  }
}

/** La raison pour laquelle ce tour ne part pas, ou `null` s'il peut partir. */
export function raisonDeNePasPartir(fiche: FicheMoteur, env: Record<string, string> | undefined): string | null {
  if (fiche.statut !== 'actif' && fiche.statut !== 'essai') return `le moteur « ${fiche.label} » a été retiré`;
  if (fiche.famille === 'anthropic') {
    if (env?.ANTHROPIC_BASE_URL !== fiche.urlDeBase || !env?.ANTHROPIC_API_KEY) {
      return `aucune clé ${fiche.nomCourt} déclarée pour ce compte : le tour ne part pas`;
    }
    return null;
  }
  if (env?.BELUGA_MOTEUR_AJOUTE_URL !== fiche.urlDeBase || !env?.[VARIABLE_CLE_OPENAI] || !coffreCodexConforme(fiche, env?.CODEX_HOME)) {
    return `aucune clé ${fiche.nomCourt} déclarée pour ce compte : le tour ne part pas`;
  }
  return null;
}

/** Un tour qui ne part pas : il le dit, et se referme comme « jamais démarré ». */
export function tourRefuse(options: EngineRunOptions, message: string): EngineHandle {
  options.onEvent({ kind: 'error', error: message });
  options.onEvent({ kind: 'done', exitCode: 1, error: message });
  return { stop: () => {}, finished: Promise.resolve({ ok: false, error: message, jamaisDemarre: true }) };
}

/**
 * Les notes que l'outil écrit sur un modèle qu'il ne connaît pas. Ce ne sont
 * que des AVERTISSEMENTS : laissés tels quels, ils prenaient la place de la
 * vraie cause d'un arrêt.
 */
const NOTE_CODEX_MODELE_INCONNU = /Model metadata for .* not found/i;

function estUneNote(message: string | undefined): boolean {
  return estUneNoteDeModeleInconnu(message) || (Boolean(message) && NOTE_CODEX_MODELE_INCONNU.test(message as string));
}

/** L'adaptateur d'une fiche. `detect` et `models` sont servis par le catalogue (`catalogueDeFiche`). */
export function adaptateurDeFiche(fiche: FicheMoteur): EngineAdapter {
  const outil = fiche.famille === 'anthropic' ? claudeAdapter : codexAdapter;
  return {
    id: fiche.id,
    label: fiche.label,
    binary: outil.binary,
    defaultModel: fiche.modeleParDefaut,

    async detect() {
      const installe = await outil.detect();
      const { comptesDuMoteurAvecCle } = await import('../accounts.js');
      const cle = comptesDuMoteurAvecCle(fiche.id).length > 0;
      return { installed: installe.installed && cle, version: installe.version, cliInstalle: installe.installed };
    },

    async models() {
      return [];
    },

    run(options: EngineRunOptions): EngineHandle {
      const refus = raisonDeNePasPartir(fiche, options.env);
      if (refus) return tourRefuse(options, refus);
      // Aucun niveau de réflexion : `--effort` et `model_reasoning_effort` ne
      // valent que chez Anthropic et OpenAI.
      const handle = outil.run({
        ...options,
        model: options.model || fiche.modeleParDefaut,
        thinking: undefined,
        onEvent: (event) => {
          if (event.kind === 'error' && estUneNote(event.error)) return;
          options.onEvent(event);
        },
      });
      return {
        ...handle,
        finished: handle.finished.then((fin) => ({ ...fin, error: sansNoteDeModeleInconnu(fin.error) })),
      };
    },

    compact: outil.compact
      ? (options) => {
          if (raisonDeNePasPartir(fiche, options.env)) return Promise.resolve({ ok: false, error: `aucune clé ${fiche.nomCourt}` });
          return outil.compact!({ ...options, thinking: undefined });
        }
      : undefined,
  };
}

/** L'adaptateur d'un moteur ajouté inconnu ou retiré : il ne lance jamais rien. */
export function adaptateurIntrouvable(id: `ext-${string}`): EngineAdapter {
  const message = `le moteur « ${id} » n'existe plus dans cette application : choisissez-en un autre`;
  return {
    id,
    label: id,
    binary: 'aucun',
    defaultModel: '',
    async detect() {
      return { installed: false, cliInstalle: false };
    },
    async models() {
      return [];
    },
    run: (options) => tourRefuse(options, message),
  };
}

/** « deepseek-v3.2-chat » → « Deepseek V3.2 Chat ». */
function libelleDuModele(id: string): string {
  return id
    .split(/[-_/]/)
    .filter(Boolean)
    .map((mot) => mot.charAt(0).toUpperCase() + mot.slice(1))
    .join(' ');
}

/** Les modèles de TEXTE : les listes mélangent souvent voix, images et plongements. */
export function modelesDeTexte(ids: readonly string[]): string[] {
  return ids.filter((id) => !/(asr|tts|voice|whisper|embed|image|vision-only|dall|audio|rerank|moderation)/i.test(id));
}

/** Le catalogue d'une fiche : le modèle par défaut en tête, puis ceux que la liste publie. */
export function catalogueDeFicheDepuisIds(fiche: FicheMoteur, ids: readonly string[]): ModelInfo[] {
  const tous = [fiche.modeleParDefaut, ...modelesDeTexte(ids).filter((id) => id !== fiche.modeleParDefaut)];
  return dedoublonnerModeles(
    tous.map((id) =>
      ModelInfo.parse({
        id,
        label: libelleDuModele(id),
        thinking: [],
        appetite: id === fiche.modeleLeger ? 'light' : id === fiche.modeleParDefaut ? 'medium' : 'medium',
      }),
    ),
  ).slice(0, 12);
}

/** Les identifiants de modèles publiés par le fournisseur pour cette clé. */
export async function modelesDeLaFiche(fiche: FicheMoteur, cle: string): Promise<string[]> {
  if (!fiche.urlDesModeles) return [];
  const res = await fetch(fiche.urlDesModeles, {
    headers: { authorization: `Bearer ${cle}`, 'x-api-key': cle, 'anthropic-version': '2023-06-01' },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(raisonDeRefus(fiche, res.status));
  const corps: any = await res.json();
  return Array.isArray(corps?.data) ? corps.data.map((m: any) => String(m?.id ?? '')).filter(Boolean) : [];
}

/** La raison d'un refus du fournisseur, en français. */
export function raisonDeRefus(fiche: FicheMoteur, statut: number, message?: string): string {
  if (statut === 401 || statut === 403) return `clé refusée par ${fiche.nomCourt}`;
  // « Introuvable » : l'adresse ou le format ne sont pas les bons — JAMAIS la clé.
  if (statut === 404 || statut === 405) return `adresse ou format d’API introuvable chez ${fiche.nomCourt} (réponse ${statut}) — ce n’est pas la clé`;
  if (statut === 402) return `solde épuisé chez ${fiche.nomCourt} — rechargez le compte`;
  if (statut === 429) return `${fiche.nomCourt} est momentanément saturé`;
  if (statut >= 500) return `${fiche.nomCourt} ne répond pas pour le moment`;
  return message?.trim() || `refus de ${fiche.nomCourt} (réponse ${statut})`;
}

/** Une demande d'un seul jeton, dans un format donné. */
async function sonderUnFormat(fiche: FicheMoteur, cle: string, format: 'anthropic' | 'responses' | 'chat'): Promise<Response> {
  const modele = fiche.modeleLeger || fiche.modeleParDefaut;
  const base = fiche.urlDeBase.replace(/\/+$/, '');
  // Gemini 3 réfléchit avant de répondre, même à « ok » : 20 s ne suffisaient pas.
  const signal = AbortSignal.timeout(45000);
  if (format === 'anthropic') {
    return fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': cle, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: modele, max_tokens: 1, messages: [{ role: 'user', content: 'ok' }] }),
      signal,
    });
  }
  const headers = { authorization: `Bearer ${cle}`, 'content-type': 'application/json' };
  if (format === 'chat') {
    return fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: modele, messages: [{ role: 'user', content: 'ok' }], max_tokens: 16 }),
      signal,
    });
  }
  return fetch(`${base}/responses`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: modele, input: 'ok', max_output_tokens: 16 }),
    signal,
  });
}

/** « Introuvable » : la route n'existe pas chez ce fournisseur. */
const estIntrouvable = (statut: number) => statut === 404 || statut === 405;

/**
 * SONDER UNE CLÉ : une demande d'un seul jeton au modèle léger, dans le format
 * de la famille. Sert à éprouver une clé avant de la retenir, et au relevé des
 * quotas (un 402 dit « solde épuisé »). Famille openai sans format fixé : si
 * `/responses` est introuvable, on essaie `/chat/completions`, et `api` dit
 * celui qui a répondu. `formatInconnu` : aucune route trouvée — la clé n'est
 * pas en cause.
 */
export async function sonderLaFiche(
  fiche: FicheMoteur,
  cle: string,
): Promise<{ ok: boolean; soldeVide?: boolean; erreur?: string; api?: 'responses' | 'chat'; formatInconnu?: boolean; cleRefusee?: boolean }> {
  try {
    return await sonderSansFiletDeTemps(fiche, cle);
  } catch (err: any) {
    // Délai dépassé, réseau coupé : rien n'est dit de la clé.
    const delai = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return {
      ok: false,
      cleRefusee: false,
      erreur: delai ? `${fiche.nomCourt} n’a pas répondu à temps` : `${fiche.nomCourt} injoignable (${err?.message ?? err})`,
    };
  }
}

async function sonderSansFiletDeTemps(
  fiche: FicheMoteur,
  cle: string,
): Promise<{ ok: boolean; soldeVide?: boolean; erreur?: string; api?: 'responses' | 'chat'; formatInconnu?: boolean; cleRefusee?: boolean }> {
  let format: 'anthropic' | 'responses' | 'chat' = fiche.famille === 'anthropic' ? 'anthropic' : fiche.api === 'chat' ? 'chat' : 'responses';
  let res = await sonderUnFormat(fiche, cle, format);
  if (format === 'responses' && fiche.api === undefined && estIntrouvable(res.status)) {
    const chat = await sonderUnFormat(fiche, cle, 'chat');
    if (!estIntrouvable(chat.status)) {
      format = 'chat';
      res = chat;
    }
  }
  const api = format === 'anthropic' ? undefined : format;
  if (res.ok) return { ok: true, ...(api ? { api } : {}) };
  const corps: any = await res.json().catch(() => null);
  const lu = Array.isArray(corps) ? corps[0] : corps;
  const message = lu?.error?.message ?? lu?.message;
  return {
    ok: false,
    soldeVide: res.status === 402,
    formatInconnu: estIntrouvable(res.status),
    cleRefusee: res.status === 401 || res.status === 403,
    ...(api && !estIntrouvable(res.status) ? { api } : {}),
    erreur: raisonDeRefus(fiche, res.status, typeof message === 'string' ? message : undefined),
  };
}
