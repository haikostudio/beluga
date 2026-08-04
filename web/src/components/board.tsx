import * as React from 'react';
import { Plus, Rocket, Clock, AlertTriangle, Loader2, Archive, Check } from 'lucide-react';
import {
  COLUMN_KEYS,
  COLUMN_LABELS,
  Card,
  ColumnKey,
  canMove,
  cleColonneTableau,
  colonneAReprendre,
  etatVisuelCarte,
  sortieAutorisee,
} from '@haikodev/shared';
import { Badge, Button, Dot, Input, Textarea, Tooltip, ZoneDefilement } from '@/components/ui';
import { client } from '@/lib/client';
import { MenuCarte } from '@/components/card-menu';
import { DragItem, DropTarget, usePointerDrag } from '@/lib/dnd';
import { readPref, writePref } from '@/lib/prefs';
import { useApp } from '@/lib/use-app';
import { cn, relativeTime } from '@/lib/utils';
import { DeployPanel } from '@/components/deploy-panel';

/**
 * Les colonnes de fin de parcours, où le ménage se fait en lot. Ailleurs, une
 * carte est encore vivante : on ne propose pas de tout archiver d'un clic.
 */
const COLONNES_ARCHIVABLES: ColumnKey[] = ['done', 'to_deploy'];

export function Board({
  projectId,
  onOpenCard,
}: {
  projectId: string;
  onOpenCard: (cardId: string) => void;
}) {
  const state = useApp();

  const cards = React.useMemo(
    () =>
      Object.values(state.cards)
        .filter((card) => card.projectId === projectId)
        // Un seul ordre de tri : le plus récent en premier (PLAN §16).
        .sort((a, b) => b.position - a.position),
    [state.cards, projectId],
  );

  const byColumn = (column: ColumnKey) => cards.filter((card) => card.column === column);

  /*
   * On rouvre le tableau LÀ OÙ on l'avait laissé : la colonne regardée est
   * retenue projet par projet, en base. Sans souvenir (ou si la colonne
   * enregistrée n'existe plus), on revient au comportement d'origine : sur
   * téléphone « À faire », sinon on ouvre sur des notes souvent vides.
   */
  const rail = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const memorisee = colonneAReprendre(readPref(cleColonneTableau(projectId), null));
    const voulue = memorisee ?? (window.innerWidth < 640 ? 'todo' : null);
    if (!voulue) return;
    const cible = rail.current?.querySelector<HTMLElement>(`[data-column="${voulue}"]`);
    if (cible) rail.current!.scrollLeft = cible.offsetLeft - 12;
  }, [projectId]);

  /*
   * La colonne retenue est celle qui touche le bord gauche du tableau. On
   * l'enregistre une demi-seconde après l'arrêt du doigt : pendant un défilé,
   * chaque pixel n'a pas à traverser le réseau.
   */
  React.useEffect(() => {
    const node = rail.current;
    if (!node) return;
    let timer = 0;
    const noter = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const colonnes = Array.from(node.querySelectorAll<HTMLElement>('[data-column]'));
        const gauche = node.scrollLeft;
        const visible = colonnes
          .filter((colonne) => colonne.offsetLeft + colonne.offsetWidth > gauche + 24)
          .shift();
        const cle = visible?.getAttribute('data-column');
        if (cle && readPref(cleColonneTableau(projectId), null) !== cle) {
          writePref(cleColonneTableau(projectId), cle);
        }
      }, 500);
    };
    node.addEventListener('scroll', noter, { passive: true });
    return () => {
      window.clearTimeout(timer);
      node.removeEventListener('scroll', noter);
    };
  }, [projectId]);

  /*
   * Le déplacement se fait AU POINTEUR, jamais avec le glisser-déposer natif :
   * le natif ignore le doigt. Au doigt, il faut un appui maintenu, sinon on ne
   * pourrait plus faire défiler le tableau en partant d'une carte.
   */
  const resolve = React.useCallback((element: Element): DropTarget | null => {
    const colonne = element.closest('[data-column]')?.getAttribute('data-column');
    return colonne ? { id: colonne, kind: 'column', position: 'inside' } : null;
  }, []);

  const deposer = React.useCallback((item: DragItem, cible: DropTarget | null) => {
    if (!cible) return;
    const etatComplet = client.getSnapshot();
    const card = etatComplet.cards[item.id];
    const column = cible.id as ColumnKey;
    if (!card || card.column === column) return;
    const decision = canMove('user', card.column, column);
    if (!decision.allowed) {
      client.pushToast('error', decision.reason ?? 'déplacement refusé');
      return;
    }
    /*
     * Le glisser-déposer obéit aux mêmes règles que les boutons du tiroir :
     * emporter une carte hors de « En cours » pendant que son agent écrit,
     * c'est perdre le fil de son travail. Seul le retour en « Planifié » est
     * permis pendant ce temps-là : c'est la demande de SUSPENDRE, et le serveur
     * arrête alors le tour proprement.
     */
    const agentDeLaCarte = card.agentId ? etatComplet.agents[card.agentId] : null;
    const sortie = sortieAutorisee(
      {
        colonne: card.column,
        etat: etatVisuelCarte({ agentStatut: agentDeLaCarte?.status }),
        agentLance: !!agentDeLaCarte,
      },
      column,
    );
    if (!sortie.possible) {
      client.pushToast('warning', sortie.raison ?? 'déplacement refusé');
      return;
    }
    void client.moveCard(card, column);
  }, []);

  /*
   * L'archivage en lot des colonnes de fin de parcours. Le mode se déclenche au
   * bouton du bas : chaque carte reçoit alors une case à cocher, TOUTES cochées
   * d'entrée — on retire ce qu'on veut garder, plutôt que de tout re-cliquer.
   * Une seule colonne à la fois : deux sélections ouvertes en parallèle rendent
   * le compteur des boutons illisible.
   */
  const [colonneArchivage, setColonneArchivage] = React.useState<ColumnKey | null>(null);
  const [selection, setSelection] = React.useState<string[]>([]);
  const [archivageEnCours, setArchivageEnCours] = React.useState(false);

  const cartesEnSelection = colonneArchivage ? byColumn(colonneArchivage) : [];
  // Changer de projet, ou vider la colonne, referme le mode : il n'aurait plus
  // rien à cocher, et le pied resterait sur des boutons sans effet.
  React.useEffect(() => {
    setColonneArchivage(null);
    setSelection([]);
  }, [projectId]);
  React.useEffect(() => {
    if (colonneArchivage && !cartesEnSelection.length) setColonneArchivage(null);
  }, [colonneArchivage, cartesEnSelection.length]);

  const ouvrirArchivage = (column: ColumnKey) => {
    setSelection(byColumn(column).map((card) => card.id));
    setColonneArchivage(column);
  };

  const basculer = (cardId: string) =>
    setSelection((liste) => (liste.includes(cardId) ? liste.filter((id) => id !== cardId) : [...liste, cardId]));

  const archiverSelection = async () => {
    setArchivageEnCours(true);
    try {
      const snapshot = client.getSnapshot().cards;
      // Une carte après l'autre : l'archivage écrit un document de clôture,
      // et huit demandes lancées ensemble se marcheraient dessus.
      for (const id of selection) {
        const card = snapshot[id];
        if (card) await client.moveCard(card, 'archived');
      }
      setColonneArchivage(null);
      setSelection([]);
    } finally {
      setArchivageEnCours(false);
    }
  };

  /*
   * L'appui long ouvre sur la carte le MÊME menu que le tiroir (rouvrir,
   * archiver, supprimer, déplacer). Bouger le doigt avant l'échéance en fait
   * un glissement : c'est le geste qui tranche, jamais une durée à deviner.
   */
  const [menuCarte, setMenuCarte] = React.useState<string | null>(null);
  const ouvrirMenu = React.useCallback((item: DragItem) => {
    setMenuCarte(item.id);
    /*
     * Le menu s'ouvre pendant que le doigt appuie encore : le relever serait
     * lu comme un geste au-dehors et refermerait tout dans la seconde. On
     * avale donc ce relâchement-là, et lui seul.
     */
    const avaler = (event: Event) => {
      event.stopPropagation();
      event.preventDefault();
    };
    const options = { capture: true, once: true } as const;
    document.addEventListener('pointerup', avaler, options);
    document.addEventListener('mouseup', avaler, options);
    document.addEventListener('click', avaler, options);
    window.setTimeout(() => {
      document.removeEventListener('pointerup', avaler, true);
      document.removeEventListener('mouseup', avaler, true);
      document.removeEventListener('click', avaler, true);
    }, 900);
  }, []);

  const { dragging, target, pointer, start } = usePointerDrag({
    resolve,
    onDrop: deposer,
    holdMs: 260,
    onLongPress: ouvrirMenu,
  });
  const carteTiree = dragging ? cards.find((card) => card.id === dragging.id) : null;
  const over = (target?.id ?? null) as ColumnKey | null;

  // Le tableau suit : en approchant du bord, les colonnes défilent toutes seules.
  React.useEffect(() => {
    if (!dragging || !pointer) return;
    const zone = 70;
    const timer = window.setInterval(() => {
      const node = rail.current;
      if (!node) return;
      const boite = node.getBoundingClientRect();
      if (pointer.x < boite.left + zone) node.scrollLeft -= 14;
      else if (pointer.x > boite.right - zone) node.scrollLeft += 14;
    }, 16);
    return () => window.clearInterval(timer);
  }, [dragging, pointer]);

  // Le rail ne glisse QUE de gauche à droite : `overflow-y-hidden` est
  // indispensable, sinon le navigateur repasse tout seul l'axe vertical en
  // « auto » dès que l'autre axe déborde, et le tableau entier se met à flotter.
  return (
    <ZoneDefilement
      ref={rail}
      axe="horizontal"
      classeEnveloppe="h-full min-h-0"
      className="flex gap-2.5 px-3 py-3 snap-columns"
    >
      {COLUMN_KEYS.map((column) => {
        const columnCards = byColumn(column);
        const allowed = !carteTiree || canMove('user', carteTiree.column, column).allowed;
        return (
          <div
            key={column}
            data-column={column}
            className={cn(
              'flex h-full min-h-0 w-[268px] shrink-0 flex-col overflow-hidden rounded-lg border bg-surface/70 transition-colors',
              over === column && allowed ? 'border-muted bg-surface' : 'border-border/60',
              carteTiree && !allowed && 'opacity-40',
            )}
          >
            <div className="relative flex shrink-0 items-center gap-1.5 px-2 py-1.5">
              <h2 className="text-[13px] font-medium uppercase tracking-wide text-faint">{COLUMN_LABELS[column]}</h2>
              <span className="text-[12.5px] text-faint">{columnCards.length}</span>
              {column === 'todo' || column === 'notes' ? (
                <ComposerInline projectId={projectId} column={column} />
              ) : null}
            </div>

            {/*
              Un SEUL défilement vertical par colonne, et uniquement vertical :
              le bandeau de publication voyage avec les cartes, sinon sa hauteur
              (conflits, étapes) pousse la colonne au-delà du tableau.
              En mode archivage, la case à cocher DÉBORDE du coin haut-gauche de
              la carte : il faut donc lui laisser la place, sinon le débordement
              de la colonne la rognerait.
            */}
            <ZoneDefilement fond="hsl(var(--surface))">
              {column === 'to_deploy' ? <DeployPanel projectId={projectId} cards={columnCards} /> : null}
              <div
                className={cn(
                  'space-y-1.5 p-1.5',
                  colonneArchivage === column && 'pl-[15px] pt-[15px]',
                )}
              >
              {columnCards.map((card) => {
                const cochable = colonneArchivage === column;
                return (
                  <CardTile
                    key={card.id}
                    card={card}
                    onOpen={() =>
                      cochable ? basculer(card.id) : onOpenCard(card.id)
                    }
                    onPointerDown={
                      cochable
                        ? undefined
                        : (event) => start(event, { id: card.id, kind: 'card', label: card.title })
                    }
                    dimmed={dragging?.id === card.id}
                    coche={cochable ? selection.includes(card.id) : undefined}
                    menuOuvert={menuCarte === card.id}
                    onMenuChange={(ouvert) => setMenuCarte(ouvert ? card.id : null)}
                  />
                );
              })}
              {!columnCards.length ? (
                <p className="px-1.5 py-3 text-[13px] text-faint">
                  {column === 'notes'
                    ? 'Idées en vrac.'
                    : column === 'todo'
                      ? 'Rien à faire pour l’instant.'
                      : column === 'validated'
                        ? 'Glissez ici pour autoriser la dépense.'
                        : column === 'running'
                          ? 'Glissez ici pour lancer le travail.'
                          : column === 'planned'
                            ? 'Glissez une carte hors de « En cours » pour suspendre son agent.'
                            : '—'}
                </p>
              ) : null}
              </div>
            </ZoneDefilement>

            {/*
              Le pied des colonnes de fin de parcours : un seul bouton au repos,
              qui se change en couple annuler / valider une fois les cases
              sorties. Annuler ne touche à rien, valider archive ce qui est
              resté coché.
            */}
            {COLONNES_ARCHIVABLES.includes(column) && columnCards.length ? (
              <div className="shrink-0 border-t border-border/50 p-1.5">
                {colonneArchivage !== column ? (
                  <Button variant="outline" size="sm" className="w-full" onClick={() => ouvrirArchivage(column)}>
                    <Archive className="h-3 w-3" /> Tout archiver
                  </Button>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="flex-1"
                      disabled={archivageEnCours}
                      onClick={() => {
                        setColonneArchivage(null);
                        setSelection([]);
                      }}
                    >
                      Annuler
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      className="flex-1"
                      disabled={!selection.length || archivageEnCours}
                      onClick={archiverSelection}
                    >
                      {archivageEnCours ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                      Archiver ({selection.length})
                    </Button>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        );
      })}

      {/*
        L'aperçu suit le doigt. Il garde EXACTEMENT la largeur d'une carte dans
        sa colonne : au doigt, un aperçu qui rétrécit donne l'impression que la
        carte a changé de taille en route.
      */}
      {dragging && pointer ? (
        <div
          className="pointer-events-none fixed z-50 w-[254px] rounded-md border border-muted bg-raised px-2.5 py-2 text-[14px] font-medium leading-snug text-text shadow-2xl"
          style={{ left: pointer.x + 12, top: pointer.y - 18 }}
        >
          {dragging.label}
        </div>
      ) : null}
    </ZoneDefilement>
  );
}

function ComposerInline({ projectId, column }: { projectId: string; column: ColumnKey }) {
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const create = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const data = await client.call<{ card: Card }>({
        type: 'card.create',
        projectId,
        title: title.trim(),
        description: description.trim() || undefined,
      });
      // Une carte naît toujours dans « À faire » : pour une note, on la déplace
      // ensuite — c'est le seul chemin autorisé par le serveur.
      if (column === 'notes' && data?.card) {
        await client.call({ type: 'card.move', id: data.card.id, column: 'notes' });
      }
      setTitle('');
      setDescription('');
      setOpen(false);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'création impossible');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Tooltip label={column === 'notes' ? 'Nouvelle note' : 'Nouvelle tâche'}>
        <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={() => setOpen(true)}>
          <Plus className="h-3 w-3" />
        </Button>
      </Tooltip>
    );
  }

  return (
    <div className="absolute left-0 right-0 top-0 z-20 rounded-md border border-border bg-raised p-2 shadow-xl">
      <Input
        autoFocus
        value={title}
        placeholder={column === 'notes' ? 'Titre de la note…' : 'Titre de la tâche…'}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void create();
          if (event.key === 'Escape') setOpen(false);
        }}
      />
      <Textarea
        value={description}
        placeholder="Description (facultative)…"
        rows={3}
        className="mt-1.5"
        onChange={(event) => setDescription(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void create();
          if (event.key === 'Escape') setOpen(false);
        }}
      />
      <div className="mt-1.5 flex items-center gap-1.5">
        <Button variant="default" size="sm" disabled={!title.trim() || busy} onClick={create}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {column === 'notes' ? 'Ajouter la note' : 'Ajouter la tâche'}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Annuler
        </Button>
      </div>
    </div>
  );
}

