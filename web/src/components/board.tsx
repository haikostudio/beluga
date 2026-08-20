import * as React from 'react';
import { Plus, Rocket, CalendarClock, Clock, AlertTriangle, Info, Loader2, Archive, Check, Play, MessageSquare, ListChecks, Bot, EllipsisVertical, CheckCheck, Globe, Paperclip, Route, RotateCcw, X } from 'lucide-react';
import {
  Attachment,
  COLUMN_KEYS,
  COLUMN_LABELS,
  Card,
  ColumnKey,
  AvancementColonne,
  CiblePublication,
  RefusDeLot,
  MARGE_DE_CHARGEMENT_PX,
  cartesDuPaquet,
  paquetSuivant,
  paquetsPourVoir,
  resteDesCartes,
  procedureEnPlace,
  avancementDeLaColonne,
  bilanDeLot,
  bilanEnRoute,
  PLAFOND_ATTENTE_LOT_MS,
  partsDuLot,
  canMove,
  cleColonneTableau,
  colonneAReprendre,
  colonneAffichee,
  compteurDeColonne,
  phraseDeColonneVide,
  TravailSansCarte,
  decisionsParCarte,
  etapeDeLaColonne,
  etatVisuelCarte,
  libelleDuLotDeLancement,
  lireDateDeDepart,
  MENTION_REPRISE_COURTE,
  mentionArchivage,
  mentionDeReprise,
  mentionCreneauConseille,
  mentionDepartProgramme,
  phraseDepartProgramme,
  RAISON_ATTENTE_LANCEMENT,
  imageDuPersonnage,
  animeDuPersonnage,
  gesteDuPersonnage,
  agentTientSonTour,
  COLONNES_ANIMEES,
  runDeLEtape,
  mentionProgressionTaches,
  mentionSansSuite,
  natureDeLaMention,
  phraseDuTravailRestant,
  travailRestant,
  repereVisible,
  sortieAutorisee,
} from '@haikodev/shared';
import { RepereAttention } from '@/components/repere-attention';
import { IconeMoteur } from '@/components/icone-moteur';
import { nomCourtMoteur } from '@/components/run-selectors';
import { SilhouetteTableau } from '@/components/silhouettes';
import { InfoTravail } from '@/components/info-travail';
import { dureeLisible } from '@/components/arret-agent';
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
  Switch,
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
import { useSurvol } from '@/lib/pointeur';
import { useAnimationsReduites } from '@/lib/animations-reduites';
import { useMinute } from '@/lib/horloge';
import { cn, relativeTime } from '@/lib/utils';
import {
  DeployPanel,
  BoutonInfosPublication,
  InfosPublication,
  AlerteTravailSansCarte,
} from '@/components/deploy-panel';
import { useFlipColonne, useGroupesDeProduction } from '@/components/groupes-production';
import { BoutonReglagesProcedure, TiroirProcedure } from '@/components/procedure-panel';
import { AttachmentPreview, AttachmentThumb } from '@/components/attachment-preview';
import { t, formatRegional } from '@/lib/langue';

/**
 * Ce qu'un pied de colonne sait faire en lot. UN SEUL mécanisme, en deux temps :
 * le premier clic sort les cases à cocher (toutes cochées), le second applique
 * à ce qui est resté coché le MÊME geste que le bouton du tiroir. Seules les
 * colonnes listées ici ont un pied : ailleurs, le geste de masse n'a pas de sens.
 */
type ActionDeLot = {
  /** Le bouton au repos. */
  libelle: string;
  icone: React.ComponentType<{ className?: string }>;
  /** Le bouton de confirmation, suivi du nombre de cartes cochées. */
  verbe: string;
  /**
   * La colonne d'arrivée, quand le geste EST un déplacement. Un geste qui ne
   * déplace RIEN laisse ce champ vide : le lot appelle alors `validerCarte`, le
   * même geste que le bouton du tiroir. Aujourd'hui les cinq entrées déplacent
   * toutes — « Planifié » n'a plus qu'un pied, « Tout lancer ».
   */
  cible?: ColumnKey;
  /** Le participe passé féminin, pour le compte rendu : « 2 cartes lancées ». */
  participe: string;
  /**
   * Les cartes partent-elles ENSEMBLE ? Par défaut, un lot les traite l'une
   * après l'autre (l'archivage écrit un document — huit demandes d'un coup se
   * marcheraient dessus). « Tout lancer » fait exception :
   * chaque carte lancée obtient SA copie de travail et sa branche, donc rien ne
   * les empêche de démarrer en parallèle, et l'utilisateur voit les robots
   * s'allumer ensemble au lieu d'attendre en file.
   */
  parallele?: boolean;
};

