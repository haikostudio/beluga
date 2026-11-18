import * as React from 'react';
import { Check, Pause, X } from '@/components/ui/icones';
import { cn } from '@/lib/utils';

export type EtatDuRond = 'done' | 'running' | 'todo' | 'stopped' | 'failed';

/**
 * LE ROND D'UNE ÉTAPE QUI SE COCHE EN DIRECT — partagé par la fenêtre « Relier Beluga Pass » des Réglages et par
 * l'encadré « Jarvis agit sur l'écran » du module de voix (carte « Relier Beluga Pass dans les réglages », 16/11/2026).
 *
 * Plein d'encre avec une coche une fois fait, anneau d'encre avec un point qui respire pendant, anneau pâle à venir,
 * anneau d'encre et pause quand l'utilisateur a repris la main, rouge si le geste a échoué. LE LIBELLÉ À CÔTÉ N'EST
 * JAMAIS BARRÉ (décision de l'utilisateur : les étapes barrées faisaient « liste raturée ») — d'où ce rond, et non
 * `CaseDeTache` + `classeDuLibelleDeTache` de la liste de tâches.
 */
export function RondDEtape({ etat, className }: { etat: EtatDuRond; className?: string }) {
  const base = 'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full';
  if (etat === 'done') {
    return (
      <span className={cn(base, 'bg-encre text-encre-fg', className)} aria-hidden data-rond={etat}>
        <Check className="h-3 w-3" />
      </span>
    );
  }
  if (etat === 'running') {
    return (
      <span className={cn(base, 'ring-[1.5px] ring-inset ring-text', className)} aria-hidden data-rond={etat}>
        <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-text" />
      </span>
    );
  }
  if (etat === 'stopped') {
    return (
      <span className={cn(base, 'text-text ring-[1.5px] ring-inset ring-text', className)} aria-hidden data-rond={etat}>
        <Pause className="h-2.5 w-2.5" />
      </span>
    );
  }
  if (etat === 'failed') {
    return (
      <span className={cn(base, 'text-danger ring-[1.5px] ring-inset ring-danger', className)} aria-hidden data-rond={etat}>
        <X className="h-2.5 w-2.5" />
      </span>
    );
  }
  return <span className={cn(base, 'ring-[1.5px] ring-inset ring-faint', className)} aria-hidden data-rond={etat} />;
}
