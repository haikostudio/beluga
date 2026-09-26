import { Check } from 'lucide-react';
import {
  AMBIANCES,
  themeDeLAmbiance,
  themeParId,
  type ClarteTheme,
  type ReglageApparence,
} from '@beluga/shared';
import { BulleInfo, Switch } from '@/components/ui';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

function ApercuPalette({ theme, actif }: { theme: string; actif: boolean }) {
  const fiche = themeParId(theme);
  const [fond, ligne, accent, texte] = fiche.apercu;
  /* La moitié haute est le fond de page avec un « Aa » dans la couleur du
     texte ; la moitié basse, la teinte de la ligne active et l'accent. Les
     deux aperçus restent à pleine couleur : l'estomper les rendait tous
     pareils. La clarté en vigueur se lit à l'anneau. */
  return (
    <span
      aria-hidden
      data-theme-apercu={fiche.id}
      className={cn(
        'flex h-9 w-9 shrink-0 flex-col overflow-hidden rounded-md ring-1 ring-faint/40',
        actif && 'ring-2 ring-termine',
      )}
    >
      <span
        className="flex h-1/2 items-center justify-center text-[11px] font-semibold leading-none"
        style={{ backgroundColor: fond, color: texte }}
      >
        {t('Aa')}
      </span>
      <span className="flex h-1/2">
        <span className="w-1/2" style={{ backgroundColor: ligne }} />
        <span className="w-1/2" style={{ backgroundColor: accent }} />
      </span>
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
        className="mb-3 flex items-center justify-between gap-4 rounded-lg border border-border bg-bloc px-3 py-2.5"
      >
        <span className="flex min-w-0 items-center gap-1">
          <span className="text-[13.5px] font-medium text-text">{t('Suivre le système')}</span>
          <BulleInfo cote="start">
            {t('L’ordinateur choisit le mode clair ou sombre. Votre ambiance de couleur ne change pas.')}
          </BulleInfo>
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
                /* UN FOND COMMUN, DÉTACHÉ DU PANNEAU : `--fond-plan` se
                   distingue de `--surface` dans les douze palettes (plus clair
                   en sombre, plus foncé en clair). Seuls les aperçus portent
                   les couleurs propres de chaque ambiance. */
                'overflow-hidden rounded-lg border bg-fond-plan transition-colors',
                actif ? 'border-termine' : 'border-transparent hover:border-faint',
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

              <div className="flex items-center justify-end gap-2 border-t border-faint/20 px-3 py-2 text-[12px] text-muted">
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
