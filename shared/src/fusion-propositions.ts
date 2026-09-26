import type { AnalysisMeasurement, ContextBreakdown, Estimate, TaskProposal } from './models.js';

type Partie = 'constat' | 'attendu' | 'limites' | 'verification';

const PARTIES: Partie[] = ['constat', 'attendu', 'limites', 'verification'];

const ENTETES: Record<Partie, RegExp> = {
  constat:
    /^(?:#{1,6}\s*)?(?:\*\*)?\s*(?:constat|aujourd['’]?hui|état actuel|ce qui se passe|situation actuelle)\s*(?:\*\*)?\s*(?::|[-–—])?\s*(.*)$/i,
  attendu:
    /^(?:#{1,6}\s*)?(?:\*\*)?\s*(?:attendu|ce qui est attendu|résultat attendu|objectif|ce que ça doit faire|à obtenir)\s*(?:\*\*)?\s*(?::|[-–—])?\s*(.*)$/i,
  limites:
    /^(?:#{1,6}\s*)?(?:\*\*)?\s*(?:limites?|à ne pas|ne pas toucher|hors sujet|périmètre|garde-fous?|interdits?)\s*(?:\*\*)?\s*(?::|[-–—])?\s*(.*)$/i,
  verification:
    /^(?:#{1,6}\s*)?(?:\*\*)?\s*(?:vérification|vérifier|contrôle|comment le voir|preuve|tests?)\s*(?:\*\*)?\s*(?::|[-–—])?\s*(.*)$/i,
};

const INTERTITRES: Record<Partie, string> = {
  constat: 'Constat',
  attendu: 'Attendu',
  limites: 'Limites',
  verification: 'Vérification',
};

function texteCompact(texte: string): string {
  return texte.replace(/\s+/g, ' ').trim();
}

function uniques(valeurs: string[]): string[] {
  const vus = new Set<string>();
  return valeurs.filter((valeur) => {
    const cle = texteCompact(valeur).toLocaleLowerCase('fr');
    if (!cle || vus.has(cle)) return false;
    vus.add(cle);
    return true;
  });
}

/**
 * Relit les quatre parties déjà exigées par `description-carte`. Le contenu
 * compris entre deux intertitres reste attaché au bon sujet, quelle que soit
 * la forme tolérée par l'outil (gras, titre Markdown ou simple « Constat : »).
 */
export function partiesDUneDescription(description: string): Record<Partie, string> {
  const morceaux: Record<Partie, string[]> = {
    constat: [],
    attendu: [],
    limites: [],
    verification: [],
  };
  let courante: Partie | undefined;
  const avantPremierTitre: string[] = [];

  for (const ligne of description.split('\n')) {
    const propre = ligne.trim();
    let trouvee: Partie | undefined;
    let suite = '';
    for (const partie of PARTIES) {
      const correspondance = propre.match(ENTETES[partie]);
      if (!correspondance) continue;
      trouvee = partie;
      suite = correspondance[1] ?? '';
      break;
    }
    if (trouvee) {
      courante = trouvee;
      if (suite.trim()) morceaux[courante].push(suite.trim());
    } else if (propre) {
      if (courante) morceaux[courante].push(propre);
      else avantPremierTitre.push(propre);
    }
  }

  // Une ancienne description atypique n'est jamais perdue : ce qui précède
  // son premier intertitre rejoint le constat de départ.
  if (avantPremierTitre.length) morceaux.constat.unshift(...avantPremierTitre);
  return Object.fromEntries(
    PARTIES.map((partie) => [partie, texteCompact(morceaux[partie].join(' '))]),
  ) as Record<Partie, string>;
}

/** Les étapes attendues gardent leur ordre ; les autres sections sont des listes. */
export function composerDescriptionFusionnee(propositions: TaskProposal[]): string {
  const parties = propositions.map((proposal) => partiesDUneDescription(proposal.description));
  return PARTIES.map((partie) => {
    const contenus = uniques(parties.map((description) => description[partie]));
    const corps =
      partie === 'attendu' && contenus.length > 1
        ? `Étapes successives :\n${contenus.map((contenu, index) => `${index + 1}. ${contenu}`).join('\n')}`
        : contenus.length > 1
          ? contenus.map((contenu) => `- ${contenu}`).join('\n')
          : contenus[0] ?? '';
    return `**${INTERTITRES[partie]}** : ${corps}`;
  }).join('\n\n');
}

function sommeComplete(valeurs: (number | undefined)[]): number | undefined {
  return valeurs.length && valeurs.every((valeur) => valeur !== undefined)
    ? (valeurs as number[]).reduce((total, valeur) => total + valeur, 0)
    : undefined;
}

function mesureFusionnee(mesures: AnalysisMeasurement[]): AnalysisMeasurement | undefined {
  const distinctes = mesures.filter(
    (mesure, index, liste) =>
      liste.findIndex((autre) => autre.measuredAt === mesure.measuredAt && JSON.stringify(autre) === JSON.stringify(mesure)) === index,
  );
  if (!distinctes.length) return undefined;

  const detail = (cle: keyof AnalysisMeasurement['breakdown']): ContextBreakdown => {
    const valeurs = distinctes.map((mesure) => mesure.breakdown[cle]);
    if (valeurs.every((valeur) => valeur.status === 'measured')) {
      return {
        status: 'measured',
        characters: valeurs.reduce((total, valeur) => total + (valeur.characters ?? 0), 0),
        note: 'somme des analyses distinctes des propositions réunies',
      };
    }
    return { status: 'unavailable', note: 'une part des analyses réunies n’est pas isolable' };
  };

  return {
    inputTokens: sommeComplete(distinctes.map((mesure) => mesure.inputTokens)) ?? 0,
    cachedInputTokens: sommeComplete(distinctes.map((mesure) => mesure.cachedInputTokens)),
    outputTokens: sommeComplete(distinctes.map((mesure) => mesure.outputTokens)) ?? 0,
    totalTokens: sommeComplete(distinctes.map((mesure) => mesure.totalTokens)),
    quota5h: sommeComplete(distinctes.map((mesure) => mesure.quota5h)),
    quotaWeekly: sommeComplete(distinctes.map((mesure) => mesure.quotaWeekly)),
    breakdown: {
      belugaInstructions: detail('belugaInstructions'),
      cardDescription: detail('cardDescription'),
      memoryAndInstructions: detail('memoryAndInstructions'),
      agentReads: detail('agentReads'),
    },
    measuredAt: Math.max(...distinctes.map((mesure) => mesure.measuredAt)),
  };
}

const ORDRE_CONFIANCE = { low: 0, medium: 1, high: 2 } as const;

/**
 * Les travaux réunis sont successifs : on additionne seulement des valeurs
 * toutes connues. Une donnée manquante reste indisponible au lieu de produire
 * un total trop optimiste. Une estimation en échec force un nouveau chiffrage.
 */
export function estimationFusionnee(propositions: TaskProposal[]): Estimate | undefined {
  const estimations = propositions.map((proposal) => proposal.estimate);
  if (!estimations.length || estimations.some((estimation) => !estimation || estimation.failed)) return undefined;
  const connues = estimations as Estimate[];
  const confiances = connues.map((estimation) => estimation.confidence).filter(Boolean) as Array<keyof typeof ORDRE_CONFIANCE>;
  const confidence = confiances.length
    ? confiances.reduce((plusFaible, courante) =>
        ORDRE_CONFIANCE[courante] < ORDRE_CONFIANCE[plusFaible] ? courante : plusFaible,
      )
    : undefined;
  const projections = connues.map((estimation) => estimation.projection);
  const assumptions = uniques(projections.flatMap((projection) => projection?.assumptions ?? []));

  return {
    machineSeconds: sommeComplete(connues.map((estimation) => estimation.machineSeconds)),
    tokens: sommeComplete(connues.map((estimation) => estimation.tokens)),
    quotaShare: sommeComplete(connues.map((estimation) => estimation.quotaShare)),
    seniorHours: sommeComplete(connues.map((estimation) => estimation.seniorHours)),
    projection: projections.every(Boolean)
      ? {
          tokens: sommeComplete(projections.map((projection) => projection?.tokens)),
          quotaShare: sommeComplete(projections.map((projection) => projection?.quotaShare)),
          formula: `Somme prudente des ${propositions.length} travaux réunis.`,
          assumptions,
        }
      : undefined,
    analysisMeasurement: mesureFusionnee(
      connues.map((estimation) => estimation.analysisMeasurement).filter(Boolean) as AnalysisMeasurement[],
    ),
    confidence,
    summary: uniques(connues.map((estimation) => estimation.summary ?? '')).join(' '),
    billingTitle: `Travail réuni — ${propositions.map((proposal) => proposal.title).join(' / ')}`,
    billingDescription: uniques(connues.map((estimation) => estimation.billingDescription ?? '')).join(' '),
    clientExplanation: uniques(connues.map((estimation) => estimation.clientExplanation ?? '')).join(' '),
    failed: false,
    producedAt: Math.max(...connues.map((estimation) => estimation.producedAt ?? 0)) || undefined,
  };
}

function memeReglage(a: TaskProposal['run'], b: TaskProposal['run']): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Compose une proposition neuve sans valider, lancer ni créer de carte. */
export function fusionnerPropositions(propositions: TaskProposal[], id: string): TaskProposal {
  if (propositions.length < 2) throw new Error('au moins deux propositions sont nécessaires');
  if (propositions.some((proposal) => proposal.decision !== 'pending')) {
    throw new Error('seules des propositions encore en attente peuvent être fusionnées');
  }

  const reglagesDifferents = propositions.slice(1).some((proposal) => !memeReglage(proposal.run, propositions[0].run));
  const avertissements = uniques([
    ...propositions.map((proposal) => proposal.avertissement ?? ''),
    reglagesDifferents
      ? 'Les propositions réunies avaient des réglages différents : vérifiez le moteur, le modèle et la réflexion avant de créer la carte.'
      : '',
  ]);
  const contexts = uniques(propositions.map((proposal) => proposal.analysisContext ?? ''));
  const estimate = estimationFusionnee(propositions);

  return {
    id,
    title: `Regrouper — ${propositions.map((proposal) => proposal.title).join(' / ')}`,
    description: composerDescriptionFusionnee(propositions),
    labels: uniques(propositions.flatMap((proposal) => proposal.labels)),
    attachments: uniques(propositions.flatMap((proposal) => proposal.attachments)),
    sourceProposalIds: uniques(propositions.flatMap((proposal) => [proposal.id, ...proposal.sourceProposalIds])),
    ...(propositions[0].run ? { run: propositions[0].run } : {}),
    ...(estimate ? { estimate } : {}),
    ...(contexts.length
      ? {
          analysisContext: propositions
            .filter((proposal) => proposal.analysisContext?.trim())
            .map((proposal) => `${proposal.title} : ${proposal.analysisContext!.trim()}`)
            .join('\n\n'),
        }
      : {}),
    /*
     * LES SYNTHÈSES SE SUIVENT, ELLES NE SE REMPLACENT PAS. Chaque proposition
     * réunie portait le besoin d'un utilisateur : la carte fusionnée ouvre donc
     * sa conversation sur les deux, l'une sous l'autre, chacune sous son titre.
     */
    ...(propositions.some((proposal) => proposal.briefing?.trim())
      ? {
          briefing: propositions
            .filter((proposal) => proposal.briefing?.trim())
            .map((proposal) => `**${proposal.title}**\n\n${proposal.briefing!.trim()}`)
            .join('\n\n'),
        }
      : {}),
    ...(avertissements.length ? { avertissement: avertissements.join(' ') } : {}),
    decision: 'pending',
  };
}