const ACTIONS_DE_LOT: Partial<Record<ColumnKey, ActionDeLot>> = {
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

const CLE_TOUT_REPRENDRE = 'Tout reprendre';

/**
 * LE PIED DE COLONNE, ADAPTÉ À CE QU'IL Y A DEDANS.
 *
 * Un seul cas le fait changer de mot : « Planifié » où TOUTES les cartes ont
 * déjà travaillé. Le lot ne lance alors rien de neuf, il REPREND — et le dire
 * évite de croire qu'on va repayer le travail déjà fait. Une seule carte jamais
 * lancée dans le tas, et le pied redit « Tout lancer » : on ne promet pas une
 * reprise à des cartes qui partent de zéro.
 */
function actionDeLot(colonne: ColumnKey, cartes: Card[]): ActionDeLot | undefined {
  const brut = ACTIONS_DE_LOT[colonne];
  if (!brut) return undefined;
  const action = { ...brut, libelle: t(brut.libelle), verbe: t(brut.verbe) };
  if (colonne !== 'planned') return action;
  const libelle = libelleDuLotDeLancement(cartes);
  if (libelle !== CLE_TOUT_REPRENDRE) return { ...action, libelle: t(libelle) };
  return { ...action, libelle: t(libelle), verbe: t('Reprendre'), icone: RotateCcw };
}

/**
 * Le menu à trois points d'une tête de colonne. UNE seule entrée :
 * « Marquer tout comme lu », qui éteint le point bleu de toutes les cartes non
 * lues de CETTE colonne. On ne réinvente rien côté serveur : on rejoue la
 * commande `card.read` (celle qu'envoie l'ouverture d'une conversation) pour
 * chaque carte non lue.
 *
 * Sans carte non lue, pas de bouton — nulle part. Le réglage du déploiement
 * vivait ici, par colonne ; il a rejoint le bloc « Mise en production » des
 * réglages du projet, à côté des environnements, parce qu'un réglage du projet
 * n'a rien à faire dans une colonne du tableau. Sur téléphone,
 * `DropdownMenuContent` devient un tiroir bas.
 */
function MenuTeteColonne({ colonne, cartesNonLues }: { colonne: ColumnKey; cartesNonLues: Card[] }) {
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
          data-menu-colonne={colonne}
        >
          <EllipsisVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={toutMarquerLu}>
          <CheckCheck className="h-3.5 w-3.5" />  {t('Marquer tout comme lu')}
</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * L'INTERRUPTEUR « DÉPLOIEMENT AUTOMATIQUE », en tête de la colonne
 * « Terminé ». ÉTEINT par défaut, et son état vit sur le PROJET : allumé, il
 * vaut consentement permanent pour ce projet-là — dès que plus rien ne
 * travaille, le lot de « Terminé » passe tout seul dans « À déployer » et la
 * mise en ligne part, sans clic sur « Publier maintenant ».
 *
 * Il ne décide de rien lui-même : il n'écrit qu'un réglage. Ce qui retient ou
 * lance le lot est une règle pure, jouée par le serveur
 * (`shared/src/deploiement-automatique.ts`).
 *
 * Le clic le dit DÈS le clic (`attente`), et l'affichage suit l'état voulu
 * pendant l'aller-retour : sans cela l'interrupteur revenait visuellement en
 * arrière le temps que le projet revienne du serveur.
 */
function InterrupteurDeploiementAuto({ projectId, actif }: { projectId: string; actif: boolean }) {
  const [enVol, setEnVol] = React.useState<boolean | null>(null);

  // Le serveur a parlé : on lâche l'état optimiste et on suit de nouveau le projet.
  React.useEffect(() => {
    setEnVol((vise) => (vise === null || vise === actif ? null : vise));
  }, [actif]);

  const basculer = (valeur: boolean) => {
    setEnVol(valeur);
    client
      .call({ type: 'project.update', id: projectId, patch: { deploiementAutomatique: valeur } })
      .catch(() => setEnVol(null));
  };

  const affiche = enVol ?? actif;
  return (
    <Tooltip
      label={t(
        'Déploiement automatique : dès que plus rien ne travaille sur ce projet, les cartes terminées passent dans « À déployer » et la mise en ligne part toute seule.',
      )}
    >
      <span className="mr-1 inline-flex items-center">
        <Switch
          checked={affiche}
          attente={enVol !== null}
          onCheckedChange={basculer}
          aria-label="Déploiement automatique"
          data-deploiement-automatique={affiche ? 'oui' : 'non'}
        />
      </span>
    </Tooltip>
  );
}

/**
 * L'avancement global des travaux en cours, en haut à droite de la colonne
 * « En cours » : un pourcentage, rien d'autre.
 *
 * Il ne réinvente aucune couleur — l'ORANGE de ce qui est en cours, le BLEU de
 * ce qui est terminé, les deux jetons déjà partout dans l'application. Le
 * calcul, lui, ne vit pas ici : `avancementDeLaColonne` décide aussi quand se
 * taire, et on rend alors `null`.
 */
function RepereAvancement({ avancement }: { avancement: AvancementColonne | null }) {
  if (!avancement) return null;
  const { done, total, pourcent, termine } = avancement;
  return (
    <Tooltip label={t('{done} étape{v0} faite{v1} sur {total}', { done, v0: done > 1 ? 's' : '', v1: done > 1 ? 's' : '', total })}>
      <span
        data-avancement-colonne="running"
        className={cn(
          'shrink-0 px-0.5 text-[12.5px] font-medium tabular-nums',
          termine ? 'text-termine' : 'text-en-cours',
        )}
      >
        {pourcent} %
      </span>
    </Tooltip>
  );
}

/**
 * LE PALIER DE CHARGEMENT, sous la dernière carte posée d'une colonne.
 *
 * Un seul élément observé par colonne : dès qu'il approche de l'écran, le
 * paquet suivant est demandé. On n'écoute donc rien à chaque pixel de
 * défilement — c'est le navigateur qui prévient, une fois.
 *
 * L'observateur est REFAIT dès que le nombre de cartes posées change : sans
 * cela, une colonne dont le nouveau paquet tiendrait entièrement dans la marge
 * de chargement s'arrêterait là, faute d'un nouveau franchissement à observer.
 * Le refaire redemande aussitôt l'état du palier, et la suite continue d'arriver.
 */
function PalierDeChargement({
  colonne,
  posees,
  restant,
  onCharger,
}: {
  colonne: ColumnKey;
  posees: number;
  restant: number;
  onCharger: () => void;
}) {
  const ancre = React.useRef<HTMLDivElement>(null);
  // Le rappel change à chaque rendu du tableau : on le garde dans une référence
  // pour ne pas refaire l'observateur pour si peu.
  const rappel = React.useRef(onCharger);
  rappel.current = onCharger;

  React.useEffect(() => {
    const noeud = ancre.current;
    if (!noeud) return;
    const observateur = new IntersectionObserver(
      (entrees) => {
        if (entrees.some((entree) => entree.isIntersecting)) rappel.current();
      },
      { rootMargin: `${MARGE_DE_CHARGEMENT_PX}px` },
    );
    observateur.observe(noeud);
    return () => observateur.disconnect();
  }, [posees]);

  return (
    <div
      ref={ancre}
      data-palier-cartes={colonne}
      data-cartes-restantes={restant}
      className="px-1.5 py-2 text-center text-[12px] text-faint"
    >
      {t('{restant} carte{v0} de plus…', { restant, v0: restant > 1 ? 's' : '' })}</div>
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

  /*
   * Où RANGER chaque carte — pas où elle est enregistrée. Une carte dont un
   * agent travaille ne peut pas être affichée ailleurs qu'en « En cours », même
   * si sa colonne connue est restée en arrière (requête de lancement qui
   * n'aboutit pas, événement en retard). La règle est partagée et testée
   * (`colonneAffichee`) ; ici on ne fait que lui dire si un agent tourne.
   *
   * Tout le tableau passe par `byColumn` : colonnes, comptes des en-têtes,
   * onglets du téléphone et lots voient donc la MÊME carte au MÊME endroit.
   */
  /*
   * LES AGENTS AU TRAVAIL, RANGÉS PAR CARTE — une seule fois par rendu.
   * Chaque carte allait auparavant relire TOUS les agents pour savoir si l'un
   * d'eux travaillait sur elle, et `byColumn` était rappelé pour chaque colonne,
   * chaque onglet et chaque lot : quelques centaines de cartes multipliées par
   * quelques dizaines d'agents, sept fois par rendu. On construit donc l'index
   * une fois, et tout le monde le lit.
   */
  const travailParCarte = React.useMemo(() => {
    const index = new Set<string>();
    for (const agent of Object.values(state.agents)) {
      if (agent.cardId && agentTientSonTour(agent)) index.add(agent.cardId);
    }
    return index;
  }, [state.agents]);

  /*
   * Toutes les colonnes rangées d'un coup : `byColumn` n'est plus qu'une
   * lecture dans cet index, au lieu d'un filtre complet sur toutes les cartes.
   */
  const parColonne = React.useMemo(() => {
    const index = Object.fromEntries(COLUMN_KEYS.map((cle) => [cle, [] as Card[]])) as Record<ColumnKey, Card[]>;
    for (const card of cards) {
      index[colonneAffichee({ column: card.column, agentAuTravail: travailParCarte.has(card.id) })].push(card);
    }
    return index;
  }, [cards, travailParCarte]);

  const byColumn = (column: ColumnKey) => parColonne[column];

  /*
   * LES CARTES MISES EN LIGNE ENSEMBLE, RANGÉES ENSEMBLE.
   *
   * Appelé ICI, une seule fois pour tout le tableau — jamais dans la boucle des
   * colonnes, où ce serait un crochet sous condition. Il ne travaille que pour
   * « En production » : ailleurs il ne demande rien et rend les cartes telles
   * quelles.
   *
   * L'état de la publication du projet lui sert de RÉVEIL : la fin d'un
   * déploiement crée justement le groupe qu'on veut voir apparaître.
   */
  const production = useGroupesDeProduction(
    projectId,
    parColonne.in_production,
    true,
    state.deploys[projectId]?.state,
  );
  /* Le vrai glissement d'un groupe qui se plie ou se déplie : posé sur la
     colonne « En production » (seule à grouper), il traduit chaque
     changement de pli en translation pour toutes les lignes suivies par
     `data-carte-flip`. */
  const colonneProductionRef = React.useRef<HTMLDivElement | null>(null);
  useFlipColonne(colonneProductionRef, [production.depliesKey, production.cartes.map((c) => c.id).join(',')]);

  /*
   * COMBIEN DE PAQUETS DE VINGT chaque colonne a déjà posés dans la page.
   * Une colonne part toujours à un paquet ; le suivant arrive quand le palier
   * de chargement, posé sous la dernière carte, approche de l'écran. Le
   * COMPTEUR de la tête de colonne, lui, ne lit jamais ce nombre : il dit le
   * total réel (`columnCards.length`), sinon il mentirait tant qu'on n'a pas
   * fait défiler.
   */
  const [paquets, setPaquets] = React.useState<Partial<Record<ColumnKey, number>>>({});
  // Changer de projet, c'est changer de tableau : chaque colonne repart à un paquet.
  React.useEffect(() => setPaquets({}), [projectId]);
  const chargerLaSuite = React.useCallback((column: ColumnKey, total: number) => {
    setPaquets((avant) => {
      const courant = avant[column] ?? 1;
      const suivant = paquetSuivant(courant, total);
      return suivant === courant ? avant : { ...avant, [column]: suivant };
    });
  }, []);
  /** Tout poser d'un coup : une sélection en lot doit voir TOUTE la colonne. */
  const toutPoser = React.useCallback((column: ColumnKey, total: number) => {
    setPaquets((avant) => ({ ...avant, [column]: paquetsPourVoir(total - 1) }));
  }, []);

  /*
   * L'avancement GLOBAL de « En cours » : la même matière que le « n/N faites »
   * de chaque carte (le décompte porté par l'agent d'exécution), additionnée
   * pour toute la colonne. On lit l'agent de rôle « task » encore au travail,
   * exactement comme la carte le fait — un avancement figé ou celui d'une
   * analyse ne compte pas. La règle du calcul et de ses silences vit dans
   * `avancementDeLaColonne` ; ici on ne fait que rassembler la matière, et elle
   * se remet à jour toute seule puisque les agents sont diffusés en direct.
   */
  /*
   * …et « au travail » se lit avec la MÊME règle que le témoin d'une
   * conversation (`agentTientSonTour`, `shared/src/travail-en-cours.ts`) : le TOUR
   * VIVANT d'abord, le statut ensuite. Sans lui, le personnage de « En cours »
   * cessait de piocher dès la réponse rendue, alors que le démon rangeait encore
   * le tour (constat du dépôt, branche fusionnée) — l'immobilité disait « c'est
   * fini » avant que ce le soit.
   */
  const agentsTacheParCarte = React.useMemo(() => {
    const index = new Map<string, (typeof state.agents)[string]>();
    for (const agent of Object.values(state.agents)) {
      if (agent.cardId && agent.role === 'task' && agentTientSonTour(agent)) {
        if (!index.has(agent.cardId)) index.set(agent.cardId, agent);
      }
    }
    return index;
  }, [state.agents]);
  const agentTacheActif = (card: Card) => agentsTacheParCarte.get(card.id);

  /*
   * Le geste du personnage se décide plus bas, colonne par colonne ; ce qu'il
   * faut savoir de l'ÉCRAN se lit une seule fois ici. Et la boucle animée est
   * DEMANDÉE D'AVANCE : sans cela, le premier coup de pioche attendrait le
   * réseau, et la tête de colonne resterait vide juste au moment où l'on veut
   * voir que ça démarre. Une image demandée et jamais montrée ne coûte que son
   * entrée dans le cache du navigateur.
   */
  const animationsReduites = useAnimationsReduites();
  React.useEffect(() => {
    if (animationsReduites) return;
    for (const colonne of COLONNES_ANIMEES) new Image().src = animeDuPersonnage(colonne);
  }, [animationsReduites]);
  const avancementDeCesCartes = (cartes: Card[]) =>
    avancementDeLaColonne(
      cartes.map((card) => {
        const agent = agentTacheActif(card);
        return { agentActif: !!agent, todos: agent?.todos };
      }),
    );

  /*
   * Les textes informatifs de la publication, remontés par le bloc de chaque
   * colonne qui publie : le bouton « ! » de la tête de colonne les affiche à la
   * demande, au lieu de les empiler sous le bouton et de repousser les cartes.
   */
  const [infosPublication, setInfosPublication] = React.useState<
    Partial<Record<ColumnKey, InfosPublication | null>>
  >({});

  /*
   * LE TRAVAIL ENREGISTRÉ SANS CARTE POUR LE PORTER, remonté par le bloc de
   * publication de chaque colonne qui publie.
   *
   * Il servait à GONFLER le chiffre de la tête de colonne — « À DÉPLOYER 1 »
   * pendant que la colonne écrivait dessous « Rien à mettre en ligne pour
   * l'instant », puisqu'il n'y avait justement aucune carte à afficher. Le
   * compteur est rendu à la liste (`columnCards.length`, et rien d'autre) et
   * ce travail s'écrit désormais EN CLAIR dans la colonne, au-dessus des
   * cartes. Règle et textes : `shared/src/colonne-a-deployer.ts`.
   */
  const [sansCarte, setSansCarte] = React.useState<Partial<Record<ColumnKey, TravailSansCarte | null>>>({});

  /*
   * LA COLONNE DONT LA FENÊTRE DE CRÉATION EST OUVERTE. La fenêtre est posée en
   * `absolute` DANS l'entête de colonne, qui porte `isolate` : son `z-index`
   * reste donc enfermé dans le plan d'empilement de l'entête et ne se compare
   * jamais à celui de la zone qui défile — laquelle vient APRÈS dans le DOM,
   * est elle aussi positionnée, et se peint par conséquent PAR-DESSUS tout ce
   * qui dépasse sous l'entête. Seul le titre, qui tient dans la hauteur de
   * l'entête, recevait encore les clics : la description, « Ajouter la note »,
   * « Joindre » et « Annuler » étaient recouverts, et la fenêtre restait
   * bloquée sans même pouvoir être fermée. On relève donc l'entête ENTIER
   * au-dessus de la zone qui défile, mais UNIQUEMENT tant que sa fenêtre est
   * ouverte : hors de ce moment, l'ordre d'empilement d'origine ne bouge pas.
   */
  const [composerOuvert, setComposerOuvert] = React.useState<ColumnKey | null>(null);

  /*
   * LE TIROIR DE PROCÉDURE, tenu par le tableau parce qu'il s'ouvre de DEUX
   * endroits : le bouton « Initier… » du bloc de publication, et l'icône de
   * réglages de la tête de colonne. Un seul tiroir, une seule cible à la fois —
   * celle de la colonne d'où l'on vient.
   */
  const [procedureOuverte, setProcedureOuverte] = React.useState<CiblePublication | null>(null);
  /* Le projet ouvert, tel que l'écran le connaît déjà : c'est lui qui dit si la
     procédure d'une colonne est définie, sans rien demander au serveur. */
  const projetOuvert = state.projects.find((p) => p.id === projectId);

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
      analyseEnCours: travailParCarte.has(card.id),
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
    // pas afficher deux chiffres différents. AUCUNE colonne n'y ajoute quoi que
    // ce soit — le travail sans carte a son propre encart, il ne se compte pas
    // ici (`shared/src/colonne-a-deployer.ts`).
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
    return { attention, rendus, travaille, total: compteurDeColonne(total) };
  };

  /*
   * On rouvre le tableau LÀ OÙ on l'avait laissé : la colonne regardée est
   * retenue projet par projet, en base. Sans souvenir (ou si la colonne
   * enregistrée n'existe plus), on revient au comportement d'origine : sur
   * téléphone « Planifié », sinon on ouvre sur des notes souvent vides.
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

  /*
   * Tant que les cartes du projet ne sont pas arrivées, le tableau rend la
   * SILHOUETTE (plus bas) : ni le rail ni la barre d'onglets n'existent
   * encore dans la page, les refs restent `null`. Les effets qui suivent
   * doivent donc se RELANCER dès que ce chargement bascule — sinon, sur un
   * projet fraîchement ouvert, ils s'exécutent une seule fois avec des refs
   * introuvables et ne s'y raccrochent jamais, même une fois le tableau
   * réellement affiché : leurs autres dépendances ne changent pas entre les
   * deux rendus, React ne les rejoue donc pas de lui-même.
   */
  const tableauCharge = !!state.cartesChargees[projectId];

  /*
   * L'onglet actif a-t-il des VOISINS CACHÉS DES DEUX CÔTÉS de sa propre
   * barre (qui glisse, elle aussi, une fois les colonnes plus nombreuses que
   * la largeur de l'écran) ? Un repère discret — un fondu à chaque bord — ne
   * s'allume que dans ce cas précis : au tout début ou à la toute fin de la
   * barre, un seul côté suffit à dire où sont les onglets restants, le fondu
   * de l'AUTRE bord n'apprendrait rien.
   */
  const [voisinsMasques, setVoisinsMasques] = React.useState({ gauche: false, droite: false });

  const mesurerVoisinsMasques = React.useCallback(() => {
    const barre = barreOnglets.current;
    if (!barre) return;
    const marge = 4;
    setVoisinsMasques({
      gauche: barre.scrollLeft > marge,
      droite: barre.scrollLeft + barre.clientWidth < barre.scrollWidth - marge,
    });
  }, []);

  React.useEffect(() => {
    const barre = barreOnglets.current;
    if (!barre) return;
    mesurerVoisinsMasques();
    barre.addEventListener('scroll', mesurerVoisinsMasques, { passive: true });
    const suivi = new ResizeObserver(mesurerVoisinsMasques);
    suivi.observe(barre);
    return () => {
      barre.removeEventListener('scroll', mesurerVoisinsMasques);
      suivi.disconnect();
    };
  }, [telephone, tableauCharge, mesurerVoisinsMasques]);

  /*
   * L'onglet lui-même est amené au CENTRE de sa barre défilante — même geste
   * que le second temps d'`allerALaColonne`, extrait pour servir aussi au
   * défilement du tableau et au chargement initial. Sur ordinateur la barre
   * n'existe pas (`barreOnglets` reste vide) : rien ne bouge.
   */
  const centrerOngletDansLaBarre = React.useCallback((cle: ColumnKey, comportement: ScrollBehavior) => {
    const barre = barreOnglets.current;
    const onglet = barre?.querySelector<HTMLElement>(`[data-onglet-colonne="${cle}"]`);
    if (!barre || !onglet) return;
    const rectBarre = barre.getBoundingClientRect();
    const rectOnglet = onglet.getBoundingClientRect();
    const decalage =
      rectOnglet.left + rectOnglet.width / 2 - (rectBarre.left + rectBarre.width / 2);
    barre.scrollTo({ left: barre.scrollLeft + decalage, behavior: comportement });
  }, []);

  React.useEffect(() => {
    if (!tableauCharge) return;
    const memorisee = colonneAReprendre(readPref(cleColonneTableau(projectId), null));
    const voulue = memorisee ?? (window.innerWidth < 640 ? 'planned' : null);
    if (voulue) {
      const cible = rail.current?.querySelector<HTMLElement>(`[data-column="${voulue}"]`);
      if (cible) rail.current!.scrollLeft = cible.offsetLeft - 12;
    }
    // L'onglet actif part de la colonne réellement au bord après ce placement.
    const active = colonneAuBord();
    setColonneActive(active);
    if (active) centrerOngletDansLaBarre(active, 'auto');
  }, [projectId, tableauCharge, colonneAuBord, centrerOngletDansLaBarre]);

  /*
   * Au défilement, l'onglet actif suit le doigt TOUT DE SUITE (sinon la mise en
   * évidence traînerait), et se recentre dans sa barre dès qu'il change — sinon
   * il reste collé au bord de la barre une fois le tableau parvenu tout à
   * droite ou tout à gauche, comme au chargement. L'écriture en base, elle,
   * attend une demi-seconde après l'arrêt du doigt : pendant un défilé, chaque
   * pixel n'a pas à traverser le réseau.
   */
  React.useEffect(() => {
    const node = rail.current;
    if (!node) return;
    let timer = 0;
    let derniereColonne: ColumnKey | null = null;
    const noter = () => {
      const cle = colonneAuBord();
      setColonneActive(cle);
      if (cle && cle !== derniereColonne) {
        derniereColonne = cle;
        centrerOngletDansLaBarre(cle, 'smooth');
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
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
  }, [projectId, tableauCharge, colonneAuBord, centrerOngletDansLaBarre]);

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
    centrerOngletDansLaBarre(cle, 'smooth');
    setColonneActive(cle);
  }, [centrerOngletDansLaBarre]);

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
      client.pushToast('error', decision.reason ?? t('déplacement refusé'));
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
      client.pushToast('warning', sortie.raison ?? t('déplacement refusé'));
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
  /*
   * QUELLE colonne a un geste en vol — pas un simple « oui / non ». Un seul
   * drapeau pour tout le tableau éteignait les boutons d'une colonne à cause du
   * geste d'une AUTRE : on ouvrait le pied de « Terminé » pendant qu'un « Tout
   * lancer » attendait encore, et « Déployer » y naissait déjà bloqué.
   */
  const [colonneQuiTravaille, setColonneQuiTravaille] = React.useState<ColumnKey | null>(null);
  /*
   * L'ANCRE d'une plage : la dernière carte cochée au clavier. Maj+clic prend
   * tout ce qui va d'ici à la carte visée, dans la même colonne. Un ref, pas un
   * état : la changer ne doit pas redessiner le tableau.
   */
  const ancreSelection = React.useRef<string | null>(null);
  // Les raccourcis clavier (Ctrl/Cmd, Maj) ne valent qu'au pointeur fin : au
  // doigt, il n'y a pas de touche à tenir, et le clic simple garde son rôle.
  const survolPossible = useSurvol();

  const cartesEnSelection = colonneEnLot ? byColumn(colonneEnLot) : [];
  // Changer de projet, ou vider la colonne, referme le mode : il n'aurait plus
  // rien à cocher, et le pied resterait sur des boutons sans effet.
  React.useEffect(() => {
    setColonneEnLot(null);
    setSelection([]);
    ancreSelection.current = null;
    // Les infos de publication appartiennent au projet quitté : on repart net,
    // chaque bloc les remontera pour le nouveau projet.
    setInfosPublication({});
  }, [projectId]);
  React.useEffect(() => {
    if (colonneEnLot && !cartesEnSelection.length) setColonneEnLot(null);
  }, [colonneEnLot, cartesEnSelection.length]);
  // La colonne en lot, lisible depuis un geste déjà parti (qui, lui, ne voit
  // que l'état du rendu où il a démarré).
  const colonneEnLotRef = React.useRef<ColumnKey | null>(null);
  React.useEffect(() => {
    colonneEnLotRef.current = colonneEnLot;
  }, [colonneEnLot]);

  const ouvrirLot = (column: ColumnKey) => {
    const cartesDeLaColonne = byColumn(column);
    // Une sélection porte sur TOUTE la colonne : on pose donc toutes ses cartes
    // dans la page, sinon on décocherait à l'aveugle ce qu'on ne voit pas.
    toutPoser(column, cartesDeLaColonne.length);
    setSelection(cartesDeLaColonne.map((card) => card.id));
    setColonneEnLot(column);
  };

  /*
   * Refermer le mode sélection. `seulementSi` sert au geste qui se termine :
   * pendant qu'il partait, l'utilisateur a pu ouvrir le pied d'une AUTRE
   * colonne — sa sélection ne doit pas être balayée par la fin du geste
   * précédent.
   */
  const fermerLot = (seulementSi?: ColumnKey) => {
    if (seulementSi && colonneEnLotRef.current !== seulementSi) return;
    setColonneEnLot(null);
    setSelection([]);
    ancreSelection.current = null;
  };

  const basculer = (cardId: string) =>
    setSelection((liste) => (liste.includes(cardId) ? liste.filter((id) => id !== cardId) : [...liste, cardId]));

  /*
   * Le clic sur une carte, modificateurs compris. Sans touche, c'est le geste
   * d'avant : en mode lot, la case bascule ; sinon le tiroir s'ouvre. Avec
   * Ctrl/Cmd ou Maj (et un pointeur fin), on COMPOSE une sélection au lieu
   * d'ouvrir — on réutilise l'état `selection` et le pied de lot déjà en place.
   * Ctrl/Cmd bascule la carte ; Maj prend la plage depuis l'ancre. Une plage
   * reste dans la colonne cliquée ; changer de colonne repart d'une sélection
   * vide (une seule colonne en lot à la fois).
   */
  const clicCarte = (card: Card, column: ColumnKey, event?: React.MouseEvent) => {
    const clavier = survolPossible && event && (event.ctrlKey || event.metaKey || event.shiftKey);
    if (!clavier) {
      if (colonneEnLot === column) {
        basculer(card.id);
        ancreSelection.current = card.id;
      } else {
        onOpenCard(card.id);
      }
      return;
    }
    if (!event) return;
    // Contrairement au bouton de lot (qui coche tout), on démarre une sélection
    // VIDE sur cette colonne : le clavier sert à choisir, pas à tout prendre.
    if (colonneEnLot !== column) {
      setColonneEnLot(column);
      setSelection([card.id]);
      ancreSelection.current = card.id;
      return;
    }
    if (event.shiftKey) {
      const ids = byColumn(column).map((c) => c.id);
      const depart = ancreSelection.current ? ids.indexOf(ancreSelection.current) : -1;
      const arrivee = ids.indexOf(card.id);
      if (depart >= 0 && arrivee >= 0) {
        const [a, b] = depart <= arrivee ? [depart, arrivee] : [arrivee, depart];
        const plage = ids.slice(a, b + 1);
        setSelection((liste) => Array.from(new Set([...liste, ...plage])));
      } else {
        // Sans ancre valable, Maj+clic vaut un simple ajout.
        setSelection((liste) => (liste.includes(card.id) ? liste : [...liste, card.id]));
        ancreSelection.current = card.id;
      }
    } else {
      basculer(card.id);
      ancreSelection.current = card.id;
    }
  };

  /*
   * Une carte tentée par le lot : on rejoue le MÊME appel que le bouton du
   * tiroir. Le résultat est mis en compte par l'appelant. Un refus n'arrête
   * jamais le lot (« Tout lancer » sur un projet occupé refuse les suivantes,
   * et chacune doit être tentée pour recevoir sa raison) ; le `catch` couvre
   * l'imprévu (réseau coupé).
   */
  const tenterUneCarte = async (id: string, action: ActionDeLot): Promise<'faite' | RefusDeLot | null> => {
    const card = client.getSnapshot().cards[id];
    if (!card) return null;
    try {
      const issue = action.cible
        ? await client.moveCard(card, action.cible, { silencieux: true })
        : await client.validerCarte(card, { silencieux: true });
      return issue.ok ? 'faite' : { titre: card.title, raison: issue.error };
    } catch (err: any) {
      return { titre: card.title, raison: err?.message };
    }
  };

  const appliquerLot = async (action: ActionDeLot, colonne: ColumnKey) => {
    setColonneQuiTravaille(colonne);
    let faites = 0;
    const refusees: RefusDeLot[] = [];
    const compter = (issue: 'faite' | RefusDeLot | null) => {
      if (issue === 'faite') faites += 1;
      else if (issue) refusees.push(issue);
    };
    const nomProjet = state.projects.find((p) => p.id === projectId)?.name;

    /*
     * LE PIED REND LA MAIN, MÊME SI LE SERVEUR PREND SON TEMPS.
     *
     * Les commandes sont parties ; les garder en otage n'accélère rien et fige
     * l'écran — roue qui tourne sur le bouton, « Annuler » éteint, plus rien de
     * cliquable. Au bout du plafond, on referme la sélection, on rallume les
     * boutons et on DIT que le geste est en route. Rien n'est annulé : la
     * colonne se met à jour toute seule par les événements du serveur.
     */
    const combien = selection.length;
    let mainRendue = false;
    const rendreLaMain = () => {
      if (mainRendue) return;
      mainRendue = true;
      fermerLot(colonne);
      setColonneQuiTravaille((occupee) => (occupee === colonne ? null : occupee));
    };
    const minuterie = window.setTimeout(() => {
      rendreLaMain();
      const enRoute = bilanEnRoute(combien - faites - refusees.length, nomProjet);
      client.pushToast(enRoute.niveau, enRoute.texte);
    }, PLAFOND_ATTENTE_LOT_MS);

    try {
      if (action.parallele) {
        /*
         * « Tout lancer » : les cartes partent ENSEMBLE. Chaque carte lancée a
         * sa propre copie de travail et sa branche, donc rien ne les enchaîne —
         * les appels partent d'un coup et l'utilisateur voit les robots
         * s'allumer en même temps. L'instantané est lu une fois, en tête : ces
         * cartes sont indépendantes, aucune ne change la colonne d'une autre.
         */
        const issues = await Promise.all(selection.map((id) => tenterUneCarte(id, action)));
        issues.forEach(compter);
      } else {
        /*
         * Les autres pieds restent une carte après l'autre : l'archivage écrit
         * un document de clôture, la validation déclenche un chiffrage — huit
         * demandes d'un coup se marcheraient dessus. L'état est relu à CHAQUE
         * tour de boucle, la carte précédente ayant pu changer de colonne.
         */
        for (const id of selection) {
          compter(await tenterUneCarte(id, action));
        }
      }
    } finally {
      window.clearTimeout(minuterie);
      /*
       * Le compte rendu part même si quelque chose a cassé en route : un lot
       * silencieux est exactement ce qu'on corrige ici. Une seule exception —
       * la main a déjà été rendue avec « en route » et rien de neuf n'est
       * arrivé depuis (aucun VRAI refus) : redire la même chose ferait deux
       * bulles pour un seul geste.
       */
      const bilan = bilanDeLot(action.participe, faites, refusees, nomProjet);
      if (!mainRendue || partsDuLot(faites, refusees).refusees.length) {
        client.pushToast(bilan.niveau, bilan.texte);
      }
      rendreLaMain();
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

  /*
   * LES CARTES DE CE PROJET NE SONT PAS ENCORE ARRIVÉES : le serveur les envoie
   * en un bloc (`project.snapshot`), demandé à l'ouverture du projet. Entre les
   * deux, `state.cards` ne contient rien pour ce projet — sept colonnes vides,
   * qu'on lirait comme un tableau réellement vide. On dessine donc le tableau à
   * venir en SILHOUETTE, sans toucher aux données. Un projet déchargé au bout de
   * quinze minutes repasse par là à sa réouverture.
   */
  if (!state.cartesChargees[projectId]) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <SilhouetteTableau />
      </div>
    );
  }

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
          className="relative shrink-0 px-3 py-1.5"
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
                    {t(COLUMN_LABELS[cle])}
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
                            : t('Un agent au travail')
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
                          <Bot className="h-3 w-3 shrink-0 text-en-cours" />
                          {signal.travaille > 1 ? (
                            <span className="text-[10.5px] leading-none text-en-cours">
                              {signal.travaille}
                            </span>
                          ) : null}
                        </span>
                      </Tooltip>
                    ) : null}
                    {repere === 'attention' ? (
                      <RepereAttention compte={signal.attention} data-onglet-attention={cle} />
                    ) : repere === 'rendus' ? (
                      <Tooltip label={t('Travail rendu, pas encore lu')}>
                        <span
                          data-onglet-non-lu={cle}
                          aria-label="Travail rendu, pas encore lu"
                          className="h-2 w-2 shrink-0 rounded-full bg-termine animate-pulse-soft motion-reduce:animate-none"
                        />
                      </Tooltip>
                    ) : null}
                  </span>
                </TabsTrigger>
              );
            })}
          </TabsList>
          {/*
            Repère DISCRET : l'onglet actif a des voisins cachés des DEUX
            côtés de sa barre — un fondu à chaque bord, jamais un seul (au
            tout début ou à la toute fin de la barre, il n'y a qu'un côté à
            signaler, et le bord opposé n'apprendrait rien). `pointer-events-
            none` : un pur repère, jamais un obstacle au glissement du doigt.
          */}
          {voisinsMasques.gauche && voisinsMasques.droite ? (
            <>
              <div
                aria-hidden
                data-repere-voisins-masques="gauche"
                className="pointer-events-none absolute inset-y-1.5 left-3 w-4 bg-gradient-to-r from-surface to-transparent"
              />
              <div
                aria-hidden
                data-repere-voisins-masques="droite"
                className="pointer-events-none absolute inset-y-1.5 right-3 w-4 bg-gradient-to-l from-surface to-transparent"
              />
            </>
          ) : null}
        </Tabs>
      ) : null}

      <ZoneDefilement
        ref={rail}
        axe="horizontal"
        classeEnveloppe="min-h-0 flex-1"
        className="flex gap-2.5 px-3 py-3 snap-columns"
      >
      {COLUMN_KEYS.map((column) => {
        /* « En production » range ses cartes par publication : un groupe reste
           d'un seul tenant, sinon les paquets de vingt le couperaient en deux
           et son bandeau se retrouverait sans ses cartes. Aucune carte n'est
           ajoutée ni retirée — seul l'ORDRE change, et le compteur de la tête
           lit toujours cette même liste. */
        const columnCards = column === 'in_production' ? production.cartes : byColumn(column);
        // Ce qui est RÉELLEMENT posé dans la page : le premier paquet de vingt,
        // puis un paquet de plus à chaque fois que le bas approche.
        const cartesPosees = cartesDuPaquet(columnCards, paquets[column] ?? 1);
        const action = actionDeLot(column, columnCards);
        const allowed = !carteTiree || canMove('user', carteTiree.column, column).allowed;
        /*
         * QUE FAIT LE PERSONNAGE ? On compte les cartes de CETTE colonne dont
         * un agent de tâche travaille — le même index que l'avancement, déjà
         * construit une fois pour tout le rendu. La règle (une seule colonne
         * vivante, quel geste, et quand il retombe sur le balancement) vit dans
         * `gesteDuPersonnage` ; ici on ne fait que compter et lui dire ce qu'on
         * sait de l'écran.
         */
        const auTravail = columnCards.reduce((n, card) => n + (agentsTacheParCarte.has(card.id) ? 1 : 0), 0);
        const geste = gesteDuPersonnage(column, auTravail, {
          remplace: state.personnages[column] !== undefined,
          animationsReduites,
        });
        return (
          /*
            DEUX enveloppes, et c'est le PERSONNAGE qui l'impose. Il déborde du
            coin haut-gauche de la colonne, or la colonne coupe ce qui dépasse
            (`overflow-hidden`, sans quoi les cartes sortiraient de ses coins
            arrondis) : il ne peut donc pas vivre dedans. L'enveloppe, elle, ne
            coupe rien.
            `data-column` reste posé sur ELLE — jamais sur la boîte intérieure :
            `colonneAuBord` et `allerALaColonne` lisent `offsetLeft`, qui se
            compte depuis le premier ancêtre POSITIONNÉ. Descendre l'attribut
            d'un cran le rendrait relatif à l'enveloppe (donc toujours 0) et le
            tableau ne saurait plus faire glisser une colonne au bord.
            Le CADRE et le FOND restent sur elle pour la même raison : c'est sur
            `[data-column]` que se lit la couleur de la colonne — orange pour
            « En cours », bleu pour « Terminé » (`verif-couleurs-avancement`).
            Seule la DÉCOUPE descend d'un cran.
          */
          <div
            key={column}
            data-column={column}
            className={cn(
              'relative h-full min-h-0 w-[268px] shrink-0 rounded-lg border bg-surface/70 transition-colors',
              over === column && allowed
                ? 'border-muted bg-surface'
                : column === 'running'
                  ? 'border-en-cours/70'
                  : column === 'done'
                    ? 'border-termine/70'
                    : 'border-border/60',
              carteTiree && !allowed && 'opacity-40',
            )}
          >
            {/* Le personnage de la colonne : posé en haut à GAUCHE, débordant
                d'un cheveu vers le haut et vers la gauche — assez pour qu'il ne
                paraisse pas rangé dans une case, pas assez pour manger l'espace
                des cartes. `pointer-events-none` est VITAL : le dépôt d'une
                carte se résout par `closest('[data-column]')` sur l'élément
                sous le doigt, et une image qui l'intercepterait ferait échouer
                le geste. Sa boîte est de proportion fixe (voir
                `shared/src/personnages-colonnes.ts`), donc la même hauteur vaut
                pour les sept.
                QUAND UN AGENT TRAVAILLE, celui de « En cours » PIOCHE : ce
                n'est plus la même image, c'est une boucle animée du même mineur
                donnant de vrais coups de pioche. Elle occupe exactement la même
                boîte que l'image fixe (même proportion, même appui au sol) :
                rien ne bouge autour, et le dépôt d'une carte reste insensible
                (`pointer-events-none`). Au repos, on redemande l'image FIXE —
                l'immobilité est alors totale, et c'est elle qui donne son sens
                au geste. Quand la boucle ne peut pas servir (personnage
                remplacé depuis les réglages), on retombe sur le BALANCEMENT
                d'avant : une animation de transformation, pieds au sol
                (`origin-bottom`), neutralisée par « réduire les animations »
                dans `styles.css` — préférence qui, pour une image animée, se lit
                en amont dans `gesteDuPersonnage`.
                Le personnage REMPLACÉ, lui, se sert à la MÊME adresse : seul le
                repère `?v=` change, pour que le navigateur redemande l'image au
                lieu de ressortir l'ancienne de son cache. La boucle livrée n'a
                pas ce repère : aucun dépôt ne la remplace jamais. */}
            <img
              src={geste === 'pioche' ? animeDuPersonnage(column) : imageDuPersonnage(column, state.personnages[column])}
              alt=""
              aria-hidden
              draggable={false}
              data-personnage-colonne={column}
              data-personnage-vivant={geste === 'immobile' ? 'non' : 'oui'}
              data-personnage-geste={geste}
              className={cn(
                'pointer-events-none absolute -left-1.5 -top-2 z-10 h-[42px] w-[31.5px] select-none object-contain',
                geste === 'balancement' && 'origin-bottom animate-personnage-au-travail',
              )}
            />
            {/* La DÉCOUPE, et rien d'autre : ce qui défile ne doit pas sortir
                des coins arrondis. Un cheveu de moins que l'enveloppe, pour
                rester à l'intérieur de son cadre. */}
            <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[7px]">
            <div
              className={cn(
                /* `pl-[30px]` : la place du personnage, et rien de plus. Le
                   libellé se décale d'autant, le groupe de droite (compteurs et
                   boutons) ne bouge pas d'un pixel — il est collé à droite par
                   son `ml-auto`. */
                'relative isolate flex shrink-0 items-center gap-1.5 py-1.5 pl-[30px] pr-2',
                composerOuvert === column && 'z-30',
              )}
              data-tete-colonne={column}
            >
              {/* Repère de colonne (« En cours » / « Terminé ») : un voile,
                  DERRIÈRE le libellé, en dégradé vertical qui part de la
                  couleur EN HAUT et s'efface jusqu'à zéro tout EN BAS — jamais
                  un aplat, jamais un trait qui coupe l'entête, jamais une
                  bande centrale (un `via-*` reforme une bande : on ne l'utilise
                  pas ici). `isolate` sur l'entête lui donne son propre contexte
                  d'empilement : sans lui, un `z-index` négatif se comparait au
                  fond de la COLONNE entière (posé plus tôt dans la page) et le
                  voile disparaissait derrière — le laisser en premier dans le
                  DOM (avant le libellé) le range dessous EN THÉORIE, mais un
                  `position: absolute` peint TOUJOURS après un élément statique
                  dans l'ordre de peinture du navigateur, quel que soit l'ordre
                  DOM : le voile finissait donc peint PAR-DESSUS le texte,
                  teinté et terni. Le libellé et son compteur portent
                  maintenant `relative` (sans z-index, juste assez pour
                  rejoindre le voile dans la même couche d'empilement) : à
                  couche égale, c'est de nouveau l'ordre DOM qui tranche, et le
                  texte — placé après le voile dans le JSX — peint bien
                  au-dessus. */}
              {column === 'running' || column === 'done' ? (
                <div
                  aria-hidden
                  className={cn(
                    'pointer-events-none absolute inset-0 bg-gradient-to-b to-transparent',
                    column === 'running' ? 'from-en-cours/20' : 'from-termine/20',
                  )}
                />
              ) : null}
              {/* Une publication de CETTE colonne tourne : un indicateur qui
                  tourne, posé à GAUCHE du libellé, le signale sans aucun texte.
                  Le déroulé (« En cours depuis… », adresse) vit dans le menu du
                  chevron du bloc de publication. */}
              {(() => {
                const run = state.deploys[projectId];
                const etapeCol = etapeDeLaColonne(column);
                const publie =
                  !!run && run.state === 'running' && !!etapeCol && runDeLEtape(run.cible, etapeCol);
                return publie ? (
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin text-publie" data-publication-en-cours={column} />
                ) : null;
              })()}
              <h2 className="relative text-[13px] font-medium uppercase tracking-wide text-faint">{t(COLUMN_LABELS[column])}</h2>
              {/* LE COMPTEUR COMPTE CE QUE LA LISTE MONTRE, sans exception :
                  pas de carte affichée qui ne soit comptée, pas de compte sans
                  carte. « À déployer » y ajoutait le travail enregistré sans
                  carte et annonçait « 1 » au-dessus d'une colonne vide. */}
              <span className="relative text-[12.5px] text-faint" data-compteur-colonne={column}>
                {compteurDeColonne(columnCards.length)}
              </span>
              {/* En haut à droite : le bouton « + » des colonnes qui créent,
                  l'avancement global de « En cours », le bouton « ! » des
                  colonnes qui publient, PUIS le menu trois points. Un SEUL
                  groupe collé à droite (`ml-auto` posé UNE fois sur le
                  conteneur, jamais sur un bouton à l'intérieur) : deux marges
                  automatiques dans la même rangée se partagent l'espace
                  restant au lieu de coller chaque bouton au bord, ce qui
                  laissait le « + » flotter au milieu de l'entête. Chacun se
                  tait quand il n'a rien à dire : pas d'étape comptée, rien à
                  lire, rien de non-lu. */}
              <div className="ml-auto flex items-center gap-0.5">
                {column === 'planned' || column === 'notes' ? (
                  <ComposerInline
                    projectId={projectId}
                    column={column}
                    onOuvert={(ouvert) =>
                      setComposerOuvert((actuel) =>
                        ouvert ? column : actuel === column ? null : actuel,
                      )
                    }
                  />
                ) : null}
                {column === 'running' ? (
                  <RepereAttention compte={state.plans[projectId] ? 1 : 0} data-attention-plan-colonne={column} />
                ) : null}
                {column === 'running' ? <RepereAvancement avancement={avancementDeCesCartes(columnCards)} /> : null}
                {/* « Terminé » précède « À déployer » : c'est ici que se règle
                    si le lot y va — et part en ligne — tout seul. Éteint par
                    défaut ; publier reste sinon un geste de l'utilisateur. */}
                {column === 'done' ? (
                  <InterrupteurDeploiementAuto
                    projectId={projectId}
                    actif={projetOuvert?.deploiementAutomatique === true}
                  />
                ) : null}
                {column === 'to_deploy' || column === 'in_production' ? (
                  <BoutonInfosPublication colonne={column} infos={infosPublication[column] ?? null} />
                ) : null}
                {/* Une fois la procédure en place, l'icône de réglages prend la
                    suite du bouton « Initier… » : elle rouvre le MÊME tiroir,
                    en haut à droite de la colonne. Sans procédure, rien ici —
                    c'est le bloc, en tête de colonne, qui propose d'initier. */}
                {(() => {
                  const etapeCol = etapeDeLaColonne(column);
                  if (!etapeCol || !procedureEnPlace(projetOuvert, etapeCol.cible)) return null;
                  return (
                    <BoutonReglagesProcedure
                      cible={etapeCol.cible}
                      onOuvrir={() => setProcedureOuverte(etapeCol.cible)}
                    />
                  );
                })()}
                <MenuTeteColonne
                  colonne={column}
                  cartesNonLues={columnCards.filter((card) => etatDeCarte(card) === 'termine-non-lu')}
                />
              </div>
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
                <DeployPanel
                  projectId={projectId}
                  cards={columnCards}
                  colonne={column}
                  onInfos={(infos) => setInfosPublication((prev) => ({ ...prev, [column]: infos }))}
                  onSansCarte={(travail) => setSansCarte((prev) => ({ ...prev, [column]: travail }))}
                  onInitier={() => {
                    const etapeCol = etapeDeLaColonne(column);
                    if (etapeCol) setProcedureOuverte(etapeCol.cible);
                  }}
                />
              ) : null}
              <div
                ref={column === 'in_production' ? colonneProductionRef : undefined}
                className={cn(
                  'space-y-1.5 p-1.5',
                  colonneEnLot === column && 'pl-[15px] pt-[15px]',
                )}
              >
              {/* CE QUI N'A PAS DE CARTE SE DIT ICI, au-dessus des cartes et
                  jamais derrière un bouton : du travail prêt à partir que rien
                  ne montre expose à le mettre en ligne — ou à l'oublier — sans
                  l'avoir jamais vu. */}
              {column === 'to_deploy' || column === 'in_production' ? (
                <AlerteTravailSansCarte
                  colonne={column}
                  projectId={projectId}
                  travail={sansCarte[column] ?? null}
                  verbe={etapeDeLaColonne(column)?.verbe ?? 'déployer'}
                  onFiche={() => setSansCarte((prev) => ({ ...prev, [column]: null }))}
                />
              ) : null}
              {cartesPosees.map((card) => {
                const cochable = colonneEnLot === column;
                /* Le bandeau du groupe se pose DEVANT sa première carte, jamais
                   ailleurs : il nomme la publication qui a mis ces cartes en
                   ligne et rouvre son fil. Hors « En production », rien. */
                const bandeau = column === 'in_production' ? production.bandeau(card.id) : null;
                const tuile = (
                  <CardTile
                    card={card}
                    onOpen={(event) => clicCarte(card, column, event)}
                    onPointerDown={
                      cochable
                        ? undefined
                        : (event) => {
                            // Ctrl/Cmd/Maj ne lance pas un glissement : c'est un
                            // geste de sélection, tranché ensuite au clic.
                            if (survolPossible && (event.ctrlKey || event.metaKey || event.shiftKey)) return;
                            start(event, { id: card.id, kind: 'card', label: card.title });
                          }
                    }
                    dimmed={dragging?.id === card.id}
                    coche={cochable ? selection.includes(card.id) : undefined}
                    menuOuvert={menuCarte === card.id}
                    onMenuChange={(ouvert) => setMenuCarte(ouvert ? card.id : null)}
                  />
                );
                /* Un groupe REPLIÉ montre sa PREMIÈRE carte (jamais une barre
                   vide), avec un décor de pile derrière elle. Ses cartes
                   SUIVANTES se plient et déplient avec une animation, dans
                   les deux sens (`envelopper`). Hors « En production », rien
                   ne change. */
                return (
                  <React.Fragment key={card.id}>
                  {bandeau}
                  {column === 'in_production' ? production.envelopper(card.id, tuile) : tuile}
                  </React.Fragment>
                );
              })}
              {/* Le palier de chargement : sous la dernière carte posée, il
                  demande le paquet suivant dès qu'il approche de l'écran. Il
                  disparaît quand toute la colonne est là. */}
              {resteDesCartes(columnCards.length, paquets[column] ?? 1) ? (
                <PalierDeChargement
                  colonne={column}
                  posees={cartesPosees.length}
                  restant={columnCards.length - cartesPosees.length}
                  onCharger={() => chargerLaSuite(column, columnCards.length)}
                />
              ) : null}
              {!columnCards.length ? (
                <p className="px-1.5 py-3 text-[13px] text-faint">
                  {column === 'notes'
                    ? t('Idées en vrac.')
                    : column === 'planned'
                      ? t('Rien à faire pour l’instant : ajoutez une carte avec « + ».')
                      : column === 'running'
                        ? t('Glissez ici pour lancer le travail.')
                        : column === 'done'
                          ? t('Aucun travail terminé pour l’instant.')
                          : column === 'to_deploy'
                            ? /* « Rien à mettre en ligne » était le mensonge le
                                 plus direct : écrit alors que du travail
                                 attendait juste au-dessus. Tant qu'il en
                                 reste, la colonne ne dit plus « rien ». */
                              phraseDeColonneVide(sansCarte.to_deploy ?? null)
                            : column === 'in_production'
                              ? t('Aucune carte en attente de mise en production.')
                              : t('Aucune carte rangée ici pour l’instant.')}
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
                      disabled={colonneQuiTravaille === column}
                      onClick={() => fermerLot()}
                    >
                      {t('Annuler')}</Button>
                    <Button
                      variant="default"
                      size="sm"
                      className="flex-1"
                      disabled={!selection.length || colonneQuiTravaille === column}
                      onClick={() => appliquerLot(action, column)}
                    >
                      {colonneQuiTravaille === column ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                      {action.verbe} ({selection.length})
                    </Button>
                  </div>
                )}
              </div>
            ) : null}
            </div>
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

      {/* Le tiroir de procédure : ouvert par le bouton « Initier… » d'une
          colonne ou par son icône de réglages, toujours sur la cible de CETTE
          colonne. Un seul à l'écran, jamais deux. */}
      <TiroirProcedure
        projectId={projectId}
        cible={procedureOuverte}
        open={!!procedureOuverte}
        onClose={() => setProcedureOuverte(null)}
      />

      {/* L'HISTORIQUE D'UN DÉPLOIEMENT PASSÉ, rouvert depuis le bandeau d'un
          groupe de « En production ». Monté UNE fois pour tout le tableau : un
          tiroir par groupe en monterait autant qu'il y a de publications. Il
          n'y a rien à décider dedans — on relit, on ne rejoue pas. */}
      {production.tiroir}
    </div>
  );
}

