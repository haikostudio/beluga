import * as React from 'react';
import { ChevronDown, ChevronUp, Mic } from '@/components/ui/icones';
import { moteursDeLAssistant, nomDeLAssistant } from '@beluga/shared';
import { CarteMoteur } from '@/components/assistant-moteurs';
import { useVoixDisponible } from '@/lib/voix-disponible';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * « PARLEZ À <NOM> À VOIX HAUTE » (carte « Assistant d'installation et Jarvis », 20/11/2026) — la voix sort de la
 * mise en route : elle demande un compte ChatGPT, qu'on n'a pas forcément au moment d'installer. Elle se propose
 * ici, dans le volet de l'assistant et en tête de Réglages › Voix, TANT QU'AUCUN COMPTE CHATGPT N'EST RELIÉ
 * (`useVoixDisponible().compteRelie === false`) ; elle disparaît dès qu'il l'est.
 *
 * L'EXPLICATION SE DÉPLIE DANS L'ENCADRÉ, pas dans une fenêtre : le volet de l'assistant passe devant toutes les
 * fenêtres (`z-[56]` contre `z-50`), une fenêtre ouverte depuis lui s'ouvrirait DERRIÈRE. Dépliée : deux phrases,
 * puis la carte du moteur Codex — installer l'outil s'il manque, puis relier le compte ChatGPT, la mécanique des
 * réglages (`CarteMoteur`).
 */
export function ParlezAVoixHaute({ className }: { className?: string }) {
  const state = useApp();
  const { compteRelie } = useVoixDisponible();
  const [ouvert, setOuvert] = React.useState(false);
  const nom = nomDeLAssistant(state.settings);
  const codex = moteursDeLAssistant(state.engines, state.quotas).find((m) => m.id === 'codex');
  if (compteRelie !== false) return null;
  return (
    <section className={cn('rounded-xl bg-raised', className)} data-parlez-a-voix-haute data-ouvert={ouvert ? '1' : '0'}>
      <button
        type="button"
        data-activer-la-voix
        aria-expanded={ouvert}
        onClick={() => setOuvert((avant) => !avant)}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
      >
        <Mic className="h-4 w-4 shrink-0 text-text" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium text-text">{t('Parlez à {v0} à voix haute', { v0: nom })}</span>
          <span className="block truncate text-[12.5px] text-muted">{t('Un compte ChatGPT suffit')}</span>
        </span>
        {ouvert ? <ChevronUp className="h-3.5 w-3.5 shrink-0 text-faint" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-faint" />}
      </button>
      {ouvert ? (
        <div className="space-y-2.5 px-3 pb-3" data-explication-de-la-voix>
          <p className="text-[13px] leading-relaxed text-muted">
            {t('Dites « Dis {v0} » et parlez : {v1} vous écoute, réfléchit et vous répond à voix haute, même quand vous êtes loin du clavier.', { v0: nom, v1: nom })}
          </p>
          <p className="text-[13px] leading-relaxed text-muted">
            {t('Il faut pour cela relier un compte ChatGPT au moteur Codex. Rien d’autre à installer : la voix est prête dès que le compte est relié.')}
          </p>
          {codex ? <CarteMoteur moteur={codex} /> : null}
        </div>
      ) : null}
    </section>
  );
}
