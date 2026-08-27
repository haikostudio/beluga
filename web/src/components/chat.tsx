import * as React from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  CircleDot,
  CornerDownRight,
  Cpu,
  Loader2,
  Lock,
  MessageSquare,
  Rocket,
  RotateCcw,
  Square,
  Zap,
} from 'lucide-react';
import {
  Agent,
  BOUTON_LANCER_LA_TACHE,
  BOUTON_DES_QUE_POSSIBLE,
  boutonLancerLaTache,
  type Card,
  type EngineInfo,
  type EtatBoutonLancer,
  MOT_CADRAGE,
  Message,
  type ReglagesCarte,
  separateurDeJour,
  temoinDeTravail,
  carteRangee,
  etatDuPlan,
  libellePrecedents,
  peutRepartir,
  questionEnTexteLibre,
  reglagesDeLaCarte,
  titreDeBloc,
  TEXTE_BARRE_EN_ATTENTE,
  animeDuPersonnage,
  gesteDuPersonnage,
  imageDuPersonnage,
} from '@haikodev/shared';
import { ConfirmDialog, EmptyState, Tooltip, ZoneDefilement } from '@/components/ui';
import { MessageView } from '@/components/message-view';
import { Composer } from '@/components/composer';
import { useArretAgent } from '@/components/arret-agent';
import { InfoTravail } from '@/components/info-travail';
import { CorpsListeTaches, resumeDesTaches, usePliDesTaches } from '@/components/todos';
import { BandeauPropositions } from '@/components/propositions';
import { SilhouetteConversation } from '@/components/silhouettes';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { useAnimationsReduites } from '@/lib/animations-reduites';
import { cn, jourDuMessage } from '@/lib/utils';
import { t, formatRegional } from '@/lib/langue';