/**
 * L'instant présent, écrit comme l'attend un champ « datetime-local » : date
 * LOCALE, sans secondes ni fuseau. Passer par `toISOString` afficherait l'heure
 * de Greenwich — 6 h posées le soir d'été deviendraient 4 h.
 */
function maintenantEnChamp(): string {
  const date = new Date();
  const deux = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${deux(date.getMonth() + 1)}-${deux(date.getDate())}T${deux(date.getHours())}:${deux(
    date.getMinutes(),
  )}`;
}

function ComposerInline({
  projectId,
  column,
  onOuvert,
}: {
  projectId: string;
  column: ColumnKey;
  /** Dit à la colonne quand sa fenêtre s'ouvre et quand elle se referme. */
  onOuvert?: (ouvert: boolean) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  /*
   * L'HEURE DE DÉPART, réglable dès la création. Le champ part de MAINTENANT :
   * on n'a plus qu'à pousser l'heure ou le jour, sans tout retaper.
   *
   * Seule une heure À VENIR programme quelque chose. Une heure déjà passée —
   * dont celle affichée par défaut, si on n'y touche pas — ne pose AUCUNE date :
   * la carte attend son lancement, comme aujourd'hui. C'est ce qui garde la
   * règle du moteur intacte (rien ne part sans un geste) tout en laissant la
   * date à portée de main.
   */
  const [depart, setDepart] = React.useState(maintenantEnChamp);
  const minute = useMinute();
  const departPrevu = React.useMemo(() => {
    const lu = lireDateDeDepart(depart);
    return lu && lu > minute ? lu : null;
  }, [depart, minute]);
  const [attachments, setAttachments] = React.useState<Attachment[]>([]);
  const [apercu, setApercu] = React.useState<Attachment | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  /*
   * CE BROUILLON APPARTIENT À SA COLONNE DE SON PROJET, PAS À L'APPLICATION.
   * Ce composant n'est jamais démonté quand on change de projet (le tableau
   * l'est, pas lui) : sans ceci, un titre ou une pièce jointe préparés pour
   * une note du projet A restaient dans le formulaire en ouvrant celui du
   * projet B — même défaut que le composeur de conversation, ici sans le
   * geste d'envoi pour le vider. Un vrai changement de projet ou de colonne
   * referme la fenêtre et vide tout ce qui n'a pas été créé.
   */
  const cleComposeur = `${projectId}:${column}`;
  const cleComposeurPrecedente = React.useRef(cleComposeur);
  React.useEffect(() => {
    if (cleComposeurPrecedente.current === cleComposeur) return;
    cleComposeurPrecedente.current = cleComposeur;
    setOpen(false);
    setTitle('');
    setDescription('');
    setDepart(maintenantEnChamp());
    setAttachments([]);
    setApercu(null);
  }, [cleComposeur]);

  /*
   * La colonne doit savoir que sa fenêtre est ouverte : c'est elle, et non
   * cette fenêtre, qui peut se relever au-dessus de la zone qui défile — le
   * `z-index` posé ici resterait enfermé dans le plan d'empilement de l'entête.
   * Le démontage la rabaisse, sinon un changement de projet la laisserait en
   * l'air.
   */
  React.useEffect(() => {
    onOuvert?.(open);
    return () => onOuvert?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const upload = async (files: FileList | File[]) => {
    if (!files.length) return;
    const dejaVues = new Set(attachments.map((item) => item.id));
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const response = await fetch(`/api/upload?project=${encodeURIComponent(projectId)}`, {
          method: 'POST',
          headers: {
            'content-type': file.type || 'application/octet-stream',
            'x-file-name': encodeURIComponent(file.name),
          },
          body: file,
        });
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.json();
        const jointe: Attachment | undefined = data.attachment;
        if (!jointe || dejaVues.has(jointe.id)) continue;
        dejaVues.add(jointe.id);
        setAttachments((current) =>
          current.some((item) => item.id === jointe.id) ? current : [...current, jointe],
        );
      }
    } catch {
      client.pushToast('error', t('Envoi du fichier impossible'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const create = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const data = await client.call<{ card: Card }>({
        type: 'card.create',
        projectId,
        title: title.trim(),
        description: description.trim() || undefined,
        attachments: attachments.map((item) => item.id),
      });
      // Une carte naît toujours dans « Planifié » : pour une note, on la
      // déplace ensuite — c'est le seul chemin autorisé par le serveur.
      if (column === 'notes' && data?.card) {
        await client.call({ type: 'card.move', id: data.card.id, column: 'notes' });
      }
      /*
       * L'heure dite est posée par la MÊME commande que le champ du tiroir
       * (`card.schedule`) : un seul chemin, une seule règle d'attente écrite sur
       * la carte. Elle ne part que si elle est encore à venir.
       */
      if (column !== 'notes' && departPrevu && data?.card) {
        await client.call({ type: 'card.schedule', id: data.card.id, at: departPrevu });
      }
      setTitle('');
      setDescription('');
      setDepart(maintenantEnChamp());
      setAttachments([]);
      setApercu(null);
      setOpen(false);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('création impossible'));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Tooltip label={column === 'notes' ? t('Nouvelle note') : t('Nouvelle tâche')}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={column === 'notes' ? 'Nouvelle note' : 'Nouvelle tâche'}
          onClick={() => {
            // Le champ repart de l'heure qu'il est, pas de celle d'il y a
            // trois heures quand le formulaire avait été ouvert la dernière fois.
            setDepart(maintenantEnChamp());
            setOpen(true);
          }}
        >
          <Plus className="h-3 w-3" />
        </Button>
      </Tooltip>
    );
  }

  return (
    <div
      className="absolute left-0 right-0 top-0 z-20 rounded-md border border-border bg-raised p-2 shadow-xl"
      data-composer-ouvert={column}
    >
      <Input
        autoFocus
        value={title}
        placeholder={column === 'notes' ? t('Titre de la note…') : t('Titre de la tâche…')}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void create();
          if (event.key === 'Escape') setOpen(false);
        }}
      />
      <Textarea
        value={description}
        placeholder={t('Description (facultative)…')}
        rows={3}
        className="mt-1.5"
        onChange={(event) => setDescription(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void create();
          if (event.key === 'Escape') setOpen(false);
        }}
      />
      {/* L'HEURE DE DÉPART, réglable dès la création : la carte n'a plus à être
          ouverte après coup pour être programmée. Une note ne s'exécute jamais,
          elle n'a donc rien à programmer. */}
      {column !== 'notes' ? (
        <div className="mt-1.5" data-depart-nouvelle-carte>
          <label className="flex items-center gap-1.5 text-[11.5px] uppercase tracking-wide text-faint">
            <CalendarClock className="h-3 w-3" />
            
{t('Départ')}
</label>
          <Input
            type="datetime-local"
            aria-label="Date et heure de départ"
            value={depart}
            onChange={(event) => setDepart(event.target.value)}
            className="mt-1 w-full text-[13.5px]"
          />
          <p className="mt-1 text-[12.5px] text-faint">
            {departPrevu
              ? phraseDepartProgramme(departPrevu, minute)
              : t('Heure déjà passée : la carte attendra votre lancement. Poussez la date pour programmer un départ.')}
          </p>
        </div>
      ) : null}
      {column === 'notes' && attachments.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5" data-note-attachments>
          {attachments.map((item) => (
            <div key={item.id} className="relative">
              <AttachmentThumb item={item} compact onOpen={() => setApercu(item)} />
              <button
                type="button"
                title={t('Retirer ce fichier')}
                onClick={() => setAttachments((current) => current.filter((file) => file.id !== item.id))}
                className="absolute -right-1 -top-1 rounded-full border border-border bg-surface p-0.5 text-faint hover:border-danger/40 hover:text-danger"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <AttachmentPreview item={apercu} onClose={() => setApercu(null)} />
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Button variant="default" size="sm" disabled={!title.trim() || busy || uploading} onClick={create}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {column === 'notes' ? t('Ajouter la note') : t('Ajouter la tâche')}
        </Button>
        {column === 'notes' ? (
          <>
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              data-note-file-input
              onChange={(event) => event.target.files && void upload(event.target.files)}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={busy || uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}
              
{t('Joindre')}
</Button>
          </>
        ) : null}
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          {t('Annuler')}</Button>
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
  onOpen: (event?: React.MouseEvent) => void;
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
  const ouvrir = (event: React.MouseEvent) => {
    if (menuOuvert || Date.now() - ouvertureMenu.current < 700) return;
    /*
     * SÉLECTIONNER DU TEXTE N'OUVRE PAS LA CARTE. Le relâchement qui termine
     * une sélection à la souris est aussi un clic : sans ce garde-fou, on ne
     * pourrait jamais copier le titre d'une carte — le tiroir s'ouvrirait sur
     * le geste même qui vient de surligner le mot. On ne regarde que les
     * sélections POSÉES DANS CETTE CARTE, pour ne pas avaler un clic normal
     * fait pendant qu'un texte reste surligné ailleurs dans la page.
     */
    const selection = window.getSelection();
    if (
      selection &&
      !selection.isCollapsed &&
      selection.toString().trim() &&
      event.currentTarget instanceof Node &&
      selection.anchorNode &&
      event.currentTarget.contains(selection.anchorNode)
    ) {
      return;
    }
    onOpen(event);
  };
  /*
   * PARTI DU TITRE, LE GESTE ATTEND DE SORTIR DE LA CARTE POUR DEVENIR UN
   * DÉPLACEMENT.
   *
   * Refuser tout net le glissement depuis le texte rendait la carte
   * intirable par son titre — c'est-à-dire par l'essentiel de sa surface :
   * `scripts/verif-glissement-lancement.mjs`, qui vise le centre d'une carte,
   * n'obtenait plus aucun déplacement, donc plus aucun refus à afficher.
   * Refuser l'inverse rendait le titre impossible à surligner.
   *
   * Les deux gestes se départagent donc par leur FIN, pas par leur départ :
   * tant que la souris reste DANS la carte, elle surligne ; dès qu'elle en
   * sort — la seule façon d'aller déposer ailleurs —, le déplacement prend le
   * relais depuis ce point, et la sélection commencée est effacée. Au doigt,
   * rien de tout cela : pas de sélection au glissé, l'appui maintenu reste le
   * seul départ.
   */
  const commencerLeGeste = onPointerDown
    ? (event: React.PointerEvent) => {
        const surLeTexte =
          event.pointerType === 'mouse' && (event.target as HTMLElement).closest?.('[data-carte-texte]');
        if (!surLeTexte) {
          onPointerDown(event);
          return;
        }
        const cadre = (event.currentTarget as HTMLElement).getBoundingClientRect();
        const pointerId = event.pointerId;
        const suivre = (bouge: PointerEvent) => {
          if (bouge.pointerId !== pointerId) return;
          const dehors =
            bouge.clientX < cadre.left ||
            bouge.clientX > cadre.right ||
            bouge.clientY < cadre.top ||
            bouge.clientY > cadre.bottom;
          if (!dehors) return;
          arreter();
          window.getSelection()?.removeAllRanges();
          // Le glissement repart de l'endroit où le pointeur a quitté la carte :
          // `usePointerDrag` ne lit que ces quatre champs.
          onPointerDown({
            button: 0,
            pointerType: 'mouse',
            clientX: bouge.clientX,
            clientY: bouge.clientY,
          } as React.PointerEvent);
        };
        const arreter = () => {
          window.removeEventListener('pointermove', suivre);
          window.removeEventListener('pointerup', arreter);
          window.removeEventListener('pointercancel', arreter);
        };
        window.addEventListener('pointermove', suivre);
        window.addEventListener('pointerup', arreter);
        window.addEventListener('pointercancel', arreter);
      }
    : undefined;
  const agent = card.agentId ? state.agents[card.agentId] : null;
  const waiting = card.scheduling?.waitingReason;
  /* Une horloge UNIQUE pour toutes les cartes : vingt cartes ne font pas vingt
     minuteries. Elle sert à l'heure de départ comme au tour resté sans suite. */
  const maintenant = useMinute();
  /* « Cette carte partira demain à 6 h. » Recalculée à chaque minute plutôt que
     lue en base : une phrase figée dirait encore « demain » trois jours après. */
  const depart = mentionDepartProgramme(card, maintenant);
  /* « Lancement conseillé demain à 02:00. » Même principe : la carte ne garde
     qu'une plage horaire, la phrase se refait à chaque minute. */
  const creneau = mentionCreneauConseille(card, maintenant);
  const estimateFailed = card.estimate?.failed;
  // Un agent au travail sur la carte, quel qu'il soit : le voyant doit tourner
  // même quand la carte n'a pas encore retenu son agent.
  const agentActif = Object.values(state.agents).find(
    (a) => a.cardId === card.id && agentTientSonTour(a),
  );
  const agentAuTravail = !!agentActif;
  // Mode plan : l'agent au travail sur cette carte prépare sans écrire — un
  // repère distinct, tant qu'il travaille encore (le réglage seul ne suffit
  // pas à le dire, une fois le tour rendu).
  const agentPlanActif = Object.values(state.agents).some(
    (a) => a.cardId === card.id && agentTientSonTour(a) && a.run?.mode === 'plan',
  );

  /*
   * LA BARRE DE TRAVAIL, DÈS LE PREMIER INSTANT — pas seulement une fois
   * qu'une étape est cochée. Mêmes données que la barre au-dessus du
   * composeur dans le tiroir (`InfoTravail`, réutilisée telle quelle) : le
   * témoin animé, l'étape en cours (`agent.etapeEnCours`, posé par le démon
   * en même temps que `todos`) et le temps écoulé, qui avance seconde par
   * seconde. Sans le bouton d'arrêt — pas de place ici, et un second geste
   * d'arrêt aurait dérivé de celui du tiroir.
   */
  const [, forcerTravail] = React.useState(0);
  React.useEffect(() => {
    if (!agentAuTravail) return;
    const timer = window.setInterval(() => forcerTravail((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [agentAuTravail]);
  const tempsTravail = agentActif?.startedAt
    ? dureeLisible(Math.round((Date.now() - agentActif.startedAt) / 1000))
    : null;
  const avancementTravail = agentActif?.todos && agentActif.todos.total > 0 ? agentActif.todos : null;
  const travailActuel = agentActif
    ? { quoi: agentActif.etapeEnCours ?? t('Réflexion en cours…'), avancement: avancementTravail, temps: tempsTravail }
    : null;

  /*
   * L'avancement de la liste de tâches de l'agent de la carte, tel qu'il
   * voyage avec lui (champ `todos` de l'agent, `card.agentId`). Le décompte
   * reste affiché même une fois l'agent arrêté : c'est le dernier connu, sur
   * TOUTES les cartes qui en ont un — pas seulement celle où ça travaille
   * encore. Tant que la barre de travail ci-dessus parle, elle dit déjà ce
   * compte : cette mention-ci ne reprend la parole qu'une fois l'agent arrêté.
   */
  const progression = travailActuel ? null : mentionProgressionTaches({ todos: agent?.todos });

  /*
   * L'état en cours ne s'affiche PAS dans le corps de la carte : il sort par le
   * bas, comme une étiquette glissée derrière, sur un fond un peu plus clair.
   * L'attente et l'échec gardent la priorité ; l'avancement « n/N faites » ne
   * parle que lorsqu'aucun d'eux ne parle.
   */
  const statut = depart
    ? // L'heure dite passe avant la raison d'attente : elle dit mieux ce qui
      // retient la carte, et surtout qu'elle repartira sans nous.
      {
        icon: <CalendarClock className="h-2.5 w-2.5 shrink-0" />,
        texte: depart,
        ton: 'text-muted',
        marqueur: 'depart-programme' as const,
      }
    : /*
       * « La carte attend votre lancement » ne dit que la moitié de ce qu'on
       * vient chercher : il manque QUAND. Le créneau conseillé passe donc
       * devant CETTE attente-là — reconnue à sa constante, jamais à son texte —
       * et derrière toutes les autres, qui nomment un vrai obstacle.
       */
      creneau && (!waiting || waiting === RAISON_ATTENTE_LANCEMENT)
      ? {
          icon: <CalendarClock className="h-2.5 w-2.5 shrink-0" />,
          texte: creneau,
          ton: 'text-muted',
          marqueur: 'creneau-conseille' as const,
        }
      : waiting
      ? { icon: <Clock className="h-2.5 w-2.5 shrink-0" />, texte: waiting, ton: 'text-warning' }
      : estimateFailed
        ? {
            icon: <AlertTriangle className="h-2.5 w-2.5 shrink-0" />,
            texte: card.estimate?.failureReason ?? t('chiffrage sans chiffres'),
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
   * travaille encore et quand le plus récent a rendu la main. L'horloge
   * partagée est celle déclarée plus haut : une seule pour toute la carte.
   */
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

  /*
   * « QU'EST-CE QUI TOURNE ENCORE ? » Depuis qu'un rapport rendu ferme la carte,
   * une carte RESTÉE dans « En cours » a forcément une raison — et elle doit se
   * lire sans ouvrir la carte : l'étape, depuis quand, ce qu'on attend. La règle
   * est partagée et testée (`travailRestant`) ; ici on ne fait que l'afficher.
   * Elle se tait quand la vieille mention « tour terminé sans suite » parle déjà
   * : deux phrases pour le même silence ne diraient rien de plus.
   */
  const restant = sansSuite
    ? null
    : travailRestant(
        {
          colonne: card.column,
          agentActif: agentActif
            ? {
                etapeEnCours: agentActif.etapeEnCours,
                startedAt: agentActif.startedAt,
                todos: agentActif.todos,
                attendReponse: agentActif.attendReponse,
              }
            : undefined,
          decisionEnAttente: decisions > 0,
          tourEnVolDepuis: card.scheduling?.tourEnVolDepuis,
          finDuDernierTour: agentsDeLaCarte.reduce((fin, a) => Math.max(fin, a.endedAt ?? 0), 0) || undefined,
          /*
           * LES DEUX MARQUES QUI DISENT « ELLE NE SE RANGERA PAS TOUTE SEULE ».
           * Le bouton d'arrêt d'une carte pose `suspendu` SANS changer la
           * colonne, et le balayage de l'ordonnanceur refuse de ranger une
           * carte dont le dernier tour a échoué : dans ces deux cas, la phrase
           * ne doit plus promettre un rangement automatique qui ne viendra
           * jamais. On lit l'agent que la CARTE reconnaît comme le sien — un
           * vieil agent en échec, remplacé depuis, ne retient rien (même
           * lecture que `dernierTourEnEchec`, `deplacement-carte.ts`).
           */
          suspendu: card.scheduling?.suspendu,
          dernierTourEnEchec: agent ? agent.status === 'failed' || agent.status === 'stopped' : false,
        },
        maintenant,
      );

  const etat = etatVisuelCarte({
    agentStatut: agent?.status,
    analyseEnCours: agentAuTravail,
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
        onPointerDown={commencerLeGeste}
        onContextMenu={
          onMenuChange
            ? (event) => {
                event.preventDefault();
                /*
                 * Le clic droit qui ouvre ce menu se RELÂCHE juste après ce
                 * geste (mouseup / pointerup, bouton droit) : le menu vient
                 * d'apparaître pile sous le curseur, et cet unique
                 * relâchement atterrit alors sur l'entrée qui s'y trouve.
                 * Radix le lit comme le clic qui la choisit — l'action part
                 * sans second clic volontaire. On avale ce SEUL événement,
                 * avant qu'il n'atteigne le menu, sans toucher aux clics qui
                 * suivent : un vrai second clic, plus tard, reste intact.
                 */
                const avalerRelachement = (relache: PointerEvent) => {
                  if (relache.button === 2) relache.stopPropagation();
                };
                document.addEventListener('pointerup', avalerRelachement, { capture: true, once: true });
                onMenuChange(true);
              }
            : undefined
        }
        onClick={ouvrir}
        className={cn(
          // `select-none` reste la règle : au doigt, une carte se tire et se
          // fait défiler, jamais surligner. Seul le POINTEUR FIN (souris,
          // pavé tactile) rend le texte sélectionnable — là, on veut pouvoir
          // copier le titre d'une carte, et ce qui est marqué
          // `data-carte-texte` le repasse en `select-text`.
          'relative z-10 cursor-pointer touch-manipulation select-none rounded-md border border-border bg-raised px-2.5 py-2 transition-colors hover:border-faint',
          (statut || travailActuel || restant) && 'rounded-b-none',
        )}
      >
        {/*
         * Le badge « en ligne » est le premier repère à voir : il prend sa
         * propre ligne AU-DESSUS du titre, au lieu de se perdre au milieu des
         * repères techniques du pied.
         */}
        {card.deployedAt || agentPlanActif ? (
          <div className="mb-1 flex gap-1">
            {card.deployedAt ? (
              <Tooltip label={t('En ligne depuis le {v0}', { v0: new Date(card.deployedAt).toLocaleString(formatRegional()) })}>
                <Badge tone="success">
                  <Rocket className="h-2.5 w-2.5" /> {t('en ligne')}
                </Badge>
              </Tooltip>
            ) : null}
            {agentPlanActif ? (
              <Tooltip label={t('L\'agent prépare un plan : il ne modifie rien tant que ce mode est actif')}>
                <Badge tone="strong" data-mode-plan-actif={card.id}>
                  <Route className="h-2.5 w-2.5" /> {t('plan')}
                </Badge>
              </Tooltip>
            ) : null}
          </div>
        ) : null}

        <div className="flex items-start gap-1.5">
          {/* Le titre est le texte que l'on cherche à COPIER, et le seul de la
              carte qui ne soit pas tronqué : il revient donc à la ligne, y
              compris au milieu d'un mot interminable (une adresse, un chemin),
              plutôt que de sortir du cadre. L'icône du moteur ouvre son fil,
              à la taille d'une lettre : elle ne prend pas de ligne à elle
              seule, et ne bouge donc rien d'autre sur la carte. */}
          <h3
            data-carte-texte
            className="texte-copiable min-w-0 flex-1 break-words text-[14px] font-medium leading-snug text-text"
          >
            <Tooltip label={t(nomCourtMoteur(state.engines.find((e) => e.id === card.run.engine)))}>
              <span className="inline-block" data-icone-moteur={card.id}>
                <IconeMoteur engine={card.run.engine} className="relative -top-px mr-1 inline h-[13px] w-[13px] align-middle" />
              </span>
            </Tooltip>
            {card.title}
          </h3>
          {/* Le triangle passe AVANT le voyant : une décision attendue prime
              sur l'état d'avancement, elle est ce qui demande un geste. */}
          <RepereAttention compte={decisions} className="mt-[2px]" data-attention-carte={card.id} />
          {/* Le voyant est à DROITE, au bout de la ligne du titre. */}
          {etat === 'travaille' ? (
            <Loader2 className="mt-[3px] h-3 w-3 shrink-0 animate-spin text-en-cours" />
          ) : etat === 'termine-non-lu' ? (
            // Le point bleu : le travail est rendu mais sa conversation n'a pas
            // encore été ouverte. Même sens et même couleur que sur la ligne du
            // projet ; l'ouvrir laisse place à la coche bleue.
            <Tooltip label={t('Travail rendu, pas encore lu')}>
              <span
                data-carte-non-lue={card.id}
                className="mt-[3px] h-2 w-2 shrink-0 rounded-full bg-termine animate-pulse-soft motion-reduce:animate-none"
              />
            </Tooltip>
          ) : etat === 'termine' ? (
            // La coche BLEUE : l'agent a rendu son travail, la carte attend
            // votre clôture. Une relance la remplace aussitôt par la roue orange.
            <Tooltip label={t('Travail rendu — la carte attend votre clôture')}>
              <span className="mt-[2px] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-termine/15 text-termine">
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
            {card.billing ? <Badge tone="success">{t('déjà facturée')}</Badge> : null}
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
            {decisions > 1 ? t('Répondre ({decisions})', { decisions }) : t('Répondre')}
          </button>
        ) : null}

        {/*
         * La phrase du dernier tour, à l'endroit où l'on cherche l'état de la
         * carte. TROIS tons, jamais un seul. Une carte dont le CODE EST LÀ
         * (`natureDeLaMention` → « travail ») porte une information bleue, celle
         * du travail acquis — l'afficher en triangle jaune démentait la coche
         * verte d'à côté et faisait lire « rien n'a été fait » sur un travail
         * bel et bien livré. Une carte qui ATTEND garde son jaune. Et depuis
         * qu'un rapport rendu ferme la carte, un troisième cas existe :
         * « INFORMATION » — la carte est close, aucun code n'a été livré, et
         * personne n'a rien à faire. Ni alerte ni promesse de livraison : du
         * gris, et la phrase telle quelle.
         */}
        {card.sansModification ? (
          natureDeLaMention(card.sansModification) === 'travail' ? (
            <div
              data-mention-carte="travail"
              title={card.sansModification}
              className="mt-1.5 flex items-start gap-1.5 rounded border border-termine/30 bg-termine/10 px-1.5 py-1 text-[12px] leading-snug text-termine"
            >
              <Check className="mt-[2px] h-3 w-3 shrink-0" />
              <span className="min-w-0 truncate">{card.sansModification}</span>
            </div>
          ) : natureDeLaMention(card.sansModification) === 'information' ? (
            <div
              data-mention-carte="information"
              title={card.sansModification}
              className="mt-1.5 flex items-start gap-1.5 rounded border border-border bg-surface px-1.5 py-1 text-[12px] leading-snug text-faint"
            >
              <Info className="mt-[2px] h-3 w-3 shrink-0" />
              <span className="min-w-0 truncate">{card.sansModification}</span>
            </div>
          ) : (
            <div
              data-mention-carte="attente"
              title={card.sansModification}
              className="mt-1.5 flex items-start gap-1.5 rounded border border-warning/30 bg-warning/10 px-1.5 py-1 text-[12px] leading-snug text-warning"
            >
              <AlertTriangle className="mt-[2px] h-3 w-3 shrink-0" />
              <span className="min-w-0 truncate">{card.sansModification}</span>
            </div>
          )
        ) : null}

        {/*
         * La carte a déjà travaillé : le prochain clic REPREND au lieu de tout
         * refaire. On le dit là où on lit son état, sous la cause de son
         * interruption — un seul mot, la phrase entière est dans son tiroir.
         */}
        {mentionDeReprise(card) ? (
          <div className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-snug text-faint">
            <RotateCcw className="mt-[2px] h-3 w-3 shrink-0" />
            <span className="min-w-0 truncate" data-mention-reprise>
              {MENTION_REPRISE_COURTE}
            </span>
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
            <span className="min-w-0 truncate" data-mention-sans-suite>
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
        <Tooltip label={statut.texte}>
          <div
            onClick={ouvrir}
            className={cn(
              // Toute la largeur de la carte, sur UNE ligne, sans marge latérale.
              // Le petit espace en haut laisse voir l'ombre portée, qui donne
              // l'impression que la carte recouvre la bande. Padding resserré
              // (px-1.5, pas le px-2.5 du corps de la carte) : cette bande est
              // un pied technique, pas le texte principal, et son icône comme
              // sa pastille doivent coller aux bords pour laisser le texte de
              // l'étape respirer avant d'être tronqué.
              'relative -mt-1 cursor-pointer overflow-hidden rounded-b-md bg-bandeau-etape px-1.5 pb-1.5 pt-2 text-[12.5px] leading-none',
              'shadow-[inset_0_7px_6px_-6px_rgba(0,0,0,0.75)]',
              statut.ton,
            )}
          >
            <span className="flex items-center gap-1">
              {statut.icon}
              <span
                className="min-w-0 flex-1 truncate"
                data-progression-taches={'marqueur' in statut && statut.marqueur === 'progression-taches' ? card.id : undefined}
                data-depart-programme={'marqueur' in statut && statut.marqueur === 'depart-programme' ? card.id : undefined}
                data-creneau-conseille={'marqueur' in statut && statut.marqueur === 'creneau-conseille' ? card.id : undefined}
              >
                {statut.texte}
              </span>
            </span>
          </div>
        </Tooltip>
      ) : travailActuel ? (
        // Mêmes données que la barre du tiroir (`InfoTravail`), dans le même
        // bandeau que les autres mentions ci-dessus — mais sans bouton
        // d'arrêt : ce geste reste réservé au tiroir de la carte. La pastille
        // est trop étroite pour porter le compte des étapes ET le
        // chronomètre ensemble : `alterner` les fait tourner l'un après
        // l'autre plutôt que de les concaténer.
        <div
          onClick={ouvrir}
          data-barre-travail={card.id}
          className={cn(
            // Même resserrement que la bande ci-dessus (px-1.5 au lieu de
            // px-2.5) : l'icône colle au bord gauche, la pastille de temps au
            // bord droit, et le nom de l'étape gagne la place ainsi rendue.
            'relative -mt-1 flex cursor-pointer items-center gap-1 overflow-hidden rounded-b-md bg-bandeau-etape px-1.5 pb-1.5 pt-2 text-[12.5px] leading-none',
            'shadow-[inset_0_7px_6px_-6px_rgba(0,0,0,0.75)]',
          )}
        >
          <InfoTravail
            quoi={travailActuel.quoi}
            avancement={travailActuel.avancement}
            temps={travailActuel.temps}
            alterner
          />
        </div>
      ) : restant ? (
        /*
         * CE QUI TOURNE ENCORE, quand ni la roue de l'agent ni une autre
         * mention ne le disent déjà — le rangement d'un tour fini, ou
         * l'anomalie « plus personne » que l'ordonnanceur corrige sous
         * quinze secondes. Sans agent actif, `travailActuel` est vide et la
         * carte resterait muette : ce même bandeau prend le relais, avec la
         * MÊME phrase que portait l'ancien encadré à l'intérieur de la carte.
         */
        <Tooltip label={phraseDuTravailRestant(restant)}>
          <div
            onClick={ouvrir}
            data-travail-restant={card.id}
            className={cn(
              'relative -mt-1 cursor-pointer overflow-hidden rounded-b-md bg-bandeau-etape px-1.5 pb-1.5 pt-2 text-[12.5px] leading-none',
              'shadow-[inset_0_7px_6px_-6px_rgba(0,0,0,0.75)]',
              restant.nature === 'question' ? 'text-warning' : 'text-faint',
            )}
          >
            <span className="flex items-center gap-1">
              {restant.nature === 'question' ? (
                <MessageSquare className="h-3 w-3 shrink-0" />
              ) : (
                <Clock className="h-3 w-3 shrink-0" />
              )}
              <span className="min-w-0 flex-1 truncate">{phraseDuTravailRestant(restant)}</span>
            </span>
          </div>
        </Tooltip>
      ) : null}
    </div>
  );
}
