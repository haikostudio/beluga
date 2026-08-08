import type { AnalysisMeasurement, ContextBreakdown, Estimate, TurnMeasurement } from './models.js';

/**
 * Additionne uniquement des grandeurs rendues par le moteur. Le cache est une
 * partie distincte de l'entrée : s'il manque, le total exact manque lui aussi.
 */
export function totalJetonsMesures(usage: {
  inputTokens: number;
  cachedInputTokens?: number;
  outputTokens: number;
}): number | undefined {
  if (usage.cachedInputTokens === undefined) return undefined;
  return usage.inputTokens + usage.cachedInputTokens + usage.outputTokens;
}

export function mesureDeContexte(input: {
  usage: TurnMeasurement['usage'];
  quota: TurnMeasurement['quota'];
  composition: TurnMeasurement['composition'];
}): AnalysisMeasurement {
  const { usage, quota, composition } = input;
  const instructions = Math.max(
    0,
    composition.promptCharacters + composition.systemPromptCharacters -
      composition.cardDescriptionCharacters - composition.memoryAndInstructionsCharacters,
  );
  const mesure = (characters: number, note: string): ContextBreakdown => ({
    status: 'measured',
    characters,
    note,
  });

  return {
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: totalJetonsMesures(usage),
    quota5h: quota.quota5h,
    quotaWeekly: quota.quotaWeekly,
    breakdown: {
      haikoDevInstructions: mesure(instructions, 'signes réellement envoyés par HaikoDev'),
      cardDescription: mesure(
        composition.cardDescriptionCharacters,
        'signes de la description réellement présents dans la demande',
      ),
      memoryAndInstructions: mesure(
        composition.memoryAndInstructionsCharacters,
        'signes du briefing, de la mémoire et des instructions envoyées à l’ouverture',
      ),
      agentReads: {
        status: 'unavailable',
        note: "le moteur inclut les lectures dans son total sans donner leur part séparée",
      },
    },
    measuredAt: Date.now(),
  };
}

/** Les mesures du moteur gagnent toujours sur les nombres rédigés par l'agent. */
export function avecMesureAnalyse(estimate: Estimate, turn: TurnMeasurement): Estimate {
  return { ...estimate, analysisMeasurement: mesureDeContexte(turn) };
}

export function valeurMesuree(value: number | undefined): string {
  return value === undefined ? 'indisponible' : value.toLocaleString('fr-CH');
}

export function totalMesureEnClair(measurement: AnalysisMeasurement): string {
  return measurement.totalTokens === undefined
    ? 'indisponible (cache non communiqué)'
    : valeurMesuree(measurement.totalTokens);
}
