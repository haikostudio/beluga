import { totalJetonsMesures } from './analyse-cout.js';
import { coutDuTour } from './cout-tour.js';
import type {
  AnalysisMeasurement,
  Estimate,
  ExecutionProjection,
  SentContextBlock,
  SentContextSnapshot,
} from './models.js';

/**
 * LES TOKENS D'UNE CARTE, RANGÉS PAR COUCHE.
 *
 * Le tiroir « Contexte envoyé » lit d'abord ce qui était ESTIMÉ, puis ce qui a
 * été RÉELLEMENT mesuré — et le réel se lit couche par couche : la réflexion du
 * chef d'orchestre d'un côté, l'exécution de la tâche de l'autre. C'est cette
 * séparation qui permet de voir OÙ le contexte part.
 *
 * Aucune de ces fonctions ne mesure quoi que ce soit : elles ne font que
 * regrouper des chiffres déjà rendus par le moteur. Ce qui n'a pas été mesuré
 * reste `undefined` et s'affiche « indisponible » — jamais un zéro consolant.
 */

/** Un tour déjà mesuré, tel que le démon le range dans la table `usage`. */
export interface TourMesureAgent {
  at: number;
  engine?: string;
  model?: string;
  /** Entrée nouvelle, hors cache relu. */
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  /** Total rangé pour les quotas et la facturation : jamais recalculé ici. */
  tokens: number;
  seconds: number;
}

export type CleCouche = 'analyse' | 'execution';

/** Ce qu'une couche a envoyé et reçu, additionné une seule fois. */
export interface CoucheDeTokens {
  cle: CleCouche;
  nom: string;
  /** En une phrase : d'où viennent ces chiffres. */
  origine: string;
  /** Nombre de tours réellement mesurés, quand ils sont comptés un par un. */
  tours?: number;
  /** Entrée nouvelle, hors cache. */
  entree: number;
  /** Absent quand le moteur n'a pas communiqué la part relue depuis le cache. */
  cache?: number;
  sortie: number;
  /** Absent dès qu'une part manque : un total partiel serait un faux total. */
  total?: number;
  /** En francs, seulement si le tarif de CHAQUE tour compté est connu. */
  cout?: number;
}

/** Un tour dont le moteur n'a rien rendu ne compte pas comme un tour mesuré. */
export function tourMesure(tour: TourMesureAgent): boolean {
  return tour.inputTokens + tour.cachedTokens + tour.outputTokens > 0;
}

/**
 * LA COUCHE DE RÉFLEXION : ce que le chiffrage du chef d'orchestre a consommé.
 * Elle vient de la mesure rangée sur la carte (`estimate.analysisMeasurement`),
 * qui ne porte pas le modèle employé — son coût en francs reste donc inconnu.
 */
export function coucheDAnalyse(mesure?: AnalysisMeasurement): CoucheDeTokens | undefined {
  if (!mesure) return undefined;
  return {
    cle: 'analyse',
    nom: 'Analyse par le chef d’orchestre',
    origine: 'Mesure rendue par le moteur à la fin du chiffrage.',
    entree: mesure.inputTokens,
    cache: mesure.cachedInputTokens,
    sortie: mesure.outputTokens,
    total: mesure.totalTokens ?? totalJetonsMesures(mesure),
    cout: undefined,
  };
}

/**
 * LA COUCHE D'EXÉCUTION : la somme des tours réellement partis pour cet agent.
 * Le coût n'est donné que si TOUS les tours comptés portent un modèle tarifé —
 * un seul tarif manquant, et le total serait sous-évalué sans le dire.
 */
