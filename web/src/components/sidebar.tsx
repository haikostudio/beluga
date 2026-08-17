import * as React from 'react';
import {
  Archive,
  ArchiveRestore,
  Bot,
  Check,
  ChevronRight,
  CircleDollarSign,
  Compass,
  Folder,
  FolderPlus,
  Github,
  GripVertical,
  LayoutDashboard,
  Loader2,
  Microscope,
  Palette,
  Pencil,
  Plus,
  Power,
  Route,
  Search,
  Settings2,
  Square,
  TriangleAlert,
  UploadCloud,
  Wrench,
  X,
} from 'lucide-react';
import {
  COULEURS_DE_GROUPE,
  Project,
  ProjectGroup,
  type AvancementColonne,
  type SignalProjet,
  ZONE_PROJETS,
  type DepotDuCompte,
  filtrerDepots,
  lireLienGithub,
  avancementDeLaColonne,
  avertissementRedemarrage,
  raisonAgents,
  raisonPublications,
  doitSecouerLigne,
  premiereDecision,
  repereVisible,
  signalDuGroupe,
} from '@haikodev/shared';
import { libelleAttention } from '@/components/repere-attention';
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
  ZoneDefilement,
} from '@/components/ui';
import { Filet } from '@/components/filet';
import { ProjectSettings } from '@/components/project-settings';
import { SilhouetteProjets } from '@/components/silhouettes';
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
  onOpenDashboard,
  dashboardActive,
  onCloseDashboard,
}: {
  onOpenAgent: (agentId: string) => void;
  width?: number;
  /** Prévenu dès qu'un projet est choisi : le panneau latéral se referme. */
  onChoose?: () => void;
  /** Ouvre la page « Tableau de bord » dans le conteneur central. */
  onOpenDashboard?: () => void;
  /** La page « Tableau de bord » est-elle ouverte ? Le bouton s'allume alors. */
  dashboardActive?: boolean;
  /** Referme la page « Tableau de bord » pour laisser voir un tableau de projet. */
  onCloseDashboard?: () => void;
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

  // Le glissement suit le pointeur : l'emplacement visé se marque exactement là
  // où on vise, à la souris comme au doigt.
  const entriesRef = React.useRef<Entry[]>([]);

  /*
   * Hauteur de la ligne saisie, mesurée au moment où on l'attrape : c'est de
   * cette hauteur que l'espace s'ouvre, ni plus ni moins.
   */
  const [hauteurLigne, setHauteurLigne] = React.useState(32);

  /*
   * La place de chaque ligne, relevée UNE fois au moment où on l'attrape, et
   * comptée depuis le haut du contenu (le défilement est donc sans effet).
   * On vise d'après ce relevé, jamais d'après ce qu'il y a sous le curseur :
   * comme les voisins se décalent, la ligne visée se déroberait sous le
   * pointeur et l'affichage se mettrait à osciller.
   */
  const geoRef = React.useRef<{
    lignes: { id: string; kind: string; haut: number; bas: number }[];
    groupes: { id: string; haut: number; bas: number }[];
  } | null>(null);

  const releverGeometrie = (root: HTMLElement) => {
    const base = root.getBoundingClientRect().top - root.scrollTop;
    // Marge du bas comprise : les zones se touchent, il n'y a pas de trou où la
    // visée se perdrait entre deux lignes.
    const zone = (el: Element) => {
      const rect = el.getBoundingClientRect();
      return { haut: rect.top - base, bas: rect.bottom - base + 2 };
    };
    geoRef.current = {
      lignes: Array.from(root.querySelectorAll<HTMLElement>('[data-drag-id]')).map((el) => ({
        id: el.dataset.dragId!,
        kind: el.dataset.dragKind!,
        ...zone(el),
      })),
      groupes: Array.from(root.querySelectorAll<HTMLElement>('[data-drop-group]')).map((el) => ({
        id: el.dataset.dropGroup!,
        ...zone(el),
      })),
    };
  };

  const resolve = React.useCallback((element: Element, y: number) => {
    // Hors de la colonne, on ne dépose rien.
    const root = element.closest('[data-drop-root]') as HTMLElement | null;
    const geo = geoRef.current;
    if (!root || !geo) return null;
    const point = y - root.getBoundingClientRect().top + root.scrollTop;

    for (const ligne of geo.lignes) {
      if (point < ligne.haut || point > ligne.bas) continue;
      return {
        id: ligne.id,
        kind: ligne.kind,
        position: (point < (ligne.haut + ligne.bas) / 2 ? 'before' : 'after') as 'before' | 'after',
      };
    }
    // Le corps d'un groupe, en dehors de ses lignes : on y range l'élément.
    for (const groupe of geo.groupes) {
      if (point >= groupe.haut && point <= groupe.bas) {
        return { id: groupe.id, kind: 'group', position: 'inside' as const };
      }
    }
    // Ailleurs dans la colonne : on sort du groupe.
    return { id: '__racine__', kind: 'root', position: 'inside' as const };
  }, []);

  /*
   * L'espace de développement de l'application (le projet marqué `isSelf`)
   * n'est PAS un projet comme les autres : il ne se range pas, ne se glisse pas
   * et n'entre dans aucun groupe. Il sort donc de la liste — et de tout ce qui
   * en découle, groupes compris — pour vivre dans son propre bouton, posé
   * au-dessus du libellé « Projets », à côté du tableau de bord.
   */
  const actifs = state.projects.filter((p) => !p.archived && !p.isSelf);
  const espaceDev = state.projects.find((p) => !p.archived && p.isSelf) ?? null;
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

  /*
   * Où l'espace s'ouvre. Rien n'est AJOUTÉ ni retiré à la liste pendant le
   * glissement : ce qui vient après l'emplacement visé descend simplement d'une
   * hauteur de ligne. La liste garde sa longueur, donc plus rien ne saute.
   * La ligne saisie, elle, ne bouge pas : on voit d'où l'on part.
   */
  const decales = React.useMemo(() => {
    const racine = new Set<string>();
    const membres = new Set<string>();
    // « inside » range dans un groupe : le groupe s'éclaire, rien ne se décale.
    if (!dragging || !target || target.position === 'inside') return { racine, membres };

    const apres = target.position === 'after' ? 1 : 0;
    const pousser = (depuis: number) => {
      for (const entry of entriesRef.current.slice(depuis)) {
        if (entry.id !== dragging.id) racine.add(entry.id);
      }
    };

    const rang = entriesRef.current.findIndex((entry) => entry.id === target.id);
    if (rang >= 0) {
      pousser(rang + apres);
      return { racine, membres };
    }

    // Sinon la cible est un projet RANGÉ dans un groupe : ses voisins du groupe
    // descendent, et tout ce qui suit le groupe aussi.
    for (let i = 0; i < entriesRef.current.length; i += 1) {
      const entry = entriesRef.current[i];
      if (entry.kind !== 'group') continue;
      const place = entry.members.findIndex((membre) => membre.id === target.id);
      if (place < 0) continue;
      for (const membre of entry.members.slice(place + apres)) {
        if (membre.id !== dragging.id) membres.add(membre.id);
      }
      pousser(i + 1);
      break;
    }
    return { racine, membres };
  }, [dragging, target, entries]);

  /** Le décalage lui-même : court, régulier, et immédiat si l'on a demandé moins d'animations. */
  const glisse = (decale: boolean): React.CSSProperties =>
    decale ? { transform: `translateY(${hauteurLigne}px)` } : {};

  /** L'emplacement visé, marqué d'un trait fin au-dessus ou en dessous de la ligne. */
  const marqueurDe = (id: string): 'before' | 'after' | undefined =>
    target && target.id === id && target.position !== 'inside' ? target.position : undefined;

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

  /*
   * Le même pourcentage que celui affiché en tête de la colonne « En cours » du
   * tableau (`avancementDeLaColonne`, `board.tsx`), additionné pour CE projet.
   * On part directement des agents de rôle « task » encore au travail — `state
   * .agents` est connu pour TOUS les projets dès l'ouverture (`runningOf`
   * ci-dessus fait de même), alors que les cartes ne sont chargées que pour le
   * projet ouvert : partir d'elles laisserait les autres lignes sans chiffre.
   */
  const avancementOf = (projectId: string): AvancementColonne | null =>
    avancementDeLaColonne(
      Object.values(state.agents)
        .filter(
          (a) => a.projectId === projectId && a.role === 'task' && (a.status === 'running' || a.status === 'starting'),
        )
        .map((agent) => ({ agentActif: true, todos: agent.todos })),
    );

  // Une publication est EN COURS tant que son run le dit ; elle s'éteint dès
  // qu'il se termine, quel qu'en soit le sort (réussite, échec, arrêt).
  const publieOf = (projectId: string) => state.deploys[projectId]?.state === 'running';

  // Un plan proposé (mode plan) attend-il encore une décision sur ce projet ?
  const planEnAttenteOf = (projectId: string) => !!state.plans[projectId];

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
    onPointerDown: (event: React.PointerEvent) => {
      const ligne = (event.currentTarget as HTMLElement).closest('[data-drag-id]') as HTMLElement | null;
      // Marge comprise : c'est l'espace que la ligne occupe vraiment.
      if (ligne) setHauteurLigne(Math.round(ligne.getBoundingClientRect().height) + 2);
      const root = ligne?.closest('[data-drop-root]') as HTMLElement | null;
      // Rien n'est encore décalé : c'est le bon moment pour relever les places.
      if (root) releverGeometrie(root);
      start(event, { id, kind, label });
    },
  });

  return (
    <aside
      // Sur téléphone la liste occupe tout l'écran ; la largeur réglée à la
      // main ne vaut qu'à partir des écrans larges. Le trait de droite sépare
      // la liste du tableau : sur téléphone il n'y a rien à séparer, la liste
      // vit dans un panneau qui a déjà son propre bord — un second trait à
      // l'intérieur se lit comme une fausse limite.
      className="flex w-full shrink-0 flex-col bg-bg sm:w-[var(--largeur-projets)] sm:border-r sm:border-border"
      style={{ ['--largeur-projets' as any]: `${width ?? 196}px` }}
    >
      {/* Tout en haut, AU-DESSUS des projets : la porte du tableau de bord. Un
          clic ouvre la page dans le conteneur central ; le bouton s'allume tant
          qu'elle est ouverte. */}
      {onOpenDashboard ? (
        <div className="px-1.5 pt-2">
          <Button
            variant="ghost"
            size="sm"
            data-ouvrir-tableau-de-bord
            className={cn('w-full justify-start gap-2', dashboardActive && 'bg-raised text-text')}
            onClick={() => {
              onOpenDashboard();
              onChoose?.();
            }}
          >
            <LayoutDashboard className="h-3.5 w-3.5" /> Tableau de bord
          </Button>
        </div>
      ) : null}

      {/* Juste en dessous, toujours AU-DESSUS des projets : l'espace de
          développement de l'application elle-même. Ce n'est pas un projet
          client, il ne se range donc pas avec eux — mais il garde tous ses
          repères, sinon on cesserait de voir ce qui s'y passe. */}
      {espaceDev ? (
        <LigneEspaceDev
          project={espaceDev}
          active={espaceDev.id === state.activeProjectId && !dashboardActive}
          running={runningOf(espaceDev.id)}
          publie={publieOf(espaceDev.id)}
          attention={state.attention[espaceDev.id]}
          rendus={state.rendus[espaceDev.id]}
          planEnAttente={planEnAttenteOf(espaceDev.id)}
          avancement={avancementOf(espaceDev.id)}
          onSettings={() => setSettingsFor(espaceDev.id)}
          onChoose={onChoose}
          onQuitterTableauDeBord={onCloseDashboard}
        />
      ) : null}

      <div className="flex items-center gap-1 px-2 py-2">
        <span className="text-[12px] uppercase tracking-wide text-faint">Projets</span>
        <Tooltip label="Nouveau groupe">
          <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={() => setCreatingGroup(true)}>
            <FolderPlus className="h-3 w-3" />
          </Button>
        </Tooltip>
        <Tooltip label="Ajouter ou créer un projet">
          <Button variant="ghost" size="icon-sm" data-ouvrir-projets onClick={() => setAdding(true)}>
            <Plus className="h-3 w-3" />
          </Button>
        </Tooltip>
      </div>

      <ZoneDefilement className="touch-pan-y px-1.5 pb-2" data-drop-root>
        {entries.map((entry) => {
          if (entry.kind === 'project') {
            return (
              <ProjectRow
                key={entry.id}
                project={entry.project}
                active={entry.id === state.activeProjectId}
                running={runningOf(entry.id)}
                publie={publieOf(entry.id)}
                attention={state.attention[entry.id]}
                rendus={state.rendus[entry.id]}
                planEnAttente={planEnAttenteOf(entry.id)}
                avancement={avancementOf(entry.id)}
                dimmed={dragging?.id === entry.id}
                style={glisse(decales.racine.has(entry.id))}
                marqueur={marqueurDe(entry.id)}
                rowProps={rowProps(entry.id, 'project')}
                poigneeProps={poigneeProps(entry.id, 'project', entry.project.name)}
                onSettings={() => setSettingsFor(entry.id)}
                onChoose={onChoose}
              />
            );
          }

          // Replié, un groupe cacherait ce que ses projets attendent ET ce
          // qu'ils ont rendu : les deux signaux remontent jusqu'à son en-tête.
          const signal = signalDuGroupe(
            entry.members.map((p) => p.id),
            state.attention,
            state.rendus,
          );
          const replie = collapsed.includes(entry.id);
          return (
            <div
              key={entry.id}
              data-drop-group={entry.id}
              style={glisse(decales.racine.has(entry.id))}
              className={cn(
                // Coins nets, sans « rounded-md » : la ligne colorée du groupe
                // (posée juste en dessous) est une droite verticale.
                'relative mb-0.5 border transition-[transform,background-color,border-color] duration-150 motion-reduce:transition-none',
                // Survoler le corps du groupe l'éclaire en entier : on comprend
                // que le projet va s'y ranger.
                target?.kind === 'group' && target.id === entry.id && target.position === 'inside'
                  ? 'border-muted bg-surface'
                  : 'border-transparent',
              )}
            >
              {/* La ligne colorée du groupe. Posée en absolu à « left: -7px »
                  (les 6 px du retrait « px-1.5 » de la liste, plus le trait de
                  1 px du groupe), elle vient toucher le bord gauche sans laisser
                  d'espace, et sans déplacer la boîte du groupe (qui garde sa
                  géométrie pour le glisser-déposer) ni le texte des projets. */}
              {entry.group.color ? (
                <span
                  aria-hidden
                  className="pointer-events-none absolute -left-[7px] inset-y-0 w-[3px]"
                  style={{ backgroundColor: entry.group.color }}
                />
              ) : null}
              <Trait ou={marqueurDe(entry.id)} />
              <EnteteGroupe
                rowProps={rowProps(entry.id, 'group')}
                dimmed={dragging?.id === entry.id}
                signal={signal}
                regarde={entry.members.some((p) => p.id === state.activeProjectId)}
              >
                <span
                  {...poigneeProps(entry.id, 'group', entry.group.name)}
                  title="Glisser pour ranger"
                  className={cn(
                    '-m-1 shrink-0 touch-none overflow-hidden p-1',
                    'transition-[max-width,padding,margin] duration-150 motion-reduce:transition-none',
                    // Même règle que la poignée de projet : cachée et sans place au
                    // repos sur pointeur qui survole, révélée au survol de l'en-tête.
                    'survol:m-0 survol:max-w-0 survol:p-0',
                    'group-hover/g:survol:-m-1 group-hover/g:survol:max-w-5 group-hover/g:survol:p-1',
                  )}
                >
                  <GripVertical className="h-3 w-3 shrink-0 cursor-grab text-faint opacity-40 transition-opacity survol:opacity-0 group-hover/g:opacity-100 active:cursor-grabbing" />
                </span>
                {/* Le point de couleur du groupe, posé À GAUCHE du nom (juste
                    avant le libellé). Il ne se voit qu'au survol de la carte :
                    au repos il se replie à largeur nulle (même mécanique que la
                    poignée de glisser juste avant), et le nom reprend sa place
                    normale. Un sélecteur ouvre un menu : il ne peut pas vivre
                    DANS le bouton du nom (un bouton n'en contient pas un autre),
                    donc il se place juste avant. */}
                <span
                  className={cn(
                    '-m-1 shrink-0 touch-none overflow-hidden p-1',
                    'transition-[max-width,padding,margin] duration-150 motion-reduce:transition-none',
                    'survol:m-0 survol:max-w-0 survol:p-0',
                    'group-hover/g:survol:-m-1 group-hover/g:survol:max-w-5 group-hover/g:survol:p-1',
                  )}
                >
                  <ColorPicker
                    value={entry.group.color}
                    onPick={(couleur) => client.call({ type: 'group.update', id: entry.id, color: couleur })}
                  />
                </span>
                <button
                  onClick={() => toggle(entry.id)}
                  className="flex min-w-0 flex-1 items-center gap-1 text-left text-[12.5px] font-medium uppercase tracking-wide text-text hover:text-text"
                >
                  <span className="min-w-0 truncate">{entry.group.name}</span>
                  <span className="shrink-0 text-faint">{entry.members.length}</span>
                </button>
                {/* Replié, un membre qui publie ne se voit plus : le repère jaune
                    remonte jusqu'à l'en-tête du groupe. Déplié, chaque ligne
                    porte le sien. */}
                {replie && entry.members.some((p) => publieOf(p.id)) ? (
                  <RepereePublication publie />
                ) : null}
                {/* Même règle pour le plan : replié, le groupe porte le repère de
                    son premier membre qui en attend un. */}
                {replie && entry.members.some((p) => planEnAttenteOf(p.id)) ? <RepereDePlan /> : null}
                {replie ? (
                  <RepereLigne
                    signal={signal}
                    onLu={() =>
                      entry.members
                        .filter((p) => state.rendus[p.id])
                        .forEach((p) => client.call({ type: 'project.read', projectId: p.id }))
                    }
                    /* Replié, le groupe emmène à la décision du premier de ses
                       projets qui en attend une. */
                    onDecision={() => {
                      const projet = entry.members.find((p) => state.attention[p.id]);
                      if (projet) allerALaDecision(projet.id, onChoose);
                    }}
                  />
                ) : null}
                <button
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => setRenaming(entry.group)}
                  className="shrink-0 text-faint opacity-40 transition-opacity survol:opacity-0 hover:text-text group-hover/g:opacity-100"
                  title="Renommer le groupe"
                >
                  <Pencil className="h-2.5 w-2.5" />
                </button>
                <button
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => setDeleting(entry.group)}
                  className="shrink-0 text-faint opacity-40 transition-opacity survol:opacity-0 hover:text-danger group-hover/g:opacity-100"
                  title="Supprimer le groupe"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
                {/* La flèche de dépliage/repliage, à DROITE de la carte — après
                    la croix de suppression, jamais devant le nom. */}
                <button
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => toggle(entry.id)}
                  className="shrink-0 text-faint hover:text-text"
                  title={replie ? 'Déplier le groupe' : 'Replier le groupe'}
                >
                  <ChevronRight
                    className={cn('h-2.5 w-2.5 transition-transform', !replie && 'rotate-90')}
                  />
                </button>
              </EnteteGroupe>

              {!replie ? (
                <div className="pl-3 pr-0.5">
                  {entry.members.length ? (
                    entry.members.map((project) => (
                      <ProjectRow
                        key={project.id}
                        project={project}
                        active={project.id === state.activeProjectId}
                        running={runningOf(project.id)}
                        publie={publieOf(project.id)}
                        attention={state.attention[project.id]}
                        rendus={state.rendus[project.id]}
                        planEnAttente={planEnAttenteOf(project.id)}
                        avancement={avancementOf(project.id)}
                        dimmed={dragging?.id === project.id}
                        style={glisse(decales.membres.has(project.id))}
                        marqueur={marqueurDe(project.id)}
                        rowProps={rowProps(project.id, 'project')}
                        poigneeProps={poigneeProps(project.id, 'project', project.name)}
                        onSettings={() => setSettingsFor(project.id)}
                        onChoose={onChoose}
                        groupColor={entry.group.color}
                        emboite
                      />
                    ))
                  ) : (
                    <p className="px-2 pb-1.5 text-[12px] text-faint">Glissez un projet ici.</p>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}

        {/* TANT QUE LE PREMIER ÉTAT DU SERVEUR N'EST PAS ARRIVÉ, la liste est
            vide sans qu'aucun projet ne manque : on montre des SILHOUETTES de
            lignes de projet. « Aucun projet inscrit » ne s'écrit qu'une fois la
            liste réellement reçue — sinon la phrase ment pendant tout le
            chargement. */}
        {!state.pret ? <SilhouetteProjets /> : null}
        {state.pret && !entries.length ? (
          <p className="px-2 py-3 text-[13px] text-faint">Aucun projet inscrit.</p>
        ) : null}

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
      </ZoneDefilement>

      <PileAgentsColonne onOpenAgent={onOpenAgent} />

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
 * La pile des agents, en un bouton au pied de la colonne des projets, juste
 * au-dessus du redémarrage. Au survol (ou au clic, pour le doigt) elle ouvre
 * son panneau EN SUPERPOSITION — position absolue, jamais dans le flux —
 * pour ne jamais décaler ni élargir la colonne. Un seul endroit pour tout ce
 * qui travaille, tous projets confondus : plus de bloc « Agents en cours »
 * séparé, plus de pile flottante en bas à droite.
 */
function PileAgentsColonne({ onOpenAgent }: { onOpenAgent: (agentId: string) => void }) {
  const state = useApp();
  const [dismissed, setDismissed] = React.useState<Set<string>>(new Set());
  const [undo, setUndo] = React.useState<Set<string> | null>(null);
  const [open, setOpen] = React.useState(false);
  const [, force] = React.useReducer((value: number) => value + 1, 0);

  React.useEffect(() => {
    const timer = setInterval(force, 5000);
    return () => clearInterval(timer);
  }, []);

  const agents = Object.values(state.agents)
    .filter((agent) => {
      if (dismissed.has(agent.id)) return false;
      // « starting » compte aussi : c'est un tour PARTI, même avant que son
      // moteur n'écrive quoi que ce soit — sans quoi la pile restait muette
      // pendant toute la préparation (lecture du projet, mémoire…), y compris
      // pour un chef d'orchestre, une analyse ou une mise en production, que
      // ni le tableau ni la colonne de gauche ne montrent ailleurs.
      if (agent.status === 'running' || agent.status === 'starting') return true;
      // Un agent qui finit reste un instant avec sa mention « terminé ».
      return !!agent.endedAt && Date.now() - agent.endedAt < 60000 && agent.role !== 'analysis';
    })
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));

  if (!agents.length) return null;
  const running = agents.filter((agent) => agent.status === 'running' || agent.status === 'starting').length;

  const clearAll = () => {
    const ids = agents.map((agent) => agent.id);
    setUndo(new Set(dismissed));
    setDismissed((current) => new Set([...current, ...ids]));
    window.setTimeout(() => setUndo(null), 6000);
  };

  return (
    <div
      data-pile-agents-colonne
      className="relative border-t border-border px-1.5 py-1.5"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[13px] text-faint transition-colors hover:bg-surface hover:text-muted"
        title={running ? `${running} agent${running > 1 ? 's' : ''} au travail` : 'Agents'}
      >
        <Bot className={cn('h-3 w-3 shrink-0', running ? 'text-en-cours' : 'text-faint')} />
        <span className="min-w-0 flex-1 truncate">{agents.length > 1 ? `${agents.length} agents` : 'Un agent'}</span>
        {running ? <Dot tone="running" pulse /> : null}
      </button>

      {open ? (
        // Le bloc REPOSE sur le bouton, `pb-1` compris : un `mb-1` externe
        // aurait laissé un pixel de rien entre les deux, où passer la souris
        // sortait de la zone survolée et refermait tout avant d'atteindre les
        // vignettes. Le padding, LUI, reste DANS l'élément survolé.
        <div data-panneau-agents className="absolute inset-x-1.5 bottom-full z-40 pb-1">
          <div className="flex max-h-[70vh] flex-col gap-1 overflow-auto rounded-md border border-border bg-surface p-1.5 shadow-lg">
            {agents.slice(0, 6).map((agent, index) => {
              const project = state.projects.find((p) => p.id === agent.projectId);
              const runningAgent = agent.status === 'running' || agent.status === 'starting';
              return (
                <div
                  key={agent.id}
                  data-vignette-agent-colonne
                  // La cascade : chaque vignette monte à son tour, la plus
                  // récente en tête déjà en place.
                  style={{ animationDelay: `${index * 30}ms` }}
                  className="flex animate-slide-up items-center gap-1.5 rounded-md border border-border bg-bg px-2 py-1.5"
                >
                  {/* Un agent de rôle « task » (une carte) est le seul que le
                      tableau montre ailleurs — les trois autres (chef
                      d'orchestre, analyse, publication) n'ont aucun autre
                      repère : leur icône ici est leur SEUL signe visible. */}
                  {agent.role === 'deploy' ? (
                    <UploadCloud
                      className={cn(
                        'h-3 w-3 shrink-0',
                        runningAgent ? 'text-publie animate-pulse-soft motion-reduce:animate-none' : 'text-faint',
                      )}
                      aria-label="Mise en production"
                    />
                  ) : agent.role === 'orchestrator' ? (
                    <Compass
                      className={cn('h-3 w-3 shrink-0', runningAgent ? 'text-en-cours' : 'text-faint')}
                      aria-label="Chef d'orchestre"
                    />
                  ) : agent.role === 'analysis' ? (
                    <Microscope
                      className={cn('h-3 w-3 shrink-0', runningAgent ? 'text-en-cours' : 'text-faint')}
                      aria-label="Analyse"
                    />
                  ) : (
                    <Bot className={cn('h-3 w-3 shrink-0', runningAgent ? 'text-en-cours' : 'text-faint')} aria-label="Carte" />
                  )}
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenAgent(agent.id);
                    }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate text-[13px] text-text">{agent.title}</p>
                    <p className="truncate text-[11.5px] text-faint">
                      {project?.name} · {agent.run.engine} ·{' '}
                      {agent.status === 'starting'
                        ? 'démarre…'
                        : runningAgent
                          ? elapsed(agent.startedAt)
                          : agent.status === 'failed'
                            ? 'échec'
                            : 'terminé'}
                    </p>
                  </button>
                  {runningAgent ? <Dot tone="running" pulse /> : null}
                  {/* L'ARRÊT SE FAIT ICI AUSSI. La pile ne portait qu'une croix
                      qui MASQUE la vignette (« l'agent continue ») : pour
                      couper un agent d'un autre projet, il fallait aller
                      l'ouvrir. Le carré rouge, lui, arrête vraiment — y compris
                      un agent bloqué depuis longtemps, que le démon referme
                      alors d'autorité. */}
                  {runningAgent ? (
                    <button
                      data-arret-agent-colonne
                      onClick={(event) => {
                        event.stopPropagation();
                        client
                          .call({ type: 'agent.stop', agentId: agent.id, cardId: agent.cardId })
                          .catch((err: any) => client.pushToast('error', err?.message ?? 'arrêt refusé'));
                      }}
                      // `z-10` : la croix voisine étend sa zone tactile de
                      // 11 px vers la gauche et recouvrait ce bouton — le clic
                      // destiné à l'arrêt masquait la vignette à la place.
                      className="relative z-10 -m-[9px] flex shrink-0 items-center justify-center p-[9px] text-faint hover:text-danger"
                      title="Arrêter cet agent"
                    >
                      <Square className="h-2.5 w-2.5 fill-current" />
                    </button>
                  ) : null}
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      setDismissed((current) => {
                        const next = new Set(current);
                        next.add(agent.id);
                        return next;
                      });
                    }}
                    // Sa zone tactile ne déborde plus vers la GAUCHE : elle y
                    // recouvrait le carré d'arrêt posé à côté.
                    className="-my-[11px] -mr-[11px] flex shrink-0 items-center justify-center p-[11px] text-faint hover:text-text"
                    title="Retirer la vignette (l'agent continue)"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              );
            })}

            <div className="flex flex-col items-stretch gap-1 pt-0.5" data-commandes="pile-agents-colonne">
              {undo ? (
                <button
                  onClick={() => {
                    setDismissed(undo);
                    setUndo(null);
                  }}
                  className="self-end rounded border border-border bg-bg px-1.5 py-0.5 text-[11.5px] text-text"
                >
                  Annuler
                </button>
              ) : null}
              {/* Un seul bouton, sur toute la largeur : plus de « Replier »,
                  le repli se fait tout seul quand le pointeur s'en va. */}
              <button
                onClick={clearAll}
                className="w-full rounded border border-border bg-bg px-1.5 py-1 text-[11.5px] text-faint hover:text-text"
              >
                Tout effacer
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
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
    void client.refreshDaemonStatus();
  }, [state.connected]);

  const demon = state.demon;
  const attendu = !!demon?.redemarrageNecessaire;
  // Une publication en cours interdit le redémarrage : le couper laisserait un
  // lot à moitié parti. Le bouton s'éteint et dit d'attendre ; la demande, elle,
  // partira toute seule dès la dernière publication terminée.
  const publications = demon?.publications ?? [];
  const publie = publications.length > 0;
  const enAttente = !!demon?.redemarrageEnAttente;
  // Le lien avec le serveur se coupe pendant qu'il redémarre : le dernier état
  // connu (par exemple « Publication en cours ») devient alors faux, puisque le
  // serveur qui l'a émis n'est plus celui qui répondra. Tant que la connexion
  // n'est pas revenue, on ne se fie plus à cet état — seul le redémarrage
  // compte, et il s'efface tout seul dès la reconnexion (l'état frais est
  // redemandé juste au-dessus).
  const deconnecte = !state.connected;

  const libelle = enCours || deconnecte
    ? 'Redémarrage…'
    : publie
      ? 'Publication en cours'
      : enAttente
        ? 'Redémarrage requis'
        : attendu
          ? 'Redémarrage attendu'
          : 'Redémarrer le serveur';
  const titre = enCours || deconnecte
    ? 'Le serveur redémarre — l’application se reconnectera toute seule.'
    : publie
      ? raisonPublications(publications)
      : enAttente
        ? (demon?.agentsEnCours
            ? `${raisonAgents(demon.agentsEnCours, demon.agentsDetail)} Il partira tout seul dès qu’il aura fini.`
            : 'Un redémarrage a été demandé mais un travail en cours le retient : il partira tout seul dès qu’il aura fini.')
        : attendu
          ? 'Du code serveur plus récent attend : redémarrez pour qu’il prenne effet.'
          : 'Redémarrer le serveur';

  return (
    <>
      <div className="border-t border-border px-1.5 py-1.5">
        <button
          onClick={() => setConfirmer(true)}
          disabled={enCours || publie || deconnecte}
          className={cn(
            'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors',
            'disabled:cursor-not-allowed',
            publie || enAttente || deconnecte
              ? 'text-muted'
              : attendu
                ? 'text-warning hover:bg-warning/10'
                : 'text-faint hover:bg-surface hover:text-muted',
          )}
          title={titre}
        >
          {enCours || publie || enAttente || deconnecte ? (
            <Loader2 className={cn('h-3 w-3 shrink-0', (enCours || deconnecte) && 'animate-spin')} />
          ) : attendu ? (
            <TriangleAlert className="h-3 w-3 shrink-0" />
          ) : (
            <Power className="h-3 w-3 shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate">{libelle}</span>
        </button>
      </div>

      <ConfirmDialog
        open={confirmer}
        title="Redémarrer le serveur ?"
        description={avertissementRedemarrage(demon ?? { demarreA: 0 })}
        confirmLabel="Redémarrer"
        onConfirm={() => {
          setEnCours(true);
          // La réponse part avant la coupure ; la reconnexion se fait toute
          // seule, on rend donc la main au bout de quelques secondes. Un refus
          // (publication en cours) revient AVANT la coupure : on le dit et on
          // rend la main tout de suite.
          void client
            .call<{ ok: boolean; raison?: string }>({ type: 'daemon.restart' })
            .then((res) => {
              if (res && res.ok === false) {
                setEnCours(false);
                if (res.raison) client.pushToast('info', res.raison);
              }
            })
            .catch(() => undefined);
          window.setTimeout(() => setEnCours(false), 12000);
        }}
        onClose={() => setConfirmer(false)}
      />
    </>
  );
}

/**
 * La palette des groupes : seize teintes franches, plus « aucune ». Elle vit
 * dans `shared/src/gestion-projets.ts` — un agent qui règle un groupe par outil
 * choisit dans la MÊME palette que ce sélecteur, sinon la pastille posée par le
 * chef ne serait dans aucune case du nuancier.
 */
const COULEURS = COULEURS_DE_GROUPE;

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
 * « Quelque chose de nouveau vous attend ici. »
 *
 * Un petit signal se rate dans une longue liste : la ligne bouge donc une fois,
 * à l'ARRIVÉE de la nouvelle — une demande à trancher COMME un travail que
 * l'agent vient de rendre. Elle ne rejoue pas tant que le compte ne remonte pas
 * — signaler, pas harceler — et la ligne qu'on regarde déjà ne bouge jamais.
 * La règle de déclenchement vit dans `shared`, testée seule ; ici on ne tient
 * que la minuterie.
 */
function useSecousse(signal: SignalProjet, regarde: boolean): boolean {
  const [tour, setTour] = React.useState(0);
  const [secoue, setSecoue] = React.useState(false);
  const attention = signal.attention ?? 0;
  const rendus = signal.rendus ?? 0;
  const avant = React.useRef<SignalProjet>({ attention, rendus });

  React.useEffect(() => {
    const declenche = doitSecouerLigne({
      avant: avant.current,
      maintenant: { attention, rendus },
      regarde,
    });
    avant.current = { attention, rendus };
    // Un tour de plus, et rien d'autre : décider n'est pas animer.
    if (declenche) setTour((n) => n + 1);
  }, [attention, rendus, regarde]);

  /*
   * La minuterie ne dépend QUE du numéro de tour, jamais des comptes.
   * Autrement, un second signal qui bouge PENDANT la secousse relançait ce
   * calcul, son ménage effaçait la minuterie de fin — et la ligne tremblait
   * sans fin. Le ménage remet donc lui-même la ligne au repos, et deux signaux
   * coup sur coup rejouent bien l'animation, la classe étant retirée d'abord.
   */
  React.useEffect(() => {
    if (!tour) return;
    const depart = window.setTimeout(() => setSecoue(true), 20);
    const fin = window.setTimeout(() => setSecoue(false), 700);
    return () => {
      window.clearTimeout(depart);
      window.clearTimeout(fin);
      setSecoue(false);
    };
  }, [tour]);

  return secoue;
}

/**
 * La ligne d'un groupe. Elle existe surtout pour porter la secousse : un
 * crochet ne s'appelle pas au milieu d'une boucle d'affichage.
 */
function EnteteGroupe({
  rowProps,
  dimmed,
  signal,
  regarde,
  children,
}: {
  rowProps: Record<string, unknown>;
  dimmed?: boolean;
  /** Ce que ses projets attendent, et ce qu'ils ont rendu sans être lus. */
  signal: SignalProjet;
  /** Le projet ouvert est-il DANS ce groupe ? Alors rien ne bouge. */
  regarde: boolean;
  children: React.ReactNode;
}) {
  const secoue = useSecousse(signal, regarde);
  return (
    <div
      {...rowProps}
      data-groupe-attention={signal.attention || undefined}
      data-groupe-rendus={signal.rendus || undefined}
      className={cn(
        'group/g flex items-center gap-1 rounded-md px-1.5 py-1.5',
        dimmed && 'opacity-40',
        secoue && 'animate-secousse',
      )}
    >
      {children}
    </div>
  );
}

/**
 * « Un agent travaille ici. »
 *
 * Un loader qui tourne, et rien d'autre : il remplace à lui seul l'icône de
 * dossier tant qu'un agent écrit, pour que l'activité se lise d'un coup
 * d'œil — un robot immobile ne le disait pas. Le nombre ne s'écrit que s'il y
 * a VRAIMENT plusieurs agents : « 1 » ne dit rien de plus que le loader
 * lui-même.
 *
 * Une PUBLICATION en cours prend la même place, mais change de signe : une
 * icône réseau / envoi, violette et clignotante (jeton `publie`), au lieu du
 * loader orange — un déploiement doit se voir d'un coup d'œil, sans se
 * confondre avec un travail ordinaire. Elle remplace alors le loader, elle
 * ne s'y ajoute pas.
 *
 * Un PLAN qui attend une décision prend la même place, à défaut des deux
 * précédents : l'icône du plan (`RepereDePlan`).
 *
 * Un TRAVAIL TERMINÉ, pas encore visité, prend la même place en DERNIER
 * recours : le point bleu qui clignotait jusqu'ici à droite de la ligne
 * (`RepereLigne`). Il ne paraît donc que lorsque plus rien ne tourne — dès
 * qu'un agent repart ou qu'une publication démarre, il cède la place comme
 * les autres.
 *
 * Rien de tout ça n'est vrai : le repère ne s'affiche pas (`null`), pour
 * laisser sa place au repère de repos de l'appelant (favicon du projet,
 * outil de l'espace de développement…) — sur une ligne de projet, il vient
 * s'AJOUTER entre ce repère de repos et le nom, jamais le remplacer.
 */
function RepereRobot({
  running,
  publie,
  planEnAttente,
  termine,
}: {
  running: number;
  publie?: boolean;
  /** Un plan proposé attend encore une décision sur ce projet. */
  planEnAttente?: boolean;
  /** Du travail est rendu et pas encore visité, rien d'autre ne tourne. */
  termine?: boolean;
}) {
  if (publie) {
    return (
      <Tooltip label="Publication en cours">
        <span className="flex shrink-0 items-center gap-0.5" data-repere-robot aria-label="Publication en cours">
          <UploadCloud className="h-[15px] w-[15px] shrink-0 text-publie animate-pulse-soft motion-reduce:animate-none" />
        </span>
      </Tooltip>
    );
  }
  if (running) {
    const libelle = running > 1 ? `${running} agents au travail` : 'Un agent au travail';
    return (
      <Tooltip label={libelle}>
        <span className="flex shrink-0 items-center gap-0.5" data-repere-robot aria-label={libelle}>
          <Loader2 className="h-[15px] w-[15px] shrink-0 animate-spin text-en-cours motion-reduce:animate-none" />
          {running >= 1 ? <span className="text-[10.5px] leading-none text-en-cours">{running}</span> : null}
        </span>
      </Tooltip>
    );
  }
  if (planEnAttente) return <RepereDePlan />;
  if (termine) {
    return (
      <Tooltip label="Travail terminé, pas encore consulté — ouvrez le projet pour l'éteindre">
        <span
          data-repere-termine
          aria-label="Travail terminé, pas encore consulté"
          className="flex h-[15px] w-[15px] shrink-0 items-center justify-center"
        >
          <span className="h-2 w-2 rounded-full bg-termine animate-pulse-soft motion-reduce:animate-none" />
        </span>
      </Tooltip>
    );
  }
  return null;
}

/**
 * L'icône de repos d'une ligne de projet : le favicon que le SERVEUR a su
 * récupérer (`project.favicon`, `server/src/favicon.ts` — sur l'adresse
 * publique du projet, ou dans son DÉPÔT à défaut ; le navigateur, lui, est
 * trop souvent bloqué : mélange http/https, en-têtes qui refusent l'inclusion
 * croisée), sinon un rond avec ses initiales — jamais le dossier générique,
 * qui ne disait rien du projet.
 */
function PastilleSite({ project }: { project: Project }) {
  // Une image qui ne se charge pas (fichier retiré, session expirée) laisse
  // sinon un carré vide : on revient aux initiales, jamais une image cassée.
  const [cassee, setCassee] = React.useState(false);
  React.useEffect(() => setCassee(false), [project.favicon]);

  if (project.favicon && !cassee) {
    return (
      <img
        src={project.favicon}
        alt=""
        aria-hidden
        data-favicon-projet
        onError={() => setCassee(true)}
        className="h-[15px] w-[15px] shrink-0 rounded-sm object-contain"
      />
    );
  }

  const initiales =
    project.name
      .trim()
      .split(/\s+/)
      .map((mot) => mot[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?';

  return (
    <span
      aria-hidden
      data-initiales-projet
      className="flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full bg-raised text-[9px] font-medium leading-none text-faint"
    >
      {initiales}
    </span>
  );
}

/**
 * « Ce projet est en train d'être mis en ligne. »
 *
 * Un point jaune qui respire, du côté du robot : c'est l'ÉTAT du projet, pas une
 * décision à prendre. Il ne porte donc AUCUN geste (la publication se suit sur
 * la carte d'« À déployer »), et ne compte pas parmi les deux repères d'attente
 * de droite. Il ne vit que le temps de la publication et s'éteint dès qu'elle
 * se termine — réussite, échec ou arrêt.
 */
function RepereePublication({ publie }: { publie: boolean }) {
  if (!publie) return null;
  return (
    <Tooltip label="Publication en cours">
      <span
        aria-label="Publication en cours"
        data-repere-publication
        className="h-2 w-2 shrink-0 rounded-full bg-publie animate-pulse-soft motion-reduce:animate-none"
      />
    </Tooltip>
  );
}

/**
 * « Un plan attend une décision, ici. »
 *
 * Posée comme le point jaune de publication (`RepereePublication`) : la même
 * icône que le cadre « Plan proposé » de la conversation (`Route`), dans un
 * petit badge blanc — jamais à la place d'un autre repère, toujours à côté. Le
 * cadre de la ligne porte en plus une bordure blanche (voir son `className`) ;
 * les deux s'éteignent ensemble dès que le plan est validé, refusé ou dépassé
 * par une version plus récente (`planEnAttente`, `shared/src/plan-conversation.ts`).
 */
function RepereDePlan() {
  return (
    <Tooltip label="Un plan attend votre décision">
      <span
        aria-label="Un plan attend votre décision"
        data-repere-plan
        className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-text bg-bg text-text"
      >
        <Route className="h-2 w-2" />
      </span>
    </Tooltip>
  );
}

/**
 * « Où en est le travail en cours sur ce projet ? » — le même pourcentage que
 * celui de la tête de la colonne « En cours » du tableau (`avancementDeLaColonne`),
 * additionné sur les cartes de ce seul projet, posé dans l'espace laissé libre
 * par le point bleu déplacé à gauche (`RepereRobot`).
 *
 * Il cède la place au triangle de décision (`RepereLigne`) : les deux vivent
 * au même endroit, jamais ensemble — une décision qui attend prime toujours.
 *
 * Contrairement à `RepereLigne`, qui EMPRUNTE au repos la place de l'icône
 * réglages (encore invisible) puis s'en écarte au survol pour la lui rendre,
 * le pourcentage emprunte la MÊME place mais n'en bouge JAMAIS : le décalage
 * (`survol:translate-x-4`, un « quart » = la largeur de l'icône réglages plus
 * son espacement) reste posé qu'on survole ou non — un chiffre qui glisserait
 * à chaque passage de souris est justement ce que cet écran ne veut plus. Il
 * s'efface par l'OPACITÉ, jamais par la position, pour laisser voir l'icône
 * réglages quand elle apparaît par-dessus au survol.
 */
function RepereAvancementProjet({
  avancement,
  className,
}: {
  avancement: AvancementColonne | null;
  /** Le décalage fixe qui le colle au bord droit, posé par l'appelant. */
  className?: string;
}) {
  if (!avancement) return null;
  const { done, total, pourcent, termine } = avancement;
  return (
    <Tooltip label={`${done} étape${done > 1 ? 's' : ''} faite${done > 1 ? 's' : ''} sur ${total}`}>
      <span
        data-avancement-projet
        className={cn(
          'shrink-0 px-0.5 text-[11px] font-medium tabular-nums',
          termine ? 'text-termine' : 'text-en-cours',
          className,
        )}
      >
        {pourcent} %
      </span>
    </Tooltip>
  );
}

/**
 * Le SEUL repère d'attente de la ligne, à droite du nom.
 *
 * Ils étaient trois à se disputer trois centimètres : triangle orange, pastille
 * verte chiffrée, point bleu. Deux disaient la même chose (du travail rendu,
 * pas encore lu) et le troisième, la seule chose qui demande vraiment un geste.
 * `repereVisible` tranche — la décision d'abord, la lecture ensuite — et un
 * seul apparaît. Ce qui est caché n'est pas perdu : la décision réglée, le
 * point bleu reparaît tout seul.
 *
 * Le point bleu reste cliquable, comme la pastille qu'il remplace : c'est le
 * raccourci « j'ai vu, n'insiste plus » sans ouvrir la conversation.
 */
/**
 * Emmener à la première décision en attente d'un projet — celle qui patiente
 * depuis le plus longtemps. Une carte : son tiroir s'ouvre. Aucune carte : la
 * conversation où le bouton attend se déplie. Dans les deux cas le projet
 * devient celui qu'on regarde, sinon on arriverait sur le tableau d'un autre.
 */
function allerALaDecision(projectId: string, onChoose?: () => void): void {
  client.setActiveProject(projectId);
  onChoose?.();
  const lieu = premiereDecision(client.getSnapshot().decisions, projectId);
  if (!lieu) return;
  if (lieu.cardId) client.openCard(lieu.cardId);
  // Sans conversation, la décision se prend sur le projet lui-même : c'est le
  // cas de l'accord avant envoi, qui vit dans le bloc de publication. Le
  // tableau du projet est déjà à l'écran, il n'y a rien de plus à ouvrir.
  else if (lieu.agentId) client.openConversation({ projectId: lieu.projectId, agentId: lieu.agentId });
}

function RepereLigne({
  signal,
  onLu,
  onDecision,
  className,
}: {
  signal: SignalProjet;
  onLu: () => void;
  /** Emmener à l'endroit où la décision se prend. */
  onDecision?: () => void;
  /** Décalage doux appliqué au repère (glissement au survol). */
  className?: string;
}) {
  const quoi = repereVisible(signal);
  if (!quoi) return null;

  if (quoi === 'attention') {
    const compte = signal.attention ?? 0;
    const libelle = `${libelleAttention(compte)} — cliquez pour y aller`;
    /*
     * Le triangle EMMÈNE : c'est le chaînon qui manquait. Annoncer « 4
     * décisions attendues » sans dire où elles se prennent revenait à montrer
     * un chiffre introuvable. Un clic ouvre la première, la plus ancienne.
     */
    return (
      <Tooltip label={libelle}>
        <button
          // Le glissement part de la poignée ; on coupe ici, sinon un appui
          // sur le triangle embarquerait la ligne.
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onDecision?.();
          }}
          aria-label={libelle}
          data-signal-attention
          className={cn('shrink-0 text-warning', className)}
        >
          <TriangleAlert className="h-3 w-3" />
        </button>
      </Tooltip>
    );
  }

  const compte = signal.rendus ?? 0;
  const libelle =
    compte > 1
      ? `${compte} travaux terminés, pas encore lus — cliquez pour marquer comme lu`
      : 'Un travail terminé, pas encore lu — cliquez pour marquer comme lu';
  return (
    <Tooltip label={libelle}>
      <button
        // Le glissement part de la poignée ; on coupe quand même ici, sinon un
        // appui sur le point embarquerait la ligne.
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onLu();
        }}
        aria-label={libelle}
        data-signal-termine
        className={cn(
          // Un travail TERMINÉ, pas encore lu : bleu, par convention.
          'h-2 w-2 shrink-0 rounded-full bg-termine animate-pulse-soft motion-reduce:animate-none',
          className,
        )}
      />
    </Tooltip>
  );
}

/**
 * L'emplacement où l'élément se posera : un trait d'un pixel, orange, comme
 * toutes les bordures de l'application. Il est posé PAR-DESSUS la liste (jamais
 * inséré dedans) — c'est ce qui empêche les lignes du dessous de sauter.
 */
/**
 * Le demi-rond plaqué contre le bord gauche de l'écran, sur la ligne du
 * projet ACTUELLEMENT OUVERT seul — un seul repère visible à la fois, qui ne
 * dit qu'une chose : « c'est ici qu'on se trouve ». Couleur du groupe du
 * projet, ou blanche si le groupe n'en a pas (ou si le projet n'est dans
 * aucun groupe).
 *
 * Positionné en absolu à « -left-[7px] » (les 6 px de retrait « px-1.5 » de
 * la liste, plus le 1 px de bordure de la ligne) pour toucher le bord gauche
 * sans y laisser d'espace ; un projet rangé dans un groupe est en plus
 * décalé de « pl-3 » (12 px), d'où le « -left-[19px] » qui le ramène au même
 * bord que la ligne colorée du groupe.
 */
function RepereDemiRond({
  active,
  couleur,
  emboite,
}: {
  active?: boolean;
  /** La couleur du groupe du projet, si réglée. */
  couleur?: string;
  /** Le projet est rangé dans un groupe : la ligne est décalée de « pl-3 ». */
  emboite?: boolean;
}) {
  if (!active) return null;
  return (
    <span
      aria-hidden
      data-repere-demi-rond
      className={cn(
        'pointer-events-none absolute top-1/2 h-3 w-1.5 -translate-y-1/2 rounded-r-full bg-text',
        emboite ? '-left-[19px]' : '-left-[7px]',
      )}
      style={couleur ? { backgroundColor: couleur } : undefined}
    />
  );
}

function Trait({ ou }: { ou?: 'before' | 'after' }) {
  if (!ou) return null;
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-x-0 h-px bg-warning',
        ou === 'before' ? '-top-px' : '-bottom-px',
      )}
    />
  );
}

