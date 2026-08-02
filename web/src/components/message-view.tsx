import * as React from 'react';
import { AlertCircle, Check, Download, Paperclip, X } from 'lucide-react';
import { Message } from '@haikodev/shared';
import { Badge, Button } from '@/components/ui';
import { Markdown } from '@/lib/markdown';
import { Steps } from '@/components/steps';
import { client } from '@/lib/client';
import { cn, relativeTime } from '@/lib/utils';

export function MessageView({
  message,
  pickedEvolutions,
  onToggleEvolution,
  onToggleAll,
}: {
  message: Message;
  pickedEvolutions: string[];
  onToggleEvolution: (text: string) => void;
  onToggleAll: (items: string[]) => void;
}) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg rounded-br-sm border border-border bg-raised px-3 py-2">
          <p className="whitespace-pre-wrap text-[14.5px] leading-relaxed text-text">{message.content}</p>
          {message.attachments.length ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {message.attachments.map((id) => (
                <Badge key={id}>
                  <Paperclip className="h-2.5 w-2.5" /> pièce jointe
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="group">
      <Steps steps={message.steps} streaming={message.streaming} />

      {message.content ? (
        <Markdown
          content={message.content}
          pickedEvolutions={pickedEvolutions}
          onToggleEvolution={onToggleEvolution}
          onToggleAll={onToggleAll}
        />
      ) : message.streaming && !message.steps.length ? (
        <p className="text-[14px] text-faint">L'agent réfléchit…</p>
      ) : null}

      {message.proposals.length ? (
        <div className="mt-2 space-y-1.5">
          {message.proposals.map((proposal) => (
            <ProposalChip key={proposal.id} messageId={message.id} proposal={proposal} />
          ))}
        </div>
      ) : null}

      {message.downloads.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {message.downloads.map((offer) => (
            <a
              key={offer.id}
              href={`/api/download?token=${encodeURIComponent(offer.id)}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-raised px-2 py-1 text-[13.5px] text-text hover:bg-border"
            >
              <Download className="h-3 w-3" />
              {offer.label}
            </a>
          ))}
        </div>
      ) : null}

      {message.error ? (
        <div className="mt-2 flex gap-2 rounded-md border border-danger/30 bg-danger/5 px-2.5 py-2 text-[13.5px] text-danger">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="leading-relaxed">{message.error}</span>
        </div>
      ) : null}

      <div className="mt-1 text-[12px] text-faint opacity-0 transition-opacity group-hover:opacity-100">
        {relativeTime(message.createdAt)}
      </div>
    </div>
  );
}

/** La pastille de proposition : rien n'est créé tant que vous n'avez pas validé (§10). */
function ProposalChip({
  messageId,
  proposal,
}: {
  messageId: string;
  proposal: Message['proposals'][number];
}) {
  const [busy, setBusy] = React.useState(false);

  const decide = async (accept: boolean) => {
    setBusy(true);
    try {
      await client.call({ type: 'proposal.decide', messageId, proposalId: proposal.id, accept });
      client.pushToast(accept ? 'success' : 'info', accept ? 'Tâche créée dans « À faire »' : 'Proposition refusée');
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'décision impossible');
    } finally {
      setBusy(false);
    }
  };

  if (proposal.decision !== 'pending') {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-surface/60 px-2.5 py-1.5 text-[13.5px] text-faint">
        {proposal.decision === 'accepted' ? (
          <Check className="h-3 w-3 text-success" />
        ) : (
          <X className="h-3 w-3 text-faint" />
        )}
        <span className="line-through">{proposal.title}</span>
        <span className="ml-auto text-[12px]">
          {proposal.decision === 'accepted' ? 'carte créée' : 'refusée'}
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-surface px-2.5 py-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium text-text">{proposal.title}</p>
          {proposal.description ? (
            <p className="mt-0.5 line-clamp-3 text-[13.5px] leading-snug text-muted">{proposal.description}</p>
          ) : null}
          {proposal.labels.length ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {proposal.labels.map((label) => (
                <Badge key={label}>{label}</Badge>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="mt-2 flex gap-1.5">
        <Button size="sm" variant="default" disabled={busy} onClick={() => decide(true)}>
          Valider
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide(false)}>
          Refuser
        </Button>
      </div>
    </div>
  );
}