export function Chat({
  agent,
  projectId,
  header,
  onProposeTask,
  cardId,
  vide,
  nouveauDepart,
  creuxReserveAilleurs,
}: {
  agent: Agent | null;
  projectId: string;
  header?: React.ReactNode;
  onProposeTask?: (text: string) => void;
  /** Depuis une carte : on affiche TOUTE son histoire, pas seulement le dernier agent. */
  cardId?: string;
  /** Ce que dit une conversation encore vide (analyse en cours, par exemple). */
  vide?: { titre: string; indice: string };
  /** Propose le bouton « repartir de zéro » (conversation sans carte). */
  nouveauDepart?: boolean;
  /** Quelque chose vient EN DESSOUS (barre de navigation du téléphone) : le
      creux de l'écran y est déjà réservé, la barre d'écriture ne doit pas le
      réserver une seconde fois. */
  creuxReserveAilleurs?: boolean;
}) {
  const state = useApp();
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
   * messages d'un agent en un bloc (`agent.snapshot`), ceux d'une carte de même,
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
  const busy = temoinDeTravail({
    statut: agent?.status,
    tourVivantDepuis: agent?.tourVivantDepuis,
    finDuTour: agent?.endedAt,
    messageEnEcritureA: messages.find((m) => m.streaming)?.createdAt,
  });

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
  /*
   * LA CONVERSATION DE CADRAGE D'UNE CARTE. Tant que la carte dort en
   * « Planifié » et que c'est un agent de CADRAGE qui parle, le geste qui
   * compte n'est pas d'écrire un message de plus : c'est de LANCER le travail.
   * Le bouton vit donc en pleine largeur, au-dessus du champ de saisie
   * (`shared/src/cadrage.ts`).
   */
  const lancement = boutonLancerLaTache({
    colonne: carte?.column ?? 'planned',
    roleAgent: agent?.role,
    agentAuTravail: busy,
    messages: messages.length,
  });
  /* Une carte-fil encore vide n'attend pas une analyse : elle attend qu'on
     dise ce qu'on veut faire. Le mot par défaut change donc avec l'agent. */
  const motDeLaConversationVide =
    agent?.role === 'cadrage'
      ? { titre: t(MOT_CADRAGE.titre), indice: t(MOT_CADRAGE.indice) }
      : {
          titre: vide?.titre ?? t('Aucun échange pour le moment'),
          indice: vide?.indice ?? t('Posez une question ou demandez une action.'),
        };
  const dernierMessage = messages[messages.length - 1];
  const questionEnTexte =
    !!cardId && !busy && !carteRangee(carte?.column) && dernierMessage
      ? questionEnTexteLibre(dernierMessage)
      : null;

  // Les échanges d'avant le dernier nouveau départ sont repliés par défaut.
  const [tout, setTout] = React.useState(false);
  const precedents = agent ? (state.precedents[agent.id] ?? 0) : 0;

  React.useEffect(() => setTout(false), [agent?.id, cardId]);

  React.useEffect(() => {
    if (cardId) client.send({ type: 'card.conversation', cardId });
    if (agent) client.send({ type: 'agent.open', id: agent.id, tout });
  }, [agent?.id, cardId, tout]);

  /*
   * La carte est SOUS LES YEUX : dès que l'agent se tait, sa réponse est lue.
   * Sans cela, la pastille « terminé, pas encore lu » s'allumerait dans la
   * colonne des projets pendant qu'on lit précisément cette conversation.
   */
  React.useEffect(() => {
    if (cardId && !busy) client.send({ type: 'card.read', cardId });
  }, [cardId, busy]);

  /*
   * Le fil suit l'agent, MAIS il ne tire jamais la page sous les yeux de
   * quelqu'un en train de lire plus haut : le compte rendu d'analyse, déjà
   * écrit, ne doit plus défiler tout seul quand la tâche démarre. On ne
   * redescend donc que si l'on était déjà en bas.
   */
  const filRef = React.useRef<HTMLDivElement>(null);
  const ouvertePour = React.useRef<string | undefined>(undefined);
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
      bottomRef.current?.scrollIntoView({ block: 'end' });
      return;
    }
    if (suit.current) bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [cardId, agent?.id, messages.length, messages[messages.length - 1]?.content]);

  const toggleEvolution = (text: string) =>
    setPicked((current) => (current.includes(text) ? current.filter((item) => item !== text) : [...current, text]));

  const toggleAll = (items: string[]) =>
    setPicked((current) => {
      const allPicked = items.every((item) => current.includes(item));
      return allPicked ? current.filter((item) => !items.includes(item)) : [...new Set([...current, ...items])];
    });

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}

      {/* L'ANCIEN ONGLET « DÉTAILS » EST PARTI : le seul bloc qu'il portait et
          qui méritait de survivre — avec quoi la carte tourne — vit ici, dans
          la conversation elle-même, dès que la configuration est FIGÉE (le
          travail a démarré). Avant ce moment, le choix se fait dans la barre
          d'écriture ci-dessous (`RunSelectors` du composeur) : pas de doublon. */}
      {carte ? (
        <div className="shrink-0 px-3 pt-2">
          <ReglagesAgent card={carte} />
        </div>
      ) : null}

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
              <React.Fragment key={message.id}>
                {/* UN CHANGEMENT DE JOUR SE VOIT : un trait pleine largeur, la
                    date centrée dessus. Sans lui, deux bulles collées pouvaient
                    être écrites à trois jours d'écart sans que rien ne le dise
                    (`separateurDeJour`, `shared/src/heure-message.ts`). */}
                {separateurDeJour(messages, index) ? (
                  <SeparateurDeJour date={message.createdAt} />
                ) : null}
                {/* Une carte a souvent eu plusieurs agents : un repère sépare le
                    compte rendu de l'analyse de celui de l'exécution. */}
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
                  etatPlan={etatDuPlan(messages, index) ?? 'courant'}
                  onEcrireDansLeChamp={ecrireDansLeChamp}
                  /* Seul le DERNIER message peut porter une étape qui tourne
                     pour de vrai : ailleurs, une étape restée « en cours » est
                     le reliquat d'un tour coupé, et ne doit rien animer. */
                  agentAuTravail={busy && index === messages.length - 1}
                  /* La question en texte ordinaire ne se lit que sur le DERNIER
                     message, et seule cette vue-ci connaît la carte : le fil
                     juge, la bulle affiche. */
                  questionEnTexte={!!questionEnTexte && index === messages.length - 1}
                />
              </React.Fragment>
            ))
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
          <div ref={bottomRef} />
        </div>
      </ZoneDefilement>
      </div>

      {/* Les cartes proposées qui attendent encore un clic sont posées en
          bandeau FIXE, juste au-dessus du volet des tâches : elles ne remontent
          plus avec les messages et leurs boutons restent sous les yeux. Sans
          proposition en attente, le bandeau ne rend rien. */}
      <BandeauPropositions messages={messages} />

      {/* La liste des tâches n'a plus qu'UN seul endroit : le repère compact
          collé au-dessus de la barre d'écriture (`TravailEnCours`, plus bas),
          qui reste en place une fois le tour refermé. L'ancien volet pleine
          largeur, posé ici et séparé du champ de saisie, est retiré. */}

      {/* La barre d'écriture reste disponible FACE À UNE ANALYSE : on peut
          corriger une hypothèse fausse ou ajouter une précision avant de lancer
          la tâche. Un message relance alors un tour de l'agent d'analyse dans le
          même fil (la carte reste en « Planifié », l'analyse ne déplace jamais
          une carte), qui reprend son constat et son chiffrage. */}
      {/* L'agent attend une réponse écrite en toutes lettres : on le dit juste
          au-dessus de la barre, là où la réponse s'écrit. */}
      {questionEnTexte ? <RepereReponseTexte /> : null}

      <Composer
        agent={agent}
        boutonPrincipal={
          lancement.affiche && cardId ? (
            <GestesDeLancement cardId={cardId} etat={lancement} asap={carte?.scheduling?.asap === true} />
          ) : undefined
        }
        engines={state.engines}
        queue={queue}
        busy={busy}
        picked={picked}
        onRemovePicked={(text) => setPicked((current) => current.filter((item) => item !== text))}
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
        barreTravail={<TravailEnCours agent={agent} messages={messages} busy={busy} cardId={cardId} />}
      />
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
    client.send({ type: 'agent.reset', agentId: agent.id });
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

