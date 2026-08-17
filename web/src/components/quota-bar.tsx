import * as React from 'react';
import {
  Activity,
  BarChart3,
  BookOpen,
  Check,
  Menu,
  MonitorCog,
  MoreVertical,
  Palette,
  PanelRight,
  Square,
  Volume2,
  Settings2,
  Sun,
  Moon,
} from 'lucide-react';
import {
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Tooltip,
} from '@/components/ui';
import { MemoryView } from '@/components/memory-view';
import { QuestionsEnAttente } from '@/components/questions-en-attente';
import { QuotaBadge } from '@/components/quota-badge';
import { CHOIX_DE_THEME, choixParId } from '@haikodev/shared';
import { useThemeGeneral } from '@/lib/theme';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { useTelephone } from '@/lib/telephone';
import { cn } from '@/lib/utils';

/** Le bandeau des quotas (PLAN §19) : où en sont les moteurs installés. */
export function QuotaBar({
  onOpenSettings,
  onOpenProjects,
  onOpenDashboard,
  rightOpen,
  onToggleRight,
}: {
  onOpenSettings: () => void;
  /** Sur téléphone seulement : ouvre la liste des projets en panneau latéral. */
  onOpenProjects?: () => void;
  /**
   * Sur téléphone seulement : ouvre le tableau de bord. Le menu du bas a cédé
   * sa colonne centrale au module de voix, si bien que le tableau de bord se
   * rejoint désormais par ce menu trois points. Sur grand écran, la colonne de
   * gauche y mène déjà : l'entrée n'y est pas doublée.
   */
  onOpenDashboard?: () => void;
  /** Sur grand écran : la colonne du chef d'orchestre est-elle dépliée ? */
  rightOpen?: boolean;
  /** Sur grand écran : plie ou déplie la colonne du chef d'orchestre. */
  onToggleRight?: () => void;
}) {
  const state = useApp();
  const telephone = useTelephone();
  const projetOuvert = state.projects.find((p) => p.id === state.activeProjectId);
  // Le moteur « en cours » : celui d'un agent qui travaille, sinon celui du projet.
  const activeEngine =
    Object.values(state.agents).find((agent) => agent.status === 'running')?.run.engine ??
    projetOuvert?.defaultEngine ??
    'claude';
  const [theme, setTheme] = useThemeGeneral();
  const [speaking, setSpeaking] = React.useState(false);
  const [memoireOuverte, setMemoireOuverte] = React.useState(false);
  const [arretGroupe, setArretGroupe] = React.useState(false);
  const [arretTous, setArretTous] = React.useState(false);

  /*
   * Les agents qui travaillent à cet instant : tous pour le compteur du coin
   * gauche (c'est l'état de la machine), ceux du projet affiché pour l'arrêt
   * groupé (on n'arrête jamais le travail d'un autre projet sans le dire).
   */
  // « starting » compte aussi : un tour resté coincé dans sa préparation est
  // justement celui qu'on veut pouvoir arrêter, et il retient un redémarrage
  // au même titre qu'un moteur en marche.
  const enCours = Object.values(state.agents).filter(
    (agent) => agent.status === 'running' || agent.status === 'starting',
  );
  const duProjet = enCours.filter((agent) => agent.projectId === state.activeProjectId);

  const arreterLeProjet = () => {
    /*
     * `send` ne rapportait RIEN : un arrêt refusé ou sans effet passait en
     * silence, et le message « agents arrêtés » s'affichait quand même. On
     * ATTEND désormais chaque réponse, et on annonce ce qui s'est réellement
     * passé — un refus compris.
     */
    const gestes = duProjet.map((agent) =>
      client.call<{ stopped?: boolean }>({ type: 'agent.stop', agentId: agent.id }),
    );
    Promise.allSettled(gestes).then((issues) => {
      const refus = issues.filter((issue) => issue.status === 'rejected').length;
      const arretes = issues.length - refus;
      if (arretes) {
        client.pushToast('info', arretes > 1 ? `${arretes} agents arrêtés.` : 'Agent arrêté.');
      }
      if (refus) {
        client.pushToast('error', refus > 1 ? `${refus} arrêts refusés.` : 'Arrêt refusé.');
      }
    });
  };

  const arreterTousLesAgents = () => {
    client
      .call({ type: 'agents.stop-all' })
      .then((response: any) => {
        client.pushToast(
          'success',
          response?.count > 0
            ? `${response.count} agent${response.count > 1 ? 's' : ''} arrêté${response.count > 1 ? 's' : ''}.`
            : 'Aucun agent à arrêter.',
        );
      })
      .catch((err: any) => client.pushToast('error', err?.message ?? 'Arrêt refusé'));
  };

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

  // Un autre projet que celui affiché attend une réponse.
  const ailleurs = Object.entries(state.attention).some(
    ([projectId, compte]) => compte > 0 && projectId !== state.activeProjectId,
  );

  /*
   * LE POINT D'ÉTAT DU COIN HAUT GAUCHE — un seul repère, posé sur le bouton
   * menu, à la place de l'ancienne icône « réseau » (des nœuds reliés) qui
   * prenait sa propre place dans la barre. Il garde exactement ce que cette
   * icône disait : la liaison au serveur, verte quand elle tient, orange et
   * clignotante quand elle est rompue. La pastille orange « un AUTRE projet
   * attend une réponse » vivait déjà à ce coin-là : les deux ne peuvent pas
   * s'empiler, la liaison rompue passe donc devant, l'attente ailleurs
   * ensuite, et le texte de survol dit toujours laquelle des deux on regarde.
   */
  const pointEtat = !state.connected
    ? { classe: 'animate-pulse-soft bg-warning', texte: 'Reconnexion…' }
    : ailleurs
      ? { classe: 'bg-warning', texte: 'Un autre projet attend une réponse' }
      : {
          classe: 'bg-success',
          texte:
            enCours.length > 1
              ? `Connecté au serveur · ${enCours.length} agents travaillent`
              : 'Connecté au serveur',
        };

  return (
    <header
      className={cn(
        'flex shrink-0 items-center gap-2 bg-bg px-2.5',
        !telephone && 'border-b border-border',
      )}
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        height: 'calc(44px + env(safe-area-inset-top))',
        paddingLeft: 'max(10px, env(safe-area-inset-left))',
        paddingRight: 'max(10px, env(safe-area-inset-right))',
      }}
    >
      {/* Tout à gauche : le bouton qui fait glisser la liste des projets
          par-dessus l'écran. Il ne sert qu'au téléphone — sur grand écran la
          colonne est déjà là. Il porte le MÊME habillage que les boutons de
          droite (cadre arrondi, fond transparent, même taille, même survol) :
          les deux côtés de la barre se répondent au lieu d'une icône nue à
          gauche et de boutons encadrés à droite. Le point d'état est posé dans
          son coin haut droit, DANS le cadre — il ne déborde pas et ne prend
          aucune place au nom du projet. */}
      {onOpenProjects ? (
        <Tooltip label={`Projets · ${pointEtat.texte}`}>
          <Button
            variant="outline"
            size="icon"
            className="relative shrink-0 sm:hidden"
            aria-label="Projets"
            onClick={onOpenProjects}
          >
            <Menu className="h-3.5 w-3.5" />
            <span
              data-point-etat
              className={cn('absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full', pointEtat.classe)}
            />
          </Button>
        </Tooltip>
      ) : null}

      {/* Sur GRAND ÉCRAN il n'y a pas de bouton menu — la colonne des projets
          est toujours là. Le même point d'état, seul, tient donc la place de
          l'ancienne icône : mêmes couleurs, même texte de survol, les deux
          versions disent la même chose de la même façon. */}
      <Tooltip label={pointEtat.texte}>
        <span className="hidden shrink-0 items-center sm:flex">
          <span
            data-point-etat
            className={cn('h-1.5 w-1.5 rounded-full', pointEtat.classe)}
          />
        </span>
      </Tooltip>

      {/* Le nombre d'agents ne s'affiche que lorsque PLUSIEURS travaillent en
          même temps : seul, un agent n'apprend rien de plus que la bande « en
          cours ». */}
      {enCours.length > 1 ? (
        <Tooltip label={`${enCours.length} agents travaillent`}>
          <span className="shrink-0 rounded-full bg-raised px-1.5 text-[11.5px] font-medium tabular-nums text-muted">
            {enCours.length}
          </span>
        </Tooltip>
      ) : null}

      {/* Le nom du projet ouvert, juste à côté du voyant de liaison : on sait
          toujours dans quel projet on travaille, sans ouvrir la liste. Il prend
          la place libre et se coupe proprement si le nom est long. */}
      {projetOuvert ? (
        <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium text-text" title={projetOuvert.name}>
          {projetOuvert.name}
        </span>
      ) : (
        <div className="flex-1" />
      )}

      <QuotaBadge activeEngine={activeEngine} />

      {/* La cloche des questions en attente : visible depuis n'importe où,
          elle liste chaque décision — projet, carte ou conversation, texte —
          et y emmène en un clic. Le triangle de la colonne de gauche reste,
          mais il n'est plus le seul chemin. */}
      <QuestionsEnAttente />

      {capacity ? (
        <Tooltip
          label={`${capacity.runningAgents} agent(s) en cours · ${capacity.slotsFree} peuvent encore démarrer · mémoire ${Math.round(
            capacity.memUsedMb / 1024,
          )}/${Math.round(capacity.memTotalMb / 1024)} Go`}
        >
          <button
            onClick={onOpenSettings}
            className="hidden h-7 items-center gap-1.5 rounded-md border border-border bg-transparent px-2 text-[12.5px] text-muted transition-colors hover:bg-raised hover:text-text sm:flex"
          >
            <Activity className="h-3 w-3" />
            {capacity.slotsFree} places
          </button>
        </Tooltip>
      ) : null}

      {/* Plier ou déplier la colonne du chef d'orchestre. Il vit DANS la barre,
          à sa place : posé en flottant par-dessus, il recouvrait les trois
          points et le menu devenait inatteignable sur ordinateur. */}
      {onToggleRight ? (
        <Tooltip label={rightOpen ? 'Replier le chef d’orchestre' : 'Ouvrir le chef d’orchestre'}>
          <Button
            variant="outline"
            size="icon"
            className="hidden lg:flex"
            aria-label={rightOpen ? 'Replier le chef d’orchestre' : 'Ouvrir le chef d’orchestre'}
            onClick={onToggleRight}
          >
            <PanelRight className={cn('h-3.5 w-3.5', rightOpen && 'text-text')} />
          </Button>
        </Tooltip>
      ) : null}

      {/* Un seul bouton : son, thème et réglages vivent derrière les trois
          points (menu sur ordinateur, tiroir en bas sur téléphone). */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="Menu" title="Menu">
            <MoreVertical className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {/* Sur téléphone, le module de voix a pris la colonne centrale du menu
              du bas : le tableau de bord se rejoint donc ICI. Sur grand écran,
              la colonne de gauche y mène déjà, on ne double pas l'entrée. */}
          {telephone && onOpenDashboard ? (
            <>
              <DropdownMenuItem onSelect={onOpenDashboard}>
                <BarChart3 className="h-3.5 w-3.5" />
                Tableau de bord
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
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
          {enCours.length ? (
            <DropdownMenuItem className="text-danger" onSelect={() => setArretTous(true)}>
              <Square className="h-3.5 w-3.5 fill-current" />
              Arrêter tous les agents ({enCours.length})
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={speaking} onSelect={() => void listen()}>
            <Volume2 className={cn('h-3.5 w-3.5', speaking && 'animate-pulse-soft')} />
            Écouter le point
          </DropdownMenuItem>
          {/* Le bouton « Muet » a quitté ce menu : il vit désormais dans le
              panneau du module de voix, à côté de la voix qu'il commande. */}
          {/* TOUS LES THÈMES TIENNENT DERRIÈRE UNE SEULE ENTRÉE. Alignés les uns
              sous les autres, ils occupaient la moitié du menu pour un réglage
              qu'on change une fois par mois. L'entrée « Thème » rappelle le
              choix en cours et déplie la liste au survol comme au clic ; la
              coche du thème actif ne bouge pas. Ce choix est le réglage
              GÉNÉRAL — un projet qui impose son thème passe devant, et l'onglet
              « Apparence » des réglages le dit. */}
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger data-theme-menu>
              <Palette className="h-3.5 w-3.5" />
              <span className="flex-1">Thème</span>
              <span className="text-faint">{choixParId(theme)?.libelle ?? ''}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {CHOIX_DE_THEME.map((item) => (
                <DropdownMenuItem key={item.id} onSelect={() => setTheme(item.id)} data-theme-choix={item.id}>
                  {item.id === 'systeme' ? (
                    <MonitorCog className="h-3.5 w-3.5" />
                  ) : item.clarte === 'clair' ? (
                    <Sun className="h-3.5 w-3.5" />
                  ) : (
                    <Moon className="h-3.5 w-3.5" />
                  )}
                  <span className="flex-1">{item.libelle}</span>
                  {item.id === theme ? <Check className="h-3.5 w-3.5 text-termine" /> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
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
            : `Arrêter l’agent de ce projet ?`
        }
        description="Le travail en cours sera perdu. Les agents des autres projets continuent."
        confirmLabel="Tout arrêter"
        onConfirm={arreterLeProjet}
        onClose={() => setArretGroupe(false)}
      />

      <ConfirmDialog
        open={arretTous}
        danger
        title={
          enCours.length > 1
            ? `Arrêter les ${enCours.length} agents en cours sur tous les projets ?`
            : `Arrêter l’agent en cours ?`
        }
        description="Le travail en cours sera perdu sur tous les projets."
        confirmLabel="Arrêter tous les agents"
        onConfirm={() => {
          arreterTousLesAgents();
          setArretTous(false);
        }}
        onClose={() => setArretTous(false)}
      />
    </header>
  );
}
