import * as React from 'react';
import { Folder, Plus, Loader2, Search, ChevronDown, Bot } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Dot,
  Input,
  Label,
  Tooltip,
} from '@/components/ui';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn, elapsed } from '@/lib/utils';

export function Sidebar({ onOpenAgent }: { onOpenAgent: (agentId: string) => void }) {
  const state = useApp();
  const [adding, setAdding] = React.useState(false);

  const activeAgents = Object.values(state.agents).filter(
    (agent) => agent.projectId === state.activeProjectId && agent.status === 'running',
  );

  return (
    <aside className="flex w-[196px] shrink-0 flex-col border-r border-border bg-bg">
      <div className="flex items-center gap-1 px-2 py-2">
        <span className="text-[10.5px] uppercase tracking-wide text-faint">Projets</span>
        <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={() => setAdding(true)}>
          <Plus className="h-3 w-3" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-1.5">
        {state.projects.map((project) => {
          const active = project.id === state.activeProjectId;
          const running = Object.values(state.agents).filter(
            (agent) => agent.projectId === project.id && agent.status === 'running',
          ).length;
          return (
            <button
              key={project.id}
              onClick={() => client.setActiveProject(project.id)}
              className={cn(
                'mb-0.5 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors',
                active ? 'bg-raised text-text' : 'text-muted hover:bg-surface hover:text-text',
              )}
            >
              <Folder className="h-3 w-3 shrink-0 text-faint" />
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
              {running ? (
                <span className="flex items-center gap-0.5 text-[10px] text-success">
                  <Dot tone="running" pulse />
                  {running}
                </span>
              ) : null}
            </button>
          );
        })}

        {!state.projects.length ? (
          <p className="px-2 py-3 text-[11.5px] text-faint">Aucun projet inscrit.</p>
        ) : null}
      </div>

      {activeAgents.length ? (
        <div className="border-t border-border px-1.5 py-2">
          <p className="px-1 pb-1 text-[10.5px] uppercase tracking-wide text-faint">Agents en cours</p>
          {activeAgents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => onOpenAgent(agent.id)}
              className="mb-0.5 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[11.5px] text-muted hover:bg-surface hover:text-text"
            >
              <Bot className="h-3 w-3 shrink-0 text-success" />
              <span className="min-w-0 flex-1 truncate">{agent.title}</span>
              <span className="text-[10px] text-faint">{elapsed(agent.startedAt)}</span>
            </button>
          ))}
        </div>
      ) : null}

      <AddProjectDialog open={adding} onClose={() => setAdding(false)} />
    </aside>
  );
}

function AddProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [found, setFound] = React.useState<{ name: string; path: string; git: boolean }[]>([]);
  const [name, setName] = React.useState('');
  const [path, setPath] = React.useState('');
  const [deployCommand, setDeployCommand] = React.useState('');
  const [deployUrl, setDeployUrl] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    client
      .call<{ found: typeof found }>({ type: 'project.scan' })
      .then((data) => setFound(data.found ?? []))
      .catch(() => setFound([]));
  }, [open]);

  const create = async () => {
    if (!name.trim() || !path.trim()) return;
    setBusy(true);
    try {
      const data = await client.call<{ project: { id: string } }>({
        type: 'project.create',
        name: name.trim(),
        path: path.trim(),
        deployCommand: deployCommand.trim() || undefined,
        deployUrl: deployUrl.trim() || undefined,
      });
      client.setActiveProject(data.project.id);
      onClose();
      setName('');
      setPath('');
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'inscription impossible');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent>
        <DialogTitle>Ajouter un projet</DialogTitle>

        {found.length ? (
          <div className="mt-3">
            <Label>Dossiers trouvés sur le serveur</Label>
            <div className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
              {found.map((entry) => (
                <button
                  key={entry.path}
                  onClick={() => {
                    setName(entry.name);
                    setPath(entry.path);
                  }}
                  className={cn(
                    'flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-[12px]',
                    path === entry.path ? 'bg-raised text-text' : 'text-muted hover:bg-surface',
                  )}
                >
                  <Folder className="h-3 w-3 text-faint" />
                  <span className="flex-1 truncate">{entry.name}</span>
                  {entry.git ? <span className="text-[10px] text-faint">git</span> : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-3 space-y-2">
          <div>
            <Label>Nom</Label>
            <Input value={name} onChange={(event) => setName(event.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Dossier sur le serveur</Label>
            <Input value={path} onChange={(event) => setPath(event.target.value)} className="mt-1" placeholder="/root/mon-projet" />
          </div>
          <div>
            <Label>Commande de publication (facultatif)</Label>
            <Input
              value={deployCommand}
              onChange={(event) => setDeployCommand(event.target.value)}
              className="mt-1"
              placeholder="npm run build && sudo systemctl restart mon-projet"
            />
          </div>
          <div>
            <Label>Adresse en ligne (facultatif)</Label>
            <Input
              value={deployUrl}
              onChange={(event) => setDeployUrl(event.target.value)}
              className="mt-1"
              placeholder="https://mon-projet.haikostudio.cloud"
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-1.5">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="default" size="sm" onClick={create} disabled={busy || !name || !path}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Inscrire le projet
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
