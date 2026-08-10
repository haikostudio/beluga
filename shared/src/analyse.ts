import { ColumnKey } from './columns.js';

/**
 * Où en est l'analyse d'une carte.
 *
 * L'analyse est un vrai agent : elle lit le projet, explique ce qu'elle a
 * compris, ce qu'elle a trouvé, comment elle s'y prendrait, et elle chiffre.
 * Son compte rendu doit se lire DÈS QU'IL EST FINI, sans attendre le lancement
 * de la tâche — c'est la seule chose qui permette de décider.
 *
 * La décision vit ici, sans réseau ni base : elle se teste seule.
 */

export type PhaseAnalyse = 'aucune' | 'en_cours' | 'prete' | 'echouee';

export interface EtatAnalyse {
  /** Colonne de la carte. */
  column: ColumnKey;
  /** L'analyse a rendu ses chiffres. */
  aEstimation: boolean;
  /** L'analyse a rendu quelque chose, mais pas de chiffres exploitables. */
  estimationEchouee: boolean;
  /** Un agent d'analyse tourne en ce moment pour cette carte. */
  analyseEnCours: boolean;
  /**
   * La carte a été validée et attend son chiffrage. C'est le drapeau de la
   * carte (`analyseDemandee`) qui le dit, plus une colonne : « Validé » comme
   * « À faire » n'existent plus, la carte reste dans « Planifié » le temps de
   * l'analyse.
   */
  analyseDemandee?: boolean;
}

/**
 * Une carte validée sans chiffres est en cours d'analyse : soit son agent
 * tourne déjà, soit l'ordonnanceur va le lancer d'un instant à l'autre. Dans
 * les deux cas la conversation doit le DIRE, au lieu de rester vide.
 */
export function phaseAnalyse(etat: EtatAnalyse): PhaseAnalyse {
  if (etat.analyseEnCours) return 'en_cours';
  if (etat.estimationEchouee) return 'echouee';
  if (etat.aEstimation) return 'prete';
  if (etat.analyseDemandee) return 'en_cours';
  return 'aucune';
}

/** Ce qui s'affiche dans une conversation encore vide. */
export function motAnalyse(phase: PhaseAnalyse): { titre: string; indice: string } {
  switch (phase) {
    case 'en_cours':
      return {
        titre: 'Analyse en cours',
        indice:
          "L'agent d'analyse lit le projet et chiffre la tâche. Son compte rendu s'affichera ici dès qu'il sera terminé.",
      };
    case 'echouee':
      return {
        titre: "L'analyse n'a pas rendu de chiffres",
        indice: 'Son compte rendu reste lisible ici. Vous pouvez relancer une analyse depuis la carte.',
      };
    case 'prete':
      return {
        titre: 'Analyse terminée',
        indice: 'Le compte rendu de l’analyse s’affiche ci-dessus.',
      };
    default:
      return {
        titre: 'Aucun échange pour le moment',
        indice: 'Validez la carte pour lancer son chiffrage, lancez-la, ou posez une question.',
      };
  }
}

/**
 * Le titre d'un bloc de conversation, selon l'agent qui l'a écrit. Une carte
 * peut avoir eu plusieurs agents : sans repère, le compte rendu de l'analyse et
 * celui de l'exécution se confondent.
 */
export function titreDeBloc(role: string | undefined): string {
  switch (role) {
    case 'analysis':
      return 'Analyse de la carte';
    case 'deploy':
      return 'Publication';
    case 'orchestrator':
      return 'Chef d’orchestre';
    default:
      return 'Exécution de la tâche';
  }
}
