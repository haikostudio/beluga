import {
  ModelInfo,
  adresseMimoPourCle,
  adressesMimoAEssayer,
  dedoublonnerModeles,
  estUneAdresseMimo,
  limiterAuxPlusRecents,
} from '@beluga/shared';
import { EngineAdapter, EngineHandle, EngineRunOptions } from './types.js';
import { claudeAdapter } from './claude.js';

/**
 * L'ADAPTATEUR XIAOMI MIMO.
 *
 * Xiaomi expose une API COMPATIBLE ANTHROPIC (`/anthropic/v1/messages`). MiMo
 * tourne donc dans l'outil en ligne de commande de Claude, simplement pointé
 * sur les serveurs de Xiaomi : mêmes outils, même liste de tâches, même pont
 * d'outils du démon, même arrêt. Seuls changent l'adresse, la clé et les noms
 * de modèles — tous posés par l'environnement du compte (`applyAccountEnv`).
 *
 * UNE RÈGLE QUI NE SE NÉGOCIE PAS : sans `ANTHROPIC_BASE_URL` vers Xiaomi dans
 * l'environnement du tour, on NE LANCE RIEN. Sinon l'outil partirait chez
 * Anthropic avec le coffre du compte Claude par défaut, et un tour « MiMo »
 * consommerait en silence le quota d'un abonnement Claude.
 *
 * Éprouvé le 27/09/2026 : l'outil joint bien Xiaomi et rend la panne telle que
 * Xiaomi l'écrit (« API Error: 402 Insufficient account balance »), reconnue
 * comme une limite de compte par `shared/src/reprise-compte.ts`.
 */

/**
 * L'adresse dépend de la CLÉ (`shared/src/adresse-mimo.ts`) : « sk-… » à
 * l'usage sur `api.xiaomimimo.com`, « tp-… » d'abonnement sur
 * `token-plan-sgp.xiaomimimo.com`. On retient ici l'adresse qui a RÉELLEMENT
 * répondu pour une clé, apprise par le repli de `appelerMimo` : elle passe
 * avant la simple forme de la clé.
 */
const adresseEprouvee = new Map<string, string>();

/** L'adresse d'une clé : celle qui a déjà répondu, sinon celle que sa forme désigne. */
export function adresseMimo(cle: string): string {
  return adresseEprouvee.get(cle) ?? adresseMimoPourCle(cle);
}

/**
 * UN APPEL À XIAOMI, AVEC REPLI : l'adresse que la clé désigne d'abord, puis
 * l'autre si elle répond 401/403. Seul le dernier refus remonte — une clé
 * d'abonnement n'est plus dite « refusée » parce qu'on a frappé à la mauvaise porte.
 */
async function appelerMimo(cle: string, chemin: string, init: RequestInit): Promise<Response> {
  const connue = adresseEprouvee.get(cle);
  const adresses = connue ? [connue, ...adressesMimoAEssayer(cle).filter((a) => a !== connue)] : adressesMimoAEssayer(cle);
  let derniere: Response | undefined;
  for (const base of adresses) {
    const res = await fetch(`${base}${chemin}`, init);
    if (res.status !== 401 && res.status !== 403) {
      adresseEprouvee.set(cle, base);
      return res;
    }
    derniere = res;
  }
  return derniere as Response;
}
/** Le modèle léger, servi aux appels de fond de l'outil (titres, résumés). */
export const MODELE_MIMO_LEGER = 'mimo-v2.6-flash';
/** Le modèle équilibré, retenu par défaut. */
export const MODELE_MIMO_PAR_DEFAUT = 'mimo-v2.6-pro';

/**
 * L'ENVIRONNEMENT D'UN TOUR MIMO. `ANTHROPIC_AUTH_TOKEN` est vidé : un jeton
 * resté dans l'environnement du service passerait avant la clé.
 */
