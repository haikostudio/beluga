/**
 * UN CHAMP AVEC SON BOUTON « COPIER » (accès clients, 25/11/2026) : la fenêtre des accès de « Voir mon site » (en
 * lecture) et la rubrique « Accès clients » des réglages du projet (modifiable). Un secret passe par le champ de mot de
 * passe commun — l'œil compris (`ChampMotDePasse`, règle « aucun type password posé à la main ») — et reçoit le
 * « copier » juste après l'œil. Le bouton dit « Copié » un instant, coche à l'appui.
 */
import * as React from 'react';
import { Check, Copy } from '@/components/ui/icones';
import { ChampMotDePasse, Input } from '@/components/ui';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

export function ChampACopier({
  id,
  valeur,
  secret,
  readOnly,
  onChange,
  onBlur,
  className,
  repere,
}: {
  id: string;
  valeur: string;
  secret?: boolean;
  readOnly?: boolean;
  onChange?: (valeur: string) => void;
  onBlur?: () => void;
  className?: string;
  /** Le repère du bouton (`data-acces-copier`), pour les contrôles. */
  repere: string;
}) {
  const [copie, setCopie] = React.useState(false);
  React.useEffect(() => {
    if (!copie) return;
    const minuteur = window.setTimeout(() => setCopie(false), 1600);
    return () => window.clearTimeout(minuteur);
  }, [copie]);
  const bouton = (
    <button
      type="button"
      onClick={() =>
        void navigator.clipboard
          ?.writeText(valeur)
          .then(() => setCopie(true))
          .catch(() => setCopie(false))
      }
      title={copie ? t('Copié') : t('Copier')}
      aria-label="Copier"
      data-acces-copier={repere}
      data-copie={copie ? 'oui' : undefined}
      className="grid h-[34px] w-[34px] place-items-center rounded-md text-muted transition-colors hover:bg-fond-survol hover:text-text sm:h-7 sm:w-7"
    >
      {copie ? <Check className="h-3.5 w-3.5 text-text" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
  const commun = {
    id,
    value: valeur,
    readOnly,
    onChange: onChange ? (event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.value) : undefined,
    onBlur,
    onFocus: readOnly ? (event: React.FocusEvent<HTMLInputElement>) => event.currentTarget.select() : undefined,
    spellCheck: false,
    autoComplete: 'off',
  };
  if (secret) return <ChampMotDePasse {...commun} className={className} apres={bouton} />;
  return (
    <div className="relative">
      <Input {...commun} className={cn('pr-10', className)} />
      <div className="absolute inset-y-0 right-1.5 flex items-center">{bouton}</div>
    </div>
  );
}
