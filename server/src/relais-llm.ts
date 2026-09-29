import {
  DemandeLlm,
  URL_GEMINI_OPENAI,
  URL_GEMINI_OPENAI_MODELES,
  URL_OPENROUTER,
  URL_OPENROUTER_MODELES,
  cleGeminiDuCoffre,
  cleOpenRouterDuCoffre,
  fournisseurDuModele,
  modeleGeminiAuCatalogue,
} from '@beluga/shared';
import { listerAcces } from './coffre-fort.js';
import { log } from './logger.js';

/**
 * LE RELAIS LLM — l'appel réel à OpenRouter, ou à Gemini chez Google pour un
 * modèle « gemini/… », avec la clé du coffre.
 *
 * Les règles pures (adresse de la porte, forme d'une demande, comment la clé se
 * retrouve dans le coffre) vivent dans `shared/src/relais-llm.ts`. Ici : lire le
 * coffre, appeler, rendre.
 *
 * LA CLÉ EST RELUE À CHAQUE APPEL. La garder en mémoire ferait vivre une
 * seconde vérité : remplacer la clé dans le coffre suffit, sans redémarrage.
 */

/** Combien de temps on attend le fournisseur avant de rendre la main. */
const DELAI_MS = 60_000;

export type ReponseRelais =
  | { ok: true; statut: number; corps: unknown }
  | { ok: false; statut: number; raison: string };

function laCle(): string | undefined {
  return cleOpenRouterDuCoffre(listerAcces());
}

function laCleGemini(): string | undefined {
  return cleGeminiDuCoffre(listerAcces());
}

const SANS_CLE: ReponseRelais = {
  ok: false,
  statut: 503,
  raison:
    'Aucune clé OpenRouter dans le coffre-fort de Beluga Build : rangez-en une (type « clé d’API », service « OpenRouter »).',
};

const SANS_CLE_GEMINI: ReponseRelais = {
  ok: false,
  statut: 503,
  raison:
    'Aucune clé Gemini dans le coffre-fort de Beluga Build : rangez-en une (type « clé d’API », service « Google Gemini API »).',
};

const NOM_FOURNISSEUR = { openrouter: 'OpenRouter', gemini: 'Gemini' } as const;

async function appeler(
  url: string,
  cle: string,
  init: RequestInit,
  fournisseur: keyof typeof NOM_FOURNISSEUR = 'openrouter',
): Promise<ReponseRelais> {
  const nom = NOM_FOURNISSEUR[fournisseur];
  // Google ne veut que l'autorisation : les entêtes d'OpenRouter lui sont étrangers.
  const entetes: Record<string, string> =
    fournisseur === 'gemini'
      ? { Authorization: `Bearer ${cle}` }
      : { Authorization: `Bearer ${cle}`, 'HTTP-Referer': 'https://belugabuild.com', 'X-Title': 'Beluga Build' };
  const stop = AbortSignal.timeout(DELAI_MS);
  let reponse: Response;
  try {
    reponse = await fetch(url, {
      ...init,
      signal: stop,
      headers: {
        ...entetes,
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  } catch (err) {
    log.warn('relais llm', `${nom} injoignable : ${String(err)}`);
    return { ok: false, statut: 502, raison: `${nom} n'a pas répondu.` };
  }

  const texte = await reponse.text().catch(() => '');
  let corps: unknown;
  try {
    corps = texte ? JSON.parse(texte) : {};
  } catch {
    corps = { brut: texte.slice(0, 500) };
  }
  if (!reponse.ok) {
    log.warn('relais llm', `${nom} a refusé (${reponse.status}) : ${texte.slice(0, 200)}`);
    return { ok: false, statut: reponse.status, raison: `${nom} a refusé la demande (${reponse.status}).` };
  }
  return { ok: true, statut: 200, corps };
}

/**
 * Une demande de rédaction, relayée telle quelle. Un modèle « gemini/… » part
 * chez Google, tout autre chez OpenRouter.
 */
export async function relayerDemandeLlm(demande: DemandeLlm): Promise<ReponseRelais> {
  const cible = fournisseurDuModele(demande.modele);
  const gemini = cible.fournisseur === 'gemini';
  const cle = gemini ? laCleGemini() : laCle();
  if (!cle) return gemini ? SANS_CLE_GEMINI : SANS_CLE;
  // Google ne connaît pas le champ « reasoning » d'OpenRouter : l'effort passe par « reasoning_effort ».
  const effort =
    typeof demande.reflexion === 'string'
      ? demande.reflexion
      : (demande.reflexion as { effort?: unknown } | undefined)?.effort;
  const reflexion = gemini
    ? typeof effort === 'string'
      ? { reasoning_effort: effort }
      : {}
    : demande.reflexion === undefined
      ? {}
      : { reasoning: demande.reflexion };
  return appeler(
    gemini ? URL_GEMINI_OPENAI : URL_OPENROUTER,
    cle,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cible.modele,
        messages: demande.messages,
        ...(demande.temperature === undefined ? {} : { temperature: demande.temperature }),
        ...(demande.maxTokens === undefined ? {} : { max_tokens: demande.maxTokens }),
        ...(demande.outils === undefined ? {} : { tools: demande.outils }),
        ...(demande.choixOutil === undefined ? {} : { tool_choice: demande.choixOutil }),
        ...reflexion,
      }),
    },
    cible.fournisseur,
  );
}

/**
 * Le catalogue des modèles, relayé de la même façon — lecture seule. Les
 * modèles de Google s'ajoutent à ceux d'OpenRouter, sous leur nom « gemini/… ».
 * Un fournisseur qui manque ou qui tombe n'efface pas l'autre.
 */
export async function relayerCatalogueLlm(): Promise<ReponseRelais> {
  const cle = laCle();
  const cleGemini = laCleGemini();
  if (!cle && !cleGemini) return SANS_CLE;
  const [openrouter, gemini] = await Promise.all([
    cle ? appeler(URL_OPENROUTER_MODELES, cle, { method: 'GET' }) : Promise.resolve(null),
    cleGemini ? appeler(URL_GEMINI_OPENAI_MODELES, cleGemini, { method: 'GET' }, 'gemini') : Promise.resolve(null),
  ]);
  if (!gemini?.ok) return openrouter ?? gemini ?? SANS_CLE;
  const modelesGemini = listeDuCatalogue(gemini.corps).map((m) => ({
    ...m,
    id: modeleGeminiAuCatalogue(String(m.id ?? '')),
    name: typeof m.display_name === 'string' ? m.display_name : m.id,
  }));
  if (!openrouter?.ok) return { ok: true, statut: 200, corps: { data: modelesGemini } };
  const corps = openrouter.corps as Record<string, unknown>;
  return { ok: true, statut: 200, corps: { ...corps, data: [...listeDuCatalogue(corps), ...modelesGemini] } };
}

function listeDuCatalogue(corps: unknown): Record<string, unknown>[] {
  const data = (corps as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? (data.filter((m) => m && typeof m === 'object') as Record<string, unknown>[]) : [];
}
