import { cn } from '@/lib/utils';

/**
 * LE POINT DU SECOND NIVEAU — le repli d'une ligne dont la sorte n'a pas
 * d'icône.
 *
 * Chaque ligne du fil porte l'icône fine et grise de sa sorte
 * (`icone-du-point.tsx`) : commande, mémoire, compétence, fichier, recherche…
 * Ce point plein de 5 px d'un gris contrasté (`--muted`, jamais `--border` qui
 * s'efface sur les palettes plates) ne sert plus que pour une ligne de sorte
 * inconnue, une ligne interne d'un encadré, les sections du compte rendu et
 * les points de la compréhension.
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
