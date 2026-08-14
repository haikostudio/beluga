import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * LES TROIS DONNÉES DU TRAVAIL EN COURS, ÉCRITES UNE SEULE FOIS.
 *
 * Avant, l'avancement (n/N) et le temps écoulé vivaient dans deux éléments
 * séparés à côté du texte de statut — et le même texte (l'étape en cours,
 * son compte, son temps) se répétait entre la bande « Liste des tâches » et
 * la barre au-dessus du composeur. Regroupés ici en UN chip, dans l'ordre
 * demandé — le STATUT d'abord (le témoin animé + ce que l'agent fait), puis
 * l'INDICATION des todo (le compte et le temps, ensemble) — ce composant sert
 * aussi bien la barre du tiroir (avec son bouton d'arrêt, posé par l'appelant)
 * que la bande sous une carte du tableau (sans bouton du tout).
 */
export function InfoTravail({
  quoi,
  avancement,
  temps,
  className,
}: {
  quoi: string;
  avancement?: { done: number; total: number } | null;
  temps?: string | null;
  className?: string;
}) {
  return (
    <>
      <Loader2 className={cn('h-3 w-3 shrink-0 animate-spin text-en-cours', className)} />
      <span className="min-w-0 flex-1 truncate text-[13px] text-muted">{quoi}</span>
      {avancement || temps ? (
        <span
          data-avancement-travail
          className="shrink-0 rounded border border-border px-1 text-[11px] tabular-nums text-faint"
        >
          {avancement ? `${avancement.done}/${avancement.total}` : null}
          {avancement && temps ? ' · ' : null}
          {temps ?? null}
        </span>
      ) : null}
    </>
  );
}
