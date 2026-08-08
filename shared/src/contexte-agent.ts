import { z } from 'zod';

/**
 * La place réellement occupée dans le contexte d'un agent. Les trois nombres
 * voyagent ensemble : sans mesure ou sans capacité, le contexte entier reste
 * absent — jamais transformé en un faux 0 %.
 */
export const AgentContextUsage = z.object({
  usedTokens: z.number().int().nonnegative(),
  capacityTokens: z.number().int().positive(),
  percentage: z.number().int().min(0).max(100),
  measuredAt: z.number(),
});
export type AgentContextUsage = z.infer<typeof AgentContextUsage>;

/** Calcule un pourcentage lisible, borné à 100 %, seulement à partir d'une vraie mesure. */
export function mesurerContexte(
  usedTokens: number | undefined,
  capacityTokens: number | undefined,
  measuredAt = Date.now(),
): AgentContextUsage | undefined {
  if (!Number.isFinite(usedTokens) || !Number.isFinite(capacityTokens)) return undefined;
  if ((usedTokens as number) < 0 || (capacityTokens as number) <= 0) return undefined;

  const utilises = Math.round(usedTokens as number);
  const capacite = Math.round(capacityTokens as number);
  if (capacite <= 0) return undefined;

  return AgentContextUsage.parse({
    usedTokens: utilises,
    capacityTokens: capacite,
    percentage: Math.min(100, Math.max(0, Math.round((utilises / capacite) * 100))),
    measuredAt,
  });
}
