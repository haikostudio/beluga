import * as React from 'react';
import { ArrowUp, Check, ChevronDown, GripVertical, Loader2, Paperclip, Square, Trash2, X } from 'lucide-react';
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
import { MicButton, RecordingBar, useRecorder } from '@/components/recorder';
import { usePref } from '@/lib/prefs';
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

  // La dictée dépose son texte à la suite de ce qui est déjà écrit.
  const recorder = useRecorder((dicte) => setText((current) => (current ? `${current} ${dicte}` : dicte)));

  /*
   * Brouillon conservé par conversation, côté serveur : on le retrouve depuis
   * n'importe quel écran. Ce qui est écrit ne s'efface QUE sur un geste de
   * l'utilisateur (envoi ou effacement) : ni un agent qui disparaît un instant,
   * ni une reconnexion, ni un changement d'onglet n'y touchent.
   */
  const agentId = agent?.id;
  const cleBrouillon = agentId ? `draft.${agentId}` : 'draft.aucun';
  const [draft] = usePref<string>(cleBrouillon, '');
  const chargePour = React.useRef<string | undefined>(undefined);
  const premierPassage = React.useRef(true);

  React.useEffect(() => {
    // Agent absent l'espace d'un instant : on ne touche surtout à rien.
    if (!agentId) return;
    if (chargePour.current !== agentId) {
      // Vraie ouverture d'une autre conversation : on affiche SON brouillon.
      chargePour.current = agentId;
      premierPassage.current = true;
      setText(draft);
      return;
    }
    // Même conversation : le brouillon venu du serveur ne remplit que le vide.
    setText((current) => current || draft);
  }, [agentId, draft]);

  React.useEffect(() => {
    if (!agentId || chargePour.current !== agentId) return;
    // Le premier passage est l'affichage du brouillon, pas une saisie.
    if (premierPassage.current) {
      premierPassage.current = false;
      return;
    }
    // Retenu tout de suite en mémoire, envoyé au serveur juste après.
    client.setPrefLocally(cleBrouillon, text);
    const timer = window.setTimeout(
      () => client.send({ type: 'prefs.set', key: cleBrouillon, value: text }),
      600,
    );
    return () => window.clearTimeout(timer);
  }, [text, agentId, cleBrouillon]);

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
          <p className="px-1 text-[12px] text-faint">
            {queue.length === 1
              ? "Votre message part dès que l'agent a fini."
              : `${queue.length} messages en attente : ils partiront l'un après l'autre.`}
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
              className="group inline-flex max-w-[300px] items-center gap-1 rounded-md border border-border bg-raised px-1.5 py-1 text-[13px] text-muted hover:border-danger/40 hover:text-text"
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
              className="group inline-flex items-center gap-1 rounded-md border border-border bg-raised px-1.5 py-1 text-[13px] text-muted"
            >
              <Paperclip className="h-2.5 w-2.5" />
              <span className="max-w-[160px] truncate">{file.name}</span>
              <X className="h-2.5 w-2.5 text-faint group-hover:text-danger" />
            </button>
          ))}
        </div>
      ) : null}

      {recorder.recording ? (
        <RecordingBar
          levels={recorder.levels}
          seconds={recorder.seconds}
          onValidate={() => recorder.finish(true)}
          onDiscard={() => recorder.finish(false)}
        />
      ) : null}

      <div className={cn('rounded-lg border border-border bg-raised', recorder.recording && 'hidden')}>
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

        {/* Une seule ligne, même sur téléphone : les réglages rétrécissent,
            les boutons d'envoi gardent leur taille. */}
        <div className="flex min-w-0 items-center gap-0.5 px-1.5 pb-1.5 sm:gap-1">
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => event.target.files && upload(event.target.files)}
          />
          <Tooltip label="Joindre un fichier">
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
            </Button>
          </Tooltip>

          <div className="mx-0.5 hidden h-4 w-px shrink-0 bg-border sm:block" />

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
              appetite: m.appetite,
              note: m.releasedAt
                ? new Date(m.releasedAt).toLocaleDateString('fr-CH', { month: '2-digit', year: '2-digit' })
                : undefined,
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

          <div className="ml-auto flex shrink-0 items-center gap-1">
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
            <MicButton onStart={recorder.start} working={recorder.working} disabled={!agent} />
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
  items: { id: string; label: string; note?: string; description?: string; appetite?: 'light' | 'medium' | 'heavy' }[];
  value?: string;
  onSelect: (id: string) => void;
  title: string;
}) {
  if (!items.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="min-w-0 shrink gap-0.5 px-1 text-[13px] text-faint hover:text-text sm:gap-1 sm:px-1.5"
        >
          <span className="max-w-[56px] truncate sm:max-w-[110px]">{label}</span>
          <ChevronDown className="h-2.5 w-2.5 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[320px] w-[268px] overflow-y-auto">
        <DropdownMenuLabel>{title}</DropdownMenuLabel>
        {items.map((item) => (
          <DropdownMenuItem key={item.id} onSelect={() => onSelect(item.id)} className="items-start">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                {item.appetite ? <Appetite level={item.appetite} /> : null}
                <span className="truncate text-text">{item.label}</span>
                {item.note ? <span className="ml-auto shrink-0 text-[11.5px] text-faint">{item.note}</span> : null}
              </div>
              {item.description ? (
                <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-faint">{item.description}</p>
              ) : null}
            </div>
            {value === item.id ? <Check className="mt-0.5 h-3 w-3 shrink-0 text-success" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * L'appétit en quota, sans chiffre : trois traits pleins = gourmand, un seul =
 * léger. On veut savoir si un modèle va manger le quota, pas combien il coûte.
 */
function Appetite({ level }: { level: 'light' | 'medium' | 'heavy' }) {
  const rempli = level === 'heavy' ? 3 : level === 'medium' ? 2 : 1;
  const titre =
    level === 'heavy'
      ? 'Gourmand : consomme beaucoup de quota'
      : level === 'medium'
        ? 'Moyen : consommation de quota raisonnable'
        : 'Léger : consomme peu de quota';
  return (
    <span className="flex shrink-0 items-end gap-[1.5px]" title={titre} aria-label={titre}>
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={cn(
            'w-[3px] rounded-[1px]',
            index < rempli
              ? level === 'heavy'
                ? 'bg-warning'
                : level === 'medium'
                  ? 'bg-muted'
                  : 'bg-success'
              : 'bg-border',
          )}
          style={{ height: `${4 + index * 3}px` }}
        />
      ))}
    </span>
  );
}

function QueuedItem({ item, index }: { item: QueuedPrompt; index: number }) {
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(item.text);

  return (
    <div className="flex items-start gap-1.5 rounded-md border border-border bg-surface px-2 py-1.5">
      <GripVertical className="mt-0.5 h-3 w-3 shrink-0 text-faint" />
      <span className="mt-0.5 text-[12px] text-faint">{index + 1}</span>
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
          className="flex-1 bg-transparent text-[13.5px] text-text outline-none"
        />
      ) : (
        <button type="button" onClick={() => setEditing(true)} className="flex-1 text-left text-[13.5px] text-muted">
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
