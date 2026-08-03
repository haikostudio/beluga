import * as React from 'react';
import {
  Archive,
  ArchiveRestore,
  Bot,
  ChevronRight,
  CircleDollarSign,
  Folder,
  FolderPlus,
  GripVertical,
  Loader2,
  Palette,
  Pencil,
  Plus,
  Power,
  Search,
  Settings2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { Project, ProjectGroup, avertissementRedemarrage, rendusDuGroupe } from '@haikodev/shared';
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogTitle,
  Dot,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Input,
  Label,
  PromptDialog,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
} from '@/components/ui';
import { Filet } from '@/components/filet';
import { ProjectSettings } from '@/components/project-settings';
import { client } from '@/lib/client';
import { usePointerDrag } from '@/lib/dnd';
import { usePref } from '@/lib/prefs';
import { useApp } from '@/lib/use-app';
import { cn, elapsed } from '@/lib/utils';

/** Un élément de la colonne : un projet hors groupe, ou un groupe entier. */
type Entry =
  | { kind: 'project'; id: string; rank: number; project: Project }
  | { kind: 'group'; id: string; rank: number; group: ProjectGroup; members: Project[] };

export function Sidebar({
  onOpenAgent,
  width,
  onChoose,
}: {
  onOpenAgent: (agentId: string) => void;
  width?: number;
  /** Prévenu dès qu'un projet est choisi : le panneau latéral se referme. */
  onChoose?: () => void;
}) {
  const state = useApp();
  const [adding, setAdding] = React.useState(false);
  const [settingsFor, setSettingsFor] = React.useState<string | null>(null);
  const [showArchived, setShowArchived] = React.useState(false);
  const [archived, setArchived] = React.useState<Project[]>([]);

  // Ce qui est replié est enregistré côté serveur, comme le reste.
  const [collapsed, setCollapsed] = usePref<string[]>('sidebar.collapsed', []);
  const [creatingGroup, setCreatingGroup] = React.useState(false);
  const [renaming, setRenaming] = React.useState<ProjectGroup | null>(null);
  const [deleting, setDeleting] = React.useState<ProjectGroup | null>(null);

  // Le glissement suit le pointeur : l'aperçu se place exactement là où on vise,
  // à la souris comme au doigt.
  const entriesRef = React.useRef<Entry[]>([]);

  const resolve = React.useCallback((element: Element, y: number) => {
    const ligne = element.closest('[data-drag-id]') as HTMLElement | null;
    if (ligne) {
      const rect = ligne.getBoundingClientRect();
      return {
        id: ligne.dataset.dragId!,
        kind: ligne.dataset.dragKind!,
        position: (y < rect.top + rect.height / 2 ? 'before' : 'after') as 'before' | 'after',
      };
    }
    // Survol du corps d'un groupe : on y range l'élément.
    const zone = element.closest('[data-drop-group]') as HTMLElement | null;
    if (zone) return { id: zone.dataset.dropGroup!, kind: 'group', position: 'inside' as const };
    // Ailleurs dans la colonne : on sort du groupe.
    const colonne = element.closest('[data-drop-root]');
    if (colonne) return { id: '__racine__', kind: 'root', position: 'inside' as const };
    return null;
  }, []);

  const actifs = state.projects.filter((p) => !p.archived);
  const groups = state.groups;

  /** Projets hors groupe et groupes rangés ENSEMBLE, par rang. */
  const entries: Entry[] = React.useMemo(() => {
    const list: Entry[] = [];
    for (const project of actifs) {
      if (project.groupId && groups.some((g) => g.id === project.groupId)) continue;
      list.push({ kind: 'project', id: project.id, rank: project.rank ?? 1000, project });
    }
    for (const group of groups) {
      list.push({
        kind: 'group',
        id: group.id,
        rank: group.rank ?? 1000,
        group,
        members: actifs.filter((p) => p.groupId === group.id).sort((a, b) => (a.rank ?? 1000) - (b.rank ?? 1000)),
      });
    }
    return list.sort((a, b) => a.rank - b.rank);
  }, [actifs, groups]);

  React.useEffect(() => {
    if (!showArchived) return;
    client
      .call<{ projects: Project[] }>({ type: 'project.list', includeArchived: true })
      .then((data) => setArchived((data.projects ?? []).filter((p) => p.archived)))
      .catch(() => setArchived([]));
  }, [showArchived, state.projects]);

  const appliquer = React.useCallback(
    async (item: { id: string; kind: string }, cible: { id: string; kind: string; position: string } | null) => {
      if (!cible) return;
      const liste = entriesRef.current;
      const plat: { kind: 'project' | 'group'; id: string; groupId?: string }[] = [];
      for (const entry of liste) {
        if (entry.kind === 'project') plat.push({ kind: 'project', id: entry.id });
        else {
          plat.push({ kind: 'group', id: entry.id });
          for (const membre of entry.members) plat.push({ kind: 'project', id: membre.id, groupId: entry.id });
        }
      }

      const depuis = plat.findIndex((e) => e.id === item.id);
      if (depuis < 0) return;
      const [element] = plat.splice(depuis, 1);

      if (cible.kind === 'root') {
        if (element.kind === 'project') element.groupId = undefined;
        plat.push(element);
      } else if (cible.position === 'inside') {
        // Déposé dans un groupe : il en prend la tête.
        if (element.kind === 'project') element.groupId = cible.id;
        const index = plat.findIndex((e) => e.kind === 'group' && e.id === cible.id);
        plat.splice(index < 0 ? plat.length : index + 1, 0, element);
      } else {
        const index = plat.findIndex((e) => e.id === cible.id);
        if (index < 0) return;
        if (element.kind === 'project') element.groupId = plat[index].groupId;
        plat.splice(cible.position === 'before' ? index : index + 1, 0, element);
      }

      try {
        await client.call({ type: 'sidebar.reorder', items: plat });
      } catch {
        client.pushToast('error', 'Rangement non enregistré');
      }
    },
    [],
  );

  const { dragging, target, start } = usePointerDrag({ resolve, onDrop: appliquer });

  const commit = async (ordre: { kind: 'project' | 'group'; id: string; groupId?: string }[]) => {
    try {
      await client.call({ type: 'sidebar.reorder', items: ordre });
    } catch {
      client.pushToast('error', 'Rangement non enregistré');
    }
  };





  const toggle = (id: string) =>
    setCollapsed(collapsed.includes(id) ? collapsed.filter((g) => g !== id) : [...collapsed, id]);

  const runningOf = (projectId: string) =>
    Object.values(state.agents).filter((a) => a.projectId === projectId && a.status === 'running').length;

  React.useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  /*
   * La ligne se contente de DIRE ce qu'elle est (pour le dépôt) ; c'est la
   * poignée à gauche qui déclenche le glissement. Sinon un simple appui sur le
   * nom du projet embarquait la ligne au moindre mouvement du doigt.
   */
  const rowProps = (id: string, kind: 'project' | 'group') => ({
    'data-drag-id': id,
    'data-drag-kind': kind,
  });

  const poigneeProps = (id: string, kind: 'project' | 'group', label: string) => ({
    onPointerDown: (event: React.PointerEvent) => start(event, { id, kind, label }),
  });

  const agentsEnCours = Object.values(state.agents).filter(
    (agent) => agent.projectId === state.activeProjectId && agent.status === 'running',
  );

  return (
    <aside
      // Sur téléphone la liste occupe tout l'écran ; la largeur réglée à la
      // main ne vaut qu'à partir des écrans larges.
      className="flex w-full shrink-0 flex-col border-r border-border bg-bg sm:w-[var(--largeur-projets)]"
      style={{ ['--largeur-projets' as any]: `${width ?? 196}px` }}
    >
      <div className="flex items-center gap-1 px-2 py-2">
        <span className="text-[12px] uppercase tracking-wide text-faint">Projets</span>
        <Tooltip label="Nouveau groupe">
          <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={() => setCreatingGroup(true)}>
            <FolderPlus className="h-3 w-3" />
          </Button>
        </Tooltip>
        <Tooltip label="Ajouter ou créer un projet">
          <Button variant="ghost" size="icon-sm" onClick={() => setAdding(true)}>
            <Plus className="h-3 w-3" />
          </Button>
        </Tooltip>
      </div>

      <div className="flex-1 touch-pan-y overflow-y-auto px-1.5 pb-2" data-drop-root>
        {entries.map((entry) =>
          entry.kind === 'project' ? (
            <React.Fragment key={entry.id}>
              <Ghost show={target?.id === entry.id && target.position === 'before'} label={dragging?.label} />
              <ProjectRow
                project={entry.project}
                active={entry.id === state.activeProjectId}
                running={runningOf(entry.id)}
                attention={state.attention[entry.id]}
                rendus={state.rendus[entry.id]}
                dimmed={dragging?.id === entry.id}
                rowProps={rowProps(entry.id, 'project')}
                poigneeProps={poigneeProps(entry.id, 'project', entry.project.name)}
                onSettings={() => setSettingsFor(entry.id)}
                onChoose={onChoose}
              />
              <Ghost show={target?.id === entry.id && target.position === 'after'} label={dragging?.label} />
            </React.Fragment>
          ) : (
            <div
              key={entry.id}
              data-drop-group={entry.id}
              style={entry.group.color ? { borderLeftColor: entry.group.color, borderLeftWidth: 3 } : undefined}
              className={cn(
                'mb-0.5 rounded-md border transition-colors',
                // Survoler le corps du groupe l'éclaire en entier : on comprend
                // que le projet va s'y ranger.
                target?.kind === 'group' && target.id === entry.id && target.position === 'inside'
                  ? 'border-muted bg-surface'
                  : 'border-transparent',
              )}
            >
              <Ghost show={target?.id === entry.id && target.position === 'before'} label={dragging?.label} />
              <div
                {...rowProps(entry.id, 'group')}
                className={cn(
                  'group/g flex items-center gap-1 rounded-md px-1.5 py-1.5',
                  dragging?.id === entry.id && 'opacity-40',
                )}
              >
                <span
                  {...poigneeProps(entry.id, 'group', entry.group.name)}
                  title="Glisser pour ranger"
                  className="-m-1 p-1 touch-none"
                >
                  <GripVertical className="h-3 w-3 shrink-0 cursor-grab text-faint opacity-40 group-hover/g:opacity-100 active:cursor-grabbing" />
                </span>
                <button
                  onClick={() => toggle(entry.id)}
                  className="flex min-w-0 flex-1 items-center gap-1 text-left text-[12.5px] font-medium uppercase tracking-wide text-muted hover:text-text"
                >
                  <ChevronRight
                    className={cn(
                      'h-2.5 w-2.5 shrink-0 transition-transform',
                      !collapsed.includes(entry.id) && 'rotate-90',
                    )}
                  />
                  {entry.group.color ? (
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: entry.group.color }}
                      aria-hidden
                    />
                  ) : null}
                  <span className="min-w-0 truncate">{entry.group.name}</span>
                  <span className="shrink-0 text-faint">{entry.members.length}</span>
                </button>
                {/* Replié, un groupe cacherait ce que ses projets ont rendu :
                    la pastille remonte donc jusqu'ici, avec son geste. */}
                {collapsed.includes(entry.id) ? (
                  <PastilleRendue
                    compte={rendusDuGroupe(entry.members.map((p) => p.id), state.rendus)}
                    onLu={() =>
                      entry.members
                        .filter((p) => state.rendus[p.id])
                        .forEach((p) => client.call({ type: 'project.read', projectId: p.id }))
                    }
                  />
                ) : null}
                <ColorPicker
                  value={entry.group.color}
                  onPick={(couleur) => client.call({ type: 'group.update', id: entry.id, color: couleur })}
                />
                <button
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => setRenaming(entry.group)}
                  className="shrink-0 text-faint opacity-40 hover:text-text group-hover/g:opacity-100"
                  title="Renommer le groupe"
                >
                  <Pencil className="h-2.5 w-2.5" />
                </button>
                <button
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => setDeleting(entry.group)}
                  className="shrink-0 text-faint opacity-40 hover:text-danger group-hover/g:opacity-100"
                  title="Supprimer le groupe"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>

              {!collapsed.includes(entry.id) ? (
                <div className="pl-3 pr-0.5">
                  {entry.members.length ? (
                    entry.members.map((project) => (
                      <React.Fragment key={project.id}>
                        <Ghost show={target?.id === project.id && target.position === 'before'} label={dragging?.label} />
                        <ProjectRow
                          project={project}
                          active={project.id === state.activeProjectId}
                          running={runningOf(project.id)}
                          attention={state.attention[project.id]}
                          rendus={state.rendus[project.id]}
                          dimmed={dragging?.id === project.id}
                          rowProps={rowProps(project.id, 'project')}
                          poigneeProps={poigneeProps(project.id, 'project', project.name)}
                          onSettings={() => setSettingsFor(project.id)}
                          onChoose={onChoose}
                        />
                        <Ghost show={target?.id === project.id && target.position === 'after'} label={dragging?.label} />
                      </React.Fragment>
                    ))
                  ) : (
                    <p className="px-2 pb-1.5 text-[12px] text-faint">Glissez un projet ici.</p>
                  )}
                </div>
              ) : null}
              <Ghost show={target?.id === entry.id && target.position === 'after'} label={dragging?.label} />
            </div>
          ),
        )}

        {!entries.length ? <p className="px-2 py-3 text-[13px] text-faint">Aucun projet inscrit.</p> : null}

        <button
          onClick={() => setShowArchived((value) => !value)}
          className="mt-2 flex w-full items-center gap-1 rounded px-2 py-1.5 text-left text-[12.5px] text-faint hover:text-muted"
        >
          <Archive className="h-2.5 w-2.5" />
          Mis de côté
          <ChevronRight className={cn('ml-auto h-2.5 w-2.5 transition-transform', showArchived && 'rotate-90')} />
        </button>

        {showArchived ? (
          archived.length ? (
            archived.map((project) => (
              <div
                key={project.id}
                className="group mb-0.5 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13.5px] text-faint hover:bg-surface"
              >
                <Folder className="h-3 w-3 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{project.name}</span>
                <button
                  onClick={() => client.call({ type: 'project.archive', id: project.id, archived: false })}
                  className="shrink-0 opacity-0 transition-opacity hover:text-text group-hover:opacity-100"
                  title="Remettre en service"
                >
                  <ArchiveRestore className="h-3 w-3" />
                </button>
              </div>
            ))
          ) : (
            <p className="px-2 pb-2 text-[12.5px] text-faint">Aucun projet mis de côté.</p>
          )
        ) : null}
      </div>

      {agentsEnCours.length ? (
        <div className="border-t border-border px-1.5 py-2">
          <p className="px-1 pb-1 text-[12px] uppercase tracking-wide text-faint">Agents en cours</p>
          {agentsEnCours.map((agent) => (
            <button
              key={agent.id}
              onClick={() => onOpenAgent(agent.id)}
              className="mb-0.5 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[13px] text-muted hover:bg-surface hover:text-text"
            >
              <Bot className="h-3 w-3 shrink-0 text-success" />
              <span className="min-w-0 flex-1 truncate">{agent.title}</span>
              <span className="text-[11.5px] text-faint">{elapsed(agent.startedAt)}</span>
            </button>
          ))}
        </div>
      ) : null}

      <BoutonRedemarrage />

      <ProjectsDialog open={adding} onClose={() => setAdding(false)} />
      {/* Le filet est posé AUTOUR du panneau : de l'intérieur, un panneau ne
          peut pas rattraper sa propre erreur d'affichage. */}
      <Filet zone="Réglages du projet" onReprendre={() => setSettingsFor(null)}>
        <ProjectSettings
          project={state.projects.find((p) => p.id === settingsFor) ?? null}
          open={!!settingsFor}
          onClose={() => setSettingsFor(null)}
        />
      </Filet>

      <PromptDialog
        open={creatingGroup}
        title="Nouveau groupe"
        description="Un rangement pour vous y retrouver : « Clients », « Mes projets », « Capitaux »…"
        placeholder="Nom du groupe"
        confirmLabel="Créer"
        onConfirm={(nom) => client.call({ type: 'group.create', name: nom })}
        onClose={() => setCreatingGroup(false)}
      />

      <PromptDialog
        open={!!renaming}
        title="Renommer le groupe"
        defaultValue={renaming?.name ?? ''}
        placeholder="Nom du groupe"
        confirmLabel="Renommer"
        onConfirm={(nom) => renaming && client.call({ type: 'group.update', id: renaming.id, name: nom })}
        onClose={() => setRenaming(null)}
      />

      <ConfirmDialog
        open={!!deleting}
        title={`Supprimer le groupe « ${deleting?.name ?? ''} » ?`}
        description="Les projets qu'il contient ne sont pas supprimés : ils remontent simplement hors groupe."
        confirmLabel="Supprimer le groupe"
        danger
        onConfirm={() => deleting && client.call({ type: 'group.delete', id: deleting.id })}
        onClose={() => setDeleting(null)}
      />
    </aside>
  );
}

