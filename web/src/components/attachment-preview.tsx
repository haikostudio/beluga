import * as React from 'react';
import { Download, FileText, Paperclip } from 'lucide-react';
import { Attachment } from '@haikodev/shared';
import { Button, Dialog, DialogContent, DialogTitle, Tooltip } from '@/components/ui';
import { bytes, cn } from '@/lib/utils';

/**
 * L'aperçu d'une pièce jointe, en grand : image, PDF, ou bouton de
 * téléchargement pour le reste. Le même écran sert depuis la conversation et
 * depuis l'onglet « Pièces jointes ».
 */
export function AttachmentPreview({ item, onClose }: { item: Attachment | null; onClose: () => void }) {
  if (!item) return null;
  const source = `/api/attachment?id=${item.id}`;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:w-[min(900px,100%)]">
        <div className="flex items-center gap-2 pr-6">
          <DialogTitle className="min-w-0 flex-1 truncate text-[14.5px]">{item.name}</DialogTitle>
          <Tooltip label="Télécharger">
            <Button variant="ghost" size="icon-sm" asChild>
              <a href={`${source}&download=1`} download={item.name}>
                <Download className="h-3 w-3" />
              </a>
            </Button>
          </Tooltip>
        </div>
        <div className="mt-3 max-h-[72dvh] overflow-auto rounded-md border border-border bg-raised p-2">
          {item.mime.startsWith('image/') ? (
            <img src={source} alt={item.name} className="mx-auto max-w-full" />
          ) : item.mime === 'application/pdf' ? (
            <iframe title={item.name} src={source} className="h-[70dvh] w-full rounded" />
          ) : (
            <div className="p-6 text-center">
              <p className="mb-3 text-[13.5px] text-faint">
                Ce type de fichier ne s'affiche pas ici ({bytes(item.size)}).
              </p>
              <Button variant="outline" size="sm" asChild>
                <a href={`${source}&download=1`} download={item.name}>
                  <Download className="h-3 w-3" /> Télécharger
                </a>
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * La vignette d'une pièce jointe dans un message : l'image se voit tout de
 * suite, le reste se reconnaît à son nom. Un clic ouvre l'aperçu en grand.
 */
export function AttachmentThumb({
  item,
  onOpen,
  className,
  compact,
}: {
  item: Attachment;
  onOpen: () => void;
  className?: string;
  /** Dans la barre d'écriture, la vignette est plus petite : elle ne doit pas
      manger la hauteur du champ de texte sur téléphone. */
  compact?: boolean;
}) {
  const isImage = item.mime.startsWith('image/');

  if (isImage) {
    return (
      <button
        type="button"
        onClick={onOpen}
        title={item.name}
        className={cn(
          'overflow-hidden rounded-md border border-border bg-surface transition-colors hover:border-faint',
          compact ? 'h-12 w-12' : 'h-20 w-20',
          className,
        )}
      >
        <img
          src={`/api/attachment?id=${item.id}`}
          alt={item.name}
          loading="lazy"
          className="h-full w-full object-cover"
        />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      title={item.name}
      className={cn(
        'inline-flex max-w-[190px] items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] text-muted transition-colors hover:border-faint hover:text-text',
        compact && 'h-12 py-0 text-[12.5px]',
        className,
      )}
    >
      {item.mime === 'application/pdf' ? (
        <FileText className="h-3 w-3 shrink-0" />
      ) : (
        <Paperclip className="h-3 w-3 shrink-0" />
      )}
      <span className="truncate">{item.name}</span>
    </button>
  );
}
