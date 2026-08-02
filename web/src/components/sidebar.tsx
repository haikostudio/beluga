import * as React from 'react';
import {
  Bot,
  CircleDollarSign,
  Folder,
  FolderPlus,
  GripVertical,
  Loader2,
  Plus,
  Search,
  Settings2,
} from 'lucide-react';
import { Project } from '@haikodev/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Dot,
  Input,
  Label,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
} from '@/components/ui';
import { ProjectSettings } from '@/components/project-settings';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn, elapsed } from '@/lib/utils';

export function Sidebar({
  onOpenAgent,
  width,
}: {
  onOpenAgent: (agentId: string) => void;
  width?: number;
}) {
  const state = useApp();
  const [adding, setAdding] = React.useState(false);
  const [settingsFor, setSettingsFor] = React.useState<string | null>(null);

  // Glisser-déposer : l'ordre s'affiche tout de suite, puis se confirme.
  const [order, setOrder] = React.useState<string[] | null>(null);
  const [dragged, setDragged] = React.useState<string | null>(null);

  const projects = React.useMemo(() => {
    if (!order) return state.projects;
    const byId = new Map(state.projects.map((p) => [p.id, p]));
    const sorted = order.map((id) => byId.get(id)).filter(Boolean) as Project[];
    for (const project of state.projects) if (!order.includes(project.id)) sorted.push(project);
    return sorted;
  }, [state.projects, order]);

  const activeAgents = Object.values(state.agents).filter(
    (agent) => agent.projectId === state.activeProjectId && agent.status === 'running',
  );

  const dropOn = async (targetId: string) => {
    if (!dragged || dragged === targetId) return;
    const ids = projects.map((p) => p.id);
    const from = ids.indexOf(dragged);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    setOrder(ids);
    setDragged(null);
    try {
      await client.call({ type: 'project.reorder', ids });
    } catch {
      setOrder(null);
      client.pushToast('error', 'Ordre non enregistré');
    }
  };

  return (
    <aside
      className="flex shrink-0 flex-col border-r border-border bg-bg"
      style={{ width: width ? `${width}px` : '196px' }}
    >
      <div className="flex items-center gap-1 px-2 py-2">
        <span className="text-[10.5px] uppercase tracking-wide text-faint">Projets</span>
        <Tooltip label="Ajouter ou créer un projet">
          <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={() => setAdding(true)}>
            <Plus className="h-3 w-3" />
          </Button>
        </Tooltip>
      </div>

      <div className="flex-1 overflow-y-auto px-1.5">
        {projects.map((project) => {
          const active = project.id === state.activeProjectId;
          const running = Object.values(state.agents).filter(
            (agent) => agent.projectId === project.id && agent.status === 'running',
          ).length;
          return (
            <div
              key={project.id}
              draggable
              onDragStart={() => setDragged(project.id)}
              onDragEnd={() => setDragged(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void dropOn(project.id);
              }}
              className={cn(
                'group mb-0.5 flex w-full items-center gap-1 rounded-md px-1.5 py-1.5 text-[12.5px] transition-colors',
                active ? 'bg-raised text-text' : 'text-muted hover:bg-surface hover:text-text',
                dragged === project.id && 'opacity-40',
                dragged && dragged !== project.id && 'border-t border-transparent hover:border-muted',
              )}
            >
              <GripVertical className="h-3 w-3 shrink-0 cursor-grab text-faint opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing" />
              <button
                onClick={() => client.setActiveProject(project.id)}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              >
                <Folder className="h-3 w-3 shrink-0 text-faint" />
                <span className="min-w-0 flex-1 truncate">{project.name}</span>
                {project.billing?.clientId ? (
                  <Tooltip
                    label={`Facturé à ${project.billing.clientName ?? 'un client'} · ${project.billing.hourlyRate} CHF/h`}
                  >
                    <CircleDollarSign className="h-2.5 w-2.5 shrink-0 text-faint" />
                  </Tooltip>
                ) : null}
                {running ? (
                  <span className="flex items-center gap-0.5 text-[10px] text-success">
                    <Dot tone="running" pulse />
                    {running}
                  </span>
                ) : null}
              </button>
              <button
                onClick={() => setSettingsFor(project.id)}
                className="shrink-0 text-faint opacity-0 transition-opacity hover:text-text group-hover:opacity-100"
                title="Réglages du projet"
              >
                <Settings2 className="h-3 w-3" />
              </button>
            </div>
          );
        })}

        {!projects.length ? <p className="px-2 py-3 text-[11.5px] text-faint">Aucun projet inscrit.</p> : null}
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

      <ProjectsDialog open={adding} onClose={() => setAdding(false)} />
      <ProjectSettings
        project={state.projects.find((p) => p.id === settingsFor) ?? null}
        open={!!settingsFor}
        onClose={() => setSettingsFor(null)}
      />
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Ajouter un projet existant, ou en créer un nouveau                   */
/* ------------------------------------------------------------------ */

interface Found {
  name: string;
  path: string;
  git: boolean;
}

function ProjectsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [found, setFound] = React.useState<Found[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [filter, setFilter] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null);

  const [newName, setNewName] = React.useState('');
  const [newFolder, setNewFolder] = React.useState('');
  const [newRemote, setNewRemote] = React.useState('');
  const [withGit, setWithGit] = React.useState(true);

  const refresh = React.useCallback(() => {
    setLoading(true);
    client
      .call<{ found: Found[] }>({ type: 'project.scan' })
      .then((data) => setFound(data.found ?? []))
      .catch(() => setFound([]))
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const addExisting = async (entry: Found) => {
    setBusy(entry.path);
    try {
      const data = await client.call<{ project: { id: string } }>({
        type: 'project.create',
        name: entry.name,
        path: entry.path,
      });
      client.setActiveProject(data.project.id);
      setFound((current) => current.filter((f) => f.path !== entry.path));
      client.pushToast('success', `« ${entry.name} » ajouté`);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'inscription impossible');
    } finally {
      setBusy(null);
    }
  };

  const createNew = async () => {
    if (!newName.trim()) return;
    setBusy('new');
    try {
      const data = await client.call<{ project: { id: string } }>(
        {
          type: 'project.new',
          name: newName.trim(),
          folder: newFolder.trim() || undefined,
          git: withGit,
          gitRemote: newRemote.trim() || undefined,
        },
        120000,
      );
      client.setActiveProject(data.project.id);
      setNewName('');
      setNewFolder('');
      setNewRemote('');
      onClose();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'création impossible');
    } finally {
      setBusy(null);
    }
  };

  const visible = filter
    ? found.filter((entry) => entry.name.toLowerCase().includes(filter.toLowerCase()))
    : found;

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="w-[min(600px,calc(100vw-16px))]">
        <DialogTitle>Projets du serveur</DialogTitle>

        <Tabs defaultValue="existing" className="mt-3">
          <TabsList>
            <TabsTrigger value="existing">Déjà sur le serveur</TabsTrigger>
            <TabsTrigger value="new">Nouveau projet</TabsTrigger>
          </TabsList>

          {/* ---------- Tous les dossiers présents sur le serveur ---------- */}
          <TabsContent value="existing" className="mt-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-faint" />
              <Input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Chercher un projet…"
                className="pl-7"
              />
            </div>

            {loading ? (
              <p className="mt-3 flex items-center gap-1.5 text-[12px] text-faint">
                <Loader2 className="h-3 w-3 animate-spin" /> Lecture des dossiers du serveur…
              </p>
            ) : visible.length ? (
              <>
                <p className="mt-2 text-[11px] text-faint">
                  {visible.length} projet{visible.length > 1 ? 's' : ''} trouvé{visible.length > 1 ? 's' : ''} et pas
                  encore suivi{visible.length > 1 ? 's' : ''}.
                </p>
                <div className="mt-1.5 max-h-[340px] space-y-0.5 overflow-y-auto">
                  {visible.map((entry) => (
                    <div
                      key={entry.path}
                      className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1.5"
                    >
                      <Folder className="h-3 w-3 shrink-0 text-faint" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] text-text">{entry.name}</p>
                        <p className="truncate text-[10px] text-faint">
                          {entry.path}
                          {entry.git ? ' · suivi par git' : ''}
                        </p>
                      </div>
                      <Button size="sm" variant="outline" disabled={busy === entry.path} onClick={() => addExisting(entry)}>
                        {busy === entry.path ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                        Suivre
                      </Button>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-3 text-[12px] text-faint">
                Tous les projets du serveur sont déjà dans votre liste.
              </p>
            )}
          </TabsContent>

          {/* ---------- Créer un projet neuf ---------- */}
          <TabsContent value="new" className="mt-3 space-y-2.5">
            <div>
              <Label>Nom du projet</Label>
              <Input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                className="mt-1"
                placeholder="Mon nouveau site"
                autoFocus
              />
            </div>
            <div>
              <Label>Nom du dossier (facultatif)</Label>
              <Input
                value={newFolder}
                onChange={(event) => setNewFolder(event.target.value)}
                className="mt-1"
                placeholder="déduit du nom"
              />
            </div>
            <div>
              <Label>Dépôt distant (facultatif)</Label>
              <Input
                value={newRemote}
                onChange={(event) => setNewRemote(event.target.value)}
                className="mt-1"
                placeholder="git@github.com:haikostudio/mon-projet.git"
              />
            </div>
            <label className="flex items-center gap-2 text-[12.5px] text-muted">
              <Switch checked={withGit} onCheckedChange={setWithGit} />
              Démarrer un dépôt git dans le dossier
            </label>

            <p className="text-[11px] leading-snug text-faint">
              Le dossier est créé pour de vrai sur le serveur, avec un premier fichier de présentation, puis il apparaît
              dans la liste de gauche.
            </p>

            <Button variant="default" size="sm" disabled={!newName.trim() || busy === 'new'} onClick={createNew}>
              {busy === 'new' ? <Loader2 className="h-3 w-3 animate-spin" /> : <FolderPlus className="h-3 w-3" />}
              Créer le projet
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
