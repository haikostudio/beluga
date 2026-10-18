import type { RubriqueDuCahier } from '@beluga/shared';
import { Markdown } from '@/lib/markdown';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * LE CAHIER DES CHARGES DU PLAN, UN ENCADRÉ OUVERT (17/10/2026).
 *
 * Il se remplit au fil des réponses (`shared/src/cahier-vivant.ts`) mais ne
 * paraît QUE sous le plan (`detacherLeCahier`) : les réponses du fil restent
 * du texte seul. Un bloc sur fond `bg-raised`, toujours ouvert — plus de ligne
 * à déplier ni de compteur qui se tasse sur téléphone, plus de pastille « mise
 * à jour ». Le titre tient seul sur sa ligne ; chaque rubrique se lit et se
 * copie d'un trait, à l'intérieur du cadre. Sans rubrique, rien du tout.
 */
export function CahierDesChargesDuPlan({
  rubriques,
  className,
}: {
  rubriques: readonly RubriqueDuCahier[];
  className?: string;
}) {
  if (!rubriques.length) return null;
  return (
    <div className={cn('min-w-0 break-words rounded-xl bg-raised px-4 py-3', className)} data-cahier-du-plan>
      <p className="mb-2 text-[14px] font-semibold text-text">{t('Cahier des charges')}</p>
      <div className="space-y-3" data-cahier-contenu>
        {rubriques.map((rubrique) => (
          <section key={rubrique.titre} className="min-w-0" data-cahier-rubrique={rubrique.titre}>
            <p className="text-[13.5px] font-semibold text-text">{rubrique.titre}</p>
            <Markdown content={rubrique.contenu} className="texte-du-fil [&_p]:mb-1.5" />
          </section>
        ))}
      </div>
    </div>
  );
}
