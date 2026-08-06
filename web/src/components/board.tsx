import * as React from 'react';
import { Plus, Rocket, Clock, AlertTriangle, Loader2, Archive, Check, Play, MessageSquare, ListChecks, Bot, EllipsisVertical, CheckCheck, Globe } from 'lucide-react';
import {
  COLUMN_KEYS,
  COLUMN_LABELS,
  Card,
  ColumnKey,
  RefusDeLot,
  bilanDeLot,
  canMove,
  cleColonneTableau,
  colonneAReprendre,
  decisionsParCarte,
  etatVisuelCarte,
  mentionArchivage,
  mentionProgressionTaches,
  mentionSansSuite,
  repereVisible,
  sortieAutorisee,
} from '@haikodev/shared';
import { RepereAttention } from '@/components/repere-attention';
import {
  Badge,
  Button,
  Dot,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  ZoneDefilement,
} from '@/components/ui';
import { client } from '@/lib/client';
import { MenuCarte } from '@/components/card-menu';
import { DragItem, DropTarget, usePointerDrag } from '@/lib/dnd';
import { readPref, writePref } from '@/lib/prefs';
import { useApp } from '@/lib/use-app';
import { useTelephone } from '@/lib/telephone';
import { useMinute } from '@/lib/horloge';
import { cn, relativeTime } from '@/lib/utils';
import { DeployPanel } from '@/components/deploy-panel';

/**
 * Ce qu'un pied de colonne sait faire en lot. UN SEUL mécanisme, en deux temps :
 * le premier clic sort les cases à cocher (toutes cochées), le second déplace
 * ce qui est resté coché vers `cible`. Seules les colonnes listées ici ont un
 * pied : ailleurs, le geste de masse n'a pas de sens.
 */
type ActionDeLot = {
  /** Le bouton au repos. */
  libelle: string;
  icone: React.ComponentType<{ className?: string }>;
  /** Le bouton de confirmation, suivi du nombre de cartes cochées. */
  verbe: string;
  cible: ColumnKey;
  /** Le participe passé féminin, pour le compte rendu : « 2 cartes lancées ». */
  participe: string;
  /**
   * Les cartes partent-elles ENSEMBLE ? Par défaut, un lot les traite l'une
   * après l'autre (l'archivage écrit un document, la validation chiffre — huit
   * demandes d'un coup se marcheraient dessus). « Tout lancer » fait exception :
   * chaque carte lancée obtient SA copie de travail et sa branche, donc rien ne
   * les empêche de démarrer en parallèle, et l'utilisateur voit les robots
   * s'allumer ensemble au lieu d'attendre en file.
   */
  parallele?: boolean;
};

const ACTIONS_DE_LOT: Partial<Record<ColumnKey, ActionDeLot>> = {
  // Valider en lot fait EXACTEMENT ce que fait le bouton du tiroir, carte par
  // carte : passer en « Validé ». Rien n'est lancé — l'ordonnanceur décide.
  todo: { libelle: 'Tout valider', icone: Check, verbe: 'Valider', cible: 'validated', participe: 'validée' },
  // Déposer une carte dans « En cours » VAUT le clic sur « Lancer maintenant » :
  // le lot n'a donc rien à inventer, il rejoue ce même déplacement carte après
  // carte et le serveur passe par `startCard` — portes dures comprises. Une
  // carte refusée revient à sa colonne avec sa raison, et le lot continue.
  planned: { libelle: 'Tout lancer', icone: Play, verbe: 'Lancer', cible: 'running', participe: 'lancée', parallele: true },
  // « Terminé » précède « À déployer » : le geste de masse à cet endroit est de
  // POUSSER dans le lot à publier, jamais d'archiver par-dessus l'étape de
  // publication. Rien n'est mis en ligne — les cartes changent de colonne.
  done: { libelle: 'Tout déployer', icone: Rocket, verbe: 'Déployer', cible: 'to_deploy', participe: 'déployée' },
  // La mise en ligne compte désormais DEUX étapes : « À déployer » pousse vers
  // « En production », et c'est de là seulement qu'on archive. Un pied suit le
  // parcours de la carte — on n'archive jamais par-dessus une étape.
  to_deploy: {
    libelle: 'Tout mettre en production',
    icone: Globe,
    verbe: 'Mettre en production',
    cible: 'in_production',
    participe: 'mise en production',
  },
  // Dernière colonne du parcours, où le ménage se fait en lot.
  in_production: {
    libelle: 'Tout archiver',
    icone: Archive,
    verbe: 'Archiver',
    cible: 'archived',
    participe: 'archivée',
  },
};