export function coucheDExecution(
  tours: TourMesureAgent[],
  nom = 'Exécution de la tâche',
): CoucheDeTokens | undefined {
  const mesures = tours.filter(tourMesure);
  if (!mesures.length) return undefined;

  const somme = (lire: (tour: TourMesureAgent) => number) =>
    mesures.reduce((total, tour) => total + lire(tour), 0);

  const couts = mesures.map((tour) =>
    coutDuTour({
      inputTokens: tour.inputTokens,
      cachedTokens: tour.cachedTokens,
      outputTokens: tour.outputTokens,
      model: tour.model,
    }),
  );

  const entree = somme((tour) => tour.inputTokens);
  const cache = somme((tour) => tour.cachedTokens);
  const sortie = somme((tour) => tour.outputTokens);
  return {
    cle: 'execution',
    nom,
    origine: 'Somme des tours mesurés de cet agent.',
    tours: mesures.length,
    entree,
    cache,
    sortie,
    total: entree + cache + sortie,
    cout: couts.some((cout) => cout === undefined)
      ? undefined
      : couts.reduce<number>((total, cout) => total + (cout ?? 0), 0),
  };
}

/**
 * LA PROJECTION D'EXÉCUTION du chiffrage. Une analyse ancienne n'écrivait que
 * `tokens` et `quotaShare` à plat : on la relit sous la même forme que les
 * projections d'aujourd'hui, sans rien inventer de plus.
 */
export function projectionDeLExecution(estimate?: Estimate): ExecutionProjection | undefined {
  if (!estimate) return undefined;
  if (estimate.projection) return estimate.projection;
  if (estimate.tokens === undefined && estimate.quotaShare === undefined) return undefined;
  return { tokens: estimate.tokens, quotaShare: estimate.quotaShare, assumptions: [] };
}

/**
 * L'écart entre ce qui était projeté et ce qui a été mesuré, en part du projeté.
 * Rien à comparer, projection à zéro : `undefined`, jamais une division vide.
 */
export function ecartProjete(projete?: number, mesure?: number): number | undefined {
  if (projete === undefined || mesure === undefined || projete <= 0) return undefined;
  return (mesure - projete) / projete;
}

/**
 * Estimation maison — la même que `scripts/mesure-jetons.mjs` — quand aucune
 * mesure du moteur n'existe pour une part du contexte : environ quatre signes
 * par jeton.
 */
export function jetonsApproches(caracteres: number): number {
  return Math.max(0, Math.round(caracteres / 4));
}

/**
 * LE VOLET « CONTEXTE ENVOYÉ », EN DEUX PARTIES : ce qui vient de la mémoire du
 * projet (les blocs `kind: 'memory'` — l'index complet au premier tour, les
 * seuls faits ajoutés ensuite) contre ce qui a été RÉELLEMENT envoyé au moteur
 * pour ce tour (la mesure d'entrée rendue par le moteur, cache compris). La
 * mémoire est estimée en tokens depuis ses caractères, faute d'une mesure du
 * moteur qui la découpe bloc par bloc ; l'envoi, lui, est la vraie mesure quand
 * elle est connue.
 */
export interface RepartitionMemoireEnvoi {
  memoireTokens: number;
  envoyeTokens?: number;
  /** Part de la mémoire dans l'envoi — indéfinie tant que l'envoi n'est pas mesuré. */
  part?: number;
}

export function repartitionMemoireEnvoi(
  blocks: SentContextBlock[],
  usage?: { inputTokens: number; cachedInputTokens?: number },
): RepartitionMemoireEnvoi {
  const memoireCaracteres = blocks
    .filter((bloc) => bloc.kind === 'memory')
    .reduce((total, bloc) => total + bloc.characters, 0);
  const memoireTokens = jetonsApproches(memoireCaracteres);
  const envoyeTokens = usage ? usage.inputTokens + (usage.cachedInputTokens ?? 0) : undefined;
  const part = envoyeTokens !== undefined && envoyeTokens > 0 ? memoireTokens / envoyeTokens : undefined;
  return { memoireTokens, envoyeTokens, part };
}

