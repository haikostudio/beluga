/**
 * LE CADRE D'UNE IMAGE DU FIL ET SA RÉFÉRENCE (17/11/2026, captures #820bb et #dcf4).
 *
 * LE FOND ÉPOUSE L'IMAGE. Une vignette bornée par `max-w-[min(320px,100%)]` dans un parent `w-fit` est un pourcentage
 * CYCLIQUE : le parent se dimensionne sur la largeur naturelle de l'image (1 600 px), puis la borne se résout à 320 px
 * — le fond gris restait étalé jusqu'au bord du fil. La largeur affichée est donc posée EN PIXELS au chargement
 * (`poserLaLargeurDeVignette`), d'après la taille naturelle : le parent la lit, le fond tombe au bord de l'image.
 *
 * LA RÉFÉRENCE SE LIT SOUS L'IMAGE, DANS LE CADRE, HORS DU BOUTON : un texte posé dans un `button` ne se sélectionne
 * pas ; ici il se copie à la souris (`texte-copiable`).
 */
import * as React from 'react';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { ImageIcon } from '@/components/ui/icones';
import { t } from '@/lib/langue';

/** Largeur et hauteur maximales d'une vignette du fil, en pixels CSS. */
const LARGEUR_MAX_DE_VIGNETTE = 320;
const HAUTEUR_MAX_DE_VIGNETTE = 160;

/** Pose en pixels la largeur d'une vignette chargée : jamais plus que sa taille naturelle ni que ses deux bornes. */
export function poserLaLargeurDeVignette(
  media: HTMLImageElement | HTMLVideoElement | null,
  largeurMax = LARGEUR_MAX_DE_VIGNETTE,
  hauteurMax = HAUTEUR_MAX_DE_VIGNETTE,
): void {
  if (!media) return;
  const [naturelle, hauteur] = media instanceof HTMLVideoElement ? [media.videoWidth, media.videoHeight] : [media.naturalWidth, media.naturalHeight];
  if (!naturelle || !hauteur) return;
  media.style.width = `${Math.max(1, Math.round(largeurDeVignette(naturelle, hauteur, largeurMax, hauteurMax)))}px`;
}

/** La largeur affichée d'une vignette : sa taille naturelle, bornée en largeur et en hauteur, proportions gardées. */
function largeurDeVignette(naturelle: number, hauteur: number, largeurMax = LARGEUR_MAX_DE_VIGNETTE, hauteurMax = HAUTEUR_MAX_DE_VIGNETTE): number {
  return Math.min(largeurMax, naturelle, (naturelle * hauteurMax) / hauteur);
}

/** La référence d'un média (« #ff70 »), sous lui, dans son cadre, copiable. */
export function ReferenceSousLeMedia({ texte, className }: { texte: string; className?: string }) {
  return (
    <span
      data-reference-du-media={texte}
      className={cn('block truncate px-1 pb-0.5 pt-1 text-center font-mono text-[11px] leading-4 text-muted texte-copiable', className)}
    >
      {texte}
    </span>
  );
}

/**
 * LA RÉFÉRENCE D'UNE PIÈCE PAR SON IDENTIFIANT (« #ff70 »), cherchée dans les pièces déjà connues de l'écran : une
 * pièce inconnue n'en reçoit aucune, jamais un repère inventé. Ne relit l'écran que quand la référence change.
 */
export function useReferenceDeLaPiece(id: string | null | undefined): string | null {
  const lire = React.useCallback(() => {
    if (!id) return null;
    for (const liste of Object.values(client.lireEtat().attachments)) {
      const piece = liste?.find((p) => p.id === id);
      if (piece) return piece.alias ? `#${piece.alias}` : null;
    }
    return null;
  }, [id]);
  return React.useSyncExternalStore(client.subscribe, lire, lire);
}

/* Une seule demande par image et par session d'écran : le démon range de toute façon une seule fois (empreinte). */
const rangementsDemandes = new Set<string>();

/**
 * UNE CAPTURE DE L'AGENT SANS RÉFÉRENCE DEMANDE SON RANGEMENT (17/11/2026) : le démon la range en pièce jointe sur le
 * disque de stockage et la note sous son chemin ; l'écran reçoit la pièce par la liste du projet, et la référence
 * apparaît sous la vignette (`/api/capture/ranger`, `rangerUneCaptureDeLAgent`).
 */
