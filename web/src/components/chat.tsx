import * as React from 'react';
import { Loader2, MessageSquare, Square } from 'lucide-react';
import { Agent, Message } from '@haikodev/shared';
import { ConfirmDialog, EmptyState, Tooltip } from '@/components/ui';
import { MessageView } from '@/components/message-view';
import { Composer } from '@/components/composer';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';

export function Chat({
  agent,
  projectId,
  header,
  onProposeTask,
  cardId,
}: {
  agent: Agent | null;
  projectId: string;
  header?: React.ReactNode;
  onProposeTask?: (text: string) => void;
  /** Depuis une carte : on affiche TOUTE son histoire, pas seulement le dernier agent. */
  cardId?: string;
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

  React.useEffect(() => {
    if (cardId) client.send({ type: 'card.conversation', cardId });
    if (agent) client.send({ type: 'agent.open', id: agent.id });
  }, [agent?.id, cardId]);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, messages[messages.length - 1]?.content]);

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
      {/* Une conversation ne défile que verticalement : ce qui dépasse en
          largeur (code, longue adresse) défile DANS son propre bloc. */}
      <div className="flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-3 py-3">
        {messages.length ? (
          messages.map((message) => (
            <MessageView
              key={message.id}
              message={message}
              projectId={projectId}
              pickedEvolutions={picked}
              onToggleEvolution={toggleEvolution}
              onToggleAll={toggleAll}
            />
          ))
        ) : (
          <EmptyState
            icon={<MessageSquare className="h-5 w-5" />}
            title="Aucun échange pour le moment"
            hint="Posez une question ou demandez une action."
          />
        )}
        <div ref={bottomRef} />
      </div>

      <TravailEnCours agent={agent} messages={messages} busy={busy} />

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
      />
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
    <div className="flex shrink-0 items-center gap-2 border-t border-border bg-surface/60 px-3 py-1.5">
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
