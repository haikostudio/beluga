import * as React from 'react';
import { ChevronUp, CornerDownRight, Loader2, MessageSquare, RotateCcw, Square } from 'lucide-react';
import {
  Agent,
  Message,
  afficherHeure,
  carteRangee,
  etatDuPlan,
  libellePrecedents,
  peutRepartir,
  questionEnTexteLibre,
  titreDeBloc,
} from '@haikodev/shared';
import { ConfirmDialog, EmptyState, Tooltip, ZoneDefilement } from '@/components/ui';
import { MessageView } from '@/components/message-view';
import { Composer } from '@/components/composer';
import { useArretAgent } from '@/components/arret-agent';
import { VoletTaches } from '@/components/todos';
import { BandeauPropositions } from '@/components/propositions';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';

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
  /** Propose le bouton « repartir de zéro » (conversation permanente du chef). */
  nouveauDepart?: boolean;
  /** Quelque chose vient EN DESSOUS (barre de navigation du téléphone) : le
      creux de l'écran y est déjà réservé, la barre d'écriture ne doit pas le
      réserver une seconde fois. */
  creuxReserveAilleurs?: boolean;
}) {
  const state = useApp();
  const [picked, setPicked] = React.useState<string[]>([]);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  const conversation = cardId ? state.cardMessages[cardId] : undefined;
  const messages = cardId
    ? (conversation?.messages ?? [])
    : agent
      ? (state.messages[agent.id] ?? [])
      : [];
  const queue = agent ? (state.queues[agent.id] ?? []) : [];
  const busy = agent?.status === 'running' || messages.some((m) => m.streaming);

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
      {/*
       * La bande « en cours » est posée EN HAUT, juste sous les onglets : au
       * bas de l'écran elle se perdait au-dessus de la barre d'écriture, alors
       * qu'elle dit ce que l'agent fait à l'instant.
       */}
      <TravailEnCours agent={agent} messages={messages} busy={busy} cardId={cardId} />

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
         * Un échange court — une phrase du chef et sa carte proposée — ne
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
                {/* Une carte a souvent eu plusieurs agents : un repère sépare le
                    compte rendu de l'analyse de celui de l'exécution. */}
                {cardId && message.agentId !== messages[index - 1]?.agentId ? (
                  <SeparateurAgent titre={titreDeBloc(state.agents[message.agentId]?.role)} />
                ) : null}
                <MessageView
                  message={message}
                  allMessages={messages}
                  projectId={projectId}
                  montrerHeure={afficherHeure(messages, index)}
                  pickedEvolutions={picked}
                  onToggleEvolution={toggleEvolution}
                  onToggleAll={toggleAll}
                  etatPlan={etatDuPlan(messages, index) ?? 'courant'}
                />
              </React.Fragment>
            ))
          ) : (
            <EmptyState
              icon={<MessageSquare className="h-5 w-5" />}
              title={vide?.titre ?? 'Aucun échange pour le moment'}
              hint={vide?.indice ?? 'Posez une question ou demandez une action.'}
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

      {/* La liste des tâches est un volet FIXE, entre le fil et la barre
          d'écriture : elle ne remonte plus avec les messages. Elle porte celle
          du dernier échange — sans liste, elle s'efface entièrement. */}
      <VoletTaches todos={messages[messages.length - 1]?.todos} streaming={busy} />

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
        engines={state.engines}
        queue={queue}
        busy={busy}
        picked={picked}
        onRemovePicked={(text) => setPicked((current) => current.filter((item) => item !== text))}
        onClearPicked={() => setPicked([])}
        projectId={projectId}
        onProposeTask={onProposeTask}
        dansTiroir={!!cardId || !!creuxReserveAilleurs}
        cardId={cardId}
      />
    </div>
  );
}

/**
 * La barre du nouveau départ. Elle tient sur une ligne : à gauche le lien qui
 * rouvre les échanges d'avant (rien n'est supprimé), à droite le bouton qui
 * coupe le fil.
 *
 * Le bouton est inactif tant que le chef d'orchestre travaille : couper le fil
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
          <span className="truncate">{tout ? 'Replier les échanges précédents' : libellePrecedents(precedents)}</span>
        </button>
      ) : null}

      <Tooltip label={verdict.ok ? 'Repartir sur une conversation neuve' : verdict.raison}>
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
          Repartir de zéro
        </button>
      </Tooltip>

      <ConfirmDialog
        open={aConfirmer}
        title="Repartir sur une conversation neuve ?"
        description="Le chef d'orchestre oublie tout ce qui a été dit et repart à zéro : ses réponses redeviennent rapides et bien moins coûteuses. Les échanges précédents ne sont pas supprimés, ils restent consultables d'un clic."
        confirmLabel="Repartir de zéro"
        onConfirm={repartir}
        onClose={() => setAConfirmer(false)}
      />
    </div>
  );
}

/**
 * Le repère posé juste au-dessus de la barre d'écriture quand l'agent a fini
 * son tour sur une question écrite en toutes lettres. Pas un faux bloc de
 * réponse : une simple ligne qui pointe la barre existante — ni bouton, ni
 * champ de plus.
 */
function RepereReponseTexte() {
  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-warning/40 bg-warning/10 px-3 py-1.5 text-[12.5px] text-muted">
      <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-warning" />
      <span className="min-w-0">L'agent attend votre réponse — écrivez-la ci-dessous.</span>
    </div>
  );
}

/** Le repère qui annonce quel agent parle à partir d'ici. */
function SeparateurAgent({ titre }: { titre: string }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="text-[11.5px] uppercase tracking-wide text-faint">{titre}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/**
 * Le témoin de travail, juste au-dessus de la barre d'écriture : on voit d'un
 * coup d'œil si quelque chose tourne, quoi, et depuis combien de temps. Quand
 * rien ne tourne, la ligne disparaît complètement.
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
  // Le geste d'arrêt est le MÊME qu'en bas de la barre d'écriture : un seul
  // texte, donc le même contrôle, la même commande et la même confirmation.
  const arret = useArretAgent({ agent, cardId });

  // Le temps écoulé avance tout seul, seconde par seconde.
  React.useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => forcer((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  if (!busy) return null;

  const dernier = messages[messages.length - 1];
  const todoEnCours = dernier?.todos?.find((todo) => todo.state === 'running');
  const etapeEnCours = [...(dernier?.steps ?? [])].reverse().find((step) => step.state === 'running');
  const quoi = todoEnCours?.label ?? etapeEnCours?.label ?? 'Réflexion en cours…';

  const temps = arret.temps;

  return (
    <div className="flex shrink-0 items-center gap-2 bg-surface/60 px-3 py-1.5">
      <Loader2 className="h-3 w-3 shrink-0 animate-spin text-en-cours" />
      <span className="min-w-0 flex-1 truncate text-[13px] text-muted">{quoi}</span>
      {temps ? <span className="shrink-0 text-[12px] tabular-nums text-faint">{temps}</span> : null}
      {arret.possible ? (
        <Tooltip label="Arrêter l'action en cours">
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

      {arret.dialogue}
    </div>
  );
}
