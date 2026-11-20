import { Archive, ArchiveRestore } from '@/components/ui/icones';
import { Button } from '@/components/ui';
import { t } from '@/lib/langue';
import { TeteDeRubrique, type ContexteConfig } from './communs';
import { SuppressionDefinitive } from './suppression-projet';

/**
 * RETIRER UN PROJET : L'ARCHIVER (disque externe, depuis le 20/11/2026 — il remplace « Mettre de côté »), OU LE
 * SUPPRIMER POUR DE BON.
 *
 * Rubrique à part : son entrée est le bouton rouge « Supprimer », tout en bas
 * du menu, loin de « Enregistrer » (11/10/2026). Ce bouton OUVRE la rubrique,
 * il ne supprime rien : elle garde ses DEUX choix, dans cet ordre.
 * « Mettre de côté » ne perd rien et se défait d'un clic : c'est le geste par
 * défaut, posé en premier, avec sa phrase écrite en clair. La suppression
 * définitive (08/10/2026) est un dialogue à part, qui propose d'abord de
 * mettre de côté, puis exige le nom recopié : le 22/09/2026, l'ancien bouton
 * « Effacer » avait détruit un projet entier d'un clic.
 */
export function RubriqueRetrait({ ctx }: { ctx: ContexteConfig }) {
  return (
    <div data-rubrique-contenu="retrait" className="space-y-3">
      <TeteDeRubrique
        titre={t('Supprimer')}
        resume={t('Archiver ce projet sur le disque externe sans rien perdre, ou le supprimer pour de bon.')}
      />

      <div className="rounded-md border border-border bg-bloc px-3 py-2.5">
        <p className="text-[13.5px] font-medium text-text">{ctx.project.archived ? t('Désarchiver') : t('Archiver')}</p>
        <p className="mt-0.5 text-[13px] text-muted">
          {ctx.project.archived
            ? t('Les fichiers du projet reviennent du disque externe à leur place sur le serveur, et les agents peuvent de nouveau y travailler.')
            : t('Les fichiers du projet partent sur le disque externe pour libérer la place sur le serveur. Le projet reste dans la colonne avec un badge, son tableau et ses conversations restent lisibles, et il revient d’un clic.')}
        </p>
        <Button variant="subtle" size="sm" className="mt-2" data-archiver-projet onClick={ctx.archiver}>
          {ctx.project.archived ? <ArchiveRestore className="h-3 w-3" /> : <Archive className="h-3 w-3" />}
          {ctx.project.archived ? t('Désarchiver…') : t('Archiver…')}
        </Button>
      </div>

      <SuppressionDefinitive ctx={ctx} />
    </div>
  );
}