export function CardTile({
  card,
  onOpen,
  onPointerDown,
  dimmed,
  coche,
  menuOuvert,
  onMenuChange,
}: {
  card: Card;
  onOpen: () => void;
  onPointerDown?: (event: React.PointerEvent) => void;
  dimmed?: boolean;
  /** Non défini : pas de sélection en cours. Défini : la case s'affiche, cochée ou non. */
  coche?: boolean;
  /** Le menu des gestes rares, ouvert à l'appui long ou au clic droit. */
  menuOuvert?: boolean;
  onMenuChange?: (ouvert: boolean) => void;
}) {
  const state = useApp();
  /*
   * L'appui long est suivi d'un clic que le navigateur envoie quand même : sans
   * ce garde-fou, le tiroir de la carte s'ouvrirait derrière le menu.
   */
  const ouvertureMenu = React.useRef(0);
  React.useEffect(() => {
    if (menuOuvert) ouvertureMenu.current = Date.now();
  }, [menuOuvert]);
  const ouvrir = () => {
    if (menuOuvert || Date.now() - ouvertureMenu.current < 700) return;
    onOpen();
  };
  const agent = card.agentId ? state.agents[card.agentId] : null;
  const waiting = card.scheduling?.waitingReason;
  const estimateFailed = card.estimate?.failed;
  // Entre la validation et le chiffrage, la carte doit montrer qu'il se passe
  // quelque chose — sinon on croit que rien ne démarre.
  const analysing = card.column === 'validated' && !card.estimate;
  const analyseEnCours = Object.values(state.agents).some(
    (a) => a.cardId === card.id && a.role === 'analysis' && a.status === 'running',
  );

  /*
   * L'état en cours ne s'affiche PAS dans le corps de la carte : il sort par le
   * bas, comme une étiquette glissée derrière, sur un fond un peu plus clair.
   */
  const statut =
    analysing || analyseEnCours
      ? // Le sujet suffit : la roue qui tourne dit déjà que c'est en cours.
        { icon: <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin" />, texte: 'Chiffrage du travail…', ton: 'text-muted' }
      : waiting
        ? { icon: <Clock className="h-2.5 w-2.5 shrink-0" />, texte: waiting, ton: 'text-warning' }
        : estimateFailed
          ? {
              icon: <AlertTriangle className="h-2.5 w-2.5 shrink-0" />,
              texte: card.estimate?.failureReason ?? 'analyse sans chiffres',
              ton: 'text-danger',
            }
          : null;

  /*
   * Le voyant du titre : une seule règle, partagée et testée. Elle distingue
   * « ça travaille » de « c'est rendu, il ne manque que votre clôture » —
   * un point gris ne disait pas la différence.
   */
  const etat = etatVisuelCarte({
    agentStatut: agent?.status,
    analyseEnCours,
    chiffrageEnCours: analysing,
    enAttente: !!waiting,
    estimationEchouee: estimateFailed,
    enLigne: !!card.deployedAt,
  });

  return (
    <div className={cn('relative', dimmed && 'opacity-40')}>
      {/*
       * La case chevauche le coin haut-gauche : elle en dépasse de moitié, pour
       * se lire comme une pastille posée SUR la carte et non comme un élément
       * de son contenu.
       */}
      {coche !== undefined ? (
        <button
          type="button"
          aria-pressed={coche}
          aria-label={coche ? 'Retirer de la sélection' : 'Ajouter à la sélection'}
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
          className={cn(
            'absolute -left-[9px] -top-[9px] z-20 flex h-[18px] w-[18px] items-center justify-center rounded border shadow-sm transition-colors',
            coche ? 'border-accent bg-accent text-accent-fg' : 'border-faint bg-raised text-transparent',
          )}
        >
          <Check className="h-3 w-3" strokeWidth={3} />
        </button>
      ) : null}

      {/* À la souris, le clic droit ouvre le même menu : c'est là qu'on le
          cherche sur ordinateur, l'appui long restant le geste du doigt. */}
      {onMenuChange ? (
        <MenuCarte card={card} ancrage="invisible" open={!!menuOuvert} onOpenChange={onMenuChange} />
      ) : null}

      <article
        onPointerDown={onPointerDown}
        onContextMenu={
          onMenuChange
            ? (event) => {
                event.preventDefault();
                onMenuChange(true);
              }
            : undefined
        }
        onClick={ouvrir}
        className={cn(
          'relative z-10 cursor-pointer touch-manipulation select-none rounded-md border border-border bg-raised px-2.5 py-2 transition-colors hover:border-faint',
          statut && 'rounded-b-none',
        )}
      >
        {/*
         * Le badge « en ligne » est le premier repère à voir : il prend sa
         * propre ligne AU-DESSUS du titre, au lieu de se perdre au milieu des
         * repères techniques du pied.
         */}
        {card.deployedAt ? (
          <div className="mb-1 flex">
            <Tooltip label={`En ligne depuis le ${new Date(card.deployedAt).toLocaleString('fr-CH')}`}>
              <Badge tone="success">
                <Rocket className="h-2.5 w-2.5" /> en ligne
              </Badge>
            </Tooltip>
          </div>
        ) : null}

        <div className="flex items-start gap-1.5">
          <h3 className="min-w-0 flex-1 text-[14px] font-medium leading-snug text-text">{card.title}</h3>
          {/* Le voyant est à DROITE, au bout de la ligne du titre. */}
          {etat === 'travaille' ? (
            <Loader2 className="mt-[3px] h-3 w-3 shrink-0 animate-spin text-success" />
          ) : etat === 'termine' ? (
            // La coche verte : l'agent a rendu son travail, la carte attend
            // votre clôture. Une relance la remplace aussitôt par la roue.
            <Tooltip label="Travail rendu — la carte attend votre clôture">
              <span className="mt-[2px] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
                <Check className="h-2.5 w-2.5" strokeWidth={3} />
              </span>
            </Tooltip>
          ) : (
            <Dot
              tone={
                etat === 'echec'
                  ? 'failed'
                  : etat === 'attente'
                    ? 'waiting'
                    : etat === 'enligne'
                      ? 'done'
                      : 'idle'
              }
            />
          )}
        </div>

        {card.labels.length || card.billing ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {card.labels.slice(0, 3).map((label) => (
              <Badge key={label}>{label}</Badge>
            ))}
            {card.billing ? <Badge tone="success">déjà facturée</Badge> : null}
          </div>
        ) : null}

        {/*
         * L'agent a répondu mais rien n'a changé dans le projet : sans cette
         * phrase, la carte aurait juste l'air oubliée en « En cours ». On l'écrit
         * en toutes lettres, à l'endroit où on cherche l'état de la carte.
         */}
        {card.sansModification ? (
          <div className="mt-1.5 flex items-start gap-1.5 rounded border border-warning/30 bg-warning/10 px-1.5 py-1 text-[12px] leading-snug text-warning">
            <AlertTriangle className="mt-[2px] h-3 w-3 shrink-0" />
            <span className="min-w-0">{card.sansModification}</span>
          </div>
        ) : null}

        {/*
         * Le pied ne porte plus que l'ancienneté. Les repères techniques
         * (durée prévue, durée réalisée, heures facturables, branche) n'aident
         * pas à décider d'un coup d'œil : ils vivent dans le tiroir de la
         * carte, onglets Détails et GitHub.
         */}
        <div className="mt-1.5 text-[12px] text-faint">{relativeTime(card.updatedAt)}</div>
      </article>

      {statut ? (
        <div
          onClick={ouvrir}
          className={cn(
            // Toute la largeur de la carte, sur UNE ligne, sans marge latérale.
            // Le petit espace en haut laisse voir l'ombre portée, qui donne
            // l'impression que la carte recouvre la bande.
            'relative -mt-1 cursor-pointer overflow-hidden rounded-b-md bg-border/30 px-2.5 pb-1.5 pt-2 text-[12.5px] leading-none',
            'shadow-[inset_0_7px_6px_-6px_rgba(0,0,0,0.75)]',
            statut.ton,
          )}
        >
          <span className="flex items-center gap-1">
            {statut.icon}
            <span className="min-w-0 flex-1 truncate">{statut.texte}</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}
