import * as React from 'react';
import { Brain, FileText, MessageCircle, Search } from '@/components/ui/icones';
import { BulleDuFilAgent, SentContextEtat, filVisuelDeLAgent } from '@beluga/shared';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * Le suivi des recherches faites par l'agent.
 *
 * Il vit à gauche, comme une parole de l'agent. Chaque résultat ajoute ses
 * propres étapes courtes à la suite, À PLAT (aucun cadre, fond ni arrondi) : la recherche, ce qui a été compris et les
 * directives éventuellement retrouvées. Le texte entier du prompt ne tient pas
 * dans ces bulles : il se lit par le lien de `prompt-envoye-complet.tsx`.
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
      <ol className="relative space-y-3 pl-7 before:absolute before:bottom-3 before:left-[9.5px] before:top-3 before:w-px before:bg-faint/30">
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
                  'absolute -left-7 top-0 flex h-5 w-5 items-center justify-center rounded-full border bg-surface',
                  bulle.reussie ? 'border-faint/60 text-faint' : 'border-danger/60 text-danger',
                )}
                aria-hidden="true"
              >
                <Icone className="h-2.5 w-2.5" />
              </span>
              {/* À PLAT (16/11/2026, captures #b82e et #3109) : plus de cadre,
                  de fond ni d'arrondi — l'étape se lit comme le parcours d'un
                  agent, un intitulé estompé puis son texte, sur le fil à icônes. */}
              <div data-etape-a-plat className="min-w-0">
                <p className="text-[11.5px] font-medium leading-5 text-faint">{t(bulle.titre)}</p>
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
