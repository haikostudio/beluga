import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * DEUX FLÈCHES ET UN RANG, EN HAUT À DROITE — LA MÊME BARRE PARTOUT.
 *
 * Elle est née pour les questions du cadrage, qui se feuillettent au lieu de
 * s'empiler ; les sujets de mémoire d'une analyse s'empilaient de la même
 * façon, et se feuillettent désormais pareillement. Une seule écriture pour
 * les deux : deux barres dessinées séparément auraient dérivé l'une de l'autre
 * au premier ajustement.
 *
 * UI MINIMALISTE : ni cadre, ni entête en capitales, ni barre de progression.
 * Le rang (« 2 / 3 ») entre deux flèches, en petit, aligné à droite.
 */
export function BarrePagination({
  index,
  total,
  aller,
  repere,
  libellePrecedent,
  libelleSuivant,
}: {
  /** Le rang affiché, à partir de 0. */
  index: number;
  total: number;
  /** Aller à ce rang — la barre l'a déjà borné. */
  aller: (cible: number) => void;
  /** Le repère `data-…` posé sur la barre, pour les contrôles. */
  repere: string;
  libellePrecedent: string;
  libelleSuivant: string;
}) {
  const bouger = (pas: number) => aller(Math.min(total - 1, Math.max(0, index + pas)));
  return (
    <div className="flex items-center justify-end gap-1" {...{ [`data-${repere}`]: '' }}>
      <FlecheDePage sens="precedent" actif={index > 0} onClick={() => bouger(-1)} libelle={libellePrecedent} />
      <span className="text-[12.5px] tabular-nums text-faint">
        {index + 1} / {total}
      </span>
      <FlecheDePage sens="suivant" actif={index < total - 1} onClick={() => bouger(1)} libelle={libelleSuivant} />
    </div>
  );
}

/** Une flèche : éteinte au bout de la liste, jamais retirée — la place ne bouge pas. */
export function FlecheDePage({
  sens,
  actif,
  onClick,
  libelle,
}: {
  sens: 'precedent' | 'suivant';
  actif: boolean;
  onClick: () => void;
  libelle: string;
}) {
  const Icone = sens === 'precedent' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      disabled={!actif}
      onClick={onClick}
      aria-label={libelle}
      className={cn(
        'rounded-md p-1 text-muted transition-colors',
        actif ? 'hover:bg-border hover:text-text' : 'cursor-default opacity-40',
      )}
    >
      <Icone className="h-3.5 w-3.5" />
    </button>
  );
}
