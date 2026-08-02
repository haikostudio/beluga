import * as React from 'react';
import { MessageSquare } from 'lucide-react';
import { Agent } from '@haikodev/shared';
import { EmptyState } from '@/components/ui';
import { MessageView } from '@/components/message-view';
import { Composer } from '@/components/composer';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';

export function Chat({
  agent,
  projectId,
  header,
  onProposeTask,
}: {
  agent: Agent | null;
  projectId: string;
  header?: React.ReactNode;
  onProposeTask?: (text: string) => void;
}) {
  const state = useApp();
  const [picked, setPicked] = React.useState<string[]>([]);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  const messages = agent ? (state.messages[agent.id] ?? []) : [];
  const queue = agent ? (state.queues[agent.id] ?? []) : [];
  const busy = agent?.status === 'running' || messages.some((m) => m.streaming);

  React.useEffect(() => {
    if (agent) client.send({ type: 'agent.open', id: agent.id });
  }, [agent?.id]);

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
      <div className="flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {messages.length ? (
          messages.map((message) => (
            <MessageView
              key={message.id}
              message={message}
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
