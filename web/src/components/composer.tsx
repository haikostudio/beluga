import * as React from 'react';
import {
  ArrowUp,
  Check,
  ChevronDown,
  GripVertical,
  Loader2,
  Mic,
  Paperclip,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { Agent, EngineInfo, QueuedPrompt, RunConfig, ThinkingLevel } from '@haikodev/shared';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Textarea,
  Tooltip,
} from '@/components/ui';
import { client } from '@/lib/client';
import { cn } from '@/lib/utils';

export interface ComposerProps {
  agent: Agent | null;
  engines: EngineInfo[];
  queue: QueuedPrompt[];
  busy: boolean;
  picked: string[];
  onRemovePicked: (text: string) => void;
  onClearPicked: () => void;
  projectId: string;
  /** Depuis une carte, l'envoi peut devenir une proposition de tâche (§15). */
  onProposeTask?: (text: string) => void;
}

export function Composer({
  agent,
  engines,
  queue,
  busy,
  picked,
  onRemovePicked,
  onClearPicked,
  projectId,
  onProposeTask,
}: ComposerProps) {
  const [text, setText] = React.useState('');
  const [attachments, setAttachments] = React.useState<{ id: string; name: string }[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  // Brouillon conservé par conversation.
  const draftKey = agent ? `haikodev.draft.${agent.id}` : null;
  React.useEffect(() => {
    if (!draftKey) return;
    setText(localStorage.getItem(draftKey) ?? '');
  }, [draftKey]);
  React.useEffect(() => {
    if (!draftKey) return;
    if (text) localStorage.setItem(draftKey, text);
    else localStorage.removeItem(draftKey);
  }, [draftKey, text]);

  React.useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 180)}px`;
  }, [text]);

  const installed = engines.filter((e) => e.installed);
  const engine = installed.find((e) => e.id === agent?.run.engine) ?? installed[0];
  const models = engine?.models ?? [];
  const currentModel =
    models.find((m) => m.id === agent?.run.model) ?? models.find((m) => m.id === engine?.defaultModel) ?? models[0];
  // Les niveaux affichés sont EXACTEMENT ceux que ce modèle propose.
  const thinkingOptions = currentModel?.thinking ?? [];
  const currentThinking =
    thinkingOptions.find((t) => t.id === agent?.run.thinking) ?? thinkingOptions[0];

  // Le serveur tranche : il réinitialise les choix d'après et vérifie que la
  // combinaison existe vraiment (PLAN §14).
  const updateRun = async (patch: { engine?: string; model?: string; thinking?: string }) => {
    if (!agent) return;
    try {
      await client.call({ type: 'agent.config', agentId: agent.id, run: patch });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'réglage impossible');
    }
  };

  const upload = async (files: FileList | File[]) => {
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const response = await fetch(
          `/api/upload?project=${encodeURIComponent(projectId)}${agent ? `&agent=${agent.id}` : ''}${
            agent?.cardId ? `&card=${agent.cardId}` : ''
          }`,
          {
            method: 'POST',
            headers: { 'content-type': file.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) },
            body: file,
          },
        );
        const data = await response.json();
        if (data.attachment) {
          setAttachments((current) =>
            current.some((a) => a.id === data.attachment.id)
              ? current
              : [...current, { id: data.attachment.id, name: data.attachment.name }],
          );
        }
      }
    } catch {
      client.pushToast('error', "Envoi du fichier impossible");
    } finally {
      setUploading(false);
    }
  };

  const submit = async (asProposal = false) => {
    const body = [text.trim(), ...picked].filter(Boolean).join('\n');
    if (!body || !agent) return;

    if (asProposal && onProposeTask) {
      onProposeTask(body);
      setText('');
      onClearPicked();
      return;
    }

    setText('');
    onClearPicked();
    setAttachments([]);
    try {
      await client.call({
        type: 'agent.prompt',
        agentId: agent.id,
        text: body,
        attachments: attachments.map((a) => a.id),
      });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'envoi impossible');
      setText(body);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <div
      className="border-t border-border bg-bg px-2.5 pt-2"
      style={{ paddingBottom: 'max(10px, env(safe-area-inset-bottom))' }}
    >
      {/* La file d'attente s'empile juste au-dessus de la barre d'écriture */}
      {queue.length ? (
        <div className="mb-1.5 space-y-1">
          {queue.map((item, index) => (
            <QueuedItem key={item.id} item={item} index={index} />
          ))}
          <p className="px-1 text-[10.5px] text-faint">
            {queue.length}/10 en attente — l'agent enchaînera tout seul dès qu'il se taira.
          </p>
        </div>
      ) : null}

      {/* Les pastilles d'évolutions retenues partent avec le message */}
      {picked.length ? (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {picked.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => onRemovePicked(item)}
              className="group inline-flex max-w-[300px] items-center gap-1 rounded-md border border-border bg-raised px-1.5 py-1 text-[11.5px] text-muted hover:border-danger/40 hover:text-text"
            >
              <span className="truncate">{item}</span>
              <X className="h-2.5 w-2.5 shrink-0 text-faint group-hover:text-danger" />
            </button>
          ))}
        </div>
      ) : null}

      {attachments.length ? (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {attachments.map((file) => (
            <button
              key={file.id}
              type="button"
              onClick={() => setAttachments((current) => current.filter((a) => a.id !== file.id))}
              className="group inline-flex items-center gap-1 rounded-md border border-border bg-raised px-1.5 py-1 text-[11.5px] text-muted"
            >
              <Paperclip className="h-2.5 w-2.5" />
              <span className="max-w-[160px] truncate">{file.name}</span>
              <X className="h-2.5 w-2.5 text-faint group-hover:text-danger" />
            </button>
          ))}
        </div>
      ) : null}

      <div className="rounded-lg border border-border bg-raised">
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files);
            if (files.length) {
              event.preventDefault();
              void upload(files);
            }
          }}
          placeholder={busy ? 'L\'agent travaille — votre message attendra son tour…' : 'Écrivez votre demande…'}
          rows={1}
          className="min-h-[38px] border-0 bg-transparent focus-visible:ring-0"
        />

        <div className="flex items-center gap-1 px-1.5 pb-1.5">
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => event.target.files && upload(event.target.files)}
          />
          <Tooltip label="Joindre un fichier">
            <Button variant="ghost" size="icon" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
            </Button>
          </Tooltip>

          <Dictation onText={(dictated) => setText((current) => (current ? `${current} ${dictated}` : dictated))} />

          <div className="mx-0.5 h-4 w-px bg-border" />

          {/* Trois réglages EN CASCADE, alimentés par le serveur */}
          <Selector
            label={engine?.label ?? 'moteur'}
            items={installed.map((e) => ({
              id: e.id,
              label: e.label,
              note: e.version?.replace(/[^\d.]/g, '').slice(0, 8),
            }))}
            value={engine?.id}
            onSelect={(id) => updateRun({ engine: id })}
            title="Moteur"
          />
          <Selector
            label={currentModel?.label ?? 'modèle'}
            items={models.map((m) => ({
              id: m.id,
              label: m.label,
              description: m.description,
              note: m.contextWindow ? `${Math.round(m.contextWindow / 1000)}k` : undefined,
            }))}
            value={currentModel?.id}
            onSelect={(id) => updateRun({ model: id })}
            title={engine?.live ? 'Modèle (liste du moteur)' : 'Modèle'}
          />
          {thinkingOptions.length > 1 ? (
            <Selector
              label={currentThinking?.label ?? 'réflexion'}
              items={thinkingOptions.map((level) => ({
                id: level.id,
                label: level.label,
                description: level.description,
              }))}
              value={currentThinking?.id}
              onSelect={(id) => updateRun({ thinking: id })}
              title="Niveau de réflexion"
            />
          ) : null}

          <div className="ml-auto flex items-center gap-1">
            {onProposeTask && (text.trim() || picked.length) ? (
              <Button variant="ghost" size="sm" onClick={() => submit(true)}>
                En faire une tâche
              </Button>
            ) : null}
            {busy ? (
              <Tooltip label="Arrêter l'agent">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => agent && client.send({ type: 'agent.stop', agentId: agent.id })}
                >
                  <Square className="h-3 w-3 fill-current" />
                </Button>
              </Tooltip>
            ) : null}
            <Button
              variant="default"
              size="icon"
              disabled={!agent || (!text.trim() && !picked.length)}
              onClick={() => submit()}
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Selector({
  label,
  items,
  value,
  onSelect,
  title,
}: {
  label: string;
  items: { id: string; label: string; note?: string; description?: string }[];
  value?: string;
  onSelect: (id: string) => void;
  title: string;
}) {
  if (!items.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1 px-1.5 text-[11.5px] text-faint hover:text-text">
          <span className="max-w-[110px] truncate">{label}</span>
          <ChevronDown className="h-2.5 w-2.5 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[320px] w-[268px] overflow-y-auto">
        <DropdownMenuLabel>{title}</DropdownMenuLabel>
        {items.map((item) => (
          <DropdownMenuItem key={item.id} onSelect={() => onSelect(item.id)} className="items-start">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-text">{item.label}</span>
                {item.note ? <span className="shrink-0 text-[10px] text-faint">{item.note}</span> : null}
              </div>
              {item.description ? (
                <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug text-faint">{item.description}</p>
              ) : null}
            </div>
            {value === item.id ? <Check className="mt-0.5 h-3 w-3 shrink-0 text-success" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function QueuedItem({ item, index }: { item: QueuedPrompt; index: number }) {
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(item.text);

  return (
    <div className="flex items-start gap-1.5 rounded-md border border-border bg-surface px-2 py-1.5">
      <GripVertical className="mt-0.5 h-3 w-3 shrink-0 text-faint" />
      <span className="mt-0.5 text-[10.5px] text-faint">{index + 1}</span>
      {editing ? (
        <input
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => {
            setEditing(false);
            if (value !== item.text) client.send({ type: 'queue.update', id: item.id, text: value });
          }}
          onKeyDown={(event) => event.key === 'Enter' && (event.target as HTMLInputElement).blur()}
          className="flex-1 bg-transparent text-[12px] text-text outline-none"
        />
      ) : (
        <button type="button" onClick={() => setEditing(true)} className="flex-1 text-left text-[12px] text-muted">
          {item.text}
        </button>
      )}
      <button
        type="button"
        onClick={() => client.send({ type: 'queue.remove', id: item.id })}
        className="mt-0.5 text-faint hover:text-danger"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

/**
 * La dictée (PLAN §21) : un clic enregistre, valider transcrit, la corbeille
 * abandonne. Le texte est DÉPOSÉ dans le champ — rien n'est envoyé.
 */
function Dictation({ onText }: { onText: (text: string) => void }) {
  const [recording, setRecording] = React.useState(false);
  const [working, setWorking] = React.useState(false);
  const [level, setLevel] = React.useState(0);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const analyserRef = React.useRef<{ context: AudioContext; raf: number } | null>(null);

  const stopMeter = () => {
    if (analyserRef.current) {
      cancelAnimationFrame(analyserRef.current.raf);
      void analyserRef.current.context.close();
      analyserRef.current = null;
    }
    setLevel(0);
  };

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => event.data.size && chunksRef.current.push(event.data);
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);

      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        analyser.getByteTimeDomainData(data);
        const peak = Math.max(...Array.from(data).map((v) => Math.abs(v - 128))) / 128;
        setLevel(peak);
        const raf = requestAnimationFrame(loop);
        if (analyserRef.current) analyserRef.current.raf = raf;
      };
      analyserRef.current = { context, raf: requestAnimationFrame(loop) };
    } catch {
      client.pushToast('error', 'Micro indisponible dans ce navigateur');
    }
  };

  const finish = async (keep: boolean) => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    const stream = recorder.stream;
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });
    stream.getTracks().forEach((track) => track.stop());
    stopMeter();
    setRecording(false);
    recorderRef.current = null;

    if (!keep) {
      chunksRef.current = [];
      return;
    }

    setWorking(true);
    try {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      const response = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', 'x-audio-ext': 'webm' },
        body: blob,
      });
      const data = await response.json();
      if (data.ok && data.text) onText(data.text);
      else client.pushToast('warning', data.error ?? 'transcription vide');
    } catch {
      client.pushToast('error', 'transcription impossible');
    } finally {
      setWorking(false);
      chunksRef.current = [];
    }
  };

  if (recording) {
    return (
      <div className="flex items-center gap-1">
        <span className="relative flex h-6 w-6 items-center justify-center">
          <span
            className="absolute inset-0 rounded-full bg-danger/20"
            style={{ transform: `scale(${1 + level * 0.8})` }}
          />
          <Mic className="relative h-3.5 w-3.5 text-danger" />
        </span>
        <Button variant="ghost" size="icon" onClick={() => finish(true)}>
          <Check className="h-3.5 w-3.5 text-success" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => finish(false)}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <Tooltip label="Dicter">
      <Button variant="ghost" size="icon" onClick={start} disabled={working}>
        {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mic className="h-3.5 w-3.5" />}
      </Button>
    </Tooltip>
  );
}
