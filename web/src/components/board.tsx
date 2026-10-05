import * as React from 'react';
import { Settings2, Plus, Rocket, CircleAlert, CalendarClock, Clock, AlertTriangle, Info, Loader2, Archive, Check, MessageSquare, ListChecks, EllipsisVertical, CheckCheck, Globe, Paperclip, Route, RotateCcw, X, Lightbulb, FileCheck2 } from 'lucide-react';
import {
  TITRE_CARTE_DE_CADRAGE,
  debutDeLaDemande,
  Attachment,
  gestesGeles,
  RAISON_CANAL_COUPE,
  avancementDuLancement,
  preparationAAfficher,
  mentionDeLancement,
  COLUMN_KEYS,
  COLONNES_AFFICHEES,
  COLUMN_LABELS,
  LIBELLES_DE_LA_FILLE,
  activiteDeLaMere,
  Card,
  ColumnKey,
  AvancementColonne,
  RefusDeLot,
  MARGE_DE_CHARGEMENT_PX,
  paquetAutorise,
  cartesDuPaquet,
  paquetSuivant,
  paquetsPourVoir,
  resteDesCartes,
  avancementDeLaColonne,
  bilanDeLot,
  bilanEnRoute,
  PLAFOND_ATTENTE_LOT_MS,
  partsDuLot,
  canMove,
  cleColonneTableau,
  colonneAReprendre,
  colonneAffichee,
  agentCompteCommeTravail,
  compteurDeColonne,
  phraseDeColonneVide,
  TravailSansCarte,
  alertesParCarte,
  iconeDuLot,
  etapeDeLaColonne,
  etatVisuelCarte,
  carteNonLue,
  instantDuRendu,
  etapeDeCarte,
  TEXTE_DE_L_ETAPE,
  type EtapeDeCarte,
  lireDateDeDepart,
  MENTION_REPRISE_COURTE,
  mentionArchivage,
  mentionDeReprise,
  mentionCreneauConseille,
  mentionDepartProgramme,
  phraseDepartProgramme,
  RAISON_ATTENTE_LANCEMENT,
  agentTientSonTour,
  runDeLEtape,
  mentionProgressionTaches,
  mentionSansSuite,
  natureDeLaMention,
  phraseDuTravailRestant,
  travailRestant,
  repereVisible,
  sortieAutorisee,
  gesteDuDepot,
  carteDoitSecouer,
  friseDeSuivi,
  agentDeConfiguration,
  etatDeLaVignetteDInitialisation,
  procedureEnPlace,
  estCarteMarketing,
  titreEnConstruction,
  estUnRegroupement,
  membresActifsDuRegroupement,
} from '@beluga/shared';
import { VignetteInitialisationProduction } from '@/components/vignette-initialisation-production';
import { VignetteMiseEnProduction } from '@/components/vignette-mise-en-production';
import { PointNonLu } from '@/components/point-non-lu';
import { RepereAttention } from '@/components/repere-attention';
import { BulleTexteCoupe, useTexteCoupe } from '@/components/texte-coupe';
import { IconeMoteur } from '@/components/icone-moteur';
import { nomCourtMoteur } from '@/components/run-selectors';
import { SilhouetteTableau } from '@/components/silhouettes';
import { BandeauTravail } from '@/components/bandeau-travail';
import { IndicateurActivite } from '@/components/indicateur-activite';
import {
  Badge,
  Button,
  ConfirmDialog,
  Dot,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Switch,
  Textarea,
  Tooltip,
  ZoneDefilement,
} from '@/components/ui';
import { client } from '@/lib/client';
import { MenuCarte } from '@/components/card-menu';
import { DragItem, DropTarget, usePointerDrag } from '@/lib/dnd';
import { readPref, writePref } from '@/lib/prefs';
import { useDispositionTableau } from '@/lib/disposition-tableau';
import {
  CLASSES_ALERTE_RANGEE,
  CLASSES_PIED_RANGEE,
  CLASSES_TETE_RANGEE,
  CLASSE_HAUTEUR_CARTE,
  CLASSE_HAUTEUR_CARTE_EN_ROUTE,
  CLASSE_HAUTEUR_CORPS_EN_ROUTE,
  CLASSE_LARGEUR_CARTE,
  LARGEUR_CARTE_PX,
  classesBande,
  classesEmpilement,
  classesRail,
  classesRangee,
} from '@/lib/gabarit-tableau';
import { useTelephone } from '@/lib/telephone';
import { useApp, useCanal } from '@/lib/use-app';
import { poserLeGlissementDeCarte, verdictVersProjet } from '@/lib/deplacement-de-projet';

/** Un agent de la carte écrit-il en ce moment ? Même lecture que le serveur. */
const estAgentActif = (statut: string | undefined) =>
  etatVisuelCarte({ agentStatut: statut as any }) === 'travaille';
import { useSurvol } from '@/lib/pointeur';
import { useSecousseRepetee } from '@/lib/secousse-repetee';
import { carteDeSuivi } from '@/lib/carte-de-suivi';
import { FriseDeSuivi } from '@/components/frise-de-suivi';
import { useMinute } from '@/lib/horloge';
import { cn, relativeTime } from '@/lib/utils';
import {
  DeployPanel,
  BoutonInfosPublication,
  InfosPublication,
  AlerteTravailSansCarte,
} from '@/components/deploy-panel';
import { BandeauProductionGroupe } from '@/components/bandeau-production-groupe';
import { ouvrirRubriqueDeLEtape } from '@/lib/ouvrir-config-projet';
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
   * même geste que le bouton du tiroir. Aujourd'hui la seule entrée
   * (« Tout archiver ») déplace. « Planifié » n'a plus de geste de lot : sa
   * place, en haut à droite de la rangée, est tenue par « Nouvelle tâche ».
   */
  cible?: ColumnKey;
  /** Le participe passé féminin, pour le compte rendu : « 2 cartes lancées ». */
  participe: string;
};

/* La largeur et la hauteur d'une carte, comme toutes les mesures des rangées,
   vivent dans le GABARIT DU TABLEAU (`lib/gabarit-tableau.ts`), partagé avec
   la silhouette de chargement : les deux ne peuvent plus dériver. */

const ACTIONS_DE_LOT: Partial<Record<ColumnKey, ActionDeLot>> = {
  // « Tout lancer » n'existe plus : « Planifié » porte à sa place le bouton
  // « Nouvelle tâche ». Une carte se lance une à une (bouton du tiroir, ou
  // dépôt dans « En cours », qui VAUT « Lancer maintenant »).
  // « En production » n'existe plus : le déploiement range lui-même ses cartes
  // en « Archivé ». Le pied de « À déployer » garde donc le seul geste de masse
  // qui reste à la main — sortir du lot sans rien mettre en ligne.
  // « Rapport » non plus : un travail rendu tombe directement dans le lot à
  // publier, il n'y a plus de paquet à y pousser.
  to_deploy: {
    libelle: 'Tout archiver',
    icone: Archive,
    verbe: 'Archiver',
    cible: 'archived',
    participe: 'archivée',
  },
};

/**
 * LE GESTE DU GROUPE « EN COURS » de la vue « Progression » — les mêmes mots
 * que le pied de colonne, et le même chemin serveur : une carte après l'autre
 * vers « À déployer ». Le libellé nomme la DESTINATION, pas le groupe de
 * départ. Les textes restent en français ici : ce sont des CLÉS, données à
 * `t()` au moment du rendu.
 */
const CLES_GESTE_DE_GROUPE: ActionDeLot = {
  libelle: 'Tout envoyer en {v0}',
  icone: Rocket,
  verbe: 'Envoyer',
  cible: 'to_deploy',
  participe: 'déplacée',
};

/**
 * LE GESTE DE LOT D'UNE RANGÉE, ses textes traduits au moment du rendu.
 */
function actionDeLot(colonne: ColumnKey): ActionDeLot | undefined {
  const brut = ACTIONS_DE_LOT[colonne];
  if (!brut) return undefined;
  return { ...brut, libelle: t(brut.libelle), verbe: t(brut.verbe) };
}

/**
 * Le menu à trois points d'une tête de colonne.
 *
 * Il porte « Marquer tout comme lu », qui éteint le point bleu de toutes les
 * cartes non lues de CETTE colonne : on ne réinvente rien côté serveur, on
 * rejoue la commande `card.read` (celle qu'envoie l'ouverture d'une
 * conversation) pour chaque carte non lue.
 *
 * « À déployer » y ajoute DEUX DESTINATIONS, et c'est ce qui a fait de ce menu
 * un bouton PERMANENT au lieu d'un bouton qui n'apparaissait qu'avec une carte
 * non lue :
 *  - « Configuration » — la procédure de mise en ligne de l'étape, qui avait sa
 *    propre icône dans l'entête et n'en a plus besoin ;
 *  - « Archives » — les cartes déjà déployées, qui occupaient une colonne
 *    entière du tableau et vivent maintenant dans un tiroir.
 *
 * Le bouton « ! » (informations de publication) RESTE dehors, à côté : il
 * signale quelque chose à lire, et une alerte cachée derrière un menu ne se
 * voit pas.
 *
 * Sans entrée propre ET sans carte non lue, pas de bouton. Sur téléphone,
 * `DropdownMenuContent` devient un tiroir bas.
 */
