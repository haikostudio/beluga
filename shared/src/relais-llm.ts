/**
 * LE RELAIS LLM : un site extérieur parle au modèle SANS jamais porter la clé.
 *
 * Le cas réel : l'application de facturation (haiko-compta) est un site
 * statique. Tout ce qu'elle embarque part dans le navigateur — une clé
 * OpenRouter posée dans son `.env` se lisait donc en clair dans le code servi,
 * et n'importe qui pouvait la dépenser. La clé vit désormais dans le
 * COFFRE-FORT de Beluga Build, et le site passe par cette porte : il envoie sa
 * demande, le serveur y ajoute la clé et rend la réponse du modèle.
 *
 * Tout ce qui se décide sans réseau ni disque vit ici : l'adresse de la porte,
 * ce qu'une demande doit contenir, et comment on retrouve la clé parmi les
 * fiches du coffre. L'appel lui-même est dans `server/src/relais-llm.ts`.
 *
 * LA PORTE EST GARDÉE PAR LES MÊMES CLÉS NOMMÉES que la création de carte
 * (`cles-api.ts`) : une clé par service, révocable, qui n'ouvre que cette
 * porte. Elle ne donne accès à AUCUNE donnée du tableau.
 */

import { AccesCoffre } from './coffre-fort.js';

/** L'adresse de la porte. Une seule vérité : le serveur, le site appelant et le contrôle la lisent ici. */
export const ROUTE_LLM_EXTERNE = '/api/externe/llm';

/** L'adresse du catalogue des modèles, relayée de la même façon. */
export const ROUTE_LLM_MODELES_EXTERNE = '/api/externe/llm/modeles';

/** Le service, tel qu'il est écrit sur la fiche du coffre. */
export const SERVICE_OPENROUTER = 'openrouter';

/** Là où part la demande, une fois la clé posée dessus. */
export const URL_OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';
export const URL_OPENROUTER_MODELES = 'https://openrouter.ai/api/v1/models';

/**
 * GEMINI, SECOND FOURNISSEUR, APPELÉ EN DIRECT CHEZ GOOGLE. Un modèle nommé
 * « gemini/<modèle> » part vers le point compatible OpenAI de Google, avec la
 * clé « Google Gemini API » du coffre ; TOUT autre nom part vers OpenRouter,
 * exactement comme avant — les appelants existants ne voient aucun changement.
 */
export const SERVICE_GEMINI = 'gemini';
export const PREFIXE_MODELE_GEMINI = 'gemini/';
export const URL_GEMINI_OPENAI = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
export const URL_GEMINI_OPENAI_MODELES = 'https://generativelanguage.googleapis.com/v1beta/openai/models';

export type FournisseurLlm = 'openrouter' | 'gemini';

/** Qui sert ce modèle, et sous quel nom il faut le lui demander. */
export function fournisseurDuModele(modele: string): { fournisseur: FournisseurLlm; modele: string } {
  if (modele.startsWith(PREFIXE_MODELE_GEMINI) && modele.length > PREFIXE_MODELE_GEMINI.length) {
    return { fournisseur: 'gemini', modele: modele.slice(PREFIXE_MODELE_GEMINI.length) };
  }
  return { fournisseur: 'openrouter', modele };
}

/**
 * Le catalogue de Google (« models/gemini-… ») remis au nom que la porte
 * accepte (« gemini/gemini-… »), pour qu'un appelant puisse recopier l'id lu
 * dans le catalogue tel quel.
 */
