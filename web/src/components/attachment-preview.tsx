import * as React from 'react';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
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
/** Le glissement horizontal à partir duquel on passe à l'image voisine. */
const SEUIL_DE_GLISSEMENT = 48;

const sourceDUnePiece = (piece: Attachment) => `/api/attachment?id=${piece.id}`;

/**
 * LE FEUILLETAGE D'UNE GALERIE : glisser vers la gauche montre l'image
 * suivante, vers la droite la précédente ; les flèches du clavier font de même.
 *
 * Ce n'est PAS le glisser-déposer de cartes (`usePointerDrag`) : aucun objet ne
 * se déplace, un geste franchit un seuil. Il lit les événements de pointeur et
 * le conteneur déclare `touch-action: pan-y pinch-zoom`, donc le défilement
 * vertical et le zoom au pincement restent ceux du navigateur — qui reprend la
 * main (`pointercancel`) dès qu'il les reconnaît. Un glissement qui n'est pas
 * nettement horizontal est ignoré.
 */
function useFeuilletage(
  galerie: Attachment[] | undefined,
  item: Attachment | null,
  onNaviguer: ((piece: Attachment) => void) | undefined,
  sourceDe: (piece: Attachment) => string,
) {
  const rang = item && galerie ? galerie.findIndex((piece) => piece.id === item.id) : -1;
  const total = galerie?.length ?? 0;
  const actif = rang >= 0 && total > 1 && !!onNaviguer;
  const aller = React.useCallback(
    (decalage: number) => {
      if (!actif || !galerie || !onNaviguer) return;
      const suivante = galerie[rang + decalage];
      if (suivante) onNaviguer(suivante);
    },
    [actif, galerie, rang, onNaviguer],
  );

  React.useEffect(() => {
    if (!actif) return;
    const surTouche = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const cible = e.target as HTMLElement | null;
      if (cible?.closest('input, textarea, [contenteditable="true"]')) return;
      // La flèche change d'image : elle ne fait pas aussi défiler l'image large ou la page.
      e.preventDefault();
      aller(e.key === 'ArrowLeft' ? -1 : 1);
    };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, [actif, aller]);

  // Les voisines se chargent d'avance : le passage de l'une à l'autre est immédiat.
  React.useEffect(() => {
    if (!actif || !galerie) return;
    for (const voisine of [galerie[rang - 1], galerie[rang + 1]]) {
      if (voisine?.mime.startsWith('image/')) new Image().src = sourceDe(voisine);
    }
  }, [actif, galerie, rang, sourceDe]);

  const depart = React.useRef<{ x: number; y: number; id: number } | null>(null);
  const prises = actif
    ? {
        style: { touchAction: 'pan-y pinch-zoom' } as React.CSSProperties,
        'data-feuilletage': `${rang + 1}/${total}`,
        onPointerDown: (e: React.PointerEvent) => {
          // Un second doigt (pincement) annule le geste en cours.
          depart.current = depart.current ? null : { x: e.clientX, y: e.clientY, id: e.pointerId };
        },
        onPointerUp: (e: React.PointerEvent) => {
          const d = depart.current;
          depart.current = null;
          if (!d || d.id !== e.pointerId) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (Math.abs(dx) >= SEUIL_DE_GLISSEMENT && Math.abs(dx) > Math.abs(dy) * 1.5) aller(dx < 0 ? 1 : -1);
        },
        onPointerCancel: () => {
          depart.current = null;
        },
      }
    : {};
  return { actif, rang, total, aller, prises };
}

