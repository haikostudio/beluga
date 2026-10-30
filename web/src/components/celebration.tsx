/*
 * LA PETITE CÉLÉBRATION D'UN AGENT QUI A FINI (demande du 30/10/2026 : « je veux
 * quelque chose de ludique »).
 *
 * Quand le rapport d'un agent arrive SOUS NOS YEUX, quelques confettis gris et
 * noirs jaillissent de sa ligne dans la liste des agents (ou du haut de l'écran
 * si la ligne n'est pas affichée). L'annonce elle-même est celle du démon —
 * « Agent terminé : … » —, déjà dans la pile de messages : on n'en ajoute pas
 * une seconde, les trois genres qui alertent restent trois.
 *
 * Jamais au chargement : une carte vue pour la première fois n'a pas d'« avant »
 * (`vientDeRendre`, `shared/src/etat-d-agent-en-liste.ts`). Jamais pour qui a
 * demandé moins de mouvement à son appareil. Monochrome, comme les icônes.
 */
import * as React from 'react';
import { createPortal } from 'react-dom';
import { vientDeRendre } from '@beluga/shared';
import { useApp } from '@/lib/use-app';

interface Salve {
  id: number;
  x: number;
  y: number;
}

const CONFETTIS = 16;
const DUREE_MS = 1300;
const TEINTES = ['bg-text', 'bg-muted', 'bg-faint'];

/** Surveille les rendus des cartes chargées, et lance une salve à chaque rendu neuf. */
export function Celebrations() {
  const { cards } = useApp();
  const vus = React.useRef(new Map<string, number>());
  const [salves, setSalves] = React.useState<Salve[]>([]);

  React.useEffect(() => {
    const neuves: Salve[] = [];
    for (const carte of Object.values(cards)) {
      const avant = vus.current.get(carte.id);
      const apres = carte.renduA ?? 0;
      if (vientDeRendre(avant, apres) && !mouvementReduit()) {
        const ligne = document.querySelector(`[data-agent-en-liste="${carte.id}"]`);
        const boite = ligne?.getBoundingClientRect();
        neuves.push({
          id: Date.now() + neuves.length,
          x: boite && boite.width ? boite.left + Math.min(boite.width - 40, 28) : window.innerWidth / 2,
          y: boite && boite.height ? boite.top + boite.height / 2 : 72,
        });
      }
      vus.current.set(carte.id, apres);
    }
    if (!neuves.length) return;
    setSalves((avant) => [...avant, ...neuves]);
    // Pas de nettoyage à l'effet suivant : une salve se retire toujours, même si d'autres cartes bougent entre-temps.
    window.setTimeout(() => setSalves((avant) => avant.filter((s) => !neuves.includes(s))), DUREE_MS + 100);
  }, [cards]);

  if (!salves.length) return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[70] overflow-hidden" aria-hidden data-celebration>
      {salves.map((salve) =>
        Array.from({ length: CONFETTIS }, (_, index) => {
          const angle = (index / CONFETTIS) * Math.PI * 2 + (salve.id % 7) * 0.1;
          const portee = 46 + ((index * 37) % 40);
          return (
            <span
              key={`${salve.id}-${index}`}
              className={`confetti absolute h-1.5 w-1 rounded-[1px] ${TEINTES[index % TEINTES.length]}`}
              style={
                {
                  left: salve.x,
                  top: salve.y,
                  '--dx': `${Math.cos(angle) * portee}px`,
                  '--dy': `${Math.sin(angle) * portee - 24}px`,
                  '--tour': `${(index % 2 ? 1 : -1) * (180 + index * 25)}deg`,
                  animationDuration: `${DUREE_MS}ms`,
                } as React.CSSProperties
              }
            />
          );
        }),
      )}
    </div>,
    document.body,
  );
}

function mouvementReduit(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}