/**
 * LES GESTES DE LANCEMENT D'UNE CARTE DE CADRAGE, RÉUNIS AU-DESSUS DU CHAMP.
 *
 * Ils étaient à deux endroits : « Lancer la tâche » au-dessus du champ de
 * saisie, « Lancer maintenant » et « Dès que possible » tout au fond du pied du
 * tiroir, SOUS la barre d'écriture — donc hors de vue au moment précis où l'on
 * vient de finir d'expliquer son besoin. Or « Lancer maintenant » et « Lancer
 * la tâche » envoient la MÊME commande (`card.start`) : les garder tous les
 * deux, l'un au-dessus l'autre en dessous, était un double emploi. Il ne reste
 * donc qu'une rangée, juste au-dessus du champ : le lancement, et le seul geste
 * qui en diffère vraiment — mettre la carte en file au lieu de la lancer.
 *
 * La rangée ne paraît QU'UNE FOIS LA DISCUSSION ENGAGÉE (`boutonLancerLaTache`
 * ne l'affiche plus sur une carte vierge) : rien à lancer tant que rien n'est
 * dit.
 */
function GestesDeLancement({
  cardId,
  etat,
  asap,
}: {
  cardId: string;
  etat: EtatBoutonLancer;
  asap: boolean;
}) {
  return (
    <div className="flex flex-wrap items-stretch gap-1.5" data-gestes-de-lancement={cardId}>
      <div className="min-w-[150px] flex-1">
        <BoutonLancerLaTache cardId={cardId} etat={etat} />
      </div>
      <Tooltip
        label={
          asap
            ? t('La carte partira d’elle-même dès qu’une place se libère — cliquez pour annuler')
            : t('Mettre la carte en file : elle partira dès qu’une place se libère')
        }
      >
        <button
          type="button"
          data-des-que-possible={cardId}
          aria-pressed={asap}
          onClick={() =>
            client
              .call({ type: 'card.asap', id: cardId, value: !asap })
              .catch((err: any) => client.signalerRefus(err?.message ?? t('Geste refusé'), cardId))
          }
          className={cn(
            'flex shrink-0 items-center justify-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors',
            asap ? 'bg-raised text-text ring-1 ring-inset ring-accent' : 'bg-raised text-muted hover:text-text',
          )}
        >
          <Zap className="h-3.5 w-3.5" />
          {t(BOUTON_DES_QUE_POSSIBLE)}
        </button>
      </Tooltip>
    </div>
  );
}