/**
 * Le menu à trois points d'une tête de colonne. Une seule entrée pour l'instant :
 * « Marquer tout comme lu », qui éteint le point bleu de toutes les cartes non
 * lues de CETTE colonne. On ne réinvente rien côté serveur : on rejoue la
 * commande `card.read` (celle qu'envoie l'ouverture d'une conversation) pour
 * chaque carte non lue. Sans carte non lue, pas de bouton : le menu n'aurait
 * rien à proposer. Sur téléphone, `DropdownMenuContent` devient un tiroir bas.
 */
function MenuTeteColonne({ cartesNonLues }: { cartesNonLues: Card[] }) {
  if (!cartesNonLues.length) return null;
  const toutMarquerLu = () => {
    for (const carte of cartesNonLues) client.send({ type: 'card.read', cardId: carte.id });
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto -mr-1 h-6 shrink-0 px-1.5 text-faint"
          aria-label="Actions de la colonne"
        >
          <EllipsisVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={toutMarquerLu}>
          <CheckCheck className="h-3.5 w-3.5" /> Marquer tout comme lu
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
   * Ce qu'un ONGLET du tableau (téléphone) a à signaler, colonne par colonne :
   * les mêmes deux comptes que la ligne d'un projet — une décision attendue, un
   * travail rendu pas encore lu. On ne réinvente rien : le compte des décisions
   * vient de `decisionsParCarte`, l'état « rendu, pas lu » de `etatVisuelCarte`,
   * exactement comme la carte elle-même. `repereVisible` tranche ensuite lequel
   * des deux s'affiche (la décision d'abord), pour un seul repère par onglet.
   */
  const decisionsCarte = decisionsParCarte(state.decisions);
  const etatDeCarte = (card: Card) => {
    const agentCarte = card.agentId ? state.agents[card.agentId] : null;
    return etatVisuelCarte({
      agentStatut: agentCarte?.status,
      analyseEnCours: Object.values(state.agents).some(
        (a) => a.cardId === card.id && a.role === 'analysis' && a.status === 'running',
      ),
      chiffrageEnCours: card.column === 'validated' && !card.estimate,
      enAttente: !!card.scheduling?.waitingReason,
      estimationEchouee: card.estimate?.failed,
      enLigne: !!card.deployedAt,
      agentFiniA: agentCarte?.endedAt,
      luA: card.lastReadAt,
    });
  };
  const signalOnglet = (column: ColumnKey) => {
    let attention = 0;
    let rendus = 0;
    let travaille = 0;
    // Le NOMBRE de cartes de la colonne, compté sur la même liste que la colonne
    // elle-même (`byColumn`) : l'onglet et la tête de colonne ne peuvent donc
    // pas afficher deux chiffres différents.
    let total = 0;
    for (const card of byColumn(column)) {
      total += 1;
      attention += decisionsCarte[card.id] ?? 0;
      const etat = etatDeCarte(card);
      if (etat === 'termine-non-lu') rendus += 1;
      // « Un agent travaille ici » : le MÊME état que le voyant de la carte
      // (Loader2), simplement compté pour l'afficher sur l'onglet. Cet indicateur
      // d'ACTIVITÉ vit à côté des repères d'attente, il ne passe pas par
      // `repereVisible` — il n'y a rien à trancher, on montre les deux.
      if (etat === 'travaille') travaille += 1;
    }
    return { attention, rendus, travaille, total };
  };

  /*
   * On rouvre le tableau LÀ OÙ on l'avait laissé : la colonne regardée est
   * retenue projet par projet, en base. Sans souvenir (ou si la colonne
   * enregistrée n'existe plus), on revient au comportement d'origine : sur
   * téléphone « À faire », sinon on ouvre sur des notes souvent vides.
   */
  const rail = React.useRef<HTMLDivElement>(null);
  const barreOnglets = React.useRef<HTMLDivElement>(null);
  const telephone = useTelephone();

  /*
   * La colonne qui touche le bord gauche du tableau. Elle sert à DEUX choses :
   * on la retient projet par projet (pour rouvrir au même endroit), et sur
   * téléphone elle met en évidence l'onglet correspondant. Même règle des deux
   * côtés — une seule fonction, lue sur le rail au moment voulu.
   */
  const colonneAuBord = React.useCallback((): ColumnKey | null => {
    const node = rail.current;
    if (!node) return null;
    const gauche = node.scrollLeft;
    const visible = Array.from(node.querySelectorAll<HTMLElement>('[data-column]'))
      .filter((colonne) => colonne.offsetLeft + colonne.offsetWidth > gauche + 24)
      .shift();
    return (visible?.getAttribute('data-column') as ColumnKey | null) ?? null;
  }, []);

  const [colonneActive, setColonneActive] = React.useState<ColumnKey | null>(null);

  React.useEffect(() => {
    const memorisee = colonneAReprendre(readPref(cleColonneTableau(projectId), null));
    const voulue = memorisee ?? (window.innerWidth < 640 ? 'todo' : null);
    if (voulue) {
      const cible = rail.current?.querySelector<HTMLElement>(`[data-column="${voulue}"]`);
      if (cible) rail.current!.scrollLeft = cible.offsetLeft - 12;
    }
    // L'onglet actif part de la colonne réellement au bord après ce placement.
    setColonneActive(colonneAuBord());
  }, [projectId, colonneAuBord]);

  /*
   * Au défilement, l'onglet actif suit le doigt TOUT DE SUITE (sinon la mise en
   * évidence traînerait). L'écriture en base, elle, attend une demi-seconde
   * après l'arrêt du doigt : pendant un défilé, chaque pixel n'a pas à traverser
   * le réseau.
   */
  React.useEffect(() => {
    const node = rail.current;
    if (!node) return;
    let timer = 0;
    const noter = () => {
      setColonneActive(colonneAuBord());
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const cle = colonneAuBord();
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
  }, [projectId, colonneAuBord]);

  /*
   * Un appui sur un onglet amène sa colonne au bord gauche, en douceur. Même
   * marge de 12 px qu'à la réouverture, pour que la colonne visée touche
   * vraiment le bord. La mise en évidence est posée d'avance : le défilement
   * animé confirmera.
   *
   * Second geste, au MÊME appui : l'onglet lui-même est amené au CENTRE de sa
   * barre défilante, pour que ses voisins de gauche et de droite redeviennent
   * visibles — sinon « Terminé », tout à droite, reste collé au bord et l'on
   * perd le repère de là où on se trouve dans la suite des colonnes. On mesure
   * les rectangles réels (`getBoundingClientRect`) plutôt que `offsetLeft`,
   * insensible ainsi à l'élément positionné qui sert de repère. Sur ordinateur
   * la barre n'existe pas (`barreOnglets` reste vide) : rien ne bouge.
   */
  const allerALaColonne = React.useCallback((cle: ColumnKey) => {
    const node = rail.current;
    const cible = node?.querySelector<HTMLElement>(`[data-column="${cle}"]`);
    if (node && cible) node.scrollTo({ left: cible.offsetLeft - 12, behavior: 'smooth' });
    const barre = barreOnglets.current;
    const onglet = barre?.querySelector<HTMLElement>(`[data-onglet-colonne="${cle}"]`);
    if (barre && onglet) {
      const rectBarre = barre.getBoundingClientRect();
      const rectOnglet = onglet.getBoundingClientRect();
      const decalage =
        rectOnglet.left + rectOnglet.width / 2 - (rectBarre.left + rectBarre.width / 2);
      barre.scrollTo({ left: barre.scrollLeft + decalage, behavior: 'smooth' });
    }
    setColonneActive(cle);
  }, []);

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
   * Le geste en lot d'une colonne. Le mode se déclenche au bouton du bas :
   * chaque carte reçoit alors une case à cocher, TOUTES cochées d'entrée — on
   * retire ce qu'on veut garder, plutôt que de tout re-cliquer. Une seule
   * colonne à la fois : deux sélections ouvertes en parallèle rendent le
   * compteur des boutons illisible.
   */
  const [colonneEnLot, setColonneEnLot] = React.useState<ColumnKey | null>(null);
  const [selection, setSelection] = React.useState<string[]>([]);
  const [lotEnCours, setLotEnCours] = React.useState(false);

  const cartesEnSelection = colonneEnLot ? byColumn(colonneEnLot) : [];
  // Changer de projet, ou vider la colonne, referme le mode : il n'aurait plus
  // rien à cocher, et le pied resterait sur des boutons sans effet.
  React.useEffect(() => {
    setColonneEnLot(null);
    setSelection([]);
  }, [projectId]);
  React.useEffect(() => {
    if (colonneEnLot && !cartesEnSelection.length) setColonneEnLot(null);
  }, [colonneEnLot, cartesEnSelection.length]);

  const ouvrirLot = (column: ColumnKey) => {
    setSelection(byColumn(column).map((card) => card.id));
    setColonneEnLot(column);
  };

  const fermerLot = () => {
    setColonneEnLot(null);
    setSelection([]);
  };

  const basculer = (cardId: string) =>
    setSelection((liste) => (liste.includes(cardId) ? liste.filter((id) => id !== cardId) : [...liste, cardId]));

  /*
   * Une carte tentée par le lot : on rejoue le MÊME appel que le bouton du
   * tiroir. Le résultat est mis en compte par l'appelant. Un refus n'arrête
   * jamais le lot (« Tout lancer » sur un projet occupé refuse les suivantes,
   * et chacune doit être tentée pour recevoir sa raison) ; le `catch` couvre
   * l'imprévu (réseau coupé).
   */
  const tenterUneCarte = async (id: string, cible: ColumnKey): Promise<'faite' | RefusDeLot | null> => {
    const card = client.getSnapshot().cards[id];
    if (!card) return null;
    try {
      const issue = await client.moveCard(card, cible, { silencieux: true });
      return issue.ok ? 'faite' : { titre: card.title, raison: issue.error };
    } catch (err: any) {
      return { titre: card.title, raison: err?.message };
    }
  };

  const appliquerLot = async (action: ActionDeLot) => {
    setLotEnCours(true);
    let faites = 0;
    const refusees: RefusDeLot[] = [];
    const compter = (issue: 'faite' | RefusDeLot | null) => {
      if (issue === 'faite') faites += 1;
      else if (issue) refusees.push(issue);
    };
    try {
      if (action.parallele) {
        /*
         * « Tout lancer » : les cartes partent ENSEMBLE. Chaque carte lancée a
         * sa propre copie de travail et sa branche, donc rien ne les enchaîne —
         * les appels partent d'un coup et l'utilisateur voit les robots
         * s'allumer en même temps. L'instantané est lu une fois, en tête : ces
         * cartes sont indépendantes, aucune ne change la colonne d'une autre.
         */
        const issues = await Promise.all(selection.map((id) => tenterUneCarte(id, action.cible)));
        issues.forEach(compter);
      } else {
        /*
         * Les autres pieds restent une carte après l'autre : l'archivage écrit
         * un document de clôture, la validation déclenche un chiffrage — huit
         * demandes d'un coup se marcheraient dessus. L'état est relu à CHAQUE
         * tour de boucle, la carte précédente ayant pu changer de colonne.
         */
        for (const id of selection) {
          compter(await tenterUneCarte(id, action.cible));
        }
      }
    } finally {
      // Le compte rendu part même si quelque chose a cassé en route : un lot
      // silencieux est exactement ce qu'on corrige ici.
      const nomProjet = state.projects.find((p) => p.id === projectId)?.name;
      const bilan = bilanDeLot(action.participe, faites, refusees, nomProjet);
      client.pushToast(bilan.niveau, bilan.texte);
      fermerLot();
      setLotEnCours(false);
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
    <div className="flex h-full min-h-0 flex-col">
      {/*
        Sur téléphone, atteindre « À déployer » demandait de faire défiler tout
        le tableau à la main. Une rangée d'onglets — un par colonne, libellé
        complet — offre le raccourci : un appui amène la colonne au bord gauche,
        et l'onglet de la colonne au bord est mis en évidence. Elle est un FRÈRE
        au-dessus du rail, jamais un enfant de la ZoneDefilement horizontale :
        un enfant parasite fausserait l'auto-défilement au drag et les scripts.
        Sur ordinateur elle n'existe pas : le tableau tient à l'écran.
      */}
      {telephone ? (
        /*
          Les onglets partagés (TabsList/TabsTrigger, ui/index.tsx) — les mêmes
          que le tiroir d'une carte — pour un seul style dans toute
          l'application. `defilable` fait glisser la rangée quand les colonnes
          dépassent la largeur ; l'onglet actif suit le bord gauche du rail. Un
          appui déclenche `allerALaColonne` via `onValueChange`. `aria-current`
          reste posé à la main : les scripts le lisent, et Radix n'écrit que
          `data-state`.
        */
        <Tabs
          value={colonneActive ?? ''}
          onValueChange={(cle) => allerALaColonne(cle as ColumnKey)}
          className="shrink-0 border-b border-border/50 px-3 py-1.5"
        >
          <TabsList
            ref={barreOnglets}
            defilable
            data-onglets-colonnes=""
            className="w-full justify-start"
          >
            {COLUMN_KEYS.map((cle) => {
              // Le MÊME repère que la ligne d'un projet, reporté sur l'onglet :
              // triangle orange si une carte de la colonne attend une décision,
              // sinon point bleu si un travail y est rendu pas encore lu. Un
              // seul à la fois — la décision prime (`repereVisible`).
              const signal = signalOnglet(cle);
              const repere = repereVisible(signal);
              return (
                <TabsTrigger
                  key={cle}
                  value={cle}
                  data-onglet-colonne={cle}
                  aria-current={colonneActive === cle ? 'true' : undefined}
                >
                  <span className="inline-flex items-center gap-1">
                    {COLUMN_LABELS[cle]}
                    {/* Le NOMBRE de cartes, juste après le libellé et dans la
                        même tenue discrète que la tête de colonne : petit et
                        `text-faint`, jamais une pastille. Il est TOUJOURS écrit,
                        zéro compris — une colonne vide qui se tait laisserait
                        croire à une information manquante, et le chiffre saute
                        alors d'un onglet à l'autre. */}
                    <span
                      data-onglet-compte={cle}
                      className="shrink-0 text-[11.5px] leading-none text-faint tabular-nums"
                    >
                      {signal.total}
                    </span>
                    {/* L'indicateur d'ACTIVITÉ : un robot, dans l'esprit de la
                        colonne de gauche (`RepereRobot`), quand au moins un agent
                        travaille dans la colonne. Rien qui tourne, et il coexiste
                        avec le repère d'attente au lieu de le remplacer. */}
                    {signal.travaille > 0 ? (
                      <Tooltip
                        label={
                          signal.travaille > 1
                            ? `${signal.travaille} agents au travail`
                            : 'Un agent au travail'
                        }
                      >
                        <span
                          data-onglet-travail={cle}
                          aria-label={
                            signal.travaille > 1
                              ? `${signal.travaille} agents au travail`
                              : 'Un agent au travail'
                          }
                          className="inline-flex shrink-0 items-center gap-0.5"
                        >
                          <Bot className="h-3 w-3 shrink-0 text-success" />
                          {signal.travaille > 1 ? (
                            <span className="text-[10.5px] leading-none text-success">
                              {signal.travaille}
                            </span>
                          ) : null}
                        </span>
                      </Tooltip>
                    ) : null}
                    {repere === 'attention' ? (
                      <RepereAttention compte={signal.attention} data-onglet-attention={cle} />
                    ) : repere === 'rendus' ? (
                      <Tooltip label="Travail rendu, pas encore lu">
                        <span
                          data-onglet-non-lu={cle}
                          aria-label="Travail rendu, pas encore lu"
                          className="h-2 w-2 shrink-0 rounded-full bg-info animate-pulse-soft motion-reduce:animate-none"
                        />
                      </Tooltip>
                    ) : null}
                  </span>
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
      ) : null}

      <ZoneDefilement
        ref={rail}
        axe="horizontal"
        classeEnveloppe="min-h-0 flex-1"
        className="flex gap-2.5 px-3 py-3 snap-columns"
      >
      {COLUMN_KEYS.map((column) => {
        const columnCards = byColumn(column);
        const action = ACTIONS_DE_LOT[column];
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
              <MenuTeteColonne
                cartesNonLues={columnCards.filter((card) => etatDeCarte(card) === 'termine-non-lu')}
              />
            </div>

            {/*
              Un SEUL défilement vertical par colonne, et uniquement vertical :
              le bandeau de publication voyage avec les cartes, sinon sa hauteur
              (conflits, étapes) pousse la colonne au-delà du tableau.
              En mode sélection, la case à cocher DÉBORDE du coin haut-gauche de
              la carte : il faut donc lui laisser la place, sinon le débordement
              de la colonne la rognerait.
            */}
            <ZoneDefilement fond="hsl(var(--surface))">
              {/* La mise en ligne compte DEUX étapes : le même bloc sert les
                  deux, en tête de la colonne d'où part son lot. Celui d'« En
                  production » ne s'affiche que si cette étape existe vraiment
                  pour le projet — c'est le bloc lui-même qui le demande au
                  serveur, et qui ne rend rien sinon. */}
              {column === 'to_deploy' || column === 'in_production' ? (
                <DeployPanel projectId={projectId} cards={columnCards} colonne={column} />
              ) : null}
              <div
                className={cn(
                  'space-y-1.5 p-1.5',
                  colonneEnLot === column && 'pl-[15px] pt-[15px]',
                )}
              >
              {columnCards.map((card) => {
                const cochable = colonneEnLot === column;
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
              Le pied d'une colonne qui sait agir en lot : un seul bouton au
              repos, qui se change en couple annuler / confirmer une fois les
              cases sorties. Annuler ne touche à rien, confirmer déplace ce qui
              est resté coché. Colonne vide, pas de pied : il n'agirait sur rien.
            */}
            {action && columnCards.length ? (
              <div className="shrink-0 border-t border-border/50 p-1.5">
                {colonneEnLot !== column ? (
                  <Button variant="outline" size="sm" className="w-full" onClick={() => ouvrirLot(column)}>
                    <action.icone className="h-3 w-3" /> {action.libelle}
                  </Button>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="flex-1"
                      disabled={lotEnCours}
                      onClick={fermerLot}
                    >
                      Annuler
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      className="flex-1"
                      disabled={!selection.length || lotEnCours}
                      onClick={() => appliquerLot(action)}
                    >
                      {lotEnCours ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                      {action.verbe} ({selection.length})
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
    </div>
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
   * L'avancement de la liste de tâches de l'agent d'exécution, tel qu'il voyage
   * avec lui (champ `todos` de l'agent). On prend l'agent de tâche encore au
   * travail sur cette carte : c'est le sien qui compte, pas celui d'une analyse.
   */
  const agentTacheActif = Object.values(state.agents).find(
    (a) => a.cardId === card.id && a.role === 'task' && (a.status === 'running' || a.status === 'starting'),
  );
  const progression = mentionProgressionTaches({
    column: card.column,
    agentActif: !!agentTacheActif,
    todos: agentTacheActif?.todos,
  });

  /*
   * L'état en cours ne s'affiche PAS dans le corps de la carte : il sort par le
   * bas, comme une étiquette glissée derrière, sur un fond un peu plus clair.
   * Les états d'analyse, d'attente et d'échec gardent la priorité ; l'avancement
   * « n/N faites » ne parle que lorsqu'aucun d'eux ne parle.
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
          : progression
            ? {
                icon: <ListChecks className="h-2.5 w-2.5 shrink-0" />,
                texte: progression,
                ton: 'text-muted',
                marqueur: 'progression-taches' as const,
              }
            : null;

  /*
   * Le voyant du titre : une seule règle, partagée et testée. Elle distingue
   * « ça travaille » de « c'est rendu, il ne manque que votre clôture » —
   * un point gris ne disait pas la différence.
   */
  /*
   * « Une décision vous attend ICI. » La ligne du projet annonce un total ;
   * c'est cette carte-là qui dit où il se trouve. Même triangle orange, même
   * phrase : on ne réinvente pas un signal, on le reporte à sa place.
   */
  const decisions = decisionsParCarte(state.decisions)[card.id] ?? 0;

  /*
   * « Tour terminé sans suite. » Entre la roue qui tourne et la carte close, il
   * existe un troisième état que rien n'affichait : le tour s'est achevé,
   * aucun agent ne travaille, personne n'a repris. On regarde TOUS les agents
   * de la carte — pas seulement le dernier retenu — pour savoir si l'un
   * travaille encore et quand le plus récent a rendu la main.
   */
  const maintenant = useMinute();
  const agentsDeLaCarte = Object.values(state.agents).filter((a) => a.cardId === card.id);
  const sansSuite = mentionSansSuite(
    {
      column: card.column,
      finDuDernierTour: agentsDeLaCarte.reduce((fin, a) => Math.max(fin, a.endedAt ?? 0), 0) || undefined,
      agentActif: agentsDeLaCarte.some((a) => a.status === 'running' || a.status === 'starting'),
      decisionEnAttente: decisions > 0,
    },
    maintenant,
  );

  const etat = etatVisuelCarte({
    agentStatut: agent?.status,
    analyseEnCours,
    chiffrageEnCours: analysing,
    enAttente: !!waiting,
    estimationEchouee: estimateFailed,
    enLigne: !!card.deployedAt,
    // « Rendu, pas encore lu » : tant que la conversation n'a pas été ouverte,
    // le voyant devient le point bleu — la même règle que la ligne du projet.
    agentFiniA: agent?.endedAt,
    luA: card.lastReadAt,
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
        // Le seul repère des scripts de vérification pour retrouver UNE carte.
        data-carte={card.id}
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
          {/* Le triangle passe AVANT le voyant : une décision attendue prime
              sur l'état d'avancement, elle est ce qui demande un geste. */}
          <RepereAttention compte={decisions} className="mt-[2px]" data-attention-carte={card.id} />
          {/* Le voyant est à DROITE, au bout de la ligne du titre. */}
          {etat === 'travaille' ? (
            <Loader2 className="mt-[3px] h-3 w-3 shrink-0 animate-spin text-success" />
          ) : etat === 'termine-non-lu' ? (
            // Le point bleu : le travail est rendu mais sa conversation n'a pas
            // encore été ouverte. Même sens et même couleur que sur la ligne du
            // projet ; l'ouvrir laisse place à la coche verte.
            <Tooltip label="Travail rendu, pas encore lu">
              <span
                data-carte-non-lue={card.id}
                className="mt-[3px] h-2 w-2 shrink-0 rounded-full bg-info animate-pulse-soft motion-reduce:animate-none"
              />
            </Tooltip>
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
         * Le triangle DIT qu'une décision attend ; ce bouton y EMMÈNE. Sans
         * lui, il fallait deviner qu'ouvrir la carte menait au champ de
         * réponse — le repère montrait un travail à faire sans dire par où le
         * prendre. Il ne s'affiche que lorsqu'il a du sens, comme tout bouton
         * de décision, et ouvre le tiroir sur la conversation, là où la
         * question et son champ attendent.
         */}
        {decisions > 0 ? (
          <button
            type="button"
            data-repondre-carte={card.id}
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
            className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded border border-warning/40 bg-warning/10 px-1.5 py-1 text-[12px] font-medium leading-snug text-warning transition-colors hover:bg-warning/20"
          >
            <MessageSquare className="h-3 w-3 shrink-0" />
            {decisions > 1 ? `Répondre (${decisions})` : 'Répondre'}
          </button>
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
         * Le tour est fini, personne n'a repris : on l'écrit là où on cherche
         * l'état de la carte, en gris pâle. Ce n'est pas une alerte — rien
         * n'est cassé —, c'est une carte qui attend qu'on s'en occupe.
         */}
        {sansSuite ? (
          <div className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-snug text-faint">
            <Clock className="mt-[2px] h-3 w-3 shrink-0" />
            <span className="min-w-0" data-mention-sans-suite>
              {sansSuite}
            </span>
          </div>
        ) : null}

        {/*
         * Une carte ressortie d'« Archivé » ne fait pas semblant de n'y être
         * jamais allée : elle porte la date de son passage, en gris pâle. Dans
         * la colonne « Archivé » elle-même, la mention ne s'affiche pas — la
         * colonne le dit déjà.
         */}
        {mentionArchivage(card) ? (
          <div className="mt-1.5 flex items-center gap-1 text-[12px] text-faint">
            <Archive className="h-2.5 w-2.5 shrink-0" />
            <span className="min-w-0 truncate" data-mention-archivage>
              {mentionArchivage(card)}
            </span>
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
            <span
              className="min-w-0 flex-1 truncate"
              data-progression-taches={'marqueur' in statut && statut.marqueur === 'progression-taches' ? card.id : undefined}
            >
              {statut.texte}
            </span>
          </span>
        </div>
      ) : null}
    </div>
  );
}
