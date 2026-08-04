import * as React from 'react';
import { TriangleAlert } from 'lucide-react';
import { Tooltip } from '@/components/ui';
import { cn } from '@/lib/utils';

/**
 * LE MÊME triangle orange, partout où une décision attend.
 *
 * La ligne du projet annonçait « 4 décisions attendues de votre part » et
 * c'était tout : ni la carte, ni la conversation ne portaient quoi que ce soit.
 * Un chiffre sans destination. Ce composant est le repère unique — pas un
 * nouveau genre d'alerte, exactement celui de la colonne de gauche — qu'on pose
 * désormais sur CHAQUE endroit où la décision se prend.
 *
 * Il dit toujours ce qu'il veut dire, en français simple : infobulle à la
 * souris, `aria-label` pour la lecture d'écran.
 */
export function libelleAttention(compte: number): string {
  return compte > 1 ? `${compte} décisions attendues de votre part` : 'Une décision attendue de votre part';
}

export function RepereAttention({
  compte,
  className,
  ...rest
}: { compte: number; className?: string } & React.HTMLAttributes<HTMLSpanElement>) {
  if (compte <= 0) return null;
  const libelle = libelleAttention(compte);
  return (
    <Tooltip label={libelle}>
      <span
        data-signal-attention
        aria-label={libelle}
        className={cn('inline-flex shrink-0 items-center text-warning', className)}
        {...rest}
      >
        <TriangleAlert className="h-3 w-3" />
      </span>
    </Tooltip>
  );
}
