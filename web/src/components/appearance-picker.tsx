import { Check } from 'lucide-react';
import {
  AMBIANCES,
  themeDeLAmbiance,
  themeParId,
  type ClarteTheme,
  type ReglageApparence,
} from '@haikodev/shared';
import { Switch } from '@/components/ui';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

function ApercuPalette({ theme, actif }: { theme: string; actif: boolean }) {
  const fiche = themeParId(theme);
  return (
    <span
      aria-hidden
      data-theme-apercu={fiche.id}
      className={cn(
        'flex h-8 w-8 shrink-0 flex-wrap overflow-hidden rounded-md ring-1 ring-border transition-opacity',
        actif ? 'opacity-100 ring-2 ring-termine' : 'opacity-55',
      )}
    >
      {fiche.apercu.map((couleur, rang) => (
        <span key={rang} className="h-1/2 w-1/2" style={{ backgroundColor: couleur }} />
      ))}
    </span>
  );
}

/**
 * LE MÊME CHOIX D'APPARENCE, au niveau général comme au niveau d'un projet.
 *
 * Le premier interrupteur laisse l'ordinateur décider de la clarté. Chaque
 * ambiance garde ensuite ses deux aperçus et son propre interrupteur
 * clair/sombre ; ces interrupteurs sont inertes tant que l'automatique est
 * actif. Changer d'ambiance ne change donc jamais le choix de clarté.
 */
export function AppearancePicker({
  value,
  onChange,
  systemeSombre,
}: {
  value: ReglageApparence;
  onChange: (value: ReglageApparence) => void;
  systemeSombre: boolean;
}) {
  const clarteEnVigueur: ClarteTheme = value.automatique
    ? systemeSombre
      ? 'sombre'
      : 'clair'
    : value.clarte;

  return (
    <div data-selecteur-apparence>
      <div
        data-theme-auto
        className="mb-3 flex items-center justify-between gap-4 rounded-lg border border-border bg-surface px-3 py-2.5"
      >
        <span className="min-w-0">
          <span className="block text-[13.5px] font-medium text-text">{t('Suivre le système')}</span>
          <span className="mt-0.5 block text-[12.5px] leading-relaxed text-faint">
            {t('L’ordinateur choisit le mode clair ou sombre. Votre ambiance de couleur ne change pas.')}
          </span>
        </span>
        <Switch
          checked={value.automatique}
          onCheckedChange={(automatique) => onChange({ ...value, automatique })}
          aria-label="Suivre le système"
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {AMBIANCES.map((ambiance) => {
          const actif = ambiance.id === value.ambiance;
          const clair = themeDeLAmbiance(ambiance.id, 'clair');
          const sombre = themeDeLAmbiance(ambiance.id, 'sombre');
          return (
            <article
              key={ambiance.id}
              data-theme-carte={ambiance.id}
              data-theme-clair={clair}
              data-theme-sombre={sombre}
              className={cn(
                'overflow-hidden rounded-lg border transition-colors',
                actif ? 'border-termine bg-raised' : 'border-border bg-surface hover:bg-raised',
              )}
            >
              <button
                type="button"
                data-theme-ambiance={ambiance.id}
                aria-pressed={actif}
                onClick={() => onChange({ ...value, ambiance: ambiance.id })}
                className="flex w-full items-start gap-3 p-3 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-faint"
              >
                <span className="flex shrink-0 items-center gap-1">
                  <ApercuPalette theme={clair} actif={clarteEnVigueur === 'clair'} />
                  <ApercuPalette theme={sombre} actif={clarteEnVigueur === 'sombre'} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="text-[14px] font-medium text-text">{t(ambiance.libelle)}</span>
                    {actif ? <Check className="h-3.5 w-3.5 shrink-0 text-termine" /> : null}
                  </span>
                  <span className="mt-0.5 block text-[12.5px] leading-relaxed text-faint">
                    {t(ambiance.description)}
                  </span>
                </span>
              </button>

              <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2 text-[12px] text-muted">
                <span className={value.clarte === 'clair' ? 'text-text' : undefined}>{t('Clair')}</span>
                <Switch
                  checked={value.clarte === 'sombre'}
                  disabled={value.automatique}
                  onCheckedChange={(sombreActif) =>
                    onChange({
                      ambiance: ambiance.id,
                      clarte: sombreActif ? 'sombre' : 'clair',
                      automatique: false,
                    })
                  }
                  data-theme-mode={ambiance.id}
                  aria-label={`Mode sombre ${ambiance.id}`}
                />
                <span className={value.clarte === 'sombre' ? 'text-text' : undefined}>{t('Sombre')}</span>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
