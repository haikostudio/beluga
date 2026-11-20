import { t } from '@/lib/langue';
import { TeteDeRubrique, type ContexteConfig } from './communs';
import { SuppressionDefinitive } from './suppression-projet';

/**
 * SUPPRIMER UN PROJET POUR DE BON.
 *
 * Rubrique à part : son entrée est le bouton rouge « Supprimer », tout en bas du menu, loin de « Enregistrer »
 * (11/10/2026). Ce bouton OUVRE la rubrique, il ne supprime rien. L'ARCHIVAGE, qui vivait ici, a sa propre
 * rubrique depuis le 20/11/2026 (`page-archivage.tsx`) : on ne le trouvait pas sous « Supprimer ». La suppression
 * définitive (08/10/2026) reste un dialogue à part, qui propose d'abord d'archiver, puis exige le nom recopié : le
 * 22/09/2026, l'ancien bouton « Effacer » avait détruit un projet entier d'un clic.
 */
export function RubriqueRetrait({ ctx }: { ctx: ContexteConfig }) {
  return (
    <div data-rubrique-contenu="retrait" className="space-y-3">
      <TeteDeRubrique
        titre={t('Supprimer')}
        resume={t('Supprimer ce projet pour de bon. Pour seulement libérer la place, archivez-le.')}
      />
      <SuppressionDefinitive ctx={ctx} />
    </div>
  );
}