/**
 * POURQUOI AUCUN PASSAGE n'a été retrouvé pour ce tour — le tiroir « Contexte
 * envoyé » doit le DIRE en clair plutôt que laisser une case à zéro. Trois cas,
 * dans l'ordre où le démon les rencontre (`server/src/runtime.ts`) :
 *  1. reprise de session — la mémoire est déjà dans le contexte du moteur ;
 *  2. accueil sans mémoire (tri du chef, dépannage) ;
 *  3. recherche tentée mais repliée sur l'index complet (rien au-dessus du
 *     seuil, ou plus cher que l'index).
 */
/**
 * LA CHRONOLOGIE DU TIROIR « CONTEXTE ENVOYÉ » : un bloc par tour RÉELLEMENT
 * parti, dans l'ordre où il est parti. Chaque message porte son propre
 * instantané (`message.sentContext`) — cette fonction ne fait que les
 * rassembler et les numéroter, sans rien recalculer ni deviner.
 */
export interface TourEnvoye {
  /** 1 au premier tour parti de la conversation, croît ensuite. */
  numero: number;
  messageId: string;
  contexte: SentContextSnapshot;
  repartition: RepartitionMemoireEnvoi;
}

export function chronologieContexteEnvoye(
  messages: { id: string; sentContext?: SentContextSnapshot }[],
): TourEnvoye[] {
  return messages
    .filter((message): message is typeof message & { sentContext: SentContextSnapshot } =>
      Boolean(message.sentContext),
    )
    .sort((a, b) => a.sentContext.sentAt - b.sentContext.sentAt)
    .map((message, index) => ({
      numero: index + 1,
      messageId: message.id,
      contexte: message.sentContext,
      repartition: repartitionMemoireEnvoi(message.sentContext.blocks, message.sentContext.usage),
    }));
}

/** Le récapitulatif en tête du tiroir : de quoi comparer les tours entre eux. */
export interface RecapitulatifEnvoi {
  tours: number;
  memoireTotale: number;
  /** Absent tant qu'aucun tour n'a reçu sa mesure d'entrée du moteur. */
  envoyeTotal?: number;
}

export function recapitulatifEnvoi(tours: TourEnvoye[]): RecapitulatifEnvoi {
  const memoireTotale = tours.reduce((total, tour) => total + tour.repartition.memoireTokens, 0);
  const mesures = tours.filter((tour) => tour.repartition.envoyeTokens !== undefined);
  const envoyeTotal = mesures.length
    ? mesures.reduce((total, tour) => total + (tour.repartition.envoyeTokens ?? 0), 0)
    : undefined;
  return { tours: tours.length, memoireTotale, envoyeTotal };
}

export function raisonAbsenceDePassages(input: {
  nouvelleSession: boolean;
  accueilEmporteLaMemoire: boolean;
  /**
   * Vrai quand la recherche a RÉELLEMENT tourné sur la demande de ce tour et
   * n'a rien rapporté de neuf. Cette raison-là passe avant toutes les autres :
   * dire « reprise de session » d'une recherche qui vient d'avoir lieu serait
   * faux, et c'est exactement ce que la bulle vient vérifier.
   */
  rechercheTentee?: boolean;
}): string {
  if (input.rechercheTentee) {
    return 'La recherche a bien tourné sur cette demande : rien de neuf au-dessus du seuil de pertinence. Les passages déjà transmis plus haut dans ce fil ne sont pas renvoyés.';
  }
  if (!input.nouvelleSession) {
    return 'Reprise de session : la mémoire a déjà été transmise au premier tour de ce fil, seuls les faits ajoutés depuis sont renvoyés.';
  }
  if (!input.accueilEmporteLaMemoire) {
    return 'Cet accueil (tri du chef ou dépannage) n’emporte pas la mémoire du projet.';
  }
  return 'Repli sur l’index complet de la mémoire : la recherche n’a rien trouvé au-dessus du seuil de pertinence, ou coûterait plus cher que l’index.';
}
