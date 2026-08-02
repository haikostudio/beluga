import * as React from 'react';
import { Activity, RefreshCw, Volume2, Settings2, Sun, Moon, Wifi, WifiOff } from 'lucide-react';
import { Button, Tooltip } from '@/components/ui';
import { QuotaBadge } from '@/components/quota-badge';
import { usePref } from '@/lib/prefs';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';

/** Le bandeau des quotas (PLAN §19) : où en sont les moteurs installés. */
export function QuotaBar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const state = useApp();
  // Le moteur « en cours » : celui d'un agent qui travaille, sinon celui du projet.
  const activeEngine =
    Object.values(state.agents).find((agent) => agent.status === 'running')?.run.engine ??
    state.projects.find((p) => p.id === state.activeProjectId)?.defaultEngine ??
    'claude';
  const [theme, setTheme] = usePref<'dark' | 'light'>('theme', 'dark');
  const [speaking, setSpeaking] = React.useState(false);

  const applyTheme = (next: 'dark' | 'light') => {
    setTheme(next);
  };

  // Le thème choisi s'applique dès qu'il est connu, y compris au chargement.
  React.useEffect(() => {
    document.documentElement.classList.toggle('dark', theme !== 'light');
    document.documentElement.style.colorScheme = theme === 'light' ? 'light' : 'dark';
  }, [theme]);

  const listen = async () => {
    setSpeaking(true);
    try {
      const audio = new Audio(`/api/digest?audio=1&project=${state.activeProjectId ?? ''}`);

      // Lecture pilotable écran verrouillé, comme un podcast : commandes du
      // téléphone et Bluetooth de la voiture (PLAN §22).
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: 'Le point du jour',
          artist: 'HaikoDev',
          artwork: [{ src: '/icon-512.png', sizes: '512x512', type: 'image/png' }],
        });
        navigator.mediaSession.setActionHandler('play', () => void audio.play());
        navigator.mediaSession.setActionHandler('pause', () => audio.pause());
        navigator.mediaSession.setActionHandler('stop', () => {
          audio.pause();
          audio.currentTime = 0;
          setSpeaking(false);
        });
      }

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
    <header
      className="flex shrink-0 items-center gap-2 border-b border-border bg-bg px-2.5"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        height: 'calc(44px + env(safe-area-inset-top))',
        paddingLeft: 'max(10px, env(safe-area-inset-left))',
        paddingRight: 'max(10px, env(safe-area-inset-right))',
      }}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-[14.5px] font-semibold tracking-tight text-text">HaikoDev</span>
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

      <div className="flex-1" />

      <QuotaBadge activeEngine={activeEngine} />

      {capacity ? (
        <Tooltip
          label={`${capacity.runningAgents} agent(s) en cours · ${capacity.slotsFree} peuvent encore démarrer · mémoire ${Math.round(
            capacity.memUsedMb / 1024,
          )}/${Math.round(capacity.memTotalMb / 1024)} Go`}
        >
          <button
            onClick={onOpenSettings}
            className="hidden items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[12.5px] text-muted hover:bg-raised sm:flex"
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
