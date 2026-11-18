/*
 * LE GESTE COMMUN DE TOUTES LES ICÔNES DE BELUGA : un `<svg>` 24 × 24 au trait commun (1,6), bouts et angles arrondis,
 * `currentColor`, avec la même forme d'appel que Lucide (`className`, `size`, `strokeWidth`, `absoluteStrokeWidth`).
 * Les icônes faites à la main (`icones.tsx`) et le jeu entier écrit par `scripts/generer-icones.mjs`
 * (`icones-dessinees.tsx`) passent par lui : un seul style, partout.
 */
import * as React from 'react';
import type { LucideIcon, LucideProps } from 'lucide-react';

/** Le trait commun des icônes. */
export const TRAIT_DES_ICONES = 1.6;

/**
 * Une icône dessinée (`nom` : son nom Lucide, en kebab — la classe `lucide-<nom>` reste posée pour les écrans qui la
 * visent). Les traits se donnent en nœud ou en fonction : une fonction ne se construit qu'au premier affichage, et un
 * écran qu'on n'ouvre pas ne paie rien.
 */
export function dessiner(nom: string, traits: React.ReactNode | (() => React.ReactNode)): LucideIcon {
  let construits: React.ReactNode | undefined = typeof traits === 'function' ? undefined : traits;
  const lesTraits = () => (construits === undefined ? (construits = (traits as () => React.ReactNode)()) : construits);
  const Icone = React.forwardRef<SVGSVGElement, LucideProps>(
    ({ size = 24, color = 'currentColor', strokeWidth = TRAIT_DES_ICONES, absoluteStrokeWidth, className, children, ...reste }, ref) => (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={['lucide', `lucide-${nom}`, className].filter(Boolean).join(' ')}
        data-icone-dessinee={nom}
        {...reste}
      >
        {lesTraits()}
        {children}
      </svg>
    ),
  );
  Icone.displayName = nom;
  return Icone as unknown as LucideIcon;
}

/** Un point plein (les trois points d'un menu, le point d'un « i »). */
export const point = (cx: number, cy: number) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={1.35} fill="currentColor" stroke="none" />;
