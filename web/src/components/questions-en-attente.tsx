import * as React from 'react';
import { MessageCircleQuestion } from 'lucide-react';
import { DecisionAttendue, decisionsOuvertes } from '@haikodev/shared';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';

/**
 * Le triangle de la colonne de gauche dit qu'il y a des décisions attendues,
 * mais pas LESQUELLES : il fallait deviner le bon projet, ouvrir la bonne
 * carte, pour tomber dessus. Cette cloche liste TOUTES les questions en
 * attente, tous projets confondus, avec de quoi les reconnaître — projet,
 * carte ou conversation, et le texte de la question — et un clic y emmène
 * directement. Posée dans le bandeau du haut : elle reste visible qu'on soit
 * sur le tableau, une conversation ou les réglages.
 */
export function QuestionsEnAttente() {
  const state = useApp();
  const [open, setOpen] = React.useState(false);
  const decisions = decisionsOuvertes(state.decisions);

  if (!decisions.length) return null;

  const libelle = decisions.length > 1 ? `${decisions.length} questions en attente` : 'Une question en attente';

  const aller = (decision: DecisionAttendue) => {
    setOpen(false);
    client.allerVersDecision(decision);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="relative"
          aria-label={libelle}
          title={libelle}
          data-repere-questions
        >
          <MessageCircleQuestion className="h-4 w-4" />
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[10px] font-medium leading-none text-white">
            {decisions.length}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(360px,90vw)]">
        <DropdownMenuLabel>{libelle}</DropdownMenuLabel>
        {decisions.map((decision, index) => (
          <DropdownMenuItem
            key={`${decision.projectId}-${decision.agentId ?? ''}-${decision.cardId ?? ''}-${index}`}
            className="flex-col items-start gap-0.5 whitespace-normal py-2"
            data-question-en-attente
            onSelect={() => aller(decision)}
          >
            <span className="flex w-full items-center gap-1 text-[11.5px] text-faint">
              <span className="truncate">{decision.projectName ?? 'Projet'}</span>
              {decision.lieuTitre ? (
                <>
                  <span aria-hidden>·</span>
                  <span className="truncate">{decision.lieuTitre}</span>
                </>
              ) : null}
            </span>
            <span className="line-clamp-2 text-left text-[13.5px] text-text">
              {decision.texte ?? 'Une décision est attendue.'}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
