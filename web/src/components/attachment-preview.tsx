import * as React from 'react';
import { Download, FileText, Paperclip } from 'lucide-react';
import { Attachment } from '@haikodev/shared';
import { Button, Dialog, DialogContent, DialogTitle, Tooltip, ZoneDefilement } from '@/components/ui';
import { BasculeApercu, ContenuTexte, useFormatApercu } from '@/components/apercu-markdown';
import { bytes, cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * L'aperçu d'une pièce jointe, en grand : image, PDF, ou bouton de
 * téléchargement pour le reste. Le même écran sert depuis la conversation et
 * depuis l'onglet « Pièces jointes ».
 */
export function AttachmentPreview({ item, onClose }: { item: Attachment | null; onClose: () => void }) {
  // Les crochets se posent AVANT la sortie anticipée.
  const { markdown, format, setFormat } = useFormatApercu(item?.name, item?.mime);
  const [texte, setTexte] = React.useState<string | null>(null);

  /* Une pièce jointe Markdown n'est pas déjà en mémoire, contrairement à un
     fichier du projet : on va la chercher, une seule fois, à l'ouverture. */
  React.useEffect(() => {
    setTexte(null);
    if (!item || !markdown) return;
    let vivant = true;
    fetch(`/api/attachment?id=${item.id}`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((contenu) => vivant && setTexte(contenu))
      .catch(() => vivant && setTexte('_Lecture impossible._'));
    return () => {
      vivant = false;
    };
  }, [item?.id, markdown]);

  if (!item) return null;
  const source = `/api/attachment?id=${item.id}`;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:w-[min(900px,100%)]">
        <div className="flex items-center gap-2 pr-6">
          <DialogTitle className="min-w-0 flex-1 truncate text-[14.5px]">{item.name}</DialogTitle>
          {markdown ? <BasculeApercu format={format} onChange={setFormat} /> : null}
          <Tooltip label={t('Télécharger')}>
            <Button variant="ghost" size="icon-sm" asChild>
              <a href={`${source}&download=1`} download={item.name}>
                <Download className="h-3 w-3" />
              </a>
            </Button>
          </Tooltip>
        </div>
        <ZoneDefilement
          fond="hsl(var(--raised))"
          classeEnveloppe="mt-3 max-h-[72dvh] flex-none rounded-md border border-border bg-raised"
          className="overflow-x-auto p-2"
        >
          {markdown ? (
            texte === null ? (
              <p className="p-4 text-[13.5px] text-faint">{t('Lecture…')}</p>
            ) : (
              <ContenuTexte contenu={texte} format={format} />
            )
          ) : item.mime.startsWith('image/') ? (
            <img src={source} alt={item.name} className="mx-auto max-w-full" />
          ) : item.mime === 'application/pdf' ? (
            <iframe title={item.name} src={source} className="h-[70dvh] w-full rounded" />
          ) : (
            <div className="p-6 text-center">
              <p className="mb-3 text-[13.5px] text-faint">
                {t('Ce type de fichier ne s\'affiche pas ici ({v0}).', { v0: bytes(item.size) })}</p>
              <Button variant="outline" size="sm" asChild>
                <a href={`${source}&download=1`} download={item.name}>
                  <Download className="h-3 w-3" />  {t('Télécharger')}
</a>
              </Button>
            </div>
          )}
        </ZoneDefilement>
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
