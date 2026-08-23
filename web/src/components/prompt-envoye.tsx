import * as React from 'react';
import { Brain, FileText, MessageCircle, Search } from 'lucide-react';
import { SentContextSnapshot, filVisuelDeLAgent } from '@haikodev/shared';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * Le suivi des recherches faites par l'agent.
 *
 * Il vit à gauche, comme une parole de l'agent. Quatre bulles courtes montrent
 * la requête, les recherches, ce qui a été compris et les directives retrouvées
 * plus bas dans leurs résultats. Le prompt complet n'est jamais recopié ici.
 */
export function BullesDuPromptEnvoye({
  contexte,
}: {
  contexte: SentContextSnapshot;
  demandeDejaAffichee?: boolean;
}) {
  const bulles = React.useMemo(() => filVisuelDeLAgent(contexte), [contexte]);
  if (!bulles.length) return null;

  return (
    <div data-prompt-envoye data-fil-agent className="w-[min(92%,860px)] min-w-0 max-w-full py-2">
      <ol className="relative space-y-2 pl-7 before:absolute before:bottom-4 before:left-[9.5px] before:top-4 before:w-px before:bg-faint/30">
        {bulles.map((bulle) => {
          const Icone = bulle.cle === 'requete'
            ? MessageCircle
            : bulle.cle === 'recherche'
              ? Search
              : bulle.cle === 'resume'
                ? Brain
                : FileText;
          return (
            <li key={bulle.cle} data-bulle-agent={bulle.cle} className="relative min-w-0">
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
    </div>
  );
}
