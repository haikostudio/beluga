import * as React from 'react';
import { Search, X } from '@/components/ui/icones';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * LE CHAMP DE RECHERCHE MAISON (décision de l'utilisateur du 03/11/2026 : « le champ search c'est quoi cette
 * connerie ? pourquoi il est si simple et natif ? ») — le SEUL champ de recherche des pages :
 *
 *  - PLEINE LARGEUR par défaut (`compact` le borne pour une colonne étroite) ;
 *  - une LOUPE devant, une CROIX qui efface dès qu'il y a du texte, Échap efface aussi ;
 *  - un fond de surface, AUCUNE bordure, la hauteur de la barre d'onglets (34 px téléphone, 32 px ordinateur) ;
 *  - jamais le dessin du système (`type="search"` et sa croix native sont bannis).
 *
 * Les repères `data-*` passés en propriétés se posent sur le champ lui-même (les contrôles existants les visent),
 * `data-champ-de-recherche` sur son enveloppe.
 */
export const ChampDeRecherche = React.forwardRef<
  HTMLInputElement,
  {
    valeur: string;
    onChange: (valeur: string) => void;
    placeholder?: string;
    className?: string;
    /** Une largeur bornée (une colonne de côté) au lieu de toute la largeur. */
    compact?: boolean;
    onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
    autoFocus?: boolean;
    'aria-label'?: string;
  } & Record<`data-${string}`, string | number | boolean | undefined>
>(function ChampDeRecherche({ valeur, onChange, placeholder, className, compact, onKeyDown, autoFocus, 'aria-label': ariaLabel, ...attributs }, ref) {
  const interne = React.useRef<HTMLInputElement | null>(null);
  const libelle = placeholder ?? t('Rechercher…');
  return (
    <div
      className={cn(
        'flex h-[38px] min-w-0 items-center gap-2 rounded-lg bg-champ px-2.5 text-text transition-colors focus-within:bg-fond-survol sm:h-8',
        compact ? 'w-full max-w-xs' : 'w-full',
        className,
      )}
      data-champ-de-recherche
      onClick={() => interne.current?.focus()}
    >
      <Search className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
      <input
        ref={(el) => {
          interne.current = el;
          if (typeof ref === 'function') ref(el);
          else if (ref) ref.current = el;
        }}
        value={valeur}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && valeur) {
            e.stopPropagation();
            onChange('');
          }
          onKeyDown?.(e);
        }}
        placeholder={libelle}
        aria-label={ariaLabel ?? libelle}
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-text outline-none placeholder:text-faint"
        {...attributs}
      />
      {valeur ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onChange('');
            interne.current?.focus();
          }}
          aria-label="Effacer la recherche"
          title={t('Effacer la recherche')}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-faint hover:bg-fond-survol hover:text-text"
          data-effacer-recherche
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
});
