import { cn } from '@/lib/utils';

/**
 * LE POINT DU SECOND NIVEAU — un seul dessin pour tout le fil d'une carte.
 *
 * Les sous-points du flux (actions racontées, réglages, réponse, mémoire,
 * dépôt…), les sections du compte rendu et les points de la compréhension
 * portaient chacun un petit rond bordé avec son icône : le fil devenait une
 * mosaïque. Ils partagent désormais ce point plein de 5 px, sans icône, d'un
 * gris contrasté (`--muted`, jamais `--border` qui s'efface sur les palettes
 * plates).
 *
 * LA COULEUR NE REVIENT QUE LÀ OÙ ELLE PORTE UNE INFORMATION : rouge pour une
 * action en échec, orange pour ce qui tourne encore (règle « orange pour ce
 * qui est en cours »). Tout le reste est gris.
 */
export type TonDuPoint = 'neutre' | 'erreur' | 'en-cours';

const TEINTE: Record<TonDuPoint, string> = {
  neutre: 'bg-muted',
  erreur: 'bg-danger',
  'en-cours': 'bg-en-cours',
};

export function PointDuFil({ ton = 'neutre', className }: { ton?: TonDuPoint; className?: string }) {
  return (
    <span
      className={cn('block h-[5px] w-[5px] shrink-0 rounded-full', TEINTE[ton], className)}
      aria-hidden
      data-point-du-fil={ton}
    />
  );
}
