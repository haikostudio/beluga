import * as React from 'react';
import {
  AlertCircle,
  Check,
  Circle,
  Download,
  HelpCircle,
  LayoutGrid,
  Loader2,
  Paperclip,
  X,
} from 'lucide-react';
import { Attachment, MEMORY_STEP_ID, Message } from '@haikodev/shared';
import { Badge, Button, Textarea } from '@/components/ui';
import { Markdown } from '@/lib/markdown';
import { Steps } from '@/components/steps';
import { MemoryNote, TodoList } from '@/components/todos';
import { AttachmentPreview, AttachmentThumb } from '@/components/attachment-preview';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn, duration, relativeTime } from '@/lib/utils';

/** Une ligne de repères : quand, combien de temps, combien de jetons. */
function Meta({ items }: { items: (string | null)[] }) {
  const visibles = items.filter(Boolean) as string[];
  if (!visibles.length) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-faint">
      {visibles.map((item, index) => (
        <span key={index}>{item}</span>
      ))}
    </div>
  );
}

function horodatage(at: number): string {
  const date = new Date(at);
  return `${date.toLocaleDateString('fr-CH', { day: '2-digit', month: '2-digit' })} à ${date.toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' })}`;
}

export function MessageView({
  message,
  projectId,
  pickedEvolutions,
  onToggleEvolution,
  onToggleAll,
}: {
  message: Message;
  /** Pour déplier la mémoire du projet sous l'étape de lecture. */
  projectId?: string;
  pickedEvolutions: string[];
  onToggleEvolution: (text: string) => void;
  onToggleAll: (items: string[]) => void;
}) {
  const isUser = message.role === 'user';

  if (isUser) {
    // Vos demandes : à droite, sur une largeur réduite.
    return (
      <div className="flex justify-end">
        <div className="w-[min(78%,520px)] min-w-0">
          <div className="rounded-lg rounded-br-sm border border-border bg-raised px-3 py-2">
            <p className="whitespace-pre-wrap text-[14.5px] leading-relaxed text-text">{message.content}</p>
            {message.attachments.length ? (
              <PiecesJointes ids={message.attachments} projectId={projectId} />
            ) : null}
          </div>
          <div className="text-right">
            <Meta
              items={[
                horodatage(message.createdAt),
                message.tokens ? `${message.tokens.toLocaleString('fr-CH')} jetons envoyés` : null,
              ]}
            />
          </div>
        </div>
      </div>
    );
  }

  /*
   * L'ordre de lecture est toujours le même (PLAN §26) : d'abord la mémoire du
   * projet relue, ensuite la liste des tâches annoncées, enfin le déroulé réel
   * qui se coche au fur et à mesure.
   */
  const memoire = message.steps.find((step) => step.id === MEMORY_STEP_ID);
  const etapes = message.steps.filter((step) => step.id !== MEMORY_STEP_ID);

  // Les réponses de l'agent occupent l'essentiel de la largeur.
  return (
    <div className="group w-[min(92%,860px)] min-w-0 max-w-full">
      {memoire ? <MemoryNote step={memoire} projectId={projectId} /> : null}
      <TodoList todos={message.todos} streaming={message.streaming} />
      <Steps steps={etapes} streaming={message.streaming} />

      {message.content ? (
        <Markdown
          content={message.content}
          pickedEvolutions={pickedEvolutions}
          onToggleEvolution={onToggleEvolution}
          onToggleAll={onToggleAll}
          streaming={message.streaming}
        />
      ) : message.streaming && !etapes.length ? (
        <p className="text-[14px] text-faint">L'agent réfléchit…</p>
      ) : null}

      {message.proposals.length ? (
        <div className="mt-2 space-y-1.5">
          {message.proposals.map((proposal) => (
            <ProposalChip key={proposal.id} messageId={message.id} proposal={proposal} />
          ))}
        </div>
      ) : null}

      {message.questions.length ? (
        <div className="mt-2 space-y-2">
          {message.questions.map((question) => (
            <QuestionCard key={question.id} messageId={message.id} question={question} />
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

/**
 * Les pièces jointes d'un message : les images se voient tout de suite, les
 * autres fichiers se reconnaissent à leur nom. Un clic ouvre l'aperçu en grand.
 */
function PiecesJointes({ ids, projectId }: { ids: string[]; projectId?: string }) {
  const state = useApp();
  const [apercu, setApercu] = React.useState<Attachment | null>(null);
  const connues = projectId ? (state.attachments[projectId] ?? []) : [];

  // La liste du projet peut ne pas être encore chargée : on la demande.
  React.useEffect(() => {
    if (projectId && !state.attachments[projectId]) {
      client.send({ type: 'attachments.list', projectId });
    }
  }, [projectId]);

  const items = ids.map((id) => connues.find((item) => item.id === id)).filter(Boolean) as Attachment[];

  return (
    <>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {items.length
          ? items.map((item) => <AttachmentThumb key={item.id} item={item} onOpen={() => setApercu(item)} />)
          : ids.map((id) => (
              <Badge key={id}>
                <Paperclip className="h-2.5 w-2.5" /> pièce jointe
              </Badge>
            ))}
      </div>
      <AttachmentPreview item={apercu} onClose={() => setApercu(null)} />
    </>
  );
}

/**
 * Une question de l'agent : il attend votre réponse pour reprendre. Choix
 * unique, choix multiple ou texte libre — et toujours la possibilité d'ajouter
 * une précision.
 */
function QuestionCard({ messageId, question }: { messageId: string; question: Message['questions'][number] }) {
  const [choisis, setChoisis] = React.useState<string[]>([]);
  const [complement, setComplement] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  if (question.answer) {
    return (
      <div className="rounded-md border border-border bg-surface/60 px-2.5 py-2">
        <p className="text-[13px] text-faint">{question.question}</p>
        <p className="mt-1 flex items-start gap-1.5 text-[14px] text-text">
          <Check className="mt-0.5 h-3 w-3 shrink-0 text-success" />
          {question.answer}
        </p>
      </div>
    );
  }

  const envoyer = async () => {
    const libelles = question.options.filter((o) => choisis.includes(o.id)).map((o) => o.label);
    const reponse = [libelles.join(', '), complement.trim()].filter(Boolean).join(' — ');
    if (!reponse) return;
    setBusy(true);
    try {
      await client.call({ type: 'question.answer', messageId, questionId: question.id, answer: reponse });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'réponse impossible');
    } finally {
      setBusy(false);
    }
  };

  const basculer = (id: string) =>
    setChoisis((current) =>
      question.kind === 'multiple'
        ? current.includes(id)
          ? current.filter((c) => c !== id)
          : [...current, id]
        : [id],
    );

  const pret = choisis.length > 0 || complement.trim().length > 0;

  return (
    <div className="rounded-md border border-warning/40 bg-warning/5 px-2.5 py-2">
      <p className="flex items-start gap-1.5 text-[14px] font-medium text-text">
        <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
        {question.question}
      </p>

      {question.options.length ? (
        <div className="mt-2 space-y-1">
          {question.options.map((option) => {
            const actif = choisis.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => basculer(option.id)}
                className={cn(
                  'flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left transition-colors',
                  actif ? 'border-accent/50 bg-raised text-text' : 'border-border bg-transparent text-muted hover:bg-raised',
                )}
              >
                <span className="mt-0.5 shrink-0">
                  {actif ? <Check className="h-3 w-3 text-success" /> : <Circle className="h-3 w-3 text-faint" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] leading-snug">{option.label}</span>
                  {option.description ? (
                    <span className="block text-[12.5px] text-faint">{option.description}</span>
                  ) : null}
                </span>
              </button>
            );
          })}
          {question.kind === 'multiple' ? (
            <p className="px-1 text-[12px] text-faint">Plusieurs réponses possibles.</p>
          ) : null}
        </div>
      ) : null}

      <Textarea
        value={complement}
        onChange={(event) => setComplement(event.target.value)}
        rows={2}
        placeholder={question.options.length ? 'Précision (facultative)…' : 'Votre réponse…'}
        className="mt-2"
      />

      <Button variant="default" size="sm" className="mt-2" disabled={!pret || busy} onClick={envoyer}>
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
        Répondre
      </Button>
    </div>
  );
}

/**
 * La carte présentée dans la conversation : elle a l'allure d'une carte du
 * tableau, et RIEN n'entre dans une colonne tant que vous n'avez pas validé
 * (§10). Le titre et la description se corrigent avant le clic.
 */
function ProposalChip({
  messageId,
  proposal,
}: {
  messageId: string;
  proposal: Message['proposals'][number];
}) {
  const [busy, setBusy] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [title, setTitle] = React.useState(proposal.title);
  const [description, setDescription] = React.useState(proposal.description);

  const decide = async (accept: boolean) => {
    setBusy(true);
    try {
      await client.call({
        type: 'proposal.decide',
        messageId,
        proposalId: proposal.id,
        accept,
        title: title.trim() || proposal.title,
        description,
      });
      client.pushToast(accept ? 'success' : 'info', accept ? 'Carte créée dans « À faire »' : 'Carte refusée');
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'décision impossible');
    } finally {
      setBusy(false);
    }
  };

  /* La carte, telle qu'elle apparaîtra sur le tableau. */
  const corps = (
    <>
      {editing ? (
        <>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="w-full rounded border border-border bg-base px-2 py-1 text-[14.5px] font-medium text-text outline-none focus:border-accent"
          />
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={5}
            className="mt-1.5 w-full text-[13.5px]"
          />
        </>
      ) : (
        <>
          <p className="text-[14.5px] font-medium leading-snug text-text">{proposal.title}</p>
          {proposal.description ? (
            <p className="mt-1 whitespace-pre-wrap text-[13.5px] leading-relaxed text-muted">
              {proposal.description}
            </p>
          ) : null}
        </>
      )}
      {proposal.labels.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {proposal.labels.map((label) => (
            <Badge key={label}>{label}</Badge>
          ))}
        </div>
      ) : null}
    </>
  );

  if (proposal.decision === 'accepted') {
    return (
      <button
        onClick={() => proposal.cardId && client.openCard(proposal.cardId)}
        className="w-full rounded-md border border-success/40 bg-surface px-3 py-2.5 text-left transition-colors hover:bg-raised"
      >
        <div className="mb-1.5 flex items-center gap-1.5 text-[12px] text-success">
          <Check className="h-3 w-3" />
          Carte créée dans « À faire »
        </div>
        <p className="text-[14.5px] font-medium leading-snug text-text">{proposal.title}</p>
        {proposal.description ? (
          <p className="mt-1 line-clamp-2 text-[13.5px] leading-relaxed text-muted">{proposal.description}</p>
        ) : null}
        {proposal.labels.length ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {proposal.labels.map((label) => (
              <Badge key={label}>{label}</Badge>
            ))}
          </div>
        ) : null}
      </button>
    );
  }

  if (proposal.decision === 'refused') {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-surface/60 px-3 py-2 text-[13.5px] text-faint">
        <X className="h-3 w-3 shrink-0" />
        <span className="min-w-0 flex-1 truncate line-through">{proposal.title}</span>
        <span className="text-[12px]">carte refusée</span>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-accent/40 bg-surface">
      <div className="flex items-center gap-1.5 border-b border-border bg-raised px-3 py-1.5 text-[12px] text-muted">
        <LayoutGrid className="h-3 w-3 text-accent" />
        Carte à valider — elle entrera dans « À faire »
        <button
          onClick={() => setEditing((current) => !current)}
          className="ml-auto text-[12px] text-faint hover:text-text"
        >
          {editing ? 'Terminer' : 'Modifier'}
        </button>
      </div>

      <div className="px-3 py-2.5">{corps}</div>

      <div className="flex gap-1.5 border-t border-border px-3 py-2">
        <Button size="sm" variant="default" disabled={busy} onClick={() => decide(true)}>
          <Check className="h-3 w-3" /> Créer la carte
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide(false)}>
          Refuser
        </Button>
      </div>
    </div>
  );
}