/**
 * « LANCER LA TÂCHE » : le geste qui ferme la conversation de cadrage.
 *
 * Inactif, il n'est pas « désactivé » au sens du navigateur : un bouton
 * désactivé n'affiche plus son explication au survol, et on perdrait la seule
 * phrase qui dit pourquoi le geste attend.
 */
function BoutonLancerLaTache({ cardId, etat }: { cardId: string; etat: EtatBoutonLancer }) {
  const [envoi, setEnvoi] = React.useState(false);
  const lancer = () => {
    if (!etat.possible || envoi) return;
    setEnvoi(true);
    client
      .call({ type: 'card.start', id: cardId })
      /* Un lancement ne répond qu'une fois le tour PARTI : un délai dépassé
         n'est pas un refus, et n'allume donc pas l'alerte de serveur muet. */
      .catch((err: any) => client.signalerRefus(err?.message ?? t('Lancement refusé'), cardId))
      .finally(() => setEnvoi(false));
  };
  return (
    <Tooltip label={etat.possible ? t('Confier le travail à un agent complet') : (etat.raison ?? '')}>
      <button
        type="button"
        data-lancer-la-tache={cardId}
        aria-disabled={!etat.possible || envoi}
        onClick={lancer}
        className={cn(
          'flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors',
          etat.possible && !envoi
            ? 'bg-accent text-accent-fg hover:opacity-90'
            : 'cursor-not-allowed bg-raised text-faint',
        )}
      >
        {envoi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
        {t(BOUTON_LANCER_LA_TACHE)}
      </button>
    </Tooltip>
  );
}

/**
 * Le repère posé juste au-dessus de la barre d'écriture quand l'agent a fini
 * son tour sur une question écrite en toutes lettres : une simple ligne qui
 * pointe la barre existante.
 *
 * IL NE PORTE PLUS DE « ANNULER ». La sortie vit désormais DANS la bulle du
 * message (`QuestionEnTexteCard`, `message-view.tsx`), avec le texte de la
 * question — deux boutons pour le même geste, l'un loin de ce qu'il ferme,
 * était précisément ce qui rendait la sortie introuvable sur téléphone.
 */
function RepereReponseTexte() {
  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-warning/40 bg-warning/10 px-3 py-1.5 text-[12.5px] text-muted">
      <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-warning" />
      <span className="min-w-0 flex-1">{t('L\'agent attend votre réponse — écrivez-la ci-dessous.')}</span>
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
      <span className="shrink-0 text-[11.5px] uppercase tracking-wide text-faint">
        {jourDuMessage(date)}
      </span>
      <span className="h-px flex-1 bg-faint/30" aria-hidden />
    </div>
  );
}

