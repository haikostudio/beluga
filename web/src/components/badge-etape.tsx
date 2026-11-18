import * as React from 'react';
import type { TonDuBadgeDEtape } from '@beluga/shared';
import { cn } from '@/lib/utils';

/**
 * LE BADGE DE STATUT D'UNE CARTE, en haut à droite (demande du 18/10/2026) :
 * JAUNE à la Compréhension, VIOLET au Travail, avec un trait fin et un léger
 * fond de la même teinte. Seul le badge se colore, jamais la carte. Le ton
 * vient de l'étape de la carte (`tonDuBadgeDEtape`, `shared`) ; une étape sans
 * ton n'a pas de badge coloré.
 *
 * Les fonds et les traits sont des jetons qui portent leur alpha
 * (`styles.css`) : on n'écrit jamais `bg-…/50`. La hauteur est celle de la tête
 * d'une carte de « Tableaux de bord » (18 px) pour ne rien faire bouger.
 */
/* La liste des agents (`liste-des-agents.tsx`) colore ses badges en quatre
   familles (demande du 01/11/2026, `familleDeCouleur`) : violet quand l'agent
   agit, jaune quand c'est à l'utilisateur, VERT (« pret », le seul jeton
   coloré ajouté depuis, réservé à ce badge et au rond de la colonne) quand le
   travail est prêt, gris (« neutre ») au repos. */
type TonDuBadge = TonDuBadgeDEtape | 'pret' | 'neutre';
const CLASSE_PAR_TON: Record<TonDuBadge, string> = {
  comprehension: 'border-comprehension-trait bg-comprehension-fond text-comprehension',
  travail: 'border-teinte-trait bg-teinte-fond text-teinte',
  pret: 'border-pret-trait bg-pret-fond text-pret',
  neutre: 'border-border bg-surface text-muted',
};

export function BadgeDEtape({
  ton,
  enCours,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  ton: TonDuBadge;
  /** Un agent y travaille : un point qui bat précède le texte. */
  enCours?: boolean;
}) {
  return (
    <span
      data-badge-etape={ton}
      className={cn(
        'inline-flex h-[18px] max-w-full shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-1.5 text-[12px] font-medium leading-none',
        CLASSE_PAR_TON[ton],
        className,
      )}
      {...props}
    >
      {enCours ? <span className="h-1.5 w-1.5 shrink-0 animate-pulse-soft rounded-full bg-current motion-reduce:animate-none" aria-hidden /> : null}
      {children}
    </span>
  );
}
