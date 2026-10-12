import { Check } from 'lucide-react';
import { themeDeLAmbiance, themeParId, type ClarteTheme, type ReglageApparence } from '@beluga/shared';
import { BulleInfo, Switch } from '@/components/ui';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/** Les deux clartés, dans l'ordre où elles se proposent. */
const CLARTES: readonly ClarteTheme[] = ['clair', 'sombre'];

function ApercuPalette({ theme, actif }: { theme: string; actif: boolean }) {
  const fiche = themeParId(theme);
  const [fond, ligne, accent, texte] = fiche.apercu;
  /* La moitié haute est le fond de page avec un « Aa » dans la couleur du
     texte ; la moitié basse, la teinte de la ligne active et l'accent. La
     clarté en vigueur se lit à l'anneau. */
  return (
    <span
      aria-hidden
      data-theme-apercu={fiche.id}
      className={cn(
        'flex h-9 w-9 shrink-0 flex-col overflow-hidden rounded-md ring-1 ring-faint/40',
        actif && 'ring-2 ring-text',
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
 * L'interface est noir et blanc : il ne reste qu'à choisir sa CLARTÉ. Le
 * premier interrupteur la laisse à l'ordinateur ; les deux cartes la fixent à
 * la main — en choisir une coupe donc le mode automatique. L'anneau marque la
 * clarté EN VIGUEUR, la coche celle qui est CHOISIE : en automatique, les deux
 * peuvent différer.
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
        className="mb-2 flex items-center justify-between gap-4 rounded-lg bg-raised px-3 py-2.5"
      >
        <span className="flex min-w-0 items-center gap-1">
          <span className="text-[13.5px] font-medium text-text">{t('Suivre le système')}</span>
          <BulleInfo cote="start">{t('L’ordinateur choisit le mode clair ou sombre.')}</BulleInfo>
        </span>
        <Switch
          checked={value.automatique}
          onCheckedChange={(automatique) => onChange({ ...value, automatique })}
          aria-label="Suivre le système"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        {CLARTES.map((clarte) => {
          const theme = themeParId(themeDeLAmbiance(value.ambiance, clarte));
          const choisie = !value.automatique && value.clarte === clarte;
          return (
            <button
              key={clarte}
              type="button"
              data-theme-carte={theme.id}
              data-theme-mode={clarte}
              aria-pressed={choisie}
              onClick={() => onChange({ ambiance: value.ambiance, clarte, automatique: false })}
              className={cn(
                'flex min-w-0 items-center gap-3 rounded-lg p-3 text-left transition-colors',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-faint',
                /* Le choix RETENU : son fond, son nom et sa coche en violet — aucun trait. */
                choisie ? 'bg-raised' : 'bg-surface hover:bg-raised',
              )}
            >
              <ApercuPalette theme={theme.id} actif={clarteEnVigueur === clarte} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className={cn('text-[14px] font-medium', choisie ? 'text-teinte' : 'text-text')}>{t(theme.libelle)}</span>
                  {choisie ? <Check className="h-3.5 w-3.5 shrink-0 text-teinte" /> : null}
                </span>
                <span className="mt-0.5 block text-[12.5px] leading-relaxed text-faint">{t(theme.description)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
