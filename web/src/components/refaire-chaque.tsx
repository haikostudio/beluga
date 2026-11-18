import * as React from 'react';
import { Loader2, Repeat } from '@/components/ui/icones';
import type { Message } from '@beluga/shared';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { t } from '@/lib/langue';

/**
 * « REFAIRE CHAQUE… » SOUS LE COMPTE RENDU D'UNE CARTE QUI A TRAVAILLÉ DANS CHROME (carte « Pilotage de Chrome par
 * Beluga », 09/11/2026). Un agent a mené le parcours à bien une fois : ce bouton en fait un GESTE RÉPÉTÉ (chaque
 * semaine ou chaque mois, au même jour et à la même heure). Le clic vaut accord de lancement ; le geste se règle
 * ensuite dans Réglages → Extension.
 */
export function RefaireChaque({ message }: { message: Message }) {
  const { agents } = useApp();
  const [fait, setFait] = React.useState<string | null>(null);
  const [enCours, setEnCours] = React.useState(false);
  const cardId = agents[message.agentId]?.cardId;
  const aPiloteChrome = message.role === 'assistant' && !message.streaming && message.steps.some((s) => s.state === 'done' && /(^|_)chrome$/.test(s.outil ?? ''));
  if (!cardId || !aPiloteChrome) return null;

  const creer = async (frequence: 'semaine' | 'mois') => {
    setEnCours(true);
    try {
      const r = await client.call<{ routine: { phrase: string } }>({ type: 'extension.routine.creer', cardId, frequence });
      setFait(r.routine.phrase);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Le geste n’a pas abouti.'));
    } finally {
      setEnCours(false);
    }
  };

  if (fait) {
    return (
      <p className="mt-2 text-[13px] text-muted" data-refaire-fait>
        {t('Geste répété enregistré : {phrase}. Il se règle dans Réglages → Extension.', { phrase: fait })}
      </p>
    );
  }
  return (
    <div className="mt-2" data-refaire-chaque>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="subtle" size="md" disabled={enCours}>
            {enCours ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Repeat className="h-3.5 w-3.5" />}
            {t('Refaire chaque…')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => void creer('semaine')} data-refaire="semaine">
            {t('Chaque semaine')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void creer('mois')} data-refaire="mois">
            {t('Chaque mois')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
