import * as React from 'react';
import {
  ChevronLeft,
  Download,
  File as FileIcon,
  FileText,
  Folder,
  Image as ImageIcon,
  Paperclip,
  Search,
  X,
} from 'lucide-react';
import { Attachment, FileNode, etiquetteDePiece } from '@beluga/shared';
import {
  Badge,
  Button,
  Dialog,
  DialogContentLibre,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  ZoneDefilement,
} from '@/components/ui';
import { AttachmentPreview } from '@/components/attachment-preview';
import { BasculeApercu, ContenuTexte, useFormatApercu } from '@/components/apercu-markdown';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { bytes, cn, relativeTime } from '@/lib/utils';
import { t } from '@/lib/langue';

export function RightPanel({ projectId }: { projectId: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Tabs defaultValue="files" className="flex min-h-0 flex-1 flex-col">
        <div className="px-2 py-1.5">
          <TabsList className="w-full">
            <TabsTrigger value="files" className="flex-1">
              {t('Fichiers')}</TabsTrigger>
            <TabsTrigger value="attachments" className="flex-1">
              {t('Pièces jointes')}</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="files" className="flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden">
          <FilesTab projectId={projectId} />
        </TabsContent>

        <TabsContent value="attachments" className="flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden">
          <AttachmentsTab projectId={projectId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Onglet Fichiers                                                     */
/* ------------------------------------------------------------------ */

function FilesTab({ projectId }: { projectId: string }) {
  const state = useApp();
  const [path, setPath] = React.useState('');
  const [filter, setFilter] = React.useState('');
  const [selection, setSelection] = React.useState<Set<string>>(new Set());
  const [preview, setPreview] = React.useState<{ path: string; data: any } | null>(null);

  const nodes = state.files[`${projectId}:${path}`] ?? [];

  React.useEffect(() => {
    client.send({ type: 'files.list', projectId, path });
  }, [projectId, path]);

  // L'arborescence se rafraîchit quand un agent touche au projet.
  React.useEffect(() => {
    const timer = setInterval(() => client.send({ type: 'files.list', projectId, path }), 20000);
    return () => clearInterval(timer);
  }, [projectId, path]);

  const RECENT_MS = 5 * 60 * 1000;

  const visible = (filter ? nodes.filter((node) => node.name.toLowerCase().includes(filter.toLowerCase())) : nodes)
    .slice()
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
      if (a.kind === 'file') return (b.mtime ?? 0) - (a.mtime ?? 0);
      return a.name.localeCompare(b.name);
    });

  const open = async (node: FileNode) => {
    if (node.kind === 'dir') {
      setPath(node.path);
      return;
    }
    const response = await fetch(
      `/api/file?project=${encodeURIComponent(projectId)}&path=${encodeURIComponent(node.path)}`,
    );
    setPreview({ path: node.path, data: await response.json() });
  };

  const downloadSelection = async () => {
    const paths = selection.size ? [...selection] : path ? [path] : ['.'];
    /* Le bouton porte lui-même son attente : il ne reste ici qu'à dire un
       refus — et à le RELANCER, sinon la coche s'afficherait sur une archive
       qui n'est jamais partie. */
    const response = await fetch('/api/zip', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, paths, label: 'fichiers' }),
    });
    const data = await response.json();
    if (!data.token) {
      const raison = data.error ?? 'archive impossible';
      client.pushToast('error', raison);
      throw new Error(raison);
    }
    window.location.href = `/api/download?token=${encodeURIComponent(data.token)}`;
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        {path ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setPath(path.split('/').slice(0, -1).join('/'))}
          >
            <ChevronLeft className="h-3 w-3" />
          </Button>
        ) : null}
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-faint" />
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={path || t('racine du projet')}
            className="h-7 pl-6 text-[13.5px]"
          />
        </div>
        <Tooltip label={selection.size ? t('Télécharger {v0} élément(s)', { v0: selection.size }) : t('Télécharger ce dossier')}>
          <Button variant="ghost" size="icon-sm" onClick={downloadSelection}>
            <Download className="h-3 w-3" />
          </Button>
        </Tooltip>
      </div>

      <ZoneDefilement className="px-1 py-1">
        {visible.map((node) => {
          const recent = node.kind === 'file' && node.mtime !== undefined && Date.now() - node.mtime < RECENT_MS;
          return (
          <div
            key={node.path}
            className="group flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-surface"
          >
            <input
              type="checkbox"
              checked={selection.has(node.path)}
              onChange={(event) =>
                setSelection((current) => {
                  const next = new Set(current);
                  event.target.checked ? next.add(node.path) : next.delete(node.path);
                  return next;
                })
              }
              className="h-3 w-3 shrink-0 accent-current opacity-0 transition-opacity group-hover:opacity-100 checked:opacity-100"
            />
            <button onClick={() => open(node)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
              {node.kind === 'dir' ? (
                <Folder className="h-3 w-3 shrink-0 text-faint" />
              ) : /\.(png|jpe?g|gif|webp|svg)$/i.test(node.name) ? (
                <ImageIcon className="h-3 w-3 shrink-0 text-faint" />
              ) : /\.(md|txt|json|ya?ml)$/i.test(node.name) ? (
                <FileText className="h-3 w-3 shrink-0 text-faint" />
              ) : (
                <FileIcon className="h-3 w-3 shrink-0 text-faint" />
              )}
              {recent ? (
                <Tooltip label={t('Modifié à l’instant')}>
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-info" />
                </Tooltip>
              ) : null}
              <span className="min-w-0 flex-1 truncate text-[13.5px] text-muted">{node.name}</span>
              {node.kind === 'file' ? (
                <span className={cn('shrink-0 text-[11.5px] text-faint', recent && 'text-info')}>
                  {relativeTime(node.mtime)}
                </span>
              ) : null}
              {node.kind === 'file' ? <span className="text-[11.5px] text-faint">{bytes(node.size)}</span> : null}
            </button>
          </div>
          );
        })}
        {!visible.length ? <EmptyState title={t('Dossier vide')} /> : null}
      </ZoneDefilement>

      <FilePreview projectId={projectId} preview={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function FilePreview({
  projectId,
  preview,
  onClose,
}: {
  projectId: string;
  preview: { path: string; data: any } | null;
  onClose: () => void;
}) {
  // Les crochets se posent AVANT la sortie anticipée : un composant ne peut pas
  // en appeler un nombre variable d'un rendu à l'autre.
  const { markdown, format, setFormat } = useFormatApercu(preview?.path, preview?.data?.mime);
  if (!preview) return null;
  const { data } = preview;
  const href = `/api/file?project=${encodeURIComponent(projectId)}&path=${encodeURIComponent(preview.path)}&download=1`;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContentLibre className="sm:w-[min(860px,100%)]">
        <DialogHeader className="flex items-center gap-2 pb-3">
          <DialogTitle className="min-w-0 flex-1 truncate text-[14.5px]">{preview.path}</DialogTitle>
          {/* La bascule n'apparaît que pour un Markdown : ailleurs, elle ne
              changerait rien. */}
          {data.kind === 'text' && markdown ? <BasculeApercu format={format} onChange={setFormat} /> : null}
          {/* Le fichier se récupère tel quel, sans passer par une archive. */}
          <Tooltip label={t('Télécharger')}>
            <Button variant="ghost" size="icon-sm" asChild>
              <a href={href} download>
                <Download className="h-3 w-3" />
              </a>
            </Button>
          </Tooltip>
        </DialogHeader>
        <ZoneDefilement
          fond="hsl(var(--raised))"
          classeEnveloppe="mx-4 mb-4 rounded-md border border-border bg-raised"
          data-fenetre-corps
          className="overflow-x-auto p-2"
        >
          {data.kind === 'text' ? (
            <ContenuTexte contenu={data.content} format={markdown ? format : 'markdown'} />
          ) : data.kind === 'image' ? (
            <img src={`data:${data.mime};base64,${data.content}`} alt={preview.path} className="mx-auto max-w-full" />
          ) : data.kind === 'pdf' ? (
            <iframe
              title={preview.path}
              src={`data:application/pdf;base64,${data.content}`}
              className="h-[70dvh] w-full rounded"
            />
          ) : data.kind === 'too_big' ? (
            <p className="p-4 text-center text-[14px] text-faint">
              {t('Fichier trop lourd pour l\'aperçu ({v0}). Téléchargez-le pour le consulter.', { v0: bytes(data.size) })}</p>
          ) : (
            <p className="p-4 text-center text-[14px] text-faint">{t('Fichier binaire ({v0}).', { v0: bytes(data.size) })}</p>
          )}
        </ZoneDefilement>
      </DialogContentLibre>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Onglet Pièces jointes                                               */
/* ------------------------------------------------------------------ */

function AttachmentsTab({ projectId }: { projectId: string }) {
  const state = useApp();
  const items = state.attachments[projectId] ?? [];
  const [zoom, setZoom] = React.useState<Attachment | null>(null);

  React.useEffect(() => {
    client.send({ type: 'attachments.list', projectId });
  }, [projectId]);

  if (!items.length) {
    return (
      <EmptyState
        icon={<Paperclip className="h-5 w-5" />}
        title={t('Aucune pièce jointe')}
        hint={t('Tout ce qui transite par les conversations du projet apparaît ici.')}
      />
    );
  }

  return (
    <ZoneDefilement classeEnveloppe="h-full" className="p-2">
      <div className="grid grid-cols-2 gap-1.5">
        {items.map((item) => {
          const isImage = item.mime.startsWith('image/');
          return (
            <div key={item.id} className="overflow-hidden rounded-md border border-border bg-surface">
              <button onClick={() => setZoom(item)} className="block w-full">
                {isImage ? (
                  <img
                    src={`/api/attachment?id=${item.id}`}
                    alt={etiquetteDePiece(item)}
                    className="h-20 w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-20 items-center justify-center text-faint">
                    <FileText className="h-5 w-5" />
                  </div>
                )}
              </button>
              <div className="px-1.5 py-1">
                <p className="truncate text-[12.5px] text-muted">{etiquetteDePiece(item)}</p>
                <div className="flex items-center gap-1 text-[11.5px] text-faint">
                  <span>{bytes(item.size)}</span>
                  <span>·</span>
                  <span>{relativeTime(item.createdAt)}</span>
                  <a
                    href={`/api/attachment?id=${item.id}&download=1`}
                    className="ml-auto hover:text-text"
                    title={t('Télécharger')}
                  >
                    <Download className="h-2.5 w-2.5" />
                  </a>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <AttachmentPreview item={zoom} onClose={() => setZoom(null)} />
    </ZoneDefilement>
  );
}
