import {
  DemandeLlm,
  URL_OPENROUTER,
  URL_OPENROUTER_MODELES,
  cleOpenRouterDuCoffre,
} from '@beluga/shared';
import { listerAcces } from './coffre-fort.js';
import { log } from './logger.js';

/**
 * LE RELAIS LLM — l'appel réel à OpenRouter, avec la clé du coffre.
 *
 * Les règles pures (adresse de la porte, forme d'une demande, comment la clé se
 * retrouve dans le coffre) vivent dans `shared/src/relais-llm.ts`. Ici : lire le
 * coffre, appeler, rendre.
 *
 * LA CLÉ EST RELUE À CHAQUE APPEL. La garder en mémoire ferait vivre une
 * seconde vérité : remplacer la clé dans le coffre suffit, sans redémarrage.
 */

/** Combien de temps on attend OpenRouter avant de rendre la main. */
const DELAI_MS = 60_000;

export type ReponseRelais =
  | { ok: true; statut: number; corps: unknown }
  | { ok: false; statut: number; raison: string };

function laCle(): string | undefined {
  return cleOpenRouterDuCoffre(listerAcces());
}

const SANS_CLE: ReponseRelais = {
  ok: false,
  statut: 503,
  raison:
    'Aucune clé OpenRouter dans le coffre-fort de Beluga Build : rangez-en une (type « clé d’API », service « OpenRouter »).',
};

async function appeler(url: string, cle: string, init: RequestInit): Promise<ReponseRelais> {
  const stop = AbortSignal.timeout(DELAI_MS);
  let reponse: Response;
  try {
    reponse = await fetch(url, {
      ...init,
      signal: stop,
      headers: {
        Authorization: `Bearer ${cle}`,
        'HTTP-Referer': 'https://belugabuild.com',
        'X-Title': 'Beluga Build',
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  } catch (err) {
    log.warn('relais llm', `OpenRouter injoignable : ${String(err)}`);
    return { ok: false, statut: 502, raison: "OpenRouter n'a pas répondu." };
  }

  const texte = await reponse.text().catch(() => '');
  let corps: unknown;
  try {
    corps = texte ? JSON.parse(texte) : {};
  } catch {
    corps = { brut: texte.slice(0, 500) };
  }
  if (!reponse.ok) {
    log.warn('relais llm', `OpenRouter a refusé (${reponse.status}) : ${texte.slice(0, 200)}`);
    return { ok: false, statut: reponse.status, raison: `OpenRouter a refusé la demande (${reponse.status}).` };
  }
  return { ok: true, statut: 200, corps };
}

/** Une demande de rédaction, relayée telle quelle à OpenRouter. */
export async function relayerDemandeLlm(demande: DemandeLlm): Promise<ReponseRelais> {
  const cle = laCle();
  if (!cle) return SANS_CLE;
  return appeler(URL_OPENROUTER, cle, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: demande.modele,
      messages: demande.messages,
      ...(demande.temperature === undefined ? {} : { temperature: demande.temperature }),
      ...(demande.maxTokens === undefined ? {} : { max_tokens: demande.maxTokens }),
      ...(demande.outils === undefined ? {} : { tools: demande.outils }),
      ...(demande.choixOutil === undefined ? {} : { tool_choice: demande.choixOutil }),
      ...(demande.reflexion === undefined ? {} : { reasoning: demande.reflexion }),
    }),
  });
}

/** Le catalogue des modèles, relayé de la même façon — lecture seule. */
export async function relayerCatalogueLlm(): Promise<ReponseRelais> {
  const cle = laCle();
  if (!cle) return SANS_CLE;
  return appeler(URL_OPENROUTER_MODELES, cle, { method: 'GET' });
}
