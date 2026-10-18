import * as React from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Cpu,
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
  barreDuCahier,
  estVoletDuCahier,
  etapeCouranteDuCahier,
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
  estUneAide,
  carteEnPause,
} from '@beluga/shared';
import {
  BulleInfo,
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  EmptyState,
  Tooltip,
  ZoneDefilement,
  ouvertureAuClic,
} from '@/components/ui';
import { IndicateurActivite } from '@/components/indicateur-activite';
import { EntreesDeReglages, RunSelectors, resoudreRun, type ReglageDeRun, type RunChoix } from '@/components/run-selectors';
import { BoutonReglagesAgent } from '@/components/bouton-reglages-agent';
import { MessageView } from '@/components/message-view';
import { Composer } from '@/components/composer';
import { BandeDesCaptures, useGalerieDesCaptures } from '@/components/captures-du-flux';
import { ANCRE_DU_DEPLOIEMENT, FluxEnPoints, type OuvertureDemandee } from '@/components/flux-en-points';
import { carteDeSuivi } from '@/lib/carte-de-suivi';
import { BarreDEtapes } from '@/components/barre-etapes';
import { BandeauCahierDesCharges } from '@/components/cahier-des-charges';
import { BarreDAction, PanneauDeDecision } from '@/components/parcours-carte';
import { useArretAgent } from '@/components/arret-agent';
import { InfoTravail } from '@/components/info-travail';
import { CorpsListeTaches, resumeDesTaches, usePliDesTaches } from '@/components/todos';
import { BandeauPropositions } from '@/components/propositions';
import { SilhouetteConversation } from '@/components/silhouettes';
import { client } from '@/lib/client';
import { quandLEcranEstRegarde } from '@/lib/ecran-regarde';
import { useApp, useCanal } from '@/lib/use-app';
import {
  ContexteTexteDuChamp,
  ContexteTextesEnvoyes,
  creerTexteDuChamp,
  ligneDansLeTexte,
  useTextesEnvoyes,
} from '@/lib/texte-du-champ';
import { cn, duration, jourDuMessage } from '@/lib/utils';
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
  reponsesProposees,
  libelleDuChamp,
  avancementDansLeFil,
  enTeteDuFil,
  depot,
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
  /**
   * UN EN-TÊTE QUI DÉFILE AVEC LE FIL (conversation sans carte seulement). Le
   * volet d'un site surveillé y pose son état — adresse, WordPress, frise — :
   * tout le volet défile alors d'un seul tenant, et seule la barre d'écriture
   * reste fixe. Fourni, le fil s'ouvre EN HAUT (sur cet état) au lieu du
   * dernier message, et redescend dès qu'on y envoie un message.
   */
  enTeteDuFil?: React.ReactNode;
  /** Un texte à écrire dans le champ de saisie, sans l'envoyer (chaque `nonce` neuf est un nouveau dépôt). */
  depot?: { texte: string; nonce: number } | null;
}) {
  const state = useApp();
  /* L'état du lien : il éteint les gestes du parcours au lieu de les laisser
     décider sur ce qui était vrai avant la coupure. */
  const canal = useCanal();
  /* LE TEXTE DU CHAMP D'ÉCRITURE DE CETTE CONVERSATION, tenu hors de l'état du
     fil : la barre d'écriture l'y dépose à chaque frappe, et les idées à
     cocher d'un compte rendu y lisent leur case (`web/src/lib/texte-du-champ.ts`). */
  const [champ] = React.useState(creerTexteDuChamp);
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

  /* UN TEXTE DÉPOSÉ PAR L'ÉCRAN QUI PORTE CETTE CONVERSATION (le Studio : « Appliquer » un style) : même chemin que
     le refus d'un plan — il s'ajoute au champ, sans rien envoyer. */
  React.useEffect(() => {
    if (depot) ecrireDansLeChamp(depot.texte);
  }, [depot]);

  const conversation = cardId ? state.cardMessages[cardId] : undefined;
  const messages = cardId
    ? (conversation?.messages ?? [])
    : agent
      ? (state.messages[agent.id] ?? [])
      : [];
  /* LES MESSAGES DÉJÀ PARTIS : une idée à cocher dont la ligne y figure reste
     cochée après l'envoi (`useIdeeEnvoyee`). La liste ne change que lorsqu'un
     message part, jamais à chaque signe de la réponse qui s'écrit. */
  const textesEnvoyes = useTextesEnvoyes(messages);
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
   * LES IMAGES DE L'AGENT, tenues ICI et plus dans le flux : ce que ses étapes
   * ont regardé (`RunStep.capture`) et les pièces image de SES messages — jamais
   * celles de l'utilisateur (`capturesDuFlux`). La bande qui les montre est
   * collée au-dessus de la barre d'écriture, hors de la zone qui défile ; le
   * flux ouvre ses vignettes dans la même galerie (`OuvrirUneCapture`). Sans
   * carte, les listes sont vides et rien ne se demande.
   */
  const messagesDeLaCarte = conversation?.messages;
  const { etapesDesCaptures, idsDesPieces } = React.useMemo(() => {
    const deLAgent = (messagesDeLaCarte ?? []).filter((m) => m.role === 'assistant');
    return {
      etapesDesCaptures: deLAgent.flatMap((m) => m.steps.filter((step) => step.capture)),
      idsDesPieces: [...new Set(deLAgent.flatMap((m) => m.attachments))],
    };
  }, [messagesDeLaCarte]);
  const galerieDesCaptures = useGalerieDesCaptures(etapesDesCaptures, idsDesPieces, projectId);
  /*
   * LA CONFIGURATION S'OUVRE EN MENU, SOUS LE BOUTON QU'ON A CLIQUÉ : le bloc
   * du point « Configuration » a le sien, et le bouton de la barre d'écriture
   * (`reglages` du `Composer`) aussi — deux boutons, un même contenu
   * (`MenuDesReglagesDeLaCarte`). Le bouton de la barre d'écriture est
   * TOUJOURS là : il ne dépend plus du défilement du fil (demande du
   * 15/10/2026), donc plus rien à suivre ici.
   */
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
      enPause: carteEnPause(carte?.scheduling),
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
      carte?.scheduling?.suspendu,
      carte?.scheduling?.enPause,
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
          /* SUSPENDUE À LA MAIN : le point « Travail » reste neutre et se reprend. */
          enPause: contexteDuParcours.enPause,
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
      contexteDuParcours.enPause,
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
  /* LE VOLET DU CAHIER DES CHARGES a ses trois étapes à lui (`barreDuCahier`),
     et ni barre d'écriture ni bouton de lancement : on y répond dans le
     panneau de décision (`estVoletDuCahier`). */
  const voletDuCahier = estVoletDuCahier(carte);
  const cahier = carte?.cahierDesCharges;
  const segments = React.useMemo(
    () => (cahier ? barreDuCahier(cahier) : barreDeSuivi(points, suivi)),
    [cahier, points, suivi],
  );
  const etapeCourante = cahier ? etapeCouranteDuCahier(cahier) : segmentActifDeSuivi(suivi);
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
    !chargement && !envoiLocal && messages.length === 0 && reglagesCarte.vu?.modifiable === true &&
    /* Le cahier des charges démarre SEUL à sa naissance : rien à configurer,
       son volet montre d'emblée ses étapes et son bandeau. */
    !estVoletDuCahier(carte);
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
  /** Jusqu'à quand un message neuf glisse vers le bas : on ne coupe pas son élan. */
  const glisseJusqua = React.useRef(0);
  const avecEnTete = Boolean(enTeteDuFil) && !(carte && cardId);

  /**
   * Jusqu'à quand un défilement du fil est le NÔTRE (glissé d'un message neuf,
   * recollage au bas) : ses événements « scroll » ne disent rien de l'intention
   * du lecteur et ne doivent ni couper ni rallumer le suivi.
   */
  const defilementDeNousJusqua = React.useRef(0);
  const marquerNotreDefilement = (ms: number) => {
    defilementDeNousJusqua.current = Date.now() + ms;
  };

  /*
   * LE LECTEUR QUI REMONTE COUPE LE SUIVI AU GESTE, pas au constat. Le seuil
   * « en bas » est serré (24 px) : une petite remontée, au doigt, à la molette
   * ou au clavier, suffit à dire « je lis plus haut ». Le suivi ne reprend que
   * lorsqu'on est revenu réellement en bas.
   */
  React.useEffect(() => {
    const fil = filRef.current;
    if (!fil) return;
    const EN_BAS_PX = 24;
    const noter = () => {
      if (Date.now() < defilementDeNousJusqua.current) return;
      suit.current = fil.scrollHeight - fil.scrollTop - fil.clientHeight <= EN_BAS_PX;
    };
    const remonte = () => {
      suit.current = false;
      defilementDeNousJusqua.current = 0;
    };
    let toucheY = 0;
    const toucheDebut = (e: TouchEvent) => {
      toucheY = e.touches[0]?.clientY ?? 0;
    };
    const toucheBouge = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY ?? toucheY;
      // Le doigt descend : le contenu remonte, on relit plus haut.
      if (y - toucheY > 2) remonte();
      toucheY = y;
    };
    const molette = (e: WheelEvent) => {
      if (e.deltaY < 0) remonte();
    };
    const touche = (e: KeyboardEvent) => {
      if (e.key === 'PageUp' || e.key === 'ArrowUp' || e.key === 'Home') remonte();
    };
    fil.addEventListener('scroll', noter, { passive: true });
    fil.addEventListener('wheel', molette, { passive: true });
    fil.addEventListener('touchstart', toucheDebut, { passive: true });
    fil.addEventListener('touchmove', toucheBouge, { passive: true });
    fil.addEventListener('keydown', touche);
    return () => {
      fil.removeEventListener('scroll', noter);
      fil.removeEventListener('wheel', molette);
      fil.removeEventListener('touchstart', toucheDebut);
      fil.removeEventListener('touchmove', toucheBouge);
      fil.removeEventListener('keydown', touche);
    };
  }, [cardId, agent?.id, configurationOuverte, carte && cardId ? 'parcours' : 'fil']);

  React.useEffect(() => {
    const cle = cardId ?? agent?.id;
    // Ouverture d'une conversation : on se pose tout en bas, sans animation.
    if (ouvertePour.current !== cle && messages.length) {
      ouvertePour.current = cle;
      nombreVu.current = messages.length;
      // Sous un en-tête qui défile, on s'ouvre sur lui : c'est ce que le volet montre d'abord.
      if (avecEnTete) {
        suit.current = false;
        if (filRef.current) filRef.current.scrollTop = 0;
        return;
      }
      suit.current = true;
      marquerNotreDefilement(150);
      bottomRef.current?.scrollIntoView({ block: 'end' });
      return;
    }
    // UN NOUVEAU MESSAGE ARRIVE EN GLISSANT ; UN TEXTE QUI S'ALLONGE RESTE
    // COLLÉ. Pendant qu'un agent écrit, un glissé doux relancé à chaque
    // morceau courait derrière le texte et finissait par décrocher du bas.
    const nouveauMessage = messages.length !== nombreVu.current;
    nombreVu.current = messages.length;
    // Ouvert sur l'en-tête, le fil redescend dès qu'on y écrit soi-même.
    if (avecEnTete && nouveauMessage && messages[messages.length - 1]?.role === 'user') suit.current = true;
    if (suit.current) {
      if (nouveauMessage) glisseJusqua.current = Date.now() + 450;
      marquerNotreDefilement(nouveauMessage ? 600 : 150);
      bottomRef.current?.scrollIntoView({ behavior: nouveauMessage ? 'smooth' : 'instant', block: 'end' });
    }
  }, [cardId, agent?.id, messages.length, messages[messages.length - 1]?.content]);

  /*
   * EN BAS, ON RESTE EN BAS — QUOI QU'IL S'AJOUTE (demande du 11/10/2026).
   *
   * Le suivi ci-dessus ne se rejouait que pour un message : nombre et texte du
   * dernier. Or le fil bouge pour bien d'autres raisons, qui ne passent par
   * aucun des deux — la liste de tâches qui s'allonge, un bloc du parcours qui
   * se déplie, une image qui arrive, le journal qui se charge ; et, SOUS lui,
   * le champ d'écriture qui grandit, ses pièces jointes, le bandeau d'activité,
   * le panneau de décision ou le clavier du téléphone, qui lui prennent de la
   * hauteur. Dans les deux cas le bas du fil passait sous le pli sans qu'aucun
   * défilement n'ait eu lieu : on se croyait en bas, on n'y était plus, et les
   * vignettes du dernier message devenaient hors d'atteinte.
   *
   * On surveille donc la TAILLE du fil et celle de son contenu : tant que le
   * lecteur n'est pas remonté (`suit`), chaque changement recolle le fil à son
   * bas, d'un coup et sans glissé — un glissé relancé à chaque pixel courrait
   * derrière le texte. Remonté lire, il ne bouge pas : `suit` est faux, et rien
   * ne le tire.
   */
  React.useEffect(() => {
    const fil = filRef.current;
    if (!fil || typeof ResizeObserver === 'undefined') return;
    let image = 0;
    let minuteur = 0;
    const recoller = () => {
      if (!suit.current) return;
      /* Un message neuf est en train de glisser : on le laisse arriver, puis on
         vérifie qu'il est bien posé. */
      const elan = glisseJusqua.current - Date.now();
      if (elan > 0) {
        window.clearTimeout(minuteur);
        minuteur = window.setTimeout(recoller, elan + 30);
        return;
      }
      if (image) return;
      image = window.requestAnimationFrame(() => {
        image = 0;
        if (suit.current && fil.scrollHeight - fil.scrollTop - fil.clientHeight > 1) {
          marquerNotreDefilement(150);
          fil.scrollTop = fil.scrollHeight;
        }
      });
    };
    const tailles = new ResizeObserver(recoller);
    const surveiller = () => {
      tailles.disconnect();
      tailles.observe(fil);
      for (const enfant of Array.from(fil.children)) tailles.observe(enfant);
    };
    surveiller();
    /* Un bloc ajouté ou retiré du fil : on reprend la liste de ses enfants. */
    const enfants = new MutationObserver(() => {
      surveiller();
      recoller();
    });
    enfants.observe(fil, { childList: true });
    return () => {
      tailles.disconnect();
      enfants.disconnect();
      window.cancelAnimationFrame(image);
      window.clearTimeout(minuteur);
    };
    /* Le fil change d'élément quand la carte passe de sa configuration à son
       parcours : l'effet se repose alors sur le nouveau. */
  }, [cardId, agent?.id, configurationOuverte, carte && cardId ? 'parcours' : 'fil']);

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
        {/* Les idées à cocher d'un compte rendu lisent leur case dans le champ
            d'écriture de CETTE conversation (`ContexteTexteDuChamp`). */}
        <ContexteTexteDuChamp.Provider value={champ}>
        <ContexteTextesEnvoyes.Provider value={textesEnvoyes}>
        <MessageView
          message={message}
          allMessages={messages}
          projectId={projectId}
          onToggleEvolution={toggleEvolution}
          onToggleAll={toggleAll}
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
        </ContexteTextesEnvoyes.Provider>
        </ContexteTexteDuChamp.Provider>
      </div>
    );
  };

  /*
   * UNE SUGGESTION COCHÉE S'ÉCRIT DANS LE CHAMP, PAS AU-DESSUS. Elle vivait
   * dans une pastille détachée, posée entre le fil et la barre d'écriture :
   * on pouvait la retirer, jamais la compléter ni la copier. Elle est donc
   * déposée dans le champ de saisie lui-même, sur sa propre ligne — et un
   * second clic reprend cette ligne, à condition que personne ne l'ait
   * retouchée (`texteApresRetrait`).
   *
   * LE CLIC BASCULE D'APRÈS LE CHAMP, PAS D'APRÈS UN SOUVENIR. Une liste des
   * idées « retenues » était tenue ici, à côté du champ : effacer la ligne à
   * la main ne la vidait pas, et le clic suivant tentait de retirer une ligne
   * qui n'y était plus. La question se pose désormais au texte du champ
   * lui-même (`champ`), celui que lisent aussi les cases à cocher.
   */
  const deposerDansLeChamp = (texte: string, retirer: boolean) =>
    setAEcrire((avant) => ({ texte, retirer, nonce: (avant?.nonce ?? 0) + 1 }));

  const toggleEvolution = (text: string) => {
    /* UNE IDÉE RETENUE S'ÉCRIT EN LIGNE DE LISTE, avec son tiret : c'est ce
       qui la distingue de la phrase en cours d'écriture, et c'est la forme
       qu'attend l'agent qui la lira (`ligneDeSuggestion`). */
    const ligne = ligneDeSuggestion(text);
    deposerDansLeChamp(ligne, ligneDansLeTexte(champ.lire(), ligne));
  };

  const toggleAll = (items: string[]) => {
    const lignes = items.map(ligneDeSuggestion).filter(Boolean);
    const toutesCochees = lignes.length > 0 && lignes.every((ligne) => ligneDansLeTexte(champ.lire(), ligne));
    deposerDansLeChamp(lignesDeSuggestions(items), toutesCochees);
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
      /* LES RÉGLAGES DE L'AGENT, dans la rangée du bas — toujours visibles. Une
         carte : son menu de configuration (modifiable jusqu'à la validation,
         puis lu) ; une conversation sans carte : le menu moteur, modèle,
         réflexion, compte de l'agent. */
      reglages={
        carte && cardId ? (
          reglagesCarte.vu && reglagesCarte.libelles ? (
            <MenuDesReglagesDeLaCarte
              card={carte}
              vu={reglagesCarte.vu}
              libelles={reglagesCarte.libelles}
              declencheur={
                <Button
                  size="icon"
                  variant="ghost"
                  className="shrink-0"
                  title={t('Configuration de l’agent')}
                  aria-label="Configuration de l’agent"
                  data-raccourci-reglages={reglagesCarte.vu.modifiable ? 'modifiable' : 'lecture'}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                </Button>
              }
            />
          ) : undefined
        ) : agent ? (
          <BoutonReglagesAgent agent={agent} />
        ) : undefined
      }
      /* L'arrêt vit dans la barre d'action quand c'est le geste du chapitre :
         un second carré d'arrêt dans le champ le redirait. */
      sansArret={!!carte && geste.geste === 'arreter'}
      engines={state.engines}
      queue={queue}
      busy={busy}
      champ={champ}
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
      onEnvoiModifie={(avant, apres) =>
        setEnvoiLocal((echo) => (echo && echo.texte.trim() === avant.trim() ? { ...echo, texte: apres } : echo))
      }
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
   * 2. DÈS QUE LE PROMPT EST PARTI — cette carte se REPLIE en un bloc
   *    (`ReglagesAgent`) qui ouvre un petit MENU sous lui : modifiable jusqu'à
   *    la validation de la compréhension, en LECTURE SEULE ensuite. Le PARCOURS
   *    prend toute la place sous elle.
   *
   * La barre d'écriture, elle, ne bouge jamais : c'est par elle que part la
   * demande, que se répond une question et que se lance la tâche.
   */
  if (carte && cardId) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {header}

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
                    <BarreDEtapes segments={segments} active={voletDuCahier ? etapeCourante : (etapeVisible ?? etapeCourante)} courante={etapeCourante} onAller={voletDuCahier ? () => {} : allerAuPoint} />,
                    emplacementBarre.current,
                  )
                : <BarreDEtapes segments={segments} active={voletDuCahier ? etapeCourante : (etapeVisible ?? etapeCourante)} courante={etapeCourante} onAller={voletDuCahier ? () => {} : allerAuPoint} />}
            </div>

            {/* LE FLUX EN CINQ POINTS, dans la zone qui défile : chaque point
                replie ses traces, sa mémoire et ses boutons secondaires ; le
                plan est un point du flux (`FluxEnPoints`). */}
            <ZoneDefilement ref={filRef} data-fil="parcours" className="flex flex-col">
              {/* Les idées à cocher du compte rendu lisent leur case dans le
                  champ d'écriture de CETTE carte (`ContexteTexteDuChamp`). */}
              <ContexteTexteDuChamp.Provider value={champ}>
              <ContexteTextesEnvoyes.Provider value={textesEnvoyes}>
              <FluxEnPoints
                carte={carte}
                projectId={projectId}
                galerieDesCaptures={galerieDesCaptures}
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
                onToggleEvolution={toggleEvolution}
                onToggleAll={toggleAll}
              />
              </ContexteTextesEnvoyes.Provider>
              </ContexteTexteDuChamp.Provider>
              <div ref={bottomRef} />
            </ZoneDefilement>

            {/* CE QUE L'AGENT A VU, COLLÉ EN BAS : la bande ne défile pas avec
                le flux, elle reste au-dessus du panneau de décision et de la
                barre d'écriture, et se replie sur sa ligne de titre par son
                chevron (`BandeDesCaptures`). Rien tant que l'agent n'a pas
                produit d'image. */}
            {projectId && galerieDesCaptures.captures.length ? (
              <div className="shrink-0 px-4 pb-1.5 pt-1" data-captures-de-la-carte={galerieDesCaptures.captures.length}>
                <BandeDesCaptures galerie={galerieDesCaptures} className="" />
              </div>
            ) : null}
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

        {voletDuCahier ? (
          <div
            className="shrink-0 px-2.5 pt-2"
            style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}
            data-volet-cahier={carte.id}
          >
            <BandeauCahierDesCharges carte={carte} />
          </div>
        ) : (
          barreDEcriture
        )}
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
        className={cn('flex flex-col', enTeteDuFil ? 'pb-3' : 'px-3 py-3')}
      >
        {enTeteDuFil ? <div className="shrink-0">{enTeteDuFil}</div> : null}
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
            /* Sous un en-tête, le bloc prend la place QUI RESTE (et la dépasse
               en défilant) : « min-h-full » repousserait l'en-tête hors de vue
               même pour un échange court. */
            enTeteDuFil
              ? cn('grow px-3 pt-3', messages.length && 'flex flex-col justify-end')
              : messages.length && 'flex min-h-full flex-col justify-end',
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
          className="pointer-events-auto flex min-w-0 items-center gap-1 rounded bg-raised/90 px-1.5 py-0.5 text-[12.5px] text-faint backdrop-blur transition-colors hover:text-text"
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
            'pointer-events-auto ml-auto flex shrink-0 items-center gap-1 rounded bg-raised/90 px-1.5 py-0.5 text-[12.5px] text-muted backdrop-blur transition-colors',
            verdict.ok ? 'hover:bg-border hover:text-text' : 'cursor-not-allowed opacity-40',
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
/**
 * CE QUI OCCUPE L'AGENT, EN DIRECT. La ligne de tâche annoncée dit le BUT ;
 * l'étape qui tourne dit le GESTE — et, dès qu'elle dure, depuis combien de
 * temps : c'est elle qui explique une tâche qui « ne bouge plus » (une
 * commande lente, une aide au travail). Les aides actives se comptent.
 */
