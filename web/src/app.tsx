import * as React from 'react';
import { PanelRight, FolderTree, LayoutGrid, MessageSquare, Loader2 } from 'lucide-react';
import { TooltipProvider, Button, EmptyState } from '@/components/ui';
import { QuotaBar } from '@/components/quota-bar';
import { Sidebar } from '@/components/sidebar';
import { Board } from '@/components/board';
import { RightPanel } from '@/components/right-panel';
import { CardPanel } from '@/components/card-panel';
import { AgentDock } from '@/components/agent-dock';
import { SettingsView } from '@/components/settings-view';
import { Chat } from '@/components/chat';
import { useResizable, ResizeHandle } from '@/components/resizer';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';


/** La clé du serveur arrive en base64 « url » : le navigateur la veut en octets. */
function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buffer;
}

export function App() {
  const state = useApp();
  const [openCardId, setOpenCardId] = React.useState<string | null>(null);
  const [openAgentId, setOpenAgentId] = React.useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [rightOpen, setRightOpen] = React.useState(() => window.innerWidth >= 1100);
  const [mobileView, setMobileView] = React.useState<'projects' | 'board' | 'chat'>('board');
  const [dropTarget, setDropTarget] = React.useState(false);

  // Largeurs des deux panneaux, retenues d'une session à l'autre.
  const gauche = useResizable('sidebar', { initial: 196, min: 150, max: 420 });
  const droite = useResizable('panel', { initial: 360, min: 280, max: 720 });

  React.useEffect(() => {
    client.connect();
  }, []);

  /*
   * L'application est ancrée aux quatre bords de la fenêtre (voir la racine
   * plus bas) : elle ne peut donc plus laisser de bande vide en bas.
   *
   * Reste le clavier : quand il s'ouvre, il recouvre le bas de l'écran. On
   * mesure exactement sa hauteur et on réserve ce creux, au lieu de laisser le
   * téléphone décaler toute la page — c'était le sursaut du champ de saisie.
   */
  React.useEffect(() => {
    const vue = window.visualViewport;
    const appliquer = () => {
      const cache = vue ? window.innerHeight - vue.height - vue.offsetTop : 0;
      document.documentElement.style.setProperty('--clavier', `${Math.max(0, Math.round(cache))}px`);
    };
    appliquer();
    vue?.addEventListener('resize', appliquer);
    vue?.addEventListener('scroll', appliquer);
    window.addEventListener('orientationchange', appliquer);
    window.addEventListener('resize', appliquer);
    return () => {
      vue?.removeEventListener('resize', appliquer);
      vue?.removeEventListener('scroll', appliquer);
      window.removeEventListener('orientationchange', appliquer);
      window.removeEventListener('resize', appliquer);
    };
  }, []);

  // Une carte affichée dans la conversation s'ouvre dans le tiroir.
  React.useEffect(() => client.onOpenCard(setOpenCardId), []);

  // Sur téléphone, choisir un projet dans la liste ramène au tableau.
  const premierProjet = React.useRef(true);
  React.useEffect(() => {
    if (premierProjet.current) {
      premierProjet.current = false;
      return;
    }
    setMobileView('board');
  }, [state.activeProjectId]);

  // Notifications système, cliquables : elles ouvrent la carte concernée.
  React.useEffect(() => {
    return client.onNotify((event) => {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      const notification = new Notification(event.title, { body: event.body, tag: event.tag, icon: '/icon-192.png' });
      notification.onclick = () => {
        window.focus();
        if (event.projectId) client.setActiveProject(event.projectId);
        if (event.cardId) setOpenCardId(event.cardId);
      };
    });
  }, []);

  // Abonnement aux notifications poussées : l'application prévient même fermée.
  React.useEffect(() => {
    const setup = async () => {
      if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
      if (Notification.permission === 'default') {
        await new Promise((resolve) => setTimeout(resolve, 8000));
        await Notification.requestPermission().catch(() => undefined);
      }
      if (Notification.permission !== 'granted') return;
      try {
        const me = await fetch('/api/me').then((r) => r.json());
        if (!me?.pushKey) return;
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        const subscription =
          existing ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(me.pushKey),
          }));
        await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(subscription),
        });
      } catch {
        /* le navigateur refuse les notifications poussées : on s'en passe */
      }
    };
    void setup();

    // Un appui sur une notification ouvre la carte concernée.
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OPEN_CARD') {
        if (event.data.projectId) client.setActiveProject(event.data.projectId);
        if (event.data.cardId) setOpenCardId(event.data.cardId);
      }
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage);
  }, []);

  const activeProject = state.projects.find((project) => project.id === state.activeProjectId);
  const openAgent = openAgentId ? state.agents[openAgentId] : null;

  if (!state.connected && !state.projects.length) {
    return (
      <div className="grid h-full place-items-center bg-bg">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-faint" />
          <p className="text-[14px] text-faint">
            {state.connecting ? 'Connexion au serveur…' : 'Serveur injoignable — nouvelle tentative…'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div
        // Ancrée aux quatre bords : aucune bande vide possible, sur aucun
        // téléphone. Le creux du bas est réservé au clavier quand il s'ouvre.
        className="fixed inset-0 flex flex-col overflow-hidden bg-bg"
        style={{ paddingBottom: 'var(--clavier, 0px)' }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault();
            setDropTarget(true);
          }
        }}
        onDragLeave={() => setDropTarget(false)}
        onDrop={(event) => {
          if (event.dataTransfer.files.length) {
            event.preventDefault();
            setDropTarget(false);
            // Sans conversation ouverte, le dépôt est refusé avec un message clair.
            if (!openAgent && !openCardId && !rightOpen) {
              client.pushToast('warning', "Ouvrez d'abord une conversation pour y déposer un fichier.");
            } else {
              client.pushToast('info', 'Déposez le fichier directement dans la barre d\'écriture de la conversation.');
            }
          }
        }}
      >
        <QuotaBar onOpenSettings={() => setSettingsOpen(true)} />

        <div className="flex min-h-0 flex-1">
          {/* Sur téléphone, la colonne de gauche est un onglet à part entière :
              sans elle, on ne peut pas changer de projet. */}
          <div
            className={cn(
              'sm:flex',
              mobileView === 'projects' ? 'flex min-w-0 flex-1' : 'hidden',
            )}
          >
            <Sidebar onOpenAgent={setOpenAgentId} width={gauche.width} />
          </div>
          <ResizeHandle
            className="hidden sm:block"
            onPointerDown={(event) => gauche.start(event, 'left')}
            onDoubleClick={gauche.reset}
          />

          <main className={cn('flex min-w-0 flex-1 flex-col', mobileView !== 'board' && 'hidden sm:flex')}>
            {activeProject ? (
              <Board projectId={activeProject.id} onOpenCard={setOpenCardId} />
            ) : (
              <EmptyState
                icon={<LayoutGrid className="h-5 w-5" />}
                title="Aucun projet sélectionné"
                hint="Ajoutez un projet depuis la colonne de gauche pour commencer."
              />
            )}
          </main>

          {activeProject && rightOpen ? (
            <>
              <ResizeHandle
                className="hidden lg:block"
                onPointerDown={(event) => droite.start(event, 'right')}
                onDoubleClick={droite.reset}
              />
              <aside
                className="hidden shrink-0 border-l border-border lg:flex lg:flex-col"
                style={{ width: `${droite.width}px` }}
              >
                <RightPanel projectId={activeProject.id} />
              </aside>
            </>
          ) : null}

          {/* Sur téléphone, la conversation prend toute la place */}
          {activeProject && mobileView === 'chat' ? (
            <aside className="flex min-w-0 flex-1 flex-col sm:hidden">
              <RightPanel projectId={activeProject.id} />
            </aside>
          ) : null}
        </div>

        {/* Barre de navigation mobile */}
        <nav
          className="flex shrink-0 items-center justify-around border-t border-border bg-bg pt-1 sm:hidden"
          // Juste la zone sûre du téléphone en dessous, pas un doigt de plus.
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <Button
            variant="ghost"
            size="sm"
            className={cn('flex-1', mobileView === 'projects' && 'text-text')}
            onClick={() => setMobileView('projects')}
          >
            <FolderTree className="h-3.5 w-3.5" /> Projets
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn('flex-1', mobileView === 'board' && 'text-text')}
            onClick={() => setMobileView('board')}
          >
            <LayoutGrid className="h-3.5 w-3.5" /> Tableau
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn('flex-1', mobileView === 'chat' && 'text-text')}
            onClick={() => setMobileView('chat')}
          >
            <MessageSquare className="h-3.5 w-3.5" /> Chef
          </Button>
        </nav>

        <Button
          variant="ghost"
          size="icon"
          className="fixed right-2 top-1.5 z-50 hidden lg:flex"
          onClick={() => setRightOpen((value) => !value)}
        >
          <PanelRight className="h-3.5 w-3.5" />
        </Button>

        {dropTarget ? (
          <div className="pointer-events-none fixed inset-0 z-50 border-2 border-dashed border-muted bg-black/20" />
        ) : null}

        <CardPanel cardId={openCardId} onClose={() => setOpenCardId(null)} />
        <SettingsView open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        <AgentDock onOpenAgent={setOpenAgentId} />

        {openAgent ? (
          <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-3" onClick={() => setOpenAgentId(null)}>
            <div
              className="flex h-[80dvh] w-[min(720px,100%)] flex-col overflow-hidden rounded-lg border border-border bg-surface"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="flex items-center gap-2 border-b border-border px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium text-text">{openAgent.title}</span>
                <Button variant="ghost" size="sm" onClick={() => setOpenAgentId(null)}>
                  Fermer
                </Button>
              </header>
              <div className="min-h-0 flex-1">
                <Chat agent={openAgent} projectId={openAgent.projectId} />
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </TooltipProvider>
  );
}
