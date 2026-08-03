import * as React from 'react';
import { ChevronUp, Loader2, MessageSquare, RotateCcw, Square } from 'lucide-react';
import { Agent, Message, libellePrecedents, peutRepartir, titreDeBloc } from '@haikodev/shared';
import { ConfirmDialog, EmptyState, Tooltip } from '@/components/ui';
import { MessageView } from '@/components/message-view';
import { Composer } from '@/components/composer';
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
      <TravailEnCours agent={agent} messages={messages} busy={busy} />

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

      <div
        ref={filRef}
        onScroll={(event) => {
          if (event.currentTarget.scrollLeft !== 0) event.currentTarget.scrollLeft = 0;
        }}
        className="flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-3 py-3"
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
                projectId={projectId}
                pickedEvolutions={picked}
                onToggleEvolution={toggleEvolution}
                onToggleAll={toggleAll}
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
      </div>

      {/* On ne discute pas avec un agent d'analyse : il chiffre et s'arrête.
          La barre d'écriture revient dès que la tâche est lancée — et d'ici là
          on n'affiche rien du tout : un bandeau d'explication figé sous chaque
          analyse prenait de la place sans jamais rien apprendre de neuf. */}
      {agent?.role === 'analysis' ? null : (
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
        />
      )}
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
 */
function TravailEnCours({
  agent,
  messages,
  busy,
}: {
  agent: Agent | null;
  messages: Message[];
  busy: boolean;
}) {
  const [, forcer] = React.useState(0);
  const [aConfirmer, setAConfirmer] = React.useState(false);

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

  const depuis = agent?.startedAt ? Math.round((Date.now() - agent.startedAt) / 1000) : null;
  const temps = depuis === null ? null : depuis < 60 ? `${depuis} s` : `${Math.floor(depuis / 60)} min ${depuis % 60} s`;

  /*
   * Au-delà de cinq minutes, l'agent a déjà beaucoup avancé : un clic malheureux
   * jetterait un vrai travail. On demande alors confirmation ; en deçà, l'arrêt
   * reste immédiat, sinon la commande deviendrait pénible pour rien.
   */
  const longTravail = depuis !== null && depuis >= 300;
  const arreter = () => agent && client.send({ type: 'agent.stop', agentId: agent.id });

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface/60 px-3 py-1.5">
      <Loader2 className="h-3 w-3 shrink-0 animate-spin text-success" />
      <span className="min-w-0 flex-1 truncate text-[13px] text-muted">{quoi}</span>
      {temps ? <span className="shrink-0 text-[12px] tabular-nums text-faint">{temps}</span> : null}
      {agent ? (
        <Tooltip label="Arrêter l'action en cours">
          <button
            type="button"
            aria-label="Arrêter l'action en cours"
            onClick={() => (longTravail ? setAConfirmer(true) : arreter())}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border text-muted transition-colors hover:border-danger hover:bg-raised hover:text-danger"
          >
            <Square className="h-2.5 w-2.5 fill-current" />
          </button>
        </Tooltip>
      ) : null}

      <ConfirmDialog
        open={aConfirmer}
        danger
        title="Arrêter cet agent ?"
        description={`Il travaille depuis ${temps ?? 'un moment'}. Tout ce qu'il n'a pas encore enregistré sera perdu.`}
        confirmLabel="Arrêter quand même"
        onConfirm={arreter}
        onClose={() => setAConfirmer(false)}
      />
    </div>
  );
}
