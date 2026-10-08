import * as React from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Cpu,
  ChevronRight,
  Lock,
  MessageSquare,
  RotateCcw,
  RotateCw,
  SlidersHorizontal,
} from 'lucide-react';
import {
  Agent,
  type Card,
  type EntreeJournal,
  type EngineInfo,
  type EtapeDuParcours,
  LIBELLES_DU_CHAMP,
  MOT_CADRAGE,
  MOT_CONFIGURATION,
  Message,
  type TodoItem,
  ancreDuPoint,
  attenteDeLaDemande,
  barreDeSuivi,
  colonneAffichee,
  agentCompteCommeTravail,
  etapeDeSuiviDuPoint,
  estCarteDuRendezVousDeNuit,
  propositionsDeLaNuit,
  etapesDuFluxSous,
  etatDuDeploiement,
  passageViseParLeSegment,
  segmentActifDeSuivi,
  type EtapeDeSuivi,
  messageDeLaCarteVaAuCadrage,
  filDesRecherchesAffiche,
  fluxDuParcours,
  gesteDuParcours,
  gestesDuParcours,
  tourNonAbouti,
  preparationAAfficher,
  pointsDuParcours,
  pointsOuvertsDOffice,
  questionsOuvertesDuFil,
  decisionsEnAttente,
  type ReglagesCarte,
  tourLanceApresLaDemande,
  separateurDeJour,
  temoinDeTravail,
  carteRangee,
  decisionDePlanOuverte,
  libellePrecedents,
  ligneDeSuggestion,
  lignesDeSuggestions,
  peutRepartir,
  questionEnTexteLibre,
  reglagesDeLaCarte,
  comprehensionValideePourLaVersionCourante,
  titreDeBloc,
  TEXTE_BARRE_EN_ATTENTE,
  modeleActuel,
  idDuMessageDeSynthese,
} from '@beluga/shared';
import { BulleInfo, Button, ConfirmDialog, DialogTitle, Drawer, EmptyState, Tooltip, ZoneDefilement } from '@/components/ui';
import { IndicateurActivite } from '@/components/indicateur-activite';
import { RunSelectors, resoudreRun, type RunChoix } from '@/components/run-selectors';
import { MessageView } from '@/components/message-view';
import { Composer } from '@/components/composer';
import { ANCRE_DU_DEPLOIEMENT, FluxEnPoints, type OuvertureDemandee } from '@/components/flux-en-points';
import { carteDeSuivi } from '@/lib/carte-de-suivi';
import { BarreDEtapes } from '@/components/barre-etapes';
import { BarreDAction, PanneauDeDecision } from '@/components/parcours-carte';
import { useArretAgent } from '@/components/arret-agent';
import { InfoTravail } from '@/components/info-travail';
import { CorpsListeTaches, resumeDesTaches, usePliDesTaches } from '@/components/todos';
import { BandeauPropositions } from '@/components/propositions';
import { SilhouetteConversation } from '@/components/silhouettes';
import { client } from '@/lib/client';
import { quandLEcranEstRegarde } from '@/lib/ecran-regarde';
import { useApp, useCanal } from '@/lib/use-app';
import { cn, jourDuMessage } from '@/lib/utils';
import { useMinute } from '@/lib/horloge';
import { t, formatRegional } from '@/lib/langue';
import { useSeconde } from '@/lib/horloge';
import { useIntervalleVisible } from '@/lib/veille';

