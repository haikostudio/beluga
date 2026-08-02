import * as React from 'react';
import { Activity, RefreshCw, Volume2, Settings2, Sun, Moon, Wifi, WifiOff } from 'lucide-react';
import { Button, Gauge, Tooltip } from '@/components/ui';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';

/** Le bandeau des quotas (PLAN §19) : où en sont les moteurs installés. */
export function QuotaBar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const state = useApp();
  const [theme, setTheme] = React.useState<'dark' | 'light'>(
    () => (localStorage.getItem('haikodev.theme') === 'light' ? 'light' : 'dark'),
  );
  const [speaking, setSpeaking] = React.useState(false);

  const applyTheme = (next: 'dark' | 'light') => {
    setTheme(next);
    localStorage.setItem('haikodev.theme', next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    document.documentElement.style.colorScheme = next;
  };

  const listen = async () => {
    setSpeaking(true);
    try {
      const audio = new Audio(`/api/digest?audio=1&project=${state.activeProjectId ?? ''}`);
      audio.addEventListener('ended', () => setSpeaking(false));
      audio.addEventListener('error', async () => {
        setSpeaking(false);
        // Repli : la voix du navigateur, si le serveur n'a pas de moteur.
        const data = await client.call<{ text: string }>({ type: 'digest.speak', projectId: state.activeProjectId ?? undefined });
        if ('speechSynthesis' in window && data?.text) {
          const utterance = new SpeechSynthesisUtterance(data.text);
          utterance.lang = 'fr-FR';
          speechSynthesis.speak(utterance);
        }
      });
      await audio.play();
    } catch {
      setSpeaking(false);
    }
  };

  const capacity = state.capacity;

  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-bg px-2.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[13px] font-semibold tracking-tight text-text">HaikoDev</span>
        <Tooltip label={state.connected ? 'Connecté au serveur' : 'Reconnexion…'}>
          <span>
            {state.connected ? (
              <Wifi className="h-3 w-3 text-success" />
            ) : (
              <WifiOff className="h-3 w-3 animate-pulse-soft text-warning" />
            )}
          </span>
        </Tooltip>
      </div>

      <div className="ml-1 flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
        {state.quotas.map((quota) => {
          const session = quota.session?.usedPct ?? 0;
          const weekly = quota.weekly?.usedPct ?? 0;
          const worst = Math.max(session, weekly);
          return (
            <Tooltip
              key={quota.id}
              label={
                <div className="space-y-0.5">
                  <p className="font-medium">
                    {quota.label} {quota.plan ? `· ${quota.plan}` : ''}
                  </p>
                  <p>Fenêtre courte : {Math.round(session)} %</p>
                  <p>Semaine : {Math.round(weekly)} %</p>
                  {quota.weekly?.resetsAt ? (
                    <p>Remise à zéro : {new Date(quota.weekly.resetsAt).toLocaleString('fr-CH')}</p>
                  ) : null}
                  {quota.error ? <p className="text-warning">{quota.error}</p> : null}
                </div>
              }
            >
              <div className="flex w-[124px] shrink-0 flex-col gap-0.5">
                <div className="flex items-center gap-1">
                  <span
                    className={cn(
                      'h-1.5 w-1.5 shrink-0 rounded-full',
                      !quota.available ? 'bg-danger' : quota.active ? 'bg-success' : 'bg-faint',
                    )}
                  />
                  <span className="truncate text-[10.5px] text-muted">{quota.label}</span>
                  <span className="ml-auto text-[10px] text-faint">{Math.round(worst)}%</span>
                </div>
                <Gauge value={worst} height="h-1" />
              </div>
            </Tooltip>
          );
        })}
      </div>

      {capacity ? (
        <Tooltip
          label={`${capacity.runningAgents} agent(s) en cours · ${capacity.slotsFree} peuvent encore démarrer · mémoire ${Math.round(
            capacity.memUsedMb / 1024,
          )}/${Math.round(capacity.memTotalMb / 1024)} Go`}
        >
          <button
            onClick={onOpenSettings}
            className="hidden items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-muted hover:bg-raised sm:flex"
          >
            <Activity className="h-3 w-3" />
            {capacity.slotsFree} places
          </button>
        </Tooltip>
      ) : null}

      <div className="flex items-center gap-0.5">
        <Tooltip label="Écouter le point">
          <Button variant="ghost" size="icon" onClick={listen} disabled={speaking}>
            <Volume2 className={cn('h-3.5 w-3.5', speaking && 'animate-pulse-soft')} />
          </Button>
        </Tooltip>
        <Tooltip label="Actualiser les quotas">
          <Button variant="ghost" size="icon" onClick={() => client.send({ type: 'quota.refresh' })}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </Tooltip>
        <Tooltip label={theme === 'dark' ? 'Thème clair' : 'Thème sombre'}>
          <Button variant="ghost" size="icon" onClick={() => applyTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </Button>
        </Tooltip>
        <Tooltip label="Réglages">
          <Button variant="ghost" size="icon" onClick={onOpenSettings}>
            <Settings2 className="h-3.5 w-3.5" />
          </Button>
        </Tooltip>
      </div>
    </header>
  );
}