export function environnementMimo(cle: string, configDir: string): Record<string, string> {
  return {
    CLAUDE_CONFIG_DIR: configDir,
    ANTHROPIC_BASE_URL: `${adresseMimo(cle)}/anthropic`,
    ANTHROPIC_API_KEY: cle,
    ANTHROPIC_AUTH_TOKEN: '',
    CLAUDE_CODE_OAUTH_TOKEN: '',
    // Les appels de fond de l'outil visent « haiku » : chez Xiaomi, ce nom
    // n'existe pas, et chaque appel échouerait.
    ANTHROPIC_DEFAULT_HAIKU_MODEL: MODELE_MIMO_LEGER,
    ANTHROPIC_SMALL_FAST_MODEL: MODELE_MIMO_LEGER,
    // Ni télémétrie ni mise à jour vers Anthropic : rien à y faire avec une clé Xiaomi.
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };
}

/** Les modèles de TEXTE : Xiaomi liste aussi ses voix et sa transcription. */
export function modelesDeTexteMimo(ids: readonly string[]): string[] {
  return ids.filter((id) => /^mimo-/i.test(id) && !/-(asr|tts)\b|voice/i.test(id));
}

/** « mimo-v2.6-pro-ultraspeed » → « MiMo V2.6 Pro Ultraspeed ». */
export function libelleMimo(id: string): string {
  return id
    .split('-')
    .map((mot) => (/^mimo$/i.test(mot) ? 'MiMo' : mot.charAt(0).toUpperCase() + mot.slice(1)))
    .join(' ');
}

function appetitMimo(id: string): 'light' | 'medium' | 'heavy' {
  if (/flash/i.test(id)) return 'light';
  if (/pro/i.test(id)) return 'heavy';
  return 'medium';
}

function versionMimo(id: string): number {
  const trouve = id.match(/v(\d+)(?:\.(\d+))?/i);
  return trouve ? Number(trouve[1]) * 1000 + Number(trouve[2] ?? 0) : 0;
}

/**
 * Le catalogue, du plus récent au plus ancien, une version par famille
 * (`limiterAuxPlusRecents`). Aucun niveau de réflexion : l'option `--effort`
 * de l'outil ne vaut que pour les modèles d'Anthropic.
 */
export function catalogueMimoDepuisIds(ids: readonly string[]): ModelInfo[] {
  const modeles = modelesDeTexteMimo(ids)
    .sort((a, b) => versionMimo(b) - versionMimo(a) || a.localeCompare(b))
    .map((id) =>
      ModelInfo.parse({
        id,
        label: libelleMimo(id),
        thinking: [],
        appetite: appetitMimo(id),
      }),
    );
  return limiterAuxPlusRecents(dedoublonnerModeles(modeles));
}

/** Le repli, quand Xiaomi ne répond pas ou qu'aucune clé n'est déclarée. */
export function catalogueMimoDeSecours(): ModelInfo[] {
  return catalogueMimoDepuisIds(['mimo-v2.6-pro', 'mimo-v2.6-flash']);
}