export function Chat({
  agent,
  projectId,
  header,
  onProposeTask,
  cardId,
  nouveauDepart,
  creuxReserveAilleurs,
  emplacementBarre,
  emplacementReglages,
  reponsesProposees,
  libelleDuChamp,
  avancementDansLeFil,
}: {
  agent: Agent | null;
  projectId: string;
  header?: React.ReactNode;
  onProposeTask?: (text: string) => void;
  /** Depuis une carte : on affiche TOUTE son histoire, pas seulement le dernier agent. */
  cardId?: string;
  /** Propose le bouton « repartir de zéro » (conversation sans carte). */
  nouveauDepart?: boolean;
  /** Quelque chose vient EN DESSOUS (barre de navigation du téléphone) : le
      creux de l'écran y est déjà réservé, la barre d'écriture ne doit pas le
      réserver une seconde fois. */
  creuxReserveAilleurs?: boolean;
  /** Sur téléphone : l'emplacement, sous le titre du tiroir, où la barre d'étapes se pose. */
  emplacementBarre?: React.RefObject<HTMLDivElement | null>;
  /**
   * L'emplacement, dans l'entête de la carte (à gauche des trois points), où
   * se pose l'icône qui rouvre la configuration quand son bloc a quitté l'écran.
   */
  emplacementReglages?: HTMLElement | null;
  /**
   * DES RÉPONSES TOUTES FAITES, POSÉES JUSTE AU-DESSUS DE LA BARRE D'ÉCRITURE.
   *
   * Une barre vide sous un échec laisse chercher ses mots. Un clic ÉCRIT la
   * phrase dans le champ — il n'envoie rien : c'est le même geste que les
   * suggestions d'un rapport, et il laisse toute latitude de la compléter.
   * Sans ces réponses (le cas de toutes les conversations ordinaires), rien
   * n'est rendu.
   */
  reponsesProposees?: readonly string[];
  /** Le libellé du champ, quand la conversation n'est pas celle d'une carte. */
  libelleDuChamp?: string;
  /**
   * LA LISTE DE TÂCHES DANS LE FIL — exception décidée pour le STUDIO SEUL
   * (DEC-058 garde le repère compact partout ailleurs). Fourni, il rend le bloc
   * d'avancement posé au bout du fil, et le repère compact ne garde que le
   * témoin de travail (et son bouton d'arrêt), sans la liste. Il reçoit aussi le
   * dernier texte de l'agent : le Studio y lit les styles cités (« [style:<id>] »).
   */
  avancementDansLeFil?: (etat: { todos: TodoItem[]; busy: boolean; dernierTexte: string }) => React.ReactNode;
}) {
  const state = useApp();
  /* L'état du lien : il éteint les gestes du parcours au lieu de les laisser
     décider sur ce qui était vrai avant la coupure. */
  const canal = useCanal();
  const [picked, setPicked] = React.useState<string[]>([]);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  /*
   * CE QU'UN BLOC DU FIL DÉPOSE DANS LA BARRE D'ÉCRITURE, sans rien envoyer :
   * le refus d'un plan et ses suggestions d'optimisation
   * (`shared/src/suggestions-de-plan.ts`). Le compteur fait la différence entre
   * deux clics sur la MÊME pastille : sans lui, le second ne changerait rien et
   * la barre resterait muette.
   */
  const [aEcrire, setAEcrire] = React.useState<{ texte: string; nonce: number } | null>(null);
  const ecrireDansLeChamp = React.useCallback(
    (texte: string) => setAEcrire((avant) => ({ texte, nonce: (avant?.nonce ?? 0) + 1 })),
    [],
  );

  const conversation = cardId ? state.cardMessages[cardId] : undefined;
  const messages = cardId
    ? (conversation?.messages ?? [])
    : agent
      ? (state.messages[agent.id] ?? [])
      : [];
  /*
   * LE FIL EST-IL SEULEMENT EN TRAIN D'ARRIVER ? Une liste vide se lit de deux
   * façons opposées : « rien à dire » ou « pas encore reçu ». On les sépare sur
   * l'ABSENCE de l'entrée (jamais sur sa longueur) : le serveur envoie les
   * messages d'un agent en un bloc (`agent.etat`), ceux d'une carte de même,
   * et tant que le premier état du projet n'est pas là on ne connaît même pas
   * l'agent de la conversation.
   */
  const chargement = cardId
    ? conversation === undefined
    : agent
      ? state.messages[agent.id] === undefined
      : !state.cartesChargees[projectId];
  const queue = agent ? (state.queues[agent.id] ?? []) : [];
  /*
   * LE TÉMOIN DE TRAVAIL SUIT L'AGENT, PAS LE MESSAGE. Un message peut rester
   * marqué « en cours d'écriture » alors que son tour est refermé depuis
   * longtemps (fermeture d'autorité, redémarrage du serveur) : le bandeau
   * « Réflexion en cours… » restait alors allumé indéfiniment sur un agent en
   * échec. La règle est partagée avec le démon, qui éteint la marque de son
   * côté (`temoinDeTravail`, `shared/src/travail-en-cours.ts`).
   *
   * Et il suit d'abord le TOUR VIVANT (`tourVivantDepuis`) : un agent qui
   * enchaîne des commandes n'écrit rien, et le démon range encore son tour
   * après la réponse rendue. Tant que ce tour est là, l'agent travaille et
   * peut être arrêté.
   */
  /*
   * ET IL NE PEUT PLUS CONTREDIRE LE COMPTE RENDU QU'IL AFFICHE. Le dernier
   * message d'agent ACHEVÉ (plus en écriture, du texte dedans) date le rapport
   * rendu : au-delà du plafond de rangement d'après-réponse, un témoin encore
   * allumé ne décrit plus un travail mais un état perdu, et il s'éteint
   * (`shared/src/travail-en-cours.ts`).
   */
  const reponseRendueA = [...messages]
    .reverse()
    .find((m) => m.role === 'assistant' && !m.streaming && m.content.trim().length > 0)?.createdAt;
  const busy = temoinDeTravail({
    statut: agent?.status,
    tourVivantDepuis: agent?.tourVivantDepuis,
    finDuTour: agent?.endedAt,
    messageEnEcritureA: messages.find((m) => m.streaming)?.createdAt,
    reponseRendueA,
  });

  /*
   * ET CE FILET SE DÉCLENCHE TOUT SEUL, SANS NOUVEL ÉVÉNEMENT. Il repose sur
   * l'ÂGE du compte rendu : si rien ne re-rend cette vue, un témoin resté
   * allumé le resterait jusqu'au prochain message — c'est-à-dire jamais, quand
   * l'agent a disparu. Un battement lent (le quart du plafond) suffit à le
   * réveiller, et il ne tourne QUE dans la fenêtre qui nous intéresse : un
   * témoin allumé sous un compte rendu déjà rendu.
   */
  const [, battre] = React.useReducer((n: number) => n + 1, 0);
  useIntervalleVisible(battre, 30_000, busy && reponseRendueA !== undefined);

  /*
   * L'agent a fini son tour sur une question posée en TEXTE ORDINAIRE (pas par
   * l'outil prévu) : elle allume le triangle orange, mais aucun bloc de réponse
   * ne s'affiche. On reconnaît le cas — la MÊME règle que le serveur — pour
   * poser un court repère au-dessus de la barre d'écriture : la réponse
   * s'écrit là. Le repère s'éteint dès qu'un message est envoyé (le dernier
   * message n'est alors plus la question), et jamais pour une vraie question
   * d'outil (`questionEnTexteLibre` l'écarte).
   */
  const carte = cardId ? state.cards[cardId] : undefined;
  const reglagesCarte = useReglagesCarte(carte);
  /*
   * LE TIROIR DE CONFIGURATION A UN SEUL ÉTAT D'OUVERTURE, tenu ici : le bloc
   * du point « Configuration » et l'icône de l'entête ouvrent LE MÊME tiroir.
   * L'icône ne paraît que lorsque le bloc n'est plus à l'écran — défilé hors
   * de vue, ou point replié.
   */
  const [reglagesOuverts, setReglagesOuverts] = React.useState(false);
  const [blocReglages, setBlocReglages] = React.useState<HTMLElement | null>(null);
  const [blocReglagesVisible, setBlocReglagesVisible] = React.useState(true);
  React.useEffect(() => setReglagesOuverts(false), [cardId]);
  React.useEffect(() => {
    if (!blocReglages) {
      setBlocReglagesVisible(false);
      return;
    }
    if (typeof IntersectionObserver === 'undefined') return;
    const suivi = new IntersectionObserver(([entree]) => setBlocReglagesVisible(!!entree?.isIntersecting), {
      threshold: 0,
    });
    suivi.observe(blocReglages);
    return () => suivi.disconnect();
  }, [blocReglages]);
  /*
   * LA CONVERSATION DE CADRAGE D'UNE CARTE. Tant que la carte dort en
   * « Planifié » et que c'est un agent de CADRAGE qui parle, le geste qui
   * compte n'est pas d'écrire un message de plus : c'est de LANCER le travail.
   * Le bouton vit donc en pleine largeur, au-dessus du champ de saisie
   * (`shared/src/cadrage.ts`).
   */
  /*
   * LE PARCOURS EST LU SUR LA CARTE, JAMAIS DÉDUIT DU TEXTE. Le chapitre et
   * le geste principal viennent d'une règle pure et partagée
   * (`gesteDuParcours`, `shared/src/parcours-carte.ts`) qui lit la colonne, le
   * rôle de l'agent, le tour vivant, les questions ouvertes et
   * `card.parcours` — la compréhension et les plans écrits par les outils du
   * cadrage. Le geste rend TOUJOURS son bouton et sa raison.
   */
  /*
   * L'agent a fini son tour sur une question posée en TEXTE ORDINAIRE (pas par
   * l'outil prévu) : elle allume le triangle orange, mais aucun bloc de réponse
   * ne s'affiche. On reconnaît le cas — la MÊME règle que le serveur — pour
   * poser un court repère au-dessus de la barre d'écriture, et pour que les
   * gestes du parcours la comptent comme une décision ouverte.
   */
  const dernierMessage = messages[messages.length - 1];
  const questionEnTexte =
    !!cardId && !busy && !carteRangee(carte?.column) && dernierMessage
      ? questionEnTexteLibre(dernierMessage)
      : null;
  /*
   * LE FIL, DATÉ. Le fil d'une carte porte le cadrage ET l'exécution : sans la
   * date de chaque message, la règle du parcours ne peut pas distinguer un plan
   * rendu AVANT le clic sur « Lancer » du premier mot du tour lancé — et une
   * carte cadrée n'aurait jamais de préparation (`reponseRendueDepuis`).
   */
  const messagesDuParcours = React.useMemo(
    () => messages.map((message) => ({ ...message, at: message.createdAt })),
    [messages],
  );
  const contexteDuParcours = React.useMemo(
    () => ({
      colonne: carte?.column ?? 'planned',
      roleAgent: agent?.role,
      tourEnCours: busy,
      messages: messagesDuParcours,
      parcours: carte?.parcours,
      /* Canal coupé ou état pas encore redemandé : `busy` et le parcours
         datent d'avant la coupure. On ne décide plus dessus. */
      etatPerime: canal.gele,
      questionEnTexte: !!questionEnTexte,
      /* LA MARQUE DE VOL : c'est elle qui distingue une carte PARTIE mais pas
         encore commencée d'une carte dont le tour s'est tu (`chapitreDuParcours`). */
      tourEnVolDepuis: carte?.scheduling?.tourEnVolDepuis,
      /* CE QUI DIT QU'UN TOUR NE S'EST PAS RENDU JUSQU'AU BOUT : des étapes
         jamais faites, ou un dernier tour mal terminé (`tourNonAbouti`). */
      tachesNonFaites: agent?.todos?.unfinished,
      dernierTourEnEchec: agent ? agent.status === 'failed' || agent.status === 'stopped' : false,
      /* CE QUE LE BANDEAU DU PLAN LIT DÉJÀ : la carte a-t-elle déjà travaillé ?
         Sans ces trois-là, le bouton « Valider le plan » répondait autrement
         que le flux affiché juste au-dessus (`decisionDePlanOuverte`). */
      codeDejaEnregistre: carte?.codeDejaEnregistre,
      agentDeLaCarte: carte?.agentId,
      /* L'agent qui tient CE fil est celui qui a écrit le plan qu'on y lit. */
      agentDuPlan: agent?.id,
    }),
    [
      carte?.agentId,
      carte?.codeDejaEnregistre,
      carte?.column,
      carte?.parcours,
      carte?.scheduling?.tourEnVolDepuis,
      agent?.id,
      agent?.role,
      agent?.status,
      agent?.todos?.unfinished,
      busy,
      messagesDuParcours,
      questionEnTexte,
      canal.gele,
    ],
  );
  /* Le même constat, pour les POINTS : ils cessent de se cocher tout seuls. */
  const nonAbouti = React.useMemo(() => tourNonAbouti(contexteDuParcours), [contexteDuParcours]);
  const geste = React.useMemo(() => gesteDuParcours(contexteDuParcours), [contexteDuParcours]);
  /* La RANGÉE porte un geste, ou DEUX sur une tâche arrêtée : « Reprendre » et
     « Terminer la tâche » côte à côte (`gestesDuParcours`). */
  const gestes = React.useMemo(() => gestesDuParcours(contexteDuParcours), [contexteDuParcours]);
  /*
   * LES CINQ POINTS DU PARCOURS — demande, compréhension, plan, travail,
   * rapport — sont lus sur le JOURNAL de la carte, son CARNET de mémoire et ce
   * qu'elle porte de son parcours, par une règle pure
   * (`pointsDuParcours`, `shared/src/parcours-en-points.ts`). Le fil fait foi
   * sur les questions encore ouvertes. Le journal est demandé une fois à
   * l'ouverture, puis grandit en direct (`journal.entree`, `carnet.lignes`).
   */
  const journal = cardId ? state.journaux[cardId] : undefined;
  const carnet = cardId ? state.carnets[cardId] : undefined;
  /*
   * LE JOURNAL EST-IL ARRIVÉ ? Il est demandé APRÈS le premier rendu
   * (`card.journal`, plus bas). Tant qu'il manque, le parcours se calculerait
   * sur du VIDE — et c'est exactement ce qui affichait « Demande » et
   * « Travail » en cours ensemble sur une carte rouverte en plein travail. Le
   * flux montre alors sa SILHOUETTE, jamais un état inventé
   * (`SilhouetteParcours`, règle d'interface : « une zone qui n'a pas encore
   * ses données montre une silhouette, jamais un état vide »).
   */
  const journalCharge = !cardId || journal !== undefined;
  /*
   * L'ÉTAPE DE PRÉPARATION EN COURS, telle que le démon la diffuse
   * (`card.lancement`). Elle n'est jamais enregistrée : une page ouverte en
   * cours de route ne la reçoit pas, et le moment « Préparation » s'affiche
   * alors sans son détail. La règle pure `preparationAAfficher` écarte les
   * signaux qui ne veulent plus rien dire : carte sortie de « Travail », signal
   * plus vieux que le démon en cours, ou simplement périmé.
   */
  const lancementDiffuse = cardId ? state.lancements[cardId] : undefined;
  const etapeDePreparation = lancementDiffuse
    ? preparationAAfficher({
        etape: lancementDiffuse.etape,
        depuis: lancementDiffuse.depuis,
        colonne: carte?.column ?? 'planned',
        agentAuTravail: false,
        demonDemarreA: state.demon?.demarreA,
        maintenant: Date.now(),
      })
    : null;
  /*
   * L'ÉCHO LOCAL DE LA DEMANDE — CE QUI EMPÊCHE L'ÉCRAN DE PARAÎTRE FIGÉ.
   *
   * Entre le clic sur « envoyer » et l'écho du serveur, il se passe un
   * enregistrement, une diffusion, un choix de compte et l'ouverture d'une
   * copie de travail. Tant que l'écran attendait cet écho, il restait sur le
   * bloc de configuration, sans un mouvement : on croyait à un plantage.
   *
   * Le composeur prévient donc À L'INSTANT DU CLIC (`onEnvoiCommence`), et
   * cette demande est ajoutée au journal AFFICHÉ — jamais au journal reçu.
   * Elle s'efface d'elle-même dès que la vraie entrée arrive (même texte),
   * ce qui interdit la double bulle, et l'échec d'envoi la retire aussi.
   */
  const [envoiLocal, setEnvoiLocal] = React.useState<{ texte: string; at: number } | null>(null);
  React.useEffect(() => setEnvoiLocal(null), [cardId, agent?.id]);
  const demandeDejaAuJournal =
    !!envoiLocal &&
    (journal ?? []).some(
      (entree) =>
        entree.nature === 'jalon' &&
        entree.libelle === 'Demande' &&
        (entree.resultat ?? '').trim() === envoiLocal.texte.trim(),
    );
  React.useEffect(() => {
    if (demandeDejaAuJournal) setEnvoiLocal(null);
  }, [demandeDejaAuJournal]);
  /** Le journal tel que le parcours le lit : celui du serveur, plus l'écho local. */
  const journalAffiche = React.useMemo<EntreeJournal[]>(() => {
    const entrees = journal ?? [];
    if (!envoiLocal || demandeDejaAuJournal || !cardId) return entrees;
    const rang = entrees.reduce((haut, entree) => Math.max(haut, entree.rang), -1) + 1;
    return [
      ...entrees,
      {
        id: `envoi-local-${envoiLocal.at}`,
        cardId,
        rang,
        at: envoiLocal.at,
        nature: 'jalon',
        /* Sous un rapport rendu, ou sur une carte relancée, la demande part au
           cadrage (`messageDeLaCarteVaAuCadrage`). */
        phase: agent?.role === 'cadrage' || (carte && messageDeLaCarteVaAuCadrage(carte)) ? 'cadrage' : 'execution',
        libelle: 'Demande',
        agentId: agent?.id,
        agentRole: agent?.role,
        resultat: envoiLocal.texte,
        // Se lit dans le flux, n'avance aucun point : rien n'est encore écrit.
        provisoire: true,
      } as EntreeJournal,
    ];
  }, [journal, envoiLocal, demandeDejaAuJournal, cardId, agent?.id, agent?.role, carte?.column]);
  /* LE JOURNAL ET LE FIL NE SE DEMANDENT PLUS D'ICI. Le tiroir se tait tant
     qu'il n'a rien reçu (sa silhouette) : la conversation n'est alors pas
     montée, et sa demande ne partirait jamais. C'est donc le tiroir qui ouvre
     les données de la carte (`client.ouvrirLesDonneesDeCarte`). */
  const questionsOuvertes = React.useMemo(() => questionsOuvertesDuFil(messages), [messages]);
  const decisionsDeTour = React.useMemo(() => decisionsEnAttente(messages), [messages]);
  /* LE CADRAGE N'A JAMAIS DÉMARRÉ (carte posée par un agent, aucun message,
     aucun tour, rien en file) : le point « Compréhension » attend, il ne
     tourne pas à vide. */
  const cadrageEnAttente =
    !chargement &&
    !canal.gele &&
    agent?.role === 'cadrage' &&
    carte?.origin === 'agent' &&
    !busy &&
    queue.length === 0 &&
    !carte?.parcours?.comprehension?.texte?.trim() &&
    !messages.some((message) => !cardId || message.id !== idDuMessageDeSynthese(cardId));
  /* LA CARTE DU RENDEZ-VOUS DE NUIT se lit Demande, Examen, Propositions
     (`avecLeParcoursDeLaNuit`). Ses propositions viennent du fil de son agent :
     tant qu'il n'est pas arrivé, on ne dit pas « aucune ». Sa panne est la
     raison écrite sur la carte, ramenée dans « Planifié ». */
  const carteDeNuit = estCarteDuRendezVousDeNuit(carte);
  const rendezVousDeNuit = React.useMemo(
    () =>
      carteDeNuit
        ? {
            propositions: chargement ? undefined : propositionsDeLaNuit(messages),
            panne: carte?.column === 'planned' ? carte?.scheduling?.waitingReason : undefined,
          }
        : null,
    [carteDeNuit, chargement, messages, carte?.column, carte?.scheduling?.waitingReason],
  );
  const points = React.useMemo(
    () =>
      pointsDuParcours(
        journalAffiche,
        {
          chapitre: geste.chapitre,
          colonne: carte?.column ?? 'planned',
          tourEnCours: busy,
          parcours: carte?.parcours,
          questionsOuvertes,
          etatPerime: canal.gele,
          tourEnVolDepuis: carte?.scheduling?.tourEnVolDepuis,
          /* CE QUI DIT SI LE PLAN SE DÉCIDE ENCORE : l'agent qui tient la
             carte et le code déjà enregistré (`phraseDuPointPlan`). */
          agentDeLaCarte: carte?.agentId,
          codeDejaEnregistre: carte?.codeDejaEnregistre,
          /* L'étape franchie, quand le signal l'a apportée : le moment
             « Préparation » l'affiche, et s'en passe sans elle. */
          lancement: etapeDePreparation ?? undefined,
          /* LE TOUR S'EST-IL ARRÊTÉ EN ROUTE ? Les points « Travail » et
             « Rapport » ne se cochent plus sur la seule colonne. */
          tourNonAbouti: nonAbouti,
          /* UN TOUR DE CADRAGE TOMBÉ se lit sur la Compréhension, tant que la
             décision du bas attend — jamais sur Travail ni Rapport. */
          dernierTourEnEchec: contexteDuParcours.dernierTourEnEchec,
          decisionDeTourOuverte: decisionsDeTour > 0,
          cadrageEnAttente,
          /* LA PHRASE PORTÉE PAR LA CARTE, la même que sur sa vignette : le
             tableau et le tiroir ne peuvent plus se contredire. */
          mentionDeLaCarte: carte?.sansModification,
          /* UNE CARTE MÈRE SE LIT SUR SES FILLES : « Travail » et « Rapport »
             disent où en est chaque projet touché (`avecLeSuiviDesFilles`). */
          suiviDesFilles: carte?.suiviDesFilles,
          rendezVousDeNuit,
          /* CE QUE LA CARTE PORTE : une étape sans journal le montre, au lieu
             d'une coche sur du vide (`avecLeContenuDeLaCarte`). */
          descriptionDeLaCarte: carte?.description,
          analyseDeLaCarte: carte?.analysisContext,
          creeeA: carte?.createdAt,
        },
        carnet ?? [],
      ),
    [
      journalAffiche,
      carnet,
      geste.chapitre,
      carte?.description,
      carte?.analysisContext,
      carte?.createdAt,
      carte?.column,
      carte?.parcours,
      carte?.scheduling?.tourEnVolDepuis,
      carte?.agentId,
      carte?.codeDejaEnregistre,
      etapeDePreparation,
      busy,
      questionsOuvertes,
      nonAbouti,
      contexteDuParcours.dernierTourEnEchec,
      decisionsDeTour,
      carte?.sansModification,
      carte?.suiviDesFilles,
      rendezVousDeNuit,
      canal.gele,
      cadrageEnAttente,
    ],
  );
  const flux = React.useMemo(() => fluxDuParcours(points), [points]);
  /*
   * L'ATTENTE, ÉCRITE SOUS LE POINT « DEMANDE ». Entre le clic et le premier
   * mot de l'agent, il ne se passait rien de LISIBLE ; et une demande retombée
   * en file faute de quota tournait exactement comme un tour au travail
   * (`attenteDeLaDemande`, règle pure). La file vient du serveur
   * (`queue.etat`), le tour lancé du journal.
   */
  /* L'HEURE, RAFRAÎCHIE CHAQUE MINUTE : c'est elle qui fait expirer la
     « Préparation du tour… ». Sans elle, la phrase restait affichée sous un
     chronomètre à « 54 min ». */
  const minute = useMinute();
  const attente = React.useMemo(() => {
    /* DEPUIS QUAND CE TOUR ATTEND : le dernier moment écrit au journal fait
       foi. Au-delà du plafond (`PREPARATION_MAX_MS`), la préparation n'en est
       plus une, et l'écran se tait plutôt que de mentir. */
    const dernierMoment = journalAffiche.reduce((haut, entree) => Math.max(haut, entree.at ?? 0), 0);
    return (
      attenteDeLaDemande({
        envoiLocal: !!envoiLocal,
        file: queue,
        tourEnCours: busy,
        tourLance: tourLanceApresLaDemande(journalAffiche),
        depuisMs: dernierMoment ? Math.max(0, minute - dernierMoment) : undefined,
      }) ?? null
    );
  }, [envoiLocal, queue, busy, journalAffiche, minute]);
  /*
   * LA BARRE PARLE COMME LA FRISE DE « TABLEAUX DE BORD » : Demande,
   * Compréhension, Travail, À déployer, Archivée (`barreDeSuivi`), et son
   * étape désignée est la MÊME (`etapeCouranteDeSuivi`). Le plan se range sous
   * Compréhension, la préparation et le rapport sous Travail.
   */
  const suivi = React.useMemo(
    () =>
      carte
        ? carteDeSuivi(carte, {
            agentActif: busy,
            deploys: state.deploys,
            colonne: colonneAffichee({
              column: carte.column,
              agentAuTravail: busy && !!agent && agentCompteCommeTravail(agent.role),
            }),
          })
        : { colonne: 'planned' },
    [carte, busy, state.deploys, agent],
  );
  const segments = React.useMemo(() => barreDeSuivi(points, suivi), [points, suivi]);
  const deploiement = React.useMemo(
    () => ({ etat: etatDuDeploiement(suivi), deployeeA: suivi.deployeeA }),
    [suivi],
  );
  const ouvertsDOffice = React.useMemo(() => pointsOuvertsDOffice(points), [points]);
  /* LA BARRE EST UN RACCOURCI : toucher un segment ouvre le point et défile jusqu'à lui ;
     le segment actif suit ensuite le point visible. */
  const [ouverture, setOuverture] = React.useState<OuvertureDemandee | null>(null);
  const [etapeVisible, setEtapeVisible] = React.useState<EtapeDeSuivi | null>(null);
  /* Le point le plus visible, dit dans la langue de la barre : le point
     « Déploiement » éclaire « Archivée » une fois la carte rangée. */
  const surPointVisible = React.useCallback(
    (etape: EtapeDuParcours | 'deploiement') =>
      setEtapeVisible(
        etape === 'deploiement'
          ? suivi.colonne === 'archived'
            ? 'archivee'
            : 'a_deployer'
          : (etapeDeSuiviDuPoint(etape, carteDeNuit) ?? 'demande'),
      ),
    [suivi.colonne, carteDeNuit],
  );
  React.useEffect(() => {
    setOuverture(null);
    setEtapeVisible(null);
  }, [cardId]);
  /* TOUCHER UN SEGMENT MÈNE AU DERNIER PASSAGE DE SON ÉTAPE : c'est là qu'on
     en est, pas à la première fois qu'on y est passé. */
  const allerAuPoint = React.useCallback(
    (etape: EtapeDeSuivi) => {
      setEtapeVisible(etape);
      /* « À déployer » et « Archivée » visent le point « Déploiement », posé
         en bas du flux dès que la carte y est arrivée. */
      if (etape === 'a_deployer' || etape === 'archivee') {
        setOuverture((avant) => ({ ancre: ANCRE_DU_DEPLOIEMENT, etape: 'deploiement', nonce: (avant?.nonce ?? 0) + 1 }));
        return;
      }
      const passage = passageViseParLeSegment(points, etape);
      const premiere = etapesDuFluxSous(etape).find((e) => e !== 'preparation') ?? 'demande';
      const ancre = passage?.ancre ?? ancreDuPoint(premiere);
      setOuverture((avant) => ({ ancre, etape: passage?.etape ?? premiere, nonce: (avant?.nonce ?? 0) + 1 }));
    },
    [points],
  );
  /*
   * LA CONFIGURATION EST-ELLE ENCORE OUVERTE ? Trois conditions, et toutes
   * les trois nécessaires :
   *
   *  – le fil est ARRIVÉ (`!chargement`) : une liste vide qui n'est que « pas
   *    encore reçue » ferait clignoter la carte de configuration devant une
   *    carte qui a déjà tout dit ;
   *  – RIEN N'A ÉTÉ ENVOYÉ : c'est le premier prompt qui ferme le choix, pas
   *    le lancement — dès qu'une demande est partie, l'agent qui la traitera
   *    ne se rechoisit plus ;
   *  – la carte n'a PAS DÉMARRÉ (`vu.modifiable`, règle pure de
   *    `reglagesDeLaCarte`) : une carte reprise à la main après un tour a déjà
   *    ses faits, les réécrire ferait mentir son parcours.
   *
   * On ne demande PAS l'agent de cadrage ici : une carte tout juste née n'en a
   * pas encore, et son premier écran doit quand même être sa configuration.
   */
  const configurationOuverte =
    !chargement && !envoiLocal && messages.length === 0 && reglagesCarte.vu?.modifiable === true;
  /*
   * LA TIMELINE DE CADRAGE N'A PLUS D'ÉCRAN. Elle dessinait les six étapes du
   * cadrage par-dessus le fil des messages d'une carte — et ce fil n'existe
   * plus : la conversation d'une carte EST son parcours (`JournalCarteTab`,
   * plus bas), qui porte déjà les phases dans l'ordre du temps. Ce qui survit
   * de `flux-cadrage.tsx` est `planRenduDansLeFil` : la condition du bouton
   * « Lancer la tâche », qui n'a jamais rien dessiné.
   */
  /* LE FIL DES RECHERCHES DE MÉMOIRE APPARTIENT AU CADRAGE, PAS À
     L'EXÉCUTION : sur une carte, il ne se pose jamais dans le fil ordinaire
     (`filDesRecherchesAffiche`, `shared/src/cadrage.ts`). */
  const filDesRecherchesMasque = !filDesRecherchesAffiche({ surUneCarte: !!carte });

  /* Une carte-fil encore vide n'attend pas une analyse : elle attend qu'on
     dise ce qu'on veut faire. Le mot par défaut change donc avec l'agent. */
  const motDeLaConversationVide =
    agent?.role === 'cadrage'
      ? { titre: t(MOT_CADRAGE.titre), indice: t(MOT_CADRAGE.indice) }
      : {
          titre: t('Aucun échange pour le moment'),
          indice: t('Posez une question ou demandez une action.'),
        };
  // Les échanges d'avant le dernier nouveau départ sont repliés par défaut.
  const [tout, setTout] = React.useState(false);
  const precedents = agent ? (state.precedents[agent.id] ?? 0) : 0;

  React.useEffect(() => setTout(false), [agent?.id, cardId]);

  React.useEffect(() => {
    if (agent) client.send({ type: 'agent.open', id: agent.id, tout });
  }, [agent?.id, tout]);

  /*
   * La carte est SOUS LES YEUX : dès que l'agent se tait, sa réponse est lue.
   * Sans cela, la pastille « terminé, pas encore lu » s'allumerait dans la
   * colonne des projets pendant qu'on lit précisément cette conversation.
   *
   * SOUS LES YEUX, PAS SEULEMENT MONTÉE (`ecranRegarde`, `shared`). Un tiroir
   * resté ouvert sur un ordinateur, dans un onglet caché ou sur un téléphone en
   * veille lisait la carte à la fin du tour : la date de lecture passait devant
   * la fin du tour, et le geste attendu, la cloche et la SECOUSSE de la carte
   * s'éteignaient sans que personne ait rien vu. La lecture attend donc que la
   * page soit visible et au premier plan.
   */
  React.useEffect(() => {
    if (!cardId || busy) return;
    return quandLEcranEstRegarde(() => client.send({ type: 'card.read', cardId }));
  }, [cardId, busy]);
  /*
   * …ET UN RENDU ARRIVÉ PENDANT QU'ON REGARDE NE RALLUME RIEN. L'instant du
   * rendu (`carte.renduA`) peut atteindre l'écran APRÈS que le témoin de
   * travail s'est éteint : on consulte donc aussi à son arrivée, dès que la
   * conversation est réellement regardée. Le même geste vaut sur chaque
   * appareil où la carte est ouverte.
   *
   * C'est l'ARRIVÉE D'UN RENDU qui déclenche la consultation, pas le seul fait
   * que la carte soit non lue : « Marquer comme non lu », choisi dans le menu
   * de ce tiroir, retire le repère de lecture sans rien rendre de neuf — la
   * carte doit alors RESTER non lue, et non se relire dans l'instant. D'où la
   * dépendance à `renduA` et la lecture de l'état par une référence. UN SEUL
   * JUGEMENT PAR RENDU : revenir sur l'onglet après « Marquer comme non lu »
   * ne relit pas la carte.
   */
  const renduA = carte?.renduA;
  const renduNonConsulte = !!renduA && renduA > (carte?.lastReadAt ?? 0);
  const renduNonConsulteRef = React.useRef(renduNonConsulte);
  renduNonConsulteRef.current = renduNonConsulte;
  React.useEffect(() => {
    if (!cardId || !renduA) return;
    return quandLEcranEstRegarde(() => {
      if (renduNonConsulteRef.current) client.send({ type: 'card.read', cardId });
    });
  }, [cardId, renduA]);

  /*
   * Le fil suit l'agent, MAIS il ne tire jamais la page sous les yeux de
   * quelqu'un en train de lire plus haut : le compte rendu d'analyse, déjà
   * écrit, ne doit plus défiler tout seul quand la tâche démarre. On ne
   * redescend donc que si l'on était déjà en bas.
   */
  const filRef = React.useRef<HTMLDivElement>(null);
  const ouvertePour = React.useRef<string | undefined>(undefined);
  /** Le nombre de messages déjà suivis : un de plus, c'est un message neuf. */
  const nombreVu = React.useRef(0);
  /** Tant qu'on n'est pas remonté à la main, le fil suit ce qui s'écrit. */
  const suit = React.useRef(true);

  React.useEffect(() => {
    const fil = filRef.current;
    if (!fil) return;
    const noter = () => {
      suit.current = fil.scrollHeight - fil.scrollTop - fil.clientHeight < 120;
    };
    fil.addEventListener('scroll', noter, { passive: true });
    return () => fil.removeEventListener('scroll', noter);
  }, []);

  React.useEffect(() => {
    const cle = cardId ?? agent?.id;
    // Ouverture d'une conversation : on se pose tout en bas, sans animation.
    if (ouvertePour.current !== cle && messages.length) {
      ouvertePour.current = cle;
      suit.current = true;
      nombreVu.current = messages.length;
      bottomRef.current?.scrollIntoView({ block: 'end' });
      return;
    }
    // UN NOUVEAU MESSAGE ARRIVE EN GLISSANT ; UN TEXTE QUI S'ALLONGE RESTE
    // COLLÉ. Pendant qu'un agent écrit, un glissé doux relancé à chaque
    // morceau courait derrière le texte et finissait par décrocher du bas.
    const nouveauMessage = messages.length !== nombreVu.current;
    nombreVu.current = messages.length;
    if (suit.current) bottomRef.current?.scrollIntoView({ behavior: nouveauMessage ? 'smooth' : 'instant', block: 'end' });
  }, [cardId, agent?.id, messages.length, messages[messages.length - 1]?.content]);

  /*
   * ALLER JUSQU'À LA QUESTION, PAS SEULEMENT JUSQU'AU FIL.
   *
   * Un clic sur une alerte ouvrait la carte ou la conversation et s'arrêtait
   * là : dans un fil de cent bulles, la question restait à chercher, et le
   * fil, lui, se posait tout en bas. La visée (`state.messageVise`) nomme la
   * bulle ; on défile jusqu'à elle et on l'entoure deux secondes, le temps de
   * la repérer. On coupe le SUIVI automatique au passage, sinon le fil
   * redescendrait aussitôt sur le dernier message.
   *
   * La visée est effacée dès qu'elle est honorée : sans cela, le moindre
   * nouveau message ramènerait l'écran en arrière. Elle est aussi effacée quand
   * la bulle n'est pas là — le fil affiché n'est pas celui de la décision.
   */
  const vise = state.messageVise;
  React.useEffect(() => {
    if (!vise) return;
    if (!messages.some((message) => message.id === vise.id)) return;
    const minuteur = window.setTimeout(() => {
      const cible = filRef.current?.querySelector<HTMLElement>(`[data-message="${vise.id}"]`);
      if (!cible) return;
      suit.current = false;
      cible.scrollIntoView({ behavior: 'smooth', block: 'center' });
      cible.setAttribute('data-message-vise', '');
      window.setTimeout(() => cible.removeAttribute('data-message-vise'), 2400);
      client.viserMessage(null);
    }, 80);
    return () => window.clearTimeout(minuteur);
  }, [vise?.id, vise?.nonce, messages.length]);

  /**
   * UNE BULLE DU FIL, DESSINÉE UNE SEULE FOIS. Le fil ordinaire l'appelle dans
   * l'ordre des messages ; pendant un cadrage, c'est la timeline qui l'appelle,
   * à la place que son étape lui donne. Les deux affichages montrent donc
   * exactement la même bulle, avec ses séparateurs de jour et d'agent.
   */
  const rendreMessage = (index: number) => {
    const message = messages[index];
    if (!message) return null;
    return (
      /* LE REPÈRE DU MESSAGE : c'est par lui qu'un clic sur une alerte défile
         jusqu'à la bulle qui porte la question, au lieu de s'arrêter au fil
         (`client.viserMessage`). Le cadre reprend l'espacement du fil pour que
         rien ne bouge à l'écran. */
      <div data-message={message.id} className="space-y-4">
        {/* UN CHANGEMENT DE JOUR SE VOIT : un trait pleine largeur, la date
            centrée dessus. Sans lui, deux bulles collées pouvaient être écrites
            à trois jours d'écart sans que rien ne le dise (`separateurDeJour`,
            `shared/src/heure-message.ts`). */}
        {separateurDeJour(messages, index) ? <SeparateurDeJour date={message.createdAt} /> : null}
        {/* Une carte a souvent eu plusieurs agents : un repère sépare le compte
            rendu de l'analyse de celui de l'exécution. */}
        {cardId && message.agentId !== messages[index - 1]?.agentId ? (
          <SeparateurAgent titre={titreDeBloc(state.agents[message.agentId]?.role)} />
        ) : null}
        <MessageView
          message={message}
          allMessages={messages}
          projectId={projectId}
          pickedEvolutions={picked}
          onToggleEvolution={toggleEvolution}
          onToggleAll={toggleAll}
          onEcrireDansLeChamp={ecrireDansLeChamp}
          /* Seul le DERNIER message peut porter une étape qui tourne pour de
             vrai : ailleurs, une étape restée « en cours » est le reliquat d'un
             tour coupé, et ne doit rien animer. */
          agentAuTravail={busy && index === messages.length - 1}
          /* La question en texte ordinaire ne se lit que sur le DERNIER message,
             et seule cette vue-ci connaît la carte : le fil juge, la bulle
             affiche. */
          questionEnTexte={!!questionEnTexte && index === messages.length - 1}
          /* SUR UNE CARTE, le fil des recherches ne s'affiche PLUS DU TOUT
             (`filDesRecherchesAffiche`) : pendant le cadrage, la timeline du
             flux dit déjà ce qui a été lu ; une fois la carte lancée, ces
             mêmes bulles revenaient sous « Exécution de la tâche » et y
             recopiaient la conversation de cadrage. */
          filAgentMasque={filDesRecherchesMasque}
        />
      </div>
    );
  };

  /*
   * UNE SUGGESTION COCHÉE S'ÉCRIT DANS LE CHAMP, PAS AU-DESSUS. Elle vivait
   * dans une pastille détachée, posée entre le fil et la barre d'écriture :
   * on pouvait la retirer, jamais la compléter ni la copier. Elle est donc
   * déposée dans le champ de saisie lui-même, sur sa propre ligne — et un
   * second clic reprend cette ligne, à condition que personne ne l'ait
   * retouchée (`texteApresRetrait`). La liste `picked` ne sert plus qu'aux
   * cases à cocher du rapport : rien ne part avec le message par ce
   * chemin-là.
   */
  const deposerDansLeChamp = (texte: string, retirer: boolean) =>
    setAEcrire((avant) => ({ texte, retirer, nonce: (avant?.nonce ?? 0) + 1 }));

  const toggleEvolution = (text: string) => {
    const deja = picked.includes(text);
    /* UNE IDÉE RETENUE S'ÉCRIT EN LIGNE DE LISTE, avec son tiret : c'est ce
       qui la distingue de la phrase en cours d'écriture, et c'est la forme
       qu'attend l'agent qui la lira (`ligneDeSuggestion`). */
    deposerDansLeChamp(ligneDeSuggestion(text), deja);
    setPicked((current) => (deja ? current.filter((item) => item !== text) : [...current, text]));
  };

  const toggleAll = (items: string[]) => {
    const toutesCochees = items.every((item) => picked.includes(item));
    deposerDansLeChamp(lignesDeSuggestions(items), toutesCochees);
    setPicked((current) =>
      toutesCochees ? current.filter((item) => !items.includes(item)) : [...new Set([...current, ...items])],
    );
  };

  /*
   * LA BARRE D'ÉCRITURE, ÉCRITE UNE SEULE FOIS. Les deux écrans de ce composant
   * — le PARCOURS d'une carte et le FIL d'un agent — posent exactement la même :
   * la demande, la réponse à une question, le bouton de lancement. La recopier
   * aurait laissé l'une des deux dériver.
   */
  const barreDEcriture = (
    <Composer
      agent={agent}
      /* LE GESTE PRINCIPAL DU CHAPITRE, et sa raison quand il est éteint
         (`BarreDAction`, `parcours-carte.tsx`). Sur une carte seulement :
         une conversation sans carte n'a pas de parcours. */
      boutonPrincipal={
        carte && cardId ? (
          <BarreDAction
            carte={carte}
            agent={agent}
            gestes={gestes}
          />
        ) : undefined
      }
      /* Le libellé du champ suit le chapitre : « Expliquez… », « Affinez le
         plan… », « Écrire à l'agent… ». */
      libelleDuChamp={carte ? t(LIBELLES_DU_CHAMP[geste.chapitre]) : libelleDuChamp}
      /* L'arrêt vit dans la barre d'action quand c'est le geste du chapitre :
         un second carré d'arrêt dans le champ le redirait. */
      sansArret={!!carte && geste.geste === 'arreter'}
      engines={state.engines}
      queue={queue}
      busy={busy}
      onClearPicked={() => setPicked([])}
      aEcrire={aEcrire}
      projectId={projectId}
      onProposeTask={onProposeTask}
      dansTiroir={!!cardId || !!creuxReserveAilleurs}
      cardId={cardId}
      fondNoir={!!nouveauDepart}
      /* Le témoin « en cours » est un petit décroché posé JUSTE AU-DESSUS de
         la zone de saisie, collé à elle — rien ne doit s'intercaler entre
         les deux. Les messages déjà envoyés (le fil, au-dessus) et ceux qui
         attendent leur tour (la file, dans la barre d'écriture) passent
         donc TOUS au-dessus de lui : c'est pour cela qu'il est confié à la
         barre d'écriture elle-même plutôt que posé à côté, dans le fil.
         Rendu ICI (même conteneur, même repli horizontal que la zone de
         saisie), il a exactement sa largeur. Sa marge négative le fait
         glisser sous le haut de la zone de saisie qui, posée APRÈS lui
         dans le document, recouvre son bas et donne l'impression qu'il
         sort de derrière elle. */
      barreTravail={
        <>
          {reponsesProposees?.length ? (
            <div className="mb-1.5 flex flex-wrap gap-1" data-reponses-proposees={reponsesProposees.length}>
              {reponsesProposees.map((texte) => (
                <button
                  key={texte}
                  type="button"
                  onClick={() => ecrireDansLeChamp(texte)}
                  className="rounded-full bg-raised px-2.5 py-1 text-left text-[12.5px] text-muted transition-colors hover:text-text"
                >
                  {texte}
                </button>
              ))}
            </div>
          ) : null}
          <TravailEnCours agent={agent} messages={messages} busy={busy} cardId={cardId} sansListe={!!avancementDansLeFil} />
        </>
      }
      /* RIEN NE FIGE À L'ENVOI : le parcours s'ouvre au clic (`envoiLocal`). */
      onEnvoiCommence={(texte) => setEnvoiLocal({ texte, at: Date.now() })}
      onEnvoiEchoue={() => setEnvoiLocal(null)}
    />
  );

  /*
   * ÉCRAN 1 — LA CONVERSATION D'UNE CARTE EST SON PARCOURS.
   *
   * Deux écrans se disputaient la même histoire : la conversation, qui rejouait
   * les bulles d'un cadrage puis d'une exécution, et l'onglet « Parcours », qui
   * tenait le journal ENTIER de la carte. On lisait donc la moitié des faits à
   * un endroit, l'autre moitié ailleurs, sans jamais savoir laquelle faisait
   * foi. L'onglet a disparu (`card-panel.tsx`) : tout vit ICI, dans l'ordre du
   * temps.
   *
   * DEUX TEMPS, ET DEUX SEULEMENT :
   *
   * 1. AVANT LA PREMIÈRE DEMANDE — la carte de configuration, pleine largeur et
   *    MODIFIABLE. C'est le seul geste attendu d'une tâche neuve : avec quoi
   *    va-t-elle tourner ? Rien de tout cela ne coûte un jeton.
   * 2. DÈS QUE LE PROMPT EST PARTI — cette carte se REPLIE en une ligne, EN
   *    LECTURE SEULE (`ReglagesAgent` n'a aucun geste d'écriture : ni menu, ni
   *    sélecteur, seulement un tiroir qui montre), et le PARCOURS prend toute la
   *    place sous elle.
   *
   * La barre d'écriture, elle, ne bouge jamais : c'est par elle que part la
   * demande, que se répond une question et que se lance la tâche.
   */
  if (carte && cardId) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {header}

        {/* LE RACCOURCI VERS LA CONFIGURATION, dans l'entête de la carte, à
            gauche des trois points : il ne paraît que quand le bloc du point
            « Configuration » a quitté l'écran, et ouvre LE MÊME tiroir. */}
        {emplacementReglages && !configurationOuverte && reglagesCarte.vu && !blocReglagesVisible
          ? createPortal(
              <Tooltip label={t('Configuration de l’agent')}>
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0 px-2"
                  aria-label="Configuration de l’agent"
                  data-raccourci-reglages={reglagesCarte.vu.modifiable ? 'modifiable' : 'lecture'}
                  onClick={() => setReglagesOuverts(true)}
                >
                  <SlidersHorizontal className="h-4 w-4" />
                </Button>
              </Tooltip>,
              emplacementReglages,
            )
          : null}

        {configurationOuverte && reglagesCarte.libelles ? (
          <ZoneDefilement className="flex flex-col px-3 py-3">
            <CarteDeConfiguration card={carte} libelles={reglagesCarte.libelles} />
          </ZoneDefilement>
        ) : (
          <>
            {/* EN TÊTE : la seule BARRE D'ÉTAPES — un segment par étape, sans
                illustration, qui servent de raccourci. La configuration de
                l'agent ne se tient plus ici : elle est devenue le PREMIER
                POINT du flux, juste avant « Demande ». */}
            {/* `px-4` comme la rangée d'onglets (`mx-4`, `card-panel.tsx`) : le
                premier et le dernier rond tombent sur ses bords. */}
            <div className="shrink-0 space-y-1.5 px-4 pt-1.5">
              {emplacementBarre?.current
                ? createPortal(
                    <BarreDEtapes segments={segments} active={etapeVisible ?? segmentActifDeSuivi(suivi)} courante={segmentActifDeSuivi(suivi)} onAller={allerAuPoint} />,
                    emplacementBarre.current,
                  )
                : <BarreDEtapes segments={segments} active={etapeVisible ?? segmentActifDeSuivi(suivi)} courante={segmentActifDeSuivi(suivi)} onAller={allerAuPoint} />}
            </div>

            {/* LE FLUX EN CINQ POINTS, dans la zone qui défile : chaque point
                replie ses traces, sa mémoire et ses boutons secondaires ; le
                plan est un point du flux (`FluxEnPoints`). */}
            <ZoneDefilement ref={filRef} data-fil="parcours" className="flex flex-col">
              <FluxEnPoints
                carte={carte}
                projectId={projectId}
                /* LE POINT « CONFIGURATION » PORTE LES RÉGLAGES DE L'AGENT :
                   moteur, modèle, réflexion, compte. Ils restent le point
                   d'accès aux réglages du moteur, dans le flux plutôt qu'en
                   bande fixe au-dessus de la barre. */
                configuration={
                  reglagesCarte.vu && reglagesCarte.libelles ? (
                    <ReglagesAgent
                      card={carte}
                      vu={reglagesCarte.vu}
                      libelles={reglagesCarte.libelles}
                      ouvert={reglagesOuverts}
                      onOuvert={setReglagesOuverts}
                      ancre={setBlocReglages}
                    />
                  ) : null
                }
                flux={flux}
                journalCharge={journalCharge}
                ouvertsDOffice={ouvertsDOffice}
                ouverture={ouverture}
                onEtapeVisible={surPointVisible}
                deploiement={deploiement}
                /* LE BLOC RENDU SE VISE PAR SON DÉBUT : on coupe le suivi du
                   bas, sinon le fil y redescendrait au message suivant. */
                onBlocRendu={() => {
                  if (!suit.current) return false;
                  suit.current = false;
                  return true;
                }}
                attente={attente}
                /* L'étape franchie donne sa largeur à la barre du point
                   « Préparation », comme sur la carte en colonne. */
                lancement={etapeDePreparation ?? undefined}
                pickedEvolutions={picked}
                onToggleEvolution={toggleEvolution}
                onToggleAll={toggleAll}
                onEcrireDansLeChamp={ecrireDansLeChamp}
              />
              <div ref={bottomRef} />
            </ZoneDefilement>
          </>
        )}

        {/* LE PANNEAU DE DÉCISION, collé au-dessus du champ : tout ce qui
            attend l'utilisateur — question, erreur, reprise, incident — à
            l'endroit où l'on répond (`PanneauDeDecision`). */}
        <PanneauDeDecision
          messages={messages}
          carte={carte}
          projectId={projectId}
          questionEnTexte={!!questionEnTexte}
        />

        {barreDEcriture}
      </div>
    );
  }

  /*
   * ÉCRAN 2 — LE FIL D'UN AGENT, SANS CARTE : une conversation ordinaire, en
   * bulles. Aucune carte ne l'encadre, donc rien à configurer ni à journaliser :
   * ce fil EST la seule trace de ce qui s'est dit.
   */
  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}

      {/* Une conversation ne défile que verticalement : ce qui dépasse en
          largeur (code, longue adresse) défile DANS son propre bloc.
          « overflow-x: hidden » ne suffit pas : le navigateur déplace quand
          même le contenu pour montrer une sélection ou un curseur, et le fil
          restait de travers. On le remet donc à zéro. */}
      {/* Le nouveau départ FLOTTE au-dessus du fil, en haut à droite : sa barre
          occupait toute une ligne d'écran pour un bouton. Le calque laisse
          passer les clics partout ailleurs. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {nouveauDepart ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 px-3 pt-2">
            <BarreNouveauDepart
              agent={agent}
              messages={messages}
              precedents={precedents}
              tout={tout}
              onTout={setTout}
            />
          </div>
        ) : null}

      <ZoneDefilement
        ref={filRef}
        data-fil="conversation"
        onScroll={(event) => {
          if (event.currentTarget.scrollLeft !== 0) event.currentTarget.scrollLeft = 0;
        }}
        className="flex flex-col px-3 py-3"
      >
        {/*
         * Un échange court — une phrase de l'agent et sa carte proposée — ne
         * remplit pas la hauteur du fil, et le contenu resterait collé EN HAUT
         * avec un grand vide noir jusqu'au volet des tâches.
         *
         * C'est le BLOC des messages qui se charge de descendre, et lui seul :
         * il fait au moins toute la hauteur du fil (« min-h-full ») et range
         * son contenu par le bas (« justify-end »). Dès que l'échange déborde,
         * le bloc grandit au-delà de cette hauteur et le fil défile
         * normalement — le haut reste atteignable, ce que « justify-end » posé
         * sur la ZONE de défilement, lui, interdirait.
         *
         * On ne s'en remet plus à une marge automatique (« mt-auto ») : dans un
         * conteneur qui défile, sa résolution dépend du navigateur, et le vide
         * revenait sur téléphone. Le bloc ne rétrécit jamais (« shrink-0 ») :
         * sans cela, un fil trop long serait comprimé au lieu de défiler.
         */}
        <div
          className={cn(
            'shrink-0 space-y-4',
            messages.length && 'flex min-h-full flex-col justify-end',
          )}
        >
          {messages.length ? (
            messages.map((message, index) => (
              <React.Fragment key={message.id}>{rendreMessage(index)}</React.Fragment>
            ))
          ) : chargement && cardId && state.conversationsEnEchec[cardId] ? (
            /* LA SILHOUETTE A UNE FIN : la demande est restée sans réponse
               après ses essais (`shared/src/chargement-conversation.ts`). On
               le dit, et on offre de redemander — une réponse tardive remplit
               le fil toute seule. */
            <div className="flex flex-col items-center gap-3 py-6">
              <EmptyState
                icon={<MessageSquare className="h-5 w-5" />}
                title={t('La conversation n’a pas pu être chargée')}
                hint={t('Le serveur n’a pas répondu. Réessayez dans un instant.')}
              />
              <Button variant="outline" onClick={() => client.reessayerLaConversation(cardId)}>
                <RotateCw className="h-3.5 w-3.5" />
                {t('Réessayer')}
              </Button>
            </div>
          ) : chargement ? (
            /* Les échanges ne sont PAS encore arrivés du serveur : des bulles en
               silhouette, jamais « Aucun échange pour le moment » — une phrase
               qui annoncerait une conversation vide sur un fil bien fourni. */
            <SilhouetteConversation />
          ) : (
            <EmptyState
              icon={<MessageSquare className="h-5 w-5" />}
              title={motDeLaConversationVide.titre}
              hint={motDeLaConversationVide.indice}
            />
          )}
          {avancementDansLeFil
            ? avancementDansLeFil({
                todos: [...messages].reverse().find((message) => message.todos?.length)?.todos ?? [],
                busy,
                dernierTexte: [...messages].reverse().find((message) => message.role === 'assistant' && typeof message.content === 'string' && message.content.trim())?.content ?? '',
              })
            : null}
          <div ref={bottomRef} />
        </div>
      </ZoneDefilement>
      </div>

      {/* Les cartes proposées qui attendent encore un clic sont posées en
          bandeau FIXE, juste au-dessus du volet des tâches : elles ne remontent
          plus avec les messages et leurs boutons restent sous les yeux. Sans
          proposition en attente, le bandeau ne rend rien. */}
      <BandeauPropositions messages={messages} />

      {barreDEcriture}
    </div>
  );
}

