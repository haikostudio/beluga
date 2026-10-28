import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';
import { useClasseDuCadreDeQuestion } from '@/lib/cadre-de-question';

/**
 * UNE VALIDATION AVEC UN COÛT — LE MÊME ENCART POUR TOUTE DÉPENSE À ACCORDER
 * (27/10/2026, captures #ca355 : l'ancien bloc « Devis » empilait tableau,
 * total, mode d'emploi, champ de réponse et quatre boutons pour un seul clic).
 *
 * Un titre, une ligne de description, « Valider · prix » et « Refuser ». Rien
 * d'autre : pour changer quelque chose, on l'écrit dans le champ principal de
 * la conversation. Le composant ne connaît aucun chemin réseau — ce que valent
 * « valider » et « refuser » arrive par `onValider` et `onRefuser` — : il sert
 * à n'importe quelle confirmation qui coûte, pas seulement aux générations.
 *
 * Le cadre jaune des questions (`.cadre-de-question`) est gardé : c'est une
 * décision qui attend. UN BOUTON QUI PART EN REQUÊTE LE DIT DÈS LE CLIC.
 */
export function ValidationAvecCout({
  titre,
  description,
  cout,
  entete,
  variante = 'neutre',
  repere,
  onValider,
  onRefuser,
}: {
  titre: string;
  description?: string;
  /** Le coût déjà écrit (« 0,09 $ », « prix non publié »), posé dans le bouton. Vide : « Valider » seul. */
  cout?: string | null;
  entete?: React.ReactNode;
  variante?: 'neutre' | 'attention' | 'contraste';
  /** Les repères de contrôle posés sur l'encart. */
  repere?: Record<string, string | undefined>;
  onValider?: () => Promise<void> | void;
  onRefuser?: () => Promise<void> | void;
}) {
  const [enVol, setEnVol] = React.useState<'valider' | 'refuser' | null>(null);
  const cadre = useClasseDuCadreDeQuestion();
  const agir = async (geste: 'valider' | 'refuser') => {
    const action = geste === 'valider' ? onValider : onRefuser;
    if (!action || enVol) return;
    setEnVol(geste);
    try {
      await action();
    } finally {
      setEnVol(null);
    }
  };
  return (
    <div
      className={cn(cadre, 'rounded-lg px-3 py-2.5', variante === 'neutre' ? 'bg-bloc-fil' : 'bg-raised')}
      data-validation-avec-cout=""
      {...(repere ?? {})}
    >
      {entete}
      <p className={cn('text-[14px] font-medium leading-snug text-text', entete ? 'mt-1.5' : undefined)} data-validation-titre="">
        {titre}
      </p>
      {description ? (
        <p className="mt-0.5 truncate text-[12.5px] text-faint" title={description} data-validation-description="">
          {description}
        </p>
      ) : null}
      {onValider || onRefuser ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {onValider ? (
            <Button
              type="button"
              size="sm"
              data-valider-avec-cout=""
              aria-busy={enVol === 'valider'}
              disabled={!!enVol}
              onClick={() => void agir('valider')}
              className="gap-1 bg-accent text-accent-fg hover:opacity-90"
            >
              {enVol === 'valider' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {enVol === 'valider' ? t('Validation lancée…') : cout ? t('Valider · {cout}', { cout }) : t('Valider')}
            </Button>
          ) : null}
          {onRefuser ? (
            <Button type="button" size="sm" variant="ghost" data-refuser-avec-cout="" aria-busy={enVol === 'refuser'} disabled={!!enVol} onClick={() => void agir('refuser')}>
              {t('Refuser')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