/** Les identifiants de modèles publiés par Xiaomi pour cette clé. */
export async function modelesMimo(cle: string): Promise<string[]> {
  const res = await appelerMimo(cle, '/v1/models', {
    headers: { authorization: `Bearer ${cle}` },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(raisonDeRefusMimo(res.status));
  const corps: any = await res.json();
  const ids = Array.isArray(corps?.data) ? corps.data.map((m: any) => String(m?.id ?? '')).filter(Boolean) : [];
  return ids;
}

/** La raison d'un refus de Xiaomi, en français — elle s'affiche dans les réglages. */
export function raisonDeRefusMimo(statut: number, message?: string): string {
  if (statut === 401 || statut === 403) return 'clé refusée par Xiaomi';
  if (statut === 402) return 'solde épuisé chez Xiaomi — rechargez le compte MiMo';
  if (statut === 429) return 'Xiaomi est momentanément saturé';
  if (statut >= 500) return 'Xiaomi ne répond pas pour le moment';
  return message?.trim() || `refus de Xiaomi (réponse ${statut})`;
}

/**
 * CE QUE DIT LE COMPTE : la clé répond-elle, et reste-t-il du solde ?
 *
 * Xiaomi ne publie aucune route de solde (essayées le 27/09/2026 : toutes en
 * 404). La seule façon de le savoir est une demande d'un seul jeton au modèle
 * léger : 402 veut dire solde vide. Le coût est négligeable, et le relevé des
 * quotas ne repasse pas plus d'une fois toutes les cinq minutes.
 */
export async function sonderLeCompteMimo(cle: string): Promise<{ ok: boolean; soldeVide?: boolean; erreur?: string }> {
  const res = await appelerMimo(cle, '/anthropic/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': cle,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODELE_MIMO_LEGER,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ok' }],
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (res.ok) return { ok: true };
  const corps: any = await res.json().catch(() => null);
  const message = corps?.error?.message ?? corps?.message;
  return {
    ok: false,
    soldeVide: res.status === 402,
    erreur: raisonDeRefusMimo(res.status, typeof message === 'string' ? message : undefined),
  };
}

/**
 * L'outil de Claude écrit « [claude-code:unrecognized_model] … » à chaque tour
 * sur un modèle qui n'est pas d'Anthropic. Ce n'est qu'une NOTE : laissée
 * telle quelle, elle prenait la place de la vraie cause d'un arrêt (« 402
 * Insufficient account balance »).
 */
const NOTE_MODELE_INCONNU = /\[claude-code:unrecognized_model\]/;

export function estUneNoteDeModeleInconnu(message: string | undefined): boolean {
  return Boolean(message) && (message as string).split('\n').every((l) => !l.trim() || NOTE_MODELE_INCONNU.test(l));
}

export function sansNoteDeModeleInconnu(message: string | undefined): string | undefined {
  if (!message) return message;
  const reste = message
    .split('\n')
    .filter((ligne) => !NOTE_MODELE_INCONNU.test(ligne))
    .join('\n')
    .trim();
  return reste || undefined;
}

export const mimoAdapter: EngineAdapter = {
  id: 'mimo',
  label: 'Xiaomi MiMo',
  binary: claudeAdapter.binary,
  defaultModel: MODELE_MIMO_PAR_DEFAUT,

  /*
   * L'outil est celui de Claude. Comme chez Cursor, « installé » veut dire
   * UTILISABLE : l'outil répond ET une clé est connue ; `cliInstalle` ne parle
   * que de l'outil.
   */
  async detect() {
    const outil = await claudeAdapter.detect();
    // Import tardif : le module des comptes importe déjà celui-ci.
    const { cleMimoDuServeur, cleDuCompteMimo, listAccountRecords } = await import('../accounts.js');
    const cle =
      Boolean(cleMimoDuServeur()) ||
      listAccountRecords().some((compte) => compte.engine === 'mimo' && Boolean(cleDuCompteMimo(compte)));
    return { installed: outil.installed && cle, version: outil.version, cliInstalle: outil.installed };
  },

  async models() {
    return [];
  },

  run(options: EngineRunOptions): EngineHandle {
    const adresse = options.env?.ANTHROPIC_BASE_URL ?? '';
    if (!estUneAdresseMimo(adresse) || !options.env?.ANTHROPIC_API_KEY) {
      const message = 'aucune clé Xiaomi MiMo déclarée pour ce compte : le tour ne part pas';
      options.onEvent({ kind: 'error', error: message });
      options.onEvent({ kind: 'done', exitCode: 1, error: message });
      return {
        stop: () => {},
        finished: Promise.resolve({ ok: false, error: message, jamaisDemarre: true }),
      };
    }
    // Pas de `--effort` : ce réglage n'existe que chez Anthropic.
    const handle = claudeAdapter.run({
      ...options,
      thinking: undefined,
      onEvent: (event) => {
        if (event.kind === 'error' && estUneNoteDeModeleInconnu(event.error)) return;
        options.onEvent(event);
      },
    });
    return {
      ...handle,
      finished: handle.finished.then((fin) => ({ ...fin, error: sansNoteDeModeleInconnu(fin.error) })),
    };
  },

  compact: claudeAdapter.compact
    ? (options) => {
        if (!estUneAdresseMimo(options.env?.ANTHROPIC_BASE_URL ?? '')) {
          return Promise.resolve({ ok: false, error: 'aucune clé Xiaomi MiMo' });
        }
        return claudeAdapter.compact!({ ...options, thinking: undefined });
      }
    : undefined,
};
