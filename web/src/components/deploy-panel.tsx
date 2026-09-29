import * as React from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  Check,
  ChevronDown,
  Clock,
  ChevronUp,
  Loader2,
  Rocket,
  X,
  AlertTriangle,
  FilePlus2,
  GitCommitHorizontal,
} from 'lucide-react';
import {
  Card,
  ColumnKey,
  DeployRun,
  DeployStepKey,
  EtapeDePublication,
  EtatProduction,
  PlanDeMiseEnLigne,
  TravailSansCarte,
  alerteTravailSansCarte,
  depotsAPublierSeuls,
  depotsEntraines,
  type DepotsDeCarte,
  annonceDeHeurts,
  annonceMiseAJourProduction,
  derniereMiseAJourProduction,
  ecartProduction,
  empreinteCourte,
  productionEnRetard,
  selectionSansHeurts,
  libelleCartePorteuse,
  descriptionDeLEtape,
  etapeDePublication,
  etapeDeLaColonne,
  libelleCompteLot,
  procedureEnPlace,
  raisonProductionDesactivee,
  etatDeLInitialisation,
  type EtatDeLInitialisation,
  raisonLotBloque,
  rapportAGarder,
  runDeLEtape,
  suiviDeLaPublication,
  titreDeLaPublication,
} from '@beluga/shared';
import { BoutonInitierProcedure } from '@/components/boutons-procedure';
import { ExplicationDeConfiguration, TiroirProcedureProduction } from '@/components/tiroir-procedure-production';
import { ouvrirRubriqueDeLEtape } from '@/lib/ouvrir-config-projet';
import { BarreProgression } from '@/components/barre-progression';
import { Chat } from '@/components/chat';
/* LE SUIVI VIT DANS SON PROPRE VOLET : le parcours des étapes, le détail de
   l'étape choisie et la conversation de celui qui publie ne sont plus dessinés
   ici. Ce fichier garde ce qui DÉCIDE (le bouton, la sélection, les alertes de
   la colonne) ; le volet, lui, est le MÊME pour les deux étapes de mise en
   ligne — seule sa table d'étapes change. */
import { DeployControls } from '@/components/tiroir-deploiement';
import { CorpsDuVolet, VoletDePublication } from '@/components/volet-publication';
import {
  BulleInfo,
  Button,
  ConfirmDialog,
  Dot,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Drawer,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Pastille,
  Tooltip,
  ZoneDefilement,
} from '@/components/ui';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { useMinute } from '@/lib/horloge';
import { cn, duration, elapsed } from '@/lib/utils';
import { t } from '@/lib/langue';

type Conflict = { cardId: string; title: string; branch: string; files: string[] };

/** Combien de temps la barre pleine d'une réussite reste à l'écran. */
const DUREE_REUSSITE_MS = 3000;
/* Le temps du fondu de sortie de l'anneau de colonne, aligné sur celui de la
   barre du bandeau (`transition-opacity duration-700`). */
const DUREE_FONDU_ANNEAU_MS = 700;

/** L'étape d'une publication, nommée comme dans la règle pure. */
function libelleEtape(cible: DeployRun['cible']): string {
  return t(etapeDePublication(cible).libelle);
}

/**
 * Le bouton qui devient un tableau de bord (PLAN §11). Le compteur dit la
 * VÉRITÉ : exactement les cartes que le run va embarquer.
 *
 * Le même bloc sert les DEUX étapes de mise en ligne : posé en tête de « À
 * déployer », il déploie ; dans le bandeau bas du tableau, il met à jour la
 * version en production. Il ne sait pas à quelle étape il sert — il sait
 * seulement quel lot ou quelle version le serveur lui rend.
 */
/**
 * Les textes INFORMATIFS de la publication, réunis pour le bouton « ! » de la
 * tête de colonne : comment l'instance sera rafraîchie et l'éventuelle
 * publication déjà en cours ailleurs. Rien d'alarmant — les alertes orange
 * (agent au travail, conflits) restent sous le bouton.
 *
 * LE TRAVAIL SANS CARTE N'EST PLUS ICI : rangé derrière ce bouton, il fallait
 * savoir qu'il existait pour aller le lire. Il s'affiche désormais en clair
 * DANS la colonne (`AlerteTravailSansCarte`), là où on cherche ce qui va
 * partir.
 */
export type InfosPublication = {
  /** Comment l'instance de dev sera rafraîchie (« Beluga Build se construit… »). */
  moyen?: string;
  /** Une autre publication de ce projet tourne déjà. */
  autrePublication?: boolean;
  /** Une mise en production sans prompt réglé : elle ne peut pas partir. */
  productionBloquee?: string;
  /** Pourquoi le bouton d'action est éteint (lot vide, agents occupés, lien
   *  coupé…) — la même phrase qu'avant, désormais lue depuis ce bouton plutôt
   *  qu'affichée en permanence sous la colonne. */
  raison?: string;
  /** La raison ci-dessus vient d'agents encore au travail : une roue plutôt
   *  qu'un triangle. */
  raisonEnCours?: boolean;
  /** Des conflits prévus sur le lot, que l'agent de publication résoudra en
   *  route — informatif, pas une alerte à traiter. */
  conflicts?: Conflict[];
};