/**
 * La barre du nouveau départ. Elle tient sur une ligne : à gauche le lien qui
 * rouvre les échanges d'avant (rien n'est supprimé), à droite le bouton qui
 * coupe le fil.
 *
 * Le bouton est inactif tant que l'agent travaille : couper le fil
 * sous une réponse en cours lui ferait perdre le sien. Le brouillon en train
 * d'être écrit n'est jamais touché par ce geste.
 */
function BarreNouveauDepart({
  agent,
  messages,
  precedents,
  tout,
  onTout,
}: {
  agent: Agent | null;
  messages: Message[];
  precedents: number;
  tout: boolean;
  onTout: (valeur: boolean) => void;
}) {
  const [aConfirmer, setAConfirmer] = React.useState(false);
  const verdict = peutRepartir(agent, messages);

  const repartir = () => {
    if (!agent) return;
    onTout(false);
    void client.geste({ type: 'agent.reset', agentId: agent.id }, t('Repartir de zéro'));
  };

  return (
    /* Deux commandes posées PAR-DESSUS le fil : elles ne prennent plus de
       ligne à elles seules, et seul leur propre rectangle capte le doigt. */
    <div className="pointer-events-none flex w-full items-start gap-2">
      {precedents ? (
        <button
          type="button"
          onClick={() => onTout(!tout)}
          className="pointer-events-auto flex min-w-0 items-center gap-1 rounded border border-border bg-bg/85 px-1.5 py-0.5 text-[12.5px] text-faint backdrop-blur transition-colors hover:text-text"
        >
          <ChevronUp className={cn('h-3 w-3 shrink-0 transition-transform', tout && 'rotate-180')} />
          <span className="truncate">{tout ? t('Replier les échanges précédents') : libellePrecedents(precedents)}</span>
        </button>
      ) : null}

      <Tooltip label={verdict.ok ? t('Repartir sur une conversation neuve') : verdict.raison}>
        <button
          type="button"
          // Inactif, mais pas « désactivé » au sens du navigateur : un bouton
          // désactivé n'affiche plus son explication au survol, et on perdrait
          // la seule phrase qui dit pourquoi le geste est refusé.
          aria-disabled={!verdict.ok}
          onClick={() => verdict.ok && setAConfirmer(true)}
          className={cn(
            'pointer-events-auto ml-auto flex shrink-0 items-center gap-1 rounded border border-border bg-bg/85 px-1.5 py-0.5 text-[12.5px] text-muted backdrop-blur transition-colors',
            verdict.ok ? 'hover:border-text hover:bg-raised hover:text-text' : 'cursor-not-allowed opacity-40',
          )}
        >
          <RotateCcw className="h-3 w-3" />
          
{t('Repartir de zéro')}
</button>
      </Tooltip>

      <ConfirmDialog
        open={aConfirmer}
        title={t('Repartir sur une conversation neuve ?')}
        description={t('L\'agent oublie tout ce qui a été dit et repart à zéro : ses réponses redeviennent rapides et bien moins coûteuses. Les échanges précédents ne sont pas supprimés, ils restent consultables d\'un clic.')}
        confirmLabel={t('Repartir de zéro')}
        onConfirm={repartir}
        onClose={() => setAConfirmer(false)}
      />
    </div>
  );
}