/**
 * L'espace de développement de l'application, en bouton à part.
 *
 * Le projet posé sur le dossier de HaikoDev (marque `isSelf`) n'est pas un
 * projet client : c'est l'atelier où l'outil lui-même évolue. Il quitte donc la
 * liste — plus de poignée de rangement, plus de groupe possible — pour prendre
 * place au-dessus du libellé « Projets », dans la tenue du bouton « Tableau de
 * bord ». Rien d'autre ne change : même identifiant, mêmes cartes, même
 * conversation, mêmes réglages, et les MÊMES repères qu'une ligne de projet
 * (robot, triangle de décision, point bleu de travail rendu, point jaune de
 * publication) — les perdre reviendrait à cesser de voir ce qui s'y passe.
 */
function LigneEspaceDev({
  project,
  active,
  running,
  publie,
  attention,
  rendus,
  planEnAttente,
  avancement,
  onSettings,
  onChoose,
  onQuitterTableauDeBord,
}: {
  project: Project;
  active: boolean;
  running: number;
  publie?: boolean;
  attention?: number;
  rendus?: number;
  /** Un plan proposé attend encore une décision sur ce projet. */
  planEnAttente?: boolean;
  /** L'avancement des cartes en cours, pour la même place que le triangle de décision. */
  avancement?: AvancementColonne | null;
  onSettings: () => void;
  onChoose?: () => void;
  /** Le tableau de bord occupe la place : un clic ici doit le refermer. */
  onQuitterTableauDeBord?: () => void;
}) {
  const secoue = useSecousse({ attention, rendus }, active);
  const ouvrir = () => {
    client.setActiveProject(project.id);
    // Ouvrir éteint le point bleu, sans toucher au repère de lecture des
    // cartes (voir le même geste sur `ProjectRow`).
    if (rendus) client.call({ type: 'project.visit', projectId: project.id });
    onQuitterTableauDeBord?.();
    onChoose?.();
  };
  return (
    <div className="px-1.5 pt-1">
      <div
        data-espace-dev={project.id}
        data-espace-dev-attention={attention || undefined}
        data-espace-dev-rendus={rendus || undefined}
        data-espace-dev-plan={planEnAttente || undefined}
        className={cn(
          'group relative flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-[13.5px]',
          'transition-[background-color,color] duration-150 motion-reduce:transition-none',
          // La ligne reste NUE : ni cadre ni fond coloré. L'état (travail en
          // cours, publication, décision attendue, plan) ne vit plus que sur
          // l'icône (`RepereRobot`) et le repère de droite (`RepereLigne`).
          active ? 'bg-raised text-text' : 'text-muted hover:bg-surface hover:text-text',
          secoue && 'animate-secousse',
        )}
      >
        {/* Même repère que sur une ligne de projet : « Développement » en est un
            comme les autres, l'unique différence est de vivre hors de la liste. */}
        <RepereDemiRond active={active} />
        <button
          data-ouvrir-espace-dev
          onClick={ouvrir}
          title={`${project.name} — l’espace où l’application elle-même est développée`}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {/* Le loader prend la place de l'outil tant qu'un agent écrit ; une
              publication en cours prend la MÊME place, avec son propre signe,
              un plan qui attend une décision de même, et un travail rendu pas
              encore visité de même en dernier recours (voir `RepereRobot`)
              — même emplacement, donc rien ne s'ajoute à la ligne. */}
          {running || publie || planEnAttente || rendus ? (
            <RepereRobot
              running={running}
              publie={publie}
              planEnAttente={planEnAttente}
              termine={!running && !publie && !planEnAttente && !!rendus}
            />
          ) : (
            <Wrench className="h-3.5 w-3.5 shrink-0" />
          )}
          {/* Un libellé COURT : la colonne fait moins de 200 px, et la ligne
              porte déjà l'outil, un repère et l'engrenage. « Développement de
              l'application » y finissait en points de suspension. */}
          <span className="min-w-0 flex-1 truncate">Développement</span>
        </button>
        {/* Hors du bouton : le repère de décision porte son propre geste, et un
            bouton n'en contient pas un autre. Le travail rendu ne s'y affiche
            plus — il vit désormais à gauche, dans `RepereRobot`. Une décision
            qui attend prime toujours sur le pourcentage, qui vit à la même
            place (`RepereAvancementProjet`). */}
        {repereVisible({ attention }) ? (
          <RepereLigne
            signal={{ attention }}
            onLu={() => client.call({ type: 'project.read', projectId: project.id })}
            onDecision={() => {
              onQuitterTableauDeBord?.();
              allerALaDecision(project.id, onChoose);
            }}
            className="transition-transform duration-150 motion-reduce:transition-none survol:translate-x-4 group-hover:survol:translate-x-0"
          />
        ) : (
          <RepereAvancementProjet
            avancement={avancement ?? null}
            // Collé au bord droit, à la place de l'icône réglages (encore
            // invisible) : contrairement au triangle ci-dessus, ce décalage ne
            // se retire JAMAIS au survol — seule l'opacité cède la place à
            // l'icône quand elle apparaît.
            className="survol:translate-x-4 transition-opacity duration-150 motion-reduce:transition-none group-hover:survol:opacity-0"
          />
        )}
        <button
          onClick={onSettings}
          data-reglages-projet={project.id}
          className="shrink-0 text-faint opacity-40 transition-opacity survol:opacity-0 hover:text-text group-hover:opacity-100"
          title="Réglages de l’espace de développement"
        >
          <Settings2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function ProjectRow({
  project,
  active,
  running,
  publie,
  attention,
  rendus,
  planEnAttente,
  avancement,
  dimmed,
  style,
  marqueur,
  rowProps,
  poigneeProps,
  onSettings,
  onChoose,
  groupColor,
  emboite,
}: {
  project: Project;
  active: boolean;
  running: number;
  /** Une publication de ce projet est-elle en cours ? */
  publie?: boolean;
  attention?: number;
  /** Réponses rendues et pas encore lues sur ce projet. */
  rendus?: number;
  /** Un plan proposé attend encore une décision sur ce projet. */
  planEnAttente?: boolean;
  /** L'avancement des cartes en cours, pour la même place que le triangle de décision. */
  avancement?: AvancementColonne | null;
  dimmed?: boolean;
  /** La couleur du groupe qui range ce projet, pour le demi-rond du projet ouvert. */
  groupColor?: string;
  /** Le projet est rangé dans un groupe (décalage « pl-3 » à rattraper). */
  emboite?: boolean;
  /** Le décalage vers le bas quand un élément vise une place au-dessus. */
  style?: React.CSSProperties;
  /** Le trait de l'emplacement visé, au-dessus ou en dessous de la ligne. */
  marqueur?: 'before' | 'after';
  rowProps: Record<string, unknown>;
  /** Le glissement part d'ICI, jamais de la ligne entière. */
  poigneeProps: Record<string, unknown>;
  onSettings: () => void;
  onChoose?: () => void;
}) {
  // Le projet qu'on regarde déjà ne bouge pas : le signal sert à ce qu'on ne
  // voit pas.
  const secoue = useSecousse({ attention, rendus }, active);
  return (
    <div
      {...rowProps}
      style={style}
      data-projet-attention={attention || undefined}
      data-projet-rendus={rendus || undefined}
      data-projet-plan={planEnAttente || undefined}
      className={cn(
        'group relative mb-0.5 flex w-full items-center gap-1 rounded-md border border-transparent px-1.5 py-1.5 text-[13.5px]',
        // Le décalage suit la même durée que les autres transitions ; le réglage
        // « réduire les animations » du système le rend immédiat.
        'transition-[transform,background-color,color] duration-150 motion-reduce:transition-none',
        // La ligne reste NUE : ni cadre ni fond coloré. L'état (travail en
        // cours, publication, décision attendue, plan) ne vit plus que sur
        // l'icône (`RepereRobot`) et le repère de droite (`RepereLigne`).
        active ? 'bg-raised text-text' : 'text-text hover:bg-surface',
        dimmed && 'opacity-40',
        secoue && 'animate-secousse',
      )}
    >
      <Trait ou={marqueur} />
      <RepereDemiRond active={active} couleur={groupColor} emboite={emboite} />
      <span
        {...poigneeProps}
        title="Glisser pour ranger"
        className={cn(
          '-m-1 shrink-0 touch-none overflow-hidden p-1',
          'transition-[max-width,padding,margin] duration-150 motion-reduce:transition-none',
          // Là où le pointeur survole : au repos, aucune place ni visibilité ; au
          // survol de la ligne, la poignée reprend sa place et le dossier se
          // décale. Sur téléphone (pas de survol), elle reste comme avant.
          'survol:m-0 survol:max-w-0 survol:p-0',
          'group-hover:survol:-m-1 group-hover:survol:max-w-5 group-hover:survol:p-1',
        )}
      >
        <GripVertical className="h-3 w-3 cursor-grab text-faint opacity-40 transition-opacity survol:opacity-0 group-hover:opacity-100 active:cursor-grabbing" />
      </span>
      <button
        onClick={() => {
          client.setActiveProject(project.id);
          // Ouvrir le projet éteint son point bleu — et seulement lui : les
          // cartes gardent leur repère de lecture propre (`project.read`
          // reste le geste à part, sur le point lui-même).
          if (rendus) client.call({ type: 'project.visit', projectId: project.id });
          // Choisir, c'est aussi refermer : même quand c'est déjà le projet
          // affiché, le panneau ne doit pas rester ouvert sur un choix fait.
          onChoose?.();
        }}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
      >
        {/* Le favicon du site du projet (ou ses initiales, à défaut d'adresse)
            reste TOUJOURS en premier, tout à gauche : on ne le perd plus
            quand il se passe quelque chose. L'icône d'état (loader d'agent,
            publication, plan en attente, travail rendu pas encore visité en
            dernier recours — voir `RepereRobot`) vient s'AJOUTER juste après,
            entre le favicon et le nom, et seulement quand elle a quelque
            chose à dire. */}
        <PastilleSite project={project} />
        {running || publie || planEnAttente || rendus ? (
          <RepereRobot
            running={running}
            publie={publie}
            planEnAttente={planEnAttente}
            termine={!running && !publie && !planEnAttente && !!rendus}
          />
        ) : null}
        <span className="min-w-0 flex-1 truncate">{project.name}</span>
        {project.billing?.clientId ? (
          <Tooltip label={`Facturé à ${project.billing.clientName ?? 'un client'} · ${project.billing.hourlyRate} CHF/h`}>
            {/* À la suite du nom (le nom prend toute la place, ce repère est
                poussé à droite). Caché au repos sur pointeur qui survole, révélé
                au survol de la ligne — comme la poignée. Sur téléphone (pas de
                survol) il reste discrètement visible. */}
            <CircleDollarSign className="ml-auto h-2.5 w-2.5 shrink-0 text-faint opacity-40 transition-opacity survol:opacity-0 group-hover:opacity-100" />
          </Tooltip>
        ) : null}
      </button>
      {/* Le repère de décision vit HORS du bouton du nom : il porte son propre
          geste, et un bouton n'en contient pas un autre. Le travail rendu ne
          s'y affiche plus — il vit désormais à gauche, dans `RepereRobot`. Sa
          place, libre le reste du temps, sert au pourcentage d'avancement
          (`RepereAvancementProjet`) — jamais les deux à la fois. */}
      {repereVisible({ attention }) ? (
        <RepereLigne
          signal={{ attention }}
          onLu={() => client.call({ type: 'project.read', projectId: project.id })}
          onDecision={() => allerALaDecision(project.id, onChoose)}
          // Au repos (pointeur qui survole), le repère est poussé à droite, à la
          // place de l'icône réglages encore invisible ; au survol de la ligne, il
          // glisse vers la gauche pour lui dégager la place, tout en douceur. Sur
          // téléphone (pas de survol) il ne bouge pas.
          className="transition-transform duration-150 motion-reduce:transition-none survol:translate-x-4 group-hover:survol:translate-x-0"
        />
      ) : (
        <RepereAvancementProjet
          avancement={avancement ?? null}
          // Collé au bord droit, à la place de l'icône réglages (encore
          // invisible) : contrairement au triangle ci-dessus, ce décalage ne
          // se retire JAMAIS au survol — seule l'opacité cède la place à
          // l'icône quand elle apparaît.
          className="survol:translate-x-4 transition-opacity duration-150 motion-reduce:transition-none group-hover:survol:opacity-0"
        />
      )}
      <button
        onPointerDown={(event) => event.stopPropagation()}
        onClick={onSettings}
        data-reglages-projet={project.id}
        className="shrink-0 text-faint opacity-40 transition-opacity survol:opacity-0 hover:text-text group-hover:opacity-100"
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

/** Une étape du montage d'un projet, telle qu'elle revient du serveur. */
interface Etape {
  titre: string;
  fait: boolean;
  detail?: string;
}

/**
 * Le déroulé du montage, le même pour un projet neuf et pour un dépôt GitHub :
 * une étape par ligne, ce qui a raté écrit avec sa cause.
 */
function DerouleDesEtapes({ etapes }: { etapes: Etape[] }) {
  return (
    <ul className="mt-1 space-y-1">
      {etapes.map((etape, index) => (
        <li key={index} className="flex items-start gap-1.5 text-[13px]">
          {etape.fait ? (
            <Check className="mt-[3px] h-3 w-3 shrink-0 text-success" />
          ) : (
            <TriangleAlert className="mt-[3px] h-3 w-3 shrink-0 text-warning" />
          )}
          <span className="min-w-0 flex-1">
            <span className={etape.fait ? 'text-muted' : 'text-warning'}>{etape.titre}</span>
            {etape.detail ? <span className="block break-words text-[11.5px] text-faint">{etape.detail}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ProjectsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [found, setFound] = React.useState<Found[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [filter, setFilter] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [onglet, setOnglet] = React.useState('existing');

  /* Le troisième chemin : un dépôt qui existe DÉJÀ sur GitHub. Deux entrées —
     les dépôts du compte connecté, ou un lien collé à la main. */
  const [depots, setDepots] = React.useState<DepotDuCompte[]>([]);
  const [compteGithub, setCompteGithub] = React.useState<string | undefined>();
  const [depotsErreur, setDepotsErreur] = React.useState<string | undefined>();
  const [depotsCharges, setDepotsCharges] = React.useState(false);
  const [chercheDepot, setChercheDepot] = React.useState('');
  const [lienGithub, setLienGithub] = React.useState('');
  const [ghSousDomaine, setGhSousDomaine] = React.useState('');
  const [ghPort, setGhPort] = React.useState('');
  const [etapesGithub, setEtapesGithub] = React.useState<Etape[] | null>(null);

  const [newName, setNewName] = React.useState('');
  const [newFolder, setNewFolder] = React.useState('');
  const [newRemote, setNewRemote] = React.useState('');
  const [newResume, setNewResume] = React.useState('');
  const [withGit, setWithGit] = React.useState(true);
  const [withGithub, setWithGithub] = React.useState(true);
  /* L'adresse publique se demande ICI, au montage : un projet monté sans elle
     est un projet dont le déploiement n'a rien à contrôler à la fin. */
  const [newSousDomaine, setNewSousDomaine] = React.useState('');
  const [newPort, setNewPort] = React.useState('');
  /* Le déroulé du montage : on le garde à l'écran après coup, sinon une étape
     ratée passerait dans un message qui s'efface tout seul. */
  const [etapes, setEtapes] = React.useState<Etape[] | null>(null);

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
    setEtapes(null);
    try {
      const data = await client.call<{ project: { id: string }; etapes?: Etape[] }>(
        {
          type: 'project.new',
          name: newName.trim(),
          folder: newFolder.trim() || undefined,
          description: newResume.trim() || undefined,
          git: withGit,
          gitRemote: newRemote.trim() || undefined,
          github: withGithub,
          sousDomaine: newSousDomaine.trim() || undefined,
          port: newPort ? Number(newPort) : undefined,
        },
        /* La création de l'adresse attend que le nom soit visible sur Internet :
           le montage peut donc durer plus longtemps qu'avant. */
        300000,
      );
      client.setActiveProject(data.project.id);
      setEtapes(data.etapes ?? []);
      setNewName('');
      setNewFolder('');
      setNewRemote('');
      setNewResume('');
      setNewSousDomaine('');
      setNewPort('');
      /* La fenêtre reste ouverte tant qu'une étape a échoué : c'est le seul
         endroit où l'on peut lire laquelle et pourquoi. */
      if ((data.etapes ?? []).every((etape) => etape.fait)) onClose();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'création impossible');
    } finally {
      setBusy(null);
    }
  };

  /*
   * Les dépôts du compte ne se demandent qu'à l'OUVERTURE de l'onglet : les
   * lister appelle GitHub, et personne ne veut payer cet appel pour ouvrir la
   * fenêtre sur un autre chemin.
   */
  React.useEffect(() => {
    if (!open || onglet !== 'github' || depotsCharges) return;
    setDepotsCharges(true);
    setLoading(true);
    client
      .call<{ depots?: DepotDuCompte[]; compte?: string; erreur?: string }>({ type: 'github.depots' }, 60000)
      .then((data) => {
        setDepots(data.depots ?? []);
        setCompteGithub(data.compte);
        setDepotsErreur(data.erreur);
      })
      .catch((err: any) => setDepotsErreur(err?.message ?? 'les dépôts GitHub sont illisibles'))
      .finally(() => setLoading(false));
  }, [open, onglet, depotsCharges]);

  /** Le seul chemin d'ajout : le lien lu, l'adresse demandée, puis le montage. */
  const ajouterDepuisGithub = async (lien: string, cle: string) => {
    const lu = lireLienGithub(lien);
    if (!lu.ok || !lu.depot) {
      client.pushToast('error', lu.erreur ?? 'lien illisible');
      return;
    }
    setBusy(cle);
    setEtapesGithub(null);
    try {
      const data = await client.call<{ project: { id: string }; etapes?: Etape[] }>(
        {
          type: 'project.fromGithub',
          lien: lu.depot.slug,
          sousDomaine: ghSousDomaine.trim() || undefined,
          port: ghPort ? Number(ghPort) : undefined,
        },
        /* Récupérer un dépôt puis créer son adresse peut durer : on laisse le
           temps du clone, sinon un gros dépôt passerait pour une panne. */
        600000,
      );
      client.setActiveProject(data.project.id);
      setEtapesGithub(data.etapes ?? []);
      setLienGithub('');
      setGhSousDomaine('');
      setGhPort('');
      setDepots((current) => current.filter((depot) => depot.slug !== lu.depot!.slug));
      /* La fenêtre reste ouverte tant qu'une étape a échoué : c'est le seul
         endroit où l'on peut lire laquelle et pourquoi. */
      if ((data.etapes ?? []).every((etape) => etape.fait)) onClose();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'ajout impossible');
    } finally {
      setBusy(null);
    }
  };

  const visible = filter ? found.filter((entry) => entry.name.toLowerCase().includes(filter.toLowerCase())) : found;
  const depotsVisibles = filtrerDepots(depots, chercheDepot);

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="sm:w-[min(600px,100%)]">
        <DialogTitle>Projets du serveur</DialogTitle>

        <Tabs value={onglet} onValueChange={setOnglet} className="mt-3">
          <TabsList>
            <TabsTrigger value="existing">Déjà sur le serveur</TabsTrigger>
            <TabsTrigger value="github">Depuis GitHub</TabsTrigger>
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
                <ZoneDefilement classeEnveloppe="mt-1.5 max-h-[340px] flex-none" className="space-y-0.5">
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
                </ZoneDefilement>
              </>
            ) : (
              <p className="mt-3 text-[13.5px] text-faint">Tous les projets du serveur sont déjà dans votre liste.</p>
            )}
          </TabsContent>

          <TabsContent value="github" className="mt-3 space-y-2.5">
            {/* L'adresse publique se demande AVANT le montage, ici comme pour un projet neuf. */}
            <div data-adresse-depuis-github>
              <Label>Adresse publique du projet (facultatif)</Label>
              <div className="mt-1 flex items-center gap-1.5">
                <Input
                  value={ghSousDomaine}
                  onChange={(event) => setGhSousDomaine(event.target.value)}
                  placeholder="nom-du-site"
                  className="flex-1"
                  data-sous-domaine-github
                />
                <span className="shrink-0 text-[12.5px] text-faint">.{ZONE_PROJETS}</span>
                <Input
                  value={ghPort}
                  onChange={(event) => setGhPort(event.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="port"
                  className="w-[74px]"
                  data-port-github
                />
              </div>
              <p className="mt-1 text-[12px] leading-snug text-faint">
                Le nom et le port sur lequel le projet écoutera. Ils sont demandés avant le montage : c'est cette adresse
                qui sera contrôlée à la fin de chaque déploiement. Laissés vides, le projet est ajouté sans adresse.
              </p>
            </div>

            <div className="border-t border-border pt-2.5">
              <Label>Vos dépôts GitHub{compteGithub ? ` (compte ${compteGithub})` : ''}</Label>
              <div className="relative mt-1">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-faint" />
                <Input
                  value={chercheDepot}
                  onChange={(event) => setChercheDepot(event.target.value)}
                  placeholder="Chercher un dépôt…"
                  className="pl-7"
                  data-recherche-depot
                />
              </div>

              {loading && !depots.length ? (
                <p className="mt-2 flex items-center gap-1.5 text-[13.5px] text-faint">
                  <Loader2 className="h-3 w-3 animate-spin" /> Lecture des dépôts du compte GitHub…
                </p>
              ) : depotsErreur ? (
                <p className="mt-2 text-[13px] text-warning">{depotsErreur}</p>
              ) : depotsVisibles.length ? (
                <ZoneDefilement classeEnveloppe="mt-1.5 max-h-[220px] flex-none" className="space-y-0.5">
                  {depotsVisibles.map((depot) => (
                    <div
                      key={depot.slug}
                      className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1.5"
                      data-depot-github={depot.slug}
                    >
                      <Github className="h-3 w-3 shrink-0 text-faint" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] text-text">{depot.slug}</p>
                        <p className="truncate text-[11.5px] text-faint">
                          {depot.prive ? 'privé' : 'public'}
                          {depot.vide ? ' · vide' : ''}
                          {depot.description ? ` · ${depot.description}` : ''}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === depot.slug || depot.vide}
                        onClick={() => ajouterDepuisGithub(depot.slug, depot.slug)}
                      >
                        {busy === depot.slug ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Plus className="h-3 w-3" />
                        )}
                        Ajouter
                      </Button>
                    </div>
                  ))}
                </ZoneDefilement>
              ) : (
                <p className="mt-2 text-[13.5px] text-faint">
                  {depots.length ? 'Aucun dépôt ne correspond à cette recherche.' : 'Aucun dépôt trouvé sur ce compte.'}
                </p>
              )}
            </div>

            <div className="border-t border-border pt-2.5">
              <Label>Ou collez le lien d'un dépôt</Label>
              <div className="mt-1 flex items-center gap-1.5">
                <Input
                  value={lienGithub}
                  onChange={(event) => setLienGithub(event.target.value)}
                  placeholder="https://github.com/compte/depot"
                  className="flex-1"
                  data-lien-github
                />
                <Button
                  size="sm"
                  variant="default"
                  disabled={!lienGithub.trim() || busy === 'lien'}
                  onClick={() => ajouterDepuisGithub(lienGithub, 'lien')}
                >
                  {busy === 'lien' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                  Ajouter
                </Button>
              </div>
              <p className="mt-1 text-[12px] leading-snug text-faint">
                Pour un dépôt qui n'appartient pas à ce compte. Le dépôt est récupéré sur le serveur et le projet
                apparaît dans la liste de gauche. Rien n'est publié ni mis en ligne au passage.
              </p>
            </div>

            {etapesGithub ? <DerouleDesEtapes etapes={etapesGithub} /> : null}
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
              <Label>En une phrase, à quoi sert ce projet ? (facultatif)</Label>
              <Input
                value={newResume}
                onChange={(event) => setNewResume(event.target.value)}
                className="mt-1"
                placeholder="Le site vitrine de l'atelier"
              />
              <p className="mt-1 text-[12px] leading-snug text-faint">
                Cette phrase ouvre la documentation du projet et décrit le dépôt sur GitHub.
              </p>
            </div>
            {/* L'adresse publique : demandée ici, créée pendant le montage. */}
            <div data-adresse-nouveau-projet>
              <Label>Adresse publique du projet (facultatif)</Label>
              <div className="mt-1 flex items-center gap-1.5">
                <Input
                  value={newSousDomaine}
                  onChange={(event) => setNewSousDomaine(event.target.value)}
                  placeholder="nom-du-site"
                  className="flex-1"
                  data-sous-domaine
                />
                <span className="shrink-0 text-[12.5px] text-faint">.{ZONE_PROJETS}</span>
                <Input
                  value={newPort}
                  onChange={(event) => setNewPort(event.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="port"
                  className="w-[74px]"
                  data-port-projet
                />
              </div>
              <p className="mt-1 text-[12px] leading-snug text-faint">
                Le nom et le port sur lequel le projet écoutera. HaikoDev crée l'adresse pendant le montage : c'est elle
                qui sera contrôlée à la fin de chaque déploiement. Laissés vides, le projet est monté sans adresse.
              </p>
            </div>
            <div>
              <Label>Dépôt distant existant (facultatif)</Label>
              <Input
                value={newRemote}
                onChange={(event) => setNewRemote(event.target.value)}
                className="mt-1"
                placeholder="laisser vide pour en créer un sur GitHub"
              />
            </div>
            <label className="flex items-center gap-2 text-[14px] text-muted">
              <Switch checked={withGit} onCheckedChange={setWithGit} />
              Démarrer un dépôt git dans le dossier
            </label>
            <label className="flex items-center gap-2 text-[14px] text-muted">
              <Switch
                checked={withGithub && withGit && !newRemote.trim()}
                disabled={!withGit || !!newRemote.trim()}
                onCheckedChange={setWithGithub}
              />
              Créer aussi le dépôt privé sur GitHub
            </label>

            <p className="text-[12.5px] leading-snug text-faint">
              Le dossier est créé pour de vrai sur le serveur, sur la branche « main », avec les fichiers d'instructions
              des moteurs, la mémoire, l'historique et une documentation de départ. Le projet apparaît ensuite dans la
              liste de gauche.
            </p>

            <Button variant="default" size="sm" disabled={!newName.trim() || busy === 'new'} onClick={createNew}>
              {busy === 'new' ? <Loader2 className="h-3 w-3 animate-spin" /> : <FolderPlus className="h-3 w-3" />}
              Créer le projet
            </Button>

            {etapes ? <DerouleDesEtapes etapes={etapes} /> : null}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
