import * as React from 'react';
import { FileText, Film, Music, Play } from '@/components/ui/icones';
import { adresseDePiece } from '@/components/pastille-de-fichier';
import { formatRegional, t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * LES CELLULES TYPES DU TABLEAU COMMUN (décision du 03/11/2026 : « chaque ligne a un aperçu cliquable, une date
 * et un titre »).
 *
 * - `ApercuDeLigne` : la vignette d'un média — réduite côté serveur (jamais l'original), une vidéo montre sa
 *   première image et un rond de lecture, un son son icône. Un clic l'OUVRE (la visionneuse de l'écran), sans
 *   ouvrir la ligne.
 * - `dateDeLigne` : la date ET l'heure, au format de la langue choisie.
 * - `TitreEtSous` : le titre en gras et sa ligne grise.
 */
export type GenreDApercu = 'image' | 'video' | 'son' | 'audio' | 'document' | null | undefined;

export function ApercuDeLigne({
  piece,
  genre,
  taille = 40,
  onOuvrir,
  libelle,
  className,
  ...reste
}: {
  piece?: string | null;
  genre?: GenreDApercu;
  taille?: number;
  onOuvrir?: () => void;
  libelle?: string;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLElement>, 'onClick'>) {
  const [casse, setCasse] = React.useState(false);
  const style = { width: taille, height: taille };
  const son = genre === 'son' || genre === 'audio';
  const interieur =
    piece && !casse && !son && genre !== 'document' ? (
      genre === 'video' ? (
        <>
          <video src={`${adresseDePiece(piece)}#t=0.5`} preload="metadata" muted playsInline className="pointer-events-none h-full w-full object-cover" onError={() => setCasse(true)} />
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-surface/85 text-text">
              <Play className="h-2.5 w-2.5 translate-x-[0.5px]" fill="currentColor" aria-hidden />
            </span>
          </span>
        </>
      ) : (
        <img src={adresseDePiece(piece, false, 160)} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" onError={() => setCasse(true)} />
      )
    ) : (
      <span className="flex h-full w-full items-center justify-center text-faint">
        {son ? <Music className="h-4 w-4" /> : genre === 'video' ? <Film className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
      </span>
    );
  const classe = cn('relative block shrink-0 overflow-hidden rounded-md bg-raised', className);
  if (!onOuvrir) {
    return (
      <span style={style} className={classe} data-apercu-de-ligne={piece ?? ''} {...reste}>
        {interieur}
      </span>
    );
  }
  return (
    <button
      type="button"
      style={style}
      onClick={(e) => {
        e.stopPropagation();
        onOuvrir();
      }}
      title={libelle ?? t('Ouvrir en grand')}
      aria-label="Ouvrir en grand"
      className={cn(classe, 'outline-none ring-faint transition-opacity hover:opacity-85 focus-visible:ring-2')}
      data-apercu-de-ligne={piece ?? ''}
      {...reste}
    >
      {interieur}
    </button>
  );
}

/** La date et l'heure d'une ligne (« 3 nov. 2026, 14:05 »), « — » sans date. */
export function dateDeLigne(instant: number | null | undefined, maintenant = Date.now()): string {
  if (!instant) return '—';
  const d = new Date(instant);
  const memeAnnee = d.getFullYear() === new Date(maintenant).getFullYear();
  return d.toLocaleString(formatRegional(), { day: 'numeric', month: 'short', ...(memeAnnee ? {} : { year: 'numeric' }), hour: '2-digit', minute: '2-digit' });
}

export function TitreEtSous({ titre, sous, gras = true }: { titre: React.ReactNode; sous?: React.ReactNode; gras?: boolean }) {
  return (
    <span className="block min-w-0">
      <span className={cn('block truncate', gras ? 'font-medium text-text' : 'text-text')}>{titre}</span>
      {sous ? <span className="block truncate text-[11.5px] text-muted">{sous}</span> : null}
    </span>
  );
}

/** Un poids de fichier lisible (« 2,4 Mo »), avec les unités traduites de la page Résumé. */
export function poidsDeLigne(octets: number | null | undefined): string {
  if (!octets) return '—';
  let n = octets;
  let u = 0;
  while (n >= 1024 && u < 3) {
    n /= 1024;
    u += 1;
  }
  const v = n.toLocaleString(formatRegional(), { maximumFractionDigits: u >= 2 ? 1 : 0 });
  return u === 0 ? t('{n} o', { n: v }) : u === 1 ? t('{n} ko', { n: v }) : u === 2 ? t('{n} Mo', { n: v }) : t('{n} Go', { n: v });
}
