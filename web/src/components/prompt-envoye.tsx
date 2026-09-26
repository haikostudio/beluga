import * as React from 'react';
import { Brain, FileText, MessageCircle, Search } from 'lucide-react';
import { BulleDuFilAgent, SentContextEtat, filVisuelDeLAgent } from '@beluga/shared';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * Le suivi des recherches faites par l'agent.
 *
 * Il vit à gauche, comme une parole de l'agent. Chaque résultat ajoute ses
 * propres bulles courtes à la suite : la recherche, ce qui a été compris et les
 * directives éventuellement retrouvées. Le prompt complet n'est jamais recopié ici.
 */
export function BullesDuPromptEnvoye({
  contexte,
}: {
  contexte: SentContextEtat;
  demandeDejaAffichee?: boolean;
}) {
  const bulles = React.useMemo(() => filVisuelDeLAgent(contexte), [contexte]);
  if (!bulles.length) return null;

  return (
    <div data-prompt-envoye data-fil-agent className="w-[min(92%,860px)] min-w-0 max-w-full py-2">
      <ListeDesBullesDuFil bulles={bulles} />
    </div>
  );
}

/**
 * LES BULLES ELLES-MÊMES, SANS LEUR ENVELOPPE.
 *
 * Le flux de cadrage les REPREND telles quelles, imbriquées sous l'étape qui
 * les a produites (`web/src/components/flux-cadrage.tsx`) : la recherche de
 * mémoire n'est plus un fil à part posé à côté du déroulé, c'est le DÉTAIL de
 * l'étape « Lecture de la mémoire ». Un seul dessin pour les deux endroits :
 * deux copies auraient divergé au premier ajustement.
 */
export function ListeDesBullesDuFil({ bulles }: { bulles: BulleDuFilAgent[] }) {
  if (!bulles.length) return null;
  return (
      <ol className="relative space-y-2 pl-7 before:absolute before:bottom-4 before:left-[9.5px] before:top-4 before:w-px before:bg-faint/30">
        {bulles.map((bulle) => {
          const Icone = bulle.nature === 'requete'
            ? MessageCircle
            : bulle.nature === 'recherche'
              ? Search
              : bulle.nature === 'resume'
                ? Brain
                : FileText;
          return (
            <li
              key={bulle.cle}
              data-bulle-agent={bulle.nature}
              data-etape-fil={bulle.cle}
              className="relative min-w-0"
            >
              <span
                className={cn(
                  'absolute -left-7 top-2 flex h-5 w-5 items-center justify-center rounded-full border bg-surface',
                  bulle.reussie ? 'border-faint/60 text-faint' : 'border-danger/60 text-danger',
                )}
                aria-hidden="true"
              >
                <Icone className="h-2.5 w-2.5" />
              </span>
              <div className="min-w-0 rounded-xl rounded-tl-sm border border-border bg-surface/80 px-3 py-2">
                <p className="text-[11.5px] font-medium text-faint">{t(bulle.titre)}</p>
                <p className="mt-0.5 whitespace-pre-line break-words text-[13.5px] leading-relaxed text-muted [overflow-wrap:anywhere]">
                  {bulle.texte}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
  );
}
