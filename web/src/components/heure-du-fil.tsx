import * as React from 'react';
import { useMinute } from '@/lib/horloge';
import { cn, ilYAEtDuree } from '@/lib/utils';

/**
 * L'HEURE D'UN MESSAGE DU FIL D'UNE CARTE (27/10/2026, captures #ae52 et
 * #3c8a : « il faut des il y a … et ça doit être toujours en dernière position
 * du message, pas avant les médias ou la réponse »).
 *
 * Elle se pose EN DERNIER sous ce qu'elle date — la phrase, la question, le
 * média, la réponse — et se lit « il y a 26 min · 51 s » (`ilYAEtDuree`).
 * Toutes les heures du fil se rafraîchissent sur la MÊME horloge à la minute
 * (`useMinute`) : aucune minuterie par ligne. Second plan : 12,5 px, `--faint`,
 * chiffres alignés.
 */
export function HeureDuFil({
  at,
  dureeMs,
  className,
  ...reperes
}: {
  at?: number;
  dureeMs?: number;
  className?: string;
} & { [repere: `data-${string}`]: string | number | undefined }) {
  const maintenant = useMinute();
  const quand = ilYAEtDuree(at, dureeMs, maintenant);
  if (!quand) return null;
  return (
    <span title={quand.infobulle} className={cn('mt-1 block text-[12.5px] leading-snug text-faint tabular-nums', className)} data-heure-du-fil={at} {...reperes}>
      {quand.libelle}
    </span>
  );
}
