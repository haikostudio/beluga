import * as React from 'react';
import { ArrowUpRight, FileText, Presentation } from '@/components/ui/icones';
import type { Attachment, FormatDePlaquette } from '@beluga/shared';
import { Button } from '@/components/ui';
import { ImageDePiece } from '@/components/pastille-de-fichier';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * LES MORCEAUX COMMUNS D'UNE PLAQUETTE CLIENT À L'ÉCRAN (carte « Refonte de l'espace Plaquettes », 05/11/2026) : le
 * libellé et la proportion de chaque format, la vignette de couverture, et LA CARTE D'APERÇU DU FIL — un PDF de
 * plaquette joint par l'agent ne se montre plus en simple pastille : sa couverture, son titre, son format ; un clic
 * l'ouvre dans la visionneuse (jamais un nouvel onglet), « Voir dans Charte graphique » mène au document, ouvert au centre.
 */

export function libelleDuFormat(format: string): string {
  switch (format as FormatDePlaquette) {
    case 'a4-paysage':
      return t('A4 paysage');
    case 'diapositives':
      return t('Diapositives');
    default:
      return t('A4 portrait');
  }
}

/** La proportion de la page, pour que la vignette garde sa forme (portrait, paysage, 16:9). */
export function proportionDuFormat(format: string): string {
  return format === 'a4-paysage' ? '297 / 210' : format === 'diapositives' ? '16 / 9' : '210 / 297';
}

/** La couverture d'une plaquette, à sa proportion ; sans vignette encore, une page à la couleur de la marque. */
export function VignetteDePlaquette({
  vignette,
  format,
  couleur,
  titre,
  className,
}: {
  vignette: string | null | undefined;
  format: string;
  couleur?: string;
  titre: string;
  className?: string;
}) {
  return (
    <span
      className={cn('relative block overflow-hidden rounded-md bg-raised', className)}
      style={{ aspectRatio: proportionDuFormat(format), ...(vignette ? {} : couleur ? { background: couleur } : {}) }}
      data-vignette-plaquette={vignette ? 'image' : 'aplat'}
    >
      {vignette ? (
        <ImageDePiece id={vignette} alt={titre} className="h-full w-full object-cover object-top" />
      ) : (
        /* Sur l'aplat de la marque (couleur du document, pas du thème), l'icône prend la teinte lisible sur elle. */
        <span className="absolute inset-0 flex items-center justify-center opacity-80" style={couleur ? { color: lisibleSur(couleur) } : undefined}>
          {format === 'diapositives' ? <Presentation className="h-6 w-6" /> : <FileText className="h-6 w-6" />}
        </span>
      )}
    </span>
  );
}

/** Noir ou blanc, selon ce qui se lit sur la couleur de la marque. */
function lisibleSur(fond: string): string {
  const n = parseInt(fond.replace('#', '').slice(0, 6), 16);
  if (Number.isNaN(n)) return 'currentColor';
  const clair = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 160;
  return clair ? '#111111' : '#ffffff';
}

/** Mène à la plaquette dans sa page, tiroir ouvert. */
export function ouvrirLaPlaquette(projectId: string, id: string): void {
  window.location.hash = `plaquettes/${encodeURIComponent(projectId)}/${encodeURIComponent(id)}`;
}

export function CarteDePlaquetteDuFil({ item, onOpen, className }: { item: Attachment; onOpen: () => void; className?: string }) {
  const pl = item.plaquette!;
  return (
    <figure className={cn('m-0 flex w-full max-w-[340px] flex-col gap-2 rounded-xl bg-raised p-2', className)} data-carte-plaquette={pl.id} data-plaquette-format={pl.format}>
      <button
        type="button"
        onClick={onOpen}
        className="block w-full overflow-hidden rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        aria-label="Ouvrir le PDF"
        data-carte-plaquette-ouvrir
      >
        <VignetteDePlaquette vignette={pl.vignette} format={pl.format} titre={pl.titre} />
      </button>
      <figcaption className="flex min-w-0 flex-col gap-0.5 px-1">
        <span className="truncate text-[13px] font-medium text-text" title={pl.titre}>
          {pl.titre}
        </span>
        <span className="truncate text-[12px] text-muted">
          {t('PDF · {format} · version {n}', { format: libelleDuFormat(pl.format), n: pl.version })}
        </span>
      </figcaption>
      <div className="flex flex-wrap gap-1.5 px-0.5 pb-0.5">
        <Button size="sm" variant="subtle" onClick={onOpen} data-carte-plaquette-pdf>
          <FileText className="h-3.5 w-3.5" />
          {t('Ouvrir le PDF')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => ouvrirLaPlaquette(pl.projectId, pl.id)} data-carte-plaquette-voir>
          <ArrowUpRight className="h-3.5 w-3.5" />
          {t('Voir dans Charte graphique')}
        </Button>
      </div>
    </figure>
  );
}