function MenuTeteColonne({
  colonne,
  cartesNonLues,
  entrees,
}: {
  colonne: ColumnKey;
  cartesNonLues: Card[];
  /** Les destinations propres à la colonne, au-dessus du geste de lecture. */
  entrees?: React.ReactNode;
}) {
  if (!cartesNonLues.length && !entrees) return null;
  const toutMarquerLu = () => {
    for (const carte of cartesNonLues) client.send({ type: 'card.read', cardId: carte.id });
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="-mr-1 h-6 shrink-0 px-1.5 text-faint"
          aria-label="Actions de la colonne"
          data-menu-colonne={colonne}
        >
          <EllipsisVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {entrees}
        {cartesNonLues.length ? (
          <DropdownMenuItem onSelect={toutMarquerLu}>
            <CheckCheck className="h-3.5 w-3.5" />  {t('Marquer tout comme lu')}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * L'INTERRUPTEUR « DÉPLOIEMENT AUTOMATIQUE », en tête de la colonne
 * « À déployer ». ÉTEINT par défaut, et son état vit sur le PROJET : allumé,
 * il vaut consentement permanent pour ce projet-là — dès que plus rien ne
 * travaille, le lot posé dans « À déployer » part tout seul, la mise en ligne
 * part sans clic sur « Publier maintenant ».
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
        'Déploiement automatique : dès que plus rien ne travaille sur ce projet, ce lot part en ligne tout seul, sans passer par « Publier maintenant ».',
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

/** Deux événements de défilement plus rapprochés que ça font partie du même geste. */
const PAUSE_ENTRE_GESTES_MS = 400;

/**
 * LE PALIER DE CHARGEMENT, APRÈS la dernière carte posée d'une rangée.
 *
 * Un seul élément observé par colonne : dès qu'il arrive à l'écran, le paquet
 * suivant est demandé. C'est le navigateur qui prévient, une fois.
 *
 * UN SEUL PAQUET PAR GESTE (`paquetAutorise`, `shared/src/paquets-de-cartes.ts`).
 * L'observateur était refait à chaque paquet posé, et redemandait aussitôt la
 * suite si le palier était encore en vue. Dans « Archivé », dont les
 * publications sont repliées, vingt cartes de plus n'ajoutent souvent aucune
 * hauteur : les paquets s'enchaînaient seuls et l'écran sautait. L'observateur
 * vit désormais aussi longtemps que le palier, et un paquet demandé le
 * DÉSARME ; seul un NOUVEAU geste de descente le réarme (roulette, doigt,
 * barre, clavier). Seule une colonne qui ne défile pas encore se remplit sans
 * geste, jusqu'à défiler.
 *
 * Les écouteurs de défilement ne mesurent rien tant que le palier est hors de
 * l'écran : aucun calcul de mise en page à chaque pixel dans le cas ordinaire.
 */
function PalierDeChargement({
  colonne,
  posees,
  restant,
  onCharger,
  axe = 'horizontal',
}: {
  colonne: ColumnKey;
  posees: number;
  restant: number;
  onCharger: () => Promise<unknown> | void;
  /** Le sens de la bande : couchée dans une rangée, debout dans une colonne. */
  axe?: 'horizontal' | 'vertical';
}) {
  const vertical = axe === 'vertical';
  const ancre = React.useRef<HTMLDivElement>(null);
  // Le rappel change à chaque rendu du tableau : on le garde dans une référence
  // pour ne pas refaire l'observateur pour si peu.
  const rappel = React.useRef(onCharger);
  rappel.current = onCharger;
  const visible = React.useRef(false);
  const enVol = React.useRef(false);
  const zone = React.useRef<HTMLElement | null>(null);
  /** Le dernier bord gauche VU de la bande : la rangée glisse à l'horizontale. */
  const gaucheVue = React.useRef(0);
  /* LES GESTES, numérotés : le palier est ARMÉ tant que le geste en cours
     n'est pas celui qui a fait venir le dernier paquet. Au départ, aucun
     paquet n'a été demandé par un geste (-1) : le palier est armé. */
  const geste = React.useRef(0);
  const gesteDuPaquet = React.useRef(-1);

  const essayer = React.useRef(() => {});
  essayer.current = () => {
    const defilante = zone.current;
    const defilable = defilante
      ? vertical
        ? defilante.scrollHeight > defilante.clientHeight + 1
        : defilante.scrollWidth > defilante.clientWidth + 1
      : false;
    const arme = geste.current !== gesteDuPaquet.current;
    if (!paquetAutorise({ visible: visible.current, enVol: enVol.current, arme, defilable })) return;
    gesteDuPaquet.current = geste.current;
    enVol.current = true;
    void Promise.resolve(rappel.current())
      .catch(() => undefined)
      .finally(() => {
        enVol.current = false;
      });
  };

  React.useEffect(() => {
    const noeud = ancre.current;
    if (!noeud) return;
    // La zone qui défile : la bande de cartes de la rangée (ou de la colonne).
    const debord = (el: HTMLElement) => (vertical ? getComputedStyle(el).overflowY : getComputedStyle(el).overflowX);
    const position = (el: HTMLElement | null) => (vertical ? el?.scrollTop : el?.scrollLeft) ?? 0;
    let parent = noeud.parentElement;
    while (parent && !/(auto|scroll)/.test(debord(parent))) parent = parent.parentElement;
    zone.current = parent;
    gaucheVue.current = position(parent);

    const observateur = new IntersectionObserver(
      (entrees) => {
        visible.current = entrees.some((entree) => entree.isIntersecting);
        if (visible.current) essayer.current();
      },
      { rootMargin: `${MARGE_DE_CHARGEMENT_PX}px` },
    );
    observateur.observe(noeud);

    /* AVANCER, C'EST UN GESTE, pas chacun de ses crans : une rafale de
       roulette, l'inertie du pavé tactile, un glissé du doigt ou du pouce de
       la barre envoient des dizaines d'événements à quelques millisecondes
       d'écart. Un événement qui suit une pause (`PAUSE_ENTRE_GESTES_MS`) ouvre
       un NOUVEAU geste ; chaque geste fait venir un paquet au plus — même si
       le paquet rallonge la rangée et que le même geste ramène le palier en
       vue. Au bout d'une rangée qui n'a rien gagné en largeur (vingt cartes
       rangées dans un groupe replié), la bande ne défile plus : la roulette et
       le doigt comptent alors comme l'avancée. */
    let dernierEvenement = Number.NEGATIVE_INFINITY;
    const evenement = (avance: boolean) => {
      const maintenant = performance.now();
      if (maintenant - dernierEvenement > PAUSE_ENTRE_GESTES_MS) geste.current += 1;
      dernierEvenement = maintenant;
      if (avance && visible.current) essayer.current();
    };
    /* Avancer vers la DROITE : on compare au dernier bord gauche VU, relu après
       chaque pose — un paquet qui se range peut déplacer le défilement sans
       aucun geste. */
    const auDefilement = () => {
      const gauche = position(parent);
      const avance = gauche > gaucheVue.current + 1;
      gaucheVue.current = gauche;
      evenement(avance);
    };
    /* Une bande couchée se pousse au pavé tactile (`deltaX`), à la molette
       d'une souris qui n'a que `deltaY`, ou Maj enfoncée : les trois comptent. */
    const aLaRoulette = (e: WheelEvent) => evenement(vertical ? e.deltaY > 0 : e.deltaX > 0 || e.deltaY > 0);
    const auDoigt = () => evenement(true);
    parent?.addEventListener('scroll', auDefilement, { passive: true });
    parent?.addEventListener('wheel', aLaRoulette, { passive: true });
    parent?.addEventListener('touchmove', auDoigt, { passive: true });
    return () => {
      observateur.disconnect();
      parent?.removeEventListener('scroll', auDefilement);
      parent?.removeEventListener('wheel', aLaRoulette);
      parent?.removeEventListener('touchmove', auDoigt);
    };
  }, []);

  /* Un paquet vient d'être posé : on relit le haut du défilement (le rangement
     a pu le déplacer sans geste), la demande n'est plus en vol, et une colonne
     qui ne défile toujours pas continue de se remplir. */
  React.useEffect(() => {
    gaucheVue.current = (vertical ? zone.current?.scrollTop : zone.current?.scrollLeft) ?? 0;
    enVol.current = false;
    essayer.current();
  }, [posees]);

  return (
    <div
      ref={ancre}
      data-palier-cartes={colonne}
      data-cartes-restantes={restant}
      className={cn(
        'flex shrink-0 items-center px-1.5 py-2 text-center text-[12px] text-faint',
        vertical ? 'w-full justify-center' : 'w-[120px]',
      )}
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
  /* L'état du lien, lu une seule fois : pied de colonne, glisser-déposer et
     tuile « Nouvelle tâche » s'éteignent tous sur la même lecture. */
  const canal = useCanal();
  /* LIGNES OU COLONNES : colonnes par défaut sur téléphone, rangées sur
     ordinateur, et le bouton du bandeau du haut bascule de l'une à l'autre
     (`lib/disposition-tableau.ts`). Seule l'ORIENTATION change : chaque
     colonne porte exactement les pièces d'une rangée. */
  const { disposition } = useDispositionTableau();
  const enColonnes = disposition === 'colonnes';
  const telephone = useTelephone();

  const cards = React.useMemo(
    () =>
      Object.values(state.cards)
        // Les cartes de l'agent marketing ne vivent que dans l'outil Marketing
        // (`estCarteMarketing`) : le démon ne les envoie plus dans les paquets
        // du tableau, et celles qui arrivent en direct sont écartées ici.
        .filter((card) => card.projectId === projectId && !estCarteMarketing(card))
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
      /* Le CADRAGE ne compte pas : discuter une carte n'est pas la faire
         (`agentCompteCommeTravail`). Sans cela, la carte-fil sautait en
         « En cours » à chaque réponse, sans qu'on ait rien lancé. */
      if (agent.cardId && agentCompteCommeTravail(agent.role) && agentTientSonTour(agent)) {
        index.add(agent.cardId);
      }
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
      const cle = colonneAffichee({ column: card.column, agentAuTravail: travailParCarte.has(card.id) });
      /*
       * UNE CLÉ DE COLONNE INCONNUE NE FAIT PLUS TOMBER LE TABLEAU ENTIER.
       *
       * Le retrait de « En production » l'a montré : tant que le démon n'a pas
       * redémarré avec la migration qui range ses cartes, il envoie encore des
       * cartes portant cette clé — et `index['in_production'].push(...)` jetait
       * une exception qui vidait TOUT l'écran, pas seulement ces cartes-là. Un
       * navigateur resté ouvert pendant une mise à jour se trouve exactement
       * dans ce cas.
       *
       * Une carte dont la clé n'existe plus se pose donc en « Archivé » — là où
       * la migration l'enverra de toute façon. Elle reste VISIBLE, ce qui vaut
       * mieux qu'un tableau blanc.
       */
      (index[cle] ?? index.archived).push(card);
    }
    return index;
  }, [cards, travailParCarte]);

  const byColumn = (column: ColumnKey) => parColonne[column];

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
  const chargerLaSuite = React.useCallback(
    (column: ColumnKey, total: number) => {
      setPaquets((avant) => {
        const courant = avant[column] ?? 1;
        const suivant = paquetSuivant(courant, total);
        return suivant === courant ? avant : { ...avant, [column]: suivant };
      });
      /* LES CARTES QUI NE SONT PAS ENCORE ICI SE DEMANDENT AU DÉMON : le
         projet n'a reçu qu'un paquet par colonne (`cards.tranche`,
         `shared/src/tranches-de-cartes.ts`). Le client ne demande qu'une
         tranche à la fois, et rien quand tout est là. */
      return client.chargerLaTranche(projectId, column).catch(() => undefined);
    },
    [projectId],
  );
  /** Tout poser d'un coup : une sélection en lot doit voir TOUTE la colonne. */
  const toutPoser = React.useCallback(
    (column: ColumnKey, total: number) => {
      setPaquets((avant) => ({ ...avant, [column]: paquetsPourVoir(total - 1) }));
      void client.chargerToutesLesCartes(projectId, column).catch(() => undefined);
    },
    [projectId],
  );
  /*
   * LE TOTAL RÉEL D'UNE COLONNE : ce que le démon compte, jamais moins que ce
   * qui est déjà ici. C'est lui que dit la tête de colonne, et lui qui garde
   * le palier de chargement tant qu'il reste des cartes à faire venir.
   */
  const totauxDuProjet = state.cartesTotaux[projectId];
  const totalDeColonne = React.useCallback(
    (column: ColumnKey, recues: number) => Math.max(recues, totauxDuProjet?.[column] ?? 0),
    [totauxDuProjet],
  );

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
   * VIVANT d'abord, le statut ensuite. Sans lui, l'indicateur de « En cours »
   * s'éteignait dès la réponse rendue, alors que le démon rangeait encore
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

  const avancementDeCesCartes = (cartes: Card[]) =>
    avancementDeLaColonne(
      cartes.map((card) => {
        /* Une MÈRE n'a pas d'agent : elle compte par ses filles, lues sur son
           relevé (`activiteDeLaMere`) — le même chiffre que sa carte. */
        if (card.cartesFilles?.length) {
          const filles = activiteDeLaMere(card.suiviDesFilles);
          return {
            agentActif: filles.enTravail > 0,
            todos: filles.total > 0 ? { done: filles.faites, total: filles.total } : undefined,
          };
        }
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

  /*
   * LE TIROIR DE PROCÉDURE, tenu par le tableau parce qu'il s'ouvre de DEUX
   * endroits : le bouton « Initier… » du bloc de publication, et l'icône de
   * réglages de la tête de colonne. Un seul tiroir, une seule cible à la fois —
   * celle de la colonne d'où l'on vient.
   */
  /* Le projet ouvert, tel que l'écran le connaît déjà : c'est lui qui dit si la
     procédure d'une colonne est définie, sans rien demander au serveur. */
  const projetOuvert = state.projects.find((p) => p.id === projectId);
  /* Les projets membres, quand le tableau affiché est celui d'un regroupement. */
  const membresDuGroupe = estUnRegroupement(projetOuvert) ? membresActifsDuRegroupement(state.projects, projectId) : [];
  /* L'INITIALISATION DE LA MISE EN PRODUCTION, en tête de « En cours » : une
     vignette à part, pas une carte (DEC-256) — ni comptée dans l'entête, ni
     dans l'avancement de la colonne. */
  /* LES DEUX AGENTS DE CONFIGURATION (déploiement, mise en production) ont
     chacun leur vignette tant qu'ils travaillent ou attendent une réponse. */
  const vignettesInitialisation = (['dev', 'production'] as const).flatMap((cible) => {
    const idConfiguration = agentDeConfiguration(projetOuvert, cible);
    const agentConfiguration = idConfiguration ? state.agents[idConfiguration] : undefined;
    /* L'état de la VIGNETTE, pas celui du bandeau : elle reste tant que le
       travail rendu n'a pas été lu (`etatDeLaVignetteDInitialisation`). */
    const etatInitialisation = etatDeLaVignetteDInitialisation(projetOuvert, agentConfiguration, Date.now(), cible);
    return agentConfiguration && etatInitialisation
      ? [
          <VignetteInitialisationProduction
            key={cible}
            cible={cible}
            agent={agentConfiguration}
            etat={etatInitialisation}
            projet={projetOuvert}
            reconfiguration={procedureEnPlace(projetOuvert, 'production')}
          />,
        ]
      : [];
  });
  /* LES MISES EN PRODUCTION, en tête de « En cours » elles aussi : celle du
     projet ouvert, ou une par projet membre sur le tableau d'un groupe — tant
     qu'elle tourne, puis tant qu'elle n'a pas été lue. Sur le tableau d'un
     groupe, le clic ouvre le tiroir du groupe sur CE projet (`productionDemandee`). */
  const vignettesProduction = (membresDuGroupe.length ? membresDuGroupe : projetOuvert ? [projetOuvert] : []).flatMap(
    (projet) => {
      const run = state.productions[projet.id];
      return run
        ? [
            <VignetteMiseEnProduction
              key={`production-${projet.id}`}
              run={run}
              projet={projet}
              avecProjet={membresDuGroupe.length > 0}
              onOpen={() => client.demanderProduction({ projectId: projet.id, surPlace: membresDuGroupe.length > 0 })}
            />,
          ]
        : [];
    },
  );
  const vignetteInitialisation =
    vignettesProduction.length || vignettesInitialisation.length ? (
      <>
        {vignettesProduction}
        {vignettesInitialisation}
      </>
    ) : null;

  /*
   * Ce qu'un ONGLET du tableau (téléphone) a à signaler, colonne par colonne :
   * les mêmes deux comptes que la ligne d'un projet — une décision attendue, un
   * travail rendu pas encore lu. On ne réinvente rien : le compte des décisions
   * vient de `alertesParCarte`, l'état « rendu, pas lu » de `etatVisuelCarte`,
   * exactement comme la carte elle-même. `repereVisible` tranche ensuite lequel
   * des deux s'affiche (la décision d'abord), pour un seul repère par onglet.
   */
  /* Le triangle d'une carte ne dit QUE les demandes qui alertent : un incident
     (quota, erreur de tour) se lit dans la cloche, pas sur la tuile. */
  const decisionsCarte = alertesParCarte(state.decisions);
  const etatDeCarte = (card: Card) => {
    const agentCarte = card.agentId ? state.agents[card.agentId] : null;
    return etatVisuelCarte({
      agentStatut: agentCarte?.status,
      analyseEnCours: travailParCarte.has(card.id),
      enAttente: !!card.scheduling?.waitingReason,
      estimationEchouee: card.estimate?.failed,
      enLigne: !!card.deployedAt,
    });
  };
  /* « Rendu non consulté » : la MÊME règle que la pastille de la carte. */
  const nonConsultee = (card: Card) =>
    carteNonLue({
      colonne: card.column,
      renduA: instantDuRendu(card, card.agentId ? state.agents[card.agentId] : null),
      luA: card.lastReadAt,
    });
  /*
   * ON ROUVRE LE TABLEAU LÀ OÙ ON L'AVAIT LAISSÉ : la rangée regardée est
   * retenue projet par projet, en base. Le tableau ne glisse plus de gauche à
   * droite mais de HAUT EN BAS — quatre rangées empilées, chacune haute d'une
   * carte —, et c'est donc la rangée qui touche le HAUT du cadre qu'on retient.
   */
  const rail = React.useRef<HTMLDivElement>(null);

  /**
   * La rangée qui touche le haut du tableau. Elle est retenue projet par
   * projet, pour rouvrir au même endroit. Même lecture qu'avant, sur l'autre
   * axe : `offsetTop` se compte depuis le premier ancêtre POSITIONNÉ, d'où
   * l'attribut `data-column` laissé sur l'enveloppe de la rangée.
   */
  const rangeeEnTete = React.useCallback((): ColumnKey | null => {
    const node = rail.current;
    if (!node) return null;
    // En colonnes, le même repère se lit sur l'axe horizontal.
    const haut = enColonnes ? node.scrollLeft : node.scrollTop;
    const visible = Array.from(node.querySelectorAll<HTMLElement>('[data-column]'))
      .filter((rangee) =>
        enColonnes
          ? rangee.offsetLeft + rangee.offsetWidth > haut + 24
          : rangee.offsetTop + rangee.offsetHeight > haut + 24,
      )
      .shift();
    return (visible?.getAttribute('data-column') as ColumnKey | null) ?? null;
  }, [enColonnes]);

  /*
   * Tant que les cartes du projet ne sont pas arrivées, le tableau rend la
   * SILHOUETTE (plus bas) : le rail n'existe pas encore dans la page, sa ref
   * reste `null`. Les effets qui suivent doivent donc se RELANCER dès que ce
   * chargement bascule — sinon, sur un projet fraîchement ouvert, ils
   * s'exécutent une seule fois avec une ref introuvable et ne s'y raccrochent
   * jamais, même une fois le tableau réellement affiché : leurs autres
   * dépendances ne changent pas entre les deux rendus, React ne les rejoue
   * donc pas de lui-même.
   */
  const tableauCharge = !!state.cartesChargees[projectId];

  React.useEffect(() => {
    if (!tableauCharge) return;
    const memorisee = colonneAReprendre(readPref(cleColonneTableau(projectId), null));
    if (!memorisee) return;
    const cible = rail.current?.querySelector<HTMLElement>(`[data-column="${memorisee}"]`);
    if (!cible) return;
    if (enColonnes) rail.current!.scrollLeft = cible.offsetLeft - 12;
    else rail.current!.scrollTop = cible.offsetTop - 12;
  }, [projectId, tableauCharge, enColonnes]);

  /*
   * LA CARTE MONTRÉE PAR LE BADGE BLEU D'UN PROJET. Le tiroir l'ouvre ; le
   * tableau, lui, défile jusqu'à SA rangée (sa colonne en large écran), puis
   * jusqu'à la carte si elle est posée dans la page — sur téléphone surtout,
   * où une carte « Planifié » restait hors de vue derrière la rangée retenue.
   * La carte peut arriver après coup (projet déchargé, `chargerCarte`) : la
   * visée attend donc sa colonne, puis s'efface une fois honorée.
   */
  const carteMontree = state.carteMontree;
  const colonneMontree = carteMontree ? state.cards[carteMontree.cardId]?.column : undefined;
  React.useEffect(() => {
    if (!carteMontree || !tableauCharge || !colonneMontree) return;
    const node = rail.current;
    const rangee = node?.querySelector<HTMLElement>(`[data-column="${colonneMontree}"]`);
    if (!node || !rangee) return;
    if (enColonnes) node.scrollLeft = rangee.offsetLeft - 12;
    else node.scrollTop = rangee.offsetTop - 12;
    rangee
      .querySelector<HTMLElement>(`[data-carte="${carteMontree.cardId}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    client.montrerCarte(null);
  }, [carteMontree, colonneMontree, tableauCharge, enColonnes]);

  /*
   * Au défilement, on note la rangée en tête. L'écriture en base attend une
   * demi-seconde après l'arrêt du doigt : pendant un défilé, chaque pixel n'a
   * pas à traverser le réseau.
   */
  React.useEffect(() => {
    const node = rail.current;
    if (!node) return;
    let timer = 0;
    const noter = () => {
      const cle = rangeeEnTete();
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
  }, [projectId, tableauCharge, rangeeEnTete]);

  /*
   * Le déplacement se fait AU POINTEUR, jamais avec le glisser-déposer natif :
   * le natif ignore le doigt. Au doigt, il faut un appui maintenu, sinon on ne
   * pourrait plus faire défiler le tableau en partant d'une carte.
   */
  const resolve = React.useCallback((element: Element): DropTarget | null => {
    /*
     * DEUX SORTES DE DESTINATIONS, LUES DANS CET ORDRE. Une ligne de projet de
     * la colonne de gauche n'est jamais dans une colonne du tableau, et
     * inversement : le premier qui répond a raison. C'est la NATURE de la cible
     * — et non l'endroit du relâchement — qui distingue « changer d'étape » de
     * « changer de projet ».
     */
    const projet = element.closest('[data-projet-cible]')?.getAttribute('data-projet-cible');
    if (projet) return { id: projet, kind: 'project', position: 'inside' };
    const colonne = element.closest('[data-column]')?.getAttribute('data-column');
    return colonne ? { id: colonne, kind: 'column', position: 'inside' } : null;
  }, []);

  /*
   * LA CONFIRMATION D'UN DÉPÔT QUI DÉPENSE. Elle garde la carte à SA colonne
   * d'origine tant qu'on n'a pas répondu : le déplacement optimiste
   * (`client.moveCard`) n'est appliqué qu'après l'accord, sinon la fenêtre
   * s'ouvrirait sur une carte déjà partie ailleurs.
   */
  const [depotAConfirmer, setDepotAConfirmer] = React.useState<{
    card: Card;
    colonne: ColumnKey;
    titre: string;
    question: string;
  } | null>(null);

  const deposer = React.useCallback((item: DragItem, cible: DropTarget | null) => {
    if (!cible) return;
    /*
     * CANAL COUPÉ : LA CARTE NE BOUGE PAS. Un déplacement part au serveur ;
     * sans lien, il ne partirait nulle part, et la carte se serait pourtant
     * déjà déplacée à l'écran — l'état inventé qu'on cherche justement à
     * supprimer. Le refus se dit, la carte reste où elle est.
     */
    if (gestesGeles(client.lireEtat().canal)) {
      client.pushToast('warning', t(RAISON_CANAL_COUPE));
      return;
    }
    const etatComplet = client.lireEtat();
    const card = etatComplet.cards[item.id];
    if (!card) return;

    /*
     * DÉPOSÉE SUR UN PROJET DE LA COLONNE DE GAUCHE : la carte CHANGE DE
     * PROJET, elle ne change pas d'étape. Le refus porte son motif — celui de
     * la règle partagée, la même qui a éteint la ligne pendant le geste.
     */
    if (cible.kind === 'project') {
      const projet = etatComplet.projects.find((p) => p.id === cible.id);
      const verdict = verdictVersProjet(etatComplet, card, projet, {
        agentActif: card.agentId ? estAgentActif(etatComplet.agents[card.agentId]?.status) : false,
      });
      if (!verdict.possible) {
        client.pushToast('warning', verdict.raison ?? t('Déplacement refusé'));
        return;
      }
      void client
        .call({ type: 'card.deplacerVersProjet', id: card.id, projectId: cible.id })
        .then(() =>
          client.pushToast('success', t('« {v0} » est passée dans {v1}.', { v0: card.title, v1: projet?.name ?? '' })),
        )
        .catch((err: any) => client.pushToast('error', err?.message ?? t('Déplacement refusé')));
      return;
    }

    const column = cible.id as ColumnKey;
    if (card.column === column) return;
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

    /*
     * CE QUE VAUT LE DÉPÔT, LU UNE SEULE FOIS ET AU MÊME ENDROIT QUE LE SERVEUR
     * (`gesteDuDepot`) : l'écran ne recopie pas sa propre liste de colonnes.
     *
     *  - un geste REFUSÉ se dit et la carte reste où elle est, rien ne part ;
     *  - un geste qui DÉPENSE — lancer la tâche, demander le plan — ouvre la
     *    fenêtre de confirmation en nommant ce qu'il va faire ;
     *  - tout le reste part comme avant, sans fenêtre : ranger ou suspendre ne
     *    coûte rien et se rattrape d'un geste.
     */
    const geste = gesteDuDepot(card.column, column);
    if (geste.effet === 'refuser') {
      client.pushToast('warning', geste.raison ?? t('déplacement refusé'));
      return;
    }
    if (geste.depense) {
      setDepotAConfirmer({
        card,
        colonne: column,
        titre: geste.titre ?? t('Confirmer ce geste ?'),
        question: geste.question ?? '',
      });
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
   * geste d'une AUTRE : le geste en vol d'une rangée ne doit jamais faire
   * naître bloqué le bouton d'une autre.
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
    toutPoser(column, totalDeColonne(column, cartesDeLaColonne.length));
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
   * jamais le lot (chaque carte doit être tentée pour recevoir sa raison) ; le `catch` couvre
   * l'imprévu (réseau coupé).
   */
  const tenterUneCarte = async (id: string, action: ActionDeLot): Promise<'faite' | RefusDeLot | null> => {
    const card = client.lireEtat().cards[id];
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
      /*
       * Une carte après l'autre : l'archivage écrit un document de clôture —
       * huit demandes d'un coup se marcheraient dessus. L'état est relu à
       * CHAQUE tour de boucle, la carte précédente ayant pu changer de colonne.
       */
      for (const id of selection) {
        compter(await tenterUneCarte(id, action));
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
    avalerLeRelachement();
  }, []);

  const { dragging, target, pointer, start } = usePointerDrag({
    resolve,
    onDrop: deposer,
    holdMs: 260,
    onLongPress: ouvrirMenu,
  });
  const carteTiree = dragging ? cards.find((card) => card.id === dragging.id) : null;
  /* Seule une COLONNE s'éclaire ici : une ligne de projet visée s'éclaire dans
     la colonne de gauche, qui lit le même geste par `useGlissementDeCarte`. */
  const over = (target?.kind === 'column' ? target.id : null) as ColumnKey | null;

  /*
   * CE QUE LE TABLEAU TIENT, PUBLIÉ POUR LA COLONNE DE GAUCHE. Elle y lit la
   * carte en vol et la ligne qu'elle vise, et n'ouvre AUCUN second mécanisme de
   * glissement pour cela.
   */
  React.useEffect(() => {
    if (!carteTiree) {
      poserLeGlissementDeCarte(null);
      return;
    }
    const etatComplet = client.lireEtat();
    const cibleProjetId = target?.kind === 'project' ? target.id : undefined;
    const projet = cibleProjetId ? etatComplet.projects.find((p) => p.id === cibleProjetId) : null;
    poserLeGlissementDeCarte({
      cardId: carteTiree.id,
      projetSource: carteTiree.projectId,
      cibleProjetId,
      cibleAcceptee: cibleProjetId
        ? verdictVersProjet(etatComplet, carteTiree, projet, {
            agentActif: carteTiree.agentId
              ? estAgentActif(etatComplet.agents[carteTiree.agentId]?.status)
              : false,
          }).possible
        : undefined,
    });
  }, [carteTiree, target]);
  React.useEffect(() => () => poserLeGlissementDeCarte(null), []);

  /*
   * LE TABLEAU SUIT LA CARTE TIRÉE, SUR LES DEUX AXES.
   * En haut ou en bas du cadre, ce sont les RANGÉES qui défilent (le tableau
   * s'empile à la verticale). À gauche ou à droite, c'est la BANDE DE CARTES
   * survolée qui glisse : sans elle, on ne pourrait pas déposer une carte au
   * bout d'une rangée plus longue que l'écran.
   */
  React.useEffect(() => {
    if (!dragging || !pointer) return;
    const zone = 70;
    const timer = window.setInterval(() => {
      const node = rail.current;
      if (!node) return;
      const boite = node.getBoundingClientRect();
      /* En colonnes, les axes s'échangent : le tableau glisse de gauche à
         droite, la colonne survolée de haut en bas. */
      if (enColonnes) {
        if (pointer.x < boite.left + zone) node.scrollLeft -= 14;
        else if (pointer.x > boite.right - zone) node.scrollLeft += 14;
      } else if (pointer.y < boite.top + zone) node.scrollTop -= 14;
      else if (pointer.y > boite.bottom - zone) node.scrollTop += 14;
      const sous = document.elementFromPoint(pointer.x, pointer.y);
      const bande = sous?.closest<HTMLElement>('[data-bande-cartes]');
      if (!bande) return;
      const cadre = bande.getBoundingClientRect();
      if (enColonnes) {
        if (pointer.y < cadre.top + zone) bande.scrollTop -= 14;
        else if (pointer.y > cadre.bottom - zone) bande.scrollTop += 14;
      } else if (pointer.x < cadre.left + zone) bande.scrollLeft -= 14;
      else if (pointer.x > cadre.right - zone) bande.scrollLeft += 14;
    }, 16);
    return () => window.clearInterval(timer);
  }, [dragging, pointer, enColonnes]);

  /*
   * LES CARTES DE CE PROJET NE SONT PAS ENCORE ARRIVÉES : le serveur les envoie
   * en un bloc (`project.etat`), demandé à l'ouverture du projet. Entre les
   * deux, `state.cards` ne contient rien pour ce projet — les colonnes vides,
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

  return (
    /* Le tableau DIT le projet qu'il montre : un contrôle qui pose une carte
       d'essai vise ce projet-là, sans deviner lequel est actif. */
    <div className="flex h-full min-h-0 flex-col" data-tableau={projectId}>
      {/*
        LE TABLEAU S'EMPILE EN RANGÉES, ET C'EST LUI QUI DÉFILE À LA VERTICALE.
        Chaque rangée tient la LARGEUR ENTIÈRE et la hauteur d'une carte ; les
        cartes s'y alignent à gauche et glissent latéralement dans leur propre
        bande. Quatre rangées tiennent ainsi dans un écran d'ordinateur, et sur
        téléphone c'est le tableau qui descend — jamais quatre colonnes de
        300 px à pousser du doigt de gauche à droite.
      */}
      {/* EN COLONNES, le même rail se couche : il défile de gauche à droite,
          colonne par colonne (aimantation au bord gauche, coupée pendant un
          glisser pour ne pas lutter contre le défilement automatique). */}
      <ZoneDefilement
        ref={rail}
        key={disposition}
        axe={enColonnes ? 'horizontal' : 'vertical'}
        classeEnveloppe="min-h-0 flex-1"
        data-disposition-tableau={disposition}
        className={cn(classesRail(enColonnes), enColonnes && !dragging && 'snap-x snap-mandatory')}
      >
      {/* TOUTES LES RANGÉES ONT LA MÊME HAUTEUR, vides ou pleines : une grille
          à pistes égales (`auto-rows-fr`) cale chaque rangée sur la plus haute
          — « À déployer » et son pied compris. La grille vit dans une
          enveloppe SANS hauteur imposée : posée directement sur le rail (qui a
          la hauteur de l'écran), `1fr` étirerait les quatre rangées jusqu'à
          remplir la fenêtre. */}
      {/* En colonnes, les quatre étapes se posent côte à côte, pleine hauteur :
          sur téléphone une colonne tient l'écran, sur ordinateur elles se
          partagent la largeur. */}
      <div
        className={classesEmpilement(enColonnes)}
        data-rangees-egales={enColonnes ? undefined : ''}
        data-colonnes-cote-a-cote={enColonnes ? '' : undefined}
      >
      {COLONNES_AFFICHEES.map((column) => {
        const archives = column === 'archived';
        const columnCards = byColumn(column);
        // Ce qui est RÉELLEMENT posé dans la page : le premier paquet de vingt,
        // puis un paquet de plus à chaque fois que le bout approche.
        const cartesPosees = cartesDuPaquet(columnCards, paquets[column] ?? 1);
        const action = actionDeLot(column);
        const allowed = !carteTiree || canMove('user', carteTiree.column, column).allowed;
        /*
         * COMBIEN DE CARTES TRAVAILLENT DANS CETTE RANGÉE ? Le même index que
         * l'avancement, déjà construit une fois pour tout le rendu. C'est ce
         * seul nombre qui allume l'indicateur d'activité
         * (`shared/src/indicateur-activite.ts`).
         */
        /* « Demande » vit du CADRAGE, pas d'un agent de tâche : c'est l'index
           « tous rôles » qu'elle lit, sinon son indicateur resterait éteint
           pendant qu'une compréhension ou un plan s'écrit. */
        const occupees = column === 'planned' ? travailParCarte : agentsTacheParCarte;
        const auTravail = columnCards.reduce((n, card) => n + (occupees.has(card.id) ? 1 : 0), 0);
        /* L'ENVELOPPE PORTE `data-column`, JAMAIS LA BOÎTE INTÉRIEURE :
           `rangeeEnTete` lit `offsetTop`, qui se compte depuis le premier
           ancêtre POSITIONNÉ — descendre l'attribut d'un cran le rendrait
           relatif à l'enveloppe (donc toujours 0). C'est aussi lui que
           cherche `closest('[data-column]')` au dépôt d'une carte.
           LA RANGÉE FAIT TOUTE LA LARGEUR, même à moitié vide : sans cela, une
           rangée qui ne compte qu'une carte n'offrirait aucune cible de dépôt
           sur sa droite — l'équivalent, couché, de la colonne pleine hauteur. */
        return (
          <div
            key={column}
            data-column={column}
            className={cn(
              /* PLUS DE CADRE, ni trait plein ni dégradé : un fond plat, et
                 pendant un dépôt un ANNEAU (`ring`, qui ne déplace aucun
                 pixel de contenu, contrairement à une bordure) marque la
                 rangée visée. L'avancement (orange « En cours », bleu « À
                 déployer ») ne vit plus ici : il vit dans le bandeau de
                 titre, en fond plat (voir plus bas). */
              classesRangee(enColonnes, telephone),
              'transition-colors',
              over === column && allowed && 'bg-surface ring-1 ring-inset ring-accent',
              carteTiree && !allowed && 'opacity-40',
            )}
          >
            <div className="flex h-full w-full flex-col">
            {/* LE BANDEAU DE TITRE DE LA RANGÉE, SUR TOUTE SA LARGEUR. Le
                repère de couleur (« En cours » / « À déployer ») est un fond
                PLAT posé directement sur ce bandeau — jamais un dégradé,
                jamais une bordure : `verif-couleurs-avancement` le lit
                désormais sur `backgroundColor` de `[data-tete-colonne]`. */}
            <div
              className={cn(
                CLASSES_TETE_RANGEE,
                column === 'running' && 'bg-en-cours/10',
                column === 'to_deploy' && 'bg-termine/10',
              )}
              data-tete-colonne={column}
            >
              {/* Une publication de CETTE rangée tourne : un indicateur qui
                  tourne, posé à GAUCHE du libellé, le signale sans aucun texte. */}
              {(() => {
                const run = state.deploys[projectId];
                const etapeCol = etapeDeLaColonne(column);
                const publie =
                  !!run && run.state === 'running' && !!etapeCol && runDeLEtape(run.cible, etapeCol);
                return publie ? (
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin text-publie" data-publication-en-cours={column} />
                ) : null;
              })()}
              {/* « QUELQUE CHOSE TRAVAILLE ICI » : le point qui a remplacé le
                  personnage animé. */}
              <IndicateurActivite cartesAuTravail={auTravail} className="relative" />
              <h2 className="relative shrink-0 whitespace-nowrap text-[13px] font-medium uppercase tracking-wide text-faint">{t(COLUMN_LABELS[column])}</h2>
              {/* LE COMPTEUR COMPTE CE QUE LA LISTE MONTRE, sans exception :
                  pas de carte affichée qui ne soit comptée, pas de compte sans
                  carte. */}
              <span className="relative shrink-0 whitespace-nowrap text-[12.5px] text-faint" data-compteur-colonne={column}>
                {compteurDeColonne(totalDeColonne(column, columnCards.length))}
              </span>
              {/* À droite du bandeau : le couple annuler / confirmer du lot en
                  cours, l'avancement global de « En cours », les réglages de
                  « À déployer » (le « i » puis l'interrupteur), PUIS le menu
                  trois points. Un SEUL groupe collé à droite (`ml-auto` posé
                  UNE fois sur le conteneur). */}
              <div className="ml-auto flex min-w-0 items-center gap-1">
                {/* « NOUVELLE TÂCHE », EN HAUT À DROITE DE « DEMANDE » : la
                    place qu'occupait « Tout lancer ». Présent même rangée
                    vide — c'est le seul chemin vers une nouvelle carte. */}
                {column === 'planned' ? <BoutonNouvelleTache projectId={projectId} /> : null}
                {/* LE GESTE DE LOT (« Tout archiver ») N'A PLUS DE BOUTON DANS
                    LE BANDEAU : il s'ouvre depuis le menu à trois points. Une
                    fois les cases sorties, son SECOND TEMPS (annuler /
                    confirmer) revient ici, le temps du lot. */}
                {action && columnCards.length && colonneEnLot === column ? (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={colonneQuiTravaille === column}
                      onClick={() => fermerLot()}
                    >
                      {t('Annuler')}
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      disabled={!selection.length || colonneQuiTravaille === column || canal.gele}
                      title={canal.gele ? canal.raison : undefined}
                      onClick={() => appliquerLot(action, column)}
                    >
                      {colonneQuiTravaille === column ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                      {action.verbe} ({selection.length})
                    </Button>
                  </div>
                ) : null}
                {column === 'running' ? <RepereAvancement avancement={avancementDeCesCartes(columnCards)} /> : null}
                {/* LES RÉGLAGES DE « À DÉPLOYER » VIVENT EN HAUT À DROITE, dans
                    LES DEUX dispositions (rangées comme colonnes) : le « i »
                    des informations de mise en ligne, puis l'interrupteur de
                    déploiement automatique, juste avant le menu trois points.
                    Le pied de la rangée ne garde que le bouton de publication. */}
                {column === 'to_deploy' ? (
                  <div className="flex shrink-0 items-center gap-1" data-reglages-tete={column}>
                    <BoutonInfosPublication colonne={column} infos={infosPublication[column] ?? null} />
                    {/* Une carte rendue tombe DANS cette rangée : c'est donc ici
                        que se règle si le lot part en ligne tout seul une fois
                        que plus rien ne travaille. Éteint par défaut ; publier
                        reste sinon un geste de l'utilisateur. */}
                    <InterrupteurDeploiementAuto
                      projectId={projectId}
                      actif={projetOuvert?.deploiementAutomatique === true}
                    />
                    {/* LES RÉGLAGES DU DÉPLOIEMENT, à droite de l'interrupteur :
                        la rubrique où l'agent de configuration écrit le
                        processus, et où il se discute. */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted"
                      onClick={() => ouvrirRubriqueDeLEtape(projectId, 'dev')}
                      aria-label="Réglages du déploiement"
                      title={t('Réglages du déploiement')}
                      data-reglages-deploiement-tete={column}
                    >
                      <Settings2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : null}
                {/* Le menu à trois points ne porte plus « Archives » : la
                    rangée des archives est sur le tableau, juste en dessous.
                    Il garde « Configuration » (la procédure de mise en ligne),
                    porte désormais « Tout archiver » (le geste de lot, qui
                    encombrait le bandeau) et le geste de lecture. */}
                <MenuTeteColonne
                  colonne={column}
                  cartesNonLues={columnCards.filter(nonConsultee)}
                  entrees={
                    column === 'to_deploy' ? (
                      <>
                        {action && columnCards.length ? (
                          <DropdownMenuItem
                            data-geste-de-lot={column}
                            disabled={canal.gele || colonneEnLot === column}
                            title={canal.gele ? canal.raison : undefined}
                            onSelect={() => ouvrirLot(column)}
                          >
                            <action.icone className="h-3.5 w-3.5" />  {action.libelle}
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem
                          data-reglages-procedure={etapeDeLaColonne(column)?.cible ?? 'dev'}
                          onSelect={() => {
                            const etapeCol = etapeDeLaColonne(column);
                            if (etapeCol) ouvrirRubriqueDeLEtape(projectId, etapeCol.cible);
                          }}
                        >
                          <Settings2 className="h-3.5 w-3.5" />  {t('Configuration')}
                        </DropdownMenuItem>
                      </>
                    ) : undefined
                  }
                />
              </div>
            </div>

            {/* L'ANCRE DU DÉROULÉ de la publication : le bloc y pose, par
                portail, ce qui n'a pas à rester figé (phrases d'explication,
                échec du contrôle d'avant-clic). Vide le reste du temps. Elle
                tient TOUTE LA LARGEUR de la rangée, hors de la bande qui
                glisse : un texte n'a pas à défiler latéralement. */}
            {column === 'to_deploy' ? (
              <div
                className="shrink-0 px-1.5"
                id={`deroule-publication-${projectId}-${column}`}
                data-deroule-publication={column}
              />
            ) : null}

            {/* CE QUI N'A PAS DE CARTE SE DIT ICI, au-dessus des cartes et
                jamais derrière un bouton : du travail mis en ligne — ou prêt à
                partir — que rien ne montre expose à l'oublier sans l'avoir
                jamais vu. Les DEUX rangées qui publient le disent. */}
            {column === 'to_deploy' || archives ? (
              <div className={CLASSES_ALERTE_RANGEE}>
                <AlerteTravailSansCarte
                  colonne={column}
                  projectId={projectId}
                  travail={sansCarte[column] ?? null}
                  verbe={etapeDeLaColonne(column)?.verbe ?? 'déployer'}
                  onFiche={() => setSansCarte((prev) => ({ ...prev, [column]: null }))}
                />
              </div>
            ) : null}

            {/*
              LA BANDE DE CARTES : un SEUL défilement, horizontal, avec sa barre
              dessinée (invisible au repos, visible pendant le mouvement) et le
              voile qui dit, à gauche comme à droite, qu'il reste des cartes
              hors du cadre. `overflow-y-hidden` est posé par `ZoneDefilement` :
              sans lui, le navigateur repasse l'axe vertical en « auto » dès que
              l'autre déborde, et la rangée se mettrait à flotter.
              En mode sélection, la case à cocher DÉBORDE du coin haut-gauche de
              la carte : il faut donc lui laisser la place.
            */}
            {/* En colonnes, la même bande se dresse : les cartes s'empilent
                de haut en bas et c'est elle qui défile, entre l'entête et le
                pied. */}
            <ZoneDefilement
              axe={enColonnes ? 'vertical' : 'horizontal'}
              voile
              barre
              fond="hsl(var(--surface))"
              classeEnveloppe={enColonnes ? 'min-h-0 w-full flex-1' : 'w-full'}
              data-bande-cartes={column}
              className={cn(
                classesBande(enColonnes),
                enColonnes ? 'overscroll-y-contain' : 'overscroll-x-contain',
                colonneEnLot === column && 'pl-[15px] pt-[15px]',
              )}
            >
              {column === 'running' && vignetteInitialisation ? (
                <div className={cn(enColonnes ? 'w-full' : CLASSE_LARGEUR_CARTE, 'flex shrink-0 flex-col gap-2')}>
                  {vignetteInitialisation}
                </div>
              ) : null}
              {cartesPosees.map((card) => {
                const cochable = colonneEnLot === column;
                const tuile = (
                  <div className={cn(enColonnes ? 'w-full' : CLASSE_LARGEUR_CARTE, 'shrink-0')}>
                    <CardTile
                      card={card}
                      onOpen={(event) => clicCarte(card, column, event)}
                      onPointerDown={
                        cochable
                          ? undefined
                          : (event) => {
                              // Ctrl/Cmd/Maj ne lance pas un glissement : c'est
                              // un geste de sélection, tranché ensuite au clic.
                              if (survolPossible && (event.ctrlKey || event.metaKey || event.shiftKey)) return;
                              start(event, { id: card.id, kind: 'card', label: card.title });
                            }
                      }
                      dimmed={dragging?.id === card.id}
                      coche={cochable ? selection.includes(card.id) : undefined}
                      menuOuvert={menuCarte === card.id}
                      onMenuChange={(ouvert) => setMenuCarte(ouvert ? card.id : null)}
                      hauteurLibre={enColonnes}
                    />
                  </div>
                );
                /* LE REGROUPEMENT PAR PUBLICATION N'EXISTE PLUS (a826871c) :
                   les archives posent leurs cartes une à une, comme toutes les
                   autres rangées. Le geste de SORTIE n'a pas de bouton posé à
                   part sous la carte : il vit dans le menu de la carte
                   elle-même (clic droit / appui long), qui porte déjà ce même
                   geste de reprise pour toutes les colonnes
                   (`colonneDeReprise`, la règle unique). */
                return <React.Fragment key={card.id}>{tuile}</React.Fragment>;
              })}
              {/* Le palier de chargement : après la dernière carte posée, il
                  demande le paquet suivant dès qu'il approche du bord. Il
                  disparaît quand toute la rangée est là. */}
              {resteDesCartes(totalDeColonne(column, columnCards.length), paquets[column] ?? 1) ||
              totalDeColonne(column, columnCards.length) > cartesPosees.length ? (
                <PalierDeChargement
                  key={disposition}
                  axe={enColonnes ? 'vertical' : 'horizontal'}
                  colonne={column}
                  posees={cartesPosees.length}
                  restant={totalDeColonne(column, columnCards.length) - cartesPosees.length}
                  onCharger={() => chargerLaSuite(column, totalDeColonne(column, columnCards.length))}
                />
              ) : null}
              {!columnCards.length && !(column === 'running' && vignetteInitialisation) ? (
                <p className="shrink-0 px-1.5 py-3 text-[13px] text-faint">
                  {column === 'planned'
                    ? t('Aucune demande pour l’instant.')
                    : column === 'running'
                    ? t('Glissez ici pour lancer le travail.')
                    : column === 'to_deploy'
                      ? /* « Rien à mettre en ligne » était le mensonge le
                           plus direct : écrit alors que du travail
                           attendait juste au-dessus. Tant qu'il en
                           reste, la rangée ne dit plus « rien ». */
                        phraseDeColonneVide(sansCarte.to_deploy ?? null)
                      : t('Aucune carte rangée ici pour l’instant.')}
                </p>
              ) : null}
            </ZoneDefilement>

            {/* LE PIED DE « À DÉPLOYER » : la barre de mise en ligne, posée EN
                BAS de la rangée (`mt-auto`) sur toute sa largeur. Il ne porte
                PLUS RIEN D'AUTRE que le bouton de publication — ni fusée ni nom
                d'étape à gauche, ni interrupteur ni « i » à droite : ces deux
                réglages vivent en haut à droite du bandeau de titre, dans les
                deux dispositions. Pendant une mise en ligne, c'est DANS ce
                bouton que se lisent la barre d'avancée et le pourcentage. */}
            {column === 'to_deploy' ? (
              <>
                {/* AUCUN FOND PROPRE : le pied prend celui de la rangée qui
                    l'entoure et disparaît visuellement. Le voile `bg-termine/10`
                    (la teinte « terminé ») et la fine bande `bg-bandeau-etape`
                    posée dessous peignaient DEUX couleurs au même endroit, dans
                    une barre qui ne doit plus se lire comme un bloc. Le bas de
                    la rangée est repris par le `pb-3` de ce pied : les contrôles
                    qui mesuraient « le pied et sa bande » retombent d'eux-mêmes
                    sur le pied seul (`nextElementSibling ?? pied`). */}
                <div
                  className={CLASSES_PIED_RANGEE}
                  data-pied-rangee={column}
                >
                  <DeployPanel
                    projectId={projectId}
                    cards={columnCards}
                    colonne={column}
                    presentation="compact"
                    ancreDeroule={`deroule-publication-${projectId}-${column}`}
                    onInfos={(infos) => setInfosPublication((prev) => ({ ...prev, [column]: infos }))}
                    onSansCarte={(travail) => setSansCarte((prev) => ({ ...prev, [column]: travail }))}
                    onInitier={() => {
                      const etapeCol = etapeDeLaColonne(column);
                      if (etapeCol) ouvrirRubriqueDeLEtape(projectId, etapeCol.cible);
                    }}
                  />
                </div>
              </>
            ) : null}
            </div>
          </div>
        );
      })}
      </div>

      {/*
        L'aperçu suit le doigt. Il garde EXACTEMENT la largeur d'une carte dans
        sa rangée : au doigt, un aperçu qui rétrécit donne l'impression que la
        carte a changé de taille en route.
      */}
      {dragging && pointer ? (
        <div
          className="pointer-events-none fixed z-50 rounded-md border border-muted bg-raised px-2.5 py-2 text-[14px] font-medium leading-snug text-text shadow-2xl"
          style={{ left: pointer.x + 12, top: pointer.y - 18, width: LARGEUR_CARTE_PX }}
        >
          {dragging.label}
        </div>
      ) : null}
      </ZoneDefilement>

      {/*
        LE BANDEAU DE MISE EN PRODUCTION, en bas du tableau, en bande flottante
        détachée des bords (mêmes marges et coins arrondis que le menu du bas
        mobile). Un FRÈRE du rail, jamais un enfant de la ZoneDefilement : le
        rail garde `min-h-0 flex-1` et remonte de la hauteur du bandeau au lieu
        de passer dessous.
      */}
      {/* UN REGROUPEMENT NE PUBLIE RIEN LUI-MÊME : son bandeau liste ses projets
          membres, chacun avec son bouton, plus un bouton qui les lance tous
          (`bandeau-production-groupe.tsx`). Un projet ordinaire garde le sien. */}
      {membresDuGroupe.length && projetOuvert ? (
        <BandeauProductionGroupe groupe={projetOuvert} membres={membresDuGroupe} />
      ) : (
      <DeployPanel
        projectId={projectId}
        cards={parColonne.archived}
        colonne="archived"
        presentation="bandeau"
        onInfos={(infos) => setInfosPublication((prev) => ({ ...prev, archived: infos }))}
        onSansCarte={(travail) => setSansCarte((prev) => ({ ...prev, archived: travail }))}
        /* Plus d'icône de réglages : le tiroir porte lui-même l'onglet
           « Conversation » avec l'agent de configuration. */
        actions={<BoutonInfosPublication colonne="archived" infos={infosPublication.archived ?? null} />}
      />
      )}

      {/* LA CONFIRMATION D'UN DÉPÔT QUI DÉPENSE. Elle nomme le geste exact et la
          carte concernée ; refuser ne laisse partir AUCUNE requête, et la carte
          n'a jamais quitté sa colonne. */}
      <ConfirmDialog
        open={!!depotAConfirmer}
        title={depotAConfirmer ? t(depotAConfirmer.titre) : ''}
        description={
          depotAConfirmer ? `« ${depotAConfirmer.card.title} » — ${depotAConfirmer.question}` : ''
        }
        confirmLabel={t('Continuer')}
        onConfirm={async () => {
          if (depotAConfirmer) await client.moveCard(depotAConfirmer.card, depotAConfirmer.colonne);
        }}
        onClose={() => setDepotAConfirmer(null)}
      />
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

/**
 * LE GESTE « NOUVELLE TÂCHE », UNE SEULE FOIS ÉCRIT. Le bouton en haut
 * à droite de « Demande » s'en sert ; tout autre dessin qui crée une carte
 * de cadrage passe par lui aussi. Un seul
 * geste — un second appel `card.create` recopié aurait fini par diverger.
 */
function useNouvelleTache(projectId: string) {
  const [busy, setBusy] = React.useState(false);
  const ouvrir = async () => {
    if (busy) return;
    if (gestesGeles(client.lireEtat().canal)) {
      client.pushToast('warning', t(RAISON_CANAL_COUPE));
      return;
    }
    setBusy(true);
    try {
      const data = await client.call<{ card: Card }>({
        type: 'card.create',
        projectId,
        title: TITRE_CARTE_DE_CADRAGE,
        cadrage: true,
      });
      if (data?.card) client.openCard(data.card.id);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('création impossible'));
    } finally {
      setBusy(false);
    }
  };
  return { busy, ouvrir };
}

/**
 * UN MENU OUVERT À L'APPUI LONG s'ouvre pendant que le doigt appuie encore :
 * le relever serait lu comme un geste au-dehors et refermerait tout dans la
 * seconde. On avale donc ce relâchement-là, et lui seul. Partagé par le
 * tableau et la page « Tableaux de bord ».
 */
export function avalerLeRelachement(): void {
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
}

/**
 * LE BOUTON « NOUVELLE TÂCHE », EN HAUT À DROITE DE LA RANGÉE « DEMANDE ».
 *
 * Il a remplacé la grande tuile permanente posée en tête des cartes (et, à sa
 * place dans l'entête, « Tout lancer ») : compact, au même endroit que le
 * geste de lot des autres rangées. Il n'est PAS une carte enregistrée : le
 * clic fait naître la VRAIE carte de cadrage et ouvre son fil. Sur écran
 * étroit, le libellé se coupe (jamais replié sur deux lignes) et le « + »
 * reste.
 */
function BoutonNouvelleTache({ projectId }: { projectId: string }) {
  const { busy, ouvrir } = useNouvelleTache(projectId);
  const canal = useCanal();
  return (
    <Button
      variant="outline"
      size="sm"
      className="min-w-0 max-w-[160px] shrink-0 overflow-hidden"
      // Le repère des scripts de vérification : c'est LUI qui ouvre une
      // carte-fil, comme l'ancienne tuile et, avant elle, le « + ».
      data-nouvelle-carte="planned"
      aria-label="Nouvelle tâche"
      aria-busy={busy}
      title={canal.gele ? canal.raison : undefined}
      disabled={busy || canal.gele}
      onClick={() => void ouvrir()}
    >
      {busy ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : <Plus className="h-3 w-3 shrink-0" />}
      <span className="truncate">{t(TITRE_CARTE_DE_CADRAGE)}</span>
    </Button>
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
  hauteurLibre,
  enRoute,
}: {
  card: Card;
  onOpen: (event?: React.MouseEvent) => void;
  /**
   * LA FORME DE LA PAGE « EN ROUTE ». La ligne qui coiffait la carte (projet,
   * étape, date) rentre DEDANS : `gauche` en haut à gauche, `droite` dans le
   * coin haut droit — le badge « en ligne » y remplace celui qui précède le
   * titre au tableau. Sous le titre, le début de la DEMANDE — le premier
   * message écrit par l'utilisateur (`demande`), à défaut la description ;
   * l'ancienneté tombe en bas à gauche. Absente, la carte est celle du
   * tableau, inchangée.
   */
  enRoute?: { gauche: React.ReactNode; droite?: React.ReactNode; demande?: string };
  /**
   * EN COLONNES, la carte prend la hauteur de son contenu : la hauteur fixe
   * n'existe que pour aligner les cartes voisines d'une même RANGÉE.
   */
  hauteurLibre?: boolean;
  onPointerDown?: (event: React.PointerEvent) => void;
  dimmed?: boolean;
  /** Non défini : pas de sélection en cours. Défini : la case s'affiche, cochée ou non. */
  coche?: boolean;
  /** Le menu des gestes rares, ouvert à l'appui long ou au clic droit. */
  menuOuvert?: boolean;
  onMenuChange?: (ouvert: boolean) => void;
}) {
  const state = useApp();
  // Le premier message écrit par l'utilisateur, déjà nettoyé par le démon ;
  // sans lui, la description, aplatie sans ses pastilles « [fichier: …] ».
  const formeEnRoute = !!enRoute;
  const demande = enRoute?.demande;
  const extraitDescription = React.useMemo(
    () => (formeEnRoute ? demande || debutDeLaDemande(card.description) : ''),
    [formeEnRoute, demande, card.description],
  );
  /* Le titre et la demande se replient sur deux lignes, et le corps d'une carte
     « En route » a une hauteur fixe : dès que l'un des trois coupe le texte, une
     pastille « i » le donne en entier. */
  const corpsRef = React.useRef<HTMLDivElement>(null);
  const titreRef = React.useRef<HTMLHeadingElement>(null);
  const descriptionRef = React.useRef<HTMLParagraphElement>(null);
  /* Titre vide ou éclair : un petit texte tient la place, et la bulle de texte
     coupé ne s'ouvre pas dessus (on ne lui passe pas le titre recopié). */
  const titreEnCours = titreEnConstruction(card);
  const texteCoupe = useTexteCoupe(
    [titreRef, descriptionRef, corpsRef],
    [titreEnCours ? '' : card.title, extraitDescription, formeEnRoute],
  );
  /*
   * L'appui long est suivi d'un clic que le navigateur envoie quand même : sans
   * ce garde-fou, le tiroir de la carte s'ouvrirait derrière le menu.
   */
  const ouvertureMenu = React.useRef(0);
  /* Le nombre d'alertes au dernier clic d'ouverture : la carte ne se secoue
     plus pour ce qu'on a déjà vu (`carteDoitSecouer`). */
  const [alertesVues, setAlertesVues] = React.useState<number | undefined>(undefined);
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
    // Ouvrir la carte, c'est l'avoir vue : sa secousse se calme.
    setAlertesVues(alertesQuiSecouent);
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
  /*
   * UN AGENT ARRÊTÉ SUR SA QUESTION N'EST EN TRAVAIL POUR PERSONNE. Son tour
   * vit — `ask_user` bloque jusqu'à la réponse —, donc `agentTientSonTour` le
   * garde ; mais la carte ne doit ni tourner ni dire « au travail » : elle
   * attend la réponse (`Agent.attendReponse`, posé par le registre des
   * attentes).
   */
  const attendQuestion = !!agentActif?.attendReponse;
  /*
   * UNE MÈRE TRAVAILLE PAR SES FILLES. Elle ne lance aucun agent : ce qui
   * tourne se lit sur son seul relevé (`card.suiviDesFilles`), jamais sur les
   * agents ou cartes des filles, souvent déchargés de l'écran (DEC-258).
   */
  const filles = card.cartesFilles?.length ? activiteDeLaMere(card.suiviDesFilles) : null;
  const fillesAuTravail = !!filles && filles.enTravail > 0;
  const fillesActives = !!filles && filles.enTravail + filles.enQuestion > 0;

  /*
   * LE LANCEMENT EN PRÉPARATION. Entre le clic et le premier mot du moteur, la
   * carte est DÉJÀ en « En cours » (le déplacement se fait au clic) mais aucun
   * agent ne travaille encore : l'ouverture de la copie de travail peut tenir
   * plusieurs minutes sur un gros dépôt. L'étape est diffusée par le démon
   * (`card.lancement`) ; la règle qui décide de l'afficher est PURE
   * (`preparationAAfficher`) : elle l'oublie dès qu'un agent parle, dès que la
   * carte a quitté « Travail » — une carte déjà en « Rapport » ne prépare plus
   * rien — et dès que le signal est plus vieux que le démon en cours.
   */
  const lancement = state.lancements[card.id];
  const preparation = lancement
    ? preparationAAfficher({
        etape: lancement.etape,
        depuis: lancement.depuis,
        colonne: card.column,
        agentAuTravail,
        demonDemarreA: state.demon?.demarreA,
        maintenant,
      })
    : null;
  /*
   * LA BARRE DE TRAVAIL, DÈS LE PREMIER INSTANT — pas seulement une fois
   * qu'une étape est cochée. Elle est posée par `BandeauTravail`, partagé avec
   * les agents sans carte de la page « Tableaux de bord » ; son chronomètre y
   * avance seconde par seconde sans redessiner la carte entière. Sans le
   * bouton d'arrêt — pas de place ici, et un second geste d'arrêt aurait
   * dérivé de celui du tiroir.
   */
  const travailActuel = agentActif && !attendQuestion ? agentActif : null;

  /*
   * L'avancement de la liste de tâches de l'agent de la carte, tel qu'il
   * voyage avec lui (champ `todos` de l'agent, `card.agentId`). Le décompte
   * reste affiché même une fois l'agent arrêté : c'est le dernier connu, sur
   * TOUTES les cartes qui en ont un — pas seulement celle où ça travaille
   * encore. Tant que la barre de travail ci-dessus parle, elle dit déjà ce
   * compte : cette mention-ci ne reprend la parole qu'une fois l'agent arrêté.
   */
  const progression =
    travailActuel || fillesActives ? null : mentionProgressionTaches({ todos: agent?.todos });

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
  /* Le GESTE de parcours attendu (générer le plan, le valider, lancer) ne se
     redit pas ici : l'icône d'étape et la pastille bleue le portent déjà sur
     la carte. Il reste dans la cloche et sur la ligne du projet. */
  const decisionsSansGeste = state.decisions.filter((d) => d.source !== 'geste-de-parcours');
  const decisions = alertesParCarte(decisionsSansGeste)[card.id] ?? 0;
  /*
   * ET DE QUELLE NATURE ? La même table que la ligne du projet et la cloche
   * (`iconeDuLot`) : message pour une question, chemin pour un plan à générer
   * ou une carte à lancer, triangle pour ce qui bloque. La phrase de
   * l'infobulle vient de la décision elle-même quand elle n'en porte qu'une —
   * « Le plan peut être généré » vaut mieux que « une décision attendue ».
   */
  const attentesDeLaCarte = decisionsSansGeste.filter((d) => d.cardId === card.id && !d.reglee);
  const iconeCarte = iconeDuLot(attentesDeLaCarte);
  const phraseCarte = attentesDeLaCarte.length === 1 ? attentesDeLaCarte[0].texte : undefined;

  /*
   * « ELLE ATTEND QUELQUE CHOSE DE VOUS : QU'ELLE BOUGE. » Ici, TOUTES les
   * décisions qui alertent comptent, le geste de parcours compris (valider la
   * compréhension, lancer) : c'est lui aussi une action attendue, même si son
   * icône n'est pas redite sur la carte. Règle partagée : `carteDoitSecouer`.
   */
  const alertesQuiSecouent = (alertesParCarte(state.decisions)[card.id] ?? 0) + (filles?.enQuestion ?? 0);
  React.useEffect(() => {
    // L'attente est réglée : la prochaine repartira de zéro.
    if (!alertesQuiSecouent) setAlertesVues(undefined);
  }, [alertesQuiSecouent]);
  const secoue = useSecousseRepetee(carteDoitSecouer({ alertes: alertesQuiSecouent, alertesVues }));

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
      agentActif: agentsDeLaCarte.some((a) => a.status === 'running' || a.status === 'starting') || fillesActives,
      decisionEnAttente: decisions > 0,
    },
    maintenant,
  );

  /*
   * LES MENTIONS DE LA CARTE SE LISENT DANS LA PASTILLE « i », plus en bandeaux
   * sous le titre : coupés en une ligne, rognés par la frise, ils ne disaient
   * rien d'entier. Trois tons pour la phrase du dernier tour (`natureDeLaMention`) :
   * une carte dont le CODE EST LÀ porte une information bleue (l'afficher en
   * triangle jaune démentait la coche verte d'à côté), une carte qui ATTEND
   * garde son jaune, un rapport rendu sans code reste gris. Suivent la reprise
   * possible, le tour sans suite et la date d'archivage, en gris pâle.
   */
  const mentions: Array<{
    cle: string;
    repere: Record<string, string | boolean>;
    classe: string;
    icone: React.ComponentType<{ className?: string }>;
    texte: string;
  }> = [];
  if (card.sansModification) {
    const nature = natureDeLaMention(card.sansModification);
    mentions.push({
      cle: 'carte',
      repere: { 'data-mention-carte': nature },
      classe: nature === 'travail' ? 'text-termine' : nature === 'information' ? 'text-faint' : 'text-warning',
      icone: nature === 'travail' ? Check : nature === 'information' ? Info : AlertTriangle,
      texte: card.sansModification,
    });
  }
  if (mentionDeReprise(card)) {
    mentions.push({ cle: 'reprise', repere: { 'data-mention-reprise': true }, classe: 'text-faint', icone: RotateCcw, texte: MENTION_REPRISE_COURTE });
  }
  if (sansSuite) {
    mentions.push({ cle: 'sans-suite', repere: { 'data-mention-sans-suite': true }, classe: 'text-faint', icone: Clock, texte: sansSuite });
  }
  const archivage = mentionArchivage(card);
  if (archivage) {
    mentions.push({ cle: 'archivage', repere: { 'data-mention-archivage': true }, classe: 'text-faint', icone: Archive, texte: archivage });
  }

  /*
   * « QU'EST-CE QUI TOURNE ENCORE ? » Depuis qu'un rapport rendu ferme la carte,
   * une carte RESTÉE dans « En cours » a forcément une raison — et elle doit se
   * lire sans ouvrir la carte : l'étape, depuis quand, ce qu'on attend. La règle
   * est partagée et testée (`travailRestant`) ; ici on ne fait que l'afficher.
   * Elle se tait quand la vieille mention « tour terminé sans suite » parle déjà
   * : deux phrases pour le même silence ne diraient rien de plus.
   */
  const restantBrut = travailRestant(
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
          /* ET LES ÉTAPES JAMAIS FAITES : un tour peut s'être terminé
             proprement en laissant des lignes de sa liste sur le carreau. La
             carte le dit sans qu'on l'ouvre (`travailRestant`). */
          tachesNonFaites: agent?.todos?.unfinished,
          filles: filles ?? undefined,
        },
        maintenant,
      );
  /*
   * « Tour terminé sans suite » se tait dès qu'il y a mieux à dire : une carte
   * dont des étapes n'ont jamais été faites annonce CELA, pas le temps écoulé.
   * Partout ailleurs, l'ancienne mention garde la priorité — deux phrases pour
   * le même silence ne diraient rien de plus.
   */
  const restant = sansSuite && restantBrut?.nature !== 'relance' ? null : restantBrut;

  const etat = etatVisuelCarte({
    agentStatut: agent?.status,
    attendReponse: attendQuestion,
    analyseEnCours: agentAuTravail || fillesAuTravail,
    enAttente: !!waiting,
    estimationEchouee: estimateFailed,
    enLigne: !!card.deployedAt,
  });
  /*
   * DEUX REPÈRES SÉPARÉS, QUI NE SE CONFONDENT PLUS. La PASTILLE bleue dit
   * « un agent a rendu quelque chose que vous n'avez pas consulté » et
   * s'éteint à la consultation ; l'ICÔNE D'ÉTAPE dit ce que la carte a vécu
   * (compréhension, plan, rapport) et ne dépend jamais de la lecture
   * (`shared/src/travail-rendu.ts`).
   */
  const nonConsultee = carteNonLue({
    colonne: card.column,
    renduA: instantDuRendu(card, agent),
    luA: card.lastReadAt,
  });
  const etape = etapeDeCarte({ colonne: card.column, doneAt: card.doneAt, parcours: card.parcours });

  return (
    <div
      className={cn('relative flex flex-col', !hauteurLibre && (enRoute ? CLASSE_HAUTEUR_CARTE_EN_ROUTE : CLASSE_HAUTEUR_CARTE), dimmed && 'opacity-40', secoue && 'animate-secousse')}
      data-carte-secoue={secoue ? card.id : undefined}
      data-carte-attend={carteDoitSecouer({ alertes: alertesQuiSecouent, alertesVues }) ? card.id : undefined}
    >
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

      {/*
       * LA PASTILLE « RENDU NON CONSULTÉ », posée sur le coin haut droit
       * (`PointNonLu`, la même pièce que sur les cartes Système). Elle
       * s'éteint en ouvrant la carte, ou d'un clic sur elle sans l'ouvrir.
       * Elle est SŒUR de l'article : ni le clic ni l'appui n'ouvrent la carte
       * ni ne lancent le glisser.
       */}
      {nonConsultee ? (
        <PointNonLu onLire={() => client.send({ type: 'card.read', cardId: card.id })} data-carte-non-lue={card.id} />
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
          'relative z-10 min-h-0 flex-1 cursor-pointer touch-manipulation select-none overflow-hidden rounded-md border border-border bg-raised px-2.5 py-2 transition-colors hover:border-faint',
          (statut || travailActuel || restant) && 'rounded-b-none',
          enRoute && 'flex flex-col',
        )}
      >
        {/*
         * Le badge « en ligne » est le premier repère à voir : il prend sa
         * propre ligne AU-DESSUS du titre, au lieu de se perdre au milieu des
         * repères techniques du pied.
         */}
        {enRoute ? (
          <div className="mb-1 flex h-[18px] min-w-0 items-center gap-1.5 text-[12px]" data-tete-carte-en-route>
            <div className="flex min-w-0 flex-1 items-center gap-1.5" data-tete-gauche>
              {enRoute.gauche}
            </div>
            {enRoute.droite ? (
              <div className="flex shrink-0 items-center gap-1" data-tete-droite>
                {enRoute.droite}
              </div>
            ) : null}
          </div>
        ) : card.deployedAt ? (
          <div className="mb-1 flex gap-1">
            {card.deployedAt ? (
              <Tooltip label={t('En ligne depuis le {v0}', { v0: new Date(card.deployedAt).toLocaleString(formatRegional()) })}>
                <Badge tone="success">
                  <Rocket className="h-2.5 w-2.5" /> {t('en ligne')}
                </Badge>
              </Tooltip>
            ) : null}
          </div>
        ) : null}

        {/* En forme « En route », le corps a une hauteur FIXE et se coupe : la
            frise tombe au même endroit sur toutes les cartes, et l'ancienneté
            reste toujours visible en bas. Au tableau, ce cadre
            n'existe pas (`contents`). */}
        <div ref={corpsRef} className={enRoute ? cn('shrink-0 overflow-hidden', CLASSE_HAUTEUR_CORPS_EN_ROUTE) : 'contents'}>
        <div className="flex items-start gap-1.5">
          {/* Le titre est le texte que l'on cherche à COPIER, et le seul de la
              carte qui ne soit pas tronqué : il revient donc à la ligne, y
              compris au milieu d'un mot interminable (une adresse, un chemin),
              plutôt que de sortir du cadre. L'icône du moteur ouvre son fil,
              à la taille d'une lettre : elle ne prend pas de ligne à elle
              seule, et ne bouge donc rien d'autre sur la carte. */}
          <h3
            ref={titreRef}
            data-carte-texte
            className="texte-copiable line-clamp-2 min-w-0 flex-1 break-words text-[14px] font-medium leading-snug text-text"
          >
            <Tooltip label={t(nomCourtMoteur(state.engines.find((e) => e.id === card.run.engine)))}>
              <span className="inline-block" data-icone-moteur={card.id}>
                <IconeMoteur engine={card.run.engine} className="relative -top-px mr-1 inline h-[13px] w-[13px] align-middle" />
              </span>
            </Tooltip>
            {titreEnCours ? (
              <span data-titre-en-construction className="animate-pulse font-normal italic text-muted">
                {t('Titre en cours de création…')}
              </span>
            ) : (
              card.title
            )}
          </h3>
          {texteCoupe || mentions.length ? (
            <BulleTexteCoupe>
              {texteCoupe ? (
                <>
                  {titreEnCours ? null : <span className="block font-medium text-text">{card.title}</span>}
                  {enRoute && extraitDescription ? <span className="mt-1 block">{extraitDescription}</span> : null}
                </>
              ) : null}
              {mentions.length ? (
                <span className={cn('block space-y-1.5', texteCoupe && 'mt-2')}>
                  {mentions.map(({ cle, repere, classe, icone: Icone, texte }) => (
                    <span key={cle} {...repere} className={cn('flex items-start gap-1.5 text-[12px] leading-snug', classe)}>
                      <Icone className="mt-[2px] h-3 w-3 shrink-0" />
                      <span className="min-w-0">{texte}</span>
                    </span>
                  ))}
                </span>
              ) : null}
            </BulleTexteCoupe>
          ) : null}
          {/* Le triangle passe AVANT le voyant : une décision attendue prime
              sur l'état d'avancement, elle est ce qui demande un geste. */}
          <RepereAttention
            /* La question ouverte se voit même avant que sa décision ne soit
               arrivée dans la liste : le drapeau de l'agent suffit. */
            compte={decisions || (attendQuestion ? 1 : 0)}
            icone={decisions ? iconeCarte : attendQuestion ? 'message' : iconeCarte}
            libelle={phraseCarte ?? (attendQuestion ? t('L’agent attend votre réponse à sa question') : undefined)}
            vif={attendQuestion}
            className="mt-[2px]"
            data-attention-carte={card.id}
          />
          {/* L'icône d'étape, permanente : la lecture ne l'éteint jamais. */}
          {etape ? <IconeEtape etape={etape} cardId={card.id} /> : null}
          {/* Le voyant est à DROITE, au bout de la ligne du titre. Le point gris
              du repos et la coche du travail rendu ont disparu : la pastille
              bleue et l'icône d'étape les remplacent. */}
          {etat === 'travaille' ? (
            <Loader2 className="mt-[3px] h-3 w-3 shrink-0 animate-spin text-en-cours" />
          ) : etat === 'echec' || etat === 'attente' || etat === 'enligne' ? (
            <Dot tone={etat === 'echec' ? 'failed' : etat === 'attente' ? 'waiting' : 'done'} />
          ) : null}
        </div>

        {/* Le début de la demande (premier message écrit, sinon la
            description), en texte simple, sur deux lignes au plus. Rien quand
            la carte n'a ni l'un ni l'autre. */}
        {enRoute && extraitDescription ? (
          <p
            ref={descriptionRef}
            data-description-carte={card.id}
            data-source-extrait={demande ? 'demande' : 'description'}
            className="mt-1 line-clamp-2 break-words text-[12.5px] leading-snug text-muted"
          >
            {extraitDescription}
          </p>
        ) : null}

        {/* Sur « Tableaux de bord », la carte ne montre aucune étiquette :
            elles se lisent dans le tableau du projet et dans le tiroir. */}
        {!enRoute && (card.labels.length || card.billing) ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {card.labels.slice(0, 3).map((label) => (
              <Badge key={label}>{label}</Badge>
            ))}
            {card.billing ? <Badge tone="success">{t('déjà facturée')}</Badge> : null}
          </div>
        ) : null}

        {/* Sur « Tableaux de bord », le lien de regroupement ne s'écrit pas :
            la pile (`PileDeCartes`) montre la mère et ses filles ensemble. */}
        {!enRoute ? <LienDeRegroupement card={card} /> : null}

        {/*
         * Le pied ne porte plus que l'ancienneté. Les repères techniques
         * (durée prévue, durée réalisée, heures facturables, branche) n'aident
         * pas à décider d'un coup d'œil : ils vivent dans le tiroir de la
         * carte, onglets Détails et GitHub.
         */}
        </div>
        {/* LA FRISE DES CINQ ÉTAPES, seulement sur « Tableaux de bord », juste
            sous le corps à hauteur fixe : elle tombe au même endroit sur
            toutes les cartes, bande de travail en pied ou non. Son écart
            au-dessus (`mt-3`, dans `FriseDeSuivi`) répond à l'air laissé
            dessous, jusqu'à l'ancienneté : elle ne colle plus à la demande. */}
        {enRoute ? (
          <FriseDeSuivi
            cardId={card.id}
            frise={friseDeSuivi(
              carteDeSuivi(card, {
                agentActif: agentAuTravail || fillesAuTravail,
                decisionEnAttente: alertesQuiSecouent > 0,
                deploys: state.deploys,
                /* La même colonne que le nom d'étape en tête de la carte
                   (`en-route.tsx`) : un agent de tâche au travail la dit
                   « Travail », quelle que soit sa colonne en base. */
                colonne: colonneAffichee({
                  column: card.column,
                  agentAuTravail: !!agentActif && agentCompteCommeTravail(agentActif.role),
                }),
              }),
            )}
          />
        ) : null}
        {/* LE PIED NE PORTE QUE L'ANCIENNETÉ. Sur « Tableaux de bord », rien
            d'autre ne s'y pose : ni étiquettes, ni pastilles des sous-cartes —
            la pile dépliée les montre déjà, une par une. Une bande de travail
            en pied raccourcit la tuile : l'ancienneté y perd ses retraits, et
            l'air qu'elle garde au-dessus de la bande vient de la hauteur de
            la carte (`CLASSE_HAUTEUR_CARTE_EN_ROUTE`). Sans bande, le retrait
            bas rend ces pixels : l'heure reste où elle était. */}
        <div
          className={cn(
            'text-[12px] text-faint',
            enRoute ? cn('mt-auto flex shrink-0 items-center', !(statut || travailActuel || restant) && 'pb-1.5 pt-1') : 'mt-1.5',
          )}
          data-anciennete-carte={enRoute ? card.id : undefined}
        >
          <span className="shrink-0">{relativeTime(card.updatedAt)}</span>
        </div>
      </article>

      {preparation ? (
        /*
         * LA PRÉPARATION DU LANCEMENT, PENDANT QU'ELLE SE FAIT.
         *
         * Elle passe AVANT tout le reste : tant que la copie de travail
         * s'ouvre, aucun agent ne parle encore, et la carte n'aurait que du
         * silence à montrer. Une vraie barre — l'avancement vient de l'étape
         * atteinte (`avancementDuLancement`), pas d'une animation qui tourne
         * dans le vide.
         */
        <Tooltip label={mentionDeLancement(preparation)}>
          <div
            onClick={ouvrir}
            data-lancement-en-cours={card.id}
            data-lancement-etape={preparation}
            className={cn(
              'relative -mt-1 shrink-0 cursor-pointer overflow-hidden rounded-b-md bg-bandeau-etape px-1.5 pb-1.5 pt-2 text-[12.5px] leading-none text-muted',
              'shadow-[inset_0_7px_6px_-6px_rgba(0,0,0,0.75)]',
            )}
          >
            <span className="flex items-center gap-1">
              <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin" />
              <span className="min-w-0 flex-1 truncate">{mentionDeLancement(preparation)}</span>
            </span>
            {/* La barre elle-même : un trait qui porte une information, donc
                `--faint` pour le fond, jamais `--border`. */}
            <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-faint/30">
              <span
                className="block h-full rounded-full bg-en-cours transition-[width] duration-500"
                style={{ width: `${Math.round(avancementDuLancement(preparation) * 100)}%` }}
                data-lancement-avancement={Math.round(avancementDuLancement(preparation) * 100)}
              />
            </span>
          </div>
        </Tooltip>
      ) : statut ? (
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
              'relative -mt-1 shrink-0 cursor-pointer overflow-hidden rounded-b-md bg-bandeau-etape px-1.5 pb-1.5 pt-2 text-[12.5px] leading-none',
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
        <BandeauTravail agent={travailActuel} onClick={ouvrir} data-barre-travail={card.id} data-barre-carte={card.id} />
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
            data-travail-restant-nature={restant.nature}
            className={cn(
              'relative -mt-1 shrink-0 cursor-pointer overflow-hidden rounded-b-md bg-bandeau-etape px-1.5 pb-1.5 pt-2 text-[12.5px] leading-none',
              'shadow-[inset_0_7px_6px_-6px_rgba(0,0,0,0.75)]',
              /* ORANGE POUR CE QUI ATTEND UN GESTE : une question posée, et
                 un tour resté en plan que rien ne relancera tout seul. */
              restant.nature === 'question' || restant.nature === 'relance'
                ? 'text-warning'
                : restant.nature === 'travaille'
                  ? 'text-en-cours'
                  : 'text-faint',
            )}
          >
            <span className="flex items-center gap-1">
              {/* « travaille » sans agent à soi : une MÈRE dont les filles
                  tournent — la même roue orange qu'un agent au travail. */}
              {restant.nature === 'travaille' ? (
                <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
              ) : restant.nature === 'question' ? (
                <MessageSquare className="h-3 w-3 shrink-0" />
              ) : restant.nature === 'relance' ? (
                <CircleAlert className="h-3 w-3 shrink-0" />
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

const DESSIN_DE_L_ETAPE: Record<EtapeDeCarte, typeof Route> = {
  comprehension: Lightbulb,
  plan: Route,
  rapport: FileCheck2,
};

/** L'icône de l'étape la plus avancée qu'a vécue la carte, avec sa phrase au survol. */
function IconeEtape({ etape, cardId }: { etape: EtapeDeCarte; cardId: string }) {
  const Dessin = DESSIN_DE_L_ETAPE[etape];
  const libelle = t(TEXTE_DE_L_ETAPE[etape]);
  return (
    <Tooltip label={libelle}>
      <span
        data-etape-carte={cardId}
        data-etape={etape}
        aria-label={libelle}
        className="mt-[2px] inline-flex shrink-0 items-center text-muted"
      >
        <Dessin className="h-3 w-3" />
      </span>
    </Tooltip>
  );
}

/**
 * LE LIEN ENTRE UNE CARTE MÈRE ET SES FILLES (`shared/src/regroupements.ts`).
 *
 * Sur le tableau commun, la mère dit dans quels projets son travail est parti,
 * et où en est chacun. Sur le tableau d'un projet, la fille dit de quelle
 * demande commune elle est la part. Une carte ordinaire n'affiche rien.
 */
function LienDeRegroupement({ card }: { card: Card }) {
  const state = useApp();
  if (card.cartesFilles?.length) {
    return (
      <div className="mt-1.5 flex flex-wrap gap-1" data-cartes-filles={card.cartesFilles.length}>
        {card.cartesFilles.map((fille) => {
          const projet = state.projects.find((p) => p.id === fille.projectId);
          /* LE RELEVÉ PORTÉ PAR LA MÈRE FAIT FOI : la fille vit dans un autre
             projet, souvent déchargé de l'écran (`suiviDesFilles`). */
          const suivi = card.suiviDesFilles?.find((s) => s.cardId === fille.cardId);
          const carte = state.cards[fille.cardId];
          return (
            <Badge
              key={fille.cardId}
              data-fille-badge={suivi?.etat ?? carte?.column ?? ''}
              /* ORANGE pour ce qui est EN COURS : la fille au travail se voit
                 d'un coup d'œil, une question en jaune d'attente. */
              className={cn(
                suivi?.etat === 'travail'
                  ? 'border-en-cours/30 bg-en-cours/10 text-en-cours'
                  : suivi?.etat === 'question' || suivi?.etat === 'panne'
                    ? 'border-warning/30 bg-warning/10 text-warning'
                    : undefined,
              )}
            >
              <span>
                {projet?.name ?? suivi?.projet ?? '?'}
                {suivi
                  ? ` · ${t(LIBELLES_DE_LA_FILLE[suivi.etat])}`
                  : carte
                    ? ` · ${t(COLUMN_LABELS[carte.column])}`
                    : ''}
              </span>
            </Badge>
          );
        })}
      </div>
    );
  }
  if (!card.carteMereId) return null;
  const mere = state.cards[card.carteMereId];
  const regroupement = state.projects.find(
    (p) => p.id === (mere?.projectId ?? state.projects.find((q) => q.id === card.projectId)?.regroupementId),
  );
  const phrase = t('Part d’une demande de « {v0} »', { v0: regroupement?.name ?? t('projet réuni') });
  return (
    <p className="mt-1.5 truncate text-[12px] text-faint" data-carte-mere={card.carteMereId}>
      {phrase}
    </p>
  );
}
