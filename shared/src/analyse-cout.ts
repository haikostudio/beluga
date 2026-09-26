import type { AnalysisMeasurement, Card, ContextBreakdown, Estimate, TaskProposal, TurnMeasurement } from './models.js';

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
      belugaInstructions: mesure(instructions, 'caractères réellement envoyés par Beluga Build'),
      cardDescription: mesure(
        composition.cardDescriptionCharacters,
        'caractères de la description réellement présents dans la demande',
      ),
      memoryAndInstructions: mesure(
        composition.memoryAndInstructionsCharacters,
        'caractères du briefing, de la mémoire et des instructions envoyées à l’ouverture',
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

/**
 * Le tour du chef est le tour d'analyse de la proposition. Une fois le moteur
 * arrêté, Beluga Build ajoute sa mesure réelle au chiffrage rédigé avant l'appel
 * d'outil ; le modèle ne peut donc jamais fabriquer cette partie.
 */
export function finaliserAnalyseDeProposition(
  proposal: TaskProposal,
  turn: TurnMeasurement,
  producedAt = Date.now(),
): TaskProposal {
  if (!proposal.estimate || !proposal.analysisContext?.trim()) return proposal;
  return {
    ...proposal,
    estimate: {
      ...avecMesureAnalyse(proposal.estimate, turn),
      producedAt,
    },
  };
}

/** Une édition du sujet au dernier clic rend l'analyse précédente caduque. */
export function heritageAnalyseDeProposition(
  proposal: Pick<TaskProposal, 'title' | 'description' | 'estimate' | 'analysisContext'>,
  title: string,
  description: string,
): Pick<Card, 'estimate' | 'analysisContext'> {
  if (title !== proposal.title || description !== proposal.description) {
    return { estimate: undefined, analysisContext: undefined };
  }
  return { estimate: proposal.estimate, analysisContext: proposal.analysisContext };
}

/** Bloc explicite ajouté au premier tour de l'agent d'exécution. */
export function contexteHeritePourExecution(
  card: Pick<Card, 'analysisContext'>,
): string | undefined {
  const context = card.analysisContext?.trim();
  return context
    ? `ANALYSE DÉJÀ EFFECTUÉE PAR LE CHEF D'ORCHESTRE — reprends cette base, ne recommence pas son étude :\n${context}`
    : undefined;
}