export function useRangementDeLaCapture(projectId: string | undefined, chemin: string | null, aSaReference: boolean, prete: boolean): void {
  React.useEffect(() => {
    if (!prete || aSaReference || !projectId || !chemin) return;
    const cle = `${projectId}\u0000${chemin}`;
    if (rangementsDemandes.has(cle)) return;
    rangementsDemandes.add(cle);
    void fetch('/api/capture/ranger', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: projectId, path: chemin }),
    }).catch(() => rangementsDemandes.delete(cle));
  }, [projectId, chemin, aSaReference, prete]);
}

/*
 * LES LÉGENDES DES IMAGES DU FIL, NOTÉES PAR CE QUI LES DESSINE (17/11/2026) : la légende d'une image du texte
 * (« ![légende](piece:…) ») sous l'identifiant de sa pièce, la phrase d'une capture de l'agent sous son chemin. La
 * galerie du fil les relit à l'ouverture pour les écrire sous le média en grand (`legendeDe`, `attachment-preview.tsx`).
 */
const legendesDuFil = new Map<string, string>();

export function noterLaLegende(cle: string | null | undefined, legende: string | null | undefined): void {
  const texte = legende?.trim();
  if (cle && texte) legendesDuFil.set(cle, texte);
}

export function legendeNotee(cle: string | null | undefined): string | null {
  return cle ? (legendesDuFil.get(cle) ?? null) : null;
}

/**
 * UNE IMAGE DE VIGNETTE QUI GARDE SA PLACE EN CHARGEANT : tant qu'elle n'est pas là, son cadre a la taille d'une
 * vignette et la silhouette commune y respire (jamais un cadre replié sur sa seule référence) ; chargée, sa largeur se
 * pose en pixels (`poserLaLargeurDeVignette`).
 */
export function ImageDeVignette({
  src,
  alt,
  hauteurMax = HAUTEUR_MAX_DE_VIGNETTE,
  largeurMax = LARGEUR_MAX_DE_VIGNETTE,
}: {
  src: string;
  alt: string;
  hauteurMax?: number;
  largeurMax?: number;
}) {
  const [chargee, setChargee] = React.useState(false);
  /* UNE IMAGE QUI NE VIENT PAS LE DIT (19/11/2026, capture #979ef) : plus de silhouette qui pulse pour toujours ni de
     carré cassé, une mention discrète à la place. */
  const [manquante, setManquante] = React.useState(false);
  React.useEffect(() => setManquante(false), [src]);
  const poser = (image: HTMLImageElement) => {
    poserLaLargeurDeVignette(image, largeurMax, hauteurMax);
    setChargee(true);
  };
  if (manquante) return <ImageIndisponible libelle={alt} />;
  return (
    <span className={cn('relative block', !chargee && 'h-40 w-60 max-w-full')} data-chargee={chargee ? '1' : '0'}>
      {!chargee ? <span aria-hidden data-silhouette-image className="absolute inset-0 animate-silhouette rounded bg-faint/25" /> : null}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={(event) => poser(event.currentTarget)}
        onError={() => setManquante(true)}
        ref={(image) => {
          if (image?.complete && image.naturalWidth && !chargee) poser(image);
        }}
        style={{ maxHeight: hauteurMax }}
        className={cn('block h-auto max-w-full rounded object-contain transition-opacity duration-200', chargee ? 'opacity-100' : 'absolute inset-0 h-full w-full opacity-0')}
      />
    </span>
  );
}

/** LA PLACE D'UNE IMAGE INTROUVABLE : une icône et « Image indisponible », dans le gris des vignettes. */
export function ImageIndisponible({ libelle, compacte = false }: { libelle?: string; compacte?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded bg-raised text-faint',
        compacte ? 'h-16 px-2 text-[11.5px]' : 'px-3 py-2.5 text-[12.5px]',
      )}
      title={libelle || undefined}
      data-image-indisponible=""
    >
      <ImageIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="truncate">{t('Image indisponible')}</span>
    </span>
  );
}
