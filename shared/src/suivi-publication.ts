/**
 * LE SUIVI D'UNE PUBLICATION EN UN COUP D'ŒIL : ce que lit le bandeau de mise
 * en production, en bas du tableau.
 *
 * Le tiroir raconte tout ; le bandeau, lui, n'a la place que pour trois
 * choses — une barre, le nom de l'étape et un chronomètre. Elles se lisent ici,
 * sur le déroulé réel, sans base ni horloge : le bouton et la barre lisent la
 * même source et ne peuvent pas se contredire.
 *
 * Le pourcentage est celui du tiroir (`avancementDuFlux`) : une étape SAUTÉE
 * ne compte pas, une étape qui travaille compte pour une demie. Il ne monte à
 * 100 % qu'une fois la publication RÉUSSIE — une publication encore en route
 * dont toutes les étapes sont cochées reste à 99 %.
 */

import { avancementDuFlux } from './avancement-publication.js';
import type { DeployRun, DeployStepKey } from './models.js';

/** Où en est la publication, pour le bandeau. */
export type EtatDuSuivi = 'en-cours' | 'reussie' | 'en-echec' | 'arretee';

export interface SuiviDePublication {
  etat: EtatDuSuivi;
  /** Le pourcentage entier (0 à 100). */
  pourcent: number;
  /**
   * L'étape à NOMMER : celle qui travaille, ou celle qui est tombée. `null`
   * quand aucune ne se désigne (publication réussie, ou pas encore partie).
   */
  etape: DeployStepKey | null;
  /** L'instant de départ, pour le chronomètre. */
  depuis: number;
  /** L'instant d'arrivée, une fois la publication finie. */
  finiA?: number;
}

export function suiviDeLaPublication(
  run: Pick<DeployRun, 'state' | 'steps' | 'taches' | 'currentStep' | 'startedAt' | 'endedAt'>,
): SuiviDePublication {
  const etat: EtatDuSuivi =
    run.state === 'running'
      ? 'en-cours'
      : run.state === 'success'
        ? 'reussie'
        : run.state === 'failed'
          ? 'en-echec'
          : 'arretee';

  let pourcent = avancementDuFlux(run)?.pourcent ?? 0;
  if (etat !== 'reussie' && pourcent >= 100) pourcent = 99;

  const tombee = run.steps.find((step) => step.state === 'failed')?.key;
  const enRoute = run.steps.find((step) => step.state === 'running')?.key;
  const etape =
    etat === 'reussie'
      ? null
      : etat === 'en-cours'
        ? (enRoute ?? run.currentStep ?? null)
        : (tombee ?? run.currentStep ?? null);

  return { etat, pourcent, etape, depuis: run.startedAt, finiA: run.endedAt };
}
