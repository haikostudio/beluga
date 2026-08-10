import { ColumnKey } from './columns.js';

/**
 * Où en est le chiffrage d'une carte.
 *
 * Le chiffrage n'est plus un tour à part : l'agent lancé sur la carte étudie le
 * projet, chiffre le travail, puis l'exécute dans la foulée. Une carte qui dort
 * en « Planifié » n'a donc rien à montrer — et rien ne lui a rien coûté. Ce qui
 * s'affiche dit seulement où en est ce tour unique.
 *
 * La décision vit ici, sans réseau ni base : elle se teste seule.
 */

export type PhaseAnalyse = 'aucune' | 'en_cours' | 'prete' | 'echouee';

export interface EtatAnalyse {
  /** Colonne de la carte. */
  column: ColumnKey;
  /** Le tour de lancement a rendu ses chiffres. */
  aEstimation: boolean;
  /** Un chiffrage a été tenté, mais sans chiffres exploitables. */
  estimationEchouee: boolean;
  /** L'agent de la carte travaille en ce moment. */
  analyseEnCours: boolean;
}

/**
 * Ce que la conversation d'une carte annonce quand elle est encore vide. Un
 * agent au travail l'emporte sur tout : c'est l'information la plus fraîche.
 */
export function phaseAnalyse(etat: EtatAnalyse): PhaseAnalyse {
  if (etat.analyseEnCours) return 'en_cours';
  if (etat.estimationEchouee) return 'echouee';
  if (etat.aEstimation) return 'prete';
  return 'aucune';
}

/** Ce qui s'affiche dans une conversation encore vide. */
export function motAnalyse(phase: PhaseAnalyse): { titre: string; indice: string } {
  switch (phase) {
    case 'en_cours':
      return {
        titre: 'Analyse en cours',
        indice:
          "L'agent lit le projet, chiffre la tâche et la réalise dans la foulée. Son compte rendu s'affichera ici dès qu'il sera terminé.",
      };
    case 'echouee':
      return {
        titre: "Le tour n'a pas rendu de chiffres",
        indice: 'Son compte rendu reste lisible ici. Relancer la carte rejoue le chiffrage avec le travail.',
      };
    case 'prete':
      return {
        titre: 'Analyse terminée',
        indice: 'Le compte rendu de l’analyse s’affiche ci-dessus.',
      };
    default:
      return {
        titre: 'Aucun échange pour le moment',
        indice: 'Lancez la carte : son agent l’étudiera, la chiffrera et la réalisera. Ou posez une question.',
      };
  }
}

/**
 * Le titre d'un bloc de conversation, selon l'agent qui l'a écrit. Une carte
 * peut avoir eu plusieurs agents : sans repère, le compte rendu d'un chiffrage
 * d'avant la fusion et celui de l'exécution se confondraient.
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
