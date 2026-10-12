import * as React from 'react';
import {
  ArrowLeft,
  ArchiveRestore,
  Check,
  ChevronRight,
  Folder,
  FolderPlus,
  Github,
  GripVertical,
  PanelLeft,
  Settings,
  SquarePen,
  EllipsisVertical,
  Loader2,
  Palette,
  Pencil,
  Plus,
  FileCheck2,
  Search,
  Settings2,
  TriangleAlert,
  UploadCloud,
  Waypoints,
  X,
} from 'lucide-react';
import {
  COULEURS_DE_GROUPE,
  Project,
  type VueCentrale,
  ProjectGroup,
  type AvancementColonne,
  type SignalProjet,
  zoneDesProjets,
  type DepotDuCompte,
  filtrerDepots,
  lireLienGithub,
  caseCahierCocheeParDefaut,
  activiteDeProjet,
  agentTientSonTour,
  avancementDeLaColonne,
  doitSecouerLigne,
  premiereDecision,
  repereVisible,
  iconeDuLot,
  type IconeDAttention,
  signalDuGroupe,
  estUnRegroupement,
  membresActifsDuRegroupement,
  compterEnPanne,
  texteDuCompteur,
} from '@beluga/shared';
import { idDuGroupeLocal } from '@beluga/shared';
import { libelleAttention, RepereAttention } from '@/components/repere-attention';
import {
  BulleInfo,
  Button,
  CLASSE_BOUTON_DE_CREATION,
  CLASSE_POINT_DE_BOUTON,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogHeader,
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
  FormulaireEnColonnes,
  LigneFormulaire,
} from '@/components/ui';
import { CLASSE_TRAIT_DE_BRANCHE, PastilleProjet, PastillesEmpilees, largeurPile } from '@/components/pastille-projet';
import { PastillesMessagerie } from '@/components/pastilles-messagerie';
import { SilhouetteProjets } from '@/components/silhouettes';
import { QuotaBadge } from '@/components/quota-badge';
import { CLE_COLONNE_REDUITE, useEtatDeLiaison, useMoteurActif } from '@/components/quota-bar';
import { PointRedemarrage, useRedemarrage } from '@/components/redemarrage';
import { ouvrirConfigProjet } from '@/lib/ouvrir-config-projet';
import { client } from '@/lib/client';
import { usePointerDrag } from '@/lib/dnd';
import { usePref } from '@/lib/prefs';
import { useTelephone } from '@/lib/telephone';
import { ClocheNotifications } from '@/components/notifications';
import { useApp } from '@/lib/use-app';
import { useGlissementDeCarte } from '@/lib/deplacement-de-projet';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';
import { useTiroirAdresse } from '@/lib/tiroirs-adresse';

/** Un élément de la colonne : un projet hors groupe, ou un groupe entier. */
type Entry =
  | { kind: 'project'; id: string; rank: number; project: Project }
  | { kind: 'group'; id: string; rank: number; group: ProjectGroup; members: Project[] };

/**
 * LA LARGEUR DE LA COLONNE RÉTRÉCIE : juste de quoi poser une icône de projet,
 * son point d'alerte et le retrait de la liste. La MÊME STRUCTURE que le menu
 * large tient dedans — groupes compris —, seuls les noms s'effacent.
 */
const LARGEUR_BANDE = 52;