export function DeployPanel({
  projectId,
  cards,
  colonne = 'to_deploy',
  ancreDeroule,
  onInfos,
  onSansCarte,
  onInitier,
  presentation = 'bloc',
  actions,
}: {
  projectId: string;
  cards: Card[];
  colonne?: ColumnKey;
  /**
   * `bloc` : ancienne présentation, pleine largeur sous le titre de colonne —
   * plus utilisée par le tableau, gardée pour ne rien casser ailleurs.
   * `compact` : le même bouton (mêmes attributs, mêmes handlers), réduit
   * pour tenir DANS le bandeau de titre de la rangée, à côté des autres
   * boutons d'action. `bandeau` : la mise en production, en bas du tableau et
   * sur toute sa largeur — l'état de la version à gauche, le bouton à droite,
   * une barre d'avancée au bas. Les contrôles, la confirmation et le tiroir
   * restent CEUX de ce composant : ni le bandeau ni le compact n'en recopient
   * aucun.
   */
  presentation?: 'bloc' | 'bandeau' | 'compact';
  /** Les petits boutons (« ! », réglages) : dans l'entête du tiroir de production. */
  actions?: React.ReactNode;
  /**
   * L'IDENTIFIANT DE L'ANCRE OÙ POSER LE DÉROULÉ. La TÊTE du bloc (le bouton
   * d'action, son chevron, l'état de la version en ligne) est rendue là où le
   * composant est monté — sous l'entête de colonne, HORS de la zone qui défile,
   * pour rester sous la main quelle que soit la position dans la liste. Le
   * DÉROULÉ (phrases d'explication, erreur du contrôle d'avant-clic), lui, part
   * dans cette ancre, posée par la colonne DANS la zone qui défile : sa hauteur
   * ne pousse alors jamais la colonne au-delà du tableau. Sans ancre, tout
   * reste ensemble — c'est l'affichage d'avant.
   */
  ancreDeroule?: string;
  /** Ouvre le tiroir de procédure, tenu par le tableau (l'icône de réglages de
   *  la tête de colonne ouvre exactement le même). */
  onInitier?: () => void;
  /** Remonte à la tête de colonne ce qui va derrière le bouton « ! ». */
  onInfos?: (infos: InfosPublication | null) => void;
  /** Remonte à la COLONNE le travail enregistré sans carte pour le porter, afin
   *  qu'elle l'affiche en clair au-dessus des cartes. Il ne compte JAMAIS dans
   *  le chiffre de la tête : celui-ci compte les cartes affichées, et rien
   *  d'autre (voir `shared/src/colonne-a-deployer.ts`). */
  onSansCarte?: (travail: TravailSansCarte | null) => void;
}) {
  const state = useApp();
  const run = state.deploys[projectId];
  const [busy, setBusy] = React.useState(false);
  /* La mise en production met le code chez le client, clôt les cartes et les
     archive : ce geste demande une confirmation. Le déploiement sur l'instance
     de dev, lui, part toujours d'un seul clic. */
  const [confirmation, setConfirmation] = React.useState(false);
  /* L'ÉCRAN DE SÉLECTION des tâches à déployer : ouvert par le clic sur « Tout
     déployer », uniquement à la première étape (« À déployer »). Les cartes
     sont toutes cochées d'avance ; décocher en laisse dans la colonne. */
  const [selectionOuverte, setSelectionOuverte] = React.useState(false);
  const [selection, setSelection] = React.useState<Set<string>>(new Set());
  const [avertissements, setAvertissements] = React.useState<{ cardId: string; message: string }[]>([]);
  /* Le déroulé des six étapes, replié par défaut : le chevron l'ouvre. */
  const [processOuvert, setProcessOuvert] = React.useState(false);
  /* LE TIROIR DE PRODUCTION : la barre ne porte plus que son libellé et sa
     flèche, tout le reste vit dedans. */
  const [tiroirOuvert, setTiroirOuvert] = React.useState(false);
  /* LE FIL D'UN AGENT DE PUBLICATION, empilé sur le volet quand une alerte y
     mène : c'est là que vivent ses issues (relancer, ignorer, arrêter). Il n'y
     a plus de fenêtre d'agent à part dans l'application. */
  const [filAgent, setFilAgent] = React.useState<string | null>(null);
  const productionDemandee = presentation === 'bandeau' ? state.productionDemandee : null;
  React.useEffect(() => {
    if (!productionDemandee || productionDemandee.projectId !== projectId) return;
    setTiroirOuvert(true);
    setFilAgent(productionDemandee.agentId ?? null);
    client.demanderProduction(null);
  }, [productionDemandee, projectId]);
  const tiroirFilAgent = (
    <Drawer open={!!filAgent} onClose={() => setFilAgent(null)} empile>
      {filAgent ? (
        <div className="flex min-h-0 flex-1 flex-col" data-fil-agent-production={filAgent}>
          <div className="shrink-0 px-4 pb-2">
            <DialogTitle className="truncate text-[15.5px] font-semibold text-text">
              {state.agents[filAgent]?.title ?? t('Mise en production')}
            </DialogTitle>
          </div>
          <Chat agent={state.agents[filAgent] ?? null} projectId={projectId} />
        </div>
      ) : null}
    </Drawer>
  );
  /* LE DÉROULÉ DEMANDÉ par la confirmation de la mise en production : le volet
     bascule dessus sans attendre que le démon diffuse la publication. */
  const [derouleDemande, setDerouleDemande] = React.useState(false);
  /*
   * LA DERNIÈRE PUBLICATION DE CETTE ÉTAPE — LA PORTE D'ENTRÉE PERMANENTE.
   *
   * C'est le point qui bloquait : l'alerte disparue, plus rien ne ramenait à
   * la mise en ligne. L'état du tableau ne porte que la DERNIÈRE publication
   * du projet, toutes étapes confondues ; le bloc d'une étape se retrouvait
   * donc devant un écran mort dès qu'une publication de l'AUTRE étape avait eu
   * lieu depuis. On relit donc l'historique — lecture EN BASE, qui ne coûte
   * rien et ne peut rien déclencher — à l'ouverture du volet, et on garde la
   * dernière publication de CETTE étape.
   */
  const [derniereDeLEtape, setDerniereDeLEtape] = React.useState<DeployRun | null>(null);
  /*
   * Les deux étapes existent pour tout projet : la règle est PURE, le bloc la
   * rejoue lui-même et s'affiche tout de suite, sans attendre le serveur.
   */
  const [etape] = React.useState<EtapeDePublication | null>(() => etapeDeLaColonne(colonne));

  /*
   * LE VOLET DU DÉPLOIEMENT DEMANDÉ D'AILLEURS (`client.demanderDeploiement`) :
   * la vignette « Dépannage du déploiement », le menu Agents ou la cloche
   * ouvrent CE volet, jamais le tiroir de production. L'agent demandé y est
   * empilé par le corps du volet (dépanneur, ou fil du conducteur).
   */
  const deploiementDemande =
    presentation !== 'bandeau' && etape?.cible === 'dev' ? state.deploiementDemande : null;
  const [agentDemande, setAgentDemande] = React.useState<{ id: string; nonce: number } | null>(null);
  /* `selection` (le bouton « Déployer » du pied d'une carte) : on ouvre la
     MÊME fenêtre de sélection que le bouton de ce bloc — un seul chemin vers
     `deploy.start`. Posée plus bas, une fois le lot connu. */
  const [selectionDemandee, setSelectionDemandee] = React.useState(0);
  React.useEffect(() => {
    if (!deploiementDemande || deploiementDemande.projectId !== projectId) return;
    if (deploiementDemande.selection) {
      setSelectionDemandee(deploiementDemande.nonce);
    } else {
      setProcessOuvert(true);
      setAgentDemande(deploiementDemande.agentId ? { id: deploiementDemande.agentId, nonce: deploiementDemande.nonce } : null);
    }
    client.demanderDeploiement(null);
  }, [deploiementDemande, projectId]);
  /* Volet refermé, la demande est honorée : le chevron le rouvre ensuite sur
     le seul parcours, sans réempiler l'agent. */
  const etaitOuvert = React.useRef(processOuvert);
  React.useEffect(() => {
    if (etaitOuvert.current && !processOuvert) setAgentDemande(null);
    etaitOuvert.current = processOuvert;
  }, [processOuvert]);

  /*
   * LA PROCÉDURE DE CETTE ÉTAPE EST-ELLE DÉFINIE ?
   *
   * Un projet neuf n'arrive plus avec une mise en ligne toute faite : tant que
   * la procédure est vide, il n'y a pas de bouton d'action à montrer — seulement
   * de quoi l'INITIER. La réponse se lit sur le projet déjà connu de l'écran :
   * aucun aller-retour, et elle se met à jour toute seule dès que l'agent du
   * tiroir a écrit la procédure (`project.upsert`).
   */
  const projet = state.projects.find((p) => p.id === projectId);
  const enPlace = !!etape && procedureEnPlace(projet, etape.cible);
  /* L'AGENT DE CONFIGURATION AU TRAVAIL se lit à droite du bandeau, et le clic
     ouvre alors sa CONVERSATION (`etatDeLInitialisation`). La minute fait
     tomber l'état « terminé » une fois sa garde passée. */
  const minute = useMinute();
  const idConfiguration = projet?.miseEnProduction?.agentId;
  const initialisation =
    presentation === 'bandeau'
      ? etatDeLInitialisation(projet, idConfiguration ? state.agents[idConfiguration] : undefined, Math.max(minute, Date.now()))
      : null;

  /*
   * Ce que le lot va embarquer. Même règle que `deployableCards` côté serveur,
   * sinon le compteur annoncerait autre chose que ce qui partira : une carte
   * qui porte déjà une date de mise en ligne ne repart pas.
   *
   * UNE ÉTAPE SANS LOT N'EMBARQUE RIEN. La mise en production vit en tête
   * d'« Archivé » : compter les cartes de cette colonne annoncerait un lot de
   * cent tâches là où il n'en part aucune — elle pousse une VERSION.
   */
  const embarked = etape?.sansLot
    ? []
    : cards.filter((card) => !card.excludedFromDeploy && !card.deployedAt);
  const active = run?.state === 'running';
  /* Deux blocs peuvent être à l'écran : chacun ne montre QUE sa publication. */
  const mienne = !!run && !!etape && runDeLEtape(run.cible, etape);

  /*
   * Ce qui coincera se sait AVANT de cliquer : on interroge le serveur, qui
   * fusionne en mémoire sans rien toucher. Relancé quand le lot change ou
   * qu'une publication se termine.
   */
  const [conflicts, setConflicts] = React.useState<Conflict[]>([]);
  const [busyAgents, setBusyAgents] = React.useState<{ id: string; title: string }[]>([]);
  /* Du travail enregistré sur la branche principale sans carte : il doit
     pouvoir partir en ligne, sinon il reste bloqué là indéfiniment. */
  const [enAttente, setEnAttente] = React.useState<{ nombre: number; titres: string[] }>({ nombre: 0, titres: [] });
  /* COMMENT l'instance de dev sera rafraîchie : on le dit avant le clic, pour
     que le déroulé ne soit pas une surprise. */
  const [miseEnLigne, setMiseEnLigne] = React.useState<PlanDeMiseEnLigne | null>(null);
  /* Une MISE EN PRODUCTION sans prompt réglé ne part pas : le serveur nous le
     dit, avec la phrase à afficher. Vide pour un déploiement, toujours. */
  const [productionBloquee, setProductionBloquee] = React.useState<string | null>(null);
  /* Le contrôle d'avant-clic peut lui-même tomber (serveur qui refuse, dépôt
     illisible) : son échec était avalé, et le bloc affichait alors un état
     d'avant, muet. On le garde pour le DIRE sous le bouton. */
  const [erreurControle, setErreurControle] = React.useState<string | null>(null);
  /* LES DÉPÔTS TOUCHÉS PAR CHAQUE CARTE DU LOT, rendus par le contrôle d'avant-clic
     pour un projet à plusieurs dépôts seulement : ils allument les boutons
     « publier seulement ce dépôt ». Absent sur un projet à dépôt simple. */
  const [depotsTouches, setDepotsTouches] = React.useState<DepotsDeCarte[] | null>(null);
  /* Le dépôt dont le bouton vient d'être cliqué : sa roue tourne dès le clic. */
  const [depotEnvoye, setDepotEnvoye] = React.useState<string | null>(null);
  /* Les dépôts qu'au moins une carte du lot modifie : eux seuls ont un bouton. */
  const depotsSeuls = React.useMemo(
    () => (projet && depotsTouches ? depotsAPublierSeuls(projet, depotsTouches) : []),
    [projet, depotsTouches],
  );
  /*
   * CE QUI TOURNE EN PRODUCTION : l'enregistrement en ligne chez le client et
   * l'écart avec la branche du dépôt. C'est ce qui a remplacé la colonne « En
   * production » — on ne compte plus des cartes, on lit une version. Demandé
   * seulement par le bloc de l'étape SANS LOT : le bloc de « À déployer » n'a
   * rien à en dire.
   */
  const [etatProduction, setEtatProduction] = React.useState<EtatProduction | null>(null);
  const signature = embarked.map((card) => card.id).join(',');

  /*
   * Le contrôle se REJOUE toutes les vingt secondes. Il ne partait qu'au
   * changement du lot : un agent qui se mettait au travail après coup laissait
   * le bouton allumé, et la publication n'était refusée qu'au clic — trop tard
   * pour comprendre pourquoi.
   */
  /*
   * L'ÉTAT DE LA PRODUCTION, relu au montage puis à chaque changement d'état de
   * la publication — c'est une mise en production qui le fait bouger. Lecture
   * SEULE côté serveur (une ligne de journal, deux commandes git qui n'écrivent
   * rien) : elle ne peut rien déclencher et ne coûte aucun jeton.
   */
  React.useEffect(() => {
    if (!etape?.sansLot || !enPlace) return;
    let vivant = true;
    client
      .call({ type: 'deploy.etatProduction', projectId })
      .then((res: any) => {
        if (vivant) setEtatProduction(res?.etat ?? null);
      })
      .catch(() => {
        /* Un état de production illisible ne casse pas le bloc : le bouton
           reste, et la ligne dira simplement qu'on ne sait pas. */
        if (vivant) setEtatProduction(null);
      });
    return () => {
      vivant = false;
    };
  }, [projectId, etape?.sansLot, enPlace, run?.state]);

  React.useEffect(() => {
    // Le contrôle tourne MÊME sans carte à embarquer : c'est lui qui découvre
    // le travail enregistré sur la principale, et donc qui rallume le bouton.
    // Sans procédure définie, en revanche, il n'y a rien à préparer : le bloc
    // ne montre que le bouton « Initier… », et on n'interroge pas le serveur.
    if (active || !enPlace) return;
    let vivant = true;
    const controler = () =>
      client
        .call({ type: 'deploy.check', projectId, source: colonne })
        .then((res: any) => {
          if (!vivant) return;
          setConflicts(res?.conflicts ?? []);
          setBusyAgents(res?.busy ?? []);
          setEnAttente(res?.enAttente ?? { nombre: 0, titres: [] });
          setMiseEnLigne(res?.miseEnLigne ?? null);
          setProductionBloquee(res?.productionBloquee ?? null);
          setDepotsTouches(res?.depotsTouches ?? null);
          setErreurControle(null);
        })
        .catch((err: any) => {
          if (!vivant) return;
          setErreurControle(err?.message ?? t('contrôle impossible'));
        });
    void controler();
    const timer = window.setInterval(controler, 20000);
    return () => {
      vivant = false;
      window.clearInterval(timer);
    };
  }, [projectId, signature, active, run?.state, colonne, enPlace]);

  /*
   * Le déroulé reste FERMÉ par défaut, même pendant MA publication : il ne
   * s'ouvre plus tout seul. C'est le chevron qui l'ouvre, et le texte d'état
   * (« En cours depuis… », adresse, étapes) vit désormais À L'INTÉRIEUR — la
   * colonne ne le déroule plus sous le bouton. Un indicateur qui tourne, posé
   * dans l'en-tête de la colonne (board.tsx), signale la publication en cours.
   */

  /*
   * PLUS DE FERMETURE AU CLIC EXTÉRIEUR : le déroulé n'est plus un panneau posé
   * sur les cartes mais un TIROIR, avec son propre voile et sa poignée. Guetter
   * les clics du document le refermerait à la première ligne cliquée DEDANS —
   * le tiroir vivant dans un portail, il n'est contenu par aucune tête.
   */

  const start = async (selectedCardIds?: string[], depot?: string) => {
    setBusy(true);
    try {
      // L'étape part AVEC la demande : le serveur ne doit pas retomber sur la
      // première quand c'est la mise en production qu'on a cliquée.
      await client.call({ type: 'deploy.start', projectId, cible: etape?.cible, selectedCardIds, depot });
      return true;
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'publication impossible');
      return false;
    } finally {
      setBusy(false);
      setDepotEnvoye(null);
    }
  };

  /*
   * Le clic sur le bouton d'action. Pour la MISE EN PRODUCTION, il n'envoie
   * plus rien tout de suite : il ouvre la modale de confirmation, et
   * `deploy.start` n'est appelé qu'après « Publier ». Pour le DÉPLOIEMENT
   * (« À déployer »), il ouvre d'abord l'écran de sélection des tâches —
   * toutes cochées d'avance — et `deploy.start` n'est appelé qu'après avoir
   * confirmé la sélection.
   */
  const demarrer = () => {
    if (etape?.cible === 'production') {
      setConfirmation(true);
      return;
    }
    /* Aucune carte à choisir — seul du travail enregistré sans carte attend :
       un écran de sélection vide ne demanderait rien. On part directement. */
    if (!embarked.length) {
      void start();
      return;
    }
    setSelection(new Set(embarked.map((card) => card.id)));
    setAvertissements([]);
    setSelectionOuverte(true);
  };

  /* La fenêtre de sélection demandée d'ailleurs : toutes les cartes du lot
     cochées d'avance, rien ne part avant « Déployer ». Un lot vide (carte
     écartée entre-temps) ouvre le déroulé plutôt que de partir sans
     confirmation, comme le ferait `demarrer`. */
  React.useEffect(() => {
    if (!selectionDemandee) return;
    setSelectionDemandee(0);
    if (!embarked.length) {
      setProcessOuvert(true);
      return;
    }
    setSelection(new Set(embarked.map((card) => card.id)));
    setAvertissements([]);
    setSelectionOuverte(true);
  }, [selectionDemandee]);

  const aPublier = embarked.length + enAttente.nombre;
  /*
   * Une publication réussie n'affiche plus son compte rendu : dès qu'elle
   * aboutit, le bloc repart vierge (bouton + chevron). Seuls le travail en
   * cours, un échec ou un arrêt gardent leur rapport (voir `rapportAGarder`).
   */
  const rapport = rapportAGarder(run?.state) && mienne ? run : null;

  /*
   * Ce qui va DERRIÈRE le bouton « ! » de la tête de colonne : les textes
   * informatifs qui, sous le bouton, poussaient les cartes vers le bas. On les
   * réunit ici et on les remonte à la tête de colonne. Pendant MA publication,
   * le déroulé des étapes dit déjà tout — rien à ranger derrière le bouton.
   */
  /*
   * POURQUOI le bouton ne part pas — lu depuis le bouton « ! » plutôt qu'écrit
   * en permanence sous la colonne. La règle est PURE et vit dans `shared` ;
   * ici on ne fait que lui passer ce qu'on sait. `publicationEnCours` vaut
   * `active && mienne` — le déroulé des étapes dit alors déjà tout.
   */
  const raisonBloquee =
    etape && !(active && mienne)
      ? raisonLotBloque({
          verbe: etape.verbe,
          sansLot: etape.sansLot,
          aPublier,
          cartesDansLaColonne: cards.length,
          autrePublication: active && !mienne,
          agentsOccupes: busyAgents.map((agent) => agent.title),
          productionBloquee: productionBloquee ?? undefined,
          horsLigne: !state.connected,
        })
      : null;

  const infosPublication = React.useMemo<InfosPublication | null>(() => {
    if (active && mienne) return null;
    const infos: InfosPublication = {};
    if (active && !mienne) infos.autrePublication = true;
    if (miseEnLigne && aPublier && etape?.cible === 'dev') infos.moyen = miseEnLigne.raison;
    // Une mise en production sans prompt réglé : on l'explique dès qu'un lot
    // attend et ne peut pas partir. Le déploiement ne connaît jamais ce cas.
    if (productionBloquee && aPublier) infos.productionBloquee = productionBloquee;
    // La raison du bouton éteint ne se répète pas : quand elle recouvre déjà
    // une mise en production bloquée ou une autre publication en cours, ces
    // deux champs dédiés suffisent — le texte serait identique deux fois.
    if (raisonBloquee && !infos.productionBloquee && !infos.autrePublication) {
      infos.raison = raisonBloquee;
      infos.raisonEnCours = busyAgents.length > 0;
    }
    if (conflicts.length) infos.conflicts = conflicts;
    return infos.moyen ||
      infos.autrePublication ||
      infos.productionBloquee ||
      infos.raison ||
      infos.conflicts
      ? infos
      : null;
  }, [active, mienne, miseEnLigne, aPublier, etape?.cible, enAttente, productionBloquee, raisonBloquee, busyAgents, conflicts]);

  /* On remonte l'objet SANS en faire une dépendance : on suit sa signature,
     sinon la fonction passée en prop, recréée à chaque rendu, bouclerait. */
  const onInfosRef = React.useRef(onInfos);
  onInfosRef.current = onInfos;
  const signatureInfos = JSON.stringify(infosPublication);
  React.useEffect(() => {
    onInfosRef.current?.(infosPublication);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signatureInfos]);

  /*
   * LE TRAVAIL SANS CARTE REMONTE À LA COLONNE, pour y être VU.
   *
   * Il gonflait le compteur de la tête sans pouvoir s'afficher nulle part : la
   * tête annonçait « À DÉPLOYER 1 » et la colonne, dessous, « Rien à mettre en
   * ligne pour l'instant ». Le compteur est rendu à la liste (board.tsx compte
   * ses cartes, un point c'est tout) et ce qui n'a pas de carte s'écrit en
   * clair DANS la colonne, avec ce qui a été trouvé.
   */
  /* L'ancre du déroulé est un nœud posé par la colonne : il n'existe qu'APRÈS
     le premier rendu, d'où la lecture en effet plutôt qu'au fil du rendu. */
  const [noeudDeroule, setNoeudDeroule] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => {
    setNoeudDeroule(ancreDeroule ? document.getElementById(ancreDeroule) : null);
  }, [ancreDeroule]);

  const onSansCarteRef = React.useRef(onSansCarte);
  onSansCarteRef.current = onSansCarte;
  const signatureSansCarte = `${enAttente.nombre}|${enAttente.titres.join('|')}`;
  React.useEffect(() => {
    onSansCarteRef.current?.(enAttente.nombre ? enAttente : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signatureSansCarte]);

  /*
   * Le bloc reste TOUJOURS en tête de la colonne « À déployer », même sans rien
   * à envoyer : le bouton « Tout déployer » y est visible partout, seulement
   * désactivé quand il n'y a rien à publier (il dit alors pourquoi). Le retirer
   * faisait qu'une colonne vide n'affichait ni bloc ni bouton — d'un projet à
   * l'autre, l'affichage n'était pas le même.
   *
   * Cette colonne ne publie rien : alors AUCUN bloc, pas même un bouton éteint.
   */
  /*
   * LE SUIVI : une seule lecture du déroulé (`suiviDeLaPublication`) pour la
   * barre du bandeau, son bouton ET le bouton de tête de colonne (« À
   * déployer ») — les deux chiffres ne peuvent pas se contredire. `mienne`
   * écarte le déroulé d'une AUTRE étape : le projet ne garde qu'un déroulé à la
   * fois, et celui d'un déploiement ne touche pas au bandeau de la production.
   */
  const suivi = mienne && run ? suiviDeLaPublication(run) : null;
  const enRoute = suivi?.etat === 'en-cours';
  const tombee = suivi?.etat === 'en-echec' || suivi?.etat === 'arretee';
  /* Le chronomètre du bouton avance seconde par seconde, PENDANT la
     publication seulement. */
  const [, battre] = React.useState(0);
  React.useEffect(() => {
    if (!enRoute) return;
    const timer = window.setInterval(() => battre((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [enRoute]);
  /* Une réussite remplit la barre jusqu'au bout, puis elle s'efface : seule une
     réussite RÉCENTE se montre, jamais celle retrouvée au rechargement. */
  const reussieRecente =
    suivi?.etat === 'reussie' && !!suivi.finiA && Date.now() - suivi.finiA < DUREE_REUSSITE_MS ? run?.id : null;
  const [reussiteVisible, setReussiteVisible] = React.useState(false);
  React.useEffect(() => {
    if (!reussieRecente) return;
    setReussiteVisible(true);
    const timer = window.setTimeout(() => setReussiteVisible(false), DUREE_REUSSITE_MS);
    return () => window.clearTimeout(timer);
  }, [reussieRecente]);
  /* La publication demandée est arrivée — ou le volet s'est refermé : le
     déroulé suit désormais l'état réel, plus la demande. */
  React.useEffect(() => {
    if (enRoute || tombee || reussieRecente || !tiroirOuvert) setDerouleDemande(false);
  }, [enRoute, tombee, reussieRecente, tiroirOuvert]);

  /* L'AVANCÉE DANS LE BOUTON DE LANCEMENT : une barre fine au ras de son bas
     et le pourcentage après son libellé, lus sur le même suivi que le bandeau
     du bas — les deux ne peuvent donc pas se contredire. (L'anneau autour du
     chevron a été retiré à la demande de l'utilisateur.)

     DEUX FINS, JAMAIS UNIFIÉES : une réussite remplit la barre puis l'efface en
     douceur ; un ÉCHEC fige barre et chiffre en rouge là où ils se sont
     arrêtés, sans aucun minuteur — ils ne partent qu'au déploiement suivant,
     qui repart de zéro. Au repos : ni barre ni chiffre. */
  const suiviVisible = !!suivi && (enRoute || tombee || reussiteVisible);
  /* Le chiffre est orangé pendant la mise en ligne ; seul l'échec s'en
     détache, en rouge. */
  const teintePourcentColonne = tombee ? 'text-danger' : 'text-en-cours';
  /* L'EFFACEMENT EN DOUCEUR : un démontage sec ne se fond pas. Barre et
     chiffre passent donc d'abord à l'opacité zéro, et ne se retirent qu'une
     fois le fondu joué. Il ne concerne QUE la réussite : un échec garde
     `tombee` vrai, donc le rouge, sans minuteur d'aucune sorte. */
  const [anneauMonte, setAnneauMonte] = React.useState(false);
  React.useEffect(() => {
    if (suiviVisible) {
      setAnneauMonte(true);
      return;
    }
    if (!anneauMonte) return;
    const timer = window.setTimeout(() => setAnneauMonte(false), DUREE_FONDU_ANNEAU_MS);
    return () => window.clearTimeout(timer);
  }, [suiviVisible, anneauMonte]);

  /*
   * ON NE RELIT L'HISTORIQUE QU'À L'OUVERTURE D'UN VOLET, et seulement quand
   * la publication du tableau n'est pas celle de cette étape : le cas courant
   * (la mienne tourne, ou vient de finir) ne demande rien au serveur.
   *
   * Remonté avant les retours anticipés qui suivent (`!etape`, `!enPlace`) :
   * un hook appelé après un retour conditionnel change de nombre d'un rendu à
   * l'autre selon le projet affiché, ce que React interdit (erreur #300).
   */
  /* Le bandeau du bas ne montre plus la dernière mise en production au repos :
     il n'a rien à relire. */
  const voletOuvert = presentation !== 'bandeau' && (tiroirOuvert || processOuvert);
  React.useEffect(() => {
    if (!voletOuvert || !etape || mienne) return;
    let vivant = true;
    void client
      .call<{ runs?: DeployRun[] }>({ type: 'deploy.historique', projectId })
      .then((res) => {
        if (!vivant || !Array.isArray(res?.runs)) return;
        setDerniereDeLEtape(res.runs.find((candidat) => runDeLEtape(candidat.cible, etape)) ?? null);
      })
      /* Une lecture d'historique qui échoue n'est pas un incident à afficher :
         le volet retombe sur son état de repos, comme avant. */
      .catch(() => undefined);
    return () => {
      vivant = false;
    };
  }, [voletOuvert, projectId, etape, mienne, run?.id]);

  if (!etape) return null;

  /*
   * AUCUNE PROCÉDURE : rien à déployer d'un clic, mais tout à définir.
   *
   * Le bloc garde sa place en tête de colonne, avec un SEUL bouton qui ouvre le
   * tiroir où un agent demande comment cette étape doit se passer. Ni compteur,
   * ni chevron, ni déroulé : il n'y a pas encore de déroulé à montrer.
   */
  if (!enPlace) {
    /* SANS PROCÉDURE, LA BARRE EST LA MÊME : libellé et flèche. Le tiroir
       s'ouvre sur la CONVERSATION, où l'agent de configuration démarre ;
       le tiroir dit ce qui manque, et son pied mène aux réglages. */
    if (presentation === 'bandeau') {
      return (
        <BandeauProduction
          projectId={projectId}
          colonne={colonne}
          suivi="repos"
          initialisation={initialisation}
          ouvert={tiroirOuvert}
          onOuvert={(v) => {
            /* L'AGENT DE CONFIGURATION AU TRAVAIL : la barre mène à sa
               conversation, dans la rubrique des réglages. */
            if (v && initialisation && initialisation !== 'fini') {
              ouvrirRubriqueDeLEtape(projectId, 'production');
              return;
            }
            setTiroirOuvert(v);
          }}
          actions={actions}
          corps={<ExplicationDeConfiguration />}
          pied={
            <BoutonInitierProcedure
              cible={etape.cible}
              onOuvrir={() => {
                setTiroirOuvert(false);
                ouvrirRubriqueDeLEtape(projectId, 'production');
              }}
            />
          }
        >
          {tiroirFilAgent}
        </BandeauProduction>
      );
    }
    /* L'état (et le « i » de son explication) est du DÉROULÉ : il part dans
       l'ancre de la colonne, et seul le bouton reste figé en tête. */
    const explications = (
      <>
        <p className="text-[12px] text-faint" data-procedure-absente={colonne}>
          {t('Ce projet n’a pas encore de processus de mise en production : rien ne peut partir tant qu’il n’est pas initialisé.')}{' '}
          <span className="inline-flex align-middle" data-portee-etape={colonne}>
            <BulleInfo cote="start">
              {t('Un agent étudie le projet, vous pose ses questions sur l’endroit qui accueille la production, puis écrit le processus que ce bouton suivra.')}
            </BulleInfo>
          </span>
        </p>
      </>
    );
    /* COMPACT : seul le bouton « Initier… » vit dans le bandeau de titre, à
       la taille des autres boutons d'action ; les deux phrases partent dans
       l'ancre du déroulé, comme pour le bloc plein largeur. */
    if (presentation === 'compact') {
      return (
        <>
          <BoutonInitierProcedure cible={etape.cible} onOuvrir={() => onInitier?.()} compact />
          {noeudDeroule ? createPortal(<div className="px-1.5 pt-1.5">{explications}</div>, noeudDeroule) : null}
        </>
      );
    }
    return (
      <div className="mb-2 border-b border-border px-2 pt-2 pb-2" data-bloc-publication={colonne}>
        <BoutonInitierProcedure cible={etape.cible} onOuvrir={() => onInitier?.()} />
        {noeudDeroule ? (
          createPortal(<div className="mb-2 px-2">{explications}</div>, noeudDeroule)
        ) : (
          <div className="mt-1.5">{explications}</div>
        )}
      </div>
    );
  }

  /* La publication que le FIL raconte : la mienne si elle existe, sinon la
     dernière de cette étape, relue dans l'historique. */
  const runDuFil = mienne ? run : derniereDeLEtape;

  /* Ma publication tourne : le bouton porte alors l'étape en cours au lieu du
     verbe, et le déroulé reflète les états réels. */
  const publicationEnCours = active && mienne;
  const etapeEnCours: DeployStepKey = run?.currentStep ?? 'merge';
  /* LE NOM DE L'ÉTAPE EN COURS, pris dans la table de CETTE étape de mise en
     ligne : « Mise en ligne » côté dev, « Transfert chez le client » côté
     production. Calculé une fois, lu par le bouton et par l'infobulle du
     chevron. */
  const libelleEtapeEnCours = t(descriptionDeLEtape(etapeEnCours, etape.cible).libelle);

  if (presentation === 'bandeau') {
    /* Pendant la publication — et après un échec — le volet MONTRE le
       déroulé, à la place de l'état de repos : aucun second volet à ouvrir.
       Relancer ou arrêter se fait depuis ce déroulé. Une réussite reste
       affichée le temps de se voir, puis le volet revient au repos. */
    const modeSuivi = !!suivi && (enRoute || tombee);
    /* LE DÉROULÉ NE PARAÎT QUE PENDANT UNE MISE EN PRODUCTION, son échec ou sa
       réussite toute fraîche : au repos, le tiroir montre la PROCÉDURE, plus la
       dernière publication (refonte du 24/09/2026). */
    const modeDeroule = modeSuivi || reussiteVisible || derouleDemande;
    /* Tant que la publication demandée n'est pas arrivée, l'ancienne n'a rien
       à raconter : les six étapes restent « à venir ». */
    const runDuDeroule = modeSuivi || reussiteVisible ? run : undefined;
    const ecart = ecartProduction(etatProduction);
    const derniere = derniereMiseAJourProduction(etatProduction);
    /* UN BOUTON ÉTEINT DIT POURQUOI, en clair au-dessus de lui : dans un tiroir,
       l'infobulle d'un bouton désactivé ne se lit pas. */
    /* L'INTERRUPTEUR DE L'ENTÊTE DU TIROIR, lu sur le projet et non sur le
       contrôle d'avant-clic : le bouton suit le geste à l'instant, sans
       attendre les vingt secondes du prochain contrôle. */
    const desactivee = raisonProductionDesactivee(projet);
    const eteint = !modeSuivi && (busy || active || busyAgents.length > 0 || !!productionBloquee || !!desactivee);
    const raisonEteint =
      eteint && !busy ? (desactivee ? t(desactivee) : undefined) || productionBloquee || raisonBloquee || undefined : undefined;
    /* UN DÉROULÉ GARDE LA PRIORITÉ : l'état de la reconfiguration ne se lit
       qu'au repos, jamais à la place de la barre d'une mise en production. */
    const reconfiguration = modeDeroule ? null : initialisation;
    return (
      <BandeauProduction
        projectId={projectId}
        colonne={colonne}
        suivi={suivi && (modeSuivi || reussiteVisible) ? suivi.etat : 'repos'}
        initialisation={reconfiguration}
        reconfiguration
        ouvert={tiroirOuvert}
        onOuvert={(v) => {
          /* L'agent de configuration au travail : la barre mène à sa
             conversation, dans la rubrique des réglages. */
          if (v && reconfiguration && reconfiguration !== 'fini') {
            ouvrirRubriqueDeLEtape(projectId, 'production');
            return;
          }
          setTiroirOuvert(v);
        }}
        enRoute={enRoute}
        tombee={tombee}
        pourcent={suivi && (modeSuivi || reussiteVisible) ? suivi.pourcent : null}
        enAttente={
          etatProduction?.commit && etatProduction.ecart !== undefined
            ? {
                nombre: etatProduction.ecart,
                enRetard: productionEnRetard(etatProduction),
                resume: t(ecart.texte, ecart.valeurs),
              }
            : null
        }
        actions={actions}
        titre={
          modeDeroule && runDuDeroule
            ? titreDeLaPublication(etape.titreCourt, runDuDeroule.startedAt)
            : t('Mise en production')
        }
        deroule={
          modeDeroule ? (
            /* LE VOLET DE LA MISE EN PRODUCTION : la MÊME présentation que
               celui du déploiement, avec ses PROPRES étapes (transfert chez le
               client, relance du service distant) — jamais le lot de cartes
               d'une colonne qu'elle n'embarque pas. */
            <CorpsDuVolet
              sansTitre
              cible="production"
              ouvrirSur="parcours"
              run={runDuDeroule}
              sousTitre={t('La version déjà déployée part chez le client — aucune carte n’est embarquée.')}
              controls={
                runDuDeroule && (publicationEnCours || rapport) ? <DeployControls run={runDuDeroule} actions /> : null
              }
            />
          ) : null
        }
        barre={
          /* LA BARRE D'AVANCÉE, au ras du bas de la barre, tiroir fermé : une
             publication se suit sans rien ouvrir. Figée en couleur d'erreur sur
             un échec, effacée en douceur après une réussite. */
          suivi ? (
            <BarreProgression
              className={cn(
                'absolute inset-x-0 bottom-0 transition-opacity duration-700',
                modeSuivi || reussiteVisible ? 'opacity-100' : 'opacity-0',
              )}
              pourcent={suivi.pourcent}
              erreur={tombee}
              teinte={suivi.etat === 'reussie' ? 'success' : 'en-cours'}
              data-barre-bandeau={projectId}
            />
          ) : null
        }
        corps={<ExplicationDeConfiguration processus={projet?.miseEnProduction?.processus} />}
        pied={
          <>
            {/* L'ÉTAT DE LA VERSION EN PRODUCTION, UNE LIGNE FIXE AU-DESSUS DU
                BOUTON : il ne défile plus avec l'explication. À gauche l'écart
                avec le dépôt (orange s'il y a du retard), à droite la version
                en ligne et le temps écoulé depuis sa mise en production. Les
                messages rares (raison d'un état illisible, contrôle tombé)
                se posent juste au-dessus. */}
            <div className="mb-2 flex flex-col gap-1 text-[12.5px] leading-snug" data-etat-production>
              {etatProduction?.raison && etatProduction.commit ? (
                <p className="text-faint" data-raison-production>{etatProduction.raison}</p>
              ) : null}
              {!publicationEnCours && erreurControle ? (
                <p className="text-danger" data-erreur-controle-publication>
                  {t('Le contrôle d’avant-clic a échoué : {erreurControle}', { erreurControle })}</p>
              ) : null}
              {derniere ? (
                <p
                  className="text-danger"
                  data-derniere-production={etatProduction?.derniere?.etat}
                  title={etatProduction?.derniere?.erreur}
                >
                  {t(derniere.texte)}
                </p>
              ) : null}
              <div className="flex min-w-0 items-center justify-between gap-3" data-ligne-etat-production>
                <span
                  className={cn('min-w-0 truncate', productionEnRetard(etatProduction) ? 'text-warning' : 'text-muted')}
                  data-ecart-production
                >
                  {t(ecart.texte, ecart.valeurs)}
                </span>
                <span className="flex shrink-0 items-center gap-1.5 text-muted">
                  <GitCommitHorizontal className="h-3.5 w-3.5 shrink-0" />
                  {etatProduction?.commit ? (
                    <>
                      <span className="font-mono text-text" data-commit-production>
                        {empreinteCourte(etatProduction.commit)}
                      </span>
                      {etatProduction.at ? (
                        <span className="text-faint" data-date-production title={new Date(etatProduction.at).toLocaleString()}>
                          · {elapsed(etatProduction.at)}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span data-commit-production="">{t('Aucune version en production')}</span>
                  )}
                </span>
              </div>
            </div>
            {raisonEteint ? (
              <p className="mb-1.5 text-[12px] leading-snug text-faint" data-raison-bouton-production>
                {raisonEteint}
              </p>
            ) : null}
            <Button
              variant="default"
              size="pied"
              className="gap-1.5"
              data-bouton-publication
              title={raisonEteint}
              disabled={eteint}
              onClick={demarrer}
            >
              {busy ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : <Rocket className="h-3 w-3 shrink-0" />}
              <span className="truncate">{etape.bouton ? t(etape.bouton) : t('Mise en production')}</span>
            </Button>
          </>
        }
      >
        {/* LA CONFIRMATION S'OUVRE PAR-DESSUS LE VOLET ; UNE FOIS DONNÉE, LE
            VOLET BASCULE SUR LE DÉROULÉ. */}
        <ConfirmDialog
          open={confirmation}
          title={t('Mise en production')}
          description={
            <>{t(annonceMiseAJourProduction(etatProduction).texte, annonceMiseAJourProduction(etatProduction).valeurs)}</>
          }
          confirmLabel={t('Mettre à jour')}
          danger
          onConfirm={() => {
            setDerouleDemande(true);
            void start().then((ok) => {
              if (!ok) setDerouleDemande(false);
            });
          }}
          onClose={() => setConfirmation(false)}
        />
        {tiroirFilAgent}
      </BandeauProduction>
    );
  }

  /*
   * COMPACT : le MÊME bouton (mêmes attributs, même logique de désactivation,
   * même clic) que la présentation `bloc`, réduit pour tenir dans le bandeau
   * de titre de la rangée, à côté des autres boutons d'action — fini le
   * bandeau pleine largeur qui poussait les cartes plus bas que les autres
   * rangées. Le chevron ouvre le MÊME tiroir. Les dépôts touchés (projet à
   * plusieurs dépôts) et l'échec du contrôle d'avant-clic, eux, partent dans
   * l'ancre du déroulé plutôt que d'ajouter une ligne sous le bandeau.
   */
  /* LE BLOC PREND TOUTE LA LARGEUR DE SON PIED : le bouton s'étire (`flex-1`)
     et pousse le chevron contre le bord droit. Le commentaire reste AU-DESSUS
     du `if` : `procedure-publication.test.ts` lit la forme exacte
     « if (presentation === 'compact') { return ( <div ». */
  if (presentation === 'compact') {
    return (
      <div
        className="flex w-full min-w-0 flex-1 items-center gap-1"
        data-bloc-publication={colonne}
      >
        <Button
          /* PLUS DE CONTOUR. Le variant `outline` dessinait un cadre dans une
             barre qu'on veut invisible ; `subtle` garde un fond lisible (donc
             un bouton qui se voit encore éteint, quand il n'y a rien à
             publier) sans le trait. `default` reste le bouton plein dès qu'un
             lot attend. */
          variant={!publicationEnCours && (aPublier || etape.sansLot) ? 'default' : 'subtle'}
          size="sm"
          /* Pendant une mise en ligne le bouton est éteint (on ne relance
             pas), mais il reste LISIBLE : il porte l'avancée.
             `min-w-0` + `overflow-hidden` gardent la troncature du libellé
             malgré `flex-1`. */
          className={cn(
            'relative min-w-0 flex-1 overflow-hidden border-0',
            (publicationEnCours || suiviVisible) && 'disabled:opacity-100',
          )}
          data-bouton-publication
          title={
            suivi && suiviVisible
              ? `${libelleEtapeEnCours} — ${suivi.pourcent} %`
              : !publicationEnCours && !busy
                ? raisonBloquee ?? undefined
                : undefined
          }
          disabled={
            publicationEnCours ||
            (!etape.sansLot && !aPublier) ||
            busy ||
            active ||
            busyAgents.length > 0 ||
            !!productionBloquee
          }
          onClick={publicationEnCours ? undefined : demarrer}
        >
          {publicationEnCours ? (
            <>
              <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
              <span className="truncate">{libelleEtapeEnCours}…</span>
            </>
          ) : (
            <>
              {busy ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : <Rocket className="h-3 w-3 shrink-0" />}
              <span className="truncate">
                {etape.bouton
                  ? t(etape.bouton)
                  : t('Tout {v0} ({v1})', {
                      v0: etape.verbe,
                      v1: libelleCompteLot(embarked.length, enAttente.nombre),
                    })}
              </span>
            </>
          )}
          {/* L'AVANCÉE VIT DANS LE BOUTON (demande explicite de l'utilisateur,
              qui remplace l'anneau autour du chevron) : le pourcentage après
              le libellé, et la barre fine au ras du bas du bouton. Tous deux
              lisent le MÊME suivi que la barre du bandeau de production.
              DEUX FINS : une réussite remplit la barre puis s'efface en fondu ;
              un ÉCHEC fige barre et chiffre en rouge, sans minuteur, jusqu'au
              déploiement suivant. */}
          {suivi && anneauMonte ? (
            <>
              <span
                className={cn(
                  'shrink-0 text-[12px] font-semibold tabular-nums transition-opacity duration-700 motion-reduce:transition-none',
                  suiviVisible ? 'opacity-100' : 'opacity-0',
                  teintePourcentColonne,
                )}
                data-pourcent-colonne={suivi.pourcent}
              >
                {suivi.pourcent} %
              </span>
              <BarreProgression
                className={cn(
                  'absolute inset-x-0 bottom-0 transition-opacity duration-700 motion-reduce:transition-none',
                  suiviVisible ? 'opacity-100' : 'opacity-0',
                )}
                pourcent={suivi.pourcent}
                erreur={tombee}
                teinte={suivi.etat === 'reussie' ? 'success' : 'en-cours'}
                data-barre-colonne={projectId}
              />
            </>
          ) : null}
        </Button>

        <Button
          variant="outline"
          size="icon-sm"
          className="shrink-0"
          data-chevron-process
          aria-expanded={processOuvert}
          aria-label="Voir le déroulé des six étapes de la mise en ligne"
          onClick={() => setProcessOuvert((v) => !v)}
        >
          <ChevronDown className={cn('h-3 w-3 transition-transform', processOuvert && 'rotate-180')} />
        </Button>

        {/* PUBLIER SEULEMENT UN DÉPÔT — même règle que le bloc plein largeur,
            mais posée dans le DÉROULÉ : un projet à plusieurs dépôts n'a pas à
            pousser le bandeau de titre en hauteur. Seuls les dépôts qu'une
            carte modifie ont leur bouton ; aucun ne reste « (0) » éteint. */}
        {noeudDeroule && depotsTouches && projet && depotsSeuls.length && !etape.sansLot && !publicationEnCours
          ? createPortal(
              <div className="flex flex-wrap gap-1 px-1.5 pt-1.5" data-boutons-depots>
                {depotsSeuls.map(({ nom, nombre }) => {
                  const entraines = depotsEntraines(projet, depotsTouches, nom);
                  const raison = busyAgents.length
                    ? raisonBloquee ?? undefined
                    : entraines.length
                      ? t('Part aussi, à cause des cartes qui touchent plusieurs dépôts : {depots}', { depots: entraines.join(', ') })
                      : undefined;
                  const envoye = depotEnvoye === nom;
                  return (
                    <Button
                      key={nom}
                      variant="outline"
                      size="sm"
                      className="min-w-0 gap-1"
                      data-bouton-depot={nom}
                      data-cartes-du-depot={nombre}
                      title={raison}
                      disabled={busy || active || busyAgents.length > 0}
                      onClick={() => {
                        setDepotEnvoye(nom);
                        void start(undefined, nom);
                      }}
                    >
                      {envoye ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : <Rocket className="h-3 w-3 shrink-0" />}
                      <span className="truncate">{t('Publier seulement « {nom} » ({nombre})', { nom, nombre })}</span>
                    </Button>
                  );
                })}
              </div>,
              noeudDeroule,
            )
          : null}

        <VoletDePublication
          open={processOuvert}
          onClose={() => setProcessOuvert(false)}
          cible={etape.cible}
          run={runDuFil ?? undefined}
          agentAOuvrir={agentDemande}
          controls={(publicationEnCours || rapport) && run && mienne ? <DeployControls run={run} /> : null}
        />

        {!publicationEnCours && erreurControle && noeudDeroule
          ? createPortal(
              <div className="px-1.5 pt-1.5">
                <p className="flex items-start gap-1.5 text-[12px] text-danger" data-erreur-controle-publication>
                  <X className="mt-[3px] h-2.5 w-2.5 shrink-0" />
                  <span>{t('Le contrôle d’avant-clic a échoué : {erreurControle}', { erreurControle })}</span>
                </p>
              </div>,
              noeudDeroule,
            )
          : null}

        <ConfirmDialog
          open={confirmation}
          title={t('Mise en production')}
          description={
            <>{t(annonceMiseAJourProduction(etatProduction).texte, annonceMiseAJourProduction(etatProduction).valeurs)}</>
          }
          confirmLabel={t('Mettre à jour')}
          danger
          onConfirm={() => void start()}
          onClose={() => setConfirmation(false)}
        />

        <SelectionDeploiementDialog
          open={selectionOuverte}
          projectId={projectId}
          cards={embarked}
          enAttente={enAttente}
          conflicts={conflicts}
          selection={selection}
          onChangeSelection={setSelection}
          avertissements={avertissements}
          onChangeAvertissements={setAvertissements}
          busy={busy}
          onClose={() => setSelectionOuverte(false)}
          onConfirm={() => {
            setSelectionOuverte(false);
            void start(Array.from(selection));
          }}
        />
      </div>
    );
  }

  return (
    /* Plus d'encadré : un simple trait EN BAS sépare le bloc de publication de
       la liste des cartes. Un cadre complet le faisait passer pour une carte. */
    <div className="mb-2 border-b border-border px-2 pt-2 pb-2" data-bloc-publication={colonne}>
      {/* La TÊTE : le bouton d'action à gauche, le chevron du déroulé à droite.
          Pendant une publication, le bouton dit l'étape traitée. */}
      <div className="relative flex items-stretch gap-1">
        <Button
          variant={publicationEnCours ? 'outline' : aPublier || etape.sansLot ? 'default' : 'outline'}
          size="sm"
          className="min-w-0 flex-1 overflow-hidden"
          data-bouton-publication
          disabled={
            publicationEnCours ||
            /* Une étape SANS LOT n'a rien à compter : son bouton reste allumé
               même à zéro carte — c'est une VERSION qu'elle pousse. */
            (!etape.sansLot && !aPublier) ||
            busy ||
            active ||
            busyAgents.length > 0 ||
            !!productionBloquee
          }
          onClick={publicationEnCours ? undefined : demarrer}
        >
          {publicationEnCours ? (
            <>
              <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
              <span className="truncate">{libelleEtapeEnCours}…</span>
            </>
          ) : (
            <>
              {busy ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : <Rocket className="h-3 w-3 shrink-0" />}
              {/* Le compteur embarque TOUT : une branche en conflit n'est plus
                  écartée d'avance, l'agent de publication la reprend en route.
                  Les deux parts (cartes, travail sans carte) sont NOMMÉES dès
                  qu'elles coexistent : un chiffre seul ne s'explique pas.
                  Une étape SANS LOT n'a pas de compteur du tout : elle porte
                  son libellé entier (« Mettre à jour la version prod »), parce
                  qu'elle ne pousse pas des cartes mais une VERSION. */}
              <span className="truncate">
                {etape.bouton
                  ? t(etape.bouton)
                  : t('Tout {v0} ({v1})', {
                      v0: etape.verbe,
                      v1: libelleCompteLot(embarked.length, enAttente.nombre),
                    })}</span>
            </>
          )}
        </Button>

        {/* Le chevron n'ouvre plus un panneau posé sur les cartes : il ouvre le
            TIROIR de la publication, où chaque étape porte son fil. */}
        <Button
          variant="outline"
          size="sm"
          className="w-7 shrink-0 px-0"
          data-chevron-process
          aria-expanded={processOuvert}
          aria-label="Voir le déroulé des six étapes de la mise en ligne"
          onClick={() => setProcessOuvert((v) => !v)}
        >
          <ChevronDown className={cn('h-3 w-3 transition-transform', processOuvert && 'rotate-180')} />
        </Button>
      </div>

      {/* PUBLIER SEULEMENT UN DÉPÔT — projet à plusieurs dépôts, « À déployer »
          seulement. Chaque bouton retient les cartes qui modifient son dépôt ;
          chacune part EN ENTIER, avec tous les dépôts qu'elle touche (le survol
          les nomme). Un dépôt qu'aucune carte ne modifie n'a PAS de bouton, et
          sans aucun, le bloc disparaît. « Tout déployer » ne change pas. */}
      {depotsTouches && projet && depotsSeuls.length && !etape.sansLot && !publicationEnCours ? (
        <div className="mt-1.5 flex flex-wrap gap-1" data-boutons-depots>
          {depotsSeuls.map(({ nom, nombre }) => {
            const entraines = depotsEntraines(projet, depotsTouches, nom);
            const raison = busyAgents.length
              ? raisonBloquee ?? undefined
              : entraines.length
                ? t('Part aussi, à cause des cartes qui touchent plusieurs dépôts : {depots}', { depots: entraines.join(', ') })
                : undefined;
            const envoye = depotEnvoye === nom;
            return (
              <Button
                key={nom}
                variant="outline"
                size="sm"
                className="min-w-0 gap-1"
                data-bouton-depot={nom}
                data-cartes-du-depot={nombre}
                title={raison}
                disabled={busy || active || busyAgents.length > 0}
                onClick={() => {
                  setDepotEnvoye(nom);
                  void start(undefined, nom);
                }}
              >
                {envoye ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : <Rocket className="h-3 w-3 shrink-0" />}
                <span className="truncate">{t('Publier seulement « {nom} » ({nombre})', { nom, nombre })}</span>
              </Button>
            );
          })}
        </div>
      ) : null}

      {/* LE TIROIR : les six étapes, leur fil historique, et sous elles le
          compte rendu de la publication (« En cours depuis… », adresse,
          « Arrêter »). Il ne montre le déroulé de MA publication que si elle est
          mienne — celle d'un autre projet n'a rien à raconter ici. */}
      {/* LA PORTE D'ENTRÉE DE LA COLONNE : le chevron ouvre la conversation de
          la publication de CETTE étape — celle qui tourne, ou la dernière en
          date, relue dans l'historique. On ne retombe plus sur un écran mort
          dès qu'une publication de l'autre étape a eu lieu depuis. Ouvrir,
          c'est LIRE et PARLER : seuls « Arrêter » et « Relancer » agissent, et
          ils ne paraissent que sur MA publication. */}
      <VoletDePublication
        open={processOuvert}
        onClose={() => setProcessOuvert(false)}
        cible={etape.cible}
        run={runDuFil ?? undefined}
        agentAOuvrir={agentDemande}
        controls={(publicationEnCours || rapport) && run && mienne ? <DeployControls run={run} /> : null}
      />

      {/* L'ÉTAT DE LA VERSION EN PRODUCTION, sous le bouton qui la met à jour.
          Deux lignes, jamais plus : l'enregistrement en ligne, puis l'écart
          avec le dépôt. L'état de la production est porté par cette version,
          pas par une colonne de cartes. */}
      {etape.sansLot ? (
        <div className="mt-1.5 space-y-0.5 text-[12px]" data-etat-production>
          <p className="flex items-center gap-1.5 text-faint">
            <GitCommitHorizontal className="h-3 w-3 shrink-0" />
            {etatProduction?.commit ? (
              <>
                <span className="font-mono" data-commit-production>{empreinteCourte(etatProduction.commit)}</span>
                {etatProduction.at ? <span>· {elapsed(etatProduction.at)}</span> : null}
              </>
            ) : (
              <span data-commit-production="">{t('Aucune version en production')}</span>
            )}
          </p>
          {derniereMiseAJourProduction(etatProduction) ? (
            <p
              className="text-danger"
              data-derniere-production={etatProduction?.derniere?.etat}
              title={etatProduction?.derniere?.erreur}
            >
              {t(derniereMiseAJourProduction(etatProduction)!.texte)}
            </p>
          ) : null}
          <p
            className={cn(productionEnRetard(etatProduction) ? 'text-warning' : 'text-faint')}
            data-ecart-production
          >
            {t(ecartProduction(etatProduction).texte, ecartProduction(etatProduction).valeurs)}</p>
          {/* Ce qui manque se DIT : dépôt illisible, branche introuvable,
              première mise en production jamais faite. Jamais un silence. */}
          {etatProduction?.raison && etatProduction.commit ? (
            <p className="text-faint" data-raison-production>{etatProduction.raison}</p>
          ) : null}
        </div>
      ) : null}

      {/* Plus aucun bandeau jaune en permanence sous le bouton : pourquoi il est
          éteint (lot vide, agents occupés, conflits prévus…) se lit désormais
          depuis le bouton « ! » de la tête de colonne (`infosPublication.raison`
          / `.conflicts`), à la demande. Seul un VRAI échec — le contrôle
          d'avant-clic lui-même tombé — reste affiché, en rouge : ce n'est pas
          une explication de routine. Il est du DÉROULÉ : sa hauteur ne doit pas
          repousser les cartes, il part donc dans l'ancre de la colonne. */}
      {!publicationEnCours && erreurControle ? (
        (() => {
          const alerte = (
            <p className="flex items-start gap-1.5 text-[12px] text-danger" data-erreur-controle-publication>
              <X className="mt-[3px] h-2.5 w-2.5 shrink-0" />
              <span>{t('Le contrôle d’avant-clic a échoué : {erreurControle}', { erreurControle })}</span>
            </p>
          );
          return noeudDeroule ? createPortal(<div className="mb-2 px-2">{alerte}</div>, noeudDeroule) : (
            <div className="mt-1.5">{alerte}</div>
          );
        })()
      ) : null}

      {/* La confirmation de la MISE EN PRODUCTION : elle nomme l'étape et dit ce
          qui va réellement partir — l'écart entre la version en ligne et le
          dépôt, jamais un lot de cartes, puisqu'elle n'en embarque aucune.
          « Mettre à jour » lance seul la publication ; « Annuler » ne touche à
          rien. */}
      <ConfirmDialog
        open={confirmation}
        title={t('Mise en production')}
        description={
          <>{t(annonceMiseAJourProduction(etatProduction).texte, annonceMiseAJourProduction(etatProduction).valeurs)}</>
        }
        confirmLabel={t('Mettre à jour')}
        danger
        onConfirm={() => void start()}
        onClose={() => setConfirmation(false)}
      />

      {/* L'ÉCRAN DE SÉLECTION des tâches à déployer, ouvert par « Tout
          déployer » : la liste du lot de « À déployer », cochée d'avance.
          Décocher une carte la laisse dans la colonne, pour le prochain coup. */}
      <SelectionDeploiementDialog
        open={selectionOuverte}
        projectId={projectId}
        cards={embarked}
        enAttente={enAttente}
        conflicts={conflicts}
        selection={selection}
        onChangeSelection={setSelection}
        avertissements={avertissements}
        onChangeAvertissements={setAvertissements}
        busy={busy}
        onClose={() => setSelectionOuverte(false)}
        onConfirm={() => {
          setSelectionOuverte(false);
          void start(Array.from(selection));
        }}
      />
    </div>
  );
}

/**
 * L'ÉCRAN DE SÉLECTION des tâches à déployer.
 *
 * Une case par carte, toutes cochées d'avance ; décocher en laisse dans « À
 * déployer ». Le serveur est interrogé à chaque case cochée ou décochée pour
 * dire ce qui coincerait avec CETTE sélection (fichiers communs avec une
 * carte laissée de côté) — un signal, pas un refus : on peut publier quand
 * même.
 *
 * ET IL DIT CE QUI VA SE HEURTER AVANT LE CLIC. La prévision existait déjà
 * (`deploy.check` rend `conflicts`, lus par `git merge-tree` en mémoire) mais
 * ne servait qu'à une ligne informative derrière le bouton « ! ». L'audit du
 * 18/08/2026 a chiffré ce que coûte un gros lot — 0,11 conflit en moyenne
 * pour une branche, 2,00 pour dix, et 370 s par fusion en conflit contre
 * 2,1 s sans : entrer dans ce cas sans le savoir est le vrai défaut. L'écran
 * l'annonce donc, et propose de PUBLIER EN DEUX FOIS — les tâches propres
 * maintenant, les conflictuelles au coup suivant, seules et sans le cumul du
 * lot.
 */
/**
 * LA BARRE DE MISE EN PRODUCTION ET SON TIROIR.
 *
 * La barre alignait sur une seule ligne l'état de la version, deux icônes et le
 * bouton : sur téléphone, tout était tronqué et rien ne se lisait. Elle ne porte
 * plus que « Mise en production » et une FLÈCHE (vers le haut tiroir fermé, vers
 * le bas tiroir ouvert) ; TOUTE la ligne s'ouvre au pouce. Le tiroir range, de
 * haut en bas : l'entête et ses icônes (« ! », réglages), l'état de la version,
 * puis le bouton en pied (`size="pied"`). La barre d'avancée reste collée sous
 * la barre, pour suivre une publication tiroir fermé.
 */
function BandeauProduction({
  projectId,
  colonne,
  suivi,
  initialisation = null,
  reconfiguration = false,
  ouvert,
  onOuvert,
  enRoute = false,
  tombee = false,
  pourcent = null,
  enAttente = null,
  actions,
  titre,
  deroule,
  barre,
  corps,
  pied,
  children,
}: {
  projectId: string;
  colonne: ColumnKey;
  suivi: string;
  /** L'état de l'agent de configuration, lu à droite de la barre au repos. */
  initialisation?: EtatDeLInitialisation | null;
  /** La procédure existe déjà : l'agent la RECONFIGURE plutôt que l'initialiser. */
  reconfiguration?: boolean;
  ouvert: boolean;
  onOuvert: (ouvert: boolean) => void;
  enRoute?: boolean;
  tombee?: boolean;
  /** Le chiffre du déroulé, posé à côté du libellé pendant un suivi. */
  pourcent?: number | null;
  /**
   * LES VERSIONS EN ATTENTE, dites par une pastille à la place du libellé :
   * `nombre` est l'écart de la production avec la version prête à partir (le
   * même que la ligne d'état du tiroir), `enRetard` orange la pastille, `resume`
   * est la phrase de cet écart, déjà traduite, pour le survol. Absent tant que
   * le chiffre n'est pas fiable (état non chargé, écart inconnu, jamais mise
   * en production) : le libellé texte reste alors.
   */
  enAttente?: { nombre: number; enRetard: boolean; resume: string } | null;
  actions?: React.ReactNode;
  /** Le titre de l'entête du volet — daté pendant un déroulé. */
  titre?: string;
  /** Le déroulé à montrer À LA PLACE de l'état de repos et du pied. */
  deroule?: React.ReactNode;
  barre?: React.ReactNode;
  corps: React.ReactNode;
  pied: React.ReactNode;
  children?: React.ReactNode;
}) {
  /* La teinte du chiffre, la même que le « % » en tête du déroulé. */
  const teintePourcent =
    suivi === 'reussie' ? 'text-success' : suivi === 'en-echec' || suivi === 'arretee' ? 'text-danger' : 'text-en-cours';
  return (
    <div
      className="relative mx-3 shrink-0 overflow-hidden rounded-2xl border border-border"
      style={{ backgroundColor: 'hsl(var(--fond-zone))' }}
      data-bloc-publication={colonne}
      data-bandeau-production={projectId}
      data-suivi={suivi}
      data-initialisation-production={initialisation ?? undefined}
    >
      <button
        type="button"
        onClick={() => onOuvert(!ouvert)}
        aria-expanded={ouvert}
        aria-haspopup="dialog"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-raised/50"
        data-ouvrir-tiroir-production={ouvert ? 'ouvert' : 'ferme'}
      >
        {enRoute ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-en-cours" />
        ) : tombee ? (
          <X className="h-3.5 w-3.5 shrink-0 text-danger" />
        ) : (
          <Rocket className="h-3.5 w-3.5 shrink-0 text-faint" />
        )}
        {enAttente ? (
          <>
            {/* Le nom du bandeau reste lu par les lecteurs d'écran : la pastille
                le remplace à l'œil, pas à l'oreille. */}
            <span className="sr-only">{t('Mise en production')}</span>
            {enAttente.nombre > 0 ? (
              <Pastille
                nombre={enAttente.nombre}
                ton="repondre"
                className="h-5 min-w-5 px-1.5 text-[11px]"
                title={enAttente.resume}
                data-mises-a-jour-en-attente={enAttente.nombre}
                data-en-retard=""
              />
            ) : (
              <span
                className={cn(
                  'inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1 text-[11px] font-semibold leading-none',
                  enAttente.enRetard ? 'bg-warning text-sur-etat' : 'bg-raised text-muted',
                )}
                title={enAttente.resume}
                data-mises-a-jour-en-attente={0}
                data-en-retard={enAttente.enRetard ? '' : undefined}
              >
                {enAttente.enRetard ? '!' : <Check className="h-3 w-3" />}
              </span>
            )}
          </>
        ) : (
          <span className="min-w-0 truncate text-[13px] font-medium text-text">{t('Mise en production')}</span>
        )}
        {pourcent !== null ? (
          <span
            className={cn('shrink-0 text-[13px] font-semibold tabular-nums', teintePourcent)}
            data-pourcent-bandeau={pourcent}
          >
            {pourcent} %
          </span>
        ) : null}
        <span className="flex-1" />
        {initialisation ? (
          <EtatDInitialisation etat={initialisation} reconfiguration={reconfiguration} />
        ) : null}
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted"
          data-fleche-production={ouvert ? 'bas' : 'haut'}
          aria-hidden
        >
          {ouvert ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </span>
      </button>
      {barre}

      {/* LE TIROIR DE LA PROCÉDURE : l'explication et le bouton de mise en
          production (la conversation de l'agent vit dans les réglages).
          PENDANT UN DÉROULÉ, il le montre sur la hauteur pleine ; au repos,
          l'explication défile au-dessus du bouton, posé en pied. */}
      <TiroirProcedureProduction
        projectId={projectId}
        open={ouvert}
        onClose={() => onOuvert(false)}
        titre={titre}
        actions={actions}
        deroule={!!deroule}
        configuration={
          deroule ? (
            <div className="flex min-h-0 flex-1 flex-col" data-tiroir-production={projectId} data-deroule-production>
              {deroule}
            </div>
          ) : (
            <>
              <ZoneDefilement fond="hsl(var(--surface))" className="min-h-0 px-4 pb-2">
                <div data-tiroir-production={projectId}>{corps}</div>
              </ZoneDefilement>
              <div className="shrink-0 px-4 pb-3 pt-2" data-pied-tiroir-production>
                {pied}
              </div>
            </>
          )
        }
      />

      {children}
    </div>
  );
}

/**
 * LA ZONE DROITE DU BANDEAU PENDANT L'INITIALISATION : « Initialisation ·
 * Au travail » (ou « Configuration · … » quand la procédure existe déjà), avec
 * le point orange qui pulse, « attend votre réponse » en orange d'avertissement,
 * puis « terminé » une minute. Le clic sur la barre ouvre la conversation.
 */
function EtatDInitialisation({ etat, reconfiguration }: { etat: EtatDeLInitialisation; reconfiguration: boolean }) {
  return (
    <span className="flex min-w-0 shrink items-center gap-1.5 text-[12px]" data-etat-initialisation={etat}>
      {etat === 'demarre' || etat === 'travail' ? <Dot tone="running" pulse /> : null}
      <span className="truncate text-muted">{reconfiguration ? t('Configuration') : t('Initialisation')}</span>
      <span className="shrink-0 text-faint">·</span>
      {etat === 'question' ? (
        <span className="shrink-0 text-warning">{t('attend votre réponse')}</span>
      ) : etat === 'fini' ? (
        <span className="shrink-0 text-faint">{t('terminé')}</span>
      ) : etat === 'demarre' ? (
        <span className="shrink-0 text-faint">{t('démarre…')}</span>
      ) : (
        <span className="shrink-0 text-en-cours">{t('Au travail')}</span>
      )}
    </span>
  );
}

function SelectionDeploiementDialog({
  open,
  projectId,
  cards,
  enAttente,
  conflicts,
  selection,
  onChangeSelection,
  avertissements,
  onChangeAvertissements,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  projectId: string;
  cards: Card[];
  enAttente: { nombre: number; titres: string[] };
  /** Ce qui se heurte déjà à la branche d'accueil, prévu avant le clic. */
  conflicts: Conflict[];
  selection: Set<string>;
  onChangeSelection: (selection: Set<string>) => void;
  avertissements: { cardId: string; message: string }[];
  onChangeAvertissements: (avertissements: { cardId: string; message: string }[]) => void;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  React.useEffect(() => {
    if (!open) return;
    let vivant = true;
    client
      .call({ type: 'deploy.selection', projectId, source: 'to_deploy', selectedCardIds: Array.from(selection) })
      .then((res: any) => {
        if (!vivant) return;
        onChangeAvertissements(res?.avertissements ?? []);
      })
      .catch(() => undefined);
    return () => {
      vivant = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId, Array.from(selection).sort().join(',')]);

  const basculer = (cardId: string) => {
    const suite = new Set(selection);
    if (suite.has(cardId)) suite.delete(cardId);
    else suite.add(cardId);
    onChangeSelection(suite);
  };

  /*
   * L'ANNONCE DES HEURTS ne porte que sur les cartes AFFICHÉES : une prévision
   * gardée d'un lot précédent annoncerait des tâches qui ne sont plus là. La
   * phrase et le second lot sont des règles PURES (`shared/src/fusion-du-lot.ts`).
   */
  const idsAffiches = new Set(cards.map((card) => card.id));
  const heurtent = conflicts.map((c) => c.cardId).filter((id) => idsAffiches.has(id));
  const annonce = annonceDeHeurts(heurtent.length, cards.length);
  const propres = selectionSansHeurts(cards, heurtent);
  /* « Publier en deux fois » n'a de sens que s'il reste quelque chose au
     premier lot, et si la sélection n'est pas DÉJÀ ce premier lot. */
  const deuxFoisPossible =
    !!annonce &&
    propres.size > 0 &&
    !(selection.size === propres.size && [...propres].every((id) => selection.has(id)));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent data-selection-deploiement>
        <DialogHeader>
          <div className="flex items-center gap-1">
            <DialogTitle>{t('Tâches à déployer')}</DialogTitle>
            <BulleInfo cote="start">
              {t('Décochez les tâches à laisser de côté : elles resteront dans « À déployer » pour la prochaine fois.')}
            </BulleInfo>
          </div>
        </DialogHeader>

        {annonce ? (
          <div
            className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-[12px] text-warning"
            data-annonce-heurts
          >
            <p className="flex items-start gap-1.5">
              <AlertTriangle className="mt-[3px] h-2.5 w-2.5 shrink-0" />
              <span>{annonce}</span>
            </p>
            {deuxFoisPossible ? (
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => onChangeSelection(propres)}
                data-publier-en-deux-fois
              >
                {t('Publier en deux fois ({v0} sans heurt maintenant)', { v0: propres.size })}</Button>
            ) : null}
          </div>
        ) : null}

        <ul className="mt-3 space-y-1.5">
          {cards.map((card) => {
            const alertes = avertissements.filter((a) => a.cardId === card.id);
            /* La tâche qui se heurte est NOMMÉE dans la liste : l'annonce
               d'en-tête dit combien, la ligne dit lesquelles. */
            const heurte = heurtent.includes(card.id);
            return (
              <li key={card.id} data-carte-selection={card.id}>
                <label className="flex items-start gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-[13px] text-muted">
                  <input
                    type="checkbox"
                    checked={selection.has(card.id)}
                    onChange={() => basculer(card.id)}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0"
                    data-case-selection={card.id}
                  />
                  <span className="flex-1 truncate text-text">{card.title}</span>
                  {heurte ? (
                    <span className="shrink-0 text-[11px] text-warning" data-carte-heurte={card.id}>
                      {t('se heurte')}</span>
                  ) : null}
                </label>
                {alertes.length ? (
                  <ul className="mt-1 space-y-1 pl-2">
                    {alertes.map((alerte, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-[12px] text-warning" data-avertissement-selection>
                        <AlertTriangle className="mt-[3px] h-2.5 w-2.5 shrink-0" />
                        <span>{alerte.message}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>

        {enAttente.nombre ? (
          <p className="mt-2 text-[12px] text-faint">
            {t('+ {v0} changement{v1} enregistré {v2} sans carte, toujours embarqué{v3}.', { v0: enAttente.nombre, v1: enAttente.nombre > 1 ? 's' : '', v2: enAttente.nombre > 1 ? 's' : '', v3: enAttente.nombre > 1 ? 's' : '' })}</p>
        ) : null}

        <DialogFooter className="flex-nowrap gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            {t('Annuler')}</Button>
          {/* Tout décocher n'est pas forcément une impasse : le travail
              enregistré sans carte part quand même. Le bouton ne s'éteint donc
              que si RIEN ne partirait — et il le dit alors juste au-dessus. */}
          {selection.size === 0 && !enAttente.nombre ? (
            <p className="flex-1 self-center text-[12px] text-warning" data-raison-selection-vide>
              {t('Aucune tâche cochée : il n’y aurait rien à déployer.')}</p>
          ) : null}
          <Button
            size="sm"
            disabled={selection.size + enAttente.nombre === 0 || busy}
            onClick={onConfirm}
            data-bouton-deployer-selection
          >
            {busy ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : null}
            
{t('Déployer (')}{libelleCompteLot(selection.size, enAttente.nombre)})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * L'AVERTISSEMENT « du travail attend sans carte », posé DANS la colonne, juste
 * au-dessus des cartes.
 *
 * C'est le second volet de la règle : le compteur ne compte plus que ce que la
 * liste montre, donc ce qui n'a pas de carte doit se voir quelque part — sinon
 * on l'a simplement rendu invisible au lieu de le rendre honnête. Il NOMME ce
 * qui a été trouvé (les titres réels des enregistrements) et où c'est (la
 * branche principale), et il ne propose rien : mettre en ligne reste un geste
 * de l'utilisateur.
 *
 * Le texte entier vient de la règle pure (`alerteTravailSansCarte`) : cet
 * écran ne fait que le dessiner.
 */
export function AlerteTravailSansCarte({
  colonne,
  projectId,
  travail,
  verbe,
  onFiche,
}: {
  colonne: ColumnKey;
  projectId: string;
  travail: TravailSansCarte | null;
  verbe: string;
  /** La carte a été créée : la colonne oublie son avertissement, le contrôle
   *  suivant confirmera qu'il n'y a plus rien d'anonyme. */
  onFiche?: () => void;
}) {
  const alerte = alerteTravailSansCarte(travail, verbe);
  if (!alerte) return null;
  /*
   * DONNER UNE FICHE À CE TRAVAIL, d'un clic. Le bouton part en requête et le
   * dit tout seul (roue, puis coche) — c'est le socle `Button` qui s'en charge,
   * à condition qu'on lui RENDE la promesse et qu'on RELANCE l'erreur, sinon il
   * croirait avoir réussi. Rien n'est publié : la carte est simplement posée
   * dans la colonne, où elle devient visible et comptée comme les autres.
   */
  const ficher = () =>
    client
      .call({ type: 'deploy.ficherSansCarte', projectId })
      .then(() => {
        onFiche?.();
      })
      .catch((err: any) => {
        client.pushToast('error', err?.message ?? t('Carte impossible à créer'));
        throw err;
      });
  return (
    <div
      data-travail-sans-carte={colonne}
      data-sans-carte-nombre={travail?.nombre ?? 0}
      className="rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-[12px] leading-snug"
    >
      <p className="flex items-start gap-1.5 font-medium text-warning">
        <AlertTriangle className="mt-[3px] h-3 w-3 shrink-0" />
        <span>{alerte.titre}</span>
      </p>
      <p className="mt-1 text-muted">{alerte.phrase}</p>
      {alerte.titres.length ? (
        <ul className="mt-1 space-y-0.5 text-faint">
          {alerte.titres.map((titre, i) => (
            <li key={`${i}-${titre}`} className="truncate" title={titre}>
              • {titre}
            </li>
          ))}
          {alerte.tronquee ? <li className="text-faint">• …</li> : null}
        </ul>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        className="mt-1.5 h-7 w-full text-[12px]"
        data-ficher-sans-carte={colonne}
        onClick={ficher}
      >
        <FilePlus2 className="h-3 w-3" /> {libelleCartePorteuse(travail?.nombre ?? 0)}
      </Button>
    </div>
  );
}

/**
 * Le bouton « ! » de la tête de colonne : il range les textes INFORMATIFS de la
 * publication (rafraîchissement de l'instance, autre publication en cours) qui
 * poussaient les cartes vers le bas. Un clic les ouvre
 * dans un menu par-dessus le contenu ; il ne paraît que s'il y a quelque chose à
 * lire, et dit au survol ce qu'il fait. Les alertes orange, elles, restent sous
 * le bouton de publication.
 */
export function BoutonInfosPublication({
  colonne,
  infos,
}: {
  colonne: ColumnKey;
  infos: InfosPublication | null;
}) {
  if (!infos) return null;
  return (
    <DropdownMenu>
      <Tooltip label={t('À propos de la mise en ligne')}>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 shrink-0 px-1.5 text-faint"
            aria-label="À propos de la mise en ligne"
            data-infos-publication={colonne}
          >
            <AlertCircle className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" className="sm:max-w-[280px]">
        <div className="space-y-2 px-1 py-0.5 text-[12px] leading-snug">
          {infos.productionBloquee ? (
            <p className="flex items-start gap-1.5 text-warning" data-production-bloquee>
              <AlertCircle className="mt-[3px] h-2.5 w-2.5 shrink-0" />
              <span>{infos.productionBloquee}</span>
            </p>
          ) : null}

          {infos.autrePublication ? (
            <p className="flex items-start gap-1.5 text-muted" data-publication-ailleurs>
              <Loader2 className="mt-[3px] h-2.5 w-2.5 shrink-0 animate-spin" />
              <span>{t('Une autre publication de ce projet est en cours : attendez qu’elle finisse.')}</span>
            </p>
          ) : null}

          {/* Pourquoi le bouton d'action est éteint (lot vide, agents
              occupés, lien coupé…) — la même phrase qu'avant, lue ici plutôt
              qu'affichée en permanence sous le bouton. */}
          {infos.raison ? (
            <p className="flex items-start gap-1.5 text-warning" data-raison-publication>
              {infos.raisonEnCours ? (
                <Loader2 className="mt-[3px] h-2.5 w-2.5 shrink-0 animate-spin" />
              ) : (
                <AlertTriangle className="mt-[3px] h-2.5 w-2.5 shrink-0" />
              )}
              <span>{infos.raison}</span>
            </p>
          ) : null}

          {infos.moyen ? (
            <p className="text-faint" data-moyen-mise-en-ligne>
              {infos.moyen}
            </p>
          ) : null}

          {infos.conflicts?.length ? (
            <ul className="space-y-1.5">
              {infos.conflicts.map((conflict) => (
                <li key={conflict.cardId} className="flex items-start gap-1.5 text-warning" data-conflit-publication>
                  <AlertTriangle className="mt-[3px] h-2.5 w-2.5 shrink-0" />
                  <span>
                    {t('Conflit prévu sur « {v0} » {v1} — l\'agent de publication le résoudra en route. Sans succès, la carte restera ici pour le prochain coup.', { v0: conflict.title, v1: conflict.files.length ? ` (${conflict.files.slice(0, 3).join(', ')})` : '' })}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