function ceQuiOccupe(tache: string | undefined, etape: Message['steps'][number] | undefined, etapes: Message['steps']): string {
  const depuis = etape?.startedAt ? Date.now() - etape.startedAt : 0;
  const geste = etape ? (depuis >= 10_000 ? `${etape.label} · ${duration(depuis / 1000)}` : etape.label) : undefined;
  const aides = etapes.filter((step) => step.state === 'running' && estUneAide(step)).length;
  const lesAides = aides > 1 ? t('{n} aides au travail', { n: aides }) : null;
  const base = tache ? (geste && depuis >= 10_000 ? `${tache} — ${geste}` : tache) : (geste ?? t('Réflexion en cours…'));
  return lesAides ? `${base} · ${lesAides}` : base;
}

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
        : ceQuiOccupe(todoEnCours?.label, etapeEnCours, dernier?.steps ?? []);

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
        // IL PASSE VRAIMENT SOUS LE CHAMP : 12 px de recouvrement, le rayon du
        // champ (`rounded-lg`). Plus court que le rayon, son bord bas
        // s'arrêtait dans la courbe et ses deux coins dépassaient autour des
        // arrondis ; ici il descend jusqu'aux flancs droits du champ, qui le
        // recouvre. Son propre haut prend le même rayon.
        'relative z-0 -mb-3 flex shrink-0 flex-col rounded-t-lg',
        // UN GRIS UN PEU PLUS CLAIR QUE LE CHAMP (`--decroche`), SOLIDE du
        // haut jusqu'en bas (entête et liste dépliée comprises) : il se pose
        // entre le fond de la page et celui du champ. C'est son TEXTE qui le
        // distingue — en violet, la seule couleur de l'interface (un fond
        // jaune pastel a été essayé le 11/10/2026, puis refusé).
        'bg-decroche',
      )}
    >
      <div
        className={cn(
          'flex items-center gap-2 px-3 pt-1.5',
          // pb-5 (20px) compense le recouvrement de -mb-3 (12px) posé sur le
          // conteneur : il reste 8px d'air visible sous le texte avant que la
          // zone de saisie ne le recouvre, proche des 6px du pt-1.5 au-dessus
          // — cette marge ne vaut que pour la DERNIÈRE ligne visible : une
          // fois la liste dépliée sous elle, c'est elle qui la porte à la
          // place.
          todosDisponibles && listeOuverte ? 'pb-1.5' : 'pb-5',
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
            <InfoTravail quoi={quoi} avancement={avancement} temps={temps} icone={icone} classeDuTexte="text-teinte" />
            {listeOuverte ? (
              <ChevronDown className="h-3 w-3 shrink-0 text-faint" />
            ) : (
              <ChevronUp className="h-3 w-3 shrink-0 text-faint" />
            )}
          </button>
        ) : (
          <InfoTravail quoi={quoi} avancement={avancement} temps={temps} icone={icone} classeDuTexte="text-teinte" />
        )}
      </div>

      {todosDisponibles && listeOuverte ? (
        <div className="pb-5">
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

/** Ce que le bloc et son menu annoncent : les réglages qui SERVIRONT, ou ceux qui ONT SERVI. */
function titreDesReglages(vu: ReglagesCarte): string {
  /*
   * LE MÊME BLOC DIT DEUX CHOSES DIFFÉRENTES selon le moment, et il ne doit
   * jamais mentir : tant que rien n'a tourné, ce sont les réglages QUI
   * SERVIRONT ; une fois le travail parti, ceux QUI ONT SERVI.
   */
  return !vu.modifiable && vu.source === 'reel' ? t('Réglages qui ont servi') : t('Configuration de l’agent');
}

/**
 * AVEC QUOI CETTE CARTE TOURNE — LA CONFIGURATION, RÉDUITE À UN BLOC. Elle
 * prend la place de la carte de configuration DÈS QUE LA PREMIÈRE DEMANDE EST
 * PARTIE.
 *
 * LE BLOC OUVRE UN PETIT MENU SOUS LUI, JAMAIS UNE PAGE
 * (`MenuDesReglagesDeLaCarte`). Tant que la compréhension n'est pas validée, ce
 * menu ÉCRIT : une entrée par réglage, qui déplie sa liste. Ensuite il ne fait
 * plus que MONTRER — l'agent d'une tâche ne se rechoisit plus en cours de
 * route, sinon le parcours affiché sous lui mentirait sur ce qui a servi. La
 * lecture seule est garantie par l'absence de toute entrée, pas par un champ
 * désactivé qu'on pourrait rouvrir.
 *
 * Quatre lignes courtes : moteur, modèle, réflexion, compte — c'est ce qui
 * permet de comprendre après coup pourquoi une carte s'est bien ou mal passée.
 */
function ReglagesAgent({
  card,
  vu,
  libelles,
}: {
  card: Card;
  vu: ReglagesCarte;
  libelles: { moteur: string; modele: string; reflexion: string };
}) {
  /* Le cadenas dit toujours POURQUOI — et ne paraît que quand c'est figé. */
  const raison = vu.raison ? t(vu.raison) : '';

  return (
    <MenuDesReglagesDeLaCarte
      card={card}
      vu={vu}
      libelles={libelles}
      declencheur={
        /* Réduit à un résumé. Sous le titre, UNE LIGNE PAR RÉGLAGE : le libellé
           à gauche, la valeur à droite, qui revient à la ligne au lieu d'être
           coupée (les valeurs bout à bout, séparées par « · », se lisaient mal
           sur téléphone). Sans compte imposé, la ligne dit « Automatique »,
           jamais un tiret. Aucun `line-clamp` ici : un texte replié ne se pose
           jamais dans un `button`. */
        <button
          type="button"
          data-reglages-figes={vu.modifiable ? undefined : ''}
          data-reglages-agent={vu.modifiable ? 'modifiable' : 'fige'}
          className="flex w-full flex-col gap-0.5 rounded-md bg-raised px-2.5 py-2 text-left transition-colors hover:bg-border"
        >
          <span className="flex w-full min-w-0 items-center gap-1.5 text-[11px] uppercase tracking-wide text-faint">
            <Cpu className="h-3 w-3 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{titreDesReglages(vu)}</span>
            {vu.modifiable ? null : (
              <span className="flex shrink-0" title={raison}>
                <Lock className="h-2.5 w-2.5" aria-hidden />
              </span>
            )}
            <ChevronDown className="h-3 w-3 shrink-0" />
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
      }
    />
  );
}

/**
 * LE MENU DE LA CONFIGURATION D'UNE CARTE, ANCRÉ AU BOUTON QU'ON LUI CONFIE.
 *
 * Deux boutons l'ouvrent — le bloc du fil (`ReglagesAgent`, menu sous lui) et
 * l'icône de la barre d'écriture (toujours là, menu au-dessus d'elle) : chacun
 * a SON menu, et tous deux montrent le même contenu.
 *
 *  - MODIFIABLE (`data-tiroir-reglages="modifiable"`) : les entrées des
 *    réglages de l'agent, qui déplient chacune leur liste en sous-menu et
 *    écrivent sur la carte.
 *  - FIGÉ (`data-tiroir-reglages="lecture"`) : le cadenas et sa raison, puis
 *    des lignes qui se lisent — aucune entrée, rien à cliquer.
 */
function MenuDesReglagesDeLaCarte({
  card,
  vu,
  libelles,
  declencheur,
  cote = 'start',
}: {
  card: Card;
  vu: ReglagesCarte;
  libelles: { moteur: string; modele: string; reflexion: string };
  /** Le bouton qui ouvre le menu, et sous lequel il se pose. */
  declencheur: React.ReactElement;
  /** Le bord du bouton sur lequel le menu s'aligne. */
  cote?: 'start' | 'end';
}) {
  const state = useApp();
  const [ouvert, setOuvert] = React.useState(false);
  const titre = titreDesReglages(vu);

  return (
    <DropdownMenu open={ouvert} onOpenChange={setOuvert}>
      <DropdownMenuTrigger asChild {...ouvertureAuClic(() => setOuvert(true))}>
        {declencheur}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={cote}
        side={cote === 'end' ? 'bottom' : 'top'}
        collisionPadding={8}
        className="min-w-[250px] sm:max-h-[min(480px,var(--radix-dropdown-menu-content-available-height))] sm:max-w-[min(340px,calc(100vw-16px))]"
      >
        {vu.modifiable ? (
          <div className="flex flex-col gap-0.5" data-tiroir-reglages="modifiable">
            <div className="flex items-center gap-1.5 px-2 py-1">
              <span className="min-w-0 flex-1 truncate text-[12px] uppercase tracking-wide text-faint">{titre}</span>
              <BulleInfo>{t('Modifiable jusqu’à la validation de la compréhension : le réglage choisi à ce moment servira au travail.')}</BulleInfo>
            </div>
            <EntreesDeReglages
              engines={state.engines}
              choix={card.run}
              onSelect={choixDeLaCarte(card, state.engines)}
              comptes={state.quotas}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-0.5" data-tiroir-reglages="lecture">
            <div className="flex items-center gap-1.5 px-2 py-1">
              <span className="min-w-0 flex-1 truncate text-[12px] uppercase tracking-wide text-faint">{titre}</span>
              <Lock className="h-3 w-3 shrink-0 text-faint" aria-hidden />
            </div>
            <ReglagesLusDeLaCarte card={card} vu={vu} libelles={libelles} />
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * LES RÉGLAGES FIGÉS D'UNE CARTE, EN LECTURE : la raison du cadenas, une ligne
 * par réglage, puis ce que la carte a consommé. Rendu DANS le menu : il ne
 * demande donc sa part de quota qu'à l'ouverture.
 */
function ReglagesLusDeLaCarte({
  card,
  vu,
  libelles,
}: {
  card: Card;
  vu: ReglagesCarte;
  libelles: { moteur: string; modele: string; reflexion: string };
}) {
  /*
   * La part de quota réellement consommée par cette carte, somme de ses lignes
   * de consommation. Elle vit dans la table `usage`, pas sur la carte : on la
   * demande au serveur quand la configuration figée s'ouvre. Une carte sans
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
  const raison = vu.raison ? t(vu.raison) : '';

  return (
    <div className="flex flex-col pb-1">
      {raison ? (
        <p className="px-2 pb-1.5 text-[12px] leading-snug text-faint" data-raison-reglages-figes>
          {raison}
        </p>
      ) : null}
      <LigneLue nom={t('Moteur')} valeur={libelles.moteur} />
      <LigneLue nom={t('Modèle')} valeur={libelles.modele} />
      <LigneLue nom={t('Réflexion')} valeur={libelles.reflexion} />
      <LigneLue nom={t('Compte')} valeur={vu.compte ?? '—'} />

      {/* La part de quota dépensée par cette carte. Rien quand aucun
          relevé n'existe : un zéro ferait croire à une mesure. */}
      {quotaVu ? (
        <>
          <LigneLue nom={t('Quota 5 h consommé')} valeur={partQuota(quotaVu.quota5h)} />
          <LigneLue nom={t('Quota semaine consommé')} valeur={partQuota(quotaVu.quotaSemaine)} />
        </>
      ) : null}
    </div>
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
 * ouvre DIRECTEMENT la liste de ce réglage, en menu ancré SOUS ELLE
 * (`RunSelectors ouvrirSur`) — jamais une page, jamais un aperçu qu'il faudrait
 * re-cliquer. Le choix écrit sur la CARTE, qui est ce que le lancement lira,
 * exactement comme le bloc compact qui prendra sa place dès le premier message
 * (`ReglagesAgent`, juste au-dessus).
 */
function CarteDeConfiguration({
  card,
  libelles,
}: {
  card: Card;
  libelles: { moteur: string; modele: string; reflexion: string };
}) {
  const state = useApp();
  const choisir = choixDeLaCarte(card, state.engines);

  /* La ligne « Compte » ne paraît que si plusieurs comptes du moteur retenu
     se disputent vraiment le travail — sinon le choix automatique suffit. */
  const moteurChoisi = resoudreRun(state.engines, card.run).engine;
  const comptes = (state.quotas ?? []).filter((c) => c.engine === moteurChoisi?.id && !c.disabled);
  const compte = card.run?.account ? comptes.find((c) => c.id === card.run?.account) : undefined;

  /* Chaque ligne est le bouton de SON menu : le même composant que partout
     ailleurs, ouvert droit sur la liste du réglage nommé. */
  const ligne = (reglage: ReglageDeRun, nom: string, valeur: string) => (
    <RunSelectors
      engines={state.engines}
      choix={card.run}
      onSelect={choisir}
      comptes={state.quotas}
      ouvrirSur={reglage}
      declencheur={<LigneDeConfiguration nom={nom} valeur={valeur} />}
    />
  );

  return (
    <div data-carte-configuration className="rounded-lg border border-border bg-raised px-3 py-3">
      <div className="flex items-center gap-1.5 text-[12.5px] uppercase tracking-wide text-faint">
        <Cpu className="h-3 w-3 shrink-0" />
        {t('Configuration de l’agent')}
      </div>
      <p className="flex items-center gap-1 mt-1 text-[14.5px] font-medium leading-relaxed text-text">{t(MOT_CONFIGURATION.titre)}<BulleInfo cote="start">{t(MOT_CONFIGURATION.indice)}</BulleInfo></p>

      <div className="mt-2.5 flex flex-col gap-1">
        {ligne('moteur', t('Moteur'), libelles.moteur)}
        {ligne('modele', t('Modèle'), libelles.modele)}
        {ligne('reflexion', t('Réflexion'), libelles.reflexion)}
        {comptes.length > 1 ? ligne('compte', t('Compte'), compte?.label ?? t('Automatique')) : null}
      </div>
    </div>
  );
}

/**
 * Une ligne de la carte de configuration : le nom, la valeur, un chevron. C'est
 * un vrai `button`, qui transmet sa référence et ses propriétés : il sert de
 * BOUTON au menu de son réglage (`RunSelectors declencheur`), qui s'ancre sous
 * lui.
 */
export const LigneDeConfiguration = React.forwardRef<
  HTMLButtonElement,
  { nom: string; valeur: string } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function LigneDeConfiguration({ nom, valeur, className, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      data-ligne-configuration={nom}
      className={cn(
        'flex w-full items-center gap-2 rounded-md bg-surface px-2.5 py-1.5 text-left transition-colors hover:bg-raised',
        className,
      )}
      {...props}
    >
      <span className="shrink-0 text-[12.5px] text-faint">{nom}</span>
      <span data-valeur={valeur} className="min-w-0 flex-1 truncate text-[14.5px] font-medium text-text">
        {valeur}
      </span>
      <ChevronDown className="h-3 w-3 shrink-0 text-faint" />
    </button>
  );
});

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

/** Une ligne LUE du menu des réglages figés : le nom à gauche, la valeur à
 * droite, qui revient à la ligne au lieu d'être coupée. Rien à cliquer. */
function LigneLue({ nom, valeur }: { nom: string; valeur: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 px-2 py-1.5" data-reglage-lu={nom}>
      <span className="shrink-0 text-[12.5px] text-faint">{nom}</span>
      <span className="min-w-0 break-words text-right text-[13.5px] font-medium text-text">{valeur}</span>
    </div>
  );
}
