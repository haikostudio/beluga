import * as React from 'react';
import { Cpu, MousePointer2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { EngineId } from '@beluga/shared';

/**
 * Un trait simplifié par moteur — jamais le logo exact de la marque, juste de
 * quoi reconnaître Claude d'un GPT d'un coup d'œil, à la taille d'une lettre.
 * `currentColor` : elle suit la teinte du texte qui la porte, sans imposer sa
 * propre couleur au milieu des douze palettes.
 */
function TraitClaude({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M12 2.5v5M12 16.5v5M4.6 4.6l3.5 3.5M15.9 15.9l3.5 3.5M2.5 12h5M16.5 12h5M4.6 19.4l3.5-3.5M15.9 8.1l3.5-3.5"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function TraitCodex({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round">
        <path d="M12 3.5l7.4 4.25v8.5L12 20.5l-7.4-4.25v-8.5z" />
      </g>
      <circle cx="12" cy="12" r="2.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** MiMo : un « m » arrondi, repris du nom. */
function TraitMimo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M4 19V10a4 4 0 0 1 8 0v9M12 10a4 4 0 0 1 8 0v9"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

/**
 * Les traits dessinés. Un moteur du registre qui n'a pas le sien garde une
 * icône NEUTRE (`Cpu`) : ajouter un moteur ne laisse jamais un trou dans la carte.
 */
const PAR_MOTEUR: Partial<Record<EngineId, React.ComponentType<{ className?: string }>>> = {
  claude: TraitClaude,
  codex: TraitCodex,
  cursor: (p) => <MousePointer2 {...p} />,
  mimo: TraitMimo,
};

/**
 * L'icône du moteur, faite pour vivre DANS le fil du titre — à gauche du
 * texte, à la taille d'une lettre (`h-3 w-3` par défaut). Elle ne pose ni
 * fond ni bordure : un simple trait de la couleur du texte autour, comme le
 * reste des repères de la carte.
 */
export function IconeMoteur({ engine, className }: { engine: EngineId; className?: string }) {
  const Trait = PAR_MOTEUR[engine] ?? ((p: { className?: string }) => <Cpu {...p} />);
  return <Trait className={cn('h-3 w-3 shrink-0 text-faint', className)} />;
}
