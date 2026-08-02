import * as React from 'react';
import { Activity, BookOpen, MoreVertical, Network, Square, Volume2, Settings2, Sun, Moon } from 'lucide-react';
import {
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
} from '@/components/ui';
import { MemoryView } from '@/components/memory-view';
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
  const [memoireOuverte, setMemoireOuverte] = React.useState(false);
  const [arretGroupe, setArretGroupe] = React.useState(false);

  /*
   * Les agents qui travaillent à cet instant : tous pour le compteur du coin
   * gauche (c'est l'état de la machine), ceux du projet affiché pour l'arrêt
   * groupé (on n'arrête jamais le travail d'un autre projet sans le dire).
   */
  const enCours = Object.values(state.agents).filter((agent) => agent.status === 'running');
  const duProjet = enCours.filter((agent) => agent.projectId === state.activeProjectId);

  const arreterLeProjet = () => {
    for (const agent of duProjet) client.send({ type: 'agent.stop', agentId: agent.id });
    client.pushToast(
      'info',
      duProjet.length > 1 ? `${duProjet.length} agents arrêtés.` : 'Agent arrêté.',
    );
  };

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
      {/* Le seul repère à gauche : des nœuds reliés, verts quand la liaison au
          serveur tient, orange et clignotants quand elle est rompue. Le nombre
          d'agents ne s'affiche que lorsque PLUSIEURS travaillent en même temps :
          seul, un agent n'apprend rien de plus que la bande « en cours ». */}
      <Tooltip
        label={
          state.connected
            ? enCours.length > 1
              ? `Connecté au serveur · ${enCours.length} agents travaillent`
              : 'Connecté au serveur'
            : 'Reconnexion…'
        }
      >
        <span className="flex items-center gap-1">
          <Network
            className={cn(
              'h-4 w-4',
              state.connected ? 'text-success' : 'animate-pulse-soft text-warning',
            )}
          />
          {enCours.length > 1 ? (
            <span className="rounded-full bg-raised px-1.5 text-[11.5px] font-medium tabular-nums text-muted">
              {enCours.length}
            </span>
          ) : null}
        </span>
      </Tooltip>

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

      {/* Un seul bouton : son, thème et réglages vivent derrière les trois
          points (menu sur ordinateur, tiroir en bas sur téléphone). */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Menu" title="Menu">
            <MoreVertical className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={!state.activeProjectId}
            onSelect={() => setMemoireOuverte(true)}
          >
            <BookOpen className="h-3.5 w-3.5" />
            Mémoire du projet
          </DropdownMenuItem>
          {duProjet.length ? (
            <DropdownMenuItem className="text-danger" onSelect={() => setArretGroupe(true)}>
              <Square className="h-3.5 w-3.5 fill-current" />
              Arrêter les agents du projet ({duProjet.length})
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={speaking} onSelect={() => void listen()}>
            <Volume2 className={cn('h-3.5 w-3.5', speaking && 'animate-pulse-soft')} />
            Écouter le point
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => applyTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            {theme === 'dark' ? 'Thème clair' : 'Thème sombre'}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onOpenSettings}>
            <Settings2 className="h-3.5 w-3.5" />
            Réglages
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <MemoryView
        open={memoireOuverte}
        projectId={state.activeProjectId ?? undefined}
        onClose={() => setMemoireOuverte(false)}
      />

      <ConfirmDialog
        open={arretGroupe}
        danger
        title={
          duProjet.length > 1
            ? `Arrêter les ${duProjet.length} agents de ce projet ?`
            : 'Arrêter l’agent de ce projet ?'
        }
        description="Le travail en cours sera perdu. Les agents des autres projets continuent."
        confirmLabel="Tout arrêter"
        onConfirm={arreterLeProjet}
        onClose={() => setArretGroupe(false)}
      />
    </header>
  );
}