export function Sidebar({
  onOpenAgent,
  width,
  onChoose,
  vue,
  onOuvrirVue,
  onChercher,
  onOpenSettings,
  onNouvelAgent,
  service,
  onCorpsDeService,
  onCorpsDePage,
}: {
  onOpenAgent: (agentId: string) => void;
  width?: number;
  /**
   * LA COLONNE SUIT LE LIEU OÙ L'ON EST (demande du 11/10/2026) : dans un
   * service qui a son menu, dans un PROJET (ses options) ou dans une TÂCHE (les
   * siennes), ce menu remplace la liste des projets (`ColonneDeService`). La
   * tête porte alors le nom du lieu et une flèche qui remonte d'un cran, et le
   * corps n'est plus qu'un emplacement où le lieu écrit.
   *  - `plan: 'page'` : c'est une page ouverte par-dessus la zone (une tâche)
   *    qui tient la colonne ; le menu du lieu d'en dessous reste monté, caché.
   *  - `bande` : colonne réduite, le menu garde ses icônes au lieu de
   *    disparaître (les options du projet et de la tâche).
   *  - `point` : ce qui réclame l'attention AILLEURS — la liste des projets
   *    n'étant plus sous les yeux, la flèche de retour le signale.
   */
  service?: {
    titre: string;
    onRetour: () => void;
    plan?: 'service' | 'page';
    bande?: boolean;
    point?: { classe: string; texte: string } | null;
  } | null;
  /** L'emplacement où le service pose son menu, remis à l'application. */
  onCorpsDeService?: (element: HTMLElement | null) => void;
  /** L'emplacement où la page ouverte par-dessus (une tâche) pose le sien. */
  onCorpsDePage?: (element: HTMLElement | null) => void;
  /** Ouvre la recherche de projet (le tiroir « Changer de projet »). */
  onChercher?: () => void;
  /** Ouvre les réglages : LE bouton du pied de colonne. */
  onOpenSettings?: () => void;
  /** Lance un nouvel agent (choix du projet), première ligne de la colonne. */
  onNouvelAgent?: () => void;
  /** Prévenu dès qu'un projet est choisi : le panneau latéral se referme. */
  onChoose?: () => void;
  /**
   * LA DESTINATION AFFICHÉE AU CENTRE. La colonne est une liste PLATE : chaque
   * ligne est une destination, celle qui est affichée s'allume, et cliquer une
   * autre REMPLACE le contenu central. Aucune ne se pose par-dessus, donc
   * aucune n'a de croix.
   */
  vue: VueCentrale;
  onOuvrirVue: (vue: VueCentrale) => void;
}) {
  const state = useApp();
  /* SUR TÉLÉPHONE, LES OUTILS DES LIGNES (poignées, réglages, crayon, croix)
     SE CACHENT derrière un interrupteur de l'entête « Projets » : sans survol,
     ils restaient toujours visibles et chargeaient la liste. Éteint à chaque
     ouverture du volet ; l'ordinateur ne change pas (le survol les révèle). */
  const telephone = useTelephone();
  const [outilsVisibles, setOutilsVisibles] = React.useState(false);
  const outilsCaches = telephone && !outilsVisibles;
  const [adding, setAdding] = React.useState(false);
  /* « Projets du serveur » a son adresse ; la colonne posée à gauche la tient
     (un lien collé la rouvre). Celle du panneau du téléphone n'est montée qu'à
     l'ouverture : c'est le volet lui-même qui écrit son nom. */
  useTiroirAdresse(onChoose ? null : 'projets-du-serveur', adding, setAdding);
  /* L'assistant de premier démarrage fait ouvrir CETTE fenêtre d'ajout plutôt
     que d'en écrire une seconde (`assistant-demarrage.tsx`). Seule la colonne
     posée à gauche écoute : celle du téléphone n'est pas toujours montée, et
     deux à l'écoute ouvriraient deux fenêtres. */
  React.useEffect(() => {
    if (onChoose) return;
    const ouvrir = () => setAdding(true);
    window.addEventListener('beluga:ajouter-projet', ouvrir);
    return () => window.removeEventListener('beluga:ajouter-projet', ouvrir);
  }, [onChoose]);
  const [showArchived, setShowArchived] = React.useState(false);
  const [archived, setArchived] = React.useState<Project[]>([]);
  // Ce qui est replié est enregistré côté serveur, comme le reste.
  const [collapsed, setCollapsed] = usePref<string[]>('sidebar.collapsed', []);
  /* LES PROJETS RÉUNIS DÉPLIÉS — repliés par défaut : un clic sur leur nom ou
     leur flèche ouvre le sous-groupe de leurs membres. */
  const [regroupementsOuverts, setRegroupementsOuverts] = usePref<string[]>('sidebar.regroupementsOuverts', []);

  /*
   * LA COLONNE ENTIÈRE SE RÉDUIT À UNE BANDE D'ICÔNES.
   *
   * `sidebar.collapsed` ne replie que des GROUPES ; c'est un second réglage,
   * `colonne.reduite`, qui replie la COLONNE. Il vit en base comme le reste :
   * le choix survit au rechargement et suit l'appareil.
   *
   * RÉDUITE, LA COLONNE NE MONTRE QUE DES ICÔNES ALIGNÉES ; au survol de la
   * bande, le panneau entier se déplie EN SURIMPRESSION (`absolute`, au-dessus
   * du contenu) : la zone de droite ne bouge pas d'un pixel. À la sortie du
   * curseur, il se referme — après un court délai de grâce, sans quoi le
   * moindre passage sur un bord le ferait clignoter.
   *
   * SUR TÉLÉPHONE, RIEN DE TOUT CELA : il n'y a pas de survol, et la colonne
   * vit déjà dans un panneau qui s'ouvre au toucher. Le réglage y est ignoré.
   */
  const [reduite, setReduite] = usePref<boolean>(CLE_COLONNE_REDUITE, false);
  const [survolee, setSurvolee] = React.useState(false);
  const minuterieSurvol = React.useRef<number | undefined>(undefined);
  const refColonne = React.useRef<HTMLElement>(null);
  const reduitEffectif = reduite && !telephone;
  /** La bande seule : réduite, et le curseur n'est pas dessus. */
  const bandeSeule = reduitEffectif && !survolee;
  const ouvrirAuSurvol = () => {
    window.clearTimeout(minuterieSurvol.current);
    setSurvolee(true);
  };
  /*
   * UN MENU OUVERT DEPUIS LA COLONNE LA RETIENT. Les services, les quotas, le
   * « … » d'un projet s'ouvrent dans un calque posé HORS de la colonne : aller
   * vers eux, c'est la quitter. Elle se refermait donc sous le menu, démontait
   * son bouton, et le menu disparaissait avant le clic (« le bouton des
   * services ferme la colonne et je n'y ai pas accès »). Tant qu'un de ses
   * boutons tient un menu ouvert (`aria-haspopup` + `aria-expanded`, posés par
   * Radix), la fermeture attend ; le menu refermé, elle a lieu — sauf si le
   * curseur est revenu sur la colonne.
   */
  const fermerAuSurvolBientot = () => {
    window.clearTimeout(minuterieSurvol.current);
    const tenter = () => {
      const colonne = refColonne.current;
      if (colonne?.querySelector('[aria-haspopup][aria-expanded="true"]')) {
        minuterieSurvol.current = window.setTimeout(tenter, 150);
        return;
      }
      if (colonne?.matches(':hover')) return;
      setSurvolee(false);
    };
    minuterieSurvol.current = window.setTimeout(tenter, 150);
  };
  React.useEffect(() => () => window.clearTimeout(minuterieSurvol.current), []);
  // Repliée à la main : le panneau ne doit pas rester ouvert sous le curseur.
  React.useEffect(() => {
    if (!reduitEffectif) setSurvolee(false);
  }, [reduitEffectif]);

  /*
   * LE BOUTON QUI REPLIE LA COLONNE N'EST PLUS ICI. Il était posé dans la ligne
   * de titre « PROJETS », au milieu de la colonne ; il vit désormais tout en
   * haut à gauche de la barre du haut (`quota-bar.tsx`), là où se trouvait le
   * point d'état — qu'il porte maintenant dans son coin. Un seul bouton dans
   * l'application, pas deux : celui-ci a été RETIRÉ, il n'a pas été copié.
   *
   * Le réglage, lui, reste lu ici (`colonne.reduite`) : les deux composants
   * passent par le magasin des préférences et ne peuvent pas diverger.
   */
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
   * n'est PAS un projet comme les autres : il ne se range pas et ne se glisse
   * pas. Il sort donc de la liste rangeable, mais s'affiche FIXÉ EN TÊTE de son
   * groupe « Local » (`shared/src/groupe-local.ts`), que le démon garantit au
   * démarrage et qui ne se supprime pas. Sans ce groupe (démon plus ancien), il
   * reste ancré sous le libellé « Projets ». Cela ne l'empêche pas de RECEVOIR
   * une carte : le dépôt suit la règle commune.
   */
  const tousActifs = state.projects.filter((p) => !p.archived && !p.isSelf);
  /*
   * LES MEMBRES D'UN PROJET RÉUNI NE SE RANGENT PLUS EUX-MÊMES : ils vivent
   * dans le SOUS-GROUPE de leur regroupement, qui prend leur place dans la
   * liste (`shared/src/regroupements.ts`). Un membre dont le regroupement est
   * mis de côté redevient une ligne ordinaire.
   */
  const regroupementsActifs = new Set(tousActifs.filter((p) => estUnRegroupement(p)).map((p) => p.id));
  const actifs = tousActifs.filter((p) => !(p.regroupementId && regroupementsActifs.has(p.regroupementId)));
  const membresDe = (id: string) => membresActifsDuRegroupement(tousActifs, id);
  const espaceDev = state.projects.find((p) => !p.archived && p.isSelf) ?? null;
  const groups = state.groups;
  /** Le groupe « Local » : celui où vit l'espace de développement. */
  const groupeLocalId = idDuGroupeLocal(state.projects, groups);

  /*
   * UNE CARTE EST EN VOL AU-DESSUS DE LA COLONNE. Le tableau publie ce qu'il
   * tient (`useGlissementDeCarte`) : on n'ouvre PAS un second mécanisme de
   * glissement ici — celui de la colonne ne sert qu'au rangement des projets.
   * La ligne visée s'éclaire quand le dépôt est permis, et reste inerte sinon :
   * on voit AVANT de lâcher si ça va marcher.
   */
  const glissementDeCarte = useGlissementDeCarte();
  const cibleDeCarteDe = (projetId: string): 'acceptee' | 'refusee' | null => {
    if (!glissementDeCarte || glissementDeCarte.cibleProjetId !== projetId) return null;
    return glissementDeCarte.cibleAcceptee ? 'acceptee' : 'refusee';
  };

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
        client.pushToast('error', t('Rangement non enregistré'));
      }
    },
    [],
  );

  // Contrôle : node scripts/verif-glissement-projets.mjs — en déplaçant un
  // projet sur toute la hauteur de la liste, aucune ligne ne doit sauter : la
  // longueur de la liste ne bouge pas pendant le glissement.
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
      client.pushToast('error', t('Rangement non enregistré'));
    }
  };





  const toggle = (id: string) =>
    setCollapsed(collapsed.includes(id) ? collapsed.filter((g) => g !== id) : [...collapsed, id]);

  /* LE COMPTE ET L'ICÔNE D'UN PROJET viennent d'une règle partagée
     (`activiteDeProjet`) : les listes déroulantes de projets les montrent aussi
     (`IndicateursDeProjet`) et ne peuvent donc pas dire autre chose que la colonne. */
  const activiteOf = (projectId: string) =>
    activiteDeProjet(projectId, Object.values(state.agents), state.decisions);
  const runningOf = (projectId: string) => activiteOf(projectId).enCours;

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
        .filter((a) => a.projectId === projectId && a.role === 'task' && agentTientSonTour(a))
        .map((agent) => ({ agentActif: true, todos: agent.todos })),
    );

  // Une publication est EN COURS tant que son run le dit ; elle s'éteint dès
  // qu'il se termine, quel qu'en soit le sort (réussite, échec, arrêt).
  const publieOf = (projectId: string) => state.deploys[projectId]?.state === 'running';

  /*
   * QUELLE NATURE D'ATTENTE CE PROJET PORTE-T-IL ? Une question, un plan à
   * générer ou à valider, une carte à trancher : la table partagée
   * (`nature-attention.ts`) choisit UNE icône pour le lot, et c'est la même
   * table que lisent la carte du tableau et la cloche.
   */
  const iconeAttenteOf = (projectId: string): IconeDAttention | null => activiteOf(projectId).attente;

  React.useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  /*
   * La ligne se contente de DIRE ce qu'elle est (pour le dépôt) ; c'est la
   * poignée à gauche qui déclenche le glissement. Sinon un simple appui sur le
   * nom du projet embarquait la ligne au moindre mouvement du doigt.
   */
  const basculerRegroupement = (id: string, ouvrir?: boolean) => {
    const ouvert = regroupementsOuverts.includes(id);
    if (ouvrir === ouvert) return;
    setRegroupementsOuverts(ouvert ? regroupementsOuverts.filter((r) => r !== id) : [...regroupementsOuverts, id]);
  };

  /**
   * UNE LIGNE DE PROJET — ou, pour un projet réuni, sa ligne SUIVIE DE SON
   * SOUS-GROUPE. Replié, le regroupement porte aussi le travail de ses membres ;
   * déplié, chaque membre a sa ligne, son repère d'activité et ses réglages.
   */
  const rendreLigne = (
    project: Project,
    place: {
      style?: React.CSSProperties;
      marqueur?: 'before' | 'after';
      groupColor?: string;
      emboite?: boolean;
    },
  ) => {
    const ligne = (p: Project, extra: Partial<React.ComponentProps<typeof ProjectRow>> = {}) => (
      <ProjectRow
        key={p.id}
        project={p}
        active={p.id === state.activeProjectId && vue === 'projet'}
        running={runningOf(p.id)}
        publie={publieOf(p.id)}
        attention={state.attention[p.id]}
        rendus={state.rendus[p.id]}
        icone={iconeAttenteOf(p.id)}
        avancement={avancementOf(p.id)}
        dimmed={dragging?.id === p.id}
        cibleDeCarte={cibleDeCarteDe(p.id)}
        rowProps={rowProps(p.id, 'project')}
        poigneeProps={poigneeProps(p.id, 'project', p.name)}
        onSettings={() => ouvrirConfigProjet(p.id)}
        bande={bandeSeule}
        outilsCaches={outilsCaches}
        onChoose={() => {
          onOuvrirVue('projet');
          onChoose?.();
        }}
        groupColor={place.groupColor}
        emboite={place.emboite}
        {...extra}
      />
    );
    if (!estUnRegroupement(project)) return ligne(project, { style: place.style, marqueur: place.marqueur });
    const membres = membresDe(project.id);
    const ouvert = regroupementsOuverts.includes(project.id);
    const signal = signalDuGroupe([project.id, ...membres.map((m) => m.id)], state.attention, state.rendus);
    return (
      <div key={project.id} style={place.style} data-regroupement-colonne={project.id} data-ouvert={ouvert || undefined}>
        {ligne(project, {
          marqueur: place.marqueur,
          running: runningOf(project.id) + (ouvert ? 0 : membres.reduce((n, m) => n + runningOf(m.id), 0)),
          publie: publieOf(project.id) || (!ouvert && membres.some((m) => publieOf(m.id))),
          attention: ouvert ? state.attention[project.id] : signal.attention,
          rendus: ouvert ? state.rendus[project.id] : signal.rendus,
          sousGroupe: {
            ouvert,
            nombre: membres.length,
            membres,
            basculer: (ouvrir?: boolean) => basculerRegroupement(project.id, ouvrir),
          },
        })}
        {ouvert ? (
          <div
            className={cn(
              /* LE RETRAIT DES MEMBRES est constant (`RETRAIT_DES_MEMBRES`) : la
                 poignée de rangement a quitté la gauche de la ligne, plus rien
                 ne décale la pile d'icônes du projet réuni. */
              bandeSeule ? 'px-0' : 'pl-4',
            )}
            data-membres-regroupement={project.id}
          >
            {membres.map((membre, i) =>
              bandeSeule ? (
                ligne(membre, {
                  emboite: 'reuni',
                  /* Un membre se range DANS son regroupement : il ne se glisse pas ailleurs. */
                  rowProps: { 'data-membre-de': project.id },
                  poigneeProps: {},
                  sansPoignee: true,
                })
              ) : (
                /* `flow-root` garde la marge basse de la ligne DANS l'enveloppe :
                   la branche verticale couvre ainsi l'intervalle entre deux lignes. */
                <div key={membre.id} className="relative flow-root">
                  <BrancheMembre
                    premier={i === 0}
                    dernier={i === membres.length - 1}
                    largeurPile={largeurPile(membres.length)}
                  />
                  {ligne(membre, {
                    emboite: 'reuni',
                    rowProps: { 'data-membre-de': project.id },
                    poigneeProps: {},
                    sansPoignee: true,
                  })}
                </div>
              ),
            )}
          </div>
        ) : null}
      </div>
    );
  };

  const liaison = useEtatDeLiaison();
  const redemarrage = useRedemarrage();
  const moteurActif = useMoteurActif();

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

  /** La classe d'une LIGNE de la colonne : du texte, une icône, un fond gris au survol — rien d'autre. */
  const classeLigne = (active: boolean) =>
    cn(
      'group/l flex h-9 w-full min-w-0 items-center gap-2.5 rounded-lg text-left text-[14px] text-text transition-colors',
      bandeSeule ? 'justify-center px-0' : 'px-2.5',
      /* La ligne OUVERTE s'écrit en violet : c'est elle qu'on cherche des yeux. */
      active ? 'bg-ligne-active text-teinte' : 'hover:bg-raised',
    );
  /** La page des tableaux de bord est à l'écran (vue `en-route`, ou aucun projet ouvert). */
  const surTableauxDeBord = vue === 'en-route' || (vue === 'projet' && !state.activeProjectId);
  /** L'intitulé d'une section (« Services », « Projets ») : petit, gris, repliable. */
  const classeSection = 'flex h-8 w-full items-center gap-1 rounded-lg px-2.5 text-left text-[12.5px] text-faint transition-colors hover:text-muted';

  return (
    <aside
      ref={refColonne}
      // Sur téléphone la liste occupe tout l'écran ; la largeur réglée à la
      // main ne vaut qu'à partir des écrans larges. AUCUN TRAIT ne sépare la
      // colonne de la zone principale : c'est son fond, un gris très pâle, qui
      // la distingue (`data-zone="gauche"`, `styles.css`).
      data-zone="gauche"
      data-colonne-projets={reduitEffectif ? (survolee ? 'survolee' : 'reduite') : 'depliee'}
      /*
       * L'ASIDE NE PORTE QUE LA PLACE RÉSERVÉE. Réduite, elle ne vaut plus que
       * la largeur d'une bande d'icônes : c'est ELLE qui décide de ce que la
       * zone de droite occupe, et elle ne bouge pas quand le panneau s'ouvre.
       */
      className={cn(
        'relative flex w-full shrink-0 flex-col',
        reduitEffectif ? 'sm:w-[var(--largeur-bande)]' : 'sm:w-[var(--largeur-projets)]',
      )}
      style={{
        ['--largeur-projets' as any]: `${width ?? 264}px`,
        ['--largeur-bande' as any]: `${LARGEUR_BANDE}px`,
      }}
      onPointerEnter={(event) => {
        /* Une carte en vol ouvre la colonne repliée QUEL QUE SOIT le pointeur :
           au doigt il n'y a pas de survol, et sans cela on ne pourrait déposer
           une carte que colonne dépliée. */
        if (reduitEffectif && (event.pointerType === 'mouse' || glissementDeCarte)) ouvrirAuSurvol();
      }}
      onPointerLeave={(event) => {
        if (reduitEffectif && (event.pointerType === 'mouse' || glissementDeCarte)) fermerAuSurvolBientot();
      }}
    >
      {/*
       * LE PANNEAU, POSÉ PAR-DESSUS LE CONTENU QUAND LA COLONNE EST RÉDUITE.
       * Il reprend le repère de zone pour garder le fond de la colonne — un
       * panneau transparent laisserait lire la page au travers. Déplié, il
       * n'est qu'une colonne ordinaire.
       */}
      <div
        data-zone="gauche"
        data-panneau-projets={bandeSeule ? 'bande' : 'deplie'}
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          reduitEffectif &&
            (survolee
              ? 'absolute inset-y-0 left-0 z-50 w-[var(--largeur-projets)] shadow-2xl'
              : 'w-[var(--largeur-bande)]'),
        )}
      >
        {/*
         * LA TÊTE : le nom de l'application, puis deux gestes — chercher un
         * projet, replier la colonne. Rien d'autre. Rétrécie, la colonne n'en
         * garde que le bouton qui la déplie.
         */}
        <div
          className={cn('flex h-14 shrink-0 items-center gap-1', bandeSeule ? 'justify-center px-0' : 'pl-4 pr-2.5')}
          data-titre-projets={bandeSeule ? 'bande' : 'deplie'}
        >
          {bandeSeule ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted"
              aria-label="Déplier le menu"
              title={t('Déplier le menu')}
              data-deplier-colonne
              data-replier-colonne="reduite"
              onClick={() => setReduite(false)}
            >
              <PanelLeft className="h-4 w-4" />
            </Button>
          ) : (
            <>
              {service ? (
                /* UN SERVICE A PRIS LA COLONNE : son nom, et la flèche qui
                   remonte d'un cran puis rend la liste des projets. */
                <>
                  <Tooltip label={service.point ? `${t('Retour')} · ${service.point.texte}` : t('Retour')}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="relative -ml-2 h-8 w-8 shrink-0 text-muted"
                      aria-label="Retour"
                      data-retour-de-colonne
                      onClick={service.onRetour}
                    >
                      <ArrowLeft className="h-4 w-4" />
                      {service.point ? (
                        <span data-point-etat className={cn(CLASSE_POINT_DE_BOUTON, service.point.classe)} />
                      ) : null}
                    </Button>
                  </Tooltip>
                  <span className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight text-text" data-titre-de-colonne>
                    {service.titre}
                  </span>
                </>
              ) : (
                <span className="min-w-0 flex-1 truncate text-[16px] font-semibold tracking-tight text-text" data-nom-application>
                  Beluga
                </span>
              )}
              {/* LES SERVICES N'ONT PLUS LEUR BOUTON ICI : il ouvre le fil
                  d'Ariane, tout à gauche de la barre d'en-tête (`app.tsx`). */}
              {telephone ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn('h-8 w-8 text-muted', outilsVisibles && 'bg-raised text-text')}
                  aria-pressed={outilsVisibles}
                  aria-label={outilsVisibles ? 'Cacher les poignées et réglages' : 'Afficher les poignées et réglages'}
                  title={outilsVisibles ? t('Cacher les poignées et réglages') : t('Afficher les poignées et réglages')}
                  data-outils-projets={outilsVisibles ? 'visibles' : 'caches'}
                  onClick={() => setOutilsVisibles((v) => !v)}
                >
                  <Settings2 className="h-4 w-4" />
                </Button>
              ) : null}
              {onChercher && !service ? (
                <Tooltip label={t('Chercher un projet')}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted"
                    aria-label="Chercher un projet"
                    data-chercher-projet
                    onClick={onChercher}
                  >
                    <Search className="h-4 w-4" />
                  </Button>
                </Tooltip>
              ) : null}
              {telephone ? null : reduitEffectif ? (
                /* LA COLONNE N'EST QUE SURVOLÉE : ce bouton la ROUVRE pour de
                   bon. Il redemandait de la réduire — elle l'était déjà —, et
                   celui qui la déplie n'existait que dans la bande, que le
                   curseur ne peut pas atteindre sans ouvrir ce panneau : « le
                   bouton ne marche que dans un sens ». */
                <Tooltip label={t('Déplier le menu')}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted"
                    aria-label="Déplier le menu"
                    data-deplier-colonne
                    data-replier-colonne="survolee"
                    onClick={() => setReduite(false)}
                  >
                    <PanelLeft className="h-4 w-4" />
                  </Button>
                </Tooltip>
              ) : (
                <Tooltip label={t('Replier le menu')}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted"
                    aria-label="Replier le menu"
                    data-replier-colonne="depliee"
                    onClick={() => setReduite(true)}
                  >
                    <PanelLeft className="h-4 w-4" />
                  </Button>
                </Tooltip>
              )}
            </>
          )}
        </div>

        {/* LE MENU DU SERVICE OUVERT, à la place des projets. L'emplacement
            reste monté quand la colonne est réduite : le menu garde son état,
            et reparaît au survol. */}
        {service ? (
          <div
            ref={onCorpsDeService}
            data-colonne-de-service
            data-bande={bandeSeule ? '' : undefined}
            className={cn(
              'group/colonne flex min-h-0 flex-1 flex-col',
              bandeSeule ? 'px-1.5' : 'px-2',
              bandeSeule && !service.bande && 'invisible',
              service.plan === 'page' && 'hidden',
            )}
          />
        ) : null}
        {/* LE MENU DE LA PAGE OUVERTE PAR-DESSUS (les options d'une tâche) :
            il prend la colonne tant qu'elle est ouverte. Celui du lieu d'en
            dessous reste monté, caché, et reparaît tel quel au retour. */}
        {service?.plan === 'page' ? (
          <div
            ref={onCorpsDePage}
            data-colonne-de-service
            data-colonne-de-page
            data-bande={bandeSeule ? '' : undefined}
            className={cn('group/colonne flex min-h-0 flex-1 flex-col', bandeSeule ? 'px-1.5' : 'px-2')}
          />
        ) : null}
        <ZoneDefilement
          hauteur={16}
          classeEnveloppe={service ? 'hidden' : undefined}
          className={cn('touch-pan-y pb-4', bandeSeule ? 'px-1.5' : 'px-2')}
          data-drop-root
        >
          {/* ------------------------------------------------------------------
              LE GESTE DE TÊTE : lancer un nouvel agent, en NOIR avec une
              écriture blanche (`CLASSE_BOUTON_DE_CREATION`), pour qu'il se
              distingue des lignes grises du dessous. La page « Tableaux de
              bord » n'a plus de ligne ici sur ordinateur (demande du
              12/10/2026) : on y va par le premier cran du fil d'Ariane, le
              menu du titre ou la grille des services. Le téléphone n'a plus
              non plus de ligne ici (demande du 12/10/2026, soir).
              ------------------------------------------------------------------ */}
          {onNouvelAgent ? (
            <button
              type="button"
              data-ligne-nouvel-agent
              title={bandeSeule ? t('Nouvel agent') : undefined}
              onClick={() => {
                onNouvelAgent();
                onChoose?.();
              }}
              className={cn(
                'flex h-9 w-full min-w-0 items-center gap-2.5 rounded-lg text-left text-[14px] font-medium transition-opacity',
                bandeSeule ? 'justify-center px-0' : 'px-2.5',
                CLASSE_BOUTON_DE_CREATION,
              )}
            >
              <SquarePen className="h-4 w-4 shrink-0" />
              <span className={cn('min-w-0 flex-1 truncate', bandeSeule && 'sr-only')}>{t('Nouvel agent')}</span>
            </button>
          ) : null}

          {/* ------------------------------------------------------------------
              LES PROJETS. L'intitulé, ses deux gestes d'ajout au survol, puis
              la liste, rangée en DOSSIERS repliables (les groupes). TOUS les
              projets y figurent : le filtre « Tout, Actifs, En attente,
              Terminés » a été retiré (demande du 11/10/2026).
              ------------------------------------------------------------------ */}
          {bandeSeule ? (
            <div className="my-2 flex justify-center" aria-hidden>
              <span className="h-px w-5 bg-border" />
            </div>
          ) : (
            <>
              <div className="group/section mt-5 flex h-8 items-center gap-0.5 pl-2.5 pr-1">
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-faint">{t('Projets')}</span>
                <Tooltip label={t('Nouveau groupe')}>
                  <button
                    type="button"
                    aria-label="Nouveau groupe"
                    data-nouveau-groupe
                    onClick={() => setCreatingGroup(true)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-faint opacity-100 transition-opacity hover:bg-raised hover:text-text survol:opacity-0 group-hover/section:survol:opacity-100"
                  >
                    <FolderPlus className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
                <Tooltip label={t('Ajouter ou créer un projet')}>
                  <button
                    type="button"
                    aria-label="Ajouter ou créer un projet"
                    data-ouvrir-projets
                    onClick={() => setAdding(true)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-faint transition-colors hover:bg-raised hover:text-text"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </Tooltip>
              </div>

            </>
          )}

          {/* TANT QUE LE PREMIER ÉTAT DU SERVEUR N'EST PAS ARRIVÉ, on montre des
              SILHOUETTES de lignes de projet. Aucune phrase de liste vide ne
              s'écrit avant. */}
          {!state.pret && !state.copieLocale ? (
            <SilhouetteProjets />
          ) : (
            <>
              {/* EN TÊTE de la liste, et ancré là : l'espace où l'application
                  elle-même est développée, quand le groupe « Local » manque
                  (démon plus ancien). Pas de poignée, pas de rang. */}
              {espaceDev && !groupeLocalId ? (
                <LigneEspaceDev
                  project={espaceDev}
                  active={espaceDev.id === state.activeProjectId && vue === 'projet'}
                  running={runningOf(espaceDev.id)}
                  publie={publieOf(espaceDev.id)}
                  attention={state.attention[espaceDev.id]}
                  rendus={state.rendus[espaceDev.id]}
                  icone={iconeAttenteOf(espaceDev.id)}
                  avancement={avancementOf(espaceDev.id)}
                  cibleDeCarte={cibleDeCarteDe(espaceDev.id)}
                  onSettings={() => ouvrirConfigProjet(espaceDev.id)}
                  bande={bandeSeule}
                  outilsCaches={outilsCaches}
                  onChoose={onChoose}
                  onQuitterTableauDeBord={() => onOuvrirVue('projet')}
                />
              ) : null}

              {entries.map((entry) => {
                if (entry.kind === 'project') {
                  return rendreLigne(entry.project, {
                    style: glisse(decales.racine.has(entry.id)),
                    marqueur: marqueurDe(entry.id),
                  });
                }

                // Le groupe « Local » porte l'espace de développement en tête : il
                // compte parmi ses membres pour les signaux et le repli.
                const localDuGroupe = entry.id === groupeLocalId && espaceDev ? espaceDev : null;
                const local = localDuGroupe;
                const membres = entry.members;
                const membresVus = local ? [local, ...membres] : membres;
                // Replié, un dossier cacherait ce que ses projets attendent ET ce
                // qu'ils ont rendu : les deux signaux remontent jusqu'à son en-tête.
                const signal = signalDuGroupe(
                  membresVus.map((p) => p.id),
                  state.attention,
                  state.rendus,
                );
                const replie = collapsed.includes(entry.id);
                const outilDeGroupe = cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-faint transition-opacity hover:bg-raised hover:text-text survol:opacity-0 group-hover/g:survol:opacity-100',
                  outilsCaches && 'hidden',
                );
                return (
                  <div
                    key={entry.id}
                    data-drop-group={entry.id}
                    data-groupe-projets={entry.id}
                    style={glisse(decales.racine.has(entry.id))}
                    className={cn(
                      'relative rounded-lg transition-[transform,background-color] duration-150 motion-reduce:transition-none',
                      // Survoler le corps du dossier l'éclaire en entier : on comprend
                      // que le projet va s'y ranger.
                      target?.kind === 'group' && target.id === entry.id && target.position === 'inside' && 'bg-raised',
                    )}
                  >
                    <Trait ou={marqueurDe(entry.id)} />
                    <EnteteGroupe
                      rowProps={rowProps(entry.id, 'group')}
                      dimmed={dragging?.id === entry.id}
                      signal={signal}
                      regarde={membresVus.some((p) => p.id === state.activeProjectId)}
                      bande={bandeSeule}
                      titre={entry.group.name}
                    >
                      {/* LE DOSSIER : sa flèche, son nom. Un clic le replie. */}
                      <button
                        onClick={() => toggle(entry.id)}
                        aria-expanded={!replie}
                        title={replie ? t('Déplier le groupe') : t('Replier le groupe')}
                        className="flex min-w-0 flex-1 items-center gap-2.5 text-left text-[14px] text-text"
                      >
                        <ChevronRight
                          className={cn('h-4 w-4 shrink-0 text-faint transition-transform', !replie && 'rotate-90')}
                        />
                        <span className="min-w-0 truncate">{entry.group.name}</span>
                      </button>
                      {/* Replié, le dossier porte ce que ses projets ont rendu sans
                          être lus ; un clic les marque consultés. */}
                      {replie && (signal.rendus ?? 0) > 0 ? (
                        <Tooltip label={libelleNonConsultees(signal.rendus ?? 0, true)}>
                          <button
                            type="button"
                            data-groupe-non-consultees={signal.rendus}
                            aria-label={libelleNonConsultees(signal.rendus ?? 0, true)}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation();
                              membresVus
                                .filter((p) => state.rendus[p.id])
                                .forEach((p) => client.call({ type: 'project.read', projectId: p.id }));
                            }}
                            className="h-2 w-2 shrink-0 rounded-full bg-faint"
                          />
                        </Tooltip>
                      ) : null}
                      {/* Replié, un membre qui publie ne se voit plus : le repère
                          remonte jusqu'à l'en-tête du dossier. */}
                      {replie && membresVus.some((p) => publieOf(p.id)) ? <RepereePublication publie /> : null}
                      {replie ? (
                        <RepereLigne
                          signal={{ attention: signal.attention }}
                          /* Replié, le dossier porte la nature de ce que ses membres
                             attendent : un seul repère, jamais deux côte à côte. */
                          icone={iconeDuLot(
                            state.decisions.filter((d) => !d.reglee && membresVus.some((p) => p.id === d.projectId)),
                          )}
                          /* Replié, le dossier emmène à la décision du premier de ses
                             projets qui en attend une. */
                          onDecision={() => {
                            const projet = membresVus.find((p) => state.attention[p.id]);
                            if (projet) allerALaDecision(projet.id, onChoose);
                          }}
                        />
                      ) : null}
                      {/* LES OUTILS DU DOSSIER, au survol seulement : le ranger
                          (poignée), le renommer, le supprimer. */}
                      <span
                        {...poigneeProps(entry.id, 'group', entry.group.name)}
                        title={t('Glisser pour ranger')}
                        className={cn(outilDeGroupe, 'cursor-grab touch-none active:cursor-grabbing')}
                      >
                        <GripVertical className="h-3.5 w-3.5" />
                      </span>
                      <button
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => setRenaming(entry.group)}
                        data-outil-groupe="renommer"
                        className={outilDeGroupe}
                        title={t('Renommer le groupe')}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => setDeleting(entry.group)}
                        data-outil-groupe="supprimer"
                        className={cn(
                          outilDeGroupe,
                          'hover:text-danger',
                          // Le groupe « Local » abrite Beluga : il ne se supprime pas.
                          localDuGroupe && 'hidden',
                        )}
                        title={t('Supprimer le groupe')}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </EnteteGroupe>

                    {!replie ? (
                      <div className={bandeSeule ? undefined : 'pl-3'}>
                        {/* FIXÉ EN TÊTE du groupe « Local » : aucune prise pour la
                            souris, les projets glissés ici se rangent sous lui. */}
                        {local ? (
                          <LigneEspaceDev
                            project={local}
                            active={local.id === state.activeProjectId && vue === 'projet'}
                            running={runningOf(local.id)}
                            publie={publieOf(local.id)}
                            attention={state.attention[local.id]}
                            rendus={state.rendus[local.id]}
                            icone={iconeAttenteOf(local.id)}
                            avancement={avancementOf(local.id)}
                            cibleDeCarte={cibleDeCarteDe(local.id)}
                            onSettings={() => ouvrirConfigProjet(local.id)}
                            bande={bandeSeule}
                            outilsCaches={outilsCaches}
                            onChoose={onChoose}
                            onQuitterTableauDeBord={() => onOuvrirVue('projet')}
                          />
                        ) : null}
                        {membresVus.length ? (
                          membres.map((project) =>
                            rendreLigne(project, {
                              style: glisse(decales.membres.has(project.id)),
                              marqueur: marqueurDe(project.id),
                              groupColor: entry.group.color,
                              emboite: true,
                            }),
                          )
                        ) : (
                          // Une seule ligne, jamais coupée ; INVISIBLE en colonne
                          // réduite (elle y débordait mot par mot) mais gardant sa
                          // hauteur, pour que les lignes suivantes ne sautent pas
                          // d'un mode à l'autre (MEM-2899).
                          <p
                            data-groupe-vide={entry.id}
                            aria-hidden={bandeSeule || undefined}
                            className={cn('truncate px-2.5 py-2 text-[13px] text-faint', bandeSeule && 'invisible')}
                          >
                            {t('Glissez un projet ici.')}
                          </p>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}

              {/* « Aucun projet inscrit » ne s'écrit que si la colonne n'en a
                  vraiment aucun. */}
              {bandeSeule ? null : !entries.length && !espaceDev ? (
                <p className="px-2.5 py-2 text-[13px] text-faint">{t('Aucun projet inscrit.')}</p>
              ) : null}
            </>
          )}

          {/* « MIS DE CÔTÉ » : un dernier dossier, replié, tout en bas de la
              liste. Caché tant que la colonne reste réduite. */}
          {!bandeSeule ? (
            <>
              <button onClick={() => setShowArchived((value) => !value)} className={cn(classeSection, 'mt-3')}>
                <span className="min-w-0 truncate">{t('Mis de côté')}</span>
                <ChevronRight className={cn('h-3 w-3 shrink-0 transition-transform', showArchived && 'rotate-90')} />
              </button>

              {showArchived ? (
                archived.length ? (
                  archived.map((project) => (
                    <div
                      key={project.id}
                      className="group flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[14px] text-faint hover:bg-raised"
                    >
                      <Folder className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{project.name}</span>
                      <button
                        onClick={() => client.call({ type: 'project.archive', id: project.id, archived: false })}
                        className="shrink-0 opacity-0 transition-opacity hover:text-text group-hover:opacity-100"
                        title={t('Remettre en service')}
                      >
                        <ArchiveRestore className="h-4 w-4" />
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="px-2.5 py-2 text-[13px] text-faint">{t('Aucun projet mis de côté.')}</p>
                )
              ) : null}
            </>
          ) : null}
        </ZoneDefilement>

        {/* LE PIED : l'état du moteur à gauche — « LLM en ligne », le compte en
            service, et les quotas au clic — et UN bouton à droite, les
            réglages. Rien d'autre. */}
        <div
          data-pied-colonne
          className={cn('flex shrink-0 gap-1', bandeSeule ? 'flex-col items-center px-0 pb-3 pt-2' : 'items-center px-2 pb-2.5 pt-1.5')}
        >
          {/* LE POINT DU MOTEUR NE DIT QUE LA LIAISON : plein quand elle tient,
              battant quand elle est rompue. */}
          <QuotaBadge
            activeEngine={moteurActif}
            variante={bandeSeule ? 'bande' : 'pied'}
            liaison={{ ...liaison, classe: liaison.enLigne ? 'bg-success' : 'animate-pulse-soft bg-text' }}
          />
          {/* LA CLOCHE DES NOTIFICATIONS, à côté des réglages (demande du
              12/10/2026) : sur ordinateur seulement — sur téléphone, elle
              reste en haut à droite de l'écran (`app.tsx`). */}
          {!telephone ? <ClocheNotifications className="h-9 w-9 shrink-0" /> : null}
          {onOpenSettings ? (
            <Tooltip label={t('Réglages')}>
              <Button
                variant="ghost"
                size="icon"
                className="relative h-9 w-9 shrink-0 text-muted"
                aria-label="Réglages"
                data-reglages-menu
                onClick={() => {
                  onOpenSettings();
                  onChoose?.();
                }}
              >
                <Settings className="h-4 w-4" />
                {/* UN REDÉMARRAGE ATTEND : le point le dit ici, sur le bouton
                    qui mène à son geste (réglages, « Serveur et agents »). */}
                <PointRedemarrage etat={redemarrage.etat} />
              </Button>
            </Tooltip>
          ) : null}
        </div>
      </div>

      {/* LES FENÊTRES RESTENT MONTÉES DANS LES DEUX ÉTATS : replier la colonne
          pendant qu'une d'elles est ouverte ne doit pas la faire disparaître. */}
      <ProjectsDialog
        open={adding}
        onClose={() => setAdding(false)}
        onOuvrirVue={onOuvrirVue}
        adresse={onChoose ? 'projets-du-serveur' : undefined}
      />
      <PromptDialog
        open={creatingGroup}
        title={t('Nouveau groupe')}
        description={t('Un rangement pour vous y retrouver : « Clients », « Mes projets », « Capitaux »…')}
        placeholder={t('Nom du groupe')}
        confirmLabel={t('Créer')}
        onConfirm={(nom) => client.call({ type: 'group.create', name: nom })}
        onClose={() => setCreatingGroup(false)}
      />

      <PromptDialog
        open={!!renaming}
        title={t('Renommer le groupe')}
        defaultValue={renaming?.name ?? ''}
        placeholder={t('Nom du groupe')}
        confirmLabel={t('Renommer')}
        onConfirm={(nom) => renaming && client.call({ type: 'group.update', id: renaming.id, name: nom })}
        onClose={() => setRenaming(null)}
      />

      <ConfirmDialog
        open={!!deleting}
        title={t('Supprimer le groupe « {v0} » ?', { v0: deleting?.name ?? '' })}
        description={t('Les projets qu\'il contient ne sont pas supprimés : ils remontent simplement hors groupe.')}
        confirmLabel={t('Supprimer le groupe')}
        danger
        onConfirm={() => deleting && client.call({ type: 'group.delete', id: deleting.id })}
        onClose={() => setDeleting(null)}
      />
    </aside>
  );
}

/**
 * La palette des groupes : seize teintes franches, plus « aucune ». Elle vit
 * dans `shared/src/gestion-projets.ts` — un agent qui règle un groupe par outil
 * choisit dans la MÊME palette que ce sélecteur, sinon la pastille posée par le
 * cadrage ne serait dans aucune case du nuancier.
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
          title={t('Couleur du groupe')}
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
          className="mt-2 w-full rounded bg-raised px-2 py-1 text-[12px] text-muted transition-colors hover:bg-border hover:text-text"
        >
          {t('Aucune couleur')}</button>
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
  bande = false,
  titre,
  children,
}: {
  rowProps: Record<string, unknown>;
  dimmed?: boolean;
  /** Ce que ses projets attendent, et ce qu'ils ont rendu sans être lus. */
  signal: SignalProjet;
  /** Le projet ouvert est-il DANS ce groupe ? Alors rien ne bouge. */
  regarde: boolean;
  /** La colonne est rétrécie : le titre se réduit à son initiale. */
  bande?: boolean;
  /** Le nom du groupe, dont l'initiale tient lieu de titre une fois rétréci. */
  titre?: string;
  children: React.ReactNode;
}) {
  const secoue = useSecousse(signal, regarde);
  return (
    <div
      {...rowProps}
      data-groupe-attention={signal.attention || undefined}
      data-groupe-rendus={signal.rendus || undefined}
      className={cn(
        // `min-h-9` FIXE : réduite à sa seule initiale, l'en-tête de groupe
        // était plus basse que son propre bouton de nom en mode ouvert (une
        // lettre tient dans moins de hauteur qu'un libellé) — chaque groupe
        // décalait d'autant tout ce qui suivait entre les deux modes.
        'group/g flex h-9 items-center gap-0.5 rounded-lg transition-colors hover:bg-raised',
        bande ? 'justify-center px-0' : 'pl-2.5 pr-1',
        dimmed && 'opacity-40',
        secoue && 'animate-secousse',
      )}
    >
      {/* RÉTRÉCI, LE TITRE TIENT EN UNE LETTRE. Le groupe garde sa place et son
          ordre — c'est la même structure qu'en large —, et son nom entier
          revient dès que le menu se déplie au survol. */}
      {bande ? (
        <span
          className="text-[10px] font-semibold uppercase leading-none text-faint"
          data-groupe-initiale
          title={titre}
        >
          {(titre ?? '').trim().slice(0, 1) || '—'}
        </span>
      ) : (
        children
      )}
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
 * Rien de tout ça n'est vrai : le repère ne s'affiche pas (`null`), pour
 * laisser sa place au repère de repos de l'appelant (favicon du projet,
 * outil de l'espace de développement…) — sur une ligne de projet, il vient
 * s'AJOUTER entre ce repère de repos et le nom, jamais le remplacer.
 *
 * En variante `mini` (une ligne de projet ordinaire), il ne s'ajoute plus à
 * côté du favicon — ce qui élargissait le bouton en colonne réduite — mais se
 * pose EN INCRUSTATION sur son coin haut droit.
 *
 * UN SEUL REPÈRE À LA FOIS, dans l'ordre de ce qui compte le plus : une
 * publication en cours, puis une réponse attendue (question, plan, décision —
 * `icone`, la même table que lit `RepereLigne`), puis un vrai travail en
 * cours, puis un rapport rendu pas encore consulté (`rendus`), et enfin rien.
 * Un agent encore associé au projet mais arrêté sur une question ne « travaille »
 * plus au sens de ce badge : c'est l'utilisateur qu'on attend.
 */
function RepereRobot({
  running,
  publie,
  icone,
  rendus,
  mini = false,
}: {
  running: number;
  publie?: boolean;
  /**
   * LA NATURE DE CE QUI ATTEND sur ce projet (`iconeAttenteOf`). Prime sur la
   * roue : un agent techniquement encore associé au projet, mais arrêté sur
   * une question ou un plan, ne « travaille » pas au sens où l'utilisateur
   * l'entend — c'est LUI qu'on attend, pas l'inverse.
   */
  icone?: IconeDAttention | null;
  /** Rendu et pas encore consulté — montré seulement quand rien de plus urgent n'attend. */
  rendus?: number;
  /** Incrustation sur le coin de l'icône, au lieu d'un ajout à côté d'elle. */
  mini?: boolean;
}) {
  // En incrustation (`mini`), le repère se fond sinon dans les couleurs du
  // favicon en dessous : chaque état pose donc une pastille pleine de sa
  // propre couleur, avec son dessin en blanc par-dessus — jamais un dessin
  // transparent posé à même le logo.
  const pastilleMini = 'flex h-3 w-3 items-center justify-center rounded-full shadow-sm';
  if (publie) {
    return (
      <Tooltip label={t('Publication en cours')}>
        <span
          className={cn(
            'flex shrink-0 items-center gap-0.5',
            mini && cn(pastilleMini, 'absolute -right-[7px] -top-[6px] bg-publie'),
          )}
          data-repere-robot
          aria-label="Publication en cours"
        >
          <UploadCloud
            className={cn(
              'shrink-0 animate-pulse-soft motion-reduce:animate-none',
              mini ? 'h-2 w-2 text-sur-etat' : 'h-[15px] w-[15px] text-publie',
            )}
          />
        </span>
      </Tooltip>
    );
  }
  if (icone) {
    const libelle =
      icone === 'message'
        ? t('Une question attend votre réponse')
        : icone === 'plan'
          ? t('Un plan attend votre geste')
          : t('Une décision attend votre geste');
    return <RepereAttention compte={1} icone={icone} libelle={libelle} badge={{ mini }} />;
  }
  if (running) {
    const libelle = running > 1 ? `${running} agents au travail` : t('Un agent au travail');
    return (
      <Tooltip label={libelle}>
        <span
          className={cn(
            'flex shrink-0 items-center gap-0.5',
            mini && cn(pastilleMini, 'absolute -right-[7px] -top-[6px] bg-en-cours'),
          )}
          data-repere-robot
          aria-label={libelle}
        >
          <Loader2
            className={cn(
              'shrink-0 animate-spin motion-reduce:animate-none',
              mini ? 'h-2 w-2 text-sur-etat' : 'h-[15px] w-[15px] text-en-cours',
            )}
          />
          {!mini && running >= 1 ? <span className="text-[10.5px] leading-none text-en-cours">{running}</span> : null}
        </span>
      </Tooltip>
    );
  }
  if (rendus) {
    const libelle = libelleNonConsultees(rendus);
    return (
      <Tooltip label={libelle}>
        <span
          className={cn(
            'flex shrink-0 items-center gap-0.5',
            mini && cn(pastilleMini, 'absolute -right-[7px] -top-[6px] cursor-pointer bg-termine'),
          )}
          data-repere-robot
          data-repere-rendus
          aria-label={libelle}
        >
          <FileCheck2 className={cn('shrink-0', mini ? 'h-2 w-2 text-sur-etat' : 'h-[15px] w-[15px] text-termine')} />
          {!mini ? <span className="text-[10.5px] leading-none text-termine">{texteDuCompteur(rendus)}</span> : null}
        </span>
      </Tooltip>
    );
  }
  return null;
}

function libelleNonConsultees(n: number, groupe = false): string {
  const base =
    n > 1 ? t('{n} cartes avec un rendu non consulté', { n }) : t('Une carte avec un rendu non consulté');
  return groupe
    ? t('{v0} — cliquez pour tout marquer comme consulté', { v0: base })
    : t('{v0} — cliquez pour l’ouvrir', { v0: base });
}

/**
 * LE BADGE BLEU D'UNE LIGNE MÈNE À SA CARTE. Il vit DANS le bouton du projet
 * (un bouton n'en contient pas un autre, et sortir le badge décalerait l'icône
 * en colonne réduite) : le bouton regarde donc où le clic est tombé. Sur le
 * badge `data-repere-rendus`, il ouvre la carte non lue la plus récente
 * (`ouvrirCarteNonLue`) ; ailleurs, il garde son geste d'origine.
 */
function clicSurLeBadgeRendu(event: React.MouseEvent): boolean {
  return !!(event.target as Element | null)?.closest?.('[data-repere-rendus]');
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
    <Tooltip label={t('Publication en cours')}>
      <span
        aria-label="Publication en cours"
        data-repere-publication
        className="h-2 w-2 shrink-0 rounded-full bg-publie animate-pulse-soft motion-reduce:animate-none"
      />
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
    <Tooltip label={t('{done} étape{v0} faite{v1} sur {total}', { done, v0: done > 1 ? 's' : '', v1: done > 1 ? 's' : '', total })}>
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
 * La colonne ne lui passe plus que la décision : le travail rendu vit dans le
 * repère posé sur l'icône du projet (`RepereRobot`).
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
  const lieu = premiereDecision(client.lireEtat().decisions, projectId);
  if (!lieu) return;
  /*
   * LE MÊME CHEMIN QUE LA CLOCHE ET QUE LA NOTIFICATION POUSSÉE. Ce triangle
   * ouvrait la carte ou la conversation lui-même, et ne savait donc ni
   * réclamer un fil que l'écran n'a pas chargé, ni conduire jusqu'à la BULLE
   * qui porte la question. Une seule route pour les trois entrées.
   */
  client.allerVersDecision(lieu);
}

function RepereLigne({
  signal,
  icone,
  onDecision,
  className,
}: {
  signal: SignalProjet;
  /**
   * LA NATURE DE CE QUI ATTEND, choisie par la table partagée
   * (`iconeDuLot`). Absente : le triangle, comme avant.
   */
  icone?: IconeDAttention | null;
  /** Emmener à l'endroit où la décision se prend. */
  onDecision?: () => void;
  /** Décalage doux appliqué au repère (glissement au survol). */
  className?: string;
}) {
  const quoi = repereVisible(signal);
  if (!quoi) return null;

  if (quoi === 'attention') {
    const compte = signal.attention ?? 0;
    const libelle = t('{v0} — cliquez pour y aller', { v0: libelleAttention(compte) });
    /*
     * Le triangle EMMÈNE : c'est le chaînon qui manquait. Annoncer « 4
     * décisions attendues » sans dire où elles se prennent revenait à montrer
     * un chiffre introuvable. Un clic ouvre la première, la plus ancienne.
     */
    return (
      <RepereAttention
        compte={compte}
        icone={icone}
        libelle={libelle}
        className={className}
        onClick={() => onDecision?.()}
      />
    );
  }

  return null;
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
 * bord que la ligne colorée du groupe. Un membre de projet réuni (« reuni »)
 * est décalé du retrait des branches (24 px au repos, 36 px sur téléphone,
 * 20 px outils cachés).
 */
function RepereDemiRond({
  active,
  couleur,
  emboite,
  bande,
  outilsCaches,
}: {
  active?: boolean;
  /** La couleur du groupe du projet, si réglée. */
  couleur?: string;
  /** Le projet est rangé dans un groupe (« pl-3 »), ou dans un projet réuni. */
  emboite?: boolean | 'reuni';
  bande?: boolean;
  outilsCaches?: boolean;
}) {
  /* PLUS DE BARRE NI DE DEMI-ROND : la ligne ouverte se dit par son fond gris,
     comme dans ChatGPT. Le repère reste dans le document, invisible, pour les
     contrôles qui s'en servent pour trouver la ligne ouverte. */
  void couleur;
  void emboite;
  void bande;
  void outilsCaches;
  if (!active) return null;
  return <span aria-hidden data-repere-demi-rond className="hidden" />;
}

/**
 * LA BRANCHE D'ARBORESCENCE D'UN MEMBRE DE PROJET RÉUNI : un trait vertical qui
 * descend du milieu bas de la pile d'icônes du projet réuni, et un trait
 * horizontal qui touche l'icône du membre. Chez le dernier membre, le vertical
 * s'arrête à hauteur de son icône et tourne en coude arrondi.
 *
 * Géométrie, en px, relative à l'enveloppe du membre (voir le retrait posé par
 * `data-membres-regroupement`) : l'icône du membre commence à 7 (bord 1 +
 * `px-1.5`), son milieu est à 17 (bord 1 + `py-1.5` 6 + moitié de `h-5`) ; le
 * milieu de la pile du parent est à `largeurPile / 2 - 13`, quel que soit le
 * retrait ; le bas de la pile tombe 11,5 px au-dessus du premier membre.
 * Absolue, sans pointeur ni hauteur : la ligne garde sa hauteur fixe.
 */
function BrancheMembre({ premier, dernier, largeurPile }: { premier: boolean; dernier: boolean; largeurPile: number }) {
  /* L'axe vertical tombe sous le MILIEU de la pile d'icônes du projet réuni
     (elle commence à 10 px : `px-2.5`), vu depuis l'enveloppe des membres,
     décalée de `RETRAIT_DES_MEMBRES`. Le trait horizontal s'arrête 2 px avant
     l'icône du membre (elle aussi à 10 px), au milieu de sa ligne de 36 px. */
  const axe = 10 + largeurPile / 2 - RETRAIT_DES_MEMBRES;
  const haut = premier ? -9 : 0;
  const trait = CLASSE_TRAIT_DE_BRANCHE;
  return (
    <span aria-hidden data-branche-membre={dernier ? 'dernier' : 'milieu'}>
      {dernier ? (
        <span
          className={cn(trait, 'rounded-bl-[5px] border-b border-l')}
          style={{ left: axe, top: haut, height: 18 - haut, width: 8 - axe }}
        />
      ) : (
        <>
          <span className={cn(trait, 'bottom-0 border-l')} style={{ left: axe, top: haut }} />
          <span className={cn(trait, 'border-t')} style={{ left: axe, top: 17, width: 8 - axe }} />
        </>
      )}
    </span>
  );
}

/** Le retrait, en pixels, des membres d'un projet réuni sous sa ligne (`pl-4`). */
const RETRAIT_DES_MEMBRES = 16;

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
 * « Beluga » : l'espace de développement de l'application, fixé en tête de
 * son groupe « Local ».
 *
 * Le projet posé sur le dossier de Beluga Build (marque `isSelf`) n'est pas un
 * projet client : c'est l'atelier où l'outil lui-même évolue. Il quitte donc le
 * RANGEMENT — plus de poignée, pas de `data-drag-id` : on ne peut ni le
 * déplacer ni le sortir de son groupe (`data-espace-dev-verrouille`) — pour
 * occuper la PREMIÈRE place du groupe « Local » (`shared/src/groupe-local.ts`),
 * ou, sans ce groupe, celle de la liste sous le libellé « Projets ». Il REÇOIT en revanche une carte glissée du
 * tableau, exactement comme une ligne de projet (`data-projet-cible`) : c'est
 * le seul geste de souris qui lui reste, et il s'éclaire pendant le survol. Il porte l'icône de l'application
 * (`/icon.svg`, le beluga du favicon), qui le distingue d'un coup d'œil de
 * toutes les autres lignes. Rien d'autre ne change : même identifiant, mêmes cartes, même
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
  icone,
  rendus,
  avancement,
  cibleDeCarte,
  onSettings,
  onChoose,
  onQuitterTableauDeBord,
  bande = false,
  outilsCaches = false,
}: {
  /** Sur téléphone, interrupteur éteint : le réglage de la ligne se cache. */
  outilsCaches?: boolean;
  /** La colonne est rétrécie : plus que l'icône, le nom passant en bulle. */
  bande?: boolean;
  project: Project;
  active: boolean;
  running: number;
  publie?: boolean;
  attention?: number;
  /** La nature de ce qui attend sur ce projet (`iconeDuLot`). */
  icone?: IconeDAttention | null;
  rendus?: number;
  /** L'avancement des cartes en cours, pour la même place que le triangle de décision. */
  avancement?: AvancementColonne | null;
  /** Une carte survole cette ligne : permise (elle s'éclaire) ou refusée (inerte). */
  cibleDeCarte?: 'acceptee' | 'refusee' | null;
  onSettings: () => void;
  onChoose?: () => void;
  /** Le tableau de bord occupe la place : un clic ici doit le refermer. */
  onQuitterTableauDeBord?: () => void;
}) {
  const secoue = useSecousse({ attention, rendus }, active);
  void avancement;
  const ouvrir = (event: React.MouseEvent) => {
    if (rendus && clicSurLeBadgeRendu(event)) void client.ouvrirCarteNonLue(project.id);
    else client.setActiveProject(project.id);
    onQuitterTableauDeBord?.();
    onChoose?.();
  };
  return (
    <div
      data-espace-dev={project.id}
      data-actif={active || undefined}
      // IMMUABLE AU RANGEMENT, MAIS PAS INERTE. La ligne ne se glisse pas et
      // n'entre dans aucun groupe (`data-espace-dev-verrouille`, aucun
      // `data-drag-id`) — en revanche elle REÇOIT une carte comme toute autre
      // ligne de projet : c'est ce que dit `data-projet-cible`, lu par
      // `resolve` dans `board.tsx` pendant un glissement de carte.
      data-espace-dev-verrouille="oui"
      data-projet-cible={project.id}
      data-projet-survole={cibleDeCarte ?? undefined}
      draggable={false}
      data-espace-dev-attention={attention || undefined}
      data-espace-dev-rendus={rendus || undefined}
      className={cn(
        CLASSE_LIGNE_DE_PROJET,
        bande ? 'justify-center px-0' : 'pl-2.5 pr-1',
        active ? 'bg-ligne-active text-teinte' : 'hover:bg-raised',
        secoue && 'animate-secousse',
        cibleDeCarte === 'acceptee' && 'bg-raised ring-1 ring-inset ring-faint',
        cibleDeCarte === 'refusee' && 'opacity-50',
      )}
    >
      <RepereDemiRond active={active} />
      <button
        data-ouvrir-espace-dev
        onClick={ouvrir}
        title={t('{v0} — l’espace où l’application elle-même est développée', { v0: project.name })}
        className={cn('flex h-9 min-w-0 items-center gap-2.5 text-left', bande ? 'justify-center' : 'flex-1')}
      >
        {/* L'ICÔNE DE L'APPLICATION RESTE TOUJOURS LÀ. L'état (un agent
            travaille, une publication part, une réponse attend) se pose EN
            INCRUSTATION sur son coin (`RepereRobot mini`). */}
        <span className="relative inline-flex shrink-0 items-center">
          <img src="/icon.svg" alt="" aria-hidden data-espace-dev-favicon className="h-[15px] w-[15px] shrink-0 rounded-[3px]" />
          {running || publie || icone || rendus ? (
            <RepereRobot running={running} publie={publie} icone={icone} rendus={rendus} mini />
          ) : null}
        </span>
        <span className={cn('min-w-0 flex-1 truncate', bande && 'sr-only')}>{project.name}</span>
      </button>
      {/* Hors du bouton : le repère de décision porte son propre geste, et un
          bouton n'en contient pas un autre. */}
      {bande ? (
        repereVisible({ attention }) ? (
          <span
            className="pointer-events-none absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-text"
            data-alerte-projet={project.id}
            aria-hidden
          />
        ) : null
      ) : repereVisible({ attention }) ? (
        <RepereLigne
          signal={{ attention }}
          icone={icone}
          onDecision={() => {
            onQuitterTableauDeBord?.();
            allerALaDecision(project.id, onChoose);
          }}
        />
      ) : null}
      <button
        onClick={onSettings}
        data-reglages-projet={project.id}
        className={cn(CLASSE_OUTIL_DE_LIGNE, (outilsCaches || bande) && 'hidden')}
        title={t('Réglages de l’espace de développement')}
      >
        <EllipsisVertical className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * LA TENUE D'UNE LIGNE DE PROJET : une icône, un nom, 36 px de haut, un fond
 * gris au survol et sur la ligne ouverte. Aucun cadre, aucun compteur. Les
 * outils (réglages, poignée) ne paraissent qu'au survol, à droite.
 */
const CLASSE_LIGNE_DE_PROJET =
  'group relative flex h-9 w-full items-center gap-0.5 rounded-lg text-[14px] text-text transition-[transform,background-color] duration-150 motion-reduce:transition-none';
const CLASSE_OUTIL_DE_LIGNE =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-faint transition-opacity hover:bg-border hover:text-text survol:opacity-0 group-hover:survol:opacity-100';

function ProjectRow({
  project,
  active,
  running,
  publie,
  attention,
  icone,
  rendus,
  avancement,
  dimmed,
  cibleDeCarte,
  style,
  marqueur,
  rowProps,
  poigneeProps,
  onSettings,
  onChoose,
  groupColor,
  emboite,
  bande = false,
  outilsCaches = false,
  sousGroupe,
  sansPoignee = false,
}: {
  /** Sur téléphone, interrupteur éteint : poignée et réglages se cachent. */
  outilsCaches?: boolean;
  /**
   * CETTE LIGNE EST UN PROJET RÉUNI : elle porte la flèche de son sous-groupe.
   * Un clic sur son nom ouvre le tableau commun SANS déplier ni replier ses
   * membres : seule la flèche de droite bascule le sous-groupe.
   */
  sousGroupe?: { ouvert: boolean; nombre: number; membres: Project[]; basculer: (ouvrir?: boolean) => void };
  /** Un membre de projet réuni ne se glisse pas : pas de poignée. */
  sansPoignee?: boolean;
  /**
   * LA COLONNE EST RÉTRÉCIE : la ligne se réduit à son icône, son nom vivant
   * dans une bulle au survol. Elle RESTE dans le document — c'est bien le même
   * projet, à la même place, dans le même ordre : rien ne disparaît, et le
   * dépliage au survol le rend tel quel.
   */
  bande?: boolean;
  project: Project;
  active: boolean;
  running: number;
  /** Une publication de ce projet est-elle en cours ? */
  publie?: boolean;
  attention?: number;
  /** La nature de ce qui attend sur ce projet (`iconeDuLot`). */
  icone?: IconeDAttention | null;
  /** Réponses rendues et pas encore lues sur ce projet. */
  rendus?: number;
  /** L'avancement des cartes en cours, pour la même place que le triangle de décision. */
  avancement?: AvancementColonne | null;
  dimmed?: boolean;
  /**
   * UNE CARTE DU TABLEAU EST EN VOL AU-DESSUS DE CETTE LIGNE.
   * « acceptee » : le dépôt se fera — la ligne s'éclaire. « refusee » : la
   * ligne reste inerte, et le motif s'affichera au relâchement.
   */
  cibleDeCarte?: 'acceptee' | 'refusee' | null;
  /** La couleur du groupe qui range ce projet, pour le demi-rond du projet ouvert. */
  groupColor?: string;
  /** Le projet est rangé dans un groupe (décalage « pl-3 » à rattraper), ou dans un projet réuni. */
  emboite?: boolean | 'reuni';
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
  void avancement;
  void groupColor;
  void emboite;
  return (
    <div
      {...rowProps}
      style={style}
      data-projet-attention={attention || undefined}
      data-projet-rendus={rendus || undefined}
      /* La ligne du projet OUVERT : son nom s'écrit en violet (`text-teinte`). */
      data-actif={active || undefined}
      /* LA LIGNE EST UNE DESTINATION POUR UNE CARTE TIRÉE DU TABLEAU. Le repère
         est posé en permanence : il n'est lu que pendant un glissement de carte
         (`resolve`, `board.tsx`), et le rangement des projets entre eux, lui,
         passe par la poignée et son propre mécanisme. */
      data-projet-cible={project.id}
      data-projet-survole={cibleDeCarte ?? undefined}
      className={cn(
        CLASSE_LIGNE_DE_PROJET,
        bande ? 'justify-center px-0' : 'pl-2.5 pr-1',
        // La ligne reste NUE : ni cadre ni couleur. L'état ne vit que sur
        // l'icône (`RepereRobot`) et sur le repère de droite (`RepereLigne`).
        active ? 'bg-ligne-active text-teinte' : 'hover:bg-raised',
        dimmed && 'opacity-40',
        secoue && 'animate-secousse',
        cibleDeCarte === 'acceptee' && 'bg-raised ring-1 ring-inset ring-faint',
        cibleDeCarte === 'refusee' && 'opacity-50',
      )}
    >
      <Trait ou={marqueur} />
      <RepereDemiRond active={active} />
      <button
        onClick={(event) => {
          if (rendus && clicSurLeBadgeRendu(event)) {
            // Un projet réuni REPLIÉ compte aussi les rendus de ses membres.
            const membres = sousGroupe && !sousGroupe.ouvert ? sousGroupe.membres.map((m) => m.id) : [];
            void client.ouvrirCarteNonLue(project.id, membres);
          } else client.setActiveProject(project.id);
          // Choisir, c'est aussi refermer : même quand c'est déjà le projet
          // affiché, le panneau ne doit pas rester ouvert sur un choix fait.
          onChoose?.();
        }}
        title={bande ? project.name : undefined}
        className={cn('flex h-9 min-w-0 items-center gap-2.5 text-left', bande ? 'justify-center' : 'flex-1')}
      >
        {/* L'icône du projet (ou ses initiales) reste TOUJOURS en premier, à sa
            taille et sa place fixes : c'est la seule couleur de la ligne.
            L'état se pose EN INCRUSTATION sur son coin haut droit. */}
        <span className="relative inline-flex shrink-0 items-center">
          {/* Un projet réuni montre la pile des icônes de ses membres. */}
          {sousGroupe?.membres.length ? (
            <PastillesEmpilees projects={sousGroupe.membres} />
          ) : (
            <PastilleProjet project={project} />
          )}
          {running || publie || icone || rendus ? (
            <RepereRobot running={running} publie={publie} icone={icone} rendus={rendus} mini />
          ) : null}
        </span>
        {/* LE NOM RESTE LISIBLE AUX OUTILS D'ASSISTANCE même rétréci : il passe
            en `sr-only`, il ne disparaît pas du document. */}
        <span className={cn('min-w-0 flex-1 truncate', bande && 'sr-only')}>{project.name}</span>
      </button>
      {/* Le repère de décision vit HORS du bouton du nom : il porte son propre
          geste, et un bouton n'en contient pas un autre. */}
      {bande ? (
        /* UNE ALERTE NE SE CACHE JAMAIS DERRIÈRE LE REPLI : un point la dit. */
        repereVisible({ attention }) ? (
          <span
            className="pointer-events-none absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-text"
            data-alerte-projet={project.id}
            aria-hidden
          />
        ) : null
      ) : repereVisible({ attention }) ? (
        <RepereLigne icone={icone} signal={{ attention }} onDecision={() => allerALaDecision(project.id, onChoose)} />
      ) : null}
      {/* LES OUTILS DE LA LIGNE, au survol seulement : la poignée qui la range,
          puis les réglages du projet. */}
      <span
        {...poigneeProps}
        title={t('Glisser pour ranger')}
        className={cn(
          CLASSE_OUTIL_DE_LIGNE,
          'cursor-grab touch-none active:cursor-grabbing',
          (outilsCaches || bande || sansPoignee) && 'hidden',
        )}
        data-poignee-projet={project.id}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </span>
      <button
        onPointerDown={(event) => event.stopPropagation()}
        onClick={onSettings}
        data-reglages-projet={project.id}
        className={cn(CLASSE_OUTIL_DE_LIGNE, (outilsCaches || bande) && 'hidden')}
        title={t('Réglages du projet')}
      >
        <EllipsisVertical className="h-4 w-4" />
      </button>
      {/* La flèche du sous-groupe, à DROITE, comme celle d'un dossier. */}
      {sousGroupe && !bande ? (
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => sousGroupe.basculer()}
          data-deplier-regroupement={project.id}
          className="flex h-7 w-6 shrink-0 items-center justify-center rounded-md text-faint hover:text-text"
          title={sousGroupe.ouvert ? t('Replier les projets réunis') : t('Déplier les projets réunis')}
        >
          <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', sousGroupe.ouvert && 'rotate-90')} />
        </button>
      ) : null}
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

function ProjectsDialog({
  open,
  onClose,
  onOuvrirVue,
  adresse,
}: {
  open: boolean;
  onClose: () => void;
  onOuvrirVue: (vue: VueCentrale) => void;
  /** Le nom du volet dans l'adresse, quand la colonne ne le tient pas elle-même. */
  adresse?: string;
}) {
  /*
   * UNE FOIS LE PROJET MONTÉ, ON ENTRE DEDANS : il devient le projet regardé,
   * le centre revient à son tableau, et sa carte « Cahier des charges » s'ouvre
   * quand on l'a demandée. Si la réponse n'a pas pu emporter l'identifiant de
   * la carte (pose plus lente que prévu), on ouvre celle qui arrive.
   */
  const entrerDansLeProjet = (projectId: string, cahierCardId: string | undefined, cahierDemande: boolean) => {
    client.setActiveProject(projectId);
    onOuvrirVue('projet');
    if (cahierCardId) {
      client.openCard(cahierCardId);
      return;
    }
    if (!cahierDemande) return;
    const fin = Date.now() + 20_000;
    const guetter = () => {
      const carte = Object.values(client.lireEtat().cards).find((c) => c.projectId === projectId && c.cahierDesCharges);
      if (carte) client.openCard(carte.id);
      else if (Date.now() < fin) window.setTimeout(guetter, 500);
    };
    guetter();
  };
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
  /* Les deux mêmes descriptions de mise en ligne : les deux chemins d'arrivée
     dans l'application offrent la même chose. */
  const [etapesGithub, setEtapesGithub] = React.useState<Etape[] | null>(null);

  const [newName, setNewName] = React.useState('');
  const [newFolder, setNewFolder] = React.useState('');
  const [newRemote, setNewRemote] = React.useState('');
  const [newResume, setNewResume] = React.useState('');
  const [withGit, setWithGit] = React.useState(true);
  const [withGithub, setWithGithub] = React.useState(true);
  /* « Démarrer par un cahier des charges » : cochée d'office pour un projet
     VIDE, décochée pour un dépôt importé, qui contient souvent déjà une
     application (`caseCahierCocheeParDefaut`). */
  const [withCahier, setWithCahier] = React.useState(caseCahierCocheeParDefaut('vide'));
  const [ghCahier, setGhCahier] = React.useState(caseCahierCocheeParDefaut('github'));
  /* L'adresse publique se demande ICI, au montage : un projet monté sans elle
     est un projet dont le déploiement n'a rien à contrôler à la fin. */
  const [newSousDomaine, setNewSousDomaine] = React.useState('');
  const [newPort, setNewPort] = React.useState('');
  /* CE QUE L'UTILISATEUR DIT DE SA MISE EN LIGNE, demandé ICI parce que c'est
     le seul moment où il y pense : où ça part, et selon quelles consignes. Les
     deux sont FACULTATIFS — vides, le projet se monte exactement comme avant —
     et se relisent ensuite dans les réglages du projet. */
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
      setFound((current) => current.filter((f) => f.path !== entry.path));
      client.pushToast('success', t('« {v0} » ajouté', { v0: entry.name }));
      onClose();
      entrerDansLeProjet(data.project.id, undefined, false);
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
      const data = await client.call<{ project: { id: string }; etapes?: Etape[]; cahierCardId?: string }>(
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
          cahierDesCharges: withCahier,
        },
        /* La création de l'adresse attend que le nom soit visible sur Internet :
           le montage peut donc durer plus longtemps qu'avant. */
        300000,
      );
      setEtapes(data.etapes ?? []);
      setNewName('');
      setNewFolder('');
      setNewRemote('');
      setNewResume('');
      setNewSousDomaine('');
      setNewPort('');
      /* La fenêtre reste ouverte tant qu'une étape a échoué : c'est le seul
         endroit où l'on peut lire laquelle et pourquoi. Sinon elle se referme
         et l'on arrive dans le projet, sur sa carte du cahier. */
      const toutFait = (data.etapes ?? []).every((etape) => etape.fait);
      if (toutFait) {
        onClose();
        entrerDansLeProjet(data.project.id, data.cahierCardId, withCahier);
      } else client.setActiveProject(data.project.id);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('création impossible'));
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
      .catch((err: any) => setDepotsErreur(err?.message ?? t('les dépôts GitHub sont illisibles')))
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
      const data = await client.call<{ project: { id: string }; etapes?: Etape[]; cahierCardId?: string }>(
        {
          type: 'project.fromGithub',
          lien: lu.depot.slug,
          sousDomaine: ghSousDomaine.trim() || undefined,
          port: ghPort ? Number(ghPort) : undefined,
          cahierDesCharges: ghCahier,
        },
        /* Récupérer un dépôt puis créer son adresse peut durer : on laisse le
           temps du clone, sinon un gros dépôt passerait pour une panne. */
        600000,
      );
      setEtapesGithub(data.etapes ?? []);
      setLienGithub('');
      setGhSousDomaine('');
      setGhPort('');
      setDepots((current) => current.filter((depot) => depot.slug !== lu.depot!.slug));
      /* La fenêtre reste ouverte tant qu'une étape a échoué : c'est le seul
         endroit où l'on peut lire laquelle et pourquoi. */
      if ((data.etapes ?? []).every((etape) => etape.fait)) {
        onClose();
        entrerDansLeProjet(data.project.id, data.cahierCardId, ghCahier);
      } else client.setActiveProject(data.project.id);
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
      {/* LES TROIS CHOIX, FIXÉS SOUS LE TITRE : le composant d'onglets de
          l'application, en pleine largeur et en trois parts égales ; seul le
          contenu dessous défile. La racine des onglets enveloppe le volet pour
          que la liste (dans l'entête) et les contenus (dans le corps) partagent
          le même choix (le volet part en portail, le contexte le suit). */}
      <Tabs value={onglet} onValueChange={setOnglet}>
        <DialogContent className="sm:w-[min(640px,100%)]" adresse={adresse} data-projets-du-serveur>
        <DialogHeader
          sous={
            <TabsList className="mt-2 w-full" data-onglets-projets-du-serveur>
              <TabsTrigger value="existing" className="flex-1">{t('Déjà sur le serveur')}</TabsTrigger>
              <TabsTrigger value="github" className="flex-1">{t('Depuis GitHub')}</TabsTrigger>
              <TabsTrigger value="new" className="flex-1">{t('Nouveau projet')}</TabsTrigger>
            </TabsList>
          }
        >
          <DialogTitle>{t('Projets du serveur')}</DialogTitle>
        </DialogHeader>

          <TabsContent value="existing" className="mt-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-faint" />
              <Input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={t('Chercher un projet…')}
                className="pl-7"
              />
            </div>

            {loading ? (
              <p className="mt-3 flex items-center gap-1.5 text-[13.5px] text-faint">
                <Loader2 className="h-3 w-3 animate-spin" />  {t('Lecture des dossiers du serveur…')}
</p>
            ) : visible.length ? (
              <>
                <p className="mt-2 text-[12.5px] text-faint">
                  {t('{v0} projet{v1} trouvé{v2} et pas encore suivi{v3}.', { v0: visible.length, v1: visible.length > 1 ? 's' : '', v2: visible.length > 1 ? 's' : '', v3: visible.length > 1 ? 's' : '' })}</p>
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
                          {entry.git ? t(' · suivi par git') : ''}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === entry.path}
                        onClick={() => addExisting(entry)}
                      >
                        {busy === entry.path ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                        
{t('Suivre')}
</Button>
                    </div>
                  ))}
                </ZoneDefilement>
              </>
            ) : (
              <p className="mt-3 text-[13.5px] text-faint">{t('Tous les projets du serveur sont déjà dans votre liste.')}</p>
            )}
          </TabsContent>

          <TabsContent value="github" className="mt-3 space-y-2.5">
            {/* L'adresse publique se demande AVANT le montage, ici comme pour un projet neuf. */}
            <div data-adresse-depuis-github>
              <div className="flex items-center gap-1">
                <Label>{t('Adresse publique du projet (facultatif)')}</Label>
                <BulleInfo cote="start">
                  {t('Le nom et le port sur lequel le projet écoutera. Ils sont demandés avant le montage : c\'est cette adresse qui sera contrôlée à la fin de chaque déploiement. Laissés vides, le projet est ajouté sans adresse.')}
                </BulleInfo>
              </div>
              <div className="mt-1 flex items-center gap-1.5">
                <Input
                  value={ghSousDomaine}
                  onChange={(event) => setGhSousDomaine(event.target.value)}
                  placeholder="nom-du-site"
                  className="flex-1"
                  data-sous-domaine-github
                />
                <span className="shrink-0 text-[12.5px] text-faint" data-zone-des-projets>.{zoneDesProjets() || t('domaine à régler')}</span>
                <Input
                  value={ghPort}
                  onChange={(event) => setGhPort(event.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="port"
                  className="w-[74px]"
                  data-port-github
                />
              </div>
            </div>


            <div className="border-t border-border pt-2.5">
              <Label>{t('Vos dépôts GitHub{v0}', { v0: compteGithub ? ` (compte ${compteGithub})` : '' })}</Label>
              <div className="relative mt-1">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-faint" />
                <Input
                  value={chercheDepot}
                  onChange={(event) => setChercheDepot(event.target.value)}
                  placeholder={t('Chercher un dépôt…')}
                  className="pl-7"
                  data-recherche-depot
                />
              </div>

              {loading && !depots.length ? (
                <p className="mt-2 flex items-center gap-1.5 text-[13.5px] text-faint">
                  <Loader2 className="h-3 w-3 animate-spin" />  {t('Lecture des dépôts du compte GitHub…')}
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
                          {depot.prive ? t('privé') : 'public'}
                          {depot.vide ? t(' · vide') : ''}
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
                        
{t('Ajouter')}
</Button>
                    </div>
                  ))}
                </ZoneDefilement>
              ) : (
                <p className="mt-2 text-[13.5px] text-faint">
                  {depots.length ? t('Aucun dépôt ne correspond à cette recherche.') : t('Aucun dépôt trouvé sur ce compte.')}
                </p>
              )}
            </div>

            <div className="border-t border-border pt-2.5">
              <div className="flex items-center gap-1">
                <Label>{t('Ou collez le lien d\'un dépôt')}</Label>
                <BulleInfo cote="start">
                  {t('Pour un dépôt qui n\'appartient pas à ce compte. Le dépôt est récupéré sur le serveur et le projet apparaît dans la liste de gauche. Rien n\'est publié ni mis en ligne au passage.')}
                </BulleInfo>
              </div>
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
                  
{t('Ajouter')}
</Button>
              </div>
            </div>

            <label className="flex items-center gap-2 text-[14px] text-muted" data-case-cahier="github">
              <Switch checked={ghCahier} onCheckedChange={setGhCahier} />
              <span>{t('Démarrer par un cahier des charges')}</span>
            </label>

            {etapesGithub ? <DerouleDesEtapes etapes={etapesGithub} /> : null}
          </TabsContent>

          <TabsContent value="new" className="mt-3 space-y-2.5">
            <FormulaireEnColonnes>
              <LigneFormulaire libelle={t('Nom du projet')}>
                <Input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder={t('Mon nouveau site')} autoFocus />
              </LigneFormulaire>
              <LigneFormulaire libelle={t('Nom du dossier (facultatif)')}>
                <Input value={newFolder} onChange={(event) => setNewFolder(event.target.value)} placeholder={t('déduit du nom')} />
              </LigneFormulaire>
              <LigneFormulaire
                libelle={t('En une phrase, à quoi sert ce projet ? (facultatif)')}
                aide={t('Cette phrase ouvre la documentation du projet et décrit le dépôt sur GitHub.')}
              >
                <Input value={newResume} onChange={(event) => setNewResume(event.target.value)} placeholder={t('Le site vitrine de l\'atelier')} />
              </LigneFormulaire>
              {/* L'adresse publique : demandée ici, créée pendant le montage. */}
              <LigneFormulaire
                libelle={t('Adresse publique du projet (facultatif)')}
                aide={t('Le nom et le port sur lequel le projet écoutera. Beluga Build crée l\'adresse pendant le montage : c\'est elle qui sera contrôlée à la fin de chaque déploiement. Laissés vides, le projet est monté sans adresse.')}
                data-adresse-nouveau-projet
              >
                <div className="flex items-center gap-1.5">
                  <Input
                    value={newSousDomaine}
                    onChange={(event) => setNewSousDomaine(event.target.value)}
                    placeholder="nom-du-site"
                    className="flex-1"
                    data-sous-domaine
                  />
                  <span className="shrink-0 text-[12.5px] text-faint" data-zone-des-projets>.{zoneDesProjets() || t('domaine à régler')}</span>
                  <Input
                    value={newPort}
                    onChange={(event) => setNewPort(event.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="port"
                    className="w-[74px]"
                    data-port-projet
                  />
                </div>
              </LigneFormulaire>
              {/* Les deux descriptions de mise en ligne, juste après l'adresse :
                  c'est le moment où l'on pense à où le projet va vivre. */}
              <LigneFormulaire libelle={t('Dépôt distant existant (facultatif)')}>
                <Input value={newRemote} onChange={(event) => setNewRemote(event.target.value)} placeholder={t('laisser vide pour en créer un sur GitHub')} />
              </LigneFormulaire>
            </FormulaireEnColonnes>
            <label className="flex items-center gap-2 text-[14px] text-muted">
              <Switch checked={withGit} onCheckedChange={setWithGit} />
              
{t('Démarrer un dépôt git dans le dossier')}
</label>
            <label className="flex items-center gap-2 text-[14px] text-muted">
              <Switch
                checked={withGithub && withGit && !newRemote.trim()}
                disabled={!withGit || !!newRemote.trim()}
                onCheckedChange={setWithGithub}
              />
              
{t('Créer aussi le dépôt privé sur GitHub')}
</label>
            <label className="flex items-center gap-2 text-[14px] text-muted" data-case-cahier="vide">
              <Switch checked={withCahier} onCheckedChange={setWithCahier} />
              <span>{t('Démarrer par un cahier des charges')}</span>
              <BulleInfo cote="start">
                {t('Une carte « Cahier des charges » apparaît dans le projet : son agent vous pose les questions une à une, rédige le cahier des charges sous vos yeux, puis le plan de construction. On peut le mettre en pause et le reprendre plus tard.')}
              </BulleInfo>
            </label>

            <div className="flex items-center gap-1.5">
              <Button variant="default" size="sm" disabled={!newName.trim() || busy === 'new'} onClick={createNew}>
                {busy === 'new' ? <Loader2 className="h-3 w-3 animate-spin" /> : <FolderPlus className="h-3 w-3" />}
                {t('Créer le projet')}
              </Button>
              <BulleInfo cote="start">
                {t('Le dossier est créé pour de vrai sur le serveur, sur la branche « main », avec les fichiers d\'instructions des moteurs, la mémoire, l\'historique et une documentation de départ. Le projet apparaît ensuite dans la liste de gauche.')}
              </BulleInfo>
            </div>

            {etapes ? <DerouleDesEtapes etapes={etapes} /> : null}
          </TabsContent>
        </DialogContent>
      </Tabs>
    </Dialog>
  );
}

/**
 * LA PASTILLE DES SITES EN PANNE. Les mêmes couleurs que l'étiquette « danger »
 * de l'interface : lisibles dans les douze palettes, sans jeton posé à la main.
 * Seule la ligne « Surveillance » porte le repère `data-surveillance-pastille` ;
 * le bouton compact la redit sans le doubler.
 */