/**
 * Le redémarrage du serveur, en bas de la colonne des projets.
 *
 * Publier remplace l'interface tout de suite, mais le serveur continue de
 * tourner avec le code chargé à son démarrage : une correction côté serveur
 * n'existe pas tant qu'on ne l'a pas relancé. Le triangle orange dit exactement
 * ce moment-là — sinon rien ne le signale, et la correction semble n'avoir eu
 * aucun effet.
 */
function BoutonRedemarrage() {
  const state = useApp();
  const [confirmer, setConfirmer] = React.useState(false);
  const [enCours, setEnCours] = React.useState(false);

  // Le serveur diffuse son état toutes les trente secondes, mais on le demande
  // à l'ouverture : sinon le bouton reste muet jusqu'au premier battement.
  React.useEffect(() => {
    if (!state.connected) return;
    void client.call({ type: 'daemon.status' }).catch(() => undefined);
  }, [state.connected]);

  const demon = state.demon;
  const attendu = !!demon?.redemarrageNecessaire;

  return (
    <>
      <div className="border-t border-border px-1.5 py-1.5">
        <button
          onClick={() => setConfirmer(true)}
          disabled={enCours}
          className={cn(
            'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors',
            attendu ? 'text-warning hover:bg-warning/10' : 'text-faint hover:bg-surface hover:text-muted',
          )}
          title={
            attendu
              ? 'Du code serveur plus récent attend : redémarrez pour qu’il prenne effet.'
              : 'Redémarrer le serveur'
          }
        >
          {enCours ? (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
          ) : attendu ? (
            <TriangleAlert className="h-3 w-3 shrink-0" />
          ) : (
            <Power className="h-3 w-3 shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate">
            {enCours ? 'Redémarrage…' : attendu ? 'Redémarrage attendu' : 'Redémarrer le serveur'}
          </span>
        </button>
      </div>

      <ConfirmDialog
        open={confirmer}
        title="Redémarrer le serveur ?"
        description={avertissementRedemarrage(demon ?? { demarreA: 0 })}
        confirmLabel="Redémarrer"
        danger={!!demon?.agentsEnCours}
        onConfirm={() => {
          setEnCours(true);
          // La réponse part avant la coupure ; la reconnexion se fait toute
          // seule, on rend donc la main au bout de quelques secondes.
          void client.call({ type: 'daemon.restart' }).catch(() => undefined);
          window.setTimeout(() => setEnCours(false), 12000);
        }}
        onClose={() => setConfirmer(false)}
      />
    </>
  );
}

/** La palette des groupes : seize teintes franches, plus « aucune ». */
const COULEURS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#10b981', '#14b8a6',
  '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6',
  '#a855f7', '#d946ef', '#ec4899', '#f43f5e',
];

function ColorPicker({ value, onPick }: { value?: string; onPick: (color: string) => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          // Le glissement démarre sur la ligne : on l'empêche ici, sinon le clic
          // sur la palette est avalé par le déplacement du groupe.
          onPointerDown={(event) => event.stopPropagation()}
          className="shrink-0 text-faint opacity-40 hover:text-text group-hover/g:opacity-100"
          title="Couleur du groupe"
        >
          {value ? (
            <span className="block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: value }} />
          ) : (
            <Palette className="h-2.5 w-2.5" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto p-2">
        <div className="grid grid-cols-8 gap-1.5">
          {COULEURS.map((couleur) => (
            <button
              key={couleur}
              onClick={() => {
                onPick(couleur);
                setOpen(false);
              }}
              className={cn(
                'h-5 w-5 rounded-full ring-offset-2 ring-offset-surface transition-transform hover:scale-110',
                value === couleur ? 'ring-2 ring-text' : '',
              )}
              style={{ backgroundColor: couleur }}
              title={couleur}
            />
          ))}
        </div>
        <button
          onClick={() => {
            onPick('');
            setOpen(false);
          }}
          className="mt-2 w-full rounded border border-border px-2 py-1 text-[12px] text-muted hover:bg-raised hover:text-text"
        >
          Aucune couleur
        </button>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * « Un agent a fini, et vous ne l'avez pas encore lu. »
 *
 * La roue verte qui tourne dit déjà qu'un agent travaille ; cette pastille dit
 * l'état d'après. Elle est PLEINE et immobile, là où la roue tourne : les deux
 * ne peuvent pas se confondre d'un coup d'œil.
 */
function PastilleRendue({ compte, onLu }: { compte?: number; onLu: () => void }) {
  if (!compte) return null;
  const pluriel = compte > 1 ? 's' : '';
  return (
    <Tooltip label={`${compte} réponse${pluriel} rendue${pluriel}, pas encore lue${pluriel} — cliquez pour marquer comme lu`}>
      <button
        // Le glissement part de la poignée : on coupe quand même ici, sinon un
        // appui sur la pastille embarquerait la ligne.
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onLu();
        }}
        aria-label={`Marquer ${compte} réponse${pluriel} comme lue${pluriel}`}
        className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-success px-1 text-[10.5px] font-medium leading-none text-bg transition-transform hover:scale-110"
      >
        {compte}
      </button>
    </Tooltip>
  );
}

/** L'aperçu de l'élément déplacé, à l'endroit exact où il se posera. */
function Ghost({ show, label }: { show?: boolean; label?: string }) {
  if (!show) return null;
  return (
    <div className="mb-0.5 flex items-center gap-1.5 rounded-md border border-dashed border-muted bg-surface/60 px-2 py-1.5 text-[13.5px] text-muted">
      <Folder className="h-3 w-3 shrink-0 opacity-60" />
      <span className="min-w-0 truncate">{label ?? 'ici'}</span>
    </div>
  );
}

function ProjectRow({
  project,
  active,
  running,
  attention,
  rendus,
  dimmed,
  rowProps,
  poigneeProps,
  onSettings,
  onChoose,
}: {
  project: Project;
  active: boolean;
  running: number;
  attention?: number;
  /** Réponses rendues et pas encore lues sur ce projet. */
  rendus?: number;
  dimmed?: boolean;
  rowProps: Record<string, unknown>;
  /** Le glissement part d'ICI, jamais de la ligne entière. */
  poigneeProps: Record<string, unknown>;
  onSettings: () => void;
  onChoose?: () => void;
}) {
  return (
    <div
      {...rowProps}
      className={cn(
        'group mb-0.5 flex w-full items-center gap-1 rounded-md px-1.5 py-1.5 text-[13.5px] transition-colors',
        active ? 'bg-raised text-text' : 'text-muted hover:bg-surface hover:text-text',
        dimmed && 'opacity-40',
      )}
    >
      <span {...poigneeProps} title="Glisser pour ranger" className="-m-1 shrink-0 touch-none p-1">
        <GripVertical className="h-3 w-3 cursor-grab text-faint opacity-40 transition-opacity group-hover:opacity-100 active:cursor-grabbing" />
      </span>
      <button
        onClick={() => {
          client.setActiveProject(project.id);
          // Choisir, c'est aussi refermer : même quand c'est déjà le projet
          // affiché, le panneau ne doit pas rester ouvert sur un choix fait.
          onChoose?.();
        }}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
      >
        {running ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-success" />
        ) : (
          <Folder className="h-3 w-3 shrink-0 text-faint" />
        )}
        <span className="min-w-0 flex-1 truncate">{project.name}</span>
        {attention ? (
          <Tooltip label={`${attention} réponse${attention > 1 ? 's' : ''} attendue${attention > 1 ? 's' : ''}`}>
            <TriangleAlert className="h-3 w-3 shrink-0 text-warning" />
          </Tooltip>
        ) : null}
        {project.billing?.clientId ? (
          <Tooltip label={`Facturé à ${project.billing.clientName ?? 'un client'} · ${project.billing.hourlyRate} CHF/h`}>
            <CircleDollarSign className="h-2.5 w-2.5 shrink-0 text-faint" />
          </Tooltip>
        ) : null}
        {running ? <span className="shrink-0 text-[11.5px] text-success">{running}</span> : null}
      </button>
      {/* La pastille vit HORS du bouton du nom : elle porte son propre geste,
          et un bouton n'en contient pas un autre. */}
      <PastilleRendue
        compte={rendus}
        onLu={() => client.call({ type: 'project.read', projectId: project.id })}
      />
      <button
        onPointerDown={(event) => event.stopPropagation()}
        onClick={onSettings}
        className="shrink-0 text-faint opacity-40 transition-opacity hover:text-text group-hover:opacity-100"
        title="Réglages du projet"
      >
        <Settings2 className="h-3 w-3" />
      </button>
    </div>
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

  React.useEffect(() => {
    if (!open) return;
    setLoading(true);
    client
      .call<{ found: Found[] }>({ type: 'project.scan' })
      .then((data) => setFound(data.found ?? []))
      .catch(() => setFound([]))
      .finally(() => setLoading(false));
  }, [open]);

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

  const visible = filter ? found.filter((entry) => entry.name.toLowerCase().includes(filter.toLowerCase())) : found;

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="sm:w-[min(600px,100%)]">
        <DialogTitle>Projets du serveur</DialogTitle>

        <Tabs defaultValue="existing" className="mt-3">
          <TabsList>
            <TabsTrigger value="existing">Déjà sur le serveur</TabsTrigger>
            <TabsTrigger value="new">Nouveau projet</TabsTrigger>
          </TabsList>

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
              <p className="mt-3 flex items-center gap-1.5 text-[13.5px] text-faint">
                <Loader2 className="h-3 w-3 animate-spin" /> Lecture des dossiers du serveur…
              </p>
            ) : visible.length ? (
              <>
                <p className="mt-2 text-[12.5px] text-faint">
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
                        <p className="truncate text-[14px] text-text">{entry.name}</p>
                        <p className="truncate text-[11.5px] text-faint">
                          {entry.path}
                          {entry.git ? ' · suivi par git' : ''}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === entry.path}
                        onClick={() => addExisting(entry)}
                      >
                        {busy === entry.path ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                        Suivre
                      </Button>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-3 text-[13.5px] text-faint">Tous les projets du serveur sont déjà dans votre liste.</p>
            )}
          </TabsContent>

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
            <label className="flex items-center gap-2 text-[14px] text-muted">
              <Switch checked={withGit} onCheckedChange={setWithGit} />
              Démarrer un dépôt git dans le dossier
            </label>

            <p className="text-[12.5px] leading-snug text-faint">
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