function FlecheDeFeuilletage({ sens, eteinte, onClick }: { sens: 'precedente' | 'suivante'; eteinte: boolean; onClick: () => void }) {
  const libelle = sens === 'precedente' ? t('Image précédente') : t('Image suivante');
  const Icone = sens === 'precedente' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={libelle}
      title={libelle}
      disabled={eteinte}
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      {...{ [sens === 'precedente' ? 'data-feuilletage-precedente' : 'data-feuilletage-suivante']: '' }}
      className={cn(
        'absolute top-1/2 z-10 flex h-14 w-11 -translate-y-1/2 items-center justify-center rounded-md bg-black/45 text-white shadow-sm transition-opacity',
        'opacity-80 hover:bg-black/60 hover:opacity-100 focus-visible:opacity-100 disabled:pointer-events-none disabled:opacity-25',
        sens === 'precedente' ? 'left-6' : 'right-6',
      )}
    >
      <Icone className="h-7 w-7" aria-hidden />
    </button>
  );
}

/**
 * L'aperçu d'une pièce jointe, en grand. Avec une GALERIE (les images d'un même
 * fil), on passe de l'une à l'autre au glissement, aux flèches du clavier ou
 * aux boutons, et un repère « n / total » dit où l'on est.
 */
export function AttachmentPreview({
  item,
  onClose,
  galerie,
  onNaviguer,
  sourceDe = sourceDUnePiece,
}: {
  item: Attachment | null;
  onClose: () => void;
  /** Les pièces entre lesquelles on feuillette, dans l'ordre. */
  galerie?: Attachment[];
  /** Appelée avec la pièce voisine : l'appelant la pose comme pièce ouverte. */
  onNaviguer?: (piece: Attachment) => void;
  /** D'où se lit l'image d'une pièce : par défaut, la route des pièces jointes. */
  sourceDe?: (piece: Attachment) => string;
}) {
  const feuilletage = useFeuilletage(galerie, item, onNaviguer, sourceDe);
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
  const source = sourceDe(item);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContentLibre className="sm:w-[min(900px,100%)]">
        <DialogHeader className="flex items-center gap-2 pb-3">
          <DialogTitle className="min-w-0 flex-1 truncate text-[14.5px]">{etiquetteDePiece(item)}</DialogTitle>
          {feuilletage.actif ? (
            <span className="min-w-[3.2em] shrink-0 text-center text-[12.5px] tabular-nums text-faint" data-feuilletage-repere>
              {feuilletage.rang + 1} / {feuilletage.total}
            </span>
          ) : null}
          {markdown ? <BasculeApercu format={format} onChange={setFormat} /> : null}
          <Tooltip label={t('Télécharger')}>
            <Button variant="ghost" size="icon-sm" asChild>
              <a href={`${source}&download=1`} download={item.name} data-enregistrer-direct>
                <Download className="h-3 w-3" />
              </a>
            </Button>
          </Tooltip>
        </DialogHeader>
        <div {...feuilletage.prises} className="relative min-h-0 flex-1 flex flex-col">
        {/* DEUX GRANDES FLÈCHES SUR LES BORDS DE L'IMAGE. Les petits chevrons de
            l'entête passaient inaperçus : on cherchait comment passer à l'image
            suivante. Elles restent visibles (plus franches au survol), se
            grisent à la première et à la dernière image — on ne boucle pas —, et
            n'arrêtent ni le glissement ni le pincement : le geste naît sur
            l'image, pas sur elles. */}
        {feuilletage.actif ? (
          <>
            <FlecheDeFeuilletage sens="precedente" eteinte={feuilletage.rang === 0} onClick={() => feuilletage.aller(-1)} />
            <FlecheDeFeuilletage
              sens="suivante"
              eteinte={feuilletage.rang === feuilletage.total - 1}
              onClick={() => feuilletage.aller(1)}
            />
          </>
        ) : null}
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
            <img src={source} alt={etiquetteDePiece(item)} draggable={false} className="mx-auto max-w-full select-none" />
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
                <a href={`${source}&download=1`} download={item.name} data-enregistrer-direct>
                  <Download className="h-3 w-3" />  {t('Télécharger')}
</a>
              </Button>
            </div>
          )}
        </ZoneDefilement>
        </div>
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