function SeparateurAgent({ titre }: { titre: string }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="text-[11.5px] uppercase tracking-wide text-faint">{titre}</span>
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
}: {
  agent: Agent | null;
  messages: Message[];
  busy: boolean;
  /** Depuis le tiroir d'une carte : l'arrêt ne vaut que pour SA tâche. */
  cardId?: string;
}) {
  const [, forcer] = React.useState(0);
  const state = useApp();
  const animationsReduites = useAnimationsReduites();
  // Le geste d'arrêt est le MÊME qu'en bas de la barre d'écriture : un seul
  // texte, donc le même contrôle, la même commande et la même confirmation.
  const arret = useArretAgent({ agent, cardId });
  // La liste des tâches se déplie depuis CETTE barre, et de nulle part
  // ailleurs. Le pli est retenu d'une fois sur l'autre (`usePliDesTaches`,
  // `todos.tsx`) : téléphone replié, ordinateur déplié, sauf choix contraire.
  const [listeOuverte, basculerListe] = usePliDesTaches();

  // Le temps écoulé avance tout seul, seconde par seconde.
  React.useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => forcer((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  const dernier = messages[messages.length - 1];
  // La liste complète ne se déplie que si l'agent en a annoncé une — un
  // agent qui n'avance que par étapes (steps) n'a rien de plus à montrer ici,
  // ces étapes restant visibles repliées dans le fil au-dessus.
  const todos = dernier?.todos;
  const todosDisponibles = !!todos?.length;

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
    ? resumeDesTaches(todos!)
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
  /*
   * L'AVATAR DU TIROIR : le même personnage que la colonne « En cours »
   * (`shared/src/personnages-colonnes.ts`), qui donne de vrais coups de
   * pioche tant que CETTE carte a un tour vivant (`busy`), et redevient
   * l'image fixe dès que le tour se referme — « au moins une tâche n'est pas
   * totalement finie » se lit ici comme `busy`, exactement ce que regarde
   * déjà tout le reste de cette barre. `animationsReduites` l'immobilise
   * pour qui préfère moins d'animations, comme pour le personnage de colonne.
   */
  const geste = gesteDuPersonnage('running', busy ? 1 : 0, {
    remplace: state.personnages.running !== undefined,
    animationsReduites,
  });
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
        <img
          src={geste === 'pioche' ? animeDuPersonnage('running') : imageDuPersonnage('running', state.personnages.running)}
          alt=""
          aria-hidden
          draggable={false}
          data-avatar-tiroir
          data-avatar-vivant={geste === 'immobile' ? 'non' : 'oui'}
          className={cn(
            'h-6 w-[18px] shrink-0 select-none object-contain',
            geste === 'balancement' && 'origin-bottom animate-personnage-au-travail',
          )}
        />
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
        {/* Le bouton d'arrêt ne vaut que pour un travail EN COURS : le repère
            restant en place une fois le tour refermé, il proposerait sinon
            d'arrêter un agent qui ne fait plus rien (`arretDeCarteAutorise` ne
            juge que l'appartenance de l'agent à la carte, pas son activité). */}
        {busy && arret.possible ? (
          <Tooltip label={t('Arrêter l\'action en cours')}>
            <button
              type="button"
              aria-label="Arrêter l'action en cours"
              onClick={arret.demander}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border text-muted transition-colors hover:border-danger hover:bg-raised hover:text-danger"
            >
              <Square className="h-2.5 w-2.5 fill-current" />
            </button>
          </Tooltip>
        ) : null}
      </div>

      {todosDisponibles && listeOuverte ? (
        <div className="pb-4">
          <CorpsListeTaches todos={todos} streaming={busy} maintenant={Date.now()} />
        </div>
      ) : null}

      {arret.dialogue}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Les réglages de l'agent de la carte                                 */
/* ------------------------------------------------------------------ */

/**
 * Un identifiant technique n'apprend rien : on cherche son libellé dans le
 * catalogue des moteurs, et on retombe sur l'identifiant seulement s'il n'y
 * figure plus (modèle retiré depuis, moteur désinstallé).
 */
function libellesDuRun(
  engines: EngineInfo[],
  vu: Pick<ReglagesCarte, 'engine' | 'model' | 'thinking'>,
) {
  const moteur = engines.find((e) => e.id === vu.engine);
  const modele = moteur?.models.find((m) => m.id === vu.model);
  const niveau = modele?.thinking?.find((t) => t.id === vu.thinking);
  return {
    moteur: moteur?.label ?? vu.engine ?? '—',
    modele: modele?.label ?? vu.model ?? '—',
    reflexion: niveau?.label ?? vu.thinking ?? '—',
  };
}

/**
 * AVEC QUOI CETTE CARTE A TOURNÉ — vivait dans l'onglet « Détails », retiré.
 * Elle vit maintenant dans la conversation elle-même, et seulement UNE FOIS
 * LA CONFIGURATION FIGÉE (`vu.modifiable` faux : le travail a démarré) — avant
 * ce moment, la barre d'écriture porte déjà ses propres menus moteur / modèle
 * / réflexion (`RunSelectors` dans `composer.tsx`, qui écrit sur la même
 * carte) : afficher un second sélecteur ici aurait doublé le même geste.
 *
 * Quatre étiquettes courtes sur UNE ligne qui se replie : moteur, modèle,
 * réflexion, compte — c'est ce qui permet de comprendre après coup pourquoi
 * une carte s'est bien ou mal passée.
 */
function ReglagesAgent({ card }: { card: Card }) {
  const state = useApp();

  /*
   * Ce qui a SERVI, c'est l'agent d'EXÉCUTION, pas l'analyse : celle-ci tourne
   * souvent sur un autre modèle, et l'afficher ferait croire que la carte a été
   * traitée avec lui.
   */
  const execution = React.useMemo(
    () =>
      Object.values(state.agents)
        .filter((item) => item.cardId === card.id && item.role === 'task')
        .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null,
    [state.agents, card.id],
  );

  const vu = reglagesDeLaCarte({
    colonne: card.column,
    carte: card.run,
    agent: execution
      ? { engine: execution.run.engine, model: execution.run.model, thinking: execution.run.thinking, compte: execution.account }
      : undefined,
    compteMesure: card.consumption?.account,
  });

  const libelles = libellesDuRun(state.engines, vu);

  /*
   * La part de quota réellement consommée par cette carte, somme de ses lignes
   * de consommation. Elle vit dans la table `usage`, pas sur la carte : on la
   * demande au serveur dès que la configuration est figée. Une carte sans
   * relevé rend deux zéros — on n'affiche alors rien, pas un zéro trompeur.
   */
  const [quota, setQuota] = React.useState<{ quota5h: number; quotaSemaine: number } | null>(null);
  React.useEffect(() => {
    if (vu.modifiable) return;
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
  }, [card.id, vu.modifiable]);
  const quotaVu = quota && (quota.quota5h > 0 || quota.quotaSemaine > 0) ? quota : null;

  // Tant que la configuration n'est pas figée, la barre d'écriture porte déjà
  // le sélecteur : rien à montrer ici.
  if (vu.modifiable) return null;

  return (
    <div className="rounded-md border border-border bg-raised px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[11.5px] uppercase tracking-wide text-faint">
        <Cpu className="h-3 w-3" />
        {t('Réglages qui ont servi')}
        <Lock className="h-2.5 w-2.5" title={vu.raison} />
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px]">
          <Etiquette nom={t('Moteur')} valeur={libelles.moteur} />
          <Etiquette nom={t('Modèle')} valeur={libelles.modele} />
          {/* « Niveau », pas « Réflexion » : le libellé du niveau porte déjà le
              mot, et « Réflexion — Réflexion poussée » se lisait deux fois. */}
          <Etiquette nom={t('Niveau')} valeur={libelles.reflexion} />
          <Etiquette nom={t('Compte')} valeur={vu.compte ?? '—'} />
        </div>

        {/* La part de quota dépensée par cette carte, une seule ligne, en
            clair. Rien quand aucun relevé n'existe : un zéro ferait croire à
            une mesure. */}
        {quotaVu ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px]">
            <Etiquette nom={t('Quota 5 h consommé')} valeur={partQuota(quotaVu.quota5h)} />
            <Etiquette nom={t('Quota semaine consommé')} valeur={partQuota(quotaVu.quotaSemaine)} />
          </div>
        ) : null}
      </div>
    </div>
  );
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
      <span className="shrink-0 text-[12px] text-faint">{nom}</span>
      <span className="truncate font-medium text-text">{valeur}</span>
    </span>
  );
}
