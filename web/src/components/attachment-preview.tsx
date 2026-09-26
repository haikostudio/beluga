import * as React from 'react';
import { Download } from 'lucide-react';
import { Attachment, etiquetteDePiece, genreDuFichier } from '@beluga/shared';
import { Button, Dialog, DialogContentLibre, DialogHeader, DialogTitle, Tooltip, ZoneDefilement } from '@/components/ui';
import { BasculeApercu, ContenuTexte, useFormatApercu } from '@/components/apercu-markdown';
import { PastilleDeFichier, VignetteDImage } from '@/components/pastille-de-fichier';
import { LecteurVideo, type ApercuDeVideo } from '@/components/lecteur-video';
import { client } from '@/lib/client';
import { bytes, cn } from '@/lib/utils';
import { t } from '@/lib/langue';


/**
 * L'APERÇU D'UNE VIDÉO, VU DE L'ESPACE DE TRAVAIL.
 *
 * Ce qui est gardé sur la pièce est relu tel quel ; ce que la recherche
 * automatique trouve est ÉCRIT sur la pièce, pour que personne n'ait à chercher
 * une seconde fois — et le geste « c'est cette image-là » passe par la même
 * porte, marqué comme un choix de la main. L'espace client, lui, n'appelle rien
 * de tout cela : il lit l'instant et s'arrête là.
 */
function useApercuDePiece(item: Attachment | null): ApercuDeVideo | undefined {
  const id = item?.id;
  const seconde = item?.apercuSeconde;
  const manuel = item?.apercuManuel;
  return React.useMemo(
    () =>
      id
        ? {
            seconde,
            manuel,
            onChoisir: (choix: number | null) =>
              client.send({ type: 'attachment.apercu', id, seconde: choix, manuel: true }),
            onTrouve: (trouve: number) => client.send({ type: 'attachment.apercu', id, seconde: trouve, manuel: false }),
          }
        : undefined,
    [id, seconde, manuel],
  );
}

/**
 * L'aperçu d'une pièce jointe, en grand : image, PDF, ou bouton de
 * téléchargement pour le reste. Le même écran sert depuis la conversation et
 * depuis l'onglet « Pièces jointes ».
 */
export function AttachmentPreview({ item, onClose }: { item: Attachment | null; onClose: () => void }) {
  // Les crochets se posent AVANT la sortie anticipée.
  const { markdown, format, setFormat } = useFormatApercu(item?.name, item?.mime);
  const apercuDeLaPiece = useApercuDePiece(item);
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
      <DialogContentLibre className="sm:w-[min(900px,100%)]">
        <DialogHeader className="flex items-center gap-2 pb-3">
          <DialogTitle className="min-w-0 flex-1 truncate text-[14.5px]">{etiquetteDePiece(item)}</DialogTitle>
          {markdown ? <BasculeApercu format={format} onChange={setFormat} /> : null}
          <Tooltip label={t('Télécharger')}>
            <Button variant="ghost" size="icon-sm" asChild>
              <a href={`${source}&download=1`} download={item.name}>
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
          {markdown ? (
            texte === null ? (
              <p className="p-4 text-[13.5px] text-faint">{t('Lecture…')}</p>
            ) : (
              <ContenuTexte contenu={texte} format={format} />
            )
          ) : item.mime.startsWith('image/') ? (
            <img src={source} alt={etiquetteDePiece(item)} className="mx-auto max-w-full" />
          ) : genreDuFichier(item.mime) === 'video' ? (
            /* LE MÊME LECTEUR QUE DANS LE FIL — il n'y a pas deux jeux de
               commandes à tenir d'accord. Déjà agrandi ici, il ne propose plus
               que le plein écran. */
            <LecteurVideo
              id={item.id}
              nom={etiquetteDePiece(item)}
              sansAgrandir
              demarrer
              apercu={apercuDeLaPiece}
              className="mx-auto"
            />
          ) : item.mime === 'application/pdf' ? (
            <iframe title={etiquetteDePiece(item)} src={source} className="h-[70dvh] w-full rounded" />
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
      </DialogContentLibre>
    </Dialog>
  );
}

/**
 * La vignette d'une pièce jointe dans un message. UNE IMAGE s'affiche et
 * s'agrandit au clic ; TOUT AUTRE FICHIER se télécharge au clic, sous son vrai
 * nom. Le rendu est celui de `PastilleDeFichier` — la même pièce que l'espace
 * client, pour ne pas tenir deux affichages d'accord à la main.
 *
 * Le nom MONTRÉ reste l'étiquette courte de la pièce (« #1a0c ») : c'est le
 * repère que l'agent et l'utilisateur se donnent dans le fil. Le nom
 * ENREGISTRÉ, lui, est le vrai (`item.name`).
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
  const apercu = useApercuDePiece(item);
  if (item.mime.startsWith('image/')) {
    return (
      <VignetteDImage
        id={item.id}
        nom={etiquetteDePiece(item)}
        nomDuFichier={item.name}
        onApercu={onOpen}
        compact={compact}
        className={className}
      />
    );
  }

  /*
   * UNE VIDÉO SE REGARDE DANS LE FIL. Le lecteur ne charge que l'entête du
   * fichier (`preload="metadata"`) ; la lecture et les sauts dans le temps
   * demandent ensuite des morceaux (lecture partielle côté démon) — une vidéo
   * de 2 Go démarre donc sans être téléchargée en entier. Dans la barre
   * d'écriture (`compact`), elle reste une pastille.
   */
  if (!compact && genreDuFichier(item.mime) === 'video') {
    return (
      <figure className={cn('w-full max-w-[480px]', className)} data-video-fil={item.id}>
        <LecteurVideo id={item.id} nom={item.name} apercu={apercu} />
        <figcaption className="mt-1 min-w-0 truncate text-[12px] text-faint" title={item.name}>
          {etiquetteDePiece(item)} · {bytes(item.size)}
        </figcaption>
      </figure>
    );
  }

  return (
    <PastilleDeFichier
      id={item.id}
      nom={etiquetteDePiece(item)}
      nomDuFichier={item.name}
      mime={item.mime}
      poids={item.size}
      compact={compact}
      className={className}
    />
  );
}