/** Le repère qui annonce quel agent parle à partir d'ici. */
/**
 * LE SÉPARATEUR DE JOUR : un trait qui traverse toute la largeur du fil, la date
 * posée au milieu.
 *
 * Le trait est coupé DE PART ET D'AUTRE de la date plutôt que masqué par une
 * pastille de fond : le fil s'affiche tantôt dans la zone de droite, tantôt
 * dans le tiroir d'une carte, et ces deux fonds diffèrent — une pastille aurait
 * dû deviner lequel, et se serait vue sur l'autre.
 *
 * Le trait suit `--faint` et jamais `--border` : il porte une information, et
 * sur les thèmes plats `--border` ne dessine plus rien.
 */
function SeparateurDeJour({ date }: { date: number }) {
  return (
    <div className="flex items-center gap-2 py-1" data-separateur-jour="">
      <span className="h-px flex-1 bg-faint/30" aria-hidden />
      <span className="shrink-0 text-[12.5px] uppercase tracking-wide text-faint">
        {jourDuMessage(date)}
      </span>
      <span className="h-px flex-1 bg-faint/30" aria-hidden />
    </div>
  );
}

function SeparateurAgent({ titre }: { titre: string }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="text-[12.5px] uppercase tracking-wide text-faint">{titre}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/**
 * Le témoin de travail : un petit décroché, en retrait, collé au-dessus de la
 * barre d'écriture — on voit d'un coup d'œil si quelque chose tourne, quoi, et
 * depuis combien de temps.
 *
 * IL RESTE EN PLACE UNE FOIS LE TOUR REFERMÉ, dès que l'agent s'est annoncé une
 * liste de tâches : le même repère compact, à la même place, dit alors
 * « Liste des tâches — n/N faites » et s'ouvre au clic sur la liste complète.
 * L'ancienne barre pleine largeur (`VoletTaches`), posée à part entre le fil et
 * le champ de saisie, est retirée : la liste changeait de forme et de place
 * selon que l'agent travaillait ou non. Sans liste ET sans travail, le repère
 * disparaît toujours complètement.
 *
 * C'est aussi d'ici qu'on arrête l'agent : le bouton est posé sur la chose
 * qu'il arrête, plutôt que perdu dans la rangée d'outils de la barre d'écriture.
 *
 * Dans le tiroir d'une carte, il n'arrête QUE la tâche de cette carte : si
 * l'agent affiché appartient à une autre, pas de bouton du tout — mieux vaut
 * rien qu'un faux (`arretDeCarteAutorise`).
 */
function TravailEnCours({
  agent,
  messages,
  busy,
  cardId,
  sansListe,
}: {
  agent: Agent | null;
  messages: Message[];
  busy: boolean;
  /** Depuis le tiroir d'une carte : l'arrêt ne vaut que pour SA tâche. */
  cardId?: string;
  /** La liste vit DANS LE FIL (Studio) : le repère ne garde que le témoin de travail. */
  sansListe?: boolean;
}) {
  const state = useApp();
  // Le geste d'arrêt est le MÊME qu'en bas de la barre d'écriture : un seul
  // texte, donc le même contrôle, la même commande et la même confirmation.
  const arret = useArretAgent({ agent, cardId });
  // La liste des tâches se déplie depuis CETTE barre, et de nulle part
  // ailleurs. Le pli est retenu d'une fois sur l'autre (`usePliDesTaches`,
  // `todos.tsx`) : téléphone replié, ordinateur déplié, sauf choix contraire.
  const [listeOuverte, basculerListe] = usePliDesTaches();

  // Le temps écoulé avance tout seul, seconde par seconde.
  useSeconde(busy);

  const dernier = messages[messages.length - 1];
  // La liste complète ne se déplie que si l'agent en a annoncé une — un
  // agent qui n'avance que par étapes (steps) n'a rien de plus à montrer ici,
  // ces étapes restant visibles repliées dans le fil au-dessus.
  const todos = dernier?.todos;
  /*
   * LE CADRAGE NE GARDE PAS SA LISTE SOUS LES YEUX. L'agent léger qui discute
   * le besoin s'annonce lui aussi des sous-tâches (« lire la mémoire »,
   * « proposer un plan ») : une fois son tour rendu, elles restaient collées
   * au champ de saisie, en surcharge d'une conversation qui n'attend qu'une
   * réponse. Elles ne disent rien de plus que le texte juste au-dessus, et
   * couvrent la moitié du composeur. Pendant son tour, le témoin reste : c'est
   * la liste REFERMÉE qu'on retire, pas le signe qu'il travaille.
   */
  const todosDisponibles = !!todos?.length && agent?.role !== 'cadrage' && !sansListe;

  // Rien ne tourne et aucune liste à garder sous les yeux : le repère s'efface.
  if (!busy && !todosDisponibles) return null;

  const todoEnCours = dernier?.todos?.find((todo) => todo.state === 'running');
  const etapeEnCours = [...(dernier?.steps ?? [])].reverse().find((step) => step.state === 'running');
  /*
   * ARRÊTÉ SUR SA QUESTION : l'agent ne réfléchit plus, il attend. Son appel
   * d'outil `ask_user` ne rendra la main qu'une fois la réponse donnée, donc
   * aucune étape suivante ne tourne — le témoin doit le dire au lieu
   * d'afficher l'étape figée d'avant (`shared/src/attente-question.ts`).
   */
  //
   /* Une fois le tour refermé, il n'y a plus d'étape en cours à nommer : le
      repère dit alors le BILAN de la liste, exactement comme le faisait
      l'ancienne barre pleine largeur. */
  /*
   * LA RÉPONSE EST RENDUE, MAIS LE TOUR VIT ENCORE : le démon range (constat du
   * dépôt, fusion de la branche, compression du fil). Dire « Réflexion en
   * cours » serait faux — le moteur ne réfléchit plus —, et se taire ferait
   * croire que tout est fini alors que des commandes tournent.
   */
  const rangeLeTour =
    busy && agent?.tourVivantDepuis !== undefined && agent?.status !== 'running' && agent?.status !== 'starting';
  const quoi = !busy
    ? resumeDesTaches(todos!, { examen: estCarteDuRendezVousDeNuit(cardId ? state.cards[cardId] : undefined) })
    : agent?.attendReponse
      ? TEXTE_BARRE_EN_ATTENTE
      : rangeLeTour
        ? t('L’agent termine son tour…')
        : (todoEnCours?.label ?? etapeEnCours?.label ?? t('Réflexion en cours…'));

  // Le chronomètre et le compte « n/N » ne parlent que d'un travail EN COURS :
  // une fois le tour refermé, le compte est déjà dans la phrase ci-dessus, et
  // le temps n'avance plus.
  const temps = busy ? arret.temps : null;
  // Même décompte que le décroché d'une carte (`agent.todos`, mis à jour en
  // direct par le démon à chaque étape cochée) : « n/N » sur l'ensemble des
  // étapes prévues, pas seulement l'étape en cours. Silence tant qu'aucune
  // liste n'est encore connue.
  //
  // Un agent qui ne s'annonce jamais de liste de tâches (todos) mais AVANCE
  // par étapes d'exécution (`steps`, visibles repliées au-dessus sous
  // « Exécution de la tâche ») n'a alors AUCUN chiffre ici, alors que le
  // même compte est déjà affiché plus haut : on retombe donc sur les étapes
  // du dernier message quand aucune liste de tâches n'existe.
  const avancement = !busy
    ? null
    : agent?.todos && agent.todos.total > 0
      ? agent.todos
      : dernier?.steps && dernier.steps.length > 0
        ? { done: dernier.steps.filter((step) => step.state === 'done').length, total: dernier.steps.length }
        : null;

  // L'icône de gauche : la roue tourne tant que l'agent travaille ; une fois le
  // tour refermé, une coche BLEUE si tout est fait, sinon un point discret —
  // les mêmes repères que portait l'ancienne barre pleine largeur.
  const toutFait = todosDisponibles && todos!.every((todo) => todo.state === 'done');
  const icone = busy ? undefined : toutFait ? (
    <Check className="h-3 w-3 shrink-0 text-termine" />
  ) : (
    <CircleDot className="h-3 w-3 shrink-0 text-faint" />
  );

  return (
    <div
      data-temoin-reflexion
      /* C'est aussi, désormais, LE volet des tâches : un seul endroit, donc le
         même repère pour qui le cherche (scripts de vérification compris). */
      data-volet="taches"
      className={cn(
        // Aucune marge horizontale : posé dans le même conteneur que la zone
        // de saisie (même repli latéral), il en épouse exactement la largeur.
        'relative z-0 -mb-2 flex shrink-0 flex-col rounded-t-lg',
        // bg-bloc-etapes plutôt qu'un dégradé vers surface/0 : ce composeur vit
        // tantôt sur un fond bg-bg (hors carte), tantôt sur un fond bg-surface
        // (tiroir d'une carte), et un dégradé qui finit transparent se
        // confondait avec l'un comme avec l'autre. Un jeton DÉDIÉ, SOLIDE du
        // haut jusqu'en bas (entête et liste dépliée comprises), qui
        // contraste avec les deux fonds dans les douze palettes.
        'border border-b-0 border-border bg-bloc-etapes',
        'shadow-[inset_0_-6px_6px_-6px_rgba(0,0,0,0.35)]',
      )}
    >
      <div
        className={cn(
          'flex items-center gap-2 px-3 pt-1.5',
          // pb-4 (16px) compense le recouvrement de -mb-2 (8px) posé sur le
          // conteneur : il reste 8px d'air visible sous le texte avant que la
          // zone de saisie ne le recouvre, proche des 6px du pt-1.5 au-dessus
          // (pb-5 en laissait 12, visiblement plus que le haut ; pb-3 n'en
          // laissait que 4, collé au bord) — cette marge ne vaut que pour la
          // DERNIÈRE ligne visible : une fois la liste dépliée sous elle,
          // c'est elle qui la porte à la place.
          todosDisponibles && listeOuverte ? 'pb-1.5' : 'pb-4',
        )}
      >
        {/* « CETTE CARTE TRAVAILLE » : le même point que les entêtes de
            colonnes (`IndicateurActivite`), à la place du personnage animé.
            Un seul dessin pour les deux endroits — deux mouvements écrits
            séparément finissent toujours par diverger. Rien ne s'affiche
            quand le tour est refermé : l'absence est le signal du repos. */}
        <IndicateurActivite cartesAuTravail={busy ? 1 : 0} data-avatar-tiroir className="ml-0.5 mr-1" />
        {todosDisponibles ? (
          <button
            type="button"
            aria-expanded={listeOuverte}
            onClick={basculerListe}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <InfoTravail quoi={quoi} avancement={avancement} temps={temps} icone={icone} />
            {listeOuverte ? (
              <ChevronDown className="h-3 w-3 shrink-0 text-faint" />
            ) : (
              <ChevronUp className="h-3 w-3 shrink-0 text-faint" />
            )}
          </button>
        ) : (
          <InfoTravail quoi={quoi} avancement={avancement} temps={temps} icone={icone} />
        )}
      </div>

      {todosDisponibles && listeOuverte ? (
        <div className="pb-4">
          <CorpsListeTaches todos={todos} streaming={busy} maintenant={Date.now()} />
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Les réglages de l'agent de la carte                                 */
/* ------------------------------------------------------------------ */

/**
 * Un identifiant technique n'apprend rien : on cherche son libellé dans le
 * catalogue des moteurs.
 *
 * Ce qui SERVIRA (`source: 'prevu'`) suit la même règle que le lancement : un
 * modèle retiré par la mise à jour du moteur est montré sous sa version
 * actuelle, de la même famille (`modeleActuel`) — c'est elle qui partira.
 * Ce qui A SERVI (`reel`) est une trace : on retombe alors sur l'identifiant
 * brut s'il n'est plus au catalogue, sans jamais le réécrire.
 */
function libellesDuRun(
  engines: EngineInfo[],
  vu: Pick<ReglagesCarte, 'engine' | 'model' | 'thinking' | 'source'>,
) {
  const moteur = engines.find((e) => e.id === vu.engine);
  const modele =
    vu.source === 'reel' ? moteur?.models.find((m) => m.id === vu.model) : moteur ? modeleActuel(moteur, vu.model) : undefined;
  const niveau =
    modele?.thinking?.find((t) => t.id === vu.thinking) ?? (vu.source === 'reel' ? undefined : modele?.thinking?.[0]);
  return {
    moteur: moteur?.label ?? vu.engine ?? '—',
    modele: modele?.label ?? vu.model ?? '—',
    reflexion: niveau?.label ?? vu.thinking ?? '—',
  };
}

/**
 * Calcule une fois ce qui vaut pour une carte — figé ou non, avec quels
 * libellés — pour les deux affichages qui en dépendent : le bloc fixe une
 * fois le travail démarré (`ReglagesAgent`), et la bulle du fil avant
 * lancement (`BulleReglagesAModifier`). Sans carte, rend `vu` à `null` : les
 * deux affichages restent des hooks appelés à chaque rendu, jamais
 * conditionnels.
 */
function useReglagesCarte(card: Card | undefined) {
  const state = useApp();

  /*
   * Ce qui a SERVI, c'est l'agent d'EXÉCUTION, pas l'analyse : celle-ci tourne
   * souvent sur un autre modèle, et l'afficher ferait croire que la carte a été
   * traitée avec lui.
   */
  const execution = React.useMemo(
    () =>
      card
        ? Object.values(state.agents)
            .filter((item) => item.cardId === card.id && item.role === 'task')
            .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
        : null,
    [state.agents, card?.id],
  );

  const vu = card
    ? reglagesDeLaCarte({
        colonne: card.column,
        carte: card.run,
        agent: execution
          ? { engine: execution.run.engine, model: execution.run.model, thinking: execution.run.thinking, compte: execution.account }
          : undefined,
        compteMesure: card.consumption?.account,
        decisionValidee: comprehensionValideePourLaVersionCourante(card.parcours),
      })
    : null;

  const libelles = vu ? libellesDuRun(state.engines, vu) : null;

  return { vu, libelles };
}

/**
 * AVEC QUOI CETTE CARTE TOURNE — LA CONFIGURATION, RÉDUITE ET EN LECTURE
 * SEULE. Elle prend la place de la carte de configuration DÈS QUE LA PREMIÈRE
 * DEMANDE EST PARTIE : l'agent d'une tâche ne se rechoisit plus en cours de
 * route, sinon le parcours affiché sous elle mentirait sur ce qui a servi.
 *
 * ELLE N'A AUCUN GESTE D'ÉCRITURE : ni menu, ni sélecteur, seulement un
 * tiroir qui MONTRE. C'est par là que la lecture seule est garantie — pas par
 * un champ désactivé qu'on pourrait rouvrir.
 *
 * Quatre étiquettes courtes sur UNE ligne qui se replie : moteur, modèle,
 * réflexion, compte — c'est ce qui permet de comprendre après coup pourquoi
 * une carte s'est bien ou mal passée.
 */
function ReglagesAgent({
  card,
  vu,
  libelles,
  ouvert,
  onOuvert,
  ancre,
}: {
  card: Card;
  vu: ReglagesCarte;
  libelles: { moteur: string; modele: string; reflexion: string };
  /** L'ouverture du tiroir, partagée avec l'icône de l'entête (`Chat`). */
  ouvert: boolean;
  onOuvert: (ouvert: boolean) => void;
  /** Le bloc lui-même, suivi pour savoir s'il est encore à l'écran. */
  ancre?: (noeud: HTMLElement | null) => void;
}) {
  const state = useApp();
  /*
   * La part de quota réellement consommée par cette carte, somme de ses lignes
   * de consommation. Elle vit dans la table `usage`, pas sur la carte : on la
   * demande au serveur dès que la configuration est figée. Une carte sans
   * relevé rend deux zéros — on n'affiche alors rien, pas un zéro trompeur.
   */
  const [quota, setQuota] = React.useState<{ quota5h: number; quotaSemaine: number } | null>(null);
  React.useEffect(() => {
    let vivant = true;
    setQuota(null);
    client
      .call({ type: 'card.quota', cardId: card.id })
      .then((data) => {
        if (vivant) setQuota({ quota5h: data.quota5h ?? 0, quotaSemaine: data.quotaSemaine ?? 0 });
      })
      .catch(() => {});
    return () => {
      vivant = false;
    };
  }, [card.id]);
  const quotaVu = quota && (quota.quota5h > 0 || quota.quotaSemaine > 0) ? quota : null;
  const setOuvert = onOuvert;
  /* Tant que le plan n'est pas validé, le tiroir ÉCRIT : une ligne par réglage
     ouvre directement sa liste, comme la carte de configuration. */
  const [ouvrirSur, setOuvrirSur] = React.useState<'moteur' | 'modele' | 'reflexion' | 'compte' | undefined>(undefined);
  const choisir = choixDeLaCarte(card, state.engines);
  const moteurChoisi = resoudreRun(state.engines, card.run).engine;
  const comptes = (state.quotas ?? []).filter((c) => c.engine === moteurChoisi?.id && !c.disabled);
  const compteChoisi = card.run?.account ? comptes.find((c) => c.id === card.run?.account) : undefined;

  /*
   * LE MÊME BLOC DIT DEUX CHOSES DIFFÉRENTES selon le moment, et il ne doit
   * jamais mentir : tant que rien n'a tourné, ce sont les réglages QUI
   * SERVIRONT ; une fois le travail parti, ceux QUI ONT SERVI.
   */
  const titre = vu.modifiable
    ? t('Configuration de l’agent')
    : vu.source === 'reel'
      ? t('Réglages qui ont servi')
      : t('Configuration de l’agent');
  /* Le cadenas dit toujours POURQUOI — et ne paraît que quand c'est figé. */
  const raison = vu.raison ? t(vu.raison) : '';

  return (
    <>
      {/* Réduit à un résumé : le détail (Moteur / Modèle / Niveau / Compte /
          Quotas, chacun avec son libellé au-dessus) ne s'affiche qu'au clic,
          dans un tiroir en colonne verticale — la grille se cassait sur
          téléphone. Sous le titre, UNE LIGNE PAR RÉGLAGE : le libellé à
          gauche, la valeur à droite, qui revient à la ligne au lieu d'être
          coupée (les valeurs bout à bout, séparées par « · », se lisaient mal
          sur téléphone). Sans compte imposé, la ligne dit « Automatique »,
          jamais un tiret. Aucun `line-clamp` ici : un texte replié ne se pose
          jamais dans un `button`. */}
      <button
        type="button"
        ref={ancre}
        onClick={() => setOuvert(true)}
        data-reglages-figes={vu.modifiable ? undefined : ''}
        data-reglages-agent={vu.modifiable ? 'modifiable' : 'fige'}
        className="flex w-full flex-col gap-0.5 rounded-md border border-border bg-raised px-2.5 py-2 text-left transition-colors hover:bg-hover"
      >
        <span className="flex w-full min-w-0 items-center gap-1.5 text-[11px] uppercase tracking-wide text-faint">
          <Cpu className="h-3 w-3 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{titre}</span>
          {vu.modifiable ? null : <Lock className="h-2.5 w-2.5 shrink-0" title={raison} />}
          <ChevronRight className="h-3 w-3 shrink-0" />
        </span>
        <span className="mt-0.5 flex w-full min-w-0 flex-col gap-0.5" data-reglages-valeurs>
          {[
            [t('Moteur'), libelles.moteur],
            [t('Modèle'), libelles.modele],
            [t('Réflexion'), libelles.reflexion],
            [t('Compte'), vu.compte ?? t('Automatique')],
          ].map(([nom, valeur]) => (
            <span key={nom} data-reglage-ligne={nom} className="flex w-full min-w-0 items-baseline justify-between gap-3">
              <span className="shrink-0 text-[12.5px] text-faint">{nom}</span>
              <span className="min-w-0 break-words text-right text-[12.5px] font-medium text-text">{valeur}</span>
            </span>
          ))}
        </span>
      </button>

      <Drawer open={ouvert} onClose={() => setOuvert(false)}>
        <header className="flex shrink-0 items-center gap-1.5 px-3 pb-2">
          <Cpu className="h-3.5 w-3.5 shrink-0 text-accent" />
          <DialogTitle className="min-w-0 flex-1 truncate">{titre}</DialogTitle>
          {vu.modifiable ? (
            <BulleInfo>{t('Modifiable jusqu’à la validation de la compréhension : le réglage choisi à ce moment servira au travail.')}</BulleInfo>
          ) : (
            <Lock className="h-3 w-3 shrink-0 text-faint" title={raison} />
          )}
        </header>

        {vu.modifiable ? (
          <ZoneDefilement className="flex flex-col gap-1 px-3 pb-4" data-tiroir-reglages="modifiable">
            <LigneDeConfiguration nom={t('Moteur')} valeur={libelles.moteur} onClick={() => setOuvrirSur('moteur')} />
            <LigneDeConfiguration nom={t('Modèle')} valeur={libelles.modele} onClick={() => setOuvrirSur('modele')} />
            <LigneDeConfiguration nom={t('Réflexion')} valeur={libelles.reflexion} onClick={() => setOuvrirSur('reflexion')} />
            {comptes.length > 1 ? (
              <LigneDeConfiguration
                nom={t('Compte')}
                valeur={compteChoisi?.label ?? t('Automatique')}
                onClick={() => setOuvrirSur('compte')}
              />
            ) : null}
            <RunSelectors
              engines={state.engines}
              choix={card.run}
              onSelect={choisir}
              pleineLargeur
              comptes={state.quotas}
              masquerDeclencheur
              ouvertControle={ouvrirSur !== undefined}
              onOuvertControleChange={(o) => setOuvrirSur(o ? (ouvrirSur ?? 'moteur') : undefined)}
              ouvrirSur={ouvrirSur}
            />
          </ZoneDefilement>
        ) : (
        <ZoneDefilement className="flex flex-col gap-3 px-3 pb-4" data-tiroir-reglages="lecture">
          <EtiquetteColonne nom={t('Moteur')} valeur={libelles.moteur} />
          <EtiquetteColonne nom={t('Modèle')} valeur={libelles.modele} />
          <EtiquetteColonne nom={t('Réflexion')} valeur={libelles.reflexion} />
          <EtiquetteColonne nom={t('Compte')} valeur={vu.compte ?? '—'} />

          {/* La part de quota dépensée par cette carte. Rien quand aucun
              relevé n'existe : un zéro ferait croire à une mesure. */}
          {quotaVu ? (
            <>
              <EtiquetteColonne nom={t('Quota 5 h consommé')} valeur={partQuota(quotaVu.quota5h)} />
              <EtiquetteColonne nom={t('Quota semaine consommé')} valeur={partQuota(quotaVu.quotaSemaine)} />
            </>
          ) : null}
        </ZoneDefilement>
        )}
      </Drawer>
    </>
  );
}

/**
 * LA CARTE DE CONFIGURATION D'UNE TÂCHE NEUVE — le PREMIER geste du flux.
 *
 * L'utilisateur clique « Nouvelle tâche » : avant de dire ce qu'il veut, il
 * choisit AVEC QUOI ce sera fait — moteur, modèle, niveau de réflexion, et le
 * compte quand plusieurs se disputent le travail. Rien de tout cela ne passe
 * par un moteur : le catalogue est déjà à l'écran, la carte s'affiche seule et
 * ne coûte pas un jeton.
 *
 * Elle porte les valeurs EN CLAIR, une ligne par réglage, et chaque ligne
 * ouvre DIRECTEMENT la liste de ce réglage (`ouvrirSur`) — jamais un aperçu
 * qu'il faudrait re-cliquer. Le choix écrit sur la CARTE, qui est ce que le
 * lancement lira, exactement comme la bulle compacte qui prendra sa place dès
 * le premier message (`BulleReglagesAModifier`, juste en dessous).
 */
function CarteDeConfiguration({
  card,
  libelles,
}: {
  card: Card;
  libelles: { moteur: string; modele: string; reflexion: string };
}) {
  const state = useApp();
  const [ouvrirSur, setOuvrirSur] = React.useState<
    'moteur' | 'modele' | 'reflexion' | 'compte' | undefined
  >(undefined);
  const ouvert = ouvrirSur !== undefined;

  const choisir = choixDeLaCarte(card, state.engines);

  /* La ligne « Compte » ne paraît que si plusieurs comptes du moteur retenu
     se disputent vraiment le travail — sinon le choix automatique suffit. */
  const moteurChoisi = resoudreRun(state.engines, card.run).engine;
  const comptes = (state.quotas ?? []).filter((c) => c.engine === moteurChoisi?.id && !c.disabled);
  const compte = card.run?.account ? comptes.find((c) => c.id === card.run?.account) : undefined;

  return (
    <div data-carte-configuration className="rounded-lg border border-border bg-raised px-3 py-3">
      <div className="flex items-center gap-1.5 text-[12.5px] uppercase tracking-wide text-faint">
        <Cpu className="h-3 w-3 shrink-0" />
        {t('Configuration de l’agent')}
      </div>
      <p className="flex items-center gap-1 mt-1 text-[14.5px] font-medium leading-relaxed text-text">{t(MOT_CONFIGURATION.titre)}<BulleInfo cote="start">{t(MOT_CONFIGURATION.indice)}</BulleInfo></p>

      <div className="mt-2.5 flex flex-col gap-1">
        <LigneDeConfiguration nom={t('Moteur')} valeur={libelles.moteur} onClick={() => setOuvrirSur('moteur')} />
        <LigneDeConfiguration nom={t('Modèle')} valeur={libelles.modele} onClick={() => setOuvrirSur('modele')} />
        <LigneDeConfiguration
          nom={t('Réflexion')}
          valeur={libelles.reflexion}
          onClick={() => setOuvrirSur('reflexion')}
        />
        {comptes.length > 1 ? (
          <LigneDeConfiguration
            nom={t('Compte')}
            valeur={compte?.label ?? t('Automatique')}
            onClick={() => setOuvrirSur('compte')}
          />
        ) : null}
      </div>

      {/* Les listes elles-mêmes : le même composant que partout ailleurs, sans
          son bouton d'entrée — ce sont les lignes ci-dessus qui l'ouvrent. */}
      <RunSelectors
        engines={state.engines}
        choix={card.run}
        onSelect={choisir}
        pleineLargeur
        comptes={state.quotas}
        masquerDeclencheur
        ouvertControle={ouvert}
        onOuvertControleChange={(o) => setOuvrirSur(o ? (ouvrirSur ?? 'moteur') : undefined)}
        ouvrirSur={ouvrirSur}
      />
    </div>
  );
}

/** Une ligne de la carte de configuration : le nom, la valeur, une flèche. */
export function LigneDeConfiguration({
  nom,
  valeur,
  onClick,
}: {
  nom: string;
  valeur: string;
  /** L'état du mode plan, lu tel quel par les scripts de vérification. */
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-ligne-configuration={nom}
      className="flex w-full items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-left transition-colors hover:border-accent/50"
    >
      <span className="shrink-0 text-[12.5px] text-faint">{nom}</span>
      <span data-valeur={valeur} className="min-w-0 flex-1 truncate text-[14.5px] font-medium text-text">
        {valeur}
      </span>
      <ChevronRight className="h-3 w-3 shrink-0 text-faint" />
    </button>
  );
}

/**
 * ÉCRIRE LE RÉGLAGE SUR LA CARTE — un seul geste, partagé par la carte de
 * configuration et la bulle compacte. Le serveur tranche la cascade : on lui
 * donne le souhait, il rend la combinaison qui existe vraiment.
 */
function choixDeLaCarte(card: Card, engines: EngineInfo[]) {
  return async (patch: Parameters<typeof RunSelectors>[0]['choix'] & object) => {
    const souhait: RunChoix = patch.engine ? { engine: patch.engine } : { ...card.run, ...patch };
    const retenu = resoudreRun(engines, souhait);
    if (!retenu.engine) return;
    try {
      await client.call({
        type: 'card.update',
        id: card.id,
        patch: {
          run: {
            ...card.run,
            engine: retenu.engine.id,
            model: retenu.model?.id,
            thinking: retenu.thinking?.id ?? 'none',
            account: souhait.account,
            // Un choix fait à l'écran l'emporte sur le niveau du cadrage.
            niveau: undefined,
          },
        },
      });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('réglage impossible'));
    }
  };
}

/**
 * Une part de quota, en clair : « 2,4 % » de la fenêtre. Sous un dixième de
 * pour-cent, on ne prétend pas à la décimale — « moins de 0,1 % » dit le vrai.
 */
function partQuota(part: number): string {
  if (part > 0 && part < 0.1) return t('moins de 0,1 %');
  return `${part.toLocaleString(formatRegional(), { maximumFractionDigits: 1 })} %`;
}

/** Une étiquette courte : le nom en gris pâle, la valeur juste après. */
function Etiquette({ nom, valeur }: { nom: string; valeur: string }) {
  return (
    <span className="flex min-w-0 items-baseline gap-1">
      <span className="shrink-0 text-[12.5px] text-faint">{nom}</span>
      <span className="truncate font-medium text-text">{valeur}</span>
    </span>
  );
}

/** Une étiquette en colonne : le libellé au-dessus, la valeur en dessous —
 * le détail du tiroir « Réglages qui ont servi », une ligne par réglage. */
function EtiquetteColonne({ nom, valeur }: { nom: string; valeur: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[12.5px] uppercase tracking-wide text-faint">{nom}</span>
      <span className="text-[14.5px] font-medium text-text">{valeur}</span>
    </div>
  );
}
