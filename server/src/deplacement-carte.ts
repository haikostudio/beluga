import { dateDeMiseEnLignePerimee, type Card, type ColumnKey } from '@haikodev/shared';
import * as store from './store.js';

/**
 * RANGER une carte dans une autre colonne — le simple déplacement, une fois
 * que tous les refus ont été levés (`canMove`, `sortieAutorisee`,
 * `repriseAutorisee`) et que le dépôt ne vaut ni un lancement ni une
 * suspension (`effetDuDepot`).
 *
 * Le geste tient en une ligne, sauf pour deux dates qui se posent ou se
 * retirent AVEC la colonne, et qu'on ne veut écrire qu'à un seul endroit :
 *
 *  - `doneAt` : la carte arrive dans « Terminé » ;
 *  - `deployedAt` : la carte ENTRE dans « À déployer », donc elle attend un
 *    NOUVEAU déploiement. Sa date de mise en ligne d'avant est périmée
 *    (`dateDeMiseEnLignePerimee`). Sans cela, le lot l'écartait à jamais
 *    (`deployableCards`), le bouton annonçait « (0) », s'éteignait, et le clic
 *    ne partait nulle part — le bogue du « Tout déployer » muet. Une carte qui
 *    QUITTE « À déployer », elle, garde sa date : c'est la trace de sa mise en
 *    ligne.
 *
 * Cette fonction n'émet rien et ne refuse rien : elle écrit. L'appelant
 * diffuse la carte et dit ce qu'il a à dire.
 */
export function rangerLaCarte(card: Card, target: ColumnKey, position?: number): Card {
  return store.saveCard({
    ...card,
    column: target,
    position: position ?? store.nextPosition(card.projectId, target),
    doneAt: target === 'done' ? Date.now() : card.doneAt,
    deployedAt: dateDeMiseEnLignePerimee(card.column, target) ? undefined : card.deployedAt,
  });
}
