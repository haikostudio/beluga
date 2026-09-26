import { z } from 'zod';

/** Une valeur réellement fournie par le moteur, ou l'absence dite explicitement. */
export const MetriqueNumeriqueDeSession = z.discriminatedUnion('status', [
  z.object({ status: z.literal('measured'), value: z.number().nonnegative() }),
  z.object({ status: z.literal('unavailable') }),
]);
export type MetriqueNumeriqueDeSession = z.infer<typeof MetriqueNumeriqueDeSession>;

/** Le niveau du contexte garde la mesure complète, pas seulement un pourcentage isolé. */
export const NiveauContexteDeSession = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('measured'),
    usedTokens: z.number().int().nonnegative(),
    capacityTokens: z.number().int().positive(),
    percentage: z.number().int().min(0).max(100),
  }),
  z.object({ status: z.literal('unavailable') }),
]);
export type NiveauContexteDeSession = z.infer<typeof NiveauContexteDeSession>;

/**
 * La photographie du dernier tour LLM de la carte.
 *
 * `state` distingue une session aboutie, interrompue, ou une carte ancienne
 * pour laquelle aucun relevé de session n'existe. Chaque mesure garde en plus
 * sa propre disponibilité : une interruption peut avoir rendu les jetons mais
 * pas le contexte, par exemple.
 */
export const MetriquesSessionLlm = z.object({
  state: z.enum(['completed', 'interrupted', 'unavailable']),
  inputTokens: MetriqueNumeriqueDeSession,
  outputTokens: MetriqueNumeriqueDeSession,
  durationMs: MetriqueNumeriqueDeSession,
  contextLevel: NiveauContexteDeSession,
  recordedAt: z.number(),
});
export type MetriquesSessionLlm = z.infer<typeof MetriquesSessionLlm>;

export interface ReleveBrutDeSession {
  state: 'completed' | 'interrupted';
  usage?: { inputTokens?: number; outputTokens?: number };
  durationMs?: number;
  context?: { tokens?: number; window?: number };
  recordedAt?: number;
}

function nombreMesure(value: number | undefined): MetriqueNumeriqueDeSession {
  return Number.isFinite(value) && (value as number) >= 0
    ? { status: 'measured', value: value as number }
    : { status: 'unavailable' };
}

function niveauContexte(context: ReleveBrutDeSession['context']): NiveauContexteDeSession {
  if (!Number.isFinite(context?.tokens) || !Number.isFinite(context?.window)) return { status: 'unavailable' };
  if ((context?.tokens as number) < 0 || (context?.window as number) <= 0) return { status: 'unavailable' };
  const usedTokens = Math.round(context?.tokens as number);
  const capacityTokens = Math.round(context?.window as number);
  if (capacityTokens <= 0) return { status: 'unavailable' };
  return {
    status: 'measured',
    usedTokens,
    capacityTokens,
    percentage: Math.min(100, Math.max(0, Math.round((usedTokens / capacityTokens) * 100))),
  };
}

/** Fabrique la photographie sans transformer une absence en zéro. */
export function metriquesDeSessionLlm(releve: ReleveBrutDeSession): MetriquesSessionLlm {
  return MetriquesSessionLlm.parse({
    state: releve.state,
    inputTokens: nombreMesure(releve.usage?.inputTokens),
    outputTokens: nombreMesure(releve.usage?.outputTokens),
    durationMs: nombreMesure(releve.durationMs),
    contextLevel: niveauContexte(releve.context),
    recordedAt: releve.recordedAt ?? Date.now(),
  });
}

/** Une carte sans relevé garde quatre absences explicites au passage en déploiement. */
export function metriquesSessionLlmIndisponibles(
  state: 'interrupted' | 'unavailable' = 'unavailable',
  recordedAt = Date.now(),
): MetriquesSessionLlm {
  return MetriquesSessionLlm.parse({
    state,
    inputTokens: { status: 'unavailable' },
    outputTokens: { status: 'unavailable' },
    durationMs: { status: 'unavailable' },
    contextLevel: { status: 'unavailable' },
    recordedAt,
  });
}
