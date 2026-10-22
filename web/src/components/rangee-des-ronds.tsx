import * as React from 'react';
import { createPortal } from 'react-dom';
import { BAS_ROBOT } from '@beluga/shared';
import { cn } from '@/lib/utils';

/**
 * LES RONDS FLOTTANTS DU BAS, EN UN SEUL (demande du 20/10/2026) — SUR
 * ORDINATEUR. Le robot de l'assistant et le rond du terminal ne sont plus deux
 * boutons côte à côte : la rangée ne montre que le robot, et son SURVOL (ou le
 * focus au clavier) étale les autres ronds à sa gauche, à l'horizontale.
 *
 * LA RANGÉE REMONTE AVEC LE TERMINAL. Ouvert, le terminal soulève toute
 * l'application de sa hauteur (`--hauteur-terminal`, `html[data-terminal-ouvert]`) ;
 * la rangée, portée par <body>, ne suivait pas et passait sur le terminal.
 * Elle ajoute donc cette hauteur à sa distance au bas, au même rythme (190 ms).
 *
 * La rangée suit la place du robot (`droite`, qu'on règle en le glissant) ; les
 * autres ronds s'y posent par `RondDeLaRangee`. Sans robot (compte qui n'a pas
 * l'assistant), un rond reste seul dans le coin, avec la même remontée.
 */
let cible: HTMLElement | null = null;
const abonnes = new Set<() => void>();

function poserLaCible(noeud: HTMLElement | null): void {
  if (cible === noeud) return;
  cible = noeud;
  for (const abonne of abonnes) abonne();
}

function useCibleDeLaRangee(): HTMLElement | null {
  return React.useSyncExternalStore(
    (abonne) => {
      abonnes.add(abonne);
      return () => abonnes.delete(abonne);
    },
    () => cible,
    () => null,
  );
}

/** La distance au bas d'un rond : celle du robot, plus la hauteur du terminal ouvert. */
export const BAS_DES_RONDS = `max(calc(${BAS_ROBOT}px + var(--hauteur-terminal, 0px)), env(safe-area-inset-bottom))`;

/** La rangée, posée par l'assistant : le robot (`children`) à droite, les autres ronds à sa gauche. */
export function RangeeDesRonds({ droite, children }: { droite: number; children: React.ReactNode }) {
  return createPortal(
    <div
      data-rangee-des-ronds
      className="group/ronds fixed z-40 flex flex-row-reverse items-center transition-[bottom] duration-[190ms] ease-out motion-reduce:transition-none"
      style={{ right: droite, bottom: BAS_DES_RONDS }}
    >
      {children}
      <div ref={poserLaCible} className="flex flex-row-reverse items-center" data-rangee-des-ronds-autres />
    </div>,
    document.body,
  );
}

/**
 * UN ROND DE LA RANGÉE : replié derrière le robot tant qu'on ne survole pas la
 * rangée — sauf `toujours` (un terminal qui travaille, qu'on doit voir tourner).
 * Sans rangée, il se pose seul dans le coin.
 */
export function RondDeLaRangee({ toujours = false, coin, children }: { toujours?: boolean; coin: number; children: React.ReactNode }) {
  const rangee = useCibleDeLaRangee();
  if (typeof document === 'undefined') return null;
  if (!rangee) {
    return createPortal(
      <div className="fixed z-40 transition-[bottom] duration-[190ms] ease-out" style={{ right: coin, bottom: BAS_DES_RONDS }}>
        {children}
      </div>,
      document.body,
    );
  }
  return createPortal(
    <div
      data-rond-de-la-rangee={toujours ? 'toujours' : 'replie'}
      className={cn(
        // Replié : il ne prend aucune place. Au survol de la rangée, il s'étale à gauche du robot.
        'mr-3',
        !toujours && 'hidden animate-fade-in group-focus-within/ronds:block group-hover/ronds:block',
      )}
    >
      {children}
    </div>,
    rangee,
  );
}