export function modeleGeminiAuCatalogue(id: string): string {
  return PREFIXE_MODELE_GEMINI + id.replace(/^models\//, '');
}

/** Le modèle servi quand l'appelant n'en nomme aucun. */
export const MODELE_LLM_PAR_DEFAUT = 'google/gemini-2.5-flash-lite';

/** Les bornes d'une demande : de quoi rédiger un texte, pas de quoi vider un quota. */
export const MESSAGES_LLM_MAX = 40;
export const SIGNES_MESSAGE_LLM_MAX = 60_000;
export const SIGNES_DEMANDE_LLM_MAX = 200_000;

/** Combien d'outils un appelant peut proposer au modèle. */
export const OUTILS_LLM_MAX = 60;

const ROLES = new Set(['system', 'user', 'assistant', 'tool']);

/**
 * Un message TEL QUEL. On garde les champs supplémentaires (`tool_calls`,
 * `tool_call_id`) : l'assistant de la facturation appelle des outils, et couper
 * ces champs casserait la conversation au deuxième tour.
 */
export type MessageLlm = Record<string, unknown> & { role: string };

export interface DemandeLlm {
  modele: string;
  messages: MessageLlm[];
  temperature?: number;
  maxTokens?: number;
  /** Les outils proposés au modèle, transmis tels quels. */
  outils?: unknown;
  choixOutil?: unknown;
  /** L'effort de réflexion demandé, transmis tel quel. */
  reflexion?: unknown;
}

export type JugementDemandeLlm = { ok: true; demande: DemandeLlm } | { ok: false; raison: string };

function nombre(valeur: unknown): number | undefined {
  if (typeof valeur !== 'number' || !Number.isFinite(valeur)) return undefined;
  return valeur;
}

/**
 * Ce qu'un envoi doit contenir : au moins un message, chacun avec un rôle connu.
 * Le modèle est facultatif — sans lui, c'est le modèle par défaut.
 *
 * Une demande hors bornes est REFUSÉE en le disant, jamais tronquée en silence :
 * l'appelant doit savoir que sa demande n'est pas partie entière. Ce qui n'est
 * pas dans cette liste ne passe pas : la porte relaie une conversation, elle
 * n'ouvre pas tout OpenRouter à qui présente la clé.
 */
export function jugerDemandeLlm(brut: unknown): JugementDemandeLlm {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) {
    return { ok: false, raison: "L'envoi doit être un objet JSON." };
  }
  const source = brut as Record<string, unknown>;

  const modeleBrut = source.modele ?? source.model;
  const modele =
    typeof modeleBrut === 'string' && modeleBrut.trim() ? modeleBrut.trim() : MODELE_LLM_PAR_DEFAUT;

  const brutMessages = source.messages;
  if (!Array.isArray(brutMessages) || brutMessages.length === 0) {
    return { ok: false, raison: 'Il faut au moins un message (champ « messages »).' };
  }
  if (brutMessages.length > MESSAGES_LLM_MAX) {
    return { ok: false, raison: `Pas plus de ${MESSAGES_LLM_MAX} messages par demande.` };
  }

  const messages: MessageLlm[] = [];
  for (const m of brutMessages) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) {
      return { ok: false, raison: 'Chaque message doit être un objet { role, content }.' };
    }
    const message = m as Record<string, unknown>;
    if (typeof message.role !== 'string' || !ROLES.has(message.role)) {
      return {
        ok: false,
        raison: 'Le rôle d’un message vaut « system », « user », « assistant » ou « tool ».',
      };
    }
    const contenu = message.content;
    if (contenu !== null && contenu !== undefined && typeof contenu !== 'string') {
      return { ok: false, raison: 'Le texte d’un message doit être une chaîne.' };
    }
    if (typeof contenu === 'string' && contenu.length > SIGNES_MESSAGE_LLM_MAX) {
      return { ok: false, raison: `Un message dépasse ${SIGNES_MESSAGE_LLM_MAX} signes.` };
    }
    messages.push(message as MessageLlm);
  }

  if (JSON.stringify(messages).length > SIGNES_DEMANDE_LLM_MAX) {
    return { ok: false, raison: `La demande dépasse ${SIGNES_DEMANDE_LLM_MAX} signes en tout.` };
  }

  const demande: DemandeLlm = { modele, messages };

  const temperature = nombre(source.temperature);
  if (temperature !== undefined) {
    if (temperature < 0 || temperature > 2) {
      return { ok: false, raison: 'La température se situe entre 0 et 2.' };
    }
    demande.temperature = temperature;
  }

  const maxTokens = nombre(source.maxTokens ?? source.max_tokens);
  if (maxTokens !== undefined) {
    if (maxTokens < 1 || maxTokens > 100_000) {
      return { ok: false, raison: 'La limite de jetons se situe entre 1 et 100 000.' };
    }
    demande.maxTokens = Math.floor(maxTokens);
  }

  const outils = source.outils ?? source.tools;
  if (outils !== undefined) {
    if (!Array.isArray(outils)) return { ok: false, raison: 'Les outils doivent former une liste.' };
    if (outils.length > OUTILS_LLM_MAX) {
      return { ok: false, raison: `Pas plus de ${OUTILS_LLM_MAX} outils par demande.` };
    }
    demande.outils = outils;
  }

  const choixOutil = source.choixOutil ?? source.tool_choice;
  if (choixOutil !== undefined) demande.choixOutil = choixOutil;

  const reflexion = source.reflexion ?? source.reasoning;
  if (reflexion !== undefined) demande.reflexion = reflexion;

  return { ok: true, demande };
}

/**
 * Le nom EXACT de la fiche du coffre qui porte la clé OpenRouter de l'espace
 * « Haiko » (relais et génération du Studio). Fiche et constante se renomment
 * ENSEMBLE : si elles divergent, le relais perd sa clé.
 */
export const NOM_FICHE_OPENROUTER_RELAIS = 'OpenRouter — Haiko — relais IA';

/**
 * La clé OpenRouter du relais : la fiche de type « clé d'API » dont le nom est
 * exactement `NOM_FICHE_OPENROUTER_RELAIS`. AUCUN repli : une autre fiche
 * OpenRouter, même plus récente, ne la supplante jamais (le 27/09/2026 une
 * sous-clé plafonnée d'un autre projet avait pris sa place, 403 sur tout
 * l'assistant). Fiche absente ou sans clé : rien.
 */
export function cleOpenRouterDuRelais(acces: AccesCoffre[]): string | undefined {
  const fiche = acces.find(
    (a) => a.type === 'cle-api' && a.nom === NOM_FICHE_OPENROUTER_RELAIS && typeof a.champs?.cle === 'string' && a.champs.cle.trim(),
  );
  return fiche?.champs.cle.trim();
}

/**
 * La clé Gemini, trouvée de la même façon. Une fiche qui nomme AUSSI OpenRouter
 * (une clé OpenRouter notée « pour Gemini ») n'est pas une clé Google.
 */
export function cleGeminiDuCoffre(acces: AccesCoffre[]): string | undefined {
  return cleDuServiceDansLeCoffre(acces, SERVICE_GEMINI, SERVICE_OPENROUTER);
}

function cleDuServiceDansLeCoffre(acces: AccesCoffre[], service: string, sauf?: string): string | undefined {
  const candidates = acces
    .filter((a) => a.type === 'cle-api' && typeof a.champs?.cle === 'string' && a.champs.cle.trim())
    .filter((a) => {
      const empreinte = [a.champs.service, a.nom, a.champs.adresse].join(' ').toLowerCase();
      return empreinte.includes(service) && !(sauf && empreinte.includes(sauf));
    })
    .sort((a, b) => (b.modifieLe || b.creeLe || 0) - (a.modifieLe || a.creeLe || 0));
  return candidates[0]?.champs.cle.trim();
}
