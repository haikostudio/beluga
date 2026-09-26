import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * UN BLOC À DEUX ÉTAGES : un EN-TÊTE qui porte le titre, puis un PANNEAU qui
 * porte le contenu. Deux éléments distincts, posés l'un sous l'autre, sans
 * aucun trait : la hiérarchie passe par les FONDS (styles.css,
 * `.en-tete-de-panneau` et `.panneau`), qui suivent l'ambiance et la clarté.
 * L'en-tête prend le fond contrasté du plan (`--fond-plan`) ; le panneau un
 * mélange de ce fond et de celui de la zone, plus discret que l'en-tête.
 */
export function EnTeteDePanneau({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('en-tete-de-panneau rounded-t-md px-3 py-1.5 font-semibold text-text', className)} data-en-tete-de-panneau="" {...props}>
      {children}
    </div>
  );
}

export function Panneau({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('panneau rounded-b-md px-3 py-2 text-text', className)} data-panneau="" {...props}>
      {children}
    </div>
  );
}
